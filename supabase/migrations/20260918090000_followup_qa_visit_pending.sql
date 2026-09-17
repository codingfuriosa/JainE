-- A DEDICATED COLUMN FOR visit_pending, so it can be shown on the list, not only on the lead detail
-- page.
--
-- The model has been asked for status_assessment.visit_pending since 20260917 (qa-prompt.ts) and the
-- pipeline already reads it (crm-snapshot-qa/index.ts, deriveStatusMatch) - it rides along inside the
-- status_assessment jsonb blob, which acc.followup_timeline_v already exposes whole, so the lead
-- detail page (which fetches full rows via acc.crm_lead_detail) already had it available as
-- r.status_assessment.visit_pending. The list table does not fetch that blob - TRC_LIGHT/TRC_CRM_LIGHT
-- select named columns only, the same reason ai_assessed_status/status_match/mismatch_type/pitch_score
-- are already flattened onto their own columns instead of living only inside the blob. This gives
-- visit_pending the same treatment, so "Qualified (visit pending)" can render on the list too, not
-- only after opening the lead.
alter table acc.followup_qa add column if not exists visit_pending boolean;
comment on column acc.followup_qa.visit_pending is
  'True when the model reports this lead qualifies (now or via the ratchet) and the one thing still '
  'open is the site visit itself - read by deriveStatusMatch to keep that combination out of the '
  'in_followup_should_have_been_qualified mismatch count. See qa-prompt.ts QA_OUTPUT_SHAPE.';

-- Recreated to add q.visit_pending only - every other column, join and option is unchanged from
-- 20260917090000. Appended at the END of the select list, not next to the other q.* columns it
-- reads alongside - CREATE OR REPLACE VIEW treats an existing column changing its ordinal position as
-- a rename of whatever used to sit there (Postgres error 42P16) and refuses it; adding strictly at the
-- end is the only edit this statement can make without dropping and recreating the view outright.
create or replace view acc.followup_timeline_v
with (security_invoker = true) as
 select f.follow_up_id,
    f.lead_id,
    f.lead_name,
    f.business_unit_name,
    f.communication_time,
    f.call_date,
    f.call_start_text,
    f.next_follow_up_text,
    f.status as crm_status,
    f.status_raw as crm_status_raw,
    f.status_detail,
    f.remarks as crm_remarks,
    f.lost_reason as crm_lost_reason,
    f.recording_url,
    f.callid,
    f.has_recording,
    f.call_duration,
    f.first_seen_date,
    f.last_seen_date,
    l.status as lead_current_status,
    l.lost_reason as lead_current_lost_reason,
    t.id as transcript_id,
    coalesce(t.status,
        case
            when f.has_recording then 'not_transcribed'::text
            else 'no_recording'::text
        end) as transcription_status,
    t.transcript,
    t.transcript_text,
    t.turn_count,
    t.languages,
    t.duration_seconds,
    t.non_transcribable_reason,
    t.verification,
    t.model as transcription_model,
    q.id as qa_id,
    q.pitch_accuracy,
    q.pitch_score,
    q.pitch_status,
    q.followup_date_accuracy,
    q.followup_date_status,
    q.lost_reason_accuracy,
    q.lost_reason_status,
    q.remarks_accuracy,
    q.remarks_status,
    q.status_assessment,
    q.ai_assessed_status,
    q.status_match,
    q.mismatch_type,
    q.agent_qa,
    q.qa_score,
    q.summary_verdict,
    q.qa_model,
    q.qa_error,
    coalesce(q.reused_transcription, qq.reused_transcription, false) as reused_transcription,
    qq.status as queue_status,
    qq.fail_phase,
    qq.last_error as queue_error,
    qq.attempt_count,
    qq.qa_attempt_count,
    qq.queue_seq,
    f.personnel_id,
    f.personnel_name,
    f.personnel_email,
    f.personnel_role,
    acc.crm_personnel_team(f.personnel_email) as personnel_team,
    lv.status_rank,
    lv.status_level,
    lv.prev_rank,
    lv.prev_status,
    lv.prior_max_rank,
    lv.prior_max_level,
    lv.prior_max_status,
    lv.below_peak,
    lv.level_regression,
    lv.level_regression_severity,
    lv.lead_max_rank,
    lv.lead_max_level,
    lv.lead_max_status,
    lv.lead_below_peak_count,
    lv.lead_regression_count,
    lv.lead_not_allowed_count,
    coalesce(acc.crm_status_level(l.status) = 1 and lv.lead_max_rank >= 3, false) as lead_status_regression,
    q.visit_pending
   from acc.crm_followups f
     left join acc.crm_leads l on l.lead_id = f.lead_id
     left join acc.call_transcripts t on t.recording_url = f.recording_url
     left join acc.followup_qa q on q.follow_up_id = f.follow_up_id
     left join acc.transcription_queue qq on qq.follow_up_id = f.follow_up_id
     left join acc.lead_level_progress_v_secured lv on lv.follow_up_id = f.follow_up_id and lv.lead_id = f.lead_id;

grant select on acc.followup_timeline_v to authenticated, service_role;
