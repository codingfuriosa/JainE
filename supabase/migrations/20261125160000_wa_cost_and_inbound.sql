-- WHATSAPP COST AND REPLY TEXT (25 Nov 2026, Ayush: "I want 2, 3" from the Marketing data list).
--   camp.wa_cost_daily  Meta's pricing_analytics per WhatsApp account and day (the account's own time zone, IST): how many
--                       messages Meta charged, by category (MARKETING / UTILITY / AUTHENTICATION / SERVICE) and pricing type
--                       (REGULAR / FREE_ENTRY_POINT / FREE_CUSTOMER_SERVICE), and what they cost. Filled by wa-deliveries-sync.
--   camp.wa_inbound     every message a customer sends to a marketing WhatsApp number (text, button reply, media label),
--                       from the wa-replies webhook - only once the numbers are subscribed to JAIN-E's app at Meta.
create table if not exists camp.wa_cost_daily (
  waba_id      text    not null,
  day          date    not null,
  category     text    not null default '',
  pricing_type text    not null default '',
  volume       integer not null default 0,
  cost         numeric not null default 0,
  synced_at    timestamptz not null default now(),
  primary key (waba_id, day, category, pricing_type)
);
alter table camp.wa_cost_daily enable row level security;
drop policy if exists wa_cost_daily_read on camp.wa_cost_daily;
create policy wa_cost_daily_read on camp.wa_cost_daily for select to authenticated using (true);
grant select on camp.wa_cost_daily to authenticated;
grant all on camp.wa_cost_daily to service_role;

create table if not exists camp.wa_inbound (
  id              text primary key,                 -- Meta's message id
  waba_id         text,
  phone_number_id text,
  business_number text,
  from_phone      text not null,
  from_name       text,
  ts              timestamptz not null,
  kind            text,                              -- text, button, interactive, image, ...
  body            text,
  reply_to        text,                              -- the id of our message it answers (context.id), when given
  raw             jsonb,
  received_at     timestamptz not null default now()
);
create index if not exists wa_inbound_waba_ts on camp.wa_inbound (waba_id, ts desc);
alter table camp.wa_inbound enable row level security;
drop policy if exists wa_inbound_read on camp.wa_inbound;
create policy wa_inbound_read on camp.wa_inbound for select to authenticated using (app.has_module('campaigns') or app.has_module('wa_templates'));
grant select on camp.wa_inbound to authenticated;
grant all on camp.wa_inbound to service_role;
notify pgrst, 'reload schema';
