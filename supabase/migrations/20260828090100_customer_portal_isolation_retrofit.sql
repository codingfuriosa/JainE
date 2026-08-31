-- Customer Portal, part 2: close the direct-API read risk a real customer login introduces.
--
-- Every existing policy in acc/adm/doc/crm/postsales/hr/recruit/camp is `using(true)` (and, where a
-- with_check exists, `with_check(true)`) because until now every authenticated user was trusted
-- staff. The moment cust.customers.auth_user_id links a real customer to an auth.users row in this
-- same Supabase project, that customer's JWT is just as "authenticated" as staff - without this
-- migration they could call e.g. sb.schema('acc').from('transcriptions').select('*') straight from
-- devtools and read everything, regardless of what the customer-portal UI shows them.
--
-- This walks every such policy and tightens it to `using(not app.is_customer())` (and with_check to
-- match), which is a no-op for staff (app.is_customer() is false for them - see
-- 20260828090000_customer_portal_schema.sql) and a hard wall for anyone with a cust.customers login.
--
-- Only policies whose qual/with_check is LITERALLY `true` are touched automatically - anything else
-- is left alone and surfaced via RAISE NOTICE so it gets a manual look instead of being silently
-- mishandled. Re-running this migration is a no-op: a policy already tightened no longer matches
-- `= 'true'`, so the loop simply skips it the second time.

begin;

do $retrofit$
declare
  r        record;
  v_using  text;
  v_check  text;
  v_sql    text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = any(array['acc','adm','doc','crm','postsales','hr','recruit','camp'])
  loop
    v_using := null; v_check := null;

    if r.qual is not null then
      if r.qual = 'true' then
        v_using := 'not app.is_customer()';
      else
        raise notice 'Skipped policy % on %.% - qual is not literally true (%), needs manual review',
          r.policyname, r.schemaname, r.tablename, r.qual;
        continue;
      end if;
    end if;

    if r.with_check is not null then
      if r.with_check = 'true' then
        v_check := 'not app.is_customer()';
      else
        raise notice 'Skipped policy % on %.% - with_check is not literally true (%), needs manual review',
          r.policyname, r.schemaname, r.tablename, r.with_check;
        continue;
      end if;
    end if;

    if v_using is null and v_check is null then continue; end if;

    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if v_using is not null then v_sql := v_sql || format(' using (%s)', v_using); end if;
    if v_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;
    execute v_sql;
  end loop;
end $retrofit$;

commit;
