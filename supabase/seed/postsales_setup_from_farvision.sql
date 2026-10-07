-- One-off seed, run 01-Oct-2026: fill Post Sales > Setup for every project from the Farvision data
-- already imported into cust.* (units, cost_sheet_items, invoices/invoice_items). Only writes postsales.*.
--
-- How each value was inferred (all of it should be reviewed in Setup):
--   project code ........ readable initials of the project name (Farvision's own two-letter codes - OH,
--                          MZ, NB ... - don't read as anything); Dream Gurukul = DG as agreed.
--   GST ................. from invoice tax/amount by revenue head: 5% unit / 18% EDC where Farvision
--                          charged it (Gurukul, Ananta, Ecocity Bungalow), 0% where it charged none.
--   towers/flats ........ postsales.setup_from_portal (floor + position from each unit code).
--   list rate ........... highest of the tower's three most recent booking rates (Unit Cost / SBA) -
--                          discounts pull individual bookings below the list rate.
--   floor rise .......... Gurukul and Ananta: FLC / SBA is exactly 50 per floor from the 2nd floor.
--                          No consistent pattern elsewhere, so left blank.
--   PLC ................. one "PLC" type at the project's usual rate (100/sq ft), tagged on a position
--                          when at least half that position's bookings carried PLC.
--   charges ............. per cost-sheet component: per sq ft when amount/SBA agrees on >=80% of
--                          bookings, else fixed when the amount agrees on >=60%, else left out.
--   parking ............. most common Vehicle Parking amount per project.
--   stages / plans ...... from the invoice schedules each project actually billed, with each
--                          milestone's median share of Unit Cost; the booking amount is the most
--                          common Booking invoice. EDC and parking follow the unit % (as on the
--                          Dream Gurukul Estimated Offer Price sheet).
do $seed$
declare
  r record; v_pid bigint; v_tid bigint; v_plan bigint; v_stage bigint; v_plc bigint;
  v_seq int; m jsonb; v_gst_unit numeric; v_gst_edc numeric;
  codes jsonb := '{"1":"DG","2":"DA","3":"DO12","4":"DEX","5":"DV","6":"DEB","7":"DEC","8":"DO34","9":"DJP","10":"DGP","11":"DD","12":"DRM"}';
  gst5 int[] := array[1,2,6];
  parking jsonb := '{"1":500000,"2":500000,"4":400000,"5":450000,"7":400000,"8":525000,"9":350000,"10":350000}';
  -- [name, trigger, due_days, fixed_amount, less_fixed, unit_pct]; trigger tower/floor creates the stage
  plans jsonb := '{
   "2":{"name":"Construction Linked Plan (incomplete)","active":false,"desc":"Only the first 3 milestones have been billed in Farvision so far - add the construction milestones before using it.","ms":[
     ["Booking Amount","individual",0,210000,false,0],["Balance Booking Amount (within 30 days of booking)","individual",30,null,true,10],["Signing of Sale Agreement (within 45 days of booking)","individual",45,null,false,10]]},
   "3":{"name":"Construction Linked Plan","ms":[
     ["Booking","individual",0,200000,false,0],["On Allotment","individual",null,null,true,20],["On Foundation","tower",null,null,false,15],
     ["On Completion of 2nd Floor Casting","tower",null,null,false,10],["On Completion of 5th Floor Casting","tower",null,null,false,10],["On Completion of 8th Floor Casting","tower",null,null,false,10],
     ["On Completion of 11th Floor Casting","tower",null,null,false,10],["On Completion of 14th Floor Casting","tower",null,null,false,10],
     ["On Brick Work","floor",null,null,false,5],["On Internal Plaster","tower",null,null,false,5],["On Possession","tower",null,null,false,5]]},
   "4":{"name":"Construction Linked Plan","ms":[
     ["Booking","individual",0,100000,false,0],["On Allotment","individual",null,null,true,20],["On Foundation","tower",null,null,false,20],
     ["On Completion of 1st Floor Casting","tower",null,null,false,10],["On Completion of 2nd Floor Casting","tower",null,null,false,10],["On Completion of 3rd Floor Casting","tower",null,null,false,10],["On Completion of 4th Floor Casting","tower",null,null,false,10],
     ["On Brick Work","floor",null,null,false,10],["On Flooring","floor",null,null,false,5],["On Possession","tower",null,null,false,5]]},
   "5":{"name":"Construction Linked Plan","ms":[
     ["Booking","individual",0,100000,false,0],["On Allotment","individual",null,null,true,20],["On Foundation","tower",null,null,false,20],["On Brick Work","floor",null,null,false,15],
     ["On Completion of 2nd Floor Casting","tower",null,null,false,10],["On Completion of 4th Floor Casting","tower",null,null,false,10],["On Completion of 6th Floor Casting","tower",null,null,false,10],["On Completion of 8th Floor Casting","tower",null,null,false,10],
     ["On Possession","tower",null,null,false,5]]},
   "6":{"name":"Construction Linked Plan (incomplete)","active":false,"desc":"Farvision has billed only up to the 2nd floor casting (70%) - add the remaining milestones before using it.","ms":[
     ["Booking","individual",0,105000,false,0],["Allotment","individual",null,null,true,20],["On Commencement of Foundation","tower",null,null,false,20],
     ["On Commencement of 1st Floor Casting","tower",null,null,false,15],["On Commencement of 2nd Floor Casting","tower",null,null,false,15]]},
   "7":{"name":"Construction Linked Plan","ms":[
     ["Booking","individual",0,100000,false,0],["On Allotment","individual",null,null,true,20],["On Foundation","tower",null,null,false,20],["On Brick Work","floor",null,null,false,15],
     ["On Completion of 2nd Floor Casting","tower",null,null,false,10],["On Completion of 4th Floor Casting","tower",null,null,false,10],["On Completion of 6th Floor Casting","tower",null,null,false,10],["On Completion of 8th Floor Casting","tower",null,null,false,10],
     ["On Possession","tower",null,null,false,5]]},
   "8":{"name":"Construction Linked Plan","ms":[
     ["Booking","individual",0,200000,false,0],["On Allotment","individual",null,null,true,20],["On Foundation","tower",null,null,false,15],
     ["On Completion of 2nd Floor Casting","tower",null,null,false,10],["On Completion of 5th Floor Casting","tower",null,null,false,10],["On Completion of 8th Floor Casting","tower",null,null,false,10],
     ["On Completion of 11th Floor Casting","tower",null,null,false,10],["On Completion of 14th Floor Casting","tower",null,null,false,10],
     ["On Brick Work","floor",null,null,false,5],["On Internal Plaster","tower",null,null,false,5],["On Possession","tower",null,null,false,5]]},
   "9":{"name":"Construction Linked Plan","ms":[
     ["On Booking","individual",0,50000,false,0],["On Allotment","individual",null,null,true,15],["1st Installment","individual",null,null,false,10],["On Commencement of Foundation","tower",null,null,false,20],
     ["On Commencement of 2nd Floor Casting","tower",null,null,false,10],["On Commencement of 4th Floor Casting","tower",null,null,false,10],["On Commencement of 6th Floor Casting","tower",null,null,false,10],["On Commencement of 8th Floor Casting","tower",null,null,false,10],
     ["On Commencement of Roof Casting","tower",null,null,false,10],["On Possession","tower",null,null,false,5]]},
   "10":{"name":"Construction Linked Plan","ms":[
     ["On Booking","individual",0,50000,false,0],["On Allotment","individual",null,null,true,15],["1st Installment","individual",null,null,false,10],["On Commencement of Foundation","tower",null,null,false,20],
     ["On Commencement of 2nd Floor Casting","tower",null,null,false,10],["On Commencement of 4th Floor Casting","tower",null,null,false,10],["On Commencement of 6th Floor Casting","tower",null,null,false,10],["On Commencement of 8th Floor Casting","tower",null,null,false,10],
     ["On Commencement of Roof Casting","tower",null,null,false,10],["On Possession","tower",null,null,false,5]]},
   "12":{"name":"Construction Linked Plan","ms":[
     ["Booking","individual",0,51000,false,0],["On Allotment","individual",null,null,true,20],["On Foundation","tower",null,null,false,10],
     ["On Completion of 1st Floor Casting","tower",null,null,false,10],["On Completion of 2nd Floor Casting","tower",null,null,false,10],["On Completion of 3rd Floor Casting","tower",null,null,false,10],["On Completion of 4th Floor Casting","tower",null,null,false,10],["On Completion of 5th Floor Casting","tower",null,null,false,10],
     ["On Brick Work","floor",null,null,false,10],["On Flooring","floor",null,null,false,5],["On Possession","tower",null,null,false,5]]}
  }';
begin
  -- 1. project codes + GST, 2. towers/flats
  for r in select id from cust.projects where deleted_at is null order by id loop
    v_gst_unit := case when r.id = any(gst5) then 5 else 0 end;
    insert into postsales.project_setup(project_id, code, unit_gst_rate, plc_gst_rate, frc_gst_rate)
      values (r.id, codes->>(r.id::text), v_gst_unit, v_gst_unit, v_gst_unit)
      on conflict (project_id) do nothing;
    if r.id <> 1 then perform postsales.setup_from_portal(r.id); end if;
  end loop;

  -- 3. list rate per tower: highest of the three most recent booking rates
  update postsales.towers t set base_rate = x.rate, updated_at = now()
  from (
    select u.project_id, u.tower, round(max(rt)) rate from (
      select u.project_id, u.tower, round(uc.amt / u.super_built_up_area_sqft, 2) rt,
             row_number() over (partition by u.project_id, u.tower order by fc.bd desc nulls last, u.id desc) rn
      from cust.units u
      join (select unit_id, sum(amount) amt from cust.cost_sheet_items where deleted_at is null and is_current and upper(component)='UNIT COST' group by 1) uc on uc.unit_id = u.id
      left join (select unit_id, max(booking_date) bd from cust.farvision_contacts group by 1) fc on fc.unit_id = u.id
      where u.deleted_at is null and u.status <> 'cancelled' and u.super_built_up_area_sqft > 0) u
    where rn <= 3 group by 1, 2) x
  where t.project_id = x.project_id and lower(t.portal_tower) = lower(x.tower) and t.deleted_at is null;

  -- 4. floor rise: Gurukul and Ananta, 50 per sq ft per floor from the 2nd floor
  update postsales.towers set frc_rate = 50, frc_start_floor = 2, updated_at = now()
   where project_id in (1, 2) and deleted_at is null;

  -- 5. PLC (100/sq ft) on positions where most bookings carried PLC
  for r in select unnest(array[1,2,7]) pid loop
    select id into v_plc from postsales.plc_types where project_id = r.pid and deleted_at is null and lower(name) = 'plc';
    if v_plc is null then
      insert into postsales.plc_types(project_id, name, rate) values (r.pid, 'PLC', 100) returning id into v_plc;
    end if;
    insert into postsales.position_plcs(position_id, plc_type_id)
    select p.id, v_plc from postsales.tower_positions p
    join postsales.towers t on t.id = p.tower_id and t.project_id = r.pid and t.deleted_at is null
    join (select u.tower, upper(substring(u.unit_code from '^[0-9]+([A-Za-z]+[0-9]*)$')) pos,
                 count(*) n, count(*) filter (where exists(select 1 from cust.cost_sheet_items c where c.unit_id=u.id and c.deleted_at is null and c.is_current and c.amount>0 and upper(c.component) like 'PLC%')) w
          from cust.units u where u.project_id = r.pid and u.deleted_at is null and u.status <> 'cancelled' group by 1, 2) s
      on lower(s.tower) = lower(t.portal_tower) and s.pos = upper(p.code)
    where s.w * 2 >= s.n
    on conflict do nothing;
  end loop;

  -- 6. other charges (Gurukul's were entered by hand from its booking form)
  insert into postsales.charges(project_id, name, charge_group, basis, rate, gst_rate, sort_order)
  select z.project_id, z.name,
         case when z.comp like 'HIGHER SPECIFICATION%' then 'other' else 'edc' end,
         case when z.pct_rate >= 80 then 'per_sqft' else 'fixed' end,
         case when z.pct_rate >= 80 then z.mode_rate else z.mode_amt end,
         case when z.comp like 'HIGHER SPECIFICATION%' then 5 when z.project_id = any(gst5) then 18 else 0 end,
         row_number() over (partition by z.project_id order by z.n desc, z.name)
  from (
    with x as (
      select u.project_id, u.super_built_up_area_sqft sba, c.amount,
             trim(regexp_replace(regexp_replace(regexp_replace(upper(c.component),'\s+AT\s+(ADJUSTABLE|DEPOSIT|ACTUAL)\s+AT\s*',' ','g'),'[_ ]+[0-9]+\s*$',''),'\.+$','')) comp
      from cust.cost_sheet_items c join cust.units u on u.id = c.unit_id
      where c.deleted_at is null and c.is_current and u.deleted_at is null and u.status <> 'cancelled' and c.amount > 0 and u.super_built_up_area_sqft > 0 and u.project_id <> 1),
    m as (select project_id, comp, count(*) n, mode() within group (order by round(amount/sba,2)) mode_rate, mode() within group (order by amount) mode_amt from x group by 1,2)
    select m.*, initcap(lower(m.comp)) as name,
           100.0 * (select count(*) from x where x.project_id=m.project_id and x.comp=m.comp and abs(x.amount/x.sba - m.mode_rate) < 0.02) / m.n pct_rate,
           100.0 * (select count(*) from x where x.project_id=m.project_id and x.comp=m.comp and x.amount = m.mode_amt) / m.n pct_amt
    from m
    where m.comp !~ '^(UNIT COST|PLC|FLC|VEHICLE PARKING|CHEQUE DISHONOU?RED|OTHER CHARGES|EXTRA WORK|EXTRA LAND|SERVANT QUARTER|EXTRA CHARGES 3 PERCENT)'
  ) z
  where (z.pct_rate >= 80 or z.pct_amt >= 60)
    and not exists(select 1 from postsales.charges c where c.project_id = z.project_id and lower(c.name) = lower(z.name) and c.deleted_at is null);

  -- 7. parking
  for r in select key::bigint pid, value::numeric price from jsonb_each_text(parking) loop
    if not exists(select 1 from postsales.parking_types where project_id = r.pid and deleted_at is null) then
      insert into postsales.parking_types(project_id, name, price, gst_rate) values (r.pid, 'Car Parking', r.price, case when r.pid = any(gst5) then 5 else 0 end);
    end if;
  end loop;

  -- 8. stages + standard plans
  for r in select key::bigint pid, value p from jsonb_each(plans) loop
    if exists(select 1 from postsales.payment_plans where project_id = r.pid and deleted_at is null) then continue; end if;
    insert into postsales.payment_plans(project_id, name, description, active)
      values (r.pid, r.p->>'name', r.p->>'desc', coalesce((r.p->>'active')::boolean, true)) returning id into v_plan;
    v_seq := 0;
    for m in select * from jsonb_array_elements(r.p->'ms') loop
      v_seq := v_seq + 1; v_stage := null;
      if m->>1 in ('tower','floor') then
        select id into v_stage from postsales.stages where project_id = r.pid and lower(name) = lower(m->>0) and deleted_at is null;
        if v_stage is null then
          insert into postsales.stages(project_id, name, level, sort_order) values (r.pid, m->>0, m->>1, v_seq) returning id into v_stage;
        end if;
      end if;
      insert into postsales.plan_milestones(plan_id, seq, name, trigger_type, due_days, stage_id, fixed_amount, less_fixed, unit_pct, edc_pct, parking_pct)
      values (v_plan, v_seq, m->>0, m->>1, nullif(m->>2,'')::int, v_stage, nullif(m->>3,'')::numeric, (m->>4)::boolean,
              (m->>5)::numeric, (m->>5)::numeric, (m->>5)::numeric);
    end loop;
  end loop;

  -- 9. Dream Ecocity Bungalow: its units are plots (A1, K6, L1 ...) with no floor in the code, which
  --    setup_from_portal skips - one ground-level "tower" holding each booked plot.
  if not exists(select 1 from postsales.towers where project_id = 6 and deleted_at is null) then
    insert into postsales.towers(project_id, name, portal_tower, floor_from, floor_to)
      values (6, 'Durgapur Bungalow', 'DURGAPUR BUNGALOW', 0, 0) returning id into v_tid;
    insert into postsales.floors(tower_id, floor_no, label) values (v_tid, 0, 'Ground') on conflict do nothing;
    insert into postsales.flats(tower_id, floor_id, flat_code, bhk, sba_sqft, built_up_sqft, carpet_sqft, status, remarks)
    select v_tid, (select id from postsales.floors where tower_id = v_tid and floor_no = 0), upper(u.unit_code), u.unit_type,
           u.super_built_up_area_sqft, u.built_up_area_sqft, u.carpet_area_sqft, 'booked',
           case when u.land_area_sqft is not null then 'Land ' || u.land_area_sqft || ' sq ft' end
    from cust.units u where u.project_id = 6 and u.deleted_at is null and u.status <> 'cancelled'
    on conflict do nothing;
    update postsales.towers t set base_rate = 5165 where t.id = v_tid;
  end if;

  -- 10. Farvision tower names are upper case; initcap() lower-cases Roman numerals - put them back.
  update postsales.towers set name =
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(name,
      '\mViii\M','VIII','g'),'\mVii\M','VII','g'),'\mIii\M','III','g'),'\mIi\M','II','g'),'\mIv\M','IV','g'),'\mVi\M','VI','g'),'\mIx\M','IX','g'),'\mXi\M','XI','g')
  where deleted_at is null and name ~ '\m(Viii|Vii|Iii|Ii|Iv|Vi|Ix|Xi)\M';
end $seed$;
