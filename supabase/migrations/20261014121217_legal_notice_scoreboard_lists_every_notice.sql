-- THE SCOREBOARD SHOWS EVERY NOTICE, NOT ONLY THE FINISHED ONES.
--
-- It listed completed notices only, on the reasoning that an unfinished one has nothing to score
-- yet. That is true of the POINTS and wrong about the SCREEN: a notice uploaded this morning
-- simply was not there, so the scoreboard disagreed with the tracker about how many notices
-- exist, and the obvious reading of that was "it is broken".
--
-- Every notice now has a row. The scoring is unchanged:
--   +1  finished two or more days before the due date
--    0  finished one day before, or on the day
--   -1  finished after the due date
-- An unfinished notice has points NULL rather than 0 - it has not been scored, which is a
-- different thing from having scored nothing, and a zero would quietly drag any average down.
-- `state` says which it is, so the page can show "not scored yet" instead of a number, and the
-- total on screen counts only the scored ones.
--
-- Ordering puts outstanding work first - what somebody opening a scoreboard mid-week needs to
-- see - then the most recently finished.
--
-- DROP first because the row shape gains a column, and Postgres will not replace a function whose
-- OUT parameters changed. Both statements are in one migration, so there is no window in which
-- the function is missing.
drop function if exists acc.legal_notice_scoreboard();

create function acc.legal_notice_scoreboard()
returns table(
  id           bigint,
  notice       text,     -- "Sent by whom" - the header
  assignee     text,     -- who marked it done; null while outstanding
  completed_on date,
  due_date     date,
  days_early   int,      -- null while outstanding
  points       int,      -- null while outstanding
  state        text      -- Outstanding | Overdue | Done
)
language sql stable security definer
set search_path to 'acc','public'
as $function$
  select n.id,
         n.header,
         case when n.completed_at is null then null
              else coalesce(p.full_name, n.completed_by) end,
         (n.completed_at at time zone 'Asia/Kolkata')::date,
         n.due_date,
         case when n.completed_at is null then null
              else (n.due_date - (n.completed_at at time zone 'Asia/Kolkata')::date)::int end,
         case
           when n.completed_at is null then null
           when (n.due_date - (n.completed_at at time zone 'Asia/Kolkata')::date) >= 2 then  1
           when (n.due_date - (n.completed_at at time zone 'Asia/Kolkata')::date) >= 0 then  0
           else                                                                             -1
         end,
         case
           when n.completed_at is not null then 'Done'
           when n.due_date < (now() at time zone 'Asia/Kolkata')::date then 'Overdue'
           else 'Outstanding'
         end
  from acc.legal_notices n
  left join acc.user_profile p on lower(p.email) = lower(n.completed_by)
  where (select acc.legal_notice_can_see())
  order by (n.completed_at is not null), n.completed_at desc nulls first, n.due_date asc
$function$;

revoke all on function acc.legal_notice_scoreboard() from public, anon;
grant execute on function acc.legal_notice_scoreboard() to authenticated, service_role;

comment on function acc.legal_notice_scoreboard() is
  'Legal > Scoreboard > Notice. One row per notice, outstanding ones first. +1 two or more days '
  'early, 0 one day early or on the day, -1 late; NULL while the notice is still outstanding, '
  'which is not the same as zero.';
