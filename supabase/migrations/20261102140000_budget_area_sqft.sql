/* A BUDGET LINE CAN NOW CARRY AN AREA, IN SQUARE FEET.

   WHAT IS ASKED FOR.
   The Outflow / Inflow budget form gets one more field, "Area", a plain number whose unit is square feet.

   WHAT CHANGES.
   eng.budgets gains area_sqft - optional (a line with no area simply leaves it empty) and, when given, above zero.
   It is a figure the person types, kept beside the amount; nothing is calculated from it and nothing else reads it.
   It is NOT the same thing as the "area" of a budget's scope (business unit / block / floor / flat) that the
   20261030090000 migration speaks of: that one says WHERE a budget applies, this one says HOW BIG the area is.

   eng.v_budget_status is what the Budget screen reads (to list lines and to fill the edit form), so it reports the
   new column too - appended as the last column, because create or replace view cannot slot one in the middle, and
   the rest of the definition is exactly the one in force. */

alter table eng.budgets add column if not exists area_sqft numeric(14,2);

alter table eng.budgets drop constraint if exists budgets_area_sqft_positive;
alter table eng.budgets add  constraint budgets_area_sqft_positive check (area_sqft is null or area_sqft > 0);

comment on column eng.budgets.area_sqft is 'Area the budget line covers, in square feet (a figure entered with the budget; optional).';

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
    b.floor_id,
    f.floor_no,
    coalesce(nullif(btrim(f.label),''), 'Floor '||f.floor_no::text) as floor_label,
    b.flat_id,
    fl.flat_code,
    b.area_sqft
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
