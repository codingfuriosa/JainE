/* The per-feature drill-down (erp_usability_feature_user_events) only ever shows one feature's
   events for one person. This is the broader ask: everything one person did, across every
   feature, in one chronological list - so "what has Uma actually been doing" doesn't mean opening
   every feature row one at a time to check. Same permission gate as the rest of Usability. */
create or replace function public.erp_usability_user_activity(p_email text, p_from date, p_to date)
 returns table(occurred_at timestamp with time zone, module_label text, tab text, feature text,
               feature_key text, action text, project text)
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
           e.action, e.project
      from public.erp_usage_events e
      left join public.erp_feature_catalog c on c.feature_key = e.feature_key
     where lower(e.user_email) = lower(p_email)
       and (e.occurred_at at time zone 'Asia/Kolkata')::date between p_from and p_to
     order by e.occurred_at desc
     limit 1000;
end;
$function$;

grant execute on function public.erp_usability_user_activity(text, date, date) to authenticated;
