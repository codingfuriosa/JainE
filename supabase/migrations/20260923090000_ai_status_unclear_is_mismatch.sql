-- UNCLEAR IS NOW ITS OWN MISMATCH CATEGORY for new processing from 2026-09-24 00:00 IST.
--
-- Before this: an AI status of "Unclear" scored status_match:null, mismatch_type:null in
-- deriveStatusMatch (crm-snapshot-qa/index.ts) - neither a match nor a mismatch, so it silently
-- dropped out of every count that filters on status_match = true/false (status_mismatch, the four
-- mismatch_type cards, the CRM Match/Mismatch KPI tiles). A run with a lot of unreviewable calls could
-- read as a clean mismatch rate while actually being a run nobody could judge. Unclear is now scored
-- status_match:false, mismatch_type:'ai_status_unclear' - not a claim that the CRM is wrong, but a
-- flag that this call needs a human or a re-listen, counted rather than dropped.
--
-- This is purely additive to the mismatch_type vocabulary - the four existing categories, their
-- meaning and every row already carrying one of them are untouched.
begin;

-- 1. THE VOCABULARY. Same reasoning as the original constraint (20260831090000): a typo must not
-- become a silent, uncounted category, so the database still refuses anything outside the known set.
alter table acc.followup_qa drop constraint if exists followup_qa_mismatch_type_known;
alter table acc.followup_qa add constraint followup_qa_mismatch_type_known check (
  mismatch_type is null or mismatch_type in (
    'lost_should_not_have_been_lost',
    'qualified_should_not_have_been_qualified',
    'in_followup_should_have_been_lost',
    'in_followup_should_have_been_qualified',
    'ai_status_unclear'));

-- 2. No historical backfill. Existing rows keep their original verdict and current-state flags.
-- New rows are written with this category by the edge function from the effective processing date.

-- 3. THE DAILY AGGREGATE gets its own pair of columns, the same shape as the four existing categories
-- (a per-follow-up count and a per-lead count, see 20260918110000/20260919120000).
alter table acc.daily_qa_summary add column if not exists ai_status_unclear integer not null default 0;
alter table acc.daily_qa_summary add column if not exists ai_status_unclear_leads integer not null default 0;

-- Recreated to add the new pair of columns only - every other column, join and filter is unchanged
-- from 20260919120000's version of this function.
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
    total_leads
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
    count(distinct f.lead_id)
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
    updated_at = now();
end;
$$;

-- 4. No historical summary recomputation. Future QA writes maintain the affected date through the
-- existing trigger path.

commit;
