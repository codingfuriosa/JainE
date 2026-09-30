-- Legal MIS: after a causelist is exported, every line item in it must be marked action-needed
-- or not (and, if needed, given a due date and a Legal-department person) before the user can do
-- anything else in JainE. These three columns are how a case remembers that decision was already
-- made, so the next causelist covering an overlapping date range doesn't ask about it again.
alter table public.mis_cases
  add column if not exists causelist_reviewed_at timestamptz,
  add column if not exists causelist_action_needed boolean,
  add column if not exists causelist_reviewed_by text;

comment on column public.mis_cases.causelist_reviewed_at is
  'Set the moment this case was answered (needed or not) in the compulsory causelist-export review popup. Null means it has never been asked.';
comment on column public.mis_cases.causelist_action_needed is
  'The Yes/No answered in that popup. Only meaningful when causelist_reviewed_at is set.';
comment on column public.mis_cases.causelist_reviewed_by is
  'Who answered for this case in the popup.';
