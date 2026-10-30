/* ONE OPEN REIMBURSEMENT AT A TIME — now including the two states it used to miss.

   WHAT WAS WRONG.
   acc.wf_new_instance_block_reason already refused a second claim while one was open, and
   acc.wf_create_instance already raised it as JE001. But it only looked at claims that had moved
   PAST their first step, and it skipped claims that had been sent back for correction:

       and fc.current_step > 1
       and fc.returned_at is null

   So the two moments when a person is most likely to file twice were the two it let through:
     - the claim is sitting at step 1 and HR has not picked it up yet. It is still fully editable,
       so a second claim is never the right answer - the first one should be changed.
     - the claim was sent back to them for correction. Same thing: edit it, do not file another.
   Both now block, and both say to edit rather than to wait, because editing is what is actually
   available to them.

   WHAT THE PERSON READS.
   The message is no longer one sentence for every case. There are two kinds, and they ask for
   different things:
     kind 'edit'  the claim is still theirs to change   -> "Please edit the existing reimbursement"
     kind 'wait'  somebody else has it, or it is back
                  with them for a step of their own     -> who has it, which step, and how overdue
   A 'wait' message keeps the existing offer of a draft, so somebody whose claim is stuck at Audit
   for a week can still write the next one down. An 'edit' message does not: a draft there would be
   a second claim they do not need.

   ONE RULE, TWO SHAPES. wf_new_instance_block_info returns the whole decision as jsonb so the page
   can word a proper dialog (which claim, which step, whether to offer a draft) rather than parsing
   a sentence. wf_new_instance_block_reason now just reads ->>'message' off it, so the text the
   database refuses with and the text the dialog shows cannot drift apart - and wf_create_instance
   needs no change at all. */

create or replace function acc.wf_new_instance_block_info(
  p_flow_id bigint, p_email text, p_variant text default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'acc', 'public'
as $function$
declare
  v_flow acc.flows;
  v_case acc.flow_cases;
  v_step acc.flow_case_steps;
  v_noun text; v_title text; v_who text;
  v_mine boolean; v_received boolean;
  v_overdue int; v_when text;
  v_kind text; v_msg text; v_draft text;
begin
  if p_email is null or btrim(p_email) = '' then return null; end if;
  select * into v_flow from acc.flows where id = p_flow_id;
  if not found then return null; end if;
  if not coalesce(v_flow.one_open_instance_per_person, false) then return null; end if;

  /* Every open claim of theirs on this workflow, oldest first - no longer filtered by step or by
     whether it has been sent back. p_variant is accepted and deliberately unused: a Wow Moment and
     an ordinary claim share the one slot, which is what the variant was given to this flow for. */
  select fc.* into v_case
    from acc.flow_cases fc
   where fc.flow_id = p_flow_id
     and lower(coalesce(fc.created_by,'')) = lower(p_email)
     and coalesce(fc.status,'') not in ('Done','Cancelled')
   order by fc.case_no
   limit 1;
  if not found then return null; end if;

  v_noun := lower(coalesce(v_flow.variants -> v_case.variant ->> 'label', v_flow.instance_noun, 'instance'));

  -- the step it is actually sitting on: appeared for somebody and not yet passed on
  select fcs.* into v_step
    from acc.flow_case_steps fcs
   where fcs.case_id = v_case.id
     and fcs.appeared_at  is not null
     and fcs.forwarded_at is null
   order by fcs.seq
   limit 1;

  v_title    := coalesce(btrim(v_step.title), '');
  v_received := v_step.received_at is not null;
  v_mine     := v_step.id is not null
                and (lower(coalesce(v_step.person,'')) = lower(p_email)
                     or lower(p_email) = any(select lower(x) from unnest(coalesce(v_step.candidates,'{}')) x));

  -- whole days past due, at least 1 once it is past - "0 days overdue" reads as not overdue
  v_overdue := case when v_step.due_at is not null and v_step.due_at < now()
                    then greatest(1, floor(extract(epoch from (now() - v_step.due_at)) / 86400)::int)
               end;
  v_when := case
              when v_overdue is not null
                then format(', %s day%s overdue', v_overdue, case when v_overdue = 1 then '' else 's' end)
              when v_step.due_at is not null
                then format(', due %s', to_char(v_step.due_at at time zone 'Asia/Kolkata', 'DD Mon'))
              else '' end;

  /* WHOSE DESK IT IS ON, SAID BY NAME.
     This read adm.users.full_name, which is filled for 10 of 89 people; the names people actually
     have live in acc.user_profile.full_name, which has 87. So "with <name>" almost never appeared
     and the sentence trailed off after the step title. Profile first, adm.users second, and the
     local part of the address last - "with gyanprakash" beats saying nothing at all about who is
     holding somebody's money. */
  select string_agg(nm, ', ' order by nm) into v_who
    from (select distinct coalesce(nullif(btrim(p.full_name),''),
                                   nullif(btrim(u.full_name),''),
                                   split_part(e.email,'@',1)) as nm
            from unnest(case when coalesce(v_step.person,'') <> '' then array[v_step.person]
                             else coalesce(v_step.candidates, '{}'::text[]) end) as e(email)
            left join acc.user_profile p on lower(p.email) = lower(e.email)
            left join adm.users        u on lower(u.email) = lower(e.email)
           where coalesce(btrim(e.email),'') <> '') s;

  if v_case.returned_at is not null then
    /* Sent back for correction. current_step is reset to the first step for exactly this reason,
       so the claim is theirs to change and a new one would just abandon the correction. */
    v_kind := 'edit';
    v_msg  := format('Your %s #%s was sent back to you for correction. Please edit the existing %s instead of starting a new one.',
                     v_noun, v_case.case_no, v_noun);

  elsif v_case.current_step = 1 and not v_received then
    /* Filed, but nobody has accepted it yet - so it is still fully editable. This is the case the
       old rule let straight through, and the one people actually hit: they file, see nothing
       happen, and file again. */
    v_kind := 'edit';
    v_msg  := format('Your %s #%s has not been accepted%s yet, so it can still be changed. Please edit the existing %s instead of starting a new one.',
                     v_noun, v_case.case_no,
                     case when coalesce(v_who,'') <> '' then ' by '||v_who else '' end,
                     v_noun);

  elsif v_mine then
    -- back with them for a step of their own; the last step of a claim is confirming payment
    v_kind  := 'wait';
    v_msg   := case when v_title = '' or v_title ilike '%payment%'
                    then format('Waiting for you to confirm payment on #%s%s — open it and mark it Done.', v_case.case_no, v_when)
                    else format('Waiting for you on #%s at "%s"%s — open it and mark it Done.', v_case.case_no, v_title, v_when)
               end;
    v_draft := ' You can save this one as a draft in the meantime.';

  else
    v_kind  := 'wait';
    v_msg   := format('Your %s #%s has not finished yet%s%s%s.',
                      v_noun, v_case.case_no,
                      case when v_title <> '' then format(' — it is at "%s"', v_title) else '' end,
                      case when coalesce(v_who,'') <> '' then format(', with %s', v_who) else '' end,
                      v_when);
    v_draft := format(' You can save this one as a draft and send it once #%s is closed.', v_case.case_no);
  end if;

  if v_kind = 'wait' and coalesce(v_flow.allow_drafts, false) then
    v_msg := v_msg || coalesce(v_draft, '');
  end if;

  return jsonb_build_object(
    'kind',         v_kind,
    'case_id',      v_case.id,
    'case_no',      v_case.case_no,
    'noun',         v_noun,
    'step',         nullif(v_title, ''),
    'who',          v_who,
    'overdue_days', v_overdue,
    'can_draft',    (v_kind = 'wait' and coalesce(v_flow.allow_drafts, false)),
    'message',      v_msg);
end;
$function$;
grant execute on function acc.wf_new_instance_block_info(bigint, text, text) to authenticated;

/* The sentence alone, for acc.wf_create_instance's JE001 refusal. Reads it off the decision above
   rather than deciding again, so the database and the dialog can never disagree about either
   whether somebody is blocked or why. */
create or replace function acc.wf_new_instance_block_reason(
  p_flow_id bigint, p_email text, p_variant text)
 returns text
 language sql
 stable security definer
 set search_path to 'acc', 'public'
as $function$
  select acc.wf_new_instance_block_info(p_flow_id, p_email, p_variant) ->> 'message';
$function$;
grant execute on function acc.wf_new_instance_block_reason(bigint, text, text) to authenticated;
