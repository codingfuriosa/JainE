-- THE LINKS BETWEEN TABLES THAT CARRY REAL DATA, INDEXED.
--
-- The database linter counts 232 foreign keys with no covering index. Most of those are on tables
-- that are empty or hold twenty rows, where an index would cost more to maintain than it could
-- ever save - so they are deliberately left alone. This is the subset that actually carries rows
-- today, picked by table size and by how often the portal reads through that link.
--
-- Every one of these is ADDITIVE: nothing is dropped, no query changes, no screen changes, no row
-- is touched. An index only ever gives the planner another way to find a row; if it turns out not
-- to help, dropping it is a one-line reversal with no other effect.
--
-- Where a column is null on most rows - the four ways a task can point at something in Recruitment
-- - the index is partial (WHERE ... IS NOT NULL). It then covers only the rows that have a value,
-- which is both smaller to store and cheaper to keep up to date on every insert.
--
-- NOTE ON WHY THIS IS NOT THE FIX FOR THE SLOWNESS. Measured on 2026-10-09, counting 42,741 rows
-- already held in memory took 5,348 ms where a healthy instance takes about 15. The database is
-- CPU-throttled, and no index addresses that. These are worth having regardless; they are not the
-- answer to "why is JAIN-E slow".

-- ── Pre-sales call analysis (the biggest tables in the database) ─────────────────────────────
create index if not exists crm_snapshot_followups_snap_lead_idx
  on acc.crm_snapshot_followups (snapshot_lead_id);
create index if not exists followup_qa_transcript_idx
  on acc.followup_qa (transcript_id) where transcript_id is not null;
create index if not exists crm_followups_first_snapshot_idx
  on acc.crm_followups (first_snapshot_id) where first_snapshot_id is not null;
create index if not exists crm_followups_last_snapshot_idx
  on acc.crm_followups (last_snapshot_id) where last_snapshot_id is not null;
create index if not exists crm_leads_last_snapshot_idx
  on acc.crm_leads (last_snapshot_id) where last_snapshot_id is not null;
create index if not exists transcription_queue_transcript_idx
  on acc.transcription_queue (transcript_id) where transcript_id is not null;
create index if not exists transcription_queue_snapshot_idx
  on acc.transcription_queue (snapshot_id) where snapshot_id is not null;

-- ── Accountability: tasks, their history and the workflow steps ──────────────────────────────
-- ptask_activity was read end to end 3,163 times and had never once used an index.
create index if not exists ptask_activity_task_idx   on acc.ptask_activity (task_id);
create index if not exists ptask_comments_task_idx   on acc.ptask_comments (task_id);
create index if not exists ptask_subtasks_task_idx   on acc.ptask_subtasks (task_id);
create index if not exists ptask_files_task_idx      on acc.ptask_files (task_id);
create index if not exists ptasks_parent_idx         on acc.ptasks (parent_task_id) where parent_task_id is not null;
create index if not exists ptasks_manpower_idx       on acc.ptasks (manpower_request_id) where manpower_request_id is not null;
create index if not exists ptasks_referral_idx       on acc.ptasks (referral_id) where referral_id is not null;
create index if not exists ptasks_candidate_idx      on acc.ptasks (candidate_id) where candidate_id is not null;
create index if not exists ptasks_interview_idx      on acc.ptasks (interview_id) where interview_id is not null;
create index if not exists flow_case_steps_step_idx  on acc.flow_case_steps (step_id);
create index if not exists flow_case_steps_task_idx  on acc.flow_case_steps (task_id) where task_id is not null;
create index if not exists notifications_case_idx    on acc.notifications (case_id) where case_id is not null;

-- ── Customer Portal: every FarVision import writes through import_batch_id ───────────────────
-- These are the tables the imports fill and then read back by batch. cost_sheet_items alone was
-- read end to end 5,704 times, 94 million rows.
create index if not exists cost_sheet_items_batch_idx       on cust.cost_sheet_items (import_batch_id);
create index if not exists receipt_items_batch_idx          on cust.receipt_items (import_batch_id);
create index if not exists receipt_reversals_batch_idx      on cust.receipt_reversals (import_batch_id);
create index if not exists farvision_contacts_batch_idx     on cust.farvision_contacts (import_batch_id);
create index if not exists money_receipts_batch_idx         on cust.money_receipts (import_batch_id);
create index if not exists cust_invoices_batch_idx          on cust.invoices (import_batch_id);
create index if not exists outstanding_snapshot_batch_idx   on cust.outstanding_snapshot (import_batch_id);
create index if not exists outstanding_items_batch_idx      on cust.outstanding_items (import_batch_id);
create index if not exists import_batches_project_idx       on cust.import_batches (project_id);

-- ── Post Sales ───────────────────────────────────────────────────────────────────────────────
create index if not exists ps_invoices_project_idx    on postsales.invoices (project_id);
create index if not exists ps_bookings_tower_idx      on postsales.bookings (tower_id) where tower_id is not null;
create index if not exists ps_bookings_plan_idx       on postsales.bookings (plan_id) where plan_id is not null;
create index if not exists ps_booking_ms_stage_idx    on postsales.booking_milestones (stage_id);
create index if not exists ps_flats_position_idx      on postsales.flats (position_id) where position_id is not null;
