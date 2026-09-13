-- Usability: a workflow step is not somebody clicking "Create task".
--
-- Khusbu Singh's drill-down showed nine uses of "Create task". She has never created a task -
-- she forwards Reimbursement steps. Uma Chatterjee's showed sixty-six, all "Invoice Processing".
-- The cause is in the historical backfill, which built one create_task event per acc.ptasks row
-- and took the person from ptasks.created_by. For a workflow-generated task that column holds
-- whoever forwarded the step, because forwarding is what made the row - so every forward down a
-- workflow was counted, and reported, as that person creating a task.
--
-- acc.ptasks.flow_case_step_id is the discriminator: 325 of 912 tasks were made by the workflow
-- engine, not by a person. 187 of the 629 create_task events point at those (20 whose task still
-- exists, 167 whose task was deleted along with its instance - recognised by the notification the
-- step generated, "New workflow step: ..."). None of them represent a use of Create task, and the
-- work they stand for is already counted where it belongs: every one of the 20 has a
-- "Start a new instance" event for its case, and Forward/Receive have their own 1,449 events.
--
-- The rows are copied out before deletion rather than just dropped - this is a judgement about
-- what an event MEANT, and a judgement should be reversible.
create table if not exists public.erp_usage_events_removed_20260909
  (like public.erp_usage_events including defaults);

with wf as (
  select ev.id
  from public.erp_usage_events ev
  where ev.feature_key = 'tasks.tasks.create_task'
    and ev.meta->>'ref' like 'ptask.new:%'
    and ( exists (select 1 from acc.ptasks p
                   where p.id = split_part(ev.meta->>'ref', ':', 2)::bigint
                     and p.flow_case_step_id is not null)
       or exists (select 1 from acc.notifications n
                   where n.task_id = split_part(ev.meta->>'ref', ':', 2)::bigint
                     and n.title like 'New workflow step:%') )
    -- makes a re-run a no-op: a copy already taken is not taken again
    and not exists (select 1 from public.erp_usage_events_removed_20260909 r where r.id = ev.id)
)
insert into public.erp_usage_events_removed_20260909
select ev.* from public.erp_usage_events ev join wf on wf.id = ev.id;

delete from public.erp_usage_events ev
using public.erp_usage_events_removed_20260909 b
where b.id = ev.id;
