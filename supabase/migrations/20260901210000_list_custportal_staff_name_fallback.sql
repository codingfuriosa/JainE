-- The picker was only checking adm.users.full_name, which is null for a lot of active staff whose
-- real name actually lives in acc.user_profile (or, failing that, their Google sign-in metadata) -
-- adm.admin_list_users() already resolves names through exactly this chain, so match it here too.
create or replace function app.list_custportal_staff() returns table(email text, full_name text)
  language plpgsql stable security definer set search_path = adm, acc, public as $$
begin
  if not app.is_custportal_staff() then return; end if;
  return query
    select u.email::text,
      coalesce(nullif(u.full_name,''), nullif(pr.full_name,''), au.raw_user_meta_data->>'full_name', split_part(u.email,'@',1))::text
    from adm.users u
    left join auth.users au on au.email = u.email
    left join acc.user_profile pr on pr.email = u.email
    where u.active
      and u.department && array['Sales','CP Sales','Post Sales','Accounts','Systems','Management']::text[]
    order by 2;
end;
$$;
revoke all on function app.list_custportal_staff() from public, anon;
grant execute on function app.list_custportal_staff() to authenticated;
