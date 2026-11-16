-- CRM (RealtyBucket) Google leads by day, for Campaign Analytics (10 Nov 2026, Ayush).
-- Google's conversions are what the ad platform counted; the CRM counts the leads left after its own filtering
-- and how far they got. Filled by ads-daily-sync {crm:{...}} one day at a time (the CRM's days add up exactly),
-- read by the page for any period. One row per day, project (business unit), campaign type and Google campaign
-- id ('' for leads the CRM could not tie to a campaign, 'Call' for calls).
create table if not exists camp.crm_google_daily (
  day           date    not null,
  bu_id         integer not null,
  business_unit text    not null,
  campaign_type text    not null default '',
  campaign_id   text    not null default '',
  campaign      text,
  cost          numeric not null default 0,
  leads         integer not null default 0,
  qualified     integer not null default 0,
  site_visited  integer not null default 0,
  booked        integer not null default 0,
  lost          integer not null default 0,
  fetched_at    timestamptz not null default now(),
  primary key (day, bu_id, campaign_type, campaign_id)
);
alter table camp.crm_google_daily enable row level security;
drop policy if exists crm_google_daily_read on camp.crm_google_daily;
create policy crm_google_daily_read on camp.crm_google_daily for select to authenticated using (true);
grant select on camp.crm_google_daily to authenticated;
grant all on camp.crm_google_daily to service_role;
