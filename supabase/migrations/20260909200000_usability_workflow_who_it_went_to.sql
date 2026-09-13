-- Usability: who a workflow action went to, and which workflow it was.
--
-- The Assigned to column was empty on almost every Workflow row. Both missing pieces were being
-- read the same way - follow the event to its flow_case_step, then to its instance and workflow -
-- and that fails for the bulk of the history, because most Invoice Processing instances were
-- deleted along with their steps and tasks. Only 95 of 410 forwards had a person, and 178 a
-- workflow name.
--
-- There is a second record of the same act that was NOT deleted: the notification the action sent.
-- Forwarding a step creates the next person's task, which notifies exactly them, within a second or
-- two - so the recipient of that notification IS who it was forwarded to, and its title carries the
-- workflow's name as "New workflow step: <workflow>". Measured across the events that could also be
-- resolved the old way, the window holds on average 1.05 recipients, so this is a single clear
-- name rather than a guess between several.
--
-- Additive and idempotent: only events still missing the key are touched, and a window whose
-- notifications disagree about the workflow is left alone rather than resolved arbitrarily.
--
-- Receive a step is deliberately NOT given an assignee. Receiving means the step is the reader's
-- own, so the only name to put there is the person whose drill-down it already is.

-- Who it went to: the person notified at the moment of the action, excluding the actor.
with pm as (
  select lower(email) as e, nullif(trim(full_name), '') as fn
  from acc.user_profile where nullif(trim(full_name), '') is not null
),
ev as (
  select id, user_email, occurred_at
  from public.erp_usage_events
  where feature_key in ('tasks.workflow.forward_a_step',
                        'tasks.workflow.start_a_new_instance',
                        'tasks.workflow.reject_send_a_step_back',
                        'tasks.workflow.revert_a_forwarded_step')
    and not coalesce(meta ? 'assignee', false)
),
w as (
  select ev.id as ev_id,
    (select string_agg(distinct coalesce(pm.fn, split_part(r.recipient, '@', 1)), ', ')
       from (select distinct lower(x.recipient) as recipient
               from acc.notifications x
              where x.created_at between ev.occurred_at - interval '15 seconds'
                                     and ev.occurred_at + interval '15 seconds'
                and nullif(trim(x.recipient), '') is not null
                and lower(x.recipient) <> lower(ev.user_email)) r
       left join pm on pm.e = r.recipient) as names
  from ev
)
update public.erp_usage_events ev
set meta = coalesce(ev.meta, '{}'::jsonb) || jsonb_build_object('assignee', w.names)
from w
where ev.id = w.ev_id and w.names is not null;

-- Which workflow it was, for the events whose step and instance are gone. Only taken when every
-- notification in the window names the same workflow.
with ev as (
  select id, occurred_at
  from public.erp_usage_events
  where feature_key in ('tasks.workflow.forward_a_step',
                        'tasks.workflow.receive_a_step',
                        'tasks.workflow.start_a_new_instance',
                        'tasks.workflow.reject_send_a_step_back',
                        'tasks.workflow.revert_a_forwarded_step',
                        'tasks.workflow.mark_final_step_done')
    and not coalesce(meta ? 'workflow', false)
),
w as (
  select ev.id as ev_id,
    (select case when count(distinct nm) = 1 then min(nm) end
       from (select nullif(trim(regexp_replace(x.title, '^New workflow step\s*:\s*', '')), '') as nm
               from acc.notifications x
              where x.title like 'New workflow step:%'
                and x.created_at between ev.occurred_at - interval '15 seconds'
                                     and ev.occurred_at + interval '15 seconds') t) as flow_name
  from ev
)
update public.erp_usage_events ev
set meta = coalesce(ev.meta, '{}'::jsonb) || jsonb_build_object('workflow', w.flow_name)
from w
where ev.id = w.ev_id and w.flow_name is not null;
