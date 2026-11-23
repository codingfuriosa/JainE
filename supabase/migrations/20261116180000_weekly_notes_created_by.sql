-- WEEKLY STATUS: EACH OBSTACLE / OPPORTUNITY SHOWS WHO WROTE IT.
-- The home page's Opportunities & Obstacles tab lists, for every note, who wrote it and when. The
-- column has always been kept (ops.meeting_notes.created_by, set by ops_note_add); the read did not
-- return it. Same rows, same access rule (app.ws_can_see) - one more column. The return type changes,
-- so the function is dropped and made again, with its grants.

drop function if exists public.ops_weekly_notes();
create function public.ops_weekly_notes()
 returns table(id bigint, meeting_id bigint, meeting_date date, start_time time without time zone, kind text, section text, body text,
               solved boolean, solved_at timestamp with time zone, ptask_id bigint, task_status text, task_assignees text[],
               created_at timestamp with time zone, created_by text)
 language sql stable security definer set search_path to 'public'
as $function$
  select n.id, n.meeting_id, m.meeting_date, m.start_time, m.kind, n.section, n.body, n.solved, n.solved_at, n.ptask_id,
         t.status, coalesce((select array_agg(a.email order by a.email) from acc.ptask_assignees a where a.task_id = t.id), '{}'),
         n.created_at, n.created_by
    from ops.meeting_notes n
    join ops.meetings m on m.id = n.meeting_id
    left join acc.ptasks t on t.id = n.ptask_id
   where app.ws_can_see(m.id)
   order by m.meeting_date desc, n.created_at
$function$;
revoke all on function public.ops_weekly_notes() from public, anon;
grant execute on function public.ops_weekly_notes() to authenticated;
