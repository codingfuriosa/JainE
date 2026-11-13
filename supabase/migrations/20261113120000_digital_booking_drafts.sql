-- Drafts of the Generate Form page (13 Nov 2026): a half-filled form kept for the person who started it, edited and saved again as often as needed.
-- Strictly personal: a draft is readable, changeable and deletable only by its owner (nobody else - not even the Administrator - sees it), and only by
-- people who may generate forms at all (acc.can_generate_booking_form(): the Administrator and the Sales department, for now).
create table if not exists acc.digital_booking_drafts (
  id         uuid primary key default gen_random_uuid(),
  owner      text not null,                       -- lower-case email of the person who saved it
  name       text,
  values     jsonb not null,                      -- the boxes of the page, as typed (may be half empty)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint digital_booking_drafts_owner_lower check (owner = lower(owner))
);
create index if not exists digital_booking_drafts_owner on acc.digital_booking_drafts (owner, updated_at desc);
alter table acc.digital_booking_drafts enable row level security;
drop policy if exists "own drafts" on acc.digital_booking_drafts;
create policy "own drafts" on acc.digital_booking_drafts for all to authenticated
  using (owner = lower(coalesce(app.current_user_email(),'')) and acc.can_generate_booking_form())
  with check (owner = lower(coalesce(app.current_user_email(),'')) and acc.can_generate_booking_form());
grant select, insert, update, delete on acc.digital_booking_drafts to authenticated;
grant all on acc.digital_booking_drafts to service_role;
