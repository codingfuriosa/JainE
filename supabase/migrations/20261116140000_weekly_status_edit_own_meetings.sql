-- WEEKLY STATUS: A MEETING CAN BE CHANGED ONLY BY WHOEVER STARTED IT (AND THE EDITORS THEY CHOSE).
--
-- Asked for on 16 Nov 2026, right after 20261116120000 (which this builds on):
--   * people can edit only the meetings they started, not the meetings they were just part of;
--   * when choosing people for a meeting, a person can also be made an editor of it.
--
--   app.ws_can_see(meeting)  - who SEES a meeting: the owner, anyone who was in it, whoever started it,
--                              and its editors. Unchanged apart from the editors.
--   app.ws_can_edit(meeting) - who CHANGES it: the owner (ops.ws_owners), whoever started it
--                              (ops.meetings.created_by), and the people they made editors
--                              (ops.meetings.editors). Everyone else who sees it reads it only.
-- Every write on a meeting, its tasks or its notes now asks ws_can_edit. Imported meetings from the
-- sheet have no starter, so only the owner changes them. A repeating meeting keeps its editors on the
-- series (ops.meeting_series.editors) and every new date is made with them.

alter table ops.meetings       add column if not exists editors text[] not null default '{}';
alter table ops.meeting_series add column if not exists editors text[] not null default '{}';

create or replace function app.ws_can_edit(p_meeting bigint)
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select app.current_user_email() is not null
     and exists (select 1 from adm.users u where lower(u.email) = lower(app.current_user_email()) and u.active)
     and (app.ws_sees_all()
          or exists (select 1 from ops.meetings m
                      where m.id = p_meeting
                        and (lower(m.created_by) = lower(app.current_user_email())
                             or lower(app.current_user_email()) = any (select lower(e) from unnest(m.editors) e))))
$function$;

create or replace function app.ws_can_see(p_meeting bigint)
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select app.current_user_email() is not null and (
         app.ws_can_edit(p_meeting)
      or app.ws_participant(p_meeting))
$function$;
revoke all on function app.ws_can_edit(bigint), app.ws_can_see(bigint) from public, anon;
grant execute on function app.ws_can_edit(bigint), app.ws_can_see(bigint) to authenticated, service_role;

-- Every write: "can you see it" becomes "can you change it".
do $migrate$
declare r record; d text; d2 text;
begin
  for r in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'ops\_%'
       and pg_get_functiondef(p.oid) like '%coalesce(app.ws_can_see(%'
  loop
    d := pg_get_functiondef(r.oid);
    d2 := replace(replace(d, 'coalesce(app.ws_can_see(', 'coalesce(app.ws_can_edit('),
                  '''That meeting is not one of yours''', '''Only the person who started this meeting can change it''');
    if d2 = d then raise exception 'nothing to change in %', r.proname; end if;
    execute d2;
  end loop;
end
$migrate$;

-- Choose the editors of a meeting (and of its repeating series, for the dates still to come).
create or replace function public.ops_meeting_set_editors(p_meeting bigint, p_editors text[])
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_ed text[]; v_series bigint; v_date date;
begin
  if not coalesce(app.ws_can_edit(p_meeting), false) then raise exception 'Only the person who started this meeting can change it'; end if;
  select coalesce(array_agg(distinct lower(btrim(e))), '{}') into v_ed
    from unnest(coalesce(p_editors,'{}')) e where nullif(btrim(e),'') is not null;
  update ops.meetings set editors = v_ed where id = p_meeting returning series_id, meeting_date into v_series, v_date;
  if v_series is not null then
    update ops.meeting_series set editors = v_ed where id = v_series;
    update ops.meetings set editors = v_ed where series_id = v_series and meeting_date > v_date;
  end if;
end;
$function$;
revoke all on function public.ops_meeting_set_editors(bigint,text[]) from public, anon;
grant execute on function public.ops_meeting_set_editors(bigint,text[]) to authenticated;

-- New dates of a repeating meeting carry its editors.
create or replace function public.ops_meeting_series_fill()
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare
  s ops.meeting_series; d date; v_to date := (now() at time zone 'Asia/Kolkata')::date + 13;
  v_id bigint; v_made int := 0; v_cols jsonb; v_acc bigint;
begin
  if not app.has_module('weekly_status') then return 0; end if;
  for s in select * from ops.meeting_series where active for update skip locked loop
    d := greatest(coalesce(s.filled_until + 1, s.start_date), s.start_date);
    while d <= v_to loop
      if ops.series_on(s, d) and not exists (select 1 from ops.meetings where series_id = s.id and meeting_date = d) then
        select m.kpi_cols into v_cols from ops.meetings m
         where m.kind = s.kind and jsonb_array_length(m.kpi_cols) > 0 order by m.meeting_date desc, m.id desc limit 1;
        v_acc := case when s.recur in ('quarterly','yearly') then ops.series_calendar_entry(s, d) else s.acc_meeting_id end;
        insert into ops.meetings(meeting_date, kind, start_time, created_by, has_kpi, has_oo, agenda, kpi_cols, acc_meeting_id, series_id, editors)
        values (d, s.kind, s.start_time, s.created_by, s.has_kpi, s.has_oo, s.agenda, coalesce(v_cols,'[]'::jsonb), v_acc, s.id, s.editors)
        returning id into v_id;
        insert into ops.attendees(meeting_id, person) select v_id, n from unnest(s.names) n where nullif(btrim(n),'') is not null;
        v_made := v_made + 1;
      end if;
      d := d + 1;
    end loop;
    update ops.meeting_series set filled_until = v_to where id = s.id;
  end loop;
  return v_made;
end;
$function$;

-- The meetings read also says who may change each meeting, and whether the reader may.
drop function if exists public.ops_weekly_meetings();
create function public.ops_weekly_meetings()
 returns table(id bigint, meeting_date date, kind text, note text, attendees text[], item_count integer, done_count integer, open_count integer, start_time time without time zone, has_kpi boolean, kpi_notes text, acc_meeting_id bigint, invitees text[], has_oo boolean, obstacles text, opportunities text, agenda jsonb, agenda_run jsonb, agenda_notes jsonb, kpi_cols jsonb, kpi_vals jsonb, series_id bigint, recur text, series_active boolean, ended_at timestamp with time zone, ran_minutes integer, created_by text, editors text[], can_edit boolean)
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
         m.ended_at, m.ran_minutes, m.created_by, m.editors, app.ws_can_edit(m.id)
    from ops.meetings m
    left join ops.meeting_series s on s.id = m.series_id
   where app.ws_can_see(m.id)
   order by m.meeting_date desc, m.start_time desc nulls last, m.id desc
$function$;
revoke all on function public.ops_weekly_meetings() from public, anon;
grant execute on function public.ops_weekly_meetings() to authenticated;
