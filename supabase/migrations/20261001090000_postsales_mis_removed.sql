-- The Post Sales MIS tab was removed at the Administrator's request.
--
-- The code goes back through git if it is ever wanted again. The DATA does not: the sixteen
-- historical reports were transcribed from finished MIS sheets, and one of those sheets had a
-- mistyped date that took a careful read to untangle. So the three tables were copied first,
-- under the bk_<date>_ prefix the cust schema already uses for exactly this, and only then
-- dropped. Nothing was lost, only unplugged.
--
-- To bring it back: 20260929090431_postsales_mis_report_records.sql recreates the tables, and
-- the three copies below refill them.

create table if not exists postsales.bk_20261001_mis_reports as table postsales.mis_reports;
create table if not exists postsales.bk_20261001_mis_rows    as table postsales.mis_rows;
create table if not exists postsales.bk_20261001_mis_bus     as table postsales.mis_bus;

alter table postsales.bk_20261001_mis_reports enable row level security;
alter table postsales.bk_20261001_mis_rows    enable row level security;
alter table postsales.bk_20261001_mis_bus     enable row level security;
create policy bk_mis_reports_all on postsales.bk_20261001_mis_reports for all using (not app.is_customer()) with check (not app.is_customer());
create policy bk_mis_rows_all    on postsales.bk_20261001_mis_rows    for all using (not app.is_customer()) with check (not app.is_customer());
create policy bk_mis_bus_all     on postsales.bk_20261001_mis_bus     for all using (not app.is_customer()) with check (not app.is_customer());

drop table if exists postsales.mis_rows;
drop table if exists postsales.mis_reports;
drop table if exists postsales.mis_bus;
