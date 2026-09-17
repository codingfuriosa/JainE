-- Universal automation job queue -- a generic companion to acc.sheet_jobs.
--
-- acc.sheet_jobs stays exactly as-is (a proven, deterministic, single-purpose pipeline:
-- Booking Form -> Google Sheet). This is a SEPARATE table for anything else: any JainE
-- event, or a person, can enqueue a job describing *what* to do (`kind`, `instructions`,
-- `payload`); the extension runs a purpose-built handler when one exists for that kind,
-- or falls back to an agentic runner (Claude deciding actions step by step, bounded by a
-- step cap and a site allowlist) when one doesn't.

create table acc.automation_jobs (
  id           bigint generated always as identity primary key,
  kind         text not null,
  instructions text,
  payload      jsonb not null default '{}'::jsonb,
  status       text not null default 'pending'
               check (status in ('pending','running','done','failed')),
  note         text,
  attempts     int not null default 0,
  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  finished_at  timestamptz,
  created_by   text default app.current_user_email()
);

create index automation_jobs_status_idx on acc.automation_jobs (status, created_at);

alter table acc.automation_jobs enable row level security;
-- No policies: only reachable via the SECURITY DEFINER RPCs below (and postgres/service_role) --
-- same locked-down shape as acc.sheet_jobs and acc.job_secrets.

-- Any signed-in JainE user can enqueue a job -- this is how a person "gives instructions"
-- for a new automation, as opposed to acc.sheet_jobs which is only ever enqueued by a
-- DB trigger. Deliberately NOT secret-gated (unlike claim/finish): creating a job just
-- describes work, it can't read or change anything by itself.
create or replace function acc.automation_job_enqueue(p_kind text, p_instructions text, p_payload jsonb default '{}'::jsonb)
returns bigint
language plpgsql security definer set search_path to 'acc', 'public', 'pg_temp' as $function$
declare v_id bigint;
begin
  insert into acc.automation_jobs (kind, instructions, payload)
  values (p_kind, p_instructions, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $function$;

grant execute on function acc.automation_job_enqueue(text, text, jsonb) to authenticated;

create or replace function acc.automation_job_claim(p_secret text)
returns table(job_id bigint, kind text, instructions text, payload jsonb)
language plpgsql security definer set search_path to 'acc', 'public', 'pg_temp' as $function$
declare v_ok boolean;
begin
  select (value = p_secret) into v_ok from acc.job_secrets where name = 'automation_bot';
  if v_ok is not true then raise exception 'unauthorized'; end if;

  return query
  with picked as (
    select j.id from acc.automation_jobs j
     where j.status = 'pending' and j.attempts < 3
     order by j.created_at
     limit 1 for update skip locked
  )
  update acc.automation_jobs j
     set status = 'running', claimed_at = now(), attempts = j.attempts + 1
    from picked p
   where j.id = p.id
  returning j.id, j.kind, j.instructions, j.payload;
end $function$;

create or replace function acc.automation_job_finish(p_secret text, p_job_id bigint, p_ok boolean, p_note text)
returns void
language plpgsql security definer set search_path to 'acc', 'public', 'pg_temp' as $function$
declare v_ok boolean; v_attempts int;
begin
  select (value = p_secret) into v_ok from acc.job_secrets where name = 'automation_bot';
  if v_ok is not true then raise exception 'unauthorized'; end if;

  select attempts into v_attempts from acc.automation_jobs where id = p_job_id;
  update acc.automation_jobs
     set status = case when p_ok then 'done'
                       when coalesce(v_attempts, 3) >= 3 then 'failed'
                       else 'pending' end,
         note = p_note,
         finished_at = case when p_ok then now() else null end
   where id = p_job_id;
end $function$;

grant execute on function acc.automation_job_claim(text) to anon, authenticated;
grant execute on function acc.automation_job_finish(text, bigint, boolean, text) to anon, authenticated;

-- Same Realtime Broadcast-from-Database pattern as acc.sheet_jobs: a content-free
-- "something's pending" ping (just id/status/created_at, no instructions/payload),
-- so the extension can wake up quickly without exposing job content over Realtime.
create or replace function acc.automation_job_ping() returns trigger
language plpgsql security definer set search_path to 'acc', 'public', 'pg_temp' as $function$
begin
  if new.status = 'pending' then
    perform realtime.send(
      jsonb_build_object('id', new.id, 'status', new.status, 'created_at', new.created_at),
      'automation_job_pending',
      'automation_jobs',
      false
    );
  end if;
  return new;
end $function$;

create trigger trg_automation_job_ping
  after insert or update of status on acc.automation_jobs
  for each row
  when (new.status = 'pending')
  execute function acc.automation_job_ping();

-- Its own secret, scoped to claiming/finishing automation_jobs only -- separate from
-- 'sheet_bot' so either pipeline's access can be revoked independently.
insert into acc.job_secrets (name, value)
values ('automation_bot', encode(gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;
