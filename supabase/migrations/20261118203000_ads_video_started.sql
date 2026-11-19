-- FACEBOOK ADS TAB METRICS (18 Nov 2026, Ayush: ThumbStop %, 25 / 50 / 75 / 100% plays per ad; Started / Last Run were dropped the same day).
-- Per ad and day: video plays started, 3-second plays, plays watched to 25 / 50 / 75 / 100% (ads-daily-sync writes them
-- once these columns exist), and ads_ad_totals_v5 = v4 plus those sums and the first / last day the ad ran in the period.
alter table camp.ads_ad_daily
  add column if not exists v_plays numeric, add column if not exists v_3s numeric,
  add column if not exists v_p25 numeric, add column if not exists v_p50 numeric,
  add column if not exists v_p75 numeric, add column if not exists v_p100 numeric;

create or replace function camp.ads_ad_totals_v5(p_platform text, p_from date, p_to date, p_limit integer default 5000)
returns table(ad_id text, account_id text, campaign_id text, adset_id text, spend numeric, impressions bigint, clicks bigint,
              results numeric, form_leads numeric, v_plays numeric, v_3s numeric, v_p25 numeric, v_p50 numeric, v_p75 numeric,
              v_p100 numeric, first_day date, last_day date)
language sql stable set search_path to ''
as $$
  select d.ad_id, d.account_id, d.campaign_id, nullif(d.adset_id, ''), sum(d.spend), sum(d.impressions)::bigint, sum(d.clicks)::bigint,
         sum(d.results), sum(d.form_leads), sum(d.v_plays), sum(d.v_3s), sum(d.v_p25), sum(d.v_p50), sum(d.v_p75), sum(d.v_p100),
         min(d.day) filter (where d.spend > 0 or d.impressions > 0), max(d.day) filter (where d.spend > 0 or d.impressions > 0)
    from camp.ads_ad_daily d
    join camp.ads_accounts a on a.platform = d.platform and a.account_id = d.account_id and a.include
   where d.platform = p_platform and d.day between p_from and p_to
   group by d.ad_id, d.account_id, d.campaign_id, d.adset_id having sum(d.spend) > 0 or sum(d.impressions) > 0
   order by 5 desc limit p_limit
$$;
revoke all on function camp.ads_ad_totals_v5(text, date, date, integer) from public, anon;
grant execute on function camp.ads_ad_totals_v5(text, date, date, integer) to authenticated, service_role;


notify pgrst, 'reload schema';
