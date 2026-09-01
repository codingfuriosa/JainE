-- adm.users only lets a staff member read their OWN row via RLS (users_self_read), so the client
-- can't build a "pick a Project Manager" dropdown by querying adm.users directly - it would return
-- zero rows for anyone who isn't a superadmin. This narrow function is the same shape as
-- app.get_zoho_secrets(): it checks app.is_custportal_staff() itself, then returns only what a
-- staff picker needs (name + email), scoped to the same departments that already grant custportal
-- access - so the dropdown only ever offers people who could plausibly be assigned as a PM.
create or replace function app.list_custportal_staff() returns table(email text, full_name text)
  language sql stable security definer set search_path = adm, public as $$
  select u.email, u.full_name from adm.users u
  where app.is_custportal_staff()
    and u.active
    and u.department && array['Sales','CP Sales','Post Sales','Accounts','Systems','Management']::text[]
  order by u.full_name
$$;
revoke all on function app.list_custportal_staff() from public, anon;
grant execute on function app.list_custportal_staff() to authenticated;
