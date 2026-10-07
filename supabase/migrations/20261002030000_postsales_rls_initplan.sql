-- Evaluate the "not a customer session" check once per statement (init plan) instead of once per row:
-- interest / outstanding reports read thousands of rows and were hitting the statement timeout.
do $rls$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            join pg_policy p on p.polrelid = c.oid
           where n.nspname = 'postsales' and p.polname = c.relname || '_staff_all' loop
    execute format('drop policy if exists %I on postsales.%I', t || '_staff_all', t);
    execute format('create policy %I on postsales.%I for all to authenticated using ((select not app.is_customer())) with check ((select not app.is_customer()))', t || '_staff_all', t);
  end loop;
end $rls$;
