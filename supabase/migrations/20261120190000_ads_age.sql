-- GOOGLE RESULTS BY AGE (20 Nov 2026, Ayush: "Get Age from Google, if we don't pull it then start pulling it now" - the Google
-- checklist's Age point). Totals per campaign and age range over the last 28 days, replaced whole each run by ads-daily-sync
-- {platform:'google', age:{days:28}}. Apply after 20:00 IST (no schema changes in office hours): the one-time cron ads_age_ddl_once
-- (20 Nov 2026 20:05 IST) creates the table and the nightly cron (01:25 IST); ads_age_fill_once (20:12 IST) fills it the first time.
create table if not exists camp.ads_age (
  platform     text not null default 'google',
  account_id   text not null,
  campaign_id  text not null,
  age_range    text not null,      -- 18_24, 25_34, 35_44, 45_54, 55_64, 65_UP, UNDETERMINED
  period_end   date,
  days         int,
  spend        numeric,
  impressions  bigint,
  clicks       bigint,
  leads        numeric,            -- always null: Google does not allow lead-form conversions to be split by age on this view
  primary key (platform, account_id, campaign_id, age_range)
);
alter table camp.ads_age enable row level security;
drop policy if exists ads_age_read on camp.ads_age;
create policy ads_age_read on camp.ads_age for select to authenticated using (not app.is_customer());
grant select on camp.ads_age to authenticated;
grant all on camp.ads_age to service_role;
notify pgrst, 'reload schema';

-- nightly 01:25 IST (19:55 UTC)
select cron.unschedule(jobid) from cron.job where jobname = 'ads-age-google';
select cron.schedule('ads-age-google', '55 19 * * *', $cron$select net.http_post(url:='https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/ads-daily-sync',
  headers:=jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n','x-ads-secret',(select value from acc.job_secrets where name='ads_daily')),
  body:='{"platform":"google","age":{"days":28}}'::jsonb, timeout_milliseconds:=140000);$cron$);
