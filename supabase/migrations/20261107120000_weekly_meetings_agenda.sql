-- WEEKLY STATUS: THE TIMED MEETING AGENDA, THE KPI TABLE, AND OBSTACLES & OPPORTUNITIES.
--
-- A meeting can run on a timed agenda (chosen when it is started or scheduled):
--   Personal & professional wins 5 · Core values & purpose 5 · Quarterly #1 goal 1 ·
--   Quarterly priorities 5 · KPIs 5 · Upcoming important events 5 · To-dos 5 ·
--   Opportunities & obstacles 30   (minutes; each step can be left out or retimed)
-- The timer moves to the next step by itself when a step's time is up.
--
--   agenda        {"items":[{"k":"wins","mins":5,"on":true}, ...]}  - the steps, in order
--   agenda_run    {"idx":0,"at":<ms>,"paused":false,"left":<sec>}  - where the timer is
--   agenda_notes  {"events":"...","todos":"..."}                    - notes kept for a step
--   kpi_cols      [{"id":"c1","name":"Bookings"}, ...]              - the KPI table's columns
--   kpi_vals      {"<person>":{"c1":"14"}, ...}                      - its values, by person
--   has_oo, obstacles, opportunities                                 - the two O&O notes boxes
-- KPI notes stay in kpi_notes. A new meeting takes its KPI columns from the last meeting of the
-- same kind, so the table keeps its shape week to week.

alter table ops.meetings add column if not exists has_oo boolean not null default false;
alter table ops.meetings add column if not exists obstacles text;
alter table ops.meetings add column if not exists opportunities text;
alter table ops.meetings add column if not exists agenda jsonb;
alter table ops.meetings add column if not exists agenda_run jsonb;
alter table ops.meetings add column if not exists agenda_notes jsonb not null default '{}'::jsonb;
alter table ops.meetings add column if not exists kpi_cols jsonb not null default '[]'::jsonb;
alter table ops.meetings add column if not exists kpi_vals jsonb not null default '{}'::jsonb;

drop function if exists public.ops_weekly_meetings();
create function public.ops_weekly_meetings()
returns table(id bigint, meeting_date date, kind text, note text, attendees text[], item_count integer,
              done_count integer, open_count integer, start_time time,
              has_kpi boolean, kpi_notes text, acc_meeting_id bigint, invitees text[],
              has_oo boolean, obstacles text, opportunities text,
              agenda jsonb, agenda_run jsonb, agenda_notes jsonb, kpi_cols jsonb, kpi_vals jsonb)
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
         m.agenda, m.agenda_run, m.agenda_notes, m.kpi_cols, m.kpi_vals
    from ops.meetings m
   where app.has_module('weekly_status')
   order by m.meeting_date desc, m.start_time desc nulls last, m.id desc
$function$;

-- Same as before, plus p_oo, p_agenda and p_run (the timer, when the meeting is started now).
drop function if exists public.ops_meeting_create(text, date, time, text[], text[], boolean);
drop function if exists public.ops_meeting_create(text, date, time, text[], text[], boolean, boolean);
create or replace function public.ops_meeting_create(p_kind text, p_date date, p_time time default null,
                                                     p_people text[] default '{}', p_names text[] default '{}',
                                                     p_kpi boolean default false, p_oo boolean default false,
                                                     p_agenda jsonb default null, p_run jsonb default null)
returns bigint language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_id bigint; v_acc bigint; v_me text := lower(app.current_user_email());
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
  v_start time := coalesce(p_time, date_trunc('minute', (now() at time zone 'Asia/Kolkata'))::time);
  v_kind text := btrim(coalesce(p_kind,''));
  v_people text[];
  v_cols jsonb;
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  if v_kind = '' then raise exception 'Choose which meeting this is'; end if;
  select coalesce(array_agg(distinct lower(btrim(e))), '{}') into v_people
    from unnest(coalesce(p_people,'{}')) e where nullif(btrim(e),'') is not null and lower(btrim(e)) <> v_me;
  select m.kpi_cols into v_cols from ops.meetings m
   where m.kind = v_kind and jsonb_array_length(m.kpi_cols) > 0
   order by m.meeting_date desc, m.id desc limit 1;

  insert into ops.meetings(meeting_date, kind, start_time, created_by, has_kpi, has_oo, agenda, agenda_run, kpi_cols)
  values (v_date, v_kind, v_start, v_me, coalesce(p_kpi,false), coalesce(p_oo,false), p_agenda, p_run, coalesce(v_cols,'[]'::jsonb))
  returning id into v_id;
  insert into ops.attendees(meeting_id, person)
  select v_id, btrim(n) from unnest(coalesce(p_names,'{}')) n where nullif(btrim(n),'') is not null;

  insert into acc.meetings(title, meeting_date, start_time, end_time, mode, recur_type, created_by)
  values (v_kind, v_date, v_start,
          (v_start + make_interval(mins => greatest(60, coalesce((select sum((x->>'mins')::int) from jsonb_array_elements(p_agenda->'items') x where (x->>'on')::boolean), 0)::int)))::time,
          'offline', 'none', v_me)
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

create or replace function public.ops_meeting_set_oo(p_meeting bigint, p_on boolean)
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  update ops.meetings set has_oo = coalesce(p_on, has_oo) where id = p_meeting;
  if not found then raise exception 'That meeting no longer exists'; end if;
end;
$function$;

-- One notes box at a time: obstacles or opportunities.
create or replace function public.ops_meeting_set_note(p_meeting bigint, p_field text, p_value text)
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  if p_field = 'obstacles' then update ops.meetings set obstacles = p_value where id = p_meeting;
  elsif p_field = 'opportunities' then update ops.meetings set opportunities = p_value where id = p_meeting;
  else raise exception 'Unknown notes box'; end if;
  if not found then raise exception 'That meeting no longer exists'; end if;
end;
$function$;

-- The agenda's steps (order, minutes, on/off), and the KPI/O&O switches that follow from them.
create or replace function public.ops_meeting_set_agenda(p_meeting bigint, p_agenda jsonb)
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  update ops.meetings set agenda = p_agenda,
         has_kpi = coalesce((select bool_or((x->>'on')::boolean) from jsonb_array_elements(p_agenda->'items') x where x->>'k' = 'kpi'), has_kpi),
         has_oo  = coalesce((select bool_or((x->>'on')::boolean) from jsonb_array_elements(p_agenda->'items') x where x->>'k' = 'oo'), has_oo)
   where id = p_meeting;
  if not found then raise exception 'That meeting no longer exists'; end if;
end;
$function$;

-- Where the timer is: started, paused, moved on.
create or replace function public.ops_meeting_set_run(p_meeting bigint, p_run jsonb)
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  update ops.meetings set agenda_run = p_run where id = p_meeting;
  if not found then raise exception 'That meeting no longer exists'; end if;
end;
$function$;

-- A step's notes (upcoming events, to-dos), one box at a time.
create or replace function public.ops_meeting_set_agenda_note(p_meeting bigint, p_key text, p_value text)
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  if p_key not in ('events','todos') then raise exception 'Unknown notes box'; end if;
  update ops.meetings set agenda_notes = coalesce(agenda_notes,'{}'::jsonb) || jsonb_build_object(p_key, p_value) where id = p_meeting;
  if not found then raise exception 'That meeting no longer exists'; end if;
end;
$function$;

-- The KPI table: its columns, and one cell at a time.
create or replace function public.ops_meeting_set_kpi_cols(p_meeting bigint, p_cols jsonb)
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  if jsonb_typeof(p_cols) <> 'array' then raise exception 'Columns must be a list'; end if;
  update ops.meetings set kpi_cols = p_cols where id = p_meeting;
  if not found then raise exception 'That meeting no longer exists'; end if;
end;
$function$;

create or replace function public.ops_meeting_set_kpi_cell(p_meeting bigint, p_person text, p_col text, p_value text)
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  update ops.meetings
     set kpi_vals = coalesce(kpi_vals,'{}'::jsonb)
                    || jsonb_build_object(p_person, coalesce(kpi_vals->p_person,'{}'::jsonb) || jsonb_build_object(p_col, p_value))
   where id = p_meeting;
  if not found then raise exception 'That meeting no longer exists'; end if;
end;
$function$;

revoke all on function public.ops_meeting_create(text,date,time,text[],text[],boolean,boolean,jsonb,jsonb),
  public.ops_meeting_set_oo(bigint,boolean), public.ops_meeting_set_note(bigint,text,text),
  public.ops_meeting_set_agenda(bigint,jsonb), public.ops_meeting_set_run(bigint,jsonb),
  public.ops_meeting_set_agenda_note(bigint,text,text), public.ops_meeting_set_kpi_cols(bigint,jsonb),
  public.ops_meeting_set_kpi_cell(bigint,text,text,text) from public, anon;
grant execute on function public.ops_meeting_create(text,date,time,text[],text[],boolean,boolean,jsonb,jsonb),
  public.ops_meeting_set_oo(bigint,boolean), public.ops_meeting_set_note(bigint,text,text),
  public.ops_meeting_set_agenda(bigint,jsonb), public.ops_meeting_set_run(bigint,jsonb),
  public.ops_meeting_set_agenda_note(bigint,text,text), public.ops_meeting_set_kpi_cols(bigint,jsonb),
  public.ops_meeting_set_kpi_cell(bigint,text,text,text), public.ops_weekly_meetings() to authenticated;
