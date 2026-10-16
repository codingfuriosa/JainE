-- DIGITAL METRICS (16 Oct 2026) - Google data for our brand and its competitors, official APIs only.
--
--   YouTube         our channel: YouTube Analytics API (needs the marketing Google connection)
--                   competitors: YouTube Data API v3 public counts, with the YOUTUBE_API_KEY secret
--   Google Maps     our listings: Business Profile Performance API + reviews (marketing connection)
--                   competitors: Places API (New) rating / review count / latest reviews (GOOGLE_PLACES_API_KEY)
--   Search Console  our sites only (marketing connection)
--   Analytics (GA4) our properties only (marketing connection)
-- Competitors' Search Console and GA4 are private to them and are not collected.
--
-- EVERY NUMBER IS STORED AS GOOGLE RETURNED IT. Nothing is estimated or filled in: a day Google has
-- not reported yet is simply absent, and public counts are kept as dated snapshots so growth is the
-- difference between two real readings, never an interpolation.
--
-- Written only by the digital-metrics-sync worker (service role). Read by anyone holding the
-- 'digital_metrics' module (superadmins always). The mapping tables (which channel / which place
-- belongs to which brand) are also editable by those people, from the page.

-- ---------------------------------------------------------------- who may see / edit
create or replace function camp.dm_allowed() returns boolean
language sql stable security definer set search_path to '' as $$
  select not app.is_customer() and app.has_module('digital_metrics')
$$;
grant execute on function camp.dm_allowed() to authenticated;

-- ---------------------------------------------------------------- the marketing Google connection
-- Separate from acc.google_tokens on purpose. That table is one row per JAIN-E person, keyed by the
-- address they log in with, and is checked against the Google account that consents. The marketing
-- connection is a COMPANY account (a @thejaingroup.com address that owns the YouTube channel, the
-- Search Console sites, the GA4 properties and the Maps listings) and is usually not the address
-- the person clicking "Connect" logs into JAIN-E with. Tokens are never readable from the browser:
-- RLS on, no policy at all - only the service role sees this table.
create table if not exists camp.dm_google_auth (
  google_email  text primary key,
  access_token  text,
  refresh_token text,
  expiry        timestamptz,
  scope         text not null default '',
  connected_by  text,                       -- the JAIN-E user who clicked Connect
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table camp.dm_google_auth enable row level security;
revoke all on camp.dm_google_auth from anon, authenticated;

-- What the page may know about the connection: who, when, which permissions. Never a token.
create or replace function camp.dm_connection_status()
returns table(google_email text, scope text, connected_by text, connected_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path to '' as $$
  select a.google_email, a.scope, a.connected_by, a.connected_at, a.updated_at
    from camp.dm_google_auth a where camp.dm_allowed() order by a.updated_at desc
$$;
grant execute on function camp.dm_connection_status() to authenticated;

-- ---------------------------------------------------------------- sources found on the connection
-- Filled by the worker's "discover" step: every Search Console site, GA4 property, Business Profile
-- location and YouTube channel the connected account can see. 'enabled' decides what is pulled.
create table if not exists camp.dm_sources (
  kind        text not null check (kind in ('gsc_site','ga4_property','gbp_location','yt_channel')),
  source_id   text not null,               -- sc-domain:x / https://x/ ; properties/123 ; locations/123 ; UC...
  label       text,
  enabled     boolean not null default true,
  meta        jsonb not null default '{}'::jsonb,
  google_email text,
  discovered_at timestamptz not null default now(),
  primary key (kind, source_id)
);

-- ---------------------------------------------------------------- YouTube
-- Channels to track: ours (is_own) and competitors' (watchlist_id -> camp.competitor_watchlist).
-- confirmed = a person has checked this channel really is that brand's; only confirmed rows are pulled.
create table if not exists camp.dm_yt_channels (
  channel_id   text primary key check (channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  title        text,
  handle       text,
  watchlist_id bigint references camp.competitor_watchlist(id) on delete set null,
  is_own       boolean not null default false,
  confirmed    boolean not null default false,
  active       boolean not null default true,
  uploads_playlist_id text,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- Public counts, one reading per channel per day (Data API v3). subscriber count is rounded by
-- YouTube itself to 3 significant figures for public reads - stored exactly as returned.
create table if not exists camp.dm_yt_channel_daily (
  channel_id   text not null references camp.dm_yt_channels(channel_id) on delete cascade,
  snap_date    date not null,
  subscribers  bigint,
  hidden_subscribers boolean,
  views        bigint,
  videos       bigint,
  fetched_at   timestamptz not null default now(),
  primary key (channel_id, snap_date)
);
create table if not exists camp.dm_yt_videos (
  video_id     text primary key,
  channel_id   text not null references camp.dm_yt_channels(channel_id) on delete cascade,
  title        text,
  published_at timestamptz,
  duration_sec integer,
  thumbnail    text,
  last_seen    timestamptz not null default now()
);
create index if not exists dm_yt_videos_channel on camp.dm_yt_videos(channel_id, published_at desc);
create table if not exists camp.dm_yt_video_daily (
  video_id     text not null references camp.dm_yt_videos(video_id) on delete cascade,
  snap_date    date not null,
  views        bigint,
  likes        bigint,
  comments     bigint,
  fetched_at   timestamptz not null default now(),
  primary key (video_id, snap_date)
);
-- Our channel, YouTube Analytics API. One row per day (video_id = '' for the whole channel) or per
-- video per day. Metric columns match the API's metric names.
create table if not exists camp.dm_yt_own_daily (
  channel_id   text not null,
  video_id     text not null default '',
  day          date not null,
  views        bigint,
  estimated_minutes_watched bigint,
  average_view_duration     numeric,
  average_view_percentage   numeric,
  subscribers_gained        bigint,
  subscribers_lost          bigint,
  likes        bigint,
  comments     bigint,
  shares       bigint,
  videos_added_to_playlists bigint,
  fetched_at   timestamptz not null default now(),
  primary key (channel_id, video_id, day)
);
-- Our channel broken down by traffic source / country / device / subscribed status (per day), and by
-- age group + gender (period totals - the API has no daily split for demographics; period_days says
-- how many days ending on 'day' the row covers).
create table if not exists camp.dm_yt_own_breakdown (
  channel_id   text not null,
  day          date not null,
  period_days  integer not null default 1,
  dimension    text not null,               -- insightTrafficSourceType | country | deviceType | subscribedStatus | ageGroup,gender
  dim_value    text not null,
  metrics      jsonb not null,
  fetched_at   timestamptz not null default now(),
  primary key (channel_id, dimension, day, period_days, dim_value)
);

-- ---------------------------------------------------------------- Google Maps
-- Our listings (Business Profile). location = 'locations/123'.
create table if not exists camp.dm_gbp_daily (
  location     text not null,
  day          date not null,
  metric       text not null,               -- BUSINESS_IMPRESSIONS_MOBILE_MAPS, CALL_CLICKS, ...
  value        bigint,
  fetched_at   timestamptz not null default now(),
  primary key (location, day, metric)
);
create table if not exists camp.dm_gbp_keywords_monthly (
  location     text not null,
  month        date not null,               -- first day of the month
  keyword      text not null,
  value        bigint,                      -- exact count when Google gives one
  threshold    bigint,                      -- else Google only says "fewer than N"
  fetched_at   timestamptz not null default now(),
  primary key (location, month, keyword)
);
create table if not exists camp.dm_gbp_reviews (
  review_id    text primary key,
  location     text not null,
  reviewer     text,
  star_rating  integer,
  comment      text,
  create_time  timestamptz,
  update_time  timestamptz,
  reply_comment text,
  reply_time   timestamptz,
  fetched_at   timestamptz not null default now()
);
create index if not exists dm_gbp_reviews_loc on camp.dm_gbp_reviews(location, create_time desc);
-- Any Maps place (ours or a competitor's), read from the public Places API.
create table if not exists camp.dm_places (
  place_id     text primary key,
  label        text,
  address      text,
  maps_uri     text,
  watchlist_id bigint references camp.competitor_watchlist(id) on delete set null,
  is_own       boolean not null default false,
  confirmed    boolean not null default false,
  active       boolean not null default true,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create table if not exists camp.dm_place_daily (
  place_id     text not null references camp.dm_places(place_id) on delete cascade,
  snap_date    date not null,
  name         text,
  rating       numeric,
  user_ratings_total bigint,
  fetched_at   timestamptz not null default now(),
  primary key (place_id, snap_date)
);
-- Places returns at most 5 reviews per read; kept as they arrive, so the history builds up.
create table if not exists camp.dm_place_reviews (
  place_id     text not null references camp.dm_places(place_id) on delete cascade,
  review_name  text not null,               -- places/x/reviews/y, Google's own id
  author       text,
  rating       integer,
  text         text,
  publish_time timestamptz,
  first_seen   timestamptz not null default now(),
  primary key (place_id, review_name)
);

-- ---------------------------------------------------------------- Search Console
-- One row per site, day, dimension and key. dim = 'date' (key '') is the day's total; 'query',
-- 'page', 'country', 'device' are that day split one way (top 1000 rows per day per dimension).
create table if not exists camp.dm_gsc_rows (
  site_url     text not null,
  day          date not null,
  dim          text not null check (dim in ('date','query','page','country','device')),
  key          text not null default '',
  clicks       bigint,
  impressions  bigint,
  ctr          numeric,
  position     numeric,
  fetched_at   timestamptz not null default now(),
  primary key (site_url, day, dim, key)
);

-- ---------------------------------------------------------------- Google Analytics 4
-- report: overview (key '') | source (sessionSource / sessionMedium / sessionCampaignName)
--         | landing (landingPage) | city | device (deviceCategory) | event (eventName)
create table if not exists camp.dm_ga4_rows (
  property_id  text not null,               -- properties/123456
  day          date not null,
  report       text not null,
  key          text not null default '',
  dims         jsonb not null default '{}'::jsonb,
  metrics      jsonb not null,
  fetched_at   timestamptz not null default now(),
  primary key (property_id, day, report, key)
);

-- ---------------------------------------------------------------- run log
create table if not exists camp.dm_sync_log (
  id           bigserial primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  trigger      text,                        -- cron | manual:<email>
  part         text not null,               -- yt_public | yt_own | gbp | places | gsc | ga4 | discover
  ok           boolean,
  rows         integer,
  message      text
);
create index if not exists dm_sync_log_part on camp.dm_sync_log(part, started_at desc);

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array['dm_sources','dm_yt_channels','dm_yt_channel_daily','dm_yt_videos','dm_yt_video_daily',
    'dm_yt_own_daily','dm_yt_own_breakdown','dm_gbp_daily','dm_gbp_keywords_monthly','dm_gbp_reviews','dm_places',
    'dm_place_daily','dm_place_reviews','dm_gsc_rows','dm_ga4_rows','dm_sync_log']
  loop
    execute format('alter table camp.%I enable row level security', t);
    execute format('drop policy if exists dm_read on camp.%I', t);
    execute format('create policy dm_read on camp.%I for select to authenticated using ((select camp.dm_allowed()))', t);
    execute format('grant select on camp.%I to authenticated', t);
  end loop;
  -- the three things a person sets from the page: which sources to pull, and the brand mappings
  foreach t in array array['dm_sources','dm_yt_channels','dm_places']
  loop
    execute format('drop policy if exists dm_write on camp.%I', t);
    execute format('create policy dm_write on camp.%I for all to authenticated using ((select camp.dm_allowed())) with check ((select camp.dm_allowed()))', t);
    execute format('grant insert, update, delete on camp.%I to authenticated', t);
  end loop;
end $$;

grant all on all tables in schema camp to service_role;
grant usage, select on all sequences in schema camp to service_role;

-- ---------------------------------------------------------------- daily refresh
-- 02:30 IST (21:00 UTC). Same pattern as booking-audit: the worker checks a secret kept in
-- acc.job_secrets, so only this job (or a signed-in person with the module) can start a pull.
-- One call per part, so a slow source (Search Console's per-day pages) cannot use up the time
-- another one needs; net.http_post only queues the request, so the six run side by side.
insert into acc.job_secrets(name, value)
values ('digital_metrics', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (name) do nothing;

create or replace function camp.dm_kick(p_part text) returns bigint
language sql security definer set search_path to '' as $$
  select net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/digital-metrics-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n',
      'x-dm-secret',(select value from acc.job_secrets where name='digital_metrics')),
    body := jsonb_build_object('action','sync','part',p_part),
    timeout_milliseconds := 150000)
$$;
revoke all on function camp.dm_kick(text) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'digital-metrics-daily';
select cron.schedule('digital-metrics-daily', '0 21 * * *', $cron$
  select camp.dm_kick(p) from unnest(array['yt_public','yt_own','places','gbp','gsc','ga4']) p;
$cron$);

-- ---------------------------------------------------------------- read helpers for the page
-- Totals for a period are added up HERE, from the stored daily rows, so the page never has to page
-- through thousands of rows. These run as the caller (security invoker), so the dm_read policy
-- above still decides who sees anything.
--   Ratios are recomputed from their parts, never averaged: CTR = clicks / impressions, and the
--   Search Console position is weighted by impressions (the way Search Console combines days).
--   GA4 users are NOT summed across days anywhere - somebody who visits on two days is one user;
--   the page reads the period totals Google computed (report 'period') instead.

create or replace function camp.dm_gsc_top(p_site text, p_dim text, p_from date, p_to date, p_limit int default 50)
returns table(key text, clicks bigint, impressions bigint, ctr numeric, avg_position numeric)
language sql stable set search_path to '' as $$
  select r.key, sum(r.clicks)::bigint, sum(r.impressions)::bigint,
         case when sum(r.impressions) > 0 then sum(r.clicks)::numeric / sum(r.impressions) end,
         case when sum(r.impressions) > 0 then sum(r.position * r.impressions) / sum(r.impressions) end
    from camp.dm_gsc_rows r
   where r.site_url = p_site and r.dim = p_dim and r.day between p_from and p_to
   group by r.key
   order by 2 desc, 3 desc
   limit p_limit
$$;

create or replace function camp.dm_ga4_top(p_prop text, p_report text, p_from date, p_to date, p_order text default 'sessions', p_limit int default 50)
returns table(key text, dims jsonb, metrics jsonb)
language sql stable set search_path to '' as $$
  with x as (
    select r.key, (array_agg(r.dims))[1] as dims, m.k, sum(m.v::numeric) as s
      from camp.dm_ga4_rows r, jsonb_each_text(r.metrics) m(k, v)
     where r.property_id = p_prop and r.report = p_report and r.day between p_from and p_to
       and m.k not in ('totalUsers','newUsers','activeUsers','engagementRate','averageSessionDuration')
     group by r.key, m.k
  )
  select x.key, (array_agg(x.dims))[1], jsonb_object_agg(x.k, x.s)
    from x group by x.key
   order by coalesce((jsonb_object_agg(x.k, x.s) ->> p_order)::numeric, 0) desc
   limit p_limit
$$;

create or replace function camp.dm_gbp_sum(p_from date, p_to date)
returns table(location text, metric text, value numeric, days_reported bigint)
language sql stable set search_path to '' as $$
  select d.location, d.metric, sum(d.value), count(d.value)
    from camp.dm_gbp_daily d where d.day between p_from and p_to
   group by d.location, d.metric
$$;

create or replace function camp.dm_gbp_series(p_from date, p_to date)
returns table(day date, metric text, value numeric)
language sql stable set search_path to '' as $$
  select d.day, d.metric, sum(d.value) from camp.dm_gbp_daily d
   where d.day between p_from and p_to group by d.day, d.metric order by 1
$$;

create or replace function camp.dm_yt_top_videos(p_channel text, p_from date, p_to date, p_limit int default 25)
returns table(video_id text, title text, published_at timestamptz, views numeric, minutes numeric, likes numeric,
              comments numeric, shares numeric, subscribers_gained numeric, days bigint)
language sql stable set search_path to '' as $$
  select d.video_id, v.title, v.published_at, sum(d.views), sum(d.estimated_minutes_watched), sum(d.likes),
         sum(d.comments), sum(d.shares), sum(d.subscribers_gained), count(*)
    from camp.dm_yt_own_daily d left join camp.dm_yt_videos v on v.video_id = d.video_id
   where d.channel_id = p_channel and d.video_id <> '' and d.day between p_from and p_to
   group by d.video_id, v.title, v.published_at
   order by 4 desc nulls last
   limit p_limit
$$;

-- By-day rows when the API gave them; otherwise the most recent window total (period_days > 1).
create or replace function camp.dm_yt_breakdown(p_channel text, p_dim text, p_from date, p_to date)
returns table(dim_value text, views numeric, minutes numeric, viewer_percentage numeric, period_from date, period_to date)
language sql stable set search_path to '' as $$
  with daily as (
    select b.dim_value, sum((b.metrics->>'views')::numeric) v, sum((b.metrics->>'estimatedMinutesWatched')::numeric) m,
           null::numeric p, min(b.day) f, max(b.day) t
      from camp.dm_yt_own_breakdown b
     where b.channel_id = p_channel and b.dimension = p_dim and b.period_days = 1 and b.day between p_from and p_to
     group by b.dim_value
  ), last_period as (
    select b.day, b.period_days from camp.dm_yt_own_breakdown b
     where b.channel_id = p_channel and b.dimension = p_dim and b.period_days > 1 and b.day <= p_to
     order by b.day desc limit 1
  ), period as (
    select b.dim_value, (b.metrics->>'views')::numeric v, (b.metrics->>'estimatedMinutesWatched')::numeric m,
           (b.metrics->>'viewerPercentage')::numeric p, b.day - (b.period_days - 1) f, b.day t
      from camp.dm_yt_own_breakdown b join last_period l on l.day = b.day and l.period_days = b.period_days
     where b.channel_id = p_channel and b.dimension = p_dim
  )
  select * from daily
  union all
  select * from period where not exists (select 1 from daily)
  order by 2 desc nulls last, 4 desc nulls last
$$;

-- Public YouTube counts now, against the reading nearest before the period began. If tracking
-- started inside the period, the first reading is the baseline and base_date shows it.
create or replace function camp.dm_yt_public_compare(p_from date)
returns table(channel_id text, title text, handle text, is_own boolean, watchlist_id bigint, brand text,
              latest_date date, subscribers bigint, hidden_subscribers boolean, views bigint, videos bigint,
              base_date date, base_subscribers bigint, base_views bigint, base_videos bigint,
              uploads_in_period bigint, upload_views numeric)
language sql stable set search_path to '' as $$
  select c.channel_id, c.title, c.handle, c.is_own, c.watchlist_id, w.name,
         l.snap_date, l.subscribers, l.hidden_subscribers, l.views, l.videos,
         b.snap_date, b.subscribers, b.views, b.videos,
         (select count(*) from camp.dm_yt_videos v where v.channel_id = c.channel_id and v.published_at >= p_from),
         (select sum(vd.views) from camp.dm_yt_videos v
            join lateral (select d.views from camp.dm_yt_video_daily d where d.video_id = v.video_id order by d.snap_date desc limit 1) vd on true
           where v.channel_id = c.channel_id and v.published_at >= p_from)
    from camp.dm_yt_channels c
    left join camp.competitor_watchlist w on w.id = c.watchlist_id
    left join lateral (select * from camp.dm_yt_channel_daily d where d.channel_id = c.channel_id order by d.snap_date desc limit 1) l on true
    left join lateral (select * from camp.dm_yt_channel_daily d where d.channel_id = c.channel_id
                        order by (d.snap_date <= p_from) desc,
                                 case when d.snap_date <= p_from then p_from - d.snap_date else d.snap_date - p_from end
                        limit 1) b on true
   where c.confirmed and c.active
   order by c.is_own desc, l.subscribers desc nulls last
$$;

create or replace function camp.dm_places_compare(p_from date)
returns table(place_id text, label text, address text, maps_uri text, is_own boolean, watchlist_id bigint, brand text,
              latest_date date, name text, rating numeric, user_ratings_total bigint,
              base_date date, base_rating numeric, base_total bigint)
language sql stable set search_path to '' as $$
  select p.place_id, p.label, p.address, p.maps_uri, p.is_own, p.watchlist_id, w.name,
         l.snap_date, l.name, l.rating, l.user_ratings_total, b.snap_date, b.rating, b.user_ratings_total
    from camp.dm_places p
    left join camp.competitor_watchlist w on w.id = p.watchlist_id
    left join lateral (select * from camp.dm_place_daily d where d.place_id = p.place_id order by d.snap_date desc limit 1) l on true
    left join lateral (select * from camp.dm_place_daily d where d.place_id = p.place_id
                        order by (d.snap_date <= p_from) desc,
                                 case when d.snap_date <= p_from then p_from - d.snap_date else d.snap_date - p_from end
                        limit 1) b on true
   where p.confirmed and p.active
   order by p.is_own desc, w.name, p.label
$$;

grant execute on function camp.dm_gsc_top(text,text,date,date,int), camp.dm_ga4_top(text,text,date,date,text,int),
  camp.dm_gbp_sum(date,date), camp.dm_gbp_series(date,date), camp.dm_yt_top_videos(text,date,date,int),
  camp.dm_yt_breakdown(text,text,date,date), camp.dm_yt_public_compare(date), camp.dm_places_compare(date) to authenticated;
