-- Email as well as the bell for construction photo approval.
--
-- cust.review_media() and cust.notify_media_uploaded() already write the bell notifications
-- (acc.notifications, kinds media_pending / media_rejected / media_published). This emails each of
-- them too: a trigger hands the notification's id - and nothing else - to the workflow-mailer
-- function (type 'media_notice'), which reads the row itself and mails its recipient its title and
-- body. Passing only an id matters: workflow-mailer has no caller check, so it must never accept
-- the recipient or the text from whoever calls it. cust.media_email_log makes each notification
-- mail at most once, however often the mailer is called with its id.

create table if not exists cust.media_email_log(
  notification_id bigint primary key,
  sent_at timestamptz not null default now(),
  status text not null default 'sending',
  error text
);
alter table cust.media_email_log enable row level security;
revoke all on cust.media_email_log from anon, authenticated;

create or replace function cust.media_notice_email() returns trigger
language plpgsql security definer set search_path = cust, public as $$
begin
  perform net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/workflow-mailer',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n"}'::jsonb,
    body := jsonb_build_object('type', 'media_notice', 'id', new.id),
    timeout_milliseconds := 15000);
  return new;
exception when others then
  return new;  -- an email that cannot be queued must never stop the notification itself
end $$;

drop trigger if exists media_notice_email on acc.notifications;
create trigger media_notice_email after insert on acc.notifications
  for each row when (new.kind in ('media_pending', 'media_rejected', 'media_published'))
  execute function cust.media_notice_email();
