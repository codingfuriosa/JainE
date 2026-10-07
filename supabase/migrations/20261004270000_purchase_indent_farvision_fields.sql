-- Purchase & Stores, Stage 3 additions: the fields Farvision captures on an indent.
--   * Document type (a small master list: indent types)
--   * Delivery information (address / contact; the warehouse and required-by date already exist)
--   * Attachments
--   * Change history with the person's IP address (every insert, modification, submission, decision ...)
-- The financial year is not stored: it follows from the document date (1 April - 31 March).

-- ---------------------------------------------------------------------------
-- Indent types (document types)
-- ---------------------------------------------------------------------------
create table if not exists purchase.indent_types(
  id          bigserial primary key,
  name        text not null,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  created_by  text default app.current_user_email(),
  deleted_at  timestamptz,
  deleted_by  text
);
create unique index if not exists indent_types_name_uq on purchase.indent_types (lower(name)) where deleted_at is null;
insert into purchase.indent_types(name, sort_order)
select v.n, v.s from (values ('Indent (BOQ)', 1), ('Indent (Non-BOQ)', 2)) v(n, s)
where not exists (select 1 from purchase.indent_types t where lower(t.name) = lower(v.n) and t.deleted_at is null);

alter table purchase.indents
  add column if not exists indent_type_id  bigint references purchase.indent_types(id),
  add column if not exists delivery_address text,
  add column if not exists contact_person   text,
  add column if not exists contact_phone    text;

-- ---------------------------------------------------------------------------
-- The person's IP address, as the API gateway passes it on
-- ---------------------------------------------------------------------------
create or replace function purchase.client_ip() returns text
 language plpgsql stable as $fn$
declare h json; v text;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then return null; end;
  if h is null then return null; end if;
  v := coalesce(h->>'x-forwarded-for', h->>'cf-connecting-ip', h->>'x-real-ip');
  return nullif(btrim(split_part(coalesce(v, ''), ',', 1)), '');
end $fn$;

alter table purchase.doc_log add column if not exists ip text default purchase.client_ip();

-- ---------------------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------------------
create table if not exists purchase.indent_attachments(
  id            bigserial primary key,
  indent_id     bigint not null references purchase.indents(id) on delete cascade,
  file_name     text not null,
  storage_path  text not null,
  uploaded_by   text default app.current_user_email(),
  uploaded_at   timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    text
);
create index if not exists indent_attachments_idx on purchase.indent_attachments (indent_id) where deleted_at is null;

-- Same lock as the items: attachments change only while the indent is a draft or rejected, by its raiser.
create or replace function purchase.indent_attachments_guard() returns trigger
 language plpgsql set search_path = purchase, public as $fn$
declare i purchase.indents; me text := lower(coalesce(app.current_user_email(), ''));
begin
  if purchase.in_fn() then return new; end if;
  select * into i from purchase.indents where id = coalesce(new.indent_id, old.indent_id);
  if i.status not in ('draft','rejected') then
    raise exception 'This indent is % - its attachments can no longer be changed', replace(i.status, '_', ' ');
  end if;
  if lower(i.raised_by) <> me and not app.is_superadmin() then
    raise exception 'Only the person who raised the indent can change its attachments';
  end if;
  return new;
end $fn$;
drop trigger if exists indent_attachments_guard on purchase.indent_attachments;
create trigger indent_attachments_guard before insert or update on purchase.indent_attachments for each row execute function purchase.indent_attachments_guard();

-- ---------------------------------------------------------------------------
-- Change history: written by triggers so no path can skip it. SECURITY DEFINER because the log itself
-- is read-only to everyone.
-- ---------------------------------------------------------------------------
create or replace function purchase.indents_log() returns trigger
 language plpgsql security definer set search_path = purchase, public as $fn$
begin
  if tg_op = 'INSERT' then
    insert into purchase.doc_log(doc_type, doc_id, by, action) values ('indent', new.id, lower(app.current_user_email()), 'Inserted');
  elsif not purchase.in_fn() then
    if new.deleted_at is not null and old.deleted_at is null then
      insert into purchase.doc_log(doc_type, doc_id, by, action) values ('indent', new.id, lower(app.current_user_email()), 'Deleted');
    else
      insert into purchase.doc_log(doc_type, doc_id, by, action) values ('indent', new.id, lower(app.current_user_email()), 'Modified');
    end if;
  end if;
  return null;
end $fn$;
drop trigger if exists indents_log on purchase.indents;
create trigger indents_log after insert or update on purchase.indents for each row execute function purchase.indents_log();

create or replace function purchase.indent_attachments_log() returns trigger
 language plpgsql security definer set search_path = purchase, public as $fn$
begin
  if tg_op = 'INSERT' then
    insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('indent', new.indent_id, lower(app.current_user_email()), 'Attachment added', new.file_name);
  elsif new.deleted_at is not null and old.deleted_at is null then
    insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('indent', new.indent_id, lower(app.current_user_email()), 'Attachment removed', new.file_name);
  end if;
  return null;
end $fn$;
drop trigger if exists indent_attachments_log on purchase.indent_attachments;
create trigger indent_attachments_log after insert or update on purchase.indent_attachments for each row execute function purchase.indent_attachments_log();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table purchase.indent_types enable row level security;
drop policy if exists indent_types_staff_read on purchase.indent_types;
drop policy if exists indent_types_admin_write on purchase.indent_types;
create policy indent_types_staff_read on purchase.indent_types for select to authenticated using ((select not app.is_customer()));
create policy indent_types_admin_write on purchase.indent_types for all to authenticated
  using ((select purchase.is_module_admin())) with check ((select purchase.is_module_admin()));
grant select, insert, update, delete on purchase.indent_types to authenticated;

alter table purchase.indent_attachments enable row level security;
drop policy if exists indent_attachments_staff_read on purchase.indent_attachments;
drop policy if exists indent_attachments_perm_write on purchase.indent_attachments;
create policy indent_attachments_staff_read on purchase.indent_attachments for select to authenticated using ((select not app.is_customer()));
create policy indent_attachments_perm_write on purchase.indent_attachments for all to authenticated
  using ((select purchase.can('indent.raise'))) with check ((select purchase.can('indent.raise')));
grant select, insert, update, delete on purchase.indent_attachments to authenticated;
grant usage, select on all sequences in schema purchase to authenticated;
