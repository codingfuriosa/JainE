-- New catalog row for the Tasks "Workflow" grouping view, alongside Priority/Tags/Person.
insert into public.erp_feature_catalog(module_id, module_label, tab, feature, feature_key, sort, active) values
('tasks','Accountability','Tasks','View tasks grouped by workflow','tasks.tasks.view_tasks_grouped_by_workflow',24,true)
on conflict (feature_key) do nothing;
