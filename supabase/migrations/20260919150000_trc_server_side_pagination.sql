-- TRUE SERVER-SIDE PAGINATION FOR THE TRANSCRIPTION PAGE (2026-09-19).
--
-- Today the page fetches every follow-up in the selected date range, then groups into leads, filters,
-- and slices 50 at a time - all in the browser. Query-per-request stays bounded (chunked .range() calls
-- against indexed columns), but total bytes downloaded and held in memory grows with the WIDTH of the
-- range, not with what's actually shown. These three functions let the frontend ask for exactly one
-- page's worth of leads (or calls, for the Mismatch tab) under the CURRENT filters, so a wide range
-- costs the same to open as a narrow one.
--
-- SECURITY INVOKER, not DEFINER: acc.followup_timeline_v already carries security_invoker = true and
-- excludes customer-portal accounts the same way a direct query against it does today - these functions
-- must not go around that by running as a definer with broader rights than the caller already has.
--
-- Every predicate here is a direct SQL translation of trcApply / trcTrStatus / trcIsSkippedSalesCall in
-- nexus-core.js - see that file's own comments for why each rule exists. Nothing here changes what the
-- page shows, only where the filtering and pagination happen.

create or replace function acc.trc_leads_page(
  p_from date, p_to date,
  p_proc text default 'all', p_match text default 'all', p_mismatch text default 'all',
  p_crm text default 'all', p_bu text default 'all', p_personnel text default 'all', p_q text default '',
  p_limit int default 50, p_offset int default 0
) returns table(lead_id bigint, total_count bigint)
language sql stable security invoker set search_path = acc, public as $$
  with candidates as (
    select f.lead_id, f.communication_time, f.follow_up_id
    from acc.followup_timeline_v f
    where f.call_date between p_from and p_to
      and (p_crm = 'all' or f.crm_status = p_crm)
      and (p_bu = 'all' or f.business_unit_name = p_bu)
      and (p_personnel = 'all' or lower(f.personnel_email) = lower(p_personnel))
      and (p_proc = 'all' or
           (case when f.transcription_status = 'not_transcribed' and f.queue_status is null
                 then 'out_of_scope' else f.transcription_status end) = p_proc)
      and (p_match = 'all'
           or (p_match = 'MATCH' and f.status_match = true and f.is_latest_assessed = true)
           or (p_match = 'MISMATCH' and f.status_match = false and f.is_latest_assessed = true)
           or (p_match = 'NONE' and f.status_match is null))
      and (p_mismatch = 'all'
           or (f.status_match = false and f.is_latest_assessed = true and f.mismatch_type = p_mismatch))
      and (p_q = ''
           or f.lead_id::text ilike '%'||p_q||'%' or f.lead_name ilike '%'||p_q||'%'
           or f.follow_up_id::text ilike '%'||p_q||'%'
           or f.personnel_name ilike '%'||p_q||'%' or f.personnel_email ilike '%'||p_q||'%')
      -- trcIsSkippedSalesCall: a Sales call that never finished transcribing carries no verdict of its
      -- own, so it cannot be the row that makes its lead appear (trcLeads drops it before grouping).
      and not (f.personnel_team = 'Sales' and coalesce(f.transcription_status, '') <> 'completed')
  ),
  by_lead as (
    select c.lead_id, max(c.communication_time) as last_call
    from candidates c
    group by c.lead_id
  )
  select bl.lead_id, count(*) over() as total_count
  from by_lead bl
  order by bl.last_call desc nulls last, bl.lead_id desc
  limit p_limit offset p_offset;
$$;

create or replace function acc.trc_calls_page(
  p_from date, p_to date,
  p_proc text default 'all', p_match text default 'all', p_mismatch text default 'all',
  p_crm text default 'all', p_bu text default 'all', p_personnel text default 'all', p_q text default '',
  p_limit int default 50, p_offset int default 0
) returns table(follow_up_id bigint, total_count bigint)
language sql stable security invoker set search_path = acc, public as $$
  select f.follow_up_id, count(*) over() as total_count
  from acc.followup_timeline_v f
  where f.call_date between p_from and p_to
    and (p_crm = 'all' or f.crm_status = p_crm)
    and (p_bu = 'all' or f.business_unit_name = p_bu)
    and (p_personnel = 'all' or lower(f.personnel_email) = lower(p_personnel))
    and (p_proc = 'all' or
         (case when f.transcription_status = 'not_transcribed' and f.queue_status is null
               then 'out_of_scope' else f.transcription_status end) = p_proc)
    and (p_match = 'all'
         or (p_match = 'MATCH' and f.status_match = true and f.is_latest_assessed = true)
         or (p_match = 'MISMATCH' and f.status_match = false and f.is_latest_assessed = true)
         or (p_match = 'NONE' and f.status_match is null))
    and (p_mismatch = 'all'
         or (f.status_match = false and f.is_latest_assessed = true and f.mismatch_type = p_mismatch))
    and (p_q = ''
         or f.lead_id::text ilike '%'||p_q||'%' or f.lead_name ilike '%'||p_q||'%'
         or f.follow_up_id::text ilike '%'||p_q||'%'
         or f.personnel_name ilike '%'||p_q||'%' or f.personnel_email ilike '%'||p_q||'%')
  order by f.communication_time desc nulls last, f.follow_up_id desc
  limit p_limit offset p_offset;
$$;

-- Replaces the "count from every fetched row" fallback trcKpiHtml uses whenever a personnel/business
-- unit/CRM-status/search filter is active (acc.daily_qa_summary has no breakdown by those dimensions).
-- Deliberately excludes proc/match/mismatch (mirrors trcApply's skipCards=true) - the four KPI cards and
-- five status chips must stay put while one of them is the active filter.
create or replace function acc.trc_scope_counts(
  p_from date, p_to date,
  p_crm text default 'all', p_bu text default 'all', p_personnel text default 'all', p_q text default ''
) returns jsonb
language sql stable security invoker set search_path = acc, public as $$
  select jsonb_build_object(
    'total_followups', count(*),
    'recordings_available', count(*) filter (where f.has_recording),
    'transcribed', count(*) filter (where f.transcription_status = 'completed'),
    'non_transcribable', count(*) filter (where f.transcription_status = 'non_transcribable'),
    'transcription_failed', count(*) filter (where f.transcription_status = 'failed'),
    'pending', count(*) filter (where f.transcription_status = 'not_transcribed' and f.queue_status is not null),
    'not_in_scope', count(*) filter (where f.transcription_status = 'not_transcribed' and f.queue_status is null),
    'qa_assessed', count(*) filter (where f.qa_id is not null),
    'reused_transcription', count(*) filter (where f.reused_transcription),
    'status_match', count(*) filter (where f.status_match = true and f.is_latest_assessed),
    'status_mismatch', count(*) filter (where f.status_match = false and f.is_latest_assessed),
    'total_leads', count(distinct f.lead_id),
    'transcribed_leads', count(distinct f.lead_id) filter (where f.transcription_status = 'completed'),
    'status_match_leads', count(distinct f.lead_id) filter (where f.status_match = true and f.is_latest_assessed),
    'status_mismatch_leads', count(distinct f.lead_id) filter (where f.status_match = false and f.is_latest_assessed),
    'lost_should_not_have_been_lost',
      count(*) filter (where f.mismatch_type = 'lost_should_not_have_been_lost' and f.is_latest_assessed),
    'qualified_should_not_have_been_qualified',
      count(*) filter (where f.mismatch_type = 'qualified_should_not_have_been_qualified' and f.is_latest_assessed),
    'in_followup_should_have_been_lost',
      count(*) filter (where f.mismatch_type = 'in_followup_should_have_been_lost' and f.is_latest_assessed),
    'in_followup_should_have_been_qualified',
      count(*) filter (where f.mismatch_type = 'in_followup_should_have_been_qualified' and f.is_latest_assessed),
    'lost_should_not_have_been_lost_leads',
      count(distinct f.lead_id) filter (where f.mismatch_type = 'lost_should_not_have_been_lost' and f.is_latest_assessed),
    'qualified_should_not_have_been_qualified_leads',
      count(distinct f.lead_id) filter (where f.mismatch_type = 'qualified_should_not_have_been_qualified' and f.is_latest_assessed),
    'in_followup_should_have_been_lost_leads',
      count(distinct f.lead_id) filter (where f.mismatch_type = 'in_followup_should_have_been_lost' and f.is_latest_assessed),
    'in_followup_should_have_been_qualified_leads',
      count(distinct f.lead_id) filter (where f.mismatch_type = 'in_followup_should_have_been_qualified' and f.is_latest_assessed)
  )
  from acc.followup_timeline_v f
  where f.call_date between p_from and p_to
    and (p_crm = 'all' or f.crm_status = p_crm)
    and (p_bu = 'all' or f.business_unit_name = p_bu)
    and (p_personnel = 'all' or lower(f.personnel_email) = lower(p_personnel))
    and (p_q = ''
         or f.lead_id::text ilike '%'||p_q||'%' or f.lead_name ilike '%'||p_q||'%'
         or f.follow_up_id::text ilike '%'||p_q||'%'
         or f.personnel_name ilike '%'||p_q||'%' or f.personnel_email ilike '%'||p_q||'%');
$$;

-- The CRM-status and business-unit filter dropdowns used to be populated straight from TRC_ROWS, which
-- was the whole range - now that TRC_ROWS is only ever one page, that would only ever offer values seen
-- on the page currently on screen. This returns every distinct value actually present across the whole
-- range instead, so the dropdowns stay complete regardless of which page happens to be showing.
create or replace function acc.trc_distinct_filters(p_from date, p_to date)
returns jsonb
language sql stable security invoker set search_path = acc, public as $$
  select jsonb_build_object(
    'crm_statuses', coalesce((select array_agg(distinct f.crm_status order by f.crm_status)
                               from acc.followup_timeline_v f
                               where f.call_date between p_from and p_to and f.crm_status is not null), '{}'),
    'business_units', coalesce((select array_agg(distinct f.business_unit_name order by f.business_unit_name)
                                  from acc.followup_timeline_v f
                                  where f.call_date between p_from and p_to and f.business_unit_name is not null
                                    and f.business_unit_name not ilike 'durbaar banquet%'), '{}')
  );
$$;

grant execute on function acc.trc_leads_page(date,date,text,text,text,text,text,text,text,int,int) to authenticated;
grant execute on function acc.trc_calls_page(date,date,text,text,text,text,text,text,text,int,int) to authenticated;
grant execute on function acc.trc_scope_counts(date,date,text,text,text,text) to authenticated;
grant execute on function acc.trc_distinct_filters(date,date) to authenticated;

-- SAFETY MARGIN, not a performance fix: measured against a 50-day range on live data, these queries
-- took 1.7-3.4s (a plain GROUP BY over acc.crm_followups's own date index, no window functions) -
-- comfortably under the authenticator role's 8s cap, but with less margin than every other function in
-- this file that already overrides its own timeout. A 25s override here is purely defensive - if a much
-- wider range or a much larger table ever pushes one of these past what's reasonable, it fails cleanly
-- instead of silently inheriting whatever the calling role's own default happens to be.
alter function acc.trc_leads_page(date,date,text,text,text,text,text,text,text,int,int) set statement_timeout = '25s';
alter function acc.trc_calls_page(date,date,text,text,text,text,text,text,text,int,int) set statement_timeout = '25s';
alter function acc.trc_scope_counts(date,date,text,text,text,text) set statement_timeout = '25s';
alter function acc.trc_distinct_filters(date,date) set statement_timeout = '25s';
