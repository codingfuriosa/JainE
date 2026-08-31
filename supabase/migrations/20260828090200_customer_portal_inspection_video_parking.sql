-- Customer Portal, increment 2: process-explainer videos (company-wide), a per-unit inspection
-- checklist with its own dated photo/video update trail, and a new downloadable document type
-- (parking allotment letter). Builds on 20260828090000_customer_portal_schema.sql — same schema,
-- same RLS conventions (customer-scoped select via unit ownership, staff_all for writes; never the
-- `using(true)` pattern the pre-customer-portal parts of this app used).

begin;

-- ---------------------------------------------------------------------------
-- 1. Parking allotment letter — one more customer_documents.doc_type value.
--    The check constraint is found dynamically (not by a guessed default name) so this is safe to
--    re-run even if Postgres named it differently than expected.
-- ---------------------------------------------------------------------------
do $$
declare cname text;
begin
  select conname into cname from pg_constraint
    where conrelid = 'cust.customer_documents'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%doc_type%';
  if cname is not null then
    execute format('alter table cust.customer_documents drop constraint %I', cname);
  end if;
end $$;
alter table cust.customer_documents add constraint customer_documents_doc_type_check
  check (doc_type in ('celebration_photo','celebration_video','draft_agreement','possession_letter','parking_allotment'));

-- ---------------------------------------------------------------------------
-- 2. Process-explainer videos — company-wide, not project- or unit-scoped: every customer sees the
--    same Registry / Agreement / Nomination walkthroughs regardless of which project they're in.
-- ---------------------------------------------------------------------------
create table if not exists cust.process_videos(
  id           bigserial primary key,
  category     text not null check (category in ('registry','agreement','nomination')),
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
create index if not exists process_videos_category_idx on cust.process_videos (category, created_at desc) where deleted_at is null;
comment on table cust.process_videos is
  'Company-wide explainer videos (Registry/Agreement/Nomination process). Not scoped to a project or '
  'unit - every customer sees the same set, unlike project_documents/customer_documents.';

alter table cust.process_videos enable row level security;
do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.process_videos'::regclass and polname='process_videos_read') then
    -- Deliberately app.is_customer() OR app.is_custportal_staff(), not `using(true)` — every
    -- customer may see these (they're company-wide, not gated by owning a specific unit), but a
    -- stray authenticated account that is neither a customer nor custportal staff still gets nothing.
    create policy process_videos_read on cust.process_videos for select
      using (app.is_customer() or app.is_custportal_staff());
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.process_videos'::regclass and polname='process_videos_staff_all') then
    create policy process_videos_staff_all on cust.process_videos for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

-- ---------------------------------------------------------------------------
-- 3. Inspection checklist — one current checklist photo/scan per unit (re-uploading replaces it,
--    same "supersede" shape as cost_sheet_items/farvision_contacts), plus a separate dated gallery
--    of photo-OR-video updates against it (same shape as unit_photos, but not photo-only).
-- ---------------------------------------------------------------------------
create table if not exists cust.inspection_checklists(
  id           bigserial primary key,
  unit_id      bigint not null references cust.units(id),
  storage_path text not null,
  file_name    text,
  file_size    bigint,
  file_type    text,
  uploaded_by  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists inspection_checklists_unit_uq on cust.inspection_checklists (unit_id);
comment on table cust.inspection_checklists is
  'One row per unit - re-uploading replaces storage_path/file_name in place rather than adding a new '
  'row, since only the current checklist matters. Progress against it lives in inspection_updates.';

create table if not exists cust.inspection_updates(
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
create index if not exists inspection_updates_unit_idx on cust.inspection_updates (unit_id, taken_on desc) where deleted_at is null;

alter table cust.inspection_checklists enable row level security;
alter table cust.inspection_updates enable row level security;

do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.inspection_checklists'::regclass and polname='inspection_checklists_customer_select') then
    create policy inspection_checklists_customer_select on cust.inspection_checklists for select
      using (exists(select 1 from cust.units u where u.id = cust.inspection_checklists.unit_id
                     and u.customer_id = app.current_customer_id() and u.deleted_at is null));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.inspection_checklists'::regclass and polname='inspection_checklists_staff_all') then
    create policy inspection_checklists_staff_all on cust.inspection_checklists for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.inspection_updates'::regclass and polname='inspection_updates_customer_select') then
    create policy inspection_updates_customer_select on cust.inspection_updates for select
      using (deleted_at is null and exists(
        select 1 from cust.units u where u.id = cust.inspection_updates.unit_id
          and u.customer_id = app.current_customer_id() and u.deleted_at is null));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.inspection_updates'::regclass and polname='inspection_updates_staff_all') then
    create policy inspection_updates_staff_all on cust.inspection_updates for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

grant select, insert, update, delete on cust.process_videos, cust.inspection_checklists, cust.inspection_updates
  to authenticated, service_role;

commit;
