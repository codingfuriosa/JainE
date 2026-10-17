/* Two changes, both about who a workflow instance belongs to.

   1. WOW MOMENT — a second kind of Reimbursement, for two Sales Managers.
      Dhrubajyoti Adhikary (sm.sales2@) and Abhisek Shaw (mgr.sales@) spend on customers' "Wow
      Moments". Those claims are checked by Shafat Mehar (coordinator.vc@), not HR, then paid by
      Accounts and confirmed by the claimant, exactly as an ordinary claim is.

      WHY IT IS THE SAME WORKFLOW AND NOT A NEW ONE. Everything Accounts does with a claim - Print
      New Reimbursements, the Friday forward reminder, the claimant lookup, the Payment Received
      step - is written against Reimbursement (flow 39). A separate workflow would have dropped Wow
      claims out of every one of them. So a Wow claim is an ordinary Reimbursement carrying
      flow_cases.variant = 'wow', and the variant only changes what it has to: who checks it first
      and what that step is called.

      WHAT A VARIANT IS. flows.variants holds {key: {label, raisers, steps:{seq:{owners,title}},
      hide_fields, color}}. Nothing here is Reimbursement-specific; the page reads the same object to
      draw the button, hide the Transport / Food picker and colour the rows.

      HOW IT REACHES THE DATABASE. The form adds one detail {label:'__variant', value:<key>} to what
      it sends. wf_create_instance takes it out before storing anything - it is never a field - and
      records it on the case. Done this way so the one signature the app calls is not changed and no
      overload ambiguity is introduced.

      ONE OPEN CLAIM AT A TIME is now counted per kind: an unpaid travel claim does not stop a Wow
      claim being raised, nor the other way round.

   2. VENDOR-SCOPED CASE VIEWERS — SUBHANKAR DAS's bills.
      Manash Choudhury (digitalmarketing@) watches every bill handed to Ayush Ruia (system.admin@)
      on Invoice Processing. Bills from the vendor SUBHANKAR DAS are to be seen by Akashnil Basu
      (socialmedia@) instead. A case_viewers entry may now carry
          only_when: {label, in:[values]}   - the entry applies only when that detail matches
          unless:    {label, in:[values]}   - the entry applies only when it does not
      compared case-insensitively with runs of spaces collapsed, so "Subhankar  Das" still matches.

   Safe to run twice. */

-- ---------------------------------------------------------------------------------------------
-- 1a. Columns
-- ---------------------------------------------------------------------------------------------
alter table acc.flows       add column if not exists variants jsonb;
alter table acc.flow_cases  add column if not exists variant  text;
alter table acc.flow_drafts add column if not exists variant  text;

comment on column acc.flows.variants is
  'Kinds of instance this workflow can raise besides the ordinary one: {key:{label, raisers[], steps:{seq:{owners[],title}}, hide_fields[], color}}.';
comment on column acc.flow_cases.variant is
  'Which flows.variants entry this instance was raised as; null for the ordinary kind.';
comment on column acc.flow_drafts.variant is
  'Which flows.variants entry this draft will be raised as; null for the ordinary kind.';

update acc.flows
   set variants = jsonb_build_object('wow', jsonb_build_object(
         'label',       'Wow Moment',
         'plural',      'Wow Moments',
         'raisers',     jsonb_build_array('sm.sales2@thejaingroup.com','mgr.sales@thejaingroup.com'),
         'steps',       jsonb_build_object('1', jsonb_build_object(
                          'owners', jsonb_build_array('coordinator.vc@thejaingroup.com'),
                          'title',  'Wow Moment Check')),
         'hide_fields', jsonb_build_array('Transport / Food','Km'),
         'color',       '#7c3aed'))
 where id = 39;

-- ---------------------------------------------------------------------------------------------
-- 1b. One open claim at a time, counted per kind.
-- ---------------------------------------------------------------------------------------------
create or replace function acc.wf_new_instance_block_reason(p_flow_id bigint, p_email text, p_variant text)
 returns text
 language plpgsql
 stable
 security definer
 set search_path to 'acc', 'public'
as $function$
declare
  v_flow  acc.flows;
  v_case  acc.flow_cases;
  v_step  acc.flow_case_steps;
  v_noun  text;
  v_title text;
  v_mine  boolean;
  v_who   text;
begin
  if p_email is null or btrim(p_email) = '' then return null; end if;
  select * into v_flow from acc.flows where id = p_flow_id;
  if not found then return null; end if;

  /* Only flows that asked for it. The same function creates bills, challans and booking forms, and
     those are filed in batches all day — a store hand records five bills in a morning. */
  if not coalesce(v_flow.one_open_instance_per_person, false) then return null; end if;
  v_noun := lower(coalesce(v_flow.variants -> p_variant ->> 'label', v_flow.instance_noun, 'instance'));

  /* The claim in the way: theirs, OF THE SAME KIND, past its first step, not finished, not sent
     back. The oldest is named, because that is the one to clear first. */
  select fc.* into v_case
    from acc.flow_cases fc
   where fc.flow_id = p_flow_id
     and lower(coalesce(fc.created_by,'')) = lower(p_email)
     and coalesce(fc.variant,'') = coalesce(p_variant,'')
     and fc.current_step > 1
     and coalesce(fc.status,'') not in ('Done','Cancelled')
     and fc.returned_at is null
   order by fc.case_no
   limit 1;
  if not found then return null; end if;

  -- Where it has actually got to: the step that has landed and not yet moved on.
  select fcs.* into v_step
    from acc.flow_case_steps fcs
   where fcs.case_id = v_case.id
     and fcs.appeared_at  is not null
     and fcs.forwarded_at is null
   order by fcs.seq
   limit 1;

  v_title := coalesce(btrim(v_step.title), '');
  v_mine  := v_step.id is not null
             and (lower(coalesce(v_step.person,'')) = lower(p_email)
                  or lower(p_email) = any(select lower(x) from unnest(coalesce(v_step.candidates,'{}')) x));

  if v_mine then
    return (case
              when v_title = '' or v_title ilike '%payment%'
                then format('Waiting for you to confirm payment on #%s — open it and mark it Done.', v_case.case_no)
                else format('Waiting for you on #%s at "%s" — open it and mark it Done.', v_case.case_no, v_title)
            end)
           || ' You can save this one as a draft in the meantime.';
  end if;

  select string_agg(nm, ', ' order by nm) into v_who
    from (select distinct nullif(btrim(u.full_name),'') as nm
            from unnest(case when coalesce(v_step.person,'') <> '' then array[v_step.person]
                             else coalesce(v_step.candidates, '{}'::text[]) end) as e(email)
            join adm.users u on lower(u.email) = lower(e.email)
           where nullif(btrim(u.full_name),'') is not null) s;

  return format('Your %s #%s has not finished yet%s%s. You can save this one as a draft and send it once #%s is closed.',
                v_noun, v_case.case_no,
                case when v_title <> '' then format(' — it is at "%s"', v_title) else '' end,
                case when coalesce(v_who,'') <> '' then format(', with %s', v_who) else '' end,
                v_case.case_no);
end;
$function$;

-- The two-argument form is the ordinary kind.
create or replace function acc.wf_new_instance_block_reason(p_flow_id bigint, p_email text)
 returns text
 language sql
 stable
 security definer
 set search_path to 'acc', 'public'
as $function$
  select acc.wf_new_instance_block_reason(p_flow_id, p_email, null::text);
$function$;

-- ---------------------------------------------------------------------------------------------
-- 1c. Creating an instance: read the variant, check who may raise it, route its steps.
--     Otherwise identical to the definition it replaces.
-- ---------------------------------------------------------------------------------------------
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
    if not (app.is_superadmin()
            or lower(v_email) in (select lower(x) from jsonb_array_elements_text(coalesce(v_vcfg->'raisers','[]'::jsonb)) x)) then
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

-- ---------------------------------------------------------------------------------------------
-- 2a. Does a case_viewers entry apply to this instance's details?
-- ---------------------------------------------------------------------------------------------
create or replace function acc.wf_viewer_entry_applies(p_entry jsonb, p_details jsonb)
 returns boolean
 language sql
 immutable
 set search_path to 'acc', 'public'
as $function$
  with norm as (
    select lower(btrim(d->>'label')) as lbl,
           upper(regexp_replace(btrim(coalesce(d->>'value','')), '\s+', ' ', 'g')) as val
      from jsonb_array_elements(case when jsonb_typeof(p_details)='array' then p_details else '[]'::jsonb end) d
  )
  select
    (p_entry->'only_when' is null or jsonb_typeof(p_entry->'only_when') <> 'object' or exists(
       select 1 from norm
        where norm.lbl = lower(btrim(p_entry->'only_when'->>'label'))
          and norm.val in (select upper(regexp_replace(btrim(x), '\s+', ' ', 'g'))
                             from jsonb_array_elements_text(coalesce(p_entry->'only_when'->'in','[]'::jsonb)) x)))
    and
    (p_entry->'unless' is null or jsonb_typeof(p_entry->'unless') <> 'object' or not exists(
       select 1 from norm
        where norm.lbl = lower(btrim(p_entry->'unless'->>'label'))
          and norm.val in (select upper(regexp_replace(btrim(x), '\s+', ' ', 'g'))
                             from jsonb_array_elements_text(coalesce(p_entry->'unless'->'in','[]'::jsonb)) x)));
$function$;

-- ---------------------------------------------------------------------------------------------
-- 2b. The two visibility checks honour it. Otherwise identical to what they replace.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION acc.wf_can_see_case(p_case_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'acc', 'public'
AS $function$
declare v_case acc.flow_cases; v_flow acc.flows; v_email text := app.current_user_email();
begin
  select * into v_case from acc.flow_cases where id=p_case_id;
  if not found then return false; end if;
  if acc.wf_has_full_case_access(v_case.flow_id) then return true; end if;
  select * into v_flow from acc.flows where id=v_case.flow_id;

  -- An "All People" flow lets anyone trigger it, so the person who triggered a given case must
  -- always be able to see their own case even though they aren't a step owner on it.
  if v_flow.trigger_owner = '__ALL__'
     and lower(coalesce(v_case.created_by,'')) = lower(coalesce(v_email,'')) then
    return true;
  end if;

  -- Only a multi-person (varied) trigger-owner list is scoped this way - a single trigger owner
  -- already gets full access above.
  if v_flow.trigger_owner is not null and v_flow.trigger_owner <> '__ALL__'
     and position(',' in v_flow.trigger_owner) > 0
     and lower(coalesce(v_email,'')) = any(string_to_array(lower(v_flow.trigger_owner), ','))
     and lower(coalesce(v_case.created_by,'')) = lower(coalesce(v_email,'')) then
    return true;
  end if;

  -- Read-only observer of the WHOLE flow: every instance, regardless of who is holding it.
  if exists(
       select 1 from jsonb_array_elements(coalesce(v_flow.case_viewers,'[]'::jsonb)) v
       where lower(coalesce(v->>'viewer','')) = lower(coalesce(v_email,''))
         and upper(coalesce(v->>'watches','')) = '__ALL__'
         and acc.wf_viewer_entry_applies(v, v_case.trigger_details)
     ) then
    return true;
  end if;

  -- Read-only observer of ONE PERSON: this case is visible only because the person they watch
  -- holds or is offered a step on it - and the entry's only_when / unless allow this case.
  if exists(
       select 1
       from jsonb_array_elements(coalesce(v_flow.case_viewers,'[]'::jsonb)) v,
            acc.flow_case_steps cs
       where cs.case_id = p_case_id
         and lower(coalesce(v->>'viewer','')) = lower(coalesce(v_email,''))
         and coalesce(btrim(v->>'watches'),'') <> ''        -- an empty watch matches nobody
         and (lower(coalesce(cs.person,'')) = lower(btrim(v->>'watches'))
              or lower(btrim(v->>'watches')) = any(
                   select lower(x) from unnest(coalesce(cs.candidates,'{}')) x))
         and acc.wf_viewer_entry_applies(v, v_case.trigger_details)
     ) then
    return true;
  end if;

  -- Or they own/are offered a step specifically on THIS case, same as anyone else would.
  return exists(select 1 from acc.flow_case_steps cs
       where cs.case_id=p_case_id
         and (lower(coalesce(cs.person,''))=lower(coalesce(v_email,''))
              or lower(coalesce(v_email,'')) = any(select lower(x) from unnest(coalesce(cs.candidates,'{}')) x)));
end; $function$;

CREATE OR REPLACE FUNCTION acc.wf_visible_case_ids()
 RETURNS TABLE(case_id bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'acc', 'public'
AS $function$
  with me as (
    select lower(coalesce(app.current_user_email(), '')) as e
  ),

  -- BRANCH 1 - access to a whole FLOW, so every case in it: creator, sole trigger owner, extra
  -- admin, step owner, department viewer, or the hard-coded superuser.
  wide_flows as (
    select f.id
    from acc.flows f, me
    where me.e <> ''
      and acc.wf_has_full_case_access(f.id)
  ),

  -- BRANCH 4 - a case_viewers entry watching '__ALL__': every case its only_when / unless allow.
  all_watched as (
    select c.id
    from acc.flow_cases c
    join acc.flows f on f.id = c.flow_id
    join jsonb_array_elements(coalesce(f.case_viewers, '[]'::jsonb)) v on true,
         me
    where me.e <> ''
      and lower(coalesce(v->>'viewer', '')) = me.e
      and upper(coalesce(v->>'watches', '')) = '__ALL__'
      and acc.wf_viewer_entry_applies(v, c.trigger_details)
  ),

  -- BRANCH 2 + BRANCH 3 - I started this case, on a flow that lets me.
  started as (
    select c.id
    from acc.flow_cases c
    join acc.flows f on f.id = c.flow_id,
         me
    where me.e <> ''
      and lower(coalesce(c.created_by, '')) = me.e
      and (
        f.trigger_owner = '__ALL__'
        or (
          f.trigger_owner is not null
          and f.trigger_owner <> '__ALL__'
          and position(',' in f.trigger_owner) > 0
          and me.e = any(string_to_array(lower(f.trigger_owner), ','))
        )
      )
  ),

  -- BRANCH 5 - I am a read-only observer of ONE PERSON, that person holds or is offered a step on
  -- this case, and the entry's only_when / unless allow it.
  watched as (
    select distinct s.case_id
    from acc.flow_cases c
    join acc.flows f on f.id = c.flow_id
    join jsonb_array_elements(coalesce(f.case_viewers, '[]'::jsonb)) v on true
    join acc.flow_case_steps s on s.case_id = c.id,
         me
    where me.e <> ''
      and lower(coalesce(v->>'viewer', '')) = me.e
      and coalesce(btrim(v->>'watches'), '') <> ''
      and (
        lower(coalesce(s.person, '')) = lower(btrim(v->>'watches'))
        or lower(btrim(v->>'watches')) = any(
             select lower(x) from unnest(coalesce(s.candidates, '{}'::text[])) x
           )
      )
      and acc.wf_viewer_entry_applies(v, c.trigger_details)
  ),

  -- BRANCH 6 - I hold a step on this case, or I have been offered one.
  mine as (
    select distinct s.case_id
    from acc.flow_case_steps s
    join acc.flow_cases c on c.id = s.case_id,
         me
    where me.e <> ''
      and (
        lower(coalesce(s.person, '')) = me.e
        or exists (
             select 1 from unnest(coalesce(s.candidates, '{}'::text[])) cand
             where lower(cand) = me.e
           )
      )
  )

  select c.id from acc.flow_cases c join wide_flows w on w.id = c.flow_id
  union
  select id      from all_watched
  union
  select id      from started
  union
  select case_id from watched
  union
  select case_id from mine
$function$;

-- ---------------------------------------------------------------------------------------------
-- 2c. Invoice Processing: SUBHANKAR DAS's bills on Ayush's desk go to Akashnil, not Manash.
-- ---------------------------------------------------------------------------------------------
update acc.flows f
   set case_viewers = (
     select coalesce(jsonb_agg(
              case when lower(coalesce(v->>'viewer','')) = 'digitalmarketing@thejaingroup.com'
                    and lower(coalesce(v->>'watches','')) = 'system.admin@thejaingroup.com'
                   then v || '{"unless":{"label":"Vendor","in":["SUBHANKAR DAS"]}}'::jsonb
                   else v end), '[]'::jsonb)
       from jsonb_array_elements(coalesce(f.case_viewers,'[]'::jsonb)) v
     ) || case when exists(
              select 1 from jsonb_array_elements(coalesce(f.case_viewers,'[]'::jsonb)) v
               where lower(coalesce(v->>'viewer','')) = 'socialmedia@thejaingroup.com'
                 and lower(coalesce(v->>'watches','')) = 'system.admin@thejaingroup.com')
            then '[]'::jsonb
            else '[{"viewer":"socialmedia@thejaingroup.com","watches":"system.admin@thejaingroup.com","only_when":{"label":"Vendor","in":["SUBHANKAR DAS"]}}]'::jsonb
          end
 where f.id = 26;
