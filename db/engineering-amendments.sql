-- =====================================================================================
-- JAIN-E · Engineering — WORK ORDER AMENDMENTS
-- Apply AFTER db/engineering-schema.sql.  Applied to Supabase as migration "engineering_wo_amendments".
--
-- An issued work order is changed only through an amendment:  draft -> issue (applies the changes
-- atomically) -> kept forever as history.  An amendment can change item quantities and rates, add BOQ
-- lines, short-close items (quantity 0) and revise the end date, conditions and retention/TDS/GST.
--
-- Rate rule: once work has been entered against an item its rate never changes, so billed amounts can
-- never move.  A rate change on a part-executed item closes that line at what is already done and puts
-- the balance on a new line at the new rate.
-- =====================================================================================

alter table eng.wo_items add column amend_no int not null default 0;          -- 0 = original work order, n = created by amendment n
alter table eng.wo_items drop constraint wo_items_wo_id_boq_item_id_key;
alter table eng.wo_items add constraint wo_items_wo_boq_amend_uq unique (wo_id, boq_item_id, amend_no);
alter table eng.wo_items drop constraint wo_items_qty_check;
alter table eng.wo_items add constraint wo_items_qty_check check (qty >= 0);   -- 0 = short-closed by an amendment

create table eng.wo_amendments (
  id            bigint generated always as identity primary key,
  wo_id         bigint not null references eng.work_orders (id) on delete restrict,
  amend_no      int  not null,
  amend_ref     text not null unique,                       -- WO/DG/0001/AM-01
  title         text not null check (btrim(title) <> ''),   -- the reason for the amendment
  effective_date date not null default current_date,
  new_end_date  date,                                       -- null = unchanged
  new_terms     text,
  new_retention_pct numeric(5,2) check (new_retention_pct between 0 and 100),
  new_tds_pct   numeric(5,2) check (new_tds_pct between 0 and 100),
  new_gst_pct   numeric(5,2) check (new_gst_pct between 0 and 100),
  status        text not null default 'Draft' check (status in ('Draft','Issued','Cancelled')),
  value_before  numeric(16,2), value_after numeric(16,2),   -- work order value either side of the amendment (set on issue)
  old_terms     jsonb,                                      -- terms as they were before (set on issue)
  issued_by text, issued_at timestamptz,
  cancelled_by text, cancelled_at timestamptz, cancel_reason text,
  created_at    timestamptz not null default now(), created_by text,
  updated_at    timestamptz not null default now(), updated_by text,
  unique (wo_id, amend_no)
);
create unique index wo_amendments_one_draft on eng.wo_amendments (wo_id) where status = 'Draft';

create table eng.wo_amendment_items (
  id            bigint generated always as identity primary key,
  amendment_id  bigint not null references eng.wo_amendments (id) on delete cascade,
  action        text not null check (action in ('change','add')),
  wo_item_id    bigint references eng.wo_items (id) on delete restrict,       -- change
  boq_item_id   bigint references eng.boq_items (id) on delete restrict,      -- add
  new_qty       numeric(14,3) not null check (new_qty >= 0),   -- change: new TOTAL quantity of the item;  add: quantity to tag
  new_rate      numeric(14,2) not null check (new_rate >= 0),
  old_qty numeric(14,3), old_rate numeric(14,2), executed_qty numeric(14,3),  -- snapshot, set on issue
  result_wo_item_id bigint references eng.wo_items (id) on delete restrict,   -- the line created by an add / by a rate split
  remarks       text,
  created_at    timestamptz not null default now(), created_by text,
  updated_at    timestamptz not null default now(), updated_by text,
  check ((action = 'change' and wo_item_id is not null and boq_item_id is null)
      or (action = 'add'    and boq_item_id is not null and wo_item_id is null))
);
create unique index wo_amend_item_change_uq on eng.wo_amendment_items (amendment_id, wo_item_id) where action = 'change';
create unique index wo_amend_item_add_uq    on eng.wo_amendment_items (amendment_id, boq_item_id) where action = 'add';

-- ---- tagging rules: items may also be changed on an ISSUED work order, but only while an amendment is being applied
create or replace function eng.t_wo_item() returns trigger
language plpgsql set search_path = '' as
$$
declare
  w_status text; w_project bigint; b_project bigint; b_qty numeric; used numeric; self_id bigint := 0; executed numeric;
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

-- ---- work order rules: contract terms are locked once issued, except while an amendment is applying them
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
    raise exception 'The contractor cannot be changed once the work order is issued';
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

-- ---- amendment header rules
create or replace function eng.t_wo_amend() returns trigger
language plpgsql set search_path = '' as
$$
declare w_no text; w_status text; w_date date; n int;
        amending boolean := coalesce(current_setting('eng.amending', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    if old.status <> 'Draft' then raise exception 'Only a draft amendment can be deleted'; end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    select wo_no, status, wo_date into w_no, w_status, w_date from eng.work_orders where id = new.wo_id;
    if w_status is distinct from 'Issued' then
      raise exception 'Only an issued work order can be amended (it is %)', coalesce(w_status, 'missing');
    end if;
    if new.effective_date < w_date then raise exception 'The effective date cannot be before the work order date'; end if;
    n := eng.next_no('AM/' || new.wo_id);
    new.amend_no := n;
    new.amend_ref := w_no || '/AM-' || lpad(n::text, 2, '0');
    new.status := 'Draft';
    new.value_before := null; new.value_after := null; new.old_terms := null;
    new.issued_by := null; new.issued_at := null; new.cancelled_by := null; new.cancelled_at := null; new.cancel_reason := null;
    return new;
  end if;

  if old.status <> 'Draft' then raise exception 'An % amendment is a permanent record and cannot be changed', lower(old.status); end if;
  if new.wo_id <> old.wo_id or new.amend_no <> old.amend_no or new.amend_ref <> old.amend_ref then
    raise exception 'The work order and amendment number cannot be changed';
  end if;
  if not amending then
    new.value_before := old.value_before; new.value_after := old.value_after; new.old_terms := old.old_terms;
  end if;
  if new.status <> old.status then
    if new.status = 'Issued' then
      if not amending then raise exception 'Use “Issue amendment” to apply it to the work order'; end if;
      new.issued_by := nullif(eng.me(), ''); new.issued_at := now();
    elsif new.status = 'Cancelled' then
      if nullif(btrim(coalesce(new.cancel_reason, '')), '') is null then raise exception 'Give a reason for cancelling the amendment'; end if;
      new.cancelled_by := nullif(eng.me(), ''); new.cancelled_at := now();
    else
      raise exception 'Invalid amendment status';
    end if;
  elsif not amending and new.effective_date < (select wo_date from eng.work_orders where id = old.wo_id) then
    raise exception 'The effective date cannot be before the work order date';
  end if;
  return new;
end $$;
create trigger wo_amend_rules before insert or update or delete on eng.wo_amendments for each row execute function eng.t_wo_amend();

-- ---- amendment line rules (early feedback while drafting; the same caps are enforced again when applied)
create or replace function eng.t_wo_amend_item() returns trigger
language plpgsql set search_path = '' as
$$
declare
  a_status text; a_wo bigint; a_project bigint;
  wi_wo bigint; wi_boq bigint; wi_qty numeric; executed numeric;
  b_project bigint; b_qty numeric; used numeric;
  amending boolean := coalesce(current_setting('eng.amending', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    select status into a_status from eng.wo_amendments where id = old.amendment_id;
    if found and a_status <> 'Draft' then raise exception 'Only a draft amendment can be edited'; end if;
    return old;
  end if;

  select a.status, a.wo_id, w.project_id into a_status, a_wo, a_project
  from eng.wo_amendments a join eng.work_orders w on w.id = a.wo_id where a.id = new.amendment_id for update of a;
  if a_status is distinct from 'Draft' and not amending then raise exception 'Only a draft amendment can be edited'; end if;
  if amending then return new; end if;     -- the issue procedure writes the snapshot / result columns

  if tg_op = 'INSERT' then
    new.old_qty := null; new.old_rate := null; new.executed_qty := null; new.result_wo_item_id := null;
  else
    if new.action <> old.action or new.wo_item_id is distinct from old.wo_item_id or new.boq_item_id is distinct from old.boq_item_id
       or new.amendment_id <> old.amendment_id then
      raise exception 'Remove the line and add a new one instead';
    end if;
    new.old_qty := old.old_qty; new.old_rate := old.old_rate; new.executed_qty := old.executed_qty; new.result_wo_item_id := old.result_wo_item_id;
  end if;

  if new.action = 'change' then
    select wo_id, boq_item_id, qty into wi_wo, wi_boq, wi_qty from eng.wo_items where id = new.wo_item_id;
    if wi_wo is distinct from a_wo then raise exception 'That item is not on this work order'; end if;
    select coalesce(sum(qty), 0) into executed from eng.work_done where wo_item_id = new.wo_item_id and status <> 'Rejected';
    if new.new_qty < executed then
      raise exception 'The new quantity cannot be below the % already entered as work done', executed;
    end if;
    if new.new_qty > wi_qty then
      select qty into b_qty from eng.boq_items where id = wi_boq;
      select coalesce(sum(x.qty), 0) into used from eng.wo_items x join eng.work_orders w on w.id = x.wo_id
        where x.boq_item_id = wi_boq and w.status <> 'Cancelled';
      if used + (new.new_qty - wi_qty) > b_qty then
        raise exception 'Only % of that BOQ item is still untagged — raise the BOQ quantity first', (b_qty - used);
      end if;
    end if;
  else
    if new.new_qty <= 0 then raise exception 'Enter a quantity above zero for the new item'; end if;
    select project_id, qty into b_project, b_qty from eng.boq_items where id = new.boq_item_id;
    if b_project is distinct from a_project then raise exception 'That BOQ item belongs to a different project than this work order'; end if;
    select coalesce(sum(x.qty), 0) into used from eng.wo_items x join eng.work_orders w on w.id = x.wo_id
      where x.boq_item_id = new.boq_item_id and w.status <> 'Cancelled';
    if used + new.new_qty > b_qty then
      raise exception 'Only % of that BOQ item is still untagged', (b_qty - used);
    end if;
  end if;
  return new;
end $$;
create trigger wo_amend_item_rules before insert or update or delete on eng.wo_amendment_items for each row execute function eng.t_wo_amend_item();

do $$
declare t text;
begin
  foreach t in array array['wo_amendments','wo_amendment_items'] loop
    execute format('create trigger %I before insert or update on eng.%I for each row execute function eng.t_audit()', 'a_audit_' || t, t);
    execute format('alter table eng.%I enable row level security', t);
    execute format($p$create policy %I on eng.%I for all to authenticated
                      using ((select app.has_module('engineering'))) with check ((select app.has_module('engineering')))$p$, t || '_module', t);
    execute format('grant select, insert, update, delete on eng.%I to authenticated', t);
  end loop;
end $$;

-- ---- apply a draft amendment to its work order, atomically
create or replace function eng.wo_amend_issue(p_id bigint) returns void
language plpgsql set search_path = '' as
$$
declare
  a record; w record; it record; wi record; executed numeric; res bigint;
  v_before numeric; v_after numeric; changed int := 0; old_t jsonb;
begin
  perform set_config('eng.amending', 'on', true);          -- lets the row triggers accept changes to an issued work order, for this transaction only
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
        null;                                              -- nothing to change on this line
      elsif it.new_rate = wi.rate or executed = 0 then
        update eng.wo_items set qty = it.new_qty, rate = it.new_rate where id = wi.id;
        changed := changed + 1;
      else
        -- work already exists at the old rate: close the old line at what is done, move the balance to the new rate
        update eng.wo_items set qty = executed where id = wi.id;
        if it.new_qty > executed then
          insert into eng.wo_items (wo_id, boq_item_id, qty, rate, amend_no)
          values (a.wo_id, wi.boq_item_id, it.new_qty - executed, it.new_rate, a.amend_no) returning id into res;
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

-- ---- views
create or replace view eng.v_wo_items with (security_invoker = true) as
select wi.id, wi.wo_id, w.wo_no, w.status as wo_status, w.project_id, wi.boq_item_id,
       b.activity_name, b.group_name, b.uom, b.location_label, b.location_level, b.tower_name, b.tower_sort, b.floor_no, b.flat_code,
       wi.qty, wi.rate, wi.amount, wi.remarks,
       pr.pending_qty, pr.verified_qty, pr.unbilled_qty, pr.draft_billed_qty, pr.billed_qty,
       round(pr.verified_qty * wi.rate, 2) as verified_amount,
       round(pr.billed_qty * wi.rate, 2)   as billed_amount,
       wi.amend_no
from eng.wo_items wi
join eng.work_orders w on w.id = wi.wo_id
join eng.v_boq b on b.id = wi.boq_item_id
join eng.v_wo_item_progress pr on pr.wo_item_id = wi.id;

create view eng.v_wo_amendments with (security_invoker = true) as
select a.*, w.wo_no, w.project_id, p.name as project_name, w.vendor_id, w.status as wo_status,
       coalesce(v.trade_name, v.legal_name) as vendor_name,
       (select count(*) from eng.wo_amendment_items i where i.amendment_id = a.id) as line_count,
       case when a.status = 'Issued' then a.value_after - a.value_before end as value_change
from eng.wo_amendments a
join eng.work_orders w on w.id = a.wo_id
join eng.projects() p on p.id = w.project_id
left join purchase.vendors v on v.id = w.vendor_id;

create view eng.v_wo_amendment_items with (security_invoker = true) as
select i.*,
       coalesce(wb.activity_name, bb.activity_name)   as activity_name,
       coalesce(wb.group_name, bb.group_name)         as group_name,
       coalesce(wb.uom, bb.uom)                       as uom,
       coalesce(wb.location_label, bb.location_label) as location_label,
       coalesce(wb.location_level, bb.location_level) as location_level,
       wi.qty as cur_qty, wi.rate as cur_rate, wi.amend_no as item_amend_no,
       coalesce(pr.pending_qty + pr.verified_qty, 0)  as cur_executed,
       bb.remaining_qty as boq_remaining
from eng.wo_amendment_items i
left join eng.wo_items wi on wi.id = i.wo_item_id
left join eng.v_boq wb on wb.id = wi.boq_item_id
left join eng.v_boq bb on bb.id = i.boq_item_id
left join eng.v_wo_item_progress pr on pr.wo_item_id = wi.id;

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
  (select count(*) from eng.wo_amendments a join eng.work_orders w on w.id = a.wo_id where w.project_id = p.id and a.status = 'Draft') as amend_draft
from eng.projects() p;

grant select on eng.v_wo_amendments, eng.v_wo_amendment_items to authenticated;
revoke execute on all functions in schema eng from public, anon;
grant  execute on all functions in schema eng to authenticated;
