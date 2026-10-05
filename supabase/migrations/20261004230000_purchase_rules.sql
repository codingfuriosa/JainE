-- Purchase & Stores: module rules, set by administrators on the Admin tab (Rules).
--
-- purchase.settings holds one row per rule (key -> text value); a missing row means the rule's default.
-- Rules enforced today (read by the functions/triggers below):
--   indent.allow_self_approval     'true' | 'false' (default false)
--   indent.require_required_by     'true' | 'false' (default false)
--   vendor.docs_before_approval    'off' | 'warn' | 'block' (default warn; 'block' is enforced here)
-- Rules the screens read: vendor.reapprove_on_change.
-- Rules stored for later stages (used when those stages are built): grn.over_receipt_pct,
--   transfer.in_transit, compare.basis, billing.capture_tds.

create table if not exists purchase.settings(
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now(),
  updated_by  text default app.current_user_email()
);

create or replace function purchase.setting(p_key text, p_default text) returns text
 language sql stable security definer set search_path = purchase, public as $fn$
  select coalesce((select s.value from purchase.settings s where s.key = p_key), p_default)
$fn$;
revoke all on function purchase.setting(text, text) from public, anon;
grant execute on function purchase.setting(text, text) to authenticated;

alter table purchase.settings enable row level security;
drop policy if exists settings_staff_read on purchase.settings;
drop policy if exists settings_admin_write on purchase.settings;
create policy settings_staff_read on purchase.settings for select to authenticated using ((select not app.is_customer()));
create policy settings_admin_write on purchase.settings for all to authenticated
  using ((select purchase.is_module_admin())) with check ((select purchase.is_module_admin()));
grant select, insert, update, delete on purchase.settings to authenticated;

-- ---------------------------------------------------------------------------
-- indent_submit: honours indent.require_required_by
-- ---------------------------------------------------------------------------
create or replace function purchase.indent_submit(p_id bigint) returns text
 language plpgsql security definer set search_path = purchase, public as $fn$
declare i purchase.indents; me text := lower(coalesce(app.current_user_email(), '')); v_first int; v_no text;
begin
  if me = '' then raise exception 'not signed in'; end if;
  if app.is_customer() then raise exception 'not allowed'; end if;
  select * into i from purchase.indents where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Indent not found'; end if;
  if lower(i.raised_by) <> me and not app.is_superadmin() then raise exception 'Only the person who raised the indent can submit it'; end if;
  if i.status not in ('draft','rejected') then raise exception 'This indent is already %', replace(i.status, '_', ' '); end if;
  if not exists (select 1 from purchase.indent_lines where indent_id = p_id) then raise exception 'Add at least one item first'; end if;
  if i.required_by is null and purchase.setting('indent.require_required_by', 'false') = 'true' then
    raise exception 'Enter the date this indent is required by';
  end if;
  select min(level) into v_first from purchase.approval_chains where project_id = i.project_id and doc_type = 'indent';
  if v_first is null then raise exception 'No approver is set for this project - add one in Admin > Approvers'; end if;

  perform set_config('purchase.in_fn', '1', true);
  v_no := coalesce(i.doc_no, purchase.next_doc_no(i.project_id, 'IND', i.indent_date));
  insert into purchase.indent_approvals(indent_id, round, level, approvers, status)
    select p_id, i.round + 1, c.level, c.approvers, case when c.level = v_first then 'pending' else 'waiting' end
      from purchase.approval_chains c where c.project_id = i.project_id and c.doc_type = 'indent';
  update purchase.indents set status = 'pending_approval', current_level = v_first, round = i.round + 1,
         doc_no = v_no, submitted_at = now() where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action) values ('indent', p_id, me, case when i.round = 0 then 'submitted' else 'resubmitted' end);
  perform set_config('purchase.in_fn', '', true);
  return v_no;
end $fn$;

-- ---------------------------------------------------------------------------
-- indent_decide: honours indent.allow_self_approval
-- ---------------------------------------------------------------------------
create or replace function purchase.indent_decide(p_id bigint, p_approve boolean, p_remark text default null) returns text
 language plpgsql security definer set search_path = purchase, public as $fn$
declare i purchase.indents; a purchase.indent_approvals; me text := lower(coalesce(app.current_user_email(), '')); v_next int; v_out text;
begin
  if me = '' then raise exception 'not signed in'; end if;
  if app.is_customer() then raise exception 'not allowed'; end if;
  select * into i from purchase.indents where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Indent not found'; end if;
  if i.status <> 'pending_approval' then raise exception 'This indent is not waiting for approval'; end if;
  select * into a from purchase.indent_approvals where indent_id = p_id and round = i.round and level = i.current_level and status = 'pending' for update;
  if not found then raise exception 'No approval step is open on this indent'; end if;
  if not exists (select 1 from unnest(a.approvers) x where lower(x) = me) then raise exception 'You are not an approver at this level'; end if;
  if lower(i.raised_by) = me and purchase.setting('indent.allow_self_approval', 'false') <> 'true' then
    raise exception 'You cannot decide an indent you raised yourself';
  end if;
  if not p_approve and btrim(coalesce(p_remark, '')) = '' then raise exception 'Give a reason for rejecting'; end if;

  perform set_config('purchase.in_fn', '1', true);
  update purchase.indent_approvals set status = case when p_approve then 'approved' else 'rejected' end,
         acted_by = me, acted_at = now(), remark = nullif(btrim(coalesce(p_remark, '')), '') where id = a.id;
  if p_approve then
    select min(level) into v_next from purchase.indent_approvals where indent_id = p_id and round = i.round and status = 'waiting';
    if v_next is null then
      update purchase.indents set status = 'approved', current_level = 0, approved_at = now() where id = p_id;
      insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('indent', p_id, me, 'approved', nullif(btrim(coalesce(p_remark, '')), ''));
      v_out := 'approved';
    else
      update purchase.indent_approvals set status = 'pending' where indent_id = p_id and round = i.round and level = v_next;
      update purchase.indents set current_level = v_next where id = p_id;
      insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('indent', p_id, me, 'approved level ' || a.level, nullif(btrim(coalesce(p_remark, '')), ''));
      v_out := 'pending_approval';
    end if;
  else
    update purchase.indents set status = 'rejected', current_level = 0 where id = p_id;
    insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('indent', p_id, me, 'rejected', btrim(p_remark));
    v_out := 'rejected';
  end if;
  perform set_config('purchase.in_fn', '', true);
  return v_out;
end $fn$;

-- ---------------------------------------------------------------------------
-- vendors: when vendor.docs_before_approval = 'block', a vendor cannot become approved without
-- its PAN card (if it has a PAN), GST certificate (if it has a GSTIN) and a cancelled cheque (if it has a bank account).
-- ---------------------------------------------------------------------------
create or replace function purchase.vendors_before_write() returns trigger
 language plpgsql set search_path = purchase, public as $fn$
declare v_missing text[] := '{}';
begin
  if tg_op = 'INSERT' and (new.code is null or btrim(new.code) = '') then
    new.code := 'V-' || lpad(nextval('purchase.vendor_code_seq')::text, 4, '0');
  end if;
  new.updated_at := now();
  new.updated_by := app.current_user_email();
  if tg_op = 'INSERT' then
    new.status := 'pending';
  elsif new.status is distinct from old.status then
    if new.status = 'approved' and purchase.setting('vendor.docs_before_approval', 'warn') = 'block' then
      if new.pan is not null and not exists (select 1 from purchase.vendor_documents d where d.vendor_id = new.id and d.doc_type = 'pan' and d.deleted_at is null) then
        v_missing := array_append(v_missing, 'PAN card');
      end if;
      if new.gstin is not null and not exists (select 1 from purchase.vendor_documents d where d.vendor_id = new.id and d.doc_type = 'gst_certificate' and d.deleted_at is null) then
        v_missing := array_append(v_missing, 'GST certificate');
      end if;
      if exists (select 1 from purchase.vendor_banks b where b.vendor_id = new.id)
         and not exists (select 1 from purchase.vendor_documents d where d.vendor_id = new.id and d.doc_type = 'cancelled_cheque' and d.deleted_at is null) then
        v_missing := array_append(v_missing, 'cancelled cheque');
      end if;
      if array_length(v_missing, 1) > 0 then
        raise exception 'This vendor cannot be approved yet - missing: %. Upload them first (Docs button).', array_to_string(v_missing, ', ');
      end if;
    end if;
    new.status_by := app.current_user_email();
    new.status_at := now();
  end if;
  return new;
end $fn$;
