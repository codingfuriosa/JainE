-- Our Brand: Facebook and Google ad results, one row per campaign (and per ad) per DAY (30 Oct 2026).
--
-- WHY. The old tables (campaign_insights, g_campaign_insights, ...) stored one total per campaign per
-- named period ('last_month', 'today', ...), written only when somebody opened that period. Rows of a
-- campaign that had stopped were never removed, so 'last_month' could still hold June beside August
-- and the screen added both (Rs 11.0 lakh shown against Rs 6.4 lakh real). The Facebook rows came
-- from a script on the office PC and stopped on 12 Oct 2026.
--
-- NOW. The ads-daily-sync edge function reads both platforms on the server every 3 hours, by day.
-- Each read REPLACES the days it covers for that account (delete, then insert), so a day always
-- holds exactly what the platform reports for it now - no leftovers. Any period on screen is the
-- sum of its days. Numbers are stored as the platform gives them; nothing is estimated.
--   results = Facebook: leads (action 'lead'; else 'onsite_conversion.lead_grouped' - never a sum of
--             every lead-like action, which double counts); Google: metrics.conversions (Google's own
--             "Conversions" column, can be fractional).
-- Reach and frequency are NOT stored per day: they are unique-people counts and cannot be added
-- across days or campaigns.

-- Which ad accounts count as Our Brand. Facebook list as chosen by the user on 30 Oct 2026: the
-- real-estate accounts, Durbaar and Sarovar Hotel. Google accounts are the ones the Google Ads
-- connection is set up for (GOOGLE_ADS_CUSTOMER_IDS); the sync adds them here with their names.
create table if not exists camp.ads_accounts (
  platform     text not null check (platform in ('meta','google')),
  account_id   text not null,
  name         text,
  project      text,                         -- the project / business it advertises, for grouping
  include      boolean not null default true,
  currency     text,
  backfilled_from date,                      -- oldest day read so far (history is read backwards)
  last_ok_at   timestamptz,
  last_error   text,
  primary key (platform, account_id)
);

create table if not exists camp.ads_entities (
  platform    text not null,
  kind        text not null check (kind in ('campaign','ad')),
  id          text not null,
  account_id  text not null,
  campaign_id text,
  name        text,
  status      text,                          -- as the platform reports it (ACTIVE, PAUSED, ENABLED, ...)
  objective   text,
  daily_budget    numeric,                   -- in the account currency; null when the platform gives none
  lifetime_budget numeric,
  thumbnail   text,                          -- ad picture (Facebook creative thumbnail)
  body        text,                          -- ad text / headline
  updated_at  timestamptz not null default now(),
  primary key (platform, kind, id)
);

create table if not exists camp.ads_daily (
  platform    text not null,
  account_id  text not null,
  campaign_id text not null,
  day         date not null,
  spend       numeric not null default 0,
  impressions bigint not null default 0,
  clicks      bigint not null default 0,
  results     numeric not null default 0,
  synced_at   timestamptz not null default now(),
  primary key (platform, campaign_id, day)
);
create index if not exists ads_daily_day on camp.ads_daily (platform, day);

create table if not exists camp.ads_ad_daily (
  platform    text not null,
  account_id  text not null,
  campaign_id text,
  ad_id       text not null,
  day         date not null,
  spend       numeric not null default 0,
  impressions bigint not null default 0,
  clicks      bigint not null default 0,
  results     numeric not null default 0,
  synced_at   timestamptz not null default now(),
  primary key (platform, ad_id, day)
);
create index if not exists ads_ad_daily_day on camp.ads_ad_daily (platform, day);

create table if not exists camp.ads_sync_log (
  id          bigserial primary key,
  platform    text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  rows        int,
  message     text
);

do $$ declare t text; begin
  foreach t in array array['ads_accounts','ads_entities','ads_daily','ads_ad_daily','ads_sync_log'] loop
    execute format('alter table camp.%I enable row level security', t);
    execute format('drop policy if exists "staff read" on camp.%I', t);
    execute format('create policy "staff read" on camp.%I for select to authenticated using (not app.is_customer())', t);
    execute format('grant select on camp.%I to authenticated', t);
    execute format('grant all on camp.%I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema camp to service_role;

insert into camp.ads_accounts (platform, account_id, name, project) values
  ('meta','3312884722211162','Dream Valley','Dream Valley'),
  ('meta','1372203843979040','Dream Gurukul','Dream Gurukul'),
  ('meta','946576625203189','Dream One','Dream One'),
  ('meta','1177378160937176','Dream Eco City','Dream Eco City'),
  ('meta','25220702737632870','Dream Exotica','Dream Exotica'),
  ('meta','1164450552383087','Dream World City','Dream World City'),
  ('meta','1790489074931060','Dream Ananta','Dream Ananta'),
  ('meta','1107928311218039','Dream Diamond','Dream Diamond'),
  ('meta','1137571264616646','Durbaar Banquets','Durbaar'),
  ('meta','1800681247252156','Sarovar Hotel','Sarovar Hotel')
on conflict (platform, account_id) do nothing;

-- Period totals for the screen: per campaign, summed over the days of [p_from, p_to].
create or replace function camp.ads_campaign_totals(p_platform text, p_from date, p_to date)
returns table(account_id text, campaign_id text, spend numeric, impressions bigint, clicks bigint, results numeric, days int)
language sql stable set search_path to '' as $$
  select d.account_id, d.campaign_id, sum(d.spend), sum(d.impressions)::bigint, sum(d.clicks)::bigint, sum(d.results), count(*)::int
    from camp.ads_daily d
    join camp.ads_accounts a on a.platform = d.platform and a.account_id = d.account_id and a.include
   where d.platform = p_platform and d.day between p_from and p_to
   group by 1, 2
$$;
-- Day-by-day totals (all included accounts) for the chart.
create or replace function camp.ads_by_day(p_platform text, p_from date, p_to date)
returns table(day date, spend numeric, impressions bigint, clicks bigint, results numeric)
language sql stable set search_path to '' as $$
  select d.day, sum(d.spend), sum(d.impressions)::bigint, sum(d.clicks)::bigint, sum(d.results)
    from camp.ads_daily d
    join camp.ads_accounts a on a.platform = d.platform and a.account_id = d.account_id and a.include
   where d.platform = p_platform and d.day between p_from and p_to
   group by 1 order by 1
$$;
-- Ads with spend in the period, biggest spend first.
create or replace function camp.ads_ad_totals(p_platform text, p_from date, p_to date, p_limit int default 60)
returns table(ad_id text, account_id text, campaign_id text, spend numeric, impressions bigint, clicks bigint, results numeric)
language sql stable set search_path to '' as $$
  select d.ad_id, d.account_id, max(d.campaign_id), sum(d.spend), sum(d.impressions)::bigint, sum(d.clicks)::bigint, sum(d.results)
    from camp.ads_ad_daily d
    join camp.ads_accounts a on a.platform = d.platform and a.account_id = d.account_id and a.include
   where d.platform = p_platform and d.day between p_from and p_to
   group by 1, 2 having sum(d.spend) > 0 or sum(d.impressions) > 0
   order by 4 desc limit p_limit
$$;
grant execute on function camp.ads_campaign_totals(text, date, date) to authenticated;
grant execute on function camp.ads_by_day(text, date, date) to authenticated;
grant execute on function camp.ads_ad_totals(text, date, date, int) to authenticated;

-- The schedule's own key, generated here and read only by the database and the function.
insert into acc.job_secrets (name, value) values ('ads_daily', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (name) do nothing;

create or replace function camp.ads_kick(p_platform text)
returns bigint language sql security definer set search_path to '' as $$
  select net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/ads-daily-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n',
      'x-ads-secret',(select value from acc.job_secrets where name='ads_daily')),
    body := jsonb_build_object('platform', p_platform),
    timeout_milliseconds := 150000)
$$;
revoke all on function camp.ads_kick(text) from public, anon, authenticated;

-- Facebook hourly (each run reads the stalest accounts first, as far as its time allows), Google
-- every 3 hours. Each call is its own function run.
select cron.unschedule(jobname) from cron.job where jobname in ('ads-daily-sync','ads-daily-sync-meta','ads-daily-sync-google');
select cron.schedule('ads-daily-sync-meta', '37 * * * *', $$ select camp.ads_kick('meta'); $$);
select cron.schedule('ads-daily-sync-google', '7 */3 * * *', $$ select camp.ads_kick('google'); $$);

-- Google accounts arrive with the first run (from GOOGLE_ADS_CUSTOMER_IDS); their projects, and the
-- same rule as Facebook (real estate, Durbaar, Sarovar - not Holiday Inn), set once they exist.
update camp.ads_accounts set project = case account_id
  when '3586041478' then 'Dream Diamond' when '7845237409' then 'Dream Eco City' when '8968958878' then 'Dream Exotica'
  when '9885817994' then 'Dream Gurukul' when '8383933950' then 'Dream Valley' when '6233590495' then 'Durbaar'
  when '5857891252' then 'Dream World City' when '3594251599' then 'Holiday Inn' when '8392984077' then 'Dream One' end
 where platform = 'google';
update camp.ads_accounts set include = false where platform = 'google' and account_id = '3594251599';
