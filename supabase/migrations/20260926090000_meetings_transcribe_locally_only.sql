/* Meeting transcription becomes JAIN-E's own work. No Gemini, no Google, no third-party engine,
   nothing billed per use.

   WHAT IS BEING SWITCHED OFF, AND WHY IT IS SAFE.

   'transcribe-pending' (every 2 min) read acc.meeting_logs rows sitting at transcript_status
   'processing', fetched the recording out of S3 and POSTED THE AUDIO to Google's Gemini API, which
   returned the transcript, an English translation, a summary and a speaker count. That is the call
   that is no longer wanted: the recording of an internal meeting left the organisation, and every
   minute of audio was billed against a Gemini key.

   'meet-transcript-sync' (every 15 min, scheduled yesterday) did the same thing from the other end
   for online meetings — it pulled Google Meet's own transcript artifact and then ran THAT through
   Gemini as well. Both halves of it are third-party, so it goes too. The plan it was part of —
   turning Google's auto-transcription on for every Meet space — is abandoned with it, and was
   never applied: the Meet spaces still have autoTranscriptionGeneration OFF, exactly as found.

   Neither job is load-bearing for anything else. transcribe-pending touches acc.meeting_logs and
   nothing but acc.meeting_logs, and the Transcription module (call recordings) runs on a wholly
   separate function, 'transcription-sync', which is NOT touched here and keeps running.

   WHAT REPLACES THEM.
   The Whisper model that already shipped in accountability.js, running inside the browser via
   transformers.js — WebGPU where the machine has it, WASM where it doesn't. It was written as the
   original engine, switched off in favour of Gemini, and left in place "should the Gemini key ever
   be withdrawn". It is now the only engine. A meeting recorded in the portal is transcribed on the
   spot by the machine that recorded it, straight from the audio still in memory; anything else —
   an uploaded recording, a tab closed halfway, a failure — is picked up by the catch-up worker in
   whichever desktop browser has the portal open.

   NO ROWS ARE CHANGED. Occurrences already transcribed by Gemini keep their transcript, their
   translation and their summary; this only stops new audio being sent anywhere. Rows left at
   'processing' are not failed either — they simply wait for a browser to claim them now instead
   of a cron, which is what claim_transcription_job() has always been for.

   REVERSIBLE. Re-scheduling either job restores the old behaviour exactly; the edge functions
   themselves are left deployed and untouched. */
select cron.unschedule('transcribe-pending')
 where exists (select 1 from cron.job where jobname = 'transcribe-pending');

select cron.unschedule('meet-transcript-sync')
 where exists (select 1 from cron.job where jobname = 'meet-transcript-sync');
