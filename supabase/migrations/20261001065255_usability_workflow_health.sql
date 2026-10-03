/* Workflow health, per workflow, for the Usability report's Workflow tab.

   WHY THIS IS A SEPARATE FUNCTION AND NOT MORE FEATURE ROWS.
   The rest of that report answers "did somebody click this today". Five of these six answer
   "where is the work stuck right now", which no amount of usage logging produces — they are counts
   over acc.flow_cases and acc.flow_case_steps. Only "reverted" comes from usage events, and it can
   be attributed per workflow because those events carry meta->>'workflow'.

   IT IGNORES THE REPORT'S DATE PICKER, ON PURPOSE.
   Three of these are a snapshot of this moment ("is anything sitting unreceived"), which a date
   range cannot sensibly filter, and the other three were asked for as "yesterday" because this is
   a once-a-morning routine. Making half of them follow the picker and half not would be worse than
   having them all answer the same fixed question. The UI says plainly that it is live + yesterday.

   THE SIX:
     awaiting_receipt       step has appeared for someone and is not picked up yet. Includes a first
                            step nobody has touched.
     fwd_not_received       the same, restricted to steps a previous person actually forwarded - so
                            the handover happened and the next person has not accepted it. The gap
                            between this and the one above is first steps that were never started:
                            Challan Processing currently shows 13 awaiting and 0 forwarded, meaning
                            all thirteen are sitting at the very beginning.
     in_hand_not_forwarded  received, and not moved on. Somebody has it and is holding it.
     raised_yesterday       instances created yesterday.
     closed_yesterday       instances that reached Done yesterday.
     reverted_yesterday     reverts AND send-backs logged yesterday. Both are the work going
                            backwards, which is the thing worth watching; the UI labels it as both.

   Only live instances count towards the three snapshot numbers - Done and Cancelled are excluded,
   or every completed instance would be counted forever as "not forwarded".

   Same access gate as the rest of the Usability report, for the same reason: these are counts of
   named people's work. */
create or replace function public.erp_usability_workflow_health()
 returns table(flow_id bigint, workflow text,
               awaiting_receipt bigint, fwd_not_received bigint, in_hand_not_forwarded bigint,
               raised_yesterday bigint, closed_yesterday bigint, reverted_yesterday bigint,
               live_instances bigint)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_yday date := ((now() at time zone 'Asia/Kolkata')::date - 1);
begin
  if not (app.is_superadmin()
          or exists(select 1 from adm.users u
                     where u.email = app.current_user_email()
                       and u.active
                       and 'usability' = any(coalesce(u.modules,'{}')))) then
    raise exception 'Usability is limited to the Systems department';
  end if;

  return query
  with live as (
    select f.id,
      count(distinct c.id) as live_instances,
      count(*) filter (where s.seq = c.current_step
                         and s.appeared_at is not null
                         and s.received_at is null
                         and s.forwarded_at is null)                           as awaiting_receipt,
      count(*) filter (where s.seq = c.current_step
                         and s.appeared_at is not null
                         and s.received_at is null
                         and s.forwarded_at is null
                         and exists (select 1 from acc.flow_case_steps p
                                      where p.case_id = c.id and p.seq < s.seq
                                        and p.forwarded_at is not null))       as fwd_not_received,
      count(*) filter (where s.seq = c.current_step
                         and s.received_at is not null
                         and s.forwarded_at is null)                           as in_hand_not_forwarded
      from acc.flows f
      left join acc.flow_cases c on c.flow_id = f.id and c.status not in ('Done','Cancelled')
      left join acc.flow_case_steps s on s.case_id = c.id
     group by f.id
  ),
  moved as (
    select f.id,
      count(*) filter (where (c.created_at at time zone 'Asia/Kolkata')::date = v_yday) as raised_yesterday,
      count(*) filter (where c.status = 'Done'
                         and (c.updated_at at time zone 'Asia/Kolkata')::date = v_yday) as closed_yesterday
      from acc.flows f
      left join acc.flow_cases c on c.flow_id = f.id
     group by f.id
  ),
  rev as (
    select e.meta ->> 'workflow' as wf, count(*) as n
      from public.erp_usage_events e
     where e.feature_key in ('tasks.workflow.revert_a_forwarded_step',
                             'tasks.workflow.reject_send_a_step_back')
       and (e.occurred_at at time zone 'Asia/Kolkata')::date = v_yday
       and e.meta ->> 'workflow' is not null
     group by 1
  )
  select f.id, f.name,
         coalesce(l.awaiting_receipt,0), coalesce(l.fwd_not_received,0),
         coalesce(l.in_hand_not_forwarded,0),
         coalesce(m.raised_yesterday,0), coalesce(m.closed_yesterday,0),
         coalesce(r.n,0), coalesce(l.live_instances,0)
    from acc.flows f
    left join live  l on l.id = f.id
    left join moved m on m.id = f.id
    left join rev   r on r.wf = f.name
   order by coalesce(l.awaiting_receipt,0) + coalesce(l.in_hand_not_forwarded,0) desc, f.name;
end;
$function$;
