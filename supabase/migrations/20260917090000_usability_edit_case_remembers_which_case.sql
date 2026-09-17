/* Usability: name the case behind 12 "Edit case" rows that only said somebody edited something.

   Those 12 events carry no meta at all. They are real clicks, not reconstruction - they simply
   predate 14 Sep (b35ff92), when misUpdate was given usbMisMeta and started recording which case
   was open. Both columns were blank on every one of them.

   The case itself is still there, and it timestamps its own last save. mis_cases.updated_at lands
   within ONE SECOND of the click on ten of the twelve - the click and the save are the same act,
   so a match that tight is identification, not correlation. Each of those ten matched exactly one
   case; none was ambiguous.

   The window is deliberately two seconds. A looser one (two minutes) appeared to rescue an
   eleventh, but it was the same case a later event had already claimed: mis_cases keeps only the
   LAST save, so an earlier edit of a case that was edited again has had its timestamp overwritten
   and cannot be proven. Two rows are therefore left blank on purpose:

     id 9559 - 70s from a save that belongs to the event after it (same case, same person, but the
               evidence is circumstantial and this table is not the place for a good guess)
     id 9566 - no case within range at all; its case was edited again later

   Also checked and deliberately NOT attempted: "Delete document(s)". Its one event looked
   recoverable at a three-minute window, but the document that matched was CREATED 97 seconds
   AFTER the click - a different file being uploaded, not the one deleted. doc.documents has no
   deleted_at, so the deleted row is simply gone. A near-miss in time is not evidence. */

update public.erp_usage_events e
   set meta = coalesce(e.meta,'{}'::jsonb)
            || jsonb_strip_nulls(jsonb_build_object(
                 'title',   nullif(coalesce(m.cause_title, m.case_no),''),
                 'case_no', nullif(m.case_no,''),
                 'court',   nullif(m.court,'')))
  from (
    select e2.id as ev, c.case_no, c.court, c.cause_title,
           count(*) over (partition by e2.id) as n
      from public.erp_usage_events e2
      join public.mis_cases c
        on abs(extract(epoch from (c.updated_at - e2.occurred_at))) <= 2
     where e2.feature_key = 'legal.mis.edit_case'
       and not (coalesce(e2.meta,'{}'::jsonb) ? 'case_no')
  ) m
 where e.id = m.ev
   and m.n = 1;   -- only where exactly one case can be the answer
