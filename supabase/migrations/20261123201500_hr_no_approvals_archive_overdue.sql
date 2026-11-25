/* HR & Recruitment simplification - asked for by the user on 23 Nov 2026.

   1. NO JOB-DESCRIPTION APPROVAL. A hiring request is approved the moment it is raised, and a job
      description (AI-written or uploaded) is usable - and published to the Document Library - straight
      away. "If you want to use it, use it; if not, don't." No approval task is raised for either.
   2. NO CANDIDATE APPROVAL. Every candidate is approved on arrival (careers page, CV upload, by hand,
      referral) and no "Approve Candidate" task is raised.
   3. A CANDIDATE CAN BE ADDED WITHOUT A POSITION and given one later; such a person can still be
      interviewed.
   4. REJECTED IS NO LONGER FINAL. From the new Archive tab a rejected candidate can be moved to
      Selected, Hold or Interview Scheduled, which puts them back in Candidates and in Monthly Progress.
   5. OVERDUE INTERVIEWS ARE CHASED. Once an interview's time has passed with no result recorded, the
      people holding it are emailed (by hr-notify, kind interviews_overdue) to record the result or
      reschedule - one hour after the slot, then once a day until it is dealt with.

   Applied by a one-time pg_cron job at 20:15 IST (DDL in office hours stalls the Micro instance). */

-- ---- 1. hiring requests and job descriptions need no approval --------------------------------
create or replace function hr.manpower_auto_approve() returns trigger
language plpgsql security definer set search_path to 'hr', 'public' as $$
begin
  -- Approved on arrival again (23 Nov 2026): the description approval step was removed by request.
  new.approval_status := 'Approved';
  new.approved_by     := coalesce(nullif(btrim(coalesce(new.approved_by,'')),''), nullif(btrim(coalesce(new.raised_by,'')),''), 'auto');
  new.approved_at     := coalesce(new.approved_at, now());
  new.status          := coalesce(nullif(btrim(coalesce(new.status,'')),''), 'Open');
  return new;
end $$;

update hr.manpower_requests
   set approval_status = 'Approved', approved_by = coalesce(approved_by, 'auto'), approved_at = coalesce(approved_at, now()),
       rejection_reason = null
 where coalesce(approval_status,'Pending') <> 'Approved';

create or replace function recruit.job_description_into_library() returns trigger
language plpgsql set search_path to 'recruit', 'public' as $$
begin
  new.in_library := true;
  new.added_at   := coalesce(new.added_at, now());
  new.added_by   := coalesce(new.added_by, new.uploaded_by);
  -- No approval step any more (23 Nov 2026): every description is approved as it lands.
  new.approval_status := 'Approved';
  new.approved_by     := coalesce(new.approved_by, new.uploaded_by, 'auto');
  new.approved_at     := coalesce(new.approved_at, now());
  return new;
end $$;

create or replace function recruit.job_description_approval_task() returns trigger
language plpgsql security definer set search_path to 'recruit', 'public' as $$
begin
  -- Was: raise an "Approve Job Description" task. Approval was removed on 23 Nov 2026, so the
  -- description is published to the Document Library straight away instead.
  begin
    perform recruit.job_description_publish(new.id);
  exception when others then null;   -- the description itself is saved even if the copy fails
  end;
  return new;
end $$;

-- Keep the published copy in step when the text or name changes (approving used to do this).
create or replace function recruit.job_description_republish() returns trigger
language plpgsql security definer set search_path to 'recruit', 'public' as $$
begin
  if new.content_text is distinct from old.content_text or new.name is distinct from old.name
     or new.storage_path is distinct from old.storage_path then
    begin perform recruit.job_description_publish(new.id); exception when others then null; end;
  end if;
  return new;
end $$;
drop trigger if exists job_description_republish_trg on recruit.job_descriptions;
create trigger job_description_republish_trg after update of content_text, name, storage_path
  on recruit.job_descriptions for each row execute function recruit.job_description_republish();

update recruit.job_descriptions
   set approval_status = 'Approved', approved_by = coalesce(approved_by, uploaded_by, 'auto'), approved_at = coalesce(approved_at, now())
 where coalesce(approval_status,'Pending') <> 'Approved';

-- ---- 2. candidates need no approval ----------------------------------------------------------
create or replace function hr.candidate_approval_task() returns trigger
language plpgsql security definer set search_path to 'hr', 'public' as $$
begin
  -- Was: raise an "Approve Candidate" task for everyone but referrals. Removed 23 Nov 2026.
  return new;
end $$;

create or replace function hr.candidate_referral_preapproved() returns trigger
language plpgsql security definer set search_path to 'hr', 'public' as $$
declare v_by text;
begin
  -- Every candidate is approved on arrival (23 Nov 2026). A referral keeps the name of whoever
  -- approved the referral; anybody else is marked approved by whoever added them.
  if coalesce(new.source,'') = 'Referral' then
    select approved_by into v_by from hr.referrals
     where candidate_id = new.id or lower(coalesce(referred_email,'')) = lower(coalesce(new.email,''))
     order by id desc limit 1;
  end if;
  new.approval_status := 'Approved';
  new.approved_by := coalesce(v_by, nullif(lower(coalesce(app.current_user_email(),'')),''), new.created_by, 'auto');
  new.approved_at := coalesce(new.approved_at, now());
  return new;
end $$;

update hr.candidates set approval_status = 'Approved', approved_at = coalesce(approved_at, now())
 where approval_status = 'Pending';

-- No more approval tasks of these kinds (referral approval stays as it is).
create or replace function acc.hr_approval_task_upsert(p_kind text, p_ref_id bigint, p_title text, p_description text)
returns void language plpgsql security definer set search_path to 'acc', 'public' as $$
declare v_approvers text[] := array['mgr.hr@thejaingroup.com','hr@thejaingroup.com','career@thejaingroup.com','ayushruia1@gmail.com'];
        v_email text; v_exists boolean; v_id bigint;
begin
  -- Job-description (manpower) and candidate approvals were removed on 23 Nov 2026.
  if p_kind in ('manpower','candidate') then return; end if;

  select exists(select 1 from acc.ptasks where (p_kind='referral' and referral_id=p_ref_id)) into v_exists;
  if v_exists then
    update acc.ptasks
       set title=p_title, description=p_description, status='Pending', approval_state='awaiting_approval',
           approved_by=null, approved_at=null, completed_at=null, updated_at=now()
     where (p_kind='referral' and referral_id=p_ref_id);
    return;
  end if;
  foreach v_email in array v_approvers loop
    insert into acc.ptasks(title, description, delegator, status, approval_state, referral_id, created_by, created_at)
    values (p_title, p_description, v_email, 'Pending', 'awaiting_approval',
            case when p_kind='referral' then p_ref_id end, 'system', now())
    returning id into v_id;
    insert into acc.ptask_assignees(task_id, email) values (v_id, 'system');
  end loop;
end $$;

-- Close any approval tasks of those kinds still waiting.
delete from acc.ptasks
 where approval_state = 'awaiting_approval' and interview_id is null and referral_id is null
   and (manpower_request_id is not null or candidate_id is not null or job_description_id is not null);

-- ---- 3 + 4. stages: rejected can come back; candidates without a position can be interviewed --
create or replace function hr.candidate_set_stage(p_id bigint, p_stage text) returns void
language plpgsql security definer set search_path to 'hr', 'public' as $$
declare v_seq int; v_stage text;
begin
  select seq into v_seq from hr.tracker_stages where label = p_stage;
  if v_seq is null then raise exception 'Unknown stage %', p_stage; end if;

  select coalesce(stage,'') into v_stage from hr.candidates where id = p_id;
  if not found then raise exception 'That candidate no longer exists'; end if;

  /* REJECTED IS NOT FINAL ANY MORE (23 Nov 2026). From the Archive tab a rejected person can be
     brought back as Selected, Hold or Interview Scheduled - and only those three, which are the
     choices the Archive offers. */
  if v_stage = 'Rejected' and p_stage not in ('Rejected','Selected','Hold','Interview Scheduled') then
    raise exception 'A rejected candidate can only be moved to Selected, Hold or Interview Scheduled (from Archive).';
  end if;

  update hr.candidates
     set stage = p_stage,
         outcome = case when p_stage in ('Selected','Rejected','Hold','Backed Out','Joined') then p_stage
                        when v_stage = 'Rejected' then null else outcome end,
         approval_status = 'Approved',
         max_stage_seq = greatest(max_stage_seq, v_seq),
         updated_at = now()
   where id = p_id;

  update hr.interview_tracker set feedback = p_stage, status = p_stage where candidate_id = p_id;
end $$;

create or replace function hr.interviewable_candidates()
returns table(id bigint, name text, email text, position_title text, stage text, request_id bigint)
language sql stable security definer set search_path to 'hr', 'public' as $$
  select c.id, c.name, c.email, c.position, c.stage, c.manpower_request_id
  from hr.candidates c
  left join hr.manpower_requests m on m.id = c.manpower_request_id
  where (c.manpower_request_id is null or coalesce(m.status,'Open') = 'Open')
    and coalesce(c.stage,'Applied') not in ('Selected','Rejected','Hold','Backed Out','Joined')
  order by c.name;
$$;

-- ---- 5. overdue interviews -----------------------------------------------------------------
alter table hr.interviews add column if not exists overdue_mailed_at timestamptz;

insert into acc.job_secrets (name, value)
values ('hr_notify', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (name) do nothing;

create or replace function hr.pi_kick_overdue() returns bigint
language sql security definer set search_path to '' as $$
  select net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/hr-notify',
    headers := jsonb_build_object('Content-Type','application/json',
      'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n',
      'x-hr-secret',(select value from acc.job_secrets where name='hr_notify')),
    body := '{"kind":"interviews_overdue"}'::jsonb,
    timeout_milliseconds := 60000)
$$;
revoke all on function hr.pi_kick_overdue() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'hr-interviews-overdue';
-- Every hour at :20, office hours and evenings (08:20-21:20 IST = 02:50-15:50 UTC, approx.).
select cron.schedule('hr-interviews-overdue', '20 3-15 * * *', $cron$ select hr.pi_kick_overdue(); $cron$);
