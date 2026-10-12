-- Flat photos get their own switch in Customer Features, off everywhere for now.
--
-- 1 Oct 2026: staff found problems with the flat (unit) photos and asked that customers not see them
-- until they are sorted out. Rather than a one-off block, the customer read policy now asks the same
-- per-project / per-block rule as every other section ('flat_photos' in cust.feature_access), so
-- turning them back on - for one block or a whole project - is a dropdown in Customer Portal Admin,
-- not a migration. Block photos and the rest of Construction Progress are not affected. Staff still
-- see every photo through unit_photos_staff_all.

alter table cust.feature_access drop constraint if exists feature_access_feature_check;
alter table cust.feature_access add constraint feature_access_feature_check check (feature in (
  'login','statement','progress','flat_photos','ledger','cost_sheet','inspection','documents','videos',
  'support','amenities','submeter','referrals','maintenance','modifications'));

insert into cust.feature_access(feature, project_id, tower, enabled, updated_by)
values ('flat_photos', null, null, false, 'hidden 2026-10-01 at staff request')
on conflict do nothing;

drop policy if exists unit_photos_customer_select on cust.unit_photos;
create policy unit_photos_customer_select on cust.unit_photos for select
  using (
    deleted_at is null
    and exists (
      select 1 from cust.units u
       where u.id = unit_photos.unit_id
         and u.customer_id = app.current_customer_id()
         and u.deleted_at is null
         and cust.feature_on('flat_photos', u.project_id, u.tower)
    )
  );
