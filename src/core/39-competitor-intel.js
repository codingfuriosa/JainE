
/* ---- Google Ads Transparency, RERA Projects, Search Trends tabs ------------------------------
   Public, logged-out data collected by the public-intel edge function (see its header): Google's
   Ads Transparency Center, the WBRERA project register, and Google Trends.
   Every figure on these tabs links back to the public page it came from and shows when it was
   read; a failed read is shown as failed, never filled in.

   ONE SET OF RENDERERS, THREE PAGES. These tabs first sat on the old Competitor Ads page with ours
   and theirs mixed. The marketing modules were then split by whose data it is, so ciTabView() is
   now called by each page shell in src/core/40-marketing-modules.js with a scope:
     'brand'      - Our Brand        (campaigns/google-ads, campaigns/trends, campaigns/rera)
     'competitor' - Competitor Data  (competitors/google-ads, competitors/trends, competitors/rera)
     'partner'    - Channel Partners (channel_partners/google-ads)
   WHOSE A ROW IS comes from camp.pi_targets.watchlist_id -> camp.competitor_watchlist.category
   ('brand' / 'competitor' / 'partner'; old rows without a category fall back to is_own_brand,
   the same rule as the Meta tabs - compCategoryOf()). A followed target with no watchlist row is
   counted as a competitor, except a Search Trends group none of whose terms belongs to anybody
   (the "Localities" group): that is the market, not a company, and is shown on Competitor Data
   only, labelled as such.                                                                       */
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
const CI_SOURCE_LABEL={google_ads:'Google Ads',rera_list:'RERA project list',rera_detail:'RERA project pages',trends:'Google Trends'};
let CI_F={wl:'all',fmt:'all',recent:'all',q:'',rq:'',rdist:'all',rfollow:'followed',geo:'IN-WB'};

const CI_CSS='<style>'
  +'.ci-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--bg-card);margin-bottom:14px}'
  +'.ci-bar select{height:36px;padding:0 11px;border:1px solid var(--line);border-radius:9px;font-size:13px;font-weight:600;font-family:inherit;background:var(--bg-card);color:var(--ink);cursor:pointer}'
  +'.ci-bar input{height:36px;padding:0 11px;border:1px solid var(--line);border-radius:9px;font-size:13px;font-family:inherit;background:var(--bg-card);color:var(--ink);flex:1;min-width:200px;max-width:360px}'
  +'</style>';
// Typing in a search box redraws the list; put the cursor back where it was.
function ciSearchInput(id,key,paint,ph){
  return '<input id="'+id+'" placeholder="'+esc(ph)+'" value="'+esc(CI_F[key])+'" oninput="CI_F.'+key+'=this.value;clearTimeout(window._ciT);window._ciT=setTimeout(function(){'+paint+'();var e=document.getElementById(\''+id+'\');if(e){e.focus();e.setSelectionRange(e.value.length,e.value.length);}},350)">';
}
function ciAgo(d){
  if(!d) return '—';
  const m=Math.round((Date.now()-new Date(d).getTime())/60000);
  if(m<1) return 'just now'; if(m<60) return m+' min ago';
  const h=Math.round(m/60); if(h<48) return h+' h ago';
  return Math.round(h/24)+' days ago';
}
function ciDateTime(d){ return d?new Date(d).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—'; }
async function ciAll(q){
  // PostgREST pages at 1000 rows; the RERA register is ~5,000.
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

// ---------------------------------------------------------------- collection status + Fetch now
async function ciRunsPanel(sources,blurb){
  const {data}=await sb.schema('camp').from('pi_runs').select('*').in('source',sources).order('started_at',{ascending:false}).limit(40);
  const runs=data||[];
  const last={}; runs.forEach(function(r){ if(!last[r.source]) last[r.source]=r; });
  const chips=sources.map(function(s){
    const r=last[s];
    if(!r) return '<span class="tag t-gray">'+esc(CI_SOURCE_LABEL[s])+': not run yet</span>';
    const cls=r.ok===true?'t-green':(r.ok===false?(r.refused?'t-amber':'t-red'):'t-gray');
    const word=r.ok===true?'ok':(r.ok===false?(r.refused?'site asked us to slow down':'failed'):'running');
    return '<span class="tag '+cls+'" title="'+esc((r.error||r.note||'')+' ('+(r.unit||'')+')')+'">'+esc(CI_SOURCE_LABEL[s])+': '+word+' · '+ciAgo(r.started_at)+'</span>';
  }).join(' ');
  const rows=runs.slice(0,25).map(function(r){
    return '<tr><td>'+ciDateTime(r.started_at)+'</td><td>'+esc(CI_SOURCE_LABEL[r.source]||r.source)+'</td>'
      +'<td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(r.unit||'')+'">'+esc(r.unit||'')+'</td>'
      +'<td>'+(r.ok===true?'<span class="tag t-green">ok</span>':r.ok===false?(r.refused?'<span class="tag t-amber">refused</span>':'<span class="tag t-red">failed</span>'):'<span class="tag t-gray">running</span>')+'</td>'
      +'<td style="text-align:right">'+(r.items==null?'—':r.items)+'</td>'
      +'<td style="font-size:11.5px;color:var(--slate);max-width:420px;word-break:break-word">'+esc(r.error||r.note||'')+'</td></tr>';
  }).join('');
  const btn=sources.filter(function(s){ return s!=='rera_list'; })[0];
  $('ciRuns').innerHTML='<div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;margin:0 0 12px">'
      +'<p style="color:var(--slate);margin:0;flex:1;min-width:240px;font-size:13px">'+blurb+'</p>'
      +'<button class="btn" id="ciFetchBtn" onclick="ciFetchNow(\''+btn+'\')"><i class="fa-solid fa-rotate"></i> Fetch next now</button>'
    +'</div>'
    +'<details class="card" style="margin-bottom:14px"><summary style="cursor:pointer;padding:11px 15px;font-size:13px;list-style:none;display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
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
    else if(r.ok) toast('Fetched '+(r.items||0)+' row(s) - '+(r.unit||''),'ok');
    else toast('Failed: '+(r.error||'unknown'),'err');
  }catch(e){ toast('Fetch failed: '+(e.message||e),'err'); }
  navTo(CI_ROUTE);
};

// ---------------------------------------------------------------- Google Ads
async function ciGads(){
  await ciRunsPanel(['google_ads'],'Ads that Google shows in its public <a href="https://adstransparency.google.com/?region=IN" target="_blank" rel="noopener">Ads Transparency Center</a> for India - the creative, its format, and the first and last day Google shows it running. Google does not publish spend or clicks. Each advertiser is read once a day.');
  // Only the open side's advertisers, and only their creatives (asked for by watchlist id, so a
  // busy competitor's thousands are never downloaded to draw our own handful).
  const tg=await sb.schema('camp').from('pi_targets').select('*').eq('source','google_ads').order('sort');
  const targets=(tg.data||[]).filter(function(t){ return t.watchlist_id&&ciTargetScope(t)===CI_SCOPE; });
  const ids=[]; targets.forEach(function(t){ if(ids.indexOf(t.watchlist_id)<0) ids.push(t.watchlist_id); });
  const ads=ids.length?await ciAll(function(){ return sb.schema('camp').from('pi_gads_creatives').select('creative_id,advertiser_id,advertiser_name,domain,format,first_shown,last_shown,days_shown,image_url,watchlist_id,fetched_at,first_seen_at,source_url').in('watchlist_id',ids).order('last_shown',{ascending:false}); }):[];
  window._ciAds=ads; window._ciGTargets=targets;
  if(CI_F.wl!=='all'&&ids.map(String).indexOf(CI_F.wl)<0) CI_F.wl='all';
  ciGadsPaint();
}
function ciGadsPaint(){
  const ads=window._ciAds||[], targets=window._ciGTargets||[], W=window._ciWl||{};
  const wlIds=[]; targets.forEach(function(t){ if(t.watchlist_id&&wlIds.indexOf(t.watchlist_id)<0) wlIds.push(t.watchlist_id); });
  if(!wlIds.length){
    $('ciBody').innerHTML='<div class="card card-pad" style="color:var(--slate);font-size:13px"><i class="fa-solid fa-circle-info"></i> No Google advertiser is followed for '+esc(CI_SCOPE_WORD[CI_SCOPE]||CI_SCOPE)+' yet. '
      +'Followed advertisers are rows in camp.pi_targets (source google_ads) whose watchlist entry is '+(CI_SCOPE==='partner'?'a channel partner':CI_SCOPE==='brand'?'one of our brands':'a competitor')+'; there is no screen to add them yet.</div>';
    return;
  }
  const since30=Date.now()-30*864e5;
  const summary=wlIds.map(function(id){
    const a=ads.filter(function(x){ return x.watchlist_id===id; });
    const cnt=function(f){ return a.filter(function(x){ return x.format===f; }).length; };
    const recent=a.filter(function(x){ return x.last_shown&&new Date(x.last_shown).getTime()>=since30; }).length;
    const who=targets.filter(function(t){ return t.watchlist_id===id; }).map(function(t){
      const url=t.kind==='advertiser'?'https://adstransparency.google.com/advertiser/'+t.value+'?region=IN':'https://adstransparency.google.com/?region=IN&domain='+encodeURIComponent(t.value);
      return '<a href="'+url+'" target="_blank" rel="noopener" title="'+esc(t.kind)+'">'+esc(t.label||t.value)+'</a>';
    }).join('<br>');
    const w=W[id]||{};
    return '<tr style="cursor:pointer" onclick="ciGSet(\'wl\',\''+id+'\')"><td><b>'+esc(w.name||('#'+id))+'</b> '+(w.category==='brand'?'<span class="tag t-blue">ours</span>':'')+'</td>'
      +'<td style="font-size:11.5px">'+who+'</td>'
      +'<td style="text-align:center">'+a.length+'</td><td style="text-align:center">'+recent+'</td>'
      +'<td style="text-align:center">'+cnt('text')+'</td><td style="text-align:center">'+cnt('image')+'</td><td style="text-align:center">'+cnt('video')+'</td></tr>';
  }).join('');
  const q=(CI_F.q||'').toLowerCase();
  const rows=ads.filter(function(a){
    if(CI_F.wl!=='all'&&String(a.watchlist_id)!==CI_F.wl) return false;
    if(CI_F.fmt!=='all'&&a.format!==CI_F.fmt) return false;
    if(CI_F.recent==='30'&&!(a.last_shown&&new Date(a.last_shown).getTime()>=since30)) return false;
    if(q&&[a.advertiser_name,a.domain,a.creative_id].join(' ').toLowerCase().indexOf(q)<0) return false;
    return true;
  });
  const opts=[['all','All advertisers']].concat(wlIds.map(function(id){ return [String(id),(W[id]||{}).name||('#'+id)]; }));
  const card=function(a){
    return '<div class="card" style="overflow:hidden;display:flex;flex-direction:column">'
      +'<div style="height:150px;background:var(--bg-soft,#f1f5f9);display:flex;align-items:center;justify-content:center;overflow:hidden">'
        +(a.image_url?'<img src="'+esc(a.image_url)+'" loading="lazy" referrerpolicy="no-referrer" style="max-width:100%;max-height:150px;object-fit:contain">'
          :'<a href="'+esc(a.source_url)+'" target="_blank" rel="noopener" style="font-size:12.5px;text-align:center;padding:10px"><i class="fa-solid '+(a.format==='video'?'fa-video':'fa-font')+'" style="font-size:22px;display:block;margin-bottom:6px"></i>'+(a.format==='video'?'Video ad':'Text ad')+' - open on Google</a>')
      +'</div>'
      +'<div style="padding:9px 11px;font-size:12px;line-height:1.5">'
        +'<div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(a.advertiser_name||'')+'">'+esc(a.advertiser_name||a.advertiser_id)+'</div>'
        +'<div style="color:var(--slate)">'+esc(a.domain||'')+' · <span class="tag t-gray">'+esc(a.format||'?')+'</span></div>'
        +'<div>'+fmtDate(a.first_shown)+' → '+fmtDate(a.last_shown)+(a.days_shown!=null?' · '+a.days_shown+' days':'')+'</div>'
        +'<div style="color:var(--slate);font-size:11px">read '+ciAgo(a.fetched_at)+' · <a href="'+esc(a.source_url)+'" target="_blank" rel="noopener">source</a></div>'
      +'</div></div>';
  };
  $('ciBody').innerHTML='<div class="card" style="margin-bottom:14px;overflow-x:auto"><table class="tbl" style="width:100%;font-size:12.5px">'
      +'<thead><tr><th>'+({brand:'Brand',competitor:'Competitor',partner:'Channel partner'}[CI_SCOPE]||'Brand / competitor')+'</th><th>Google advertiser / website</th><th style="text-align:center">Ads stored</th><th style="text-align:center" title="Last shown within 30 days">Shown in last 30 days</th><th style="text-align:center">Text</th><th style="text-align:center">Image</th><th style="text-align:center">Video</th></tr></thead>'
      +'<tbody>'+summary+'</tbody></table></div>'
    +'<div class="ci-bar">'
      +compSelHtml('ciGWl',opts,CI_F.wl,"ciGSet('wl',this.value)")
      +compSelHtml('ciGFmt',[['all','All formats'],['text','Text'],['image','Image'],['video','Video']],CI_F.fmt,"ciGSet('fmt',this.value)")
      +compSelHtml('ciGRec',[['all','Any time'],['30','Shown in last 30 days']],CI_F.recent,"ciGSet('recent',this.value)")
      +ciSearchInput('ciGQ','q','ciGadsPaint','Search advertiser or website')
      +'<span style="margin-left:auto;font-size:12.5px;color:var(--slate)">'+rows.length+' ad'+(rows.length===1?'':'s')+(rows.length>200?' (first 200 shown)':'')+'</span>'
    +'</div>'
    +(rows.length?'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">'+rows.slice(0,200).map(card).join('')+'</div>'
      :'<div class="card card-pad" style="color:var(--slate)">No ads stored for this selection yet.</div>');
}
window.ciGSet=function(k,v){ CI_F[k]=v; ciGadsPaint(); };

// ---------------------------------------------------------------- RERA
async function ciRera(){
  await ciRunsPanel(['rera_list','rera_detail'],'Every project on the public <a href="https://rera.wb.gov.in/district_project.php?dcode=0" target="_blank" rel="noopener">WBRERA register</a>. The list is read weekly; each project\'s own page (promoter, flats, areas, status, extension) is read one by one, a few a minute - the first full pass takes about three days. Followed promoters are re-read weekly and changes are logged.');
  /* Our Brand sees only our own promoters' projects: the register is read for exactly those names
     (WBRERA's spelling, which is what pi_targets stores) instead of all ~5,000 projects. Competitor
     Data reads the whole register, because "All promoters" is where new competitor promoters get
     picked out - but every project of one of OUR promoters is taken out of it first. */
  const tg=await sb.schema('camp').from('pi_targets').select('*').eq('source','rera');
  const allTargets=tg.data||[];
  const ownNames=allTargets.filter(function(t){ return ciTargetScope(t)==='brand'; }).map(function(t){ return String(t.value); });
  const cols='procode,project_id,name,reg_no,reg_date,completion_date,district,block,project_status,extension_date,apartments,land_area_sqm,promoter_name,promoter_cin,promoter_website,litigations,detail_fetched_at,detail_error,source_url,list_seen_at';
  const brand=CI_SCOPE==='brand';
  const [projects,ch,rej]=await Promise.all([
    brand?(ownNames.length?ciAll(function(){ return sb.schema('camp').from('pi_rera_projects').select(cols).in('promoter_name',ownNames).order('reg_date',{ascending:false}); }):Promise.resolve([]))
      :ciAll(function(){ return sb.schema('camp').from('pi_rera_projects').select(cols).order('reg_date',{ascending:false}); }),
    sb.schema('camp').from('pi_rera_changes').select('*').order('changed_at',{ascending:false}).limit(brand?200:60),
    sb.schema('camp').from('pi_rera_rejected').select('project_id',{count:'exact',head:true})
  ]);
  const own={}; ownNames.forEach(function(n){ own[n.toLowerCase()]=1; });
  const mine=projects.filter(function(p){ return !!own[String(p.promoter_name||'').toLowerCase()]; });
  window._ciRera=brand?mine:projects.filter(function(p){ return !own[String(p.promoter_name||'').toLowerCase()]; });
  window._ciRTargets=allTargets.filter(function(t){ return ciTargetScope(t)===(brand?'brand':'competitor'); });
  // Changes only for projects on this side; the change log itself does not carry a promoter.
  const on={}; window._ciRera.forEach(function(p){ on[p.procode]=1; });
  window._ciRChanges=(ch.data||[]).filter(function(c){ return on[c.procode]; }).slice(0,30);
  window._ciRRej=rej.count||0;
  if(brand) CI_F.rfollow='followed';
  ciReraPaint();
}
function ciReraPaint(){
  const all=window._ciRera||[], targets=window._ciRTargets||[], brand=CI_SCOPE==='brand';
  const followed={}; targets.forEach(function(t){ followed[String(t.value).toLowerCase()]=t; });
  const read=all.filter(function(p){ return p.detail_fetched_at; }).length;
  const failed=all.filter(function(p){ return p.detail_error; }).length;
  const dists={}; all.forEach(function(p){ if(p.district) dists[p.district]=1; });
  const q=(CI_F.rq||'').toLowerCase();
  const rows=all.filter(function(p){
    // A search looks through the whole register; without one, the chosen promoter filter applies.
    if(!q&&CI_F.rfollow==='followed'&&!followed[String(p.promoter_name||'').toLowerCase()]) return false;
    if(CI_F.rdist!=='all'&&p.district!==CI_F.rdist) return false;
    if(q&&[p.name,p.promoter_name,p.district,p.block,p.reg_no,p.project_id].join(' ').toLowerCase().indexOf(q)<0) return false;
    return true;
  });
  // Promoters among the rows, biggest first - this is where competitor promoters get picked out.
  const byProm={}; rows.forEach(function(p){
    const k=p.promoter_name||'(page not read yet)';
    const o=byProm[k]||(byProm[k]={n:0,flats:0,d:{}}); o.n++; o.flats+=p.apartments||0; if(p.district) o.d[p.district]=1;
  });
  const prom=Object.keys(byProm).sort(function(a,b){ return byProm[b].n-byProm[a].n; }).slice(0,15).map(function(k){
    const o=byProm[k];
    return '<tr style="cursor:pointer" onclick="ciRSet(\'rq\','+esc(JSON.stringify(k==='(page not read yet)'?'':k))+')"><td>'+esc(k)+(followed[k.toLowerCase()]?' <span class="tag t-blue">followed</span>':'')+'</td><td style="text-align:center">'+o.n+'</td><td style="text-align:center">'+o.flats+'</td><td>'+esc(Object.keys(o.d).join(', '))+'</td></tr>';
  }).join('');
  const tr=function(p){
    return '<tr><td><a href="'+esc(p.source_url||('https://rera.wb.gov.in/project_details.php?procode='+p.procode))+'" target="_blank" rel="noopener"><b>'+esc(p.name||'')+'</b></a><div style="font-size:11px;color:var(--slate)">'+esc(p.reg_no||'')+'</div></td>'
      +'<td>'+esc(p.promoter_name||'—')+'</td>'
      +'<td>'+esc([p.block,p.district].filter(Boolean).join(', ')||'—')+'</td>'
      +'<td>'+esc(p.project_status||'—')+'</td>'
      +'<td style="text-align:right">'+(p.apartments==null?'—':p.apartments)+'</td>'
      +'<td>'+fmtDate(p.reg_date)+'</td><td>'+fmtDate(p.completion_date)+'</td>'
      +'<td>'+esc(p.extension_date&&p.extension_date!=='NA'?p.extension_date:'—')+'</td>'
      +'<td style="font-size:11px;color:var(--slate)">'+(p.detail_error?'<span class="tag t-red" title="'+esc(p.detail_error)+'">read failed</span>':(p.detail_fetched_at?ciAgo(p.detail_fetched_at):'list only'))+'</td></tr>';
  };
  const chg=(window._ciRChanges||[]).map(function(c){
    const p=all.filter(function(x){ return x.procode===c.procode; })[0]||{};
    return '<tr><td>'+ciDateTime(c.changed_at)+'</td><td>'+esc(p.name||c.procode)+'</td><td>'+esc(c.field)+'</td><td>'+esc(c.old_value||'—')+'</td><td>'+esc(c.new_value||'—')+'</td></tr>';
  }).join('');
  $('ciBody').innerHTML='<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">'
      +'<span class="tag t-gray">'+all.length+(brand?' of our projects on the register (promoter'+(targets.length===1?'':'s')+': '+esc(targets.map(function(t){ return t.value; }).join(', ')||'none followed')+')':' approved projects on the register, ours left out')+'</span>'
      +'<span class="tag '+(read===all.length&&all.length?'t-green':'t-amber')+'">project pages read: '+read+' of '+all.length+'</span>'
      +(failed?'<span class="tag t-red">'+failed+' page(s) could not be read</span>':'')
      +(brand?'':'<span class="tag t-gray">'+window._ciRRej+' rejected / revoked</span>')
    +'</div>'
    +'<div class="ci-bar">'
      +(brand?'':compSelHtml('ciRF',[['followed','Followed competitor promoters ('+targets.length+')'],['all','All promoters']],CI_F.rfollow,"ciRSet('rfollow',this.value)"))
      +compSelHtml('ciRD',[['all','All districts']].concat(Object.keys(dists).sort().map(function(d){ return [d,d]; })),CI_F.rdist,"ciRSet('rdist',this.value)")
      +ciSearchInput('ciRQ','rq','ciReraPaint','Search project, promoter, area, reg. no.')
      +'<span style="margin-left:auto;font-size:12.5px;color:var(--slate)">'+rows.length+' project'+(rows.length===1?'':'s')+(q?' in the whole register':'')+(rows.length>300?' (first 300 shown)':'')+'</span>'
    +'</div>'
    +'<div class="card" style="margin-bottom:14px;overflow-x:auto"><div style="padding:10px 14px;font-weight:700;font-size:13px">Promoters in this view</div>'
      +'<table class="tbl" style="width:100%;font-size:12.5px"><thead><tr><th>Promoter (as WBRERA prints it)</th><th style="text-align:center">Projects</th><th style="text-align:center">Flats</th><th>Districts</th></tr></thead><tbody>'
      +(prom||'<tr><td colspan="4" style="color:var(--slate)">No projects in this view yet'+(brand?' - the promoter name comes from each project\'s own page, so our projects appear here as those pages are read.'
        :CI_F.rfollow==='followed'?' - project pages are still being read; switch to "All promoters" to search the whole register.':'.')+'</td></tr>')+'</tbody></table></div>'
    +'<div class="card" style="margin-bottom:14px;overflow-x:auto"><table class="tbl" style="width:100%;font-size:12.5px">'
      +'<thead><tr><th>Project</th><th>Promoter</th><th>Area</th><th>Status</th><th style="text-align:right">Flats</th><th>Registered</th><th>Completion</th><th>Extended to</th><th>Page read</th></tr></thead>'
      +'<tbody>'+rows.slice(0,300).map(tr).join('')+'</tbody></table></div>'
    +(chg?'<div class="card" style="overflow-x:auto"><div style="padding:10px 14px;font-weight:700;font-size:13px">Recent changes on the register</div><table class="tbl" style="width:100%;font-size:12.5px"><thead><tr><th>Seen</th><th>Project</th><th>Field</th><th>Was</th><th>Now</th></tr></thead><tbody>'+chg+'</tbody></table></div>':'');
}
window.ciRSet=function(k,v){ CI_F[k]=v; if(k==='rq'&&v) CI_F.rfollow='all'; ciReraPaint(); };

// ---------------------------------------------------------------- Search Trends
async function ciTrends(){
  await ciRunsPanel(['trends'],'Weekly Google search interest over the last 12 months, from <a href="https://trends.google.com/trends/explore?geo=IN-WB" target="_blank" rel="noopener">Google Trends</a>. Google gives an index, not search counts: 100 is the busiest week of the busiest term <i>in that chart</i>. Every chart includes "flats in kolkata", so charts can be compared through it. Kolkata on its own is not a region Google Trends offers, so the regions are West Bengal and India. Each chart is refreshed weekly.');
  const [pts,tg,runs]=await Promise.all([
    ciAll(function(){ return sb.schema('camp').from('pi_trends_points').select('*').order('week_start'); }),
    sb.schema('camp').from('pi_targets').select('*').eq('source','trends').order('grp').order('sort'),
    sb.schema('camp').from('pi_runs').select('unit,note,started_at').eq('source','trends').eq('ok',true).order('started_at',{ascending:false}).limit(100)
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
  ciTrendsPaint();
}
function ciTrendsPaint(){
  const pts=window._ciPts||[], tg=window._ciTT||[];
  const groups=[]; tg.forEach(function(t){ if(groups.indexOf(t.grp)<0) groups.push(t.grp); });
  if(!groups.length){
    $('ciBody').innerHTML='<div class="card card-pad" style="color:var(--slate);font-size:13px"><i class="fa-solid fa-circle-info"></i> No Search Trends group is followed for '+esc(CI_SCOPE_WORD[CI_SCOPE]||CI_SCOPE)+' yet.</div>';
    return;
  }
  const colors=['#0369a1','#16a34a','#d97706','#7c3aed','#94a3b8'];
  let html='<div class="ci-bar">'
    +compSelHtml('ciTGeo',[['IN-WB','West Bengal'],['IN','India']],CI_F.geo,"CI_F.geo=this.value;ciTrendsPaint()")+'</div>'
    +'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(460px,1fr));gap:14px">';
  groups.forEach(function(g,gi){
    const p=pts.filter(function(x){ return x.grp===g&&x.geo===CI_F.geo; });
    const run=(window._ciTRuns||[]).filter(function(r){ return r.unit===g+'|'+CI_F.geo; })[0];
    const link=run&&run.note?String(run.note).split(' | ')[0]:'';
    const terms=tg.filter(function(t){ return t.grp===g; }).map(function(t){ return t.value; });
    const none=terms.filter(function(t){ return p.length&&!p.some(function(x){ return x.term===t&&x.has_data; }); });
    html+='<div class="card card-pad"><div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><b>'+esc(g)+'</b>'
      +((window._ciTMarket||{})[g]?' <span class="tag t-gray" title="None of these terms is a company - general searches for the market">market</span>':'')
      +'<span style="margin-left:auto;font-size:11.5px;color:var(--slate)">'+(p.length?'read '+ciAgo(p[0].fetched_at):'not fetched yet')+(link?' · <a href="'+esc(link)+'" target="_blank" rel="noopener">open on Google</a>':'')+'</span></div>'
      +(p.length?'<div style="height:220px"><canvas id="ciTC'+gi+'"></canvas></div>':'<div style="color:var(--slate);font-size:12.5px;padding:30px 0;text-align:center">Waiting for the weekly fetch.</div>')
      +(none.length?'<div style="font-size:11.5px;color:#b45309;margin-top:6px">Too few searches for Google to show: '+esc(none.join(', '))+'</div>':'')
    +'</div>';
  });
  $('ciBody').innerHTML=html+'</div>';
  groups.forEach(function(g,gi){
    const c=$('ciTC'+gi); if(!c||typeof Chart==='undefined') return;
    const p=pts.filter(function(x){ return x.grp===g&&x.geo===CI_F.geo; });
    const weeks=[]; p.forEach(function(x){ if(weeks.indexOf(x.week_start)<0) weeks.push(x.week_start); });
    const terms=tg.filter(function(t){ return t.grp===g; });
    new Chart(c,{type:'line',data:{labels:weeks.map(function(w){ return fmtDateShort(w); }),datasets:terms.map(function(t,i){
      return {label:t.value,data:weeks.map(function(w){ const x=p.filter(function(y){ return y.week_start===w&&y.term===t.value; })[0]; return x&&x.has_data?x.value:null; }),
        borderColor:t.kind==='anchor'?colors[4]:colors[i%4],borderDash:t.kind==='anchor'?[4,4]:[],borderWidth:2,pointRadius:0,tension:.25,spanGaps:false};
    })},options:{maintainAspectRatio:false,interaction:{mode:'index',intersect:false},scales:{y:{min:0,max:100}},plugins:{legend:{position:'bottom',labels:{usePointStyle:true,boxWidth:7,font:{size:11}}}}}});
  });
}
