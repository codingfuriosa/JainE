/* Usability: make the feature catalogue and the app agree, in both directions.

   The report is driven by the catalogue - it lists every active catalogue row and fills in the
   counts from the events beside it. That join is the whole reason two silent faults were possible:

     1. Eleven features the app HAS been recording all along are not in the catalogue at all, so
        their uses are counted NOWHERE in the report. They are not zero and they are not wrong -
        they are invisible. Opening a month in the HR Monthly Update (7 uses), approving a
        requisition (3), closing/reopening hiring (1) and generating JD post text (4) have all
        already happened and cannot be seen. The other seven are wired and simply have not been
        used yet - they would have been just as invisible the moment somebody did use them.

     2. Four catalogue rows describe features that no longer exist in the app. H/S Candidates was
        removed outright (VIEWS.hr sends 'hs' to Monthly Update now, see the note there) and the
        Monthly Update tab is fed from the requisitions themselves, so nothing there is created or
        edited by hand any more. They can never record another use, so leaving them active would
        permanently misreport four dead screens as "features nobody touches". Deactivated rather
        than deleted: the events they already carry (79 on add_candidate alone) are real history of
        a screen that really did exist, and the drill-down still resolves the name.

   After this, every feature key the app can emit has exactly one active catalogue row, and every
   active catalogue row has code behind it - so a zero in the report means a zero in real life. */

-- 1. The eleven the app records but the report could not show.
insert into public.erp_feature_catalog(module_id, module_label, tab, feature, feature_key, sort, active) values
('hr','Human Resources','Monthly Update','Open a month','hr.monthly_update.open_a_month',901,true),
('hr','Human Resources','Monthly Update','Search / filter positions','hr.monthly_update.search_filter_positions',902,true),
('hr','Human Resources','Monthly Update','Approve / reject a requisition','hr.monthly_update.approve_reject_requisition',903,true),
('hr','Human Resources','Monthly Update','Close / reopen hiring for a position','hr.monthly_update.close_reopen_hiring',904,true),
('hr','Human Resources','Interview Tracker','Preview / download candidate CV','hr.interview_tracker.preview_download_candidate_cv',905,true),
('hr','Human Resources','Resumes','Search resumes','hr.resumes.search_resumes',906,true),
('recruitment','Recruitment (ATS)','ManPower Form','Generate JD / post text / creative with AI','recruitment.manpower_form.generate_jd_post_text_creative',907,true),
('recruitment','Recruitment (ATS)','ManPower Form','Copy platform post text','recruitment.manpower_form.copy_platform_post_text',908,true),
('recruitment','Recruitment (ATS)','Referrals','Refer someone','recruitment.referrals.refer_someone',909,true),
('recruitment','Recruitment (ATS)','Referrals','Approve / reject a referral','recruitment.referrals.approve_reject_referral',910,true),
('recruitment','Recruitment (ATS)','Referrals','Delete a referral','recruitment.referrals.delete_referral',911,true)
on conflict (feature_key) do update
   set module_id=excluded.module_id, module_label=excluded.module_label, tab=excluded.tab,
       feature=excluded.feature, active=true;

-- 2. The four whose screens the app no longer has.
update public.erp_feature_catalog
   set active = false
 where feature_key in ('hr.h_s_candidates.add_candidate',
                       'hr.h_s_candidates.search_filter_candidates',
                       'hr.monthly_update.create_new_month_record',
                       'hr.monthly_update.edit_tracking_values');
