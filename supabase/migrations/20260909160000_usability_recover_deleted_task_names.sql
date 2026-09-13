-- Usability drill-down: recover Details and Assigned to for tasks that no longer exist.
--
-- 176 of the 629 create_task events pointed at acc.ptasks rows that have since been
-- deleted, so there was no title to show and the popup fell back to printing the raw
-- marker ("Ref: ptask.new:835 - Backfill: true"). The task is gone, but the
-- notification it generated is not: acc.notifications still holds one row per
-- delegation, carrying the task's name in its title and the assignee in recipient.
--
-- Names arrive prefixed by the notification's phrasing ("New workflow step: Invoice
-- Processing"), so the prefix is stripped to leave the task name itself. Where a task
-- has several notifications the delegation one is preferred, then the earliest.
--
-- Additive and idempotent: only events still missing the key are touched, so re-running
-- changes nothing. 169 of the 176 recovered; the remaining 7 have no notification
-- either and stay blank.
with miss as (
  select ev.id as ev_id, split_part(ev.meta->>'ref', ':', 2)::bigint as tid
  from public.erp_usage_events ev
  where ev.meta->>'ref' like 'ptask.new:%'
    and ev.meta->>'title' is null
),
cand as (
  select n.task_id as tid,
         nullif(trim(regexp_replace(n.title,
           '^(New workflow step|New task delegated|New task|New sub-task|Rejected back to you)\s*:\s*', '')), '') as nm,
         row_number() over (partition by n.task_id
                            order by (n.kind = 'task_delegated') desc, n.id) as rn
  from acc.notifications n
  where n.task_id in (select tid from miss)
    and nullif(trim(n.title), '') is not null
)
update public.erp_usage_events ev
set meta = ev.meta || jsonb_build_object('title', c.nm)
from miss m
join cand c on c.tid = m.tid and c.rn = 1
where ev.id = m.ev_id
  and c.nm is not null;

-- Same source for the assignee: the delegation notification's recipient is the person
-- the task went to. Names come from acc.user_profile, falling back to the email prefix
-- for accounts with no profile name.
with miss as (
  select ev.id as ev_id, split_part(ev.meta->>'ref', ':', 2)::bigint as tid
  from public.erp_usage_events ev
  where ev.meta->>'ref' like 'ptask.new:%'
    and not (ev.meta ? 'assignee')
),
pm as (
  select lower(email) as e, nullif(trim(full_name), '') as fn
  from acc.user_profile
  where nullif(trim(full_name), '') is not null
),
w as (
  select n.task_id as tid,
         string_agg(distinct coalesce(pm.fn, split_part(lower(n.recipient), '@', 1)), ', ') as names
  from acc.notifications n
  left join pm on pm.e = lower(n.recipient)
  where n.task_id in (select tid from miss)
    and n.kind = 'task_delegated'
    and nullif(trim(n.recipient), '') is not null
  group by n.task_id
)
update public.erp_usage_events ev
set meta = ev.meta || jsonb_build_object('assignee', w.names)
from miss m
join w on w.tid = m.tid
where ev.id = m.ev_id
  and w.names is not null;
