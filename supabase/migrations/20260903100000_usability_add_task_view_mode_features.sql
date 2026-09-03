-- New catalog rows for the Tasks "Tags" and "Person" grouping views, which had no feature to log
-- against before (only "Priority", the default view, is otherwise implicit).
insert into public.erp_feature_catalog(module_id, module_label, tab, feature, feature_key, sort, active) values
('tasks','Accountability','Tasks','View tasks grouped by tag','tasks.tasks.view_tasks_grouped_by_tag',22,true),
('tasks','Accountability','Tasks','View tasks grouped by person','tasks.tasks.view_tasks_grouped_by_person',23,true)
on conflict (feature_key) do nothing;
