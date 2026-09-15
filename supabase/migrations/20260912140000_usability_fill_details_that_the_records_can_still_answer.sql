/* Usability: fill in the Details the records can still answer for - and no more than that.

   A blank Details column has three different causes, and only one of them is a fault:

     A. Opening a screen. 984 events, every one blank, and correctly so. "View completed/archived
        tasks" is the act of looking; there is no task, no document, no person involved. The Tab
        column already says where the person was. There is nothing in the database to fill in
        because nothing specific happened.

     B. A search or a filter. 340 events, 148 blank. Nobody anywhere records "X searched for Y", so
        the past is gone. The newer logging already captures the typed query, and the filter and
        date-range buttons now capture their own choice too, so this empties out from here on.

     C. Previewing, downloading, printing, opening a month. 138 events, 131 blank. Same shape: the
        act leaves no row behind. These now capture what was opened at the moment it is opened -
        the document's name, the test, the job description, the month.

     D. Acting on a record. 4,606 events, only 270 blank. This is the one worth chasing, and this
        migration chases what is still reachable: 16 folder creations, 10 document uploads and 7
        sub-task additions get their names back from the records they created.

   What is deliberately NOT filled: 171 older Workflow events (receive a step, print an instance,
   post an update, mark final step done). Three routes were tried - the step's own received_at, the
   notification each move sends, and the instance's update trail - and between them they identified
   barely twenty. The steps have been forwarded on since and only 297 of 1,671 still carry a
   received_at at all. Putting a plausible-looking workflow name against somebody's real action
   would be worse than the dash, because a wrong answer is read as a right one. Events logged from
   10 September onwards already carry the workflow, the instance and the step in full.

   Each event takes the single NEAREST source row written by the same person within two minutes, so
   two actions close together are never merged into one blurred answer. */

update public.erp_usage_events e
   set meta = coalesce(e.meta,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('folder',
         (select f.name from doc.folders f
           where lower(f.created_by) = lower(e.user_email)
             and f.created_at between e.occurred_at - interval '2 minutes' and e.occurred_at + interval '2 minutes'
           order by abs(extract(epoch from (f.created_at - e.occurred_at))) limit 1)))
 where e.feature_key = 'legal.documents.add_folder_sub_category'
   and e.user_email is not null
   and not exists (select 1 from jsonb_object_keys(coalesce(e.meta,'{}')) k where k not in ('backfill','ref'))
   and exists (select 1 from doc.folders f
                where lower(f.created_by) = lower(e.user_email) and f.name is not null
                  and f.created_at between e.occurred_at - interval '2 minutes' and e.occurred_at + interval '2 minutes');

update public.erp_usage_events e
   set meta = coalesce(e.meta,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
         'title', (select coalesce(d.title, d.file_name) from doc.documents d
                    where lower(d.uploaded_by) = lower(e.user_email)
                      and d.created_at between e.occurred_at - interval '2 minutes' and e.occurred_at + interval '2 minutes'
                    order by abs(extract(epoch from (d.created_at - e.occurred_at))) limit 1),
         'category', (select d.category from doc.documents d
                    where lower(d.uploaded_by) = lower(e.user_email)
                      and d.created_at between e.occurred_at - interval '2 minutes' and e.occurred_at + interval '2 minutes'
                    order by abs(extract(epoch from (d.created_at - e.occurred_at))) limit 1)))
 where e.feature_key = 'legal.documents.upload_document'
   and e.user_email is not null
   and not exists (select 1 from jsonb_object_keys(coalesce(e.meta,'{}')) k where k not in ('backfill','ref'))
   and exists (select 1 from doc.documents d
                where lower(d.uploaded_by) = lower(e.user_email)
                  and d.created_at between e.occurred_at - interval '2 minutes' and e.occurred_at + interval '2 minutes');

update public.erp_usage_events e
   set meta = coalesce(e.meta,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
         'title', (select t.title from acc.ptask_subtasks st join acc.ptasks t on t.id = st.task_id
                    where lower(st.created_by) = lower(e.user_email)
                      and st.created_at between e.occurred_at - interval '2 minutes' and e.occurred_at + interval '2 minutes'
                    order by abs(extract(epoch from (st.created_at - e.occurred_at))) limit 1),
         'item', (select st.title from acc.ptask_subtasks st
                    where lower(st.created_by) = lower(e.user_email)
                      and st.created_at between e.occurred_at - interval '2 minutes' and e.occurred_at + interval '2 minutes'
                    order by abs(extract(epoch from (st.created_at - e.occurred_at))) limit 1)))
 where e.feature_key = 'tasks.tasks.add_checklist_sub_task_item'
   and e.user_email is not null
   and not exists (select 1 from jsonb_object_keys(coalesce(e.meta,'{}')) k where k not in ('backfill','ref'))
   and exists (select 1 from acc.ptask_subtasks st
                where lower(st.created_by) = lower(e.user_email)
                  and st.created_at between e.occurred_at - interval '2 minutes' and e.occurred_at + interval '2 minutes');
