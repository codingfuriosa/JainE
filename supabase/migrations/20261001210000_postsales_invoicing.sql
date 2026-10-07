-- Post Sales, Stage 4: invoicing (demands). See docs/post-sales-spec.md section 4.
--
-- Every invoice of kind 'milestone' is raised from one booking_milestones row and carries that
-- milestone's own Unit / Parking / EDC net + GST split (worked out at booking, rates locked), so an
-- invoice never re-prices anything. Due date is always invoice date + 30 days.
--
-- Three ways a milestone gets invoiced:
--   individual  - from the booking (by hand), or automatically once booking date + due_days has
--                 passed (booking amount: due_days 0, so at booking);
--   bulk        - a construction stage is marked complete for a tower (tower-level stage) or for one
--                 floor of a tower (floor-level stage): every active booking there whose plan waits on
--                 that stage is invoiced in one go, after a preview;
--   late_booking- a booking made after stages are already complete is invoiced for all of them when it
--                 is saved (raise_due_for_booking runs inside save_booking).
-- Every raise ends with reallocate_booking, so advances are applied straight away.

create table if not exists postsales.stage_events(
  id            bigserial primary key,
  project_id    bigint not null references cust.projects(id),
  tower_id      bigint not null references postsales.towers(id),
  floor_no      int,
  stage_id      bigint not null references postsales.stages(id),
  completed_on  date not null,
  remarks       text,
  created_at    timestamptz not null default now(),
  created_by    text default app.current_user_email()
);
create unique index if not exists stage_events_uq on postsales.stage_events (tower_id, stage_id, coalesce(floor_no, -9999));
comment on column postsales.stage_events.floor_no is 'Set only for floor-level stages (brickwork, flooring, POP); null for tower-level ones.';

-- One invoice from one milestone. Returns the invoice id, or null when it is already invoiced or has
-- nothing to bill. Does NOT reallocate (callers raising many do that once at the end).
create or replace function postsales.raise_milestone_invoice(p_bm_id bigint, p_date date, p_via text, p_event bigint)
 returns bigint language plpgsql security invoker set search_path = postsales, public
as $$
declare
  m postsales.booking_milestones; b postsales.bookings; v_id bigint; v_seq int := 0;
begin
  select * into m from postsales.booking_milestones where id = p_bm_id;
  if not found then raise exception 'Milestone not found'; end if;
  select * into b from postsales.bookings where id = m.booking_id;
  if b.status <> 'active' then return null; end if;
  if exists(select 1 from postsales.invoices where booking_milestone_id = m.id and status = 'open') then return null; end if;
  if coalesce(m.gross_total,0) <= 0 then return null; end if;
  insert into postsales.invoices(project_id, booking_id, invoice_no, invoice_date, due_date, kind, booking_milestone_id, title,
      net, gst, total, raised_via, stage_event_id)
  values (b.project_id, b.id, postsales.next_doc_no(b.project_id, 'INV', p_date), p_date, p_date + 30, 'milestone', m.id, m.name,
      m.unit_net + m.parking_net + m.edc_net, m.unit_gst + m.parking_gst + m.edc_gst, m.gross_total, p_via, p_event)
  returning id into v_id;
  if m.unit_net + m.unit_gst <> 0 then v_seq := v_seq + 1;
    insert into postsales.invoice_lines(invoice_id, seq, head, col, net, gst, total) values (v_id, v_seq, 'Unit (incl. PLC / floor rise)', 'unit', m.unit_net, m.unit_gst, m.unit_net + m.unit_gst); end if;
  if m.parking_net + m.parking_gst <> 0 then v_seq := v_seq + 1;
    insert into postsales.invoice_lines(invoice_id, seq, head, col, net, gst, total) values (v_id, v_seq, 'Car Parking', 'parking', m.parking_net, m.parking_gst, m.parking_net + m.parking_gst); end if;
  if m.edc_net + m.edc_gst <> 0 then v_seq := v_seq + 1;
    insert into postsales.invoice_lines(invoice_id, seq, head, col, net, gst, total) values (v_id, v_seq, 'Extra Development Charges', 'edc', m.edc_net, m.edc_gst, m.edc_net + m.edc_gst); end if;
  -- the net/GST split on the milestone was rounded per column; keep the header equal to its lines
  update postsales.invoices set net = (select coalesce(sum(net),0) from postsales.invoice_lines where invoice_id = v_id),
                                gst = (select coalesce(sum(gst),0) from postsales.invoice_lines where invoice_id = v_id)
   where id = v_id;
  return v_id;
end $$;
grant execute on function postsales.raise_milestone_invoice(bigint, date, text, bigint) to authenticated;

-- Everything a booking is due for as of p_date: individual milestones past booking date + due_days, and
-- construction milestones whose stage is already complete for its tower / floor.
create or replace function postsales.raise_due_for_booking(p_booking_id bigint, p_date date, p_via text)
 returns int language plpgsql security invoker set search_path = postsales, public
as $$
declare
  b postsales.bookings; m record; v_n int := 0; v_ev bigint;
begin
  select * into b from postsales.bookings where id = p_booking_id;
  if not found or b.status <> 'active' then return 0; end if;
  for m in select bm.* from postsales.booking_milestones bm
            where bm.booking_id = b.id
              and not exists(select 1 from postsales.invoices i where i.booking_milestone_id = bm.id and i.status = 'open')
            order by bm.seq loop
    v_ev := null;
    if m.trigger_type = 'individual' then
      continue when m.due_days is null or b.booking_date + m.due_days > p_date;
    elsif m.trigger_type = 'tower' then
      select id into v_ev from postsales.stage_events where tower_id = b.tower_id and stage_id = m.stage_id and floor_no is null;
      continue when v_ev is null;
    else
      select id into v_ev from postsales.stage_events where tower_id = b.tower_id and stage_id = m.stage_id and floor_no = b.floor_no;
      continue when v_ev is null;
    end if;
    if postsales.raise_milestone_invoice(m.id, p_date, case when m.trigger_type = 'individual' then 'individual' else p_via end, v_ev) is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  if v_n > 0 then perform postsales.reallocate_booking(b.id); end if;
  return v_n;
end $$;
grant execute on function postsales.raise_due_for_booking(bigint, date, text) to authenticated;

-- Raise one milestone by hand (from the booking).
create or replace function postsales.raise_invoice(p_bm_id bigint, p_date date) returns bigint
 language plpgsql security invoker set search_path = postsales, public
as $$
declare v_id bigint; v_b bigint;
begin
  v_id := postsales.raise_milestone_invoice(p_bm_id, p_date, 'individual', null);
  if v_id is null then raise exception 'This milestone is already invoiced (or has nothing to bill)'; end if;
  select booking_id into v_b from postsales.invoices where id = v_id;
  perform postsales.reallocate_booking(v_b);
  return v_id;
end $$;
grant execute on function postsales.raise_invoice(bigint, date) to authenticated;

-- Individual milestones that have come due across a project (or every project): run from the Invoices tab.
create or replace function postsales.raise_due_individual(p_project_id bigint, p_date date) returns int
 language plpgsql security invoker set search_path = postsales, public
as $$
declare r record; v_n int := 0;
begin
  for r in select b.id from postsales.bookings b
            where b.status = 'active' and (p_project_id is null or b.project_id = p_project_id) loop
    v_n := v_n + postsales.raise_due_for_booking(r.id, p_date, 'individual');
  end loop;
  return v_n;
end $$;
grant execute on function postsales.raise_due_individual(bigint, date) to authenticated;

-- Bulk: mark a stage complete for a tower (or one floor of it) and invoice the chosen bookings.
-- p = {tower_id, stage_id, floor_no?, completed_on, invoice_date, booking_ids:[...], remarks}
create or replace function postsales.complete_stage(p jsonb) returns jsonb
 language plpgsql security invoker set search_path = postsales, public
as $$
declare
  v_t postsales.towers; v_s postsales.stages; v_ev bigint; v_floor int := nullif(p->>'floor_no','')::int;
  v_date date := (p->>'invoice_date')::date; r record; v_n int := 0; v_inv bigint;
begin
  select * into v_t from postsales.towers where id = (p->>'tower_id')::bigint;
  select * into v_s from postsales.stages where id = (p->>'stage_id')::bigint;
  if v_t.id is null or v_s.id is null then raise exception 'Tower or stage not found'; end if;
  if v_s.level = 'floor' and v_floor is null then raise exception '% is a floor-level stage - choose the floor', v_s.name; end if;
  if v_s.level = 'tower' then v_floor := null; end if;
  insert into postsales.stage_events(project_id, tower_id, floor_no, stage_id, completed_on, remarks)
    values (v_t.project_id, v_t.id, v_floor, v_s.id, (p->>'completed_on')::date, nullif(p->>'remarks',''))
    on conflict (tower_id, stage_id, coalesce(floor_no, -9999)) do update set completed_on = excluded.completed_on
    returning id into v_ev;
  for r in select bm.id, bm.booking_id from postsales.booking_milestones bm
            join postsales.bookings b on b.id = bm.booking_id
           where b.status = 'active' and b.tower_id = v_t.id and bm.stage_id = v_s.id
             and (v_floor is null or b.floor_no = v_floor)
             and b.id in (select (jsonb_array_elements_text(p->'booking_ids'))::bigint) loop
    v_inv := postsales.raise_milestone_invoice(r.id, v_date, 'bulk', v_ev);
    if v_inv is not null then v_n := v_n + 1; perform postsales.reallocate_booking(r.booking_id); end if;
  end loop;
  return jsonb_build_object('event_id', v_ev, 'invoices', v_n);
end $$;
grant execute on function postsales.complete_stage(jsonb) to authenticated;

create or replace function postsales.cancel_invoice(p_invoice_id bigint, p_reason text) returns void
 language plpgsql security invoker set search_path = postsales, public
as $$
declare v_b bigint;
begin
  update postsales.invoices set status = 'cancelled', cancelled_at = now(), cancelled_by = app.current_user_email(), cancel_reason = p_reason
   where id = p_invoice_id and status = 'open' returning booking_id into v_b;
  if v_b is null then raise exception 'Invoice not found or already cancelled'; end if;
  perform postsales.reallocate_booking(v_b);
end $$;
grant execute on function postsales.cancel_invoice(bigint, text) to authenticated;

-- save_booking: once money has been received against a booking its pricing and plan are fixed - only
-- applicants and booking details can still change. Before that, re-pricing cancels the booking's open
-- milestone invoices (kept on record as cancelled) and raises them again from the new figures. New
-- bookings are invoiced for everything already due (booking amount, completed stages) on save.
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
  v_locked boolean := false;
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
    v_locked := exists(select 1 from postsales.receipts where booking_id = v_id and status = 'active');
    if v_old_flat <> v_flat.id then
      if v_locked then raise exception 'Payments have been received on this booking - its flat can''t be changed (use a flat transfer)'; end if;
      if v_flat.status <> 'available' then raise exception 'Flat % is not available (it is %)', v_flat.flat_code, v_flat.status; end if;
      update postsales.flats set status = 'available', updated_at = now() where id = v_old_flat;
    end if;
  end if;

  if not v_locked then
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
      total_consideration = (b->>'total_consideration')::numeric, grand_total = (b->>'grand_total')::numeric
    where id = v_id;
  end if;
  update postsales.bookings set
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

  if not v_locked then
    update postsales.invoices set status = 'cancelled', cancelled_at = now(), cancelled_by = app.current_user_email(),
           cancel_reason = 'Booking re-priced', booking_milestone_id = null
     where booking_id = v_id and kind = 'milestone' and status = 'open';
    update postsales.invoices set booking_milestone_id = null where booking_id = v_id and status = 'cancelled';
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
  end if;

  update postsales.flats set status = 'booked', updated_at = now() where id = v_flat.id;
  -- booking amount (due 0 days after booking) and any stage already complete: invoiced now
  perform postsales.raise_due_for_booking(v_id, greatest(current_date, (b->>'booking_date')::date), 'late_booking');
  return v_id;
end $$;

alter table postsales.stage_events enable row level security;
drop policy if exists stage_events_staff_all on postsales.stage_events;
create policy stage_events_staff_all on postsales.stage_events for all to authenticated using (not app.is_customer()) with check (not app.is_customer());
grant select, insert, update, delete on postsales.stage_events to authenticated;
grant usage, select on all sequences in schema postsales to authenticated;
