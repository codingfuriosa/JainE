-- WHEREDOC BILL FILING (17 Oct 2026). The last step of Invoice Processing ("Bill Filing", Tapan) has
-- a File button instead of Done: Tapan picks the bill type, the project (Wheredoc site) and the box
-- file, and the wheredoc-file function originates the bill in Wheredoc with JainE's Id as its DocId,
-- uploads the bill's files to Wheredoc, files it in that box file, and only then completes the step.
--
-- One row per instance filed. The function writes it (service role) before completing the step, so a
-- retry after a failure half way never files the same bill twice - it sees the row and only finishes
-- the step. Wheredoc's own record number is kept for that check alone and is not shown anywhere in
-- JainE (the DocId people use is the JainE Id).
create table if not exists acc.wheredoc_filings (
  case_id        bigint primary key references acc.flow_cases(id) on delete cascade,
  jaine_id       bigint not null,
  docid          bigint not null,          -- the DocId in Wheredoc (= jaine_id)
  wheredoc_origin_id bigint,               -- Wheredoc's internal row id; for the double-filing check only
  folder_serial  bigint,                   -- the box file it was filed in
  doctype        text,
  site_name      text,
  party_name     text,
  files          int,
  filed_by       text not null,
  filed_at       timestamptz not null default now(),
  response       jsonb
);
alter table acc.wheredoc_filings enable row level security;
-- Read by anyone who can see the instance (the case panel shows "Filed in Wheredoc"); written only
-- by the function.
drop policy if exists wheredoc_filings_read on acc.wheredoc_filings;
create policy wheredoc_filings_read on acc.wheredoc_filings for select to authenticated
  using (exists (select 1 from acc.flow_cases c where c.id = case_id));
grant select on acc.wheredoc_filings to authenticated;

-- The wheredoc-file function reads the step being filed (who owns it, whether it is done) with the
-- service key, which could read instances but not their steps. Read only.
grant select on acc.flow_case_steps to service_role;
