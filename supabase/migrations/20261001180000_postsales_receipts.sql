-- Post Sales, Stage 3: Money Received. See docs/post-sales-spec.md section 3.
--
-- Receipts are applied to a booking's open invoices oldest-due first (FIFO). Money received before any
-- invoice exists - or more than is due - is simply left unapplied: that IS the "advance against
-- booking", and it is applied automatically the next time allocation runs (any receipt saved or
-- reversed, any invoice raised or cancelled). Allocation is always recomputed from scratch for the
-- whole booking by postsales.reallocate_booking(), so it can never drift out of step.
--
-- A receipt goes to principal (milestone / charge / cancellation invoices) unless it is marked
-- against_interest - the customer has agreed the payment is for interest - in which case it goes only
-- to interest invoices. No verification step: a receipt is live the moment it is saved.
--
-- The invoice tables are created here (empty until Stage 4 raises demands) because allocation needs them.

alter table postsales.project_setup add column if not exists company_name text;
comment on column postsales.project_setup.company_name is 'Legal entity receipts/invoices are issued in (e.g. Dream Gateway Hotels Ltd.).';

create table if not exists postsales.bank_accounts(
  id            bigserial primary key,
  project_id    bigint references cust.projects(id),
  name          text not null,
  bank_name     text,
  account_no    text,
  ifsc          text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    text
);
comment on column postsales.bank_accounts.project_id is 'null = usable on every project.';

create table if not exists postsales.invoices(
  id                    bigserial primary key,
  project_id            bigint not null references cust.projects(id),
  booking_id            bigint not null references postsales.bookings(id),
  invoice_no            text not null,
  invoice_date          date not null,
  due_date              date not null,
  kind                  text not null check (kind in ('milestone','interest','cancellation','charge')),
  booking_milestone_id  bigint references postsales.booking_milestones(id),
  title                 text not null,
  net                   numeric(14,2) not null default 0,
  gst                   numeric(14,2) not null default 0,
  total                 numeric(14,2) not null default 0,
  status                text not null default 'open' check (status in ('open','cancelled')),
  raised_via            text not null default 'individual' check (raised_via in ('individual','bulk','late_booking','import','system')),
  stage_event_id        bigint,
  remarks               text,
  cancelled_at          timestamptz,
  cancelled_by          text,
  cancel_reason         text,
  created_at            timestamptz not null default now(),
  created_by            text default app.current_user_email()
);
create unique index if not exists invoices_no_uq on postsales.invoices (invoice_no);
create index if not exists invoices_booking_idx on postsales.invoices (booking_id, due_date);
create unique index if not exists invoices_milestone_uq on postsales.invoices (booking_milestone_id) where status = 'open' and booking_milestone_id is not null;

create table if not exists postsales.invoice_lines(
  id            bigserial primary key,
  invoice_id    bigint not null references postsales.invoices(id) on delete cascade,
  seq           int not null default 0,
  head          text not null,
  col           text check (col in ('unit','parking','edc','other','interest')),
  net           numeric(14,2) not null default 0,
  gst_rate      numeric(5,2),
  gst           numeric(14,2) not null default 0,
  total         numeric(14,2) not null default 0
);
create index if not exists invoice_lines_invoice_idx on postsales.invoice_lines (invoice_id, seq);

create table if not exists postsales.receipts(
  id               bigserial primary key,
  project_id       bigint not null references cust.projects(id),
  booking_id       bigint not null references postsales.bookings(id),
  receipt_no       text not null,
  receipt_date     date not null,
  mode             text not null check (mode in ('net_banking','cheque','dd','rtgs_neft_imps','upi','cash','jv')),
  instrument_no    text,
  instrument_date  date,
  drawn_on         text,
  drawn_branch     text,
  bank_account_id  bigint references postsales.bank_accounts(id),
  amount           numeric(14,2) not null check (amount > 0),
  narration        text,
  paid_by          text,
  against_interest boolean not null default false,
  attachments      jsonb not null default '[]'::jsonb,
  status           text not null default 'active' check (status in ('active','reversed')),
  reversal_no      text,
  reversal_date    date,
  reversal_reason  text,
  reversed_by      text,
  dishonour_invoice_id bigint references postsales.invoices(id),
  created_at       timestamptz not null default now(),
  created_by       text default app.current_user_email(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists receipts_no_uq on postsales.receipts (receipt_no);
create index if not exists receipts_booking_idx on postsales.receipts (booking_id, receipt_date);
create index if not exists receipts_project_date_idx on postsales.receipts (project_id, receipt_date desc);

create table if not exists postsales.receipt_allocations(
  receipt_id    bigint not null references postsales.receipts(id) on delete cascade,
  invoice_id    bigint not null references postsales.invoices(id) on delete cascade,
  amount        numeric(14,2) not null,
  primary key (receipt_id, invoice_id)
);
create index if not exists receipt_allocations_invoice_idx on postsales.receipt_allocations (invoice_id);

-- ---------------------------------------------------------------------------
-- reallocate_booking: recompute every allocation of one booking, oldest receipt into oldest-due invoice.
-- ---------------------------------------------------------------------------
create or replace function postsales.reallocate_booking(p_booking_id bigint) returns void
 language plpgsql security invoker set search_path = postsales, public
as $$
declare
  rc record; inv record; v_rem numeric; v_open numeric; v_take numeric;
begin
  delete from postsales.receipt_allocations a using postsales.receipts r
   where a.receipt_id = r.id and r.booking_id = p_booking_id;
  for rc in select id, amount, against_interest from postsales.receipts
             where booking_id = p_booking_id and status = 'active' order by receipt_date, id loop
    v_rem := rc.amount;
    for inv in select i.id, i.total from postsales.invoices i
                where i.booking_id = p_booking_id and i.status = 'open'
                  and (case when rc.against_interest then i.kind = 'interest' else i.kind <> 'interest' end)
                order by i.due_date, i.invoice_date, i.id loop
      exit when v_rem <= 0;
      select inv.total - coalesce(sum(a.amount), 0) into v_open from postsales.receipt_allocations a where a.invoice_id = inv.id;
      continue when v_open <= 0;
      v_take := least(v_open, v_rem);
      insert into postsales.receipt_allocations(receipt_id, invoice_id, amount) values (rc.id, inv.id, v_take);
      v_rem := v_rem - v_take;
    end loop;
  end loop;
end $$;
grant execute on function postsales.reallocate_booking(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Per-booking position: what has been invoiced, received, applied, what is left as advance, and what
-- is outstanding / overdue - principal and interest kept apart.
-- ---------------------------------------------------------------------------
create or replace view postsales.booking_balances with (security_invoker = true) as
select b.id as booking_id, b.project_id, b.booking_no, b.status,
  coalesce(i.principal_invoiced,0) principal_invoiced,
  coalesce(i.interest_invoiced,0)  interest_invoiced,
  coalesce(r.principal_received,0) principal_received,
  coalesce(r.interest_received,0)  interest_received,
  coalesce(a.principal_applied,0)  principal_applied,
  coalesce(a.interest_applied,0)   interest_applied,
  coalesce(r.principal_received,0) - coalesce(a.principal_applied,0) as advance,
  coalesce(i.principal_invoiced,0) - coalesce(a.principal_applied,0) as principal_outstanding,
  coalesce(i.interest_invoiced,0)  - coalesce(a.interest_applied,0)  as interest_outstanding,
  coalesce(o.overdue,0) as principal_overdue,
  b.grand_total - coalesce(i.principal_invoiced_milestones,0) as not_yet_invoiced
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
           from postsales.invoices i where i.status = 'open' and i.kind <> 'interest' and i.due_date < current_date group by 1) o on o.booking_id = b.id;
grant select on postsales.booking_balances to authenticated;

-- ---------------------------------------------------------------------------
-- save_receipt / reverse_receipt
-- ---------------------------------------------------------------------------
create or replace function postsales.save_receipt(p jsonb) returns bigint
 language plpgsql security invoker set search_path = postsales, public
as $$
declare
  v_b postsales.bookings; v_id bigint;
begin
  select * into v_b from postsales.bookings where id = (p->>'booking_id')::bigint for update;
  if not found then raise exception 'Booking not found'; end if;
  if v_b.status <> 'active' then raise exception 'Booking % is %', v_b.booking_no, v_b.status; end if;
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
grant execute on function postsales.save_receipt(jsonb) to authenticated;

-- Reversal (bounce / wrong entry): the receipt stays on record, stops counting, and the booking is
-- re-allocated. Optionally raises a cheque-dishonour charge invoice (amount + 18% GST, due in 30 days).
create or replace function postsales.reverse_receipt(p_receipt_id bigint, p_date date, p_reason text, p_charge numeric)
 returns void language plpgsql security invoker set search_path = postsales, public
as $$
declare
  v_r postsales.receipts; v_inv bigint; v_gst numeric;
begin
  select * into v_r from postsales.receipts where id = p_receipt_id for update;
  if not found then raise exception 'Receipt not found'; end if;
  if v_r.status <> 'active' then raise exception 'Receipt % is already reversed', v_r.receipt_no; end if;
  if coalesce(p_charge,0) > 0 then
    v_gst := round(p_charge * 0.18);
    insert into postsales.invoices(project_id, booking_id, invoice_no, invoice_date, due_date, kind, title, net, gst, total, raised_via, remarks)
    values (v_r.project_id, v_r.booking_id, postsales.next_doc_no(v_r.project_id, 'INV', p_date), p_date, p_date + 30, 'charge',
            'Cheque Dishonoured Charges', p_charge, v_gst, p_charge + v_gst, 'system', 'Against reversed receipt ' || v_r.receipt_no)
    returning id into v_inv;
    insert into postsales.invoice_lines(invoice_id, seq, head, col, net, gst_rate, gst, total)
    values (v_inv, 1, 'Cheque Dishonoured Charges', 'other', p_charge, 18, v_gst, p_charge + v_gst);
  end if;
  update postsales.receipts set status = 'reversed', reversal_no = postsales.next_doc_no(v_r.project_id, 'RR', p_date),
         reversal_date = p_date, reversal_reason = p_reason, reversed_by = app.current_user_email(),
         dishonour_invoice_id = v_inv, updated_at = now()
   where id = p_receipt_id;
  perform postsales.reallocate_booking(v_r.booking_id);
end $$;
grant execute on function postsales.reverse_receipt(bigint, date, text, numeric) to authenticated;

do $rls$
declare t text;
begin
  foreach t in array array['bank_accounts','invoices','invoice_lines','receipts','receipt_allocations'] loop
    execute format('alter table postsales.%I enable row level security', t);
    execute format('drop policy if exists %I on postsales.%I', t || '_staff_all', t);
    execute format('create policy %I on postsales.%I for all to authenticated using (not app.is_customer()) with check (not app.is_customer())', t || '_staff_all', t);
    execute format('grant select, insert, update, delete on postsales.%I to authenticated', t);
  end loop;
end $rls$;
grant usage, select on all sequences in schema postsales to authenticated;

update postsales.project_setup set company_name = 'Dream Gateway Hotels Ltd.' where project_id = 1 and company_name is null;
