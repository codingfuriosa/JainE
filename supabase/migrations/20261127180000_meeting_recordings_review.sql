-- JainE-Meetings recordings, step 3 of 3 (27 Nov 2026): review the suggestions.
--
-- In the transcript window the starter or an editor goes through what was suggested - tasks, Trying /
-- Future to-dos, obstacles / opportunities - and for each one picks Add (as it is, or after Edit) or Skip.
-- Adding goes through the meeting's own paths (a real Accountability task + ops_item_add, an unassigned
-- line, or ops_note_add), so it is exactly what typing it on the action line would have made.
-- What was decided is kept on the recording, in suggestions->'review', keyed t0, t1... (tasks),
-- d0... (to-dos), n0... (notes): {"s":"added"|"skipped","by":email,"at":time,"ref":the item or note id}.
-- So everyone sees the same state, and nothing is offered twice.

create or replace function public.ops_rec_mark(p_id bigint, p_key text, p_state text, p_ref bigint default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare v_meeting bigint; v jsonb;
begin
  select r.meeting_id into v_meeting from ops.meeting_recordings r where r.id = p_id and r.status = 'ready';
  if v_meeting is null then raise exception 'That recording has no suggestions to review'; end if;
  if not coalesce(app.ws_can_edit(v_meeting), false) then
    raise exception 'Only the person who started this meeting (or its editor) can add these'; end if;
  if p_key !~ '^[tdn][0-9]{1,3}$' then raise exception 'Unknown suggestion'; end if;
  if coalesce(p_state, '') not in ('added', 'skipped', '') then raise exception 'Unknown choice'; end if;
  update ops.meeting_recordings r
     set suggestions = jsonb_set(coalesce(r.suggestions, '{}'::jsonb), '{review}',
           case when coalesce(p_state, '') = '' then coalesce(r.suggestions->'review', '{}'::jsonb) - p_key
                else coalesce(r.suggestions->'review', '{}'::jsonb)
                     || jsonb_build_object(p_key, jsonb_build_object('s', p_state, 'by', app.current_user_email(), 'at', now(), 'ref', p_ref)) end)
   where r.id = p_id
  returning r.suggestions->'review' into v;
  return coalesce(v, '{}'::jsonb);
end;
$function$;
revoke all on function public.ops_rec_mark(bigint,text,text,bigint) from public, anon;
grant execute on function public.ops_rec_mark(bigint,text,text,bigint) to authenticated;

-- The list now also says how many suggestions are still waiting for Add or Skip (the chip shows it).
drop function if exists public.ops_rec_list(bigint);
create function public.ops_rec_list(p_meeting bigint)
returns table(id bigint, source text, status text, file_name text, parts int, bytes bigint,
              started_at timestamptz, ended_at timestamptz, duration_seconds int, created_by text, error_text text,
              n_tasks int, attempts int, n_left int)
language sql stable security definer set search_path to 'public'
as $function$
  select r.id, r.source, r.status, r.file_name, r.parts, r.bytes, r.started_at, r.ended_at,
         r.duration_seconds, r.created_by, r.error_text,
         coalesce(jsonb_array_length(case when jsonb_typeof(r.suggestions->'tasks') = 'array' then r.suggestions->'tasks' end), 0),
         r.attempts,
         (select count(*)::int from (
             select 't' || (o - 1) k from jsonb_array_elements(case when jsonb_typeof(r.suggestions->'tasks') = 'array' then r.suggestions->'tasks' else '[]'::jsonb end) with ordinality x(e, o)
             union all
             select 'd' || (o - 1) from jsonb_array_elements(case when jsonb_typeof(r.suggestions->'todos') = 'array' then r.suggestions->'todos' else '[]'::jsonb end) with ordinality x(e, o)
             union all
             select 'n' || (o - 1) from jsonb_array_elements(case when jsonb_typeof(r.suggestions->'notes') = 'array' then r.suggestions->'notes' else '[]'::jsonb end) with ordinality x(e, o)
           ) s where not coalesce(r.suggestions->'review', '{}'::jsonb) ? s.k)
    from ops.meeting_recordings r
   where r.meeting_id = p_meeting and coalesce(app.ws_can_see(p_meeting), false)
   order by r.started_at desc;
$function$;
revoke all on function public.ops_rec_list(bigint) from public, anon;
grant execute on function public.ops_rec_list(bigint) to authenticated;
