-- Mirrors google_sync_error: a place for google-calendar-sync to record why turning on Google
-- Meet's built-in auto-record/auto-transcribe (via the Meet API spaces.patch call) failed for a
-- given meeting, e.g. the Workspace edition doesn't support it. Not surfaced in the UI yet, same
-- as google_sync_error isn't -- it's there to be queried when someone reports a call that didn't
-- auto-record, rather than swallowing the error silently.
alter table acc.meetings
  add column if not exists auto_record_error text;
