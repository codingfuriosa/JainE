-- Procurement and Projects were switched on for usage tracking (erp_modules.is_tracked=true) but had
-- zero rows in erp_feature_catalog, so the Usability report showed them as blank no matter how much
-- they were actually used. Construction is excluded here: VIEWS.construction is still the generic
-- placeholder (VIEWS.placeholder, same as 'reports') showing only hardcoded sample rows behind a
-- "Sample data" tag with no wired-up Filter/New buttons — there is no real distinguishable action in
-- that module yet to attach a feature_key to.
insert into public.erp_feature_catalog(module_id, module_label, tab, feature, feature_key, sort, active) values
('procurement','Procurement','Quote Comp','Upload document','procurement.quote_comp.upload_document',200,true),
('procurement','Procurement','Quote Comp','Rename / replace document','procurement.quote_comp.rename_replace_document',201,true),
('procurement','Procurement','Quote Comp','Delete document(s)','procurement.quote_comp.delete_document_s',202,true),
('procurement','Procurement','Quote Comp','Download document(s)','procurement.quote_comp.download_document_s',203,true),
('procurement','Procurement','Vendor Trends','View spend KPIs & trend charts','procurement.vendor_trends.view_spend_kpis_trend_charts',204,true),
('procurement','Procurement','Vendor Trends','Filter by business unit','procurement.vendor_trends.filter_by_business_unit',205,true),
('procurement','Procurement','Vendor Trends','Search/filter vendors','procurement.vendor_trends.search_filter_vendors',206,true),
('procurement','Procurement','Vendor Trends','View vendor detail & spend history','procurement.vendor_trends.view_vendor_detail_spend_history',207,true),
('projects','Projects','Overview','View ongoing & sold-out projects gallery','projects.overview.view_ongoing_sold_out_projects_gallery',240,true)
on conflict (feature_key) do nothing;
