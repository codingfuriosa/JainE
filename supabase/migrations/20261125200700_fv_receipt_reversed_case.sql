-- FARVISION IMPORT: BOUNCED CHEQUES (25 Nov 2026). Farvision writes "YES" (capitals) in the Receipt Register's "Is Reversed"
-- column; the importer only accepted "Yes", so no receipt was ever stored as reversed and the MIS Report counted 73 bounced /
-- reversed receipts (Rs 4.05 Cr, Nov 2023 - Nov 2026) as collection. Found comparing Ayush's Farvision files of 25 Nov with JainE.
-- Now any case is accepted. The 73 receipts were corrected the same day (is_reversed from cust.receipt_reversals).
-- Applied by the one-time cron fv_reversed_case_once (20:07 IST 25 Nov).
CREATE OR REPLACE FUNCTION cust.fv_apply_file(p_run bigint, p_queue bigint, p_type text, p_file text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cust', 'public'
AS $function$
#variable_conflict use_column
declare
  v_batch bigint;
  v_parsed int;
  v_matched int := 0;
  v_unmatched int := 0;
  v_skipped int := 0;
  v_projects text[];
  v_codes text[];
  v_raw jsonb;
  r jsonb;
  rec record;
  v_bk text;
  v_keep bigint;
  g_id bigint;
  g_cust bigint;
  g_email text;
  v_cust bigint;
  v_unit bigint;
  v_flags jsonb := '[]';
  v_created int := 0;
begin
  drop table if exists fv_rows;
  create temp table fv_rows on commit drop as
    select row_number() over (order by s.chunk, e.ord) rn, e.r
      from cust.import_stage s cross join lateral jsonb_array_elements(s.rows) with ordinality e(r, ord)
     where s.run_id = p_run and s.queue_id = p_queue;
  select count(*) into v_parsed from fv_rows;

  drop table if exists fv_pm;
  create temp table fv_pm on commit drop as
    select bu, cust.fv_project(bu) pid
      from (select distinct r ->> 'businessUnit' bu from fv_rows where coalesce(r ->> 'businessUnit', '') <> '') x;

  /* 2 Nov 2026: a booking JainE does not have is made from the Invoice / Receipt Register row
     itself instead of the row being dropped. Cancelled when the Receipt Register says so or when the
     flat already has a live booking; booked otherwise. No customer record, so no login or email. */
  /* The Customer Outstanding file too, for a booking with a balance either way: older customers who still
     owe money are in no other file JAIN-E reads, and without them the MIS outstanding was crores short. */
  if p_type in ('invoice_register', 'receipt_register', 'outstanding') then
    for rec in
      select f.r ->> 'bookingNo' bno, pm.pid,
             (array_agg(f.r ->> 'tower' order by f.rn desc))[1] tower,
             (array_agg(cust.fv_truthy(f.r -> 'unitCode') order by f.rn desc))[1] unit_code,
             (array_agg(f.r ->> 'customerName' order by f.rn desc))[1] cname,
             bool_or(coalesce(f.r ->> 'unitStatus', f.r ->> 'status', '') = 'Cancel') is_cancel
        from fv_rows f join fv_pm pm on pm.bu = f.r ->> 'businessUnit'
       where pm.pid is not null and coalesce(f.r ->> 'bookingNo', '') <> ''
         and (p_type <> 'outstanding' or coalesce(nullif(f.r ->> 'netOutstanding', '')::numeric, 0) <> 0)
         and not exists (select 1 from cust.units u where u.deleted_at is null and u.booking_no = f.r ->> 'bookingNo')
       group by 1, 2
       order by bool_or(coalesce(f.r ->> 'unitStatus', '') = 'Cancel'),
                max(coalesce(f.r ->> 'receiptDate', f.r ->> 'docDate')) desc nulls last
    loop
      continue when coalesce(rec.unit_code, '') = '';            -- a flat needs its flat number; the row stays unmatched
      insert into cust.units (project_id, unit_code, tower, booking_no, status, updated_at, created_by)
      values (rec.pid, rec.unit_code, rec.tower, rec.bno,
              case when rec.is_cancel or exists (
                     select 1 from cust.units u where u.deleted_at is null and u.status <> 'cancelled'
                        and u.project_id = rec.pid and cust.fv_norm(u.tower) = cust.fv_norm(rec.tower)
                        and cust.fv_norm(u.unit_code) = cust.fv_norm(rec.unit_code))
                   then 'cancelled' else 'booked' end,
              now(), 'auto-import:register')
      returning id into v_unit;
      insert into cust.farvision_contacts (unit_id, unit_code, booking_no, contact_name, is_current)
      values (v_unit, rec.unit_code, rec.bno, rec.cname, true);
      v_created := v_created + 1;
    end loop;
    -- the Outstanding file carries the customer's email and mobile: a booking known only from these files
    -- gets them from there, so its customer can be reminded (Sales Details covers only current sales)
    if p_type = 'outstanding' then
      update cust.farvision_contacts fc set contact_email = x.email, contact_phone = coalesce(x.mobile, fc.contact_phone)
        from (select distinct on (f.r ->> 'bookingNo') f.r ->> 'bookingNo' bno, nullif(trim(f.r ->> 'email'), '') email, nullif(trim(f.r ->> 'mobile'), '') mobile
                from fv_rows f where coalesce(trim(f.r ->> 'email'), '') <> '' order by f.r ->> 'bookingNo', f.rn desc) x,
             cust.units u
       where u.booking_no = x.bno and u.deleted_at is null and u.created_by = 'auto-import:register'
         and fc.unit_id = u.id and fc.is_current and fc.contact_email is distinct from x.email;
    end if;
    if p_type in ('receipt_register', 'outstanding') then
      update cust.units u set status = 'cancelled', updated_at = now()
        from (select distinct f.r ->> 'bookingNo' bno from fv_rows f where coalesce(f.r ->> 'unitStatus', f.r ->> 'status') = 'Cancel') c
       where u.booking_no = c.bno and u.created_by = 'auto-import:register'
         and u.deleted_at is null and u.status <> 'cancelled';
    end if;
  end if;

  if p_type = 'sales_details' then
    select count(*) filter (where pm.pid is not null), count(*) filter (where pm.pid is null)
      into v_matched, v_unmatched
      from fv_rows f left join fv_pm pm on pm.bu = f.r ->> 'businessUnit';
    if v_matched = 0 then
      return jsonb_build_object('type', p_type, 'file', p_file, 'queue_id', p_queue, 'parsed', v_parsed,
                                'matched', 0, 'unmatched', v_unmatched, 'note', 'empty - nothing to import');
    end if;

    select array_agg(distinct p.name order by p.name) into v_projects
      from fv_rows f join fv_pm pm on pm.bu = f.r ->> 'businessUnit' join cust.projects p on p.id = pm.pid;
    select array_agg(c) into v_codes from (
      select coalesce(nullif(f.r ->> 'bookingNo', ''), nullif(f.r ->> 'unitCode', '')) c
        from fv_rows f left join fv_pm pm on pm.bu = f.r ->> 'businessUnit' where pm.pid is null order by f.rn) x where c is not null;
    select case when v_matched <= 2000 then coalesce(jsonb_agg(f.r order by f.rn), '[]') else '[]' end into v_raw
      from fv_rows f join fv_pm pm on pm.bu = f.r ->> 'businessUnit' where pm.pid is not null;
    insert into cust.import_batches (import_type, file_name, imported_by, project_names, row_count, matched_count,
                                     unmatched_count, unmatched_codes, raw_rows)
    values (p_type, p_file, 'auto-import', coalesce(v_projects, '{}'), v_parsed, v_matched, v_unmatched,
            coalesce(v_codes, '{}'), v_raw)
    returning id into v_batch;

    for rec in
      select f.rn, f.r, pm.pid from fv_rows f join fv_pm pm on pm.bu = f.r ->> 'businessUnit'
       where pm.pid is not null order by f.rn
    loop
      r := rec.r;
      v_bk := r ->> 'bookingNo';
      v_keep := null; g_id := null; g_cust := null;
      if coalesce(v_bk, '') <> '' then
        select u.id, u.customer_id into g_id, g_cust from cust.units u
         where u.deleted_at is null and u.booking_no = v_bk order by u.id desc limit 1;
        if g_id is not null and g_cust is not null then
          if cust.fv_norm(r ->> 'email') = '' then
            v_keep := g_cust;
          else
            g_email := null;
            select c.email into g_email from cust.customers c where c.id = g_cust and c.deleted_at is null;
            if found and cust.fv_norm(g_email) <> cust.fv_norm(r ->> 'email') then
              v_keep := g_cust;
              v_flags := v_flags || jsonb_build_object('booking', v_bk, 'name', r ->> 'customerName',
                                                       'portal', g_email, 'farvision', r ->> 'email');
            end if;
          end if;
        end if;
      end if;

      v_cust := v_keep;
      if v_cust is null and coalesce(r ->> 'email', '') <> '' then
        select c.id into v_cust from cust.customers c
         where lower(c.email) = lower(r ->> 'email') and c.deleted_at is null limit 1;
        if v_cust is null then
          insert into cust.customers (full_name, email, phone, created_by)
          values (r ->> 'customerName', r ->> 'email', r ->> 'mobile', 'auto-import')
          returning id into v_cust;
        end if;
      end if;

      v_unit := null;
      if coalesce(v_bk, '') <> '' then
        select u.id into v_unit from cust.units u where u.deleted_at is null and u.booking_no = v_bk order by u.id desc limit 1;
      end if;
      if v_unit is null then
        v_unit := cust.fv_flat(rec.pid, r ->> 'tower', cust.fv_truthy(r -> 'unitCode'));
      end if;

      if v_unit is not null then
        update cust.units set
          project_id = rec.pid, unit_code = r ->> 'unitCode', tower = r ->> 'tower',
          floor_no = cust.fv_truthy(r -> 'floor'), unit_type = cust.fv_truthy(r -> 'typology'),
          carpet_area_sqft = cust.fv_truthy(r -> 'carpet')::numeric,
          super_built_up_area_sqft = cust.fv_truthy(r -> 'superBuiltUp')::numeric,
          built_up_area_sqft = cust.fv_truthy(r -> 'builtUp')::numeric,
          agreement_value = coalesce((r ->> 'totalBasic')::numeric, 0) + coalesce((r ->> 'totalTax')::numeric, 0),
          booking_no = v_bk, application_no = r ->> 'applicationNo', customer_id = v_cust, updated_at = now()
        where id = v_unit;
      else
        insert into cust.units (project_id, unit_code, tower, floor_no, unit_type, carpet_area_sqft,
                                super_built_up_area_sqft, built_up_area_sqft, agreement_value, booking_no,
                                application_no, customer_id, updated_at, created_by)
        values (rec.pid, r ->> 'unitCode', r ->> 'tower', cust.fv_truthy(r -> 'floor'), cust.fv_truthy(r -> 'typology'),
                cust.fv_truthy(r -> 'carpet')::numeric, cust.fv_truthy(r -> 'superBuiltUp')::numeric,
                cust.fv_truthy(r -> 'builtUp')::numeric,
                coalesce((r ->> 'totalBasic')::numeric, 0) + coalesce((r ->> 'totalTax')::numeric, 0),
                v_bk, r ->> 'applicationNo', v_cust, now(), 'auto-import')
        returning id into v_unit;
      end if;

      update cust.cost_sheet_items set is_current = false where unit_id = v_unit and is_current;
      insert into cust.cost_sheet_items (unit_id, component, amount, tax_amount, bill_amount, received_amount,
                                         balance_amount, onaccount_amount, sort_order, is_current, import_batch_id)
      select v_unit, ci ->> 'component', (ci ->> 'basicAmount')::numeric, (ci ->> 'taxAmount')::numeric,
             (ci ->> 'billAmount')::numeric, (ci ->> 'receivedAmount')::numeric, (ci ->> 'balanceAmount')::numeric,
             (ci ->> 'onaccountAmount')::numeric, (o - 1)::int, true, v_batch
        from jsonb_array_elements(coalesce(r -> 'costItems', '[]')) with ordinality c(ci, o);

      update cust.farvision_contacts set is_current = false where unit_id = v_unit and is_current;
      insert into cust.farvision_contacts (unit_id, unit_code, booking_no, contact_name, contact_phone, contact_email,
                                           contact_address, booking_date, agreement_date, is_current, import_batch_id)
      values (v_unit, r ->> 'unitCode', v_bk, r ->> 'customerName', r ->> 'mobile', r ->> 'email', r ->> 'address',
              (r ->> 'bookingDate')::date, (r ->> 'agreementDate')::date, true, v_batch);
    end loop;

    return jsonb_build_object('type', p_type, 'file', p_file, 'queue_id', p_queue, 'batch_id', v_batch,
                              'parsed', v_parsed, 'matched', v_matched, 'unmatched', v_unmatched,
                              'projects', to_jsonb(coalesce(v_projects, '{}')), 'email_flags', v_flags);
  end if;

  drop table if exists fv_m;
  create temp table fv_m on commit drop as
    select f.rn, f.r, pm.pid,
           case when p_type = 'ptc_transfer' or pm.pid is null then null
                else cust.fv_unit(pm.pid, f.r ->> 'bookingNo', f.r ->> 'tower', cust.fv_truthy(f.r -> 'unitCode')) end unit_id,
           case when p_type = 'ptc_transfer' and pm.pid is not null and coalesce(f.r ->> 'sourceBookingNo', '') <> '' then
                  (select u.id from cust.units u where u.deleted_at is null and u.booking_no = f.r ->> 'sourceBookingNo' order by u.id desc limit 1)
                end src_unit,
           case when p_type = 'ptc_transfer' and pm.pid is not null and coalesce(f.r ->> 'transfereeBookingNo', '') <> '' then
                  (select u.id from cust.units u where u.deleted_at is null and u.booking_no = f.r ->> 'transfereeBookingNo' order by u.id desc limit 1)
                end trf_unit
      from fv_rows f left join fv_pm pm on pm.bu = f.r ->> 'businessUnit';
  alter table fv_m add column ustatus text, add column ok boolean;
  update fv_m set ustatus = u.status from cust.units u where u.id = fv_m.unit_id;
  update fv_m set ok = case
      when pid is null then false
      when p_type = 'ptc_transfer' then (src_unit is not null or trf_unit is not null)
      when unit_id is null then false
      else true end;

  select count(*) filter (where ok), count(*) filter (where ok is false), count(*) filter (where ok is null)
    into v_matched, v_unmatched, v_skipped from fv_m;
  if v_matched = 0 then
    raise exception 'No rows matched registered projects in % (% unmatched)', p_file, v_unmatched;
  end if;

  select array_agg(distinct p.name order by p.name) into v_projects
    from fv_m m join cust.projects p on p.id = m.pid where m.ok;
  select array_agg(c) into v_codes from (
    select coalesce(nullif(m.r ->> 'bookingNo', ''), nullif(m.r ->> 'unitCode', ''), nullif(m.r ->> 'documentNo', '')) c
      from fv_m m where m.ok is false order by m.rn) x where c is not null;
  select case when v_matched <= 2000 then coalesce(jsonb_agg(m.r order by m.rn), '[]') else '[]' end into v_raw
    from fv_m m where m.ok;
  insert into cust.import_batches (import_type, file_name, imported_by, project_names, row_count, matched_count,
                                   unmatched_count, unmatched_codes, raw_rows)
  values (p_type, p_file, 'auto-import', coalesce(v_projects, '{}'), v_parsed, v_matched, v_unmatched,
          coalesce(v_codes, '{}'), v_raw)
  returning id into v_batch;

  if p_type = 'outstanding' then
    drop table if exists fv_last;
    create temp table fv_last on commit drop as
      select distinct on (unit_id) unit_id, r from fv_m where ok order by unit_id, rn desc;
    update cust.outstanding_snapshot o set is_current = false
      from fv_last l where o.unit_id = l.unit_id and o.is_current;
    insert into cust.outstanding_snapshot (unit_id, as_on_date, total_consideration, bill_outstanding, on_account,
                                           net_outstanding, late_fee_accrued, no_of_bills, is_current, import_batch_id)
    select l.unit_id, (now() at time zone 'utc')::date, (l.r ->> 'totalConsideration')::numeric,
           (l.r ->> 'billOutstanding')::numeric, (l.r ->> 'onAccount')::numeric, (l.r ->> 'netOutstanding')::numeric,
           (l.r ->> 'lateFee')::numeric, (l.r ->> 'noOfBills')::numeric::int, true, v_batch
      from fv_last l;
    update cust.outstanding_snapshot o set is_current = false
      from cust.units u
     where o.unit_id = u.id and o.is_current and u.deleted_at is null
       and u.project_id in (select distinct pid from fv_m where pid is not null)
       and u.id not in (select unit_id from fv_last);

  elsif p_type = 'invoice_register' then
    drop table if exists fv_g;
    create temp table fv_g on commit drop as
      select m.unit_id, m.r ->> 'docNo' doc, min(m.rn) first_rn, null::bigint inv_id
        from fv_m m where m.ok group by 1, 2;
    update fv_g g set inv_id = i.id from cust.invoices i
     where i.unit_id = g.unit_id and i.document_no = g.doc and i.is_current and i.deleted_at is null;
    update cust.invoices i set
        document_date = (m.r ->> 'docDate')::date,
        invoice_type = coalesce(cust.fv_truthy(m.r -> 'invoiceType'), 'Payment Plan'),
        due_date = (m.r ->> 'dueDate')::date, status = m.r ->> 'status', is_current = true, import_batch_id = v_batch
      from fv_g g join fv_m m on m.rn = g.first_rn
     where i.id = g.inv_id;
    with ins as (
      insert into cust.invoices (unit_id, document_no, document_date, invoice_type, due_date, status, is_current, import_batch_id)
      select g.unit_id, g.doc, (m.r ->> 'docDate')::date, coalesce(cust.fv_truthy(m.r -> 'invoiceType'), 'Payment Plan'),
             (m.r ->> 'dueDate')::date, m.r ->> 'status', true, v_batch
        from fv_g g join fv_m m on m.rn = g.first_rn where g.inv_id is null
      returning id, unit_id, document_no)
    update fv_g g set inv_id = ins.id from ins where ins.unit_id = g.unit_id and ins.document_no = g.doc and g.inv_id is null;
    delete from cust.invoice_items ii using fv_g g where ii.invoice_id = g.inv_id;
    insert into cust.invoice_items (invoice_id, schedule, revenue_head, amount, tax, net_amount, sort_order)
    select g.inv_id, m.r ->> 'schedule', m.r ->> 'revenueHead', (m.r ->> 'amount')::numeric, (m.r ->> 'tax')::numeric,
           (m.r ->> 'netAmount')::numeric, (row_number() over (partition by g.inv_id order by m.rn) - 1)::int
      from fv_g g join fv_m m on m.ok and m.unit_id = g.unit_id and m.r ->> 'docNo' = g.doc;
    update cust.invoices x set is_current = false
     where x.is_current and x.deleted_at is null
       and x.unit_id in (select u.id from cust.units u where u.deleted_at is null and u.project_id in (select distinct pid from fv_m where pid is not null))
       and x.document_date >= (select min((m.r ->> 'docDate')::date) from fv_m m)
       and not exists (select 1 from fv_m m where m.unit_id = x.unit_id and m.r ->> 'docNo' = x.document_no);

  elsif p_type = 'receipt_register' then
    drop table if exists fv_g;
    create temp table fv_g on commit drop as
      select m.unit_id, m.r ->> 'receiptNo' rno, min(m.rn) first_rn,
             sum(coalesce(nullif(m.r ->> 'totalAmount', '')::numeric, (m.r ->> 'amount')::numeric, 0)) total,
             null::bigint rid
        from fv_m m where m.ok group by 1, 2;
    update fv_g g set rid = x.id from cust.money_receipts x
     where x.unit_id = g.unit_id and x.receipt_no = g.rno and x.is_current and x.deleted_at is null;
    update cust.money_receipts x set
        receipt_date = (m.r ->> 'receiptDate')::date, payment_mode = m.r ->> 'mode', total_amount = g.total,
        instrument_no = m.r ->> 'instrumentNo', instrument_date = (m.r ->> 'instrumentDate')::date,
        drawn_on = m.r ->> 'drawnOn', drawn_on_branch = m.r ->> 'drawnOnBranch',
        deposit_bank = m.r ->> 'depositBank', narration = m.r ->> 'narration',
        is_reversed = upper(trim(coalesce(m.r ->> 'isReversed', ''))) = 'YES', unit_status_at_receipt = m.r ->> 'unitStatus',
        is_current = true, import_batch_id = v_batch
      from fv_g g join fv_m m on m.rn = g.first_rn
     where x.id = g.rid;
    with ins as (
      insert into cust.money_receipts (unit_id, receipt_no, receipt_date, payment_mode, total_amount, is_reversed,
                                       unit_status_at_receipt, is_current, import_batch_id,
                                       instrument_no, instrument_date, drawn_on, drawn_on_branch, deposit_bank, narration)
      select g.unit_id, g.rno, (m.r ->> 'receiptDate')::date, m.r ->> 'mode', g.total,
             upper(trim(coalesce(m.r ->> 'isReversed', ''))) = 'YES', m.r ->> 'unitStatus', true, v_batch,
             m.r ->> 'instrumentNo', (m.r ->> 'instrumentDate')::date, m.r ->> 'drawnOn', m.r ->> 'drawnOnBranch',
             m.r ->> 'depositBank', m.r ->> 'narration'
        from fv_g g join fv_m m on m.rn = g.first_rn where g.rid is null
      returning id, unit_id, receipt_no)
    update fv_g g set rid = ins.id from ins where ins.unit_id = g.unit_id and ins.receipt_no = g.rno and g.rid is null;
    delete from cust.receipt_items ri using fv_g g where ri.receipt_id = g.rid;
    insert into cust.receipt_items (receipt_id, against_demand_no, schedule, revenue_head, amount, sort_order)
    select g.rid, m.r ->> 'invoiceNo', m.r ->> 'schedule', m.r ->> 'revenueHead', (m.r ->> 'amount')::numeric,
           (row_number() over (partition by g.rid order by m.rn) - 1)::int
      from fv_g g join fv_m m on m.ok and m.unit_id = g.unit_id and m.r ->> 'receiptNo' = g.rno;
    update cust.money_receipts x set is_current = false
     where x.is_current and x.deleted_at is null
       and x.unit_id in (select u.id from cust.units u where u.deleted_at is null and u.project_id in (select distinct pid from fv_m where pid is not null))
       and x.receipt_date >= (select min((m.r ->> 'receiptDate')::date) from fv_m m)
       and not exists (select 1 from fv_m m where m.unit_id = x.unit_id and m.r ->> 'receiptNo' = x.receipt_no);

  elsif p_type = 'receipt_reversal' then
    update cust.receipt_reversals x set is_current = false
      from (select distinct unit_id, r ->> 'reversalNo' rno from fv_m where ok) g
     where x.unit_id = g.unit_id and x.receipt_reversal_no = g.rno and x.is_current;
    insert into cust.receipt_reversals (unit_id, receipt_reversal_no, receipt_reversal_date, receipt_no, receipt_date,
                                        instrument_no, instrument_date, reversal_amount, total_reversal_amount, narration,
                                        bank_description, reason, is_current, import_batch_id)
    select m.unit_id, m.r ->> 'reversalNo', (m.r ->> 'reversalDate')::date, m.r ->> 'receiptNo', (m.r ->> 'receiptDate')::date,
           m.r ->> 'instrumentNo', (m.r ->> 'instrumentDate')::date, (m.r ->> 'reversalAmount')::numeric,
           (m.r ->> 'totalReversalAmount')::numeric, m.r ->> 'narration', m.r ->> 'bankDescription', m.r ->> 'reason',
           true, v_batch
      from fv_m m where m.ok order by m.rn;

  elsif p_type = 'booking_register' then
    update cust.units u set status = x.new_status, updated_at = now()
      from (select distinct on (unit_id) unit_id, new_status from (
              select m.unit_id, m.rn,
                     case when m.r ->> 'status' = 'Cancel' then 'cancelled'
                          when m.r ->> 'status' = 'Active' and m.ustatus = 'cancelled' then 'booked' end new_status, m.ustatus
                from fv_m m where m.ok) y
             where new_status is not null and new_status is distinct from ustatus
             order by unit_id, rn desc) x
     where u.id = x.unit_id;

  elsif p_type = 'ptc_transfer' then
    drop table if exists fv_last;
    create temp table fv_last on commit drop as
      select distinct on (m.r ->> 'documentNo') m.* from fv_m m where m.ok order by m.r ->> 'documentNo', m.rn desc;
    update cust.ptc_transfers p set
        document_date = (l.r ->> 'documentDate')::date, amount = (l.r ->> 'amount')::numeric, narration = l.r ->> 'narration',
        source_booking_no = l.r ->> 'sourceBookingNo', source_unit_id = l.src_unit,
        transferee_booking_no = l.r ->> 'transfereeBookingNo', transferee_unit_id = l.trf_unit,
        is_reversed = coalesce((l.r ->> 'isReversed')::boolean, false), is_current = true, import_batch_id = v_batch
      from fv_last l where p.document_no = l.r ->> 'documentNo' and p.deleted_at is null;
    insert into cust.ptc_transfers (document_no, document_date, amount, narration, source_booking_no, source_unit_id,
                                    transferee_booking_no, transferee_unit_id, is_reversed, is_current, import_batch_id)
    select l.r ->> 'documentNo', (l.r ->> 'documentDate')::date, (l.r ->> 'amount')::numeric, l.r ->> 'narration',
           l.r ->> 'sourceBookingNo', l.src_unit, l.r ->> 'transfereeBookingNo', l.trf_unit,
           coalesce((l.r ->> 'isReversed')::boolean, false), true, v_batch
      from fv_last l
     where not exists (select 1 from cust.ptc_transfers p where p.document_no = l.r ->> 'documentNo' and p.deleted_at is null);

  else
    raise exception 'Unknown report type % for %', p_type, p_file;
  end if;

  return jsonb_build_object('type', p_type, 'file', p_file, 'queue_id', p_queue, 'batch_id', v_batch,
                            'parsed', v_parsed, 'matched', v_matched, 'unmatched', v_unmatched, 'skipped_cancelled', v_skipped, 'created_bookings', v_created,
                            'projects', to_jsonb(coalesce(v_projects, '{}')));
end $function$;
