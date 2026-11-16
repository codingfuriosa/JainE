-- WEEKLY STATUS: MEETINGS THAT REPEAT (ONCE / DAILY / WEEKLY / MONTHLY).
--
-- Scheduling a meeting can now set how often it happens - the same four choices as JainE's own
-- meetings. A repeating meeting is a series (ops.meeting_series):
--   * one calendar entry in Accountability with recur_type daily/weekly/monthly, so it shows on every
--     date it happens in the organiser's and invitees' calendars, exactly like a repeating meeting
--     made in Accountability;
--   * one ops.meetings row per date, so each date keeps its own tasks, notes, timer and KPI values.
--     Rows are made ahead for the next two weeks (this week and next week, which is what the page
--     shows) by ops_meeting_series_fill(), which the page calls each time it opens.
-- Weekly repeats on the first meeting's weekday, monthly on its day of the month (a month without that
-- day is skipped, as in Accountability). "Stop repeating" ends the series: future dates nobody has
-- written anything on are removed, and the calendar entry is cancelled (its logs are kept).

create table if not exists ops.meeting_series (
  id            bigserial primary key,
  kind          text not null,
  recur         text not null check (recur in ('daily','weekly','monthly')),
  start_date    date not null,
  start_time    time,
  people        text[] not null default '{}',
  names         text[] not null default '{}',
  agenda        jsonb,
  has_kpi       boolean not null default false,
  has_oo        boolean not null default false,
  acc_meeting_id bigint references acc.meetings(id) on delete set null,
  filled_until  date,
  active        boolean not null default true,
  created_by    text,
  created_at    timestamptz not null default now()
);
alter table ops.meeting_series enable row level security;
alter table ops.meetings add column if not exists series_id bigint references ops.meeting_series(id) on delete set null;
create index if not exists ops_meetings_series_idx on ops.meetings(series_id, meeting_date);

-- Does the series meet on this date?
create or replace function ops.series_on(s ops.meeting_series, d date)
returns boolean language sql immutable as $$
  select d >= s.start_date and case s.recur
    when 'daily'   then true
    when 'weekly'  then extract(dow from d) = extract(dow from s.start_date)
    when 'monthly' then extract(day from d) = extract(day from s.start_date)
  end
$$;

-- Make the rows for every date of every active series up to two weeks ahead. Safe to call often.
create or replace function public.ops_meeting_series_fill()
returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare
  s ops.meeting_series; d date; v_to date := (now() at time zone 'Asia/Kolkata')::date + 13;
  v_id bigint; v_made int := 0; v_cols jsonb;
begin
  if not app.has_module('weekly_status') then return 0; end if;
  for s in select * from ops.meeting_series where active for update skip locked loop
    d := greatest(coalesce(s.filled_until + 1, s.start_date), s.start_date);
    while d <= v_to loop
      if ops.series_on(s, d) and not exists (select 1 from ops.meetings where series_id = s.id and meeting_date = d) then
        select m.kpi_cols into v_cols from ops.meetings m
         where m.kind = s.kind and jsonb_array_length(m.kpi_cols) > 0 order by m.meeting_date desc, m.id desc limit 1;
        insert into ops.meetings(meeting_date, kind, start_time, created_by, has_kpi, has_oo, agenda, kpi_cols, acc_meeting_id, series_id)
        values (d, s.kind, s.start_time, s.created_by, s.has_kpi, s.has_oo, s.agenda, coalesce(v_cols,'[]'::jsonb), s.acc_meeting_id, s.id)
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

-- Create: as before, plus p_recur. 'none' makes one meeting exactly as before.
drop function if exists public.ops_meeting_create(text, date, time, text[], text[], boolean, boolean, jsonb, jsonb);
create or replace function public.ops_meeting_create(p_kind text, p_date date, p_time time default null,
                                                     p_people text[] default '{}', p_names text[] default '{}',
                                                     p_kpi boolean default false, p_oo boolean default false,
                                                     p_agenda jsonb default null, p_run jsonb default null,
                                                     p_recur text default 'none')
returns bigint language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_id bigint; v_acc bigint; v_series bigint; v_me text := lower(app.current_user_email());
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
  v_start time := coalesce(p_time, date_trunc('minute', (now() at time zone 'Asia/Kolkata'))::time);
  v_kind text := btrim(coalesce(p_kind,''));
  v_recur text := coalesce(nullif(btrim(p_recur),''),'none');
  v_people text[]; v_names text[];
  v_cols jsonb;
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  if v_kind = '' then raise exception 'Choose which meeting this is'; end if;
  if v_recur not in ('none','daily','weekly','monthly') then raise exception 'Choose how often it repeats'; end if;
  select coalesce(array_agg(distinct lower(btrim(e))), '{}') into v_people
    from unnest(coalesce(p_people,'{}')) e where nullif(btrim(e),'') is not null and lower(btrim(e)) <> v_me;
  select coalesce(array_agg(btrim(n)), '{}') into v_names from unnest(coalesce(p_names,'{}')) n where nullif(btrim(n),'') is not null;
  select m.kpi_cols into v_cols from ops.meetings m
   where m.kind = v_kind and jsonb_array_length(m.kpi_cols) > 0
   order by m.meeting_date desc, m.id desc limit 1;

  -- The calendar entry: once, or repeating the way Accountability repeats.
  insert into acc.meetings(title, meeting_date, start_time, end_time, mode, recur_type, recur_day, recur_date, created_by)
  values (v_kind, v_date, v_start,
          (v_start + make_interval(mins => greatest(60, coalesce((select sum((x->>'mins')::int) from jsonb_array_elements(p_agenda->'items') x where (x->>'on')::boolean), 0)::int)))::time,
          'offline', v_recur,
          case when v_recur = 'weekly' then extract(dow from v_date)::smallint end,
          case when v_recur = 'monthly' then extract(day from v_date)::smallint end,
          v_me)
  returning id into v_acc;

  if v_recur <> 'none' then
    insert into ops.meeting_series(kind, recur, start_date, start_time, people, names, agenda, has_kpi, has_oo, acc_meeting_id, filled_until, created_by)
    values (v_kind, v_recur, v_date, v_start, v_people, v_names, p_agenda, coalesce(p_kpi,false), coalesce(p_oo,false), v_acc, v_date, v_me)
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
           case v_recur when 'daily' then 'Every day' when 'weekly' then 'Every '||trim(to_char(v_date,'Day'))
                        when 'monthly' then 'Monthly on the '||extract(day from v_date)::int||case when extract(day from v_date)::int in (1,21,31) then 'st' when extract(day from v_date)::int in (2,22) then 'nd' when extract(day from v_date)::int in (3,23) then 'rd' else 'th' end
                        else to_char(v_date,'DD Mon YYYY') end
           ||' · '||to_char(v_start,'HH12:MI AM')||' — invited by '||
           coalesce((select full_name from acc.people() p where lower(p.email) = v_me), v_me)
      from unnest(v_people) e;
  end if;

  if v_series is not null then perform public.ops_meeting_series_fill(); end if;
  return v_id;
end;
$function$;

-- Stop a series: no more dates, future empty ones removed, calendar entry cancelled.
create or replace function public.ops_meeting_series_stop(p_series bigint)
returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_acc bigint; v_gone int; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  update ops.meeting_series set active = false where id = p_series returning acc_meeting_id into v_acc;
  if not found then raise exception 'That repeating meeting no longer exists'; end if;
  with gone as (
    delete from ops.meetings m
     where m.series_id = p_series and m.meeting_date > v_today
       and not exists (select 1 from ops.items i where i.meeting_id = m.id)
       and m.agenda_run is null and coalesce(m.kpi_notes,'') = '' and coalesce(m.obstacles,'') = ''
       and coalesce(m.opportunities,'') = '' and m.agenda_notes = '{}'::jsonb and m.kpi_vals = '{}'::jsonb
    returning 1)
  select count(*) into v_gone from gone;
  if v_acc is not null then delete from acc.meetings where id = v_acc; end if;
  return v_gone;
end;
$function$;

drop function if exists public.ops_weekly_meetings();
create function public.ops_weekly_meetings()
returns table(id bigint, meeting_date date, kind text, note text, attendees text[], item_count integer,
              done_count integer, open_count integer, start_time time,
              has_kpi boolean, kpi_notes text, acc_meeting_id bigint, invitees text[],
              has_oo boolean, obstacles text, opportunities text,
              agenda jsonb, agenda_run jsonb, agenda_notes jsonb, kpi_cols jsonb, kpi_vals jsonb,
              series_id bigint, recur text, series_active boolean)
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
         m.series_id, s.recur, s.active
    from ops.meetings m
    left join ops.meeting_series s on s.id = m.series_id
   where app.has_module('weekly_status')
   order by m.meeting_date desc, m.start_time desc nulls last, m.id desc
$function$;

revoke all on function public.ops_meeting_create(text,date,time,text[],text[],boolean,boolean,jsonb,jsonb,text),
  public.ops_meeting_series_fill(), public.ops_meeting_series_stop(bigint) from public, anon;
grant execute on function public.ops_meeting_create(text,date,time,text[],text[],boolean,boolean,jsonb,jsonb,text),
  public.ops_meeting_series_fill(), public.ops_meeting_series_stop(bigint), public.ops_weekly_meetings() to authenticated;
