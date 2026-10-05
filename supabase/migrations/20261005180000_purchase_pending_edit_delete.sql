-- Purchase & Stores: the maker can edit or delete a document while it is AWAITING APPROVAL.
-- Once a document is approved it can no longer be edited or deleted (cancel / amend / short close are separate, controlled actions).
--
-- EDIT is "pull it back, change it, send it again":
--   *_withdraw(id)   only the maker (or a super admin), only while the status is pending_approval. It throws away the approval
--                    steps that have not been decided yet (steps already approved stay in the history), hands back anything the
--                    document had reserved (a purchase order's hold on indent quantity), and puts the document back to a draft
--                    with its number and revision kept. The screens then use the ordinary draft edit and submit again, which starts
--                    a NEW approval round from the first level - so nobody can approve something that was changed after they
--                    looked at it.
-- DELETE: *_delete(id) now also accepts a document awaiting approval (the screens only ever offered it for drafts).
--   - an indent, adjustment or non-store / service order is soft-deleted; a purchase order the same, after handing back its hold on
--     the indents. A purchase order that was approved once and then amended (revision > 0) can no longer be deleted at all.
-- All of it is checked here, in the database; hiding a button in the screen is not what protects a document.

create or replace function purchase.indent_withdraw(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := lower(coalesce(app.current_user_email(), '')); i purchase.indents;
begin
  if me = '' then raise exception 'not signed in'; end if;
  if app.is_customer() then raise exception 'not allowed'; end if;
  if not purchase.can('indent.raise') then raise exception 'You do not have permission to change indents - ask a Purchase administrator'; end if;
  select * into i from purchase.indents where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Indent not found'; end if;
  if lower(i.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who raised the indent can change it'; end if;
  if i.status <> 'pending_approval' then raise exception 'An indent can be pulled back only while it is awaiting approval - this one is %', replace(i.status, '_', ' '); end if;
  perform set_config('purchase.in_fn', '1', true);
  delete from purchase.indent_approvals where indent_id = p_id and round = i.round and status in ('waiting', 'pending');
  update purchase.indents set status = 'draft', current_level = 0 where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('indent', p_id, me, 'Pulled back from approval', 'To be edited and sent again');
  perform set_config('purchase.in_fn', '', true);
end $fn$;

create or replace function purchase.indent_delete(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := lower(coalesce(app.current_user_email(), '')); i purchase.indents;
begin
  if me = '' then raise exception 'not signed in'; end if;
  if app.is_customer() then raise exception 'not allowed'; end if;
  if not purchase.can('indent.raise') then raise exception 'You do not have permission to change indents - ask a Purchase administrator'; end if;
  select * into i from purchase.indents where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Indent not found'; end if;
  if lower(i.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who raised the indent can delete it'; end if;
  if i.status not in ('draft', 'pending_approval') then raise exception 'An indent can be deleted only while it is a draft or awaiting approval - this one is %', replace(i.status, '_', ' '); end if;
  perform set_config('purchase.in_fn', '1', true);
  delete from purchase.indent_approvals where indent_id = p_id and round = i.round and status in ('waiting', 'pending');
  update purchase.indents set deleted_at = now(), deleted_by = me where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('indent', p_id, me, 'Deleted', case when i.status = 'pending_approval' then 'Deleted while awaiting approval' end);
  perform set_config('purchase.in_fn', '', true);
end $fn$;

create or replace function purchase.po_withdraw(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('po.create'); p purchase.pos;
begin
  select * into p from purchase.pos where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if lower(p.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who raised the purchase order can change it'; end if;
  if p.status <> 'pending_approval' then raise exception 'A purchase order can be pulled back only while it is awaiting approval - this one is %', replace(p.status, '_', ' '); end if;
  perform set_config('purchase.in_fn', '1', true);
  perform purchase._po_release(p_id);
  delete from purchase.po_approvals where po_id = p_id and round = p.round and status in ('waiting', 'pending');
  update purchase.pos set status = 'draft', current_level = 0, updated_at = now() where id = p_id;
  perform purchase._rfq_refresh_status(p.rfq_id);
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('po', p_id, me, 'Pulled back from approval', 'To be edited and sent again');
  perform set_config('purchase.in_fn', '', true);
end $fn$;

create or replace function purchase.po_delete(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('po.create'); p purchase.pos;
begin
  select * into p from purchase.pos where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if p.status not in ('draft', 'pending_approval') then raise exception 'A purchase order can be deleted only while it is a draft or awaiting approval - this one is %. Cancel it instead.', replace(p.status, '_', ' '); end if;
  if p.revision > 0 then raise exception 'This purchase order was approved earlier and then amended, so it cannot be deleted - cancel it instead'; end if;
  if lower(p.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who raised the purchase order can delete it'; end if;
  if p.status = 'pending_approval' then
    perform set_config('purchase.in_fn', '1', true);
    perform purchase._po_release(p_id);
    delete from purchase.po_approvals where po_id = p_id and round = p.round and status in ('waiting', 'pending');
    perform set_config('purchase.in_fn', '', true);
  end if;
  update purchase.pos set deleted_at = now(), deleted_by = me where id = p_id;
  perform purchase._rfq_refresh_status(p.rfq_id);
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('po', p_id, me, 'Deleted', case when p.status = 'pending_approval' then 'Deleted while awaiting approval' end);
end $fn$;

create or replace function purchase.adjustment_withdraw(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('stock.adjust'); a purchase.stock_adjustments;
begin
  select * into a from purchase.stock_adjustments where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Adjustment not found'; end if;
  if lower(a.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who raised the adjustment can change it'; end if;
  if a.status <> 'pending_approval' then raise exception 'An adjustment can be pulled back only while it is awaiting approval - this one is %', replace(a.status, '_', ' '); end if;
  delete from purchase.adjustment_approvals where adjustment_id = p_id and round = a.round and status in ('waiting', 'pending');
  update purchase.stock_adjustments set status = 'draft', current_level = 0, updated_at = now() where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('adjustment', p_id, me, 'Pulled back from approval', 'To be edited and sent again');
end $fn$;

create or replace function purchase.adjustment_delete(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('stock.adjust'); a purchase.stock_adjustments;
begin
  select * into a from purchase.stock_adjustments where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Adjustment not found'; end if;
  if a.status not in ('draft', 'pending_approval') then raise exception 'An adjustment can be deleted only while it is a draft or awaiting approval - this one is %', replace(a.status, '_', ' '); end if;
  if lower(a.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who raised the adjustment can delete it'; end if;
  delete from purchase.adjustment_approvals where adjustment_id = p_id and round = a.round and status in ('waiting', 'pending');
  update purchase.stock_adjustments set deleted_at = now(), deleted_by = me where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('adjustment', p_id, me, 'Deleted', case when a.status = 'pending_approval' then 'Deleted while awaiting approval' end);
end $fn$;

create or replace function purchase.eo_withdraw(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('nonstore.purchase'); o purchase.expense_orders;
begin
  select * into o from purchase.expense_orders where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Order not found'; end if;
  if lower(o.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who raised the order can change it'; end if;
  if o.status <> 'pending_approval' then raise exception 'An order can be pulled back only while it is awaiting approval - this one is %', replace(o.status, '_', ' '); end if;
  delete from purchase.expense_order_approvals where order_id = p_id and round = o.round and status in ('waiting', 'pending');
  update purchase.expense_orders set status = 'draft', current_level = 0, updated_at = now() where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('eo', p_id, me, 'Pulled back from approval', 'To be edited and sent again');
end $fn$;

create or replace function purchase.eo_delete(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._po_guard('nonstore.purchase'); o purchase.expense_orders;
begin
  select * into o from purchase.expense_orders where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status not in ('draft', 'pending_approval') then raise exception 'An order can be deleted only while it is a draft or awaiting approval - this one is %. Cancel it instead.', replace(o.status, '_', ' '); end if;
  if lower(o.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who raised the order can delete it'; end if;
  delete from purchase.expense_order_approvals where order_id = p_id and round = o.round and status in ('waiting', 'pending');
  update purchase.expense_orders set deleted_at = now(), deleted_by = me where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('eo', p_id, me, 'Deleted', case when o.status = 'pending_approval' then 'Deleted while awaiting approval' end);
end $fn$;

do $g$
declare f text;
begin
  foreach f in array array['indent_withdraw(bigint)','indent_delete(bigint)','po_withdraw(bigint)','adjustment_withdraw(bigint)','eo_withdraw(bigint)'] loop
    execute 'revoke all on function purchase.' || f || ' from public, anon';
    execute 'grant execute on function purchase.' || f || ' to authenticated';
  end loop;
end $g$;
