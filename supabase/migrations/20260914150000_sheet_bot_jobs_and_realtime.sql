-- sheet-bot: Booking Form -> Google Sheet automation
--
-- Mirrors the acc.erp_jobs / erp_job_claim / erp_job_finish pattern (tools/erp-bot/),
-- but triggers off acc.booking_audits reaching status='done' (the point where the
-- OCR/AI pipeline has actually populated `result` with the booking's fields) rather
-- than off the Booking Form flow_cases insert itself.
--
-- Unlike acc.erp_jobs, acc.sheet_jobs has no unique(case_id): a booking that gets
-- reprocessed (status flips back to 'done' a second time) is expected to produce a
-- second job, because the Sheet automation deletes its previously-written row for
-- that case and appends a fresh one (see tools/sheet-bot/src/sheet-cdp.js) rather
-- than blocking a second entry.
--
-- The "a job is pending" signal is pushed via Realtime Broadcast-from-Database
-- (realtime.send), not via a postgres_changes subscription on the table itself.
-- RLS is row-level only, so a policy exposing rows to `anon` would still ship every
-- column (including case_id) over postgres_changes; broadcasting an explicitly
-- constructed payload avoids that by construction. acc.sheet_jobs itself stays fully
-- locked down (RLS enabled, zero policies), reachable only via the two RPCs below,
-- same as acc.job_secrets already is.

create table if not exists acc.sheet_jobs (
  id          bigint generated always as identity primary key,
  case_id     bigint not null references acc.flow_cases(id) on delete cascade,
  status      text not null default 'pending'
              check (status in ('pending','running','done','failed')),
  note        text,
  attempts    int not null default 0,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  finished_at timestamptz
);

create index if not exists sheet_jobs_status_idx on acc.sheet_jobs (status, created_at);
create index if not exists sheet_jobs_case_id_idx on acc.sheet_jobs (case_id);

alter table acc.sheet_jobs enable row level security;
-- No policies: only reachable via the SECURITY DEFINER RPCs below (and postgres/service_role).

-- Enqueue a sheet_job whenever a Booking Form's OCR pass finishes.
create or replace function acc.sheet_job_enqueue() returns trigger
language plpgsql security definer set search_path to 'acc', 'public', 'pg_temp' as $function$
declare v_flow_id bigint;
begin
  select flow_id into v_flow_id from acc.flow_cases where id = new.case_id;
  if v_flow_id = 41 then
    insert into acc.sheet_jobs (case_id) values (new.case_id);
    update acc.booking_audits set automation_notified_at = now() where case_id = new.case_id;
  end if;
  return new;
end $function$;

drop trigger if exists trg_sheet_job_enqueue on acc.booking_audits;
create trigger trg_sheet_job_enqueue
  after update of status on acc.booking_audits
  for each row
  when (new.status = 'done' and old.status is distinct from 'done')
  execute function acc.sheet_job_enqueue();

-- Claim one pending job. Returns the full OCR result inline (audit_result) because
-- anon has no direct grant on acc.booking_audits, or any other acc table -- the only
-- way for the PC-side service to read booking data is through this SECURITY DEFINER
-- function, exactly like erp_job_claim already does for case_no.
create or replace function acc.sheet_job_claim(p_secret text)
returns table(job_id bigint, case_id bigint, case_no int, audit_result jsonb)
language plpgsql security definer set search_path to 'acc', 'public', 'pg_temp' as $function$
declare v_ok boolean;
begin
  select (value = p_secret) into v_ok from acc.job_secrets where name = 'sheet_bot';
  if v_ok is not true then raise exception 'unauthorized'; end if;

  return query
  with picked as (
    select j.id from acc.sheet_jobs j
     where j.status = 'pending' and j.attempts < 3
     order by j.created_at
     limit 1 for update skip locked
  )
  update acc.sheet_jobs j
     set status = 'running', claimed_at = now(), attempts = j.attempts + 1
    from picked p, acc.flow_cases c, acc.booking_audits b
   where j.id = p.id and c.id = j.case_id and b.case_id = j.case_id
  returning j.id, j.case_id, c.case_no, b.result;
end $function$;

create or replace function acc.sheet_job_finish(p_secret text, p_job_id bigint, p_ok boolean, p_note text)
returns void
language plpgsql security definer set search_path to 'acc', 'public', 'pg_temp' as $function$
declare v_ok boolean; v_attempts int;
begin
  select (value = p_secret) into v_ok from acc.job_secrets where name = 'sheet_bot';
  if v_ok is not true then raise exception 'unauthorized'; end if;

  select attempts into v_attempts from acc.sheet_jobs where id = p_job_id;
  update acc.sheet_jobs
     set status = case when p_ok then 'done'
                       when coalesce(v_attempts, 3) >= 3 then 'failed'
                       else 'pending' end,
         note = p_note,
         finished_at = case when p_ok then now() else null end
   where id = p_job_id;
end $function$;

grant execute on function acc.sheet_job_claim(text) to anon, authenticated;
grant execute on function acc.sheet_job_finish(text, bigint, boolean, text) to anon, authenticated;

-- Broadcast a content-free "something's pending" ping. No case_id, no PII: only the
-- job's own id/status/created_at, so a listener learns nothing about the booking
-- itself without going through sheet_job_claim (which is secret-gated).
create or replace function acc.sheet_job_ping() returns trigger
language plpgsql security definer set search_path to 'acc', 'public', 'pg_temp' as $function$
begin
  if new.status = 'pending' then
    perform realtime.send(
      jsonb_build_object('id', new.id, 'status', new.status, 'created_at', new.created_at),
      'sheet_job_pending',
      'sheet_jobs',
      false
    );
  end if;
  return new;
end $function$;

drop trigger if exists trg_sheet_job_ping on acc.sheet_jobs;
create trigger trg_sheet_job_ping
  after insert or update of status on acc.sheet_jobs
  for each row
  when (new.status = 'pending')
  execute function acc.sheet_job_ping();

-- One secret, scoped to claiming/finishing sheet_jobs only -- same model as 'erp_bot'.
insert into acc.job_secrets (name, value)
values ('sheet_bot', encode(gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;
