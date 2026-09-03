/* Reimbursement: "Print new receipts" - a one-click bulk print of every claim Accounts (step 2)
   has just received, excluding anything already printed by this tool before, so re-running it
   later never reprints the same claim. Column is flow-agnostic (any workflow's instances could use
   the same "printed once, don't reprint" tracking later); the button that triggers it is
   Reimbursement-only, matching what was actually asked for. */

alter table acc.flow_cases add column if not exists bulk_printed_at timestamptz;

create or replace function acc.wf_mark_bulk_printed(p_ids bigint[])
 returns void
 language plpgsql
 security definer
 set search_path to 'acc', 'public'
as $function$
declare v_email text := app.current_user_email();
begin
  if v_email is null then raise exception 'not signed in'; end if;
  -- Only marks cases where the caller is actually a candidate on that case's OWN step 2 - someone
  -- who never had any business with this claim cannot silently make it stop appearing for the
  -- people who do.
  update acc.flow_cases fc
     set bulk_printed_at = now()
   where fc.id = any(p_ids)
     and exists (
       select 1 from acc.flow_case_steps fcs
        where fcs.case_id = fc.id and fcs.seq = 2
          and (lower(coalesce(fcs.person,'')) = lower(v_email)
               or lower(v_email) = any(select lower(btrim(x)) from unnest(coalesce(fcs.candidates,'{}')) x))
     );
end;
$function$;

grant execute on function acc.wf_mark_bulk_printed(bigint[]) to authenticated;
