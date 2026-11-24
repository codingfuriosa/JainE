-- JainE-Meetings open to everyone with a staff login (2026-11-24).
-- Anyone who is an active row in adm.users can start or schedule a meeting. Everyone sees only the
-- meetings they are part of: ones they started, were made an editor of, or were picked as a person on
-- (app.ws_can_see, unchanged). The owner list (ops.ws_owners) still sees every meeting.
--
-- Privacy fixes that come with opening it up:
--  1. The direct SELECT policies on ops.meetings / ops.attendees / ops.items used to let anyone holding
--     the module read every row of those tables, past the per-meeting check in the RPCs. They now ask
--     app.ws_can_see for each row.
--  2. A new meeting copied its KPI columns (people and KPI names) from the latest meeting of the same
--     type, whoever's it was. It now copies only from a meeting the starter can see.
--  3. Repeating meetings copy KPI columns only from the same series or from meetings by the same starter.

create or replace function app.ws_is_staff()
returns boolean language sql stable security definer set search_path to '' as $$
  select app.current_user_email() is not null
     and exists (select 1 from adm.users u
                  where lower(u.email) = lower(app.current_user_email()) and u.active)
$$;
revoke all on function app.ws_is_staff() from public;
grant execute on function app.ws_is_staff() to authenticated;

-- 1. Row-level reads follow the same rule as the page.
drop policy if exists meetings_read on ops.meetings;
create policy meetings_read on ops.meetings for select using (app.ws_can_see(id));
drop policy if exists attendees_read on ops.attendees;
create policy attendees_read on ops.attendees for select using (app.ws_can_see(meeting_id));
drop policy if exists items_read on ops.items;
create policy items_read on ops.items for select using (app.ws_can_see(meeting_id));

-- 2. Anyone on the staff list can start a meeting.
create or replace function public.ops_meeting_create(p_kind text, p_date date, p_time time without time zone DEFAULT NULL::time without time zone, p_people text[] DEFAULT '{}'::text[], p_names text[] DEFAULT '{}'::text[], p_kpi boolean DEFAULT false, p_oo boolean DEFAULT false, p_agenda jsonb DEFAULT NULL::jsonb, p_run jsonb DEFAULT NULL::jsonb, p_recur text DEFAULT 'none'::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint; v_acc bigint; v_series bigint; v_me text := lower(app.current_user_email());
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
  v_start time := coalesce(p_time, date_trunc('minute', (now() at time zone 'Asia/Kolkata'))::time);
  v_kind text := btrim(coalesce(p_kind,''));
  v_recur text := coalesce(nullif(btrim(p_recur),''),'none');
  v_cal text;
  v_people text[]; v_names text[];
  v_cols jsonb;
begin
  if not app.ws_is_staff() then raise exception 'Only people with a JainE staff login can start meetings'; end if;
  if v_kind = '' then raise exception 'Choose which meeting this is'; end if;
  if v_recur not in ('none','daily','weekly','monthly','quarterly','yearly') then raise exception 'Choose how often it repeats'; end if;
  v_cal := case when v_recur in ('quarterly','yearly') then 'none' else v_recur end;
  select coalesce(array_agg(distinct lower(btrim(e))), '{}') into v_people
    from unnest(coalesce(p_people,'{}')) e where nullif(btrim(e),'') is not null and lower(btrim(e)) <> v_me;
  select coalesce(array_agg(btrim(n)), '{}') into v_names from unnest(coalesce(p_names,'{}')) n where nullif(btrim(n),'') is not null;
  select m.kpi_cols into v_cols from ops.meetings m
   where m.kind = v_kind and jsonb_array_length(m.kpi_cols) > 0 and app.ws_can_see(m.id)
   order by m.meeting_date desc, m.id desc limit 1;
  insert into acc.meetings(title, meeting_date, start_time, end_time, mode, recur_type, recur_day, recur_date, created_by)
  values (v_kind, v_date, v_start,
          (v_start + make_interval(mins => greatest(60, coalesce((select sum((x->>'mins')::int) from jsonb_array_elements(p_agenda->'items') x where (x->>'on')::boolean), 0)::int)))::time,
          'offline', v_cal,
          case when v_cal = 'weekly' then extract(dow from v_date)::smallint end,
          case when v_cal = 'monthly' then extract(day from v_date)::smallint end,
          v_me)
  returning id into v_acc;
  if v_recur <> 'none' then
    insert into ops.meeting_series(kind, recur, start_date, start_time, people, names, agenda, has_kpi, has_oo, acc_meeting_id, filled_until, created_by)
    values (v_kind, v_recur, v_date, v_start, v_people, v_names, p_agenda, coalesce(p_kpi,false), coalesce(p_oo,false),
            case when v_cal = 'none' then null else v_acc end, v_date, v_me)
    returning id into v_series;
  end if;
  insert into ops.meetings(meeting_date, kind, start_time, created_by, has_kpi, has_oo, agenda, agenda_run, kpi_cols, acc_meeting_id, series_id)
  values (v_date, v_kind, v_start, v_me, coalesce(p_kpi,false), coalesce(p_oo,false), p_agenda, p_run, coalesce(v_cols,'[]'::jsonb), v_acc, v_series)
  returning id into v_id;
  insert into ops.attendees(meeting_id, person) select v_id, n from unnest(v_names) n;
  if array_length(v_people,1) > 0 then
    insert into acc.meeting_attendees(meeting_id, email) select v_acc, e from unnest(v_people) e on conflict do nothing;
    insert into acc.notifications(recipient, kind, title, body)
    select e, 'meeting', 'Meeting invite: '||v_kind,
           ops.recur_words(v_recur, v_date)||' · '||to_char(v_start,'HH12:MI AM')||' — invited by '||
           coalesce((select full_name from acc.people() p where lower(p.email) = v_me), v_me)
      from unnest(v_people) e;
  end if;
  if v_series is not null then perform public.ops_meeting_series_fill(); end if;
  return v_id;
end;
$function$;

-- 3. Repeating meetings are filled in for everyone; KPI columns come only from the same series or starter.
create or replace function public.ops_meeting_series_fill()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s ops.meeting_series; d date; v_to date := (now() at time zone 'Asia/Kolkata')::date + 13;
  v_id bigint; v_made int := 0; v_cols jsonb; v_acc bigint;
begin
  if not app.ws_is_staff() then return 0; end if;
  for s in select * from ops.meeting_series where active for update skip locked loop
    d := greatest(coalesce(s.filled_until + 1, s.start_date), s.start_date);
    while d <= v_to loop
      if ops.series_on(s, d) and not exists (select 1 from ops.meetings where series_id = s.id and meeting_date = d) then
        select m.kpi_cols into v_cols from ops.meetings m
         where m.kind = s.kind and jsonb_array_length(m.kpi_cols) > 0
           and (m.series_id = s.id or lower(m.created_by) = lower(s.created_by))
         order by (m.series_id = s.id) desc, m.meeting_date desc, m.id desc limit 1;
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
