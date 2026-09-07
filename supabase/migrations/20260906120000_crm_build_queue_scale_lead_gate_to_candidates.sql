-- FIX: crm_build_queue TIMED OUT (57014) ON 2026-09-05, LEAVING THE WHOLE DAY STUCK AT 'normalised'.
--
-- The lead-level gate added in 20260905100000 (and narrowed in 20260906090000) computed
-- `lead_last_team` by DISTINCT ON-ing lead_id over ALL of acc.crm_followups — the complete history
-- of every lead ever seen, not just the ~200 leads in today's snapshot. acc.crm_followups only grows
-- (it is never pruned, by design — see TRANSCRIPTION-README.md), so this full-history sort got a
-- little slower every day since 20260905's gate went in, until on 2026-09-05 18:30 UTC it finally
-- crossed the statement timeout: `canceling statement due to statement timeout`, crm_build_queue
-- errored, and the snapshot was left at status='normalised', never reaching 'queued'. Nothing new
-- transcribes on a day like that — the worker has an empty queue and reports success doing nothing.
--
-- The fix restricts the lookup to the leads that can actually matter: those with a with-recording
-- follow-up in THIS snapshot that isn't already queued (typically ~150-250 leads, not the thousands
-- in the full history). For each of those, a LATERAL subquery takes the single most recent
-- before-today row via the existing (lead_id, communication_time) index — an index-scan-plus-limit-1
-- per lead, not a sort of the whole table. Cost now scales with the size of a day's snapshot, the
-- same as everything else in this function, instead of with the lifetime size of crm_followups.
--
-- Same two call sites as before (the early-exit count, and the actual insert) both get the cheap
-- version; behaviour and return shape are unchanged.
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
  v_handoff integer := 0;
begin
  select snapshot_date into v_snap_date from acc.crm_snapshots where id = p_snapshot_id;
  if v_snap_date is null then
    raise exception 'crm_build_queue: no snapshot with id %', p_snapshot_id;
  end if;

  with cand_leads as (
    select distinct f.lead_id
    from acc.crm_snapshot_followups f
    where f.snapshot_id = p_snapshot_id and f.has_recording
      and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id)
  ),
  lead_last_team as (
    select cl.lead_id, acc.crm_personnel_team(cf.personnel_email) as team
    from cand_leads cl
    left join lateral (
      select personnel_email
      from acc.crm_followups
      where lead_id = cl.lead_id and call_date < v_snap_date
      order by communication_time desc nulls last, follow_up_id desc
      limit 1
    ) cf on true
  )
  select count(*) filter (where acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'
                             and lt.team is distinct from 'Sales'),
         count(*) filter (where acc.crm_personnel_team(f.personnel_email) = 'Sales'),
         count(*) filter (where acc.crm_personnel_team(f.personnel_email) is null),
         count(*) filter (where acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'
                             and lt.team = 'Sales')
    into v_n, v_sales, v_nobody, v_handoff
  from acc.crm_snapshot_followups f
  left join lead_last_team lt on lt.lead_id = f.lead_id
  where f.snapshot_id = p_snapshot_id and f.has_recording
    and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id);

  if coalesce(v_n, 0) = 0 then
    update acc.crm_snapshots set status = 'queued', updated_at = now() where id = p_snapshot_id;
    return jsonb_build_object('queued', 0, 'already_queued', true,
                              'skipped_sales', v_sales, 'skipped_no_personnel', v_nobody,
                              'skipped_lead_handed_to_sales_before_today', v_handoff);
  end if;

  v_start := public.next_crm_queue_block(v_n);

  with cand_leads as (
    select distinct f.lead_id
    from acc.crm_snapshot_followups f
    where f.snapshot_id = p_snapshot_id and f.has_recording
      and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id)
  ),
  lead_last_team as (
    select cl.lead_id, acc.crm_personnel_team(cf.personnel_email) as team
    from cand_leads cl
    left join lateral (
      select personnel_email
      from acc.crm_followups
      where lead_id = cl.lead_id and call_date < v_snap_date
      order by communication_time desc nulls last, follow_up_id desc
      limit 1
    ) cf on true
  ),
  candidates as (
    select f.*,
           row_number() over (order by f.communication_time desc nulls last,
                                       f.follow_up_id desc) - 1 as rn
    from acc.crm_snapshot_followups f
    left join lead_last_team lt on lt.lead_id = f.lead_id
    where f.snapshot_id = p_snapshot_id and f.has_recording
      and acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'
      and lt.team is distinct from 'Sales'
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
                            'skipped_sales', v_sales, 'skipped_no_personnel', v_nobody,
                            'skipped_lead_handed_to_sales_before_today', v_handoff);
end;
$function$;

-- No new index needed: the existing crm_followups_lead (lead_id, communication_time) index already
-- gives the LATERAL subquery above exactly what it wants — for one lead_id, a backward scan in
-- communication_time-desc order with the call_date filter and LIMIT 1 stopping at the first match.
-- What changed is only that this scan now runs once per CANDIDATE lead (bounded by today's snapshot,
-- typically ~150-250) instead of once for the entire lifetime history via a full DISTINCT ON sort.
