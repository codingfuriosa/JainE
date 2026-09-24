-- FORWARD-ONLY: new assessments from 2026-09-24 00:00 IST use the narrowed visit-pending carve-out.
--
-- Before 2026-09-21, deriveStatusMatch excused ANY "Qualified" verdict with visit_pending true against
-- a CRM status of "In Follow Up" as a match - regardless of whether the lead had ever qualified before.
-- The fix added a guard: that excuse only holds when the lead was ALREADY qualified on an earlier call
-- (see crm-snapshot-qa/index.ts, priorQualified). A lead qualifying for the FIRST time, with only the
-- site visit unsettled, is a real "in_followup_should_have_been_qualified" mismatch and always was one
-- under the fixed rule - it just was not re-scored on the calls that had already been assessed by the
-- time the fix shipped.
--
-- This is corrected here WITHOUT re-deriving the ratchet history: deriveStatusMatch already saved its
-- own prior-qualification finding on every row, verbatim, in status_assessment.prior_qualification
-- (see index.ts's `prior_qualification: priorQual`) - that finding was never wrong, only which verdict
-- the pipeline drew from it was. So a row is stale, and only a row is stale, when all of these hold:
--   - the CRM says In Follow Up and the call was assessed Qualified with visit_pending true (the
--     combination the old rule excused unconditionally)
--   - it is currently scored as a match (status_match = true, mismatch_type = null) - the old verdict
--   - its OWN stored prior_qualification.qualified is false (or the field is absent - a lead's very
--     first assessed call has prior_qualification: null, which is exactly "never qualified before")
-- A row already re-assessed under the fixed code cannot match this filter: either priorQualified was
-- true and it is still (correctly) a match, or it was false and mismatch_type is already
-- 'in_followup_should_have_been_qualified', not null. So this UPDATE is naturally idempotent and can
-- never touch a row twice or a row the running pipeline just got right.
begin;

-- No historical backfill. The narrowed visit-pending rule applies only to new assessments from the
-- effective processing date onward; existing QA rows and dashboard results stay unchanged.

commit;
