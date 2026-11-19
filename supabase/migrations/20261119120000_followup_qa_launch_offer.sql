-- Ananta "Launch Offer - Image" (CRM source 20741) leads: on the lead's first connected call, was the
-- launch offer briefed? Judged by crm-snapshot-qa as a separate step from the main QA, stored here.
alter table acc.followup_qa
  add column if not exists launch_offer_check jsonb,
  add column if not exists launch_offer_status text;

comment on column acc.followup_qa.launch_offer_status is
  'Ananta source 20741 leads only: Pass / Partial / Fail on the first connected call, Not Applicable on later calls; null for every other lead.';
