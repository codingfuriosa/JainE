-- INVOICE PROCESSING: THE SIGNED CHEQUE GOES BACK TO SUSANTA GHOSH, NOT MITRABARUN GHOSH.
--
-- On Invoice Processing (flow 26) two steps are decided per bill rather than fixed on the flow:
-- step 1 "Dept Check" and step 10 "Signed Cheque Sent to Dept". Both are owner_from_trigger, so
-- whoever raises the bill names the same department person for each - the bill goes out to them for
-- checking, and the signed cheque comes back to them at the end.
--
-- By requirement that return leg now goes to Susanta Ghosh (gm.commercial@thejaingroup.com) for
-- every bill whose department person is Mitrabarun Ghosh (sm.projects1@thejaingroup.com). Dept
-- Check is NOT touched: the bill still goes to Mitrabarun to be checked. Only the cheque comes back
-- to somebody else.
--
-- WHAT IS AND IS NOT MOVED. "Leave the ones that have passed; change the ones before the step or at
-- it." A step 10 row that is already done is a record of something that happened and is left
-- exactly as it is. A row still pending is work not yet done, and moves. At the time of writing
-- that is 30 bills: 29 sitting at steps 1, 2, 4 and 5, and one - bill 123 - sitting AT step 10 this
-- minute. No step 10 row with Mitrabarun on it has ever been completed, so nothing is rewritten
-- behind anybody.
--
-- Bill 123 also has an open task in Mitrabarun's list. Changing the step alone would leave it
-- there, so the task's assignee and its position in the list move with it - otherwise the step says
-- Susanta while the job still sits in Mitrabarun's day.

begin;

-- 1. The bills in flight -----------------------------------------------------------------------

create temporary table _moving on commit drop as
select cs.id as fcs_id, cs.task_id
from acc.flow_case_steps cs
join acc.flow_cases c on c.id = cs.case_id
where c.flow_id = 26
  and cs.seq = 10
  and cs.status = 'pending'
  and cs.person = 'sm.projects1@thejaingroup.com';

update acc.flow_case_steps cs
   set person     = 'gm.commercial@thejaingroup.com',
       candidates = array['gm.commercial@thejaingroup.com']
  from _moving m
 where cs.id = m.fcs_id;

-- 2. The one that is live, so the job moves out of his list too ---------------------------------

insert into acc.ptask_assignees (task_id, email)
select m.task_id, 'gm.commercial@thejaingroup.com'
  from _moving m where m.task_id is not null
on conflict do nothing;

insert into acc.task_rank (task_id, viewer_email, rank)
select m.task_id, 'gm.commercial@thejaingroup.com',
       coalesce((select max(r.rank) from acc.task_rank r
                  where lower(r.viewer_email) = 'gm.commercial@thejaingroup.com'), 0) + 1
  from _moving m where m.task_id is not null
on conflict (task_id, viewer_email) do nothing;

delete from acc.ptask_assignees a
 using _moving m
 where a.task_id = m.task_id
   and a.email = 'sm.projects1@thejaingroup.com';

delete from acc.task_rank r
 using _moving m
 where r.task_id = m.task_id
   and lower(r.viewer_email) = 'sm.projects1@thejaingroup.com';

commit;

-- 3. Every bill raised from now on ---------------------------------------------------------------
--
-- Without this the rule would hold only for today's 30 bills and the next one raised would go
-- straight back to Mitrabarun. The person raising a bill still picks the department person on the
-- form exactly as before - nothing about the form changes, and nobody has to remember this - the
-- swap happens as the step is written.
--
-- Keyed on step_id 285, which IS "Signed Cheque Sent to Dept" on Invoice Processing. Matching on
-- the title would quietly stop working the day somebody renames the step, and matching on seq alone
-- would catch step 10 of every other workflow.

create or replace function acc.invoice_signed_cheque_reroute()
returns trigger
language plpgsql
as $function$
begin
  if new.step_id = 285
     and (new.person = 'sm.projects1@thejaingroup.com'
          or new.candidates = array['sm.projects1@thejaingroup.com']) then
    new.person     := 'gm.commercial@thejaingroup.com';
    new.candidates := array['gm.commercial@thejaingroup.com'];
  end if;
  return new;
end
$function$;

comment on function acc.invoice_signed_cheque_reroute() is
  'Invoice Processing step 10 (Signed Cheque Sent to Dept): bills checked by Mitrabarun Ghosh have '
  'their signed cheque returned to Susanta Ghosh instead. Dept Check is untouched.';

drop trigger if exists trg_invoice_signed_cheque_reroute on acc.flow_case_steps;
create trigger trg_invoice_signed_cheque_reroute
  before insert on acc.flow_case_steps
  for each row
  execute function acc.invoice_signed_cheque_reroute();
