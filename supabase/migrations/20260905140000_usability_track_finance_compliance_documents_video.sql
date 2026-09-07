-- Finance Vault, Renewals & Compliance, Document Library and Video Library were switched on for
-- usage tracking (erp_modules.is_tracked=true) but had zero rows in erp_feature_catalog, so the
-- Usability report showed them as blank no matter how much they were actually used.
--
-- Finance Vault (VIEWS.finance) and most of Renewals & Compliance (VIEWS.compliance) turned out to
-- be entirely static, hardcoded display — no fetch, no tabs driving real data, no wired-up buttons
-- of any kind (mHead/mKpis/mTable render fixed sample figures). The only genuine, distinguishable
-- action a user can take in either is opening the page/tab itself, so both are covered with
-- USAGE_VIEWS entries only (opening the tab IS the action), the same pattern already used for
-- Archive/Scoreboard/Calendar.
--
-- Video Library (VIEWS.video) is a static video grid across 4 tabs (All Videos/Training/Youtube/
-- WalkThrough); every video currently in the VIDEOS array is tagged Training or WalkThrough, both of
-- which always open externally via a plain <a href> (never call the in-app vidPlay() function), so
-- there is no wrappable "play" action right now - only the 4 tabs are real, distinguishable views.
--
-- Document Library (VIEWS.documents) is structurally close to Legal's Documents tab, but it turns
-- out to be the SAME code, not just similar: docNewFolderSave/docUploadSave/docPreview/docDownload/
-- docRenameSave/docMoveSave(Legal)/docReplaceSave/docPin/docDeleteConfirm/docBulkDeleteConfirm are
-- shared global functions already mapped under legal.documents.* (DOC.scope only changes which
-- department a query is scoped to, not which function runs), so every one of those was left alone
-- to avoid misattributing Legal's usage. The one function genuinely unique to the standalone library
-- (Legal uses its own legalSelectCat/legalToggleExpand instead) is docPickCat, browsing/filtering a
-- department's documents by folder/category - that gets a real feature_key. The rest of the module's
-- distinguishable surface is its 4 views: the Libraries home (department gallery + pinned/recent),
-- a department's library, the cross-department All Documents list, and the global-search results
-- view (reachable from the top-nav search box, which always lands on '#/documents/search/...').
insert into public.erp_feature_catalog(module_id, module_label, tab, feature, feature_key, sort, active) values
('finance','Finance Vault','Overview','View collections, payables & cash summary','finance.overview.view_collections_payables_cash_summary',300,true),
('compliance','Renewals & Compliance','Compliance Calendar','View statutory & contractual due dates','compliance.compliance_calendar.view_statutory_contractual_due_dates',320,true),
('compliance','Renewals & Compliance','Licences Repository','View licences, registrations & expiry status','compliance.licences_repository.view_licences_registrations_expiry_status',321,true),
('compliance','Renewals & Compliance','Warranties & Guarantees','View AMC & warranty expiry status','compliance.warranties_guarantees.view_amc_warranty_expiry_status',322,true),
('documents','Document Library','Libraries','View department galleries, pinned & recent docs','documents.libraries.view_department_galleries_pinned_recent',340,true),
('documents','Document Library','Department Library','View a department''s library','documents.department_library.view_department_library',341,true),
('documents','Document Library','Department Library','Browse/filter by category or folder','documents.department_library.browse_filter_by_category_folder',342,true),
('documents','Document Library','All Documents','View all documents across departments','documents.all_documents.view_all_documents_across_departments',343,true),
('documents','Document Library','Search','View document search results','documents.search.view_document_search_results',344,true),
('video','Video Library','All Videos','View all videos grid','video.all_videos.view_all_videos_grid',360,true),
('video','Video Library','Training','View training videos','video.training.view_training_videos',361,true),
('video','Video Library','Youtube','View youtube videos','video.youtube.view_youtube_videos',362,true),
('video','Video Library','WalkThrough','View walkthrough videos','video.walkthrough.view_walkthrough_videos',363,true)
on conflict (feature_key) do nothing;
