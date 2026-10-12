-- A FLAT FARVISION IS BILLING THAT POST SALES HAS NEVER HEARD OF.
--
-- postsales.sync_farvision does not contain the words "insert into postsales.bookings" anywhere in
-- its 13,909 characters. It joins TO bookings three times and requires one to exist:
--
--     from cust.invoices c join postsales.bookings b on b.farvision_unit_id = c.unit_id
--
-- So the sync enriches bookings somebody already created. It cannot create one. A flat that
-- FarVision starts billing, with no booking raised in JAIN-E, is therefore invisible here for
-- ever - its demands, its receipts and its outstanding never arrive, and no error is raised
-- because an inner join that matches nothing is not an error.
--
-- That is exactly what happened to Dream Gateway Pailan 6B and 7H in BLOCK-3. The import created
-- the units on 03-10-2026 and billed four demands against each; Post Sales never saw a rupee of
-- it, and the MIS was 76,70,151 light with nothing anywhere saying why.
--
-- Auto-creating the booking is not the answer: a booking needs applicants, a cost sheet and a
-- payment plan, and inventing those from an outstanding row would be worse than the gap. What is
-- needed is for somebody to be TOLD, within minutes rather than at the next weekly MIS. This
-- function is what tells them.

create or replace function postsales.unlinked_farvision_units()
returns table(project_id bigint, project text, unit_id bigint, unit_code text, tower text,
              outstanding numeric, bills integer, first_seen date)
language sql stable set search_path to 'postsales','cust','public' as $$
  with latest as (
    select distinct on (s.unit_id) s.unit_id, s.net_outstanding, s.no_of_bills, s.as_on_date
    from cust.outstanding_snapshot s
    where s.deleted_at is null and s.is_current
    order by s.unit_id, s.id desc)
  select u.project_id, p.name, u.id, u.unit_code, u.tower,
         round(latest.net_outstanding, 2), latest.no_of_bills,
         u.created_at::date
  from latest
  join cust.units u    on u.id = latest.unit_id
  join cust.projects p on p.id = u.project_id
  where latest.net_outstanding > 0
    and not exists (select 1 from postsales.bookings b where b.farvision_unit_id = u.id)
  order by latest.net_outstanding desc
$$;

grant execute on function postsales.unlinked_farvision_units() to authenticated;