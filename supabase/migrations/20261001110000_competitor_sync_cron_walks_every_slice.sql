-- The nightly competitor sync now asks for every slice, not just the first.
--
-- The function has always walked the watchlist in fours and returned next_skip saying where to
-- carry on. Nothing ever carried on: the cron posted {"write":true} and stopped, so the same
-- four competitors were refreshed twice a night and the other eighteen kept ads from 22
-- September that read as current.
--
-- Having the function hand over to itself was tried and does not work here: the self-call
-- arrives at the gateway as a GET and the function answers 405 (seen in the logs at 08:59:37
-- on 01.10.2026 - a 200 for the real call, a 405 for its hand-off ninety milliseconds later).
-- So the caller drives it instead, which is plainer anyway: six posts, each its own invocation
-- with its own resource budget, auto:false so nothing tries to chain.
--
-- 22 competitors today; the slices run to 20 and cover 24, so there is room for two more
-- before this needs another step.

select cron.unschedule('competitor-ads-proxy-daily');

select cron.schedule('competitor-ads-proxy-daily', '15 2,3 * * *', $job$
  select net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/competitor-sync-test-probe?action=sync',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n"}'::jsonb,
    body := jsonb_build_object('write', true, 'auto', false, 'skip', s),
    timeout_milliseconds := 600000)
  from generate_series(0, 20, 4) as s;
$job$);
