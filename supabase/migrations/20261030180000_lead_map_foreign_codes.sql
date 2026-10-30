-- LEAD MAP: customers from outside India (30 Oct 2026). A Dream Ananta booking came from New York
-- (ZIP 11004), which the 6-digit Indian PIN rule refused. A foreign postal code is now stored as
-- <country code>-<code>, e.g. 'US-11004', so it can never be mistaken for an Indian PIN; Indian PIN
-- codes stay exactly as they were (six digits, first not 0).
alter table camp.lm_pins drop constraint if exists lm_pins_pincode_check;
alter table camp.lm_pins add constraint lm_pins_pincode_check
  check (pincode ~ '^[1-9][0-9]{5}$' or pincode ~ '^[A-Z]{2}-[A-Z0-9][A-Z0-9 -]{1,9}$');
alter table camp.lm_pincodes drop constraint if exists lm_pincodes_pincode_check;
alter table camp.lm_pincodes add constraint lm_pincodes_pincode_check
  check (pincode ~ '^[1-9][0-9]{5}$' or pincode ~ '^[A-Z]{2}-[A-Z0-9][A-Z0-9 -]{1,9}$');
