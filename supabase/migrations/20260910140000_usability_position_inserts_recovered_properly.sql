-- Usability: recover ALL the recoverable "Insert a task at a specific position" use, not just the
-- fraction the first pass caught.
--
-- The first backfill looked only for a rank that was still a fraction, and found 12 uses. That was
-- far too few, and the reason is in crystallizeAndSwap: whenever any task on screen has no rank
-- yet, it renumbers EVERY visible task 1..N. So one later drag quietly erases the fractions left
-- by every earlier insert. What survives is only the most recent handful.
--
-- acc.task_rank keeps no history, but it does keep updated_at per row, and that is enough, because
-- only three code paths ever write to it and they leave different shapes:
--
--   task_rank_append   one row, at the moment a task is created          - an ordinary add
--   rankBetweenIds     the missing ranks, then the new task's own row,   - "+ Add task here"
--                      all at the moment a task is created
--   crystallizeAndSwap the renumbering and the two swapped rows,         - a drag reorder
--                      at a moment when NO task was created
--
-- So: group each person's rows into bursts written within three seconds of each other, then ask
-- whether one of that burst's tasks was created right then.
--
--   no task created  -> a drag reorder. Nothing else writes ranks outside a creation.
--   task created, and either more than one row was written or the rank is not a whole number
--                    -> the task was placed between two others rather than added at the end.
--   task created, one row, whole rank -> an ordinary add. Not this feature, not counted.
--
-- Bursts are only read as a reorder when every task in them still exists, so a deleted task can
-- never be mistaken for "no creation happened".
--
-- This is still a floor, not a total: an operation whose rows were all overwritten later leaves
-- nothing behind at all. It cannot be recovered, and no number here should be read as complete.
--
-- Replaces the first pass's rows rather than adding to them, and tags what it writes with
-- backfill so a re-run is exact and live events are never touched.

delete from public.erp_usage_events e
where e.feature_key = 'tasks.tasks.insert_a_task_at_a_specific_position'
  and (e.meta ? 'backfill'
       or exists (select 1 from acc.task_rank tr
                   where lower(tr.viewer_email) = lower(e.user_email)
                     and tr.updated_at = e.occurred_at));

with r as (
  select tr.viewer_email, tr.task_id, tr.rank, tr.updated_at,
         lag(tr.updated_at) over (partition by tr.viewer_email order by tr.updated_at) prev
    from acc.task_rank tr
), g as (
  select r.*,
         sum(case when prev is null or updated_at - prev > interval '3 seconds' then 1 else 0 end)
           over (partition by viewer_email order by updated_at) gid
    from r
), burst as (
  select viewer_email, gid,
         min(updated_at) t0, max(updated_at) t1,
         count(*) n_rows,
         array_agg(task_id) ids,
         bool_or(rank <> floor(rank) or rank <= 0) odd_rank
    from g group by viewer_email, gid
), cls as (
  select b.*,
         (select count(*) from acc.ptasks t where t.id = any(b.ids)) alive,
         (select t.id from acc.ptasks t
           where t.id = any(b.ids)
             and t.created_at between b.t0 - interval '5 seconds' and b.t1 + interval '5 seconds'
           order by t.created_at limit 1) made_now
    from burst b
)
insert into public.erp_usage_events
  (feature_key, action, user_email, department, occurred_at, meta, module_id)
select
  'tasks.tasks.insert_a_task_at_a_specific_position',
  case when cls.made_now is not null then 'create' else 'update' end,
  cls.viewer_email,
  case when cardinality(up.department) > 0 then up.department[1] end,
  cls.t0,
  jsonb_strip_nulls(jsonb_build_object(
    'backfill', true,
    'title',
      case
        when cls.made_now is not null then
          (select left(nullif(trim(t.title), ''), 160) from acc.ptasks t where t.id = cls.made_now)
        -- A reorder does not record which row was dragged. With one or two rows the burst IS the
        -- pair that moved, so they are named; a renumbering of the whole list is reported as what
        -- it was rather than guessed at.
        when cls.n_rows <= 2 then
          (select left(string_agg(nullif(trim(t.title), ''), ' / ' order by t.id), 160)
             from acc.ptasks t where t.id = any(cls.ids))
        else 'Reordered ' || cls.n_rows || ' tasks'
      end,
    'assignee',
      case when cls.made_now is not null then (
        select string_agg(distinct coalesce(nullif(trim(ap.full_name), ''), split_part(a.email, '@', 1)), ', ')
          from acc.ptask_assignees a
          left join acc.user_profile ap on lower(ap.email) = lower(a.email)
         where a.task_id = cls.made_now
      ) end
  )),
  'tasks'
from cls
left join acc.user_profile up on lower(up.email) = lower(cls.viewer_email)
where (cls.made_now is null and cls.alive = array_length(cls.ids, 1))
   or (cls.made_now is not null and (cls.n_rows >= 2 or cls.odd_rank));
