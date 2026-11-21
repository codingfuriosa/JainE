-- SCHEDULED OUTSTANDING REMINDERS (20 Nov 2026, Ayush). People with Post Sales choose customers and how often they are
-- reminded - daily, weekly (on a weekday), fortnightly (on a weekday, every other week from the start date) or monthly
-- (on a date). The email goes 15 minutes after that day's Farvision Outstanding import is complete; no import that day,
-- no email (it simply waits for the next due day). Customers can still be reminded by hand at any time.
create table if not exists postsales.reminder_schedules (
  id          bigserial primary key,
  booking_no  text not null unique,
  customer_name text,
  project     text,
  frequency   text not null check (frequency in ('daily','weekly','fortnightly','monthly')),
  weekday     int check (weekday between 1 and 7),          -- ISO: 1 Monday .. 7 Sunday (weekly, fortnightly)
  month_day   int check (month_day between 1 and 31),       -- monthly; 29-31 fall on the month's last day when shorter
  start_date  date not null default ((now() at time zone 'Asia/Kolkata')::date),
  active      boolean not null default true,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  last_sent_on date,
  last_note   text
);
create table if not exists postsales.reminder_schedule_queue (
  id          bigserial primary key,
  run_date    date not null,
  schedule_id bigint,
  booking_no  text not null,
  import_batch_id bigint,
  status      text not null default 'pending',   -- pending, sending, sent, skipped, failed
  attempts    int not null default 0,
  error       text,
  claimed_at  timestamptz,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (run_date, booking_no)
);
alter table postsales.reminder_schedules enable row level security;
alter table postsales.reminder_schedule_queue enable row level security;
drop policy if exists rs_staff on postsales.reminder_schedules;
create policy rs_staff on postsales.reminder_schedules for all to authenticated
  using (not (select app.is_customer())) with check (not (select app.is_customer()));
drop policy if exists rsq_read on postsales.reminder_schedule_queue;
create policy rsq_read on postsales.reminder_schedule_queue for select to authenticated using (not (select app.is_customer()));
grant select, insert, update, delete on postsales.reminder_schedules to authenticated;
grant select on postsales.reminder_schedule_queue to authenticated;
grant usage, select on sequence postsales.reminder_schedules_id_seq to authenticated;
grant select, insert, update, delete on postsales.reminder_schedules, postsales.reminder_schedule_queue to service_role;
grant usage, select on all sequences in schema postsales to service_role;
-- the sender reads these on the server
grant select on postsales.project_setup, postsales.reminder_holds to service_role;

-- up to p_n queued customers for today, taken by one run only
create or replace function postsales.reminder_queue_claim(p_n int) returns table(id bigint, booking_no text, schedule_id bigint, attempts int, frequency text)
language plpgsql security definer set search_path = '' as $$
begin
  update postsales.reminder_schedule_queue set status = 'pending'
   where status = 'sending' and claimed_at < now() - interval '10 minutes';
  return query
  with c as (
    select q.id from postsales.reminder_schedule_queue q
     where q.run_date = (now() at time zone 'Asia/Kolkata')::date and q.status = 'pending' and q.attempts < 3
     order by q.id limit p_n for update skip locked)
  update postsales.reminder_schedule_queue q set status = 'sending', claimed_at = now(), attempts = q.attempts + 1
    from c where q.id = c.id
  returning q.id, q.booking_no, q.schedule_id, q.attempts,
            (select s.frequency from postsales.reminder_schedules s where s.id = q.schedule_id);
end $$;
revoke all on function postsales.reminder_queue_claim(int) from public, anon, authenticated;
grant execute on function postsales.reminder_queue_claim(int) to service_role;

-- every 3 minutes: is today's import complete (15 min ago)? queue what is due today, and send what is queued
create or replace function postsales.reminder_schedule_tick() returns text
language plpgsql security definer set search_path = '' as $$
declare d date := (now() at time zone 'Asia/Kolkata')::date; b record; v_secret text;
begin
  select i.id, i.imported_at into b from cust.import_batches i
   where i.import_type = 'outstanding' and i.status = 'completed' and (i.imported_at at time zone 'Asia/Kolkata')::date = d
   order by i.id desc limit 1;
  if b.id is null then return 'no import today'; end if;
  if b.imported_at > now() - interval '15 minutes' then return 'waiting 15 minutes after the import'; end if;
  if exists (select 1 from cust.import_batches i where i.imported_at > now() - interval '60 minutes' and i.status not in ('completed','failed','error','cancelled'))
    then return 'an import is still running'; end if;
  insert into postsales.reminder_schedule_queue (run_date, schedule_id, booking_no, import_batch_id)
  select d, s.id, s.booking_no, b.id from postsales.reminder_schedules s
   where s.active and s.start_date <= d and s.created_at < b.imported_at and (   -- a schedule made after the import starts with the next one
         s.frequency = 'daily'
      or (s.frequency = 'weekly' and extract(isodow from d) = s.weekday)
      or (s.frequency = 'fortnightly' and extract(isodow from d) = s.weekday and floor((d - s.start_date) / 7.0)::int % 2 = 0)
      or (s.frequency = 'monthly' and extract(day from d) = least(s.month_day, extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int)))
  on conflict (run_date, booking_no) do nothing;
  if not exists (select 1 from postsales.reminder_schedule_queue q where q.run_date = d and q.status = 'pending' and q.attempts < 3)
    then return 'nothing to send'; end if;
  select value into v_secret from acc.job_secrets where name = 'booking_audit';
  perform net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/customer-invite',
    headers := jsonb_build_object('Content-Type','application/json',
      'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n', 'x-audit-secret', v_secret),
    body := jsonb_build_object('action','reminder_schedule_run'),
    timeout_milliseconds := 150000);
  return 'sending';
end $$;
revoke all on function postsales.reminder_schedule_tick() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'reminder_schedule_tick';
select cron.schedule('reminder_schedule_tick', '*/3 * * * *', $c$select postsales.reminder_schedule_tick()$c$);
