-- Purchase & Stores, Stage 6: stores. See docs/purchase-stores-spec.md section 6.
--
--   stock_ledger     every stock movement, append-only (signed quantity, rate, value, running balance)
--   stock_balances   current quantity, value and weighted-average rate per warehouse and item
--   GRN              goods received against an approved PO (partial deliveries; accepted / rejected per line)
--   return to vendor / issue / issue return
--   stock adjustments (physical count, damage, ...) - approved through a chain before they post
--   transfers between warehouses: same legal entity = a pure transfer (optionally via "in transit");
--                                 different entity     = linked stock adjustment decrease + increase, flagged for Accounts
--
-- STOCK IS HELD IN THE ITEM'S STOCK UOM (its issue UOM when it has one, else its receipt UOM). A GRN is
-- entered in the receipt UOM and converted with the item's fixed conversion. Valuation is the weighted
-- average of the BASIC rate (GST is not part of stock value). Stock can never go negative.
--
-- All writes go through the functions below; the tables are read-only from the browser. Document numbers:
-- <project code>/<GRN|RTV|ISS|IRT|ADJ|TRF>/<financial year>/<serial>.

-- A PO line may be over-received within the tolerance rule, so the table check goes; the functions enforce it.
alter table purchase.po_lines drop constraint if exists po_lines_check;

alter table purchase.approval_chains drop constraint if exists approval_chains_doc_type_check;
alter table purchase.approval_chains add constraint approval_chains_doc_type_check check (doc_type in ('indent','po','adjustment'));

-- ---------------------------------------------------------------------------
-- The stock engine
-- ---------------------------------------------------------------------------
create table if not exists purchase.stock_balances(
  warehouse_id  bigint not null references purchase.warehouses(id),
  item_id       bigint not null references purchase.items(id),
  qty           numeric(14,3) not null default 0 check (qty >= 0),
  value         numeric(14,2) not null default 0,
  avg_rate      numeric(14,4) not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (warehouse_id, item_id)
);

create table if not exists purchase.stock_ledger(
  id             bigserial primary key,
  warehouse_id   bigint not null references purchase.warehouses(id),
  item_id        bigint not null references purchase.items(id),
  moved_on       date not null default current_date,
  doc_type       text not null,
  doc_id         bigint not null,
  doc_no         text,
  doc_line_id    bigint,
  narration      text,
  qty            numeric(14,3) not null check (qty <> 0),
  rate           numeric(14,4) not null,
  value          numeric(14,2) not null,
  balance_qty    numeric(14,3) not null,
  balance_value  numeric(14,2) not null,
  created_by     text default app.current_user_email(),
  created_at     timestamptz not null default now()
);
create index if not exists stock_ledger_wi_idx on purchase.stock_ledger (warehouse_id, item_id, id);
create index if not exists stock_ledger_doc_idx on purchase.stock_ledger (doc_type, doc_id);

create or replace function purchase.stock_ledger_immutable() returns trigger
 language plpgsql as $fn$
begin raise exception 'The stock ledger cannot be changed - post a correcting entry instead'; end $fn$;
drop trigger if exists stock_ledger_immutable on purchase.stock_ledger;
create trigger stock_ledger_immutable before update or delete on purchase.stock_ledger for each row execute function purchase.stock_ledger_immutable();

create or replace function purchase._stock_factor(p_item bigint) returns numeric
 language sql stable set search_path = purchase, public as $fn$
  select case when issue_uom_id is not null then conversion else 1 end from purchase.items where id = p_item
$fn$;

-- Post one movement. p_qty is signed, in the item's stock UOM. p_rate (per stock UOM) is used for receipts
-- (null = current average); issues always go out at the current average. Returns the rate used.
create or replace function purchase._stock_post(p_wh bigint, p_item bigint, p_qty numeric, p_rate numeric, p_date date,
    p_doc_type text, p_doc_id bigint, p_doc_no text, p_line bigint, p_note text) returns numeric
 language plpgsql security definer set search_path = purchase, public as $fn$
declare b purchase.stock_balances; v_rate numeric; v_value numeric; v_nq numeric; v_nv numeric; v_avg numeric;
begin
  if coalesce(p_qty, 0) = 0 then raise exception 'A stock movement needs a quantity'; end if;
  insert into purchase.stock_balances(warehouse_id, item_id) values (p_wh, p_item) on conflict do nothing;
  select * into b from purchase.stock_balances where warehouse_id = p_wh and item_id = p_item for update;
  if p_qty > 0 then
    v_rate := coalesce(p_rate, b.avg_rate);
    if v_rate is null or v_rate < 0 then raise exception 'A rate is needed to bring this item into stock'; end if;
    v_value := round(p_qty * v_rate, 2);
  else
    if b.qty + p_qty < 0 then
      raise exception 'Not enough stock of % in %: % available, % needed', (select name from purchase.items where id = p_item), (select name from purchase.warehouses where id = p_wh), b.qty, -p_qty;
    end if;
    v_rate := b.avg_rate;
    v_value := case when b.qty + p_qty = 0 then -b.value else -round((-p_qty) * v_rate, 2) end;
  end if;
  v_nq := b.qty + p_qty; v_nv := b.value + v_value;
  v_avg := case when v_nq > 0 then round(v_nv / v_nq, 4) else b.avg_rate end;
  insert into purchase.stock_ledger(warehouse_id, item_id, moved_on, doc_type, doc_id, doc_no, doc_line_id, narration, qty, rate, value, balance_qty, balance_value)
  values (p_wh, p_item, p_date, p_doc_type, p_doc_id, p_doc_no, p_line, p_note, p_qty, v_rate, v_value, v_nq, v_nv);
  update purchase.stock_balances set qty = v_nq, value = v_nv, avg_rate = v_avg, updated_at = now() where warehouse_id = p_wh and item_id = p_item;
  return v_rate;
end $fn$;
revoke all on function purchase._stock_post(bigint, bigint, numeric, numeric, date, text, bigint, text, bigint, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- GRN
-- ---------------------------------------------------------------------------
create table if not exists purchase.grns(
  id            bigserial primary key,
  doc_no        text,
  project_id    bigint not null references cust.projects(id),
  warehouse_id  bigint not null references purchase.warehouses(id),
  po_id         bigint not null references purchase.pos(id),
  vendor_id     bigint not null references purchase.vendors(id),
  grn_date      date not null default current_date,
  challan_no    text,
  challan_date  date,
  invoice_no    text,
  invoice_date  date,
  vehicle_no    text,
  received_by   text,
  remarks       text,
  status        text not null default 'draft' check (status in ('draft','posted')),
  raised_by     text not null default app.current_user_email(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  posted_at     timestamptz,
  deleted_at    timestamptz,
  deleted_by    text
);
create unique index if not exists grns_doc_no_uq on purchase.grns (doc_no) where doc_no is not null;
create index if not exists grns_po_idx on purchase.grns (po_id);

create table if not exists purchase.grn_lines(
  id                bigserial primary key,
  grn_id            bigint not null references purchase.grns(id) on delete cascade,
  line_no           int not null,
  po_line_id        bigint not null references purchase.po_lines(id),
  item_id           bigint not null references purchase.items(id),
  uom_id            bigint not null references purchase.uoms(id),
  received_qty      numeric(14,3) not null check (received_qty > 0),
  accepted_qty      numeric(14,3) not null check (accepted_qty >= 0),
  rejected_qty      numeric(14,3) not null check (rejected_qty >= 0),
  rejection_reason  text,
  rate              numeric(14,2) not null,
  gst_rate          numeric(5,2) not null default 0,
  stock_qty         numeric(14,3),
  returned_qty      numeric(14,3) not null default 0 check (returned_qty >= 0),
  remark            text,
  check (accepted_qty + rejected_qty = received_qty),
  check (returned_qty <= accepted_qty),
  unique (grn_id, po_line_id)
);

create or replace function purchase.grn_save(p_id bigint, p_po_id bigint, p_head jsonb, p_lines jsonb) returns bigint
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('grn.post'); g purchase.grns; po purchase.pos; v_id bigint; l jsonb; pl purchase.po_lines; v_rec numeric; v_acc numeric; v_wh bigint; v_date date; v_n int := 0;
begin
  if p_id is null then
    select * into po from purchase.pos where id = p_po_id and deleted_at is null;
    if not found then raise exception 'Purchase order not found'; end if;
    if po.status <> 'approved' then raise exception 'Goods can only be received against an approved purchase order'; end if;
  else
    select * into g from purchase.grns where id = p_id and deleted_at is null for update;
    if not found then raise exception 'Goods receipt not found'; end if;
    if g.status <> 'draft' then raise exception 'A posted goods receipt cannot be changed - use a return to the vendor to correct it'; end if;
    if lower(g.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who entered the goods receipt can change it'; end if;
    select * into po from purchase.pos where id = g.po_id;
  end if;
  v_wh := (p_head->>'warehouse_id')::bigint;
  if not exists (select 1 from purchase.warehouses where id = v_wh and project_id = po.project_id and active and deleted_at is null) then raise exception 'Choose a warehouse of the order''s project'; end if;
  v_date := coalesce((p_head->>'grn_date')::date, current_date);
  if v_date > current_date then raise exception 'The receipt date cannot be in the future'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Enter the quantity received for at least one item'; end if;

  if p_id is null then
    insert into purchase.grns(project_id, warehouse_id, po_id, vendor_id, grn_date, challan_no, challan_date, invoice_no, invoice_date, vehicle_no, received_by, remarks, raised_by)
    values (po.project_id, v_wh, po.id, po.vendor_id, v_date, nullif(btrim(coalesce(p_head->>'challan_no', '')), ''), nullif(p_head->>'challan_date', '')::date,
            nullif(btrim(coalesce(p_head->>'invoice_no', '')), ''), nullif(p_head->>'invoice_date', '')::date, nullif(btrim(coalesce(p_head->>'vehicle_no', '')), ''),
            nullif(btrim(coalesce(p_head->>'received_by', '')), ''), nullif(btrim(coalesce(p_head->>'remarks', '')), ''), me)
    returning id into v_id;
  else
    v_id := p_id;
    update purchase.grns set warehouse_id = v_wh, grn_date = v_date, challan_no = nullif(btrim(coalesce(p_head->>'challan_no', '')), ''), challan_date = nullif(p_head->>'challan_date', '')::date,
           invoice_no = nullif(btrim(coalesce(p_head->>'invoice_no', '')), ''), invoice_date = nullif(p_head->>'invoice_date', '')::date, vehicle_no = nullif(btrim(coalesce(p_head->>'vehicle_no', '')), ''),
           received_by = nullif(btrim(coalesce(p_head->>'received_by', '')), ''), remarks = nullif(btrim(coalesce(p_head->>'remarks', '')), ''), updated_at = now() where id = v_id;
    delete from purchase.grn_lines where grn_id = v_id;
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    select * into pl from purchase.po_lines where id = (l->>'po_line_id')::bigint and po_id = po.id;
    if not found then raise exception 'An item does not belong to this purchase order'; end if;
    v_rec := (l->>'received_qty')::numeric; v_acc := coalesce((l->>'accepted_qty')::numeric, v_rec);
    if coalesce(v_rec, 0) <= 0 then raise exception 'Received quantity must be more than 0'; end if;
    if v_acc < 0 or v_acc > v_rec then raise exception 'Accepted quantity cannot be more than the quantity received'; end if;
    if v_rec - v_acc > 0 and btrim(coalesce(l->>'rejection_reason', '')) = '' then raise exception 'Give a reason for the rejected quantity of %', (select name from purchase.items where id = pl.item_id); end if;
    v_n := v_n + 1;
    insert into purchase.grn_lines(grn_id, line_no, po_line_id, item_id, uom_id, received_qty, accepted_qty, rejected_qty, rejection_reason, rate, gst_rate, remark)
    values (v_id, v_n, pl.id, pl.item_id, pl.uom_id, v_rec, v_acc, v_rec - v_acc, nullif(btrim(coalesce(l->>'rejection_reason', '')), ''), pl.rate, pl.gst_rate, nullif(btrim(coalesce(l->>'remark', '')), ''));
  end loop;
  insert into purchase.doc_log(doc_type, doc_id, by, action) values ('grn', v_id, me, case when p_id is null then 'Inserted' else 'Modified' end);
  return v_id;
end $fn$;

create or replace function purchase.grn_delete(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('grn.post'); g purchase.grns;
begin
  select * into g from purchase.grns where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Goods receipt not found'; end if;
  if g.status <> 'draft' then raise exception 'Only a draft goods receipt can be deleted'; end if;
  if lower(g.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who entered the goods receipt can delete it'; end if;
  update purchase.grns set deleted_at = now(), deleted_by = me where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action) values ('grn', p_id, me, 'Deleted');
end $fn$;

create or replace function purchase.grn_post(p_id bigint) returns text
 language plpgsql security definer set search_path = purchase, public as $fn$
declare
  me text := purchase._po_guard('grn.post'); g purchase.grns; po purchase.pos; gl purchase.grn_lines; pl purchase.po_lines; it purchase.items;
  v_no text; v_tol numeric := coalesce(nullif(purchase.setting('grn.over_receipt_pct', '0'), '')::numeric, 0); v_allowed numeric; v_f numeric; v_sq numeric;
begin
  select * into g from purchase.grns where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Goods receipt not found'; end if;
  if g.status <> 'draft' then raise exception 'This goods receipt is already posted'; end if;
  if lower(g.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who entered the goods receipt can post it'; end if;
  select * into po from purchase.pos where id = g.po_id for update;
  if po.status <> 'approved' then raise exception 'The purchase order is % - goods can only be received against an approved one', replace(po.status, '_', ' '); end if;
  v_no := coalesce(g.doc_no, purchase.next_doc_no(g.project_id, 'GRN', g.grn_date));
  for gl in select * from purchase.grn_lines where grn_id = p_id order by line_no loop
    select * into pl from purchase.po_lines where id = gl.po_line_id for update;
    select * into it from purchase.items where id = gl.item_id;
    v_allowed := greatest(pl.qty - pl.received_qty - pl.short_closed_qty, 0) + pl.qty * v_tol / 100;
    if gl.accepted_qty > v_allowed + 0.0005 then
      raise exception 'Cannot accept % of %: the order balance is % (over-receipt tolerance % percent)', gl.accepted_qty, it.name, greatest(pl.qty - pl.received_qty - pl.short_closed_qty, 0), v_tol;
    end if;
    v_f := purchase._stock_factor(gl.item_id);
    v_sq := round(gl.accepted_qty * v_f, 3);
    if gl.accepted_qty > 0 then
      perform purchase._stock_post(g.warehouse_id, gl.item_id, v_sq, round(gl.rate / v_f, 4), g.grn_date, 'GRN', p_id, v_no, gl.id, 'Received against ' || coalesce(po.doc_no, 'PO'));
      update purchase.po_lines set received_qty = received_qty + gl.accepted_qty where id = pl.id;
    end if;
    update purchase.grn_lines set stock_qty = v_sq where id = gl.id;
  end loop;
  update purchase.grns set status = 'posted', doc_no = v_no, posted_at = now(), updated_at = now() where id = p_id;
  perform purchase.po_refresh(po.id);
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('grn', p_id, me, 'Posted', 'Stock updated');
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('po', po.id, me, 'Goods received', v_no);
  return v_no;
end $fn$;

-- ---------------------------------------------------------------------------
-- Return to vendor (quality or other reasons) - posts at once
-- ---------------------------------------------------------------------------
create table if not exists purchase.rtvs(
  id            bigserial primary key,
  doc_no        text,
  project_id    bigint not null references cust.projects(id),
  warehouse_id  bigint not null references purchase.warehouses(id),
  grn_id        bigint not null references purchase.grns(id),
  vendor_id     bigint not null references purchase.vendors(id),
  rtv_date      date not null default current_date,
  reason        text not null,
  remarks       text,
  created_by    text default app.current_user_email(),
  created_at    timestamptz not null default now()
);
create unique index if not exists rtvs_doc_no_uq on purchase.rtvs (doc_no) where doc_no is not null;
create table if not exists purchase.rtv_lines(
  id           bigserial primary key,
  rtv_id       bigint not null references purchase.rtvs(id) on delete cascade,
  grn_line_id  bigint not null references purchase.grn_lines(id),
  item_id      bigint not null references purchase.items(id),
  qty          numeric(14,3) not null check (qty > 0),
  stock_qty    numeric(14,3) not null,
  value        numeric(14,2)
);

create or replace function purchase.rtv_create(p_grn_id bigint, p_head jsonb, p_lines jsonb) returns text
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('grn.post'); g purchase.grns; v_id bigint; v_no text; l jsonb; gl purchase.grn_lines; v_q numeric; v_sq numeric; v_f numeric; v_date date; v_rate numeric; pl purchase.po_lines;
begin
  select * into g from purchase.grns where id = p_grn_id and deleted_at is null for update;
  if not found then raise exception 'Goods receipt not found'; end if;
  if g.status <> 'posted' then raise exception 'Only a posted goods receipt can have goods returned'; end if;
  if btrim(coalesce(p_head->>'reason', '')) = '' then raise exception 'Give the reason for the return'; end if;
  v_date := coalesce((p_head->>'rtv_date')::date, current_date);
  if v_date > current_date then raise exception 'The date cannot be in the future'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Enter the quantity to return for at least one item'; end if;
  v_no := purchase.next_doc_no(g.project_id, 'RTV', v_date);
  insert into purchase.rtvs(doc_no, project_id, warehouse_id, grn_id, vendor_id, rtv_date, reason, remarks, created_by)
  values (v_no, g.project_id, g.warehouse_id, g.id, g.vendor_id, v_date, btrim(p_head->>'reason'), nullif(btrim(coalesce(p_head->>'remarks', '')), ''), me) returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    select * into gl from purchase.grn_lines where id = (l->>'grn_line_id')::bigint and grn_id = g.id for update;
    if not found then raise exception 'An item does not belong to this goods receipt'; end if;
    v_q := (l->>'qty')::numeric;
    if coalesce(v_q, 0) <= 0 then raise exception 'Return quantity must be more than 0'; end if;
    if v_q > gl.accepted_qty - gl.returned_qty then raise exception 'At most % of % can still be returned', gl.accepted_qty - gl.returned_qty, (select name from purchase.items where id = gl.item_id); end if;
    v_f := purchase._stock_factor(gl.item_id); v_sq := round(v_q * v_f, 3);
    v_rate := purchase._stock_post(g.warehouse_id, gl.item_id, -v_sq, null, v_date, 'RTV', v_id, v_no, gl.id, 'Returned to vendor: ' || btrim(p_head->>'reason'));
    insert into purchase.rtv_lines(rtv_id, grn_line_id, item_id, qty, stock_qty, value) values (v_id, gl.id, gl.item_id, v_q, v_sq, round(v_sq * v_rate, 2));
    update purchase.grn_lines set returned_qty = returned_qty + v_q where id = gl.id;
    -- what came back is owed again: reopen the order balance
    update purchase.po_lines set received_qty = greatest(0, received_qty - v_q) where id = gl.po_line_id;
  end loop;
  update purchase.pos p set status = 'approved', closed_at = null, closed_kind = null, updated_at = now()
   where p.id = g.po_id and p.status = 'closed' and exists (select 1 from purchase.po_lines x where x.po_id = p.id and x.qty - x.received_qty - x.short_closed_qty > 0);
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('grn', p_grn_id, me, 'Goods returned to vendor', v_no);
  return v_no;
end $fn$;

-- ---------------------------------------------------------------------------
-- Issue and issue return
-- ---------------------------------------------------------------------------
create table if not exists purchase.issues(
  id              bigserial primary key,
  doc_no          text,
  project_id      bigint not null references cust.projects(id),
  warehouse_id    bigint not null references purchase.warehouses(id),
  issue_date      date not null default current_date,
  cost_project_id bigint references cust.projects(id),
  block           text,
  activity        text,
  requested_by    text,
  remarks         text,
  created_by      text default app.current_user_email(),
  created_at      timestamptz not null default now()
);
create unique index if not exists issues_doc_no_uq on purchase.issues (doc_no) where doc_no is not null;
create table if not exists purchase.issue_lines(
  id            bigserial primary key,
  issue_id      bigint not null references purchase.issues(id) on delete cascade,
  line_no       int not null,
  item_id       bigint not null references purchase.items(id),
  qty           numeric(14,3) not null check (qty > 0),
  rate          numeric(14,4) not null,
  value         numeric(14,2) not null,
  returned_qty  numeric(14,3) not null default 0 check (returned_qty >= 0),
  remark        text,
  check (returned_qty <= qty),
  unique (issue_id, item_id)
);

create or replace function purchase.issue_create(p_head jsonb, p_lines jsonb) returns text
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('stock.issue'); w purchase.warehouses; v_id bigint; v_no text; l jsonb; v_q numeric; v_rate numeric; v_date date; v_n int := 0; v_item bigint;
begin
  select * into w from purchase.warehouses where id = (p_head->>'warehouse_id')::bigint and active and deleted_at is null;
  if not found then raise exception 'Choose the warehouse to issue from'; end if;
  v_date := coalesce((p_head->>'issue_date')::date, current_date);
  if v_date > current_date then raise exception 'The date cannot be in the future'; end if;
  if btrim(coalesce(p_head->>'requested_by', '')) = '' and btrim(coalesce(p_head->>'activity', '')) = '' and btrim(coalesce(p_head->>'block', '')) = ''
     and (p_head->>'cost_project_id') is null then raise exception 'Say what the material is issued for (project, block, activity or who asked for it)'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Enter the quantity to issue for at least one item'; end if;
  v_no := purchase.next_doc_no(w.project_id, 'ISS', v_date);
  insert into purchase.issues(doc_no, project_id, warehouse_id, issue_date, cost_project_id, block, activity, requested_by, remarks, created_by)
  values (v_no, w.project_id, w.id, v_date, nullif(p_head->>'cost_project_id', '')::bigint, nullif(btrim(coalesce(p_head->>'block', '')), ''), nullif(btrim(coalesce(p_head->>'activity', '')), ''),
          nullif(btrim(coalesce(p_head->>'requested_by', '')), ''), nullif(btrim(coalesce(p_head->>'remarks', '')), ''), me) returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_item := (l->>'item_id')::bigint; v_q := (l->>'qty')::numeric;
    if coalesce(v_q, 0) <= 0 then raise exception 'Issue quantity must be more than 0'; end if;
    v_n := v_n + 1;
    v_rate := purchase._stock_post(w.id, v_item, -v_q, null, v_date, 'ISS', v_id, v_no, null, 'Issued');
    insert into purchase.issue_lines(issue_id, line_no, item_id, qty, rate, value, remark)
    values (v_id, v_n, v_item, v_q, v_rate, round(v_q * v_rate, 2), nullif(btrim(coalesce(l->>'remark', '')), ''));
  end loop;
  insert into purchase.doc_log(doc_type, doc_id, by, action) values ('issue', v_id, me, 'Issued');
  return v_no;
end $fn$;

create table if not exists purchase.issue_returns(
  id            bigserial primary key,
  doc_no        text,
  project_id    bigint not null references cust.projects(id),
  warehouse_id  bigint not null references purchase.warehouses(id),
  issue_id      bigint not null references purchase.issues(id),
  return_date   date not null default current_date,
  reason        text,
  returned_by   text,
  created_by    text default app.current_user_email(),
  created_at    timestamptz not null default now()
);
create unique index if not exists issue_returns_doc_no_uq on purchase.issue_returns (doc_no) where doc_no is not null;
create table if not exists purchase.issue_return_lines(
  id             bigserial primary key,
  return_id      bigint not null references purchase.issue_returns(id) on delete cascade,
  issue_line_id  bigint not null references purchase.issue_lines(id),
  item_id        bigint not null references purchase.items(id),
  qty            numeric(14,3) not null check (qty > 0),
  rate           numeric(14,4) not null,
  value          numeric(14,2) not null
);

create or replace function purchase.issue_return_create(p_issue_id bigint, p_head jsonb, p_lines jsonb) returns text
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('stock.issue'); i purchase.issues; v_id bigint; v_no text; l jsonb; il purchase.issue_lines; v_q numeric; v_date date;
begin
  select * into i from purchase.issues where id = p_issue_id for update;
  if not found then raise exception 'Issue not found'; end if;
  v_date := coalesce((p_head->>'return_date')::date, current_date);
  if v_date > current_date then raise exception 'The date cannot be in the future'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Enter the quantity returned for at least one item'; end if;
  v_no := purchase.next_doc_no(i.project_id, 'IRT', v_date);
  insert into purchase.issue_returns(doc_no, project_id, warehouse_id, issue_id, return_date, reason, returned_by, created_by)
  values (v_no, i.project_id, i.warehouse_id, i.id, v_date, nullif(btrim(coalesce(p_head->>'reason', '')), ''), nullif(btrim(coalesce(p_head->>'returned_by', '')), ''), me) returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    select * into il from purchase.issue_lines where id = (l->>'issue_line_id')::bigint and issue_id = i.id for update;
    if not found then raise exception 'An item does not belong to this issue'; end if;
    v_q := (l->>'qty')::numeric;
    if coalesce(v_q, 0) <= 0 then raise exception 'Return quantity must be more than 0'; end if;
    if v_q > il.qty - il.returned_qty then raise exception 'At most % of % can still be returned', il.qty - il.returned_qty, (select name from purchase.items where id = il.item_id); end if;
    perform purchase._stock_post(i.warehouse_id, il.item_id, v_q, il.rate, v_date, 'IRT', v_id, v_no, il.id, 'Returned to store from ' || coalesce(i.doc_no, 'issue'));
    insert into purchase.issue_return_lines(return_id, issue_line_id, item_id, qty, rate, value) values (v_id, il.id, il.item_id, v_q, il.rate, round(v_q * il.rate, 2));
    update purchase.issue_lines set returned_qty = returned_qty + v_q where id = il.id;
  end loop;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('issue', p_issue_id, me, 'Material returned to store', v_no);
  return v_no;
end $fn$;

-- ---------------------------------------------------------------------------
-- Stock adjustments (approved before they post)
-- ---------------------------------------------------------------------------
create table if not exists purchase.stock_adjustments(
  id             bigserial primary key,
  doc_no         text,
  project_id     bigint not null references cust.projects(id),
  warehouse_id   bigint not null references purchase.warehouses(id),
  adj_date       date not null default current_date,
  kind           text not null default 'physical_count' check (kind in ('physical_count','damage','other','transfer')),
  reason         text not null,
  status         text not null default 'draft' check (status in ('draft','pending_approval','approved','rejected','cancelled')),
  current_level  int not null default 0,
  round          int not null default 0,
  total_value    numeric(14,2) not null default 0,
  source         text not null default 'manual' check (source in ('manual','transfer')),
  accounts_flag  boolean not null default false,
  raised_by      text not null default app.current_user_email(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  approved_at    timestamptz,
  deleted_at     timestamptz,
  deleted_by     text
);
create unique index if not exists stock_adjustments_doc_no_uq on purchase.stock_adjustments (doc_no) where doc_no is not null;
create table if not exists purchase.adjustment_lines(
  id             bigserial primary key,
  adjustment_id  bigint not null references purchase.stock_adjustments(id) on delete cascade,
  line_no        int not null,
  item_id        bigint not null references purchase.items(id),
  direction      text not null check (direction in ('increase','decrease')),
  qty            numeric(14,3) not null check (qty > 0),
  rate           numeric(14,4),
  value          numeric(14,2),
  note           text,
  unique (adjustment_id, item_id)
);
create table if not exists purchase.adjustment_approvals(
  id             bigserial primary key,
  adjustment_id  bigint not null references purchase.stock_adjustments(id) on delete cascade,
  round          int not null,
  level          int not null,
  approvers      text[] not null,
  status         text not null check (status in ('waiting','pending','approved','rejected')),
  acted_by       text,
  acted_at       timestamptz,
  remark         text
);
create index if not exists adjustment_approvals_idx on purchase.adjustment_approvals (adjustment_id, round, level);

create or replace function purchase.adjustment_save(p_id bigint, p_head jsonb, p_lines jsonb) returns bigint
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('stock.adjust'); a purchase.stock_adjustments; w purchase.warehouses; v_id bigint; l jsonb; v_n int := 0; v_date date; v_kind text;
begin
  select * into w from purchase.warehouses where id = (p_head->>'warehouse_id')::bigint and active and deleted_at is null;
  if not found then raise exception 'Choose the warehouse'; end if;
  v_kind := coalesce(nullif(p_head->>'kind', ''), 'physical_count');
  if v_kind not in ('physical_count','damage','other') then raise exception 'Choose what the adjustment is for'; end if;
  if btrim(coalesce(p_head->>'reason', '')) = '' then raise exception 'Give the reason for the adjustment'; end if;
  v_date := coalesce((p_head->>'adj_date')::date, current_date);
  if v_date > current_date then raise exception 'The date cannot be in the future'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one item'; end if;
  if p_id is null then
    insert into purchase.stock_adjustments(project_id, warehouse_id, adj_date, kind, reason, raised_by) values (w.project_id, w.id, v_date, v_kind, btrim(p_head->>'reason'), me) returning id into v_id;
  else
    select * into a from purchase.stock_adjustments where id = p_id and deleted_at is null for update;
    if not found then raise exception 'Adjustment not found'; end if;
    if a.status not in ('draft','rejected') then raise exception 'This adjustment is % and cannot be edited', replace(a.status, '_', ' '); end if;
    if lower(a.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who raised the adjustment can change it'; end if;
    if a.warehouse_id <> w.id then raise exception 'The warehouse of an adjustment cannot be changed'; end if;
    v_id := p_id;
    update purchase.stock_adjustments set adj_date = v_date, kind = v_kind, reason = btrim(p_head->>'reason'), updated_at = now() where id = v_id;
    delete from purchase.adjustment_lines where adjustment_id = v_id;
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce((l->>'qty')::numeric, 0) <= 0 then raise exception 'Quantity must be more than 0'; end if;
    if l->>'direction' not in ('increase','decrease') then raise exception 'Choose increase or decrease for every item'; end if;
    v_n := v_n + 1;
    insert into purchase.adjustment_lines(adjustment_id, line_no, item_id, direction, qty, rate, note)
    values (v_id, v_n, (l->>'item_id')::bigint, l->>'direction', (l->>'qty')::numeric, nullif(l->>'rate', '')::numeric, nullif(btrim(coalesce(l->>'note', '')), ''));
  end loop;
  insert into purchase.doc_log(doc_type, doc_id, by, action) values ('adjustment', v_id, me, case when p_id is null then 'Inserted' else 'Modified' end);
  return v_id;
end $fn$;

create or replace function purchase.adjustment_delete(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('stock.adjust'); a purchase.stock_adjustments;
begin
  select * into a from purchase.stock_adjustments where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Adjustment not found'; end if;
  if a.status <> 'draft' then raise exception 'Only a draft adjustment can be deleted'; end if;
  if lower(a.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who raised the adjustment can delete it'; end if;
  update purchase.stock_adjustments set deleted_at = now(), deleted_by = me where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action) values ('adjustment', p_id, me, 'Deleted');
end $fn$;

-- Value an adjustment (increases at the rate given, or the current average; decreases at the current average).
create or replace function purchase._adjustment_value(p_id bigint) returns numeric
 language plpgsql security definer set search_path = purchase, public as $fn$
declare a purchase.stock_adjustments; l purchase.adjustment_lines; b purchase.stock_balances; v_total numeric := 0; v_rate numeric;
begin
  select * into a from purchase.stock_adjustments where id = p_id;
  for l in select * from purchase.adjustment_lines where adjustment_id = p_id loop
    select * into b from purchase.stock_balances where warehouse_id = a.warehouse_id and item_id = l.item_id;
    if l.direction = 'increase' then
      v_rate := coalesce(l.rate, nullif(b.avg_rate, 0));
      if v_rate is null or v_rate <= 0 then raise exception 'Enter a rate for % - there is no stock value to take it from', (select name from purchase.items where id = l.item_id); end if;
    else
      if coalesce(b.qty, 0) < l.qty then raise exception 'Not enough stock of % to decrease by % (only % in stock)', (select name from purchase.items where id = l.item_id), l.qty, coalesce(b.qty, 0); end if;
      v_rate := b.avg_rate;
    end if;
    update purchase.adjustment_lines set rate = v_rate, value = round(l.qty * v_rate, 2) where id = l.id;
    v_total := v_total + round(l.qty * v_rate, 2);
  end loop;
  update purchase.stock_adjustments set total_value = v_total where id = p_id;
  return v_total;
end $fn$;
revoke all on function purchase._adjustment_value(bigint) from public, anon, authenticated;

create or replace function purchase._adjustment_post(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare a purchase.stock_adjustments; l purchase.adjustment_lines; v_f numeric;
begin
  select * into a from purchase.stock_adjustments where id = p_id;
  for l in select * from purchase.adjustment_lines where adjustment_id = p_id order by line_no loop
    if l.direction = 'increase' then
      perform purchase._stock_post(a.warehouse_id, l.item_id, l.qty, l.rate, a.adj_date, 'ADJ', p_id, a.doc_no, l.id, a.reason);
    else
      perform purchase._stock_post(a.warehouse_id, l.item_id, -l.qty, null, a.adj_date, 'ADJ', p_id, a.doc_no, l.id, a.reason);
    end if;
  end loop;
end $fn$;
revoke all on function purchase._adjustment_post(bigint) from public, anon, authenticated;

create or replace function purchase.adjustment_submit(p_id bigint) returns text
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('stock.adjust'); a purchase.stock_adjustments; v_first int; v_no text; v_val numeric;
begin
  select * into a from purchase.stock_adjustments where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Adjustment not found'; end if;
  if lower(a.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who raised the adjustment can submit it'; end if;
  if a.status not in ('draft','rejected') then raise exception 'This adjustment is already %', replace(a.status, '_', ' '); end if;
  if not exists (select 1 from purchase.adjustment_lines where adjustment_id = p_id) then raise exception 'Add at least one item'; end if;
  v_val := purchase._adjustment_value(p_id);
  select min(level) into v_first from purchase.approval_chains where project_id = a.project_id and doc_type = 'adjustment' and min_value <= v_val;
  if v_first is null then raise exception 'No approver is set for stock adjustments of this value - add one in Admin > Approvers'; end if;
  v_no := coalesce(a.doc_no, purchase.next_doc_no(a.project_id, 'ADJ', a.adj_date));
  insert into purchase.adjustment_approvals(adjustment_id, round, level, approvers, status)
    select p_id, a.round + 1, c.level, c.approvers, case when c.level = v_first then 'pending' else 'waiting' end
      from purchase.approval_chains c where c.project_id = a.project_id and c.doc_type = 'adjustment' and c.min_value <= v_val;
  update purchase.stock_adjustments set status = 'pending_approval', current_level = v_first, round = a.round + 1, doc_no = v_no, submitted_at = now(), updated_at = now() where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('adjustment', p_id, me, case when a.round = 0 then 'submitted' else 'resubmitted' end, 'Value ' || v_val);
  return v_no;
end $fn$;

create or replace function purchase.adjustment_decide(p_id bigint, p_approve boolean, p_remark text default null) returns text
 language plpgsql security definer set search_path = purchase, public as $fn$
declare a purchase.stock_adjustments; ap purchase.adjustment_approvals; me text := lower(coalesce(app.current_user_email(), '')); v_next int; v_out text;
begin
  if me = '' then raise exception 'not signed in'; end if;
  if app.is_customer() then raise exception 'not allowed'; end if;
  select * into a from purchase.stock_adjustments where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Adjustment not found'; end if;
  if a.status <> 'pending_approval' then raise exception 'This adjustment is not waiting for approval'; end if;
  select * into ap from purchase.adjustment_approvals where adjustment_id = p_id and round = a.round and level = a.current_level and status = 'pending' for update;
  if not found then raise exception 'No approval step is open on this adjustment'; end if;
  if not exists (select 1 from unnest(ap.approvers) x where lower(x) = me) then raise exception 'You are not an approver at this level'; end if;
  if lower(a.raised_by) = me and purchase.setting('adjustment.allow_self_approval', 'false') <> 'true' then raise exception 'You cannot decide an adjustment you raised yourself'; end if;
  if not p_approve and btrim(coalesce(p_remark, '')) = '' then raise exception 'Give a reason for rejecting'; end if;
  update purchase.adjustment_approvals set status = case when p_approve then 'approved' else 'rejected' end, acted_by = me, acted_at = now(), remark = nullif(btrim(coalesce(p_remark, '')), '') where id = ap.id;
  if p_approve then
    select min(level) into v_next from purchase.adjustment_approvals where adjustment_id = p_id and round = a.round and status = 'waiting';
    if v_next is null then
      perform purchase._adjustment_value(p_id);                      -- re-value at today's average, then post
      perform purchase._adjustment_post(p_id);
      update purchase.stock_adjustments set status = 'approved', current_level = 0, approved_at = now(), updated_at = now() where id = p_id;
      insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('adjustment', p_id, me, 'approved', 'Stock updated');
      v_out := 'approved';
    else
      update purchase.adjustment_approvals set status = 'pending' where adjustment_id = p_id and round = a.round and level = v_next;
      update purchase.stock_adjustments set current_level = v_next, updated_at = now() where id = p_id;
      insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('adjustment', p_id, me, 'approved level ' || ap.level, nullif(btrim(coalesce(p_remark, '')), ''));
      v_out := 'pending_approval';
    end if;
  else
    update purchase.stock_adjustments set status = 'rejected', current_level = 0, updated_at = now() where id = p_id;
    insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('adjustment', p_id, me, 'rejected', btrim(p_remark));
    v_out := 'rejected';
  end if;
  return v_out;
end $fn$;

-- ---------------------------------------------------------------------------
-- Transfers between warehouses
-- ---------------------------------------------------------------------------
create table if not exists purchase.transfers(
  id              bigserial primary key,
  doc_no          text,
  from_wh         bigint not null references purchase.warehouses(id),
  to_wh           bigint not null references purchase.warehouses(id),
  from_project_id bigint not null references cust.projects(id),
  to_project_id   bigint not null references cust.projects(id),
  transfer_date   date not null default current_date,
  kind            text not null check (kind in ('same_entity','cross_entity')),
  status          text not null check (status in ('in_transit','received','completed')),
  vehicle_no      text,
  remarks         text,
  adj_out_id      bigint references purchase.stock_adjustments(id),
  adj_in_id       bigint references purchase.stock_adjustments(id),
  dispatched_by   text default app.current_user_email(),
  dispatched_at   timestamptz not null default now(),
  received_by     text,
  received_at     timestamptz,
  check (from_wh <> to_wh)
);
create unique index if not exists transfers_doc_no_uq on purchase.transfers (doc_no) where doc_no is not null;
create table if not exists purchase.transfer_lines(
  id            bigserial primary key,
  transfer_id   bigint not null references purchase.transfers(id) on delete cascade,
  line_no       int not null,
  item_id       bigint not null references purchase.items(id),
  qty           numeric(14,3) not null check (qty > 0),
  rate          numeric(14,4) not null,
  value         numeric(14,2) not null,
  received_qty  numeric(14,3) not null default 0 check (received_qty >= 0),
  returned_qty  numeric(14,3) not null default 0 check (returned_qty >= 0),
  remark        text,
  unique (transfer_id, item_id)
);

create or replace function purchase.transfer_dispatch(p_head jsonb, p_lines jsonb) returns text
 language plpgsql security definer set search_path = purchase, public as $fn$
declare
  me text := purchase._po_guard('stock.transfer'); wf purchase.warehouses; wt purchase.warehouses; ef bigint; et bigint; v_kind text; v_in_transit boolean; v_id bigint; v_no text; l jsonb; v_q numeric; v_rate numeric; v_date date;
  v_n int := 0; v_status text; v_adj_out bigint; v_adj_in bigint; v_line bigint; v_item bigint; v_val numeric; v_out_no text; v_in_no text;
begin
  select * into wf from purchase.warehouses where id = (p_head->>'from_wh')::bigint and active and deleted_at is null;
  if not found then raise exception 'Choose the warehouse the material leaves from'; end if;
  select * into wt from purchase.warehouses where id = (p_head->>'to_wh')::bigint and active and deleted_at is null;
  if not found then raise exception 'Choose the warehouse the material goes to'; end if;
  if wf.id = wt.id then raise exception 'The two warehouses must be different'; end if;
  v_date := coalesce((p_head->>'transfer_date')::date, current_date);
  if v_date > current_date then raise exception 'The date cannot be in the future'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one item'; end if;
  select legal_entity_id into ef from purchase.project_entity where project_id = wf.project_id;
  select legal_entity_id into et from purchase.project_entity where project_id = wt.project_id;
  if ef is null or et is null then raise exception 'Set the legal entity of both projects first (Setup > Legal entities) - it decides how the transfer is recorded'; end if;
  v_kind := case when ef = et then 'same_entity' else 'cross_entity' end;
  v_in_transit := purchase.setting('transfer.in_transit', 'true') = 'true';
  v_no := purchase.next_doc_no(wf.project_id, 'TRF', v_date);
  v_status := case when v_kind = 'cross_entity' then 'completed' when v_in_transit then 'in_transit' else 'completed' end;
  insert into purchase.transfers(doc_no, from_wh, to_wh, from_project_id, to_project_id, transfer_date, kind, status, vehicle_no, remarks, dispatched_by)
  values (v_no, wf.id, wt.id, wf.project_id, wt.project_id, v_date, v_kind, v_status, nullif(btrim(coalesce(p_head->>'vehicle_no', '')), ''), nullif(btrim(coalesce(p_head->>'remarks', '')), ''), me) returning id into v_id;

  if v_kind = 'cross_entity' then
    insert into purchase.stock_adjustments(doc_no, project_id, warehouse_id, adj_date, kind, reason, status, total_value, source, accounts_flag, raised_by, approved_at, submitted_at)
    values (purchase.next_doc_no(wf.project_id, 'ADJ', v_date), wf.project_id, wf.id, v_date, 'transfer', 'Transfer ' || v_no || ' to ' || wt.name || ' (different legal entity)', 'approved', 0, 'transfer', true, me, now(), now()) returning id into v_adj_out;
    insert into purchase.stock_adjustments(doc_no, project_id, warehouse_id, adj_date, kind, reason, status, total_value, source, accounts_flag, raised_by, approved_at, submitted_at)
    values (purchase.next_doc_no(wt.project_id, 'ADJ', v_date), wt.project_id, wt.id, v_date, 'transfer', 'Transfer ' || v_no || ' from ' || wf.name || ' (different legal entity)', 'approved', 0, 'transfer', true, me, now(), now()) returning id into v_adj_in;
    select doc_no into v_out_no from purchase.stock_adjustments where id = v_adj_out;
    select doc_no into v_in_no from purchase.stock_adjustments where id = v_adj_in;
  end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_item := (l->>'item_id')::bigint; v_q := (l->>'qty')::numeric;
    if coalesce(v_q, 0) <= 0 then raise exception 'Transfer quantity must be more than 0'; end if;
    v_n := v_n + 1;
    if v_kind = 'cross_entity' then
      v_rate := purchase._stock_post(wf.id, v_item, -v_q, null, v_date, 'ADJ', v_adj_out, v_out_no, null, 'Transfer ' || v_no || ' to ' || wt.name);
    else
      v_rate := purchase._stock_post(wf.id, v_item, -v_q, null, v_date, 'TRF', v_id, v_no, null, 'Transfer to ' || wt.name);
    end if;
    v_val := round(v_q * v_rate, 2);
    insert into purchase.transfer_lines(transfer_id, line_no, item_id, qty, rate, value, received_qty, remark)
    values (v_id, v_n, v_item, v_q, v_rate, v_val, case when v_status = 'completed' then v_q else 0 end, nullif(btrim(coalesce(l->>'remark', '')), '')) returning id into v_line;
    if v_kind = 'cross_entity' then
      insert into purchase.adjustment_lines(adjustment_id, line_no, item_id, direction, qty, rate, value, note) values (v_adj_out, v_n, v_item, 'decrease', v_q, v_rate, v_val, 'Transfer ' || v_no);
      insert into purchase.adjustment_lines(adjustment_id, line_no, item_id, direction, qty, rate, value, note) values (v_adj_in, v_n, v_item, 'increase', v_q, v_rate, v_val, 'Transfer ' || v_no);
      perform purchase._stock_post(wt.id, v_item, v_q, v_rate, v_date, 'ADJ', v_adj_in, v_in_no, null, 'Transfer ' || v_no || ' from ' || wf.name);
    elsif v_status = 'completed' then
      perform purchase._stock_post(wt.id, v_item, v_q, v_rate, v_date, 'TRF', v_id, v_no, v_line, 'Transfer from ' || wf.name);
    end if;
  end loop;
  if v_kind = 'cross_entity' then
    -- total each linked adjustment's value and link them to the transfer
    update purchase.stock_adjustments a set total_value = (select coalesce(sum(value), 0) from purchase.adjustment_lines where adjustment_id = a.id) where a.id in (v_adj_out, v_adj_in);
    update purchase.transfers set adj_out_id = v_adj_out, adj_in_id = v_adj_in where id = v_id;
    insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('adjustment', v_adj_out, me, 'Posted', 'Linked to ' || v_no || ' - for Accounts');
    insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('adjustment', v_adj_in, me, 'Posted', 'Linked to ' || v_no || ' - for Accounts');
  end if;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('transfer', v_id, me, case when v_status = 'in_transit' then 'Dispatched (in transit)' else 'Transferred' end, wf.name || ' to ' || wt.name);
  return v_no;
end $fn$;

-- Receive a transfer that is in transit. Anything not received is sent back to the sending warehouse.
create or replace function purchase.transfer_receive(p_id bigint, p_lines jsonb) returns text
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('stock.transfer'); t purchase.transfers; l jsonb; tl purchase.transfer_lines; v_r numeric; v_back numeric; v_date date := current_date;
begin
  select * into t from purchase.transfers where id = p_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  if t.status <> 'in_transit' then raise exception 'This transfer is not in transit'; end if;
  for tl in select * from purchase.transfer_lines where transfer_id = p_id order by line_no for update loop
    select x into l from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x where (x->>'line_id')::bigint = tl.id limit 1;
    v_r := coalesce((l->>'received_qty')::numeric, tl.qty);
    if v_r < 0 or v_r > tl.qty then raise exception 'Received quantity of % must be between 0 and %', (select name from purchase.items where id = tl.item_id), tl.qty; end if;
    v_back := tl.qty - v_r;
    if v_r > 0 then perform purchase._stock_post(t.to_wh, tl.item_id, v_r, tl.rate, v_date, 'TRF', p_id, t.doc_no, tl.id, 'Received from ' || (select name from purchase.warehouses where id = t.from_wh)); end if;
    if v_back > 0 then perform purchase._stock_post(t.from_wh, tl.item_id, v_back, tl.rate, v_date, 'TRF', p_id, t.doc_no, tl.id, 'Not received - sent back'); end if;
    update purchase.transfer_lines set received_qty = v_r, returned_qty = v_back where id = tl.id;
  end loop;
  update purchase.transfers set status = 'received', received_by = me, received_at = now() where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action) values ('transfer', p_id, me, 'Received');
  return t.doc_no;
end $fn$;

-- ---------------------------------------------------------------------------
-- Grants and read-only RLS
-- ---------------------------------------------------------------------------
do $g$
declare f text;
begin
  foreach f in array array['grn_save(bigint, bigint, jsonb, jsonb)','grn_delete(bigint)','grn_post(bigint)','rtv_create(bigint, jsonb, jsonb)','issue_create(jsonb, jsonb)','issue_return_create(bigint, jsonb, jsonb)',
      'adjustment_save(bigint, jsonb, jsonb)','adjustment_delete(bigint)','adjustment_submit(bigint)','adjustment_decide(bigint, boolean, text)','transfer_dispatch(jsonb, jsonb)','transfer_receive(bigint, jsonb)'] loop
    execute 'revoke all on function purchase.' || f || ' from public, anon';
    execute 'grant execute on function purchase.' || f || ' to authenticated';
  end loop;
end $g$;

do $rls$
declare t text;
begin
  foreach t in array array['stock_balances','stock_ledger','grns','grn_lines','rtvs','rtv_lines','issues','issue_lines','issue_returns','issue_return_lines',
                           'stock_adjustments','adjustment_lines','adjustment_approvals','transfers','transfer_lines'] loop
    execute format('alter table purchase.%I enable row level security', t);
    execute format('drop policy if exists %I on purchase.%I', t || '_staff_read', t);
    execute format('create policy %I on purchase.%I for select to authenticated using ((select not app.is_customer()))', t || '_staff_read', t);
    execute format('grant select on purchase.%I to authenticated', t);
  end loop;
end $rls$;
grant usage, select on all sequences in schema purchase to authenticated;

update purchase.permissions set stage = null where key in ('grn.post','stock.issue','stock.adjust','stock.transfer');
