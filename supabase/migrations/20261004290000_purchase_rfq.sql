-- Purchase & Stores, Stage 4: RFQ and quotation. See docs/purchase-stores-spec.md section 4.
--
-- An RFQ is raised for ONE project from the open (approved, not yet ordered) lines of that project's approved
-- indents. Same item on several indent lines is quoted once: rfq_lines holds one row per item and
-- rfq_sources remembers which indent lines (and how much of each) it covers. Approved vendors are invited;
-- each invitation carries a personal token for the no-sign-in quote page. A quotation is saved as a new
-- REVISION every time (nothing is overwritten), either by the vendor through the link or by Purchase on the
-- vendor's behalf. Counter offers and bid history (Stage 5) build on the same revision trail.
--
-- All writes go through the functions below; the tables are read-only from the browser.
-- Document number: <project code>/RFQ/<financial year>/<serial>, given when the RFQ is first sent.

create table if not exists purchase.rfqs(
  id               bigserial primary key,
  doc_no           text,
  project_id       bigint not null references cust.projects(id),
  status           text not null default 'draft' check (status in ('draft','open','closed','cancelled','ordered')),
  rfq_date         date not null default current_date,
  due_date         date,
  remarks          text,
  terms_requested  text,
  created_by       text default app.current_user_email(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  sent_at          timestamptz,
  closed_at        timestamptz,
  cancelled_at     timestamptz,
  cancel_reason    text,
  deleted_at       timestamptz,
  deleted_by       text
);
create unique index if not exists rfqs_doc_no_uq on purchase.rfqs (doc_no) where doc_no is not null;
create index if not exists rfqs_project_idx on purchase.rfqs (project_id, status) where deleted_at is null;

create table if not exists purchase.rfq_lines(
  id       bigserial primary key,
  rfq_id   bigint not null references purchase.rfqs(id) on delete cascade,
  line_no  int not null,
  item_id  bigint not null references purchase.items(id),
  qty      numeric(14,3) not null check (qty > 0),
  uom_id   bigint not null references purchase.uoms(id),
  unique (rfq_id, item_id)
);

create table if not exists purchase.rfq_sources(
  id              bigserial primary key,
  rfq_id          bigint not null references purchase.rfqs(id) on delete cascade,
  rfq_line_id     bigint not null references purchase.rfq_lines(id) on delete cascade,
  indent_id       bigint not null references purchase.indents(id),
  indent_line_id  bigint not null references purchase.indent_lines(id),
  qty             numeric(14,3) not null check (qty > 0)
);
create index if not exists rfq_sources_indent_idx on purchase.rfq_sources (indent_id);

create table if not exists purchase.rfq_vendors(
  id          bigserial primary key,
  rfq_id      bigint not null references purchase.rfqs(id) on delete cascade,
  vendor_id   bigint not null references purchase.vendors(id),
  token       text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  status      text not null default 'invited' check (status in ('invited','quoted','declined')),
  decline_reason text,
  invited_at  timestamptz,
  emailed_at  timestamptz,
  unique (rfq_id, vendor_id)
);

create table if not exists purchase.quotations(
  id              bigserial primary key,
  rfq_vendor_id   bigint not null references purchase.rfq_vendors(id) on delete cascade,
  revision        int not null,
  is_current      boolean not null default true,
  source          text not null check (source in ('vendor','purchase')),
  entered_by      text,
  submitted_at    timestamptz not null default now(),
  payment_terms   text,
  delivery_terms  text,
  warranty_terms  text,
  freight_terms   text,
  price_validity  text,
  other_terms     text,
  remarks         text,
  unique (rfq_vendor_id, revision)
);
create unique index if not exists quotations_current_uq on purchase.quotations (rfq_vendor_id) where is_current;

create table if not exists purchase.quotation_lines(
  id            bigserial primary key,
  quotation_id  bigint not null references purchase.quotations(id) on delete cascade,
  rfq_line_id   bigint not null references purchase.rfq_lines(id) on delete cascade,
  quoting       boolean not null default true,
  uom_id        bigint references purchase.uoms(id),
  rate          numeric(14,2),
  gst_rate      numeric(5,2),
  make          text,
  remark        text,
  check ((not quoting) or (rate is not null and rate > 0))
);
create index if not exists quotation_lines_q_idx on purchase.quotation_lines (quotation_id);

-- ---------------------------------------------------------------------------
-- Internal: save one quotation revision (used by Purchase's manual entry and by the vendor's link)
-- ---------------------------------------------------------------------------
create or replace function purchase._save_quotation(p_rfq_vendor_id bigint, p_source text, p_by text, p jsonb) returns int
 language plpgsql security definer set search_path = purchase, public as $fn$
declare rv purchase.rfq_vendors; r purchase.rfqs; v_rev int; v_qid bigint; ln jsonb; v_n_lines int; v_quoting int := 0; v_rl purchase.rfq_lines;
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

  select coalesce(max(revision), 0) + 1 into v_rev from purchase.quotations where rfq_vendor_id = p_rfq_vendor_id;
  update purchase.quotations set is_current = false where rfq_vendor_id = p_rfq_vendor_id and is_current;
  insert into purchase.quotations(rfq_vendor_id, revision, source, entered_by, payment_terms, delivery_terms, warranty_terms, freight_terms, price_validity, other_terms, remarks)
  values (p_rfq_vendor_id, v_rev, p_source, p_by,
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
            (select coalesce(v.trade_name, v.legal_name) from purchase.vendors v where v.id = rv.vendor_id) || ' - revision ' || v_rev);
  return v_rev;
end $fn$;
revoke all on function purchase._save_quotation(bigint, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Purchase's functions
-- ---------------------------------------------------------------------------
create or replace function purchase._rfq_guard() returns text
 language plpgsql stable security definer set search_path = purchase, public as $fn$
begin
  if coalesce(app.current_user_email(), '') = '' then raise exception 'not signed in'; end if;
  if app.is_customer() then raise exception 'not allowed'; end if;
  if not purchase.can('rfq.manage') then raise exception 'You do not have permission to manage RFQs - ask a Purchase administrator'; end if;
  return lower(app.current_user_email());
end $fn$;
revoke all on function purchase._rfq_guard() from public, anon, authenticated;

create or replace function purchase.rfq_create(p_project bigint, p_sources jsonb, p_vendor_ids bigint[], p_due date, p_remarks text, p_terms text) returns bigint
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._rfq_guard(); v_id bigint; s jsonb; l record; v_bal numeric; v_line_id bigint; v_n int := 0; vid bigint;
begin
  if jsonb_typeof(p_sources) <> 'array' or jsonb_array_length(p_sources) = 0 then raise exception 'Pick at least one indent item'; end if;
  insert into purchase.rfqs(project_id, due_date, remarks, terms_requested, created_by) values (p_project, p_due, nullif(btrim(coalesce(p_remarks, '')), ''), nullif(btrim(coalesce(p_terms, '')), ''), me) returning id into v_id;
  for s in select * from jsonb_array_elements(p_sources) loop
    select il.id as line_id, il.indent_id, il.item_id, il.uom_id, il.qty, il.ordered_qty, il.short_closed_qty, i.project_id, i.status
      into l from purchase.indent_lines il join purchase.indents i on i.id = il.indent_id and i.deleted_at is null
     where il.id = (s->>'indent_line_id')::bigint;
    if not found then raise exception 'An indent item was not found'; end if;
    if l.project_id <> p_project then raise exception 'All items of an RFQ must belong to the same project'; end if;
    if l.status <> 'approved' then raise exception 'Only items of approved indents can be put out for quotation'; end if;
    v_bal := l.qty - l.ordered_qty - l.short_closed_qty;
    if coalesce((s->>'qty')::numeric, 0) <= 0 or (s->>'qty')::numeric > v_bal then raise exception 'The quantity for an item must be more than 0 and at most its open balance (%)', v_bal; end if;
    select id into v_line_id from purchase.rfq_lines where rfq_id = v_id and item_id = l.item_id;
    if v_line_id is null then
      v_n := v_n + 1;
      insert into purchase.rfq_lines(rfq_id, line_no, item_id, qty, uom_id) values (v_id, v_n, l.item_id, (s->>'qty')::numeric, l.uom_id) returning id into v_line_id;
    else
      update purchase.rfq_lines set qty = qty + (s->>'qty')::numeric where id = v_line_id;
    end if;
    insert into purchase.rfq_sources(rfq_id, rfq_line_id, indent_id, indent_line_id, qty) values (v_id, v_line_id, l.indent_id, l.line_id, (s->>'qty')::numeric);
  end loop;
  if p_vendor_ids is not null then
    foreach vid in array p_vendor_ids loop
      if not exists (select 1 from purchase.vendors where id = vid and status = 'approved' and deleted_at is null) then raise exception 'Only approved vendors can be invited'; end if;
      insert into purchase.rfq_vendors(rfq_id, vendor_id) values (v_id, vid) on conflict do nothing;
    end loop;
  end if;
  insert into purchase.doc_log(doc_type, doc_id, by, action) values ('rfq', v_id, me, 'Inserted');
  return v_id;
end $fn$;

create or replace function purchase.rfq_update(p_id bigint, p_vendor_ids bigint[], p_due date, p_remarks text, p_terms text) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._rfq_guard(); r purchase.rfqs; vid bigint;
begin
  select * into r from purchase.rfqs where id = p_id and deleted_at is null for update;
  if not found then raise exception 'RFQ not found'; end if;
  if r.status <> 'draft' then raise exception 'Only a draft RFQ can be edited'; end if;
  update purchase.rfqs set due_date = p_due, remarks = nullif(btrim(coalesce(p_remarks, '')), ''), terms_requested = nullif(btrim(coalesce(p_terms, '')), ''), updated_at = now() where id = p_id;
  delete from purchase.rfq_vendors where rfq_id = p_id and not (vendor_id = any (coalesce(p_vendor_ids, '{}')));
  if p_vendor_ids is not null then
    foreach vid in array p_vendor_ids loop
      if not exists (select 1 from purchase.vendors where id = vid and status = 'approved' and deleted_at is null) then raise exception 'Only approved vendors can be invited'; end if;
      insert into purchase.rfq_vendors(rfq_id, vendor_id) values (p_id, vid) on conflict do nothing;
    end loop;
  end if;
  insert into purchase.doc_log(doc_type, doc_id, by, action) values ('rfq', p_id, me, 'Modified');
end $fn$;

create or replace function purchase.rfq_delete(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._rfq_guard(); r purchase.rfqs;
begin
  select * into r from purchase.rfqs where id = p_id and deleted_at is null for update;
  if not found then raise exception 'RFQ not found'; end if;
  if r.status <> 'draft' then raise exception 'Only a draft RFQ can be deleted - cancel it instead'; end if;
  update purchase.rfqs set deleted_at = now(), deleted_by = me where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action) values ('rfq', p_id, me, 'Deleted');
end $fn$;

create or replace function purchase.rfq_send(p_id bigint) returns text
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._rfq_guard(); r purchase.rfqs; v_no text;
begin
  select * into r from purchase.rfqs where id = p_id and deleted_at is null for update;
  if not found then raise exception 'RFQ not found'; end if;
  if r.status <> 'draft' then raise exception 'This RFQ has already been sent'; end if;
  if not exists (select 1 from purchase.rfq_lines where rfq_id = p_id) then raise exception 'The RFQ has no items'; end if;
  if not exists (select 1 from purchase.rfq_vendors where rfq_id = p_id) then raise exception 'Invite at least one vendor first'; end if;
  if r.due_date is null or r.due_date < current_date then raise exception 'Set a last date for quotations that is today or later'; end if;
  if exists (select 1 from purchase.rfq_vendors rv join purchase.vendors v on v.id = rv.vendor_id where rv.rfq_id = p_id and (v.status <> 'approved' or v.deleted_at is not null)) then
    raise exception 'One of the invited vendors is no longer approved - remove it first';
  end if;
  v_no := coalesce(r.doc_no, purchase.next_doc_no(r.project_id, 'RFQ', r.rfq_date));
  update purchase.rfqs set status = 'open', doc_no = v_no, sent_at = now(), updated_at = now() where id = p_id;
  update purchase.rfq_vendors set invited_at = now() where rfq_id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action) values ('rfq', p_id, me, 'Sent to vendors');
  return v_no;
end $fn$;

create or replace function purchase.rfq_close(p_id bigint) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._rfq_guard(); r purchase.rfqs;
begin
  select * into r from purchase.rfqs where id = p_id and deleted_at is null for update;
  if not found then raise exception 'RFQ not found'; end if;
  if r.status <> 'open' then raise exception 'Only an open RFQ can be closed'; end if;
  update purchase.rfqs set status = 'closed', closed_at = now(), updated_at = now() where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action) values ('rfq', p_id, me, 'Quotations closed');
end $fn$;

-- Extend the last date, or reopen a closed RFQ with a new last date.
create or replace function purchase.rfq_reopen(p_id bigint, p_due date) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._rfq_guard(); r purchase.rfqs;
begin
  select * into r from purchase.rfqs where id = p_id and deleted_at is null for update;
  if not found then raise exception 'RFQ not found'; end if;
  if r.status not in ('open','closed') then raise exception 'This RFQ is % and cannot be reopened', r.status; end if;
  if p_due is null or p_due < current_date then raise exception 'Choose a last date that is today or later'; end if;
  update purchase.rfqs set status = 'open', due_date = p_due, closed_at = null, updated_at = now() where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('rfq', p_id, me, case when r.status = 'closed' then 'Reopened' else 'Last date extended' end, 'New last date ' || to_char(p_due, 'DD/MM/YYYY'));
end $fn$;

create or replace function purchase.rfq_cancel(p_id bigint, p_reason text) returns void
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._rfq_guard(); r purchase.rfqs;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason for cancelling'; end if;
  select * into r from purchase.rfqs where id = p_id and deleted_at is null for update;
  if not found then raise exception 'RFQ not found'; end if;
  if r.status not in ('draft','open','closed') then raise exception 'This RFQ is % and cannot be cancelled', r.status; end if;
  update purchase.rfqs set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason), updated_at = now() where id = p_id;
  insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('rfq', p_id, me, 'Cancelled', btrim(p_reason));
end $fn$;

create or replace function purchase.quotation_save_manual(p_rfq_vendor_id bigint, p jsonb) returns int
 language plpgsql security definer set search_path = purchase, public as $fn$
declare me text := purchase._rfq_guard();
begin
  return purchase._save_quotation(p_rfq_vendor_id, 'purchase', me, p);
end $fn$;

-- ---------------------------------------------------------------------------
-- The vendor's link (service role only; called by the edge function)
-- ---------------------------------------------------------------------------
create or replace function purchase.rfq_quote_get(p_token text) returns jsonb
 language plpgsql security definer set search_path = purchase, public as $fn$
declare rv purchase.rfq_vendors; r purchase.rfqs; v purchase.vendors; q purchase.quotations;
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
  return jsonb_build_object('ok', true, 'rfq_vendor_id', rv.id, 'doc_no', r.doc_no, 'due_date', r.due_date, 'terms_requested', r.terms_requested, 'remarks', r.remarks,
    'vendor', coalesce(v.trade_name, v.legal_name), 'status', rv.status,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'line_no', l.line_no, 'code', i.code, 'name', i.name, 'hsn', i.hsn_code, 'gst_rate', i.gst_rate, 'qty', l.qty, 'uom_id', l.uom_id,
                'uom', u.code, 'q', (select jsonb_build_object('quoting', ql.quoting, 'uom_id', ql.uom_id, 'rate', ql.rate, 'gst_rate', ql.gst_rate, 'make', ql.make, 'remark', ql.remark)
                                        from purchase.quotation_lines ql where ql.quotation_id = q.id and ql.rfq_line_id = l.id)) order by l.line_no), '[]'::jsonb)
                from purchase.rfq_lines l join purchase.items i on i.id = l.item_id join purchase.uoms u on u.id = l.uom_id where l.rfq_id = r.id),
    'uoms', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'code', code) order by code), '[]'::jsonb) from purchase.uoms where deleted_at is null),
    'current', case when q.id is null then null else jsonb_build_object('revision', q.revision, 'payment_terms', q.payment_terms, 'delivery_terms', q.delivery_terms, 'warranty_terms', q.warranty_terms,
                'freight_terms', q.freight_terms, 'price_validity', q.price_validity, 'other_terms', q.other_terms, 'remarks', q.remarks) end);
end $fn$;

create or replace function purchase.rfq_quote_submit(p_token text, p jsonb) returns jsonb
 language plpgsql security definer set search_path = purchase, public as $fn$
declare rv purchase.rfq_vendors; chk jsonb; v_name text; v_rev int;
begin
  chk := purchase.rfq_quote_get(p_token);
  if chk ? 'error' then return chk; end if;
  select * into rv from purchase.rfq_vendors where token = p_token;
  select coalesce(trade_name, legal_name) into v_name from purchase.vendors where id = rv.vendor_id;
  if coalesce((p->>'decline')::boolean, false) then
    update purchase.rfq_vendors set status = 'declined', decline_reason = nullif(btrim(coalesce(p->>'reason', '')), '') where id = rv.id;
    insert into purchase.doc_log(doc_type, doc_id, by, action, remark) values ('rfq', rv.rfq_id, 'vendor: ' || v_name, 'Declined to quote', nullif(btrim(coalesce(p->>'reason', '')), ''));
    return jsonb_build_object('ok', true, 'declined', true);
  end if;
  begin
    v_rev := purchase._save_quotation(rv.id, 'vendor', 'vendor: ' || v_name, p);
  exception when raise_exception then
    return jsonb_build_object('error', 'invalid', 'message', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'revision', v_rev);
end $fn$;

revoke all on function purchase.rfq_quote_get(text) from public, anon, authenticated;
revoke all on function purchase.rfq_quote_submit(text, jsonb) from public, anon, authenticated;
grant execute on function purchase.rfq_quote_get(text) to service_role;
grant execute on function purchase.rfq_quote_submit(text, jsonb) to service_role;

revoke all on function purchase.rfq_create(bigint, jsonb, bigint[], date, text, text) from public, anon;
revoke all on function purchase.rfq_update(bigint, bigint[], date, text, text) from public, anon;
revoke all on function purchase.rfq_delete(bigint) from public, anon;
revoke all on function purchase.rfq_send(bigint) from public, anon;
revoke all on function purchase.rfq_close(bigint) from public, anon;
revoke all on function purchase.rfq_reopen(bigint, date) from public, anon;
revoke all on function purchase.rfq_cancel(bigint, text) from public, anon;
revoke all on function purchase.quotation_save_manual(bigint, jsonb) from public, anon;
grant execute on function purchase.rfq_create(bigint, jsonb, bigint[], date, text, text) to authenticated;
grant execute on function purchase.rfq_update(bigint, bigint[], date, text, text) to authenticated;
grant execute on function purchase.rfq_delete(bigint) to authenticated;
grant execute on function purchase.rfq_send(bigint) to authenticated;
grant execute on function purchase.rfq_close(bigint) to authenticated;
grant execute on function purchase.rfq_reopen(bigint, date) to authenticated;
grant execute on function purchase.rfq_cancel(bigint, text) to authenticated;
grant execute on function purchase.quotation_save_manual(bigint, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: staff read, no direct writes (everything goes through the functions)
-- ---------------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array['rfqs','rfq_lines','rfq_sources','rfq_vendors','quotations','quotation_lines'] loop
    execute format('alter table purchase.%I enable row level security', t);
    execute format('drop policy if exists %I on purchase.%I', t || '_staff_read', t);
    execute format('create policy %I on purchase.%I for select to authenticated using ((select not app.is_customer()))', t || '_staff_read', t);
    execute format('grant select on purchase.%I to authenticated', t);
  end loop;
end $rls$;
grant usage, select on all sequences in schema purchase to authenticated;

update purchase.permissions set stage = null where key = 'rfq.manage';
