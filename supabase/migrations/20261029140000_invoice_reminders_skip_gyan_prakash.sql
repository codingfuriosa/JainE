/* INVOICE PROCESSING: NO REMINDER EMAILS TO GYAN PRAKASH SAH (cfo@thejaingroup.com).

   Two scheduled mailers send the workflow reminders, and each asks the database who to write to:
     - receive-reminder-mailer (daily 06:00 UTC): "please receive" on a step nobody has received for
       12 hours, repeated every 24 - public.receive_reminder_batch()
     - overdue-mailer (daily 03:30 UTC): "due today" / "overdue" on a workflow step's task -
       public.due_email_batch()
   Both now leave a person out of the reminders for a workflow they have asked not to be reminded
   about. It is a row in acc.flow_reminder_optout, not a name written into the functions, so the next
   person (or this one, for another workflow) is one insert away, and putting him back is one delete.

   WHAT IT CHANGES, AND WHAT IT DOES NOT
     - only the REMINDER emails, only for the flows and people listed, only Invoice Processing (26)
       for Gyan Prakash Sah today. His other workflows' reminders, everybody else's reminders, and the
       emails that tell him a bill has been forwarded to him (workflow-mailer) are untouched.
     - the steps and tasks themselves are not touched: he is still assigned, still sees them in his
       Tasks and in Bulk Actions, and the bill still goes overdue on the same clock.
     - a step/task whose only recipient was the person left out is dropped from the batch, so
       nothing is sent for it and nothing is marked as sent. */

create table if not exists acc.flow_reminder_optout (
  flow_id    bigint not null,
  email      text   not null,
  added_by   text,
  added_at   timestamptz not null default now(),
  primary key (flow_id, email)
);
alter table acc.flow_reminder_optout enable row level security;      -- read by the mailers' definer functions only

insert into acc.flow_reminder_optout(flow_id, email, added_by)
values (26, 'cfo@thejaingroup.com', 'businessanalyst@thejaingroup.com')
on conflict do nothing;

-- the same functions as before, with the people who opted out of this workflow's reminders left out
create or replace function public.receive_reminder_batch()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'acc', 'public'
as $function$
declare res jsonb;
begin
  select coalesce(jsonb_agg(x),'[]'::jsonb) into res from (
    select jsonb_build_object(
      'fcs_id', fcs.id,
      'task_id', fcs.task_id,
      'step_title', fcs.title,
      'case_id', fcs.case_id,
      'case_no', fc.case_no,
      'workflow_name', fl.name,
      'appeared_at', fcs.appeared_at,
      'members', (select coalesce(jsonb_agg(a.email),'[]'::jsonb) from acc.ptask_assignees a
                   where a.task_id = fcs.task_id
                     and not exists (select 1 from acc.flow_reminder_optout o
                                      where o.flow_id = fc.flow_id and lower(o.email) = lower(a.email)))
    ) as x
    from acc.flow_case_steps fcs
    left join acc.flow_cases fc on fc.id = fcs.case_id
    left join acc.flows fl on fl.id = fc.flow_id
    where fcs.received_at is null
      and fcs.forwarded_at is null
      and fcs.task_id is not null
      and fcs.appeared_at is not null
      and fcs.appeared_at <= now() - interval '12 hours'
      and (fcs.receive_reminder_sent_at is null or fcs.receive_reminder_sent_at <= now() - interval '24 hours')
      and exists (select 1 from acc.ptask_assignees a where a.task_id = fcs.task_id
                   and not exists (select 1 from acc.flow_reminder_optout o
                                    where o.flow_id = fc.flow_id and lower(o.email) = lower(a.email)))
  ) q;
  return res;
end $function$;

create or replace function public.due_email_batch()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'acc', 'public'
as $function$
declare res jsonb;
begin
  select coalesce(jsonb_agg(x),'[]'::jsonb) into res from (
    select jsonb_build_object(
      'id', p.id, 'title', p.title, 'due_date', p.due_date,
      'kind', case when p.due_date < current_date then 'overdue' else 'due' end,
      'overdue', (p.due_date < current_date),
      'members', (select coalesce(jsonb_agg(a.email),'[]'::jsonb) from acc.ptask_assignees a
                   where a.task_id=p.id
                     and not exists (select 1 from acc.flow_case_steps s2 join acc.flow_cases c2 on c2.id = s2.case_id
                                      join acc.flow_reminder_optout o on o.flow_id = c2.flow_id and lower(o.email) = lower(a.email)
                                      where s2.id = p.flow_case_step_id))
    ) as x
    from acc.ptasks p
    where p.approval_state <> 'approved' and p.due_date is not null
      and ( (p.due_date = current_date and coalesce(p.due_emailed,false) = false)
         or (p.due_date <  current_date and coalesce(p.overdue_emailed,false) = false) )
      and not exists (select 1 from acc.flow_case_steps fcs where fcs.id = p.flow_case_step_id and fcs.forwarded_at is not null)
      -- a workflow task whose only assignee opted out has nobody left to remind
      and (p.flow_case_step_id is null
           or exists (select 1 from acc.ptask_assignees a where a.task_id = p.id
                       and not exists (select 1 from acc.flow_case_steps s2 join acc.flow_cases c2 on c2.id = s2.case_id
                                        join acc.flow_reminder_optout o on o.flow_id = c2.flow_id and lower(o.email) = lower(a.email)
                                        where s2.id = p.flow_case_step_id)))
    union all
    select jsonb_build_object(
      'id', p.id, 'title', p.title, 'due_date', p.due_date,
      'kind', 'recur_missed', 'overdue', true,
      'next_date', acc.recur_missed_date(p),
      'members', (select coalesce(jsonb_agg(a.email),'[]'::jsonb) from acc.ptask_assignees a where a.task_id=p.id)
    )
    from acc.ptasks p
    where p.approval_state <> 'approved' and p.due_date is not null and p.recur is not null
      and p.flow_case_step_id is null
      and acc.recur_missed_date(p) is not null
  ) q;
  return res;
end $function$;
