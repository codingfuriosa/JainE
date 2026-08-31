/* A read-only observer could only ever be pointed at ONE PERSON: they saw the instances that
   person happens to hold or be offered. That covers "let Susanta see what Rabindra is handling",
   but not "let this person see every bill" - which would have meant one case_viewers entry per
   step owner, and a bill sitting with anyone not on that list would silently vanish from the view.
   Worse, it would have needed revisiting every time a step changed hands.

   watches = '__ALL__' now means every instance of the flow. The spelling matches trigger_owner,
   which already uses '__ALL__' for "everyone", so the vocabulary stays consistent.

   This stays READ-ONLY by construction, which is the reason to extend this mechanism rather than
   reach for extra_admins or visible_departments: returning true here grants SELECT and nothing
   else. Every write path - forwarding, rejecting, editing, deleting - checks person/candidates or
   app.can_write('acc') separately, and an observer satisfies neither. extra_admins would have
   granted full case access, and visible_departments would have handed the same sight to everyone
   else in that department rather than to one person.

   Also fixed while here: an entry whose `watches` was empty or missing matched any step whose
   `person` was also empty - which is every unclaimed shared step - so a malformed entry quietly
   leaked instances. An empty watches now matches nothing, which is what it always meant to do. No
   existing row is affected: the only entry present names a real person.

   Applied alongside this, and deliberately not in the file because it is data rather than schema:
   pc.thejaingroup1@gmail.com (Souvick Paul) added as an '__ALL__' viewer on Invoice Processing.
   Verified as that account with RLS live - 117 of 117 bills and all 1,404 step rows readable, none
   of Reimbursement's 31 claims, and edit, delete and forward all refused. */
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
     ) then
    return true;
  end if;

  -- Read-only observer of ONE PERSON: this case is visible only because the person they watch
  -- holds or is offered a step on it.
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
     ) then
    return true;
  end if;

  -- Or they own/are offered a step specifically on THIS case, same as anyone else would.
  return exists(select 1 from acc.flow_case_steps cs
       where cs.case_id=p_case_id
         and (lower(coalesce(cs.person,''))=lower(coalesce(v_email,''))
              or lower(coalesce(v_email,'')) = any(select lower(x) from unnest(coalesce(cs.candidates,'{}')) x)));
end; $function$;
