-- WEEKLY STATUS: SCHEDULE A MEETING AHEAD OF TIME.
-- A meeting can now be put in the diary for a later day with a start time. The time is optional:
-- the 29 meetings imported from the sheet never had one, and a meeting started on the spot does
-- not need one either.

alter table ops.meetings add column if not exists start_time time;

drop function if exists public.ops_weekly_meetings();
create function public.ops_weekly_meetings()
returns table(id bigint, meeting_date date, kind text, note text, attendees text[], item_count integer,
              done_count integer, open_count integer, start_time time)
language sql stable security definer set search_path to 'public'
as $function$
  select m.id, m.meeting_date, m.kind, m.note,
         coalesce((select array_agg(a.person order by a.person) from ops.attendees a where a.meeting_id = m.id), '{}'),
         (select count(*)::int from ops.items i where i.meeting_id = m.id),
         (select count(*)::int from ops.items i where i.meeting_id = m.id and i.status = 'done'),
         (select count(*)::int from ops.items i where i.meeting_id = m.id and i.status <> 'done'),
         m.start_time
    from ops.meetings m
   where app.has_module('weekly_status')
   order by m.meeting_date desc, m.start_time desc nulls last, m.id desc
$function$;

-- Start now (today, no time) and Schedule (any day, with a time) are the same write.
drop function if exists public.ops_meeting_create(text, date);
create or replace function public.ops_meeting_create(p_kind text, p_date date, p_time time default null)
returns bigint language plpgsql security definer set search_path to 'public'
as $function$
declare v_id bigint;
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  if nullif(btrim(coalesce(p_kind,'')),'') is null then raise exception 'Choose which meeting this is'; end if;
  insert into ops.meetings(meeting_date, kind, start_time, created_by)
  values (coalesce(p_date, current_date), btrim(p_kind), p_time, app.current_user_email())
  returning id into v_id;
  return v_id;
end;
$function$;

revoke all on function public.ops_meeting_create(text,date,time) from public, anon;
grant execute on function public.ops_meeting_create(text,date,time), public.ops_weekly_meetings() to authenticated;
