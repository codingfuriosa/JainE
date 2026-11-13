-- 13 Nov 2026, on the Administrator's word: Generate Form (and the staff view of a submitted form) is switched off for Sales for now -
-- only the Administrator. This was queued as a one-off pg_cron job (booking-form-admin-only-once, 20:10 IST) so the function swap
-- happens outside office hours; the job unschedules itself. To give Sales back, run the earlier body of this function again:
--   select lower(coalesce(app.current_user_email(),'')) = 'ayushruia1@gmail.com'
--       or exists (select 1 from acc.user_profile p where lower(p.email) = lower(app.current_user_email()) and 'Sales' = any(p.department))
-- (and restore pdfCanGenerate() in src/core/24d-post-sales-digital-forms.js and staffUser() in supabase/functions/booking-form-public).
create or replace function acc.can_generate_booking_form()
returns boolean language sql stable security definer set search_path to '' as $$
  select lower(coalesce(app.current_user_email(),'')) = 'ayushruia1@gmail.com'
$$;
