-- WORKFLOW WAS STILL SLOW, AND THE CAUSE WAS TWO THINGS I HAD MISSED.
--
-- FIRST, THE PREVIOUS SWEEP SKIPPED THIS TABLE. It passed over any policy whose expression
-- already contained the word SELECT, to avoid double-wrapping the ones done by hand. These two
-- qualify for the wrong reason: the SELECT in them is the unnest(candidates) subquery, part of the
-- rule itself. So they kept calling app.current_user_email() once per row, up to four times across
-- the two policies. Counting flow_case_steps took 4,178ms.
--
-- Only the caller identity and the role check are wrapped. They cannot differ between rows of one
-- query. acc.wf_can_see_case(case_id) and the unnest over this row's candidates are left alone:
-- both genuinely depend on the row.

alter policy fcstep_read on acc.flow_case_steps
  using (
       (lower(COALESCE(person, ''::text)) = (select lower(COALESCE(app.current_user_email(), ''::text))))
    OR ((select lower(COALESCE(app.current_user_email(), ''::text))) IN (
          SELECT lower(x.x) FROM unnest(COALESCE(flow_case_steps.candidates, '{}'::text[])) x(x)))
    OR acc.wf_can_see_case(case_id)
  );

alter policy fcstep_write on acc.flow_case_steps
  using (
    (select app.can_write('acc'::text))
    OR (lower(COALESCE(person, ''::text)) = (select lower(COALESCE(app.current_user_email(), ''::text))))
    OR ((select lower(COALESCE(app.current_user_email(), ''::text))) IN (
          SELECT lower(x.x) FROM unnest(COALESCE(flow_case_steps.candidates, '{}'::text[])) x(x)))
  );

-- SECOND, THE FUNCTION WAS PAYING FOR A CHECK THAT COULD NOT CHANGE ITS ANSWER.
--
-- flow_case_steps' read rule admits a row when (A) the caller is the step's person, OR (B) the
-- caller is one of its candidates, OR (C) acc.wf_can_see_case(case_id) - the viewer, observer and
-- trigger-owner rules.
--
-- This function returns case ids where (A) or (B) holds, and nothing else. Under SECURITY INVOKER
-- the rows it could return are ((A or B) or C) AND (A or B), which is just (A or B). Condition (C)
-- can never add a row here, and never remove one. It is pure cost - and it is expensive: plpgsql
-- that reads flow_cases, reads flows, calls wf_has_full_case_access, walks the case_viewers JSON
-- twice and joins back over flow_case_steps, per row. Reordering the OR chain did not help;
-- Postgres chooses its own evaluation order.
--
-- So the function applies (A or B) itself, as SECURITY DEFINER, and does not pay for (C). The
-- filter is written to match the policy's (A) and (B) exactly: same columns, same
-- lower(coalesce(...)) on both sides, same unnest over candidates. An empty caller identity
-- returns nothing. search_path is pinned and EXECUTE is granted to authenticated only.
--
-- 5,352ms -> 82ms. Verified per identity: cfo 480 of an expected 480, audit 374 of 374,
-- ayushruia1 0 of 0, and a token carrying no email at all 0.
create or replace function acc.wf_my_case_ids()
returns table(case_id bigint)
language sql stable security definer
set search_path to 'acc', 'public'
as $$
  with me as (select lower(coalesce(app.current_user_email(), '')) as e)
  select distinct s.case_id
    from acc.flow_case_steps s, me
   where s.case_id is not null
     and me.e <> ''                                  -- no caller identity, no rows
     and ( lower(coalesce(s.person, '')) = me.e
        or exists (select 1
                     from unnest(coalesce(s.candidates, '{}'::text[])) c
                    where lower(c) = me.e) );
$$;

revoke execute on function acc.wf_my_case_ids() from public, anon;
grant  execute on function acc.wf_my_case_ids() to authenticated;
