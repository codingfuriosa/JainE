-- POST SALES CUSTOMER TICKETS FROM GMAIL (30 Oct 2026, as asked).
-- Every 10 minutes customer-invite (action postsales_mail_sync) reads Pallabita Ghosh's mailbox
-- (customercare1@) over IMAP, READ-ONLY - nothing is marked read, moved or deleted. Each Gmail
-- conversation a customer starts is one ticket; her replies in it are recorded against it, so the
-- dashboard knows what is waiting for an answer and how long answers take. Gemini reads a ticket's
-- latest messages for its category, a one-line summary and urgency; the sender is matched to the
-- customer from the Farvision contacts (name, project, tower, flat).
-- WhatsApp and calls are meant to land in the same tickets later (channel).

create table if not exists postsales.tickets (
  id bigserial primary key,
  channel text not null default 'email',
  thread_key text not null unique,            -- email: the Gmail conversation id
  customer_email text, customer_name text, customer_phone text,
  unit_id bigint, project text, tower text, unit_code text,
  subject text,
  category text, summary text, urgency text,  -- from Gemini
  is_ticket boolean,                          -- Gemini: a real customer issue (not a thank-you, ad or auto-mail)
  status text not null default 'open',        -- open | answered | resolved
  first_received_at timestamptz, last_customer_at timestamptz,
  first_reply_at timestamptz, last_reply_at timestamptz,
  resolved_at timestamptz, resolved_by text,
  assigned_to text,
  messages integer not null default 0,
  needs_ai boolean not null default true, ai_at timestamptz, ai_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists ps_tickets_status on postsales.tickets (status, last_customer_at desc);

create table if not exists postsales.ticket_messages (
  id bigserial primary key,
  ticket_id bigint references postsales.tickets(id) on delete cascade,
  mailbox text not null, message_key text not null unique,   -- mailbox:uidvalidity:uid
  thread_key text, gmail_msgid text, rfc_message_id text,
  direction text not null,                    -- in (from the customer) | out (our reply)
  from_email text, from_name text, to_emails text[],
  subject text, sent_at timestamptz, body text,
  created_at timestamptz not null default now());
create index if not exists ps_tmsg_ticket on postsales.ticket_messages (ticket_id, sent_at);

create table if not exists postsales.mail_sync_state (
  mailbox text primary key, uidvalidity text, last_uid bigint not null default 0,
  last_run_at timestamptz, last_error text, last_count integer);

alter table postsales.tickets enable row level security;
alter table postsales.ticket_messages enable row level security;
alter table postsales.mail_sync_state enable row level security;
drop policy if exists pst_read on postsales.tickets;
create policy pst_read on postsales.tickets for select to authenticated using (not (select app.is_customer()));
drop policy if exists pst_update on postsales.tickets;
create policy pst_update on postsales.tickets for update to authenticated using (not (select app.is_customer())) with check (not (select app.is_customer()));
drop policy if exists pstm_read on postsales.ticket_messages;
create policy pstm_read on postsales.ticket_messages for select to authenticated using (not (select app.is_customer()));
drop policy if exists pss_read on postsales.mail_sync_state;
create policy pss_read on postsales.mail_sync_state for select to authenticated using (not (select app.is_customer()));
grant select, update on postsales.tickets to authenticated;
grant select on postsales.ticket_messages, postsales.mail_sync_state to authenticated;

-- Who an email address belongs to: the current Farvision contact first, then any earlier one.
create or replace function postsales.match_customer(p_email text)
returns table (customer_name text, customer_phone text, unit_id bigint, project text, tower text, unit_code text)
language sql stable security definer set search_path to 'cust', 'public' as $$
  select fc.contact_name, fc.contact_phone, u.id, p.name, u.tower, u.unit_code
    from cust.farvision_contacts fc
    left join cust.units u on u.id = fc.unit_id
    left join cust.projects p on p.id = u.project_id
   where lower(btrim(fc.contact_email)) = lower(btrim(p_email)) and fc.deleted_at is null
   order by fc.is_current desc nulls last, fc.created_at desc
   limit 1
$$;
revoke all on function postsales.match_customer(text) from public, anon, authenticated;

-- The kick: every 10 minutes, through the same secret the booking jobs use.
create or replace function postsales.mail_sync_kick() returns bigint
language plpgsql security definer set search_path to 'postsales', 'public' as $$
declare v_secret text;
begin
  select value into v_secret from acc.job_secrets where name = 'booking_audit';
  if v_secret is null then return null; end if;
  return net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/customer-invite',
    headers := jsonb_build_object('Content-Type','application/json',
      'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n', 'x-audit-secret', v_secret),
    body := jsonb_build_object('action','postsales_mail_sync'),
    timeout_milliseconds := 150000);
end $$;
revoke all on function postsales.mail_sync_kick() from public, anon, authenticated;

-- The job runs as service_role, which needs its own way into these tables.
grant usage on schema postsales to service_role;
grant select, insert, update, delete on postsales.tickets, postsales.ticket_messages, postsales.mail_sync_state to service_role;
grant usage, select on all sequences in schema postsales to service_role;
grant execute on function postsales.match_customer(text) to service_role;
