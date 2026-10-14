-- Puts Booking Form Flow's form back to exactly what it was on 2 Oct 2026: one required Attachment
-- field (multi), and no task_fields / list_fields ordering. Undoes both the Customer Name field added
-- on 3 Oct (20261003090000_booking_form_flow_customer_name.sql) and the later, untracked edit on
-- 5 Oct 13:51 UTC that replaced the form with Booking Date / Customer Name / Service Type and dropped
-- the attachment. Every other column on the flow row was already identical to 2 Oct and is untouched.
-- Instances raised under the 5 Oct form keep the details they were saved with.
update acc.flows
   set trigger_template = '[{"type":"attachment","label":"Attachment","multi":true,"optional":false}]'::jsonb,
       task_fields = null,
       list_fields = null,
       updated_at = now()
 where id = 41;
