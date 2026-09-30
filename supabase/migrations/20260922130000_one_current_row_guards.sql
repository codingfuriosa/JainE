-- Outstanding imported twice on 2026-09-22 and left TWO is_current snapshots for all 80 units.
-- Nothing failed - the importer marks the previous snapshot not-current and inserts a new one, which
-- is correct sequentially but not against a concurrent second run. Any reconciliation then reads an
-- ambiguous "current" balance for every unit, which is the one thing a customer-facing figure must
-- never be.
--
-- Keep the newest snapshot per unit, retire the rest (not deleted - the history is the audit trail).

update cust.outstanding_snapshot s
   set is_current = false
 where s.is_current
   and exists (select 1 from cust.outstanding_snapshot s2
                where s2.unit_id = s.unit_id and s2.is_current and s2.id > s.id);

-- Guards so "current" can only ever mean one row again. These are PARTIAL indexes, which is safe
-- here and deliberate: all three tables are written with the mark-not-current-then-insert idiom, not
-- with ON CONFLICT. A partial unique index cannot be inferred by `.upsert({onConflict:...})` - that
-- is exactly what silently broke cust.invoices and cust.money_receipts for eleven days - so if any
-- of these ever moves to an upsert, the index must move with it.
--
-- NOT constrained, on purpose: cust.receipt_reversals has ~22 rows per receipt_reversal_no, one per
-- revenue head, and their reversal_amount sums to total_reversal_amount. Those are line items, not
-- duplicates, and a uniqueness guard there would destroy real data.

create unique index if not exists outstanding_snapshot_current_uq
  on cust.outstanding_snapshot(unit_id) where is_current and deleted_at is null;

create unique index if not exists farvision_contacts_current_uq
  on cust.farvision_contacts(unit_id) where is_current and deleted_at is null;

create unique index if not exists cost_sheet_items_current_uq
  on cust.cost_sheet_items(unit_id, component) where is_current and deleted_at is null;

-- Check:
--   select unit_id, count(*) from cust.outstanding_snapshot
--    where is_current and deleted_at is null group by 1 having count(*) > 1;
