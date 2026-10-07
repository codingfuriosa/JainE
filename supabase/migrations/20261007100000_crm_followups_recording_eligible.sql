-- The CRM API tags every follow-up with "recording_eligible" (true / false) inside the raw payload we
-- store in acc.crm_followups.raw. Surface it as a real column so the transcription dashboard can count
-- "Eligible for transcription" straight from the API's own flag. Generated from raw, so it follows every
-- future upsert with no change to the ingestion code. null = the API did not send the flag for that row
-- (older follow-ups).
alter table acc.crm_followups
  add column if not exists recording_eligible boolean
  generated always as ((raw->>'recording_eligible') = 'true') stored;
