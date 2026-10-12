-- Customer Portal Admin, Photos & Videos tab only.
--
-- app.is_custportal_staff() is all-or-nothing: it opens every cust.* table, customers' money
-- included. A site engineer who only uploads construction photos needs far less, so this adds a
-- narrower grant keyed on the 'custportal_photos' module in adm.users.modules (set from the
-- Control Panel tile "Customer Portal: Photos & Videos only"):
--   * read/write on the four construction-photo tables,
--   * read on cust.projects (names only live there),
--   * cust.media_unit_list() for the tower/floor/flat pickers - cust.units itself stays closed,
--     since it carries agreement values and customer links.
-- Full custportal staff keep everything they had; the new policies only add rows for the new role.

create or replace function app.is_custportal_media_editor()
returns boolean language sql stable security definer set search_path to 'adm','public' as $$
  select app.is_custportal_staff() or exists(
    select 1 from adm.users u
     where lower(u.email) = lower(app.current_user_email())
       and u.active
       and 'custportal_photos' = any(u.modules)
  )
$$;
revoke all on function app.is_custportal_media_editor() from public, anon;
grant execute on function app.is_custportal_media_editor() to authenticated;

create policy project_photos_media_editor_all on cust.project_photos for all to authenticated
  using (app.is_custportal_media_editor()) with check (app.is_custportal_media_editor());
create policy tower_photos_media_editor_all on cust.tower_photos for all to authenticated
  using (app.is_custportal_media_editor()) with check (app.is_custportal_media_editor());
create policy floor_photos_media_editor_all on cust.floor_photos for all to authenticated
  using (app.is_custportal_media_editor()) with check (app.is_custportal_media_editor());
create policy unit_photos_media_editor_all on cust.unit_photos for all to authenticated
  using (app.is_custportal_media_editor()) with check (app.is_custportal_media_editor());
create policy projects_media_editor_select on cust.projects for select to authenticated
  using (app.is_custportal_media_editor());

create or replace function cust.media_unit_list()
returns table(id bigint, project_id bigint, project_name text, tower text, unit_code text, status text, floor_casting_completed_at timestamptz)
language sql stable security definer set search_path to 'cust','public' as $$
  select u.id, u.project_id, p.name, u.tower, u.unit_code, u.status, u.floor_casting_completed_at
    from cust.units u join cust.projects p on p.id = u.project_id
   where u.deleted_at is null and p.deleted_at is null and app.is_custportal_media_editor()
   order by u.id desc
$$;
revoke all on function cust.media_unit_list() from public, anon;
grant execute on function cust.media_unit_list() to authenticated;
