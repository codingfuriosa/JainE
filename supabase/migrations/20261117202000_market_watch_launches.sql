-- MARKET WATCH: COMPETITOR LAUNCHES (17 Nov 2026, Ayush).
-- Which of the 18 listed competitors opened a new project to customers in the last 60 days. A project counts as
-- launched once customers are being invited in: EOI / pre-launch registration, bookings open, site visits offered,
-- sales office / experience centre / sample flat open, or a launch event with buyer offers. RERA registration and
-- the first ad date are never used. Every launch keeps its evidence (link + the exact sentence); the market-watch
-- edge function only writes what a fetched page or article actually says (the quote is checked against the text).
-- Applied by the one-time cron mw_setup_once at 20:20 IST (no DDL in office hours on the Micro tier).

create table if not exists camp.mw_developers (
  id              serial primary key,
  name            text not null unique,
  website         text,
  projects_urls   text[] not null default '{}',
  sitemap         text,
  news_query      text,               -- the news search; default '"<name>" Kolkata'
  active          boolean not null default true,
  sort            int not null default 0,
  baseline_at     timestamptz,        -- first full look (60-day sweep) done
  last_checked_at timestamptz,
  last_error      text
);

-- every link seen on a developer's own project pages, so a NEW project page shows up the day it appears
create table if not exists camp.mw_site_links (
  developer_id  int not null references camp.mw_developers(id) on delete cascade,
  url           text not null,
  label         text,
  first_seen    date not null default (now() at time zone 'Asia/Kolkata')::date,
  is_project    boolean,
  archive_first date,                 -- first copy saved by web.archive.org (used on the first sweep only)
  primary key (developer_id, url)
);

-- every news item already read, so each is judged once
create table if not exists camp.mw_news_seen (
  key           text primary key,
  developer_id  int references camp.mw_developers(id) on delete cascade,
  url           text,
  title         text,
  source        text,
  published     date,
  verdict       jsonb,
  seen_at       timestamptz not null default now()
);

create table if not exists camp.mw_launches (
  id            bigserial primary key,
  developer_id  int not null references camp.mw_developers(id) on delete cascade,
  project       text not null,
  project_key   text not null,
  locality      text,
  stage         text,                -- eoi | site_visits | sales_office | launch_event | bookings
  launch_date   date,                -- the first day a source shows customers being invited in
  auto_status   text not null default 'needs_check' check (auto_status in ('confirmed','needs_check')),
  status        text not null default 'needs_check' check (status in ('confirmed','needs_check','rejected')),
  decided_by    text,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (developer_id, project_key)
);

create table if not exists camp.mw_evidence (
  id          bigserial primary key,
  launch_id   bigint not null references camp.mw_launches(id) on delete cascade,
  kind        text not null check (kind in ('website','archive','news')),
  url         text not null,
  source      text,
  title       text,
  published   date,
  quote       text not null,
  stage       text,
  created_at  timestamptz not null default now(),
  unique (launch_id, url)
);

create table if not exists camp.mw_runs (
  id            bigserial primary key,
  run_at        timestamptz not null default now(),
  developer_id  int references camp.mw_developers(id) on delete cascade,
  baseline      boolean not null default false,
  links_new     int not null default 0,
  news_new      int not null default 0,
  found         int not null default 0,
  note          text,
  error         text
);
create index if not exists mw_runs_at on camp.mw_runs (run_at desc);

-- who may see it: the Market Watch module (super admins included, as everywhere)
create or replace function camp.mw_can() returns boolean
language sql stable security definer set search_path to '' as $$
  select auth.uid() is not null and not app.is_customer() and app.has_module('market_watch')
$$;
revoke all on function camp.mw_can() from public, anon;
grant execute on function camp.mw_can() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['mw_developers','mw_site_links','mw_news_seen','mw_launches','mw_evidence','mw_runs'] loop
    execute format('alter table camp.%I enable row level security', t);
    execute format('drop policy if exists "market watch read" on camp.%I', t);
    execute format('create policy "market watch read" on camp.%I for select to authenticated using (camp.mw_can())', t);
    execute format('revoke all on camp.%I from anon', t);
    execute format('grant select on camp.%I to authenticated', t);
    execute format('grant all on camp.%I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema camp to service_role;

-- Confirm / Reject / back to automatic, by anyone with the module
create or replace function camp.mw_decide(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path to '' as $$
begin
  if not camp.mw_can() then raise exception 'not allowed'; end if;
  if p_status not in ('confirmed','rejected','auto') then raise exception 'bad status'; end if;
  update camp.mw_launches
     set status     = case when p_status = 'auto' then auto_status else p_status end,
         decided_by = case when p_status = 'auto' then null else app.current_user_email() end,
         decided_at = case when p_status = 'auto' then null else now() end,
         updated_at = now()
   where id = p_id;
end $$;
revoke all on function camp.mw_decide(bigint, text) from public, anon;
grant execute on function camp.mw_decide(bigint, text) to authenticated;

alter table camp.mw_developers add column if not exists link_filter text;   -- only links matching this (regex) are watched

-- THE 18 DEVELOPERS (Ayush's list, 17 Nov 2026; Eden Group and Eden Realty are two different developers). Sites checked
-- by hand that day. The home page is watched too: new launches usually appear there first. Where a site builds its
-- list in the browser (Godrej, Eden Realty) the sitemap is read instead; Gems Group's site did not answer (news only
-- until it does).
insert into camp.mw_developers (sort, name, website, projects_urls, sitemap, link_filter, news_query) values
 ( 1,'DTC Group','https://dtcgroup.in/','{https://dtcgroup.in/projects/,https://dtcgroup.in/}',null,null,'"DTC Group" Kolkata'),
 ( 2,'Siddha Group','https://www.siddhagroup.com/','{https://www.siddhagroup.com/our-project.php?city=kolkata,https://www.siddhagroup.com/}',null,null,'"Siddha Group"'),
 ( 3,'Srijan Realty','https://www.srijanrealty.com/','{https://www.srijanrealty.com/status/under-construction/,https://www.srijanrealty.com/projects/,https://www.srijanrealty.com/}',null,null,'"Srijan Realty"'),
 ( 4,'Diamond Group','https://www.diamondgroupweb.com/','{https://www.diamondgroupweb.com/projects,https://www.diamondgroupweb.com/}',null,null,'"Diamond Group" Kolkata real estate'),
 ( 5,'Merlin Group','https://merlinprojects.com/','{https://merlinprojects.com/,https://merlinprojects.com/projects/}',null,null,'"Merlin Group" real estate'),
 ( 6,'Eden Group','https://edengroup.in/','{https://edengroup.in/projects,https://edengroup.in/}',null,null,'"Eden Group" Kolkata'),
 ( 7,'Eden Realty','https://www.edenrealtygroup.com/','{https://www.edenrealtygroup.com/}','https://www.edenrealtygroup.com/sitemap.xml',null,'"Eden Realty" Kolkata'),
 ( 8,'Ambuja Neotia','https://www.ambujaneotia.com/','{https://www.ambujaneotia.com/our-business/real-estate,https://www.ambujaneotia.com/}',null,'/our-business/real-estate/','"Ambuja Neotia"'),
 ( 9,'Alcove Realty','https://alcoverealty.in/','{https://alcoverealty.in/residential-commercial-projects,https://alcoverealty.in/}',null,null,'"Alcove Realty"'),
 (10,'Godrej Properties','https://www.godrejproperties.com/','{https://www.godrejproperties.com/under-construction-projects-in-kolkata}','https://www.godrejproperties.com/property-sitemap.xml','/residential/','"Godrej Properties" launch'),
 (11,'Mani Group','https://mani-group.com/','{https://mani-group.com/residential,https://mani-group.com/}',null,null,'"Mani Group" Kolkata'),
 (12,'Vinayak Group','https://vinayakgroup.org/','{https://vinayakgroup.org/ongoing-projects,https://vinayakgroup.org/}',null,null,'"Vinayak Group" Kolkata'),
 (13,'Unimark Group','https://unimarkgroup.com/','{https://unimarkgroup.com/projects.html,https://unimarkgroup.com/}',null,null,'"Unimark Group"'),
 (14,'Emami Realty','https://emamirealty.com/','{https://emamirealty.com/projects/,https://emamirealty.com/}',null,null,'"Emami Realty"'),
 (15,'Sugam Homes','https://sugamhomes.com/','{https://sugamhomes.com/project,https://sugamhomes.com/}',null,null,'"Sugam Homes"'),
 (16,'Primarc Group','https://primarc.in/','{https://primarc.in/projects,https://primarc.in/}',null,null,'"Primarc" Kolkata'),
 (17,'Orbit Group','https://orbitgroup.net/','{https://orbitgroup.net/ongoing-projects/,https://orbitgroup.net/}',null,null,'"Orbit Group" Kolkata'),
 (18,'Gems Group','https://gemscity.in/','{https://gemscity.in/}',null,null,'"Gems Group" Kolkata')
on conflict (name) do nothing;

-- the job's secret (the cron sends it as x-mw-secret)
insert into acc.job_secrets (name, value) values ('market_watch', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

-- EVERY MORNING 06:30-08:20 IST, every 10 minutes: each call checks the developers not yet checked today (about one to
-- three per call), so all 18 are done by about 08:00. Calls after that find nothing due and stop at once.
select cron.schedule('mw_daily', '*/10 1-2 * * *', $c$
  select net.http_post(url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/market-watch',
    headers := jsonb_build_object('Content-Type','application/json','x-mw-secret',(select value from acc.job_secrets where name='market_watch')),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
$c$);

-- THE FIRST SWEEP (the last 60 days), tonight 17 Nov from 20:30 IST every 5 minutes; it removes itself once every
-- developer has had its first look.
select cron.schedule('mw_first_sweep', '*/5 15-17 17 11 *', $c$
  select case when not exists (select 1 from camp.mw_developers where active and baseline_at is null)
    then cron.unschedule('mw_first_sweep') end;
  select net.http_post(url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/market-watch',
    headers := jsonb_build_object('Content-Type','application/json','x-mw-secret',(select value from acc.job_secrets where name='market_watch')),
    body := '{}'::jsonb, timeout_milliseconds := 150000)
  where exists (select 1 from camp.mw_developers where active and baseline_at is null);
$c$);

notify pgrst, 'reload schema';
