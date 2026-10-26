-- ACCOUNTABILITY: FASTER LISTS, AND A STEP CAN NO LONGER BE FORWARDED TWICE (26 Oct 2026).
--
-- 1. ONE PRESS, ONE FORWARD. wf_forward checked "already forwarded?" on a row it had not locked,
--    so two presses a second apart (the page was slow, nothing seemed to happen, so people pressed
--    again) both passed the check and both created the next step's task. Seven Invoice Processing
--    bills were forwarded 2-4 times this way between 18 Sep and 24 Oct, each leaving duplicate
--    Pending tasks behind. The step row is now locked (FOR UPDATE) before the check: a second press
--    waits for the first, then finds it forwarded and is refused. wf_done gets the same lock and
--    an "already done" refusal; wf_receive locks too, and a repeat Receive of a step already
--    received by the same person now does nothing (it used to send the "received" email again).
--    The Cheque and Bill Booking route buttons call wf_forward, so they are covered by it.
--
-- 2. THE INSTANCE LIST ASKED "MAY I SEE THIS?" ONCE PER ROW. flow_cases was readable under
--    acc.wf_can_see_case(id) - a full function call for each of ~620 instances on every read, about
--    0.2 s warm and 1.3 s on a fresh connection, on the busiest page in JainE. wf_visible_case_ids()
--    answers the same question for all of them in one pass (~20-30 ms), and is what flow_case_steps
--    already uses. Checked against every one of the 64 people who appear in workflows: identical
--    rows for each.

do $mig$
declare d text;
begin
  -- wf_forward: lock the step before deciding anything
  d := pg_get_functiondef('acc.wf_forward(bigint)'::regprocedure);
  if position('where id=p_fcs_id for update;' in d) = 0 then
    if position('select * into v from acc.flow_case_steps where id=p_fcs_id;' in d) = 0 then
      raise exception 'wf_forward: expected statement not found';
    end if;
    execute replace(d, 'select * into v from acc.flow_case_steps where id=p_fcs_id;',
                       'select * into v from acc.flow_case_steps where id=p_fcs_id for update;');
  end if;

  -- wf_done: lock, and refuse a second Done on a finished step
  d := pg_get_functiondef('acc.wf_done(bigint)'::regprocedure);
  if position('where id=p_fcs_id for update;' in d) = 0 then
    if position('select * into v from acc.flow_case_steps where id=p_fcs_id;' in d) = 0 then
      raise exception 'wf_done: expected statement not found';
    end if;
    execute replace(d, 'select * into v from acc.flow_case_steps where id=p_fcs_id;',
                       'select * into v from acc.flow_case_steps where id=p_fcs_id for update;'
                       || E'\n  if v.forwarded_at is not null then raise exception ''This step is already done.''; end if;');
  end if;

  -- wf_receive: lock, and a repeat Receive by the same person is a quiet no-op
  d := pg_get_functiondef('acc.wf_receive(bigint)'::regprocedure);
  if position('where id=p_fcs_id for update;' in d) = 0 then
    if position(E'select * into v from acc.flow_case_steps where id=p_fcs_id;\n  if not found then raise exception ''step not found''; end if;' in d) = 0 then
      raise exception 'wf_receive: expected statement not found';
    end if;
    execute replace(d,
      E'select * into v from acc.flow_case_steps where id=p_fcs_id;\n  if not found then raise exception ''step not found''; end if;',
      E'select * into v from acc.flow_case_steps where id=p_fcs_id for update;\n  if not found then raise exception ''step not found''; end if;'
      || E'\n  if v.received_at is not null and v.forwarded_at is null and lower(coalesce(v.person,'''')) = lower(v_email) then return; end if;');
  end if;
end $mig$;

drop policy if exists fcase_read on acc.flow_cases;
create policy fcase_read on acc.flow_cases for select
  using (id in (select v.case_id from acc.wf_visible_case_ids() v));
