-- crm_normalise_snapshot has NEVER written personnel_id/personnel_name/personnel_email/personnel_role
-- onto acc.crm_snapshot_followups or acc.crm_followups, even though the raw CRM payload carries all
-- four on every history entry (acc.crm_snapshots.raw -> lead -> history[] -> personnel_email etc,
-- confirmed directly against snapshot 22's raw JSON). Every day up to 2026-09-16 still shows personnel
-- data on crm_followups only because those follow_up_id rows were first inserted before whatever state
-- gave them personnel values, and the ON CONFLICT DO UPDATE clause never listed personnel_* among the
-- columns to update - so it silently carried old values forward on every re-run instead of ever
-- setting them. The 17th was the first entirely new day since, so every one of its 3342 rows landed
-- with personnel_id/name/email/role literally null.
--
-- That is why the queue came up empty: crm_build_queue's Pre-Sales gate
-- (20260917120000) reads acc.crm_personnel_team(f.personnel_email), which is null for everyone on a
-- day with no personnel data at all - so zero leads ever looked like a qualifying Pre-Sales lead, and
-- the whole day was silently skipped rather than queued. This is a second, independent cause of the
-- 17th's failure, on top of the statement timeout (20260918120000) and the broken insert trigger
-- (20260918130000): even a normalise that completed under the timeout, before this fix, would still
-- have produced a day with nothing to transcribe.
--
-- Fix: populate all four fields from each history entry in both inserts, following the exact
-- lead_id/follow_up_id numeric-guard pattern already used elsewhere in this function. The ON CONFLICT
-- update coalesces onto the existing value rather than overwriting - so a future day whose feed is
-- ever missing personnel data again (as the 17th's normalise-time state effectively was) cannot wipe
-- out personnel data a previous, good snapshot already established for the same follow_up_id.
create or replace function public.crm_normalise_snapshot(p_snapshot_id bigint, p_tz_offset_min integer default 330)
returns jsonb language plpgsql security definer set search_path = acc, public set statement_timeout = '90s' as $function$
declare
  s_date  date;
  s_raw   jsonb;
  v_leads integer := 0;
  v_fups  integer := 0;
  v_recs  integer := 0;
begin
  select snapshot_date, raw into s_date, s_raw from acc.crm_snapshots where id = p_snapshot_id;
  if s_date is null then
    raise exception 'crm_normalise_snapshot: no snapshot with id %', p_snapshot_id;
  end if;
  if s_raw is null or jsonb_typeof(s_raw) <> 'array' then
    raise exception 'crm_normalise_snapshot: snapshot % holds no JSON array', p_snapshot_id;
  end if;

  insert into acc.crm_snapshot_leads
    (snapshot_id, snapshot_date, lead_id, lead_name, status, business_unit_name, lost_reason,
     followup_count, raw)
  select p_snapshot_id, s_date,
         (l->>'lead_id')::bigint,
         acc.crm_text(l->>'lead_name'),
         acc.crm_status_canon(l->>'status'),
         acc.crm_text(l->>'business_unit_name'),
         acc.crm_text(l->>'lost_reason'),
         case when jsonb_typeof(l->'history') = 'array' then jsonb_array_length(l->'history') else 0 end,
         l
  from jsonb_array_elements(s_raw) with ordinality as t(l, ord)
  where l->>'lead_id' ~ '^[0-9]+$'
  order by ord
  on conflict (snapshot_id, lead_id) do nothing;
  get diagnostics v_leads = row_count;

  insert into acc.crm_snapshot_followups
    (snapshot_id, snapshot_lead_id, snapshot_date, lead_id, follow_up_id, communication_time,
     call_start_text, next_follow_up_text, status_raw, status, status_detail,
     recording_url, callid, has_recording, call_duration, remarks, lost_reason,
     personnel_id, personnel_name, personnel_email, personnel_role, raw)
  select p_snapshot_id, sl.id, s_date,
         (t.l->>'lead_id')::bigint,
         (h.f->>'follow_up_id')::bigint,
         case when acc.crm_text(h.f->>'communication_time') is not null
              then (h.f->>'communication_time')::timestamptz end,
         acc.crm_text(h.f->>'call_start_time'),
         acc.crm_text(h.f->>'next_follow_up_date'),
         acc.crm_text(h.f->>'status'),
         acc.crm_status_head(h.f->>'status'),
         acc.crm_status_detail(h.f->>'status'),
         acc.crm_text(h.f->>'recording_url'),
         substring(acc.crm_text(h.f->>'recording_url') from 'callid=([0-9a-fA-F-]{36})'),
         coalesce(acc.crm_text(h.f->>'recording_url') like 'http%', false),
         acc.crm_num(h.f->>'call_duration'),
         acc.crm_text(h.f->>'remarks'),
         acc.crm_text(h.f->>'lost_reason'),
         case when h.f->>'personnel_id' ~ '^[0-9]+$' then (h.f->>'personnel_id')::bigint else null end,
         acc.crm_text(h.f->>'personnel_name'),
         acc.crm_text(h.f->>'personnel_email'),
         acc.crm_text(h.f->>'personnel_role'),
         h.f
  from jsonb_array_elements(s_raw) with ordinality as t(l, ord)
  join acc.crm_snapshot_leads sl
    on sl.snapshot_id = p_snapshot_id and sl.lead_id = (t.l->>'lead_id')::bigint
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(t.l->'history') = 'array' then t.l->'history' else '[]'::jsonb end
  ) with ordinality as h(f, hord)
  where h.f->>'follow_up_id' ~ '^[0-9]+$'
    and t.l->>'lead_id' ~ '^[0-9]+$'
  order by t.ord, h.hord
  on conflict (snapshot_id, follow_up_id) do nothing;
  get diagnostics v_fups = row_count;

  insert into acc.crm_leads
    (lead_id, lead_name, status, business_unit_name, lost_reason, followup_count,
     first_seen_date, last_seen_date, last_snapshot_id, raw)
  select lead_id, lead_name, status, business_unit_name, lost_reason, followup_count,
         snapshot_date, snapshot_date, p_snapshot_id, raw
  from acc.crm_snapshot_leads where snapshot_id = p_snapshot_id
  on conflict (lead_id) do update set
    lead_name          = excluded.lead_name,
    status             = excluded.status,
    business_unit_name = excluded.business_unit_name,
    lost_reason        = excluded.lost_reason,
    followup_count     = greatest(crm_leads.followup_count, excluded.followup_count),
    first_seen_date    = least(crm_leads.first_seen_date, excluded.first_seen_date),
    last_seen_date     = greatest(crm_leads.last_seen_date, excluded.last_seen_date),
    last_snapshot_id   = excluded.last_snapshot_id,
    raw                = excluded.raw,
    updated_at         = now();

  insert into acc.crm_followups
    (follow_up_id, lead_id, lead_name, business_unit_name, communication_time, call_date,
     call_start_text, next_follow_up_text, status_raw, status, status_detail,
     recording_url, callid, has_recording, call_duration, remarks, lost_reason,
     personnel_id, personnel_name, personnel_email, personnel_role,
     first_seen_date, last_seen_date, first_snapshot_id, last_snapshot_id, raw)
  select f.follow_up_id, f.lead_id, sl.lead_name, sl.business_unit_name, f.communication_time,
         (f.communication_time + make_interval(mins => p_tz_offset_min))::date,
         f.call_start_text, f.next_follow_up_text, f.status_raw, f.status, f.status_detail,
         f.recording_url, f.callid, f.has_recording, f.call_duration, f.remarks, f.lost_reason,
         f.personnel_id, f.personnel_name, f.personnel_email, f.personnel_role,
         f.snapshot_date, f.snapshot_date, p_snapshot_id, p_snapshot_id, f.raw
  from acc.crm_snapshot_followups f
  join acc.crm_snapshot_leads sl on sl.id = f.snapshot_lead_id
  where f.snapshot_id = p_snapshot_id
  on conflict (follow_up_id) do update set
    lead_id             = excluded.lead_id,
    lead_name           = excluded.lead_name,
    business_unit_name  = excluded.business_unit_name,
    communication_time  = excluded.communication_time,
    call_date           = excluded.call_date,
    call_start_text     = excluded.call_start_text,
    next_follow_up_text = excluded.next_follow_up_text,
    status_raw          = excluded.status_raw,
    status              = excluded.status,
    status_detail       = excluded.status_detail,
    recording_url       = excluded.recording_url,
    callid              = excluded.callid,
    has_recording       = excluded.has_recording,
    call_duration       = excluded.call_duration,
    remarks             = excluded.remarks,
    lost_reason         = excluded.lost_reason,
    personnel_id        = coalesce(excluded.personnel_id, crm_followups.personnel_id),
    personnel_name      = coalesce(excluded.personnel_name, crm_followups.personnel_name),
    personnel_email     = coalesce(excluded.personnel_email, crm_followups.personnel_email),
    personnel_role      = coalesce(excluded.personnel_role, crm_followups.personnel_role),
    first_seen_date     = least(crm_followups.first_seen_date, excluded.first_seen_date),
    last_seen_date      = greatest(crm_followups.last_seen_date, excluded.last_seen_date),
    first_snapshot_id   = coalesce(crm_followups.first_snapshot_id, excluded.first_snapshot_id),
    last_snapshot_id    = excluded.last_snapshot_id,
    raw                 = excluded.raw,
    updated_at          = now();

  -- Keeps the materialized ranking in step with the rows just written above (20260917090000).
  refresh materialized view acc.lead_level_progress_v;

  select count(*) into v_recs
    from acc.crm_snapshot_followups where snapshot_id = p_snapshot_id and has_recording;

  update acc.crm_snapshots set
    lead_count       = (select count(*) from acc.crm_snapshot_leads where snapshot_id = p_snapshot_id),
    followup_count   = (select count(*) from acc.crm_snapshot_followups where snapshot_id = p_snapshot_id),
    recording_count  = v_recs,
    status           = 'normalised',
    updated_at       = now()
  where id = p_snapshot_id;

  return jsonb_build_object('leads_inserted', v_leads, 'followups_inserted', v_fups,
                            'recordings', v_recs);
end;
$function$;
