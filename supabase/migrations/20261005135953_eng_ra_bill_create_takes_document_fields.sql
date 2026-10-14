/* ra_bill_create accepts the new document fields, and v_ra_bills serves them.

   Every new parameter is defaulted, so any existing call still works; the form is updated
   alongside to pass them. financial_year and due_date fall back to what bill_date implies rather
   than to null, because a bill with no year and no due date is one Accounts cannot age — and
   nobody notices a blank one until it is already overdue. */
create or replace function eng.ra_bill_create(
  p_wo bigint, p_entry_ids bigint[],
  p_bill_date date default current_date,
  p_period_from date default null, p_period_to date default null,
  p_contractor_ref text default null,
  p_other_deduction numeric default 0, p_other_note text default null,
  p_remarks text default null,
  p_invoice_date date default null, p_due_date date default null,
  p_billing_type text default null, p_parent_contractor text default null,
  p_financial_year text default null)
 returns bigint
 language plpgsql
 set search_path to ''
as $function$
declare w record; ids bigint[]; ok int; seq int; bid bigint; d date;
begin
  select wo_no, status, retention_pct, tds_pct, gst_pct into w from eng.work_orders where id = p_wo for update;
  if not found then raise exception 'Work order not found'; end if;
  if w.status <> 'Issued' then raise exception 'RA bills can only be raised on an issued work order'; end if;
  ids := (select array_agg(distinct x) from unnest(coalesce(p_entry_ids, '{}')) x);
  if ids is null then raise exception 'Select the verified work to bill'; end if;

  select count(*) into ok
  from eng.work_done wd join eng.wo_items wi on wi.id = wd.wo_item_id
  where wd.id = any (ids) and wi.wo_id = p_wo and wd.status = 'Verified' and wd.ra_bill_id is null;
  if ok <> cardinality(ids) then
    raise exception 'Only verified work of this work order that is not already billed can go on an RA bill';
  end if;

  if p_billing_type is not null and btrim(p_billing_type) <> ''
     and p_billing_type not in ('RA Bill','Sub-Bill','Final Bill','Advance') then
    raise exception 'Unknown billing type: %', p_billing_type;
  end if;

  d   := coalesce(p_bill_date, current_date);
  seq := eng.next_no('RA/' || p_wo);
  insert into eng.ra_bills (wo_id, ra_seq, bill_no, bill_date, period_from, period_to, contractor_ref,
                            retention_pct, tds_pct, gst_pct, other_deduction, other_deduction_note, remarks,
                            invoice_date, due_date, billing_type, parent_contractor, financial_year)
  values (p_wo, seq, w.wo_no || '/RA-' || lpad(seq::text, 2, '0'), d, p_period_from, p_period_to,
          nullif(btrim(coalesce(p_contractor_ref, '')), ''), w.retention_pct, w.tds_pct, w.gst_pct,
          coalesce(p_other_deduction, 0), nullif(btrim(coalesce(p_other_note, '')), ''), nullif(btrim(coalesce(p_remarks, '')), ''),
          p_invoice_date,
          coalesce(p_due_date, d),
          coalesce(nullif(btrim(coalesce(p_billing_type,'')),''), 'RA Bill'),
          nullif(btrim(coalesce(p_parent_contractor, '')), ''),
          coalesce(nullif(btrim(coalesce(p_financial_year,'')),''), eng.fy_of(d)))
  returning id into bid;

  update eng.work_done set ra_bill_id = bid where id = any (ids);
  return bid;
end $function$;

/* The view gains the five new columns plus the work order's own value, which the form shows
   beside the bill the way the old system did ("Work Order Amount").

   APPENDED to the existing definition rather than retyped. create-or-replace-view can only add
   columns at the end, and the first attempt at this hand-wrote the whole view from memory and got
   purchase.vendors wrong — it has legal_name / trade_name, not name. Editing the live definition
   keeps every join exactly as it is and changes only what is being added. */
do $do$
declare v_def text; v_new text; v_anchor text;
begin
  v_def := pg_get_viewdef('eng.v_ra_bills'::regclass, true);
  if position('rb.financial_year' in v_def) > 0 then return; end if;   -- already done

  v_anchor := ') AS sub_names' || chr(10) || '   FROM eng.ra_bills rb';
  if position(v_anchor in v_def) = 0 then
    raise exception 'v_ra_bills no longer ends the way this migration expects - not touching it';
  end if;

  v_new := replace(v_def, v_anchor,
    ') AS sub_names,' || chr(10) ||
    '    rb.financial_year,' || chr(10) ||
    '    rb.invoice_date,' || chr(10) ||
    '    rb.due_date,' || chr(10) ||
    '    rb.billing_type,' || chr(10) ||
    '    rb.parent_contractor,' || chr(10) ||
    '    ( SELECT vw.value FROM eng.v_work_orders vw WHERE vw.id = rb.wo_id) AS wo_value' || chr(10) ||
    '   FROM eng.ra_bills rb');

  execute 'create or replace view eng.v_ra_bills as ' || rtrim(v_new, ';' || chr(10) || ' ');
end $do$;

do $do$
begin
  if not exists(select 1 from information_schema.columns
                 where table_schema='eng' and table_name='v_ra_bills'
                   and column_name in ('financial_year','invoice_date','due_date','billing_type','parent_contractor','wo_value')
                 having count(*) = 6) then
    raise exception 'v_ra_bills did not gain all six columns';
  end if;
end $do$;
