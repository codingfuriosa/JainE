-- GOOGLE SPEND BY PIN CODE (16 Nov 2026, Ayush: "make all"). Monthly totals per Google campaign and postal code, from
-- ads-daily-sync {platform:'google', geo:{months:N}} (geographic_view). Read by the Analytics tab's Geography card to put
-- Google spend against Lead Map site visits by PIN code. Applied by the one-time cron ads_geo_ddl_once (16 Nov 2026
-- 20:09 IST); filled by ads_geo_backfill_once (20:30 IST, 3 months) and nightly by ads-geo-nightly (01:00 IST, 2 months).
create table if not exists camp.ads_geo_monthly (
  account_id   text not null,
  campaign_id  text not null,
  month        date not null,
  geo_id       text not null,
  postal_code  text,
  spend        numeric,
  impressions  bigint,
  clicks       bigint,
  conversions  numeric,
  primary key (account_id, campaign_id, month, geo_id)
);
create index if not exists ads_geo_monthly_pin on camp.ads_geo_monthly (postal_code, month);
alter table camp.ads_geo_monthly enable row level security;
drop policy if exists ads_geo_monthly_read on camp.ads_geo_monthly;
create policy ads_geo_monthly_read on camp.ads_geo_monthly for select to authenticated using (not app.is_customer());
grant select on camp.ads_geo_monthly to authenticated;
grant all on camp.ads_geo_monthly to service_role;
notify pgrst, 'reload schema';
