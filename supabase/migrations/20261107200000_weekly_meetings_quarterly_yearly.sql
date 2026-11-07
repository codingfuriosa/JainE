-- WEEKLY STATUS: MEETINGS THAT REPEAT QUARTERLY OR YEARLY.
--
-- Quarterly = every 3 months on the first meeting's day of the month; yearly = every year on the same
-- day and month. (Months without that day are skipped, and a 29 Feb meeting only falls in leap years.)
--
-- Accountability's calendar only knows daily / weekly / monthly repeats, so a quarterly or yearly
-- series does not get one repeating calendar entry. Instead each date gets its own one-time entry,
-- with its invite, when ops_meeting_series_fill() makes that date (two weeks ahead). Each date's
-- ops.meetings row points at its own entry; the series itself has none. Stopping the series removes
-- the entries of the coming dates it removes.

alter table ops.meeting_series drop constraint if exists meeting_series_recur_check;
alter table ops.meeting_series add constraint meeting_series_recur_check
  check (recur in ('daily','weekly','monthly','quarterly','yearly'));

create or replace function ops.series_on(s ops.meeting_series, d date)
returns boolean language sql immutable as $$
  select d >= s.start_date and case s.recur
    when 'daily'     then true
    when 'weekly'    then extract(dow from d) = extract(dow from s.start_date)
    when 'monthly'   then extract(day from d) = extract(day from s.start_date)
    when 'quarterly' then extract(day from d) = extract(day from s.start_date)
                          and ((extract(year from d) - extract(year from s.start_date)) * 12
                               + extract(month from d) - extract(month from s.start_date))::int % 3 = 0
    when 'yearly'    then extract(day from d) = extract(day from s.start_date)
                          and extract(month from d) = extract(month from s.start_date)
    else false
  end
$$;

-- How a repeat reads in an invite.
create or replace function ops.ord(n int) returns text language sql immutable as $$
  select case when n % 100 in (11,12,13) then 'th' when n % 10 = 1 then 'st' when n % 10 = 2 then 'nd' when n % 10 = 3 then 'rd' else 'th' end
$$;
create or replace function ops.recur_words(p_recur text, d date)
returns text language sql immutable as $$
  select case p_recur
    when 'daily'     then 'Every day'
    when 'weekly'    then 'Every '||trim(to_char(d,'Day'))
    when 'monthly'   then 'Monthly on the '||extract(day from d)::int||ops.ord(extract(day from d)::int)
    when 'quarterly' then 'Every 3 months on the '||extract(day from d)::int||ops.ord(extract(day from d)::int)
    when 'yearly'    then 'Every year on '||extract(day from d)::int||' '||trim(to_char(d,'Month'))
    else to_char(d,'DD Mon YYYY') end
$$;

-- One one-time calendar entry for a date of a quarterly / yearly series, with its invitees.
create or replace function ops.series_calendar_entry(s ops.meeting_series, d date)
returns bigint language plpgsql security definer set search_path to 'public'
as $function$
declare v_acc bigint; v_start time := coalesce(s.start_time, '10:00'::time);
begin
  insert into acc.meetings(title, meeting_date, start_time, end_time, mode, recur_type, created_by)
  values (s.kind, d, v_start,
          (v_start + make_interval(mins => greatest(60, coalesce((select sum((x->>'mins')::int) from jsonb_array_elements(s.agenda->'items') x where (x->>'on')::boolean), 0)::int)))::time,
          'offline', 'none', coalesce(s.created_by, 'system'))
  returning id into v_acc;
  if array_length(s.people,1) > 0 then
    insert into acc.meeting_attendees(meeting_id, email) select v_acc, e from unnest(s.people) e on conflict do nothing;
    insert into acc.notifications(recipient, kind, title, body)
    select e, 'meeting', 'Meeting invite: '||s.kind,
           to_char(d,'DD Mon YYYY')||' · '||to_char(v_start,'HH12:MI AM')||' ('||lower(ops.recur_words(s.recur, s.start_date))||') — invited by '||
           coalesce((select full_name from acc.people() p where lower(p.email) = lower(s.created_by)), s.created_by)
      from unnest(s.people) e;
  end if;
  return v_acc;
end;
$function$;
revoke all on function ops.series_calendar_entry(ops.meeting_series, date) from public, anon, authenticated;

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
        insert into ops.meetings(meeting_date, kind, start_time, created_by, has_kpi, has_oo, agenda, kpi_cols, acc_meeting_id, series_id)
        values (d, s.kind, s.start_time, s.created_by, s.has_kpi, s.has_oo, s.agenda, coalesce(v_cols,'[]'::jsonb), v_acc, s.id)
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

-- Create: quarterly and yearly accepted; their first date gets a one-time calendar entry.
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
  v_cal text;   -- what the calendar entry itself repeats as
  v_people text[]; v_names text[];
  v_cols jsonb;
begin
  if not app.has_module('weekly_status') then raise exception 'Weekly Status is not one of your modules'; end if;
  if v_kind = '' then raise exception 'Choose which meeting this is'; end if;
  if v_recur not in ('none','daily','weekly','monthly','quarterly','yearly') then raise exception 'Choose how often it repeats'; end if;
  v_cal := case when v_recur in ('quarterly','yearly') then 'none' else v_recur end;
  select coalesce(array_agg(distinct lower(btrim(e))), '{}') into v_people
    from unnest(coalesce(p_people,'{}')) e where nullif(btrim(e),'') is not null and lower(btrim(e)) <> v_me;
  select coalesce(array_agg(btrim(n)), '{}') into v_names from unnest(coalesce(p_names,'{}')) n where nullif(btrim(n),'') is not null;
  select m.kpi_cols into v_cols from ops.meetings m
   where m.kind = v_kind and jsonb_array_length(m.kpi_cols) > 0
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

-- Stop: also removes the one-time calendar entries of the coming dates it removes.
create or replace function public.ops_meeting_series_stop(p_series bigint)
returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_acc bigint; v_gone int; v_accs bigint[]; v_today date := (now() at time zone 'Asia/Kolkata')::date;
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
    returning m.acc_meeting_id)
  select count(*), array_agg(acc_meeting_id) filter (where acc_meeting_id is not null) into v_gone, v_accs from gone;
  if v_acc is not null then delete from acc.meetings where id = v_acc;
  elsif v_accs is not null then delete from acc.meetings where id = any(v_accs); end if;
  return v_gone;
end;
$function$;

revoke all on function public.ops_meeting_series_fill(), public.ops_meeting_series_stop(bigint),
  public.ops_meeting_create(text,date,time,text[],text[],boolean,boolean,jsonb,jsonb,text) from public, anon;
grant execute on function public.ops_meeting_series_fill(), public.ops_meeting_series_stop(bigint),
  public.ops_meeting_create(text,date,time,text[],text[],boolean,boolean,jsonb,jsonb,text) to authenticated;
