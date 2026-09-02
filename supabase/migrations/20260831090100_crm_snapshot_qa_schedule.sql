-- The two scheduled jobs behind crm-snapshot-qa. Run AFTER 20260831090000_crm_snapshot_qa_pipeline.sql.
--
-- pg_cron schedules in UTC. The application timezone is Asia/Kolkata (UTC+05:30), so:
--   00:00 IST  ==  18:30 UTC the previous day  ->  '30 18 * * *'
-- The function works out "yesterday" in IST at call time, so nothing here encodes a date.
--
-- Neither job passes a secret in the clear: pg_cron reads acc.job_secrets, a token the DATABASE
-- generated for itself, and the edge function checks it with its service-role key. No human ever
-- invents or pastes a password, and neither model key ever leaves Edge Function Secrets.
--
-- These REPLACE the two transcription-sync jobs of 20260827090100_lost_call_schedule.sql. Both
-- pipelines writing at once would transcribe every recording twice, so the old pair is unscheduled
-- here rather than left dormant. The old FUNCTION and its rows are untouched and still serve the
-- Manual Upload and archive tabs.

select cron.unschedule('transcription-sync-pull')
where exists (select 1 from cron.job where jobname = 'transcription-sync-pull');
select cron.unschedule('transcription-sync-work')
where exists (select 1 from cron.job where jobname = 'transcription-sync-work');

-- 1. THE DAILY SNAPSHOT — 00:00 IST, previous calendar day, once.
-- `snapshot` stores the CRM response verbatim, normalises it into the lead/follow-up history and
-- builds the queue. It transcribes nothing: the worker below does that, so a slow model cannot make
-- the fetch time out and lose the day.
select cron.unschedule('crm-snapshot-qa-snapshot')
where exists (select 1 from cron.job where jobname = 'crm-snapshot-qa-snapshot');

select cron.schedule('crm-snapshot-qa-snapshot', '30 18 * * *', $job$
  select net.http_post(
    url     := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/crm-snapshot-qa',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n',
                 'x-sync-secret',(select value from acc.job_secrets where name='transcription_sync')),
    body    := '{"action":"snapshot"}'::jsonb,
    timeout_milliseconds := 120000);
$job$);

-- 2. THE SEQUENTIAL WORKER — every minute through the night.
-- One tick takes the head of the queue and advances it ONE phase (transcribe, or QA), then stops;
-- the function refuses to start anything while a recording is in flight, so the every-minute cadence
-- is a heartbeat and not parallelism. It is also what makes the queue self-healing: an invocation
-- killed by the edge worker's time limit is reclaimed on a later tick instead of stalling the night.
--
-- 19:00-05:59 UTC is 00:30-11:29 IST. The window exists because the work is a night job and an empty
-- tick still costs an invocation - outside it there is nothing in the queue to take. Widen it if a
-- day's backlog is ever still draining at 11:30 IST.
select cron.unschedule('crm-snapshot-qa-work')
where exists (select 1 from cron.job where jobname = 'crm-snapshot-qa-work');

select cron.schedule('crm-snapshot-qa-work', '* 19-23,0-5 * * *', $job$
  select net.http_post(
    url     := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/crm-snapshot-qa',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n',
                 'x-sync-secret',(select value from acc.job_secrets where name='transcription_sync')),
    -- No model named here on purpose: the transcriber reads GEMINI_MODEL and the judge reads
    -- OPENAI_QA_MODEL from Edge Function Secrets, so changing either model is a secret change and not
    -- a cron edit. A model pinned in this body would silently override the secret and make the next
    -- change look like it had no effect. This is comment only - the schedule, the body and the
    -- timeout are exactly as first applied, and the QA vendor move needed no change here.
    body    := '{"action":"work"}'::jsonb,
    timeout_milliseconds := 300000);
$job$);

-- Check:
--   select jobid, jobname, schedule, active from cron.job where jobname like 'crm-snapshot-qa%';
--   select * from cron.job_run_details order by start_time desc limit 10;
