-- Project Scheduling (Operations) — core tables.
-- Lives in the `acc` schema because that is the one already exposed through PostgREST
-- and used by the other Operations modules (e.g. acc.inspection).

create table if not exists acc.sched_contractors(
  id             bigint generated always as identity primary key,
  name           text not null,
  code           text unique,
  trade          text,
  contact_person text,
  phone          text,
  email          text,
  active         boolean not null default true,
  created_by     text,
  created_at     timestamptz not null default now()
);

-- One schedule = one plan for one project. The calendar (week-offs + holidays) lives here so
-- every date calculation for the plan uses the same working-day definition.
create table if not exists acc.sched_schedules(
  id          bigint generated always as identity primary key,
  project     text not null,
  name        text not null,
  description text,
  status      text not null default 'Active' check (status in ('Draft','Active','Closed')),
  data_date   date not null default ((now() at time zone 'Asia/Kolkata')::date),
  week_offs   int[] not null default '{0}',   -- 0=Sun … 6=Sat, days that are NOT worked
  holidays    date[] not null default '{}',
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Activities. parent_id gives the WBS tree: a row with is_group=true is a summary/group whose
-- dates roll up from its children rather than being scheduled directly.
create table if not exists acc.sched_activities(
  id               bigint generated always as identity primary key,
  schedule_id      bigint not null references acc.sched_schedules(id) on delete cascade,
  parent_id        bigint references acc.sched_activities(id) on delete cascade,
  code             text,
  name             text not null,
  is_group         boolean not null default false,
  level            text not null default 'Project'
                   check (level in ('Project','Tower','Floor','Flat','Room')),
  tower            text,
  floor            text,
  flat             text,
  room             text,
  work_category    text,
  planned_start    date,
  planned_duration int not null default 1 check (planned_duration >= 0),
  actual_start     date,
  actual_finish    date,
  progress_pct     int not null default 0 check (progress_pct between 0 and 100),
  assigned_to      text,
  contractor_id    bigint references acc.sched_contractors(id) on delete set null,
  constraint_type  text not null default 'ASAP'
                   check (constraint_type in ('ASAP','SNET','FNLT','MSO')),
  constraint_date  date,
  notes            text,
  sort_order       int not null default 0,
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint sched_act_actual_order
    check (actual_start is null or actual_finish is null or actual_finish >= actual_start),
  constraint sched_act_finish_needs_start
    check (actual_finish is null or actual_start is not null)
);
create index if not exists sched_act_sched_idx  on acc.sched_activities(schedule_id);
create index if not exists sched_act_parent_idx on acc.sched_activities(parent_id);

create table if not exists acc.sched_deps(
  id          bigint generated always as identity primary key,
  schedule_id bigint not null references acc.sched_schedules(id) on delete cascade,
  pred_id     bigint not null references acc.sched_activities(id) on delete cascade,
  succ_id     bigint not null references acc.sched_activities(id) on delete cascade,
  dep_type    text not null default 'FS' check (dep_type in ('FS','SS','FF','SF')),
  lag_days    int not null default 0,
  created_by  text,
  created_at  timestamptz not null default now(),
  constraint sched_dep_no_self check (pred_id <> succ_id),
  unique (pred_id, succ_id)
);
create index if not exists sched_dep_sched_idx on acc.sched_deps(schedule_id);

create table if not exists acc.sched_baselines(
  id          bigint generated always as identity primary key,
  schedule_id bigint not null references acc.sched_schedules(id) on delete cascade,
  seq         int not null,
  name        text not null,
  note        text,
  source      text not null default 'manual' check (source in ('manual','reschedule')),
  is_current  boolean not null default false,
  created_by  text,
  created_at  timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  unique (schedule_id, seq)
);

create table if not exists acc.sched_baseline_items(
  id               bigint generated always as identity primary key,
  baseline_id      bigint not null references acc.sched_baselines(id) on delete cascade,
  activity_id      bigint not null references acc.sched_activities(id) on delete cascade,
  planned_start    date,
  planned_finish   date,
  planned_duration int,
  actual_start     date,
  actual_finish    date,
  progress_pct     int,
  unique (baseline_id, activity_id)
);

-- A reschedule proposal. Nothing is written back to the activities until it is approved.
create table if not exists acc.sched_runs(
  id          bigint generated always as identity primary key,
  schedule_id bigint not null references acc.sched_schedules(id) on delete cascade,
  data_date   date not null,
  status      text not null default 'Pending' check (status in ('Pending','Approved','Rejected')),
  note        text,
  created_by  text,
  created_at  timestamptz not null default now(),
  decided_by  text,
  decided_at  timestamptz,
  baseline_id bigint references acc.sched_baselines(id) on delete set null
);
create index if not exists sched_run_sched_idx on acc.sched_runs(schedule_id);

create table if not exists acc.sched_run_items(
  id           bigint generated always as identity primary key,
  run_id       bigint not null references acc.sched_runs(id) on delete cascade,
  activity_id  bigint not null references acc.sched_activities(id) on delete cascade,
  old_start    date, old_finish date, old_duration int,
  new_start    date, new_finish date, new_duration int,
  delta_days   int,
  unique (run_id, activity_id)
);
