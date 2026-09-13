-- A LEAD QUALIFIES ONLY WHEN ITS PRE-SALES CALL IS *ON THE DECISION DATE ITSELF*, NOT SOMEWHERE IN
-- ITS HISTORY.
--
-- 20260907120000 said it was moving eligibility to "does this lead have a Pre-Sales call, with a
-- recording, in this snapshot" and titled itself "ON THE DECISION DAY" - but its SQL never checked a
-- date. `qualifying_leads` matched on personnel team alone, over every row in
-- acc.crm_snapshot_followups for that snapshot. Because the CRM resends a lead's COMPLETE history
-- every day, that snapshot holds calls going back months, so a Pre-Sales call from February qualified
-- a Sales-only call from April, and a Sales call from today rode along on a Pre-Sales call from six
-- months ago that had nothing to do with it. Confirmed against production data: lead 651411's
-- 2026-04-01 Sales call queued off Pre-Sales calls from 2026-02-28/03-06/03-08 - different months, no
-- Pre-Sales call anywhere near 04-01 itself.
--
-- Restated correctly, by explicit business requirement:
--
--   1. The lead has at least one Pre-Sales call recording ON THE DECISION DATE (this snapshot's
--      acc.crm_snapshots.snapshot_date): queue the lead's ENTIRE follow-up history - every recorded
--      call, any date, any team - that is not already in acc.transcription_queue.
--   2. The lead has BOTH a Sales and a Pre-Sales call recording on the decision date: same outcome as
--      (1) - the Pre-Sales call already qualifies the lead, so the same-day Sales call and the rest of
--      the history queue alongside it.
--   3. The lead has ONLY a Sales call recording on the decision date - no Pre-Sales call that day, no
--      matter what happened on earlier days: skip the lead completely. Nothing for it queues, not that
--      call and not its history.
--
-- So the fix is one condition: a qualifying Pre-Sales follow-up must have its OWN call date - computed
-- the same way the insert below already computes call_date, communication_time shifted by the tz
-- offset - equal to the snapshot's decision date. Everything else (who is Pre-Sales, dedup against
-- calls already queued, queuing the full history once qualified) is unchanged from 20260907120000.
--
-- CALLS ALREADY IN THE QUEUE ARE LEFT EXACTLY AS THEY ARE, as every version of this function has done.
-- This only changes what a future snapshot picks up.
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
begin
  select snapshot_date into v_snap_date from acc.crm_snapshots where id = p_snapshot_id;
  if v_snap_date is null then
    raise exception 'crm_build_queue: no snapshot with id %', p_snapshot_id;
  end if;

  -- A lead QUALIFIES for this snapshot only when it has a Pre-Sales call, WITH A RECORDING, whose own
  -- call date - not the snapshot's pull date, the call's actual communication_time - is the decision
  -- date itself.
  with qualifying_leads as (
    select distinct f.lead_id
    from acc.crm_snapshot_followups f
    where f.snapshot_id = p_snapshot_id and f.has_recording
      and (f.communication_time + make_interval(mins => p_tz_offset_min))::date = v_snap_date
      and acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'
  )
  select
    (select count(*) from acc.crm_snapshot_followups f
       where f.snapshot_id = p_snapshot_id and f.has_recording
         and exists (select 1 from qualifying_leads ql where ql.lead_id = f.lead_id)
         and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id)),
    (select count(*) from acc.crm_snapshot_followups f
       where f.snapshot_id = p_snapshot_id and f.has_recording
         and not exists (select 1 from qualifying_leads ql where ql.lead_id = f.lead_id)
         and acc.crm_personnel_team(f.personnel_email) = 'Sales'
         and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id)),
    (select count(*) from acc.crm_snapshot_followups f
       where f.snapshot_id = p_snapshot_id and f.has_recording
         and not exists (select 1 from qualifying_leads ql where ql.lead_id = f.lead_id)
         and acc.crm_personnel_team(f.personnel_email) is null
         and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id))
    into v_n, v_sales, v_nobody;

  if coalesce(v_n, 0) = 0 then
    update acc.crm_snapshots set status = 'queued', updated_at = now() where id = p_snapshot_id;
    return jsonb_build_object('queued', 0, 'already_queued', true,
                              'skipped_sales', v_sales, 'skipped_no_personnel', v_nobody);
  end if;

  v_start := public.next_crm_queue_block(v_n);

  with qualifying_leads as (
    select distinct f.lead_id
    from acc.crm_snapshot_followups f
    where f.snapshot_id = p_snapshot_id and f.has_recording
      and (f.communication_time + make_interval(mins => p_tz_offset_min))::date = v_snap_date
      and acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'
  ),
  candidates as (
    select f.*,
           row_number() over (order by f.communication_time desc nulls last,
                                       f.follow_up_id desc) - 1 as rn
    from acc.crm_snapshot_followups f
    where f.snapshot_id = p_snapshot_id and f.has_recording
      and exists (select 1 from qualifying_leads ql where ql.lead_id = f.lead_id)
      and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id)
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
