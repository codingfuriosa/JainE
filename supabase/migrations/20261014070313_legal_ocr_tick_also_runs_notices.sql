-- THE TICK HAS TO WAKE UP FOR NOTICES TOO.
--
-- It returned early whenever the OCR backlog was empty:
--     select doc.legal_ocr_remaining('') into v_left;
--     if coalesce(v_left,0) = 0 then return; end if;
-- The Legal archive is close to fully indexed, so that guard is true most of the time - and a
-- notice uploaded today would have sat unread for ever, with the task never raised. The feature
-- would have looked broken while every part of it worked.
--
-- Now it wakes for either queue, and asks for work from whichever has it. The early return is
-- kept, because the whole point of it is that an idle tick must cost nothing: this job already
-- averages ~1s and has peaked at 24s, and it runs while people are using the system.
--
-- Three calls when there is OCR to do, as before. One call when only notices are waiting - a
-- notice is a single file of a few pages and three workers would simply contend for the same two
-- rows.
--
-- Scheduled by the existing cron job `legal-ocr-backlog`, every 10 minutes, so a notice is read
-- within ten minutes of being uploaded.
create or replace function acc.legal_ocr_tick()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_left    int;
  v_notices int;
  v_rounds  int;
  i         int;
begin
  select doc.legal_ocr_remaining('') into v_left;
  select count(*) into v_notices from acc.legal_notice_pending(10);

  if coalesce(v_left,0) = 0 and coalesce(v_notices,0) = 0 then
    return;
  end if;

  v_rounds := case when coalesce(v_left,0) > 0 then 3 else 1 end;

  for i in 1..v_rounds loop
    perform net.http_post(
      url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/legal-ocr-batch',
      headers := jsonb_build_object('Content-Type','application/json',
        'apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJreHNndGF1aWdqcnBjamttY2N1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDUwNjYsImV4cCI6MjA5ODEyMTA2Nn0.DjmLaEogFjo0e94GWXi-KWP3iSIr3QPo-pGpL7nH-u4',
        'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJreHNndGF1aWdqcnBjamttY2N1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDUwNjYsImV4cCI6MjA5ODEyMTA2Nn0.DjmLaEogFjo0e94GWXi-KWP3iSIr3QPo-pGpL7nH-u4'),
      -- Only the first round is asked to do the notices: they are a small queue and the three
      -- rounds exist for the OCR backlog, not for this.
      body := jsonb_build_object('limit',3,'notices', i = 1, 'noticeLimit', 2)::jsonb,
      timeout_milliseconds := 170000);
  end loop;
end
$function$;
