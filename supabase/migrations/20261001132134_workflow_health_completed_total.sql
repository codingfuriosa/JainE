/* Workflow health gains a lifetime completion count: how many instances of each workflow have
   actually finished.

   WHY IT IS WORTH A COLUMN OF ITS OWN.
   The table already has "Closed", which counts yesterday. That answers "did anything move
   yesterday" and nothing more — on a day when nobody finished anything it reads 0 for every
   workflow, which looks identical whether the workflow has completed a thousand instances or has
   never completed one. The lifetime figure separates those two cases, and they are not close:
   Reimbursement has finished 70 of the 86 it has ever raised, while Invoice Processing has
   finished 8 of 264.

   total_ever comes back alongside it so the UI can say "8 of 264" instead of a bare 8. A
   completion count without the denominator invites the reader to assume the rest are in flight,
   when for some workflows most of them are stuck.

   Cancelled instances count in total_ever but not in completed, because they were raised and are
   not coming back — folding them into the denominator is the honest reading of "how much of what
   we started has finished".

   The return row gains two columns, which create-or-replace cannot do in place. */
drop function if exists public.erp_usability_workflow_health();

create function public.erp_usability_workflow_health()
 returns table(flow_id bigint, workflow text,
               awaiting_receipt bigint, fwd_not_received bigint, in_hand_not_forwarded bigint,
               raised_yesterday bigint, closed_yesterday bigint, reverted_yesterday bigint,
               live_instances bigint, completed_total bigint, total_ever bigint)
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
                         and (c.updated_at at time zone 'Asia/Kolkata')::date = v_yday) as closed_yesterday,
      count(*) filter (where c.status = 'Done')                                         as completed_total,
      count(c.id)                                                                       as total_ever
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
         coalesce(r.n,0), coalesce(l.live_instances,0),
         coalesce(m.completed_total,0), coalesce(m.total_ever,0)
    from acc.flows f
    left join live  l on l.id = f.id
    left join moved m on m.id = f.id
    left join rev   r on r.wf = f.name
   order by coalesce(l.awaiting_receipt,0) + coalesce(l.in_hand_not_forwarded,0) desc, f.name;
end;
$function$;
