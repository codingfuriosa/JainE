/* "Times used" on the Usability drill-down: how many times this person had used this feature,
   counting the row you are looking at.

   WHY A COLUMN THAT IS DERIVED RATHER THAN CAPTURED.
   The drill-down's other two columns both read from erp_usage_events.meta, and meta is written per
   feature by whichever bit of code fired the event - so it is only ever as complete as that one
   feature remembered to be. Measured over everything since June: meta is null on 75 of the 157
   features actually in use, 1,884 events behind a permanently empty Details column, and the
   promoted "Waited" column is blank on 12 of the 17 Workflow features and on ~61% of the two
   biggest. Every candidate key fails the same way, because no key is common to all features.

   This one is not captured at all - it is the row's own position in that person's history of that
   feature, so every row has one. It works on the 5,736 events the historical backfill left with no
   usable meta, and it needs nothing added to the capture side ever again.

   It is also the question a usability report exists to answer. A column that never leaves 1 means
   people try a feature once and do not come back; one that climbs means it has become part of
   somebody's day. Across all events since June it reads 12% first use, 19% second-to-fifth, 69%
   habitual - so it is a real distribution, not a column of ones.

   NUMBERED OVER THE WHOLE HISTORY, THEN FILTERED.
   The window function runs before the date filter on purpose. Numbering only the rows in range
   would restart at 1 every time somebody narrowed the date picker, which would make the column say
   the opposite of what it means - a long-standing user would read as a newcomer.

   The return type gains a column, so this drops and recreates rather than CREATE OR REPLACE. */
drop function if exists public.erp_usability_feature_user_events(text, text, date, date);

create or replace function public.erp_usability_feature_user_events(
  p_feature_key text, p_email text, p_from date, p_to date)
 returns table(occurred_at timestamptz, action text, project text, meta jsonb, use_n bigint)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  -- Unchanged: the numbers are about named people, so the gate stays exactly as it was.
  if not (app.is_superadmin()
          or exists(select 1 from adm.users u
                     where u.email = app.current_user_email()
                       and u.active
                       and 'usability' = any(coalesce(u.modules,'{}')))) then
    raise exception 'Usability is limited to the Systems department';
  end if;

  return query
    with numbered as (
      select e.occurred_at, e.action, e.project, e.meta,
             row_number() over (order by e.occurred_at) as use_n
        from public.erp_usage_events e
       where e.feature_key = p_feature_key
         and lower(e.user_email) = lower(p_email)
    )
    select n.occurred_at, n.action, n.project, n.meta, n.use_n
      from numbered n
     where (n.occurred_at at time zone 'Asia/Kolkata')::date between p_from and p_to
     order by n.occurred_at desc
     limit 500;
end;
$function$;
