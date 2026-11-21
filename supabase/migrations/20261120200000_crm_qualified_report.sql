-- QUALIFIED LEADS REPORT (20 Nov 2026, Ayush: "I want the data to be uploaded in JainE in CRM & Sales as a new Report
-- divided into Daily, Weekly, Monthly"). Replaces the browser routine that pasted the same figures into the Google Sheet
-- "Qualified Leads" (tabs Daily / Weekly / Monthly).
-- Figure = the CRM's Qualified leads whose source is Online or Other Project Campaign ("Absolute during the period"),
-- per project. Taken from camp.crm_source_daily (source_wise_absolute_api, read nightly); its days add up exactly.
-- The rows already in the Sheet were copied in once (origin 'sheet'); every morning the last 30 days are read again
-- and changed figures overwrite the row in place (origin 'api') - a period is never added twice.
create table if not exists acc.crm_qualified_report (
  kind         text    not null check (kind in ('daily','weekly','monthly')),
  period_start date    not null,
  period_end   date    not null,
  bu_id        integer not null,           -- RealtyBucket project id
  q            integer not null default 0,
  origin       text    not null default 'api',  -- 'sheet' = copied from the Google Sheet, 'api' = from the CRM
  updated_at   timestamptz not null default now(),
  primary key (kind, period_start, bu_id)
);
alter table acc.crm_qualified_report enable row level security;
drop policy if exists crm_qualified_report_read on acc.crm_qualified_report;
create policy crm_qualified_report_read on acc.crm_qualified_report for select to authenticated using (true);
grant select on acc.crm_qualified_report to authenticated;
grant all on acc.crm_qualified_report to service_role;

-- The morning re-read, as the routine did it (today = IST date; today itself never included):
--   daily   every day from today-30 to yesterday
--   weekly  every finished Mon-Sun week touching those 30 days
--   monthly this month 1st -> yesterday (on the 1st: last month, finished), and last month while it ends within the 30 days
create or replace function acc.crm_qualified_refresh() returns integer
language plpgsql security definer set search_path = '' as $$
declare t date := (now() at time zone 'Asia/Kolkata')::date; y date := t - 1; w0 date := t - 30; n integer;
begin
  with ids(bu_id) as (values (70),(3),(2),(6),(5),(4),(71),(7),(8),(1),(171)),
  per as (
    select 'daily'::text kind, d::date s, d::date e from generate_series(w0, y, interval '1 day') d
    union all
    select 'weekly', ws::date, (ws::date + 6) from generate_series(date_trunc('week', w0)::date, y - 6, interval '7 days') ws
    union all
    select 'monthly', date_trunc('month', y)::date, y
    union all
    select 'monthly', date_trunc('month', date_trunc('month', y) - interval '1 day')::date, (date_trunc('month', y)::date - 1)
      where (date_trunc('month', y)::date - 1) >= w0
  ),
  vals as (
    select p.kind, p.s, p.e, i.bu_id,
      coalesce((select sum(c.tot_q) from camp.crm_source_daily c
                where c.level = 0 and c.source in ('Online','Other Project Campaign')
                  and c.bu_id = i.bu_id and c.day between p.s and p.e), 0)::integer q
    from per p cross join ids i
  ),
  up as (
    insert into acc.crm_qualified_report as r (kind, period_start, period_end, bu_id, q, origin, updated_at)
    select kind, s, e, bu_id, q, 'api', now() from vals
    on conflict (kind, period_start, bu_id) do update
      set q = excluded.q, period_end = excluded.period_end, origin = 'api', updated_at = now()
      where r.q is distinct from excluded.q or r.period_end <> excluded.period_end
    returning 1
  )
  select count(*) into n from up;
  return n;
end $$;
revoke all on function acc.crm_qualified_refresh() from public, anon, authenticated;

-- every night 02:00 IST, after the night's CRM source read (Ayush 20 Nov: "Not at 07:00 ... 02:00 IST")
select cron.unschedule(jobid) from cron.job where jobname = 'crm_qualified_refresh';
select cron.schedule('crm_qualified_refresh', '30 20 * * *', $c$select acc.crm_qualified_refresh()$c$);
