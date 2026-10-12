-- TELL GROK WHEN A DREAM WORLD CITY OR DREAM GURUKUL BOOKING DOCUMENT ARRIVES.
--
-- WHY THIS FIRES ON THE READING AND NOT ON THE UPLOAD. The ask was "when a Dream World City's or
-- Dream Gurukul's document is uploaded". At the moment of upload the case carries nothing but the
-- file path -
--
--   [{"label":"Attachment","value":"s3:portal/accountability/flow-events/41/..._Cost_sheet.pdf"}]
--
-- - and the project is inside the PDF. There is no way to tell at upload whether the document
-- belongs to one of these two projects or to the other ten. The earliest moment the condition can
-- honestly be evaluated is when the reading finishes and project_name is known, which is normally
-- within a few minutes of the upload. Firing earlier would mean firing on every booking and asking
-- Grok to work out whether it cared.
--
-- HOW IT IS SIGNED. Established by testing against the live endpoint rather than from docs, because
-- xAI documents only schedule and email triggers and the webhook format is not published:
--
--   headers: webhook-id, webhook-timestamp, webhook-signature: v1,<base64 HMAC-SHA256>
--   signed string: "<webhook-id>.<webhook-timestamp>.<body>"
--   key: the secret with whsec_ stripped, base64-decoded
--   success: 202 Accepted
--
-- THE BODY MUST BE SIGNED AS IT WILL BE SENT. pg_net takes a jsonb body and serialises it its own
-- way - key order and spacing both change. Signing the string we composed rather than the string
-- pg_net would send produced a 401 on an otherwise correct request. So the body is cast to jsonb
-- FIRST, the text of that is what gets signed, and the same jsonb is what gets posted.
-- For the record, the other shapes tried all failed: bearer token with and without the whsec_
-- prefix, X-Webhook-Secret, x-grok-webhook-secret and webhook-secret each returned 400.
--
-- The secret and the URL live in acc.job_secrets and are read by name. Nothing is written into this
-- function body - that is the mistake the market valuation webhook made, and it is why an API key
-- sat readable in the database until today.

alter table acc.booking_audits
  add column if not exists grok_notified_at timestamptz;

comment on column acc.booking_audits.grok_notified_at is
  'When the Grok automation was told about this booking. Set once; stops a re-read re-firing it.';

create or replace function acc.grok_automation_notify()
returns trigger
language plpgsql
security definer
set search_path to 'acc','extensions','net','public','pg_temp'
as $function$
declare
  v_url     text;
  v_secret  text;
  v_project text;
  v_id      text;
  v_ts      text;
  v_body    jsonb;
  v_sig     text;
begin
  v_project := new.result->'fields'->'project_name'->>'value';

  if new.status <> 'done'
     or new.grok_notified_at is not null
     or v_project not in ('Dream Gurukul','Dream World City') then
    return new;
  end if;

  select value into v_url    from acc.job_secrets where name = 'grok_automation_url';
  select value into v_secret from acc.job_secrets where name = 'grok_automation_webhook';
  -- Not configured is not an error. The booking must be saved whatever happens to the notice.
  if v_url is null or v_secret is null then
    return new;
  end if;

  v_id := 'msg_' || replace(gen_random_uuid()::text, '-', '');
  v_ts := extract(epoch from now())::bigint::text;

  v_body := jsonb_build_object(
    'event','booking.document_read',
    'case_id', new.case_id,
    'project', v_project,
    'customer', new.result->'fields'->'customer_name'->>'value',
    'block',    new.result->'fields'->'block'->>'value',
    'flat',     new.result->'fields'->'flat'->>'value',
    'floor',    new.result->'fields'->'floor'->>'value',
    'sba',      new.result->'fields'->'area_sqft'->>'value',
    'carpet',   new.result->'unit_areas'->>'carpet_sqft',
    'builtup',  coalesce(new.result->'unit_areas'->>'builtup_sqft',
                         new.result->'unit'->'cost_sheet'->>'builtup_sqft'),
    'text', 'New ' || v_project || ' booking document read in JAIN-E: case '
            || new.case_id || ', flat ' || coalesce(new.result->'fields'->'flat'->>'value','?')
            || '. Market valuation needed.'
  );

  v_sig := 'v1,' || encode(
    extensions.hmac((v_id || '.' || v_ts || '.' || v_body::text)::bytea,
                    decode(replace(v_secret,'whsec_',''),'base64'),
                    'sha256'), 'base64');

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'webhook-id', v_id,
      'webhook-timestamp', v_ts,
      'webhook-signature', v_sig),
    body := v_body,
    timeout_milliseconds := 15000);

  update acc.booking_audits
     set grok_notified_at = now()
   where case_id = new.case_id;

  return new;
exception when others then
  -- A booking is never held up by a notice failing to go out. The hourly task polls for rows with
  -- no market_valuation anyway, so a lost notice costs at most an hour, not the work.
  return new;
end
$function$;

drop trigger if exists trg_grok_automation_notify on acc.booking_audits;
create trigger trg_grok_automation_notify
  after update on acc.booking_audits
  for each row
  execute function acc.grok_automation_notify();
