-- THE SAME SIX RULES, ASKED ONCE INSTEAD OF ONCE PER ROW.
--
-- acc.wf_can_see_case(case_id) answers "may I see this one case?" and is correct. Its problem is
-- that a policy calls it per ROW: 4,717 step rows span only 541 distinct cases, so the identical
-- question is asked 8.7 times over on average, and each ask re-reads acc.flow_cases, acc.flows,
-- acc.flow_steps, adm.users and then re-scans acc.flow_case_steps twice. Measured: 1,250 ms with
-- the policy against 6.6 ms without it, 32,147 buffer touches on a 146-block table.
--
-- This returns the SET of visible case ids instead, computed once per query. Every branch below is
-- a transcription of the matching branch in wf_can_see_case, in the same order, so the two can be
-- read side by side. It deliberately does NOT simplify any rule - a tidier rule here would be a
-- silent permission change, which is the one outcome worth more than the milliseconds.
--
-- Quirks preserved on purpose, because they decide who sees what:
--   * string_to_array(lower(trigger_owner), ',') is NOT trimmed, exactly as in wf_can_see_case.
--     "a@x.com, b@y.com" therefore yields ' b@y.com' with a leading space and does not match. That
--     is today's behaviour; fixing it here would GRANT access nobody has now.
--   * An empty 'watches' matches nobody (coalesce(btrim(...),'') <> '').
--   * No caller identity means no rows, never all rows.
--   * A case whose row is missing is invisible - wf_can_see_case returns false on not-found, and
--     every branch here joins through acc.flow_cases.
--
-- SECURITY DEFINER for the same reason wf_can_see_case is: it reads acc.flow_case_steps, which is
-- the very table whose policy will call it, so invoker rights would recurse.
create or replace function acc.wf_visible_case_ids()
returns table(case_id bigint)
language sql
stable
security definer
set search_path to 'acc', 'public'
as $function$
  with me as (
    select lower(coalesce(app.current_user_email(), '')) as e
  ),

  -- BRANCH 1 + BRANCH 4 - access to a whole FLOW, so every case in it.
  --   1. acc.wf_has_full_case_access(flow_id): creator, sole trigger owner, extra admin, step
  --      owner, department viewer, or the hard-coded superuser.
  --   4. a case_viewers entry watching '__ALL__' - read-only observer of the entire flow.
  -- Called per flow, not per row: there are 4 flows, so this is 4 evaluations, not 4,717.
  wide_flows as (
    select f.id
    from acc.flows f, me
    where me.e <> ''
      and (
        acc.wf_has_full_case_access(f.id)
        or exists (
             select 1
             from jsonb_array_elements(coalesce(f.case_viewers, '[]'::jsonb)) v
             where lower(coalesce(v->>'viewer', '')) = me.e
               and upper(coalesce(v->>'watches', '')) = '__ALL__'
           )
      )
  ),

  -- BRANCH 2 + BRANCH 3 - I started this case, on a flow that lets me.
  --   2. trigger_owner = '__ALL__' (open to everyone) and I created the case.
  --   3. a multi-name trigger_owner list containing me, and I created the case. Single-name lists
  --      are excluded here exactly as in the original, because branch 1 already covers them.
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

  -- BRANCH 5 - I am a read-only observer of ONE PERSON, and that person holds or is offered a
  -- step on this case. The case is visible only through them.
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
  select id      from started
  union
  select case_id from watched
  union
  select case_id from mine
$function$;

revoke all on function acc.wf_visible_case_ids() from public, anon;
grant execute on function acc.wf_visible_case_ids() to authenticated;

comment on function acc.wf_visible_case_ids() is
  'Set-based twin of acc.wf_can_see_case(): the ids of every workflow case the caller may see, by '
  'any of the same six routes, computed once per query instead of once per row. Used by the '
  'fcstep_read policy. If wf_can_see_case() ever changes, change this in the same commit - they '
  'are required to agree, and acc._wf_equiv_check() proves it.';
