/* Reimbursement: the open claim stops the SUBMIT, not the button — so the next claim can still be
   written down and kept as a draft, and the refusal says what is actually in the way.

   WHAT WAS WRONG. Three versions of one rule, no two agreeing, and the best-worded one unreachable.

     - The page greyed out "New Reimbursement" outright. A greyed-out button opens no form, so the
       draft that was meant to be the escape hatch could not be reached at all: the person had
       nowhere to write the next claim down while they waited.
     - acc.wf_create_instance(bigint,jsonb,jsonb) — the overload the app actually calls — carried
       TWO guards of its own, and the broader one refused with "still in process. Raise a new one
       only after that is Done." That reads as "somebody else is sitting on it", which was wrong
       for every single person it was shown to: all eleven blocked when this was written were on
       "Payment Received", already paid, simply never having ticked it.
     - acc.wf_new_instance_block_reason — written precisely so the rule and its sentence could not
       drift — was only ever reached from the two-argument overload, which nothing calls. The
       migration that introduced it rewired one overload and silently skipped the other, so its
       wording has never been shown to anybody.

   WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT.
   The set of people blocked is UNCHANGED: a claim of yours that has moved past its first step, is
   not Done or Cancelled, and has not been sent back. What changes is that the form now opens, the
   refusal happens on submit, and the sentence is true — it names the claim, says where it has got
   to, and when that is the claimant's own confirmation step it says so plainly and tells them what
   to do about it.

   A SENT-BACK CLAIM DOES NOT BLOCK, and did not before either: returned_at has always been part of
   this rule. It is spelled out here because it is easy to mistake for an oversight. Rejecting the
   payment confirmation is the claimant doing their part — they have looked and said the money did
   not arrive — and holding their next claim hostage to a dispute they themselves raised is the
   opposite of what the rule is for. It is self-clearing: acc.wf_mark_returned_from_steps nulls
   returned_at the moment any step is forwarded again, so the claim starts blocking again as soon
   as it is genuinely back in motion.

   DRAFTS ARE UNTOUCHED, and that is now load-bearing rather than incidental. A draft goes straight
   to acc.flow_drafts and never passes through here, so a blocked person opens the form, fills it
   in, keeps it, and sends it the moment the old claim closes. The refusal says so.

   THE REFUSAL CARRIES SQLSTATE JE001 so the page can print the sentence on its own. Wrapped in the
   generic "Could not save reimbursement:" prefix it would contradict its own advice to save a
   draft. Every other failure keeps the prefix.

   Safe to run twice. */

-- ---------------------------------------------------------------------------------------------
-- 1. The rule and its wording, in one place, so the two cannot drift apart again.
-- ---------------------------------------------------------------------------------------------
create or replace function acc.wf_new_instance_block_reason(p_flow_id bigint, p_email text)
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
  v_noun := lower(coalesce(v_flow.instance_noun, 'instance'));

  /* The claim in the way: theirs, past its first step, not finished, not sent back. Unchanged from
     the rule this replaces, so nobody who could raise a claim yesterday is refused today. The
     oldest is named, because that is the one to clear first. */
  select fc.* into v_case
    from acc.flow_cases fc
   where fc.flow_id = p_flow_id
     and lower(coalesce(fc.created_by,'')) = lower(p_email)
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

  /* SITTING WITH THEM — the case this was all written for, and the only one where the refusal can
     be turned into an instruction. "Confirm payment" rather than the step's title because that is
     what the step means to the person reading it; a confirmation step that is not about payment
     falls back to its own title rather than saying something untrue. */
  if v_mine then
    return (case
              when v_title = '' or v_title ilike '%payment%'
                then format('Waiting for you to confirm payment on #%s — open it and mark it Done.', v_case.case_no)
                else format('Waiting for you on #%s at "%s" — open it and mark it Done.', v_case.case_no, v_title)
            end)
           || ' You can save this one as a draft in the meantime.';
  end if;

  /* WITH SOMEBODY ELSE: name them, so "why can't I?" is answered rather than guessed at. Only
     people with a real name are listed — a step offered to a group resolves to a mix of shared
     mailboxes and humans (HR Review is hr@, mgr.hr@ and one named person), and printing that mix
     gave three ways of saying HR, two of which are not a person you can go and ask. When nobody in
     the group has a name on file the clause is dropped and the step title carries it, which is
     what the reader needed anyway. */
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

comment on function acc.wf_new_instance_block_reason(bigint, text) is
  'Null when the person may raise a new instance of this flow, otherwise the sentence to show them. Blocks on their own unfinished instance past step 1; a sent-back one does not block. Drafts never reach this.';

comment on column acc.flows.one_open_instance_per_person is
  'While the raiser has an instance of this flow past step 1 that is not Done/Cancelled and has not been sent back, they cannot submit another. Drafts are unaffected. Rule and wording both live in acc.wf_new_instance_block_reason.';

-- ---------------------------------------------------------------------------------------------
-- 2. Point BOTH wf_create_instance overloads at it — the three-argument one being the whole point,
--    since that is the one the app calls and the one the previous attempt missed.
--
--    Edited in place rather than retyped: this is ~8,000 characters of live instance-creation
--    logic and a hand-copied replacement risks a silent slip somewhere unrelated to this change.
--    Everything outside the guards is preserved byte for byte, and the result is asserted below —
--    a surgery that does not take must fail loudly rather than leave the old rule quietly running,
--    which is the exact failure being repaired.
-- ---------------------------------------------------------------------------------------------
do $do$
declare
  v_oid    oid;
  v_src    text;
  v_new    text;
  v_guard  text;
  v_anchor text;
  v_missed text[] := '{}';
  v_nl     text := chr(10);
begin
  v_anchor := '    raise exception ''You are not allowed to start an instance of this workflow'';'
              || v_nl || '  end if;' || v_nl;

  v_guard :=
       v_nl
    || '  /* ONE OPEN INSTANCE AT A TIME — acc.wf_new_instance_block_reason both decides it and' || v_nl
    || '     words it, so the rule and the sentence the person reads cannot drift apart. Whether it' || v_nl
    || '     applies is a property of the flow (flows.one_open_instance_per_person), so it cannot' || v_nl
    || '     quietly stop a store hand filing their fifth bill of the morning. Drafts never come' || v_nl
    || '     through here, so a blocked person can still write the next one down and keep it.' || v_nl
    || '     JE001 tells the page to print the sentence on its own, with no "could not save" prefix' || v_nl
    || '     — which would contradict its own advice to save a draft. */' || v_nl
    || '  v_block_reason := acc.wf_new_instance_block_reason(p_flow_id, v_email);' || v_nl
    || '  if v_block_reason is not null then' || v_nl
    || '    raise exception using errcode = ''JE001'', message = v_block_reason;' || v_nl
    || '  end if;' || v_nl;

  for v_oid in
    select p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'acc' and p.proname = 'wf_create_instance'
     order by p.oid
  loop
    v_src := pg_get_functiondef(v_oid);

    /* Lift out every older guard. There are three shapes in the wild: the confirm_only one, the
       broader hardcoded flow-39 one that sat right after it, and the earlier rewiring (which
       raised without an errcode). An overload may carry any combination, including all of them. */
    v_new := regexp_replace(v_src,
               '  /\* ONE OPEN CLAIM AT A TIME\.(.|' || v_nl || ')*?v_block_no;' || v_nl || '  end if;' || v_nl, '');
    v_new := regexp_replace(v_new,
               '  /\* Reimbursement only: no new claim(.|' || v_nl || ')*?v_block_no;' || v_nl || '    end if;' || v_nl || '  end if;' || v_nl, '');
    v_new := regexp_replace(v_new,
               '  /\* ONE OPEN INSTANCE AT A TIME(.|' || v_nl || ')*?v_block_reason;' || v_nl || '  end if;' || v_nl, '');

    -- The variable the new guard needs, and away with the one it replaces.
    v_new := replace(v_new, 'v_block_no int;', '');
    if position('v_block_reason text;' in v_new) = 0 then
      v_new := regexp_replace(v_new, '(' || v_nl || 'declare )', '\1v_block_reason text; ');
    end if;

    /* A leftover reference would mean one of the patterns above matched only part of its guard —
       which compiles into a function that fails at call time, not here. Caught now instead. */
    if position('v_block_no' in v_new) > 0 then
      raise exception 'v_block_no still referenced in % after lifting the old guards', v_oid::regprocedure::text;
    end if;

    if position(v_anchor in v_new) = 0 then
      v_missed := v_missed || v_oid::regprocedure::text;
      continue;
    end if;
    v_new := replace(v_new, v_anchor, v_anchor || v_guard);

    execute v_new;
  end loop;

  if array_length(v_missed, 1) > 0 then
    raise exception 'wf_create_instance surgery found no permission-check anchor in: %',
      array_to_string(v_missed, ', ');
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------------------------
-- 3. Assert it took, on every overload. A rewiring that reports success while leaving the real
--    code path untouched is the bug this migration exists to fix; it does not get to happen twice.
-- ---------------------------------------------------------------------------------------------
do $do$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'acc' and p.proname = 'wf_create_instance'
  loop
    if position('wf_new_instance_block_reason' in r.def) = 0 then
      raise exception '% is still not using the shared block rule', r.sig;
    end if;
    if position('JE001' in r.def) = 0 then
      raise exception '% raises the block without the JE001 code the page keys off', r.sig;
    end if;
    if position('p_flow_id = 39' in r.def) > 0 then
      raise exception '% still carries a hardcoded flow-39 guard', r.sig;
    end if;
  end loop;
end;
$do$;
