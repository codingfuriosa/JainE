-- Customer Portal: attachments on a support ticket (PDF/image/etc, uploaded when the ticket is
-- raised). zoho_attachment_id/zoho_synced_at track whether the zoho-desk edge function has already
-- pushed this file to the matching Zoho Desk ticket, so a retry never re-uploads the same file twice.
create table if not exists cust.support_ticket_attachments (
  id bigserial primary key,
  ticket_id bigint not null references cust.support_tickets(id),
  storage_path text not null,
  file_name text,
  file_size bigint,
  file_type text,
  uploaded_by text,
  created_at timestamptz not null default now(),
  zoho_attachment_id text,
  zoho_synced_at timestamptz,
  deleted_at timestamptz,
  deleted_by text
);
create index if not exists support_ticket_attachments_ticket_idx on cust.support_ticket_attachments(ticket_id) where deleted_at is null;

alter table cust.support_ticket_attachments enable row level security;

create policy support_ticket_attachments_customer_select on cust.support_ticket_attachments for select using (
  deleted_at is null and exists(
    select 1 from cust.support_tickets t join cust.units u on u.id = t.unit_id
    where t.id = support_ticket_attachments.ticket_id and u.customer_id = app.current_customer_id()
  )
);
create policy support_ticket_attachments_customer_insert on cust.support_ticket_attachments for insert with check (
  zoho_attachment_id is null and zoho_synced_at is null
  and exists(
    select 1 from cust.support_tickets t join cust.units u on u.id = t.unit_id
    where t.id = support_ticket_attachments.ticket_id and u.customer_id = app.current_customer_id() and t.deleted_at is null
  )
);
create policy support_ticket_attachments_staff_all on cust.support_ticket_attachments for all using (app.is_custportal_staff()) with check (app.is_custportal_staff());

grant usage, select on all sequences in schema cust to authenticated, service_role;
