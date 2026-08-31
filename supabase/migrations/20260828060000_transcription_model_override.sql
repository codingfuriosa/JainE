-- TEMPORARY: pin the FIFO worker to gemini-flash-latest from the cron body.
--
-- WHY THIS EXISTS. On 2026-08-27 Google withdrew gemini-2.5-pro from this API project mid-run:
--
--   404 models/gemini-2.5-pro is no longer available to new users.
--
-- That failed 6 of that day's 117 calls outright (a further 4 failed on a transient 503 during the
-- same window, for 10 total). The deployed edge function still has the withdrawn model as its
-- compiled-in default, so every call it makes 404s until that default changes.
--
-- The model belongs in GEMINI_MODEL in Edge Function Secrets - 20260827090100_lost_call_schedule.sql
-- says so explicitly, and it is right: a secret is one value read by every caller, whereas this cron
-- body only covers the automatic worker. Setting a secret needs Management API credentials that were
-- not available when the pipeline had to be brought back up, so this is the stopgap that got the
-- nightly run working again.
--
-- >>> REMOVE THIS MIGRATION'S CHANGE once EITHER of these is done:
-- >>>   supabase secrets set GEMINI_MODEL=gemini-flash-latest --project-ref rkxsgtauigjrpcjkmccu
-- >>>   supabase functions deploy transcription-sync --project-ref rkxsgtauigjrpcjkmccu --no-verify-jwt
-- >>> (the deployed default on main is already gemini-flash-latest)
-- >>>
-- >>> A per-request `gemini_model` OVERRIDES the secret. Leaving this in place after setting the
-- >>> secret means the secret is silently ignored and the next model change appears not to work.
-- >>> To revert, re-run the cron.schedule block in 20260827090100_lost_call_schedule.sql.
--
-- WHAT THIS DOES NOT FIX. The dashboard's own Retry button (traRetry in nexus-core.js) posts
-- {action:'retry', id} with no model, so a hand-triggered retry still uses the deployed default and
-- will still 404. Only the secret or a deploy fixes that path.
--
-- ALSO CHANGED HERE: the tick, from '* * * * *' to '10 seconds'.
--
-- One invocation of `work` handles exactly ONE recording and returns; that is deliberate and is not
-- changed here. But at a one-minute tick, a call taking ~12s was followed by ~48s of nothing, so a
-- backlog of n calls took n minutes of mostly idle waiting. A 10s tick keeps the pipeline strictly
-- serial - the function still refuses to start anything while a call is in flight, so there is never
-- more than one Gemini request at a time - while cutting the dead gap between calls from up to 60s
-- to about 10s. Draining nine calls went from ~9 minutes to ~2.
--
-- The cost is empty ticks: ~8,640 invocations a day instead of 1,440, almost all of them a single
-- indexed query that finds nothing to claim and returns. If that ever needs reducing, the better fix
-- is in the function rather than the schedule - let one `work` invocation keep taking calls until
-- the queue is empty or it approaches the edge worker's time limit, and put the tick back to a
-- minute. That needs a deploy, which is why it is not done here.

select cron.alter_job(
  (select jobid from cron.job where jobname = 'transcription-sync-work'),
  schedule := '10 seconds',
  command := $job$
  select net.http_post(
    url     := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/transcription-sync',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n',
                 'x-sync-secret',(select value from acc.job_secrets where name='transcription_sync')),
    body    := '{"action":"work","gemini_model":"gemini-flash-latest"}'::jsonb,
    timeout_milliseconds := 300000);
$job$);

-- Check:
--   select jobid, jobname, schedule, active, command like '%gemini-flash-latest%' as pinned
--     from cron.job where jobname = 'transcription-sync-work';
