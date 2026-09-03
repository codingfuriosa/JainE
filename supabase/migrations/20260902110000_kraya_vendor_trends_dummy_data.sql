/* Vendor Trend Analysis — new tab in the Procurement module.

   No real vendor spend ledger exists yet (kraya.purchase_orders has 2 rows total), so this seeds a
   realistic 24-month dummy dataset to build and demonstrate the report against. Kept as its own
   pair of tables (vtrend_vendors / vtrend_purchases) rather than writing into purchase_orders,
   which is the module's real, user-facing PO table and must not be polluted with placeholder rows.
   Housed under the kraya schema (already exposed via PostgREST) purely so the client can call it
   with sb.schema('kraya') like every other Procurement query - no new schema, no API config change.

   Every classification below (New / Inactive / Growing / Declining / Stable) is computed fresh by
   the RPCs from the raw rows, exactly as it would be against real data later - nothing here is
   pre-labelled or hard-coded per vendor, so swapping in a real feed only means re-pointing the
   INSERTs, not touching the analysis. */

create table kraya.vtrend_vendors (
  id bigint generated always as identity primary key,
  name text not null,
  category text not null,
  archetype text not null,          -- generation intent only; the RPCs never read this column
  onboarded_on date not null,
  created_at timestamptz not null default now()
);

create table kraya.vtrend_purchases (
  id bigint generated always as identity primary key,
  vendor_id bigint not null references kraya.vtrend_vendors(id) on delete cascade,
  purchase_date date not null,
  category text not null,
  invoice_no text not null,
  quantity numeric not null,
  unit_price numeric not null,
  amount numeric not null,
  created_at timestamptz not null default now()
);
create index vtrend_purchases_vendor_idx on kraya.vtrend_purchases(vendor_id);
create index vtrend_purchases_date_idx   on kraya.vtrend_purchases(purchase_date);

alter table kraya.vtrend_vendors   enable row level security;
alter table kraya.vtrend_purchases enable row level security;
create policy vtv_read on kraya.vtrend_vendors   for select using (app.can_read('kraya'));
create policy vtp_read on kraya.vtrend_purchases for select using (app.can_read('kraya'));
grant select on kraya.vtrend_vendors, kraya.vtrend_purchases to authenticated;

-- ── Vendor master (43 vendors, 9 categories, 7 behaviour archetypes) ──────────────────────────
insert into kraya.vtrend_vendors(name, category, archetype, onboarded_on) values
('Shreeji Cement Traders',        'Construction Materials', 'major',     '2024-09-01'),
('Om Sai Steel Corp',             'Construction Materials', 'major',     '2024-09-01'),
('Bhoomi Aggregates & Sand',      'Construction Materials', 'growing',   '2024-09-01'),
('Vishwakarma TMT Udyog',         'Construction Materials', 'declining', '2024-09-01'),
('Ganesh Building Materials',     'Construction Materials', 'longtail',  '2024-09-01'),
('Krishna Ready Mix Concrete',    'Construction Materials', 'longtail',  '2024-09-01'),
('Sunrise Bricks & Blocks',       'Construction Materials', 'inactive',  '2024-09-01'),
('Radiance Tiles & Ceramics',     'Sanitaryware & Tiles',   'major',     '2024-09-01'),
('Aqualine Sanitaryware Pvt Ltd', 'Sanitaryware & Tiles',   'growing',   '2024-09-01'),
('Marble Craft Interiors',        'Sanitaryware & Tiles',   'longtail',  '2024-09-01'),
('Classic Vitrified Tiles',       'Sanitaryware & Tiles',   'inactive',  '2024-09-01'),
('Elegance Bath Fittings',        'Sanitaryware & Tiles',   'new',       '2024-09-01'),
('Voltguard Electricals',         'Electrical & Plumbing',  'major',     '2024-09-01'),
('Flowtech Plumbing Supplies',    'Electrical & Plumbing',  'declining', '2024-09-01'),
('Brightline Wires & Cables',     'Electrical & Plumbing',  'longtail',  '2024-09-01'),
('Precision Switchgear Co',       'Electrical & Plumbing',  'longtail',  '2024-09-01'),
('AquaFlow Pipes & Fittings',     'Electrical & Plumbing',  'new',       '2024-09-01'),
('Everclean Facility Services',   'Facility & Maintenance', 'major',     '2024-09-01'),
('SecureGuard Manpower Solutions','Facility & Maintenance', 'growing',   '2024-09-01'),
('GreenScape Landscaping',        'Facility & Maintenance', 'longtail',  '2024-09-01'),
('FixIt Maintenance Co',          'Facility & Maintenance', 'declining', '2024-09-01'),
('Prime Housekeeping Services',   'Facility & Maintenance', 'new',       '2024-09-01'),
('Bluewave IT Solutions',         'IT & Software',          'major',     '2024-09-01'),
('Cloudnine Software Systems',    'IT & Software',          'growing',   '2024-09-01'),
('Nexgen Networks Pvt Ltd',       'IT & Software',          'longtail',  '2024-09-01'),
('DataSafe Backup Services',      'IT & Software',          'inactive',  '2024-09-01'),
('PixelForge Web Studio',         'IT & Software',          'new',       '2024-09-01'),
('Horizon Ad Agency',             'Marketing & Advertising','declining', '2024-09-01'),
('Buzzline Digital Marketing',    'Marketing & Advertising','growing',   '2024-09-01'),
('PrintCraft Signages',           'Marketing & Advertising','longtail',  '2024-09-01'),
('FrameWorks Photography',        'Marketing & Advertising','anomaly',   '2024-09-01'),
('Sterling Legal Associates',     'Professional Services',  'major',     '2024-09-01'),
('Apex Audit & Consulting',       'Professional Services',  'declining', '2024-09-01'),
('ClearTax Advisory Services',    'Professional Services',  'longtail',  '2024-09-01'),
('Insight HR Consultants',        'Professional Services',  'inactive',  '2024-09-01'),
('Vantage Valuation Experts',     'Professional Services',  'new',       '2024-09-01'),
('Swiftmove Logistics',           'Logistics & Transport',  'growing',   '2024-09-01'),
('RoadRunner Transport Co',       'Logistics & Transport',  'longtail',  '2024-09-01'),
('CargoLink Freight Services',    'Logistics & Transport',  'inactive',  '2024-09-01'),
('QuickHaul Movers',              'Logistics & Transport',  'anomaly',   '2024-09-01'),
('Staples & More Office Supplies','Office & Admin Supplies','longtail',  '2024-09-01'),
('PrintPoint Stationery',         'Office & Admin Supplies','longtail',  '2024-09-01'),
('TechDesk Furniture Co',         'Office & Admin Supplies','anomaly',   '2024-09-01');

-- ── Transaction generation ─────────────────────────────────────────────────────────────────────
do $gen$
declare
  r record;
  p1 numeric; p2 numeric; p3 int;
  i int; k int; n_tx int;
  active boolean; month_start date; amt numeric; tx_amt numeric; qty numeric; up numeric; pdate date;
begin
  for r in select id, archetype, category from kraya.vtrend_vendors loop
    p1 := null; p2 := null; p3 := null;
    if r.archetype='major' then p1 := 400000 + random()*500000;
    elsif r.archetype='growing' then p1 := 60000+random()*60000; p2 := 350000+random()*250000;
    elsif r.archetype='declining' then p1 := 350000+random()*250000; p2 := 50000+random()*60000;
    elsif r.archetype='new' then p1 := 120000+random()*250000; p3 := 22 + floor(random()*2)::int;       -- active only Jul/Aug 2026
    elsif r.archetype='inactive' then p1 := 90000+random()*220000; p3 := 6 + floor(random()*10)::int;    -- stops by month 6-15
    elsif r.archetype='longtail' then p1 := 15000+random()*65000;
    elsif r.archetype='anomaly' then p1 := 35000+random()*60000; p2 := 6+random()*4; p3 := 2+floor(random()*20)::int;
    end if;

    for i in 0..23 loop
      month_start := (date '2024-09-01' + (i||' months')::interval)::date;
      active := false;
      if r.archetype in ('major','growing','declining') then active := true;
      elsif r.archetype='new' then active := (i >= p3);
      elsif r.archetype='inactive' then active := (i <= p3);
      elsif r.archetype='longtail' then active := (random() < 0.4);
      elsif r.archetype='anomaly' then active := (random() < 0.55) or (i = p3);
      end if;
      if not active then continue; end if;

      if r.archetype='major' then amt := p1*(0.85+random()*0.3);
      elsif r.archetype in ('growing','declining') then amt := (p1 + (p2-p1)*i/23.0)*(0.85+random()*0.3);
      elsif r.archetype='new' then amt := p1*(0.85+random()*0.3);
      elsif r.archetype='inactive' then amt := p1*(0.85+random()*0.3);
      elsif r.archetype='longtail' then amt := p1*(0.7+random()*0.6);
      elsif r.archetype='anomaly' then
        if i=p3 then amt := p1*p2*(0.9+random()*0.2); else amt := p1*(0.85+random()*0.3); end if;
      end if;

      if r.archetype in ('major','growing','declining','inactive') then n_tx := 2+floor(random()*3)::int;
      elsif r.archetype='anomaly' and i=p3 then n_tx := 1;
      else n_tx := 1+floor(random()*2)::int;
      end if;

      for k in 1..n_tx loop
        tx_amt := round(((amt/n_tx) * (0.8+random()*0.4))::numeric, 2);
        qty := 1+floor(random()*40);
        up := round(tx_amt/qty,2);
        tx_amt := round(up*qty,2);
        pdate := month_start + (floor(random()*27))::int;
        insert into kraya.vtrend_purchases(vendor_id,purchase_date,category,invoice_no,quantity,unit_price,amount)
        values(r.id, pdate, r.category, 'INV-'||r.id||'-'||to_char(pdate,'YYYYMMDD')||'-'||k, qty, up, tx_amt);
      end loop;
    end loop;
  end loop;

  update kraya.vtrend_vendors v
     set onboarded_on = p.first_dt
    from (select vendor_id, min(purchase_date) as first_dt from kraya.vtrend_purchases group by vendor_id) p
   where p.vendor_id = v.id;
end $gen$;

-- ── Report RPCs ─────────────────────────────────────────────────────────────────────────────────

create or replace function kraya.vtrend_asof()
 returns date language sql stable
 set search_path to 'kraya', 'public'
as $$
  select coalesce(max(purchase_date), current_date) from kraya.vtrend_purchases;
$$;

create or replace function kraya.vtrend_overview()
 returns jsonb language sql stable
 set search_path to 'kraya', 'public'
as $$
  with asof as (select kraya.vtrend_asof() as d),
  base as (select * from kraya.vtrend_purchases),
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

create or replace function kraya.vtrend_monthly()
 returns table(month date, amount numeric, vendor_count integer, tx_count integer)
 language sql stable
 set search_path to 'kraya', 'public'
as $$
  select date_trunc('month',purchase_date)::date as month,
         sum(amount) as amount,
         count(distinct vendor_id)::int as vendor_count,
         count(*)::int as tx_count
    from kraya.vtrend_purchases
   group by 1 order by 1;
$$;

create or replace function kraya.vtrend_category_monthly()
 returns table(month date, category text, amount numeric)
 language sql stable
 set search_path to 'kraya', 'public'
as $$
  select date_trunc('month',purchase_date)::date as month, category, sum(amount) as amount
    from kraya.vtrend_purchases
   group by 1,2 order by 1,2;
$$;

create or replace function kraya.vtrend_vendor_summary()
 returns table(
   vendor_id bigint, name text, category text,
   first_purchase date, last_purchase date,
   total_spend numeric, tx_count integer, share_pct numeric,
   recent_spend numeric, previous_spend numeric, change_pct numeric, status text
 )
 language sql stable
 set search_path to 'kraya', 'public'
as $$
  with asof as (select kraya.vtrend_asof() as d),
  agg as (
    select p.vendor_id, min(p.purchase_date) as first_purchase, max(p.purchase_date) as last_purchase,
           sum(p.amount) as total_spend, count(*)::int as tx_count,
           coalesce(sum(p.amount) filter (where p.purchase_date > (select d from asof) - interval '180 days' and p.purchase_date <= (select d from asof)),0) as recent_spend,
           coalesce(sum(p.amount) filter (where p.purchase_date > (select d from asof) - interval '360 days' and p.purchase_date <= (select d from asof) - interval '180 days'),0) as previous_spend
      from kraya.vtrend_purchases p
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

create or replace function kraya.vtrend_anomalies()
 returns table(vendor_id bigint, name text, category text, month date, amount numeric, trailing_avg numeric, multiple numeric)
 language sql stable
 set search_path to 'kraya', 'public'
as $$
  with monthly as (
    select p.vendor_id, date_trunc('month',p.purchase_date)::date as month, sum(p.amount) as amount
      from kraya.vtrend_purchases p
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

grant execute on function kraya.vtrend_asof() to authenticated;
grant execute on function kraya.vtrend_overview() to authenticated;
grant execute on function kraya.vtrend_monthly() to authenticated;
grant execute on function kraya.vtrend_category_monthly() to authenticated;
grant execute on function kraya.vtrend_vendor_summary() to authenticated;
grant execute on function kraya.vtrend_anomalies() to authenticated;
