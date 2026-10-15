-- Every evening at 18:30 IST, customer-invite (booking_welcome2_reminders) emails Pallabita Ghosh
-- about each booking whose 2nd Welcome Letter is still unsent on its reminder day - see
-- acc.booking_welcome2_due() for which those are. In test mode the reminder goes to the test inbox.
-- This sends nothing to a customer.
select cron.unschedule('booking-welcome2-reminder')
 where exists (select 1 from cron.job where jobname = 'booking-welcome2-reminder');

select cron.schedule('booking-welcome2-reminder', '0 13 * * *', $cron$
  select net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/customer-invite',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n',
      'x-audit-secret', (select value from acc.job_secrets where name = 'booking_audit')),
    body := '{"action":"booking_welcome2_reminders"}'::jsonb,
    timeout_milliseconds := 120000);
$cron$);
