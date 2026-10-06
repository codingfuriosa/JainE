-- Customer referrals now go to the CRM (6 Oct 2026). Switched on after the test lead (719415,
-- Dream Gurukul, assigned to Dhrubajyoti Adhikary) was confirmed in the CRM.
update cust.referral_crm_config set enabled = true where id = 1;
