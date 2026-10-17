-- A BOOKING READING THAT FAILS IS TRIED AGAIN, AND IF IT STILL FAILS PALLABITA GHOSH IS TOLD.
--
-- Until now a reading that failed once stayed 'failed' for good and nobody heard: Booking Form
-- No. 31 (Riya Bose, Block D 3E) failed on 15 Oct only because Google's AI answered "high demand,
-- try again later", and was never tried again - no Check List, no documents, no Welcome Letter.
--
-- 1. RETRY. A failed reading goes back in the queue ten minutes later, until it has been tried
--    three times (booking_audits.attempts, counted by booking_audit_claim). The every-five-minutes
--    cron picks it up; booking_audit_claim now leaves a row alone until its queued_at has come.
-- 2. TELL. Only when the third try fails too does the row become 'failed', and that change asks
--    customer-invite (action booking_read_failed) to email Pallabita Ghosh - once per failure.

create or replace function acc.booking_audit_finish(p_case_id bigint, p_result jsonb, p_model text, p_error text default null)
returns void
language plpgsql security definer
set search_path to 'acc','public','pg_temp'
as $function$
begin
  if p_error is not null and coalesce((select attempts from acc.booking_audits where case_id = p_case_id), 0) < 3 then
    update acc.booking_audits
       set status = 'pending', error = p_error, finished_at = now(),
           queued_at = now() + interval '10 minutes'
     where case_id = p_case_id;
    return;
  end if;
  update acc.booking_audits
     set status = case when p_error is null then 'done' else 'failed' end,
         result = coalesce(p_result, result), model = coalesce(p_model, model),
         error = p_error, finished_at = now()
   where case_id = p_case_id;
end;
$function$;

create or replace function acc.booking_audit_claim()
returns bigint
language plpgsql security definer
set search_path to 'acc','public','pg_temp'
as $function$
declare v_id bigint;
begin
  select case_id into v_id
    from acc.booking_audits
   where (status = 'pending' and attempts < 3 and queued_at <= now())
      or (status = 'running' and started_at < now() - interval '15 minutes' and attempts < 3)
   order by queued_at
     for update skip locked
   limit 1;
  if v_id is null then return null; end if;
  update acc.booking_audits
     set status='running', started_at=now(), attempts=attempts+1
   where case_id = v_id;
  return v_id;
end;
$function$;

create or replace function acc.booking_read_failed_kick()
returns trigger
language plpgsql security definer
set search_path to 'acc','public','pg_temp'
as $function$
declare v_secret text;
begin
  select value into v_secret from acc.job_secrets where name = 'booking_audit';
  if v_secret is null then return null; end if;
  perform net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/customer-invite',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n',
      'x-audit-secret', v_secret),
    body := jsonb_build_object('action','booking_read_failed','case_id', new.case_id),
    timeout_milliseconds := 60000);
  return null;
exception when others then
  return null;
end $function$;

drop trigger if exists trg_booking_read_failed on acc.booking_audits;
create trigger trg_booking_read_failed
  after update of status on acc.booking_audits
  for each row
  when (new.status = 'failed' and old.status is distinct from 'failed')
  execute function acc.booking_read_failed_kick();
