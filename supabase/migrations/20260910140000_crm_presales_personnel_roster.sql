-- THE PRE-SALES ROSTER STOPS BEING A HARDCODED ARRAY.
--
-- Who counts as pre-sales was an array literal inside acc.crm_presales_emails(), with the callers'
-- NAMES written beside their addresses as SQL comments. Two things were wrong with that:
--
--   1. Adding, removing or renaming a caller meant a migration. A team whose roster changes when
--      someone joins or leaves is reference DATA, not code.
--   2. The names were unreachable. A comment is invisible to a query, so the transcription page had
--      no source for "who is on this team" other than the calls it happened to have fetched - which
--      is why its Personnel filter could only ever offer the people with a call in the selected
--      date range. A caller who took the day off simply did not exist as far as the dropdown was
--      concerned, and there is no way to tell that apart from a caller with nothing to show.
--
-- So the roster becomes a table, seeded with exactly the nine addresses the array held (same nine,
-- same people - this migration changes where the list lives, not who is on it). sort_order is the
-- order the team is listed in, so a screen can show them in a deliberate order rather than
-- alphabetically by accident; the manager is first.
--
-- acc.crm_presales_emails() keeps its name, its signature and its meaning, and every caller of it -
-- acc.crm_personnel_team(), public.crm_build_queue(), acc.followup_timeline_v - is untouched. It
-- just reads the table now.
--
-- WHY BOTH FUNCTIONS DROP FROM IMMUTABLE TO STABLE. A function that reads a table cannot be
-- immutable: the planner is entitled to fold an immutable call to a constant at plan time, and a
-- plan cached before a caller was added would keep answering with the old roster. STABLE is the
-- honest label - one value for the duration of a statement - and it is all any caller here needs.
-- Nothing depends on the immutability: neither function appears in an index, a generated column or
-- a constraint (checked before writing this), only in query predicates and one view.
--
-- WHY NEITHER FUNCTION SETS search_path ANY MORE, AND WHY THAT IS THE WHOLE POINT.
-- crm_personnel_team() is called once per follow-up row - 12k rows on a full scan of
-- acc.crm_followups, and the transcription page and the nightly queue both do that. The literal
-- array it used to hold was free at that scale because an IMMUTABLE constant body is folded once
-- and reused; reading a table instead is not free, and the first cut of this migration made a
-- full scan 3x slower (491ms -> 1.55s) because every row was paying for its own nested query.
--
-- What actually costs the time is that the functions could not be INLINED into the calling query,
-- and PostgreSQL refuses to inline any SQL function carrying a SET clause or SECURITY DEFINER. With
-- both dropped, the planner folds the whole thing into the outer query, the roster subquery becomes
-- an uncorrelated InitPlan evaluated ONCE per statement, and a full scan measures 461ms - a shade
-- faster than the hardcoded array ever was.
--
-- Dropping SET search_path is safe here precisely BECAUSE neither function is SECURITY DEFINER any
-- more: they run with the caller's own privileges, so there is no privilege boundary for a shadowed
-- name to be smuggled across, and everything they reach for by name (acc.crm_text,
-- acc.crm_presales_personnel) is schema-qualified regardless. Anything calling in from a definer
-- context - public.crm_build_queue() - pins its own search_path and is the one holding the
-- privileges, which is where that pinning belongs.
--
-- The other half of not being SECURITY DEFINER is that RLS on the roster now applies to whoever is
-- asking. That is the intended reading: signed-in staff and the service role see the nine, and a
-- customer-portal session sees none - and a customer session reaches no CRM rows to classify in the
-- first place (acc.crm_followups' own policy already stops it), so there is nothing for it to get
-- wrong. crm_build_queue() is SECURITY DEFINER itself, so the nightly queue is unaffected.

create table if not exists acc.crm_presales_personnel (
  email       text primary key,
  full_name   text        not null,
  active      boolean     not null default true,
  sort_order  integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table acc.crm_presales_personnel is
  'The pre-sales calling team. The single source of truth for acc.crm_presales_emails(), which is '
  'what decides whether a CRM follow-up is a pre-sales call - and so whether it is transcribed and '
  'QA''d at all. Deactivate (active=false) rather than delete: the calls a leaver already made stay '
  'in the history, and their name is what makes that history readable.';
comment on column acc.crm_presales_personnel.active is
  'false = off the team. Their existing calls keep their transcripts and QA; nothing new is queued.';
comment on column acc.crm_presales_personnel.sort_order is
  'The order the team is listed in on screen. Manager first, then the callers.';

-- Read-only to the app, on the same terms as every other CRM table here: signed-in staff yes,
-- customer-portal sessions no. Writes are an admin job through the service role.
alter table acc.crm_presales_personnel enable row level security;
grant select on acc.crm_presales_personnel to authenticated;
grant select, insert, update on acc.crm_presales_personnel to service_role;

drop policy if exists crm_presales_personnel_read on acc.crm_presales_personnel;
create policy crm_presales_personnel_read on acc.crm_presales_personnel
  for select to authenticated
  using (not app.is_customer());

-- The nine the array held. on conflict so re-running this is a no-op rather than an error, and so
-- an address that was deactivated by hand is not silently reactivated by a replay: only the name
-- and the ordering are refreshed.
insert into acc.crm_presales_personnel (email, full_name, sort_order) values
  ('mgr.presales@thejaingroup.com',     'Dipanwita Chatterjee', 1),
  ('jaingroupcaller1@thejaingroup.com', 'Sreyoshee Mukherjee',  2),
  ('jaingroupcaller2@thejaingroup.com', 'Meghadeepa Mitra',     3),
  ('jaingroupcaller3@thejaingroup.com', 'Sanchali Dasgupta',    4),
  ('jaingroupcaller4@thejaingroup.com', 'Nabanita Seet',        5),
  ('jaingroupcaller6@thejaingroup.com', 'Susmita Sarkar',       6),
  ('jaingroupcaller7@thejaingroup.com', 'Jayeeta Deb',          7),
  ('jaingroupcaller8@thejaingroup.com', 'Piyasa Guha',          8),
  ('jaingroupcaller9@thejaingroup.com', 'Rani Das',             9)
on conflict (email) do update
  set full_name  = excluded.full_name,
      sort_order = excluded.sort_order,
      updated_at = now();

-- Same array out, read from the table. lower(btrim()) is kept here rather than trusted to the rows,
-- because crm_personnel_team() compares a lowercased, trimmed CRM value against this array and a
-- stray capital in a row would quietly drop that caller off the team.
create or replace function acc.crm_presales_emails()
 returns text[]
 language sql
 stable
as $function$
  select coalesce(
    (select array_agg(lower(btrim(p.email)) order by lower(btrim(p.email)))
       from acc.crm_presales_personnel p
      where p.active),
    '{}'::text[]);
$function$;

-- Unchanged body. Re-declared only to drop IMMUTABLE, which is no longer true of it now that what
-- it reads sits in a table, and to drop the SET clause that would otherwise keep it out of the
-- calling query's plan (see the note above).
create or replace function acc.crm_personnel_team(v text)
 returns text
 language sql
 stable
as $function$
  select case
    when acc.crm_text(v) is null then null
    when lower(btrim(v)) = any (acc.crm_presales_emails()) then 'Pre-Sales'
    else 'Sales' end;
$function$;
