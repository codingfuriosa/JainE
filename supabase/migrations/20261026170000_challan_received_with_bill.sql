/* CHALLAN PROCESSING: a last step, "Challan received with bill", held by Arun Pandey.

   Step 3 is Accounts' (accounts2@, Arun kr Pandey). He is the last person on the workflow: when he
   marks it Done he says which Invoice Processing bills the challan arrived with, and the challan's
   file is attached to each of those bills and each bill's file to the challan.

   WHAT THIS ADDS, AND WHAT IT LEAVES ALONE
     - one row in acc.flow_steps. Instances already past it are untouched (the 25 Done challans stay
       Done); the one still in progress picks the step up when its step 2 is passed on, exactly as
       any step added to a workflow after an instance was raised (wf_materialise_steps).
     - acc.flow_case_links: which bill a challan came with. Written only by wf_challan_link below.
     - acc.wf_challan_bills(fcs): the bills Arun may choose from, the challan's company first.
     - acc.wf_challan_link(fcs, bills): records the link and posts the two attachments.
   No existing function is changed. Done itself is still acc.wf_done; the screen asks which bills
   first (accountability.js, wfChallanDoneOpen) and then calls it. */

-- 1. THE STEP ---------------------------------------------------------------------------------
insert into acc.flow_steps(flow_id, seq, title, owner_email, owner_emails, duration_value, duration_unit, description, department)
select 40, 3, 'Challan received with bill', 'accounts2@thejaingroup.com', array['accounts2@thejaingroup.com'], 2, 'days',
       'Accounts confirms the challan came with its bill, and says which bill or bills it came with. The challan is attached to each of them, and each bill to the challan.',
       'Accounts'
 where not exists (select 1 from acc.flow_steps where flow_id = 40 and seq = 3);

-- an instance still in progress gets its row for the new step now, so its own page already shows it
do $$
declare r record;
begin
  for r in select id from acc.flow_cases where flow_id = 40 and status = 'Pending' loop
    perform acc.wf_materialise_steps(r.id);
  end loop;
end $$;

-- 2. WHICH BILL A CHALLAN CAME WITH -------------------------------------------------------------
create table if not exists acc.flow_case_links (
  id              bigserial primary key,
  challan_case_id bigint not null references acc.flow_cases(id) on delete cascade,
  bill_case_id    bigint not null references acc.flow_cases(id) on delete cascade,
  linked_by       text,
  linked_at       timestamptz not null default now(),
  unique (challan_case_id, bill_case_id)
);
create index if not exists flow_case_links_bill_idx on acc.flow_case_links(bill_case_id);
alter table acc.flow_case_links enable row level security;
drop policy if exists flcl_read on acc.flow_case_links;
create policy flcl_read on acc.flow_case_links for select
  using (acc.wf_can_see_case(challan_case_id) or acc.wf_can_see_case(bill_case_id));
grant select on acc.flow_case_links to authenticated;

-- 3. NAMES THAT MEAN THE SAME PARTY ---------------------------------------------------------------
/* "M/S GDS ELECTRICALS" on a challan and "GDS ELECTRICALS" on its bill are one supplier; so are
   "SHASHWAT STEEL" and "SHASHWAT STEELS". Upper-cased, the usual company suffixes and everything that
   is not a letter or digit removed - two names match when one holds the other. */
create or replace function acc._wf_party_key(t text) returns text
 language sql immutable
as $$ select regexp_replace(regexp_replace(upper(coalesce(t, '')), '\m(M/S|PVT|PRIVATE|LTD|LIMITED)\M', '', 'g'), '[^A-Z0-9]', '', 'g') $$;

create or replace function acc._wf_party_match(a text, b text) returns boolean
 language sql immutable
as $$ select a <> '' and b <> '' and (a = b or (least(length(a), length(b)) >= 4 and (position(a in b) > 0 or position(b in a) > 0))) $$;

-- 4. THE FILES A CASE CARRIES ----------------------------------------------------------------------
create or replace function acc._wf_case_files(p_case_id bigint) returns text[]
 language sql stable
as $$
  select coalesce(array_agg(p), '{}'::text[]) from (
    select btrim(x) p
      from acc.flow_cases c,
           jsonb_array_elements(coalesce(c.trigger_details, '[]'::jsonb)) d,
           regexp_split_to_table(coalesce(d->>'value', ''), '[|,;]') x
     where c.id = p_case_id and d->>'label' = 'Attachment' and btrim(x) like 's3:%') s
$$;

-- 5. THE BILLS TO CHOOSE FROM ----------------------------------------------------------------------
/* Everything Invoice Processing holds, each marked with whether it is the challan's company, so the
   screen can start on those and still let Arun search the rest (a supplier is not always spelled the
   same way twice). Only whoever holds the challan's last step is told. */
create or replace function acc.wf_challan_bills(p_fcs_id bigint) returns jsonb
 language plpgsql stable security definer
 set search_path to 'acc', 'public'
as $function$
declare v_email text := app.current_user_email(); v acc.flow_case_steps; ch acc.flow_cases; v_key text;
begin
  select * into v from acc.flow_case_steps where id = p_fcs_id;
  if not found then raise exception 'step not found'; end if;
  select * into ch from acc.flow_cases where id = v.case_id;
  if ch.flow_id <> 40 then raise exception 'not a challan'; end if;
  if not (acc.wf_may_act_as(v.person, v_email, ch.flow_id)
          or lower(coalesce(v_email, '')) = any (select lower(x) from unnest(coalesce(v.candidates, '{}'::text[])) x)) then
    raise exception 'not your step';
  end if;
  select acc._wf_party_key(d->>'value') into v_key
    from jsonb_array_elements(coalesce(ch.trigger_details, '[]'::jsonb)) d where d->>'label' = 'Company' limit 1;

  return coalesce((select jsonb_agg(to_jsonb(t) order by t.matched desc, t.jaine_id desc nulls last) from (
    select c.id as case_id, c.jaine_id, c.status,
           (select d->>'value' from jsonb_array_elements(c.trigger_details) d where d->>'label' = 'Vendor' limit 1) as vendor,
           (select d->>'value' from jsonb_array_elements(c.trigger_details) d where d->>'label' = 'Bill No.' limit 1) as bill_no,
           (select d->>'value' from jsonb_array_elements(c.trigger_details) d where d->>'label' = 'Amount' limit 1) as amount,
           acc._wf_party_match(coalesce(v_key, ''), acc._wf_party_key(
             (select d->>'value' from jsonb_array_elements(c.trigger_details) d where d->>'label' = 'Vendor' limit 1))) as matched,
           exists (select 1 from acc.flow_case_links l where l.challan_case_id = ch.id and l.bill_case_id = c.id) as linked
      from acc.flow_cases c
     where c.flow_id = 26) t), '[]'::jsonb);
end; $function$;

-- 6. LINK THE CHALLAN AND THE BILLS ------------------------------------------------------------------
/* Called by Arun just before he completes the step. For every bill chosen: record the link, put the
   challan's file(s) on the bill as an update, and the bill's file(s) on the challan as an update -
   the same updates & attachments any person could post by hand, so they show in each one's
   Updates & Feedback. A bill already linked to this challan is skipped, so choosing it again (or
   reopening and finishing the step twice) attaches nothing twice. Returns how many were newly linked. */
create or replace function acc.wf_challan_link(p_fcs_id bigint, p_bill_case_ids bigint[]) returns integer
 language plpgsql security definer
 set search_path to 'acc', 'public'
as $function$
declare v_email text := app.current_user_email(); v acc.flow_case_steps; ch acc.flow_cases;
        b acc.flow_cases; v_id bigint; v_upd bigint; v_n int := 0; v_p text;
        v_cno text; v_cdate text; v_cco text; v_vendor text; v_bno text; v_chfiles text[]; v_bfiles text[];
begin
  select * into v from acc.flow_case_steps where id = p_fcs_id for update;
  if not found then raise exception 'step not found'; end if;
  select * into ch from acc.flow_cases where id = v.case_id;
  if ch.flow_id <> 40 then raise exception 'not a challan'; end if;
  if v.seq <> (select max(seq) from acc.flow_steps where flow_id = 40) then
    raise exception 'Bills are linked at the last step of Challan Processing';
  end if;
  if not acc.wf_may_act_as(v.person, v_email, ch.flow_id) then raise exception 'not your step'; end if;

  select max(d->>'value') filter (where d->>'label' = 'Challan No.'),
         max(d->>'value') filter (where d->>'label' = 'Challan Date'),
         max(d->>'value') filter (where d->>'label' = 'Company')
    into v_cno, v_cdate, v_cco
    from jsonb_array_elements(coalesce(ch.trigger_details, '[]'::jsonb)) d;
  v_chfiles := acc._wf_case_files(ch.id);

  foreach v_id in array coalesce(p_bill_case_ids, '{}'::bigint[]) loop
    select * into b from acc.flow_cases where id = v_id and flow_id = 26;
    if not found then raise exception 'bill % is not an Invoice Processing bill', v_id; end if;
    insert into acc.flow_case_links(challan_case_id, bill_case_id, linked_by)
      values (ch.id, b.id, v_email) on conflict do nothing;
    if not found then continue; end if;          -- already linked: nothing to attach again
    v_n := v_n + 1;
    select max(d->>'value') filter (where d->>'label' = 'Vendor'), max(d->>'value') filter (where d->>'label' = 'Bill No.')
      into v_vendor, v_bno from jsonb_array_elements(coalesce(b.trigger_details, '[]'::jsonb)) d;
    v_bfiles := acc._wf_case_files(b.id);

    -- the challan, on the bill
    insert into acc.flow_updates(case_id, author, body)
      values (b.id, v_email, 'Challan ' || coalesce(v_cno, '') || ' (' || coalesce(v_cco, '') || coalesce(', ' || nullif(v_cdate, ''), '') || ') received with this bill.')
      returning id into v_upd;
    foreach v_p in array v_chfiles loop
      insert into acc.flow_update_attachments(update_id, storage_path, file_name) values (v_upd, v_p, regexp_replace(v_p, '^.*/', ''));
    end loop;

    -- the bill, on the challan
    insert into acc.flow_updates(case_id, author, body)
      values (ch.id, v_email, 'Received with bill ' || coalesce(b.jaine_id::text, b.case_no::text, '') || ' (' || coalesce(v_vendor, '') || coalesce(', Bill ' || nullif(v_bno, ''), '') || ').')
      returning id into v_upd;
    foreach v_p in array v_bfiles loop
      insert into acc.flow_update_attachments(update_id, storage_path, file_name) values (v_upd, v_p, regexp_replace(v_p, '^.*/', ''));
    end loop;
  end loop;
  return v_n;
end; $function$;

revoke all on function acc.wf_challan_bills(bigint) from public, anon;
revoke all on function acc.wf_challan_link(bigint, bigint[]) from public, anon;
grant execute on function acc.wf_challan_bills(bigint) to authenticated;
grant execute on function acc.wf_challan_link(bigint, bigint[]) to authenticated;
