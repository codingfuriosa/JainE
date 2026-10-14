-- Working-day arithmetic and the CPM forward pass live in the browser (scheduling.js) so there is
-- exactly one implementation of the calendar. These RPCs exist only for the steps that must be
-- atomic: snapshotting a baseline, and applying an approved reschedule.
--
-- NOTE: sched_run_decide is replaced twice after this migration —
--   20260828112016_sched_owner_approval_gate         (owner-only approval)
--   20260828112153_sched_owner_gate_harden_jwt_read  (tolerate an unreadable JWT claim)
-- This file is kept so the history replays in order.

-- p_items: [{activity_id, planned_start, planned_finish, planned_duration,
--            actual_start, actual_finish, progress_pct}, …]
create or replace function acc.sched_baseline_create(
  p_schedule_id bigint,
  p_name        text,
  p_note        text,
  p_source      text,
  p_items       jsonb,
  p_created_by  text,
  p_approved_by text default null
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_seq int; v_id bigint;
begin
  if p_source not in ('manual','reschedule') then
    raise exception 'bad source %', p_source;
  end if;

  select coalesce(max(seq),0)+1 into v_seq
    from acc.sched_baselines where schedule_id = p_schedule_id;

  update acc.sched_baselines set is_current = false
    where schedule_id = p_schedule_id and is_current;

  insert into acc.sched_baselines(schedule_id,seq,name,note,source,is_current,
                                  created_by,approved_by,approved_at)
  values (p_schedule_id, v_seq, coalesce(nullif(p_name,''),'Baseline '||v_seq), p_note,
          p_source, true, p_created_by, p_approved_by,
          case when p_approved_by is null then null else now() end)
  returning id into v_id;

  insert into acc.sched_baseline_items(baseline_id,activity_id,planned_start,planned_finish,
                                       planned_duration,actual_start,actual_finish,progress_pct)
  select v_id,
         (x->>'activity_id')::bigint,
         nullif(x->>'planned_start','')::date,
         nullif(x->>'planned_finish','')::date,
         nullif(x->>'planned_duration','')::int,
         nullif(x->>'actual_start','')::date,
         nullif(x->>'actual_finish','')::date,
         nullif(x->>'progress_pct','')::int
    from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x
   where exists (select 1 from acc.sched_activities a
                  where a.id = (x->>'activity_id')::bigint
                    and a.schedule_id = p_schedule_id);
  return v_id;
end $$;

-- Approve or reject a proposed reschedule. On approval the proposed dates are written back to the
-- activities and the resulting plan is frozen as the next baseline — one transaction, so the plan
-- and the baseline can never disagree.
create or replace function acc.sched_run_decide(
  p_run_id        bigint,
  p_decision      text,
  p_by            text,
  p_baseline_name text default null,
  p_items         jsonb default '[]'::jsonb
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_sched bigint; v_status text; v_baseline bigint;
begin
  if p_decision not in ('Approved','Rejected') then
    raise exception 'bad decision %', p_decision;
  end if;

  select schedule_id, status into v_sched, v_status
    from acc.sched_runs where id = p_run_id for update;
  if v_sched is null then raise exception 'reschedule run % not found', p_run_id; end if;
  if v_status <> 'Pending' then raise exception 'run % is already %', p_run_id, v_status; end if;

  if p_decision = 'Rejected' then
    update acc.sched_runs
       set status='Rejected', decided_by=p_by, decided_at=now()
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
    'reschedule', p_items, p_by, p_by);

  update acc.sched_runs
     set status='Approved', decided_by=p_by, decided_at=now(), baseline_id=v_baseline
   where id = p_run_id;

  return v_baseline;
end $$;

revoke all on function acc.sched_baseline_create(bigint,text,text,text,jsonb,text,text) from public;
revoke all on function acc.sched_run_decide(bigint,text,text,text,jsonb) from public;
grant execute on function acc.sched_baseline_create(bigint,text,text,text,jsonb,text,text) to authenticated;
grant execute on function acc.sched_run_decide(bigint,text,text,text,jsonb) to authenticated;
