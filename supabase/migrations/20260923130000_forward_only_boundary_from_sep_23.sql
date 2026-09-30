-- FORWARD-ONLY BOUNDARY MOVED ONE DAY EARLIER: 2026-09-24 -> 2026-09-23.
-- The 00:00 IST snapshot on 2026-09-24 fetches 2026-09-23's calls; with the boundary at the 24th it
-- queued nothing and the first processed day would have been the 24th. Now the 23rd's calls are the
-- first decision day that is queued, transcribed and assessed. Function bodies otherwise unchanged.
begin;

create or replace function public.crm_build_queue(p_snapshot_id bigint, p_tz_offset_min integer default 330)
returns jsonb language plpgsql security definer set search_path = acc, public as $function$
declare
  v_snap_date date;
  v_effective_date constant date := date '2026-09-23';
  v_n integer;
  v_start bigint;
  v_ins integer := 0;
  v_sales integer := 0;
  v_nobody integer := 0;
begin
  select snapshot_date into v_snap_date from acc.crm_snapshots where id = p_snapshot_id;
  if v_snap_date is null then
    raise exception 'crm_build_queue: no snapshot with id %', p_snapshot_id;
  end if;

  if v_snap_date < v_effective_date then
    update acc.crm_snapshots set status = 'queued', updated_at = now() where id = p_snapshot_id;
    return jsonb_build_object('queued', 0, 'forward_only', true,
                              'effective_date', v_effective_date);
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
  select
    (select count(*) from acc.crm_snapshot_followups f
       join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
       where f.snapshot_id = p_snapshot_id and f.has_recording
         and (f.communication_time + make_interval(mins => p_tz_offset_min))::date = v_snap_date
         and coalesce(sl.business_unit_name, '') not ilike 'durbaar banquet%'
         and exists (select 1 from qualifying_leads ql where ql.lead_id = f.lead_id)
         and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id)),
    (select count(*) from acc.crm_snapshot_followups f
       join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
       where f.snapshot_id = p_snapshot_id and f.has_recording
         and (f.communication_time + make_interval(mins => p_tz_offset_min))::date = v_snap_date
         and coalesce(sl.business_unit_name, '') not ilike 'durbaar banquet%'
         and not exists (select 1 from qualifying_leads ql where ql.lead_id = f.lead_id)
         and acc.crm_personnel_team(f.personnel_email) = 'Sales'
         and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id)),
    (select count(*) from acc.crm_snapshot_followups f
       join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
       where f.snapshot_id = p_snapshot_id and f.has_recording
         and (f.communication_time + make_interval(mins => p_tz_offset_min))::date = v_snap_date
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
      and (f.communication_time + make_interval(mins => p_tz_offset_min))::date = v_snap_date
      and acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'
      and coalesce(sl.business_unit_name, '') not ilike 'durbaar banquet%'
  ),
  eligible as (
    select f.*
    from acc.crm_snapshot_followups f
    join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
    where f.snapshot_id = p_snapshot_id and f.has_recording
      and (f.communication_time + make_interval(mins => p_tz_offset_min))::date = v_snap_date
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
    select e.*, row_number() over (
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

  update acc.crm_snapshots set new_recording_count = v_ins, status = 'queued', updated_at = now()
  where id = p_snapshot_id;

  return jsonb_build_object('queued', v_ins, 'skipped_sales', v_sales,
                            'skipped_no_personnel', v_nobody,
                            'forward_only', true, 'effective_date', v_effective_date);
end;
$function$;

create or replace function public.next_claimable_follow_up(p_claimable text[])
returns table(id bigint, status text)
language sql stable security definer set search_path = acc, public as $$
  with latest as (
    select max(snapshot_date) as d from acc.transcription_queue
  ),
  in_scope_leads as (
    select distinct q.lead_id
    from acc.transcription_queue q, latest l
    where q.snapshot_date = l.d
      and q.snapshot_date >= date '2026-09-23'
  )
  select q.id, q.status
  from acc.transcription_queue q
  where q.status = any(p_claimable)
    and q.snapshot_date >= date '2026-09-23'
    and q.lead_id in (select lead_id from in_scope_leads)
  order by exists (
      select 1 from acc.transcription_queue d
      where d.lead_id = q.lead_id and d.status in ('completed', 'failed')
    ) desc,
    q.queue_seq asc,
    q.id asc
  limit 1;
$$;

revoke all on function public.crm_build_queue(bigint, integer) from public, anon, authenticated;
revoke all on function public.next_claimable_follow_up(text[]) from public, anon, authenticated;
grant execute on function public.crm_build_queue(bigint, integer) to service_role;
grant execute on function public.next_claimable_follow_up(text[]) to service_role;

commit;
