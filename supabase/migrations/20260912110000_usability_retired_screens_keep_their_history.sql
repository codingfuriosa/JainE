/* Usability: the four removed screens go back on the list, named for what they are.

   The previous migration deactivated them because their screens are gone from the app and they can
   never record another use. That was right about the app and wrong about the report: between them
   they hold 96 real uses from June to September - including five genuine clicks by career@ on
   1 September, made on the build that was deployed that day - and deactivating them took that
   history off the screen entirely. The brief here is that every use between 1 June and 12 September
   is visible, so hiding ninety-six of them to tidy up a list is the wrong trade.

   They come back active, with the reason written into the name. A reader seeing "Add candidate
   (screen since removed)" at zero for this month understands it immediately; the same row unlabelled
   at zero reads as a feature the staff are ignoring, which is exactly the misreading this whole
   piece of work is trying to end. */
update public.erp_feature_catalog
   set active = true,
       feature = feature || ' (screen since removed)'
 where feature_key in ('hr.h_s_candidates.add_candidate',
                       'hr.h_s_candidates.search_filter_candidates',
                       'hr.monthly_update.create_new_month_record',
                       'hr.monthly_update.edit_tracking_values')
   and feature not like '%(screen since removed)';
