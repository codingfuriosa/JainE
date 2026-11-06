/* HR & Recruitment: delete the test-data copies left by the 19 Sep and 27 Oct resets.

   Approved by the user on 6 Nov 2026 ("Test copies only", and the 27 Oct copies "Delete without
   saving"). Run on the live project by a one-time pg_cron job ('hr-drop-test-copies-once', 20:15 IST
   6 Nov) because DDL in office hours stalls the Micro instance.

   The 25 CV files those rows pointed at were deleted from S3 the same afternoon, through s3-sign from
   a signed-in Administrator session (S3 deletes need a signed-in user), and checked: they now 404.

   KEPT on purpose - real hiring history, exported to Excel for HR the same day
   (exports/HR hiring history (Jun-Sep 2026).xlsx, git-ignored):
     hr.interview_tracker_backup_20260906 (590 interviews), hr.interview_tracker_backup_20260919 (31,
     real people), hr.hs_candidates_backup_20260907, hr.manpower_requests_backup_20260907,
     hr.tracker_rows_backup_20260907, hr.monthly_updates_backup_20260907,
     recruit.test_responses_backup_20260919 (513 answers), recruit.tests_backup_20260919,
     recruit.job_descriptions_backup_20260919, hr.interview_guides_backup_20260919. */

drop table if exists hr.manpower_requests_bak_20261027, hr.tracker_rows_bak_20261027, hr.candidates_bak_20261027,
  hr.interview_tracker_bak_20261027, hr.interviews_bak_20261027, hr.applications_bak_20261027, hr.resumes_bak_20261027,
  hr.referrals_bak_20261027, hr.test_attempts_bak_20261027, hr.test_answers_bak_20261027;
drop table if exists hr.applications_backup_20260919, hr.candidates_backup_20260919, hr.manpower_requests_backup_20260919,
  hr.monthly_updates_backup_20260919, hr.referrals_backup_20260919, hr.resumes_backup_20260919, hr.tracker_rows_backup_20260919,
  recruit.test_answers_backup_20260919, recruit.test_attempts_backup_20260919, recruit.test_questions_backup_20260919;
