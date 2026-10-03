-- Customer sign-in is controlled per project AND per block, in the same place as the sections.
--
-- The first version (20260930110000) had a per-project On/Off switch on the Projects table
-- (cust.projects.customer_login). Staff want one control: Customer Portal Admin > Customer Features,
-- where each project and each block can have sections switched on or off. So sign-in becomes one more
-- row there - feature 'login' in cust.feature_access - resolved like every other: this block, then
-- the whole project, then the all-projects default, and off if nothing says otherwise.

alter table cust.feature_access drop constraint if exists feature_access_feature_check;
alter table cust.feature_access add constraint feature_access_feature_check check (feature in (
  'login','statement','progress','ledger','cost_sheet','inspection','documents','videos','support',
  'amenities','submeter','referrals','maintenance','modifications'));

-- The same resolution the portal does in custFeatureOn(), for use in SQL.
create or replace function cust.feature_on(p_feature text, p_project bigint, p_tower text)
returns boolean language sql stable security definer set search_path = cust, public as $$
  select coalesce(
    (select enabled from cust.feature_access where feature = p_feature and project_id = p_project and tower = p_tower),
    (select enabled from cust.feature_access where feature = p_feature and project_id = p_project and tower is null),
    (select enabled from cust.feature_access where feature = p_feature and project_id is null and tower is null),
    false)
$$;
grant execute on function cust.feature_on(text, bigint, text) to authenticated, service_role;

-- Carry the launch decision over: off by default, on for every project that had its switch on
-- (Dream Gurukul).
insert into cust.feature_access(feature, project_id, tower, enabled, updated_by)
values ('login', null, null, false, 'launch default')
on conflict do nothing;
insert into cust.feature_access(feature, project_id, tower, enabled, updated_by)
select 'login', id, null, true, 'launch default' from cust.projects where customer_login and deleted_at is null
on conflict do nothing;

-- Who may sign in: an active customer with a live flat in a project and block where sign-in is on.
create or replace function cust.login_customer_for_email(p_email text)
returns table(id bigint, email text, full_name text, auth_user_id uuid)
language sql stable security definer set search_path = cust, public as $$
  select c.id, c.email, c.full_name, c.auth_user_id
    from cust.customers c
   where lower(c.email) = lower(trim(p_email))
     and c.status = 'active' and c.deleted_at is null
     and exists (select 1 from cust.units u join cust.projects p on p.id = u.project_id
                  where u.customer_id = c.id and u.deleted_at is null and u.status <> 'cancelled'
                    and p.deleted_at is null and cust.feature_on('login', u.project_id, u.tower))
   limit 1
$$;

