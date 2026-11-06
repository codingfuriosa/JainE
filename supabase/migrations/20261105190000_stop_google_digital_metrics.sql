-- OUR BRAND: GOOGLE ANALYTICS, GOOGLE MAPS, YOUTUBE AND THE REST OF DIGITAL METRICS SWITCHED OFF
-- (5 Nov 2026, as asked: "remove Google Map and Analytics and other Tabs and the data they pull
-- through API ... its unnecessary", and the stored data deleted).
--
-- The nightly pull (cron 'digital-metrics-daily': yt_public, yt_own, places, gbp, gsc, ga4) is
-- unscheduled and everything it stored is deleted. The tables themselves stay, empty, so nothing
-- that refers to them breaks; they can be dropped after office hours if wanted.
--
-- KEPT: the Lead Map. It runs through the same edge function (digital-metrics-sync) but on its own
-- cron 'lead-map-sync', and its rows in dm_sync_log (part 'lead_map', including the 'crm-day'
-- records that stop the CRM being called twice for a day) are left alone.

select cron.unschedule(jobid) from cron.job where jobname = 'digital-metrics-daily';

delete from camp.dm_yt_video_daily;
delete from camp.dm_yt_videos;
delete from camp.dm_yt_channel_daily;
delete from camp.dm_yt_own_breakdown;
delete from camp.dm_yt_own_daily;
delete from camp.dm_yt_channels;
delete from camp.dm_place_reviews;
delete from camp.dm_place_daily;
delete from camp.dm_places;
delete from camp.dm_gbp_reviews;
delete from camp.dm_gbp_keywords_monthly;
delete from camp.dm_gbp_daily;
delete from camp.dm_gsc_rows;
delete from camp.dm_ga4_rows;
delete from camp.dm_sources;
delete from camp.dm_google_auth;
delete from camp.dm_sync_log where part <> 'lead_map';
