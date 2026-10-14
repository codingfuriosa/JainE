-- Construction photos, four improvements (asked for on 2026-10-05):
--   1. Thumbnails. Each photo row gets thumb_path: a small JPEG made in the uploader's browser (or,
--      for photos uploaded before today, by the first staff browser that shows them). Lists and the
--      customer gallery load these instead of the full-size file.
--   2. Server-side clean-up. A photo that is removed or replaced keeps its file for 30 days; after
--      that a daily job (workflow-mailer, type 'media_purge') deletes the file and its thumbnail
--      from S3 and stamps purged_at. Until now the browser that removed it deleted the file, and a
--      closed tab left it behind for good.
--   3. (screen only) "To retake" list for the uploader.
--   4. Approver daily summary with a 2-day overdue flag, and a backup approver
--      (module 'custportal_photo_backup'): may approve like an approver, but is only told when
--      something has waited more than 2 days - or about everything, if there is no approver at all.

-- ---------- 1. thumbnails ----------
alter table cust.unit_photos    add column if not exists thumb_path text, add column if not exists purged_at timestamptz;
alter table cust.tower_photos   add column if not exists thumb_path text, add column if not exists purged_at timestamptz;
alter table cust.floor_photos   add column if not exists thumb_path text, add column if not exists purged_at timestamptz;
alter table cust.project_photos add column if not exists thumb_path text, add column if not exists purged_at timestamptz;

-- A thumbnail may be viewed by whoever may view its photo.
create or replace function app.s3_key_allowed(p_action text, p_key text)
returns boolean language plpgsql stable set search_path = app, public as $function$
declare
  k text := coalesce(p_key, '');
  sp text;
  m text[];
begin
  if auth.uid() is null or k = '' or k like '%..%' then return false; end if;
  if app.is_s3_staff() then return true; end if;

  if p_action = 'get' then
    sp := 's3:' || k;
    return exists (select 1 from cust.unit_photos            where storage_path = sp or thumb_path = sp)
        or exists (select 1 from cust.tower_photos           where storage_path = sp or thumb_path = sp)
        or exists (select 1 from cust.floor_photos           where storage_path = sp or thumb_path = sp)
        or exists (select 1 from cust.project_photos         where storage_path = sp or thumb_path = sp)
        or exists (select 1 from cust.customer_documents     where storage_path = sp)
        or exists (select 1 from cust.project_documents      where storage_path = sp)
        or exists (select 1 from cust.floor_plans            where storage_path = sp)
        or exists (select 1 from cust.process_videos         where storage_path = sp)
        or exists (select 1 from cust.inspection_checklists  where storage_path = sp)
        or exists (select 1 from cust.inspection_updates     where storage_path = sp)
        or exists (select 1 from cust.support_ticket_attachments where storage_path = sp)
        or exists (select 1 from cust.maintenance_payments   where receipt_storage_path = sp)
        or exists (select 1 from cust.modification_requests  where attachment_storage_path = sp)
        or exists (select 1 from cust.submeter_requests      where invoice_storage_path = sp)
        or exists (select 1 from cust.payment_settings       where qr_storage_path = sp);
  end if;

  if p_action = 'put' then
    m := regexp_match(k, '^portal/customer-portal/units/([0-9]+)/(maintenance-payment-receipt|modification-request)/[^/]+$');
    if m is not null then
      return exists (select 1 from cust.units u where u.id = m[1]::bigint and u.deleted_at is null
                       and u.customer_id = app.current_customer_id());
    end if;
    m := regexp_match(k, '^portal/customer-portal/support-tickets/([0-9]+)/[^/]+$');
    if m is not null then
      return exists (select 1 from cust.support_tickets t join cust.units u on u.id = t.unit_id
                      where t.id = m[1]::bigint and t.deleted_at is null and u.deleted_at is null
                        and u.customer_id = app.current_customer_id());
    end if;
    return false;
  end if;

  return false;
end $function$;

-- Records a thumbnail made later for a photo that has none (photos uploaded before thumbnails).
create or replace function cust.set_media_thumb(p_table text, p_id bigint, p_thumb text)
returns boolean language plpgsql security definer set search_path = cust, public as $function$
declare n int;
begin
  if not (app.is_custportal_media_editor() or app.is_photo_approver()) then raise exception 'Not allowed.'; end if;
  if p_table not in ('project_photos','tower_photos','floor_photos','unit_photos') then raise exception 'Unknown media table %', p_table; end if;
  if p_thumb is null or p_thumb not like 's3:portal/customer-portal/%' or p_thumb like '%..%' then raise exception 'Bad thumbnail path'; end if;
  execute format('update cust.%I set thumb_path = $1 where id = $2 and thumb_path is null and deleted_at is null', p_table)
    using p_thumb, p_id;
  get diagnostics n = row_count;
  return n > 0;
end $function$;
revoke all on function cust.set_media_thumb(text, bigint, text) from public, anon;
grant execute on function cust.set_media_thumb(text, bigint, text) to authenticated;

-- ---------- 2. server-side clean-up ----------
-- Removed (or replaced) more than 30 days ago and not purged yet. A file still used by a live row
-- - as its photo or its thumbnail - is never offered for deletion.
create or replace function cust.media_purge_due(p_limit int default 200)
returns table(tbl text, id bigint, paths text[])
language sql stable security definer set search_path = cust, public as $function$
  with gone as (
    select 'unit_photos' tbl, m.id, m.storage_path, m.thumb_path, m.deleted_at from cust.unit_photos m where m.deleted_at < now() - interval '30 days' and m.purged_at is null
    union all select 'tower_photos', m.id, m.storage_path, m.thumb_path, m.deleted_at from cust.tower_photos m where m.deleted_at < now() - interval '30 days' and m.purged_at is null
    union all select 'floor_photos', m.id, m.storage_path, m.thumb_path, m.deleted_at from cust.floor_photos m where m.deleted_at < now() - interval '30 days' and m.purged_at is null
    union all select 'project_photos', m.id, m.storage_path, m.thumb_path, m.deleted_at from cust.project_photos m where m.deleted_at < now() - interval '30 days' and m.purged_at is null
  ), live as (
    select storage_path p from cust.unit_photos where deleted_at is null union select thumb_path from cust.unit_photos where deleted_at is null
    union select storage_path from cust.tower_photos where deleted_at is null union select thumb_path from cust.tower_photos where deleted_at is null
    union select storage_path from cust.floor_photos where deleted_at is null union select thumb_path from cust.floor_photos where deleted_at is null
    union select storage_path from cust.project_photos where deleted_at is null union select thumb_path from cust.project_photos where deleted_at is null
  )
  select g.tbl, g.id,
         array(select x from unnest(array[g.storage_path, g.thumb_path]) x
                where x like 's3:%' and not exists (select 1 from live where live.p = x))
    from gone g order by g.deleted_at limit greatest(1, least(coalesce(p_limit, 200), 500));
$function$;

create or replace function cust.media_mark_purged(p_table text, p_ids bigint[])
returns int language plpgsql security definer set search_path = cust, public as $function$
declare n int;
begin
  if p_table not in ('project_photos','tower_photos','floor_photos','unit_photos') then raise exception 'Unknown media table %', p_table; end if;
  execute format('update cust.%I set purged_at = now() where id = any($1) and deleted_at < now() - interval ''30 days'' and purged_at is null', p_table)
    using p_ids;
  get diagnostics n = row_count;
  return n;
end $function$;

revoke all on function cust.media_purge_due(int) from public, anon, authenticated;
revoke all on function cust.media_mark_purged(text, bigint[]) from public, anon, authenticated;
grant execute on function cust.media_purge_due(int) to service_role;
grant execute on function cust.media_mark_purged(text, bigint[]) to service_role;

-- ---------- 4. backup approver ----------
create or replace function app.is_photo_approver()
returns boolean language sql stable security definer set search_path = adm, public as $function$
  select app.is_superadmin() or exists (
    select 1 from adm.users u where lower(u.email) = lower(app.current_user_email())
       and u.active is not false and u.modules && array['custportal_photo_approver','custportal_photo_backup']::text[])
$function$;

create or replace function app.is_custportal_media_editor()
returns boolean language sql stable security definer set search_path = adm, public as $function$
  select app.is_custportal_staff() or exists (
    select 1 from adm.users u where lower(u.email) = lower(app.current_user_email())
       and u.active and u.modules && array['custportal_photos','custportal_photo_approver','custportal_photo_backup']::text[])
$function$;

-- ---------- 4. daily summary ----------
-- Approvers: one notice a day while anything waits ("27 photos waiting · 12 over 2 days").
-- Backup approvers: only when something has waited over 2 days - unless there is no approver.
-- Nobody is counted their own uploads, which they may not review.
create or replace function cust.media_daily_digest()
returns int language plpgsql security definer set search_path = cust, public as $function$
declare who record; n int; vids int; over int; parts text; prim text; sent int := 0; noun text;
begin
  create temp table if not exists _media_pend(project text, created_at timestamptz, up text, vid boolean) on commit drop;
  truncate _media_pend;
  insert into _media_pend
    select trim(split_part(pr.name,'(',1)), m.created_at, lower(coalesce(m.uploaded_by,'')), m.file_type like 'video%'
      from cust.unit_photos m join cust.units u on u.id = m.unit_id join cust.projects pr on pr.id = u.project_id
     where m.status = 'pending' and m.deleted_at is null
    union all
    select trim(split_part(pr.name,'(',1)), m.created_at, lower(coalesce(m.uploaded_by,'')), m.file_type like 'video%'
      from cust.tower_photos m join cust.projects pr on pr.id = m.project_id where m.status = 'pending' and m.deleted_at is null
    union all
    select trim(split_part(pr.name,'(',1)), m.created_at, lower(coalesce(m.uploaded_by,'')), m.file_type like 'video%'
      from cust.floor_photos m join cust.projects pr on pr.id = m.project_id where m.status = 'pending' and m.deleted_at is null
    union all
    select trim(split_part(pr.name,'(',1)), m.created_at, lower(coalesce(m.uploaded_by,'')), m.file_type like 'video%'
      from cust.project_photos m join cust.projects pr on pr.id = m.project_id where m.status = 'pending' and m.deleted_at is null;

  select string_agg(coalesce(nullif(u.full_name,''), u.email), ', ') into prim
    from adm.users u where u.active is not false and 'custportal_photo_approver' = any(u.modules);

  for who in
    select lower(u.email) email, ('custportal_photo_approver' = any(u.modules)) is_primary
      from adm.users u
     where u.active is not false and u.modules && array['custportal_photo_approver','custportal_photo_backup']::text[]
  loop
    select count(*), count(*) filter (where vid), count(*) filter (where created_at < now() - interval '2 days')
      into n, vids, over from _media_pend where up <> who.email;
    if coalesce(n,0) = 0 then continue; end if;
    if not who.is_primary and prim is not null and over = 0 then continue; end if;

    if who.is_primary or prim is null then
      select string_agg(project || ': ' || c, ', ' order by c desc) into parts
        from (select project, count(*) c from _media_pend where up <> who.email group by project) s;
      noun := case when vids = n then 'videos' when vids = 0 then 'photos' else 'photos and videos' end;
      if n = 1 then noun := case when vids = 1 then 'video' else 'photo' end; end if;
      insert into acc.notifications(recipient, kind, title, body, urgent)
      values (who.email, 'media_digest',
              n || ' ' || noun || ' waiting for approval' || case when over > 0 then ' · ' || over || ' over 2 days' else '' end,
              'Waiting: ' || parts || '.', over > 0);
    else
      select string_agg(project || ': ' || c, ', ' order by c desc) into parts
        from (select project, count(*) c from _media_pend where up <> who.email and created_at < now() - interval '2 days' group by project) s;
      insert into acc.notifications(recipient, kind, title, body, urgent)
      values (who.email, 'media_digest',
              'Backup approver: ' || over || ' waiting over 2 days',
              'Not reviewed yet by ' || prim || '. Waiting: ' || parts || '.', true);
    end if;
    sent := sent + 1;
  end loop;
  return sent;
end $function$;
revoke all on function cust.media_daily_digest() from public, anon, authenticated;

-- The summary is emailed like the other photo notices.
drop trigger if exists media_notice_email on acc.notifications;
create trigger media_notice_email after insert on acc.notifications
  for each row when (new.kind in ('media_pending', 'media_rejected', 'media_published', 'media_digest'))
  execute function cust.media_notice_email();

-- 10:00 IST every day: the summary. 02:30 IST: the clean-up.
select cron.schedule('media-daily-digest', '30 4 * * *', $$select cust.media_daily_digest()$$);
select cron.schedule('media-purge-daily', '0 21 * * *', $$
  select net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/workflow-mailer',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n"}'::jsonb,
    body := '{"type":"media_purge"}'::jsonb,
    timeout_milliseconds := 120000)
$$);
