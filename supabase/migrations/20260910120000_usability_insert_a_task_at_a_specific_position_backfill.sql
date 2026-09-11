-- Usability: "Insert a task at a specific position" had 0 uses, and it was never true.
--
-- The catalog entry was wired to a global called taskReorderDrop, which does not exist anywhere in
-- the app any more, so the wrapper had nothing to wrap and nothing was ever logged. The two things
-- that really are this feature - the "+ Add task here" strip between two rows, and the drag
-- reorder - now log themselves at the point the change is actually saved.
--
-- The past is recoverable, because the position itself was stored. acc.task_rank holds each
-- person's private ordering, and the ranks tell apart how a row got there:
--
--   appended to the end  task_rank_append gives max+1     - a whole number
--   crystallized list    numbered 1..N in shown order     - whole numbers
--   inserted BETWEEN two rankBetweenIds returns (a+b)/2   - a fraction, and nothing else makes one
--   inserted at the TOP  rankBetweenIds returns after-1   - which reaches 0 or below
--
-- So a fractional or non-positive rank is a task somebody deliberately placed, and task_rank's
-- viewer_email is that person: the ordering is private to them, so only they can have set it.
-- Restricted further to rows written within five seconds of the task being created, which is the
-- gap composer saving a new task rather than a later reordering of an old one.
--
-- Idempotent: an event already sitting at that person and that instant is left alone, so this can
-- be re-run after the code fix without doubling anything.

insert into public.erp_usage_events
  (feature_key, action, user_email, department, occurred_at, meta, module_id)
select
  'tasks.tasks.insert_a_task_at_a_specific_position',
  'create',
  tr.viewer_email,
  -- Same expression erp_log_usage uses live: the profile's department is a list, and the report's
  -- column is a single one, so the first is the one that gets recorded.
  case when cardinality(up.department) > 0 then up.department[1] end,
  tr.updated_at,
  jsonb_strip_nulls(jsonb_build_object(
    'title', nullif(trim(t.title), ''),
    'assignee', (
      select string_agg(distinct coalesce(nullif(trim(ap.full_name), ''), split_part(a.email, '@', 1)), ', ')
        from acc.ptask_assignees a
        left join acc.user_profile ap on lower(ap.email) = lower(a.email)
       where a.task_id = t.id
    )
  )),
  'tasks'
from acc.task_rank tr
join acc.ptasks t on t.id = tr.task_id
left join acc.user_profile up on lower(up.email) = lower(tr.viewer_email)
where (tr.rank <> floor(tr.rank) or tr.rank <= 0)
  and tr.updated_at between t.created_at - interval '5 seconds' and t.created_at + interval '5 seconds'
  and not exists (
    select 1 from public.erp_usage_events e
     where e.feature_key = 'tasks.tasks.insert_a_task_at_a_specific_position'
       and lower(e.user_email) = lower(tr.viewer_email)
       and e.occurred_at = tr.updated_at
  );
