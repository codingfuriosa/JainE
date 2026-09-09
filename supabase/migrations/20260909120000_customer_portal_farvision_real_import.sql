-- Customer Portal: reconcile the schema against real Farvision exports (Sales Details, Customer
-- Outstanding Summary, Invoice Register Details, Receipt Register Details) now that we've actually
-- seen them, instead of the generic shape guessed at in 20260828090000.
--
-- The single most important fix: cust.units was unique on (project_id, unit_code) alone, but real
-- Farvision data proves unit_code is NOT unique within a project - the same code ("2D") is a
-- different physical flat in each tower/block (Farvision's own Account Head spells this out:
-- "BLOCK A1-2D-..." vs "BLOCK A2-2D-..."). Left as-is, importing two real towers' worth of units
-- would either collide on insert or silently misattribute one tower's demand/receipts to another
-- tower's flat. The real fix is Booking No, which every one of these reports carries and which is
-- genuinely unique per booking - that becomes the primary import-matching key from here on, with
-- (project_id, tower, unit_code) as the correct uniqueness statement for the unit itself.

begin;

-- ---------------------------------------------------------------------------
-- 1. cust.units: fix the uniqueness bug, add the real join key
-- ---------------------------------------------------------------------------
alter table cust.units drop constraint if exists units_project_code_uq;
drop index if exists cust.units_project_code_uq;
create unique index if not exists units_project_tower_code_uq
  on cust.units (project_id, coalesce(tower,''), unit_code) where deleted_at is null;

alter table cust.units add column if not exists booking_no text;
alter table cust.units add column if not exists application_no text;
create unique index if not exists units_booking_no_uq
  on cust.units (booking_no) where deleted_at is null and booking_no is not null;
comment on column cust.units.booking_no is
  'Farvision''s own booking number - the one identifier that is actually unique per booking across '
  'every export (Sales Details, Outstanding, Invoice/Receipt Register). Sales Details import '
  'resolves/creates a unit by this, not by unit_code alone - see comment on unit_code below.';
comment on column cust.units.unit_code is
  'The Farvision unit code - NOT globally unique by itself (repeats across towers/blocks in the '
  'same project). The real business key is (project_id, tower, unit_code); booking_no is what '
  'imports actually match on.';

-- ---------------------------------------------------------------------------
-- 2. Traceability + the extra columns real Invoice/Receipt Register data carries
-- ---------------------------------------------------------------------------
alter table cust.farvision_demand   add column if not exists booking_no   text;
alter table cust.farvision_demand   add column if not exists revenue_head text;
comment on column cust.farvision_demand.milestone is
  'Invoice Register Details'' "Schedule Description" - the payment-plan milestone name (e.g. "ON '
  'ALLOTMENT", "ON COMMENCEMENT OF 4TH FLOOR CASTING") or "Adhoc" for one-off charges.';
comment on column cust.farvision_demand.revenue_head is
  'Invoice Register Details'' "RevenueHead Description" - what the charge is actually for (e.g. '
  '"Unit Cost", "OTHER CHARGES"), distinct from the milestone/schedule it was billed under.';

alter table cust.farvision_receipts add column if not exists booking_no   text;
alter table cust.farvision_receipts add column if not exists revenue_head text;
comment on column cust.farvision_receipts.against_demand_no is
  'Receipt Register Details'' "Invoice No" - which specific invoice this row''s amount was applied '
  'against. A single money receipt that was split across several invoices produces one row per '
  'invoice here (matching Farvision''s own allocation-level granularity), not one row per receipt.';

alter table cust.farvision_contacts add column if not exists booking_no text;

alter table cust.cost_sheet_items add column if not exists tax_amount numeric;
comment on column cust.cost_sheet_items.amount is
  'The component''s Basic Amount (pre-tax). See tax_amount for the tax portion - Sales Details '
  'gives every cost-sheet line as a Basic/Tax pair, not one combined figure.';

-- ---------------------------------------------------------------------------
-- 3. Outstanding snapshot - the authoritative "what do I currently owe" figure, straight from
-- Farvision's own Customer Outstanding Summary (as-on-date, not something we should recompute from
-- demand-minus-receipts client-side, since that misses On Account and Late Payment Fee entirely).
-- Same is_current/supersede pattern as cost_sheet_items and farvision_contacts.
-- ---------------------------------------------------------------------------
create table if not exists cust.outstanding_snapshot(
  id                    bigserial primary key,
  unit_id               bigint not null references cust.units(id),
  as_on_date            date,
  total_consideration   numeric,
  bill_outstanding      numeric,
  on_account            numeric,
  net_outstanding       numeric,
  late_fee_accrued      numeric,
  no_of_bills           integer,
  is_current            boolean not null default true,
  import_batch_id       bigint references cust.import_batches(id),
  created_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  deleted_by            text
);
create index if not exists outstanding_snapshot_unit_idx
  on cust.outstanding_snapshot (unit_id) where deleted_at is null and is_current;

do $$
begin
  if not exists(select 1 from pg_policy where polrelid='cust.outstanding_snapshot'::regclass and polname='outstanding_snapshot_customer_select') then
    create policy outstanding_snapshot_customer_select on cust.outstanding_snapshot for select
      to authenticated using (
        exists(select 1 from cust.units u where u.id = cust.outstanding_snapshot.unit_id and u.customer_id = app.current_customer_id())
      );
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.outstanding_snapshot'::regclass and polname='outstanding_snapshot_staff_all') then
    create policy outstanding_snapshot_staff_all on cust.outstanding_snapshot for all
      to authenticated using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $$;
alter table cust.outstanding_snapshot enable row level security;
grant select, insert, update, delete on cust.outstanding_snapshot to authenticated;
grant usage, select on sequence cust.outstanding_snapshot_id_seq to authenticated;

-- ---------------------------------------------------------------------------
-- 4. New import types for the real, bulk Farvision reports
-- ---------------------------------------------------------------------------
alter table cust.import_batches drop constraint if exists import_batches_import_type_check;
alter table cust.import_batches add constraint import_batches_import_type_check
  check (import_type = any (array[
    'demand','receipts','cost_sheet','contacts','maintenance_bills','maintenance_receipts',
    'sales_details','outstanding','invoice_register','receipt_register'
  ]));

create or replace function cust.undo_import_batch(p_batch_id bigint) returns void
  language plpgsql security definer set search_path = cust, public as $$
declare
  v_batch cust.import_batches;
  v_email text := app.current_user_email();
begin
  if not app.is_custportal_staff() then raise exception 'Not authorised to undo an import'; end if;
  select * into v_batch from cust.import_batches where id = p_batch_id;
  if not found then raise exception 'Import batch not found'; end if;
  if v_batch.status = 'undone' then raise exception 'This import was already undone'; end if;

  if v_batch.import_type in ('demand','invoice_register') then
    update cust.farvision_demand set deleted_at = now(), deleted_by = v_email
      where import_batch_id = p_batch_id and deleted_at is null;
  elsif v_batch.import_type in ('receipts','receipt_register') then
    update cust.farvision_receipts set deleted_at = now(), deleted_by = v_email
      where import_batch_id = p_batch_id and deleted_at is null;
  elsif v_batch.import_type = 'maintenance_bills' then
    update cust.maintenance_bills set deleted_at = now(), deleted_by = v_email
      where import_batch_id = p_batch_id and deleted_at is null;
  elsif v_batch.import_type = 'maintenance_receipts' then
    update cust.maintenance_receipts set deleted_at = now(), deleted_by = v_email
      where import_batch_id = p_batch_id and deleted_at is null;
  elsif v_batch.import_type = 'outstanding' then
    update cust.outstanding_snapshot set deleted_at = now(), deleted_by = v_email, is_current = false
      where import_batch_id = p_batch_id and deleted_at is null;
    update cust.outstanding_snapshot o set is_current = true
      where o.deleted_at is null and o.created_at = (
        select max(o2.created_at) from cust.outstanding_snapshot o2
        where o2.unit_id = o.unit_id and o2.deleted_at is null and o2.created_at < v_batch.imported_at
      )
      and o.unit_id in (select distinct unit_id from cust.outstanding_snapshot where import_batch_id = p_batch_id);
  elsif v_batch.import_type in ('cost_sheet','sales_details') then
    update cust.cost_sheet_items set deleted_at = now(), deleted_by = v_email, is_current = false
      where import_batch_id = p_batch_id and deleted_at is null;
    update cust.cost_sheet_items c set is_current = true
      where c.deleted_at is null and c.created_at = (
        select max(c2.created_at) from cust.cost_sheet_items c2
        where c2.unit_id = c.unit_id and c2.deleted_at is null and c2.created_at < v_batch.imported_at
      )
      and c.unit_id in (select distinct unit_id from cust.cost_sheet_items where import_batch_id = p_batch_id);
    update cust.farvision_contacts set deleted_at = now(), deleted_by = v_email, is_current = false
      where import_batch_id = p_batch_id and deleted_at is null;
    update cust.farvision_contacts c set is_current = true
      where c.deleted_at is null and c.created_at = (
        select max(c2.created_at) from cust.farvision_contacts c2
        where c2.unit_id = c.unit_id and c2.deleted_at is null and c2.created_at < v_batch.imported_at
      )
      and c.unit_id in (select distinct unit_id from cust.farvision_contacts where import_batch_id = p_batch_id);
  elsif v_batch.import_type = 'contacts' then
    update cust.farvision_contacts set deleted_at = now(), deleted_by = v_email, is_current = false
      where import_batch_id = p_batch_id and deleted_at is null;
    update cust.farvision_contacts c set is_current = true
      where c.deleted_at is null and c.created_at = (
        select max(c2.created_at) from cust.farvision_contacts c2
        where c2.unit_id = c.unit_id and c2.deleted_at is null and c2.created_at < v_batch.imported_at
      )
      and c.unit_id in (select distinct unit_id from cust.farvision_contacts where import_batch_id = p_batch_id);
  end if;

  update cust.import_batches set status = 'undone', undone_at = now(), undone_by = v_email
    where id = p_batch_id;
end;
$$;
comment on function cust.undo_import_batch is
  'sales_details''s undo reverts the cost-sheet and contact data it wrote, matching cost_sheet/'
  'contacts - it deliberately does NOT delete or unwind the cust.units/cust.customers rows it '
  'created or updated (unit/customer master records may already be referenced by other data by the '
  'time someone undoes an import, and silently deleting a customer''s only unit would break their '
  'login). If a sales_details import created the wrong unit or customer outright, fix or remove it '
  'by hand in Projects & Units / Customers instead of relying on Undo.';

commit;
