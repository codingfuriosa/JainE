-- Customer Portal: sign in with a one-time code sent by email, no passwords.
--
-- Staff-set passwords (customer-invite) meant someone creating and handing over a login for every
-- buyer one by one - 92 in Dream Gurukul alone, 3 done. Now the customer types their email, gets a
-- 6-digit code from the same Gmail account the staff password reset uses, and is signed in. The
-- login is created on their first successful code, and only for an email that already belongs to a
-- customer holding an active flat in a project switched on below. See supabase/functions/customer-otp.

-- Per-project switch: which projects' customers may sign in. Launch is Dream Gurukul only; turning
-- another project on is this one flag (Customer Portal Admin > Projects & Units).
alter table cust.projects add column if not exists customer_login boolean not null default false;
update cust.projects set customer_login = true where name ilike 'DREAM GURUKUL%' and deleted_at is null;

-- The codes. Only the hash is stored, and only the edge function (service role) ever reads or writes
-- this table: RLS on with no policies, and no grants to the browser roles.
create table if not exists cust.login_codes(
  id bigserial primary key,
  email text not null,
  customer_id bigint not null references cust.customers(id),
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists login_codes_email_idx on cust.login_codes(lower(email), created_at desc);
alter table cust.login_codes enable row level security;
revoke all on cust.login_codes from anon, authenticated;
revoke all on sequence cust.login_codes_id_seq from anon, authenticated;

-- Who may sign in: an active customer with this email who holds at least one live (not cancelled,
-- not deleted) flat in a project with customer_login on. The single place that rule lives - the
-- edge function asks this both before sending a code and again before signing anyone in.
create or replace function cust.login_customer_for_email(p_email text)
returns table(id bigint, email text, full_name text, auth_user_id uuid)
language sql stable security definer set search_path = cust, public as $$
  select c.id, c.email, c.full_name, c.auth_user_id
    from cust.customers c
   where lower(c.email) = lower(trim(p_email))
     and c.status = 'active' and c.deleted_at is null
     and exists (select 1 from cust.units u join cust.projects p on p.id = u.project_id
                  where u.customer_id = c.id and u.deleted_at is null and u.status <> 'cancelled'
                    and p.deleted_at is null and p.customer_login)
   limit 1
$$;

-- An auth account that already exists for this email (a first attempt that failed before linking,
-- say). A staff account is flagged so it is never turned into a customer login; one already linked
-- to a different customer is flagged too.
create or replace function cust.login_auth_user_for_email(p_email text)
returns table(id uuid, is_staff boolean, linked_customer_id bigint)
language sql stable security definer set search_path = cust, public as $$
  select u.id,
         exists (select 1 from adm.users a where lower(a.email) = lower(u.email))
           or exists (select 1 from adm.user_permissions a where lower(a.email) = lower(u.email)),
         (select c.id from cust.customers c where c.auth_user_id = u.id and c.deleted_at is null limit 1)
    from auth.users u
   where lower(u.email) = lower(trim(p_email))
   limit 1
$$;

revoke all on function cust.login_customer_for_email(text) from public, anon, authenticated;
revoke all on function cust.login_auth_user_for_email(text) from public, anon, authenticated;
grant execute on function cust.login_customer_for_email(text) to service_role;
grant execute on function cust.login_auth_user_for_email(text) to service_role;
