-- Public competitor + own-brand data from logged-out public websites (Competitor Ads > Google Ads,
-- RERA Projects, Search Trends tabs). Collected by the public-intel edge function (it took over the
-- unused qual-test slot, with the user's OK) by calling the same requests each site's own page makes.
--
-- RULES THE TABLES ENFORCE
--   * Every number is traceable: each row keeps fetched_at and source_url (the exact public page or
--     request it came from) and the run that wrote it.
--   * Nothing partial is stored silently: every unit of work writes a camp.pi_runs row, failures
--     included (HTTP status, error text), and the screen shows them.
--   * Gentle volume: one small unit per source per tick (every 5 minutes), spaced requests inside a
--     unit, and a source that was refused (429 / CAPTCHA page) waits 6 hours before it is tried again.
--     A CAPTCHA is never solved or worked around - the unit is recorded as failed and left.

-- ---- What we follow on each source -------------------------------------------------------------
-- google_ads: kind 'advertiser' (value = Google advertiser id AR...) or 'domain' (ads pointing to it)
-- rera:       kind 'promoter' (value = promoter name exactly as WBRERA prints it)
-- trends:     kind 'term' / 'anchor' in a group of at most 5 (Google compares terms only inside one
--             request, so each group carries the same anchor term to make groups comparable)
create table if not exists camp.pi_targets (
  id            bigserial primary key,
  source        text not null check (source in ('google_ads', 'rera', 'trends')),
  kind          text not null check (kind in ('advertiser', 'domain', 'promoter', 'term', 'anchor')),
  value         text not null,
  label         text,
  watchlist_id  bigint references camp.competitor_watchlist(id) on delete set null,
  grp           text not null default '',
  sort          int not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (source, kind, value, grp)
);

create table if not exists camp.pi_runs (
  id           bigserial primary key,
  source       text not null,           -- google_ads | rera_list | rera_detail | trends
  unit         text,                    -- what this run covered (advertiser id, procodes, group/geo)
  trigger      text,                    -- cron | manual:<email>
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  http_status  int,
  refused      boolean not null default false,  -- site said too many requests / showed a CAPTCHA
  items        int,
  note         text,
  error        text
);
create index if not exists pi_runs_source_idx on camp.pi_runs (source, started_at desc);

-- ---- Google Ads Transparency Center ------------------------------------------------------------
create table if not exists camp.pi_gads_creatives (
  creative_id      text primary key,
  advertiser_id    text not null,
  advertiser_name  text,
  domain           text,
  format           text,                -- text | image | video (Google's own format code 1/2/3)
  format_code      int,
  first_shown      timestamptz,
  last_shown       timestamptz,
  days_shown       int,
  image_url        text,
  preview_url      text,
  region           text not null default 'IN',
  target_id        bigint references camp.pi_targets(id) on delete set null,
  watchlist_id     bigint references camp.competitor_watchlist(id) on delete set null,
  first_seen_at    timestamptz not null default now(),
  fetched_at       timestamptz not null default now(),
  run_id           bigint references camp.pi_runs(id) on delete set null,
  source_url       text,
  raw              jsonb
);
create index if not exists pi_gads_wl_idx on camp.pi_gads_creatives (watchlist_id, last_shown desc);

-- ---- WBRERA ------------------------------------------------------------------------------------
create table if not exists camp.pi_rera_projects (
  procode            text primary key,
  project_id         text,
  name               text,
  reg_no             text,
  reg_date           date,
  completion_date    date,
  list_status        text,               -- approved | rejected (which public list it is on)
  list_seen_at       timestamptz,
  -- from the project's own page
  address            text,
  district           text,
  block              text,
  police_station     text,
  pincode            text,
  project_status     text,
  extension_date     text,               -- kept as printed ('NA' or a date)
  project_type       text,
  land_area_sqm      numeric,
  built_area_sqm     numeric,
  carpet_area_sqm    numeric,
  apartments         int,
  open_parking       text,
  covered_parking    text,
  website            text,
  promoter_name      text,
  promoter_type      text,
  promoter_cin       text,
  promoter_address   text,
  promoter_website   text,
  litigations        text,
  detail_fetched_at  timestamptz,
  detail_error       text,
  run_id             bigint references camp.pi_runs(id) on delete set null,
  source_url         text
);
create index if not exists pi_rera_promoter_idx on camp.pi_rera_projects (lower(promoter_name));
create index if not exists pi_rera_detail_idx on camp.pi_rera_projects (detail_fetched_at nulls first);

-- The Rejected/Revoked list has no link to a project page, so it is kept by its RERA project id.
create table if not exists camp.pi_rera_rejected (
  project_id       text primary key,
  name             text,
  completion_date  date,
  rejected_date    date,
  list_seen_at     timestamptz not null default now(),
  source_url       text
);

-- What changed between two fetches (completion date pushed out, status moved on, ...).
create table if not exists camp.pi_rera_changes (
  id          bigserial primary key,
  procode     text not null references camp.pi_rera_projects(procode) on delete cascade,
  field       text not null,
  old_value   text,
  new_value   text,
  changed_at  timestamptz not null default now(),
  run_id      bigint references camp.pi_runs(id) on delete set null
);
create index if not exists pi_rera_changes_idx on camp.pi_rera_changes (procode, changed_at desc);

-- ---- Google Trends -----------------------------------------------------------------------------
-- Values are Google's 0-100 index, relative to the highest point among the terms of ONE request.
-- Each fetch of a group replaces that group's weeks (Google rescales every time), keeping the run.
create table if not exists camp.pi_trends_points (
  grp          text not null,
  geo          text not null,
  term         text not null,
  week_start   date not null,
  value        int,
  has_data     boolean not null,
  fetched_at   timestamptz not null default now(),
  run_id       bigint references camp.pi_runs(id) on delete set null,
  primary key (grp, geo, term, week_start)
);

-- ---- Access: staff read, only the function writes ----------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['pi_targets','pi_runs','pi_gads_creatives','pi_rera_projects','pi_rera_rejected','pi_rera_changes','pi_trends_points'] loop
    execute format('alter table camp.%I enable row level security', t);
    execute format('drop policy if exists "staff read" on camp.%I', t);
    execute format('create policy "staff read" on camp.%I for select to authenticated using (not app.is_customer())', t);
    execute format('revoke insert, update, delete on camp.%I from anon, authenticated', t);
    execute format('revoke select on camp.%I from anon', t);
    execute format('grant select on camp.%I to authenticated', t);
    execute format('grant all on camp.%I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema camp to service_role;

-- ---- Seed: the mapping the user confirmed on 2026-10-16 ----------------------------------------
insert into camp.pi_targets (source, kind, value, label, watchlist_id, sort) values
  ('google_ads','advertiser','AR04991908941882458113','DREAM GATEWAY HOTELS LIMITED',      22, 1),
  ('google_ads','domain',    'thejaingroup.com',      'thejaingroup.com',                  22, 2),
  ('google_ads','advertiser','AR15140050023829471233','DTC PROJECTS PVT. LTD',              2, 10),
  ('google_ads','domain',    'dtcprojectskolkata.com','dtcprojectskolkata.com',             2, 11),
  ('google_ads','advertiser','AR08189374680570789889','GODREJ PROPERTIES LIMITED',         17, 20),
  ('google_ads','advertiser','AR11827436186165575681','Godrej Properties Ltd',             17, 21),
  ('google_ads','advertiser','AR03569259453817552897','Srijan Realty Private Limited',     10, 30),
  ('google_ads','advertiser','AR18213567842488418305','SRIJAN REALTY PRIVATE LIMITED',     10, 31),
  ('google_ads','advertiser','AR16037317654591045633','Eden Realty Ventures Private Limited',18, 40),
  ('google_ads','advertiser','AR14001106653496213505','MERLIN PROJECTS LIMITED',           20, 50),
  ('google_ads','advertiser','AR16686966444914638849','Merlin Projects Real Estate LLP',   20, 51),
  ('google_ads','advertiser','AR06771691007923716097','Siddha Real Estate Development Pvt. Ltd.',12, 60),
  ('google_ads','domain',    'orbitgroup.net',        'orbitgroup.net',                    14, 70)
on conflict do nothing;

-- RERA: our promoter as WBRERA prints it (Dream Gurukul's page). Competitor promoters are added
-- after the first full pass, once the user has seen the real names.
insert into camp.pi_targets (source, kind, value, label, watchlist_id, grp) values
  ('rera','promoter','Dream Gateway Hotels Ltd','Dream Gateway Hotels Ltd (Jain Group)',22,'')
on conflict do nothing;

-- Trends: four groups, each with the same anchor so the groups can be read against each other.
insert into camp.pi_targets (source, kind, value, label, grp, sort, watchlist_id) values
  ('trends','term','Dream World City',  null,'Our projects',1,27),
  ('trends','term','Dream Gurukul',     null,'Our projects',2,26),
  ('trends','term','Dream Eco City',    null,'Our projects',3,29),
  ('trends','term','Dream Valley',      null,'Our projects',4,25),
  ('trends','anchor','flats in kolkata',null,'Our projects',9,null),
  ('trends','term','DTC Projects',      null,'Developers A',1,2),
  ('trends','term','Srijan Realty',     null,'Developers A',2,10),
  ('trends','term','Merlin Projects',   null,'Developers A',3,20),
  ('trends','term','Siddha Group',      null,'Developers A',4,12),
  ('trends','anchor','flats in kolkata',null,'Developers A',9,null),
  ('trends','term','Godrej Properties', null,'Developers B',1,17),
  ('trends','term','Eden Realty',       null,'Developers B',2,18),
  ('trends','term','Orbit Group',       null,'Developers B',3,14),
  ('trends','term','PS Group',          null,'Developers B',4,21),
  ('trends','anchor','flats in kolkata',null,'Developers B',9,null),
  ('trends','term','flats in Joka',     null,'Localities',1,null),
  ('trends','term','Madhyamgram flats', null,'Localities',2,null),
  ('trends','term','flats in Rajarhat', null,'Localities',3,null),
  ('trends','term','flats in New Town', null,'Localities',4,null),
  ('trends','anchor','flats in kolkata',null,'Localities',9,null)
on conflict do nothing;

-- ---- Schedule ----------------------------------------------------------------------------------
-- Every 5 minutes the function does at most one small unit per source (each source decides for
-- itself whether anything is due), so a tick with nothing due costs one short call.
insert into acc.job_secrets (name, value)
values ('public_intel', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (name) do nothing;

create or replace function camp.pi_kick() returns bigint
language sql security definer set search_path to '' as $$
  select net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/public-intel',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n',
      'x-pi-secret',(select value from acc.job_secrets where name='public_intel')),
    body := '{"action":"tick","trigger":"cron"}'::jsonb,
    timeout_milliseconds := 150000)
$$;
revoke all on function camp.pi_kick() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'public-intel-tick';
select cron.schedule('public-intel-tick', '*/5 * * * *', $cron$ select camp.pi_kick(); $cron$);

-- Usage catalogue rows for the three new tabs.
insert into public.erp_feature_catalog(module_id, module_label, tab, feature, feature_key, sort, active)
select v.* from (values
('competitors','Competitor Ads','Google Ads','View Google ads of competitors and our brand','competitors.google_ads.view_google_ads',410,true),
('competitors','Competitor Ads','RERA Projects','View WBRERA projects of competitors and our brand','competitors.rera_projects.view_rera_projects',411,true),
('competitors','Competitor Ads','Search Trends','View Google search interest for brands, projects and localities','competitors.search_trends.view_search_trends',412,true)
) v(module_id, module_label, tab, feature, feature_key, sort, active)
where not exists (select 1 from public.erp_feature_catalog c where c.feature_key = v.feature_key);

-- The function asks this with the caller's own token before a manual "Fetch now".
create or replace function camp.pi_allowed() returns boolean
language sql stable set search_path to '' as $$
  select auth.uid() is not null and not app.is_customer()
$$;
revoke all on function camp.pi_allowed() from public, anon;
grant execute on function camp.pi_allowed() to authenticated;
