-- SENT-BACK AND REVERTED STEPS GO BACK TO THEIR REAL OWNERS
--
-- Two live failures on Reimbursement, 14 Oct 2026:
--
-- 1. Claim #113 (Riya Dey). HR sent it back from step 1 (HR Review); wf_reject hands step 1 to the
--    raiser so they can correct it. When she saved the correction, wf_update_instance put the claim
--    back in motion through wf_arm_first_step - which returns at once when the step already has a
--    task, and it always does here. Step 1 therefore stayed assigned to Riya: HR never got it back,
--    and she could have forwarded her own claim past HR. Invoice Processing has the same path: the
--    edit form's step picker pre-fills with the step's current people, which after a send-back is
--    the raiser, so a corrected bill went back to whoever raised it.
--
-- 2. Claim #115 (Arijit Sarkar). HR used Revert on HR Review, a step shared by three people.
--    wf_revert marked it RECEIVED and in the same statement removed the person who received it.
--    wf_forward needs a named person, so every HR member got "not your step"; and as it read
--    "received", nobody was offered Receive either. Stuck for everyone.
--
-- Fixes:
--   wf_reject           remembers step 1's real people (held_for_correction_from) before handing it
--                       to the raiser.
--   wf_update_instance  on the correction of an instance that was sent back to its raiser, hands
--                       step 1 back: to the people picked on the form if they were changed, else to
--                       the people it remembered, else to the workflow's own owners - as a fresh,
--                       unreceived step, with its task moved to them.
--   wf_revert           a shared step pulled back goes back to waiting for any of its people to
--                       Receive it, not "received by nobody". A single-person step is unchanged.
-- Plus a repair of the two claims stuck today.

alter table acc.flow_case_steps add column if not exists held_for_correction_from text[];
comment on column acc.flow_case_steps.held_for_correction_from is
  'Who the step belonged to before wf_reject handed it to the raiser to correct; restored by wf_update_instance.';

-- ------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION acc.wf_reject(p_fcs_id bigint, p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_email text := app.current_user_email();
        v acc.flow_case_steps; v_case acc.flow_cases; v_flow acc.flows;
        v_allowed boolean; v_shared boolean;
        v_first_seq int; v_raiser text; v_to_raiser boolean; v_name text;
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

  /* Which step is first is read from THIS INSTANCE'S own materialised steps, not from the flow
     definition: a flow can be edited after an instance is created, and what matters is the first
     step this instance actually has. */
  select min(s.seq) into v_first_seq
    from acc.flow_case_steps s where s.case_id = v.case_id;
  v_raiser := lower(nullif(btrim(coalesce(v_case.created_by,'')),''));

  /* Back to the raiser only where there is genuinely nowhere else to go, the raiser is known, and
     they are not already the one holding it. */
  v_to_raiser := (v.seq = v_first_seq)
                 and v_raiser is not null
                 and v_raiser <> lower(coalesce(v_email,''));

  if v_to_raiser then
    select coalesce(nullif(btrim(up.full_name),''), nullif(btrim(u.full_name),''),
                    split_part(v_raiser,'@',1))
      into v_name
      from (select v_raiser as e) x
      left join acc.user_profile up on lower(up.email) = x.e
      left join adm.users u         on lower(u.email)  = x.e;

    /* Fresh in their queue rather than already-received: this has come BACK to them, and they
       should have to pick it up like anything else that lands. Who the step really belongs to is
       kept first (only the first time, if it is sent back more than once), so that the correction
       can hand it back - see wf_update_instance. */
    update acc.flow_case_steps
       set held_for_correction_from = coalesce(held_for_correction_from,
                                               nullif(candidates,'{}'),
                                               case when coalesce(person,'')<>'' then array[person] end),
           person      = v_raiser,
           candidates  = array[v_raiser],
           status      = 'pending',
           appeared_at = now(),
           received_at = null,
           claimed_by  = null
     where id = p_fcs_id;

    /* The task moves with it, or the sender keeps an item they can no longer act on and the
       raiser never learns it is theirs again. Assigning fires the usual notification. */
    if v.task_id is not null then
      delete from acc.ptask_assignees a where a.task_id = v.task_id;
      insert into acc.ptask_assignees(task_id, email) values (v.task_id, v_raiser)
        on conflict do nothing;
      insert into acc.task_rank(task_id, viewer_email, rank)
      values (v.task_id, v_raiser,
              coalesce((select max(rank) from acc.task_rank
                         where lower(viewer_email)=v_raiser),0)+1)
        on conflict (task_id, viewer_email) do nothing;
    end if;
  else
    /* UNCHANGED for every later step, and for a raiser sending back to themselves.
       A shared step is claimed by whoever sent it back: it is in their hands now, and leaving it
       open to the other candidates would let somebody else pick up a step mid-objection. */
    v_shared := coalesce(array_length(v.candidates,1),0) > 1;

    update acc.flow_case_steps
       set received_at = coalesce(received_at, now()),
           status      = 'received',
           person      = case when v_shared then lower(coalesce(v_email, person)) else person end,
           claimed_by  = case when v_shared then lower(coalesce(v_email, claimed_by)) else claimed_by end
     where id = p_fcs_id;

    if v.task_id is not null and v_shared then
      delete from acc.ptask_assignees a
       where a.task_id = v.task_id and lower(a.email) <> lower(coalesce(v_email,''));
      insert into acc.ptask_assignees(task_id, email) values (v.task_id, lower(v_email))
        on conflict do nothing;
    end if;
  end if;

  update acc.flow_cases
     set current_step   = v.seq,
         status         = 'Pending',
         returned_at    = now(),
         returned_reason= nullif(btrim(coalesce(p_reason,'')),''),
         returned_by    = v_email,
         returned_step  = coalesce(v.title,'a step'),
         returned_to    = case when v_to_raiser then v_raiser else v_email end,
         updated_at     = now()
   where id = v.case_id;

  /* The history says where it went, by name. "sent it back" with no destination was the line one
     person read nine times over two days while nothing moved. */
  insert into acc.flow_updates(case_id, author, body, system)
  values (v.case_id, v_email,
          case when v_to_raiser
               then 'sent "'||coalesce(v.title,'this step')||'" back to '||v_name||' to correct'
               else 'sent "'||coalesce(v.title,'this step')||'" back and is holding the '
                    ||coalesce(v_flow.instance_noun,'instance')||' until it is corrected'
          end
          ||case when coalesce(btrim(p_reason),'')<>'' then ' — reason: '||btrim(p_reason) else '' end,
          true);

  /* Only the raiser is told, and only when it actually moved to them — through the ordinary task
     assignment above. On a later step the one person who needs to know is the one who pressed the
     button, and they are looking at it. */
  return v_name;   -- null when it stayed here
end; $function$;

-- ------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION acc.wf_update_instance(p_case_id bigint, p_details jsonb, p_step_members jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'acc', 'public'
AS $function$
declare c acc.flow_cases; v_email text := app.current_user_email();
        v_may boolean; v_was_returned boolean;
        v_flow acc.flows; v_may_assign_anyone boolean; v_allowed text[];
        r record; v_list text[]; v_names text; e text;
        v_first acc.flow_case_steps; v_def acc.flow_steps; v_raiser text; v_picked text[];
begin
  select * into c from acc.flow_cases where id=p_case_id;
  if not found then raise exception 'instance not found'; end if;
  if c.status in ('Done','Cancelled') then
    raise exception 'This instance is already over — it can no longer be edited';
  end if;

  -- Reimbursement only: once it has moved past its first step, nobody can edit it any more — not
  -- even its own owner. A returned-for-correction instance is exempt (wf_reject already resets
  -- current_step back to the first step precisely so this correction edit can happen), so this
  -- only blocks a claim that is genuinely still progressing normally.
  if c.flow_id = 39 and c.current_step > 1 then
    raise exception 'This has already moved past its first step and can no longer be edited';
  end if;

  -- The owner, or whoever it has been sent back to. The latter matters: a rejected invoice is
  -- addressed to the Dept Check owner precisely so they can correct it. No admin bypass here —
  -- editing an instance is the triggering event owner's business, not workflow management's.
  v_may := lower(coalesce(c.created_by,'')) = lower(coalesce(v_email,''))
        or lower(coalesce(v_email,'')) = any(
             select lower(btrim(x)) from unnest(string_to_array(coalesce(c.returned_to,''),',')) x
              where btrim(x) <> '');
  if not v_may then
    raise exception 'Only the owner, or whoever this was sent back to, can edit it';
  end if;

  v_was_returned := c.returned_at is not null;

  update acc.flow_cases set trigger_details=coalesce(p_details,'[]'::jsonb) where id=p_case_id;

  /* Re-resolve the steps whose owner is derived from a field - Dept Check is whichever department
     the invoice names. On a returned instance that has to include the FIRST step too: the whole
     point of correcting the department is that the invoice then goes to the right department, and
     the old "seq > current_step" bound excluded exactly the step being corrected. */
  update acc.flow_case_steps fcs
     set candidates = cand.list,
         person = case when array_length(cand.list,1) = 1 then cand.list[1] else null end
    from acc.flow_steps def
    cross join lateral (
      select coalesce(
        (select array[def.owner_resolve_map ->> (d->>'value')]
           from jsonb_array_elements(coalesce(p_details,'[]'::jsonb)) d
          where d->>'label' = def.owner_resolve_field limit 1),
        '{}'::text[]
      ) as list
    ) cand
   where fcs.case_id = p_case_id
     and def.flow_id = c.flow_id
     and def.seq = fcs.seq
     and def.owner_resolve_field is not null
     and (fcs.seq > c.current_step or v_was_returned);

  -- ------------------------------------------------------------------------------------------
  -- RE-ROUTING a step whose owner was chosen by hand when the instance was raised.
  -- ------------------------------------------------------------------------------------------
  if p_step_members is not null and p_step_members <> '{}'::jsonb then
    select * into v_flow from acc.flows where id = c.flow_id;

    /* The same gate acc.wf_create_instance applies, and the same exemptions: Systems and the
       Administrator are the people called on to put a misrouted bill right, and frontoffice@ is a
       trigger owner who is not one of the day-to-day store raisers the restriction targets. */
    v_may_assign_anyone := app.is_superadmin()
      or lower(v_email) = 'frontoffice@thejaingroup.com'
      or exists(select 1 from adm.users u
                 where lower(u.email)=lower(v_email)
                   and u.department && array['Systems']::text[]);

    if v_flow.trigger_step_assignable_to is not null
       and btrim(v_flow.trigger_step_assignable_to) <> ''
       and not v_may_assign_anyone then
      v_allowed := (
        select coalesce(array_agg(distinct lower(btrim(q.e))), '{}'::text[])
        from (
          select unnest(string_to_array(v_flow.trigger_step_assignable_to, ',')) as e
          union all
          select jsonb_array_elements_text(
                   coalesce(v_flow.trigger_step_assignable_overrides -> lower(v_email), '[]'::jsonb))
        ) q
        where btrim(q.e) <> ''
      );
      if exists(
        select 1 from jsonb_each(p_step_members) kv
        cross join lateral jsonb_array_elements_text(kv.value) x
        where btrim(x) <> '' and not (lower(btrim(x)) = any(v_allowed))
      ) then
        raise exception 'You can only assign these steps to: %', v_flow.trigger_step_assignable_to;
      end if;
    end if;

    for r in
      select fcs.id, fcs.seq, fcs.title, fcs.task_id,
             (select coalesce(array_agg(lower(btrim(x))), '{}'::text[])
                from jsonb_array_elements_text(p_step_members -> fcs.seq::text) x
               where btrim(x) <> '') as list
        from acc.flow_case_steps fcs
        join acc.flow_steps def on def.flow_id = c.flow_id and def.seq = fcs.seq
       where fcs.case_id = p_case_id
         and def.owner_from_trigger
         and p_step_members ? fcs.seq::text
         /* A finished step is not re-routed. Correcting where a bill is GOING is the point;
            rewriting who already handled it is not. */
         and fcs.forwarded_at is null
    loop
      v_list := r.list;
      continue when coalesce(array_length(v_list,1),0) = 0;

      update acc.flow_case_steps
         set candidates = v_list,
             person     = case when array_length(v_list,1) = 1 then v_list[1] else null end,
             claimed_by = null
       where id = r.id;

      /* The task follows, or the bill stays in the old person's list and never appears in the new
         one. Replacing the whole assignee set rather than adding to it: these people are now the
         ones who have it, and whoever had it before does not. */
      if r.task_id is not null then
        delete from acc.ptask_assignees a where a.task_id = r.task_id;
        foreach e in array v_list loop
          insert into acc.ptask_assignees(task_id, email) values (r.task_id, e)
            on conflict do nothing;
          insert into acc.task_rank(task_id, viewer_email, rank)
          values (r.task_id, e,
                  coalesce((select max(rank) from acc.task_rank where lower(viewer_email)=e),0)+1)
            on conflict (task_id, viewer_email) do nothing;
        end loop;
      end if;

      /* Named in the history, because "this bill changed hands" is exactly the kind of thing
         somebody reviewing it later needs to be able to see without asking anyone. */
      select string_agg(coalesce(nullif(btrim(up.full_name),''), nullif(btrim(u.full_name),''),
                                 split_part(x.e,'@',1)), ', ')
        into v_names
        from unnest(v_list) as x(e)
        left join acc.user_profile up on lower(up.email) = x.e
        left join adm.users u         on lower(u.email)  = x.e;

      insert into acc.flow_updates(case_id, author, body, system)
      values (p_case_id, v_email,
              'sent "'||coalesce(r.title,'a step')||'" to '||coalesce(v_names,'somebody else')
              ||' instead', true);
    end loop;
  end if;

  /* THE CORRECTION HANDS STEP 1 BACK. When a send-back gave the first step to the raiser
     (wf_reject), correcting it must give that step back to whoever it really belongs to - not
     leave it with the raiser, who could then forward their own instance past the check.
     Who that is, in order: the people picked on the form, if they are not just the raiser (the
     picker pre-fills with the step's current people, which after a send-back IS the raiser);
     otherwise who it belonged to before the send-back; otherwise the workflow's own owners. It
     arrives fresh - not received - with its task moved to them. */
  v_raiser := lower(nullif(btrim(coalesce(c.created_by,'')),''));
  if v_was_returned and v_raiser is not null
     and lower(btrim(coalesce(c.returned_to,''))) = v_raiser then
    select * into v_first from acc.flow_case_steps where case_id=p_case_id order by seq limit 1;
    if found and v_first.forwarded_at is null then
      select * into v_def from acc.flow_steps where flow_id=c.flow_id and seq=v_first.seq;

      v_picked := case when p_step_members ? v_first.seq::text then
                    (select coalesce(array_agg(lower(btrim(x))), '{}'::text[])
                       from jsonb_array_elements_text(p_step_members -> v_first.seq::text) x
                      where btrim(x) <> '') end;

      if coalesce(array_length(v_picked,1),0) > 0 and v_picked <> array[v_raiser] then
        v_list := v_picked;                                   -- chosen again on the form
      elsif v_def.id is not null and v_def.owner_resolve_field is not null
            and coalesce(array_length(v_first.candidates,1),0) > 0
            and v_first.candidates <> array[v_raiser] then
        v_list := v_first.candidates;                         -- re-resolved from the details above
      elsif coalesce(array_length(v_first.held_for_correction_from,1),0) > 0 then
        v_list := v_first.held_for_correction_from;           -- who it belonged to before
      elsif v_def.id is not null and coalesce(v_def.owner_is_creator,false) then
        v_list := array[v_raiser];
      elsif v_def.id is not null then
        v_list := coalesce(nullif(v_def.owner_emails,'{}'),
                           case when coalesce(v_def.owner_email,'')<>'' then array[v_def.owner_email] end,
                           v_first.candidates);
      else
        v_list := v_first.candidates;
      end if;

      update acc.flow_case_steps
         set candidates  = v_list,
             person      = case when array_length(v_list,1) = 1 then v_list[1] else null end,
             claimed_by  = null,
             received_at = null,
             status      = 'pending',
             appeared_at = now(),
             held_for_correction_from = null
       where id = v_first.id;

      if v_first.task_id is not null then
        delete from acc.ptask_assignees a where a.task_id = v_first.task_id;
        foreach e in array v_list loop
          insert into acc.ptask_assignees(task_id, email) values (v_first.task_id, e)
            on conflict do nothing;
          insert into acc.task_rank(task_id, viewer_email, rank)
          values (v_first.task_id, e,
                  coalesce((select max(rank) from acc.task_rank where lower(viewer_email)=lower(e)),0)+1)
            on conflict (task_id, viewer_email) do nothing;
        end loop;
        update acc.ptasks set status='Pending', approval_state='open', progress=0,
               completed_at=null, approved_at=null, approved_by=null
         where id=v_first.task_id;
      end if;
    end if;
  end if;

  -- A corrected instance goes back into motion. Without this it stayed parked with no task on it
  -- and no way for anyone to move it.
  if v_was_returned then
    update acc.flow_cases
       set returned_at=null, returned_reason=null, returned_by=null, returned_step=null,
           returned_to=null, status='Pending', updated_at=now()
     where id=p_case_id;
    perform acc.wf_arm_first_step(p_case_id);
    insert into acc.flow_updates(case_id, author, body, system)
    values (p_case_id, v_email, 'corrected this and sent it back through from the first step', true);
  end if;
end; $function$;

-- ------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION acc.wf_revert(p_fcs_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_email text := app.current_user_email(); v acc.flow_case_steps; act_person text;
        v_flow acc.flows; v_trig_owner text; v_cands text[]; v_c text; v_shared boolean;
begin
  select * into v from acc.flow_case_steps where id=p_fcs_id;
  if not found then raise exception 'step not found'; end if;
  if not acc.wf_may_act_as(v.person, v_email, (select flow_id from acc.flow_cases where id=v.case_id)) then raise exception 'not your step'; end if;
  if v.forwarded_at is null then raise exception 'this step has not been forwarded yet'; end if;
  if (select status from acc.flow_cases where id=v.case_id)='Done' then raise exception 'this instance is complete — reopen the final step instead'; end if;
  -- captured before the downstream reset below clears it — this is the person whose in-progress
  -- task is being pulled back/cancelled by this revert, i.e. the actual "Task Reverted" notification
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
  -- restore multi-owner fan-out on the step being reverted ONTO too, same as downstream steps above -
  -- previously this only ever kept the single stale claimer, so the other original candidate(s)
  -- never got the task back, and only v.person (not the full candidate list) got a task_rank row.
  v_cands := coalesce(nullif(v.candidates,'{}'), case when coalesce(v.person,'')<>'' then array[v.person] end, '{}'::text[]);
  if v.task_id is not null then
    update acc.ptasks set status='Pending', approval_state='open', progress=0, approved_at=null, completed_at=null, approved_by=null where id=v.task_id;
    foreach v_c in array v_cands loop
      insert into acc.ptask_assignees(task_id, email) values(v.task_id, v_c) on conflict do nothing;
      insert into acc.task_rank(task_id, viewer_email, rank)
        values(v.task_id, v_c, coalesce((select max(rank) from acc.task_rank where lower(viewer_email)=lower(v_c)),0)+1)
        on conflict (task_id, viewer_email) do update set rank=excluded.rank;
    end loop;
  end if;
  /* Back in play. A step one person owns is straight back in their hands (received). A SHARED step
     goes back to waiting for any of its people to Receive it - it used to be marked received while
     the person who received it was removed in the same statement, which left a step nobody could
     forward ("not your step") and nobody was offered to receive. */
  v_shared := coalesce(array_length(v.candidates,1),0) > 1;
  update acc.flow_case_steps set forwarded_at=null, appeared_at=now(),
         received_at = case when v_shared then null else now() end,
         status      = case when v_shared then 'pending' else 'received' end,
         person      = case when v_shared then null else person end,
         claimed_by  = case when v_shared then null else claimed_by end
    where id=v.id;
  update acc.flow_cases set current_step=v.seq, status='Pending', updated_at=now() where id=v.case_id;
  insert into acc.flow_updates(case_id, author, body, system)
    values(v.case_id, v_email, 'reverted "'||coalesce(v.title,'this step')||'" and pulled it back', true);
  -- Email target corrected back: notify the person whose downstream task was just reverted/pulled
  -- back (act_person), not the person(s) who will claim the reclaimed step going forward.
  v_trig_owner := acc.wf_case_trigger_owner(v.case_id);
  if act_person is not null and lower(act_person)<>lower(v_email) and (v_trig_owner is null or lower(v_trig_owner)<>lower(act_person)) then
    select f.* into v_flow from acc.flows f join acc.flow_cases c2 on c2.flow_id=f.id where c2.id=v.case_id;
    perform net.http_post(
      url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/workflow-mailer',
      headers := '{"Content-Type":"application/json","apikey":"sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n"}'::jsonb,
      body := jsonb_build_object('type','revert','email',act_person,'workflow',coalesce(v_flow.name,'Workflow'),'step',v.title,'by',v_email),
      timeout_milliseconds := 15000);
  end if;
end; $function$;
