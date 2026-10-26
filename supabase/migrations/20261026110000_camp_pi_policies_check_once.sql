-- COMPETITOR DATA: THE "STAFF ONLY" CHECK IS ASKED ONCE PER QUERY, NOT ONCE PER ROW.
--
-- (26 Oct 2026) The public-intel tables (Google Ads Transparency, RERA, Trends, runs) were readable
-- under "not app.is_customer()", which Postgres ran for every row: reading the 3,000-odd Google
-- creatives spent ~300 ms of a 350 ms query on it. Wrapping it in (select ...) asks it once.
-- Same rule, same answer - only the cost changes.

do $$
declare t text;
begin
  foreach t in array array['pi_rera_projects','pi_rera_rejected','pi_rera_changes','pi_trends_points',
                           'pi_targets','pi_runs','pi_gads_creatives'] loop
    execute format('drop policy if exists "staff read" on camp.%I', t);
    execute format('create policy "staff read" on camp.%I for select to authenticated using (not (select app.is_customer()))', t);
  end loop;
end $$;
