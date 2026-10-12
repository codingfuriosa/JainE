-- Purchase & Stores, Stage 5 (part 1): counter offers and bid history. See docs/purchase-stores-spec.md section 5.
--
-- From the quotation comparison Purchase can send a COUNTER OFFER to the vendors it chooses (an optional target
-- rate per item and a note). The vendor revises through the same personal link; every quotation revision is
-- stamped with the counter-offer round it answers (0 = the original quotation), which is what the bid history
-- is built from. Also: approval chains can now hold purchase-order levels with a value threshold (slabs).

alter table purchase.approval_chains drop constraint if exists approval_chains_doc_type_check;
alter table purchase.approval_chains add constraint approval_chains_doc_type_check check (doc_type in ('indent','po'));
alter table purchase.approval_chains add column if not exists min_value numeric(14,2) not null default 0;
comment on column purchase.approval_chains.min_value is
  'Purchase orders only: this level is used when the PO total is at least this amount (so levels form value slabs). Indents ignore it.';

create table if not exists purchase.rfq_rounds(
  id          bigserial primary key,
  rfq_id      bigint not null references purchase.rfqs(id) on delete cascade,
  round_no    int not null,
  note        text,
  created_by  text default app.current_user_email(),
  created_at  timestamptz not null default now(),
  unique (rfq_id, round_no)
);
create table if not exists purchase.rfq_round_vendors(
  round_id       bigint not null references purchase.rfq_rounds(id) on delete cascade,
  rfq_vendor_id  bigint not null references purchase.rfq_vendors(id) on delete cascade,
  primary key (round_id, rfq_vendor_id)
);
create table if not exists purchase.rfq_round_targets(
  id             bigserial primary key,
  round_id       bigint not null references purchase.rfq_rounds(id) on delete cascade,
  rfq_vendor_id  bigint not null references purchase.rfq_vendors(id) on delete cascade,
  rfq_line_id    bigint not null references purchase.rfq_lines(id) on delete cascade,
  target_rate    numeric(14,2) not null check (target_rate > 0),
  unique (round_id, rfq_vendor_id, rfq_line_id)
);

alter table purchase.quotations add column if not exists round_no int not null default 0;
comment on column purchase.quotations.round_no is '0 = original quotation; n = answers counter-offer round n.';

-- ---------------------------------------------------------------------------
-- _save_quotation: now stamps the round the vendor is answering
-- ---------------------------------------------------------------------------
create or replace function purchase._save_quotation(p_rfq_vendor_id bigint, p_source text, p_by text, p jsonb) returns int
 language plpgsql security definer set search_path = purchase, public as $fn$
declare rv purchase.rfq_vendors; r purchase.rfqs; v_rev int; v_qid bigint; ln jsonb; v_n_lines int; v_quoting int := 0; v_rl purchase.rfq_lines; v_round int;
begin
  select * into rv from purchase.rfq_vendors where id = p_rfq_vendor_id for update;
  if not found then raise exception 'Invitation not found'; end if;
  select * into r from purchase.rfqs where id = rv.rfq_id and deleted_at is null;
  if not found then raise exception 'RFQ not found'; end if;
  if p_source = 'vendor' then
    if r.status <> 'open' then raise exception 'This RFQ is not accepting quotations'; end if;
    if r.due_date is not null and r.due_date < current_date then raise exception 'The last date for quotations has passed'; end if;
  elsif r.status not in ('open','closed') then
    raise exception 'This RFQ is % - quotations cannot be entered', r.status;
  end if;
  if jsonb_typeof(p->'lines') <> 'array' then raise exception 'No quoted items'; end if;
  select count(*) into v_n_lines from purchase.rfq_lines where rfq_id = r.id;
  if jsonb_array_length(p->'lines') <> v_n_lines then raise exception 'Every item of the RFQ must be answered - quote it or mark it "not quoting"'; end if;

  for ln in select * from jsonb_array_elements(p->'lines') loop
    select * into v_rl from purchase.rfq_lines where id = (ln->>'rfq_line_id')::bigint and rfq_id = r.id;
    if not found then raise exception 'An item does not belong to this RFQ'; end if;
    if coalesce((ln->>'quoting')::boolean, true) then
      if coalesce((ln->>'rate')::numeric, 0) <= 0 then raise exception 'Enter a rate for every item you are quoting'; end if;
      if coalesce((ln->>'gst_rate')::numeric, 0) < 0 or coalesce((ln->>'gst_rate')::numeric, 0) > 100 then raise exception 'GST rate must be between 0 and 100'; end if;
      if ln->>'uom_id' is null then raise exception 'Choose the unit for every item you are quoting'; end if;
      v_quoting := v_quoting + 1;
    end if;
  end loop;
  if v_quoting = 0 then raise exception 'Quote at least one item (or decline the RFQ)'; end if;

  select coalesce(max(rr.round_no), 0) into v_round
    from purchase.rfq_rounds rr join purchase.rfq_round_vendors x on x.round_id = rr.id where x.rfq_vendor_id = p_rfq_vendor_id;
  select coalesce(max(revision), 0) + 1 into v_rev from purchase.quotations where rfq_vendor_id = p_rfq_vendor_id;
  update purchase.quotations set is_current = false where rfq_vendor_id = p_rfq_vendor_id and is_current;
  insert into purchase.quotations(rfq_vendor_id, revision, source, entered_by, round_no, payment_terms, delivery_terms, warranty_terms, freight_terms, price_validity, other_terms, remarks)
  values (p_rfq_vendor_id, v_rev, p_source, p_by, v_round,
          nullif(btrim(coalesce(p->>'payment_terms', '')), ''), nullif(btrim(coalesce(p->>'delivery_terms', '')), ''), nullif(btrim(coalesce(p->>'warranty_terms', '')), ''),
          nullif(btrim(coalesce(p->>'freight_terms', '')), ''), nullif(btrim(coalesce(p->>'price_validity', '')), ''), nullif(btrim(coalesce(p->>'other_terms', '')), ''),
          nullif(btrim(coalesce(p->>'remarks', '')), ''))
  returning id into v_qid;
  for ln in select * from jsonb_array_elements(p->'lines') loop
    insert into purchase.quotation_lines(quotation_id, rfq_line_id, quoting, uom_id, rate, gst_rate, make, remark)
    values (v_qid, (ln->>'rfq_line_id')::bigint, coalesce((ln->>'quoting')::boolean, true),
            case when coalesce((ln->>'quoting')::boolean, true) then (ln->>'uom_id')::bigint end,
            case when coalesce((ln->>'quoting')::boolean, true) then (ln->>'rate')::numeric end,
            case when coalesce((ln->>'quoting')::boolean, true) then coalesce((ln->>'gst_rate')::numeric, 0) end,
            case when coalesce((ln->>'quoting')::boolean, true) then nullif(btrim(coalesce(ln->>'make', '')), '') end,
            nullif(btrim(coalesce(ln->>'remark', '')), ''));
  end loop;
  update purchase.rfq_vendors set status = 'quoted', decline_reason = null where id = p_rfq_vendor_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark)
    values ('rfq', r.id, p_by, case when p_source = 'vendor' then 'Quotation submitted by vendor' else 'Quotation entered by Purchase' end,
            (select coalesce(v.trade_name, v.legal_name) from purchase.vendors v where v.id = rv.vendor_id) || ' - revision ' || v_rev || case when v_round > 0 then ' (counter offer ' || v_round || ')' else '' end);
  return v_rev;
end $fn$;
revoke all on function purchase._save_quotation(bigint, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Send a counter offer to chosen vendors
-- ---------------------------------------------------------------------------
create or replace function purchase.counter_offer_create(p_rfq_id bigint, p_rfq_vendor_ids bigint[], p_targets jsonb, p_note text) returns int
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._rfq_guard(); r purchase.rfqs; v_no int; v_round bigint; vid bigint; t jsonb; v_names text;
begin
  select * into r from purchase.rfqs where id = p_rfq_id and deleted_at is null for update;
  if not found then raise exception 'RFQ not found'; end if;
  if r.status <> 'open' then raise exception 'A counter offer can only be sent while the RFQ is open - reopen it or extend the last date first'; end if;
  if r.due_date is not null and r.due_date < current_date then raise exception 'The last date has passed - extend it first so vendors can answer'; end if;
  if p_rfq_vendor_ids is null or cardinality(p_rfq_vendor_ids) = 0 then raise exception 'Choose at least one vendor'; end if;
  foreach vid in array p_rfq_vendor_ids loop
    if not exists (select 1 from purchase.rfq_vendors where id = vid and rfq_id = p_rfq_id and status = 'quoted') then
      raise exception 'A counter offer can only go to vendors who have quoted';
    end if;
  end loop;
  select coalesce(max(round_no), 0) + 1 into v_no from purchase.rfq_rounds where rfq_id = p_rfq_id;
  insert into purchase.rfq_rounds(rfq_id, round_no, note, created_by) values (p_rfq_id, v_no, nullif(btrim(coalesce(p_note, '')), ''), me) returning id into v_round;
  insert into purchase.rfq_round_vendors(round_id, rfq_vendor_id) select v_round, unnest(p_rfq_vendor_ids);
  if jsonb_typeof(p_targets) = 'array' then
    for t in select * from jsonb_array_elements(p_targets) loop
      if (t->>'rfq_vendor_id')::bigint = any (p_rfq_vendor_ids) and coalesce((t->>'target_rate')::numeric, 0) > 0
         and exists (select 1 from purchase.rfq_lines where id = (t->>'rfq_line_id')::bigint and rfq_id = p_rfq_id) then
        insert into purchase.rfq_round_targets(round_id, rfq_vendor_id, rfq_line_id, target_rate)
        values (v_round, (t->>'rfq_vendor_id')::bigint, (t->>'rfq_line_id')::bigint, (t->>'target_rate')::numeric)
        on conflict (round_id, rfq_vendor_id, rfq_line_id) do update set target_rate = excluded.target_rate;
      end if;
    end loop;
  end if;
  select string_agg(coalesce(v.trade_name, v.legal_name), ', ') into v_names
    from purchase.rfq_vendors rv join purchase.vendors v on v.id = rv.vendor_id where rv.id = any (p_rfq_vendor_ids);
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('rfq', p_rfq_id, me, 'Counter offer ' || v_no || ' sent', v_names);
  return v_no;
end $fn$;
revoke all on function purchase.counter_offer_create(bigint, bigint[], jsonb, text) from public, anon;
grant execute on function purchase.counter_offer_create(bigint, bigint[], jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The vendor's link now also shows the counter offer addressed to them
-- ---------------------------------------------------------------------------
create or replace function purchase.rfq_quote_get(p_token text) returns jsonb
 language plpgsql security definer set search_path = purchase, public as $fn$
declare rv purchase.rfq_vendors; r purchase.rfqs; v purchase.vendors; q purchase.quotations; v_counter jsonb;
begin
  select * into rv from purchase.rfq_vendors where token = p_token;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  select * into r from purchase.rfqs where id = rv.rfq_id and deleted_at is null;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if r.status = 'cancelled' then return jsonb_build_object('error', 'cancelled'); end if;
  if r.status = 'draft' then return jsonb_build_object('error', 'not_found'); end if;
  if r.status <> 'open' then return jsonb_build_object('error', 'closed'); end if;
  if r.due_date is not null and r.due_date < current_date then return jsonb_build_object('error', 'expired'); end if;
  select * into v from purchase.vendors where id = rv.vendor_id;
  select * into q from purchase.quotations where rfq_vendor_id = rv.id and is_current;
  select jsonb_build_object('round_no', rr.round_no, 'note', rr.note,
           'targets', coalesce((select jsonb_object_agg(t.rfq_line_id::text, t.target_rate) from purchase.rfq_round_targets t where t.round_id = rr.id and t.rfq_vendor_id = rv.id), '{}'::jsonb))
    into v_counter
    from purchase.rfq_rounds rr join purchase.rfq_round_vendors x on x.round_id = rr.id and x.rfq_vendor_id = rv.id
   order by rr.round_no desc limit 1;
  return jsonb_build_object('ok', true, 'rfq_vendor_id', rv.id, 'doc_no', r.doc_no, 'due_date', r.due_date, 'terms_requested', r.terms_requested, 'remarks', r.remarks,
    'vendor', coalesce(v.trade_name, v.legal_name), 'status', rv.status, 'counter', v_counter,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'line_no', l.line_no, 'code', i.code, 'name', i.name, 'hsn', i.hsn_code, 'gst_rate', i.gst_rate, 'qty', l.qty, 'uom_id', l.uom_id,
                'uom', u.code, 'q', (select jsonb_build_object('quoting', ql.quoting, 'uom_id', ql.uom_id, 'rate', ql.rate, 'gst_rate', ql.gst_rate, 'make', ql.make, 'remark', ql.remark)
                                        from purchase.quotation_lines ql where ql.quotation_id = q.id and ql.rfq_line_id = l.id)) order by l.line_no), '[]'::jsonb)
                from purchase.rfq_lines l join purchase.items i on i.id = l.item_id join purchase.uoms u on u.id = l.uom_id where l.rfq_id = r.id),
    'uoms', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'code', code) order by code), '[]'::jsonb) from purchase.uoms where deleted_at is null),
    'current', case when q.id is null then null else jsonb_build_object('revision', q.revision, 'payment_terms', q.payment_terms, 'delivery_terms', q.delivery_terms, 'warranty_terms', q.warranty_terms,
                'freight_terms', q.freight_terms, 'price_validity', q.price_validity, 'other_terms', q.other_terms, 'remarks', q.remarks) end);
end $fn$;
revoke all on function purchase.rfq_quote_get(text) from public, anon, authenticated;
grant execute on function purchase.rfq_quote_get(text) to service_role;

do $rls$
declare t text;
begin
  foreach t in array array['rfq_rounds','rfq_round_vendors','rfq_round_targets'] loop
    execute format('alter table purchase.%I enable row level security', t);
    execute format('drop policy if exists %I on purchase.%I', t || '_staff_read', t);
    execute format('create policy %I on purchase.%I for select to authenticated using ((select not app.is_customer()))', t || '_staff_read', t);
    execute format('grant select on purchase.%I to authenticated', t);
  end loop;
end $rls$;
grant usage, select on all sequences in schema purchase to authenticated;
