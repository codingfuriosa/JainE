/* ============================ MARKET WATCH ============================
   New module (17 Nov 2026, Ayush). COMPETITOR LAUNCHES: which of the 18 listed competitors opened a new project to
   customers in the last 60 days. "Launched" = customers have started coming (Ayush): EOI / pre-launch registration,
   bookings open, site visits offered, a sales office / experience centre / sample flat open, or a launch event with
   buyer offers. Never judged by RERA registration or the first ad.

   The market-watch edge function checks every developer each morning (their own website + news) and records a launch
   only with its proof: the link and the exact sentence. Confirmed = the developer's own website says it, or two
   different news sources do; otherwise Needs check until someone confirms or rejects it here (camp.mw_decide).
   Tables: camp.mw_launches, mw_evidence, mw_developers, mw_runs. A day with nothing new adds nothing. */
let MW_FILTER='all', MW_DATA=null, MW_OPEN={};
const MW_DAYS=60;
const MW_STAGE={eoi:'EOI / pre-launch',site_visits:'Site visits',sales_office:'Sales office / sample flat',launch_event:'Launch event',bookings:'Bookings open'};
const MW_KIND={website:'Developer website',archive:'Developer website (first saved by web.archive.org)',news:'News'};
const MW_CSS='<style>'
  +'.mw-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:14px}'
  +'.mw-head h1{margin:0;font-size:24px;font-weight:700;display:flex;align-items:center;gap:10px}'
  +'.mw-head p{margin:5px 0 0;color:var(--slate);font-size:13.5px;max-width:780px;line-height:1.5}'
  +'.mw-status{font-size:12.5px;color:var(--slate);display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}'
  +'.mw-status b{color:var(--ink)}.mw-status .warn{color:#b45309}'
  +'.mw-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}'
  +'.mw-chip{border:1px solid var(--line);background:var(--card,#fff);border-radius:999px;padding:6px 13px;font:inherit;font-size:12.5px;font-weight:600;color:var(--ink-2,#334155);cursor:pointer}'
  +'.mw-chip.on{background:var(--brand);border-color:var(--brand);color:#fff}'
  +'.mw-tw{border:1px solid var(--line);border-radius:12px;overflow:auto;background:var(--card,#fff)}'
  +'.mw-t{width:100%;border-collapse:collapse;font-size:13px}'
  +'.mw-t th{background:#f8fafc;text-align:left;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--slate);padding:10px 12px;border-bottom:1px solid var(--line);white-space:nowrap}'
  +'.mw-t td{padding:10px 12px;border-bottom:1px solid var(--line-2,#eef1f6);vertical-align:top}'
  +'.mw-row{cursor:pointer}.mw-row:hover td{background:#f8fafc}'
  +'.mw-pn{font-weight:650;color:var(--ink)}.mw-sub{font-size:11.5px;color:var(--slate);margin-top:2px}'
  +'.mw-badge{display:inline-block;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;white-space:nowrap}'
  +'.mw-badge.confirmed{background:#dcfce7;color:#166534}.mw-badge.needs_check{background:#fef3c7;color:#92400e}.mw-badge.rejected{background:#f1f5f9;color:#64748b}'
  +'.mw-ev{background:#f8fafc}.mw-ev td{padding:4px 12px 14px 12px}'
  +'.mw-src{border:1px solid var(--line);border-radius:10px;background:#fff;padding:10px 12px;margin-top:8px}'
  +'.mw-src .k{font-size:11px;font-weight:700;color:var(--slate);text-transform:uppercase;letter-spacing:.04em}'
  +'.mw-src q{display:block;margin:6px 0;font-size:13px;color:var(--ink);quotes:"\\201C" "\\201D"}'
  +'.mw-src a{font-size:12px;word-break:break-all}'
  +'.mw-acts{display:flex;gap:6px;flex-wrap:wrap}'
  +'.mw-devs{margin-top:18px}.mw-devs summary{cursor:pointer;font-weight:600;font-size:13px;color:var(--slate)}'
  +'.mw-devs table td,.mw-devs table th{font-size:12px}'
  +'</style>';

async function mwLoad(){
  const c=sb.schema('camp');
  const since=new Date(Date.now()-MW_DAYS*86400e3).toISOString().slice(0,10);
  const [l,d,r]=await Promise.all([
    c.from('mw_launches').select('id,project,locality,stage,launch_date,status,auto_status,decided_by,decided_at,developer_id,mw_evidence(kind,url,source,title,published,quote,stage)').gte('launch_date',since).order('launch_date',{ascending:false}),
    c.from('mw_developers').select('id,name,website,active,baseline_at,last_checked_at,last_error').order('sort'),
    c.from('mw_runs').select('run_at,found').order('run_at',{ascending:false}).limit(60)
  ]);
  const err=l.error||d.error||r.error; if(err) throw err;
  return {launches:l.data||[],devs:d.data||[],runs:r.data||[]};
}
function mwAgo(day){ const n=Math.round((Date.parse(new Date().toISOString().slice(0,10))-Date.parse(day))/86400e3); return n<=0?'today':n===1?'yesterday':n+' days ago'; }

VIEWS.market_watch=async function(v,seg){
  setCrumb(['Growth & Strategy','Market Watch']);
  const tab=(seg&&seg[0]==='trends')?'trends':'launches';
  const tb=(id,icon,label)=>'<button class="mw-tab'+(tab===id?' on':'')+'" onclick="navTo(\'market_watch/'+id+'\')"><i class="fa-solid '+icon+'"></i> '+label+'</button>';
  v.innerHTML=MW_CSS+MWT_CSS
    +'<div class="mw-head"><div><h1><i class="fa-solid fa-binoculars" style="color:var(--brand)"></i> Market Watch</h1>'
      +(tab==='trends'
        ?'<p>What caught people\'s attention this week, for thumb-stop ideas in our videos and posts - India and Worldwide. Collected from Google Trends, the YouTube trending chart, the Apple Music chart and Wikipedia\'s most-read pages; every number and link is the source\'s own. Sad news, politics and controversies are left out.</p>'
        :'<p>New projects our competitors have opened to customers in the last '+MW_DAYS+' days - only when a source shows customers being invited in (EOI, bookings, site visits, sales office or launch event). RERA registration and ads are not used. Every project shows its proof.</p>')
      +'</div></div>'
    +'<div class="mw-tabs">'+tb('launches','fa-building-flag','Competitor Launches')+tb('trends','fa-fire','Trends')+'</div>'
    +'<div id="mwBody"><div class="loader"><div class="spin"></div></div></div>';
  if(tab==='trends') return mwtOpen();
  try{ MW_DATA=await mwLoad(); mwRender(); }
  catch(e){
    const b=$('mwBody'); if(!b) return;
    const missing=e&&(e.code==='42P01'||e.code==='PGRST205'||/does not exist|schema cache/i.test(e.message||''));
    b.innerHTML='<div class="card card-pad empty"><i class="fa-solid fa-'+(missing?'hourglass-half':'triangle-exclamation')+'"></i><div>'
      +(missing?'Market Watch is being set up. The first check of the 18 developers runs tonight, and the list appears here after it.':'Could not load: '+esc((e&&e.message)||String(e)))+'</div></div>';
  }
};

function mwRender(){
  const b=$('mwBody'); if(!b||!MW_DATA) return;
  const {launches,devs,runs}=MW_DATA;
  const active=devs.filter(d=>d.active);
  const today=new Date(Date.now()+5.5*3600e3).toISOString().slice(0,10);
  const checkedToday=active.filter(d=>d.last_checked_at&&new Date(Date.parse(d.last_checked_at)+5.5*3600e3).toISOString().slice(0,10)===today);
  const last=active.map(d=>d.last_checked_at).filter(Boolean).sort().pop();
  const failed=active.filter(d=>d.last_error);
  const cnt={all:0,confirmed:0,needs_check:0,rejected:0};
  launches.forEach(x=>{ cnt[x.status]=(cnt[x.status]||0)+1; if(x.status!=='rejected') cnt.all++; });
  const rows=launches.filter(x=>MW_FILTER==='all'?x.status!=='rejected':x.status===MW_FILTER);
  const chip=(id,label)=>'<button class="mw-chip'+(MW_FILTER===id?' on':'')+'" onclick="MW_FILTER=\''+id+'\';mwRender()">'+label+' ('+(cnt[id]||0)+')</button>';
  let h='<div class="mw-status"><i class="fa-regular fa-clock"></i>'
    +(last?'Last checked <b>'+esc(new Date(last).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}))+'</b> · '+checkedToday.length+' of '+active.length+' developers checked today':'Not checked yet - the first check runs tonight')
    +(failed.length?' · <span class="warn" title="'+esc(failed.map(d=>d.name+': '+d.last_error).join('\n'))+'"><i class="fa-solid fa-triangle-exclamation"></i> '+failed.length+' developer(s) partly unreadable - see the list at the bottom</span>':'')
    +'</div>';
  h+='<div class="mw-bar">'+chip('all','All')+chip('confirmed','Confirmed')+chip('needs_check','Needs check')+chip('rejected','Rejected')+'</div>';
  if(!rows.length){
    h+='<div class="card card-pad empty"><i class="fa-solid fa-binoculars"></i><div>'
      +(MW_FILTER==='all'?'No competitor has opened a new project to customers in the last '+MW_DAYS+' days'+(last?' (as far as their websites and the news show).':'.'):'Nothing here.')+'</div></div>';
  } else {
    const devName={}; devs.forEach(d=>devName[d.id]=d.name);
    h+='<div class="mw-tw"><table class="mw-t"><thead><tr><th>Launched</th><th>Project</th><th>Developer</th><th>Stage</th><th>Status</th><th>Proof</th><th></th></tr></thead><tbody>';
    rows.forEach(x=>{
      const ev=(x.mw_evidence||[]).slice().sort((a,b)=>String(a.published).localeCompare(String(b.published)));
      const st=x.status==='confirmed'?'Confirmed':x.status==='rejected'?'Rejected':'Needs check';
      const acts=x.decided_by
        ?'<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();mwDecide('+x.id+',\'auto\')" title="'+esc(st+' by '+x.decided_by)+'">Undo</button>'
        :(x.status!=='confirmed'?'<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();mwDecide('+x.id+',\'confirmed\')">Confirm</button>':'')
          +'<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();mwDecide('+x.id+',\'rejected\')">Reject</button>';
      h+='<tr class="mw-row" onclick="MW_OPEN['+x.id+']=!MW_OPEN['+x.id+'];mwRender()">'
        +'<td style="white-space:nowrap"><b>'+esc(fmtDate(x.launch_date))+'</b><div class="mw-sub">'+mwAgo(x.launch_date)+'</div></td>'
        +'<td><div class="mw-pn">'+esc(x.project)+'</div>'+(x.locality?'<div class="mw-sub">'+esc(x.locality)+'</div>':'')+'</td>'
        +'<td>'+esc(devName[x.developer_id]||'')+'</td>'
        +'<td>'+esc(MW_STAGE[x.stage]||'—')+'</td>'
        +'<td><span class="mw-badge '+x.status+'">'+st+'</span>'+(x.decided_by?'<div class="mw-sub">by '+esc(String(x.decided_by).split('@')[0])+'</div>':'')+'</td>'
        +'<td style="white-space:nowrap"><i class="fa-solid fa-chevron-'+(MW_OPEN[x.id]?'up':'down')+'" style="color:#94a3b8;margin-right:5px"></i>'+ev.length+' source'+(ev.length===1?'':'s')+'</td>'
        +'<td><div class="mw-acts">'+acts+'</div></td></tr>';
      if(MW_OPEN[x.id]) h+='<tr class="mw-ev"><td colspan="7">'+ev.map(e=>'<div class="mw-src"><div class="k">'+esc(MW_KIND[e.kind]||e.kind)+' · '+esc(e.source||'')+' · '+esc(fmtDate(e.published))+(e.stage&&MW_STAGE[e.stage]?' · '+esc(MW_STAGE[e.stage]):'')+'</div>'
        +(e.title?'<div style="font-weight:600;margin-top:4px">'+esc(e.title)+'</div>':'')
        +'<q>'+esc(e.quote)+'</q><a href="'+esc(e.url)+'" target="_blank" rel="noopener">'+esc(e.url)+'</a></div>').join('')+'</td></tr>';
    });
    h+='</tbody></table></div>';
  }
  // the developers watched, and whether each could be read
  h+='<details class="mw-devs"><summary>The '+active.length+' developers watched</summary><div class="mw-tw" style="margin-top:8px"><table class="mw-t"><thead><tr><th>Developer</th><th>Website</th><th>Last checked</th><th>Problem</th></tr></thead><tbody>'
    +active.map(d=>'<tr><td>'+esc(d.name)+'</td><td>'+(d.website?'<a href="'+esc(d.website)+'" target="_blank" rel="noopener">'+esc(d.website.replace(/^https?:\/\/(www\.)?/,'').replace(/\/$/,''))+'</a>':'—')+'</td>'
      +'<td>'+(d.last_checked_at?esc(new Date(d.last_checked_at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})):'—')+'</td>'
      +'<td class="mw-sub">'+esc(d.last_error||'')+'</td></tr>').join('')
    +'</tbody></table></div></details>';
  b.innerHTML=h;
}

async function mwDecide(id,status){
  try{
    const {error}=await sb.schema('camp').rpc('mw_decide',{p_id:id,p_status:status});
    if(error) throw error;
    MW_DATA=await mwLoad(); mwRender();
    toast(status==='confirmed'?'Confirmed':status==='rejected'?'Rejected':'Back to automatic','ok');
  }catch(e){ toast('Could not save: '+((e&&e.message)||e),'err'); }
}

/* ---------------------------------------------------------------- TRENDS TAB (17 Nov 2026, Ayush)
   Weekly trends for thumb-stop ideas, India and Worldwide apart, the video / photo on the card when there is one.
   Snapshots 4 times a day + Wikipedia, grouped every Monday morning (market-watch: trends_collect / trends_compile,
   camp.mw_trends). Gemini only groups and describes what the sources returned; numbers and links are the sources'. */
let MWT_REGION='IN', MWT_TYPE='all', MWT_WEEK=null, MWT_ROWS=null, MWT_WEEKS=null;
const MWT_TYPES={sports:['Sports','fa-futbol'],movie_show:['Movie / Show','fa-film'],song:['Song','fa-music'],viral_moment:['Viral moment','fa-bolt'],news_moment:['News moment','fa-newspaper'],local:['Kolkata / local','fa-location-dot'],celebrity:['Celebrity','fa-star'],brand_campaign:['Brand campaign','fa-bullhorn'],search_spike:['Search spike','fa-magnifying-glass-chart']};
const MWT_CSS='<style>'
  +'.mw-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:16px}'
  +'.mw-tab{border:0;background:none;padding:10px 16px;font:inherit;font-weight:600;font-size:14px;color:var(--slate);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;display:flex;align-items:center;gap:8px}'
  +'.mw-tab.on{color:var(--brand);border-bottom-color:var(--brand)}'
  +'.mwt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}'
  +'.mwt-card{background:var(--card,#fff);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}'
  +'.mwt-media{position:relative;display:block;aspect-ratio:16/9;background:#0f172a center/cover no-repeat}'
  +'.mwt-media.play{cursor:pointer}'
  +'.mwt-media.play i{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:54px;height:54px;border-radius:50%;background:rgba(0,0,0,.65);color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;padding-left:4px;box-sizing:border-box}'
  +'.mwt-nomedia{height:6px;background:linear-gradient(90deg,var(--brand),#f59e0b)}'
  +'.mwt-b{padding:12px 14px 14px;display:flex;flex-direction:column;gap:7px;flex:1}'
  +'.mwt-type{font-size:11px;font-weight:700;color:var(--brand);text-transform:uppercase;letter-spacing:.04em;display:flex;align-items:center;gap:6px}'
  +'.mwt-type span{color:var(--slate);font-weight:600;text-transform:none;letter-spacing:0;margin-left:auto}'
  +'.mwt-t{font-weight:700;font-size:15px;line-height:1.3;color:var(--ink)}'
  +'.mwt-w{font-size:13px;color:var(--ink-2,#334155);line-height:1.45}'
  +'.mwt-m{display:flex;flex-wrap:wrap;gap:5px}.mwt-m span{font-size:11.5px;background:#f1f5f9;color:#334155;border-radius:999px;padding:3px 9px}'
  +'.mwt-s{margin-top:auto;padding-top:6px;border-top:1px solid var(--line-2,#eef1f6);display:flex;flex-direction:column;gap:3px}'
  +'.mwt-s a{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  +'.mwt-sel{height:32px;border:1px solid var(--line);border-radius:9px;padding:0 8px;font:inherit;font-size:12.5px;background:#fff;margin-left:auto}'
  +'</style>';

async function mwtOpen(){
  const b=$('mwBody'); if(!b) return;
  try{
    const c=sb.schema('camp');
    if(!MWT_WEEKS){
      const w=await c.from('mw_trends').select('period_from,period_to').order('period_from',{ascending:false}).limit(400);
      if(w.error) throw w.error;
      const seen={}; MWT_WEEKS=(w.data||[]).filter(r=>!seen[r.period_from]&&(seen[r.period_from]=1));
      if(!MWT_WEEK&&MWT_WEEKS.length) MWT_WEEK=MWT_WEEKS[0].period_from;
    }
    if(!MWT_WEEK){ b.innerHTML='<div class="card card-pad empty"><i class="fa-solid fa-fire"></i><div>The first week of trends is being put together. Snapshots are collected 4 times a day, and the cards appear here after the first weekly run.</div></div>'; return; }
    const r=await c.from('mw_trends').select('*').eq('period_from',MWT_WEEK).order('score',{ascending:false});
    if(r.error) throw r.error;
    MWT_ROWS=r.data||[]; mwtRender();
  }catch(e){
    const missing=e&&(e.code==='42P01'||e.code==='PGRST205'||/does not exist|schema cache/i.test(e.message||''));
    b.innerHTML='<div class="card card-pad empty"><i class="fa-solid fa-'+(missing?'hourglass-half':'triangle-exclamation')+'"></i><div>'
      +(missing?'Trends is being set up tonight. The first cards appear here after it.':'Could not load: '+esc((e&&e.message)||String(e)))+'</div></div>';
  }
}
function mwtRender(){
  const b=$('mwBody'); if(!b||!MWT_ROWS) return;
  const rows=MWT_ROWS.filter(x=>x.region===MWT_REGION);
  const cnt={all:rows.length}; rows.forEach(x=>cnt[x.type]=(cnt[x.type]||0)+1);
  const shown=rows.filter(x=>MWT_TYPE==='all'||x.type===MWT_TYPE);
  const wk=(MWT_WEEKS||[]).find(w=>w.period_from===MWT_WEEK);
  const reg=(id,label)=>'<button class="mw-chip'+(MWT_REGION===id?' on':'')+'" onclick="MWT_REGION=\''+id+'\';MWT_TYPE=\'all\';mwtRender()">'+label+' ('+MWT_ROWS.filter(x=>x.region===id).length+')</button>';
  let h='<div class="mw-bar">'+reg('IN','India')+reg('WORLD','<i class="fa-solid fa-earth-americas"></i> Worldwide')
    +'<select class="mwt-sel" onchange="MWT_WEEK=this.value;MWT_TYPE=\'all\';mwtOpen()">'+(MWT_WEEKS||[]).map(w=>'<option value="'+w.period_from+'"'+(w.period_from===MWT_WEEK?' selected':'')+'>'+esc(fmtDateShort(w.period_from)+' - '+fmtDate(w.period_to))+'</option>').join('')+'</select></div>';
  h+='<div class="mw-bar"><button class="mw-chip'+(MWT_TYPE==='all'?' on':'')+'" onclick="MWT_TYPE=\'all\';mwtRender()">All ('+cnt.all+')</button>'
    +Object.keys(MWT_TYPES).filter(k=>cnt[k]).map(k=>'<button class="mw-chip'+(MWT_TYPE===k?' on':'')+'" onclick="MWT_TYPE=\''+k+'\';mwtRender()"><i class="fa-solid '+MWT_TYPES[k][1]+'"></i> '+MWT_TYPES[k][0]+' ('+cnt[k]+')</button>').join('')+'</div>';
  if(!shown.length){ b.innerHTML=h+'<div class="card card-pad empty"><i class="fa-solid fa-fire"></i><div>No trends here for '+(wk?esc(fmtDateShort(wk.period_from)+' - '+fmtDate(wk.period_to)):'this week')+'.</div></div>'; return; }
  h+='<div class="mwt-grid">'+shown.map(x=>{
    const ty=MWT_TYPES[x.type]||['Trend','fa-fire'];
    const media=x.video_id
      ?'<div class="mwt-media play" style="background-image:url(\''+esc(x.media_url||('https://i.ytimg.com/vi/'+x.video_id+'/hqdefault.jpg'))+'\')" onclick="mwtPlay(\''+escJs(x.video_id)+'\',\''+escJs(x.title)+'\')" title="Play"><i class="fa-solid fa-play"></i></div>'
      :x.media_url?'<a class="mwt-media" href="'+esc((x.sources&&x.sources[0]&&x.sources[0].url)||x.media_url)+'" target="_blank" rel="noopener" style="background-image:url(\''+esc(x.media_url)+'\')"></a>'
      :'<div class="mwt-nomedia"></div>';
    return '<div class="mwt-card">'+media+'<div class="mwt-b">'
      +'<div class="mwt-type"><i class="fa-solid '+ty[1]+'"></i> '+ty[0]+'<span>'+esc(fmtDateShort(x.happened_on))+'</span></div>'
      +'<div class="mwt-t">'+esc(x.title)+'</div><div class="mwt-w">'+esc(x.what)+'</div>'
      +'<div class="mwt-m">'+(x.metrics||[]).map(m=>'<span>'+esc(m)+'</span>').join('')+'</div>'
      +'<div class="mwt-s">'+(x.sources||[]).slice(0,4).map(s=>'<a href="'+esc(s.url)+'" target="_blank" rel="noopener" title="'+esc(s.title||'')+'"><i class="fa-solid fa-arrow-up-right-from-square" style="font-size:10px;margin-right:4px"></i>'+esc(s.label||'Source')+(s.title?' - '+esc(s.title):'')+'</a>').join('')+'</div>'
      +'</div></div>';
  }).join('')+'</div>';
  b.innerHTML=h;
}
function mwtPlay(id,title){
  openModal('<div class="modal-head"><h3><i class="fa-brands fa-youtube" style="color:#ff0000"></i> '+esc(title)+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="padding:0;background:#000"><div style="position:relative;padding-bottom:56.25%;height:0"><iframe src="https://www.youtube-nocookie.com/embed/'+encodeURIComponent(id)+'?autoplay=1&rel=0" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div></div>','lg');
}
