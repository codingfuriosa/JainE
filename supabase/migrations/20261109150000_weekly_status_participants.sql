-- Weekly Status: a person who is on a meeting can READ that meeting (view only).
--
-- Until now the whole module was for one person (app.has_module('weekly_status') ignores the
-- superadmin bypass and needs the id in the caller's own adm.users.modules). Everything the page
-- shows comes through three read functions, so the way in for a participant is those three and
-- nothing else: every write function still asks has_module and keeps refusing them, so the person
-- who starts a meeting stays the only one who can change it.
--
-- Who counts as "on a meeting":
--   1. their login email is in acc.meeting_attendees for the meeting's calendar entry
--      (ops.meetings.acc_meeting_id) - that is every person picked from the list when a meeting is
--      started or scheduled, so people added later are covered with no further step; or
--   2. a name typed on the meeting (ops.attendees.person) that is tied to their login in
--      ops.person_logins - for the older meetings, where names were typed and never had an account.
--      Shafat is the first.

create table if not exists ops.person_logins (
  person text primary key,
  email  text not null
);
alter table ops.person_logins enable row level security;
-- No policies on purpose: nobody reads this table directly, only the functions below do.

insert into ops.person_logins(person, email)
values ('Shafat', 'coordinator.vc@thejaingroup.com'),
       ('Shafat at Dream Ecocity', 'coordinator.vc@thejaingroup.com'),
       ('and Shafat', 'coordinator.vc@thejaingroup.com'),
       ('Shafat& Madhurima', 'coordinator.vc@thejaingroup.com')
on conflict (person) do update set email = excluded.email;

create or replace function app.ws_participant(p_meeting bigint)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1
      from ops.meetings m
     where m.id = p_meeting
       and app.current_user_email() is not null
       and exists (select 1 from adm.users u
                    where lower(u.email) = lower(app.current_user_email()) and u.active)
       and (
            exists (select 1 from acc.meeting_attendees a
                     where a.meeting_id = m.acc_meeting_id
                       and lower(a.email) = lower(app.current_user_email()))
         or exists (select 1 from ops.attendees t
                      join ops.person_logins l on lower(l.person) = lower(btrim(t.person))
                     where t.meeting_id = m.id
                       and lower(l.email) = lower(app.current_user_email()))
       )
  )
$function$;

-- Does this login sit on at least one meeting? The page asks once to decide whether to show the tab.
create or replace function public.ops_ws_is_participant()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from ops.meetings m where app.ws_participant(m.id))
$function$;
revoke all on function public.ops_ws_is_participant() from public, anon;
grant execute on function public.ops_ws_is_participant() to authenticated, service_role;

-- The three reads: the module holder sees everything, a participant sees only their own meetings.
create or replace function public.ops_weekly_meetings()
 returns table(id bigint, meeting_date date, kind text, note text, attendees text[], item_count integer, done_count integer, open_count integer, start_time time without time zone, has_kpi boolean, kpi_notes text, acc_meeting_id bigint, invitees text[], has_oo boolean, obstacles text, opportunities text, agenda jsonb, agenda_run jsonb, agenda_notes jsonb, kpi_cols jsonb, kpi_vals jsonb, series_id bigint, recur text, series_active boolean, ended_at timestamp with time zone, ran_minutes integer)
 language sql
 stable security definer
 set search_path to 'public'
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
         m.ended_at, m.ran_minutes
    from ops.meetings m
    left join ops.meeting_series s on s.id = m.series_id
   where app.has_module('weekly_status') or app.ws_participant(m.id)
   order by m.meeting_date desc, m.start_time desc nulls last, m.id desc
$function$;

create or replace function public.ops_weekly_items()
 returns table(id bigint, meeting_id bigint, meeting_date date, kind text, project text, project_raw text, item text, owner text, owner_raw text, due_date date, due_raw text, comments text, status text, done_at timestamp with time zone, done_by text, updated_by text, created_at timestamp with time zone, ptask_id bigint, is_draft boolean, task_status text, task_approval text, task_due date, task_recur jsonb, task_delegator text, task_completed_at timestamp with time zone, task_approved_at timestamp with time zone, task_assignees text[])
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
         coalesce((select array_agg(a.email order by a.email) from acc.ptask_assignees a where a.task_id = t.id), '{}')
    from ops.items i
    join ops.meetings m on m.id = i.meeting_id
    left join acc.ptasks t on t.id = i.ptask_id
   where app.has_module('weekly_status') or app.ws_participant(m.id)
   order by m.meeting_date desc, i.source_row, i.id
$function$;

create or replace function public.ops_weekly_notes()
 returns table(id bigint, meeting_id bigint, meeting_date date, start_time time without time zone, kind text, section text, body text, solved boolean, solved_at timestamp with time zone, ptask_id bigint, task_status text, task_assignees text[], created_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select n.id, n.meeting_id, m.meeting_date, m.start_time, m.kind, n.section, n.body, n.solved, n.solved_at, n.ptask_id,
         t.status, coalesce((select array_agg(a.email order by a.email) from acc.ptask_assignees a where a.task_id = t.id), '{}'),
         n.created_at
    from ops.meeting_notes n
    join ops.meetings m on m.id = n.meeting_id
    left join acc.ptasks t on t.id = n.ptask_id
   where app.has_module('weekly_status') or app.ws_participant(m.id)
   order by m.meeting_date desc, n.created_at
$function$;
