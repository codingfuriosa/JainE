-- Post Sales, Stage 2: bookings. See docs/post-sales-spec.md section 2.
--
-- A booking is made against an available postsales.flats row and keeps its OWN copy of everything it
-- was priced from - the rate, PLC/FRC rates, every charge and GST rate (booking_charges) and the
-- payment plan's milestones with their amounts (booking_milestones) - so later edits to setup never
-- change a booking already made ("rates locked at booking"). Editing a booking's plan away from the
-- standard one just sets is_non_standard; there is no approval step.
--
-- Payment-schedule amounts are GROSS (GST-inclusive), the same way the Estimated Offer Price sheet is
-- laid out: Unit (unit + PLC + FRC + their GST) / Parking / EDC columns, and "less booking amount" is
-- taken off the gross unit share (Dream Gurukul A1-1C: 10% of 48,75,297 = 4,87,530 less 2,10,000 =
-- 2,77,530). Each milestone also stores its net/GST split so invoices (Stage 4) can be raised from it.
--
-- Document numbers come from postsales.next_doc_no(): <project code>/<type>/<FY>/<0001>, one running
-- series per project, document type and Apr-Mar financial year. Shared with receipts (MR), invoices
-- (INV) and transfers (PTC) in later stages.

create table if not exists postsales.doc_counters(
  project_id   bigint not null references cust.projects(id),
  doc_type     text not null,
  fy           text not null,
  last_no      int not null default 0,
  primary key (project_id, doc_type, fy)
);

create or replace function postsales.fy_label(d date) returns text
 language sql immutable
as $$
  select case when extract(month from d) >= 4
              then to_char(d, 'YY') || '-' || to_char(d + interval '1 year', 'YY')
              else to_char(d - interval '1 year', 'YY') || '-' || to_char(d, 'YY') end
$$;

create or replace function postsales.next_doc_no(p_project_id bigint, p_doc_type text, p_date date)
 returns text language plpgsql security invoker set search_path = postsales, public
as $$
declare
  v_code text;
  v_fy text := postsales.fy_label(coalesce(p_date, current_date));
  v_no int;
begin
  select code into v_code from postsales.project_setup where project_id = p_project_id;
  if v_code is null then raise exception 'Project % has no code - set it in Post Sales > Setup', p_project_id; end if;
  insert into postsales.doc_counters(project_id, doc_type, fy, last_no) values (p_project_id, p_doc_type, v_fy, 1)
  on conflict (project_id, doc_type, fy) do update set last_no = postsales.doc_counters.last_no + 1
  returning last_no into v_no;
  return v_code || '/' || p_doc_type || '/' || v_fy || '/' || lpad(v_no::text, 4, '0');
end $$;

create table if not exists postsales.bookings(
  id                 bigserial primary key,
  project_id         bigint not null references cust.projects(id),
  tower_id           bigint not null references postsales.towers(id),
  flat_id            bigint not null references postsales.flats(id),
  booking_no         text not null,
  booking_date       date not null default current_date,
  status             text not null default 'active' check (status in ('active','cancelled','transferred')),
  -- pricing inputs and the snapshot they were priced from
  sba_sqft           numeric(10,2) not null,
  floor_no           int not null,
  rate               numeric(12,2) not null,
  discount_type      text not null default 'none' check (discount_type in ('none','per_sqft','lump_sum')),
  discount_value     numeric(14,2) not null default 0,
  parking_type_id    bigint references postsales.parking_types(id),
  parking_count      int not null default 0,
  plan_id            bigint references postsales.payment_plans(id),
  plan_name          text,
  is_non_standard    boolean not null default false,
  -- totals (net = excl. GST)
  unit_net           numeric(14,2) not null default 0,
  unit_gst           numeric(14,2) not null default 0,
  parking_net        numeric(14,2) not null default 0,
  parking_gst        numeric(14,2) not null default 0,
  edc_net            numeric(14,2) not null default 0,
  edc_gst            numeric(14,2) not null default 0,
  total_consideration numeric(14,2) not null default 0,
  grand_total        numeric(14,2) not null default 0,
  -- booking details
  purpose            text check (purpose in ('residential','investment')),
  loan_required      boolean,
  loan_bank          text,
  source             text,
  reason_chosen      text,
  sales_person       text,
  crm_lead_id        text,
  remarks            text,
  attachments        jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  created_by         text default app.current_user_email(),
  updated_at         timestamptz not null default now(),
  updated_by         text default app.current_user_email()
);
create unique index if not exists bookings_no_uq on postsales.bookings (booking_no);
create unique index if not exists bookings_flat_active_uq on postsales.bookings (flat_id) where status = 'active';
create index if not exists bookings_project_idx on postsales.bookings (project_id, booking_date desc);
comment on column postsales.bookings.unit_net is 'Unit price + PLC + floor rise, less discount, excl. GST.';
comment on column postsales.bookings.total_consideration is
  'unit_net + parking_net + edc_net, excl. GST - the base the 10% cancellation charge is taken on.';

create table if not exists postsales.booking_applicants(
  id                 bigserial primary key,
  booking_id         bigint not null references postsales.bookings(id) on delete cascade,
  seq                int not null default 1,
  title              text,
  full_name          text not null,
  relation_type      text check (relation_type in ('S/o','D/o','W/o','C/o')),
  relation_name      text,
  dob                date,
  nationality        text default 'Indian',
  resident_status    text default 'resident' check (resident_status in ('resident','nri','foreigner')),
  pan                text,
  aadhaar            text,
  passport_no        text,
  spouse_name        text,
  anniversary        date,
  occupation         text check (occupation in ('salaried','business','self_employed','govt','retired','other')),
  company            text,
  designation        text,
  gross_income       numeric(14,2),
  mobile             text,
  phone_res          text,
  phone_off          text,
  email              text,
  res_address        text,
  off_address        text,
  mailing_address    text not null default 'residential' check (mailing_address in ('residential','office')),
  permanent_address  text not null default 'residential' check (permanent_address in ('residential','office')),
  nri_bank_details   text,
  kyc                jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now()
);
create index if not exists booking_applicants_booking_idx on postsales.booking_applicants (booking_id, seq);
comment on column postsales.booking_applicants.seq is '1 = first applicant (the only one who gets a Customer Portal login).';
comment on column postsales.booking_applicants.kyc is 'Array of {type, name, path} - path is the s3: storage path.';

create table if not exists postsales.booking_charges(
  id                 bigserial primary key,
  booking_id         bigint not null references postsales.bookings(id) on delete cascade,
  seq                int not null default 0,
  kind               text not null check (kind in ('unit','plc','frc','discount','parking','charge')),
  col                text not null check (col in ('unit','parking','edc','other')),
  name               text not null,
  basis              text,
  rate               numeric(14,2),
  qty                numeric(12,2),
  amount             numeric(14,2) not null,
  gst_rate           numeric(5,2) not null default 0,
  gst_amount         numeric(14,2) not null default 0,
  source_id          bigint
);
create index if not exists booking_charges_booking_idx on postsales.booking_charges (booking_id, seq);
comment on column postsales.booking_charges.col is
  'Payment-schedule column the line belongs to: unit (unit/PLC/FRC/discount), parking, edc, or other (billed on its own).';

create table if not exists postsales.booking_milestones(
  id                 bigserial primary key,
  booking_id         bigint not null references postsales.bookings(id) on delete cascade,
  seq                int not null,
  name               text not null,
  trigger_type       text not null check (trigger_type in ('individual','tower','floor')),
  due_days           int,
  stage_id           bigint references postsales.stages(id),
  fixed_amount       numeric(14,2),
  less_fixed         boolean not null default false,
  unit_pct           numeric(6,3) not null default 0,
  edc_pct            numeric(6,3) not null default 0,
  parking_pct        numeric(6,3) not null default 0,
  unit_net           numeric(14,2) not null default 0,
  unit_gst           numeric(14,2) not null default 0,
  parking_net        numeric(14,2) not null default 0,
  parking_gst        numeric(14,2) not null default 0,
  edc_net            numeric(14,2) not null default 0,
  edc_gst            numeric(14,2) not null default 0,
  gross_total        numeric(14,2) not null default 0
);
create index if not exists booking_milestones_booking_idx on postsales.booking_milestones (booking_id, seq);

-- ---------------------------------------------------------------------------
-- save_booking: create (p_booking_id null) or replace a booking in one transaction.
-- p jsonb = {booking:{...columns}, applicants:[...], charges:[...], milestones:[...]}.
-- The screen does the pricing (it shows every figure before saving); this function only guards the
-- things that must not go wrong: the flat is available (or is this booking's own flat), the number
-- is issued once, and the flat's status follows the booking.
-- ---------------------------------------------------------------------------
create or replace function postsales.save_booking(p_booking_id bigint, p jsonb)
 returns bigint language plpgsql security invoker set search_path = postsales, public
as $$
declare
  b jsonb := p->'booking';
  v_flat postsales.flats;
  v_tower postsales.towers;
  v_id bigint := p_booking_id;
  v_old_flat bigint;
  v_no text;
begin
  select * into v_flat from postsales.flats where id = (b->>'flat_id')::bigint and deleted_at is null for update;
  if not found then raise exception 'Flat not found'; end if;
  select * into v_tower from postsales.towers where id = v_flat.tower_id;

  if v_id is null then
    if v_flat.status <> 'available' then raise exception 'Flat % is not available (it is %)', v_flat.flat_code, v_flat.status; end if;
    v_no := postsales.next_doc_no(v_tower.project_id, 'BK', (b->>'booking_date')::date);
    insert into postsales.bookings(project_id, tower_id, flat_id, booking_no, booking_date, sba_sqft, floor_no, rate)
      values (v_tower.project_id, v_tower.id, v_flat.id, v_no, (b->>'booking_date')::date, 0, 0, 0)
      returning id into v_id;
  else
    select flat_id into v_old_flat from postsales.bookings where id = v_id and status = 'active' for update;
    if not found then raise exception 'Only an active booking can be edited'; end if;
    if v_old_flat <> v_flat.id then
      if v_flat.status <> 'available' then raise exception 'Flat % is not available (it is %)', v_flat.flat_code, v_flat.status; end if;
      update postsales.flats set status = 'available', updated_at = now() where id = v_old_flat;
    end if;
  end if;

  update postsales.bookings set
    tower_id = v_tower.id, flat_id = v_flat.id,
    booking_date = (b->>'booking_date')::date,
    sba_sqft = (b->>'sba_sqft')::numeric, floor_no = (b->>'floor_no')::int, rate = (b->>'rate')::numeric,
    discount_type = coalesce(b->>'discount_type','none'), discount_value = coalesce((b->>'discount_value')::numeric,0),
    parking_type_id = nullif(b->>'parking_type_id','')::bigint, parking_count = coalesce((b->>'parking_count')::int,0),
    plan_id = nullif(b->>'plan_id','')::bigint, plan_name = b->>'plan_name', is_non_standard = coalesce((b->>'is_non_standard')::boolean,false),
    unit_net = (b->>'unit_net')::numeric, unit_gst = (b->>'unit_gst')::numeric,
    parking_net = (b->>'parking_net')::numeric, parking_gst = (b->>'parking_gst')::numeric,
    edc_net = (b->>'edc_net')::numeric, edc_gst = (b->>'edc_gst')::numeric,
    total_consideration = (b->>'total_consideration')::numeric, grand_total = (b->>'grand_total')::numeric,
    purpose = nullif(b->>'purpose',''), loan_required = (b->>'loan_required')::boolean, loan_bank = nullif(b->>'loan_bank',''),
    source = nullif(b->>'source',''), reason_chosen = nullif(b->>'reason_chosen',''), sales_person = nullif(b->>'sales_person',''),
    crm_lead_id = nullif(b->>'crm_lead_id',''), remarks = nullif(b->>'remarks',''),
    attachments = coalesce(b->'attachments','[]'::jsonb),
    updated_at = now(), updated_by = app.current_user_email()
  where id = v_id;

  delete from postsales.booking_applicants where booking_id = v_id;
  insert into postsales.booking_applicants(booking_id, seq, title, full_name, relation_type, relation_name, dob, nationality,
      resident_status, pan, aadhaar, passport_no, spouse_name, anniversary, occupation, company, designation, gross_income,
      mobile, phone_res, phone_off, email, res_address, off_address, mailing_address, permanent_address, nri_bank_details, kyc)
  select v_id, x.seq, x.title, x.full_name, x.relation_type, x.relation_name, x.dob, coalesce(x.nationality,'Indian'),
      coalesce(x.resident_status,'resident'), upper(x.pan), x.aadhaar, x.passport_no, x.spouse_name, x.anniversary, x.occupation,
      x.company, x.designation, x.gross_income, x.mobile, x.phone_res, x.phone_off, lower(x.email), x.res_address, x.off_address,
      coalesce(x.mailing_address,'residential'), coalesce(x.permanent_address,'residential'), x.nri_bank_details, coalesce(x.kyc,'[]'::jsonb)
  from jsonb_to_recordset(p->'applicants') as x(seq int, title text, full_name text, relation_type text, relation_name text, dob date,
      nationality text, resident_status text, pan text, aadhaar text, passport_no text, spouse_name text, anniversary date,
      occupation text, company text, designation text, gross_income numeric, mobile text, phone_res text, phone_off text,
      email text, res_address text, off_address text, mailing_address text, permanent_address text, nri_bank_details text, kyc jsonb);
  if not exists(select 1 from postsales.booking_applicants where booking_id = v_id) then
    raise exception 'A booking needs at least one applicant';
  end if;

  delete from postsales.booking_charges where booking_id = v_id;
  insert into postsales.booking_charges(booking_id, seq, kind, col, name, basis, rate, qty, amount, gst_rate, gst_amount, source_id)
  select v_id, x.seq, x.kind, x.col, x.name, x.basis, x.rate, x.qty, x.amount, x.gst_rate, x.gst_amount, x.source_id
  from jsonb_to_recordset(p->'charges') as x(seq int, kind text, col text, name text, basis text, rate numeric, qty numeric,
      amount numeric, gst_rate numeric, gst_amount numeric, source_id bigint);

  delete from postsales.booking_milestones where booking_id = v_id;
  insert into postsales.booking_milestones(booking_id, seq, name, trigger_type, due_days, stage_id, fixed_amount, less_fixed,
      unit_pct, edc_pct, parking_pct, unit_net, unit_gst, parking_net, parking_gst, edc_net, edc_gst, gross_total)
  select v_id, x.seq, x.name, x.trigger_type, x.due_days, x.stage_id, x.fixed_amount, coalesce(x.less_fixed,false),
      coalesce(x.unit_pct,0), coalesce(x.edc_pct,0), coalesce(x.parking_pct,0), x.unit_net, x.unit_gst, x.parking_net, x.parking_gst,
      x.edc_net, x.edc_gst, x.gross_total
  from jsonb_to_recordset(p->'milestones') as x(seq int, name text, trigger_type text, due_days int, stage_id bigint,
      fixed_amount numeric, less_fixed boolean, unit_pct numeric, edc_pct numeric, parking_pct numeric, unit_net numeric,
      unit_gst numeric, parking_net numeric, parking_gst numeric, edc_net numeric, edc_gst numeric, gross_total numeric);

  update postsales.flats set status = 'booked', updated_at = now() where id = v_flat.id;
  return v_id;
end $$;
grant execute on function postsales.save_booking(bigint, jsonb) to authenticated;
grant execute on function postsales.next_doc_no(bigint, text, date) to authenticated;
grant execute on function postsales.fy_label(date) to authenticated;

do $rls$
declare t text;
begin
  foreach t in array array['doc_counters','bookings','booking_applicants','booking_charges','booking_milestones'] loop
    execute format('alter table postsales.%I enable row level security', t);
    execute format('drop policy if exists %I on postsales.%I', t || '_staff_all', t);
    execute format('create policy %I on postsales.%I for all to authenticated using (not app.is_customer()) with check (not app.is_customer())', t || '_staff_all', t);
    execute format('grant select, insert, update, delete on postsales.%I to authenticated', t);
  end loop;
end $rls$;
grant usage, select on all sequences in schema postsales to authenticated;
