/* "Send back" sends the instance back to the PREVIOUS PERSON — from both buttons, not one.

   THE BUG. acc.wf_reject exists as two overloads, and they did opposite things.

     wf_reject(p_fcs_id)            — used by the inline reject bar (wfDoReject). Correct: it winds
                                      the instance back a step, clears everything downstream, hands
                                      the previous owner their task again, and emails them.
     wf_reject(p_fcs_id, p_reason)  — used by the "Send back for correction" modal
                                      (wfRejectConfirm), which is the path nearly everyone takes.
                                      It moved the instance NOWHERE: it set current_step to the
                                      rejector's own step, claimed that step to them, and wrote
                                      returned_to = the rejector's own email. The banner named the
                                      person who pressed the button, and the only one who could act
                                      on it was the one who had just said they could not.

   So the same action did two different things depending on which button you reached it from. This
   makes the reason-carrying overload do what the other one already did, and turns the one-argument
   version into a thin call through to it, so there is a single implementation from here on.

   ROUTE-AWARE PREVIOUS STEP. The old logic took "seq < mine, highest first", which is the previous
   step by NUMBER, not the previous step on this instance's PATH. Invoice Processing has 12 steps
   and branches (flow_cases.route_seqs), so those are not the same thing, and it carries 253 of the
   300 live instances. acc.wf_prev_seq() is added as the exact mirror of acc.wf_next_seq() and
   shares its fallbacks, which is what makes "send back, then forward" a round trip: from position
   n-1, wf_next_seq returns n, so the corrected instance lands on the rejector again with no step
   in between redone and no special return path to maintain.

   reject_to_seq still wins where it is set. Invoice Processing has it at 1 — "send it all the way
   to the front" — and that is deliberate, so it is checked first, exactly as before.

   FIRST STEP: UNCHANGED, and worth stating plainly because the two overloads disagreed here too.
   The one-argument version cancels the instance and emails whoever raised it; the modal version
   held it. The one-argument behaviour wins, because it is the one that has been running: rejecting
   the very first step means there is nobody to send it to and nothing to correct downstream.

   Everything else is carried over verbatim from the working overload: the rejector's task and every
   downstream task are deleted (wf_forward creates a NEW task for whatever step it advances onto,
   so leaving them would strand unreachable tasks), the previous step's own task is reopened rather
   than recreated, and every original candidate is re-assigned so a shared step returns to the whole
   group instead of only whoever claimed it.

   No schema change, no table touched. */

/* Mirror of acc.wf_next_seq(). Deliberately does NOT consult skipped_seqs, because wf_next_seq
   does not either — route_seqs is what encodes the path an instance actually takes. */
create or replace function acc.wf_prev_seq(p_case_id bigint, p_cur_seq integer)
 returns integer
 language plpgsql
 stable security definer
 set search_path to 'acc', 'public'
as $function$
declare v_route int[]; v_prev int; v_pos int;
begin
  select route_seqs into v_route from acc.flow_cases where id = p_case_id;

  if v_route is null or coalesce(array_length(v_route,1),0) = 0 then
    select max(seq) into v_prev from acc.flow_case_steps
      where case_id = p_case_id and seq < p_cur_seq;
    return v_prev;
  end if;

  select ord into v_pos from unnest(v_route) with ordinality t(seq,ord)
   where t.seq = p_cur_seq limit 1;

  -- Standing on a step that is not on this instance's route at all: behave as if there were no
  -- route, rather than stalling it.
  if v_pos is null then
    select max(seq) into v_prev from acc.flow_case_steps
      where case_id = p_case_id and seq < p_cur_seq;
    return v_prev;
  end if;

  select t.seq into v_prev from unnest(v_route) with ordinality t(seq,ord)
   where t.ord = v_pos - 1;
  return v_prev;   -- null at the start of the route: there is nobody before
end $function$;

create or replace function acc.wf_reject(p_fcs_id bigint, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_email text := app.current_user_email();
        v acc.flow_case_steps; prev acc.flow_case_steps;
        v_flow acc.flows; v_case acc.flow_cases; v_trig_owner text;
        c text; v_prev_cands text[]; v_allowed boolean;
        v_reset_from int; v_prev_seq int; v_why text;
begin
  v_why := nullif(btrim(coalesce(p_reason,'')),'');

  select * into v from acc.flow_case_steps where id=p_fcs_id;
  if not found then raise exception 'step not found'; end if;

  v_allowed := acc.wf_may_act_as(v.person, v_email, (select flow_id from acc.flow_cases where id=v.case_id))
            or (v.person is null and lower(coalesce(v_email,'')) = any(
                  select lower(x) from unnest(coalesce(v.candidates,'{}')) x));
  if not v_allowed then
    if v.person is not null and lower(v.person) <> lower(coalesce(v_email,'')) then
      raise exception 'This step has already been taken by %', v.person;
    end if;
    raise exception 'not your step';
  end if;
  if v.forwarded_at is not null then raise exception 'this step is already completed'; end if;

  select * into v_case from acc.flow_cases where id=v.case_id;
  select f.* into v_flow from acc.flows f where f.id=v_case.flow_id;

  -- A flow with reject_to_seq set means "send it all the way back to that step" and overrides the
  -- one-step rule. Otherwise: one position back along THIS instance's route.
  if v_flow.reject_to_seq is not null and v.seq > v_flow.reject_to_seq then
    select * into prev from acc.flow_case_steps where case_id=v.case_id and seq=v_flow.reject_to_seq;
  else
    v_prev_seq := acc.wf_prev_seq(v.case_id, v.seq);
    if v_prev_seq is not null then
      select * into prev from acc.flow_case_steps where case_id=v.case_id and seq=v_prev_seq;
    end if;
  end if;

  /* NOTHING BEFORE THIS STEP. Nobody to send it to and nothing downstream to correct, so the
     instance is cancelled and whoever raised it is told. */
  if prev.id is null then
    if v.task_id is not null then
      delete from acc.ptask_assignees where task_id=v.task_id;
      delete from acc.task_rank where task_id=v.task_id;
      delete from acc.ptasks where id=v.task_id;
    end if;
    update acc.flow_case_steps set task_id=null, received_at=null, forwarded_at=null, appeared_at=null, due_at=null, status='pending',
           person = case when coalesce(array_length(candidates,1),0)>1 then null else person end,
           claimed_by = case when coalesce(array_length(candidates,1),0)>1 then null else claimed_by end
     where id=v.id;
    update acc.flow_cases set status='Cancelled', returned_reason=v_why, returned_by=v_email,
           returned_step=coalesce(v.title,'the first step'), updated_at=now() where id=v.case_id;
    insert into acc.flow_updates(case_id, author, body, system)
      values(v.case_id, v_email, 'rejected the first step — this instance was cancelled'
             ||case when v_why is not null then ' — reason: '||v_why else '' end, true);

    if coalesce(v_case.created_by,'') <> '' and lower(v_case.created_by) <> lower(coalesce(v_email,'')) then
      perform net.http_post(
        url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/workflow-mailer',
        headers := '{"Content-Type":"application/json","apikey":"sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n"}'::jsonb,
        body := jsonb_build_object(
          'type','reject_deleted',
          'email', v_case.created_by,
          'workflow', coalesce(v_flow.name,'Workflow'),
          'step', coalesce(v.title,'the first step'),
          'by', v_email,
          'reason', coalesce(v_why,''),
          'noun', coalesce(v_flow.instance_noun,'instance'),
          'case_no', coalesce(v_case.case_no::text,''),
          'details', coalesce(v_case.trigger_details,'[]'::jsonb)),
        timeout_milliseconds := 15000);
      insert into acc.notifications(recipient,kind,title,body)
      values (v_case.created_by,'task_delegated',
              'Cancelled: '||coalesce(v_flow.instance_noun,'instance')||' '||coalesce(v_case.case_no::text,''),
              coalesce(v_email,'Someone')||' rejected "'||coalesce(v.title,'the first step')||'", which cancelled this '
              ||coalesce(v_flow.instance_noun,'instance')||'.'
              ||case when v_why is not null then ' Reason: '||v_why else '' end
              ||' Raise a new one if it still needs doing.');
    end if;
    return;
  end if;

  /* ---- BACK TO THE PREVIOUS PERSON ---- */
  v_reset_from := prev.seq;

  if v.task_id is not null then
    delete from acc.ptask_assignees where task_id=v.task_id;
    delete from acc.task_rank where task_id=v.task_id;
    delete from acc.ptasks where id=v.task_id;
  end if;
  update acc.flow_case_steps set task_id=null, received_at=null, forwarded_at=null, appeared_at=null, due_at=null, status='pending',
         person = case when coalesce(array_length(candidates,1),0)>1 then null else person end,
         claimed_by = case when coalesce(array_length(candidates,1),0)>1 then null else claimed_by end
   where id=v.id;

  -- everything after the step it is going back to is cleared, so the corrected work walks forward
  -- through a clean slate rather than meeting half-finished tasks from the first attempt
  delete from acc.ptask_assignees where task_id in (select task_id from acc.flow_case_steps where case_id=v.case_id and seq>v_reset_from and task_id is not null);
  delete from acc.task_rank where task_id in (select task_id from acc.flow_case_steps where case_id=v.case_id and seq>v_reset_from and task_id is not null);
  delete from acc.ptasks where id in (select task_id from acc.flow_case_steps where case_id=v.case_id and seq>v_reset_from and task_id is not null);
  update acc.flow_case_steps set task_id=null, received_at=null, forwarded_at=null, appeared_at=null, due_at=null, status='pending',
         person = case when coalesce(array_length(candidates,1),0)>1 then null else person end,
         claimed_by = case when coalesce(array_length(candidates,1),0)>1 then null else claimed_by end
    where case_id=v.case_id and seq>v_reset_from;

  v_prev_cands := coalesce(nullif(prev.candidates,'{}'),
                           case when coalesce(prev.person,'')<>'' then array[prev.person] end, '{}'::text[]);
  update acc.flow_case_steps set forwarded_at=null, received_at=null, status='pending', appeared_at=now(),
         person = case when coalesce(array_length(candidates,1),0)>1 then null else person end,
         claimed_by = case when coalesce(array_length(candidates,1),0)>1 then null else claimed_by end
   where id=prev.id;
  if prev.task_id is not null then
    update acc.ptasks set status='Pending', approval_state='open', progress=0, approved_at=null, completed_at=null, approved_by=null where id=prev.task_id;
    foreach c in array v_prev_cands loop
      insert into acc.ptask_assignees(task_id, email) values(prev.task_id, c) on conflict do nothing;
      insert into acc.task_rank(task_id, viewer_email, rank)
        values(prev.task_id, c, coalesce((select max(rank) from acc.task_rank where lower(viewer_email)=lower(c)),0)+1)
        on conflict (task_id, viewer_email) do update set rank=excluded.rank;
    end loop;
  end if;

  /* returned_* is what the "Sent back for correction" banner reads. It now names the people it
     actually went to, which is the whole point — it used to name the rejector. */
  update acc.flow_cases
     set current_step   = prev.seq,
         status         = 'Pending',
         returned_at    = now(),
         returned_reason= v_why,
         returned_by    = v_email,
         returned_step  = coalesce(v.title,'a step'),
         returned_to    = nullif(array_to_string(v_prev_cands, ','),''),
         updated_at     = now()
   where id=v.case_id;

  insert into acc.flow_updates(case_id, author, body, system)
    values(v.case_id, v_email,
      case when v_flow.reject_to_seq is not null and v.seq > v_flow.reject_to_seq
        then 'rejected "'||coalesce(v.title,'this step')||'" and sent it all the way back to "'||coalesce(prev.title,'the first step')||'"'
        else 'rejected "'||coalesce(v.title,'this step')||'" and sent it back to the previous person' end
      ||case when v_why is not null then ' — reason: '||v_why else '' end,
      true);

  v_trig_owner := acc.wf_case_trigger_owner(v.case_id);
  foreach c in array v_prev_cands loop
    if v_trig_owner is null or lower(v_trig_owner)<>lower(c) then
      perform net.http_post(
        url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/workflow-mailer',
        headers := '{"Content-Type":"application/json","apikey":"sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n"}'::jsonb,
        body := jsonb_build_object('type','reject','email',c,'workflow',coalesce(v_flow.name,'Workflow'),
                                   'step',prev.title,'by',v_email,'reason',coalesce(v_why,'')),
        timeout_milliseconds := 15000);
      if prev.task_id is not null then
        insert into acc.notifications(recipient,kind,task_id,title,body)
        values (c,'task_delegated',prev.task_id,
                'Rejected back to you: '||coalesce(v_flow.name,'Workflow'),
                coalesce(v_email,'Someone')||' rejected "'||coalesce(v.title,'a step')||'" back to you.'
                ||case when v_why is not null then ' Reason: '||v_why else '' end);
      end if;
    end if;
  end loop;
end; $function$;

/* One implementation from here on: the no-reason button is the same action without a reason. */
create or replace function acc.wf_reject(p_fcs_id bigint)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform acc.wf_reject(p_fcs_id, null::text);
end; $function$;
