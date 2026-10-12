-- Customer Portal: floor-wise and tower/block-wise construction media, sitting between the
-- existing project-wide (cust.project_photos, every customer in the project) and per-flat
-- (cust.unit_photos, gated on floor_casting_completed_at) levels. A floor update is visible to
-- every customer whose unit sits on that floor, regardless of tower; a tower update is visible
-- to every customer whose unit sits in that tower, regardless of floor.
--
-- "Floor" is not a reliably populated column (cust.units.floor_no is null for all but one of the
-- 146 imported units) - but every real unit_code in this project follows Farvision's own
-- <floor><unit-letter> convention (e.g. "5A" = floor 5, unit A; "12C" = floor 12, unit C), so the
-- floor is derived from the leading digits of unit_code, not guessed or separately entered. The
-- same derivation is used everywhere a floor is compared: the RLS policy below, the admin
-- upload-dropdown floor list, and the customer-portal query for "my floor's" updates.

create table if not exists cust.floor_photos(
  id           bigserial primary key,
  project_id   bigint not null references cust.projects(id),
  floor_no     text not null,
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
create index if not exists floor_photos_scope_idx on cust.floor_photos (project_id, floor_no, taken_on desc) where deleted_at is null;
comment on column cust.floor_photos.floor_no is
  'Leading-digit floor number derived from unit_code (e.g. "5" for "5A") - matched the same way '
  'on the customer read side (substring(unit_code from ''^[0-9]+'')), not a separately-entered value.';

create table if not exists cust.tower_photos(
  id           bigserial primary key,
  project_id   bigint not null references cust.projects(id),
  tower        text not null,
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
create index if not exists tower_photos_scope_idx on cust.tower_photos (project_id, tower, taken_on desc) where deleted_at is null;

alter table cust.floor_photos enable row level security;
alter table cust.tower_photos enable row level security;

do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.floor_photos'::regclass and polname='floor_photos_customer_select') then
    create policy floor_photos_customer_select on cust.floor_photos for select
      using (deleted_at is null and exists(
        select 1 from cust.units u where u.project_id = cust.floor_photos.project_id
          and u.customer_id = app.current_customer_id() and u.deleted_at is null
          and substring(u.unit_code from '^[0-9]+') = cust.floor_photos.floor_no));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.floor_photos'::regclass and polname='floor_photos_staff_all') then
    create policy floor_photos_staff_all on cust.floor_photos for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.tower_photos'::regclass and polname='tower_photos_customer_select') then
    create policy tower_photos_customer_select on cust.tower_photos for select
      using (deleted_at is null and exists(
        select 1 from cust.units u where u.project_id = cust.tower_photos.project_id
          and u.customer_id = app.current_customer_id() and u.deleted_at is null
          and u.tower = cust.tower_photos.tower));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.tower_photos'::regclass and polname='tower_photos_staff_all') then
    create policy tower_photos_staff_all on cust.tower_photos for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

grant select, insert, update, delete on cust.floor_photos, cust.tower_photos to authenticated;
grant usage, select on cust.floor_photos_id_seq, cust.tower_photos_id_seq to authenticated;
