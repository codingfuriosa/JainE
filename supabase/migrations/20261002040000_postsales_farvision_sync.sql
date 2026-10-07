-- Post Sales <- Customer Portal (Farvision) live sync, and Farvision's late fee for imported demands.
--
-- SYNC. postsales.sync_farvision() brings everything the Customer Portal imports into Post Sales:
--   new bookings (via import_farvision), and for bookings already here: new demands, demands cancelled
--   or removed in Farvision, new receipts, cheque returns, receipts removed in Farvision, bookings
--   cancelled in Farvision, payments-to-customer, and the late fee. Rows are matched on Farvision's own
--   document number per unit (invoice no. / receipt no.), not only on row id, because a re-import can
--   replace rows. A pg_cron job runs it every 10 minutes when a new import batch has arrived since the
--   last run; the Bookings tab also has a "Sync now" button. Each run is logged in postsales.sync_runs.
--
-- LATE FEE. For demands that came from Farvision, Farvision's own late fee (Customer Outstanding
-- Summary, per booking) is used as the interest figure instead of JainE's 18% calculation - refreshed
-- on every Outstanding import. It is shown, billed (on approval) and waived like any other interest;
-- claims against it have no source invoice. Demands raised in JainE keep the 18% calculation.

alter table postsales.bookings
  add column if not exists fv_late_fee numeric(14,2) not null default 0,
  add column if not exists fv_late_fee_as_of date;
alter table postsales.interest_claims alter column source_invoice_id drop not null;

create table if not exists postsales.sync_runs(
  id          bigserial primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  trigger     text,
  result      jsonb,
  error       text
);
alter table postsales.sync_runs enable row level security;
drop policy if exists sync_runs_staff_all on postsales.sync_runs;
create policy sync_runs_staff_all on postsales.sync_runs for all to authenticated using ((select not app.is_customer())) with check ((select not app.is_customer()));
grant select, insert, update on postsales.sync_runs to authenticated;
grant usage, select on all sequences in schema postsales to authenticated;

-- ---------------------------------------------------------------------------
-- Interest: imported (Farvision) demands are covered by the Farvision late fee row instead.
-- ---------------------------------------------------------------------------
create or replace function postsales.interest_calc(p_booking_id bigint, p_as_of date)
 returns table(invoice_id bigint, invoice_no text, title text, due_date date, total numeric, paid numeric, balance numeric,
               days_overdue int, paid_late numeric, running numeric, billed numeric, waived numeric, suggested numeric)
 language sql stable security invoker set search_path = postsales, public
as $$
  with inv as (
    select i.* from postsales.invoices i
    where i.booking_id = p_booking_id and i.status = 'open' and i.kind = 'milestone' and i.raised_via <> 'import'),
  al as (
    select a.invoice_id, a.amount, r.receipt_date from postsales.receipt_allocations a
    join postsales.receipts r on r.id = a.receipt_id and r.status = 'active'),
  cl as (
    select c.source_invoice_id,
           sum(c.amount) filter (where c.kind = 'billed' and ii.status = 'open') billed,
           sum(c.amount) filter (where c.kind = 'waived') waived
    from postsales.interest_claims c left join postsales.invoices ii on ii.id = c.interest_invoice_id
    where c.booking_id = p_booking_id
    group by 1)
  select inv.id, inv.invoice_no, inv.title, inv.due_date, inv.total,
         coalesce(p.paid,0), inv.total - coalesce(p.paid,0),
         greatest(0, p_as_of - inv.due_date)::int,
         round(coalesce(p.paid_late,0), 2),
         round(greatest(0, inv.total - coalesce(p.paid,0)) * 0.18 * greatest(0, p_as_of - inv.due_date) / 365.0, 2),
         coalesce(cl.billed,0), coalesce(cl.waived,0),
         greatest(0, round(coalesce(p.paid_late,0), 2) - coalesce(cl.billed,0) - coalesce(cl.waived,0))
  from inv
  left join (select al.invoice_id, sum(al.amount) paid,
                    sum(al.amount * 0.18 * greatest(0, al.receipt_date - i2.due_date) / 365.0) paid_late
             from al join postsales.invoices i2 on i2.id = al.invoice_id group by 1) p on p.invoice_id = inv.id
  left join cl on cl.source_invoice_id = inv.id
  where inv.due_date < p_as_of
  union all
  select null::bigint, 'Farvision late fee', 'As per Farvision outstanding' || coalesce(' of ' || to_char(b.fv_late_fee_as_of, 'DD-MM-YYYY'), ''),
         null::date, null::numeric, null::numeric, null::numeric, null::int,
         b.fv_late_fee, 0::numeric, coalesce(f.billed,0), coalesce(f.waived,0),
         greatest(0, b.fv_late_fee - coalesce(f.billed,0) - coalesce(f.waived,0))
  from postsales.bookings b
  left join (select sum(c.amount) filter (where c.kind = 'billed' and ii.status = 'open') billed, sum(c.amount) filter (where c.kind = 'waived') waived
             from postsales.interest_claims c left join postsales.invoices ii on ii.id = c.interest_invoice_id
             where c.booking_id = p_booking_id and c.source_invoice_id is null) f on true
  where b.id = p_booking_id and b.fv_late_fee > 0
$$;

create or replace function postsales.bill_interest(p jsonb) returns bigint
 language plpgsql security invoker set search_path = postsales, public
as $$
declare b postsales.bookings; v_net numeric; v_gst numeric; v_id bigint; v_date date := (p->>'invoice_date')::date; it record; v_seq int := 0;
begin
  select * into b from postsales.bookings where id = (p->>'booking_id')::bigint;
  if not found then raise exception 'Booking not found'; end if;
  select round(sum((x->>'amount')::numeric), 2) into v_net from jsonb_array_elements(p->'items') x where (x->>'amount')::numeric > 0;
  if coalesce(v_net,0) <= 0 then raise exception 'Nothing to bill'; end if;
  v_gst := round(v_net * 0.18);
  insert into postsales.invoices(project_id, booking_id, invoice_no, invoice_date, due_date, kind, title, net, gst, total, raised_via)
  values (b.project_id, b.id, postsales.next_doc_no(b.project_id, 'INV', v_date), v_date, v_date + 30, 'interest',
          'Interest on delayed payment', v_net, v_gst, v_net + v_gst, 'individual')
  returning id into v_id;
  for it in select nullif(x->>'source_invoice_id','')::bigint sid, round((x->>'amount')::numeric, 2) amt from jsonb_array_elements(p->'items') x where (x->>'amount')::numeric > 0 loop
    v_seq := v_seq + 1;
    insert into postsales.interest_claims(booking_id, source_invoice_id, kind, amount, interest_invoice_id) values (b.id, it.sid, 'billed', it.amt, v_id);
    insert into postsales.invoice_lines(invoice_id, seq, head, col, net, gst_rate, gst, total)
    values (v_id, v_seq, coalesce((select 'Interest @18% p.a. on ' || i.invoice_no || ' (' || i.title || ')' from postsales.invoices i where i.id = it.sid),
                                  'Late fee as per Farvision' || coalesce(' (as on ' || to_char(b.fv_late_fee_as_of,'DD-MM-YYYY') || ')','')),
            'interest', it.amt, 18, 0, it.amt);
  end loop;
  v_seq := v_seq + 1;
  insert into postsales.invoice_lines(invoice_id, seq, head, col, net, gst_rate, gst, total) values (v_id, v_seq, 'GST @18%', 'interest', 0, 18, v_gst, v_gst);
  perform postsales.reallocate_booking(b.id);
  return v_id;
end $$;

create or replace function postsales.waive_interest(p jsonb) returns void
 language plpgsql security invoker set search_path = postsales, public
as $$
declare it record;
begin
  if coalesce(trim(p->>'reason'),'') = '' then raise exception 'A waiver needs a reason'; end if;
  for it in select nullif(x->>'source_invoice_id','')::bigint sid, round((x->>'amount')::numeric, 2) amt from jsonb_array_elements(p->'items') x where (x->>'amount')::numeric > 0 loop
    insert into postsales.interest_claims(booking_id, source_invoice_id, kind, amount, reason)
    values ((p->>'booking_id')::bigint, it.sid, 'waived', it.amt, p->>'reason');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- The sync itself.
-- ---------------------------------------------------------------------------
create or replace function postsales.sync_farvision(p_trigger text default 'manual') returns jsonb
 language plpgsql security definer set search_path = postsales, public
as $$
declare
  v_run bigint; v_new jsonb; r record; v_b postsales.bookings; v_ms bigint; v_inv bigint; v_seq int;
  v_stage bigint; v_lvl text; v_name text; v_no text; norm text;
  n_inv int := 0; n_inv_cx int := 0; n_rc int := 0; n_rc_rev int := 0; n_bk_cx int := 0; n_fee int := 0;
  touched bigint[] := '{}'; v_ids bigint[];
  v_batch bigint; v_asof date;
begin
  if app.is_customer() then raise exception 'Not allowed'; end if;
  insert into postsales.sync_runs(trigger) values (p_trigger) returning id into v_run;

  -- 1. new bookings (+ their demands, receipts) and new payments-to-customer
  v_new := postsales.import_farvision(false);

  -- 2. re-link rows a re-import replaced (same unit + document number, new row id)
  update postsales.invoices pi set farvision_invoice_id = c.id
    from postsales.bookings b, cust.invoices c
   where pi.booking_id = b.id and b.farvision_unit_id = c.unit_id and pi.farvision_invoice_id is not null
     and c.is_current and c.deleted_at is null and c.document_no = split_part(pi.invoice_no, '/' || coalesce(pi.farvision_invoice_id::text,'x'), 1)
     and c.id <> pi.farvision_invoice_id
     and not exists(select 1 from cust.invoices o where o.id = pi.farvision_invoice_id and o.is_current and o.deleted_at is null)
     and not exists(select 1 from postsales.invoices x where x.farvision_invoice_id = c.id);
  update postsales.receipts pr set farvision_receipt_id = c.id
    from postsales.bookings b, cust.money_receipts c
   where pr.booking_id = b.id and b.farvision_unit_id = c.unit_id and pr.farvision_receipt_id is not null
     and c.is_current and c.deleted_at is null and c.receipt_no = split_part(pr.receipt_no, '/' || coalesce(pr.farvision_receipt_id::text,'x'), 1)
     and c.id <> pr.farvision_receipt_id
     and not exists(select 1 from cust.money_receipts o where o.id = pr.farvision_receipt_id and o.is_current and o.deleted_at is null)
     and not exists(select 1 from postsales.receipts x where x.farvision_receipt_id = c.id);

  -- 3. new demands on bookings already in Post Sales
  for r in
    select c.*, b.id as ps_booking, b.project_id as ps_project,
           (select mode() within group (order by trim(ii.schedule)) from cust.invoice_items ii where ii.invoice_id = c.id) sched
    from cust.invoices c join postsales.bookings b on b.farvision_unit_id = c.unit_id
    where c.is_current and c.deleted_at is null
      and not exists(select 1 from postsales.invoices x where x.farvision_invoice_id = c.id)
      and not exists(select 1 from postsales.invoices x where x.booking_id = b.id and x.farvision_invoice_id is not null and split_part(x.invoice_no,'/'||x.farvision_invoice_id,1) = c.document_no)
    order by c.document_date, c.id
  loop
    v_ms := null; v_stage := null; v_lvl := 'individual';
    v_name := coalesce(initcap(lower(r.sched)), 'Demand');
    norm := regexp_replace(regexp_replace(upper(coalesce(r.sched,'')), 'SLAB', 'CASTING', 'g'), '[^A-Z0-9]', '', 'g');
    select s.id, s.level into v_stage, v_lvl from postsales.stages s
     where s.project_id = r.ps_project and s.deleted_at is null
       and regexp_replace(regexp_replace(upper(s.name), 'SLAB', 'CASTING', 'g'), '[^A-Z0-9]', '', 'g') = norm limit 1;
    if v_stage is null then v_lvl := 'individual'; end if;
    if r.status <> 'Cancel' then
      select coalesce(max(seq),0) + 1 into v_seq from postsales.booking_milestones where booking_id = r.ps_booking;
      insert into postsales.booking_milestones(booking_id, seq, name, trigger_type, stage_id, unit_net, unit_gst, parking_net, parking_gst, edc_net, edc_gst, gross_total)
      select r.ps_booking, v_seq, v_name, v_lvl, v_stage,
        coalesce(sum(ii.amount) filter (where kk.k = 'unit'),0), coalesce(sum(ii.tax) filter (where kk.k = 'unit'),0),
        coalesce(sum(ii.amount) filter (where kk.k = 'parking'),0), coalesce(sum(ii.tax) filter (where kk.k = 'parking'),0),
        coalesce(sum(ii.amount) filter (where kk.k in ('edc','other')),0), coalesce(sum(ii.tax) filter (where kk.k in ('edc','other')),0),
        coalesce(sum(ii.amount + coalesce(ii.tax,0)),0)
      from cust.invoice_items ii,
           lateral (select case when upper(ii.revenue_head) ~ '^(UNIT COST|PLC|FLC)' then 'unit' when upper(ii.revenue_head) ~ '^VEHICLE PARKING' then 'parking'
                                when upper(ii.revenue_head) ~ '^(CHEQUE DISHONOU?RED|OTHER CHARGES|EXTRA WORK)' then 'other' else 'edc' end k) kk
      where ii.invoice_id = r.id
      returning id into v_ms;
    end if;
    v_no := r.document_no;
    if exists(select 1 from postsales.invoices where invoice_no = v_no) then v_no := v_no || '/' || r.id; end if;
    insert into postsales.invoices(project_id, booking_id, invoice_no, invoice_date, due_date, kind, booking_milestone_id, title, net, gst, total,
        status, raised_via, farvision_invoice_id, created_by, cancelled_at, cancel_reason)
    select r.ps_project, r.ps_booking, v_no, r.document_date, coalesce(r.due_date, r.document_date + 30), 'milestone', v_ms, v_name,
           coalesce(sum(ii.amount),0), coalesce(sum(ii.tax),0), coalesce(sum(ii.amount + coalesce(ii.tax,0)),0),
           case when r.status = 'Cancel' then 'cancelled' else 'open' end, 'import', r.id, 'farvision-sync',
           case when r.status = 'Cancel' then now() end, case when r.status = 'Cancel' then 'Cancelled in Farvision' end
    from cust.invoice_items ii where ii.invoice_id = r.id
    returning id into v_inv;
    insert into postsales.invoice_lines(invoice_id, seq, head, col, net, gst, total)
    select v_inv, row_number() over (order by min(ii.sort_order)), x.head, x.col, sum(ii.amount), sum(coalesce(ii.tax,0)), sum(ii.amount + coalesce(ii.tax,0))
    from cust.invoice_items ii,
         lateral (select case when upper(ii.revenue_head) ~ '^(UNIT COST|PLC|FLC)' then 'unit' when upper(ii.revenue_head) ~ '^VEHICLE PARKING' then 'parking'
                              when upper(ii.revenue_head) ~ '^(CHEQUE DISHONOU?RED|OTHER CHARGES|EXTRA WORK)' then 'other' else 'edc' end col,
                         case when upper(ii.revenue_head) ~ '^(UNIT COST|PLC|FLC)' then 'Unit (incl. PLC / floor rise)' when upper(ii.revenue_head) ~ '^VEHICLE PARKING' then 'Car Parking'
                              when upper(ii.revenue_head) ~ '^(CHEQUE DISHONOU?RED|OTHER CHARGES|EXTRA WORK)' then initcap(lower(regexp_replace(ii.revenue_head,'[_ ]+[0-9]+\s*$','')))
                              else 'Extra Development Charges' end head) x
    where ii.invoice_id = r.id
    group by x.head, x.col;
    -- the "balance as per agreement" line shrinks by what was just demanded
    update postsales.booking_milestones bm set
      unit_net = greatest(0, bm.unit_net - n.unit_net), unit_gst = greatest(0, bm.unit_gst - n.unit_gst),
      parking_net = greatest(0, bm.parking_net - n.parking_net), parking_gst = greatest(0, bm.parking_gst - n.parking_gst),
      edc_net = greatest(0, bm.edc_net - n.edc_net), edc_gst = greatest(0, bm.edc_gst - n.edc_gst)
    from postsales.booking_milestones n
    where n.id = v_ms and bm.booking_id = r.ps_booking and bm.name = 'Balance as per agreement (Farvision plan)'
      and not exists(select 1 from postsales.invoices x where x.booking_milestone_id = bm.id and x.status = 'open');
    update postsales.booking_milestones set gross_total = unit_net + unit_gst + parking_net + parking_gst + edc_net + edc_gst,
           seq = (select coalesce(max(seq),0) + 1 from postsales.booking_milestones where booking_id = r.ps_booking)
     where booking_id = r.ps_booking and name = 'Balance as per agreement (Farvision plan)';
    n_inv := n_inv + 1; touched := touched || r.ps_booking;
  end loop;

  -- 4. demands cancelled in Farvision, or gone from its register
  with x as (
    update postsales.invoices pi set status = 'cancelled', cancelled_at = now(), cancelled_by = 'farvision-sync',
           cancel_reason = case when c.id is null or not c.is_current or c.deleted_at is not null then 'Removed in Farvision' else 'Cancelled in Farvision' end
      from postsales.invoices p2 left join cust.invoices c on c.id = p2.farvision_invoice_id
     where pi.id = p2.id and pi.farvision_invoice_id is not null and pi.status = 'open'
       and (c.id is null or not c.is_current or c.deleted_at is not null or c.status = 'Cancel')
    returning pi.booking_id)
  select coalesce(array_agg(booking_id), '{}') into v_ids from x;
  n_inv_cx := cardinality(v_ids); touched := touched || v_ids;

  -- 5. new receipts on bookings already in Post Sales
  for r in
    select c.*, b.id as ps_booking, b.project_id as ps_project
    from cust.money_receipts c join postsales.bookings b on b.farvision_unit_id = c.unit_id
    where c.is_current and c.deleted_at is null and coalesce(c.total_amount,0) > 0
      and not exists(select 1 from postsales.receipts x where x.farvision_receipt_id = c.id)
      and not exists(select 1 from postsales.receipts x where x.booking_id = b.id and x.farvision_receipt_id is not null and split_part(x.receipt_no,'/'||x.farvision_receipt_id,1) = c.receipt_no)
    order by c.receipt_date, c.id
  loop
    v_no := r.receipt_no;
    if exists(select 1 from postsales.receipts where receipt_no = v_no) then v_no := v_no || '/' || r.id; end if;
    insert into postsales.receipts(project_id, booking_id, receipt_no, receipt_date, mode, instrument_no, instrument_date, drawn_on, drawn_branch,
        bank_account_id, amount, narration, farvision_receipt_id, created_by)
    values (r.ps_project, r.ps_booking, v_no, r.receipt_date,
        case lower(coalesce(r.payment_mode,'')) when 'net banking' then 'net_banking' when 'cheque' then 'cheque' when 'demand draft' then 'dd'
             when 'jv' then 'jv' when 'cash' then 'cash' when 'rtgs/neft/imps' then 'rtgs_neft_imps' when 'upi' then 'upi' else 'net_banking' end,
        r.instrument_no, r.instrument_date, r.drawn_on, r.drawn_on_branch,
        (select ba.id from postsales.bank_accounts ba where ba.deleted_at is null and (ba.project_id is null or ba.project_id = r.ps_project)
           and ((ba.account_no is not null and position(ba.account_no in coalesce(r.deposit_bank,'')) > 0)
                or (ba.account_no is null and upper(coalesce(r.deposit_bank,'')) like '%' || upper(split_part(ba.name,' ',1)) || '%')) limit 1),
        r.total_amount, r.narration, r.id, 'farvision-sync');
    n_rc := n_rc + 1; touched := touched || r.ps_booking;
  end loop;

  -- 6. cheque returns (and receipts gone from Farvision's register) -> reversed
  for r in
    select pr.id, pr.booking_id, rv.receipt_reversal_no, rv.receipt_reversal_date, coalesce(rv.reason, rv.narration) why,
           (c.id is null or not c.is_current or c.deleted_at is not null) gone
    from postsales.receipts pr
    join postsales.bookings b on b.id = pr.booking_id
    left join cust.money_receipts c on c.id = pr.farvision_receipt_id
    left join lateral (select * from cust.receipt_reversals x where x.unit_id = b.farvision_unit_id
                         and x.receipt_no = split_part(pr.receipt_no,'/'||pr.farvision_receipt_id,1) and x.deleted_at is null and x.is_current order by x.id limit 1) rv on true
    where pr.farvision_receipt_id is not null and pr.status = 'active'
      and (rv.receipt_reversal_no is not null or c.id is null or not c.is_current or c.deleted_at is not null)
  loop
    update postsales.receipts set status = 'reversed', reversal_no = coalesce(r.receipt_reversal_no, 'FARVISION'),
           reversal_date = coalesce(r.receipt_reversal_date, current_date),
           reversal_reason = case when r.receipt_reversal_no is not null then r.why else 'Removed from Farvision''s receipt register' end,
           reversed_by = 'farvision-sync', updated_at = now()
     where id = r.id;
    n_rc_rev := n_rc_rev + 1; touched := touched || r.booking_id;
  end loop;

  -- 7. bookings cancelled in Farvision
  for r in select b.id, b.flat_id from postsales.bookings b join cust.units u on u.id = b.farvision_unit_id
            where b.status = 'active' and (u.status = 'cancelled' or u.deleted_at is not null) loop
    update postsales.bookings set status = 'cancelled', cancelled_on = current_date, cancel_reason = 'Cancelled in Farvision',
           closed_by = 'farvision-sync', updated_at = now() where id = r.id;
    update postsales.invoices set status = 'cancelled', cancelled_at = now(), cancelled_by = 'farvision-sync', cancel_reason = 'Booking cancelled in Farvision'
     where booking_id = r.id and status = 'open' and kind = 'milestone' and farvision_invoice_id is null;
    update postsales.flats set status = 'available', updated_at = now()
     where id = r.flat_id and not exists(select 1 from postsales.bookings x where x.flat_id = r.flat_id and x.status = 'active');
    n_bk_cx := n_bk_cx + 1; touched := touched || r.id;
  end loop;

  -- 8. late fee from the latest Customer Outstanding Summary
  select id, imported_at::date into v_batch, v_asof from cust.import_batches
   where import_type = 'outstanding' and status = 'completed' order by imported_at desc limit 1;
  if v_batch is not null then
    with fee as (
      select e->>'bookingNo' bno, max(coalesce(nullif(e->>'lateFee','')::numeric,0)) late
      from cust.import_batches bt, jsonb_array_elements(bt.raw_rows) e
      where bt.id = v_batch and e->>'bookingNo' is not null group by 1)
    update postsales.bookings b set fv_late_fee = coalesce(fee.late,0), fv_late_fee_as_of = v_asof
      from postsales.bookings b2 left join fee on fee.bno = b2.booking_no
     where b.id = b2.id and b.farvision_unit_id is not null
       and (b.fv_late_fee is distinct from coalesce(fee.late,0) or b.fv_late_fee_as_of is distinct from v_asof);
    get diagnostics n_fee = row_count;
  end if;

  -- 9. re-apply payments on everything that changed
  for r in select distinct unnest(touched) id loop
    perform postsales.reallocate_booking(r.id);
  end loop;

  update postsales.sync_runs set finished_at = now(), result = jsonb_build_object(
    'new_bookings', v_new->'imported', 'new_invoices', n_inv, 'invoices_cancelled', n_inv_cx, 'new_receipts', n_rc,
    'receipts_reversed', n_rc_rev, 'bookings_cancelled', n_bk_cx, 'late_fees_updated', n_fee) where id = v_run;
  return (select result from postsales.sync_runs where id = v_run);
exception when others then
  -- the run row is rolled back with the failed work, so log a fresh one and hand the error back to the caller
  insert into postsales.sync_runs(trigger, finished_at, error) values (p_trigger, now(), sqlerrm);
  return jsonb_build_object('error', sqlerrm);
end $$;
revoke all on function postsales.sync_farvision(text) from public;
grant execute on function postsales.sync_farvision(text) to authenticated;

-- Only when something new has been imported since the last successful run.
create or replace function postsales.sync_farvision_if_new() returns void
 language plpgsql security definer set search_path = postsales, public
as $$
begin
  if exists(select 1 from cust.import_batches b
             where b.imported_at > coalesce((select max(started_at) from postsales.sync_runs where error is null and finished_at is not null), '-infinity'))
  then perform postsales.sync_farvision('auto'); end if;
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'postsales-farvision-sync';
select cron.schedule('postsales-farvision-sync', '*/10 * * * *', $$select postsales.sync_farvision_if_new()$$);
