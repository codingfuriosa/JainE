-- Fix: overdue/due reminder emails kept going to a user after they forwarded
-- their workflow step. due_email_batch() only excluded tasks with
-- approval_state = 'approved', so the forwarder's stale ptasks row (left at
-- approval_state = 'awaiting_approval' by acc.wf_forward, with its old
-- ptask_assignees entry never removed) kept matching every night. Exclude any
-- task whose linked flow_case_steps row has since been forwarded away.
create or replace function public.due_email_batch()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'acc', 'public'
as $function$
declare res jsonb;
begin
  select coalesce(jsonb_agg(x),'[]'::jsonb) into res from (
    select jsonb_build_object(
      'id', p.id,
      'title', p.title,
      'due_date', p.due_date,
      'kind', case when p.due_date < current_date then 'overdue' else 'due' end,
      'overdue', (p.due_date < current_date),
      'members', (select coalesce(jsonb_agg(a.email),'[]'::jsonb) from acc.ptask_assignees a where a.task_id=p.id)
    ) as x
    from acc.ptasks p
    where p.approval_state <> 'approved' and p.due_date is not null
      and ( (p.due_date = current_date and coalesce(p.due_emailed,false) = false)
         or (p.due_date <  current_date and coalesce(p.overdue_emailed,false) = false) )
      and not exists (
        select 1 from acc.flow_case_steps fcs
        where fcs.id = p.flow_case_step_id and fcs.forwarded_at is not null
      )
  ) q;
  return res;
end $function$;
