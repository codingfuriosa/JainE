-- Customer Portal: post-possession maintenance (bills/receipts/ledger, QR payment with an uploaded
-- receipt, an upcoming-demand preview) and a flat-modification request workflow routed to a
-- project-specific Project Manager. Both are gated to units.status = 'possession', matching the
-- existing amenities/sub-meter convention (see 20260828090300_..._support_amenities_referrals.sql).

-- ---------- Maintenance bills & receipts (Farvision CSV import, same shape as demand/receipts) ----------
create table if not exists cust.maintenance_bills (
  id bigserial primary key,
  unit_id bigint references cust.units(id),
  unit_code text not null,
  bill_no text not null,
  bill_period text,
  bill_date date,
  due_date date,
  amount numeric,
  gst_amount numeric,
  total_amount numeric,
  status text,
  raw jsonb,
  import_batch_id bigint references cust.import_batches(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text
);
create unique index if not exists maintenance_bills_unit_bill_uq on cust.maintenance_bills(unit_id, bill_no) where deleted_at is null;

create table if not exists cust.maintenance_receipts (
  id bigserial primary key,
  unit_id bigint references cust.units(id),
  unit_code text not null,
  receipt_no text not null,
  receipt_date date,
  amount numeric,
  mode text,
  against_bill_no text,
  raw jsonb,
  import_batch_id bigint references cust.import_batches(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text
);
create unique index if not exists maintenance_receipts_unit_receipt_uq on cust.maintenance_receipts(unit_id, receipt_no) where deleted_at is null;

alter table cust.import_batches drop constraint if exists import_batches_import_type_check;
alter table cust.import_batches add constraint import_batches_import_type_check
  check (import_type = any (array['demand','receipts','cost_sheet','contacts','maintenance_bills','maintenance_receipts']));

-- ---------- Upcoming maintenance demand preview (one row per unit, upsert like inspection_checklists) ----------
create table if not exists cust.maintenance_upcoming (
  id bigserial primary key,
  unit_id bigint not null references cust.units(id),
  amount numeric,
  expected_date date,
  note text,
  updated_at timestamptz not null default now(),
  updated_by text
);
create unique index if not exists maintenance_upcoming_unit_uq on cust.maintenance_upcoming(unit_id);

-- ---------- Customer-submitted QR payments against maintenance (staff confirms) ----------
create table if not exists cust.maintenance_payments (
  id bigserial primary key,
  unit_id bigint not null references cust.units(id),
  bill_id bigint references cust.maintenance_bills(id),
  amount numeric not null,
  payment_reference text,
  receipt_storage_path text,
  status text not null default 'submitted' check (status in ('submitted','confirmed','rejected')),
  notes text,
  submitted_at timestamptz not null default now(),
  submitted_by text,
  confirmed_at timestamptz,
  confirmed_by text,
  deleted_at timestamptz,
  deleted_by text
);

-- ---------- Project managers (who a modification request for a given project routes to) ----------
create table if not exists cust.project_managers (
  id bigserial primary key,
  project_id bigint not null references cust.projects(id),
  staff_email text not null,
  assigned_at timestamptz not null default now(),
  assigned_by text,
  deleted_at timestamptz,
  deleted_by text
);
create index if not exists project_managers_project_idx on cust.project_managers(project_id) where deleted_at is null;

create or replace function app.is_project_manager_for_unit(p_unit_id bigint) returns boolean
  language sql stable security definer set search_path = cust, public as $$
  select app.is_superadmin() or exists(
    select 1 from cust.units u
    join cust.project_managers pm on pm.project_id = u.project_id and pm.deleted_at is null
    where u.id = p_unit_id and lower(pm.staff_email) = lower(app.current_user_email())
  )
$$;

-- ---------- Flat modification requests ----------
-- State machine: submitted -> pm_responded -> accepted -> acknowledged
--                                           -> rejected (terminal)
-- The customer INSERT policy pins every workflow field to its untouched starting value, so a
-- customer can never fabricate a PM response/decision/acknowledgement by just supplying it on
-- insert (the same concern the payment-status RPCs elsewhere in this schema exist for - but here
-- plain CHECK-style with_check clauses are enough since it's the row's initial state, not a later
-- single-column update).
create table if not exists cust.modification_requests (
  id bigserial primary key,
  unit_id bigint not null references cust.units(id),
  title text not null,
  description text,
  attachment_storage_path text,
  status text not null default 'submitted' check (status in ('submitted','pm_responded','accepted','rejected','acknowledged')),
  pm_response_text text,
  estimate_amount numeric,
  responded_at timestamptz,
  responded_by text,
  decision text check (decision in ('accepted','rejected')),
  decided_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by text,
  created_at timestamptz not null default now(),
  created_by text,
  deleted_at timestamptz,
  deleted_by text
);
create index if not exists modification_requests_unit_idx on cust.modification_requests(unit_id) where deleted_at is null;

-- Customer accept/reject - the only customer-initiated state transition after the initial insert,
-- and it must not let them touch the PM's own response fields, so it's a narrow RPC rather than a
-- blanket UPDATE policy (same reasoning as set_amenity_booking_payment_ref/set_submeter_payment_ref).
create or replace function cust.decide_modification_request(p_request_id bigint, p_decision text) returns void
  language plpgsql security definer set search_path = cust, public as $$
begin
  if p_decision not in ('accepted','rejected') then raise exception 'decision must be accepted or rejected'; end if;
  update cust.modification_requests r set status = p_decision, decision = p_decision, decided_at = now()
  where r.id = p_request_id
    and r.status = 'pm_responded'
    and exists(select 1 from cust.units u where u.id = r.unit_id and u.customer_id = app.current_customer_id());
  if not found then raise exception 'Request not found, not yours, or not awaiting your decision'; end if;
end;
$$;

-- ---------- RLS ----------
alter table cust.maintenance_bills enable row level security;
alter table cust.maintenance_receipts enable row level security;
alter table cust.maintenance_upcoming enable row level security;
alter table cust.maintenance_payments enable row level security;
alter table cust.project_managers enable row level security;
alter table cust.modification_requests enable row level security;

create policy maintenance_bills_customer_select on cust.maintenance_bills for select using (
  deleted_at is null and exists(select 1 from cust.units u where u.id = maintenance_bills.unit_id and u.customer_id = app.current_customer_id() and u.status = 'possession')
);
create policy maintenance_bills_staff_all on cust.maintenance_bills for all using (app.is_custportal_staff()) with check (app.is_custportal_staff());

create policy maintenance_receipts_customer_select on cust.maintenance_receipts for select using (
  deleted_at is null and exists(select 1 from cust.units u where u.id = maintenance_receipts.unit_id and u.customer_id = app.current_customer_id() and u.status = 'possession')
);
create policy maintenance_receipts_staff_all on cust.maintenance_receipts for all using (app.is_custportal_staff()) with check (app.is_custportal_staff());

create policy maintenance_upcoming_customer_select on cust.maintenance_upcoming for select using (
  exists(select 1 from cust.units u where u.id = maintenance_upcoming.unit_id and u.customer_id = app.current_customer_id() and u.status = 'possession')
);
create policy maintenance_upcoming_staff_all on cust.maintenance_upcoming for all using (app.is_custportal_staff()) with check (app.is_custportal_staff());

create policy maintenance_payments_customer_select on cust.maintenance_payments for select using (
  deleted_at is null and exists(select 1 from cust.units u where u.id = maintenance_payments.unit_id and u.customer_id = app.current_customer_id())
);
create policy maintenance_payments_customer_insert on cust.maintenance_payments for insert with check (
  status = 'submitted' and confirmed_at is null and confirmed_by is null
  and exists(select 1 from cust.units u where u.id = maintenance_payments.unit_id and u.customer_id = app.current_customer_id() and u.status = 'possession')
);
create policy maintenance_payments_staff_all on cust.maintenance_payments for all using (app.is_custportal_staff()) with check (app.is_custportal_staff());

create policy project_managers_staff_all on cust.project_managers for all using (app.is_custportal_staff()) with check (app.is_custportal_staff());

create policy modification_requests_customer_select on cust.modification_requests for select using (
  deleted_at is null and exists(select 1 from cust.units u where u.id = modification_requests.unit_id and u.customer_id = app.current_customer_id())
);
create policy modification_requests_customer_insert on cust.modification_requests for insert with check (
  status = 'submitted' and responded_at is null and decision is null and decided_at is null and acknowledged_at is null
  and exists(select 1 from cust.units u where u.id = modification_requests.unit_id and u.customer_id = app.current_customer_id() and u.status = 'possession')
);
create policy modification_requests_staff_select on cust.modification_requests for select using (app.is_custportal_staff());
create policy modification_requests_pm_manage on cust.modification_requests for all using (
  app.is_custportal_staff() and app.is_project_manager_for_unit(unit_id)
) with check (
  app.is_custportal_staff() and app.is_project_manager_for_unit(unit_id)
);

grant usage, select on all sequences in schema cust to authenticated, service_role;

-- ---------- Extend undo_import_batch for the two new import types ----------
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

  if v_batch.import_type = 'demand' then
    update cust.farvision_demand set deleted_at = now(), deleted_by = v_email
      where import_batch_id = p_batch_id and deleted_at is null;
  elsif v_batch.import_type = 'receipts' then
    update cust.farvision_receipts set deleted_at = now(), deleted_by = v_email
      where import_batch_id = p_batch_id and deleted_at is null;
  elsif v_batch.import_type = 'maintenance_bills' then
    update cust.maintenance_bills set deleted_at = now(), deleted_by = v_email
      where import_batch_id = p_batch_id and deleted_at is null;
  elsif v_batch.import_type = 'maintenance_receipts' then
    update cust.maintenance_receipts set deleted_at = now(), deleted_by = v_email
      where import_batch_id = p_batch_id and deleted_at is null;
  elsif v_batch.import_type = 'cost_sheet' then
    update cust.cost_sheet_items set deleted_at = now(), deleted_by = v_email, is_current = false
      where import_batch_id = p_batch_id and deleted_at is null;
    update cust.cost_sheet_items c set is_current = true
      where c.deleted_at is null and c.created_at = (
        select max(c2.created_at) from cust.cost_sheet_items c2
        where c2.unit_id = c.unit_id and c2.deleted_at is null and c2.created_at < v_batch.imported_at
      )
      and c.unit_id in (select distinct unit_id from cust.cost_sheet_items where import_batch_id = p_batch_id);
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
