-- Purchase & Stores: module administrators.
--
-- A short list of people who may change the setups the whole module depends on: who approves what
-- (approval chains), which legal entity owns each project, the warehouses, and this list itself.
-- Everyone else on staff can still READ these (indents, POs etc. need them) but cannot change them -
-- enforced here in row-level security, not only by hiding the Admin tab.
--
-- Items, item groups and UOMs stay open to all staff, as before.

create table if not exists purchase.module_admins(
  email       text primary key,
  created_at  timestamptz not null default now(),
  created_by  text default app.current_user_email()
);

insert into purchase.module_admins(email, created_by) values
  ('ayushruia1@gmail.com', 'migration'),
  ('businessanalyst@thejaingroup.com', 'migration'),
  ('system3.thejaingroup@gmail.com', 'migration')
on conflict (email) do nothing;

create or replace function purchase.is_module_admin() returns boolean
 language sql stable security definer set search_path = purchase, public as $fn$
  select not app.is_customer()
     and exists (select 1 from purchase.module_admins a where lower(a.email) = lower(coalesce(app.current_user_email(), '')))
$fn$;
revoke all on function purchase.is_module_admin() from public, anon;
grant execute on function purchase.is_module_admin() to authenticated;

do $rls$
declare t text;
begin
  foreach t in array array['module_admins','approval_chains','legal_entities','project_entity','warehouses'] loop
    execute format('alter table purchase.%I enable row level security', t);
    execute format('drop policy if exists %I on purchase.%I', t || '_staff_all', t);
    execute format('drop policy if exists %I on purchase.%I', t || '_staff_read', t);
    execute format('drop policy if exists %I on purchase.%I', t || '_admin_write', t);
    execute format('create policy %I on purchase.%I for select to authenticated using ((select not app.is_customer()))', t || '_staff_read', t);
    execute format('create policy %I on purchase.%I for all to authenticated using ((select purchase.is_module_admin())) with check ((select purchase.is_module_admin()))', t || '_admin_write', t);
    execute format('grant select, insert, update, delete on purchase.%I to authenticated', t);
  end loop;
end $rls$;

insert into public.erp_feature_catalog(module_id, module_label, tab, feature, feature_key, sort, active) values
('inventory','Inventory','Admin','View purchase admin','inventory.admin.view_admin',509,true)
on conflict (feature_key) do nothing;
