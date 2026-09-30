-- Booking Register Summary imports failed with
--   new row for relation "import_batches" violates check constraint "import_batches_import_type_check"
--
-- cpaParseBookingRegister and the booking_register import branch were added to the admin panel, but
-- this constraint was never extended to match, so the batch row could never be written and the whole
-- import rolled back at the first step. Every other .xlsx report type is already listed.

alter table cust.import_batches drop constraint if exists import_batches_import_type_check;
alter table cust.import_batches add constraint import_batches_import_type_check
  check (import_type = any (array[
    'demand','receipts','cost_sheet','contacts',
    'maintenance_bills','maintenance_receipts',
    'sales_details','outstanding','invoice_register','receipt_register',
    'receipt_reversal','booking_register'
  ]));

-- Check:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'cust.import_batches'::regclass and contype = 'c';
