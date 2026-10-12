-- The Competitor Ads screen has always had Add, Edit, Remove and "In auto-sync" controls, but signed-in
-- users only ever had SELECT on camp.competitor_watchlist, so every one of them failed with a
-- permission error. Staff (anyone signed in who is not a customer-portal account) may now maintain
-- the watchlist. Removing a page also removes its stored ads, through the existing ON DELETE CASCADE.
--
-- Pulls are not affected: what gets pulled, and how often, is still decided by the queue functions,
-- which no screen can call except to request one of the month's manual pulls.

grant insert, update, delete on camp.competitor_watchlist to authenticated;
do $$
declare s text := pg_get_serial_sequence('camp.competitor_watchlist', 'id');
begin
  if s is not null then execute format('grant usage on sequence %s to authenticated', s); end if;
end $$;

drop policy if exists "staff insert" on camp.competitor_watchlist;
drop policy if exists "staff update" on camp.competitor_watchlist;
drop policy if exists "staff delete" on camp.competitor_watchlist;
create policy "staff insert" on camp.competitor_watchlist for insert to authenticated
  with check (not app.is_customer());
create policy "staff update" on camp.competitor_watchlist for update to authenticated
  using (not app.is_customer()) with check (not app.is_customer());
create policy "staff delete" on camp.competitor_watchlist for delete to authenticated
  using (not app.is_customer());
