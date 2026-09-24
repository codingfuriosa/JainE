-- Import History showed "—" in its Project column for every Farvision .xlsx import.
--
-- Not an oversight in the renderer: the six .xlsx reports resolve a project per ROW from their own
-- Business Unit column, so one file legitimately spans several projects and no single project_id can
-- describe the batch. cpaImportConfirmXlsx therefore never set one, and the renderer's lookup of
-- project_id fell through to "—" every time. project_id stays for the CSV imports, which do pick one
-- project up front.
--
-- This records the SET of projects a batch touched instead.

alter table cust.import_batches
  add column if not exists project_names text[] not null default '{}';

comment on column cust.import_batches.project_names is
  'Every project this batch wrote to. The .xlsx Farvision reports carry a Business Unit per row and '
  'so can span several projects at once - project_id cannot describe them and is left null there.';

-- Backfill. raw_rows has held every matched record verbatim since the first import, and each one
-- carries its own businessUnit, so the history rows already on screen fill in without re-importing
-- anything. CSV batches have no businessUnit in raw_rows and correctly stay '{}' - they have a
-- project_id instead, which the renderer still falls back to.
update cust.import_batches b
set project_names = coalesce(m.names, '{}')
from (
  select b2.id,
         array_agg(distinct p.name) filter (where p.name is not null) as names
    from cust.import_batches b2
    cross join lateral jsonb_array_elements(b2.raw_rows) as r(rec)
    left join cust.projects p
      on lower(btrim(coalesce(p.farvision_project_code, ''))) = lower(btrim(r.rec ->> 'businessUnit'))
      or lower(btrim(p.name)) = lower(btrim(r.rec ->> 'businessUnit'))
   where jsonb_typeof(b2.raw_rows) = 'array'
   group by b2.id
) m
where b.id = m.id
  and b.project_names = '{}';

-- Check:
--   select id, import_type, project_names, matched_count from cust.import_batches order by id desc limit 20;
