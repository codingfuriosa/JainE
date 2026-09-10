-- Sales Details' cost-sheet block carries, per component, two 5-column tiers (BASIC and TAX),
-- each with Basic/Bill/Received/Balance/Onaccount Amount. amount/tax_amount already capture the
-- Basic-Amount metric from each tier. These four columns capture the other four metrics, combined
-- across both tiers (gross, inclusive of the component's own tax where Farvision tracks one) -
-- the figures a customer-facing statement actually needs: what was billed, received, still due,
-- and held on account for this specific charge line.
alter table cust.cost_sheet_items add column if not exists bill_amount numeric;
alter table cust.cost_sheet_items add column if not exists received_amount numeric;
alter table cust.cost_sheet_items add column if not exists balance_amount numeric;
alter table cust.cost_sheet_items add column if not exists onaccount_amount numeric;
comment on column cust.cost_sheet_items.bill_amount is 'Gross amount billed for this component so far (basic-tier + tax-tier Bill Amount)';
comment on column cust.cost_sheet_items.received_amount is 'Gross amount received against this component so far (basic-tier + tax-tier Received Amount)';
comment on column cust.cost_sheet_items.balance_amount is 'Gross amount still due for this component (basic-tier + tax-tier Balance Amount)';
comment on column cust.cost_sheet_items.onaccount_amount is 'Amount held on account against this component, not yet adjusted to a specific bill';
