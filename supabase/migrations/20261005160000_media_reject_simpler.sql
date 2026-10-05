-- Construction photo approval, made quicker to use (asked for on 2026-10-05):
--   * Reject is one click: a reason may still be given, but is no longer required.
--   * A rejected file is kept in S3, and a rejected photo can still be published later -
--     a rejection is no longer the end of the road.
--   * What clears a rejected photo away is a new upload for the same place: the same flat and
--     section, the same block, the same floor, or the whole project. cust.replace_rejected_media()
--     retires the rejected ones there and hands back their files, which the uploader's browser then
--     removes from S3.

create or replace function cust.review_media(p_table text, p_ids bigint[], p_decision text, p_note text default null)
returns table(id bigint, storage_path text, uploaded_by text)
language plpgsql security definer set search_path = cust, public as $function$
declare me text := lower(app.current_user_email()); admin boolean := app.is_superadmin();
        new_status text; from_status text[]; note text := nullif(trim(coalesce(p_note,'')), '');
        rec record; place text; noun text;
begin
  if not app.is_photo_approver() then raise exception 'Only a photo approver can publish or reject construction photos.'; end if;
  if p_table not in ('project_photos','tower_photos','floor_photos','unit_photos') then raise exception 'Unknown media table %', p_table; end if;
  if p_decision = 'publish' then new_status := 'published'; from_status := array['pending','unpublished','rejected'];
  elsif p_decision = 'reject' then new_status := 'rejected'; from_status := array['pending','published','unpublished'];
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
              case when p_decision = 'reject'
                   then coalesce('Reason: ' || note || ' — ', '') || 'Please upload a better one; it will replace the rejected one.'
                   else 'Customers can now see them in Construction Progress.' end);
    end loop;
  end if;
end $function$;

-- Called by the uploader's browser right after an upload, with the ids it has just inserted.
-- Retires (soft-deletes) every rejected photo at the same place as one of them and returns the
-- retired files' paths for removal from S3. Only the caller's own fresh uploads count, so this
-- cannot be pointed at somebody else's place without uploading there.
create or replace function cust.replace_rejected_media(p_table text, p_ids bigint[])
returns table(storage_path text)
language plpgsql security definer set search_path = cust, public as $function$
declare me text := lower(app.current_user_email()); same text;
begin
  if not app.is_custportal_media_editor() then raise exception 'Not allowed.'; end if;
  same := case p_table
    when 'unit_photos'    then 'o.unit_id = n.unit_id and coalesce(o.area,''common'') = coalesce(n.area,''common'')'
    when 'tower_photos'   then 'o.project_id = n.project_id and o.tower = n.tower'
    when 'floor_photos'   then 'o.project_id = n.project_id and o.floor_no = n.floor_no'
    when 'project_photos' then 'o.project_id = n.project_id'
    else null end;
  if same is null then raise exception 'Unknown media table %', p_table; end if;
  return query execute format(
    'update cust.%1$I o set deleted_at = now(), deleted_by = $2
      where o.status = ''rejected'' and o.deleted_at is null
        and exists (select 1 from cust.%1$I n
                     where n.id = any($1) and n.deleted_at is null and n.status = ''pending''
                       and lower(coalesce(n.uploaded_by,'''')) = $2
                       and n.created_at > now() - interval ''1 day'' and n.id <> o.id and %2$s)
      returning o.storage_path', p_table, same)
    using p_ids, me;
end $function$;

revoke all on function cust.replace_rejected_media(text, bigint[]) from public, anon;
grant execute on function cust.replace_rejected_media(text, bigint[]) to authenticated;
