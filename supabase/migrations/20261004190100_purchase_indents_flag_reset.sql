-- Stage 3 follow-up: every function that lifts the indent guard (purchase.in_fn) now lowers it again
-- before it returns, instead of leaving it up for the rest of the transaction. Behaviour is otherwise
-- unchanged. In normal use each call is its own transaction so this changes nothing visible; it is
-- defence in depth for any later function that calls these from inside a longer transaction.

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
  perform set_config('purchase.in_fn', '', true);
  return v_no;
end $fn$;

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

create or replace function purchase.indent_refresh(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
begin
  perform set_config('purchase.in_fn', '1', true);
  update purchase.indents i set status = 'closed', closed_at = now(),
         closed_kind = case when exists (select 1 from purchase.indent_lines l where l.indent_id = i.id and l.short_closed_qty > 0) then 'short_closed' else 'fulfilled' end
   where i.id = p_id and i.status = 'approved'
     and not exists (select 1 from purchase.indent_lines l where l.indent_id = i.id and l.qty - l.ordered_qty - l.short_closed_qty > 0);
  perform set_config('purchase.in_fn', '', true);
end $fn$;

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
  perform set_config('purchase.in_fn', '', true);
  return n;
end $fn$;
