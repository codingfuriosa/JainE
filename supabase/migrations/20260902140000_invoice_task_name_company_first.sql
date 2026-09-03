/* Company, JainE id, Bill Date, Bill No., Amount - values only.

   The JainE id used to be glued on the front as a prefix, outside the ordering. It now sits in the
   ordered list like every other part, which is what lets it be moved at all: the whole name is one
   list with one order, so changing it again later is editing five rows rather than unpicking a
   prefix from a concatenation.

   Company leads because it is what tells one bill from another at a glance - the id and the bill
   number are references you look up once you already know which bill you want.

   Applied alongside this, and deliberately not in the file because it is data: all 28 existing
   Invoice Processing tasks were rewritten to the new order. The screens read this stored text
   rather than rebuilding it, so the list, the task page, the calendar and the email all followed
   with nothing further to change. */
create or replace function acc.wf_task_desc_invoice(p_case_no integer, p_details jsonb)
 returns text
 language sql stable set search_path to 'acc','public'
as $function$
  with order_list(label, ord) as (
    values ('Company',1), ('__JAINE__',2), ('Bill Date',3), ('Bill No.',4), ('Amount',5)
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
