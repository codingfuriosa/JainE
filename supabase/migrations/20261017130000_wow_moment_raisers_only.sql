/* Wow Moment: only the named Sales Managers may raise one - not the Administrator either.

   20261017120000 let app.is_superadmin() raise a Wow Moment alongside flows.variants.wow.raisers,
   so the Administrator could see and try the button. A Wow Moment is the Sales Managers' own
   spend, routed to Shafat Mehar, so it is now the raisers list and nobody else. The page
   (wfVariantsICanRaise in accountability.js) no longer draws the button for the Administrator
   either. Otherwise identical to the definition it replaces. */

CREATE OR REPLACE FUNCTION acc.wf_create_instance(p_flow_id bigint, p_details jsonb, p_step_members jsonb DEFAULT NULL::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'acc', 'public'
AS $function$
declare v_block_reason text; v_email text := app.current_user_email(); v_flow acc.flows; v_caseno int; v_jaine int; v_case_id bigint;
        v_first acc.flow_case_steps; v_due timestamptz; v_task_id bigint; v_is_member boolean; c text;
        v_trig_ok boolean; v_distinguish text; v_allowed text[]; v_may_assign_anyone boolean;
        v_variant text; v_vcfg jsonb;
begin
  if v_email is null then raise exception 'not signed in'; end if;
  select * into v_flow from acc.flows where id=p_flow_id;
  if not found then raise exception 'workflow not found'; end if;

  /* WHICH KIND. The form marks a variant with one '__variant' detail; it is taken out here so it
     is never stored as a field. Anything not listed in flows.variants is refused rather than
     quietly raised as the ordinary kind - that would send it to the wrong checker. */
  select nullif(btrim(d->>'value'),'') into v_variant
    from jsonb_array_elements(coalesce(p_details,'[]'::jsonb)) d
   where d->>'label' = '__variant' limit 1;
  p_details := coalesce((select jsonb_agg(d) from jsonb_array_elements(coalesce(p_details,'[]'::jsonb)) d
                          where coalesce(d->>'label','') <> '__variant'), '[]'::jsonb);
  if v_variant is not null then
    v_vcfg := v_flow.variants -> v_variant;
    if v_vcfg is null then raise exception 'This workflow has no "%" kind', v_variant; end if;
    if not (lower(v_email) in (select lower(x) from jsonb_array_elements_text(coalesce(v_vcfg->'raisers','[]'::jsonb)) x)) then
      raise exception 'You are not allowed to raise a %', coalesce(v_vcfg->>'label', v_variant);
    end if;
  end if;

  v_is_member := lower(coalesce(v_flow.created_by,''))=lower(v_email)
                 or exists(select 1 from acc.flow_steps st where st.flow_id=p_flow_id
                            and (lower(coalesce(st.owner_email,''))=lower(v_email)
                                 or lower(v_email) = any(select lower(x) from unnest(coalesce(st.owner_emails,'{}')) x)));
  v_trig_ok := v_flow.trigger_owner is not null and (
                 v_flow.trigger_owner = '__ALL__'
                 or lower(v_email) = any(string_to_array(lower(v_flow.trigger_owner), ','))
               );
  -- Only the true superadmin bypasses a flow's trigger_owner restriction; everyone else must be the
  -- flow's creator, its trigger_owner, or (when no trigger_owner is set) an existing step member.
  if not (app.is_superadmin()
          or lower(coalesce(v_flow.created_by,''))=lower(v_email)
          or v_trig_ok
          or (v_flow.trigger_owner is null and v_is_member)) then
    raise exception 'You are not allowed to start an instance of this workflow';
  end if;

  /* ONE OPEN INSTANCE AT A TIME — per kind. acc.wf_new_instance_block_reason both decides it and
     words it. JE001 tells the page to print the sentence on its own. */
  v_block_reason := acc.wf_new_instance_block_reason(p_flow_id, v_email, v_variant);
  if v_block_reason is not null then
    raise exception using errcode = 'JE001', message = v_block_reason;
  end if;

  /* A flow can restrict who its "decided per instance" steps may be handed to - Invoice Processing's
     bill raisers may only ever name the two named people. Checked here, not just hidden in the form,
     since this is the real gate.
     Systems and the Administrator are exempt, and so is Uma Chatterjee (frontoffice@), matching
     accountability.js's client-side exemption. */
  v_may_assign_anyone := app.is_superadmin()
    or lower(v_email) = 'frontoffice@thejaingroup.com'
    or exists(select 1 from adm.users u
               where lower(u.email)=lower(v_email)
                 and u.department && array['Systems']::text[]);
  if v_flow.trigger_step_assignable_to is not null and btrim(v_flow.trigger_step_assignable_to)<>''
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
      select 1 from jsonb_each(coalesce(p_step_members,'{}'::jsonb)) kv
      cross join lateral jsonb_array_elements_text(kv.value) e
      where btrim(e)<>'' and not (lower(btrim(e)) = any(v_allowed))
    ) then
      raise exception 'You can only assign these steps to: %', v_flow.trigger_step_assignable_to;
    end if;
  end if;

  select coalesce(max(case_no),0)+1 into v_caseno from acc.flow_cases where flow_id=p_flow_id;
  -- Invoice Processing's own stable id - see 20260902090000_invoice_processing_jaine_id_from_118.sql.
  if p_flow_id = 26 then
    select coalesce(max(jaine_id),117)+1 into v_jaine from acc.flow_cases where flow_id=26;
  end if;
  insert into acc.flow_cases(flow_id, title, trigger_details, case_no, jaine_id, current_step, status, created_by, variant)
    values(p_flow_id, coalesce(v_flow.trigger_event, v_flow.name), coalesce(p_details,'[]'::jsonb), v_caseno, v_jaine, 1, 'Pending', v_email, v_variant)
    returning id into v_case_id;

  insert into acc.flow_case_steps(case_id, step_id, seq, title, person, candidates,
                                  duration_value, duration_unit, description, status)
  select v_case_id, st.id, st.seq, st.title,
         case when array_length(cand.list,1) = 1 then cand.list[1] else null end,
         cand.list,
         st.duration_value, st.duration_unit, st.description, 'pending'
    from acc.flow_steps st
    cross join lateral (
      select coalesce(
        case when st.owner_is_creator then array[v_email] end,
        case when st.owner_from_trigger then
          (select array_agg(x) from jsonb_array_elements_text(coalesce(p_step_members -> st.seq::text,'[]'::jsonb)) x)
        end,
        case when st.owner_resolve_field is not null then
          (select array[st.owner_resolve_map ->> (d->>'value')]
             from jsonb_array_elements(coalesce(p_details,'[]'::jsonb)) d
            where d->>'label' = st.owner_resolve_field limit 1)
        end,
        nullif(st.owner_emails,'{}'),
        case when coalesce(st.owner_email,'')<>'' then array[st.owner_email] end,
        '{}'::text[]
      ) as list
    ) cand
   where st.flow_id=p_flow_id
   order by st.seq;

  /* The variant's own routing: these steps go to the people it names, under its own title. Done
     before the first task is created, so that task goes to them and nobody else ever sees it. */
  if v_vcfg is not null and jsonb_typeof(v_vcfg->'steps') = 'object' then
    update acc.flow_case_steps fcs
       set candidates = ov.owners,
           person     = case when array_length(ov.owners,1) = 1 then ov.owners[1] else null end,
           title      = coalesce(nullif(btrim(ov.title),''), fcs.title)
      from (select k.key::int as seq,
                   array(select lower(btrim(x)) from jsonb_array_elements_text(coalesce(k.value->'owners','[]'::jsonb)) x
                          where btrim(x) <> '') as owners,
                   k.value->>'title' as title
              from jsonb_each(v_vcfg->'steps') k
             where k.key ~ '^[0-9]+$') ov
     where fcs.case_id = v_case_id and fcs.seq = ov.seq
       and coalesce(array_length(ov.owners,1),0) > 0;
  end if;

  select * into v_first from acc.flow_case_steps where case_id=v_case_id order by seq limit 1;
  if found and coalesce(array_length(v_first.candidates,1),0) > 0 then
    v_due := acc.wf_due(now(), v_first.duration_value, v_first.duration_unit);
    select d->>'value' into v_distinguish
      from jsonb_array_elements(coalesce(v_flow.trigger_template,'[]'::jsonb)) with ordinality as t(val,ord)
      join jsonb_array_elements(coalesce(p_details,'[]'::jsonb)) d on d->>'label' = t.val->>'label'
     where coalesce(t.val->>'type','text') not in ('date','attachment')
       and coalesce(d->>'value','') <> ''
     order by t.ord limit 1;
    insert into acc.ptasks(title, description, due_date, order_index, flow_case_step_id, delegator, created_by)
      values(coalesce(v_flow.name,'Workflow'),
             coalesce(v_flow.name,'Workflow')||': '||coalesce(v_first.title,'')||case when coalesce(v_distinguish,'')<>'' then ' — '||v_distinguish else '' end,
             (v_due at time zone 'Asia/Kolkata')::date, 0, v_first.id, v_email, v_email)
      returning id into v_task_id;
    update acc.flow_case_steps set task_id=v_task_id, appeared_at=now(), due_at=v_due, status='pending' where id=v_first.id;
    foreach c in array v_first.candidates loop
      insert into acc.ptask_assignees(task_id, email) values(v_task_id, c) on conflict do nothing;
      insert into acc.task_rank(task_id, viewer_email, rank)
        values(v_task_id, c, coalesce((select max(rank) from acc.task_rank where lower(viewer_email)=lower(c)),0)+1)
        on conflict (task_id, viewer_email) do nothing;
    end loop;
  end if;
  return v_case_id;
end; $function$;
