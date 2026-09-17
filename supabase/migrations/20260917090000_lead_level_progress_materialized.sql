-- THE TRANSCRIPTION PAGE COULD NOT FETCH ANY RANGE, OF ANY WIDTH.
--
-- acc.followup_timeline_v joins acc.lead_level_progress_v, a five-deep chain of window functions
-- (PARTITION BY lead_id throughout) over the whole of acc.crm_followups. 20260911090000 fixed the
-- single-lead case: adding `AND lv.lead_id = f.lead_id` to the join let the planner push a `lead_id =
-- <one id>` filter through every window, so opening one lead costs an index scan instead of a full
-- pass. That trick only works for an EQUALITY predicate on the partition key itself.
--
-- The Automatic Processing page filters by `call_date`, not `lead_id`. call_date is not the partition
-- key, so there is no equivalence for the planner to push through the windows - every request, for
-- any date range, still materialises the entire window chain over every follow-up before the date
-- filter ever applies. Measured directly: 16.1s for a 16-day range, against crm_followups at 21,325
-- rows. The `authenticated` role's statement_timeout is 8s. The page was not failing on 1 September
-- specifically - it was failing on every request, because the table has grown past the point where
-- this fixed cost fits inside the timeout at all.
--
-- The fix: stop paying that cost per request. acc.lead_level_progress_v only changes when
-- acc.crm_followups gets new or updated rows, which happens exactly once per snapshot normalisation
-- (the nightly 00:00 IST run, plus the occasional manual backfill) - never on a page load. So it
-- becomes a MATERIALIZED VIEW, refreshed once at the end of crm_normalise_snapshot (see below) instead
-- of recomputed on every read. Reads against it become a scan of already-computed rows.
--
-- SECURITY NOTE - materialized views have no RLS. As a plain view, lead_level_progress_v got its
-- customer-portal isolation for free: security_invoker=true meant a customer-linked session hit
-- acc.crm_followups' own `not app.is_customer()` policy the moment the view's query touched that
-- table, per 20260828090100. A materialized view has no such propagation - a direct grant would let
-- any authenticated session, customer-linked or not, read it straight off the disk. So the raw
-- materialized view is NOT granted to authenticated at all; a thin ordinary view in front of it
-- (lead_level_progress_v_secured, definer-style - the Postgres default for a view without
-- security_invoker) re-applies the same `not app.is_customer()` check the retrofit put on every other
-- staff table, and that view is what followup_timeline_v now joins, and the only one authenticated may
-- read.

begin;

-- Dropping the view CASCADEs onto acc.followup_timeline_v, which depends on it, and from there onto
-- acc.daily_qa_summary_v, which depends on THAT (checked via pg_depend - nothing depends on
-- daily_qa_summary_v in turn). All three are recreated below, in dependency order. No table is
-- touched by any of this - CASCADE here only ever removes view definitions, never a row of data.
-- acc.crm_lead_detail (20260911090000) is a plpgsql function that references followup_timeline_v by
-- name at runtime, not a tracked view dependency, so it is untouched by the cascade either way.
drop view acc.lead_level_progress_v cascade;

create materialized view acc.lead_level_progress_v as
with h as (
  select
    f.follow_up_id,
    f.lead_id,
    f.status,
    acc.crm_status_rank(f.status) as status_rank,
    acc.crm_status_level(f.status) as status_level,
    row_number() over (
      partition by f.lead_id order by f.communication_time nulls first, f.follow_up_id
    ) as rn,
    max(acc.crm_status_rank(f.status)) over (
      partition by f.lead_id order by f.communication_time nulls first, f.follow_up_id
      rows between unbounded preceding and 1 preceding
    ) as prior_max_rank,
    max(acc.crm_status_rank(f.status)) over (partition by f.lead_id) as lead_max_rank
  from acc.crm_followups f
),
islands as (
  select
    h.follow_up_id, h.lead_id, h.status, h.status_rank, h.status_level, h.rn,
    h.prior_max_rank, h.lead_max_rank,
    count(h.status_rank) over (
      partition by h.lead_id order by h.rn rows between unbounded preceding and current row
    ) as island
  from h
),
carried as (
  select
    i.follow_up_id, i.lead_id, i.status, i.status_rank, i.status_level, i.rn,
    i.prior_max_rank, i.lead_max_rank, i.island,
    first_value(i.status_rank) over (partition by i.lead_id, i.island order by i.rn) as rank_carried
  from islands i
),
prev as (
  select
    c.follow_up_id, c.lead_id, c.status, c.status_rank, c.status_level, c.rn,
    c.prior_max_rank, c.lead_max_rank, c.island, c.rank_carried,
    lag(c.rank_carried) over (partition by c.lead_id order by c.rn) as prev_rank
  from carried c
),
flagged as (
  select
    c.follow_up_id, c.lead_id, c.status, c.status_rank, c.status_level,
    c.prior_max_rank, c.lead_max_rank, c.prev_rank,
    acc.crm_rank_status(c.prior_max_rank) as prior_max_status,
    acc.crm_rank_status(c.lead_max_rank) as lead_max_status,
    case
      when c.prior_max_rank is null then null::integer
      when c.prior_max_rank <= 2 then 1
      else 2
    end::smallint as prior_max_level,
    case
      when c.lead_max_rank is null then null::integer
      when c.lead_max_rank <= 2 then 1
      else 2
    end::smallint as lead_max_level,
    coalesce(c.status_level = 1 and c.prior_max_rank >= 3, false) as below_peak,
    coalesce(
      c.status_level = 1 and (c.prev_rank >= 3 or c.status_rank = 1 and c.prior_max_rank >= 3), false
    ) as level_regression
  from prev c
),
graded as (
  select
    flagged.follow_up_id, flagged.lead_id, flagged.status, flagged.status_rank, flagged.status_level,
    flagged.prior_max_rank, flagged.lead_max_rank, flagged.prev_rank,
    flagged.prior_max_status, flagged.lead_max_status,
    flagged.prior_max_level, flagged.lead_max_level,
    flagged.below_peak, flagged.level_regression,
    acc.crm_rank_status(flagged.prev_rank) as prev_status,
    case
      when not flagged.level_regression then null::text
      when flagged.status_rank = 1 then 'not_allowed'::text
      when flagged.prev_rank = 3 then 'not_allowed'::text
      else 'review'::text
    end as level_regression_severity
  from flagged
)
select
  follow_up_id, lead_id, status_rank, status_level, prev_rank, prev_status,
  prior_max_rank, prior_max_level, prior_max_status,
  lead_max_rank, lead_max_level, lead_max_status,
  below_peak, level_regression, level_regression_severity,
  sum(case when below_peak then 1 else 0 end) over (partition by lead_id) as lead_below_peak_count,
  sum(case when level_regression then 1 else 0 end) over (partition by lead_id) as lead_regression_count,
  sum(case when level_regression_severity = 'not_allowed'::text then 1 else 0 end)
    over (partition by lead_id) as lead_not_allowed_count
from graded
with data;

-- Unique so a future CONCURRENTLY refresh is possible without a further migration; also what backs
-- the join in followup_timeline_v and the per-lead lookup in crm_lead_detail.
create unique index lead_level_progress_v_follow_up_id_key on acc.lead_level_progress_v (follow_up_id);
create index lead_level_progress_v_lead_id_idx on acc.lead_level_progress_v (lead_id);

-- Locked down: only the owner/service_role may read the raw rows. See the SECURITY NOTE above.
revoke all on acc.lead_level_progress_v from public, anon, authenticated;
grant select on acc.lead_level_progress_v to service_role;

-- The only way authenticated may reach the matview. An ordinary view (no security_invoker) runs with
-- the definer's own privileges for permission checks against lead_level_progress_v, same as the retrofit
-- relies on for RLS elsewhere - so this filter is the access control, not a convenience.
create view acc.lead_level_progress_v_secured
with (security_barrier = true) as
select *
from acc.lead_level_progress_v
where not app.is_customer();

grant select on acc.lead_level_progress_v_secured to authenticated, service_role;

-- Unchanged from 20260911090000 except the join target: lv is now the secured view over the
-- materialized data, not the live window-function view. Same columns, same order, same types, same
-- security_invoker, same `AND lv.lead_id = f.lead_id`.
create or replace view acc.followup_timeline_v
with (security_invoker = true) as
 select f.follow_up_id,
    f.lead_id,
    f.lead_name,
    f.business_unit_name,
    f.communication_time,
    f.call_date,
    f.call_start_text,
    f.next_follow_up_text,
    f.status as crm_status,
    f.status_raw as crm_status_raw,
    f.status_detail,
    f.remarks as crm_remarks,
    f.lost_reason as crm_lost_reason,
    f.recording_url,
    f.callid,
    f.has_recording,
    f.call_duration,
    f.first_seen_date,
    f.last_seen_date,
    l.status as lead_current_status,
    l.lost_reason as lead_current_lost_reason,
    t.id as transcript_id,
    coalesce(t.status,
        case
            when f.has_recording then 'not_transcribed'::text
            else 'no_recording'::text
        end) as transcription_status,
    t.transcript,
    t.transcript_text,
    t.turn_count,
    t.languages,
    t.duration_seconds,
    t.non_transcribable_reason,
    t.verification,
    t.model as transcription_model,
    q.id as qa_id,
    q.pitch_accuracy,
    q.pitch_score,
    q.pitch_status,
    q.followup_date_accuracy,
    q.followup_date_status,
    q.lost_reason_accuracy,
    q.lost_reason_status,
    q.remarks_accuracy,
    q.remarks_status,
    q.status_assessment,
    q.ai_assessed_status,
    q.status_match,
    q.mismatch_type,
    q.agent_qa,
    q.qa_score,
    q.summary_verdict,
    q.qa_model,
    q.qa_error,
    coalesce(q.reused_transcription, qq.reused_transcription, false) as reused_transcription,
    qq.status as queue_status,
    qq.fail_phase,
    qq.last_error as queue_error,
    qq.attempt_count,
    qq.qa_attempt_count,
    qq.queue_seq,
    f.personnel_id,
    f.personnel_name,
    f.personnel_email,
    f.personnel_role,
    acc.crm_personnel_team(f.personnel_email) as personnel_team,
    lv.status_rank,
    lv.status_level,
    lv.prev_rank,
    lv.prev_status,
    lv.prior_max_rank,
    lv.prior_max_level,
    lv.prior_max_status,
    lv.below_peak,
    lv.level_regression,
    lv.level_regression_severity,
    lv.lead_max_rank,
    lv.lead_max_level,
    lv.lead_max_status,
    lv.lead_below_peak_count,
    lv.lead_regression_count,
    lv.lead_not_allowed_count,
    coalesce(acc.crm_status_level(l.status) = 1 and lv.lead_max_rank >= 3, false) as lead_status_regression
   from acc.crm_followups f
     left join acc.crm_leads l on l.lead_id = f.lead_id
     left join acc.call_transcripts t on t.recording_url = f.recording_url
     left join acc.followup_qa q on q.follow_up_id = f.follow_up_id
     left join acc.transcription_queue qq on qq.follow_up_id = f.follow_up_id
     left join acc.lead_level_progress_v_secured lv
       on lv.follow_up_id = f.follow_up_id and lv.lead_id = f.lead_id;

grant select on acc.followup_timeline_v to authenticated, service_role;

-- Cascade-dropped along with followup_timeline_v above; recreated verbatim from 20260831090000.
-- Nothing about this view changes - it only ever reads through followup_timeline_v, never touches
-- lead_level_progress_v directly.
create or replace view acc.daily_qa_summary_v
with (security_invoker = true) as
  select call_date as date,
         count(distinct lead_id) as total_leads,
         count(*) as total_followups,
         count(*) filter (where has_recording) as recordings_available,
         count(*) filter (where transcription_status = 'completed') as transcribed,
         count(*) filter (where reused_transcription) as already_transcribed,
         count(*) filter (where transcription_status = 'non_transcribable') as non_transcribable,
         count(*) filter (where transcription_status = 'failed' or queue_status = 'failed') as transcription_failed,
         count(*) filter (where has_recording and queue_status in ('pending','transcribing','qa_pending','qa_running')) as pending,
         count(*) filter (where qa_id is not null) as qa_assessed,
         round(avg(pitch_score) filter (where pitch_score is not null)) as pitch_average_score,
         count(*) filter (where pitch_status = 'Accurate') as pitch_accurate,
         count(*) filter (where pitch_status = 'Partially Accurate') as pitch_partially_accurate,
         count(*) filter (where pitch_status = 'Inaccurate') as pitch_inaccurate,
         count(*) filter (where followup_date_status = 'Accurate') as followup_date_accurate,
         count(*) filter (where followup_date_status = 'Inaccurate') as followup_date_inaccurate,
         count(*) filter (where followup_date_status = 'Not Verifiable') as followup_date_not_verifiable,
         count(*) filter (where lost_reason_status = 'Accurate') as lost_reason_accurate,
         count(*) filter (where lost_reason_status = 'Inaccurate') as lost_reason_inaccurate,
         count(*) filter (where lost_reason_status = 'Not Verifiable') as lost_reason_not_verifiable,
         count(*) filter (where remarks_status = 'Accurate') as remarks_accurate,
         count(*) filter (where remarks_status = 'Partially Accurate') as remarks_partially_accurate,
         count(*) filter (where remarks_status = 'Inaccurate') as remarks_inaccurate,
         count(*) filter (where remarks_status = 'Not Verifiable') as remarks_not_verifiable,
         count(*) filter (where status_match) as status_match,
         count(*) filter (where status_match = false) as status_mismatch,
         count(*) filter (where mismatch_type = 'lost_should_not_have_been_lost') as lost_should_not_have_been_lost,
         count(*) filter (where mismatch_type = 'qualified_should_not_have_been_qualified') as qualified_should_not_have_been_qualified,
         count(*) filter (where mismatch_type = 'in_followup_should_have_been_lost') as in_followup_should_have_been_lost,
         count(*) filter (where mismatch_type = 'in_followup_should_have_been_qualified') as in_followup_should_have_been_qualified,
         round(avg(qa_score) filter (where qa_score is not null)) as agent_qa_average_score
  from acc.followup_timeline_v f
  where call_date is not null
  group by call_date;

grant select on acc.daily_qa_summary_v to authenticated, service_role;

-- Refresh once per normalisation (nightly snapshot + any manual backfill), never per read. Plain
-- REFRESH, not CONCURRENTLY: Postgres refuses CONCURRENTLY from inside a function body at all
-- ("cannot be executed from a function"), and a brief exclusive lock on this matview during the
-- nightly ingestion - the one time it changes - costs nothing real; the page's own traffic is daytime.
create or replace function public.crm_normalise_snapshot(p_snapshot_id bigint, p_tz_offset_min integer default 330)
returns jsonb language plpgsql security definer set search_path = acc, public as $function$
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
     recording_url, callid, has_recording, call_duration, remarks, lost_reason, raw)
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
     first_seen_date, last_seen_date, first_snapshot_id, last_snapshot_id, raw)
  select f.follow_up_id, f.lead_id, sl.lead_name, sl.business_unit_name, f.communication_time,
         (f.communication_time + make_interval(mins => p_tz_offset_min))::date,
         f.call_start_text, f.next_follow_up_text, f.status_raw, f.status, f.status_detail,
         f.recording_url, f.callid, f.has_recording, f.call_duration, f.remarks, f.lost_reason,
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
    first_seen_date     = least(crm_followups.first_seen_date, excluded.first_seen_date),
    last_seen_date      = greatest(crm_followups.last_seen_date, excluded.last_seen_date),
    first_snapshot_id   = coalesce(crm_followups.first_snapshot_id, excluded.first_snapshot_id),
    last_snapshot_id    = excluded.last_snapshot_id,
    raw                 = excluded.raw,
    updated_at          = now();

  -- New: keep the materialized ranking in step with the rows just written above. Everything that
  -- reads lead_level_progress_v (via lead_level_progress_v_secured / followup_timeline_v) sees this
  -- snapshot's data only after this line runs - same as it always effectively did when the chain was
  -- computed live.
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

revoke all on function public.crm_normalise_snapshot(bigint, integer) from public, anon, authenticated;
grant execute on function public.crm_normalise_snapshot(bigint, integer) to service_role;

commit;
