-- HISTORICAL MISMATCH EVENTS, ALONGSIDE (NOT INSTEAD OF) THE CURRENT-STATE COUNT. By requirement
-- (2026-09-23).
--
-- 20260918100000 changed daily_qa_summary's status_mismatch and the four (now five, 20260923090000)
-- mismatch_type columns to count only a lead's CURRENT state (is_latest_assessed) - a lead the CRM
-- had wrong on the 1st that got corrected by the 4th stops counting as a mismatch on the 1st the
-- moment the 4th is assessed. That is still exactly right and is UNCHANGED here: not one existing
-- column, filter or row in acc.followup_qa is touched by this migration.
--
-- What was missing is the OTHER half of the question: "how many mismatches were actually detected
-- on this date, corrected or not" - the answer daily_qa_summary gave before 20260918100000, and which
-- nothing since has kept around. Both numbers are real and answer different questions:
--   historical_status_mismatch  - every follow-up assessed as a mismatch with a call_date of this
--                                 day, full stop. Never changes after the fact - a call that was a
--                                 mismatch on the day it was judged stays counted here forever, even
--                                 after a later call on the same lead fixes it going forward.
--   status_mismatch (unchanged) - of a lead's SINGLE most recent assessed call, how many are a
--                                 mismatch today. A lead corrected after the 1st drops out of THIS
--                                 count on the 1st, because it is no longer true today.
-- Each acc.followup_qa row's own status_match/mismatch_type was already never mutated by resolution
-- (see 20260918100000's own note) - this migration only adds a place that ALSO shows the unconditional
-- total, so the two questions can be answered side by side instead of one silently replacing the
-- other.
begin;

alter table acc.daily_qa_summary add column if not exists historical_status_mismatch integer not null default 0;
alter table acc.daily_qa_summary add column if not exists historical_lost_should_not_have_been_lost integer not null default 0;
alter table acc.daily_qa_summary add column if not exists historical_qualified_should_not_have_been_qualified integer not null default 0;
alter table acc.daily_qa_summary add column if not exists historical_in_followup_should_have_been_lost integer not null default 0;
alter table acc.daily_qa_summary add column if not exists historical_in_followup_should_have_been_qualified integer not null default 0;
alter table acc.daily_qa_summary add column if not exists historical_ai_status_unclear integer not null default 0;
comment on column acc.daily_qa_summary.historical_status_mismatch is
  'Every follow-up assessed as a mismatch with this call_date, regardless of is_latest_assessed - '
  'unlike status_mismatch, this never drops once a later call on the same lead resolves it. See '
  '20260923100000.';

-- Recreated to ADD the six historical_* columns only - every existing column, join, filter and the
-- on-conflict update for every column that already existed is unchanged from 20260923090000's version
-- of this function. The six new select expressions are the exact same five mismatch_type filters (plus
-- the overall status_match=false one) already used for the current-state columns two lines above each,
-- just with " and q.is_latest_assessed" dropped.
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
    in_followup_should_have_been_lost, in_followup_should_have_been_qualified, ai_status_unclear,
    agent_qa_score_sum, agent_qa_score_n, reused_transcription, updated_at,
    status_match_leads, status_mismatch_leads,
    lost_should_not_have_been_lost_leads, qualified_should_not_have_been_qualified_leads,
    in_followup_should_have_been_lost_leads, in_followup_should_have_been_qualified_leads,
    ai_status_unclear_leads,
    total_leads,
    historical_status_mismatch, historical_lost_should_not_have_been_lost,
    historical_qualified_should_not_have_been_qualified, historical_in_followup_should_have_been_lost,
    historical_in_followup_should_have_been_qualified, historical_ai_status_unclear
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
    count(*) filter (where q.status_match and q.is_latest_assessed),
    count(*) filter (where q.status_match = false and q.is_latest_assessed),
    count(*) filter (where q.mismatch_type = 'lost_should_not_have_been_lost' and q.is_latest_assessed),
    count(*) filter (where q.mismatch_type = 'qualified_should_not_have_been_qualified' and q.is_latest_assessed),
    count(*) filter (where q.mismatch_type = 'in_followup_should_have_been_lost' and q.is_latest_assessed),
    count(*) filter (where q.mismatch_type = 'in_followup_should_have_been_qualified' and q.is_latest_assessed),
    count(*) filter (where q.mismatch_type = 'ai_status_unclear' and q.is_latest_assessed),
    coalesce(sum(q.qa_score) filter (where q.qa_score is not null), 0),
    count(*) filter (where q.qa_score is not null),
    count(*) filter (where coalesce(q.reused_transcription, qq.reused_transcription, false)),
    now(),
    count(distinct f.lead_id) filter (where q.status_match and q.is_latest_assessed),
    count(distinct f.lead_id) filter (where q.status_match = false and q.is_latest_assessed),
    count(distinct f.lead_id) filter (where q.mismatch_type = 'lost_should_not_have_been_lost' and q.is_latest_assessed),
    count(distinct f.lead_id) filter (where q.mismatch_type = 'qualified_should_not_have_been_qualified' and q.is_latest_assessed),
    count(distinct f.lead_id) filter (where q.mismatch_type = 'in_followup_should_have_been_lost' and q.is_latest_assessed),
    count(distinct f.lead_id) filter (where q.mismatch_type = 'in_followup_should_have_been_qualified' and q.is_latest_assessed),
    count(distinct f.lead_id) filter (where q.mismatch_type = 'ai_status_unclear' and q.is_latest_assessed),
    count(distinct f.lead_id),
    count(*) filter (where q.status_match = false),
    count(*) filter (where q.mismatch_type = 'lost_should_not_have_been_lost'),
    count(*) filter (where q.mismatch_type = 'qualified_should_not_have_been_qualified'),
    count(*) filter (where q.mismatch_type = 'in_followup_should_have_been_lost'),
    count(*) filter (where q.mismatch_type = 'in_followup_should_have_been_qualified'),
    count(*) filter (where q.mismatch_type = 'ai_status_unclear')
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
    ai_status_unclear = excluded.ai_status_unclear,
    agent_qa_score_sum = excluded.agent_qa_score_sum,
    agent_qa_score_n = excluded.agent_qa_score_n,
    reused_transcription = excluded.reused_transcription,
    status_match_leads = excluded.status_match_leads,
    status_mismatch_leads = excluded.status_mismatch_leads,
    lost_should_not_have_been_lost_leads = excluded.lost_should_not_have_been_lost_leads,
    qualified_should_not_have_been_qualified_leads = excluded.qualified_should_not_have_been_qualified_leads,
    in_followup_should_have_been_lost_leads = excluded.in_followup_should_have_been_lost_leads,
    in_followup_should_have_been_qualified_leads = excluded.in_followup_should_have_been_qualified_leads,
    ai_status_unclear_leads = excluded.ai_status_unclear_leads,
    total_leads = excluded.total_leads,
    historical_status_mismatch = excluded.historical_status_mismatch,
    historical_lost_should_not_have_been_lost = excluded.historical_lost_should_not_have_been_lost,
    historical_qualified_should_not_have_been_qualified = excluded.historical_qualified_should_not_have_been_qualified,
    historical_in_followup_should_have_been_lost = excluded.historical_in_followup_should_have_been_lost,
    historical_in_followup_should_have_been_qualified = excluded.historical_in_followup_should_have_been_qualified,
    historical_ai_status_unclear = excluded.historical_ai_status_unclear,
    updated_at = now();
end;
$$;

-- No historical backfill. Existing daily rows remain unchanged; the new columns populate as future
-- dates are touched by normal transcription/QA writes.

commit;
