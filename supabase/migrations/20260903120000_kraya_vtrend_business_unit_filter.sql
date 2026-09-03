/* Vendor Trend Analysis: multi-business-unit filter.

   The dummy dataset (20260902110000) had only one implicit "business unit". Real Farvision PO
   register exports carry a Business Unit column per line item (a vendor can supply several units),
   so the dimension is added on kraya.vtrend_purchases, not on the vendor master. Every report RPC
   gets an optional p_business_units text[] filter (null/default = all units, matching today's
   behaviour so existing callers that pass no args keep working) plus a new RPC that lists the
   distinct units for the filter widget itself.

   Postgres treats a changed argument list as a different function, so the old zero-arg versions
   are dropped explicitly before recreating under the new signature - CREATE OR REPLACE alone
   would just add an overload and leave the old one live. */

drop function if exists kraya.vtrend_asof();
drop function if exists kraya.vtrend_overview();
drop function if exists kraya.vtrend_monthly();
drop function if exists kraya.vtrend_category_monthly();
drop function if exists kraya.vtrend_vendor_summary();
drop function if exists kraya.vtrend_anomalies();
drop function if exists kraya.vtrend_vendor_monthly_all();

alter table kraya.vtrend_purchases add column if not exists business_unit text;
create index if not exists vtrend_purchases_bu_idx on kraya.vtrend_purchases(business_unit);

-- archetype was only ever read by the dummy-data generator, never by the RPCs (see 20260902110000)
-- - real imported vendors have no archetype, so it can no longer be required.
alter table kraya.vtrend_vendors alter column archetype drop not null;

create or replace function kraya.vtrend_asof(p_business_units text[] default null)
 returns date language sql stable
 set search_path to 'kraya', 'public'
as $$
  select coalesce(max(purchase_date), current_date) from kraya.vtrend_purchases
   where p_business_units is null or business_unit = any(p_business_units);
$$;

create or replace function kraya.vtrend_business_units()
 returns table(business_unit text, vendor_count integer, tx_count integer, total_spend numeric)
 language sql stable
 set search_path to 'kraya', 'public'
as $$
  select business_unit, count(distinct vendor_id)::int, count(*)::int, sum(amount)
    from kraya.vtrend_purchases
   group by 1 order by 1;
$$;

create or replace function kraya.vtrend_overview(p_business_units text[] default null)
 returns jsonb language sql stable
 set search_path to 'kraya', 'public'
as $$
  with asof as (select kraya.vtrend_asof(p_business_units) as d),
  base as (select * from kraya.vtrend_purchases where p_business_units is null or business_unit = any(p_business_units)),
  tot as (select count(distinct vendor_id) as vendors, count(*) as txs, sum(amount) as spend from base),
  last12   as (select coalesce(sum(amount),0) as s from base, asof where purchase_date >  (asof.d - interval '12 months') and purchase_date <= asof.d),
  prior12  as (select coalesce(sum(amount),0) as s from base, asof where purchase_date >  (asof.d - interval '24 months') and purchase_date <= (asof.d - interval '12 months')),
  lastmo   as (select coalesce(sum(amount),0) as s from base, asof where date_trunc('month',purchase_date)=date_trunc('month',asof.d)),
  priormo  as (select coalesce(sum(amount),0) as s from base, asof where date_trunc('month',purchase_date)=date_trunc('month',asof.d - interval '1 month')),
  activev  as (select count(distinct vendor_id) as n from base, asof where purchase_date > (asof.d - interval '90 days')),
  vspend   as (select vendor_id, sum(amount) as spend from base group by vendor_id),
  grandtot as (select sum(spend) as g from vspend),
  ranked   as (select vendor_id, spend, row_number() over (order by spend desc) as rn, sum(spend) over (order by spend desc) as running from vspend),
  conc     as (
    select coalesce(sum(spend) filter (where rn<=5),0)  as top5,
           coalesce(sum(spend) filter (where rn<=10),0) as top10,
           coalesce(sum(power(spend/nullif((select g from grandtot),0)*100,2)),0) as hhi,
           min(rn) filter (where running >= (select g from grandtot)*0.8) as pareto_n
      from ranked
  )
  select jsonb_build_object(
    'as_of', (select d from asof),
    'total_spend', (select spend from tot),
    'total_vendors', (select vendors from tot),
    'total_transactions', (select txs from tot),
    'avg_transaction_value', case when (select txs from tot)>0 then round((select spend from tot)/(select txs from tot),2) else 0 end,
    'active_vendors_90d', (select n from activev),
    'last12_spend', (select s from last12),
    'prior12_spend', (select s from prior12),
    'yoy_change_pct', case when (select s from prior12)>0 then round((((select s from last12)-(select s from prior12))/(select s from prior12))*100,1) else null end,
    'last_month_spend', (select s from lastmo),
    'prior_month_spend', (select s from priormo),
    'mom_change_pct', case when (select s from priormo)>0 then round((((select s from lastmo)-(select s from priormo))/(select s from priormo))*100,1) else null end,
    'top5_share_pct', round((select top5 from conc)/nullif((select g from grandtot),0)*100,1),
    'top10_share_pct', round((select top10 from conc)/nullif((select g from grandtot),0)*100,1),
    'hhi', round((select hhi from conc),0),
    'vendors_for_80pct', (select pareto_n from conc)
  );
$$;

create or replace function kraya.vtrend_monthly(p_business_units text[] default null)
 returns table(month date, amount numeric, vendor_count integer, tx_count integer)
 language sql stable
 set search_path to 'kraya', 'public'
as $$
  select date_trunc('month',purchase_date)::date as month,
         sum(amount) as amount,
         count(distinct vendor_id)::int as vendor_count,
         count(*)::int as tx_count
    from kraya.vtrend_purchases
   where p_business_units is null or business_unit = any(p_business_units)
   group by 1 order by 1;
$$;

create or replace function kraya.vtrend_category_monthly(p_business_units text[] default null)
 returns table(month date, category text, amount numeric)
 language sql stable
 set search_path to 'kraya', 'public'
as $$
  select date_trunc('month',purchase_date)::date as month, category, sum(amount) as amount
    from kraya.vtrend_purchases
   where p_business_units is null or business_unit = any(p_business_units)
   group by 1,2 order by 1,2;
$$;

create or replace function kraya.vtrend_vendor_summary(p_business_units text[] default null)
 returns table(
   vendor_id bigint, name text, category text,
   first_purchase date, last_purchase date,
   total_spend numeric, tx_count integer, share_pct numeric,
   recent_spend numeric, previous_spend numeric, change_pct numeric, status text
 )
 language sql stable
 set search_path to 'kraya', 'public'
as $$
  with asof as (select kraya.vtrend_asof(p_business_units) as d),
  agg as (
    select p.vendor_id, min(p.purchase_date) as first_purchase, max(p.purchase_date) as last_purchase,
           sum(p.amount) as total_spend, count(*)::int as tx_count,
           coalesce(sum(p.amount) filter (where p.purchase_date > (select d from asof) - interval '180 days' and p.purchase_date <= (select d from asof)),0) as recent_spend,
           coalesce(sum(p.amount) filter (where p.purchase_date > (select d from asof) - interval '360 days' and p.purchase_date <= (select d from asof) - interval '180 days'),0) as previous_spend
      from kraya.vtrend_purchases p
     where p_business_units is null or p.business_unit = any(p_business_units)
     group by p.vendor_id
  ),
  grand as (select sum(total_spend) as g from agg)
  select v.id, v.name, v.category,
         a.first_purchase, a.last_purchase, a.total_spend, a.tx_count,
         round(a.total_spend/nullif((select g from grand),0)*100,2) as share_pct,
         a.recent_spend, a.previous_spend,
         case when a.previous_spend>0 then round(((a.recent_spend-a.previous_spend)/a.previous_spend)*100,1) else null end as change_pct,
         case
           when a.first_purchase > (select d from asof) - interval '90 days'  then 'New'
           when a.last_purchase  < (select d from asof) - interval '120 days' then 'Inactive'
           when a.previous_spend = 0 and a.recent_spend > 0 then 'Growing'
           when a.previous_spend > 0 and a.recent_spend = 0 then 'Declining'
           when a.previous_spend > 0 and ((a.recent_spend-a.previous_spend)/a.previous_spend) >= 0.2  then 'Growing'
           when a.previous_spend > 0 and ((a.recent_spend-a.previous_spend)/a.previous_spend) <= -0.2 then 'Declining'
           else 'Stable'
         end as status
    from kraya.vtrend_vendors v
    join agg a on a.vendor_id = v.id
   order by a.total_spend desc;
$$;

create or replace function kraya.vtrend_anomalies(p_business_units text[] default null)
 returns table(vendor_id bigint, name text, category text, month date, amount numeric, trailing_avg numeric, multiple numeric)
 language sql stable
 set search_path to 'kraya', 'public'
as $$
  with monthly as (
    select p.vendor_id, date_trunc('month',p.purchase_date)::date as month, sum(p.amount) as amount
      from kraya.vtrend_purchases p
     where p_business_units is null or p.business_unit = any(p_business_units)
     group by 1,2
  ),
  withavg as (
    select m.*,
      (select avg(m2.amount) from monthly m2
        where m2.vendor_id=m.vendor_id and m2.month < m.month and m2.month >= m.month - interval '6 months') as trailing_avg
      from monthly m
  )
  select w.vendor_id, v.name, v.category, w.month, w.amount, round(w.trailing_avg,0) as trailing_avg,
         round(w.amount/nullif(w.trailing_avg,0),2) as multiple
    from withavg w
    join kraya.vtrend_vendors v on v.id=w.vendor_id
   where w.trailing_avg is not null and w.trailing_avg > 0
     and w.amount > w.trailing_avg * 2.5
     and w.amount > 100000
   order by multiple desc
   limit 20;
$$;

create or replace function kraya.vtrend_vendor_monthly_all(p_business_units text[] default null)
 returns table(vendor_id bigint, month date, amount numeric)
 language sql stable
 set search_path to 'kraya', 'public'
as $$
  select vendor_id, date_trunc('month',purchase_date)::date as month, sum(amount) as amount
    from kraya.vtrend_purchases
   where p_business_units is null or business_unit = any(p_business_units)
   group by 1,2
   order by 1,2;
$$;

grant execute on function kraya.vtrend_asof(text[]) to authenticated;
grant execute on function kraya.vtrend_business_units() to authenticated;
grant execute on function kraya.vtrend_overview(text[]) to authenticated;
grant execute on function kraya.vtrend_monthly(text[]) to authenticated;
grant execute on function kraya.vtrend_category_monthly(text[]) to authenticated;
grant execute on function kraya.vtrend_vendor_summary(text[]) to authenticated;
grant execute on function kraya.vtrend_anomalies(text[]) to authenticated;
grant execute on function kraya.vtrend_vendor_monthly_all(text[]) to authenticated;
