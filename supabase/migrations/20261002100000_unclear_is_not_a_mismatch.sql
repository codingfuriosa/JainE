-- REVERSES 20260923090000: an AI status of "Unclear" is no longer a mismatch. When the AI cannot judge
-- the real status from the call there is nothing to compare with the CRM, so the call neither agrees
-- nor disagrees (status_match null, mismatch_type null) and drops out of the mismatch totals again.
-- deriveStatusMatch in crm-snapshot-qa/index.ts does the same for new QA. The 'ai_status_unclear'
-- value stays allowed by the constraint and the summary columns stay, so nothing else has to change.
begin;

create temp table _unclear_dates on commit drop as
  select distinct call_date as d from acc.followup_qa
  where mismatch_type = 'ai_status_unclear' and call_date is not null;

update acc.followup_qa set status_match = null, mismatch_type = null
 where mismatch_type = 'ai_status_unclear';

select acc.crm_recompute_daily_qa_summary(array(select d from _unclear_dates));

commit;
