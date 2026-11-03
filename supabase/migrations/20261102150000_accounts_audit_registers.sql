/* ACCOUNTS AUDIT - FOUR REGISTERS: DELETED, MODIFICATION, TRANSFER, DOCUMENT REVERSAL.

   WHAT WAS THERE.
   A posted voucher can never be edited or deleted (the guards in 20261005100000 refuse both), so for a
   voucher the only things that can happen to it are: it is cancelled, or a bank clearance / cheque number is
   attached to it. Cancellations are on the voucher itself (cancelled_by / _at / cancel_reason). But the rest of
   the module - ledgers, sub-ledgers, groups, opening balances, business units, companies, access, cheque books -
   is edited and deleted freely, and nothing was kept of who did it or what it used to say. accounts.doc_log
   only ever recorded documents' own events.

   WHAT CHANGES.
   1. accounts.audit_log - an append-only record of every EDIT and every DELETE made to those records: who, when,
      which record, and the values (a delete keeps the whole row; an edit keeps only the columns that changed,
      before and after). It is written by triggers, so it does not depend on which screen or function made the
      change, and nobody can write to it, change it or delete from it (a trigger refuses, and no role is granted
      anything but select). It carries no foreign key to the company, so a deleted company's trail survives it.
      Nothing before this migration was recorded, so those two registers start empty - that cannot be recovered.
      Not logged: a record edited in the same transaction that created it (setting something up), edits that
      change only updated_at / updated_by (or, on a cheque book, only the next cheque number, which moves by
      itself every time a cheque is issued), and plain inserts.
   2. Two narrow triggers for the two things that DO change on a posted voucher: its cheque / instrument / payee /
      narration / mode fields, and the bank-clearance date on a line.
   3. Three read views (security_invoker, so the module's own row-level security applies):
        v_audit_log        - the log, with the company's name and whether the company still exists
        v_audit_reversals  - every cancelled voucher (including postings reversed from Ledgers & postings and
                             bills cancelled from Bills & on-account) and every cancelled opening bill
        v_audit_transfers  - contra, deposit and withdrawal vouchers: money moved between our own cash / bank
                             accounts, with the account it left, the account it reached, and its status
   4. The Audit tab is registered in the feature catalogue for usage tracking, like the other two tabs. */

-- ---------------------------------------------------------------------------
-- The log
-- ---------------------------------------------------------------------------
create table if not exists accounts.audit_log(
  id            bigserial primary key,
  at            timestamptz not null default now(),
  by            text,
  action        text not null check (action in ('Modified','Deleted')),
  table_name    text not null,
  row_id        text,
  company_id    bigint,                 -- deliberately no foreign key: the trail outlives the company
  company_name  text,
  record_type   text not null,
  record_label  text not null,
  old_data      jsonb,                  -- Deleted: the whole row. Modified: only the columns that changed, as they were
  new_data      jsonb                   -- Modified: those columns as they are now
);
create index if not exists audit_log_company_at_idx on accounts.audit_log (company_id, at desc);
create index if not exists audit_log_action_at_idx  on accounts.audit_log (action, at desc);

alter table accounts.audit_log enable row level security;
drop policy if exists audit_log_read on accounts.audit_log;
create policy audit_log_read on accounts.audit_log for select to authenticated using ((select accounts.can_read()));
revoke all on accounts.audit_log from public, anon, authenticated;
grant select on accounts.audit_log to authenticated;

create or replace function accounts._audit_immutable() returns trigger
 language plpgsql set search_path = accounts, public as $fn$
begin
  raise exception 'The audit log cannot be changed or deleted';
end $fn$;
drop trigger if exists audit_log_immutable on accounts.audit_log;
create trigger audit_log_immutable before update or delete on accounts.audit_log
  for each row execute function accounts._audit_immutable();

-- ---------------------------------------------------------------------------
-- Naming a row: what kind of record it is, what to call it, which company it belongs to
-- ---------------------------------------------------------------------------
create or replace function accounts._audit_describe(p_table text, j jsonb, out rtype text, out label text, out co bigint, out rid text)
 language plpgsql stable security definer set search_path = accounts, public as $fn$
declare v_led text; v_sub text; v_name text;
begin
  rid := coalesce(j->>'id', j->>'email', concat_ws('/', j->>'company_id', j->>'key', j->>'activity_group_id', j->>'expense_head_id', j->>'ledger_id'));
  case p_table
    when 'enterprises' then
      rtype := 'Enterprise'; label := j->>'name'; co := null;
    when 'companies' then
      rtype := 'Company'; label := (j->>'name') || ' (' || coalesce(j->>'short_code', '') || ')'; co := (j->>'id')::bigint;
    when 'business_units' then
      rtype := 'Business unit'; label := (j->>'name') || ' (' || coalesce(j->>'code', '') || ')'; co := (j->>'company_id')::bigint;
    when 'account_groups' then
      rtype := 'Account group'; label := j->>'name'; co := (j->>'company_id')::bigint;
    when 'ledgers' then
      rtype := 'Ledger'; label := (j->>'name') || ' (' || coalesce(j->>'code', '') || ')'; co := (j->>'company_id')::bigint;
    when 'sub_ledgers' then
      rtype := 'Sub-ledger';
      select l.name, l.company_id into v_led, co from accounts.ledgers l where l.id = (j->>'ledger_id')::bigint;
      label := (j->>'name') || case when v_led is not null then ' (under ' || v_led || ')' else '' end;
    when 'opening_balances' then
      rtype := 'Opening balance'; co := (j->>'company_id')::bigint;
      select l.name into v_led from accounts.ledgers l where l.id = (j->>'ledger_id')::bigint;
      select s.name into v_sub from accounts.sub_ledgers s where s.id = (j->>'sub_ledger_id')::bigint;
      label := coalesce(v_led, 'ledger #' || (j->>'ledger_id')) || coalesce(' › ' || v_sub, '');
    when 'activity_group_ledgers' then
      rtype := 'Activity group ledger'; co := (j->>'company_id')::bigint;
      select g.name into v_name from eng.activity_groups g where g.id = (j->>'activity_group_id')::bigint;
      select l.name into v_led from accounts.ledgers l where l.id = (j->>'ledger_id')::bigint;
      label := coalesce(v_name, 'group #' || (j->>'activity_group_id')) || ' → ' || coalesce(v_led, 'ledger #' || (j->>'ledger_id'));
    when 'expense_head_ledgers' then
      rtype := 'Expense head ledger'; co := (j->>'company_id')::bigint;
      select h.name into v_name from purchase.expense_heads h where h.id = (j->>'expense_head_id')::bigint;
      select l.name into v_led from accounts.ledgers l where l.id = (j->>'ledger_id')::bigint;
      label := coalesce(v_name, 'head #' || (j->>'expense_head_id')) || ' → ' || coalesce(v_led, 'ledger #' || (j->>'ledger_id'));
    when 'settings' then
      rtype := 'Setting'; label := j->>'key'; co := (j->>'company_id')::bigint;
    when 'access' then
      rtype := 'Access'; label := (j->>'email') || ' (' || coalesce(j->>'role', '') || ')'; co := null;
    when 'cheque_books' then
      rtype := 'Cheque book';
      select l.name, l.company_id into v_led, co from accounts.ledgers l where l.id = (j->>'ledger_id')::bigint;
      label := coalesce(nullif(j->>'label', ''), '#' || (j->>'id')) || coalesce(' of ' || v_led, '');
    when 'cheque_formats' then
      rtype := 'Cheque layout';
      select l.name, l.company_id into v_led, co from accounts.ledgers l where l.id = (j->>'ledger_id')::bigint;
      label := coalesce(v_led, 'ledger #' || (j->>'ledger_id'));
    when 'bank_statements' then
      rtype := 'Bank statement balance';
      select l.name, l.company_id into v_led, co from accounts.ledgers l where l.id = (j->>'ledger_id')::bigint;
      label := coalesce(v_led, 'ledger #' || (j->>'ledger_id')) || ' as on ' || coalesce(j->>'as_on', '');
    else
      rtype := p_table; label := coalesce(j->>'id', ''); co := nullif(j->>'company_id', '')::bigint;
  end case;
end $fn$;
revoke all on function accounts._audit_describe(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The triggers
-- ---------------------------------------------------------------------------
create or replace function accounts._audit_row() returns trigger
 language plpgsql security definer set search_path = accounts, public as $fn$
declare
  o jsonb := to_jsonb(old); n jsonb; k text;
  oc jsonb := '{}'::jsonb; nc jsonb := '{}'::jsonb;
  d record; v_con text;
begin
  if tg_op = 'UPDATE' then
    n := to_jsonb(new);
    -- set up in the very transaction that created it: that is making it, not changing it
    if o ? 'created_at' and (o->>'created_at')::timestamptz = now() then return null; end if;
    for k in select jsonb_object_keys(n) loop
      if k in ('updated_at', 'updated_by') then continue; end if;
      if tg_table_name = 'cheque_books' and k = 'next_no' then continue; end if;      -- ticks up with every cheque issued: not a person's edit
      if o->k is distinct from n->k then
        oc := oc || jsonb_build_object(k, o->k);
        nc := nc || jsonb_build_object(k, n->k);
      end if;
    end loop;
    if oc = '{}'::jsonb then return null; end if;
  end if;
  select * into d from accounts._audit_describe(tg_table_name, o);
  v_con := case when tg_table_name = 'companies' then o->>'name' else (select c.name from accounts.companies c where c.id = d.co) end;
  insert into accounts.audit_log(by, action, table_name, row_id, company_id, company_name, record_type, record_label, old_data, new_data)
  values (lower(coalesce(app.current_user_email(), 'system')), case tg_op when 'DELETE' then 'Deleted' else 'Modified' end,
          tg_table_name, d.rid, d.co, v_con, d.rtype, d.label,
          case tg_op when 'DELETE' then o else oc end, case tg_op when 'UPDATE' then nc end);
  return null;
end $fn$;
revoke all on function accounts._audit_row() from public, anon, authenticated;

do $t$
declare t text;
begin
  foreach t in array array['enterprises','companies','business_units','account_groups','ledgers','sub_ledgers','opening_balances',
                           'activity_group_ledgers','expense_head_ledgers','settings','access','cheque_books','cheque_formats','bank_statements'] loop
    execute format('drop trigger if exists audit_row on accounts.%I', t);
    execute format('create trigger audit_row after update or delete on accounts.%I for each row execute function accounts._audit_row()', t);
  end loop;
end $t$;

-- A posted voucher is fixed except for these fields (and its cancellation, which is the reversal register's business).
create or replace function accounts._audit_voucher() returns trigger
 language plpgsql security definer set search_path = accounts, public as $fn$
declare o jsonb := to_jsonb(old); n jsonb := to_jsonb(new); k text; oc jsonb := '{}'::jsonb; nc jsonb := '{}'::jsonb;
begin
  if old.created_at = now() then return null; end if;      -- the cheque number taken while the voucher is being posted
  foreach k in array array['narration','mode','instrument_no','instrument_date','payee'] loop
    if o->k is distinct from n->k then oc := oc || jsonb_build_object(k, o->k); nc := nc || jsonb_build_object(k, n->k); end if;
  end loop;
  if oc = '{}'::jsonb then return null; end if;
  insert into accounts.audit_log(by, action, table_name, row_id, company_id, company_name, record_type, record_label, old_data, new_data)
  values (lower(coalesce(app.current_user_email(), 'system')), 'Modified', 'vouchers', new.id::text, new.company_id,
          (select c.name from accounts.companies c where c.id = new.company_id), 'Voucher', new.doc_no, oc, nc);
  return null;
end $fn$;
revoke all on function accounts._audit_voucher() from public, anon, authenticated;
drop trigger if exists audit_voucher on accounts.vouchers;
create trigger audit_voucher after update on accounts.vouchers for each row execute function accounts._audit_voucher();

-- Bank reconciliation: marking a line cleared, or un-marking it
create or replace function accounts._audit_clearance() returns trigger
 language plpgsql security definer set search_path = accounts, public as $fn$
declare v accounts.vouchers; v_led text;
begin
  if old.cleared_on is not distinct from new.cleared_on then return null; end if;
  select * into v from accounts.vouchers where id = new.voucher_id;
  select l.name into v_led from accounts.ledgers l where l.id = new.ledger_id;
  insert into accounts.audit_log(by, action, table_name, row_id, company_id, company_name, record_type, record_label, old_data, new_data)
  values (lower(coalesce(app.current_user_email(), 'system')), 'Modified', 'voucher_lines', new.id::text, v.company_id,
          (select c.name from accounts.companies c where c.id = v.company_id), 'Bank clearance',
          v.doc_no || ' · line ' || new.line_no || coalesce(' (' || v_led || ')', ''),
          jsonb_build_object('cleared_on', old.cleared_on), jsonb_build_object('cleared_on', new.cleared_on));
  return null;
end $fn$;
revoke all on function accounts._audit_clearance() from public, anon, authenticated;
drop trigger if exists audit_clearance on accounts.voucher_lines;
create trigger audit_clearance after update on accounts.voucher_lines for each row execute function accounts._audit_clearance();

-- ---------------------------------------------------------------------------
-- Read views
-- ---------------------------------------------------------------------------
create or replace view accounts.v_audit_log with (security_invoker = true) as
  select a.id, a.at, a.by, a.action, a.table_name, a.row_id, a.company_id,
         coalesce(c.name, a.company_name) as company_name,
         (a.company_id is not null and c.id is null) as company_gone,
         a.record_type, a.record_label, a.old_data, a.new_data
    from accounts.audit_log a
    left join accounts.companies c on c.id = a.company_id;

create or replace view accounts.v_audit_reversals with (security_invoker = true) as
  select 'voucher'::text as kind, v.id, v.company_id, v.business_unit_id, v.doc_no, v.voucher_type as doc_type, v.voucher_date as doc_date,
         v.amount, coalesce(v.payee, v.narration) as particulars, v.source_type,
         v.created_by as entered_by, v.created_at as entered_at,
         v.cancelled_by as reversed_by, v.cancelled_at as reversed_at, v.cancel_reason as reason
    from accounts.vouchers v
   where v.status = 'cancelled'
  union all
  select 'opening_bill'::text, p.id, p.company_id, p.business_unit_id, 'Opening bill ' || coalesce(p.ref_no, ''), 'opening_bill'::text, p.ref_date,
         p.amount, (select s.name from accounts.sub_ledgers s where s.id = p.sub_ledger_id), 'opening'::text,
         e.by, e.at, r.by, r.at, r.remark
    from accounts.payables p
    left join lateral (select l.by, l.at from accounts.doc_log l
                        where l.doc_type = 'payable' and l.doc_id = p.id and l.action = 'Opening bill entered' order by l.at limit 1) e on true
    left join lateral (select l.by, l.at, l.remark from accounts.doc_log l
                        where l.doc_type = 'payable' and l.doc_id = p.id and l.action = 'Bill cancelled' order by l.at desc limit 1) r on true
   where p.source_type = 'opening' and p.status = 'cancelled';

create or replace view accounts.v_audit_transfers with (security_invoker = true) as
  select v.id, v.company_id, v.business_unit_id, v.doc_no, v.voucher_type, v.voucher_date, v.amount, v.status, v.mode,
         v.instrument_no, v.instrument_date, v.narration,
         (select string_agg(distinct l.name, ', ') from accounts.voucher_lines vl join accounts.ledgers l on l.id = vl.ledger_id
           where vl.voucher_id = v.id and vl.cr > 0) as from_account,
         (select string_agg(distinct l.name, ', ') from accounts.voucher_lines vl join accounts.ledgers l on l.id = vl.ledger_id
           where vl.voucher_id = v.id and vl.dr > 0) as to_account,
         v.created_by, v.created_at, v.cancelled_by, v.cancelled_at, v.cancel_reason
    from accounts.vouchers v
   where v.voucher_type in ('contra', 'deposit', 'withdrawal');

grant select on accounts.v_audit_log, accounts.v_audit_reversals, accounts.v_audit_transfers to authenticated;

-- ---------------------------------------------------------------------------
-- The third tab, registered like the first two
-- ---------------------------------------------------------------------------
insert into public.erp_feature_catalog(module_id, module_label, tab, feature, feature_key, sort, active) values
('accounts','Accounts','Audit','View the audit registers','accounts.audit.view_audit_registers',522,true)
on conflict (feature_key) do nothing;
