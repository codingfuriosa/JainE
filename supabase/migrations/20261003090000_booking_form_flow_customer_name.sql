-- Booking Form Flow's only form field was the attachment, so every task it created was named just
-- "Booking Form Flow" with nothing to tell one booking from another except the PDF's file name.
-- Adds a required Customer Name field ahead of the attachment and names it in task_fields, so
-- acc.ptask_desc_from_flow / acc.wf_task_desc put it first in every task this flow creates (the
-- same mechanism Invoice Processing uses for Vendor). list_fields does the same for the
-- Booking Forms table. Instances raised before this have no customer name; their task text is
-- left as it was (the trigger only overwrites a description when it has something to say).
update acc.flows
   set trigger_template = '[{"type":"text","label":"Customer Name"},{"type":"attachment","label":"Attachment","multi":true,"optional":false}]'::jsonb,
       task_fields = array['Customer Name'],
       list_fields = array['Customer Name'],
       updated_at = now()
 where id = 41;
