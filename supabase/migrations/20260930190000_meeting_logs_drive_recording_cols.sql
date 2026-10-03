-- Backing columns for meet-recording-sync (pulls each online meeting's Google Meet auto-recording
-- into S3 and drops it on meeting_logs.audio_url, same column offline/manual recordings use, so
-- every invited person -- not just the organizer, who's the only one Drive would show it to --
-- hears it through the same <audio> player and gets it transcribed the same way).
alter table acc.meeting_logs
  add column if not exists drive_recording_id text,
  add column if not exists recording_sync_error text;
