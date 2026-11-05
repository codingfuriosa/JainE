-- SYSTEM FEEDBACKS BY MODULE (5 Nov 2026, asked by Ayush).
--
-- Every System Feedback now belongs to a Module (Post Sales, Legal, Telecalling ...). Systems pick it
-- from a dropdown - or add a new one from the same dropdown - when they post feedbacks, several at
-- once, and both sides see the feedbacks grouped by module. The module is mandatory.
--
--   feedback.system_modules : the list behind the dropdown. Systems add and rename; Sales and Pre Sales
--                             read it (they see the same grouping).
--   system_items.module_id  : not null. The one item posted before this ("Telecalling Report") is put
--                             in a "Telecalling" module.
-- Run after 20:00 IST (no schema changes in office hours).

create table if not exists feedback.system_modules (
  id          bigint generated always as identity primary key,
  name        text not null check (length(btrim(name)) > 0),
  created_by  text not null default lower(app.current_user_email()),
  created_at  timestamptz not null default now()
);
create unique index if not exists system_modules_name_uq on feedback.system_modules (lower(btrim(name)));

alter table feedback.system_modules enable row level security;
revoke all on feedback.system_modules from anon;
grant select, insert, update on feedback.system_modules to authenticated;

drop policy if exists system_modules_read on feedback.system_modules;
create policy system_modules_read on feedback.system_modules for select to authenticated
  using (feedback.is_systems() or feedback.is_system_rater());
drop policy if exists system_modules_insert on feedback.system_modules;
create policy system_modules_insert on feedback.system_modules for insert to authenticated
  with check (feedback.is_systems());
drop policy if exists system_modules_update on feedback.system_modules;
create policy system_modules_update on feedback.system_modules for update to authenticated
  using (feedback.is_systems()) with check (feedback.is_systems());

alter table feedback.system_items add column if not exists module_id bigint references feedback.system_modules(id);
create index if not exists system_items_module_idx on feedback.system_items(module_id);

do $do$
declare v bigint;
begin
  if exists (select 1 from feedback.system_items where module_id is null) then
    insert into feedback.system_modules(name, created_by) values ('Telecalling', 'ayushruia1@gmail.com')
      on conflict do nothing;
    select id into v from feedback.system_modules where lower(btrim(name)) = 'telecalling';
    update feedback.system_items set module_id = v where module_id is null;
  end if;
end $do$;

alter table feedback.system_items alter column module_id set not null;
