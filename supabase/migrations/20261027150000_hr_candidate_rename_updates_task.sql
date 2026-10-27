/* A candidate's name edited in Interviews also renames their open approval task.

   Found while testing on 27 Oct 2026: a hand-added candidate typed as "Tow", corrected to "Two" with
   the new Edit button, still sat in Accountability as "Approve Candidate: ... Tow". The task title
   was written once, when the candidate was created, and nothing kept it in step. */
create or replace function hr.candidate_rename_task()
 returns trigger language plpgsql security definer set search_path to 'hr', 'acc', 'public'
as $function$
begin
  if new.name is distinct from old.name or new.position is distinct from old.position then
    update acc.ptasks
       set title = 'Approve Candidate: ' || coalesce(nullif(btrim(new.name),''),'Unnamed')
                   || case when coalesce(btrim(coalesce(new.position,'')),'') <> ''
                           then ' (' || new.position || ')' else '' end,
           updated_at = now()
     where candidate_id = new.id
       and coalesce(status,'') not in ('Completed','Done');
  end if;
  return new;
end $function$;

drop trigger if exists candidate_rename_task on hr.candidates;
create trigger candidate_rename_task after update of name, position on hr.candidates
  for each row execute function hr.candidate_rename_task();
