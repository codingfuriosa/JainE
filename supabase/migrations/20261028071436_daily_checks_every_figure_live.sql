/* DAILY CHECKS — every figure on the page is now today's, taken when you look at it.

   WHAT WAS WRONG.
   The page is read every morning to answer "is anything not happening today", and two of its three
   blocks could not answer that:

     - the feature rows were a THIRTY DAY total. "Create task - 99 uses, 17 people" is the same
       sentence this morning as it was yesterday morning and as it will be tomorrow; a day's worth
       of movement disappears into two significant figures. A reader could not tell from it whether
       a single task had been created today, which is the only thing the row was there to say.
     - workflow health's Raised / Closed / Reverted were YESTERDAY's. The three live columns beside
       them count where instances sit right now, so one table carried two different days without
       giving the reader any way to see which column was which.

   WHAT THIS CHANGES.
   Every count on the page becomes today, in IST, with yesterday returned beside it so there is
   something to read it against. Nothing is dropped: the thirty-day total and the activity band
   stay on the feature rows as the context they always were, now plainly marked as the longer view
   rather than standing in for the short one.

   THE ONE FIGURE THAT STILL CANNOT BE LIVE, AND WHY IT NOW SAYS SO.
   Transcription health is graded by the overnight pass - it starts about 00:30 IST and writes for
   three or four hours, and nothing lands during the working day. Making those five figures live
   would mean grading calls as they finish, which is a pipeline change and not a reporting one. So
   they stay as they are and the RPC now returns last_run: the moment the pass last wrote anything.
   The page prints it, so the one block that cannot be live at least says out loud how old it is,
   and a morning where the pass did not run reads as a fact rather than as five zeroes.

   NO SECOND DEFINITION OF ANY NUMBER. The thirty-day half of the feature rows is not recomputed
   here - erp_usability_daily_feature_checks CALLS erp_usability_report for it, so "uses", "people"
   and the activity band can only ever mean on this page exactly what they mean on Usability. */

/* ---------------------------------------------------------------- the feature rows ----------- */
/* Only the flagged features, and only today's window plus the thirty-day context. The page used to
   pull the whole catalogue report - every feature in every module - and throw away all but the
   eleven rows it draws, which was already more work than it needed and is now work it would be
   repeating every minute, because the page refreshes itself while it is open. */
create or replace function public.erp_usability_daily_feature_checks()
 returns table(
   module_id text, module_label text, tab text, feature text, feature_key text,
   today_uses bigint, today_users bigint,
   yday_uses  bigint, yday_users  bigint,
   uses bigint, users bigint, band text,
   last_used timestamptz)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date;
        v_yday  date := ((now() at time zone 'Asia/Kolkata')::date - 1);
begin
  /* Gated here as well as inside erp_usability_report, because the two day-level CTEs below read
     erp_usage_events directly and would otherwise be reachable without passing that gate. */
  if not (app.is_superadmin()
          or exists(select 1 from adm.users u
                     where u.email = app.current_user_email()
                       and u.active
                       and 'usability' = any(coalesce(u.modules,'{}')))) then
    raise exception 'Usability is limited to the Systems department';
  end if;

  return query
  with base as (
    /* The same thirty-day window the page has always opened on, and the same band formula, because
       it is literally the same function. */
    select r.* from public.erp_usability_report(v_today - 29, v_today) r where r.daily_check
  ),
  dd as (
    select e.feature_key,
           count(*) filter (where (e.occurred_at at time zone 'Asia/Kolkata')::date = v_today) as t_uses,
           count(distinct lower(e.user_email))
             filter (where (e.occurred_at at time zone 'Asia/Kolkata')::date = v_today)        as t_users,
           count(*) filter (where (e.occurred_at at time zone 'Asia/Kolkata')::date = v_yday)  as y_uses,
           count(distinct lower(e.user_email))
             filter (where (e.occurred_at at time zone 'Asia/Kolkata')::date = v_yday)         as y_users
      from public.erp_usage_events e
     where e.user_email is not null
       and position('@' in e.user_email) > 0
       and (e.occurred_at at time zone 'Asia/Kolkata')::date in (v_today, v_yday)
     group by e.feature_key
  ),
  /* Last used is taken over the whole history rather than over the thirty-day window. Inside the
     window, a feature nobody has touched for six weeks reads as a dash - which is exactly what the
     page shows for a feature that has never been used at all, and on a daily check those are
     opposite findings. */
  ever as (
    select e.feature_key, max(e.occurred_at) as lu
      from public.erp_usage_events e
     where e.user_email is not null
       and position('@' in e.user_email) > 0
     group by e.feature_key
  )
  select b.module_id, b.module_label, b.tab, b.feature, b.feature_key,
         coalesce(d.t_uses,0), coalesce(d.t_users,0),
         coalesce(d.y_uses,0), coalesce(d.y_users,0),
         b.uses, b.users, b.band,
         ev.lu
    from base b
    left join dd   d  on d.feature_key  = b.feature_key
    left join ever ev on ev.feature_key = b.feature_key
    left join public.erp_feature_catalog c on c.feature_key = b.feature_key
   /* The catalogue's own order, so the page reads the way the list was written. */
   order by b.module_label, c.sort;
end;
$function$;
grant execute on function public.erp_usability_daily_feature_checks() to authenticated;

/* ---------------------------------------------------------------- workflow health ------------- */
/* Unchanged except that Raised, Closed and Reverted now come back for today as well as yesterday,
   so the table no longer carries two different days in one row without saying so. Dropped first
   because the returned column list grows, which create or replace cannot do. */
drop function if exists public.erp_usability_workflow_health();
create or replace function public.erp_usability_workflow_health()
 returns table(
   flow_id bigint, workflow text,
   awaiting_receipt bigint, fwd_not_received bigint, in_hand_not_forwarded bigint,
   raised_today bigint, raised_yesterday bigint,
   closed_today bigint, closed_yesterday bigint,
   reverted_today bigint, reverted_yesterday bigint,
   live_instances bigint, completed_total bigint, total_ever bigint)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date;
        v_yday  date := ((now() at time zone 'Asia/Kolkata')::date - 1);
begin
  if not (app.is_superadmin()
          or exists(select 1 from adm.users u
                     where u.email = app.current_user_email()
                       and u.active
                       and 'usability' = any(coalesce(u.modules,'{}')))) then
    raise exception 'Usability is limited to the Systems department';
  end if;

  return query
  with live as (
    select f.id,
      count(distinct c.id) as live_instances,
      count(*) filter (where s.seq = c.current_step
                         and s.appeared_at is not null
                         and s.received_at is null
                         and s.forwarded_at is null)                           as awaiting_receipt,
      count(*) filter (where s.seq = c.current_step
                         and s.appeared_at is not null
                         and s.received_at is null
                         and s.forwarded_at is null
                         and exists (select 1 from acc.flow_case_steps p
                                      where p.case_id = c.id and p.seq < s.seq
                                        and p.forwarded_at is not null))       as fwd_not_received,
      count(*) filter (where s.seq = c.current_step
                         and s.received_at is not null
                         and s.forwarded_at is null)                           as in_hand_not_forwarded
      from acc.flows f
      left join acc.flow_cases c on c.flow_id = f.id and c.status not in ('Done','Cancelled')
      left join acc.flow_case_steps s on s.case_id = c.id
     group by f.id
  ),
  moved as (
    select f.id,
      count(*) filter (where (c.created_at at time zone 'Asia/Kolkata')::date = v_today) as raised_today,
      count(*) filter (where (c.created_at at time zone 'Asia/Kolkata')::date = v_yday)  as raised_yesterday,
      count(*) filter (where c.status = 'Done'
                         and (c.updated_at at time zone 'Asia/Kolkata')::date = v_today) as closed_today,
      count(*) filter (where c.status = 'Done'
                         and (c.updated_at at time zone 'Asia/Kolkata')::date = v_yday)  as closed_yesterday,
      count(*) filter (where c.status = 'Done')                                          as completed_total,
      count(c.id)                                                                        as total_ever
      from acc.flows f
      left join acc.flow_cases c on c.flow_id = f.id
     group by f.id
  ),
  rev as (
    select e.meta ->> 'workflow' as wf,
           count(*) filter (where (e.occurred_at at time zone 'Asia/Kolkata')::date = v_today) as n_today,
           count(*) filter (where (e.occurred_at at time zone 'Asia/Kolkata')::date = v_yday)  as n_yday
      from public.erp_usage_events e
     where e.feature_key in ('tasks.workflow.revert_a_forwarded_step',
                             'tasks.workflow.reject_send_a_step_back')
       and (e.occurred_at at time zone 'Asia/Kolkata')::date in (v_today, v_yday)
       and e.meta ->> 'workflow' is not null
     group by 1
  )
  select f.id, f.name,
         coalesce(l.awaiting_receipt,0), coalesce(l.fwd_not_received,0),
         coalesce(l.in_hand_not_forwarded,0),
         coalesce(m.raised_today,0),  coalesce(m.raised_yesterday,0),
         coalesce(m.closed_today,0),  coalesce(m.closed_yesterday,0),
         coalesce(r.n_today,0),       coalesce(r.n_yday,0),
         coalesce(l.live_instances,0),
         coalesce(m.completed_total,0), coalesce(m.total_ever,0)
    from acc.flows f
    left join live  l on l.id = f.id
    left join moved m on m.id = f.id
    left join rev   r on r.wf = f.name
   order by coalesce(l.awaiting_receipt,0) + coalesce(l.in_hand_not_forwarded,0) desc, f.name;
end;
$function$;
grant execute on function public.erp_usability_workflow_health() to authenticated;

/* ---------------------------------------------------------------- transcription health -------- */
/* Identical arithmetic; one column added. last_run is the moment the overnight pass last wrote a
   row, which is the only live fact there is about a block that is graded overnight. Taken as the
   later of the two tables it writes, because a run that transcribed calls but fell over before
   grading them should report the time it actually stopped, not the time it started. */
drop function if exists public.erp_usability_transcription_health();
create or replace function public.erp_usability_transcription_health()
 returns table(
   metric text, label text,
   today numeric, yesterday numeric,
   today_of numeric, yesterday_of numeric,
   is_pct boolean, higher_is_better boolean, detail text,
   last_run timestamptz)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date;
        v_yday  date := ((now() at time zone 'Asia/Kolkata')::date - 1);
        v_run   timestamptz;
begin
  if not (app.is_superadmin()
          or exists(select 1 from adm.users u
                     where u.email = app.current_user_email()
                       and u.active
                       and 'usability' = any(coalesce(u.modules,'{}')))) then
    raise exception 'Usability is limited to the Systems department';
  end if;

  select greatest(coalesce((select max(ct.created_at) from acc.call_transcripts ct), 'epoch'::timestamptz),
                  coalesce((select max(fq.created_at) from acc.followup_qa      fq), 'epoch'::timestamptz))
    into v_run;
  if v_run = 'epoch'::timestamptz then v_run := null; end if;

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
         v.is_pct, v.higher_is_better, v.detail, v_run
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
grant execute on function public.erp_usability_transcription_health() to authenticated;
