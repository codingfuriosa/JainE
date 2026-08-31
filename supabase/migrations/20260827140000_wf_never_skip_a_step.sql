/* A workflow instance's steps are a SNAPSHOT taken when it is raised. Add a step to the workflow
   afterwards and every instance already running is missing that row - so "is there a next step?",
   asked of the snapshot, answers no, and forwarding the last step it knows about closes the whole
   instance instead of handing it on.

   Reimbursement #8 went exactly that way: Accounts pressed Forward, the claim had no row for the
   new Payment Received step, and it closed without ever reaching the claimant. Eleven claims were
   in that state. Nothing about it was visible from the outside - the claim simply looked finished.

   The DEFINITION is the authority on what steps exist. wf_materialise_steps fills in whatever an
   instance is missing, and both wf_forward and wf_done now call it before deciding what comes
   next, so a step added mid-flight reaches the instances already in motion.

   wf_done additionally hands over rather than closing when a step does follow. Otherwise which
   button the holder happens to be shown decides whether the rest of the workflow runs at all, and
   a stale browser tab is enough to skip it. */

create or replace function acc.wf_materialise_steps(p_case_id bigint)
 returns integer language plpgsql security definer set search_path to 'acc','public'
as $function$
declare v_flow bigint; v_creator text; v_added integer;
begin
  select flow_id, created_by into v_flow, v_creator from acc.flow_cases where id=p_case_id;
  if v_flow is null then return 0; end if;

  insert into acc.flow_case_steps(case_id, step_id, seq, title, person, candidates,
                                  duration_value, duration_unit, description, status)
  select p_case_id, st.id, st.seq, st.title,
         case when array_length(cand.list,1) = 1 then cand.list[1] else null end,
         cand.list,
         st.duration_value, st.duration_unit, st.description, 'pending'
    from acc.flow_steps st
    cross join lateral (
      select coalesce(
        -- owner_from_trigger is deliberately absent: who that step belongs to was answered on the
        -- form when the instance was raised, and there is nothing to read it back from now. Such a
        -- step materialises empty, and wf_forward refuses it with a message naming the step rather
        -- than silently sending it to nobody.
        case when st.owner_is_creator and coalesce(v_creator,'')<>'' then array[v_creator] end,
        case when st.owner_resolve_field is not null then
          (select array[st.owner_resolve_map ->> (d->>'value')]
             from acc.flow_cases c, jsonb_array_elements(coalesce(c.trigger_details,'[]'::jsonb)) d
            where c.id = p_case_id and d->>'label' = st.owner_resolve_field limit 1)
        end,
        nullif(st.owner_emails,'{}'),
        case when coalesce(st.owner_email,'')<>'' then array[st.owner_email] end,
        '{}'::text[]
      ) as list
    ) cand
   where st.flow_id = v_flow
     and not exists(select 1 from acc.flow_case_steps y where y.case_id=p_case_id and y.seq=st.seq);

  get diagnostics v_added = row_count;
  return v_added;
end; $function$;

grant execute on function acc.wf_materialise_steps(bigint) to authenticated, service_role;

CREATE OR REPLACE FUNCTION acc.wf_done(p_fcs_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'acc', 'public'
AS $function$
declare v_email text := app.current_user_email(); v acc.flow_case_steps;
begin
  select * into v from acc.flow_case_steps where id=p_fcs_id;
  if not found then raise exception 'step not found'; end if;
  if lower(coalesce(v.person,'')) <> lower(coalesce(v_email,'')) then raise exception 'not your step'; end if;

  perform acc.wf_materialise_steps(v.case_id);
  if exists(select 1 from acc.flow_case_steps y where y.case_id=v.case_id and y.seq>v.seq) then
    perform acc.wf_forward(p_fcs_id);
    return;
  end if;

  update acc.flow_case_steps set forwarded_at=now(), status='done', received_at=coalesce(received_at, now()) where id=p_fcs_id;
  if v.task_id is not null then
    update acc.ptasks set status='Completed', approval_state='approved', progress=100, approved_at=now(), completed_at=now(), approved_by=v_email where id=v.task_id;
  end if;
  update acc.flow_cases set status='Done', updated_at=now() where id=v.case_id;
end; $function$;

/* wf_forward: one added line - materialise before deciding. Everything else is unchanged from
   20260827120000. This is the call that closed Reimbursement #8. */
CREATE OR REPLACE FUNCTION acc.wf_forward(p_fcs_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'acc', 'public'
AS $function$
declare v_email text := app.current_user_email(); v acc.flow_case_steps; nxt acc.flow_case_steps;
        v_flow acc.flows; v_due timestamptz; v_task_id bigint; has_next boolean; v_trig_owner text;
        v_cands text[]; v_c text; def acc.flow_steps; v_distinguish text;
begin
  select * into v from acc.flow_case_steps where id=p_fcs_id;
  if not found then raise exception 'step not found'; end if;
  if lower(coalesce(v.person,'')) <> lower(coalesce(v_email,'')) then raise exception 'not your step'; end if;

  /* Before deciding anything, make the instance match the workflow. Whether a step follows this one
     is the WORKFLOW's business, not the snapshot's - an instance raised before a step existed has
     no row for it, and asking the snapshot answered "nothing follows", which closed the whole thing
     one handover early. */
  perform acc.wf_materialise_steps(v.case_id);

  update acc.flow_case_steps set forwarded_at=now(), status='done', received_at=coalesce(received_at, now()) where id=p_fcs_id;
  select * into nxt from acc.flow_case_steps where case_id=v.case_id and seq>v.seq order by seq limit 1;
  has_next := found;
  if v.task_id is not null then
    update acc.ptasks set status='Awaiting Approval', approval_state='awaiting_approval', progress=100,
           completed_at=now(), approved_at=null, approved_by=null where id=v.task_id;
  end if;
  if has_next then
    select f.* into v_flow from acc.flows f join acc.flow_cases fc on fc.flow_id=f.id where fc.id=v.case_id;

    select * into def from acc.flow_steps where flow_id = v_flow.id and seq = nxt.seq;
    if found then
      if coalesce(def.owner_is_creator,false) then
        -- Back to whoever raised it. Read from the case rather than from the step's stored
        -- candidates, so it stays right even if the step was armed before this flag existed.
        select case when coalesce(fc.created_by,'')<>'' then array[fc.created_by] else '{}'::text[] end
          into v_cands from acc.flow_cases fc where fc.id=v.case_id;
      elsif coalesce(def.owner_from_trigger,false) then
        v_cands := coalesce(nullif(nxt.candidates,'{}'), case when coalesce(nxt.person,'')<>'' then array[nxt.person] end, '{}'::text[]);
      elsif def.owner_resolve_field is not null then
        select coalesce((select array[def.owner_resolve_map ->> (d->>'value')]
                          from jsonb_array_elements(coalesce(c.trigger_details,'[]'::jsonb)) d
                          where d->>'label'=def.owner_resolve_field limit 1), '{}'::text[])
          into v_cands from acc.flow_cases c where c.id=v.case_id;
        v_cands := coalesce(nullif(v_cands,'{}'), nullif(def.owner_emails,'{}'),
                            case when coalesce(def.owner_email,'')<>'' then array[def.owner_email] end, '{}'::text[]);
      else
        v_cands := coalesce(nullif(def.owner_emails,'{}'),
                            case when coalesce(def.owner_email,'')<>'' then array[def.owner_email] end, '{}'::text[]);
      end if;
      update acc.flow_case_steps
         set title=def.title, description=def.description,
             duration_value=def.duration_value, duration_unit=def.duration_unit,
             candidates=v_cands,
             person = case when array_length(v_cands,1)=1 then v_cands[1] else null end
       where id=nxt.id;
      select * into nxt from acc.flow_case_steps where id=nxt.id;
    else
      v_cands := coalesce(nullif(nxt.candidates,'{}'), case when coalesce(nxt.person,'')<>'' then array[nxt.person] end, '{}'::text[]);
    end if;

    v_due := acc.wf_due(now(), nxt.duration_value, nxt.duration_unit);
    select d->>'value' into v_distinguish
      from jsonb_array_elements(coalesce(v_flow.trigger_template,'[]'::jsonb)) with ordinality as t(val,ord)
      join acc.flow_cases fcc on fcc.id = v.case_id
      join jsonb_array_elements(coalesce(fcc.trigger_details,'[]'::jsonb)) d on d->>'label' = t.val->>'label'
     where coalesce(t.val->>'type','text') not in ('date','attachment')
       and coalesce(d->>'value','') <> ''
     order by t.ord limit 1;
    insert into acc.ptasks(title, description, due_date, order_index, flow_case_step_id, delegator, created_by)
      values(coalesce(v_flow.name,'Workflow'),
             coalesce(v_flow.name,'Workflow')||': '||coalesce(nxt.title,'')||case when coalesce(v_distinguish,'')<>'' then ' — '||v_distinguish else '' end,
             (v_due at time zone 'Asia/Kolkata')::date, 0, nxt.id, v_email, v_email)
      returning id into v_task_id;
    update acc.flow_case_steps set task_id=v_task_id, appeared_at=now(), due_at=v_due, received_at=null, forwarded_at=null, status='pending' where id=nxt.id;

    if coalesce(array_length(v_cands,1),0) = 0 then
      raise exception 'The next step "%" has nobody assigned - add a person to it in the workflow before forwarding.', coalesce(nxt.title,'this step');
    end if;
    foreach v_c in array v_cands loop
      insert into acc.ptask_assignees(task_id, email) values(v_task_id, v_c) on conflict do nothing;
      insert into acc.task_rank(task_id, viewer_email, rank)
        values(v_task_id, v_c, coalesce((select max(rank) from acc.task_rank where lower(viewer_email)=lower(v_c)),0)+1)
        on conflict (task_id, viewer_email) do nothing;
    end loop;
    update acc.flow_cases set current_step=nxt.seq, updated_at=now() where id=v.case_id;

    v_trig_owner := acc.wf_case_trigger_owner(v.case_id);
    foreach v_c in array v_cands loop
      -- The trigger owner is normally spared the email, having raised the thing themselves. A
      -- confirmation step is the exception: it is precisely them being asked to act, and weeks may
      -- have passed since they filed it, so they are told.
      if coalesce(def.confirm_only,false) or v_trig_owner is null or lower(v_trig_owner)<>lower(v_c) then
        perform net.http_post(
          url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/workflow-mailer',
          headers := '{"Content-Type":"application/json","apikey":"sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n"}'::jsonb,
          body := jsonb_build_object('type','assigned','task_id',v_task_id,'email',v_c),
          timeout_milliseconds := 15000);
      end if;
    end loop;
  else
    update acc.flow_cases set status='Done', updated_at=now() where id=v.case_id;
  end if;
end; $function$;
