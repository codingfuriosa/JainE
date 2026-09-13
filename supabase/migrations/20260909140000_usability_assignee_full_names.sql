-- Usability drill-down: show the person's real name in "Assigned to".
--
-- The earlier enrichment took names from adm.users.full_name, but only 10 of the
-- 85 rows there have a name filled in, so 75 people fell back to the email prefix
-- ("legal1", "businessanalyst"). The name actually used everywhere else in the app
-- comes from acc.user_profile (via acc.people()), which has a name for 74 of those
-- 75. This rewrites the stored meta.assignee values through that same source, so
-- history reads the way the live page does.
--
-- Additive and idempotent: only the 'assignee' key is touched, each comma-separated
-- element is mapped independently, and anything already holding a real name (or an
-- account with no profile name) is left exactly as it is.
with pm as (
  select split_part(lower(email), '@', 1) as lp,
         nullif(trim(full_name), '')      as fn
  from acc.user_profile
  where nullif(trim(full_name), '') is not null
),
src as (
  select ev.id,
         ev.meta->>'assignee' as oldv,
         string_agg(coalesce(pm.fn, trim(x.el)), ', ' order by x.ord) as newv
  from public.erp_usage_events ev
  cross join lateral unnest(string_to_array(ev.meta->>'assignee', ',')) with ordinality as x(el, ord)
  left join pm on pm.lp = lower(trim(x.el))
  where ev.meta ? 'assignee'
  group by ev.id, ev.meta
)
update public.erp_usage_events ev
set meta = ev.meta || jsonb_build_object('assignee', src.newv)
from src
where src.id = ev.id
  and src.newv <> src.oldv;
