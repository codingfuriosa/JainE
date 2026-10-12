-- Purchase & Stores, Stage 9: stock reports.
-- See docs/purchase-stores-spec.md section 9.
--
--   report_stock_summary  stock (quantity and value) per warehouse and item as on a date, filterable by project,
--                         warehouse and item group (a group includes the groups inside it)
--   report_item_ledger    one item (optionally one warehouse) between two dates: opening, every movement with a
--                         running balance, and the category of each movement (receipt, issue, return, adjustment,
--                         transfer) so the screen can total them into opening / receipts / issues / ... / closing
--   report_stock_ageing   the stock on hand as on a date split by how long ago it was received (0-30, 31-60,
--                         61-90, 91-180, over 180 days). Stock is held at weighted-average cost, so ageing assumes
--                         the oldest stock is used first: what is left is attributed to the newest receipts.
-- "As on a date" is worked out from the signed movements dated on or before that date (never from the last
-- row's running balance), so documents entered with an earlier date are handled correctly.
-- All three need the report.view permission.

update purchase.permissions set stage = null, label = 'View the stock reports (stock summary, item ledger, stock ageing)' where key = 'report.view';

create or replace function purchase.report_stock_summary(p_as_on date default current_date, p_project bigint default null, p_warehouse bigint default null, p_group bigint default null)
 returns table(warehouse_id bigint, item_id bigint, qty numeric, value numeric, avg_rate numeric)
 language plpgsql stable security definer set search_path = purchase, public as $fn$
begin
  perform purchase._po_guard('report.view');
  return query
  with recursive g as (select id from purchase.item_groups where id = p_group union all select c.id from purchase.item_groups c join g on c.parent_id = g.id)
  select l.warehouse_id, l.item_id, sum(l.qty)::numeric, sum(l.value)::numeric, case when sum(l.qty) > 0 then round(sum(l.value) / sum(l.qty), 4) else 0 end
    from purchase.stock_ledger l
    join purchase.warehouses w on w.id = l.warehouse_id
    join purchase.items i on i.id = l.item_id
   where l.moved_on <= coalesce(p_as_on, current_date)
     and (p_project is null or w.project_id = p_project)
     and (p_warehouse is null or l.warehouse_id = p_warehouse)
     and (p_group is null or i.group_id in (select id from g))
   group by l.warehouse_id, l.item_id
  having sum(l.qty) <> 0 or sum(l.value) <> 0;
end $fn$;

create or replace function purchase.report_item_ledger(p_item bigint, p_warehouse bigint default null, p_from date default null, p_to date default null)
 returns table(seq bigint, moved_on date, doc_type text, category text, doc_no text, warehouse_id bigint, narration text, qty numeric, value numeric, run_qty numeric, run_value numeric)
 language plpgsql stable security definer set search_path = purchase, public as $fn$
declare v_from date := coalesce(p_from, date '2000-01-01'); v_to date := coalesce(p_to, current_date); v_oq numeric; v_ov numeric;
begin
  perform purchase._po_guard('report.view');
  if p_item is null then raise exception 'Choose an item'; end if;
  if v_from > v_to then raise exception 'The from date is after the to date'; end if;
  select coalesce(sum(l.qty), 0), coalesce(sum(l.value), 0) into v_oq, v_ov from purchase.stock_ledger l
   where l.item_id = p_item and l.moved_on < v_from and (p_warehouse is null or l.warehouse_id = p_warehouse);
  return query
  select 0::bigint, v_from, 'OPEN'::text, 'opening'::text, null::text, p_warehouse, 'Opening balance'::text, v_oq, v_ov, v_oq, v_ov
  union all
  select m.id, m.moved_on, m.doc_type, case m.doc_type when 'GRN' then 'receipt' when 'ISS' then 'issue' when 'RTV' then 'return' when 'IRT' then 'return' when 'ADJ' then 'adjustment' when 'TRF' then 'transfer' else 'other' end,
         m.doc_no, m.warehouse_id, m.narration, m.qty::numeric, m.value::numeric,
         v_oq + sum(m.qty) over (order by m.moved_on, m.id), v_ov + sum(m.value) over (order by m.moved_on, m.id)
    from (select * from purchase.stock_ledger l where l.item_id = p_item and l.moved_on between v_from and v_to and (p_warehouse is null or l.warehouse_id = p_warehouse)) m
   order by 1, 2;
end $fn$;

create or replace function purchase.report_stock_ageing(p_as_on date default current_date, p_project bigint default null, p_warehouse bigint default null, p_group bigint default null)
 returns table(warehouse_id bigint, item_id bigint, qty numeric, value numeric, b0 numeric, b1 numeric, b2 numeric, b3 numeric, b4 numeric, oldest_days int)
 language plpgsql stable security definer set search_path = purchase, public as $fn$
declare v_on date := coalesce(p_as_on, current_date);
begin
  perform purchase._po_guard('report.view');
  return query
  with recursive g as (select id from purchase.item_groups where id = p_group union all select c.id from purchase.item_groups c join g on c.parent_id = g.id),
  bal as (
    select l.warehouse_id wh, l.item_id it, sum(l.qty) q, sum(l.value) v
      from purchase.stock_ledger l
      join purchase.warehouses w on w.id = l.warehouse_id
      join purchase.items i on i.id = l.item_id
     where l.moved_on <= v_on
       and (p_project is null or w.project_id = p_project)
       and (p_warehouse is null or l.warehouse_id = p_warehouse)
       and (p_group is null or i.group_id in (select id from g))
     group by l.warehouse_id, l.item_id
    having sum(l.qty) > 0),
  rec as (
    select l.warehouse_id wh, l.item_id it, l.moved_on, l.qty,
           sum(l.qty) over (partition by l.warehouse_id, l.item_id order by l.moved_on desc, l.id desc rows between unbounded preceding and current row) cum
      from purchase.stock_ledger l join bal b on b.wh = l.warehouse_id and b.it = l.item_id
     where l.moved_on <= v_on and l.qty > 0),
  alloc as (
    select r.wh, r.it, (v_on - r.moved_on) age, greatest(0, least(r.qty, b.q - (r.cum - r.qty))) aq
      from rec r join bal b on b.wh = r.wh and b.it = r.it)
  select b.wh, b.it, b.q, b.v,
         coalesce(sum(a.aq) filter (where a.age <= 30), 0), coalesce(sum(a.aq) filter (where a.age between 31 and 60), 0), coalesce(sum(a.aq) filter (where a.age between 61 and 90), 0),
         coalesce(sum(a.aq) filter (where a.age between 91 and 180), 0), coalesce(sum(a.aq) filter (where a.age > 180), 0),
         coalesce(max(a.age) filter (where a.aq > 0), 0)::int
    from bal b left join alloc a on a.wh = b.wh and a.it = b.it
   group by b.wh, b.it, b.q, b.v;
end $fn$;

do $g$
declare f text;
begin
  foreach f in array array['report_stock_summary(date, bigint, bigint, bigint)','report_item_ledger(bigint, bigint, date, date)','report_stock_ageing(date, bigint, bigint, bigint)'] loop
    execute 'revoke all on function purchase.' || f || ' from public, anon';
    execute 'grant execute on function purchase.' || f || ' to authenticated';
  end loop;
end $g$;
