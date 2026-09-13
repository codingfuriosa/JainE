-- WHEN A LEAD HAS BOTH A SALES AND A PRE-SALES CALL ON THE DECISION DAY, TRANSCRIBE BOTH.
--
-- 20260905090000 narrowed the queue to Pre-Sales calls only, call by call: a Sales Executive's call
-- is a different conversation, marked against a script it was never meant to follow, and running it
-- through the pipeline bought a verdict nobody reads. 20260907090000 then confirmed eligibility is
-- decided by the decision date alone, never an earlier day.
--
-- That per-call gate is now restated as a per-lead, per-day rule, by explicit business requirement:
--
--   1. A lead with a Pre-Sales call on the decision day - AND ALSO a Sales call that same day - has
--      EVERY recorded call from that day queued, Sales call included, with the lead's full follow-up
--      history transcribed alongside it. The point of the day is the whole conversation the lead had,
--      not only the half Pre-Sales carried.
--   2. A lead with ONLY a Sales call on the decision day (no Pre-Sales call at all) still queues
--      nothing - the whole day's call for that lead is skipped, exactly as before.
--   3. A lead with a Pre-Sales call and nothing else queues that call as before - rule 1 already
--      covers this as the case where there is no Sales call to add.
--
-- so the qualifying condition moves from the call to the LEAD: does this lead have at least one
-- Pre-Sales call, with a recording, in this snapshot? If yes, every recorded call it has in the same
-- snapshot queues, whichever team made it. If no - a Sales-only day - nothing does.
--
-- CALLS ALREADY IN THE QUEUE ARE LEFT EXACTLY AS THEY ARE, as every version of this function has done:
-- nothing here reaches into transcription_queue except to insert new rows and to skip follow-ups
-- already holding one.
--
-- skipped_sales / skipped_no_personnel keep their names but narrow their meaning: they now count only
-- the calls dropped because their LEAD did not qualify that day (a Sales-only or personnel-unknown
-- lead), not every Sales call regardless of who else called that lead - a Sales call riding along on a
-- qualifying lead is queued, not skipped, and is counted in `queued` instead.
create or replace function public.crm_build_queue(p_snapshot_id bigint, p_tz_offset_min integer default 330)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'acc', 'public'
as $function$
declare
  v_n       integer;
  v_start   bigint;
  v_ins     integer := 0;
  v_sales   integer := 0;
  v_nobody  integer := 0;
begin
  -- A lead QUALIFIES for this snapshot when at least one of its recorded calls that day was Pre-Sales.
  with qualifying_leads as (
    select distinct f.lead_id
    from acc.crm_snapshot_followups f
    where f.snapshot_id = p_snapshot_id and f.has_recording
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
