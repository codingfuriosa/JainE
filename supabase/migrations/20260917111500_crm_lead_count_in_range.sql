-- Companion to 20260917110000: the KPI cards' "N leads" figure needs COUNT(DISTINCT lead_id), which
-- daily_qa_summary deliberately does not store (see that migration's header - it does not sum
-- correctly across days). PostgREST has no distinct-count of its own, and fetching every lead_id row
-- in the range just to dedupe it in the browser would reintroduce the exact cost this whole pass exists
-- to remove for a wide range. One indexed aggregate, one number back.
create or replace function acc.crm_lead_count_in_range(p_from date, p_to date)
returns bigint
language sql stable security invoker set search_path = acc, public as $$
  select count(distinct lead_id)
  from acc.crm_followups
  where (p_from is null or call_date >= p_from)
    and (p_to is null or call_date <= p_to)
$$;

grant execute on function acc.crm_lead_count_in_range(date, date) to authenticated, service_role;
