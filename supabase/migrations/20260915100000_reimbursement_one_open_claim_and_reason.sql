/* Reimbursement: one open claim at a time, and a refusal that says where the open one has got to.

   WHAT CHANGED.
   Until now a claim only blocked the next one while it sat on the raiser's OWN confirm_only step
   ("Payment Received"). So somebody could raise a second, third and fourth claim quite happily as
   long as the earlier ones were still with HR or Accounts, and the queue only ever showed up at the
   very end. The rule is now the plain one people expected: while you have a reimbursement that is
   not finished, you cannot raise another.

   WHY IT IS A FLAG AND NOT AN `if p_flow_id = 39`.
   The same function creates bills, challans and booking forms, and those are filed in batches all
   day - a store hand records five bills in a morning. Broadening the rule unconditionally would
   have stopped them dead. flows.one_open_instance_per_person says which workflows want it; only
   Reimbursement is switched on.

   DRAFTS ARE DELIBERATELY UNTOUCHED.
   A draft is written straight to acc.flow_drafts by the form and never passes through
   wf_create_instance, so it is unaffected by anything here - which is exactly what was asked for.
   Somebody who cannot submit can still write the next claim down, keep it, and send it the moment
   the open one closes. acc.flow_drafts' own RLS already allows a person their own drafts with no
   reference to their open instances, so nothing needed loosening to make that true.

   THE MESSAGE NAMES THE REASON.
   A bare refusal reads as a bug. The message now says which claim is in the way, which step it is
   sitting at, and - the case this was asked for - whether it is sitting with THEM, in which case it
   tells them to go and deal with it. If it is with somebody else it names who, so the answer to
   "why can't I?" is on screen instead of being guessed at.

   Safe to run twice: the column, the function and the rewiring are each guarded. */

-- ---------------------------------------------------------------------------------------------
-- 1. Which workflows want the rule.
-- ---------------------------------------------------------------------------------------------
alter table acc.flows
  add column if not exists one_open_instance_per_person boolean not null default false;

comment on column acc.flows.one_open_instance_per_person is
  'While the raiser has an instance of this flow that is not Done/Cancelled, they cannot create another. Drafts are unaffected.';

update acc.flows set one_open_instance_per_person = true where id = 39;

-- ---------------------------------------------------------------------------------------------
-- 2. The rule and its wording in one place, so the two cannot drift apart.
--    Returns null when the person may go ahead, otherwise the sentence to show them.
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
  v_where text;
  v_mine  boolean;
  v_who   text;
begin
  if p_email is null or btrim(p_email) = '' then return null; end if;
  select * into v_flow from acc.flows where id = p_flow_id;
  if not found then return null; end if;
  v_noun := lower(coalesce(v_flow.instance_noun, 'instance'));

  if coalesce(v_flow.one_open_instance_per_person, false) then
    /* Anything they raised that has not finished - wherever it currently sits. The oldest one is
       the one named, because that is the one they should clear first. */
    select fc.* into v_case
      from acc.flow_cases fc
     where fc.flow_id = p_flow_id
       and lower(coalesce(fc.created_by,'')) = lower(p_email)
       and coalesce(fc.status,'') not in ('Done','Cancelled')
     order by fc.case_no
     limit 1;
  else
    /* Unchanged for every other workflow: only their own confirm_only step blocks, because that
       is the one nobody else can clear on their behalf. */
    select fc.* into v_case
      from acc.flow_case_steps fcs
      join acc.flow_cases fc on fc.id = fcs.case_id
      join acc.flow_steps  st on st.flow_id = fc.flow_id and st.seq = fcs.seq
     where fc.flow_id = p_flow_id
       and coalesce(st.confirm_only,false)
       and fcs.appeared_at  is not null
       and fcs.forwarded_at is null
       and coalesce(fc.status,'') not in ('Done','Cancelled')
       and (lower(coalesce(fcs.person,'')) = lower(p_email)
            or lower(p_email) = any(select lower(x) from unnest(coalesce(fcs.candidates,'{}')) x))
     order by fc.case_no
     limit 1;
  end if;
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
  v_where := case when v_title <> '' then format(' at "%s"', v_title) else '' end;

  v_mine := v_step.id is not null
            and (lower(coalesce(v_step.person,'')) = lower(p_email)
                 or lower(p_email) = any(select lower(x) from unnest(coalesce(v_step.candidates,'{}')) x));

  /* Sitting with them. This is the case worth spelling out - the thing standing in their way is
     their own to clear, and saying so turns a refusal into an instruction. */
  if v_mine then
    return format(
      'Your %s #%s is waiting on you%s — that is what is stopping this one. Open #%s and finish it '
      || '(forward it, or mark it Done), then you can submit this. You can save this one as a draft in the meantime.',
      v_noun, v_case.case_no, v_where, v_case.case_no);
  end if;

  /* With somebody else: name them, so "why can't I?" is answered rather than left to be guessed.
     Only people with a real name are listed. A step offered to a group resolves to a mix of shared
     mailboxes and humans (HR Review is hr@, mgr.hr@ and one named person), and printing that mix
     gave "it is with hr@thejaingroup.com, mgr.hr@thejaingroup.com, Uzma Ahmed" — three ways of
     saying HR, two of which are not a person you can go and ask. When nobody in the group has a
     name on file the clause is dropped entirely and the step title carries it, which is what the
     reader needed anyway. */
  select string_agg(nm, ', ' order by nm) into v_who
    from (select distinct nullif(btrim(u.full_name),'') as nm
            from unnest(case when coalesce(v_step.person,'') <> '' then array[v_step.person]
                             else coalesce(v_step.candidates, '{}'::text[]) end) as e(email)
            join adm.users u on lower(u.email) = lower(e.email)
           where nullif(btrim(u.full_name),'') is not null) s;

  return format(
    'Your %s #%s has not finished yet%s%s, so this one cannot be submitted alongside it. '
    || 'Save it as a draft now and send it once #%s is closed.',
    v_noun, v_case.case_no, v_where,
    case when coalesce(v_who,'') <> '' then format(' — it is with %s', v_who) else '' end,
    v_case.case_no);
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- 3. Point both wf_create_instance overloads at it.
--
--    Done by editing the stored definition rather than retyping the function: it is ~7,700
--    characters of live workflow-creation logic, and a hand-copied replacement would risk a silent
--    transcription slip somewhere in the part that has nothing to do with this change. Everything
--    outside the guard is preserved byte for byte.
--
--    Both overloads are rewired. The app only ever calls the three-argument one, but the
--    two-argument overload is just as reachable through PostgREST and had no guard at all - so
--    left alone it would have been a way round the rule.
-- ---------------------------------------------------------------------------------------------
do $do$
declare
  v_oid    oid;
  v_src    text;
  v_new    text;
  v_guard  text;
  v_anchor text;
  v_done   int := 0;
begin
  v_anchor := '    raise exception ''You are not allowed to start an instance of this workflow'';'
              || chr(10) || '  end if;' || chr(10);

  v_guard :=
       chr(10)
    || '  /* ONE OPEN INSTANCE AT A TIME — acc.wf_new_instance_block_reason both decides it and' || chr(10)
    || '     words it, so the rule and the sentence the person reads cannot drift apart. Whether it' || chr(10)
    || '     applies is a property of the flow (flows.one_open_instance_per_person), so switching it' || chr(10)
    || '     on for Reimbursement cannot quietly stop a store hand filing their fifth bill of the' || chr(10)
    || '     morning. Drafts never come through here, so a blocked person can still write the next' || chr(10)
    || '     one down and keep it. */' || chr(10)
    || '  v_block_reason := acc.wf_new_instance_block_reason(p_flow_id, v_email);' || chr(10)
    || '  if v_block_reason is not null then' || chr(10)
    || '    raise exception ''%'', v_block_reason;' || chr(10)
    || '  end if;' || chr(10);

  for v_oid in
    select p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'acc' and p.proname = 'wf_create_instance'
  loop
    v_src := pg_get_functiondef(v_oid);
    continue when position('wf_new_instance_block_reason' in v_src) > 0;   -- already rewired

    -- (a) lift out the old confirm_only-only guard, where one exists
    v_new := regexp_replace(
               v_src,
               chr(10) || '  /\* ONE OPEN CLAIM AT A TIME\..*?v_block_no;' || chr(10) || '  end if;' || chr(10),
               chr(10));

    -- (b) declare the variable the new guard uses
    v_new := regexp_replace(v_new, '(' || chr(10) || 'declare )', '\1v_block_reason text; ');

    -- (c) drop the new guard in immediately after the permission check
    if position(v_anchor in v_new) = 0 then
      raise exception 'wf_create_instance(%): permission-check anchor not found — not rewiring blindly',
        v_oid::regprocedure;
    end if;
    v_new := replace(v_new, v_anchor, v_anchor || v_guard);

    execute v_new;
    v_done := v_done + 1;
  end loop;

  raise notice 'wf_create_instance overloads rewired: %', v_done;
end
$do$;
