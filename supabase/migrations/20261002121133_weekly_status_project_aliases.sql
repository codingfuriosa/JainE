/* Project names, the same problem as owners and the same answer.

   Thirty-one labels for about ten projects: Gurukul / GURUKUL / Dream Gurukul / Dream Gurukul &
   Ananta / GURUKUL PHASE 2, and D1 / Dream One / Dream ONE / Dream one / ONE / Dream One Block 4.
   Split that way the project breakdown - the chart somebody actually looks at first - says
   nothing: the real second-biggest project appears four times, each time too small to notice.

   A TABLE, NOT A CASE STATEMENT, for the same reason as the owners: a wrong grouping is corrected
   with one update rather than a code change, and anything unmapped passes through as typed rather
   than being guessed into the wrong bucket.

   PHASES ARE KEPT WITH THEIR PROJECT. "GURUKUL PHASE 2" and "Dream One Block 4" fold into Gurukul
   and Dream One, because the question this page answers is "where is the work sitting", and that
   is asked per project. The original label stays in project_raw, so a phase is never lost - only
   grouped.

   WHAT IS NOT MAPPED: "All project", "Miscelleneous", "HO" and "NA" are not projects at all - they
   are the sheet's way of saying "everywhere" or "nowhere". They keep their own names rather than
   being swept into a project they do not belong to. */

alter table ops.items add column if not exists project_raw text;

/* Fill project_raw from what is currently in project, once, so the sheet's own wording survives
   the regrouping below. Guarded, so a second run cannot overwrite it with the grouped name. */
update ops.items set project_raw = project where project_raw is null;

create table if not exists ops.project_aliases(
  alias     text primary key,
  canonical text not null,
  note      text
);
alter table ops.project_aliases enable row level security;
drop policy if exists project_aliases_read on ops.project_aliases;
create policy project_aliases_read on ops.project_aliases for select using (app.has_module('weekly_status'));
grant select on ops.project_aliases to authenticated;

comment on table ops.project_aliases is
  'Maps the sheet''s many spellings of a project onto one name. Unmapped values pass through as typed. ops.items.project_raw keeps the original.';

insert into ops.project_aliases(alias, canonical, note) values
  ('dwc','DWC',null),
  ('gurukul','Gurukul',null),
  ('dream gurukul','Gurukul',null),
  ('dream gurukul & ananta','Gurukul','Ananta is the Gurukul phase being built now'),
  ('gurukul phase 2','Gurukul','phase, kept with its project'),
  ('d1','Dream One',null),
  ('one','Dream One',null),
  ('dream one','Dream One',null),
  ('dream one block 4','Dream One','phase, kept with its project'),
  ('d1 - bl 4','Dream One','phase, kept with its project'),
  ('d1 bl-2','Dream One','phase, kept with its project'),
  ('dec','Dream Eco City',null),
  ('dream eco city','Dream Eco City',null),
  ('ecocity','Dream Eco City',null),
  ('ecocity bunglow','Dream Eco City',null),
  ('akm','AK Mukherjee',null),
  ('ak mukherjee','AK Mukherjee',null),
  ('holiday inn','Holiday Inn',null),
  ('hotel','Holiday Inn',null),
  ('sarovar','Sarovar',null),
  ('exotica','Exotica',null),
  ('onyx','Onyx',null)
on conflict (alias) do update set canonical=excluded.canonical, note=excluded.note;

/* One sheet row carried a whole sentence in the project cell ("OBPAS DWG submission target date:
   21/09/26") - a note typed into the wrong column. It is not a project and must not become one. */
create or replace function ops.resolve_project(p_raw text)
 returns text
 language sql
 stable
 set search_path to 'ops','public'
as $function$
  select case
    when nullif(btrim(coalesce(p_raw,'')),'') is null then 'General'
    when length(btrim(p_raw)) > 40                    then 'General'
    else coalesce((select a.canonical from ops.project_aliases a
                    where a.alias = lower(btrim(p_raw))),
                  btrim(p_raw))
  end
$function$;

update ops.items set project = ops.resolve_project(project_raw);

/* The read now serves the grouped name and carries the sheet's own wording beside it, exactly as
   it already does for owner / owner_raw. Dropped rather than replaced because adding a column to
   the returned row changes the function's type. */
drop function if exists public.ops_weekly_items();
create function public.ops_weekly_items()
 returns table(id bigint, meeting_id bigint, meeting_date date, kind text,
               project text, project_raw text, item text, owner text, owner_raw text,
               due_date date, due_raw text, comments text, status text,
               done_at timestamptz, done_by text, updated_by text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select i.id, i.meeting_id, m.meeting_date, m.kind,
         coalesce(nullif(btrim(i.project),''), 'General'),
         nullif(btrim(coalesce(i.project_raw,'')),''),
         i.item, i.owner, i.owner_raw, i.due_date, i.due_raw, i.comments, i.status,
         i.done_at, i.done_by, i.updated_by
    from ops.items i
    join ops.meetings m on m.id = i.meeting_id
   where app.has_module('weekly_status')
   order by m.meeting_date desc, i.source_row, i.id
$function$;

revoke all on function public.ops_weekly_items() from public;
grant execute on function public.ops_weekly_items() to authenticated;

/* The importer must group new rows the same way, or the next sync re-splits the board. */
create or replace function ops.import_sheet(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'ops','public'
as $function$
declare
  m jsonb; it jsonb; v_mid bigint;
  v_meetings int := 0; v_items int := 0;
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

    delete from ops.attendees where meeting_id = v_mid;
    insert into ops.attendees(meeting_id, person)
    select v_mid, btrim(x)
      from jsonb_array_elements_text(coalesce(m->'a','[]'::jsonb)) x
     where btrim(x) <> ''
    on conflict do nothing;

    for it in select * from jsonb_array_elements(coalesce(m->'it','[]'::jsonb)) loop
      insert into ops.items(meeting_id, project, project_raw, item, owner, owner_raw,
                            due_date, due_raw, comments, extra, status, source_row)
      values (v_mid,
              ops.resolve_project(it->>'p'),
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
        project     = excluded.project,
        project_raw = excluded.project_raw,
        owner       = excluded.owner,
        owner_raw   = excluded.owner_raw,
        due_raw     = excluded.due_raw,
        comments    = excluded.comments,
        extra       = excluded.extra,
        /* Only where nobody here has taken it over. updated_by is set by the edit RPCs and by
           nothing else, so it is exactly the flag for "a person has had an opinion". */
        due_date    = case when ops.items.updated_by is null then excluded.due_date else ops.items.due_date end,
        status      = case when ops.items.updated_by is null then excluded.status   else ops.items.status   end;
      v_items := v_items + 1;
    end loop;
  end loop;

  return jsonb_build_object('meetings', v_meetings, 'items', v_items);
end;
$function$;
