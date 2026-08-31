-- Customer Portal: real data model behind what has, until now, been a static mock (VIEWS.customer).
--
-- Everything a customer's own login is allowed to see lives in this one schema, `cust`, kept apart
-- from acc/adm/doc/etc. because it has a different trust model (read by a non-staff principal) and
-- a different data source (manual CSV export from the Farvision ERP, not live app usage).
--
-- Two things drive most of the shape here:
--   - unit_code is the join key every Farvision import is keyed on. Farvision data supersedes rather
--     than merges on re-import (cost sheet, contacts) or upserts on its own natural key (demand_no,
--     receipt_no), and every import is recorded in import_batches with the raw parsed rows, so a bad
--     import can be undone without anyone having to reconstruct what was there before.
--   - a unit's floor_casting_completed_at is the entire gate for per-flat construction photos: NULL
--     keeps cust.unit_photos invisible to that unit's customer even if photos already exist for it.
--     This is enforced in RLS below, not just hidden in the UI.
--
-- RLS note: every existing policy in this app (acc/adm/doc/...) is `using(true)` because until now
-- every authenticated user was trusted staff. A cust.* table must never repeat that pattern - see the
-- companion migration 20260828090100_customer_portal_isolation_retrofit.sql for why, and for how the
-- rest of the app is retrofitted so a customer's JWT can't read staff-only schemas directly.

begin;

create schema if not exists cust;
grant usage on schema cust to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Master data
-- ---------------------------------------------------------------------------
create table if not exists cust.customers(
  id            bigserial primary key,
  full_name     text not null,
  email         text not null,
  phone         text,
  auth_user_id  uuid references auth.users(id),
  status        text not null default 'active' check (status in ('active','inactive')),
  created_at    timestamptz not null default now(),
  created_by    text,
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    text
);
create unique index if not exists customers_email_uq on cust.customers (lower(email)) where deleted_at is null;
create unique index if not exists customers_auth_user_uq on cust.customers (auth_user_id) where auth_user_id is not null;
comment on column cust.customers.auth_user_id is
  'Set the first time staff run "Create login" (customer-invite edge function). NULL until then - '
  'the customer simply has no way to sign in yet.';

create table if not exists cust.projects(
  id                       bigserial primary key,
  name                     text not null,
  farvision_project_code   text,
  created_at               timestamptz not null default now(),
  created_by               text,
  deleted_at               timestamptz,
  deleted_by               text
);
create unique index if not exists projects_name_uq on cust.projects (lower(name)) where deleted_at is null;

create table if not exists cust.units(
  id                          bigserial primary key,
  project_id                  bigint not null references cust.projects(id),
  unit_code                   text not null,
  tower                       text,
  floor_no                    text,
  unit_type                   text,
  carpet_area_sqft            numeric(10,2),
  customer_id                 bigint references cust.customers(id),
  agreement_value             numeric(14,2),
  status                      text not null default 'booked' check (status in ('booked','registered','possession','cancelled')),
  floor_casting_completed_at  timestamptz,
  created_at                  timestamptz not null default now(),
  created_by                  text,
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz,
  deleted_by                  text
);
create unique index if not exists units_project_code_uq on cust.units (project_id, unit_code) where deleted_at is null;
create index if not exists units_customer_idx on cust.units (customer_id) where deleted_at is null;
comment on column cust.units.unit_code is
  'The Farvision unit code. Every CSV import (demand/receipts/cost sheet/contacts) is keyed on this '
  'to resolve which unit a row belongs to - it must match whatever Farvision itself exports.';
comment on column cust.units.floor_casting_completed_at is
  'Set by staff (Customer Portal Admin > Projects & Units > "Mark floor casting complete"). NULL '
  'keeps this unit''s cust.unit_photos invisible to its customer even if photos already exist for '
  'it - see the RLS policy on cust.unit_photos below, which is the real enforcement, not the UI.';

-- ---------------------------------------------------------------------------
-- 2. Farvision-imported data - all keyed by unit_code, resolved to unit_id at import time
-- ---------------------------------------------------------------------------
create table if not exists cust.import_batches(
  id               bigserial primary key,
  import_type      text not null check (import_type in ('demand','receipts','cost_sheet','contacts')),
  project_id       bigint references cust.projects(id),
  file_name        text,
  imported_by      text not null,
  imported_at      timestamptz not null default now(),
  row_count        int,
  matched_count    int,
  unmatched_count  int,
  unmatched_codes  text[] not null default '{}',
  raw_rows         jsonb not null default '[]'::jsonb,
  status           text not null default 'completed' check (status in ('completed','undone')),
  undone_at        timestamptz,
  undone_by        text
);
comment on column cust.import_batches.raw_rows is
  'Every parsed CSV row, verbatim, before any transformation. The source of truth undo_import_batch '
  'reconstructs from - never overwritten, so a batch can always be inspected after the fact.';

create table if not exists cust.farvision_demand(
  id               bigserial primary key,
  unit_id          bigint references cust.units(id),
  unit_code        text not null,
  demand_no        text not null,
  milestone        text,
  demand_date      date,
  due_date         date,
  amount           numeric(14,2),
  gst_amount       numeric(14,2),
  total_amount     numeric(14,2),
  status           text,
  raw              jsonb,
  import_batch_id  bigint references cust.import_batches(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  deleted_by       text
);
create unique index if not exists farvision_demand_unit_no_uq on cust.farvision_demand (unit_id, demand_no) where deleted_at is null and unit_id is not null;
create index if not exists farvision_demand_unit_idx on cust.farvision_demand (unit_id) where deleted_at is null;

create table if not exists cust.farvision_receipts(
  id                 bigserial primary key,
  unit_id            bigint references cust.units(id),
  unit_code          text not null,
  receipt_no         text not null,
  receipt_date       date,
  amount             numeric(14,2),
  mode               text,
  against_demand_no  text,
  raw                jsonb,
  import_batch_id    bigint references cust.import_batches(id),
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  deleted_by         text
);
create unique index if not exists farvision_receipts_unit_no_uq on cust.farvision_receipts (unit_id, receipt_no) where deleted_at is null and unit_id is not null;
create index if not exists farvision_receipts_unit_idx on cust.farvision_receipts (unit_id) where deleted_at is null;

create table if not exists cust.cost_sheet_items(
  id               bigserial primary key,
  unit_id          bigint not null references cust.units(id),
  component        text not null,
  milestone        text,
  percentage       numeric(6,3),
  amount           numeric(14,2),
  sort_order       int not null default 0,
  is_current       boolean not null default true,
  import_batch_id  bigint references cust.import_batches(id),
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  deleted_by       text
);
create index if not exists cost_sheet_items_unit_idx on cust.cost_sheet_items (unit_id, sort_order) where deleted_at is null and is_current;
comment on column cust.cost_sheet_items.is_current is
  'A re-import of the cost sheet for a unit sets the prior rows'' is_current to false and inserts new '
  'current ones, rather than deleting - so the payment plan a customer saw last month stays auditable.';

create table if not exists cust.farvision_contacts(
  id               bigserial primary key,
  unit_id          bigint not null references cust.units(id),
  unit_code        text not null,
  contact_name     text,
  contact_phone    text,
  contact_email    text,
  contact_address  text,
  booking_date     date,
  agreement_date   date,
  raw              jsonb,
  is_current       boolean not null default true,
  import_batch_id  bigint references cust.import_batches(id),
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  deleted_by       text
);
create index if not exists farvision_contacts_unit_idx on cust.farvision_contacts (unit_id) where deleted_at is null and is_current;

-- ---------------------------------------------------------------------------
-- 3. Photos & documents - S3-backed, same pattern as doc.documents: store storage_path only
-- ---------------------------------------------------------------------------
create table if not exists cust.project_photos(
  id           bigserial primary key,
  project_id   bigint not null references cust.projects(id),
  taken_on     date not null,
  caption      text,
  storage_path text not null,
  file_name    text,
  file_size    bigint,
  file_type    text,
  uploaded_by  text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   text
);
create index if not exists project_photos_project_idx on cust.project_photos (project_id, taken_on desc) where deleted_at is null;
comment on column cust.project_photos.taken_on is
  'The date shown to customers ("updated every two weeks") - a business date staff enter, not the '
  'row''s upload timestamp, so a batch of photos uploaded late still reads with the right date.';

create table if not exists cust.unit_photos(
  id           bigserial primary key,
  unit_id      bigint not null references cust.units(id),
  taken_on     date not null,
  caption      text,
  storage_path text not null,
  file_name    text,
  file_size    bigint,
  file_type    text,
  uploaded_by  text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   text
);
create index if not exists unit_photos_unit_idx on cust.unit_photos (unit_id, taken_on desc) where deleted_at is null;

create table if not exists cust.project_documents(
  id           bigserial primary key,
  project_id   bigint not null references cust.projects(id),
  doc_type     text not null check (doc_type in ('brochure','legal')),
  title        text,
  storage_path text not null,
  file_name    text,
  file_size    bigint,
  file_type    text,
  uploaded_by  text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   text
);
create index if not exists project_documents_project_idx on cust.project_documents (project_id, doc_type) where deleted_at is null;

create table if not exists cust.customer_documents(
  id           bigserial primary key,
  unit_id      bigint not null references cust.units(id),
  doc_type     text not null check (doc_type in ('celebration_photo','celebration_video','draft_agreement','possession_letter')),
  title        text,
  storage_path text not null,
  file_name    text,
  file_size    bigint,
  file_type    text,
  uploaded_by  text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   text
);
create index if not exists customer_documents_unit_idx on cust.customer_documents (unit_id, doc_type) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 4. Identity helpers (app schema, alongside the existing app.current_user_email/app.is_superadmin)
-- ---------------------------------------------------------------------------
create or replace function app.current_customer_id() returns bigint
 language sql stable security definer set search_path = cust, public
as $$
  select id from cust.customers
  where auth_user_id = auth.uid() and status = 'active' and deleted_at is null
  limit 1
$$;
grant execute on function app.current_customer_id() to authenticated;
comment on function app.current_customer_id() is
  'The cust.customers row for the signed-in JWT, or null for a staff session / anyone not linked to '
  'a customer login. Every cust.* customer-facing RLS policy is scoped through this.';

create or replace function app.is_customer() returns boolean
 language sql stable security definer set search_path = public
as $$
  select app.current_customer_id() is not null
$$;
grant execute on function app.is_customer() to authenticated;
comment on function app.is_customer() is
  'True only for a JWT linked to a cust.customers row. Used both to scope cust.* RLS and, in the '
  'companion isolation-retrofit migration, to block a customer session from every staff schema.';

-- Who may write cust.* data from the Customer Portal Admin screens. Deliberately mirrors the
-- adm.users.department overlap-check pattern already used to gate workflow step-assignment
-- (see acc.wf_create_instance's v_may_assign_anyone in 20260827120000_reimbursement_owner_confirmation.sql).
create or replace function app.is_custportal_staff() returns boolean
 language sql stable security definer set search_path = adm, public
as $$
  select app.is_superadmin() or exists(
    select 1 from adm.users u
    where lower(u.email) = lower(app.current_user_email())
      and u.department && array['Sales','CP Sales','Post Sales','Accounts','Systems','Management']::text[]
  )
$$;
grant execute on function app.is_custportal_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS - a customer_select policy scoped to that customer's own data, plus a staff_all policy.
--    Deliberately NOT the `using(true)` pattern the rest of this app uses (see file header).
-- ---------------------------------------------------------------------------
do $rls$
declare
  t text;
begin
  foreach t in array array[
    'customers','projects','units','import_batches','farvision_demand','farvision_receipts',
    'cost_sheet_items','farvision_contacts','project_photos','unit_photos',
    'project_documents','customer_documents'
  ] loop
    execute format('alter table cust.%I enable row level security', t);
  end loop;
end $rls$;

-- customers: a customer may see only their own row. Staff manage the roster.
do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.customers'::regclass and polname='customers_customer_select') then
    create policy customers_customer_select on cust.customers for select
      using (id = app.current_customer_id());
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.customers'::regclass and polname='customers_staff_all') then
    create policy customers_staff_all on cust.customers for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

-- projects: a customer sees only a project they actually hold a unit in.
do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.projects'::regclass and polname='projects_customer_select') then
    create policy projects_customer_select on cust.projects for select
      using (exists(select 1 from cust.units u where u.project_id = cust.projects.id
                     and u.customer_id = app.current_customer_id() and u.deleted_at is null));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.projects'::regclass and polname='projects_staff_all') then
    create policy projects_staff_all on cust.projects for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

-- units: a customer sees only units assigned to them.
do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.units'::regclass and polname='units_customer_select') then
    create policy units_customer_select on cust.units for select
      using (customer_id = app.current_customer_id() and deleted_at is null);
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.units'::regclass and polname='units_staff_all') then
    create policy units_staff_all on cust.units for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

-- import_batches: staff-only. A customer has no business reason to see import history.
do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.import_batches'::regclass and polname='import_batches_staff_all') then
    create policy import_batches_staff_all on cust.import_batches for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

-- farvision_demand / farvision_receipts: visible to the owning customer via unit_id.
do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.farvision_demand'::regclass and polname='farvision_demand_customer_select') then
    create policy farvision_demand_customer_select on cust.farvision_demand for select
      using (deleted_at is null and exists(
        select 1 from cust.units u where u.id = cust.farvision_demand.unit_id
          and u.customer_id = app.current_customer_id() and u.deleted_at is null));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.farvision_demand'::regclass and polname='farvision_demand_staff_all') then
    create policy farvision_demand_staff_all on cust.farvision_demand for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.farvision_receipts'::regclass and polname='farvision_receipts_customer_select') then
    create policy farvision_receipts_customer_select on cust.farvision_receipts for select
      using (deleted_at is null and exists(
        select 1 from cust.units u where u.id = cust.farvision_receipts.unit_id
          and u.customer_id = app.current_customer_id() and u.deleted_at is null));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.farvision_receipts'::regclass and polname='farvision_receipts_staff_all') then
    create policy farvision_receipts_staff_all on cust.farvision_receipts for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

-- cost_sheet_items: current rows only, for the owning customer's unit.
do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.cost_sheet_items'::regclass and polname='cost_sheet_items_customer_select') then
    create policy cost_sheet_items_customer_select on cust.cost_sheet_items for select
      using (deleted_at is null and is_current and exists(
        select 1 from cust.units u where u.id = cust.cost_sheet_items.unit_id
          and u.customer_id = app.current_customer_id() and u.deleted_at is null));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.cost_sheet_items'::regclass and polname='cost_sheet_items_staff_all') then
    create policy cost_sheet_items_staff_all on cust.cost_sheet_items for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

-- farvision_contacts: current row only, for the owning customer's unit.
do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.farvision_contacts'::regclass and polname='farvision_contacts_customer_select') then
    create policy farvision_contacts_customer_select on cust.farvision_contacts for select
      using (deleted_at is null and is_current and exists(
        select 1 from cust.units u where u.id = cust.farvision_contacts.unit_id
          and u.customer_id = app.current_customer_id() and u.deleted_at is null));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.farvision_contacts'::regclass and polname='farvision_contacts_staff_all') then
    create policy farvision_contacts_staff_all on cust.farvision_contacts for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

-- project_photos: visible to any customer holding a unit in that project. Always shown (no gate).
do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.project_photos'::regclass and polname='project_photos_customer_select') then
    create policy project_photos_customer_select on cust.project_photos for select
      using (deleted_at is null and exists(
        select 1 from cust.units u where u.project_id = cust.project_photos.project_id
          and u.customer_id = app.current_customer_id() and u.deleted_at is null));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.project_photos'::regclass and polname='project_photos_staff_all') then
    create policy project_photos_staff_all on cust.project_photos for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

-- unit_photos: THE floor-casting gate. Enforced here, in the database - not only hidden in the UI.
do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.unit_photos'::regclass and polname='unit_photos_customer_select') then
    create policy unit_photos_customer_select on cust.unit_photos for select
      using (deleted_at is null and exists(
        select 1 from cust.units u where u.id = cust.unit_photos.unit_id
          and u.customer_id = app.current_customer_id() and u.deleted_at is null
          and u.floor_casting_completed_at is not null));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.unit_photos'::regclass and polname='unit_photos_staff_all') then
    create policy unit_photos_staff_all on cust.unit_photos for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

-- project_documents: brochure/legal - visible to any customer holding a unit in that project.
do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.project_documents'::regclass and polname='project_documents_customer_select') then
    create policy project_documents_customer_select on cust.project_documents for select
      using (deleted_at is null and exists(
        select 1 from cust.units u where u.project_id = cust.project_documents.project_id
          and u.customer_id = app.current_customer_id() and u.deleted_at is null));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.project_documents'::regclass and polname='project_documents_staff_all') then
    create policy project_documents_staff_all on cust.project_documents for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

-- customer_documents: celebration photo/video, draft agreement, possession letter - unit-scoped.
do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.customer_documents'::regclass and polname='customer_documents_customer_select') then
    create policy customer_documents_customer_select on cust.customer_documents for select
      using (deleted_at is null and exists(
        select 1 from cust.units u where u.id = cust.customer_documents.unit_id
          and u.customer_id = app.current_customer_id() and u.deleted_at is null));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.customer_documents'::regclass and polname='customer_documents_staff_all') then
    create policy customer_documents_staff_all on cust.customer_documents for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

grant select, insert, update, delete on all tables in schema cust to authenticated, service_role;
alter default privileges in schema cust grant select, insert, update, delete on tables to authenticated, service_role;
-- Every id column here is bigserial, so every insert needs nextval() on its sequence - granting the
-- tables alone isn't enough (this was missed initially; caught only once a real insert was attempted).
grant usage, select on all sequences in schema cust to authenticated, service_role;
alter default privileges in schema cust grant usage, select on sequences to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Undo a bad import. Soft-deletes everything the batch wrote and, for the two
--    "supersede on re-import" types, restores whatever was current immediately before.
-- ---------------------------------------------------------------------------
create or replace function cust.undo_import_batch(p_batch_id bigint) returns void
 language plpgsql security definer set search_path = cust, public
as $$
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
  elsif v_batch.import_type = 'cost_sheet' then
    -- Undo this batch's rows, then restore whatever was current right before this batch ran -
    -- the newest surviving row per unit older than this batch's import time.
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
grant execute on function cust.undo_import_batch(bigint) to authenticated;

commit;
