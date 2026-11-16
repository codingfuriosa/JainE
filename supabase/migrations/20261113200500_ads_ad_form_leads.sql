-- Google form leads per ad (13 Nov 2026, Ayush: Form leads kept and renamed Leads, Google's Conversions removed).
-- Campaign rows already carry form_leads (20261111200500); ad groups and ads are built from ads_ad_daily, so it needs the
-- same figure per ad and day. Filled by ads-daily-sync; null until the day is read again after this column exists.
alter table camp.ads_ad_daily add column if not exists form_leads numeric;

create or replace function camp.ads_ad_totals_v3(p_platform text, p_from date, p_to date, p_limit integer default 5000)
returns table(ad_id text, account_id text, campaign_id text, adset_id text, spend numeric, impressions bigint, clicks bigint, results numeric, form_leads numeric)
language sql stable set search_path to ''
as $function$
  select d.ad_id, d.account_id, max(d.campaign_id), max(d.adset_id), sum(d.spend), sum(d.impressions)::bigint, sum(d.clicks)::bigint, sum(d.results), sum(d.form_leads)
    from camp.ads_ad_daily d
    join camp.ads_accounts a on a.platform = d.platform and a.account_id = d.account_id and a.include
   where d.platform = p_platform and d.day between p_from and p_to
   group by 1, 2 having sum(d.spend) > 0 or sum(d.impressions) > 0
   order by 5 desc limit p_limit
$function$;
grant execute on function camp.ads_ad_totals_v3(text, date, date, integer) to authenticated;
notify pgrst, 'reload schema';
