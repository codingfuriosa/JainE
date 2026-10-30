-- KEEP EVERY PROXY ACCOUNT SIGNED IN (29 Oct 2026). A Proxy sign-in lapses when it is not renewed for
-- many hours (Account 1, reconnected at 11:25 on 28 Oct and not needed again, was refused by morning).
-- Every 20 minutes the puller's "keepalive" renews any account whose access runs out within 20 minutes.
-- It renews sign-ins only and never pulls a page, so it costs no credits.
create or replace function camp.proxy_keepalive_kick() returns bigint
language sql security definer set search_path to 'camp', 'public' as $$
  select net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/competitor-sync-test-probe?action=keepalive',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n"}'::jsonb,
    body := '{}'::jsonb, timeout_milliseconds := 60000)
$$;
revoke all on function camp.proxy_keepalive_kick() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'proxy-keepalive';
select cron.schedule('proxy-keepalive', '*/20 * * * *', $$select camp.proxy_keepalive_kick()$$);

-- The worker's own quick check now counts every connected account's pages, as the claim does
-- (camp.competitor_claim_pulls), instead of stopping at one account's worth.
create or replace function camp.competitor_kick_worker()
 returns bigint language plpgsql security definer set search_path to 'camp', 'public' as $function$
declare
  v_budget int; v_used int; v_ex boolean; v_accounts int;
begin
  select daily_credit_budget into v_budget from competitor_sync_settings where id = 1;
  select count(*) into v_accounts from proxy_oauth where refresh_token is not null and active;
  v_budget := coalesce(v_budget, 20) * greatest(v_accounts, 1);
  select used, exhausted into v_used, v_ex from proxy_credit_days where day = (now() at time zone 'utc')::date;
  if coalesce(v_ex, false) or coalesce(v_used, 0) >= v_budget then return null; end if;
  if not exists (select 1 from competitor_pull_queue where status = 'pending') then return null; end if;
  return net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/competitor-sync-test-probe?action=work',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n"}'::jsonb,
    body := '{"max":4}'::jsonb,
    timeout_milliseconds := 300000);
end $function$;
