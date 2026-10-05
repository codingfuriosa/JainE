-- Purchase & Stores, Stage 1: setup. See docs/purchase-stores-spec.md section 1.
--
-- Item groups (nestable) -> items, each tagged with a mandatory HSN code and a receipt UOM, optionally
-- an issue UOM with a fixed conversion factor (dual UOM). Warehouses (several per project). Legal
-- entities, with each project tagged to one - the inter-site transfer rule (Stage 6) needs to know
-- whether two sites belong to the same entity.
--
-- New schema, new tables only. Stock is held in the ISSUE uom when an item has one, otherwise in the
-- receipt uom (purchase.items.stock_uom_id).

create schema if not exists purchase;

create table if not exists purchase.legal_entities(
  id          bigserial primary key,
  name        text not null,
  gstin       text,
  pan         text,
  created_at  timestamptz not null default now(),
  created_by  text default app.current_user_email(),
  deleted_at  timestamptz,
  deleted_by  text
);
create unique index if not exists legal_entities_name_uq on purchase.legal_entities (lower(name)) where deleted_at is null;

-- One row per project that Purchase has been set up for. The project's document-number code stays the
-- one in postsales.project_setup (DG, ...), so a project has a single code across modules.
create table if not exists purchase.project_entity(
  project_id       bigint primary key references cust.projects(id),
  legal_entity_id  bigint references purchase.legal_entities(id),
  updated_at       timestamptz not null default now(),
  updated_by       text default app.current_user_email()
);

create table if not exists purchase.uoms(
  id          bigserial primary key,
  code        text not null,
  name        text,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  text
);
create unique index if not exists uoms_code_uq on purchase.uoms (upper(code)) where deleted_at is null;

create table if not exists purchase.item_groups(
  id          bigserial primary key,
  parent_id   bigint references purchase.item_groups(id),
  code        text not null,
  name        text not null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  created_by  text default app.current_user_email(),
  deleted_at  timestamptz,
  deleted_by  text,
  check (code ~ '^[A-Z0-9]{2,6}$'),
  check (parent_id is distinct from id)
);
create unique index if not exists item_groups_code_uq on purchase.item_groups (code) where deleted_at is null;
create unique index if not exists item_groups_name_uq on purchase.item_groups (coalesce(parent_id,0), lower(name)) where deleted_at is null;
comment on column purchase.item_groups.code is
  'Short prefix, e.g. CEM. An item with no code of its own gets <its top group code>-0001, -0002, ...';

create sequence if not exists purchase.item_code_seq;

create table if not exists purchase.items(
  id               bigserial primary key,
  code             text not null,
  name             text not null,
  group_id         bigint not null references purchase.item_groups(id),
  hsn_code         text not null check (hsn_code ~ '^[0-9]{4}([0-9]{2}([0-9]{2})?)?$'),
  gst_rate         numeric(5,2) not null default 18,
  make             text,
  receipt_uom_id   bigint not null references purchase.uoms(id),
  issue_uom_id     bigint references purchase.uoms(id),
  conversion       numeric(14,4),
  stock_uom_id     bigint generated always as (coalesce(issue_uom_id, receipt_uom_id)) stored,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       text default app.current_user_email(),
  updated_at       timestamptz not null default now(),
  updated_by       text default app.current_user_email(),
  deleted_at       timestamptz,
  deleted_by       text,
  check ((issue_uom_id is null and conversion is null)
      or (issue_uom_id is not null and issue_uom_id <> receipt_uom_id and conversion > 0))
);
create unique index if not exists items_code_uq on purchase.items (upper(code)) where deleted_at is null;
create index if not exists items_group_idx on purchase.items (group_id) where deleted_at is null;
comment on column purchase.items.hsn_code is 'Mandatory: 4, 6 or 8 digits.';
comment on column purchase.items.conversion is
  'Dual UOM only: how many ISSUE uom units make one RECEIPT uom unit (1 MT = 1000 Kg -> 1000).';

create or replace function purchase.items_before_write() returns trigger
 language plpgsql set search_path = purchase, public as $fn$
declare v_root text;
begin
  if new.code is null or btrim(new.code) = '' then
    with recursive up as (
      select id, parent_id, code from purchase.item_groups where id = new.group_id
      union all
      select g.id, g.parent_id, g.code from purchase.item_groups g join up on g.id = up.parent_id)
    select code into v_root from up where parent_id is null;
    new.code := coalesce(v_root, 'ITM') || '-' || lpad(nextval('purchase.item_code_seq')::text, 4, '0');
  else
    new.code := upper(btrim(new.code));
  end if;
  new.updated_at := now();
  new.updated_by := app.current_user_email();
  return new;
end $fn$;
drop trigger if exists items_before_write on purchase.items;
create trigger items_before_write before insert or update on purchase.items
  for each row execute function purchase.items_before_write();

create table if not exists purchase.warehouses(
  id          bigserial primary key,
  project_id  bigint not null references cust.projects(id),
  code        text not null,
  name        text not null,
  in_charge   text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  text default app.current_user_email(),
  deleted_at  timestamptz,
  deleted_by  text
);
create unique index if not exists warehouses_code_uq on purchase.warehouses (project_id, upper(code)) where deleted_at is null;
create unique index if not exists warehouses_name_uq on purchase.warehouses (project_id, lower(name)) where deleted_at is null;

-- Starter UOMs; edit freely in setup.
insert into purchase.uoms(code, name)
select v.c, v.n from (values
 ('Nos','Numbers'),('Bag','Bags'),('Kg','Kilogram'),('MT','Metric tonne'),('Ltr','Litre'),
 ('Mtr','Metre'),('Sqft','Square foot'),('Sqm','Square metre'),('Cft','Cubic foot'),('Cum','Cubic metre'),
 ('Brass','Brass'),('Box','Box'),('Set','Set'),('Rmt','Running metre'),('Drum','Drum'),('Roll','Roll')
) v(c,n)
where not exists (select 1 from purchase.uoms u where upper(u.code) = upper(v.c) and u.deleted_at is null);

-- RLS: same rule as the rest of the app - any staff session, never a customer session.
do $rls$
declare t text;
begin
  foreach t in array array['legal_entities','project_entity','uoms','item_groups','items','warehouses'] loop
    execute format('alter table purchase.%I enable row level security', t);
    execute format('drop policy if exists %I on purchase.%I', t || '_staff_all', t);
    execute format('create policy %I on purchase.%I for all to authenticated using ((select not app.is_customer())) with check ((select not app.is_customer()))', t || '_staff_all', t);
    execute format('grant select, insert, update, delete on purchase.%I to authenticated', t);
  end loop;
end $rls$;
grant usage on schema purchase to authenticated;
grant usage, select on all sequences in schema purchase to authenticated;

-- Expose the schema through PostgREST (the list lives on the authenticator role).
do $expose$
declare cur text;
begin
  select substr(c, length('pgrst.db_schemas=') + 1) into cur
    from pg_db_role_setting s join pg_roles r on r.oid = s.setrole,
         unnest(s.setconfig) c
   where r.rolname = 'authenticator' and c like 'pgrst.db_schemas=%';
  if cur is not null and position('purchase' in cur) = 0 then
    execute format('alter role authenticator set pgrst.db_schemas = %L', cur || ',purchase');
  end if;
end $expose$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';

-- Usage tracking: the new Setup tab of Inventory.
insert into public.erp_feature_catalog(module_id, module_label, tab, feature, feature_key, sort, active) values
('inventory','Inventory','Setup','View purchase & stores setup','inventory.setup.view_setup',506,true)
on conflict (feature_key) do nothing;
