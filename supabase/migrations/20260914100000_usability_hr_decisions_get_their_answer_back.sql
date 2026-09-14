/* Usability: the HR Monthly Update decisions get their answer back, where the record still has it.

   Approve and reject are one button that goes two ways, and so are close and reopen hiring. Until
   now the report recorded only that the button was pressed - an approval and a rejection of the
   same requisition read as the same row twice. From here the app records which way it went, in its
   own column, with the position's name in Details.

   For the six events already logged, the record is only able to answer three of them:

     - Two carry the position already (they were reconstructed from the requisition) and the
       requisition still says Approved, so the decision can simply be added.
     - One more matches a requisition approved by the same person within two minutes.
     - Two on 7 September at 2:25 and 2:26 pm match nothing. There are only three requisitions in
       the whole table and all three are Approved, so those two clicks either hit the "only HR can
       approve" guard or landed on a row that was already decided - either way nothing was written
       and nothing can be inferred.
     - The single close/reopen click matches nothing either: no requisition has ever been closed
       (closed_at is null on all of them), so the click did not take.

   The three that cannot be answered keep their dash. Guessing "Approved" because that is what the
   other three were would be inventing a management decision, which is the one kind of wrong answer
   this report must never produce. */

update public.erp_usage_events e
   set meta = coalesce(e.meta,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
         'title', (select mr.job_title from hr.manpower_requests mr
                    where lower(mr.approved_by) = lower(e.user_email)
                      and mr.approved_at between e.occurred_at - interval '2 minutes'
                                             and e.occurred_at + interval '2 minutes'
                    order by abs(extract(epoch from (mr.approved_at - e.occurred_at))) limit 1),
         'decision', (select mr.approval_status from hr.manpower_requests mr
                    where lower(mr.approved_by) = lower(e.user_email)
                      and mr.approved_at between e.occurred_at - interval '2 minutes'
                                             and e.occurred_at + interval '2 minutes'
                    order by abs(extract(epoch from (mr.approved_at - e.occurred_at))) limit 1)))
 where e.feature_key = 'hr.monthly_update.approve_reject_requisition'
   and e.user_email is not null
   and not coalesce(e.meta ? 'decision', false)
   and exists (select 1 from hr.manpower_requests mr
                where lower(mr.approved_by) = lower(e.user_email)
                  and mr.approval_status is not null
                  and mr.approved_at between e.occurred_at - interval '2 minutes'
                                         and e.occurred_at + interval '2 minutes');

/* The two reconstructed rows point straight at their requisition through the ref the first pass
   left behind ('mpra:<id>'), so they need no time-matching at all. */
update public.erp_usage_events e
   set meta = coalesce(e.meta,'{}'::jsonb) || jsonb_build_object('decision', mr.approval_status)
  from hr.manpower_requests mr
 where e.feature_key = 'hr.monthly_update.approve_reject_requisition'
   and e.meta->>'ref' = 'mpra:'||mr.id
   and mr.approval_status is not null
   and not coalesce(e.meta ? 'decision', false);
