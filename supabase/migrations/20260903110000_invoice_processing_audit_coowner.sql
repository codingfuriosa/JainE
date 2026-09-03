-- Invoice Processing: audit@thejaingroup.com joins Anubhav Sarkhel (audit3@thejaingroup.com) as
-- co-owner of "Audit Checking" (seq 4). No case is currently sitting at this step with an active
-- task, so nothing needs backfilling on acc.flow_case_steps - wf_forward re-pulls owner_emails from
-- this table fresh every time a case advances into the step, same as the existing two-owner
-- precedent on "Cheque Signing" (seq 9).
update acc.flow_steps
   set owner_emails = array['audit3@thejaingroup.com','audit@thejaingroup.com']
 where flow_id = 26 and seq = 4;
