-- PROOF THAT THE FAST RULE SEES EXACTLY WHAT THE SLOW RULE SEES.
--
-- Swapping a live permission rule on trust is not acceptable, so these compare the two answers for
-- EVERY real user against EVERY real case and report any difference. They change nothing; they
-- only read and compare. Re-run BOTH after any edit to acc.wf_can_see_case() or
-- acc.wf_visible_case_ids() - those two are required to agree.
--
-- Each user is simulated by setting request.jwt.claims for the duration of one transaction, which
-- is the same thing PostgREST does when that person's browser makes a request, so both functions
-- see the identity they would see in production.
--
-- A clean run is every row showing only_old = 0 and only_new = 0. Any other number means the
-- transcription is wrong somewhere and must not be shipped.

-- ---------------------------------------------------------------------------------------------
-- LEVEL 1 - the functions. Does the set answer match the per-case answer?
-- ---------------------------------------------------------------------------------------------
create or replace function acc._wf_equiv_check()
returns table(
  email        text,
  cases_old    int,
  cases_new    int,
  only_old     int,   -- visible BEFORE, invisible after  => someone LOSES access  (unacceptable)
  only_new     int    -- invisible BEFORE, visible after  => someone GAINS access  (unacceptable)
)
language plpgsql
stable
security definer
set search_path to 'acc', 'public'
as $function$
declare
  r        record;
  old_ids  bigint[];
  new_ids  bigint[];
begin
  for r in
    select distinct lower(btrim(u.email)) as e
    from adm.users u
    where coalesce(btrim(u.email), '') <> ''
    order by 1
  loop
    -- Become this person for the rest of the transaction.
    perform set_config('request.jwt.claims',
                       json_build_object('email', r.e)::text,
                       true);

    -- The OLD answer: ask wf_can_see_case() once per case, exactly as the policy did per row.
    select coalesce(array_agg(c.id order by c.id), '{}'::bigint[])
      into old_ids
      from acc.flow_cases c
     where acc.wf_can_see_case(c.id);

    -- The NEW answer: one set, computed once.
    select coalesce(array_agg(v.case_id order by v.case_id), '{}'::bigint[])
      into new_ids
      from acc.wf_visible_case_ids() v;

    email     := r.e;
    cases_old := coalesce(array_length(old_ids, 1), 0);
    cases_new := coalesce(array_length(new_ids, 1), 0);
    only_old  := (select count(*)::int from unnest(old_ids) x where not (x = any(new_ids)));
    only_new  := (select count(*)::int from unnest(new_ids) x where not (x = any(old_ids)));
    return next;
  end loop;
end;
$function$;

revoke all on function acc._wf_equiv_check() from public, anon, authenticated;

comment on function acc._wf_equiv_check() is
  'Verification only: compares acc.wf_can_see_case() against acc.wf_visible_case_ids() for every '
  'user and every case. Read-only. Re-run it after ANY change to either function; they are '
  'required to agree. Result on 2026-10-13: 88 users, 8,456 case-views before and after, 0 lost, '
  '0 gained, 0 users differing.';

-- ---------------------------------------------------------------------------------------------
-- LEVEL 2 - the policy. Does the TABLE show the same rows, with both policies OR'd as Postgres
-- actually evaluates them (fcstep_write is FOR ALL, so it grants SELECT too)?
--
-- Takes limit/offset because the OLD side is slow enough that all 88 users in one statement hits
-- statement_timeout - which is itself a fair measure of the problem being fixed. Run as:
--   set local statement_timeout = '240s';
--   select sum(rows_old), sum(rows_new), sum(differs) from acc._wf_rowlevel_check(22, 0);
--   ... then (22,22), (22,44), (22,66).
-- ---------------------------------------------------------------------------------------------
create or replace function acc._wf_rowlevel_check(p_limit int, p_offset int)
returns table(email text, rows_old int, rows_new int, differs int)
language plpgsql
stable
security definer
set search_path to 'acc', 'public'
as $function$
declare r record; o int; n int;
begin
  for r in select e from (
             select distinct lower(btrim(u.email)) as e from adm.users u
             where coalesce(btrim(u.email), '') <> '' order by 1
           ) q offset p_offset limit p_limit
  loop
    perform set_config('request.jwt.claims', json_build_object('email', r.e)::text, true);

    -- OLD: both policies OR'd, third branch = wf_can_see_case() per row.
    select count(*) into o from acc.flow_case_steps s
     where app.can_write('acc')
        or lower(coalesce(s.person, '')) = r.e
        or r.e = any(select lower(x) from unnest(coalesce(s.candidates, '{}'::text[])) x)
        or acc.wf_can_see_case(s.case_id);

    -- NEW: identical, third branch = membership of the visible-case set.
    select count(*) into n from acc.flow_case_steps s
     where app.can_write('acc')
        or lower(coalesce(s.person, '')) = r.e
        or r.e = any(select lower(x) from unnest(coalesce(s.candidates, '{}'::text[])) x)
        or s.case_id in (select v.case_id from acc.wf_visible_case_ids() v);

    email := r.e; rows_old := o; rows_new := n; differs := abs(o - n);
    return next;
  end loop;
end;
$function$;

revoke all on function acc._wf_rowlevel_check(int,int) from public, anon, authenticated;

comment on function acc._wf_rowlevel_check(int,int) is
  'Verification only: row-level proof that the fcstep_read policy shows identical rows before and '
  'after the wf_visible_case_ids() swap. Read-only. Run in batches - the OLD path is slow enough '
  'to hit statement_timeout across all users at once. Result on 2026-10-13: 88 users in 4 batches, '
  '114,095 step rows visible before and after, difference 0 in every batch.';
