-- Phase 1 (Dream Gurukul): Outstanding / Invoice / Receipt / Reversal registers.
-- Same pattern as cost_sheet_items/farvision_contacts throughout: is_current supersede on
-- reimport, staff-all + customer-scoped-select RLS, import_batches audit trail.

-- ---------------------------------------------------------------------------
-- 1. Customer Outstanding Details -> one row per (booking, document, schedule,
--    revenue head, basic/tax component) - that is this report's real grain,
--    verified against real data (Basic and Tax are separate rows here, unlike
--    Invoice Register where they're separate columns on the same row).
-- ---------------------------------------------------------------------------
create table if not exists cust.outstanding_items(
  id                bigserial primary key,
  unit_id           bigint not null references cust.units(id),
  document_no       text,
  document_date     date,
  booking_date      date,
  customer_status   text,
  due_date          date,
  overdue_days      integer,
  bill_amount       numeric,
  paid_amount       numeric,
  on_account        numeric,
  bill_outstanding  numeric,
  schedule          text,
  revenue_head      text,
  component         text,
  raw               jsonb,
  is_current        boolean not null default true,
  import_batch_id   bigint references cust.import_batches(id),
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  deleted_by        text
);
create index if not exists outstanding_items_unit_idx on cust.outstanding_items(unit_id) where deleted_at is null and is_current;
create unique index if not exists outstanding_items_uq on cust.outstanding_items(unit_id, coalesce(document_no,''), coalesce(schedule,''), coalesce(revenue_head,''), coalesce(component,'')) where deleted_at is null and is_current;

-- ---------------------------------------------------------------------------
-- 2. Invoice Register Details -> header (one per Document No) + lines
--    (one per Schedule x Revenue Head, Amount/Tax already separate columns
--    on the same row in this report).
-- ---------------------------------------------------------------------------
create table if not exists cust.invoices(
  id              bigserial primary key,
  unit_id         bigint not null references cust.units(id),
  document_no     text not null,
  document_date   date,
  invoice_type    text,
  due_date        date,
  gstin           text,
  status          text,
  raw             jsonb,
  is_current      boolean not null default true,
  import_batch_id bigint references cust.import_batches(id),
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  deleted_by      text
);
create index if not exists invoices_unit_idx on cust.invoices(unit_id) where deleted_at is null and is_current;
create unique index if not exists invoices_uq on cust.invoices(unit_id, document_no) where deleted_at is null and is_current;

create table if not exists cust.invoice_items(
  id           bigserial primary key,
  invoice_id   bigint not null references cust.invoices(id) on delete cascade,
  schedule     text,
  revenue_head text,
  amount       numeric,
  tax          numeric,
  net_amount   numeric,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists invoice_items_invoice_idx on cust.invoice_items(invoice_id);

-- ---------------------------------------------------------------------------
-- 3. Receipt Register Details -> header (one per Money Receipt No) + allocation
--    lines (one per Invoice No x Schedule x Revenue Head - the report's real
--    grain, verified: a single receipt commonly splits across 10-20+ lines).
--    No explicit Basic/Tax column exists in this report (unlike Outstanding) -
--    amount is stored as the single gross figure the report actually gives,
--    not split further (see Phase 1 analysis, Section I risk #1).
-- ---------------------------------------------------------------------------
create table if not exists cust.money_receipts(
  id                  bigserial primary key,
  unit_id             bigint not null references cust.units(id),
  receipt_no          text not null,
  receipt_date        date,
  payment_mode        text,
  instrument_no       text,
  instrument_date     date,
  drawn_on            text,
  drawn_on_branch     text,
  deposit_bank        text,
  narration           text,
  total_amount        numeric,
  is_reversed         boolean not null default false,
  unit_status_at_receipt text,
  raw                 jsonb,
  is_current          boolean not null default true,
  import_batch_id     bigint references cust.import_batches(id),
  created_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  deleted_by          text
);
create index if not exists money_receipts_unit_idx on cust.money_receipts(unit_id) where deleted_at is null and is_current;
create unique index if not exists money_receipts_uq on cust.money_receipts(unit_id, receipt_no) where deleted_at is null and is_current;

create table if not exists cust.receipt_items(
  id                bigserial primary key,
  receipt_id        bigint not null references cust.money_receipts(id) on delete cascade,
  against_demand_no text,
  schedule          text,
  revenue_head      text,
  amount            numeric,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists receipt_items_receipt_idx on cust.receipt_items(receipt_id);

-- ---------------------------------------------------------------------------
-- 4. Receipt Reversal Register Details.
-- ---------------------------------------------------------------------------
create table if not exists cust.receipt_reversals(
  id                     bigserial primary key,
  unit_id                bigint not null references cust.units(id),
  receipt_reversal_no    text not null,
  receipt_reversal_date  date,
  receipt_no             text,
  receipt_date           date,
  instrument_no          text,
  instrument_date        date,
  reversal_amount        numeric,
  total_reversal_amount  numeric,
  narration              text,
  bank_description       text,
  reason                 text,
  raw                    jsonb,
  is_current             boolean not null default true,
  import_batch_id        bigint references cust.import_batches(id),
  created_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  deleted_by             text
);
create index if not exists receipt_reversals_unit_idx on cust.receipt_reversals(unit_id) where deleted_at is null and is_current;

-- ---------------------------------------------------------------------------
-- 5. import_batches: file-level SHA-256 dedup (Section 17/18 of the spec).
-- ---------------------------------------------------------------------------
alter table cust.import_batches add column if not exists file_sha256 text;
create index if not exists import_batches_sha256_idx on cust.import_batches(file_sha256) where file_sha256 is not null;

-- ---------------------------------------------------------------------------
-- RLS: identical customer-scoped-select / staff-all pattern used everywhere else.
-- ---------------------------------------------------------------------------
alter table cust.outstanding_items enable row level security;
alter table cust.invoices enable row level security;
alter table cust.invoice_items enable row level security;
alter table cust.money_receipts enable row level security;
alter table cust.receipt_items enable row level security;
alter table cust.receipt_reversals enable row level security;

grant select, insert, update, delete on cust.outstanding_items, cust.invoices, cust.invoice_items, cust.money_receipts, cust.receipt_items, cust.receipt_reversals to authenticated;
grant usage, select on cust.outstanding_items_id_seq, cust.invoices_id_seq, cust.invoice_items_id_seq, cust.money_receipts_id_seq, cust.receipt_items_id_seq, cust.receipt_reversals_id_seq to authenticated;

create policy outstanding_items_customer_select on cust.outstanding_items for select to authenticated
  using (exists(select 1 from cust.units u where u.id=outstanding_items.unit_id and u.customer_id=app.current_customer_id() and u.deleted_at is null));
create policy outstanding_items_staff_all on cust.outstanding_items for all to authenticated
  using (app.is_custportal_staff()) with check (app.is_custportal_staff());

create policy invoices_customer_select on cust.invoices for select to authenticated
  using (exists(select 1 from cust.units u where u.id=invoices.unit_id and u.customer_id=app.current_customer_id() and u.deleted_at is null));
create policy invoices_staff_all on cust.invoices for all to authenticated
  using (app.is_custportal_staff()) with check (app.is_custportal_staff());

create policy invoice_items_customer_select on cust.invoice_items for select to authenticated
  using (exists(select 1 from cust.invoices i join cust.units u on u.id=i.unit_id where i.id=invoice_items.invoice_id and u.customer_id=app.current_customer_id() and u.deleted_at is null));
create policy invoice_items_staff_all on cust.invoice_items for all to authenticated
  using (app.is_custportal_staff()) with check (app.is_custportal_staff());

create policy money_receipts_customer_select on cust.money_receipts for select to authenticated
  using (exists(select 1 from cust.units u where u.id=money_receipts.unit_id and u.customer_id=app.current_customer_id() and u.deleted_at is null));
create policy money_receipts_staff_all on cust.money_receipts for all to authenticated
  using (app.is_custportal_staff()) with check (app.is_custportal_staff());

create policy receipt_items_customer_select on cust.receipt_items for select to authenticated
  using (exists(select 1 from cust.money_receipts r join cust.units u on u.id=r.unit_id where r.id=receipt_items.receipt_id and u.customer_id=app.current_customer_id() and u.deleted_at is null));
create policy receipt_items_staff_all on cust.receipt_items for all to authenticated
  using (app.is_custportal_staff()) with check (app.is_custportal_staff());

create policy receipt_reversals_customer_select on cust.receipt_reversals for select to authenticated
  using (exists(select 1 from cust.units u where u.id=receipt_reversals.unit_id and u.customer_id=app.current_customer_id() and u.deleted_at is null));
create policy receipt_reversals_staff_all on cust.receipt_reversals for all to authenticated
  using (app.is_custportal_staff()) with check (app.is_custportal_staff());
