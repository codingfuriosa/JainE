-- PERFORMANCE (30 Oct 2026): lookup indexes for the task overview. No behaviour change.
--
-- acc.tasks_overview() and tasks_overview_recent() find "my" tasks with
--   lower(coalesce(a.email, '')) = me     on acc.ptask_assignees
--   lower(coalesce(t.delegator, '')) = me on acc.ptasks
-- Neither had an index on that exact expression, so every call - about 3,800 in four days - read
-- both tables from start to end (ptask_assignees: 8,362 full scans, 33 million rows read). These
-- indexes match the expressions character for character, so the planner can use them; what the
-- functions return is unchanged.
--
-- Applied after office hours: on the Micro tier every schema change makes the API reload its
-- schema cache, which stalled the app for everybody during the day (see memory no-daytime-ddl).
create index if not exists ptask_assignees_email_lower_idx
  on acc.ptask_assignees (lower(coalesce(email, '')));
create index if not exists ptasks_delegator_lower_idx
  on acc.ptasks (lower(coalesce(delegator, '')));
