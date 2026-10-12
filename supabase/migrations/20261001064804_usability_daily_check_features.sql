/* Daily checks: the handful of features that are looked at EVERY morning, pinned to the top of
   their module in the Usability report instead of being hunted for among the rest.

   WHY A FLAG AND NOT A sort NUMBER.
   The report orders by erp_feature_catalog.sort, which is a single global sequence shared by all
   268 features. Pulling ten of them to the top by editing sort would mean renumbering around them,
   and the next person to insert a feature would quietly undo it. A flag says what is actually true
   — "this one is on the daily list" — and survives any amount of renumbering.

   WHICH TEN, AND WHY ONLY TEN.
   The daily list covers twenty things. Only these ten are USAGE events — "did somebody do this
   today" — which is the only kind of question this report answers. The other ten are questions
   about the state of the data ("open more than 10 days", "stuck more than 2 days", "pitch
   accuracy"), and no amount of usage logging produces them; they are queries against acc.ptasks,
   acc.flow_case_steps and acc.followup_qa. Flagging them here would promise an answer this report
   cannot give.

   Transcription therefore gets no flags at all: all five of its daily items are QA measurements,
   not clicks.

   NOT FLAGGED BUT ON THE LIST: "update causelist review" has no feature_key, because the Causelist
   Reviews tab was built without usage logging. It is countable from public.mis_causelist_review_log
   but will not appear in this report until the tab is instrumented.

   The report's return type gains a column, which create-or-replace cannot do in place. */
alter table public.erp_feature_catalog
  add column if not exists daily_check boolean not null default false;

comment on column public.erp_feature_catalog.daily_check is
  'Pinned to the top of its module in the Usability report as a once-a-day check.';

update public.erp_feature_catalog set daily_check = false where daily_check;

update public.erp_feature_catalog set daily_check = true
 where feature_key in (
   -- Tasks
   'tasks.tasks.create_task',
   'tasks.tasks.mark_task_done_send_for_approval',
   -- Workflow
   'tasks.workflow.receive_a_step',
   'tasks.workflow.forward_a_step',
   'tasks.workflow.mark_final_step_done',
   'tasks.workflow.revert_a_forwarded_step',
   -- Legal
   'legal.documents.upload_document',
   'legal.mis.edit_case',
   'legal.mis.add_case',
   'legal.mis.export_causelist'
 );

drop function if exists public.erp_usability_report(date, date, text, text);

create function public.erp_usability_report(p_from date, p_to date, p_email text DEFAULT NULL::text, p_department text DEFAULT NULL::text)
 returns table(module_id text, module_label text, tab text, feature text, feature_key text,
               uses bigint, users bigint, last_used timestamp with time zone, band text,
               daily_check boolean)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_days numeric;
begin
  -- Unchanged: the numbers are about named people, so the gate stays exactly as it was.
  if not (app.is_superadmin()
          or exists(select 1 from adm.users u
                     where u.email = app.current_user_email()
                       and u.active
                       and 'usability' = any(coalesce(u.modules,'{}')))) then
    raise exception 'Usability is limited to the Systems department';
  end if;

  v_days := greatest((p_to - p_from) + 1, 1);

  return query
  with ev as (
    select e.feature_key,
           count(*)                            as uses,
           count(distinct lower(e.user_email)) as users,
           max(e.occurred_at)                  as last_used
      from public.erp_usage_events e
     where e.user_email is not null
       and position('@' in e.user_email) > 0
       and (e.occurred_at at time zone 'Asia/Kolkata')::date between p_from and p_to
       and (p_email is null or lower(e.user_email) = lower(p_email))
       and (p_department is null or e.department = p_department)
     group by e.feature_key
  )
  select c.module_id, c.module_label, c.tab, c.feature, c.feature_key,
         coalesce(ev.uses, 0)  as uses,
         coalesce(ev.users, 0) as users,
         ev.last_used,
         case
           when coalesce(ev.uses,0) = 0 then 'Inactive'
           when (ev.uses * 30.0 / v_days) <= 5  then 'Less'
           when (ev.uses * 30.0 / v_days) <= 30 then 'Active'
           else 'Very Active'
         end as band,
         c.daily_check
    from public.erp_feature_catalog c
    left join ev on ev.feature_key = c.feature_key
   where c.active
   -- daily checks first within each module, then the catalogue's own order as before
   order by c.module_label, c.daily_check desc, c.sort;
end;
$function$;
