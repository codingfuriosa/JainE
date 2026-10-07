-- Support: Zoho's "Not a Ticket." status is mail that is not a customer query, and a customer never
-- sees it (6 Oct 2026). zoho-desk no longer brings such tickets in; this removes the copies already
-- brought in (only the portal's copies - Zoho is untouched) and keeps the customer read policy from
-- returning one, whatever its source.
delete from cust.support_ticket_threads where ticket_id in
  (select id from cust.support_tickets where source = 'zoho' and zoho_status ~* 'not\s*a\s*ticket');
delete from cust.support_ticket_comments where ticket_id in
  (select id from cust.support_tickets where source = 'zoho' and zoho_status ~* 'not\s*a\s*ticket');
delete from cust.support_tickets where source = 'zoho' and zoho_status ~* 'not\s*a\s*ticket';

drop policy if exists support_tickets_customer_select on cust.support_tickets;
create policy support_tickets_customer_select on cust.support_tickets for select
  using (deleted_at is null and coalesce(zoho_status, '') !~* 'not\s*a\s*ticket' and (
    exists (select 1 from cust.units u where u.id = support_tickets.unit_id
              and u.customer_id = app.current_customer_id() and u.deleted_at is null)
    or (support_tickets.unit_id is null and support_tickets.customer_id = app.current_customer_id())));
