/* ============================ MARKET WATCH ============================
   One Marketing page, three tabs (14 Nov 2026, Ayush: "One page with three tabs, Kolkata plus nearby.
   I just want the Trend Video, Project Names and data, and Hook Video - no Gemini required.")

   TRENDS     YouTube's own Trending chart - India, and World (US, UK, UAE, Singapore and Australia read
              and shown together as one list; Ayush 14 Nov: "only India and World, not other countries").
   LAUNCHES   Projects registered on West Bengal RERA in Kolkata, North 24-Parganas, South 24-Parganas
              and Howrah by WELL-KNOWN DEVELOPERS ONLY, last 3 months (Ayush 14 Nov, later the same day:
              "premium projects ... from well renowned companies" - see MW_REPUTED) - name, developer,
              place, size, completion date and RERA number, with how many days since it was registered.
              Marked Our Brand / Competitor by developer. From camp.pi_rera_projects (public-intel, daily).
   HOOK LIBRARY  The most-watched professionally made Shorts of the last 30 days - ad films, cinematic
              shots, cars, tech launches, design, luxury, travel - from channels with 10 lakh+ subscribers,
              never comedy / vlog / gaming (Ayush 14 Nov: "professional, not low quality"). Kept as they
              are found, with YouTube's real view / like counts. Filters: market-watch HOOK_SEARCHES.

   The videos come from the market-watch edge function into camp.mkt_videos. Nothing is written or
   judged by AI; every figure is the source's own. */
let MW_TAB='trends', MW_REGION='IN', MW_HOOKTAG='all', MW_HOOKSORT='views', MW_LDAYS='90', MW_LWHO='all', MW_LDIST='all', MW_LQ='';
const MW_FN=SUPABASE_URL+'/functions/v1/market-watch';
const MW_DISTRICTS=['Kolkata','North 24-Parganas','South 24-Parganas','Howrah'];
const MW_REGIONS=[['IN','India'],['WORLD','World']];
const MW_HOOKTAGS=[['all','All'],['ads','Ad films'],['cinematic','Cinematic'],['cars','Cars'],['tech','Tech launches'],['design','Design'],['luxury','Luxury'],['travel','Travel']];
let MW_VID=null, MW_RERA=null, MW_WL=null;

const MW_CSS='<style>'
  +'.mw-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:14px}'
  +'.mw-head h1{margin:0;font-size:24px;font-weight:700;display:flex;align-items:center;gap:10px}'
  +'.mw-head p{margin:5px 0 0;color:var(--slate);font-size:13.5px;max-width:760px;line-height:1.5}'
  +'.mw-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:16px}'
  +'.mw-tab{border:0;background:none;padding:10px 16px;font:inherit;font-weight:600;font-size:14px;color:var(--slate);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;display:flex;align-items:center;gap:8px}'
  +'.mw-tab.on{color:var(--brand);border-bottom-color:var(--brand)}'
  +'.mw-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}'
  +'.mw-chip{border:1px solid var(--line);background:var(--card,#fff);border-radius:999px;padding:6px 13px;font:inherit;font-size:12.5px;font-weight:600;color:var(--ink-2,#334155);cursor:pointer}'
  +'.mw-chip.on{background:var(--brand);border-color:var(--brand);color:#fff}'
  +'.mw-meta{margin-left:auto;font-size:12px;color:var(--slate);display:flex;align-items:center;gap:10px}'
  +'.mw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}'
  +'.mw-card{background:var(--card,#fff);border:1px solid var(--line);border-radius:12px;overflow:hidden;cursor:pointer;display:flex;flex-direction:column;transition:box-shadow .15s}'
  +'.mw-card:hover{box-shadow:0 8px 24px rgba(15,23,42,.12)}'
  +'.mw-thumb{position:relative;aspect-ratio:16/9;background:#0f172a center/cover no-repeat}'
  +'.mw-thumb.v{aspect-ratio:9/12}'
  +'.mw-dur{position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.78);color:#fff;font-size:11px;font-weight:600;padding:2px 6px;border-radius:5px}'
  +'.mw-rank{position:absolute;left:6px;top:6px;background:rgba(0,0,0,.72);color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:5px}'
  +'.mw-cb{padding:10px 12px 12px;display:flex;flex-direction:column;gap:5px;min-width:0}'
  +'.mw-ct{font-weight:650;font-size:13.5px;line-height:1.35;color:var(--ink);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}'
  +'.mw-cc{font-size:12px;color:var(--slate);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  +'.mw-cs{font-size:12px;color:var(--ink-2,#334155);display:flex;gap:10px;flex-wrap:wrap}'
  +'.mw-cs i{color:#94a3b8;margin-right:3px}'
  +'.mw-tw{border:1px solid var(--line);border-radius:12px;overflow:auto;background:var(--card,#fff)}'
  +'.mw-t{width:100%;border-collapse:collapse;font-size:13px}'
  +'.mw-t th{position:sticky;top:0;background:#f8fafc;text-align:left;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--slate);padding:10px 12px;border-bottom:1px solid var(--line);white-space:nowrap}'
  +'.mw-t td{padding:10px 12px;border-bottom:1px solid var(--line-2,#eef1f6);vertical-align:top}'
  +'.mw-t tr:hover td{background:#f8fafc}'
  +'.mw-pn{font-weight:650;color:var(--ink)}'
  +'.mw-sub{font-size:11.5px;color:var(--slate);margin-top:2px}'
  +'.mw-tag{display:inline-block;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px;margin-top:4px}'
  +'.mw-tag.own{background:#dcfce7;color:#166534}.mw-tag.comp{background:#fee2e2;color:#991b1b}.mw-tag.rep{background:#e0e7ff;color:#3730a3}'
  +'.mw-days{font-weight:700;white-space:nowrap}.mw-days.new{color:#16a34a}'
  +'.mw-in{height:34px;border:1px solid var(--line);border-radius:9px;padding:0 10px;font:inherit;font-size:13px;min-width:220px}'
  +'.mw-sel{height:34px;border:1px solid var(--line);border-radius:9px;padding:0 8px;font:inherit;font-size:13px;background:#fff}'
  +'@media(max-width:700px){.mw-grid{grid-template-columns:repeat(auto-fill,minmax(160px,1fr))}.mw-meta{margin-left:0}}'
  +'</style>';

async function mwCall(body){
  const {data:{session}}=await sb.auth.getSession();
  const r=await fetch(MW_FN,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+((session&&session.access_token)||'')},body:JSON.stringify(body)});
  const jr=await r.json().catch(function(){return {};});
  if(!r.ok||jr.error) throw new Error(jr.error||('server said '+r.status));
  return jr;
}
function mwNum(n){ n=Number(n); if(!isFinite(n)) return '—'; if(n>=1e7) return (n/1e7).toFixed(1).replace(/\.0$/,'')+' Cr'; if(n>=1e5) return (n/1e5).toFixed(1).replace(/\.0$/,'')+' L'; if(n>=1e3) return (n/1e3).toFixed(1).replace(/\.0$/,'')+'K'; return String(n); }
function mwDur(s){ s=Number(s); if(!isFinite(s)||s<=0) return ''; const h=Math.floor(s/3600), m=Math.floor(s%3600/60), x=s%60; return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(x).padStart(2,'0'); }
function mwAgo(iso){ if(!iso) return ''; const d=(Date.now()-Date.parse(iso))/1000; if(d<3600) return Math.max(1,Math.round(d/60))+' min ago'; if(d<86400) return Math.round(d/3600)+' h ago'; const n=Math.round(d/86400); return n+' day'+(n===1?'':'s')+' ago'; }
function mwDmy(iso){ if(!iso) return '—'; const s=String(iso).slice(0,10).split('-'); return s.length===3?s[2]+'/'+s[1]+'/'+s[0]:String(iso); }
function mwDaysSince(iso){ if(!iso) return null; const t=new Date(); t.setHours(12,0,0,0); return Math.round((t-new Date(String(iso).slice(0,10)+'T12:00:00'))/86400000); }

VIEWS.market_watch=async function(v,seg){
  if(seg&&['trends','launches','hooks'].indexOf(seg[0])!==-1) MW_TAB=seg[0];
  setCrumb(['Growth & Strategy','Market Watch']);
  const tab=function(id,icon,label){ return '<button class="mw-tab'+(MW_TAB===id?' on':'')+'" onclick="navTo(\'market_watch/'+id+'\')"><i class="fa-solid '+icon+'"></i> '+label+'</button>'; };
  v.innerHTML=MW_CSS
    +'<div class="mw-head"><div><h1><i class="fa-solid fa-binoculars" style="color:var(--brand)"></i> Market Watch</h1>'
      +'<p>Trending videos, new project launches around Kolkata, and short videos with hooks that hold people.</p></div></div>'
    +'<div class="mw-tabs">'+tab('trends','fa-fire','Trends')+tab('launches','fa-building-flag','Launches')+tab('hooks','fa-bolt','Hook Library')+'</div>'
    +'<div id="mwBody"><div class="loader"><div class="spin"></div></div></div>';
  try{
    if(MW_TAB==='launches') await mwLaunches(); else await mwVideos(MW_TAB==='hooks'?'hook':'trend');
  }catch(e){ const b=$('mwBody'); if(b) b.innerHTML='<div class="card card-pad empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load: '+esc((e&&e.message)||String(e))+'</div></div>'; }
};

/* ---------------------------------------------------------------- videos (Trends + Hook Library) */
async function mwLoadVideos(){
  if(MW_VID) return MW_VID;
  const {data,error}=await sb.schema('camp').from('mkt_videos').select('*').order('last_seen',{ascending:false}).limit(5000);
  if(!error){ MW_VID={rows:data||[],live:false}; return MW_VID; }
  // Before the table is made (it is made after office hours), the same videos straight from YouTube.
  const r=await mwCall({action:'preview'});
  MW_VID={rows:(r.trend||[]).concat(r.hook||[]),live:true}; return MW_VID;
}
async function mwVideos(kind){
  const d=await mwLoadVideos(); if(!$('mwBody')) return;
  const all=d.rows.filter(x=>x.kind===kind);
  const latest=all.reduce((m,x)=>x.last_seen>m?x.last_seen:m,'');
  let list;
  if(kind==='trend'){
    // only what YouTube lists on its chart right now (the latest read), in its own order
    const cur=all.filter(x=>Date.parse(latest)-Date.parse(x.last_seen)<30*60000);
    if(MW_REGION==='WORLD'){
      const by={}; cur.filter(x=>x.tag!=='IN').forEach(x=>{ if(!by[x.video_id]||Number(x.views)>Number(by[x.video_id].views)) by[x.video_id]=x; });
      list=Object.values(by).sort((a,b)=>Number(b.views||0)-Number(a.views||0));
    } else list=cur.filter(x=>x.tag===MW_REGION).sort((a,b)=>(a.rank||999)-(b.rank||999));
  } else {
    const by={}; all.filter(x=>MW_HOOKTAG==='all'||x.tag===MW_HOOKTAG).forEach(x=>{ if(!by[x.video_id]||x.last_seen>by[x.video_id].last_seen) by[x.video_id]=x; });
    list=Object.values(by);
    const eng=x=>Number(x.views)>0?(Number(x.likes||0)+Number(x.comments||0))/Number(x.views):0;
    if(MW_HOOKSORT==='views') list.sort((a,b)=>Number(b.views||0)-Number(a.views||0));
    else if(MW_HOOKSORT==='newest') list.sort((a,b)=>String(b.published_at).localeCompare(String(a.published_at)));
    else list.sort((a,b)=>eng(b)-eng(a));
  }
  const chips=kind==='trend'
    ? MW_REGIONS.map(r=>'<button class="mw-chip'+(MW_REGION===r[0]?' on':'')+'" onclick="mwSet(\'MW_REGION\',\''+r[0]+'\')">'+esc(r[1])+'</button>').join('')
    : MW_HOOKTAGS.map(r=>'<button class="mw-chip'+(MW_HOOKTAG===r[0]?' on':'')+'" onclick="mwSet(\'MW_HOOKTAG\',\''+r[0]+'\')">'+esc(r[1])+'</button>').join('')
      +'<select class="mw-sel" onchange="mwSet(\'MW_HOOKSORT\',this.value)">'+[['views','Most viewed'],['engaging','Most liked / commented per view'],['newest','Newest']].map(o=>'<option value="'+o[0]+'"'+(MW_HOOKSORT===o[0]?' selected':'')+'>'+o[1]+'</option>').join('')+'</select>';
  const meta='<span class="mw-meta">'+list.length+' video'+(list.length===1?'':'s')+(latest?' · YouTube read '+mwAgo(latest):'')
    +(d.live?' · live from YouTube (not saved yet)':'')
    +' <button class="btn" style="height:30px;font-size:12px" onclick="mwRefresh(this)"><i class="fa-solid fa-rotate"></i> Refresh</button></span>';
  const note=kind==='trend'
    ? '<div class="mw-sub" style="margin:-6px 0 12px">YouTube\u2019s own Trending list'+(MW_REGION==='WORLD'?' - United States, United Kingdom, UAE, Singapore and Australia together, most viewed first':' - in YouTube\u2019s order')+'.</div>'
    : '<div class="mw-sub" style="margin:-6px 0 12px">The most-watched professionally made Shorts of the 30 days before each read - only channels with 1 lakh+ subscribers, no comedy skits, vlogs or gaming. Every video found stays in the library.</div>';
  $('mwBody').innerHTML='<div class="mw-bar">'+chips+meta+'</div>'+note
    +(list.length?'<div class="mw-grid">'+list.map(x=>mwCard(x,kind)).join('')+'</div>'
      :'<div class="card card-pad empty"><i class="fa-solid fa-film"></i><div>No videos yet - press Refresh.</div></div>');
}
function mwCard(x,kind){
  const short=kind==='hook'&&Number(x.duration_s)<=180;
  return '<div class="mw-card" onclick="mwPlay(\''+esc(x.video_id)+'\','+(short?1:0)+')">'
    +'<div class="mw-thumb'+(short?' v':'')+'" style="background-image:url(\''+esc(x.thumb||'')+'\')">'
      +(kind==='trend'&&MW_REGION!=='WORLD'&&x.rank?'<span class="mw-rank">#'+x.rank+'</span>':'')
      +(x.duration_s?'<span class="mw-dur">'+mwDur(x.duration_s)+'</span>':'')+'</div>'
    +'<div class="mw-cb"><div class="mw-ct" title="'+esc(x.title)+'">'+esc(x.title)+'</div>'
      +'<div class="mw-cc">'+esc(x.channel||'')+'</div>'
      +'<div class="mw-cs"><span><i class="fa-solid fa-eye"></i>'+mwNum(x.views)+'</span>'
        +(x.likes!=null?'<span><i class="fa-solid fa-thumbs-up"></i>'+mwNum(x.likes)+'</span>':'')
        +(x.comments!=null?'<span><i class="fa-solid fa-comment"></i>'+mwNum(x.comments)+'</span>':'')
        +'<span><i class="fa-regular fa-clock"></i>'+mwAgo(x.published_at)+'</span></div></div></div>';
}
window.mwPlay=function(id,vertical){
  openModal('<div class="modal-head"><h3><i class="fa-brands fa-youtube" style="color:#dc2626"></i> Video</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="display:flex;justify-content:center;background:#000;padding:0">'
      +'<iframe src="https://www.youtube.com/embed/'+encodeURIComponent(id)+'?autoplay=1&rel=0" style="border:0;width:'+(vertical?'min(380px,100%)':'100%')+';aspect-ratio:'+(vertical?'9/16':'16/9')+';max-height:78vh" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>'
    +'<div class="modal-foot"><a class="btn" href="https://www.youtube.com/watch?v='+encodeURIComponent(id)+'" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open on YouTube</a><button class="btn primary" onclick="closeModal()">Close</button></div>',vertical?'md':'lg');
};
window.mwSet=function(k,v){ if(k==='MW_REGION') MW_REGION=v; else if(k==='MW_HOOKTAG') MW_HOOKTAG=v; else if(k==='MW_HOOKSORT') MW_HOOKSORT=v;
  else if(k==='MW_LDAYS') MW_LDAYS=v; else if(k==='MW_LWHO') MW_LWHO=v; else if(k==='MW_LDIST') MW_LDIST=v;
  if(MW_TAB==='launches') mwDrawLaunches(); else mwVideos(MW_TAB==='hooks'?'hook':'trend'); };
window.mwRefresh=async function(btn){
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Reading YouTube…'; }
  try{ const r=await mwCall({action:'refresh',force:true}); MW_VID=null; toast('Read from YouTube: '+Object.keys(r.saved||{}).map(k=>(r.saved[k])+' '+(k==='trend'?'trend':'hook')+' rows').join(', '),'ok'); }
  catch(e){ if(/mkt_videos/.test(e.message)) MW_VID=null; else toast(e.message,'err'); MW_VID=null; }
  renderPage();
};

/* ---------------------------------------------------------------- Launches (WB RERA) */
// A developer is marked Competitor when its RERA name holds the distinctive word(s) of a name on the
// Competitor watch list (e.g. "MERLIN" for Merlin Group); Our Brand for Dream Gateway Hotels Ltd and
// any RERA developer the watch list ties to our own brand. The words matched are shown on hover.
const MW_GENERIC=/\b(group|realty|realtors|limited|ltd|pvt|private|kolkata|projects?|by|the|and|properties|developers?|infra(structure)?|homes?|estates?)\b/gi;
function mwKeyOf(name){ const k=String(name||'').replace(MW_GENERIC,' ').replace(/[^a-z0-9 ]/gi,' ').replace(/\s+/g,' ').trim().toUpperCase(); return k.length>=3?k:String(name||'').toUpperCase().trim(); }
async function mwLaunches(){
  if(!MW_RERA){
    const cols='procode,name,reg_no,reg_date,promoter_name,promoter_type,district,block,police_station,pincode,address,project_type,project_status,apartments,land_area_sqm,built_area_sqm,carpet_area_sqm,completion_date,source_url,list_seen_at';
    const [rows,wl,tg]=await Promise.all([
      ciAll(function(){ return sb.schema('camp').from('pi_rera_projects').select(cols).in('district',MW_DISTRICTS).eq('list_status','approved').order('reg_date',{ascending:false}); }),
      sb.schema('camp').from('competitor_watchlist').select('id,name,category,is_own_brand'),
      sb.schema('camp').from('pi_targets').select('value,watchlist_id').eq('source','rera').eq('kind','promoter')
    ]);
    MW_RERA=rows;
    const w=(wl&&wl.data)||[];
    const own=new Set(w.filter(x=>x.is_own_brand).map(x=>x.id));
    MW_WL={ownPromoters:((tg&&tg.data)||[]).filter(t=>own.has(t.watchlist_id)).map(t=>String(t.value).toUpperCase()),
      comps:w.filter(x=>x.category==='competitor').map(x=>({name:x.name,key:mwKeyOf(x.name)}))};
    if(!MW_WL.ownPromoters.length) MW_WL.ownPromoters=['DREAM GATEWAY HOTELS'];
  }
  mwDrawLaunches();
}
function mwWho(r){
  const p=String(r.promoter_name||'').toUpperCase();
  if(MW_WL.ownPromoters.some(x=>p.indexOf(x.replace(/\s+LTD\.?$|\s+LIMITED$/,''))!==-1)) return {k:'own',label:'Our Brand'};
  const c=MW_WL.comps.find(c=>c.key&&new RegExp('\\b'+c.key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b').test(p));
  if(c) return {k:'comp',label:c.name};
  const n=MW_REPUTED.find(x=>x[1].test(p));
  return n?{k:'rep',label:n[0]}:null;
}
/* PREMIUM ONLY (14 Nov 2026, Ayush: "LAUNCHES too should be premium projects ... apartments from well renowned
   companies", chose "Named developers only"). A launch shows only when its RERA developer is Our Brand, on the
   Competitor watch list, or one of these well-known developers (matched in the RERA developer name). A project a big
   developer registers under a differently named company (an SPV) does not match; add its name here to show it. */
const MW_REPUTED=[
  ['Ambuja Neotia',/\bAMBUJA\b|\bNEOTIA\b/],['PS Group',/\bPS GROUP\b/],['Merlin',/\bMERLIN\b/],['Siddha',/\bSIDDHA\b/],
  ['Eden',/\bEDEN\b/],['Godrej',/\bGODREJ\b/],['Srijan',/\bSRIJAN\b/],['DTC',/\bDTC\b/],['Shapoorji Pallonji',/\bSHAPOORJI\b/],
  ['Tata Housing',/\bTATA (HOUSING|REALTY)\b/],['DLF',/\bDLF\b/],['Sugam',/\bSUGAM\b/],['Shrachi',/\bSHRACHI\b/],['Atri',/\bATRI\b/],
  ['Primarc',/\bPRIMARC\b/],['Mani Group',/\bMANI GROUP\b/],['Orbit',/\bORBIT\b/],['Salarpuria Sattva',/\bSALARPURIA\b|\bSATTVA\b/],
  ['Bengal Peerless',/\bBENGAL PEERLESS\b/],['Purti',/\bPURTI\b/],['Unimark',/\bUNIMARK\b/],['Rajwada',/\bRAJWADA\b/],
  ['Alcove',/\bALCOVE\b/],['Lodha',/\bLODHA\b|\bMACROTECH\b/],['Prestige',/\bPRESTIGE ESTATES?\b/],['Sobha',/\bSOBHA\b/],
  ['Puravankara',/\bPURAVANKARA\b|\bPROVIDENT HOUSING\b/],['Mahindra Lifespaces',/\bMAHINDRA LIFESPACE/],['South City',/\bSOUTH CITY PROJECTS\b/]
];
function mwLaunchList(){
  const days=MW_LDAYS==='all'?null:Number(MW_LDAYS);
  const q=MW_LQ.trim().toLowerCase();
  return MW_RERA.map(r=>Object.assign({},r,{_who:mwWho(r),_d:mwDaysSince(r.reg_date)})).filter(r=>{
    if(!r._who) return false;   // named developers only (MW_REPUTED)
    if(days!=null&&(r._d==null||r._d>days)) return false;
    if(MW_LDIST!=='all'&&r.district!==MW_LDIST) return false;
    if(MW_LWHO==='own'&&!(r._who&&r._who.k==='own')) return false;
    if(MW_LWHO==='comp'&&!(r._who&&r._who.k==='comp')) return false;
    if(q&&[r.name,r.promoter_name,r.address,r.police_station,r.pincode,r.block,r.reg_no].join(' ').toLowerCase().indexOf(q)===-1) return false;
    return true;
  });
}
function mwDrawLaunches(){
  const b=$('mwBody'); if(!b) return;
  const chip=(k,v,l,cur)=>'<button class="mw-chip'+(cur===v?' on':'')+'" onclick="mwSet(\''+k+'\',\''+v+'\')">'+l+'</button>';
  b.innerHTML='<div class="mw-bar">'
      +[['all','All named developers'],['own','Our Brand'],['comp','Competitors']].map(o=>chip('MW_LWHO',o[0],o[1],MW_LWHO)).join('')
      +'<select class="mw-sel" onchange="mwSet(\'MW_LDIST\',this.value)"><option value="all">Kolkata + nearby</option>'+MW_DISTRICTS.map(d=>'<option'+(MW_LDIST===d?' selected':'')+'>'+esc(d)+'</option>').join('')+'</select>'
      +'<input class="mw-in" placeholder="Search project, developer, area, PIN" value="'+esc(MW_LQ)+'" oninput="MW_LQ=this.value;clearTimeout(window._mwT);window._mwT=setTimeout(mwLaunchTable,250)">'
      +'<span class="mw-meta" id="mwLCount"></span>'
    +'</div>'
    +'<div class="mw-sub" style="margin:-6px 0 12px">Projects by well-known developers (Our Brand, the Competitor list, and names such as Ambuja Neotia, PS Group, Merlin, Siddha, Godrej, Shapoorji Pallonji) registered in the last 3 months on West Bengal RERA in Kolkata, North 24-Parganas, South 24-Parganas and Howrah. "Launched" is the RERA registration date. Areas are RERA\u2019s square metres shown in sq ft.</div>'
    +'<div id="mwLT"></div>';
  mwLaunchTable();
}
function mwLaunchTable(){
  const host=$('mwLT'); if(!host) return;
  const list=mwLaunchList();
  const seen=MW_RERA.reduce((m,x)=>x.list_seen_at>m?x.list_seen_at:m,'');
  const c=$('mwLCount'); if(c) c.textContent=list.length+' project'+(list.length===1?'':'s')+(seen?' · RERA read '+mwAgo(seen):'');
  const sqft=v=>v==null||v===''?'—':inrGroup(String(Math.round(Number(v)*10.7639)));
  host.innerHTML=list.length?'<div class="mw-tw" style="max-height:calc(100vh - 300px)"><table class="mw-t"><thead><tr>'
        +'<th>Launched</th><th>Project</th><th>Developer</th><th>Location</th><th>Type</th><th style="text-align:right">Flats</th><th style="text-align:right">Built-up (sq ft)</th><th style="text-align:right">Land (sq ft)</th><th>Completion</th><th>RERA No.</th></tr></thead><tbody>'
        +list.map(r=>'<tr>'
          +'<td><div class="mw-days'+(r._d!=null&&r._d<=30?' new':'')+'">'+(r._d==null?'—':r._d===0?'Today':r._d+' day'+(r._d===1?'':'s')+' ago')+'</div><div class="mw-sub">'+mwDmy(r.reg_date)+'</div></td>'
          +'<td><div class="mw-pn">'+esc(String(r.name||'').replace(/^"+|"+$/g,''))+'</div><div class="mw-sub">'+esc(r.project_status||'')+'</div></td>'
          +'<td><div>'+esc(r.promoter_name||'—')+'</div><div class="mw-sub">'+esc(r.promoter_type||'')+'</div>'
            +(r._who?'<span class="mw-tag '+r._who.k+'">'+esc(r._who.k==='own'?'Our Brand':r._who.k==='comp'?'Competitor · '+r._who.label:r._who.label)+'</span>':'')+'</td>'
          +'<td><div>'+esc(r.address||'—')+'</div><div class="mw-sub">'+esc([r.police_station,r.block,r.district,r.pincode].filter(Boolean).join(' · '))+'</div></td>'
          +'<td>'+esc(r.project_type||'—')+'</td>'
          +'<td style="text-align:right">'+(r.apartments==null?'—':esc(String(r.apartments)))+'</td>'
          +'<td style="text-align:right">'+sqft(r.built_area_sqm)+'</td>'
          +'<td style="text-align:right">'+sqft(r.land_area_sqm)+'</td>'
          +'<td style="white-space:nowrap">'+mwDmy(r.completion_date)+'</td>'
          +'<td><a href="'+esc(r.source_url||('https://rera.wb.gov.in/project_details.php?procode='+r.procode))+'" target="_blank" rel="noopener" style="white-space:nowrap">'+esc(r.reg_no||'View')+' <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:10px"></i></a></td>'
        +'</tr>').join('')+'</tbody></table></div>'
      :'<div class="card card-pad empty"><i class="fa-solid fa-building"></i><div>No projects for this choice.</div></div>';
}
