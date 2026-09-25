-- clrevCheckPending() (run once per session from boot()) was showing the review popup to ANY
-- user with Legal MIS access, for every dated case nobody had answered yet — so a case Tanmoy
-- exported and left unanswered would nag Ankita on her next login too, even though she never
-- downloaded that causelist. This column records WHO actually exported a case into a causelist
-- (set the moment it's exported, cleared once answered), so the popup can be scoped to just them.
alter table public.mis_cases
  add column if not exists causelist_pending_by text;

comment on column public.mis_cases.causelist_pending_by is
  'Email of whoever most recently exported this case into a causelist and has not yet answered the action-review popup for it. Null once answered (causelist_reviewed_at set) or never exported. Scopes clrevCheckPending() to the actual exporter instead of every Legal MIS user.';
