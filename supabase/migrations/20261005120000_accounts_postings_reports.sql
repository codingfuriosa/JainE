-- Accounts module, part 3: automatic postings from other modules, and the ledger reports. See docs/accounts-spec.md.
--
--   Purchase bill      Dr purchases / expense  Dr input GST  Cr vendor (net of TDS)  Cr TDS payable
--   Purchase debit note Dr vendor  Cr purchase returns  Cr input GST   (and set against its bill)
--   RA bill (Engineering) Dr contractor cost  Dr input GST  Cr contractor (net)  Cr retention payable  Cr TDS payable  Cr recoveries
--   Post Sales receipt  Dr bank / cash  Cr advance received from customers (one sub-ledger per booking)
--   Post Sales invoice  ONLY the GST: Dr advance from customers  Cr output CGST + SGST (or IGST). The invoice value itself never enters Accounts.
--
-- Nothing is posted by itself: Accounts posts what is waiting (one by one or "post all"), so the ledgers can be set up first.

-- Which ledger an expense head of a service / non-store bill is booked to.
create table if not exists accounts.expense_head_ledgers(
  company_id       bigint not null references accounts.companies(id),
  expense_head_id  bigint not null references purchase.expense_heads(id),
  ledger_id        bigint not null references accounts.ledgers(id),
  primary key (company_id, expense_head_id)
);

-- ---------------------------------------------------------------------------
-- Which posting ledgers a company is still missing
-- ---------------------------------------------------------------------------
create or replace function accounts.company_readiness(p_company bigint) returns jsonb
 language sql stable security invoker set search_path = accounts, public as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('key', k, 'label', accounts._key_label(k)) order by n), '[]'::jsonb)
    from unnest(array['vendor_control','purchases','expense_default','purchase_return','input_cgst','input_sgst','input_igst','tds_payable','retention_payable',
                      'contractor_cost','other_recoveries','customer_advance','output_cgst','output_sgst','output_igst','cash'])
         with ordinality as t(k, n)
   where not exists (select 1 from accounts.ledgers l where l.company_id = p_company and l.system_key = t.k and l.active)
$fn$;
revoke all on function accounts.company_readiness(bigint) from public, anon;
grant execute on function accounts.company_readiness(bigint) to authenticated;

-- GST split lines: [{ledger, amount}] for input / output, by intra / inter
create or replace function accounts._gst_lines(p_company bigint, p_side text, p_inter boolean, p_gst numeric, p_dr boolean) returns jsonb
 language plpgsql stable set search_path = accounts, public as $fn$
declare v_c numeric; v_s numeric; v_res jsonb := '[]'::jsonb; col text := case when p_dr then 'dr' else 'cr' end;
begin
  if coalesce(p_gst, 0) <= 0 then return v_res; end if;
  if p_inter then
    return jsonb_build_array(jsonb_build_object('ledger_id', accounts._key_ledger(p_company, p_side || '_igst'), col, p_gst));
  end if;
  v_c := round(p_gst / 2, 2); v_s := p_gst - v_c;
  v_res := v_res || jsonb_build_array(jsonb_build_object('ledger_id', accounts._key_ledger(p_company, p_side || '_cgst'), col, v_c));
  if v_s > 0 then v_res := v_res || jsonb_build_array(jsonb_build_object('ledger_id', accounts._key_ledger(p_company, p_side || '_sgst'), col, v_s)); end if;
  return v_res;
end $fn$;

create or replace function accounts._bu_company(p_project bigint, out bu_id bigint, out company_id bigint)
 language sql stable security definer set search_path = accounts, public as $fn$
  select b.id, b.company_id from accounts.business_units b join accounts.companies c on c.id = b.company_id and c.active
   where b.project_id = p_project and b.active
$fn$;

-- ---------------------------------------------------------------------------
-- Purchase bill
-- ---------------------------------------------------------------------------
create or replace function accounts.post_purchase_bill(p_id bigint) returns bigint
 language plpgsql security definer set search_path = accounts, public as $fn$
declare
  me text; b purchase.bills; v_bu bigint; v_co bigint; v_vendor purchase.vendors; v_name text; v_exp bigint; v_vc bigint; v_sub bigint; v_tds bigint; v_tsub bigint;
  v_net numeric; lines jsonb := '[]'::jsonb; v_id bigint; v_date date;
begin
  me := accounts._guard_post();
  select * into b from purchase.bills where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Bill not found'; end if;
  if b.status <> 'booked' then raise exception 'Only a booked bill can be posted to Accounts'; end if;
  if b.accounts_status = 'posted' then raise exception 'This bill is already posted'; end if;
  select bu_id, company_id into v_bu, v_co from accounts._bu_company(b.project_id);
  if v_bu is null then raise exception 'The project of this bill is not mapped to a business unit - map it under Transactions > Structure'; end if;
  if abs(b.taxable_value + b.cgst + b.sgst + b.igst - b.total_amount) > 0.02 then raise exception 'The bill totals do not add up (taxable + GST <> total)'; end if;
  select * into v_vendor from purchase.vendors where id = b.vendor_id;
  v_name := coalesce(nullif(v_vendor.trade_name, ''), v_vendor.legal_name) || ' (' || v_vendor.code || ')';
  if b.bill_type = 'goods' then
    v_exp := accounts._key_ledger(v_co, 'purchases');
  else
    select ledger_id into v_exp from accounts.expense_head_ledgers where company_id = v_co and expense_head_id = b.expense_head_id;
    if v_exp is null then v_exp := accounts._key_ledger(v_co, 'expense_default'); end if;
  end if;
  v_vc := accounts._key_ledger(v_co, 'vendor_control');
  v_sub := accounts._sub_ledger(v_vc, 'vendor', b.vendor_id, v_name);
  v_net := b.total_amount - b.tds_amount;
  lines := jsonb_build_array(jsonb_build_object('ledger_id', v_exp, 'dr', b.taxable_value, 'narration', 'Invoice ' || b.invoice_no));
  lines := lines || accounts._gst_lines(v_co, 'input', b.gst_type = 'inter', b.gst_total, true);
  lines := lines || jsonb_build_array(jsonb_build_object('ledger_id', v_vc, 'sub_ledger_id', v_sub, 'cr', v_net, 'narration', 'Invoice ' || b.invoice_no));
  if b.tds_amount > 0 then
    v_tds := accounts._key_ledger(v_co, 'tds_payable');
    v_tsub := accounts._sub_ledger(v_tds, 'vendor', b.vendor_id, v_name);
    lines := lines || jsonb_build_array(jsonb_build_object('ledger_id', v_tds, 'sub_ledger_id', v_tsub, 'cr', b.tds_amount, 'narration', 'TDS @ ' || b.tds_rate || '% on ' || b.invoice_no));
  end if;
  v_id := accounts._insert_voucher(v_co, v_bu, 'purchase_bill', b.bill_date, 'Bill ' || coalesce(b.doc_no, b.id::text) || ' - ' || v_name || ' - invoice ' || b.invoice_no,
            null, null, null, v_vendor.legal_name, 'purchase_bill', b.id, lines);
  insert into accounts.payables(company_id, business_unit_id, vendor_id, sub_ledger_id, kind, ref_no, ref_date, due_date, amount, voucher_id, source_type, source_id)
  values (v_co, v_bu, b.vendor_id, v_sub, 'bill', b.invoice_no, b.invoice_date, b.due_date, v_net, v_id, 'purchase_bill', b.id);
  update purchase.bills set accounts_status = 'posted', accounts_ref = (select doc_no from accounts.vouchers where id = v_id), accounts_posted_at = now() where id = b.id;
  return v_id;
end $fn$;
revoke all on function accounts.post_purchase_bill(bigint) from public, anon;
grant execute on function accounts.post_purchase_bill(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Purchase debit note
-- ---------------------------------------------------------------------------
create or replace function accounts.post_debit_note(p_id bigint) returns bigint
 language plpgsql security definer set search_path = accounts, public as $fn$
declare
  me text; d purchase.debit_notes; b purchase.bills; v_bu bigint; v_co bigint; pay accounts.payables; v_vc bigint; v_ret bigint; lines jsonb; v_id bigint; v_out numeric; v_alloc numeric; v_name text;
begin
  me := accounts._guard_post();
  select * into d from purchase.debit_notes where id = p_id for update;
  if not found then raise exception 'Debit note not found'; end if;
  if d.status <> 'issued' then raise exception 'Only an issued debit note can be posted'; end if;
  if d.accounts_status = 'posted' then raise exception 'This debit note is already posted'; end if;
  select * into b from purchase.bills where id = d.bill_id;
  select * into pay from accounts.payables where source_type = 'purchase_bill' and source_id = b.id and status = 'open' and kind = 'bill';
  if not found then raise exception 'Post the bill % to Accounts first - the debit note is set against it', coalesce(b.doc_no, b.id::text); end if;
  select bu_id, company_id into v_bu, v_co from accounts._bu_company(d.project_id);
  if v_bu is null or v_co <> pay.company_id then raise exception 'The project of this debit note is not mapped to the business unit of its bill'; end if;
  if abs(d.taxable_value + d.gst_amount - d.total_amount) > 0.02 then raise exception 'The debit note totals do not add up'; end if;
  select coalesce(nullif(trade_name, ''), legal_name) || ' (' || code || ')' into v_name from purchase.vendors where id = d.vendor_id;
  v_vc := accounts._key_ledger(v_co, 'vendor_control');
  v_ret := accounts._key_ledger(v_co, 'purchase_return');
  lines := jsonb_build_array(jsonb_build_object('ledger_id', v_vc, 'sub_ledger_id', pay.sub_ledger_id, 'dr', d.total_amount, 'narration', 'Debit note ' || coalesce(d.doc_no, d.id::text)),
                             jsonb_build_object('ledger_id', v_ret, 'cr', d.taxable_value));
  lines := lines || accounts._gst_lines(v_co, 'input', b.gst_type = 'inter', d.gst_amount, false);
  v_id := accounts._insert_voucher(v_co, v_bu, 'debit_note', d.dn_date, 'Debit note ' || coalesce(d.doc_no, d.id::text) || ' on bill ' || coalesce(b.doc_no, b.id::text) || ' - ' || v_name,
            null, null, null, null, 'purchase_dn', d.id, lines);
  select outstanding into v_out from accounts.v_payables where id = pay.id;
  v_alloc := least(d.total_amount, greatest(v_out, 0));
  if v_alloc > 0 then
    insert into accounts.payable_allocations(company_id, payable_id, from_voucher_id, kind, amount, alloc_date) values (v_co, pay.id, v_id, 'debit_note', v_alloc, d.dn_date);
  end if;
  update purchase.debit_notes set accounts_status = 'posted', accounts_ref = (select doc_no from accounts.vouchers where id = v_id), accounts_posted_at = now() where id = d.id;
  return v_id;
end $fn$;
revoke all on function accounts.post_debit_note(bigint) from public, anon;
grant execute on function accounts.post_debit_note(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Engineering RA bill: the contractor's gross bill, GST, and the amounts held back (retention, TDS, other deductions)
-- ---------------------------------------------------------------------------
create or replace function accounts._ra_amounts(p_id bigint) returns jsonb
 language sql stable security definer set search_path = accounts, public as $fn$
  select jsonb_build_object(
    'gross', g.gross, 'gst', round(g.gross * r.gst_pct / 100, 2), 'retention', round(g.gross * r.retention_pct / 100, 2),
    'tds', round(g.gross * r.tds_pct / 100, 2), 'other', r.other_deduction,
    'net', g.gross + round(g.gross * r.gst_pct / 100, 2) - round(g.gross * r.retention_pct / 100, 2) - round(g.gross * r.tds_pct / 100, 2) - r.other_deduction)
    from eng.ra_bills r
    cross join lateral (select round(coalesce(sum(wd.qty * wi.rate), 0), 2) as gross
                          from eng.work_done wd join eng.wo_items wi on wi.id = wd.wo_item_id where wd.ra_bill_id = r.id) g
   where r.id = p_id
$fn$;
revoke all on function accounts._ra_amounts(bigint) from public, anon, authenticated;

create or replace function accounts.post_ra_bill(p_id bigint) returns bigint
 language plpgsql security definer set search_path = accounts, public as $fn$
declare
  me text; r eng.ra_bills; w eng.work_orders; v_bu bigint; v_co bigint; ven purchase.vendors; co accounts.companies; v_name text; am jsonb;
  v_gross numeric; v_gst numeric; v_ret numeric; v_tds numeric; v_oth numeric; v_net numeric; v_inter boolean;
  v_vc bigint; v_sub bigint; lines jsonb; v_id bigint; v_rp bigint; v_rsub bigint; v_tl bigint; v_tsub bigint;
begin
  me := accounts._guard_post();
  select * into r from eng.ra_bills where id = p_id;
  if not found then raise exception 'RA bill not found'; end if;
  if r.status <> 'Booked' then raise exception 'Only a booked RA bill can be posted to Accounts'; end if;
  if exists (select 1 from accounts.vouchers where source_type = 'ra_bill' and source_id = p_id and status = 'posted') then raise exception 'This RA bill is already posted'; end if;
  select * into w from eng.work_orders where id = r.wo_id;
  select bu_id, company_id into v_bu, v_co from accounts._bu_company(w.project_id);
  if v_bu is null then raise exception 'The project of this work order is not mapped to a business unit - map it under Transactions > Structure'; end if;
  select * into co from accounts.companies where id = v_co;
  select * into ven from purchase.vendors where id = w.vendor_id;
  v_name := coalesce(nullif(ven.trade_name, ''), ven.legal_name) || ' (' || ven.code || ')';
  am := accounts._ra_amounts(p_id);
  v_gross := (am->>'gross')::numeric; v_gst := (am->>'gst')::numeric; v_ret := (am->>'retention')::numeric; v_tds := (am->>'tds')::numeric; v_oth := (am->>'other')::numeric; v_net := (am->>'net')::numeric;
  if v_gross <= 0 then raise exception 'This RA bill has no work value'; end if;
  if v_net < 0 then raise exception 'The deductions are more than the bill'; end if;
  v_inter := coalesce(co.state_code is not null and ven.gstin ~ '^[0-9]{2}' and left(ven.gstin, 2) <> co.state_code, false);
  v_vc := accounts._key_ledger(v_co, 'vendor_control');
  v_sub := accounts._sub_ledger(v_vc, 'vendor', w.vendor_id, v_name);
  lines := jsonb_build_array(jsonb_build_object('ledger_id', accounts._key_ledger(v_co, 'contractor_cost'), 'dr', v_gross, 'narration', 'Work done - ' || r.bill_no));
  lines := lines || accounts._gst_lines(v_co, 'input', v_inter, v_gst, true);
  if v_net > 0 then lines := lines || jsonb_build_array(jsonb_build_object('ledger_id', v_vc, 'sub_ledger_id', v_sub, 'cr', v_net, 'narration', r.bill_no)); end if;
  if v_ret > 0 then
    v_rp := accounts._key_ledger(v_co, 'retention_payable');
    v_rsub := accounts._sub_ledger(v_rp, 'vendor', w.vendor_id, v_name);
    lines := lines || jsonb_build_array(jsonb_build_object('ledger_id', v_rp, 'sub_ledger_id', v_rsub, 'cr', v_ret, 'narration', 'Retention ' || r.retention_pct || '% on ' || r.bill_no));
  end if;
  if v_tds > 0 then
    v_tl := accounts._key_ledger(v_co, 'tds_payable');
    v_tsub := accounts._sub_ledger(v_tl, 'vendor', w.vendor_id, v_name);
    lines := lines || jsonb_build_array(jsonb_build_object('ledger_id', v_tl, 'sub_ledger_id', v_tsub, 'cr', v_tds, 'narration', 'TDS @ ' || r.tds_pct || '% on ' || r.bill_no));
  end if;
  if v_oth > 0 then lines := lines || jsonb_build_array(jsonb_build_object('ledger_id', accounts._key_ledger(v_co, 'other_recoveries'), 'cr', v_oth, 'narration', coalesce(r.other_deduction_note, 'Other deduction'))); end if;
  v_id := accounts._insert_voucher(v_co, v_bu, 'ra_bill', r.bill_date, 'RA bill ' || r.bill_no || ' - ' || w.title || ' - ' || v_name,
            null, null, null, ven.legal_name, 'ra_bill', p_id, lines);
  if v_net > 0 then
    insert into accounts.payables(company_id, business_unit_id, vendor_id, sub_ledger_id, kind, ref_no, ref_date, amount, voucher_id, source_type, source_id)
    values (v_co, v_bu, w.vendor_id, v_sub, 'bill', r.bill_no, r.bill_date, v_net, v_id, 'ra_bill', p_id);
  end if;
  if v_ret > 0 then
    insert into accounts.payables(company_id, business_unit_id, vendor_id, sub_ledger_id, kind, ref_no, ref_date, amount, voucher_id, source_type, source_id)
    values (v_co, v_bu, w.vendor_id, v_rsub, 'retention', r.bill_no || ' retention', r.bill_date, v_ret, v_id, 'ra_bill', p_id);
  end if;
  return v_id;
end $fn$;
revoke all on function accounts.post_ra_bill(bigint) from public, anon;
grant execute on function accounts.post_ra_bill(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Post Sales: receipts as advance received from customers, and only the GST of invoices
-- ---------------------------------------------------------------------------
create or replace function accounts._customer_sub(p_company bigint, p_booking bigint) returns bigint
 language plpgsql security definer set search_path = accounts, public as $fn$
declare v_led bigint; v_name text; v_no text;
begin
  if p_booking is null then raise exception 'The document has no booking, so there is no customer to credit'; end if;
  v_led := accounts._key_ledger(p_company, 'customer_advance');
  select booking_no into v_no from postsales.bookings where id = p_booking;
  select full_name into v_name from postsales.booking_applicants where booking_id = p_booking order by seq limit 1;
  return accounts._sub_ledger(v_led, 'customer', p_booking, coalesce(v_name, 'Customer') || ' - ' || coalesce(v_no, 'booking ' || p_booking));
end $fn$;
revoke all on function accounts._customer_sub(bigint, bigint) from public, anon, authenticated;

create or replace function accounts.post_ps_receipt(p_id bigint) returns bigint
 language plpgsql security definer set search_path = accounts, public as $fn$
declare
  me text; r postsales.receipts; v_bu bigint; v_co bigint; v_bank bigint; v_sub bigint; v_mode text; v_id bigint; v_cust text; v_acct text;
begin
  me := accounts._guard_post();
  select * into r from postsales.receipts where id = p_id;
  if not found then raise exception 'Receipt not found'; end if;
  if r.status <> 'active' then raise exception 'Only an active receipt can be posted (this one is %)', r.status; end if;
  if exists (select 1 from accounts.vouchers where source_type = 'ps_receipt' and source_id = p_id and status = 'posted') then raise exception 'This receipt is already posted'; end if;
  select bu_id, company_id into v_bu, v_co from accounts._bu_company(r.project_id);
  if v_bu is null then raise exception 'The project of this receipt is not mapped to a business unit - map it under Transactions > Structure'; end if;
  if r.bank_account_id is not null then
    select id into v_bank from accounts.ledgers where ps_bank_account_id = r.bank_account_id and company_id = v_co and active;
    if v_bank is null then
      select name into v_acct from postsales.bank_accounts where id = r.bank_account_id;
      raise exception 'The Post Sales account "%" is not linked to a ledger of this company - link it under Ledgers & postings > Posting ledgers', coalesce(v_acct, r.bank_account_id::text);
    end if;
  elsif r.mode = 'cash' then
    v_bank := accounts._key_ledger(v_co, 'cash');
  else
    raise exception 'The receipt names no bank account';
  end if;
  v_sub := accounts._customer_sub(v_co, r.booking_id);
  select full_name into v_cust from postsales.booking_applicants where booking_id = r.booking_id order by seq limit 1;
  v_mode := case r.mode when 'cash' then 'cash' when 'cheque' then 'cheque' when 'dd' then 'dd' when 'rtgs_neft_imps' then 'neft' when 'net_banking' then 'transfer' when 'transfer' then 'transfer' else 'other' end;
  v_id := accounts._insert_voucher(v_co, v_bu, 'advance_receipt', r.receipt_date, 'Receipt ' || r.receipt_no || ' - advance from ' || coalesce(v_cust, 'customer') || coalesce(' - ' || nullif(r.narration, ''), ''),
            v_mode, r.instrument_no, r.instrument_date, coalesce(r.paid_by, v_cust), 'ps_receipt', r.id,
            jsonb_build_array(jsonb_build_object('ledger_id', v_bank, 'dr', r.amount),
                              jsonb_build_object('ledger_id', accounts._key_ledger(v_co, 'customer_advance'), 'sub_ledger_id', v_sub, 'cr', r.amount, 'narration', r.receipt_no)));
  return v_id;
end $fn$;
revoke all on function accounts.post_ps_receipt(bigint) from public, anon;
grant execute on function accounts.post_ps_receipt(bigint) to authenticated;

create or replace function accounts.post_ps_invoice(p_id bigint) returns bigint
 language plpgsql security definer set search_path = accounts, public as $fn$
declare
  me text; i postsales.invoices; v_bu bigint; v_co bigint; v_sub bigint; v_inter boolean; v_cust text; lines jsonb; v_id bigint;
begin
  me := accounts._guard_post();
  select * into i from postsales.invoices where id = p_id;
  if not found then raise exception 'Invoice not found'; end if;
  if i.status = 'cancelled' then raise exception 'A cancelled invoice has no GST to post'; end if;
  if coalesce(i.gst, 0) <= 0 then raise exception 'This invoice carries no GST'; end if;
  if exists (select 1 from accounts.vouchers where source_type = 'ps_invoice' and source_id = p_id and status = 'posted') then raise exception 'The GST of this invoice is already posted'; end if;
  select bu_id, company_id into v_bu, v_co from accounts._bu_company(i.project_id);
  if v_bu is null then raise exception 'The project of this invoice is not mapped to a business unit - map it under Transactions > Structure'; end if;
  v_sub := accounts._customer_sub(v_co, i.booking_id);
  select full_name into v_cust from postsales.booking_applicants where booking_id = i.booking_id order by seq limit 1;
  v_inter := coalesce((select value from accounts.settings where company_id = v_co and key = 'customer_gst.supply'), 'intra') = 'inter';
  lines := jsonb_build_array(jsonb_build_object('ledger_id', accounts._key_ledger(v_co, 'customer_advance'), 'sub_ledger_id', v_sub, 'dr', i.gst, 'narration', 'GST on ' || i.invoice_no));
  lines := lines || accounts._gst_lines(v_co, 'output', v_inter, i.gst, false);
  v_id := accounts._insert_voucher(v_co, v_bu, 'customer_gst', i.invoice_date, 'GST on invoice ' || i.invoice_no || ' - ' || coalesce(v_cust, 'customer') || ' (invoice value not booked here)',
            null, null, null, null, 'ps_invoice', i.id, lines);
  return v_id;
end $fn$;
revoke all on function accounts.post_ps_invoice(bigint) from public, anon;
grant execute on function accounts.post_ps_invoice(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Reversing a posting: releases the source document so it can be corrected and posted again
-- ---------------------------------------------------------------------------
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
-- What is waiting to be posted (and what must be reversed)
-- p_source: purchase_bill | purchase_dn | ra_bill | ps_receipt | ps_invoice
-- Returns {total, blocked, reverse, rows:[...]}.  A row with a blocker cannot be posted yet.
-- ---------------------------------------------------------------------------
create or replace function accounts.pending_postings(p_source text, p_company bigint default null, p_limit int default 400) returns jsonb
 language plpgsql security definer set search_path = accounts, public as $fn$
declare v_rows jsonb; v_total int; v_blocked int; v_rev int; v_rev_rows jsonb; v_blockers jsonb;
begin
  if not accounts.can_read() then raise exception 'not allowed'; end if;
  drop table if exists pg_temp._pp;
  if p_source = 'purchase_bill' then
    create temp table _pp on commit drop as
      select b.id, coalesce(b.doc_no, 'Draft ' || b.id) as ref, b.bill_date as dt, coalesce(nullif(v.trade_name, ''), v.legal_name) as party, b.project_id, p.name as project,
             b.total_amount as amount, bu.id as bu_id, bu.company_id,
             jsonb_build_object('invoice', b.invoice_no, 'taxable', b.taxable_value, 'gst', b.gst_total, 'tds', b.tds_amount, 'type', b.bill_type, 'hold', b.accounts_status = 'hold') as extra,
             case when bu.id is null then 'Project is not mapped to a business unit'
                  when b.bill_date < c.books_start then 'Dated before the books start (' || to_char(c.books_start, 'DD Mon YYYY') || ')' end as blocker
        from purchase.bills b join purchase.vendors v on v.id = b.vendor_id join cust.projects p on p.id = b.project_id
        left join accounts.business_units bu on bu.project_id = b.project_id and bu.active
        left join accounts.companies c on c.id = bu.company_id
       where b.status = 'booked' and b.deleted_at is null and b.accounts_status in ('ready', 'hold') and (p_company is null or bu.company_id = p_company or bu.id is null);
  elsif p_source = 'purchase_dn' then
    create temp table _pp on commit drop as
      select d.id, coalesce(d.doc_no, 'Draft ' || d.id) as ref, d.dn_date as dt, coalesce(nullif(v.trade_name, ''), v.legal_name) as party, d.project_id, p.name as project,
             d.total_amount as amount, bu.id as bu_id, bu.company_id,
             jsonb_build_object('bill', b.doc_no, 'taxable', d.taxable_value, 'gst', d.gst_amount, 'kind', d.kind) as extra,
             case when bu.id is null then 'Project is not mapped to a business unit'
                  when b.accounts_status <> 'posted' then 'Post bill ' || coalesce(b.doc_no, b.id::text) || ' first'
                  when d.dn_date < c.books_start then 'Dated before the books start' end as blocker
        from purchase.debit_notes d join purchase.bills b on b.id = d.bill_id join purchase.vendors v on v.id = d.vendor_id join cust.projects p on p.id = d.project_id
        left join accounts.business_units bu on bu.project_id = d.project_id and bu.active
        left join accounts.companies c on c.id = bu.company_id
       where d.status = 'issued' and d.accounts_status in ('ready', 'hold') and (p_company is null or bu.company_id = p_company or bu.id is null);
  elsif p_source = 'ra_bill' then
    create temp table _pp on commit drop as
      select r.id, r.bill_no as ref, r.bill_date as dt, coalesce(nullif(v.trade_name, ''), v.legal_name) as party, w.project_id, p.name as project,
             (accounts._ra_amounts(r.id)->>'net')::numeric as amount, bu.id as bu_id, bu.company_id,
             accounts._ra_amounts(r.id) || jsonb_build_object('wo', w.wo_no, 'retention_pct', r.retention_pct) as extra,
             case when bu.id is null then 'Project is not mapped to a business unit'
                  when (accounts._ra_amounts(r.id)->>'gross')::numeric <= 0 then 'No work value on this bill'
                  when r.bill_date < c.books_start then 'Dated before the books start' end as blocker
        from eng.ra_bills r join eng.work_orders w on w.id = r.wo_id join purchase.vendors v on v.id = w.vendor_id join cust.projects p on p.id = w.project_id
        left join accounts.business_units bu on bu.project_id = w.project_id and bu.active
        left join accounts.companies c on c.id = bu.company_id
       where r.status = 'Booked' and (p_company is null or bu.company_id = p_company or bu.id is null)
         and not exists (select 1 from accounts.vouchers x where x.source_type = 'ra_bill' and x.source_id = r.id and x.status = 'posted');
  elsif p_source = 'ps_receipt' then
    create temp table _pp on commit drop as
      select r.id, r.receipt_no as ref, r.receipt_date as dt, (select full_name from postsales.booking_applicants a where a.booking_id = r.booking_id order by seq limit 1) as party,
             r.project_id, p.name as project, r.amount, bu.id as bu_id, bu.company_id,
             jsonb_build_object('mode', r.mode, 'instrument', r.instrument_no, 'account', ba.name) as extra,
             case when bu.id is null then 'Project is not mapped to a business unit'
                  when r.booking_id is null then 'No booking on the receipt'
                  when r.bank_account_id is not null and not exists (select 1 from accounts.ledgers l where l.ps_bank_account_id = r.bank_account_id and l.company_id = bu.company_id and l.active)
                       then 'Post Sales account "' || coalesce(ba.name, r.bank_account_id::text) || '" is not linked to a ledger'
                  when r.bank_account_id is null and r.mode <> 'cash' then 'The receipt names no bank account'
                  when r.receipt_date < c.books_start then 'Dated before the books start' end as blocker
        from postsales.receipts r join cust.projects p on p.id = r.project_id left join postsales.bank_accounts ba on ba.id = r.bank_account_id
        left join accounts.business_units bu on bu.project_id = r.project_id and bu.active
        left join accounts.companies c on c.id = bu.company_id
       where r.status = 'active' and (p_company is null or bu.company_id = p_company or bu.id is null)
         and not exists (select 1 from accounts.vouchers x where x.source_type = 'ps_receipt' and x.source_id = r.id and x.status = 'posted');
  elsif p_source = 'ps_invoice' then
    create temp table _pp on commit drop as
      select i.id, i.invoice_no as ref, i.invoice_date as dt, (select full_name from postsales.booking_applicants a where a.booking_id = i.booking_id order by seq limit 1) as party,
             i.project_id, p.name as project, i.gst as amount, bu.id as bu_id, bu.company_id,
             jsonb_build_object('net', i.net, 'total', i.total, 'title', i.title) as extra,
             case when bu.id is null then 'Project is not mapped to a business unit'
                  when i.booking_id is null then 'No booking on the invoice'
                  when i.invoice_date < c.books_start then 'Dated before the books start' end as blocker
        from postsales.invoices i join cust.projects p on p.id = i.project_id
        left join accounts.business_units bu on bu.project_id = i.project_id and bu.active
        left join accounts.companies c on c.id = bu.company_id
       where i.status <> 'cancelled' and coalesce(i.gst, 0) > 0 and (p_company is null or bu.company_id = p_company or bu.id is null)
         and not exists (select 1 from accounts.vouchers x where x.source_type = 'ps_invoice' and x.source_id = i.id and x.status = 'posted');
  else
    raise exception 'Unknown source %', p_source;
  end if;
  select count(*), count(*) filter (where blocker is not null) into v_total, v_blocked from _pp;
  select coalesce(jsonb_agg(to_jsonb(q) order by (q.blocker is not null), q.dt, q.id), '[]'::jsonb) into v_rows
    from (select * from _pp order by (blocker is not null), dt, id limit greatest(p_limit, 1)) q;
  select coalesce(jsonb_object_agg(blocker, n), '{}'::jsonb) into v_blockers from (select blocker, count(*) n from _pp where blocker is not null group by 1) t;
  -- postings whose source has since been cancelled / reversed
  select coalesce(jsonb_agg(jsonb_build_object('voucher_id', vo.id, 'voucher_no', vo.doc_no, 'ref', x.ref, 'dt', vo.voucher_date, 'amount', vo.amount, 'why', x.why) order by vo.voucher_date), '[]'::jsonb)
    into v_rev_rows
    from accounts.vouchers vo
    join lateral (
      select r.receipt_no as ref, 'Receipt is ' || r.status || ' in Post Sales' as why from postsales.receipts r where vo.source_type = 'ps_receipt' and r.id = vo.source_id and r.status <> 'active'
      union all select i.invoice_no, 'Invoice is cancelled in Post Sales' from postsales.invoices i where vo.source_type = 'ps_invoice' and i.id = vo.source_id and i.status = 'cancelled'
      union all select rb.bill_no, 'RA bill is cancelled' from eng.ra_bills rb where vo.source_type = 'ra_bill' and rb.id = vo.source_id and rb.status = 'Cancelled'
    ) x on true
   where vo.status = 'posted' and vo.source_type = p_source and (p_company is null or vo.company_id = p_company);
  v_rev := jsonb_array_length(v_rev_rows);
  return jsonb_build_object('total', v_total, 'blocked', v_blocked, 'reverse', v_rev, 'rows', v_rows, 'reverse_rows', v_rev_rows, 'blockers', v_blockers);
end $fn$;
revoke all on function accounts.pending_postings(text, bigint, int) from public, anon;
grant execute on function accounts.pending_postings(text, bigint, int) to authenticated;

-- Post what is waiting. p_ids limits it to chosen documents; otherwise everything postable (up to p_limit) goes.
create or replace function accounts.post_batch(p_source text, p_company bigint, p_ids bigint[] default null, p_limit int default 300) returns jsonb
 language plpgsql security definer set search_path = accounts, public as $fn$
declare
  me text; r jsonb; v_posted int := 0; v_failed int := 0; errs jsonb := '[]'::jsonb; v_id bigint; v_list jsonb;
begin
  me := accounts._guard_post();
  v_list := accounts.pending_postings(p_source, p_company, 100000)->'rows';
  for r in select * from jsonb_array_elements(v_list) loop
    exit when v_posted + v_failed >= greatest(p_limit, 1);
    if r->>'blocker' is not null then continue; end if;
    v_id := (r->>'id')::bigint;
    if p_ids is not null and not (v_id = any (p_ids)) then continue; end if;
    begin
      if p_source = 'purchase_bill' then perform accounts.post_purchase_bill(v_id);
      elsif p_source = 'purchase_dn' then perform accounts.post_debit_note(v_id);
      elsif p_source = 'ra_bill' then perform accounts.post_ra_bill(v_id);
      elsif p_source = 'ps_receipt' then perform accounts.post_ps_receipt(v_id);
      elsif p_source = 'ps_invoice' then perform accounts.post_ps_invoice(v_id);
      end if;
      v_posted := v_posted + 1;
    exception when others then
      v_failed := v_failed + 1;
      if jsonb_array_length(errs) < 25 then errs := errs || jsonb_build_array(jsonb_build_object('id', v_id, 'ref', r->>'ref', 'error', sqlerrm)); end if;
    end;
  end loop;
  return jsonb_build_object('posted', v_posted, 'failed', v_failed, 'errors', errs);
end $fn$;
revoke all on function accounts.post_batch(text, bigint, bigint[], int) from public, anon;
grant execute on function accounts.post_batch(text, bigint, bigint[], int) to authenticated;

-- How many of each kind of source are posted / waiting (for the tiles on the postings screen).
create or replace function accounts.posting_counts(p_company bigint default null) returns jsonb
 language sql stable security invoker set search_path = accounts, public as $fn$
  select coalesce(jsonb_object_agg(source_type, n), '{}'::jsonb)
    from (select source_type, count(*) n from accounts.vouchers where status = 'posted' and source_type is not null and (p_company is null or company_id = p_company) group by 1) t
$fn$;
revoke all on function accounts.posting_counts(bigint) from public, anon;
grant execute on function accounts.posting_counts(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Ledger reports.  Balances are Dr minus Cr (positive = debit).
-- Income and expense ledgers start afresh each financial year; balance-sheet ledgers carry forward from the books start.
-- ---------------------------------------------------------------------------
create or replace function accounts.ledger_statement(p_company bigint, p_ledger bigint, p_sub bigint default null, p_from date default null, p_to date default null, p_bu bigint default null) returns jsonb
 language plpgsql stable security invoker set search_path = accounts, public as $fn$
declare
  c accounts.companies; l accounts.ledgers; g accounts.account_groups; v_from date; v_to date; v_pl boolean; v_base date; v_ob numeric := 0; v_ent numeric := 0; v_open numeric; v_rows jsonb; v_cr numeric; v_dr numeric;
begin
  select * into c from accounts.companies where id = p_company;
  select * into l from accounts.ledgers where id = p_ledger and company_id = p_company;
  if not found then raise exception 'Ledger not found'; end if;
  if l.ledger_type <> 'general' then raise exception 'Use the cost ledger statement for cost / custom ledgers'; end if;
  select * into g from accounts.account_groups where id = l.group_id;
  v_from := greatest(coalesce(p_from, c.books_start), c.books_start);
  v_to := coalesce(p_to, current_date);
  v_pl := g.nature in ('income', 'expense');
  v_base := case when v_pl then accounts._fy_start(p_company, v_from) else c.books_start end;
  if not v_pl or accounts._fy_start(p_company, c.books_start) = accounts._fy_start(p_company, v_from) then
    select coalesce(sum(dr - cr), 0) into v_ob from accounts.opening_balances
     where ledger_id = p_ledger and (p_sub is null or sub_ledger_id = p_sub) and (p_bu is null or business_unit_id = p_bu);
  end if;
  select coalesce(sum(ln.dr - ln.cr), 0) into v_ent
    from accounts.voucher_lines ln join accounts.vouchers v on v.id = ln.voucher_id
   where ln.ledger_id = p_ledger and v.status = 'posted' and v.voucher_date >= v_base and v.voucher_date < v_from
     and (p_sub is null or ln.sub_ledger_id = p_sub) and (p_bu is null or v.business_unit_id = p_bu);
  v_open := v_ob + v_ent;
  with e as (
    select v.id as voucher_id, v.doc_no, v.voucher_date as dt, v.voucher_type as vtype, coalesce(ln.narration, v.narration) as narration, s.name as sub_ledger, ln.dr, ln.cr,
           ln.id as line_id, ln.cleared_on
      from accounts.voucher_lines ln join accounts.vouchers v on v.id = ln.voucher_id left join accounts.sub_ledgers s on s.id = ln.sub_ledger_id
     where ln.ledger_id = p_ledger and v.status = 'posted' and v.voucher_date >= v_from and v.voucher_date <= v_to
       and (p_sub is null or ln.sub_ledger_id = p_sub) and (p_bu is null or v.business_unit_id = p_bu)),
  r as (select e.*, v_open + sum(e.dr - e.cr) over (order by e.dt, e.voucher_id, e.line_id) as balance from e)
  select coalesce(jsonb_agg(to_jsonb(r) - 'line_id' order by r.dt, r.voucher_id, r.line_id), '[]'::jsonb), coalesce(sum(r.dr), 0), coalesce(sum(r.cr), 0) into v_rows, v_dr, v_cr from r;
  return jsonb_build_object('ledger', l.name, 'code', l.code, 'group', g.name, 'nature', g.nature, 'from', v_from, 'to', v_to, 'opening', v_open,
                            'total_dr', v_dr, 'total_cr', v_cr, 'closing', v_open + v_dr - v_cr, 'rows', v_rows);
end $fn$;
revoke all on function accounts.ledger_statement(bigint, bigint, bigint, date, date, bigint) from public, anon;
grant execute on function accounts.ledger_statement(bigint, bigint, bigint, date, date, bigint) to authenticated;

-- Statement of a cost / custom ledger (and optionally one of its sub-ledgers): the lines that were tagged to it.
create or replace function accounts.cost_statement(p_company bigint, p_ledger bigint, p_sub bigint default null, p_from date default null, p_to date default null, p_bu bigint default null) returns jsonb
 language plpgsql stable security invoker set search_path = accounts, public as $fn$
declare
  c accounts.companies; l accounts.ledgers; v_from date; v_to date; v_ob numeric; v_ent numeric; v_open numeric; v_rows jsonb; v_dr numeric; v_cr numeric;
begin
  select * into c from accounts.companies where id = p_company;
  select * into l from accounts.ledgers where id = p_ledger and company_id = p_company and ledger_type <> 'general';
  if not found then raise exception 'Cost / custom ledger not found'; end if;
  v_from := greatest(coalesce(p_from, c.books_start), c.books_start);
  v_to := coalesce(p_to, current_date);
  select coalesce(sum(dr - cr), 0) into v_ob from accounts.opening_balances where ledger_id = p_ledger and (p_sub is null or sub_ledger_id = p_sub) and (p_bu is null or business_unit_id = p_bu);
  select coalesce(sum(ln.dr - ln.cr), 0) into v_ent
    from accounts.voucher_lines ln join accounts.vouchers v on v.id = ln.voucher_id
   where ln.cost_ledger_id = p_ledger and v.status = 'posted' and v.voucher_date < v_from
     and (p_sub is null or ln.cost_sub_ledger_id = p_sub) and (p_bu is null or v.business_unit_id = p_bu);
  v_open := v_ob + v_ent;
  with e as (
    select v.id as voucher_id, v.doc_no, v.voucher_date as dt, v.voucher_type as vtype, coalesce(ln.narration, v.narration) as narration, g.name as ledger, s.name as sub_ledger, ln.dr, ln.cr, ln.id as line_id
      from accounts.voucher_lines ln join accounts.vouchers v on v.id = ln.voucher_id join accounts.ledgers g on g.id = ln.ledger_id
      left join accounts.sub_ledgers s on s.id = ln.cost_sub_ledger_id
     where ln.cost_ledger_id = p_ledger and v.status = 'posted' and v.voucher_date >= v_from and v.voucher_date <= v_to
       and (p_sub is null or ln.cost_sub_ledger_id = p_sub) and (p_bu is null or v.business_unit_id = p_bu)),
  r as (select e.*, v_open + sum(e.dr - e.cr) over (order by e.dt, e.voucher_id, e.line_id) as balance from e)
  select coalesce(jsonb_agg(to_jsonb(r) - 'line_id' order by r.dt, r.voucher_id, r.line_id), '[]'::jsonb), coalesce(sum(r.dr), 0), coalesce(sum(r.cr), 0) into v_rows, v_dr, v_cr from r;
  return jsonb_build_object('ledger', l.name, 'code', l.code, 'from', v_from, 'to', v_to, 'opening', v_open, 'total_dr', v_dr, 'total_cr', v_cr, 'closing', v_open + v_dr - v_cr, 'rows', v_rows);
end $fn$;
revoke all on function accounts.cost_statement(bigint, bigint, bigint, date, date, bigint) from public, anon;
grant execute on function accounts.cost_statement(bigint, bigint, bigint, date, date, bigint) to authenticated;

-- Balance of each sub-ledger of a ledger (general: vendors, customers ...; cost / custom: its sub-ledgers) as on a date.
create or replace function accounts.sub_ledger_balances(p_company bigint, p_ledger bigint, p_as_on date default null, p_bu bigint default null) returns jsonb
 language plpgsql stable security invoker set search_path = accounts, public as $fn$
declare l accounts.ledgers; v_to date := coalesce(p_as_on, current_date); v_rows jsonb;
begin
  select * into l from accounts.ledgers where id = p_ledger and company_id = p_company;
  if not found then raise exception 'Ledger not found'; end if;
  with ob as (select sub_ledger_id, sum(dr) dr, sum(cr) cr from accounts.opening_balances where ledger_id = p_ledger and sub_ledger_id is not null and (p_bu is null or business_unit_id = p_bu) group by 1),
       en as (select case when l.ledger_type = 'general' then ln.sub_ledger_id else ln.cost_sub_ledger_id end as sub_ledger_id, sum(ln.dr) dr, sum(ln.cr) cr
                from accounts.voucher_lines ln join accounts.vouchers v on v.id = ln.voucher_id
               where (case when l.ledger_type = 'general' then ln.ledger_id else ln.cost_ledger_id end) = p_ledger and v.status = 'posted' and v.voucher_date <= v_to
                 and (p_bu is null or v.business_unit_id = p_bu) group by 1),
       t as (select s.id, s.name, s.party_type, coalesce(ob.dr, 0) + coalesce(en.dr, 0) as dr, coalesce(ob.cr, 0) + coalesce(en.cr, 0) as cr
               from accounts.sub_ledgers s left join ob on ob.sub_ledger_id = s.id left join en on en.sub_ledger_id = s.id where s.ledger_id = p_ledger)
  select coalesce(jsonb_agg(jsonb_build_object('sub_ledger_id', t.id, 'name', t.name, 'party_type', t.party_type, 'dr', t.dr, 'cr', t.cr, 'balance', t.dr - t.cr) order by t.name) filter (where t.dr <> 0 or t.cr <> 0), '[]'::jsonb)
    into v_rows from t;
  return jsonb_build_object('ledger', l.name, 'as_on', v_to, 'rows', v_rows);
end $fn$;
revoke all on function accounts.sub_ledger_balances(bigint, bigint, date, bigint) from public, anon;
grant execute on function accounts.sub_ledger_balances(bigint, bigint, date, bigint) to authenticated;

-- Trial balance of the general ledgers for a period.
create or replace function accounts.trial_balance(p_company bigint, p_from date default null, p_to date default null, p_bu bigint default null) returns jsonb
 language plpgsql stable security invoker set search_path = accounts, public as $fn$
declare
  c accounts.companies; v_from date; v_to date; v_fy date; v_first_fy date; v_rows jsonb; v_carry numeric := 0;
begin
  select * into c from accounts.companies where id = p_company;
  if not found then raise exception 'Company not found'; end if;
  v_from := greatest(coalesce(p_from, c.books_start), c.books_start);
  v_to := coalesce(p_to, current_date);
  v_fy := accounts._fy_start(p_company, v_from);
  v_first_fy := accounts._fy_start(p_company, c.books_start);
  with led as (
    select l.id, l.code, l.name, g.id as group_id, g.name as group_name, g.nature, g.nature in ('income', 'expense') as pl
      from accounts.ledgers l join accounts.account_groups g on g.id = l.group_id where l.company_id = p_company and l.ledger_type = 'general'),
  ob as (select ledger_id, sum(dr - cr) as amt from accounts.opening_balances where company_id = p_company and (p_bu is null or business_unit_id = p_bu) group by 1),
  en as (select ln.ledger_id, v.voucher_date as d, ln.dr, ln.cr
           from accounts.voucher_lines ln join accounts.vouchers v on v.id = ln.voucher_id
          where v.company_id = p_company and v.status = 'posted' and v.voucher_date <= v_to and (p_bu is null or v.business_unit_id = p_bu)),
  calc as (
    select led.*,
           (case when led.pl then (case when v_fy = v_first_fy then coalesce(ob.amt, 0) else 0 end) else coalesce(ob.amt, 0) end)
             + coalesce((select sum(en.dr - en.cr) from en where en.ledger_id = led.id and en.d < v_from and (not led.pl or en.d >= v_fy)), 0) as opening,
           coalesce((select sum(en.dr) from en where en.ledger_id = led.id and en.d >= v_from), 0) as dr,
           coalesce((select sum(en.cr) from en where en.ledger_id = led.id and en.d >= v_from), 0) as cr
      from led left join ob on ob.ledger_id = led.id)
  select coalesce(jsonb_agg(jsonb_build_object('ledger_id', id, 'code', code, 'name', name, 'group', group_name, 'nature', nature, 'opening', opening, 'dr', dr, 'cr', cr, 'closing', opening + dr - cr)
                           order by case nature when 'asset' then 1 when 'liability' then 2 when 'income' then 3 else 4 end, group_name, name)
                  filter (where opening <> 0 or dr <> 0 or cr <> 0), '[]'::jsonb) into v_rows from calc;
  -- profit or loss of earlier financial years, carried into the balance sheet
  if v_fy > v_first_fy then
    select coalesce(sum(x.net), 0) into v_carry from (
      select sum(o.dr - o.cr) as net from accounts.opening_balances o join accounts.ledgers l on l.id = o.ledger_id join accounts.account_groups g on g.id = l.group_id
       where o.company_id = p_company and g.nature in ('income', 'expense') and l.ledger_type = 'general' and (p_bu is null or o.business_unit_id = p_bu)
      union all
      select sum(ln.dr - ln.cr) from accounts.voucher_lines ln join accounts.vouchers v on v.id = ln.voucher_id join accounts.ledgers l on l.id = ln.ledger_id join accounts.account_groups g on g.id = l.group_id
       where v.company_id = p_company and v.status = 'posted' and g.nature in ('income', 'expense') and v.voucher_date < v_fy and (p_bu is null or v.business_unit_id = p_bu)) x;
    if v_carry <> 0 then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('ledger_id', null, 'code', '', 'name', 'Profit & loss of earlier years (carried forward)', 'group', 'Capital & reserves', 'nature', 'liability',
                       'opening', v_carry, 'dr', 0, 'cr', 0, 'closing', v_carry));
    end if;
  end if;
  return jsonb_build_object('from', v_from, 'to', v_to, 'rows', v_rows);
end $fn$;
revoke all on function accounts.trial_balance(bigint, date, date, bigint) from public, anon;
grant execute on function accounts.trial_balance(bigint, date, date, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Security for the new table
-- ---------------------------------------------------------------------------
alter table accounts.expense_head_ledgers enable row level security;
drop policy if exists expense_head_ledgers_read on accounts.expense_head_ledgers;
create policy expense_head_ledgers_read on accounts.expense_head_ledgers for select to authenticated using ((select accounts.can_read()));
drop policy if exists expense_head_ledgers_post_write on accounts.expense_head_ledgers;
create policy expense_head_ledgers_post_write on accounts.expense_head_ledgers for all to authenticated using ((select accounts.can_post())) with check ((select accounts.can_post()));
grant select, insert, update, delete on accounts.expense_head_ledgers to authenticated;
notify pgrst, 'reload schema';
