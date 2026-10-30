-- Adds jaingroupcaller11 to the pre-sales roster (Level 1: not in TRC_LEVEL2_EMAILS).
-- acc.crm_presales_emails() reads this table, so crm_build_queue() queues this caller's
-- recordings for transcription + QA from the next snapshot onward. Name is a placeholder -
-- update full_name once confirmed.
insert into acc.crm_presales_personnel (email, full_name, sort_order) values
  ('jaingroupcaller11@thejaingroup.com', 'Caller 11', 10)
on conflict (email) do nothing;
