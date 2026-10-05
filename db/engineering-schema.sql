-- =====================================================================================
-- JAIN-E · Engineering module  (schema: eng)
--   Activities (grouped) -> Budget -> BOQ (by location) -> Work Order (tags BOQ)
--   -> Work Done (entered, then verified) -> RA Bill (books verified work)
--
-- Reuses, read-only:   cust.projects            (projects)
--                      postsales.towers/floors/flats (blocks, floors, flats)
--                      purchase.vendors / purchase.items / purchase.uoms (contractors, materials, UoM)
-- Access:              everything is gated by app.has_module('engineering')  (Control Panel -> module access)
-- Applied to Supabase as migration "engineering_module".  Safe to re-run only on an empty eng schema.
-- =====================================================================================

create schema if not exists eng;

-- ------------------------------------------------------------------ helpers
create or replace function eng.me() returns text
language sql stable set search_path = '' as
$$ select lower(coalesce(app.current_user_email(), '')) $$;

-- created_/updated_ stamps are forced server-side so the client cannot forge them
create or replace function eng.t_audit() returns trigger
language plpgsql set search_path = '' as
$$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := nullif(eng.me(), '');
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := nullif(eng.me(), '');
  return new;
end $$;

-- gap-free-enough document counters (WO/DG/0001, RA numbers).  Not reachable by the client directly.
create table eng.counters (k text primary key, n int not null default 0);
alter table eng.counters enable row level security;

create or replace function eng.next_no(p_key text) returns int
language plpgsql security definer set search_path = '' as
$$
declare v int;
begin
  insert into eng.counters (k, n) values (p_key, 1)
  on conflict (k) do update set n = eng.counters.n + 1
  returning n into v;
  return v;
end $$;

-- Projects live in cust.projects, which staff outside the customer-portal team cannot read.
-- Engineering users get a read-only list of exactly (id, name, code), and only if they hold the module.
create or replace function eng.projects() returns table (id bigint, name text, code text)
language sql stable security definer set search_path = '' as
$$
  select p.id, btrim(p.name), ps.code
  from cust.projects p
  left join postsales.project_setup ps on ps.project_id = p.id
  where p.deleted_at is null and (select app.has_module('engineering'))
$$;

-- ------------------------------------------------------------------ masters: activity groups & activities
create table eng.activity_groups (
  id          bigint generated always as identity primary key,
  name        text not null check (btrim(name) <> ''),
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(), created_by text,
  updated_at  timestamptz not null default now(), updated_by text
);
create unique index activity_groups_name_uq on eng.activity_groups (lower(btrim(name)));

create table eng.activities (
  id          bigint generated always as identity primary key,
  group_id    bigint not null references eng.activity_groups (id) on delete restrict,
  name        text not null check (btrim(name) <> ''),
  uom         text not null check (btrim(uom) <> ''),          -- code from purchase.uoms (Cum, Sqm, Rmt, Kg, Nos ...)
  est_rate    numeric(14,2) check (est_rate is null or est_rate >= 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now(), created_by text,
  updated_at  timestamptz not null default now(), updated_by text
);
create unique index activities_name_uq on eng.activities (group_id, lower(btrim(name)));

-- ------------------------------------------------------------------ budget
-- One row per budget line. The level is implied by which keys are set:
--   project only -> Project | + tower -> Block | + group -> Activity Group | item -> Material
create table eng.budgets (
  id          bigint generated always as identity primary key,
  project_id  bigint not null references cust.projects (id),
  tower_id    bigint references postsales.towers (id),
  group_id    bigint references eng.activity_groups (id),
  item_id     bigint references purchase.items (id),
  amount      numeric(16,2) not null check (amount >= 0),
  remarks     text,
  created_at  timestamptz not null default now(), created_by text,
  updated_at  timestamptz not null default now(), updated_by text,
  check (not (group_id is not null and item_id is not null))
);
create unique index budgets_scope_uq on eng.budgets
  (project_id, coalesce(tower_id, 0), coalesce(group_id, 0), coalesce(item_id, 0));

create or replace function eng.t_budget() returns trigger
language plpgsql set search_path = '' as
$$
declare tp bigint;
begin
  if new.tower_id is not null then
    select project_id into tp from postsales.towers where id = new.tower_id;
    if tp is distinct from new.project_id then
      raise exception 'The block does not belong to the selected project';
    end if;
  end if;
  return new;
end $$;
create trigger budgets_rules before insert or update on eng.budgets for each row execute function eng.t_budget();

-- ------------------------------------------------------------------ BOQ
-- activity x location.  Location is project (external work) | block | floor | flat | portion of a flat.
create table eng.boq_items (
  id          bigint generated always as identity primary key,
  project_id  bigint not null references cust.projects (id),
  tower_id    bigint references postsales.towers (id),
  floor_id    bigint references postsales.floors (id),
  flat_id     bigint references postsales.flats (id),
  portion     text,                                           -- Bedroom, Kitchen, Bathroom ...  (only inside a flat)
  activity_id bigint not null references eng.activities (id),
  qty         numeric(14,3) not null check (qty > 0),
  rate        numeric(14,2) not null default 0 check (rate >= 0),   -- estimated rate
  remarks     text,
  created_at  timestamptz not null default now(), created_by text,
  updated_at  timestamptz not null default now(), updated_by text,
  check (floor_id is null or tower_id is not null),
  check (flat_id  is null or floor_id is not null),
  check (portion  is null or flat_id  is not null)
);
-- the same activity cannot be entered twice for the same location
create unique index boq_items_loc_uq on eng.boq_items
  (activity_id, project_id, coalesce(tower_id, 0), coalesce(floor_id, 0), coalesce(flat_id, 0), coalesce(portion, ''));
create index boq_items_project_idx on eng.boq_items (project_id, tower_id);

-- ------------------------------------------------------------------ work orders
create table eng.work_orders (
  id            bigint generated always as identity primary key,
  wo_no         text not null unique,
  project_id    bigint not null references cust.projects (id),
  vendor_id     bigint not null references purchase.vendors (id),
  title         text not null check (btrim(title) <> ''),
  wo_date       date not null default current_date,
  start_date    date,
  end_date      date,
  retention_pct numeric(5,2) not null default 0 check (retention_pct between 0 and 100),
  tds_pct       numeric(5,2) not null default 0 check (tds_pct between 0 and 100),
  gst_pct       numeric(5,2) not null default 0 check (gst_pct between 0 and 100),
  terms         text,
  status        text not null default 'Draft' check (status in ('Draft','Issued','Closed','Cancelled')),
  issued_by text, issued_at timestamptz,
  closed_by text, closed_at timestamptz,
  cancel_reason text,
  created_at    timestamptz not null default now(), created_by text,
  updated_at    timestamptz not null default now(), updated_by text,
  check (end_date is null or start_date is null or end_date >= start_date)
);

-- tagged BOQ lines.  A BOQ line can be split across work orders; the total tagged can never exceed its quantity.
create table eng.wo_items (
  id          bigint generated always as identity primary key,
  wo_id       bigint not null references eng.work_orders (id) on delete cascade,
  boq_item_id bigint not null references eng.boq_items (id) on delete restrict,
  qty         numeric(14,3) not null check (qty > 0),
  rate        numeric(14,2) not null check (rate >= 0),
  amount      numeric(16,2) generated always as (round(qty * rate, 2)) stored,
  remarks     text,
  created_at  timestamptz not null default now(), created_by text,
  updated_at  timestamptz not null default now(), updated_by text,
  unique (wo_id, boq_item_id)
);

-- ------------------------------------------------------------------ RA bills (header only; lines are derived from work_done)
create table eng.ra_bills (
  id            bigint generated always as identity primary key,
  wo_id         bigint not null references eng.work_orders (id) on delete restrict,
  ra_seq        int  not null,
  bill_no       text not null unique,
  bill_date     date not null default current_date,
  period_from   date,
  period_to     date,
  contractor_ref text,                                         -- the contractor's own bill / invoice number
  retention_pct numeric(5,2) not null default 0 check (retention_pct between 0 and 100),
  tds_pct       numeric(5,2) not null default 0 check (tds_pct between 0 and 100),
  gst_pct       numeric(5,2) not null default 0 check (gst_pct between 0 and 100),
  other_deduction numeric(16,2) not null default 0 check (other_deduction >= 0),
  other_deduction_note text,
  remarks       text,
  status        text not null default 'Draft' check (status in ('Draft','Booked','Cancelled')),
  booked_by text, booked_at timestamptz,
  cancelled_by text, cancelled_at timestamptz, cancel_reason text,
  created_at    timestamptz not null default now(), created_by text,
  updated_at    timestamptz not null default now(), updated_by text,
  unique (wo_id, ra_seq),
  check (period_to is null or period_from is null or period_to >= period_from)
);

-- ------------------------------------------------------------------ work done
create table eng.work_done (
  id            bigint generated always as identity primary key,
  wo_item_id    bigint not null references eng.wo_items (id) on delete restrict,
  entry_date    date not null default current_date,
  qty           numeric(14,3) not null check (qty > 0),
  remarks       text,
  status        text not null default 'Entered' check (status in ('Entered','Verified','Rejected')),
  entered_by    text, entered_at timestamptz default now(),
  verified_by   text, verified_at timestamptz, verify_remarks text,
  ra_bill_id    bigint references eng.ra_bills (id) on delete restrict,
  created_at    timestamptz not null default now(), created_by text,
  updated_at    timestamptz not null default now(), updated_by text
);
create index work_done_item_idx on eng.work_done (wo_item_id);
create index work_done_bill_idx on eng.work_done (ra_bill_id);

-- ------------------------------------------------------------------ rules: BOQ
create or replace function eng.t_boq() returns trigger
language plpgsql set search_path = '' as
$$
declare tp bigint; ft bigint; fl_floor bigint; fl_tower bigint; tagged numeric;
begin
  new.portion := nullif(btrim(coalesce(new.portion, '')), '');
  if new.tower_id is not null then
    select project_id into tp from postsales.towers where id = new.tower_id;
    if tp is distinct from new.project_id then raise exception 'The block does not belong to the selected project'; end if;
  end if;
  if new.floor_id is not null then
    select tower_id into ft from postsales.floors where id = new.floor_id;
    if ft is distinct from new.tower_id then raise exception 'The floor does not belong to the selected block'; end if;
  end if;
  if new.flat_id is not null then
    select floor_id, tower_id into fl_floor, fl_tower from postsales.flats where id = new.flat_id;
    if fl_floor is distinct from new.floor_id or fl_tower is distinct from new.tower_id then
      raise exception 'The flat does not belong to the selected floor';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(sum(wi.qty), 0) into tagged
    from eng.wo_items wi join eng.work_orders w on w.id = wi.wo_id
    where wi.boq_item_id = old.id and w.status <> 'Cancelled';
    if tagged > 0 then
      if (new.project_id, new.tower_id, new.floor_id, new.flat_id, new.portion, new.activity_id)
         is distinct from (old.project_id, old.tower_id, old.floor_id, old.flat_id, old.portion, old.activity_id) then
        raise exception 'This BOQ item is already tagged to a work order, so its activity and location cannot change';
      end if;
      if new.qty < tagged then
        raise exception 'Quantity cannot go below the % already tagged to work orders', tagged;
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger boq_rules before insert or update on eng.boq_items for each row execute function eng.t_boq();

-- ------------------------------------------------------------------ rules: work orders
create or replace function eng.t_wo() returns trigger
language plpgsql set search_path = '' as
$$
declare pcode text; n int; cnt int;
begin
  if tg_op = 'INSERT' then
    select ps.code into pcode from postsales.project_setup ps where ps.project_id = new.project_id;
    pcode := coalesce(pcode, new.project_id::text);
    n := eng.next_no('WO/' || pcode);
    new.wo_no  := 'WO/' || pcode || '/' || lpad(n::text, 4, '0');
    new.status := 'Draft';
    new.issued_by := null; new.issued_at := null; new.closed_by := null; new.closed_at := null; new.cancel_reason := null;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'Draft' then raise exception 'Only a Draft work order can be deleted (cancel it instead)'; end if;
    return old;
  end if;

  -- UPDATE
  if old.status in ('Closed', 'Cancelled') then
    raise exception 'A % work order cannot be changed', lower(old.status);
  end if;
  if new.wo_no is distinct from old.wo_no or new.project_id <> old.project_id then
    raise exception 'The work order number and project cannot be changed';
  end if;
  if old.status = 'Issued' and (new.vendor_id <> old.vendor_id or new.retention_pct <> old.retention_pct
                                or new.tds_pct <> old.tds_pct or new.gst_pct <> old.gst_pct) then
    raise exception 'Contractor and commercial terms are locked once the work order is issued';
  end if;

  if new.status <> old.status then
    if old.status = 'Draft' and new.status = 'Issued' then
      select count(*) into cnt from eng.wo_items where wo_id = old.id;
      if cnt = 0 then raise exception 'Tag at least one BOQ item before issuing the work order'; end if;
      new.issued_by := nullif(eng.me(), ''); new.issued_at := now();
    elsif old.status = 'Draft' and new.status = 'Cancelled' then
      null;
    elsif old.status = 'Issued' and new.status = 'Closed' then
      if exists (select 1 from eng.work_done wd join eng.wo_items wi on wi.id = wd.wo_item_id
                 where wi.wo_id = old.id and wd.status = 'Entered') then
        raise exception 'Verify or reject the pending work done before closing this work order';
      end if;
      if exists (select 1 from eng.work_done wd join eng.wo_items wi on wi.id = wd.wo_item_id
                 where wi.wo_id = old.id and wd.status = 'Verified' and wd.ra_bill_id is null) then
        raise exception 'Bill the verified work in an RA bill before closing this work order';
      end if;
      if exists (select 1 from eng.ra_bills where wo_id = old.id and status = 'Draft') then
        raise exception 'Book or cancel the draft RA bill before closing this work order';
      end if;
      new.closed_by := nullif(eng.me(), ''); new.closed_at := now();
    elsif old.status = 'Issued' and new.status = 'Cancelled' then
      if exists (select 1 from eng.work_done wd join eng.wo_items wi on wi.id = wd.wo_item_id
                 where wi.wo_id = old.id and wd.status <> 'Rejected') then
        raise exception 'Work has been recorded against this work order; close it instead of cancelling';
      end if;
    else
      raise exception 'A work order cannot go from % to %', old.status, new.status;
    end if;
    if new.status = 'Cancelled' and nullif(btrim(coalesce(new.cancel_reason, '')), '') is null then
      raise exception 'Give a reason for cancelling the work order';
    end if;
  end if;
  return new;
end $$;
create trigger wo_rules before insert or update or delete on eng.work_orders for each row execute function eng.t_wo();

-- ------------------------------------------------------------------ rules: tagging BOQ onto a work order
create or replace function eng.t_wo_item() returns trigger
language plpgsql set search_path = '' as
$$
declare w_status text; w_project bigint; b_project bigint; b_qty numeric; used numeric; self_id bigint;
begin
  if tg_op = 'DELETE' then
    select status into w_status from eng.work_orders where id = old.wo_id;
    if found and w_status <> 'Draft' then
      raise exception 'Items can only be removed while the work order is a Draft';
    end if;
    return old;     -- (parent already gone when this is a cascade from deleting a Draft work order)
  end if;

  select status, project_id into w_status, w_project from eng.work_orders where id = new.wo_id for update;
  if w_status is distinct from 'Draft' then
    raise exception 'Items can only be changed while the work order is a Draft (it is %)', coalesce(w_status, 'missing');
  end if;
  self_id := 0;                                  -- no row has id 0, so on INSERT nothing is excluded
  if tg_op = 'UPDATE' then
    self_id := old.id;
    if new.boq_item_id <> old.boq_item_id then
      raise exception 'Remove the item and tag the other BOQ line instead';
    end if;
  end if;

  select project_id, qty into b_project, b_qty from eng.boq_items where id = new.boq_item_id for update;
  if b_project is distinct from w_project then
    raise exception 'That BOQ item belongs to a different project than this work order';
  end if;

  select coalesce(sum(wi.qty), 0) into used
  from eng.wo_items wi join eng.work_orders x on x.id = wi.wo_id
  where wi.boq_item_id = new.boq_item_id and x.status <> 'Cancelled' and wi.id <> self_id;
  if used + new.qty > b_qty then
    raise exception 'Only % of this BOQ item is still untagged', (b_qty - used);
  end if;
  return new;
end $$;
create trigger wo_item_rules before insert or update or delete on eng.wo_items for each row execute function eng.t_wo_item();

-- ------------------------------------------------------------------ rules: work done  (entered -> verified by a different person -> billed)
create or replace function eng.t_work_done() returns trigger
language plpgsql set search_path = '' as
$$
declare
  me text := eng.me();
  sup boolean := (select app.is_superadmin());
  wi_qty numeric; wi_wo bigint; w_status text; w_date date; used numeric;
  b_status text; b_wo bigint;
begin
  if tg_op = 'DELETE' then
    if old.status = 'Verified' or old.ra_bill_id is not null then
      raise exception 'Verified work cannot be deleted';
    end if;
    if lower(coalesce(old.entered_by, '')) <> me and not sup then
      raise exception 'Only the person who entered this can delete it';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    select qty, wo_id into wi_qty, wi_wo from eng.wo_items where id = new.wo_item_id for update;
    select status, wo_date into w_status, w_date from eng.work_orders where id = wi_wo;
    if w_status <> 'Issued' then raise exception 'Work done can only be entered against an issued work order (it is %)', w_status; end if;
    if new.entry_date < w_date then raise exception 'The work done date cannot be before the work order date'; end if;
    if new.entry_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'The work done date cannot be in the future'; end if;
    select coalesce(sum(qty), 0) into used from eng.work_done where wo_item_id = new.wo_item_id and status <> 'Rejected';
    if used + new.qty > wi_qty then
      raise exception 'More than the work order quantity: % of % is already recorded', used, wi_qty;
    end if;
    new.status := 'Entered';
    new.entered_by := nullif(me, ''); new.entered_at := now();
    new.verified_by := null; new.verified_at := null; new.verify_remarks := null; new.ra_bill_id := null;
    return new;
  end if;

  -- UPDATE
  if new.wo_item_id <> old.wo_item_id or new.entered_by is distinct from old.entered_by
     or new.entered_at is distinct from old.entered_at then
    raise exception 'The work order item and who entered the work cannot be changed';
  end if;

  -- already on an RA bill: frozen, except being released when that bill is cancelled
  if old.ra_bill_id is not null then
    if (new.qty, new.entry_date, new.remarks, new.status, new.verified_by, new.verified_at, new.verify_remarks)
       is distinct from (old.qty, old.entry_date, old.remarks, old.status, old.verified_by, old.verified_at, old.verify_remarks) then
      raise exception 'This work is on an RA bill and is locked';
    end if;
    if new.ra_bill_id is distinct from old.ra_bill_id then
      select status into b_status from eng.ra_bills where id = old.ra_bill_id;
      if new.ra_bill_id is not null or b_status <> 'Cancelled' then
        raise exception 'Cancel the RA bill to release this work';
      end if;
    end if;
    return new;
  end if;

  -- being attached to an RA bill
  if new.ra_bill_id is not null then
    if old.status <> 'Verified' or new.status <> 'Verified' then raise exception 'Only verified work can be billed'; end if;
    if (new.qty, new.entry_date, new.remarks, new.verified_by, new.verified_at, new.verify_remarks)
       is distinct from (old.qty, old.entry_date, old.remarks, old.verified_by, old.verified_at, old.verify_remarks) then
      raise exception 'Do not change the entry while billing it';
    end if;
    select status, wo_id into b_status, b_wo from eng.ra_bills where id = new.ra_bill_id;
    select wo_id into wi_wo from eng.wo_items where id = old.wo_item_id;
    if b_status is distinct from 'Draft' or b_wo is distinct from wi_wo then
      raise exception 'The RA bill must be a Draft bill of the same work order';
    end if;
    return new;
  end if;

  if old.status = 'Verified' then raise exception 'Verified work cannot be edited'; end if;

  if new.status = 'Entered' then
    -- edit, or re-submit after a rejection
    if old.status = 'Entered' and lower(coalesce(old.entered_by, '')) <> me and not sup then
      raise exception 'Only the person who entered this can edit it';
    end if;
    select qty, wo_id into wi_qty, wi_wo from eng.wo_items where id = new.wo_item_id for update;
    select status, wo_date into w_status, w_date from eng.work_orders where id = wi_wo;
    if w_status <> 'Issued' then raise exception 'The work order is %, so this entry can no longer be changed', w_status; end if;
    if new.entry_date < w_date then raise exception 'The work done date cannot be before the work order date'; end if;
    if new.entry_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'The work done date cannot be in the future'; end if;
    select coalesce(sum(qty), 0) into used from eng.work_done where wo_item_id = new.wo_item_id and status <> 'Rejected' and id <> old.id;
    if used + new.qty > wi_qty then
      raise exception 'More than the work order quantity: % of % is already recorded', used, wi_qty;
    end if;
    new.verified_by := null; new.verified_at := null; new.verify_remarks := null;
  elsif new.status in ('Verified', 'Rejected') then
    if old.status <> 'Entered' then raise exception 'Only entries awaiting verification can be verified or rejected'; end if;
    if (new.qty, new.entry_date, new.remarks) is distinct from (old.qty, old.entry_date, old.remarks) then
      raise exception 'Do not change the entry while verifying it';
    end if;
    if lower(coalesce(old.entered_by, '')) = me and me <> '' and not sup then
      raise exception 'You entered this work yourself, so someone else must verify it';
    end if;
    if new.status = 'Rejected' and nullif(btrim(coalesce(new.verify_remarks, '')), '') is null then
      raise exception 'Give a reason for rejecting this entry';
    end if;
    new.verified_by := nullif(me, ''); new.verified_at := now();
  end if;
  return new;
end $$;
create trigger work_done_rules before insert or update or delete on eng.work_done for each row execute function eng.t_work_done();

-- ------------------------------------------------------------------ rules: RA bills
create or replace function eng.t_ra_bill() returns trigger
language plpgsql set search_path = '' as
$$
declare w_status text; gross numeric;
begin
  if tg_op = 'DELETE' then raise exception 'RA bills cannot be deleted; cancel the bill instead'; end if;

  if tg_op = 'INSERT' then
    select status into w_status from eng.work_orders where id = new.wo_id;
    if w_status is distinct from 'Issued' then raise exception 'RA bills can only be raised on an issued work order'; end if;
    new.status := 'Draft';
    new.booked_by := null; new.booked_at := null; new.cancelled_by := null; new.cancelled_at := null; new.cancel_reason := null;
    return new;
  end if;

  if old.status = 'Cancelled' then raise exception 'A cancelled RA bill cannot be changed'; end if;
  if new.wo_id <> old.wo_id or new.ra_seq <> old.ra_seq or new.bill_no <> old.bill_no then
    raise exception 'The work order and bill number cannot be changed';
  end if;

  if old.status = 'Booked' then
    if new.status <> 'Cancelled' then raise exception 'A booked RA bill is locked; cancel it to make changes'; end if;
    if (new.bill_date, new.retention_pct, new.tds_pct, new.gst_pct, new.other_deduction)
       is distinct from (old.bill_date, old.retention_pct, old.tds_pct, old.gst_pct, old.other_deduction) then
      raise exception 'Do not change a booked bill while cancelling it';
    end if;
  elsif new.status = 'Booked' then
    select coalesce(sum(round(q * rate, 2)), 0) into gross from (
      select sum(wd.qty) q, wi.rate from eng.work_done wd join eng.wo_items wi on wi.id = wd.wo_item_id
      where wd.ra_bill_id = old.id group by wi.id, wi.rate) x;
    if gross <= 0 then raise exception 'There is no verified work on this RA bill'; end if;
    new.booked_by := nullif(eng.me(), ''); new.booked_at := now();
  elsif new.status <> 'Cancelled' and new.status <> 'Draft' then
    raise exception 'Invalid RA bill status';
  end if;

  if new.status = 'Cancelled' then
    if nullif(btrim(coalesce(new.cancel_reason, '')), '') is null then raise exception 'Give a reason for cancelling the RA bill'; end if;
    new.cancelled_by := nullif(eng.me(), ''); new.cancelled_at := now();
  end if;
  return new;
end $$;
create trigger ra_bill_rules before insert or update or delete on eng.ra_bills for each row execute function eng.t_ra_bill();

-- audit stamps on every table
do $$
declare t text;
begin
  foreach t in array array['activity_groups','activities','budgets','boq_items','work_orders','wo_items','ra_bills','work_done'] loop
    execute format('create trigger %I before insert or update on eng.%I for each row execute function eng.t_audit()', 'a_audit_' || t, t);
  end loop;
end $$;

-- ------------------------------------------------------------------ RPCs
-- Bulk-add BOQ lines (one per location); duplicates of an existing activity+location are skipped, not errors.
create or replace function eng.boq_bulk_add(p_rows jsonb) returns jsonb
language plpgsql set search_path = '' as
$$
declare r jsonb; ins int := 0; skp int := 0; n int;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into eng.boq_items (project_id, tower_id, floor_id, flat_id, portion, activity_id, qty, rate, remarks)
    values ((r ->> 'project_id')::bigint, nullif(r ->> 'tower_id', '')::bigint, nullif(r ->> 'floor_id', '')::bigint,
            nullif(r ->> 'flat_id', '')::bigint, nullif(r ->> 'portion', ''), (r ->> 'activity_id')::bigint,
            (r ->> 'qty')::numeric, coalesce(nullif(r ->> 'rate', '')::numeric, 0), nullif(r ->> 'remarks', ''))
    on conflict do nothing;
    get diagnostics n = row_count;
    if n = 1 then ins := ins + 1; else skp := skp + 1; end if;
  end loop;
  return jsonb_build_object('inserted', ins, 'skipped', skp);
end $$;

-- Raise a Draft RA bill from a set of verified, not-yet-billed work done entries of one work order.
create or replace function eng.ra_bill_create(
  p_wo bigint, p_entry_ids bigint[], p_bill_date date default current_date,
  p_period_from date default null, p_period_to date default null, p_contractor_ref text default null,
  p_other_deduction numeric default 0, p_other_note text default null, p_remarks text default null
) returns bigint
language plpgsql set search_path = '' as
$$
declare w record; ids bigint[]; ok int; seq int; bid bigint;
begin
  select wo_no, status, retention_pct, tds_pct, gst_pct into w from eng.work_orders where id = p_wo for update;
  if not found then raise exception 'Work order not found'; end if;
  if w.status <> 'Issued' then raise exception 'RA bills can only be raised on an issued work order'; end if;
  ids := (select array_agg(distinct x) from unnest(coalesce(p_entry_ids, '{}')) x);
  if ids is null then raise exception 'Select the verified work to bill'; end if;

  select count(*) into ok
  from eng.work_done wd join eng.wo_items wi on wi.id = wd.wo_item_id
  where wd.id = any (ids) and wi.wo_id = p_wo and wd.status = 'Verified' and wd.ra_bill_id is null;
  if ok <> cardinality(ids) then
    raise exception 'Only verified work of this work order that is not already billed can go on an RA bill';
  end if;

  seq := eng.next_no('RA/' || p_wo);
  insert into eng.ra_bills (wo_id, ra_seq, bill_no, bill_date, period_from, period_to, contractor_ref,
                            retention_pct, tds_pct, gst_pct, other_deduction, other_deduction_note, remarks)
  values (p_wo, seq, w.wo_no || '/RA-' || lpad(seq::text, 2, '0'), coalesce(p_bill_date, current_date), p_period_from, p_period_to,
          nullif(btrim(coalesce(p_contractor_ref, '')), ''), w.retention_pct, w.tds_pct, w.gst_pct,
          coalesce(p_other_deduction, 0), nullif(btrim(coalesce(p_other_note, '')), ''), nullif(btrim(coalesce(p_remarks, '')), ''))
  returning id into bid;

  update eng.work_done set ra_bill_id = bid where id = any (ids);
  return bid;
end $$;

create or replace function eng.ra_bill_book(p_id bigint) returns void
language plpgsql set search_path = '' as
$$
begin
  update eng.ra_bills set status = 'Booked' where id = p_id and status = 'Draft';
  if not found then raise exception 'Only a Draft RA bill can be booked'; end if;
end $$;

create or replace function eng.ra_bill_cancel(p_id bigint, p_reason text) returns void
language plpgsql set search_path = '' as
$$
begin
  update eng.ra_bills set status = 'Cancelled', cancel_reason = p_reason where id = p_id;
  if not found then raise exception 'RA bill not found'; end if;
  update eng.work_done set ra_bill_id = null where ra_bill_id = p_id;    -- releases the work so it can be billed again
end $$;

-- ------------------------------------------------------------------ views (security_invoker: RLS of the caller applies)
create view eng.v_boq with (security_invoker = true) as
select bi.id, bi.project_id, p.name as project_name, p.code as project_code,
       bi.tower_id, t.name as tower_name, coalesce(t.sort_order, -1) as tower_sort,
       bi.floor_id, f.floor_no, coalesce(f.label, 'Floor ' || f.floor_no) as floor_label,
       bi.flat_id, fl.flat_code, bi.portion,
       case when bi.portion is not null then 'Portion' when bi.flat_id is not null then 'Flat'
            when bi.floor_id is not null then 'Floor' when bi.tower_id is not null then 'Block' else 'Project' end as location_level,
       coalesce(nullif(concat_ws(' › ', t.name,
                  case when f.id  is not null then coalesce(f.label, 'Floor ' || f.floor_no) end,
                  case when fl.id is not null then 'Flat ' || fl.flat_code end,
                  bi.portion), ''), 'Project (external work)') as location_label,
       bi.activity_id, a.name as activity_name, a.uom, a.group_id, g.name as group_name, g.sort_order as group_sort,
       bi.qty, bi.rate, round(bi.qty * bi.rate, 2) as value, bi.remarks,
       coalesce(tg.tagged, 0) as tagged_qty, bi.qty - coalesce(tg.tagged, 0) as remaining_qty,
       bi.created_at, bi.created_by
from eng.boq_items bi
join eng.projects() p on p.id = bi.project_id
join eng.activities a on a.id = bi.activity_id
join eng.activity_groups g on g.id = a.group_id
left join postsales.towers t on t.id = bi.tower_id
left join postsales.floors f on f.id = bi.floor_id
left join postsales.flats fl on fl.id = bi.flat_id
left join lateral (select sum(wi.qty) as tagged
                   from eng.wo_items wi join eng.work_orders w on w.id = wi.wo_id
                   where wi.boq_item_id = bi.id and w.status <> 'Cancelled') tg on true;

create view eng.v_wo_item_progress with (security_invoker = true) as
select wi.id as wo_item_id,
       coalesce(sum(wd.qty) filter (where wd.status = 'Entered'), 0)                                   as pending_qty,
       coalesce(sum(wd.qty) filter (where wd.status = 'Verified'), 0)                                  as verified_qty,
       coalesce(sum(wd.qty) filter (where wd.status = 'Verified' and wd.ra_bill_id is null), 0)        as unbilled_qty,
       coalesce(sum(wd.qty) filter (where wd.ra_bill_id is not null and rb.status = 'Draft'), 0)       as draft_billed_qty,
       coalesce(sum(wd.qty) filter (where wd.ra_bill_id is not null and rb.status = 'Booked'), 0)      as billed_qty
from eng.wo_items wi
left join eng.work_done wd on wd.wo_item_id = wi.id
left join eng.ra_bills rb on rb.id = wd.ra_bill_id
group by wi.id;

create view eng.v_wo_items with (security_invoker = true) as
select wi.id, wi.wo_id, w.wo_no, w.status as wo_status, w.project_id, wi.boq_item_id,
       b.activity_name, b.group_name, b.uom, b.location_label, b.location_level, b.tower_name, b.tower_sort, b.floor_no, b.flat_code,
       wi.qty, wi.rate, wi.amount, wi.remarks,
       pr.pending_qty, pr.verified_qty, pr.unbilled_qty, pr.draft_billed_qty, pr.billed_qty,
       round(pr.verified_qty * wi.rate, 2) as verified_amount,
       round(pr.billed_qty * wi.rate, 2)   as billed_amount
from eng.wo_items wi
join eng.work_orders w on w.id = wi.wo_id
join eng.v_boq b on b.id = wi.boq_item_id
join eng.v_wo_item_progress pr on pr.wo_item_id = wi.id;

create view eng.v_work_orders with (security_invoker = true) as
select w.*, p.name as project_name, coalesce(v.trade_name, v.legal_name) as vendor_name,
       coalesce(s.item_count, 0) as item_count, coalesce(s.value, 0) as value,
       coalesce(s.verified_value, 0) as verified_value, coalesce(s.billed_value, 0) as billed_value,
       coalesce(s.pending_qty_items, 0) as pending_items
from eng.work_orders w
join eng.projects() p on p.id = w.project_id
left join purchase.vendors v on v.id = w.vendor_id
left join lateral (select count(*) as item_count, sum(amount) as value, sum(verified_amount) as verified_value,
                          sum(billed_amount) as billed_value, count(*) filter (where pending_qty > 0) as pending_qty_items
                   from eng.v_wo_items where wo_id = w.id) s on true;

create view eng.v_work_done with (security_invoker = true) as
select wd.id, wd.wo_item_id, wi.wo_id, w.wo_no, w.status as wo_status, w.project_id,
       b.activity_name, b.group_name, b.uom, b.location_label,
       wd.entry_date, wd.qty, wi.rate, round(wd.qty * wi.rate, 2) as value, wd.remarks,
       wd.status, wd.entered_by, wd.entered_at, wd.verified_by, wd.verified_at, wd.verify_remarks,
       wd.ra_bill_id, rb.bill_no, rb.status as bill_status
from eng.work_done wd
join eng.wo_items wi on wi.id = wd.wo_item_id
join eng.work_orders w on w.id = wi.wo_id
join eng.v_boq b on b.id = wi.boq_item_id
left join eng.ra_bills rb on rb.id = wd.ra_bill_id;

create view eng.v_ra_bill_lines with (security_invoker = true) as
select rb.id as ra_bill_id, rb.wo_id, wi.id as wo_item_id,
       b.activity_name, b.group_name, b.uom, b.location_label,
       wi.qty as wo_qty, wi.rate,
       sum(wd.qty) as qty,
       round(sum(wd.qty) * wi.rate, 2) as amount,
       coalesce((select sum(w2.qty) from eng.work_done w2 join eng.ra_bills r2 on r2.id = w2.ra_bill_id
                 where w2.wo_item_id = wi.id and r2.wo_id = rb.wo_id and r2.ra_seq < rb.ra_seq), 0) as prev_qty
from eng.ra_bills rb
join eng.work_done wd on wd.ra_bill_id = rb.id
join eng.wo_items wi on wi.id = wd.wo_item_id
join eng.v_boq b on b.id = wi.boq_item_id
group by rb.id, rb.wo_id, rb.ra_seq, wi.id, wi.qty, wi.rate, b.activity_name, b.group_name, b.uom, b.location_label;

create view eng.v_ra_bills with (security_invoker = true) as
with g as (select ra_bill_id, sum(amount) as gross from eng.v_ra_bill_lines group by ra_bill_id)
select rb.*, w.wo_no, w.project_id, p.name as project_name, w.vendor_id,
       coalesce(v.trade_name, v.legal_name) as vendor_name,
       coalesce(g.gross, 0) as gross,
       round(coalesce(g.gross, 0) * rb.gst_pct / 100, 2)       as gst_amt,
       round(coalesce(g.gross, 0) * rb.retention_pct / 100, 2) as retention_amt,
       round(coalesce(g.gross, 0) * rb.tds_pct / 100, 2)       as tds_amt,
       coalesce(g.gross, 0) + round(coalesce(g.gross, 0) * rb.gst_pct / 100, 2)
         - round(coalesce(g.gross, 0) * rb.retention_pct / 100, 2)
         - round(coalesce(g.gross, 0) * rb.tds_pct / 100, 2) - rb.other_deduction as net_payable,
       coalesce((select sum(g2.gross) from g g2 join eng.ra_bills r2 on r2.id = g2.ra_bill_id
                 where r2.wo_id = rb.wo_id and r2.ra_seq < rb.ra_seq), 0) as prev_gross
from eng.ra_bills rb
join eng.work_orders w on w.id = rb.wo_id
join eng.projects() p on p.id = w.project_id
left join purchase.vendors v on v.id = w.vendor_id
left join g on g.ra_bill_id = rb.id;

create view eng.v_budget_status with (security_invoker = true) as
select b.id, b.project_id, p.name as project_name, b.tower_id, t.name as tower_name,
       b.group_id, g.name as group_name, b.item_id, i.name as item_name, i.code as item_code,
       case when b.item_id is not null then 'Material' when b.group_id is not null then 'Activity Group'
            when b.tower_id is not null then 'Block' else 'Project' end as level,
       b.amount, b.remarks, b.created_at,
       case when b.item_id is null then bq.boq_value end as boq_value,
       case when b.item_id is null then wo.committed end as committed,
       case when b.item_id is null then wo.verified end as verified,
       case when b.item_id is null then wo.billed end as billed
from eng.budgets b
join eng.projects() p on p.id = b.project_id
left join postsales.towers t on t.id = b.tower_id
left join eng.activity_groups g on g.id = b.group_id
left join purchase.items i on i.id = b.item_id
left join lateral (
  select coalesce(sum(round(bi.qty * bi.rate, 2)), 0) as boq_value
  from eng.boq_items bi join eng.activities a on a.id = bi.activity_id
  where bi.project_id = b.project_id and (b.tower_id is null or bi.tower_id = b.tower_id)
    and (b.group_id is null or a.group_id = b.group_id)) bq on true
left join lateral (
  select coalesce(sum(wi.amount), 0) as committed,
         coalesce(sum(round(pr.verified_qty * wi.rate, 2)), 0) as verified,
         coalesce(sum(round(pr.billed_qty * wi.rate, 2)), 0) as billed
  from eng.wo_items wi
  join eng.work_orders w on w.id = wi.wo_id and w.status <> 'Cancelled'
  join eng.boq_items bi on bi.id = wi.boq_item_id
  join eng.activities a on a.id = bi.activity_id
  join eng.v_wo_item_progress pr on pr.wo_item_id = wi.id
  where bi.project_id = b.project_id and (b.tower_id is null or bi.tower_id = b.tower_id)
    and (b.group_id is null or a.group_id = b.group_id)) wo on true;

-- ------------------------------------------------------------------ security: RLS + grants
do $$
declare t text;
begin
  foreach t in array array['activity_groups','activities','budgets','boq_items','work_orders','wo_items','ra_bills','work_done'] loop
    execute format('alter table eng.%I enable row level security', t);
    execute format($p$create policy %I on eng.%I for all to authenticated
                      using ((select app.has_module('engineering'))) with check ((select app.has_module('engineering')))$p$,
                   t || '_module', t);
    execute format('grant select, insert, update, delete on eng.%I to authenticated', t);
  end loop;
end $$;

grant usage on schema eng to authenticated;
grant select on eng.v_boq, eng.v_wo_item_progress, eng.v_wo_items, eng.v_work_orders, eng.v_work_done,
                eng.v_ra_bill_lines, eng.v_ra_bills, eng.v_budget_status to authenticated;
revoke execute on all functions in schema eng from public, anon;
grant  execute on all functions in schema eng to authenticated;

-- expose the schema to the Data API (append to whatever list is currently configured)
do $$
declare cur text;
begin
  select split_part(c, '=', 2) into cur
  from pg_db_role_setting s join pg_roles r on r.oid = s.setrole, unnest(s.setconfig) c
  where r.rolname = 'authenticator' and c like 'pgrst.db_schemas=%';
  if cur is not null and (',' || cur || ',') not like '%,eng,%' then
    execute format('alter role authenticator set pgrst.db_schemas = %L', cur || ',eng');
  end if;
end $$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';

-- ------------------------------------------------------------------ starter masters (editable in the UI)
-- Groups mirror the Inspection module's work categories so the two modules speak the same language.
insert into eng.activity_groups (name, sort_order) values
  ('RCC Work',1),('Masonry Work',2),('Excavation & Earthwork',3),('Plastering',4),('Waterproofing',5),('Flooring',6),
  ('Putty Work',7),('Electrical Work',8),('Plumbing Work',9),('False Ceiling Work',10),('Paint Work',11),
  ('Landscape Development',12),('Fire Fighting Work',13),('Piling',14);

insert into eng.activities (group_id, name, uom)
select g.id, a.name, a.uom
from (values
  ('RCC Work','PCC','Cum'),('RCC Work','Shuttering','Sqm'),('RCC Work','Reinforcement','Kg'),('RCC Work','Concreting','Cum'),
  ('Masonry Work','Brick masonry','Cum'),('Masonry Work','AAC block masonry','Cum'),
  ('Excavation & Earthwork','Excavation in soil','Cum'),('Excavation & Earthwork','Backfilling','Cum'),('Excavation & Earthwork','Earth filling & compaction','Cum'),
  ('Plastering','Internal plaster','Sqm'),('Plastering','External plaster','Sqm'),('Plastering','Ceiling plaster','Sqm'),
  ('Waterproofing','Bathroom / toilet waterproofing','Sqm'),('Waterproofing','Terrace waterproofing','Sqm'),('Waterproofing','Basement waterproofing','Sqm'),
  ('Flooring','Vitrified tile flooring','Sqm'),('Flooring','Wall tiling','Sqm'),('Flooring','Skirting','Rmt'),('Flooring','Granite counter','Sqm'),
  ('Putty Work','Wall putty','Sqm'),('Putty Work','Ceiling putty','Sqm'),
  ('Electrical Work','Conduiting & wiring','Nos'),('Electrical Work','Switch / socket fitting','Nos'),('Electrical Work','DB & MCB installation','Nos'),
  ('Plumbing Work','Water supply piping','Rmt'),('Plumbing Work','Drainage piping','Rmt'),('Plumbing Work','Sanitary & CP fixtures','Nos'),
  ('False Ceiling Work','Gypsum false ceiling','Sqm'),
  ('Paint Work','Internal painting','Sqm'),('Paint Work','External painting','Sqm'),
  ('Landscape Development','Paving','Sqm'),('Landscape Development','Turfing','Sqm'),('Landscape Development','Plantation','Nos'),
  ('Fire Fighting Work','Fire fighting piping','Rmt'),('Fire Fighting Work','Sprinkler heads','Nos'),
  ('Piling','Bored cast-in-situ pile','Rmt'),('Piling','Pile load test','Nos')
) as a(grp, name, uom)
join eng.activity_groups g on g.name = a.grp;

-- ------------------------------------------------------------------ project summary for the Overview tab
-- (applied as migration "engineering_project_summary")
create view eng.v_project_summary with (security_invoker = true) as
select p.id as project_id, p.name as project_name, p.code as project_code,
  (select count(*) from eng.boq_items b where b.project_id = p.id) as boq_lines,
  (select coalesce(sum(round(b.qty * b.rate, 2)), 0) from eng.boq_items b where b.project_id = p.id) as boq_value,
  (select coalesce(sum(i.amount), 0) from eng.v_wo_items i where i.project_id = p.id and i.wo_status <> 'Cancelled') as committed,
  (select coalesce(sum(i.verified_amount), 0) from eng.v_wo_items i where i.project_id = p.id and i.wo_status <> 'Cancelled') as verified,
  (select coalesce(sum(i.billed_amount), 0) from eng.v_wo_items i where i.project_id = p.id and i.wo_status <> 'Cancelled') as billed,
  (select coalesce(sum(round(i.unbilled_qty * i.rate, 2)), 0) from eng.v_wo_items i where i.project_id = p.id and i.wo_status = 'Issued') as unbilled_value,
  (select count(*) from eng.work_orders w where w.project_id = p.id and w.status = 'Draft') as wo_draft,
  (select count(*) from eng.work_orders w where w.project_id = p.id and w.status = 'Issued') as wo_issued,
  (select count(*) from eng.work_done wd join eng.wo_items wi on wi.id = wd.wo_item_id join eng.work_orders w on w.id = wi.wo_id
    where w.project_id = p.id and wd.status = 'Entered') as awaiting_verification,
  (select count(*) from eng.ra_bills r join eng.work_orders w on w.id = r.wo_id where w.project_id = p.id and r.status = 'Draft') as ra_draft
from eng.projects() p;
grant select on eng.v_project_summary to authenticated;

