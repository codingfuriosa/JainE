-- Receipt Register Details is per (receipt, invoice) allocation, not per physical receipt - a single
-- money receipt commonly gets split across several invoices (confirmed on real data: 457 physical
-- receipts produced 1955 allocation rows for Dream Gurukul alone). The old unique index only allowed
-- one row per (unit_id, receipt_no), which would reject every split receipt's second+ allocation.
alter table cust.farvision_receipts drop constraint if exists farvision_receipts_unit_no_uq;
drop index if exists cust.farvision_receipts_unit_no_uq;
create unique index if not exists farvision_receipts_unit_receipt_invoice_uq
  on cust.farvision_receipts (unit_id, receipt_no, coalesce(against_demand_no,''))
  where deleted_at is null and unit_id is not null;
comment on index cust.farvision_receipts_unit_receipt_invoice_uq is
  'One row per (receipt, invoice-it-was-applied-against) allocation, not per physical receipt - a '
  'single Money Receipt split across several invoices produces multiple rows sharing receipt_no.';
