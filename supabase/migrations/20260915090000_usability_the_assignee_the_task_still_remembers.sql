/* Usability: fill the blank "Assigned to" where the task itself still knows the answer.

   339 Accountability events have no assignee on them. Most are not a mystery - they are the rows the
   first reconstruction built from the task activity trail, which recorded WHAT changed but never who
   the task belonged to. The task is still there, and so is its assignee list.

   195 of them can be answered outright, with no guessing at all:

     Approve a completed task          74
     Mark task done / send for approval 68
     Comment on a task                 23
     Edit task title                    8
     Edit task due date                 8
     Edit task description              5
     Revert / reopen a task             3
     Decline a completed task           2
     Delegate task to someone           2
     Edit task project                  1
     Attach file to a task or comment   1

   Each event carries a pointer back to the row it was reconstructed from - an activity entry, a
   comment, a file - and every one of those leads to a task. The task's assignees are read from the
   task, not inferred from anything, so this is recovery rather than estimation.

   What is deliberately NOT filled:

     - 10 "Create task" events whose task resolves fine but has NO assignee on file. Those tasks were
       created unassigned. Blank is the correct answer there, and inventing a name would be worse
       than the dash.
     - 15 sub-task events (add a checklist item, mark one complete). A sub-task is not assigned to
       anybody - it belongs to its parent task - so there is nothing to fill.
     - 91 "Start a new instance" events. Their instances have mostly been forwarded on or deleted
       since, and only 18 could be matched; worse, some workflows send their first step to a POOL of
       candidates rather than one person, so even a match would not be a single name. Left alone.
     - 26 "Forward a step" and 1 "Revert a forwarded step". These log live and already carry the
       assignee when there is one; the handful without are steps that went to a pool.

   Names come from adm.users, so the report shows "Santosh Kumar" rather than an address, matching
   what the live logging writes. A task with several assignees lists them all, comma separated,
   exactly as the create-task reconstruction already does. */

update public.erp_usage_events e
   set meta = coalesce(e.meta,'{}'::jsonb) || jsonb_build_object('assignee', src.names)
  from (
    select ev.id,
           (select string_agg(coalesce(u.full_name, pa.email), ', ' order by coalesce(u.full_name, pa.email))
              from acc.ptask_assignees pa
              left join adm.users u on lower(u.email) = lower(pa.email)
             where pa.task_id = ev.task_id) as names
      from (
        select e2.id,
               case
                 when e2.meta->>'ref' like 'pa:%'
                   then (select a.task_id from acc.ptask_activity a
                          where a.id = substring(e2.meta->>'ref' from 4)::bigint)
                 when e2.meta->>'ref' like 'pcm:%'
                   then (select c.task_id from acc.ptask_comments c
                          where c.id = substring(e2.meta->>'ref' from 5)::bigint)
                 when e2.meta->>'ref' like 'pfile:%'
                   then (select f.task_id from acc.ptask_files f
                          where f.id = substring(e2.meta->>'ref' from 7)::bigint)
               end as task_id
          from public.erp_usage_events e2
         where e2.feature_key like 'tasks.tasks.%'
           and e2.user_email is not null
           and position('@' in e2.user_email) > 0
           and not (e2.meta ? 'assignee')
           and e2.meta ? 'ref'
      ) ev
     where ev.task_id is not null
  ) src
 where e.id = src.id
   and src.names is not null
   and trim(src.names) <> '';
