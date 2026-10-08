-- Customer referrals become CRM leads (realtybucket, POST /webhook/referral_create), 6 Oct 2026.
--
-- The customer picks the project their friend is interested in (cust.referral_projects: name,
-- location and the CRM's business_unit_id, which decides the sales person the lead goes to) and
-- confirms consent. The referral is saved here first; a trigger then posts it to the CRM from the
-- database, so the customer's browser is not involved and the referrer's name, email and phone come
-- from cust.customers - not from anything the customer's browser sends. pg_net answers later, so
-- cust.referral_crm_collect() (pg_cron, every minute) records the CRM's lead id or its error.
-- Nothing is sent while cust.referral_crm_config.enabled is false.

-- ---------- the projects a friend can be referred to ----------
create table if not exists cust.referral_projects(
  id bigserial primary key,
  name text not null,                 -- as customers see it, Title Case
  location text,
  business_unit_id int,               -- the CRM's business unit
  active boolean not null default true,
  sort int not null default 100,
  updated_at timestamptz not null default now()
);
alter table cust.referral_projects enable row level security;
drop policy if exists referral_projects_read on cust.referral_projects;
create policy referral_projects_read on cust.referral_projects for select to authenticated using (true);
drop policy if exists referral_projects_staff on cust.referral_projects;
create policy referral_projects_staff on cust.referral_projects for all to authenticated
  using (app.is_custportal_staff()) with check (app.is_custportal_staff());
grant select on cust.referral_projects to authenticated;
grant insert, update, delete on cust.referral_projects to authenticated;
grant usage, select on sequence cust.referral_projects_id_seq to authenticated;

insert into cust.referral_projects(name, location, business_unit_id, active, sort)
select * from (values
  ('Dream Gurukul',           'Doltala, Madhyamgram', null::int, true,  10),
  ('Dream Exotica',           'Madhyamgram',          null::int, true,  20),
  ('Dream World City',        'Joka',                 null::int, true,  30),
  ('Dream One',               'New Town',             null::int, true,  40),
  ('Dream Residency Manor',   'Rajarhat',             null::int, true,  50),
  ('Dream Eco City',          'Durgapur',             null::int, true,  60),
  ('Dream Eco City Bungalows','Durgapur',             null::int, true,  70),
  ('Dream Valley',            'Siliguri',             null::int, true,  80)
) v(name, location, business_unit_id, active, sort)
where not exists (select 1 from cust.referral_projects);

-- ---------- what a referral carries now ----------
alter table cust.referrals
  add column if not exists referral_project_id bigint references cust.referral_projects(id),
  add column if not exists privacy_accepted boolean not null default false,
  add column if not exists crm_status text,            -- null (not sent) | sending | sent | failed
  add column if not exists crm_request_id bigint,
  add column if not exists crm_lead_id bigint,
  add column if not exists crm_error text,
  add column if not exists crm_sent_at timestamptz,
  add column if not exists crm_queued_at timestamptz,
  add column if not exists crm_attempts int not null default 0;

-- One row: on/off and where to post.
create table if not exists cust.referral_crm_config(
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  url text not null default 'https://www.realtybucket.com/webhook/referral_create'
);
insert into cust.referral_crm_config(id) values (1) on conflict do nothing;
alter table cust.referral_crm_config enable row level security;
revoke all on cust.referral_crm_config from anon, authenticated;

-- The CRM columns are the database's to write. A customer inserting or editing a referral cannot
-- set them (nor mark one as already sent, which would stop it ever reaching the CRM).
create or replace function cust.referral_crm_guard() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.referral_crm', true), '') = 'on' or app.is_custportal_staff() then return new; end if;
  if tg_op = 'INSERT' then
    new.crm_status := null; new.crm_request_id := null; new.crm_lead_id := null;
    new.crm_error := null; new.crm_sent_at := null; new.crm_queued_at := null; new.crm_attempts := 0;
  else
    new.crm_status := old.crm_status; new.crm_request_id := old.crm_request_id; new.crm_lead_id := old.crm_lead_id;
    new.crm_error := old.crm_error; new.crm_sent_at := old.crm_sent_at; new.crm_queued_at := old.crm_queued_at; new.crm_attempts := old.crm_attempts;
    new.referral_project_id := old.referral_project_id; new.privacy_accepted := old.privacy_accepted;
  end if;
  return new;
end $$;
drop trigger if exists referral_crm_guard on cust.referrals;
create trigger referral_crm_guard before insert or update on cust.referrals
  for each row execute function cust.referral_crm_guard();

-- Posts one referral to the CRM. Returns the pg_net request id, or null when it was not sent.
create or replace function cust.referral_crm_send(p_id bigint) returns bigint
language plpgsql security definer set search_path = cust, public as $$
declare cfg record; r record; req bigint;
begin
  select * into cfg from cust.referral_crm_config where id = 1;
  if cfg is null or not cfg.enabled then return null; end if;
  select f.id, f.prospect_name, f.prospect_phone, f.prospect_email, f.notes, f.privacy_accepted, f.deleted_at,
         c.full_name, c.email, c.phone, p.business_unit_id, p.name project_name
    into r
    from cust.referrals f
    join cust.units u on u.id = f.unit_id
    join cust.customers c on c.id = u.customer_id
    left join cust.referral_projects p on p.id = f.referral_project_id
   where f.id = p_id;
  if r is null or r.deleted_at is not null or not r.privacy_accepted then return null; end if;
  req := net.http_post(
    url := cfg.url,
    headers := '{"Content-Type":"application/json","Accept":"application/json"}'::jsonb,
    body := jsonb_strip_nulls(jsonb_build_object(
      'referrer_name',  r.full_name,
      'referrer_email', r.email,
      'referrer_phone', r.phone,
      'business_unit_id', r.business_unit_id,
      'referred_name',  r.prospect_name,
      'referred_phone', r.prospect_phone,
      'referred_email', nullif(r.prospect_email, ''),
      'remarks', nullif(concat_ws(' · ', 'Interested in ' || r.project_name, nullif(r.notes, '')), ''),
      'privacy_policy_accepted', true)),
    timeout_milliseconds := 20000);
  perform set_config('app.referral_crm', 'on', true);
  update cust.referrals set crm_status = 'sending', crm_request_id = req, crm_error = null, crm_queued_at = now(),
         crm_attempts = crm_attempts + 1 where id = p_id;
  perform set_config('app.referral_crm', '', true);
  return req;
end $$;
revoke all on function cust.referral_crm_send(bigint) from public, anon, authenticated;

-- A new referral goes to the CRM straight away. A failure to queue it must never lose the referral.
create or replace function cust.referral_crm_on_insert() returns trigger
language plpgsql security definer set search_path = cust, public as $$
begin
  begin perform cust.referral_crm_send(new.id); exception when others then null; end;
  return new;
end $$;
drop trigger if exists referral_crm_on_insert on cust.referrals;
create trigger referral_crm_on_insert after insert on cust.referrals
  for each row execute function cust.referral_crm_on_insert();

-- Reads the CRM's answers. Success: {"success":true,"referred_lead_id":12345}. Anything else, or no
-- answer within 5 minutes, is a failure with the reason kept for the admin screen.
create or replace function cust.referral_crm_collect() returns int
language plpgsql security definer set search_path = cust, public as $$
declare r record; n int := 0; body jsonb; ok boolean;
begin
  perform set_config('app.referral_crm', 'on', true);
  for r in
    select f.id, f.crm_request_id, f.crm_queued_at, h.status_code, h.content, h.error_msg, h.timed_out
      from cust.referrals f left join net._http_response h on h.id = f.crm_request_id
     where f.crm_status = 'sending'
  loop
    if r.status_code is null and r.error_msg is null and coalesce(r.timed_out, false) = false then
      if coalesce(r.crm_queued_at, now()) < now() - interval '5 minutes' then
        update cust.referrals set crm_status = 'failed', crm_error = 'No answer from the CRM' where id = r.id; n := n + 1;
      end if;
      continue;
    end if;
    body := null; begin body := r.content::jsonb; exception when others then body := null; end;
    ok := r.status_code between 200 and 299 and coalesce((body->>'success')::boolean, false);
    if ok then
      update cust.referrals set crm_status = 'sent', crm_lead_id = nullif(body->>'referred_lead_id','')::bigint,
             crm_sent_at = now(), crm_error = null where id = r.id;
    else
      update cust.referrals set crm_status = 'failed',
             crm_error = left(coalesce(body->>'message', r.error_msg, case when r.timed_out then 'Timed out' end,
                                       'HTTP ' || r.status_code || ': ' || left(coalesce(r.content,''), 200)), 300)
       where id = r.id;
    end if;
    n := n + 1;
  end loop;
  perform set_config('app.referral_crm', '', true);
  return n;
end $$;
revoke all on function cust.referral_crm_collect() from public, anon, authenticated;

-- "Send again" in Customer Portal Admin > Referrals, for one that failed or was saved while sending
-- was off.
create or replace function cust.referral_crm_retry(p_id bigint) returns boolean
language plpgsql security definer set search_path = cust, public as $$
begin
  if not app.is_custportal_staff() then raise exception 'Not allowed.'; end if;
  if exists (select 1 from cust.referrals where id = p_id and crm_status in ('sending','sent')) then
    raise exception 'This referral is already in the CRM.';
  end if;
  return cust.referral_crm_send(p_id) is not null;
end $$;
revoke all on function cust.referral_crm_retry(bigint) from public, anon;
grant execute on function cust.referral_crm_retry(bigint) to authenticated;

select cron.schedule('referral-crm-collect', '* * * * *', $$select cust.referral_crm_collect()$$);
