-- JainE-Meetings, 24 Nov 2026: tasks in the To-dos lists.
-- Every task given in a meeting also shows in that meeting's To-dos tab, under "Target for the coming week"
-- unless it was put under "Trying for the coming week" - when it was typed, or by dragging it there later.
-- The list a line belongs to is kept on the line (ops.items.todo_section; empty = Target). Only whoever may
-- change the meeting (app.ws_can_edit: the starter, its editors, the owner) can move it.

alter table ops.items add column if not exists todo_section text;
alter table ops.items drop constraint if exists items_todo_section_check;
alter table ops.items add constraint items_todo_section_check check (todo_section is null or todo_section in ('target','trying'));

create or replace function public.ops_item_set_section(p_id bigint, p_section text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not coalesce(app.ws_can_edit((select i.meeting_id from ops.items i where i.id = p_id)), false) then
    raise exception 'Only the person who started this meeting (or its editor) can change it';
  end if;
  if p_section is not null and p_section not in ('target','trying') then raise exception 'Target or Trying?'; end if;
  update ops.items set todo_section = p_section where id = p_id;
  if not found then raise exception 'That task no longer exists'; end if;
end;
$function$;
grant execute on function public.ops_item_set_section(bigint, text) to authenticated;

-- The tasks read gains the list (last column). Its return type changes, so it is dropped and made again.
drop function if exists public.ops_weekly_items();
create function public.ops_weekly_items()
returns table(id bigint, meeting_id bigint, meeting_date date, kind text, project text, project_raw text, item text, owner text, owner_raw text, due_date date, due_raw text, comments text, status text, done_at timestamp with time zone, done_by text, updated_by text, created_at timestamp with time zone, ptask_id bigint, is_draft boolean, task_status text, task_approval text, task_due date, task_recur jsonb, task_delegator text, task_completed_at timestamp with time zone, task_approved_at timestamp with time zone, task_assignees text[], todo_section text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select i.id, i.meeting_id, m.meeting_date, m.kind,
         coalesce(nullif(btrim(i.project),''), 'General'),
         nullif(btrim(coalesce(i.project_raw,'')),''),
         i.item, i.owner, i.owner_raw, i.due_date, i.due_raw, i.comments, i.status,
         i.done_at, i.done_by, i.updated_by, i.created_at,
         i.ptask_id, i.is_draft,
         t.status, t.approval_state, t.due_date, t.recur, t.delegator, t.completed_at, t.approved_at,
         coalesce((select array_agg(a.email order by a.email) from acc.ptask_assignees a where a.task_id = t.id), '{}'),
         i.todo_section
    from ops.items i
    join ops.meetings m on m.id = i.meeting_id
    left join acc.ptasks t on t.id = i.ptask_id
   where app.ws_can_see(m.id)
   order by m.meeting_date desc, i.source_row, i.id
$function$;
grant execute on function public.ops_weekly_items() to authenticated;
