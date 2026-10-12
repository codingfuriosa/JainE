-- The 63 channel partners, on the Channel Partners tab of Competitor Ads.
--
-- Page IDs were looked up by hand in Meta's public Ad Library on 2026-10-12 (exact-phrase search for
-- each name, the page ID read from the advertiser on the matching ads). 25 partners advertise from a
-- page of their own and get its ID, so the weekly queue pulls them. The other 38 had no ads and no
-- page that could honestly be called theirs; they are listed without an ID and with auto-sync off,
-- so they cost nothing until someone pastes their Ad Library link in Edit.
--
-- Four IDs are a probable rather than a certain match - their ads name no place, so the page could
-- not be confirmed as the Kolkata partner: Royal Estates, Dilip Das Real Estate, Propinvest and
-- Shiv Shakti Realty. Worth a glance in the Ad Library before trusting their ads.
--
-- Duplicates in the source list were merged: 360 Realtors (x4), Wordsmith Realty (x4, including
-- Wordsworth / Word Smith spellings), Somani (x3), Domus (x3), and pairs for Uniacres, AdobeHome,
-- Get My Ghar, MMR, The Home Store, APDS, Property Pistol, Shripali, Sidus, Liyaans / Liyans,
-- JJ Properties / J J Property Square and Property Invest / Propinvest. "Exact match" (a copied
-- filter label), "Jain Group" (already on Our Brands) and "Test broker 4" were left out.

insert into camp.competitor_watchlist (name, page_id, page_name, category, is_own_brand, active)
select v.name, v.page_id, v.page_name, 'partner', false, v.page_id is not null
  from (values
    ('Somani Realtors',                 '225064734280651',  'Somani Realtors'),
    ('360 Realtors',                    '240978709438113',  '360Realtors'),
    ('A.R Realtors',                    '117803544740800',  'A.R Realtors'),
    ('Regal Realty',                    '104937745638705',  'Regal Realty'),
    ('Hamlyn Realty',                   '937458569695814',  'Hamlyn Realty Pvt Ltd'),
    ('Estates21',                       '111394001702916',  'Estates21'),
    ('APDS Address',                    '112066298169036',  'APDS Address Realty'),
    ('Get My Ghar',                     '112054477099019',  'Get My Ghar'),
    ('Anarock',                         '1931766250424588', 'ANAROCK'),
    ('JJ Properties',                   '532695839919591',  'JJ Properties'),
    ('The Home Store',                  '102022075340026',  'The Homestore'),
    ('Astittva Group',                  '1142501565614914', 'Astittva Marketing'),
    ('MD Properties',                   '286634271721201',  'MD Properties'),
    ('Property Xpert',                  '674104762443595',  'PropertyXpert'),
    ('PropNex',                         '123406844182289',  'PropNex'),
    ('Wordsmith Realty',                '103859028515996',  'Wordsmith Realty'),
    ('Shripali Realtors',               '110506228717594',  'Shri Pali Realtors'),
    ('Domus Realty',                    '475471222321762',  'Domus Realty'),
    ('Royal Estates',                   '236738916180088',  'Royal Estates'),
    ('Dilip Das Real Estate',           '1221987254332813', 'Dilip Das'),
    ('Kaarryam Realty',                 '103736821612644',  'Kaarryam'),
    ('Propinvest',                      '104982949371049',  'Propinvest'),
    ('Royal Kolkata Properties',        '104254057870151',  'Royal Kolkata Properties'),
    ('Save Max',                        '102366578791128',  'Save Max Real Estate'),
    ('Shiv Shakti Realty',              '1416181274902765', 'Shiv Shakti Realty'),
    ('Visiontech Financial Services',   null, null),
    ('Liyaans Properties',              null, null),
    ('Uniacres Realty',                 null, null),
    ('AdobeHome',                       null, null),
    ('MG Global',                       null, null),
    ('Property Beach',                  null, null),
    ('Kolkata Homes (KOHO)',            null, null),
    ('MMR Realty',                      null, null),
    ('Threshold Developments',          null, null),
    ('G K Realty',                      null, null),
    ('India Home Realty',               null, null),
    ('PRAYAAS',                         null, null),
    ('The Bank of Real Estate',         null, null),
    ('New Way Real Estate',             null, null),
    ('Oneview Realty',                  null, null),
    ('Property Pistol',                 null, null),
    ('Raghav Realty',                   null, null),
    ('Aarambh Nest',                    null, null),
    ('Ambest Marketing',                null, null),
    ('Arth Realty',                     null, null),
    ('AS Group',                        null, null),
    ('D.N Properties',                  null, null),
    ('Eco Homes',                       null, null),
    ('Elite Properties',                null, null),
    ('Epic Realty',                     null, null),
    ('Gupta Realty',                    null, null),
    ('Home Vision India',               null, null),
    ('Homestead Realty',                null, null),
    ('Jay Tara Maa Enterprise',         null, null),
    ('Lightship Advisors',              null, null),
    ('Mina Enterprises',                null, null),
    ('Sidus Realty',                    null, null),
    ('SJ Realtors',                     null, null),
    ('The Griham',                      null, null),
    ('Upvalue',                         null, null),
    ('Urban Space Consultant',          null, null),
    ('Urbanestates',                    null, null),
    ('Uttam Gain',                      null, null)
  ) as v(name, page_id, page_name)
 where not exists (
   select 1 from camp.competitor_watchlist w
    where lower(w.name) = lower(v.name)
       or (v.page_id is not null and btrim(w.page_id) = v.page_id)
 );
