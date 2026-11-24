-- JainE-Meetings, 24 Nov 2026.
-- 1. A meeting editor (picked as "Editor" when the starter picks the people) has the same rights as the
--    starter. app.ws_can_edit already lets editors change the meeting; the one write still limited to the
--    series creator was Stop repeating - now the creator, an editor of the series, or the owner.
-- 2. Two kinds of to-do per meeting, kept like obstacle / opportunity notes (done = solved, carried to the
--    next meeting of the same kind until done, can become a task): 'target' = target for the coming week,
--    'trying' = trying for the coming week. Only whoever may change the meeting can add, edit or tick them.

alter table ops.meeting_notes drop constraint if exists meeting_notes_section_check;
alter table ops.meeting_notes add constraint meeting_notes_section_check
  check (section = any (array['obstacle','opportunity','target','trying']));

create or replace function public.ops_note_add(p_meeting bigint, p_section text, p_body text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id bigint;
begin
  if not coalesce(app.ws_can_edit(p_meeting), false) then raise exception 'Only the person who started this meeting (or its editor) can change it'; end if;
  if nullif(btrim(coalesce(p_body,'')),'') is null then raise exception 'Write the note first'; end if;
  if p_section not in ('obstacle','opportunity','target','trying') then raise exception 'Unknown kind of note'; end if;
  insert into ops.meeting_notes(meeting_id, section, body, created_by)
  values (p_meeting, p_section, btrim(p_body), app.current_user_email()) returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.ops_meeting_series_stop(p_series bigint)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_acc bigint; v_gone int; v_accs bigint[]; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not (app.ws_sees_all() or exists (select 1 from ops.meeting_series s where s.id = p_series
            and (lower(s.created_by) = lower(app.current_user_email())
                 or lower(app.current_user_email()) = any (select lower(e) from unnest(coalesce(s.editors,'{}')) e)))) then
    raise exception 'Only the person who set this meeting up (or its editor) can stop it repeating';
  end if;
  update ops.meeting_series set active = false where id = p_series returning acc_meeting_id into v_acc;
  if not found then raise exception 'That repeating meeting no longer exists'; end if;
  with gone as (
    delete from ops.meetings m
     where m.series_id = p_series and m.meeting_date > v_today
       and not exists (select 1 from ops.items i where i.meeting_id = m.id)
       and not exists (select 1 from ops.meeting_notes n where n.meeting_id = m.id)
       and m.agenda_run is null and coalesce(m.kpi_notes,'') = '' and coalesce(m.obstacles,'') = ''
       and coalesce(m.opportunities,'') = '' and m.agenda_notes = '{}'::jsonb and m.kpi_vals = '{}'::jsonb
    returning m.acc_meeting_id)
  select count(*), array_agg(acc_meeting_id) filter (where acc_meeting_id is not null) into v_gone, v_accs from gone;
  if v_acc is not null then delete from acc.meetings where id = v_acc;
  elsif v_accs is not null then delete from acc.meetings where id = any(v_accs); end if;
  return v_gone;
end;
$function$;

-- 3. Timed agenda steps of your own: a step added to the agenda (key c_<id>, its own name and minutes)
--    keeps notes like Upcoming events, so its key is accepted here too.
create or replace function public.ops_meeting_set_agenda_note(p_meeting bigint, p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not coalesce(app.ws_can_edit(p_meeting), false) then raise exception 'Only the person who started this meeting (or its editor) can change it'; end if;
  if not (p_key in ('events','todos') or p_key ~ '^c_[a-z0-9]{1,20}$') then raise exception 'Unknown notes box'; end if;
  update ops.meetings set agenda_notes = coalesce(agenda_notes,'{}'::jsonb) || jsonb_build_object(p_key, p_value) where id = p_meeting;
  if not found then raise exception 'That meeting no longer exists'; end if;
end;
$function$;
