-- Real Farvision PO-register data is now fully loaded into kraya.vtrend_purchases (see
-- 20260903120000 for the nullable column add) and every row has a business_unit, so lock the
-- column down for any future import.
alter table kraya.vtrend_purchases alter column business_unit set not null;
