-- LEGAL NOTICE TRACKER: EVERY ATTACHMENT ON A NOTICE'S TASK IS FILED IN LEGAL > LEGAL NOTICE ANSWERS.
--
-- (17 Oct 2026) A reply to a notice is uploaded on the notice's task - the reply letter, the
-- postal receipt - and until now it lived only there. Now each attachment added to a legal notice
-- task (acc.legal_notices.task_id, or a task delegated from it) also appears as a document in the
-- Legal Notice Answers category, where it is searched and OCR'd like any other Legal document.
--
-- It is the SAME stored file, not a copy: the document points at the attachment's storage_path.
-- So neither side may delete the file while the other still uses it - acc.storage_path_in_use()
-- answers that for both delete buttons (task attachment and Legal document). Removing the
-- attachment from the task leaves the filed document, and its file, where they are.

create or replace function acc.legal_notice_answer_file()
returns trigger
language plpgsql security definer
set search_path to 'acc','doc','public'
as $function$
declare v_folder bigint; v_task acc.ptasks; v_ext text;
begin
  select t.* into v_task from acc.ptasks t where t.id = new.task_id;
  if not found then return null; end if;
  if not exists (select 1 from acc.legal_notices ln
                  where ln.task_id = v_task.id or ln.task_id = v_task.parent_task_id) then
    return null;
  end if;
  select f.id into v_folder from doc.folders f
   where f.department = 'Legal' and f.name = 'Legal Notice Answers' and f.parent_id is null
   order by f.id limit 1;
  if v_folder is null or new.storage_path is null then return null; end if;
  -- once per file: a delegated copy of the task carries the same storage_path
  if exists (select 1 from doc.documents d where d.storage_path = new.storage_path) then return null; end if;
  v_ext := lower(nullif(substring(coalesce(new.file_name,'') from '\.([A-Za-z0-9]+)$'), ''));
  insert into doc.documents (title, department, category, folder_id, file_name, file_size, file_type,
                             storage_path, status, visibility, confidential, uploaded_by, description)
  values (regexp_replace(coalesce(new.file_name,'Attachment'), '\.[^.]+$', ''), 'Legal', 'Legal Notice Answers',
          v_folder, new.file_name, new.file_size, v_ext, new.storage_path, 'Active', 'Internal', false,
          coalesce(new.uploaded_by, 'system'),
          'Attached to the legal notice task "' || coalesce(v_task.title,'') || '"');
  return null;
exception when others then
  -- filing it is a convenience; the attachment itself must always be saved
  return null;
end $function$;

drop trigger if exists trg_legal_notice_answer_file on acc.ptask_files;
create trigger trg_legal_notice_answer_file
  after insert on acc.ptask_files
  for each row execute function acc.legal_notice_answer_file();

-- Is this stored file still used by anything other than the row being deleted? A yes/no only.
create or replace function acc.storage_path_in_use(p_path text, p_except_doc bigint default null,
                                                   p_except_ptask_file bigint default null)
returns boolean
language sql stable security definer
set search_path to 'acc','doc','public'
as $function$
  select exists (select 1 from acc.ptask_files f where f.storage_path = p_path
                   and (p_except_ptask_file is null or f.id <> p_except_ptask_file))
      or exists (select 1 from acc.ptask_comments c where c.attach_path = p_path)
      or exists (select 1 from doc.documents d where d.storage_path = p_path
                   and (p_except_doc is null or d.id <> p_except_doc));
$function$;
revoke all on function acc.storage_path_in_use(text, bigint, bigint) from public, anon;
grant execute on function acc.storage_path_in_use(text, bigint, bigint) to authenticated;

-- The notice tasks' attachments already there are filed too.
insert into doc.documents (title, department, category, folder_id, file_name, file_size, file_type,
                           storage_path, status, visibility, confidential, uploaded_by, description)
select distinct on (pf.storage_path)
       regexp_replace(coalesce(pf.file_name,'Attachment'), '\.[^.]+$', ''), 'Legal', 'Legal Notice Answers',
       (select f.id from doc.folders f where f.department='Legal' and f.name='Legal Notice Answers'
          and f.parent_id is null order by f.id limit 1),
       pf.file_name, pf.file_size,
       lower(nullif(substring(coalesce(pf.file_name,'') from '\.([A-Za-z0-9]+)$'), '')),
       pf.storage_path, 'Active', 'Internal', false, coalesce(pf.uploaded_by,'system'),
       'Attached to the legal notice task "' || coalesce(t.title,'') || '"'
  from acc.ptask_files pf
  join acc.ptasks t on t.id = pf.task_id
 where exists (select 1 from acc.legal_notices ln where ln.task_id = t.id or ln.task_id = t.parent_task_id)
   and pf.storage_path is not null
   and not exists (select 1 from doc.documents d where d.storage_path = pf.storage_path)
   and exists (select 1 from doc.folders f where f.department='Legal' and f.name='Legal Notice Answers' and f.parent_id is null)
 order by pf.storage_path, pf.id;
