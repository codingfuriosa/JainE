-- 10 Oct 2026: customers no longer edit their contact details in the portal - Farvision is the source
-- of truth, and a customer edit replaced Farvision's details on screen and on the Tax Invoice and
-- Demand Letter without post-sales knowing. Corrections go through Support and into Farvision.
-- The button is gone; the function is closed too, so it cannot be called directly. The table
-- (empty - nobody had used it) is kept for staff only.
revoke execute on function cust.save_my_contact(bigint, text, text, text) from public, anon, authenticated;
drop policy if exists contact_overrides_customer_select on cust.contact_overrides;
