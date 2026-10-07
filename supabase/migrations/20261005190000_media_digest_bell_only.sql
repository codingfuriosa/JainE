-- The approvers' daily photo summary (cust.media_daily_digest, kind 'media_digest') stays in the
-- bell only - no email (decided 2026-10-05). The email trigger goes back to the three notices
-- workflow-mailer handles: waiting for review, rejected, published.
drop trigger if exists media_notice_email on acc.notifications;
create trigger media_notice_email after insert on acc.notifications
  for each row when (new.kind in ('media_pending', 'media_rejected', 'media_published'))
  execute function cust.media_notice_email();
