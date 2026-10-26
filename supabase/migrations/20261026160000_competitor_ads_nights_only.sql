-- FACEBOOK (META) AD PULLS RUN AT NIGHT ONLY, 8 PM - 8 AM IST (26 Oct 2026, as asked).
--
-- The pulls were paused after the database froze at 2:57 pm today, a minute after the first pull
-- started. They come back, but out of office hours: the worker still wakes every 10 minutes, and
-- does nothing unless it is between 8 pm and 8 am in India. Every page is queued at 8 pm, so each
-- night starts with the full list.

select cron.alter_job(
  (select jobid from cron.job where jobname = 'competitor-ads-queue-worker'),
  command := $c$ select camp.competitor_kick_worker()
                  where extract(hour from now() at time zone 'Asia/Kolkata') >= 20
                     or extract(hour from now() at time zone 'Asia/Kolkata') < 8; $c$,
  active := true);

select cron.alter_job(
  (select jobid from cron.job where jobname = 'competitor-ads-weekly-enqueue'),
  schedule := '30 14 * * *',          -- 20:00 IST
  active := true);
