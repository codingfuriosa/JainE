-- GOOGLE ADS CHECKLIST (19 Nov 2026, Ayush: "Pre-emptive Alert - Checklists.xlsx", Google sheet). Every run of the edge
-- function gads-checklist (daily 00:15 IST; the weekly points on Mondays 01:15 IST) and every campaign / ad / project it found
-- breaking a point. Twin of camp.fb_check_runs / camp.fb_check_flags. Each run goes out as one email.
-- Apply after 20:00 IST (no schema changes in office hours).
create table if not exists camp.gads_check_runs (
  id bigserial primary key,
  kind text not null check (kind in ('daily', 'weekly')),
  run_day date not null,
  ran_at timestamptz not null default now(),
  period_from date, period_to date,
  flags integer not null default 0,
  emailed integer not null default 0,
  notes text,
  unique (kind, run_day)
);
create table if not exists camp.gads_check_flags (
  id bigserial primary key,
  run_id bigint not null references camp.gads_check_runs(id) on delete cascade,
  kind text not null,
  section text not null,
  point text not null,
  level text not null,               -- project | campaign | ad
  project text,
  campaign_id text, adset_id text, ad_id text,
  name text,
  campaign_name text, adset_name text,
  value text,
  lim text,
  sev text not null default 'alert'  -- alert | red
);
create index if not exists gads_check_flags_run on camp.gads_check_flags (run_id);
alter table camp.gads_check_runs enable row level security;
alter table camp.gads_check_flags enable row level security;
drop policy if exists gads_check_runs_read on camp.gads_check_runs;
create policy gads_check_runs_read on camp.gads_check_runs for select to authenticated using (not app.is_customer());
drop policy if exists gads_check_flags_read on camp.gads_check_flags;
create policy gads_check_flags_read on camp.gads_check_flags for select to authenticated using (not app.is_customer());
grant select on camp.gads_check_runs, camp.gads_check_flags to authenticated;
notify pgrst, 'reload schema';

-- crons: daily 00:15 IST (18:45 UTC), weekly Monday 01:15 IST (Sunday 19:45 UTC)
select cron.unschedule(jobid) from cron.job where jobname in ('gads-checklist-daily', 'gads-checklist-weekly');
select cron.schedule('gads-checklist-daily', '45 18 * * *', $cron$select net.http_post(url:='https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/gads-checklist',
  headers:=jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n','x-ads-secret',(select value from acc.job_secrets where name='ads_daily')),
  body:='{"kind":"daily"}'::jsonb, timeout_milliseconds:=150000);$cron$);
select cron.schedule('gads-checklist-weekly', '45 19 * * 0', $cron$select net.http_post(url:='https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/gads-checklist',
  headers:=jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n','x-ads-secret',(select value from acc.job_secrets where name='ads_daily')),
  body:='{"kind":"weekly"}'::jsonb, timeout_milliseconds:=150000);$cron$);
