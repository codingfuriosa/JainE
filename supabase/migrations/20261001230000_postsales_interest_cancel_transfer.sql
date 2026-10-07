-- Post Sales, Stage 5: interest on late payment, cancellation, flat transfer. Spec §5-§7.
--
-- INTEREST (18% p.a., simple) is worked out per milestone invoice from its due date:
--   on every amount paid late  = amount x 18% x (receipt date - due date) / 365   ("paid late")
--   on what is still unpaid    = balance x 18% x (as-of date - due date) / 365    ("running")
-- It is only ever shown, never charged, until a user approves billing it: bill_interest() raises an
-- interest invoice (+18% GST) and records what it covered in interest_claims; waive_interest() records
-- a waiver with its reason. "Suggested" = paid-late interest not yet billed or waived.
-- Receipts go to interest invoices only when marked against interest - except on a cancelled or
-- transferred booking, where the settlement itself is the customer's agreement: there every receipt
-- pays principal first and then interest.
--
-- CANCELLATION: Rs 50,000 within 15 days of the application, else 10% of total consideration (incl.
-- EDC, excl. GST), + 18% GST, reducible/waivable with a reason. Open milestone invoices are cancelled
-- and the charge is raised as a 'cancellation' invoice; reallocation then applies everything received
-- to it (and to any billed interest). What is left over is the refund due (paid out through payouts);
-- if the money received doesn't cover it, the cancellation invoice simply stays outstanding -
-- recoverable, and receipts can still be taken against a cancelled booking for it.
--
-- TRANSFER (same customer, another flat): interest has to be billed or waived first. The old booking's
-- open milestone invoices are cancelled, its money pays any billed interest, and the balance moves to
-- the new booking - a 'transfer' payout (PTC/...) out of the old one and a 'transfer' receipt into the
-- new one. The new booking keeps the original booking date.

alter table postsales.bookings
  add column if not exists cancelled_on date,
  add column if not exists cancel_reason text,
  add column if not exists cancel_charge_calc numeric(14,2),
  add column if not exists cancel_charge numeric(14,2),
  add column if not exists cancel_waiver_reason text,
  add column if not exists cancellation_invoice_id bigint references postsales.invoices(id),
  add column if not exists transferred_to bigint references postsales.bookings(id),
  add column if not exists transferred_from bigint references postsales.bookings(id),
  add column if not exists closed_by text;

alter table postsales.receipts drop constraint if exists receipts_mode_check;
alter table postsales.receipts add constraint receipts_mode_check
  check (mode in ('net_banking','cheque','dd','rtgs_neft_imps','upi','cash','jv','transfer'));

create table if not exists postsales.interest_claims(
  id                  bigserial primary key,
  booking_id          bigint not null references postsales.bookings(id),
  source_invoice_id   bigint not null references postsales.invoices(id),
  kind                text not null check (kind in ('billed','waived')),
  amount              numeric(14,2) not null check (amount > 0),
  interest_invoice_id bigint references postsales.invoices(id),
  reason              text,
  created_at          timestamptz not null default now(),
  created_by          text default app.current_user_email()
);
create index if not exists interest_claims_source_idx on postsales.interest_claims (source_invoice_id);

create table if not exists postsales.payouts(
  id               bigserial primary key,
  project_id       bigint not null references cust.projects(id),
  booking_id       bigint not null references postsales.bookings(id),
  payout_no        text not null,
  kind             text not null check (kind in ('refund','transfer')),
  payout_date      date not null,
  amount           numeric(14,2) not null check (amount > 0),
  mode             text,
  instrument_no    text,
  bank_account_id  bigint references postsales.bank_accounts(id),
  to_booking_id    bigint references postsales.bookings(id),
  remarks          text,
  created_at       timestamptz not null default now(),
  created_by       text default app.current_user_email()
);
create unique index if not exists payouts_no_uq on postsales.payouts (payout_no);
create index if not exists payouts_booking_idx on postsales.payouts (booking_id);

-- ---------------------------------------------------------------------------
-- Allocation: on a cancelled / transferred booking principal receipts also pay interest (after principal).
-- ---------------------------------------------------------------------------
create or replace function postsales.reallocate_booking(p_booking_id bigint) returns void
 language plpgsql security invoker set search_path = postsales, public
as $$
declare
  rc record; inv record; v_rem numeric; v_open numeric; v_take numeric; v_settled boolean;
begin
  select status in ('cancelled','transferred') into v_settled from postsales.bookings where id = p_booking_id;
  delete from postsales.receipt_allocations a using postsales.receipts r
   where a.receipt_id = r.id and r.booking_id = p_booking_id;
  for rc in select id, amount, against_interest from postsales.receipts
             where booking_id = p_booking_id and status = 'active' order by receipt_date, id loop
    v_rem := rc.amount;
    for inv in select i.id, i.total from postsales.invoices i
                left join postsales.booking_milestones bm on bm.id = i.booking_milestone_id
                where i.booking_id = p_booking_id and i.status = 'open'
                  and (case when rc.against_interest then i.kind = 'interest'
                            when v_settled then true
                            else i.kind <> 'interest' end)
                order by (i.kind = 'interest') <> rc.against_interest, i.due_date, coalesce(bm.seq, 9999), i.invoice_date, i.id loop
      exit when v_rem <= 0;
      select inv.total - coalesce(sum(a.amount), 0) into v_open from postsales.receipt_allocations a where a.invoice_id = inv.id;
      continue when v_open <= 0;
      v_take := least(v_open, v_rem);
      insert into postsales.receipt_allocations(receipt_id, invoice_id, amount) values (rc.id, inv.id, v_take);
      v_rem := v_rem - v_take;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Interest per milestone invoice of one booking, as of a date.
-- ---------------------------------------------------------------------------
create or replace function postsales.interest_calc(p_booking_id bigint, p_as_of date)
 returns table(invoice_id bigint, invoice_no text, title text, due_date date, total numeric, paid numeric, balance numeric,
               days_overdue int, paid_late numeric, running numeric, billed numeric, waived numeric, suggested numeric)
 language sql stable security invoker set search_path = postsales, public
as $$
  with inv as (
    select i.* from postsales.invoices i
    where i.booking_id = p_booking_id and i.status = 'open' and i.kind = 'milestone'),
  al as (
    select a.invoice_id, a.amount, r.receipt_date from postsales.receipt_allocations a
    join postsales.receipts r on r.id = a.receipt_id and r.status = 'active'),
  cl as (
    select c.source_invoice_id,
           sum(c.amount) filter (where c.kind = 'billed' and ii.status = 'open') billed,
           sum(c.amount) filter (where c.kind = 'waived') waived
    from postsales.interest_claims c left join postsales.invoices ii on ii.id = c.interest_invoice_id
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
$$;
grant execute on function postsales.interest_calc(bigint, date) to authenticated;

-- One row per booking with any interest: for the Interest screen and the outstanding report.
create or replace function postsales.interest_summary(p_project_id bigint, p_as_of date)
 returns table(booking_id bigint, paid_late numeric, running numeric, billed numeric, waived numeric, suggested numeric)
 language sql stable security invoker set search_path = postsales, public
as $$
  select b.id, sum(c.paid_late), sum(c.running), sum(c.billed), sum(c.waived), sum(c.suggested)
  from postsales.bookings b cross join lateral postsales.interest_calc(b.id, p_as_of) c
  where b.status = 'active' and (p_project_id is null or b.project_id = p_project_id)
  group by b.id
  having sum(c.paid_late) + sum(c.running) > 0
$$;
grant execute on function postsales.interest_summary(bigint, date) to authenticated;

-- Approve: raise one interest invoice (+18% GST) covering the given amounts per source invoice.
-- p = {booking_id, invoice_date, items:[{source_invoice_id, amount}]}
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
  for it in select (x->>'source_invoice_id')::bigint sid, round((x->>'amount')::numeric, 2) amt from jsonb_array_elements(p->'items') x where (x->>'amount')::numeric > 0 loop
    v_seq := v_seq + 1;
    insert into postsales.interest_claims(booking_id, source_invoice_id, kind, amount, interest_invoice_id) values (b.id, it.sid, 'billed', it.amt, v_id);
    insert into postsales.invoice_lines(invoice_id, seq, head, col, net, gst_rate, gst, total)
    select v_id, v_seq, 'Interest @18% p.a. on ' || i.invoice_no || ' (' || i.title || ')', 'interest', it.amt, 18, 0, it.amt from postsales.invoices i where i.id = it.sid;
  end loop;
  v_seq := v_seq + 1;
  insert into postsales.invoice_lines(invoice_id, seq, head, col, net, gst_rate, gst, total) values (v_id, v_seq, 'GST @18%', 'interest', 0, 18, v_gst, v_gst);
  perform postsales.reallocate_booking(b.id);
  return v_id;
end $$;
grant execute on function postsales.bill_interest(jsonb) to authenticated;

create or replace function postsales.waive_interest(p jsonb) returns void
 language plpgsql security invoker set search_path = postsales, public
as $$
declare it record;
begin
  if coalesce(trim(p->>'reason'),'') = '' then raise exception 'A waiver needs a reason'; end if;
  for it in select (x->>'source_invoice_id')::bigint sid, round((x->>'amount')::numeric, 2) amt from jsonb_array_elements(p->'items') x where (x->>'amount')::numeric > 0 loop
    insert into postsales.interest_claims(booking_id, source_invoice_id, kind, amount, reason)
    values ((p->>'booking_id')::bigint, it.sid, 'waived', it.amt, p->>'reason');
  end loop;
end $$;
grant execute on function postsales.waive_interest(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Balances: payouts (refunds / transfers out) come off the advance.
-- ---------------------------------------------------------------------------
create or replace view postsales.booking_balances with (security_invoker = true) as
select b.id as booking_id, b.project_id, b.booking_no, b.status,
  coalesce(i.principal_invoiced,0) principal_invoiced,
  coalesce(i.interest_invoiced,0)  interest_invoiced,
  coalesce(r.principal_received,0) principal_received,
  coalesce(r.interest_received,0)  interest_received,
  coalesce(a.principal_applied,0)  principal_applied,
  coalesce(a.interest_applied,0)   interest_applied,
  coalesce(r.principal_received,0) + coalesce(r.interest_received,0) - coalesce(a.principal_applied,0) - coalesce(a.interest_applied,0) - coalesce(po.paid_out,0) as advance,
  coalesce(i.principal_invoiced,0) - coalesce(a.principal_applied,0) as principal_outstanding,
  coalesce(i.interest_invoiced,0)  - coalesce(a.interest_applied,0)  as interest_outstanding,
  coalesce(o.overdue,0) as principal_overdue,
  case when b.status = 'active' then b.grand_total - coalesce(i.principal_invoiced_milestones,0) else 0 end as not_yet_invoiced,
  coalesce(po.paid_out,0) as paid_out
from postsales.bookings b
left join (select booking_id,
             sum(total) filter (where kind <> 'interest') principal_invoiced,
             sum(total) filter (where kind = 'interest') interest_invoiced,
             sum(total) filter (where kind = 'milestone') principal_invoiced_milestones
           from postsales.invoices where status = 'open' group by 1) i on i.booking_id = b.id
left join (select booking_id,
             sum(amount) filter (where not against_interest) principal_received,
             sum(amount) filter (where against_interest) interest_received
           from postsales.receipts where status = 'active' group by 1) r on r.booking_id = b.id
left join (select i.booking_id,
             sum(a.amount) filter (where i.kind <> 'interest') principal_applied,
             sum(a.amount) filter (where i.kind = 'interest') interest_applied
           from postsales.receipt_allocations a join postsales.invoices i on i.id = a.invoice_id
           where i.status = 'open' group by 1) a on a.booking_id = b.id
left join (select i.booking_id, sum(i.total - coalesce((select sum(x.amount) from postsales.receipt_allocations x where x.invoice_id = i.id),0)) overdue
           from postsales.invoices i where i.status = 'open' and i.kind <> 'interest' and i.due_date < current_date group by 1) o on o.booking_id = b.id
left join (select booking_id, sum(amount) paid_out from postsales.payouts group by 1) po on po.booking_id = b.id;
grant select on postsales.booking_balances to authenticated;

-- ---------------------------------------------------------------------------
-- Receipts: also allowed on a cancelled booking (recovering a cancellation shortfall).
-- ---------------------------------------------------------------------------
create or replace function postsales.save_receipt(p jsonb) returns bigint
 language plpgsql security invoker set search_path = postsales, public
as $$
declare
  v_b postsales.bookings; v_id bigint;
begin
  select * into v_b from postsales.bookings where id = (p->>'booking_id')::bigint for update;
  if not found then raise exception 'Booking not found'; end if;
  if v_b.status = 'transferred' then raise exception 'Booking % was transferred - record the payment on the new booking', v_b.booking_no; end if;
  insert into postsales.receipts(project_id, booking_id, receipt_no, receipt_date, mode, instrument_no, instrument_date,
      drawn_on, drawn_branch, bank_account_id, amount, narration, paid_by, against_interest, attachments)
  values (v_b.project_id, v_b.id, postsales.next_doc_no(v_b.project_id, 'MR', (p->>'receipt_date')::date),
      (p->>'receipt_date')::date, p->>'mode', nullif(p->>'instrument_no',''), nullif(p->>'instrument_date','')::date,
      nullif(p->>'drawn_on',''), nullif(p->>'drawn_branch',''), nullif(p->>'bank_account_id','')::bigint,
      (p->>'amount')::numeric, nullif(p->>'narration',''), nullif(p->>'paid_by',''),
      coalesce((p->>'against_interest')::boolean, false), coalesce(p->'attachments','[]'::jsonb))
  returning id into v_id;
  perform postsales.reallocate_booking(v_b.id);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Cancellation. p = {booking_id, date, reason, charge (net, after any waiver), waiver_reason}
-- ---------------------------------------------------------------------------
create or replace function postsales.cancellation_charge(p_booking_id bigint, p_date date) returns numeric
 language sql stable security invoker set search_path = postsales, public
as $$
  select case when p_date - b.booking_date <= 15 then 50000 else round(b.total_consideration * 0.10) end
  from postsales.bookings b where b.id = p_booking_id
$$;
grant execute on function postsales.cancellation_charge(bigint, date) to authenticated;

create or replace function postsales.cancel_booking(p jsonb) returns jsonb
 language plpgsql security invoker set search_path = postsales, public
as $$
declare
  b postsales.bookings; v_date date := (p->>'date')::date; v_calc numeric; v_charge numeric := round(coalesce((p->>'charge')::numeric,0), 2);
  v_inv bigint; v_gst numeric; bal record;
begin
  select * into b from postsales.bookings where id = (p->>'booking_id')::bigint for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status <> 'active' then raise exception 'Booking % is already %', b.booking_no, b.status; end if;
  if coalesce(trim(p->>'reason'),'') = '' then raise exception 'Enter the reason for cancelling'; end if;
  v_calc := postsales.cancellation_charge(b.id, v_date);
  if v_charge < 0 or v_charge > v_calc then raise exception 'The charge must be between 0 and %', v_calc; end if;
  if v_charge < v_calc and coalesce(trim(p->>'waiver_reason'),'') = '' then raise exception 'Enter the reason for reducing the cancellation charge'; end if;

  update postsales.invoices set status = 'cancelled', cancelled_at = now(), cancelled_by = app.current_user_email(), cancel_reason = 'Booking cancelled'
   where booking_id = b.id and kind = 'milestone' and status = 'open';
  if v_charge > 0 then
    v_gst := round(v_charge * 0.18);
    insert into postsales.invoices(project_id, booking_id, invoice_no, invoice_date, due_date, kind, title, net, gst, total, raised_via, remarks)
    values (b.project_id, b.id, postsales.next_doc_no(b.project_id, 'INV', v_date), v_date, v_date + 30, 'cancellation', 'Cancellation charges',
            v_charge, v_gst, v_charge + v_gst, 'system',
            case when v_date - b.booking_date <= 15 then 'Cancelled within 15 days of application: Rs 50,000 + GST'
                 else '10% of total consideration (Rs ' || b.total_consideration || ') + GST' end
            || case when v_charge < v_calc then ' - reduced from ' || v_calc || ': ' || (p->>'waiver_reason') else '' end)
    returning id into v_inv;
    insert into postsales.invoice_lines(invoice_id, seq, head, col, net, gst_rate, gst, total)
    values (v_inv, 1, 'Cancellation charges', 'other', v_charge, 18, v_gst, v_charge + v_gst);
  end if;
  update postsales.bookings set status = 'cancelled', cancelled_on = v_date, cancel_reason = p->>'reason',
         cancel_charge_calc = v_calc, cancel_charge = v_charge, cancel_waiver_reason = nullif(p->>'waiver_reason',''),
         cancellation_invoice_id = v_inv, closed_by = app.current_user_email(), updated_at = now()
   where id = b.id;
  update postsales.flats set status = 'available', updated_at = now() where id = b.flat_id;
  perform postsales.reallocate_booking(b.id);
  select * into bal from postsales.booking_balances where booking_id = b.id;
  return jsonb_build_object('refund_due', greatest(bal.advance, 0), 'recoverable', greatest(bal.principal_outstanding + bal.interest_outstanding, 0));
end $$;
grant execute on function postsales.cancel_booking(jsonb) to authenticated;

-- Refund (or any payment back to the customer) out of a booking's unapplied balance.
create or replace function postsales.save_refund(p jsonb) returns bigint
 language plpgsql security invoker set search_path = postsales, public
as $$
declare b postsales.bookings; bal record; v_id bigint;
begin
  select * into b from postsales.bookings where id = (p->>'booking_id')::bigint for update;
  if not found then raise exception 'Booking not found'; end if;
  select * into bal from postsales.booking_balances where booking_id = b.id;
  if (p->>'amount')::numeric > bal.advance + 0.5 then raise exception 'Only % is left to refund on this booking', round(bal.advance); end if;
  insert into postsales.payouts(project_id, booking_id, payout_no, kind, payout_date, amount, mode, instrument_no, bank_account_id, remarks)
  values (b.project_id, b.id, postsales.next_doc_no(b.project_id, 'RF', (p->>'date')::date), 'refund', (p->>'date')::date, (p->>'amount')::numeric,
          nullif(p->>'mode',''), nullif(p->>'instrument_no',''), nullif(p->>'bank_account_id','')::bigint, nullif(p->>'remarks',''))
  returning id into v_id;
  return v_id;
end $$;
grant execute on function postsales.save_refund(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Transfer: p = {from_id, to_id, date, remarks}. The new booking (to_id) is saved first, normally.
-- ---------------------------------------------------------------------------
create or replace function postsales.transfer_booking(p jsonb) returns jsonb
 language plpgsql security invoker set search_path = postsales, public
as $$
declare
  f postsales.bookings; t postsales.bookings; v_date date := (p->>'date')::date; v_open numeric; bal record; v_amt numeric;
  v_ptc text; v_rid bigint;
begin
  select * into f from postsales.bookings where id = (p->>'from_id')::bigint for update;
  select * into t from postsales.bookings where id = (p->>'to_id')::bigint for update;
  if f.id is null or t.id is null then raise exception 'Booking not found'; end if;
  if f.status <> 'active' then raise exception 'Booking % is %', f.booking_no, f.status; end if;
  if t.status <> 'active' or f.id = t.id then raise exception 'Choose a different, active booking to transfer to'; end if;
  select coalesce(sum(paid_late + running - billed - waived),0) into v_open from postsales.interest_calc(f.id, v_date);
  if v_open > 1 then raise exception 'Interest of Rs % on % is not settled - bill it or waive it first', round(v_open), f.booking_no; end if;

  update postsales.invoices set status = 'cancelled', cancelled_at = now(), cancelled_by = app.current_user_email(), cancel_reason = 'Booking transferred to ' || t.booking_no
   where booking_id = f.id and kind = 'milestone' and status = 'open';
  update postsales.bookings set status = 'transferred', transferred_to = t.id, cancelled_on = v_date, closed_by = app.current_user_email(), updated_at = now() where id = f.id;
  update postsales.bookings set transferred_from = f.id, updated_at = now() where id = t.id;
  update postsales.flats set status = 'available', updated_at = now() where id = f.flat_id;
  perform postsales.reallocate_booking(f.id);
  select * into bal from postsales.booking_balances where booking_id = f.id;
  v_amt := round(greatest(bal.advance, 0), 2);
  if v_amt > 0 then
    v_ptc := postsales.next_doc_no(f.project_id, 'PTC', v_date);
    insert into postsales.payouts(project_id, booking_id, payout_no, kind, payout_date, amount, mode, to_booking_id, remarks)
    values (f.project_id, f.id, v_ptc, 'transfer', v_date, v_amt, 'transfer', t.id, coalesce(nullif(p->>'remarks',''), 'Flat transfer to ' || t.booking_no));
    insert into postsales.receipts(project_id, booking_id, receipt_no, receipt_date, mode, instrument_no, amount, narration, paid_by)
    values (t.project_id, t.id, postsales.next_doc_no(t.project_id, 'MR', v_date), v_date, 'transfer', v_ptc, v_amt,
            'Transferred from ' || f.booking_no, 'Transfer from ' || f.booking_no)
    returning id into v_rid;
    perform postsales.reallocate_booking(t.id);
  end if;
  return jsonb_build_object('amount', v_amt, 'ptc', v_ptc);
end $$;
grant execute on function postsales.transfer_booking(jsonb) to authenticated;

do $rls$
declare t text;
begin
  foreach t in array array['interest_claims','payouts'] loop
    execute format('alter table postsales.%I enable row level security', t);
    execute format('drop policy if exists %I on postsales.%I', t || '_staff_all', t);
    execute format('create policy %I on postsales.%I for all to authenticated using (not app.is_customer()) with check (not app.is_customer())', t || '_staff_all', t);
    execute format('grant select, insert, update, delete on postsales.%I to authenticated', t);
  end loop;
end $rls$;
grant usage, select on all sequences in schema postsales to authenticated;
