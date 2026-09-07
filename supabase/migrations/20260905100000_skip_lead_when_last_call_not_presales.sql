-- A LEAD WHOSE MOST RECENT CALL WAS NOT PRE-SALES IS SKIPPED WHOLESALE, EVEN FOR AN OLDER CALL THAT
-- WAS ITSELF PRE-SALES.
--
-- crm_build_queue already refuses a call whose OWN personnel is not Pre-Sales
-- (acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'). That is a per-call gate: lead 648233
-- could have a Pre-Sales call in January and a Sales Executive's call in August, and the January one
-- would still queue on its own merits.
--
-- This adds a second, per-LEAD gate on top of it: acc.crm_followups already holds every follow-up
-- ever seen for a lead, so the follow-up with the latest communication_time for that lead_id is its
-- most recent call. If THAT call's personnel is not Pre-Sales - a Sales Executive picked it up, or the
-- CRM never sent personnel for it - nothing new for that lead is queued, even a follow-up that is
-- itself individually Pre-Sales. Once a lead has moved on from pre-sales, its remaining history is not
-- worth transcribing either.
--
-- Both gates must pass for a follow-up to queue. Only what has not already been queued is affected -
-- calls already sitting in acc.transcription_queue keep going exactly as before.
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
  v_handoff integer := 0;
begin
  with lead_last_team as (
    select distinct on (lead_id) lead_id, acc.crm_personnel_team(personnel_email) as team
    from acc.crm_followups
    order by lead_id, communication_time desc nulls last, follow_up_id desc
  )
  select count(*) filter (where acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'
                             and lt.team = 'Pre-Sales'),
         count(*) filter (where acc.crm_personnel_team(f.personnel_email) = 'Sales'),
         count(*) filter (where acc.crm_personnel_team(f.personnel_email) is null),
         count(*) filter (where acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'
                             and lt.team is distinct from 'Pre-Sales')
    into v_n, v_sales, v_nobody, v_handoff
  from acc.crm_snapshot_followups f
  left join lead_last_team lt on lt.lead_id = f.lead_id
  where f.snapshot_id = p_snapshot_id and f.has_recording
    and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id);

  if coalesce(v_n, 0) = 0 then
    update acc.crm_snapshots set status = 'queued', updated_at = now() where id = p_snapshot_id;
    return jsonb_build_object('queued', 0, 'already_queued', true,
                              'skipped_sales', v_sales, 'skipped_no_personnel', v_nobody,
                              'skipped_last_call_not_presales', v_handoff);
  end if;

  v_start := public.next_crm_queue_block(v_n);

  with lead_last_team as (
    select distinct on (lead_id) lead_id, acc.crm_personnel_team(personnel_email) as team
    from acc.crm_followups
    order by lead_id, communication_time desc nulls last, follow_up_id desc
  ),
  candidates as (
    select f.*,
           row_number() over (order by f.communication_time desc nulls last,
                                       f.follow_up_id desc) - 1 as rn
    from acc.crm_snapshot_followups f
    join lead_last_team lt on lt.lead_id = f.lead_id
    where f.snapshot_id = p_snapshot_id and f.has_recording
      and acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'
      and lt.team = 'Pre-Sales'
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
                            'skipped_last_call_not_presales', v_handoff);
end;
$function$;
