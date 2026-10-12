-- raw_rows' comment claimed undo_import_batch reconstructs from it. It does not, and never has -
-- every branch of that function reverts via import_batch_id on the data tables. The claim mattered
-- because it made the column look load-bearing when it is not: a Receipt Register put ~6MB of JSON
-- into the single INSERT that opens an import, which exceeded the 8s statement_timeout on the
-- `authenticated` role once a second project was added, failing the whole import.
--
-- The admin panel now stores raw_rows only for imports of 2000 rows or fewer. Undo is unaffected.

comment on column cust.import_batches.raw_rows is
  'Audit copy of the parsed rows. INSPECTION ONLY - undo_import_batch reverts via import_batch_id on '
  'the data tables and never reads this. Populated only for imports of <= 2000 rows; above that it is '
  'left empty rather than truncated, since a partial array reads like a complete one. The source '
  '.xlsx is retained in the farvision-imports bucket and is the better record for large imports.';
