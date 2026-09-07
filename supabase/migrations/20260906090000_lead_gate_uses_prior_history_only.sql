-- FIX: A SAME-DAY MIX OF A PRE-SALES CALL AND A SALES CALL FOR ONE LEAD MUST STILL TRANSCRIBE THE
-- PRE-SALES CALL.
--
-- The lead-level gate added in 20260905100000 found each lead's single latest call by
-- communication_time across ALL of acc.crm_followups. But the CRM resends a lead's COMPLETE history
-- every day, so by the time crm_build_queue runs, that table already includes whatever the CURRENT
-- snapshot itself just brought in. If today's snapshot carries a Pre-Sales call at 10:00 and a Sales
-- call at 15:00 for the same lead, the lead's "latest call" came out Sales - so the gate rejected the
-- WHOLE lead, including this morning's perfectly good Pre-Sales call, which should queue on its own
-- merits (the per-call gate already drops the 15:00 Sales call by itself; nothing else needed to).
--
-- The gate now asks a narrower question: was this lead ALREADY handed to Sales BEFORE today, i.e.
-- strictly before this snapshot's own date (call_date < the snapshot's snapshot_date)? That is state
-- today cannot retroactively change. A same-day mix is left entirely to the per-call gate. A lead with
-- no such prior history (its first-ever call is today) or whose prior personnel is unknown is not
-- penalised for something not yet established - it only fails once a call BEFORE today is positively
-- known to be Sales. From the day after a Sales call, that call is now part of "before today" and the
-- lead-level gate takes over as originally intended.
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

  with lead_last_team as (
    select distinct on (lead_id) lead_id, acc.crm_personnel_team(personnel_email) as team
    from acc.crm_followups
    where call_date < v_snap_date
    order by lead_id, communication_time desc nulls last, follow_up_id desc
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

  with lead_last_team as (
    select distinct on (lead_id) lead_id, acc.crm_personnel_team(personnel_email) as team
    from acc.crm_followups
    where call_date < v_snap_date
    order by lead_id, communication_time desc nulls last, follow_up_id desc
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
