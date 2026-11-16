-- DATA FOR MARKETING ANALYTICS (16 Nov 2026, Ayush: "can we pull the data we are missing").
-- 1. Facebook reach and frequency per campaign / ad and day (creative fatigue), filled by ads-daily-sync.
-- 2. Google Search impression share and the share lost to budget / to ad rank per campaign and day (which campaigns
--    could take more money), filled by ads-daily-sync.
-- 3. A daily record of every campaign's and ad set's status and budget (until now only today's was kept, so no model
--    could tell how leads respond to budget changes). Taken every night at 23:50 IST from camp.ads_entities.
-- Applied by the one-time cron mkt_analytics_ddl_once (16 Nov 2026 20:07 IST, after office hours).
alter table camp.ads_daily add column if not exists reach bigint;
alter table camp.ads_daily add column if not exists frequency numeric;
alter table camp.ads_daily add column if not exists imp_share numeric;
alter table camp.ads_daily add column if not exists budget_lost_is numeric;
alter table camp.ads_daily add column if not exists rank_lost_is numeric;
alter table camp.ads_ad_daily add column if not exists reach bigint;
alter table camp.ads_ad_daily add column if not exists frequency numeric;

create table if not exists camp.ads_budget_daily (
  day             date not null,
  platform        text not null,
  kind            text not null,
  id              text not null,
  account_id      text,
  campaign_id     text,
  status          text,
  daily_budget    numeric,
  lifetime_budget numeric,
  primary key (day, platform, kind, id)
);
alter table camp.ads_budget_daily enable row level security;
drop policy if exists ads_budget_daily_read on camp.ads_budget_daily;
create policy ads_budget_daily_read on camp.ads_budget_daily for select to authenticated using (not app.is_customer());
grant select on camp.ads_budget_daily to authenticated;
grant all on camp.ads_budget_daily to service_role;

create or replace function camp.ads_budget_snapshot() returns integer
language sql security definer set search_path to ''
as $$
  with ins as (
    insert into camp.ads_budget_daily (day, platform, kind, id, account_id, campaign_id, status, daily_budget, lifetime_budget)
    select (now() at time zone 'Asia/Kolkata')::date, e.platform, e.kind, e.id, e.account_id, e.campaign_id, e.status, e.daily_budget, e.lifetime_budget
      from camp.ads_entities e where e.kind in ('campaign', 'adset')
    on conflict (day, platform, kind, id) do update set status = excluded.status, daily_budget = excluded.daily_budget, lifetime_budget = excluded.lifetime_budget
    returning 1)
  select count(*)::int from ins
$$;
revoke all on function camp.ads_budget_snapshot() from public, anon, authenticated;

select camp.ads_budget_snapshot();
select cron.unschedule('ads-budget-snapshot') where exists (select 1 from cron.job where jobname = 'ads-budget-snapshot');
select cron.schedule('ads-budget-snapshot', '20 18 * * *', 'select camp.ads_budget_snapshot();');
notify pgrst, 'reload schema';
