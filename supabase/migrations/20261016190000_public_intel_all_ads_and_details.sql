-- Competitor Data rework (16 Oct 2026): read EVERY Google ad, and what each ad actually says.
--
-- ALL ADS, NOT THE NEWEST 200. Google's Ads Transparency list is paged 40 at a time. The collector
-- used to stop after 5 pages per advertiser. It now keeps going across ticks: a tick reads up to 10
-- pages and leaves Google's own continuation token in pi_targets.cursor, the next tick carries on
-- from it, and when Google gives no further token the pass is finished (full_at). After that the
-- first pages are re-read daily (new ads appear first) and the whole list is re-read weekly.
alter table camp.pi_targets add column if not exists cursor text;            -- Google's "next page" token mid-pass
alter table camp.pi_targets add column if not exists pass_started_at timestamptz;
alter table camp.pi_targets add column if not exists pass_pages int;         -- pages read so far in this pass
alter table camp.pi_targets add column if not exists pass_ads int;           -- ads read so far in this pass
alter table camp.pi_targets add column if not exists full_at timestamptz;    -- last time a pass reached the end
alter table camp.pi_targets add column if not exists full_ads int;           -- ads Google listed in that pass

-- WHAT THE AD SAYS. Each creative's preview_url is the script Google's own page loads to draw the
-- ad; it carries the ad's words, image and YouTube video id. The gads_detail source reads a few of
-- these per tick and stores only what the script states. Nothing is filled in by guesswork: a field
-- the script does not carry stays null, and a script whose layout is not recognised is recorded in
-- detail_error rather than half-read.
alter table camp.pi_gads_creatives add column if not exists ad_layout text;        -- 'search', 'local', 'display', 'video'
alter table camp.pi_gads_creatives add column if not exists ad_headline text;      -- as written; may hold {KeyWord:default}
alter table camp.pi_gads_creatives add column if not exists ad_long_headline text;
alter table camp.pi_gads_creatives add column if not exists ad_description text;
alter table camp.pi_gads_creatives add column if not exists ad_display_url text;   -- the green/grey web address line
alter table camp.pi_gads_creatives add column if not exists ad_business text;      -- business / channel name the ad shows
alter table camp.pi_gads_creatives add column if not exists ad_cta text;           -- call to action ("Visit Site", "Book now")
alter table camp.pi_gads_creatives add column if not exists ad_image_url text;     -- main picture of a display ad
alter table camp.pi_gads_creatives add column if not exists ad_logo_url text;
alter table camp.pi_gads_creatives add column if not exists video_id text;         -- YouTube video id
alter table camp.pi_gads_creatives add column if not exists video_duration text;
alter table camp.pi_gads_creatives add column if not exists ad_extra jsonb;        -- sitelinks, place, variation count
alter table camp.pi_gads_creatives add column if not exists detail_at timestamptz;
alter table camp.pi_gads_creatives add column if not exists detail_error text;

create index if not exists pi_gads_creatives_detail_todo on camp.pi_gads_creatives (last_shown desc) where detail_at is null;
create index if not exists pi_gads_creatives_watchlist on camp.pi_gads_creatives (watchlist_id, last_shown desc);
