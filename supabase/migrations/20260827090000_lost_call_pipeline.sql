-- Lost-Call QA pipeline: daily CRM fetch -> FIFO queue -> Gemini 2.5 Pro -> CRM comparison.
--
-- Everything here is additive or a one-time consolidation. The manual-upload path (source IS NULL,
-- served by the transcription-analyze function) is deliberately left alone: it keeps its own
-- done/error status vocabulary and none of these columns are required for it.
--
-- Reversibility: the consolidation SOFT-deletes the rows it folds into a lead's surviving row and
-- records where each went in `merged_into`, so nothing is destroyed and the merge can be undone.

begin;

-- ---------------------------------------------------------------- 1. FIFO
-- A sequence, not max(queue_seq)+1: two overlapping pulls must not be able to hand out the same
-- number, and the order the CRM returned records in has to survive restarts.
create sequence if not exists acc.transcription_queue_seq as bigint start 1 increment 1;

-- Reserves a block of n numbers and returns the FIRST of them. Called by the edge function once per
-- pull, so a day's records are numbered in feed order in a single round trip.
create or replace function public.next_transcription_queue_block(n integer)
returns bigint
language plpgsql
security definer
set search_path = acc, public
as $$
declare
  last_val bigint;
begin
  if n is null or n < 1 then n := 1; end if;
  -- setval-free: advancing the sequence n times is safe under concurrency, nextval never blocks.
  select max(v) into last_val from (select nextval('acc.transcription_queue_seq') as v
                                    from generate_series(1, n)) s;
  return last_val - n + 1;
end;
$$;
revoke all on function public.next_transcription_queue_block(integer) from public, anon, authenticated;
grant execute on function public.next_transcription_queue_block(integer) to service_role;

-- ------------------------------------------------------- 2. PROCESSING COLUMNS
alter table acc.transcriptions
  add column if not exists queue_seq              bigint,
  add column if not exists queued_at              timestamptz,
  add column if not exists processing_started_at  timestamptz,
  add column if not exists completed_at           timestamptz,
  add column if not exists attempt_count          integer not null default 0,
  add column if not exists last_error             text,
  add column if not exists source_date            date,
  -- The CRM record for this row exactly as the API sent it. What Copy Response hands back, and the
  -- audit trail for every derived field below.
  add column if not exists original_crm_response  jsonb,
  add column if not exists sync_run_id            bigint,
  -- lost | follow_up | qualified | non_transcribable — the CRM's own vocabulary, derived from the
  -- conversation so the two can be compared at all.
  add column if not exists transcription_status   text,
  add column if not exists comparison_status      text,
  add column if not exists comparison_reason      text,
  -- One row per lead. Earlier calls for the same lead live here in full; extra calls that arrive
  -- while one is in flight wait in pending_calls and rotate in when it reaches a terminal state.
  add column if not exists call_history           jsonb  not null default '[]'::jsonb,
  add column if not exists pending_calls          jsonb  not null default '[]'::jsonb,
  -- How the CRM's own verdict moved over time, e.g. {Qualified,Lost}.
  add column if not exists status_trail           text[] not null default '{}'::text[],
  -- Every call id this lead row has already taken in, so a re-run of the same day is a no-op.
  add column if not exists processed_call_uuids   text[] not null default '{}'::text[],
  -- Kept ONLY when a reply could not be parsed or validated, for debugging. Never a transcript.
  add column if not exists gemini_raw             text,
  add column if not exists gemini_model           text,
  add column if not exists merged_into            bigint;

comment on column acc.transcriptions.original_crm_response is
  'The CRM API record for this call, verbatim. Source of truth for every crm_* column.';
comment on column acc.transcriptions.call_history is
  'Earlier calls for this lead, each with its own transcript, QA, verdict and comparison.';
comment on column acc.transcriptions.gemini_raw is
  'Unparseable or invalid Gemini reply, kept for debugging. Never presented as a transcript.';

-- The day's raw API response is parked in acc.transcription_jobs, which already exists for exactly
-- that and had never been written to. Only the run counters are added here.
alter table acc.lost_call_sync_runs
  add column if not exists attempts          integer,
  add column if not exists appended_history  integer,
  add column if not exists queued_behind     integer;

-- ------------------------------------------------------------- 3. BACKFILL
-- Status vocabulary. Applied to the automatic path only; manual uploads keep done/error.
update acc.transcriptions set status = case status
    when 'queued'       then 'pending'
    when 'done'         then 'completed'
    when 'error'        then 'failed'
    when 'no_recording' then 'non_transcribable'
    when 'too_short'    then 'non_transcribable'
    else status end
where source = 'lost_call_sync'
  and status in ('queued','done','error','no_recording','too_short');

update acc.transcriptions set
  source_date   = coalesce(source_date, report_date),
  attempt_count = greatest(attempt_count, coalesce(attempts, 0)),
  last_error    = coalesce(last_error, error_text),
  queued_at     = coalesce(queued_at, synced_at, created_at),
  completed_at  = coalesce(completed_at,
                    case when status in ('completed','non_transcribable') then updated_at end),
  status_trail  = case when cardinality(status_trail) = 0 and crm_status is not null
                       then array[crm_status] else status_trail end,
  processed_call_uuids = case when cardinality(processed_call_uuids) = 0 and call_uuid is not null
                              then array[call_uuid] else processed_call_uuids end,
  non_transcribable_reason = case
      when status = 'non_transcribable' and non_transcribable_reason is null and recording_url is null
        then 'The CRM feed returned no recording URL for this call.'
      else non_transcribable_reason end
where source = 'lost_call_sync';

-- The original CRM record, reconstructed from the columns it was unpacked into. Flagged as a
-- reconstruction so nobody mistakes it for the bytes the API actually sent.
update acc.transcriptions set original_crm_response = jsonb_strip_nulls(jsonb_build_object(
    'lead_id',            lead_id,
    'lead_name',          customer_name,
    'recording_url',      recording_url,
    'status',             crm_status,
    'business_unit_name', business_unit_name,
    'next_follow_up_date', next_follow_up_date,
    'lost_reason',        crm_lost_reason,
    'remarks',            crm_remarks
  ) || jsonb_build_object('_reconstructed', true))
where source = 'lost_call_sync' and original_crm_response is null;

-- transcription_status, by the same rule the edge function applies.
update acc.transcriptions set transcription_status = case
    when status = 'non_transcribable' then 'non_transcribable'
    when status <> 'completed' then null
    when lower(coalesce(ai_lead_category,'')) = 'not interested' then 'lost'
    when lower(coalesce(ai_lead_category,'')) in ('qualified','interested site visit','interested in booking') then 'qualified'
    when lower(coalesce(ai_lead_category,'')) = 'interested not qualified'
      then case when criteria->>'follow_up_requested' = 'true' then 'follow_up' else 'lost' end
    when criteria->>'follow_up_requested' = 'true' then 'follow_up'
    else null end
where source = 'lost_call_sync' and transcription_status is null;

-- comparison_status / comparison_reason, by the same rule the edge function applies.
with mapped as (
  select id,
         case lower(coalesce(crm_status,''))
           when 'lost' then 'lost'
           when 'in followup' then 'follow_up'
           when 'qualified' then 'qualified'
           when 'sit visited' then 'qualified'
           when 'ov' then 'qualified'
           else null end as crm_derived,
         transcription_status as derived,
         status, crm_status
  from acc.transcriptions
  where source = 'lost_call_sync' and comparison_status is null
)
update acc.transcriptions t set
  comparison_status = case
    when m.status = 'non_transcribable' then 'NOT_COMPARABLE'
    when m.status <> 'completed' then 'NOT_COMPARABLE'
    when m.crm_derived is null or m.derived is null then 'NOT_COMPARABLE'
    when m.crm_derived = m.derived then 'MATCH'
    else 'MISMATCH' end,
  comparison_reason = case
    when m.status = 'non_transcribable'
      then 'The recording holds no human conversation, so there is nothing to compare against the CRM''s verdict.'
    when m.status <> 'completed'
      then 'This call has not been transcribed yet, so no comparison has been made.'
    when m.crm_derived is null
      then 'CRM status "' || coalesce(m.crm_status,'(none)') || '" is not one this report has sent before, so it was not checked against the call.'
    when m.derived is null
      then 'The conversation did not establish a clear outcome, so no status could be derived from it.'
    when m.crm_derived = m.derived
      then 'CRM has this lead as "' || m.crm_status || '" and the call agrees - the conversation reads as "' || m.derived || '".'
    else 'CRM has this lead as "' || m.crm_status || '" (' || m.crm_derived || ') but the call reads as "' || m.derived || '".'
  end
from mapped m where t.id = m.id;

-- ------------------------------------------- 4. ONE ROW PER LEAD (consolidation)
-- 13 leads currently hold two rows each. The newest call keeps the row; the older one is folded
-- into its call_history with everything that made it a call, then soft-deleted and tagged with
-- merged_into so the fold is traceable and undoable.
do $$
declare
  r        record;
  keeper   bigint;
  history  jsonb;
  trail    text[];
  uuids    text[];
begin
  for r in
    select lead_id from acc.transcriptions
    where source = 'lost_call_sync' and deleted_at is null and lead_id is not null
    group by lead_id having count(*) > 1
  loop
    -- Newest call keeps the row. Oldest-first everywhere else, because a history and a status trail
    -- are only meaningful in the order the calls actually happened.
    select id into keeper from acc.transcriptions
    where source = 'lost_call_sync' and deleted_at is null and lead_id = r.lead_id
    order by report_date desc nulls last, id desc limit 1;

    select jsonb_agg(x order by rd asc nulls first, rid asc) into history from (
      select f.report_date as rd, f.id as rid, jsonb_build_object(
          'call_uuid', f.call_uuid, 'recording_url', f.recording_url,
          'source_date', f.source_date, 'crm_status', f.crm_status,
          'processing_status', f.status, 'transcription_status', f.transcription_status,
          'comparison_status', f.comparison_status, 'comparison_reason', f.comparison_reason,
          'duration_seconds', f.duration_seconds, 'transcript', f.transcript,
          'utterances', f.utterances, 'dashboard_fields', f.dashboard_fields,
          'qa_evaluation', f.qa_evaluation, 'summary_verdict', f.summary_verdict,
          'non_transcribable_reason', f.non_transcribable_reason, 'last_error', f.last_error,
          'attempt_count', f.attempt_count, 'original_crm_response', f.original_crm_response,
          'queued_at', f.queued_at, 'processing_started_at', f.processing_started_at,
          'completed_at', f.completed_at, 'archived_at', now(),
          '_merged_from_row', f.id) as x
      from acc.transcriptions f
      where f.source = 'lost_call_sync' and f.deleted_at is null
        and f.lead_id = r.lead_id and f.id <> keeper
    ) s;

    -- Chronological, consecutive duplicates collapsed: {Qualified,Lost}, not {Lost,Lost,Qualified}.
    select array_agg(cs order by rd asc nulls first, rid asc) into trail from (
      select distinct on (crm_status) crm_status as cs, report_date as rd, id as rid
      from acc.transcriptions
      where source = 'lost_call_sync' and deleted_at is null
        and lead_id = r.lead_id and crm_status is not null
      order by crm_status, report_date asc nulls first, id asc
    ) t;

    select array_agg(distinct cu) into uuids from (
      select call_uuid as cu from acc.transcriptions
      where source = 'lost_call_sync' and deleted_at is null
        and lead_id = r.lead_id and call_uuid is not null
    ) u;

    update acc.transcriptions set
      call_history         = call_history || coalesce(history, '[]'::jsonb),
      status_trail         = coalesce(trail, status_trail),
      processed_call_uuids = coalesce(uuids, processed_call_uuids),
      updated_at           = now()
    where id = keeper;

    update acc.transcriptions set
      deleted_at  = now(),
      deleted_by  = 'system: folded into the lead row',
      merged_into = keeper
    where source = 'lost_call_sync' and deleted_at is null
      and lead_id = r.lead_id and id <> keeper;
  end loop;
end $$;

-- Queue numbers for what is already here, in the order it arrived, so any leftover pending work
-- keeps its place rather than jumping the day's new calls.
with ordered as (
  select id, row_number() over (order by report_date asc nulls first, id asc) as rn
  from acc.transcriptions
  where source = 'lost_call_sync' and deleted_at is null and queue_seq is null
)
update acc.transcriptions t
set queue_seq = o.rn
from ordered o where t.id = o.id;

-- Start the sequence past whatever the backfill used.
select setval('acc.transcription_queue_seq',
  greatest(1, coalesce((select max(queue_seq) from acc.transcriptions), 0)) + 1000);

-- ------------------------------------------------------------ 5. CONSTRAINTS
-- One live row per lead on the automatic path. Soft-deleted rows are excluded, so a lead whose row
-- was deleted can be re-imported cleanly.
create unique index if not exists transcriptions_one_row_per_lead
  on acc.transcriptions (lead_id)
  where source = 'lost_call_sync' and deleted_at is null and lead_id is not null;

-- The queue read: status + order, every minute, forever.
create index if not exists transcriptions_queue_order
  on acc.transcriptions (queue_seq, id)
  where source = 'lost_call_sync' and deleted_at is null;
create index if not exists transcriptions_status_source
  on acc.transcriptions (source, status) where deleted_at is null;
-- The dashboard's date filter.
create index if not exists transcriptions_source_date
  on acc.transcriptions (source_date) where source = 'lost_call_sync' and deleted_at is null;

commit;
