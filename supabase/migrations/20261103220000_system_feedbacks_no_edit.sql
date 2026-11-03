-- System Feedbacks: a rating is given once and cannot be changed afterwards (Administrator, 2026-11-03).
drop policy if exists system_responses_update on feedback.system_responses;
revoke update on feedback.system_responses from authenticated;
