-- Post Sales: import Farvision bookings, demands, receipts, reversals and PTC transfers / refunds
-- (already imported into cust.* for the Customer Portal) into postsales.*. Installed and run 02-Oct-2026.
-- Safe to re-run: every imported row carries its Farvision id (farvision_*_id) and is skipped if present.
--
--   cust.units (one per booking) .......... postsales.bookings, numbered with Farvision's booking no.
--   cust.farvision_contacts / customers ... applicants (1st = contact / customer; co-applicant names split)
--   cust.cost_sheet_items ................. booking_charges + booking totals (GST at the project's rates)
--   cust.invoices + invoice_items ......... one booking milestone + one invoice per Farvision demand,
--                                           lines split Unit / Parking / EDC / Other by revenue head;
--                                           plus a "Balance as per agreement" milestone for the rest
--   cust.money_receipts ................... receipts (mode, instrument, deposit bank matched by account no.)
--   cust.receipt_reversals ................ that receipt marked reversed (cheque returns)
--   cust.ptc_transfers .................... payouts (transfer / refund) + a 'transfer' receipt on the
--                                           receiving booking
--   stages billed in Farvision ............ stage_events (tower, or floor for floor-level stages), so new
--                                           bookings are invoiced for completed stages at booking
-- Finally every imported booking is re-allocated (receipts into invoices, oldest due first).
--
-- run:  select postsales.import_farvision(true);   -- dry run: reports the counts, then rolls back
--       select postsales.import_farvision(false);  -- for real
create or replace function postsales.import_farvision(p_dry boolean)
 returns jsonb
 language plpgsql
 set search_path to 'postsales', 'public'
as $function$
declare
  u record; c record; inv record; rc record; pt record;
  v_b bigint; v_fl postsales.flats; v_floor int; v_g5 boolean; v_seq int; v_ms bigint; v_inv bigint; v_stage bigint; v_lvl text;
  v_no text; v_name text; v_tid bigint; v_src bigint; v_dst bigint; v_cnt int := 0; v_out jsonb;
  norm text;
begin
  select t.id into v_tid from postsales.towers t where t.project_id = 8 and lower(t.portal_tower) = 'block-3' and t.deleted_at is null;
  if v_tid is not null and not exists(select 1 from postsales.flats where tower_id = v_tid and upper(flat_code) = '13-14A' and deleted_at is null) then
    insert into postsales.floors(tower_id, floor_no) values (v_tid, 13) on conflict do nothing;
    insert into postsales.flats(tower_id, floor_id, flat_code, bhk, sba_sqft, built_up_sqft, carpet_sqft, status, remarks)
    select v_tid, (select id from postsales.floors where tower_id = v_tid and floor_no = 13), '13-14A', un.unit_type,
           un.super_built_up_area_sqft, un.built_up_area_sqft, un.carpet_area_sqft, 'available', 'Duplex - 13th & 14th floor'
    from cust.units un where un.project_id = 8 and un.tower = 'BLOCK-3' and un.unit_code = '13-14A' and un.deleted_at is null limit 1;
  end if;

  for u in
    select un.*, t.id as ps_tower_id
    from cust.units un
    join postsales.towers t on t.project_id = un.project_id and lower(t.portal_tower) = lower(un.tower) and t.deleted_at is null
    where un.deleted_at is null and not exists(select 1 from postsales.bookings b where b.farvision_unit_id = un.id)
    order by un.id
  loop
    v_fl := null;
    select * into v_fl from postsales.flats f where f.tower_id = u.ps_tower_id and upper(f.flat_code) = upper(u.unit_code) and f.deleted_at is null limit 1;
    continue when v_fl.id is null;
    select fl.floor_no into v_floor from postsales.floors fl where fl.id = v_fl.floor_id;
    c := null;
    select * into c from cust.farvision_contacts fc where fc.unit_id = u.id and fc.deleted_at is null and fc.is_current order by fc.booking_date desc nulls last, fc.id desc limit 1;
    v_g5 := u.project_id = any(array[1,2,6]);

    insert into postsales.bookings(project_id, tower_id, flat_id, booking_no, booking_date, status, sba_sqft, floor_no, rate,
        plan_name, farvision_unit_id, remarks, created_by, updated_by)
    values (u.project_id, u.ps_tower_id, v_fl.id, u.booking_no, coalesce(c.booking_date, u.created_at::date),
        case when u.status = 'cancelled' then 'cancelled' else 'active' end,
        coalesce(u.super_built_up_area_sqft, v_fl.sba_sqft, 0), coalesce(v_floor, 0), 0,
        'Farvision plan (imported)', u.id, 'Imported from Farvision', 'farvision-import', 'farvision-import')
    returning id into v_b;
    if u.status = 'cancelled' then
      update postsales.bookings set cancelled_on = coalesce(c.agreement_date, u.updated_at::date), cancel_reason = 'Cancelled in Farvision' where id = v_b;
    else
      update postsales.flats set status = 'booked', updated_at = now() where id = v_fl.id;
    end if;

    insert into postsales.booking_charges(booking_id, seq, kind, col, name, basis, rate, qty, amount, gst_rate, gst_amount)
    select v_b, row_number() over (order by x.ord, x.sort_order, x.id), x.kind, x.col, x.nm,
           case when x.kind in ('unit','plc','frc') and coalesce(u.super_built_up_area_sqft,0) > 0 then 'per_sqft' else 'fixed' end,
           case when x.kind in ('unit','plc','frc') and coalesce(u.super_built_up_area_sqft,0) > 0 then round(x.amount / u.super_built_up_area_sqft, 2) else x.amount end,
           case when x.kind in ('unit','plc','frc') then u.super_built_up_area_sqft else 1 end,
           x.amount, x.gr, round(x.amount * x.gr / 100)
    from (
      select ci.id, ci.sort_order, ci.amount,
             case when hh.h ~ '^UNIT COST' then 'unit' when hh.h ~ '^PLC' then 'plc' when hh.h ~ '^FLC' then 'frc' when hh.h ~ '^VEHICLE PARKING' then 'parking' else 'charge' end kind,
             case when hh.h ~ '^(UNIT COST|PLC|FLC)' then 'unit' when hh.h ~ '^VEHICLE PARKING' then 'parking'
                  when hh.h ~ '^(CHEQUE DISHONOU?RED|OTHER CHARGES|EXTRA WORK)' then 'other' else 'edc' end col,
             case when hh.h ~ '^UNIT COST' then 1 when hh.h ~ '^PLC' then 2 when hh.h ~ '^FLC' then 3 when hh.h ~ '^VEHICLE PARKING' then 4 else 5 end ord,
             case when hh.h ~ '^UNIT COST' then 'Unit Price' when hh.h ~ '^PLC' then 'PLC' when hh.h ~ '^FLC' then 'Floor Rise' when hh.h ~ '^VEHICLE PARKING' then 'Car Parking'
                  else initcap(lower(hh.h)) end nm,
             case when not v_g5 then 0 when hh.h ~ '^(UNIT COST|PLC|FLC|VEHICLE PARKING|HIGHER SPECIFICATION)' then 5 else 18 end gr
      from cust.cost_sheet_items ci,
           lateral (select trim(regexp_replace(regexp_replace(regexp_replace(upper(ci.component),'\s+AT\s+(ADJUSTABLE|DEPOSIT|ACTUAL)\s+AT\s*',' ','g'),'[_ ]+[0-9]+\s*$',''),'\.+$','')) h) hh
      where ci.unit_id = u.id and ci.deleted_at is null and ci.is_current and ci.amount <> 0) x;
    update postsales.bookings b set
      unit_net    = coalesce((select sum(amount) from postsales.booking_charges where booking_id = v_b and col = 'unit'),0),
      unit_gst    = coalesce((select sum(gst_amount) from postsales.booking_charges where booking_id = v_b and col = 'unit'),0),
      parking_net = coalesce((select sum(amount) from postsales.booking_charges where booking_id = v_b and col = 'parking'),0),
      parking_gst = coalesce((select sum(gst_amount) from postsales.booking_charges where booking_id = v_b and col = 'parking'),0),
      edc_net     = coalesce((select sum(amount) from postsales.booking_charges where booking_id = v_b and col = 'edc'),0),
      edc_gst     = coalesce((select sum(gst_amount) from postsales.booking_charges where booking_id = v_b and col = 'edc'),0),
      rate        = coalesce((select rate from postsales.booking_charges where booking_id = v_b and kind = 'unit' limit 1),0),
      parking_count = case when exists(select 1 from postsales.booking_charges where booking_id = v_b and col = 'parking') then 1 else 0 end
    where id = v_b;
    update postsales.bookings set total_consideration = unit_net + parking_net + edc_net,
                                  grand_total = unit_net + unit_gst + parking_net + parking_gst + edc_net + edc_gst where id = v_b;

    insert into postsales.booking_applicants(booking_id, seq, full_name, mobile, email, res_address)
    select v_b, 1, coalesce(nullif(trim(c.contact_name),''), cu.full_name, 'Unknown'), coalesce(c.contact_phone, cu.phone),
           lower(coalesce(nullif(trim(c.contact_email),''), cu.email)), c.contact_address
    from (select 1) one left join cust.customers cu on cu.id = u.customer_id;
    insert into postsales.booking_applicants(booking_id, seq, full_name)
    select v_b, 1 + row_number() over (), trim(n) from regexp_split_to_table(coalesce(c.co_applicant_name,''), '\s*(,|&|/|\mand\M)\s*') n
    where trim(n) <> '' and lower(trim(n)) <> lower(coalesce(trim(c.contact_name),''));

    v_seq := 0;
    for inv in
      select i.*, (select mode() within group (order by trim(ii.schedule)) from cust.invoice_items ii where ii.invoice_id = i.id) sched
      from cust.invoices i where i.unit_id = u.id and i.deleted_at is null and i.is_current
      order by i.document_date, i.id
    loop
      v_ms := null; v_stage := null; v_lvl := 'individual';
      v_name := coalesce(initcap(lower(inv.sched)), 'Demand');
      norm := regexp_replace(regexp_replace(upper(coalesce(inv.sched,'')), 'SLAB', 'CASTING', 'g'), '[^A-Z0-9]', '', 'g');
      select s.id, s.level into v_stage, v_lvl from postsales.stages s
       where s.project_id = u.project_id and s.deleted_at is null
         and regexp_replace(regexp_replace(upper(s.name), 'SLAB', 'CASTING', 'g'), '[^A-Z0-9]', '', 'g') = norm
       limit 1;
      if v_stage is null then v_lvl := 'individual'; end if;
      if inv.status <> 'Cancel' then
        v_seq := v_seq + 1;
        insert into postsales.booking_milestones(booking_id, seq, name, trigger_type, stage_id, unit_net, unit_gst, parking_net, parking_gst, edc_net, edc_gst, gross_total)
        select v_b, v_seq, v_name, v_lvl, v_stage,
          coalesce(sum(ii.amount) filter (where kk.k = 'unit'),0), coalesce(sum(ii.tax) filter (where kk.k = 'unit'),0),
          coalesce(sum(ii.amount) filter (where kk.k = 'parking'),0), coalesce(sum(ii.tax) filter (where kk.k = 'parking'),0),
          coalesce(sum(ii.amount) filter (where kk.k in ('edc','other')),0), coalesce(sum(ii.tax) filter (where kk.k in ('edc','other')),0),
          coalesce(sum(ii.amount + coalesce(ii.tax,0)),0)
        from cust.invoice_items ii,
             lateral (select case when upper(ii.revenue_head) ~ '^(UNIT COST|PLC|FLC)' then 'unit' when upper(ii.revenue_head) ~ '^VEHICLE PARKING' then 'parking'
                                  when upper(ii.revenue_head) ~ '^(CHEQUE DISHONOU?RED|OTHER CHARGES|EXTRA WORK)' then 'other' else 'edc' end k) kk
        where ii.invoice_id = inv.id
        returning id into v_ms;
      end if;
      v_no := inv.document_no;
      if exists(select 1 from postsales.invoices where invoice_no = v_no) then v_no := v_no || '/' || inv.id; end if;
      insert into postsales.invoices(project_id, booking_id, invoice_no, invoice_date, due_date, kind, booking_milestone_id, title, net, gst, total,
          status, raised_via, farvision_invoice_id, created_by, cancelled_at, cancel_reason)
      select u.project_id, v_b, v_no, inv.document_date, coalesce(inv.due_date, inv.document_date + 30), 'milestone', v_ms, v_name,
             coalesce(sum(ii.amount),0), coalesce(sum(ii.tax),0), coalesce(sum(ii.amount + coalesce(ii.tax,0)),0),
             case when inv.status = 'Cancel' then 'cancelled' else 'open' end, 'import', inv.id, 'farvision-import',
             case when inv.status = 'Cancel' then inv.document_date end, case when inv.status = 'Cancel' then 'Cancelled in Farvision' end
      from cust.invoice_items ii where ii.invoice_id = inv.id
      returning id into v_inv;
      insert into postsales.invoice_lines(invoice_id, seq, head, col, net, gst, total)
      select v_inv, row_number() over (order by min(ii.sort_order)), x.head, x.col, sum(ii.amount), sum(coalesce(ii.tax,0)), sum(ii.amount + coalesce(ii.tax,0))
      from cust.invoice_items ii,
           lateral (select case when upper(ii.revenue_head) ~ '^(UNIT COST|PLC|FLC)' then 'unit' when upper(ii.revenue_head) ~ '^VEHICLE PARKING' then 'parking'
                                when upper(ii.revenue_head) ~ '^(CHEQUE DISHONOU?RED|OTHER CHARGES|EXTRA WORK)' then 'other' else 'edc' end col,
                           case when upper(ii.revenue_head) ~ '^(UNIT COST|PLC|FLC)' then 'Unit (incl. PLC / floor rise)' when upper(ii.revenue_head) ~ '^VEHICLE PARKING' then 'Car Parking'
                                when upper(ii.revenue_head) ~ '^(CHEQUE DISHONOU?RED|OTHER CHARGES|EXTRA WORK)' then initcap(lower(regexp_replace(ii.revenue_head,'[_ ]+[0-9]+\s*$','')))
                                else 'Extra Development Charges' end head) x
      where ii.invoice_id = inv.id
      group by x.head, x.col;
    end loop;

    insert into postsales.booking_milestones(booking_id, seq, name, trigger_type, unit_net, unit_gst, parking_net, parking_gst, edc_net, edc_gst, gross_total)
    select v_b, v_seq + 1, 'Balance as per agreement (Farvision plan)', 'individual',
           greatest(0, b.unit_net - m.un), greatest(0, b.unit_gst - m.ug), greatest(0, b.parking_net - m.pn), greatest(0, b.parking_gst - m.pg),
           greatest(0, b.edc_net - m.en), greatest(0, b.edc_gst - m.eg),
           greatest(0, b.unit_net - m.un) + greatest(0, b.unit_gst - m.ug) + greatest(0, b.parking_net - m.pn) + greatest(0, b.parking_gst - m.pg) + greatest(0, b.edc_net - m.en) + greatest(0, b.edc_gst - m.eg)
    from postsales.bookings b,
         (select coalesce(sum(unit_net),0) un, coalesce(sum(unit_gst),0) ug, coalesce(sum(parking_net),0) pn, coalesce(sum(parking_gst),0) pg,
                 coalesce(sum(edc_net),0) en, coalesce(sum(edc_gst),0) eg from postsales.booking_milestones where booking_id = v_b) m
    where b.id = v_b and b.status = 'active'
      and greatest(0, b.unit_net - m.un) + greatest(0, b.unit_gst - m.ug) + greatest(0, b.parking_net - m.pn) + greatest(0, b.parking_gst - m.pg) + greatest(0, b.edc_net - m.en) + greatest(0, b.edc_gst - m.eg) > 1;

    for rc in
      select r.*, rv.receipt_reversal_no, rv.receipt_reversal_date, coalesce(rv.reason, rv.narration) rv_reason
      from cust.money_receipts r
      left join lateral (select * from cust.receipt_reversals x where x.unit_id = r.unit_id and x.receipt_no = r.receipt_no and x.deleted_at is null and x.is_current order by x.id limit 1) rv on true
      where r.unit_id = u.id and r.deleted_at is null and r.is_current and coalesce(r.total_amount,0) > 0
      order by r.receipt_date, r.id
    loop
      v_no := rc.receipt_no;
      if exists(select 1 from postsales.receipts where receipt_no = v_no) then v_no := v_no || '/' || rc.id; end if;
      insert into postsales.receipts(project_id, booking_id, receipt_no, receipt_date, mode, instrument_no, instrument_date, drawn_on, drawn_branch,
          bank_account_id, amount, narration, status, reversal_no, reversal_date, reversal_reason, reversed_by, farvision_receipt_id, created_by)
      values (u.project_id, v_b, v_no, rc.receipt_date,
          case lower(coalesce(rc.payment_mode,'')) when 'net banking' then 'net_banking' when 'cheque' then 'cheque' when 'demand draft' then 'dd'
               when 'jv' then 'jv' when 'cash' then 'cash' when 'rtgs/neft/imps' then 'rtgs_neft_imps' when 'upi' then 'upi' else 'net_banking' end,
          rc.instrument_no, rc.instrument_date, rc.drawn_on, rc.drawn_on_branch,
          (select ba.id from postsales.bank_accounts ba where ba.deleted_at is null and (ba.project_id is null or ba.project_id = u.project_id)
             and ((ba.account_no is not null and position(ba.account_no in coalesce(rc.deposit_bank,'')) > 0)
                  or (ba.account_no is null and upper(coalesce(rc.deposit_bank,'')) like '%' || upper(split_part(ba.name,' ',1)) || '%')) limit 1),
          rc.total_amount, rc.narration,
          case when rc.receipt_reversal_no is not null then 'reversed' else 'active' end,
          rc.receipt_reversal_no, rc.receipt_reversal_date, rc.rv_reason, case when rc.receipt_reversal_no is not null then 'farvision-import' end,
          rc.id, 'farvision-import');
    end loop;
    v_cnt := v_cnt + 1;
  end loop;

  for pt in select p.* from cust.ptc_transfers p where p.deleted_at is null and p.is_current and not p.is_reversed and coalesce(p.amount,0) > 0
             and not exists(select 1 from postsales.payouts x where x.farvision_ptc_id = p.id) order by p.document_date, p.id loop
    v_src := null; v_dst := null;
    select id into v_src from postsales.bookings where farvision_unit_id = pt.source_unit_id;
    select id into v_dst from postsales.bookings where farvision_unit_id = pt.transferee_unit_id;
    if v_src is not null then
      insert into postsales.payouts(project_id, booking_id, payout_no, kind, payout_date, amount, mode, to_booking_id, remarks, farvision_ptc_id, created_by)
      select b.project_id, b.id, pt.document_no || case when exists(select 1 from postsales.payouts where payout_no = pt.document_no) then '/' || pt.id else '' end,
             case when v_dst is null then 'refund' else 'transfer' end, pt.document_date, pt.amount, 'transfer', v_dst, pt.narration, pt.id, 'farvision-import'
      from postsales.bookings b where b.id = v_src;
    end if;
    if v_dst is not null then
      insert into postsales.receipts(project_id, booking_id, receipt_no, receipt_date, mode, instrument_no, amount, narration, paid_by, created_by)
      select b.project_id, b.id, pt.document_no || '/IN' || case when exists(select 1 from postsales.receipts where receipt_no = pt.document_no || '/IN') then '/' || pt.id else '' end,
             pt.document_date, 'transfer', pt.document_no, pt.amount,
             coalesce(pt.narration, 'Transferred from booking ' || coalesce(pt.source_booking_no,'')), 'Transfer from ' || coalesce(pt.source_booking_no,''), 'farvision-import'
      from postsales.bookings b where b.id = v_dst;
      if v_src is not null then
        update postsales.bookings set transferred_from = v_src where id = v_dst and transferred_from is null;
      end if;
    end if;
  end loop;

  insert into postsales.stage_events(project_id, tower_id, floor_no, stage_id, completed_on, remarks, created_by)
  select b.project_id, b.tower_id, case when s.level = 'floor' then b.floor_no end, s.id, min(i.invoice_date), 'From Farvision demands', 'farvision-import'
  from postsales.booking_milestones bm
  join postsales.bookings b on b.id = bm.booking_id and b.farvision_unit_id is not null
  join postsales.stages s on s.id = bm.stage_id
  join postsales.invoices i on i.booking_milestone_id = bm.id and i.status = 'open'
  group by b.project_id, b.tower_id, case when s.level = 'floor' then b.floor_no end, s.id
  on conflict (tower_id, stage_id, coalesce(floor_no, -9999)) do nothing;

  for u in select id from postsales.bookings where farvision_unit_id is not null loop
    perform postsales.reallocate_booking(u.id);
  end loop;

  select jsonb_build_object('imported',v_cnt,'bookings',(select count(*) from postsales.bookings),'active',(select count(*) from postsales.bookings where status='active'),
    'applicants',(select count(*) from postsales.booking_applicants),'invoices',(select count(*) from postsales.invoices),'inv_open_total',(select sum(total) from postsales.invoices where status='open'),
    'receipts',(select count(*) from postsales.receipts),'rcpt_active_total',(select sum(amount) from postsales.receipts where status='active'),'reversed',(select count(*) from postsales.receipts where status='reversed'),
    'payouts',(select count(*) from postsales.payouts),'payout_total',(select sum(amount) from postsales.payouts),'stage_events',(select count(*) from postsales.stage_events),
    'outstanding',(select sum(principal_outstanding) from postsales.booking_balances),'advance',(select sum(advance) from postsales.booking_balances),
    'consideration_active',(select sum(grand_total) from postsales.bookings where status='active'),'gurukul_no_bank',(select count(*) from postsales.receipts where bank_account_id is null and project_id=1 and mode<>'transfer'))
  into v_out;
  if p_dry then raise exception 'DRYRUN %', v_out; end if;
  return v_out;
end $function$;
