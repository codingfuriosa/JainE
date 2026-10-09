-- A POSITION IS LIVE ONCE IT HAS A WRITTEN JOB DESCRIPTION, NOT ONCE SOMEBODY TICKS "APPROVED".
--
-- Until now a requisition had to be approved before its careers page would answer, before a CV
-- could be filed against it and before it appeared in the position pickers. In practice the
-- approval tick said nothing the description did not already say: the description is what is
-- published, it is written deliberately, it lands in the Descriptions library the moment it
-- exists, and the careers link is built from it. A position with no description has nothing to
-- show a visitor anyway, so "has a description" is both the honest gate and the safer one.
--
-- Closing hiring (status <> 'Open') is still what takes a page down, and is unchanged.
--
-- Nothing currently published changes: the only live requisition is both approved and described.

create or replace function hr.public_position(p_slug text)
returns table(slug text, job_title text, department text, location text, vacancies text,
              experience text, qualification text, summary text,
              responsibilities jsonb, qualifications jsonb)
language sql
stable
security definer
set search_path to 'hr','public'
as $function$
  select m.slug, m.job_title, m.department, m.location, m.no_of_vacancy,
         m.experience, m.qualification,
         m.ai_job_description_json->>'job_summary',
         m.ai_job_description_json->'responsibilities',
         m.ai_job_description_json->'qualifications'
    from hr.manpower_requests m
   where m.slug = p_slug
     and m.ai_job_description_json is not null
     and m.status = 'Open';
$function$;

create or replace function hr.public_positions()
returns table(slug text, job_title text, department text, location text, vacancies text,
              experience text)
language sql
stable
security definer
set search_path to 'hr','public'
as $function$
  select m.slug, m.job_title, m.department, m.location, m.no_of_vacancy, m.experience
    from hr.manpower_requests m
   where m.ai_job_description_json is not null
     and m.status = 'Open'
     and coalesce(m.slug,'') <> ''
   order by m.approved_at desc nulls last, m.job_title;
$function$;

-- The in-portal position pickers (CV upload, Add Candidate, Connect Referral) follow the same
-- rule, so "which positions exist" has one answer everywhere.
create or replace function hr.open_positions()
returns table(manpower_id bigint, job_title text, department text, location text)
language sql
stable
security definer
set search_path to 'hr','public'
as $function$
  select m.id, m.job_title, m.department, m.location
    from hr.manpower_requests m
   where m.status = 'Open'
     and m.ai_job_description_json is not null
   order by m.job_title;
$function$;
