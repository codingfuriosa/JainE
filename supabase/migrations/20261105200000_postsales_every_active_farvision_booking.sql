-- EVERY ACTIVE FARVISION BOOKING HAS A POST SALES BOOKING (5 Nov 2026, asked by Ayush: "how can this be
-- completely fixed?").
--
-- Post Sales > Bookings warned "878 flats are being billed in FarVision with no booking here". Since the
-- 2 Nov import keeps every Farvision row, cust.units holds every flat in the Booking/Invoice/Receipt
-- registers, and the warning counted all of them. On 5 Nov the 878 were:
--   435 cancelled in Farvision, 104 with nothing billed, 86 in projects Post Sales does not run
--   (Excellency, Palazzo, Dream One Studio, Diamond - not to be added), and 341 Active customers:
--   47 whose flat was set up (the importer skipped them: it ignored register-created flats),
--   130 whose flat was missing in Setup, 164 whose block was missing.
--
-- Now:
--   1. SETUP. In every project Post Sales already runs, each Active Farvision booking's block, floor and
--      flat is added to Setup if it is not there - named like the existing ones ("BLOCK-III" -> Block-III,
--      "GRAND[III]" -> Grand[III]), areas and BHK from Farvision. created_by 'farvision-setup'.
--   2. THE IMPORTER takes a register-created flat when its booking is Active in the latest Customer
--      Outstanding file, unless the flat already has a live Post Sales booking (one live booking a flat).
--   3. THE WARNING lists only Active bookings in projects Post Sales runs - the real gaps.
--   4. The importer is run once, so the bookings, demands and receipts arrive tonight.
-- Run after 20:00 IST (no schema changes in office hours). Each patch that does not find its text stops
-- the whole migration.

------------------------------------------------------------------------------------------------ 1. SETUP
do $do$
declare v_t int; v_fl int; v_f int;
begin
  create temp table _act on commit drop as
    select distinct r->>'bookingNo' bno
      from (select raw_rows from cust.import_batches
             where import_type = 'outstanding' and status = 'completed' order by imported_at desc limit 1) ob,
           jsonb_array_elements(ob.raw_rows) r
     where r->>'status' = 'Active';

  create temp table _u on commit drop as
    select un.id, un.project_id, un.tower, un.unit_code, un.unit_type, un.super_built_up_area_sqft,
           un.built_up_area_sqft, un.carpet_area_sqft,
           coalesce((regexp_match(un.unit_code, '^\s*(\d+)'))[1]::int, 0) fl
      from cust.units un join _act a on a.bno = un.booking_no
     where un.deleted_at is null and coalesce(un.tower, '') <> ''
       and exists(select 1 from postsales.towers t where t.project_id = un.project_id and t.deleted_at is null)
       and not exists(select 1 from postsales.bookings b where b.farvision_unit_id = un.id);

  -- blocks
  insert into postsales.towers(project_id, name, portal_tower, floor_from, floor_to, sort_order, created_by)
  select u.project_id,
         initcap(lower(substring(u.tower from '^[A-Za-z ]*'))) || substring(u.tower from length(substring(u.tower from '^[A-Za-z ]*')) + 1),
         u.tower, least(1, min(u.fl)), greatest(1, max(u.fl)),
         coalesce((select max(sort_order) + 1 from postsales.towers t where t.project_id = u.project_id and t.deleted_at is null), 0)
           + dense_rank() over (partition by u.project_id order by u.tower) - 1,
         'farvision-setup'
    from _u u
   where not exists(select 1 from postsales.towers t where t.project_id = u.project_id
                      and lower(t.portal_tower) = lower(u.tower) and t.deleted_at is null)
   group by u.project_id, u.tower;
  get diagnostics v_t = row_count;

  -- an existing block whose top floor is lower than a flat being added
  update postsales.towers t set floor_to = x.mx, updated_at = now()
    from (select t2.id, max(u.fl) mx from _u u join postsales.towers t2 on t2.project_id = u.project_id
            and lower(t2.portal_tower) = lower(u.tower) and t2.deleted_at is null group by t2.id) x
   where t.id = x.id and x.mx > t.floor_to;

  -- floors: every floor of a new block, and any floor a flat needs in an existing one
  insert into postsales.floors(tower_id, floor_no)
  select t.id, g from postsales.towers t, generate_series(t.floor_from, t.floor_to) g
   where t.created_by = 'farvision-setup' and t.deleted_at is null
  on conflict do nothing;
  insert into postsales.floors(tower_id, floor_no)
  select distinct t.id, u.fl from _u u join postsales.towers t on t.project_id = u.project_id
     and lower(t.portal_tower) = lower(u.tower) and t.deleted_at is null
  on conflict do nothing;
  get diagnostics v_fl = row_count;

  -- flats
  insert into postsales.flats(tower_id, floor_id, flat_code, bhk, sba_sqft, built_up_sqft, carpet_sqft, status, remarks, created_by)
  select distinct on (t.id, upper(u.unit_code))
         t.id, (select f.id from postsales.floors f where f.tower_id = t.id and f.floor_no = u.fl limit 1),
         u.unit_code, u.unit_type, u.super_built_up_area_sqft, u.built_up_area_sqft, u.carpet_area_sqft,
         'available', 'Added from Farvision', 'farvision-setup'
    from _u u join postsales.towers t on t.project_id = u.project_id and lower(t.portal_tower) = lower(u.tower) and t.deleted_at is null
   where not exists(select 1 from postsales.flats f where f.tower_id = t.id and upper(f.flat_code) = upper(u.unit_code) and f.deleted_at is null)
   order by t.id, upper(u.unit_code), u.id;
  get diagnostics v_f = row_count;
  raise notice 'setup: % blocks, % floors, % flats added', v_t, v_fl, v_f;
end $do$;

------------------------------------------------------------------------------------------------ 2. IMPORTER
do $do$
declare d text; n text;
begin
  d := pg_get_functiondef('postsales.import_farvision'::regproc);
  if position('_active_in_farvision' in d) > 0 then raise notice 'import_farvision already patched'; return; end if;
  n := replace(d, $a$      and un.created_by is distinct from 'auto-import:register'
$a$, $b$      and (un.created_by is distinct from 'auto-import:register'
           or un.booking_no in (select r->>'bookingNo' /* _active_in_farvision */
                                  from (select raw_rows from cust.import_batches where import_type = 'outstanding' and status = 'completed'
                                         order by imported_at desc limit 1) ob, jsonb_array_elements(ob.raw_rows) r
                                 where r->>'status' = 'Active'))
$b$);
  if n = d then raise exception 'import_farvision: register filter not found'; end if; d := n;
  n := replace(d, $a$    continue when v_fl.id is null;
$a$, $b$    continue when v_fl.id is null;
    -- one live booking a flat: a register flat whose flat is already booked here is not booked twice
    continue when u.created_by = 'auto-import:register'
              and (exists(select 1 from postsales.bookings bb where bb.flat_id = v_fl.id and bb.status = 'active')
                   or exists(select 1 from postsales.bookings bb where bb.booking_no = u.booking_no));
$b$);
  if n = d then raise exception 'import_farvision: flat check not found'; end if;
  execute n;
end $do$;

------------------------------------------------------------------------------------------------ 3. WARNING
create or replace function postsales.unlinked_farvision_units()
 returns table(project_id bigint, project text, unit_id bigint, unit_code text, tower text, outstanding numeric,
               bills integer, first_seen date, reason text, fix text)
 language sql stable
 set search_path to 'postsales', 'cust', 'public'
as $function$
  -- Only REAL gaps (5 Nov 2026): bookings Active in the latest Customer Outstanding file, in projects
  -- Post Sales runs. Cancelled bookings, flats with nothing billed and projects not run here are not gaps.
  with latest as (
    select distinct on (s.unit_id) s.unit_id, s.net_outstanding, s.no_of_bills
    from cust.outstanding_snapshot s
    where s.deleted_at is null and s.is_current
    order by s.unit_id, s.id desc),
  act as (
    select distinct r->>'bookingNo' bno
      from (select raw_rows from cust.import_batches where import_type = 'outstanding' and status = 'completed'
             order by imported_at desc limit 1) ob, jsonb_array_elements(ob.raw_rows) r
     where r->>'status' = 'Active')
  select u.project_id, p.name, u.id, u.unit_code, u.tower,
         round(coalesce(latest.net_outstanding,0), 2), coalesce(latest.no_of_bills,0),
         u.created_at::date,
         case
           when t.id is null then 'Block "'||coalesce(u.tower,'?')||'" is not set up in Post Sales'
           when f.id is null then 'Flat '||u.unit_code||' is not set up in '||t.name
           when exists(select 1 from postsales.bookings bb where bb.flat_id = f.id and bb.status = 'active')
             then 'Flat '||u.unit_code||' already has a live booking here under another booking number'
           else 'Set up correctly - the import has simply not run since this unit appeared'
         end,
         case
           when t.id is null then 'Post Sales > Setup > Towers: add a block whose portal name is "'||coalesce(u.tower,'?')||'"'
           when f.id is null then 'Post Sales > Setup > '||t.name||': add flat '||u.unit_code||', then press Sync now'
           when exists(select 1 from postsales.bookings bb where bb.flat_id = f.id and bb.status = 'active')
             then 'Check which booking is current in Farvision and cancel the other one here'
           else 'Press Sync now on Bookings'
         end
  from cust.units u
  join cust.projects p on p.id = u.project_id
  join act on act.bno = u.booking_no
  left join latest on latest.unit_id = u.id
  left join postsales.towers t on t.project_id = u.project_id
                              and lower(t.portal_tower) = lower(u.tower) and t.deleted_at is null
  left join postsales.flats  f on f.tower_id = t.id
                              and upper(f.flat_code) = upper(u.unit_code) and f.deleted_at is null
  where u.deleted_at is null
    and exists(select 1 from postsales.towers tt where tt.project_id = u.project_id and tt.deleted_at is null)
    and not exists (select 1 from postsales.bookings b where b.farvision_unit_id = u.id)
  order by coalesce(latest.net_outstanding,0) desc, p.name, u.tower, u.unit_code
$function$;

------------------------------------------------------------------------------------------------ 4. RUN IT
select postsales.import_farvision(false);
