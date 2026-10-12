-- 2026-09-17's overnight snapshot failed with "canceling statement due to statement timeout":
-- crm_normalise_snapshot and crm_build_queue are called via the edge function's PostgREST RPC path,
-- which authenticates as the `authenticator` role - and authenticator has statement_timeout=8s
-- (a deliberate cap protecting the public API from slow ad-hoc requests). Neither function had its
-- own timeout override, so that cap applied to them too. The 17th's raw feed (1.62MB, 188 leads) was
-- the largest of the week and pushed normalise past 8 seconds; it never reached crm_build_queue, so
-- crm_followups gained zero rows for the day and there was nothing for the worker to transcribe.
--
-- A function-level SET overrides the caller's session default for the duration of that call only,
-- without touching authenticator's 8s cap for every other (much smaller, latency-sensitive) request.
-- 90s keeps comfortable margin under the snapshot cron job's own 120000ms net.http_post timeout
-- (20260831090100_crm_snapshot_qa_schedule.sql), so a genuinely stuck query still fails cleanly
-- inside the edge function's own budget instead of being killed by it mid-write.
alter function public.crm_normalise_snapshot(bigint, integer) set statement_timeout = '90s';
alter function public.crm_build_queue(bigint, integer) set statement_timeout = '90s';
