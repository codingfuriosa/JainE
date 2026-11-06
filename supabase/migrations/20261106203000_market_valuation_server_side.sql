-- Market Valuation runs server-side (edge function market-valuation, direct requests to the WB form).
-- NOT YET APPLIED - needs the user's OK, and only after 20:00 IST (no DDL in office hours).
--
-- 1. When a booking audit becomes 'done' for a configured project and has no value yet, poke the
--    function for that case. Never raises - saving the audit must not depend on the government site.
-- 2. Every 30 minutes, sweep up to 3 still-pending cases (a missed poke, a site outage, a retry).
-- Both send x-region: ap-south-1 so the request leaves from Mumbai.

create or replace function acc.market_valuation_kick()
returns trigger language plpgsql security definer
set search_path to 'acc', 'public', 'pg_temp'
as $$
declare v_secret text;
begin
  if new.status <> 'done' or new.market_valuation is not null
     or (new.result->'fields'->'project_name'->>'value') not in ('Dream Gurukul', 'Dream World City') then
    return null;
  end if;
  select value into v_secret from acc.job_secrets where name = 'market_valuation';
  if v_secret is null then return null; end if;
  perform net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/market-valuation',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-region', 'ap-south-1', 'x-webhook-secret', v_secret),
    body := jsonb_build_object('case_id', new.case_id),
    timeout_milliseconds := 120000);
  return null;
exception when others then
  return null;
end $$;

drop trigger if exists trg_market_valuation_kick on acc.booking_audits;
create trigger trg_market_valuation_kick
  after insert or update of status on acc.booking_audits
  for each row execute function acc.market_valuation_kick();

select cron.schedule('market-valuation-sweep', '*/30 * * * *', $cron$
  select net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/market-valuation',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-region', 'ap-south-1',
      'x-webhook-secret', (select value from acc.job_secrets where name = 'market_valuation')),
    body := '{"sweep":true,"max":3}'::jsonb,
    timeout_milliseconds := 150000)
  where exists (select 1 from acc.market_valuation_pending());
$cron$);
