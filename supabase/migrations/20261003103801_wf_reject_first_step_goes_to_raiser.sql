/* Send back, from the FIRST step, returns the instance to whoever raised it — and says so.

   (Applied in two passes on 3 Oct 2026, recorded as 20261003103431 and 20261003103801. This file
   is the finished state; replaying it alone gets you there.)

   WHAT WAS WRONG. "Send back" holds the instance with whoever pressed it: it marks the case
   returned-for-correction and leaves the step exactly where it was. On a middle step that is the
   intended behaviour — you are objecting, and you keep it until the person before you fixes it.
   On the FIRST step there is nobody before you, so the button re-stamped the same row and changed
   nothing at all. The person holding it had no way to get it off their desk.

   This is not theoretical. Invoice Processing bill 415 was raised with "Dept Check" pointed at the
   wrong department; the holder pressed Send back nine times over two days, and the case record
   shows returned_by and returned_to as the same person every time. It had to be moved by hand.

   WHAT IT DOES NOW. From the first step, Send back hands the instance to flow_cases.created_by —
   the only "back" that exists there — as a fresh, unreceived step in their queue, with the task
   moved across so it leaves the sender's list. Every later step is untouched: holding it yourself
   is deliberate there and is what people now expect.

   WHEN THE RAISER IS ALREADY HOLDING IT, nothing moves — it is already as far back as it goes.
   The case is still marked returned so the reason is recorded and the instance reads as needing
   correction, which is the useful half of what the button did before.

   THE FIRST STEP IS READ FROM THE CASE'S OWN MATERIALISED STEPS, not from the flow definition: a
   flow can be edited after an instance is created, and what matters is the first step THIS
   instance actually has. accountability.js decides the same way, for the same reason.

   IT RETURNS WHERE IT WENT. The page used to print "it is with you as a received task" every time,
   because that was always true. Rather than have the page work the destination out a second time —
   a copy of this rule that can drift from it, which is exactly how the old "it went to the previous
   person" message came to be wrong — the function returns the raiser's display name, or null when
   it stayed put. That is why both overloads are dropped and recreated rather than replaced: the
   return type changes from void to text. Nothing in the database consumes the result, and all four
   call sites in accountability.js ignored it until now. */

drop function if exists acc.wf_reject(bigint, text);
drop function if exists acc.wf_reject(bigint);

create function acc.wf_reject(p_fcs_id bigint, p_reason text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
       should have to pick it up like anything else that lands. */
    update acc.flow_case_steps
       set person      = v_raiser,
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

create function acc.wf_reject(p_fcs_id bigint)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return acc.wf_reject(p_fcs_id, null::text);
end; $function$;

grant execute on function acc.wf_reject(bigint)       to authenticated, anon;
grant execute on function acc.wf_reject(bigint, text) to authenticated;
