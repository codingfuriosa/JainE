-- Bring cust.units' fields in line with Farvision's own Unit master (Business Unit/Unit Type/
-- Sub-Unit Type/Code/Allotted To/Area Specification/Secondary Area Specification), while keeping the
-- flat one-row-per-flat model already in place - Farvision represents Tower/Floor/Flat as a real
-- parent-child hierarchy of "unit" records, but every existing feature here (RLS, construction
-- photos, maintenance, modification requests, the customer portal itself) assumes a cust.units row
-- IS a saleable flat with one customer, so that part deliberately isn't replicated.
--
-- Field mapping to Farvision's form:
--   Business Unit        -> project_id / cust.projects (already existed)
--   Code                  -> unit_code (already existed)
--   Unit Type (broad: Flat/Shop/Office/Parking) -> new unit_category
--   Sub-Unit Type (e.g. "3BHK")                 -> existing unit_type column, just relabelled in the UI
--   Allotted To           -> customer_id (already existed)
--   Area Specification    -> carpet_area_sqft (already existed) + new super_built_up/built_up/land
--   Secondary Area Spec   -> new secondary_* columns, all optional
alter table cust.units
  add column if not exists unit_category text,
  add column if not exists super_built_up_area_sqft numeric,
  add column if not exists built_up_area_sqft numeric,
  add column if not exists land_area_sqft numeric,
  add column if not exists secondary_super_built_up_area_sqft numeric,
  add column if not exists secondary_built_up_area_sqft numeric,
  add column if not exists secondary_carpet_area_sqft numeric,
  add column if not exists secondary_land_area_sqft numeric;
