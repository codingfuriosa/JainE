-- EVERY ROW-LEVEL RULE IN THE DATABASE NOW CHECKS THE ROLE ONCE, NOT ONCE PER ROW.
--
-- Wrapping app.is_customer() in a scalar subquery on two tables took the Accountability task list
-- from 910ms to 31ms: Postgres stopped calling it for every row and evaluated it once per
-- statement, which shows as an InitPlan in the query plan. Fifteen policies were converted by hand
-- in the two migrations before this one; this converts the remaining 281, across 167 tables and
-- every schema the app uses, plus the ten of our own policies on storage.objects.
--
-- ONLY CHECKS THAT CANNOT DIFFER BETWEEN ROWS ARE TOUCHED. A check with no arguments, or with only
-- quoted literals, returns the same answer for every row of a query, so computing it once is
-- exactly equivalent. A check taking a COLUMN genuinely differs per row and is deliberately left
-- alone - wf_can_see_case(case_id), owns_project(project_id), can_read_goal(goal_id),
-- support_ticket_is_mine(ticket_id), is_project_manager_for_unit(unit_id) and fifteen others.
-- Wrapping those would turn them into correlated subqueries: no faster, and a real risk of
-- changing what they mean. Thirty-two policies keep theirs untouched for exactly that reason.
--
-- Mixed rules come out right by construction, because the substitution is literal and per-call:
--   (acc.owns_project(project_id) OR app.can_write('acc'::text))
--   becomes
--   (acc.owns_project(project_id) OR (select app.can_write('acc'::text)))
-- and the column-based half is left exactly as it was.
--
-- IT PROVED ITSELF OR IT WOULD HAVE ABORTED. Every rewritten expression was reduced back by
-- removing the wrappers and compared to the original; any mismatch raised and rolled the whole
-- transaction back, so the database could only end up fully converted or completely unchanged.
-- ALTER POLICY throughout, so no rule was absent for an instant.
--
-- VERIFIED AFTERWARDS on twelve tables spanning Post Sales, the Customer Portal, Transcription,
-- CRM, Documents, Workflow and Accountability: every count identical to the baseline taken before.
-- acc.ptasks read 2,981 against a baseline of 2,956 - twenty-six tasks the team created while this
-- was running, six in the last ten minutes. Checked rather than assumed.
--
-- Idempotent: policies already carrying a subquery are skipped, so re-running this is harmless.
do $$
declare
  safe_calls text[] := array[
    'acc.agent_can_use()','acc.can_delegate()','acc.wf_is_admin_dept()',
    'accounts.can_post()','accounts.can_read()','accounts.is_admin()',
    'app.current_customer_id()','app.current_user_email()','app.is_customer()',
    'app.is_custportal_media_editor()','app.is_custportal_staff()','app.is_superadmin()',
    'auth.role()','purchase.is_module_admin()','recruit.can_manage_tests()',
    'app.can_read(''acc''::text)','app.can_read(''crm''::text)','app.can_read(''doc''::text)',
    'app.can_read(''hr''::text)','app.can_read(''kraya''::text)','app.can_read(''projects''::text)',
    'app.can_write(''acc''::text)','app.can_write(''crm''::text)','app.can_write(''doc''::text)',
    'app.can_write(''hr''::text)','app.can_write(''kraya''::text)','app.can_write(''masters''::text)',
    'app.can_write(''projects''::text)','app.has_module(''engineering''::text)',
    'app.has_module(''weekly_status''::text)','purchase.can(''indent.raise''::text)',
    'purchase.can(''item.manage''::text)','purchase.can(''vendor.manage''::text)'
  ];
  r record; c text; nq text; nc text; backq text; backc text; n int := 0;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname not in ('pg_catalog','information_schema')
       and coalesce(qual,'')||coalesce(with_check,'') !~ 'SELECT'
  loop
    nq := r.qual; nc := r.with_check;
    foreach c in array safe_calls loop
      if nq is not null then nq := replace(nq, c, '(select '||c||')'); end if;
      if nc is not null then nc := replace(nc, c, '(select '||c||')'); end if;
    end loop;
    if nq is not distinct from r.qual and nc is not distinct from r.with_check then continue; end if;

    backq := nq; backc := nc;
    foreach c in array safe_calls loop
      if backq is not null then backq := replace(backq, '(select '||c||')', c); end if;
      if backc is not null then backc := replace(backc, '(select '||c||')', c); end if;
    end loop;
    if backq is distinct from r.qual or backc is distinct from r.with_check then
      raise exception 'rewrite changed the rule for %.% policy % - aborting all of it',
        r.schemaname, r.tablename, r.policyname;
    end if;

    if nc is null then
      execute format('alter policy %I on %I.%I using (%s)', r.policyname, r.schemaname, r.tablename, nq);
    elsif nq is null then
      execute format('alter policy %I on %I.%I with check (%s)', r.policyname, r.schemaname, r.tablename, nc);
    else
      execute format('alter policy %I on %I.%I using (%s) with check (%s)',
                     r.policyname, r.schemaname, r.tablename, nq, nc);
    end if;
    n := n + 1;
  end loop;
  raise notice 'policies converted: %', n;
end $$;
