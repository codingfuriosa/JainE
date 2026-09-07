-- Null user_email is structurally impossible through erp_log_usage (it refuses to insert
-- anything without a real signed-in email) - every null-email row in erp_usage_events was
-- written directly to the table, bypassing the app entirely, and can never be attributed to
-- a real person. Excluding them here stops the report from showing an unnamed "ghost" user
-- for what is actually bulk-seeded/test data, not real usage.
create or replace function public.erp_usability_report(p_from date, p_to date, p_email text default null::text, p_department text default null::text)
 returns table(module_id text, module_label text, tab text, feature text, feature_key text, uses bigint, users bigint, last_used timestamp with time zone, band text)
 language plpgsql stable security definer set search_path to 'public'
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
     where e.user_email is not null
       and (e.occurred_at at time zone 'Asia/Kolkata')::date between p_from and p_to
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
 language plpgsql stable security definer set search_path to 'public'
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
       and e.user_email is not null
       and (e.occurred_at at time zone 'Asia/Kolkata')::date between p_from and p_to
       and (p_email is null or lower(e.user_email) = lower(p_email))
       and (p_department is null or e.department = p_department)
     group by e.user_email
     order by max(e.occurred_at) desc;
end;
$function$;
