/* Usability: a batch that reaches the server twice now only counts once.

   28 live events are sitting in the table as exact duplicates - same person, same feature, same
   microsecond - across 24 clicks by 5 people. Worst affected: filtering Legal cases by hearing date
   (10 extra), forwarding and receiving workflow steps (5 each), previewing a Legal document (4).
   At 1% of live events it is not what is wrong with the report, but it is wrong, and it is the kind
   of wrong that quietly grows.

   How they got there: usageFlush puts a failed batch back on the queue and sends it again. From the
   client's side "failed" also covers the case where the server committed the rows and the response
   was lost coming back - a tab going hidden mid-request does exactly this, which is why forwarding
   and receiving steps, clicked and immediately navigated away from, are the worst hit. The client
   cannot tell that apart from a real failure and should not have to.

   So the client now stamps each event with a once-only id and the server refuses an id it has
   already stored. Re-sending becomes harmless, which lets the retry stay as useful as it is - it
   was added because a network blip used to erase activity outright, and that is still worth having.

   Old events carry no id, so the unique index is partial; they are simply left alone, and the 28
   already-duplicated rows are archived and removed below rather than deleted outright, the same way
   the September double-counted workflow starts were handled. */

alter table public.erp_usage_events
  add column if not exists client_event_id text;

create unique index if not exists erp_usage_events_client_event_id_uniq
  on public.erp_usage_events (client_event_id)
  where client_event_id is not null;

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

  select case when cardinality(up.department) > 0 then up.department[1] end
    into v_dept
    from acc.user_profile up
   where up.email = v_email;

  insert into public.erp_usage_events
    (module_id, feature_key, action, user_email, department, project, duration_ms, occurred_at, meta,
     client_event_id)
  select m.module_id,
         left(coalesce(nullif(e.j ->> 'feature_key', ''), m.module_id), 128),
         -- Anything outside the vocabulary degrades to 'view' instead of
         -- failing the batch on the table's CHECK constraint.
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
         -- The client's once-only id for this event. Absent from an older build's payload, which is
         -- why the index above is partial rather than a not-null column: those events keep working
         -- exactly as they did, they just do not get the protection.
         nullif(left(e.j ->> 'eid', 64), '')
    from (select t.j from jsonb_array_elements(p_events) as t(j) limit 60) e
    join public.erp_modules m on m.module_id = e.j ->> 'module_id'
      on conflict do nothing;

  get diagnostics v_n = row_count;
  return v_n;
exception
  when others then
    -- Telemetry must never surface as an error in the user's face, but it must
    -- not vanish either.
    raise warning 'erp_log_usage dropped a batch: % (%)', sqlerrm, sqlstate;
    return 0;
end
$function$;

/* Cleaning up the ones already in - but only the ones that are provably duplicates, which is half
   of what a naive "same person, same feature, same instant" rule would have swept up.

   The tell is the timestamp's own precision. occurred_at normally comes from the browser, which
   sends whole milliseconds. But erp_log_usage clamps it with least(client, now()), so when a
   person's computer clock runs AHEAD of the server every event of theirs is stamped now() instead -
   at microsecond precision, and identically for every event in the same batch. Two genuinely
   different clicks eight seconds apart then land on the same instant and look exactly like a
   double-send. Five people have a fast clock, and 14 of the 28 suspect rows are theirs.

   So: a microsecond-precision timestamp means the server stamped it, which means the collision is
   explained by the clock and the rows are left alone. Only whole-millisecond rows - the browser's
   own time, where one person hitting the same millisecond twice is not something a human does -
   with byte-identical detail are removed. That is 13 rows across 10 clicks, on previewing a Legal
   document and filtering Legal cases by hearing date.

   The 14 left behind are not being ignored: the id above means no new ones can appear, and they
   cannot be told apart from real work after the fact. Better a handful of possibly-doubled rows
   than deleting somebody's actual activity to tidy a number. */
create table if not exists public.erp_usage_events_removed_20260912
  (like public.erp_usage_events including defaults);

with live as (
  select id,
         row_number() over (
           partition by feature_key, lower(user_email), occurred_at, coalesce(meta::text,'~')
           order by id) as rn
    from public.erp_usage_events
   where user_email is not null
     and not coalesce((meta ->> 'backfill')::boolean, false)
     -- whole milliseconds = the browser's own clock, not the server's fallback
     and (extract(microseconds from occurred_at)::bigint % 1000) = 0
)
insert into public.erp_usage_events_removed_20260912
select ev.* from public.erp_usage_events ev
 where ev.id in (select id from live where rn > 1)
   and not exists (select 1 from public.erp_usage_events_removed_20260912 r where r.id = ev.id);

delete from public.erp_usage_events ev
 where exists (select 1 from public.erp_usage_events_removed_20260912 r where r.id = ev.id);
