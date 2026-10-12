/* WEEKLY STATUS — the OPS meeting, its minutes, and what everybody walked out owing.

   WHERE THIS COMES FROM. A Google Sheet one person has kept by hand since February 2025: 29
   meetings, 495 action items. It works, but it can only answer "what did we decide on the 21st".
   It cannot answer "what is overdue", "what has Santanu got open", or "are we closing things
   faster than we open them" — which are the questions actually asked in the room.

   WHAT IS MODELLED, AND WHAT IS NOT. Three tables, no cleverness: a meeting, who was in it, and
   the items that came out of it. The sheet's own text is kept verbatim alongside everything this
   derives from it — owner_raw beside owner, due_raw beside due_date — because the derivation is a
   reading of free text typed by a person in a hurry, and a dashboard that hides what it was
   reading cannot be checked. Every row also keeps source_row, the line it came from in the sheet.

   STATUS IS DERIVED AND THEN OWNED. The sheet overloads its Deadline column: it holds a date, or
   "Done", or "wip", or "90% Completed", or a sentence. The import reads both that and the Comments
   column into one of four states. From then on the state belongs here, not to the sheet — ticking
   an item off in JAIN-E is a real edit with a name and a timestamp against it.

   OWNERS ARE AN ALIAS TABLE, NOT A CASE STATEMENT. Sixty-seven different spellings appear in the
   Assigned To column for maybe fifteen people - SN, S Naskar, Santanu Naskar, Santanu, Shantanu.
   Left alone, "who owes what" is unanswerable. The map is a seeded TABLE so that a wrong guess is
   corrected with one update rather than a code change, and anything unmapped passes through
   untouched rather than being guessed at. */

create schema if not exists ops;

/* The NAV module ids live in adm.users.modules; app.module_role only knows a handful of legacy
   module names and returns null for everything else, so app.can_read() cannot gate a new module.
   This is the check already written out longhand inside the usability RPCs, given a name. */
create or replace function app.has_module(p_module text)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select app.is_superadmin()
      or exists (select 1 from adm.users u
                  where u.email = app.current_user_email()
                    and u.active
                    and p_module = any(coalesce(u.modules, '{}')))
$function$;

comment on function app.has_module(text) is
  'True when the signed-in user is a superadmin or carries this NAV module id in adm.users.modules.';

-- ---------------------------------------------------------------------------------------------
create table if not exists ops.meetings(
  id           bigserial primary key,
  meeting_date date not null,
  /* Who was in the room, which is what actually distinguishes these: OPS on its own, OPS with
     Purchase, or the whole group including Marketing. Read from the sheet's own title. */
  kind         text not null default 'OPS',
  note         text,                       -- "HO", "Gurukul Site Visit" — where it was held
  source_row   int,                        -- the line in the sheet, so any figure can be traced back
  created_at   timestamptz not null default now(),
  created_by   text
);
/* One meeting per date and kind. The sheet writes 19-01-26 twice (one meeting, two header rows),
   and re-running the import must land on the same row rather than a second copy. */
create unique index if not exists meetings_date_kind_uq
  on ops.meetings(meeting_date, kind, coalesce(note,''));

create table if not exists ops.attendees(
  id         bigserial primary key,
  meeting_id bigint not null references ops.meetings(id) on delete cascade,
  person     text not null
);
create unique index if not exists attendees_uq on ops.attendees(meeting_id, lower(person));

create table if not exists ops.items(
  id         bigserial primary key,
  meeting_id bigint not null references ops.meetings(id) on delete cascade,
  project    text,
  item       text not null,
  owner      text,                         -- resolved through ops.owner_aliases
  owner_raw  text,                         -- exactly what the sheet says, always kept
  due_date   date,
  due_raw    text,                         -- the sheet's Deadline cell, verbatim
  comments   text,
  extra      text,
  status     text not null default 'open'
             check (status in ('open','in_progress','done','not_done')),
  done_at    timestamptz,
  done_by    text,
  source_row int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);
create index if not exists items_meeting_idx on ops.items(meeting_id);
create index if not exists items_owner_idx   on ops.items(lower(owner));
create index if not exists items_status_idx  on ops.items(status);
/* Re-running the import must update the row it created last time, not add another. */
create unique index if not exists items_source_uq on ops.items(meeting_id, source_row, md5(item));

create table if not exists ops.owner_aliases(
  alias     text primary key,              -- lower-cased, trimmed
  canonical text not null,
  note      text
);

comment on table ops.owner_aliases is
  'Maps the Assigned To column''s many spellings onto one name per person. Unmapped values pass through as typed. Correct a wrong guess here rather than in code.';

-- ---------------------------------------------------------------------------------------------
-- Seeded from the 67 spellings actually present in the sheet. Only the ones that are unambiguous
-- from the attendee lists are mapped; initials nobody has spelled out (DGM, AR, RJ, SG, PG, SM,
-- FM) are deliberately left to pass through as themselves rather than being guessed at.
-- ---------------------------------------------------------------------------------------------
insert into ops.owner_aliases(alias, canonical, note) values
  ('sn','Santanu Naskar','initials, attendee list'),
  ('s naskar','Santanu Naskar',null),
  ('santanu naskar','Santanu Naskar',null),
  ('santanu','Santanu Naskar','only one Santanu Naskar attends; Santanu Goswami is written SGoenka/S Goswami'),
  ('shantanu','Santanu Naskar','spelling variant'),
  ('shantanu naskar','Santanu Naskar',null),
  ('ys','Yash Sodhani','initials, attendee list'),
  ('yash','Yash Sodhani',null),
  ('yashji','Yash Sodhani',null),
  ('yash ji','Yash Sodhani',null),
  ('mb sir','MB',null),
  ('ghosh ji','Ghosh Ji',null),
  ('sgoenka','S Goenka',null),
  ('s goswami','S Goswami',null),
  ('mukeshji','Mukesh',null),
  ('mukesh','Mukesh',null),
  ('biswajit ji','Biswajit',null),
  ('biswajit','Biswajit',null),
  ('dey sir','Dey',null),
  ('dey da','Dey',null),
  ('atanu ji','Atanu',null),
  ('sudhir ji','Sudhir',null),
  ('sandip ji','Sandip',null),
  ('arijit ji','Arijit',null),
  ('shuvrojyoti','Suvrojyoti',null),
  ('suvrojyoti','Suvrojyoti',null),
  ('pallabita','Pallabita',null),
  ('vc','VC Sir',null),
  ('tbd - vc','VC Sir','"to be decided - VC"'),
  ('vc sir''s decision','VC Sir',null)
on conflict (alias) do update set canonical=excluded.canonical, note=excluded.note;

/* Resolves one Assigned To cell. Null for the three values that are plainly not a person: a date
   typed into the owner column, a stray "Done", and one copy of the header row itself. */
create or replace function ops.resolve_owner(p_raw text)
 returns text
 language sql
 stable
 set search_path to 'ops','public'
as $function$
  select case
    when nullif(btrim(coalesce(p_raw,'')),'') is null                 then null
    when lower(btrim(p_raw)) in ('done','assigned to','all')          then null
    when btrim(p_raw) ~ '^[0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}$'  then null
    else coalesce((select a.canonical from ops.owner_aliases a
                    where a.alias = lower(btrim(p_raw))),
                  btrim(p_raw))
  end
$function$;

-- ---------------------------------------------------------------------------------------------
-- RLS. Reads for anybody carrying the module; every write goes through a SECURITY DEFINER RPC,
-- so there is no write policy at all.
-- ---------------------------------------------------------------------------------------------
alter table ops.meetings       enable row level security;
alter table ops.attendees      enable row level security;
alter table ops.items          enable row level security;
alter table ops.owner_aliases  enable row level security;

drop policy if exists meetings_read      on ops.meetings;
drop policy if exists attendees_read     on ops.attendees;
drop policy if exists items_read         on ops.items;
drop policy if exists owner_aliases_read on ops.owner_aliases;

create policy meetings_read      on ops.meetings      for select using (app.has_module('weekly_status'));
create policy attendees_read     on ops.attendees     for select using (app.has_module('weekly_status'));
create policy items_read         on ops.items         for select using (app.has_module('weekly_status'));
create policy owner_aliases_read on ops.owner_aliases for select using (app.has_module('weekly_status'));

grant usage on schema ops to authenticated;
grant select on ops.meetings, ops.attendees, ops.items, ops.owner_aliases to authenticated;
