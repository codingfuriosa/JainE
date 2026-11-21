-- RECKONER (21 Nov 2026, Ayush - "JAINE - RECKONER MODULE"; plan: Claude outputs/Reckoner/Reckoner plan.md).
-- One project = one structured profile = one source of truth. Schema rk, every record linked by project_id, UUID keys.
--
-- HOW CHANGES WORK. Nobody writes the record tables directly (no insert/update/delete grants). A change is PROPOSED with
-- rk.propose(...) and lands in rk.changes as 'pending'; the record keeps its last approved value meanwhile. An approver
-- (super admin, or rk.roles 'sales_head' / 'project_admin') calls rk.review(id, approve, remarks): approve writes the new
-- values into the record (or creates / archives it) and marks it Verified; reject leaves the record as it was. rk.changes
-- is also the audit log - nobody can update or delete it except through rk.review.
--
-- WHO. Menu: module 'reckoner' (or super admin, or a row in rk.roles). Read: everyone with Reckoner (Sales see internal
-- guidance too - Ayush 21 Nov). Propose: super admin + sales_head / project_admin / project_manager (project_manager and
-- project_admin only for projects they are assigned to). Approve: super admin + sales_head / project_admin.
--
-- INVENTORY. rk.units lists units entered in Reckoner; a unit that Farvision has booked (cust.units with a booking no.)
-- is never shown (rk.units_free) - Ayush: show only free units.

create schema if not exists rk;
grant usage on schema rk to authenticated, service_role;

-- ---------------------------------------------------------------- who
create table if not exists rk.roles (
  email text primary key,
  role  text not null check (role in ('sales_head','project_admin','project_manager','viewer')),
  added_by text, added_at timestamptz not null default now()
);
create or replace function rk.my_role() returns text language sql stable security definer set search_path = '' as $$
  select case when app.is_superadmin() then 'super' else (select r.role from rk.roles r where lower(r.email) = lower(app.current_user_email())) end $$;
create or replace function rk.can_view() returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_superadmin() or app.has_module('reckoner') or exists (select 1 from rk.roles r where lower(r.email) = lower(app.current_user_email())) $$;
create or replace function rk.can_approve() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(rk.my_role() in ('super','sales_head','project_admin'), false) $$;

-- ---------------------------------------------------------------- projects
create table if not exists rk.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null, code text unique,
  category text,               -- Residential Apartments, Bungalows / Row Houses, Commercial, ... (configurable: rk.lists)
  status text,                 -- New Launch, Soft Launch, Under Construction, Ready to Move, Sold Out, On Hold
  stage text,                  -- development stage, free text
  city text, locality text,
  developer text,
  land_area text,              -- as stated ("5.12 Acres", "100 Katha")
  towers text, height text, total_units integer, open_space text,
  launch_date date, possession_date date, possession_note text,
  rera_no text, rera_note text,
  description text,
  fv_project_ids bigint[],     -- Farvision's cust.projects ids (Dream One is two there), for hiding booked units
  archived boolean not null default false,
  -- verification (every record table has these)
  vstatus text not null default 'pending' check (vstatus in ('verified','pending','outdated','rejected','na')),
  entered_by text, entered_at timestamptz not null default now(), updated_by text, updated_at timestamptz not null default now(),
  verified_by text, verified_at timestamptz, effective_from date, valid_until date, source text, remarks text
);
create table if not exists rk.lists (           -- configurable pick lists (project categories, amenity categories, ...)
  list text not null, value text not null, sort int not null default 0, primary key (list, value)
);

create table if not exists rk.locations (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references rk.projects(id),
  address text, pin text, maps_url text, lat numeric, lng numeric, directions text,
  vstatus text not null default 'pending' check (vstatus in ('verified','pending','outdated','rejected','na')), entered_by text, entered_at timestamptz not null default now(), updated_by text, updated_at timestamptz not null default now(), verified_by text, verified_at timestamptz, effective_from date, valid_until date, source text, remarks text, archived boolean not null default false);
create table if not exists rk.configurations (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references rk.projects(id),
  name text not null, kind text, bedrooms numeric, bathrooms numeric, balconies numeric,
  sba_min numeric, sba_max numeric, built_up numeric, carpet numeric, area_note text,
  floors text, facing text, room_sizes text, features text, floor_plan_doc uuid, sort int not null default 0,
  vstatus text not null default 'pending' check (vstatus in ('verified','pending','outdated','rejected','na')), entered_by text, entered_at timestamptz not null default now(), updated_by text, updated_at timestamptz not null default now(), verified_by text, verified_at timestamptz, effective_from date, valid_until date, source text, remarks text, archived boolean not null default false);
create table if not exists rk.charges (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references rk.projects(id),
  configuration_id uuid references rk.configurations(id),
  name text not null,
  kind text not null check (kind in ('base_rate','unit_price','edc','idc','gst','parking','frc','plc','club','maintenance','registration','other')),
  amount numeric, unit text check (unit in ('per_sqft','lump_sum','percent')), note text,
  in_base boolean, in_final boolean, gst_included boolean, edc_included boolean, parking_included boolean,
  confirmed boolean not null default false,       -- false = indicative
  internal boolean not null default false,        -- e.g. a base rate marked "do not pitch"
  sort int not null default 0,
  vstatus text not null default 'pending' check (vstatus in ('verified','pending','outdated','rejected','na')), entered_by text, entered_at timestamptz not null default now(), updated_by text, updated_at timestamptz not null default now(), verified_by text, verified_at timestamptz, effective_from date, valid_until date, source text, remarks text, archived boolean not null default false);
create table if not exists rk.payment_plans (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references rk.projects(id),
  stage text not null, percent numeric, amount numeric, note text, sort int not null default 0,
  vstatus text not null default 'pending' check (vstatus in ('verified','pending','outdated','rejected','na')), entered_by text, entered_at timestamptz not null default now(), updated_by text, updated_at timestamptz not null default now(), verified_by text, verified_at timestamptz, effective_from date, valid_until date, source text, remarks text, archived boolean not null default false);
create table if not exists rk.offers (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references rk.projects(id),
  title text not null, details text, internal boolean not null default false,
  vstatus text not null default 'pending' check (vstatus in ('verified','pending','outdated','rejected','na')), entered_by text, entered_at timestamptz not null default now(), updated_by text, updated_at timestamptz not null default now(), verified_by text, verified_at timestamptz, effective_from date, valid_until date, source text, remarks text, archived boolean not null default false);
create table if not exists rk.units (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references rk.projects(id),
  configuration_id uuid references rk.configurations(id),
  unit_no text not null, tower text, floor text, area numeric, facing text, view text,
  base_price numeric, extra_charges numeric, quoted_price numeric,
  status text not null default 'Available' check (status in ('Available','On Hold','Booked','Sold','Blocked','Under Verification')),
  booking_date date, note text,
  vstatus text not null default 'pending' check (vstatus in ('verified','pending','outdated','rejected','na')), entered_by text, entered_at timestamptz not null default now(), updated_by text, updated_at timestamptz not null default now(), verified_by text, verified_at timestamptz, effective_from date, valid_until date, source text, remarks text, archived boolean not null default false);
create table if not exists rk.unit_status_history (
  id bigserial primary key, unit_id uuid not null references rk.units(id), old_status text, new_status text, changed_by text, changed_at timestamptz not null default now(), change_id bigint);
create table if not exists rk.amenities (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references rk.projects(id),
  name text not null, category text, description text, status text, place text, image_doc uuid, sort int not null default 0,
  vstatus text not null default 'pending' check (vstatus in ('verified','pending','outdated','rejected','na')), entered_by text, entered_at timestamptz not null default now(), updated_by text, updated_at timestamptz not null default now(), verified_by text, verified_at timestamptz, effective_from date, valid_until date, source text, remarks text, archived boolean not null default false);
create table if not exists rk.landmarks (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references rk.projects(id),
  name text not null, category text, distance_km numeric, travel_min numeric, travel_note text, sort int not null default 0,
  vstatus text not null default 'pending' check (vstatus in ('verified','pending','outdated','rejected','na')), entered_by text, entered_at timestamptz not null default now(), updated_by text, updated_at timestamptz not null default now(), verified_by text, verified_at timestamptz, effective_from date, valid_until date, source text, remarks text, archived boolean not null default false);
create table if not exists rk.sales_notes (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references rk.projects(id),
  kind text not null check (kind in ('usp','selling_point','target_customer','differentiator','booking_procedure','faq','guideline','do_not_promise','pitch','other')),
  title text, body text not null, internal boolean not null default false, sort int not null default 0,
  vstatus text not null default 'pending' check (vstatus in ('verified','pending','outdated','rejected','na')), entered_by text, entered_at timestamptz not null default now(), updated_by text, updated_at timestamptz not null default now(), verified_by text, verified_at timestamptz, effective_from date, valid_until date, source text, remarks text, archived boolean not null default false);
create table if not exists rk.bank_approvals (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references rk.projects(id),
  bank text not null, status text, reference text,
  vstatus text not null default 'pending' check (vstatus in ('verified','pending','outdated','rejected','na')), entered_by text, entered_at timestamptz not null default now(), updated_by text, updated_at timestamptz not null default now(), verified_by text, verified_at timestamptz, effective_from date, valid_until date, source text, remarks text, archived boolean not null default false);
create table if not exists rk.documents (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references rk.projects(id),
  category text not null, title text not null, version text, s3_key text, file_name text, mime text, size_bytes bigint, internal boolean not null default false,
  vstatus text not null default 'pending' check (vstatus in ('verified','pending','outdated','rejected','na')), entered_by text, entered_at timestamptz not null default now(), updated_by text, updated_at timestamptz not null default now(), verified_by text, verified_at timestamptz, effective_from date, valid_until date, source text, remarks text, archived boolean not null default false);
create table if not exists rk.assignments (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references rk.projects(id),
  email text, name text, role text not null check (role in ('project_manager','sales_executive','project_admin')),
  vstatus text not null default 'verified' check (vstatus in ('verified','pending','outdated','rejected','na')), entered_by text, entered_at timestamptz not null default now(), updated_by text, updated_at timestamptz not null default now(), verified_by text, verified_at timestamptz, effective_from date, valid_until date, source text, remarks text, archived boolean not null default false);

-- the audit log and change queue
create table if not exists rk.changes (
  id bigserial primary key,
  project_id uuid, tbl text not null, record_id uuid,
  op text not null check (op in ('insert','update','archive')),
  payload jsonb not null default '{}'::jsonb,        -- the new values
  previous jsonb,                                    -- the values they replace (update / archive)
  reason text, source text, batch text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  proposed_by text not null, proposed_at timestamptz not null default now(),
  reviewed_by text, reviewed_at timestamptz, review_remarks text
);
create index if not exists rk_changes_pending on rk.changes (status, project_id);
create index if not exists rk_changes_record on rk.changes (record_id);

-- indexes on project_id
do $$ declare t text; begin
  foreach t in array array['locations','configurations','charges','payment_plans','offers','units','amenities','landmarks','sales_notes','bank_approvals','documents','assignments'] loop
    execute format('create index if not exists rk_%s_project on rk.%I (project_id)', t, t);
  end loop; end $$;

-- ---------------------------------------------------------------- read access (RLS) - nothing can be written directly
do $$ declare t text; begin
  foreach t in array array['projects','lists','locations','configurations','charges','payment_plans','offers','units','unit_status_history','amenities','landmarks','sales_notes','bank_approvals','documents','assignments','changes','roles'] loop
    execute format('alter table rk.%I enable row level security', t);
    execute format('drop policy if exists rk_read on rk.%I', t);
    execute format('create policy rk_read on rk.%I for select to authenticated using (rk.can_view())', t);
    execute format('grant select on rk.%I to authenticated', t);
    execute format('grant all on rk.%I to service_role', t);
  end loop; end $$;
grant usage, select on all sequences in schema rk to service_role;
drop policy if exists rk_read on rk.changes;
create policy rk_read on rk.changes for select to authenticated
  using (rk.can_view() and (rk.my_role() in ('super','sales_head','project_admin','project_manager') or lower(proposed_by) = lower(app.current_user_email())));

-- assigned to this project (project_manager / project_admin may only propose for their projects)
create or replace function rk.assigned(p uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from rk.assignments a where a.project_id = p and not a.archived and lower(a.email) = lower(app.current_user_email())) $$;
create or replace function rk.can_propose(p uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select case rk.my_role() when 'super' then true when 'sales_head' then true
    when 'project_admin' then p is null or rk.assigned(p) when 'project_manager' then p is not null and rk.assigned(p) else false end $$;

-- ---------------------------------------------------------------- propose a change
-- p_tbl: one of the record tables; p_record: the record (null for a new one); p_op: insert / update / archive;
-- p_payload: column -> new value (only the record's own business columns are taken; verification columns are set here)
create or replace function rk.propose(p_tbl text, p_record uuid, p_op text, p_payload jsonb, p_reason text default null, p_source text default null, p_project uuid default null, p_batch text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_project uuid := p_project; v_prev jsonb; v_id bigint; v_me text := lower(app.current_user_email()); v_cols text[];
begin
  if p_tbl not in ('projects','locations','configurations','charges','payment_plans','offers','units','amenities','landmarks','sales_notes','bank_approvals','documents','assignments') then
    raise exception 'unknown table %', p_tbl; end if;
  if p_op not in ('insert','update','archive') then raise exception 'unknown change %', p_op; end if;
  if p_record is not null then
    execute format('select to_jsonb(x) from rk.%I x where x.id = $1', p_tbl) into v_prev using p_record;
    if v_prev is null then raise exception 'record not found'; end if;
    if p_tbl = 'projects' then v_project := p_record; else v_project := (v_prev->>'project_id')::uuid; end if;
  elsif p_tbl = 'projects' then v_project := null;
  else v_project := coalesce(v_project, (p_payload->>'project_id')::uuid); end if;
  if not rk.can_propose(v_project) then raise exception 'You cannot change this project''s information.'; end if;
  -- only the table's own columns, never the verification / audit columns
  select array_agg(column_name::text) into v_cols from information_schema.columns
   where table_schema = 'rk' and table_name = p_tbl
     and column_name not in ('id','vstatus','entered_by','entered_at','updated_by','updated_at','verified_by','verified_at','archived');
  insert into rk.changes (project_id, tbl, record_id, op, payload, previous, reason, source, batch, proposed_by)
  values (v_project, p_tbl, p_record, p_op,
          (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(coalesce(p_payload, '{}'::jsonb)) e(k, v) where k = any(v_cols)),
          case when v_prev is null then null else (select jsonb_object_agg(k, v_prev->k) from jsonb_object_keys(coalesce(p_payload, '{}'::jsonb)) k where k = any(v_cols)) end,
          p_reason, p_source, p_batch, v_me)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- approve / reject
create or replace function rk.review(p_id bigint, p_approve boolean, p_remarks text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c record; v_me text := lower(app.current_user_email()); v_new uuid; v_set text; v_cols text; v_vals text; v_old text;
begin
  if not rk.can_approve() then raise exception 'Only approvers can approve or reject.'; end if;
  select * into c from rk.changes where id = p_id for update;
  if c.id is null or c.status <> 'pending' then raise exception 'This change is no longer pending.'; end if;
  if not p_approve then
    update rk.changes set status = 'rejected', reviewed_by = v_me, reviewed_at = now(), review_remarks = p_remarks where id = p_id;
    return c.record_id;
  end if;
  if c.op = 'insert' then
    select string_agg(quote_ident(k), ','), string_agg(format('(jsonb_populate_record(null::rk.%I, $1)).%I', c.tbl, k), ',')
      into v_cols, v_vals from jsonb_object_keys(c.payload) k where k <> 'source';
    execute format('insert into rk.%I (%s source, vstatus, entered_by, updated_by, verified_by, verified_at) values (%s $4, ''verified'', $2, $2, $3, now()) returning id',
                   c.tbl, coalesce(v_cols || ',', ''), coalesce(v_vals || ',', ''))
      into v_new using c.payload, c.proposed_by, v_me, coalesce(c.payload->>'source', c.source);
  elsif c.op = 'update' then
    select string_agg(format('%I = (jsonb_populate_record(t, $1)).%I', k, k), ', ') into v_set from jsonb_object_keys(c.payload) k;
    if v_set is null then raise exception 'Nothing to change.'; end if;
    if c.tbl = 'units' and c.payload ? 'status' then
      execute 'select status from rk.units where id = $1' into v_old using c.record_id; end if;
    execute format('update rk.%I t set %s, vstatus = ''verified'', updated_by = $2, updated_at = now(), verified_by = $3, verified_at = now() where t.id = $4',
                   c.tbl, v_set) using c.payload, c.proposed_by, v_me, c.record_id;
    v_new := c.record_id;
    if c.tbl = 'units' and c.payload ? 'status' and v_old is distinct from c.payload->>'status' then
      insert into rk.unit_status_history (unit_id, old_status, new_status, changed_by, change_id) values (c.record_id, v_old, c.payload->>'status', c.proposed_by, c.id); end if;
  else
    execute format('update rk.%I set archived = true, updated_by = $1, updated_at = now() where id = $2', c.tbl) using c.proposed_by, c.record_id;
    v_new := c.record_id;
  end if;
  update rk.changes set status = 'approved', reviewed_by = v_me, reviewed_at = now(), review_remarks = p_remarks,
         record_id = coalesce(record_id, v_new) where id = p_id;
  return v_new;
end $$;

-- withdraw your own pending change
create or replace function rk.withdraw(p_id bigint) returns void language sql security definer set search_path = '' as $$
  update rk.changes set status = 'withdrawn', reviewed_at = now() where id = p_id and status = 'pending' and lower(proposed_by) = lower(app.current_user_email()) $$;

-- roles are managed by super admins
create or replace function rk.set_role(p_email text, p_role text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_superadmin() then raise exception 'Only super admins manage Reckoner roles.'; end if;
  if p_role is null then delete from rk.roles where lower(email) = lower(p_email);
  else insert into rk.roles (email, role, added_by) values (lower(p_email), p_role, lower(app.current_user_email()))
       on conflict (email) do update set role = excluded.role, added_by = excluded.added_by, added_at = now(); end if;
end $$;

-- verification status of a record changes without a value change (e.g. mark Outdated): approvers only
create or replace function rk.set_vstatus(p_tbl text, p_id uuid, p_status text, p_remarks text default null) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not rk.can_approve() then raise exception 'Only approvers can change a verification status.'; end if;
  if p_status not in ('verified','pending','outdated','rejected','na') then raise exception 'unknown status'; end if;
  execute format('update rk.%I set vstatus = $1, verified_by = case when $1 = ''verified'' then $2 else verified_by end, verified_at = case when $1 = ''verified'' then now() else verified_at end, remarks = coalesce($3, remarks), updated_at = now() where id = $4', p_tbl)
    using p_status, lower(app.current_user_email()), p_remarks, p_id;
  insert into rk.changes (project_id, tbl, record_id, op, payload, status, proposed_by, reviewed_by, reviewed_at, review_remarks)
  select case when p_tbl = 'projects' then p_id else null end, p_tbl, p_id, 'update', jsonb_build_object('vstatus', p_status), 'approved', lower(app.current_user_email()), lower(app.current_user_email()), now(), p_remarks;
end $$;

-- units Farvision has booked are never shown (Ayush: only free units)
create or replace function rk.unit_booked(p_project uuid, p_unit text, p_tower text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from rk.projects p join cust.units u on u.project_id = any(p.fv_project_ids)
                 where p.id = p_project and u.deleted_at is null and u.booking_no is not null
                   and upper(trim(u.unit_code)) = upper(trim(p_unit))
                   and (p_tower is null or u.tower is null or upper(regexp_replace(u.tower, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(p_tower, '[^A-Za-z0-9]', '', 'g')))) $$;
create or replace view rk.units_free with (security_invoker = true) as
  select u.* from rk.units u where not u.archived and u.status in ('Available','On Hold','Under Verification') and not rk.unit_booked(u.project_id, u.unit_no, u.tower);
grant select on rk.units_free to authenticated;

revoke all on function rk.propose(text,uuid,text,jsonb,text,text,uuid,text), rk.review(bigint,boolean,text), rk.withdraw(bigint), rk.set_role(text,text), rk.set_vstatus(text,uuid,text,text) from public, anon;
grant execute on function rk.propose(text,uuid,text,jsonb,text,text,uuid,text), rk.review(bigint,boolean,text), rk.withdraw(bigint), rk.set_role(text,text), rk.set_vstatus(text,uuid,text,text),
  rk.my_role(), rk.can_view(), rk.can_approve(), rk.can_propose(uuid), rk.assigned(uuid), rk.unit_booked(uuid,text,text) to authenticated;

-- pick lists
insert into rk.lists (list, value, sort) values
 ('category','Residential Apartments',1),('category','Bungalows / Row Houses',2),('category','Commercial',3),('category','Mixed Use',4),
 ('status','New Launch',1),('status','Soft Launch',2),('status','Under Construction',3),('status','Ready to Move',4),('status','Sold Out',5),('status','On Hold',6),
 ('amenity','Sports and Fitness',1),('amenity','Recreation',2),('amenity','Children''s Facilities',3),('amenity','Senior Citizen Facilities',4),('amenity','Community Spaces',5),('amenity','Safety and Security',6),('amenity','Utilities and Infrastructure',7),('amenity','Green Spaces',8),
 ('landmark','School',1),('landmark','Hospital',2),('landmark','Shopping',3),('landmark','Dining',4),('landmark','Metro Station',5),('landmark','Railway Station',6),('landmark','Highway',7),('landmark','Airport',8),('landmark','Landmark',9),
 ('document','Brochure',1),('document','RERA',2),('document','Approved Floor Plan',3),('document','Cost Sheet',4),('document','Payment Plan',5),('document','Amenities Layout',6),('document','Specifications',7),('document','Bank Approval',8),('document','Original Reckoner Sheet',9),('document','Other',10)
on conflict do nothing;

-- approvers named by Ayush 21 Nov 2026 (Dipanwita Chatterjee to be added once she has a JAIN-E login)
insert into rk.roles (email, role, added_by) values
 ('mgr.sales@thejaingroup.com','sales_head','ayushruia1@gmail.com'),
 ('agm.sales@thejaingroup.com','sales_head','ayushruia1@gmail.com'),
 ('sm.sales2@thejaingroup.com','sales_head','ayushruia1@gmail.com')
on conflict (email) do nothing;

-- expose the schema to the API
alter role authenticator set pgrst.db_schemas = 'public,graphql_public,acc,adm,doc,hr,crm,proj,comp,kraya,rec,fin,inv,ast,con,cmp,sup,bud,recruit,camp,postsales,cust,app,feedback,purchase,eng,accounts,rk';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
