-- THE KPI CARDS COST THE SAME FIXED SCAN AS THE TABLE DID.
--
-- Even after 20260917090000 fixed the timeout, "Total Calls / Transcribed / CRM Match / CRM Mismatch"
-- and the five status chips are still computed by fetching every follow-up row in the selected range
-- and counting them in the BROWSER (trcKpiHtml in nexus-core.js). That fetch still does a Seq Scan on
-- the whole of acc.call_transcripts, acc.followup_qa and acc.transcription_queue on every request - not
-- because of the window-function chain any more, but because those three tables are only ever joined
-- to crm_followups by equality (recording_url / follow_up_id), and Postgres has no index-only way to
-- ask "just the day totals" without visiting every one of those tables in full. Measured: 3.9s for a
-- 16-day range today, growing with total row count exactly the way the old problem did.
--
-- The fix, and the one requested directly: a real per-day summary TABLE, not a view, updated
-- INCREMENTALLY - once per date, only when that date's own data actually changes - instead of
-- recomputed from scratch on every read. Reading a range then costs one indexed scan of a table with
-- one row per CALENDAR DAY (dozens, never thousands), summed client-side.
--
-- Why triggers and not "refresh after crm_normalise_snapshot" (the same shape as the materialized view
-- fix): transcription_status and queue_status for a day's rows keep changing for HOURS after that
-- day's snapshot lands, as the overnight worker (00:30-11:29 IST) works through the queue one recording
-- at a time. A summary refreshed only at snapshot time would show "Waiting" counts that never update
-- until the next midnight. So this recomputes the SPECIFIC dates a write actually touched, the moment
-- it touches them: statement-level triggers (one firing per INSERT/UPDATE statement, however many rows
-- it wrote - not one per row, which would recompute the same day's total once per row in a
-- multi-hundred-row snapshot insert) on crm_followups, call_transcripts, followup_qa and
-- transcription_queue. followup_qa and transcription_queue already carry call_date directly; only
-- call_transcripts needs a join back to crm_followups (by recording_url) to know which day(s) a
-- transcript status change belongs to, since the same recording can back more than one follow-up.
--
-- Deliberately NOT a materialized view: a matview refreshes as one all-or-nothing statement over the
-- whole relation, which is exactly the "pay it all again on every write" shape this migration exists to
-- avoid. A plain table, upserted one date at a time, is what makes "only the date that changed" possible.
--
-- Averages need care: pitch_average_score and agent_qa_average_score cannot be correctly recovered by
-- averaging each day's own average once several days are summed (a 3-call day and a 30-call day would
-- count equally). So this table stores SUM and N per score, and the average is divided out at read
-- time, once, over the whole requested range - a correctly WEIGHTED average, not an average of averages.
--
-- total_leads (count of DISTINCT leads) is the one number that does NOT sum correctly across days - a
-- lead who called on two different days within a range is one lead, not two. This table does not
-- attempt it; the frontend gets that number from its own light query directly against crm_followups
-- (indexed by call_date, no join to the three heavy tables at all) rather than from here.

begin;

create table acc.daily_qa_summary (
  date date primary key,
  total_followups integer not null default 0,
  recordings_available integer not null default 0,
  transcribed integer not null default 0,
  already_transcribed integer not null default 0,
  non_transcribable integer not null default 0,
  transcription_failed integer not null default 0,
  pending integer not null default 0,
  not_in_scope integer not null default 0,
  qa_assessed integer not null default 0,
  pitch_score_sum bigint not null default 0,
  pitch_score_n integer not null default 0,
  pitch_accurate integer not null default 0,
  pitch_partially_accurate integer not null default 0,
  pitch_inaccurate integer not null default 0,
  followup_date_accurate integer not null default 0,
  followup_date_inaccurate integer not null default 0,
  followup_date_not_verifiable integer not null default 0,
  lost_reason_accurate integer not null default 0,
  lost_reason_inaccurate integer not null default 0,
  lost_reason_not_verifiable integer not null default 0,
  remarks_accurate integer not null default 0,
  remarks_partially_accurate integer not null default 0,
  remarks_inaccurate integer not null default 0,
  remarks_not_verifiable integer not null default 0,
  status_match integer not null default 0,
  status_mismatch integer not null default 0,
  lost_should_not_have_been_lost integer not null default 0,
  qualified_should_not_have_been_qualified integer not null default 0,
  in_followup_should_have_been_lost integer not null default 0,
  in_followup_should_have_been_qualified integer not null default 0,
  agent_qa_score_sum bigint not null default 0,
  agent_qa_score_n integer not null default 0,
  reused_transcription integer not null default 0,
  updated_at timestamptz not null default now()
);

comment on table acc.daily_qa_summary is
  'One row per call_date, additive counts only (see 20260917110000). Kept current by triggers on '
  'crm_followups/call_transcripts/followup_qa/transcription_queue - never written to directly.';

alter table acc.daily_qa_summary enable row level security;
create policy daily_qa_summary_read on acc.daily_qa_summary for select to authenticated
  using (not app.is_customer());
grant select on acc.daily_qa_summary to authenticated, service_role;

-- Mirrors followup_timeline_v's own transcription_status/queue_status logic exactly (COALESCE against
-- has_recording), and daily_qa_summary_v's counting rules for everything else - same categories, same
-- edge cases, just grouped and stored per date instead of recomputed as a live join every read.
-- "not_in_scope" here matches the app's own reading of queue_status is null as out-of-scope (see the
-- README's note on queue_status vs personnel_team) - a Sales-only day's call, never queued at all.
create or replace function acc.crm_recompute_daily_qa_summary(p_dates date[])
returns void language plpgsql security definer set search_path = acc, public as $$
declare
  dates date[];
begin
  select array_agg(distinct x) into dates from unnest(p_dates) x where x is not null;
  if dates is null then return; end if;

  insert into acc.daily_qa_summary as s (
    date, total_followups, recordings_available, transcribed, already_transcribed,
    non_transcribable, transcription_failed, pending, not_in_scope, qa_assessed,
    pitch_score_sum, pitch_score_n, pitch_accurate, pitch_partially_accurate, pitch_inaccurate,
    followup_date_accurate, followup_date_inaccurate, followup_date_not_verifiable,
    lost_reason_accurate, lost_reason_inaccurate, lost_reason_not_verifiable,
    remarks_accurate, remarks_partially_accurate, remarks_inaccurate, remarks_not_verifiable,
    status_match, status_mismatch,
    lost_should_not_have_been_lost, qualified_should_not_have_been_qualified,
    in_followup_should_have_been_lost, in_followup_should_have_been_qualified,
    agent_qa_score_sum, agent_qa_score_n, reused_transcription, updated_at
  )
  select
    d.the_date,
    count(f.follow_up_id),
    count(*) filter (where f.has_recording),
    count(*) filter (where coalesce(t.status, case when f.has_recording then 'not_transcribed' else 'no_recording' end) = 'completed'),
    count(*) filter (where coalesce(q.reused_transcription, qq.reused_transcription, false)),
    count(*) filter (where coalesce(t.status, case when f.has_recording then 'not_transcribed' else 'no_recording' end) = 'non_transcribable'),
    count(*) filter (where coalesce(t.status, case when f.has_recording then 'not_transcribed' else 'no_recording' end) = 'failed' or qq.status = 'failed'),
    count(*) filter (where f.has_recording and qq.status in ('pending','transcribing','qa_pending','qa_running')),
    count(*) filter (where f.has_recording and qq.status is null),
    count(*) filter (where q.id is not null),
    coalesce(sum(q.pitch_score) filter (where q.pitch_score is not null), 0),
    count(*) filter (where q.pitch_score is not null),
    count(*) filter (where q.pitch_status = 'Accurate'),
    count(*) filter (where q.pitch_status = 'Partially Accurate'),
    count(*) filter (where q.pitch_status = 'Inaccurate'),
    count(*) filter (where q.followup_date_status = 'Accurate'),
    count(*) filter (where q.followup_date_status = 'Inaccurate'),
    count(*) filter (where q.followup_date_status = 'Not Verifiable'),
    count(*) filter (where q.lost_reason_status = 'Accurate'),
    count(*) filter (where q.lost_reason_status = 'Inaccurate'),
    count(*) filter (where q.lost_reason_status = 'Not Verifiable'),
    count(*) filter (where q.remarks_status = 'Accurate'),
    count(*) filter (where q.remarks_status = 'Partially Accurate'),
    count(*) filter (where q.remarks_status = 'Inaccurate'),
    count(*) filter (where q.remarks_status = 'Not Verifiable'),
    count(*) filter (where q.status_match),
    count(*) filter (where q.status_match = false),
    count(*) filter (where q.mismatch_type = 'lost_should_not_have_been_lost'),
    count(*) filter (where q.mismatch_type = 'qualified_should_not_have_been_qualified'),
    count(*) filter (where q.mismatch_type = 'in_followup_should_have_been_lost'),
    count(*) filter (where q.mismatch_type = 'in_followup_should_have_been_qualified'),
    coalesce(sum(q.qa_score) filter (where q.qa_score is not null), 0),
    count(*) filter (where q.qa_score is not null),
    count(*) filter (where coalesce(q.reused_transcription, qq.reused_transcription, false)),
    now()
  from unnest(dates) as d(the_date)
  left join acc.crm_followups f on f.call_date = d.the_date
  left join acc.call_transcripts t on t.recording_url = f.recording_url
  left join acc.followup_qa q on q.follow_up_id = f.follow_up_id
  left join acc.transcription_queue qq on qq.follow_up_id = f.follow_up_id
  group by d.the_date
  on conflict (date) do update set
    total_followups = excluded.total_followups,
    recordings_available = excluded.recordings_available,
    transcribed = excluded.transcribed,
    already_transcribed = excluded.already_transcribed,
    non_transcribable = excluded.non_transcribable,
    transcription_failed = excluded.transcription_failed,
    pending = excluded.pending,
    not_in_scope = excluded.not_in_scope,
    qa_assessed = excluded.qa_assessed,
    pitch_score_sum = excluded.pitch_score_sum,
    pitch_score_n = excluded.pitch_score_n,
    pitch_accurate = excluded.pitch_accurate,
    pitch_partially_accurate = excluded.pitch_partially_accurate,
    pitch_inaccurate = excluded.pitch_inaccurate,
    followup_date_accurate = excluded.followup_date_accurate,
    followup_date_inaccurate = excluded.followup_date_inaccurate,
    followup_date_not_verifiable = excluded.followup_date_not_verifiable,
    lost_reason_accurate = excluded.lost_reason_accurate,
    lost_reason_inaccurate = excluded.lost_reason_inaccurate,
    lost_reason_not_verifiable = excluded.lost_reason_not_verifiable,
    remarks_accurate = excluded.remarks_accurate,
    remarks_partially_accurate = excluded.remarks_partially_accurate,
    remarks_inaccurate = excluded.remarks_inaccurate,
    remarks_not_verifiable = excluded.remarks_not_verifiable,
    status_match = excluded.status_match,
    status_mismatch = excluded.status_mismatch,
    lost_should_not_have_been_lost = excluded.lost_should_not_have_been_lost,
    qualified_should_not_have_been_qualified = excluded.qualified_should_not_have_been_qualified,
    in_followup_should_have_been_lost = excluded.in_followup_should_have_been_lost,
    in_followup_should_have_been_qualified = excluded.in_followup_should_have_been_qualified,
    agent_qa_score_sum = excluded.agent_qa_score_sum,
    agent_qa_score_n = excluded.agent_qa_score_n,
    reused_transcription = excluded.reused_transcription,
    updated_at = now();
end;
$$;

revoke all on function acc.crm_recompute_daily_qa_summary(date[]) from public, anon, authenticated;
grant execute on function acc.crm_recompute_daily_qa_summary(date[]) to service_role;

-- One statement-level trigger fires once per INSERT/UPDATE statement (however many rows it touched),
-- not once per row - a 300-row snapshot insert recomputes each affected date once, not 300 times.
create or replace function acc._daily_qa_summary_touch_followups() returns trigger
language plpgsql as $$
declare dates date[];
begin
  select array_agg(distinct d) into dates from (
    select call_date as d from new_followups where call_date is not null
    union
    select call_date as d from old_followups where call_date is not null
  ) x;
  perform acc.crm_recompute_daily_qa_summary(dates);
  return null;
end;
$$;

create trigger crm_followups_daily_summary_ins
  after insert on acc.crm_followups
  referencing new table as new_followups
  for each statement execute function acc._daily_qa_summary_touch_followups();

-- The insert-only trigger above can't share this function (it has no old_followups transition table),
-- so the update path gets its own, identical apart from the union with old_followups. old_followups
-- covers the (unlikely, since communication_time is what sets it) case where call_date itself changes.
create or replace function acc._daily_qa_summary_touch_followups_upd() returns trigger
language plpgsql as $$
declare dates date[];
begin
  select array_agg(distinct d) into dates from (
    select call_date as d from new_followups where call_date is not null
    union
    select call_date as d from old_followups where call_date is not null
  ) x;
  perform acc.crm_recompute_daily_qa_summary(dates);
  return null;
end;
$$;

create trigger crm_followups_daily_summary_upd
  after update on acc.crm_followups
  referencing new table as new_followups old table as old_followups
  for each statement execute function acc._daily_qa_summary_touch_followups_upd();

-- call_transcripts carries no call_date of its own - the same recording_url can back more than one
-- crm_followups row (that is the whole point of the dedup key), so this resolves every date a changed
-- transcript is actually attached to, not just one.
create or replace function acc._daily_qa_summary_touch_transcripts() returns trigger
language plpgsql as $$
declare dates date[];
begin
  select array_agg(distinct f.call_date) into dates
  from new_transcripts nt
  join acc.crm_followups f on f.recording_url = nt.recording_url
  where f.call_date is not null;
  perform acc.crm_recompute_daily_qa_summary(dates);
  return null;
end;
$$;

create trigger call_transcripts_daily_summary_ins
  after insert on acc.call_transcripts
  referencing new table as new_transcripts
  for each statement execute function acc._daily_qa_summary_touch_transcripts();

create trigger call_transcripts_daily_summary_upd
  after update on acc.call_transcripts
  referencing new table as new_transcripts
  for each statement execute function acc._daily_qa_summary_touch_transcripts();

-- followup_qa already carries call_date directly (denormalised at write time), so no join is needed.
create or replace function acc._daily_qa_summary_touch_qa() returns trigger
language plpgsql as $$
declare dates date[];
begin
  select array_agg(distinct call_date) into dates from new_qa where call_date is not null;
  perform acc.crm_recompute_daily_qa_summary(dates);
  return null;
end;
$$;

create trigger followup_qa_daily_summary_ins
  after insert on acc.followup_qa
  referencing new table as new_qa
  for each statement execute function acc._daily_qa_summary_touch_qa();

create trigger followup_qa_daily_summary_upd
  after update on acc.followup_qa
  referencing new table as new_qa
  for each statement execute function acc._daily_qa_summary_touch_qa();

-- transcription_queue also already carries call_date directly.
create or replace function acc._daily_qa_summary_touch_queue() returns trigger
language plpgsql as $$
declare dates date[];
begin
  select array_agg(distinct call_date) into dates from new_queue where call_date is not null;
  perform acc.crm_recompute_daily_qa_summary(dates);
  return null;
end;
$$;

create trigger transcription_queue_daily_summary_ins
  after insert on acc.transcription_queue
  referencing new table as new_queue
  for each statement execute function acc._daily_qa_summary_touch_queue();

create trigger transcription_queue_daily_summary_upd
  after update on acc.transcription_queue
  referencing new table as new_queue
  for each statement execute function acc._daily_qa_summary_touch_queue();

-- One-time backfill so the table isn't empty for existing history; every date already in
-- crm_followups gets its row now, and every date from here on stays current via the triggers above.
do $$
declare all_dates date[];
begin
  select array_agg(distinct call_date) into all_dates from acc.crm_followups where call_date is not null;
  perform acc.crm_recompute_daily_qa_summary(all_dates);
end $$;

commit;
