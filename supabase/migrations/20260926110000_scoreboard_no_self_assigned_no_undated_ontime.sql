/* Scoreboard: stop paying for work nobody asked for, and stop paying an on-time bonus to tasks
   that never had a time to be on.

   WHAT WAS WRONG.

   The UI computes the score from these counts as completed + on_time - late. Two holes in the
   counts meant the leaderboard was measuring something other than what it claimed.

   1. SELF-ASSIGNED TASKS COUNTED. Nothing compared the assignee to the creator, so a task you
      raised for yourself paid exactly what a task your manager gave you paid. 311 of the 705
      credited person-task rows - 44% - were self-assigned.

   2. A TASK WITH NO DUE DATE WAS COUNTED AS ON TIME. The old filter read
        completed_at is null or due_date is null or completed_at::date <= due_date
      so "there was no deadline" and "the deadline was met" were the same branch. 490 of 705 rows
      (70%) have no due date, and every one of them collected the on-time point. Because on_time
      and late partitioned the whole set, the arithmetic collapsed to exactly 2 x tasks_on_time -
      an overdue task scored 0 rather than costing anything, despite the caption saying -1.

   Together they inverted the ranking. The top three scored 130, 130 and 110 off 1, 3 and 1 tasks
   that actually had a deadline and met it; the two people doing dated, delegated work and hitting
   the dates (37 of 44, and 34 of 36) sat below all of them.

   WHAT IT DOES NOW, per fully-approved ordinary task, per assignee:

     assigned by someone else, met its due date   completed +1, on_time +1   =  +2
     assigned by someone else, missed it          completed +1, late   -1    =   0
     assigned by someone else, no due date        completed +1               =  +1
     assigned to yourself                         not counted at all         =   0

   So an undated task still earns its completion point - the work was done - it just cannot earn
   the punctuality point, which is the only thing a due date is evidence of.

   TASKS_SELF IS RETURNED, NOT HIDDEN. Excluding 44% of somebody's tasks silently would read as the
   scoreboard losing their work. The count comes back as its own column so the table can show what
   was set aside and why, rather than leaving people to wonder where their number went.

   NULL created_by is coalesced to '' rather than compared directly: in SQL a null comparison is
   null, not false, so `not is_self` would have been null and the FILTER would have dropped those
   rows out of every count instead of treating them as delegated.

   Unchanged: only fully-approved tasks count (acc.is_fully_approved), so a decline still reverses
   the credit; workflow steps are still excluded (flow_case_step_id is null); the causelist board
   (acc.scoreboard_causelist) is a separate function and is not touched here.

   The return row gains a column, which create-or-replace cannot do in place. */
drop function if exists acc.scoreboard();

create function acc.scoreboard()
 returns table(email text, full_name text, checklist_items_done bigint, tasks_completed bigint,
   tasks_on_time bigint, tasks_late bigint, tasks_self bigint, due_date_extensions bigint)
 language sql
 stable security definer
 set search_path to ''
as $function$
  with completed as (
    select t.id, t.due_date, t.completed_at, a.email,
           (lower(a.email) = lower(coalesce(t.created_by,''))) as is_self
    from acc.ptasks t
    join acc.ptask_assignees a on a.task_id = t.id
    where t.approval_state = 'approved'
      and acc.is_fully_approved(t.id)
      and t.flow_case_step_id is null          -- ordinary tasks only
  ),
  task_stats as (
    select email,
      count(*) filter (where not is_self) as tasks_completed,
      -- A due date that was actually met. No due date is no longer a way of meeting one.
      count(*) filter (where not is_self
        and due_date is not null
        and completed_at is not null
        and completed_at::date <= due_date
      ) as tasks_on_time,
      count(*) filter (where not is_self
        and due_date is not null
        and completed_at is not null
        and completed_at::date > due_date
      ) as tasks_late,
      count(*) filter (where is_self) as tasks_self
    from completed group by email
  ),
  checklist_stats as (
    select unnest(coalesce(s.people, array[]::text[])) as email, count(*) as checklist_items_done
    from acc.ptask_subtasks s where s.done
    group by 1
  ),
  people as (
    select email, full_name from adm.users where active is true
  )
  select p.email,
    coalesce(up.full_name, p.full_name) as full_name,
    coalesce(cs.checklist_items_done,0) as checklist_items_done,
    coalesce(ts.tasks_completed,0) as tasks_completed,
    coalesce(ts.tasks_on_time,0) as tasks_on_time,
    coalesce(ts.tasks_late,0) as tasks_late,
    coalesce(ts.tasks_self,0) as tasks_self,
    0::bigint as due_date_extensions
  from people p
  left join acc.user_profile up on up.email = p.email
  left join task_stats ts on ts.email = p.email
  left join checklist_stats cs on cs.email = p.email
  where p.email is not null
  order by tasks_completed desc, checklist_items_done desc;
$function$;
