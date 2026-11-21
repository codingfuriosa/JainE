-- GOOGLE KEYWORD QUALITY (21 Nov 2026, Ayush: Landing Page Experience, Ad Relevance, Expected CTR not Below Average; Quality Score
-- not below 5 - the Google checklist's weekly "Keyword quality" point). Every enabled keyword of the enabled ad groups and campaigns
-- with Google's quality_info, replaced whole each night by ads-daily-sync {platform:'google', quality:{}}.
create table if not exists camp.ads_kw_quality (
  platform      text not null default 'google',
  account_id    text not null,
  campaign_id   text not null,
  campaign_name text,
  ad_group_id   text not null,
  ad_group_name text,
  keyword_id    text not null,
  keyword       text,
  match_type    text,
  quality_score int,
  ad_relevance  text,   -- ABOVE_AVERAGE / AVERAGE / BELOW_AVERAGE, null = no value
  landing_page  text,
  expected_ctr  text,
  read_at       timestamptz not null default now(),
  primary key (platform, ad_group_id, keyword_id)
);
alter table camp.ads_kw_quality enable row level security;
drop policy if exists ads_kw_quality_read on camp.ads_kw_quality;
create policy ads_kw_quality_read on camp.ads_kw_quality for select to authenticated using (true);
grant select on camp.ads_kw_quality to authenticated;
grant all on camp.ads_kw_quality to service_role;

-- every night 01:00 IST, before Monday's weekly checklist (01:15 IST)
select cron.unschedule(jobid) from cron.job where jobname = 'ads-kw-quality-google';
select cron.schedule('ads-kw-quality-google', '30 19 * * *', $c$select net.http_post(url:='https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/ads-daily-sync',
  headers:=jsonb_build_object('Content-Type','application/json','x-ads-secret',(select value from acc.job_secrets where name='ads_daily')),
  body:='{"platform":"google","quality":{}}'::jsonb, timeout_milliseconds:=150000)$c$);
