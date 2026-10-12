-- Who may get a signed S3 link for which file (called by the s3-sign edge function).
--
-- s3-sign used to check only that the caller was signed in, then sign ANY key to view, upload over
-- or delete. Customers can sign in to the portal since 30 Sep 2026, and staff sign-up is open, so
-- any signed-in account could fetch, overwrite or delete any file in the bucket - other customers'
-- documents, legal files, HR resumes - given its key. Now:
--   * Staff (an active adm.users row, or a super admin): unchanged, anything.
--   * Everyone else (customers, and accounts that are neither):
--       get    - only a file whose database row they can already read. The check runs as the
--                caller (security invoker), so the existing customer RLS on each table decides:
--                their own flat's photos and documents, their project's documents, and so on.
--       put    - only into their own flat's maintenance-receipt / modification-request folders, or
--                their own support ticket's folder - the three places the portal lets them upload.
--       delete - never.
-- Fails closed: anything not matched is refused.

create or replace function app.is_s3_staff() returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (select 1 from adm.users u where lower(u.email) = lower(auth.jwt()->>'email') and u.active is not false)
      or exists (select 1 from adm.user_permissions p where lower(p.email) = lower(auth.jwt()->>'email') and p.super_admin)
$$;
revoke all on function app.is_s3_staff() from public, anon;
grant execute on function app.is_s3_staff() to authenticated;

create or replace function app.s3_key_allowed(p_action text, p_key text) returns boolean
language plpgsql stable security invoker set search_path = app, public as $$
declare
  k text := coalesce(p_key, '');
  sp text;
  m text[];
begin
  if auth.uid() is null or k = '' or k like '%..%' then return false; end if;
  if app.is_s3_staff() then return true; end if;

  if p_action = 'get' then
    sp := 's3:' || k;
    return exists (select 1 from cust.unit_photos            where storage_path = sp)
        or exists (select 1 from cust.tower_photos           where storage_path = sp)
        or exists (select 1 from cust.floor_photos           where storage_path = sp)
        or exists (select 1 from cust.project_photos         where storage_path = sp)
        or exists (select 1 from cust.customer_documents     where storage_path = sp)
        or exists (select 1 from cust.project_documents      where storage_path = sp)
        or exists (select 1 from cust.floor_plans            where storage_path = sp)
        or exists (select 1 from cust.process_videos         where storage_path = sp)
        or exists (select 1 from cust.inspection_checklists  where storage_path = sp)
        or exists (select 1 from cust.inspection_updates     where storage_path = sp)
        or exists (select 1 from cust.support_ticket_attachments where storage_path = sp)
        or exists (select 1 from cust.maintenance_payments   where receipt_storage_path = sp)
        or exists (select 1 from cust.modification_requests  where attachment_storage_path = sp)
        or exists (select 1 from cust.submeter_requests      where invoice_storage_path = sp)
        or exists (select 1 from cust.payment_settings       where qr_storage_path = sp);
  end if;

  if p_action = 'put' then
    m := regexp_match(k, '^portal/customer-portal/units/([0-9]+)/(maintenance-payment-receipt|modification-request)/[^/]+$');
    if m is not null then
      return exists (select 1 from cust.units u where u.id = m[1]::bigint and u.deleted_at is null
                       and u.customer_id = app.current_customer_id());
    end if;
    m := regexp_match(k, '^portal/customer-portal/support-tickets/([0-9]+)/[^/]+$');
    if m is not null then
      return exists (select 1 from cust.support_tickets t join cust.units u on u.id = t.unit_id
                      where t.id = m[1]::bigint and t.deleted_at is null and u.deleted_at is null
                        and u.customer_id = app.current_customer_id());
    end if;
    return false;
  end if;

  return false;  -- delete, or anything else
end $$;
revoke all on function app.s3_key_allowed(text, text) from public, anon;
grant execute on function app.s3_key_allowed(text, text) to authenticated;
