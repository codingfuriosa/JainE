-- Usability: "Start a new instance" was counting clicks, not instances.
--
-- What the drill-down showed - several rows at the same minute, no Details, no Assigned to - is
-- two separate things, and only one of them is a data fault.
--
-- 1. NOT a fault: the report prints the time to the minute, so three events 11 and 14 seconds
--    apart all read "07:43 pm" and look like the same row three times. That is fixed in the
--    report itself, which now shows seconds.
--
-- 2. NOT a fault: the same three names in Assigned to over and over. Reimbursement's first step
--    always goes to hr@, mgr.hr@ and career@, so every claim really does start with those three.
--
-- 3. A fault: until this week the event was logged by wrapping the form's Save button, so it fired
--    when the button was pressed rather than when an instance was created. A save that failed
--    validation, or a click that repeated, was counted the same as a filed instance. The evidence
--    is unambiguous - one burst has seven events inside 1.3 seconds with no flow_case and no
--    notification anywhere near them, and a workflow instance cannot be filled in and submitted
--    seven times in a second.
--
-- So: at most one instance start per person per five seconds. Nobody fills a form or picks files
-- twice in that time. The earliest of each burst is kept - it is the click that did the work -
-- and the rest are archived, not dropped, in erp_usage_events_removed_20260910.
--
-- The same collapse is applied to the tracker's search box, which logged one event per keystroke:
-- typing a bill number counted as three or four searches. There the LAST of the burst is kept,
-- because that one carries the complete query.
--
-- Deliberately NOT applied to forward_a_step or receive_a_step. Their bursts look identical but
-- are real: checked against the notifications each forward sends, the counts match or exceed the
-- events, so those are people working through a queue quickly, not double-counting.
--
-- Current code already logs after acc.wf_create_instance returns, so nothing new can be counted
-- this way again.

create table if not exists public.erp_usage_events_removed_20260910
  (like public.erp_usage_events including defaults);

with e as (
  select id, feature_key, user_email, occurred_at,
         lag(occurred_at) over (partition by feature_key, lower(user_email) order by occurred_at) prev
    from public.erp_usage_events
   where feature_key in ('tasks.workflow.start_a_new_instance',
                         'tasks.workflow.search_filter_the_tracker')
), g as (
  select e.*,
         sum(case when prev is null or occurred_at - prev > interval '5 seconds' then 1 else 0 end)
           over (partition by feature_key, lower(user_email) order by occurred_at) gid
    from e
), keep as (
  -- the click that did the work for a start; the finished query for a search
  select distinct on (feature_key, lower(user_email), gid) id
    from g
   order by feature_key, lower(user_email), gid,
            case when feature_key = 'tasks.workflow.search_filter_the_tracker'
                 then occurred_at end desc nulls last,
            occurred_at asc
), drop_ids as (
  select g.id from g where g.id not in (select id from keep)
)
insert into public.erp_usage_events_removed_20260910
select ev.* from public.erp_usage_events ev
 where ev.id in (select id from drop_ids)
   and not exists (select 1 from public.erp_usage_events_removed_20260910 r where r.id = ev.id);

delete from public.erp_usage_events ev
 where exists (select 1 from public.erp_usage_events_removed_20260910 r where r.id = ev.id);

-- Details for the events that still have none. The notification a start or a forward sends carries
-- the workflow's name in its title, and survives even when the instance itself was deleted. Taken
-- from the single nearest notification instant rather than every notification in a window, so two
-- instances started close together are not merged into one blurred answer.
with ev as (
  select id, occurred_at from public.erp_usage_events
   where feature_key like 'tasks.workflow.%'
     and not coalesce(meta ? 'workflow', false)
), near as (
  select ev.id as ev_id,
         (select nullif(trim(regexp_replace(n.title, '^New workflow step\s*:\s*', '')), '')
            from acc.notifications n
           where n.title like 'New workflow step:%'
             and n.created_at between ev.occurred_at - interval '25 seconds'
                                  and ev.occurred_at + interval '25 seconds'
           order by abs(extract(epoch from (n.created_at - ev.occurred_at)))
           limit 1) as flow_name
    from ev
)
update public.erp_usage_events ev
   set meta = coalesce(ev.meta, '{}'::jsonb) || jsonb_build_object('workflow', near.flow_name)
  from near
 where ev.id = near.ev_id and near.flow_name is not null;
