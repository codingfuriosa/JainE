-- LEADS FROM THE CRM'S SOURCE REPORT (23 Nov 2026, Ayush: "Yes, add Leads").
-- source_wise_absolute_api now carries "leads" beside qualified / site_visited / revisited / booked / lost, for every
-- project and every source. Stored in camp.crm_source_daily (self_leads / tot_leads, filled by ads-daily-sync {srcwise}
-- from tonight; history from 1 Jan 2026 re-read by one-time crons srcleads_back_00..), and used by:
--   * Campaign Analytics > Sources       (Leads column)
--   * CRM & Sales > Performance Report    (Lead for EVERY channel, from this report - Facebook and Google too, so Lead and
--                                          QL are counted the same way; Facebook / Google spend still from their reports)
--   * CRM & Sales > Daily Updates         (Leads month / yesterday, same source rules as Qualified; email xlsx too)
-- Applied by one-time cron srcleads_ddl_once 20:30 IST 23 Nov (after the Performance Report tables at 20:10).

alter table camp.crm_source_daily add column if not exists self_leads integer not null default 0;
alter table camp.crm_source_daily add column if not exists tot_leads  integer not null default 0;
alter table acc.crm_daily_updates add column if not exists month_leads integer;
alter table acc.crm_daily_updates add column if not exists yesterday_leads integer;

create or replace function acc.crm_perf_refresh(p_from date default null, p_to date default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare y date := (now() at time zone 'Asia/Kolkata')::date - 1;
        m0 date := date_trunc('month', coalesce(p_from, (date_trunc('month', y) - interval '1 month')::date))::date;
        m1 date := date_trunc('month', coalesce(p_to, y))::date; n integer;
begin
  delete from acc.crm_perf_report where month between m0 and m1;
  with s as (
    select date_trunc('month', d.day)::date m, d.bu_id, max(d.business_unit) bu, d.level, d.top_source, d.source,
           sum(d.tot_leads) tl, sum(d.tot_q) tq, sum(d.tot_sv) tsv, sum(d.tot_bk) tbk,
           sum(d.self_leads) sl, sum(d.self_q) sq, sum(d.self_sv) ssv, sum(d.self_bk) sbk
      from camp.crm_source_daily d
     where d.day >= m0 and d.day < (m1 + interval '1 month') and d.day <= y and d.level <= 1
     group by 1, 2, d.level, d.top_source, d.source),
  c as (   -- one row per report line
    select m, bu_id, bu, 'digital' g, 'Facebook' ch, '' sb, tl l, tq q, tsv v, tbk b from s where level = 1 and top_source = 'Online' and source = 'FACEBOOK'
    union all select m, bu_id, bu, 'digital', 'Google', '', tl, tq, tsv, tbk from s where level = 1 and top_source = 'Online' and source = 'Google'
    union all select m, bu_id, bu, 'digital', 'ChatGPT', '', tl, tq, tsv, tbk from s where (level = 1 and top_source = 'Online' and source = 'Chatgpt') or (level = 0 and source = 'Chatgpt')
    union all select m, bu_id, bu, 'digital', 'Social Media', '', tl, tq, tsv, tbk from s where level = 0 and source = 'Social Media'
    union all select m, bu_id, bu, 'digital', 'Others', source, tl, tq, tsv, tbk from s where level = 1 and top_source = 'Online' and source not in ('FACEBOOK','Google','Chatgpt')
    union all select m, bu_id, bu, 'digital', 'Others', 'Online (no sub-source)', sl, sq, ssv, sbk from s where level = 0 and source = 'Online'
    union all select m, bu_id, bu, 'digital', 'Others', source, tl, tq, tsv, tbk from s where level = 0 and source in ('Other Project Campaign','sms')
    union all select m, bu_id, bu, 'nondigital', case source when 'NewsPaper' then 'Newspaper' else source end, '', tl, tq, tsv, tbk from s where level = 0 and source in ('Agent','Hoarding','Walk In','NewsPaper')
    union all select m, bu_id, bu, 'nondigital', 'Others', source, tl, tq, tsv, tbk from s where level = 0
        and source not in ('Online','Chatgpt','Social Media','Other Project Campaign','sms','Agent','Hoarding','Walk In','NewsPaper')),
  agg as (select m, bu_id, max(bu) bu, g, ch, sb, sum(l)::int l, sum(q)::int q, sum(v)::int v, sum(b)::int b from c group by m, bu_id, g, ch, sb),
  gl as (  -- Facebook / Google spend from the CRM's own Facebook / Google reports
    select date_trunc('month', day)::date m, bu_id, max(business_unit) bu, case when campaign_type = 'facebook' then 'Facebook' else 'Google' end ch,
           sum(cost) sp
      from camp.crm_google_daily where day >= m0 and day < (m1 + interval '1 month') and day <= y group by 1, 2, 4),
  allr as (
    select coalesce(a.m, gl.m) m, coalesce(a.bu_id, gl.bu_id) bu_id, coalesce(a.bu, gl.bu, '') bu, coalesce(a.g, 'digital') g, coalesce(a.ch, gl.ch) ch,
           coalesce(a.sb, '') sb, coalesce(a.l, 0) l, gl.sp, coalesce(a.q, 0) q, coalesce(a.v, 0) v, coalesce(a.b, 0) b
      from agg a full join gl on gl.m = a.m and gl.bu_id = a.bu_id and gl.ch = a.ch and a.g = 'digital' and a.sb = ''),
  ins as (
    insert into acc.crm_perf_report (month, bu_id, business_unit, grp, channel, sub, leads, auto_spend, ql, sv, bk, refreshed_at)
    select m, bu_id, bu, g, ch, sb, l, sp, q, v, b, now() from allr
     where ch in ('Facebook','Google') or l > 0 or q > 0 or v > 0 or b > 0
    returning 1)
  select count(*) into n from ins;
  return n;
end $$;
revoke all on function acc.crm_perf_refresh(date, date) from public, anon, authenticated;

-- Daily Updates: leads for days already written, from the stored source report (same rules as the function:
-- top-level Online / Hoarding / Other Project Campaign / Newspaper / Kiosk, "Online +" counts as Online, names with "("
-- skipped). Run after the history re-read (cron srcleads_du_fill).
create or replace function acc.crm_daily_updates_fill_leads() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  with u as (
    select d.report_date, d.property_key, d.realtybucket_project_id pid,
           case when to_char(d.report_date, 'DD') = '01' then d.report_date else date_trunc('month', d.report_date)::date end mfrom
      from acc.crm_daily_updates d where not d.is_total),
  src as (
    select day, bu_id, tot_leads from camp.crm_source_daily
     where level = 0 and source not like '%(%'
       and regexp_replace(source, '\s*\+\s*$', '') in ('Online','Hoarding','Other Project Campaign','Newspaper','Kiosk')),
  v as (
    select u.report_date, u.property_key,
           (select coalesce(sum(tot_leads),0) from src where src.bu_id = u.pid and src.day between u.mfrom and u.report_date) ml,
           (select coalesce(sum(tot_leads),0) from src where src.bu_id = u.pid and src.day = u.report_date) yl
      from u),
  up as (update acc.crm_daily_updates d set month_leads = v.ml, yesterday_leads = v.yl
           from v where d.report_date = v.report_date and d.property_key = v.property_key returning d.report_date)
  select count(*) into n from up;
  update acc.crm_daily_updates t set month_leads = s.ml, yesterday_leads = s.yl
    from (select report_date, sum(month_leads) ml, sum(yesterday_leads) yl from acc.crm_daily_updates where not is_total group by 1) s
   where t.is_total and t.report_date = s.report_date;
  return n;
end $$;
revoke all on function acc.crm_daily_updates_fill_leads() from public, anon, authenticated;
notify pgrst, 'reload schema';
