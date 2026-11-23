-- WEEKLY STATUS: ANY LINE WRITTEN IN A MEETING CAN BE RE-WORDED, NOT ONLY AN UNASSIGNED DRAFT.
-- ops_item_set_text used to change only drafts (`and is_draft`). A line that has become a task, or a
-- line imported from the minutes sheet, can now be re-worded too. The guard is unchanged: only someone
-- who may change the meeting (app.ws_can_edit - its starter, its editors, the owner). For a task the
-- page renames the Accountability task itself first, under Accountability's own rule (only the person
-- who assigned it), and then this keeps the meeting's line in step.

create or replace function public.ops_item_set_text(p_id bigint, p_item text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not coalesce(app.ws_can_edit((select i.meeting_id from ops.items i where i.id = p_id)), false) then raise exception 'Only the person who started this meeting can change it'; end if;
  if nullif(btrim(coalesce(p_item,'')),'') is null then raise exception 'Type a title'; end if;
  update ops.items set item = btrim(p_item), updated_at = now(), updated_by = app.current_user_email()
   where id = p_id;
  if not found then raise exception 'That line no longer exists'; end if;
end;
$function$;
