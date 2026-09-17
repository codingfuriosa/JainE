/* Usability: a feature added tomorrow shows up in the report by itself.

   The report is a catalogue LEFT JOIN events, so a feature_key with no catalogue row is counted
   NOWHERE - not as zero, not as anything. That is not a theoretical risk: eleven features had been
   recording real use for weeks and could not be seen at all (opening a month in the HR Monthly
   Update, approving a requisition, closing hiring, generating JD post text, the whole Referrals
   tab), and they only came to light because someone went looking. Every new feature added from now
   on would have carried the same trap, and would have stayed silent until somebody noticed.

   So the catalogue now fills itself in. When erp_log_usage receives a feature_key it has never seen,
   it writes a catalogue row for it before storing the event, and the feature appears on the report
   the moment somebody first uses it - exactly like the ones already there.

   The name is derived from the key, which is why the key's three parts are worth keeping tidy:
     inspection.new_inspection.mark_item_ok_not_ok_n_a
       -> module  'inspection'          (must already exist in erp_modules, else nothing is written)
       -> tab     'New Inspection'
       -> feature 'Mark Item Ok Not Ok N A'

   That machine-made name is readable but not as good as a hand-written one, so the row is flagged
   auto_added = true. Anything carrying that flag is a prompt: "this appeared on its own, give it a
   proper name and a sensible position". Renaming it is a plain update - the flag does not change
   what the report counts, only how it got here.

   Two guards worth stating. A key whose module is not in erp_modules is ignored, so a typo cannot
   invent a module out of nothing (the events insert below already joins erp_modules and would drop
   such an event anyway). And the whole thing sits inside erp_log_usage's existing exception block,
   so if catalogue registration ever fails it cannot take the events down with it - telemetry must
   never break the page it measures. */

alter table public.erp_feature_catalog
  add column if not exists auto_added boolean not null default false;

comment on column public.erp_feature_catalog.auto_added is
  'true = this row wrote itself the first time the feature was used, and its name is derived from '
  'the feature_key. Safe to rename by hand; clear the flag once you have.';

create or replace function public.erp_log_usage(p_events jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_email text;
  v_dept  text;
  v_n     integer := 0;
begin
  v_email := nullif(auth.jwt() ->> 'email', '');
  if v_email is null then
    return 0;                     -- not signed in: record nothing
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    return 0;
  end if;

  select coalesce(
           (select case when cardinality(u.department) > 0 then u.department[1] end
              from adm.users u where lower(u.email) = lower(v_email)),
           (select case when cardinality(up.department) > 0 then up.department[1] end
              from acc.user_profile up where lower(up.email) = lower(v_email)))
    into v_dept;

  /* Register anything new BEFORE the events go in, so the very first use of a feature is already
     visible rather than waiting for the second. */
  insert into public.erp_feature_catalog
    (feature_key, module_id, module_label, tab, feature, sort, active, auto_added)
  select k.fk,
         m.module_id,
         m.label,
         initcap(replace(split_part(k.fk, '.', 2), '_', ' ')),
         initcap(replace(split_part(k.fk, '.', 3), '_', ' ')),
         (select coalesce(max(c2.sort), 0) from public.erp_feature_catalog c2)
           + row_number() over (order by k.fk),
         true,
         true
    from (select distinct nullif(e.j ->> 'feature_key', '') as fk
            from jsonb_array_elements(p_events) as e(j)) k
    join public.erp_modules m on m.module_id = split_part(k.fk, '.', 1)
   where k.fk is not null
     and split_part(k.fk, '.', 3) <> ''          -- must be module.tab.feature, not a stray string
     and not exists (select 1 from public.erp_feature_catalog c where c.feature_key = k.fk)
  on conflict (feature_key) do nothing;

  insert into public.erp_usage_events
    (module_id, feature_key, action, user_email, department, project, duration_ms, occurred_at, meta,
     client_event_id)
  select m.module_id,
         left(coalesce(nullif(e.j ->> 'feature_key', ''), m.module_id), 128),
         case lower(coalesce(e.j ->> 'action', 'view'))
           when 'view'      then 'view'
           when 'route'     then 'route'
           when 'heartbeat' then 'heartbeat'
           when 'create'    then 'create'
           when 'update'    then 'update'
           when 'delete'    then 'delete'
           when 'export'    then 'export'
           when 'search'    then 'search'
           when 'error'     then 'error'
           else 'view'
         end,
         v_email,
         v_dept,
         nullif(left(e.j ->> 'project', 64), ''),
         case when (e.j ->> 'duration_ms') ~ '^[0-9]{1,9}$'
              then (e.j ->> 'duration_ms')::integer end,
         greatest(
           least(
             case when (e.j ->> 'occurred_at') ~ '^\d{4}-\d{2}-\d{2}T'
                  then (e.j ->> 'occurred_at')::timestamptz
                  else now() end,
             now()),
           now() - interval '1 day'),
         case when jsonb_typeof(e.j -> 'meta') = 'object' then e.j -> 'meta' end,
         nullif(left(e.j ->> 'eid', 64), '')
    from (select t.j from jsonb_array_elements(p_events) as t(j) limit 60) e
    join public.erp_modules m on m.module_id = e.j ->> 'module_id'
      on conflict do nothing;

  get diagnostics v_n = row_count;
  return v_n;
exception
  when others then
    raise warning 'erp_log_usage dropped a batch: % (%)', sqlerrm, sqlstate;
    return 0;
end
$function$;
