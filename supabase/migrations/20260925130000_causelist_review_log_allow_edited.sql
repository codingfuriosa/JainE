-- Causelist Reviews entries can now be edited after being answered (change action-needed/no-action,
-- due date, or responsible person). A follow-up save on an already-answered case logs 'edited'
-- rather than 'answered', so the history timeline shows the original decision and every change to
-- it separately, instead of the second save overwriting the first as if it were the first answer.
alter table public.mis_causelist_review_log drop constraint if exists mis_causelist_review_log_event_check;
alter table public.mis_causelist_review_log add constraint mis_causelist_review_log_event_check
  check (event in ('exported','answered','edited','closed_without_answering'));
