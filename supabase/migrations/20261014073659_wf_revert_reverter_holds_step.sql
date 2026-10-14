-- REVERT: the step goes back to whoever pulled it back, and only to them - already received,
-- ready to forward again, with the task on their list alone. Supersedes the shared-step behaviour
-- of 20261014073329 (which put a reverted shared step back to waiting for any of its people).

CREATE OR REPLACE FUNCTION acc.wf_revert(p_fcs_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_email text := lower(app.current_user_email()); v acc.flow_case_steps; act_person text;
        v_flow acc.flows; v_trig_owner text;
begin
  select * into v from acc.flow_case_steps where id=p_fcs_id;
  if not found then raise exception 'step not found'; end if;
  if not acc.wf_may_act_as(v.person, v_email, (select flow_id from acc.flow_cases where id=v.case_id)) then raise exception 'not your step'; end if;
  if v.forwarded_at is null then raise exception 'this step has not been forwarded yet'; end if;
  if (select status from acc.flow_cases where id=v.case_id)='Done' then raise exception 'this instance is complete — reopen the final step instead'; end if;
  -- the person whose in-progress downstream task is being pulled back, for the "Task Reverted" email
  select person into act_person from acc.flow_case_steps
    where case_id=v.case_id and seq = any(acc.wf_after_in_route(v.case_id, v.seq)) and task_id is not null and forwarded_at is null order by seq limit 1;
  delete from acc.ptask_assignees where task_id in (select task_id from acc.flow_case_steps where case_id=v.case_id and seq = any(acc.wf_after_in_route(v.case_id, v.seq)) and task_id is not null);
  delete from acc.task_rank where task_id in (select task_id from acc.flow_case_steps where case_id=v.case_id and seq = any(acc.wf_after_in_route(v.case_id, v.seq)) and task_id is not null);
  delete from acc.ptasks where id in (select task_id from acc.flow_case_steps where case_id=v.case_id and seq = any(acc.wf_after_in_route(v.case_id, v.seq)) and task_id is not null);
  -- steps pulled back must not keep an old claim either, or they stay locked to one person
  update acc.flow_case_steps set task_id=null, received_at=null, forwarded_at=null, appeared_at=null, due_at=null, status='pending',
         person = case when coalesce(array_length(candidates,1),0)>1 then null else person end,
         claimed_by = case when coalesce(array_length(candidates,1),0)>1 then null else claimed_by end
    where case_id=v.case_id and seq = any(acc.wf_after_in_route(v.case_id, v.seq));

  /* THE STEP GOES BACK TO WHOEVER PULLED IT BACK - and only to them, already received, ready to
     forward again. Their task is reopened; nobody else who could have taken the step gets it. (It
     used to fan the task back out to every candidate while marking the step received with nobody
     on it, which left a step nobody could forward - "not your step".) */
  if v.task_id is not null then
    update acc.ptasks set status='Pending', approval_state='open', progress=0, approved_at=null, completed_at=null, approved_by=null where id=v.task_id;
    delete from acc.ptask_assignees where task_id=v.task_id and lower(email)<>v_email;
    delete from acc.task_rank      where task_id=v.task_id and lower(viewer_email)<>v_email;
    insert into acc.ptask_assignees(task_id, email) values(v.task_id, v_email) on conflict do nothing;
    insert into acc.task_rank(task_id, viewer_email, rank)
      values(v.task_id, v_email, coalesce((select max(rank) from acc.task_rank where lower(viewer_email)=v_email),0)+1)
      on conflict (task_id, viewer_email) do update set rank=excluded.rank;
  end if;
  update acc.flow_case_steps set forwarded_at=null, received_at=now(), status='received', appeared_at=now(),
         person=v_email, claimed_by=v_email
    where id=v.id;
  update acc.flow_cases set current_step=v.seq, status='Pending', updated_at=now() where id=v.case_id;
  insert into acc.flow_updates(case_id, author, body, system)
    values(v.case_id, v_email, 'reverted "'||coalesce(v.title,'this step')||'" and pulled it back', true);
  v_trig_owner := acc.wf_case_trigger_owner(v.case_id);
  if act_person is not null and lower(act_person)<>v_email and (v_trig_owner is null or lower(v_trig_owner)<>lower(act_person)) then
    select f.* into v_flow from acc.flows f join acc.flow_cases c2 on c2.flow_id=f.id where c2.id=v.case_id;
    perform net.http_post(
      url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/workflow-mailer',
      headers := '{"Content-Type":"application/json","apikey":"sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n"}'::jsonb,
      body := jsonb_build_object('type','revert','email',act_person,'workflow',coalesce(v_flow.name,'Workflow'),'step',v.title,'by',v_email),
      timeout_milliseconds := 15000);
  end if;
end; $function$;
