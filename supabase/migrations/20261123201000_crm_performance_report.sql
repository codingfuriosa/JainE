-- PERFORMANCE REPORT (23 Nov 2026, Ayush: "a new report in CRM & Sales named Performance Report ... Monthly data is pulled
-- and updated weekly Sunday ... Channel, Spent, Lead, CPL, QL, QL%, CPQL, SV, Booking, QL to SV%, SV to Booking% ...
-- Digital (Facebook, Google, Social Media, ChatGPT, Others) and Non Digital (Agent, Hoarding, Walk In, Newspaper,
-- Others with a drill-down) ... project wise and All Projects").
--
-- Where each figure comes from (all already stored by JainE's night jobs - nothing new is asked of the CRM):
--   QL / SV / Booking  camp.crm_source_daily (the CRM's source report, "absolute during the period"), every channel.
--   Lead, Spent        Facebook and Google only: camp.crm_google_daily (the CRM's Facebook / Google reports - leads that
--                      came in during the month, and the spend it shows). Other channels have no lead count in the CRM.
--   Spent (others)     typed in per month and project in acc.crm_perf_spend (Ayush: "Monthly entry box").
-- Groups (Ayush): Digital = Online's Facebook, Google, ChatGPT (Online > Chatgpt and the top-level Chatgpt), Social
-- Media, and Others = every other Online source + Online itself + Other Project Campaign + sms. Non Digital = Agent,
-- Hoarding, Walk In, NewsPaper, and Others = every other top-level source.

create table if not exists acc.crm_perf_report (
  month         date    not null,            -- first day of the month
  bu_id         integer not null,
  business_unit text    not null default '',
  grp           text    not null check (grp in ('digital','nondigital')),
  channel       text    not null,            -- Facebook, Google, Social Media, ChatGPT, Others / Agent, Hoarding, Walk In, Newspaper, Others
  sub           text    not null default '', -- inside Others: the CRM source's own name
  leads         integer,                     -- Facebook / Google only
  auto_spend    numeric,                     -- Facebook / Google only
  ql            integer not null default 0,
  sv            integer not null default 0,
  bk            integer not null default 0,
  refreshed_at  timestamptz not null default now(),
  primary key (month, bu_id, grp, channel, sub)
);
alter table acc.crm_perf_report enable row level security;
drop policy if exists crm_perf_report_read on acc.crm_perf_report;
create policy crm_perf_report_read on acc.crm_perf_report for select to authenticated using (true);
grant select on acc.crm_perf_report to authenticated;
grant all on acc.crm_perf_report to service_role;

create table if not exists acc.crm_perf_spend (
  month      date    not null,
  bu_id      integer not null,
  channel    text    not null,                -- 'D:' or 'N:' (Digital / Non Digital) + the report's channel name (never Facebook / Google)
  amount     numeric not null default 0,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (month, bu_id, channel)
);
alter table acc.crm_perf_spend enable row level security;
drop policy if exists crm_perf_spend_read on acc.crm_perf_spend;
create policy crm_perf_spend_read on acc.crm_perf_spend for select to authenticated using (true);
drop policy if exists crm_perf_spend_write on acc.crm_perf_spend;
create policy crm_perf_spend_write on acc.crm_perf_spend for all to authenticated using (app.has_module('crm')) with check (app.has_module('crm'));
grant select, insert, update, delete on acc.crm_perf_spend to authenticated;
grant all on acc.crm_perf_spend to service_role;

-- Rebuilds the given months whole (default: this month to yesterday, and last month).
create or replace function acc.crm_perf_refresh(p_from date default null, p_to date default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare y date := (now() at time zone 'Asia/Kolkata')::date - 1;
        m0 date := date_trunc('month', coalesce(p_from, (date_trunc('month', y) - interval '1 month')::date))::date;
        m1 date := date_trunc('month', coalesce(p_to, y))::date; n integer;
begin
  delete from acc.crm_perf_report where month between m0 and m1;
  with s as (
    select date_trunc('month', d.day)::date m, d.bu_id, max(d.business_unit) bu, d.level, d.top_source, d.source,
           sum(d.tot_q) tq, sum(d.tot_sv) tsv, sum(d.tot_bk) tbk, sum(d.self_q) sq, sum(d.self_sv) ssv, sum(d.self_bk) sbk
      from camp.crm_source_daily d
     where d.day >= m0 and d.day < (m1 + interval '1 month') and d.day <= y and d.level <= 1
     group by 1, 2, d.level, d.top_source, d.source),
  c as (   -- one row per report line
    select m, bu_id, bu, 'digital' g, 'Facebook' ch, '' sb, tq q, tsv v, tbk b from s where level = 1 and top_source = 'Online' and source = 'FACEBOOK'
    union all select m, bu_id, bu, 'digital', 'Google', '', tq, tsv, tbk from s where level = 1 and top_source = 'Online' and source = 'Google'
    union all select m, bu_id, bu, 'digital', 'ChatGPT', '', tq, tsv, tbk from s where (level = 1 and top_source = 'Online' and source = 'Chatgpt') or (level = 0 and source = 'Chatgpt')
    union all select m, bu_id, bu, 'digital', 'Social Media', '', tq, tsv, tbk from s where level = 0 and source = 'Social Media'
    union all select m, bu_id, bu, 'digital', 'Others', source, tq, tsv, tbk from s where level = 1 and top_source = 'Online' and source not in ('FACEBOOK','Google','Chatgpt')
    union all select m, bu_id, bu, 'digital', 'Others', 'Online (no sub-source)', sq, ssv, sbk from s where level = 0 and source = 'Online'
    union all select m, bu_id, bu, 'digital', 'Others', source, tq, tsv, tbk from s where level = 0 and source in ('Other Project Campaign','sms')
    union all select m, bu_id, bu, 'nondigital', case source when 'NewsPaper' then 'Newspaper' else source end, '', tq, tsv, tbk from s where level = 0 and source in ('Agent','Hoarding','Walk In','NewsPaper')
    union all select m, bu_id, bu, 'nondigital', 'Others', source, tq, tsv, tbk from s where level = 0
        and source not in ('Online','Chatgpt','Social Media','Other Project Campaign','sms','Agent','Hoarding','Walk In','NewsPaper')),
  agg as (select m, bu_id, max(bu) bu, g, ch, sb, sum(q)::int q, sum(v)::int v, sum(b)::int b from c group by m, bu_id, g, ch, sb),
  gl as (  -- Facebook / Google leads and spend from the CRM's own Facebook / Google reports
    select date_trunc('month', day)::date m, bu_id, max(business_unit) bu, case when campaign_type = 'facebook' then 'Facebook' else 'Google' end ch,
           sum(leads)::int l, sum(cost) sp
      from camp.crm_google_daily where day >= m0 and day < (m1 + interval '1 month') and day <= y group by 1, 2, 4),
  allr as (
    select coalesce(a.m, gl.m) m, coalesce(a.bu_id, gl.bu_id) bu_id, coalesce(a.bu, gl.bu, '') bu, coalesce(a.g, 'digital') g, coalesce(a.ch, gl.ch) ch,
           coalesce(a.sb, '') sb, gl.l, gl.sp, coalesce(a.q, 0) q, coalesce(a.v, 0) v, coalesce(a.b, 0) b
      from agg a full join gl on gl.m = a.m and gl.bu_id = a.bu_id and gl.ch = a.ch and a.g = 'digital' and a.sb = ''),
  ins as (
    insert into acc.crm_perf_report (month, bu_id, business_unit, grp, channel, sub, leads, auto_spend, ql, sv, bk, refreshed_at)
    select m, bu_id, bu, g, ch, sb, l, sp, q, v, b, now() from allr
     where ch in ('Facebook','Google') or q > 0 or v > 0 or b > 0
    returning 1)
  select count(*) into n from ins;
  return n;
end $$;
revoke all on function acc.crm_perf_refresh(date, date) from public, anon, authenticated;

-- every month from January 2026 now; then every Sunday 07:00 IST (this month to Saturday, and last month)
select acc.crm_perf_refresh('2026-01-01'::date, null);
select cron.unschedule(jobid) from cron.job where jobname = 'crm_perf_weekly';
select cron.schedule('crm_perf_weekly', '30 1 * * 0', $c$ select acc.crm_perf_refresh(); $c$);
notify pgrst, 'reload schema';
