-- Referrals: one CRM lead per referral, however many projects were ticked (6 Oct 2026).
-- The highest-priced of the projects chosen decides the lead's business unit (and so its sales
-- person); the others are named in the remarks. Price = the "onwards" price on the project cards
-- (CONS_ONGOING); a project without one ranks below every priced project.

alter table cust.referral_projects add column if not exists price_from numeric;
update cust.referral_projects p set price_from = v.price, updated_at = now()
  from (values ('Dream One', 9800000), ('Dream Valley', 7200000), ('Dream Gurukul', 5000000),
               ('Dream Eco City', 3500000), ('Dream World City', 2750000)) v(name, price)
 where p.name = v.name;

alter table cust.referrals add column if not exists referral_project_ids bigint[];
update cust.referrals set referral_project_ids = array[referral_project_id]
 where referral_project_ids is null and referral_project_id is not null;

-- The main project is the dearest of the ones chosen.
create or replace function cust.referral_main_project() returns trigger
language plpgsql security definer set search_path = cust, public as $$
begin
  if new.referral_project_ids is not null and cardinality(new.referral_project_ids) > 0 then
    select p.id into new.referral_project_id
      from cust.referral_projects p
     where p.id = any(new.referral_project_ids)
     order by p.price_from desc nulls last, p.sort, p.name
     limit 1;
  elsif new.referral_project_id is not null then
    new.referral_project_ids := array[new.referral_project_id];
  end if;
  return new;
end $$;
drop trigger if exists referral_main_project on cust.referrals;
create trigger referral_main_project before insert on cust.referrals
  for each row execute function cust.referral_main_project();

-- A customer editing a referral cannot change its projects either.
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
    new.referral_project_id := old.referral_project_id; new.referral_project_ids := old.referral_project_ids;
    new.privacy_accepted := old.privacy_accepted;
  end if;
  return new;
end $$;

-- The lead: the main project's business unit; remarks name the main project, the others, then
-- the customer's note. Plain ASCII separators (a "·" drew a bare 400 from the webhook).
create or replace function cust.referral_crm_send(p_id bigint) returns bigint
language plpgsql security definer set search_path = cust, public as $$
declare cfg record; r record; req bigint; others text;
begin
  select * into cfg from cust.referral_crm_config where id = 1;
  if cfg is null or not cfg.enabled then return null; end if;
  select f.id, f.prospect_name, f.prospect_phone, f.prospect_email, f.notes, f.privacy_accepted, f.deleted_at,
         f.referral_project_id, f.referral_project_ids,
         c.full_name, c.email, c.phone, p.business_unit_id, p.name project_name
    into r
    from cust.referrals f
    join cust.units u on u.id = f.unit_id
    join cust.customers c on c.id = u.customer_id
    left join cust.referral_projects p on p.id = f.referral_project_id
   where f.id = p_id;
  if r is null or r.deleted_at is not null or not r.privacy_accepted then return null; end if;
  select string_agg(p.name, ', ' order by p.price_from desc nulls last, p.sort, p.name) into others
    from cust.referral_projects p
   where p.id = any(coalesce(r.referral_project_ids, '{}')) and p.id is distinct from r.referral_project_id;
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
      'referred_email', nullif(trim(coalesce(r.prospect_email, '')), ''),
      'remarks', nullif(concat_ws(' - ', 'Interested in ' || r.project_name, 'also interested in ' || others,
                                  nullif(trim(coalesce(r.notes, '')), '')), ''),
      'privacy_policy_accepted', true)),
    timeout_milliseconds := 20000);
  perform set_config('app.referral_crm', 'on', true);
  update cust.referrals set crm_status = 'sending', crm_request_id = req, crm_error = null, crm_queued_at = now(),
         crm_attempts = crm_attempts + 1 where id = p_id;
  perform set_config('app.referral_crm', '', true);
  return req;
end $$;
revoke all on function cust.referral_crm_send(bigint) from public, anon, authenticated;
