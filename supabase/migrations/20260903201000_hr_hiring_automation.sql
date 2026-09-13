-- Hiring automation, part 1: the stage list the Monthly Update actually uses, a
-- requisition that creates its own tracker row, and the monthly rollover.
--
-- Nothing here touches hr.monthly_updates (the old jsonb grid) or the 590 rows in
-- hr.interview_tracker. Both stay exactly as they are until their own migration.

-- ── the eight columns of the Monthly Update ───────────────────────────────────
-- Replaces the eleven-stage list that was seeded earlier. Safe to rewrite: no row
-- in hr.candidates references a stage label yet (the table is empty), and nothing
-- has a foreign key onto hr.tracker_stages.
--
-- counts_as marks the two stages that are outcomes rather than steps — a candidate
-- sitting in them has left the funnel, and the carry-forward below ignores them.
delete from hr.tracker_stages;
insert into hr.tracker_stages (seq, label, counts_as) values
  (1, 'Test Sent',           null),
  (2, 'Test Passed',         null),
  (3, 'Interview Scheduled', null),
  (4, 'Interview Done',      null),
  (5, 'Selected',            null),
  (6, 'Back Out',            'exit'),
  (7, 'Negotiated',          null),
  (8, 'Joined',              'filled');

-- InternShala joins the job boards the recruiters actually use.
insert into hr.sources (name, sort) values ('InternShala', 35)
on conflict (name) do nothing;

-- ── how many people a requisition is still short of ───────────────────────────
-- no_of_vacancy is free text on hr.manpower_requests ('2', 'two', '', ...), so it is
-- read defensively: anything that is not a plain number counts as one vacancy rather
-- than zero, because zero would silently close a row that is still open.
create or replace function hr.vacancy_count(req_id bigint)
returns integer language sql stable as $$
  select greatest(
    coalesce(
      (select nullif(regexp_replace(coalesce(no_of_vacancy,''), '[^0-9]', '', 'g'), '')::int
         from hr.manpower_requests where id = req_id),
      1),
    1)
$$;

-- A tracker row is "filled" once it has as many Joined candidates as the requisition
-- asked for. Anything less rolls into next month.
create or replace function hr.row_is_filled(row_id bigint)
returns boolean language sql stable as $$
  select (select count(*) from hr.candidates
           where tracker_row_id = row_id and stage = 'Joined')
         >= hr.vacancy_count((select manpower_request_id from hr.tracker_rows where id = row_id))
$$;

-- ── a new requisition opens its own row in the current month ──────────────────
-- Requirement: every ManPower Form response becomes a row in that month's Monthly
-- Update. Done as a trigger rather than in the browser so it cannot be skipped by a
-- failed round-trip, an import, or a row inserted from SQL.
create or replace function hr.mp_open_tracker_row()
returns trigger language plpgsql security definer set search_path = hr, public as $$
declare
  m date := date_trunc('month', coalesce(new.submitted_at, now()))::date;
begin
  if coalesce(btrim(new.job_title), '') = '' then
    return new;   -- nothing to track a row against
  end if;

  insert into hr.tracker_rows (month, manpower_request_id, position)
  select m, new.id, btrim(new.job_title)
  where not exists (
    select 1 from hr.tracker_rows
     where month = m and manpower_request_id = new.id
  );

  return new;
end $$;

drop trigger if exists mp_open_tracker_row on hr.manpower_requests;
create trigger mp_open_tracker_row
  after insert on hr.manpower_requests
  for each row execute function hr.mp_open_tracker_row();

-- ── the monthly rollover ──────────────────────────────────────────────────────
-- Runs on the 1st. Two jobs, in this order:
--   1. carry forward every row from last month that is not yet filled
--   2. open a row for any requisition that has no row this month at all
-- Idempotent: running it twice on the same day changes nothing, so a retry after a
-- failure is safe, and it can be called by hand to build the current month early.
create or replace function hr.roll_forward_month(target_month date default null)
returns table (carried integer, opened integer)
language plpgsql security definer set search_path = hr, public as $$
declare
  -- The month is worked out in IST, not UTC. The office rolls over at midnight India
  -- time, and a UTC-based date_trunc would still say "last month" for the first five
  -- and a half hours of every 1st.
  m    date := coalesce(
                date_trunc('month', target_month)::date,
                date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date);
  prev date := (m - interval '1 month')::date;
  c    integer := 0;
  o    integer := 0;
begin
  with moved as (
    insert into hr.tracker_rows (month, manpower_request_id, position, carried_from_row_id)
    select m, r.manpower_request_id, r.position, r.id
      from hr.tracker_rows r
     where r.month = prev
       and not hr.row_is_filled(r.id)
       and not exists (
         select 1 from hr.tracker_rows x
          where x.month = m and x.manpower_request_id = r.manpower_request_id
       )
    returning 1
  )
  select count(*) into c from moved;

  with fresh as (
    insert into hr.tracker_rows (month, manpower_request_id, position)
    select m, q.id, btrim(q.job_title)
      from hr.manpower_requests q
     where coalesce(btrim(q.job_title), '') <> ''
       and not exists (
         select 1 from hr.tracker_rows x
          where x.month = m and x.manpower_request_id = q.id
       )
       and exists (   -- only requisitions that were ever tracked; avoids resurrecting
         select 1 from hr.tracker_rows y where y.manpower_request_id = q.id
       )
    returning 1
  )
  select count(*) into o from fresh;

  return query select c, o;
end $$;

grant execute on function hr.roll_forward_month(date) to authenticated;

-- Fires daily at 18:35 UTC, which is 00:05 IST. Deliberately daily rather than only on
-- the 1st: the function is idempotent, so every other day of the month is a no-op, and
-- a month that was missed (database asleep, migration mid-flight) is picked up the next
-- night instead of waiting until the following month.
select cron.schedule(
  'hr-month-rollover',
  '35 18 * * *',
  $cron$ select hr.roll_forward_month(); $cron$
);
