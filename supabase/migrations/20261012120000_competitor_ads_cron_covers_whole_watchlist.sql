-- The nightly Proxy pull fired six slices (skip 0,4,..,20 of four pages each), which covered the
-- first 24 watchlist rows and nothing after. The watchlist now holds 28, so the four newest pages -
-- Dream Gurukul, Dream World City, Dream Exotica and Dream Eco City - had never been pulled once
-- and sat on the board with no ads. The series now runs to skip 60 (64 pages); a slice past the end
-- of the list returns at once without calling Proxy, so the spare slices cost nothing.
select cron.schedule(
  'competitor-ads-proxy-daily',
  '15 2,3 * * *',
  $$
  select net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/competitor-sync-test-probe?action=sync',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n"}'::jsonb,
    body := jsonb_build_object('write', true, 'auto', false, 'skip', s),
    timeout_milliseconds := 600000)
  from generate_series(0, 60, 4) as s;
  $$
);
