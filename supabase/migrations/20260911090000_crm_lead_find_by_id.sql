-- ONE LEAD, FETCHED LIKE ONE LEAD.
--
-- Opening a lead from the Transcription leads table took SEVEN TO EIGHT SECONDS, every time, for a
-- lead with six follow-ups. Not because six rows are expensive - because of how the filter reached
-- the window functions, or rather how it didn't.
--
-- acc.followup_timeline_v joins acc.lead_level_progress_v, which is a five-deep chain of window
-- functions over the whole of acc.crm_followups (13k rows and climbing). EVERY window in that chain
-- is PARTITION BY lead_id, so in principle "where lead_id = 711488" can be pushed all the way to the
-- innermost scan and the chain then runs over six rows instead of thirteen thousand. Postgres knows
-- how to do that. It could not do it here, because the join was
--
--     LEFT JOIN acc.lead_level_progress_v lv ON lv.follow_up_id = f.follow_up_id
--
-- and there is nothing in that predicate to tell the planner that lv.lead_id is f.lead_id. With no
-- equivalence between the two columns, a qual on f.lead_id cannot be propagated to lv, so lv was
-- materialised in full and then joined down to six rows. The entire cost of the page was the rows
-- it threw away.
--
-- The fix is the redundant half of the join condition. lv.lead_id and f.lead_id ALWAYS agree -
-- lead_level_progress_v reads its lead_id from crm_followups keyed by follow_up_id, which is that
-- table's primary key, and a check across all 13,390 rows finds zero disagreements - so adding
-- `AND lv.lead_id = f.lead_id` cannot change a single output row. What it changes is the plan: the
-- planner now has the equivalence, pushes lead_id down through all five windows, and the innermost
-- node becomes an index scan on crm_followups_lead. Measured on the same lead: 7839ms -> 1.6ms.
--
-- Nothing else about the view moves. Same columns, same order, same types, same security_invoker,
-- so grants and RLS are untouched and every existing caller keeps working unchanged.

CREATE OR REPLACE VIEW acc.followup_timeline_v
WITH (security_invoker = true) AS
 SELECT f.follow_up_id,
    f.lead_id,
    f.lead_name,
    f.business_unit_name,
    f.communication_time,
    f.call_date,
    f.call_start_text,
    f.next_follow_up_text,
    f.status AS crm_status,
    f.status_raw AS crm_status_raw,
    f.status_detail,
    f.remarks AS crm_remarks,
    f.lost_reason AS crm_lost_reason,
    f.recording_url,
    f.callid,
    f.has_recording,
    f.call_duration,
    f.first_seen_date,
    f.last_seen_date,
    l.status AS lead_current_status,
    l.lost_reason AS lead_current_lost_reason,
    t.id AS transcript_id,
    COALESCE(t.status,
        CASE
            WHEN f.has_recording THEN 'not_transcribed'::text
            ELSE 'no_recording'::text
        END) AS transcription_status,
    t.transcript,
    t.transcript_text,
    t.turn_count,
    t.languages,
    t.duration_seconds,
    t.non_transcribable_reason,
    t.verification,
    t.model AS transcription_model,
    q.id AS qa_id,
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
    COALESCE(q.reused_transcription, qq.reused_transcription, false) AS reused_transcription,
    qq.status AS queue_status,
    qq.fail_phase,
    qq.last_error AS queue_error,
    qq.attempt_count,
    qq.qa_attempt_count,
    qq.queue_seq,
    f.personnel_id,
    f.personnel_name,
    f.personnel_email,
    f.personnel_role,
    acc.crm_personnel_team(f.personnel_email) AS personnel_team,
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
    COALESCE(acc.crm_status_level(l.status) = 1 AND lv.lead_max_rank >= 3, false) AS lead_status_regression
   FROM acc.crm_followups f
     LEFT JOIN acc.crm_leads l ON l.lead_id = f.lead_id
     LEFT JOIN acc.call_transcripts t ON t.recording_url = f.recording_url
     LEFT JOIN acc.followup_qa q ON q.follow_up_id = f.follow_up_id
     LEFT JOIN acc.transcription_queue qq ON qq.follow_up_id = f.follow_up_id
     -- The `AND lv.lead_id = f.lead_id` is the whole point of this migration. See the header.
     LEFT JOIN acc.lead_level_progress_v lv
       ON lv.follow_up_id = f.follow_up_id AND lv.lead_id = f.lead_id;


-- FIND A LEAD BY ID: the lead row and its complete follow-up history, in ONE round trip.
--
-- The leads table opens a lead by asking for two things: acc.crm_leads for the lead itself and the
-- whole of acc.followup_timeline_v for its history. That was two requests, and - for the background
-- prefetch that warms 25 leads at a time - two requests whose history half used `lead_id IN (...)`.
--
-- IN (...) is why the batch cannot simply ride on the view fix above. The pushdown that makes a
-- single lead fast comes from an equality equivalence, and `lead_id = ANY(array)` is not one: the
-- planner has no constant to propagate into lv, so a 25-lead prefetch still materialises the entire
-- window chain (measured: 4.8s). Looping ONE id at a time inside this function turns each iteration
-- back into the fast plan, so 25 leads cost 25 index scans instead of one full pass.
--
-- Returns one row per id ASKED FOR, including ids with nothing behind them: a lead with no
-- follow-up history is a real answer, and returning it is what lets the caller cache that answer
-- instead of re-asking on every click. Rows come back already in chronological order (the order the
-- detail page renders and rolls up in), oldest first, so nothing has to re-sort them.
--
-- SECURITY INVOKER, deliberately: acc.followup_timeline_v and acc.crm_leads are the caller's to read
-- under RLS exactly as they are today, and this function must not become a way around that.
CREATE OR REPLACE FUNCTION acc.crm_lead_detail(p_lead_ids bigint[])
RETURNS TABLE (lead_id bigint, lead jsonb, followups jsonb)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = acc, public
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_lead_ids IS NULL THEN
    RETURN;
  END IF;

  -- DISTINCT and NOT NULL up front: the caller's list is whatever was on screen, which can repeat an
  -- id, and asking twice would return the same lead twice.
  FOR v_id IN
    SELECT DISTINCT u FROM unnest(p_lead_ids) AS u WHERE u IS NOT NULL ORDER BY 1
  LOOP
    lead_id := v_id;

    SELECT to_jsonb(l) INTO lead
      FROM acc.crm_leads l
     WHERE l.lead_id = v_id;

    SELECT COALESCE(
             jsonb_agg(to_jsonb(t) ORDER BY t.communication_time NULLS FIRST, t.follow_up_id),
             '[]'::jsonb)
      INTO followups
      FROM acc.followup_timeline_v t
     WHERE t.lead_id = v_id;

    RETURN NEXT;
  END LOOP;
END;
$$;

-- Same audience the underlying view already has. RLS still decides what comes back.
GRANT EXECUTE ON FUNCTION acc.crm_lead_detail(bigint[]) TO authenticated, service_role;
