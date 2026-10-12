-- Lets the competitor sync take the stalest few competitors per run instead of all 22 at once.
--
-- Twenty-two competitors in one sequential loop, each a full browser session on the scraper box
-- with a two-minute navigation allowance, does not fit inside an edge function's lifetime. The
-- nightly call was dying about four competitors in; the other eighteen kept their old ads, and
-- because replace_stale only runs when a scrape returns something, nothing looked wrong. The
-- Competitors screen showed 1,143 ads of which 1,090 were nine days old and presented as current.
--
-- With a stamp per competitor the scheduled run can order by "least recently synced", take a
-- batch, and leave the rest for the next tick. The stamp is written whatever the outcome, so a
-- competitor that keeps failing goes to the back of the queue rather than blocking the others.

alter table camp.competitor_watchlist
  add column if not exists last_sync_at timestamptz;

comment on column camp.competitor_watchlist.last_sync_at is
  'When the sync last attempted this competitor (success or not). Drives the stalest-first batch.';

create index if not exists competitor_watchlist_stalest_idx
  on camp.competitor_watchlist (last_sync_at nulls first) where active;
