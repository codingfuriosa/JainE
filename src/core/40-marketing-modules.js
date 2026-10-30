
/* ============================ MARKETING MODULES ============================
   Our Brand · Competitor Data · Channel Partners (16 Oct 2026).

   WHY THREE PAGES. Marketing data used to be grouped by SOURCE: Campaign Analytics (our paid
   campaigns), Competitor Ads (Meta Ad Library for competitors AND our own pages AND channel
   partners, plus Google Ads / RERA / Trends for everybody) and Digital Metrics (Google data for us
   beside competitors). The same screen kept mixing our figures with theirs. It is now grouped by
   WHOSE data it is:
     Our Brand        (module id 'campaigns')        - every tab about us, nothing about anybody else
     Competitor Data  (module id 'competitors')      - competitors only
     Channel Partners (module id 'channel_partners') - our channel partners only
   The first two keep their old module ids on purpose: people's access lives in adm.users.modules
   by id, and renaming the id would have silently taken both pages away from everybody holding
   them (the recruitment -> recruitment_new lesson, see MODULE_RENAMES in 06-nav.js). Only the
   labels changed (NAV in 06-nav.js, the page headers and crumbs). Channel Partners is new, so it
   needs its own grant: anyone who should see it must hold 'channel_partners'.

   NOTHING IS DRAWN TWICE. This file only owns the page shells - header, crumb, tab bar - and hands
   each tab to the renderer that already existed, telling it whose rows to show:
     Meta Ad Library      compMetaView(host, 'brands' | 'competitors' | 'partners')  28-campaign-trends.js
     YouTube, Maps, GSC,
     GA4, Setup           dmTabView(host, tab, 'brand' | 'competitor')               38-digital-metrics.js
     Google Ads Transp.,
     Search Trends, RERA  ciTabView(host, tab, 'brand' | 'competitor' | 'partner', route)  39-competitor-intel.js
     Facebook, Google     obAdsView(host, 'meta' | 'google')                         41-our-brand-ads.js
   Every tab has a readable named route (campaigns/facebook, competitors/youtube, ...). The old
   Campaign Analytics routes (campaigns/0..6) now land on Facebook - see Our Brand below.

   Each tab entry: [route segment, title, icon classes, renderer: 'meta' | 'ads' | 'dm' | 'ci']. */
const MK_SEP='<div style="width:1px;background:var(--line);margin:6px 4px"></div>';
function mkTab(base,t,active){
  return '<div class="tab '+(active===t[0]?'active':'')+'" onclick="navTo(\''+base+(t[0]?'/'+t[0]:'')+'\')"><i class="'+t[2]+'"></i> '+esc(t[1])+'</div>';
}
// One tab of any of the three pages, into host. scope is the renderers' word for whose rows.
async function mkDrawTab(host,base,t,scope,metaKey){
  if(t[3]==='meta') return compMetaView(host,metaKey);
  if(t[3]==='ads') return obAdsView(host,t[0]==='google'?'google':'meta');
  if(t[3]==='dm') return dmTabView(host,t[0],scope);
  return ciTabView(host,t[0],scope,base+'/'+t[0]);
}

/* ---------------------------------------------------------------- Our Brand ('campaigns')
   30 Oct 2026, as asked: one tab per source, the paid-ads tabs first.
     Facebook, Google           our ad accounts' results by day (41-our-brand-ads.js)
     Meta Ad Library, Google Ads Transparency, YouTube, Google Analytics, Google Maps
   The old Campaign Analytics views (numeric routes campaigns/0..6 in 28-campaign-trends.js) added
   up stale period rows and are no longer reachable: those routes, and the tabs taken off this page
   (Search Console, Search Trends, RERA), land on Facebook. Setup (connecting Google) is no tab any
   more but a button on Google Analytics; its route stays, because Google's consent screen returns
   to it. */
const OB_TABS=[
  ['facebook','Facebook','fa-brands fa-facebook','ads'],
  ['google','Google','fa-brands fa-google','ads'],
  ['meta-ads','Meta Ad Library','fa-brands fa-meta','meta'],
  ['google-ads','Google Ads Transparency','fa-solid fa-rectangle-ad','ci'],
  ['youtube','YouTube','fa-brands fa-youtube','dm'],
  ['analytics','Google Analytics','fa-solid fa-chart-line','dm'],
  ['maps','Google Maps','fa-solid fa-location-dot','dm']
];
const OB_HIDDEN=[['setup','Setup','fa-solid fa-plug','dm']];
// Kept for the old analytics views in 28-campaign-trends.js, which still call it; draws the new bar.
function cmpTabsBar(tabs,ti,extra){ return obTabsBar(extra); }
function obTabsBar(active){ return '<div class="tabs">'+OB_TABS.map(function(t){ return mkTab('campaigns',t,active); }).join('')+'</div>'; }
VIEWS.campaigns=async function(v,seg){
  dmOauthReturn();                         // back from Google's consent screen (Setup)
  let want=seg&&seg[0];
  if(want==='connect') want='setup';       // the old Digital Metrics route name
  const t=OB_TABS.concat(OB_HIDDEN).filter(function(x){ return x[0]===want; })[0]||OB_TABS[0];
  setCrumb(['Growth & Strategy','Our Brand',t[1]]);
  v.innerHTML=mHead('fa-bullhorn','#db2777','Our Brand')+obTabsBar(t[0])
    +(t[0]==='analytics'||t[0]==='setup'?'<div style="display:flex;justify-content:flex-end;margin:10px 0 -4px">'
      +(t[0]==='setup'?'<button class="btn btn-sm" onclick="navTo(\'campaigns/analytics\')"><i class="fa-solid fa-arrow-left"></i> Back to Google Analytics</button>'
        :'<button class="btn btn-sm" onclick="navTo(\'campaigns/setup\')" title="Connect the company Google account and choose which sites, properties and channels are read"><i class="fa-solid fa-gear"></i> Google connection</button>')+'</div>':'')
    +'<div id="mkHost" style="margin-top:14px"><div class="loader"><div class="spin"></div></div></div>';
  await mkDrawTab($('mkHost'),'campaigns',t,'brand','brands');
};

/* ---------------------------------------------------------------- Competitor Data ('competitors') */
/* Facebook and Google only (26 Oct 2026, as asked). YouTube, Google Maps, Search Trends and RERA
   are switched off here, not deleted - their collectors and data are untouched, and putting a row
   back into this list brings the tab back. An old link to one of them lands on Meta Ads. */
const CD_TABS=[
  ['','Meta Ads','fa-brands fa-meta','meta'],
  ['google-ads','Google Ads Transparency','fa-solid fa-rectangle-ad','ci']
];
VIEWS.competitors=async function(v,seg){
  const want=(seg&&seg[0])||'';
  // The two tabs that moved out of this page. An old bookmark follows them rather than landing on
  // the competitors' ads and leaving the person wondering where ours went.
  if(want==='brands'){ navTo('campaigns/meta-ads'); return; }
  if(want==='partners'){ navTo('channel_partners'); return; }
  const t=CD_TABS.filter(function(x){ return x[0]===want; })[0]||CD_TABS[0];
  setCrumb(['Growth & Strategy','Competitor Data',t[1]]);
  v.innerHTML=mHead('fa-magnifying-glass-chart','#0369a1','Competitor Data')
    +'<div class="tabs" style="margin-top:-6px">'+CD_TABS.map(function(x){ return mkTab('competitors',x,t[0]); }).join('')+'</div>'
    +'<div id="mkHost"><div class="loader"><div class="spin"></div></div></div>';
  await mkDrawTab($('mkHost'),'competitors',t,'competitor','competitors');
};

/* ---------------------------------------------------------------- Channel Partners ('channel_partners')
   META ADS ONLY (16 Oct 2026, as asked): the old Channel Partners tab of Competitor Ads (watchlist
   category 'partner'). A Google Ads Transparency tab was offered here for a day and taken out -
   partners are tracked on Meta alone. With one view there is no tab bar; an old
   channel_partners/google-ads link simply lands on Meta Ads. */
const CP_TABS=[
  ['','Meta Ads','fa-brands fa-meta','meta']
];
VIEWS.channel_partners=async function(v,seg){
  const t=CP_TABS[0];
  setCrumb(['Growth & Strategy','Channel Partners']);
  v.innerHTML=mHead('fa-people-arrows','#0f766e','Channel Partners')
    +'<div id="mkHost"><div class="loader"><div class="spin"></div></div></div>';
  await mkDrawTab($('mkHost'),'channel_partners',t,'partner','partners');
};
