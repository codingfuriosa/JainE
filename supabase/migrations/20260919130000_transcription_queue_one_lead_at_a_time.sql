-- ONE LEAD FULLY FINISHED BEFORE THE NEXT ONE STARTS, BY REQUIREMENT (2026-09-19).
--
-- crm_build_queue (20260919090000) already groups a lead's own recordings together in queue_seq order,
-- so the worker mostly stays on one lead at a time already - but that is an emergent property of
-- insertion order, not an enforced rule. Two things can break it: a failed recording gets requeued to
-- the BACK of the whole queue (a fresh, much larger queue_seq), and a new day's snapshot can land while
-- yesterday's backlog is still draining, appending a different lead's rows after today's. Either one
-- can, in principle, let the worker pick up a different lead before the current one's own remaining
-- recordings are done.
--
-- This makes the rule explicit and enforced: if any lead already has a finished recording (completed
-- or failed-and-exhausted) AND still has a claimable one, the worker's very next claim comes from THAT
-- lead - never a different one - regardless of what queue_seq says. Only when no lead is "in progress"
-- by that definition does it fall back to the plain lowest-queue_seq pick, which is what starts a new
-- lead. This changes nothing about WHAT gets transcribed or HOW MANY API calls happen - only the ORDER
-- claims are handed out in - so it does not touch eligibility, dedup, or cost.
create index if not exists transcription_queue_lead_status
  on acc.transcription_queue (lead_id, status);

create or replace function public.next_claimable_follow_up(p_claimable text[])
returns table(id bigint, status text)
language sql stable security definer set search_path = acc, public as $$
  select q.id, q.status
  from acc.transcription_queue q
  where q.status = any(p_claimable)
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
