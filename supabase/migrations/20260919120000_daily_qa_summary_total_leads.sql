-- A DAILY LEAD-COUNT COLUMN, for the new per-day breakdown table (2026-09-19).
--
-- daily_qa_summary already has total_followups (calls) and the four *_leads columns for
-- match/mismatch categories, but no plain "how many distinct leads had a follow-up this day" column.
-- Unlike summing lead counts ACROSS a date range (which double-counts a lead active on several days -
-- see 20260917064140's own note on why total_leads needs its own RPC for a range), a single day's OWN
-- distinct-lead count has no such problem: a lead either had a follow-up on that specific date or it
-- didn't, so this is safe to store and read per row, never summed across dates.
--
-- Purely additive - a new column, backfilled from data that already exists. Nothing already stored is
-- changed or deleted.
begin;

alter table acc.daily_qa_summary
  add column if not exists total_leads integer not null default 0;

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
    agent_qa_score_sum, agent_qa_score_n, reused_transcription, updated_at,
    status_match_leads, status_mismatch_leads,
    lost_should_not_have_been_lost_leads, qualified_should_not_have_been_qualified_leads,
    in_followup_should_have_been_lost_leads, in_followup_should_have_been_qualified_leads,
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
    agent_qa_score_sum = excluded.agent_qa_score_sum,
    agent_qa_score_n = excluded.agent_qa_score_n,
    reused_transcription = excluded.reused_transcription,
    status_match_leads = excluded.status_match_leads,
    status_mismatch_leads = excluded.status_mismatch_leads,
    lost_should_not_have_been_lost_leads = excluded.lost_should_not_have_been_lost_leads,
    qualified_should_not_have_been_qualified_leads = excluded.qualified_should_not_have_been_qualified_leads,
    in_followup_should_have_been_lost_leads = excluded.in_followup_should_have_been_lost_leads,
    in_followup_should_have_been_qualified_leads = excluded.in_followup_should_have_been_qualified_leads,
    total_leads = excluded.total_leads,
    updated_at = now();
end;
$$;

-- Backfill the new column for every day already in the table - additive only, nothing else touched.
do $$
declare all_dates date[];
begin
  select array_agg(distinct date) into all_dates from acc.daily_qa_summary;
  perform acc.crm_recompute_daily_qa_summary(all_dates);
end $$;

commit;
