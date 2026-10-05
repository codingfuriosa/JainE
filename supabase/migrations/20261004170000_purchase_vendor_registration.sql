-- Purchase & Stores, Stage 2b: vendor self-registration link and vendor documents.
-- See docs/purchase-stores-spec.md section 2.
--
-- Purchase sends an INVITATION (one per vendor email). The link carries an unguessable token. The public
-- page talks only to the vendor-register edge function, which calls the two functions below with the
-- service role - the browser never touches a table. A submitted registration becomes a vendor in status
-- 'pending', exactly like one enlisted by hand, and goes through the same approval.
--
-- Documents (PAN, GST certificate, cancelled cheque, ...) live in S3; the table holds the pointer.

create table if not exists purchase.vendor_invites(
  id            bigserial primary key,
  token         text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  email         text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_name  text,
  vendor_name   text,
  created_at    timestamptz not null default now(),
  created_by    text default app.current_user_email(),
  expires_at    timestamptz not null default now() + interval '14 days',
  emailed_at    timestamptz,
  used_at       timestamptz,
  vendor_id     bigint,
  revoked_at    timestamptz,
  revoked_by    text
);
comment on table purchase.vendor_invites is
  'One registration link per vendor email. Single use: a submitted registration sets used_at and vendor_id.';

alter table purchase.vendors
  add column if not exists source text not null default 'internal' check (source in ('internal','self_registered')),
  add column if not exists invite_id bigint references purchase.vendor_invites(id);
alter table purchase.vendor_invites
  drop constraint if exists vendor_invites_vendor_fk,
  add constraint vendor_invites_vendor_fk foreign key (vendor_id) references purchase.vendors(id);

create table if not exists purchase.vendor_documents(
  id            bigserial primary key,
  vendor_id     bigint not null references purchase.vendors(id) on delete cascade,
  doc_type      text not null check (doc_type in ('pan','gst_certificate','cancelled_cheque','msme_certificate','other')),
  file_name     text not null,
  storage_path  text not null,
  uploaded_by   text,
  uploaded_at   timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    text
);
create index if not exists vendor_documents_vendor_idx on purchase.vendor_documents (vendor_id) where deleted_at is null;

do $rls$
declare t text;
begin
  foreach t in array array['vendor_invites','vendor_documents'] loop
    execute format('alter table purchase.%I enable row level security', t);
    execute format('drop policy if exists %I on purchase.%I', t || '_staff_all', t);
    execute format('create policy %I on purchase.%I for all to authenticated using ((select not app.is_customer())) with check ((select not app.is_customer()))', t || '_staff_all', t);
    execute format('grant select, insert, update, delete on purchase.%I to authenticated', t);
  end loop;
end $rls$;
grant usage, select on all sequences in schema purchase to authenticated;

-- ---------------------------------------------------------------------------
-- What the public page may ask: is this link good, and what does the form need?
-- ---------------------------------------------------------------------------
create or replace function purchase.vendor_invite_check(p_token text) returns jsonb
 language plpgsql security definer set search_path = purchase, public as $fn$
declare i purchase.vendor_invites;
begin
  select * into i from purchase.vendor_invites where token = p_token;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if i.revoked_at is not null then return jsonb_build_object('error', 'revoked'); end if;
  if i.used_at is not null then return jsonb_build_object('error', 'used'); end if;
  if i.expires_at < now() then return jsonb_build_object('error', 'expired'); end if;
  return jsonb_build_object('ok', true, 'id', i.id, 'email', i.email, 'contact_name', i.contact_name, 'vendor_name', i.vendor_name,
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'parent_id', g.parent_id) order by g.sort_order, g.name)
                          from purchase.item_groups g where g.deleted_at is null), '[]'::jsonb));
end $fn$;

-- ---------------------------------------------------------------------------
-- A vendor submits the registration form. Everything or nothing.
-- ---------------------------------------------------------------------------
create or replace function purchase.register_vendor(p_token text, p jsonb) returns jsonb
 language plpgsql security definer set search_path = purchase, public as $fn$
declare
  i purchase.vendor_invites;
  v_id bigint;
  v_legal text := btrim(coalesce(p->>'legal_name', ''));
  v_gst text := nullif(upper(btrim(coalesce(p->>'gstin', ''))), '');
  v_pan text := nullif(upper(btrim(coalesce(p->>'pan', ''))), '');
  v_pin text := nullif(btrim(coalesce(p->>'pincode', '')), '');
  v_prefix text;
  c jsonb; b jsonb; d jsonb; g jsonb;
  v_has_email boolean := false;
  v_types text[] := '{}';
begin
  select * into i from purchase.vendor_invites where token = p_token for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if i.revoked_at is not null then return jsonb_build_object('error', 'revoked'); end if;
  if i.used_at is not null then return jsonb_build_object('error', 'used'); end if;
  if i.expires_at < now() then return jsonb_build_object('error', 'expired'); end if;

  if v_legal = '' then return jsonb_build_object('error', 'invalid', 'message', 'Please give your registered (legal) name.'); end if;
  if v_gst is not null and v_gst !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then return jsonb_build_object('error', 'invalid', 'message', 'That GSTIN does not look right (15 characters).'); end if;
  if v_pan is not null and v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then return jsonb_build_object('error', 'invalid', 'message', 'That PAN does not look right (e.g. ABCDE1234F).'); end if;
  if v_gst is not null and v_pan is not null and substr(v_gst, 3, 10) <> v_pan then return jsonb_build_object('error', 'invalid', 'message', 'The PAN inside your GSTIN does not match the PAN you entered.'); end if;
  if v_pin is not null and v_pin !~ '^[0-9]{6}$' then return jsonb_build_object('error', 'invalid', 'message', 'PIN code is 6 digits.'); end if;
  if coalesce(p->>'vendor_type', 'supplier') not in ('supplier', 'service', 'both') then return jsonb_build_object('error', 'invalid', 'message', 'Please choose the type of vendor.'); end if;

  if jsonb_typeof(p->'contacts') <> 'array' or jsonb_array_length(p->'contacts') = 0 then return jsonb_build_object('error', 'invalid', 'message', 'Please add at least one contact.'); end if;
  for c in select * from jsonb_array_elements(p->'contacts') loop
    if btrim(coalesce(c->>'name', '')) = '' then return jsonb_build_object('error', 'invalid', 'message', 'Every contact needs a name.'); end if;
    if nullif(btrim(coalesce(c->>'email', '')), '') is not null then
      if (c->>'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('error', 'invalid', 'message', 'One of the email addresses does not look right.'); end if;
      v_has_email := true;
    end if;
  end loop;
  if not v_has_email then return jsonb_build_object('error', 'invalid', 'message', 'At least one contact needs an email address.'); end if;

  if jsonb_typeof(p->'banks') = 'array' then
    for b in select * from jsonb_array_elements(p->'banks') loop
      if btrim(coalesce(b->>'bank_name', '')) = '' or btrim(coalesce(b->>'account_no', '')) = '' then return jsonb_build_object('error', 'invalid', 'message', 'Each bank account needs the bank name and account number.'); end if;
      if nullif(upper(btrim(coalesce(b->>'ifsc', ''))), '') is not null and upper(btrim(b->>'ifsc')) !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then return jsonb_build_object('error', 'invalid', 'message', 'An IFSC code does not look right (e.g. HDFC0001234).'); end if;
    end loop;
  end if;

  v_prefix := 's3:portal/purchase/vendors/invites/' || i.id || '/';
  if jsonb_typeof(p->'documents') = 'array' then
    for d in select * from jsonb_array_elements(p->'documents') loop
      if (d->>'doc_type') not in ('pan', 'gst_certificate', 'cancelled_cheque', 'msme_certificate', 'other')
         or left(coalesce(d->>'storage_path', ''), length(v_prefix)) <> v_prefix then
        return jsonb_build_object('error', 'invalid', 'message', 'One of the uploaded documents could not be accepted - please upload it again.');
      end if;
      v_types := v_types || (d->>'doc_type');
    end loop;
  end if;
  if v_pan is not null and not ('pan' = any (v_types)) then return jsonb_build_object('error', 'invalid', 'message', 'Please upload a copy of your PAN card.'); end if;
  if v_gst is not null and not ('gst_certificate' = any (v_types)) then return jsonb_build_object('error', 'invalid', 'message', 'Please upload your GST registration certificate.'); end if;
  if jsonb_typeof(p->'banks') = 'array' and jsonb_array_length(p->'banks') > 0 and not ('cancelled_cheque' = any (v_types)) then
    return jsonb_build_object('error', 'invalid', 'message', 'Please upload a cancelled cheque (or bank statement first page) for your bank account.');
  end if;

  begin
    insert into purchase.vendors(legal_name, trade_name, vendor_type, pan, gstin, msme_no, address, city, state, pincode, payment_terms, source, invite_id, created_by)
    values (v_legal, nullif(btrim(coalesce(p->>'trade_name', '')), ''), coalesce(p->>'vendor_type', 'supplier'), v_pan, v_gst,
            nullif(btrim(coalesce(p->>'msme_no', '')), ''), nullif(btrim(coalesce(p->>'address', '')), ''), nullif(btrim(coalesce(p->>'city', '')), ''),
            nullif(btrim(coalesce(p->>'state', '')), ''), v_pin, nullif(btrim(coalesce(p->>'payment_terms', '')), ''),
            'self_registered', i.id, 'self-registration: ' || i.email)
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('error', 'invalid', 'message', 'This GSTIN is already on our records. Please contact the purchase team.');
  end;

  for c in select * from jsonb_array_elements(p->'contacts') loop
    insert into purchase.vendor_contacts(vendor_id, name, designation, email, phone, is_primary, gets_rfq)
    values (v_id, btrim(c->>'name'), nullif(btrim(coalesce(c->>'designation', '')), ''), nullif(lower(btrim(coalesce(c->>'email', ''))), ''),
            nullif(btrim(coalesce(c->>'phone', '')), ''), coalesce((c->>'is_primary')::boolean, false), coalesce((c->>'gets_rfq')::boolean, true));
  end loop;
  if not exists (select 1 from purchase.vendor_contacts where vendor_id = v_id and is_primary) then
    update purchase.vendor_contacts set is_primary = true where id = (select min(id) from purchase.vendor_contacts where vendor_id = v_id);
  end if;

  if jsonb_typeof(p->'banks') = 'array' then
    for b in select * from jsonb_array_elements(p->'banks') loop
      insert into purchase.vendor_banks(vendor_id, bank_name, account_name, account_no, ifsc, branch, is_default)
      values (v_id, btrim(b->>'bank_name'), nullif(btrim(coalesce(b->>'account_name', '')), ''), btrim(b->>'account_no'),
              nullif(upper(btrim(coalesce(b->>'ifsc', ''))), ''), nullif(btrim(coalesce(b->>'branch', '')), ''), coalesce((b->>'is_default')::boolean, false));
    end loop;
    if not exists (select 1 from purchase.vendor_banks where vendor_id = v_id and is_default) then
      update purchase.vendor_banks set is_default = true where id = (select min(id) from purchase.vendor_banks where vendor_id = v_id);
    end if;
  end if;

  if jsonb_typeof(p->'group_ids') = 'array' then
    for g in select * from jsonb_array_elements(p->'group_ids') loop
      insert into purchase.vendor_groups(vendor_id, group_id)
      select v_id, ig.id from purchase.item_groups ig where ig.id = (g #>> '{}')::bigint and ig.deleted_at is null
      on conflict do nothing;
    end loop;
  end if;

  if jsonb_typeof(p->'documents') = 'array' then
    for d in select * from jsonb_array_elements(p->'documents') loop
      insert into purchase.vendor_documents(vendor_id, doc_type, file_name, storage_path, uploaded_by)
      values (v_id, d->>'doc_type', left(coalesce(nullif(btrim(d->>'file_name'), ''), 'document'), 160), d->>'storage_path', 'vendor: ' || i.email);
    end loop;
  end if;

  update purchase.vendor_invites set used_at = now(), vendor_id = v_id where id = i.id;
  return jsonb_build_object('ok', true);
end $fn$;

-- Only the edge function (service role) may call these; neither a signed-in user nor an anonymous
-- visitor reaches them directly.
revoke all on function purchase.vendor_invite_check(text) from public, anon, authenticated;
revoke all on function purchase.register_vendor(text, jsonb) from public, anon, authenticated;
grant execute on function purchase.vendor_invite_check(text) to service_role;
grant execute on function purchase.register_vendor(text, jsonb) to service_role;
grant usage on schema purchase to service_role;
grant select, insert, update on all tables in schema purchase to service_role;
grant usage, select on all sequences in schema purchase to service_role;
