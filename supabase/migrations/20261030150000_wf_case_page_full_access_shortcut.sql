-- WORKFLOW LIST: ONE VISIBILITY CHECK INSTEAD OF ONE PER INSTANCE (30 Oct 2026).
-- acc.wf_case_page ran acc.wf_can_see_case for every instance of the workflow on every call - 466 times
-- for Invoice Processing to show a page of 25 - and was the single largest load on the database
-- (10,031 calls in 4 days). Someone with full access to the workflow sees every instance (wf_can_see_case
-- returns true at once for them), so for them it now reads the workflow's instances directly.
-- Checked before applying: for five step owners the instance-by-instance answer and the full list were
-- identical (466 of 466). Everyone else still gets the instance-by-instance check, unchanged.
-- Only that block of the function is replaced; the rest of it (newest bill first, etc.) is left as it is.
do $do$
declare d text := pg_get_functiondef('acc.wf_case_page'::regproc); n text;
begin
  if position('acc.wf_has_full_case_access(p_flow_id) then' in d) > 0 then return; end if;   -- already applied
  n := replace(d,
$a$  select coalesce(array_agg(c.id), '{}') into v_vis
    from acc.flow_cases c
   where c.flow_id = p_flow_id
     and acc.wf_can_see_case(c.id);$a$,
$b$  /* 30 Oct 2026: someone with full access to the workflow sees every one of its instances - which is
     what wf_can_see_case answers for each of them anyway (it returns true at once for full access).
     Asked once here instead of once per instance (466 times for Invoice Processing, every page).
     Everyone else still gets the instance-by-instance check, unchanged. */
  if acc.wf_has_full_case_access(p_flow_id) then
    select coalesce(array_agg(c.id), '{}') into v_vis
      from acc.flow_cases c
     where c.flow_id = p_flow_id;
  else
    select coalesce(array_agg(c.id), '{}') into v_vis
      from acc.flow_cases c
     where c.flow_id = p_flow_id
       and acc.wf_can_see_case(c.id);
  end if;$b$);
  if n = d then raise exception 'the visibility block was not found - nothing changed'; end if;
  execute n;
end $do$;
