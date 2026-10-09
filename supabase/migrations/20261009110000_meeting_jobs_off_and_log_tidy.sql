-- FOUR JOBS THAT WOKE UP EVERY MINUTE FOR A FEATURE NOBODY USES, AND THE LOG THEY FILLED.
--
-- acc.meetings has never held a single row. The only thing in acc.meeting_logs is seventeen test
-- entries - "TESTINGGGGGGGG", "Ai Review", "Wow" - written in late July and on 30 September. Yet
-- four scheduled jobs woke up every sixty seconds, day and night, to check on it: about 444,000
-- wake-ups since 13 July, each writing a line to cron.job_run_details saying it had found nothing.
--
-- On a 1 GB shared-CPU instance that is not free. It is a slice of a processor that is already at
-- 77% all day, and it is where most of the 280 MB of scheduler log came from.
--
-- Three things happen here.

-- ── 1. THE BUG IN log_completed_meetings, WHICH IS REAL ──────────────────────────────────────
--
-- It failed 8,568 times between 27 July and 29 September - 97% of every job failure in the whole
-- system - with "cannot cast type record to meetings". The loop variable is declared `record`,
-- while acc.log_meeting_occurrence's first parameter is an acc.meetings row, and Postgres will not
-- convert one to the other. So the fallback that closes out a meeting nobody marked done has never
-- once worked.
--
-- It is quiet today only because the meetings table is empty - the loop has nothing to iterate.
-- Create one meeting and it would fail every minute again. Fixed here rather than left as a trap
-- for whoever turns the feature on.
create or replace function acc.log_completed_meetings()
returns void
language plpgsql
security definer
set search_path to 'acc','public'
as $function$
declare
  now_ist date := ((now() at time zone 'Asia/Kolkata'))::date;
  y_ist date := now_ist - 1;
  m acc.meetings%rowtype;   -- was `record`: see above
  occ date;
  occurs boolean;
begin
  for m in select * from acc.meetings loop
    foreach occ in array array[y_ist, now_ist] loop
      occurs := case m.recur_type
        when 'daily' then true
        when 'weekly' then extract(dow from occ)::int = m.recur_day
        when 'monthly' then extract(day from occ)::int = m.recur_date
        else m.meeting_date = occ
      end;
      if not occurs then continue; end if;

      -- No meeting is archived on the basis of the clock. Online meetings close on real Google
      -- Meet activity (google-meet-live-completion); offline meetings close when the organizer
      -- records the meeting in-app (which creates the log itself). This pass is only the fallback:
      -- once a meeting's scheduled day is fully past with nothing ever logged, record it as
      -- 'not_held' (online) / 'not_marked_done' (offline) so it leaves the active list.
      if occ >= now_ist then continue; end if;
      perform acc.log_meeting_occurrence(m, occ,
        case when m.mode = 'online' then 'not_held' else 'not_marked_done' end);
    end loop;
  end loop;
end;
$function$;

-- ── 2. THE FOUR JOBS, SWITCHED OFF ───────────────────────────────────────────────────────────
--
-- Unscheduled rather than deleted: cron.alter_job(active := false) keeps the job and its command
-- exactly as written, so turning the meetings feature on again is one line per job
-- (select cron.alter_job((select jobid from cron.job where jobname='...'), active := true)) and
-- nothing has to be reconstructed from memory.
--
-- meet-transcript-sync (every 15 minutes) is deliberately LEFT RUNNING. It is the one that pulls
-- Google Meet transcripts, it is gentle, and it is the piece most likely to be wanted first if
-- somebody picks the feature back up.
do $$
declare v_name text;
begin
  foreach v_name in array array[
    'meeting-reminders',      -- sends "your meeting starts soon"; 112,218 runs, 0 meetings
    'log-completed-meetings', -- the fallback fixed above; 110,804 runs, 8,568 failures
    'meet-attendance-sync',   -- asks Google who attended; 110,666 runs, 0 attendees recorded
    'meet-live-completion'    -- notices a live call ending; 110,546 runs, 0 meetings
  ] loop
    perform cron.alter_job((select jobid from cron.job where jobname = v_name), active := false);
  end loop;
end $$;

-- ── 3. THE LOG KEEPS ITS FAILURES AND LOSES ITS SUCCESSES ────────────────────────────────────
--
-- 603,626 entries back to 13 July, 280 MB, and nothing in JAIN-E reads any of it. The successes
-- are genuinely worthless - "ran, found nothing, fine", 600,000 times. The failures are not: when
-- the transcription model was retired, 65 calls failed silently and the only record anywhere that
-- something had gone wrong was this table. So failures are kept for good and successes are kept
-- for a week.
--
-- Written as a function plus its own schedule rather than a one-off delete, because a one-off
-- delete leaves the table growing again from tomorrow.
create or replace function public.purge_cron_log()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from cron.job_run_details
   where status = 'succeeded'
     and end_time < now() - interval '7 days';
$function$;

comment on function public.purge_cron_log() is
  'Drops successful scheduled-job records older than 7 days. Failures are never deleted - they are '
  'the only trace a background job leaves when it breaks. Runs nightly (purge-cron-log-daily).';

select cron.schedule('purge-cron-log-daily', '20 2 * * *', 'select public.purge_cron_log()');
