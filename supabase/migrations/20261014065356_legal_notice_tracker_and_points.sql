-- WHAT THE TWO SCREENS READ.
--
-- Both are functions rather than views so the row-level rules are applied once, at the top, the
-- same way acc.tasks_overview() does it - a view would have had every policy on every joined
-- table evaluated per row.
--
-- NOTE: both functions below are REPLACED in the next migration,
-- 20261014065831_legal_notice_visibility_gate.sql. The `where can_read('acc') or can_read('doc')`
-- line here showed the tracker to nobody who needed it: those read adm.users' per-module columns,
-- and the Legal staff this was built for had none of them. Kept as applied rather than rewritten,
-- so the history reads true.

-- ---------------------------------------------------------------------------------------------
-- LEGAL > NOTICES - the tracker.
-- One row per notice: who sent it, who it concerns, what about, and when it was dealt with.
-- "Clients / Applicants" is one column on purpose: a customer notice names clients and a
-- government one names an addressee, and the tracker does not care which it is looking at.
-- ---------------------------------------------------------------------------------------------
create or replace function acc.legal_notice_tracker()
returns table(
  id            bigint,
  document_id   bigint,
  file_name     text,
  notice_type   text,
  sent_by       text,          -- header: who it is from
  parties       text[],        -- clients / applicants
  subject       text,
  uploaded_on   date,
  due_date      date,
  completed_on  date,          -- null while outstanding
  completed_by  text,
  task_id       bigint,
  task_status   text,
  state         text           -- Outstanding | Overdue | Done
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
  -- Only the module's own readers, checked once rather than per row.
  where (select app.can_read('acc')) or (select app.can_read('doc'))
  order by coalesce(n.completed_at, now()) desc, n.uploaded_at desc
$function$;

-- ---------------------------------------------------------------------------------------------
-- LEGAL > SCOREBOARD > NOTICE - the points.
--
--   +1  finished TWO OR MORE days before the due date
--    0  finished one day before, or on the day
--   -1  finished after the due date
--
-- One day early scores the same as on the day: that is the rule as given, and the gap is
-- deliberate - a notice answered the day before it was due was not answered early, it was
-- answered just in time.
--
-- An outstanding notice has no row here. It has not been done, so there is nothing to score yet;
-- counting it as -1 before its due date has even passed would punish work still in hand. Once it
-- is late AND finished it scores -1 like anything else. The tracker is where you look for what is
-- still open.
-- ---------------------------------------------------------------------------------------------
create or replace function acc.legal_notice_scoreboard()
returns table(
  id           bigint,
  notice       text,     -- "Sent by whom" - the header
  assignee     text,     -- who actually marked it done
  completed_on date,
  due_date     date,
  days_early   int,
  points       int
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
    and ((select app.can_read('acc')) or (select app.can_read('doc')))
  order by n.completed_at desc
$function$;

grant execute on function acc.legal_notice_tracker()    to authenticated;
grant execute on function acc.legal_notice_scoreboard() to authenticated;

comment on function acc.legal_notice_tracker() is
  'Legal > Notices. One row per uploaded legal notice with its extracted fields and whether it is '
  'still outstanding, overdue, or done.';
comment on function acc.legal_notice_scoreboard() is
  'Legal > Scoreboard > Notice. +1 two or more days early, 0 one day early or on the day, -1 late. '
  'Only finished notices appear - an outstanding one has not been scored yet.';
