-- FACEBOOK CHECKLIST (18 Nov 2026, Ayush: "Pre-emptive Alert - Checklists.xlsx", Facebook sheet). Every run of the edge
-- function fb-checklist (daily 10:00 IST; the weekly points on Mondays) and every campaign / ad set / ad / project it found
-- breaking a point. The Checklist tab shows the latest run of each kind; each point's findings go out as one email.
create table if not exists camp.fb_check_runs (
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
create table if not exists camp.fb_check_flags (
  id bigserial primary key,
  run_id bigint not null references camp.fb_check_runs(id) on delete cascade,
  kind text not null,
  section text not null,
  point text not null,
  level text not null,               -- project | campaign | adset | ad
  project text,
  campaign_id text, adset_id text, ad_id text,
  name text,
  campaign_name text, adset_name text,
  value text,
  lim text,
  sev text not null default 'alert'  -- alert | red
);
create index if not exists fb_check_flags_run on camp.fb_check_flags (run_id);
alter table camp.fb_check_runs enable row level security;
alter table camp.fb_check_flags enable row level security;
drop policy if exists fb_check_runs_read on camp.fb_check_runs;
create policy fb_check_runs_read on camp.fb_check_runs for select to authenticated using (not app.is_customer());
drop policy if exists fb_check_flags_read on camp.fb_check_flags;
create policy fb_check_flags_read on camp.fb_check_flags for select to authenticated using (not app.is_customer());
grant select on camp.fb_check_runs, camp.fb_check_flags to authenticated;
notify pgrst, 'reload schema';
