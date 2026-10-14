-- WHO MAY SEE THE NOTICE TRACKER.
--
-- The first attempt gated on app.can_read('acc'/'doc') and showed the tracker to nobody who needs
-- it. Those read adm.users' per-module columns, and of the three people notices are assigned to,
-- only Srestha Sarkar had doc = EDITOR; Dhruti Patel and Sanchari Mitra had null for every
-- column. They reach Legal through adm.users.modules instead, which is the list the sidebar is
-- built from - 'legal' is in all three.
--
-- So the gate is: a superadmin, anyone whose modules include 'legal', or anyone holding a real
-- doc/acc role. That last clause keeps Documents and Accountability administrators able to see it
-- without being given the Legal module.
--
-- FOLLOW-UP, recorded here because the code change alone did not fix it: Dhruti and Sanchari
-- having no `doc` role also meant they could not read Legal DOCUMENTS - doc_read is
-- can_read('doc') and would refuse them, so they would have seen the tracker and the task and
-- been unable to open the file the notice came from. Both were given doc = EDITOR on 14 Oct 2026,
-- matching Srestha, at the owner's instruction. That is account settings, not schema, so it is
-- not replayed by this migration - a fresh database will need the same three accounts configured.
create or replace function acc.legal_notice_can_see()
returns boolean
language sql
stable
security definer
set search_path to 'adm','app','public'
as $function$
  select app.is_superadmin()
      or app.can_read('doc')
      or app.can_read('acc')
      or exists (
           select 1 from adm.users u
           where u.email = app.current_user_email()
             and u.active
             and 'legal' = any(coalesce(u.modules, '{}'::text[]))
         )
$function$;

grant execute on function acc.legal_notice_can_see() to authenticated;

comment on function acc.legal_notice_can_see() is
  'Gate for Legal > Notices and its scoreboard. Superadmin, a doc/acc role, or the Legal module in '
  'adm.users.modules - the last is how Legal staff actually reach the module.';

-- The table's own rules, corrected the same way. Written as (select ...) so the check is made once
-- per query, not once per row, in line with the rest of the schema.
alter policy legal_notices_read on acc.legal_notices
  using ((select acc.legal_notice_can_see()));

alter policy legal_notices_write on acc.legal_notices
  using ((select app.can_write('acc')) or (select app.is_superadmin()))
  with check ((select app.can_write('acc')) or (select app.is_superadmin()));

-- And the two reading functions.
create or replace function acc.legal_notice_tracker()
returns table(
  id bigint, document_id bigint, file_name text, notice_type text, sent_by text,
  parties text[], subject text, uploaded_on date, due_date date,
  completed_on date, completed_by text, task_id bigint, task_status text, state text
)
language sql stable security definer
set search_path to 'acc','doc','public'
as $function$
  select n.id, n.document_id, d.file_name, n.notice_type, n.header, n.parties, n.subject,
         (n.uploaded_at at time zone 'Asia/Kolkata')::date,
         n.due_date,
         (n.completed_at at time zone 'Asia/Kolkata')::date,
         n.completed_by,
         n.task_id,
         t.status,
         case
           when n.completed_at is not null then 'Done'
           when n.due_date < (now() at time zone 'Asia/Kolkata')::date then 'Overdue'
           else 'Outstanding'
         end
  from acc.legal_notices n
  join doc.documents d on d.id = n.document_id
  left join acc.ptasks t on t.id = n.task_id
  where (select acc.legal_notice_can_see())
  order by coalesce(n.completed_at, now()) desc, n.uploaded_at desc
$function$;

create or replace function acc.legal_notice_scoreboard()
returns table(
  id bigint, notice text, assignee text, completed_on date,
  due_date date, days_early int, points int
)
language sql stable security definer
set search_path to 'acc','public'
as $function$
  select n.id,
         n.header,
         coalesce(p.full_name, n.completed_by),
         (n.completed_at at time zone 'Asia/Kolkata')::date,
         n.due_date,
         (n.due_date - (n.completed_at at time zone 'Asia/Kolkata')::date)::int,
         case
           when (n.due_date - (n.completed_at at time zone 'Asia/Kolkata')::date) >= 2 then  1
           when (n.due_date - (n.completed_at at time zone 'Asia/Kolkata')::date) >= 0 then  0
           else                                                                             -1
         end
  from acc.legal_notices n
  left join acc.user_profile p on lower(p.email) = lower(n.completed_by)
  where n.completed_at is not null
    and (select acc.legal_notice_can_see())
  order by n.completed_at desc
$function$;

grant execute on function acc.legal_notice_tracker()    to authenticated;
grant execute on function acc.legal_notice_scoreboard() to authenticated;
