/* A CAUSELIST TASK HAS NOBODY WAITING TO APPROVE IT.

   WHERE THESE TASKS COME FROM.
   Export a causelist from Legal MIS and a popup asks, matter by matter, whether it needs action.
   Every "action needed" answer files one task against the Legal person named in it, with a due
   date on or before the hearing (clrevSaveOneRow in src/core/10-legal-mis.js, source='causelist').

   WHY THE APPROVAL STEP IS WRONG FOR THEM.
   acc.ptasks treats the delegator as the person who approves the work: whoever is assigned marks
   it done, it goes to 'awaiting_approval', and the delegator has to say yes before it counts as
   finished. These tasks carry delegator='businessanalyst@thejaingroup.com' because that is the
   account the popup writes them under - not because anybody there is supervising the hearing.
   So every one of them came back to that single address to be rubber-stamped: six of six so far,
   all approved by the same address that created them. The approval is a formality that delays the
   record and buries the queue that holds the approvals that do matter.

   WHAT THIS CHANGES.
   A causelist task that reaches 'awaiting_approval' is completed on the spot instead. Because this
   runs BEFORE the row is written, acc.trg_task_approval_notify - which fires AFTER and would have
   sent the delegator "Task ready for approval" - sees an already-approved row and sends nothing.

   SCOPE. The trigger's WHEN clause is source = 'causelist' and nothing else: no other task in
   Accountability, Workflow, HR or Notices is touched, and nothing already in the table is
   rewritten (every causelist task that exists today is already approved). Legal notices keep
   their own separate arrangement, which lives in accountability.js. */

create or replace function acc.causelist_task_self_approves()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'acc', 'public'
as $function$
begin
  if coalesce(new.source,'') <> 'causelist' then return new; end if;
  if new.approval_state = 'awaiting_approval' then
    new.approval_state := 'approved';
    new.status         := 'Completed';
    new.progress       := 100;
    new.completed_at   := coalesce(new.completed_at, now());
    new.approved_at    := coalesce(new.approved_at, now());
    -- whoever ticked it off; the delegator only as a fallback when there is no session to read
    new.approved_by    := coalesce(new.approved_by, app.current_user_email(), new.delegator);
  end if;
  return new;
end;
$function$;

drop trigger if exists causelist_self_approve on acc.ptasks;
create trigger causelist_self_approve
  before update on acc.ptasks
  for each row
  when (new.source = 'causelist')
  execute function acc.causelist_task_self_approves();
