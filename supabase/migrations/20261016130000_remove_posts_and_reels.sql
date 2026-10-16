-- POSTS & REELS REMOVED (16 Oct 2026), at the user's request, to restart it from scratch later.
-- Every stored post, reel and page record is deleted outright - no backup kept, by the user's
-- choice. Nothing else read these tables. The edge function social-organic-live is deleted
-- separately, and the module's page, menu entry and code are gone from the app.
drop table if exists camp.social_posts;
drop table if exists camp.social_pages;
