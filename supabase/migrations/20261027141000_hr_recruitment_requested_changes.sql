/* HR & Recruitment: the changes asked for on 27 Oct 2026.

   1. A hiring request can be DELETED only while nobody is on it. Editing was already locked
      (hr.manpower_lock_when_candidates); deleting was not, so a request with candidates could be
      removed by whoever raised it. Same rule, same wording, now for both.
   2. hr.request_candidate_counts() - how many candidates each request the caller can see has.
      The person who raised a request cannot read hr.candidates (HR only), so without this the page
      could not tell them their request is locked until the database refused.
   3. REFERRALS ARE PRIVATE TO WHOEVER MADE THEM. Everybody signed in could read every referral;
      now you see your own, and HR / Administrators see all.
   4. INTERVIEW ROWS ARE HR'S TO CHANGE. Any member of staff could insert, update or delete
      hr.interview_tracker directly; only the screen stopped them. Reading is unchanged.
   5. HOLD IS AN INTERVIEW VERDICT. The Interview task offers Selected, Hold and Rejected.
   6. JOB DESCRIPTIONS REACH THE LIBRARY ON THEIR OWN, and stay in step with the hiring request:
      every new description is in the Job Descriptions tab from the moment it exists, and an edit
      on either side (the request's editor or the library's) shows on the other.
   7. THE MONTH ROLLS OVER BY ITSELF. hr.roll_forward_month() opens the current month: every open,
      not-completed position whose latest month has no approved candidate is carried into it;
      a position that already has at least one approved candidate stays in the month it is in.
      Run daily (it is idempotent), so a missed run catches up the next day.
      hr.tracker_row_for_request() now puts a new candidate on the position's LATEST row, so
      people who arrive after a carry-forward land in the month the position now lives in.

   Safe to run twice. */

-- ---------------------------------------------------------------------------------------------
-- 1. No deleting a request that has candidates.
-- ---------------------------------------------------------------------------------------------
create or replace function hr.manpower_no_delete_when_candidates()
 returns trigger language plpgsql security definer set search_path to 'hr', 'public'
as $function$
declare n integer;
begin
  select count(*) into n from hr.candidates c
   where c.manpower_request_id = old.id
      or (c.manpower_request_id is null
          and lower(btrim(coalesce(c.position,''))) = lower(btrim(coalesce(old.job_title,'')))
          and btrim(coalesce(old.job_title,'')) <> '');
  if n > 0 then
    raise exception
      'This position cannot be deleted any more - % candidate(s) are already on it. Close hiring instead.', n
      using errcode = 'check_violation';
  end if;
  return old;
end $function$;

drop trigger if exists manpower_no_delete_when_candidates on hr.manpower_requests;
create trigger manpower_no_delete_when_candidates before delete on hr.manpower_requests
  for each row execute function hr.manpower_no_delete_when_candidates();

-- ---------------------------------------------------------------------------------------------
-- 2. Candidate counts per request, for whoever may see the request.
-- ---------------------------------------------------------------------------------------------
create or replace function hr.request_candidate_counts()
 returns table(manpower_request_id bigint, n integer)
 language sql stable security definer set search_path to 'hr', 'public'
as $function$
  select m.id, count(c.id)::int
    from hr.manpower_requests m
    left join hr.candidates c
      on c.manpower_request_id = m.id
      or (c.manpower_request_id is null
          and lower(btrim(coalesce(c.position,''))) = lower(btrim(coalesce(m.job_title,'')))
          and btrim(coalesce(m.job_title,'')) <> '')
   where hr.is_hr_or_admin(app.current_user_email())
      or coalesce(app.is_superadmin(), false)
      or lower(coalesce(m.raised_by,'')) = lower(coalesce(app.current_user_email(),'|none|'))
   group by m.id;
$function$;
revoke all on function hr.request_candidate_counts() from public, anon;
grant execute on function hr.request_candidate_counts() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Your own referrals only (HR and Administrators see all).
-- ---------------------------------------------------------------------------------------------
drop policy if exists referrals_signed_in_read on hr.referrals;
drop policy if exists referrals_own_or_hr_read on hr.referrals;
create policy referrals_own_or_hr_read on hr.referrals for select using (
  lower(coalesce(referred_by,'')) = lower(coalesce((select app.current_user_email()),'|none|'))
  or hr.is_hr_or_admin((select app.current_user_email()))
  or coalesce((select app.is_superadmin()), false)
);

-- ---------------------------------------------------------------------------------------------
-- 4. Interview rows: everyone on staff may read, only HR may change.
-- ---------------------------------------------------------------------------------------------
drop policy if exists it_write  on hr.interview_tracker;
drop policy if exists it_update on hr.interview_tracker;
drop policy if exists it_delete on hr.interview_tracker;
create policy it_write on hr.interview_tracker for insert with check (
  hr.is_hr_or_admin((select app.current_user_email())) or coalesce((select app.is_superadmin()), false));
create policy it_update on hr.interview_tracker for update
  using (hr.is_hr_or_admin((select app.current_user_email())) or coalesce((select app.is_superadmin()), false))
  with check (hr.is_hr_or_admin((select app.current_user_email())) or coalesce((select app.is_superadmin()), false));
create policy it_delete on hr.interview_tracker for delete using (
  hr.is_hr_or_admin((select app.current_user_email())) or coalesce((select app.is_superadmin()), false));

-- ---------------------------------------------------------------------------------------------
-- 5. Hold is an interview verdict.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hr.interview_decide(p_interview_id bigint, p_decision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hr', 'public'
AS $function$
declare
  v_i  hr.interviews;
  v_me text := lower(coalesce(app.current_user_email(),''));
begin
  if p_decision not in ('Selected','Hold','Rejected') then
    raise exception 'An interview is recorded as Selected, Hold or Rejected';
  end if;

  -- locked, so two holders answering together cannot both win
  select * into v_i from hr.interviews where id = p_interview_id for update;
  if v_i.id is null then raise exception 'That interview no longer exists'; end if;

  if not (v_me = any(v_i.holders) or coalesce(app.is_superadmin(),false)) then
    raise exception 'Only the people holding this interview can record its outcome';
  end if;

  if v_i.decision is not null then
    return jsonb_build_object('ok', false, 'already', true,
      'decision', v_i.decision, 'by', v_i.decided_by);
  end if;

  update hr.interviews
     set decision = p_decision, decided_by = v_me, decided_at = now()
   where id = p_interview_id;

  perform hr.candidate_set_stage(v_i.candidate_id, p_decision);

  /* Everybody else's copy goes. Left open they would ask for an answer that can no longer be
     given; left Completed they would file one question per holder into the Archive. */
  delete from acc.ptasks where interview_id = p_interview_id;

  return jsonb_build_object('ok', true, 'decision', p_decision, 'candidate_id', v_i.candidate_id);
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- 6. Job descriptions: in the library from birth, and one text on both sides.
-- ---------------------------------------------------------------------------------------------
create or replace function recruit.job_description_into_library()
 returns trigger language plpgsql set search_path to 'recruit', 'public'
as $function$
begin
  new.in_library := true;
  new.added_at   := coalesce(new.added_at, now());
  new.added_by   := coalesce(new.added_by, new.uploaded_by);
  return new;
end $function$;
drop trigger if exists job_description_into_library on recruit.job_descriptions;
create trigger job_description_into_library before insert on recruit.job_descriptions
  for each row execute function recruit.job_description_into_library();

-- library edit -> the hiring request's own copy
create or replace function recruit.job_description_sync_to_request()
 returns trigger language plpgsql security definer set search_path to 'recruit', 'hr', 'public'
as $function$
begin
  if new.manpower_request_id is not null
     and new.content_text is distinct from old.content_text then
    update hr.manpower_requests
       set ai_job_description = new.content_text
     where id = new.manpower_request_id
       and ai_job_description is distinct from new.content_text;
  end if;
  return new;
end $function$;
drop trigger if exists job_description_sync_to_request on recruit.job_descriptions;
create trigger job_description_sync_to_request after update of content_text on recruit.job_descriptions
  for each row execute function recruit.job_description_sync_to_request();

-- hiring request edit -> the library copy
create or replace function hr.request_jd_sync_to_library()
 returns trigger language plpgsql security definer set search_path to 'hr', 'recruit', 'public'
as $function$
begin
  if new.ai_job_description is distinct from old.ai_job_description
     and new.ai_job_description is not null then
    update recruit.job_descriptions
       set content_text = new.ai_job_description
     where manpower_request_id = new.id
       and content_text is distinct from new.ai_job_description;
  end if;
  return new;
end $function$;
drop trigger if exists request_jd_sync_to_library on hr.manpower_requests;
create trigger request_jd_sync_to_library after update of ai_job_description on hr.manpower_requests
  for each row execute function hr.request_jd_sync_to_library();

-- descriptions already written for a hiring request that never reached the library
update recruit.job_descriptions
   set in_library = true, added_at = coalesce(added_at, now())
 where in_library = false and manpower_request_id is not null;

-- ---------------------------------------------------------------------------------------------
-- 7. The month rolls over by itself.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hr.tracker_row_for_request(p_req_id bigint, p_month date DEFAULT NULL::date)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hr', 'public'
AS $function$
declare v_req hr.manpower_requests; v_month date; v_id bigint;
begin
  select * into v_req from hr.manpower_requests where id=p_req_id;
  if not found then return null; end if;

  /* No month asked for: the position's own latest row, which is where it lives now - carried into
     this month, or left in the month where it already has approved people. Only a position with no
     row at all gets a new one, in the current month. */
  if p_month is null then
    select id into v_id from hr.tracker_rows
     where manpower_request_id = p_req_id
     order by month desc, id desc limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  v_month := date_trunc('month',
               coalesce(p_month, (now() at time zone 'Asia/Kolkata')::date))::date;
  insert into hr.tracker_rows(month, manpower_request_id, position)
  values (v_month, p_req_id, coalesce(nullif(btrim(v_req.job_title),''),'(no title)'))
  on conflict (month, manpower_request_id) do update set position=excluded.position
  returning id into v_id;
  return v_id;
end; $function$;

create or replace function hr.roll_forward_month(p_month date default null)
 returns integer language plpgsql security definer set search_path to 'hr', 'public'
as $function$
declare
  v_month date := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Kolkata')::date))::date;
  r record; n integer := 0;
begin
  for r in
    select m.id as req_id, coalesce(nullif(btrim(m.job_title),''),'(no title)') as title,
           last.id as last_row, last.month as last_month, last.completed_at
      from hr.manpower_requests m
      left join lateral (
        select t.* from hr.tracker_rows t
         where t.manpower_request_id = m.id
         order by t.month desc, t.id desc limit 1
      ) last on true
     where coalesce(m.status,'Open') = 'Open'
  loop
    -- already in this month (or later), finished, or staying where its approved people are
    continue when r.last_month is not null and r.last_month >= v_month;
    continue when r.completed_at is not null;
    continue when r.last_row is not null and exists(
      select 1 from hr.candidates c
       where c.tracker_row_id = r.last_row
         and coalesce(c.approval_status,'Approved') = 'Approved');

    insert into hr.tracker_rows(month, manpower_request_id, position, carried_from_row_id)
    values (v_month, r.req_id, r.title, r.last_row)
    on conflict (month, manpower_request_id) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $function$;
revoke all on function hr.roll_forward_month(date) from public, anon;
grant execute on function hr.roll_forward_month(date) to authenticated, service_role;

-- 00:10 IST every day; only the first run of a month actually carries anything.
select cron.unschedule('hr-month-rollover') where exists (select 1 from cron.job where jobname = 'hr-month-rollover');
select cron.schedule('hr-month-rollover', '40 18 * * *', $cron$ select hr.roll_forward_month(); $cron$);
