-- LEGAL NOTICE TASKS GO TO THE LEGAL TEAM ONLY: Dhruti Patel, Sanchari Mitra, Srestha Sarkar.
-- The temporary fourth name (ayushruia1@gmail.com, the Administrator, added for testing in
-- 20261014072838 / 20261014103416) is taken off. Nothing else changes; the body below is the live
-- definition as of 15 Oct 2026 with that one line removed.
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

revoke all on function acc.legal_notice_save(bigint,text,text,text[],text,jsonb) from public, anon;
