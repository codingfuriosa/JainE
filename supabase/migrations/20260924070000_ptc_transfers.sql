-- The missing seventh report: Farvision's "Payment To Customer Register" (PTC), covering booking
-- transfers and refunds - the one document type in Farvision's own Customer Ledger that none of the
-- six daily exports carry. Confirmed by checking every parsed row of every import to date: zero PTC
-- documents anywhere in Invoice Register, Receipt Register, Receipt Reversal, Outstanding, Booking
-- Register or Sales Details.
--
-- A PTC row is filed under its SOURCE booking (money leaving that unit's account) and, for a
-- transfer, names a "Booking No. of Transferee" (money landing on a different unit). A refund has no
-- transferee - the money simply left the business. Verified against real data: Pallabi Mukherjee's
-- unit 2D is the transferee of PTCDDOL/00016/25-26 (Rs 2,10,000, source booking's unit 4B never
-- existed - a cancelled booking that was never Active, so Sales Details never created it). This is
-- exactly the gap that made her ledger close Rs 2,10,000 above Farvision's.
--
-- Rule, and it needs no narration parsing: debit the source unit if it resolves, credit the
-- transferee unit if it resolves. A refund is just a transfer with no resolvable transferee.

create table if not exists cust.ptc_transfers(
  id                    bigserial primary key,
  document_no           text not null,
  document_date         date,
  amount                numeric not null,
  narration             text,
  source_booking_no     text,
  source_unit_id        bigint references cust.units(id),
  transferee_booking_no text,
  transferee_unit_id    bigint references cust.units(id),
  is_reversed           boolean not null default false,
  is_current            boolean not null default true,
  import_batch_id       bigint references cust.import_batches(id),
  created_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  deleted_by            text
);
comment on table cust.ptc_transfers is
  'Farvision''s Payment To Customer (PTC) register: booking transfers and refunds. A row debits '
  'source_unit_id (if it resolves) and credits transferee_unit_id (if it resolves and is_reversed is '
  'false) - see cust.ledger-building code in nexus-core.js and cust.reconciliation for how both sides '
  'are applied.';

create unique index if not exists ptc_transfers_doc_uq
  on cust.ptc_transfers(document_no) where deleted_at is null;
create index if not exists ptc_transfers_source_idx
  on cust.ptc_transfers(source_unit_id) where deleted_at is null and not is_reversed;
create index if not exists ptc_transfers_transferee_idx
  on cust.ptc_transfers(transferee_unit_id) where deleted_at is null and not is_reversed;

alter table cust.ptc_transfers enable row level security;

create policy ptc_transfers_staff_all on cust.ptc_transfers for all
  using (app.is_custportal_staff()) with check (app.is_custportal_staff());

create policy ptc_transfers_customer_select on cust.ptc_transfers for select
  using (exists (
    select 1 from cust.units u
     where u.id in (ptc_transfers.source_unit_id, ptc_transfers.transferee_unit_id)
       and u.customer_id = app.current_customer_id()
  ));

alter table cust.import_batches drop constraint if exists import_batches_import_type_check;
alter table cust.import_batches add constraint import_batches_import_type_check
  check (import_type = any (array[
    'demand','receipts','cost_sheet','contacts',
    'maintenance_bills','maintenance_receipts',
    'sales_details','outstanding','invoice_register','receipt_register',
    'receipt_reversal','booking_register','ptc_transfer'
  ]));

-- Give undo a real branch for this type rather than letting it fall through as a silent no-op.
create or replace function cust.undo_import_batch(p_batch_id bigint)
returns void
language plpgsql
security definer
set search_path to 'cust', 'public'
as $function$
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
  elsif v_batch.import_type = 'ptc_transfer' then
    update cust.ptc_transfers set deleted_at = now(), deleted_by = v_email
      where import_batch_id = p_batch_id and deleted_at is null;
  end if;

  update cust.import_batches set status = 'undone', undone_at = now(), undone_by = v_email
    where id = p_batch_id;
end;
$function$;
