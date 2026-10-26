-- Challan Processing's tasks said only "Challan Processing: Receive Challan at HO - <challan no.>",
-- where an Invoice Processing task leads with the vendor and the JainE id. Gives Challan the same
-- shape: Company · Challan Id · Challan Date · Challan No. - the company first, then the id the
-- workflow counts its challans by (acc.flow_cases.case_no, shown as "Challan Id"), the date as
-- DD-MM-YYYY, then the challan's own number. Challan has no JainE id of its own (jaine_id is
-- assigned to Invoice Processing alone), so Challan Id sits where the JainE id does on a bill.
--
-- Wired exactly as Invoice's naming is: acc.ptask_desc_from_flow (BEFORE INSERT / UPDATE OF
-- flow_case_step_id on acc.ptasks) builds the stored description, and the Tasks screen reads the
-- stored description for any flow with task_fields set (accountability.js wfRowTitle), so the
-- Tasks list, the task page title, the calendar and the assignment email all show the same text.
-- task_fields on flow 40 is only that switch; the values are not taken from it.
--
-- Additive: the Invoice, Booking Form and every other flow's branches are copied unchanged.

create or replace function acc.wf_task_desc_challan(p_case_no integer, p_details jsonb)
 returns text
 language sql
 stable
 set search_path to 'acc', 'public'
as $function$
  with order_list(label, ord) as (
    values ('Company',1), ('__ID__',2), ('Challan Date',3), ('Challan No.',4)
  ),
  vals as (
    select d->>'label' as label, btrim(d->>'value') as value
      from jsonb_array_elements(coalesce(p_details,'[]'::jsonb)) d
    union all
    select '__ID__', nullif(btrim(coalesce(p_case_no::text,'')),'')
  ),
  keep as (
    select o.ord,
           case when v.value ~ '^\d{4}-\d{2}-\d{2}$'
                then substr(v.value,9,2)||'-'||substr(v.value,6,2)||'-'||substr(v.value,1,4)
                else v.value end as value
      from order_list o join vals v on v.label = o.label
     where coalesce(v.value,'') <> ''
  )
  select string_agg(value, ' · ' order by ord) from keep;
$function$;

create or replace function acc.ptask_desc_from_flow()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'acc', 'public'
as $function$
declare v_flow acc.flows; v_case acc.flow_cases; v_txt text;
begin
  if new.flow_case_step_id is null then return new; end if;
  select fc.* into v_case from acc.flow_case_steps x join acc.flow_cases fc on fc.id = x.case_id
   where x.id = new.flow_case_step_id;
  if not found then return new; end if;
  select * into v_flow from acc.flows where id = v_case.flow_id;
  if not found then return new; end if;

  if v_flow.id = 26 then
    v_txt := acc.wf_task_desc_invoice(v_case.jaine_id, v_case.trigger_details);
  elsif v_flow.id = 41 then
    v_txt := acc.wf_task_desc_booking(v_case.case_no, v_case.trigger_details,
                                      (select title from acc.flow_case_steps where id = new.flow_case_step_id));
  elsif v_flow.id = 40 then
    v_txt := acc.wf_task_desc_challan(v_case.case_no, v_case.trigger_details);
  elsif v_flow.task_fields is not null then
    v_txt := acc.wf_task_desc(v_flow.id, v_case.trigger_details);
  else
    return new;
  end if;

  if coalesce(btrim(v_txt),'') <> '' then new.description := v_txt; end if;
  return new;
end; $function$;

-- the switch that makes the Tasks screen use the stored description (see header)
update acc.flows set task_fields = array['Company','Challan Date','Challan No.'], updated_at = now() where id = 40;

-- name the tasks already raised: re-touching flow_case_step_id fires the trigger for each
update acc.ptasks t
   set flow_case_step_id = t.flow_case_step_id
  from acc.flow_case_steps s
  join acc.flow_cases c on c.id = s.case_id
 where t.flow_case_step_id = s.id and c.flow_id = 40;
