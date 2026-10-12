-- THE MIS REPORT MUST READ THE SAME NUMBER THE WEEKLY SHEET READS.
--
-- Until now the MIS report recomputed outstanding from Post Sales: open invoices minus receipts.
-- That is a reasonable definition and it is not the one the weekly MIS has ever used. The weekly
-- sheet reads FarVision's Customer Outstanding Summary and sums its Net Outstanding column where
-- the customer is Active and the figure is above zero. Two ledgers, two answers, and the report
-- quietly published the wrong one under the right heading.
--
-- JAIN-E already HAS the FarVision figure: cust.outstanding_snapshot is that export, imported
-- through Customer Portal. Checked against the hand-made sheet for 28.09.2026 it is not merely
-- close, it is exact - Dream Gurukul 2,13,84,025 and Dream Ecocity Bungalow 18,15,709 to the
-- rupee - wherever every unit has been imported. So the method is right; only the coverage is not.
--
-- This function reads that snapshot the way the sheet does, and reports coverage alongside the
-- money so a short import can never again look like a complete report.
--
--   * the snapshot AS ON the date asked for, or the most recent one before it - "as on" means the
--     position on that day, and an import does not run every single day
--   * one row per unit. On 29-09 the table holds 320 rows for 162 units, so a plain sum would
--     have double-counted that day by roughly two crore. The newest row per unit wins.
--   * net_outstanding > 0, which is the sheet's own rule: a customer in credit does not net off
--     another customer's dues.

create or replace function postsales.mis_outstanding(p_as_of date)
returns table(project_id bigint, outstanding numeric, units integer,
              snapshot_date date, units_with_bookings integer)
language sql stable set search_path to 'postsales','cust','public' as $$
  with asof as (
    select max(s.as_on_date) as d
    from cust.outstanding_snapshot s
    where s.deleted_at is null and s.as_on_date <= p_as_of),
  one_per_unit as (
    select distinct on (s.unit_id) s.unit_id, s.net_outstanding, s.as_on_date
    from cust.outstanding_snapshot s, asof
    where s.deleted_at is null and s.as_on_date = asof.d
    order by s.unit_id, s.id desc),
  per as (
    select u.project_id,
           sum(o.net_outstanding) filter (where o.net_outstanding > 0) as outstanding,
           count(*) filter (where o.net_outstanding > 0)               as units,
           max(o.as_on_date)                                          as snapshot_date
    from one_per_unit o join cust.units u on u.id = o.unit_id
    group by u.project_id),
  bk as (
    select b.project_id, count(*)::int as n
    from postsales.bookings b where b.status = 'active' group by 1)
  select coalesce(per.project_id, bk.project_id)::bigint,
         round(coalesce(per.outstanding, 0), 2),
         coalesce(per.units, 0)::int,
         per.snapshot_date,
         coalesce(bk.n, 0)::int
  from per full join bk on bk.project_id = per.project_id
$$;

grant execute on function postsales.mis_outstanding(date) to authenticated;
