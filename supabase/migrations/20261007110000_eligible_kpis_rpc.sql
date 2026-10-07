-- Transcription dashboard totals over ELIGIBLE calls only - every follow-up the CRM API flags
-- recording_eligible = true (acc.crm_followups.recording_eligible). Each eligible call lands in exactly one
-- bucket, so  completed + not_transcribed + failed + non_transcribable + no_recording = eligible.
-- Precedence: no recording -> failed (transcript or queue failed) -> transcribed -> no conversation ->
-- everything else is still waiting. The dashboard (nexus-core.js, trcEligBucket) uses the same order.
create or replace function acc.eligible_kpis(p_from date, p_to date)
returns jsonb
language sql
stable
set search_path to 'acc', 'public'
as $$
  with e as (
    select f.follow_up_id, f.lead_id, f.has_recording,
           t.status as t_status, qq.status as q_status,
           q.id as qa_id, q.status_match, q.mismatch_type, q.is_latest_assessed,
           coalesce(q.reused_transcription, qq.reused_transcription, false) as reused
    from acc.crm_followups f
    left join acc.call_transcripts t on t.recording_url = f.recording_url
    left join acc.followup_qa q on q.follow_up_id = f.follow_up_id
    left join acc.transcription_queue qq on qq.follow_up_id = f.follow_up_id
    where f.recording_eligible
      and (p_from is null or f.call_date >= p_from)
      and (p_to is null or f.call_date <= p_to)
  ), b as (
    select *,
           case
             when not coalesce(has_recording, false) then 'no_recording'
             when t_status = 'failed' or q_status = 'failed' then 'failed'
             when t_status = 'completed' then 'completed'
             when t_status = 'non_transcribable' then 'non_transcribable'
             else 'not_transcribed'
           end as bucket
    from e
  )
  select jsonb_build_object(
    'eligible',                 count(distinct follow_up_id),
    'eligible_leads',           count(distinct lead_id),
    'completed',                count(distinct follow_up_id) filter (where bucket = 'completed'),
    'completed_leads',          count(distinct lead_id) filter (where bucket = 'completed'),
    'not_transcribed',          count(distinct follow_up_id) filter (where bucket = 'not_transcribed'),
    'failed',                   count(distinct follow_up_id) filter (where bucket = 'failed'),
    'non_transcribable',        count(distinct follow_up_id) filter (where bucket = 'non_transcribable'),
    'no_recording',             count(distinct follow_up_id) filter (where bucket = 'no_recording'),
    'qa_assessed',              count(distinct follow_up_id) filter (where qa_id is not null),
    'reused',                   count(distinct follow_up_id) filter (where reused),
    'status_match',             count(distinct follow_up_id) filter (where status_match is true and is_latest_assessed),
    'status_match_leads',       count(distinct lead_id) filter (where status_match is true and is_latest_assessed),
    'status_mismatch',          count(distinct follow_up_id) filter (where status_match is false and is_latest_assessed),
    'status_mismatch_leads',    count(distinct lead_id) filter (where status_match is false and is_latest_assessed),
    'lost_should_not_have_been_lost',
      count(distinct follow_up_id) filter (where status_match is false and is_latest_assessed and mismatch_type = 'lost_should_not_have_been_lost'),
    'lost_should_not_have_been_lost_leads',
      count(distinct lead_id) filter (where status_match is false and is_latest_assessed and mismatch_type = 'lost_should_not_have_been_lost'),
    'qualified_should_not_have_been_qualified',
      count(distinct follow_up_id) filter (where status_match is false and is_latest_assessed and mismatch_type = 'qualified_should_not_have_been_qualified'),
    'qualified_should_not_have_been_qualified_leads',
      count(distinct lead_id) filter (where status_match is false and is_latest_assessed and mismatch_type = 'qualified_should_not_have_been_qualified'),
    'in_followup_should_have_been_lost',
      count(distinct follow_up_id) filter (where status_match is false and is_latest_assessed and mismatch_type = 'in_followup_should_have_been_lost'),
    'in_followup_should_have_been_lost_leads',
      count(distinct lead_id) filter (where status_match is false and is_latest_assessed and mismatch_type = 'in_followup_should_have_been_lost'),
    'in_followup_should_have_been_qualified',
      count(distinct follow_up_id) filter (where status_match is false and is_latest_assessed and mismatch_type = 'in_followup_should_have_been_qualified'),
    'in_followup_should_have_been_qualified_leads',
      count(distinct lead_id) filter (where status_match is false and is_latest_assessed and mismatch_type = 'in_followup_should_have_been_qualified')
  )
  from b
$$;
grant execute on function acc.eligible_kpis(date, date) to authenticated, service_role;
