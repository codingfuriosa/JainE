/* Usability report: department-wise viewing, and a per-user drill-down into the actual events
   behind a "66 uses" count. Both ride on columns erp_log_usage already writes on every event
   (department, occurred_at, action, project) - nothing new to capture, only new ways to read it.

   Permission gate is copied verbatim from the two existing RPCs (Systems dept via adm.users.modules,
   or superadmin) rather than reused from usability_can_view(), which is a DIFFERENT, unused gate on
   a parallel legacy reporting path (erp_module_activity) that the actual Usability screen never
   calls - matching it here would silently open this to a different set of people than the report
   they're drilling into. */

-- CREATE OR REPLACE does not retarget an existing signature when the parameter list grows even by
-- a trailing default - it adds a second overload instead, which then makes every plain 3-arg caller
-- ambiguous. The old signatures must go first.
drop function if exists public.erp_usability_report(date, date, text);
drop function if exists public.erp_usability_feature_users(text, date, date, text);

create or replace function public.erp_usability_report(p_from date, p_to date, p_email text default null::text, p_department text default null::text)
 returns table(module_id text, module_label text, tab text, feature text, feature_key text, uses bigint, users bigint, last_used timestamp with time zone, band text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_days numeric;
begin
  if not (app.is_superadmin()
          or exists(select 1 from adm.users u
                     where u.email = app.current_user_email()
                       and u.active
                       and 'usability' = any(coalesce(u.modules,'{}')))) then
    raise exception 'Usability is limited to the Systems department';
  end if;

  v_days := greatest((p_to - p_from) + 1, 1);

  return query
  with ev as (
    select e.feature_key,
           count(*)                        as uses,
           count(distinct e.user_email)    as users,
           max(e.occurred_at)              as last_used
      from public.erp_usage_events e
     where (e.occurred_at at time zone 'Asia/Kolkata')::date between p_from and p_to
       and (p_email is null or lower(e.user_email) = lower(p_email))
       and (p_department is null or e.department = p_department)
     group by e.feature_key
  )
  select c.module_id, c.module_label, c.tab, c.feature, c.feature_key,
         coalesce(ev.uses, 0)  as uses,
         coalesce(ev.users, 0) as users,
         ev.last_used,
         case
           when coalesce(ev.uses,0) = 0 then 'Inactive'
           when (ev.uses * 30.0 / v_days) <= 5  then 'Less'
           when (ev.uses * 30.0 / v_days) <= 30 then 'Active'
           else 'Very Active'
         end as band
    from public.erp_feature_catalog c
    left join ev on ev.feature_key = c.feature_key
   where c.active
   order by c.module_label, c.sort;
end;
$function$;

create or replace function public.erp_usability_feature_users(p_feature_key text, p_from date, p_to date, p_email text default null::text, p_department text default null::text)
 returns table(email text, uses bigint, last_used timestamp with time zone)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not (app.is_superadmin()
          or exists(select 1 from adm.users u
                     where u.email = app.current_user_email()
                       and u.active
                       and 'usability' = any(coalesce(u.modules,'{}')))) then
    raise exception 'Usability is limited to the Systems department';
  end if;

  return query
    select e.user_email as email,
           count(*)           as uses,
           max(e.occurred_at) as last_used
      from public.erp_usage_events e
     where e.feature_key = p_feature_key
       and (e.occurred_at at time zone 'Asia/Kolkata')::date between p_from and p_to
       and (p_email is null or lower(e.user_email) = lower(p_email))
       and (p_department is null or e.department = p_department)
     group by e.user_email
     order by max(e.occurred_at) desc;
end;
$function$;

-- One person's individual events behind a feature's use-count, newest first - the "full report"
-- a summary line like "Uma Chatterjee - 66 uses" can't show on its own.
create or replace function public.erp_usability_feature_user_events(p_feature_key text, p_email text, p_from date, p_to date)
 returns table(occurred_at timestamp with time zone, action text, project text, meta jsonb)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not (app.is_superadmin()
          or exists(select 1 from adm.users u
                     where u.email = app.current_user_email()
                       and u.active
                       and 'usability' = any(coalesce(u.modules,'{}')))) then
    raise exception 'Usability is limited to the Systems department';
  end if;

  return query
    select e.occurred_at, e.action, e.project, e.meta
      from public.erp_usage_events e
     where e.feature_key = p_feature_key
       and lower(e.user_email) = lower(p_email)
       and (e.occurred_at at time zone 'Asia/Kolkata')::date between p_from and p_to
     order by e.occurred_at desc
     limit 500;
end;
$function$;

grant execute on function public.erp_usability_report(date, date, text, text) to authenticated;
grant execute on function public.erp_usability_feature_users(text, date, date, text, text) to authenticated;
grant execute on function public.erp_usability_feature_user_events(text, text, date, date) to authenticated;
