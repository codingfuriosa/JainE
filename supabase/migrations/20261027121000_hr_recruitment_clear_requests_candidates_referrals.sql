/* HR & Recruitment: clear out the Hiring Requests, Candidates & Interviews, and Referrals.

   Asked for on 27 Oct 2026: start these three parts of HR & Recruitment empty. Everything else is
   kept - Job Descriptions (their link to a deleted request simply becomes empty), the test papers
   and their questions, staff previews of tests, hiring sources, recruiters (hr.entities) and the
   tracker stage list.

   What goes:
     hr.manpower_requests (Hiring Requests) and the monthly hr.tracker_rows made for them
     hr.candidates, hr.interview_tracker, hr.interviews, hr.applications (Careers page), hr.resumes
     hr.referrals
     recruit.test_attempts sat by candidates (their answers go with them); previews stay

   No Accountability tasks pointed at any of these when this was written (checked), so none are lost.
   The CV files themselves stay in S3; only the database rows go.

   A copy of every deleted row is kept in hr.*_bak_20261027 tables, so this can be undone. They can
   be dropped once nobody needs them. */

create table if not exists hr.manpower_requests_bak_20261027 as select * from hr.manpower_requests;
create table if not exists hr.tracker_rows_bak_20261027      as select * from hr.tracker_rows;
create table if not exists hr.candidates_bak_20261027        as select * from hr.candidates;
create table if not exists hr.interview_tracker_bak_20261027 as select * from hr.interview_tracker;
create table if not exists hr.interviews_bak_20261027        as select * from hr.interviews;
create table if not exists hr.applications_bak_20261027      as select * from hr.applications;
create table if not exists hr.resumes_bak_20261027           as select * from hr.resumes;
create table if not exists hr.referrals_bak_20261027         as select * from hr.referrals;
create table if not exists hr.test_attempts_bak_20261027     as select * from recruit.test_attempts where candidate_id is not null;
create table if not exists hr.test_answers_bak_20261027      as
  select a.* from recruit.test_answers a join recruit.test_attempts t on t.id = a.attempt_id where t.candidate_id is not null;

-- Nobody but the database owner reads the copies.
do $b$
declare t text;
begin
  foreach t in array array['manpower_requests','tracker_rows','candidates','interview_tracker','interviews',
                           'applications','resumes','referrals','test_attempts','test_answers'] loop
    execute format('alter table hr.%I enable row level security', t||'_bak_20261027');
    execute format('revoke all on hr.%I from public, anon, authenticated', t||'_bak_20261027');
  end loop;
end $b$;

-- Candidates' test attempts (answers cascade).
delete from recruit.test_attempts where candidate_id is not null;

-- Referrals first: they reference candidates and resumes without ON DELETE.
delete from hr.referrals;
delete from hr.interviews;
delete from hr.applications;
delete from hr.interview_tracker;
delete from hr.candidates;
delete from hr.resumes;
-- carried_from_row_id points tracker rows at each other; one statement removes them all together.
delete from hr.tracker_rows;
delete from hr.manpower_requests;
