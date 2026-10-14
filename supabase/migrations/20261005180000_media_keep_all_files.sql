-- Construction photo and video files are never deleted from S3 (decided 2026-10-05).
-- Undoes the 30-day clean-up added in 20261005170000_media_thumbs_cleanup_digest.sql before it
-- ever ran: the nightly job is unscheduled and the two functions it used are dropped, so nothing
-- can list or mark photo files for deletion. A photo removed in the admin, or replaced by a
-- retake, only leaves the screens (deleted_at); its file - and its thumbnail - stay in S3.
select cron.unschedule('media-purge-daily')
 where exists (select 1 from cron.job where jobname = 'media-purge-daily');
drop function if exists cust.media_purge_due(int);
drop function if exists cust.media_mark_purged(text, bigint[]);
alter table cust.unit_photos    drop column if exists purged_at;
alter table cust.tower_photos   drop column if exists purged_at;
alter table cust.floor_photos   drop column if exists purged_at;
alter table cust.project_photos drop column if exists purged_at;
