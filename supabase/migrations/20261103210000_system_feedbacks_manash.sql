-- System Feedbacks: Manash Choudhury (digitalmarketing@, Marketing) rates System Feedbacks TEMPORARILY,
-- on the Administrator's word (2026-11-03) - Give Feedback only, not the Systems side. Same list as
-- SYSTEM_FEEDBACK_EXTRA in src/core/06-nav.js; take him off both when asked.
create or replace function feedback.is_systems()
returns boolean language sql stable security definer set search_path to '' as $$
  select lower(coalesce(app.current_user_email(),'')) = 'ayushruia1@gmail.com'
      or exists (select 1 from acc.user_profile p
                  where lower(p.email) = lower(app.current_user_email())
                    and 'Systems' = any(p.department))
$$;

create or replace function feedback.is_system_rater()
returns boolean language sql stable security definer set search_path to '' as $$
  select lower(coalesce(app.current_user_email(),'')) in ('ayushruia1@gmail.com','digitalmarketing@thejaingroup.com')
      or exists (select 1 from acc.user_profile p
                  where lower(p.email) = lower(app.current_user_email())
                    and p.department && array['Sales','Pre Sales']::text[])
$$;
