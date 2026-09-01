-- Cost sheets are per-unit and not standardized enough for CSV bulk import (each unit's differs) -
-- add it as a plain per-unit document type instead, reusing the existing customer_documents upload
-- pattern (same as celebration_photo/draft_agreement/etc) rather than the structured cost_sheet_items
-- CSV-import path, which is left in place but no longer exposed in the UI (zero rows were ever
-- imported through it, so nothing to migrate).
alter table cust.customer_documents drop constraint if exists customer_documents_doc_type_check;
alter table cust.customer_documents add constraint customer_documents_doc_type_check
  check (doc_type = any (array['celebration_photo','celebration_video','draft_agreement','possession_letter','parking_allotment','cost_sheet']));
