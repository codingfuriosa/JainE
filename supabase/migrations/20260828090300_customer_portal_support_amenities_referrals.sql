-- Customer Portal, increment 3: support tickets (synced to Zoho Desk), amenity booking with manual
-- QR/UPI payment (post-possession only), sub-meter fixing requests, and a customer referral program.
-- Same schema/RLS conventions as the rest of cust.* - customer-scoped select via unit ownership,
-- staff_all for writes, never `using(true)`.

begin;

-- ---------------------------------------------------------------------------
-- 1. Support tickets - raised here, created in Zoho Desk by the zoho-desk edge function, status
--    synced back into zoho_status/status. This table is the local mirror, not the system of record;
--    Zoho Desk itself is, which is why there's no customer-facing edit beyond raising the ticket.
-- ---------------------------------------------------------------------------
create table if not exists cust.support_tickets(
  id                  bigserial primary key,
  unit_id             bigint not null references cust.units(id),
  subject             text not null,
  description         text,
  status              text not null default 'open' check (status in ('open','in_progress','on_hold','closed')),
  zoho_ticket_id      text,
  zoho_ticket_number  text,
  zoho_status         text,
  last_synced_at      timestamptz,
  created_at          timestamptz not null default now(),
  created_by          text,
  deleted_at          timestamptz,
  deleted_by          text
);
create index if not exists support_tickets_unit_idx on cust.support_tickets (unit_id, created_at desc) where deleted_at is null;
comment on column cust.support_tickets.status is
  'Our own normalised status (open/in_progress/on_hold/closed), derived from zoho_status by the '
  'zoho-desk edge function when it syncs - zoho_status keeps Zoho''s own raw label for display.';

-- ---------------------------------------------------------------------------
-- 2. Amenities - bookable only once a unit has reached possession. One shared company payment QR/UPI
--    (below) rather than one per amenity, since the payment destination doesn't vary, only the amount.
-- ---------------------------------------------------------------------------
create table if not exists cust.amenities(
  id              bigserial primary key,
  project_id      bigint not null references cust.projects(id),
  name            text not null,
  description     text,
  rental_amount   numeric(12,2),
  created_at      timestamptz not null default now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_by      text
);
create index if not exists amenities_project_idx on cust.amenities (project_id) where deleted_at is null;

create table if not exists cust.amenity_bookings(
  id                 bigserial primary key,
  amenity_id         bigint not null references cust.amenities(id),
  unit_id            bigint not null references cust.units(id),
  booking_date       date not null,
  status             text not null default 'pending_payment' check (status in ('pending_payment','confirmed','cancelled')),
  amount             numeric(12,2),
  payment_reference  text,
  marked_paid_by     text,
  marked_paid_at     timestamptz,
  created_at         timestamptz not null default now(),
  created_by         text,
  deleted_at         timestamptz,
  deleted_by         text
);
-- One live booking per amenity per date - what makes the calendar meaningful at all.
create unique index if not exists amenity_bookings_date_uq on cust.amenity_bookings (amenity_id, booking_date) where status <> 'cancelled' and deleted_at is null;
create index if not exists amenity_bookings_unit_idx on cust.amenity_bookings (unit_id) where deleted_at is null;
comment on column cust.amenity_bookings.status is
  'pending_payment until staff sees the money land and marks it confirmed (or cancelled, freeing the '
  'date) - see the manual QR/UPI payment flow in custTabAmenities / cpaRenderAmenities.';

-- ---------------------------------------------------------------------------
-- 3. Sub-meter fixing requests - apply, staff invoices, customer pays (same manual QR/UPI), staff
--    marks paid then completed.
-- ---------------------------------------------------------------------------
create table if not exists cust.submeter_requests(
  id               bigserial primary key,
  unit_id          bigint not null references cust.units(id),
  status           text not null default 'requested' check (status in ('requested','invoiced','paid','completed','cancelled')),
  invoice_amount   numeric(12,2),
  invoice_storage_path text,
  payment_reference text,
  notes            text,
  requested_at     timestamptz not null default now(),
  requested_by     text,
  invoiced_at      timestamptz,
  invoiced_by      text,
  paid_at          timestamptz,
  marked_paid_by   text,
  completed_at     timestamptz,
  deleted_at       timestamptz,
  deleted_by       text
);
create index if not exists submeter_requests_unit_idx on cust.submeter_requests (unit_id, requested_at desc) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 4. Company payment settings - the one QR/UPI destination reused by amenity bookings and sub-meter
--    invoices alike. Single row (id=1), staff-editable, readable by any customer.
-- ---------------------------------------------------------------------------
create table if not exists cust.payment_settings(
  id               bigint primary key default 1,
  upi_id           text,
  qr_storage_path  text,
  updated_at       timestamptz not null default now(),
  updated_by       text,
  constraint payment_settings_singleton check (id = 1)
);
insert into cust.payment_settings(id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Referral program - customer submits a prospect's details and may update its status themselves
--    (an informal self-report), staff can also update it from their own follow-up.
-- ---------------------------------------------------------------------------
create table if not exists cust.referrals(
  id              bigserial primary key,
  unit_id         bigint not null references cust.units(id),
  prospect_name   text not null,
  prospect_phone  text,
  prospect_email  text,
  status          text not null default 'submitted' check (status in ('submitted','contacted','interested','visited_site','booked','not_interested')),
  notes           text,
  created_at      timestamptz not null default now(),
  created_by      text,
  updated_at      timestamptz not null default now(),
  updated_by      text,
  deleted_at      timestamptz,
  deleted_by      text
);
create index if not exists referrals_unit_idx on cust.referrals (unit_id, created_at desc) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array[
    'support_tickets','amenities','amenity_bookings','submeter_requests','payment_settings','referrals'
  ] loop
    execute format('alter table cust.%I enable row level security', t);
  end loop;
end $rls$;

-- support_tickets: customer sees/raises only their own unit's tickets. No customer update - Zoho
-- Desk is the system of record; the edge function (service role) is what writes zoho_* columns back.
do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.support_tickets'::regclass and polname='support_tickets_customer_select') then
    create policy support_tickets_customer_select on cust.support_tickets for select
      using (deleted_at is null and exists(select 1 from cust.units u where u.id=cust.support_tickets.unit_id
        and u.customer_id=app.current_customer_id() and u.deleted_at is null));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.support_tickets'::regclass and polname='support_tickets_customer_insert') then
    create policy support_tickets_customer_insert on cust.support_tickets for insert
      with check (exists(select 1 from cust.units u where u.id=cust.support_tickets.unit_id
        and u.customer_id=app.current_customer_id() and u.deleted_at is null));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.support_tickets'::regclass and polname='support_tickets_staff_all') then
    create policy support_tickets_staff_all on cust.support_tickets for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

-- amenities: visible to a customer only once THEIR unit in that project has reached possession.
do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.amenities'::regclass and polname='amenities_customer_select') then
    create policy amenities_customer_select on cust.amenities for select
      using (deleted_at is null and exists(select 1 from cust.units u where u.project_id=cust.amenities.project_id
        and u.customer_id=app.current_customer_id() and u.deleted_at is null and u.status='possession'));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.amenities'::regclass and polname='amenities_staff_all') then
    create policy amenities_staff_all on cust.amenities for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

-- amenity_bookings: any post-possession customer in the same project can see the calendar (which
-- dates are taken) - not just their own bookings - so they can pick a free date. Same possession gate.
do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.amenity_bookings'::regclass and polname='amenity_bookings_customer_select') then
    create policy amenity_bookings_customer_select on cust.amenity_bookings for select
      using (deleted_at is null and exists(
        select 1 from cust.amenities a join cust.units u on u.project_id=a.project_id
        where a.id=cust.amenity_bookings.amenity_id and u.customer_id=app.current_customer_id()
          and u.deleted_at is null and u.status='possession'));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.amenity_bookings'::regclass and polname='amenity_bookings_customer_insert') then
    create policy amenity_bookings_customer_insert on cust.amenity_bookings for insert
      with check (exists(select 1 from cust.units u where u.id=cust.amenity_bookings.unit_id
        and u.customer_id=app.current_customer_id() and u.deleted_at is null and u.status='possession'));
  end if;
  -- Deliberately NO customer update policy here. RLS "for update" can't be scoped to a single
  -- column - a blanket policy would let a customer set status='confirmed' or change amount directly
  -- via a raw API call, not just attach a payment reference. cust.set_amenity_booking_payment_ref()
  -- below is the narrow, single-column path for that instead.
  if not exists(select 1 from pg_policy where polrelid='cust.amenity_bookings'::regclass and polname='amenity_bookings_staff_all') then
    create policy amenity_bookings_staff_all on cust.amenity_bookings for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

-- submeter_requests: a customer's own unit only.
do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.submeter_requests'::regclass and polname='submeter_requests_customer_select') then
    create policy submeter_requests_customer_select on cust.submeter_requests for select
      using (deleted_at is null and exists(select 1 from cust.units u where u.id=cust.submeter_requests.unit_id
        and u.customer_id=app.current_customer_id() and u.deleted_at is null));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.submeter_requests'::regclass and polname='submeter_requests_customer_insert') then
    create policy submeter_requests_customer_insert on cust.submeter_requests for insert
      with check (exists(select 1 from cust.units u where u.id=cust.submeter_requests.unit_id
        and u.customer_id=app.current_customer_id() and u.deleted_at is null));
  end if;
  -- Same reasoning as amenity_bookings above: no blanket customer update policy - a customer
  -- attaching a payment reference goes through cust.set_submeter_payment_ref() instead, which
  -- touches only that one column.
  if not exists(select 1 from pg_policy where polrelid='cust.submeter_requests'::regclass and polname='submeter_requests_staff_all') then
    create policy submeter_requests_staff_all on cust.submeter_requests for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

-- payment_settings: any customer may read it (needed to show the QR/UPI on both payment flows above).
do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.payment_settings'::regclass and polname='payment_settings_customer_select') then
    create policy payment_settings_customer_select on cust.payment_settings for select
      using (app.is_customer());
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.payment_settings'::regclass and polname='payment_settings_staff_all') then
    create policy payment_settings_staff_all on cust.payment_settings for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

-- referrals: the owning customer may submit AND update status themselves (an informal self-report),
-- staff may also update from their own follow-up records.
do $pol$ begin
  if not exists(select 1 from pg_policy where polrelid='cust.referrals'::regclass and polname='referrals_customer_select') then
    create policy referrals_customer_select on cust.referrals for select
      using (deleted_at is null and exists(select 1 from cust.units u where u.id=cust.referrals.unit_id
        and u.customer_id=app.current_customer_id() and u.deleted_at is null));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.referrals'::regclass and polname='referrals_customer_insert') then
    create policy referrals_customer_insert on cust.referrals for insert
      with check (exists(select 1 from cust.units u where u.id=cust.referrals.unit_id
        and u.customer_id=app.current_customer_id() and u.deleted_at is null));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.referrals'::regclass and polname='referrals_customer_update') then
    create policy referrals_customer_update on cust.referrals for update
      using (exists(select 1 from cust.units u where u.id=cust.referrals.unit_id and u.customer_id=app.current_customer_id()))
      with check (exists(select 1 from cust.units u where u.id=cust.referrals.unit_id and u.customer_id=app.current_customer_id()));
  end if;
  if not exists(select 1 from pg_policy where polrelid='cust.referrals'::regclass and polname='referrals_staff_all') then
    create policy referrals_staff_all on cust.referrals for all
      using (app.is_custportal_staff()) with check (app.is_custportal_staff());
  end if;
end $pol$;

grant select, insert, update, delete on
  cust.support_tickets, cust.amenities, cust.amenity_bookings, cust.submeter_requests,
  cust.payment_settings, cust.referrals
  to authenticated, service_role;
grant usage, select on all sequences in schema cust to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Narrow, single-column write paths for the owning customer - the deliberate alternative to a
--    blanket RLS update policy on amenity_bookings/submeter_requests (see the comments above their
--    policies): each of these touches exactly one column, after checking the row is the caller's own.
-- ---------------------------------------------------------------------------
create or replace function cust.set_amenity_booking_payment_ref(p_booking_id bigint, p_reference text) returns void
 language plpgsql security definer set search_path = cust, public
as $$
begin
  update cust.amenity_bookings b set payment_reference = p_reference
  where b.id = p_booking_id
    and exists(select 1 from cust.units u where u.id = b.unit_id and u.customer_id = app.current_customer_id());
  if not found then raise exception 'Booking not found or not yours'; end if;
end;
$$;
grant execute on function cust.set_amenity_booking_payment_ref(bigint, text) to authenticated;

create or replace function cust.set_submeter_payment_ref(p_request_id bigint, p_reference text) returns void
 language plpgsql security definer set search_path = cust, public
as $$
begin
  update cust.submeter_requests r set payment_reference = p_reference
  where r.id = p_request_id
    and exists(select 1 from cust.units u where u.id = r.unit_id and u.customer_id = app.current_customer_id());
  if not found then raise exception 'Request not found or not yours'; end if;
end;
$$;
grant execute on function cust.set_submeter_payment_ref(bigint, text) to authenticated;

commit;
