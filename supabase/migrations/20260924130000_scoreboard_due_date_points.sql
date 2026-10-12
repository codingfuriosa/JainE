-- Replaces the scoreboard's task_completed+on_time-late score (a flat +1/+1/-1 the UI computed
-- itself from the raw counts) with a genuine early-completion scoring rule, computed per task from
-- how many days before its due date it was actually finished:
--   7+ days early            -> 2 points
--   3 to 6 days early        -> 1 point
--   0 to 2 days early        -> 0 points
--   after the due date       -> -1 point
--   no due date, or approved with no completed_at -> 0 points (nothing to judge earliness against)
-- Still only counts a task once it is fully approved (acc.is_fully_approved), same as before, so a
-- decline still reverses the credit automatically - only the per-task point value changed.
-- The return row shape gained a column (score), which Postgres won't let create-or-replace do in
-- place ("cannot change return type of existing function") - has to be dropped first.
drop function if exists acc.scoreboard();
create function acc.scoreboard()
 returns table(email text, full_name text, checklist_items_done bigint, tasks_completed bigint,
   tasks_on_time bigint, tasks_late bigint, due_date_extensions bigint, score bigint)
 language sql
 stable security definer
 set search_path to ''
as $function$
  with completed as (
    select t.id, t.due_date, t.completed_at, a.email,
      case
        when t.due_date is null or t.completed_at is null then 0
        when (t.due_date - t.completed_at::date) >= 7 then 2
        when (t.due_date - t.completed_at::date) >= 3 then 1
        when (t.due_date - t.completed_at::date) >= 0 then 0
        else -1
      end as points
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
      ) as tasks_late,
      coalesce(sum(points),0) as score
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
    0::bigint as due_date_extensions,
    coalesce(ts.score,0) as score
  from people p
  left join acc.user_profile up on up.email = p.email
  left join task_stats ts on ts.email = p.email
  left join checklist_stats cs on cs.email = p.email
  where p.email is not null
  order by score desc, tasks_completed desc, checklist_items_done desc;
$function$;
