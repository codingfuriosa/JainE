-- Deleting a candidate now deletes their test results with them.
--
-- recruit.test_attempts carries candidate_id, but there is no foreign key anywhere on
-- hr.candidates, so nothing was removing them: the candidate went and their papers stayed, with
-- a candidate_id pointing at a row that no longer existed. They would surface in the results
-- list of whatever test they sat, named by an email with no record behind it.
--
-- Deleted by candidate_id, and by email ONLY when no candidate with that address survives. One
-- person can hold two candidate records - two positions, same address - and deleting one of
-- them must not take the other's results. Both cases were tested in a rolled-back transaction
-- before this shipped. candidate_delete() routes through this function, so both paths are
-- covered by the one change.

create or replace function hr.candidate_purge(p_candidate_ids bigint[])
 returns table(storage_path text)
 language plpgsql
 security definer
 set search_path to 'hr', 'public'
as $function$
declare v_resume bigint[]; v_tracker bigint[]; v_ref_resume bigint[]; v_emails text[];
begin
  if p_candidate_ids is null or array_length(p_candidate_ids,1) is null then
    return;
  end if;

  select coalesce(array_agg(distinct c.resume_id) filter (where c.resume_id is not null), '{}'),
         coalesce(array_agg(distinct c.tracker_id) filter (where c.tracker_id is not null), '{}'),
         coalesce(array_agg(distinct lower(btrim(c.email))) filter (where nullif(btrim(c.email),'') is not null), '{}')
    into v_resume, v_tracker, v_emails
    from hr.candidates c where c.id = any(p_candidate_ids);

  -- A referral also carries its own CV link and its own approval task, so both are cleared before
  -- the row goes; the FK from referrals is what used to block the whole delete.
  delete from acc.ptasks
   where referral_id in (select r.id from hr.referrals r
                          where r.candidate_id = any(p_candidate_ids)
                             or r.tracker_id   = any(v_tracker));

  select coalesce(array_agg(distinct r.resume_id) filter (where r.resume_id is not null), '{}')
    into v_ref_resume
    from hr.referrals r
   where r.candidate_id = any(p_candidate_ids) or r.tracker_id = any(v_tracker);
  v_resume := v_resume || v_ref_resume;

  delete from hr.referrals
   where candidate_id = any(p_candidate_ids) or tracker_id = any(v_tracker);

  -- The candidate's own approval task goes with them, or it sits in Accountability asking about
  -- somebody who no longer exists.
  delete from acc.ptasks where candidate_id = any(p_candidate_ids);

  /* THE PAPERS GO WITH THE PERSON. Answers first - they hang off the attempt. */
  delete from recruit.test_answers ta
   where ta.attempt_id in (
     select a.id from recruit.test_attempts a
      where a.candidate_id = any(p_candidate_ids)
         or (a.candidate_id is null
             and lower(btrim(coalesce(a.candidate_email,''))) = any(v_emails)
             and not exists (select 1 from hr.candidates c2
                              where lower(btrim(coalesce(c2.email,''))) = lower(btrim(a.candidate_email))
                                and not (c2.id = any(p_candidate_ids)))));

  delete from recruit.test_attempts a
   where a.candidate_id = any(p_candidate_ids)
      or (a.candidate_id is null
          and lower(btrim(coalesce(a.candidate_email,''))) = any(v_emails)
          and not exists (select 1 from hr.candidates c2
                           where lower(btrim(coalesce(c2.email,''))) = lower(btrim(a.candidate_email))
                             and not (c2.id = any(p_candidate_ids))));

  delete from hr.candidates where id = any(p_candidate_ids);
  delete from hr.interview_tracker where id = any(v_tracker);

  return query
    delete from hr.resumes r
     where r.id = any(v_resume)
       and not exists (select 1 from hr.candidates c where c.resume_id = r.id)
       and not exists (select 1 from hr.referrals f where f.resume_id = r.id)
    returning r.storage_path;
end $function$;
