/* MARKET WATCH - AI TABS (16 Nov 2026, Ayush: "Can we put AI somewhere if free ... Trending means it's going on lately,
   people are discussing it, it's blowing up - not necessarily a video ... videos, photos, movies, a phrase, a song ...
   everything positive ... the Hooks are not hooks, they are proper videos - I want hook ideas where the user's thumb stops
   ... attracting hooks on photos as well ... Launch data from its data").
   The work is done by the market-watch edge function (ai.ts): Trends every 3 hours, Hook ideas and Launches every
   morning; this page reads what it saved (action ai_get). Gemini / Groq free tiers. */

let MWA={trends:null,hooks:null,launches:null}, MWA_REG='all', MWA_KIND='all', MWA_HTAB='ideas', MWA_HFMT='all';
const MWA_CSS='<style>'
  +'.mwa-card{background:var(--card,#fff);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}'
  +'.mwa-pic{aspect-ratio:16/9;background:#e2e8f0 center/cover no-repeat;position:relative}'
  +'.mwa-pic.none{display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:26px;background:linear-gradient(135deg,#eef2ff,#f8fafc)}'
  +'.mwa-badge{position:absolute;left:8px;top:8px;background:#16a34a;color:#fff;font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px}'
  +'.mwa-kind{font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--brand)}'
  +'.mwa-b{padding:11px 13px 13px;display:flex;flex-direction:column;gap:6px;flex:1}'
  +'.mwa-t{font-weight:700;font-size:15px;line-height:1.3;color:var(--ink)}'
  +'.mwa-why{font-size:12.5px;color:var(--ink-2,#334155);line-height:1.45}'
  +'.mwa-sig{display:flex;gap:10px;flex-wrap:wrap;font-size:11.5px;color:var(--slate)}'
  +'.mwa-sig a{color:var(--slate);text-decoration:none}.mwa-sig a:hover{color:var(--brand)}'
  +'.mwa-idea{margin-top:auto;background:#f8fafc;border-radius:8px;padding:7px 9px;font-size:12px;color:#334155;line-height:1.4}'
  +'.mwa-idea b{color:var(--brand)}'
  +'.mwa-hook{font-size:17px;font-weight:750;line-height:1.3;color:var(--ink)}'
  +'.mwa-row{font-size:12px;color:#334155;line-height:1.45}.mwa-row span{color:var(--slate);font-weight:600}'
  +'.mwa-tag{display:inline-block;font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;background:#eef2ff;color:#3730a3;margin-right:4px}'
  +'.mwa-tag.v{background:#fee2e2;color:#991b1b}.mwa-tag.p{background:#e0f2fe;color:#075985}.mwa-tag.t{background:#dcfce7;color:#166534}'
  +'.mwa-copy{border:1px solid var(--line);background:#fff;border-radius:8px;height:28px;padding:0 10px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;align-self:flex-start}'
  +'.mwa-media{aspect-ratio:1/1;background:#0f172a center/contain no-repeat;position:relative}'
  +'.mwa-media video{width:100%;height:100%;object-fit:contain;display:block}'
  +'.mwa-wait{display:flex;align-items:center;gap:10px}'
  +'</style>';

async function mwaGet(what){
  if(MWA[what]) return MWA[what];
  const r=await mwCall({action:'ai_get',what:what}); MWA[what]=r.data||null; return MWA[what];
}
window.mwaRefresh=async function(what,btn){
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Asking AI…'; }
  try{ const r=await mwCall({action:'ai_refresh',what:what}); MWA[what]=r.data; }
  catch(e){ toast(e.message,'err'); }
  if(what==='trends') mwaDrawTrends(); else if(what==='hooks') mwaDrawHooks(); else mwaDrawLaunches();
};
function mwaMeta(d,what){
  return '<span class="mw-meta">'+(d&&d.at?'AI read '+mwAgo(d.at):'')
    +' <button class="btn" style="height:30px;font-size:12px" onclick="mwaRefresh(\''+what+'\',this)"><i class="fa-solid fa-rotate"></i> Refresh</button></span>';
}
function mwaEmpty(what,txt){
  return '<div class="card card-pad empty"><i class="fa-solid fa-wand-magic-sparkles"></i><div>'+txt+'</div>'
    +'<button class="btn primary" style="margin-top:10px" onclick="mwaRefresh(\''+what+'\',this)">Read now</button></div>';
}

/* ---------------------------------------------------------------- Trends */
const MWA_KINDS=[['all','All'],['screen','Movies & shows'],['song','Music'],['person','People'],['sport','Sport'],['techbiz','Tech & business'],['moment','Moments & phrases']];
const MWA_KMAP={movie:'screen',show:'screen',song:'song',person:'person',sport:'sport',tech:'techbiz',business:'techbiz',phrase:'moment',event:'moment',festival:'moment',other:'moment'};
const MWA_KICON={movie:'fa-film',show:'fa-tv',song:'fa-music',person:'fa-user',sport:'fa-futbol',tech:'fa-microchip',business:'fa-briefcase',phrase:'fa-quote-left',event:'fa-calendar-days',festival:'fa-star',other:'fa-bolt'};
async function mwAiTrends(){ await mwaGet('trends'); mwaDrawTrends(); }
window.mwaSet=function(k,v){ if(k==='reg') MWA_REG=v; else if(k==='kind') MWA_KIND=v; else if(k==='htab') MWA_HTAB=v; else if(k==='hfmt') MWA_HFMT=v;
  if(MW_TAB==='hooks') mwaDrawHooks(); else if(MW_TAB==='launches') mwaDrawLaunches(); else mwaDrawTrends(); };
function mwaChip(k,v,l,cur){ return '<button class="mw-chip'+(cur===v?' on':'')+'" onclick="mwaSet(\''+k+'\',\''+v+'\')">'+l+'</button>'; }
function mwaDrawTrends(){
  const b=$('mwBody'); if(!b) return;
  const d=MWA.trends;
  const bar='<div class="mw-bar">'+[['all','India + World'],['IN','India'],['WORLD','World']].map(o=>mwaChip('reg',o[0],o[1],MWA_REG)).join('')+mwaMeta(d,'trends')+'</div>'
    +'<div class="mw-bar">'+MWA_KINDS.map(o=>mwaChip('kind',o[0],o[1],MWA_KIND)).join('')+'</div>';
  if(!d||!(d.topics||[]).length){ b.innerHTML=MWA_CSS+bar+mwaEmpty('trends','Trends are read every 3 hours.'); return; }
  const list=d.topics.filter(t=>(MWA_REG==='all'||t.region===MWA_REG)&&(MWA_KIND==='all'||MWA_KMAP[t.kind]===MWA_KIND));
  const day=Date.now()-24*3600e3;
  b.innerHTML=MWA_CSS+bar
    +'<div class="mw-sub" style="margin:-6px 0 12px">What is rising right now - searches that jumped on Google, Wikipedia pages read far more than usual, YouTube’s trending chart - merged into topics by AI. Only positive topics; anything sad, negative or divisive is left out.</div>'
    +(list.length?'<div class="mw-grid">'+list.map(t=>{
      const sig=[];
      if(t.searches) sig.push('<span><i class="fa-brands fa-google"></i> '+mwNum(t.searches)+'+ searches</span>');
      if(t.spike) sig.push('<span><i class="fa-brands fa-wikipedia-w"></i> read '+(t.spike>=50?'50+':t.spike)+'× usual</span>');
      if(t.yt_views) sig.push('<span><i class="fa-brands fa-youtube"></i> '+mwNum(t.yt_views)+' views</span>');
      const links=(t.links||[]).filter(l=>l.url).slice(0,3).map(l=>'<a href="'+esc(l.url)+'" target="_blank" rel="noopener" title="'+esc(l.title)+'"><i class="fa-solid fa-arrow-up-right-from-square"></i> '+esc(l.src==='google'?'News':l.src==='wikipedia'?'Wikipedia':'YouTube')+'</a>').join('');
      return '<div class="mwa-card">'
        +(t.picture?'<div class="mwa-pic" style="background-image:url(\''+esc(t.picture)+'\')">':'<div class="mwa-pic none"><i class="fa-solid '+(MWA_KICON[t.kind]||'fa-bolt')+'"></i>')
          +(Date.parse(t.first_seen)>day?'<span class="mwa-badge">New today</span>':'')+'</div>'
        +'<div class="mwa-b"><div class="mwa-kind"><i class="fa-solid '+(MWA_KICON[t.kind]||'fa-bolt')+'"></i> '+esc(t.kind)+' · '+(t.region==='IN'?'India':'World')+'</div>'
          +'<div class="mwa-t">'+esc(t.topic)+'</div><div class="mwa-why">'+esc(t.why)+'</div>'
          +'<div class="mwa-sig">'+sig.join('')+'</div><div class="mwa-sig">'+links+'</div>'
          +(t.hook?'<div class="mwa-idea"><b>Idea:</b> '+esc(t.hook)+'</div>':'')+'</div></div>';
    }).join('')+'</div>':'<div class="card card-pad empty"><i class="fa-solid fa-filter"></i><div>Nothing in this choice right now.</div></div>');
}

/* ---------------------------------------------------------------- Hook Library */
async function mwAiHooks(){ if(MWA_HTAB!=='ours') await mwaGet('hooks'); mwaDrawHooks(); }
window.mwaCopy=function(i){ const x=(MWA.hooks&&MWA.hooks.ideas||[])[i]; if(!x) return;
  const txt=x.hook+(x.on_screen?'\nOn screen: '+x.on_screen:'')+(x.visual?'\nShot: '+x.visual:'');
  try{ navigator.clipboard.writeText(txt).then(()=>toast('Hook copied','ok')); }catch(e){ toast('Could not copy','err'); } };
function mwaDrawHooks(){
  const b=$('mwBody'); if(!b) return;
  const d=MWA.hooks;
  const tabs='<div class="mw-bar">'+mwaChip('htab','ideas','Hook ideas',MWA_HTAB)+mwaChip('htab','proven','Proven in ads',MWA_HTAB)+mwaChip('htab','ours','Our ads',MWA_HTAB)
    +(MWA_HTAB==='ours'?'':mwaMeta(d,'hooks'))+'</div>';
  if(MWA_HTAB==='ours'){ b.innerHTML=MWA_CSS+tabs+'<div id="mwX"><div class="loader"><div class="spin"></div></div></div>'; mwOurHooks().catch(e=>{ const x=$('mwX'); if(x) x.innerHTML='<div class="card card-pad empty"><div>Could not load: '+esc(e.message)+'</div></div>'; }); return; }
  if(!d){ if(!MWA.hooks){ mwaGet('hooks').then(()=>{ if(MWA.hooks) mwaDrawHooks(); }); } b.innerHTML=MWA_CSS+tabs+mwaEmpty('hooks','Hook ideas are written every morning.'); return; }
  if(MWA_HTAB==='ideas'){
    const list=(d.ideas||[]).map((x,i)=>Object.assign({_i:i},x)).filter(x=>MWA_HFMT==='all'||x.format===MWA_HFMT);
    b.innerHTML=MWA_CSS+tabs
      +'<div class="mw-bar">'+[['all','Video + photo'],['video','Video openers'],['photo','Photo headlines']].map(o=>mwaChip('hfmt',o[0],o[1],MWA_HFMT)).join('')+'</div>'
      +'<div class="mw-sub" style="margin:-6px 0 12px">Openings written by AI for our projects - what the first 2 seconds of a video or the headline on a photo should be to stop the thumb. They ride today’s positive trends and the patterns of competitor ads that kept running 30+ days. Facts are kept to what we told it: check any detail before using.</div>'
      +(list.length?'<div class="mw-grid">'+list.map(x=>'<div class="mwa-card"><div class="mwa-b">'
        +'<div><span class="mwa-tag '+(x.format==='video'?'v':'p')+'"><i class="fa-solid '+(x.format==='video'?'fa-video':'fa-image')+'"></i> '+(x.format==='video'?'Video':'Photo')+'</span><span class="mwa-tag">'+esc(x.pattern||'')+'</span>'+(x.trend?'<span class="mwa-tag t">'+esc(x.trend)+'</span>':'')+'</div>'
        +'<div class="mwa-hook">“'+esc(x.hook)+'”</div>'
        +(x.on_screen?'<div class="mwa-row"><span>On screen:</span> '+esc(x.on_screen)+'</div>':'')
        +(x.visual?'<div class="mwa-row"><span>'+(x.format==='video'?'First 2 seconds:':'The photo:')+'</span> '+esc(x.visual)+'</div>':'')
        +(x.why?'<div class="mwa-row"><span>Why it stops the scroll:</span> '+esc(x.why)+'</div>':'')
        +'<div class="mwa-row"><span>For:</span> '+esc(x.project||'')+'</div>'
        +'<button class="mwa-copy" onclick="mwaCopy('+x._i+')"><i class="fa-regular fa-copy"></i> Copy</button>'
        +'</div></div>').join('')+'</div>':'<div class="card card-pad empty"><div>No ideas in this choice.</div></div>');
    return;
  }
  // proven: competitor ads still running after 30+ days - the opening line and the creative
  const list=(d.proven||[]);
  b.innerHTML=MWA_CSS+tabs
    +'<div class="mw-sub" style="margin:-6px 0 12px">Competitor ads that are still running after 30+ days - a brand keeps paying only for an ad that works. Their opening line is the hook; AI names the pattern and why it works.</div>'
    +(list.length?'<div class="mw-grid">'+list.map((x,i)=>'<div class="mwa-card" style="cursor:pointer" onclick="'+(x.snapshot?'window.open(\''+esc(x.snapshot)+'\',\'_blank\')':'')+'">'
      +'<div class="mwa-media" id="mwaM'+i+'"></div>'
      +'<div class="mwa-b"><div><span class="mwa-tag '+(x.media_type==='video'?'v':'p')+'">'+(x.media_type==='video'?'Video':'Photo')+'</span>'+(x.pattern?'<span class="mwa-tag">'+esc(x.pattern)+'</span>':'')+'<span class="mwa-tag t">Running '+x.days+' days</span></div>'
        +'<div class="mwa-hook" style="font-size:15px">“'+esc(x.first)+'”</div>'
        +(x.why?'<div class="mwa-row"><span>Why it works:</span> '+esc(x.why)+'</div>':'')
        +'<div class="mw-cc">'+esc(x.brand||'')+'</div></div></div>').join('')+'</div>'
      :'<div class="card card-pad empty"><div>No long-running competitor ads found.</div></div>');
  mwaMedia(list,'mwaM');
}
// the ad's picture / first video frame, through the same signed links as Competitor Ads
function mwaMedia(list,prefix){
  if(typeof compThumbFor!=='function'||typeof compSignedUrl!=='function') return;
  list.forEach((x,i)=>{ const el=$(prefix+i); if(!el) return; const m=compThumbFor(x); if(!m) return;
    compSignedUrl(m.key).then(u=>{ if(!u||!$(prefix+i)) return;
      if(m.kind==='video') el.innerHTML='<video src="'+esc(u)+'#t=0.1" muted playsinline preload="metadata"></video>'; else el.style.backgroundImage='url(\''+u+'\')'; }); });
}

/* ---------------------------------------------------------------- Launches */
/* Premium and luxury residential launches across India, from launch news read by AI (16 Nov 2026, Ayush: "Premium and
   Luxury Launches but all over India ... not through Ads ... don't consider CPs"; later the same evening: "limited to these
   companies or brands" - the 18 developers in MWA_DEVS, matched in the edge function). Filters: developer and city. */
const MWA_DEVS=['DTC Group','Siddha Group','Srijan Realty','Diamond Group','Merlin Group','Eden Group','Ambuja Neotia','Alcove Realty','Godrej Properties',
  'Mani Group','Vinayak Group','Unimark Group','Emami Realty','Sugam Homes','Primarc Group','Orbit Group','Gems Group'];
const MWA_CITY=[['all','All India'],['mum','Mumbai region'],['ncr','Delhi NCR'],['blr','Bengaluru'],['pune','Pune'],['hyd','Hyderabad'],['chn','Chennai'],['kol','Kolkata'],['other','Other cities']];
function mwaCityOf(c){ c=String(c||'').toLowerCase();
  if(/mumbai|thane|navi mumbai|panvel|worli|bandra|andheri|powai|borivali|mira|vasai|kalyan|dombivli|lonavala|alibaug/.test(c)) return 'mum';
  if(/gurugram|gurgaon|noida|delhi|ghaziabad|faridabad|greater noida|sonipat|ncr/.test(c)) return 'ncr';
  if(/bengaluru|bangalore/.test(c)) return 'blr'; if(/pune|pimpri|hinjewadi|kharadi/.test(c)) return 'pune';
  if(/hyderabad|secunderabad|gachibowli|kokapet/.test(c)) return 'hyd'; if(/chennai/.test(c)) return 'chn';
  if(/kolkata|howrah|rajarhat|new town|newtown|salt lake/.test(c)) return 'kol'; return 'other'; }
let MWA_LCITY='all', MWA_LDEV='all';
async function mwAiLaunches(){ await mwaGet('launches'); mwaDrawLaunches(); }
window.mwaLSet=function(k,v){ if(k==='city') MWA_LCITY=v; else MWA_LDEV=v; mwaDrawLaunches(); };
function mwaDrawLaunches(){
  const b=$('mwBody'); if(!b) return;
  const d=MWA.launches;
  const ch=(k,v,l,cur)=>'<button class="mw-chip'+(cur===v?' on':'')+'" onclick="mwaLSet(\''+k+'\',\''+v+'\')">'+l+'</button>';
  const bar='<div class="mw-bar"><select class="mw-sel" onchange="mwaLSet(\'dev\',this.value)"><option value="all">All 17 developers</option>'
      +MWA_DEVS.map(x=>'<option'+(MWA_LDEV===x?' selected':'')+'>'+esc(x)+'</option>').join('')+'</select>'+mwaMeta(d,'launches')+'</div>'
    +'<div class="mw-bar">'+MWA_CITY.map(o=>ch('city',o[0],o[1],MWA_LCITY)).join('')+'</div>';
  if(!d||!(d.projects||[]).length||!('launched' in (d.projects[0]||{}))){ b.innerHTML=MWA_CSS+bar+mwaEmpty('launches','Launch news is read by AI every morning.'); return; }
  const list=d.projects.filter(p=>(MWA_LDEV==='all'||p.brand===MWA_LDEV)&&(MWA_LCITY==='all'||mwaCityOf(p.city+' '+p.locality)===MWA_LCITY));
  b.innerHTML=MWA_CSS+bar
    +'<div class="mw-sub" style="margin:0 0 12px">New residential projects by DTC, Siddha, Srijan, Diamond, Merlin, Eden, Ambuja Neotia, Alcove, Godrej, Mani, Vinayak, Unimark, Emami, Sugam, Primarc, Orbit and Gems - anywhere in India, launched in the last 60 days. Every morning AI reads the launch news and searches the web for each developer; a new building is added to this list and drops off 60 days after its launch. Brokers and channel partners are left out.</div>'
    +(list.length?'<div class="mw-tw" style="max-height:calc(100vh - 320px)"><table class="mw-t"><thead><tr><th>Launched</th><th>Project</th><th>Developer</th><th>Location</th><th>Segment</th><th>Price from · Size</th><th>News</th></tr></thead><tbody>'
      +list.map(p=>{ const dd=mwDaysSince(p.launched);
        return '<tr><td><div class="mw-days'+(dd!=null&&dd<=14?' new':'')+'">'+(dd==null?'—':dd===0?'Today':dd+' day'+(dd===1?'':'s')+' ago')+'</div><div class="mw-sub">'+mwDmy(p.launched)+'</div></td>'
          +'<td><div class="mw-pn">'+esc(p.project)+'</div>'+(p.first_seen&&Date.now()-Date.parse(p.first_seen)<36*3600e3&&d.projects.some(x=>x.first_seen&&x.first_seen<p.first_seen)?'<span class="mw-tag own">New - added today</span>':'')+(p.reports>1?'<div class="mw-sub">'+p.reports+' reports</div>':'')+'</td>'
          +'<td>'+esc(p.developer||'—')+'</td>'
          +'<td>'+esc([p.locality,p.city].filter(Boolean).join(', ')||'—')+'</td>'
          +'<td>'+(p.segment?'<span class="mw-tag '+(p.segment==='luxury'?'comp':'rep')+'">'+esc(p.segment.charAt(0).toUpperCase()+p.segment.slice(1))+'</span>':'—')+'</td>'
          +'<td>'+esc([p.price,p.size].filter(Boolean).join(' · ')||'—')+'</td>'
          +'<td>'+(p.news||[]).map(n=>'<div><a href="'+esc(n.link)+'" target="_blank" rel="noopener" title="'+esc(n.title)+'">'+esc(n.source||'News')+' <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:10px"></i></a></div>').join('')+'</td></tr>'; }).join('')
      +'</tbody></table></div>':'<div class="card card-pad empty"><div>No launches for this choice in the last 60 days.</div></div>');
}

