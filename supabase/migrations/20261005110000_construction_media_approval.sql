-- Construction photos and videos are approved before customers see them.
--
-- The site supervisor uploads (Customer Portal Admin > Photos & Videos); nothing he uploads reaches
-- a customer until a photo approver (post-sales manager) publishes it. The approver can reject with a
-- reason - the uploader is told why in the notification bell and the file is removed from S3 - and
-- can unpublish something already live.
--
--   status   pending -> published | rejected      published -> unpublished -> published | rejected
--
-- The rule is held by the database, not only the screen: several departments count as Customer
-- Portal staff and can write these tables directly, so
--   * every new row starts 'pending', whoever inserts it and whatever it says;
--   * status / reviewer columns change only inside cust.review_media(), which checks that the caller
--     is an approver and is not approving their own upload (an administrator may);
--   * customers read only 'published' rows.
-- Photo approvers: the 'custportal_photo_approver' module (Control Panel > Module Access), and
-- administrators.

-- 1. status and review columns. Flat photos already uploaded start as pending, so they are reviewed
--    before customers see them (1 Oct 2026: problems were found in them, and they were already
--    hidden). Block, floor and project photos customers can already see stay published, so nothing
--    disappears from a customer's screen the moment this is applied.
do $$ declare t text; begin
  foreach t in array array['project_photos','tower_photos','floor_photos','unit_photos'] loop
    execute format('alter table cust.%I add column if not exists status text not null default %L', t, 'pending');
    execute format('alter table cust.%I add column if not exists reviewed_by text', t);
    execute format('alter table cust.%I add column if not exists reviewed_at timestamptz', t);
    execute format('alter table cust.%I add column if not exists review_note text', t);
    execute format('alter table cust.%I drop constraint if exists %I', t, t||'_status_check');
    execute format('alter table cust.%I add constraint %I check (status in (''pending'',''published'',''rejected'',''unpublished''))', t, t||'_status_check');
    execute format('create index if not exists %I on cust.%I(status) where deleted_at is null', t||'_status_idx', t);
  end loop;
end $$;
update cust.project_photos set status = 'published', reviewed_by = 'already live before approval (2026-10-05)', reviewed_at = now() where deleted_at is null and status = 'pending';
update cust.tower_photos   set status = 'published', reviewed_by = 'already live before approval (2026-10-05)', reviewed_at = now() where deleted_at is null and status = 'pending';
update cust.floor_photos   set status = 'published', reviewed_by = 'already live before approval (2026-10-05)', reviewed_at = now() where deleted_at is null and status = 'pending';

-- 2. who may approve
create or replace function app.is_photo_approver() returns boolean
language sql stable security definer set search_path = adm, public as $$
  select app.is_superadmin() or exists (
    select 1 from adm.users u where lower(u.email) = lower(app.current_user_email())
       and u.active is not false and 'custportal_photo_approver' = any(u.modules))
$$;
grant execute on function app.is_photo_approver() to authenticated;

-- An approver needs to read the photo tables and the flat list like the uploader does.
create or replace function app.is_custportal_media_editor() returns boolean
language sql stable security definer set search_path = adm, public as $$
  select app.is_custportal_staff() or exists (
    select 1 from adm.users u where lower(u.email) = lower(app.current_user_email())
       and u.active and u.modules && array['custportal_photos','custportal_photo_approver']::text[])
$$;

-- 3. the guard
create or replace function cust.media_status_guard() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.media_review', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    new.status := 'pending'; new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;
    return new;
  end if;
  if new.status is distinct from old.status or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at or new.review_note is distinct from old.review_note then
    raise exception 'Photos and videos are published or rejected only from Review (Customer Portal Admin > Photos & Videos).';
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['project_photos','tower_photos','floor_photos','unit_photos'] loop
    execute format('drop trigger if exists media_status_guard on cust.%I', t);
    execute format('create trigger media_status_guard before insert or update on cust.%I for each row execute function cust.media_status_guard()', t);
  end loop;
end $$;

-- 4. customers see published only (otherwise the same policies as before)
drop policy if exists project_photos_customer_select on cust.project_photos;
create policy project_photos_customer_select on cust.project_photos for select using (
  deleted_at is null and status = 'published' and exists (
    select 1 from cust.units u where u.project_id = project_photos.project_id
       and u.customer_id = app.current_customer_id() and u.deleted_at is null));
drop policy if exists tower_photos_customer_select on cust.tower_photos;
create policy tower_photos_customer_select on cust.tower_photos for select using (
  deleted_at is null and status = 'published' and exists (
    select 1 from cust.units u where u.project_id = tower_photos.project_id and u.tower = tower_photos.tower
       and u.customer_id = app.current_customer_id() and u.deleted_at is null));
drop policy if exists floor_photos_customer_select on cust.floor_photos;
create policy floor_photos_customer_select on cust.floor_photos for select using (
  deleted_at is null and status = 'published' and exists (
    select 1 from cust.units u where u.project_id = floor_photos.project_id
       and substring(u.unit_code, '^[0-9]+') = floor_photos.floor_no
       and u.customer_id = app.current_customer_id() and u.deleted_at is null));
drop policy if exists unit_photos_customer_select on cust.unit_photos;
create policy unit_photos_customer_select on cust.unit_photos for select using (
  deleted_at is null and status = 'published' and exists (
    select 1 from cust.units u where u.id = unit_photos.unit_id
       and u.customer_id = app.current_customer_id() and u.deleted_at is null
       and cust.feature_on('flat_photos', u.project_id, u.tower)));

-- 5. where a batch of rows is, in words: "DREAM GURUKUL · BLOCK B · 5D"
create or replace function cust.media_place(p_table text, p_ids bigint[]) returns text
language plpgsql stable security definer set search_path = cust, public as $$
declare places text[];
begin
  if p_table = 'unit_photos' then
    select array_agg(distinct coalesce(split_part(pr.name,'(',1),'') || ' · ' || coalesce(u.tower,'') || ' · ' || u.unit_code) into places
      from cust.unit_photos m join cust.units u on u.id = m.unit_id join cust.projects pr on pr.id = u.project_id where m.id = any(p_ids);
  elsif p_table = 'tower_photos' then
    select array_agg(distinct coalesce(split_part(pr.name,'(',1),'') || ' · ' || m.tower) into places
      from cust.tower_photos m join cust.projects pr on pr.id = m.project_id where m.id = any(p_ids);
  elsif p_table = 'floor_photos' then
    select array_agg(distinct coalesce(split_part(pr.name,'(',1),'') || ' · Floor ' || m.floor_no) into places
      from cust.floor_photos m join cust.projects pr on pr.id = m.project_id where m.id = any(p_ids);
  else
    select array_agg(distinct coalesce(split_part(pr.name,'(',1),'') || ' · whole project') into places
      from cust.project_photos m join cust.projects pr on pr.id = m.project_id where m.id = any(p_ids);
  end if;
  if places is null then return ''; end if;
  return trim(places[1]) || case when array_length(places,1) > 1 then ' +' || (array_length(places,1)-1) || ' more' else '' end;
end $$;
revoke all on function cust.media_place(text, bigint[]) from public, anon, authenticated;

-- 6. publish / reject / unpublish. Returns the rows it changed (the screen deletes a rejected file
--    from S3 with them). Rows the caller may not review - their own upload, or a wrong status - are
--    simply not changed.
create or replace function cust.review_media(p_table text, p_ids bigint[], p_decision text, p_note text default null)
returns table(id bigint, storage_path text, uploaded_by text)
language plpgsql security definer set search_path = cust, public as $$
declare me text := lower(app.current_user_email()); admin boolean := app.is_superadmin();
        new_status text; from_status text[]; note text := nullif(trim(coalesce(p_note,'')), '');
        rec record; place text; noun text;
begin
  if not app.is_photo_approver() then raise exception 'Only a photo approver can publish or reject construction photos.'; end if;
  if p_table not in ('project_photos','tower_photos','floor_photos','unit_photos') then raise exception 'Unknown media table %', p_table; end if;
  if p_decision = 'publish' then new_status := 'published'; from_status := array['pending','unpublished'];
  elsif p_decision = 'reject' then new_status := 'rejected'; from_status := array['pending','published','unpublished'];
    if note is null then raise exception 'Please give a reason for rejecting.'; end if;
  elsif p_decision = 'unpublish' then new_status := 'unpublished'; from_status := array['published'];
  else raise exception 'Unknown decision %', p_decision; end if;

  perform set_config('app.media_review', 'on', true);
  return query execute format(
    'update cust.%I m set status = $1, reviewed_by = $2, reviewed_at = now(), review_note = $3
      where m.id = any($4) and m.deleted_at is null and m.status = any($5)
        and ($6 or lower(coalesce(m.uploaded_by, '''')) <> $2)
      returning m.id, m.storage_path, m.uploaded_by', p_table)
    using new_status, me, case when p_decision = 'reject' then note else null end, p_ids, from_status, admin;
  perform set_config('app.media_review', '', true);

  -- Tell each uploader once per decision (not per photo).
  if p_decision in ('publish','reject') then
    for rec in execute format(
      'select lower(m.uploaded_by) who, array_agg(m.id) ids, count(*) n,
              count(*) filter (where m.file_type like ''video%%'') vids
         from cust.%I m where m.id = any($1) and m.status = $2 and m.reviewed_by = $3
          and m.reviewed_at > now() - interval ''1 minute'' and m.uploaded_by is not null
        group by lower(m.uploaded_by)', p_table) using p_ids, new_status, me
    loop
      place := cust.media_place(p_table, rec.ids);
      noun := case when rec.vids = rec.n then (case when rec.n = 1 then 'video' else 'videos' end)
                   when rec.vids = 0 then (case when rec.n = 1 then 'photo' else 'photos' end)
                   else 'photos and videos' end;
      insert into acc.notifications(recipient, kind, title, body)
      values (rec.who,
              case when p_decision = 'reject' then 'media_rejected' else 'media_published' end,
              case when p_decision = 'reject'
                   then 'Rejected: ' || rec.n || ' ' || noun || ' · ' || place
                   else 'Published: ' || rec.n || ' ' || noun || ' · ' || place end,
              case when p_decision = 'reject' then 'Reason: ' || note || ' — please upload a better one.'
                   else 'Customers can now see them in Construction Progress.' end);
    end loop;
  end if;
end $$;
revoke all on function cust.review_media(text, bigint[], text, text) from public, anon;
grant execute on function cust.review_media(text, bigint[], text, text) to authenticated;

-- 7. after an upload batch: tell every approver once.
create or replace function cust.notify_media_uploaded(p_table text, p_ids bigint[]) returns integer
language plpgsql security definer set search_path = cust, public as $$
declare me text := lower(app.current_user_email()); n int; vids int; place text; noun text; who text; sent int := 0;
begin
  if not app.is_custportal_media_editor() then raise exception 'Not allowed.'; end if;
  if p_table not in ('project_photos','tower_photos','floor_photos','unit_photos') then raise exception 'Unknown media table %', p_table; end if;
  execute format('select count(*), count(*) filter (where file_type like ''video%%'') from cust.%I
                   where id = any($1) and status = ''pending'' and lower(coalesce(uploaded_by,'''')) = $2
                     and created_at > now() - interval ''1 day''', p_table)
    into n, vids using p_ids, me;
  if coalesce(n,0) = 0 then return 0; end if;
  place := cust.media_place(p_table, p_ids);
  noun := case when vids = n then (case when n = 1 then 'video' else 'videos' end)
               when vids = 0 then (case when n = 1 then 'photo' else 'photos' end) else 'photos and videos' end;
  for who in select lower(u.email) from adm.users u
              where u.active is not false and 'custportal_photo_approver' = any(u.modules) and lower(u.email) <> me
  loop
    insert into acc.notifications(recipient, kind, title, body)
    values (who, 'media_pending', 'To review: ' || n || ' ' || noun || ' · ' || place,
            coalesce((select a.full_name from adm.users a where lower(a.email) = me), me) || ' uploaded them and they are waiting for your approval.');
    sent := sent + 1;
  end loop;
  return sent;
end $$;
revoke all on function cust.notify_media_uploaded(text, bigint[]) from public, anon;
grant execute on function cust.notify_media_uploaded(text, bigint[]) to authenticated;
