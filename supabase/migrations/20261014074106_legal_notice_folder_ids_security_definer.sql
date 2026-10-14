-- THE UPLOAD DIALOG HAS TO KNOW WHICH FOLDER IS THE NOTICE FOLDER, WHATEVER THE CALLER CAN READ.
--
-- Uploading to Legal Notice asks for the file and nothing else; every other field is hidden. The
-- page decides that by calling this function and comparing the selected folder against what comes
-- back. It was SECURITY INVOKER, and doc.folders has row-level security, so a caller without a
-- doc role got an empty list and was quietly shown the full form instead - the one case the
-- feature exists for.
--
-- SECURITY DEFINER is safe here because the answer carries nothing: it is the id of a folder
-- whose name is already on screen, and knowing it grants no access to anything inside it. The
-- documents in it are still protected by their own policies.
create or replace function acc.legal_notice_folder_ids()
returns table(folder_id bigint)
language sql
stable
security definer
set search_path to 'doc','acc','public'
as $function$
  with recursive root as (
    select f.id from doc.folders f
    where f.department = 'Legal' and f.name = 'Legal Notice' and f.parent_id is null
    union all
    select c.id from doc.folders c join root r on c.parent_id = r.id
  )
  select id from root
$function$;

revoke all on function acc.legal_notice_folder_ids() from public, anon;
grant execute on function acc.legal_notice_folder_ids() to authenticated;

comment on function acc.legal_notice_folder_ids() is
  'The Legal Notice folder and every folder beneath it. Used by the enqueue trigger and by the '
  'upload dialog, which hides every field except the file when the target is one of these. '
  'SECURITY DEFINER so the dialog works for any signed-in user; the ids disclose nothing.';
