-- WEEKLY STATUS: MEETINGS GO INTO JAINE'S CALENDAR, AND A MEETING CAN HAVE A KPI SECTION.
--
-- Starting or scheduling a meeting now also writes it to Accountability's meetings (acc.meetings +
-- acc.meeting_attendees), which is what the Calendar reads: the person who set it up sees it as the
-- organiser, everyone picked sees it as an invitee. Inserting the invitees fires JainE's own
-- meeting-mailer invite, exactly as scheduling from Accountability does. The meeting is an offline
-- one (no Google Meet), one hour long, not repeating.
--
--   acc_meeting_id - the calendar entry for this meeting (set null if it is cancelled there).
--   has_kpi        - the meeting was set up with a KPI section.
--   kpi_notes      - what was written in that section.

alter table ops.meetings add column if not exists acc_meeting_id bigint references acc.meetings(id) on delete set null;
alter table ops.meetings add column if not exists has_kpi boolean not null default false;
alter table ops.meetings add column if not exists kpi_notes text;

drop function if exists public.ops_weekly_meetings();
create function public.ops_weekly_meetings()
returns table(id bigint, meeting_date date, kind text, note text, attendees text[], item_count integer,
              done_count integer, open_count integer, start_time time,
              has_kpi boolean, kpi_notes text, acc_meeting_id bigint, invitees text[])
language sql stable security definer set search_path to 'public'
as $function$
  select m.id, m.meeting_date, m.kind, m.note,
         coalesce((select array_agg(a.person order by a.person) from ops.attendees a where a.meeting_id = m.id), '{}'),
         (select count(*)::int from ops.items i where i.meeting_id = m.id),
         (select count(*)::int from ops.items i where i.meeting_id = m.id and i.status = 'done'),
         (select count(*)::int from ops.items i where i.meeting_id = m.id and i.status <> 'done'),
         m.start_time, m.has_kpi, m.kpi_notes, m.acc_meeting_id,
         coalesce((select array_agg(x.email order by x.email) from acc.meeting_attendees x where x.meeting_id = m.acc_meeting_id), '{}')
    from ops.meetings m
   where app.has_module('weekly_status')
   order by m.meeting_date desc, m.start_time desc nulls last, m.id desc
$function$;

-- Start (today, now) and Schedule (a later day and time) are the same write.
-- p_people are the JainE people picked (emails); p_names their names, recorded as attendance.
drop function if exists public.ops_meeting_create(text, date, time);
create or replace function public.ops_meeting_create(p_kind text, p_date date, p_time time default null,
                                                     p_people text[] default '{}', p_names text[] default '{}',
                                                     p_kpi boolean default false)
returns bigint language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_id bigint; v_acc bigint; v_me text := lower(app.current_user_email());
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
  v_start time := coalesce(p_time, date_trunc('minute', (now() at time zone 'Asia/Kolkata'))::time);
  v_kind text := btrim(coalesce(p_kind,''));
  v_people text[];
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  if v_kind = '' then raise exception 'Choose which meeting this is'; end if;
  select coalesce(array_agg(distinct lower(btrim(e))), '{}') into v_people
    from unnest(coalesce(p_people,'{}')) e where nullif(btrim(e),'') is not null and lower(btrim(e)) <> v_me;

  insert into ops.meetings(meeting_date, kind, start_time, created_by, has_kpi)
  values (v_date, v_kind, v_start, v_me, coalesce(p_kpi,false))
  returning id into v_id;

  insert into ops.attendees(meeting_id, person)
  select v_id, btrim(n) from unnest(coalesce(p_names,'{}')) n where nullif(btrim(n),'') is not null;

  -- The calendar entry: the organiser sees it as theirs, the invitees through meeting_attendees.
  insert into acc.meetings(title, meeting_date, start_time, end_time, mode, recur_type, created_by)
  values (v_kind, v_date, v_start, (v_start + interval '1 hour')::time, 'offline', 'none', v_me)
  returning id into v_acc;
  update ops.meetings set acc_meeting_id = v_acc where id = v_id;

  if array_length(v_people,1) > 0 then
    insert into acc.meeting_attendees(meeting_id, email) select v_acc, e from unnest(v_people) e on conflict do nothing;
    insert into acc.notifications(recipient, kind, title, body)
    select e, 'meeting', 'Meeting invite: '||v_kind,
           to_char(v_date,'DD Mon YYYY')||' · '||to_char(v_start,'HH12:MI AM')||' — invited by '||
           coalesce((select full_name from acc.people() p where lower(p.email) = v_me), v_me)
      from unnest(v_people) e;
  end if;
  return v_id;
end;
$function$;

-- Attendance edited on the meeting: keep the calendar invitees in step when emails are given.
drop function if exists public.ops_meeting_set_attendees(bigint, text[]);
create or replace function public.ops_meeting_set_attendees(p_meeting bigint, p_people text[], p_emails text[] default null)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_acc bigint; v_me text := lower(app.current_user_email()); v_kind text; v_date date; v_start time;
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  select acc_meeting_id, kind, meeting_date, start_time into v_acc, v_kind, v_date, v_start from ops.meetings where id = p_meeting;
  if not found then raise exception 'That meeting no longer exists'; end if;
  delete from ops.attendees where meeting_id = p_meeting;
  insert into ops.attendees(meeting_id, person)
  select p_meeting, btrim(x) from unnest(coalesce(p_people,'{}')) x where nullif(btrim(x),'') is not null;

  if v_acc is not null and p_emails is not null then
    delete from acc.meeting_attendees a where a.meeting_id = v_acc
       and lower(a.email) <> all (select lower(btrim(e)) from unnest(p_emails) e);
    with added as (
      insert into acc.meeting_attendees(meeting_id, email)
      select distinct v_acc, lower(btrim(e)) from unnest(p_emails) e
       where nullif(btrim(e),'') is not null and lower(btrim(e)) <> v_me
      on conflict do nothing returning email)
    insert into acc.notifications(recipient, kind, title, body)
    select email, 'meeting', 'Meeting invite: '||v_kind,
           to_char(v_date,'DD Mon YYYY')||coalesce(' · '||to_char(v_start,'HH12:MI AM'),'')||' — invited by '||
           coalesce((select full_name from acc.people() p where lower(p.email) = v_me), v_me)
      from added;
  end if;
end;
$function$;

-- The KPI section's notes.
create or replace function public.ops_meeting_set_kpi(p_meeting bigint, p_on boolean, p_notes text)
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  update ops.meetings set has_kpi = coalesce(p_on, has_kpi), kpi_notes = p_notes where id = p_meeting;
  if not found then raise exception 'That meeting no longer exists'; end if;
end;
$function$;

revoke all on function public.ops_meeting_create(text,date,time,text[],text[],boolean),
  public.ops_meeting_set_attendees(bigint,text[],text[]), public.ops_meeting_set_kpi(bigint,boolean,text) from public, anon;
grant execute on function public.ops_meeting_create(text,date,time,text[],text[],boolean),
  public.ops_meeting_set_attendees(bigint,text[],text[]), public.ops_meeting_set_kpi(bigint,boolean,text),
  public.ops_weekly_meetings() to authenticated;
