-- Monthly Update's "Not live" tag used to read the approval tick. Since a position now goes live
-- on its job description (see 20261009090000_position_live_on_description), the view has to hand
-- back whether one exists - the screen cannot work it out from what it was being given.
--
-- The return type changes, so this is a drop and recreate rather than a replace. approval_status
-- and approved_by stay: the approve/reject workflow still exists and the panel still shows it.
--
-- The ordering follows the same move. "Still to approve" floated to the top because that was the
-- thing somebody had to act on; now it is "still to write up".

drop function if exists hr.monthly_view(date);

create function hr.monthly_view(p_month date)
returns table(row_id bigint, row_month date, position_title text, department text,
              vacancies text, raised_by text, manpower_id bigint, approval_status text,
              approved_by text, rejection_reason text, priority text, hiring_status text,
              closed_at timestamp with time zone, slug text, has_description boolean,
              counts jsonb, candidate_total bigint)
language sql
stable
security definer
set search_path to 'hr','public'
as $function$
  with cand as (
    select c.tracker_row_id, c.max_stage_seq, c.outcome from hr.candidates c
  )
  select
    r.id, r.month, r.position, m.department, m.no_of_vacancy, m.raised_by, m.id,
    m.approval_status, m.approved_by, m.rejection_reason, m.priority,
    m.status, m.closed_at, m.slug,
    (m.ai_job_description_json is not null),
    ( select jsonb_object_agg(s.label, x.n)
        from hr.tracker_stages s
        cross join lateral (
          select count(*) as n
            from cand c
           where c.tracker_row_id = r.id
             and case when s.counts_as is null then c.max_stage_seq >= s.seq
                      else c.outcome = s.counts_as end
        ) x
    ),
    ( select count(*) from cand c where c.tracker_row_id = r.id )
  from hr.tracker_rows r
  left join hr.manpower_requests m on m.id = r.manpower_request_id
  where r.month = date_trunc('month', p_month)::date
  -- still-to-write-up first, then still-hiring, then the closed ones settle to the bottom
  order by (m.id is not null and m.ai_job_description_json is null) desc,
           (m.status = 'Open') desc, r.position;
$function$;
