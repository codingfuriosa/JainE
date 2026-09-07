-- REMOVE THE PERMANENT SALES-HANDOFF GATE: ELIGIBILITY IS NOW DECIDED BY THE DECISION DATE ALONE.
--
-- 20260905100000 (narrowed by 20260906090000, rescaled by 20260906120000) added a lead-level gate on
-- top of the per-call one: if a lead's last call BEFORE the snapshot's own date was Sales, nothing new
-- ever queued for that lead again — not even a later, individually Pre-Sales call. That was a
-- deliberate call at the time ("once a lead has moved on from pre-sales, its remaining history is not
-- worth transcribing either"), but the business rule has since been restated explicitly and it does
-- not include this: eligibility is to be judged ONLY by who contacted the lead on the decision date
-- itself, never by what a call on some earlier day was handled by.
--
-- Concretely, the dropped gate broke this case: lead PQR's last call before today was Sales (an
-- old/lost lead re-contacted by the Sales team), then Pre-Sales calls PQR again today. The restated
-- rule says process PQR — transcribe today's Pre-Sales call and PQR's full follow-up history. The old
-- gate would have skipped PQR outright. There is no case the dropped gate protected that the per-call
-- gate does not already cover on its own: a same-day Sales call for the same lead is still dropped by
-- `acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'` alone, exactly as it was before either
-- lead-level gate existed.
--
-- Same signature and return shape, minus `skipped_lead_handed_to_sales_before_today` — nothing reads
-- that key by name, it was always folded into the same generic jsonb response.
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
  select count(*) filter (where acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'),
         count(*) filter (where acc.crm_personnel_team(f.personnel_email) = 'Sales'),
         count(*) filter (where acc.crm_personnel_team(f.personnel_email) is null)
    into v_n, v_sales, v_nobody
  from acc.crm_snapshot_followups f
  where f.snapshot_id = p_snapshot_id and f.has_recording
    and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id);

  if coalesce(v_n, 0) = 0 then
    update acc.crm_snapshots set status = 'queued', updated_at = now() where id = p_snapshot_id;
    return jsonb_build_object('queued', 0, 'already_queued', true,
                              'skipped_sales', v_sales, 'skipped_no_personnel', v_nobody);
  end if;

  v_start := public.next_crm_queue_block(v_n);

  with candidates as (
    select f.*,
           row_number() over (order by f.communication_time desc nulls last,
                                       f.follow_up_id desc) - 1 as rn
    from acc.crm_snapshot_followups f
    where f.snapshot_id = p_snapshot_id and f.has_recording
      and acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'
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
