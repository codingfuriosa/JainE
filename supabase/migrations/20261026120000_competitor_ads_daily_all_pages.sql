-- COMPETITOR / BRAND / CHANNEL PARTNER ADS: EVERY PAGE, EVERY DAY (26 Oct 2026, as asked).
--
-- Until now each page was pulled once a week on its own weekday, because "1 Proxy credit per page"
-- was assumed (20 a day free). That was an estimate, never a figure Proxy publishes - and the
-- worker asks Proxy for up to FOUR pages in ONE request. In two weeks of hitting our own 20-page
-- ceiling every day, Proxy never once refused for credits. So our cap, not Proxy, was the limit.
--
-- Now every active page with a Page ID is queued every day, and our ceiling is raised to 60 pages
-- (15 Proxy requests). If Proxy does refuse, nothing breaks: the worker already spots the refusal,
-- closes the day, and the waiting pages go first the next day (competitor_finish_pulls). The
-- reason stays 'weekly' so the queue's existing checks and counts keep working unchanged.

create or replace function camp.competitor_enqueue_weekly()
returns integer
language plpgsql
security definer
set search_path to 'camp', 'public'
as $function$
declare
  n int;
begin
  insert into competitor_pull_queue (watchlist_id, reason)
  select w.id, 'weekly'
    from competitor_watchlist w
   where w.active and nullif(btrim(w.page_id), '') is not null
     and not exists (select 1 from competitor_pull_queue q
                      where q.watchlist_id = w.id and q.reason = 'weekly' and q.status in ('pending', 'running'));
  get diagnostics n = row_count;
  return n;
end $function$;

update camp.competitor_sync_settings set daily_credit_budget = 60, updated_at = now() where id = 1;
