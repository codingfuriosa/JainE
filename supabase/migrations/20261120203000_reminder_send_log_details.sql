-- REMINDER SEND LOG, IN FULL (20 Nov 2026, Ayush: "I want a proper Log System in Reminders ... the ones which were sent
-- plz check if their logs can be added"). Each sent reminder also keeps what it said and what went with it:
--   amount      the Net Outstanding the email gave
--   project     project of the booking, unit = block + flat
--   source      'JAIN-E' (sent from the Reminders page) or 'Farvision' (sent from Farvision through the same mailbox,
--               read back from customercare2's Sent folder and added to the log)
--   attachment  the letter's file name
alter table postsales.reminder_send_log add column if not exists amount numeric;
alter table postsales.reminder_send_log add column if not exists project text;
alter table postsales.reminder_send_log add column if not exists unit text;
alter table postsales.reminder_send_log add column if not exists source text not null default 'JAIN-E';
alter table postsales.reminder_send_log add column if not exists attachment text;
create index if not exists reminder_send_log_sent_at on postsales.reminder_send_log (sent_at desc);

-- the 35 Farvision reminders added on 20 Nov carried amount and letter in "error" until these columns existed
update postsales.reminder_send_log
   set source = 'Farvision',
       amount = nullif(substring(error from 'amount ([0-9.]+)'), '')::numeric,
       attachment = substring(error from 'attachment (.+)$'),
       error = null
 where sent_by like 'Farvision%' and error like 'amount %';

-- project / flat (and the amount for JAIN-E's own sends) from the customer's booking
update postsales.reminder_send_log s
   set project = coalesce(s.project, initcap(trim(regexp_replace(x.bu, '\(.*?\)', '', 'g')))),
       unit    = coalesce(s.unit, trim(coalesce(x.tw, '') || ' ' || coalesce(x.uc, ''))),
       amount  = coalesce(s.amount, case when s.test = false then x.net end),
       attachment = coalesce(s.attachment, case when s.source = 'JAIN-E' and s.test = false
                                                then 'Reminder Letter - ' || regexp_replace(s.booking_no, '[^A-Za-z0-9-]+', '_', 'g') || '.pdf' end)
  from (select r->>'bookingNo' bk, r->>'businessUnit' bu, r->>'tower' tw, r->>'unitCode' uc, (r->>'netOutstanding')::numeric net
          from cust.import_batches b, jsonb_array_elements(b.raw_rows) r
         where b.id = (select max(id) from cust.import_batches where import_type = 'outstanding' and status = 'completed')) x
 where x.bk = s.booking_no and (s.project is null or s.unit is null or s.amount is null);

-- Gmail's own id of each email read back from a mailbox, so it is added to the log once
alter table postsales.reminder_send_log add column if not exists mail_id text;
create index if not exists reminder_send_log_mail_id on postsales.reminder_send_log (mail_id) where mail_id is not null;

-- WEEKLY (Mondays 07:00 IST): reminder emails Farvision sent through customercare2 / customercare1 in the last 8 days
-- go into the log (customer-invite action reminder_log_sync). JAIN-E's own sends are logged as they go.
create or replace function postsales.reminder_log_kick(p_days int default 8) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  select value into v_secret from acc.job_secrets where name = 'booking_audit';
  if v_secret is null then return null; end if;
  return net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/customer-invite',
    headers := jsonb_build_object('Content-Type','application/json',
      'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n', 'x-audit-secret', v_secret),
    body := jsonb_build_object('action','reminder_log_sync','days',p_days),
    timeout_milliseconds := 150000);
end $$;
revoke all on function postsales.reminder_log_kick(int) from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'reminder_log_weekly';
select cron.schedule('reminder_log_weekly', '30 1 * * 1', $c$select postsales.reminder_log_kick(8)$c$);

-- 21 Nov 2026: the server fills in older Farvision reminders' amounts (customer-invite reminder_log_refill), so it may update the log
grant update on postsales.reminder_send_log to service_role;
