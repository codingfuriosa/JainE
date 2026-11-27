-- JainE-Meetings recordings, step 2 of 3 (27 Nov 2026): transcribe on the server.
--
-- The edge function meeting-transcribe takes one saved recording at a time (ops_rec_claim), joins its
-- parts from S3, gives the sound to Gemini with the meeting's people, and stores what comes back
-- (ops_rec_done): the transcript as spoken, an English version, a short summary, and suggestions -
-- tasks (who, what, by when), Trying / Future to-dos, obstacles / opportunities and decisions. Nothing
-- is added to the meeting from them yet; that is step 3 (review, Add / Edit / Skip).
--
-- It is run every two minutes by pg_cron (job meeting-transcribe-work, secret 'meeting_transcribe' in
-- acc.job_secrets), and poked by the page right after a recording is saved so it starts at once.
-- A recording whose run was cut off (left 'transcribing' for 15 minutes) is taken again; after three
-- tries it is marked failed with the last reason.

alter table ops.meeting_recordings add column if not exists attempts   int not null default 0;
alter table ops.meeting_recordings add column if not exists claimed_at timestamptz;
alter table ops.meeting_recordings add column if not exists model      text;
alter table ops.meeting_recordings add column if not exists done_at    timestamptz;

-- The next recording to transcribe, with what the model needs to know about the meeting. Service role only.
create or replace function public.ops_rec_claim()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare r ops.meeting_recordings; v jsonb;
begin
  -- runs cut off three times are given up on
  update ops.meeting_recordings x set status = 'failed',
         error_text = coalesce(x.error_text, 'Transcribing was cut off three times - the recording may be too long')
   where x.status = 'transcribing' and x.claimed_at < now() - interval '15 minutes' and x.attempts >= 3;

  select * into r from ops.meeting_recordings x
   where (x.status = 'saved' or (x.status = 'transcribing' and x.claimed_at < now() - interval '15 minutes'))
     and x.attempts < 3 and x.parts > 0
   order by x.ended_at nulls last, x.id
   limit 1 for update skip locked;
  if r.id is null then return null; end if;

  update ops.meeting_recordings x set status = 'transcribing', attempts = x.attempts + 1, claimed_at = now(), error_text = null
   where x.id = r.id;

  select jsonb_build_object(
    'id', r.id, 'meeting_id', r.meeting_id, 'source', r.source, 'mime', r.mime, 'file_name', r.file_name,
    's3_prefix', r.s3_prefix, 'parts', r.parts, 'bytes', r.bytes, 'duration_seconds', r.duration_seconds,
    'attempt', r.attempts + 1,
    'kind', m.kind, 'meeting_date', m.meeting_date, 'start_time', m.start_time,
    'attendees', coalesce((select jsonb_agg(a.person order by a.id) from ops.attendees a where a.meeting_id = m.id), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('name', u.full_name,
                         'dept', coalesce(array_to_string(u.department, ', '), ''), 'title', coalesce(u.job_title, ''))
                         order by u.full_name)
                         from adm.users u where u.active and nullif(btrim(u.full_name), '') is not null), '[]'::jsonb))
    into v
    from ops.meetings m where m.id = r.meeting_id;
  return v;
end;
$function$;

-- Store the result of a run. With an error: back to 'saved' for another try, or 'failed' after the third.
create or replace function public.ops_rec_done(p_id bigint, p_transcript text, p_transcript_en text, p_summary text,
                                               p_suggestions jsonb, p_model text, p_error text)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if p_error is null then
    update ops.meeting_recordings x set status = 'ready', transcript = p_transcript, transcript_en = p_transcript_en,
           summary = p_summary, suggestions = p_suggestions, model = p_model, error_text = null, done_at = now()
     where x.id = p_id;
  else
    update ops.meeting_recordings x
       set status = case when x.attempts >= 3 then 'failed' else 'saved' end,
           error_text = left(p_error, 500), model = p_model
     where x.id = p_id;
  end if;
end;
$function$;

-- One recording's transcript, summary and suggestions, for anyone who can see the meeting.
create or replace function public.ops_rec_get(p_id bigint)
returns table(id bigint, meeting_id bigint, status text, transcript text, transcript_en text, summary text,
              suggestions jsonb, duration_seconds int, started_at timestamptz, done_at timestamptz)
language sql stable security definer set search_path to 'public'
as $function$
  select r.id, r.meeting_id, r.status, r.transcript, r.transcript_en, r.summary, r.suggestions,
         r.duration_seconds, r.started_at, r.done_at
    from ops.meeting_recordings r
   where r.id = p_id and coalesce(app.ws_can_see(r.meeting_id), false);
$function$;

revoke all on function public.ops_rec_claim(), public.ops_rec_done(bigint,text,text,text,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.ops_rec_claim(), public.ops_rec_done(bigint,text,text,text,jsonb,text,text) to service_role;
revoke all on function public.ops_rec_get(bigint) from public, anon;
grant execute on function public.ops_rec_get(bigint) to authenticated;

-- The job's secret and the schedule (every two minutes).
insert into acc.job_secrets(name, value)
select 'meeting_transcribe', encode(extensions.gen_random_bytes(24), 'hex')
 where not exists (select 1 from acc.job_secrets where name = 'meeting_transcribe');

select cron.unschedule('meeting-transcribe-work') where exists (select 1 from cron.job where jobname = 'meeting-transcribe-work');
select cron.schedule('meeting-transcribe-work', '*/2 * * * *', $cron$
  select net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/meeting-transcribe',
    headers := jsonb_build_object('Content-Type','application/json',
      'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n',
      'x-job-secret',(select value from acc.job_secrets where name='meeting_transcribe')),
    body := '{"work":true}'::jsonb,
    timeout_milliseconds := 30000);
$cron$);

-- The list also says how many tasks were suggested (the chip shows it), so its shape changes.
drop function if exists public.ops_rec_list(bigint);
create function public.ops_rec_list(p_meeting bigint)
returns table(id bigint, source text, status text, file_name text, parts int, bytes bigint,
              started_at timestamptz, ended_at timestamptz, duration_seconds int, created_by text, error_text text,
              n_tasks int, attempts int)
language sql stable security definer set search_path to 'public'
as $function$
  select r.id, r.source, r.status, r.file_name, r.parts, r.bytes, r.started_at, r.ended_at,
         r.duration_seconds, r.created_by, r.error_text,
         coalesce(jsonb_array_length(case when jsonb_typeof(r.suggestions->'tasks') = 'array' then r.suggestions->'tasks' end), 0),
         r.attempts
    from ops.meeting_recordings r
   where r.meeting_id = p_meeting and coalesce(app.ws_can_see(p_meeting), false)
   order by r.started_at desc;
$function$;
revoke all on function public.ops_rec_list(bigint) from public, anon;
grant execute on function public.ops_rec_list(bigint) to authenticated;
