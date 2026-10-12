-- Competitor Ads on Proxy's free plan: every page pulled once a week, and the whole watchlist pulled
-- by hand at most twice a calendar month, without ever asking Proxy for more than the day's credits.
--
-- WHY A QUEUE. The free plan gives 20 credits a day and they do not carry over, while the watchlist
-- is heading for ~91 pages (8 brands, 20 competitors, ~63 channel partners). Pulling everything in one
-- night is impossible; spreading it is not. Each page gets one weekday (13 a day for 91 pages), and
-- the rest of each day's credits go to whatever a manual pull asked for, so a manual pull finishes in
-- the background over the following days instead of failing half way.
--
-- One credit per page per pull is an estimate from the nightly runs, not a figure Proxy publishes;
-- daily_credit_budget is a setting so it can be corrected without a code change. And the budget is a
-- ceiling, not a promise: if Proxy refuses anyway (its credits are shared with anyone using the same
-- account in Claude or Cursor), the day is marked exhausted and the pages simply wait for tomorrow.

-- ---- Three kinds of page on one watchlist -------------------------------------------------------
alter table camp.competitor_watchlist add column if not exists category text;
update camp.competitor_watchlist
   set category = case when is_own_brand then 'brand' else 'competitor' end
 where category is null;
alter table camp.competitor_watchlist alter column category set default 'competitor';
alter table camp.competitor_watchlist alter column category set not null;
do $$ begin
  alter table camp.competitor_watchlist add constraint competitor_watchlist_category_chk
    check (category in ('competitor', 'brand', 'partner'));
exception when duplicate_object then null; end $$;

-- ---- Settings, and what has been spent each day -------------------------------------------------
create table if not exists camp.competitor_sync_settings (
  id                      int primary key default 1 check (id = 1),
  daily_credit_budget     int not null default 20 check (daily_credit_budget >= 0),
  manual_pulls_per_month  int not null default 2  check (manual_pulls_per_month >= 0),
  updated_at              timestamptz not null default now()
);
insert into camp.competitor_sync_settings (id) values (1) on conflict (id) do nothing;

-- Days are UTC days. Proxy does not say when its allowance resets; the guard below only ever caps
-- what we ask for, and a refusal is handled the same whichever day Proxy thinks it is.
create table if not exists camp.proxy_credit_days (
  day         date primary key,
  used        int not null default 0,
  exhausted   boolean not null default false,
  updated_at  timestamptz not null default now()
);

-- ---- Manual pulls and the queue -----------------------------------------------------------------
create table if not exists camp.competitor_manual_runs (
  id            bigserial primary key,
  requested_by  text,
  requested_at  timestamptz not null default now(),
  pages         int not null default 0
);

create table if not exists camp.competitor_pull_queue (
  id             bigserial primary key,
  watchlist_id   bigint not null references camp.competitor_watchlist(id) on delete cascade,
  reason         text not null check (reason in ('weekly', 'manual')),
  manual_run_id  bigint references camp.competitor_manual_runs(id) on delete set null,
  status         text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  enqueued_at    timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  attempts       int not null default 0,
  ads_found      int,
  error          text
);
-- One open item per page per reason, so a page never queues twice for the same purpose.
create unique index if not exists competitor_pull_queue_open_uq
  on camp.competitor_pull_queue (watchlist_id, reason) where status in ('pending', 'running');
create index if not exists competitor_pull_queue_pending_idx
  on camp.competitor_pull_queue (status, reason, enqueued_at);
create index if not exists competitor_pull_queue_run_idx
  on camp.competitor_pull_queue (manual_run_id);

-- Staff can read all of it (the screen shows progress); nobody writes except through the functions.
alter table camp.competitor_sync_settings enable row level security;
alter table camp.proxy_credit_days       enable row level security;
alter table camp.competitor_manual_runs  enable row level security;
alter table camp.competitor_pull_queue   enable row level security;
do $$
declare t text;
begin
  foreach t in array array['competitor_sync_settings','proxy_credit_days','competitor_manual_runs','competitor_pull_queue'] loop
    execute format('drop policy if exists "staff read" on camp.%I', t);
    execute format('create policy "staff read" on camp.%I for select to authenticated using (not app.is_customer())', t);
  end loop;
end $$;
revoke insert, update, delete on camp.competitor_sync_settings, camp.proxy_credit_days,
  camp.competitor_manual_runs, camp.competitor_pull_queue from anon, authenticated;
revoke select on camp.competitor_sync_settings, camp.proxy_credit_days,
  camp.competitor_manual_runs, camp.competitor_pull_queue from anon;

-- ---- Weekly: each page gets one weekday ---------------------------------------------------------
-- Pages are dealt round-robin across the 7 days in id order, so 91 pages give 13 a day rather than
-- whatever an id % 7 happened to bunch together. A page whose weekly pull is still waiting (credits
-- ran short) is not queued twice.
create or replace function camp.competitor_enqueue_weekly()
returns int language plpgsql security definer set search_path = camp, public as $$
declare
  n int;
  v_dow int := extract(dow from (now() at time zone 'Asia/Kolkata'))::int;
begin
  insert into competitor_pull_queue (watchlist_id, reason)
  select x.id, 'weekly'
    from (select w.id, (row_number() over (order by w.id) - 1) % 7 as slot
            from competitor_watchlist w
           where w.active and nullif(btrim(w.page_id), '') is not null) x
   where x.slot = v_dow
     and not exists (select 1 from competitor_pull_queue q
                      where q.watchlist_id = x.id and q.reason = 'weekly' and q.status in ('pending', 'running'));
  get diagnostics n = row_count;
  return n;
end $$;

-- ---- Manual: the whole watchlist, at most N times a calendar month (India time) -----------------
create or replace function camp.competitor_request_manual_pull()
returns jsonb language plpgsql security definer set search_path = camp, public as $$
declare
  v_limit int;
  v_used int;
  v_run bigint;
  v_n int;
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  if auth.uid() is null or app.is_customer() then
    raise exception 'Only staff can pull competitor ads';
  end if;
  -- Serialise requests, so two people pressing at once cannot both take the last pull of the month.
  perform pg_advisory_xact_lock(hashtext('camp.competitor_request_manual_pull'));
  -- A second request while the first is still working through the queue would add nothing (every
  -- page is already waiting) yet spend one of the month's pulls, so it is refused, uncounted.
  if exists (select 1 from competitor_pull_queue where reason = 'manual' and status in ('pending', 'running')) then
    raise exception 'A manual pull is still in progress (% pages to go). You can start another once it finishes; this did not use one of your monthly pulls.',
      (select count(*) from competitor_pull_queue where reason = 'manual' and status in ('pending', 'running'));
  end if;
  select manual_pulls_per_month into v_limit from competitor_sync_settings where id = 1;
  select count(*) into v_used from competitor_manual_runs where requested_at >= v_month_start;
  if v_used >= coalesce(v_limit, 2) then
    raise exception 'Monthly limit reached (% of %). Manual pulls reset on the 1st; the weekly pull carries on as usual.',
      v_used, coalesce(v_limit, 2);
  end if;
  insert into competitor_manual_runs (requested_by) values (auth.email()) returning id into v_run;
  insert into competitor_pull_queue (watchlist_id, reason, manual_run_id)
  select w.id, 'manual', v_run
    from competitor_watchlist w
   where w.active and nullif(btrim(w.page_id), '') is not null
     and not exists (select 1 from competitor_pull_queue q
                      where q.watchlist_id = w.id and q.reason = 'manual' and q.status in ('pending', 'running'));
  get diagnostics v_n = row_count;
  update competitor_manual_runs set pages = v_n where id = v_run;
  return jsonb_build_object('run_id', v_run, 'pages', v_n, 'used', v_used + 1, 'limit', coalesce(v_limit, 2));
end $$;

-- ---- The worker's side: take what today's credits allow, then report back -----------------------
create or replace function camp.competitor_claim_pulls(p_max int default 4)
returns table (queue_id bigint, watchlist_id bigint, name text, page_id text, reason text)
language plpgsql security definer set search_path = camp, public as $$
#variable_conflict use_column
declare
  v_day date := (now() at time zone 'utc')::date;
  v_budget int;
  v_used int;
  v_ex boolean;
  v_left int;
  v_n int;
begin
  -- A pull that started and never reported back (the function was killed) goes back in line.
  update competitor_pull_queue set status = 'pending'
   where status = 'running' and started_at < now() - interval '20 minutes';
  insert into proxy_credit_days (day) values (v_day) on conflict (day) do nothing;
  select daily_credit_budget into v_budget from competitor_sync_settings where id = 1;
  select d.used, d.exhausted into v_used, v_ex from proxy_credit_days d where d.day = v_day for update;
  v_left := least(greatest(coalesce(p_max, 4), 0), coalesce(v_budget, 20) - v_used);
  if v_ex or v_left <= 0 then return; end if;

  -- This week's pages first, so the weekly cadence holds; manual requests use what is left.
  return query
  with picked as (
    select q.id
      from competitor_pull_queue q
      join competitor_watchlist w on w.id = q.watchlist_id
     where q.status = 'pending' and w.active and nullif(btrim(w.page_id), '') is not null
     order by (q.reason = 'weekly') desc, q.enqueued_at, q.id
     limit v_left
     for update of q skip locked
  ), upd as (
    update competitor_pull_queue q
       set status = 'running', started_at = now(), attempts = q.attempts + 1
      from picked where q.id = picked.id
    returning q.id, q.watchlist_id, q.reason
  )
  select upd.id, upd.watchlist_id, w.name, btrim(w.page_id), upd.reason
    from upd join competitor_watchlist w on w.id = upd.watchlist_id;
  get diagnostics v_n = row_count;

  -- Credits are counted when asked for, not when answered: a pull that dies half way still spent them.
  update proxy_credit_days d set used = d.used + v_n, updated_at = now() where d.day = v_day;
end $$;

create or replace function camp.competitor_finish_pulls(p_results jsonb, p_refused boolean default false)
returns void language plpgsql security definer set search_path = camp, public as $$
declare
  r jsonb;
  v_id bigint;
begin
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    v_id := (r->>'queue_id')::bigint;
    if coalesce((r->>'ok')::boolean, false) then
      update competitor_pull_queue
         set status = 'done', finished_at = now(), ads_found = nullif(r->>'ads', '')::int, error = null
       where id = v_id;
    elsif p_refused then
      -- Proxy said no (credits gone): not this page's fault, so the attempt does not count.
      update competitor_pull_queue
         set status = 'pending', attempts = greatest(attempts - 1, 0), error = r->>'error'
       where id = v_id;
    else
      update competitor_pull_queue
         set status = case when attempts >= 3 then 'failed' else 'pending' end,
             finished_at = case when attempts >= 3 then now() end,
             error = r->>'error'
       where id = v_id;
    end if;
  end loop;
  if p_refused then
    update proxy_credit_days set exhausted = true, updated_at = now()
     where day = (now() at time zone 'utc')::date;
  end if;
end $$;

-- ---- What the screen shows ----------------------------------------------------------------------
create or replace function camp.competitor_pull_status()
returns jsonb language plpgsql stable security definer set search_path = camp, public as $$
declare
  v jsonb;
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  if auth.uid() is null or app.is_customer() then
    raise exception 'Only staff can see the pull status';
  end if;
  select jsonb_build_object(
    'budget',          s.daily_credit_budget,
    'used_today',      coalesce(d.used, 0),
    'exhausted_today', coalesce(d.exhausted, false),
    'manual_limit',    s.manual_pulls_per_month,
    'manual_used',     (select count(*) from competitor_manual_runs where requested_at >= v_month_start),
    'pages_tracked',   (select count(*) from competitor_watchlist where active and nullif(btrim(page_id), '') is not null),
    'pending_weekly',  (select count(*) from competitor_pull_queue where reason = 'weekly' and status in ('pending', 'running')),
    'pending_manual',  (select count(*) from competitor_pull_queue where reason = 'manual' and status in ('pending', 'running')),
    'run', (select jsonb_build_object(
                     'id', r.id, 'requested_at', r.requested_at, 'requested_by', r.requested_by, 'pages', r.pages,
                     'finished', (select count(*) from competitor_pull_queue q
                                   where q.manual_run_id = r.id and q.status in ('done', 'failed')),
                     'failed',   (select count(*) from competitor_pull_queue q
                                   where q.manual_run_id = r.id and q.status = 'failed'))
              from competitor_manual_runs r order by r.id desc limit 1)
  ) into v
  from competitor_sync_settings s
  left join proxy_credit_days d on d.day = (now() at time zone 'utc')::date
  where s.id = 1;
  return v;
end $$;

-- ---- Who may call what --------------------------------------------------------------------------
revoke all on function camp.competitor_enqueue_weekly()               from public, anon, authenticated;
revoke all on function camp.competitor_claim_pulls(int)               from public, anon, authenticated;
revoke all on function camp.competitor_finish_pulls(jsonb, boolean)   from public, anon, authenticated;
revoke all on function camp.competitor_request_manual_pull()          from public, anon;
revoke all on function camp.competitor_pull_status()                  from public, anon;
grant execute on function camp.competitor_claim_pulls(int)             to service_role;
grant execute on function camp.competitor_finish_pulls(jsonb, boolean) to service_role;
grant execute on function camp.competitor_request_manual_pull()        to authenticated;
grant execute on function camp.competitor_pull_status()                to authenticated;

-- ---- Schedule -----------------------------------------------------------------------------------
-- The worker is only woken when there is something waiting and credit left, so the every-ten-minutes
-- schedule costs nothing on a quiet day. It runs as the cron owner, never from the API.
create or replace function camp.competitor_kick_worker()
returns bigint language plpgsql security definer set search_path = camp, public as $$
declare
  v_budget int;
  v_used int;
  v_ex boolean;
begin
  select daily_credit_budget into v_budget from competitor_sync_settings where id = 1;
  select used, exhausted into v_used, v_ex from proxy_credit_days where day = (now() at time zone 'utc')::date;
  if coalesce(v_ex, false) or coalesce(v_used, 0) >= coalesce(v_budget, 20) then return null; end if;
  if not exists (select 1 from competitor_pull_queue where status = 'pending') then return null; end if;
  return net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/competitor-sync-test-probe?action=work',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n"}'::jsonb,
    body := '{"max":4}'::jsonb,
    timeout_milliseconds := 300000);
end $$;
revoke all on function camp.competitor_kick_worker() from public, anon, authenticated;

-- The old twice-a-night pull of the first 24 pages is replaced by the queue.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'competitor-ads-proxy-daily') then
    perform cron.unschedule('competitor-ads-proxy-daily');
  end if;
end $$;
-- 00:00 UTC (05:30 IST): queue today's weekly share. Workers start at :05, after it.
select cron.schedule('competitor-ads-weekly-enqueue', '0 0 * * *',
  $$ select camp.competitor_enqueue_weekly(); $$);
select cron.schedule('competitor-ads-queue-worker', '5-55/10 * * * *',
  $$ select camp.competitor_kick_worker(); $$);
