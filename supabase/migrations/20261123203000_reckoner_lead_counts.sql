-- Reckoner: projects are listed in order of qualified leads (last 90 days) - Ayush 23 Nov 2026.
-- Sales staff cannot read camp.*, so this hands them only the per-project totals.
create or replace function rk.lead_counts() returns table (bu_id integer, q90 bigint)
language sql stable security definer set search_path = '' as $$
  select d.bu_id, sum(d.self_q)::bigint from camp.crm_source_daily d
   where rk.can_view() and d.day >= (now() at time zone 'Asia/Kolkata')::date - 90
   group by d.bu_id $$;
revoke all on function rk.lead_counts() from public, anon;
grant execute on function rk.lead_counts() to authenticated;
notify pgrst, 'reload schema';
