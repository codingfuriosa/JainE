-- CRM & SALES: PERFORMANCE REPORT ONLY (25 Nov 2026, Ayush: "Give Campaign Analytics and Performance Report to Riya Dey" -
-- Performance Report only). Module 'crm_perf' opens CRM & Sales with just the Performance Report tab (crmPerfOnly() in
-- src/core/06-nav.js); here it may also type the Spent amounts. Applied by the one-time cron crm_perf_policy_once (20:06 IST).
drop policy if exists crm_perf_spend_write on acc.crm_perf_spend;
create policy crm_perf_spend_write on acc.crm_perf_spend for all to authenticated
  using (app.has_module('crm') or app.has_module('crm_perf')) with check (app.has_module('crm') or app.has_module('crm_perf'));
