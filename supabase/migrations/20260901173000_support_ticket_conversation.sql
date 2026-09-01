-- Customer Portal: mirror Zoho Desk's ticket conversation locally so the customer portal can show
-- agent replies, and let the customer post a reply back.
--
-- Two separate Zoho concepts, mirrored as two separate tables:
--   - cust.support_ticket_threads  <- Zoho's GET /tickets/{id}/threads (the official conversation:
--     the original description plus any real agent email/reply threads, direction 'in'/'out').
--   - cust.support_ticket_comments <- Zoho's GET/POST /tickets/{id}/comments. Zoho's public ticket
--     API has no way to post an inbound thread attributed to the contact (confirmed against the live
--     API - POST /threads is flat-out rejected), so a customer's portal reply is posted here instead,
--     as a public comment. It lands in the ticket's Comments panel in Zoho Desk (visible to whoever's
--     working the ticket, alongside the conversation) rather than as a new conversation thread, and
--     is attributed in Zoho to whichever agent identity the OAuth connection belongs to - the comment
--     text itself is prefixed with the customer's name so that's never ambiguous to an agent reading
--     it. posted_by_customer tells our own UI to label it "You" regardless of what Zoho's metadata says.
--
-- Both tables are pure mirrors populated only by the zoho-desk edge function (service role) - no
-- customer or staff INSERT/UPDATE policy exists on either, matching cust.support_tickets itself.
create table if not exists cust.support_ticket_threads (
  id bigserial primary key,
  ticket_id bigint not null references cust.support_tickets(id),
  zoho_thread_id text not null,
  direction text,
  author_name text,
  author_type text,
  content text,
  zoho_created_time timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists support_ticket_threads_uq on cust.support_ticket_threads(ticket_id, zoho_thread_id);

create table if not exists cust.support_ticket_comments (
  id bigserial primary key,
  ticket_id bigint not null references cust.support_tickets(id),
  zoho_comment_id text not null,
  commenter_name text,
  content text,
  posted_by_customer boolean not null default false,
  zoho_commented_time timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists support_ticket_comments_uq on cust.support_ticket_comments(ticket_id, zoho_comment_id);

alter table cust.support_ticket_threads enable row level security;
alter table cust.support_ticket_comments enable row level security;

create policy support_ticket_threads_customer_select on cust.support_ticket_threads for select using (
  exists(select 1 from cust.support_tickets t join cust.units u on u.id = t.unit_id
    where t.id = support_ticket_threads.ticket_id and u.customer_id = app.current_customer_id())
);
create policy support_ticket_threads_staff_select on cust.support_ticket_threads for select using (app.is_custportal_staff());

create policy support_ticket_comments_customer_select on cust.support_ticket_comments for select using (
  exists(select 1 from cust.support_tickets t join cust.units u on u.id = t.unit_id
    where t.id = support_ticket_comments.ticket_id and u.customer_id = app.current_customer_id())
);
create policy support_ticket_comments_staff_select on cust.support_ticket_comments for select using (app.is_custportal_staff());

grant usage, select on all sequences in schema cust to authenticated, service_role;
