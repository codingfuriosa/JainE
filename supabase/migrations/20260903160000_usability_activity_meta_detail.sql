-- erp_usability_user_activity did not select meta at all - the Full Activity Log couldn't show any
-- of the "what specifically happened" detail the per-feature drill-down now can. CREATE OR REPLACE
-- refuses to change a function's return type outright (unlike the earlier parameter-count case,
-- this one cannot even land as a confusing second overload) - the old one has to go first.
drop function if exists public.erp_usability_user_activity(text, date, date);

create or replace function public.erp_usability_user_activity(p_email text, p_from date, p_to date)
 returns table(occurred_at timestamp with time zone, module_label text, tab text, feature text,
               feature_key text, action text, project text, meta jsonb)
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
    select e.occurred_at, c.module_label, c.tab, coalesce(c.feature, e.feature_key), e.feature_key,
           e.action, e.project, e.meta
      from public.erp_usage_events e
      left join public.erp_feature_catalog c on c.feature_key = e.feature_key
     where lower(e.user_email) = lower(p_email)
       and (e.occurred_at at time zone 'Asia/Kolkata')::date between p_from and p_to
     order by e.occurred_at desc
     limit 1000;
end;
$function$;
