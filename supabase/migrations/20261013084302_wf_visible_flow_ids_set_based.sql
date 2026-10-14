-- THE SAME PROBLEM ONE LEVEL UP: THE WORKFLOW LIST ITSELF.
--
-- acc.flows holds 4 rows. Opening the Workflow tab and reading it took 968 ms to return 2 of them,
-- because the flow_read policy calls acc.wf_can_see_flow(id) once per row, and that function runs
-- TWO exists-joins across acc.flow_case_steps (4,753 rows) every time it is called. Four flows,
-- two scans each: eight passes over the whole step table to decide which two rows to show.
--
-- This is the set-based twin, same shape as acc.wf_visible_case_ids(): every branch below is a
-- transcription of the matching branch in wf_can_see_flow() and the wf_has_full_flow_access() it
-- calls, in the same order, so the two can be read side by side.
--
-- Branch map, against the originals:
--   A1 app.can_read('acc')                      -> all_flows   (module-wide read sees every flow)
--   A2 created_by / trigger_owner               -> owned
--   A3 flow_steps.owner_email                   -> step_owner
--   A4 visible_departments && users.department  -> dept
--   B  a step on one of its cases is mine       -> via_steps
--   C  ...or offers me as a candidate           -> via_steps (same scan, OR'd)
--   D  listed in case_viewers                   -> viewer
--
-- QUIRKS PRESERVED, because equivalence matters more than tidiness:
--   * A2 does NOT require a comma in trigger_owner, unlike the corresponding branch in
--     wf_can_see_case(). A single-name trigger_owner therefore matches here. That asymmetry is
--     real and is kept.
--   * string_to_array(lower(trigger_owner), ',') is not trimmed, so " b@x.com" will not match.
--   * No empty-identity guard. wf_can_see_flow() compares lower(coalesce(person,'')) against
--     lower(coalesce(current_user_email(),'')), so a caller with NO identity ('' = '') matches any
--     step whose person is null. That is pre-existing behaviour and is reproduced exactly here;
--     adding a guard would REVOKE access relative to today and belongs in its own change, with its
--     own evidence. It is worth looking at separately.
--
-- SECURITY DEFINER for the same reason as the originals: it reads acc.flows, the table whose own
-- policy will call it, so invoker rights would recurse.
create or replace function acc.wf_visible_flow_ids()
returns table(flow_id bigint)
language sql
stable
security definer
set search_path to 'acc', 'public'
as $function$
  with me as (select lower(coalesce(app.current_user_email(), '')) as e),

  -- A1 - whoever can read the Accountability module at all sees every flow.
  all_flows as (
    select f.id from acc.flows f where app.can_read('acc')
  ),

  -- A2 - I created it, it is open to everyone, or I am named in its trigger-owner list.
  owned as (
    select f.id
    from acc.flows f, me
    where lower(coalesce(f.created_by, '')) = me.e
       or f.trigger_owner = '__ALL__'
       or (f.trigger_owner is not null
           and me.e = any(string_to_array(lower(f.trigger_owner), ',')))
  ),

  -- A3 - I own a step in the flow's DEFINITION (not an instance).
  step_owner as (
    select distinct s.flow_id
    from acc.flow_steps s, me
    where lower(coalesce(s.owner_email, '')) = me.e
  ),

  -- A4 - the flow is shared with a department I belong to.
  dept as (
    select f.id
    from acc.flows f
    join adm.users u on lower(u.email) = (select e from me)
    where f.visible_departments is not null
      and f.visible_departments && u.department
  ),

  -- B + C - a step on one of its cases is mine, or offers me as a candidate. Both branches of the
  -- original scan the same two tables, so they collapse into ONE pass here instead of two.
  via_steps as (
    select distinct c.flow_id
    from acc.flow_case_steps cs
    join acc.flow_cases c on c.id = cs.case_id, me
    where lower(coalesce(cs.person, '')) = me.e
       or me.e = any(select lower(x) from unnest(coalesce(cs.candidates, '{}'::text[])) x)
  ),

  -- D - I am listed as a case viewer on the flow, whatever it is I watch.
  viewer as (
    select f.id
    from acc.flows f, jsonb_array_elements(coalesce(f.case_viewers, '[]'::jsonb)) v, me
    where lower(coalesce(v->>'viewer', '')) = me.e
  )

  select id      from all_flows
  union select id      from owned
  union select flow_id from step_owner
  union select id      from dept
  union select flow_id from via_steps
  union select id      from viewer
$function$;

revoke all on function acc.wf_visible_flow_ids() from public, anon;
grant execute on function acc.wf_visible_flow_ids() to authenticated;

comment on function acc.wf_visible_flow_ids() is
  'Set-based twin of acc.wf_can_see_flow(): the ids of every workflow the caller may see, by any of '
  'the same routes, computed once per query instead of once per row. Used by the flows and '
  'flow_steps policies. If wf_can_see_flow() or wf_has_full_flow_access() ever changes, change this '
  'in the same commit - they are required to agree, and acc._wf_flow_equiv_check() proves it.';
