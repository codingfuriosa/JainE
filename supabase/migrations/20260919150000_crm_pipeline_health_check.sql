-- ON-DEMAND INVARIANT CHECK, by requirement (2026-09-19): catch the next silent drift faster than
-- "someone happens to notice" - without adding any alerting/notification path (explicitly declined).
-- This is a callable diagnostic, not a push: run it whenever you want a health read, same as any other
-- report. Checks four things, each catching a REAL failure mode already seen this week:
--
--   1. daily_qa_summary drift - recomputes the core counts fresh for the trailing window and compares
--      against what's stored, for exactly the columns a broken trigger already once got wrong.
--   2. Stuck in-flight recordings - a row left in transcribing/qa_running far longer than any single
--      tick's own time budget can mean the edge function died mid-request with nothing to reclaim it.
--   3. Missing personnel data - a recorded call with no personnel_email is exactly the shape of
--      2026-09-17's incident (crm_normalise_snapshot silently never writing those fields).
--   4. Orphaned queue rows - a transcription_queue row whose follow_up_id no longer exists in
--      crm_followups, which should never happen but costs nothing to verify.
--
-- Read-only: touches nothing, changes nothing, safe to run as often as wanted.
create or replace function acc.crm_pipeline_health_check(p_days integer default 14)
returns table(check_name text, severity text, detail text)
language plpgsql stable security definer set search_path = acc, public as $$
declare
  d date;
  fresh record;
  stored record;
  stale_count integer;
  no_personnel_count integer;
  orphan_count integer;
begin
  -- 1. daily_qa_summary drift, day by day over the window.
  for d in select generate_series(current_date - (p_days - 1), current_date, interval '1 day')::date loop
    select
      count(f.follow_up_id) as total_followups,
      count(*) filter (where coalesce(t.status, case when f.has_recording then 'not_transcribed' else 'no_recording' end) = 'completed') as transcribed,
      count(*) filter (where q.status_match and q.is_latest_assessed) as status_match,
      count(*) filter (where q.status_match = false and q.is_latest_assessed) as status_mismatch
    into fresh
    from acc.crm_followups f
    left join acc.call_transcripts t on t.recording_url = f.recording_url
    left join acc.followup_qa q on q.follow_up_id = f.follow_up_id
    where f.call_date = d;

    select total_followups, transcribed, status_match, status_mismatch into stored
    from acc.daily_qa_summary where date = d;

    if stored is null then
      if coalesce(fresh.total_followups, 0) > 0 then
        check_name := 'daily_qa_summary_drift'; severity := 'warn';
        detail := d::text || ': ' || fresh.total_followups || ' follow-ups exist but no summary row at all';
        return next;
      end if;
    elsif stored.total_followups is distinct from fresh.total_followups
       or stored.transcribed is distinct from fresh.transcribed
       or stored.status_match is distinct from fresh.status_match
       or stored.status_mismatch is distinct from fresh.status_mismatch then
      check_name := 'daily_qa_summary_drift'; severity := 'warn';
      detail := d::text || ': stored (total=' || stored.total_followups || ', transcribed=' || stored.transcribed
        || ', match=' || stored.status_match || ', mismatch=' || stored.status_mismatch
        || ') vs fresh (total=' || fresh.total_followups || ', transcribed=' || fresh.transcribed
        || ', match=' || fresh.status_match || ', mismatch=' || fresh.status_mismatch || ')';
      return next;
    end if;
  end loop;

  -- 2. Stuck in-flight recordings - well past any single tick's own budget (240s as of 2026-09-18),
  -- so 30 minutes is already a generous multiple of that, not a hair trigger.
  select count(*) into stale_count from acc.transcription_queue
  where status in ('transcribing', 'qa_running') and updated_at < now() - interval '30 minutes';
  if stale_count > 0 then
    check_name := 'stuck_in_flight'; severity := 'critical';
    detail := stale_count || ' recording(s) stuck in transcribing/qa_running for over 30 minutes - the worker''s own "strictly one at a time" guard means nothing else can proceed until these are manually reset';
    return next;
  end if;

  -- 3. Missing personnel data over the window - the exact shape of 2026-09-17's incident.
  select count(*) into no_personnel_count from acc.crm_followups
  where call_date >= current_date - (p_days - 1) and has_recording and personnel_email is null;
  if no_personnel_count > 0 then
    check_name := 'missing_personnel_data'; severity := 'critical';
    detail := no_personnel_count || ' recorded call(s) in the last ' || p_days || ' days have no personnel_email - these cannot be classified Pre-Sales/Sales and will not queue';
    return next;
  end if;

  -- 4. Orphaned queue rows.
  select count(*) into orphan_count from acc.transcription_queue q
  where not exists (select 1 from acc.crm_followups f where f.follow_up_id = q.follow_up_id);
  if orphan_count > 0 then
    check_name := 'orphaned_queue_rows'; severity := 'warn';
    detail := orphan_count || ' transcription_queue row(s) reference a follow_up_id that no longer exists in crm_followups';
    return next;
  end if;

  return;
end;
$$;

revoke all on function acc.crm_pipeline_health_check(integer) from public, anon, authenticated;
grant execute on function acc.crm_pipeline_health_check(integer) to service_role;
