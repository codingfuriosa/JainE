-- Feedback Hub: the whole Systems team may read every form's responses (24 Nov 2026).
--
-- Why: the Systems team gets "Print all responses" and "Download Excel" (the All Responses tab in
-- Feedback Hub). Until now only the three people in feedback.can_design_forms() could read
-- feedback.responses and feedback.response_answers, so seven Systems people would have had buttons
-- that printed nothing. Systems = the same rule as System Feedbacks: department "Systems" in
-- acc.user_profile, plus the Administrator (feedback.is_systems()).
--
-- What this opens: reading, for those people, every response (respondent name, phone, email and the
-- answers) and the forms and questions the answers belong to. Nothing else changes - writing and
-- deleting forms stays with can_design_forms(), Accounts keep forms-only, nobody else reads responses.
-- Keep SYSTEMS in src/core/19-feedback-hub.js (fhCanTakeAll) and this function the same people.

create or replace function feedback.can_take_all_responses()
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $$
  select feedback.is_systems()
$$;

revoke all on function feedback.can_take_all_responses() from public;
grant execute on function feedback.can_take_all_responses() to authenticated;

drop policy if exists responses_read on feedback.responses;
create policy responses_read on feedback.responses for select to authenticated
  using (feedback.can_design_forms() or feedback.can_take_all_responses());

drop policy if exists response_answers_read on feedback.response_answers;
create policy response_answers_read on feedback.response_answers for select to authenticated
  using (feedback.can_design_forms() or feedback.can_take_all_responses());

drop policy if exists forms_read on feedback.forms;
create policy forms_read on feedback.forms for select to authenticated
  using (feedback.can_use_forms() or feedback.can_take_all_responses());

drop policy if exists form_questions_read on feedback.form_questions;
create policy form_questions_read on feedback.form_questions for select to authenticated
  using (feedback.can_use_forms() or feedback.can_take_all_responses());
