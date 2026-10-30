/* A BUDGET CAN NOW NAME THE SAME AREA A BOQ LINE CAN.

   WHAT WAS WRONG.
   A BOQ line is written at one of five places - the whole business unit, a block, a floor, a flat,
   or a portion of a flat. A budget could only be set at two of them: the whole business unit or a
   block. So the plan was made at block level and the work was measured at flat level, and the two
   could never be put side by side at the level the site actually works at. Anyone wanting to know
   whether Block A1's seventh floor was running over had no way to ask.

   WHAT CHANGES.
   eng.budgets gains floor_id and flat_id, the same two columns a BOQ line carries, with the same
   chain rule (a flat implies a floor, a floor implies a block). v_budget_status reports them, and
   the two lateral joins that work out BOQ value, committed, verified and billed now narrow by them
   as well, exactly as they already narrowed by block - so a budget set on one flat is compared
   only with the work booked to that flat.

   Inflow budgets are deliberately left at business unit and block. Their actual is receipts in
   Post Sales, which are tracked against a booking's block; there is nothing below that to compare
   a per-floor collection target with, so the constraint below refuses one rather than quietly
   showing it against the whole block's money.

   The scope index is widened to match, or two budgets on different floors of the same block would
   be read as the same budget and the second would be refused as a duplicate. */

alter table eng.budgets
  add column if not exists floor_id bigint references postsales.floors(id),
  add column if not exists flat_id  bigint references postsales.flats(id);

alter table eng.budgets drop constraint if exists budgets_area_chain;
alter table eng.budgets add  constraint budgets_area_chain
  check ((floor_id is null or tower_id is not null)
     and (flat_id  is null or floor_id is not null));

-- an inflow budget is compared with receipts, which only know which block they came from
alter table eng.budgets drop constraint if exists budgets_inflow_area;
alter table eng.budgets add  constraint budgets_inflow_area
  check (direction = 'Outflow' or (floor_id is null and flat_id is null));

create index if not exists budgets_floor_id_fk_idx on eng.budgets(floor_id);
create index if not exists budgets_flat_id_fk_idx  on eng.budgets(flat_id);

drop index if exists eng.budgets_scope_uq;
create unique index budgets_scope_uq on eng.budgets
  (project_id, direction, coalesce(tower_id,0::bigint), coalesce(floor_id,0::bigint),
   coalesce(flat_id,0::bigint), coalesce(group_id,0::bigint), coalesce(item_id,0::bigint),
   coalesce(head_id,0::bigint));

create or replace view eng.v_budget_status as
 select b.id,
    b.project_id,
    p.name as project_name,
    b.tower_id,
    t.name as tower_name,
    b.group_id,
    g.name as group_name,
    b.item_id,
    i.name as item_name,
    i.code as item_code,
    /* The level names the finest NON-area dimension when there is one, and the finest area when
       there is not - which is the grammar the screen already used for "Activity Group" sitting
       inside a block. The area itself is spelled out in the scope column beside it. */
    case
      when b.head_id  is not null then 'Budget Head'::text
      when b.item_id  is not null then 'Material'::text
      when b.group_id is not null then 'Activity Group'::text
      when b.flat_id  is not null then 'Flat'::text
      when b.floor_id is not null then 'Floor'::text
      when b.tower_id is not null then 'Block'::text
      else 'Business Unit'::text
    end as level,
    b.amount,
    b.remarks,
    b.created_at,
    case when b.item_id is null and b.head_id is null and b.direction = 'Outflow' then bq.boq_value end as boq_value,
    case when b.item_id is null and b.head_id is null and b.direction = 'Outflow' then wo.committed end as committed,
    case when b.item_id is null and b.head_id is null and b.direction = 'Outflow' then wo.verified  end as verified,
    case when b.item_id is null and b.head_id is null and b.direction = 'Outflow' then wo.billed    end as billed,
    b.direction,
    case when b.direction = 'Inflow' then rc.received end as received,
    b.head_id,
    h.name as head_name,
    h.ledger_id as head_ledger_id,
    /* Appended rather than slotted in beside tower_id: create or replace view cannot insert a
       column in the middle of an existing one, and dropping the view would take v_project_summary
       with it. Order on the wire does not matter to anything that reads this. */
    b.floor_id,
    f.floor_no,
    coalesce(nullif(btrim(f.label),''), 'Floor '||f.floor_no::text) as floor_label,
    b.flat_id,
    fl.flat_code
   from eng.budgets b
     join eng.projects() p(id, name, code) on p.id = b.project_id
     left join postsales.towers t on t.id = b.tower_id
     left join postsales.floors f on f.id = b.floor_id
     left join postsales.flats fl on fl.id = b.flat_id
     left join eng.activity_groups g on g.id = b.group_id
     left join purchase.items i on i.id = b.item_id
     left join eng.budget_heads h on h.id = b.head_id
     left join lateral (
        select coalesce(sum(round(bi.qty * bi.rate, 2)), 0::numeric) as boq_value
          from eng.boq_items bi
          join eng.activities a on a.id = bi.activity_id
         where b.direction = 'Outflow'
           and bi.project_id = b.project_id
           and (b.tower_id is null or bi.tower_id = b.tower_id)
           and (b.floor_id is null or bi.floor_id = b.floor_id)
           and (b.flat_id  is null or bi.flat_id  = b.flat_id)
           and (b.group_id is null or a.group_id = b.group_id)) bq on true
     left join lateral (
        select coalesce(sum(wi.amount), 0::numeric) as committed,
               coalesce(sum(round(pr.verified_qty * wi.rate, 2)), 0::numeric) as verified,
               coalesce(sum(round(pr.billed_qty   * wi.rate, 2)), 0::numeric) as billed
          from eng.wo_items wi
          join eng.work_orders w on w.id = wi.wo_id and w.status <> 'Cancelled'
          join eng.boq_items bi on bi.id = wi.boq_item_id
          join eng.activities a on a.id = bi.activity_id
          join eng.v_wo_item_progress pr on pr.wo_item_id = wi.id
         where b.direction = 'Outflow'
           and bi.project_id = b.project_id
           and (b.tower_id is null or bi.tower_id = b.tower_id)
           and (b.floor_id is null or bi.floor_id = b.floor_id)
           and (b.flat_id  is null or bi.flat_id  = b.flat_id)
           and (b.group_id is null or a.group_id = b.group_id)) wo on true
     left join lateral (
        select coalesce((select sum(r.amount)
                           from postsales.receipts r
                           join postsales.bookings bk on bk.id = r.booking_id
                          where r.project_id = b.project_id and r.status = 'active'
                            and (b.tower_id is null or bk.tower_id = b.tower_id)), 0::numeric)
             - coalesce((select sum(po.amount)
                           from postsales.payouts po
                           join postsales.bookings bk2 on bk2.id = po.booking_id
                          where po.project_id = b.project_id and po.kind = 'refund'
                            and (b.tower_id is null or bk2.tower_id = b.tower_id)), 0::numeric) as received
         where b.direction = 'Inflow') rc on true;
