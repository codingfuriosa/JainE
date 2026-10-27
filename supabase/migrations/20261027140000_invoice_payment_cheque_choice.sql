-- INVOICE PROCESSING: A PAYMENT BILL IS ALSO GIVEN CHEQUE / NO CHEQUE AT RTP (27 Oct 2026, as asked).
--
-- Until now a bill Arun Pandey sent down the Payment route reached Gyan Prakash Sah's RTP step with
-- only a Forward button, and went RTP -> Cheque Preparation -> Bill Checking -> Audit -> Bill Filing.
-- Now RTP asks Cheque or No Cheque on a Payment bill too, and the two answers are their own paths:
--   Payment + Cheque     : RTP -> Cheque Preparation (Arun) -> Bill Checking (Soumyadeep)
--                          -> Audit Checking (Sandeep) -> Cheque Signing (Shafat) -> Bill Filing (Tapan)
--   Payment + No Cheque  : RTP -> Booking Entry (Arun Pandey / Bachchu Samanta) -> Bill Checking
--                          -> Audit Checking -> Bill Filing
-- Booking Entry is a new step, seq 13, used ONLY by the No Cheque payment path: route_only keeps it
-- from being created on any bill whose route does not name it, so an ordinary bill standing at Bill
-- Filing (the old last step) still closes there instead of finding a step 13 after it.
-- Bills already past RTP on the old Payment path keep the path they were given.

alter table acc.flow_steps add column if not exists route_only boolean not null default false;

insert into acc.flow_steps (flow_id, seq, title, owner_emails, duration_value, duration_unit, method, route_only)
select 26, 13, 'Booking Entry', array['accounts2@thejaingroup.com','accounts5@thejaingroup.com'], 2, 'days', 'ERP', true
 where not exists (select 1 from acc.flow_steps where flow_id = 26 and seq = 13);

-- The interim Payment route (chosen at Bill Booking) now only says "RTP next".
update acc.flow_routes set seqs = array[1,2,5,7,3,4,12], skipped = array[6,8,9,10,11,13]
 where flow_id = 26 and route = 'payment';
update acc.flow_routes set skipped = array(select distinct unnest(skipped || array[13]) order by 1)
 where flow_id = 26 and route in ('cheque','no_cheque');

insert into acc.flow_routes (flow_id, route, label, seqs, skipped, chosen_at_seq, sort)
select 26, 'payment_cheque', 'Payment · Cheque', array[1,2,5,7,3,4,9,12], array[6,8,10,11,13], 5, 4
 where not exists (select 1 from acc.flow_routes where flow_id = 26 and route = 'payment_cheque');
insert into acc.flow_routes (flow_id, route, label, seqs, skipped, chosen_at_seq, sort)
select 26, 'payment_no_cheque', 'Payment · No Cheque', array[1,2,5,13,3,4,12], array[6,7,8,9,10,11], 5, 5
 where not exists (select 1 from acc.flow_routes where flow_id = 26 and route = 'payment_no_cheque');

-- Bills already on Cheque / No Cheque show Booking Entry as "NA", like the other bypassed steps.
update acc.flow_cases set skipped_seqs = array(select distinct unnest(coalesce(skipped_seqs,'{}') || array[13]) order by 1)
 where flow_id = 26 and route in ('cheque','no_cheque') and not (13 = any(coalesce(skipped_seqs,'{}')));

create or replace function acc.wf_materialise_steps(p_case_id bigint)
 returns integer language plpgsql security definer set search_path to 'acc', 'public' as $function$
declare v_flow bigint; v_creator text; v_added integer; v_skipped int[]; v_route int[];
begin
  select flow_id, created_by, coalesce(skipped_seqs,'{}'::int[]), coalesce(route_seqs,'{}'::int[])
    into v_flow, v_creator, v_skipped, v_route
    from acc.flow_cases where id=p_case_id;
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
     and not exists(select 1 from acc.flow_case_steps y where y.case_id=p_case_id and y.seq=st.seq)
     -- A seq this instance deliberately bypassed (e.g. the No-Cheque path skipping the cheque
     -- steps) never comes back just because its row is missing - that would otherwise look
     -- identical to the exact gap this function exists to close.
     and not (st.seq = any(v_skipped))
     -- A step only some routes use (Booking Entry) exists only on a bill whose route names it.
     and not (coalesce(st.route_only,false) and not (st.seq = any(v_route)));

  get diagnostics v_added = row_count;
  return v_added;
end; $function$;

create or replace function acc.wf_forward_rtp_cheque_choice(p_fcs_id bigint, p_cheque boolean)
 returns void language plpgsql security definer set search_path to 'acc', 'public' as $function$
declare v_email text := app.current_user_email(); v acc.flow_case_steps; v_flow_id bigint; v_route text;
begin
  select * into v from acc.flow_case_steps where id=p_fcs_id;
  if not found then raise exception 'step not found'; end if;
  if not acc.wf_may_act_as(v.person, v_email, (select flow_id from acc.flow_cases where id=v.case_id))
    then raise exception 'not your step'; end if;

  select flow_id, route into v_flow_id, v_route from acc.flow_cases where id=v.case_id;
  if v_flow_id is distinct from 26 or v.seq is distinct from 5 then
    raise exception 'The Cheque / No Cheque choice only applies to the RTP / Schedule Payment step of Invoice Processing';
  end if;

  -- A Payment bill (chosen at Bill Booking) keeps to the Payment paths; any other bill to the
  -- ordinary ones. Asked again after a send-back, the new answer simply replaces the old.
  if v_route like 'payment%' then
    perform acc.wf_apply_route(v.case_id, case when p_cheque then 'payment_cheque' else 'payment_no_cheque' end);
  else
    perform acc.wf_apply_route(v.case_id, case when p_cheque then 'cheque' else 'no_cheque' end);
  end if;
  perform acc.wf_forward(p_fcs_id);
end; $function$;
