-- OUTSTANDING REMINDER: TEST SENDING (30 Oct 2026).
-- Sending is switched on for the test customers only (postsales.reminder_test_recipients), from Ayush's own
-- account - never Pallabita Ghosh's. The customer-invite action "reminder_send" takes test customer ids only,
-- so a real customer cannot be named to it. 'off' stops it entirely.
create table if not exists postsales.reminder_send_log (
  id bigserial primary key, sent_at timestamptz not null default now(), sent_by text,
  from_email text, recipient_email text, customer_name text, booking_no text,
  subject text, ok boolean, error text, test boolean not null default true);
alter table postsales.reminder_send_log enable row level security;
drop policy if exists prsl_read on postsales.reminder_send_log;
create policy prsl_read on postsales.reminder_send_log for select to authenticated using (not (select app.is_customer()));
grant select on postsales.reminder_send_log to authenticated;
grant usage on schema postsales to service_role;
grant select, insert on postsales.reminder_send_log to service_role;
grant usage, select on all sequences in schema postsales to service_role;
grant select on postsales.reminder_settings, postsales.reminder_test_recipients to service_role;
insert into acc.job_secrets (name, value) values ('reminder_send_mode', 'test_only')
on conflict (name) do update set value = 'test_only';
