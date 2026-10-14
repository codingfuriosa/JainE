-- A NOTICE IS READ THE MOMENT IT LANDS, NOT WHEN THE NEXT TICK COMES ROUND.
--
-- The queue was drained by cron every 10 minutes. A file uploaded at 10:15:05 with the last tick
-- at 10:10 waited nearly five minutes before anything happened, and the person who uploaded it
-- had no way to tell the difference between "waiting" and "broken". Which is exactly what
-- happened on the first real upload.
--
-- The trigger now kicks the worker itself. net.http_post with pg_net QUEUES the request and
-- returns immediately - it does not wait for the reply - so the upload still completes at the
-- speed of the upload. The reading then happens in the background, which is what was wanted all
-- along; it was only ever the WAITING TO START that was slow.
--
-- The 10-minute cron stays as the safety net. If this call is dropped - pg_net restarting, the
-- worker being busy, the function erroring before it claims the row - the notice is still
-- pending and the next tick picks it up. Instant normally, never lost.
create or replace function acc.legal_notice_enqueue()
returns trigger
language plpgsql
security definer
set search_path to 'acc','doc','public'
as $function$
declare
  v_up  timestamptz;
  v_new boolean := false;
begin
  if new.folder_id is null then return new; end if;
  if not exists (select 1 from acc.legal_notice_folder_ids() f where f.folder_id = new.folder_id)
  then
    return new;
  end if;

  v_up := coalesce(new.created_at, now());

  insert into acc.legal_notices (document_id, uploaded_at, due_date)
  values (new.id, v_up, (v_up at time zone 'Asia/Kolkata')::date + 7)
  on conflict (document_id) do nothing;   -- a move back and forth must not queue it twice

  -- Only kick the worker when this row is genuinely new. A file dragged out of the folder and
  -- back in again must not start a second read of something already read.
  get diagnostics v_new = row_count;
  if v_new then
    begin
      perform net.http_post(
        url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/legal-ocr-batch',
        headers := jsonb_build_object('Content-Type','application/json',
          'apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJreHNndGF1aWdqcnBjamttY2N1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDUwNjYsImV4cCI6MjA5ODEyMTA2Nn0.DjmLaEogFjo0e94GWXi-KWP3iSIr3QPo-pGpL7nH-u4',
          'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJreHNndGF1aWdqcnBjamttY2N1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDUwNjYsImV4cCI6MjA5ODEyMTA2Nn0.DjmLaEogFjo0e94GWXi-KWP3iSIr3QPo-pGpL7nH-u4'),
        -- notices only: the OCR backlog is the cron's job and must not be pulled into an upload.
        body := jsonb_build_object('limit',0,'notices',true,'noticeLimit',2)::jsonb,
        timeout_milliseconds := 170000);
    exception when others then
      -- A failed kick must never fail the upload. The cron will collect it within 10 minutes.
      null;
    end;
  end if;

  return new;
end;
$function$;
