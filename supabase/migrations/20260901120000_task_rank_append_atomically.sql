/* A new task's position was worked out as "the highest rank I have, plus one" - READ first, WRITE
   second, from the browser. Create two tasks in quick succession and both reads return the same
   highest value, so both land on the same number. Three creates in three minutes gave two tasks
   rank 12, and with nothing to separate them the list had no way to say which came first.

   Doing it here closes the gap: the maximum is read and the row written inside ONE transaction,
   with an advisory lock per person so somebody racing themselves across two tabs is serialised.
   The lock is keyed on the viewer, so two different people never wait on each other.

   Applied alongside this, and deliberately not in the file because it is data: the 143 already
   colliding ranks, across 16 of 64 people, were renumbered to clean whole numbers - ordered by
   their existing rank then newest-first, the same tie-break the list itself now uses, so nobody's
   list visibly moved. */
create or replace function acc.task_rank_append(p_task_id bigint)
 returns numeric
 language plpgsql security definer set search_path to 'acc','public'
as $function$
declare v_email text := app.current_user_email(); v_rank numeric;
begin
  if v_email is null or p_task_id is null then return 1; end if;
  perform pg_advisory_xact_lock(hashtext('acc.task_rank:'||lower(v_email)));
  select coalesce(max(rank),0)+1 into v_rank
    from acc.task_rank where lower(viewer_email)=lower(v_email);
  insert into acc.task_rank(task_id, viewer_email, rank)
  values (p_task_id, v_email, v_rank)
  on conflict (task_id, viewer_email) do update set rank = excluded.rank;
  return v_rank;
end; $function$;

grant execute on function acc.task_rank_append(bigint) to authenticated;
