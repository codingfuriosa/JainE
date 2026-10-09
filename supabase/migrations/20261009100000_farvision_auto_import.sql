-- AUTOMATIC FARVISION IMPORT (9 Oct 2026)
--
-- The daily import used to run in a staff member's browser, one REST call per row, only when someone
-- opened Customer Portal Admin and pressed "Import all". A missed day (7 Oct) left customers on old
-- figures, and a file that failed half way (6 Oct) left some flats updated and others not.
--
-- Now:
--   1. Gmail -> storage -> cust.import_queue                (unchanged, farvision-import edge function)
--   2. A GitHub Actions job reads each file with the SAME parsers the admin page uses (taken from
--      nexus-core.js at run time) and stages the rows here in cust.import_stage. Nothing customer
--      facing is touched by staging.
--   3. cust.fv_import_tick() (pg_cron, every 5 minutes) waits for the whole day's set, then
--      cust.fv_apply_run() applies every file in ONE transaction, in a fixed order, checks the result
--      and either keeps all of it or none of it.
--   4. Every outcome is emailed (workflow-mailer, type import_notice) and put in the bell.
--
-- Every Farvision report is a full running total, not a day's changes, so a failed or missed day
-- needs no replay: the next good day brings every flat up to date.
--
-- cust.import_config.mode: 'dry_run' applies inside a savepoint, compares the result with what is
-- already there (the manual import of the same files) and rolls back - nothing changes. 'live'
-- keeps the result. 'off' stops the job.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
create table if not exists cust.import_config (
  id int primary key default 1 check (id = 1),
  mode text not null default 'dry_run' check (mode in ('off', 'dry_run', 'live')),
  recipients text[] not null default '{}',
  alert_after time not null default '12:00',      -- IST: still incomplete -> alert once
  give_up_after time not null default '18:00',    -- IST: still not imported -> final alert
  quiet_minutes int not null default 10,          -- no new file for this long = the set has arrived
  max_attempts int not null default 3,
  mismatch_tolerance int not null default 5,      -- more flats off than before by this many -> hold
  shrink_tolerance numeric not null default 0.05, -- a report shorter than the last one by 5% -> hold
  updated_at timestamptz not null default now()
);
insert into cust.import_config (id, mode, recipients)
values (1, 'dry_run', array['businessanalyst@thejaingroup.com', 'system2.thejaingroup@gmail.com'])
on conflict (id) do nothing;

create table if not exists cust.import_runs (
  id bigserial primary key,
  run_date date not null unique,                  -- IST date
  status text not null default 'collecting'
    check (status in ('collecting', 'applying', 'applied', 'dry_run_ok', 'dry_run_diff', 'failed', 'needs_approval')),
  mode text,
  attempts int not null default 0,
  force boolean not null default false,           -- "Import anyway" - skips the hold checks once
  files_hash text,                                -- the staged set the last attempt used
  last_error text,
  summary jsonb not null default '{}',
  alerted_missing boolean not null default false,
  gave_up boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz
);

create table if not exists cust.import_stage (
  id bigserial primary key,
  run_id bigint not null references cust.import_runs (id) on delete cascade,
  queue_id bigint not null,
  file_name text not null,
  file_created_at timestamptz,
  report_type text,
  parse_error text,
  row_count int,
  chunk int not null default 0,
  chunks int not null default 1,
  rows jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (run_id, queue_id, chunk)
);

create table if not exists cust.import_notices (
  id bigserial primary key,
  run_id bigint references cust.import_runs (id) on delete set null,
  kind text not null,
  subject text not null,
  body text not null,
  recipients text[] not null,
  status text not null default 'queued',
  error text,
  created_at timestamptz not null default now()
);

alter table cust.import_config enable row level security;
alter table cust.import_runs enable row level security;
alter table cust.import_stage enable row level security;
alter table cust.import_notices enable row level security;
drop policy if exists import_config_staff_read on cust.import_config;
create policy import_config_staff_read on cust.import_config for select to authenticated using (app.is_custportal_staff());
drop policy if exists import_runs_staff_read on cust.import_runs;
create policy import_runs_staff_read on cust.import_runs for select to authenticated using (app.is_custportal_staff());
drop policy if exists import_notices_staff_read on cust.import_notices;
create policy import_notices_staff_read on cust.import_notices for select to authenticated using (app.is_custportal_staff());
-- import_stage holds whole reports (customer names, phones) - service role only.
revoke all on cust.import_stage from anon, authenticated;
grant select on cust.import_config, cust.import_runs, cust.import_notices to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Small helpers, written to behave exactly like the browser code they replace
-- ---------------------------------------------------------------------------------------------
-- JS: String(s||'').trim().toLowerCase()
create or replace function cust.fv_norm(p text) returns text language sql immutable as $$
  select lower(btrim(coalesce(p, ''), ' ' || chr(9) || chr(10) || chr(13) || chr(160)))
$$;

-- JS: value || null  (0, '', false and null all become null)
create or replace function cust.fv_truthy(v jsonb) returns text language sql immutable as $$
  select case
    when v is null or jsonb_typeof(v) = 'null' then null
    when jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric = 0 then null
    when jsonb_typeof(v) = 'string' and v #>> '{}' = '' then null
    when jsonb_typeof(v) = 'boolean' and not (v #>> '{}')::boolean then null
    else v #>> '{}' end
$$;

create or replace function cust.fv_label(p text) returns text language sql immutable as $$
  select case p when 'sales_details' then 'Sales Details' when 'booking_register' then 'Booking Register'
    when 'invoice_register' then 'Invoice Register' when 'receipt_register' then 'Receipt Register'
    when 'receipt_reversal' then 'Receipt Reversal' when 'ptc_transfer' then 'Payment To Customer'
    when 'outstanding' then 'Customer Outstanding' else p end
$$;

-- cpaResolveProject: Farvision's own Business Unit code first, then the display name.
create or replace function cust.fv_project(p_bu text) returns bigint language sql stable as $$
  select coalesce(
    (select p.id from cust.projects p
      where p.deleted_at is null and p.farvision_project_code is not null
        and cust.fv_norm(p.farvision_project_code) = cust.fv_norm(p_bu)
      order by p.name limit 1),
    (select p.id from cust.projects p
      where p.deleted_at is null and cust.fv_norm(p.name) = cust.fv_norm(p_bu)
      order by p.name limit 1))
  where coalesce(p_bu, '') <> ''
$$;

create or replace function cust.fv_flat(p_pid bigint, p_tower text, p_unit_code text)
returns bigint language sql stable as $$
  select u.id from cust.units u
   where p_pid is not null and coalesce(p_unit_code, '') <> ''
     and u.deleted_at is null and u.project_id = p_pid
     and cust.fv_norm(u.tower) = cust.fv_norm(p_tower)
     and cust.fv_norm(u.unit_code) = cust.fv_norm(p_unit_code)
   order by u.id desc limit 1
$$;

-- cpaResolveUnit: a record with a Booking No resolves by it or not at all; only a record without
-- one falls back to (project, tower, unit code).
create or replace function cust.fv_unit(p_pid bigint, p_booking text, p_tower text, p_unit_code text)
returns bigint language sql stable as $$
  select case
    when coalesce(p_booking, '') <> '' then
      (select u.id from cust.units u where u.deleted_at is null and u.booking_no = p_booking order by u.id desc limit 1)
    else cust.fv_flat(p_pid, p_tower, p_unit_code) end
$$;


-- ---------------------------------------------------------------------------------------------
-- Checks: the same figures that were checked by hand on 8 Oct
-- ---------------------------------------------------------------------------------------------
-- Live flats whose Ledger (receipts against live demands + transfers in - transfers out - cheque
-- returns) does not equal Farvision's own received + on-account figure from the cost sheet.
create or replace function cust.fv_ledger_mismatches()
returns table (unit_id bigint, diff numeric) language sql stable as $$
  with u as (select id from cust.units where deleted_at is null and coalesce(status, '') <> 'cancelled'),
  live as (select i.unit_id, i.document_no from cust.invoices i where i.is_current and i.status is distinct from 'Cancel'),
  rcred as (
    select m.unit_id,
      case when exists (select 1 from cust.receipt_items ri where ri.receipt_id = m.id)
        then (select coalesce(sum(ri.amount), 0) from cust.receipt_items ri
               where ri.receipt_id = m.id
                 and (ri.against_demand_no is null
                      or exists (select 1 from live l where l.unit_id = m.unit_id and l.document_no = ri.against_demand_no)))
        else m.total_amount end amt
    from cust.money_receipts m where m.is_current),
  rc as (select unit_id, sum(amt) cr from rcred group by 1),
  rv as (select unit_id, sum(reversal_amount) rev from cust.receipt_reversals where is_current group by 1),
  pin as (select transferee_unit_id unit_id, sum(amount) a from cust.ptc_transfers where not is_reversed and deleted_at is null group by 1),
  pout as (select source_unit_id unit_id, sum(amount) a from cust.ptc_transfers where not is_reversed and deleted_at is null group by 1),
  cs as (select unit_id, sum(received_amount) recd, sum(onaccount_amount) onacc from cust.cost_sheet_items where is_current group by 1),
  x as (
    select u.id, round(coalesce(rc.cr, 0) - coalesce(rv.rev, 0) + coalesce(pin.a, 0) - coalesce(pout.a, 0)
                       - coalesce(cs.recd, 0) - coalesce(cs.onacc, 0)) d
    from u left join rc on rc.unit_id = u.id left join rv on rv.unit_id = u.id
           left join pin on pin.unit_id = u.id left join pout on pout.unit_id = u.id left join cs on cs.unit_id = u.id)
  select id, d from x where abs(d) > 1
$$;

create or replace function cust.fv_health() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'live_units', (select count(*) from cust.units where deleted_at is null and coalesce(status, '') <> 'cancelled'),
    'no_cost_sheet', (select count(*) from cust.units u
                       where u.deleted_at is null and coalesce(u.status, '') <> 'cancelled'
                         and not exists (select 1 from cust.cost_sheet_items c where c.unit_id = u.id and c.is_current and c.deleted_at is null)),
    'ledger_mismatch', (select count(*) from cust.fv_ledger_mismatches()),
    'outstanding_rows', (select count(*) from cust.outstanding_snapshot where is_current and deleted_at is null))
$$;

-- One hash per flat per kind of data, for the dry-run comparison. Ids, batch ids and timestamps are
-- left out: two imports of the same file must hash the same.
-- Amounts compared to the paisa: 60010 and 60010.00 are the same amount.
create or replace function cust.fv_n(p numeric) returns text language sql immutable as $$ select round(p, 2)::text $$;

create or replace function cust.fv_fingerprint()
returns table (unit_id bigint, part text, h text) language sql stable as $$
  select u.id, 'flat', md5(concat_ws('|', u.project_id, u.unit_code, u.tower, u.floor_no, u.unit_type, cust.fv_n(u.carpet_area_sqft),
           cust.fv_n(u.super_built_up_area_sqft), cust.fv_n(u.built_up_area_sqft), cust.fv_n(u.agreement_value), u.booking_no, u.application_no, u.status,
           c.email, c.full_name, c.phone))
    from cust.units u left join cust.customers c on c.id = u.customer_id where u.deleted_at is null
  union all
  select cs.unit_id, 'cost_sheet', md5(string_agg(concat_ws('|', component, cust.fv_n(amount), cust.fv_n(tax_amount), cust.fv_n(bill_amount), cust.fv_n(received_amount),
           cust.fv_n(balance_amount), cust.fv_n(onaccount_amount), sort_order), ';' order by sort_order, component))
    from cust.cost_sheet_items cs where is_current and deleted_at is null group by cs.unit_id
  union all
  select fc.unit_id, 'contact', md5(string_agg(concat_ws('|', unit_code, booking_no, contact_name, contact_phone, contact_email,
           contact_address, booking_date, agreement_date), ';' order by id))
    from cust.farvision_contacts fc where is_current and deleted_at is null group by fc.unit_id
  union all
  select os.unit_id, 'outstanding', md5(string_agg(concat_ws('|', cust.fv_n(total_consideration), cust.fv_n(bill_outstanding), cust.fv_n(on_account),
           cust.fv_n(net_outstanding), cust.fv_n(late_fee_accrued), no_of_bills), ';' order by id))
    from cust.outstanding_snapshot os where is_current and deleted_at is null group by os.unit_id
  union all
  select i.unit_id, 'invoices', md5(string_agg(concat_ws('|', i.document_no, i.document_date, i.invoice_type, i.due_date,
           i.gstin, i.status,
           (select string_agg(concat_ws('/', ii.schedule, ii.revenue_head, cust.fv_n(ii.amount), cust.fv_n(ii.tax), cust.fv_n(ii.net_amount), ii.sort_order), ','
                              order by ii.sort_order, ii.id) from cust.invoice_items ii where ii.invoice_id = i.id)),
           ';' order by i.document_no))
    from cust.invoices i where i.is_current and i.deleted_at is null group by i.unit_id
  union all
  select m.unit_id, 'receipts', md5(string_agg(concat_ws('|', m.receipt_no, m.receipt_date, m.payment_mode, cust.fv_n(m.total_amount),
           m.is_reversed, m.unit_status_at_receipt,
           (select string_agg(concat_ws('/', ri.against_demand_no, ri.schedule, ri.revenue_head, cust.fv_n(ri.amount), ri.sort_order), ','
                              order by ri.sort_order, ri.id) from cust.receipt_items ri where ri.receipt_id = m.id)),
           ';' order by m.receipt_no))
    from cust.money_receipts m where m.is_current and m.deleted_at is null group by m.unit_id
  union all
  select r.unit_id, 'reversals', md5(string_agg(concat_ws('|', receipt_reversal_no, receipt_reversal_date, receipt_no,
           receipt_date, instrument_no, instrument_date, cust.fv_n(reversal_amount), cust.fv_n(total_reversal_amount), narration,
           bank_description, reason), ';' order by receipt_reversal_no, reversal_amount, id))
    from cust.receipt_reversals r where is_current and deleted_at is null group by r.unit_id
  union all
  select coalesce(p.source_unit_id, p.transferee_unit_id), 'transfers', md5(string_agg(concat_ws('|', document_no, document_date,
           cust.fv_n(amount), narration, source_booking_no, source_unit_id, transferee_booking_no, transferee_unit_id, is_reversed),
           ';' order by document_no))
    from cust.ptc_transfers p where deleted_at is null group by coalesce(p.source_unit_id, p.transferee_unit_id)
$$;

-- What the staged set looks like; a change means new files arrived since the last attempt.
create or replace function cust.fv_stage_hash(p_run bigint) returns text language sql stable as $$
  select md5(coalesce(string_agg(queue_id || ':' || n || ':' || coalesce(report_type, '') || ':' || coalesce(parse_error, ''),
                                 ',' order by queue_id), ''))
    from (select queue_id, count(*) n, max(report_type) report_type, max(parse_error) parse_error
            from cust.import_stage where run_id = p_run group by queue_id) s
$$;

-- ---------------------------------------------------------------------------------------------
-- One file. A port of cpaQueueImport's matching + cpaImportConfirmXlsx, set-based where the browser
-- went row by row. Raises on anything the browser would have failed on; the caller rolls back.
-- ---------------------------------------------------------------------------------------------
create or replace function cust.fv_apply_file(p_run bigint, p_queue bigint, p_type text, p_file text)
returns jsonb language plpgsql security definer set search_path = cust, public as $$
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

  -- ================================ Sales Details ================================
  if p_type = 'sales_details' then
    select count(*) filter (where pm.pid is not null), count(*) filter (where pm.pid is null)
      into v_matched, v_unmatched
      from fv_rows f left join fv_pm pm on pm.bu = f.r ->> 'businessUnit';
    if v_matched = 0 then
      -- Farvision sends one empty Sales Details every day; an empty file changes nothing.
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
      -- cpaSdCustomerGuard: an existing flat never loses its customer to a blank or edited email.
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

      -- A rebooked flat must still find its existing row: by booking, else by the flat itself.
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

  -- ================================ every other report ================================
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
  -- A cancelled booking keeps its unit for audit but takes no new financial rows; the Booking
  -- Register is exempt - cancelling is its job.
  update fv_m set ok = case
      when pid is null then false
      when p_type = 'ptc_transfer' then (src_unit is not null or trf_unit is not null)
      when unit_id is null then false
      when ustatus = 'cancelled' and p_type <> 'booking_register' then null   -- skipped, neither matched nor unmatched
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
    -- The last row for a flat wins, as it did row by row.
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
    -- Farvision leaves a flat out once nothing is outstanding: every flat of a project this file
    -- covers that is not in it loses its snapshot (the portal then reads the cost sheet).
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
        is_reversed = coalesce(m.r ->> 'isReversed', '') = 'Yes', unit_status_at_receipt = m.r ->> 'unitStatus',
        is_current = true, import_batch_id = v_batch
      from fv_g g join fv_m m on m.rn = g.first_rn
     where x.id = g.rid;
    with ins as (
      insert into cust.money_receipts (unit_id, receipt_no, receipt_date, payment_mode, total_amount, is_reversed,
                                       unit_status_at_receipt, is_current, import_batch_id)
      select g.unit_id, g.rno, (m.r ->> 'receiptDate')::date, m.r ->> 'mode', g.total,
             coalesce(m.r ->> 'isReversed', '') = 'Yes', m.r ->> 'unitStatus', true, v_batch
        from fv_g g join fv_m m on m.rn = g.first_rn where g.rid is null
      returning id, unit_id, receipt_no)
    update fv_g g set rid = ins.id from ins where ins.unit_id = g.unit_id and ins.receipt_no = g.rno and g.rid is null;
    delete from cust.receipt_items ri using fv_g g where ri.receipt_id = g.rid;
    insert into cust.receipt_items (receipt_id, against_demand_no, schedule, revenue_head, amount, sort_order)
    select g.rid, m.r ->> 'invoiceNo', m.r ->> 'schedule', m.r ->> 'revenueHead', (m.r ->> 'amount')::numeric,
           (row_number() over (partition by g.rid order by m.rn) - 1)::int
      from fv_g g join fv_m m on m.ok and m.unit_id = g.unit_id and m.r ->> 'receiptNo' = g.rno;

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
    -- Only Cancel cancels, and Active brings back a flat wrongly left cancelled. Status as it stood
    -- before this file, as the browser read it.
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
                            'parsed', v_parsed, 'matched', v_matched, 'unmatched', v_unmatched, 'skipped_cancelled', v_skipped,
                            'projects', to_jsonb(coalesce(v_projects, '{}')));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Notices: email (workflow-mailer reads the row by id) + bell
-- ---------------------------------------------------------------------------------------------
create or replace function cust.fv_notify(p_run bigint, p_kind text, p_subject text, p_body text)
returns bigint language plpgsql security definer set search_path = cust, public as $$
declare
  v_id bigint;
  v_to text[];
  v_who text;
begin
  select recipients into v_to from cust.import_config where id = 1;
  insert into cust.import_notices (run_id, kind, subject, body, recipients)
  values (p_run, p_kind, p_subject, p_body, coalesce(v_to, '{}')) returning id into v_id;
  foreach v_who in array coalesce(v_to, '{}') loop
    insert into acc.notifications (recipient, kind, title, body, urgent)
    values (v_who, 'farvision_import', p_subject, left(p_body, 900), p_kind <> 'success');
  end loop;
  begin
    perform net.http_post(
      url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/workflow-mailer',
      headers := '{"Content-Type":"application/json","apikey":"sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n"}'::jsonb,
      body := jsonb_build_object('type', 'import_notice', 'id', v_id),
      timeout_milliseconds := 20000);
  exception when others then
    update cust.import_notices set status = 'failed', error = sqlerrm where id = v_id;
  end;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- The whole day, all or nothing
-- ---------------------------------------------------------------------------------------------
create or replace function cust.fv_apply_run(p_run bigint)
returns jsonb language plpgsql security definer set search_path = cust, public
set statement_timeout = '20min' as $$
declare
  cfg cust.import_config;
  run cust.import_runs;
  v_live boolean;
  v_hash text;
  f record;
  v_results jsonb := '[]';
  v_res jsonb;
  v_before jsonb;
  v_after jsonb;
  v_problems text[] := '{}';
  v_diff jsonb;
  v_err text;
  v_detail text;
  v_status text;
  v_summary jsonb;
  v_prev int;
  v_sd_missing text[];
  v_mis jsonb;
  v_files int;
  v_line text;
  v_bad text[];
  v_flags jsonb;
begin
  select * into cfg from cust.import_config where id = 1;
  select * into run from cust.import_runs where id = p_run for update;
  v_live := cfg.mode = 'live';
  v_hash := cust.fv_stage_hash(p_run);

  -- Which files: the newest complete, readable copy of each single report, and every distinct
  -- Sales Details. Order: Sales Details (flats, customers, cost sheets) first so a rebooked flat has
  -- its new booking number, then the Booking Register (cancellations), then the money.
  drop table if exists fv_files;
  create temp table fv_files on commit drop as
  with st as (
    select queue_id, max(file_name) file_name, max(report_type) report_type, max(file_created_at) file_created_at,
           max(parse_error) parse_error, max(row_count) row_count, count(*) n, max(chunks) chunks
      from cust.import_stage where run_id = p_run group by queue_id),
  ok as (select * from st where n = chunks and parse_error is null and report_type is not null),
  single as (select distinct on (report_type) * from ok where report_type <> 'sales_details'
              order by report_type, file_created_at desc, queue_id desc),
  sd as (select distinct on (file_name) * from ok where report_type = 'sales_details'
          order by file_name, file_created_at desc, queue_id desc)
  select x.*, case x.report_type when 'sales_details' then 1 when 'booking_register' then 2 when 'invoice_register' then 3
                when 'receipt_register' then 4 when 'receipt_reversal' then 5 when 'ptc_transfer' then 6
                when 'outstanding' then 7 end ord
    from (select * from single union all select * from sd) x;
  select count(*) into v_files from fv_files;

  -- A report much shorter than the last one imported is a cut-short export, not a quiet day.
  for f in select * from fv_files where report_type <> 'sales_details' loop
    v_prev := null;
    select b.row_count into v_prev from cust.import_batches b
     where b.import_type = f.report_type and b.status = 'completed' and b.row_count > 0
     order by b.imported_at desc limit 1;
    if v_prev is not null and f.row_count < v_prev * (1 - cfg.shrink_tolerance) then
      v_problems := v_problems || format('%s has %s rows; the last one imported had %s - the export looks cut short.',
                                         f.file_name, f.row_count, v_prev);
    end if;
  end loop;

  update cust.import_runs set attempts = attempts + 1, mode = cfg.mode, files_hash = v_hash, updated_at = now()
   where id = p_run;

  begin
    if not v_live then
      drop table if exists fv_fp_before;
      create temp table fv_fp_before on commit drop as select * from cust.fv_fingerprint();
    end if;
    v_before := cust.fv_health();

    for f in select * from fv_files order by ord, file_created_at, queue_id loop
      v_res := cust.fv_apply_file(p_run, f.queue_id, f.report_type, f.file_name);
      v_results := v_results || jsonb_build_array(v_res);
    end loop;

    v_after := cust.fv_health();
    if (v_after ->> 'ledger_mismatch')::int - (v_before ->> 'ledger_mismatch')::int > cfg.mismatch_tolerance then
      v_problems := v_problems || format('Flats whose Ledger does not match Farvision would go from %s to %s.',
                                         v_before ->> 'ledger_mismatch', v_after ->> 'ledger_mismatch');
    end if;
    if (v_after ->> 'no_cost_sheet')::int > (v_before ->> 'no_cost_sheet')::int then
      v_problems := v_problems || format('Flats with no cost sheet would go from %s to %s.',
                                         v_before ->> 'no_cost_sheet', v_after ->> 'no_cost_sheet');
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('project', p.name, 'tower', u.tower, 'unit', u.unit_code, 'diff', m.diff)
                              order by p.name, u.tower, u.unit_code), '[]')
      into v_mis
      from cust.fv_ledger_mismatches() m join cust.units u on u.id = m.unit_id join cust.projects p on p.id = u.project_id;

    if cardinality(v_problems) > 0 and not run.force then
      raise exception 'HOLD';
    end if;

    if v_live then
      update cust.import_queue q set status = 'completed', processed_at = now(), error_message = null,
             import_batch_id = (select (e ->> 'batch_id')::bigint from jsonb_array_elements(v_results) e
                                 where (e ->> 'queue_id')::bigint = q.id limit 1)
       where q.id in (select queue_id from fv_files);
    else
      select coalesce(jsonb_agg(jsonb_build_object('project', p.name, 'tower', u.tower, 'unit', u.unit_code, 'part', d.part)
                                order by p.name, u.tower, u.unit_code, d.part), '[]')
        into v_diff
        from (select coalesce(a.unit_id, b.unit_id) unit_id, coalesce(a.part, b.part) part
                from fv_fp_before b full join cust.fv_fingerprint() a on a.unit_id = b.unit_id and a.part = b.part
               where a.h is distinct from b.h) d
        left join cust.units u on u.id = d.unit_id left join cust.projects p on p.id = u.project_id;
      raise exception 'DRYRUN';
    end if;
  exception when others then
    get stacked diagnostics v_detail = pg_exception_context;
    v_err := sqlerrm;
  end;

  v_status := case
    when v_err is null then 'applied'
    when v_err = 'DRYRUN' then case when jsonb_array_length(coalesce(v_diff, '[]')) = 0 then 'dry_run_ok' else 'dry_run_diff' end
    when v_err = 'HOLD' then 'needs_approval'
    else 'failed' end;

  -- Projects with flats that got no Sales Details today keep their last cost sheet.
  select array_agg(distinct p.name order by p.name) into v_sd_missing
    from cust.units u join cust.projects p on p.id = u.project_id
   where u.deleted_at is null and coalesce(u.status, '') <> 'cancelled'
     and not exists (select 1 from jsonb_array_elements(v_results) e, jsonb_array_elements_text(coalesce(e -> 'projects', '[]')) pn
                      where e ->> 'type' = 'sales_details' and pn = p.name);

  select array_agg(file_name || ' (' || parse_error || ')' order by file_name) into v_bad
    from (select distinct queue_id, file_name, parse_error from cust.import_stage
           where run_id = p_run and parse_error is not null) b;
  select coalesce(jsonb_agg(fl), '[]') into v_flags
    from jsonb_array_elements(v_results) e, jsonb_array_elements(coalesce(e -> 'email_flags', '[]')) fl;

  v_summary := jsonb_build_object(
    'unreadable', to_jsonb(coalesce(v_bad, '{}')), 'email_flags', v_flags,
    'mode', cfg.mode, 'files', v_results, 'file_count', v_files, 'before', v_before, 'after', v_after,
    'problems', to_jsonb(v_problems), 'mismatched_flats', coalesce(v_mis, '[]'),
    'sales_details_missing', to_jsonb(coalesce(v_sd_missing, '{}')),
    'diff', coalesce(v_diff, '[]'), 'diff_count', jsonb_array_length(coalesce(v_diff, '[]')),
    'error', case when v_status = 'failed' then v_err end,
    'error_context', case when v_status = 'failed' then left(v_detail, 1500) end);

  update cust.import_runs set status = v_status, summary = v_summary, updated_at = now(),
         last_error = case when v_status in ('failed', 'needs_approval') then coalesce(nullif(array_to_string(v_problems, ' '), ''), v_err) end,
         applied_at = case when v_status = 'applied' then now() else applied_at end,
         force = case when v_status = 'applied' then false else force end
   where id = p_run;

  if v_live then
    if v_status = 'applied' then
      v_line := format('%s files imported. %s of %s flats match Farvision.',
                       v_files, (v_after ->> 'live_units')::int - (v_after ->> 'ledger_mismatch')::int, v_after ->> 'live_units');
      if cardinality(coalesce(v_sd_missing, '{}')) > 0 then
        v_line := v_line || E'\nNo Sales Details today for: ' || array_to_string(v_sd_missing, ', ')
                         || ' - their cost sheets stay as last imported.';
      end if;
      if jsonb_array_length(v_flags) > 0 then
        v_line := v_line || E'\n' || jsonb_array_length(v_flags) || ' flat(s) kept with their current customer because the email changed in Farvision: '
          || (select string_agg((fl ->> 'name') || ' (' || (fl ->> 'booking') || '): portal ' || (fl ->> 'portal') || ' -> Farvision ' || (fl ->> 'farvision'), '; ')
                from jsonb_array_elements(v_flags) fl)
          || '. If the new email is right, update the customer in Customer Portal Admin.';
      end if;
      if v_bad is not null then
        v_line := v_line || E'\nSkipped (could not be read; an older copy was used if there was one): ' || array_to_string(v_bad, '; ');
      end if;
      if run.force then v_line := v_line || E'\nImported with "Import anyway".'; end if;
      perform cust.fv_notify(p_run, 'success', 'Farvision import done - ' || to_char(run.run_date, 'DD Mon YYYY'), v_line);
    elsif v_status = 'needs_approval' then
      perform cust.fv_notify(p_run, 'hold', 'Farvision import held - ' || to_char(run.run_date, 'DD Mon YYYY'),
        'Nothing was changed; customers still see the last good import.' || E'\n' || array_to_string(v_problems, E'\n')
        || E'\nIf this is a genuine change, open Customer Portal Admin > Import and press "Import anyway".');
    elsif v_status = 'failed' then
      perform cust.fv_notify(p_run, 'failed', 'Farvision import failed - ' || to_char(run.run_date, 'DD Mon YYYY'),
        'Nothing was changed; customers still see the last good import.' || E'\nReason: ' || v_err
        || case when run.attempts + 1 < cfg.max_attempts then E'\nIt will be tried again automatically.'
                else E'\nNo more automatic tries today. Fix the file in Farvision and resend it, or press "Retry".' end);
    end if;
  end if;

  return v_summary;
end $$;

-- ---------------------------------------------------------------------------------------------
-- The clock: every 5 minutes, decide whether today's set is complete and apply it
-- ---------------------------------------------------------------------------------------------
create or replace function cust.fv_import_tick() returns text
language plpgsql security definer set search_path = cust, public as $$
declare
  cfg cust.import_config;
  run cust.import_runs;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_now time := (now() at time zone 'Asia/Kolkata')::time;
  v_q int;
  v_open int;
  v_last timestamptz;
  v_unread text[];
  v_types text[];
  v_missing text[];
  v_hash text;
  v_ready boolean;
  v_bad text[];
begin
  select * into cfg from cust.import_config where id = 1;
  if cfg.mode = 'off' then return 'off'; end if;
  insert into cust.import_runs (run_date) values (v_today) on conflict (run_date) do nothing;
  select * into run from cust.import_runs where run_date = v_today for update skip locked;
  if not found then return 'busy'; end if;

  -- Today's files, one per file name (Farvision sometimes delivers the same file twice).
  drop table if exists fv_q;
  create temp table fv_q on commit drop as
    select distinct on (file_name) id, file_name, created_at, status from cust.import_queue
     where (created_at at time zone 'Asia/Kolkata')::date = v_today
     order by file_name, id desc;
  select count(*), count(*) filter (where status in ('pending', 'processing')), max(created_at)
    into v_q, v_open, v_last from fv_q;
  select array_agg(q.file_name order by q.file_name) into v_unread from fv_q q
   where not exists (select 1 from cust.import_stage s where s.run_id = run.id and s.queue_id = q.id
                     group by s.queue_id having count(*) = max(s.chunks));
  select array_agg(distinct report_type) into v_types from cust.import_stage
   where run_id = run.id and parse_error is null and report_type is not null;
  select array_agg(file_name || ' (' || parse_error || ')' order by file_name) into v_bad
    from (select distinct queue_id, file_name, parse_error from cust.import_stage
           where run_id = run.id and parse_error is not null) b;
  select array_agg(cust.fv_label(t)) into v_missing
    from unnest(array['sales_details', 'booking_register', 'invoice_register', 'receipt_register',
                      'receipt_reversal', 'ptc_transfer', 'outstanding']) t
   where not (t = any (coalesce(v_types, '{}')));
  update cust.import_runs set summary = summary || jsonb_build_object('waiting', jsonb_build_object(
           'checked_at', now(), 'files_today', v_q, 'not_read', to_jsonb(coalesce(v_unread, '{}')),
           'missing', to_jsonb(coalesce(v_missing, '{}')), 'unreadable', to_jsonb(coalesce(v_bad, '{}'))))
   where id = run.id and status not in ('applied', 'dry_run_ok', 'dry_run_diff');
  v_hash := cust.fv_stage_hash(run.id);

  v_ready := v_q > 0 and v_unread is null and v_missing is null
             and now() - v_last >= make_interval(mins => cfg.quiet_minutes);
  -- Dry run compares with the manual import, so it waits until that has been done.
  if cfg.mode = 'dry_run' then v_ready := v_ready and (v_open = 0 or v_now >= cfg.give_up_after); end if;

  if v_ready then
    if run.files_hash is distinct from v_hash then
      update cust.import_runs set attempts = 0 where id = run.id;   -- new files: a fresh set of tries
      run.attempts := 0;
    elsif run.status in ('applied', 'dry_run_ok', 'dry_run_diff') then
      return 'done';
    elsif run.status = 'needs_approval' and not run.force then
      return 'held';
    elsif run.status = 'failed' and run.attempts >= cfg.max_attempts then
      return 'gave up';
    end if;
    perform cust.fv_apply_run(run.id);
    return 'applied';
  end if;

  if cfg.mode = 'live' and run.status <> 'applied' then
    if v_now >= cfg.alert_after and not run.alerted_missing then
      perform cust.fv_notify(run.id, 'missing', 'Farvision files missing - ' || to_char(v_today, 'DD Mon YYYY'),
        'Today''s import has not run yet; customers still see the last good import.'
        || case when v_q = 0 then E'\nNo Farvision email has arrived today.' else '' end
        || case when v_missing is not null then E'\nNot received: ' || array_to_string(v_missing, ', ') else '' end
        || case when v_unread is not null then E'\nReceived but not read yet (the automatic reader has not run): '
                                               || array_to_string(v_unread, ', ') else '' end
        || case when v_bad is not null then E'\nCould not be read: ' || array_to_string(v_bad, '; ') else '' end
        || E'\nIt keeps checking until ' || to_char(cfg.give_up_after, 'HH24:MI') || '.');
      update cust.import_runs set alerted_missing = true where id = run.id;
    end if;
    if v_now >= cfg.give_up_after and not run.gave_up then
      perform cust.fv_notify(run.id, 'not_imported', 'Farvision not imported today - ' || to_char(v_today, 'DD Mon YYYY'),
        'The day''s files were not all received by ' || to_char(cfg.give_up_after, 'HH24:MI')
        || ', so nothing was imported. Tomorrow''s files will bring every flat up to date.'
        || case when v_missing is not null then E'\nNot received: ' || array_to_string(v_missing, ', ') else '' end);
      update cust.import_runs set gave_up = true where id = run.id;
    end if;
  end if;
  return 'waiting';
end $$;

-- ---------------------------------------------------------------------------------------------
-- Called by the farvision-import edge function (service role) for the GitHub job
-- ---------------------------------------------------------------------------------------------
create or replace function cust.fv_auto_files() returns jsonb
language plpgsql security definer set search_path = cust, public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_run bigint;
  v_mode text;
begin
  select mode into v_mode from cust.import_config where id = 1;
  insert into cust.import_runs (run_date) values (v_today) on conflict (run_date) do nothing;
  select id into v_run from cust.import_runs where run_date = v_today;
  return jsonb_build_object('run_id', v_run, 'mode', v_mode, 'files', coalesce((
    select jsonb_agg(jsonb_build_object('queue_id', q.id, 'file_name', q.file_name, 'storage_path', q.storage_path,
                                        'created_at', q.created_at,
                                        'staged', exists (select 1 from cust.import_stage s where s.run_id = v_run and s.queue_id = q.id
                                                          group by s.queue_id having count(*) = max(s.chunks)))
                     order by q.id)
      from (select distinct on (file_name) * from cust.import_queue
             where (created_at at time zone 'Asia/Kolkata')::date = v_today
             order by file_name, id desc) q), '[]'));
end $$;

create or replace function cust.fv_auto_stage(p_run bigint, p_queue bigint, p_file text, p_created timestamptz,
                                              p_type text, p_rows_total int, p_chunk int, p_chunks int,
                                              p_rows jsonb, p_parse_error text)
returns void language plpgsql security definer set search_path = cust, public as $$
begin
  if p_chunk = 0 then
    delete from cust.import_stage where run_id = p_run and queue_id = p_queue;
  end if;
  insert into cust.import_stage (run_id, queue_id, file_name, file_created_at, report_type, parse_error, row_count,
                                 chunk, chunks, rows)
  values (p_run, p_queue, p_file, p_created, p_type, p_parse_error, p_rows_total, p_chunk, p_chunks, coalesce(p_rows, '[]'))
  on conflict (run_id, queue_id, chunk) do update
    set rows = excluded.rows, report_type = excluded.report_type, parse_error = excluded.parse_error,
        row_count = excluded.row_count, chunks = excluded.chunks, created_at = now();
end $$;

-- Staff: Retry / Import anyway from the Import page
create or replace function cust.fv_run_action(p_run bigint, p_action text) returns void
language plpgsql security definer set search_path = cust, public as $$
begin
  if not app.is_custportal_staff() then raise exception 'not allowed'; end if;
  if p_action = 'retry' then
    update cust.import_runs set attempts = 0, status = 'collecting', files_hash = null, updated_at = now() where id = p_run;
  elsif p_action = 'force' then
    update cust.import_runs set force = true, status = 'collecting', attempts = 0, files_hash = null, updated_at = now() where id = p_run;
  else
    raise exception 'unknown action %', p_action;
  end if;
end $$;

revoke all on function cust.fv_apply_file(bigint, bigint, text, text) from public, anon, authenticated;
revoke all on function cust.fv_apply_run(bigint) from public, anon, authenticated;
revoke all on function cust.fv_import_tick() from public, anon, authenticated;
revoke all on function cust.fv_notify(bigint, text, text, text) from public, anon, authenticated;
revoke all on function cust.fv_auto_files() from public, anon, authenticated;
revoke all on function cust.fv_auto_stage(bigint, bigint, text, timestamptz, text, int, int, int, jsonb, text) from public, anon, authenticated;
grant execute on function cust.fv_auto_files() to service_role;
grant execute on function cust.fv_auto_stage(bigint, bigint, text, timestamptz, text, int, int, int, jsonb, text) to service_role;
revoke all on function cust.fv_run_action(bigint, text) from public, anon;
grant execute on function cust.fv_run_action(bigint, text) to authenticated;

-- Staged rows are only needed for a couple of weeks (whole reports, so they are large).
create or replace function cust.fv_stage_cleanup() returns void language sql security definer set search_path = cust, public as $$
  delete from cust.import_stage s using cust.import_runs r
   where s.run_id = r.id and r.run_date < (now() at time zone 'Asia/Kolkata')::date - 14;
$$;
revoke all on function cust.fv_stage_cleanup() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('farvision-auto-import', 'farvision-stage-cleanup');
-- 09:30 - 19:25 IST
select cron.schedule('farvision-auto-import', '*/5 4-13 * * *', $$ select cust.fv_import_tick(); $$);
select cron.schedule('farvision-stage-cleanup', '15 20 * * *', $$ select cust.fv_stage_cleanup(); $$);
