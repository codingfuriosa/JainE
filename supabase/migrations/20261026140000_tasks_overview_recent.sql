-- TASKS: OPEN WORK FIRST, HISTORY LATER (26 Oct 2026).
--
-- acc.tasks_overview() hands the Tasks page every task a person has ever touched. For the busiest
-- people that is 800-950 tasks and 700-870 KB on every load, of which ~70% are long-finished tasks
-- the Tasks screen never draws - it only shows open and awaiting work plus what was completed in
-- the last 7 days. tasks_overview_recent() returns exactly that slice, with the same visibility
-- rule and the same shape, so the screen draws from it at once; the page then fetches the full
-- tasks_overview() quietly in the background for Archive and the other views that need history.
--
-- Kept: every task not yet approved; anything approved in the last 8 days (the 7-day "completed
-- this week" list, with a day's margin); and an approved task whose parent is still open, so a
-- delegated task still shows that it was delegated.

create or replace function acc.tasks_overview_recent()
returns jsonb
language sql
stable
set search_path to 'acc', 'public'
as $function$
  with me as (
    select lower(coalesce(app.current_user_email(), '')) as e
  ),
  wf as (
    select task_id from acc.wf_proxy_task_ids()
  ),
  mine as (
    select distinct a.task_id
      from acc.ptask_assignees a, me
     where lower(coalesce(a.email, '')) = me.e
  ),
  cand_all as (
    select t.*
      from acc.ptasks t, me
     where lower(coalesce(t.delegator, '')) = me.e
        or t.id in (select task_id from mine)
        or t.id in (select task_id from wf)
  ),
  open_ids as (
    select id from cand_all where approval_state is distinct from 'approved'
  ),
  cand as (
    select c.* from cand_all c
     where c.approval_state is distinct from 'approved'
        or c.approved_at >= now() - interval '8 days'
        or c.parent_task_id in (select id from open_ids)
  ),
  asg as (
    select a.* from acc.ptask_assignees a
     where a.task_id in (select id from cand)
  ),
  kept as (
    select c.* from cand c
     where exists (select 1 from asg a where a.task_id = c.id)
  )
  select jsonb_build_object(
    'tasks',     coalesce((select jsonb_agg(to_jsonb(k) order by k.order_index, k.id) from kept k), '[]'::jsonb),
    'assignees', coalesce((select jsonb_agg(to_jsonb(a) order by a.id)
                             from asg a where a.task_id in (select id from kept)), '[]'::jsonb),
    'projects',  coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name))
                             from acc.projects p), '[]'::jsonb)
  );
$function$;

revoke all on function acc.tasks_overview_recent() from public, anon;
grant execute on function acc.tasks_overview_recent() to authenticated;
