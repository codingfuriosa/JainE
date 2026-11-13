-- 13 Nov 2026 (security check): four SECURITY DEFINER functions could be called with no login at all (the app's public key is in nexus-core.js),
-- and answered: acc.people() = every user's email, name and department; acc.scoreboard() / scoreboard_causelist() = every person's task scores;
-- acc.market_valuation_pending() = customers' cost sheets and booking-form data. Only signed-in staff (and the service role used by the edge functions) need them.
-- Executing is taken away from PUBLIC and anon and given back explicitly to authenticated and service_role, so the app keeps working.
revoke execute on function acc.people() from public, anon;
revoke execute on function acc.scoreboard() from public, anon;
revoke execute on function acc.scoreboard_causelist() from public, anon;
revoke execute on function acc.market_valuation_pending() from public, anon;
grant execute on function acc.people() to authenticated, service_role;
grant execute on function acc.scoreboard() to authenticated, service_role;
grant execute on function acc.scoreboard_causelist() to authenticated, service_role;
grant execute on function acc.market_valuation_pending() to authenticated, service_role;
