-- Notify whoever forwarded a step once the new assignee receives it.
-- The forwarder's email is already recorded as acc.ptasks.delegator on the
-- task created for the receiving step (set by acc.wf_forward), so we just
-- look it up and fire a 'received' email via workflow-mailer.
--
-- Note: v_has_prev captures FOUND right after the `prev` lookup, since the
-- following `update acc.ptasks ...` would otherwise overwrite FOUND before
-- the notification check runs.
create or replace function acc.wf_receive(p_fcs_id bigint)
 returns void
 language plpgsql
 security definer
 set search_path to 'acc', 'public'
as $function$
declare v_email text := app.current_user_email(); v acc.flow_case_steps; prev acc.flow_case_steps;
        v_allowed boolean; v_has_prev boolean; v_forwarder text;
begin
  if v_email is null then raise exception 'not signed in'; end if;
  select * into v from acc.flow_case_steps where id=p_fcs_id;
  if not found then raise exception 'step not found'; end if;

  v_allowed := acc.wf_may_act_as(v.person, v_email, (select flow_id from acc.flow_cases where id=v.case_id))
            or (v.person is null and lower(v_email) = any(select lower(x) from unnest(coalesce(v.candidates,'{}')) x));
  if not v_allowed then
    if v.person is not null and lower(v.person) <> lower(v_email) then
      raise exception 'This step has already been taken by %', v.person;
    end if;
    raise exception 'not your step';
  end if;

  -- Claim it. The `person is null` guard makes two people pressing Receive at the same moment
  -- safe: the second update matches no row, and the check below reports who won.
  if v.person is null then
    update acc.flow_case_steps
       set person=v_email, claimed_by=v_email, received_at=coalesce(received_at, now()), status='received'
     where id=p_fcs_id and person is null;
    if not found then
      select * into v from acc.flow_case_steps where id=p_fcs_id;
      raise exception 'This step was just taken by %', coalesce(v.person,'someone else');
    end if;
    -- take everyone else off the task
    if v.task_id is not null then
      delete from acc.ptask_assignees where task_id=v.task_id and lower(email) <> lower(v_email);
      delete from acc.task_rank      where task_id=v.task_id and lower(viewer_email) <> lower(v_email);
    end if;
  else
    update acc.flow_case_steps set received_at=coalesce(received_at, now()), status='received' where id=p_fcs_id;
  end if;

  -- receiving confirms the previous person's forwarded step -> their task becomes Completed
  select * into prev from acc.flow_case_steps where case_id=v.case_id and seq<v.seq order by seq desc limit 1;
  v_has_prev := found;
  if v_has_prev and prev.task_id is not null then
    update acc.ptasks set approval_state='approved', status='Completed', progress=100,
           approved_at=coalesce(approved_at, now()), completed_at=coalesce(completed_at, now()), approved_by=v_email
      where id=prev.task_id and approval_state='awaiting_approval';
  end if;

  -- let whoever forwarded this step know it has now been received (only makes
  -- sense when there was a previous step, i.e. this step arrived via forward)
  if v_has_prev and v.task_id is not null then
    select p.delegator into v_forwarder from acc.ptasks p where p.id=v.task_id;
    if v_forwarder is not null and lower(v_forwarder) <> lower(v_email) then
      perform net.http_post(
        url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/workflow-mailer',
        headers := '{"Content-Type":"application/json","apikey":"sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n"}'::jsonb,
        body := jsonb_build_object('type','received','task_id',v.task_id,'email',v_forwarder,'received_by',v_email),
        timeout_milliseconds := 15000);
    end if;
  end if;
end; $function$;
