-- Reimbursement: the person who raised the claim confirms the money arrived.
--
-- Until now the chain ended at Accounts: they paid and forwarded, and the instance closed on their
-- word alone. Nobody ever asked the one person who actually knows whether the money landed. This
-- adds a third step that goes back to the claimant, answered with Done or Reject only, and it is
-- the claimant who now closes their own claim.
--
-- Two new step capabilities carry it, both generic rather than Reimbursement-specific, because a
-- step owned by whoever raised the instance and a step answered yes/no are ordinary shapes that
-- other workflows will want.

alter table acc.flow_steps add column if not exists owner_is_creator boolean not null default false;
alter table acc.flow_steps add column if not exists confirm_only     boolean not null default false;

comment on column acc.flow_steps.owner_is_creator is
  'This step belongs to whoever raised the instance, resolved at run time from flow_cases.created_by. '
  'Unlike owner_from_trigger it asks the form for nobody - the raiser is already known.';
comment on column acc.flow_steps.confirm_only is
  'This step is answered with Done or Reject only - no forward, no reassign, no reason box. '
  'Reject sends it back one step, to the person who handed it over.';

-- ---------------------------------------------------------------------------
-- Remembered phone numbers, exactly as UPI ids are remembered.
-- Same shape, same policy, same counting, so the field behaves the way people already expect the
-- UPI box to behave: type it once, pick it from the list every time after.
-- ---------------------------------------------------------------------------
create table if not exists acc.user_phone(
  email     text        not null,
  phone     text        not null,
  uses      integer     not null default 1,
  last_used timestamptz not null default now(),
  primary key(email, phone)
);
alter table acc.user_phone enable row level security;
do $pol$
begin
  if not exists(select 1 from pg_policy where polrelid='acc.user_phone'::regclass and polname='phone_all') then
    create policy phone_all on acc.user_phone for all using(true) with check(true);
  end if;
end $pol$;
grant select, insert, update, delete on acc.user_phone to authenticated, service_role;

create or replace function acc.phone_remember(p_phone text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_email text := app.current_user_email();
begin
  if v_email is null or coalesce(btrim(p_phone),'')='' then return; end if;
  insert into acc.user_phone(email, phone, uses, last_used)
  values (lower(v_email), btrim(p_phone), 1, now())
  on conflict (email, phone) do update
    set uses = acc.user_phone.uses + 1, last_used = now();
end; $function$;
grant execute on function acc.phone_remember(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Creating an instance: resolve an owner_is_creator step to the raiser, and refuse to open a new
-- instance while that person still owes an answer on an earlier one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION acc.wf_create_instance(p_flow_id bigint, p_details jsonb, p_step_members jsonb DEFAULT NULL::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'acc', 'public'
AS $function$
declare v_email text := app.current_user_email(); v_flow acc.flows; v_caseno int; v_case_id bigint;
        v_first acc.flow_case_steps; v_due timestamptz; v_task_id bigint; v_is_member boolean; c text;
        v_trig_ok boolean; v_distinguish text; v_allowed text[]; v_may_assign_anyone boolean;
        v_block_no int;
begin
  if v_email is null then raise exception 'not signed in'; end if;
  select * into v_flow from acc.flows where id=p_flow_id;
  if not found then raise exception 'workflow not found'; end if;
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

  /* ONE OPEN CLAIM AT A TIME.
     A confirm_only step is the raiser's own to close, and a claim sitting unanswered there is the
     one thing nobody else can move on their behalf. So while that step is with them they cannot
     open another instance of the same workflow - a growing queue of unclosed claims is exactly what
     this prevents - and the message names the one to deal with rather than simply refusing.
     Deliberately scoped to THIS flow: an unclosed Reimbursement must not block an Invoice. */
  select fc.case_no into v_block_no
    from acc.flow_case_steps fcs
    join acc.flow_cases fc on fc.id = fcs.case_id
    join acc.flow_steps  st on st.flow_id = fc.flow_id and st.seq = fcs.seq
   where fc.flow_id = p_flow_id
     and coalesce(st.confirm_only,false)
     and fcs.appeared_at  is not null      -- it has actually reached them
     and fcs.forwarded_at is null          -- and they have not answered it
     and coalesce(fc.status,'') not in ('Done','Cancelled')
     and (lower(coalesce(fcs.person,'')) = lower(v_email)
          or lower(v_email) = any(select lower(x) from unnest(coalesce(fcs.candidates,'{}')) x))
   order by fc.case_no limit 1;
  if v_block_no is not null then
    raise exception 'Your % #% is waiting for you to confirm the payment. Open it and mark it Done, or Reject it back to Accounts, before raising another.',
      lower(coalesce(v_flow.instance_noun,'instance')), v_block_no;
  end if;

  /* A flow can restrict who its "decided per instance" steps may be handed to - Invoice Processing's
     bill raisers may only ever name the two named people. Checked here, not just hidden in the form,
     since this is the real gate.
     Systems and the Administrator are exempt: the restriction exists to stop the people raising
     bills day to day from sending one astray, and those are the people called on to put it right.
     Uma Chatterjee (frontoffice@thejaingroup.com) is a named exemption too: she is a trigger owner on
     Invoice Processing but not day-to-day store staff, and her own step-owner picker is meant to offer
     everyone, matching accountability.js's matching client-side exemption.
     accountability.js offers them the full list to match, so refusing them here would only produce a
     form offering a choice the database then rejects. */
  v_may_assign_anyone := app.is_superadmin()
    or lower(v_email) = 'frontoffice@thejaingroup.com'
    or exists(select 1 from adm.users u
               where lower(u.email)=lower(v_email)
                 and u.department && array['Systems']::text[]);
  if v_flow.trigger_step_assignable_to is not null and btrim(v_flow.trigger_step_assignable_to)<>''
     and not v_may_assign_anyone then
    v_allowed := (select array_agg(lower(btrim(x))) from unnest(string_to_array(v_flow.trigger_step_assignable_to,',')) x where btrim(x)<>'');
    if exists(
      select 1 from jsonb_each(coalesce(p_step_members,'{}'::jsonb)) kv
      cross join lateral jsonb_array_elements_text(kv.value) e
      where btrim(e)<>'' and not (lower(btrim(e)) = any(v_allowed))
    ) then
      raise exception 'You can only assign these steps to: %', v_flow.trigger_step_assignable_to;
    end if;
  end if;

  select coalesce(max(case_no),0)+1 into v_caseno from acc.flow_cases where flow_id=p_flow_id;
  insert into acc.flow_cases(flow_id, title, trigger_details, case_no, current_step, status, created_by)
    values(p_flow_id, coalesce(v_flow.trigger_event, v_flow.name), coalesce(p_details,'[]'::jsonb), v_caseno, 1, 'Pending', v_email)
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
        -- The raiser's own step. Nobody had to be named for it: it was always going to be them,
        -- which is why this comes first and no form field feeds it.
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

-- ---------------------------------------------------------------------------
-- Forwarding onto an owner_is_creator step: hand it to whoever raised the instance.
-- This is the branch that actually matters in practice - the confirmation step is only ever armed
-- by Accounts forwarding, never at creation time.
-- ---------------------------------------------------------------------------
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
  update acc.flow_case_steps set forwarded_at=now(), status='done', received_at=coalesce(received_at, now()) where id=p_fcs_id;
  select * into nxt from acc.flow_case_steps where case_id=v.case_id and seq>v.seq order by seq limit 1;
  has_next := found;
  if v.task_id is not null then
    update acc.ptasks set status='Awaiting Approval', approval_state='awaiting_approval', progress=100,
           completed_at=now(), approved_at=null, approved_by=null where id=v.task_id;
  end if;
  if has_next then
    select f.* into v_flow from acc.flows f join acc.flow_cases fc on fc.flow_id=f.id where fc.id=v.case_id;

    -- FUTURE-STEP EDITS: as the next step becomes active, re-read its people / name / duration from
    -- the LIVE definition, matched by SEQ (step ids are rewritten on every workflow edit, so seq is
    -- the stable key). Steps already reached are never touched.
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
    -- Distinguishing text: the first non-empty detail value whose field isn't a Date/Attachment,
    -- so tasks for the same workflow read as more than a repeated generic name.
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

-- ---------------------------------------------------------------------------
-- Reimbursement (flow 39) itself: the third step, and a mandatory phone number on the form.
-- ---------------------------------------------------------------------------

-- Step 3. No overdue: the claimant is not late for a payment that may not have been made yet, and
-- the block on raising another claim is what actually compels them to answer.
insert into acc.flow_steps(flow_id, seq, title, description, duration_value, duration_unit,
                           owner_is_creator, confirm_only, no_overdue)
select 39, 3, 'Payment Received',
       'Confirm the money reached you. Mark it Done once it is in your account, or Reject it back to Accounts if nothing arrived or the amount is wrong.',
       1, 'day', true, true, true
where not exists(select 1 from acc.flow_steps where flow_id=39 and seq=3);

/* The claims already in flight get the step too.
   flow_case_steps is a SNAPSHOT taken when an instance is created, so adding a step to the
   definition reaches new claims only. Every open claim is sitting at Accounts right now, and
   without this they would each find no step after Accounts, close on the old rule, and the whole
   change would apply to nothing anyone has actually filed. The step is inserted dormant -
   appeared_at null, no task - exactly as creation leaves a step that has not been reached; the
   forward from Accounts arms it. */
insert into acc.flow_case_steps(case_id, step_id, seq, title, person, candidates,
                                duration_value, duration_unit, description, status)
select fc.id, st.id, st.seq, st.title,
       fc.created_by, array[fc.created_by],
       st.duration_value, st.duration_unit, st.description, 'pending'
  from acc.flow_cases fc
  join acc.flow_steps st on st.flow_id=39 and st.seq=3
 where fc.flow_id = 39
   and coalesce(fc.status,'') not in ('Done','Cancelled')
   and coalesce(fc.created_by,'') <> ''
   and not exists(select 1 from acc.flow_case_steps x where x.case_id=fc.id and x.seq=3);

-- Phone Number, sitting with the other two remembered payment details and mandatory like the rest
-- of the claim. Placed second so it reads UPI Id, Phone Number, QR Code - the ways of reaching and
-- paying a person, together, before the expense itself starts.
update acc.flows
   set trigger_template = jsonb_insert(trigger_template, '{1}', jsonb_build_object(
         'type','text', 'label','Phone Number', 'common', true, 'phoneMemory', true,
         'placeholder','10-digit mobile number', 'pattern','^[0-9]{10}$'))
 where id=39
   and not exists(select 1 from jsonb_array_elements(trigger_template) d where d->>'label'='Phone Number');
