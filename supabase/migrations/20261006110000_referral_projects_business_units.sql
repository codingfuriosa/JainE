-- The CRM's business-unit ids for the referral project picker, as given on 6 Oct 2026:
--   2 Dream One, 3 Dream World City, 4 Dream Exotica, 5 Dream Eco City, 6 Dream Valley,
--   7 Dream Palazzo, 70 Dream Gurukul, 138 Dream Diamond, 171 Dream Ananta (the CRM's
--   "New Project near Airport"). 71 Durbaar Banquets is not a home project and is not offered.
-- Dream Residency Manor and Dream Eco City Bungalows have no business unit in that list, so they
-- leave the picker (kept, inactive).
update cust.referral_projects set business_unit_id = v.bu, sort = v.sort, active = true, updated_at = now()
  from (values ('Dream Gurukul',70,10),('Dream Exotica',4,20),('Dream World City',3,30),('Dream One',2,40),
               ('Dream Eco City',5,60),('Dream Valley',6,80)) v(name,bu,sort)
 where cust.referral_projects.name = v.name;

update cust.referral_projects set active = false, updated_at = now()
 where name in ('Dream Residency Manor','Dream Eco City Bungalows');

insert into cust.referral_projects(name, location, business_unit_id, active, sort)
select v.n, v.l, v.b, true, v.s
  from (values ('Dream Ananta','Near Airport',171,15),
               ('Dream Diamond',null::text,138,50),
               ('Dream Palazzo','Rajarhat',7,70)) v(n,l,b,s)
 where not exists (select 1 from cust.referral_projects p where p.name = v.n);
