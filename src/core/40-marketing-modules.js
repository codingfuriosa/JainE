
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
   The old Campaign Analytics tabs (numeric routes campaigns/0..6, which USAGE_VIEWS and bookmarks
   use) are untouched and drawn by the original VIEWS.campaigns; the new tabs have readable named
   routes (campaigns/meta-ads, competitors/youtube, channel_partners/google-ads, ...).

   Each tab entry: [route segment, title, icon classes, renderer: 'meta' | 'dm' | 'ci']. */
const MK_SEP='<div style="width:1px;background:var(--line);margin:6px 4px"></div>';
function mkTab(base,t,active){
  return '<div class="tab '+(active===t[0]?'active':'')+'" onclick="navTo(\''+base+(t[0]?'/'+t[0]:'')+'\')"><i class="'+t[2]+'"></i> '+esc(t[1])+'</div>';
}
// One tab of any of the three pages, into host. scope is the renderers' word for whose rows.
async function mkDrawTab(host,base,t,scope,metaKey){
  if(t[3]==='meta') return compMetaView(host,metaKey);
  if(t[3]==='dm') return dmTabView(host,t[0],scope);
  return ciTabView(host,t[0],scope,base+'/'+t[0]);
}

/* ---------------------------------------------------------------- Our Brand ('campaigns') */
const OB_TABS=[
  ['meta-ads','Meta Ad Library','fa-brands fa-meta','meta'],
  ['youtube','YouTube','fa-brands fa-youtube','dm'],
  ['maps','Google Maps','fa-solid fa-location-dot','dm'],
  ['search-console','Search Console','fa-solid fa-magnifying-glass','dm'],
  ['analytics','Analytics','fa-solid fa-chart-line','dm'],
  ['google-ads','Google Ads Transparency','fa-solid fa-rectangle-ad','ci'],
  ['trends','Search Trends','fa-solid fa-arrow-trend-up','ci'],
  ['rera','RERA','fa-solid fa-landmark','ci'],
  ['setup','Setup','fa-solid fa-plug','dm']
];
/* The Our Brand tab bar: the analytics tabs of the chosen source (cmpBaseTabs - Meta / Google /
   Both), a divider, then the tabs above. ti is the open analytics tab (-1 when one of ours is
   open); extra is the open named tab. Drawn by the analytics views themselves too, so the bar is
   the same whichever kind of tab is open. */
function cmpTabsBar(tabs,ti,extra){
  return '<div class="tabs">'+tabs.map(function(t,i){
      return '<div class="tab '+(i===ti?'active':'')+'" onclick="navTo(\'campaigns/'+i+'\')">'+esc(t)+'</div>';
    }).join('')+MK_SEP+OB_TABS.map(function(t){ return mkTab('campaigns',t,extra); }).join('')+'</div>';
}
const _obAnalyticsView=VIEWS.campaigns;
VIEWS.campaigns=async function(v,seg){
  dmOauthReturn();                         // back from Google's consent screen (Setup tab)
  let want=seg&&seg[0];
  if(want==='connect') want='setup';       // the old Digital Metrics route name
  if(want==='search') want='search-console';
  const t=OB_TABS.filter(function(x){ return x[0]===want; })[0];
  if(!t) return _obAnalyticsView(v,seg);
  setCrumb(['Growth & Strategy','Our Brand',t[1]]);
  v.innerHTML=mHead('fa-bullhorn','#db2777','Our Brand')+cmpTabsBar(cmpBaseTabs(),-1,t[0])
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
