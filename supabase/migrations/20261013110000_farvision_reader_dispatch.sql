-- GitHub's own schedule for the reader proved unreliable (13 Oct 2026): of ~15 scheduled runs a day
-- almost all were skipped, and the first run came at 16:15 / 16:30 / 17:55 IST on 10-12 Oct, so
-- each day's import landed in the evening. The database now starts the reader itself through
-- GitHub's workflow_dispatch as soon as files are waiting (3 minutes after the last one arrived),
-- and again every 15 minutes while any stay unread. Needs a GitHub token in acc.job_secrets
-- ('github_dispatch'); without one this does nothing and the schedule remains the only trigger.
-- cust.fv_import_tick was re-created with the dispatch step (see the live definition; otherwise
-- unchanged from 20261009100000_farvision_auto_import.sql).
alter table cust.import_runs add column if not exists dispatched_at timestamptz;
alter table cust.import_runs add column if not exists dispatch_count int not null default 0;

create or replace function cust.fv_dispatch_reader(p_run bigint) returns boolean
language plpgsql security definer set search_path = cust, public as $$
declare v_tok text;
begin
  select value into v_tok from acc.job_secrets where name = 'github_dispatch';
  if coalesce(v_tok, '') = '' then return false; end if;
  perform net.http_post(
    url := 'https://api.github.com/repos/codingfuriosa/JainE/actions/workflows/farvision-import.yml/dispatches',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_tok, 'Accept', 'application/vnd.github+json',
                                  'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'jaine-farvision-import',
                                  'Content-Type', 'application/json'),
    body := jsonb_build_object('ref', 'main'),
    timeout_milliseconds := 20000);
  update cust.import_runs set dispatched_at = now(), dispatch_count = dispatch_count + 1 where id = p_run;
  return true;
exception when others then
  return false;
end $$;
revoke all on function cust.fv_dispatch_reader(bigint) from public, anon, authenticated;
