-- THE SHEET BOT IS GONE. It was a test: a booking's reading was to be typed into a Google Sheet by
-- tools/sheet-bot (or the Sheet queue in tools/jaine-automation-extension). It never ran - every one
-- of its jobs was still waiting on 15 Oct 2026 - and both are removed from the repo with this.
--
-- Dropped: the trigger that queued a job each time a booking's reading finished, the queue itself
-- and its functions, and its secret. The 34 queued jobs are kept in
-- acc.zz_backup_sheet_jobs_20261015. acc.automation_jobs (the extension's other queue) is untouched.

create table if not exists acc.zz_backup_sheet_jobs_20261015 as select * from acc.sheet_jobs;
alter table acc.zz_backup_sheet_jobs_20261015 enable row level security;

drop trigger if exists trg_sheet_job_enqueue on acc.booking_audits;
drop trigger if exists trg_sheet_job_ping on acc.sheet_jobs;
drop function if exists acc.sheet_job_enqueue() cascade;
drop function if exists acc.sheet_job_ping() cascade;
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'acc' and p.proname in ('sheet_job_claim','sheet_job_finish') loop
    execute 'drop function if exists ' || r.sig;
  end loop;
end $$;
drop table if exists acc.sheet_jobs;
delete from acc.job_secrets where name = 'sheet_bot';
