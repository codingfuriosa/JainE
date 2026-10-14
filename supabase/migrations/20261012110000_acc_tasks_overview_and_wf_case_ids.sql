-- TWO READ-ONLY FUNCTIONS THAT REPLACE NINE ROUND TRIPS WITH TWO.
--
-- Each trip from the browser to this database costs about 85ms - 50ms of it simply travelling to
-- Mumbai and back, measured. The database answers in ~20ms. So the cost was the waiting, and the
-- only lever is asking fewer times.
--
-- BOTH ARE SECURITY INVOKER, deliberately, and that is the whole safety argument: they run as the
-- signed-in user, so every row-level policy applies exactly as it does when the browser asks
-- directly. Neither can return a row the caller could not already have fetched for themselves.
--
-- acc.tasks_overview() - the Accountability task list in one call: the tasks you may see, every
-- assignee of those tasks, and the project names. It used to be four trips. The visibility rule
-- inside is COPIED FROM THE BROWSER, not invented: acc.ptasks' own policy is merely "not a
-- customer", so the database never decided whose tasks these were - the JavaScript filter did.
-- Proven equal to that filter on live data for four accounts, then again through the finished
-- function as a signed-in user: 149 tasks either way, none missing, none extra, no duplicates.
--
-- acc.wf_my_case_ids() - which workflow cases name me. The Workflow tab used to read every
-- flow_case_steps row it was allowed to see (4,708 rows, 460KB over five paged requests for a
-- director) and pick its own out in the browser; in the measured case not one row matched. The
-- rows were never the answer, the case ids inside them were. Checked against that same browser
-- rule for a user with real cases: 479 ids either way, none missing, none extra.
-- It is a function rather than a PostgREST filter because the rule matches addresses regardless of
-- case, and "contains" on an array matches exactly - a filter would have silently dropped a
-- differently-cased address.
--
-- Both are granted to authenticated only. Postgres grants EXECUTE to PUBLIC by default, which
-- would have left them callable by anon; that default is revoked explicitly rather than relying on
-- anon's lack of permission on app.current_user_email() to stop it.

create or replace function acc.tasks_overview()
returns jsonb language sql stable security invoker set search_path to 'acc','public' as $$
  with me as (select lower(coalesce(app.current_user_email(), '')) as e),
  wf   as (select task_id from acc.wf_proxy_task_ids()),
  mine as (select distinct a.task_id from acc.ptask_assignees a, me
            where lower(coalesce(a.email,'')) = me.e),
  cand as (select t.* from acc.ptasks t, me
            where lower(coalesce(t.delegator,'')) = me.e
               or t.id in (select task_id from mine)
               or t.id in (select task_id from wf)),
  asg  as (select a.* from acc.ptask_assignees a where a.task_id in (select id from cand)),
  kept as (select c.* from cand c where exists (select 1 from asg a where a.task_id = c.id))
  select jsonb_build_object(
    'tasks',     coalesce((select jsonb_agg(to_jsonb(k) order by k.order_index, k.id) from kept k), '[]'::jsonb),
    'assignees', coalesce((select jsonb_agg(to_jsonb(a) order by a.id)
                             from asg a where a.task_id in (select id from kept)), '[]'::jsonb),
    'projects',  coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name))
                             from acc.projects p), '[]'::jsonb));
$$;

create or replace function acc.wf_my_case_ids()
returns table(case_id bigint) language sql stable security invoker
set search_path to 'acc','public' as $$
  select distinct s.case_id from acc.flow_case_steps s
   where s.case_id is not null
     and ( lower(coalesce(s.person,'')) = lower(coalesce(app.current_user_email(),''))
        or exists (select 1 from unnest(coalesce(s.candidates,'{}'::text[])) c
                    where lower(c) = lower(coalesce(app.current_user_email(),''))) );
$$;

revoke execute on function acc.tasks_overview()  from public, anon;
revoke execute on function acc.wf_my_case_ids()  from public, anon;
grant  execute on function acc.tasks_overview()  to authenticated;
grant  execute on function acc.wf_my_case_ids()  to authenticated;
