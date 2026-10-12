-- Customers see their own flat's photos as soon as they are uploaded.
--
-- unit_photos_customer_select also required units.floor_casting_completed_at to be set. The Photos &
-- Videos redesign (0b95991) dropped that wait from the screens - "if the photos exist they are
-- shown" - but not from this policy, and no unit has ever had a casting date (0 of 291). So every
-- flat photo was invisible to the customer it was taken for, while Staff preview, which reads
-- through the staff policy, showed them. On 29.09.2026 that was 12 photos of Dream Gurukul
-- B/2A, 2C and 2D.
--
-- Same policy otherwise: live row, and a live unit that belongs to the signed-in customer.

drop policy if exists unit_photos_customer_select on cust.unit_photos;
create policy unit_photos_customer_select on cust.unit_photos for select
  using (
    deleted_at is null
    and exists (
      select 1 from cust.units u
       where u.id = unit_photos.unit_id
         and u.customer_id = app.current_customer_id()
         and u.deleted_at is null
    )
  );
