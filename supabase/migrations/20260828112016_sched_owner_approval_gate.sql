-- Only the schedule's owner may approve or reject a reschedule.
--
-- NOTE: sched_run_decide is replaced once more in
--   20260828112153_sched_owner_gate_harden_jwt_read
-- This file is kept so the history replays in order.

alter table acc.sched_schedules add column if not exists owner_email text;
update acc.sched_schedules set owner_email = created_by where owner_email is null;

create or replace function acc.sched_run_decide(
  p_run_id        bigint,
  p_decision      text,
  p_by            text,
  p_baseline_name text default null,
  p_items         jsonb default '[]'::jsonb
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_sched bigint; v_status text; v_baseline bigint; v_owner text; v_jwt text; v_by text;
begin
  if p_decision not in ('Approved','Rejected') then
    raise exception 'bad decision %', p_decision;
  end if;

  select schedule_id, status into v_sched, v_status
    from acc.sched_runs where id = p_run_id for update;
  if v_sched is null then raise exception 'reschedule run % not found', p_run_id; end if;
  if v_status <> 'Pending' then raise exception 'run % is already %', p_run_id, v_status; end if;

  select coalesce(owner_email, created_by) into v_owner
    from acc.sched_schedules where id = v_sched;

  -- Identity comes from the JWT, not from p_by, so a caller cannot approve as someone else.
  -- A null JWT means this is not a browser call (service role / SQL editor) — left open so the
  -- schedule can still be administered directly.
  v_jwt := app.current_user_email();
  if v_jwt is not null and lower(coalesce(v_owner,'')) <> lower(v_jwt) then
    raise exception 'Only the schedule owner (%) can approve or reject a reschedule',
      coalesce(nullif(v_owner,''), 'nobody — set an owner on the schedule first');
  end if;
  v_by := coalesce(v_jwt, p_by);

  if p_decision = 'Rejected' then
    update acc.sched_runs
       set status='Rejected', decided_by=v_by, decided_at=now()
     where id = p_run_id;
    return null;
  end if;

  update acc.sched_activities a
     set planned_start    = i.new_start,
         planned_duration = coalesce(i.new_duration, a.planned_duration),
         updated_at       = now()
    from acc.sched_run_items i
   where i.run_id = p_run_id and a.id = i.activity_id and a.schedule_id = v_sched;

  v_baseline := acc.sched_baseline_create(
    v_sched,
    coalesce(nullif(p_baseline_name,''), 'Rescheduled'),
    'Created automatically on approval of reschedule #'||p_run_id,
    'reschedule', p_items, v_by, v_by);

  update acc.sched_runs
     set status='Approved', decided_by=v_by, decided_at=now(), baseline_id=v_baseline
   where id = p_run_id;

  return v_baseline;
end $$;

revoke all on function acc.sched_run_decide(bigint,text,text,text,jsonb) from public;
grant execute on function acc.sched_run_decide(bigint,text,text,text,jsonb) to authenticated;
