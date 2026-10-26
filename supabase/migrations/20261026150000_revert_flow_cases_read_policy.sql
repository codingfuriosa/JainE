-- REVERT: flow_cases READ RULE BACK TO wf_can_see_case(id) (26 Oct 2026).
--
-- 20261026130000 switched the rule to "id in (select from wf_visible_case_ids())". That made a full
-- list read fast (~0.02 s instead of ~0.2 s), but every SINGLE-instance read now worked out the
-- person's whole visible set first: 0.45 s per lookup instead of 0.03 s. JainE makes those single
-- lookups constantly (task rows, Receive / Forward, instance pages), and on the small database it
-- buried everything the same afternoon. The old per-row rule is back. The step-locking part of
-- 20261026130000 (no double forwards) stays.

drop policy if exists fcase_read on acc.flow_cases;
create policy fcase_read on acc.flow_cases for select using (acc.wf_can_see_case(id));
