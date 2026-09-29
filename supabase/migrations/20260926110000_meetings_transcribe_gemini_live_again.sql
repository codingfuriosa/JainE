-- Reverts 20260926090000_meetings_transcribe_locally_only.sql: transcription goes back to being
-- done live by Gemini (transcribe-pending for offline recordings, meet-transcript-sync for online
-- Meet calls), not the in-browser Whisper worker. Exactly the re-schedule that migration's own
-- comment said would restore the old behaviour - same job names, same cadence, same command.
-- The Whisper code itself stays in the codebase (accountability.js turns
-- mtgStartBrowserTranscriber() back into a no-op in this same change, rather than deleting any of
-- it) for the reason it was written in the first place: a fallback should the Gemini key ever be
-- withdrawn. Running both at once isn't safe to leave as a side effect of this revert — the cron
-- jobs pick up transcript_status='processing' rows directly with no claim/lock step, while the
-- Whisper worker claims jobs atomically through claim_transcription_job(); with both live, they'd
-- race for the same rows, each is enough on its own.
select cron.schedule(
  'transcribe-pending',
  '*/2 * * * *',
  $cron$
  select net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/transcribe-pending',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

select cron.schedule(
  'meet-transcript-sync',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/meet-transcript-sync',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
