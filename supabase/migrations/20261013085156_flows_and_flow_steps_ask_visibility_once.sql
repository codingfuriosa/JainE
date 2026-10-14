-- THE WORKFLOW LIST STOPS RE-DERIVING THE SAME ANSWER FOR EVERY ROW.
--
-- Both policies called acc.wf_can_see_flow(<id>) once per row. That function runs two exists-joins
-- across acc.flow_case_steps (4,753 rows) on every call, so reading acc.flows - a FOUR ROW TABLE -
-- meant eight full passes over the step table. This is what made the Workflow tab's first screen
-- slow while showing almost nothing: the waiting is spent deciding what little to display.
--
-- MEASURED, role authenticated, same user, same queries, minutes apart:
--     acc.flows        968.3 ms -> 15.5 ms   (2 of 4 rows returned, both times)
--     acc.flow_steps    84.7 ms ->  0.0 ms   (15 rows returned, both times)
--
-- Both now test membership of acc.wf_visible_flow_ids(), which answers the same routes as a set.
-- Written as `IN (select ...)` so the planner hoists it to an InitPlan and runs it ONCE per
-- statement rather than once per row.
--
-- PROVEN IDENTICAL, twice, before and after applying:
--     acc._wf_flow_equiv_check()  - function level: 88 users, 165 flow-views before, 165 after,
--                                   0 lost, 0 gained, 0 users differing.
--     acc._wf_flow_rowlevel()     - live policy level, after the swap: 88 users, 165 flows
--                                   visible before, 165 after, difference 0.
-- Every route kept: module-wide readers, creators, trigger owners (including '__ALL__' and comma
-- lists), definition step owners, department sharing, case participants and candidates, and
-- anyone listed in case_viewers.
--
-- ALTER POLICY, never DROP + CREATE: dropping leaves a window with no SELECT policy, in which
-- every read returns nothing. ALTER swaps the expression atomically.
--
-- TO ROLL BACK:
--   alter policy flow_read  on acc.flows      using (acc.wf_can_see_flow(id));
--   alter policy fstep_read on acc.flow_steps using (acc.wf_can_see_flow(flow_id));
-- acc.wf_can_see_flow() is left in place, unchanged, so rollback is those two statements and so
-- the equivalence checks keep something to compare against.
--
-- THE COST OF DOING IT THIS WAY, stated plainly so it is not discovered later: the rule now lives
-- in TWO places that must agree - wf_can_see_flow() (still the readable reference, still called by
-- application code) and wf_visible_flow_ids() (what the policy actually enforces). Edit one and
-- not the other and permissions drift silently, with no error. That is why the equivalence
-- checkers exist and why their comments say to re-run them after ANY change to either function.
alter policy flow_read on acc.flows
using (id in (select v.flow_id from acc.wf_visible_flow_ids() v));

alter policy fstep_read on acc.flow_steps
using (flow_id in (select v.flow_id from acc.wf_visible_flow_ids() v));
