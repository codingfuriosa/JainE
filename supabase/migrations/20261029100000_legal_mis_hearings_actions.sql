-- LEGAL MIS, RESHAPED (29 Oct 2026, as asked by Ayush).
--
-- A case now has a HEARING history and an ACTION history of its own:
--   public.mis_hearings      one row per hearing date - date, stage, person, remarks. The newest
--                            date is the case's Hearing Date (mirrored into mis_cases.case_next_date,
--                            so the causelist and the Calendar keep reading it).
--   public.mis_case_actions  one row per action - action, action date, person, remarks - each with
--                            its own Accountability task (acc.ptasks, source 'legal_mis'). The task
--                            is the truth for the date and for done / not done: change the date or
--                            complete it in Accountability and the case follows.
-- Plus the two lists the form offers and remembers: mis_case_types, mis_courts.
--
-- LOCAL TESTING. JainE running on a developer's own machine (localhost) reads and writes *_test
-- copies of every MIS table, so nothing tried there touches real cases. The copies start as
-- today's data. Tasks raised from the test copy are assigned to the tester, titled [TEST], and
-- carry source 'legal_mis_test'.

-- ---------------------------------------------------------------- the case row
alter table public.mis_cases add column if not exists case_brief text;
alter table public.mis_cases add column if not exists location text;
alter table public.mis_cases add column if not exists sort_rank integer;
alter table public.mis_cases add column if not exists case_type_old text;

-- ---------------------------------------------------------------- the lists
create table if not exists public.mis_case_types (name text primary key, sort integer, created_at timestamptz not null default now());
create table if not exists public.mis_courts (name text primary key, created_at timestamptz not null default now());
alter table public.mis_case_types enable row level security;
alter table public.mis_courts enable row level security;
drop policy if exists mct_all on public.mis_case_types;
create policy mct_all on public.mis_case_types for all to authenticated using (true) with check (true);
drop policy if exists mcourt_all on public.mis_courts;
create policy mcourt_all on public.mis_courts for all to authenticated using (true) with check (true);

insert into public.mis_case_types (name, sort) values
  ('Civil',1),('Civil - Commercial Suit',2),('Criminal',3),('Criminal - Complaint Case',4),('Consumer',5),
  ('High Court',6),('High Court - Pending Matter',7),('High Court - Tax Jurisdiction',8),('High Court - Civil Matter',9),
  ('High Court - Criminal Matter',10),('High Court - Arbitration Matter',11),('High Court - Commercial Matter',12),
  ('High Court - IP Matter',13),('RERA Matter',14),('Arbitration Matter',15),('Independent Labour Commission',16)
on conflict (name) do nothing;

-- The courts already written on cases, tidied (line breaks and runs of spaces become one space, a
-- trailing comma goes) and counted once however they were capitalised or punctuated.
update public.mis_cases set court = nullif(regexp_replace(regexp_replace(btrim(court), '\s+', ' ', 'g'), '[,\s]+$', ''), '')
 where court is not null and court <> nullif(regexp_replace(regexp_replace(btrim(court), '\s+', ' ', 'g'), '[,\s]+$', ''), '');
insert into public.mis_courts (name)
select distinct on (lower(regexp_replace(court, '[^a-zA-Z0-9]', '', 'g'))) court
  from public.mis_cases where coalesce(btrim(court), '') <> ''
 order by lower(regexp_replace(court, '[^a-zA-Z0-9]', '', 'g')), court
on conflict (name) do nothing;

-- ---------------------------------------------------------------- old case types onto the new list
-- The old wording is kept in case_type_old. Only the obvious ones are mapped; anything unclear is
-- left blank for Legal to choose when the case is next opened. "Disposed off matter" was never a
-- type - it was the case being over - so those cases are marked disposed instead.
update public.mis_cases set case_type_old = case_type where case_type_old is null and case_type is not null;
update public.mis_cases set completed_at = coalesce(completed_at, updated_at::date, current_date)
 where lower(case_type_old) similar to 'dis%os%ed off matter';
update public.mis_cases c set case_type = m.new_type
  from (select id, case
          when t in ('consumer matter','consumer matter at consumer affairs department','consumer matter/revew application') then 'Consumer'
          when t = 'civil matter' then 'Civil'
          when t = 'criminal matter' then 'Criminal'
          when t = 'rera' then 'RERA Matter'
          when t in ('arbitration matter','arbitrtaion petition','arbitration petition','arbitration proceeding') then 'Arbitration Matter'
          when t = 'criminal revision, high court matter' then 'High Court - Criminal Matter'
          when t = 'civil revision, high court matter' then 'High Court - Civil Matter'
          when t in ('arbitration execution, high court matter','aribtration, sec 9, high court matter, original side','arbitration, sec 11, high court matter, original side') then 'High Court - Arbitration Matter'
          when t = 'high court at calcutta special jurisdiction income tax original side' then 'High Court - Tax Jurisdiction'
          when t = 'comip suit, mumbai high court matter' then 'High Court - IP Matter'
          when t = 'labour commission' then 'Independent Labour Commission'
          else null end new_type
          from (select id, lower(regexp_replace(btrim(case_type_old), '\s+', ' ', 'g')) t from public.mis_cases) s) m
 where m.id = c.id and c.case_type is distinct from m.new_type
   and (c.case_type is null or c.case_type not in (select name from public.mis_case_types));

-- A starting order for the hand-arranged part of the list (the 6-dot handle): the order they had.
update public.mis_cases set sort_rank = id where sort_rank is null;

-- ---------------------------------------------------------------- hearings and actions
create table if not exists public.mis_hearings (
  id bigserial primary key,
  case_id bigint not null references public.mis_cases(id) on delete cascade,
  hearing_date date not null,
  stage text, person text, remarks text,
  created_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists mis_hearings_case on public.mis_hearings (case_id, hearing_date desc);
create table if not exists public.mis_case_actions (
  id bigserial primary key,
  case_id bigint not null references public.mis_cases(id) on delete cascade,
  action text not null, action_date date not null, person text not null, remarks text,
  task_id bigint, created_by text, created_at timestamptz not null default now());
create index if not exists mis_case_actions_case on public.mis_case_actions (case_id, created_at desc);
create index if not exists mis_case_actions_task on public.mis_case_actions (task_id);
alter table public.mis_hearings enable row level security;
alter table public.mis_case_actions enable row level security;
drop policy if exists mh_all on public.mis_hearings;
create policy mh_all on public.mis_hearings for all to authenticated using (true) with check (true);
drop policy if exists mca_all on public.mis_case_actions;
create policy mca_all on public.mis_case_actions for all to authenticated using (true) with check (true);

-- Every case with a hearing date starts its history with it; the person is whoever created the case.
insert into public.mis_hearings (case_id, hearing_date, person, created_by)
select c.id, c.case_next_date_iso, c.created_by, c.created_by from public.mis_cases c
 where c.case_next_date_iso is not null and not exists (select 1 from public.mis_hearings h where h.case_id = c.id);

-- ---------------------------------------------------------------- the local test copies
create table if not exists public.mis_cases_test (like public.mis_cases including all);
create table if not exists public.mis_hearings_test (like public.mis_hearings including all);
create table if not exists public.mis_case_actions_test (like public.mis_case_actions including all);
create table if not exists public.mis_case_folders_test (like public.mis_case_folders including all);
create table if not exists public.mis_case_files_test (like public.mis_case_files including all);
create table if not exists public.mis_causelist_review_log_test (like public.mis_causelist_review_log including all);
insert into public.mis_cases_test overriding system value select * from public.mis_cases on conflict do nothing;
insert into public.mis_hearings_test overriding system value select * from public.mis_hearings on conflict do nothing;
insert into public.mis_case_folders_test overriding system value select * from public.mis_case_folders on conflict do nothing;
insert into public.mis_case_files_test overriding system value select * from public.mis_case_files on conflict do nothing;
-- A copied identity column starts counting at 1 again; move it past the rows just copied.
do $$ declare t text; m bigint; begin
  foreach t in array array['mis_cases_test','mis_hearings_test','mis_case_actions_test','mis_case_folders_test','mis_case_files_test','mis_causelist_review_log_test'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'id' and is_identity = 'YES') then
      execute format('select coalesce(max(id), 0) + 1 from public.%I', t) into m;
      execute format('alter table public.%I alter column id restart with %s', t, m);
    end if;
  end loop;
end $$;
alter table public.mis_hearings_test drop constraint if exists mis_hearings_test_case_fk;
alter table public.mis_hearings_test add constraint mis_hearings_test_case_fk foreign key (case_id) references public.mis_cases_test(id) on delete cascade;
alter table public.mis_case_actions_test drop constraint if exists mis_case_actions_test_case_fk;
alter table public.mis_case_actions_test add constraint mis_case_actions_test_case_fk foreign key (case_id) references public.mis_cases_test(id) on delete cascade;
do $$ declare t text; begin
  foreach t in array array['mis_cases_test','mis_hearings_test','mis_case_actions_test','mis_case_folders_test','mis_case_files_test','mis_causelist_review_log_test'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists test_all on public.%I', t);
    execute format('create policy test_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
drop trigger if exists trg_mis_cases_sync_next_date on public.mis_cases_test;
create trigger trg_mis_cases_sync_next_date before insert or update on public.mis_cases_test
  for each row execute function public.mis_cases_sync_next_date();

-- ---------------------------------------------------------------- keeping it all in step
-- The task's description: what the case is and where it stands, rewritten whenever a hearing is
-- added or changed. The hearing update is the newest hearing's stage and remarks; when that one has
-- none, the one before it; when neither has, the line is left out.
create or replace function public.legal_mis_refresh_desc(p_case bigint, p_test boolean)
returns void language plpgsql security definer set search_path to 'public', 'acc' as $$
declare s text := case when p_test then '_test' else '' end; v_title text; v_no text; v_near date; v_upd text; d text;
begin
  execute format('select cause_title, case_no from public.%I where id = $1', 'mis_cases'||s) into v_title, v_no using p_case;
  execute format('select coalesce((select min(hearing_date) from public.%1$I where case_id = $1 and hearing_date >= current_date),
                                  (select max(hearing_date) from public.%1$I where case_id = $1))', 'mis_hearings'||s) into v_near using p_case;
  execute format('select nullif(btrim(concat_ws('' - '', nullif(btrim(stage), ''''), nullif(btrim(remarks), ''''))), '''')
                    from (select stage, remarks from public.%I where case_id = $1 order by hearing_date desc, id desc limit 2) x
                   where nullif(btrim(concat(stage, remarks)), '''') is not null limit 1', 'mis_hearings'||s) into v_upd using p_case;
  d := '• Case Title: '||coalesce(nullif(btrim(regexp_replace(v_title, '\s+', ' ', 'g')), ''), '—')
    ||E'\n• Case No.: '||coalesce(nullif(btrim(v_no), ''), '—')
    ||E'\n• Nearest Hearing Date: '||coalesce(to_char(v_near, 'DD/MM/YYYY'), 'not set')
    ||coalesce(E'\n• Hearing Update: '||v_upd, '');
  execute format('update acc.ptasks t set description = $2 from public.%I a
                   where a.case_id = $1 and a.task_id = t.id and t.status <> ''Completed'' and t.description is distinct from $2',
                 'mis_case_actions'||s) using p_case, d;
end $$;

-- The newest hearing is the case's Hearing Date; the open action's date is its Action Date.
create or replace function public.legal_mis_mirror(p_case bigint, p_test boolean)
returns void language plpgsql security definer set search_path to 'public', 'acc' as $$
declare s text := case when p_test then '_test' else '' end; v_h date; v_a date; v_txt text; v_any boolean;
begin
  execute format('select max(hearing_date) from public.%I where case_id = $1', 'mis_hearings'||s) into v_h using p_case;
  execute format('update public.%I set case_next_date = $2 where id = $1 and case_next_date is distinct from $2', 'mis_cases'||s)
    using p_case, to_char(v_h, 'YYYY-MM-DD');
  -- A case that has never had an action of the new kind keeps its old Action Date as it was.
  execute format('select exists (select 1 from public.%I where case_id = $1)', 'mis_case_actions'||s) into v_any using p_case;
  if not v_any then return; end if;
  execute format('select a.action_date, a.action from public.%I a left join acc.ptasks t on t.id = a.task_id
                   where a.case_id = $1 and t.id is not null and t.completed_at is null
                   order by a.created_at desc limit 1', 'mis_case_actions'||s) into v_a, v_txt using p_case;
  execute format('update public.%I set next_date = $2, action_needed = $3 where id = $1', 'mis_cases'||s)
    using p_case, to_char(v_a, 'YYYY-MM-DD'), v_txt;
end $$;

create or replace function public.mis_hearings_after() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare t boolean := TG_TABLE_NAME like '%\_test' escape '\'; cid bigint := coalesce(new.case_id, old.case_id);
begin
  perform public.legal_mis_mirror(cid, t);
  perform public.legal_mis_refresh_desc(cid, t);
  return null;
end $$;
drop trigger if exists trg_mis_hearings_after on public.mis_hearings;
create trigger trg_mis_hearings_after after insert or update or delete on public.mis_hearings for each row execute function public.mis_hearings_after();
drop trigger if exists trg_mis_hearings_after on public.mis_hearings_test;
create trigger trg_mis_hearings_after after insert or update or delete on public.mis_hearings_test for each row execute function public.mis_hearings_after();

-- A case's title or number changing changes what its tasks say.
create or replace function public.mis_cases_desc_after() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.cause_title is distinct from old.cause_title or new.case_no is distinct from old.case_no then
    perform public.legal_mis_refresh_desc(new.id, TG_TABLE_NAME like '%\_test' escape '\');
  end if;
  return null;
end $$;
drop trigger if exists trg_mis_cases_desc_after on public.mis_cases;
create trigger trg_mis_cases_desc_after after update on public.mis_cases for each row execute function public.mis_cases_desc_after();
drop trigger if exists trg_mis_cases_desc_after on public.mis_cases_test;
create trigger trg_mis_cases_desc_after after update on public.mis_cases_test for each row execute function public.mis_cases_desc_after();

-- The task moves, the case follows: a new due date in Accountability is the action's new date; the
-- task completed, reverted or retitled is shown on the case as it is.
create or replace function acc.legal_mis_task_after() returns trigger language plpgsql security definer set search_path to 'public', 'acc' as $$
declare t boolean := new.source = 'legal_mis_test'; s text; cid bigint;
begin
  if new.source not in ('legal_mis', 'legal_mis_test') then return null; end if;
  s := case when t then '_test' else '' end;
  execute format('update public.%I set action_date = coalesce($2, action_date),
                    action = coalesce(nullif(btrim(regexp_replace($3, ''^\[TEST\]\s*'', '''')), ''''), action)
                   where task_id = $1 returning case_id', 'mis_case_actions'||s)
    into cid using new.id, new.due_date, new.title;
  if cid is not null then perform public.legal_mis_mirror(cid, t); end if;
  return null;
end $$;
drop trigger if exists trg_legal_mis_task_after on acc.ptasks;
create trigger trg_legal_mis_task_after after update of due_date, title, status, completed_at on acc.ptasks
  for each row when (new.source in ('legal_mis', 'legal_mis_test')) execute function acc.legal_mis_task_after();

-- ---------------------------------------------------------------- adding and changing an action
-- One action open at a time: a new one is only taken once the current one's task is completed.
create or replace function public.legal_mis_add_action(p_case bigint, p_action text, p_date date, p_person text, p_remarks text, p_test boolean default false)
returns bigint language plpgsql security definer set search_path to 'public', 'acc' as $$
declare me text := app.current_user_email(); s text := case when p_test then '_test' else '' end;
        v_open boolean; v_task bigint; v_id bigint; v_who text;
begin
  if me is null then raise exception 'Sign in again.'; end if;
  if nullif(btrim(p_action), '') is null or p_date is null or nullif(btrim(p_person), '') is null or nullif(btrim(p_remarks), '') is null then
    raise exception 'Action, Action Date, Action People and Action Remarks are all needed.';
  end if;
  if p_date < current_date then raise exception 'The Action Date cannot be in the past.'; end if;
  execute format('select exists (select 1 from public.%I a left join acc.ptasks t on t.id = a.task_id
                   where a.case_id = $1 and t.id is not null and t.completed_at is null)', 'mis_case_actions'||s) into v_open using p_case;
  if v_open then raise exception 'This case already has an action open. Complete its task first, then add the next one.'; end if;
  v_who := case when p_test then me else lower(btrim(p_person)) end;
  insert into acc.ptasks (title, description, due_date, delegator, created_by, source)
  values ((case when p_test then '[TEST] ' else '' end)||btrim(p_action), '', p_date, me, me, case when p_test then 'legal_mis_test' else 'legal_mis' end)
  returning id into v_task;
  insert into acc.ptask_assignees (task_id, email) values (v_task, v_who);
  insert into acc.ptask_comments (task_id, author, body, system) values (v_task, me, btrim(p_remarks), false);
  execute format('insert into public.%I (case_id, action, action_date, person, remarks, task_id, created_by)
                  values ($1, $2, $3, $4, $5, $6, $7) returning id', 'mis_case_actions'||s)
    into v_id using p_case, btrim(p_action), p_date, lower(btrim(p_person)), btrim(p_remarks), v_task, me;
  perform public.legal_mis_refresh_desc(p_case, p_test);
  perform public.legal_mis_mirror(p_case, p_test);
  return v_id;
end $$;

-- The open action's date, person or wording changed from the case page: the task changes with it.
create or replace function public.legal_mis_update_action(p_id bigint, p_action text, p_date date, p_person text, p_test boolean default false)
returns void language plpgsql security definer set search_path to 'public', 'acc' as $$
declare s text := case when p_test then '_test' else '' end; v_task bigint; v_case bigint; me text := app.current_user_email();
begin
  if nullif(btrim(p_action), '') is null or p_date is null or nullif(btrim(p_person), '') is null then
    raise exception 'Action, Action Date and Action People are all needed.';
  end if;
  execute format('update public.%I set action = $2, action_date = $3, person = $4 where id = $1 returning task_id, case_id', 'mis_case_actions'||s)
    into v_task, v_case using p_id, btrim(p_action), p_date, lower(btrim(p_person));
  if v_task is not null then
    update acc.ptasks set title = (case when p_test then '[TEST] ' else '' end)||btrim(p_action), due_date = p_date where id = v_task;
    if not p_test then
      delete from acc.ptask_assignees where task_id = v_task and email <> lower(btrim(p_person));
      insert into acc.ptask_assignees (task_id, email) select v_task, lower(btrim(p_person))
       where not exists (select 1 from acc.ptask_assignees where task_id = v_task and email = lower(btrim(p_person)));
    end if;
  end if;
  if v_case is not null then perform public.legal_mis_mirror(v_case, p_test); end if;
end $$;

-- A case deleted takes its open tasks with it; finished ones stay, they happened.
create or replace function public.legal_mis_delete_case(p_case bigint, p_test boolean default false)
returns void language plpgsql security definer set search_path to 'public', 'acc' as $$
declare s text := case when p_test then '_test' else '' end;
begin
  execute format('delete from acc.ptasks t using public.%I a where a.case_id = $1 and a.task_id = t.id and t.completed_at is null', 'mis_case_actions'||s) using p_case;
  execute format('delete from public.%I where id = $1', 'mis_cases'||s) using p_case;
end $$;

-- ---------------------------------------------------------------- the MIS score
-- Each action is scored when its task is completed, against its Action Date:
--   after the Action Date                       -1
--   on the day, or 1 day before                  0
--   2 or more days before                       +1
--   7 or more days before                       +2 - but only when the action was given at least
--                                                    7 days to begin with; otherwise +1 is the most.
-- An action not yet completed has no score.
create or replace function public.legal_mis_action_points(p_action_date date, p_created date, p_done date)
returns integer language sql immutable as $$
  select case when p_done is null or p_action_date is null then null
              when p_done > p_action_date then -1
              when p_action_date - p_done <= 1 then 0
              when p_action_date - p_done >= 7 and p_action_date - p_created >= 7 then 2
              else 1 end
$$;
create or replace function public.legal_mis_scoreboard(p_test boolean default false)
returns table (person text, assigned integer, completed integer, pending integer, score integer)
language plpgsql stable security definer set search_path to 'public', 'acc' as $$
declare s text := case when p_test then '_test' else '' end;
begin
  return query execute format(
    'select a.person, count(*)::int, count(t.completed_at)::int, (count(*) - count(t.completed_at))::int,
            coalesce(sum(public.legal_mis_action_points(a.action_date, a.created_at::date, (t.completed_at at time zone ''Asia/Kolkata'')::date)), 0)::int
       from public.%I a left join acc.ptasks t on t.id = a.task_id
      group by a.person order by 5 desc, 3 desc', 'mis_case_actions'||s);
end $$;

grant execute on function public.legal_mis_add_action(bigint, text, date, text, text, boolean) to authenticated;
grant execute on function public.legal_mis_update_action(bigint, text, date, text, boolean) to authenticated;
grant execute on function public.legal_mis_delete_case(bigint, boolean) to authenticated;
grant execute on function public.legal_mis_scoreboard(boolean) to authenticated;
grant execute on function public.legal_mis_action_points(date, date, date) to authenticated;
revoke execute on function public.legal_mis_refresh_desc(bigint, boolean) from public, anon;
revoke execute on function public.legal_mis_mirror(bigint, boolean) from public, anon;
