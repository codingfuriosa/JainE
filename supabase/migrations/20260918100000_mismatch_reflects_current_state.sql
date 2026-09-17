-- MISMATCH COUNTS THE LEAD'S CURRENT STATE, NOT EVERY CALL IT EVER HAD.
--
-- By requirement (2026-09-18): a lead the CRM had Lost on the 1st, when the call itself showed it was
-- still live, is a real mismatch THAT DAY. But if the CRM gets corrected on the 4th and the more
-- recent call agrees with the correction, the lead is no longer actually in disagreement with
-- anything - counting it as a mismatch forever after, on every date range that happens to include the
-- 1st, would mean the dashboard never lets go of a problem that has already been fixed.
--
-- What does NOT change: acc.followup_qa.status_match/mismatch_type on each individual row - the 1st's
-- own row still says what was true on the 1st, and the lead detail page's call-by-call history still
-- shows it exactly that way. What changes is which rows COUNT toward the dashboard - only the single
-- most recent QA-assessed follow-up per lead (acc.followup_qa.is_latest_assessed) contributes to
-- status_match/status_mismatch/the four mismatch_type categories, in acc.daily_qa_summary and
-- everywhere the app filters or counts by them. A lead's older, superseded verdict stops counting the
-- moment a newer call is assessed - not just going forward, but on any past date range too, because
-- the question this answers is "is this lead currently in disagreement", not "was it, once".
--
-- "Most recent" is decided by the same ordering the rest of this page already sorts by - call_date,
-- then communication_time, then follow_up_id, all descending - among a lead's followup_qa rows
-- (joined back to crm_followups for the two timestamp columns, which live there, not on followup_qa).

begin;

alter table acc.followup_qa add column if not exists is_latest_assessed boolean not null default true;
comment on column acc.followup_qa.is_latest_assessed is
  'True only for the single most recent QA-assessed follow-up per lead (by call_date, then '
  'communication_time, then follow_up_id, descending). Maintained by acc.crm_recompute_latest_assessed '
  '/ the acc.followup_qa triggers - never set by hand. Read by acc.crm_recompute_daily_qa_summary to '
  'keep status_match/status_mismatch/mismatch_type counting only a lead''s CURRENT state, not every '
  'call it ever had (2026-09-18).';

-- Recomputes is_latest_assessed for every followup_qa row belonging to the given leads. Idempotent -
-- `is distinct from` means a row already correct is never rewritten, which is what keeps the
-- recursive trigger below from looping forever (see its own comment).
create or replace function acc.crm_recompute_latest_assessed(p_lead_ids bigint[])
returns void language plpgsql security definer set search_path = acc, public as $$
declare
  ids bigint[];
begin
  select array_agg(distinct x) into ids from unnest(p_lead_ids) x where x is not null;
  if ids is null then return; end if;

  with ranked as (
    select q.id,
           row_number() over (
             partition by q.lead_id
             order by f.call_date desc nulls last, f.communication_time desc nulls last, f.follow_up_id desc
           ) = 1 as should_be_latest
    from acc.followup_qa q
    join acc.crm_followups f on f.follow_up_id = q.follow_up_id
    where q.lead_id = any(ids)
  )
  update acc.followup_qa q
  set is_latest_assessed = ranked.should_be_latest
  from ranked
  where ranked.id = q.id
    and q.is_latest_assessed is distinct from ranked.should_be_latest;
end;
$$;
revoke all on function acc.crm_recompute_latest_assessed(bigint[]) from public, anon, authenticated;
grant execute on function acc.crm_recompute_latest_assessed(bigint[]) to service_role;

-- One-time backfill: every lead already in followup_qa gets its is_latest_assessed sorted out now,
-- rather than waiting for its next call to be assessed before the flag means anything.
do $$
declare all_leads bigint[];
begin
  select array_agg(distinct lead_id) into all_leads from acc.followup_qa where lead_id is not null;
  perform acc.crm_recompute_latest_assessed(all_leads);
end $$;

-- The six places status_match/mismatch_type were counted unconditionally now also require
-- is_latest_assessed - the only change from 20260917110000's version of this function.
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
    count(*) filter (where q.status_match and q.is_latest_assessed),
    count(*) filter (where q.status_match = false and q.is_latest_assessed),
    count(*) filter (where q.mismatch_type = 'lost_should_not_have_been_lost' and q.is_latest_assessed),
    count(*) filter (where q.mismatch_type = 'qualified_should_not_have_been_qualified' and q.is_latest_assessed),
    count(*) filter (where q.mismatch_type = 'in_followup_should_have_been_lost' and q.is_latest_assessed),
    count(*) filter (where q.mismatch_type = 'in_followup_should_have_been_qualified' and q.is_latest_assessed),
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

-- Every existing day's aggregate was computed under the OLD formula (every call counted, not just
-- each lead's latest) - all of them need redoing under the new one, not just whichever dates a future
-- write happens to touch.
do $$
declare all_dates date[];
begin
  select array_agg(distinct date) into all_dates from acc.daily_qa_summary;
  perform acc.crm_recompute_daily_qa_summary(all_dates);
end $$;

-- Replaces the plain per-row trigger from 20260917110000: recomputing is_latest_assessed for a lead
-- can change which OTHER, older row of that same lead now counts - not only the row that was just
-- written - so this recomputes every call_date the touched leads have ANY followup_qa row on, not
-- just the new row's own date.
drop trigger if exists followup_qa_daily_summary_ins on acc.followup_qa;
drop trigger if exists followup_qa_daily_summary_upd on acc.followup_qa;
drop function if exists acc._daily_qa_summary_touch_qa();

create or replace function acc._followup_qa_touch() returns trigger
language plpgsql as $$
declare
  lead_ids bigint[];
  dates date[];
begin
  -- crm_recompute_latest_assessed's own UPDATE on this same table fires this trigger again - without
  -- this guard that would recurse forever. The outermost call (depth 1) does the real work; anything
  -- nested under it (depth > 1) is that recursive re-entry and returns immediately.
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  select array_agg(distinct lead_id) into lead_ids from new_qa where lead_id is not null;
  if lead_ids is null then return null; end if;

  perform acc.crm_recompute_latest_assessed(lead_ids);

  select array_agg(distinct call_date) into dates
  from acc.followup_qa where lead_id = any(lead_ids) and call_date is not null;
  perform acc.crm_recompute_daily_qa_summary(dates);
  return null;
end;
$$;

create trigger followup_qa_touch_ins
  after insert on acc.followup_qa
  referencing new table as new_qa
  for each statement execute function acc._followup_qa_touch();

create trigger followup_qa_touch_upd
  after update on acc.followup_qa
  referencing new table as new_qa
  for each statement execute function acc._followup_qa_touch();

-- Exposed to the app the same way every other followup_qa column is - appended at the end, not next
-- to ai_assessed_status/status_match where it conceptually belongs, because CREATE OR REPLACE VIEW
-- treats an existing column changing position as a rename of whatever used to sit there and refuses
-- it (see 20260918090000's own note on this).
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
    q.is_latest_assessed
   from acc.crm_followups f
     left join acc.crm_leads l on l.lead_id = f.lead_id
     left join acc.call_transcripts t on t.recording_url = f.recording_url
     left join acc.followup_qa q on q.follow_up_id = f.follow_up_id
     left join acc.transcription_queue qq on qq.follow_up_id = f.follow_up_id
     left join acc.lead_level_progress_v_secured lv on lv.follow_up_id = f.follow_up_id and lv.lead_id = f.lead_id;

grant select on acc.followup_timeline_v to authenticated, service_role;

commit;
