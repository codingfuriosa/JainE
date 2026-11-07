-- A RECEIPT ATTACHED TO A DRAFT WAS DELETED FROM THE BUCKET BEFORE THE CLAIM WAS EVER RAISED.
--
-- Uploading happens the moment a file is chosen, long before Create is pressed, so the workflow
-- form keeps a list of everything it has put into S3 and tidies up on the way out. The tidy-up is
-- the right idea: a file picked and then thought better of should not be left in the bucket.
--
-- It asks acc.wf_file_referenced() before removing anything, and that function looked in every
-- place a file can be referenced EXCEPT acc.flow_drafts. Saving a draft does not clear the form's
-- tracking list either, so the sequence was:
--
--   1. attach three receipts to a reimbursement  -> three objects in S3, three paths tracked
--   2. Save draft                                -> paths written into acc.flow_drafts
--   3. open any workflow form again              -> the tidy-up runs over the tracked paths
--   4. wf_file_referenced() checks flow_cases, flow_update_attachments, ptask_files,
--      ptask_comments and user_upi_scanner, finds nothing, and answers false
--   5. the three receipts are deleted from the bucket, while the draft still names all three
--
-- The draft then submits perfectly happily: the paths are copied into the claim's details, the
-- claim lists three attachments, and opening any of them reaches S3 for a key that is no longer
-- there. S3 answers a missing key with an XML <Error> document, which is what people were shown.
--
-- Four drafts are carrying file paths today (oldest 9 Sep, newest 31 Oct 2026); those files have
-- almost certainly already gone this way. Nothing here brings them back - it stops the next one.
--
-- acc.storage_path_in_use() is the same question asked by the task-attachment delete and the
-- Document Library delete, and it was missing even more: it knew nothing about workflow instances,
-- workflow update attachments, remembered QR codes OR drafts. Checked 4 Nov 2026, it reports a
-- live reimbursement receipt as "not in use" - that is, safe to delete. Both functions are brought
-- into line here so there is one honest answer to "does anything still want this file?".

create or replace function acc.wf_file_referenced(p_path text)
returns boolean
language sql
stable security definer
set search_path to 'acc', 'public'
as $function$
  select coalesce(p_path,'') <> ''
     and (
       exists (
         select 1
         from acc.flow_cases c, jsonb_array_elements(c.trigger_details::jsonb) d
         where position(p_path in coalesce(d->>'value','')) > 0
       )
       -- A DRAFT IS NOT AN ABANDONED FORM. It names its files and will submit them.
       or exists (
         select 1
         from acc.flow_drafts fd, jsonb_array_elements(fd.details::jsonb) d
         where jsonb_typeof(fd.details::jsonb) = 'array'
           and position(p_path in coalesce(d->>'value','')) > 0
       )
       or exists (
         select 1 from acc.flow_update_attachments a where a.storage_path = p_path
       )
       or exists (
         select 1 from acc.ptask_files f where f.storage_path = p_path
       )
       or exists (
         select 1 from acc.ptask_comments m where m.attach_path = p_path
       )
       -- Somebody's remembered QR code. Still in use even when no claim currently carries it.
       or exists (
         select 1 from acc.user_upi_scanner s where s.storage_path = p_path
       )
     );
$function$;

create or replace function acc.storage_path_in_use(p_path text, p_except_doc bigint default null,
                                                   p_except_ptask_file bigint default null)
returns boolean
language sql
stable security definer
set search_path to 'acc', 'doc', 'public'
as $function$
  select exists (select 1 from acc.ptask_files f where f.storage_path = p_path
                   and (p_except_ptask_file is null or f.id <> p_except_ptask_file))
      or exists (select 1 from acc.ptask_comments c where c.attach_path = p_path)
      or exists (select 1 from doc.documents d where d.storage_path = p_path
                   and (p_except_doc is null or d.id <> p_except_doc))
      -- A workflow instance and a draft both carry their files inside their own details, as text,
      -- and a single field can hold several - so this asks whether the path APPEARS, not whether
      -- it equals. The jsonb_typeof guard is here because neither column is guaranteed to hold an
      -- array on every historic row, and jsonb_array_elements() raises on a scalar.
      or exists (select 1
                   from acc.flow_cases c, jsonb_array_elements(c.trigger_details::jsonb) d
                  where jsonb_typeof(c.trigger_details::jsonb) = 'array'
                    and position(p_path in coalesce(d->>'value','')) > 0)
      or exists (select 1
                   from acc.flow_drafts fd, jsonb_array_elements(fd.details::jsonb) d
                  where jsonb_typeof(fd.details::jsonb) = 'array'
                    and position(p_path in coalesce(d->>'value','')) > 0)
      or exists (select 1 from acc.flow_update_attachments a where a.storage_path = p_path)
      or exists (select 1 from acc.user_upi_scanner s where s.storage_path = p_path);
$function$;

-- create or replace keeps the grants the earlier migrations set; restated so this file stands alone.
revoke all on function acc.wf_file_referenced(text) from public, anon;
grant execute on function acc.wf_file_referenced(text) to authenticated;
revoke all on function acc.storage_path_in_use(text, bigint, bigint) from public, anon;
grant execute on function acc.storage_path_in_use(text, bigint, bigint) to authenticated;
