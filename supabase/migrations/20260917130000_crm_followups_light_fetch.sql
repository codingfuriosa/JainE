-- SUPPORTS THE NEW FAST LIST FETCH (nexus-core.js trcFetchLight).
--
-- The Automatic Processing list used to fetch every row through acc.followup_timeline_v even when
-- nothing on screen needed transcription_status or status_match - a plain date-range browse, or a
-- filter by CRM status/business unit/personnel/search, all of which live on acc.crm_followups itself.
-- Measured directly: even a bare LIMIT 50 against the view still took 3-6s+ on a wide range, because
-- the view's joins to acc.followup_qa and acc.lead_level_progress_v need both sides SORTED for a
-- merge join before any LIMIT can apply - the date filter cannot prune that away, and a page-1 request
-- pays the same cost as fetching everything.
--
-- The fix (frontend-only, no migration needed for the fetch itself): read acc.crm_followups directly
-- for the list - no joins - and enrich only the leads on the CURRENT page afterwards, via the existing
-- acc.crm_lead_detail RPC (20260911090000), which is already fast per lead. This index is what that
-- direct read uses: the exact order the list has always sorted by (call_date, then communication_time,
-- then follow_up_id, all descending), so the fetch is an index scan rather than a sort of the whole
-- table. Verified: ~90ms for a realistic 79-day range, ~1.6s for the entire table's history - against
-- 3-6s+ for the same ranges through the view.
create index if not exists crm_followups_date_comm_id
  on acc.crm_followups (call_date desc, communication_time desc, follow_up_id desc);
