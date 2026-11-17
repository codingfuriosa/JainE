-- WHATSAPP TEMPLATES - DELIVERIES (17 Nov 2026, Ayush approved the data list).
-- Filled by the edge function wa-deliveries-sync (nightly cron 'wa-deliveries-daily', 06:15 IST) from Meta's
-- WhatsApp Business Management API with META_WHATSAPP_TOKEN:
--   wa_accounts        every WhatsApp Business Account the key can see, and its phone numbers
--   wa_templates       each message template: name, language, status, category, quality, the full content
--   wa_template_daily  per template per day: sent / delivered / read / clicked (Meta's template analytics -
--                      exists only from the day insights were switched on for the account)
--   wa_msg_status      one row per message status Meta reports to our webhook (sent / delivered / read /
--                      failed + Meta's error code and reason) - only for numbers whose webhooks reach JainE
--   wa_sync_state      last run, its result and error
-- Read: people with WhatsApp Templates or Campaign Analytics. Written only by the edge function (service role).
-- Applied by the one-time cron 'wa_setup_once' at 20:25 IST, 17 Nov 2026 (no schema changes in office hours).

create table if not exists camp.wa_accounts (
  id text primary key, name text, business_id text, business_name text, timezone_id text,
  phones jsonb, insights_enabled boolean, synced_at timestamptz default now());

create table if not exists camp.wa_templates (
  id text primary key, waba_id text, name text not null, language text, status text, category text,
  quality text, rejected_reason text, components jsonb, synced_at timestamptz default now());
create index if not exists wa_templates_name on camp.wa_templates(name);

create table if not exists camp.wa_template_daily (
  template_id text not null, day date not null, sent int default 0, delivered int default 0, read int default 0,
  clicked int default 0, clicks jsonb, synced_at timestamptz default now(), primary key (template_id, day));
create index if not exists wa_template_daily_day on camp.wa_template_daily(day);

create table if not exists camp.wa_msg_status (
  message_id text not null, status text not null, ts timestamptz not null, phone_number_id text,
  recipient_tail text, template_name text, error_code int, error_title text, error_detail text,
  primary key (message_id, status));
create index if not exists wa_msg_status_ts on camp.wa_msg_status(ts);

create table if not exists camp.wa_sync_state (
  id int primary key default 1, last_sync_at timestamptz, last_result jsonb, last_error text, last_error_at timestamptz);
insert into camp.wa_sync_state(id) values (1) on conflict do nothing;

do $$ declare t text; begin
  foreach t in array array['wa_accounts','wa_templates','wa_template_daily','wa_msg_status','wa_sync_state'] loop
    execute format('alter table camp.%I enable row level security', t);
    execute format('drop policy if exists %I on camp.%I', t||'_read', t);
    execute format('create policy %I on camp.%I for select to authenticated using ((select app.has_module(''wa_templates'')) or (select app.has_module(''campaigns'')))', t||'_read', t);
    execute format('grant select on camp.%I to authenticated', t);
  end loop;
end $$;

insert into acc.job_secrets(name, value) values ('wa_deliveries', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')) on conflict (name) do nothing;

select cron.schedule('wa-deliveries-daily', '45 0 * * *', $c$
  select net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/wa-deliveries-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select value from acc.job_secrets where name='wa_deliveries')),
    body := '{"mode":"daily"}'::jsonb, timeout_milliseconds := 150000);
$c$);

notify pgrst, 'reload schema';
