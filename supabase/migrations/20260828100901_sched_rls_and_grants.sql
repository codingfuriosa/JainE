-- Same posture as acc.inspection: signed-in users of the portal can read and write; the module
-- itself gates who sees the tab (Control Panel module access).
do $$
declare t text;
begin
  foreach t in array array[
    'sched_contractors','sched_schedules','sched_activities','sched_deps',
    'sched_baselines','sched_baseline_items','sched_runs','sched_run_items'
  ] loop
    execute format('alter table acc.%I enable row level security', t);
    execute format('drop policy if exists %I on acc.%I', t||'_read',  t);
    execute format('drop policy if exists %I on acc.%I', t||'_ins',   t);
    execute format('drop policy if exists %I on acc.%I', t||'_upd',   t);
    execute format('drop policy if exists %I on acc.%I', t||'_del',   t);
    execute format('create policy %I on acc.%I for select to authenticated using (true)', t||'_read', t);
    execute format('create policy %I on acc.%I for insert to authenticated with check (true)', t||'_ins', t);
    execute format('create policy %I on acc.%I for update to authenticated using (true) with check (true)', t||'_upd', t);
    execute format('create policy %I on acc.%I for delete to authenticated using (true)', t||'_del', t);
    execute format('grant select, insert, update, delete on acc.%I to authenticated', t);
  end loop;
end $$;

grant usage on schema acc to authenticated;
