-- Customer Portal: which sections a customer sees, controlled by staff per project and per block.
--
-- One row = one decision about one section (feature) at one level:
--   project_id null,  tower null   -> the default for every project
--   project_id set,   tower null   -> that whole project
--   project_id set,   tower set    -> one block of that project
-- The most specific row wins (block, then project, then the default). A level with no row simply
-- follows the level above it. Customer Portal Admin > Customer Features writes these; the customer
-- portal reads them to decide which sections to list for the flat being viewed.
--
-- Home is not a feature here: it is the landing page and is always shown.

create table if not exists cust.feature_access(
  id bigserial primary key,
  feature text not null check (feature in ('statement','progress','ledger','cost_sheet','inspection',
    'documents','videos','support','amenities','submeter','referrals','maintenance','modifications')),
  project_id bigint references cust.projects(id),
  tower text,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  check (tower is null or project_id is not null)
);
create unique index if not exists feature_access_uq
  on cust.feature_access(feature, coalesce(project_id, 0), coalesce(tower, ''));

alter table cust.feature_access enable row level security;
-- What is switched on is not sensitive, and every customer needs to read it for their own flats.
drop policy if exists feature_access_read on cust.feature_access;
create policy feature_access_read on cust.feature_access for select to authenticated using (true);
drop policy if exists feature_access_staff_all on cust.feature_access;
create policy feature_access_staff_all on cust.feature_access for all to authenticated
  using (app.is_custportal_staff()) with check (app.is_custportal_staff());
grant select, insert, update, delete on cust.feature_access to authenticated;
grant usage, select on sequence cust.feature_access_id_seq to authenticated;

-- Launch defaults (Dream Gurukul going live, 30 Sep 2026). On: the four sections that are finished
-- and carry real Farvision data. Off until staff switch them on: sections that are unfinished
-- (Inspection and Documents have no way to list or delete an upload; Referrals has no reward or
-- sales hand-off; a confirmed Maintenance payment does not reduce the balance; Amenities shows
-- other flats' bookings) or that nothing feeds yet (no process videos, no project manager assigned
-- for Modification Requests, Support depends on the Zoho Desk link, Sub-meter not yet in use).
insert into cust.feature_access(feature, project_id, tower, enabled, updated_by)
select f, null, null, f in ('statement','progress','ledger','cost_sheet'), 'launch default'
  from unnest(array['statement','progress','ledger','cost_sheet','inspection','documents','videos',
                    'support','amenities','submeter','referrals','maintenance','modifications']) f
on conflict do nothing;
