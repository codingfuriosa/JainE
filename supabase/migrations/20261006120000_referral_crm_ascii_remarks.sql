-- Referral -> CRM: plain separator in remarks (6 Oct 2026).
-- The first test post to /webhook/referral_create was refused with a bare 400 while it carried an
-- empty referred_email and a "·" in the remarks; the same lead without both went through (lead
-- 719415). Empty fields were already left out (jsonb_strip_nulls + nullif); this drops the "·" that
-- the database itself adds, joining "Interested in <project>" and the customer's note with " - ".
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
      'referred_email', nullif(trim(coalesce(r.prospect_email, '')), ''),
      'remarks', nullif(concat_ws(' - ', 'Interested in ' || r.project_name, nullif(trim(coalesce(r.notes, '')), '')), ''),
      'privacy_policy_accepted', true)),
    timeout_milliseconds := 20000);
  perform set_config('app.referral_crm', 'on', true);
  update cust.referrals set crm_status = 'sending', crm_request_id = req, crm_error = null, crm_queued_at = now(),
         crm_attempts = crm_attempts + 1 where id = p_id;
  perform set_config('app.referral_crm', '', true);
  return req;
end $$;
revoke all on function cust.referral_crm_send(bigint) from public, anon, authenticated;
