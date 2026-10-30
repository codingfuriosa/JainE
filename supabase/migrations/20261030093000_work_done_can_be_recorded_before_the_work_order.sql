/* WORK DONE NO LONGER HAS TO WAIT FOR A WORK ORDER.

   WHAT WAS WRONG.
   Every row in eng.work_done hung off a work-order line - wo_item_id was NOT NULL - and the only
   way to create one was the "Enter work done" button on an issued work order. So work that has no
   work order behind it could not be written down at all: departmental and day work, anything
   started before the order was issued, and any measurement taken straight off the BOQ while the
   paperwork caught up. In practice that meant either back-dating a work order to make the system
   accept the truth, or keeping the measurement on paper until one existed.

   WHAT CHANGES.
   A row may now be anchored EITHER to a work-order line (wo_item_id, exactly as before) OR to a
   BOQ line (boq_item_id) with no work order at all. Exactly one of the two, never both and never
   neither - work_done_anchor says so.

   An unattached row is a measurement, not a payable. It cannot be verified and it cannot be put
   on an RA bill, because both of those are steps in paying a contractor and there is no contractor
   on it yet; work_done_unattached_is_plain holds that. When a work order covering the same BOQ
   line does get issued, the row is attached to it from the Work Done screen - wo_item_id is set
   and boq_item_id cleared - and from that moment it behaves exactly like a row that was entered
   through the work order in the first place, verification and billing included.

   NOTHING ELSE MOVES. v_wo_item_progress, the RA bill lines and every "ordered / done / balance"
   figure read through wo_item_id, which is still null for exactly the rows that are not on an
   order, so none of them can see an unattached measurement. v_work_done resolves the activity,
   location, project and rate from whichever anchor the row has - a work-order line brings the
   contractor's agreed rate, a bare BOQ line brings the BOQ's own - and gains `attached` so the
   screen can keep the two apart without inspecting ids. */

alter table eng.work_done alter column wo_item_id drop not null;
alter table eng.work_done
  add column if not exists boq_item_id bigint references eng.boq_items(id) on delete restrict;

alter table eng.work_done drop constraint if exists work_done_anchor;
alter table eng.work_done add  constraint work_done_anchor
  check (num_nonnulls(wo_item_id, boq_item_id) = 1);

alter table eng.work_done drop constraint if exists work_done_unattached_is_plain;
alter table eng.work_done add  constraint work_done_unattached_is_plain
  check (boq_item_id is null or (status = 'Entered' and ra_bill_id is null));

create index if not exists work_done_boq_item_id_fk_idx on eng.work_done(boq_item_id);

/* The two new columns are appended rather than slotted in beside wo_item_id: create or replace
   view cannot insert a column in the middle of an existing one. */
create or replace view eng.v_work_done as
 select wd.id,
    wd.wo_item_id,
    wi.wo_id,
    w.wo_no,
    w.status as wo_status,
    coalesce(w.project_id, b.project_id) as project_id,
    b.activity_name,
    b.group_name,
    b.uom,
    b.location_label,
    wd.entry_date,
    wd.qty,
    coalesce(wi.rate, b.rate) as rate,
    round(wd.qty * coalesce(wi.rate, b.rate), 2) as value,
    wd.remarks,
    wd.status,
    wd.entered_by,
    wd.entered_at,
    wd.verified_by,
    wd.verified_at,
    wd.verify_remarks,
    wd.ra_bill_id,
    rb.bill_no,
    rb.status as bill_status,
    wi.sub_vendor_id,
    coalesce(sv.trade_name, sv.legal_name) as sub_vendor_name,
    wd.boq_item_id,
    (wd.wo_item_id is not null) as attached,
    /* The BOQ line the row resolves to whichever anchor it has, so a screen can total the work
       recorded against one line without caring which rows are on an order and which are not. */
    coalesce(wi.boq_item_id, wd.boq_item_id) as boq_line_id
   from eng.work_done wd
     left join eng.wo_items wi on wi.id = wd.wo_item_id
     left join eng.work_orders w on w.id = wi.wo_id
     left join eng.v_boq b on b.id = coalesce(wi.boq_item_id, wd.boq_item_id)
     left join eng.ra_bills rb on rb.id = wd.ra_bill_id
     left join purchase.vendors sv on sv.id = wi.sub_vendor_id;

/* THE RULES THAT GUARD A WORK-DONE ROW HAVE TO KNOW ABOUT THE SECOND ANCHOR.

   eng.t_work_done() is where every rule about this table actually lives - the work order must be
   issued, the date cannot precede the order or run into the future, the quantity cannot exceed
   what was ordered, nobody verifies their own entry, billed work is locked. All of it was written
   when wo_item_id could not be null, and all of it begins by looking the work-order line up by
   that id.

   Left alone, a row with no work order would have slipped past the lot of them in silence: the
   lookup finds nothing, every comparison that follows is against NULL, and NULL is not true, so
   not one of those raises would have fired. An unattached measurement could have been dated next
   year and could have run to ten times the BOQ quantity.

   So the trigger now has a second path. A row anchored to a BOQ line is checked against that line
   instead: not dated in the future, and not taking the total work recorded against that BOQ line -
   attached and unattached together - past the quantity the BOQ says is there.

   Attaching is its own case, and a narrow one: wo_item_id goes from null to a work-order line that
   covers THE SAME BOQ line, the order is Issued, the date suits it, the quantity still fits, and
   nothing else about the row may move in the same breath. Going the other way - lifting work off
   an order it is already on - is refused outright. */

create or replace function eng.t_work_done()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
declare
  me text := eng.me();
  sup boolean := (select app.is_superadmin());
  wi_qty numeric; wi_wo bigint; w_status text; w_date date; used numeric;
  b_status text; b_wo bigint; bq_qty numeric; wi_boq bigint;
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
    /* A measurement with no work order behind it: the BOQ line is what it is measured against,
       so the BOQ line is what it is checked against. */
    if new.boq_item_id is not null then
      select qty into bq_qty from eng.boq_items where id = new.boq_item_id for update;
      if bq_qty is null then raise exception 'That BOQ line no longer exists'; end if;
      if new.entry_date > (now() at time zone 'Asia/Kolkata')::date then
        raise exception 'The work done date cannot be in the future';
      end if;
      select coalesce(sum(wd.qty), 0) into used
        from eng.work_done wd
        left join eng.wo_items wi on wi.id = wd.wo_item_id
       where coalesce(wi.boq_item_id, wd.boq_item_id) = new.boq_item_id and wd.status <> 'Rejected';
      if used + new.qty > bq_qty then
        raise exception 'More than the BOQ quantity: % of % is already recorded against this line', used, bq_qty;
      end if;
      new.status := 'Entered';
      new.entered_by := nullif(me, ''); new.entered_at := now();
      new.verified_by := null; new.verified_at := null; new.verify_remarks := null; new.ra_bill_id := null;
      return new;
    end if;

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

  if new.entered_by is distinct from old.entered_by or new.entered_at is distinct from old.entered_at then
    raise exception 'Who entered the work cannot be changed';
  end if;

  /* PUTTING A MEASUREMENT ON A WORK ORDER. The only thing such a statement may do. */
  if old.wo_item_id is null and new.wo_item_id is not null then
    if new.boq_item_id is not null then raise exception 'Clear the BOQ line when attaching the work to an order'; end if;
    if (new.qty, new.entry_date, new.remarks, new.status) is distinct from (old.qty, old.entry_date, old.remarks, old.status) then
      raise exception 'Attach the work to the order on its own, then edit it';
    end if;
    if lower(coalesce(old.entered_by, '')) <> me and not sup then
      raise exception 'Only the person who recorded this work can put it on a work order';
    end if;
    select boq_item_id, qty, wo_id into wi_boq, wi_qty, wi_wo from eng.wo_items where id = new.wo_item_id for update;
    if wi_boq is distinct from old.boq_item_id then
      raise exception 'That work order line is for a different BOQ line';
    end if;
    select status, wo_date into w_status, w_date from eng.work_orders where id = wi_wo;
    if w_status <> 'Issued' then raise exception 'Work can only be put on an issued work order (it is %)', w_status; end if;
    if old.entry_date < w_date then raise exception 'This work is dated before the work order, so it cannot go on it'; end if;
    select coalesce(sum(qty), 0) into used from eng.work_done where wo_item_id = new.wo_item_id and status <> 'Rejected';
    if used + old.qty > wi_qty then
      raise exception 'More than the work order quantity: % of % is already recorded', used, wi_qty;
    end if;
    return new;
  end if;

  if old.wo_item_id is not null and new.wo_item_id is null then
    raise exception 'Work already on a work order cannot be taken off it';
  end if;
  if new.wo_item_id is distinct from old.wo_item_id or new.boq_item_id is distinct from old.boq_item_id then
    raise exception 'The work order item and the BOQ line cannot be changed';
  end if;

  /* EDITING A MEASUREMENT THAT IS STILL NOT ON AN ORDER. It cannot be verified or billed while it
     sits here, so the only rules that apply are the date, the BOQ quantity and whose entry it is. */
  if new.boq_item_id is not null then
    if new.status <> 'Entered' then
      raise exception 'Put this work on a work order before verifying it';
    end if;
    if lower(coalesce(old.entered_by, '')) <> me and not sup then
      raise exception 'Only the person who entered this can edit it';
    end if;
    if new.entry_date > (now() at time zone 'Asia/Kolkata')::date then
      raise exception 'The work done date cannot be in the future';
    end if;
    select qty into bq_qty from eng.boq_items where id = new.boq_item_id for update;
    select coalesce(sum(wd.qty), 0) into used
      from eng.work_done wd
      left join eng.wo_items wi on wi.id = wd.wo_item_id
     where coalesce(wi.boq_item_id, wd.boq_item_id) = new.boq_item_id and wd.status <> 'Rejected' and wd.id <> old.id;
    if used + new.qty > bq_qty then
      raise exception 'More than the BOQ quantity: % of % is already recorded against this line', used, bq_qty;
    end if;
    return new;
  end if;

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
end $function$;
