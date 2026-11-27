-- JainE-Meetings: recordings of meetings held in a room (step 1 of 3, 27 Nov 2026).
--
-- A phone or laptop on the table records the meeting in the browser. The audio goes straight to S3
-- (through s3-sign, as staff) in parts of about two minutes, so a dead phone or a closed tab loses
-- at most the last part, never the whole meeting. Parts are numbered part-00001, part-00002, ... under
-- the recording's folder; the first part carries the file header, so the parts joined in order are the
-- whole recording. A file recorded elsewhere (a phone's voice recorder) can be uploaded instead: one part.
--
-- Step 2 (not built yet) is a server job that joins the parts, transcribes them and writes transcript,
-- summary and suggestions; step 3 is the review panel. The columns for both are here already so the
-- table does not change shape later.
--
-- Rights: the same as the action line - only the meeting's starter or an editor (app.ws_can_edit)
-- may record or upload; anyone who can see the meeting (app.ws_can_see) sees that a recording exists.
-- The table has no policies and no grants: it is read and written only through these functions.

create table if not exists ops.meeting_recordings (
  id               bigserial primary key,
  meeting_id       bigint not null references ops.meetings(id) on delete cascade,
  source           text   not null check (source in ('recorded','uploaded')),
  status           text   not null default 'recording'
                   check (status in ('recording','saved','transcribing','ready','failed')),
  mime             text,
  file_name        text,
  s3_prefix        text   not null default '',
  parts            int    not null default 0,
  bytes            bigint not null default 0,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  duration_seconds int,
  created_by       text   not null,
  created_at       timestamptz not null default now(),
  transcript       text,
  transcript_en    text,
  summary          text,
  suggestions      jsonb,
  error_text       text
);
create index if not exists meeting_recordings_meeting on ops.meeting_recordings(meeting_id);
alter table ops.meeting_recordings enable row level security;
revoke all on ops.meeting_recordings from anon, authenticated;

-- Start a recording (or an upload): returns its id and the S3 folder its parts go in.
create or replace function public.ops_rec_start(p_meeting bigint, p_source text, p_mime text, p_file_name text default null)
returns table(id bigint, s3_prefix text)
language plpgsql security definer set search_path to 'public'
as $function$
declare v_id bigint; v_pre text;
begin
  if not coalesce(app.ws_can_edit(p_meeting), false) then
    raise exception 'Only the person who started this meeting (or its editor) can record it'; end if;
  if p_source not in ('recorded','uploaded') then raise exception 'Unknown kind of recording'; end if;
  insert into ops.meeting_recordings(meeting_id, source, mime, file_name, created_by)
  values (p_meeting, p_source, left(nullif(btrim(coalesce(p_mime,'')),''),100),
          left(nullif(btrim(coalesce(p_file_name,'')),''),200), app.current_user_email())
  returning meeting_recordings.id into v_id;
  v_pre := 'portal/meetings/recordings/' || p_meeting || '/' || v_id || '/';
  update ops.meeting_recordings r set s3_prefix = v_pre where r.id = v_id;
  return query select v_id, v_pre;
end;
$function$;

-- A part has reached S3. Parts may be reported more than once (a retry); the count only grows.
create or replace function public.ops_rec_part(p_id bigint, p_part int, p_bytes bigint)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  update ops.meeting_recordings r
     set parts = greatest(r.parts, p_part),
         bytes = r.bytes + greatest(coalesce(p_bytes,0),0)
   where r.id = p_id and r.status = 'recording'
     and lower(r.created_by) = lower(app.current_user_email());
  if not found then raise exception 'This recording is not open for more parts'; end if;
end;
$function$;

-- Stop: the recording is complete and waits for step 2. With no part saved at all it is marked failed.
create or replace function public.ops_rec_finish(p_id bigint, p_seconds int)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  update ops.meeting_recordings r
     set status = case when r.parts > 0 then 'saved' else 'failed' end,
         error_text = case when r.parts > 0 then null else 'No sound reached the server' end,
         ended_at = now(),
         duration_seconds = greatest(coalesce(p_seconds,0),0)
   where r.id = p_id and r.status = 'recording'
     and lower(r.created_by) = lower(app.current_user_email());
end;
$function$;

-- The recordings of one meeting, newest first (no transcript text - that comes with step 3).
create or replace function public.ops_rec_list(p_meeting bigint)
returns table(id bigint, source text, status text, file_name text, parts int, bytes bigint,
              started_at timestamptz, ended_at timestamptz, duration_seconds int, created_by text, error_text text)
language sql stable security definer set search_path to 'public'
as $function$
  select r.id, r.source, r.status, r.file_name, r.parts, r.bytes, r.started_at, r.ended_at,
         r.duration_seconds, r.created_by, r.error_text
    from ops.meeting_recordings r
   where r.meeting_id = p_meeting and coalesce(app.ws_can_see(p_meeting), false)
   order by r.started_at desc;
$function$;

revoke all on function public.ops_rec_start(bigint,text,text,text), public.ops_rec_part(bigint,int,bigint),
  public.ops_rec_finish(bigint,int), public.ops_rec_list(bigint) from public, anon;
grant execute on function public.ops_rec_start(bigint,text,text,text), public.ops_rec_part(bigint,int,bigint),
  public.ops_rec_finish(bigint,int), public.ops_rec_list(bigint) to authenticated;
