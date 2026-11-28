-- JainE-Meetings recordings (28 Nov 2026): name the speakers.
--
-- The transcriber cannot tell who a voice belongs to, so a transcript says "Speaker 1:", "Speaker 2:"... (a name
-- only when the recording itself proves it). The starter or an editor then picks who each speaker is in the
-- transcript window; the picks are kept on the recording in suggestions->'speakers' as {"Speaker 1": "Amirul SK"}
-- and shown in place of the label, in both the transcript as spoken and the English one, for everyone.
-- An empty name removes a pick. A new transcription of the same recording starts without picks.

create or replace function public.ops_rec_speakers(p_id bigint, p_map jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare v_meeting bigint; v jsonb := '{}'::jsonb; k text; val text;
begin
  select r.meeting_id into v_meeting from ops.meeting_recordings r where r.id = p_id and r.status = 'ready';
  if v_meeting is null then raise exception 'That recording has no transcript yet'; end if;
  if not coalesce(app.ws_can_edit(v_meeting), false) then
    raise exception 'Only the person who started this meeting (or its editor) can name the speakers'; end if;
  if jsonb_typeof(coalesce(p_map, '{}'::jsonb)) <> 'object' then raise exception 'Unknown speaker list'; end if;
  for k, val in select key, value #>> '{}' from jsonb_each(coalesce(p_map, '{}'::jsonb)) loop
    if length(k) between 1 and 60 and nullif(btrim(coalesce(val, '')), '') is not null then
      v := v || jsonb_build_object(k, left(btrim(val), 80));
    end if;
  end loop;
  update ops.meeting_recordings r
     set suggestions = jsonb_set(coalesce(r.suggestions, '{}'::jsonb), '{speakers}', v)
   where r.id = p_id;
  return v;
end;
$function$;
revoke all on function public.ops_rec_speakers(bigint,jsonb) from public, anon;
grant execute on function public.ops_rec_speakers(bigint,jsonb) to authenticated;
