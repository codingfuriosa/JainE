/* The Step Task page's own body already shows bare values led by the JainE id (see
   wfInvoiceTaskDetailsHtml in accountability.js). But ptasks.description - what actually shows
   in the Tasks list/preview - is stamped server-side by the ptask_desc_from_flow trigger, which
   calls the generic wf_task_desc() and never went near that JS fix. For Invoice Processing that
   still produced "Company: META · Bill Date: ... · Amount: ... · Bill No.: ...", labels and all,
   for every step's task - including Dept Check, whose task is inserted directly when the case is
   raised rather than through wf_forward.

   wf_task_desc() itself is left untouched - every other workflow that relies on it keeps exactly
   the labeled format it already has. Only the trigger gains a flow-26 branch. */

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
  select 'J'||p_case_no::text || coalesce((select ' · '||string_agg(value,' · ' order by ord) from keep), '');
$function$;

grant execute on function acc.wf_task_desc_invoice(int, jsonb) to authenticated, service_role;

create or replace function acc.ptask_desc_from_flow()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'acc', 'public'
as $function$
declare v_flow acc.flows; v_case acc.flow_cases; v_txt text;
begin
  if new.flow_case_step_id is null then return new; end if;   -- an ordinary task, left alone
  select fc.* into v_case from acc.flow_case_steps x join acc.flow_cases fc on fc.id = x.case_id
   where x.id = new.flow_case_step_id;
  if not found then return new; end if;
  select * into v_flow from acc.flows where id = v_case.flow_id;
  if not found then return new; end if;

  if v_flow.id = 26 then
    v_txt := acc.wf_task_desc_invoice(v_case.case_no, v_case.trigger_details);
  elsif v_flow.task_fields is not null then      -- only flows that state an order; everyone else unchanged
    v_txt := acc.wf_task_desc(v_flow.id, v_case.trigger_details);
  else
    return new;
  end if;

  if coalesce(btrim(v_txt),'') <> '' then new.description := v_txt; end if;
  return new;
end; $function$;

-- Backfill the descriptions already stamped with the old labeled format for live Invoice Processing tasks.
update acc.ptasks p
   set description = acc.wf_task_desc_invoice(fc.case_no, fc.trigger_details)
  from acc.flow_case_steps x
  join acc.flow_cases fc on fc.id = x.case_id
 where p.flow_case_step_id = x.id
   and fc.flow_id = 26
   and coalesce(btrim(acc.wf_task_desc_invoice(fc.case_no, fc.trigger_details)),'') <> '';
