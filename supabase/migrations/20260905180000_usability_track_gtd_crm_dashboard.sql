-- GTD, CRM & Sales and Home / Dashboards were switched on for usage tracking
-- (erp_modules.is_tracked=true) but had zero rows in erp_feature_catalog, so the Usability report
-- showed them as blank no matter how much they were actually used.
--
-- GTD (VIEWS.gtd) and CRM & Sales (VIEWS.crm) both turned out to be entirely static, hardcoded
-- display across every one of their tabs - every table is a fixed sample array (mTable with
-- literal rows), the Capture box/button on GTD's Inbox tab and the per-row "Next action / Project
-- / Waiting / Someday / Done" buttons carry no onclick at all, and neither page has a single wired
-- onclick/oninput anywhere. The only genuine, distinguishable action on either is opening a tab, so
-- both are covered with USAGE_VIEWS entries only, one per tab, the same pattern already used for
-- Inventory/Assets & Maintenance/Scaling Up/Playbook. CRM's Directory & hierarchy and Post-sale
-- tabs render mSoon's "being built to match the reference" placeholder body rather than a real
-- table, but the tab itself is real and clickable, so it is still catalogued (feature text says so
-- plainly rather than pretending it's finished).
--
-- Dashboard (VIEWS.dashboard, served from index.html) is a single, non-tabbed view with real live
-- data (KPI counts, recent documents and recent activity feeds are queried from Supabase) - but it
-- has no wired actions of its own; its "Reports" button and Quick Actions tiles are just navTo(...)
-- shortcuts into other modules, already covered by those modules' own catalog rows. So the only
-- distinguishable feature here is opening the dashboard itself, covered by a single USAGE_VIEWS
-- entry keyed 'dashboard/0' - the module has no tabs, so both a bare landing and any
-- navTo('dashboard') fall through usageViewTick's no-segment default of '0'.
insert into public.erp_feature_catalog(module_id, module_label, tab, feature, feature_key, sort, active) values
('dashboard','Home / Dashboards','Overview','View home dashboard summary (KPIs, charts & recent activity)','dashboard.overview.view_home_dashboard_summary',540,true),
('gtd','GTD','Inbox','View capture inbox & clarify queue','gtd.inbox.view_capture_inbox_clarify_queue',560,true),
('gtd','GTD','Next Actions','View next actions by context','gtd.next_actions.view_next_actions_by_context',561,true),
('gtd','GTD','Projects','View active projects & next steps','gtd.projects.view_active_projects_next_steps',562,true),
('gtd','GTD','Waiting For','View items waiting on others','gtd.waiting_for.view_items_waiting_on_others',563,true),
('gtd','GTD','Someday / Maybe','View someday/maybe ideas list','gtd.someday_maybe.view_someday_maybe_ideas_list',564,true),
('gtd','GTD','Weekly Review','View weekly review checklist','gtd.weekly_review.view_weekly_review_checklist',565,true),
('crm','CRM & Sales','Pipeline & Funnel','View conversion funnel & stage ageing','crm.pipeline_funnel.view_conversion_funnel_stage_ageing',580,true),
('crm','CRM & Sales','Leads','View leads pipeline list','crm.leads.view_leads_pipeline_list',581,true),
('crm','CRM & Sales','Bookings','View bookings list','crm.bookings.view_bookings_list',582,true),
('crm','CRM & Sales','Directory & Hierarchy','View directory & hierarchy tab (in development)','crm.directory_hierarchy.view_directory_hierarchy_tab',583,true),
('crm','CRM & Sales','Comm History','View communication history','crm.comm_history.view_communication_history',584,true),
('crm','CRM & Sales','Demands & Collections','View demands & collections list','crm.demands_collections.view_demands_collections_list',585,true),
('crm','CRM & Sales','Brokers','View brokers list','crm.brokers.view_brokers_list',586,true),
('crm','CRM & Sales','Post-Sale','View post-sale tab (in development)','crm.post_sale.view_post_sale_tab',587,true)
on conflict (feature_key) do nothing;
