/* Engineering: budget heads linked to Accounts, and a fuller activity master.

   BUDGET HEADS. Until now a budget could be set against a business unit, a block, an activity
   group or a material — all of them Engineering's own ideas of scope. None is the shape finance
   actually budgets in, which is a spend head money is booked to. A budget head is that: a name of
   the user's choosing pointing at ONE Accounts ledger, and its actual is simply what has been
   posted to that ledger for this business unit.

   DELIBERATELY NOT TIED TO ACTIVITY GROUPS (the user's choice when asked). A head is an
   independent thing to budget against, not a bucket of trades; its actual is read from Accounts
   and owes nothing to the BOQ. That keeps it honest for heads with no construction activity behind
   them at all — site establishment, consultancy, finance cost — which is most of the reason to
   want heads in the first place.

   ONE LEDGER PER HEAD, and at most one head per ledger: two heads sharing a ledger would each
   claim the whole of that ledger's spend as their own actual, and two budgets would be compared
   against one pot of money.

   ACTIVITY MASTER. The BOQ and Masters screens can now create an activity without leaving the
   form, so the master needs the two fields those forms ask for and the table did not have: a short
   description and a long one. The rest already exist — name, group_id (the parent group) and uom
   (the unit).

   'Project' becomes 'Business Unit' in v_budget_status.level, matching the rename through the
   module's wording. The COLUMNS keep their names (project_id, project_name): renaming those would
   reach into Accounts, Purchase and Post Sales, which is a different job from relabelling a
   screen. */

-- ---------------------------------------------------------------------------------------------
-- 1. The activity master gains the two description fields the new forms capture.
-- ---------------------------------------------------------------------------------------------
alter table eng.activities add column if not exists description      text;
alter table eng.activities add column if not exists long_description text;

comment on column eng.activities.description is
  'One line, shown beside the activity wherever it is picked.';
comment on column eng.activities.long_description is
  'The full specification — method, materials, finish. Shown on the activity master only.';

-- ---------------------------------------------------------------------------------------------
-- 2. Budget heads.
-- ---------------------------------------------------------------------------------------------
create table if not exists eng.budget_heads(
  id          bigserial primary key,
  name        text not null,
  /* The Accounts ledger this head's money is booked to. Nullable so a head can be written down
     before Accounts has the ledger, but a head without one has no actual to show. */
  ledger_id   bigint references accounts.ledgers(id),
  description text,
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz,
  updated_by  text
);

create unique index if not exists budget_heads_name_uq
  on eng.budget_heads(lower(btrim(name)));
/* At most one head per ledger — see the header. Partial, so any number of heads may sit without a
   ledger yet. */
create unique index if not exists budget_heads_ledger_uq
  on eng.budget_heads(ledger_id) where ledger_id is not null;

alter table eng.budget_heads enable row level security;
drop policy if exists budget_heads_module on eng.budget_heads;
create policy budget_heads_module on eng.budget_heads
  for all using ((select app.has_module('engineering')))
  with check ((select app.has_module('engineering')));
grant select, insert, update, delete on eng.budget_heads to authenticated;
grant usage, select on sequence eng.budget_heads_id_seq to authenticated;

comment on table eng.budget_heads is
  'A spend head to budget against, pointing at one Accounts ledger. Independent of activity groups; its actual is what Accounts has posted to that ledger for the business unit.';

-- ---------------------------------------------------------------------------------------------
-- 3. Budgets can be set against a head.
-- ---------------------------------------------------------------------------------------------
alter table eng.budgets add column if not exists head_id bigint references eng.budget_heads(id);

/* The scope columns stay mutually exclusive — a budget is against exactly one kind of thing. */
alter table eng.budgets drop constraint if exists budgets_check;
alter table eng.budgets drop constraint if exists budgets_one_scope;
alter table eng.budgets add  constraint budgets_one_scope check (
  (case when group_id is not null then 1 else 0 end)
+ (case when item_id  is not null then 1 else 0 end)
+ (case when head_id  is not null then 1 else 0 end) <= 1);

/* Inflow is money coming in; a spend head, a trade and a material are all outflow ideas. */
alter table eng.budgets drop constraint if exists budgets_inflow_scope;
alter table eng.budgets add  constraint budgets_inflow_scope check (
  direction = 'Outflow' or (group_id is null and item_id is null and head_id is null));

drop index if exists eng.budgets_scope_uq;
create unique index budgets_scope_uq on eng.budgets
  (project_id, direction, coalesce(tower_id,0::bigint), coalesce(group_id,0::bigint),
   coalesce(item_id,0::bigint), coalesce(head_id,0::bigint));

-- ---------------------------------------------------------------------------------------------
-- 4. What Accounts has actually spent on each head, for a business unit.
--
--    Straight ledger arithmetic: debits less credits on the head's ledger, across posted vouchers
--    belonging to this business unit. No BOQ, no work orders — a head's actual is whatever the
--    books say landed on it, which is the whole point of pointing a head at a ledger.
-- ---------------------------------------------------------------------------------------------
create or replace function accounts.eng_head_actuals(p_project bigint default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'accounts','public'
as $function$
begin
  if app.is_customer() or not (app.has_module('engineering') or accounts.can_read()) then
    raise exception 'not allowed';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('head_id', h.id, 'ledger_id', h.ledger_id, 'spent', x.spent))
      from eng.budget_heads h
      join lateral (
        select coalesce(sum(vl.dr - vl.cr), 0) as spent
          from accounts.voucher_lines vl
          join accounts.vouchers v on v.id = vl.voucher_id and v.status = 'posted'
          join accounts.business_units bu on bu.id = v.business_unit_id
         where vl.ledger_id = h.ledger_id
           and (p_project is null or bu.project_id = p_project)
      ) x on true
     where h.ledger_id is not null
  ), '[]'::jsonb);
end;
$function$;

revoke all on function accounts.eng_head_actuals(bigint) from public;
grant execute on function accounts.eng_head_actuals(bigint) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. v_budget_status carries the head.
--
--    The head columns are APPENDED rather than slotted in beside the other scope columns, where
--    they would read better: create or replace view may add columns at the end but may not rename
--    or reorder the ones already there, and dropping the view would take the Budget tab's reads
--    with it for as long as the migration runs. `level` keeps its position; only the expression
--    behind it changes, which is allowed.
-- ---------------------------------------------------------------------------------------------
create or replace view eng.v_budget_status as
 SELECT b.id,
    b.project_id,
    p.name AS project_name,
    b.tower_id,
    t.name AS tower_name,
    b.group_id,
    g.name AS group_name,
    b.item_id,
    i.name AS item_name,
    i.code AS item_code,
        CASE
            WHEN b.head_id IS NOT NULL THEN 'Budget Head'::text
            WHEN b.item_id IS NOT NULL THEN 'Material'::text
            WHEN b.group_id IS NOT NULL THEN 'Activity Group'::text
            WHEN b.tower_id IS NOT NULL THEN 'Block'::text
            ELSE 'Business Unit'::text
        END AS level,
    b.amount,
    b.remarks,
    b.created_at,
        CASE
            WHEN b.item_id IS NULL AND b.head_id IS NULL AND b.direction = 'Outflow'::text THEN bq.boq_value
            ELSE NULL::numeric
        END AS boq_value,
        CASE
            WHEN b.item_id IS NULL AND b.head_id IS NULL AND b.direction = 'Outflow'::text THEN wo.committed
            ELSE NULL::numeric
        END AS committed,
        CASE
            WHEN b.item_id IS NULL AND b.head_id IS NULL AND b.direction = 'Outflow'::text THEN wo.verified
            ELSE NULL::numeric
        END AS verified,
        CASE
            WHEN b.item_id IS NULL AND b.head_id IS NULL AND b.direction = 'Outflow'::text THEN wo.billed
            ELSE NULL::numeric
        END AS billed,
    b.direction,
        CASE
            WHEN b.direction = 'Inflow'::text THEN rc.received
            ELSE NULL::numeric
        END AS received,
    b.head_id,
    h.name AS head_name,
    h.ledger_id AS head_ledger_id
   FROM eng.budgets b
     JOIN eng.projects() p(id, name, code) ON p.id = b.project_id
     LEFT JOIN postsales.towers t ON t.id = b.tower_id
     LEFT JOIN eng.activity_groups g ON g.id = b.group_id
     LEFT JOIN purchase.items i ON i.id = b.item_id
     LEFT JOIN eng.budget_heads h ON h.id = b.head_id
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(round(bi.qty * bi.rate, 2)), 0::numeric) AS boq_value
           FROM eng.boq_items bi
             JOIN eng.activities a ON a.id = bi.activity_id
          WHERE b.direction = 'Outflow'::text AND bi.project_id = b.project_id AND (b.tower_id IS NULL OR bi.tower_id = b.tower_id) AND (b.group_id IS NULL OR a.group_id = b.group_id)) bq ON true
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(wi.amount), 0::numeric) AS committed,
            COALESCE(sum(round(pr.verified_qty * wi.rate, 2)), 0::numeric) AS verified,
            COALESCE(sum(round(pr.billed_qty * wi.rate, 2)), 0::numeric) AS billed
           FROM eng.wo_items wi
             JOIN eng.work_orders w ON w.id = wi.wo_id AND w.status <> 'Cancelled'::text
             JOIN eng.boq_items bi ON bi.id = wi.boq_item_id
             JOIN eng.activities a ON a.id = bi.activity_id
             JOIN eng.v_wo_item_progress pr ON pr.wo_item_id = wi.id
          WHERE b.direction = 'Outflow'::text AND bi.project_id = b.project_id AND (b.tower_id IS NULL OR bi.tower_id = b.tower_id) AND (b.group_id IS NULL OR a.group_id = b.group_id)) wo ON true
     LEFT JOIN LATERAL ( SELECT COALESCE(( SELECT sum(r.amount) AS sum
                   FROM postsales.receipts r
                     JOIN postsales.bookings bk ON bk.id = r.booking_id
                  WHERE r.project_id = b.project_id AND r.status = 'active'::text AND (b.tower_id IS NULL OR bk.tower_id = b.tower_id)), 0::numeric) - COALESCE(( SELECT sum(po.amount) AS sum
                   FROM postsales.payouts po
                     JOIN postsales.bookings bk2 ON bk2.id = po.booking_id
                  WHERE po.project_id = b.project_id AND po.kind = 'refund'::text AND (b.tower_id IS NULL OR bk2.tower_id = b.tower_id)), 0::numeric) AS received
          WHERE b.direction = 'Inflow'::text) rc ON true;
