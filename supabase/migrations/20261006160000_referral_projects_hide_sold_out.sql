-- Referral picker: sold-out projects are not offered (6 Oct 2026). Dream Palazzo, Dream Diamond and
-- Dream Ananta are hidden (kept, inactive, with their business units, should they be needed again);
-- the six ongoing projects of the staff Projects page (CONS_ONGOING) remain.
update cust.referral_projects set active = false, updated_at = now()
 where name in ('Dream Palazzo', 'Dream Diamond', 'Dream Ananta');
