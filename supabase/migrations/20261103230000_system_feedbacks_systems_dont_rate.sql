-- System Feedbacks: Systems people (and the Administrator) post and read; they never rate.
-- Only Sales / Pre Sales (and the temporary extra tester, Manash Choudhury) rate.
-- Same rule as fhIsRater() in src/core/06-nav.js.
create or replace function feedback.is_system_rater()
returns boolean language sql stable security definer set search_path to '' as $$
  select not feedback.is_systems()
     and (lower(coalesce(app.current_user_email(),'')) = 'digitalmarketing@thejaingroup.com'
          or exists (select 1 from acc.user_profile p
                      where lower(p.email) = lower(app.current_user_email())
                        and p.department && array['Sales','Pre Sales']::text[]))
$$;
