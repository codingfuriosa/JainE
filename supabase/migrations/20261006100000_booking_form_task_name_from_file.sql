-- Booking Form Flow's form is attachment-only (restored to its 2 Oct shape), so there is no customer
-- name field to name a task from. The PDF's own file name usually carries it
-- ("Syed_feroz_Akhter_B6_1G_630sqft.pdf"), so tasks are named from that, with the step after it.
--
-- Three of the first 24 forms were uploaded under camera/scan names (WhatsApp Image, New Doc, Adobe
-- Scan) with no name in them; those, and any file name that is only digits, fall back to
-- "Booking Form No. <n>" rather than showing "WhatsApp Image 2026-09-13...". The block/unit that most
-- file names carry after the name is left in: it tells two bookings by the same person apart.
--
-- Wired the way Invoice Processing's naming is: acc.ptask_desc_from_flow (BEFORE INSERT / UPDATE OF
-- flow_case_step_id on acc.ptasks) builds the stored description, and the Tasks screen uses the stored
-- description for any flow with task_fields set (accountability.js wfRowTitle). task_fields here is
-- therefore only the switch that says "this flow names its own tasks" - the value is not a form field.

create or replace function acc.wf_task_desc_booking(p_case_no integer, p_details jsonb, p_step_title text)
 returns text
 language sql
 stable
 set search_path to 'acc', 'public'
as $function$
  with f as (
    select regexp_replace(split_part(btrim(d->>'value'), ',', 1), '^.*/', '') as base
      from jsonb_array_elements(coalesce(p_details, '[]'::jsonb)) d
     where d->>'label' = 'Attachment' and coalesce(d->>'value', '') <> ''
     limit 1
  ),
  cleaned as (
    select btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
             regexp_replace(regexp_replace(base, '^(\d{12,}_[A-Za-z0-9]+_)+', ''),   -- upload id prefix (a re-upload carries two)
                            '\.[A-Za-z0-9]{2,5}$', ''),                            -- extension
                            '[_+]+', ' ', 'g'),
                            ' +\.', '.', 'g'),                                     -- "Mr ." -> "Mr."
                            '\.(?=[A-Za-z])', '. ', 'g'),                          -- "Mr.Das" -> "Mr. Das"
                            '\s+', ' ', 'g'),
                            '^\s+|\s+$', '', 'g')) as nm
      from f
  )
  select coalesce(
           case when nm is null or nm = ''
                  or nm ~* '^(whatsapp|new doc|adobe scan|scan|scanned|camscanner|img|image|screenshot|document|doc|photo|pxl|dsc)\M'
                  or nm ~ '^[0-9 .()-]*$'
                then null else nm end,
           'Booking Form No. ' || coalesce(p_case_no::text, '')
         ) || case when coalesce(btrim(p_step_title), '') <> '' then ' · ' || btrim(p_step_title) else '' end
    from (select 1) one left join cleaned on true;
$function$;

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
    v_txt := acc.wf_task_desc_invoice(v_case.jaine_id, v_case.trigger_details);
  elsif v_flow.id = 41 then
    v_txt := acc.wf_task_desc_booking(v_case.case_no, v_case.trigger_details,
                                      (select title from acc.flow_case_steps where id = new.flow_case_step_id));
  elsif v_flow.task_fields is not null then      -- only flows that state an order; everyone else unchanged
    v_txt := acc.wf_task_desc(v_flow.id, v_case.trigger_details);
  else
    return new;
  end if;

  if coalesce(btrim(v_txt),'') <> '' then new.description := v_txt; end if;
  return new;
end; $function$;

-- Switch for the Tasks screen (see header). Same row the 2 Oct form restore left at null.
update acc.flows set task_fields = array['Attachment'], updated_at = now() where id = 41;

-- Name the tasks already raised: re-touching flow_case_step_id fires the trigger above for each.
update acc.ptasks t
   set flow_case_step_id = t.flow_case_step_id
  from acc.flow_case_steps s
  join acc.flow_cases c on c.id = s.case_id
 where t.flow_case_step_id = s.id and c.flow_id = 41;
