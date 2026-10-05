-- Post Sales, Stage 6: report helpers. See docs/post-sales-spec.md section 8.
-- The other reports (ledger, availability, collection, cancellation, booking register) read the tables
-- directly; these two need set logic that is clearer in SQL.

-- Customer outstanding with interest, as on a date: only invoices raised and receipts received by that
-- date count, and interest is worked out to that date (postsales.interest_calc).
create or replace function postsales.report_outstanding(p_project_id bigint, p_as_of date)
 returns table(booking_id bigint, invoiced numeric, received numeric, outstanding numeric, overdue numeric,
               days_overdue int, interest_accrued numeric, interest_billed numeric, interest_waived numeric,
               interest_received numeric, total_due numeric)
 language sql stable security invoker set search_path = postsales, public
as $$
  with b as (
    select * from postsales.bookings
    where status in ('active','cancelled') and (p_project_id is null or project_id = p_project_id) and booking_date <= p_as_of),
  inv as (
    select i.* from postsales.invoices i join b on b.id = i.booking_id
    where i.status = 'open' and i.invoice_date <= p_as_of),
  paid as (
    select a.invoice_id, sum(a.amount) amt from postsales.receipt_allocations a
    join postsales.receipts r on r.id = a.receipt_id and r.status = 'active' and r.receipt_date <= p_as_of
    group by 1),
  per as (
    select inv.booking_id,
      sum(inv.total) filter (where inv.kind <> 'interest') invoiced,
      sum(inv.total - coalesce(paid.amt,0)) filter (where inv.kind <> 'interest') outstanding,
      sum(inv.total - coalesce(paid.amt,0)) filter (where inv.kind <> 'interest' and inv.due_date < p_as_of) overdue,
      max(p_as_of - inv.due_date) filter (where inv.kind <> 'interest' and inv.due_date < p_as_of and inv.total - coalesce(paid.amt,0) > 0.5) days_overdue,
      sum(inv.total) filter (where inv.kind = 'interest') interest_billed
    from inv left join paid on paid.invoice_id = inv.id group by 1),
  rc as (
    select r.booking_id, sum(r.amount) filter (where not r.against_interest) principal, sum(r.amount) filter (where r.against_interest) interest
    from postsales.receipts r join b on b.id = r.booking_id
    where r.status = 'active' and r.receipt_date <= p_as_of group by 1),
  it as (
    select b.id booking_id, sum(c.paid_late + c.running) accrued, sum(c.waived) waived
    from b cross join lateral postsales.interest_calc(b.id, p_as_of) c group by 1)
  select b.id, coalesce(per.invoiced,0), coalesce(rc.principal,0), coalesce(per.outstanding,0), coalesce(per.overdue,0),
         coalesce(per.days_overdue,0)::int, round(coalesce(it.accrued,0),2), coalesce(per.interest_billed,0), coalesce(it.waived,0),
         coalesce(rc.interest,0),
         round(coalesce(per.outstanding,0) + greatest(0, coalesce(it.accrued,0) - coalesce(it.waived,0)) - coalesce(rc.interest,0), 2)
  from b
  left join per on per.booking_id = b.id
  left join rc on rc.booking_id = b.id
  left join it on it.booking_id = b.id
$$;
grant execute on function postsales.report_outstanding(bigint, date) to authenticated;

-- Demand vs collection per milestone (by name), per project and tower.
create or replace function postsales.report_demand_collection(p_project_id bigint, p_from date, p_to date)
 returns table(project_id bigint, tower_id bigint, milestone text, invoices int, demanded numeric, collected numeric, balance numeric)
 language sql stable security invoker set search_path = postsales, public
as $$
  select i.project_id, b.tower_id, coalesce(bm.name, i.title), count(*)::int, sum(i.total),
         sum(coalesce(p.amt,0)), sum(i.total - coalesce(p.amt,0))
  from postsales.invoices i
  join postsales.bookings b on b.id = i.booking_id
  left join postsales.booking_milestones bm on bm.id = i.booking_milestone_id
  left join (select invoice_id, sum(amount) amt from postsales.receipt_allocations group by 1) p on p.invoice_id = i.id
  where i.status = 'open' and (p_project_id is null or i.project_id = p_project_id)
    and (p_from is null or i.invoice_date >= p_from) and (p_to is null or i.invoice_date <= p_to)
  group by 1, 2, 3
  order by 1, 2, min(coalesce(bm.seq, 9999)), 3
$$;
grant execute on function postsales.report_demand_collection(bigint, date, date) to authenticated;
