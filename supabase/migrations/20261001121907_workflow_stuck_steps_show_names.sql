/* Daily Checks: show people's NAMES, not their email addresses.

   "92 bills with cfo@thejaingroup.com" asks the reader to translate an address into a colleague
   before they can act on it. "92 bills with GyanPrakash Sah" does not. Every other screen in the
   portal already resolves names this way; the drill-down was the odd one out because it was
   aggregating raw step owners.

   WHERE THE NAME COMES FROM, in order: acc.user_profile.full_name, then adm.users.full_name, then
   the address itself. Measured over the 25 people currently holding live steps: user_profile has
   24 of them, adm.users adds none that it lacks, and one address (sales.dreamgurukul1@) has no
   name recorded anywhere, so it keeps showing as the address rather than as a blank or a dash. A
   shared mailbox with no human behind it is a real case here, not an error to hide.

   Resolved in SQL rather than in the page, so anything else reading this function — an export, a
   report, the PDF — gets the same names without repeating the lookup.

   The step's owner string can hold several addresses ("a@x, b@x"), because that is how a shared
   step is stored. Those are split, resolved one by one and rejoined, so a two-person step reads
   "Arun kr Pandey, Bachchu Samanta" rather than being left alone as an unmatched blob. */
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
                    '(nobody assigned)')                                          as owner_raw,
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
  ),
  named as (
    select f.seq, f.step, f.since,
           -- one owner string may list several addresses; resolve each, keep the original order
           (select string_agg(
                     coalesce(nullif(btrim(up.full_name),''),
                              nullif(btrim(au.full_name),''),
                              btrim(e.addr)), ', ' order by e.ord)
              from unnest(string_to_array(f.owner_raw, ',')) with ordinality as e(addr, ord)
              left join acc.user_profile up on lower(up.email) = lower(btrim(e.addr))
              left join adm.users au       on lower(au.email) = lower(btrim(e.addr))
           ) as owner
      from f
  )
  select n.seq, n.step, count(*) as instances,
         count(distinct n.owner) as owners,
         (array_agg(distinct n.owner))[1:4] as who,
         round(extract(epoch from (now() - min(n.since)))/86400.0, 1) as oldest_days
    from named n
   group by n.seq, n.step
   order by count(*) desc, n.seq;
end;
$function$;
