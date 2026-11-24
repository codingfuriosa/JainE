-- JainE-Meetings, 24 Nov 2026: a third To-dos section, "Future work" (section 'future'), beside Target
-- and Trying for the coming week - for tasks (ops.items.todo_section) and typed to-dos (ops.meeting_notes).
-- Same rules as the other two: only whoever may change the meeting can add to it or move into it.

alter table ops.items drop constraint if exists items_todo_section_check;
alter table ops.items add constraint items_todo_section_check check (todo_section is null or todo_section in ('target','trying','future'));

alter table ops.meeting_notes drop constraint if exists meeting_notes_section_check;
alter table ops.meeting_notes add constraint meeting_notes_section_check
  check (section = any (array['obstacle','opportunity','target','trying','future']));

create or replace function public.ops_item_set_section(p_id bigint, p_section text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not coalesce(app.ws_can_edit((select i.meeting_id from ops.items i where i.id = p_id)), false) then
    raise exception 'Only the person who started this meeting (or its editor) can change it';
  end if;
  if p_section is not null and p_section not in ('target','trying','future') then raise exception 'Target, Trying or Future work?'; end if;
  update ops.items set todo_section = p_section where id = p_id;
  if not found then raise exception 'That task no longer exists'; end if;
end;
$function$;

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
  if p_section not in ('obstacle','opportunity','target','trying','future') then raise exception 'Unknown kind of note'; end if;
  insert into ops.meeting_notes(meeting_id, section, body, created_by)
  values (p_meeting, p_section, btrim(p_body), app.current_user_email()) returning id into v_id;
  return v_id;
end;
$function$;
