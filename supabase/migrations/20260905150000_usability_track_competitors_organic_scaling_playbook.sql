-- Competitor Ads, Posts & Reels, Scaling Up and Playbook were switched on for usage tracking
-- (erp_modules.is_tracked=true) but had zero rows in erp_feature_catalog, so the Usability report
-- showed them as blank no matter how much they were actually used.
--
-- Scaling Up (VIEWS.scaling) and Playbook (VIEWS.playbook) turned out to be entirely static,
-- hardcoded display across all of their tabs - no fetch, no wired buttons of any kind (the
-- department pills and search box on Playbook's "All plays" tab render with no onclick/oninput at
-- all, and every table on both pages is a fixed sample array). The only genuine, distinguishable
-- action on either is opening a tab, so both are covered with USAGE_VIEWS entries only, one per
-- tab, the same pattern already used for Archive/Scoreboard/Calendar/Finance/Compliance.
--
-- Competitor Ads (VIEWS.competitors) and Posts & Reels (VIEWS.organic) are real, live modules with
-- wired buttons. compSave (add/edit competitor) and compRunSync (the shared fetch behind both the
-- "Fetch from Meta" and "Rebuild previews" buttons) each have a real failure path - client-side
-- validation that can silently stop them, and a network/DB call that can genuinely error - so
-- those log directly via usageQueue at the point success or failure is actually confirmed, with
-- an 'error' action on every failing path, instead of going through USAGE_MAP. orgApplyCustom
-- (organic's custom date-range apply) has the same shape (missing dates / From-after-To) and is
-- handled the same way. Every other real action on both pages (toggling a competitor's auto-sync,
-- removing a competitor, drilling into one competitor's ads, every filter/sort/search control,
-- opening an ad or post's detail view) is a straightforward action with no meaningful failure path
-- a user could hit through normal use, so those are plain USAGE_MAP entries. compSync(id,btn) and
-- orgSync/orgAutoSync were found defined but never wired to any button (orgAutoSync runs
-- automatically on page load instead) - left unmapped, nothing to catalog for them.
insert into public.erp_feature_catalog(module_id, module_label, tab, feature, feature_key, sort, active) values
('competitors','Competitor Ads','Overview','View competitor watchlist & stored ads','competitors.overview.view_competitor_watchlist_and_stored_ads',400,true),
('competitors','Competitor Ads','Overview','Add competitor','competitors.overview.add_competitor',401,true),
('competitors','Competitor Ads','Overview','Edit competitor','competitors.overview.edit_competitor',402,true),
('competitors','Competitor Ads','Overview','Remove competitor','competitors.overview.remove_competitor',403,true),
('competitors','Competitor Ads','Overview','Toggle auto-sync for a competitor','competitors.overview.toggle_auto_sync_for_a_competitor',404,true),
('competitors','Competitor Ads','Overview','Drill into a single competitor','competitors.overview.drill_into_a_single_competitor',405,true),
('competitors','Competitor Ads','Overview','Filter by competitor, date range, status or media','competitors.overview.filter_by_competitor_date_range_status_or_media',406,true),
('competitors','Competitor Ads','Overview','Search ad text, headline or page','competitors.overview.search_ad_text_headline_or_page',407,true),
('competitors','Competitor Ads','Overview','Fetch ads from Meta Ad Library','competitors.overview.fetch_ads_from_meta_ad_library',408,true),
('competitors','Competitor Ads','Overview','Rebuild ad media previews','competitors.overview.rebuild_ad_media_previews',409,true),
('competitors','Competitor Ads','Overview','View ad detail','competitors.overview.view_ad_detail',410,true),
('organic','Posts & Reels','Overview','View engagement overview by type & page','organic.overview.view_engagement_overview_by_type_and_page',420,true),
('organic','Posts & Reels','All content','View all posts & reels list','organic.all_content.view_all_posts_and_reels_list',421,true),
('organic','Posts & Reels','Top performers','View top 20 posts by engagement','organic.top_performers.view_top_20_posts_by_engagement',422,true),
('organic','Posts & Reels','All content','Filter by date range','organic.all_content.filter_by_date_range',423,true),
('organic','Posts & Reels','All content','Filter by network, content type or page','organic.all_content.filter_by_network_content_type_or_page',424,true),
('organic','Posts & Reels','All content','Sort content by metric','organic.all_content.sort_content_by_metric',425,true),
('organic','Posts & Reels','All content','Search caption or page','organic.all_content.search_caption_or_page',426,true),
('organic','Posts & Reels','All content','View post detail','organic.all_content.view_post_detail',427,true),
('scaling','Scaling Up','Strategy (OPSP)','View purpose, values, BHAG & targets','scaling.strategy_opsp.view_purpose_values_bhag_targets',440,true),
('scaling','Scaling Up','Priorities (Rocks)','View quarterly rocks & progress','scaling.priorities_rocks.view_quarterly_rocks_progress',441,true),
('scaling','Scaling Up','KPI scoreboard','View KPI targets vs actuals','scaling.kpi_scoreboard.view_kpi_targets_vs_actuals',442,true),
('scaling','Scaling Up','Meeting rhythm','View meeting cadence & schedule','scaling.meeting_rhythm.view_meeting_cadence_schedule',443,true),
('scaling','Scaling Up','Learning hub','View learning resources list','scaling.learning_hub.view_learning_resources_list',444,true),
('playbook','Playbook','All plays','View process playbook list','playbook.all_plays.view_process_playbook_list',460,true),
('playbook','Playbook','Featured play','View featured play steps','playbook.featured_play.view_featured_play_steps',461,true),
('playbook','Playbook','Roles (RACI)','View RACI roles by step','playbook.roles_raci.view_raci_roles_by_step',462,true)
on conflict (feature_key) do nothing;
