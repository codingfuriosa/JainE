-- TWO FIXES BY EXPLICIT BUSINESS REQUIREMENT:
--
-- 1. RESTORE THE DECISION-DATE GATE. 20260910120000 fixed qualifying_leads to require the lead's
--    Pre-Sales call to fall ON THE SNAPSHOT'S OWN DECISION DATE, not merely somewhere in its full
--    history (a lead's CRM record carries calls going back months, resent whole on every pull).
--    20260917120000 (adding the Durbaar Banquets exclusion) copied its function body from
--    20260907120000 instead of 20260910120000 and silently dropped that date check again - so every
--    Pre-Sales call in a lead's ENTIRE history has been re-qualifying it ever since, exactly the bug
--    20260910120000 already fixed once. Restored here, combined with the Durbaar exclusion.
--
-- 2. SALES CALLS ARE NEVER QUEUED, TRANSCRIBED OR STORED - NO EXCEPTION FOR A SAME-DAY MIX.
--    20260907120000 deliberately queued a Sales call riding alongside a same-day Pre-Sales call,
--    reasoning that "the point of the day is the whole conversation, not only the half Pre-Sales
--    carried." That is explicitly reversed now: a Sales Executive's call is never transcribed or
--    stored, under any circumstance, including a decision day that also has a Pre-Sales call.
--
--    Restated in full:
--      a. A lead with a Pre-Sales call recording ON THE DECISION DATE (whether or not it also has a
--         Sales call that same day) qualifies - every one of its Pre-Sales recordings, any date,
--         queues. Its Sales calls, that day or any other day, never do.
--      b. A lead with ONLY a Sales call on the decision date - no Pre-Sales call that day, no matter
--         what happened on earlier days - queues nothing at all, exactly as before.
--
--    The change from every prior version is one added predicate in the candidates CTE restricting the
--    actual insert to Pre-Sales calls, on top of the qualifying-lead gate that decides WHICH leads'
--    Pre-Sales history to pull in.
--
-- Nothing already in acc.transcription_queue, acc.call_transcripts or acc.followup_qa is touched by
-- this - a Sales call queued or transcribed under an earlier version of this rule stays exactly as it
-- is; this only changes what a future snapshot queues from here on.
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
  -- date itself, and that call is not for Durbaar Banquets.
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
    -- what will actually queue: Pre-Sales recordings belonging to a qualifying lead.
    (select count(*) from acc.crm_snapshot_followups f
       join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
       where f.snapshot_id = p_snapshot_id and f.has_recording
         and coalesce(sl.business_unit_name, '') not ilike 'durbaar banquet%'
         and acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'
         and exists (select 1 from qualifying_leads ql where ql.lead_id = f.lead_id)
         and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id)),
    -- every Sales call not yet queued - never queued from here, whichever lead it belongs to.
    (select count(*) from acc.crm_snapshot_followups f
       where f.snapshot_id = p_snapshot_id and f.has_recording
         and acc.crm_personnel_team(f.personnel_email) = 'Sales'
         and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id)),
    -- unmatched-personnel recordings belonging to a lead that never qualified.
    (select count(*) from acc.crm_snapshot_followups f
       where f.snapshot_id = p_snapshot_id and f.has_recording
         and acc.crm_personnel_team(f.personnel_email) is null
         and not exists (select 1 from qualifying_leads ql where ql.lead_id = f.lead_id)
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
    join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
    where f.snapshot_id = p_snapshot_id and f.has_recording
      and (f.communication_time + make_interval(mins => p_tz_offset_min))::date = v_snap_date
      and acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'
      and coalesce(sl.business_unit_name, '') not ilike 'durbaar banquet%'
  ),
  candidates as (
    select f.*,
           row_number() over (order by f.communication_time desc nulls last,
                                       f.follow_up_id desc) - 1 as rn
    from acc.crm_snapshot_followups f
    join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
    where f.snapshot_id = p_snapshot_id and f.has_recording
      and coalesce(sl.business_unit_name, '') not ilike 'durbaar banquet%'
      and acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'
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
