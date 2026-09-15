-- Usability: the blank "Start a new instance" rows were clicks that created nothing.
--
-- Until 9 September the event was logged by wrapping the form's Save button, so it fired on the
-- press, not on the result. acc.wf_create_instance can and does refuse a press - most often the
-- "one open claim at a time" rule, which rejects a second Reimbursement while the person still
-- has one waiting for their own confirmation - and every refusal was counted as a filed instance.
--
-- Those rows are exactly the ones showing blank Details and blank Assigned to, and the blank is
-- not a display fault: the click-time wrapper captured nothing, and there is no instance, no task
-- and no notification anywhere near them to identify afterwards. There is nothing to print
-- because nothing happened.
--
-- The retry pattern is unmistakable once the two are put side by side, e.g. Shafat Mehar on
-- 8 September:
--
--   08:31:35  blank      08:36:09  blank
--   08:32:03  blank      08:37:28  blank
--   08:32:26  blank      08:40:59  Reimbursement #45   <- the one that worked
--   08:33:14  Reimbursement                            <- the one that worked
--
-- Six blanks and one success for Arijit Sarkar on 1 September; ten blanks and no success at all
-- for Sayan Saha, who has never created a single flow_case.
--
-- Removed here: events before 9 September that carry no workflow of their own AND have no
-- flow_case, no workflow task and no "New workflow step" notification within 25 seconds either
-- side. All three are checked because any one of them alone can go missing - instances get
-- deleted, and a notification is skipped when the first step lands back on the person who
-- started it. Only when all three are absent is there nothing that says the press did anything.
--
-- The 9 September cut-off is where accountability.js started logging after the RPC returns
-- (commit 545140b), so anything from that date on records a real instance and is left alone even
-- when its case has since been deleted.
--
-- Archived, not dropped, in erp_usage_events_removed_20260910.

create table if not exists public.erp_usage_events_removed_20260910
  (like public.erp_usage_events including defaults);

with e as (
  select * from public.erp_usage_events
   where feature_key = 'tasks.workflow.start_a_new_instance'
     and occurred_at < timestamptz '2026-09-09 00:00:00+05:30'
     and not coalesce(meta ? 'workflow', false)
), nt as (
  select e.* from e
   where not exists (select 1 from acc.notifications n
                      where n.title like 'New workflow step:%'
                        and n.created_at between e.occurred_at - interval '25 seconds'
                                             and e.occurred_at + interval '25 seconds')
     and not exists (select 1 from acc.flow_cases fc
                      where fc.created_at between e.occurred_at - interval '25 seconds'
                                              and e.occurred_at + interval '25 seconds')
     and not exists (select 1 from acc.ptasks t
                      where t.flow_case_step_id is not null
                        and t.created_at between e.occurred_at - interval '25 seconds'
                                             and e.occurred_at + interval '25 seconds')
)
insert into public.erp_usage_events_removed_20260910
select nt.* from nt
 where not exists (select 1 from public.erp_usage_events_removed_20260910 r where r.id = nt.id);

delete from public.erp_usage_events ev
 where exists (select 1 from public.erp_usage_events_removed_20260910 r where r.id = ev.id);
