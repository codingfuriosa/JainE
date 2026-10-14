-- CORRECTING AND REMOVING A NOTICE.
--
-- Both go through functions rather than letting the page write to the table, for two reasons:
-- the people who use this screen hold the Legal module but not necessarily an `acc` write role,
-- so the table's own write policy would refuse them; and deleting a notice touches four tables,
-- which belongs in one statement rather than four round trips that can half-fail.
--
-- Who may do either: acc.legal_notice_can_see() - the same gate as the tracker itself. If you can
-- see the notice you may correct it, because the whole point of correcting is that the model read
-- something wrong and the person looking at it can see that.

-- ---------------------------------------------------------------------------------------------
-- EDIT - fix what the model got wrong.
-- The task's NAME is rebuilt from the header, because "Legal Notice - <sender>" is how the Legal
-- team find it; leaving a corrected notice attached to a task still carrying the wrong sender
-- would be worse than not correcting it at all. The task's description is left alone - it is a
-- record of what was read at the time, and the tracker is where the current truth lives.
create or replace function acc.legal_notice_edit(
  p_id      bigint,
  p_header  text,
  p_type    text,
  p_parties text[],
  p_subject text
)
returns boolean
language plpgsql
security definer
set search_path to 'acc','public'
as $function$
declare v_task bigint; v_hdr text;
begin
  if not acc.legal_notice_can_see() then
    raise exception 'not allowed to edit legal notices';
  end if;

  v_hdr := nullif(btrim(coalesce(p_header,'')), '');
  if v_hdr is null then
    raise exception 'a notice needs a sender - clear the other fields instead if it is unreadable';
  end if;

  update acc.legal_notices
     set header      = v_hdr,
         notice_type = nullif(btrim(coalesce(p_type,'')),''),
         parties     = coalesce(p_parties, '{}'::text[]),
         subject     = nullif(btrim(coalesce(p_subject,'')),'')
   where id = p_id
  returning task_id into v_task;

  if not found then return false; end if;

  if v_task is not null then
    update acc.ptasks set title = 'Legal Notice - ' || v_hdr where id = v_task;
    insert into acc.ptask_activity (task_id, action, detail)
    values (v_task, 'edited', 'Notice details corrected by ' || coalesce(app.current_user_email(),'someone'));
  end if;

  return true;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- DELETE - remove the notice, its task and the document record together.
--
-- All three go, because on this screen they are one thing: the row IS the uploaded file. Leaving
-- the document behind would also leave it in the Legal Notice folder, where it is not re-queued
-- (the trigger fires on upload, not on existing rows) and so would sit there unread for ever,
-- which is worse than either keeping it or removing it properly.
--
-- The FILE IN S3 IS NOT TOUCHED. Nothing else in JAIN-E deletes from the bucket either, and
-- doing it here would be the one place a mis-click destroys something unrecoverable. The storage
-- key is returned with each row, so a deletion can be undone by hand if it has to be.
create or replace function acc.legal_notice_delete(p_ids bigint[])
returns table(deleted_notice bigint, deleted_task bigint, deleted_document bigint, storage_path text)
language plpgsql
security definer
set search_path to 'acc','doc','public'
as $function$
declare r record;
begin
  if not acc.legal_notice_can_see() then
    raise exception 'not allowed to delete legal notices';
  end if;
  if p_ids is null or array_length(p_ids,1) is null then return; end if;

  for r in
    select n.id as nid, n.task_id, n.document_id, d.storage_path as sp
    from acc.legal_notices n
    left join doc.documents d on d.id = n.document_id
    where n.id = any(p_ids)
  loop
    if r.task_id is not null then
      delete from acc.ptask_activity  where task_id = r.task_id;
      delete from acc.ptask_assignees where task_id = r.task_id;
      delete from acc.ptask_comments  where task_id = r.task_id;
      delete from acc.ptasks          where id = r.task_id and source = 'notice';
    end if;
    -- The notice row would go with the document by its own cascade, but it is removed explicitly
    -- so that a notice whose document was already deleted still disappears from the tracker.
    delete from acc.legal_notices where id = r.nid;
    if r.document_id is not null then
      delete from doc.documents where id = r.document_id;
    end if;

    deleted_notice := r.nid; deleted_task := r.task_id;
    deleted_document := r.document_id; storage_path := r.sp;
    return next;
  end loop;
end;
$function$;

revoke all on function acc.legal_notice_edit(bigint,text,text,text[],text) from public, anon;
revoke all on function acc.legal_notice_delete(bigint[])                   from public, anon;
grant execute on function acc.legal_notice_edit(bigint,text,text,text[],text) to authenticated, service_role;
grant execute on function acc.legal_notice_delete(bigint[])                   to authenticated, service_role;
