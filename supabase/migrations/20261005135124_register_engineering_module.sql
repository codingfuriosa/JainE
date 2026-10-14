/* Register Engineering in erp_modules, which it never was.

   WHAT THIS BROKE. erp_modules is the list the permission screens and the Usability report read.
   Engineering was in nexus-core.js's NAV array but not here, so there was no row to tick: it could
   not be granted to anybody through Control Panel, and the one person who holds it
   (system3.thejaingroup@gmail.com) has it only because it was written into adm.users.modules
   directly. Everyone else who can see Engineering today sees it because they are a super admin,
   which is not a permission model.

   It was also invisible to the Usability report — a whole module's use going uncounted.

   sort 85 puts it between Construction (80) and Inventory (90), matching the sidebar order in NAV.

   always_granted FALSE, like every other Operations module: work orders, rates and contractor
   bills are not something the whole company gets by default.

   This does not grant the module to anybody. It makes it grantable. */
insert into public.erp_modules(module_id, label, nav_group, sort, feature_module, always_granted, is_tracked)
values ('engineering','Engineering','Operations',85,'Engineering',false,true)
on conflict (module_id) do update set
  label      = excluded.label,
  nav_group  = excluded.nav_group,
  sort       = excluded.sort,
  is_tracked = excluded.is_tracked;
