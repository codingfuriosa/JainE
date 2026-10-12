-- Purchase & Stores: the vendor's accounting ledger details, shown on the vendor enlist form.
--   Code, Description, Ledger Type, Parent Description, Last Modified On, Sub Ledger Type, Group
-- (the columns of the Accounts ledger master). They are plain text typed by whoever enlists the vendor - JainE has no
-- ledger master to pick from yet. "Last Modified On" is kept by the database: it is set when a ledger field is first
-- filled in or changed and is left alone by any other edit to the vendor (and cannot be set from the browser).
-- None of these fields takes part in vendor re-approval (that is GSTIN, PAN and bank accounts only).

alter table purchase.vendors
  add column if not exists ledger_code               text,
  add column if not exists ledger_description        text,
  add column if not exists ledger_type               text,
  add column if not exists ledger_parent_description text,
  add column if not exists ledger_sub_type           text,
  add column if not exists ledger_group              text,
  add column if not exists ledger_modified_at        timestamptz;

create or replace function purchase.vendors_before_write() returns trigger
 language plpgsql set search_path = purchase, public as $fn$
declare v_missing text[] := '{}';
begin
  if tg_op = 'INSERT' and (new.code is null or btrim(new.code) = '') then
    new.code := 'V-' || lpad(nextval('purchase.vendor_code_seq')::text, 4, '0');
  end if;
  new.updated_at := now();
  new.updated_by := app.current_user_email();

  -- ledger details: trim, blank = null, and stamp "last modified" only when they really change
  new.ledger_code := nullif(btrim(new.ledger_code), '');
  new.ledger_description := nullif(btrim(new.ledger_description), '');
  new.ledger_type := nullif(btrim(new.ledger_type), '');
  new.ledger_parent_description := nullif(btrim(new.ledger_parent_description), '');
  new.ledger_sub_type := nullif(btrim(new.ledger_sub_type), '');
  new.ledger_group := nullif(btrim(new.ledger_group), '');
  if tg_op = 'INSERT' then
    new.ledger_modified_at := case when coalesce(new.ledger_code, new.ledger_description, new.ledger_type, new.ledger_parent_description, new.ledger_sub_type, new.ledger_group) is not null then now() end;
  elsif (new.ledger_code, new.ledger_description, new.ledger_type, new.ledger_parent_description, new.ledger_sub_type, new.ledger_group)
        is distinct from (old.ledger_code, old.ledger_description, old.ledger_type, old.ledger_parent_description, old.ledger_sub_type, old.ledger_group) then
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
      if exists (select 1 from purchase.vendor_banks b where b.vendor_id = new.id)
         and not exists (select 1 from purchase.vendor_documents d where d.vendor_id = new.id and d.doc_type = 'cancelled_cheque' and d.deleted_at is null) then
        v_missing := array_append(v_missing, 'cancelled cheque');
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
