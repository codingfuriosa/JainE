/* The JainE id was riding on flow_cases.case_no, which is NOT a stable identity — wf_delete_cases
   deliberately closes the gap left by a deletion by renumbering every remaining case_no 1..N (that
   is exactly how the 117 deleted bills left the 2 survivors sitting at case_no 1 and 2). Pegging the
   JainE id to case_no means it would silently reshuffle, and even repeat, on the next deletion —
   the opposite of "unique for every instance".

   jaine_id is a separate column, assigned once at creation and never touched by that renumbering,
   picking up at 118 to continue the count the deleted 117 bills left off rather than restarting at 1. */

alter table acc.flow_cases add column if not exists jaine_id integer;

with ordered as (
  select id, row_number() over (order by case_no) as rn
  from acc.flow_cases where flow_id = 26
)
update acc.flow_cases fc set jaine_id = 117 + ordered.rn
  from ordered where fc.id = ordered.id and fc.jaine_id is null;

create unique index if not exists flow_cases_jaine_id_uniq on acc.flow_cases(jaine_id) where jaine_id is not null;

create or replace function acc.wf_create_instance(p_flow_id bigint, p_details jsonb, p_step_members jsonb DEFAULT NULL::jsonb)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'acc', 'public'
as $function$
declare v_email text := app.current_user_email(); v_flow acc.flows; v_caseno int; v_jaine int; v_case_id bigint;
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
     and fcs.appeared_at  is not null
     and fcs.forwarded_at is null
     and coalesce(fc.status,'') not in ('Done','Cancelled')
     and (lower(coalesce(fcs.person,'')) = lower(v_email)
          or lower(v_email) = any(select lower(x) from unnest(coalesce(fcs.candidates,'{}')) x))
   order by fc.case_no limit 1;
  if v_block_no is not null then
    raise exception 'Your % #% is waiting for you to confirm the payment. Open it and mark it Done, or Reject it back to Accounts, before raising another.',
      lower(coalesce(v_flow.instance_noun,'instance')), v_block_no;
  end if;

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
  if p_flow_id = 26 then
    select coalesce(max(jaine_id),117)+1 into v_jaine from acc.flow_cases where flow_id=26;
  end if;
  insert into acc.flow_cases(flow_id, title, trigger_details, case_no, jaine_id, current_step, status, created_by)
    values(p_flow_id, coalesce(v_flow.trigger_event, v_flow.name), coalesce(p_details,'[]'::jsonb), v_caseno, v_jaine, 1, 'Pending', v_email)
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

create or replace function acc.wf_task_desc_invoice(p_case_no int, p_details jsonb)
 returns text
 language sql
 stable
 set search_path to 'acc', 'public'
as $function$
  with order_list(label, ord) as (
    values ('Bill No.',1), ('Bill Date',2), ('Company',3), ('Amount',4)
  ),
  vals as (
    select d->>'label' as label, btrim(d->>'value') as value
      from jsonb_array_elements(coalesce(p_details,'[]'::jsonb)) d
  ),
  keep as (
    select o.ord,
           case when v.value ~ '^\d{4}-\d{2}-\d{2}$'
                then substr(v.value,9,2)||'-'||substr(v.value,6,2)||'-'||substr(v.value,1,4)
                else v.value end as value
      from order_list o join vals v on v.label = o.label
     where coalesce(v.value,'') <> ''
  )
  select 'J'||p_case_no::text || coalesce((select ' · '||string_agg(value,' · ' order by ord) from keep), '');
$function$;

create or replace function acc.ptask_desc_from_flow()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'acc', 'public'
as $function$
declare v_flow acc.flows; v_case acc.flow_cases; v_txt text;
begin
  if new.flow_case_step_id is null then return new; end if;   -- an ordinary task, left alone
  select fc.* into v_case from acc.flow_case_steps x join acc.flow_cases fc on fc.id = x.case_id
   where x.id = new.flow_case_step_id;
  if not found then return new; end if;
  select * into v_flow from acc.flows where id = v_case.flow_id;
  if not found then return new; end if;

  if v_flow.id = 26 then
    v_txt := acc.wf_task_desc_invoice(v_case.jaine_id, v_case.trigger_details);
  elsif v_flow.task_fields is not null then      -- only flows that state an order; everyone else unchanged
    v_txt := acc.wf_task_desc(v_flow.id, v_case.trigger_details);
  else
    return new;
  end if;

  if coalesce(btrim(v_txt),'') <> '' then new.description := v_txt; end if;
  return new;
end; $function$;

-- Re-stamp already-created Invoice Processing task descriptions with the new jaine_id-based numbering.
update acc.ptasks p
   set description = acc.wf_task_desc_invoice(fc.jaine_id, fc.trigger_details)
  from acc.flow_case_steps x
  join acc.flow_cases fc on fc.id = x.case_id
 where p.flow_case_step_id = x.id
   and fc.flow_id = 26
   and coalesce(btrim(acc.wf_task_desc_invoice(fc.jaine_id, fc.trigger_details)),'') <> '';
