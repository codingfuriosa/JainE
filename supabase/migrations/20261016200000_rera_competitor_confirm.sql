-- RERA on Competitor Data: confirm or reject a company name for a competitor (16 Oct 2026).
--
-- The RERA tab matches each competitor to the companies whose RERA promoter name contains the
-- competitor's name (Srijan, Merlin, DTC, ...) and shows those projects at once, each marked
-- "matched by company name - to confirm". A person then decides per company name:
--   Confirm    -> camp.pi_targets row (source 'rera', kind 'promoter', value = the exact name RERA
--                 prints, watchlist_id = the competitor, active = true). The collector re-reads a
--                 confirmed company's project pages weekly, and the tab marks its projects confirmed.
--   Not theirs -> the same row with active = false: that name is hidden for that competitor.
-- grp holds 'wl:<watchlist id>' so one company name can carry its own decision per competitor
-- (pi_targets is unique on source, kind, value, grp). Staff only, like the rest of the tab.
create or replace function camp.pi_rera_decide(p_promoter text, p_watchlist_id bigint, p_theirs boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not camp.pi_allowed() then raise exception 'not allowed'; end if;
  if coalesce(trim(p_promoter), '') = '' then raise exception 'company name missing'; end if;
  if not exists (select 1 from camp.competitor_watchlist w where w.id = p_watchlist_id) then raise exception 'no such competitor'; end if;
  -- The name must be one RERA actually prints, exactly.
  if not exists (select 1 from camp.pi_rera_projects p where p.promoter_name = p_promoter) then raise exception 'RERA shows no company by that exact name'; end if;
  insert into camp.pi_targets (source, kind, value, label, watchlist_id, grp, sort, active)
  values ('rera', 'promoter', p_promoter, p_promoter, p_watchlist_id, 'wl:' || p_watchlist_id, 100, p_theirs)
  on conflict (source, kind, value, grp) do update set active = excluded.active, watchlist_id = excluded.watchlist_id;
end $$;
revoke all on function camp.pi_rera_decide(text, bigint, boolean) from public, anon;
grant execute on function camp.pi_rera_decide(text, bigint, boolean) to authenticated;
