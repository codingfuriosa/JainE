-- THE NOTICE PIPELINE: UPLOAD -> READ -> TASK -> TRACKED.
--
-- Four moving parts, deliberately separate so a failure in one does not strand the others:
--   1. a trigger puts a PENDING row on the queue the moment a file lands in the folder
--   2. the extractor claims pending rows, reads them, and calls legal_notice_save()
--   3. legal_notice_save() writes the fields and raises the task
--   4. a trigger on the task records when it was finished
--
-- Nothing here hard-codes the folder NAME. Folders get renamed; the id does not change.

-- ---------------------------------------------------------------------------------------------
-- WHICH FOLDER IS THE NOTICE FOLDER.
-- One place to answer it, so the trigger, the queue and the UI cannot disagree. A notice uploaded
-- into a SUB-folder of Legal Notice counts too, which is why this walks the tree rather than
-- comparing a single id - Legal already nests folders several deep elsewhere.
-- ---------------------------------------------------------------------------------------------
create or replace function acc.legal_notice_folder_ids()
returns table(folder_id bigint)
language sql stable
set search_path to 'doc','acc','public'
as $function$
  with recursive root as (
    select f.id from doc.folders f
    where f.department = 'Legal' and f.name = 'Legal Notice' and f.parent_id is null
    union all
    select c.id from doc.folders c join root r on c.parent_id = r.id
  )
  select id from root
$function$;

-- ---------------------------------------------------------------------------------------------
-- A FILE LANDS IN THE FOLDER -> IT JOINS THE QUEUE.
-- Fires on upload AND on a move into the folder, because a notice filed somewhere else first and
-- dragged across afterwards is still a notice. due_date is set here, from the UPLOAD time, so a
-- slow extractor cannot quietly shorten anyone's seven days.
-- ---------------------------------------------------------------------------------------------
create or replace function acc.legal_notice_enqueue()
returns trigger
language plpgsql
security definer
set search_path to 'acc','doc','public'
as $function$
declare v_up timestamptz;
begin
  if new.folder_id is null then return new; end if;
  if not exists (select 1 from acc.legal_notice_folder_ids() f where f.folder_id = new.folder_id)
  then
    return new;
  end if;

  v_up := coalesce(new.created_at, now());

  insert into acc.legal_notices (document_id, uploaded_at, due_date)
  values (new.id, v_up, (v_up at time zone 'Asia/Kolkata')::date + 7)
  on conflict (document_id) do nothing;   -- a move back and forth must not queue it twice

  return new;
end;
$function$;

drop trigger if exists legal_notice_enqueue_trg on doc.documents;
create trigger legal_notice_enqueue_trg
  after insert or update of folder_id on doc.documents
  for each row execute function acc.legal_notice_enqueue();

-- ---------------------------------------------------------------------------------------------
-- WHAT THE EXTRACTOR SHOULD READ NEXT.
-- Mirrors doc.legal_ocr_pending: oldest first, three strikes and it is retired. Returns the
-- storage details so the worker never has to join back to doc.documents itself.
-- ---------------------------------------------------------------------------------------------
create or replace function acc.legal_notice_pending(p_limit int default 3)
returns table(id bigint, document_id bigint, storage_path text, file_name text, file_type text)
language sql stable security definer
set search_path to 'acc','doc','public'
as $function$
  select n.id, n.document_id, d.storage_path, d.file_name, d.file_type
  from acc.legal_notices n
  join doc.documents d on d.id = n.document_id
  where n.extract_state = 'pending'
    and n.extract_attempts < 3
    and coalesce(d.storage_path,'') <> ''
  order by n.uploaded_at asc
  limit greatest(1, least(coalesce(p_limit,3), 10))
$function$;

create or replace function acc.legal_notice_note_failure(p_id bigint, p_error text default null)
returns void
language plpgsql security definer
set search_path to 'acc','public'
as $function$
begin
  update acc.legal_notices
     set extract_attempts = extract_attempts + 1,
         extract_error    = coalesce(p_error, extract_error),
         -- Retired at three, exactly as the OCR job does, so an unreadable scan stops costing money.
         extract_state    = case when extract_attempts + 1 >= 3 then 'failed' else 'pending' end
   where id = p_id;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- THE FIELDS ARE IN -> RAISE THE TASK.
--
-- The task has NO human assigner. It arrives from "Notices" the way a workflow task arrives from
-- Workflow: nobody delegated it, so there is nobody to approve it, and whoever does the work
-- finishes it outright. source='notice' is what tells the page to offer a plain Done instead of
-- "send for approval" - without it the task would sit in an approval queue no one owns.
--
-- One task, all three assigned, because a notice is one piece of work and any of them may take it.
-- The three are named here, in one place, so changing who gets notices is one statement.
-- ---------------------------------------------------------------------------------------------
create or replace function acc.legal_notice_save(
  p_id       bigint,
  p_type     text,
  p_header   text,
  p_parties  text[],
  p_subject  text,
  p_raw      jsonb default null
)
returns bigint
language plpgsql security definer
set search_path to 'acc','doc','public'
as $function$
declare
  v_task   bigint;
  v_due    date;
  v_doc    bigint;
  v_file   text;
  v_hdr    text;
  v_desc   text;
  v_people text[] := array[
    'legal@thejaingroup.com',    -- Dhruti Patel
    'legal3@thejaingroup.com',   -- Sanchari Mitra
    'legal2@thejaingroup.com'    -- Srestha Sarkar
  ];
  v_p text;
begin
  select n.due_date, n.document_id, n.task_id into v_due, v_doc, v_task
  from acc.legal_notices n where n.id = p_id;
  if v_due is null then return null; end if;

  select d.file_name into v_file from doc.documents d where d.id = v_doc;

  -- A notice with no readable sender still has to reach somebody, so it is named for its file
  -- rather than left blank - a task called "Legal Notice - " tells nobody anything.
  v_hdr := nullif(btrim(coalesce(p_header,'')), '');
  if v_hdr is null then v_hdr := coalesce(nullif(btrim(coalesce(v_file,'')),''), 'Unread sender'); end if;

  update acc.legal_notices
     set notice_type   = nullif(btrim(coalesce(p_type,'')),''),
         header        = v_hdr,
         parties       = p_parties,
         subject       = nullif(btrim(coalesce(p_subject,'')),''),
         raw           = coalesce(p_raw, raw),
         extract_state = 'done',
         extract_error = null
   where id = p_id;

  if v_task is not null then return v_task; end if;   -- already raised; never raise a second

  -- Everything extracted EXCEPT the header, which is already the task's name.
  v_desc := 'Legal notice received.' || E'\n\n'
         || 'Type: '    || coalesce(nullif(btrim(coalesce(p_type,'')),''), 'Not stated') || E'\n'
         || 'Subject: ' || coalesce(nullif(btrim(coalesce(p_subject,'')),''), 'Not stated') || E'\n';
  if p_parties is not null and array_length(p_parties,1) > 0 then
    v_desc := v_desc || 'Clients / Applicants:' || E'\n';
    foreach v_p in array p_parties loop
      v_desc := v_desc || '  - ' || v_p || E'\n';
    end loop;
  else
    v_desc := v_desc || 'Clients / Applicants: Not stated' || E'\n';
  end if;
  v_desc := v_desc || E'\n' || 'File: ' || coalesce(v_file,'(unnamed)') || E'\n'
                   || 'Due 7 days from upload.';

  insert into acc.ptasks (title, description, delegator, due_date,
                          status, approval_state, progress, created_by, source)
  values ('Legal Notice - ' || v_hdr, v_desc, 'notices', v_due,
          'Pending', 'open', 0, 'notices', 'notice')
  returning id into v_task;

  insert into acc.ptask_assignees (task_id, email)
  select v_task, x from unnest(v_people) x
  on conflict (task_id, email) do nothing;

  insert into acc.ptask_activity (task_id, action, detail)
  values (v_task, 'created', 'Raised automatically from a legal notice');

  update acc.legal_notices set task_id = v_task where id = p_id;
  return v_task;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- THE TASK IS FINISHED -> STAMP THE NOTICE.
-- Completion is recorded on the NOTICE so the tracker and the scoreboard read one date, and so
-- that deleting a task later cannot erase the fact that the work was done on time.
-- ---------------------------------------------------------------------------------------------
create or replace function acc.legal_notice_mark_complete()
returns trigger
language plpgsql
security definer
set search_path to 'acc','public'
as $function$
begin
  if new.status = 'Completed' and coalesce(old.status,'') <> 'Completed' then
    update acc.legal_notices
       set completed_at = coalesce(new.completed_at, new.approved_at, now()),
           completed_by = coalesce(app.current_user_email(), new.approved_by, 'unknown')
     where task_id = new.id
       and completed_at is null;
  elsif new.status <> 'Completed' and coalesce(old.status,'') = 'Completed' then
    -- Re-opened: the notice is outstanding again, and the scoreboard must stop counting it.
    update acc.legal_notices
       set completed_at = null, completed_by = null
     where task_id = new.id;
  end if;
  return new;
end;
$function$;

drop trigger if exists legal_notice_complete_trg on acc.ptasks;
create trigger legal_notice_complete_trg
  after update of status on acc.ptasks
  for each row
  when (new.source = 'notice')
  execute function acc.legal_notice_mark_complete();

revoke all on function acc.legal_notice_pending(int)                        from public, anon;
revoke all on function acc.legal_notice_note_failure(bigint, text)          from public, anon;
revoke all on function acc.legal_notice_save(bigint,text,text,text[],text,jsonb) from public, anon;
grant execute on function acc.legal_notice_folder_ids() to authenticated;
