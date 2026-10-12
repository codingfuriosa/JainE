/* Edit can now change WHO a step goes to, not just what the bill says.

   WHAT WAS WRONG. Steps marked owner_from_trigger have no fixed owner — whoever raises the
   instance names the person. That question is asked once, on the New form, and never again. Point
   Dept Check at the wrong department and there was no way back: the Edit form offers the bill's
   details and nothing else, so even the person who raised it could not re-route their own mistake.
   Invoice Processing bill 415 had to be moved by hand because of this.

   WHAT IT DOES NOW. p_step_members, the same {seq: [emails]} shape acc.wf_create_instance already
   takes, re-points any owner_from_trigger step that HAS NOT BEEN FORWARDED yet. Already-forwarded
   steps are skipped: changing who did a step that is finished is rewriting history, not correcting
   a mistake.

   THE TASK MOVES WITH IT. Changing candidates alone would leave the bill sitting in the old
   person's list with no way for them to act on it and no sign of it in the new person's — the same
   shape of bug as the one this exists to fix. wf_arm_first_step cannot do it: it returns early
   when the step already has a task, by design, so it would never re-point an existing one.

   THE ASSIGNMENT RESTRICTION IS RE-CHECKED HERE, exactly as acc.wf_create_instance checks it, with
   the same Systems / Administrator / frontoffice exemptions. Otherwise the restriction on who may
   receive a bill would hold when raising one and evaporate when editing it.

   The two-argument form is dropped rather than left beside this one: PostgREST resolves by
   argument name, and two candidates differing only by a defaulted parameter is ambiguous. The only
   caller is accountability.js, which is updated alongside. */

drop function if exists acc.wf_update_instance(bigint, jsonb);

create function acc.wf_update_instance(p_case_id bigint, p_details jsonb, p_step_members jsonb default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'acc', 'public'
as $function$
declare c acc.flow_cases; v_email text := app.current_user_email();
        v_may boolean; v_was_returned boolean;
        v_flow acc.flows; v_may_assign_anyone boolean; v_allowed text[];
        r record; v_list text[]; v_names text; e text;
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

revoke all on function acc.wf_update_instance(bigint, jsonb, jsonb) from public;
grant execute on function acc.wf_update_instance(bigint, jsonb, jsonb) to authenticated;
