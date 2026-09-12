/* Usability: fill the Accountability hole, 1 June - 12 September 2026.

   The earlier reconstruction stopped at 26 August; live click-recording for these features only
   began on 9-10 September. Everything in between is missing from the report even though it plainly
   happened - 143 tasks created by 19 different people, and the matching submits, approvals, edits,
   comments and attachments alongside them. A person who filed a task on 1 September reads in the
   report as somebody who last created one on 7 August.

   Each row here is reconstructed from the record the action itself left behind - the task, its
   activity trail, its comments, its files, its sub-tasks - so the actor and the minute are the real
   ones, not an estimate.

   Two separate guards against counting anything twice:
     - ref, the pointer back to the source row, is the same shape the first reconstruction used, so
       a row it already produced is skipped rather than duplicated.
     - live events carry no ref, so ref alone cannot see them. Any source row that already has a
       real logged event from the same person, for the same feature, within two minutes either side
       is left alone too. Workflow is the case that matters: it has been recording live since
       August, so almost nothing there needs reconstructing and nothing there gets doubled.

   Everything inserted is marked backfill:true, exactly as before, so the report can always separate
   "we reconstructed this" from "somebody clicked this and we saw it". */

/* ---- 1. Tasks created -------------------------------------------------------------------------
   Only tasks a person actually filed: a workflow step materialises a task of its own and a
   sub-task is its own feature, so neither is a "create task" and both are excluded (the same rule
   the live logging follows). */
insert into public.erp_usage_events (feature_key, action, user_email, department, occurred_at, meta, module_id)
select 'tasks.tasks.create_task', 'create', t.created_by, (u.department)[1], t.created_at,
       jsonb_strip_nulls(jsonb_build_object(
         'title', nullif(trim(t.title),''),
         'assignee', (select string_agg(coalesce(au.full_name, a.email), ', ')
                        from acc.ptask_assignees a
                        left join adm.users au on lower(au.email) = lower(a.email)
                       where a.task_id = t.id),
         'backfill', true,
         'ref', 'ptask.new:'||t.id)),
       'tasks'
  from acc.ptasks t
  left join adm.users u on lower(u.email) = lower(t.created_by)
 where t.created_by is not null
   and t.flow_case_step_id is null
   and t.parent_task_id is null
   and (t.created_at at time zone 'Asia/Kolkata')::date between '2026-06-01' and '2026-09-12'
   and not exists (select 1 from public.erp_usage_events x where x.meta->>'ref' = 'ptask.new:'||t.id)
   and not exists (select 1 from public.erp_usage_events y where y.feature_key = 'tasks.tasks.create_task' and lower(y.user_email) = lower(t.created_by) and y.occurred_at between t.created_at - interval '2 minutes' and t.created_at + interval '2 minutes');

/* ---- 2. Everything the task activity trail recorded --------------------------------------------
   One trail row = one thing a person did to a task. The verb it stores maps onto the catalogue the
   same way the first reconstruction mapped it; 'completed' is deliberately left out because the
   submit and the approval either side of it are already counted, and counting it as well would
   report one finished task as three. */
insert into public.erp_usage_events (feature_key, action, user_email, department, occurred_at, meta, module_id)
select fk.key, fk.verb, a.actor, (u.department)[1], a.created_at,
       jsonb_strip_nulls(jsonb_build_object(
         'title', nullif(trim(t.title),''),
         'detail', nullif(trim(a.detail),''),
         'backfill', true,
         'ref', 'pa:'||a.id)),
       'tasks'
  from acc.ptask_activity a
  join acc.ptasks t on t.id = a.task_id
  left join adm.users u on lower(u.email) = lower(a.actor)
  cross join lateral (
    select case
      when a.action = 'submitted'        then 'tasks.tasks.mark_task_done_send_for_approval'
      when a.action = 'approved'         then 'tasks.tasks.approve_a_completed_task'
      when a.action = 'declined'         then 'tasks.tasks.decline_a_completed_task'
      when a.action = 'delegated'        then 'tasks.tasks.delegate_task_to_someone'
      when a.action = 'due date changed' then 'tasks.tasks.edit_task_due_date'
      when a.action in ('reopened','reverted') then 'tasks.tasks.revert_reopen_a_task'
      when a.action = 'edited' and a.detail ilike 'renamed to%'   then 'tasks.tasks.edit_task_title'
      when a.action = 'edited' and a.detail ilike 'moved it to %' then 'tasks.tasks.edit_task_project'
      when a.action = 'edited'                                    then 'tasks.tasks.edit_task_description'
    end as key,
    -- every one of these is a change of state on an existing task, which is the vocabulary's
    -- 'update' - the same verb the live wrappers derive for them from their own function names
    'update' as verb
  ) fk
 where fk.key is not null
   and a.actor is not null
   and (a.created_at at time zone 'Asia/Kolkata')::date between '2026-06-01' and '2026-09-12'
   and not exists (select 1 from public.erp_usage_events x where x.meta->>'ref' = 'pa:'||a.id)
   and not exists (select 1 from public.erp_usage_events y where y.feature_key = fk.key and lower(y.user_email) = lower(a.actor) and y.occurred_at between a.created_at - interval '2 minutes' and a.created_at + interval '2 minutes');

/* ---- 3. Comments on a task --------------------------------------------------------------------
   system rows are the trail talking to itself, not a person writing a comment. */
insert into public.erp_usage_events (feature_key, action, user_email, department, occurred_at, meta, module_id)
select 'tasks.tasks.comment_on_a_task', 'create', c.author, (u.department)[1], c.created_at,
       jsonb_strip_nulls(jsonb_build_object(
         'title', nullif(trim(t.title),''),
         'comment', nullif(left(regexp_replace(c.body, '\s+', ' ', 'g'), 140),''),
         'backfill', true,
         'ref', 'pcm:'||c.id)),
       'tasks'
  from acc.ptask_comments c
  join acc.ptasks t on t.id = c.task_id
  left join adm.users u on lower(u.email) = lower(c.author)
 where c.author is not null
   and coalesce(c.system,false) = false
   and (c.created_at at time zone 'Asia/Kolkata')::date between '2026-06-01' and '2026-09-12'
   and not exists (select 1 from public.erp_usage_events x where x.meta->>'ref' = 'pcm:'||c.id)
   and not exists (select 1 from public.erp_usage_events y where y.feature_key = 'tasks.tasks.comment_on_a_task' and lower(y.user_email) = lower(c.author) and y.occurred_at between c.created_at - interval '2 minutes' and c.created_at + interval '2 minutes');

-- ---- 4. Files attached to a task or comment ---------------------------------------------------
insert into public.erp_usage_events (feature_key, action, user_email, department, occurred_at, meta, module_id)
select 'tasks.tasks.attach_file_to_a_task_or_comment', 'create', f.uploaded_by, (u.department)[1], f.created_at,
       jsonb_strip_nulls(jsonb_build_object(
         'title', nullif(trim(t.title),''),
         'file', nullif(trim(f.file_name),''),
         'backfill', true,
         'ref', 'pfile:'||f.id)),
       'tasks'
  from acc.ptask_files f
  join acc.ptasks t on t.id = f.task_id
  left join adm.users u on lower(u.email) = lower(f.uploaded_by)
 where f.uploaded_by is not null
   and (f.created_at at time zone 'Asia/Kolkata')::date between '2026-06-01' and '2026-09-12'
   and not exists (select 1 from public.erp_usage_events x where x.meta->>'ref' = 'pfile:'||f.id)
   and not exists (select 1 from public.erp_usage_events y where y.feature_key = 'tasks.tasks.attach_file_to_a_task_or_comment' and lower(y.user_email) = lower(f.uploaded_by) and y.occurred_at between f.created_at - interval '2 minutes' and f.created_at + interval '2 minutes');

-- ---- 5. Checklist sub-tasks added -------------------------------------------------------------
insert into public.erp_usage_events (feature_key, action, user_email, department, occurred_at, meta, module_id)
select 'tasks.tasks.add_checklist_sub_task_item', 'create', s.created_by, (u.department)[1], s.created_at,
       jsonb_strip_nulls(jsonb_build_object(
         'title', nullif(trim(t.title),''),
         'item', nullif(trim(s.title),''),
         'backfill', true,
         'ref', 'psub:'||s.id)),
       'tasks'
  from acc.ptask_subtasks s
  join acc.ptasks t on t.id = s.task_id
  left join adm.users u on lower(u.email) = lower(s.created_by)
 where s.created_by is not null
   and (s.created_at at time zone 'Asia/Kolkata')::date between '2026-06-01' and '2026-09-12'
   and not exists (select 1 from public.erp_usage_events x where x.meta->>'ref' = 'psub:'||s.id)
   and not exists (select 1 from public.erp_usage_events y where y.feature_key = 'tasks.tasks.add_checklist_sub_task_item' and lower(y.user_email) = lower(s.created_by) and y.occurred_at between s.created_at - interval '2 minutes' and s.created_at + interval '2 minutes');

-- ---- 6. Sub-task ticked off -------------------------------------------------------------------
insert into public.erp_usage_events (feature_key, action, user_email, department, occurred_at, meta, module_id)
select 'tasks.tasks.mark_sub_task_complete', 'update', s.created_by, (u.department)[1], s.done_at,
       jsonb_strip_nulls(jsonb_build_object(
         'title', nullif(trim(t.title),''),
         'item', nullif(trim(s.title),''),
         'backfill', true,
         'ref', 'psubdone:'||s.id)),
       'tasks'
  from acc.ptask_subtasks s
  join acc.ptasks t on t.id = s.task_id
  left join adm.users u on lower(u.email) = lower(s.created_by)
 where s.done_at is not null
   and s.created_by is not null
   and (s.done_at at time zone 'Asia/Kolkata')::date between '2026-06-01' and '2026-09-12'
   and not exists (select 1 from public.erp_usage_events x where x.meta->>'ref' = 'psubdone:'||s.id)
   and not exists (select 1 from public.erp_usage_events y where y.feature_key = 'tasks.tasks.mark_sub_task_complete' and lower(y.user_email) = lower(s.created_by) and y.occurred_at between s.done_at - interval '2 minutes' and s.done_at + interval '2 minutes');
