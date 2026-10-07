-- Purchase & Stores: a simpler vendor master.
--   * One vendor EMAIL (purchase.vendors.email) replaces the contacts list on the enlist form: RFQ mails go to it.
--   * Bank accounts are no longer entered on the enlist form.
--   * Ledger: only Ledger Name (was Description), Parent Description and Group remain, plus "Last Modified On".
--     Ledger code, ledger type and sub ledger type are dropped (they were added hours earlier; no vendor had any).
-- The vendor_contacts and vendor_banks tables are KEPT, untouched: the self-registration page (not live yet) still
-- writes to them. A small trigger copies the RFQ contact's email into vendors.email when a vendor registers itself,
-- so its RFQs have an address. "Documents before approval" now covers the PAN card and GST certificate only (the
-- cancelled-cheque check went with the bank accounts).

alter table purchase.vendors add column if not exists email text;
alter table purchase.vendors drop constraint if exists vendors_email_check;
alter table purchase.vendors add constraint vendors_email_check check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
comment on column purchase.vendors.email is 'Where RFQ mails are sent. Required on the enlist form.';

-- vendors that already have contacts (none at the time of writing): use the contact that receives RFQs
update purchase.vendors v set email = (
  select lower(c.email) from purchase.vendor_contacts c
   where c.vendor_id = v.id and c.email is not null
   order by c.gets_rfq desc, c.is_primary desc, c.id limit 1)
 where v.email is null;

-- ledger: rename and drop
alter table purchase.vendors rename column ledger_description to ledger_name;
alter table purchase.vendors drop column if exists ledger_code;
alter table purchase.vendors drop column if exists ledger_type;
alter table purchase.vendors drop column if exists ledger_sub_type;

create or replace function purchase.vendors_before_write() returns trigger
 language plpgsql set search_path = purchase, public as $fn$
declare v_missing text[] := '{}';
begin
  if tg_op = 'INSERT' and (new.code is null or btrim(new.code) = '') then
    new.code := 'V-' || lpad(nextval('purchase.vendor_code_seq')::text, 4, '0');
  end if;
  new.updated_at := now();
  new.updated_by := app.current_user_email();
  new.email := nullif(lower(btrim(new.email)), '');

  -- ledger details: trim, blank = null, and stamp "last modified" only when they really change
  new.ledger_name := nullif(btrim(new.ledger_name), '');
  new.ledger_parent_description := nullif(btrim(new.ledger_parent_description), '');
  new.ledger_group := nullif(btrim(new.ledger_group), '');
  if tg_op = 'INSERT' then
    new.ledger_modified_at := case when coalesce(new.ledger_name, new.ledger_parent_description, new.ledger_group) is not null then now() end;
  elsif (new.ledger_name, new.ledger_parent_description, new.ledger_group)
        is distinct from (old.ledger_name, old.ledger_parent_description, old.ledger_group) then
    new.ledger_modified_at := now();
  else
    new.ledger_modified_at := old.ledger_modified_at;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending';
  elsif new.status is distinct from old.status then
    if new.status <> 'pending' and coalesce(app.current_user_email(), '') <> '' and not purchase.can('vendor.approve') then
      raise exception 'You do not have permission to approve, reject or block vendors - ask a Purchase administrator';
    end if;
    if new.status = 'approved' and purchase.setting('vendor.docs_before_approval', 'warn') = 'block' then
      if new.pan is not null and not exists (select 1 from purchase.vendor_documents d where d.vendor_id = new.id and d.doc_type = 'pan' and d.deleted_at is null) then
        v_missing := array_append(v_missing, 'PAN card');
      end if;
      if new.gstin is not null and not exists (select 1 from purchase.vendor_documents d where d.vendor_id = new.id and d.doc_type = 'gst_certificate' and d.deleted_at is null) then
        v_missing := array_append(v_missing, 'GST certificate');
      end if;
      if array_length(v_missing, 1) > 0 then
        raise exception 'This vendor cannot be approved yet - missing: %. Upload them first (Docs button).', array_to_string(v_missing, ', ');
      end if;
    end if;
    new.status_by := app.current_user_email();
    new.status_at := now();
  end if;
  return new;
end $fn$;

-- self-registration still records contacts: the first contact that gets RFQ mails becomes the vendor's email
create or replace function purchase.vendor_contacts_fill_email() returns trigger
 language plpgsql security definer set search_path = purchase, public as $fn$
begin
  if new.email is not null and coalesce(new.gets_rfq, true) then
    update purchase.vendors set email = new.email where id = new.vendor_id and email is null;
  end if;
  return null;
end $fn$;
drop trigger if exists vendor_contacts_fill_email on purchase.vendor_contacts;
create trigger vendor_contacts_fill_email after insert on purchase.vendor_contacts for each row execute function purchase.vendor_contacts_fill_email();
revoke all on function purchase.vendor_contacts_fill_email() from public, anon, authenticated;
