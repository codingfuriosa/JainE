-- LEAD MAP (30 Oct 2026) - where our Site Visit and Booked customers come from, by PIN code, month by
-- month, as red pins on a map. Its own module ('lead_map'), not part of the marketing pages.
--
--   camp.lm_pins       one row per Site Visit or Booking the CRM reports (or one somebody types in):
--                      project, Site Visit / Booked, PIN code, date. Nothing else about the person -
--                      no name, no phone - is ever stored here.
--   camp.lm_pincodes   where each PIN code is on the map (looked up once and kept). A PIN code is an
--                      area, so its pin sits at the CENTRE of that area, not at anybody's address.
--
-- Filled by the digital-metrics-sync worker (actions lead_map_sync / lead_map_geocode): from the CRM
-- every morning and evening once its API address is set as a Supabase secret, and straight away for
-- PIN codes typed in on the page.

create or replace function camp.lm_allowed() returns boolean
language sql stable security definer set search_path to '' as $$
  select not app.is_customer() and app.has_module('lead_map')
$$;
grant execute on function camp.lm_allowed() to authenticated;

create table if not exists camp.lm_pins (
  id          bigserial primary key,
  project     text check (project in ('Dream Ananta','Dream Gurukul','Dream World City')),
  kind        text not null check (kind in ('site_visit','booked','test')),
  pincode     text not null check (pincode ~ '^[1-9][0-9]{5}$'),
  event_date  date not null,
  source      text not null default 'manual' check (source in ('crm','manual')),
  crm_ref     text unique,                 -- the CRM's own id for the visit / booking, so a re-read never doubles it
  added_by    text,
  created_at  timestamptz not null default now()
);
create index if not exists lm_pins_date on camp.lm_pins(event_date);
create index if not exists lm_pins_pin on camp.lm_pins(pincode);

create table if not exists camp.lm_pincodes (
  pincode      text primary key check (pincode ~ '^[1-9][0-9]{5}$'),
  lat          double precision,
  lng          double precision,
  place        text,                       -- post office / area names India Post gives for the PIN
  district     text,
  state        text,
  coord_source text,                       -- google | openstreetmap | openstreetmap-area
  looked_up_at timestamptz,
  lookup_error text
);

alter table camp.lm_pins enable row level security;
alter table camp.lm_pincodes enable row level security;
drop policy if exists lm_read on camp.lm_pins;
create policy lm_read on camp.lm_pins for select to authenticated using ((select camp.lm_allowed()));
drop policy if exists lm_read on camp.lm_pincodes;
create policy lm_read on camp.lm_pincodes for select to authenticated using ((select camp.lm_allowed()));
-- People may type PIN codes in, and take back only what was typed in - never what came from the CRM.
drop policy if exists lm_add on camp.lm_pins;
create policy lm_add on camp.lm_pins for insert to authenticated with check ((select camp.lm_allowed()) and source = 'manual' and crm_ref is null);
drop policy if exists lm_del on camp.lm_pins;
create policy lm_del on camp.lm_pins for delete to authenticated using ((select camp.lm_allowed()) and source = 'manual');
grant select, insert, delete on camp.lm_pins to authenticated;
grant usage, select on sequence camp.lm_pins_id_seq to authenticated;
grant select on camp.lm_pincodes to authenticated;
grant all on camp.lm_pins, camp.lm_pincodes to service_role;
grant usage, select on sequence camp.lm_pins_id_seq to service_role;

-- One month on the map: a row per PIN code, project and kind, with how many. Counted here from the
-- stored rows, so the page shows exact counts and never pages through individual visits.
create or replace function camp.lm_month(p_month date)
returns table(pincode text, project text, kind text, n bigint, lat double precision, lng double precision,
              place text, district text, state text, lookup_error text)
language sql stable set search_path to '' as $$
  select p.pincode, p.project, p.kind, count(*), c.lat, c.lng, c.place, c.district, c.state, c.lookup_error
    from camp.lm_pins p left join camp.lm_pincodes c on c.pincode = p.pincode
   where p.event_date >= date_trunc('month', p_month)::date
     and p.event_date <  (date_trunc('month', p_month) + interval '1 month')::date
   group by p.pincode, p.project, p.kind, c.lat, c.lng, c.place, c.district, c.state, c.lookup_error
   order by count(*) desc
$$;
grant execute on function camp.lm_month(date) to authenticated;

-- Twice a day: 06:00 and 21:00 IST. Same job secret as Digital Metrics.
create or replace function camp.lm_kick() returns bigint
language sql security definer set search_path to '' as $$
  select net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/digital-metrics-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n',
      'x-dm-secret',(select value from acc.job_secrets where name='digital_metrics')),
    body := '{"action":"lead_map_sync"}'::jsonb,
    timeout_milliseconds := 150000)
$$;
revoke all on function camp.lm_kick() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'lead-map-sync';
select cron.schedule('lead-map-sync', '30 0,15 * * *', $cron$ select camp.lm_kick(); $cron$);
