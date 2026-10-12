-- Purchase & Stores, Stages 7 and 8: bills, debit notes, non-store purchases and services.
-- See docs/purchase-stores-spec.md sections 7 and 8.
--
-- BILLS (one table for three kinds)
--   goods      booked against posted GRN lines of a PO (3-way match: PO rate/qty <-> GRN accepted qty <-> invoice);
--              the quantity billed can never exceed what was received (net of returns)
--   non_store  booked against an approved non-store purchase order (expenditure that does not go into stores)
--   service    booked against an approved service work order, or DIRECTLY (a service bill with no order)
--   HSN / SAC is mandatory on every non-store and service line.
-- A booked bill carries accounts_status 'ready' (= ready to post) and a slot for the accounting entry; Accounts
-- will take it from there. Services bought from CONTRACTORS belong to the Engineering module, not here.
-- DEBIT NOTES are raised against a booked bill: quantity based (returns / shortage), rate based (invoice rate
-- above the agreed rate) or amount based (lump sum). They reduce what is payable on the bill.
-- EXPENSE ORDERS (non-store purchases and service work orders) are approved through a chain, like a PO.
-- All writes go through the functions below; the tables are read-only from the browser.
-- Numbers: <project code>/<NSP|WO|BILL|DN>/<financial year>/<serial>.

alter table purchase.approval_chains drop constraint if exists approval_chains_doc_type_check;
alter table purchase.approval_chains add constraint approval_chains_doc_type_check check (doc_type in ('indent','po','adjustment','nonstore','wo'));

alter table purchase.grn_lines add column if not exists billed_qty numeric(14,3) not null default 0 check (billed_qty >= 0);

-- ---------------------------------------------------------------------------
-- Expense heads
-- ---------------------------------------------------------------------------
create table if not exists purchase.expense_heads(
  id          bigserial primary key,
  name        text not null,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  created_by  text default app.current_user_email(),
  deleted_at  timestamptz,
  deleted_by  text
);
create unique index if not exists expense_heads_name_uq on purchase.expense_heads (lower(name)) where deleted_at is null;
insert into purchase.expense_heads(name, sort_order)
select v.n, v.s from (values ('Repairs & maintenance',1),('Office & admin expenses',2),('Professional & consultancy fees',3),('Printing & stationery',4),
  ('Travel & conveyance',5),('Security & housekeeping',6),('Utilities',7),('Other',8)) v(n, s)
where not exists (select 1 from purchase.expense_heads h where lower(h.name) = lower(v.n) and h.deleted_at is null);

-- ---------------------------------------------------------------------------
-- Expense orders: non-store purchases and service work orders
-- ---------------------------------------------------------------------------
create table if not exists purchase.expense_orders(
  id               bigserial primary key,
  doc_no           text,
  kind             text not null check (kind in ('non_store','service')),
  project_id       bigint not null references cust.projects(id),
  vendor_id        bigint not null references purchase.vendors(id),
  expense_head_id  bigint references purchase.expense_heads(id),
  order_date       date not null default current_date,
  subject          text not null,
  scope            text,
  payment_terms    text,
  remarks          text,
  status           text not null default 'draft' check (status in ('draft','pending_approval','approved','rejected','closed','cancelled')),
  current_level    int not null default 0,
  round            int not null default 0,
  total_basic      numeric(14,2) not null default 0,
  total_gst        numeric(14,2) not null default 0,
  total_amount     numeric(14,2) not null default 0,
  raised_by        text not null default app.current_user_email(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  submitted_at     timestamptz,
  approved_at      timestamptz,
  closed_at        timestamptz,
  cancelled_at     timestamptz,
  cancel_reason    text,
  deleted_at       timestamptz,
  deleted_by       text
);
create unique index if not exists expense_orders_doc_no_uq on purchase.expense_orders (doc_no) where doc_no is not null;
create table if not exists purchase.expense_order_lines(
  id          bigserial primary key,
  order_id    bigint not null references purchase.expense_orders(id) on delete cascade,
  line_no     int not null,
  description text not null,
  hsn_sac     text not null check (hsn_sac ~ '^[0-9]{4}([0-9]{2}([0-9]{2})?)?$'),
  qty         numeric(14,3) not null check (qty > 0),
  unit        text not null default 'Nos',
  rate        numeric(14,2) not null check (rate > 0),
  gst_rate    numeric(5,2) not null default 0 check (gst_rate between 0 and 100),
  amount      numeric(14,2) not null default 0,
  gst_amount  numeric(14,2) not null default 0,
  billed_qty  numeric(14,3) not null default 0 check (billed_qty >= 0)
);
create index if not exists expense_order_lines_idx on purchase.expense_order_lines (order_id, line_no);
create table if not exists purchase.expense_order_approvals(
  id         bigserial primary key,
  order_id   bigint not null references purchase.expense_orders(id) on delete cascade,
  round      int not null,
  level      int not null,
  approvers  text[] not null,
  status     text not null check (status in ('waiting','pending','approved','rejected')),
  acted_by   text,
  acted_at   timestamptz,
  remark     text
);
create index if not exists expense_order_approvals_idx on purchase.expense_order_approvals (order_id, round, level);

create or replace function purchase._eo_recalc(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
begin
  update purchase.expense_order_lines set amount = round(qty * rate, 2), gst_amount = round(round(qty * rate, 2) * gst_rate / 100, 2) where order_id = p_id;
  update purchase.expense_orders set total_basic = coalesce((select sum(amount) from purchase.expense_order_lines where order_id = p_id), 0),
         total_gst = coalesce((select sum(gst_amount) from purchase.expense_order_lines where order_id = p_id), 0),
         total_amount = coalesce((select sum(amount + gst_amount) from purchase.expense_order_lines where order_id = p_id), 0), updated_at = now() where id = p_id;
end $fn$;
revoke all on function purchase._eo_recalc(bigint) from public, anon, authenticated;

create or replace function purchase.eo_save(p_id bigint, p_head jsonb, p_lines jsonb) returns bigint
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('nonstore.purchase'); o purchase.expense_orders; v_id bigint; l jsonb; v_n int := 0; v_kind text; v_vendor purchase.vendors; v_proj bigint; v_date date;
begin
  if p_id is not null then
    select * into o from purchase.expense_orders where id = p_id and deleted_at is null for update;
    if not found then raise exception 'Order not found'; end if;
    if o.status not in ('draft','rejected') then raise exception 'This order is % and cannot be edited', replace(o.status, '_', ' '); end if;
    if lower(o.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who raised the order can change it'; end if;
    v_kind := o.kind; v_proj := o.project_id;
  else
    v_kind := p_head->>'kind'; v_proj := (p_head->>'project_id')::bigint;
    if v_kind not in ('non_store','service') then raise exception 'Choose whether this is a non-store purchase or a service'; end if;
    if not exists (select 1 from cust.projects where id = v_proj) then raise exception 'Choose the project'; end if;
  end if;
  select * into v_vendor from purchase.vendors where id = (p_head->>'vendor_id')::bigint and status = 'approved' and deleted_at is null;
  if not found then raise exception 'Choose an approved vendor'; end if;
  if v_kind = 'service' and v_vendor.vendor_type not in ('service','both') then raise exception 'This vendor is not enlisted as a service provider'; end if;
  if btrim(coalesce(p_head->>'subject', '')) = '' then raise exception 'Say what the order is for'; end if;
  v_date := coalesce((p_head->>'order_date')::date, current_date);
  if v_date > current_date then raise exception 'The date cannot be in the future'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one line'; end if;
  if p_id is null then
    insert into purchase.expense_orders(kind, project_id, vendor_id, expense_head_id, order_date, subject, scope, payment_terms, remarks, raised_by)
    values (v_kind, v_proj, v_vendor.id, nullif(p_head->>'expense_head_id', '')::bigint, v_date, btrim(p_head->>'subject'), nullif(btrim(coalesce(p_head->>'scope', '')), ''),
            nullif(btrim(coalesce(p_head->>'payment_terms', '')), ''), nullif(btrim(coalesce(p_head->>'remarks', '')), ''), me) returning id into v_id;
  else
    v_id := p_id;
    update purchase.expense_orders set vendor_id = v_vendor.id, expense_head_id = nullif(p_head->>'expense_head_id', '')::bigint, order_date = v_date, subject = btrim(p_head->>'subject'),
           scope = nullif(btrim(coalesce(p_head->>'scope', '')), ''), payment_terms = nullif(btrim(coalesce(p_head->>'payment_terms', '')), ''), remarks = nullif(btrim(coalesce(p_head->>'remarks', '')), ''), updated_at = now() where id = v_id;
    delete from purchase.expense_order_lines where order_id = v_id;
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    if btrim(coalesce(l->>'description', '')) = '' then raise exception 'Every line needs a description'; end if;
    if coalesce(l->>'hsn_sac', '') !~ '^[0-9]{4}([0-9]{2}([0-9]{2})?)?$' then raise exception 'HSN / SAC is mandatory on every line (4, 6 or 8 digits)'; end if;
    if coalesce((l->>'qty')::numeric, 0) <= 0 then raise exception 'Quantity must be more than 0'; end if;
    if coalesce((l->>'rate')::numeric, 0) <= 0 then raise exception 'Rate must be more than 0'; end if;
    if coalesce((l->>'gst_rate')::numeric, 0) < 0 or coalesce((l->>'gst_rate')::numeric, 0) > 100 then raise exception 'GST rate must be between 0 and 100'; end if;
    v_n := v_n + 1;
    insert into purchase.expense_order_lines(order_id, line_no, description, hsn_sac, qty, unit, rate, gst_rate)
    values (v_id, v_n, btrim(l->>'description'), l->>'hsn_sac', (l->>'qty')::numeric, coalesce(nullif(btrim(coalesce(l->>'unit', '')), ''), 'Nos'), (l->>'rate')::numeric, coalesce((l->>'gst_rate')::numeric, 0));
  end loop;
  perform purchase._eo_recalc(v_id);
  insert into purchase.doc_log(doc_type, doc_id, by, action) values ('eo', v_id, me, case when p_id is null then 'Inserted' else 'Modified' end);
  return v_id;
end $fn$;

create or replace function purchase.eo_delete(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('nonstore.purchase'); o purchase.expense_orders;
begin
  select * into o from purchase.expense_orders where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status <> 'draft' then raise exception 'Only a draft order can be deleted - cancel it instead'; end if;
  if lower(o.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who raised the order can delete it'; end if;
  update purchase.expense_orders set deleted_at = now(), deleted_by = me where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action) values ('eo', p_id, me, 'Deleted');
end $fn$;

create or replace function purchase.eo_submit(p_id bigint) returns text
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('nonstore.purchase'); o purchase.expense_orders; v_first int; v_no text; v_doc text;
begin
  select * into o from purchase.expense_orders where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Order not found'; end if;
  if lower(o.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who raised the order can submit it'; end if;
  if o.status not in ('draft','rejected') then raise exception 'This order is already %', replace(o.status, '_', ' '); end if;
  if not exists (select 1 from purchase.expense_order_lines where order_id = p_id) then raise exception 'The order has no lines'; end if;
  if not exists (select 1 from purchase.vendors where id = o.vendor_id and status = 'approved' and deleted_at is null) then raise exception 'The vendor is no longer approved'; end if;
  v_doc := case when o.kind = 'service' then 'wo' else 'nonstore' end;
  select min(level) into v_first from purchase.approval_chains where project_id = o.project_id and doc_type = v_doc and min_value <= o.total_amount;
  if v_first is null then raise exception 'No approver is set for orders of this value - add one in Admin > Approvers'; end if;
  v_no := coalesce(o.doc_no, purchase.next_doc_no(o.project_id, case when o.kind = 'service' then 'WO' else 'NSP' end, o.order_date));
  insert into purchase.expense_order_approvals(order_id, round, level, approvers, status)
    select p_id, o.round + 1, c.level, c.approvers, case when c.level = v_first then 'pending' else 'waiting' end
      from purchase.approval_chains c where c.project_id = o.project_id and c.doc_type = v_doc and c.min_value <= o.total_amount;
  update purchase.expense_orders set status = 'pending_approval', current_level = v_first, round = o.round + 1, doc_no = v_no, submitted_at = now(), updated_at = now() where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action) values ('eo', p_id, me, case when o.round = 0 then 'submitted' else 'resubmitted' end);
  return v_no;
end $fn$;

create or replace function purchase.eo_decide(p_id bigint, p_approve boolean, p_remark text default null) returns text
 language plpgsql security definer set search_path = purchase, public as $fn$
declare o purchase.expense_orders; a purchase.expense_order_approvals; me text := lower(coalesce(app.current_user_email(), '')); v_next int; v_out text;
begin
  if me = '' then raise exception 'not signed in'; end if;
  if app.is_customer() then raise exception 'not allowed'; end if;
  select * into o from purchase.expense_orders where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status <> 'pending_approval' then raise exception 'This order is not waiting for approval'; end if;
  select * into a from purchase.expense_order_approvals where order_id = p_id and round = o.round and level = o.current_level and status = 'pending' for update;
  if not found then raise exception 'No approval step is open on this order'; end if;
  if not exists (select 1 from unnest(a.approvers) x where lower(x) = me) then raise exception 'You are not an approver at this level'; end if;
  if lower(o.raised_by) = me and purchase.setting('po.allow_self_approval', 'false') <> 'true' then raise exception 'You cannot decide an order you raised yourself'; end if;
  if not p_approve and btrim(coalesce(p_remark, '')) = '' then raise exception 'Give a reason for rejecting'; end if;
  update purchase.expense_order_approvals set status = case when p_approve then 'approved' else 'rejected' end, acted_by = me, acted_at = now(), remark = nullif(btrim(coalesce(p_remark, '')), '') where id = a.id;
  if p_approve then
    select min(level) into v_next from purchase.expense_order_approvals where order_id = p_id and round = o.round and status = 'waiting';
    if v_next is null then
      update purchase.expense_orders set status = 'approved', current_level = 0, approved_at = now(), updated_at = now() where id = p_id;
      insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('eo', p_id, me, 'approved', nullif(btrim(coalesce(p_remark, '')), ''));
      v_out := 'approved';
    else
      update purchase.expense_order_approvals set status = 'pending' where order_id = p_id and round = o.round and level = v_next;
      update purchase.expense_orders set current_level = v_next, updated_at = now() where id = p_id;
      insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('eo', p_id, me, 'approved level ' || a.level, nullif(btrim(coalesce(p_remark, '')), ''));
      v_out := 'pending_approval';
    end if;
  else
    update purchase.expense_orders set status = 'rejected', current_level = 0, updated_at = now() where id = p_id;
    insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('eo', p_id, me, 'rejected', btrim(p_remark));
    v_out := 'rejected';
  end if;
  return v_out;
end $fn$;

create or replace function purchase.eo_cancel(p_id bigint, p_reason text) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('nonstore.purchase'); o purchase.expense_orders;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason for cancelling'; end if;
  select * into o from purchase.expense_orders where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status = 'pending_approval' then raise exception 'This order is waiting for approval - an approver must decide it first'; end if;
  if o.status not in ('draft','rejected','approved') then raise exception 'This order is % and cannot be cancelled', o.status; end if;
  if exists (select 1 from purchase.expense_order_lines where order_id = p_id and billed_qty > 0) then raise exception 'Bills have been booked against this order - close it instead'; end if;
  update purchase.expense_orders set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason), updated_at = now() where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('eo', p_id, me, 'Cancelled', btrim(p_reason));
end $fn$;

-- Close what is left of an approved order (nothing more will be billed against it).
create or replace function purchase.eo_close(p_id bigint, p_reason text) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('nonstore.purchase'); o purchase.expense_orders;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason for closing'; end if;
  select * into o from purchase.expense_orders where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status <> 'approved' then raise exception 'Only an approved order can be closed'; end if;
  update purchase.expense_orders set status = 'closed', closed_at = now(), updated_at = now() where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('eo', p_id, me, 'Closed', btrim(p_reason));
end $fn$;

-- ---------------------------------------------------------------------------
-- Bills
-- ---------------------------------------------------------------------------
create table if not exists purchase.bills(
  id                   bigserial primary key,
  doc_no               text,
  bill_type            text not null check (bill_type in ('goods','non_store','service')),
  project_id           bigint not null references cust.projects(id),
  vendor_id            bigint not null references purchase.vendors(id),
  po_id                bigint references purchase.pos(id),
  order_id             bigint references purchase.expense_orders(id),
  expense_head_id      bigint references purchase.expense_heads(id),
  invoice_no           text not null,
  invoice_date         date not null,
  bill_date            date not null default current_date,
  due_date             date,
  gst_type             text not null default 'intra' check (gst_type in ('intra','inter')),
  other_charges        numeric(14,2) not null default 0 check (other_charges >= 0),
  other_charges_gst    numeric(5,2) not null default 0,
  taxable_value        numeric(14,2) not null default 0,
  gst_total            numeric(14,2) not null default 0,
  cgst                 numeric(14,2) not null default 0,
  sgst                 numeric(14,2) not null default 0,
  igst                 numeric(14,2) not null default 0,
  tds_rate             numeric(5,2) not null default 0,
  tds_amount           numeric(14,2) not null default 0,
  total_amount         numeric(14,2) not null default 0,
  payable_amount       numeric(14,2) not null default 0,
  debit_noted          numeric(14,2) not null default 0,
  variance_note        text,
  remarks              text,
  status               text not null default 'draft' check (status in ('draft','booked','cancelled')),
  accounts_status      text not null default 'ready' check (accounts_status in ('ready','posted','hold')),
  accounts_ref         text,
  accounts_posted_at   timestamptz,
  raised_by            text not null default app.current_user_email(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  booked_at            timestamptz,
  cancelled_at         timestamptz,
  cancel_reason        text,
  deleted_at           timestamptz,
  deleted_by           text
);
create unique index if not exists bills_doc_no_uq on purchase.bills (doc_no) where doc_no is not null;
create unique index if not exists bills_vendor_invoice_uq on purchase.bills (vendor_id, lower(invoice_no)) where status <> 'cancelled' and deleted_at is null;
create index if not exists bills_vendor_idx on purchase.bills (vendor_id, status);
comment on column purchase.bills.accounts_status is 'ready = ready to post to Accounts; posted / hold are set by Accounts later.';

create table if not exists purchase.bill_lines(
  id               bigserial primary key,
  bill_id          bigint not null references purchase.bills(id) on delete cascade,
  line_no          int not null,
  grn_line_id      bigint references purchase.grn_lines(id),
  po_line_id       bigint references purchase.po_lines(id),
  order_line_id    bigint references purchase.expense_order_lines(id),
  item_id          bigint references purchase.items(id),
  description      text,
  hsn_sac          text,
  qty              numeric(14,3) not null check (qty > 0),
  unit             text,
  rate             numeric(14,2) not null check (rate > 0),
  ref_rate         numeric(14,2),
  gst_rate         numeric(5,2) not null default 0 check (gst_rate between 0 and 100),
  taxable          numeric(14,2) not null default 0,
  gst_amount       numeric(14,2) not null default 0,
  debit_noted_qty  numeric(14,3) not null default 0 check (debit_noted_qty >= 0),
  rate_dn          boolean not null default false
);
create index if not exists bill_lines_bill_idx on purchase.bill_lines (bill_id, line_no);

create or replace function purchase._bill_recalc(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare b purchase.bills; v_taxable numeric; v_gst numeric; v_oc numeric; v_ocg numeric; v_tds numeric;
begin
  select * into b from purchase.bills where id = p_id;
  update purchase.bill_lines set taxable = round(qty * rate, 2), gst_amount = round(round(qty * rate, 2) * gst_rate / 100, 2) where bill_id = p_id;
  select coalesce(sum(taxable), 0), coalesce(sum(gst_amount), 0) into v_taxable, v_gst from purchase.bill_lines where bill_id = p_id;
  v_oc := coalesce(b.other_charges, 0); v_ocg := round(v_oc * coalesce(b.other_charges_gst, 0) / 100, 2);
  v_taxable := v_taxable + v_oc; v_gst := v_gst + v_ocg;
  v_tds := round(v_taxable * coalesce(b.tds_rate, 0) / 100, 2);
  update purchase.bills set taxable_value = v_taxable, gst_total = v_gst,
         cgst = case when gst_type = 'intra' then round(v_gst / 2, 2) else 0 end,
         sgst = case when gst_type = 'intra' then v_gst - round(v_gst / 2, 2) else 0 end,
         igst = case when gst_type = 'inter' then v_gst else 0 end,
         tds_amount = v_tds, total_amount = v_taxable + v_gst, payable_amount = v_taxable + v_gst - v_tds - debit_noted, updated_at = now()
   where id = p_id;
end $fn$;
revoke all on function purchase._bill_recalc(bigint) from public, anon, authenticated;

create or replace function purchase.bill_save(p_id bigint, p_head jsonb, p_lines jsonb) returns bigint
 language plpgsql security definer set search_path = purchase, public as $fn$
declare
  me text; b purchase.bills; v_type text; v_id bigint; v_perm text; po purchase.pos; eo purchase.expense_orders; l jsonb; gl purchase.grn_lines; g purchase.grns; pl purchase.po_lines; ol purchase.expense_order_lines;
  v_proj bigint; v_vendor bigint; v_n int := 0; v_inv text; v_idate date; v_gtype text; v_tds numeric; v_oc numeric; v_ocg numeric; v_head bigint; v_rate numeric; v_qty numeric; v_vrow purchase.vendors;
begin
  if p_id is not null then
    select * into b from purchase.bills where id = p_id and deleted_at is null for update;
    if not found then raise exception 'Bill not found'; end if;
    v_type := b.bill_type;
  else
    v_type := p_head->>'bill_type';
  end if;
  if v_type not in ('goods','non_store','service') then raise exception 'Choose the kind of bill'; end if;
  v_perm := case when v_type = 'goods' then 'bill.book' else 'nonstore.purchase' end;
  me := purchase._po_guard(v_perm);
  if p_id is not null then
    if b.status <> 'draft' then raise exception 'A booked bill cannot be edited - cancel it and book it again'; end if;
    if lower(b.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who entered the bill can change it'; end if;
  end if;
  v_inv := btrim(coalesce(p_head->>'invoice_no', ''));
  if v_inv = '' then raise exception 'Enter the vendor''s invoice number'; end if;
  v_idate := (p_head->>'invoice_date')::date;
  if v_idate is null then raise exception 'Enter the invoice date'; end if;
  if v_idate > current_date then raise exception 'The invoice date cannot be in the future'; end if;
  v_gtype := coalesce(nullif(p_head->>'gst_type', ''), 'intra');
  if v_gtype not in ('intra','inter') then raise exception 'Choose the GST type'; end if;
  v_oc := coalesce(nullif(p_head->>'other_charges', '')::numeric, 0); v_ocg := coalesce(nullif(p_head->>'other_charges_gst', '')::numeric, 0);
  if v_oc < 0 or v_ocg < 0 or v_ocg > 100 then raise exception 'Check the other charges and their GST rate'; end if;
  v_tds := case when purchase.setting('billing.capture_tds', 'false') = 'true' then coalesce(nullif(p_head->>'tds_rate', '')::numeric, 0) else 0 end;
  if v_tds < 0 or v_tds > 100 then raise exception 'TDS rate must be between 0 and 100'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one line'; end if;

  -- context: where the bill comes from
  if p_id is not null then v_proj := b.project_id; v_vendor := b.vendor_id;
  elsif v_type = 'goods' then
    select * into po from purchase.pos where id = (p_head->>'po_id')::bigint and deleted_at is null;
    if not found or po.status not in ('approved','closed') then raise exception 'Choose an approved purchase order'; end if;
    v_proj := po.project_id; v_vendor := po.vendor_id;
  elsif (p_head->>'order_id') is not null then
    select * into eo from purchase.expense_orders where id = (p_head->>'order_id')::bigint and deleted_at is null;
    if not found or eo.status not in ('approved','closed') then raise exception 'Choose an approved order'; end if;
    if (v_type = 'non_store') <> (eo.kind = 'non_store') then raise exception 'That order is not a % order', replace(v_type, '_', '-'); end if;
    v_proj := eo.project_id; v_vendor := eo.vendor_id; v_head := eo.expense_head_id;
  elsif v_type = 'service' then
    v_proj := (p_head->>'project_id')::bigint; v_vendor := (p_head->>'vendor_id')::bigint;
    select * into v_vrow from purchase.vendors where id = v_vendor and status = 'approved' and deleted_at is null;
    if not found then raise exception 'Choose an approved vendor'; end if;
    if v_vrow.vendor_type not in ('service','both') then raise exception 'This vendor is not enlisted as a service provider'; end if;
    if not exists (select 1 from cust.projects where id = v_proj) then raise exception 'Choose the project'; end if;
  else raise exception 'A non-store purchase is billed against its approved purchase - make that first';
  end if;
  if exists (select 1 from purchase.bills where vendor_id = v_vendor and lower(invoice_no) = lower(v_inv) and status <> 'cancelled' and deleted_at is null and id is distinct from p_id) then
    raise exception 'This vendor''s invoice % has already been entered', v_inv;
  end if;

  if p_id is null then
    insert into purchase.bills(bill_type, project_id, vendor_id, po_id, order_id, expense_head_id, invoice_no, invoice_date, due_date, gst_type, other_charges, other_charges_gst, tds_rate, variance_note, remarks, raised_by)
    values (v_type, v_proj, v_vendor, po.id, eo.id, coalesce(nullif(p_head->>'expense_head_id', '')::bigint, v_head), v_inv, v_idate, nullif(p_head->>'due_date', '')::date, v_gtype, v_oc, v_ocg, v_tds,
            nullif(btrim(coalesce(p_head->>'variance_note', '')), ''), nullif(btrim(coalesce(p_head->>'remarks', '')), ''), me) returning id into v_id;
  else
    v_id := p_id;
    update purchase.bills set invoice_no = v_inv, invoice_date = v_idate, due_date = nullif(p_head->>'due_date', '')::date, gst_type = v_gtype, other_charges = v_oc, other_charges_gst = v_ocg, tds_rate = v_tds,
           expense_head_id = coalesce(nullif(p_head->>'expense_head_id', '')::bigint, expense_head_id), variance_note = nullif(btrim(coalesce(p_head->>'variance_note', '')), ''),
           remarks = nullif(btrim(coalesce(p_head->>'remarks', '')), ''), updated_at = now() where id = v_id;
    delete from purchase.bill_lines where bill_id = v_id;
    select * into po from purchase.pos where id = b.po_id; select * into eo from purchase.expense_orders where id = b.order_id;
  end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_n := v_n + 1; v_qty := (l->>'qty')::numeric; v_rate := (l->>'rate')::numeric;
    if coalesce(v_qty, 0) <= 0 then raise exception 'Quantity must be more than 0'; end if;
    if coalesce(v_rate, 0) <= 0 then raise exception 'Rate must be more than 0'; end if;
    if v_type = 'goods' then
      select * into gl from purchase.grn_lines where id = (l->>'grn_line_id')::bigint;
      if not found then raise exception 'A goods receipt line was not found'; end if;
      select * into g from purchase.grns where id = gl.grn_id;
      if g.po_id <> po.id or g.status <> 'posted' then raise exception 'Bill only goods received (posted GRNs) against this purchase order'; end if;
      select * into pl from purchase.po_lines where id = gl.po_line_id;
      insert into purchase.bill_lines(bill_id, line_no, grn_line_id, po_line_id, item_id, description, hsn_sac, qty, unit, rate, ref_rate, gst_rate)
      values (v_id, v_n, gl.id, pl.id, gl.item_id, (select name from purchase.items where id = gl.item_id), pl.hsn_code, v_qty, (select code from purchase.uoms where id = gl.uom_id), v_rate, pl.rate, coalesce((l->>'gst_rate')::numeric, pl.gst_rate));
    elsif eo.id is not null then
      select * into ol from purchase.expense_order_lines where id = (l->>'order_line_id')::bigint and order_id = eo.id;
      if not found then raise exception 'A line does not belong to the order'; end if;
      insert into purchase.bill_lines(bill_id, line_no, order_line_id, description, hsn_sac, qty, unit, rate, ref_rate, gst_rate)
      values (v_id, v_n, ol.id, ol.description, ol.hsn_sac, v_qty, ol.unit, v_rate, ol.rate, coalesce((l->>'gst_rate')::numeric, ol.gst_rate));
    else
      if btrim(coalesce(l->>'description', '')) = '' then raise exception 'Every line needs a description'; end if;
      if coalesce(l->>'hsn_sac', '') !~ '^[0-9]{4}([0-9]{2}([0-9]{2})?)?$' then raise exception 'HSN / SAC is mandatory on every line (4, 6 or 8 digits)'; end if;
      insert into purchase.bill_lines(bill_id, line_no, description, hsn_sac, qty, unit, rate, gst_rate)
      values (v_id, v_n, btrim(l->>'description'), l->>'hsn_sac', v_qty, coalesce(nullif(btrim(coalesce(l->>'unit', '')), ''), 'Nos'), v_rate, coalesce((l->>'gst_rate')::numeric, 0));
    end if;
  end loop;
  perform purchase._bill_recalc(v_id);
  insert into purchase.doc_log(doc_type, doc_id, by, action) values ('bill', v_id, me, case when p_id is null then 'Inserted' else 'Modified' end);
  return v_id;
end $fn$;

create or replace function purchase.bill_delete(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare b purchase.bills; me text;
begin
  select * into b from purchase.bills where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Bill not found'; end if;
  me := purchase._po_guard(case when b.bill_type = 'goods' then 'bill.book' else 'nonstore.purchase' end);
  if b.status <> 'draft' then raise exception 'Only a draft bill can be deleted - cancel a booked one instead'; end if;
  if lower(b.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who entered the bill can delete it'; end if;
  update purchase.bills set deleted_at = now(), deleted_by = me where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action) values ('bill', p_id, me, 'Deleted');
end $fn$;

-- Book: the 3-way match is checked here and the quantities are taken off what is still billable.
create or replace function purchase.bill_book(p_id bigint) returns text
 language plpgsql security definer set search_path = purchase, public as $fn$
declare
  b purchase.bills; me text; bl purchase.bill_lines; gl purchase.grn_lines; ol purchase.expense_order_lines; v_avail numeric; v_no text;
  v_tol numeric := coalesce(nullif(purchase.setting('billing.rate_tolerance_pct', '0'), '')::numeric, 0); v_block boolean := purchase.setting('billing.rate_variance', 'reason') = 'block'; v_over boolean := false; v_pct numeric;
begin
  select * into b from purchase.bills where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Bill not found'; end if;
  me := purchase._po_guard(case when b.bill_type = 'goods' then 'bill.book' else 'nonstore.purchase' end);
  if b.status <> 'draft' then raise exception 'This bill is already %', b.status; end if;
  if lower(b.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who entered the bill can book it'; end if;
  if not exists (select 1 from purchase.vendors where id = b.vendor_id and status = 'approved' and deleted_at is null) then raise exception 'The vendor is no longer approved'; end if;
  for bl in select * from purchase.bill_lines where bill_id = p_id order by line_no loop
    if bl.grn_line_id is not null then
      select * into gl from purchase.grn_lines where id = bl.grn_line_id for update;
      v_avail := gl.accepted_qty - gl.returned_qty - gl.billed_qty;
      if bl.qty > v_avail + 0.0005 then raise exception 'Cannot bill % of %: only % received and not yet billed', bl.qty, bl.description, greatest(v_avail, 0); end if;
    elsif bl.order_line_id is not null then
      select * into ol from purchase.expense_order_lines where id = bl.order_line_id for update;
      v_avail := ol.qty - ol.billed_qty;
      if bl.qty > v_avail + 0.0005 then raise exception 'Cannot bill % of %: only % of the order is left', bl.qty, bl.description, greatest(v_avail, 0); end if;
    end if;
    if bl.ref_rate is not null and bl.ref_rate > 0 then
      v_pct := (bl.rate - bl.ref_rate) / bl.ref_rate * 100;
      if v_pct > v_tol + 0.0001 then v_over := true; end if;
    end if;
  end loop;
  if v_over then
    if v_block then raise exception 'The invoice rate is above the agreed rate on one or more lines - raise it with the vendor or correct the rate'; end if;
    if btrim(coalesce(b.variance_note, '')) = '' then raise exception 'The invoice rate is above the agreed rate on one or more lines - give the reason for the variance'; end if;
  end if;
  for bl in select * from purchase.bill_lines where bill_id = p_id loop
    if bl.grn_line_id is not null then update purchase.grn_lines set billed_qty = billed_qty + bl.qty where id = bl.grn_line_id;
    elsif bl.order_line_id is not null then update purchase.expense_order_lines set billed_qty = billed_qty + bl.qty where id = bl.order_line_id; end if;
  end loop;
  perform purchase._bill_recalc(p_id);
  v_no := coalesce(b.doc_no, purchase.next_doc_no(b.project_id, 'BILL', b.bill_date));
  update purchase.bills set status = 'booked', doc_no = v_no, booked_at = now(), accounts_status = 'ready', updated_at = now() where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('bill', p_id, me, 'Booked', 'Ready to post to Accounts' || case when v_over then ' (rate variance noted)' else '' end);
  return v_no;
end $fn$;

create or replace function purchase.bill_cancel(p_id bigint, p_reason text) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare b purchase.bills; me text; bl purchase.bill_lines;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason for cancelling'; end if;
  select * into b from purchase.bills where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Bill not found'; end if;
  me := purchase._po_guard(case when b.bill_type = 'goods' then 'bill.book' else 'nonstore.purchase' end);
  if b.status <> 'booked' then raise exception 'Only a booked bill can be cancelled'; end if;
  if b.accounts_status = 'posted' then raise exception 'Accounts has already posted this bill - ask Accounts to reverse it'; end if;
  if exists (select 1 from purchase.debit_notes where bill_id = p_id and status = 'issued') then raise exception 'Cancel the debit notes against this bill first'; end if;
  for bl in select * from purchase.bill_lines where bill_id = p_id loop
    if bl.grn_line_id is not null then update purchase.grn_lines set billed_qty = greatest(0, billed_qty - bl.qty) where id = bl.grn_line_id;
    elsif bl.order_line_id is not null then update purchase.expense_order_lines set billed_qty = greatest(0, billed_qty - bl.qty) where id = bl.order_line_id; end if;
  end loop;
  update purchase.bills set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason), updated_at = now() where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('bill', p_id, me, 'Cancelled', btrim(p_reason));
end $fn$;

-- ---------------------------------------------------------------------------
-- Debit notes
-- ---------------------------------------------------------------------------
create table if not exists purchase.debit_notes(
  id                  bigserial primary key,
  doc_no              text,
  kind                text not null check (kind in ('quantity','rate','amount')),
  bill_id             bigint not null references purchase.bills(id),
  vendor_id           bigint not null references purchase.vendors(id),
  project_id          bigint not null references cust.projects(id),
  dn_date             date not null default current_date,
  reason              text not null,
  rtv_id              bigint references purchase.rtvs(id),
  gst_rate            numeric(5,2) not null default 0,
  taxable_value       numeric(14,2) not null default 0,
  gst_amount          numeric(14,2) not null default 0,
  total_amount        numeric(14,2) not null default 0,
  status              text not null default 'issued' check (status in ('issued','cancelled')),
  accounts_status     text not null default 'ready' check (accounts_status in ('ready','posted','hold')),
  accounts_ref        text,
  accounts_posted_at  timestamptz,
  created_by          text default app.current_user_email(),
  created_at          timestamptz not null default now(),
  cancelled_at        timestamptz,
  cancel_reason       text
);
create unique index if not exists debit_notes_doc_no_uq on purchase.debit_notes (doc_no) where doc_no is not null;
create table if not exists purchase.debit_note_lines(
  id           bigserial primary key,
  dn_id        bigint not null references purchase.debit_notes(id) on delete cascade,
  bill_line_id bigint not null references purchase.bill_lines(id),
  qty          numeric(14,3) not null,
  new_rate     numeric(14,2),
  taxable      numeric(14,2) not null,
  gst_amount   numeric(14,2) not null
);

create or replace function purchase.debit_note_create(p_bill_id bigint, p_kind text, p_head jsonb, p_lines jsonb) returns text
 language plpgsql security definer set search_path = purchase, public as $fn$
declare
  b purchase.bills; me text; v_id bigint; v_no text; l jsonb; bl purchase.bill_lines; v_date date; v_tax numeric := 0; v_gst numeric := 0; v_q numeric; v_t numeric; v_g numeric; v_nr numeric; v_gr numeric := 0; v_total numeric;
begin
  select * into b from purchase.bills where id = p_bill_id and deleted_at is null for update;
  if not found then raise exception 'Bill not found'; end if;
  me := purchase._po_guard(case when b.bill_type = 'goods' then 'bill.book' else 'nonstore.purchase' end);
  if b.status <> 'booked' then raise exception 'A debit note can only be raised against a booked bill'; end if;
  if p_kind not in ('quantity','rate','amount') then raise exception 'Choose the kind of debit note'; end if;
  if btrim(coalesce(p_head->>'reason', '')) = '' then raise exception 'Give the reason for the debit note'; end if;
  v_date := coalesce((p_head->>'dn_date')::date, current_date);
  if v_date > current_date then raise exception 'The date cannot be in the future'; end if;
  v_no := purchase.next_doc_no(b.project_id, 'DN', v_date);
  insert into purchase.debit_notes(doc_no, kind, bill_id, vendor_id, project_id, dn_date, reason, rtv_id, created_by)
  values (v_no, p_kind, b.id, b.vendor_id, b.project_id, v_date, btrim(p_head->>'reason'), nullif(p_head->>'rtv_id', '')::bigint, me) returning id into v_id;

  if p_kind = 'amount' then
    v_tax := coalesce((p_head->>'amount')::numeric, 0); v_gr := coalesce((p_head->>'gst_rate')::numeric, 0);
    if v_tax <= 0 then raise exception 'Enter the amount of the debit note'; end if;
    if v_gr < 0 or v_gr > 100 then raise exception 'GST rate must be between 0 and 100'; end if;
    v_gst := round(v_tax * v_gr / 100, 2);
  else
    if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Choose at least one item'; end if;
    for l in select * from jsonb_array_elements(p_lines) loop
      select * into bl from purchase.bill_lines where id = (l->>'bill_line_id')::bigint and bill_id = b.id for update;
      if not found then raise exception 'An item does not belong to this bill'; end if;
      if p_kind = 'quantity' then
        v_q := (l->>'qty')::numeric;
        if coalesce(v_q, 0) <= 0 then raise exception 'Quantity must be more than 0'; end if;
        if v_q > bl.qty - bl.debit_noted_qty + 0.0005 then raise exception 'At most % of % can be debited', bl.qty - bl.debit_noted_qty, bl.description; end if;
        v_t := round(v_q * bl.rate, 2); v_g := round(v_t * bl.gst_rate / 100, 2); v_nr := null;
        update purchase.bill_lines set debit_noted_qty = debit_noted_qty + v_q where id = bl.id;
      else
        v_nr := (l->>'new_rate')::numeric;
        if bl.rate_dn then raise exception 'A rate debit note has already been raised for %', bl.description; end if;
        if coalesce(v_nr, 0) <= 0 or v_nr >= bl.rate then raise exception 'The agreed rate for % must be above 0 and below the invoice rate (%)', bl.description, bl.rate; end if;
        v_q := bl.qty - bl.debit_noted_qty;
        v_t := round(v_q * (bl.rate - v_nr), 2); v_g := round(v_t * bl.gst_rate / 100, 2);
        update purchase.bill_lines set rate_dn = true where id = bl.id;
      end if;
      insert into purchase.debit_note_lines(dn_id, bill_line_id, qty, new_rate, taxable, gst_amount) values (v_id, bl.id, v_q, v_nr, v_t, v_g);
      v_tax := v_tax + v_t; v_gst := v_gst + v_g;
    end loop;
  end if;
  v_total := v_tax + v_gst;
  if v_total <= 0 then raise exception 'The debit note has no value'; end if;
  if b.debit_noted + v_total > b.total_amount + 0.005 then raise exception 'The debit notes would be more than the bill (%)', b.total_amount; end if;
  update purchase.debit_notes set taxable_value = v_tax, gst_amount = v_gst, total_amount = v_total, gst_rate = v_gr where id = v_id;
  update purchase.bills set debit_noted = debit_noted + v_total, payable_amount = payable_amount - v_total, updated_at = now() where id = b.id;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('bill', b.id, me, 'Debit note raised', v_no || ' - ' || p_kind);
  return v_no;
end $fn$;

create or replace function purchase.debit_note_cancel(p_id bigint, p_reason text) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare d purchase.debit_notes; b purchase.bills; me text; dl purchase.debit_note_lines;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason for cancelling'; end if;
  select * into d from purchase.debit_notes where id = p_id for update;
  if not found then raise exception 'Debit note not found'; end if;
  select * into b from purchase.bills where id = d.bill_id for update;
  me := purchase._po_guard(case when b.bill_type = 'goods' then 'bill.book' else 'nonstore.purchase' end);
  if d.status <> 'issued' then raise exception 'This debit note is already cancelled'; end if;
  if d.accounts_status = 'posted' then raise exception 'Accounts has already posted this debit note - ask Accounts to reverse it'; end if;
  for dl in select * from purchase.debit_note_lines where dn_id = p_id loop
    if d.kind = 'quantity' then update purchase.bill_lines set debit_noted_qty = greatest(0, debit_noted_qty - dl.qty) where id = dl.bill_line_id;
    elsif d.kind = 'rate' then update purchase.bill_lines set rate_dn = false where id = dl.bill_line_id; end if;
  end loop;
  update purchase.debit_notes set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason) where id = p_id;
  update purchase.bills set debit_noted = greatest(0, debit_noted - d.total_amount), payable_amount = payable_amount + d.total_amount, updated_at = now() where id = d.bill_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('bill', d.bill_id, me, 'Debit note cancelled', d.doc_no || ': ' || btrim(p_reason));
end $fn$;

-- ---------------------------------------------------------------------------
-- Grants and read-only RLS
-- ---------------------------------------------------------------------------
do $g$
declare f text;
begin
  foreach f in array array['eo_save(bigint, jsonb, jsonb)','eo_delete(bigint)','eo_submit(bigint)','eo_decide(bigint, boolean, text)','eo_cancel(bigint, text)','eo_close(bigint, text)',
      'bill_save(bigint, jsonb, jsonb)','bill_delete(bigint)','bill_book(bigint)','bill_cancel(bigint, text)','debit_note_create(bigint, text, jsonb, jsonb)','debit_note_cancel(bigint, text)'] loop
    execute 'revoke all on function purchase.' || f || ' from public, anon';
    execute 'grant execute on function purchase.' || f || ' to authenticated';
  end loop;
end $g$;

do $rls$
declare t text;
begin
  foreach t in array array['expense_orders','expense_order_lines','expense_order_approvals','bills','bill_lines','debit_notes','debit_note_lines'] loop
    execute format('alter table purchase.%I enable row level security', t);
    execute format('drop policy if exists %I on purchase.%I', t || '_staff_read', t);
    execute format('create policy %I on purchase.%I for select to authenticated using ((select not app.is_customer()))', t || '_staff_read', t);
    execute format('grant select on purchase.%I to authenticated', t);
  end loop;
end $rls$;
alter table purchase.expense_heads enable row level security;
drop policy if exists expense_heads_staff_read on purchase.expense_heads;
drop policy if exists expense_heads_perm_write on purchase.expense_heads;
create policy expense_heads_staff_read on purchase.expense_heads for select to authenticated using ((select not app.is_customer()));
create policy expense_heads_perm_write on purchase.expense_heads for all to authenticated using ((select purchase.can('item.manage'))) with check ((select purchase.can('item.manage')));
grant select, insert, update, delete on purchase.expense_heads to authenticated;
grant usage, select on all sequences in schema purchase to authenticated;

update purchase.permissions set stage = null where key in ('bill.book','nonstore.purchase');
update purchase.permissions set label = 'Book goods bills and raise debit notes' where key = 'bill.book';
update purchase.permissions set label = 'Non-store purchases, service work orders and service bills (and their debit notes)' where key = 'nonstore.purchase';
