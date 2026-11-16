-- Google form leads beside Google's Conversions (11 Nov 2026, Ayush: "show both").
-- A Google campaign's Conversions are whatever it is set to optimise for: Dream World City's Demand Gen goes for
-- "Offline Google Sheet QL Leads", so its Conversions were 22.5 (qualified leads) while Google counted 118 website
-- form submits in the same days. form_leads holds those submissions per campaign and day (ads-daily-sync, Google only;
-- null until the day is read again after this column exists).
alter table camp.ads_daily add column if not exists form_leads numeric;

-- ads_campaign_totals plus form_leads; the old function stays for anything still calling it.
create or replace function camp.ads_campaign_totals_v2(p_platform text, p_from date, p_to date)
returns table(account_id text, campaign_id text, spend numeric, impressions bigint, clicks bigint, results numeric, form_leads numeric, days integer)
language sql stable set search_path to ''
as $function$
  select d.account_id, d.campaign_id, sum(d.spend), sum(d.impressions)::bigint, sum(d.clicks)::bigint, sum(d.results), sum(d.form_leads), count(*)::int
    from camp.ads_daily d
    join camp.ads_accounts a on a.platform = d.platform and a.account_id = d.account_id and a.include
   where d.platform = p_platform and d.day between p_from and p_to
   group by 1, 2
$function$;
grant execute on function camp.ads_campaign_totals_v2(text, date, date) to authenticated;
notify pgrst, 'reload schema';
