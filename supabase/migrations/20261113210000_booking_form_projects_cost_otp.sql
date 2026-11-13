-- 13 Nov 2026 - the Digital Booking Form for every project, with a compulsory cost sheet and an emailed code (OTP).
-- Applied outside office hours as a one-off pg_cron job (booking-form-v7-ddl-once, 20:10 IST) that unschedules itself.
--  * links.otp: the emailed code is kept only as a hash, with its expiry, tries and send times (never readable by the page)
--  * forms.confirm_mail: whether the confirmation email went out (and any error)
--  * generate_booking_link / update_booking_link: any project the form knows (list below = PROJECTS in booking-form-public), and the cost sheet PDF is compulsory
alter table acc.digital_booking_links add column if not exists otp jsonb;
alter table acc.digital_booking_forms add column if not exists confirm_mail jsonb;

create or replace function acc.generate_booking_link(p_project text, p_prefill jsonb)
returns text language plpgsql security definer set search_path to '' as $fn$
declare v_tok text;
begin
  if not acc.can_generate_booking_form() then raise exception 'Not allowed to generate booking forms'; end if;
  if p_project is null or p_project <> all (array['ananta','dreamgurukul','dreamone12','dreamone34','dreamexotica','dreamvalley','dreamecocity','dreamecocitybungalow','dreamjainpailan','dreamgatewaypailan','dreamresidencymanor']) then raise exception 'Unknown project'; end if;
  if p_prefill is null or jsonb_typeof(p_prefill) <> 'object' or jsonb_typeof(p_prefill->'values') <> 'object'
     or jsonb_typeof(p_prefill->'locked') <> 'array' or length(p_prefill::text) > 20000 then
    raise exception 'Invalid prefill';
  end if;
  if coalesce(p_prefill->'cost_sheet'->>'path','') not like 's3:portal/digital-booking/cost-sheets/%' then raise exception 'The cost sheet (PDF) is compulsory'; end if;
  v_tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into acc.digital_booking_links (token, project, prefill, customer_name, created_by)
  values (v_tok, p_project, p_prefill, left(coalesce(p_prefill->'values'->'applicants'->0->>'full_name',''), 200), lower(app.current_user_email()));
  return v_tok;
end $fn$;

create or replace function acc.update_booking_link(p_id uuid, p_prefill jsonb)
returns boolean language plpgsql security definer set search_path to '' as $fn$
begin
  if not acc.can_generate_booking_form() then raise exception 'Not allowed to edit booking forms'; end if;
  if p_prefill is null or jsonb_typeof(p_prefill) <> 'object' or jsonb_typeof(p_prefill->'values') <> 'object'
     or jsonb_typeof(p_prefill->'locked') <> 'array' or length(p_prefill::text) > 20000 then
    raise exception 'Invalid prefill';
  end if;
  if coalesce(p_prefill->'cost_sheet'->>'path','') not like 's3:portal/digital-booking/cost-sheets/%' then raise exception 'The cost sheet (PDF) is compulsory'; end if;
  update acc.digital_booking_links
     set prefill = p_prefill,
         customer_name = left(coalesce(p_prefill->'values'->'applicants'->0->>'full_name',''), 200)
   where id = p_id and status = 'open';
  if not found then raise exception 'This link is not open any more'; end if;
  return true;
end $fn$;
