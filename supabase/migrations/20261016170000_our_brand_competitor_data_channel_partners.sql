-- MARKETING REORGANISED (16 Oct 2026): Campaign Analytics is now "Our Brand" (id campaigns),
-- Competitor Ads is now "Competitor Data" (id competitors), Channel Partners is its own module
-- (id channel_partners), and the Google data tabs (YouTube, Maps, Search Console, Analytics, Setup)
-- live inside the first two instead of a separate Digital Metrics module.
--
-- 1. The Google data tables were gated on the retired 'digital_metrics' module, which nobody holds.
--    Anyone who can open Our Brand or Competitor Data may now read them; 'digital_metrics' still
--    counts so nothing breaks if it is ever granted.
create or replace function camp.dm_allowed()
returns boolean
language sql stable security definer
set search_path to ''
as $function$
  select not app.is_customer()
     and (app.has_module('campaigns') or app.has_module('competitors') or app.has_module('digital_metrics'))
$function$;

-- 2. Channel Partners used to be a tab of Competitor Ads, so whoever could see that tab keeps
--    seeing it in its new home.
update adm.users
   set modules = array_append(modules, 'channel_partners')
 where 'competitors' = any(modules)
   and not ('channel_partners' = any(modules));
