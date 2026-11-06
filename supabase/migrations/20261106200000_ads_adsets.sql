-- AD SETS / AD GROUPS FOR CAMPAIGN ANALYTICS (6 Nov 2026, asked by Ayush).
-- Campaign Analytics drills down project > Google / Facebook > campaign > ad set (Facebook) or ad group
-- (Google), the lowest level. ads-daily-sync (deployed the same day) sends each ad's ad set and the ad sets'
-- names as soon as this is in; before it, it leaves them out (see hasAdset there).
--   ads_ad_daily.adset_id  - the ad set / ad group the ad ran in that day
--   ads_entities kind 'adset' - their names, status and budgets
--   ads_ad_totals_v2       - ads_ad_totals with the ad set; ads_ad_totals stays as it is for the old views
-- Run after 20:00 IST (no schema changes in office hours).

alter table camp.ads_ad_daily add column if not exists adset_id text;
create index if not exists ads_ad_daily_adset_idx on camp.ads_ad_daily (platform, adset_id);

alter table camp.ads_entities drop constraint if exists ads_entities_kind_check;
alter table camp.ads_entities add constraint ads_entities_kind_check check (kind in ('campaign', 'adset', 'ad'));

create or replace function camp.ads_ad_totals_v2(p_platform text, p_from date, p_to date, p_limit integer default 5000)
returns table(ad_id text, account_id text, campaign_id text, adset_id text, spend numeric, impressions bigint, clicks bigint, results numeric)
language sql stable set search_path to ''
as $function$
  select d.ad_id, d.account_id, max(d.campaign_id), max(d.adset_id), sum(d.spend), sum(d.impressions)::bigint, sum(d.clicks)::bigint, sum(d.results)
    from camp.ads_ad_daily d
    join camp.ads_accounts a on a.platform = d.platform and a.account_id = d.account_id and a.include
   where d.platform = p_platform and d.day between p_from and p_to
   group by 1, 2 having sum(d.spend) > 0 or sum(d.impressions) > 0
   order by 5 desc limit p_limit
$function$;
grant execute on function camp.ads_ad_totals_v2(text, date, date, integer) to authenticated;
