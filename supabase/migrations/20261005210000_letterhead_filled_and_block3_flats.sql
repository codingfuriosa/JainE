-- The documents were right and printed nearly empty, because the letterhead was never filled in.
-- All twelve projects had a blank company address, PAN, GSTIN and site address; eleven had no
-- company name at all. A demand letter with a bare name and no registered office, no PAN, no
-- GSTIN and no bank is not a demand letter, which is exactly how they looked.
--
-- Filled from the three documents actually supplied - the Gateway demand letter, the Gurukul
-- money receipt and the Ananta customer ledger - which all carry the same legal entity:
--   DREAM GATEWAY HOTELS LIMITED, JAIN GROUP 44/2A HAZRA ROAD KOLKATA-19, PIN 700019
--   PAN AADCD0692H, GSTIN 19AADCD0692H1ZL, 033-40319999, assistant.md@thejaingroup.com
--
-- Only those three projects. The other nine are left blank rather than assumed into the same
-- entity: a wrong GSTIN on a demand for money is worse than a blank one, and Post Sales > Setup
-- now has the fields so somebody who knows can fill them.

update postsales.project_setup set
  company_name    = 'DREAM GATEWAY HOTELS LIMITED',
  company_address = E'JAIN GROUP 44/2A, HAZRA ROAD, KOLKATA-19\nKOLKATA, WEST BENGAL, INDIA, PIN: 700019',
  company_pan     = 'AADCD0692H',
  company_gstin   = '19AADCD0692H1ZL',
  contact_phone   = '033-40319999',
  contact_email   = 'assistant.md@thejaingroup.com'
where project_id in (1,2,10);

update postsales.project_setup
   set project_address = '154, Old Jessore Rd, Doltala, Ward 26, Dream Gurukul, near Fortune City, Madhyamgram, KOLKATA, WEST BENGAL, INDIA PIN Code: 700132'
 where project_id = 2;

-- The two flats that were sold into Block-3 but never set up, which is why import_farvision
-- silently skipped their bookings and the MIS was 76,70,151 light. Areas are the ones FarVision
-- already holds for units 443 and 444.
insert into postsales.flats(tower_id, floor_id, flat_code, bhk, sba_sqft, built_up_sqft, carpet_sqft, status, remarks, created_by)
select 52, 373, '6B', '5 BHK', 870, 870, 870, 'available', 'Added to match FarVision unit 443 - sold 02-10-2026', 'jaine-fix'
where not exists (select 1 from postsales.flats f where f.tower_id=52 and upper(f.flat_code)='6B' and f.deleted_at is null);

insert into postsales.flats(tower_id, floor_id, flat_code, bhk, sba_sqft, built_up_sqft, carpet_sqft, status, remarks, created_by)
select 52, 374, '7H', '2 BHK', 760, 608, 722, 'available', 'Added to match FarVision unit 444 - sold 02-10-2026', 'jaine-fix'
where not exists (select 1 from postsales.flats f where f.tower_id=52 and upper(f.flat_code)='7H' and f.deleted_at is null);