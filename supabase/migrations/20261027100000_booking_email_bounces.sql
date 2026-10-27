-- BOOKING EMAILS THAT BOUNCE ARE CAUGHT, RE-READ AND RE-SENT (27 Oct 2026, as asked).
--
-- A Welcome Letter went to samirchak2@gmail.com, which does not exist - the form says SAMIRCHAX2, a
-- handwritten X read as a K - and nobody knew. Every 15 minutes customer-invite
-- (action booking_bounce_check) now reads Pallabita Ghosh's inbox for Gmail's "address not found"
-- replies, matches each one to the booking document it returns, and:
--   1. asks booking-audit to read the email on the booking form again, told which reading bounced;
--   2. if that gives a different, well-formed address that has not bounced before, files it on the
--      booking (validation.email and kyc.emails, as a correction) and sends the letter again to it
--      - the Welcome Letters automatically; the Allotment Letter and Agreement Draft are PDFs built
--      in the editor, so for those Pallabita is told the corrected address and sends it herself;
--   3. otherwise emails Pallabita that the address bounced and needs checking by hand.
-- This table is the record: one row per returned email, so a reply is never handled twice.

create table if not exists acc.booking_email_bounces (
  id            bigserial primary key,
  message_key   text not null unique,         -- the returned email's Message-ID (or IMAP UID)
  case_id       bigint references acc.flow_cases(id) on delete cascade,
  kind          text,                          -- welcome / welcome2 / allotment / agreement
  bounced_to    text not null,
  reason        text,                          -- Gmail's own words
  detected_at   timestamptz not null default now(),
  reread_email  text,                          -- what the second reading of the form says
  reread_sure   boolean,
  reread_steps  text,
  outcome       text,                          -- resent / told_pallabita / no_match / error
  resent_to     text,
  note          text
);
alter table acc.booking_email_bounces enable row level security;
revoke all on acc.booking_email_bounces from anon, authenticated;
grant select on acc.booking_email_bounces to authenticated;
drop policy if exists "staff read" on acc.booking_email_bounces;
create policy "staff read" on acc.booking_email_bounces for select to authenticated
  using (not (select app.is_customer()));

create or replace function acc.booking_bounce_kick()
returns void language plpgsql security definer set search_path to 'acc', 'public' as $$
declare v_secret text;
begin
  select value into v_secret from acc.job_secrets where name = 'booking_audit';
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/customer-invite',
    headers := jsonb_build_object('Content-Type','application/json',
      'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n', 'x-audit-secret', v_secret),
    body := jsonb_build_object('action','booking_bounce_check'),
    timeout_milliseconds := 120000);
end $$;
revoke all on function acc.booking_bounce_kick() from public, anon, authenticated;

select cron.schedule('booking-bounce-check', '*/15 * * * *', $$select acc.booking_bounce_kick()$$);
