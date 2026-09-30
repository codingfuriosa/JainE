-- AUTOMATIC PROCESSING IS SCOPED TO TODAY'S DECISION-DAY LEADS ONLY, BY REQUIREMENT (2026-09-22).
--
-- next_claimable_follow_up (20260919130000, reordered by 20260922090000) still let the worker fall
-- through to older backlog once the newest day's rows ran out - "old backlog is never dropped, it just
-- drains once nothing newer is waiting". That was the explicit choice at the time, but the requirement
-- has since been sharpened: the worker must NEVER pick up a "waiting"/"pending"/"failed" recording
-- automatically unless it belongs to a lead that is part of the CURRENT decision-day CRM response - not
-- "eventually, when idle". A lead not in today's response (e.g. Lead B, last touched days ago) must sit
-- untouched no matter how idle the worker is; only a human clicking Retry may revive it.
--
-- "Part of the current decision-day CRM response" = crm_build_queue only ever inserts rows for a lead
-- that qualified on the day it ran (a Pre-Sales call that day), tagging every row it inserts - the
-- day's own call AND any of that lead's previously-unqueued history - with THAT day's snapshot_date.
-- So "leads in today's response" is exactly "distinct lead_id among rows whose snapshot_date is the
-- latest one present in the queue" - no separate lookup against the CRM snapshot tables is needed; the
-- queue table already carries this by construction.
--
-- Manually retried rows are exempt by construction, not by a special case here: the retry handler
-- (crm-snapshot-qa/index.ts, action "retry") now stamps a retried row's snapshot_date forward to the
-- same latest date before flipping it claimable, so a human retrying an out-of-scope lead's call always
-- works - it enters today's scope instead of trying to bypass this filter.
create or replace function public.next_claimable_follow_up(p_claimable text[])
returns table(id bigint, status text)
language sql stable security definer set search_path = acc, public as $$
  with latest as (
    select max(snapshot_date) as d from acc.transcription_queue
  ),
  in_scope_leads as (
    select distinct q.lead_id
    from acc.transcription_queue q, latest l
    where q.snapshot_date = l.d
  )
  select q.id, q.status
  from acc.transcription_queue q
  where q.status = any(p_claimable)
    and q.lead_id in (select lead_id from in_scope_leads)
  order by
    exists (
      select 1 from acc.transcription_queue d
      where d.lead_id = q.lead_id and d.status in ('completed', 'failed')
    ) desc,
    q.queue_seq asc,
    q.id asc
  limit 1;
$$;

revoke all on function public.next_claimable_follow_up(text[]) from public, anon, authenticated;
grant execute on function public.next_claimable_follow_up(text[]) to service_role;
