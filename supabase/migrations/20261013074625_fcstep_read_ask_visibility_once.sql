-- THE WORKFLOW STEP RULE NOW ASKS "WHICH CASES MAY I SEE" ONCE, NOT PER ROW.
--
-- Only the third branch changes. The first two - "I am the person on this step" and "I am one of
-- its candidates" - are untouched and still answered from the row itself, which is correct and
-- already cheap. The third branch was acc.wf_can_see_case(case_id): a plpgsql function invoked
-- once per row that reads acc.flow_cases, calls acc.wf_has_full_case_access() (hitting acc.flows,
-- acc.flow_steps and adm.users), re-reads acc.flows, then runs two more EXISTS scans back against
-- acc.flow_case_steps itself. Reading the table re-scanned the table, 4,717 times.
--
-- It becomes a membership test against acc.wf_visible_case_ids(), which answers the same six
-- routes as a set. Written as `case_id IN (select ...)` so the planner hoists it to an InitPlan
-- and evaluates it ONCE for the whole statement - visible in EXPLAIN as "hashed SubPlan 8 ...
-- (actual rows=60 loops=1)".
--
-- MEASURED ON THIS DATABASE, same user, same query (select * from acc.flow_case_steps
-- order by id limit 1000 offset 0), role authenticated:
--     before   3,735.2 ms   107,824 buffer hits   585 rows returned, 4,132 filtered
--     after      126.2 ms     3,339 buffer hits   585 rows returned, 4,132 filtered
--   = 29.6x faster, 32x fewer buffer touches, byte-identical result set.
-- The table is 4,717 rows in 146 blocks, so the old path touched each block ~738 times over.
--
-- WHY THIS IS SAFE. Two independent proofs were run BEFORE this was applied, and both must stay
-- clean if either function is ever edited:
--   acc._wf_equiv_check()      - function level: 88 users, 8,456 visible case-views before,
--                                8,456 after, 0 lost, 0 gained, 0 users differing.
--   acc._wf_rowlevel_check()   - policy level, both policies OR'd exactly as Postgres evaluates
--                                them: 88 users in 4 batches, 114,095 visible step rows before,
--                                114,095 after, difference 0 in every batch.
-- All six routes are preserved - full-flow admins, open-flow requesters, multi-starter requesters,
-- whole-flow watchers, person-watchers, and step holders/candidates - including the 12 configured
-- watchers who would have gone blind under a naive rewrite that only kept the step-holder rule.
-- That naive rewrite (pointing the policy at the existing acc.wf_my_case_ids(), which implements
-- branch 6 alone) was the first plan and was wrong; it is recorded here so it is not retried.
--
-- ALTER POLICY, never DROP + CREATE: dropping leaves a window in which the table has no SELECT
-- policy and every read returns nothing. ALTER swaps the expression atomically.
--
-- TO ROLL BACK, restore the previous third branch:
--   alter policy fcstep_read on acc.flow_case_steps using (
--     (lower(coalesce(person,'')) = (select lower(coalesce(app.current_user_email(),''))))
--     or ((select lower(coalesce(app.current_user_email(),'')))
--          in (select lower(x.x) from unnest(coalesce(flow_case_steps.candidates,'{}'::text[])) x(x)))
--     or acc.wf_can_see_case(case_id));
-- acc.wf_can_see_case() is deliberately left in place, unchanged, so that rollback is one
-- statement and so the equivalence checks keep something to compare against.
--
-- NOT CHANGED HERE, but worth knowing: the sibling policy fcstep_write is FOR ALL, and in Postgres
-- a FOR ALL policy also grants SELECT. Its first branch is app.can_write('acc'), so anyone with
-- write permission on Accountability can already read every workflow step. That is pre-existing
-- behaviour, independent of this change, and is the reason the superadmin path above measures
-- 8.9 ms: it short-circuits on that branch before any of this is evaluated.
alter policy fcstep_read on acc.flow_case_steps
using (
  (lower(coalesce(person, '')) = (select lower(coalesce(app.current_user_email(), ''))))
  or (
    (select lower(coalesce(app.current_user_email(), '')))
      in (select lower(x.x) from unnest(coalesce(flow_case_steps.candidates, '{}'::text[])) x(x))
  )
  or case_id in (select v.case_id from acc.wf_visible_case_ids() v)
);
