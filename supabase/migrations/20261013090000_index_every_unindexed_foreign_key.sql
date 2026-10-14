-- EVERY LINK BETWEEN TWO TABLES NOW HAS AN INDEX.
--
-- A foreign key says "this row points at a row in that other table". Postgres indexes the side
-- being pointed AT automatically (it is the primary key), but never the side doing the pointing.
-- That missing half costs twice:
--   1. Reading - "show me every booking for this project" scans the whole bookings table.
--   2. Writing - deleting or re-keying a PARENT row forces a full scan of every child table that
--      references it, to prove nothing still points at it. This cost is paid even when the child
--      table is tiny, which is the reason to index the small ones too and not only the large.
--
-- 201 of 455 links had no index. The largest affected table holds 541 rows, so each index builds
-- in well under a millisecond and needs no CONCURRENTLY dance: on a table this size the exclusive
-- lock is shorter than the network round trip that delivered the statement.
--
-- HONEST NOTE ON WHAT THIS DID AND DID NOT BUY. Measured against a full day of real usage, this
-- was not where JAIN-E's slowness lived. Every affected table is small, so the read-side gain is
-- near zero today. It was done because it is correct, because the write-side cost above is real, and
-- because these tables will grow - not because it made anything measurably faster this week. The
-- dominant cost on the same day's evidence was acc.flow_case_steps at ~1,500ms a call, which is a
-- row-level-security problem (wf_can_see_case called once per row), not an indexing one.
--
-- Written as a loop over the catalog rather than 201 hand-typed statements so that it states the
-- RULE ("no foreign key goes unindexed") instead of a snapshot of one day's gaps. Re-running it is
-- harmless and picks up any link added since.
--
-- Index names are <table>_<columns>_fk_idx truncated to 58 characters. Index names are scoped to
-- the schema owning the table, so hr.referrals and cust.referrals cannot collide.
do $$
declare
  r       record;
  idxname text;
  made    int := 0;
begin
  for r in
    with fk as (
      select c.oid, c.conrelid, c.conkey,
             n.nspname  as sch,
             cl.relname as tbl,
             (select string_agg(quote_ident(a.attname), ', ' order by x.ord)
                from unnest(c.conkey) with ordinality x(attnum, ord)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = x.attnum) as collist,
             (select string_agg(a.attname, '_' order by x.ord)
                from unnest(c.conkey) with ordinality x(attnum, ord)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = x.attnum) as colslug
      from pg_constraint c
      join pg_class cl    on cl.oid = c.conrelid
      join pg_namespace n on n.oid  = cl.relnamespace
      where c.contype = 'f'
        and cl.relkind = 'r'
        and n.nspname not in ('pg_catalog','information_schema','auth','storage','realtime',
                              'vault','net','cron','graphql','pgsodium','extensions',
                              'supabase_migrations')
    )
    select fk.sch, fk.tbl, fk.collist, fk.colslug
    from fk
    where not exists (
      -- "covered" means an existing index whose LEADING columns are exactly the key's columns.
      -- An index on (b, a) does not serve a key on (a); only a leading-prefix match counts.
      select 1 from pg_index i
      where i.indrelid = fk.conrelid
        and (i.indkey::int2[])[0:array_length(fk.conkey,1)-1] = fk.conkey::int2[]
    )
  loop
    idxname := left(r.tbl || '_' || r.colslug || '_fk_idx', 58);
    execute format('create index if not exists %I on %I.%I (%s)',
                   idxname, r.sch, r.tbl, r.collist);
    made := made + 1;
  end loop;
  raise notice 'indexed % foreign keys', made;
end $$;

-- THE PLANNER HAD NO STATISTICS FOR 465 OF 500 TABLES.
--
-- Without statistics Postgres does not know how many rows a table holds or how values are spread,
-- so it guesses - and a guess that is wrong in the wrong direction produces a full scan where an
-- index would have served. Autovacuum had never reached most of these tables because they are
-- small and rarely written, which is exactly the case where the default thresholds never trigger.
--
-- ANALYZE is read-only with respect to the data: it samples rows and updates the planner's notes.
-- It takes no lock that blocks readers or writers.
analyze;
