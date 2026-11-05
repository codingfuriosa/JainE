-- INVOICE PROCESSING: NO BOOKING ENTRY STEP (5 Nov 2026, as asked: "remove it - in No Cheque after RTP
-- there will be Cheque Preparation").
--
-- Booking Entry (seq 13, 27 Oct 2026) stood after RTP on the Payment - No Cheque path only, and showed
-- as the last column of every bill because it was the 13th step made. Payment - No Cheque now goes
--   RTP -> Cheque Preparation (Arun / Bachchu) -> Bill Checking -> Audit Checking -> Bill Filing
-- and the step is removed from the workflow. No bill had ever taken that path or held a step 13
-- (checked 5 Nov 2026), so no running or finished bill changes.

update acc.flow_routes
   set seqs = array[1,2,5,7,3,4,12], skipped = array[6,8,9,10,11]
 where flow_id = 26 and route = 'payment_no_cheque';

-- every other route listed 13 among the steps it skips
update acc.flow_routes
   set skipped = array_remove(skipped, 13)
 where flow_id = 26 and 13 = any(skipped);

-- and every bill on Cheque / No Cheque was marked to show it as NA
update acc.flow_cases
   set skipped_seqs = array_remove(skipped_seqs, 13)
 where flow_id = 26 and 13 = any(coalesce(skipped_seqs, '{}'));

do $$
begin
  if exists (select 1 from acc.flow_case_steps s join acc.flow_cases c on c.id = s.case_id
              where c.flow_id = 26 and s.seq = 13) then
    raise exception 'a bill holds a Booking Entry step - not removing it';
  end if;
  delete from acc.flow_steps where flow_id = 26 and seq = 13 and title = 'Booking Entry';
end $$;
