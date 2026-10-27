-- SEVERAL PROXY ACCOUNTS, USED ONE AFTER ANOTHER (27 Oct 2026, as asked).
-- Each Proxy sign-in gives 20 free pages a day. camp.proxy_oauth held exactly one (id 1); it now
-- holds one row per account. The puller asks them in turn: when one says its credits are spent it
-- is marked used up for the day (exhausted_day) and the next is asked. The day's page budget is
-- the per-account budget times the number of connected, switched-on accounts.

alter table camp.proxy_oauth add column if not exists active boolean not null default true;
alter table camp.proxy_oauth add column if not exists account_email text;
alter table camp.proxy_oauth add column if not exists exhausted_day date;
alter table camp.proxy_oauth add column if not exists last_error text;
alter table camp.proxy_oauth add column if not exists last_used_at timestamptz;

create sequence if not exists camp.proxy_oauth_id_seq owned by camp.proxy_oauth.id;
select setval('camp.proxy_oauth_id_seq', greatest((select max(id) from camp.proxy_oauth), 1));
alter table camp.proxy_oauth alter column id set default nextval('camp.proxy_oauth_id_seq');

create or replace function camp.competitor_claim_pulls(p_max integer default 4)
 returns table(queue_id bigint, watchlist_id bigint, name text, page_id text, reason text)
 language plpgsql security definer set search_path to 'camp', 'public' as $function$
#variable_conflict use_column
declare
  v_day date := (now() at time zone 'utc')::date;
  v_budget int;
  v_accounts int;
  v_used int;
  v_ex boolean;
  v_left int;
  v_n int;
begin
  update competitor_pull_queue set status = 'pending'
   where status = 'running' and started_at < now() - interval '20 minutes';
  insert into proxy_credit_days (day) values (v_day) on conflict (day) do nothing;
  select daily_credit_budget into v_budget from competitor_sync_settings where id = 1;
  -- the budget is per Proxy account: every connected, switched-on account adds its own 20
  select count(*) into v_accounts from proxy_oauth where refresh_token is not null and active;
  v_budget := coalesce(v_budget, 20) * greatest(v_accounts, 1);
  select d.used, d.exhausted into v_used, v_ex from proxy_credit_days d where d.day = v_day for update;
  v_left := least(greatest(coalesce(p_max, 4), 0), v_budget - v_used);
  if v_ex or v_left <= 0 then return; end if;
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
  update proxy_credit_days d set used = d.used + v_n, updated_at = now() where d.day = v_day;
end $function$;

-- The table was made for exactly one sign-in (check id = 1); several accounts need that gone.
alter table camp.proxy_oauth drop constraint if exists proxy_oauth_id_check;
