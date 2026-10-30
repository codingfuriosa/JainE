-- Invoice Processing: newest bills first.
--
-- WHY: with no column clicked, acc.wf_case_page fell back to "case_no, id" ascending, so the list
-- opened on the OLDEST bill and the one just raised was on the last page. For Invoice Processing
-- (flow 26) the fallback is now case_no / id DESCENDING - the latest bill is at the top of page 1.
-- A clicked JainE id / Bill / created heading still sorts exactly as before; only the default (and
-- the tie-break under it) changes. Other workflows keep their order. The Tracker re-sorts its own
-- copy in the browser, so it is unaffected.
--
-- Body identical to the live function apart from the two "p_flow_id = 26" lines in the ORDER BY.

create or replace function acc.wf_case_page(p_flow_id bigint, p_offset integer default 0, p_limit integer default 25,
  p_search text default null::text, p_from date default null::date, p_to date default null::date,
  p_status text default null::text, p_order text default null::text, p_dir text default 'asc'::text,
  p_counts boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'acc', 'public'
as $function$
declare
  v_me     text    := lower(coalesce(app.current_user_email(), ''));
  v_q      text    := lower(nullif(btrim(coalesce(p_search, '')), ''));
  v_emails text[]  := '{}';
  v_desc   boolean := lower(coalesce(p_dir, 'asc')) = 'desc';
  v_list   text[];
  v_vis    bigint[];
  v_ids    bigint[];
  v_page   bigint[];
  v_wait   integer;
  v_recv   integer;
begin
  if v_me = '' then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select coalesce(f.list_fields, '{}') into v_list from acc.flows f where f.id = p_flow_id;

  if v_q is not null then
    select coalesce(array_agg(lower(p.email)), '{}') into v_emails
      from acc.people() p
     where strpos(lower(coalesce(p.full_name, '')), v_q) > 0;
  end if;

  select coalesce(array_agg(c.id), '{}') into v_vis
    from acc.flow_cases c
   where c.flow_id = p_flow_id
     and acc.wf_can_see_case(c.id);

  with f as (
    select c.id, c.case_no, c.created_at,
           coalesce(case when c.flow_id = 26 then c.jaine_id end, c.case_no) as no,
           (select lower(string_agg(d->>'value', ', ' order by array_position(v_list, d->>'label')))
              from jsonb_array_elements(case when jsonb_typeof(c.trigger_details) = 'array'
                                             then c.trigger_details else '[]'::jsonb end) d
             where p_order = 'bill' and d->>'label' = any(v_list)) as bill
      from acc.flow_cases c
     where c.id = any(v_vis)
       and (p_status is null
            or (p_status = 'done'   and c.status =  'Done')
            or (p_status = 'active' and c.status <> 'Done'))
       and (p_from is null or (c.created_at at time zone 'UTC')::date >= p_from)
       and (p_to   is null or (c.created_at at time zone 'UTC')::date <= p_to)
       and (v_q is null
            or strpos(coalesce(case when c.flow_id = 26 then c.jaine_id end, c.case_no)::text, v_q) > 0
            or exists (
                 select 1
                   from jsonb_array_elements(case when jsonb_typeof(c.trigger_details) = 'array'
                                                  then c.trigger_details else '[]'::jsonb end) d
                  where coalesce(d->>'value', '') not like 's3:%'
                    and (strpos(lower(d->>'value'), v_q) > 0
                         or (v_q ~ '^[0-9.]+$'
                             and strpos(regexp_replace(coalesce(d->>'value', ''), '[^0-9.]', '', 'g'), v_q) > 0)))
            or strpos(lower(coalesce(c.created_by, '')), v_q) > 0
            or lower(coalesce(c.created_by, '')) = any(v_emails)
            or exists (
                 select 1
                   from acc.flow_case_steps s
                  where s.case_id = c.id
                    and (strpos(lower(coalesce(s.person, '')), v_q) > 0
                         or lower(coalesce(s.person, '')) = any(v_emails)
                         or exists (select 1 from unnest(coalesce(s.candidates, '{}')) cand
                                     where strpos(lower(cand), v_q) > 0
                                        or lower(cand) = any(v_emails)))))
  )
  select coalesce(array_agg(f.id order by
           case when p_order = 'no'      and not v_desc then f.no         end asc,
           case when p_order = 'no'      and     v_desc then f.no         end desc,
           case when p_order = 'bill'    and not v_desc then f.bill       end asc  nulls last,
           case when p_order = 'bill'    and     v_desc then f.bill       end desc nulls last,
           case when p_order = 'created' and not v_desc then f.created_at end asc,
           case when p_order = 'created' and     v_desc then f.created_at end desc,
           -- Invoice Processing: latest bill first by default
           case when p_flow_id = 26 then f.case_no end desc,
           case when p_flow_id = 26 then f.id      end desc,
           f.case_no, f.id), '{}')
    into v_ids
    from f;

  v_page := case when p_limit is null or p_limit <= 0 then v_ids
                 else v_ids[greatest(coalesce(p_offset, 0), 0) + 1 : greatest(coalesce(p_offset, 0), 0) + p_limit] end;

  if p_counts then
    select count(*) filter (where s.received_at is not null and lower(coalesce(s.person, '')) = v_me),
           count(*) filter (where s.received_at is null and v_me in (
                              select lower(x) from unnest(case when coalesce(array_length(s.candidates, 1), 0) > 0
                                                               then s.candidates else array[s.person] end) x))
      into v_recv, v_wait
      from acc.flow_cases c
      join acc.flow_case_steps s on s.case_id = c.id and s.seq = c.current_step
     where c.id = any(v_vis) and c.status = 'Pending';
  end if;

  return jsonb_build_object(
    'total',    coalesce(array_length(v_vis, 1), 0),
    'filtered', coalesce(array_length(v_ids, 1), 0),
    'rows',     coalesce((select jsonb_agg(to_jsonb(c) order by array_position(v_page, c.id))
                            from acc.flow_cases c where c.id = any(v_page)), '[]'::jsonb),
    'steps',    coalesce((select jsonb_agg(to_jsonb(s) order by s.case_id, s.seq)
                            from acc.flow_case_steps s where s.case_id = any(v_page)), '[]'::jsonb),
    'my_wait',  v_wait,
    'my_recv',  v_recv
  );
end;
$function$;
