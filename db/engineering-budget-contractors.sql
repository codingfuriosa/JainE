-- =====================================================================================
-- JAIN-E · Engineering — INFLOW/OUTFLOW BUDGETS and SUB-CONTRACTORS
-- Apply AFTER db/engineering-schema.sql and db/engineering-amendments.sql.
-- Applied to Supabase as migration "engineering_inflow_and_subcontractors".
--
-- Budgets:  every line is Outflow (cost — compared with work orders / RA bills) or Inflow (expected
--           collections — compared with receipts recorded in Post Sales, net of refunds).  Inflow is set
--           against a project or a block only.
-- Contractors: a work order's contractor (vendor_id) is its PARENT (main) contractor.  Sub-contractors are
--           added to the work order, and each item can be assigned to one of them, so work and value can be
--           read per sub-contractor.
-- =====================================================================================

-- ---------------------------------------------------------------- budgets: direction
alter table eng.budgets add column direction text not null default 'Outflow' check (direction in ('Outflow','Inflow'));
alter table eng.budgets add constraint budgets_inflow_scope check (direction = 'Outflow' or (group_id is null and item_id is null));
drop index eng.budgets_scope_uq;
create unique index budgets_scope_uq on eng.budgets
  (project_id, direction, coalesce(tower_id, 0), coalesce(group_id, 0), coalesce(item_id, 0));

-- ---------------------------------------------------------------- sub-contractors
create table eng.wo_subcontractors (
  id          bigint generated always as identity primary key,
  wo_id       bigint not null references eng.work_orders (id) on delete cascade,
  vendor_id   bigint not null references purchase.vendors (id),
  scope       text,                                           -- what they are doing, free text
  created_at  timestamptz not null default now(), created_by text,
  updated_at  timestamptz not null default now(), updated_by text,
  unique (wo_id, vendor_id)
);
alter table eng.wo_items add column sub_vendor_id bigint references purchase.vendors (id);   -- null = done by the parent contractor itself

create or replace function eng.t_wo_sub() returns trigger
language plpgsql set search_path = '' as
$$
declare w_status text; w_vendor bigint; n int;
begin
  if tg_op = 'DELETE' then
    select status into w_status from eng.work_orders where id = old.wo_id;
    if found then                                           -- (not a cascade from deleting the work order itself)
      if w_status not in ('Draft', 'Issued') then
        raise exception 'Sub-contractors cannot be changed on a % work order', lower(w_status);
      end if;
      select count(*) into n from eng.wo_items where wo_id = old.wo_id and sub_vendor_id = old.vendor_id;
      if n > 0 then raise exception 'Reassign the % item(s) given to this sub-contractor before removing it', n; end if;
    end if;
    return old;
  end if;

  select status, vendor_id into w_status, w_vendor from eng.work_orders where id = new.wo_id;
  if w_status is null or w_status not in ('Draft', 'Issued') then
    raise exception 'Sub-contractors can only be added while the work order is a Draft or Issued';
  end if;
  if new.vendor_id = w_vendor then raise exception 'The parent contractor cannot also be a sub-contractor on its own work order'; end if;
  if tg_op = 'UPDATE' and (new.wo_id <> old.wo_id or new.vendor_id <> old.vendor_id) then
    raise exception 'Remove the sub-contractor and add the other one instead';
  end if;
  return new;
end $$;
create trigger wo_sub_rules before insert or update or delete on eng.wo_subcontractors for each row execute function eng.t_wo_sub();
create trigger a_audit_wo_subcontractors before insert or update on eng.wo_subcontractors for each row execute function eng.t_audit();
alter table eng.wo_subcontractors enable row level security;
create policy wo_subcontractors_module on eng.wo_subcontractors for all to authenticated
  using ((select app.has_module('engineering'))) with check ((select app.has_module('engineering')));
grant select, insert, update, delete on eng.wo_subcontractors to authenticated;

-- item rules: assigning an item to a sub-contractor is allowed on a Draft or Issued work order (it is not a commercial change)
create or replace function eng.t_wo_item() returns trigger
language plpgsql set search_path = '' as
$$
declare
  w_status text; w_project bigint; b_project bigint; b_qty numeric; used numeric; self_id bigint := 0; executed numeric;
  assign_only boolean := false;
  amending boolean := coalesce(current_setting('eng.amending', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    select status into w_status from eng.work_orders where id = old.wo_id;
    if found and w_status <> 'Draft' then
      raise exception 'Items can only be removed while the work order is a Draft — short-close the item in an amendment instead';
    end if;
    return old;     -- (parent already gone when this is a cascade from deleting a Draft work order)
  end if;

  select status, project_id into w_status, w_project from eng.work_orders where id = new.wo_id for update;

  if tg_op = 'UPDATE' then
    assign_only := new.wo_id = old.wo_id and new.boq_item_id = old.boq_item_id and new.qty = old.qty
                   and new.rate = old.rate and new.amend_no = old.amend_no;
  end if;
  if new.sub_vendor_id is not null and (tg_op = 'INSERT' or new.sub_vendor_id is distinct from old.sub_vendor_id) then
    if not exists (select 1 from eng.wo_subcontractors where wo_id = new.wo_id and vendor_id = new.sub_vendor_id) then
      raise exception 'That contractor is not a sub-contractor on this work order — add it to the work order first';
    end if;
  end if;
  if assign_only then
    if w_status not in ('Draft', 'Issued') then
      raise exception 'The sub-contractor of an item cannot change on a % work order', lower(w_status);
    end if;
    return new;
  end if;

  if w_status is distinct from 'Draft' and not (amending and w_status = 'Issued') then
    raise exception 'Items can only be changed while the work order is a Draft; an issued work order is changed through an amendment (it is %)', coalesce(w_status, 'missing');
  end if;
  if tg_op = 'UPDATE' then
    self_id := old.id;
    if new.boq_item_id <> old.boq_item_id or new.wo_id <> old.wo_id then
      raise exception 'Remove the item and tag the other BOQ line instead';
    end if;
    select coalesce(sum(qty), 0) into executed from eng.work_done where wo_item_id = old.id and status <> 'Rejected';
    if new.qty < executed then
      raise exception 'Quantity cannot go below the % already entered as work done', executed;
    end if;
    if new.rate <> old.rate and executed > 0 then
      raise exception 'The rate cannot change once work has been entered against the item — amend the work order to move the balance to a new rate';
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

-- the parent contractor of a Draft work order cannot be switched to one of its own sub-contractors
create or replace function eng.t_wo() returns trigger
language plpgsql set search_path = '' as
$$
declare pcode text; n int; cnt int;
        amending boolean := coalesce(current_setting('eng.amending', true), '') = 'on';
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

  if old.status in ('Closed', 'Cancelled') then
    raise exception 'A % work order cannot be changed', lower(old.status);
  end if;
  if new.wo_no is distinct from old.wo_no or new.project_id <> old.project_id then
    raise exception 'The work order number and project cannot be changed';
  end if;
  if old.status = 'Issued' and new.vendor_id <> old.vendor_id then
    raise exception 'The parent contractor cannot be changed once the work order is issued';
  end if;
  if new.vendor_id <> old.vendor_id and exists (select 1 from eng.wo_subcontractors where wo_id = old.id and vendor_id = new.vendor_id) then
    raise exception 'That contractor is already a sub-contractor on this work order — remove it there first';
  end if;
  if old.status = 'Issued' and not amending and
     (new.retention_pct <> old.retention_pct or new.tds_pct <> old.tds_pct or new.gst_pct <> old.gst_pct
      or new.end_date is distinct from old.end_date or new.terms is distinct from old.terms) then
    raise exception 'Commercial terms, end date and conditions are locked once the work order is issued — amend the work order';
  end if;

  if new.status <> old.status then
    if old.status = 'Draft' and new.status = 'Issued' then
      select count(*) into cnt from eng.wo_items where wo_id = old.id;
      if cnt = 0 then raise exception 'Tag at least one BOQ item before issuing the work order'; end if;
      new.issued_by := nullif(eng.me(), ''); new.issued_at := now();
    elsif old.status = 'Draft' and new.status = 'Cancelled' then
      null;
    elsif old.status = 'Issued' and new.status = 'Closed' then
      if exists (select 1 from eng.wo_amendments where wo_id = old.id and status = 'Draft') then
        raise exception 'Issue or cancel the draft amendment before closing this work order';
      end if;
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
      if exists (select 1 from eng.wo_amendments where wo_id = old.id and status = 'Issued') then
        raise exception 'This work order has been amended; close it instead of cancelling';
      end if;
      if exists (select 1 from eng.wo_amendments where wo_id = old.id and status = 'Draft') then
        raise exception 'Cancel the draft amendment before cancelling this work order';
      end if;
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

-- a rate-split in an amendment keeps the sub-contractor of the item it came from
create or replace function eng.wo_amend_issue(p_id bigint) returns void
language plpgsql set search_path = '' as
$$
declare
  a record; w record; it record; wi record; executed numeric; res bigint;
  v_before numeric; v_after numeric; changed int := 0; old_t jsonb;
begin
  perform set_config('eng.amending', 'on', true);
  select * into a from eng.wo_amendments where id = p_id for update;
  if not found then raise exception 'Amendment not found'; end if;
  if a.status <> 'Draft' then raise exception 'Only a draft amendment can be issued (it is %)', a.status; end if;
  select * into w from eng.work_orders where id = a.wo_id for update;
  if w.status <> 'Issued' then raise exception 'Only an issued work order can be amended (it is %)', w.status; end if;

  select coalesce(sum(amount), 0) into v_before from eng.wo_items where wo_id = a.wo_id;
  old_t := jsonb_build_object('end_date', w.end_date, 'terms', w.terms, 'retention_pct', w.retention_pct, 'tds_pct', w.tds_pct, 'gst_pct', w.gst_pct);

  for it in select * from eng.wo_amendment_items where amendment_id = p_id order by id loop
    if it.action = 'change' then
      select * into wi from eng.wo_items where id = it.wo_item_id for update;
      if wi.wo_id <> a.wo_id then raise exception 'An amendment line refers to an item of another work order'; end if;
      select coalesce(sum(qty), 0) into executed from eng.work_done where wo_item_id = wi.id and status <> 'Rejected';
      if it.new_qty < executed then
        raise exception 'The new quantity of an item is below the % already entered as work done', executed;
      end if;
      update eng.wo_amendment_items set old_qty = wi.qty, old_rate = wi.rate, executed_qty = executed where id = it.id;
      res := null;
      if it.new_qty = wi.qty and it.new_rate = wi.rate then
        null;
      elsif it.new_rate = wi.rate or executed = 0 then
        update eng.wo_items set qty = it.new_qty, rate = it.new_rate where id = wi.id;
        changed := changed + 1;
      else
        update eng.wo_items set qty = executed where id = wi.id;
        if it.new_qty > executed then
          insert into eng.wo_items (wo_id, boq_item_id, qty, rate, amend_no, sub_vendor_id)
          values (a.wo_id, wi.boq_item_id, it.new_qty - executed, it.new_rate, a.amend_no, wi.sub_vendor_id) returning id into res;
        end if;
        changed := changed + 1;
      end if;
      update eng.wo_amendment_items set result_wo_item_id = res where id = it.id;
    else
      insert into eng.wo_items (wo_id, boq_item_id, qty, rate, amend_no)
      values (a.wo_id, it.boq_item_id, it.new_qty, it.new_rate, a.amend_no) returning id into res;
      update eng.wo_amendment_items set result_wo_item_id = res where id = it.id;
      changed := changed + 1;
    end if;
  end loop;

  if (a.new_end_date is not null and a.new_end_date is distinct from w.end_date)
     or (a.new_terms is not null and a.new_terms is distinct from w.terms)
     or (a.new_retention_pct is not null and a.new_retention_pct <> w.retention_pct)
     or (a.new_tds_pct is not null and a.new_tds_pct <> w.tds_pct)
     or (a.new_gst_pct is not null and a.new_gst_pct <> w.gst_pct) then
    update eng.work_orders set
      end_date = coalesce(a.new_end_date, end_date), terms = coalesce(a.new_terms, terms),
      retention_pct = coalesce(a.new_retention_pct, retention_pct), tds_pct = coalesce(a.new_tds_pct, tds_pct),
      gst_pct = coalesce(a.new_gst_pct, gst_pct)
    where id = a.wo_id;
    changed := changed + 1;
  end if;
  if changed = 0 then raise exception 'This amendment changes nothing — adjust a quantity, rate, item or term first'; end if;

  select coalesce(sum(amount), 0) into v_after from eng.wo_items where wo_id = a.wo_id;
  update eng.wo_amendments set status = 'Issued', value_before = v_before, value_after = v_after, old_terms = old_t where id = p_id;
end $$;

-- ---------------------------------------------------------------- views (new columns are appended at the end)
create or replace view eng.v_wo_items with (security_invoker = true) as
select wi.id, wi.wo_id, w.wo_no, w.status as wo_status, w.project_id, wi.boq_item_id,
       b.activity_name, b.group_name, b.uom, b.location_label, b.location_level, b.tower_name, b.tower_sort, b.floor_no, b.flat_code,
       wi.qty, wi.rate, wi.amount, wi.remarks,
       pr.pending_qty, pr.verified_qty, pr.unbilled_qty, pr.draft_billed_qty, pr.billed_qty,
       round(pr.verified_qty * wi.rate, 2) as verified_amount,
       round(pr.billed_qty * wi.rate, 2)   as billed_amount,
       wi.amend_no,
       wi.sub_vendor_id, coalesce(sv.trade_name, sv.legal_name) as sub_vendor_name
from eng.wo_items wi
join eng.work_orders w on w.id = wi.wo_id
join eng.v_boq b on b.id = wi.boq_item_id
join eng.v_wo_item_progress pr on pr.wo_item_id = wi.id
left join purchase.vendors sv on sv.id = wi.sub_vendor_id;

create or replace view eng.v_work_orders with (security_invoker = true) as
select w.*, p.name as project_name, coalesce(v.trade_name, v.legal_name) as vendor_name,
       coalesce(s.item_count, 0) as item_count, coalesce(s.value, 0) as value,
       coalesce(s.verified_value, 0) as verified_value, coalesce(s.billed_value, 0) as billed_value,
       coalesce(s.pending_qty_items, 0) as pending_items,
       (select count(*) from eng.wo_subcontractors x where x.wo_id = w.id) as sub_count,
       (select string_agg(coalesce(sv.trade_name, sv.legal_name), ', ' order by coalesce(sv.trade_name, sv.legal_name))
          from eng.wo_subcontractors x join purchase.vendors sv on sv.id = x.vendor_id where x.wo_id = w.id) as sub_names
from eng.work_orders w
join eng.projects() p on p.id = w.project_id
left join purchase.vendors v on v.id = w.vendor_id
left join lateral (select count(*) filter (where qty > 0) as item_count, sum(amount) as value, sum(verified_amount) as verified_value,
                          sum(billed_amount) as billed_value, count(*) filter (where pending_qty > 0) as pending_qty_items
                   from eng.v_wo_items where wo_id = w.id) s on true;

create or replace view eng.v_work_done with (security_invoker = true) as
select wd.id, wd.wo_item_id, wi.wo_id, w.wo_no, w.status as wo_status, w.project_id,
       b.activity_name, b.group_name, b.uom, b.location_label,
       wd.entry_date, wd.qty, wi.rate, round(wd.qty * wi.rate, 2) as value, wd.remarks,
       wd.status, wd.entered_by, wd.entered_at, wd.verified_by, wd.verified_at, wd.verify_remarks,
       wd.ra_bill_id, rb.bill_no, rb.status as bill_status,
       wi.sub_vendor_id, coalesce(sv.trade_name, sv.legal_name) as sub_vendor_name
from eng.work_done wd
join eng.wo_items wi on wi.id = wd.wo_item_id
join eng.work_orders w on w.id = wi.wo_id
join eng.v_boq b on b.id = wi.boq_item_id
left join eng.ra_bills rb on rb.id = wd.ra_bill_id
left join purchase.vendors sv on sv.id = wi.sub_vendor_id;

create or replace view eng.v_ra_bill_lines with (security_invoker = true) as
select rb.id as ra_bill_id, rb.wo_id, wi.id as wo_item_id,
       b.activity_name, b.group_name, b.uom, b.location_label,
       wi.qty as wo_qty, wi.rate,
       sum(wd.qty) as qty,
       round(sum(wd.qty) * wi.rate, 2) as amount,
       coalesce((select sum(w2.qty) from eng.work_done w2 join eng.ra_bills r2 on r2.id = w2.ra_bill_id
                 where w2.wo_item_id = wi.id and r2.wo_id = rb.wo_id and r2.ra_seq < rb.ra_seq), 0) as prev_qty,
       coalesce(sv.trade_name, sv.legal_name) as sub_vendor_name
from eng.ra_bills rb
join eng.work_done wd on wd.ra_bill_id = rb.id
join eng.wo_items wi on wi.id = wd.wo_item_id
join eng.v_boq b on b.id = wi.boq_item_id
left join purchase.vendors sv on sv.id = wi.sub_vendor_id
group by rb.id, rb.wo_id, rb.ra_seq, wi.id, wi.qty, wi.rate, b.activity_name, b.group_name, b.uom, b.location_label, sv.trade_name, sv.legal_name;

create or replace view eng.v_ra_bills with (security_invoker = true) as
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
                 where r2.wo_id = rb.wo_id and r2.ra_seq < rb.ra_seq), 0) as prev_gross,
       (select string_agg(coalesce(sv.trade_name, sv.legal_name), ', ' order by coalesce(sv.trade_name, sv.legal_name))
          from eng.wo_subcontractors x join purchase.vendors sv on sv.id = x.vendor_id where x.wo_id = rb.wo_id) as sub_names
from eng.ra_bills rb
join eng.work_orders w on w.id = rb.wo_id
join eng.projects() p on p.id = w.project_id
left join purchase.vendors v on v.id = w.vendor_id
left join g on g.ra_bill_id = rb.id;

create view eng.v_wo_subcontractors with (security_invoker = true) as
select s.id, s.wo_id, s.vendor_id, coalesce(v.trade_name, v.legal_name) as vendor_name, v.code as vendor_code, s.scope,
       coalesce(x.item_count, 0) as item_count, coalesce(x.value, 0) as value,
       coalesce(x.verified_value, 0) as verified_value, coalesce(x.billed_value, 0) as billed_value
from eng.wo_subcontractors s
join purchase.vendors v on v.id = s.vendor_id
left join lateral (select count(*) filter (where i.qty > 0) as item_count, sum(i.amount) as value,
                          sum(i.verified_amount) as verified_value, sum(i.billed_amount) as billed_value
                   from eng.v_wo_items i where i.wo_id = s.wo_id and i.sub_vendor_id = s.vendor_id) x on true;

-- value per parent contractor and sub-contractor (sub is null where the parent does the work itself); issued and closed work orders only
create view eng.v_contractor_summary with (security_invoker = true) as
select w.project_id, p.name as project_name,
       w.vendor_id as parent_id, coalesce(pv.trade_name, pv.legal_name) as parent_name,
       i.sub_vendor_id as sub_id, coalesce(sv.trade_name, sv.legal_name) as sub_name,
       count(distinct w.id) as wo_count,
       coalesce(sum(i.amount), 0) as committed, coalesce(sum(i.verified_amount), 0) as verified, coalesce(sum(i.billed_amount), 0) as billed
from eng.v_wo_items i
join eng.work_orders w on w.id = i.wo_id and w.status in ('Issued', 'Closed')
join eng.projects() p on p.id = w.project_id
left join purchase.vendors pv on pv.id = w.vendor_id
left join purchase.vendors sv on sv.id = i.sub_vendor_id
group by w.project_id, p.name, w.vendor_id, pv.trade_name, pv.legal_name, i.sub_vendor_id, sv.trade_name, sv.legal_name;

-- ---------------------------------------------------------------- budget status: direction + collections
create or replace view eng.v_budget_status with (security_invoker = true) as
select b.id, b.project_id, p.name as project_name, b.tower_id, t.name as tower_name,
       b.group_id, g.name as group_name, b.item_id, i.name as item_name, i.code as item_code,
       case when b.item_id is not null then 'Material' when b.group_id is not null then 'Activity Group'
            when b.tower_id is not null then 'Block' else 'Project' end as level,
       b.amount, b.remarks, b.created_at,
       case when b.item_id is null and b.direction = 'Outflow' then bq.boq_value end as boq_value,
       case when b.item_id is null and b.direction = 'Outflow' then wo.committed end as committed,
       case when b.item_id is null and b.direction = 'Outflow' then wo.verified end as verified,
       case when b.item_id is null and b.direction = 'Outflow' then wo.billed end as billed,
       b.direction,
       case when b.direction = 'Inflow' then rc.received end as received
from eng.budgets b
join eng.projects() p on p.id = b.project_id
left join postsales.towers t on t.id = b.tower_id
left join eng.activity_groups g on g.id = b.group_id
left join purchase.items i on i.id = b.item_id
left join lateral (
  select coalesce(sum(round(bi.qty * bi.rate, 2)), 0) as boq_value
  from eng.boq_items bi join eng.activities a on a.id = bi.activity_id
  where b.direction = 'Outflow' and bi.project_id = b.project_id and (b.tower_id is null or bi.tower_id = b.tower_id)
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
  where b.direction = 'Outflow' and bi.project_id = b.project_id and (b.tower_id is null or bi.tower_id = b.tower_id)
    and (b.group_id is null or a.group_id = b.group_id)) wo on true
left join lateral (
  select coalesce((select sum(r.amount) from postsales.receipts r join postsales.bookings bk on bk.id = r.booking_id
                    where r.project_id = b.project_id and r.status = 'active' and (b.tower_id is null or bk.tower_id = b.tower_id)), 0)
       - coalesce((select sum(po.amount) from postsales.payouts po join postsales.bookings bk2 on bk2.id = po.booking_id
                    where po.project_id = b.project_id and po.kind = 'refund' and (b.tower_id is null or bk2.tower_id = b.tower_id)), 0) as received
  where b.direction = 'Inflow') rc on true;

create or replace view eng.v_project_summary with (security_invoker = true) as
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
  (select count(*) from eng.ra_bills r join eng.work_orders w on w.id = r.wo_id where w.project_id = p.id and r.status = 'Draft') as ra_draft,
  (select count(*) from eng.wo_amendments a join eng.work_orders w on w.id = a.wo_id where w.project_id = p.id and a.status = 'Draft') as amend_draft,
  (select coalesce(sum(b.amount), 0) from eng.budgets b where b.project_id = p.id and b.direction = 'Outflow'
     and b.tower_id is null and b.group_id is null and b.item_id is null) as outflow_budget,
  (select coalesce(sum(b.amount), 0) from eng.budgets b where b.project_id = p.id and b.direction = 'Inflow' and b.tower_id is null) as inflow_budget,
  coalesce((select sum(r.amount) from postsales.receipts r where r.project_id = p.id and r.status = 'active'), 0)
    - coalesce((select sum(po.amount) from postsales.payouts po where po.project_id = p.id and po.kind = 'refund'), 0) as received
from eng.projects() p;

grant select on eng.v_wo_subcontractors, eng.v_contractor_summary to authenticated;
revoke execute on all functions in schema eng from public, anon;
grant  execute on all functions in schema eng to authenticated;
