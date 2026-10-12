/* TRANSCRIPTION HEALTH — the call-quality half of the Daily Checks page.

   WHY THIS ISN'T FEATURE ROWS LIKE MOST OF THAT PAGE.
   The other daily checks ask "did somebody open this today", which erp_usage_events answers. These
   five ask how yesterday's selling actually went and whether the CRM is telling the truth about it.
   No usage event can produce them: they are measurements over acc.call_transcripts and
   acc.followup_qa, where the nightly pass writes its verdicts. Same reason workflow health is its
   own RPC rather than a row in the catalogue.

   WHAT "TODAY" MEANS HERE, AND WHY IT IS NOT THE CALL DATE.
   The pass runs about 00:30 IST and grades the PREVIOUS day's calls, finishing by roughly 06:00. So
   "today" is the run that landed this morning, keyed on created_at — which is what somebody opening
   this page at 9am means by it. snapshot_date on those same rows reads as yesterday, deliberately
   not used: a page that showed today's column empty until after midnight would be read as "nothing
   happened" rather than "the day's figures are in the other column". A genuinely empty today column
   therefore means the pass did not run, which is itself the check.

   THE DENOMINATORS ARE THE WHOLE POINT.
   Each verdict is one of Accurate / Partially Accurate / Inaccurate / Not Applicable, and
   "Not Applicable" means the call gave the grader nothing to judge — not that the rep got it right.
   Folding those into the pass rate would quietly inflate every percentage, and unevenly: of 89
   calls scored this morning, pitch could be judged on 70 and the follow-up date on only 37. So each
   rate is taken over the calls where that thing was assessable, and the size of that base is
   returned beside it as *_of. 100% of 37 is a different sentence from 100% of 89, and the page is
   expected to print both halves.

   Partially Accurate counts as NOT accurate, and is returned separately in detail, because the
   difference between wrong and nearly-right is the difference between retraining somebody and
   correcting a habit.

   Yesterday comes back for every figure. A quality percentage with nothing beside it cannot be
   read: 80% pitch accuracy is good news or bad news only against the 82% before it. */
create or replace function public.erp_usability_transcription_health()
 returns table(
   metric text, label text,
   today numeric, yesterday numeric,
   today_of numeric, yesterday_of numeric,
   is_pct boolean, higher_is_better boolean, detail text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date;
        v_yday  date := ((now() at time zone 'Asia/Kolkata')::date - 1);
begin
  /* Same gate as the rest of Usability: these RPCs read every rep's graded calls, so they stay
     with the Systems department rather than following the Pre-Sales module permission. */
  if not (app.is_superadmin()
          or exists(select 1 from adm.users u
                     where u.email = app.current_user_email()
                       and u.active
                       and 'usability' = any(coalesce(u.modules,'{}')))) then
    raise exception 'Usability is limited to the Systems department';
  end if;

  return query
  with tr as (
    /* status is 'completed' or 'non_transcribable'. Only the former is a transcript; the latter is
       a call the pass listened to and could not use (silence, a dead recording), which belongs in
       the detail line rather than the headline count. */
    select (ct.created_at at time zone 'Asia/Kolkata')::date              as d,
           count(*) filter (where ct.status = 'completed')                as ok,
           count(*) filter (where ct.status = 'non_transcribable')        as bad
      from acc.call_transcripts ct
     where (ct.created_at at time zone 'Asia/Kolkata')::date in (v_today, v_yday)
     group by 1
  ),
  qa as (
    select (fq.created_at at time zone 'Asia/Kolkata')::date as d,
           count(*)                                                                as scored,
           count(*) filter (where fq.status_match is not null)                     as st_judged,
           count(*) filter (where fq.status_match is false)                        as st_wrong,
           count(*) filter (where fq.remarks_status is not null
                              and fq.remarks_status <> 'Not Applicable')           as rem_judged,
           count(*) filter (where fq.remarks_status = 'Accurate')                  as rem_ok,
           count(*) filter (where fq.remarks_status = 'Partially Accurate')        as rem_part,
           count(*) filter (where fq.pitch_status is not null
                              and fq.pitch_status <> 'Not Applicable')             as pit_judged,
           count(*) filter (where fq.pitch_status = 'Accurate')                    as pit_ok,
           count(*) filter (where fq.pitch_status = 'Partially Accurate')          as pit_part,
           count(*) filter (where fq.followup_date_status is not null
                              and fq.followup_date_status <> 'Not Applicable')     as fu_judged,
           count(*) filter (where fq.followup_date_status = 'Accurate')            as fu_ok,
           count(*) filter (where fq.followup_date_status = 'Partially Accurate')  as fu_part
      from acc.followup_qa fq
     where (fq.created_at at time zone 'Asia/Kolkata')::date in (v_today, v_yday)
     group by 1
  ),
  /* Flattened to one row of scalars so the VALUES list below reads as the five figures the page
     shows, rather than five near-identical joins. coalesce because a day with no pass has no row
     at all, and the page needs a 0 to print. */
  n as (select
    coalesce((select ok  from tr where d=v_today),0) tr_t, coalesce((select ok  from tr where d=v_yday),0) tr_y,
    coalesce((select bad from tr where d=v_today),0) bad_t,
    coalesce((select scored     from qa where d=v_today),0) sc_t,
    coalesce((select st_judged  from qa where d=v_today),0) sj_t, coalesce((select st_judged  from qa where d=v_yday),0) sj_y,
    coalesce((select st_wrong   from qa where d=v_today),0) sw_t, coalesce((select st_wrong   from qa where d=v_yday),0) sw_y,
    coalesce((select rem_judged from qa where d=v_today),0) rj_t, coalesce((select rem_judged from qa where d=v_yday),0) rj_y,
    coalesce((select rem_ok     from qa where d=v_today),0) ro_t, coalesce((select rem_ok     from qa where d=v_yday),0) ro_y,
    coalesce((select rem_part   from qa where d=v_today),0) rp_t,
    coalesce((select pit_judged from qa where d=v_today),0) pj_t, coalesce((select pit_judged from qa where d=v_yday),0) pj_y,
    coalesce((select pit_ok     from qa where d=v_today),0) po_t, coalesce((select pit_ok     from qa where d=v_yday),0) po_y,
    coalesce((select pit_part   from qa where d=v_today),0) pp_t,
    coalesce((select fu_judged  from qa where d=v_today),0) fj_t, coalesce((select fu_judged  from qa where d=v_yday),0) fj_y,
    coalesce((select fu_ok      from qa where d=v_today),0) fo_t, coalesce((select fu_ok      from qa where d=v_yday),0) fo_y,
    coalesce((select fu_part    from qa where d=v_today),0) fp_t
  )
  select v.metric, v.label, v.today, v.yesterday, v.today_of, v.yesterday_of,
         v.is_pct, v.higher_is_better, v.detail
    from n, lateral (values
      ('transcribed','Calls transcribed',
        n.tr_t::numeric, n.tr_y::numeric, null::numeric, null::numeric, false, true,
        case when n.bad_t > 0
             then n.bad_t::text||' more could not be transcribed · '||n.sc_t::text||' scored'
             else n.sc_t::text||' scored' end),
      ('crm_mismatch','CRM status wrong',
        case when n.sj_t=0 then null else round(100.0*n.sw_t/n.sj_t,1) end,
        case when n.sj_y=0 then null else round(100.0*n.sw_y/n.sj_y,1) end,
        n.sj_t::numeric, n.sj_y::numeric, true, false,
        n.sw_t::text||' call'||case when n.sw_t=1 then '' else 's' end
          ||' the rep logged under the wrong status'),
      ('remarks','Remarks accuracy',
        case when n.rj_t=0 then null else round(100.0*n.ro_t/n.rj_t,1) end,
        case when n.rj_y=0 then null else round(100.0*n.ro_y/n.rj_y,1) end,
        n.rj_t::numeric, n.rj_y::numeric, true, true,
        n.rp_t::text||' partially accurate'),
      ('pitch','Pitch accuracy',
        case when n.pj_t=0 then null else round(100.0*n.po_t/n.pj_t,1) end,
        case when n.pj_y=0 then null else round(100.0*n.po_y/n.pj_y,1) end,
        n.pj_t::numeric, n.pj_y::numeric, true, true,
        n.pp_t::text||' partially accurate'),
      ('followup','Follow-up date accuracy',
        case when n.fj_t=0 then null else round(100.0*n.fo_t/n.fj_t,1) end,
        case when n.fj_y=0 then null else round(100.0*n.fo_y/n.fj_y,1) end,
        n.fj_t::numeric, n.fj_y::numeric, true, true,
        n.fp_t::text||' partially accurate')
    ) as v(metric,label,today,yesterday,today_of,yesterday_of,is_pct,higher_is_better,detail);
end;
$function$;

revoke all on function public.erp_usability_transcription_health() from public;
grant execute on function public.erp_usability_transcription_health() to authenticated;
