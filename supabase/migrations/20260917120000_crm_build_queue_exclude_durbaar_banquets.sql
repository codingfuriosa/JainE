-- DURBAAR BANQUETS NEVER QUEUES, BY REQUIREMENT.
--
-- Durbaar Banquets is a banquet venue, not a residential project (see qa-prompt.ts CATALOGUE) - it
-- runs a different sales funnel entirely, and the request is to stop spending transcription/QA on it
-- altogether, not just to hide it from one screen.
--
-- acc.crm_snapshot_followups carries no business_unit_name of its own - that lives on
-- acc.crm_snapshot_leads, joined by snapshot_lead_id, exactly the way crm_normalise_snapshot itself
-- joins the two to populate acc.crm_followups. So the exclusion joins the same way, in both places
-- eligibility gets decided: the qualifying_leads CTE (does this lead have a Pre-Sales call today) and
-- the candidates CTE (what actually gets inserted) - a lead whose only Pre-Sales call today was for
-- Durbaar Banquets must not qualify itself OR anything else into the queue on its account.
--
-- Nothing already in acc.transcription_queue or acc.call_transcripts is touched - this only changes
-- what NEW snapshots queue from here on. The 156 Durbaar Banquets calls already transcribed, and the
-- 13 already failed and exhausted at 3/3 attempts (an unrelated Gemini billing lapse, not this
-- project), are left exactly as they are.
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
  -- A lead QUALIFIES for this snapshot when at least one of its recorded calls that day was Pre-Sales
  -- AND was not a Durbaar Banquets call.
  with qualifying_leads as (
    select distinct f.lead_id
    from acc.crm_snapshot_followups f
    join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
    where f.snapshot_id = p_snapshot_id and f.has_recording
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
       join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
       where f.snapshot_id = p_snapshot_id and f.has_recording
         and coalesce(sl.business_unit_name, '') not ilike 'durbaar banquet%'
         and not exists (select 1 from qualifying_leads ql where ql.lead_id = f.lead_id)
         and acc.crm_personnel_team(f.personnel_email) = 'Sales'
         and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id)),
    (select count(*) from acc.crm_snapshot_followups f
       join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
       where f.snapshot_id = p_snapshot_id and f.has_recording
         and coalesce(sl.business_unit_name, '') not ilike 'durbaar banquet%'
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
    join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
    where f.snapshot_id = p_snapshot_id and f.has_recording
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
