-- Farvision source ids on imported Post Sales records: lets the import be re-run without duplicating,
-- and is the link back to cust.* (Customer Portal) for Stage 7.
alter table postsales.bookings     add column if not exists farvision_unit_id bigint references cust.units(id);
alter table postsales.invoices     add column if not exists farvision_invoice_id bigint references cust.invoices(id);
alter table postsales.receipts     add column if not exists farvision_receipt_id bigint references cust.money_receipts(id);
alter table postsales.payouts      add column if not exists farvision_ptc_id bigint references cust.ptc_transfers(id);
create unique index if not exists bookings_fv_uq on postsales.bookings (farvision_unit_id) where farvision_unit_id is not null;
create unique index if not exists invoices_fv_uq on postsales.invoices (farvision_invoice_id) where farvision_invoice_id is not null;
create unique index if not exists receipts_fv_uq on postsales.receipts (farvision_receipt_id) where farvision_receipt_id is not null;
create unique index if not exists payouts_fv_uq on postsales.payouts (farvision_ptc_id) where farvision_ptc_id is not null;
