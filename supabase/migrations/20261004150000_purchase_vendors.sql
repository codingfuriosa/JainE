-- Purchase & Stores, Stage 2: vendor enlistment. See docs/purchase-stores-spec.md section 2.
--
-- A vendor is enlisted by Purchase (status 'pending'), then verified and approved. Only an APPROVED
-- vendor can be sent an RFQ or given a PO (enforced in the stages that use vendors). Contacts carry the
-- email addresses RFQs go to; the item groups a vendor supplies drive who is suggested for an RFQ.
-- Stage 2b adds the self-registration link and document uploads.

create sequence if not exists purchase.vendor_code_seq;

create table if not exists purchase.vendors(
  id             bigserial primary key,
  code           text not null,
  legal_name     text not null,
  trade_name     text,
  vendor_type    text not null default 'supplier' check (vendor_type in ('supplier','service','both')),
  pan            text check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  gstin          text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  msme_no        text,
  address        text,
  city           text,
  state          text,
  pincode        text check (pincode ~ '^[0-9]{6}$'),
  payment_terms  text,
  status         text not null default 'pending' check (status in ('pending','approved','rejected','blocked')),
  status_remark  text,
  status_by      text,
  status_at      timestamptz,
  created_at     timestamptz not null default now(),
  created_by     text default app.current_user_email(),
  updated_at     timestamptz not null default now(),
  updated_by     text default app.current_user_email(),
  deleted_at     timestamptz,
  deleted_by     text
);
create unique index if not exists vendors_code_uq on purchase.vendors (code);
create unique index if not exists vendors_gstin_uq on purchase.vendors (gstin) where gstin is not null and deleted_at is null;
create index if not exists vendors_status_idx on purchase.vendors (status) where deleted_at is null;
comment on column purchase.vendors.status is
  'pending: enlisted, awaiting verification. approved: can receive RFQs and POs. rejected / blocked: cannot.';

create table if not exists purchase.vendor_contacts(
  id           bigserial primary key,
  vendor_id    bigint not null references purchase.vendors(id) on delete cascade,
  name         text not null,
  designation  text,
  email        text,
  phone        text,
  is_primary   boolean not null default false,
  gets_rfq     boolean not null default true
);
create index if not exists vendor_contacts_vendor_idx on purchase.vendor_contacts (vendor_id);
comment on column purchase.vendor_contacts.gets_rfq is 'Receives the RFQ / counter-offer emails.';

create table if not exists purchase.vendor_banks(
  id            bigserial primary key,
  vendor_id     bigint not null references purchase.vendors(id) on delete cascade,
  bank_name     text not null,
  account_name  text,
  account_no    text not null,
  ifsc          text check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  branch        text,
  is_default    boolean not null default false
);
create index if not exists vendor_banks_vendor_idx on purchase.vendor_banks (vendor_id);

create table if not exists purchase.vendor_groups(
  vendor_id  bigint not null references purchase.vendors(id) on delete cascade,
  group_id   bigint not null references purchase.item_groups(id),
  primary key (vendor_id, group_id)
);

create or replace function purchase.vendors_before_write() returns trigger
 language plpgsql set search_path = purchase, public as $fn$
begin
  if tg_op = 'INSERT' and (new.code is null or btrim(new.code) = '') then
    new.code := 'V-' || lpad(nextval('purchase.vendor_code_seq')::text, 4, '0');
  end if;
  new.updated_at := now();
  new.updated_by := app.current_user_email();
  if tg_op = 'INSERT' then
    new.status := 'pending';
  elsif new.status is distinct from old.status then
    new.status_by := app.current_user_email();
    new.status_at := now();
  end if;
  return new;
end $fn$;
drop trigger if exists vendors_before_write on purchase.vendors;
create trigger vendors_before_write before insert or update on purchase.vendors
  for each row execute function purchase.vendors_before_write();

do $rls$
declare t text;
begin
  foreach t in array array['vendors','vendor_contacts','vendor_banks','vendor_groups'] loop
    execute format('alter table purchase.%I enable row level security', t);
    execute format('drop policy if exists %I on purchase.%I', t || '_staff_all', t);
    execute format('create policy %I on purchase.%I for all to authenticated using ((select not app.is_customer())) with check ((select not app.is_customer()))', t || '_staff_all', t);
    execute format('grant select, insert, update, delete on purchase.%I to authenticated', t);
  end loop;
end $rls$;
grant usage, select on all sequences in schema purchase to authenticated;

insert into public.erp_feature_catalog(module_id, module_label, tab, feature, feature_key, sort, active) values
('inventory','Inventory','Vendors','View vendors','inventory.vendors.view_vendors',507,true)
on conflict (feature_key) do nothing;
