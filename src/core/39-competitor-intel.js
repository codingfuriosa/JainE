
/* ---- Google Ads Transparency, RERA Projects, Search Trends tabs ------------------------------
   Public, logged-out data collected by the public-intel edge function (see its header): Google's
   Ads Transparency Center, the WBRERA project register, and Google Trends.
   Every figure on these tabs is exactly what the source shows; a value the source does not give is
   shown as a dash or "not read yet", never filled in.

   ONE SET OF RENDERERS, THREE PAGES. These tabs first sat on the old Competitor Ads page with ours
   and theirs mixed. The marketing modules were then split by whose data it is, so ciTabView() is
   now called by each page shell in src/core/40-marketing-modules.js with a scope:
     'brand'      - Our Brand        (campaigns/google-ads, campaigns/trends, campaigns/rera)
     'competitor' - Competitor Data  (competitors/google-ads, competitors/trends, competitors/rera)
     'partner'    - Channel Partners (no longer drawn - that page is Meta only)
   WHOSE A ROW IS comes from camp.pi_targets.watchlist_id -> camp.competitor_watchlist.category
   ('brand' / 'competitor' / 'partner'; old rows without a category fall back to is_own_brand,
   the same rule as the Meta tabs - compCategoryOf()). A followed target with no watchlist row is
   counted as a competitor, except a Search Trends group none of whose terms belongs to anybody
   (the "Localities" group): that is the market, not a company, and is shown on Competitor Data
   only, labelled as such.

   DATA FIRST (16 Oct 2026, as asked). Competitor Data has no collection log and no fetch buttons:
   collection runs only on the 5-minute schedule, and each tab says when it was last updated. Our
   Brand keeps its "Fetch next now" and Collection log. Google ads are shown inside JainE - picture, rendered text ad
   or YouTube player - instead of sending people to Google; which Google account paid for an ad is
   not shown: every ad found under a competitor's accounts or website counts as that competitor's. */
const CI_TABS=[
  ['google-ads','Google Ads Transparency','fa-rectangle-ad','competitors.google_ads.view_google_ads'],
  ['rera','RERA Projects','fa-landmark','competitors.rera_projects.view_rera_projects'],
  ['trends','Search Trends','fa-chart-line','competitors.search_trends.view_search_trends']
];
// The open tab's side and the route it lives at, set by ciTabView and used by the redraws.
let CI_SCOPE='competitor', CI_ROUTE='competitors/google-ads';
function ciCategoryOf(w){ return w?compCategoryOf(w):'competitor'; }
function ciTargetScope(t){ return t.watchlist_id?ciCategoryOf((window._ciWl||{})[t.watchlist_id]):'competitor'; }
async function ciLoadWatchlist(){
  const {data}=await sb.schema('camp').from('competitor_watchlist').select('id,name,category,is_own_brand');
  window._ciWl={}; (data||[]).forEach(function(w){ window._ciWl[w.id]=w; });
}
const CI_SCOPE_WORD={brand:'our brand',competitor:'competitors',partner:'channel partners'};
let CI_F={wl:'all',fmt:'all',recent:'all',q:'',geo:'IN-WB'};
// How many ad cards are drawn; "Show more" adds a page. Reset by every filter.
const CI_PAGE=60;
let CI_SHOW=CI_PAGE;

const CI_CSS='<style>'
  +'.ci-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--bg-card);margin-bottom:14px}'
  +'.ci-bar select{height:36px;padding:0 11px;border:1px solid var(--line);border-radius:9px;font-size:13px;font-weight:600;font-family:inherit;background:var(--bg-card);color:var(--ink);cursor:pointer}'
  +'.ci-bar input{height:36px;padding:0 11px;border:1px solid var(--line);border-radius:9px;font-size:13px;font-family:inherit;background:var(--bg-card);color:var(--ink);flex:1;min-width:200px;max-width:360px}'
  +'.ci-upd{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--slate);margin:0 0 12px;flex-wrap:wrap}'
  +'.ci-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}'
  +'.ci-ad{border:1px solid var(--line);border-radius:12px;background:var(--bg-card);overflow:hidden;cursor:pointer;display:flex;flex-direction:column;transition:box-shadow .15s,transform .15s}'
  +'.ci-ad:hover{box-shadow:0 6px 18px rgba(15,23,42,.12);transform:translateY(-1px)}'
  +'.ci-pv{height:180px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;border-bottom:1px solid var(--line)}'
  +'.ci-pv img{max-width:100%;max-height:100%;object-fit:contain;display:block}'
  +'.ci-pv img.cover{width:100%;height:100%;object-fit:cover}'
  +'.ci-pv .none{color:#64748b;font-size:12px;text-align:center;padding:12px;line-height:1.5}'
  +'.ci-pv .none i{font-size:22px;display:block;margin-bottom:6px;opacity:.6}'
  +'.ci-play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}'
  +'.ci-play span{width:48px;height:48px;border-radius:50%;background:rgba(0,0,0,.62);color:#fff;display:flex;align-items:center;justify-content:center;font-size:17px;padding-left:3px;box-sizing:border-box}'
  +'.ci-dur{position:absolute;right:7px;bottom:7px;background:rgba(0,0,0,.75);color:#fff;font-size:10.5px;border-radius:4px;padding:1px 6px}'
  +'.ci-serp{background:#fff;color:#202124;padding:13px 15px;width:100%;height:100%;box-sizing:border-box;text-align:left;font-family:Arial,Helvetica,sans-serif;overflow:hidden}'
  +'.ci-serp .sp{font-size:11.5px;font-weight:700;color:#202124}'
  +'.ci-serp .du{font-size:12px;color:#4d5156;margin:1px 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  +'.ci-serp .hl{font-size:15.5px;color:#1a0dab;line-height:1.3;margin-bottom:5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}'
  +'.ci-serp .ds{font-size:12.5px;color:#4d5156;line-height:1.45;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}'
  +'.ci-serp .kw{text-decoration:underline dotted;text-underline-offset:3px}'
  +'.ci-serp.big{padding:20px 22px;border:1px solid #dadce0;border-radius:10px}'
  +'.ci-serp.big .hl{font-size:20px;-webkit-line-clamp:unset}'
  +'.ci-serp.big .ds{font-size:14px;-webkit-line-clamp:unset}'
  +'.ci-serp .sl{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:10px;font-size:13.5px}'
  +'.ci-serp .sl span{color:#1a0dab}'
  +'.ci-serp .cta{display:inline-block;margin-top:10px;border:1px solid #dadce0;border-radius:16px;padding:4px 12px;font-size:12.5px;color:#1a73e8}'
  +'.ci-meta{padding:10px 12px 12px;font-size:12px;line-height:1.55;flex:1;display:flex;flex-direction:column;gap:4px}'
  +'.ci-meta .ttl{font-weight:600;font-size:12.5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}'
  +'.ci-meta .when{color:var(--slate);font-size:11.5px;margin-top:auto}'
  +'.tbl tr.sel td{background:rgba(3,105,161,.08)}'
  +'.ci-num{text-align:center;font-variant-numeric:tabular-nums}'
  +'.ci-up{color:#15803d;font-weight:600}.ci-down{color:#b91c1c;font-weight:600}.ci-flat{color:var(--slate)}'
  +'.ci-explain{background:var(--bg-card);border:1px solid var(--line);border-left:4px solid #0369a1;border-radius:10px;padding:12px 15px;font-size:13px;line-height:1.6;margin-bottom:14px}'
  +'</style>';
// Typing in a search box redraws the list; put the cursor back where it was.
function ciSearchInput(id,key,paint,ph){
  return '<input id="'+id+'" placeholder="'+esc(ph)+'" value="'+esc(CI_F[key])+'" oninput="CI_F.'+key+'=this.value;CI_SHOW=CI_PAGE;clearTimeout(window._ciT);window._ciT=setTimeout(function(){'+paint+'();var e=document.getElementById(\''+id+'\');if(e){e.focus();e.setSelectionRange(e.value.length,e.value.length);}},350)">';
}
function ciAgo(d){
  if(!d) return '—';
  const m=Math.round((Date.now()-new Date(d).getTime())/60000);
  if(m<1) return 'just now'; if(m<60) return m+' min ago';
  const h=Math.round(m/60); if(h<48) return h+' h ago';
  return Math.round(h/24)+' days ago';
}
function ciDateTime(d){ return d?new Date(d).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—'; }
function ciN(n){ return n==null?'—':Number(n).toLocaleString('en-IN'); }
async function ciAll(q){
  // PostgREST pages at 1000 rows; the RERA register is ~5,000 and a busy advertiser has thousands of ads.
  const out=[]; for(let from=0;;from+=1000){
    const {data,error}=await q().range(from,from+999);
    if(error) throw error;
    out.push.apply(out,data||[]); if(!data||data.length<1000) break;
  }
  return out;
}

/* Draws one of the three tabs into host, below the calling page's header and tab bar.
   tab: 'google-ads' | 'rera' | 'trends'. scope: 'brand' | 'competitor' | 'partner'.
   route: where this tab lives (e.g. 'campaigns/rera'), so Fetch now redraws the same tab.
   The usage catalogue's three keys belong to the competitors module (erp_feature_catalog), so a
   view is logged against them only on Competitor Data - logging Our Brand's RERA tab as a
   competitors feature would put a visit on the wrong module's line in the Usability report. */
async function ciTabView(host,tab,scope,route){
  const t=CI_TABS.filter(function(x){ return x[0]===tab; })[0]||CI_TABS[0];
  CI_SCOPE=scope||'competitor'; CI_ROUTE=route||('competitors/'+t[0]);
  CI_SHOW=CI_PAGE;
  if(CI_SCOPE==='competitor'){ try{ usageQueue(t[3],'view'); }catch(e){} }
  host.innerHTML=CI_CSS+'<div id="ciRuns"></div>'
    +'<div id="ciBody"><div class="loader"><div class="spin"></div></div></div>';
  window._ciTab=t[0];
  try{
    await ciLoadWatchlist();
    if(t[0]==='google-ads') await ciGads();
    else if(t[0]==='rera') await ciRera();
    else await ciTrends();
  }catch(e){
    const b=$('ciBody'); if(b) b.innerHTML='<div class="card card-pad" style="color:#b91c1c"><i class="fa-solid fa-circle-exclamation"></i> Could not load: '+esc(e.message||String(e))+'</div>';
  }
}

// ---------------------------------------------------------------- "updated automatically" line
/* One line saying the tab fills itself and when it last did, plus anything still in progress
   (extra). Competitor Data shows only that - no Collection log, no fetch button: people there want
   the data, and only the schedule collects it. Our Brand (every non-competitor view) keeps its
   "Fetch next now" button and the Collection log below it, as asked on 16 Oct 2026. */
const CI_SOURCE_LABEL={google_ads:'Google Ads',gads_detail:'Google ad contents',rera_list:'RERA project list',rera_detail:'RERA project pages',trends:'Google Trends'};
async function ciStatus(sources,blurb,extra){
  const {data}=await sb.schema('camp').from('pi_runs').select('finished_at').in('source',sources).eq('ok',true).order('finished_at',{ascending:false}).limit(1);
  const last=data&&data[0]&&data[0].finished_at;
  const btn=CI_SCOPE!=='competitor'?sources.filter(function(s){ return s!=='rera_list'&&s!=='gads_detail'; })[0]:null;
  $('ciRuns').innerHTML='<div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;margin:0 0 8px">'
      +'<p style="color:var(--slate);margin:0;flex:1;min-width:240px;font-size:13px;line-height:1.55">'+blurb+'</p>'
      +(btn?'<button class="btn" id="ciFetchBtn" onclick="ciFetchNow(\''+btn+'\')"><i class="fa-solid fa-rotate"></i> Fetch next now</button>':'')
    +'</div>'
    +'<div class="ci-upd"><i class="fa-solid fa-clock-rotate-left" style="color:#0369a1"></i> Updated automatically'
      +(last?' - last updated <b title="'+esc(ciDateTime(last))+'">'+ciAgo(last)+'</b>':' - nothing collected yet')
      +(extra?' · '+extra:'')+'</div>'
    +(CI_SCOPE!=='competitor'?await ciRunsLog(sources):'');
}
// The Collection log: the latest run of each source, then the last 25 runs. Non-competitor views only.
async function ciRunsLog(sources){
  const {data}=await sb.schema('camp').from('pi_runs').select('*').in('source',sources).order('started_at',{ascending:false}).limit(40);
  const runs=data||[];
  const last={}; runs.forEach(function(r){ if(!last[r.source]) last[r.source]=r; });
  const chips=sources.map(function(s){
    const r=last[s];
    if(!r) return '<span class="tag t-gray">'+esc(CI_SOURCE_LABEL[s]||s)+': not run yet</span>';
    const cls=r.ok===true?'t-green':(r.ok===false?(r.refused?'t-amber':'t-red'):'t-gray');
    const word=r.ok===true?'ok':(r.ok===false?(r.refused?'site asked us to slow down':'failed'):'running');
    return '<span class="tag '+cls+'" title="'+esc((r.error||r.note||'')+' ('+(r.unit||'')+')')+'">'+esc(CI_SOURCE_LABEL[s]||s)+': '+word+' · '+ciAgo(r.started_at)+'</span>';
  }).join(' ');
  const rows=runs.slice(0,25).map(function(r){
    return '<tr><td>'+ciDateTime(r.started_at)+'</td><td>'+esc(CI_SOURCE_LABEL[r.source]||r.source)+'</td>'
      +'<td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(r.unit||'')+'">'+esc(r.unit||'')+'</td>'
      +'<td>'+(r.ok===true?'<span class="tag t-green">ok</span>':r.ok===false?(r.refused?'<span class="tag t-amber">refused</span>':'<span class="tag t-red">failed</span>'):'<span class="tag t-gray">running</span>')+'</td>'
      +'<td style="text-align:right">'+(r.items==null?'—':r.items)+'</td>'
      +'<td style="font-size:11.5px;color:var(--slate);max-width:420px;word-break:break-word">'+esc(r.error||r.note||'')+'</td></tr>';
  }).join('');
  return '<details class="card" style="margin-bottom:14px"><summary style="cursor:pointer;padding:11px 15px;font-size:13px;list-style:none;display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
      +'<i class="fa-solid fa-clock-rotate-left" style="color:#0369a1"></i> <b>Collection log</b> '+chips
      +'<span style="margin-left:auto;font-size:11.5px;color:var(--slate)">click to open / close</span></summary>'
      +'<div style="overflow-x:auto;border-top:1px solid var(--line)"><table class="tbl" style="width:100%;font-size:12.5px">'
        +'<thead><tr><th>Started</th><th>Source</th><th>What</th><th>Result</th><th style="text-align:right">Rows</th><th>Note / error</th></tr></thead>'
        +'<tbody>'+(rows||'<tr><td colspan="6" style="color:var(--slate)">Nothing collected yet - the schedule runs every 5 minutes.</td></tr>')+'</tbody></table></div>'
    +'</details>';
}
window.ciFetchNow=async function(source){
  const b=$('ciFetchBtn'); if(b){ b.disabled=true; b.innerHTML='<i class="fa-solid fa-rotate fa-spin"></i> Fetching - up to a minute…'; }
  try{
    const {data:{session}}=await sb.auth.getSession();
    const res=await fetch(SUPABASE_URL+'/functions/v1/public-intel',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+((session&&session.access_token)||''),'apikey':SUPABASE_KEY},
      body:JSON.stringify({action:'tick',source:source})});
    const jr=await res.json().catch(function(){ return {}; });
    if(!res.ok||jr.error) throw new Error(jr.error||('HTTP '+res.status));
    const r=(jr.results||[])[0]||{};
    if(r.skipped) toast('Not fetched: '+r.skipped,'warn');
    else if(r.ok) toast('Fetched '+(r.items||0)+' row(s)','ok');
    else toast('Failed: '+(r.error||'unknown'),'err');
  }catch(e){ toast('Fetch failed: '+(e.message||e),'err'); }
  navTo(CI_ROUTE);
};

// ---------------------------------------------------------------- Google Ads
const CI_FMT_WORD={text:'Text ad',image:'Image ad',video:'Video ad'};
const CI_GCOLS='creative_id,format,first_shown,last_shown,days_shown,image_url,watchlist_id,ad_layout,ad_headline,ad_long_headline,ad_description,ad_display_url,ad_business,ad_cta,ad_image_url,ad_logo_url,video_id,video_duration,ad_extra,detail_at,detail_error';
async function ciGads(){
  // Only the open side's companies, and only their creatives (asked for by watchlist id, so a busy
  // competitor's thousands are never downloaded to draw our own handful).
  const tg=await sb.schema('camp').from('pi_targets').select('*').eq('source','google_ads').order('sort');
  const targets=(tg.data||[]).filter(function(t){ return t.watchlist_id&&ciTargetScope(t)===CI_SCOPE; });
  const ids=[]; targets.forEach(function(t){ if(ids.indexOf(t.watchlist_id)<0) ids.push(t.watchlist_id); });
  const ads=ids.length?await ciAll(function(){ return sb.schema('camp').from('pi_gads_creatives').select(CI_GCOLS).in('watchlist_id',ids).order('last_shown',{ascending:false}).order('creative_id'); }):[];
  window._ciAds=ads; window._ciGTargets=targets;
  if(CI_F.wl!=='all'&&ids.map(String).indexOf(CI_F.wl)<0) CI_F.wl='all';
  /* Still in progress: a company whose ad list Google has not been read to the end, and ads whose
     words / picture / video are not read yet. Said plainly so a small count is not taken as final. */
  const W=window._ciWl||{};
  const reading={}; targets.forEach(function(t){ if(t.cursor||!t.full_at) reading[t.watchlist_id]=1; });
  const readingNames=Object.keys(reading).map(function(id){ return (W[id]||{}).name||('#'+id); });
  const pending=ads.filter(function(a){ return !a.detail_at&&(!a.image_url||a.format==='video'); }).length;
  const extra=[readingNames.length?'still reading the full ad list for <b>'+esc(readingNames.join(', '))+'</b> - more ads appear as it goes':'',
    pending?ciN(pending)+' ad'+(pending===1?'':'s')+' still being opened to show their content':''].filter(Boolean).join(' · ');
  await ciStatus(['google_ads','gads_detail'],'Every ad Google shows for '+(CI_SCOPE==='brand'?'us':'each competitor')+' in its public Ads Transparency Center (India) - the ad itself, its format, and the first and last day Google showed it. Google publishes no spend, clicks or city, so these are India-wide'+(CI_SCOPE==='brand'?'':' (Godrej, for one, advertises all over India)')+'. Click an ad to see it full size.',extra);
  ciGadsPaint();
}
const ciRecent=function(a){ return a.last_shown&&new Date(a.last_shown).getTime()>=Date.now()-30*864e5; };
// Google's keyword insertion: {KeyWord:Flats in Madhyamgram} shows the searched words, or the
// words after the colon when they do not fit. The default is what is shown, marked as such.
function ciKw(s){
  return esc(s||'').replace(/\{key[wW]ord:([^}]*)\}/gi,function(_,d){ return '<span class="kw" title="Google puts the person\'s own search words here; these are the words it shows otherwise">'+d+'</span>'; });
}
// The ad drawn the way Google shows a search ad: Sponsored, web address, blue headline, text.
function ciSerp(a,big){
  const ex=a.ad_extra||{};
  return '<div class="ci-serp'+(big?' big':'')+'">'
    +'<div class="sp">Sponsored</div>'
    +(a.ad_business&&big?'<div style="font-size:13px;color:#202124;margin-top:3px">'+esc(a.ad_business)+'</div>':'')
    +'<div class="du">'+esc(a.ad_display_url||'')+'</div>'
    +'<div class="hl">'+ciKw(a.ad_headline)+'</div>'
    +'<div class="ds">'+ciKw(a.ad_description)+'</div>'
    +(big&&ex.sitelinks&&ex.sitelinks.length?'<div class="sl">'+ex.sitelinks.map(function(s){ return '<span>'+esc(s)+'</span>'; }).join('')+'</div>':'')
    +(big&&(ex.place||ex.address)?'<div style="font-size:13px;color:#4d5156;margin-top:10px"><i class="fa-solid fa-location-dot"></i> '+esc([ex.place,ex.address].filter(Boolean).join(' - '))+'</div>':'')
    +(big&&a.ad_cta?'<div class="cta">'+esc(a.ad_cta)+'</div>':'')
  +'</div>';
}
function ciYtThumb(id){ return 'https://i.ytimg.com/vi/'+encodeURIComponent(id)+'/hqdefault.jpg'; }
// The preview area of a card: the ad's own picture, a rendered text ad, or the video's still.
function ciAdPreview(a){
  if(a.video_id) return '<img class="cover" src="'+esc(ciYtThumb(a.video_id))+'" loading="lazy" referrerpolicy="no-referrer" alt="">'
    +'<div class="ci-play"><span><i class="fa-solid fa-play"></i></span></div>'+(a.video_duration?'<span class="ci-dur">'+esc(a.video_duration)+'</span>':'');
  if(a.image_url) return '<img src="'+esc(a.image_url)+'" loading="lazy" referrerpolicy="no-referrer" alt="">';
  if(a.ad_image_url) return '<img class="cover" src="'+esc(a.ad_image_url)+'" loading="lazy" referrerpolicy="no-referrer" alt="">';
  if(a.ad_headline) return ciSerp(a,false);
  if(!a.detail_at) return '<div class="none"><i class="fa-solid fa-hourglass-half"></i>Being read from Google<br>- shows here within a few hours</div>';
  return '<div class="none"><i class="fa-regular fa-eye-slash"></i>Google does not show this ad\'s content</div>';
}
function ciAdCard(a,showWho){
  const W=window._ciWl||{};
  const ttl=(a.video_id||a.ad_image_url)?(a.ad_headline||''):'';
  return '<div class="ci-ad" onclick="ciAdOpen(\''+esc(a.creative_id)+'\')">'
    +'<div class="ci-pv">'+ciAdPreview(a)+'</div>'
    +'<div class="ci-meta">'
      +'<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'
        +'<span class="tag t-gray">'+esc(CI_FMT_WORD[a.format]||'Ad')+'</span>'
        +(ciRecent(a)?'<span class="tag t-green" title="Google showed this ad in the last 30 days">Active</span>':'')
        +(showWho?'<span style="margin-left:auto;font-weight:700;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px" title="'+esc((W[a.watchlist_id]||{}).name||'')+'">'+esc((W[a.watchlist_id]||{}).name||'')+'</span>':'')
      +'</div>'
      +(ttl?'<div class="ttl">'+ciKw(ttl)+'</div>':'')
      +'<div class="when">Running since '+fmtDate(a.first_shown)+' · last seen '+fmtDate(a.last_shown)+'</div>'
    +'</div></div>';
}
function ciGadsRows(){
  const ads=window._ciAds||[], q=(CI_F.q||'').toLowerCase();
  return ads.filter(function(a){
    if(CI_F.wl!=='all'&&String(a.watchlist_id)!==CI_F.wl) return false;
    if(CI_F.fmt!=='all'&&a.format!==CI_F.fmt) return false;
    if(CI_F.recent==='30'&&!ciRecent(a)) return false;
    if(q&&[a.ad_headline,a.ad_long_headline,a.ad_description,a.ad_display_url,a.ad_business].join(' ').toLowerCase().indexOf(q)<0) return false;
    return true;
  });
}
function ciGadsPaint(){
  const ads=window._ciAds||[], targets=window._ciGTargets||[], W=window._ciWl||{};
  const wlIds=[]; targets.forEach(function(t){ if(t.watchlist_id&&wlIds.indexOf(t.watchlist_id)<0) wlIds.push(t.watchlist_id); });
  if(!wlIds.length){
    $('ciBody').innerHTML='<div class="card card-pad" style="color:var(--slate);font-size:13px"><i class="fa-solid fa-circle-info"></i> No Google advertiser is followed for '+esc(CI_SCOPE_WORD[CI_SCOPE]||CI_SCOPE)+' yet.</div>';
    return;
  }
  const summary=wlIds.map(function(id){
    const a=ads.filter(function(x){ return x.watchlist_id===id; });
    const cnt=function(f){ return a.filter(function(x){ return x.format===f; }).length; };
    const last=a.reduce(function(m,x){ return x.last_shown&&(!m||x.last_shown>m)?x.last_shown:m; },null);
    const tg=targets.filter(function(t){ return t.watchlist_id===id; });
    const unread=!a.length&&tg.every(function(t){ return !t.full_at&&!t.pass_pages; });
    const partial=tg.some(function(t){ return t.cursor||!t.full_at; });
    const c=function(n){ return unread?'—':ciN(n); };
    return '<tr style="cursor:pointer" onclick="ciGSet(\'wl\',\''+id+'\')"'+(CI_F.wl===String(id)?' class="sel"':'')+'><td><b>'+esc((W[id]||{}).name||('#'+id))+'</b></td>'
      +'<td class="ci-num"><b>'+c(a.length)+'</b>'+(partial&&!unread?'<div style="font-size:10.5px;color:#b45309">still counting</div>':'')+'</td>'
      +'<td class="ci-num">'+c(a.filter(ciRecent).length)+'</td>'
      +'<td class="ci-num">'+c(cnt('text'))+'</td><td class="ci-num">'+c(cnt('image'))+'</td><td class="ci-num">'+c(cnt('video'))+'</td>'
      +'<td>'+(last?fmtDate(last):'—')+'</td></tr>';
  }).join('');
  const rows=ciGadsRows();
  const opts=[['all','All '+(CI_SCOPE==='brand'?'our brands':'competitors')]].concat(wlIds.map(function(id){ return [String(id),(W[id]||{}).name||('#'+id)]; }));
  const shown=rows.slice(0,CI_SHOW);
  $('ciBody').innerHTML='<div class="card" style="margin-bottom:14px;overflow-x:auto"><table class="tbl" style="width:100%;font-size:13px">'
      +'<thead><tr><th>'+(CI_SCOPE==='brand'?'Brand':'Competitor')+'</th><th class="ci-num">Ads</th><th class="ci-num" title="Ads Google showed within the last 30 days">Running in last 30 days</th><th class="ci-num">Text</th><th class="ci-num">Image</th><th class="ci-num">Video</th><th>Last seen</th></tr></thead>'
      +'<tbody>'+summary+'</tbody></table></div>'
    +'<div class="ci-bar">'
      +compSelHtml('ciGWl',opts,CI_F.wl,"ciGSet('wl',this.value)")
      +compSelHtml('ciGFmt',[['all','All formats'],['text','Text ads'],['image','Image ads'],['video','Video ads']],CI_F.fmt,"ciGSet('fmt',this.value)")
      +compSelHtml('ciGRec',[['all','Any time'],['30','Running in last 30 days']],CI_F.recent,"ciGSet('recent',this.value)")
      +ciSearchInput('ciGQ','q','ciGadsPaint','Search the ads\' words')
      +'<span style="margin-left:auto;font-size:12.5px;color:var(--slate)">'+ciN(rows.length)+' ad'+(rows.length===1?'':'s')+'</span>'
    +'</div>'
    +(rows.length?'<div class="ci-grid">'+shown.map(function(a){ return ciAdCard(a,CI_F.wl==='all'&&wlIds.length>1); }).join('')+'</div>'
      +(rows.length>shown.length?'<div style="text-align:center;margin:18px 0 6px"><button class="btn" onclick="CI_SHOW+=CI_PAGE;ciGadsPaint()">Show more <span style="color:var(--slate);font-weight:500">('+ciN(shown.length)+' of '+ciN(rows.length)+' shown)</span></button></div>':'')
      :'<div class="card card-pad" style="color:var(--slate)">No ads for this selection yet.</div>');
}
window.ciGSet=function(k,v){ CI_F[k]=CI_F[k]===v&&k==='wl'?'all':v; CI_SHOW=CI_PAGE; ciGadsPaint(); };
// One ad, full size, inside JainE: the picture, the text ad as Google lays it out, or the video.
window.ciAdOpen=function(id){
  const a=(window._ciAds||[]).filter(function(x){ return x.creative_id===id; })[0];
  if(!a) return;
  const W=window._ciWl||{};
  let main;
  if(a.video_id) main='<div style="position:relative;width:100%;max-width:760px;margin:0 auto;aspect-ratio:16/9;background:#000;border-radius:10px;overflow:hidden">'
    +'<iframe src="https://www.youtube-nocookie.com/embed/'+encodeURIComponent(a.video_id)+'?rel=0" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>';
  else if(a.image_url) main='<div style="text-align:center;background:#f1f5f9;border-radius:10px;padding:14px"><img src="'+esc(a.image_url)+'" referrerpolicy="no-referrer" style="max-width:100%;max-height:70vh" alt=""></div>';
  else if(a.ad_image_url) main='<div style="text-align:center;background:#f1f5f9;border-radius:10px;padding:14px"><img src="'+esc(a.ad_image_url)+'" referrerpolicy="no-referrer" style="max-width:100%;max-height:60vh" alt=""></div>';
  else if(a.ad_headline) main=ciSerp(a,true);
  else main='<div class="card card-pad" style="text-align:center;color:var(--slate)">'+(a.detail_at?'Google does not show this ad\'s content.':'This ad\'s content is still being read from Google - it shows here within a few hours.')+'</div>';
  // The words of a video / picture ad, under it, when Google gives them.
  const words=(a.video_id||a.image_url||a.ad_image_url)&&(a.ad_headline||a.ad_description)
    ?'<div style="margin-top:14px;font-size:13.5px;line-height:1.55">'
      +(a.ad_headline?'<div style="font-weight:700;font-size:15px">'+ciKw(a.ad_headline)+'</div>':'')
      +(a.ad_long_headline&&a.ad_long_headline!==a.ad_headline?'<div>'+esc(a.ad_long_headline)+'</div>':'')
      +(a.ad_description?'<div style="color:var(--slate)">'+esc(a.ad_description)+'</div>':'')
      +(a.ad_cta?'<div style="margin-top:6px"><span class="tag t-blue">'+esc(a.ad_cta)+'</span></div>':'')
    +'</div>':'';
  const kwNote=/\{key[wW]ord:/i.test((a.ad_headline||'')+(a.ad_description||''))?'<div style="font-size:12px;color:var(--slate);margin-top:8px"><i class="fa-solid fa-circle-info"></i> The underlined words change: Google puts in what the person searched for, and shows these words otherwise.</div>':'';
  const fact=function(k,v){ return '<div><div style="font-size:11px;color:var(--slate);text-transform:uppercase;letter-spacing:.04em">'+k+'</div><div style="font-weight:600">'+v+'</div></div>'; };
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-rectangle-ad"></i> '+esc((W[a.watchlist_id]||{}).name||'Ad')+' - '+esc(CI_FMT_WORD[a.format]||'Ad')+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body">'+CI_CSS+main+words+kwNote
      +'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:16px;font-size:13px">'
        +fact('Running since',fmtDate(a.first_shown))+fact('Last seen',fmtDate(a.last_shown))
        +fact('Status',ciRecent(a)?'<span style="color:#15803d">Active (last 30 days)</span>':'Not seen in 30 days')
        +(a.days_shown!=null?fact('Days Google showed it',ciN(a.days_shown)):'')
      +'</div>'
      +'<div style="font-size:11px;color:var(--slate);margin-top:14px">From Google\'s public Ads Transparency Center (India) · ad '+esc(a.creative_id)+'</div>'
    +'</div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>','lg');
};

// ---------------------------------------------------------------- RERA
/* ONLY THE FOLLOWED COMPANIES' PROJECTS, on both pages (16 Oct 2026, as asked): Competitor Data
   shows our competitors' projects and nothing else - no whole register, no search across it, no
   other companies, no register-wide counts. WBRERA lists projects by the PROMOTER - the legal
   company - and prints that name only on each project's own page, so which companies are a
   competitor's is set by hand in camp.pi_targets (source 'rera', kind 'promoter', watchlist_id of
   the competitor), from names the user has confirmed - never guessed from project names. The
   collector still reads every project page in the background, because that is how a competitor's
   projects are found; until a competitor's companies are confirmed the tab only says so. Our Brand
   follows our own promoter the same way. */
async function ciRera(){
  const tg=await sb.schema('camp').from('pi_targets').select('*').eq('source','rera');
  const brand=CI_SCOPE==='brand';
  const targets=(tg.data||[]).filter(function(t){ return t.active!==false&&ciTargetScope(t)===(brand?'brand':'competitor'); });
  const names=targets.map(function(t){ return String(t.value); });
  const cols='procode,project_id,name,reg_no,reg_date,completion_date,district,block,project_status,extension_date,apartments,promoter_name,source_url';
  const [projects,ch]=await Promise.all([
    names.length?ciAll(function(){ return sb.schema('camp').from('pi_rera_projects').select(cols).in('promoter_name',names).order('reg_date',{ascending:false}); }):Promise.resolve([]),
    names.length?sb.schema('camp').from('pi_rera_changes').select('*').order('changed_at',{ascending:false}).limit(300):Promise.resolve({data:[]})
  ]);
  window._ciRera=projects; window._ciRTargets=targets;
  // Changes only for the projects shown; the change log itself does not carry a promoter.
  const on={}; projects.forEach(function(p){ on[p.procode]=1; });
  window._ciRChanges=(ch.data||[]).filter(function(c){ return on[c.procode]; }).slice(0,30);
  await ciStatus(['rera_list','rera_detail'],(brand?'Our':'Our competitors\'')+' projects on the public <a href="https://rera.wb.gov.in/district_project.php?dcode=0" target="_blank" rel="noopener">West Bengal RERA register</a>: area, status, number of flats, registration, promised completion and any extension. Each project\'s page is re-read regularly and changes are listed.');
  ciReraPaint();
}
function ciReraTable(list,withCompany){
  const tr=function(p){
    return '<tr><td><a href="'+esc(p.source_url||('https://rera.wb.gov.in/project_details.php?procode='+p.procode))+'" target="_blank" rel="noopener"><b>'+esc(p.name||'')+'</b></a><div style="font-size:11px;color:var(--slate)">'+esc(p.reg_no||'')+'</div></td>'
      +(withCompany?'<td style="font-size:12px">'+esc(p.promoter_name||'')+'</td>':'')
      +'<td>'+esc([p.block,p.district].filter(Boolean).join(', ')||'—')+'</td>'
      +'<td>'+esc(p.project_status||'—')+'</td>'
      +'<td class="ci-num">'+(p.apartments==null?'—':ciN(p.apartments))+'</td>'
      +'<td>'+fmtDate(p.reg_date)+'</td><td>'+fmtDate(p.completion_date)+'</td>'
      +'<td>'+esc(p.extension_date&&p.extension_date!=='NA'?p.extension_date:'—')+'</td></tr>';
  };
  return '<div style="overflow-x:auto"><table class="tbl" style="width:100%;font-size:12.5px">'
    +'<thead><tr><th>Project</th>'+(withCompany?'<th>Company on RERA</th>':'')+'<th>Area</th><th>Status</th><th class="ci-num">Flats</th><th>Registered</th><th>Completion</th><th>Extended to</th></tr></thead>'
    +'<tbody>'+list.map(tr).join('')+'</tbody></table></div>';
}
function ciReraPaint(){
  const all=window._ciRera||[], targets=window._ciRTargets||[], brand=CI_SCOPE==='brand', W=window._ciWl||{};
  if(!targets.length){
    $('ciBody').innerHTML='<div class="ci-explain">'+(brand?'No promoter of ours is followed yet.'
      :'<b>Competitor projects will appear here</b> once the RERA project pages have been read and the companies that belong to each competitor are confirmed. RERA lists every project under the legal company that registered it, so those names are checked with you rather than guessed.')+'</div>';
    return;
  }
  // Projects of each followed company, grouped under the brand / competitor it belongs to.
  const byWl={}; targets.forEach(function(t){ const k=t.watchlist_id||0; (byWl[k]=byWl[k]||{})[String(t.value).toLowerCase()]=1; });
  const sections=Object.keys(byWl).map(function(id){
    const names=byWl[id];
    const ps=all.filter(function(p){ return names[String(p.promoter_name||'').toLowerCase()]; });
    const flats=ps.reduce(function(s,p){ return s+(p.apartments||0); },0);
    return '<div class="card" style="margin-bottom:14px"><div style="padding:12px 15px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--line)">'
        +'<b style="font-size:14px">'+esc((W[id]||{}).name||'Followed company')+'</b>'
        +'<span class="tag t-gray">'+ps.length+' project'+(ps.length===1?'':'s')+'</span><span class="tag t-gray">'+ciN(flats)+' flats</span>'
        +'<span style="margin-left:auto;font-size:11.5px;color:var(--slate)">on RERA as '+esc(targets.filter(function(t){ return String(t.watchlist_id||0)===id; }).map(function(t){ return t.value; }).join(', '))+'</span></div>'
      +(ps.length?ciReraTable(ps,Object.keys(names).length>1):'<div class="card-pad" style="color:var(--slate);font-size:12.5px">No projects found yet - they appear as the RERA project pages are read.</div>')
    +'</div>';
  }).join('');
  const chg=(window._ciRChanges||[]).map(function(c){
    const p=all.filter(function(x){ return x.procode===c.procode; })[0]||{};
    return '<tr><td>'+ciDateTime(c.changed_at)+'</td><td>'+esc(p.name||c.procode)+'</td><td>'+esc(c.field)+'</td><td>'+esc(c.old_value||'—')+'</td><td>'+esc(c.new_value||'—')+'</td></tr>';
  }).join('');
  const changes=chg?'<div class="card" style="overflow-x:auto;margin-bottom:14px"><div style="padding:10px 14px;font-weight:700;font-size:13px">Recent changes</div><table class="tbl" style="width:100%;font-size:12.5px"><thead><tr><th>Seen</th><th>Project</th><th>What</th><th>Was</th><th>Now</th></tr></thead><tbody>'+chg+'</tbody></table></div>':'';
  $('ciBody').innerHTML=sections+changes;
}

// ---------------------------------------------------------------- Search Trends
/* Google Trends gives an index, not search counts, so each group is explained in plain words and
   summed up per term in a small table - average interest over the year, the last 4 weeks against
   the 4 before, and the busiest week - with the chart underneath. All figures are worked out from
   Google's weekly values exactly as stored; a term Google had too little data for is marked, not
   drawn as zero. */
// Names that unrelated companies share, so their searches are mixed into the line.
const CI_SHARED_NAMES=['ps group','orbit group','siddha group'];
async function ciTrends(){
  const [pts,tg,runs]=await Promise.all([
    ciAll(function(){ return sb.schema('camp').from('pi_trends_points').select('*').order('week_start'); }),
    sb.schema('camp').from('pi_targets').select('*').eq('source','trends').order('grp').order('sort'),
    sb.schema('camp').from('pi_runs').select('unit,ok,refused,started_at').eq('source','trends').not('ok','is',null).order('started_at',{ascending:false}).limit(100)
  ]);
  /* A group is drawn whole or not at all - Google scales every term in a request against the
     others in that same request, so lifting one term out of its chart would change what its line
     means. A group belongs to the side its terms belong to (the anchor term has no owner and does
     not count); a group with no owned term at all is market context, shown on Competitor Data. */
  const all=tg.data||[];
  const side={};
  all.forEach(function(t){ if(t.kind==='anchor'||!t.watchlist_id) return; side[t.grp]=side[t.grp]||ciTargetScope(t); });
  const market={};
  const keep=all.filter(function(t){
    const s=side[t.grp]||'market'; if(s==='market') market[t.grp]=1;
    return s===CI_SCOPE||(s==='market'&&CI_SCOPE==='competitor');
  });
  window._ciPts=pts; window._ciTT=keep; window._ciTMarket=market; window._ciTRuns=runs.data||[];
  await ciStatus(['trends'],'How much people searched Google for each name, week by week over the last 12 months, from <a href="https://trends.google.com/trends/explore?geo=IN-WB" target="_blank" rel="noopener">Google Trends</a>. Each chart is refreshed weekly.');
  ciTrendsPaint();
}
/* A week Google marks as having too few searches to measure (has_data false) is drawn as 0 on
   Google's own chart, and Google's help says the same: 0 means not enough data. It is counted as 0
   here too - averaging only the few measurable weeks would make a rarely searched name look busy.
   How many weeks were measurable is returned, so the screen can say so. */
const ciTV=function(x){ return x.has_data?Number(x.value):0; };
function ciTrendsStats(p,term){
  const pts=p.filter(function(x){ return x.term===term; }).sort(function(a,b){ return a.week_start<b.week_start?-1:1; });
  const hd=pts.filter(function(x){ return x.has_data; });
  if(!hd.length) return null;
  const avg=function(a){ return a.length?a.reduce(function(s,x){ return s+ciTV(x); },0)/a.length:null; };
  const last4=pts.slice(-4), prev4=pts.slice(-8,-4);
  const peak=hd.reduce(function(m,x){ return Number(x.value)>Number(m.value)?x:m; },hd[0]);
  return {avg:avg(pts),last:avg(last4),prev:prev4.length===4?avg(prev4):null,peak:peak,weeks:pts.length,measured:hd.length};
}
function ciTrendsPaint(){
  const pts=window._ciPts||[], tg=window._ciTT||[];
  const groups=[]; tg.forEach(function(t){ if(groups.indexOf(t.grp)<0) groups.push(t.grp); });
  if(!groups.length){
    $('ciBody').innerHTML='<div class="card card-pad" style="color:var(--slate);font-size:13px"><i class="fa-solid fa-circle-info"></i> No Search Trends group is followed for '+esc(CI_SCOPE_WORD[CI_SCOPE]||CI_SCOPE)+' yet.</div>';
    return;
  }
  const region=CI_F.geo==='IN'?'India':'West Bengal';
  const colors=['#0369a1','#16a34a','#d97706','#7c3aed','#94a3b8'];
  let html='<div class="ci-explain"><b>How to read this.</b> Google does not say how many searches there were. It gives each week a score from <b>0 to 100</b>: <b>100</b> is the busiest week of the busiest name <i>in that chart</i>, and every other week is a share of that (50 = half as many searches). So scores compare names <i>within one chart</i>, not between charts. A week with too few searches for Google to measure counts as 0, the same as on the Google Trends chart. '
      +'Every chart includes "flats in kolkata" as a common yardstick. Kolkata on its own is not offered by Google Trends, so the choice is West Bengal or all of India.</div>'
    +'<div class="ci-bar"><span style="font-size:13px;font-weight:600">Searches made in</span>'
    +compSelHtml('ciTGeo',[['IN-WB','West Bengal'],['IN','India']],CI_F.geo,"CI_F.geo=this.value;ciTrendsPaint()")+'</div>'
    +'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(480px,100%),1fr));gap:14px">';
  groups.forEach(function(g,gi){
    const p=pts.filter(function(x){ return x.grp===g&&x.geo===CI_F.geo; });
    const mine=(window._ciTRuns||[]).filter(function(r){ return r.unit===g+'|'+CI_F.geo; });
    const lastTry=mine[0];
    const failNote=lastTry&&!lastTry.ok?'<div style="font-size:11.5px;color:#b45309;margin-top:8px"><i class="fa-solid fa-triangle-exclamation"></i> '
      +(lastTry.refused?'Google asked us to slow down':'The latest read failed')+' '+ciAgo(lastTry.started_at)+(p.length?' - these figures are from the read before.':'.')+' It is tried again by itself later.</div>':'';
    const terms=tg.filter(function(t){ return t.grp===g; });
    const shared=terms.filter(function(t){ return CI_SHARED_NAMES.indexOf(String(t.value).toLowerCase())>=0; }).map(function(t){ return t.value; });
    const rows=terms.map(function(t,i){
      const s=p.length?ciTrendsStats(p,t.value):null;
      const dot='<span style="display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;background:'+(t.kind==='anchor'?colors[4]:colors[i%4])+'"></span>';
      const name=dot+esc(t.value)+(t.kind==='anchor'?' <span style="font-size:11px;color:var(--slate)">(yardstick)</span>':'');
      if(!s) return '<tr><td>'+name+'</td><td colspan="3" style="color:#b45309;font-size:12px">'+(p.length?'Too few searches - Google shows no figures for this name':'Not read yet')+'</td></tr>';
      let trend='<span class="ci-flat">—</span>';
      if(s.prev!=null){
        const a=Math.round(s.prev), b=Math.round(s.last);
        trend=b>a?'<span class="ci-up">▲ up</span> <span style="color:var(--slate);font-size:11.5px">('+a+' → '+b+')</span>'
          :b<a?'<span class="ci-down">▼ down</span> <span style="color:var(--slate);font-size:11.5px">('+a+' → '+b+')</span>'
          :'<span class="ci-flat">same ('+a+')</span>';
      }
      const thin=s.measured<s.weeks/2?'<div style="font-size:11px;color:#b45309;margin-left:16px">enough searches to measure in only '+s.measured+' of '+s.weeks+' weeks</div>':'';
      const av=s.avg<1&&s.avg>0?'&lt;1':Math.round(s.avg);
      return '<tr><td>'+name+thin+'</td><td class="ci-num"><b>'+av+'</b></td><td>'+trend+'</td><td style="font-size:12px">'+fmtDate(s.peak.week_start)+' <span style="color:var(--slate)">('+s.peak.value+')</span></td></tr>';
    }).join('');
    html+='<div class="card card-pad"><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><b style="font-size:14px">'+esc(g)+'</b>'
      +((window._ciTMarket||{})[g]?' <span class="tag t-gray" title="None of these terms is a company - general searches for the market">market</span>':'')
      +'<span style="margin-left:auto;font-size:11.5px;color:var(--slate)">'+(p.length?'updated '+ciAgo(p[0].fetched_at):'not read yet')+'</span></div>'
      +'<div style="font-size:12.5px;color:var(--slate);margin-bottom:10px">Searches in '+region+' for these names over the last 12 months, compared with each other.</div>'
      +'<table class="tbl" style="width:100%;font-size:12.5px;margin-bottom:12px"><thead><tr><th>Search term</th><th class="ci-num" title="Average weekly score over the 12 months (0-100)">Average interest</th><th title="Average of the last 4 weeks against the 4 weeks before">Last 4 weeks vs 4 before</th><th title="The week with the highest score">Busiest week</th></tr></thead><tbody>'+rows+'</tbody></table>'
      +(shared.length?'<div style="font-size:11.5px;color:#b45309;margin-bottom:10px"><i class="fa-solid fa-circle-info"></i> '+esc(shared.join(', '))+(shared.length===1?' is a name':' are names')+' other, unrelated companies also use, so '+(shared.length===1?'its line':'their lines')+' may include searches for them.</div>':'')
      +(p.length?'<div style="height:220px"><canvas id="ciTC'+gi+'"></canvas></div>':'')
      +failNote
    +'</div>';
  });
  $('ciBody').innerHTML=html+'</div>';
  groups.forEach(function(g,gi){
    const c=$('ciTC'+gi); if(!c||typeof Chart==='undefined') return;
    const p=pts.filter(function(x){ return x.grp===g&&x.geo===CI_F.geo; });
    const weeks=[]; p.forEach(function(x){ if(weeks.indexOf(x.week_start)<0) weeks.push(x.week_start); });
    const terms=tg.filter(function(t){ return t.grp===g; });
    new Chart(c,{type:'line',data:{labels:weeks.map(function(w){ return fmtDateShort(w); }),datasets:terms.map(function(t,i){
      return {label:t.value,data:weeks.map(function(w){ const x=p.filter(function(y){ return y.week_start===w&&y.term===t.value; })[0]; return x?ciTV(x):null; }),
        borderColor:t.kind==='anchor'?colors[4]:colors[i%4],borderDash:t.kind==='anchor'?[4,4]:[],borderWidth:2,pointRadius:0,tension:.25,spanGaps:false};
    })},options:{maintainAspectRatio:false,interaction:{mode:'index',intersect:false},scales:{y:{min:0,max:100,title:{display:true,text:'interest (0-100)'}}},plugins:{legend:{position:'bottom',labels:{usePointStyle:true,boxWidth:7,font:{size:11}}}}}});
  });
}
