-- MIS REPORT — the daily Outstanding vs Collection picture, kept as a record.
--
-- Three tables. mis_bus is the list of business units and the order they appear in, which is
-- the one thing that must not drift: the report has been read the same way for years and a
-- row moving would make two dates uncomparable. mis_reports is one day's report. mis_rows is
-- the twelve lines of it, plus what was counted to get there, so a figure can be traced back
-- to the file it came from without re-running the extraction.

create table if not exists postsales.mis_bus (
  id           bigserial primary key,
  sort_order   int  not null,
  project_name text not null,              -- column A: the name people use
  bu_name      text not null unique,       -- column B: the exact ERP business unit
  search_term  text,                       -- what to type in FarVision's BU box
  pick_note    text,                       -- which option to take when the search is ambiguous
  active       boolean not null default true
);

create table if not exists postsales.mis_reports (
  id                bigserial primary key,
  report_date       date not null unique,  -- one report per day; re-running replaces it
  curr_month_label  text not null,         -- e.g. Sep'26
  prev_month_label  text not null,
  total_outstanding numeric(16,2) not null default 0,
  total_curr        numeric(16,2) not null default 0,
  total_prev        numeric(16,2) not null default 0,
  bu_count          int  not null default 0,   -- how many of the BUs actually had files
  note              text,
  created_by        text,
  created_at        timestamptz not null default now()
);

create table if not exists postsales.mis_rows (
  id              bigserial primary key,
  report_id       bigint not null references postsales.mis_reports(id) on delete cascade,
  sort_order      int  not null,
  project_name    text not null,
  bu_name         text not null,
  outstanding     numeric(16,2),
  curr_collection numeric(16,2),
  prev_collection numeric(16,2),
  -- the audit trail: which file, how many receipts were counted, how many were left out
  src_collection  text,
  src_outstanding text,
  n_curr          int,
  n_prev          int,
  n_out           int,
  n_excluded      int,
  unique (report_id, bu_name)
);

create index if not exists mis_rows_report_idx on postsales.mis_rows(report_id, sort_order);
create index if not exists mis_reports_date_idx on postsales.mis_reports(report_date desc);

alter table postsales.mis_bus     enable row level security;
alter table postsales.mis_reports enable row level security;
alter table postsales.mis_rows    enable row level security;

drop policy if exists mis_bus_all     on postsales.mis_bus;
drop policy if exists mis_reports_all on postsales.mis_reports;
drop policy if exists mis_rows_all    on postsales.mis_rows;

-- Same gate as the rest of Post Sales: staff yes, customers on the portal no.
create policy mis_bus_all     on postsales.mis_bus     for all using (not app.is_customer()) with check (not app.is_customer());
create policy mis_reports_all on postsales.mis_reports for all using (not app.is_customer()) with check (not app.is_customer());
create policy mis_rows_all    on postsales.mis_rows    for all using (not app.is_customer()) with check (not app.is_customer());

grant select, insert, update, delete on postsales.mis_bus, postsales.mis_reports, postsales.mis_rows to anon, authenticated;
grant usage, select on all sequences in schema postsales to anon, authenticated;

-- The twelve, in report order, exactly as the template has carried them.
insert into postsales.mis_bus (sort_order, project_name, bu_name, search_term, pick_note) values
  ( 1,'DREAM GURUKUL',        'DREAM GURUKUL(DOLTALA MADHYAMGRAM)','GURUKUL',         'second match, not plain "DREAM GURUKUL"'),
  ( 2,'DREAM WORLD CITY',     'DREAM JAIN-PAILAN',                 'JAIN-PAILAN',     null),
  ( 3,'DREAM WORLD CITY',     'DREAM GATEWAY PAILAN PROJECTS',     'GATEWAY',         'third match, not HOTELS LTD. - PROJECT or HOTELS-HO'),
  ( 4,'DREAM ONE',            'DREAM ONE BLK 3 \ 4',               'BLK 3',           null),
  ( 5,'DREAM VALLEY',         'DREAM VALLEY',                      'DREAM VALLEY',    'first option, not (MAINT) or (M)'),
  ( 6,'DREAM ECOCITY',        'DREAM ECOCITY',                     'ECOCITY',         'not BUNGALOW, not (M), not "ECO CITY"'),
  ( 7,'DREAM ONE',            'DREAM ONE BLK 1 \ 2',               'ONE BLK 1',       null),
  ( 8,'DREAM RESIDENCY MANOR','DREAM RESIDENCY MANOR',             'RESIDENCY MANOR', 'not (MAINT)'),
  ( 9,'DREAM EXOTICA',        'DREAM EXOTICA',                     'EXOTICA',         'not (MAINT). or (M)'),
  (10,'DREAM ECOCITY',        'DREAM ECOCITY BUNGALOW',            'ECOCITY BUNGALOW',null),
  (11,'DREAM ANANTA',         'DREAM ANANTA',                      'ANANTA',          'single match'),
  (12,'DREAM DIAMOND',        'DREAM DIAMOND.',                    'DIAMOND',         'note the trailing full stop')
on conflict (bu_name) do nothing;
