-- Accounts: enter a vendor bill, and bring in opening bills, from the Accounts module alone.
--
-- Until now a payable could only come from posting a Purchase bill, a debit note or an Engineering RA bill.
--   bill_enter          - a bill typed straight into Accounts: expense / asset lines, GST (CGST + SGST or IGST, input),
--                         TDS, the vendor's account credited, and a payable that Pay a vendor can settle.
--   opening_bill_enter  - a bill that was already unpaid when the books started. There is no entry date to record, so it has
--                         no voucher: it adds to the vendor's OPENING balance (the same figure the Ledger opening screen
--                         holds) and creates the payable that goes with it.
--   bill_cancel         - cancels either kind, provided nothing has been paid, adjusted or credited against it.
-- Posted-from-another-module bills (Purchase, RA) are untouched: they are still reversed from Ledgers & postings.

-- 1. A payable may have no voucher, but only an opening bill.
alter table accounts.payables alter column voucher_id drop not null;
alter table accounts.payables drop constraint if exists payables_voucher_or_opening;
alter table accounts.payables add constraint payables_voucher_or_opening check (voucher_id is not null or source_type = 'opening');

create or replace view accounts.v_payables with (security_invoker = true) as
select p.id, p.company_id, p.business_unit_id, p.vendor_id, p.sub_ledger_id, p.kind, p.ref_no, p.ref_date, p.due_date, p.amount, p.voucher_id,
       coalesce(v.doc_no, 'Opening bill') as voucher_no, p.source_type, p.source_id, p.status,
       coalesce(a.settled, 0) as settled, p.amount - coalesce(a.settled, 0) as outstanding
  from accounts.payables p
  left join accounts.vouchers v on v.id = p.voucher_id
  left join (select payable_id, sum(amount) as settled from accounts.payable_allocations where status = 'active' group by payable_id) a on a.payable_id = p.id;

-- 2. Cancelling a bill voucher by itself would leave its payable open, so the generic cancel refuses and points here.
create or replace function accounts.voucher_cancel(p_id bigint, p_reason text) returns void
 language plpgsql security definer set search_path = accounts, public as $fn$
declare me text;
begin
  me := accounts._guard_post();
  if exists (select 1 from accounts.payables where voucher_id = p_id and status = 'open') then
    raise exception 'This is a vendor bill - cancel it from Transactions > Bills & on-account (open the bill, then Cancel bill)';
  end if;
  perform accounts._cancel_voucher(p_id, p_reason, false);
  update accounts.payable_allocations set status = 'cancelled', cancelled_at = now(), cancelled_by = me where from_voucher_id = p_id and status = 'active';
  update accounts.cheques set status = 'cancelled', cancel_reason = 'Voucher cancelled: ' || btrim(p_reason) where voucher_id = p_id and status in ('issued', 'printed');
end $fn$;
revoke all on function accounts.voucher_cancel(bigint, text) from public, anon;
grant execute on function accounts.voucher_cancel(bigint, text) to authenticated;

-- 3. Enter a bill.
-- p_head: company_id, vendor_id, invoice_no, invoice_date, due_date, business_unit_id, narration, supply ('auto' | 'intra' | 'inter'), tds_pct
-- p_lines: [{ ledger_id, amount (before GST), gst_pct, cost_ledger_id, cost_sub_ledger_id, narration }]
create or replace function accounts.bill_enter(p_head jsonb, p_lines jsonb) returns jsonb
 language plpgsql security definer set search_path = accounts, public as $fn$
declare
  me text; v_co bigint; co accounts.companies; v_bu bigint; v_vendor bigint; ven purchase.vendors; v_name text;
  v_inv text; v_date date; v_due date; v_narr text; v_supply text; v_inter boolean; v_tds_pct numeric;
  x jsonb; n int := 0; led accounts.ledgers; v_nature text; v_amt numeric; v_pct numeric;
  v_taxable numeric := 0; v_gst numeric := 0; v_tds numeric; v_net numeric;
  v_vc bigint; v_sub bigint; v_tl bigint; v_tsub bigint; lines jsonb := '[]'::jsonb; v_id bigint; v_pid bigint;
begin
  me := accounts._guard_post();
  v_co := nullif(p_head->>'company_id', '')::bigint;
  select * into co from accounts.companies where id = v_co and active;
  if not found then raise exception 'Choose the company'; end if;
  v_bu := nullif(p_head->>'business_unit_id', '')::bigint;
  v_vendor := nullif(p_head->>'vendor_id', '')::bigint;
  select * into ven from purchase.vendors where id = v_vendor and deleted_at is null;
  if not found then raise exception 'Choose the vendor'; end if;
  if ven.status <> 'approved' then raise exception 'Only an approved vendor can be billed (this one is %)', ven.status; end if;
  v_name := coalesce(nullif(ven.trade_name, ''), ven.legal_name) || ' (' || ven.code || ')';
  v_inv := nullif(btrim(coalesce(p_head->>'invoice_no', '')), '');
  if v_inv is null then raise exception 'Enter the vendor''s invoice number'; end if;
  v_date := nullif(p_head->>'invoice_date', '')::date;
  if v_date is null then raise exception 'Enter the invoice date'; end if;
  if v_date > current_date then raise exception 'A bill cannot be dated in the future'; end if;
  v_due := nullif(p_head->>'due_date', '')::date;
  if v_due is not null and v_due < v_date then raise exception 'The due date cannot be before the invoice date'; end if;
  if exists (select 1 from accounts.payables where company_id = v_co and vendor_id = v_vendor and kind = 'bill' and status = 'open' and lower(btrim(coalesce(ref_no, ''))) = lower(v_inv)) then
    raise exception 'Invoice % of this vendor is already entered', v_inv;
  end if;
  v_supply := coalesce(nullif(p_head->>'supply', ''), 'auto');
  if v_supply not in ('auto', 'intra', 'inter') then raise exception 'Choose where the supply is made'; end if;
  v_inter := case v_supply when 'inter' then true when 'intra' then false
              else coalesce(co.state_code is not null and ven.gstin ~ '^[0-9]{2}' and left(ven.gstin, 2) <> co.state_code, false) end;
  v_tds_pct := coalesce(nullif(p_head->>'tds_pct', '')::numeric, 0);
  if v_tds_pct < 0 or v_tds_pct > 100 then raise exception 'The TDS rate must be between 0 and 100'; end if;
  v_narr := nullif(btrim(coalesce(p_head->>'narration', '')), '');
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one line to the bill'; end if;

  for x in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    select * into led from accounts.ledgers where id = nullif(x->>'ledger_id', '')::bigint and company_id = v_co and active;
    if not found then raise exception 'Line %: choose a ledger of this company', n; end if;
    if led.ledger_type <> 'general' then raise exception 'Line %: % is a cost / custom ledger - pick it in the cost ledger column', n, led.name; end if;
    if led.is_bank or led.is_cash then raise exception 'Line %: a bill is not booked to a bank or cash ledger - use Payment for that', n; end if;
    if led.system_key in ('vendor_control', 'retention_payable', 'tds_payable', 'input_cgst', 'input_sgst', 'input_igst', 'output_cgst', 'output_sgst', 'output_igst', 'customer_advance') then
      raise exception 'Line %: pick the expense or asset ledger the bill is for, not %', n, led.name;
    end if;
    if led.sub_ledger_type is not null then raise exception 'Line %: % needs a sub-ledger - enter that one as a Journal', n, led.name; end if;
    select nature into v_nature from accounts.account_groups where id = led.group_id;
    if v_nature is null or v_nature not in ('expense', 'asset') then raise exception 'Line %: a bill is booked to an expense or asset ledger (% is not)', n, led.name; end if;
    v_amt := round(coalesce(nullif(x->>'amount', ''), '0')::numeric, 2);
    if v_amt <= 0 then raise exception 'Line %: enter the amount before GST', n; end if;
    v_pct := coalesce(nullif(x->>'gst_pct', '')::numeric, 0);
    if v_pct < 0 or v_pct > 100 then raise exception 'Line %: the GST rate must be between 0 and 100', n; end if;
    v_taxable := v_taxable + v_amt;
    v_gst := v_gst + round(v_amt * v_pct / 100, 2);
    lines := lines || jsonb_build_array(jsonb_build_object('ledger_id', led.id, 'dr', v_amt,
               'cost_ledger_id', nullif(x->>'cost_ledger_id', ''), 'cost_sub_ledger_id', nullif(x->>'cost_sub_ledger_id', ''),
               'narration', nullif(btrim(coalesce(x->>'narration', '')), '')));
  end loop;

  v_tds := round(v_taxable * v_tds_pct / 100, 2);
  v_net := v_taxable + v_gst - v_tds;
  if v_net <= 0 then raise exception 'The deductions are more than the bill'; end if;

  v_vc := accounts._key_ledger(v_co, 'vendor_control');
  v_sub := accounts._sub_ledger(v_vc, 'vendor', v_vendor, v_name);
  lines := lines || accounts._gst_lines(v_co, 'input', v_inter, v_gst, true);
  lines := lines || jsonb_build_array(jsonb_build_object('ledger_id', v_vc, 'sub_ledger_id', v_sub, 'cr', v_net, 'narration', v_inv));
  if v_tds > 0 then
    v_tl := accounts._key_ledger(v_co, 'tds_payable');
    v_tsub := accounts._sub_ledger(v_tl, 'vendor', v_vendor, v_name);
    lines := lines || jsonb_build_array(jsonb_build_object('ledger_id', v_tl, 'sub_ledger_id', v_tsub, 'cr', v_tds, 'narration', 'TDS @ ' || v_tds_pct || '% on ' || v_inv));
  end if;

  v_id := accounts._insert_voucher(v_co, v_bu, 'purchase_bill', v_date, coalesce(v_narr, 'Bill ' || v_inv || ' - ' || v_name), null, null, null, ven.legal_name, null, null, lines);
  insert into accounts.payables(company_id, business_unit_id, vendor_id, sub_ledger_id, kind, ref_no, ref_date, due_date, amount, voucher_id)
  values (v_co, v_bu, v_vendor, v_sub, 'bill', v_inv, v_date, v_due, v_net, v_id) returning id into v_pid;
  return jsonb_build_object('payable_id', v_pid, 'voucher_id', v_id, 'doc_no', (select doc_no from accounts.vouchers where id = v_id),
                            'taxable', v_taxable, 'gst', v_gst, 'tds', v_tds, 'net', v_net, 'intra_state', not v_inter);
end $fn$;
revoke all on function accounts.bill_enter(jsonb, jsonb) from public, anon;
grant execute on function accounts.bill_enter(jsonb, jsonb) to authenticated;

-- 4. Enter an opening bill (unpaid when the books started).
-- p_head: company_id, vendor_id, invoice_no, invoice_date, due_date, business_unit_id, amount (what is still owed)
create or replace function accounts._opening_adjust(p_company bigint, p_vendor_sub bigint, p_bu bigint, p_delta numeric) returns void
 language plpgsql security definer set search_path = accounts, public as $fn$
declare v_vc bigint; ob accounts.opening_balances; v_net numeric;
begin
  v_vc := accounts._key_ledger(p_company, 'vendor_control');
  select * into ob from accounts.opening_balances
   where ledger_id = v_vc and coalesce(sub_ledger_id, 0) = p_vendor_sub and coalesce(business_unit_id, 0) = coalesce(p_bu, 0) for update;
  if found then
    v_net := ob.cr - ob.dr + p_delta;                                 -- net credit (what the vendor is owed)
    if abs(v_net) < 0.005 then delete from accounts.opening_balances where id = ob.id;
    else update accounts.opening_balances set dr = greatest(-v_net, 0), cr = greatest(v_net, 0), updated_at = now(), updated_by = lower(coalesce(app.current_user_email(), 'system')) where id = ob.id; end if;
  elsif p_delta > 0 then
    insert into accounts.opening_balances(company_id, ledger_id, sub_ledger_id, business_unit_id, dr, cr, updated_by)
    values (p_company, v_vc, p_vendor_sub, p_bu, 0, p_delta, lower(coalesce(app.current_user_email(), 'system')));
  end if;
end $fn$;
revoke all on function accounts._opening_adjust(bigint, bigint, bigint, numeric) from public, anon, authenticated;

create or replace function accounts.opening_bill_enter(p_head jsonb) returns jsonb
 language plpgsql security definer set search_path = accounts, public as $fn$
declare
  me text; v_co bigint; co accounts.companies; v_bu bigint; v_vendor bigint; ven purchase.vendors; v_name text;
  v_inv text; v_date date; v_due date; v_amt numeric; v_vc bigint; v_sub bigint; v_pid bigint;
begin
  me := accounts._guard_post();
  v_co := nullif(p_head->>'company_id', '')::bigint;
  select * into co from accounts.companies where id = v_co and active;
  if not found then raise exception 'Choose the company'; end if;
  v_bu := nullif(p_head->>'business_unit_id', '')::bigint;
  if v_bu is not null and not exists (select 1 from accounts.business_units where id = v_bu and company_id = v_co) then raise exception 'That business unit does not belong to this company'; end if;
  v_vendor := nullif(p_head->>'vendor_id', '')::bigint;
  select * into ven from purchase.vendors where id = v_vendor and deleted_at is null;
  if not found then raise exception 'Choose the vendor'; end if;
  if ven.status <> 'approved' then raise exception 'Only an approved vendor can be billed (this one is %)', ven.status; end if;
  v_name := coalesce(nullif(ven.trade_name, ''), ven.legal_name) || ' (' || ven.code || ')';
  v_inv := nullif(btrim(coalesce(p_head->>'invoice_no', '')), '');
  if v_inv is null then raise exception 'Enter the vendor''s invoice number'; end if;
  v_date := nullif(p_head->>'invoice_date', '')::date;
  if v_date is null then raise exception 'Enter the invoice date'; end if;
  if v_date >= co.books_start then raise exception 'An opening bill is dated before the books start (%) - a bill from the books period is entered with Enter a bill', to_char(co.books_start, 'DD Mon YYYY'); end if;
  v_due := nullif(p_head->>'due_date', '')::date;
  v_amt := round(coalesce(nullif(p_head->>'amount', ''), '0')::numeric, 2);
  if v_amt <= 0 then raise exception 'Enter the amount still owed'; end if;
  perform accounts._check_open(v_co, co.books_start);                  -- opening figures belong to the books start date; refuse once that is locked
  if exists (select 1 from accounts.payables where company_id = v_co and vendor_id = v_vendor and kind = 'bill' and status = 'open' and lower(btrim(coalesce(ref_no, ''))) = lower(v_inv)) then
    raise exception 'Invoice % of this vendor is already entered', v_inv;
  end if;
  v_vc := accounts._key_ledger(v_co, 'vendor_control');
  v_sub := accounts._sub_ledger(v_vc, 'vendor', v_vendor, v_name);
  insert into accounts.payables(company_id, business_unit_id, vendor_id, sub_ledger_id, kind, ref_no, ref_date, due_date, amount, voucher_id, source_type)
  values (v_co, v_bu, v_vendor, v_sub, 'bill', v_inv, v_date, v_due, v_amt, null, 'opening') returning id into v_pid;
  perform accounts._opening_adjust(v_co, v_sub, v_bu, v_amt);
  insert into accounts.doc_log(doc_type, doc_id, action, remark) values ('payable', v_pid, 'Opening bill entered', v_inv);
  return jsonb_build_object('payable_id', v_pid, 'amount', v_amt);
end $fn$;
revoke all on function accounts.opening_bill_enter(jsonb) from public, anon;
grant execute on function accounts.opening_bill_enter(jsonb) to authenticated;

-- 5. Cancel an entered bill or an opening bill.
create or replace function accounts.bill_cancel(p_payable_id bigint, p_reason text) returns void
 language plpgsql security definer set search_path = accounts, public as $fn$
declare me text; p accounts.payables; co accounts.companies;
begin
  me := accounts._guard_post();
  select * into p from accounts.payables where id = p_payable_id for update;
  if not found or p.kind <> 'bill' or p.status <> 'open' then raise exception 'That bill is not open'; end if;
  if p.source_type is not null and p.source_type <> 'opening' then
    raise exception 'This bill came from % - reverse it from Ledgers & postings, so the source document is released too', p.source_type;
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason for cancelling'; end if;
  if exists (select 1 from accounts.payable_allocations where payable_id = p.id and status = 'active') then
    raise exception 'Payments, adjustments or debit notes have been set against this bill - cancel them first';
  end if;
  if p.source_type = 'opening' then
    select * into co from accounts.companies where id = p.company_id;
    perform accounts._check_open(p.company_id, co.books_start);
    perform accounts._opening_adjust(p.company_id, p.sub_ledger_id, p.business_unit_id, -p.amount);
  else
    perform accounts._cancel_voucher(p.voucher_id, p_reason, false);
  end if;
  update accounts.payables set status = 'cancelled' where id = p.id;
  insert into accounts.doc_log(doc_type, doc_id, action, remark) values ('payable', p.id, 'Bill cancelled', btrim(p_reason));
end $fn$;
revoke all on function accounts.bill_cancel(bigint, text) from public, anon;
grant execute on function accounts.bill_cancel(bigint, text) to authenticated;
