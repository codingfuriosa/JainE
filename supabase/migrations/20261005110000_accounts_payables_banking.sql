-- Accounts module, part 2: bills payable (payments, on-account payments and adjustments), bank reconciliation,
-- cheque books and cheque printing. See docs/accounts-spec.md.

-- ---------------------------------------------------------------------------
-- Payables: every bill (and every retention held back from an RA bill) that a vendor / contractor is owed.
-- Created by the posting of the bill; settled by payments and on-account adjustments (allocations).
-- ---------------------------------------------------------------------------
create table if not exists accounts.payables(
  id                bigserial primary key,
  company_id        bigint not null references accounts.companies(id),
  business_unit_id  bigint references accounts.business_units(id),
  vendor_id         bigint not null references purchase.vendors(id),
  sub_ledger_id     bigint not null references accounts.sub_ledgers(id),
  kind              text not null check (kind in ('bill','retention')),
  ref_no            text,
  ref_date          date,
  due_date          date,
  amount            numeric(16,2) not null check (amount > 0),
  voucher_id        bigint not null references accounts.vouchers(id),
  source_type       text,
  source_id         bigint,
  status            text not null default 'open' check (status in ('open','cancelled')),
  created_at        timestamptz not null default now()
);
create index if not exists payables_vendor_idx on accounts.payables (company_id, vendor_id, status);
create index if not exists payables_voucher_idx on accounts.payables (voucher_id);
comment on column accounts.payables.amount is 'What the vendor is owed on this document: bill = total less TDS (and less retention on an RA bill); retention = the amount held back.';

create table if not exists accounts.payable_allocations(
  id               bigserial primary key,
  company_id       bigint not null references accounts.companies(id),
  payable_id       bigint not null references accounts.payables(id),
  from_voucher_id  bigint not null references accounts.vouchers(id),
  kind             text not null check (kind in ('payment','adjustment','debit_note')),
  amount           numeric(16,2) not null check (amount > 0),
  alloc_date       date not null default current_date,
  status           text not null default 'active' check (status in ('active','cancelled')),
  created_at       timestamptz not null default now(),
  created_by       text default app.current_user_email(),
  cancelled_at     timestamptz,
  cancelled_by     text
);
create index if not exists payable_alloc_payable_idx on accounts.payable_allocations (payable_id) where status = 'active';
create index if not exists payable_alloc_voucher_idx on accounts.payable_allocations (from_voucher_id) where status = 'active';
comment on table accounts.payable_allocations is 'payment: a payment voucher paying this bill; adjustment: an earlier on-account payment (or debit note balance) set against this bill; debit_note: a posted debit note reducing its bill.';

create or replace view accounts.v_payables with (security_invoker = true) as
select p.id, p.company_id, p.business_unit_id, p.vendor_id, p.sub_ledger_id, p.kind, p.ref_no, p.ref_date, p.due_date, p.amount, p.voucher_id,
       v.doc_no as voucher_no, p.source_type, p.source_id, p.status,
       coalesce(a.settled, 0) as settled, p.amount - coalesce(a.settled, 0) as outstanding
  from accounts.payables p
  join accounts.vouchers v on v.id = p.voucher_id
  left join (select payable_id, sum(amount) as settled from accounts.payable_allocations where status = 'active' group by payable_id) a on a.payable_id = p.id;

-- Money paid (or credited) to a vendor that has not been set against a bill: on-account payments and debit-note balances.
create or replace view accounts.v_on_account with (security_invoker = true) as
select v.id as voucher_id, v.company_id, v.business_unit_id, v.doc_no, v.voucher_date, v.voucher_type, v.narration, v.payee,
       l.sub_ledger_id, l.dr as amount,
       coalesce((select sum(a.amount) from accounts.payable_allocations a join accounts.payables p on p.id = a.payable_id
                  where a.from_voucher_id = v.id and a.status = 'active' and p.kind = 'bill' and p.sub_ledger_id = l.sub_ledger_id), 0) as used
  from accounts.vouchers v
  join accounts.voucher_lines l on l.voucher_id = v.id
  join accounts.ledgers g on g.id = l.ledger_id
 where v.status = 'posted' and g.system_key = 'vendor_control' and l.dr > 0;

-- ---------------------------------------------------------------------------
-- Paying a vendor: against bills, against retention, and / or on account.
-- p_head = {company_id, business_unit_id, vendor_id, bank_ledger_id, voucher_date, mode, instrument_no, instrument_date, payee, narration, on_account}
-- p_allocs = [{payable_id, amount}]
-- ---------------------------------------------------------------------------
create or replace function accounts.vendor_payment(p_head jsonb, p_allocs jsonb) returns bigint
 language plpgsql security definer set search_path = accounts, public as $fn$
declare
  me text; v_company bigint; v_vendor bigint; v_bank accounts.ledgers; v_date date; v_vc bigint; v_rp bigint; v_sub_v bigint; v_sub_r bigint;
  a jsonb; p accounts.payables; v_amt numeric; v_bill numeric := 0; v_ret numeric := 0; v_on numeric; v_total numeric; v_lines jsonb := '[]'::jsonb;
  v_id bigint; v_name text; v_legal text; v_out numeric; v_mode text; v_seen bigint[] := '{}';
begin
  me := accounts._guard_post();
  v_company := nullif(p_head->>'company_id', '')::bigint;
  v_vendor := nullif(p_head->>'vendor_id', '')::bigint;
  v_date := nullif(p_head->>'voucher_date', '')::date;
  v_mode := nullif(p_head->>'mode', '');
  if not exists (select 1 from accounts.companies where id = v_company and active) then raise exception 'Choose the company'; end if;
  if v_date is null then raise exception 'Enter the payment date'; end if;
  if v_date > current_date then raise exception 'A payment cannot be dated in the future'; end if;
  if v_mode is null then raise exception 'Choose the mode (cheque, transfer, cash ...)'; end if;
  select * into v_bank from accounts.ledgers where id = nullif(p_head->>'bank_ledger_id', '')::bigint and company_id = v_company and (is_bank or is_cash) and active;
  if not found then raise exception 'Choose the bank or cash account the payment is made from'; end if;
  select coalesce(nullif(trade_name, ''), legal_name) || ' (' || code || ')', legal_name into v_name, v_legal from purchase.vendors where id = v_vendor and deleted_at is null;
  if v_name is null then raise exception 'Choose the vendor'; end if;
  for a in select * from jsonb_array_elements(coalesce(p_allocs, '[]'::jsonb)) loop
    select * into p from accounts.payables where id = nullif(a->>'payable_id', '')::bigint for update;
    if not found or p.company_id <> v_company or p.vendor_id <> v_vendor or p.status <> 'open' then raise exception 'A bill chosen for payment is not open for this vendor'; end if;
    if p.id = any (v_seen) then raise exception 'The same bill is listed twice'; end if;
    v_seen := v_seen || p.id;
    v_amt := round(coalesce(nullif(a->>'amount', ''), '0')::numeric, 2);
    if v_amt <= 0 then continue; end if;
    select outstanding into v_out from accounts.v_payables where id = p.id;
    if v_amt > v_out + 0.004 then raise exception 'Cannot pay % against %: only % is outstanding', v_amt, coalesce(p.ref_no, 'the bill'), v_out; end if;
    if p.kind = 'bill' then v_bill := v_bill + v_amt; else v_ret := v_ret + v_amt; end if;
  end loop;
  v_on := round(coalesce(nullif(p_head->>'on_account', '')::numeric, 0), 2);
  if v_on < 0 then raise exception 'The on-account amount cannot be negative'; end if;
  v_total := v_bill + v_ret + v_on;
  if v_total <= 0 then raise exception 'Enter an amount to pay'; end if;
  v_vc := accounts._key_ledger(v_company, 'vendor_control');
  v_sub_v := accounts._sub_ledger(v_vc, 'vendor', v_vendor, v_name);
  if v_bill + v_on > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('ledger_id', v_vc, 'sub_ledger_id', v_sub_v, 'dr', v_bill + v_on,
                 'narration', case when v_on > 0 and v_bill = 0 then 'On account' when v_on > 0 then 'Against bills and on account' else 'Against bills' end));
  end if;
  if v_ret > 0 then
    v_rp := accounts._key_ledger(v_company, 'retention_payable');
    v_sub_r := accounts._sub_ledger(v_rp, 'vendor', v_vendor, v_name);
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('ledger_id', v_rp, 'sub_ledger_id', v_sub_r, 'dr', v_ret, 'narration', 'Retention released'));
  end if;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('ledger_id', v_bank.id, 'cr', v_total));
  v_id := accounts._insert_voucher(v_company, nullif(p_head->>'business_unit_id', '')::bigint, 'payment', v_date, coalesce(nullif(btrim(p_head->>'narration'), ''), 'Payment to ' || v_name),
            v_mode, p_head->>'instrument_no', nullif(p_head->>'instrument_date', '')::date, coalesce(nullif(btrim(p_head->>'payee'), ''), v_legal), null, null, v_lines);
  for a in select * from jsonb_array_elements(coalesce(p_allocs, '[]'::jsonb)) loop
    v_amt := round(coalesce(nullif(a->>'amount', ''), '0')::numeric, 2);
    if v_amt > 0 then
      insert into accounts.payable_allocations(company_id, payable_id, from_voucher_id, kind, amount, alloc_date)
      values (v_company, (a->>'payable_id')::bigint, v_id, 'payment', v_amt, v_date);
    end if;
  end loop;
  return v_id;
end $fn$;
revoke all on function accounts.vendor_payment(jsonb, jsonb) from public, anon;
grant execute on function accounts.vendor_payment(jsonb, jsonb) to authenticated;

-- Sets an on-account payment (or a debit-note balance) against bills of the same vendor. No ledger entry is needed:
-- the vendor's sub-ledger already holds both the advance and the bill.
create or replace function accounts.on_account_adjust(p_voucher_id bigint, p_allocs jsonb, p_date date default current_date) returns int
 language plpgsql security definer set search_path = accounts, public as $fn$
declare
  me text; v accounts.vouchers; v_sub bigint; v_avail numeric; v_total numeric := 0; a jsonb; p accounts.payables; v_amt numeric; v_out numeric; n int := 0; v_seen bigint[] := '{}';
begin
  me := accounts._guard_post();
  select * into v from accounts.vouchers where id = p_voucher_id for update;
  if not found or v.status <> 'posted' then raise exception 'That payment is not available'; end if;
  if p_date is null or p_date < v.voucher_date then raise exception 'The adjustment date cannot be before the payment date'; end if;
  if p_date > current_date then raise exception 'The adjustment cannot be dated in the future'; end if;
  perform accounts._check_open(v.company_id, p_date);
  select count(distinct sub_ledger_id), min(sub_ledger_id), sum(amount - used) into n, v_sub, v_avail from accounts.v_on_account where voucher_id = p_voucher_id;
  if coalesce(n, 0) <> 1 then raise exception 'This entry has no on-account balance to adjust'; end if;
  n := 0;
  for a in select * from jsonb_array_elements(coalesce(p_allocs, '[]'::jsonb)) loop
    select * into p from accounts.payables where id = nullif(a->>'payable_id', '')::bigint for update;
    if not found or p.company_id <> v.company_id or p.sub_ledger_id <> v_sub or p.status <> 'open' or p.kind <> 'bill' then raise exception 'A bill chosen is not an open bill of this vendor'; end if;
    if p.id = any (v_seen) then raise exception 'The same bill is listed twice'; end if;
    v_seen := v_seen || p.id;
    v_amt := round(coalesce(nullif(a->>'amount', ''), '0')::numeric, 2);
    if v_amt <= 0 then continue; end if;
    select outstanding into v_out from accounts.v_payables where id = p.id;
    if v_amt > v_out + 0.004 then raise exception 'Cannot adjust % against %: only % is outstanding', v_amt, coalesce(p.ref_no, 'the bill'), v_out; end if;
    v_total := v_total + v_amt;
    insert into accounts.payable_allocations(company_id, payable_id, from_voucher_id, kind, amount, alloc_date) values (v.company_id, p.id, p_voucher_id, 'adjustment', v_amt, p_date);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Enter the amount to adjust against at least one bill'; end if;
  if v_total > v_avail + 0.004 then raise exception 'Only % of % is still on account', v_avail, v.doc_no; end if;
  insert into accounts.doc_log(doc_type, doc_id, action, remark) values ('voucher', p_voucher_id, 'On-account adjusted', v_total::text || ' against ' || n || ' bill(s)');
  return n;
end $fn$;
revoke all on function accounts.on_account_adjust(bigint, jsonb, date) from public, anon;
grant execute on function accounts.on_account_adjust(bigint, jsonb, date) to authenticated;

create or replace function accounts.cancel_allocation(p_id bigint) returns void
 language plpgsql security definer set search_path = accounts, public as $fn$
declare a accounts.payable_allocations; me text;
begin
  me := accounts._guard_post();
  select * into a from accounts.payable_allocations where id = p_id for update;
  if not found or a.status <> 'active' then raise exception 'Adjustment not found'; end if;
  if a.kind <> 'adjustment' then raise exception 'Only an on-account adjustment can be undone here - cancel the payment itself to reopen the bill'; end if;
  perform accounts._check_open(a.company_id, a.alloc_date);
  update accounts.payable_allocations set status = 'cancelled', cancelled_at = now(), cancelled_by = me where id = p_id;
  insert into accounts.doc_log(doc_type, doc_id, action, remark) values ('voucher', a.from_voucher_id, 'Adjustment undone', a.amount::text);
end $fn$;
revoke all on function accounts.cancel_allocation(bigint) from public, anon;
grant execute on function accounts.cancel_allocation(bigint) to authenticated;

-- Cancel a manual voucher. Bills it settled become open again, and any cheque printed for it is voided.
create or replace function accounts.voucher_cancel(p_id bigint, p_reason text) returns void
 language plpgsql security definer set search_path = accounts, public as $fn$
declare me text;
begin
  me := accounts._guard_post();
  perform accounts._cancel_voucher(p_id, p_reason, false);
  update accounts.payable_allocations set status = 'cancelled', cancelled_at = now(), cancelled_by = me where from_voucher_id = p_id and status = 'active';
  update accounts.cheques set status = 'cancelled', cancel_reason = 'Voucher cancelled: ' || btrim(p_reason) where voucher_id = p_id and status in ('issued', 'printed');
end $fn$;
revoke all on function accounts.voucher_cancel(bigint, text) from public, anon;
grant execute on function accounts.voucher_cancel(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Bank reconciliation
-- ---------------------------------------------------------------------------
create table if not exists accounts.bank_statements(
  id               bigserial primary key,
  ledger_id        bigint not null references accounts.ledgers(id),
  as_on            date not null,
  closing_balance  numeric(16,2) not null,
  note             text,
  updated_at       timestamptz not null default now(),
  updated_by       text default app.current_user_email(),
  unique (ledger_id, as_on)
);
comment on table accounts.bank_statements is 'The closing balance shown by the bank statement / passbook on a date, entered for the reconciliation.';

create or replace function accounts.mark_cleared(p_line_ids bigint[], p_date date) returns int
 language plpgsql security definer set search_path = accounts, public as $fn$
declare me text; n int := 0; r record;
begin
  me := accounts._guard_post();
  if p_date is null then raise exception 'Enter the date the bank cleared these entries'; end if;
  if p_date > current_date then raise exception 'The clearing date cannot be in the future'; end if;
  for r in select l.id, l.cleared_on, v.voucher_date, v.status, g.is_bank, v.doc_no
             from accounts.voucher_lines l join accounts.vouchers v on v.id = l.voucher_id join accounts.ledgers g on g.id = l.ledger_id
            where l.id = any (coalesce(p_line_ids, '{}')) for update of l loop
    if not r.is_bank or r.status <> 'posted' then raise exception '% is not a posted bank entry', r.doc_no; end if;
    if r.cleared_on is not null then continue; end if;
    if p_date < r.voucher_date then raise exception '% is dated % - it cannot clear earlier', r.doc_no, to_char(r.voucher_date, 'DD Mon YYYY'); end if;
    update accounts.voucher_lines set cleared_on = p_date, cleared_by = me where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $fn$;
revoke all on function accounts.mark_cleared(bigint[], date) from public, anon;
grant execute on function accounts.mark_cleared(bigint[], date) to authenticated;

create or replace function accounts.unmark_cleared(p_line_ids bigint[]) returns int
 language plpgsql security definer set search_path = accounts, public as $fn$
declare me text; n int;
begin
  me := accounts._guard_post();
  update accounts.voucher_lines set cleared_on = null, cleared_by = null where id = any (coalesce(p_line_ids, '{}')) and cleared_on is not null;
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke all on function accounts.unmark_cleared(bigint[]) from public, anon;
grant execute on function accounts.unmark_cleared(bigint[]) to authenticated;

-- Bank reconciliation statement as on a date.
create or replace function accounts.brs(p_ledger bigint, p_as_on date) returns jsonb
 language plpgsql stable security invoker set search_path = accounts, public as $fn$
declare
  g accounts.ledgers; v_open numeric; v_book numeric; v_rec numeric; v_pay numeric; v_bank numeric; v_stmt accounts.bank_statements;
  v_recs jsonb; v_pays jsonb;
begin
  select * into g from accounts.ledgers where id = p_ledger and is_bank;
  if not found then raise exception 'Choose a bank ledger'; end if;
  select coalesce(sum(dr - cr), 0) into v_open from accounts.opening_balances where ledger_id = p_ledger;
  select v_open + coalesce(sum(l.dr - l.cr), 0) into v_book
    from accounts.voucher_lines l join accounts.vouchers v on v.id = l.voucher_id
   where l.ledger_id = p_ledger and v.status = 'posted' and v.voucher_date <= p_as_on;
  with u as (
    select l.id as line_id, v.id as voucher_id, v.doc_no, v.voucher_date, v.voucher_type, v.mode, v.instrument_no, v.instrument_date,
           coalesce(v.payee, v.narration) as particulars, l.dr, l.cr
      from accounts.voucher_lines l join accounts.vouchers v on v.id = l.voucher_id
     where l.ledger_id = p_ledger and v.status = 'posted' and v.voucher_date <= p_as_on and (l.cleared_on is null or l.cleared_on > p_as_on))
  select coalesce(jsonb_agg(to_jsonb(u) - 'cr' order by u.voucher_date, u.line_id) filter (where u.dr > 0), '[]'::jsonb),
         coalesce(jsonb_agg(to_jsonb(u) - 'dr' order by u.voucher_date, u.line_id) filter (where u.cr > 0), '[]'::jsonb),
         coalesce(sum(u.dr), 0), coalesce(sum(u.cr), 0)
    into v_recs, v_pays, v_rec, v_pay from u;
  v_bank := v_book - v_rec + v_pay;
  select * into v_stmt from accounts.bank_statements where ledger_id = p_ledger and as_on <= p_as_on order by as_on desc limit 1;
  return jsonb_build_object('ledger', g.name, 'as_on', p_as_on, 'book_balance', v_book, 'uncleared_receipts', v_recs, 'uncleared_payments', v_pays,
           'total_receipts', v_rec, 'total_payments', v_pay, 'balance_per_bank', v_bank,
           'statement_as_on', v_stmt.as_on, 'statement_balance', v_stmt.closing_balance,
           'difference', case when v_stmt.id is null then null else v_stmt.closing_balance - v_bank end);
end $fn$;
revoke all on function accounts.brs(bigint, date) from public, anon;
grant execute on function accounts.brs(bigint, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Cheque books and cheque printing
-- ---------------------------------------------------------------------------
create table if not exists accounts.cheque_books(
  id          bigserial primary key,
  ledger_id   bigint not null references accounts.ledgers(id),
  label       text,
  prefix      text not null default '',
  from_no     bigint not null check (from_no >= 0),
  to_no       bigint not null,
  next_no     bigint not null,
  width       int not null default 6 check (width between 1 and 12),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  text default app.current_user_email(),
  check (from_no <= to_no and next_no between from_no and to_no + 1)
);
create index if not exists cheque_books_ledger_idx on accounts.cheque_books (ledger_id) where active;

create table if not exists accounts.cheques(
  id               bigserial primary key,
  ledger_id        bigint not null references accounts.ledgers(id),
  cheque_book_id   bigint references accounts.cheque_books(id),
  cheque_no        text not null,
  voucher_id       bigint not null references accounts.vouchers(id),
  payee            text,
  amount           numeric(16,2) not null check (amount > 0),
  cheque_date      date not null,
  crossed          boolean not null default true,
  status           text not null default 'issued' check (status in ('issued','printed','cancelled')),
  print_count      int not null default 0,
  printed_at       timestamptz,
  printed_by       text,
  cancel_reason    text,
  created_at       timestamptz not null default now(),
  created_by       text default app.current_user_email(),
  unique (ledger_id, cheque_no)
);
create index if not exists cheques_voucher_idx on accounts.cheques (voucher_id);

-- Where each field sits on a bank's cheque leaf (millimetres from the top-left corner). The screen holds a CTS-2010 default.
create table if not exists accounts.cheque_formats(
  ledger_id   bigint primary key references accounts.ledgers(id),
  width_mm    numeric(6,1) not null default 202 check (width_mm between 100 and 300),
  height_mm   numeric(6,1) not null default 92 check (height_mm between 50 and 150),
  layout      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text default app.current_user_email()
);

create or replace function accounts.cheque_issue(p_voucher_id bigint, p_book_id bigint default null, p_cheque_no text default null) returns bigint
 language plpgsql security definer set search_path = accounts, public as $fn$
declare
  me text; v accounts.vouchers; v_bank bigint; n int; v_amt numeric; b accounts.cheque_books; v_no text; v_id bigint; v_manual text; v_payee text;
begin
  me := accounts._guard_post();
  select * into v from accounts.vouchers where id = p_voucher_id for update;
  if not found or v.status <> 'posted' or v.voucher_type <> 'payment' then raise exception 'A cheque can only be issued for a posted payment'; end if;
  if v.mode <> 'cheque' then raise exception 'This payment is not made by cheque'; end if;
  select count(distinct l.ledger_id), min(l.ledger_id), sum(l.cr) into n, v_bank, v_amt
    from accounts.voucher_lines l join accounts.ledgers g on g.id = l.ledger_id where l.voucher_id = p_voucher_id and l.cr > 0 and g.is_bank;
  if coalesce(n, 0) <> 1 then raise exception 'This payment does not come out of exactly one bank account'; end if;
  select id into v_id from accounts.cheques where voucher_id = p_voucher_id and status in ('issued', 'printed');
  if v_id is not null then return v_id; end if;
  v_manual := nullif(btrim(coalesce(p_cheque_no, v.instrument_no, '')), '');
  if v_manual is not null then
    v_no := v_manual; b := null;
  else
    select * into b from accounts.cheque_books where ledger_id = v_bank and active and (p_book_id is null or id = p_book_id) order by id limit 1 for update;
    if not found then raise exception 'Add a cheque book for this bank account first'; end if;
    if b.next_no > b.to_no then raise exception 'Cheque book % is used up', coalesce(b.label, b.from_no || '-' || b.to_no); end if;
    v_no := b.prefix || lpad(b.next_no::text, b.width, '0');
    update accounts.cheque_books set next_no = next_no + 1 where id = b.id;
  end if;
  v_payee := coalesce(nullif(btrim(v.payee), ''), nullif(btrim(v.narration), ''), 'Payee');
  insert into accounts.cheques(ledger_id, cheque_book_id, cheque_no, voucher_id, payee, amount, cheque_date)
  values (v_bank, b.id, v_no, p_voucher_id, v_payee, v_amt, coalesce(v.instrument_date, v.voucher_date)) returning id into v_id;
  update accounts.vouchers set instrument_no = v_no where id = p_voucher_id;
  insert into accounts.doc_log(doc_type, doc_id, action, remark) values ('voucher', p_voucher_id, 'Cheque issued', v_no);
  return v_id;
end $fn$;
revoke all on function accounts.cheque_issue(bigint, bigint, text) from public, anon;
grant execute on function accounts.cheque_issue(bigint, bigint, text) to authenticated;

create or replace function accounts.cheque_mark_printed(p_id bigint) returns void
 language plpgsql security definer set search_path = accounts, public as $fn$
declare me text; c accounts.cheques;
begin
  me := accounts._guard_post();
  select * into c from accounts.cheques where id = p_id for update;
  if not found or c.status = 'cancelled' then raise exception 'That cheque is not available'; end if;
  update accounts.cheques set status = 'printed', print_count = print_count + 1, printed_at = now(), printed_by = me where id = p_id;
  insert into accounts.doc_log(doc_type, doc_id, action, remark) values ('voucher', c.voucher_id, 'Cheque printed', c.cheque_no);
end $fn$;
revoke all on function accounts.cheque_mark_printed(bigint) from public, anon;
grant execute on function accounts.cheque_mark_printed(bigint) to authenticated;

create or replace function accounts.cheque_cancel(p_id bigint, p_reason text) returns void
 language plpgsql security definer set search_path = accounts, public as $fn$
declare me text; c accounts.cheques;
begin
  me := accounts._guard_post();
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason (spoilt, lost, stopped ...)'; end if;
  select * into c from accounts.cheques where id = p_id for update;
  if not found or c.status = 'cancelled' then raise exception 'That cheque is not available'; end if;
  if exists (select 1 from accounts.voucher_lines where voucher_id = c.voucher_id and cleared_on is not null) then raise exception 'The bank has already cleared this cheque'; end if;
  update accounts.cheques set status = 'cancelled', cancel_reason = btrim(p_reason) where id = p_id;
  update accounts.vouchers set instrument_no = null where id = c.voucher_id and instrument_no = c.cheque_no;
  insert into accounts.doc_log(doc_type, doc_id, action, remark) values ('voucher', c.voucher_id, 'Cheque cancelled', c.cheque_no || ': ' || btrim(p_reason));
end $fn$;
revoke all on function accounts.cheque_cancel(bigint, text) from public, anon;
grant execute on function accounts.cheque_cancel(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array['payables','payable_allocations','bank_statements','cheque_books','cheques','cheque_formats'] loop
    execute format('alter table accounts.%I enable row level security', t);
    execute format('drop policy if exists %I on accounts.%I', t || '_read', t);
    execute format('create policy %I on accounts.%I for select to authenticated using ((select accounts.can_read()))', t || '_read', t);
    execute format('grant select on accounts.%I to authenticated', t);
  end loop;
  foreach t in array array['bank_statements','cheque_books','cheque_formats'] loop
    execute format('drop policy if exists %I on accounts.%I', t || '_post_write', t);
    execute format('create policy %I on accounts.%I for all to authenticated using ((select accounts.can_post())) with check ((select accounts.can_post()))', t || '_post_write', t);
    execute format('grant insert, update, delete on accounts.%I to authenticated', t);
  end loop;
end $rls$;
grant select on accounts.v_payables, accounts.v_on_account to authenticated;
grant usage, select on all sequences in schema accounts to authenticated;
notify pgrst, 'reload schema';
