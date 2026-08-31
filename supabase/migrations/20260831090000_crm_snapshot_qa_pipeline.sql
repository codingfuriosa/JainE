-- CRM SNAPSHOT -> SEQUENTIAL TRANSCRIPTION -> CRM-vs-CONVERSATION QA.
--
-- The schema behind supabase/functions/crm-snapshot-qa/. It replaces the shape the previous pipeline
-- worked in - one row per LEAD in acc.transcriptions, with earlier calls folded into a JSON column -
-- because the CRM feed changed underneath it. The feed now returns one object per lead carrying its
-- complete `history` array, so a lead's every follow-up is its own durable row here.
--
-- NOTHING HERE TOUCHES acc.transcriptions. Every row the old pipeline imported, and the Manual
-- Upload / Folders / Deleted / Discrepancies / Compilation tabs that read them, are left exactly as
-- they are. This is additive.
--
-- THE FIVE THINGS THIS SHAPE EXISTS TO GUARANTEE
--   1. The CRM response is stored VERBATIM before a single recording is touched (acc.crm_snapshots),
--      and never cleared. Everything downstream is derived from the stored copy, never from a second
--      call to the CRM - so the day's processing cannot change under us if the CRM changes.
--   2. A day can be re-fetched. A response whose sha differs supersedes the previous one and keeps
--      it; identical bytes re-run the normalisation and change nothing.
--   3. Deduplication is keyed on recording_url in acc.call_transcripts, which is UNIQUE. A recording
--      already transcribed is reused, never re-sent to a model, never billed twice.
--   4. Deduplicating the WORK never deduplicates the HISTORY. acc.crm_followups keeps every
--      follow-up the CRM ever sent, whether or not its recording was new, so a lead's history stays
--      complete.
--   5. The three layers stay separate: crm_* columns are CRM FACT, call_transcripts is CONVERSATION
--      FACT, followup_qa is ASSESSMENT. The model writes only the third.
--
-- IDEMPOTENT. Every statement is `if not exists` / `or replace`, so this can be applied to the
-- database it was reverse-engineered from without altering a single row.

begin;

-- ------------------------------------------------------------ 0. TEXT HELPERS
-- The feed writes absence as text rather than as null, and not always the same text. Normalising in
-- the database rather than in the function means the stored history and anything queried later agree
-- about what "empty" is.
create or replace function acc.crm_text(v text) returns text language sql immutable as $function$
  select case when v is null then null
              when lower(btrim(v)) in ('none','null','undefined','na','n/a','-','') then null
              else btrim(v) end;
$function$;

create or replace function acc.crm_num(v text) returns numeric language sql immutable as $function$
  select case when acc.crm_text(v) ~ '^-?[0-9]+(\.[0-9]+)?$' then acc.crm_text(v)::numeric else null end;
$function$;

-- The CRM sends "lost" and "In Followup" - inconsistent casing and spacing for one status. An
-- unrecognised value is kept as itself rather than dropped, so a new status appears on screen as
-- what it is instead of silently blank.
create or replace function acc.crm_status_canon(v text) returns text language sql immutable as $function$
  select case lower(btrim(coalesce(v,'')))
    when 'lost'          then 'Lost'
    when 'in followup'   then 'In Follow Up'
    when 'in follow up'  then 'In Follow Up'
    when 'followup'      then 'In Follow Up'
    when 'follow up'     then 'In Follow Up'
    when 'qualified'     then 'Qualified'
    when 'ov'            then 'OV'
    when 'sit visited'   then 'Site Visited'
    when 'site visited'  then 'Site Visited'
    else nullif(btrim(coalesce(v,'')), '') end;
$function$;

-- A follow-up's status arrives as "Lost:NO REQUIREMENT" - one field holding a status AND its reason.
-- Split here rather than parsed at every read: the head is what the four mismatch categories compare
-- against, and the detail is what a person wants to see.
create or replace function acc.crm_status_head(v text) returns text language sql immutable as $function$
  select case
    when acc.crm_text(v) is null            then null
    when position(':' in v) > 0             then acc.crm_status_canon(split_part(v, ':', 1))
    when v ~* '^\s*sit[e]? visited'         then 'Site Visited'
    else acc.crm_status_canon(v) end;
$function$;

create or replace function acc.crm_status_detail(v text) returns text language sql immutable as $function$
  select case
    when acc.crm_text(v) is null    then null
    when position(':' in v) > 0     then acc.crm_text(substring(v from position(':' in v) + 1))
    when v ~* '^\s*sit[e]? visited on'
      then acc.crm_text(regexp_replace(v, '^\s*sit[e]? visited on\s*', '', 'i'))
    else null end;
$function$;

-- ------------------------------------------------- 1. THE RESPONSE, AS RECEIVED
-- `raw` is what the CRM sent, parsed as JSON and otherwise untouched, and is NEVER cleared.
-- raw_sha is what makes a re-fetch cheap and safe: identical bytes are recognised as the same day.
create table if not exists acc.crm_snapshots (
  id bigint generated by default as identity primary key,
  snapshot_date date not null,
  from_date date not null,
  to_date date not null,
  revision integer not null default 1,
  trigger text,
  status text not null default 'fetched',
  raw jsonb,
  raw_sha text,
  raw_bytes integer,
  lead_count integer,
  followup_count integer,
  recording_count integer,
  new_recording_count integer,
  error_text text,
  -- A second fetch of the same day does not overwrite the first: the old row is superseded and kept,
  -- so "what did the CRM say at midnight" stays answerable after the CRM has moved on.
  superseded_at timestamptz,
  superseded_by bigint references acc.crm_snapshots(id),
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table acc.crm_snapshots is
  'The complete CRM API response for one day, verbatim. Source of truth for everything downstream; never cleared.';
create unique index if not exists crm_snapshots_current_day
  on acc.crm_snapshots (snapshot_date) where superseded_at is null;
create index if not exists crm_snapshots_date on acc.crm_snapshots (snapshot_date desc, revision desc);

-- The same response, unpacked one row per lead and one per follow-up, still scoped to the snapshot it
-- came from. This is the audit copy: it says what the CRM claimed ON THAT DAY, which is not the same
-- question as what the CRM claims now.
create table if not exists acc.crm_snapshot_leads (
  id bigint generated by default as identity primary key,
  snapshot_id bigint not null references acc.crm_snapshots(id) on delete cascade,
  snapshot_date date not null,
  lead_id bigint not null,
  lead_name text,
  status text,
  business_unit_name text,
  lost_reason text,
  followup_count integer,
  raw jsonb not null,
  created_at timestamptz not null default now(),
  unique (snapshot_id, lead_id)
);

create table if not exists acc.crm_snapshot_followups (
  id bigint generated by default as identity primary key,
  snapshot_id bigint not null references acc.crm_snapshots(id) on delete cascade,
  snapshot_lead_id bigint references acc.crm_snapshot_leads(id) on delete cascade,
  snapshot_date date not null,
  lead_id bigint not null,
  follow_up_id bigint not null,
  communication_time timestamptz,
  -- call_start_time and next_follow_up_date arrive as IST WALL CLOCK wearing a Z. Kept as TEXT on
  -- purpose: casting them to timestamptz would move every one of them by five and a half hours, and
  -- an 11 AM callback would be stored as 5:30 AM.
  call_start_text text,
  next_follow_up_text text,
  status_raw text,
  status text,
  status_detail text,
  recording_url text,
  callid text,
  has_recording boolean not null default false,
  call_duration numeric,
  remarks text,
  lost_reason text,
  raw jsonb not null,
  created_at timestamptz not null default now(),
  unique (snapshot_id, follow_up_id)
);
create index if not exists crm_snapshot_leads_lead on acc.crm_snapshot_leads (lead_id);
create index if not exists crm_snapshot_followups_lead on acc.crm_snapshot_followups (lead_id);
create index if not exists crm_snapshot_followups_rec on acc.crm_snapshot_followups (recording_url)
  where recording_url is not null;

-- --------------------------------------------------- 2. THE CURRENT CRM STATE
-- One row per lead and one per follow-up, carried forward across every snapshot. crm_followups is the
-- LEAD HISTORY, and it is the table that keeps a repeated recording in the story: that recording is
-- not transcribed again, but its follow-up still has a row here, so nothing drops out of the history.
create table if not exists acc.crm_leads (
  lead_id bigint primary key,
  lead_name text,
  status text,
  business_unit_name text,
  lost_reason text,
  followup_count integer not null default 0,
  first_seen_date date,
  last_seen_date date,
  last_snapshot_id bigint references acc.crm_snapshots(id),
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table acc.crm_leads is
  'Current CRM state per lead, from the latest snapshot that mentioned it. CRM FACT - never written by the QA step.';

create table if not exists acc.crm_followups (
  follow_up_id bigint primary key,
  lead_id bigint not null,
  lead_name text,
  business_unit_name text,
  communication_time timestamptz,
  call_date date,
  call_start_text text,
  next_follow_up_text text,
  status_raw text,
  status text,
  status_detail text,
  recording_url text,
  callid text,
  has_recording boolean not null default false,
  call_duration numeric,
  remarks text,
  lost_reason text,
  first_seen_date date,
  last_seen_date date,
  first_snapshot_id bigint references acc.crm_snapshots(id),
  last_snapshot_id bigint references acc.crm_snapshots(id),
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table acc.crm_followups is
  'Every follow-up ever seen, one row each. Deduplicating TRANSCRIPTION never removes a row here - a repeated recording still belongs to the lead history.';
create index if not exists crm_followups_lead on acc.crm_followups (lead_id, communication_time);
create index if not exists crm_followups_date on acc.crm_followups (call_date);
create index if not exists crm_followups_rec on acc.crm_followups (recording_url) where recording_url is not null;

-- ----------------------------------------------- 3. ONE TRANSCRIPT PER RECORDING
-- THE deduplication key. recording_url is unique, so the same recording arriving in a later snapshot
-- - or against a different follow-up - finds a completed row and reuses it. callid is unique too, as
-- the stable secondary identity if the URL is ever rewritten.
-- THE AUDIO IS NEVER STORED: it is fetched into memory for one model call and dropped. There is no
-- audio column, no bucket, no blob - only the ~90 byte URL.
create table if not exists acc.call_transcripts (
  id bigint generated by default as identity primary key,
  recording_url text not null unique,
  callid text unique,
  status text not null,
  transcript jsonb,
  transcript_text text,
  turn_count integer,
  languages text[],
  duration_seconds numeric,
  crm_duration numeric,
  -- The transcriber is never told the CRM's name, so comparing the two afterwards stays an honest
  -- check on whether the model listened or composed.
  heard_customer_name text,
  non_transcribable_reason text,
  verification jsonb,
  model text,
  attempt_count integer not null default 0,
  last_error text,
  -- Kept ONLY when a reply could not be parsed. Never presented as a transcript.
  raw_reply text,
  first_follow_up_id bigint,
  first_seen_date date,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
comment on table acc.call_transcripts is
  'One row per recording_url. THE deduplication key for transcription: a completed row is reused, never re-transcribed.';
create index if not exists call_transcripts_status on acc.call_transcripts (status);

-- ------------------------------------------------ 4. ONE ASSESSMENT PER FOLLOW-UP
-- The crm_* columns are frozen copies of what the CRM said at the moment of judging, so the verdict
-- stays readable after the CRM has been corrected. The model never writes them.
create table if not exists acc.followup_qa (
  id bigint generated by default as identity primary key,
  follow_up_id bigint not null unique,
  lead_id bigint not null,
  lead_name text,
  business_unit_name text,
  call_date date,
  snapshot_date date,
  recording_url text,
  transcript_id bigint references acc.call_transcripts(id),
  reused_transcription boolean not null default false,

  crm_status text,
  crm_status_raw text,
  crm_remarks text,
  crm_next_follow_up text,
  crm_lost_reason text,
  call_start_text text,
  call_duration numeric,

  -- The four accuracy assessments, each holding its own status, evidence and reasoning.
  pitch_accuracy jsonb,
  followup_date_accuracy jsonb,
  lost_reason_accuracy jsonb,
  remarks_accuracy jsonb,
  status_assessment jsonb,

  pitch_score integer,
  pitch_status text,
  followup_date_status text,
  lost_reason_status text,
  remarks_status text,
  ai_assessed_status text,
  -- status_match and mismatch_type are RE-DERIVED by the edge function from the two statuses, never
  -- trusted from the model's own field, so a model that contradicts itself cannot corrupt the counts.
  status_match boolean,
  mismatch_type text,

  agent_qa jsonb,
  qa_score integer,
  summary_verdict text,
  qa_model text,
  qa_raw text,
  qa_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The dashboard counts these four by name. A typo would silently become a fifth category that no
  -- card ever shows, so the database refuses one.
  constraint followup_qa_mismatch_type_known check (
    mismatch_type is null or mismatch_type in (
      'lost_should_not_have_been_lost',
      'qualified_should_not_have_been_qualified',
      'in_followup_should_have_been_lost',
      'in_followup_should_have_been_qualified')),
  constraint followup_qa_pitch_score_range check (
    pitch_score is null or (pitch_score >= 0 and pitch_score <= 100))
);
comment on table acc.followup_qa is
  'One assessment per follow-up. The crm_* columns are the CRM own values, frozen; the model never overwrites them.';
create index if not exists followup_qa_lead on acc.followup_qa (lead_id);
create index if not exists followup_qa_call_date on acc.followup_qa (call_date);
create index if not exists followup_qa_mismatch on acc.followup_qa (mismatch_type) where mismatch_type is not null;

-- --------------------------------------------------------------- 5. THE QUEUE
-- One row per follow-up THAT HAS A RECORDING. queue_seq comes from a sequence rather than a
-- max()+1 read, so two overlapping builds cannot hand out the same number and the order survives
-- restarts.
create sequence if not exists acc.crm_queue_seq as bigint start 1 increment 1;

create table if not exists acc.transcription_queue (
  id bigint generated by default as identity primary key,
  follow_up_id bigint not null unique,
  lead_id bigint not null,
  snapshot_id bigint references acc.crm_snapshots(id),
  snapshot_date date,
  call_date date,
  recording_url text not null,
  callid text,
  queue_seq bigint not null,
  -- pending -> transcribing -> qa_pending -> qa_running -> completed
  -- skipped_existing is a real outcome, not a failure: the recording was already transcribed.
  status text not null default 'pending',
  -- A failure resumes at the PHASE THAT FAILED. A QA call that rate-limited must not send the
  -- recording back through the transcriber - that audio is already transcribed and already paid for.
  fail_phase text,
  reused_transcription boolean not null default false,
  transcript_id bigint references acc.call_transcripts(id),
  attempt_count integer not null default 0,
  qa_attempt_count integer not null default 0,
  last_error text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists transcription_queue_status on acc.transcription_queue (status);
create index if not exists transcription_queue_date on acc.transcription_queue (snapshot_date);
-- The queue read, every tick, for ever: the head of the claimable statuses in sequence order.
create index if not exists transcription_queue_order on acc.transcription_queue (queue_seq, id)
  where status in ('pending', 'qa_pending');

create or replace function public.next_crm_queue_block(n integer)
returns bigint language plpgsql security definer set search_path = acc, public as $function$
declare
  last_val bigint;
begin
  if n is null or n < 1 then n := 1; end if;
  select max(v) into last_val
    from (select nextval('acc.crm_queue_seq') as v from generate_series(1, n)) s;
  return last_val - n + 1;
end;
$function$;

-- ------------------------------------------ 6. NORMALISE THE STORED RESPONSE
-- Reads acc.crm_snapshots.raw and nothing else. The edge function calls this AFTER the response is
-- safely stored, which is what makes the day's processing independent of the CRM staying still.
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

-- ---------------------------------------------- 7. BUILD THE QUEUE FROM STORAGE
-- From acc.crm_snapshot_followups, never from a fresh CRM call. Only follow-ups with a recording get
-- a queue row; `not exists` against the queue is what makes re-running a day a no-op.
create or replace function public.crm_build_queue(p_snapshot_id bigint, p_tz_offset_min integer default 330)
returns jsonb language plpgsql security definer set search_path = acc, public as $function$
declare
  v_n     integer;
  v_start bigint;
  v_ins   integer := 0;
begin
  select count(*) into v_n
  from acc.crm_snapshot_followups f
  where f.snapshot_id = p_snapshot_id and f.has_recording
    and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id);

  if coalesce(v_n, 0) = 0 then
    update acc.crm_snapshots set status = 'queued', updated_at = now() where id = p_snapshot_id;
    return jsonb_build_object('queued', 0, 'already_queued', true);
  end if;

  v_start := public.next_crm_queue_block(v_n);

  with candidates as (
    select f.*,
           row_number() over (order by f.communication_time desc nulls last,
                                       f.follow_up_id desc) - 1 as rn
    from acc.crm_snapshot_followups f
    where f.snapshot_id = p_snapshot_id and f.has_recording
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

  return jsonb_build_object('queued', v_ins);
end;
$function$;

revoke all on function public.next_crm_queue_block(integer) from public, anon, authenticated;
revoke all on function public.crm_normalise_snapshot(bigint, integer) from public, anon, authenticated;
revoke all on function public.crm_build_queue(bigint, integer) from public, anon, authenticated;
grant execute on function public.next_crm_queue_block(integer) to service_role;
grant execute on function public.crm_normalise_snapshot(bigint, integer) to service_role;
grant execute on function public.crm_build_queue(bigint, integer) to service_role;

-- --------------------------------------------------------------- 8. THE VIEWS
-- One row per follow-up with its transcript and its assessment joined on. This is what the UI reads:
-- the CRM's own history, what was actually said, and where the two disagree cannot drift apart if
-- they arrive together. security_invoker so the RLS policies below still apply through the view.
create or replace view acc.followup_timeline_v with (security_invoker = true) as
  select f.follow_up_id, f.lead_id, f.lead_name, f.business_unit_name, f.communication_time,
         f.call_date, f.call_start_text, f.next_follow_up_text,
         f.status as crm_status, f.status_raw as crm_status_raw, f.status_detail,
         f.remarks as crm_remarks, f.lost_reason as crm_lost_reason,
         f.recording_url, f.callid, f.has_recording, f.call_duration,
         f.first_seen_date, f.last_seen_date,
         l.status as lead_current_status, l.lost_reason as lead_current_lost_reason,
         t.id as transcript_id,
         -- A follow-up with no recording is not "waiting" and never will be. Saying so here is what
         -- keeps every count downstream honest about the difference.
         coalesce(t.status, case when f.has_recording then 'not_transcribed' else 'no_recording' end)
           as transcription_status,
         t.transcript, t.transcript_text, t.turn_count, t.languages, t.duration_seconds,
         t.non_transcribable_reason, t.verification, t.model as transcription_model,
         q.id as qa_id,
         q.pitch_accuracy, q.pitch_score, q.pitch_status,
         q.followup_date_accuracy, q.followup_date_status,
         q.lost_reason_accuracy, q.lost_reason_status,
         q.remarks_accuracy, q.remarks_status,
         q.status_assessment, q.ai_assessed_status, q.status_match, q.mismatch_type,
         q.agent_qa, q.qa_score, q.summary_verdict, q.qa_model, q.qa_error,
         coalesce(q.reused_transcription, qq.reused_transcription, false) as reused_transcription,
         qq.status as queue_status, qq.fail_phase, qq.last_error as queue_error,
         qq.attempt_count, qq.qa_attempt_count, qq.queue_seq
  from acc.crm_followups f
  left join acc.crm_leads l on l.lead_id = f.lead_id
  -- on recording_url, not on a transcript id: that join IS the deduplication, and it is what makes a
  -- reused transcript appear against every follow-up that shares the recording.
  left join acc.call_transcripts t on t.recording_url = f.recording_url
  left join acc.followup_qa q on q.follow_up_id = f.follow_up_id
  left join acc.transcription_queue qq on qq.follow_up_id = f.follow_up_id;

-- The day's numbers, including the four mismatch counts by name.
create or replace view acc.daily_qa_summary_v with (security_invoker = true) as
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

-- ---------------------------------------------------------------- 9. ACCESS
-- Read-only to signed-in staff; every write goes through the edge function's service-role key.
-- Customers are excluded: these rows are internal sales QA, not anything a customer may see.
do $$
declare t text;
begin
  foreach t in array array['crm_snapshots','crm_snapshot_leads','crm_snapshot_followups',
                           'crm_leads','crm_followups','call_transcripts','followup_qa',
                           'transcription_queue']
  loop
    execute format('alter table acc.%I enable row level security', t);
    execute format('grant select on acc.%I to authenticated', t);
    if not exists (select 1 from pg_policies
                   where schemaname='acc' and tablename=t and policyname=t||'_read') then
      execute format('create policy %I on acc.%I for select to authenticated using (not app.is_customer())',
                     t||'_read', t);
    end if;
  end loop;
end $$;
grant select on acc.followup_timeline_v, acc.daily_qa_summary_v to authenticated;

commit;

-- Check:
--   select status, count(*) from acc.transcription_queue group by 1;
--   select * from acc.daily_qa_summary_v order by date desc limit 7;
--   select count(*) as followups, count(distinct recording_url) as recordings from acc.crm_followups;
