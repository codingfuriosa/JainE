-- A DEMAND LETTER IS A LETTER FROM A COMPANY, AND HAD NO COMPANY ON IT.
--
-- postsales.project_setup held company_name and three GST rates. Everything else a printed demand
-- carries - the registered address, PAN, GSTIN, the phone and mailbox a customer is told to use -
-- was absent. FarVision's own demand letter prints all of it; ours printed a bare name.
--
-- Per project rather than per company, because these projects are run by different legal entities:
-- the Gateway letter says DREAM GATEWAY HOTELS LIMITED with its own PAN and GSTIN, and Gurukul's
-- does not. One global letterhead would put the wrong registration number on a demand for money.
--
-- Everything is nullable and prints only when filled, the way the reference letter leaves Service
-- Tax Registration No blank rather than inventing one.

alter table postsales.project_setup
  add column if not exists company_address text,
  add column if not exists company_pan     text,
  add column if not exists company_gstin   text,
  add column if not exists company_cin     text,
  add column if not exists contact_phone   text,
  add column if not exists contact_email   text,
  add column if not exists demand_terms    text;

comment on column postsales.project_setup.company_address is
  'Registered address, printed under the company name on demand notes, receipts and ledgers. Newlines are kept.';
comment on column postsales.project_setup.demand_terms is
  'Terms paragraph for the demand letter. Null falls back to the standard 18% per annum wording.';