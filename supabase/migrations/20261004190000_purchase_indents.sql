-- Purchase & Stores, Stage 3: indents, their approval and short closure.
-- See docs/purchase-stores-spec.md section 3.
--
-- An indent is raised against a project and one of its warehouses, with lines of (item, qty in the item's
-- RECEIPT uom). It is submitted for approval through the project's approver chain (levels, in order; at
-- each level any ONE of the listed people decides), and once approved it can be ordered against (Stage 5)
-- or short closed. The chain is a general mechanism: later documents (PO by value slab, stock adjustment)
-- reuse purchase.approval_chains with another doc_type.
--
-- Why not the Accountability workflow engine (acc.wf_*)? It models multi-step human TASKS and has no
-- callback into a business record, so an approved/rejected case could not move an indent. Approval here
-- is a few small tables and three functions, and the indent can never be approved except through them.
--
-- Document numbers: <project code>/IND/<financial year>/<serial>, e.g. DG/IND/26-27/0001. The project
-- code is the one set in Post Sales -> Setup -> Project (postsales.project_setup.code). The number is
-- given when the indent is first SUBMITTED, so drafts leave no gaps.

-- ---------------------------------------------------------------------------
-- Numbering
-- ---------------------------------------------------------------------------
create table if not exists purchase.doc_counters(
  project_id  bigint not null references cust.projects(id),
  doc_type    text not null,
  fy          text not null,
  last_no     int not null default 0,
  primary key (project_id, doc_type, fy)
);

create or replace function purchase.next_doc_no(p_project bigint, p_type text, p_date date default current_date) returns text
 language plpgsql security definer set search_path = purchase, public as $fn$
declare v_code text; v_fy text; v_y int; v_n int;
begin
  select code into v_code from postsales.project_setup where project_id = p_project;
  if v_code is null then
    raise exception 'This project has no code yet - set one in Post Sales > Setup > Project first';
  end if;
  v_y := extract(year from p_date)::int;
  if extract(month from p_date) < 4 then v_y := v_y - 1; end if;
  v_fy := lpad((v_y % 100)::text, 2, '0') || '-' || lpad(((v_y + 1) % 100)::text, 2, '0');
  insert into purchase.doc_counters(project_id, doc_type, fy, last_no) values (p_project, upper(p_type), v_fy, 1)
  on conflict (project_id, doc_type, fy) do update set last_no = purchase.doc_counters.last_no + 1
  returning last_no into v_n;
  return v_code || '/' || upper(p_type) || '/' || v_fy || '/' || lpad(v_n::text, 4, '0');
end $fn$;
revoke all on function purchase.next_doc_no(bigint, text, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Approval chains (setup) and the shared document log
-- ---------------------------------------------------------------------------
create table if not exists purchase.approval_chains(
  id          bigserial primary key,
  project_id  bigint not null references cust.projects(id),
  doc_type    text not null check (doc_type in ('indent')),
  level       int not null check (level > 0),
  approvers   text[] not null check (array_length(approvers, 1) > 0),
  created_at  timestamptz not null default now(),
  created_by  text default app.current_user_email(),
  unique (project_id, doc_type, level)
);
comment on column purchase.approval_chains.approvers is 'Emails. Any ONE of them can decide this level.';

create table if not exists purchase.doc_log(
  id        bigserial primary key,
  doc_type  text not null,
  doc_id    bigint not null,
  at        timestamptz not null default now(),
  by        text,
  action    text not null,
  remark    text
);
create index if not exists doc_log_doc_idx on purchase.doc_log (doc_type, doc_id, at);

-- ---------------------------------------------------------------------------
-- Indents
-- ---------------------------------------------------------------------------
create table if not exists purchase.indents(
  id            bigserial primary key,
  doc_no        text,
  project_id    bigint not null references cust.projects(id),
  warehouse_id  bigint not null references purchase.warehouses(id),
  indent_date   date not null default current_date,
  required_by   date,
  purpose       text,
  status        text not null default 'draft' check (status in ('draft','pending_approval','approved','rejected','closed')),
  current_level int not null default 0,
  round         int not null default 0,
  raised_by     text not null default app.current_user_email(),
  submitted_at  timestamptz,
  approved_at   timestamptz,
  closed_at     timestamptz,
  closed_kind   text check (closed_kind in ('fulfilled','short_closed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    text
);
create unique index if not exists indents_doc_no_uq on purchase.indents (doc_no) where doc_no is not null;
create index if not exists indents_project_idx on purchase.indents (project_id, status) where deleted_at is null;

create table if not exists purchase.indent_lines(
  id                bigserial primary key,
  indent_id         bigint not null references purchase.indents(id) on delete cascade,
  line_no           int not null,
  item_id           bigint not null references purchase.items(id),
  qty               numeric(14,3) not null check (qty > 0),
  uom_id            bigint not null references purchase.uoms(id),
  remark            text,
  ordered_qty       numeric(14,3) not null default 0 check (ordered_qty >= 0),
  short_closed_qty  numeric(14,3) not null default 0 check (short_closed_qty >= 0),
  short_close_reason text,
  short_closed_by   text,
  short_closed_at   timestamptz,
  check (ordered_qty + short_closed_qty <= qty)
);
create index if not exists indent_lines_indent_idx on purchase.indent_lines (indent_id, line_no);
comment on column purchase.indent_lines.qty is 'In the item''s RECEIPT uom (uom_id is a snapshot of it).';

create table if not exists purchase.indent_approvals(
  id          bigserial primary key,
  indent_id   bigint not null references purchase.indents(id) on delete cascade,
  round       int not null,
  level       int not null,
  approvers   text[] not null,
  status      text not null check (status in ('waiting','pending','approved','rejected')),
  acted_by    text,
  acted_at    timestamptz,
  remark      text
);
create index if not exists indent_approvals_idx on purchase.indent_approvals (indent_id, round, level);

-- ---------------------------------------------------------------------------
-- Guards: the lifecycle can only move through the functions below.
-- ---------------------------------------------------------------------------
create or replace function purchase.in_fn() returns boolean
 language sql stable as $$ select coalesce(current_setting('purchase.in_fn', true), '') = '1' $$;

create or replace function purchase.indents_guard() returns trigger
 language plpgsql set search_path = purchase, public as $fn$
declare me text := lower(coalesce(app.current_user_email(), ''));
begin
  if tg_op = 'INSERT' then
    new.status := 'draft'; new.current_level := 0; new.round := 0; new.doc_no := null;
    new.submitted_at := null; new.approved_at := null; new.closed_at := null; new.closed_kind := null;
    new.raised_by := coalesce(app.current_user_email(), new.raised_by);
    return new;
  end if;
  new.updated_at := now();
  if purchase.in_fn() then return new; end if;
  if new.status is distinct from old.status or new.doc_no is distinct from old.doc_no
     or new.current_level is distinct from old.current_level or new.round is distinct from old.round
     or new.raised_by is distinct from old.raised_by or new.submitted_at is distinct from old.submitted_at
     or new.approved_at is distinct from old.approved_at or new.closed_at is distinct from old.closed_at
     or new.closed_kind is distinct from old.closed_kind then
    raise exception 'An indent moves through submit / approve / reject / short close only';
  end if;
  if old.status not in ('draft','rejected') then
    raise exception 'This indent is % and can no longer be edited', replace(old.status, '_', ' ');
  end if;
  if lower(old.raised_by) <> me and not app.is_superadmin() then
    raise exception 'Only the person who raised the indent can change it';
  end if;
  if new.deleted_at is not null and old.status <> 'draft' then
    raise exception 'Only a draft indent can be deleted';
  end if;
  return new;
end $fn$;
drop trigger if exists indents_guard on purchase.indents;
create trigger indents_guard before insert or update on purchase.indents for each row execute function purchase.indents_guard();

create or replace function purchase.indent_lines_guard() returns trigger
 language plpgsql set search_path = purchase, public as $fn$
declare i purchase.indents; me text := lower(coalesce(app.current_user_email(), ''));
begin
  if purchase.in_fn() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  select * into i from purchase.indents where id = coalesce(new.indent_id, old.indent_id);
  if i.status not in ('draft','rejected') then
    raise exception 'This indent is % - its items can no longer be changed', replace(i.status, '_', ' ');
  end if;
  if lower(i.raised_by) <> me and not app.is_superadmin() then
    raise exception 'Only the person who raised the indent can change its items';
  end if;
  if tg_op = 'UPDATE' and (new.ordered_qty is distinct from old.ordered_qty or new.short_closed_qty is distinct from old.short_closed_qty
                          or new.short_close_reason is distinct from old.short_close_reason) then
    raise exception 'Ordered and short-closed quantities are set by the system';
  end if;
  if tg_op = 'INSERT' and (new.ordered_qty <> 0 or new.short_closed_qty <> 0) then
    raise exception 'Ordered and short-closed quantities are set by the system';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $fn$;
drop trigger if exists indent_lines_guard on purchase.indent_lines;
create trigger indent_lines_guard before insert or update or delete on purchase.indent_lines for each row execute function purchase.indent_lines_guard();

-- ---------------------------------------------------------------------------
-- Submit, decide, short close
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
  select min(level) into v_first from purchase.approval_chains where project_id = i.project_id and doc_type = 'indent';
  if v_first is null then raise exception 'No approver is set for this project - add one in Setup > Approvals'; end if;

  perform set_config('purchase.in_fn', '1', true);
  v_no := coalesce(i.doc_no, purchase.next_doc_no(i.project_id, 'IND', i.indent_date));
  insert into purchase.indent_approvals(indent_id, round, level, approvers, status)
    select p_id, i.round + 1, c.level, c.approvers, case when c.level = v_first then 'pending' else 'waiting' end
      from purchase.approval_chains c where c.project_id = i.project_id and c.doc_type = 'indent';
  update purchase.indents set status = 'pending_approval', current_level = v_first, round = i.round + 1,
         doc_no = v_no, submitted_at = now() where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action) values ('indent', p_id, me, case when i.round = 0 then 'submitted' else 'resubmitted' end);
  return v_no;
end $fn$;

create or replace function purchase.indent_decide(p_id bigint, p_approve boolean, p_remark text default null) returns text
 language plpgsql security definer set search_path = purchase, public as $fn$
declare i purchase.indents; a purchase.indent_approvals; me text := lower(coalesce(app.current_user_email(), '')); v_next int;
begin
  if me = '' then raise exception 'not signed in'; end if;
  if app.is_customer() then raise exception 'not allowed'; end if;
  select * into i from purchase.indents where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Indent not found'; end if;
  if i.status <> 'pending_approval' then raise exception 'This indent is not waiting for approval'; end if;
  select * into a from purchase.indent_approvals where indent_id = p_id and round = i.round and level = i.current_level and status = 'pending' for update;
  if not found then raise exception 'No approval step is open on this indent'; end if;
  if not exists (select 1 from unnest(a.approvers) x where lower(x) = me) then raise exception 'You are not an approver at this level'; end if;
  if lower(i.raised_by) = me then raise exception 'You cannot decide an indent you raised yourself'; end if;
  if not p_approve and btrim(coalesce(p_remark, '')) = '' then raise exception 'Give a reason for rejecting'; end if;

  perform set_config('purchase.in_fn', '1', true);
  update purchase.indent_approvals set status = case when p_approve then 'approved' else 'rejected' end,
         acted_by = me, acted_at = now(), remark = nullif(btrim(coalesce(p_remark, '')), '') where id = a.id;
  if p_approve then
    select min(level) into v_next from purchase.indent_approvals where indent_id = p_id and round = i.round and status = 'waiting';
    if v_next is null then
      update purchase.indents set status = 'approved', current_level = 0, approved_at = now() where id = p_id;
      insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('indent', p_id, me, 'approved', nullif(btrim(coalesce(p_remark, '')), ''));
      return 'approved';
    end if;
    update purchase.indent_approvals set status = 'pending' where indent_id = p_id and round = i.round and level = v_next;
    update purchase.indents set current_level = v_next where id = p_id;
    insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('indent', p_id, me, 'approved level ' || a.level, nullif(btrim(coalesce(p_remark, '')), ''));
    return 'pending_approval';
  end if;
  update purchase.indents set status = 'rejected', current_level = 0 where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('indent', p_id, me, 'rejected', btrim(p_remark));
  return 'rejected';
end $fn$;

-- Closes an approved indent when nothing is left to order (every line fully ordered or short closed).
create or replace function purchase.indent_refresh(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
begin
  perform set_config('purchase.in_fn', '1', true);
  update purchase.indents i set status = 'closed', closed_at = now(),
         closed_kind = case when exists (select 1 from purchase.indent_lines l where l.indent_id = i.id and l.short_closed_qty > 0) then 'short_closed' else 'fulfilled' end
   where i.id = p_id and i.status = 'approved'
     and not exists (select 1 from purchase.indent_lines l where l.indent_id = i.id and l.qty - l.ordered_qty - l.short_closed_qty > 0);
end $fn$;
revoke all on function purchase.indent_refresh(bigint) from public, anon, authenticated;

create or replace function purchase.indent_short_close(p_id bigint, p_line_ids bigint[], p_reason text) returns int
 language plpgsql security definer set search_path = purchase, public as $fn$
declare i purchase.indents; me text := lower(coalesce(app.current_user_email(), '')); n int;
begin
  if me = '' then raise exception 'not signed in'; end if;
  if app.is_customer() then raise exception 'not allowed'; end if;
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
  return n;
end $fn$;

revoke all on function purchase.indent_submit(bigint) from public, anon;
revoke all on function purchase.indent_decide(bigint, boolean, text) from public, anon;
revoke all on function purchase.indent_short_close(bigint, bigint[], text) from public, anon;
grant execute on function purchase.indent_submit(bigint) to authenticated;
grant execute on function purchase.indent_decide(bigint, boolean, text) to authenticated;
grant execute on function purchase.indent_short_close(bigint, bigint[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: staff only. Approvals and the log are read-only from the browser; the functions write them.
-- ---------------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array['approval_chains','indents','indent_lines'] loop
    execute format('alter table purchase.%I enable row level security', t);
    execute format('drop policy if exists %I on purchase.%I', t || '_staff_all', t);
    execute format('create policy %I on purchase.%I for all to authenticated using ((select not app.is_customer())) with check ((select not app.is_customer()))', t || '_staff_all', t);
    execute format('grant select, insert, update, delete on purchase.%I to authenticated', t);
  end loop;
  foreach t in array array['indent_approvals','doc_log','doc_counters'] loop
    execute format('alter table purchase.%I enable row level security', t);
    execute format('drop policy if exists %I on purchase.%I', t || '_staff_read', t);
    execute format('create policy %I on purchase.%I for select to authenticated using ((select not app.is_customer()))', t || '_staff_read', t);
  end loop;
  grant select on purchase.indent_approvals, purchase.doc_log to authenticated;
end $rls$;
grant usage, select on all sequences in schema purchase to authenticated;

insert into public.erp_feature_catalog(module_id, module_label, tab, feature, feature_key, sort, active) values
('inventory','Inventory','Indents','View indents','inventory.indents.view_indents',508,true)
on conflict (feature_key) do nothing;
