-- Accounts <-> Engineering link. See docs/accounts-spec.md section 4.4.
--
--  1. RA-bill amounts are worked out exactly the way Engineering works them out (eng.v_ra_bills): each work-order
--     item is rounded after summing its quantities, then GST / retention / TDS on the gross. (Accounts used to
--     round the grand total once, which could differ by paise.)
--  2. An RA bill that Accounts has posted cannot be cancelled in Engineering until Accounts reverses the posting -
--     otherwise the work would be released for re-billing while its payable (and maybe payments) still stand.
--  3. Engineering can see, per RA bill, whether it is posted and how much is paid / outstanding / held as retention.
--  4. Engineering activity groups can be mapped to cost ledgers: the contractor cost is then split by activity group
--     and tagged to those cost ledgers, so cost to date by group can be read in Accounts next to Engineering's budget.

-- ---------------------------------------------------------------------------
-- 1. Amounts the Engineering way
-- ---------------------------------------------------------------------------
create or replace function accounts._ra_amounts(p_id bigint) returns jsonb
 language sql stable security definer set search_path = accounts, public as $fn$
  select jsonb_build_object(
    'gross', g.gross, 'gst', round(g.gross * r.gst_pct / 100, 2), 'retention', round(g.gross * r.retention_pct / 100, 2),
    'tds', round(g.gross * r.tds_pct / 100, 2), 'other', r.other_deduction,
    'net', g.gross + round(g.gross * r.gst_pct / 100, 2) - round(g.gross * r.retention_pct / 100, 2) - round(g.gross * r.tds_pct / 100, 2) - r.other_deduction)
    from eng.ra_bills r
    cross join lateral (
      select coalesce(sum(x.amt), 0) as gross
        from (select round(sum(wd.qty) * wi.rate, 2) as amt
                from eng.work_done wd join eng.wo_items wi on wi.id = wd.wo_item_id
               where wd.ra_bill_id = r.id group by wi.id, wi.rate) x) g
   where r.id = p_id
$fn$;
revoke all on function accounts._ra_amounts(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Activity group -> cost ledger
-- ---------------------------------------------------------------------------
create table if not exists accounts.activity_group_ledgers(
  company_id         bigint not null references accounts.companies(id),
  activity_group_id  bigint not null references eng.activity_groups(id),
  ledger_id          bigint not null references accounts.ledgers(id),
  primary key (company_id, activity_group_id)
);
comment on table accounts.activity_group_ledgers is 'Engineering activity group -> cost / custom ledger (without sub-ledgers) that the contractor cost of that group is tagged to when an RA bill is posted.';

create or replace function accounts._agl_check() returns trigger
 language plpgsql set search_path = accounts, public as $fn$
declare l accounts.ledgers;
begin
  select * into l from accounts.ledgers where id = new.ledger_id;
  if l.company_id <> new.company_id then raise exception 'That ledger belongs to another company'; end if;
  if l.ledger_type = 'general' or l.sub_ledger_type is not null then raise exception 'Choose a cost or custom ledger that has no sub-ledgers'; end if;
  return new;
end $fn$;
drop trigger if exists agl_check on accounts.activity_group_ledgers;
create trigger agl_check before insert or update on accounts.activity_group_ledgers for each row execute function accounts._agl_check();

alter table accounts.activity_group_ledgers enable row level security;
drop policy if exists agl_read on accounts.activity_group_ledgers;
create policy agl_read on accounts.activity_group_ledgers for select to authenticated using ((select accounts.can_read()));
drop policy if exists agl_write on accounts.activity_group_ledgers;
create policy agl_write on accounts.activity_group_ledgers for all to authenticated using ((select accounts.can_post())) with check ((select accounts.can_post()));
grant select, insert, update, delete on accounts.activity_group_ledgers to authenticated;

-- The activity groups, for people who work in Accounts but do not hold the Engineering module.
create or replace function accounts.eng_activity_groups() returns jsonb
 language plpgsql stable security definer set search_path = accounts, public as $fn$
begin
  if not accounts.can_read() then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'active', active) order by sort_order, name) from eng.activity_groups), '[]'::jsonb);
end $fn$;
revoke all on function accounts.eng_activity_groups() from public, anon;
grant execute on function accounts.eng_activity_groups() to authenticated;

-- ---------------------------------------------------------------------------
-- RA bill posting (replaces the earlier version): per-activity-group cost lines, contractor reference, sub-contractors
-- ---------------------------------------------------------------------------
create or replace function accounts.post_ra_bill(p_id bigint) returns bigint
 language plpgsql security definer set search_path = accounts, public as $fn$
declare
  me text; r eng.ra_bills; w eng.work_orders; v_bu bigint; v_co bigint; ven purchase.vendors; co accounts.companies; v_name text; am jsonb;
  v_gross numeric; v_gst numeric; v_ret numeric; v_tds numeric; v_oth numeric; v_net numeric; v_inter boolean;
  v_vc bigint; v_sub bigint; lines jsonb; v_id bigint; v_rp bigint; v_rsub bigint; v_tl bigint; v_tsub bigint;
  v_cc bigint; g record; v_cost bigint; v_unmapped numeric := 0; v_sum numeric := 0; v_subs text; v_ref text;
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
  v_subs := (select string_agg(coalesce(nullif(sv.trade_name, ''), sv.legal_name), ', ' order by coalesce(nullif(sv.trade_name, ''), sv.legal_name))
               from eng.wo_subcontractors x join purchase.vendors sv on sv.id = x.vendor_id where x.wo_id = r.wo_id);
  v_ref := r.bill_no || coalesce(' / ' || nullif(btrim(r.contractor_ref), ''), '');
  am := accounts._ra_amounts(p_id);
  v_gross := (am->>'gross')::numeric; v_gst := (am->>'gst')::numeric; v_ret := (am->>'retention')::numeric; v_tds := (am->>'tds')::numeric; v_oth := (am->>'other')::numeric; v_net := (am->>'net')::numeric;
  if v_gross <= 0 then raise exception 'This RA bill has no work value'; end if;
  if v_net < 0 then raise exception 'The deductions are more than the bill'; end if;
  v_inter := coalesce(co.state_code is not null and ven.gstin ~ '^[0-9]{2}' and left(ven.gstin, 2) <> co.state_code, false);
  v_vc := accounts._key_ledger(v_co, 'vendor_control');
  v_sub := accounts._sub_ledger(v_vc, 'vendor', w.vendor_id, v_name);
  v_cc := accounts._key_ledger(v_co, 'contractor_cost');
  -- the work, by activity group (cost ledger when the group is mapped to one)
  lines := '[]'::jsonb;
  for g in
    select a.group_id, ag.name as group_name, sum(x.amt) as amt
      from (select wi.boq_item_id, round(sum(wd.qty) * wi.rate, 2) as amt
              from eng.work_done wd join eng.wo_items wi on wi.id = wd.wo_item_id where wd.ra_bill_id = p_id group by wi.id, wi.boq_item_id, wi.rate) x
      join eng.boq_items bq on bq.id = x.boq_item_id join eng.activities a on a.id = bq.activity_id join eng.activity_groups ag on ag.id = a.group_id
     group by a.group_id, ag.name order by ag.name
  loop
    v_sum := v_sum + g.amt;
    select m.ledger_id into v_cost from accounts.activity_group_ledgers m join accounts.ledgers l on l.id = m.ledger_id and l.active and l.ledger_type <> 'general' and l.sub_ledger_type is null
     where m.company_id = v_co and m.activity_group_id = g.group_id;
    if v_cost is not null then
      lines := lines || jsonb_build_array(jsonb_build_object('ledger_id', v_cc, 'dr', g.amt, 'cost_ledger_id', v_cost, 'narration', g.group_name || ' - ' || r.bill_no));
    else
      v_unmapped := v_unmapped + g.amt;
    end if;
  end loop;
  if abs(v_sum - v_gross) > 0.01 then raise exception 'The work of this RA bill does not add up to its gross value (% vs %)', v_sum, v_gross; end if;
  if v_unmapped > 0 then lines := lines || jsonb_build_array(jsonb_build_object('ledger_id', v_cc, 'dr', v_unmapped, 'narration', 'Work done - ' || r.bill_no)); end if;
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
  v_id := accounts._insert_voucher(v_co, v_bu, 'ra_bill', r.bill_date,
            'RA bill ' || v_ref || ' - ' || w.title || ' (' || w.wo_no || ') - ' || v_name || coalesce(' - sub-contractors: ' || v_subs, ''),
            null, null, null, ven.legal_name, 'ra_bill', p_id, lines);
  if v_net > 0 then
    insert into accounts.payables(company_id, business_unit_id, vendor_id, sub_ledger_id, kind, ref_no, ref_date, amount, voucher_id, source_type, source_id)
    values (v_co, v_bu, w.vendor_id, v_sub, 'bill', v_ref, r.bill_date, v_net, v_id, 'ra_bill', p_id);
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
-- 2. A posted RA bill cannot be cancelled in Engineering
-- ---------------------------------------------------------------------------
create or replace function accounts.t_guard_ra_cancel() returns trigger
 language plpgsql security definer set search_path = accounts, public as $fn$
declare v_no text;
begin
  if new.status = 'Cancelled' and old.status is distinct from 'Cancelled' then
    select doc_no into v_no from accounts.vouchers where source_type = 'ra_bill' and source_id = old.id and status = 'posted' limit 1;
    if v_no is not null then
      raise exception 'Accounts has already posted this bill as % - ask Accounts to reverse the posting first (Accounts > Ledgers & postings > Bill postings), then cancel it here', v_no;
    end if;
  end if;
  return new;
end $fn$;
revoke all on function accounts.t_guard_ra_cancel() from public, anon, authenticated;
drop trigger if exists zz_accounts_ra_guard on eng.ra_bills;
create trigger zz_accounts_ra_guard before update on eng.ra_bills for each row execute function accounts.t_guard_ra_cancel();

-- ---------------------------------------------------------------------------
-- 3. What Engineering may see of an RA bill's life in Accounts
-- ---------------------------------------------------------------------------
create or replace function accounts.ra_bill_accounts(p_ids bigint[]) returns jsonb
 language plpgsql stable security definer set search_path = accounts, public as $fn$
begin
  if app.is_customer() or not (app.has_module('engineering') or accounts.can_read()) then raise exception 'not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'ra_bill_id', v.source_id, 'voucher_id', v.id, 'voucher_no', v.doc_no, 'posted_on', v.voucher_date, 'company', c.name,
             'net', b.amount, 'paid', b.settled, 'outstanding', b.outstanding,
             'retention', t.amount, 'retention_released', t.settled, 'retention_outstanding', t.outstanding))
      from accounts.vouchers v
      join accounts.companies c on c.id = v.company_id
      left join accounts.v_payables b on b.voucher_id = v.id and b.kind = 'bill' and b.status = 'open'
      left join accounts.v_payables t on t.voucher_id = v.id and t.kind = 'retention' and t.status = 'open'
     where v.source_type = 'ra_bill' and v.status = 'posted' and v.source_id = any (coalesce(p_ids, '{}'))), '[]'::jsonb);
end $fn$;
revoke all on function accounts.ra_bill_accounts(bigint[]) from public, anon;
grant execute on function accounts.ra_bill_accounts(bigint[]) to authenticated;
notify pgrst, 'reload schema';
