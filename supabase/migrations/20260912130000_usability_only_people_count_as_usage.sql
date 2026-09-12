/* Usability: a bulk import is not somebody using the portal.

   1,636 events are attributed to things that are not people. They came in with the first
   reconstruction, which took whoever the source row named as its actor - and for documents loaded
   in bulk that field holds a label, not an address:

     import                            1,229   Legal documents, folders, case files
     jain group                          337   Legal documents
     system                               55   Legal document folders
     system: folded into the lead row     13   Transcription, deleted calls
     careers page                          2   HR resumes

   This is the honest answer to why Legal reads as the busiest module in the company. It is not that
   five people upload two thousand documents; it is that a one-off migration loaded them and the
   reconstruction counted the migration as a user. The report then shows those rows in the People
   column and in every count, and there is no person behind any of them.

   Null-email rows were excluded from the report for exactly this reason back in September - the
   note there says they "can never be attributed to a real person". These are the same thing wearing
   a name, and they deserve the same treatment. Archived rather than deleted, as with every other
   correction in this series.

   The rule is deliberately narrow: an actor with no "@" in it is not an address and cannot be a
   person. Two real addresses in the table belong to nobody in adm.users any more
   (sales.dreamgurukul1@, s.khetan22@) - those are people who have left or were never enrolled, and
   their three events stay. Losing a departed colleague's history would be the same mistake in the
   opposite direction. */

create table if not exists public.erp_usage_events_removed_20260912_nonhuman
  (like public.erp_usage_events including defaults);

insert into public.erp_usage_events_removed_20260912_nonhuman
select ev.* from public.erp_usage_events ev
 where ev.user_email is not null
   and position('@' in ev.user_email) = 0
   and not exists (select 1 from public.erp_usage_events_removed_20260912_nonhuman r where r.id = ev.id);

delete from public.erp_usage_events ev
 where exists (select 1 from public.erp_usage_events_removed_20260912_nonhuman r where r.id = ev.id);

/* While we are here: the department stamped on each event comes from acc.user_profile, but the
   departments the Usability filter offers are read from adm.users - and the two disagree. Every one
   of the 85 people in adm.users has a department; four profiles do not. That mismatch is why events
   arrive with no department and then vanish when somebody filters by one.
   Filling in what is missing from adm.users, which is the list the filter itself is built from. */
update public.erp_usage_events e
   set department = (u.department)[1]
  from adm.users u
 where e.department is null
   and e.user_email is not null
   and lower(u.email) = lower(e.user_email)
   and coalesce(cardinality(u.department), 0) > 0;
