-- WHERE A CORRECTED BOOKING DOCUMENT IS KEPT.
--
-- The Check List, Welcome Letter and Allotment Letter are built from the stored reading every time
-- they are opened. That is right for a first draft and wrong for everything after it: the reading
-- cannot know a name the form spelled badly, a figure Accounts agreed to change, or a sentence the
-- customer asked for. Until now those corrections lived only in the preview window and were lost
-- the moment it closed, so the same edits were retyped on every download.
--
-- One row per booking per document. The edited page is kept as the HTML the editor produced, which
-- is the same shape the Word and PDF builders already walk, so nothing has to be re-interpreted to
-- hand it back.
--
-- Nothing is deleted here. Rebuilding from the booking overwrites the row with a fresh draft; the
-- previous text is gone from this table but the booking it was built from has not changed, so the
-- draft can always be made again.

create table if not exists acc.booking_doc_edits (
  case_id     bigint      not null,
  kind        text        not null check (kind in ('checklist','welcome','allotment')),
  html        text        not null,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  primary key (case_id, kind)
);

comment on table acc.booking_doc_edits is
  'Hand-corrected Check List / Welcome Letter / Allotment Letter, one row per booking per document. '
  'Written by the document editor; read back in place of the generated draft when present.';

alter table acc.booking_doc_edits enable row level security;

/* Same reach as the booking documents themselves: anyone signed in to the app may open a booking
   and correct its paperwork, and the row records who last did. Wrapped in a select so the role is
   worked out once for the statement rather than once per row. */
drop policy if exists booking_doc_edits_read on acc.booking_doc_edits;
create policy booking_doc_edits_read on acc.booking_doc_edits
  for select using ((select auth.role()) = 'authenticated');

drop policy if exists booking_doc_edits_write on acc.booking_doc_edits;
create policy booking_doc_edits_write on acc.booking_doc_edits
  for all using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

grant select, insert, update, delete on acc.booking_doc_edits to authenticated;
