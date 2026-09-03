/* JainE id display drops the "J" prefix - just the bare number now. */

create or replace function acc.wf_task_desc_invoice(p_case_no int, p_details jsonb)
 returns text
 language sql
 stable
 set search_path to 'acc', 'public'
as $function$
  with order_list(label, ord) as (
    values ('Bill No.',1), ('Bill Date',2), ('Company',3), ('Amount',4)
  ),
  vals as (
    select d->>'label' as label, btrim(d->>'value') as value
      from jsonb_array_elements(coalesce(p_details,'[]'::jsonb)) d
  ),
  keep as (
    select o.ord,
           case when v.value ~ '^\d{4}-\d{2}-\d{2}$'
                then substr(v.value,9,2)||'-'||substr(v.value,6,2)||'-'||substr(v.value,1,4)
                else v.value end as value
      from order_list o join vals v on v.label = o.label
     where coalesce(v.value,'') <> ''
  )
  select p_case_no::text || coalesce((select ' · '||string_agg(value,' · ' order by ord) from keep), '');
$function$;

-- Re-stamp already-created Invoice Processing task descriptions without the "J" prefix.
update acc.ptasks p
   set description = acc.wf_task_desc_invoice(fc.jaine_id, fc.trigger_details)
  from acc.flow_case_steps x
  join acc.flow_cases fc on fc.id = x.case_id
 where p.flow_case_step_id = x.id
   and fc.flow_id = 26
   and coalesce(btrim(acc.wf_task_desc_invoice(fc.jaine_id, fc.trigger_details)),'') <> '';
