-- SELF-HEALING FOR daily_qa_summary, by requirement (2026-09-19): "the whole daily-aggregate system
-- depends on triggers firing correctly... the dashboard numbers can go quietly wrong until someone
-- notices and re-runs the recompute" - exactly what happened with 20260918044629's insert-trigger bug.
--
-- The fix is not a smarter trigger - a trigger can always break again the same way a future migration
-- accidentally regresses one. Instead: a cron job that unconditionally recomputes the last 14 days
-- every day, whether or not anything actually changed. If a trigger silently stops firing tomorrow, the
-- worst case is one day of a wrong dashboard number before this job quietly corrects it on its own -
-- not an indefinite drift that only a human happening to notice ever fixes. 14 days of trailing overlap
-- means every date gets re-verified roughly fourteen times before it ages out of the window, at the
-- cost of one cheap, already-indexed aggregation query per date (crm_recompute_daily_qa_summary reads
-- off call_date/lead_id/is_latest_assessed, all indexed - see 20260919091500).
--
-- Scheduled for 07:00 UTC (12:30 IST): well after crm-snapshot-qa-work's own window closes (05:59 UTC /
-- 11:29 IST), so it never competes with the night's actual transcription work, and well before the next
-- midnight snapshot (18:30 UTC) picks up wherever today leaves off.
--
-- Purely additive and read-only against crm_followups/followup_qa/transcription_queue - this only ever
-- writes to acc.daily_qa_summary, the same table crm_recompute_daily_qa_summary already owns. Nothing
-- historical is deleted or altered beyond what a normal recompute already does.
select cron.unschedule('daily-qa-summary-reconcile')
where exists (select 1 from cron.job where jobname = 'daily-qa-summary-reconcile');

select cron.schedule('daily-qa-summary-reconcile', '0 7 * * *', $job$
  select acc.crm_recompute_daily_qa_summary(
    (select array_agg(d::date) from generate_series(current_date - interval '13 days', current_date, interval '1 day') d)
  );
$job$);
