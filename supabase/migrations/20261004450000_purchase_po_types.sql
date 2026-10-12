-- Purchase & Stores: the purchase order "Document Type".
-- A PO now carries a document type, chosen from a small master that administrators keep on Setup -> PO types
-- (same idea as the indent types). One type, "Purchase Order", is seeded; add more (for example a capital purchase
-- order) as needed. The type is chosen when the order is made from the RFQ comparison and can be changed while the
-- order is a draft or rejected. Business Unit (= project), Supplier (= vendor) and Parent Account Head (= the vendor's
-- ledger parent description) are not stored on the order - they are read from the project and the vendor.

create table if not exists purchase.po_types(
  id          bigserial primary key,
  name        text not null,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  created_by  text default app.current_user_email(),
  deleted_at  timestamptz,
  deleted_by  text
);
create unique index if not exists po_types_name_uq on purchase.po_types (lower(name)) where deleted_at is null;
insert into purchase.po_types(name, sort_order)
select 'Purchase Order', 1 where not exists (select 1 from purchase.po_types where lower(name) = 'purchase order' and deleted_at is null);

alter table purchase.po_types enable row level security;
drop policy if exists po_types_staff_read on purchase.po_types;
drop policy if exists po_types_admin_write on purchase.po_types;
create policy po_types_staff_read on purchase.po_types for select to authenticated using ((select not app.is_customer()));
create policy po_types_admin_write on purchase.po_types for all to authenticated using ((select purchase.is_module_admin())) with check ((select purchase.is_module_admin()));
grant select, insert, update, delete on purchase.po_types to authenticated;
grant usage, select on all sequences in schema purchase to authenticated;

alter table purchase.pos add column if not exists po_type_id bigint references purchase.po_types(id);
update purchase.pos set po_type_id = (select id from purchase.po_types where deleted_at is null order by sort_order, id limit 1) where po_type_id is null;

-- Make the orders from the RFQ comparison with a document type (default: the first active type).
drop function if exists purchase.po_create_from_rfq(bigint, jsonb, bigint);
create or replace function purchase.po_create_from_rfq(p_rfq_id bigint, p_selections jsonb, p_warehouse_id bigint, p_type_id bigint default null) returns bigint[]
 language plpgsql security definer set search_path = purchase, public as $fn$
declare
  me text := purchase._po_guard('po.create'); r purchase.rfqs; s jsonb; rl purchase.rfq_lines; rv purchase.rfq_vendors; q purchase.quotations; ql purchase.quotation_lines;
  it purchase.items; v_vendor bigint; v_po bigint; v_n int; v_qty numeric; v_cov numeric; ids bigint[] := '{}'; seen bigint[] := '{}'; v_type bigint := p_type_id;
begin
  select * into r from purchase.rfqs where id = p_rfq_id and deleted_at is null for update;
  if not found then raise exception 'RFQ not found'; end if;
  if r.status not in ('open','closed') then raise exception 'Orders can only be made from an open or closed RFQ that is not yet fully ordered'; end if;
  if not exists (select 1 from purchase.warehouses where id = p_warehouse_id and project_id = r.project_id and active and deleted_at is null) then
    raise exception 'Choose the warehouse the material is to be delivered to';
  end if;
  if v_type is null then
    select id into v_type from purchase.po_types where active and deleted_at is null order by sort_order, id limit 1;
  elsif not exists (select 1 from purchase.po_types where id = v_type and active and deleted_at is null) then
    raise exception 'Choose a valid document type';
  end if;
  if jsonb_typeof(p_selections) <> 'array' or jsonb_array_length(p_selections) = 0 then raise exception 'Choose a vendor for at least one item'; end if;

  for v_vendor in select distinct (x->>'rfq_vendor_id')::bigint from jsonb_array_elements(p_selections) x loop
    select * into rv from purchase.rfq_vendors where id = v_vendor and rfq_id = p_rfq_id;
    if not found then raise exception 'A selected vendor is not part of this RFQ'; end if;
    if not exists (select 1 from purchase.vendors where id = rv.vendor_id and status = 'approved' and deleted_at is null) then raise exception 'Only an approved vendor can be given an order'; end if;
    select * into q from purchase.quotations where rfq_vendor_id = v_vendor and is_current;
    if not found then raise exception 'A selected vendor has not quoted yet'; end if;

    insert into purchase.pos(project_id, rfq_id, vendor_id, warehouse_id, po_type_id, payment_terms, delivery_terms, warranty_terms, freight_terms, price_validity, other_terms, remarks, raised_by)
    values (r.project_id, p_rfq_id, rv.vendor_id, p_warehouse_id, v_type, q.payment_terms, q.delivery_terms, q.warranty_terms, q.freight_terms, q.price_validity, q.other_terms, q.remarks, me)
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
revoke all on function purchase.po_create_from_rfq(bigint, jsonb, bigint, bigint) from public, anon;
grant execute on function purchase.po_create_from_rfq(bigint, jsonb, bigint, bigint) to authenticated;

-- Edit a draft / rejected PO: the document type can be changed along with the delivery details, terms and line numbers.
create or replace function purchase.po_update(p_id bigint, p_head jsonb, p_lines jsonb) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('po.create'); p purchase.pos; l jsonb; pl purchase.po_lines; rl purchase.rfq_lines; v_cov numeric; v_type bigint := nullif(p_head->>'po_type_id', '')::bigint;
begin
  select * into p from purchase.pos where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if p.status not in ('draft','rejected') then raise exception 'This purchase order is % and cannot be edited - amend it instead', replace(p.status, '_', ' '); end if;
  if lower(p.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who raised the purchase order can change it'; end if;
  if (p_head->>'warehouse_id') is not null and not exists (select 1 from purchase.warehouses where id = (p_head->>'warehouse_id')::bigint and project_id = p.project_id and active and deleted_at is null) then
    raise exception 'Choose a warehouse of this project';
  end if;
  if v_type is not null and v_type is distinct from p.po_type_id and not exists (select 1 from purchase.po_types where id = v_type and active and deleted_at is null) then
    raise exception 'Choose a valid document type';
  end if;
  update purchase.pos set
    po_type_id = coalesce(v_type, po_type_id),
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
