-- WEEKLY STATUS: "END MEETING" ACTUALLY ENDS THE MEETING.
-- Until now End meeting only showed a summary: nothing was saved, so the meeting still read "Today"
-- with the End meeting button and the live dot, as if the click had done nothing. The end is now
-- recorded on the meeting, with how long it ran, and can be undone ("Reopen").

alter table ops.meetings add column if not exists ended_at timestamptz;
alter table ops.meetings add column if not exists ran_minutes integer;

create or replace function public.ops_meeting_end(p_meeting bigint, p_minutes integer default null)
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  update ops.meetings
     set ended_at = now(), ran_minutes = nullif(greatest(coalesce(p_minutes,0),0),0),
         agenda_run = case when agenda_run is not null and not coalesce((agenda_run->>'done')::boolean,false)
                           then jsonb_build_object('k', agenda_run->>'k', 'done', true) else agenda_run end
   where id = p_meeting;
  if not found then raise exception 'That meeting no longer exists'; end if;
end;
$function$;

create or replace function public.ops_meeting_reopen(p_meeting bigint)
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  update ops.meetings set ended_at = null, ran_minutes = null where id = p_meeting;
  if not found then raise exception 'That meeting no longer exists'; end if;
end;
$function$;

drop function if exists public.ops_weekly_meetings();
create function public.ops_weekly_meetings()
returns table(id bigint, meeting_date date, kind text, note text, attendees text[], item_count integer,
              done_count integer, open_count integer, start_time time,
              has_kpi boolean, kpi_notes text, acc_meeting_id bigint, invitees text[],
              has_oo boolean, obstacles text, opportunities text,
              agenda jsonb, agenda_run jsonb, agenda_notes jsonb, kpi_cols jsonb, kpi_vals jsonb,
              series_id bigint, recur text, series_active boolean,
              ended_at timestamptz, ran_minutes integer)
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
         m.ended_at, m.ran_minutes
    from ops.meetings m
    left join ops.meeting_series s on s.id = m.series_id
   where app.has_module('weekly_status')
   order by m.meeting_date desc, m.start_time desc nulls last, m.id desc
$function$;

revoke all on function public.ops_meeting_end(bigint,integer), public.ops_meeting_reopen(bigint) from public, anon;
grant execute on function public.ops_meeting_end(bigint,integer), public.ops_meeting_reopen(bigint),
  public.ops_weekly_meetings() to authenticated;
