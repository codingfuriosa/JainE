-- "Export causelist" was the only way to see a causelist at all - no preview, straight to a
-- forced download. Adds a matching "View causelist" catalog row for the new misViewCauselist()
-- entry point (opens the same sheet in a new tab instead of downloading it), the causelist
-- equivalent of every other module's Preview/Download pair.
insert into public.erp_feature_catalog (feature_key, module_id, module_label, tab, feature, sort, active)
values ('legal.mis.view_causelist', 'legal', 'Legal', 'MIS', 'View causelist', 142, true)
on conflict (feature_key) do nothing;
