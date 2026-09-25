-- The 7+/3-6/0-2/late point rule was meant only for tasks the causelist action-review popup
-- creates, not every ordinary task in Accountability - acc.scoreboard() goes back to exactly what
-- it was before 20260924130000 (same signature, same +1 completed/+1 on-time/-1 late logic, which
-- the UI still derives itself from these raw counts), and a new acc.scoreboard_causelist() carries
-- the day-based rule instead, scoped to just the tasks tagged source='causelist'.
alter table acc.ptasks add column if not exists source text;
comment on column acc.ptasks.source is
  'Where a task came from, when that matters for scoring/filtering. ''causelist'' = created by the Legal MIS causelist action-review popup (clrevSubmit). Null for an ordinary task.';

drop function if exists acc.scoreboard();
create function acc.scoreboard()
 returns table(email text, full_name text, checklist_items_done bigint, tasks_completed bigint,
   tasks_on_time bigint, tasks_late bigint, due_date_extensions bigint)
 language sql
 stable security definer
 set search_path to ''
as $function$
  with completed as (
    select t.id, t.due_date, t.completed_at, a.email
    from acc.ptasks t
    join acc.ptask_assignees a on a.task_id = t.id
    where t.approval_state = 'approved'
      and acc.is_fully_approved(t.id)
      and t.flow_case_step_id is null          -- ordinary tasks only
  ),
  task_stats as (
    select email,
      count(*) as tasks_completed,
      count(*) filter (where completed_at is null
        or due_date is null
        or completed_at::date <= due_date
      ) as tasks_on_time,
      count(*) filter (where completed_at is not null
        and due_date is not null
        and completed_at::date > due_date
      ) as tasks_late
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
    0::bigint as due_date_extensions
  from people p
  left join acc.user_profile up on up.email = p.email
  left join task_stats ts on ts.email = p.email
  left join checklist_stats cs on cs.email = p.email
  where p.email is not null
  order by tasks_completed desc, checklist_items_done desc;
$function$;

-- Same shape of query as acc.scoreboard(), scoped to source='causelist' and carrying the day-based
-- points rule instead of the flat completed/on-time/late credit. Only people with at least one
-- causelist task (completed or not) are returned, so this stays empty rather than listing every
-- staff member at zero.
create function acc.scoreboard_causelist()
 returns table(email text, full_name text, tasks_assigned bigint, tasks_completed bigint,
   tasks_pending bigint, score bigint)
 language sql
 stable security definer
 set search_path to ''
as $function$
  with mine as (
    select t.id, t.due_date, t.completed_at, t.approval_state, a.email,
      (t.approval_state = 'approved' and acc.is_fully_approved(t.id)) as is_done
    from acc.ptasks t
    join acc.ptask_assignees a on a.task_id = t.id
    where t.source = 'causelist'
  ),
  stats as (
    select email,
      count(*) as tasks_assigned,
      count(*) filter (where is_done) as tasks_completed,
      count(*) filter (where not is_done) as tasks_pending,
      coalesce(sum(case
        when not is_done then 0
        when due_date is null or completed_at is null then 0
        when (due_date - completed_at::date) >= 7 then 2
        when (due_date - completed_at::date) >= 3 then 1
        when (due_date - completed_at::date) >= 0 then 0
        else -1
      end),0) as score
    from mine group by email
  )
  select s.email, coalesce(up.full_name, s.email) as full_name,
    s.tasks_assigned, s.tasks_completed, s.tasks_pending, s.score
  from stats s
  left join acc.user_profile up on up.email = s.email
  order by s.score desc, s.tasks_completed desc;
$function$;
