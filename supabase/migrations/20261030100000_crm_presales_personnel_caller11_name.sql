-- Replaces the 'Caller 11' placeholder with the name the CRM API returns for this address
-- (acc.crm_followups.personnel_name = 'Paromita guha' on all 23 of their follow-ups).
update acc.crm_presales_personnel
   set full_name  = 'Paromita Guha',
       updated_at = now()
 where email = 'jaingroupcaller11@thejaingroup.com'
   and full_name = 'Caller 11';
