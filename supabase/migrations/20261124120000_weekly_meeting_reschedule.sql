-- JainE-Meetings: Reschedule a meeting (new date and time).
-- Only whoever may change the meeting (app.ws_can_edit). A meeting that has already ended cannot be moved.
-- Its own JainE calendar entry (a one-time acc.meetings row) moves with it, keeping its length.
-- A date of a repeating meeting shares one repeating calendar entry with every other date, so that
-- entry is left alone; only this date moves on the meetings page.
create or replace function public.ops_meeting_reschedule(p_meeting bigint, p_date date, p_time time default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_acc bigint; v_ended timestamptz; v_len interval;
begin
  if not coalesce(app.ws_can_edit(p_meeting), false) then raise exception 'Only the person who started this meeting can change it'; end if;
  if p_date is null then raise exception 'Choose a date'; end if;
  if p_date < (now() at time zone 'Asia/Kolkata')::date then raise exception 'Choose today or a later day'; end if;
  select acc_meeting_id, ended_at into v_acc, v_ended from ops.meetings where id = p_meeting;
  if not found then raise exception 'That meeting no longer exists'; end if;
  if v_ended is not null then raise exception 'This meeting has already ended'; end if;
  update ops.meetings set meeting_date = p_date, start_time = p_time where id = p_meeting;
  if v_acc is not null then
    select coalesce(end_time - start_time, interval '1 hour') into v_len
      from acc.meetings where id = v_acc and coalesce(recur_type,'none') = 'none';
    if found then
      update acc.meetings
         set meeting_date = p_date,
             start_time = coalesce(p_time, start_time),
             end_time = case when p_time is null then end_time else (p_time + coalesce(v_len, interval '1 hour'))::time end
       where id = v_acc;
    end if;
  end if;
end;
$function$;
grant execute on function public.ops_meeting_reschedule(bigint, date, time) to authenticated;
