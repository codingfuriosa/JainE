-- Accounts <-> Engineering, part 2: retention release and budget actuals. See docs/accounts-spec.md sections 4.5 and 4.6.
--
-- RETENTION RELEASE.  Retention money held back from an RA bill is released only when Engineering certifies it:
--   Engineering (Retention tab)  request a release (which RA bills, how much, why)  ->  a DIFFERENT person approves
--   Accounts (Bills & on-account)  pays exactly what was approved  ->  the release shows Paid with the voucher.
-- Accounts can no longer pay retention any other way (vendor_payment refuses it), cancelling that payment puts the release
-- back to Approved, and a bill whose retention has a pending release cannot be reversed in Accounts.
--
-- BUDGET ACTUALS.  accounts.eng_budget_actuals() gives Engineering, per project / block / activity group, how much of the
-- work billed on posted RA bills has actually been paid (and how much retention is still held).

create or replace function accounts._doc_prefix(p_type text) returns text
 language sql immutable set search_path = '' as $fn$
  select case p_type when 'receipt' then 'RV' when 'payment' then 'PV' when 'deposit' then 'DP' when 'withdrawal' then 'WD'
                     when 'contra' then 'CV' when 'journal' then 'JV' when 'purchase_bill' then 'BL' when 'debit_note' then 'DN'
                     when 'ra_bill' then 'RA' when 'advance_receipt' then 'AR' when 'customer_gst' then 'GJ' when 'retention_release' then 'RR'
                     else upper(left(p_type, 3)) end
$fn$;

create table if not exists accounts.retention_releases(
  id                bigserial primary key,
  doc_no            text not null,
  company_id        bigint not null references accounts.companies(id),
  business_unit_id  bigint references accounts.business_units(id),
  wo_id             bigint not null references eng.work_orders(id),
  vendor_id         bigint not null references purchase.vendors(id),
  amount            numeric(16,2) not null check (amount > 0),
  reason            text not null check (btrim(reason) <> ''),
  status            text not null default 'Requested' check (status in ('Requested','Approved','Rejected','Cancelled','Paid')),
  requested_by      text not null,
  requested_at      timestamptz not null default now(),
  decided_by        text,
  decided_at        timestamptz,
  decision_note     text,
  cancelled_by      text,
  cancelled_at      timestamptz,
  cancel_reason     text,
  paid_voucher_id   bigint references accounts.vouchers(id),
  paid_voucher_no   text,
  paid_at           timestamptz,
  unique (company_id, doc_no)
);
create table if not exists accounts.retention_release_lines(
  id          bigserial primary key,
  release_id  bigint not null references accounts.retention_releases(id) on delete cascade,
  ra_bill_id  bigint not null references eng.ra_bills(id),
  payable_id  bigint not null references accounts.payables(id),
  amount      numeric(16,2) not null check (amount > 0),
  unique (release_id, payable_id)
);
create index if not exists rr_lines_payable_idx on accounts.retention_release_lines (payable_id);
create index if not exists rr_wo_idx on accounts.retention_releases (wo_id, status);
comment on table accounts.retention_releases is 'A request, by Engineering, to release retention money held on RA bills of one work order; approved by a different person; paid by Accounts.';

alter table accounts.retention_releases enable row level security;
alter table accounts.retention_release_lines enable row level security;
drop policy if exists rr_read on accounts.retention_releases;
create policy rr_read on accounts.retention_releases for select to authenticated using ((select accounts.can_read() or (not app.is_customer() and app.has_module('engineering'))));
drop policy if exists rrl_read on accounts.retention_release_lines;
create policy rrl_read on accounts.retention_release_lines for select to authenticated using ((select accounts.can_read() or (not app.is_customer() and app.has_module('engineering'))));
grant select on accounts.retention_releases, accounts.retention_release_lines to authenticated;

create or replace function accounts._eng_guard() returns text
 language plpgsql stable security definer set search_path = accounts, public as $fn$
begin
  if coalesce(app.current_user_email(), '') = '' then raise exception 'not signed in'; end if;
  if app.is_customer() or not app.has_module('engineering') then raise exception 'Retention can only be certified by people who hold the Engineering module'; end if;
  return lower(app.current_user_email());
end $fn$;
revoke all on function accounts._eng_guard() from public, anon, authenticated;

-- Retention still free to be put in a new request: outstanding less what other pending releases already cover.
create or replace function accounts._retention_free(p_payable bigint, p_except bigint default null) returns numeric
 language sql stable security definer set search_path = accounts, public as $fn$
  select coalesce((select outstanding from accounts.v_payables where id = p_payable and status = 'open'), 0)
       - coalesce((select sum(l.amount) from accounts.retention_release_lines l join accounts.retention_releases r on r.id = l.release_id
                    where l.payable_id = p_payable and r.status in ('Requested', 'Approved') and r.id is distinct from p_except), 0)
$fn$;
revoke all on function accounts._retention_free(bigint, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Engineering: what retention is held, per RA bill (only bills Accounts has posted can be released)
-- ---------------------------------------------------------------------------
create or replace function accounts.retention_overview(p_project bigint default null) returns jsonb
 language plpgsql stable security definer set search_path = accounts, public as $fn$
begin
  if app.is_customer() or not (app.has_module('engineering') or accounts.can_read()) then raise exception 'not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'ra_bill_id', rb.id, 'bill_no', rb.bill_no, 'bill_date', rb.bill_date, 'wo_id', w.id, 'wo_no', w.wo_no, 'wo_status', w.status,
             'project_id', w.project_id, 'project', btrim(p.name), 'vendor_id', w.vendor_id, 'vendor', coalesce(nullif(v.trade_name, ''), v.legal_name),
             'retention', am.ret, 'posted', pay.id is not null, 'payable_id', pay.id,
             'released', coalesce(pay.settled, 0), 'pending', coalesce(pend.amt, 0),
             'available', case when pay.id is null then 0 else greatest(pay.outstanding - coalesce(pend.amt, 0), 0) end)
           order by w.project_id, w.wo_no, rb.ra_seq)
      from eng.ra_bills rb
      join eng.work_orders w on w.id = rb.wo_id
      join cust.projects p on p.id = w.project_id
      join purchase.vendors v on v.id = w.vendor_id
      cross join lateral (select (accounts._ra_amounts(rb.id)->>'retention')::numeric as ret) am
      left join lateral (select pp.id, pp.settled, pp.outstanding
                           from accounts.v_payables pp join accounts.vouchers vo on vo.id = pp.voucher_id and vo.status = 'posted'
                          where pp.source_type = 'ra_bill' and pp.source_id = rb.id and pp.kind = 'retention' and pp.status = 'open') pay on true
      left join lateral (select sum(l.amount) as amt from accounts.retention_release_lines l join accounts.retention_releases r on r.id = l.release_id
                          where l.payable_id = pay.id and r.status in ('Requested', 'Approved')) pend on true
     where rb.status = 'Booked' and am.ret > 0 and (p_project is null or w.project_id = p_project)), '[]'::jsonb);
end $fn$;
revoke all on function accounts.retention_overview(bigint) from public, anon;
grant execute on function accounts.retention_overview(bigint) to authenticated;

-- The releases themselves, with names (for Engineering, and for Accounts).
create or replace function accounts.retention_releases_view(p_company bigint default null, p_project bigint default null) returns jsonb
 language plpgsql stable security definer set search_path = accounts, public as $fn$
begin
  if app.is_customer() or not (app.has_module('engineering') or accounts.can_read()) then raise exception 'not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'doc_no', r.doc_no, 'company_id', r.company_id, 'company', c.name, 'wo_id', r.wo_id, 'wo_no', w.wo_no, 'project_id', w.project_id, 'project', btrim(p.name),
             'vendor_id', r.vendor_id, 'vendor', coalesce(nullif(v.trade_name, ''), v.legal_name), 'amount', r.amount, 'reason', r.reason, 'status', r.status,
             'requested_by', r.requested_by, 'requested_at', r.requested_at, 'decided_by', r.decided_by, 'decided_at', r.decided_at, 'decision_note', r.decision_note,
             'cancelled_by', r.cancelled_by, 'cancel_reason', r.cancel_reason, 'paid_voucher_id', r.paid_voucher_id, 'paid_voucher_no', r.paid_voucher_no, 'paid_at', r.paid_at,
             'lines', (select jsonb_agg(jsonb_build_object('ra_bill_id', l.ra_bill_id, 'bill_no', rb.bill_no, 'payable_id', l.payable_id, 'amount', l.amount) order by rb.ra_seq)
                         from accounts.retention_release_lines l join eng.ra_bills rb on rb.id = l.ra_bill_id where l.release_id = r.id))
           order by r.id desc)
      from accounts.retention_releases r
      join accounts.companies c on c.id = r.company_id
      join eng.work_orders w on w.id = r.wo_id
      join cust.projects p on p.id = w.project_id
      join purchase.vendors v on v.id = r.vendor_id
     where (p_company is null or r.company_id = p_company) and (p_project is null or w.project_id = p_project)), '[]'::jsonb);
end $fn$;
revoke all on function accounts.retention_releases_view(bigint, bigint) from public, anon;
grant execute on function accounts.retention_releases_view(bigint, bigint) to authenticated;

-- Request a release: p_lines = [{ra_bill_id, amount}]
create or replace function accounts.retention_release_request(p_wo bigint, p_lines jsonb, p_reason text) returns bigint
 language plpgsql security definer set search_path = accounts, public as $fn$
declare
  me text; w eng.work_orders; l jsonb; rb eng.ra_bills; pay accounts.payables; v_free numeric; v_amt numeric; v_total numeric := 0; v_co bigint; v_bu bigint; v_id bigint; v_no text; n int := 0; v_seen bigint[] := '{}';
begin
  me := accounts._eng_guard();
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Say why the retention can be released (completion certificate, defect liability over ...)'; end if;
  select * into w from eng.work_orders where id = p_wo;
  if not found or w.status not in ('Issued', 'Closed') then raise exception 'Retention can only be released on an issued or closed work order'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Choose the RA bills and the amount to release'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_amt := round(coalesce(nullif(l->>'amount', ''), '0')::numeric, 2);
    if v_amt <= 0 then continue; end if;
    select * into rb from eng.ra_bills where id = nullif(l->>'ra_bill_id', '')::bigint;
    if not found or rb.wo_id <> p_wo or rb.status <> 'Booked' then raise exception 'A bill chosen is not a booked RA bill of this work order'; end if;
    if rb.id = any (v_seen) then raise exception 'The same bill is listed twice'; end if;
    v_seen := v_seen || rb.id;
    select p.* into pay from accounts.payables p join accounts.vouchers vo on vo.id = p.voucher_id and vo.status = 'posted'
     where p.source_type = 'ra_bill' and p.source_id = rb.id and p.kind = 'retention' and p.status = 'open' for update of p;
    if not found then raise exception 'Accounts has not posted % yet, so its retention cannot be released', rb.bill_no; end if;
    v_free := accounts._retention_free(pay.id);
    if v_amt > v_free + 0.004 then raise exception 'Only % of the retention on % can still be released', v_free, rb.bill_no; end if;
    if v_co is null then v_co := pay.company_id; v_bu := pay.business_unit_id; elsif v_co <> pay.company_id then raise exception 'The bills belong to different companies'; end if;
    v_total := v_total + v_amt; n := n + 1;
  end loop;
  if n = 0 then raise exception 'Enter the amount to release against at least one bill'; end if;
  v_no := accounts.next_doc_no(v_co, 'retention_release', current_date);
  insert into accounts.retention_releases(doc_no, company_id, business_unit_id, wo_id, vendor_id, amount, reason, requested_by)
  values (v_no, v_co, v_bu, p_wo, w.vendor_id, v_total, btrim(p_reason), me) returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_amt := round(coalesce(nullif(l->>'amount', ''), '0')::numeric, 2);
    if v_amt <= 0 then continue; end if;
    insert into accounts.retention_release_lines(release_id, ra_bill_id, payable_id, amount)
    select v_id, p.source_id, p.id, v_amt from accounts.payables p where p.source_type = 'ra_bill' and p.source_id = (l->>'ra_bill_id')::bigint and p.kind = 'retention' and p.status = 'open';
  end loop;
  insert into accounts.doc_log(doc_type, doc_id, action, remark) values ('retention_release', v_id, 'Requested', v_no || ' - ' || v_total);
  return v_id;
end $fn$;
revoke all on function accounts.retention_release_request(bigint, jsonb, text) from public, anon;
grant execute on function accounts.retention_release_request(bigint, jsonb, text) to authenticated;

-- Approve or reject (never by the person who requested it)
create or replace function accounts.retention_release_decide(p_id bigint, p_approve boolean, p_note text default null) returns text
 language plpgsql security definer set search_path = accounts, public as $fn$
declare me text; r accounts.retention_releases; ln record;
begin
  me := accounts._eng_guard();
  select * into r from accounts.retention_releases where id = p_id for update;
  if not found then raise exception 'Release not found'; end if;
  if r.status <> 'Requested' then raise exception 'This release is already %', lower(r.status); end if;
  if lower(r.requested_by) = me then raise exception 'You requested this release yourself, so someone else must approve or reject it'; end if;
  if not p_approve and btrim(coalesce(p_note, '')) = '' then raise exception 'Give a reason for rejecting the release'; end if;
  if p_approve then
    for ln in select l.payable_id, l.amount, rb.bill_no from accounts.retention_release_lines l join eng.ra_bills rb on rb.id = l.ra_bill_id where l.release_id = p_id loop
      if ln.amount > accounts._retention_free(ln.payable_id, p_id) + 0.004 then raise exception 'The retention on % has changed since this was requested - cancel it and request again', ln.bill_no; end if;
    end loop;
  end if;
  update accounts.retention_releases set status = case when p_approve then 'Approved' else 'Rejected' end, decided_by = me, decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_id;
  insert into accounts.doc_log(doc_type, doc_id, action, remark) values ('retention_release', p_id, case when p_approve then 'Approved' else 'Rejected' end, p_note);
  return case when p_approve then 'Approved' else 'Rejected' end;
end $fn$;
revoke all on function accounts.retention_release_decide(bigint, boolean, text) from public, anon;
grant execute on function accounts.retention_release_decide(bigint, boolean, text) to authenticated;

create or replace function accounts.retention_release_cancel(p_id bigint, p_reason text) returns void
 language plpgsql security definer set search_path = accounts, public as $fn$
declare me text; r accounts.retention_releases;
begin
  me := accounts._eng_guard();
  select * into r from accounts.retention_releases where id = p_id for update;
  if not found then raise exception 'Release not found'; end if;
  if r.status not in ('Requested', 'Approved') then raise exception 'A % release cannot be cancelled', lower(r.status); end if;
  if lower(r.requested_by) <> me and lower(coalesce(r.decided_by, '')) <> me and not app.is_superadmin() then raise exception 'Only the person who requested (or approved) this release can cancel it'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason for cancelling'; end if;
  update accounts.retention_releases set status = 'Cancelled', cancelled_by = me, cancelled_at = now(), cancel_reason = btrim(p_reason) where id = p_id;
  insert into accounts.doc_log(doc_type, doc_id, action, remark) values ('retention_release', p_id, 'Cancelled', btrim(p_reason));
end $fn$;
revoke all on function accounts.retention_release_cancel(bigint, text) from public, anon;
grant execute on function accounts.retention_release_cancel(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Paying a vendor: retention only through an approved release (replaces the earlier version)
-- p_head also takes release_id.  A release is paid on its own: exactly its lines, nothing else.
-- ---------------------------------------------------------------------------
create or replace function accounts.vendor_payment(p_head jsonb, p_allocs jsonb) returns bigint
 language plpgsql security definer set search_path = accounts, public as $fn$
declare
  me text; v_company bigint; v_vendor bigint; v_bank accounts.ledgers; v_date date; v_vc bigint; v_rp bigint; v_sub_v bigint; v_sub_r bigint;
  a jsonb; p accounts.payables; v_amt numeric; v_bill numeric := 0; v_ret numeric := 0; v_on numeric; v_total numeric; v_lines jsonb := '[]'::jsonb;
  v_id bigint; v_name text; v_legal text; v_out numeric; v_mode text; v_seen bigint[] := '{}'; v_rel bigint; rel accounts.retention_releases; v_nret int := 0;
begin
  me := accounts._guard_post();
  v_company := nullif(p_head->>'company_id', '')::bigint;
  v_vendor := nullif(p_head->>'vendor_id', '')::bigint;
  v_date := nullif(p_head->>'voucher_date', '')::date;
  v_mode := nullif(p_head->>'mode', '');
  v_rel := nullif(p_head->>'release_id', '')::bigint;
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
    if p.kind = 'bill' then v_bill := v_bill + v_amt; else v_ret := v_ret + v_amt; v_nret := v_nret + 1; end if;
  end loop;
  v_on := round(coalesce(nullif(p_head->>'on_account', '')::numeric, 0), 2);
  if v_on < 0 then raise exception 'The on-account amount cannot be negative'; end if;
  -- retention: only what Engineering has approved, paid on its own
  if v_rel is not null then
    select * into rel from accounts.retention_releases where id = v_rel for update;
    if not found or rel.status <> 'Approved' then raise exception 'That retention release is not approved for payment (it is %)', lower(coalesce(rel.status, 'missing')); end if;
    if rel.company_id <> v_company or rel.vendor_id <> v_vendor then raise exception 'That release belongs to another company or vendor'; end if;
    if v_bill > 0 or v_on > 0 then raise exception 'A retention release is paid on its own - do not add other bills or an on-account amount'; end if;
    if (select count(*) from accounts.retention_release_lines where release_id = v_rel) <> v_nret
       or exists (select 1 from accounts.retention_release_lines l where l.release_id = v_rel
                   and not exists (select 1 from jsonb_array_elements(p_allocs) x where (x->>'payable_id')::bigint = l.payable_id and round(coalesce(nullif(x->>'amount', ''), '0')::numeric, 2) = l.amount)) then
      raise exception 'The payment must pay exactly what Engineering approved in release %', rel.doc_no;
    end if;
  elsif v_ret > 0 then
    raise exception 'Retention can only be paid through a release approved in Engineering (Engineering > Retention) - it is paid from Accounts > Bills & on-account';
  end if;
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
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('ledger_id', v_rp, 'sub_ledger_id', v_sub_r, 'dr', v_ret, 'narration', 'Retention released' || coalesce(' - ' || rel.doc_no, '')));
  end if;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('ledger_id', v_bank.id, 'cr', v_total));
  v_id := accounts._insert_voucher(v_company, nullif(p_head->>'business_unit_id', '')::bigint, 'payment', v_date,
            coalesce(nullif(btrim(p_head->>'narration'), ''), case when v_rel is not null then 'Retention release ' || rel.doc_no || ' - ' || v_name else 'Payment to ' || v_name end),
            v_mode, p_head->>'instrument_no', nullif(p_head->>'instrument_date', '')::date, coalesce(nullif(btrim(p_head->>'payee'), ''), v_legal), null, null, v_lines);
  for a in select * from jsonb_array_elements(coalesce(p_allocs, '[]'::jsonb)) loop
    v_amt := round(coalesce(nullif(a->>'amount', ''), '0')::numeric, 2);
    if v_amt > 0 then
      insert into accounts.payable_allocations(company_id, payable_id, from_voucher_id, kind, amount, alloc_date)
      values (v_company, (a->>'payable_id')::bigint, v_id, 'payment', v_amt, v_date);
    end if;
  end loop;
  if v_rel is not null then
    update accounts.retention_releases set status = 'Paid', paid_voucher_id = v_id, paid_voucher_no = (select doc_no from accounts.vouchers where id = v_id), paid_at = now() where id = v_rel;
    insert into accounts.doc_log(doc_type, doc_id, action, remark) values ('retention_release', v_rel, 'Paid', (select doc_no from accounts.vouchers where id = v_id));
  end if;
  return v_id;
end $fn$;
revoke all on function accounts.vendor_payment(jsonb, jsonb) from public, anon;
grant execute on function accounts.vendor_payment(jsonb, jsonb) to authenticated;

-- Cancelling a payment that paid a release puts the release back to Approved
create or replace function accounts.voucher_cancel(p_id bigint, p_reason text) returns void
 language plpgsql security definer set search_path = accounts, public as $fn$
declare me text;
begin
  me := accounts._guard_post();
  perform accounts._cancel_voucher(p_id, p_reason, false);
  update accounts.payable_allocations set status = 'cancelled', cancelled_at = now(), cancelled_by = me where from_voucher_id = p_id and status = 'active';
  update accounts.cheques set status = 'cancelled', cancel_reason = 'Voucher cancelled: ' || btrim(p_reason) where voucher_id = p_id and status in ('issued', 'printed');
  update accounts.retention_releases set status = 'Approved', paid_voucher_id = null, paid_voucher_no = null, paid_at = null where paid_voucher_id = p_id and status = 'Paid';
end $fn$;
revoke all on function accounts.voucher_cancel(bigint, text) from public, anon;
grant execute on function accounts.voucher_cancel(bigint, text) to authenticated;

-- A bill whose retention has a pending release cannot be reversed
create or replace function accounts.reverse_posting(p_voucher_id bigint, p_reason text) returns void
 language plpgsql security definer set search_path = accounts, public as $fn$
declare me text; v accounts.vouchers;
begin
  me := accounts._guard_post();
  select * into v from accounts.vouchers where id = p_voucher_id for update;
  if not found or v.status <> 'posted' or v.source_type is null then raise exception 'That entry is not a posting from another module'; end if;
  if exists (select 1 from accounts.payable_allocations a join accounts.payables p on p.id = a.payable_id where p.voucher_id = v.id and a.status = 'active') then
    raise exception 'Payments, adjustments or debit notes have been set against this bill - cancel them first';
  end if;
  if exists (select 1 from accounts.retention_release_lines l join accounts.retention_releases r on r.id = l.release_id join accounts.payables p on p.id = l.payable_id
              where p.voucher_id = v.id and r.status in ('Requested', 'Approved')) then
    raise exception 'A retention release is pending for this bill - cancel it in Engineering (Retention) first';
  end if;
  perform accounts._cancel_voucher(p_voucher_id, p_reason, true);
  update accounts.payables set status = 'cancelled' where voucher_id = v.id;
  update accounts.payable_allocations set status = 'cancelled', cancelled_at = now(), cancelled_by = me where from_voucher_id = v.id and status = 'active';
  if v.source_type = 'purchase_bill' then
    update purchase.bills set accounts_status = 'ready', accounts_ref = null, accounts_posted_at = null where id = v.source_id and accounts_status = 'posted';
  elsif v.source_type = 'purchase_dn' then
    update purchase.debit_notes set accounts_status = 'ready', accounts_ref = null, accounts_posted_at = null where id = v.source_id and accounts_status = 'posted';
  end if;
end $fn$;
revoke all on function accounts.reverse_posting(bigint, text) from public, anon;
grant execute on function accounts.reverse_posting(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Budget actuals for Engineering
-- One row per project / block / activity group over RA bills that Accounts has posted:
--   gross          work value billed (the same figure Engineering calls "billed", excluding draft bills)
--   paid_value     the part of that work value already settled with the contractor: gross x (paid / owed), where
--                  owed = net payable + retention and paid = payments + on-account adjustments + retention released.
--                  GST, TDS and retention are therefore left out, so it compares directly with the budget and "billed".
--   retention_held retention money still held on those bills
-- ---------------------------------------------------------------------------
create or replace function accounts.eng_budget_actuals(p_project bigint default null) returns jsonb
 language plpgsql stable security definer set search_path = accounts, public as $fn$
begin
  if app.is_customer() or not (app.has_module('engineering') or accounts.can_read()) then raise exception 'not allowed'; end if;
  return coalesce((
    with bills as (
      select vo.source_id as ra_id,
             coalesce(b.amount, 0) + coalesce(t.amount, 0) as owed,
             coalesce(b.settled, 0) + coalesce(t.settled, 0) as settled,
             coalesce(t.outstanding, 0) as ret_out
        from accounts.vouchers vo
        left join accounts.v_payables b on b.voucher_id = vo.id and b.kind = 'bill' and b.status = 'open'
        left join accounts.v_payables t on t.voucher_id = vo.id and t.kind = 'retention' and t.status = 'open'
       where vo.source_type = 'ra_bill' and vo.status = 'posted'),
    lines as (
      select rb.id as ra_id, w.project_id, bq.tower_id, a.group_id, round(sum(wd.qty) * wi.rate, 2) as amt
        from eng.ra_bills rb
        join eng.work_orders w on w.id = rb.wo_id
        join eng.work_done wd on wd.ra_bill_id = rb.id
        join eng.wo_items wi on wi.id = wd.wo_item_id
        join eng.boq_items bq on bq.id = wi.boq_item_id
        join eng.activities a on a.id = bq.activity_id
       where rb.status = 'Booked' and (p_project is null or w.project_id = p_project)
       group by rb.id, w.project_id, bq.tower_id, a.group_id, wi.id, wi.rate),
    sized as (select l.*, sum(l.amt) over (partition by l.ra_id) as bill_gross from lines l)
    select jsonb_agg(jsonb_build_object('project_id', project_id, 'tower_id', tower_id, 'group_id', group_id, 'gross', gross, 'paid_value', paid_value, 'retention_held', retention_held))
      from (
        select s.project_id, s.tower_id, s.group_id, sum(s.amt) as gross,
               round(sum(s.amt * case when b.owed > 0 then least(b.settled / b.owed, 1) else 0 end), 2) as paid_value,
               round(sum(case when s.bill_gross > 0 then b.ret_out * s.amt / s.bill_gross else 0 end), 2) as retention_held
          from sized s join bills b on b.ra_id = s.ra_id
         group by s.project_id, s.tower_id, s.group_id) x), '[]'::jsonb);
end $fn$;
revoke all on function accounts.eng_budget_actuals(bigint) from public, anon;
grant execute on function accounts.eng_budget_actuals(bigint) to authenticated;
notify pgrst, 'reload schema';
