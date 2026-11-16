-- MARKET WATCH (14 Nov 2026): the YouTube videos behind the Trends and Hook Library tabs, filled by the
-- market-watch edge function. One row per kind ('trend' | 'hook') + tag (region code for trends, search
-- name for hooks) + video. last_seen = the last time YouTube listed it there. Read by any signed-in user.
create table if not exists camp.mkt_videos (
  kind         text not null check (kind in ('trend','hook')),
  tag          text not null,
  video_id     text not null,
  rank         int,
  title        text not null default '',
  channel      text,
  channel_id   text,
  published_at timestamptz,
  duration_s   int,
  category_id  text,
  views        bigint,
  likes        bigint,
  comments     bigint,
  thumb        text,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  primary key (kind, tag, video_id)
);
create index if not exists mkt_videos_seen on camp.mkt_videos (kind, last_seen desc);
alter table camp.mkt_videos enable row level security;
drop policy if exists mkt_videos_read on camp.mkt_videos;
create policy mkt_videos_read on camp.mkt_videos for select to authenticated using (true);
grant select on camp.mkt_videos to authenticated;
grant all on camp.mkt_videos to service_role;

-- The cron's key, and a refresh every 3 hours (the function itself only re-reads hooks once a day).
insert into acc.job_secrets(name, value) values ('market_watch', encode(extensions.gen_random_bytes(24),'hex'))
  on conflict (name) do nothing;
select cron.unschedule('market-watch-refresh') where exists (select 1 from cron.job where jobname='market-watch-refresh');
select cron.schedule('market-watch-refresh', '17 */3 * * *', $$
  select net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/market-watch',
    headers := jsonb_build_object('Content-Type','application/json',
      'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n',
      'x-mw-secret', (select value from acc.job_secrets where name='market_watch')),
    body := '{"action":"refresh"}'::jsonb, timeout_milliseconds := 120000);
$$);
notify pgrst, 'reload schema';
