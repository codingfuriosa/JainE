-- The customer ledger prints the SITE address, not the company's. FarVision's prints
-- "154, Old Jessore Rd, Doltala, Ward 26, ... Madhyamgram, KOLKATA, WEST BENGAL, INDIA PIN 700132"
-- against "Name of project", which is where the flat is - a different thing from the registered
-- office on the letterhead, and the one a customer needs when looking for the site.
alter table postsales.project_setup
  add column if not exists project_address text;

comment on column postsales.project_setup.project_address is
  'Site address of the project, printed on the customer ledger beside the project name. Distinct from company_address, which is the registered office on the letterhead.';