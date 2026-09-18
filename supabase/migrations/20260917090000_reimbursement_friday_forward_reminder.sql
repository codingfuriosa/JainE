/* Friday morning: tell Accounts what is sitting with them, waiting to be forwarded.

   WHY THIS IS NOT THE EXISTING receive-reminder-mailer.
   That job chases the OTHER end of the same step: something forwarded to you that you have not
   opened yet, every 12 hours, at whoever it landed on. This one starts where that one stops -
   already received, worked on or not, and still not moved along. They must not be merged: a claim
   somebody opened this morning and is actively working is a perfectly good state, and nagging
   about it daily is how a reminder gets filtered into a folder nobody reads. Hence weekly, and to
   one person rather than to everybody holding something.

   WHO IT GOES TO IS THE SCHEDULE'S BUSINESS, NOT THE FUNCTION'S.
   The recipient rides in the cron body. Moving it to somebody else, or adding a second recipient,
   is an edit to the schedule below and not a redeploy of the edge function.

   The edge function lives at supabase/functions/reimbursement-forward-reminder/index.ts and is
   deployed separately; ?dry=1 renders the mail and returns it without sending, which is how it was
   checked without putting a test message in a real inbox. */

-- ---------------------------------------------------------------------------------------------
-- What one person is sitting on. Received AND not forwarded - appeared-but-never-opened is the
-- receive reminder's business, and a step that shows up in both would be nagged about twice with
-- two different instructions.
-- ---------------------------------------------------------------------------------------------
create or replace function public.reimbursement_forward_batch(p_email text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'acc', 'public'
as $function$
declare res jsonb;
begin
  if p_email is null or btrim(p_email) = '' then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(x order by (x->>'received_at')), '[]'::jsonb) into res
  from (
    select jsonb_build_object(
      'fcs_id',      fcs.id,
      'task_id',     fcs.task_id,
      'case_no',     fc.case_no,
      'step_title',  fcs.title,
      'received_at', fcs.received_at,
      'due_at',      fcs.due_at,
      'overdue',     (fcs.due_at is not null and fcs.due_at < now()),
      'days_held',   greatest(0, (now()::date - fcs.received_at::date)),
      'raised_by',   coalesce(nullif(btrim(u.full_name),''), fc.created_by)
    ) as x, fcs.received_at
      from acc.flow_case_steps fcs
      join acc.flow_cases fc on fc.id = fcs.case_id
      join acc.flows      fl on fl.id = fc.flow_id
      left join adm.users  u on lower(u.email) = lower(fc.created_by)
     where fl.id = 39
       and fcs.received_at  is not null
       and fcs.forwarded_at is null
       and coalesce(fc.status,'') not in ('Done','Cancelled')
       /* person: claimed by one. claimed_by: the same, recorded separately. candidates: a step
          offered to a group, which Accounts Review & Payment is (cfo@ and sm.accounts@ both). */
       and (lower(coalesce(fcs.person,''))     = lower(p_email)
            or lower(coalesce(fcs.claimed_by,'')) = lower(p_email)
            or lower(p_email) = any(select lower(y) from unnest(coalesce(fcs.candidates,'{}')) y))
  ) q;
  return res;
end
$function$;

/* Only the mailer reads this, and it reads it as the service role. Left executable by anon or a
   signed-in user it would hand anybody a list of who is sitting on whose money. */
revoke all on function public.reimbursement_forward_batch(text) from public, anon, authenticated;
grant execute on function public.reimbursement_forward_batch(text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Friday 09:00 IST. pg_cron runs on a UTC server, so 03:30 UTC - the same morning slot the
-- existing daily mailers already use, rather than a second one to reason about.
-- ---------------------------------------------------------------------------------------------
select cron.unschedule('reimbursement-forward-reminder-friday')
 where exists (select 1 from cron.job where jobname = 'reimbursement-forward-reminder-friday');

select cron.schedule(
  'reimbursement-forward-reminder-friday',
  '30 3 * * 5',
  $$
  select net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/reimbursement-forward-reminder',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n"}'::jsonb,
    body := '{"to":"cfo@thejaingroup.com"}'::jsonb
  );
  $$
);
