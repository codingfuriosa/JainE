-- Purchase & Stores: roles inside this module, decided by administrators on the Admin tab (Roles).
--
-- permissions          the things a person can be allowed to do in the module (a fixed catalogue)
-- roles                named bundles of permissions (a few built in; administrators can add more)
-- role_permissions     which permissions each role carries
-- role_members         which people hold which role (a person may hold several)
--
-- purchase.can(perm) is true for module administrators, for everyone while the rule roles.enforce is
-- 'false', and otherwise for people holding a role that carries the permission. Writes to the tables a
-- permission covers are refused by row-level security without it; everyone on staff can still READ.
-- Permissions for stages not built yet are stored now (marked with their stage) and start to bite
-- when those stages arrive.

create table if not exists purchase.permissions(
  key    text primary key,
  label  text not null,
  grp    text not null,
  stage  text,
  sort   int not null default 0
);

create table if not exists purchase.roles(
  id           bigserial primary key,
  name         text not null,
  description  text,
  built_in     boolean not null default false,
  created_at   timestamptz not null default now(),
  created_by   text default app.current_user_email()
);
create unique index if not exists roles_name_uq on purchase.roles (lower(name));

create table if not exists purchase.role_permissions(
  role_id     bigint not null references purchase.roles(id) on delete cascade,
  permission  text not null references purchase.permissions(key) on delete cascade,
  primary key (role_id, permission)
);

create table if not exists purchase.role_members(
  role_id     bigint not null references purchase.roles(id) on delete cascade,
  email       text not null,
  created_at  timestamptz not null default now(),
  created_by  text default app.current_user_email(),
  primary key (role_id, email),
  check (email = lower(email))
);

insert into purchase.permissions(key, label, grp, stage, sort) values
 ('item.manage',      'Add and edit items, item groups and UOM',                          'Setup',      null,      10),
 ('vendor.manage',    'Enlist and edit vendors, send invitations, manage vendor documents','Vendors',    null,      20),
 ('vendor.approve',   'Approve, reject or block vendors',                                 'Vendors',    null,      21),
 ('indent.raise',     'Raise, edit and submit indents',                                   'Indents',    null,      30),
 ('indent.short_close','Short close indents',                                             'Indents',    null,      31),
 ('rfq.manage',       'Raise RFQs, enter and compare quotations, send counter offers',    'Purchasing', 'Stage 4', 40),
 ('po.create',        'Create and amend purchase orders',                                 'Purchasing', 'Stage 5', 50),
 ('po.short_close',   'Short close purchase orders',                                      'Purchasing', 'Stage 5', 51),
 ('grn.post',         'Receive goods (GRN) and return them to vendors',                   'Stores',     'Stage 6', 60),
 ('stock.issue',      'Issue material and take issued material back',                     'Stores',     'Stage 6', 61),
 ('stock.adjust',     'Pass stock adjustment entries',                                    'Stores',     'Stage 6', 62),
 ('stock.transfer',   'Transfer material between sites',                                  'Stores',     'Stage 6', 63),
 ('bill.book',        'Book bills and raise debit notes',                                 'Billing',    'Stage 7', 70),
 ('nonstore.purchase','Non-store purchases and service bills',                            'Billing',    'Stage 8', 80),
 ('report.view',      'View stock reports',                                               'Reports',    'Stage 9', 90)
on conflict (key) do nothing;

do $seed$
declare r record; v_id bigint;
begin
  for r in select * from (values
    ('Purchase manager', 'Runs the department: everything except changing the module''s administration.',
       array['item.manage','vendor.manage','vendor.approve','indent.raise','indent.short_close','rfq.manage','po.create','po.short_close','grn.post','stock.issue','stock.adjust','stock.transfer','bill.book','nonstore.purchase','report.view']),
    ('Purchase officer', 'Day-to-day purchasing: items, vendors, indents, quotations and orders.',
       array['item.manage','vendor.manage','indent.raise','indent.short_close','rfq.manage','po.create','po.short_close','report.view']),
    ('Store keeper', 'Receives, issues and moves stock at a site.',
       array['indent.raise','grn.post','stock.issue','stock.transfer','report.view']),
    ('Site engineer', 'Raises indents for what the site needs.',
       array['indent.raise']),
    ('Accounts', 'Books bills, debit notes and non-store purchases.',
       array['bill.book','nonstore.purchase','report.view']),
    ('Viewer', 'Can look but not change anything.',
       array['report.view'])
  ) as t(name, descr, perms) loop
    select id into v_id from purchase.roles where lower(name) = lower(r.name);
    if v_id is null then
      insert into purchase.roles(name, description, built_in, created_by) values (r.name, r.descr, true, 'migration') returning id into v_id;
      insert into purchase.role_permissions(role_id, permission) select v_id, unnest(r.perms);
    end if;
  end loop;
end $seed$;

-- ---------------------------------------------------------------------------
-- The test everything else uses
-- ---------------------------------------------------------------------------
create or replace function purchase.can(p_perm text) returns boolean
 language sql stable security definer set search_path = purchase, public as $fn$
  select not app.is_customer() and (
    purchase.is_module_admin()
    or purchase.setting('roles.enforce', 'true') <> 'true'
    or exists (select 1 from purchase.role_members m join purchase.role_permissions rp on rp.role_id = m.role_id
                where m.email = lower(coalesce(app.current_user_email(), '')) and rp.permission = p_perm)
  )
$fn$;
revoke all on function purchase.can(text) from public, anon;
grant execute on function purchase.can(text) to authenticated;

-- What the signed-in person may do, for the screens to show or hide buttons (the database decides regardless).
create or replace function purchase.my_permissions() returns text[]
 language sql stable security definer set search_path = purchase, public as $fn$
  select coalesce(array_agg(p.key order by p.sort), '{}') from purchase.permissions p where purchase.can(p.key)
$fn$;
revoke all on function purchase.my_permissions() from public, anon;
grant execute on function purchase.my_permissions() to authenticated;

-- ---------------------------------------------------------------------------
-- RLS for the role tables: staff read, administrators write
-- ---------------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array['permissions','roles','role_permissions','role_members'] loop
    execute format('alter table purchase.%I enable row level security', t);
    execute format('drop policy if exists %I on purchase.%I', t || '_staff_read', t);
    execute format('drop policy if exists %I on purchase.%I', t || '_admin_write', t);
    execute format('create policy %I on purchase.%I for select to authenticated using ((select not app.is_customer()))', t || '_staff_read', t);
    if t <> 'permissions' then
      execute format('create policy %I on purchase.%I for all to authenticated using ((select purchase.is_module_admin())) with check ((select purchase.is_module_admin()))', t || '_admin_write', t);
      execute format('grant select, insert, update, delete on purchase.%I to authenticated', t);
    else
      execute format('grant select on purchase.%I to authenticated', t);
    end if;
  end loop;
end $rls$;
grant usage, select on all sequences in schema purchase to authenticated;

-- ---------------------------------------------------------------------------
-- Put the permissions to work: writes to these tables now need the matching permission.
-- ---------------------------------------------------------------------------
do $perm$
declare m jsonb := '{
  "items":"item.manage","item_groups":"item.manage","uoms":"item.manage",
  "vendors":"vendor.manage","vendor_contacts":"vendor.manage","vendor_banks":"vendor.manage","vendor_groups":"vendor.manage",
  "vendor_documents":"vendor.manage","vendor_invites":"vendor.manage",
  "indents":"indent.raise","indent_lines":"indent.raise"}'::jsonb;
  t text; p text;
begin
  for t, p in select key, value #>> '{}' from jsonb_each(m) loop
    execute format('drop policy if exists %I on purchase.%I', t || '_staff_all', t);
    execute format('drop policy if exists %I on purchase.%I', t || '_staff_read', t);
    execute format('drop policy if exists %I on purchase.%I', t || '_perm_write', t);
    execute format('create policy %I on purchase.%I for select to authenticated using ((select not app.is_customer()))', t || '_staff_read', t);
    execute format('create policy %I on purchase.%I for all to authenticated using ((select purchase.can(%L))) with check ((select purchase.can(%L)))', t || '_perm_write', t, p, p);
  end loop;
end $perm$;

-- ---------------------------------------------------------------------------
-- Functions that act on behalf of a person check the permission themselves
-- ---------------------------------------------------------------------------
create or replace function purchase.indent_submit(p_id bigint) returns text
 language plpgsql security definer set search_path = purchase, public as $fn$
declare i purchase.indents; me text := lower(coalesce(app.current_user_email(), '')); v_first int; v_no text;
begin
  if me = '' then raise exception 'not signed in'; end if;
  if app.is_customer() then raise exception 'not allowed'; end if;
  if not purchase.can('indent.raise') then raise exception 'You do not have permission to raise indents - ask a Purchase administrator'; end if;
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

create or replace function purchase.indent_short_close(p_id bigint, p_line_ids bigint[], p_reason text) returns int
 language plpgsql security definer set search_path = purchase, public as $fn$
declare i purchase.indents; me text := lower(coalesce(app.current_user_email(), '')); n int;
begin
  if me = '' then raise exception 'not signed in'; end if;
  if app.is_customer() then raise exception 'not allowed'; end if;
  if not purchase.can('indent.short_close') then raise exception 'You do not have permission to short close indents - ask a Purchase administrator'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason for short closing'; end if;
  select * into i from purchase.indents where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Indent not found'; end if;
  if i.status <> 'approved' then raise exception 'Only an approved indent that is still open can be short closed'; end if;
  perform set_config('purchase.in_fn', '1', true);
  update purchase.indent_lines l
     set short_closed_qty = l.short_closed_qty + (l.qty - l.ordered_qty - l.short_closed_qty),
         short_close_reason = btrim(p_reason), short_closed_by = me, short_closed_at = now()
   where l.indent_id = p_id and l.qty - l.ordered_qty - l.short_closed_qty > 0
     and (p_line_ids is null or l.id = any (p_line_ids));
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Nothing is left to close on the selected items'; end if;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark)
    values ('indent', p_id, me, 'short closed ' || n || ' item' || case when n = 1 then '' else 's' end, btrim(p_reason));
  perform purchase.indent_refresh(p_id);
  perform set_config('purchase.in_fn', '', true);
  return n;
end $fn$;

-- Vendors: approving, rejecting or blocking needs vendor.approve. (Putting a vendor back to pending -
-- which editing an approved vendor's tax or bank details does - needs only the right to edit vendors.)
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
    if new.status <> 'pending' and coalesce(app.current_user_email(), '') <> '' and not purchase.can('vendor.approve') then
      raise exception 'You do not have permission to approve, reject or block vendors - ask a Purchase administrator';
    end if;
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
