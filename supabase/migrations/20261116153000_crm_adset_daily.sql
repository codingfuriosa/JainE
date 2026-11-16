-- CRM (RealtyBucket) figures per ad set / ad group and per ad / creative (16 Nov 2026, Ayush: the CRM API now
-- breaks campaigns down; "Now" - applied in the afternoon at his word). Filled by ads-daily-sync {crm} alongside
-- camp.crm_google_daily (campaign level). src 'facebook' | 'google'; level 'adset' (Facebook ad set / Google ad group)
-- or 'ad' (Facebook ad / Google creative); ad_id '' on adset rows.
create table if not exists camp.crm_adset_daily (
  day          date not null,
  src          text not null,
  level        text not null,
  campaign_id  text not null,
  adset_id     text not null,
  ad_id        text not null default '',
  name         text,
  cost         numeric,
  leads        integer,
  qualified    integer,
  site_visited integer,
  booked       integer,
  lost         integer,
  fetched_at   timestamptz,
  primary key (day, src, level, adset_id, ad_id)
);
alter table camp.crm_adset_daily enable row level security;
drop policy if exists crm_adset_daily_read on camp.crm_adset_daily;
create policy crm_adset_daily_read on camp.crm_adset_daily for select to authenticated using (not app.is_customer());
grant select on camp.crm_adset_daily to authenticated;
grant all on camp.crm_adset_daily to service_role;
notify pgrst, 'reload schema';
