-- LEGAL NOTICES: ONE ROW PER NOTICE READ OUT OF AN UPLOADED DOCUMENT.
--
-- A legal notice arrives as a scan. Four things matter and all four are on the page:
--   header   - the sender's name, set in large type at the top left: an advocate, a firm, a
--              department. "ABU SIDDIQUE MALLIK". This is who the notice is FROM.
--   parties  - who it concerns. On a customer notice that is the "My Clients: 1. ... 2. ..." line,
--              first name after each number. On a government notice it is who the "To" addresses.
--              Both land in one column because the tracker shows one "Clients / Applicants".
--   subject  - the "Sub:" / "Subject:" line.
--   type     - Customer, Government or Other, judged from the document itself.
--
-- The reading is done by the same Gemini pipeline that already indexes the Legal archive (the
-- notices pass inside legal-ocr-batch), but the FILE is sent rather than the extracted text:
-- "top left, in large type" is a fact about layout, and content_text has thrown the layout away.
--
-- extract_state is pending -> done | failed. extract_attempts exists for the same reason the OCR
-- job counts failures: a scan that cannot be read must stop being retried every minute for ever.
create table if not exists acc.legal_notices (
  id                bigserial primary key,
  document_id       bigint not null references doc.documents(id) on delete cascade,
  notice_type       text,              -- 'Customer' | 'Government' | 'Other'
  header            text,              -- who the notice is from (large type, top left)
  parties           text[],            -- clients (Customer) or applicants (Government)
  subject           text,
  task_id           bigint references acc.ptasks(id) on delete set null,
  uploaded_at       timestamptz not null,
  due_date          date not null,     -- exactly 7 days after upload
  completed_at      timestamptz,       -- when the task was marked done
  completed_by      text,              -- who marked it done
  extract_state     text not null default 'pending',
  extract_attempts  int  not null default 0,
  extract_error     text,
  raw               jsonb,             -- what the model returned, kept for when a field looks wrong
  created_at        timestamptz not null default now()
);

-- One notice per document: re-reading a file must update its row, never add a second.
create unique index if not exists legal_notices_document_uniq on acc.legal_notices (document_id);
-- The extractor asks for pending rows oldest-first; partial, so it costs nothing on finished ones.
create index if not exists legal_notices_pending_idx
  on acc.legal_notices (uploaded_at)
  where extract_state = 'pending';
create index if not exists legal_notices_task_idx on acc.legal_notices (task_id) where task_id is not null;

alter table acc.legal_notices enable row level security;

-- NOTE: both policies are REPLACED three migrations later, in
-- 20261014065831_legal_notice_visibility_gate.sql. can_read('acc'/'doc') reads adm.users' per
-- module columns, and the Legal staff who need this had none of them - the tracker was visible to
-- nobody who needed it. Left here as applied rather than rewritten, so the history reads true.
create policy legal_notices_read on acc.legal_notices
  for select using ((select app.can_read('acc')) or (select app.can_read('doc')));
create policy legal_notices_write on acc.legal_notices
  for all using ((select app.can_write('acc'))) with check ((select app.can_write('acc')));

comment on table acc.legal_notices is
  'One row per legal notice uploaded to the Legal Notice folder. Filled by the notices pass in the '
  'legal-ocr-batch edge function, then tracked in Legal > Notices and scored in '
  'Legal > Scoreboard > Notice.';
comment on column acc.legal_notices.header is
  'Who the notice is FROM - the name in large type at the top left (advocate, firm, department). '
  'Shown as "Sent by Whom" in the tracker and as "Notice" on the scoreboard.';
comment on column acc.legal_notices.parties is
  'Who the notice is ABOUT: the numbered names after "My Clients:" on a customer notice, or the '
  '"To" addressee on a government one.';
comment on column acc.legal_notices.due_date is
  'Exactly 7 days after upload. The scoreboard measures against this, not against completed_at.';

-- THE FOLDER NOTICES ARE UPLOADED TO.
-- Sits at the Legal root beside Litigation and Projects, because a notice belongs to no project
-- until somebody reads it - and the extractor keys off this folder id, not off a file name.
insert into doc.folders (department, name, created_by, parent_id)
select 'Legal', 'Legal Notice', 'system', null
where not exists (
  select 1 from doc.folders where department='Legal' and name='Legal Notice' and parent_id is null
);
