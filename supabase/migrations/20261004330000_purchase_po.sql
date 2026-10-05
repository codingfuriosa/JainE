-- Purchase & Stores, Stage 5 (part 2): purchase orders. See docs/purchase-stores-spec.md section 5.3.
--
-- A PO is made from a quotation comparison: Purchase gives each item (or the whole RFQ) to a vendor and one
-- draft PO per vendor is created, carrying that vendor's quoted rate / GST / make and common terms. It is then
-- submitted for approval through the project's PO approver chain (levels with a value threshold, so higher
-- value orders go through more people). On SUBMISSION the quantity is reserved against the indent lines it
-- came from (indent_lines.ordered_qty goes up, recorded in po_line_sources), so an indent can never be
-- over-ordered; rejecting, cancelling or amending releases it again.
-- An approved PO can be amended (a new revision, back through approval), cancelled, or short closed.
--
-- All writes go through the functions below; the tables are read-only from the browser.
-- Document number: <project code>/PO/<financial year>/<serial>, given when first submitted.

create table if not exists purchase.pos(
  id               bigserial primary key,
  doc_no           text,
  project_id       bigint not null references cust.projects(id),
  rfq_id           bigint references purchase.rfqs(id),
  vendor_id        bigint not null references purchase.vendors(id),
  warehouse_id     bigint references purchase.warehouses(id),
  po_date          date not null default current_date,
  status           text not null default 'draft' check (status in ('draft','pending_approval','approved','rejected','closed','cancelled')),
  revision         int not null default 0,
  current_level    int not null default 0,
  round            int not null default 0,
  payment_terms    text,
  delivery_terms   text,
  warranty_terms   text,
  freight_terms    text,
  price_validity   text,
  other_terms      text,
  delivery_address text,
  contact_person   text,
  contact_phone    text,
  remarks          text,
  total_basic      numeric(14,2) not null default 0,
  total_gst        numeric(14,2) not null default 0,
  total_amount     numeric(14,2) not null default 0,
  raised_by        text not null default app.current_user_email(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  submitted_at     timestamptz,
  approved_at      timestamptz,
  closed_at        timestamptz,
  closed_kind      text check (closed_kind in ('fulfilled','short_closed')),
  cancelled_at     timestamptz,
  cancel_reason    text,
  deleted_at       timestamptz,
  deleted_by       text
);
create unique index if not exists pos_doc_no_uq on purchase.pos (doc_no) where doc_no is not null;
create index if not exists pos_project_idx on purchase.pos (project_id, status) where deleted_at is null;
create index if not exists pos_rfq_idx on purchase.pos (rfq_id);

create table if not exists purchase.po_lines(
  id                  bigserial primary key,
  po_id               bigint not null references purchase.pos(id) on delete cascade,
  line_no             int not null,
  item_id             bigint not null references purchase.items(id),
  rfq_line_id         bigint references purchase.rfq_lines(id),
  qty                 numeric(14,3) not null check (qty > 0),
  uom_id              bigint not null references purchase.uoms(id),
  hsn_code            text,
  rate                numeric(14,2) not null check (rate > 0),
  gst_rate            numeric(5,2) not null default 0 check (gst_rate between 0 and 100),
  make                text,
  remark              text,
  amount              numeric(14,2) not null default 0,
  gst_amount          numeric(14,2) not null default 0,
  received_qty        numeric(14,3) not null default 0 check (received_qty >= 0),
  short_closed_qty    numeric(14,3) not null default 0 check (short_closed_qty >= 0),
  short_close_reason  text,
  short_closed_by     text,
  short_closed_at     timestamptz,
  check (received_qty + short_closed_qty <= qty)
);
create index if not exists po_lines_po_idx on purchase.po_lines (po_id, line_no);
create index if not exists po_lines_item_idx on purchase.po_lines (item_id);
create index if not exists po_lines_rfq_line_idx on purchase.po_lines (rfq_line_id);

create table if not exists purchase.po_line_sources(
  id              bigserial primary key,
  po_line_id      bigint not null references purchase.po_lines(id) on delete cascade,
  indent_line_id  bigint not null references purchase.indent_lines(id),
  qty             numeric(14,3) not null check (qty > 0),
  released_qty    numeric(14,3) not null default 0 check (released_qty >= 0),
  check (released_qty <= qty)
);
create index if not exists po_line_sources_line_idx on purchase.po_line_sources (po_line_id);

create table if not exists purchase.po_approvals(
  id         bigserial primary key,
  po_id      bigint not null references purchase.pos(id) on delete cascade,
  round      int not null,
  level      int not null,
  approvers  text[] not null,
  status     text not null check (status in ('waiting','pending','approved','rejected')),
  acted_by   text,
  acted_at   timestamptz,
  remark     text
);
create index if not exists po_approvals_idx on purchase.po_approvals (po_id, round, level);

create table if not exists purchase.po_revisions(
  id          bigserial primary key,
  po_id       bigint not null references purchase.pos(id) on delete cascade,
  revision    int not null,
  snapshot    jsonb not null,
  reason      text,
  created_by  text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function purchase._po_guard(p_perm text) returns text
 language plpgsql stable security definer set search_path = purchase, public as $fn$
begin
  if coalesce(app.current_user_email(), '') = '' then raise exception 'not signed in'; end if;
  if app.is_customer() then raise exception 'not allowed'; end if;
  if not purchase.can(p_perm) then raise exception 'You do not have permission for this - ask a Purchase administrator'; end if;
  return lower(app.current_user_email());
end $fn$;
revoke all on function purchase._po_guard(text) from public, anon, authenticated;

create or replace function purchase._po_recalc(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
begin
  update purchase.po_lines set amount = round(qty * rate, 2), gst_amount = round(round(qty * rate, 2) * gst_rate / 100, 2) where po_id = p_id;
  update purchase.pos p set total_basic = coalesce((select sum(amount) from purchase.po_lines where po_id = p_id), 0),
                            total_gst = coalesce((select sum(gst_amount) from purchase.po_lines where po_id = p_id), 0),
                            total_amount = coalesce((select sum(amount + gst_amount) from purchase.po_lines where po_id = p_id), 0),
                            updated_at = now()
   where p.id = p_id;
end $fn$;
revoke all on function purchase._po_recalc(bigint) from public, anon, authenticated;

-- An indent that was closed only because everything was ordered opens again when quantity is released.
create or replace function purchase._indent_reopen(p_indent_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
begin
  update purchase.indents i set status = 'approved', closed_at = null, closed_kind = null
   where i.id = p_indent_id and i.status = 'closed'
     and exists (select 1 from purchase.indent_lines l where l.indent_id = i.id and l.qty - l.ordered_qty - l.short_closed_qty > 0);
end $fn$;
revoke all on function purchase._indent_reopen(bigint) from public, anon, authenticated;

-- Give back everything a PO has reserved on its indents. Caller must have the in_fn flag raised.
create or replace function purchase._po_release(p_po_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare s record; v_ind bigint[] := '{}'; v_i bigint;
begin
  for s in select ps.id, ps.indent_line_id, ps.qty - ps.released_qty as rel, il.indent_id
             from purchase.po_line_sources ps join purchase.po_lines pl on pl.id = ps.po_line_id join purchase.indent_lines il on il.id = ps.indent_line_id
            where pl.po_id = p_po_id loop
    if s.rel > 0 then update purchase.indent_lines set ordered_qty = greatest(0, ordered_qty - s.rel) where id = s.indent_line_id; end if;
    v_ind := v_ind || s.indent_id;
  end loop;
  delete from purchase.po_line_sources where po_line_id in (select id from purchase.po_lines where po_id = p_po_id);
  foreach v_i in array (select coalesce(array_agg(distinct x), '{}') from unnest(v_ind) x) loop
    perform purchase._indent_reopen(v_i);
  end loop;
end $fn$;
revoke all on function purchase._po_release(bigint) from public, anon, authenticated;

-- Keep the RFQ's status in step with how much of it is on (live) POs.
create or replace function purchase._rfq_refresh_status(p_rfq_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare v_all boolean; r purchase.rfqs;
begin
  select * into r from purchase.rfqs where id = p_rfq_id;
  if not found or r.status not in ('closed','ordered') then return; end if;
  select not exists (select 1 from purchase.rfq_lines l
                      where l.qty > coalesce((select sum(pl.qty) from purchase.po_lines pl join purchase.pos p on p.id = pl.po_id and p.deleted_at is null and p.status <> 'cancelled' where pl.rfq_line_id = l.id), 0))
    into v_all;
  update purchase.rfqs set status = case when v_all then 'ordered' else 'closed' end, updated_at = now() where id = p_rfq_id;
end $fn$;
revoke all on function purchase._rfq_refresh_status(bigint) from public, anon, authenticated;

-- Closes an approved PO when nothing is left to receive.
create or replace function purchase.po_refresh(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
begin
  update purchase.pos p set status = 'closed', closed_at = now(),
         closed_kind = case when exists (select 1 from purchase.po_lines l where l.po_id = p.id and l.short_closed_qty > 0) then 'short_closed' else 'fulfilled' end, updated_at = now()
   where p.id = p_id and p.status = 'approved'
     and not exists (select 1 from purchase.po_lines l where l.po_id = p.id and l.qty - l.received_qty - l.short_closed_qty > 0);
end $fn$;
revoke all on function purchase.po_refresh(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Create draft POs from the comparison: selections = [{rfq_line_id, rfq_vendor_id, qty?}, ...]
-- ---------------------------------------------------------------------------
create or replace function purchase.po_create_from_rfq(p_rfq_id bigint, p_selections jsonb, p_warehouse_id bigint) returns bigint[]
 language plpgsql security definer set search_path = purchase, public as $fn$
declare
  me text := purchase._po_guard('po.create'); r purchase.rfqs; s jsonb; rl purchase.rfq_lines; rv purchase.rfq_vendors; q purchase.quotations; ql purchase.quotation_lines;
  it purchase.items; v_vendor bigint; v_po bigint; v_n int; v_qty numeric; v_cov numeric; ids bigint[] := '{}'; seen bigint[] := '{}';
begin
  select * into r from purchase.rfqs where id = p_rfq_id and deleted_at is null for update;
  if not found then raise exception 'RFQ not found'; end if;
  if r.status not in ('open','closed') then raise exception 'Orders can only be made from an open or closed RFQ that is not yet fully ordered'; end if;
  if not exists (select 1 from purchase.warehouses where id = p_warehouse_id and project_id = r.project_id and active and deleted_at is null) then
    raise exception 'Choose the warehouse the material is to be delivered to';
  end if;
  if jsonb_typeof(p_selections) <> 'array' or jsonb_array_length(p_selections) = 0 then raise exception 'Choose a vendor for at least one item'; end if;

  for v_vendor in select distinct (x->>'rfq_vendor_id')::bigint from jsonb_array_elements(p_selections) x loop
    select * into rv from purchase.rfq_vendors where id = v_vendor and rfq_id = p_rfq_id;
    if not found then raise exception 'A selected vendor is not part of this RFQ'; end if;
    if not exists (select 1 from purchase.vendors where id = rv.vendor_id and status = 'approved' and deleted_at is null) then raise exception 'Only an approved vendor can be given an order'; end if;
    select * into q from purchase.quotations where rfq_vendor_id = v_vendor and is_current;
    if not found then raise exception 'A selected vendor has not quoted yet'; end if;

    insert into purchase.pos(project_id, rfq_id, vendor_id, warehouse_id, payment_terms, delivery_terms, warranty_terms, freight_terms, price_validity, other_terms, remarks, raised_by)
    values (r.project_id, p_rfq_id, rv.vendor_id, p_warehouse_id, q.payment_terms, q.delivery_terms, q.warranty_terms, q.freight_terms, q.price_validity, q.other_terms, q.remarks, me)
    returning id into v_po;
    v_n := 0;
    for s in select x from jsonb_array_elements(p_selections) x where (x->>'rfq_vendor_id')::bigint = v_vendor loop
      select * into rl from purchase.rfq_lines where id = (s->>'rfq_line_id')::bigint and rfq_id = p_rfq_id;
      if not found then raise exception 'An item does not belong to this RFQ'; end if;
      if rl.id = any (seen) then raise exception 'An item can be given to only one vendor in one step'; end if;
      seen := seen || rl.id;
      select * into it from purchase.items where id = rl.item_id;
      select * into ql from purchase.quotation_lines where quotation_id = q.id and rfq_line_id = rl.id;
      if not found or not ql.quoting then raise exception '% did not quote %', (select coalesce(trade_name, legal_name) from purchase.vendors where id = rv.vendor_id), it.name; end if;
      if ql.uom_id <> rl.uom_id then
        raise exception 'The vendor quoted % in a different unit (%) than requested (%) - ask them to revise it', it.name, (select code from purchase.uoms where id = ql.uom_id), (select code from purchase.uoms where id = rl.uom_id);
      end if;
      v_qty := coalesce((s->>'qty')::numeric, rl.qty);
      select coalesce(sum(pl.qty), 0) into v_cov from purchase.po_lines pl join purchase.pos p on p.id = pl.po_id and p.deleted_at is null and p.status <> 'cancelled' where pl.rfq_line_id = rl.id;
      if v_qty <= 0 or v_qty > rl.qty - v_cov then raise exception 'For % you can order at most % (the rest is already on purchase orders)', it.name, rl.qty - v_cov; end if;
      v_n := v_n + 1;
      insert into purchase.po_lines(po_id, line_no, item_id, rfq_line_id, qty, uom_id, hsn_code, rate, gst_rate, make, remark)
      values (v_po, v_n, rl.item_id, rl.id, v_qty, rl.uom_id, it.hsn_code, ql.rate, coalesce(ql.gst_rate, it.gst_rate, 0), ql.make, ql.remark);
    end loop;
    perform purchase._po_recalc(v_po);
    insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('po', v_po, me, 'Inserted', 'From ' || coalesce(r.doc_no, 'RFQ'));
    ids := ids || v_po;
  end loop;
  update purchase.rfqs set status = 'closed', closed_at = coalesce(closed_at, now()), updated_at = now() where id = p_rfq_id and status = 'open';
  perform purchase._rfq_refresh_status(p_rfq_id);
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('rfq', p_rfq_id, me, 'Purchase order(s) created', cardinality(ids) || ' draft order(s)');
  return ids;
end $fn$;

-- ---------------------------------------------------------------------------
-- Edit a draft / rejected PO: header (delivery + terms) and the numbers on each line
-- ---------------------------------------------------------------------------
create or replace function purchase.po_update(p_id bigint, p_head jsonb, p_lines jsonb) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('po.create'); p purchase.pos; l jsonb; pl purchase.po_lines; rl purchase.rfq_lines; v_cov numeric;
begin
  select * into p from purchase.pos where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if p.status not in ('draft','rejected') then raise exception 'This purchase order is % and cannot be edited - amend it instead', replace(p.status, '_', ' '); end if;
  if lower(p.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who raised the purchase order can change it'; end if;
  if (p_head->>'warehouse_id') is not null and not exists (select 1 from purchase.warehouses where id = (p_head->>'warehouse_id')::bigint and project_id = p.project_id and active and deleted_at is null) then
    raise exception 'Choose a warehouse of this project';
  end if;
  update purchase.pos set
    warehouse_id = coalesce((p_head->>'warehouse_id')::bigint, warehouse_id),
    delivery_address = nullif(btrim(coalesce(p_head->>'delivery_address', '')), ''), contact_person = nullif(btrim(coalesce(p_head->>'contact_person', '')), ''),
    contact_phone = nullif(btrim(coalesce(p_head->>'contact_phone', '')), ''), remarks = nullif(btrim(coalesce(p_head->>'remarks', '')), ''),
    payment_terms = nullif(btrim(coalesce(p_head->>'payment_terms', '')), ''), delivery_terms = nullif(btrim(coalesce(p_head->>'delivery_terms', '')), ''),
    warranty_terms = nullif(btrim(coalesce(p_head->>'warranty_terms', '')), ''), freight_terms = nullif(btrim(coalesce(p_head->>'freight_terms', '')), ''),
    price_validity = nullif(btrim(coalesce(p_head->>'price_validity', '')), ''), other_terms = nullif(btrim(coalesce(p_head->>'other_terms', '')), ''), updated_at = now()
   where id = p_id;
  if jsonb_typeof(p_lines) = 'array' then
    for l in select * from jsonb_array_elements(p_lines) loop
      select * into pl from purchase.po_lines where id = (l->>'id')::bigint and po_id = p_id;
      if not found then raise exception 'A line does not belong to this purchase order'; end if;
      if coalesce((l->>'qty')::numeric, 0) <= 0 then raise exception 'Quantity must be more than 0'; end if;
      if coalesce((l->>'rate')::numeric, 0) <= 0 then raise exception 'Rate must be more than 0'; end if;
      if coalesce((l->>'gst_rate')::numeric, 0) < 0 or coalesce((l->>'gst_rate')::numeric, 0) > 100 then raise exception 'GST rate must be between 0 and 100'; end if;
      if pl.rfq_line_id is not null then
        select * into rl from purchase.rfq_lines where id = pl.rfq_line_id;
        select coalesce(sum(x.qty), 0) into v_cov from purchase.po_lines x join purchase.pos po on po.id = x.po_id and po.deleted_at is null and po.status <> 'cancelled' where x.rfq_line_id = pl.rfq_line_id and x.id <> pl.id;
        if (l->>'qty')::numeric > rl.qty - v_cov then raise exception 'At most % can be ordered for this item', rl.qty - v_cov; end if;
      end if;
      update purchase.po_lines set qty = (l->>'qty')::numeric, rate = (l->>'rate')::numeric, gst_rate = coalesce((l->>'gst_rate')::numeric, 0),
             make = nullif(btrim(coalesce(l->>'make', '')), ''), remark = nullif(btrim(coalesce(l->>'remark', '')), '') where id = pl.id;
    end loop;
  end if;
  perform purchase._po_recalc(p_id);
  perform purchase._rfq_refresh_status(p.rfq_id);
  insert into purchase.doc_log(doc_type, doc_id, by, action) values ('po', p_id, me, 'Modified');
end $fn$;

create or replace function purchase.po_delete(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('po.create'); p purchase.pos;
begin
  select * into p from purchase.pos where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if p.status <> 'draft' then raise exception 'Only a draft purchase order can be deleted - cancel it instead'; end if;
  if lower(p.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who raised the purchase order can delete it'; end if;
  update purchase.pos set deleted_at = now(), deleted_by = me where id = p_id;
  perform purchase._rfq_refresh_status(p.rfq_id);
  insert into purchase.doc_log(doc_type, doc_id, by, action) values ('po', p_id, me, 'Deleted');
end $fn$;

-- ---------------------------------------------------------------------------
-- Submit: number it, reserve the indent quantity, snapshot the approval levels that apply to its value
-- ---------------------------------------------------------------------------
create or replace function purchase.po_submit(p_id bigint) returns text
 language plpgsql security definer set search_path = purchase, public as $fn$
declare
  me text := purchase._po_guard('po.create'); p purchase.pos; pl purchase.po_lines; rs record; il purchase.indent_lines; v_rem numeric; v_take numeric;
  v_first int; v_no text; v_ind bigint[] := '{}'; v_i bigint;
begin
  select * into p from purchase.pos where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if lower(p.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who raised the purchase order can submit it'; end if;
  if p.status not in ('draft','rejected') then raise exception 'This purchase order is already %', replace(p.status, '_', ' '); end if;
  if p.warehouse_id is null then raise exception 'Choose the delivery warehouse first'; end if;
  if not exists (select 1 from purchase.po_lines where po_id = p_id) then raise exception 'The purchase order has no items'; end if;
  if not exists (select 1 from purchase.vendors where id = p.vendor_id and status = 'approved' and deleted_at is null) then raise exception 'The vendor is no longer approved'; end if;
  select min(level) into v_first from purchase.approval_chains where project_id = p.project_id and doc_type = 'po' and min_value <= p.total_amount;
  if v_first is null then raise exception 'No approver is set for purchase orders of this value - add one in Admin > Approvers'; end if;

  perform set_config('purchase.in_fn', '1', true);
  -- reserve the quantity on the indent lines this order came from
  for pl in select * from purchase.po_lines where po_id = p_id order by line_no loop
    v_rem := pl.qty;
    for rs in select indent_line_id from purchase.rfq_sources where rfq_line_id = pl.rfq_line_id order by id loop
      exit when v_rem <= 0;
      select * into il from purchase.indent_lines where id = rs.indent_line_id for update;
      if not exists (select 1 from purchase.indents where id = il.indent_id and status = 'approved' and deleted_at is null) then continue; end if;
      v_take := least(v_rem, il.qty - il.ordered_qty - il.short_closed_qty);
      if v_take > 0 then
        insert into purchase.po_line_sources(po_line_id, indent_line_id, qty) values (pl.id, il.id, v_take);
        update purchase.indent_lines set ordered_qty = ordered_qty + v_take where id = il.id;
        v_rem := v_rem - v_take; v_ind := v_ind || il.indent_id;
      end if;
    end loop;
    if v_rem > 0.0005 then
      raise exception 'Not enough open indent quantity left for % (short by %) - it may have been ordered or short closed meanwhile', (select name from purchase.items where id = pl.item_id), v_rem;
    end if;
  end loop;

  v_no := coalesce(p.doc_no, purchase.next_doc_no(p.project_id, 'PO', p.po_date));
  insert into purchase.po_approvals(po_id, round, level, approvers, status)
    select p_id, p.round + 1, c.level, c.approvers, case when c.level = v_first then 'pending' else 'waiting' end
      from purchase.approval_chains c where c.project_id = p.project_id and c.doc_type = 'po' and c.min_value <= p.total_amount;
  update purchase.pos set status = 'pending_approval', current_level = v_first, round = p.round + 1, doc_no = v_no, submitted_at = now(), updated_at = now() where id = p_id;
  foreach v_i in array (select coalesce(array_agg(distinct x), '{}') from unnest(v_ind) x) loop perform purchase.indent_refresh(v_i); end loop;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('po', p_id, me, case when p.round = 0 then 'submitted' else 'resubmitted' end, 'Revision ' || p.revision);
  perform set_config('purchase.in_fn', '', true);
  return v_no;
end $fn$;

create or replace function purchase.po_decide(p_id bigint, p_approve boolean, p_remark text default null) returns text
 language plpgsql security definer set search_path = purchase, public as $fn$
declare p purchase.pos; a purchase.po_approvals; me text := lower(coalesce(app.current_user_email(), '')); v_next int; v_out text;
begin
  if me = '' then raise exception 'not signed in'; end if;
  if app.is_customer() then raise exception 'not allowed'; end if;
  select * into p from purchase.pos where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if p.status <> 'pending_approval' then raise exception 'This purchase order is not waiting for approval'; end if;
  select * into a from purchase.po_approvals where po_id = p_id and round = p.round and level = p.current_level and status = 'pending' for update;
  if not found then raise exception 'No approval step is open on this purchase order'; end if;
  if not exists (select 1 from unnest(a.approvers) x where lower(x) = me) then raise exception 'You are not an approver at this level'; end if;
  if lower(p.raised_by) = me and purchase.setting('po.allow_self_approval', 'false') <> 'true' then raise exception 'You cannot decide a purchase order you raised yourself'; end if;
  if not p_approve and btrim(coalesce(p_remark, '')) = '' then raise exception 'Give a reason for rejecting'; end if;

  perform set_config('purchase.in_fn', '1', true);
  update purchase.po_approvals set status = case when p_approve then 'approved' else 'rejected' end, acted_by = me, acted_at = now(), remark = nullif(btrim(coalesce(p_remark, '')), '') where id = a.id;
  if p_approve then
    select min(level) into v_next from purchase.po_approvals where po_id = p_id and round = p.round and status = 'waiting';
    if v_next is null then
      update purchase.pos set status = 'approved', current_level = 0, approved_at = now(), updated_at = now() where id = p_id;
      insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('po', p_id, me, 'approved', nullif(btrim(coalesce(p_remark, '')), ''));
      v_out := 'approved';
    else
      update purchase.po_approvals set status = 'pending' where po_id = p_id and round = p.round and level = v_next;
      update purchase.pos set current_level = v_next, updated_at = now() where id = p_id;
      insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('po', p_id, me, 'approved level ' || a.level, nullif(btrim(coalesce(p_remark, '')), ''));
      v_out := 'pending_approval';
    end if;
  else
    perform purchase._po_release(p_id);
    update purchase.pos set status = 'rejected', current_level = 0, updated_at = now() where id = p_id;
    insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('po', p_id, me, 'rejected', btrim(p_remark));
    v_out := 'rejected';
  end if;
  perform set_config('purchase.in_fn', '', true);
  return v_out;
end $fn$;

create or replace function purchase.po_cancel(p_id bigint, p_reason text) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('po.create'); p purchase.pos;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason for cancelling'; end if;
  select * into p from purchase.pos where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if p.status = 'pending_approval' then raise exception 'This purchase order is waiting for approval - an approver must decide it first'; end if;
  if p.status not in ('draft','rejected','approved') then raise exception 'This purchase order is % and cannot be cancelled', p.status; end if;
  if p.status = 'approved' and exists (select 1 from purchase.po_lines where po_id = p_id and received_qty > 0) then raise exception 'Goods have already been received against this order - short close it instead'; end if;
  perform set_config('purchase.in_fn', '1', true);
  if p.status = 'approved' then perform purchase._po_release(p_id); end if;
  update purchase.pos set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason), current_level = 0, updated_at = now() where id = p_id;
  perform purchase._rfq_refresh_status(p.rfq_id);
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('po', p_id, me, 'Cancelled', btrim(p_reason));
  perform set_config('purchase.in_fn', '', true);
end $fn$;

-- Amend an approved PO that has had nothing received: keep the old version, reopen it as a draft (next revision).
create or replace function purchase.po_amend(p_id bigint, p_reason text) returns int
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('po.create'); p purchase.pos;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason for the amendment'; end if;
  select * into p from purchase.pos where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if p.status <> 'approved' then raise exception 'Only an approved purchase order can be amended'; end if;
  if exists (select 1 from purchase.po_lines where po_id = p_id and (received_qty > 0 or short_closed_qty > 0)) then raise exception 'Goods have been received or the order short closed - it can no longer be amended'; end if;
  insert into purchase.po_revisions(po_id, revision, snapshot, reason, created_by)
  values (p_id, p.revision, jsonb_build_object('po', to_jsonb(p), 'lines', (select coalesce(jsonb_agg(to_jsonb(l) order by l.line_no), '[]'::jsonb) from purchase.po_lines l where l.po_id = p_id)), btrim(p_reason), me);
  perform set_config('purchase.in_fn', '1', true);
  perform purchase._po_release(p_id);
  update purchase.pos set status = 'draft', revision = revision + 1, current_level = 0, approved_at = null, submitted_at = null, updated_at = now() where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('po', p_id, me, 'Amended - revision ' || (p.revision + 1), btrim(p_reason));
  perform set_config('purchase.in_fn', '', true);
  return p.revision + 1;
end $fn$;

-- Short close the unreceived balance of selected lines; optionally hand the quantity back to the indents.
create or replace function purchase.po_short_close(p_id bigint, p_line_ids bigint[], p_reason text, p_release boolean default false) returns int
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('po.short_close'); p purchase.pos; pl purchase.po_lines; n int := 0; v_bal numeric; v_rem numeric; s record; v_rel numeric; v_ind bigint[] := '{}'; v_i bigint;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason for short closing'; end if;
  select * into p from purchase.pos where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if p.status <> 'approved' then raise exception 'Only an approved purchase order that is still open can be short closed'; end if;
  perform set_config('purchase.in_fn', '1', true);
  for pl in select * from purchase.po_lines where po_id = p_id and (p_line_ids is null or id = any (p_line_ids)) loop
    v_bal := pl.qty - pl.received_qty - pl.short_closed_qty;
    if v_bal <= 0 then continue; end if;
    update purchase.po_lines set short_closed_qty = short_closed_qty + v_bal, short_close_reason = btrim(p_reason), short_closed_by = me, short_closed_at = now() where id = pl.id;
    n := n + 1;
    if p_release then
      v_rem := v_bal;
      for s in select ps.id, ps.indent_line_id, ps.qty - ps.released_qty as avail, il.indent_id from purchase.po_line_sources ps join purchase.indent_lines il on il.id = ps.indent_line_id
                where ps.po_line_id = pl.id order by ps.id desc loop
        exit when v_rem <= 0;
        v_rel := least(v_rem, s.avail);
        if v_rel > 0 then
          update purchase.indent_lines set ordered_qty = greatest(0, ordered_qty - v_rel) where id = s.indent_line_id;
          update purchase.po_line_sources set released_qty = released_qty + v_rel where id = s.id;
          v_rem := v_rem - v_rel; v_ind := v_ind || s.indent_id;
        end if;
      end loop;
    end if;
  end loop;
  if n = 0 then raise exception 'Nothing is left to close on the selected items'; end if;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark)
    values ('po', p_id, me, 'short closed ' || n || ' item' || case when n = 1 then '' else 's' end, btrim(p_reason) || case when p_release then ' (quantity returned to the indents)' else '' end);
  perform purchase.po_refresh(p_id);
  foreach v_i in array (select coalesce(array_agg(distinct x), '{}') from unnest(v_ind) x) loop perform purchase._indent_reopen(v_i); end loop;
  perform set_config('purchase.in_fn', '', true);
  return n;
end $fn$;

do $g$
declare f text;
begin
  foreach f in array array['po_create_from_rfq(bigint, jsonb, bigint)','po_update(bigint, jsonb, jsonb)','po_delete(bigint)','po_submit(bigint)','po_decide(bigint, boolean, text)','po_cancel(bigint, text)','po_amend(bigint, text)','po_short_close(bigint, bigint[], text, boolean)'] loop
    execute 'revoke all on function purchase.' || f || ' from public, anon';
    execute 'grant execute on function purchase.' || f || ' to authenticated';
  end loop;
end $g$;

do $rls$
declare t text;
begin
  foreach t in array array['pos','po_lines','po_line_sources','po_approvals','po_revisions'] loop
    execute format('alter table purchase.%I enable row level security', t);
    execute format('drop policy if exists %I on purchase.%I', t || '_staff_read', t);
    execute format('create policy %I on purchase.%I for select to authenticated using ((select not app.is_customer()))', t || '_staff_read', t);
    execute format('grant select on purchase.%I to authenticated', t);
  end loop;
end $rls$;
grant usage, select on all sequences in schema purchase to authenticated;

update purchase.permissions set stage = null where key in ('po.create','po.short_close');
