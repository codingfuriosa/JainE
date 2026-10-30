-- A STEP ONLY SOME ROUTES USE IS NEVER CREATED ON A BILL WHOSE ROUTE DOES NOT NAME IT (30 Oct 2026).
-- Booking Entry (Invoice Processing, seq 13, route_only) belongs to the Payment - No Cheque path alone.
-- wf_materialise_steps already left it out, but raising a bill (acc.wf_create_instance) creates every
-- step of the workflow at once, so 20 bills raised since 27 Oct carried an unused Booking Entry step.
-- This guard sits on the table, so it holds for every way a step is created.
create or replace function acc.flow_case_steps_route_only_guard() returns trigger
language plpgsql security definer set search_path to 'acc', 'public' as $$
begin
  if exists (select 1 from acc.flow_steps st where st.id = new.step_id and coalesce(st.route_only, false))
     and not exists (select 1 from acc.flow_cases c where c.id = new.case_id and new.seq = any(coalesce(c.route_seqs, '{}'::int[]))) then
    return null;   -- skipped: this bill's route does not use the step
  end if;
  return new;
end $$;
drop trigger if exists trg_flow_case_steps_route_only on acc.flow_case_steps;
create trigger trg_flow_case_steps_route_only before insert on acc.flow_case_steps
  for each row execute function acc.flow_case_steps_route_only_guard();

-- The stray ones: never reached, no task, on bills not on the No Cheque payment path.
delete from acc.flow_case_steps s using acc.flow_cases c, acc.flow_steps st
 where c.id = s.case_id and st.id = s.step_id and coalesce(st.route_only, false)
   and s.forwarded_at is null and s.task_id is null and s.appeared_at is null
   and not (s.seq = any(coalesce(c.route_seqs, '{}'::int[])));
