-- Bug in 20260917110000: _daily_qa_summary_touch_followups() (bound to the INSERT-only trigger
-- crm_followups_daily_summary_ins, which only binds `new table as new_followups`) unioned in a query
-- against `old_followups` too - a transition table that only exists on the UPDATE trigger. Every insert
-- into acc.crm_followups since that migration went live has therefore failed outright with
-- "relation \"old_followups\" does not exist", not just risked a timeout. This is almost certainly why
-- the 2026-09-17 overnight snapshot's crm_normalise_snapshot call failed: the insert into crm_followups
-- itself was erroring, on top of whatever margin the 8s authenticator timeout (see
-- 20260918120000) already had left. Left unfixed, tonight's midnight run fails the same way regardless
-- of the timeout increase.
--
-- Fix: match what the comment already said the insert-only path was supposed to do - read only
-- new_followups, no union, no old_followups reference.
create or replace function acc._daily_qa_summary_touch_followups() returns trigger
language plpgsql as $$
declare dates date[];
begin
  select array_agg(distinct call_date) into dates from new_followups where call_date is not null;
  perform acc.crm_recompute_daily_qa_summary(dates);
  return null;
end;
$$;
