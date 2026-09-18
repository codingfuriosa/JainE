-- FAILED RECORDINGS NO LONGER RETRY ON A TIMER - ONLY WHEN THEIR LEAD HAS NEW PROGRESS.
--
-- By requirement (2026-09-19): a recording that failed should not be silently re-attempted forever on
-- a lead that never calls again. But when that same lead DOES get a new qualifying call on a later
-- decision day, its earlier failure(s) should get another chance too, right alongside the new
-- recording - the goal is for an active, progressing lead to eventually have everything transcribed,
-- without spending retries on one that has gone quiet.
--
-- The edge function's own promoteRetries no longer resets a failed row on a timer (see index.ts) - this
-- migration is the other half: crm_build_queue now revives a qualifying lead's own failed rows itself,
-- the moment that lead qualifies again. Capped at 3 attempts per phase (the same number the edge
-- function's own MAX_ATTEMPTS default uses), so a recording that is genuinely broken - corrupt audio,
-- for instance - does not retry forever across many future qualifying days.
--
-- Placed BEFORE the "nothing new to queue" early return, so a lead whose only new work today already
-- happens to be sitting in the queue (an edge case) still gets its old failures revived - reviving is
-- not conditional on there being brand-new recordings too.
create or replace function public.crm_build_queue(p_snapshot_id bigint, p_tz_offset_min integer default 330)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'acc', 'public'
as $function$
declare
  v_snap_date date;
  v_n       integer;
  v_start   bigint;
  v_ins     integer := 0;
  v_sales   integer := 0;
  v_nobody  integer := 0;
  v_revived integer := 0;
begin
  select snapshot_date into v_snap_date from acc.crm_snapshots where id = p_snapshot_id;
  if v_snap_date is null then
    raise exception 'crm_build_queue: no snapshot with id %', p_snapshot_id;
  end if;

  with qualifying_leads as (
    select distinct f.lead_id
    from acc.crm_snapshot_followups f
    join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
    where f.snapshot_id = p_snapshot_id and f.has_recording
      and (f.communication_time + make_interval(mins => p_tz_offset_min))::date = v_snap_date
      and acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'
      and coalesce(sl.business_unit_name, '') not ilike 'durbaar banquet%'
  )
  update acc.transcription_queue q
  set status = case when q.fail_phase = 'qa' then 'qa_pending' else 'pending' end,
      started_at = null, finished_at = null, updated_at = now(),
      last_error = coalesce(q.last_error, '') || ' [revived: lead qualified again on ' || v_snap_date || ']'
  from qualifying_leads ql
  where q.lead_id = ql.lead_id
    and q.status = 'failed'
    and ((q.fail_phase = 'transcribe' and coalesce(q.attempt_count, 0) < 3)
      or (q.fail_phase = 'qa' and coalesce(q.qa_attempt_count, 0) < 3));
  get diagnostics v_revived = row_count;

  with qualifying_leads as (
    select distinct f.lead_id
    from acc.crm_snapshot_followups f
    join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
    where f.snapshot_id = p_snapshot_id and f.has_recording
      and (f.communication_time + make_interval(mins => p_tz_offset_min))::date = v_snap_date
      and acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'
      and coalesce(sl.business_unit_name, '') not ilike 'durbaar banquet%'
  )
  select
    (select count(*) from acc.crm_snapshot_followups f
       join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
       where f.snapshot_id = p_snapshot_id and f.has_recording
         and coalesce(sl.business_unit_name, '') not ilike 'durbaar banquet%'
         and exists (select 1 from qualifying_leads ql where ql.lead_id = f.lead_id)
         and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id)),
    (select count(*) from acc.crm_snapshot_followups f
       where f.snapshot_id = p_snapshot_id and f.has_recording
         and acc.crm_personnel_team(f.personnel_email) = 'Sales'
         and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id)),
    (select count(*) from acc.crm_snapshot_followups f
       where f.snapshot_id = p_snapshot_id and f.has_recording
         and acc.crm_personnel_team(f.personnel_email) is null
         and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id))
    into v_n, v_sales, v_nobody;

  if coalesce(v_n, 0) = 0 then
    update acc.crm_snapshots set status = 'queued', updated_at = now() where id = p_snapshot_id;
    return jsonb_build_object('queued', 0, 'already_queued', true, 'revived', v_revived,
                              'skipped_sales', v_sales, 'skipped_no_personnel', v_nobody);
  end if;

  v_start := public.next_crm_queue_block(v_n);

  with qualifying_leads as (
    select distinct f.lead_id
    from acc.crm_snapshot_followups f
    join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
    where f.snapshot_id = p_snapshot_id and f.has_recording
      and (f.communication_time + make_interval(mins => p_tz_offset_min))::date = v_snap_date
      and acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'
      and coalesce(sl.business_unit_name, '') not ilike 'durbaar banquet%'
  ),
  eligible as (
    select f.*
    from acc.crm_snapshot_followups f
    join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
    where f.snapshot_id = p_snapshot_id and f.has_recording
      and coalesce(sl.business_unit_name, '') not ilike 'durbaar banquet%'
      and exists (select 1 from qualifying_leads ql where ql.lead_id = f.lead_id)
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

  return jsonb_build_object('queued', v_ins, 'revived', v_revived,
                            'skipped_sales', v_sales, 'skipped_no_personnel', v_nobody);
end;
$function$;
