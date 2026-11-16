-- ONE ROW PER AD PER AD SET / AD GROUP (16 Nov 2026, Ayush: "Why isn't there data for Google in ad sets").
-- camp.ads_ad_daily was keyed (platform, ad_id, day), so an ad copied into a second Google campaign had both
-- campaigns' figures added onto one row filed under the first campaign (Gurukul "Madhyamgram Search Max Click"
-- showed no ad groups; "Madhyamgram Search" showed its spend too). Now each ad group keeps its own row.
-- adset_id is '' where there is none (older Facebook rows from before 6 Nov 2026). ads-daily-sync writes with the
-- new key as soon as it exists and the old way until then. Applied by the one-time cron ads_adgroup_key_once
-- (16 Nov 2026 20:05 IST, after office hours), followed by a re-read of Google's ad history.
update camp.ads_ad_daily set adset_id = '' where adset_id is null;
alter table camp.ads_ad_daily alter column adset_id set default '';
alter table camp.ads_ad_daily alter column adset_id set not null;
alter table camp.ads_ad_daily drop constraint ads_ad_daily_pkey;
alter table camp.ads_ad_daily add primary key (platform, ad_id, adset_id, day);

-- Campaign Analytics: each ad's figures per campaign and ad group (v3 added an ad's ad groups together and took
-- one campaign for it).
create or replace function camp.ads_ad_totals_v4(p_platform text, p_from date, p_to date, p_limit integer default 5000)
returns table(ad_id text, account_id text, campaign_id text, adset_id text, spend numeric, impressions bigint, clicks bigint, results numeric, form_leads numeric)
language sql stable set search_path to ''
as $$
  select d.ad_id, d.account_id, d.campaign_id, nullif(d.adset_id, ''), sum(d.spend), sum(d.impressions)::bigint, sum(d.clicks)::bigint, sum(d.results), sum(d.form_leads)
    from camp.ads_ad_daily d
    join camp.ads_accounts a on a.platform = d.platform and a.account_id = d.account_id and a.include
   where d.platform = p_platform and d.day between p_from and p_to
   group by d.ad_id, d.account_id, d.campaign_id, d.adset_id having sum(d.spend) > 0 or sum(d.impressions) > 0
   order by 5 desc limit p_limit
$$;
revoke all on function camp.ads_ad_totals_v4(text, date, date, integer) from public, anon;
grant execute on function camp.ads_ad_totals_v4(text, date, date, integer) to authenticated, service_role;

-- re-read Google's ad history so every day is stored per ad group (the 3-hourly sync and tonight's kicks walk it back)
update camp.ads_accounts set backfilled_from = null where platform = 'google';
notify pgrst, 'reload schema';
