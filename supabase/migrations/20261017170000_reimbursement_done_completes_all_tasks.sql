-- REIMBURSEMENT: WHEN THE CLAIMANT CONFIRMS THE PAYMENT, EVERY TASK ON THE CLAIM IS COMPLETED.
--
-- (17 Oct 2026) Forwarding a step leaves its task "Awaiting Approval" (wf_forward), and for a
-- workflow task nobody ever approves it - so HR's and Accounts' tasks on a claim the claimant has
-- long since confirmed sat in Awaiting Approval for good (84 of them). Once the claim is Done -
-- the claimant's "Payment Received" Done, which is acc.wf_done setting flow_cases.status - every
-- task on it is Completed, dated when the claim finished. Reimbursement only (flow 39); claims
-- still in progress keep their forwarded tasks in Awaiting Approval until then.

create or replace function acc.reimbursement_done_complete_tasks()
returns trigger
language plpgsql security definer
set search_path to 'acc','public'
as $function$
begin
  update acc.ptasks t
     set status = 'Completed', approval_state = 'approved', progress = 100,
         approved_at = coalesce(t.approved_at, now()),
         approved_by = coalesce(t.approved_by, 'system'),
         completed_at = coalesce(t.completed_at, now())
    from acc.flow_case_steps s
   where s.case_id = new.id and t.id = s.task_id and t.status <> 'Completed';
  return null;
exception when others then
  return null;   -- tidying tasks must never stop a claim being closed
end $function$;

drop trigger if exists trg_reimbursement_done_complete_tasks on acc.flow_cases;
create trigger trg_reimbursement_done_complete_tasks
  after update of status on acc.flow_cases
  for each row
  when (new.flow_id = 39 and new.status = 'Done' and old.status is distinct from 'Done')
  execute function acc.reimbursement_done_complete_tasks();

-- Claims already Done: their leftover tasks are Completed as of when the claim finished (the last
-- step's Done), not today - so they go to the archive rather than into "Completed this week".
update acc.ptasks t
   set status = 'Completed', approval_state = 'approved', progress = 100,
       approved_at = coalesce(t.approved_at, fin.done_at),
       approved_by = coalesce(t.approved_by, 'system'),
       completed_at = coalesce(t.completed_at, fin.done_at)
  from acc.flow_case_steps s
  join acc.flow_cases c on c.id = s.case_id
  join lateral (select coalesce(max(x.forwarded_at), c.updated_at) done_at
                  from acc.flow_case_steps x where x.case_id = c.id) fin on true
 where t.id = s.task_id and c.flow_id = 39 and c.status = 'Done' and t.status <> 'Completed';
