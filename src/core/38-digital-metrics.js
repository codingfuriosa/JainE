/* ============================ DIGITAL METRICS ============================
   Google data for our brand and for our competitors (16 Oct 2026): YouTube, Google Maps,
   Search Console, Analytics, and Setup (the Google connection, what is being pulled, run log).

   NO PAGE OF ITS OWN ANY MORE. This started as a standalone Digital Metrics module showing ours
   beside theirs. The marketing modules were then regrouped by WHOSE data it is, so the same tab
   renderers are now drawn by two pages (src/core/40-marketing-modules.js) through dmTabView(),
   each time told a scope:
     'brand'      - Our Brand (route campaigns/...): YouTube, Google Maps, Search Console,
                    Analytics, Setup. Only our own channel, listings, sites and properties.
     'competitor' - Competitor Data (route competitors/...): YouTube, Google Maps. Only rows that
                    are not ours. Search Console and Analytics are private to each company, so
                    there is nothing to show for competitors, and Setup is ours alone.
   "Ours" is the is_own flag the tables already carry (dm_yt_channels / dm_places, and what the
   dm_*_compare functions return) - the flag the Add dialogs set from the brand picked.

   WHERE THE NUMBERS COME FROM. Only Google's official APIs, pulled every night at 02:30 IST by the
   digital-metrics-sync function into camp.dm_* tables, which this page only reads:
     our channel / listings / sites / GA4  - the marketing Google connection (Setup tab), read-only
     competitors' YouTube                  - public counts (YouTube Data API), saved as a reading a day
     competitors' Google Maps              - public rating and review count (Places API), a reading a day
   Competitors' Search Console and Analytics are private to them and are not shown - there is no
   official way to read them.

   NOTHING ON THIS PAGE IS ESTIMATED. Totals for a period are added up in the database from the
   daily rows Google gave (camp.dm_* read functions). Ratios are recomputed from their parts, never
   averaged. "Growth" for a competitor is today's reading minus the reading nearest before the period
   began; when tracking started inside the period, the page says from which date it is counting.
   GA4 users are never added across days (a person who visits on two days is one user) - the period
   figures are Google's own. A blank means Google has not reported it, not zero. */
let DM_TAB='youtube', DM_DAYS=28, DM_SITE=null, DM_PROP=null, DM_CHAN=null, DM_CHARTS=[];
// Which side the open tab is drawing ('brand' or 'competitor') - set by dmTabView, read by the
// renderers and by the Add dialogs, so a channel added on Competitor Data cannot be filed as ours.
let DM_SCOPE='brand';
/* [route segment, title, icon, icon set, scopes it appears in]. Route segments are the ones the
   two pages use (campaigns/search-console, competitors/youtube, ...). */
const DM_TABS=[['youtube','YouTube','fa-youtube','fa-brands',['brand','competitor']],['maps','Google Maps','fa-location-dot','fa-solid',['brand','competitor']],
  ['search-console','Search Console','fa-magnifying-glass','fa-solid',['brand']],['analytics','Analytics','fa-chart-line','fa-solid',['brand']],['setup','Setup','fa-plug','fa-solid',['brand']]];
// The route the Setup tab lives at, for every "connect Google first" link on either page.
const DM_SETUP_ROUTE='campaigns/setup';
const DM_FN=SUPABASE_URL+'/functions/v1/digital-metrics-sync';
function dmCamp(){ return sb.schema('camp'); }
function dmIst(){ return new Date(Date.now()+5.5*3600000).toISOString().slice(0,10); }
function dmAdd(d,n){ return new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10); }
// The period always ends YESTERDAY: today's figures are still being counted by Google.
function dmRange(){ const to=dmAdd(dmIst(),-1); return {from:dmAdd(to,-(DM_DAYS-1)),to:to}; }
function dmN(x,dp){ if(x===null||x===undefined||x===''||isNaN(Number(x)))return '—'; return Number(x).toLocaleString('en-IN',{maximumFractionDigits:dp===undefined?0:dp}); }
function dmPct(x,dp){ return (x===null||x===undefined||isNaN(Number(x)))?'—':(Number(x)*100).toFixed(dp===undefined?1:dp)+'%'; }
function dmDelta(now,base){
  if(now===null||now===undefined||base===null||base===undefined)return '';
  const d=Number(now)-Number(base); if(!d)return '<div style="font-size:11.5px;color:var(--slate)">no change</div>';
  return '<div style="font-size:11.5px;font-weight:600;color:'+(d>0?'var(--ok)':'var(--err)')+'">'+(d>0?'+':'')+dmN(d)+'</div>';
}
function dmArg(s){ return esc(JSON.stringify(String(s==null?'':s))); }
function dmDur(sec){ if(sec==null||isNaN(sec))return '—'; sec=Math.round(sec); const m=Math.floor(sec/60),s=sec%60; return m+':'+String(s).padStart(2,'0'); }
function dmKill(){ DM_CHARTS.forEach(function(c){ try{c.destroy();}catch(e){} }); DM_CHARTS=[]; }
function dmKpi(label,val,sub,ic,color){
  return '<div class="kpi"><div class="top"><div class="lbl">'+esc(label)+'</div><div class="ic" style="background:'+color+'1a;color:'+color+'"><i class="'+ic+'"></i></div></div>'
    +'<div class="val">'+val+'</div>'+(sub?'<div style="font-size:12px;color:var(--slate);margin-top:4px">'+sub+'</div>':'')+'</div>';
}
function dmCard(title,sub,body,extra){
  return '<div class="card card-pad" style="margin-bottom:16px">'
    +'<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start"><div><div class="sec-title">'+title+'</div>'
    +(sub?'<div class="sec-sub">'+sub+'</div>':'<div style="height:10px"></div>')+'</div>'+(extra||'')+'</div>'+body+'</div>';
}
function dmNote(icon,html){ return '<div style="display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border:1px dashed var(--line);border-radius:10px;color:var(--slate);font-size:13px;margin:6px 0 4px"><i class="fa-solid '+icon+'" style="margin-top:2px"></i><div>'+html+'</div></div>'; }
function dmTable(heads,rows,empty){
  if(!rows.length)return dmNote('fa-circle-info',empty||'Nothing for this period yet.');
  return '<div style="overflow-x:auto"><table><thead><tr>'+heads.map(function(h){return '<th>'+h+'</th>';}).join('')+'</tr></thead><tbody>'
    +rows.map(function(r){return '<tr>'+r.map(function(c){return '<td>'+c+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div>';
}
function dmChart(id,labels,sets){
  const elc=document.getElementById(id); if(!elc||typeof Chart==='undefined')return;
  const colors=['#2563eb','#16a34a','#ea580c','#9333ea','#dc2626'];
  try{ DM_CHARTS.push(new Chart(elc,{type:'line',data:{labels:labels,datasets:sets.map(function(s,i){
      return {label:s.label,data:s.data,borderColor:colors[i%5],backgroundColor:colors[i%5]+'22',tension:.25,pointRadius:labels.length>40?0:2,fill:i===0,yAxisID:s.axis||'y',spanGaps:false};})},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:sets.length>1}},
      scales:Object.assign({x:{ticks:{maxTicksLimit:10}},y:{beginAtZero:true}},sets.some(function(s){return s.axis==='y2';})?{y2:{position:'right',beginAtZero:true,grid:{drawOnChartArea:false}}}:{})}})); }catch(e){}
}
async function dmCall(body){
  const {data:{session}}=await sb.auth.getSession();
  const r=await fetch(DM_FN,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+((session&&session.access_token)||'')},body:JSON.stringify(body)});
  const jr=await r.json().catch(function(){return {};});
  if(!r.ok||jr.error)throw new Error(jr.error||('server said '+r.status));
  return jr;
}
async function dmSources(kind){
  const {data}=await dmCamp().from('dm_sources').select('*').eq('kind',kind).order('label');
  return data||[];
}
async function dmWatchlist(){
  if(window._dmWl)return window._dmWl;
  const {data}=await dmCamp().from('competitor_watchlist').select('id,name,category').in('category',['brand','competitor']).order('name');
  return (window._dmWl=data||[]);
}

/* Back from Google's consent screen: ?google=ok|err&msg=... (the callback keeps it out of the hash
   so the router never sees it). The callback lands on campaigns.html#/setup; Our Brand calls this
   on every draw, and it does nothing unless the flag is there. */
function dmOauthReturn(){
  try{
    const q=new URLSearchParams(location.search);
    if(!q.get('google'))return;
    if(q.get('google')==='ok')toast('Google connected for Our Brand. Finding your sites and channels…','ok');
    else toast('Google connection failed: '+(q.get('msg')||'unknown reason'),'err');
    history.replaceState(history.state,'',location.pathname+location.hash);
    if(q.get('google')==='ok')dmCall({action:'discover'}).then(function(){ if(PAGE==='campaigns')renderPage(); }).catch(function(e){toast('Discover: '+e.message,'err');});
  }catch(e){}
}
function dmTabDef(tab){ return DM_TABS.filter(function(t){return t[0]===tab;})[0]; }
/* Draws one Digital Metrics tab into host, below the calling page's own header and tab bar.
   tab: a DM_TABS route segment ('search' and 'connect' are the old names, still accepted so an
   old bookmark lands on the right tab). scope: 'brand' or 'competitor'. A tab that does not exist
   for that scope (Search Console on Competitor Data) falls back to YouTube rather than showing
   someone else's - here, our own - data on the wrong page. */
async function dmTabView(host,tab,scope){
  dmKill();
  DM_SCOPE=scope==='competitor'?'competitor':'brand';
  if(tab==='search')tab='search-console'; if(tab==='connect')tab='setup';
  const def=dmTabDef(tab);
  DM_TAB=(def&&def[4].indexOf(DM_SCOPE)!==-1)?tab:'youtube';
  const r=dmRange();
  host.innerHTML=(DM_TAB==='setup'?'':'<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:0 0 14px">'
      +'<div class="seg">'+[7,28,90].map(function(d){return '<button class="seg-btn'+(DM_DAYS===d?' on':'')+'" onclick="dmSetDays('+d+')">Last '+d+' days</button>';}).join('')+'</div>'
      +'<span style="color:var(--slate);font-size:12.5px">'+esc(fmtDate(r.from))+' – '+esc(fmtDate(r.to))+' · straight from Google, refreshed nightly</span></div>')
    +'<div id="dmBody"><div class="loader"><div class="spin"></div></div></div>';
  const body=$('dmBody');
  try{
    if(DM_TAB==='youtube')await dmYouTube(body,r);
    else if(DM_TAB==='maps')await dmMaps(body,r);
    else if(DM_TAB==='search-console')await dmSearch(body,r);
    else if(DM_TAB==='analytics')await dmAnalytics(body,r);
    else await dmConnect(body);
  }catch(e){ body.innerHTML=dmNote('fa-triangle-exclamation','Could not load: '+esc(e.message||String(e))); }
}
// Rows of a dm_* table or compare function that belong on the open page.
function dmInScope(x){ return DM_SCOPE==='brand'?!!x.is_own:!x.is_own; }
window.dmSetDays=function(d){ DM_DAYS=d; renderPage(); };
window.dmPick=function(which,val){ if(which==='site')DM_SITE=val; if(which==='prop')DM_PROP=val; if(which==='chan')DM_CHAN=val; renderPage(); };
function dmSelect(which,list,cur){
  return '<select class="mu-sel" style="max-width:340px" onchange="dmPick(\''+which+'\',this.value)">'
    +list.map(function(s){return '<option value="'+esc(s.source_id)+'"'+(s.source_id===cur?' selected':'')+'>'+esc(s.label||s.source_id)+'</option>';}).join('')+'</select>';
}
function dmNeedConnect(what){
  return dmNote('fa-plug',esc(what)+' needs the marketing Google connection. Open <a href="#" onclick="navTo(DM_SETUP_ROUTE);return false">Setup</a> on Our Brand, connect the company Google account that owns it, and the next nightly pull fills this in.');
}

/* Why a tab is empty, in one line at its top. The nightly pull writes each part's result to
   camp.dm_sync_log; when the newest one failed (most often: an API key not added yet) the tab says
   that, instead of tables that read "no channels yet" while the channels are all there. */
async function dmPartStatus(part,what){
  const {data}=await dmCamp().from('dm_sync_log').select('ok,message,started_at,rows').eq('part',part).order('started_at',{ascending:false}).limit(1);
  const x=data&&data[0];
  if(!x) return dmNote('fa-hourglass-half',esc(what)+' has not been read yet - the first pull runs tonight.');
  if(x.ok) return '';
  return '<div style="display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border:1px solid #fcd34d;background:#fffbeb;border-radius:10px;color:#92400e;font-size:13px;margin:0 0 14px"><i class="fa-solid fa-triangle-exclamation" style="margin-top:2px"></i><div><b>No '+esc(what)+' figures yet.</b> The last pull ('+esc(fmtDateShort(x.started_at))+') stopped: '+esc(x.message||'unknown error')+'. Nothing below is filled in until that is fixed - the steps are in Our Brand → Setup.</div></div>';
}

/* ---------------------------------------------------------------- YouTube */
async function dmYouTube(body,r){
  // Our own channel's private analytics (YouTube Analytics API) only ever appear on Our Brand.
  const own=DM_SCOPE==='brand'?(await dmSources('yt_channel')).filter(function(s){return s.enabled;}):[];
  if(own.length&&!own.some(function(s){return s.source_id===DM_CHAN;}))DM_CHAN=own[0].source_id;
  let html=await dmPartStatus('yt_public','YouTube public');
  if(DM_SCOPE==='brand'&&!own.length) html+=dmCard('Our channel','YouTube Analytics - views, watch time, subscribers gained and lost.',dmNeedConnect('Our YouTube channel'));
  else if(own.length){
    const ch=DM_CHAN;
    const [{data:days},top,traffic,country,device,subs,demo]=await Promise.all([
      dmCamp().from('dm_yt_own_daily').select('*').eq('channel_id',ch).eq('video_id','').gte('day',r.from).lte('day',r.to).order('day'),
      dmCamp().rpc('dm_yt_top_videos',{p_channel:ch,p_from:r.from,p_to:r.to,p_limit:15}),
      dmCamp().rpc('dm_yt_breakdown',{p_channel:ch,p_dim:'insightTrafficSourceType',p_from:r.from,p_to:r.to}),
      dmCamp().rpc('dm_yt_breakdown',{p_channel:ch,p_dim:'country',p_from:r.from,p_to:r.to}),
      dmCamp().rpc('dm_yt_breakdown',{p_channel:ch,p_dim:'deviceType',p_from:r.from,p_to:r.to}),
      dmCamp().rpc('dm_yt_breakdown',{p_channel:ch,p_dim:'subscribedStatus',p_from:r.from,p_to:r.to}),
      dmCamp().rpc('dm_yt_breakdown',{p_channel:ch,p_dim:'ageGroup,gender',p_from:r.from,p_to:r.to})]);
    const d=days||[]; const sum=function(k){ return d.length?d.reduce(function(a,x){return a+(Number(x[k])||0);},0):null; };
    const views=sum('views'),mins=sum('estimated_minutes_watched');
    const kpis='<div class="grid kpis" style="margin-bottom:14px">'
      +dmKpi('Views',dmN(views),d.length+' day'+(d.length===1?'':'s')+' reported','fa-solid fa-eye','#dc2626')
      +dmKpi('Watch time',mins==null?'—':dmN(mins/60,0)+' h','avg '+(views?dmDur(mins*60/views):'—')+' per view','fa-solid fa-clock','#2563eb')
      +dmKpi('Subscribers',d.length?((sum('subscribers_gained')-sum('subscribers_lost')>=0?'+':'')+dmN(sum('subscribers_gained')-sum('subscribers_lost'))):'—','+'+dmN(sum('subscribers_gained'))+' gained · −'+dmN(sum('subscribers_lost'))+' lost','fa-solid fa-user-plus','#16a34a')
      +dmKpi('Engagement',dmN(sum('likes')),'likes · '+dmN(sum('comments'))+' comments · '+dmN(sum('shares'))+' shares · '+dmN(sum('videos_added_to_playlists'))+' playlist adds','fa-solid fa-heart','#9333ea')
      +'</div>';
    const bd=function(title,res,fmtKey){
      const rows=(res&&res.data)||[];
      const span=rows.length&&rows[0].period_from&&rows[0].period_to&&(rows[0].period_from!==r.from||rows[0].period_to!==r.to)?'<div style="font-size:11.5px;color:var(--slate);margin-bottom:6px">Google gives this one only as a total: '+esc(fmtDate(rows[0].period_from))+' – '+esc(fmtDate(rows[0].period_to))+'</div>':'';
      return '<div><div style="font-weight:700;font-size:13px;margin-bottom:6px">'+title+'</div>'+span+dmTable(
        rows.length&&rows[0].viewer_percentage!=null?['Viewers','Share of views']:['','Views','Watch hours'],
        rows.slice(0,10).map(function(x){ return x.viewer_percentage!=null
          ?[esc(String(x.dim_value).replace('|',' · ').replace('age','')),dmN(x.viewer_percentage,1)+'%']
          :[esc(fmtKey?fmtKey(x.dim_value):x.dim_value),dmN(x.views),dmN(x.minutes/60,1)]; }),'Not reported yet.')+'</div>';
    };
    html+=dmCard('Our channel'+(own.length>1?'':' · '+esc(own[0].label||'')),'YouTube Analytics for our channel. Google finalises the last 2–3 days later, so those can still rise.',
      kpis+'<div style="height:240px;margin-bottom:16px"><canvas id="dmYtCh"></canvas></div>'
      +'<div style="font-weight:700;font-size:13px;margin-bottom:6px">Most-watched videos in this period</div>'
      +dmTable(['Video','Published','Views','Watch hours','Likes','Comments','Shares','Subs gained'],((top&&top.data)||[]).map(function(x){
        return ['<a href="https://youtu.be/'+esc(x.video_id)+'" target="_blank" rel="noopener">'+esc(x.title||x.video_id)+'</a>',esc(x.published_at?fmtDate(x.published_at):'—'),dmN(x.views),dmN(x.minutes/60,1),dmN(x.likes),dmN(x.comments),dmN(x.shares),dmN(x.subscribers_gained)];}),'No video-level figures for this period yet.')
      +'<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));margin-top:16px">'
      +bd('Traffic source',traffic,function(s){return String(s).replace(/_/g,' ').toLowerCase();})+bd('Country',country)+bd('Device',device,function(s){return String(s).toLowerCase();})
      +bd('Subscribed?',subs,function(s){return s==='SUBSCRIBED'?'Subscribers':s==='UNSUBSCRIBED'?'Not subscribed':s;})+bd('Age & gender (viewers)',demo)+'</div>',
      own.length>1?dmSelect('chan',own,ch):'');
    setTimeout(function(){ dmChart('dmYtCh',d.map(function(x){return fmtDateShort(x.day);}),[{label:'Views',data:d.map(function(x){return x.views;})},{label:'Watch hours',data:d.map(function(x){return x.estimated_minutes_watched==null?null:Math.round(x.estimated_minutes_watched/6)/10;}),axis:'y2'}]); },0);
  }
  // public counts - ours on Our Brand, everybody else's on Competitor Data
  const {data:cmp,error}=await dmCamp().rpc('dm_yt_public_compare',{p_from:r.from});
  if(error)throw error;
  const rows=(cmp||[]).filter(dmInScope).map(function(x){
    const since=x.base_date&&x.base_date>r.from?'<div style="font-size:11px;color:var(--slate)">counting from '+esc(fmtDateShort(x.base_date))+'</div>':'';
    return [(x.is_own?'<span class="tag t-blue">Ours</span> ':'')+esc(x.brand||'—'),
      '<a href="https://www.youtube.com/channel/'+esc(x.channel_id)+'" target="_blank" rel="noopener">'+esc(x.title||x.channel_id)+'</a>'+(x.handle?'<div style="font-size:11.5px;color:var(--slate)">'+esc(x.handle)+'</div>':''),
      x.hidden_subscribers?'<span style="color:var(--slate)">hidden by channel</span>':dmN(x.subscribers)+(x.base_date&&x.latest_date!==x.base_date?dmDelta(x.subscribers,x.base_subscribers):'')+since,
      dmN(x.views)+(x.base_date&&x.latest_date!==x.base_date?dmDelta(x.views,x.base_views):''),
      dmN(x.videos),x.latest_date?dmN(x.uploads_in_period):'—',x.latest_date?dmN(x.upload_views):'—',esc(x.latest_date?fmtDateShort(x.latest_date):'not read yet')];
  });
  html+=dmCard(DM_SCOPE==='brand'?'Our channels in public':'Competitors on YouTube',(DM_SCOPE==='brand'?'What anybody sees on our channels - the same public counts Competitor Data reads for other developers, so the two can be set side by side. ':'')
      +'Public YouTube counts, read once a day. YouTube itself rounds public subscriber counts (e.g. 18.9K is shown to everyone as 18,900). Growth = latest reading minus the reading from the start of the period.',
    dmTable(['Brand','Channel','Subscribers','Total views','Videos','Uploads this period','Views on those uploads','As of'],rows,'No public counts read yet for the channels listed below.'));
  html+=await dmTrackedChannels();
  body.innerHTML=html;
}
async function dmTrackedChannels(){
  const [{data:ch},wl]=await Promise.all([dmCamp().from('dm_yt_channels').select('*').order('is_own',{ascending:false}).order('title'),dmWatchlist()]);
  const name=function(id){ const w=wl.filter(function(x){return x.id===id;})[0]; return w?w.name:'—'; };
  return dmCard(DM_SCOPE==='brand'?'Our channels being tracked':'Competitor channels being tracked','Only <b>confirmed</b> channels are read. Confirm a channel once you have checked it really is that brand\'s official channel.',
    dmTable(['Brand','Channel','Channel ID','Status',''],(ch||[]).filter(dmInScope).map(function(x){
      return [(x.is_own?'<span class="tag t-blue">Ours</span> ':'')+esc(x.is_own&&!x.watchlist_id?'The Jain Group':name(x.watchlist_id)),esc(x.title||'(name fills in after the first read)'),
        '<code style="font-size:11.5px">'+esc(x.channel_id)+'</code>',
        x.confirmed?'<span class="tag t-green">Confirmed</span>':'<span class="tag t-amber">Waiting for a check</span>',
        '<div style="display:flex;gap:6px;justify-content:flex-end">'+(x.confirmed?'':'<button class="btn btn-sm btn-primary" onclick="dmYtConfirm('+dmArg(x.channel_id)+',true)">Confirm</button>')
          +(x.confirmed?'<button class="btn btn-sm" onclick="dmYtConfirm('+dmArg(x.channel_id)+',false)">Pause</button>':'')
          +'<button class="btn btn-sm" onclick="dmYtRemove('+dmArg(x.channel_id)+')"><i class="fa-solid fa-trash"></i></button></div>'];}),'No channels yet.'),
    '<button class="btn btn-sm btn-primary" onclick="dmYtAddModal()"><i class="fa-solid fa-plus"></i> Add channel</button>');
}
window.dmYtConfirm=async function(id,on){
  const {error}=await dmCamp().from('dm_yt_channels').update({confirmed:on,updated_at:new Date().toISOString()}).eq('channel_id',id);
  if(error)return toast(error.message,'err'); toast(on?'Confirmed - read from tonight (or press Pull now in Our Brand → Setup)':'Paused','ok'); renderPage();
};
window.dmYtRemove=async function(id){
  if(!await confirmDialog('Stop tracking this channel and delete its stored readings?'))return;
  const {error}=await dmCamp().from('dm_yt_channels').delete().eq('channel_id',id);
  if(error)return toast(error.message,'err'); renderPage();
};
// Only the brands of the open page: ours on Our Brand, competitors on Competitor Data - so a
// channel or place can never be filed on the other side by picking the wrong row here.
function dmBrandSelect(wl){
  const mine=DM_SCOPE==='brand';
  return '<label>Brand<select id="dmBrand">'+(mine?'<option value="own">The Jain Group (ours)</option>':'')
    +wl.filter(function(w){return mine?w.category==='brand':w.category!=='brand';})
      .map(function(w){return '<option value="'+w.id+'">'+esc(w.name)+(w.category==='brand'?' (ours)':'')+'</option>';}).join('')+'</select></label>';
}
window.dmYtAddModal=async function(){
  const wl=await dmWatchlist();
  openModal('<div class="modal-head"><h3><i class="fa-brands fa-youtube" style="color:#dc2626"></i> Add a YouTube channel</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm">'+dmBrandSelect(wl)
    +'<label>Channel link, @handle, channel ID, or a name to search<input id="dmYtQ" placeholder="https://www.youtube.com/@orbitgroupkol" onkeydown="if(event.key===\'Enter\')dmYtFind()"></label>'
    +'<button class="btn" onclick="dmYtFind()"><i class="fa-solid fa-magnifying-glass"></i> Find</button>'
    +'<div id="dmYtRes" style="margin-top:12px"></div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>');
};
window.dmYtFind=async function(){
  const box=$('dmYtRes'); box.innerHTML='<div class="loader"><div class="spin"></div></div>';
  try{
    const jr=await dmCall({action:'find_channel',q:$('dmYtQ').value});
    box.innerHTML=(jr.results||[]).length?jr.results.map(function(x){
      return '<div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line-2)">'
        +(x.thumbnail?'<img src="'+esc(x.thumbnail)+'" style="width:36px;height:36px;border-radius:50%">':'')
        +'<div style="flex:1;min-width:0"><b>'+esc(x.title||'')+'</b> '+(x.handle?'<span style="color:var(--slate)">'+esc(x.handle)+'</span>':'')
        +'<div style="font-size:11.5px;color:var(--slate)">'+esc(x.channel_id)+(x.subscribers!=null?' · '+dmN(x.subscribers)+' subscribers':'')+'</div></div>'
        +'<a class="btn btn-sm" href="https://www.youtube.com/channel/'+esc(x.channel_id)+'" target="_blank" rel="noopener">Open</a>'
        +'<button class="btn btn-sm btn-primary" onclick="dmYtAdd('+dmArg(x.channel_id)+','+dmArg(x.title||'')+','+dmArg(x.handle||'')+')">Add</button></div>';}).join('')
      :dmNote('fa-circle-info','No channel found.');
  }catch(e){ box.innerHTML=dmNote('fa-triangle-exclamation',esc(e.message)); }
};
window.dmYtAdd=async function(id,title,handle){
  const b=$('dmBrand').value;
  const row={channel_id:id,title:title||null,handle:handle||null,is_own:b==='own'||(window._dmWl||[]).some(function(w){return String(w.id)===b&&w.category==='brand';}),
    watchlist_id:b==='own'?null:Number(b),confirmed:false,active:true,updated_at:new Date().toISOString()};
  const {error}=await dmCamp().from('dm_yt_channels').upsert(row,{onConflict:'channel_id'});
  if(error)return toast(error.message,'err');
  toast('Added - open it on YouTube to check it is the right one, then press Confirm','ok'); closeModal(); renderPage();
};

/* ---------------------------------------------------------------- Google Maps */
const DM_GBP={search:['BUSINESS_IMPRESSIONS_DESKTOP_SEARCH','BUSINESS_IMPRESSIONS_MOBILE_SEARCH'],maps:['BUSINESS_IMPRESSIONS_DESKTOP_MAPS','BUSINESS_IMPRESSIONS_MOBILE_MAPS']};
async function dmMaps(body,r){
  // Our listings' Business Profile figures are private to us - Our Brand only.
  const locs=DM_SCOPE==='brand'?(await dmSources('gbp_location')).filter(function(s){return s.enabled;}):[];
  let html=await dmPartStatus('places','Google Maps rating');
  if(DM_SCOPE!=='brand'){ /* competitors: public Places figures only, below */ }
  else if(!locs.length) html+=dmCard('Our listings','Business Profile - how often our listings were seen on Google Search and Maps, and what people did.',
    dmNeedConnect('Our Google Maps listings')+dmNote('fa-hourglass-half','Google also has to approve Business Profile API access for our Cloud project once (a form; usually a few days). Steps are in the setup guide.'));
  else{
    const [{data:sums},{data:series},{data:kwLatest},{data:revs}]=await Promise.all([
      dmCamp().rpc('dm_gbp_sum',{p_from:r.from,p_to:r.to}),dmCamp().rpc('dm_gbp_series',{p_from:r.from,p_to:r.to}),
      dmCamp().from('dm_gbp_keywords_monthly').select('month').order('month',{ascending:false}).limit(1),
      dmCamp().from('dm_gbp_reviews').select('*').order('create_time',{ascending:false}).limit(25)]);
    const by={}; (sums||[]).forEach(function(x){ (by[x.location]=by[x.location]||{})[x.metric]=x.value; });
    const tot=function(ms,loc){ let any=false,s=0; Object.keys(by).forEach(function(l){ if(loc&&l!==loc)return; ms.forEach(function(m){ if(by[l][m]!=null){any=true;s+=Number(by[l][m]);} }); }); return any?s:null; };
    html+=dmCard('Our listings','Business Profile performance, as Google reports it per listing. Google publishes these a few days late.',
      '<div class="grid kpis" style="margin-bottom:14px">'
        +dmKpi('Seen on Google Search',dmN(tot(DM_GBP.search)),'mobile '+dmN(tot(['BUSINESS_IMPRESSIONS_MOBILE_SEARCH']))+' · desktop '+dmN(tot(['BUSINESS_IMPRESSIONS_DESKTOP_SEARCH'])),'fa-brands fa-google','#2563eb')
        +dmKpi('Seen on Google Maps',dmN(tot(DM_GBP.maps)),'mobile '+dmN(tot(['BUSINESS_IMPRESSIONS_MOBILE_MAPS']))+' · desktop '+dmN(tot(['BUSINESS_IMPRESSIONS_DESKTOP_MAPS'])),'fa-solid fa-map','#16a34a')
        +dmKpi('Calls',dmN(tot(['CALL_CLICKS'])),'taps on the call button','fa-solid fa-phone','#ea580c')
        +dmKpi('Directions · website',dmN(tot(['BUSINESS_DIRECTION_REQUESTS']))+' · '+dmN(tot(['WEBSITE_CLICKS'])),'direction requests · website clicks · '+dmN(tot(['BUSINESS_CONVERSATIONS']))+' chats','fa-solid fa-route','#9333ea')
      +'</div><div style="height:220px;margin-bottom:16px"><canvas id="dmGbpCh"></canvas></div>'
      +dmTable(['Listing','Search views','Maps views','Calls','Directions','Website clicks','Chats'],locs.map(function(s){
        return ['<b>'+esc(s.label||s.source_id)+'</b>'+(s.meta&&s.meta.address?'<div style="font-size:11.5px;color:var(--slate)">'+esc(s.meta.address)+'</div>':''),
          dmN(tot(DM_GBP.search,s.source_id)),dmN(tot(DM_GBP.maps,s.source_id)),dmN(tot(['CALL_CLICKS'],s.source_id)),dmN(tot(['BUSINESS_DIRECTION_REQUESTS'],s.source_id)),
          dmN(tot(['WEBSITE_CLICKS'],s.source_id)),dmN(tot(['BUSINESS_CONVERSATIONS'],s.source_id))];})));
    // keywords people searched to find us (Google reports these by month, not by day)
    const month=kwLatest&&kwLatest[0]&&kwLatest[0].month;
    if(month){
      const {data:kw}=await dmCamp().from('dm_gbp_keywords_monthly').select('*').eq('month',month).order('value',{ascending:false,nullsFirst:false}).limit(200);
      const agg={}; (kw||[]).forEach(function(x){ const a=agg[x.keyword]=agg[x.keyword]||{v:null,t:null}; if(x.value!=null)a.v=(a.v||0)+Number(x.value); if(x.threshold!=null)a.t=Math.max(a.t||0,Number(x.threshold)); });
      const list=Object.keys(agg).map(function(k){return [k,agg[k]];}).sort(function(a,b){return (b[1].v||0)-(a[1].v||0);}).slice(0,30);
      html+=dmCard('What people searched to find us · '+esc(new Date(month).toLocaleDateString('en-IN',{month:'long',year:'numeric'})),'Google gives an exact count for common searches and only "fewer than N" for rare ones.',
        dmTable(['Search term','Times our listing was shown'],list.map(function(x){return [esc(x[0]),x[1].v!=null?dmN(x[1].v):'fewer than '+dmN(x[1].t)];})));
    }
    const lname=function(l){ const s=locs.filter(function(x){return x.source_id===l;})[0]; return s?s.label:l; };
    html+=dmCard('Latest reviews on our listings','Newest first, with whether we have replied.',dmTable(['Date','Listing','Stars','Review','Our reply'],(revs||[]).map(function(x){
      return [esc(fmtDateShort(x.create_time)),esc(lname(x.location)),x.star_rating!=null?'<b>'+x.star_rating+'</b> ★':'—',esc((x.comment||'(rating only)').slice(0,220)),
        x.reply_comment?'<span class="tag t-green">Replied</span>':'<span class="tag t-amber">No reply</span>'];}),'No reviews stored yet.'));
    setTimeout(function(){
      const days=[...new Set((series||[]).map(function(x){return x.day;}))].sort();
      const val=function(d,ms){ let s=null; (series||[]).forEach(function(x){ if(x.day===d&&ms.indexOf(x.metric)!==-1&&x.value!=null)s=(s||0)+Number(x.value); }); return s; };
      dmChart('dmGbpCh',days.map(fmtDateShort),[{label:'Search views',data:days.map(function(d){return val(d,DM_GBP.search);})},{label:'Maps views',data:days.map(function(d){return val(d,DM_GBP.maps);})},
        {label:'Calls + directions + website',data:days.map(function(d){return val(d,['CALL_CLICKS','BUSINESS_DIRECTION_REQUESTS','WEBSITE_CLICKS']);}),axis:'y2'}]);
    },0);
  }
  // Public ratings: the compare function returns every tracked place with its is_own flag; the
  // reviews are then asked for only those places, so the 25 newest are the 25 newest ON THIS SIDE
  // rather than 25 overall with ours (or theirs) filtered out afterwards.
  const {data:cmpAll,error}=await dmCamp().rpc('dm_places_compare',{p_from:r.from});
  if(error)throw error;
  const cmp=(cmpAll||[]).filter(dmInScope);
  const pids=cmp.map(function(x){return x.place_id;});
  const {data:prev}=pids.length?await dmCamp().from('dm_place_reviews').select('*').in('place_id',pids).order('publish_time',{ascending:false}).limit(25):{data:[]};
  html+=dmCard(DM_SCOPE==='brand'?'Our places on Google Maps - public rating':'Competitors on Google Maps','Public rating and number of reviews, read once a day from Google\'s Places API. Change = latest reading minus the one from the start of the period.',
    dmTable(['Brand','Place','Rating','Reviews','As of'],cmp.map(function(x){
      const since=x.base_date&&x.base_date>r.from?'<div style="font-size:11px;color:var(--slate)">counting from '+esc(fmtDateShort(x.base_date))+'</div>':'';
      return [(x.is_own?'<span class="tag t-blue">Ours</span> ':'')+esc(x.brand||(x.is_own?'The Jain Group':'—')),
        (x.maps_uri?'<a href="'+esc(x.maps_uri)+'" target="_blank" rel="noopener">':'')+esc(x.name||x.label||x.place_id)+(x.maps_uri?'</a>':'')+(x.address?'<div style="font-size:11.5px;color:var(--slate)">'+esc(x.address)+'</div>':''),
        x.rating!=null?'<b>'+Number(x.rating).toFixed(1)+'</b> ★'+(x.base_rating!=null&&x.base_date!==x.latest_date&&Number(x.base_rating)!==Number(x.rating)?'<div style="font-size:11.5px;color:var(--slate)">was '+Number(x.base_rating).toFixed(1)+'</div>':''):'—',
        dmN(x.user_ratings_total)+(x.base_date&&x.base_date!==x.latest_date?dmDelta(x.user_ratings_total,x.base_total):'')+since,
        esc(x.latest_date?fmtDateShort(x.latest_date):'not read yet')];}),'No confirmed places yet - add and confirm them below.'));
  const plabel={}; cmp.forEach(function(x){ plabel[x.place_id]=(x.brand?x.brand+' · ':'')+(x.name||x.label||''); });
  html+=dmCard(DM_SCOPE==='brand'?'Newest public reviews on our places':'Newest public reviews on competitors\' places','Google shows at most 5 reviews per place at a time; each one is kept from the day it first appeared.',
    dmTable(['Date','Place','Stars','Review'],(prev||[]).map(function(x){ return [esc(x.publish_time?fmtDateShort(x.publish_time):'—'),esc(plabel[x.place_id]||x.place_id),x.rating!=null?x.rating+' ★':'—',esc((x.text||'').slice(0,220))]; }),'No reviews stored yet.'));
  html+=await dmTrackedPlaces();
  body.innerHTML=html;
}
async function dmTrackedPlaces(){
  const [{data:pl},wl]=await Promise.all([dmCamp().from('dm_places').select('*').order('is_own',{ascending:false}).order('label'),dmWatchlist()]);
  const name=function(id){ const w=wl.filter(function(x){return x.id===id;})[0]; return w?w.name:'—'; };
  return dmCard(DM_SCOPE==='brand'?'Our places being tracked':'Competitor places being tracked','Only <b>confirmed</b> places are read. Open each on Google Maps and confirm it is the right office or project before relying on it.',
    dmTable(['Brand','Place','Status',''],(pl||[]).filter(dmInScope).map(function(x){
      return [(x.is_own?'<span class="tag t-blue">Ours</span> ':'')+esc(x.is_own&&!x.watchlist_id?'The Jain Group':name(x.watchlist_id)),
        (x.maps_uri?'<a href="'+esc(x.maps_uri)+'" target="_blank" rel="noopener">'+esc(x.label||x.place_id)+'</a>':esc(x.label||x.place_id))+(x.address?'<div style="font-size:11.5px;color:var(--slate)">'+esc(x.address)+'</div>':''),
        x.confirmed?'<span class="tag t-green">Confirmed</span>':'<span class="tag t-amber">Waiting for a check</span>',
        '<div style="display:flex;gap:6px;justify-content:flex-end">'+(x.confirmed?'<button class="btn btn-sm" onclick="dmPlConfirm('+dmArg(x.place_id)+',false)">Pause</button>':'<button class="btn btn-sm btn-primary" onclick="dmPlConfirm('+dmArg(x.place_id)+',true)">Confirm</button>')
          +'<button class="btn btn-sm" onclick="dmPlRemove('+dmArg(x.place_id)+')"><i class="fa-solid fa-trash"></i></button></div>'];}),'No places yet.'),
    '<button class="btn btn-sm btn-primary" onclick="dmPlAddModal()"><i class="fa-solid fa-plus"></i> Add place</button>');
}
window.dmPlConfirm=async function(id,on){
  const {error}=await dmCamp().from('dm_places').update({confirmed:on,updated_at:new Date().toISOString()}).eq('place_id',id);
  if(error)return toast(error.message,'err'); toast(on?'Confirmed - read from tonight (or press Pull now in Our Brand → Setup)':'Paused','ok'); renderPage();
};
window.dmPlRemove=async function(id){
  if(!await confirmDialog('Stop tracking this place and delete its stored readings?'))return;
  const {error}=await dmCamp().from('dm_places').delete().eq('place_id',id);
  if(error)return toast(error.message,'err'); renderPage();
};
window.dmPlAddModal=async function(){
  const wl=await dmWatchlist();
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-location-dot" style="color:#16a34a"></i> Add a Google Maps place</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm">'+dmBrandSelect(wl)
    +'<label>Search Google Maps (project or office name and area)<input id="dmPlQ" placeholder="Siddha Galaxia Rajarhat" onkeydown="if(event.key===\'Enter\')dmPlFind()"></label>'
    +'<button class="btn" onclick="dmPlFind()"><i class="fa-solid fa-magnifying-glass"></i> Find</button>'
    +'<div id="dmPlRes" style="margin-top:12px"></div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>');
};
window.dmPlFind=async function(){
  const box=$('dmPlRes'); box.innerHTML='<div class="loader"><div class="spin"></div></div>';
  try{
    const jr=await dmCall({action:'find_place',q:$('dmPlQ').value});
    box.innerHTML=(jr.results||[]).length?jr.results.map(function(x){
      return '<div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line-2)"><div style="flex:1;min-width:0"><b>'+esc(x.name||'')+'</b>'
        +'<div style="font-size:11.5px;color:var(--slate)">'+esc(x.address||'')+(x.rating!=null?' · '+Number(x.rating).toFixed(1)+' ★ ('+dmN(x.user_ratings_total)+')':'')+'</div></div>'
        +(x.maps_uri?'<a class="btn btn-sm" href="'+esc(x.maps_uri)+'" target="_blank" rel="noopener">Open</a>':'')
        +'<button class="btn btn-sm btn-primary" onclick="dmPlAdd('+dmArg(x.place_id)+','+dmArg(x.name||'')+','+dmArg(x.address||'')+','+dmArg(x.maps_uri||'')+')">Add</button></div>';}).join('')
      :dmNote('fa-circle-info','Nothing found.');
  }catch(e){ box.innerHTML=dmNote('fa-triangle-exclamation',esc(e.message)); }
};
window.dmPlAdd=async function(id,label,address,uri){
  const b=$('dmBrand').value;
  const row={place_id:id,label:label||null,address:address||null,maps_uri:uri||null,is_own:b==='own'||(window._dmWl||[]).some(function(w){return String(w.id)===b&&w.category==='brand';}),
    watchlist_id:b==='own'?null:Number(b),confirmed:false,active:true,updated_at:new Date().toISOString()};
  const {error}=await dmCamp().from('dm_places').upsert(row,{onConflict:'place_id'});
  if(error)return toast(error.message,'err');
  toast('Added - check it on Maps, then press Confirm','ok'); closeModal(); renderPage();
};

/* ---------------------------------------------------------------- Search Console */
async function dmSearch(body,r){
  const sites=(await dmSources('gsc_site')).filter(function(s){return s.enabled;});
  if(!sites.length){ body.innerHTML=dmCard('Search Console','Our websites in Google Search: clicks, impressions, click rate and position.',dmNeedConnect('Search Console'))
    +dmNote('fa-lock','Competitors\' Search Console data is private to them - Google offers no way to read it.'); return; }
  if(!sites.some(function(s){return s.source_id===DM_SITE;}))DM_SITE=sites[0].source_id;
  const site=DM_SITE;
  const [{data:days},q,p,c,d]=await Promise.all([
    dmCamp().from('dm_gsc_rows').select('day,clicks,impressions,ctr,position').eq('site_url',site).eq('dim','date').gte('day',r.from).lte('day',r.to).order('day'),
    dmCamp().rpc('dm_gsc_top',{p_site:site,p_dim:'query',p_from:r.from,p_to:r.to,p_limit:50}),
    dmCamp().rpc('dm_gsc_top',{p_site:site,p_dim:'page',p_from:r.from,p_to:r.to,p_limit:30}),
    dmCamp().rpc('dm_gsc_top',{p_site:site,p_dim:'country',p_from:r.from,p_to:r.to,p_limit:15}),
    dmCamp().rpc('dm_gsc_top',{p_site:site,p_dim:'device',p_from:r.from,p_to:r.to,p_limit:5})]);
  const dd=days||[];
  const clicks=dd.length?dd.reduce(function(a,x){return a+Number(x.clicks||0);},0):null, imps=dd.length?dd.reduce(function(a,x){return a+Number(x.impressions||0);},0):null;
  const pos=imps?dd.reduce(function(a,x){return a+Number(x.position||0)*Number(x.impressions||0);},0)/imps:null;
  const t=function(res,first){ return dmTable([first,'Clicks','Impressions','Click rate','Avg position'],((res&&res.data)||[]).map(function(x){
    return [first==='Page'?'<a href="'+esc(x.key)+'" target="_blank" rel="noopener" style="word-break:break-all">'+esc(x.key.replace(/^https?:\/\/[^/]+/,'')||'/')+'</a>':esc(x.key),dmN(x.clicks),dmN(x.impressions),dmPct(x.ctr),dmN(x.avg_position,1)];})); };
  body.innerHTML=dmCard('Google Search · '+esc(site),'Clicks and impressions for our site in Google Search. Click rate and position are recomputed from the daily figures (position weighted by impressions). Google keeps rare searches private, so the query table adds up to less than the total.',
    '<div class="grid kpis" style="margin-bottom:14px">'
      +dmKpi('Clicks',dmN(clicks),dd.length+' days reported','fa-solid fa-arrow-pointer','#2563eb')
      +dmKpi('Impressions',dmN(imps),'times we appeared in results','fa-solid fa-eye','#16a34a')
      +dmKpi('Click rate',imps?dmPct(clicks/imps,2):'—','clicks ÷ impressions','fa-solid fa-percent','#ea580c')
      +dmKpi('Average position',pos==null?'—':pos.toFixed(1),'1 = top result','fa-solid fa-ranking-star','#9333ea')
    +'</div><div style="height:240px;margin-bottom:16px"><canvas id="dmGscCh"></canvas></div>'
    +'<div style="font-weight:700;font-size:13px;margin-bottom:6px">Top searches</div>'+t(q,'Search')
    +'<div style="font-weight:700;font-size:13px;margin:16px 0 6px">Top pages</div>'+t(p,'Page')
    +'<div class="grid grid-2" style="margin-top:16px"><div><div style="font-weight:700;font-size:13px;margin-bottom:6px">Country</div>'+t(c,'Country')+'</div>'
    +'<div><div style="font-weight:700;font-size:13px;margin-bottom:6px">Device</div>'+t(d,'Device')+'</div></div>',
    sites.length>1?dmSelect('site',sites,site):'')
    +dmNote('fa-lock','Competitors\' Search Console data is private to them - Google offers no way to read it.');
  setTimeout(function(){ dmChart('dmGscCh',dd.map(function(x){return fmtDateShort(x.day);}),[{label:'Clicks',data:dd.map(function(x){return x.clicks;})},{label:'Impressions',data:dd.map(function(x){return x.impressions;}),axis:'y2'}]); },0);
}

/* ---------------------------------------------------------------- Analytics (GA4) */
async function dmAnalytics(body,r){
  const props=(await dmSources('ga4_property')).filter(function(s){return s.enabled;});
  if(!props.length){ body.innerHTML=dmCard('Google Analytics','Our websites\' visitors: users, sessions, where they came from, which pages they landed on, enquiries.',dmNeedConnect('Google Analytics'))
    +dmNote('fa-circle-check','Checked 16 Oct 2026: thejaingroup.com has GA4 installed (via Google Tag Manager GTM-TSVVQQR, measurement ID G-95JRH2F94T), and so do dreamworldcity.co.in, dreamecocity.com, dreamone.co.in and dreamvalley.net.in.')
    +dmNote('fa-lock','Competitors\' Analytics data is private to them - Google offers no way to read it.'); return; }
  if(!props.some(function(s){return s.source_id===DM_PROP;}))DM_PROP=props[0].source_id;
  const prop=DM_PROP;
  const [{data:per},{data:days},src,land,city,dev,ev]=await Promise.all([
    dmCamp().from('dm_ga4_rows').select('day,metrics').eq('property_id',prop).eq('report','period').eq('key',DM_DAYS+'d').lte('day',r.to).order('day',{ascending:false}).limit(1),
    dmCamp().from('dm_ga4_rows').select('day,metrics').eq('property_id',prop).eq('report','overview').gte('day',r.from).lte('day',r.to).order('day'),
    dmCamp().rpc('dm_ga4_top',{p_prop:prop,p_report:'source',p_from:r.from,p_to:r.to,p_order:'sessions',p_limit:25}),
    dmCamp().rpc('dm_ga4_top',{p_prop:prop,p_report:'landing',p_from:r.from,p_to:r.to,p_order:'sessions',p_limit:25}),
    dmCamp().rpc('dm_ga4_top',{p_prop:prop,p_report:'city',p_from:r.from,p_to:r.to,p_order:'sessions',p_limit:15}),
    dmCamp().rpc('dm_ga4_top',{p_prop:prop,p_report:'device',p_from:r.from,p_to:r.to,p_order:'sessions',p_limit:5}),
    dmCamp().rpc('dm_ga4_top',{p_prop:prop,p_report:'event',p_from:r.from,p_to:r.to,p_order:'eventCount',p_limit:25})]);
  const P=per&&per[0]; const m=P?P.metrics:{};
  const pd=P?'Google\'s own total for '+esc(fmtDateShort(dmAdd(P.day,-(DM_DAYS-1))))+' – '+esc(fmtDateShort(P.day)):'not read yet';
  const dd=days||[];
  const t=function(res,cols){ return dmTable(cols.map(function(c){return c[0];}),((res&&res.data)||[]).map(function(x){
    return cols.map(function(c,i){ return i===0?esc(c[1](x)):dmN(x.metrics[c[1]]); });}),'Nothing for this period yet.'); };
  const label=props.filter(function(s){return s.source_id===prop;})[0];
  body.innerHTML=dmCard('Website visitors · '+esc((label&&label.label)||prop),'GA4. The figures at the top are Google\'s totals for the whole period: users are never added up day by day, because somebody who visits on two days is still one person.',
    '<div class="grid kpis" style="margin-bottom:14px">'
      +dmKpi('Users',dmN(m.totalUsers),dmN(m.newUsers)+' new · '+pd,'fa-solid fa-users','#2563eb')
      +dmKpi('Sessions',dmN(m.sessions),dmN(m.engagedSessions)+' engaged ('+dmPct(m.engagementRate)+')','fa-solid fa-window-maximize','#16a34a')
      +dmKpi('Pages viewed',dmN(m.screenPageViews),'avg session '+dmDur(m.averageSessionDuration),'fa-solid fa-file-lines','#ea580c')
      +dmKpi('Key events',dmN(m.keyEvents),'enquiries / form submits marked as key events in GA4','fa-solid fa-flag-checkered','#9333ea')
    +'</div><div style="height:240px;margin-bottom:16px"><canvas id="dmGaCh"></canvas></div>'
    +'<div style="font-weight:700;font-size:13px;margin-bottom:6px">Where sessions came from</div>'
    +dmTable(['Source','Medium','Campaign','Sessions','Engaged','Key events'],((src&&src.data)||[]).map(function(x){
      return [esc(x.dims.sessionSource||''),esc(x.dims.sessionMedium||''),esc(x.dims.sessionCampaignName||''),dmN(x.metrics.sessions),dmN(x.metrics.engagedSessions),dmN(x.metrics.keyEvents)];}),'Nothing for this period yet.')
    +'<div style="font-weight:700;font-size:13px;margin:16px 0 6px">Landing pages</div>'
    +t(land,[['Page',function(x){return x.dims.landingPage||'';}],['Sessions','sessions'],['Engaged','engagedSessions'],['Key events','keyEvents']])
    +'<div class="grid grid-2" style="margin-top:16px"><div><div style="font-weight:700;font-size:13px;margin-bottom:6px">City</div>'
    +t(city,[['City',function(x){return x.dims.city||'';}],['Sessions','sessions'],['Key events','keyEvents']])+'</div>'
    +'<div><div style="font-weight:700;font-size:13px;margin-bottom:6px">Device</div>'
    +t(dev,[['Device',function(x){return x.dims.deviceCategory||'';}],['Sessions','sessions'],['Engaged','engagedSessions'],['Key events','keyEvents']])+'</div></div>'
    +'<div style="font-weight:700;font-size:13px;margin:16px 0 6px">Events (form_submit, generate_lead and the rest)</div>'
    +t(ev,[['Event',function(x){return x.dims.eventName||'';}],['Times','eventCount'],['Counted as key event','keyEvents']]),
    props.length>1?dmSelect('prop',props,prop):'')
    +dmNote('fa-lock','Competitors\' Analytics data is private to them - Google offers no way to read it.');
  setTimeout(function(){ dmChart('dmGaCh',dd.map(function(x){return fmtDateShort(x.day);}),[{label:'Sessions',data:dd.map(function(x){return x.metrics.sessions;})},{label:'Users that day',data:dd.map(function(x){return x.metrics.totalUsers;})},{label:'Key events',data:dd.map(function(x){return x.metrics.keyEvents;}),axis:'y2'}]); },0);
}

/* ---------------------------------------------------------------- Setup */
const DM_PARTS=[['yt_public','YouTube - public counts (ours + competitors)','YOUTUBE_API_KEY'],['yt_own','YouTube - our channel analytics','marketing connection'],
  ['places','Google Maps - public ratings (ours + competitors)','GOOGLE_PLACES_API_KEY'],['gbp','Google Maps - our listings (Business Profile)','marketing connection + Google approval'],
  ['gsc','Search Console','marketing connection'],['ga4','Analytics (GA4)','marketing connection']];
const DM_KIND_LABEL={gsc_site:'Search Console sites',ga4_property:'GA4 properties',gbp_location:'Business Profile listings',yt_channel:'YouTube channels'};
async function dmConnect(body){
  const [{data:conn},{data:src},{data:log}]=await Promise.all([dmCamp().rpc('dm_connection_status'),
    dmCamp().from('dm_sources').select('*').order('kind').order('label'),
    dmCamp().from('dm_sync_log').select('*').order('started_at',{ascending:false}).limit(80)]);
  const last={}; (log||[]).forEach(function(x){ if(!last[x.part])last[x.part]=x; });
  const scopes=function(s){ return ['youtube.readonly','yt-analytics.readonly','webmasters.readonly','analytics.readonly','business.manage']
    .map(function(k){ const ok=String(s||'').indexOf(k)!==-1; return '<span class="tag '+(ok?'t-green':'t-amber')+'" style="margin:2px">'+(ok?'✓ ':'✗ ')+k+'</span>'; }).join(''); };
  let html=dmCard('Marketing Google connection','A company Google account (ideally a @thejaingroup.com address) that owns or can see our YouTube channel, Search Console sites, GA4 properties and Maps listings. Read-only. Separate from the Calendar / Gmail connection people use for Meetings.',
    ((conn||[]).length?dmTable(['Google account','Permissions granted','Connected by','When'],(conn||[]).map(function(c){
      return [esc(c.google_email),scopes(c.scope),esc(c.connected_by||''),esc(fmtDate(c.updated_at))];})):dmNote('fa-plug','Not connected yet.'))
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn btn-primary" onclick="dmConnectGoogle()"><i class="fa-brands fa-google"></i> '+((conn||[]).length?'Reconnect / add another account':'Connect Google for Marketing')+'</button>'
    +((conn||[]).length?'<button class="btn" id="dmDiscBtn" onclick="dmDiscover()"><i class="fa-solid fa-magnifying-glass"></i> Find our sites, properties, listings and channels</button>':'')+'</div>');
  const kinds=['yt_channel','gsc_site','ga4_property','gbp_location'];
  html+=dmCard('What is being pulled','Everything the connected account can see. Switch off anything that is not ours or not wanted.',
    kinds.map(function(k){ const rows=(src||[]).filter(function(s){return s.kind===k;});
      return '<div style="font-weight:700;font-size:13px;margin:8px 0 6px">'+DM_KIND_LABEL[k]+'</div>'+dmTable(['Name','ID','Account','Pull'],rows.map(function(s){
        return [esc(s.label||''),'<code style="font-size:11.5px">'+esc(s.source_id)+'</code>',esc(s.google_email||''),
          '<label style="display:inline-flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" '+(s.enabled?'checked':'')+' onchange="dmToggleSource('+dmArg(s.kind)+','+dmArg(s.source_id)+',this.checked)"> '+(s.enabled?'On':'Off')+'</label>'];}),'None found yet.'); }).join(''));
  html+=dmCard('Nightly pull (02:30 IST)','Last run of each part. "Pull now" runs it immediately; a first pull goes back up to a year (YouTube), 18 months (Maps), 16 months (Search Console) or 6 months (GA4).',
    dmTable(['Part','Needs','Last run','Result',''],DM_PARTS.map(function(p){ const l=last[p[0]];
      return [esc(p[1]),'<span style="font-size:12px;color:var(--slate)">'+esc(p[2])+'</span>',l?esc(fmtDate(l.started_at))+' '+esc(new Date(l.started_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})):'never',
        !l?'—':l.ok===null?'<span class="tag t-blue">running…</span>':l.ok?'<span class="tag t-green">'+dmN(l.rows)+' rows</span>'+(l.message&&l.message!=='ok'?'<div style="font-size:11.5px;color:var(--slate)">'+esc(l.message)+'</div>':''):'<span class="tag" style="background:var(--err-50,#fef2f2);color:#b91c1c">failed</span><div style="font-size:11.5px;color:var(--slate);max-width:420px">'+esc(l.message||'')+'</div>',
        '<button class="btn btn-sm" id="dmPull_'+p[0]+'" onclick="dmPullNow(\''+p[0]+'\')"><i class="fa-solid fa-rotate"></i> Pull now</button>'];})));
  html+=dmCard('What only you can do in Google','Full step-by-step guide: <code>docs/digital-metrics-setup.md</code> in the JAIN-E repository.',
    '<ol style="margin:0 0 0 18px;padding:0;font-size:13.5px;line-height:1.7">'
    +'<li>Google Cloud Console → <b>APIs &amp; Services → Library</b>: enable YouTube Data API v3, YouTube Analytics API, Google Search Console API, Google Analytics Data API, Google Analytics Admin API, Places API (New), and the Business Profile APIs.</li>'
    +'<li><b>OAuth consent screen → User type: Internal</b> (needs the Cloud project to sit inside the thejaingroup.com Google Workspace organisation). Internal apps need no Google review and their sign-ins do not expire after 7 days the way "Testing" apps do.</li>'
    +'<li><b>Credentials → Create API key</b>, restrict it to YouTube Data API v3 and Places API (New), then add it in Supabase → Edge Functions → Secrets as <code>YOUTUBE_API_KEY</code> (and the same or a second key as <code>GOOGLE_PLACES_API_KEY</code>).</li>'
    +'<li>Business Profile: submit Google\'s API access request form for the Cloud project (one time, usually a few days).</li>'
    +'<li>Come back here and press <b>Connect Google for Marketing</b> with the company account.</li></ol>');
  body.innerHTML=html;
}
window.dmConnectGoogle=async function(){
  try{
    const {data:{session}}=await sb.auth.getSession();
    const r=await fetch(SUPABASE_URL+'/functions/v1/google-oauth-start?mode=marketing&return='+encodeURIComponent(location.origin),
      {headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+((session&&session.access_token)||'')}});
    const jr=await r.json().catch(function(){return {};});
    if(!r.ok||!jr.url)throw new Error(jr.error||('server said '+r.status));
    location.href=jr.url;
  }catch(e){ toast('Could not start the Google connection: '+e.message,'err'); }
};
window.dmDiscover=async function(){
  const b=$('dmDiscBtn'); if(b){b.disabled=true;b.innerHTML='<i class="fa-solid fa-rotate fa-spin"></i> Looking…';}
  try{ const jr=await dmCall({action:'discover'});
    toast('Found '+jr.yt_channel+' channel(s), '+jr.gsc_site+' site(s), '+jr.ga4_property+' GA4 propert'+(jr.ga4_property===1?'y':'ies')+', '+jr.gbp_location+' listing(s)'+(jr.errors&&jr.errors.length?' - '+jr.errors.length+' could not be read (see the run log)':''),jr.errors&&jr.errors.length?'warn':'ok');
    if(jr.errors&&jr.errors.length)jr.errors.forEach(function(e){console.warn('[digital metrics]',e);});
  }catch(e){ toast('Discover failed: '+e.message,'err'); }
  renderPage();
};
window.dmToggleSource=async function(kind,id,on){
  const {error}=await dmCamp().from('dm_sources').update({enabled:on}).eq('kind',kind).eq('source_id',id);
  if(error){ toast(error.message,'err'); } renderPage();
};
window.dmPullNow=async function(part){
  const b=$('dmPull_'+part); if(b){b.disabled=true;b.innerHTML='<i class="fa-solid fa-rotate fa-spin"></i> Pulling…';}
  try{ const jr=await dmCall({action:'sync',part:part}); const x=jr[part]||{};
    if(x.ok)toast('Pulled '+dmN(x.rows)+' rows','ok'); else toast(x.error||'failed','err');
  }catch(e){ toast('Pull failed: '+e.message,'err'); }
  renderPage();
};
