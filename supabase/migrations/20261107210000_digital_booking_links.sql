-- Generated Digital Booking Form links (7 Nov 2026).
--
-- Sales (and the Administrator) press "Generate Form" in Post Sales > Digital Forms, fill in what the customer must not
-- change (name, title, nationality, date of birth, mobile, email, contact person, block, floor, flat, flat number, car
-- park, bedrooms, built-up area, total sale price) and get ONE link: booking-form.html?t=<token>. It is the same page
-- for everybody - no HTML page is made per form. The token is 64 random hex characters, so it cannot be guessed; whoever
-- holds the link can open it (no login), nobody else can.
--
-- The customer's answers are saved here as they type (draft), together with the step they are on, their signature and
-- the PAN / Aadhaar files (kept in the private S3 bucket under portal/digital-booking/<link id>/). Closing the tab and
-- opening the link again lands on the same step with everything filled. When they submit, the full answers go to
-- acc.digital_booking_forms exactly like the open link does and the link is closed - nothing starts a Booking Form Flow
-- case (the user's choice).
--
-- All reading and writing of a link by the customer goes through the booking-form-public edge function (service role).
-- Staff reading it: only the Administrator and the Sales department (TEMPORARY, 7 Nov 2026 - same rule as the button in
-- src/core/24d-post-sales-digital-forms.js), because the token is the key to the form.

alter table acc.digital_booking_forms add column if not exists link_id uuid;

create or replace function acc.can_generate_booking_form()
returns boolean language sql stable security definer set search_path to '' as $$
  select lower(coalesce(app.current_user_email(),'')) = 'ayushruia1@gmail.com'
      or exists (select 1 from acc.user_profile p
                  where lower(p.email) = lower(app.current_user_email())
                    and 'Sales' = any(p.department))
$$;
revoke all on function acc.can_generate_booking_form() from public, anon;
grant execute on function acc.can_generate_booking_form() to authenticated, service_role;

create table if not exists acc.digital_booking_links (
  id             uuid primary key default gen_random_uuid(),
  token          text not null unique check (token ~ '^[a-f0-9]{64}$'),
  project        text not null,                      -- 'ananta'
  status         text not null default 'open' check (status in ('open','completed','cancelled')),
  prefill        jsonb not null,                     -- {values: {...answers set by Sales...}, locked: ['applicants.0.full_name', ...]}
  customer_name  text,                               -- for lists
  created_by     text,
  created_at     timestamptz not null default now(),
  opened_at      timestamptz,                        -- first time the customer opened it
  draft          jsonb,                              -- every answer so far (locked ones always Sales' values)
  draft_step     int not null default 0,
  draft_sig      text,                               -- signature drawn so far, as a PNG data URL
  draft_files    jsonb not null default '[]'::jsonb, -- [{id, applicant, kind, name, path: s3:..., size, at}]
  draft_saved_at timestamptz,
  completed_at   timestamptz,
  form_id        uuid references acc.digital_booking_forms(id),
  ref_no         text
);
create index if not exists digital_booking_links_time on acc.digital_booking_links (created_at desc);

alter table acc.digital_booking_links enable row level security;
drop policy if exists "sales read" on acc.digital_booking_links;
create policy "sales read" on acc.digital_booking_links for select to authenticated using (acc.can_generate_booking_form());
grant select on acc.digital_booking_links to authenticated;
grant all on acc.digital_booking_links to service_role;

-- Making a link: only people who may generate; the token is made here, never by the page.
create or replace function acc.generate_booking_link(p_project text, p_prefill jsonb)
returns text language plpgsql security definer set search_path to '' as $$
declare v_tok text;
begin
  if not acc.can_generate_booking_form() then raise exception 'Not allowed to generate booking forms'; end if;
  if p_project is distinct from 'ananta' then raise exception 'Unknown project'; end if;
  if p_prefill is null or jsonb_typeof(p_prefill) <> 'object' or jsonb_typeof(p_prefill->'values') <> 'object'
     or jsonb_typeof(p_prefill->'locked') <> 'array' or length(p_prefill::text) > 20000 then
    raise exception 'Invalid prefill';
  end if;
  v_tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into acc.digital_booking_links (token, project, prefill, customer_name, created_by)
  values (v_tok, p_project, p_prefill, left(coalesce(p_prefill->'values'->'applicants'->0->>'full_name',''), 200), lower(app.current_user_email()));
  return v_tok;
end $$;
revoke all on function acc.generate_booking_link(text, jsonb) from public, anon;
grant execute on function acc.generate_booking_link(text, jsonb) to authenticated;
