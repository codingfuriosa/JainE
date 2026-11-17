-- MARKET WATCH: TRENDS (17 Nov 2026, Ayush). Weekly trends for thumb-stop ideas, India and Worldwide apart, with the
-- video / photo attached when there is one. market-watch edge function, actions trends_collect / trends_compile (see
-- supabase/functions/market-watch/trends.ts). Applied by the one-time cron mw_trends_setup_once at 20:30 IST.

-- what was trending at each snapshot (4 a day), from Google Trends, YouTube trending and Apple Music
create table if not exists camp.mw_trend_raw (
  id            bigserial primary key,
  collected_at  timestamptz not null default now(),
  source        text not null,          -- google | youtube | apple
  region        text not null,          -- IN | WORLD
  country       text,
  key           text not null,
  title         text not null,
  summary       text,
  url           text,
  media_url     text,
  media_type    text,
  video_id      text,
  metric_label  text,
  metric_value  numeric,
  extra         jsonb,
  day           date not null,
  unique (source, region, key, day)
);
create index if not exists mw_trend_raw_region_day on camp.mw_trend_raw (region, day);

-- the week's trend cards
create table if not exists camp.mw_trends (
  id           bigserial primary key,
  period_from  date not null,
  period_to    date not null,
  region       text not null check (region in ('IN','WORLD')),
  type         text not null,
  title        text not null,
  what         text not null,
  happened_on  date,
  media_url    text,
  media_type   text,
  video_id     text,
  metrics      jsonb not null default '[]',
  sources      jsonb not null default '[]',
  items        jsonb not null default '[]',
  score        numeric not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists mw_trends_period on camp.mw_trends (region, period_from desc);

create table if not exists camp.mw_trend_runs (
  id      bigserial primary key,
  run_at  timestamptz not null default now(),
  kind    text not null,               -- collect | compile
  region  text,
  items   int not null default 0,
  note    text,
  error   text
);

do $$
declare t text;
begin
  foreach t in array array['mw_trend_raw','mw_trends','mw_trend_runs'] loop
    execute format('alter table camp.%I enable row level security', t);
    execute format('drop policy if exists "market watch read" on camp.%I', t);
    execute format('create policy "market watch read" on camp.%I for select to authenticated using (camp.mw_can())', t);
    execute format('revoke all on camp.%I from anon', t);
    execute format('grant select on camp.%I to authenticated', t);
    execute format('grant all on camp.%I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema camp to service_role;

-- snapshots at 00:30, 06:30, 12:30 and 18:30 IST; the week's cards every Monday 07:30 (India) and 07:35 IST (Worldwide)
select cron.schedule('mw_trends_collect', '0 1,7,13,19 * * *', $c$
  select net.http_post(url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/market-watch',
    headers := jsonb_build_object('Content-Type','application/json','x-mw-secret',(select value from acc.job_secrets where name='market_watch')),
    body := '{"action":"trends_collect"}'::jsonb, timeout_milliseconds := 120000);
$c$);
select cron.schedule('mw_trends_compile', '0 2 * * 1', $c$
  select net.http_post(url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/market-watch',
    headers := jsonb_build_object('Content-Type','application/json','x-mw-secret',(select value from acc.job_secrets where name='market_watch')),
    body := '{"action":"trends_compile","region":"IN"}'::jsonb, timeout_milliseconds := 150000);
$c$);
select cron.schedule('mw_trends_compile_world', '5 2 * * 1', $c$
  select net.http_post(url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/market-watch',
    headers := jsonb_build_object('Content-Type','application/json','x-mw-secret',(select value from acc.job_secrets where name='market_watch')),
    body := '{"action":"trends_compile","region":"WORLD"}'::jsonb, timeout_milliseconds := 150000);
$c$);

notify pgrst, 'reload schema';
