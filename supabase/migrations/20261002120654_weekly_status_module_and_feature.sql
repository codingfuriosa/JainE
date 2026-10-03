/* Weekly Status, registered where every other module is registered.

   erp_modules is the list the Usability report and the permission screens read; the sidebar's own
   NAV array in nexus-core.js is the other half, and the two have to agree or the module exists in
   one place and not the other. sort 25 puts it after Accountability (20) and before Scoreboard,
   matching the sidebar order.

   always_granted stays FALSE on purpose. These are the minutes of the management meeting - who was
   there, what they committed to, and who has not delivered. That is not a page the whole company
   is given by default; it is granted like Finance or Legal, per person. */
insert into public.erp_modules(module_id, label, nav_group, sort, feature_module, always_granted, is_tracked)
values ('weekly_status','Weekly Status','Overview',25,'weekly_status',false,true)
on conflict (module_id) do update set
  label        = excluded.label,
  nav_group    = excluded.nav_group,
  sort         = excluded.sort,
  is_tracked   = excluded.is_tracked;

/* ONE feature, not four. The tabs are four ways of reading the same board, and clicking between
   them says nothing about whether the module earns its place. Ticking an item off does - it is the
   only thing on the page that changes any data, and it is the behaviour the module exists to
   create. A catalogue full of "somebody looked at a tab" rows is how a usability report stops
   being read.

   Flagged as a daily check because the entire point of moving the minutes off the Google Sheet is
   that items get closed BETWEEN meetings rather than in the ten minutes before the next one. A
   week with no ticks is worth seeing on the Daily Checks page. */
insert into public.erp_feature_catalog(feature_key, module_id, module_label, tab, feature, sort, daily_check)
values ('weekly_status.tick_an_action_item','weekly_status','Weekly Status','Action items',
        'Close or reopen a meeting action item', 10, true)
on conflict (feature_key) do update set
  module_id    = excluded.module_id,
  module_label = excluded.module_label,
  tab          = excluded.tab,
  feature      = excluded.feature,
  sort         = excluded.sort,
  daily_check  = excluded.daily_check,
  active       = true;
