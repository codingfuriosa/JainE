-- SYSTEM FEEDBACKS (Feedback Hub).
--
-- The Systems department posts what it has just built or fixed (a "New Feature" or a "Bug Fixed"):
-- a name, a description and who executed it. Sales and Pre Sales open each one and rate it 1-10
-- with an optional remark. No QR, no public page: it is all inside the ERP, signed in.
--
-- Who sees what (the database rule; the page only mirrors it):
--   * Systems department + the Administrator: create, edit and close items, and read EVERY rating,
--     whether or not they are among the people who executed it.
--   * Sales and Pre Sales: read the items, and write and read back only their own rating.
--     Nobody else's rating is ever returned to them.
--   * Everyone else (Suchandra Das included): nothing at all.
-- One rating per person per item; it can be changed until the item is closed.

create or replace function feedback.is_systems()
returns boolean language sql stable security definer set search_path to '' as $$
  select lower(coalesce(app.current_user_email(),'')) = 'ayushruia1@gmail.com'
      or exists (select 1 from acc.user_profile p
                  where lower(p.email) = lower(app.current_user_email())
                    and 'Systems' = any(p.department))
$$;

create or replace function feedback.is_system_rater()
returns boolean language sql stable security definer set search_path to '' as $$
  select lower(coalesce(app.current_user_email(),'')) = 'ayushruia1@gmail.com'
      or exists (select 1 from acc.user_profile p
                  where lower(p.email) = lower(app.current_user_email())
                    and p.department && array['Sales','Pre Sales']::text[])
$$;

revoke all on function feedback.is_systems(), feedback.is_system_rater() from public, anon;
grant execute on function feedback.is_systems(), feedback.is_system_rater() to authenticated;

create table if not exists feedback.system_items (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('New Feature','Bug Fixed')),
  title        text not null check (length(btrim(title)) > 0),
  description  text not null check (length(btrim(description)) > 0),
  executed_by  text[] not null check (cardinality(executed_by) > 0),
  is_active    boolean not null default true,
  created_by   text not null default lower(app.current_user_email()),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists feedback.system_responses (
  id            bigint generated always as identity primary key,
  item_id       bigint not null references feedback.system_items(id) on delete cascade,
  rater_email   text not null default lower(app.current_user_email()),
  rating        int  not null check (rating between 1 and 10),
  remarks       text,
  submitted_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (item_id, rater_email)
);
create index if not exists system_responses_item_idx on feedback.system_responses(item_id);

alter table feedback.system_items enable row level security;
alter table feedback.system_responses enable row level security;

revoke all on feedback.system_items, feedback.system_responses from anon;
grant select, insert, update, delete on feedback.system_items to authenticated;
grant select, insert, update on feedback.system_responses to authenticated;

-- items
create policy system_items_read on feedback.system_items for select to authenticated
  using (feedback.is_systems() or feedback.is_system_rater());
create policy system_items_insert on feedback.system_items for insert to authenticated
  with check (feedback.is_systems() and created_by = lower(app.current_user_email()));
create policy system_items_update on feedback.system_items for update to authenticated
  using (feedback.is_systems()) with check (feedback.is_systems());
create policy system_items_delete on feedback.system_items for delete to authenticated
  using (feedback.is_systems());

-- responses: Systems read all; a rater reads and writes only their own, and only on an open item
create policy system_responses_read on feedback.system_responses for select to authenticated
  using (feedback.is_systems() or rater_email = lower(app.current_user_email()));
create policy system_responses_insert on feedback.system_responses for insert to authenticated
  with check (feedback.is_system_rater()
              and rater_email = lower(app.current_user_email())
              and exists (select 1 from feedback.system_items i where i.id = item_id and i.is_active));
create policy system_responses_update on feedback.system_responses for update to authenticated
  using (rater_email = lower(app.current_user_email()))
  with check (rater_email = lower(app.current_user_email())
              and exists (select 1 from feedback.system_items i where i.id = item_id and i.is_active));
