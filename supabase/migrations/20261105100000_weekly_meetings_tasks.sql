-- WEEKLY STATUS BECOMES THE MEETINGS PAGE.
-- The page now runs the meeting itself: tasks are typed in the room, and each one that is given a
-- person becomes a real Accountability task (acc.ptasks, delegated by whoever typed it). The 495
-- items imported from the sheet stay exactly as they are; new rows sit beside them in ops.items.
--
--   ptask_id  - the Accountability task this item became. Its status is read from the task, so a
--               task finished or approved in Accountability shows as finished here too.
--   is_draft  - typed during the meeting but not yet given a person. JainE will not create a task
--               without a member, so until then it lives only here.

alter table ops.items add column if not exists ptask_id bigint references acc.ptasks(id) on delete set null;
alter table ops.items add column if not exists is_draft boolean not null default false;
create index if not exists ops_items_ptask_id_idx on ops.items(ptask_id);

-- The read now carries everything the page needs about a linked task, so one call draws the page.
drop function if exists public.ops_weekly_items();
create function public.ops_weekly_items()
returns table(id bigint, meeting_id bigint, meeting_date date, kind text, project text, project_raw text,
              item text, owner text, owner_raw text, due_date date, due_raw text, comments text, status text,
              done_at timestamptz, done_by text, updated_by text, created_at timestamptz,
              ptask_id bigint, is_draft boolean,
              task_status text, task_approval text, task_due date, task_recur jsonb, task_delegator text,
              task_completed_at timestamptz, task_approved_at timestamptz, task_assignees text[])
language sql stable security definer set search_path to 'public'
as $function$
  select i.id, i.meeting_id, m.meeting_date, m.kind,
         coalesce(nullif(btrim(i.project),''), 'General'),
         nullif(btrim(coalesce(i.project_raw,'')),''),
         i.item, i.owner, i.owner_raw, i.due_date, i.due_raw, i.comments, i.status,
         i.done_at, i.done_by, i.updated_by, i.created_at,
         i.ptask_id, i.is_draft,
         t.status, t.approval_state, t.due_date, t.recur, t.delegator, t.completed_at, t.approved_at,
         coalesce((select array_agg(a.email order by a.email) from acc.ptask_assignees a where a.task_id = t.id), '{}')
    from ops.items i
    join ops.meetings m on m.id = i.meeting_id
    left join acc.ptasks t on t.id = i.ptask_id
   where app.has_module('weekly_status')
   order by m.meeting_date desc, i.source_row, i.id
$function$;

-- Start a meeting: one dated row of a kind (OPS, OPS & Purchase, ...). Returns its id.
create or replace function public.ops_meeting_create(p_kind text, p_date date)
returns bigint language plpgsql security definer set search_path to 'public'
as $function$
declare v_id bigint;
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  if nullif(btrim(coalesce(p_kind,'')),'') is null then raise exception 'Choose which meeting this is'; end if;
  insert into ops.meetings(meeting_date, kind, created_by)
  values (coalesce(p_date, current_date), btrim(p_kind), app.current_user_email())
  returning id into v_id;
  return v_id;
end;
$function$;

-- Who was in the room, by name, the same way the imported meetings record it.
create or replace function public.ops_meeting_set_attendees(p_meeting bigint, p_people text[])
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  if not exists (select 1 from ops.meetings where id = p_meeting) then raise exception 'That meeting no longer exists'; end if;
  delete from ops.attendees where meeting_id = p_meeting;
  insert into ops.attendees(meeting_id, person)
  select p_meeting, btrim(x) from unnest(coalesce(p_people,'{}')) x where nullif(btrim(x),'') is not null;
end;
$function$;

-- A line typed in a meeting. With p_ptask it is the record of a task just created in
-- Accountability; without, it is saved as a draft until someone is given it.
create or replace function public.ops_item_add(p_meeting bigint, p_item text, p_ptask bigint, p_owner text, p_due date)
returns bigint language plpgsql security definer set search_path to 'public'
as $function$
declare v_id bigint; v_email text := app.current_user_email();
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  if nullif(btrim(coalesce(p_item,'')),'') is null then raise exception 'Type a title'; end if;
  if not exists (select 1 from ops.meetings where id = p_meeting) then raise exception 'That meeting no longer exists'; end if;
  insert into ops.items(meeting_id, item, owner, due_date, status, ptask_id, is_draft, updated_by)
  values (p_meeting, btrim(p_item), nullif(btrim(coalesce(p_owner,'')),''), p_due, 'open', p_ptask, p_ptask is null, v_email)
  returning id into v_id;
  return v_id;
end;
$function$;

-- A draft has been given its person: link it to the Accountability task that was created for it.
create or replace function public.ops_item_link_task(p_id bigint, p_ptask bigint, p_owner text, p_due date)
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  update ops.items
     set ptask_id = p_ptask, is_draft = false, owner = nullif(btrim(coalesce(p_owner,'')),''),
         due_date = p_due, updated_at = now(), updated_by = app.current_user_email()
   where id = p_id and is_draft;
  if not found then raise exception 'That draft no longer exists'; end if;
end;
$function$;

-- Fix the wording of a draft before it is sent.
create or replace function public.ops_item_set_text(p_id bigint, p_item text)
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  if nullif(btrim(coalesce(p_item,'')),'') is null then raise exception 'Type a title'; end if;
  update ops.items set item = btrim(p_item), updated_at = now(), updated_by = app.current_user_email()
   where id = p_id and is_draft;
  if not found then raise exception 'That draft no longer exists'; end if;
end;
$function$;

-- Remove a draft. Only drafts: anything imported or already sent to Accountability stays.
create or replace function public.ops_item_delete_draft(p_id bigint)
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  delete from ops.items where id = p_id and is_draft;
  if not found then raise exception 'That draft no longer exists'; end if;
end;
$function$;

revoke all on function public.ops_meeting_create(text,date), public.ops_meeting_set_attendees(bigint,text[]),
  public.ops_item_add(bigint,text,bigint,text,date), public.ops_item_link_task(bigint,bigint,text,date),
  public.ops_item_set_text(bigint,text), public.ops_item_delete_draft(bigint) from public, anon;
grant execute on function public.ops_meeting_create(text,date), public.ops_meeting_set_attendees(bigint,text[]),
  public.ops_item_add(bigint,text,bigint,text,date), public.ops_item_link_task(bigint,bigint,text,date),
  public.ops_item_set_text(bigint,text), public.ops_item_delete_draft(bigint), public.ops_weekly_items() to authenticated;
