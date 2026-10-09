-- WHAT META SAYS ABOUT HOW FAR AN AD ACTUALLY GOT.
--
-- The Ad Library shows, on some ads, a "Low impression count" badge beside Active, an
-- "Impressions: <100" line, and how long the ad has been running ("Total active time 22 hrs").
-- Not every ad carries it - a DTC ad I opened showed none of it, which is what led me to tell the
-- user it did not exist. It does: Srijan Realty's ads show all three. The badge appears when Meta
-- judges the count low, so its absence means "not flagged", never "no data".
--
-- This is the most useful thing on that whole screen for judging a competitor. Everything else
-- says what they ARE running; this says whether it went anywhere. An ad flagged low-impression
-- after a day is money that did not land.
--
-- Three columns, all nullable, because neither sync route fills them yet and an ad recorded
-- before this change must stay readable:
--   impressions_text  - kept as Meta's own words ("<100", "1K-5K"). It is a RANGE, not a number,
--                       and storing it as an integer would invent a precision Meta refuses to
--                       give. Anything that later wants to sort on it can parse the lower bound.
--   low_impression    - the badge itself. Separate from the text because the badge is Meta's own
--                       judgement, and an ad can carry a range without being flagged.
--   total_active_time - "22 hrs", again Meta's words.
alter table camp.competitor_ads
  add column if not exists impressions_text  text,
  add column if not exists low_impression    boolean,
  add column if not exists total_active_time text;

comment on column camp.competitor_ads.impressions_text is
  'Meta''s own impression range as shown in the Ad Library ("<100", "1K-5K"). A range, never a '
  'number - Meta does not publish an exact count for commercial ads.';
comment on column camp.competitor_ads.low_impression is
  'True when the Ad Library shows its "Low impression count" badge. Null means the ad was '
  'collected before this was captured, or the route that collected it does not report it - '
  'it does NOT mean the ad had a healthy reach.';

-- Reading the board by reach is the point of having this, and "show me what is flagged" is the
-- only query it will be asked. Partial, so it costs nothing on the ads that are not flagged.
create index if not exists competitor_ads_low_impression_idx
  on camp.competitor_ads (watchlist_id, ad_delivery_start_time desc)
  where low_impression is true;
