-- Farvision Gmail -> Supabase import: two scheduled jobs.
--
-- pg_cron schedules in UTC. IST = UTC+05:30, so:
--   06:30 IST = 01:00 UTC  ->  '0 1 * * *'
--
-- The edge function is deployed with --no-verify-jwt (Pub/Sub push needs it),
-- so cron only needs the publishable apikey, no extra secret.

-- 1. DAILY POLL — 06:30 IST, safety net for any missed push notifications.
select cron.unschedule('farvision-import-poll')
where exists (select 1 from cron.job where jobname = 'farvision-import-poll');

select cron.schedule('farvision-import-poll', '0 1 * * *', $job$
  select net.http_post(
    url     := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/farvision-import',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n'),
    body    := '{"action":"poll"}'::jsonb,
    timeout_milliseconds := 120000);
$job$);

-- 2. WATCH RENEWAL — every 6 days at 03:00 IST (21:30 UTC previous day).
--    Gmail watch() expires after 7 days; renewing every 6 keeps it alive.
select cron.unschedule('farvision-import-renew')
where exists (select 1 from cron.job where jobname = 'farvision-import-renew');

select cron.schedule('farvision-import-renew', '30 21 */6 * *', $job$
  select net.http_post(
    url     := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/farvision-import',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n'),
    body    := '{"action":"renew"}'::jsonb,
    timeout_milliseconds := 30000);
$job$);

-- Check:
--   select jobid, jobname, schedule, active from cron.job where jobname like 'farvision-import%';
