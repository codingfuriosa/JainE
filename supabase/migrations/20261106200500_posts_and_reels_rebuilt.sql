-- POSTS & REELS REBUILT (6 Nov 2026), as asked: organic Facebook - and Instagram once it is linked to
-- the Page - pulled automatically every morning. The module was removed on 16 Oct
-- (20261016130000_remove_posts_and_reels.sql); this starts it again on new tables.
--
-- Filled ONLY by the edge function social-organic-live (service role). Everyone who is staff can read;
-- nobody can write from a browser. See the function's header for which Meta numbers exist and why
-- per-post reach is not stored (Meta accepts the name but returns 0 for every post).
--
--   camp.social_pages      one row per Facebook Page / Instagram account
--   camp.social_posts      one row per post, reel or carousel (upserted by Meta's id)
--   camp.social_page_daily one row per Page per day: Viewers (the Page's reach), Views, follows...
--   camp.social_sync_state one row: when it last ran, what it brought, the last problem
--   cron 'social-organic-daily' 06:00 IST, x-sync-secret = acc.job_secrets 'social_organic'

create table if not exists camp.social_pages (
  id          text primary key,
  network     text not null,               -- facebook | instagram
  name        text,
  username    text,
  picture     text,
  followers   bigint,
  fan_count   bigint,
  ig_id       text,
  ig_username text,
  updated_at  timestamptz default now()
);

create table if not exists camp.social_posts (
  id                  text primary key,
  page_id             text,
  page_name           text,
  network             text not null,       -- facebook | instagram
  kind                text,                -- post | video | reel | carousel
  message             text,
  permalink           text,
  media_url           text,
  thumbnail           text,
  created_time        timestamptz,
  likes               bigint default 0,    -- all reactions on Facebook, likes on Instagram
  comments            bigint default 0,
  shares              bigint default 0,
  saves               bigint default 0,
  interactions        bigint default 0,
  reactions           jsonb,
  views               bigint default 0,    -- Meta's Views (post_media_view / reel plays / IG views)
  reach               bigint default 0,    -- Instagram only: Meta gives no per-post reach on Facebook
  clicks              bigint default 0,
  clicks_by_type      jsonb,
  video_views         bigint default 0,
  viewers             bigint default 0,    -- unique video viewers (Facebook video posts)
  plays               bigint default 0,
  replays             bigint default 0,
  follows             bigint default 0,
  video_total_time_ms bigint default 0,
  video_avg_watch_ms  bigint default 0,
  video_length_s      numeric,
  first_synced_at     timestamptz default now(),
  synced_at           timestamptz default now()
);
create index if not exists social_posts_created_idx on camp.social_posts (created_time desc);
create index if not exists social_posts_page_idx on camp.social_posts (page_id);

create table if not exists camp.social_page_daily (
  page_id      text not null,
  day          date not null,
  viewers      bigint,                     -- page_total_media_view_unique: the Page's reach that day
  views        bigint,
  followers    bigint,
  new_follows  bigint,
  unfollows    bigint,
  engagements  bigint,
  page_visits  bigint,
  video_views  bigint,
  synced_at    timestamptz default now(),
  primary key (page_id, day)
);

create table if not exists camp.social_sync_state (
  id            int primary key default 1 check (id = 1),
  last_sync_at  timestamptz,
  last_trigger  text,                      -- cron | button | backfill
  last_result   jsonb,
  last_error    text,
  last_error_at timestamptz,
  updated_at    timestamptz default now()
);
insert into camp.social_sync_state (id) values (1) on conflict (id) do nothing;

do $$
declare t text;
begin
  foreach t in array array['social_pages','social_posts','social_page_daily','social_sync_state'] loop
    execute format('alter table camp.%I enable row level security', t);
    execute format('drop policy if exists %I on camp.%I', t || '_read', t);
    execute format('create policy %I on camp.%I for select to authenticated using (not (select app.is_customer()))', t || '_read', t);
    execute format('revoke all on camp.%I from anon', t);
    execute format('grant select on camp.%I to authenticated', t);
  end loop;
end $$;

insert into acc.job_secrets (name, value)
values ('social_organic', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

select cron.unschedule(jobid) from cron.job where jobname = 'social-organic-daily';
select cron.schedule('social-organic-daily', '30 0 * * *', $cron$
  select net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/social-organic-live',
    headers := jsonb_build_object('Content-Type','application/json',
      'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n',
      'x-sync-secret', (select value from acc.job_secrets where name = 'social_organic')),
    body := '{"mode":"daily"}'::jsonb,
    timeout_milliseconds := 150000);
$cron$);
