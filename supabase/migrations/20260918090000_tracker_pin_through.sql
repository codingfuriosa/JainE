/* How far along the Tracker's left-hand block the pinning reaches.

   The pinned columns have to be a contiguous run from the left edge - that is what "sticky" means
   in a table - so the only thing there is to choose is where the run STOPS. This names the last
   column it includes, by label, and everything after it scrolls with the steps.

   Null, which is every other workflow, keeps the whole instance block pinned, exactly as before.

   Invoice Processing stops at Vendor: the block had grown to eight columns once Company Name
   joined it, which is a lot of a laptop screen to spend on columns you are not reading, and the
   company's registered name is not what anybody identifies a bill by - the vendor and the bill
   number are. So Company Name and Amount scroll along with the steps.

   Named by LABEL rather than by a count so that reordering the form cannot silently move the
   boundary onto a different column. */
alter table acc.flows
  add column if not exists tracker_pin_through text;

comment on column acc.flows.tracker_pin_through is
  'Tracker: label of the last left-hand column to stay pinned when scrolling sideways. Null pins the whole instance block.';

update acc.flows set tracker_pin_through = 'Vendor' where id = 26;
