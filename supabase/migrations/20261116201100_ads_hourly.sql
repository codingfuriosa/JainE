-- LEADS BY HOUR OF DAY (16 Nov 2026, Ayush: "Build all four" - Best hours). Totals per campaign and hour of day over the
-- last 28 days, replaced whole each run by ads-daily-sync {platform, hourly:{days:28}}. Read by the Analytics tab's Best
-- hours card. Applied by the one-time cron ads_hourly_ddl_once (16 Nov 2026 20:11 IST); first filled 20:45 / 20:48 IST,
-- then nightly 01:15 (Google) and 01:20 (Facebook) IST.
create table if not exists camp.ads_hourly (
  platform     text not null,
  account_id   text not null,
  campaign_id  text not null,
  hour         int  not null,
  period_end   date,
  days         int,
  spend        numeric,
  impressions  bigint,
  clicks       bigint,
  leads        numeric,
  primary key (platform, account_id, campaign_id, hour)
);
alter table camp.ads_hourly enable row level security;
drop policy if exists ads_hourly_read on camp.ads_hourly;
create policy ads_hourly_read on camp.ads_hourly for select to authenticated using (not app.is_customer());
grant select on camp.ads_hourly to authenticated;
grant all on camp.ads_hourly to service_role;
notify pgrst, 'reload schema';
