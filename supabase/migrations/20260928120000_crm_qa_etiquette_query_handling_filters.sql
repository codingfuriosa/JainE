-- Etiquette and Query Handling filters on the transcription list. Both already exist as two of the
-- six points inside agent_qa (jsonb array) - this just flattens those two into their own scalar
-- columns, exactly like pitch_status/remarks_status/etc already sit beside their own jsonb blobs, so
-- the list's filter dropdowns have something they can actually query a jsonb array on.

alter table acc.followup_qa add column if not exists etiquette_status text;
alter table acc.followup_qa add column if not exists query_handling_status text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'followup_qa_etiquette_status_known'
  ) then
    alter table acc.followup_qa add constraint followup_qa_etiquette_status_known check (
      etiquette_status is null or etiquette_status in ('Pass', 'Partial', 'Fail', 'Not Applicable'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'followup_qa_query_handling_status_known'
  ) then
    alter table acc.followup_qa add constraint followup_qa_query_handling_status_known check (
      query_handling_status is null or query_handling_status in ('Pass', 'Partial', 'Fail', 'Not Applicable'));
  end if;
end $$;

-- One-off backfill for rows already judged before this migration: agent_qa already holds the answer,
-- this just flattens what is already there instead of waiting for a re-run.
update acc.followup_qa
   set etiquette_status = (
         select p->>'status' from jsonb_array_elements(agent_qa) p where p->>'point' = 'Etiquette' limit 1),
       query_handling_status = (
         select p->>'status' from jsonb_array_elements(agent_qa) p where p->>'point' = 'Query Handling' limit 1)
 where agent_qa is not null
   and (etiquette_status is null or query_handling_status is null);

-- Appended at the end, not next to the other *_status columns where they conceptually belong -
-- CREATE OR REPLACE VIEW treats an existing column changing position as a rename of whatever used to
-- sit there and refuses it (see 20260918090000/20260918100000/20260928090000's own notes on this).
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
    q.visit_pending,
    q.is_latest_assessed,
    q.retention_effort,
    q.retention_status,
    l.first_seen_date as lead_first_seen_date,
    q.etiquette_status,
    q.query_handling_status
   from acc.crm_followups f
     left join acc.crm_leads l on l.lead_id = f.lead_id
     left join acc.call_transcripts t on t.recording_url = f.recording_url
     left join acc.followup_qa q on q.follow_up_id = f.follow_up_id
     left join acc.transcription_queue qq on qq.follow_up_id = f.follow_up_id
     left join acc.lead_level_progress_v_secured lv on lv.follow_up_id = f.follow_up_id and lv.lead_id = f.lead_id;

grant select on acc.followup_timeline_v to authenticated, service_role;
