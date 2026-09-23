-- acc.wf_reject(fcs_id, reason) sends a whole instance back to whoever has to correct it
-- (Reimbursement, and any other flow with reject_deletes_instance and no reject_to_seq) by
-- winding flow_case_steps back to the first step and deleting every task on the case. But it
-- never re-armed that first step, so nothing was ever created to make it "live" again: task_id
-- and appeared_at stayed null, and the task list (tasks/work) is driven entirely by
-- ptasks/ptask_assignees. The instance correctly showed current_step back at step 1, but nobody
-- ever saw a task for it. wf_arm_first_step is the same function new instances use to create
-- their first task — call it here too, once the case is pointed back at its first step.
create or replace function acc.wf_reject(p_fcs_id bigint, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_email text := app.current_user_email();
        v acc.flow_case_steps; v_case acc.flow_cases; v_flow acc.flows;
        v_allowed boolean; v_first int;
        tgt acc.flow_case_steps; v_to text[]; c text; v_back_to_step boolean := false;
begin
  select * into v from acc.flow_case_steps where id=p_fcs_id;
  if not found then raise exception 'step not found'; end if;

  v_allowed := acc.wf_may_act_as(v.person, v_email, (select flow_id from acc.flow_cases where id=v.case_id))
            or (v.person is null and lower(coalesce(v_email,'')) = any(
                  select lower(x) from unnest(coalesce(v.candidates,'{}')) x));
  if not v_allowed then raise exception 'not your step'; end if;
  if v.forwarded_at is not null then raise exception 'this step is already completed'; end if;

  select * into v_case from acc.flow_cases where id=v.case_id;
  select * into v_flow from acc.flows  where id=v_case.flow_id;
  select min(seq) into v_first from acc.flow_case_steps where case_id=v.case_id;

  -- Who has to correct it. A flow can name a step to bounce back to; only useful when there is
  -- genuinely a step behind this one.
  if v_flow.reject_to_seq is not null and v.seq > v_flow.reject_to_seq then
    select * into tgt from acc.flow_case_steps where case_id=v.case_id and seq=v_flow.reject_to_seq;
    if found then
      v_to := coalesce(nullif(tgt.candidates,'{}'),
                       case when coalesce(tgt.person,'')<>'' then array[tgt.person] end, '{}'::text[]);
      v_back_to_step := coalesce(array_length(v_to,1),0) > 0;
    end if;
  end if;
  if not v_back_to_step then
    v_to := case when coalesce(v_case.created_by,'')<>'' then array[v_case.created_by] else '{}'::text[] end;
  end if;

  -- Every task on this instance goes. Nobody should be able to act on it while it is sitting with
  -- the person who has to correct it - that is what "stopped" means here.
  delete from acc.ptask_assignees where task_id in (select task_id from acc.flow_case_steps where case_id=v.case_id and task_id is not null);
  delete from acc.task_rank      where task_id in (select task_id from acc.flow_case_steps where case_id=v.case_id and task_id is not null);
  delete from acc.ptasks         where id      in (select task_id from acc.flow_case_steps where case_id=v.case_id and task_id is not null);

  -- Wound right back to the start, and a shared step releases whoever had claimed it so it is open
  -- again to all its candidates when the instance restarts.
  update acc.flow_case_steps
     set task_id=null, received_at=null, forwarded_at=null, appeared_at=null, due_at=null,
         status='pending', overdue=false,
         person     = case when coalesce(array_length(candidates,1),0)>1 then null else person end,
         claimed_by = case when coalesce(array_length(candidates,1),0)>1 then null else claimed_by end
   where case_id=v.case_id;

  update acc.flow_cases
     set current_step   = v_first,
         status         = 'Pending',
         returned_at    = now(),
         returned_reason= nullif(btrim(coalesce(p_reason,'')),''),
         returned_by    = v_email,
         returned_step  = coalesce(v.title,'a step'),
         returned_to    = nullif(array_to_string(v_to, ', '), ''),
         updated_at     = now()
   where id = v.case_id;

  -- Without this, the reset above leaves task_id/appeared_at null on every step: the case points
  -- back at its first step but nothing is actually live, so it never appears in anyone's task list.
  perform acc.wf_arm_first_step(v.case_id);

  insert into acc.flow_updates(case_id, author, body, system)
  values (v.case_id, v_email,
          'rejected "'||coalesce(v.title,'this step')||'" and sent the whole '
          ||coalesce(v_flow.instance_noun,'instance')||' back to '
          ||coalesce(nullif(array_to_string(v_to,', '),''),'whoever raised it')||' to correct'
          ||case when coalesce(btrim(p_reason),'')<>'' then ' — reason: '||btrim(p_reason) else '' end,
          true);

  -- Only the people who have to act on it are written to. Telling everyone the instance touched, as
  -- the deleting version did, was noise: none of them can do anything until it comes back round.
  foreach c in array coalesce(v_to,'{}'::text[]) loop
    if coalesce(c,'') <> '' then
      perform net.http_post(
        url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/workflow-mailer',
        headers := '{"Content-Type":"application/json","apikey":"sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n"}'::jsonb,
        body := jsonb_build_object(
          'type','reject_returned',
          'email', c,
          'workflow', coalesce(v_flow.name,'Workflow'),
          'step', coalesce(v.title,'a step'),
          'by', v_email,
          'reason', coalesce(btrim(p_reason),''),
          'case_id', v.case_id,
          'case_no', coalesce(v_case.case_no::text,''),
          'noun', coalesce(v_flow.instance_noun,'instance'),
          'raised_by', coalesce(v_case.created_by,''),
          'details', coalesce(v_case.trigger_details,'[]'::jsonb)),
        timeout_milliseconds := 15000);

      insert into acc.notifications(recipient,kind,title,body)
      values (c,'task_delegated',
              'Sent back to you: '||coalesce(v_flow.instance_noun,'instance')||' '||coalesce(v_case.case_no::text,''),
              coalesce(v_email,'Someone')||' rejected "'||coalesce(v.title,'a step')||'". Edit it to send it on again.');
    end if;
  end loop;
end; $function$;
