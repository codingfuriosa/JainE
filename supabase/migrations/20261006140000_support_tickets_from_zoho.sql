-- Support: tickets that start in Zoho Desk (a customer's email to customer care, a phone call
-- logged by an agent) now show in that customer's portal too, not only tickets raised from the
-- portal (6 Oct 2026).
--
-- zoho-desk (action 'cron', every 10 minutes, and action 'pull' when a customer opens Support)
-- reads Zoho's tickets and matches each to a customer by the ticket's contact email, or failing
-- that the last 10 digits of its phone/mobile. A match becomes a row here with source = 'zoho' and
-- customer_id set but no unit (an email is about the customer, not one particular flat), so it
-- shows on the Support tab of every flat that customer owns.

alter table cust.support_tickets alter column unit_id drop not null;
alter table cust.support_tickets
  add column if not exists customer_id bigint references cust.customers(id),
  add column if not exists source text not null default 'portal',      -- portal | zoho
  add column if not exists zoho_channel text,                          -- Email, Phone, Web, ...
  add column if not exists zoho_created_time timestamptz,
  add column if not exists zoho_contact_email text;

update cust.support_tickets t set customer_id = u.customer_id
  from cust.units u where u.id = t.unit_id and t.customer_id is null;

-- One mirror row per Zoho ticket, however it was found.
create unique index if not exists support_tickets_zoho_ticket_uq on cust.support_tickets(zoho_ticket_id)
  where zoho_ticket_id is not null;
create index if not exists support_tickets_customer_idx on cust.support_tickets(customer_id);

-- A ticket raised from the portal carries its customer too.
-- For anyone but staff, the Zoho link is the server's to set: a customer raising a ticket cannot
-- name a Zoho ticket id (which would pull someone else's conversation in on the next sync), mark it
-- as imported, or point it at another customer.
create or replace function cust.support_ticket_fill_customer() returns trigger
language plpgsql security definer set search_path = cust, public as $$
begin
  -- auth.role() is the caller's (the JWT's), unlike current_user inside a security definer function.
  if coalesce(auth.role(), '') in ('authenticated', 'anon') and not app.is_custportal_staff() then
    new.zoho_ticket_id := null; new.zoho_ticket_number := null; new.zoho_status := null;
    new.zoho_channel := null; new.zoho_created_time := null; new.zoho_contact_email := null;
    new.source := 'portal'; new.customer_id := null;
  end if;
  if new.customer_id is null and new.unit_id is not null then
    select customer_id into new.customer_id from cust.units where id = new.unit_id;
  end if;
  return new;
end $$;
drop trigger if exists support_ticket_fill_customer on cust.support_tickets;
create trigger support_ticket_fill_customer before insert on cust.support_tickets
  for each row execute function cust.support_ticket_fill_customer();

-- Customers see their own tickets: by flat as before, or by customer for a ticket with no flat.
drop policy if exists support_tickets_customer_select on cust.support_tickets;
create policy support_tickets_customer_select on cust.support_tickets for select
  using (deleted_at is null and (
    exists (select 1 from cust.units u where u.id = support_tickets.unit_id
              and u.customer_id = app.current_customer_id() and u.deleted_at is null)
    or (support_tickets.unit_id is null and support_tickets.customer_id = app.current_customer_id())));

create or replace function cust.support_ticket_is_mine(p_ticket bigint) returns boolean
language sql stable security definer set search_path = cust, public as $$
  select exists (select 1 from cust.support_tickets t
                  left join cust.units u on u.id = t.unit_id
                  where t.id = p_ticket and t.deleted_at is null
                    and ((u.customer_id = app.current_customer_id() and u.deleted_at is null)
                         or (t.unit_id is null and t.customer_id = app.current_customer_id())))
$$;
grant execute on function cust.support_ticket_is_mine(bigint) to authenticated;

drop policy if exists support_ticket_threads_customer_select on cust.support_ticket_threads;
create policy support_ticket_threads_customer_select on cust.support_ticket_threads for select
  using (cust.support_ticket_is_mine(ticket_id));
drop policy if exists support_ticket_comments_customer_select on cust.support_ticket_comments;
create policy support_ticket_comments_customer_select on cust.support_ticket_comments for select
  using (cust.support_ticket_is_mine(ticket_id));
drop policy if exists support_ticket_attachments_customer_select on cust.support_ticket_attachments;
create policy support_ticket_attachments_customer_select on cust.support_ticket_attachments for select
  using (deleted_at is null and cust.support_ticket_is_mine(ticket_id));

-- When a customer last had Zoho searched for their tickets (the pull on opening Support is
-- throttled), and where the every-10-minutes import has got to.
alter table cust.customers add column if not exists zoho_pulled_at timestamptz;
create table if not exists cust.zoho_sync_state(
  id int primary key default 1 check (id = 1),
  last_created_time timestamptz,
  last_run_at timestamptz,
  last_result jsonb
);
insert into cust.zoho_sync_state(id) values (1) on conflict do nothing;
alter table cust.zoho_sync_state enable row level security;
revoke all on cust.zoho_sync_state from anon, authenticated;

-- The scheduled import authenticates with a shared secret (acc.job_secrets, service role only).
insert into acc.job_secrets(name, value)
select 'zoho_sync', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
 where not exists (select 1 from acc.job_secrets where name = 'zoho_sync');

select cron.schedule('zoho-ticket-import', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/zoho-desk',
    headers := jsonb_build_object('Content-Type','application/json',
                 'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n',
                 'x-sync-secret',(select value from acc.job_secrets where name='zoho_sync')),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 120000)
$$);
