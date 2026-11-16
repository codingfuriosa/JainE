-- WEEKLY STATUS: EDITORS, AND EACH PERSON SEES ONLY THE MEETINGS THEY WERE IN.
--
-- Asked for on 16 Nov 2026:
--   * anyone given access is an editor (not view-only);
--   * a meeting's details are shown only to the people who were in it.
--
-- So, per meeting:
--   app.ws_sees_all()        - the owner (ops.ws_owners: businessanalyst@) sees and works on every meeting.
--   app.ws_can_see(meeting)  - the owner, or a person who was in the meeting (app.ws_participant: invited
--                              from the list, or a typed name tied to their login), or the person who
--                              started it. Seeing a meeting means being able to work on it: tasks, notes,
--                              timer, KPIs, attendance, ending it.
-- The three reads now return only the meetings a person can see - a Weekly Status module holder other
-- than the owner (Shafat, say) no longer sees everyone else's meetings. Every write that touches a
-- meeting, its tasks or its notes now asks app.ws_can_see for that meeting instead of has_module.
-- Starting or scheduling a new meeting still needs the module (ops_meeting_create keeps has_module);
-- stopping a repeating meeting is for the owner or the person who set it up.

create table if not exists ops.ws_owners (email text primary key);
alter table ops.ws_owners enable row level security;
insert into ops.ws_owners(email) values ('businessanalyst@thejaingroup.com') on conflict do nothing;

create or replace function app.ws_sees_all()
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select exists (select 1 from ops.ws_owners o
                  join adm.users u on lower(u.email) = lower(o.email) and u.active
                 where lower(o.email) = lower(app.current_user_email()))
$function$;

create or replace function app.ws_can_see(p_meeting bigint)
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select app.current_user_email() is not null and (
         app.ws_sees_all()
      or app.ws_participant(p_meeting)
      or exists (select 1 from ops.meetings m
                  join adm.users u on lower(u.email) = lower(app.current_user_email()) and u.active
                 where m.id = p_meeting and lower(m.created_by) = lower(app.current_user_email())))
$function$;
revoke all on function app.ws_sees_all(), app.ws_can_see(bigint) from public, anon;
grant execute on function app.ws_sees_all(), app.ws_can_see(bigint) to authenticated, service_role;

-- Does this login see at least one meeting? (Decides whether the tab is drawn for non-editors.)
create or replace function public.ops_ws_is_participant()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (select 1 from ops.meetings m where app.ws_can_see(m.id))
$function$;

-- The three reads: only the meetings this person can see. (The meetings read also returns who started
-- each meeting now, so the page knows who may give its tasks to themselves.)
drop function if exists public.ops_weekly_meetings();
create function public.ops_weekly_meetings()
 returns table(id bigint, meeting_date date, kind text, note text, attendees text[], item_count integer, done_count integer, open_count integer, start_time time without time zone, has_kpi boolean, kpi_notes text, acc_meeting_id bigint, invitees text[], has_oo boolean, obstacles text, opportunities text, agenda jsonb, agenda_run jsonb, agenda_notes jsonb, kpi_cols jsonb, kpi_vals jsonb, series_id bigint, recur text, series_active boolean, ended_at timestamp with time zone, ran_minutes integer, created_by text)
 language sql stable security definer set search_path to 'public'
as $function$
  select m.id, m.meeting_date, m.kind, m.note,
         coalesce((select array_agg(a.person order by a.person) from ops.attendees a where a.meeting_id = m.id), '{}'),
         (select count(*)::int from ops.items i where i.meeting_id = m.id),
         (select count(*)::int from ops.items i where i.meeting_id = m.id and i.status = 'done'),
         (select count(*)::int from ops.items i where i.meeting_id = m.id and i.status <> 'done'),
         m.start_time, m.has_kpi, m.kpi_notes, m.acc_meeting_id,
         coalesce((select array_agg(x.email order by x.email) from acc.meeting_attendees x where x.meeting_id = m.acc_meeting_id), '{}'),
         m.has_oo, m.obstacles, m.opportunities,
         m.agenda, m.agenda_run, m.agenda_notes, m.kpi_cols, m.kpi_vals,
         m.series_id, s.recur, s.active,
         m.ended_at, m.ran_minutes, m.created_by
    from ops.meetings m
    left join ops.meeting_series s on s.id = m.series_id
   where app.ws_can_see(m.id)
   order by m.meeting_date desc, m.start_time desc nulls last, m.id desc
$function$;

create or replace function public.ops_weekly_items()
 returns table(id bigint, meeting_id bigint, meeting_date date, kind text, project text, project_raw text, item text, owner text, owner_raw text, due_date date, due_raw text, comments text, status text, done_at timestamp with time zone, done_by text, updated_by text, created_at timestamp with time zone, ptask_id bigint, is_draft boolean, task_status text, task_approval text, task_due date, task_recur jsonb, task_delegator text, task_completed_at timestamp with time zone, task_approved_at timestamp with time zone, task_assignees text[])
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
   where app.ws_can_see(m.id)
   order by m.meeting_date desc, i.source_row, i.id
$function$;

create or replace function public.ops_weekly_notes()
 returns table(id bigint, meeting_id bigint, meeting_date date, start_time time without time zone, kind text, section text, body text, solved boolean, solved_at timestamp with time zone, ptask_id bigint, task_status text, task_assignees text[], created_at timestamp with time zone)
 language sql stable security definer set search_path to 'public'
as $function$
  select n.id, n.meeting_id, m.meeting_date, m.start_time, m.kind, n.section, n.body, n.solved, n.solved_at, n.ptask_id,
         t.status, coalesce((select array_agg(a.email order by a.email) from acc.ptask_assignees a where a.task_id = t.id), '{}'),
         n.created_at
    from ops.meeting_notes n
    join ops.meetings m on m.id = n.meeting_id
    left join acc.ptasks t on t.id = n.ptask_id
   where app.ws_can_see(m.id)
   order by m.meeting_date desc, n.created_at
$function$;

-- Every write on a meeting, its tasks or its notes: the has_module guard becomes "can you see this
-- meeting". Rewritten in place from each function's own definition, so nothing else in them changes.
do $migrate$
declare
  r record; d text; d2 text;
  pat constant text := 'if not app\.has_module\(''weekly_status''\) then\s+raise exception ''Weekly Status is not one of your modules'';';
begin
  for r in
    select * from (values
      ('ops_meeting_set_attendees', 'p_meeting'),
      ('ops_item_add',              'p_meeting'),
      ('ops_meeting_set_kpi',       'p_meeting'),
      ('ops_meeting_set_oo',        'p_meeting'),
      ('ops_meeting_set_note',      'p_meeting'),
      ('ops_meeting_set_agenda',    'p_meeting'),
      ('ops_meeting_set_run',       'p_meeting'),
      ('ops_meeting_set_agenda_note','p_meeting'),
      ('ops_meeting_set_kpi_cols',  'p_meeting'),
      ('ops_meeting_set_kpi_cell',  'p_meeting'),
      ('ops_meeting_end',           'p_meeting'),
      ('ops_meeting_reopen',        'p_meeting'),
      ('ops_note_add',              'p_meeting'),
      ('ops_item_link_task',        '(select i.meeting_id from ops.items i where i.id = p_id)'),
      ('ops_item_set_text',         '(select i.meeting_id from ops.items i where i.id = p_id)'),
      ('ops_item_delete_draft',     '(select i.meeting_id from ops.items i where i.id = p_id)'),
      ('ops_item_set_status',       '(select i.meeting_id from ops.items i where i.id = p_id)'),
      ('ops_item_set_due',          '(select i.meeting_id from ops.items i where i.id = p_id)'),
      ('ops_item_set_owner',        '(select i.meeting_id from ops.items i where i.id = p_id)'),
      ('ops_note_set',              '(select n.meeting_id from ops.meeting_notes n where n.id = p_id)'),
      ('ops_note_delete',           '(select n.meeting_id from ops.meeting_notes n where n.id = p_id)'),
      ('ops_note_link_task',        '(select n.meeting_id from ops.meeting_notes n where n.id = p_id)')
    ) v(fn, expr)
  loop
    select pg_get_functiondef(p.oid) into d
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if d is null then raise exception 'function % not found', r.fn; end if;
    d2 := regexp_replace(d, pat, format('if not coalesce(app.ws_can_see(%s), false) then raise exception ''That meeting is not one of yours'';', r.expr));
    if d2 = d then raise exception 'guard not found in %', r.fn; end if;
    execute d2;
  end loop;

  -- Stopping a repeating meeting: the owner, or whoever set the series up.
  select pg_get_functiondef('public.ops_meeting_series_stop(bigint)'::regprocedure) into d;
  d2 := regexp_replace(d, pat,
    'if not (app.ws_sees_all() or exists (select 1 from ops.meeting_series s where s.id = p_series and lower(s.created_by) = lower(app.current_user_email()))) then raise exception ''Only the person who set this meeting up can stop it repeating'';');
  if d2 = d then raise exception 'guard not found in ops_meeting_series_stop'; end if;
  execute d2;
end
$migrate$;

revoke all on function public.ops_weekly_meetings() from public, anon;
grant execute on function public.ops_weekly_meetings() to authenticated;
