-- FARVISION IMPORT KEEPS EVERY ROW (2 Nov 2026, asked by Ayush).
-- The daily import used to drop two kinds of rows:
--   1. rows whose Booking No JainE did not have - 6,215 receipt rows and 5,592 invoice rows on 2 Nov,
--      for 424 bookings (287 Active in Farvision on flats JainE never had, mostly older bookings the
--      Booking Register - which starts 29 Nov 2023 - does not list; 137 cancelled);
--   2. rows of bookings marked cancelled ("keeps its unit for audit but takes no new financial rows").
-- That left JainE's collection short (Rs 5,70,337 in October 2026, all on cancelled bookings).
--
-- Now:
--   - The Invoice and Receipt registers create a booking JainE does not have, from the row itself
--     (project, tower, flat, customer name, booking no), marked created_by = 'auto-import:register'.
--     It is 'cancelled' when the Receipt Register says so, or when the flat already has a live booking
--     (one live booking per flat); otherwise 'booked'. No customer record and no email address is made
--     for it, so it gets no portal login, no invite and no email of any kind.
--   - Rows of cancelled bookings are kept like any other row.
--   - The run's two safety checks (flats without a cost sheet, flats whose ledger does not match)
--     leave the register-created flats out: Farvision's Sales Details never covers them, so they can
--     never have a cost sheet to check against. Every other flat is checked exactly as before.
--   - Post Sales is unchanged: it does not import register-created bookings, and it takes no new
--     invoices or receipts on cancelled bookings (it never got any before, as they were dropped).
-- Each function is patched in place; a patch that does not find its text stops the whole migration.

do $do$
declare d text; n text;
begin
  ---------------------------------------------------------------- cust.fv_apply_file
  d := pg_get_functiondef('cust.fv_apply_file'::regproc);
  if position('auto-import:register' in d) > 0 then raise notice 'fv_apply_file already patched'; else
    n := replace(d, $a$  v_flags jsonb := '[]';
$a$, $b$  v_flags jsonb := '[]';
  v_created int := 0;
$b$);
    if n = d then raise exception 'fv_apply_file: declare block not found'; end if; d := n;

    n := replace(d, $a$  if p_type = 'sales_details' then
    select count(*) filter (where pm.pid is not null), count(*) filter (where pm.pid is null)$a$,
$b$  /* 2 Nov 2026: a booking JainE does not have is made from the Invoice / Receipt Register row
     itself instead of the row being dropped. Cancelled when the Receipt Register says so or when the
     flat already has a live booking; booked otherwise. No customer record, so no login or email. */
  /* The Customer Outstanding file too, for a booking with a balance either way: older customers who still
     owe money are in no other file JAIN-E reads, and without them the MIS outstanding was crores short. */
  if p_type in ('invoice_register', 'receipt_register', 'outstanding') then
    for rec in
      select f.r ->> 'bookingNo' bno, pm.pid,
             (array_agg(f.r ->> 'tower' order by f.rn desc))[1] tower,
             (array_agg(cust.fv_truthy(f.r -> 'unitCode') order by f.rn desc))[1] unit_code,
             (array_agg(f.r ->> 'customerName' order by f.rn desc))[1] cname,
             bool_or(coalesce(f.r ->> 'unitStatus', f.r ->> 'status', '') = 'Cancel') is_cancel
        from fv_rows f join fv_pm pm on pm.bu = f.r ->> 'businessUnit'
       where pm.pid is not null and coalesce(f.r ->> 'bookingNo', '') <> ''
         and (p_type <> 'outstanding' or coalesce(nullif(f.r ->> 'netOutstanding', '')::numeric, 0) <> 0)
         and not exists (select 1 from cust.units u where u.deleted_at is null and u.booking_no = f.r ->> 'bookingNo')
       group by 1, 2
       order by bool_or(coalesce(f.r ->> 'unitStatus', '') = 'Cancel'),
                max(coalesce(f.r ->> 'receiptDate', f.r ->> 'docDate')) desc nulls last
    loop
      continue when coalesce(rec.unit_code, '') = '';            -- a flat needs its flat number; the row stays unmatched
      insert into cust.units (project_id, unit_code, tower, booking_no, status, updated_at, created_by)
      values (rec.pid, rec.unit_code, rec.tower, rec.bno,
              case when rec.is_cancel or exists (
                     select 1 from cust.units u where u.deleted_at is null and u.status <> 'cancelled'
                        and u.project_id = rec.pid and cust.fv_norm(u.tower) = cust.fv_norm(rec.tower)
                        and cust.fv_norm(u.unit_code) = cust.fv_norm(rec.unit_code))
                   then 'cancelled' else 'booked' end,
              now(), 'auto-import:register')
      returning id into v_unit;
      insert into cust.farvision_contacts (unit_id, unit_code, booking_no, contact_name, is_current)
      values (v_unit, rec.unit_code, rec.bno, rec.cname, true);
      v_created := v_created + 1;
    end loop;
    -- the Outstanding file carries the customer's email and mobile: a booking known only from these files
    -- gets them from there, so its customer can be reminded (Sales Details covers only current sales)
    if p_type = 'outstanding' then
      update cust.farvision_contacts fc set contact_email = x.email, contact_phone = coalesce(x.mobile, fc.contact_phone)
        from (select distinct on (f.r ->> 'bookingNo') f.r ->> 'bookingNo' bno, nullif(trim(f.r ->> 'email'), '') email, nullif(trim(f.r ->> 'mobile'), '') mobile
                from fv_rows f where coalesce(trim(f.r ->> 'email'), '') <> '' order by f.r ->> 'bookingNo', f.rn desc) x,
             cust.units u
       where u.booking_no = x.bno and u.deleted_at is null and u.created_by = 'auto-import:register'
         and fc.unit_id = u.id and fc.is_current and fc.contact_email is distinct from x.email;
    end if;
    if p_type in ('receipt_register', 'outstanding') then
      update cust.units u set status = 'cancelled', updated_at = now()
        from (select distinct f.r ->> 'bookingNo' bno from fv_rows f where coalesce(f.r ->> 'unitStatus', f.r ->> 'status') = 'Cancel') c
       where u.booking_no = c.bno and u.created_by = 'auto-import:register'
         and u.deleted_at is null and u.status <> 'cancelled';
    end if;
  end if;

  if p_type = 'sales_details' then
    select count(*) filter (where pm.pid is not null), count(*) filter (where pm.pid is null)$b$);
    if n = d then raise exception 'fv_apply_file: sales_details start not found'; end if; d := n;

    n := replace(d, $a$      when ustatus = 'cancelled' and p_type <> 'booking_register' then null
$a$, '');
    if n = d then raise exception 'fv_apply_file: cancelled skip not found'; end if; d := n;

    /* A receipt or demand Farvision no longer has stops counting here. Both registers are the full history
       from their first date, so anything of these projects dated inside that range and missing from today's
       file was removed or moved in Farvision - REC0175/00235/26-27 (Rs 22,88,200, Gateway Block-3 4C) sat in
       JAIN-E's October collection for weeks after Farvision dropped it. Post Sales then shows it as
       "Removed from Farvision's receipt register", as it already does for such receipts. */
    n := replace(d, $a$      from fv_g g join fv_m m on m.ok and m.unit_id = g.unit_id and m.r ->> 'docNo' = g.doc;
$a$, $b$      from fv_g g join fv_m m on m.ok and m.unit_id = g.unit_id and m.r ->> 'docNo' = g.doc;
    update cust.invoices x set is_current = false
     where x.is_current and x.deleted_at is null
       and x.unit_id in (select u.id from cust.units u where u.deleted_at is null and u.project_id in (select distinct pid from fv_m where pid is not null))
       and x.document_date >= (select min((m.r ->> 'docDate')::date) from fv_m m)
       and not exists (select 1 from fv_m m where m.unit_id = x.unit_id and m.r ->> 'docNo' = x.document_no);
$b$);
    if n = d then raise exception 'fv_apply_file: invoice items insert not found'; end if; d := n;
    n := replace(d, $a$      from fv_g g join fv_m m on m.ok and m.unit_id = g.unit_id and m.r ->> 'receiptNo' = g.rno;
$a$, $b$      from fv_g g join fv_m m on m.ok and m.unit_id = g.unit_id and m.r ->> 'receiptNo' = g.rno;
    update cust.money_receipts x set is_current = false
     where x.is_current and x.deleted_at is null
       and x.unit_id in (select u.id from cust.units u where u.deleted_at is null and u.project_id in (select distinct pid from fv_m where pid is not null))
       and x.receipt_date >= (select min((m.r ->> 'receiptDate')::date) from fv_m m)
       and not exists (select 1 from fv_m m where m.unit_id = x.unit_id and m.r ->> 'receiptNo' = x.receipt_no);
$b$);
    if n = d then raise exception 'fv_apply_file: receipt items insert not found'; end if; d := n;

    n := replace(d, $a$'skipped_cancelled', v_skipped,$a$, $b$'skipped_cancelled', v_skipped, 'created_bookings', v_created,$b$);
    if n = d then raise exception 'fv_apply_file: return not found'; end if;
    execute n;
  end if;

  ---------------------------------------------------------------- cust.fv_health
  d := pg_get_functiondef('cust.fv_health'::regproc);
  if position('auto-import:register' in d) = 0 then
    n := replace(d, $a$'live_units', (select count(*) from cust.units where deleted_at is null and coalesce(status, '') <> 'cancelled'),$a$,
                    $b$'live_units', (select count(*) from cust.units where deleted_at is null and coalesce(status, '') <> 'cancelled'
                                     and created_by is distinct from 'auto-import:register'),$b$);
    if n = d then raise exception 'fv_health: live_units not found'; end if; d := n;
    n := replace(d, $a$                       where u.deleted_at is null and coalesce(u.status, '') <> 'cancelled'
$a$, $b$                       where u.deleted_at is null and coalesce(u.status, '') <> 'cancelled'
                         and u.created_by is distinct from 'auto-import:register'
$b$);
    if n = d then raise exception 'fv_health: no_cost_sheet not found'; end if;
    execute n;
  end if;

  ---------------------------------------------------------------- cust.fv_ledger_mismatches
  d := pg_get_functiondef('cust.fv_ledger_mismatches'::regproc);
  if position('auto-import:register' in d) = 0 then
    n := replace(d, $a$with u as (select id from cust.units where deleted_at is null and coalesce(status, '') <> 'cancelled'),$a$,
                    $b$with u as (select id from cust.units where deleted_at is null and coalesce(status, '') <> 'cancelled'
               and created_by is distinct from 'auto-import:register'),$b$);
    if n = d then raise exception 'fv_ledger_mismatches: unit list not found'; end if;
    execute n;
  end if;

  ---------------------------------------------------------------- postsales.import_farvision
  d := pg_get_functiondef('postsales.import_farvision'::regproc);
  if position('auto-import:register' in d) = 0 then
    n := replace(d, $a$    where un.deleted_at is null and not exists(select 1 from postsales.bookings b where b.farvision_unit_id = un.id)$a$,
                    $b$    where un.deleted_at is null and not exists(select 1 from postsales.bookings b where b.farvision_unit_id = un.id)
      and un.created_by is distinct from 'auto-import:register'$b$);
    if n = d then raise exception 'import_farvision: unit loop not found'; end if;
    execute n;
  end if;

  ---------------------------------------------------------------- postsales.sync_farvision
  d := pg_get_functiondef('postsales.sync_farvision'::regproc);
  if position('uu.status = ''cancelled''' in d) = 0 then
    n := replace(d, $a$    where c.is_current and c.deleted_at is null
      and not exists(select 1 from postsales.invoices x where x.farvision_invoice_id = c.id)$a$,
                    $b$    where c.is_current and c.deleted_at is null
      and not exists(select 1 from cust.units uu where uu.id = c.unit_id and uu.status = 'cancelled')
      and not exists(select 1 from postsales.invoices x where x.farvision_invoice_id = c.id)$b$);
    if n = d then raise exception 'sync_farvision: invoice loop not found'; end if; d := n;
    n := replace(d, $a$    where c.is_current and c.deleted_at is null and coalesce(c.total_amount,0) > 0$a$,
                    $b$    where c.is_current and c.deleted_at is null and coalesce(c.total_amount,0) > 0
      and not exists(select 1 from cust.units uu where uu.id = c.unit_id and uu.status = 'cancelled')$b$);
    if n = d then raise exception 'sync_farvision: receipt loop not found'; end if;
    execute n;
  end if;
end $do$;
