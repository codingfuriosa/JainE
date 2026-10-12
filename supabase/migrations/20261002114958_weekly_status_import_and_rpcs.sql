/* Weekly Status: the sheet importer, the two reads the dashboard makes, and the three edits it
   allows.

   THE IMPORTER IS RE-RUNNABLE ON PURPOSE. The Google Sheet is still where people type, so this
   will be run again. It therefore has to land on the rows it created last time rather than
   doubling them, and - the part that matters - it must not undo work done inside JAIN-E. Once a
   person has ticked an item off here, the import refreshes the sheet's own text around it and
   leaves the status, and who closed it and when, exactly as they left it. First import wins the
   sheet's reading; every import after that, the human wins.

   NOTE: a later migration (weekly_status_project_aliases) replaces ops.import_sheet and
   public.ops_weekly_items to add project grouping. This file is the original shape. */

create or replace function ops.import_sheet(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'ops','public'
as $function$
declare
  m          jsonb;
  it         jsonb;
  v_mid      bigint;
  v_meetings int := 0;
  v_items    int := 0;
  v_att      int := 0;
begin
  if not app.has_module('weekly_status') then
    raise exception 'Weekly Status is not one of your modules';
  end if;

  for m in select * from jsonb_array_elements(p) loop
    insert into ops.meetings(meeting_date, kind, note, source_row, created_by)
    values ((m->>'d')::date, coalesce(nullif(m->>'k',''),'OPS'), nullif(m->>'t',''),
            nullif(m->>'n','')::int, app.current_user_email())
    on conflict (meeting_date, kind, coalesce(note,''))
      do update set source_row = coalesce(excluded.source_row, ops.meetings.source_row)
    returning id into v_mid;
    v_meetings := v_meetings + 1;

    /* Attendance is a fact about a meeting that happened; the sheet is the only record of it and
       replacing the list wholesale is right - nobody edits attendance in JAIN-E. */
    delete from ops.attendees where meeting_id = v_mid;
    insert into ops.attendees(meeting_id, person)
    select v_mid, btrim(x)
      from jsonb_array_elements_text(coalesce(m->'a','[]'::jsonb)) x
     where btrim(x) <> ''
    on conflict do nothing;
    get diagnostics v_att = row_count;

    for it in select * from jsonb_array_elements(coalesce(m->'it','[]'::jsonb)) loop
      insert into ops.items(meeting_id, project, item, owner, owner_raw,
                            due_date, due_raw, comments, extra, status, source_row)
      values (v_mid,
              nullif(it->>'p',''),
              it->>'i',
              ops.resolve_owner(it->>'o'),
              nullif(it->>'o',''),
              nullif(it->>'u','')::date,
              nullif(it->>'ur',''),
              nullif(it->>'c',''),
              nullif(it->>'e',''),
              coalesce(nullif(it->>'s',''),'open'),
              nullif(it->>'rw','')::int)
      on conflict (meeting_id, source_row, md5(item)) do update set
        project   = excluded.project,
        owner     = excluded.owner,
        owner_raw = excluded.owner_raw,
        due_raw   = excluded.due_raw,
        comments  = excluded.comments,
        extra     = excluded.extra,
        /* Only where nobody here has taken it over. ops.items.updated_by is set by the edit RPCs
           and by nothing else, so it is exactly the flag for "a person has had an opinion". */
        due_date  = case when ops.items.updated_by is null then excluded.due_date else ops.items.due_date end,
        status    = case when ops.items.updated_by is null then excluded.status   else ops.items.status   end;
      v_items := v_items + 1;
    end loop;
  end loop;

  return jsonb_build_object('meetings', v_meetings, 'items', v_items);
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- READS. Two calls, because the dashboard needs every item anyway to filter and count in the
-- browser, and a per-meeting round trip would be 29 of them.
-- ---------------------------------------------------------------------------------------------
create or replace function public.ops_weekly_meetings()
 returns table(id bigint, meeting_date date, kind text, note text,
               attendees text[], item_count int, done_count int, open_count int)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select m.id, m.meeting_date, m.kind, m.note,
         coalesce((select array_agg(a.person order by a.person) from ops.attendees a where a.meeting_id = m.id), '{}'),
         (select count(*)::int from ops.items i where i.meeting_id = m.id),
         (select count(*)::int from ops.items i where i.meeting_id = m.id and i.status = 'done'),
         (select count(*)::int from ops.items i where i.meeting_id = m.id and i.status <> 'done')
    from ops.meetings m
   where app.has_module('weekly_status')
   order by m.meeting_date desc, m.id desc
$function$;

create or replace function public.ops_weekly_items()
 returns table(id bigint, meeting_id bigint, meeting_date date, kind text,
               project text, item text, owner text, owner_raw text,
               due_date date, due_raw text, comments text, status text,
               done_at timestamptz, done_by text, updated_by text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select i.id, i.meeting_id, m.meeting_date, m.kind,
         coalesce(nullif(btrim(i.project),''), 'General'),
         i.item, i.owner, i.owner_raw, i.due_date, i.due_raw, i.comments, i.status,
         i.done_at, i.done_by, i.updated_by
    from ops.items i
    join ops.meetings m on m.id = i.meeting_id
   where app.has_module('weekly_status')
   order by m.meeting_date desc, i.source_row, i.id
$function$;

-- ---------------------------------------------------------------------------------------------
-- WRITES. Three, and each one records who did it: the point of moving off the sheet is that a
-- change has a name against it.
-- ---------------------------------------------------------------------------------------------
create or replace function public.ops_item_set_status(p_id bigint, p_status text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_email text := app.current_user_email();
begin
  if not app.has_module('weekly_status') then
    raise exception 'Weekly Status is not one of your modules';
  end if;
  if p_status not in ('open','in_progress','done','not_done') then
    raise exception 'Unknown status: %', p_status;
  end if;
  update ops.items
     set status     = p_status,
         /* Kept as the record of who actually closed it, and cleared when it is reopened so a
            reopened item never carries a stale "closed by" line. */
         done_at    = case when p_status = 'done' then coalesce(done_at, now()) else null end,
         done_by    = case when p_status = 'done' then coalesce(done_by, v_email) else null end,
         updated_at = now(),
         updated_by = v_email
   where id = p_id;
  if not found then raise exception 'That item no longer exists'; end if;
end;
$function$;

create or replace function public.ops_item_set_due(p_id bigint, p_due date)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_email text := app.current_user_email();
begin
  if not app.has_module('weekly_status') then
    raise exception 'Weekly Status is not one of your modules';
  end if;
  update ops.items
     set due_date = p_due, updated_at = now(), updated_by = v_email
   where id = p_id;
  if not found then raise exception 'That item no longer exists'; end if;
end;
$function$;

create or replace function public.ops_item_set_owner(p_id bigint, p_owner text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_email text := app.current_user_email();
begin
  if not app.has_module('weekly_status') then
    raise exception 'Weekly Status is not one of your modules';
  end if;
  /* Routed through the same alias table the import uses, so a name typed here and a name read
     from the sheet land on the same person rather than becoming two entries on the board. */
  update ops.items
     set owner = ops.resolve_owner(p_owner), updated_at = now(), updated_by = v_email
   where id = p_id;
  if not found then raise exception 'That item no longer exists'; end if;
end;
$function$;

revoke all on function ops.import_sheet(jsonb) from public;
revoke all on function public.ops_weekly_meetings() from public;
revoke all on function public.ops_weekly_items() from public;
revoke all on function public.ops_item_set_status(bigint, text) from public;
revoke all on function public.ops_item_set_due(bigint, date) from public;
revoke all on function public.ops_item_set_owner(bigint, text) from public;

grant execute on function ops.import_sheet(jsonb) to authenticated;
grant execute on function public.ops_weekly_meetings() to authenticated;
grant execute on function public.ops_weekly_items() to authenticated;
grant execute on function public.ops_item_set_status(bigint, text) to authenticated;
grant execute on function public.ops_item_set_due(bigint, date) to authenticated;
grant execute on function public.ops_item_set_owner(bigint, text) to authenticated;
