-- TRANSCRIBE EVERY PRE-SALES FOLLOW-UP CALL OF 60 SECONDS OR MORE (requirement, 2026-10-01).
--
-- 20261001090000 still required a lead to have a Pre-Sales call on the decision day before any of its
-- history was queued. Removed: every follow-up in the snapshot that has a recording, was made by
-- Pre-Sales personnel and is recorded by the CRM at 60 seconds or more is queued, whatever its date and
-- whatever else the lead did that day. A follow-up with no CRM duration is still queued - the worker
-- checks the audio header and applies the same 60s floor. Unchanged: the 2026-09-23 start date, the
-- Durbaar Banquets exclusion, no re-queueing, chronological ordering by lead.

create or replace function public.crm_build_queue(p_snapshot_id bigint, p_tz_offset_min integer default 330)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'acc', 'public'
as $function$
declare
  v_snap_date date;
  v_effective_date constant date := date '2026-09-23';
  v_n       integer;
  v_start   bigint;
  v_ins     integer := 0;
  v_sales   integer := 0;
  v_nobody  integer := 0;
begin
  select snapshot_date into v_snap_date from acc.crm_snapshots where id = p_snapshot_id;
  if v_snap_date is null then
    raise exception 'crm_build_queue: no snapshot with id %', p_snapshot_id;
  end if;

  if v_snap_date < v_effective_date then
    update acc.crm_snapshots set status = 'queued', updated_at = now() where id = p_snapshot_id;
    return jsonb_build_object('queued', 0, 'effective_date', v_effective_date);
  end if;

  select
    (select count(*) from acc.crm_snapshot_followups f
       join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
       where f.snapshot_id = p_snapshot_id and f.has_recording
         and coalesce(sl.business_unit_name, '') not ilike 'durbaar banquet%'
         and acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'
         and (f.call_duration is null or f.call_duration >= 60)
         and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id)),
    (select count(*) from acc.crm_snapshot_followups f
       join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
       where f.snapshot_id = p_snapshot_id and f.has_recording
         and coalesce(sl.business_unit_name, '') not ilike 'durbaar banquet%'
         and acc.crm_personnel_team(f.personnel_email) = 'Sales'
         and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id)),
    (select count(*) from acc.crm_snapshot_followups f
       join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
       where f.snapshot_id = p_snapshot_id and f.has_recording
         and coalesce(sl.business_unit_name, '') not ilike 'durbaar banquet%'
         and acc.crm_personnel_team(f.personnel_email) is null
         and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id))
    into v_n, v_sales, v_nobody;

  if coalesce(v_n, 0) = 0 then
    update acc.crm_snapshots set status = 'queued', updated_at = now() where id = p_snapshot_id;
    return jsonb_build_object('queued', 0, 'already_queued', true,
                              'skipped_sales', v_sales, 'skipped_no_personnel', v_nobody);
  end if;

  v_start := public.next_crm_queue_block(v_n);

  with eligible as (
    select f.*
    from acc.crm_snapshot_followups f
    join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
    where f.snapshot_id = p_snapshot_id and f.has_recording
      and coalesce(sl.business_unit_name, '') not ilike 'durbaar banquet%'
      and acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'
      and (f.call_duration is null or f.call_duration >= 60)
      and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id)
  ),
  lead_order as (
    select lead_id, min(communication_time) as first_call_time
    from eligible
    group by lead_id
  ),
  candidates as (
    select e.*,
           row_number() over (
             order by lo.first_call_time asc nulls last, e.lead_id,
                      e.communication_time asc nulls last, e.follow_up_id asc
           ) - 1 as rn
    from eligible e
    join lead_order lo on lo.lead_id = e.lead_id
  )
  insert into acc.transcription_queue
    (follow_up_id, lead_id, snapshot_id, snapshot_date, call_date, recording_url, callid, queue_seq)
  select c.follow_up_id, c.lead_id, p_snapshot_id, c.snapshot_date,
         (c.communication_time + make_interval(mins => p_tz_offset_min))::date,
         c.recording_url, c.callid, v_start + c.rn
  from candidates c
  on conflict (follow_up_id) do nothing;
  get diagnostics v_ins = row_count;

  update acc.crm_snapshots set
    new_recording_count = v_ins, status = 'queued', updated_at = now()
  where id = p_snapshot_id;

  return jsonb_build_object('queued', v_ins,
                            'skipped_sales', v_sales, 'skipped_no_personnel', v_nobody);
end;
$function$;

revoke all on function public.crm_build_queue(bigint, integer) from public, anon, authenticated;
grant execute on function public.crm_build_queue(bigint, integer) to service_role;
