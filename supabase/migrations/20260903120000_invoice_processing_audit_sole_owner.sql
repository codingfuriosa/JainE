-- Invoice Processing: audit@thejaingroup.com becomes sole owner of "Audit Checking" (seq 4),
-- replacing the co-ownership with Anubhav Sarkhel (audit3@thejaingroup.com) set up earlier today.
-- No case is currently sitting at this step with an active task, so nothing needs backfilling on
-- acc.flow_case_steps - wf_forward re-pulls owner_emails from this table fresh every time a case
-- advances into the step.
update acc.flow_steps
   set owner_email = 'audit@thejaingroup.com',
       owner_emails = array['audit@thejaingroup.com']
 where flow_id = 26 and seq = 4;
