-- New feature: nudge the current assignee of a forwarded-but-unreceived
-- workflow step every 12 hours until they click "Receive" (acc.wf_receive).
-- Mirrors the existing due_email_batch/mark_task_emailed pattern used by
-- overdue-mailer, but keyed off flow_case_steps.received_at instead of
-- ptasks due dates.

alter table acc.flow_case_steps
  add column if not exists receive_reminder_sent_at timestamptz;

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
      'members', (select coalesce(jsonb_agg(a.email),'[]'::jsonb) from acc.ptask_assignees a where a.task_id = fcs.task_id)
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
      and exists (select 1 from acc.ptask_assignees a where a.task_id = fcs.task_id)
  ) q;
  return res;
end $function$;

create or replace function public.mark_receive_reminder_sent(p_fcs_id bigint)
 returns void
 language sql
 security definer
 set search_path to 'acc', 'public'
as $function$
  update acc.flow_case_steps set receive_reminder_sent_at = now() where id = p_fcs_id;
$function$;

-- Runs once daily at 06:00 UTC = 11:30 IST, digesting anyone with a
-- forwarded step still unreceived 12h+ after it appeared.
select cron.schedule(
  'receive-reminder-mailer-daily',
  '0 6 * * *',
  $cron$
  select net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/receive-reminder-mailer',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);
