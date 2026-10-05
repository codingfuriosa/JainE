-- auth.role() called bare in a policy is re-evaluated FOR EVERY ROW the policy tests. Wrapped in
-- a scalar subquery Postgres works it out once and reuses the answer, because the subquery has no
-- reference to the row. Same rule, same result, one evaluation instead of thousands.
--
-- Eleven read policies across camp (the ads and campaigns tables) were doing this. These are the
-- tables that grow fastest - ad_insights and campaign_insights take a row per ad per day - so this
-- is the one place where the cost compounds on its own without anybody adding a feature.
--
-- Supabase's own linter flags exactly this as auth_rls_initplan. After this migration it reports
-- none left anywhere in the database.

do $$
declare r record;
begin
  for r in
    select n.nspname as sch, c.relname as tbl, p.polname as pol
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'camp'
      and pg_get_expr(p.polqual, p.polrelid) = '(auth.role() = ''authenticated''::text)'
  loop
    execute format(
      'alter policy %I on %I.%I using ((select auth.role()) = ''authenticated'')',
      r.pol, r.sch, r.tbl);
  end loop;
end $$;
