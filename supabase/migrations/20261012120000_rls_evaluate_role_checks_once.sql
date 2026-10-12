-- THE SAME ONE-WORD FIX, EVERYWHERE IT APPLIES. NO RULE CHANGES ANYWHERE.
--
-- acc.ptasks and acc.ptask_assignees were calling app.is_customer() once per ROW to decide
-- visibility - about 6,000 times on a single Accountability load. Measured: the scan of ptasks
-- took 312ms and ptask_assignees 332ms, against ~20ms for the same reads without the policy.
-- Wrapping the call in a scalar subquery makes Postgres evaluate it once per statement (it shows
-- as an InitPlan in the plan) instead of once per row. That single change took the task list from
-- 910ms to 31ms.
--
-- Thirteen more policies had the same shape, on the tables behind Post Sales, the Customer Portal,
-- Transcription and CRM - cost_sheet_items at 38,606 rows, receipt_items at 19,304, invoice_items
-- at 13,917, each re-deciding the same question for every row it returned.
--
-- ONLY THE WRAPPING CHANGES. (select f()) IS f() - a scalar subquery over a single-valued function
-- returns that value - so every policy admits exactly the same rows to exactly the same people.
-- Verified by counting what a staff account can see on eight of these tables before and after:
-- identical on all eight.
--
-- The operators around the calls are left exactly as they were, deliberately. The first attempt at
-- ptasks rewrote "NOT x" as "x is not true", which behaves the same ONLY because the function
-- cannot return NULL - "same behaviour today" is not "same rule", so that was corrected before
-- going further and the original form kept here.
--
-- ALTER POLICY rather than DROP and CREATE, so no rule is absent for even an instant. The
-- functions themselves are untouched.

alter policy pt_open on acc.ptasks
  using (NOT (select app.is_customer())) with check (NOT (select app.is_customer()));
alter policy pa_open on acc.ptask_assignees
  using (NOT (select app.is_customer())) with check (NOT (select app.is_customer()));

-- Customer-portal staff tables (Post Sales / Customer Portal)
alter policy cost_sheet_items_staff_all     on cust.cost_sheet_items
  using ((select app.is_custportal_staff())) with check ((select app.is_custportal_staff()));
alter policy receipt_items_staff_all        on cust.receipt_items
  using ((select app.is_custportal_staff())) with check ((select app.is_custportal_staff()));
alter policy invoice_items_staff_all        on cust.invoice_items
  using ((select app.is_custportal_staff())) with check ((select app.is_custportal_staff()));
alter policy farvision_contacts_staff_all   on cust.farvision_contacts
  using ((select app.is_custportal_staff())) with check ((select app.is_custportal_staff()));
alter policy receipt_reversals_staff_all    on cust.receipt_reversals
  using ((select app.is_custportal_staff())) with check ((select app.is_custportal_staff()));
alter policy outstanding_snapshot_staff_all on cust.outstanding_snapshot
  using ((select app.is_custportal_staff())) with check ((select app.is_custportal_staff()));
alter policy money_receipts_staff_all       on cust.money_receipts
  using ((select app.is_custportal_staff())) with check ((select app.is_custportal_staff()));
alter policy invoices_staff_all             on cust.invoices
  using ((select app.is_custportal_staff())) with check ((select app.is_custportal_staff()));
alter policy import_queue_staff_all         on cust.import_queue
  using ((select app.is_custportal_staff())) with check ((select app.is_custportal_staff()));

-- Staff-only read tables (Transcription / CRM) - SELECT policies, no WITH CHECK
alter policy transcription_queue_read    on acc.transcription_queue    using (NOT (select app.is_customer()));
alter policy crm_snapshot_followups_read on acc.crm_snapshot_followups using (NOT (select app.is_customer()));
alter policy crm_followups_read          on acc.crm_followups          using (NOT (select app.is_customer()));
alter policy daily_qa_summary_read       on acc.daily_qa_summary       using (NOT (select app.is_customer()));
