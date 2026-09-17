/* Usability: a bulk import is not somebody using the portal - but its rows are not deleted either.

   1,636 events are attributed to things that are not people. They came in with the first
   reconstruction, which took whoever the source row named as its actor - and for documents loaded
   in bulk that field holds a label, not an address:

     import                            1,229   Legal documents, folders, case files
     jain group                          337   Legal documents
     system                               55   Legal document folders
     system: folded into the lead row     13   Transcription, deleted calls
     careers page                          2   HR resumes

   This is the honest answer to why Legal reads as the busiest module in the company. It is not that
   five people upload two thousand documents; it is that a one-off migration loaded them and the
   reconstruction counted the migration as a user. The report then shows those rows in the People
   column and in every count, with no person behind any of them.

   An earlier draft of this migration deleted them. That was the wrong instinct and it is not what
   this does. Every individual record is kept - the brief is that nothing gets thrown away and no
   real action is ever folded into another. The report simply stops counting a label as a colleague,
   exactly the way it already stops counting a null user: the note on that change said such rows
   "can never be attributed to a real person", and these are the same thing wearing a name.

   The test is deliberately narrow. An actor with no "@" in it is not an address and cannot be a
   person. Two real addresses belong to nobody in adm.users any more (sales.dreamgurukul1@,
   s.khetan22@) - people who have left or were never enrolled - and their three events keep counting.
   Dropping a departed colleague's history would be the same mistake in the opposite direction. */

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
           count(distinct lower(e.user_email)) as users,
           max(e.occurred_at)              as last_used
      from public.erp_usage_events e
     where e.user_email is not null
       and position('@' in e.user_email) > 0   -- a label is not a colleague; see the note above
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
    -- Grouped on the lower-cased address, not the raw one. The report's own filter already compares
    -- case-insensitively, so one person signing in with a capital letter once was splitting into
    -- two lines here and counting as two in the People column.
    select lower(e.user_email) as email,
           count(*)           as uses,
           max(e.occurred_at) as last_used
      from public.erp_usage_events e
     where e.feature_key = p_feature_key
       and e.user_email is not null
       and position('@' in e.user_email) > 0
       and (e.occurred_at at time zone 'Asia/Kolkata')::date between p_from and p_to
       and (p_email is null or lower(e.user_email) = lower(p_email))
       and (p_department is null or e.department = p_department)
     group by lower(e.user_email)
     order by max(e.occurred_at) desc;
end;
$function$;

/* And the department, which was being read from the wrong place.
   erp_log_usage stamps each event with the person's department out of acc.user_profile, but the
   Department filter builds its list from adm.users - and the two do not agree. All 85 people in
   adm.users have a department; four profiles do not, and the older profile rows are thinner still.
   That mismatch is why events arrive with no department at all and then quietly disappear the
   moment somebody filters by one. adm.users is the list the filter itself is built from, so that is
   what the stamp should follow; the profile stays as a fallback for anyone not yet in adm.users. */
create or replace function public.erp_log_usage(p_events jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_email text;
  v_dept  text;
  v_n     integer := 0;
begin
  v_email := nullif(auth.jwt() ->> 'email', '');
  if v_email is null then
    return 0;                     -- not signed in: record nothing
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    return 0;
  end if;

  select coalesce(
           (select case when cardinality(u.department) > 0 then u.department[1] end
              from adm.users u where lower(u.email) = lower(v_email)),
           (select case when cardinality(up.department) > 0 then up.department[1] end
              from acc.user_profile up where lower(up.email) = lower(v_email)))
    into v_dept;

  insert into public.erp_usage_events
    (module_id, feature_key, action, user_email, department, project, duration_ms, occurred_at, meta,
     client_event_id)
  select m.module_id,
         left(coalesce(nullif(e.j ->> 'feature_key', ''), m.module_id), 128),
         case lower(coalesce(e.j ->> 'action', 'view'))
           when 'view'      then 'view'
           when 'route'     then 'route'
           when 'heartbeat' then 'heartbeat'
           when 'create'    then 'create'
           when 'update'    then 'update'
           when 'delete'    then 'delete'
           when 'export'    then 'export'
           when 'search'    then 'search'
           when 'error'     then 'error'
           else 'view'
         end,
         v_email,
         v_dept,
         nullif(left(e.j ->> 'project', 64), ''),
         case when (e.j ->> 'duration_ms') ~ '^[0-9]{1,9}$'
              then (e.j ->> 'duration_ms')::integer end,
         greatest(
           least(
             case when (e.j ->> 'occurred_at') ~ '^\d{4}-\d{2}-\d{2}T'
                  then (e.j ->> 'occurred_at')::timestamptz
                  else now() end,
             now()),
           now() - interval '1 day'),
         case when jsonb_typeof(e.j -> 'meta') = 'object' then e.j -> 'meta' end,
         nullif(left(e.j ->> 'eid', 64), '')
    from (select t.j from jsonb_array_elements(p_events) as t(j) limit 60) e
    join public.erp_modules m on m.module_id = e.j ->> 'module_id'
      on conflict do nothing;

  get diagnostics v_n = row_count;
  return v_n;
exception
  when others then
    raise warning 'erp_log_usage dropped a batch: % (%)', sqlerrm, sqlstate;
    return 0;
end
$function$;

-- Filling in the department on the events already recorded, from the same list. Nothing is removed
-- and no existing department is overwritten - only the blanks are filled.
update public.erp_usage_events e
   set department = (u.department)[1]
  from adm.users u
 where e.department is null
   and e.user_email is not null
   and lower(u.email) = lower(e.user_email)
   and coalesce(cardinality(u.department), 0) > 0;
