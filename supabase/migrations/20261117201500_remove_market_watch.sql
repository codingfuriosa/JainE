-- Market Watch removed (17 Nov 2026, Ayush: "remove Market Watch Module, remove its code and connection with AI or any
-- other API" - and its stored data deleted too). Applied after 20:00 IST by the one-time cron mw_drop_once.
-- The market-watch storage bucket was emptied and deleted the same afternoon; its crons and cron key were removed.
drop table if exists camp.mkt_videos;          -- saved YouTube trend / hook videos
drop table if exists camp.kw_monthly;          -- Keyword Planner demand (never filled: Basic API access was not granted)
-- Facebook video plays per ad, read only for Market Watch's Hook Library "Our ads"
alter table camp.ads_ad_daily
  drop column if exists video_3s, drop column if exists video_p25, drop column if exists video_p50,
  drop column if exists video_p100, drop column if exists video_thruplay;
notify pgrst, 'reload schema';
