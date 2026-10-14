-- Accounts module, part 1: structure, chart of accounts, vouchers. See docs/accounts-spec.md.
--
-- Enterprise -> Company -> Business unit (a business unit is a project, cust.projects).
-- Books are kept per company. A voucher is a balanced set of lines on general ledgers; each line may also
-- carry a sub-ledger (vendor, customer, ...) and an analytical cost / custom ledger with its own sub-ledger.
-- Posted vouchers are never edited - they are cancelled (with a reason) and re-entered.
--
-- New schema, new tables only. Every write to a voucher goes through the functions below; the tables give
-- staff SELECT only (masters can be edited directly by people with the right role).

create schema if not exists accounts;

-- ---------------------------------------------------------------------------
-- Who may do what. Reading follows the module grant given in the Control Panel (adm.users.modules holds
-- 'accounts'); writing needs a row here.  admin = structure, chart, access;  accountant = vouchers, banking.
-- ---------------------------------------------------------------------------
create table if not exists accounts.access(
  email       text primary key check (email = lower(email)),
  role        text not null check (role in ('admin','accountant')),
  created_at  timestamptz not null default now(),
  created_by  text default app.current_user_email()
);
insert into accounts.access(email, role, created_by) values
  ('ayushruia1@gmail.com', 'admin', 'migration'),
  ('businessanalyst@thejaingroup.com', 'admin', 'migration'),
  ('system3.thejaingroup@gmail.com', 'admin', 'migration')
on conflict (email) do nothing;

create or replace function accounts.is_admin() returns boolean
 language sql stable security definer set search_path = accounts, public as $fn$
  select not app.is_customer() and (app.is_superadmin()
     or exists (select 1 from accounts.access a where a.email = lower(coalesce(app.current_user_email(), '')) and a.role = 'admin'))
$fn$;
create or replace function accounts.can_post() returns boolean
 language sql stable security definer set search_path = accounts, public as $fn$
  select not app.is_customer() and (app.is_superadmin()
     or exists (select 1 from accounts.access a where a.email = lower(coalesce(app.current_user_email(), ''))))
$fn$;
create or replace function accounts.can_read() returns boolean
 language sql stable security definer set search_path = accounts, public as $fn$
  select not app.is_customer() and (app.has_module('accounts')
     or exists (select 1 from accounts.access a where a.email = lower(coalesce(app.current_user_email(), ''))))
$fn$;
revoke all on function accounts.is_admin(), accounts.can_post(), accounts.can_read() from public, anon;
grant execute on function accounts.is_admin(), accounts.can_post(), accounts.can_read() to authenticated;

-- Raises unless the caller may post; returns the caller's email.
create or replace function accounts._guard_post() returns text
 language plpgsql stable security definer set search_path = accounts, public as $fn$
begin
  if coalesce(app.current_user_email(), '') = '' then raise exception 'not signed in'; end if;
  if not accounts.can_post() then raise exception 'You do not have permission to post in Accounts - ask an Accounts administrator'; end if;
  return lower(app.current_user_email());
end $fn$;
revoke all on function accounts._guard_post() from public, anon;

-- ---------------------------------------------------------------------------
-- Structure: Enterprise -> Company -> Business unit
-- ---------------------------------------------------------------------------
create table if not exists accounts.enterprises(
  id          bigserial primary key,
  name        text not null check (btrim(name) <> ''),
  created_at  timestamptz not null default now(),
  created_by  text default app.current_user_email()
);
create unique index if not exists enterprises_name_uq on accounts.enterprises (lower(name));

create table if not exists accounts.companies(
  id               bigserial primary key,
  enterprise_id    bigint not null references accounts.enterprises(id),
  name             text not null check (btrim(name) <> ''),
  short_code       text not null check (short_code ~ '^[A-Z0-9]{2,6}$'),
  gstin            text,
  pan              text,
  state_code       text check (state_code is null or state_code ~ '^[0-9]{2}$'),
  fy_start_month   int not null default 4 check (fy_start_month between 1 and 12),
  books_start      date not null default date '2026-04-01',
  books_locked_till date,
  legal_entity_id  bigint references purchase.legal_entities(id),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       text default app.current_user_email()
);
create unique index if not exists companies_name_uq on accounts.companies (lower(name));
create unique index if not exists companies_code_uq on accounts.companies (short_code);
comment on column accounts.companies.books_start is 'Opening balances are as at this date; no voucher can be dated before it.';
comment on column accounts.companies.books_locked_till is 'No voucher can be posted or cancelled on or before this date.';
comment on column accounts.companies.state_code is 'GST state code (first two digits of GSTIN); decides CGST+SGST vs IGST on bills.';

create table if not exists accounts.business_units(
  id          bigserial primary key,
  company_id  bigint not null references accounts.companies(id),
  code        text not null check (code ~ '^[A-Z0-9]{1,8}$'),
  name        text not null check (btrim(name) <> ''),
  project_id  bigint references cust.projects(id),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  text default app.current_user_email()
);
create unique index if not exists business_units_code_uq on accounts.business_units (company_id, code);
create unique index if not exists business_units_name_uq on accounts.business_units (company_id, lower(name));
create unique index if not exists business_units_project_uq on accounts.business_units (project_id) where project_id is not null;
comment on table accounts.business_units is 'A business unit is a project. Bills, work-order bills and Post Sales documents find their company through the project mapped here.';

create table if not exists accounts.settings(
  company_id  bigint not null references accounts.companies(id),
  key         text not null,
  value       text,
  primary key (company_id, key)
);
comment on table accounts.settings is 'customer_gst.supply = intra|inter: how the GST on Post Sales invoices is split (CGST+SGST or IGST).';

-- ---------------------------------------------------------------------------
-- Chart of accounts
-- ---------------------------------------------------------------------------
create table if not exists accounts.account_groups(
  id          bigserial primary key,
  company_id  bigint not null references accounts.companies(id),
  parent_id   bigint references accounts.account_groups(id),
  name        text not null check (btrim(name) <> ''),
  nature      text not null check (nature in ('asset','liability','income','expense')),
  sort_order  int not null default 0,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  text default app.current_user_email(),
  check (parent_id is distinct from id)
);
create unique index if not exists account_groups_name_uq on accounts.account_groups (company_id, coalesce(parent_id, 0), lower(name));

create or replace function accounts._group_before_write() returns trigger
 language plpgsql set search_path = accounts, public as $fn$
declare p accounts.account_groups;
begin
  if new.parent_id is not null then
    select * into p from accounts.account_groups where id = new.parent_id;
    if p.company_id <> new.company_id then raise exception 'The parent group belongs to another company'; end if;
    new.nature := p.nature;
  end if;
  return new;
end $fn$;
drop trigger if exists group_before_write on accounts.account_groups;
create trigger group_before_write before insert or update on accounts.account_groups
  for each row execute function accounts._group_before_write();

create sequence if not exists accounts.ledger_code_seq;
create table if not exists accounts.ledgers(
  id                  bigserial primary key,
  company_id          bigint not null references accounts.companies(id),
  group_id            bigint references accounts.account_groups(id),
  code                text not null,
  name                text not null check (btrim(name) <> ''),
  ledger_type         text not null default 'general' check (ledger_type in ('general','cost','custom')),
  sub_ledger_type     text check (sub_ledger_type in ('vendor','customer','employee','other')),
  is_bank             boolean not null default false,
  is_cash             boolean not null default false,
  bank_name           text,
  account_no          text,
  ifsc                text,
  system_key          text,
  ps_bank_account_id  bigint,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  created_by          text default app.current_user_email(),
  updated_at          timestamptz not null default now(),
  updated_by          text default app.current_user_email(),
  check (not (is_bank and is_cash)),
  check (ledger_type <> 'general' or group_id is not null),
  check (ledger_type = 'general' or (not is_bank and not is_cash and system_key is null and ps_bank_account_id is null))
);
create unique index if not exists ledgers_code_uq on accounts.ledgers (company_id, upper(code));
create unique index if not exists ledgers_name_uq on accounts.ledgers (company_id, lower(name));
create unique index if not exists ledgers_key_uq on accounts.ledgers (company_id, system_key) where system_key is not null;
create unique index if not exists ledgers_psbank_uq on accounts.ledgers (ps_bank_account_id) where ps_bank_account_id is not null;
create index if not exists ledgers_group_idx on accounts.ledgers (group_id);
comment on column accounts.ledgers.ledger_type is 'general = balances in the trial balance; cost / custom = analytical ledgers carried on voucher lines (cost centres, custom heads).';
comment on column accounts.ledgers.sub_ledger_type is 'When set, every voucher line on this ledger must name a sub-ledger (a vendor, a customer booking, ...).';
comment on column accounts.ledgers.system_key is 'Role this ledger plays in automatic postings (input_cgst, tds_payable, vendor_control, ...).';
comment on column accounts.ledgers.ps_bank_account_id is 'Post Sales bank account (postsales.bank_accounts) whose receipts land in this ledger.';

create or replace function accounts._ledger_before_write() returns trigger
 language plpgsql set search_path = accounts, public as $fn$
declare g accounts.account_groups;
begin
  if new.code is null or btrim(new.code) = '' then new.code := 'LG-' || lpad(nextval('accounts.ledger_code_seq')::text, 5, '0');
  else new.code := upper(btrim(new.code)); end if;
  if new.group_id is not null then
    select * into g from accounts.account_groups where id = new.group_id;
    if g.company_id <> new.company_id then raise exception 'The group belongs to another company'; end if;
  end if;
  if tg_op = 'UPDATE' and (new.is_bank is distinct from old.is_bank or new.is_cash is distinct from old.is_cash
       or new.ledger_type is distinct from old.ledger_type or new.sub_ledger_type is distinct from old.sub_ledger_type or new.company_id <> old.company_id) then
    if exists (select 1 from accounts.voucher_lines l where l.ledger_id = old.id or l.cost_ledger_id = old.id)
       or exists (select 1 from accounts.opening_balances o where o.ledger_id = old.id) then
      raise exception 'This ledger already has entries - its type, bank / cash flag and sub-ledger type can no longer be changed';
    end if;
  end if;
  new.updated_at := now(); new.updated_by := app.current_user_email();
  return new;
end $fn$;

create table if not exists accounts.sub_ledgers(
  id          bigserial primary key,
  ledger_id   bigint not null references accounts.ledgers(id),
  code        text,
  name        text not null check (btrim(name) <> ''),
  party_type  text check (party_type in ('vendor','customer')),
  party_id    bigint,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  text default app.current_user_email()
);
create unique index if not exists sub_ledgers_name_uq on accounts.sub_ledgers (ledger_id, lower(name));
create unique index if not exists sub_ledgers_party_uq on accounts.sub_ledgers (ledger_id, party_type, party_id) where party_id is not null;
comment on column accounts.sub_ledgers.party_id is 'vendor: purchase.vendors.id; customer: postsales.bookings.id (one sub-ledger per booking).';

create table if not exists accounts.opening_balances(
  id                bigserial primary key,
  company_id        bigint not null references accounts.companies(id),
  ledger_id         bigint not null references accounts.ledgers(id),
  sub_ledger_id     bigint references accounts.sub_ledgers(id),
  business_unit_id  bigint references accounts.business_units(id),
  dr                numeric(16,2) not null default 0,
  cr                numeric(16,2) not null default 0,
  updated_at        timestamptz not null default now(),
  updated_by        text default app.current_user_email(),
  check (dr >= 0 and cr >= 0 and (dr = 0 or cr = 0))
);
create unique index if not exists opening_balances_uq on accounts.opening_balances (ledger_id, coalesce(sub_ledger_id, 0), coalesce(business_unit_id, 0));
comment on table accounts.opening_balances is 'Balance of a ledger (and sub-ledger / business unit) as at companies.books_start. Cost and custom ledgers carry theirs here too, outside the trial balance.';

create or replace function accounts._opening_before_write() returns trigger
 language plpgsql set search_path = accounts, public as $fn$
declare l accounts.ledgers; s accounts.sub_ledgers; b accounts.business_units;
begin
  select * into l from accounts.ledgers where id = new.ledger_id;
  if l.company_id <> new.company_id then raise exception 'That ledger belongs to another company'; end if;
  if new.sub_ledger_id is not null then
    select * into s from accounts.sub_ledgers where id = new.sub_ledger_id;
    if s.ledger_id <> new.ledger_id then raise exception 'That sub-ledger belongs to another ledger'; end if;
  elsif l.sub_ledger_type is not null then
    raise exception 'Enter the opening balance of % against its sub-ledgers', l.name;
  end if;
  if new.business_unit_id is not null then
    select * into b from accounts.business_units where id = new.business_unit_id;
    if b.company_id <> new.company_id then raise exception 'That business unit belongs to another company'; end if;
  end if;
  new.updated_at := now(); new.updated_by := app.current_user_email();
  return new;
end $fn$;
drop trigger if exists opening_before_write on accounts.opening_balances;
create trigger opening_before_write before insert or update on accounts.opening_balances
  for each row execute function accounts._opening_before_write();

-- ---------------------------------------------------------------------------
-- Vouchers
-- ---------------------------------------------------------------------------
create table if not exists accounts.doc_counters(
  company_id  bigint not null references accounts.companies(id),
  doc_type    text not null,
  fy          text not null,
  last_no     int not null default 0,
  primary key (company_id, doc_type, fy)
);
create table if not exists accounts.doc_log(
  id        bigserial primary key,
  doc_type  text not null,
  doc_id    bigint not null,
  at        timestamptz not null default now(),
  by        text default app.current_user_email(),
  action    text not null,
  remark    text
);
create index if not exists doc_log_doc_idx on accounts.doc_log (doc_type, doc_id);

create table if not exists accounts.vouchers(
  id                bigserial primary key,
  company_id        bigint not null references accounts.companies(id),
  business_unit_id  bigint references accounts.business_units(id),
  voucher_type      text not null check (voucher_type in ('receipt','payment','deposit','withdrawal','contra','journal',
                                                         'purchase_bill','debit_note','ra_bill','advance_receipt','customer_gst')),
  doc_no            text not null,
  voucher_date      date not null,
  narration         text,
  mode              text check (mode in ('cash','cheque','dd','neft','rtgs','imps','upi','transfer','other')),
  instrument_no     text,
  instrument_date   date,
  payee             text,
  amount            numeric(16,2) not null default 0,
  status            text not null default 'posted' check (status in ('posted','cancelled')),
  source_type       text check (source_type in ('purchase_bill','purchase_dn','ra_bill','ps_receipt','ps_invoice')),
  source_id         bigint,
  cancelled_at      timestamptz,
  cancelled_by      text,
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  created_by        text default app.current_user_email(),
  check ((source_type is null) = (source_id is null))
);
create unique index if not exists vouchers_doc_no_uq on accounts.vouchers (company_id, doc_no);
create unique index if not exists vouchers_source_uq on accounts.vouchers (source_type, source_id) where status = 'posted' and source_type is not null;
create index if not exists vouchers_company_date_idx on accounts.vouchers (company_id, voucher_date);
create index if not exists vouchers_bu_idx on accounts.vouchers (business_unit_id);

create table if not exists accounts.voucher_lines(
  id                   bigserial primary key,
  voucher_id           bigint not null references accounts.vouchers(id),
  line_no              int not null,
  ledger_id            bigint not null references accounts.ledgers(id),
  sub_ledger_id        bigint references accounts.sub_ledgers(id),
  cost_ledger_id       bigint references accounts.ledgers(id),
  cost_sub_ledger_id   bigint references accounts.sub_ledgers(id),
  dr                   numeric(16,2) not null default 0,
  cr                   numeric(16,2) not null default 0,
  narration            text,
  cleared_on           date,
  cleared_by           text,
  check (dr >= 0 and cr >= 0 and ((dr > 0) <> (cr > 0)))
);
create index if not exists voucher_lines_voucher_idx on accounts.voucher_lines (voucher_id);
create index if not exists voucher_lines_ledger_idx on accounts.voucher_lines (ledger_id);
create index if not exists voucher_lines_sub_idx on accounts.voucher_lines (sub_ledger_id) where sub_ledger_id is not null;
create index if not exists voucher_lines_cost_idx on accounts.voucher_lines (cost_ledger_id) where cost_ledger_id is not null;
comment on column accounts.voucher_lines.cleared_on is 'Bank reconciliation: the date the bank cleared this cheque / transfer. Null = not yet cleared.';

-- A voucher always balances (checked again at commit, whatever wrote the rows).
create or replace function accounts._voucher_balanced() returns trigger
 language plpgsql set search_path = accounts, public as $fn$
declare v_dr numeric; v_cr numeric;
begin
  select coalesce(sum(dr), 0), coalesce(sum(cr), 0) into v_dr, v_cr from accounts.voucher_lines where voucher_id = new.voucher_id;
  if abs(v_dr - v_cr) > 0.004 then raise exception 'Voucher % is out of balance (Dr % / Cr %)', new.voucher_id, v_dr, v_cr; end if;
  return null;
end $fn$;
drop trigger if exists voucher_lines_balanced on accounts.voucher_lines;
create constraint trigger voucher_lines_balanced after insert or update on accounts.voucher_lines
  deferrable initially deferred for each row execute function accounts._voucher_balanced();

-- Posted entries are never edited: only bank clearance on a line, and cancellation / cheque number on a voucher.
create or replace function accounts._lines_guard() returns trigger
 language plpgsql set search_path = accounts, public as $fn$
begin
  if tg_op = 'DELETE' then raise exception 'Posted entries cannot be deleted - cancel the voucher instead'; end if;
  if (new.voucher_id, new.line_no, new.ledger_id, new.sub_ledger_id, new.cost_ledger_id, new.cost_sub_ledger_id, new.dr, new.cr)
     is distinct from (old.voucher_id, old.line_no, old.ledger_id, old.sub_ledger_id, old.cost_ledger_id, old.cost_sub_ledger_id, old.dr, old.cr) then
    raise exception 'Posted entries cannot be edited - cancel the voucher and enter it again';
  end if;
  return new;
end $fn$;
drop trigger if exists voucher_lines_guard on accounts.voucher_lines;
create trigger voucher_lines_guard before update or delete on accounts.voucher_lines
  for each row execute function accounts._lines_guard();

create or replace function accounts._vouchers_guard() returns trigger
 language plpgsql set search_path = accounts, public as $fn$
begin
  if tg_op = 'DELETE' then raise exception 'Vouchers cannot be deleted - cancel the voucher instead'; end if;
  if (new.company_id, new.business_unit_id, new.voucher_type, new.doc_no, new.voucher_date, new.source_type, new.source_id, new.created_at)
     is distinct from (old.company_id, old.business_unit_id, old.voucher_type, old.doc_no, old.voucher_date, old.source_type, old.source_id, old.created_at)
     or (new.amount is distinct from old.amount and old.amount <> 0) then
    raise exception 'Posted vouchers cannot be edited - cancel the voucher and enter it again';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then raise exception 'A cancelled voucher cannot be revived'; end if;
  return new;
end $fn$;
drop trigger if exists vouchers_guard on accounts.vouchers;
create trigger vouchers_guard before update or delete on accounts.vouchers
  for each row execute function accounts._vouchers_guard();

-- ---------------------------------------------------------------------------
-- Numbering, financial year, period lock
-- ---------------------------------------------------------------------------
create or replace function accounts._fy_start(p_company bigint, p_date date) returns date
 language sql stable set search_path = accounts, public as $fn$
  select make_date(case when extract(month from p_date) < c.fy_start_month then extract(year from p_date)::int - 1 else extract(year from p_date)::int end, c.fy_start_month, 1)
    from accounts.companies c where c.id = p_company
$fn$;

create or replace function accounts._doc_prefix(p_type text) returns text
 language sql immutable as $fn$
  select case p_type when 'receipt' then 'RV' when 'payment' then 'PV' when 'deposit' then 'DP' when 'withdrawal' then 'WD'
                     when 'contra' then 'CV' when 'journal' then 'JV' when 'purchase_bill' then 'BL' when 'debit_note' then 'DN'
                     when 'ra_bill' then 'RA' when 'advance_receipt' then 'AR' when 'customer_gst' then 'GJ' else upper(left(p_type, 3)) end
$fn$;

create or replace function accounts.next_doc_no(p_company bigint, p_type text, p_date date) returns text
 language plpgsql security definer set search_path = accounts, public as $fn$
declare c accounts.companies; v_y int; v_fy text; v_n int;
begin
  select * into c from accounts.companies where id = p_company;
  v_y := extract(year from p_date)::int;
  if extract(month from p_date) < c.fy_start_month then v_y := v_y - 1; end if;
  v_fy := case when c.fy_start_month = 1 then lpad((v_y % 100)::text, 2, '0') else lpad((v_y % 100)::text, 2, '0') || '-' || lpad(((v_y + 1) % 100)::text, 2, '0') end;
  insert into accounts.doc_counters(company_id, doc_type, fy, last_no) values (p_company, accounts._doc_prefix(p_type), v_fy, 1)
  on conflict (company_id, doc_type, fy) do update set last_no = accounts.doc_counters.last_no + 1
  returning last_no into v_n;
  return c.short_code || '/' || accounts._doc_prefix(p_type) || '/' || v_fy || '/' || lpad(v_n::text, 4, '0');
end $fn$;
revoke all on function accounts.next_doc_no(bigint, text, date) from public, anon, authenticated;

create or replace function accounts._check_open(p_company bigint, p_date date) returns void
 language plpgsql stable set search_path = accounts, public as $fn$
declare c accounts.companies;
begin
  select * into c from accounts.companies where id = p_company;
  if not found then raise exception 'Company not found'; end if;
  if p_date < c.books_start then raise exception 'The books of % start on % - a voucher cannot be dated earlier', c.name, to_char(c.books_start, 'DD Mon YYYY'); end if;
  if c.books_locked_till is not null and p_date <= c.books_locked_till then raise exception 'The books of % are locked up to % - this date is closed', c.name, to_char(c.books_locked_till, 'DD Mon YYYY'); end if;
end $fn$;

-- ---------------------------------------------------------------------------
-- Sub-ledger helper: find or create the sub-ledger of a party under a control ledger
-- ---------------------------------------------------------------------------
create or replace function accounts._sub_ledger(p_ledger bigint, p_party_type text, p_party_id bigint, p_name text) returns bigint
 language plpgsql security definer set search_path = accounts, public as $fn$
declare v_id bigint;
begin
  select id into v_id from accounts.sub_ledgers where ledger_id = p_ledger and party_type = p_party_type and party_id = p_party_id;
  if v_id is null then
    insert into accounts.sub_ledgers(ledger_id, name, party_type, party_id) values (p_ledger, left(btrim(p_name), 200), p_party_type, p_party_id)
    on conflict do nothing returning id into v_id;
    if v_id is null then
      -- the name is taken by another party: make it unique with the party id
      insert into accounts.sub_ledgers(ledger_id, name, party_type, party_id) values (p_ledger, left(btrim(p_name), 190) || ' #' || p_party_id, p_party_type, p_party_id)
      on conflict do nothing returning id into v_id;
      if v_id is null then select id into v_id from accounts.sub_ledgers where ledger_id = p_ledger and party_type = p_party_type and party_id = p_party_id; end if;
    end if;
  end if;
  return v_id;
end $fn$;
revoke all on function accounts._sub_ledger(bigint, text, bigint, text) from public, anon, authenticated;

-- The ledger that plays a role (input_cgst, tds_payable, ...) in this company.
create or replace function accounts._key_ledger(p_company bigint, p_key text) returns bigint
 language plpgsql stable set search_path = accounts, public as $fn$
declare v_id bigint;
begin
  select id into v_id from accounts.ledgers where company_id = p_company and system_key = p_key and active;
  if v_id is null then
    raise exception 'No ledger is set for "%" in this company - choose one under Ledgers & postings > Posting ledgers', accounts._key_label(p_key);
  end if;
  return v_id;
end $fn$;
create or replace function accounts._key_label(p_key text) returns text
 language sql immutable as $fn$
  select case p_key
    when 'cash' then 'Cash in hand' when 'vendor_control' then 'Sundry creditors (vendors & contractors)' when 'retention_payable' then 'Retention money payable'
    when 'tds_payable' then 'TDS payable' when 'input_cgst' then 'Input CGST' when 'input_sgst' then 'Input SGST' when 'input_igst' then 'Input IGST'
    when 'output_cgst' then 'Output CGST' when 'output_sgst' then 'Output SGST' when 'output_igst' then 'Output IGST'
    when 'customer_advance' then 'Advance received from customers' when 'purchases' then 'Material purchases'
    when 'contractor_cost' then 'Contractor / works cost' when 'expense_default' then 'Other expenses (unclassified)'
    when 'purchase_return' then 'Purchase returns' when 'other_recoveries' then 'Recoveries from contractors' else p_key end
$fn$;

-- ---------------------------------------------------------------------------
-- Posting a voucher
-- ---------------------------------------------------------------------------
-- Internal: validates the lines, numbers the voucher and writes it. p_lines = [{ledger_id, sub_ledger_id,
-- cost_ledger_id, cost_sub_ledger_id, dr, cr, narration}].
create or replace function accounts._insert_voucher(
  p_company bigint, p_bu bigint, p_type text, p_date date, p_narr text, p_mode text, p_inst_no text, p_inst_date date,
  p_payee text, p_src_type text, p_src_id bigint, p_lines jsonb) returns bigint
 language plpgsql security definer set search_path = accounts, public as $fn$
declare
  v_id bigint; v_no text; l jsonb; n int := 0; v_dr numeric := 0; v_cr numeric := 0; x_dr numeric; x_cr numeric;
  led accounts.ledgers; sub accounts.sub_ledgers; cled accounts.ledgers; csub accounts.sub_ledgers; bu accounts.business_units;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then raise exception 'A voucher needs at least two lines'; end if;
  perform accounts._check_open(p_company, p_date);
  if p_bu is not null then
    select * into bu from accounts.business_units where id = p_bu;
    if not found or bu.company_id <> p_company then raise exception 'That business unit does not belong to this company'; end if;
  end if;
  v_no := accounts.next_doc_no(p_company, p_type, p_date);
  insert into accounts.vouchers(company_id, business_unit_id, voucher_type, doc_no, voucher_date, narration, mode, instrument_no, instrument_date, payee, source_type, source_id)
  values (p_company, p_bu, p_type, v_no, p_date, nullif(btrim(coalesce(p_narr, '')), ''), p_mode, nullif(btrim(coalesce(p_inst_no, '')), ''), p_inst_date, nullif(btrim(coalesce(p_payee, '')), ''), p_src_type, p_src_id)
  returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    x_dr := round(coalesce(nullif(l->>'dr', ''), '0')::numeric, 2);
    x_cr := round(coalesce(nullif(l->>'cr', ''), '0')::numeric, 2);
    if x_dr < 0 or x_cr < 0 or (x_dr > 0) = (x_cr > 0) then raise exception 'Line %: enter either a debit or a credit amount', n; end if;
    select * into led from accounts.ledgers where id = nullif(l->>'ledger_id', '')::bigint;
    if not found or led.company_id <> p_company then raise exception 'Line %: choose a ledger of this company', n; end if;
    if not led.active then raise exception 'Line %: ledger % is inactive', n, led.name; end if;
    if led.ledger_type <> 'general' then raise exception 'Line %: % is a cost / custom ledger - pick it in the cost ledger column', n, led.name; end if;
    if nullif(l->>'sub_ledger_id', '') is not null then
      select * into sub from accounts.sub_ledgers where id = (l->>'sub_ledger_id')::bigint;
      if not found or sub.ledger_id <> led.id then raise exception 'Line %: that sub-ledger does not belong to %', n, led.name; end if;
      if not sub.active then raise exception 'Line %: sub-ledger % is inactive', n, sub.name; end if;
    elsif led.sub_ledger_type is not null then
      raise exception 'Line %: choose the % sub-ledger for %', n, led.sub_ledger_type, led.name;
    end if;
    if nullif(l->>'cost_ledger_id', '') is not null then
      select * into cled from accounts.ledgers where id = (l->>'cost_ledger_id')::bigint;
      if not found or cled.company_id <> p_company or cled.ledger_type = 'general' then raise exception 'Line %: choose a cost / custom ledger of this company', n; end if;
      if nullif(l->>'cost_sub_ledger_id', '') is not null then
        select * into csub from accounts.sub_ledgers where id = (l->>'cost_sub_ledger_id')::bigint;
        if not found or csub.ledger_id <> cled.id then raise exception 'Line %: that cost sub-ledger does not belong to %', n, cled.name; end if;
      elsif cled.sub_ledger_type is not null then
        raise exception 'Line %: choose the sub-ledger of the cost ledger %', n, cled.name;
      end if;
    elsif nullif(l->>'cost_sub_ledger_id', '') is not null then
      raise exception 'Line %: a cost sub-ledger needs its cost ledger', n;
    end if;
    insert into accounts.voucher_lines(voucher_id, line_no, ledger_id, sub_ledger_id, cost_ledger_id, cost_sub_ledger_id, dr, cr, narration)
    values (v_id, n, led.id, nullif(l->>'sub_ledger_id', '')::bigint, nullif(l->>'cost_ledger_id', '')::bigint, nullif(l->>'cost_sub_ledger_id', '')::bigint,
            x_dr, x_cr, nullif(btrim(coalesce(l->>'narration', '')), ''));
    v_dr := v_dr + x_dr; v_cr := v_cr + x_cr;
  end loop;
  if abs(v_dr - v_cr) > 0.004 then raise exception 'The voucher does not balance: debits % and credits %', v_dr, v_cr; end if;
  if v_dr <= 0 then raise exception 'The voucher has no amount'; end if;
  update accounts.vouchers set amount = v_dr where id = v_id;
  insert into accounts.doc_log(doc_type, doc_id, action, remark) values ('voucher', v_id, 'Posted', coalesce(p_src_type, 'manual'));
  return v_id;
end $fn$;
revoke all on function accounts._insert_voucher(bigint, bigint, text, date, text, text, text, date, text, text, bigint, jsonb) from public, anon, authenticated;

-- Manual vouchers: receipt, payment, deposit, withdrawal, contra, journal.
-- p_head = {company_id, business_unit_id, voucher_type, voucher_date, narration, mode, instrument_no, instrument_date, payee}
create or replace function accounts.voucher_post(p_head jsonb, p_lines jsonb) returns bigint
 language plpgsql security definer set search_path = accounts, public as $fn$
declare
  me text; v_type text; v_company bigint; v_date date; v_mode text; v_inst text;
  dr_cash int; dr_bank int; dr_oth int; cr_cash int; cr_bank int; cr_oth int; v_id bigint;
begin
  me := accounts._guard_post();
  v_type := p_head->>'voucher_type';
  if v_type is null or v_type not in ('receipt','payment','deposit','withdrawal','contra','journal') then raise exception 'Choose the type of voucher'; end if;
  v_company := nullif(p_head->>'company_id', '')::bigint;
  if not exists (select 1 from accounts.companies where id = v_company and active) then raise exception 'Choose the company'; end if;
  v_date := nullif(p_head->>'voucher_date', '')::date;
  if v_date is null then raise exception 'Enter the voucher date'; end if;
  if v_date > current_date then raise exception 'A voucher cannot be dated in the future'; end if;
  v_mode := nullif(p_head->>'mode', '');
  v_inst := nullif(btrim(coalesce(p_head->>'instrument_no', '')), '');
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'Add the lines of the voucher'; end if;
  select count(*) filter (where d > 0 and l.is_cash), count(*) filter (where d > 0 and l.is_bank), count(*) filter (where d > 0 and not l.is_cash and not l.is_bank),
         count(*) filter (where c > 0 and l.is_cash), count(*) filter (where c > 0 and l.is_bank), count(*) filter (where c > 0 and not l.is_cash and not l.is_bank)
    into dr_cash, dr_bank, dr_oth, cr_cash, cr_bank, cr_oth
    from (select coalesce(nullif(x->>'dr', ''), '0')::numeric d, coalesce(nullif(x->>'cr', ''), '0')::numeric c, (x->>'ledger_id')::bigint lid from jsonb_array_elements(p_lines) x) q
    join accounts.ledgers l on l.id = q.lid and l.company_id = v_company;
  if v_type = 'receipt'    and not (dr_oth = 0 and (cr_cash + cr_bank) = 0 and (dr_cash + dr_bank) >= 1 and cr_oth >= 1) then raise exception 'A receipt debits a cash / bank ledger and credits other ledgers'; end if;
  if v_type = 'payment'    and not (cr_oth = 0 and (dr_cash + dr_bank) = 0 and (cr_cash + cr_bank) >= 1 and dr_oth >= 1) then raise exception 'A payment credits a cash / bank ledger and debits other ledgers'; end if;
  if v_type = 'deposit'    and not (dr_cash = 0 and dr_oth = 0 and cr_bank = 0 and cr_oth = 0 and dr_bank >= 1 and cr_cash >= 1) then raise exception 'A deposit debits a bank ledger and credits cash'; end if;
  if v_type = 'withdrawal' and not (dr_bank = 0 and dr_oth = 0 and cr_cash = 0 and cr_oth = 0 and dr_cash >= 1 and cr_bank >= 1) then raise exception 'A withdrawal debits cash and credits a bank ledger'; end if;
  if v_type = 'contra'     and not (dr_oth = 0 and cr_oth = 0 and (dr_cash + dr_bank) >= 1 and (cr_cash + cr_bank) >= 1) then raise exception 'A contra moves money between cash / bank ledgers only'; end if;
  if v_type = 'journal'    and (dr_cash + dr_bank + cr_cash + cr_bank) > 0 then raise exception 'A journal cannot touch cash or bank ledgers - use a receipt, payment or contra'; end if;
  if v_type <> 'journal' then
    if v_mode is null then raise exception 'Choose the mode (cash, cheque, transfer ...)'; end if;
    if v_type = 'receipt' and v_mode in ('cheque','dd') and v_inst is null then raise exception 'Enter the cheque / DD number'; end if;
  end if;
  v_id := accounts._insert_voucher(v_company, nullif(p_head->>'business_unit_id', '')::bigint, v_type, v_date, p_head->>'narration',
            case when v_type = 'journal' then null else v_mode end, v_inst, nullif(p_head->>'instrument_date', '')::date, p_head->>'payee', null, null, p_lines);
  return v_id;
end $fn$;
revoke all on function accounts.voucher_post(jsonb, jsonb) from public, anon;
grant execute on function accounts.voucher_post(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Standard chart of accounts for a real-estate developer, including the ledgers the automatic postings use.
-- Safe to run again: it only adds what is missing.
-- ---------------------------------------------------------------------------
create or replace function accounts.seed_chart(p_company bigint) returns int
 language plpgsql security definer set search_path = accounts, public as $fn$
declare
  v_added int := 0; g record; l record; v_gid bigint; v_pid bigint;
begin
  perform accounts._guard_post();
  if not accounts.is_admin() then raise exception 'Only an Accounts administrator can load the standard chart'; end if;
  if not exists (select 1 from accounts.companies where id = p_company) then raise exception 'Company not found'; end if;
  for g in select * from (values
    (1,  null::text,        'Assets',                           'asset'),
    (2,  'Assets',          'Fixed assets',                     'asset'),
    (3,  'Assets',          'Current assets',                   'asset'),
    (4,  'Current assets',  'Cash in hand',                     'asset'),
    (5,  'Current assets',  'Bank accounts',                    'asset'),
    (6,  'Current assets',  'Sundry debtors',                   'asset'),
    (7,  'Current assets',  'Loans & advances',                 'asset'),
    (8,  'Current assets',  'Duties & taxes (receivable)',      'asset'),
    (9,  'Current assets',  'Inventory & work in progress',     'asset'),
    (10, null,              'Liabilities',                      'liability'),
    (11, 'Liabilities',     'Capital & reserves',               'liability'),
    (12, 'Liabilities',     'Loans (liability)',                'liability'),
    (13, 'Liabilities',     'Current liabilities',              'liability'),
    (14, 'Current liabilities', 'Sundry creditors',             'liability'),
    (15, 'Current liabilities', 'Duties & taxes (payable)',     'liability'),
    (16, 'Current liabilities', 'Retention money',              'liability'),
    (17, 'Current liabilities', 'Advances from customers',      'liability'),
    (18, 'Current liabilities', 'Other current liabilities',    'liability'),
    (19, null,              'Income',                           'income'),
    (20, 'Income',          'Operating income',                 'income'),
    (21, 'Income',          'Other income',                     'income'),
    (22, null,              'Expenses',                         'expense'),
    (23, 'Expenses',        'Direct expenses',                  'expense'),
    (24, 'Expenses',        'Indirect expenses',                'expense')
  ) as t(n, parent, name, nature) order by n loop
    select id into v_pid from accounts.account_groups where company_id = p_company and lower(name) = lower(g.parent) and g.parent is not null limit 1;
    if not exists (select 1 from accounts.account_groups where company_id = p_company and lower(name) = lower(g.name) and coalesce(parent_id, 0) = coalesce(v_pid, 0)) then
      insert into accounts.account_groups(company_id, parent_id, name, nature, sort_order, is_system) values (p_company, v_pid, g.name, g.nature, g.n, true);
      v_added := v_added + 1;
    end if;
  end loop;
  for l in select * from (values
    ('cash',              'Cash in hand',                                   'Cash in hand',               true,  null::text),
    ('vendor_control',    'Sundry creditors - vendors & contractors',       'Sundry creditors',           false, 'vendor'),
    ('retention_payable', 'Retention money payable',                        'Retention money',            false, 'vendor'),
    ('tds_payable',       'TDS payable',                                    'Duties & taxes (payable)',   false, 'vendor'),
    ('input_cgst',        'Input CGST',                                     'Duties & taxes (receivable)',false, null),
    ('input_sgst',        'Input SGST',                                     'Duties & taxes (receivable)',false, null),
    ('input_igst',        'Input IGST',                                     'Duties & taxes (receivable)',false, null),
    ('output_cgst',       'Output CGST',                                    'Duties & taxes (payable)',   false, null),
    ('output_sgst',       'Output SGST',                                    'Duties & taxes (payable)',   false, null),
    ('output_igst',       'Output IGST',                                    'Duties & taxes (payable)',   false, null),
    ('customer_advance',  'Advance received from customers',                'Advances from customers',    false, 'customer'),
    ('purchases',         'Material purchases',                             'Direct expenses',            false, null),
    ('contractor_cost',   'Contractor / works cost',                        'Direct expenses',            false, null),
    ('expense_default',   'Other expenses (unclassified)',                  'Indirect expenses',          false, null),
    ('purchase_return',   'Purchase returns',                               'Direct expenses',            false, null),
    ('other_recoveries',  'Recoveries from contractors',                    'Other income',               false, null)
  ) as t(k, name, grp, cash, subtype) loop
    if not exists (select 1 from accounts.ledgers where company_id = p_company and system_key = l.k) then
      select id into v_gid from accounts.account_groups where company_id = p_company and lower(name) = lower(l.grp) order by id limit 1;
      -- if a ledger with that name exists already, give the role to it instead of making a duplicate
      if exists (select 1 from accounts.ledgers where company_id = p_company and lower(name) = lower(l.name)) then
        update accounts.ledgers set system_key = l.k where company_id = p_company and lower(name) = lower(l.name) and system_key is null and ledger_type = 'general';
      else
        insert into accounts.ledgers(company_id, group_id, code, name, ledger_type, sub_ledger_type, is_cash, system_key)
        values (p_company, v_gid, '', l.name, 'general', l.subtype, l.cash, l.k);
        v_added := v_added + 1;
      end if;
    end if;
  end loop;
  insert into accounts.settings(company_id, key, value) values (p_company, 'customer_gst.supply', 'intra') on conflict do nothing;
  return v_added;
end $fn$;
revoke all on function accounts.seed_chart(bigint) from public, anon;
grant execute on function accounts.seed_chart(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Cancelling a voucher (manual entries). Entries that came from another module are reversed from the posting screen.
-- ---------------------------------------------------------------------------
create or replace function accounts._cancel_voucher(p_id bigint, p_reason text, p_allow_source boolean) returns void
 language plpgsql security definer set search_path = accounts, public as $fn$
declare v accounts.vouchers; me text := lower(coalesce(app.current_user_email(), 'system'));
begin
  select * into v from accounts.vouchers where id = p_id for update;
  if not found then raise exception 'Voucher not found'; end if;
  if v.status = 'cancelled' then raise exception 'This voucher is already cancelled'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason for cancelling'; end if;
  if v.source_type is not null and not p_allow_source then
    raise exception 'This entry came from % - reverse it from Ledgers & postings, so the source document is released too', v.source_type;
  end if;
  perform accounts._check_open(v.company_id, v.voucher_date);
  if exists (select 1 from accounts.voucher_lines where voucher_id = p_id and cleared_on is not null) then
    raise exception 'A line of this voucher is marked cleared in the bank reconciliation - un-mark it first';
  end if;
  update accounts.vouchers set status = 'cancelled', cancelled_at = now(), cancelled_by = me, cancel_reason = btrim(p_reason) where id = p_id;
  insert into accounts.doc_log(doc_type, doc_id, action, remark) values ('voucher', p_id, 'Cancelled', btrim(p_reason));
end $fn$;
revoke all on function accounts._cancel_voucher(bigint, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security: read with the module grant, edit masters by role, vouchers only through the functions above.
-- ---------------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array['access','enterprises','companies','business_units','settings','account_groups','ledgers','sub_ledgers','opening_balances',
                           'doc_counters','doc_log','vouchers','voucher_lines'] loop
    execute format('alter table accounts.%I enable row level security', t);
    execute format('drop policy if exists %I on accounts.%I', t || '_read', t);
    execute format('create policy %I on accounts.%I for select to authenticated using ((select accounts.can_read()))', t || '_read', t);
    execute format('grant select on accounts.%I to authenticated', t);
  end loop;
  -- masters the administrators edit directly
  foreach t in array array['access','enterprises','companies','business_units','settings'] loop
    execute format('drop policy if exists %I on accounts.%I', t || '_admin_write', t);
    execute format('create policy %I on accounts.%I for all to authenticated using ((select accounts.is_admin())) with check ((select accounts.is_admin()))', t || '_admin_write', t);
    execute format('grant insert, update, delete on accounts.%I to authenticated', t);
  end loop;
  -- the chart: groups by administrators, ledgers / sub-ledgers / openings by anyone who may post
  execute 'drop policy if exists account_groups_admin_write on accounts.account_groups';
  execute 'create policy account_groups_admin_write on accounts.account_groups for all to authenticated using ((select accounts.is_admin())) with check ((select accounts.is_admin()))';
  execute 'grant insert, update, delete on accounts.account_groups to authenticated';
  foreach t in array array['ledgers','sub_ledgers','opening_balances'] loop
    execute format('drop policy if exists %I on accounts.%I', t || '_post_write', t);
    execute format('create policy %I on accounts.%I for all to authenticated using ((select accounts.can_post())) with check ((select accounts.can_post()))', t || '_post_write', t);
    execute format('grant insert, update, delete on accounts.%I to authenticated', t);
  end loop;
end $rls$;
-- the ledger triggers run for direct writes too
drop trigger if exists ledger_before_write on accounts.ledgers;
create trigger ledger_before_write before insert or update on accounts.ledgers
  for each row execute function accounts._ledger_before_write();
grant usage on schema accounts to authenticated;
grant usage, select on all sequences in schema accounts to authenticated;

-- Expose the schema through PostgREST.
do $expose$
declare cur text;
begin
  select substr(c, length('pgrst.db_schemas=') + 1) into cur
    from pg_db_role_setting s join pg_roles r on r.oid = s.setrole,
         unnest(s.setconfig) c
   where r.rolname = 'authenticator' and c like 'pgrst.db_schemas=%';
  if cur is not null and position('accounts' in cur) = 0 then
    execute format('alter role authenticator set pgrst.db_schemas = %L', cur || ',accounts');
  end if;
end $expose$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';

-- Registered where every other module is (the permission screens and the Usability report read erp_modules),
-- then usage tracking for the two tabs. Granted per person, like Finance - never to everybody by default.
insert into public.erp_modules(module_id, label, nav_group, sort, feature_module, always_granted, is_tracked)
values ('accounts','Accounts','Governance',155,'Accounts',false,true)
on conflict (module_id) do update set
  label        = excluded.label,
  nav_group    = excluded.nav_group,
  sort         = excluded.sort,
  is_tracked   = excluded.is_tracked;
insert into public.erp_feature_catalog(module_id, module_label, tab, feature, feature_key, sort, active) values
('accounts','Accounts','Transactions','View accounts transactions','accounts.transactions.view_transactions',520,true),
('accounts','Accounts','Ledgers & postings','View ledgers and automatic postings','accounts.ledgers_postings.view_ledgers_postings',521,true)
on conflict (feature_key) do nothing;
