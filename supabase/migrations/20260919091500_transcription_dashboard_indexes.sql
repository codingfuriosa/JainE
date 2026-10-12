-- INDEXES FOR THE PATTERNS THIS PAGE ACTUALLY RUNS, BY REQUIREMENT (2026-09-19): filtered, sorted,
-- joined and paginated columns should stay fast as data keeps growing, not just today's row counts.
--
-- acc.transcription_queue had no index on call_date at all - every "how many recordings for this date"
-- check (the mismatch panel, this session's own recovery queries, crm_recompute_daily_qa_summary's own
-- queue join) fell back to a sequential scan of the whole table.
--
-- acc.followup_qa's is_latest_assessed (20260918100000) is what the dashboard, the mismatch tabs and
-- crm_recompute_daily_qa_summary all filter by now for "current state" - there was no index at all on
-- it, partial or otherwise, so every one of those reads scanned every historical row to find the
-- current ones. A partial index (most rows are NOT the latest for their lead, once a lead has more than
-- one assessed call) keeps this small and keeps mismatch_type usable in the same lookup.
create index if not exists transcription_queue_call_date
  on acc.transcription_queue (call_date);

create index if not exists followup_qa_current
  on acc.followup_qa (mismatch_type)
  where is_latest_assessed;
