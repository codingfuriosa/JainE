-- businessanalyst@ was given the "Print New Reimbursements" button (accountability.js canPrintBulk)
-- without being made a step-2 owner/candidate again (she was deliberately removed as a Reimbursement
-- co-owner earlier). Without this, her prints would never get marked done here, and the same claims
-- would resurface as "new" for whoever prints next. Scoped to Reimbursement (flow 39) specifically -
-- this function is shared by any future flow's bulk-print, and she should not get mark-rights there.
create or replace function acc.wf_mark_bulk_printed(p_ids bigint[])
 returns void
 language plpgsql
 security definer
 set search_path to 'acc', 'public'
as $function$
declare v_email text := app.current_user_email();
begin
  if v_email is null then raise exception 'not signed in'; end if;
  update acc.flow_cases fc
     set bulk_printed_at = now()
   where fc.id = any(p_ids)
     and (
       (fc.flow_id = 39 and lower(v_email) = 'businessanalyst@thejaingroup.com')
       or exists (
         select 1 from acc.flow_case_steps fcs
          where fcs.case_id = fc.id and fcs.seq = 2
            and (lower(coalesce(fcs.person,'')) = lower(v_email)
                 or lower(v_email) = any(select lower(btrim(x)) from unnest(coalesce(fcs.candidates,'{}')) x))
       )
     );
end;
$function$;
