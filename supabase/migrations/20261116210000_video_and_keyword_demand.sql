-- Hook / hold rates and buyer demand (16 Nov 2026, Ayush: "Build all three"). Applied after 20:00 IST by a one-time cron.
-- Facebook video plays per ad and day (ads-daily-sync fbRead, hasVideo): 3-second views, plays to 25/50/100%, ThruPlays.
alter table camp.ads_ad_daily add column if not exists video_3s bigint;
alter table camp.ads_ad_daily add column if not exists video_p25 bigint;
alter table camp.ads_ad_daily add column if not exists video_p50 bigint;
alter table camp.ads_ad_daily add column if not exists video_p100 bigint;
alter table camp.ads_ad_daily add column if not exists video_thruplay bigint;
-- Google Keyword Planner monthly searches from Kolkata (ads-daily-sync {platform:'google', keywords:{}}).
create table if not exists camp.kw_monthly (
  keyword     text not null,
  grp         text,
  month       date not null,
  searches    integer,
  avg_monthly integer,
  competition text,
  low_bid     numeric,
  high_bid    numeric,
  fetched_at  timestamptz,
  primary key (keyword, month)
);
alter table camp.kw_monthly enable row level security;
drop policy if exists kw_monthly_read on camp.kw_monthly;
create policy kw_monthly_read on camp.kw_monthly for select to authenticated using (not app.is_customer());
grant select on camp.kw_monthly to authenticated;
grant all on camp.kw_monthly to service_role;
notify pgrst, 'reload schema';
