/* The drill-down behind Workflow health's three backlog numbers: which STEP is the work sitting
   on, and with whom.

   The health row says Invoice Processing has 127 instances received-and-not-forwarded. That is a
   number to worry about but not one you can act on. This breaks it down, and the answer turns out
   to be a single step: 92 of them are on "RTP / Schedule Payment" with one person, the oldest
   waiting a fortnight. That is a conversation with one colleague, not a workflow problem.

   p_state matches the three columns exactly:
     'awaiting'  every current step that has appeared and not been received — the column total.
     'fwd'       the subset where a previous person actually forwarded it, so the handover happened
                 and the next person has not accepted. The difference between this and 'awaiting'
                 is instances nobody ever started.
     'inhand'    received and not moved on.

   Grouped by step rather than by instance: fifty rows of "bill 312, bill 313, bill 314" is the
   same fact written fifty times. Owners are aggregated because a shared step has several, and the
   count of distinct owners is returned so the UI can say "and 5 others" honestly rather than
   implying one person holds everything.

   'since' is received_at for in-hand work and appeared_at for the rest, so "oldest" always means
   how long it has been in its CURRENT state, not how old the instance is.

   Same access gate as the rest of the Usability report. */
create or replace function public.erp_usability_workflow_stuck_steps(p_flow_id bigint, p_state text)
 returns table(seq integer, step text, instances bigint, owners bigint,
               who text[], oldest_days numeric)
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

  if p_state not in ('awaiting','fwd','inhand') then
    raise exception 'unknown state %', p_state;
  end if;

  return query
  with s as (
    select st.seq,
           coalesce(st.title,'(untitled step)')                                   as step,
           coalesce(st.person, nullif(array_to_string(st.candidates,', '),''),
                    '(nobody assigned)')                                          as owner,
           coalesce(st.received_at, st.appeared_at)                               as since,
           (st.received_at is not null)                                           as received,
           exists (select 1 from acc.flow_case_steps p
                    where p.case_id = c.id and p.seq < st.seq
                      and p.forwarded_at is not null)                             as predecessor_forwarded
      from acc.flow_cases c
      join acc.flow_case_steps st on st.case_id = c.id and st.seq = c.current_step
     where c.flow_id = p_flow_id
       and c.status not in ('Done','Cancelled')
       and st.forwarded_at is null
       and st.appeared_at is not null
  ),
  f as (
    select * from s
     where (p_state = 'inhand'   and received)
        or (p_state = 'awaiting' and not received)
        or (p_state = 'fwd'      and not received and predecessor_forwarded)
  )
  select f.seq, f.step, count(*) as instances,
         count(distinct f.owner) as owners,
         (array_agg(distinct f.owner))[1:4] as who,
         round(extract(epoch from (now() - min(f.since)))/86400.0, 1) as oldest_days
    from f
   group by f.seq, f.step
   order by count(*) desc, f.seq;
end;
$function$;
