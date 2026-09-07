-- AI Help Desk, Reports, Inventory and Assets & Maintenance were switched on for usage tracking
-- (erp_modules.is_tracked=true) but had zero rows in erp_feature_catalog, so the Usability report
-- showed them as blank no matter how much they were actually used.
--
-- Reports (module_id 'reports') is skipped entirely on purpose: VIEWS.reports is still assigned
-- VIEWS.placeholder (see the bulk assignment `['construction','procurement','reports'].forEach(m=>
-- VIEWS[m]=VIEWS.placeholder)` in nexus-core.js) - there is no real render function to inspect and
-- nothing genuine to catalog yet.
--
-- Inventory (VIEWS.inventory) and Assets & Maintenance (VIEWS.maintenance) turned out to be
-- entirely static, hardcoded display across every one of their tabs - every table is a fixed sample
-- array (mTable with literal rows) and neither page has a single wired onclick/oninput anywhere.
-- The only genuine, distinguishable action on either is opening a tab, so both are covered with
-- USAGE_VIEWS entries only, one per tab, the same pattern already used for
-- Archive/Scoreboard/Calendar/Scaling Up/Playbook.
--
-- AI Help Desk (VIEWS.helpdesk) is real: an AI assistant chat (Assistant tab) and a ticket form
-- (My Tickets tab). Asking the assistant a question (hdSend) and raising a ticket (hdTicketSave)
-- each have a real failure path - hdSend has a network call to the helpdesk-ai edge function that
-- can genuinely error, hdTicketSave has client-side validation (empty subject/description) that can
-- silently stop it plus a DB insert that can error - so both log directly via usageQueue at the
-- point success or failure is actually confirmed, with an 'error' action on every failing path,
-- instead of going through USAGE_MAP. Opening each tab is covered by USAGE_VIEWS; Assistant is the
-- module's default landing tab reached with no hash segment at all, so it needs both the '0'
-- fallback key and the explicit 'assistant' key (see the comment beside those entries in
-- USAGE_VIEWS). hdDocSearch (the old "Find a Document" search) is dead code - its tab immediately
-- redirects to Legal (`if(tab==='docs'){navTo('legal');return;}`) before hdDocs() can ever render,
-- so there is no real button left to wire.
insert into public.erp_feature_catalog(module_id, module_label, tab, feature, feature_key, sort, active) values
('helpdesk','AI Help Desk','Assistant','View AI assistant chat','helpdesk.assistant.view_ai_assistant_chat',480,true),
('helpdesk','AI Help Desk','Assistant','Ask the assistant a question','helpdesk.assistant.ask_a_question',481,true),
('helpdesk','AI Help Desk','My Tickets','View my tickets','helpdesk.tickets.view_my_tickets',482,true),
('helpdesk','AI Help Desk','My Tickets','Raise a ticket','helpdesk.tickets.raise_a_ticket',483,true),
('inventory','Inventory','Indents & RFQ','View indent & RFQ pipeline','inventory.indents_rfq.view_indent_rfq_pipeline',500,true),
('inventory','Inventory','Quote comparison','View quote comparison','inventory.quote_comparison.view_quote_comparison',501,true),
('inventory','Inventory','Purchase orders','View purchase orders','inventory.purchase_orders.view_purchase_orders',502,true),
('inventory','Inventory','GRN & QC','View GRN & QC status','inventory.grn_qc.view_grn_qc_status',503,true),
('inventory','Inventory','Stock ledger','View stock ledger','inventory.stock_ledger.view_stock_ledger',504,true),
('inventory','Inventory','Accounts payable','View accounts payable','inventory.accounts_payable.view_accounts_payable',505,true),
('maintenance','Assets & Maintenance','Asset register','View asset register','maintenance.asset_register.view_asset_register',520,true),
('maintenance','Assets & Maintenance','Preventive maintenance','View preventive maintenance schedule','maintenance.preventive_maintenance.view_pm_schedule',521,true),
('maintenance','Assets & Maintenance','Breakdowns & repairs','View breakdown & repair tickets','maintenance.breakdowns_repairs.view_breakdown_repair_tickets',522,true),
('maintenance','Assets & Maintenance','Location-wise','View assets by location','maintenance.location_wise.view_assets_by_location',523,true)
on conflict (feature_key) do nothing;
