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
  v.innerHTML=MW_CSS
    +'<div class="mw-head"><div><h1><i class="fa-solid fa-binoculars" style="color:var(--brand)"></i> Market Watch</h1>'
      +'<p>New projects our competitors have opened to customers in the last '+MW_DAYS+' days - only when a source shows customers being invited in (EOI, bookings, site visits, sales office or launch event). RERA registration and ads are not used. Every project shows its proof.</p></div></div>'
    +'<div id="mwBody"><div class="loader"><div class="spin"></div></div></div>';
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
