-- Weekly Status is for one person (Prerna, businessanalyst@thejaingroup.com), not every superadmin.
-- app.has_module() has always let a superadmin through for any module; that is right for the others
-- and wrong here, so for 'weekly_status' alone the bypass is dropped and the id must be in the
-- caller's own adm.users.modules. Every ops.* policy and ops_* RPC already asks has_module('weekly_status'),
-- so nothing else needs touching. The page's menu entry is restricted by name in nexus-core.js
-- (WEEKLY_STATUS_PEOPLE) - keep the two lists in step.
create or replace function app.has_module(p_module text)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select case when p_module = 'weekly_status' then false else app.is_superadmin() end
      or exists (select 1 from adm.users u
                  where u.email = app.current_user_email()
                    and u.active
                    and p_module = any(coalesce(u.modules, '{}')))
$function$;
