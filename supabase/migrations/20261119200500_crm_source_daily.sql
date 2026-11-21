-- CRM (RealtyBucket) SOURCE-WISE FUNNEL, by day (19 Nov 2026, Ayush: "build the Sources view").
-- source_wise_absolute_api gives, per project, a tree of lead sources (category > source > campaign > ad set > ad) with
-- what happened in the dates asked for: qualified, site visited, revisited, booked, lost. Read one day at a time by
-- ads-daily-sync {srcwise}, one row per day, project and tree node; the page adds up any period.
--   self_*  = the node's own figures (leads tagged exactly there)   tot_* = the node with everything under it
create table if not exists camp.crm_source_daily (
  day           date    not null,
  bu_id         integer not null,
  business_unit text    not null,
  node_id       bigint  not null,
  parent_id     bigint,
  level         integer not null,
  top_source    text    not null,          -- the top-level category: Online, Agent, Hoarding, Walk In ...
  source        text    not null,          -- this node's name
  self_q integer not null default 0, self_sv integer not null default 0, self_rv integer not null default 0, self_bk integer not null default 0, self_lost integer not null default 0,
  tot_q  integer not null default 0, tot_sv  integer not null default 0, tot_rv  integer not null default 0, tot_bk  integer not null default 0, tot_lost  integer not null default 0,
  fetched_at    timestamptz not null default now(),
  primary key (day, bu_id, node_id)
);
create index if not exists crm_source_daily_day on camp.crm_source_daily (day);
alter table camp.crm_source_daily enable row level security;
drop policy if exists crm_source_daily_read on camp.crm_source_daily;
create policy crm_source_daily_read on camp.crm_source_daily for select to authenticated using (true);
grant select on camp.crm_source_daily to authenticated;
grant all on camp.crm_source_daily to service_role;

-- Daily CRM Updates from the API (19 Nov 2026, Ayush: "make it through this"): one row per run of crm-daily-updates,
-- what it read, what it compared and whether the email went - so a run can always be checked afterwards.
create table if not exists acc.crm_daily_updates_runs (
  id          bigserial primary key,
  run_at      timestamptz not null default now(),
  report_date date not null,
  mode        text not null,                -- 'shadow' (compare only) or 'live' (write + email)
  ok          boolean not null default false,
  matched     boolean,                      -- shadow: did the API figures equal the rows already written
  detail      jsonb,
  email       jsonb,
  error       text
);
alter table acc.crm_daily_updates_runs enable row level security;
grant all on acc.crm_daily_updates_runs to service_role;
grant usage, select on sequence acc.crm_daily_updates_runs_id_seq to service_role;
notify pgrst, 'reload schema';
