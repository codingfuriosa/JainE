-- NEW RECORDINGS MUST NEVER WAIT ON OLD BACKLOG, BY REQUIREMENT (2026-09-22).
--
-- next_claimable_follow_up (20260919130000) picks the lowest queue_seq, with one override: a lead that
-- already has a completed/failed recording wins the claim for its own next recording over a plain
-- lowest-queue_seq pick. That override has no snapshot_date awareness, so a lead stuck retrying an old
-- day's recording (e.g. a QA call failing on a billing/rate-limit error) keeps winning the claim every
-- tick, and every lead from every later day sits behind it untouched - observed 2026-09-22, where a
-- single 2026-09-18 lead retrying a 429'ing QA call blocked all of 2026-09-21's recordings from even
-- starting transcription.
--
-- The fix: sort by snapshot_date DESC first, above the lead-in-progress rule. The newest day's
-- claimable work is always picked before anything older, so a stuck old lead can never again block a
-- new day's recordings. Nothing is dropped or skipped - old backlog still drains, just only once
-- nothing newer is waiting, which is the explicit requirement (new recordings matter, old backlog does
-- not need to be timely). The lead-affinity and FIFO-within-a-day behaviour are unchanged.
create or replace function public.next_claimable_follow_up(p_claimable text[])
returns table(id bigint, status text)
language sql stable security definer set search_path = acc, public as $$
  select q.id, q.status
  from acc.transcription_queue q
  where q.status = any(p_claimable)
  order by
    q.snapshot_date desc,
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
