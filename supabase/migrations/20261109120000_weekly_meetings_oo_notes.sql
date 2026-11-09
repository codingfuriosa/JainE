-- WEEKLY STATUS: OBSTACLES & OPPORTUNITIES AS SEPARATE NOTES.
-- Each obstacle or opportunity is now its own note on the meeting. A note can be marked solved (or
-- back to unsolved), and can be turned into a task for someone - a real Accountability task, created
-- by the page exactly as a typed task is, then linked here. Notes still unsolved show again at the
-- next meeting of the same kind until someone marks them solved.

create table if not exists ops.meeting_notes (
  id          bigserial primary key,
  meeting_id  bigint not null references ops.meetings(id) on delete cascade,
  section     text not null check (section in ('obstacle','opportunity')),
  body        text not null,
  solved      boolean not null default false,
  solved_at   timestamptz,
  solved_by   text,
  ptask_id    bigint references acc.ptasks(id) on delete set null,
  created_by  text,
  created_at  timestamptz not null default now()
);
alter table ops.meeting_notes enable row level security;
create index if not exists ops_meeting_notes_meeting_idx on ops.meeting_notes(meeting_id);

-- Every note, with the meeting it was written in and the state of its task, if it has one.
create or replace function public.ops_weekly_notes()
returns table(id bigint, meeting_id bigint, meeting_date date, start_time time, kind text, section text, body text,
              solved boolean, solved_at timestamptz, ptask_id bigint, task_status text, task_assignees text[], created_at timestamptz)
language sql stable security definer set search_path to 'public'
as $function$
  select n.id, n.meeting_id, m.meeting_date, m.start_time, m.kind, n.section, n.body, n.solved, n.solved_at, n.ptask_id,
         t.status, coalesce((select array_agg(a.email order by a.email) from acc.ptask_assignees a where a.task_id = t.id), '{}'),
         n.created_at
    from ops.meeting_notes n
    join ops.meetings m on m.id = n.meeting_id
    left join acc.ptasks t on t.id = n.ptask_id
   where app.has_module('weekly_status')
   order by m.meeting_date desc, n.created_at
$function$;

create or replace function public.ops_note_add(p_meeting bigint, p_section text, p_body text)
returns bigint language plpgsql security definer set search_path to 'public'
as $function$
declare v_id bigint;
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  if nullif(btrim(coalesce(p_body,'')),'') is null then raise exception 'Write the note first'; end if;
  if p_section not in ('obstacle','opportunity') then raise exception 'Obstacle or opportunity?'; end if;
  insert into ops.meeting_notes(meeting_id, section, body, created_by)
  values (p_meeting, p_section, btrim(p_body), app.current_user_email()) returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.ops_note_set(p_id bigint, p_body text default null, p_solved boolean default null)
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  if p_body is not null and nullif(btrim(p_body),'') is null then raise exception 'A note cannot be empty'; end if;
  update ops.meeting_notes
     set body = coalesce(nullif(btrim(p_body),''), body),
         solved = coalesce(p_solved, solved),
         solved_at = case when p_solved is true and not solved then now() when p_solved is false then null else solved_at end,
         solved_by = case when p_solved is true and not solved then app.current_user_email() when p_solved is false then null else solved_by end
   where id = p_id;
  if not found then raise exception 'That note no longer exists'; end if;
end;
$function$;

create or replace function public.ops_note_delete(p_id bigint)
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  delete from ops.meeting_notes where id = p_id;
  if not found then raise exception 'That note no longer exists'; end if;
end;
$function$;

create or replace function public.ops_note_link_task(p_id bigint, p_ptask bigint)
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  update ops.meeting_notes set ptask_id = p_ptask where id = p_id;
  if not found then raise exception 'That note no longer exists'; end if;
end;
$function$;

revoke all on function public.ops_weekly_notes(), public.ops_note_add(bigint,text,text), public.ops_note_set(bigint,text,boolean),
  public.ops_note_delete(bigint), public.ops_note_link_task(bigint,bigint) from public, anon;
grant execute on function public.ops_weekly_notes(), public.ops_note_add(bigint,text,text), public.ops_note_set(bigint,text,boolean),
  public.ops_note_delete(bigint), public.ops_note_link_task(bigint,bigint) to authenticated;
