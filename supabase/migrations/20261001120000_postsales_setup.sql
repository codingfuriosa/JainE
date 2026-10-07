-- Post Sales, Stage 1: inventory and pricing setup. See docs/post-sales-spec.md section 1.
--
-- Project -> Towers -> Floors -> Flats, plus everything a booking's cost sheet and payment plan are
-- built from: PLC types (tagged on a tower's flat POSITION, so every "C" flat on every floor of that
-- tower carries the same PLCs), a per-tower floor rise (FRC), the project's other charges (EDC etc.),
-- parking types, construction stages and standard payment plans.
--
-- Deliberately new tables only - nothing here alters a cust.* table the live Customer Portal reads.
-- A cust.units row is really one BOOKING of a flat (a cancelled booking and its re-booking are two
-- rows for the same flat, see units_project_tower_code_active_uq), so the physical flat is its own
-- row here, and bookings link to it in a later stage.
--
-- All per-sq-ft rates are applied to the flat's SUPER BUILT-UP area. Rates are copied onto a booking
-- when it is made, so editing anything here only affects flats booked afterwards.

create schema if not exists postsales;

-- ---------------------------------------------------------------------------
-- Project-level settings (one row per cust.projects row that has been set up)
-- ---------------------------------------------------------------------------
create table if not exists postsales.project_setup(
  project_id         bigint primary key references cust.projects(id),
  code               text not null,
  unit_gst_rate      numeric(5,2) not null default 5,
  plc_gst_rate       numeric(5,2) not null default 5,
  frc_gst_rate       numeric(5,2) not null default 5,
  created_at         timestamptz not null default now(),
  created_by         text default app.current_user_email(),
  updated_at         timestamptz not null default now(),
  updated_by         text default app.current_user_email()
);
create unique index if not exists project_setup_code_uq on postsales.project_setup (upper(code));
comment on column postsales.project_setup.code is
  'Short code used in every document number of this project, e.g. DG -> DG/MR/26-27/0001.';

-- ---------------------------------------------------------------------------
-- Towers, their flat positions (the typical-floor layout), floors and flats
-- ---------------------------------------------------------------------------
create table if not exists postsales.towers(
  id                 bigserial primary key,
  project_id         bigint not null references cust.projects(id),
  name               text not null,
  portal_tower       text,
  floor_from         int not null default 1,
  floor_to           int not null default 1,
  base_rate          numeric(12,2),
  frc_rate           numeric(12,2) not null default 0,
  frc_start_floor    int,
  sort_order         int not null default 0,
  created_at         timestamptz not null default now(),
  created_by         text default app.current_user_email(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  deleted_by         text,
  check (floor_to >= floor_from)
);
create unique index if not exists towers_project_name_uq on postsales.towers (project_id, lower(name)) where deleted_at is null;
comment on column postsales.towers.portal_tower is
  'The tower text the Farvision-imported cust.units rows carry for this tower (e.g. "BLOCK A1"), used '
  'to match existing bookings to flats here.';
comment on column postsales.towers.base_rate is
  'List rate per sq ft of super built-up area. Only a default/indicator - the actual rate is entered at booking.';
comment on column postsales.towers.frc_rate is
  'Floor rise per sq ft per floor: floor f pays max(0, f - frc_start_floor + 1) * frc_rate per sq ft.';

create table if not exists postsales.tower_positions(
  id                 bigserial primary key,
  tower_id           bigint not null references postsales.towers(id) on delete cascade,
  code               text not null,
  bhk                text,
  sba_sqft           numeric(10,2),
  built_up_sqft      numeric(10,2),
  carpet_sqft        numeric(10,2),
  sort_order         int not null default 0,
  created_at         timestamptz not null default now()
);
create unique index if not exists tower_positions_code_uq on postsales.tower_positions (tower_id, upper(code));
comment on table postsales.tower_positions is
  'A flat position on a typical floor of one tower (A, B, C ...). PLC types are tagged here, never per flat.';

create table if not exists postsales.plc_types(
  id                 bigserial primary key,
  project_id         bigint not null references cust.projects(id),
  name               text not null,
  rate               numeric(12,2) not null default 0,
  sort_order         int not null default 0,
  created_at         timestamptz not null default now(),
  created_by         text default app.current_user_email(),
  deleted_at         timestamptz,
  deleted_by         text
);
create unique index if not exists plc_types_name_uq on postsales.plc_types (project_id, lower(name)) where deleted_at is null;
comment on column postsales.plc_types.rate is 'Per sq ft of super built-up area.';

create table if not exists postsales.position_plcs(
  position_id        bigint not null references postsales.tower_positions(id) on delete cascade,
  plc_type_id        bigint not null references postsales.plc_types(id) on delete cascade,
  primary key (position_id, plc_type_id)
);

create table if not exists postsales.floors(
  id                 bigserial primary key,
  tower_id           bigint not null references postsales.towers(id) on delete cascade,
  floor_no           int not null,
  label              text
);
create unique index if not exists floors_tower_no_uq on postsales.floors (tower_id, floor_no);

create table if not exists postsales.flats(
  id                 bigserial primary key,
  tower_id           bigint not null references postsales.towers(id) on delete cascade,
  floor_id           bigint not null references postsales.floors(id) on delete cascade,
  position_id        bigint references postsales.tower_positions(id) on delete set null,
  flat_code          text not null,
  bhk                text,
  sba_sqft           numeric(10,2),
  built_up_sqft      numeric(10,2),
  carpet_sqft        numeric(10,2),
  status             text not null default 'available'
                     check (status in ('available','booked','registered','possession','blocked')),
  remarks            text,
  created_at         timestamptz not null default now(),
  created_by         text default app.current_user_email(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  deleted_by         text
);
create unique index if not exists flats_tower_code_uq on postsales.flats (tower_id, upper(flat_code)) where deleted_at is null;
create index if not exists flats_floor_idx on postsales.flats (floor_id) where deleted_at is null;
comment on column postsales.flats.flat_code is
  'Floor number + position, e.g. "1C" - the same convention Farvision''s unit codes follow.';

-- ---------------------------------------------------------------------------
-- Other charges, parking, construction stages, payment plans
-- ---------------------------------------------------------------------------
create table if not exists postsales.charges(
  id                 bigserial primary key,
  project_id         bigint not null references cust.projects(id),
  name               text not null,
  charge_group       text not null default 'edc' check (charge_group in ('edc','other')),
  basis              text not null default 'per_sqft' check (basis in ('per_sqft','fixed','pct_unit')),
  rate               numeric(14,2) not null default 0,
  gst_rate           numeric(5,2) not null default 18,
  sort_order         int not null default 0,
  created_at         timestamptz not null default now(),
  created_by         text default app.current_user_email(),
  deleted_at         timestamptz,
  deleted_by         text
);
comment on column postsales.charges.charge_group is
  'edc: on every cost sheet, split across payment-plan milestones by each milestone''s EDC %. other: off the standard cost sheet, billed on its own when raised (extra work etc.).';
comment on column postsales.charges.basis is
  'per_sqft: rate x super built-up area. fixed: rate as a lump sum. pct_unit: rate % of the unit price.';

create table if not exists postsales.parking_types(
  id                 bigserial primary key,
  project_id         bigint not null references cust.projects(id),
  name               text not null,
  price              numeric(14,2) not null default 0,
  gst_rate           numeric(5,2) not null default 5,
  sort_order         int not null default 0,
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  deleted_by         text
);

create table if not exists postsales.stages(
  id                 bigserial primary key,
  project_id         bigint not null references cust.projects(id),
  name               text not null,
  level              text not null check (level in ('tower','floor')),
  sort_order         int not null default 0,
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  deleted_by         text
);
comment on table postsales.stages is
  'Construction stages a milestone can wait on. tower: completing it for a tower invoices every booked '
  'flat in that tower (foundation, Nth floor casting). floor: completing it for one floor invoices every '
  'booked flat on that floor (brickwork, flooring, POP).';

create table if not exists postsales.payment_plans(
  id                 bigserial primary key,
  project_id         bigint not null references cust.projects(id),
  name               text not null,
  description        text,
  active             boolean not null default true,
  sort_order         int not null default 0,
  created_at         timestamptz not null default now(),
  created_by         text default app.current_user_email(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  deleted_by         text
);

create table if not exists postsales.plan_milestones(
  id                 bigserial primary key,
  plan_id            bigint not null references postsales.payment_plans(id) on delete cascade,
  seq                int not null default 0,
  name               text not null,
  trigger_type       text not null default 'individual' check (trigger_type in ('individual','tower','floor')),
  due_days           int,
  stage_id           bigint references postsales.stages(id),
  fixed_amount       numeric(14,2),
  less_fixed         boolean not null default false,
  unit_pct           numeric(6,3) not null default 0,
  edc_pct            numeric(6,3) not null default 0,
  parking_pct        numeric(6,3) not null default 0
);
create index if not exists plan_milestones_plan_idx on postsales.plan_milestones (plan_id, seq);
comment on column postsales.plan_milestones.due_days is
  'Individual milestones only: raised automatically this many days after the booking date (null = raised by hand).';
comment on column postsales.plan_milestones.fixed_amount is
  'A fixed sum instead of percentages - the booking amount.';
comment on column postsales.plan_milestones.less_fixed is
  'Deduct the plan''s fixed (booking) amounts from this milestone''s unit share - "10% of flat value less booking amount".';

-- ---------------------------------------------------------------------------
-- generate_tower_flats: create any floors/flats a tower's layout implies that don't exist yet.
-- Never deletes or changes an existing flat, so it is safe to run again after adding a position
-- or raising the top floor.
-- ---------------------------------------------------------------------------
create or replace function postsales.generate_tower_flats(p_tower_id bigint) returns int
 language plpgsql security invoker set search_path = postsales, public
as $$
declare
  t postsales.towers;
  f int;
  v_floor_id bigint;
  pos record;
  v_new int := 0;
begin
  select * into t from postsales.towers where id = p_tower_id and deleted_at is null;
  if not found then raise exception 'Tower % not found', p_tower_id; end if;
  for f in t.floor_from .. t.floor_to loop
    insert into postsales.floors(tower_id, floor_no, label)
      values (t.id, f, case when f = 0 then 'Ground' else null end)
      on conflict (tower_id, floor_no) do nothing;
    select id into v_floor_id from postsales.floors where tower_id = t.id and floor_no = f;
    for pos in select * from postsales.tower_positions where tower_id = t.id order by sort_order, code loop
      if not exists(select 1 from postsales.flats
                    where tower_id = t.id and deleted_at is null
                      and upper(flat_code) = upper(f::text || pos.code)) then
        insert into postsales.flats(tower_id, floor_id, position_id, flat_code, bhk, sba_sqft, built_up_sqft, carpet_sqft)
          values (t.id, v_floor_id, pos.id, f::text || pos.code, pos.bhk, pos.sba_sqft, pos.built_up_sqft, pos.carpet_sqft);
        v_new := v_new + 1;
      end if;
    end loop;
  end loop;
  return v_new;
end $$;
grant execute on function postsales.generate_tower_flats(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- setup_from_portal: build towers, positions and flats for a project from the bookings already
-- imported into cust.units. Unit code "<floor><position>" (e.g. 5A, 12C, 1E2) gives the floor and the
-- position; the most common super built-up / built-up / carpet area among that position's bookings
-- becomes the position's typical area. A flat with a live (non-cancelled) booking is marked booked.
-- Codes that don't follow the pattern (e.g. "13-14A", bungalow plots) are skipped and returned so
-- they can be added by hand. Only touches towers that don't exist yet for this project.
-- ---------------------------------------------------------------------------
create or replace function postsales.setup_from_portal(p_project_id bigint) returns jsonb
 language plpgsql security invoker set search_path = postsales, public
as $$
declare
  tw record;
  v_tower_id bigint;
  v_towers int := 0;
  v_flats int := 0;
  v_skipped text[] := '{}';
begin
  for tw in
    select u.tower,
           min((substring(u.unit_code from '^([0-9]+)[A-Za-z]'))::int) as fmin,
           max((substring(u.unit_code from '^([0-9]+)[A-Za-z]'))::int) as fmax
    from cust.units u
    where u.project_id = p_project_id and u.deleted_at is null and coalesce(u.tower,'') <> ''
    group by u.tower order by u.tower
  loop
    if exists(select 1 from postsales.towers t where t.project_id = p_project_id and t.deleted_at is null
              and (lower(t.name) = lower(tw.tower) or lower(t.portal_tower) = lower(tw.tower))) then
      continue;
    end if;
    if tw.fmin is null then
      v_skipped := v_skipped || (select array_agg(tw.tower || ' ' || unit_code) from cust.units
                                 where project_id = p_project_id and tower = tw.tower and deleted_at is null);
      continue;
    end if;
    insert into postsales.towers(project_id, name, portal_tower, floor_from, floor_to, sort_order)
      values (p_project_id, initcap(tw.tower), tw.tower, least(tw.fmin, 1), tw.fmax, v_towers)
      returning id into v_tower_id;
    v_towers := v_towers + 1;

    insert into postsales.tower_positions(tower_id, code, bhk, sba_sqft, built_up_sqft, carpet_sqft, sort_order)
    select v_tower_id, x.pos,
           mode() within group (order by x.unit_type),
           mode() within group (order by x.super_built_up_area_sqft),
           mode() within group (order by x.built_up_area_sqft),
           mode() within group (order by x.carpet_area_sqft),
           row_number() over (order by x.pos)
    from (select upper(substring(u.unit_code from '^[0-9]+([A-Za-z]+[0-9]*)$')) as pos, u.*
          from cust.units u
          where u.project_id = p_project_id and u.tower = tw.tower and u.deleted_at is null) x
    where x.pos is not null
    group by x.pos;

    perform postsales.generate_tower_flats(v_tower_id);

    -- Flats with a live booking: mark booked, and carry that booking's own areas (a flat's real area
    -- can differ from its position's typical one).
    update postsales.flats f
       set status = 'booked',
           sba_sqft = coalesce(u.super_built_up_area_sqft, f.sba_sqft),
           built_up_sqft = coalesce(u.built_up_area_sqft, f.built_up_sqft),
           carpet_sqft = coalesce(u.carpet_area_sqft, f.carpet_sqft),
           bhk = coalesce(u.unit_type, f.bhk)
      from cust.units u
     where f.tower_id = v_tower_id and f.deleted_at is null
       and u.project_id = p_project_id and u.tower = tw.tower and u.deleted_at is null
       and u.status <> 'cancelled' and upper(u.unit_code) = upper(f.flat_code);

    v_skipped := v_skipped || coalesce((select array_agg(tw.tower || ' ' || u.unit_code) from cust.units u
                                        where u.project_id = p_project_id and u.tower = tw.tower and u.deleted_at is null
                                          and u.unit_code !~ '^[0-9]+[A-Za-z]+[0-9]*$'), '{}');
  end loop;
  select count(*) into v_flats from postsales.flats f join postsales.towers t on t.id = f.tower_id
   where t.project_id = p_project_id and f.deleted_at is null and t.deleted_at is null;
  return jsonb_build_object('towers_created', v_towers, 'flats_total', v_flats, 'skipped', to_jsonb(v_skipped));
end $$;
grant execute on function postsales.setup_from_portal(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: same rule as the rest of the Post Sales schema - any staff session, never a customer session.
-- ---------------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array['project_setup','towers','tower_positions','plc_types','position_plcs','floors',
                           'flats','charges','parking_types','stages','payment_plans','plan_milestones'] loop
    execute format('alter table postsales.%I enable row level security', t);
    execute format('drop policy if exists %I on postsales.%I', t || '_staff_all', t);
    execute format('create policy %I on postsales.%I for all to authenticated using (not app.is_customer()) with check (not app.is_customer())', t || '_staff_all', t);
    execute format('grant select, insert, update, delete on postsales.%I to authenticated', t);
  end loop;
end $rls$;
grant usage on schema postsales to authenticated;
grant usage, select on all sequences in schema postsales to authenticated;
