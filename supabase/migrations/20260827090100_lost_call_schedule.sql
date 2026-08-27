-- The two scheduled jobs behind the pipeline. Run AFTER 20260827090000_lost_call_pipeline.sql.
--
-- pg_cron schedules in UTC. The application timezone is Asia/Kolkata (UTC+05:30), so:
--   00:00 IST  ==  18:30 UTC the previous day  ->  '30 18 * * *'
-- The function itself works out "yesterday" in IST at call time, so nothing here encodes a date.
--
-- Neither job passes a secret in the clear: pg_cron reads acc.job_secrets, a token the DATABASE
-- generated for itself, and the edge function checks it with its service-role key. No human ever
-- invents or pastes a password, and the Gemini key never leaves Edge Function Secrets.

-- 1. THE DAILY FETCH — 00:00 IST, previous calendar day, once.
select cron.unschedule('transcription-sync-pull')
where exists (select 1 from cron.job where jobname = 'transcription-sync-pull');

select cron.schedule('transcription-sync-pull', '30 18 * * *', $job$
  select net.http_post(
    url     := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/transcription-sync',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n',
                 'x-sync-secret',(select value from acc.job_secrets where name='transcription_sync')),
    body    := '{"action":"pull"}'::jsonb,
    timeout_milliseconds := 60000);
$job$);

-- 2. THE FIFO WORKER — one call per tick, every minute.
-- One tick takes exactly ONE recording off the front of the queue and does not return until that
-- call has reached a terminal state, so the every-minute cadence is a heartbeat, not parallelism:
-- the function refuses to start anything while a call is genuinely in flight. A minute is also what
-- makes it self-healing — a killed invocation is picked up on the next tick rather than stalling
-- the day.
select cron.unschedule('transcription-sync-work')
where exists (select 1 from cron.job where jobname = 'transcription-sync-work');

select cron.schedule('transcription-sync-work', '* * * * *', $job$
  select net.http_post(
    url     := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/transcription-sync',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n',
                 'x-sync-secret',(select value from acc.job_secrets where name='transcription_sync')),
    -- No engine or model here on purpose: the model is GEMINI_MODEL in Secrets, so changing it is a
    -- secret change and not a cron edit. limit is ignored — the worker is hard-wired to one call.
    body    := '{"action":"work"}'::jsonb,
    timeout_milliseconds := 300000);
$job$);

-- Check:
--   select jobid, jobname, schedule, active from cron.job where jobname like 'transcription-sync%';
--   select * from cron.job_run_details order by start_time desc limit 10;
