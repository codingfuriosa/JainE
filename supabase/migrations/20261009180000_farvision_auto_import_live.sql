-- AUTOMATIC FARVISION IMPORT GOES LIVE (10 Oct 2026)
-- 9 Oct test run: all 17 files applied and compared with the manual import - identical on every flat
-- except Jain-Pailan BLOCK-1 5B, where the manual import had skipped the Outstanding row of a booking
-- created the same morning (its Sales Details was imported after Outstanding); the automatic order
-- (Sales Details first) got it right.
--
-- "Import all" in live mode: staff read the files in the browser with the same parsers and hand the
-- rows to the same staging table; the 5-minute tick then applies the day all-or-nothing, exactly as
-- for the GitHub reader. Nothing is written to customer data from the browser.
create or replace function cust.fv_staff_files() returns jsonb
language plpgsql security definer set search_path = cust, public as $$
begin
  if not app.is_custportal_staff() then raise exception 'not allowed'; end if;
  return cust.fv_auto_files();
end $$;

create or replace function cust.fv_staff_stage(p_run bigint, p_queue bigint, p_file text, p_created timestamptz,
                                               p_type text, p_rows_total int, p_chunk int, p_chunks int,
                                               p_rows jsonb, p_parse_error text)
returns void language plpgsql security definer set search_path = cust, public as $$
begin
  if not app.is_custportal_staff() then raise exception 'not allowed'; end if;
  if not exists (select 1 from cust.import_runs where id = p_run and run_date = (now() at time zone 'Asia/Kolkata')::date) then
    raise exception 'not today''s run';
  end if;
  perform cust.fv_auto_stage(p_run, p_queue, p_file, p_created, p_type, p_rows_total, p_chunk, p_chunks, p_rows, p_parse_error);
end $$;

revoke all on function cust.fv_staff_files() from public, anon;
revoke all on function cust.fv_staff_stage(bigint, bigint, text, timestamptz, text, int, int, int, jsonb, text) from public, anon;
grant execute on function cust.fv_staff_files() to authenticated;
grant execute on function cust.fv_staff_stage(bigint, bigint, text, timestamptz, text, int, int, int, jsonb, text) to authenticated;

-- Live from 10 Oct 2026, 00:31 IST (19:01 UTC on 9 Oct); the job removes itself once done.
select cron.unschedule(jobid) from cron.job where jobname = 'farvision-go-live';
select cron.schedule('farvision-go-live', '1 19 9 10 *',
  $$ update cust.import_config set mode = 'live', updated_at = now() where id = 1;
     select cron.unschedule('farvision-go-live'); $$);
