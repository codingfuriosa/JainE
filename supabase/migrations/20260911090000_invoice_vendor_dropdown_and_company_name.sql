/* Invoice Processing: "Company" becomes "Vendor", it remembers what has been typed into it, and a
   plain "Company Name" field joins it.

   WHY EVERY BILL IS RENAMED AND NOT JUST THE FORM.
   A filled-in detail is stored ON THE INSTANCE as {label, value} - it does not point back at the
   template it came from. So renaming the field on the form alone would leave every bill already
   filed still carrying a label called "Company", which nothing on screen looks for any more: the
   summary card, the step task's Description block and the Tracker column all match by label, and
   those bills would simply stop showing who they were from. Every place the label is written down
   is therefore renamed in the one migration - the form template, the bills already filed, the
   drafts nobody has submitted yet, the task-name builder, and the task names it has already
   produced.

   WHAT MAKES IT A DROPDOWN.
   flows.autocomplete_fields names the fields that offer back what has been typed into them before.
   There is no list for anyone to maintain: the form reads the values off this flow's own past
   instances every time it opens (wfEventOpen in accountability.js) and hangs them on the field as
   a datalist. Naming "Vendor" there is the whole of it - and because the bills above are renamed
   in the same migration, the dropdown is fully populated with every vendor ever entered the first
   time somebody opens the form, rather than starting empty and learning from scratch.
   It stays typeable: a vendor that has never been used before is entered as normal and is then in
   the list for everybody afterwards.

   WHY "COMPANY NAME" IS OPTIONAL.
   No bill filed before today has one. A required field is enforced on every save, including the
   save of an OLD bill somebody opens to correct a typo - so requiring it would block edits to more
   than a hundred bills until each was given a value. It can be made required later, once the
   backlog has been filled in, by setting "optional" to false on that entry.

   Safe to run twice: every statement is guarded on what it is about to change. */

-- ---------------------------------------------------------------------------------------------
-- 1. The form itself.
-- ---------------------------------------------------------------------------------------------
update acc.flows f
   set trigger_template = (
        select jsonb_agg(case when e->>'label' = 'Company'
                              then jsonb_set(e, '{label}', '"Vendor"'::jsonb)
                              else e end order by ord)
          from jsonb_array_elements(f.trigger_template) with ordinality as t(e, ord))
 where f.id = 26
   and jsonb_typeof(f.trigger_template) = 'array'
   and f.trigger_template @> '[{"label":"Company"}]'::jsonb;

-- ---------------------------------------------------------------------------------------------
-- 2. The bills already filed, so their company survives the rename.
-- ---------------------------------------------------------------------------------------------
update acc.flow_cases c
   set trigger_details = (
        select jsonb_agg(case when e->>'label' = 'Company'
                              then jsonb_set(e, '{label}', '"Vendor"'::jsonb)
                              else e end order by ord)
          from jsonb_array_elements(c.trigger_details) with ordinality as t(e, ord))
 where c.flow_id = 26
   and jsonb_typeof(c.trigger_details) = 'array'
   and c.trigger_details @> '[{"label":"Company"}]'::jsonb;

-- ---------------------------------------------------------------------------------------------
-- 3. Drafts - started, not yet submitted. They reopen into the same form and would otherwise come
--    back with an orphaned "Company" row the form no longer knows what to do with.
-- ---------------------------------------------------------------------------------------------
update acc.flow_drafts d
   set details = (
        select jsonb_agg(case when e->>'label' = 'Company'
                              then jsonb_set(e, '{label}', '"Vendor"'::jsonb)
                              else e end order by ord)
          from jsonb_array_elements(d.details) with ordinality as t(e, ord))
 where d.flow_id = 26
   and jsonb_typeof(d.details) = 'array'
   and d.details @> '[{"label":"Company"}]'::jsonb;

-- ---------------------------------------------------------------------------------------------
-- 4. The columns that NAME FIELDS rather than hold them - each one points at a label, so each one
--    has to move when the label does. They are walked as a list (below) rather than written out by
--    hand, because writing them out by hand is precisely how list_fields was missed first time.
--
--    Their base schema is not in this repo's migrations, so depending on when each was added they
--    are either text[] or a jsonb array. Read the actual type rather than assume one, so this runs
--    against either shape - and create autocomplete_fields if this deployment has never had it,
--    which is the case if the dropdown has never worked on any workflow.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_type text;
  v_col  text;
  /* Declared rather than written inline on the FOREACH: `foreach x in array[...]` does not parse,
     because FOREACH ... IN ARRAY already consumes the ARRAY keyword and the constructor is left
     as a bare `[...]`. */
  v_list_cols   text[] := array['task_fields','autocomplete_fields','list_fields','card_fields'];
  v_scalar_cols text[] := array['card_wide_field','tracker_sum_field','owner_resolve_field'];
begin
  /* EVERY column on acc.flows that holds FIELD LABELS, walked as a list rather than written out
     one at a time. The first cut of this migration named task_fields and autocomplete_fields by
     hand and missed list_fields - which is the one that names each bill in the Instances table, so
     every row went blank the moment the label moved. The failure was the hand-written list, not
     the rename, so the list is gone: add a column here and it is covered.

       task_fields         the order a task is named in
       autocomplete_fields which fields offer back what was typed before
       list_fields         what names an instance in the Instances table   <- the one that was missed
       card_fields         what the case-detail panel shows
       card_wide_field     the one field that spans the card (scalar)
       tracker_sum_field   the field the Tracker totals (scalar)
       owner_resolve_field the field a step's owner is looked up from (scalar)

     Null on this flow today for most of them, which is exactly why they must be handled blind:
     a flow that starts using one later must not quietly fall out of step again. */
  foreach v_col in array v_list_cols loop
    select data_type into v_type from information_schema.columns
     where table_schema='acc' and table_name='flows' and column_name=v_col;
    if v_type = 'ARRAY' then
      execute format('update acc.flows set %I = array_replace(%I, %L, %L) '
                     || 'where id = 26 and %I is not null and %L = any(%I)',
                     v_col, v_col, 'Company', 'Vendor', v_col, 'Company', v_col);
    elsif v_type = 'jsonb' then
      execute format(
        'update acc.flows f set %I = (select jsonb_agg(case when e = ''"Company"''::jsonb '
        || 'then ''"Vendor"''::jsonb else e end order by ord) '
        || 'from jsonb_array_elements(f.%I) with ordinality as t(e, ord)) '
        || 'where f.id = 26 and f.%I is not null and jsonb_typeof(f.%I) = ''array''',
        v_col, v_col, v_col, v_col);
    elsif v_type is not null then
      raise notice 'acc.flows.% is %, which this migration does not handle - rename Company to Vendor on flow 26 by hand', v_col, v_type;
    end if;
  end loop;

  -- The scalar ones name a single field rather than a list of them.
  foreach v_col in array v_scalar_cols loop
    select data_type into v_type from information_schema.columns
     where table_schema='acc' and table_name='flows' and column_name=v_col;
    if v_type in ('text','character varying') then
      execute format('update acc.flows set %I = %L where id = 26 and %I = %L',
                     v_col, 'Vendor', v_col, 'Company');
    end if;
  end loop;

  /* autocomplete_fields may not exist at all: it is only read, never written, by the app, so a
     deployment where no workflow has ever had a remembering field will not have the column.
     Created here if it is missing - and every statement that touches it goes through EXECUTE, so
     nothing has to resolve a column name that was not there when this block started. */
  select data_type into v_type from information_schema.columns
   where table_schema = 'acc' and table_name = 'flows' and column_name = 'autocomplete_fields';

  if v_type is null then
    execute 'alter table acc.flows add column autocomplete_fields text[]';
    v_type := 'ARRAY';
  end if;

  if v_type = 'ARRAY' then
    execute $q$
      update acc.flows
         set autocomplete_fields = (
              select array_agg(distinct v order by v)
                from unnest(array_remove(coalesce(autocomplete_fields, '{}'::text[]), 'Company')
                            || 'Vendor'::text) as u(v))
       where id = 26 $q$;
  elsif v_type = 'jsonb' then
    execute $q$
      update acc.flows f
         set autocomplete_fields = (
              select coalesce(jsonb_agg(to_jsonb(v) order by v), '[]'::jsonb)
                from (select x from jsonb_array_elements_text(
                                      coalesce(f.autocomplete_fields, '[]'::jsonb)) x
                       where x <> 'Company'
                      union
                      select 'Vendor') s(v))
       where f.id = 26 $q$;
  else
    raise notice 'acc.flows.autocomplete_fields is %, which this migration does not handle - add Vendor to flow 26 by hand or the dropdown will stay empty', v_type;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. The new field, placed directly after Vendor rather than at the end - the two are read
--    together and a form that asks for them at opposite ends of itself invites one to be missed.
--
--    Every entry keeps its own position (sub = 0); the new field is a second row carrying Vendor's
--    position and sub = 1, so ordering by (position, sub) drops it immediately after Vendor and
--    leaves everything else exactly where it was.
-- ---------------------------------------------------------------------------------------------
update acc.flows f
   set trigger_template = (
        select jsonb_agg(elem order by ord, sub)
          from (
                select e as elem, ord, 0 as sub
                  from jsonb_array_elements(f.trigger_template) with ordinality as t(e, ord)
                 union all
                select '{"label":"Company Name","type":"text","optional":true}'::jsonb, ord, 1
                  from jsonb_array_elements(f.trigger_template) with ordinality as t(e, ord)
                 where e->>'label' = 'Vendor'
               ) s)
 where f.id = 26
   and jsonb_typeof(f.trigger_template) = 'array'
   and f.trigger_template @> '[{"label":"Vendor"}]'::jsonb
   and not f.trigger_template @> '[{"label":"Company Name"}]'::jsonb;

-- ---------------------------------------------------------------------------------------------
-- 6. What a bill's task is CALLED. Same five parts in the same order - only the label the first
--    one is read from has changed. Company Name is deliberately NOT added here: the task name is
--    already five values long and it is the vendor, not the registered company name, that tells
--    one bill from another at a glance.
-- ---------------------------------------------------------------------------------------------
create or replace function acc.wf_task_desc_invoice(p_case_no integer, p_details jsonb)
 returns text
 language sql stable set search_path to 'acc','public'
as $function$
  with order_list(label, ord) as (
    values ('Vendor',1), ('__JAINE__',2), ('Bill Date',3), ('Bill No.',4), ('Amount',5)
  ),
  vals as (
    select d->>'label' as label, btrim(d->>'value') as value
      from jsonb_array_elements(coalesce(p_details,'[]'::jsonb)) d
    union all
    -- the id joins the list rather than being prefixed onto it
    select '__JAINE__', nullif(btrim(coalesce(p_case_no::text,'')),'')
  ),
  keep as (
    select o.ord,
           -- dates read the way the screen shows them, so the two cannot disagree
           case when v.value ~ '^\d{4}-\d{2}-\d{2}$'
                then substr(v.value,9,2)||'-'||substr(v.value,6,2)||'-'||substr(v.value,1,4)
                else v.value end as value
      from order_list o join vals v on v.label = o.label
     where coalesce(v.value,'') <> ''
  )
  select string_agg(value, ' · ' order by ord) from keep;
$function$;

-- ---------------------------------------------------------------------------------------------
-- 7. The names already written. Every screen reads this stored text rather than rebuilding it, so
--    without this pass the existing tasks would keep the name they were given when the field was
--    still called Company - which, now the label has moved, is a name with the vendor missing.
-- ---------------------------------------------------------------------------------------------
update acc.ptasks p
   set description = acc.wf_task_desc_invoice(fc.jaine_id, fc.trigger_details)
  from acc.flow_case_steps x
  join acc.flow_cases fc on fc.id = x.case_id
 where p.flow_case_step_id = x.id
   and fc.flow_id = 26
   and coalesce(btrim(acc.wf_task_desc_invoice(fc.jaine_id, fc.trigger_details)),'') <> ''
   and p.description is distinct from acc.wf_task_desc_invoice(fc.jaine_id, fc.trigger_details);
