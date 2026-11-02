-- Digital Booking Form (2 Nov 2026): customers outside Kolkata fill the Dream Ananta booking form
-- themselves, from one open link per project (booking-form.html?p=ananta).
--
-- The page is public; it never talks to the database. It posts to the booking-form-public edge
-- function (service role), which checks the form, puts the PAN / Aadhaar files and the drawn
-- signatures into the private S3 bucket under portal/digital-booking/<id>/ (the same s3: paths the
-- rest of JainE opens) and writes one row here. For now a submission only lands in this table - it
-- does not start a Booking Form Flow case (the user's choice, 2 Nov 2026).
create table if not exists acc.digital_booking_forms (
  id            uuid primary key default gen_random_uuid(),
  ref_no        text unique,                       -- shown to the customer, e.g. ANA-2611-0007
  project       text not null,                     -- 'ananta'
  status        text not null default 'new' check (status in ('new','seen','used','rejected')),
  applicants    int,
  first_name    text,                              -- first applicant, for lists
  mobile        text,
  email         text,
  data          jsonb not null,                    -- every answer, exactly as the customer gave it
  files         jsonb not null default '[]'::jsonb, -- [{applicant, kind: pan|aadhaar|signature, path: s3:..., name}]
  terms_version text,
  submitted_at  timestamptz not null default now(),
  ip            text,
  user_agent    text,
  seen_by       text,
  seen_at       timestamptz,
  note          text
);
create index if not exists digital_booking_forms_time on acc.digital_booking_forms (submitted_at desc);
create index if not exists digital_booking_forms_ip on acc.digital_booking_forms (ip, submitted_at desc);

alter table acc.digital_booking_forms enable row level security;
drop policy if exists "staff read" on acc.digital_booking_forms;
create policy "staff read" on acc.digital_booking_forms for select to authenticated using (not app.is_customer());
drop policy if exists "staff update" on acc.digital_booking_forms;
create policy "staff update" on acc.digital_booking_forms for update to authenticated using (not app.is_customer()) with check (not app.is_customer());
grant select, update on acc.digital_booking_forms to authenticated;
grant all on acc.digital_booking_forms to service_role;

-- Reference numbers: project code, year+month, running number per project.
create table if not exists acc.digital_booking_counters (project text primary key, n int not null default 0);
grant all on acc.digital_booking_counters to service_role;
create or replace function acc.digital_booking_next_ref(p_project text, p_code text)
returns text language plpgsql security definer set search_path to '' as $$
declare v int;
begin
  insert into acc.digital_booking_counters (project, n) values (p_project, 1)
  on conflict (project) do update set n = acc.digital_booking_counters.n + 1
  returning n into v;
  return p_code || '-' || to_char(now() at time zone 'Asia/Kolkata', 'YYMM') || '-' || lpad(v::text, 4, '0');
end $$;
revoke all on function acc.digital_booking_next_ref(text, text) from public, anon, authenticated;
grant execute on function acc.digital_booking_next_ref(text, text) to service_role;
