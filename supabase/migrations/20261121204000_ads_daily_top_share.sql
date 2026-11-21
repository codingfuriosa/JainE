-- TOP-OF-PAGE SHARES (21 Nov 2026, Ayush: "Use top-of-page share" - the stand-in for Auction Insights, which Google keeps to
-- allowlisted developer tokens). Per Google Search campaign and day, read by ads-daily-sync with the impression share:
--   top_is     = share of eligible impressions shown above the organic results (metrics.search_top_impression_share)
--   abs_top_is = share shown as the very first ad                              (metrics.search_absolute_top_impression_share)
-- The Google checklist's weekly "First position (Auction)" point alerts when abs_top_is is below 50% for the week.
alter table camp.ads_daily add column if not exists top_is numeric;
alter table camp.ads_daily add column if not exists abs_top_is numeric;
