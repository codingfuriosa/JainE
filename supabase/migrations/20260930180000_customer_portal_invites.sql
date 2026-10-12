-- Customer Portal: invitation emails ("your portal is open - here is how to sign in").
--
-- Sent from Customer Portal Admin > Customers > Send invitation, through the customer-invite edge
-- function (action 'invite'), from customercare1@thejaingroup.com. One row per email sent or
-- attempted, so staff can see who was invited and when, and the same customer is not emailed twice by
-- accident. Only the edge function (service role) writes here; staff read it.

create table if not exists cust.portal_invites(
  id bigserial primary key,
  customer_id bigint not null references cust.customers(id),
  email text not null,
  status text not null check (status in ('sent','failed')),
  error text,
  sent_by text,
  sent_at timestamptz not null default now()
);
create index if not exists portal_invites_customer_idx on cust.portal_invites(customer_id, sent_at desc);

alter table cust.portal_invites enable row level security;
drop policy if exists portal_invites_staff_read on cust.portal_invites;
create policy portal_invites_staff_read on cust.portal_invites for select to authenticated
  using (app.is_custportal_staff());
revoke insert, update, delete on cust.portal_invites from anon, authenticated;
grant select on cust.portal_invites to authenticated;
