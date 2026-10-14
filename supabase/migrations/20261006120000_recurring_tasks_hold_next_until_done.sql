-- Recurring tasks, reworked.
--
--   * Fortnightly is a new frequency: one weekday, every other week counted from the anchor
--     (the first due date, which the picker always places on that weekday).
--   * The next task in a series is created ON ITS DAY, and only if the current one is complete.
--     Completing early parks the next date in acc.ptask_recur_pending; acc.recur_tick() creates
--     it when the day comes. Completing late (the next date has already arrived) creates it there
--     and then, already overdue.
--   * While the current one is still open on the next date, no new task is made; instead
--     due_email_batch() returns a 'recur_missed' row so overdue-mailer reminds everyone on it.
--     recur_reminded_for remembers which occurrence was reminded about, so it goes once per date.
--   * Recurring tasks do not count on the Scoreboard.

alter table acc.ptasks add column if not exists recur_reminded_for date;

create table if not exists acc.ptask_recur_pending (
  task_id    bigint primary key references acc.ptasks(id) on delete cascade,
  due_date   date not null,
  created_at timestamptz not null default now()
);
-- Only the security-definer functions below touch it.
alter table acc.ptask_recur_pending enable row level security;

create or replace function acc.ist_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- ── the rule ──────────────────────────────────────────────────────────────────────────────
create or replace function acc.recur_matches(p_rule jsonb, p_d date, p_anchor date)
 returns boolean
 language plpgsql
 immutable
as $function$
declare
  v_freq text := p_rule->>'freq';
  v_wd   jsonb;
  v_mons int;
begin
  if p_rule is null or p_d is null then return false; end if;

  if v_freq = 'daily' then
    return true;

  elsif v_freq in ('weekly','fortnightly') then
    v_wd := p_rule->'weekdays';
    if v_wd is null or jsonb_typeof(v_wd) <> 'array' then return false; end if;
    if not exists (
      select 1 from jsonb_array_elements(v_wd) e
      where (e #>> '{}')::int = extract(dow from p_d)::int
    ) then return false; end if;
    if v_freq = 'fortnightly' and p_anchor is not null then
      -- every other week from the anchor
      return (((p_d - p_anchor) % 14) + 14) % 14 = 0;
    end if;
    return true;

  elsif v_freq in ('monthly','quarterly') then
    if v_freq = 'quarterly' then
      -- Every third month counted from the anchor's month, so Jan/Apr/Jul/Oct rather than any month.
      v_mons := (extract(year from p_d)::int * 12 + extract(month from p_d)::int)
              - (extract(year from coalesce(p_anchor,p_d))::int * 12
                 + extract(month from coalesce(p_anchor,p_d))::int);
      if v_mons % 3 <> 0 then return false; end if;
    end if;
    return extract(day from p_d)::int = any(
      acc.recur_days_for_month(p_rule, extract(year from p_d)::int, extract(month from p_d)::int));

  elsif v_freq = 'yearly' then
    return extract(day from p_d)::int = any(
      acc.recur_days_for_month(p_rule, extract(year from p_d)::int, extract(month from p_d)::int));
  end if;

  return false;
end;
$function$;

-- ── creating the next one ─────────────────────────────────────────────────────────────────
create or replace function acc.ptask_spawn(p_src bigint, p_due date)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'acc', 'public', 'pg_temp'
as $function$
declare
  s     acc.ptasks;
  v_new bigint;
begin
  select * into s from acc.ptasks where id = p_src;
  if not found then return null; end if;

  insert into acc.ptasks
    (project_id, title, description, delegator, due_date, parent_task_id, order_index,
     created_by, recur, recur_anchor)
  values
    (s.project_id, s.title, s.description, s.delegator, p_due, s.parent_task_id, 0,
     s.created_by, s.recur, coalesce(s.recur_anchor, s.due_date))
  returning id into v_new;

  insert into acc.ptask_assignees (task_id, email)
    select v_new, a.email from acc.ptask_assignees a where a.task_id = s.id;

  insert into acc.ptask_activity (task_id, action, detail)
    values (v_new, 'created', 'Created automatically — repeats from task #' || s.id);

  return v_new;
end;
$function$;

create or replace function acc.ptask_spawn_next()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'acc', 'public', 'pg_temp'
as $function$
declare
  v_next date;
begin
  if new.approval_state is distinct from 'approved'
     or coalesce(old.approval_state,'') = 'approved'
     or new.recur is null
     or new.due_date is null then
    return new;
  end if;

  v_next := acc.recur_next(new.recur, new.due_date, coalesce(new.recur_anchor, new.due_date));
  if v_next is null then
    return new;   -- the series has run out
  end if;

  if v_next <= acc.ist_today() then
    -- Completed on or after the next date: that one is due already, so it is made now (overdue
    -- if its day has passed).
    perform acc.ptask_spawn(new.id, v_next);
    delete from acc.ptask_recur_pending where task_id = new.id;
  else
    -- Completed early: the next one waits for its day.
    insert into acc.ptask_recur_pending (task_id, due_date) values (new.id, v_next)
      on conflict (task_id) do update set due_date = excluded.due_date, created_at = now();
  end if;

  return new;
end;
$function$;

-- Runs just after midnight IST: makes every parked next task whose day has come.
create or replace function acc.recur_tick()
 returns integer
 language plpgsql
 security definer
 set search_path to 'acc', 'public', 'pg_temp'
as $function$
declare
  r record;
  n int := 0;
begin
  -- A task reopened after it was completed no longer releases its next one.
  delete from acc.ptask_recur_pending q
   using acc.ptasks p
   where p.id = q.task_id and p.approval_state is distinct from 'approved';

  for r in
    select q.task_id, q.due_date from acc.ptask_recur_pending q
    where q.due_date <= acc.ist_today()
    order by q.due_date, q.task_id
  loop
    perform acc.ptask_spawn(r.task_id, r.due_date);
    delete from acc.ptask_recur_pending where task_id = r.task_id;
    n := n + 1;
  end loop;
  return n;
end;
$function$;

-- ── the reminder when the current one is still open on the next date ─────────────────────
-- The occurrence after the later of the due date and the last reminder, if it has arrived.
create or replace function acc.recur_missed_date(p_task acc.ptasks)
 returns date
 language sql
 stable
as $$
  select d from (
    select acc.recur_next(p_task.recur,
                          greatest(p_task.due_date, coalesce(p_task.recur_reminded_for, p_task.due_date)),
                          coalesce(p_task.recur_anchor, p_task.due_date)) as d
  ) x
  where d is not null and d <= acc.ist_today();
$$;

create or replace function public.due_email_batch()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'acc', 'public'
as $function$
declare res jsonb;
begin
  select coalesce(jsonb_agg(x),'[]'::jsonb) into res from (
    select jsonb_build_object(
      'id', p.id,
      'title', p.title,
      'due_date', p.due_date,
      'kind', case when p.due_date < current_date then 'overdue' else 'due' end,
      'overdue', (p.due_date < current_date),
      'members', (select coalesce(jsonb_agg(a.email),'[]'::jsonb) from acc.ptask_assignees a where a.task_id=p.id)
    ) as x
    from acc.ptasks p
    where p.approval_state <> 'approved' and p.due_date is not null
      and ( (p.due_date = current_date and coalesce(p.due_emailed,false) = false)
         or (p.due_date <  current_date and coalesce(p.overdue_emailed,false) = false) )
      and not exists (
        select 1 from acc.flow_case_steps fcs
        where fcs.id = p.flow_case_step_id and fcs.forwarded_at is not null
      )
    union all
    select jsonb_build_object(
      'id', p.id,
      'title', p.title,
      'due_date', p.due_date,
      'kind', 'recur_missed',
      'overdue', true,
      'next_date', acc.recur_missed_date(p),
      'members', (select coalesce(jsonb_agg(a.email),'[]'::jsonb) from acc.ptask_assignees a where a.task_id=p.id)
    )
    from acc.ptasks p
    where p.approval_state <> 'approved' and p.due_date is not null and p.recur is not null
      and p.flow_case_step_id is null
      and acc.recur_missed_date(p) is not null
  ) q;
  return res;
end $function$;

create or replace function public.mark_task_emailed(p_id bigint, p_kind text)
 returns void
 language sql
 security definer
 set search_path to 'acc', 'public'
as $function$
  update acc.ptasks p set
    due_emailed        = case when p_kind='due'     then true else p.due_emailed end,
    overdue_emailed    = case when p_kind='overdue' then true else p.overdue_emailed end,
    recur_reminded_for = case when p_kind='recur_missed'
                              then coalesce(acc.recur_missed_date(p), p.recur_reminded_for)
                              else p.recur_reminded_for end
  where p.id=p_id;
$function$;

-- ── Scoreboard: recurring tasks do not score ─────────────────────────────────────────────
create or replace function acc.scoreboard()
 returns table(email text, full_name text, checklist_items_done bigint, tasks_completed bigint, tasks_on_time bigint, tasks_late bigint, tasks_self bigint, due_date_extensions bigint)
 language sql
 stable security definer
 set search_path to ''
as $function$
  with completed as (
    select t.id, t.due_date, t.completed_at, a.email,
           (lower(a.email) = lower(coalesce(t.created_by,''))) as is_self
    from acc.ptasks t
    join acc.ptask_assignees a on a.task_id = t.id
    where t.approval_state = 'approved'
      and acc.is_fully_approved(t.id)
      and t.flow_case_step_id is null          -- ordinary tasks only
      and t.recur is null                      -- recurring tasks do not score
  ),
  task_stats as (
    select email,
      count(*) filter (where not is_self) as tasks_completed,
      -- A due date that was actually met. No due date is no longer a way of meeting one.
      count(*) filter (where not is_self
        and due_date is not null
        and completed_at is not null
        and completed_at::date <= due_date
      ) as tasks_on_time,
      count(*) filter (where not is_self
        and due_date is not null
        and completed_at is not null
        and completed_at::date > due_date
      ) as tasks_late,
      count(*) filter (where is_self) as tasks_self
    from completed group by email
  ),
  checklist_stats as (
    select unnest(coalesce(s.people, array[]::text[])) as email, count(*) as checklist_items_done
    from acc.ptask_subtasks s
    join acc.ptasks t on t.id = s.task_id
    where s.done and t.recur is null
    group by 1
  ),
  people as (
    select email, full_name from adm.users where active is true
  )
  select p.email,
    coalesce(up.full_name, p.full_name) as full_name,
    coalesce(cs.checklist_items_done,0) as checklist_items_done,
    coalesce(ts.tasks_completed,0) as tasks_completed,
    coalesce(ts.tasks_on_time,0) as tasks_on_time,
    coalesce(ts.tasks_late,0) as tasks_late,
    coalesce(ts.tasks_self,0) as tasks_self,
    0::bigint as due_date_extensions
  from people p
  left join acc.user_profile up on up.email = p.email
  left join task_stats ts on ts.email = p.email
  left join checklist_stats cs on cs.email = p.email
  where p.email is not null
  order by tasks_completed desc, checklist_items_done desc;
$function$;

-- 18:31 UTC = 00:01 IST, so a parked task appears at the start of its day, before the 09:00 IST
-- due/overdue mail.
select cron.unschedule(jobid) from cron.job where jobname = 'recur-tick-daily';
select cron.schedule('recur-tick-daily', '31 18 * * *', 'select acc.recur_tick();');
