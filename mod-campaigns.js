function cmpStatusBar(counts){
  const b=function(k,label){return '<button class="cmp-fbtn'+(CMP_STATUS===k?' on':'')+'" onclick="cmpSetStatus(\''+k+'\')">'+esc(label)+(counts&&counts[k]!=null?(' <span class="cmp-fcount">'+counts[k]+'</span>'):'')+'</button>';};
  return '<div class="cmp-fbar">'+b('all','All')+b('active','Active')+b('inactive','Inactive')+'</div>';
}
function cmpIsActive(st){const s=String(st||'').toUpperCase();return s==='ACTIVE'||s==='ENABLED';}
const CMP_PRESETS=[['today','Today'],['yesterday','Yesterday'],['last_7d','Last 7 days'],['last_14d','Last 14 days'],['last_month','Last month'],['last_year','Last year'],['custom','Custom']];

/* ============ Trend / Fatigue / Best-&-Worst (shared by the Meta, Google and Both tabs) ============
   "Trend" = this period compared with the SAME-LENGTH period immediately before it. We ask the live
   sync functions for that earlier window too (as a custom range), then compare the two. */
function cmpPrevKey(){const p=cmpPrevRange();return p?('custom:'+p.since+':'+p.until):null;}
async function cmpSyncPrev(which){}
/* "Run via MCP" button (Campaign Analytics, Meta tab). A browser cannot call the Meta Ads MCP
   tool itself - only a live Claude Code session can - so this just drops a pending row into
   camp.mcp_refresh_requests (an RLS policy lets any authenticated user do that) and lets the
   local watcher script on the always-on PC (meta-mcp-watcher.ps1) pick it up, run the full
   refresh, and write the result back. Re-rendering the page right after just shows the button
   as queued/running - see refreshReq in VIEWS.campaigns - it does not itself wait for the run. */
window.cmpRunMcpRefresh=async function(){
  try{
    const {error}=await sb.schema('camp').from('mcp_refresh_requests').insert({requested_by:me()});
    if(error){ toast('Could not queue the refresh: '+error.message,'err'); return; }
    toast('Queued — the local watcher will pick this up within about 20 seconds','ok');
    renderPage();
  }catch(e){ toast('Could not queue the refresh: '+((e&&e.message)||e),'err'); }
};
// Trend pill. lowerIsBetter=true for cost metrics (a fall is good).
function cmpTrendPage(rows,totals,inr,num,resLabel){
  const chg=function(cur,prev){ if(prev==null||!isFinite(Number(prev))||Number(prev)===0)return null; return (Number(cur||0)-Number(prev))/Math.abs(Number(prev))*100; };
  const mrow=function(label,cur,prev,fmt,lowerIsBetter){
    const c=chg(cur,prev);
    return '<tr><td class="cmp-mlbl">'+esc(label)+'</td>'
      +'<td class="num muted">'+fmt(prev)+'</td>'
      +'<td class="num strong">'+fmt(cur)+'</td>'
      +'<td class="num">'+cmpTrend(cur,prev,lowerIsBetter)+'</td>'
      +'<td class="cmp-bar">'+(c==null?'':('<span class="cmp-barfill '+(((lowerIsBetter?-c:c)>=0)?'up':'down')+'" style="width:'+Math.min(100,Math.abs(c))+'%"></span>'))+'</td></tr>';
  };
  const summary='<div class="cmp-panel"><div class="cmp-phead"><div><span class="cmp-over">Period comparison</span><h3>This period vs the one before</h3></div><span class="cmp-chip">'+esc(cmpPrevLabel())+'</span></div>'
    +'<div class="cmp-tblwrap"><table class="cmp-tbl"><thead><tr><th>Metric</th><th class="num">Previous</th><th class="num">Current</th><th class="num">Change</th><th style="width:120px"></th></tr></thead><tbody>'
    +mrow('Spend',totals.spend,totals.pspend,inr,false)
    +mrow(resLabel.charAt(0).toUpperCase()+resLabel.slice(1),totals.res,totals.pres,function(v){return num(Math.round(Number(v)||0));},false)
    +mrow('Cost per '+resLabel.replace(/s$/,''),totals.cpr,totals.pcpr,function(v){return v==null?'—':inr(v);},true)
    +mrow('Clicks',totals.clk,totals.pclk,function(v){return num(Math.round(Number(v)||0));},false)
    +mrow('CTR',totals.ctr,totals.pctr,function(v){return (Number(v)||0).toFixed(2)+'%';},false)
    +'</tbody></table></div></div>';
  const sorted=rows.slice().sort(function(a,b){return (b.spend||0)-(a.spend||0);});
  const body=sorted.length?sorted.map(function(r){
    const c=chg(r.spend,r.pspend);
    return '<tr><td><div class="cmp-nm">'+esc(r.name)+'</div>'+(r.sub?'<div class="cmp-sub">'+esc(r.sub)+'</div>':'')+'</td>'
      +'<td class="num muted">'+inr(r.pspend||0)+'</td>'
      +'<td class="num strong">'+inr(r.spend||0)+'</td>'
      +'<td class="num">'+cmpTrend(r.spend,r.pspend,false)+'</td>'
      +'<td class="num muted">'+num(Math.round(r.pres||0))+'</td>'
      +'<td class="num strong">'+num(Math.round(r.res||0))+'</td>'
      +'<td class="num">'+cmpTrend(r.res,r.pres,false)+'</td>'
      +'<td class="num">'+(r.cpr!=null?inr(r.cpr):'—')+'</td>'
      +'<td class="num">'+cmpTrend(r.cpr,r.pcpr,true)+'</td></tr>';
  }).join(''):'<tr><td colspan="9" class="cmp-none">No data for this period</td></tr>';
  const detail='<div class="cmp-panel"><div class="cmp-phead"><div><span class="cmp-over">Breakdown</span><h3>Movement by '+esc(resLabel==='conversions'?'account':'project')+'</h3></div></div>'
    +'<div class="cmp-tblwrap"><table class="cmp-tbl"><thead><tr><th>Name</th><th class="num" colspan="3">Spend — prev / now / change</th><th class="num" colspan="3">'+esc(resLabel)+' — prev / now / change</th><th class="num" colspan="2">Cost / '+esc(resLabel.replace(/s$/,''))+'</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
  return summary+detail;
}
/* ---------------- AD FATIGUE page ----------------
   rows = [{name, sub, freq, ctr, pctr, spend, impr}] */
function cmpFatiguePage(rows,inr,num,note,hideFreq){
  const grade=function(r){
    const f=Number(r.freq)||0, c=(r.ctr==null?null:Number(r.ctr)), pc=(r.pctr==null?null:Number(r.pctr));
    const drop=(pc&&pc>0&&c!=null)?(1-(c/pc)):null;
    let s=0;
    if(f>=4)s+=2;else if(f>=3)s+=1.5;else if(f>=2.5)s+=1;
    if(drop!==null&&drop>=0.30)s+=2;else if(drop!==null&&drop>=0.15)s+=1;
    return {score:s,drop:drop,level:(s>=3?'hi':(s>=1.5?'md':'ok'))};
  };
  const scored=rows.map(function(r){return Object.assign({},r,{g:grade(r)});})
    .sort(function(a,b){ if(b.g.score!==a.g.score)return b.g.score-a.g.score; return (b.spend||0)-(a.spend||0); });
  const nHi=scored.filter(function(x){return x.g.level==='hi';}).length;
  const nMd=scored.filter(function(x){return x.g.level==='md';}).length;
  const nOk=scored.length-nHi-nMd;
  const stat=function(v,l,cls){return '<div class="cmp-stat '+cls+'"><div class="v">'+v+'</div><div class="l">'+esc(l)+'</div></div>';};
  const advice=function(x){
    if(x.g.level==='hi')return 'Refresh the creative — swap images/headlines';
    if(x.g.level==='md')return 'Watch it; plan a new variant';
    return 'Healthy';
  };
  // Google Ads publishes no per-person frequency, so on that source we drop the column entirely
  // rather than showing a row of dashes.
  const cols=hideFreq?7:8;
  const body=scored.length?scored.map(function(x){
    return '<tr><td><div class="cmp-nm">'+esc(x.name)+'</div>'+(x.sub?'<div class="cmp-sub">'+esc(x.sub)+'</div>':'')+'</td>'
      +(hideFreq?'':'<td class="num">'+(x.freq?(Number(x.freq).toFixed(1)+'×'):'—')+'</td>')
      +'<td class="num muted">'+(x.pctr!=null?(Number(x.pctr).toFixed(2)+'%'):'—')+'</td>'
      +'<td class="num strong">'+(x.ctr!=null?(Number(x.ctr).toFixed(2)+'%'):'—')+'</td>'
      +'<td class="num">'+(x.g.drop===null?'—':('<span class="'+(x.g.drop>0?'cmp-dn':'cmp-up')+'">'+(x.g.drop>0?'−':'+')+Math.abs(Math.round(x.g.drop*100))+'%</span>'))+'</td>'
      +'<td class="num">'+inr(x.spend||0)+'</td>'
      +'<td>'+cmpFatigue(x.freq,x.ctr,x.pctr)+'</td>'
      +'<td class="cmp-adv">'+esc(advice(x))+'</td></tr>';
  }).join(''):'<tr><td colspan="'+cols+'" class="cmp-none">Not enough data to judge fatigue yet</td></tr>';
  return '<div class="cmp-stats">'+stat(nHi,'Need refresh','hi')+stat(nMd,'Watching','md')+stat(nOk,'Healthy','ok')+'</div>'
    +'<div class="cmp-panel"><div class="cmp-phead"><div><span class="cmp-over">Ad fatigue</span><h3>Worst first</h3></div><span class="cmp-chip">'+esc(note||'')+'</span></div>'
    +'<div class="cmp-tblwrap"><table class="cmp-tbl"><thead><tr><th>Name</th>'+(hideFreq?'':'<th class="num">Seen / person</th>')+'<th class="num">CTR before</th><th class="num">CTR now</th><th class="num">Change</th><th class="num">Spend</th><th>Verdict</th><th>What to do</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
}
/* Refined, restrained visual language — neutral surfaces, one accent, no candy colours.
   Loaded AFTER each view's older inline styles so these rules win. */
const CMP_EXTRA_CSS='<style>'
  /* neutralise the old colourful KPI treatment */
  +'.cmp-kpi{border-radius:12px!important;box-shadow:none!important;border:1px solid var(--line)!important;padding:14px 15px!important;background:#fff!important}'
  +'.cmp-kpi::before{display:none!important}'
  +'.cmp-kpi .ki{background:transparent!important;color:#94a3b8!important;width:auto!important;height:auto!important;font-size:12.5px!important}'
  +'.cmp-kpi .kl{font-size:10.5px!important;letter-spacing:.07em!important;color:#8a94a6!important;font-weight:600!important}'
  +'.cmp-kpi .kv{font-size:23px!important;font-weight:650!important;letter-spacing:-.6px!important;margin-top:9px!important;color:var(--ink)!important;font-variant-numeric:tabular-nums}'
  +'.cmp-kpi .ks{font-size:11px!important;color:#98a2b3!important;margin-top:3px!important}'
  +'.cmp-kpi:hover{border-color:#d6dced!important}'
  +'.cmp-kpis{gap:12px!important;margin-bottom:16px!important}'
  +'.cmp-kpi .ktr{margin-top:8px}'
  /* trend + fatigue: quiet text, not loud pills */
  +'.cmp-tr{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:600;white-space:nowrap;vertical-align:middle;cursor:default;font-variant-numeric:tabular-nums}'
  +'.cmp-tr i{font-size:9.5px}'
  +'.cmp-tr.good{color:#15803d}.cmp-tr.bad{color:#c0392f}.cmp-tr.flat{color:#98a2b3}.cmp-tr.none{color:#cbd5e1}'
  +'.cmp-fg{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;white-space:nowrap;cursor:default}'
  +'.cmp-fg i{font-size:9px}'
  +'.cmp-fg.hi{color:#c0392f}.cmp-fg.md{color:#a16207}.cmp-fg.ok{color:#5b6674}.cmp-fg.na{color:#cbd5e1}'
  +'.cmp-up{color:#15803d;font-weight:600}.cmp-dn{color:#c0392f;font-weight:600}'
  /* panels */
  +'.cmp-panel{background:#fff;border:1px solid var(--line);border-radius:12px;margin:0 0 16px;overflow:hidden}'
  +'.cmp-phead{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;padding:15px 18px 13px;border-bottom:1px solid var(--line-2)}'
  +'.cmp-over{display:block;font-size:10px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:#a3adbe;margin-bottom:3px}'
  +'.cmp-phead h3{margin:0;font-size:15px;font-weight:650;letter-spacing:-.2px;color:var(--ink)}'
  +'.cmp-chip{font-size:11px;color:#7d8798;background:#f6f8fc;border:1px solid var(--line-2);border-radius:6px;padding:3px 9px;white-space:nowrap}'
  /* tables */
  +'.cmp-tblwrap{overflow-x:auto}'
  +'.cmp-tbl{width:100%;border-collapse:collapse;font-size:13px}'
  +'.cmp-tbl th{text-align:left;font-size:10px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#a3adbe;padding:10px 14px;border-bottom:1px solid var(--line);white-space:nowrap;background:#fcfdff}'
  +'.cmp-tbl th.num{text-align:right}'
  +'.cmp-tbl td{padding:11px 14px;border-bottom:1px solid var(--line-2);vertical-align:middle}'
  +'.cmp-tbl tbody tr:last-child td{border-bottom:0}'
  +'.cmp-tbl tbody tr:hover{background:#fbfcfe}'
  +'.cmp-tbl td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}'
  +'.cmp-tbl td.muted{color:#98a2b3}.cmp-tbl td.strong{font-weight:650;color:var(--ink)}'
  +'.cmp-mlbl{font-weight:600;color:#5b6674}'
  +'.cmp-nm{font-weight:600;color:var(--ink);max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  +'.cmp-sub{font-size:11px;color:#98a2b3;margin-top:2px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  +'.cmp-adv{font-size:12px;color:#7d8798}'
  +'.cmp-none{text-align:center;color:#a3adbe;padding:28px 14px;font-size:12.5px}'
  +'.cmp-bar{padding-right:18px!important}'
  +'.cmp-barfill{display:block;height:5px;border-radius:3px;background:#dbe2ee;min-width:2px}'
  +'.cmp-barfill.up{background:#9fc9ae}.cmp-barfill.down{background:#e0b4ae}'
  /* stat strip on the fatigue page */
  +'.cmp-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:0 0 16px}'
  +'.cmp-stat{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px;position:relative}'
  +'.cmp-stat .v{font-size:25px;font-weight:650;letter-spacing:-.7px;color:var(--ink);font-variant-numeric:tabular-nums}'
  +'.cmp-stat .l{font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#8a94a6;margin-top:4px}'
  +'.cmp-stat.hi .v{color:#c0392f}.cmp-stat.md .v{color:#a16207}'
  +'@media(max-width:640px){.cmp-stats{grid-template-columns:1fr}}'
  /* filter row */
  +'.cmp-fbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px}'
  +'.cmp-projbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px}'
  +'.cmp-projsel{height:38px;min-width:210px;border:1px solid var(--line);border-radius:9px;padding:0 32px 0 12px;font-size:13px;font-family:inherit;font-weight:600;color:var(--ink);background-color:var(--bg-card);cursor:pointer;appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 12 8\'%3E%3Cpath d=\'M1 1l5 5 5-5\' stroke=\'%2364748b\' stroke-width=\'1.8\' fill=\'none\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 11px center;background-size:11px 8px}'
  +'.cmp-projsel:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10,#eef2ff)}'
  +'.cmp-reload{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 15px;border:1px solid var(--line);border-radius:9px;background:var(--bg-card);font-size:13px;font-weight:600;color:var(--ink);cursor:pointer;margin-top:10px}'
  +'.cmp-reload:hover{border-color:var(--brand);color:var(--brand)}'
  +'.cmp-fbtn{font-size:12.5px;font-weight:600;color:#5b6674;background:#fff;border:1px solid var(--line);border-radius:8px;padding:6px 13px;cursor:pointer;transition:.12s;font-family:inherit}'
  +'.cmp-fbtn:hover{border-color:#c3ccdd;color:var(--ink)}'
  +'.cmp-fbtn.on{background:#111318;border-color:#111318;color:#fff}'
  +'.cmp-fcount{font-size:12px;color:#98a2b3;margin-left:2px}'
  +'.cmp-legend{display:flex;align-items:center;gap:16px;flex-wrap:wrap;font-size:11.5px;color:#98a2b3;margin:-4px 0 16px}'
  +'.cmp-cap{font-size:11.5px!important;color:#98a2b3!important}'
  +'.cmp-chcard{border-radius:12px!important;box-shadow:none!important;border:1px solid var(--line)!important}'
  +'.cmp-chcard h4{font-size:14px!important;font-weight:650!important;letter-spacing:-.2px}'
  +'.cmp-chcard .sub{font-size:11px!important;color:#98a2b3!important}'
  +'</style>';
// Background watchdog: raise email + bell alerts for spend spikes and other critical problems.
// Safe to call often — the server only alerts once per issue per day.
function cmpRunAlerts(){
  if(window._cmpAlertsRan)return; window._cmpAlertsRan=true;
  try{ fetch(SUPABASE_URL+'/functions/v1/campaign-alerts',{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:'{}'}).catch(function(){}); }catch(e){}
}
function cmpSourceBar(){return '<div style="margin-bottom:12px"><div class="seg"><button class="seg-btn'+(CMP_SOURCE==='meta'?' on':'')+'" onclick="cmpSetSource(\'meta\')"><i class="fa-brands fa-facebook"></i> &nbsp;Meta</button><button class="seg-btn'+(CMP_SOURCE==='google'?' on':'')+'" onclick="cmpSetSource(\'google\')"><i class="fa-brands fa-google"></i> &nbsp;Google Ads</button><button class="seg-btn'+(CMP_SOURCE==='both'?' on':'')+'" onclick="cmpSetSource(\'both\')"><i class="fa-solid fa-layer-group"></i> &nbsp;Both</button></div></div>';}
window.cmpLoadGoogleAds=async function(){
  const btn=document.querySelector('.cmp-reload');
  if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-rotate fa-spin"></i> Loading — this can take a minute…';}
  try{
    const {data:{session}}=await sb.auth.getSession();
    const token=session&&session.access_token;
    const base=CMP_PERIOD==='custom'?{period:'custom',since:CMP_SINCE,until:CMP_UNTIL,level:'ad'}:{period:CMP_PERIOD,level:'ad'};
    const res=await fetch(SUPABASE_URL+'/functions/v1/google-ads-live',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},
      body:JSON.stringify(base)});
    const jr=await res.json().catch(function(){return {};});
    if(!res.ok||jr.error) throw new Error(jr.error||('Google returned '+res.status));
    toast('Loaded '+(jr.ad_insight_rows!=null?jr.ad_insight_rows:0)+' ad rows','ok');
  }catch(e){ toast('Could not load ad data: '+((e&&e.message)||e),'err'); }
  renderPage();
};
window.cmpSetAdPage=function(p){CMP_AD_PAGE=p;renderPage();};
function cmpPeriodBar(){
  const segBtns=CMP_PRESETS.map(function(p){return '<button class="seg-btn'+(CMP_PERIOD===p[0]?' on':'')+'" onclick="cmpSetPeriod(\''+p[0]+'\')">'+p[1]+'</button>';}).join('');
  let custom='';
  if(CMP_PERIOD==='custom'){
    custom='<div style="display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-top:10px;padding:14px;background:#f8fafc;border:1px solid var(--line-2);border-radius:10px">'+
      '<div><div style="font-size:11px;color:var(--slate);text-transform:uppercase;letter-spacing:.4px;font-weight:700;margin-bottom:6px">From</div><input type="date" id="cmpSince" value="'+esc(CMP_SINCE)+'" style="padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;font-family:inherit"></div>'+
      '<div><div style="font-size:11px;color:var(--slate);text-transform:uppercase;letter-spacing:.4px;font-weight:700;margin-bottom:6px">To</div><input type="date" id="cmpUntil" value="'+esc(CMP_UNTIL)+'" style="padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;font-family:inherit"></div>'+
      '<button class="btn btn-primary" style="padding:9px 20px" onclick="cmpSetCustom()">Apply</button>'+
      (CMP_SINCE&&CMP_UNTIL?'<div style="color:var(--slate);font-size:12.5px;padding-bottom:10px">Showing '+esc(CMP_SINCE)+' → '+esc(CMP_UNTIL)+'</div>':'')+
    '</div>';
  }
  return '<div class="seg">'+segBtns+'</div>'+custom+'<div style="height:14px"></div>';
}
window.cmpShowProjectAds=function(accId){
  if(!CMP_LAST||!CMP_LAST.ads)return;
  const acc=CMP_LAST.accounts.find(a=>a.ad_account_id===accId);
  if(!acc)return;
  const inr=CMP_LAST.inr,num=CMP_LAST.num;
  const belongsToProj=function(c,a){ return c.name&&a.name&&String(c.name).trim().toLowerCase().startsWith(String(a.name).trim().toLowerCase()); };
  const rows=CMP_LAST.ads.filter(a=>a.ad_account_id===accId).map(a=>{
    const i=CMP_LAST.aInsMap[a.id]||{};
    const camp=CMP_LAST.campMap[a.campaign_id];
    return {a,i,camp,spend:Number(i.spend)||0};
  }).filter(r=>r.camp&&belongsToProj(r.camp,acc)).sort((x,y)=>y.spend-x.spend);
  const totalSpend=rows.reduce((s,r)=>s+r.spend,0);
  const statusTag=function(st){const s=(st||'').toUpperCase();if(s==='ACTIVE')return '<span class="tag t-green">Active</span>';if(s==='PAUSED')return '<span class="tag t-amber">Paused</span>';return s?'<span class="tag" style="background:#f1f5f9;color:#475569">'+esc(s)+'</span>':'—';};
  const tbl=rows.length?('<div class="card qc-table-card" style="padding:0;margin-top:14px"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+
    ['Ad','Campaign','Status','Spend','Trend','Clicks','CTR','Fatigue'].map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+
    '</tr></thead><tbody>'+
    rows.map(function(r){
      const p=(CMP_LAST.aPrevMap||{})[r.a.id]||null;
      return '<tr>'+
      '<td style="font-weight:600">'+esc(r.a.name||'—')+'</td>'+
      '<td>'+esc(r.camp?r.camp.name:'—')+'</td>'+
      '<td>'+statusTag(r.a.effective_status||r.a.status)+'</td>'+
      '<td style="text-align:right;font-weight:600">'+inr(r.spend)+'</td>'+
      '<td style="text-align:right">'+cmpTrend(r.spend,p?(Number(p.spend)||0):null,false)+'</td>'+
      '<td style="text-align:right">'+num(r.i.clicks)+'</td>'+
      '<td style="text-align:right">'+(r.i.ctr!=null?Number(r.i.ctr).toFixed(2)+'%':'—')+'</td>'+
      '<td style="text-align:right">'+cmpFatigue(Number(r.i.frequency)||0,r.i.ctr,p?(Number(p.ctr)||0):null)+'</td>'+
    '</tr>';}).join('')+
    '</tbody></table></div></div>'):'<div class="card card-pad empty" style="margin-top:14px"><i class="fa-solid fa-rectangle-ad"></i><div>No ad data for this period</div></div>';
  openModal(
    '<div class="modal-head"><div><div style="font-weight:700;font-size:16.5px">'+esc(acc.name)+'</div><div style="color:var(--slate);font-size:12.5px;margin-top:2px">'+esc(CMP_LAST.periodLabel)+' · '+rows.length+' ad'+(rows.length===1?'':'s')+'</div></div><div class="x" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></div></div>'+
    '<div class="modal-body">'+mKpis([['Spend',inr(totalSpend),'']])+tbl+'</div>',
    'lg'
  );
};
async function cmpBothView(v,seg){
  const tabs=['Overview','Sources','Trend','Ad Fatigue'];const ti=mTab(seg,tabs.length);
  v.innerHTML=cmpSourceBar()+cmpPeriodBar()+'<div class="loader"><div class="spin"></div></div>';
  const periodKey=CMP_PERIOD==='custom'?('custom:'+CMP_SINCE+':'+CMP_UNTIL):CMP_PERIOD;
  const periodLabel=CMP_PERIOD==='custom'?(CMP_SINCE&&CMP_UNTIL?CMP_SINCE+' → '+CMP_UNTIL:'Custom range'):((CMP_PRESETS.find(function(p){return p[0]===CMP_PERIOD;})||[])[1]||CMP_PERIOD);
  // Meta's half of this refresh is gone - its data now comes solely from the manually-triggered
  // Meta Ads MCP task (see cmpSyncPrev). Google's own live pipeline is untouched.
  if(CMP_PERIOD!=='custom'||(CMP_SINCE&&CMP_UNTIL)){
    try{
      const {data:{session}}=await sb.auth.getSession();const token=session&&session.access_token;
      const hdr={'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY};
      const gbody=CMP_PERIOD==='custom'?{period:'custom',since:CMP_SINCE,until:CMP_UNTIL}:{period:CMP_PERIOD};
      const pr0=cmpPrevRange(); if(pr0){gbody.prev_since=pr0.since;gbody.prev_until=pr0.until;}
      await fetch(SUPABASE_URL+'/functions/v1/google-ads-live',{method:'POST',headers:hdr,body:JSON.stringify(gbody)}).catch(function(){});
    }catch(e){}
  }
  await cmpSyncPrev('both');
  const C=function(){return sb.schema('camp');};
  const prevKey=cmpPrevKey();
  let mIns=[],gIns=[],mPrev=[],gPrev=[],mAccts=[],mCamps=[],gAccts=[],gCamps=[];
  try{
    const calls=[
      C().from('campaign_insights').select('campaign_id,spend,impressions,clicks,leads,frequency').eq('period',periodKey),
      C().from('g_campaign_insights').select('campaign_id,spend,impressions,clicks,conversions,ctr').eq('period',periodKey),
      C().from('ad_accounts').select('ad_account_id,name'),
      C().from('campaigns').select('id,ad_account_id,name,daily_budget,lifetime_budget,status'),
      C().from('g_accounts').select('customer_id,name'),
      C().from('g_campaigns').select('id,customer_id,name,status,budget_amount')
    ];
    if(prevKey){
      calls.push(C().from('campaign_insights').select('campaign_id,spend,impressions,clicks,leads,frequency').eq('period',prevKey));
      calls.push(C().from('g_campaign_insights').select('campaign_id,spend,impressions,clicks,conversions,ctr').eq('period',prevKey));
    }
    const r=await Promise.all(calls);
    mIns=r[0].data||[];gIns=r[1].data||[];mAccts=r[2].data||[];mCamps=r[3].data||[];gAccts=r[4].data||[];gCamps=r[5].data||[];
    if(prevKey){mPrev=(r[6]&&r[6].data)||[];gPrev=(r[7]&&r[7].data)||[];}
  }catch(e){}
  const sum=function(arr,k){return arr.reduce(function(s,x){return s+(Number(x[k])||0);},0);};
  const M={spend:sum(mIns,'spend'),res:sum(mIns,'leads'),impr:sum(mIns,'impressions'),clk:sum(mIns,'clicks')};
  const Gg={spend:sum(gIns,'spend'),res:sum(gIns,'conversions'),impr:sum(gIns,'impressions'),clk:sum(gIns,'clicks')};
  const T={spend:M.spend+Gg.spend,res:M.res+Gg.res,impr:M.impr+Gg.impr,clk:M.clk+Gg.clk};
  const Mp={spend:sum(mPrev,'spend'),res:sum(mPrev,'leads'),impr:sum(mPrev,'impressions'),clk:sum(mPrev,'clicks')};
  const Gp={spend:sum(gPrev,'spend'),res:sum(gPrev,'conversions'),impr:sum(gPrev,'impressions'),clk:sum(gPrev,'clicks')};
  const Tp={spend:Mp.spend+Gp.spend,res:Mp.res+Gp.res,impr:Mp.impr+Gp.impr,clk:Mp.clk+Gp.clk};
  const avgFreq=function(arr){const f=arr.map(function(x){return Number(x.frequency)||0;}).filter(function(x){return x>0;});return f.length?(f.reduce(function(a,b){return a+b;},0)/f.length):0;};
  const mFreq=avgFreq(mIns);
  // total live daily budget across both platforms — ACTIVE campaigns only, since a paused
  // campaign isn't spending its budget and shouldn't inflate the figure
  const mBudget=mCamps.filter(function(c){return cmpIsActive(c.status);}).reduce(function(s,c){return s+(Number(c.daily_budget)||0);},0);
  const gBudget=gCamps.filter(function(c){return String(c.status||'').toUpperCase()==='ENABLED';}).reduce(function(s,c){return s+(Number(c.budget_amount)||0);},0);
  const tBudget=mBudget+gBudget;
  // combined best / worst across Meta projects and Google accounts
  const mInsMap={};mIns.forEach(function(x){mInsMap[x.campaign_id]=x;});
  const gInsMap={};gIns.forEach(function(x){gInsMap[x.campaign_id]=x;});
  const bwItems=[];
  mAccts.forEach(function(a){
    let sp=0,rs=0;
    mCamps.filter(function(c){return c.ad_account_id===a.ad_account_id&&c.name&&a.name&&String(c.name).trim().toLowerCase().indexOf(String(a.name).trim().toLowerCase())===0;}).forEach(function(c){const i=mInsMap[c.id];if(i){sp+=Number(i.spend)||0;rs+=Number(i.leads)||0;}});
    if(sp>0)bwItems.push({name:'Meta · '+a.name,spend:sp,res:rs,cpr:rs?sp/rs:null});
  });
  gAccts.forEach(function(a){
    let sp=0,rs=0;
    gCamps.filter(function(c){return c.customer_id===a.customer_id;}).forEach(function(c){const i=gInsMap[c.id];if(i){sp+=Number(i.spend)||0;rs+=Number(i.conversions)||0;}});
    if(sp>0)bwItems.push({name:'Google · '+a.name,spend:sp,res:rs,cpr:rs?sp/rs:null});
  });
  const inr=function(n){return '₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});};
  const num=function(n){return Number(n||0).toLocaleString('en-IN');};
  const cmpCss='<style>'
    +'.cmp-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:0 0 18px}'
    +'@media(max-width:1100px){.cmp-kpis{grid-template-columns:repeat(3,1fr)}}'
    +'@media(max-width:640px){.cmp-kpis{grid-template-columns:repeat(2,1fr);gap:10px}.cmp-kpi{padding:12px 13px}.cmp-kpi .kv{font-size:20px}.cmp-kpi .ki{width:30px;height:30px;font-size:13px}}'
    +'.cmp-kpi{position:relative;background:#fff;border:1px solid var(--line);border-radius:14px;padding:15px 16px;box-shadow:var(--shadow);overflow:hidden}'
    +'.cmp-kpi::before{content:\"\";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--kc,#334155)}'
    +'.cmp-kpi .kh{display:flex;align-items:center;justify-content:space-between;gap:8px}'
    +'.cmp-kpi .ki{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;background:var(--kbg,#f1f5f9);color:var(--kc,#334155)}'
    +'.cmp-kpi .kl{font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--slate)}'
    +'.cmp-kpi .kv{font-size:24px;font-weight:800;letter-spacing:-.5px;color:var(--ink,#0f172a);margin-top:12px;line-height:1}'
    +'.cmp-kpi .ks{font-size:11.5px;color:var(--slate);margin-top:5px;min-height:14px}'
    +'.cmp-charts{display:grid;grid-template-columns:1fr 1fr;gap:16px}'
    +'@media(max-width:900px){.cmp-charts{grid-template-columns:1fr}}'
    +'.cmp-chcard{background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);padding:16px}'
    +'.cmp-chcard h4{margin:0;font-size:13.5px;font-weight:700;color:var(--ink,#0f172a)}'
    +'.cmp-chcard .sub{font-size:11.5px;color:var(--slate);margin:3px 0 12px}'
    +'</style>';
  const cmpKpi=function(iconCls,label,value,sub,color,bg,trend){return '<div class="cmp-kpi" style="--kc:'+color+';--kbg:'+bg+'"><div class="kh"><span class="kl">'+esc(label)+'</span><span class="ki"><i class="'+iconCls+'"></i></span></div><div class="kv">'+esc(value)+'</div><div class="ks">'+esc(sub||'')+'</div>'+(trend?'<div class="ktr">'+trend+'</div>':'')+'</div>';};
  const cpr=T.res?T.spend/T.res:null, pcpr=Tp.res?Tp.spend/Tp.res:null;
  const kpiStrip='<div class="cmp-kpis">'
    +cmpKpi('fa-solid fa-indian-rupee-sign','Total Spend',inr(T.spend),'Meta + Google','#334155','#f1f5f9',cmpTrend(T.spend,Tp.spend,false))
    +cmpKpi('fa-solid fa-wallet','Daily Budget',tBudget?inr(tBudget):'—','both platforms','#6366f1','#eef2ff',tBudget?('<span class="cmp-tr flat" title="Share of the daily budget already spent"><i class="fa-solid fa-gauge-high"></i> '+Math.round(T.spend/tBudget*100)+'% used</span>'):'')
    +cmpKpi('fa-solid fa-bullseye','Total Results',num(Math.round(T.res)),'leads + conversions','#0d9488','#f0fdfa',cmpTrend(T.res,Tp.res,false))
    +cmpKpi('fa-solid fa-tags','Cost / Result',cpr!=null?inr(cpr):'—','blended','#0ea5e9','#f0f9ff',cmpTrend(cpr,pcpr,true))
    +cmpKpi('fa-solid fa-eye','Impressions',num(T.impr),'','#7c3aed','#f5f3ff',cmpTrend(T.impr,Tp.impr,false))
    +cmpKpi('fa-solid fa-hand-pointer','Clicks',num(T.clk),'','#2563eb','#eff6ff',cmpTrend(T.clk,Tp.clk,false))
    +cmpKpi('fa-brands fa-facebook','Meta Spend',inr(M.spend),T.spend?Math.round(M.spend/T.spend*100)+'% of spend':'','#1877f2','#eff6ff',cmpTrend(M.spend,Mp.spend,false))
    +cmpKpi('fa-brands fa-google','Google Spend',inr(Gg.spend),T.spend?Math.round(Gg.spend/T.spend*100)+'% of spend':'','#ea4335','#fef2f2',cmpTrend(Gg.spend,Gp.spend,false))
    +'</div>';
  const legend='<div class="cmp-legend"><span>Trend compares with '+esc(cmpPrevLabel())+'</span><span>Fatigue: Meta uses real per-person frequency, Google uses CTR decline</span></div>';
  let body;
  if(ti===0){
    body='<div class="cmp-charts">'
      +'<div class="cmp-chcard"><h4>Spend: Meta vs Google</h4><div class="sub">'+esc(periodLabel)+'</div><div style="height:260px"><canvas id="bCh1"></canvas></div></div>'
      +'<div class="cmp-chcard"><h4>Results: Meta vs Google</h4><div class="sub">leads + conversions</div><div style="height:260px"><canvas id="bCh2"></canvas></div></div>'
      +'</div>';
  } else if(ti===1){
    const mCtr=M.impr?M.clk/M.impr*100:0, mpCtr=Mp.impr?Mp.clk/Mp.impr*100:0;
    const gCtr=Gg.impr?Gg.clk/Gg.impr*100:0, gpCtr=Gp.impr?Gp.clk/Gp.impr*100:0;
    const tCtr=T.impr?T.clk/T.impr*100:0, tpCtr=Tp.impr?Tp.clk/Tp.impr*100:0;
    const rowT=function(label,d,p,ctr,pCtr,budget,fatigue,isTotal){
      const c=d.res?d.spend/d.res:null, pc=p&&p.res?p.spend/p.res:null;
      return '<tr'+(isTotal?' style="background:#fbfcfe"':'')+'><td'+(isTotal?' class="strong"':'')+'>'+label+'</td>'
      +'<td class="num">'+(budget?inr(budget):'—')+'</td>'
      +'<td class="num strong">'+inr(d.spend)+'</td>'
      +'<td class="num">'+cmpTrend(d.spend,p?p.spend:null,false)+'</td>'
      +'<td class="num">'+num(Math.round(d.res))+'</td>'
      +'<td class="num">'+cmpTrend(d.res,p?p.res:null,false)+'</td>'
      +'<td class="num">'+(c!=null?inr(c):'—')+'</td>'
      +'<td class="num">'+cmpTrend(c,pc,true)+'</td>'
      +'<td class="num">'+ctr.toFixed(2)+'%</td>'
      +'<td>'+fatigue+'</td></tr>';
    };
    body='<div class="cmp-panel"><div class="cmp-phead"><div><span class="cmp-over">Sources</span><h3>Meta vs Google</h3></div><span class="cmp-chip">'+esc(periodLabel)+'</span></div>'
      +'<div class="cmp-tblwrap"><table class="cmp-tbl"><thead><tr><th>Source</th><th class="num">Budget / day</th><th class="num">Spend</th><th class="num">Trend</th><th class="num">Results</th><th class="num">vs prev</th><th class="num">Cost / Result</th><th class="num">vs prev</th><th class="num">CTR</th><th>Fatigue</th></tr></thead><tbody>'
      +rowT('<i class="fa-brands fa-facebook" style="color:#8a94a6"></i> &nbsp;Meta',M,Mp,mCtr,mpCtr,mBudget,cmpFatigue(mFreq,mCtr,mpCtr),false)
      +rowT('<i class="fa-brands fa-google" style="color:#8a94a6"></i> &nbsp;Google',Gg,Gp,gCtr,gpCtr,gBudget,cmpFatigue(0,gCtr,gpCtr),false)
      +rowT('Total',T,Tp,tCtr,tpCtr,tBudget,cmpFatigue(mFreq,tCtr,tpCtr),true)
      +'</tbody></table></div></div>';
  } else if(ti===2){
    const tCtr=T.impr?T.clk/T.impr*100:0, tpCtr=Tp.impr?Tp.clk/Tp.impr*100:0;
    const prevByName={};
    const pmMap={};mPrev.forEach(function(x){pmMap[x.campaign_id]=x;});
    const pgMap={};gPrev.forEach(function(x){pgMap[x.campaign_id]=x;});
    mAccts.forEach(function(a){
      let sp=0,rs=0;
      mCamps.filter(function(c){return c.ad_account_id===a.ad_account_id&&c.name&&a.name&&String(c.name).trim().toLowerCase().indexOf(String(a.name).trim().toLowerCase())===0;}).forEach(function(c){const p=pmMap[c.id];if(p){sp+=Number(p.spend)||0;rs+=Number(p.leads)||0;}});
      prevByName['Meta · '+a.name]={spend:sp,res:rs};
    });
    gAccts.forEach(function(a){
      let sp=0,rs=0;
      gCamps.filter(function(c){return c.customer_id===a.customer_id;}).forEach(function(c){const p=pgMap[c.id];if(p){sp+=Number(p.spend)||0;rs+=Number(p.conversions)||0;}});
      prevByName['Google · '+a.name]={spend:sp,res:rs};
    });
    body=cmpTrendPage(bwItems.map(function(x){
      const p=prevByName[x.name]||{spend:null,res:0};
      return {name:x.name,sub:'',spend:x.spend,pspend:p.spend,res:x.res,pres:p.res,cpr:x.cpr,pcpr:p.res?(p.spend/p.res):null};
    }),{spend:T.spend,pspend:Tp.spend,res:T.res,pres:Tp.res,cpr:cpr,pcpr:pcpr,clk:T.clk,pclk:Tp.clk,ctr:tCtr,pctr:tpCtr},inr,num,'results');
  } else {
    const fr=[];
    const mAccName={};mAccts.forEach(function(a){mAccName[a.ad_account_id]=a.name;});
    const gAccName={};gAccts.forEach(function(a){gAccName[a.customer_id]=a.name;});
    const pmMap={};mPrev.forEach(function(x){pmMap[x.campaign_id]=x;});
    const pgMap={};gPrev.forEach(function(x){pgMap[x.campaign_id]=x;});
    mCamps.forEach(function(c){
      const i=mInsMap[c.id]; if(!i)return; const p=pmMap[c.id]||null;
      const imp=Number(i.impressions)||0, pimp=p?(Number(p.impressions)||0):0;
      fr.push({name:c.name||'Campaign',sub:'Meta · '+(mAccName[c.ad_account_id]||''),freq:Number(i.frequency)||0,
        ctr:imp?((Number(i.clicks)||0)/imp*100):null,
        pctr:pimp?((Number(p.clicks)||0)/pimp*100):null,
        spend:Number(i.spend)||0,impr:imp});
    });
    gCamps.forEach(function(c){
      const i=gInsMap[c.id]; if(!i)return; const p=pgMap[c.id]||null;
      fr.push({name:c.name||'Campaign',sub:'Google · '+(gAccName[c.customer_id]||''),freq:0,
        ctr:i.ctr!=null?Number(i.ctr):null,pctr:p&&p.ctr!=null?Number(p.ctr):null,
        spend:Number(i.spend)||0,impr:Number(i.impressions)||0});
    });
    body=cmpFatiguePage(fr.filter(function(x){return x.spend>0||x.impr>0;}),inr,num,'Meta + Google · campaign level');
  }
  const showKpis=(ti!==2&&ti!==3);
  v.innerHTML=cmpCss+CMP_EXTRA_CSS+mHead('fa-bullhorn','#db2777','Campaign Analytics')+cmpSourceBar()+cmpPeriodBar()+mTabs('campaigns',tabs,ti)+'<div style="margin-top:14px">'+(showKpis?kpiStrip:'')+legend+body+'</div>';
  cmpRunAlerts();
  if(ti===0&&window.Chart){setTimeout(function(){
    const opt={responsive:true,maintainAspectRatio:false,cutout:'60%',plugins:{legend:{position:'bottom',labels:{boxWidth:12,font:{size:12}}}}};
    try{new Chart(document.getElementById('bCh1'),{type:'doughnut',data:{labels:['Meta','Google'],datasets:[{data:[M.spend,Gg.spend],backgroundColor:['#1877f2','#ea4335'],borderWidth:2,borderColor:'#fff'}]},options:opt});}catch(e){}
    try{new Chart(document.getElementById('bCh2'),{type:'doughnut',data:{labels:['Meta','Google'],datasets:[{data:[M.res,Gg.res],backgroundColor:['#1877f2','#ea4335'],borderWidth:2,borderColor:'#fff'}]},options:opt});}catch(e){}
  },60);}
}
async function cmpGoogleView(v,seg){
  const tabs=['Overview','Accounts','Campaigns','Ads','Trend','Ad Fatigue'];const ti=mTab(seg,tabs.length);
  const needGAds=(ti===3||ti===5);
  v.innerHTML=cmpSourceBar()+cmpPeriodBar()+'<div class="loader"><div class="spin"></div></div>';
  const periodKey=CMP_PERIOD==='custom'?('custom:'+CMP_SINCE+':'+CMP_UNTIL):CMP_PERIOD;
  const periodLabel=CMP_PERIOD==='custom'?(CMP_SINCE&&CMP_UNTIL?CMP_SINCE+' → '+CMP_UNTIL:'Custom range'):((CMP_PRESETS.find(function(p){return p[0]===CMP_PERIOD;})||[])[1]||CMP_PERIOD);
  // Ask the Google Ads live function to refresh this period (it pulls fresh from Google, then we read the tables).
  if(CMP_PERIOD!=='custom'||(CMP_SINCE&&CMP_UNTIL)){
    try{
      const {data:{session}}=await sb.auth.getSession();const token=session&&session.access_token;
      const pr=cmpPrevRange();
      const base=CMP_PERIOD==='custom'?{period:'custom',since:CMP_SINCE,until:CMP_UNTIL}:{period:CMP_PERIOD};
      if(pr){base.prev_since=pr.since;base.prev_until=pr.until;}   // one call fills both buckets
      const hdr={'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY};
      const jobs=[fetch(SUPABASE_URL+'/functions/v1/google-ads-live',{method:'POST',headers:hdr,body:JSON.stringify(base)}).catch(function(){})];
      if(needGAds)jobs.push(fetch(SUPABASE_URL+'/functions/v1/google-ads-live',{method:'POST',headers:hdr,body:JSON.stringify(Object.assign({},base,{level:'ad'}))}).catch(function(){}));
      await Promise.all(jobs);
    }catch(e){}
  }
  const G=function(){return sb.schema('camp');};
  const prevKey=cmpPrevKey();
  let accts=[],camps=[],ins=[],pIns=[],gAds=[],gAdIns=[],gAdPrev=[];
  try{
    const calls=[G().from('g_accounts').select('*').order('name'),G().from('g_campaigns').select('*'),G().from('g_campaign_insights').select('*').eq('period',periodKey)];
    const iPrev=calls.length; if(prevKey)calls.push(G().from('g_campaign_insights').select('*').eq('period',prevKey));
    let iAds=-1,iAdIns=-1,iAdPrev=-1;
    if(needGAds){ iAds=calls.length; calls.push(G().from('g_ads').select('*')); iAdIns=calls.length; calls.push(G().from('g_ad_insights').select('*').eq('period',periodKey)); if(prevKey){ iAdPrev=calls.length; calls.push(G().from('g_ad_insights').select('*').eq('period',prevKey)); } }
    const r=await Promise.all(calls);
    const at=function(i){return (i>=0&&r[i]&&r[i].data)?r[i].data:[];};
    accts=at(0);camps=at(1);ins=at(2);
    if(prevKey)pIns=at(iPrev);
    if(needGAds){gAds=at(iAds);gAdIns=at(iAdIns);if(iAdPrev>=0)gAdPrev=at(iAdPrev);}
  }catch(e){}
  const insMap={};ins.forEach(function(x){insMap[x.campaign_id]=x;});
  const pInsMap={};pIns.forEach(function(x){pInsMap[x.campaign_id]=x;});
  const gAdInsMap={};gAdIns.forEach(function(x){gAdInsMap[x.ad_id]=x;});
  const gAdPrevMap={};gAdPrev.forEach(function(x){gAdPrevMap[x.ad_id]=x;});
  const inr=function(n){return '₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});};
  const num=function(n){return Number(n||0).toLocaleString('en-IN');};
  const isLive=function(c){return String(c.status||'').toUpperCase()==='ENABLED';};
  const rows=accts.map(function(a){
    const acs=camps.filter(function(c){return c.customer_id===a.customer_id;});
    let spend=0,impr=0,clk=0,conv=0,budget=0;
    let pspend=0,pimpr=0,pclk=0,pconv=0;
    acs.forEach(function(c){
      const i=insMap[c.id];if(i){spend+=Number(i.spend)||0;impr+=Number(i.impressions)||0;clk+=Number(i.clicks)||0;conv+=Number(i.conversions)||0;}
      const p=pInsMap[c.id];if(p){pspend+=Number(p.spend)||0;pimpr+=Number(p.impressions)||0;pclk+=Number(p.clicks)||0;pconv+=Number(p.conversions)||0;}
      if(isLive(c))budget+=Number(c.budget_amount)||0;
    });
    return {a:a,campaigns:acs.length,spend:spend,impr:impr,clk:clk,conv:conv,budget:budget,
      ctr:impr?clk/impr*100:0,cpl:conv?spend/conv:null,
      pspend:pspend,pconv:pconv,pctr:pimpr?pclk/pimpr*100:0,pcpl:pconv?pspend/pconv:null};
  }).sort(function(x,y){return y.spend-x.spend;});
  const tSpend=rows.reduce(function(s,r){return s+r.spend;},0),tImpr=rows.reduce(function(s,r){return s+r.impr;},0),tClk=rows.reduce(function(s,r){return s+r.clk;},0),tConv=rows.reduce(function(s,r){return s+r.conv;},0);
  const tBudget=rows.reduce(function(s,r){return s+r.budget;},0);
  const pSpend=rows.reduce(function(s,r){return s+r.pspend;},0),pConv=rows.reduce(function(s,r){return s+r.pconv;},0);
  const pImprT=pIns.reduce(function(s,x){return s+(Number(x.impressions)||0);},0),pClkT=pIns.reduce(function(s,x){return s+(Number(x.clicks)||0);},0);
  const pAvgCtr=pImprT?pClkT/pImprT*100:0, pCpl=pConv?pSpend/pConv:null, pAvgCpc=pClkT?pSpend/pClkT:null;
  const avgCtr=tImpr?tClk/tImpr*100:0,avgCpc=tClk?tSpend/tClk:null,cpl=tConv?tSpend/tConv:null;
  const cmpCss='<style>'
    +'.cmp-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:0 0 18px}'
    +'@media(max-width:1100px){.cmp-kpis{grid-template-columns:repeat(3,1fr)}}'
    +'@media(max-width:640px){.cmp-kpis{grid-template-columns:repeat(2,1fr);gap:10px}.cmp-kpi{padding:12px 13px}.cmp-kpi .kv{font-size:20px}.cmp-kpi .ki{width:30px;height:30px;font-size:13px}}'
    +'.cmp-kpi{position:relative;background:#fff;border:1px solid var(--line);border-radius:14px;padding:15px 16px;box-shadow:var(--shadow);overflow:hidden}'
    +'.cmp-kpi::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--kc,#4285f4)}'
    +'.cmp-kpi .kh{display:flex;align-items:center;justify-content:space-between;gap:8px}'
    +'.cmp-kpi .ki{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;background:var(--kbg,#eff6ff);color:var(--kc,#4285f4)}'
    +'.cmp-kpi .kl{font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--slate)}'
    +'.cmp-kpi .kv{font-size:24px;font-weight:800;letter-spacing:-.5px;color:var(--ink,#0f172a);margin-top:12px;line-height:1}'
    +'.cmp-kpi .ks{font-size:11.5px;color:var(--slate);margin-top:5px;min-height:14px}'
    +'.cmp-charts{display:grid;grid-template-columns:1fr 1fr;gap:16px}'
    +'@media(max-width:900px){.cmp-charts{grid-template-columns:1fr}}'
    +'.cmp-chcard{background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);padding:16px}'
    +'.cmp-chcard h4{margin:0;font-size:13.5px;font-weight:700;color:var(--ink,#0f172a)}'
    +'.cmp-chcard .sub{font-size:11.5px;color:var(--slate);margin:3px 0 12px}'
    +'.cmp-cap{font-size:12px;color:var(--slate);margin:-4px 0 14px;display:flex;align-items:center;gap:7px}'
    +'</style>';
  const cmpKpi=function(icon,label,value,sub,color,bg,trend){return '<div class="cmp-kpi" style="--kc:'+color+';--kbg:'+bg+'"><div class="kh"><span class="kl">'+esc(label)+'</span><span class="ki"><i class="fa-solid '+icon+'"></i></span></div><div class="kv">'+esc(value)+'</div><div class="ks">'+esc(sub||'')+'</div>'+(trend?'<div class="ktr">'+trend+'</div>':'')+'</div>';};
  const kpiStrip='<div class="cmp-kpis">'
    +cmpKpi('fa-indian-rupee-sign','Spend',inr(tSpend),accts.length+' account'+(accts.length===1?'':'s'),'#4285f4','#eff6ff',cmpTrend(tSpend,pSpend,false))
    +cmpKpi('fa-wallet','Daily Budget',tBudget?inr(tBudget):'—','active campaigns','#6366f1','#eef2ff',tBudget?('<span class="cmp-tr flat" title="Share of today\'s budget already spent"><i class="fa-solid fa-gauge-high"></i> '+Math.round(tSpend/tBudget*100)+'% used</span>'):'')
    +cmpKpi('fa-bullseye','Conversions',num(Math.round(tConv)),tConv?'':'none yet','#0d9488','#f0fdfa',cmpTrend(tConv,pConv,false))
    +cmpKpi('fa-tags','Cost / Conv.',cpl!=null?inr(cpl):'—','lower is better','#0ea5e9','#f0f9ff',cmpTrend(cpl,pCpl,true))
    +cmpKpi('fa-eye','Impressions',num(tImpr),'','#7c3aed','#f5f3ff',cmpTrend(tImpr,pImprT,false))
    +cmpKpi('fa-hand-pointer','Clicks',num(tClk),'','#2563eb','#eff6ff',cmpTrend(tClk,pClkT,false))
    +cmpKpi('fa-percent','Avg CTR',avgCtr.toFixed(2)+'%',avgCtr>=1?'healthy':'','#16a34a','#f0fdf4',cmpTrend(avgCtr,pAvgCtr,false))
    +cmpKpi('fa-coins','Avg CPC',avgCpc!=null?inr(avgCpc):'—','per click','#c2410c','#fff7ed',cmpTrend(avgCpc,pAvgCpc,true))
    +'</div>';
  const cap='<div class="cmp-cap"><i class="fa-brands fa-google" style="color:#ea4335"></i> Live Google Ads · '+esc(periodLabel)+' · '+accts.length+' account'+(accts.length===1?'':'s')+'</div>';
  const legend='<div class="cmp-legend"><span>Trend compares with '+esc(cmpPrevLabel())+'</span><span>Google has no per-person frequency, so fatigue = CTR falling while spend continues</span></div>';
  let body;
  if(ti===0){
    body='<div class="cmp-charts">'
      +'<div class="cmp-chcard"><h4>Spend by account</h4><div class="sub">'+esc(periodLabel)+'</div><div style="height:260px"><canvas id="gCh1"></canvas></div></div>'
      +'<div class="cmp-chcard"><h4>Conversions by account</h4><div class="sub">'+esc(periodLabel)+'</div><div style="height:260px"><canvas id="gCh2"></canvas></div></div>'
      +'<div class="cmp-chcard"><h4>Spend share</h4><div class="sub">where the budget goes</div><div style="height:260px"><canvas id="gCh3"></canvas></div></div>'
      +'<div class="cmp-chcard"><h4>Cost per conversion by account</h4><div class="sub">lower is better · in ₹</div><div style="height:260px"><canvas id="gCh4"></canvas></div></div>'
      +'</div>';
  } else if(ti===1){
    body=rows.length?('<div class="card qc-table-card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+['Account','Campaigns','Daily Budget','Spend','Trend','Conversions','Cost / Conv','Clicks','CTR','Fatigue'].map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+'</tr></thead><tbody>'+rows.map(function(r){
      const used=r.budget?Math.round(r.spend/r.budget*100):null;
      return '<tr><td style="font-weight:600">'+esc(r.a.name)+'</td><td style="text-align:right">'+r.campaigns+'</td>'
      +'<td style="text-align:right">'+(r.budget?(inr(r.budget)+'<span style="color:var(--slate);font-size:11px">/day</span>'+(used!=null?'<div style="font-size:10.5px;color:'+(used>100?'#b91c1c':'var(--slate)')+'">'+used+'% used</div>':'')):'—')+'</td>'
      +'<td style="text-align:right;font-weight:600">'+inr(r.spend)+'</td>'
      +'<td style="text-align:right">'+cmpTrend(r.spend,r.pspend,false)+'</td>'
      +'<td style="text-align:right">'+num(Math.round(r.conv))+'</td>'
      +'<td style="text-align:right">'+(r.cpl!=null?inr(r.cpl):'—')+' '+cmpTrend(r.cpl,r.pcpl,true)+'</td>'
      +'<td style="text-align:right">'+num(r.clk)+'</td><td style="text-align:right">'+r.ctr.toFixed(2)+'%</td>'
      +'<td style="text-align:right">'+cmpFatigue(0,r.ctr,r.pctr)+'</td></tr>';}).join('')+'</tbody></table></div></div>'):'<div class="card card-pad empty"><i class="fa-solid fa-chart-pie"></i><div>No Google Ads data for this period</div></div>';
  } else if(ti===2){
    const all=camps.map(function(c){const i=insMap[c.id]||null;const p=pInsMap[c.id]||null;const acc=accts.find(function(a){return a.customer_id===c.customer_id;});
      return {c:c,i:i||{},p:p,acc:acc,spend:i?(Number(i.spend)||0):0,active:cmpIsActive(c.status),hasData:!!i};}).filter(function(r){return r.acc;});
    const counts={all:all.length,active:all.filter(function(r){return r.active;}).length,inactive:all.filter(function(r){return !r.active;}).length};
    const crow=all.filter(function(r){return CMP_STATUS==='all'||(CMP_STATUS==='active'?r.active:!r.active);}).sort(function(x,y){return y.spend-x.spend;}).slice(0,300);
    const rowsHtml=crow.length?crow.map(function(r){
      const bud=Number(r.c.budget_amount)||0, sp=r.spend;
      const conv=Number(r.i.conversions)||0, cpc=conv?sp/conv:null;
      const psp=r.p?(Number(r.p.spend)||0):null;
      const pconv=r.p?(Number(r.p.conversions)||0):0, pcpc=(r.p&&pconv)?((Number(r.p.spend)||0)/pconv):null;
      const pctr=r.p?(Number(r.p.ctr)||0):null;
      const used=bud?Math.round(sp/bud*100):null;
      const chan=String(r.c.channel_type||'').replace(/_/g,' ').toLowerCase();
      return '<tr><td><div class="cmp-nm">'+esc(r.c.name)+'</div><div class="cmp-sub">'+esc(r.acc.name)+(chan?(' · '+esc(chan)):'')+'</div></td>'
      +'<td>'+(r.active?'<span class="cmp-fg ok"><i class="fa-solid fa-circle"></i> Active</span>':'<span class="cmp-fg na" style="color:#98a2b3"><i class="fa-solid fa-circle"></i> '+esc(String(r.c.status||'Inactive').replace('PAUSED','Paused').replace('REMOVED','Removed'))+'</span>')+'</td>'
      +'<td class="num">'+(bud?(inr(bud)+(used!=null?'<div class="cmp-sub" style="text-align:right'+(used>100?';color:#c0392f':'')+'">'+used+'% used</div>':'')):'—')+'</td>'
      +'<td class="num strong">'+inr(sp)+'</td>'
      +'<td class="num">'+cmpTrend(sp,psp,false)+'</td>'
      +'<td class="num">'+num(Math.round(conv))+'</td>'
      +'<td class="num">'+(cpc!=null?inr(cpc):'—')+'</td>'
      +'<td class="num">'+cmpTrend(cpc,pcpc,true)+'</td>'
      +'<td class="num">'+(Number(r.i.ctr)||0).toFixed(2)+'%</td>'
      +'<td>'+cmpFatigue(0,Number(r.i.ctr)||0,pctr)+'</td></tr>';}).join(''):'<tr><td colspan="10" class="cmp-none">No campaigns match this filter</td></tr>';
    body=cmpStatusBar(counts)+'<div class="cmp-panel"><div class="cmp-phead"><div><span class="cmp-over">Campaigns</span><h3>'+crow.length+' campaign'+(crow.length===1?'':'s')+'</h3></div><span class="cmp-chip">'+esc(periodLabel)+'</span></div>'
      +'<div class="cmp-tblwrap"><table class="cmp-tbl"><thead><tr><th>Campaign</th><th>Status</th><th class="num">Budget</th><th class="num">Spend</th><th class="num">Trend</th><th class="num">Conv</th><th class="num">Cost / Conv</th><th class="num">vs prev</th><th class="num">CTR</th><th>Fatigue</th></tr></thead><tbody>'+rowsHtml+'</tbody></table></div></div>';
  } else if(ti===3){
    // ---- Ad-wise (Google) ----
    const campNameMap={};camps.forEach(function(c){campNameMap[c.id]=c.name;});
    const all=gAds.map(function(a){
      const i=gAdInsMap[a.id]||null, p=gAdPrevMap[a.id]||null;
      const acc=accts.find(function(x){return x.customer_id===a.customer_id;});
      return {a:a,i:i||{},p:p,acc:acc,spend:i?(Number(i.spend)||0):0,active:cmpIsActive(a.status),hasData:!!i};
    }).filter(function(r){return r.hasData;});
    const counts={all:all.length,active:all.filter(function(r){return r.active;}).length,inactive:all.filter(function(r){return !r.active;}).length};
    const shown=all.filter(function(r){return CMP_STATUS==='all'||(CMP_STATUS==='active'?r.active:!r.active);}).sort(function(x,y){return y.spend-x.spend;}).slice(0,300);
    const rowsHtml=shown.length?shown.map(function(r){
      const conv=Number(r.i.conversions)||0, sp=r.spend, cpc=conv?sp/conv:null;
      const psp=r.p?(Number(r.p.spend)||0):null;
      const pconv=r.p?(Number(r.p.conversions)||0):0, pcpc=(r.p&&pconv)?((Number(r.p.spend)||0)/pconv):null;
      const pctr=r.p?(Number(r.p.ctr)||0):null;
      const sub=[(r.acc&&r.acc.name)||'',campNameMap[r.a.campaign_id]||'',r.a.ad_group_name||''].filter(Boolean).join(' · ');
      return '<tr><td><div class="cmp-nm">'+esc(r.a.name||'Ad')+'</div><div class="cmp-sub">'+esc(sub)+'</div></td>'
      +'<td>'+(r.active?'<span class="cmp-fg ok"><i class="fa-solid fa-circle"></i> Active</span>':'<span class="cmp-fg na" style="color:#98a2b3"><i class="fa-solid fa-circle"></i> '+esc(String(r.a.status||'Inactive').replace('PAUSED','Paused').replace('REMOVED','Removed'))+'</span>')+'</td>'
      +'<td class="num strong">'+inr(sp)+'</td>'
      +'<td class="num">'+cmpTrend(sp,psp,false)+'</td>'
      +'<td class="num">'+num(Math.round(conv))+'</td>'
      +'<td class="num">'+(cpc!=null?inr(cpc):'—')+'</td>'
      +'<td class="num">'+cmpTrend(cpc,pcpc,true)+'</td>'
      +'<td class="num">'+num(r.i.clicks)+'</td>'
      +'<td class="num">'+(Number(r.i.ctr)||0).toFixed(2)+'%</td>'
      +'<td>'+cmpFatigue(0,Number(r.i.ctr)||0,pctr)+'</td></tr>';}).join('')
      // Ad-level data is pulled per period on demand and the first pull for a new period is slow,
      // so an empty table usually just means "not fetched yet" — offer the retry rather than a dead end.
      :'<tr><td colspan="10" class="cmp-none">No ad data loaded for '+esc(periodLabel)+' yet.'
        +'<div><button class="cmp-reload" onclick="cmpLoadGoogleAds()"><i class="fa-solid fa-rotate"></i> Load ad data for this period</button></div></td></tr>';
    body=cmpStatusBar(counts)+'<div class="cmp-panel"><div class="cmp-phead"><div><span class="cmp-over">Ads</span><h3>'+shown.length+' ad'+(shown.length===1?'':'s')+'</h3></div><span class="cmp-chip">'+esc(periodLabel)+'</span></div>'
      +'<div class="cmp-tblwrap"><table class="cmp-tbl"><thead><tr><th>Ad</th><th>Status</th><th class="num">Spend</th><th class="num">Trend</th><th class="num">Conv</th><th class="num">Cost / Conv</th><th class="num">vs prev</th><th class="num">Clicks</th><th class="num">CTR</th><th>Fatigue</th></tr></thead><tbody>'+rowsHtml+'</tbody></table></div></div>';
  } else if(ti===4){
    body=cmpTrendPage(rows.map(function(r){return {name:r.a.name,sub:r.campaigns+' campaign'+(r.campaigns===1?'':'s'),spend:r.spend,pspend:r.pspend,res:r.conv,pres:r.pconv,cpr:r.cpl,pcpr:r.pcpl};}),
      {spend:tSpend,pspend:pSpend,res:tConv,pres:pConv,cpr:cpl,pcpr:pCpl,clk:tClk,pclk:pClkT,ctr:avgCtr,pctr:pAvgCtr},inr,num,'conversions');
  } else {
    // ---- Ad Fatigue (Google): per ad when loaded, else per campaign ----
    const campNameMap={};camps.forEach(function(c){campNameMap[c.id]=c.name;});
    const fr=[];
    gAds.forEach(function(a){
      const i=gAdInsMap[a.id]; if(!i)return;
      const p=gAdPrevMap[a.id]||null;
      const acc=accts.find(function(x){return x.customer_id===a.customer_id;});
      fr.push({name:a.name||'Ad',sub:[(acc&&acc.name)||'',campNameMap[a.campaign_id]||''].filter(Boolean).join(' · '),
        freq:0,ctr:i.ctr!=null?Number(i.ctr):null,pctr:p&&p.ctr!=null?Number(p.ctr):null,
        spend:Number(i.spend)||0,impr:Number(i.impressions)||0});
    });
    if(!fr.length){
      camps.forEach(function(c){
        const i=insMap[c.id]; if(!i)return;
        const p=pInsMap[c.id]||null;
        const acc=accts.find(function(x){return x.customer_id===c.customer_id;});
        fr.push({name:c.name||'Campaign',sub:(acc&&acc.name)||'',freq:0,
          ctr:i.ctr!=null?Number(i.ctr):null,pctr:p&&p.ctr!=null?Number(p.ctr):null,
          spend:Number(i.spend)||0,impr:Number(i.impressions)||0});
      });
    }
    body=cmpFatiguePage(fr.filter(function(x){return x.spend>0||x.impr>0;}),inr,num,'Google · CTR trend (Google publishes no per-person frequency)',true);
  }
  const showKpis=(ti!==4&&ti!==5);
  v.innerHTML=cmpCss+CMP_EXTRA_CSS+mHead('fa-bullhorn','#db2777','Campaign Analytics')+cmpSourceBar()+cmpPeriodBar()+mTabs('campaigns',tabs,ti)+'<div style="margin-top:14px">'+(showKpis?kpiStrip:'')+cap+legend+body+'</div>';
  cmpRunAlerts();
  if(ti===0&&window.Chart){setTimeout(function(){
    const labels=rows.map(function(r){return r.a.name;});
    const palette=['#4285f4','#db2777','#0d9488','#7c3aed','#ea4335','#16a34a','#c2410c','#eab308','#2563eb','#0891b2'];
    const gy={grid:{color:'#f1f5f9'},ticks:{font:{size:11}}},gx={grid:{display:false},ticks:{font:{size:11}}};
    try{new Chart(document.getElementById('gCh1'),{type:'bar',data:{labels:labels,datasets:[{label:'Spend (₹)',data:rows.map(function(r){return r.spend;}),backgroundColor:'#4285f4',borderRadius:6,maxBarThickness:48}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:gy,x:gx}}});}catch(e){}
    try{new Chart(document.getElementById('gCh2'),{type:'bar',data:{labels:labels,datasets:[{label:'Conversions',data:rows.map(function(r){return r.conv;}),backgroundColor:'#0d9488',borderRadius:6,maxBarThickness:48}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:gy,x:gx}}});}catch(e){}
    try{new Chart(document.getElementById('gCh3'),{type:'doughnut',data:{labels:labels,datasets:[{data:rows.map(function(r){return r.spend;}),backgroundColor:labels.map(function(_,i){return palette[i%palette.length];}),borderWidth:2,borderColor:'#fff'}]},options:{responsive:true,maintainAspectRatio:false,cutout:'60%',plugins:{legend:{position:'right',labels:{boxWidth:12,font:{size:11}}}}}});}catch(e){}
    try{new Chart(document.getElementById('gCh4'),{type:'bar',data:{labels:labels,datasets:[{label:'Cost / Conv (₹)',data:rows.map(function(r){return r.cpl!=null?Math.round(r.cpl):0;}),backgroundColor:'#0ea5e9',borderRadius:6,maxBarThickness:48}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:gy,x:gx}}});}catch(e){}
  },60);}
}
// ── HR & Recruitment helpers (used by Recruitment (New) / Human Resources (New) above) ────────
// talent.html/VIEWS.talent (the module these were built for) is retired -- its tabs are now split
// across VIEWS.recruitment_new and VIEWS.hr_new, both of which call straight into the same
// functions below, unchanged.
VIEWS.campaigns=async function(v,seg){
  setCrumb(['Growth & Strategy','Campaign Analytics']);
  if(CMP_SOURCE==='google'){ return cmpGoogleView(v,seg); }
  if(CMP_SOURCE==='both'){ return cmpBothView(v,seg); }
  const tabs=['Overview','Campaigns','By Project','Ads','Trend','Ad Fatigue','AI Insights'];const ti=mTab(seg,tabs.length);
  v.innerHTML=cmpSourceBar()+cmpPeriodBar()+'<div class="loader"><div class="spin"></div></div>';
  const needAd=(ti===3||ti===5);
  // AI Insights: Opportunity Score, anomalies and performance trend from the Meta Ads MCP tool -
  // not something a browser or a period/date query can fetch live, since only a Claude Code
  // session with the Meta Ads MCP connector can call those tools. A local scheduled task refreshes
  // camp.mcp_ad_insights hourly (see mcp-ads-ingest edge function); this tab just reads it.
  const needMcp=(ti===6);
  const periodKey=CMP_PERIOD==='custom'?('custom:'+CMP_SINCE+':'+CMP_UNTIL):CMP_PERIOD;
  const periodLabel=CMP_PERIOD==='custom'?(CMP_SINCE&&CMP_UNTIL?CMP_SINCE+' → '+CMP_UNTIL:'Custom range'):((CMP_PRESETS.find(function(p){return p[0]===CMP_PERIOD;})||[])[1]||CMP_PERIOD);
  // NO LIVE REFRESH HERE ANY MORE. Meta data is fully MCP-sourced now (the account owner's own
  // choice, over the Graph API) - campaign_insights/ad_insights/campaigns/ads/ad_accounts are
  // written by a manually-triggered Claude Code task ("Refresh JainE Campaign Analytics (Meta)
  // from MCP") using the Meta Ads MCP tool, since that tool cannot be called from a browser or a
  // cron-only edge function. This page just reads whatever that task last wrote - see the
  // "Last synced" line below for how stale that might be, and trigger the task again for fresher
  // numbers rather than expecting this page load to fetch anything itself.
  const CMP=()=>sb.schema('camp');
  const prevKey=cmpPrevKey();
  let accounts=[],campaigns=[],cIns=[],ads=[],aIns=[],cPrev=[],aPrev=[],mcpRows=[],refreshReq=null;
  try{
    const calls=[
      CMP().from('ad_accounts').select('*').order('name'),
      CMP().from('campaigns').select('*'),
      CMP().from('campaign_insights').select('*').eq('period',periodKey)
    ];
    const iPrevC=calls.length; if(prevKey)calls.push(CMP().from('campaign_insights').select('*').eq('period',prevKey));
    let iAds=-1,iAdIns=-1,iPrevA=-1,iMcp=-1;
    if(needAd){ iAds=calls.length; calls.push(CMP().from('ads').select('*')); iAdIns=calls.length; calls.push(CMP().from('ad_insights').select('*').eq('period',periodKey)); if(prevKey){ iPrevA=calls.length; calls.push(CMP().from('ad_insights').select('*').eq('period',prevKey)); } }
    if(needMcp){ iMcp=calls.length; calls.push(CMP().from('mcp_ad_insights').select('*')); }
    // The "Run via MCP" button's own state — shown on every sub-tab, not just AI Insights, since
    // it affects every number on the whole Meta side.
    const iReq=calls.length; calls.push(CMP().from('mcp_refresh_requests').select('*').order('requested_at',{ascending:false}).limit(1));
    const results=await Promise.all(calls);
    const at=function(i){return (i>=0&&results[i]&&results[i].data)?results[i].data:[];};
    accounts=at(0);campaigns=at(1);cIns=at(2);
    if(prevKey)cPrev=at(iPrevC);
    if(needAd){ads=at(iAds);aIns=at(iAdIns);if(iPrevA>=0)aPrev=at(iPrevA);}
    if(needMcp)mcpRows=at(iMcp);
    refreshReq=at(iReq)[0]||null;
  }catch(e){}
  const cPrevMap={};cPrev.forEach(function(x){cPrevMap[x.campaign_id]=x;});
  const aPrevMap={};aPrev.forEach(function(x){aPrevMap[x.ad_id]=x;});
  const cInsMap={};cIns.forEach(x=>cInsMap[x.campaign_id]=x);
  const aInsMap={};aIns.forEach(x=>aInsMap[x.ad_id]=x);
  const campMap={};campaigns.forEach(x=>campMap[x.id]=x);
  const inr=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});
  const num=n=>Number(n||0).toLocaleString('en-IN');
  const belongsToProj=function(c,acc){ return c.name&&acc.name&&String(c.name).trim().toLowerCase().startsWith(String(acc.name).trim().toLowerCase()); };
  const projRows=accounts.map(acc=>{
    const accCamps=campaigns.filter(c=>c.ad_account_id===acc.ad_account_id&&belongsToProj(c,acc));
    let spend=0,impr=0,clicks=0,leads=0,reach=0,budget=0,freqSum=0,freqN=0;
    let pspend=0,pimpr=0,pclicks=0,pleads=0;
    accCamps.forEach(c=>{
      const i=cInsMap[c.id];
      if(i){spend+=Number(i.spend)||0;impr+=Number(i.impressions)||0;clicks+=Number(i.clicks)||0;leads+=Number(i.leads)||0;reach+=Number(i.reach)||0;const f=Number(i.frequency)||0;if(f>0){freqSum+=f;freqN++;}}
      const p=cPrevMap[c.id];
      if(p){pspend+=Number(p.spend)||0;pimpr+=Number(p.impressions)||0;pclicks+=Number(p.clicks)||0;pleads+=Number(p.leads)||0;}
      // budget counts ACTIVE campaigns only — paused ones aren't spending
      if(cmpIsActive(c.status)) budget+=Number(c.daily_budget)||Number(c.lifetime_budget)||0;
    });
    return {acc,campaigns:accCamps.length,spend,impr,clicks,leads,reach,budget,
      freq:freqN?(freqSum/freqN):0,
      ctr:impr?(clicks/impr*100):0,cpl:leads?(spend/leads):null,
      pspend,pleads,pctr:pimpr?(pclicks/pimpr*100):0,pcpl:pleads?(pspend/pleads):null};
  });
  CMP_LAST={accounts,campaigns,cInsMap,periodLabel,inr,num,ads,aInsMap,campMap,cPrevMap,aPrevMap};
  const totalSpend=projRows.reduce((s,r)=>s+r.spend,0);
  const totalImpr=projRows.reduce((s,r)=>s+r.impr,0);
  const totalClicks=projRows.reduce((s,r)=>s+r.clicks,0);
  const totalLeads=projRows.reduce((s,r)=>s+r.leads,0);
  const avgCtr=totalImpr?(totalClicks/totalImpr*100):0;
  const totalCpl=totalLeads?(totalSpend/totalLeads):null;
  // previous-period totals (for the Trend pills)
  const pTotSpend=cPrev.reduce((s,x)=>s+(Number(x.spend)||0),0);
  const pTotImpr=cPrev.reduce((s,x)=>s+(Number(x.impressions)||0),0);
  const pTotClicks=cPrev.reduce((s,x)=>s+(Number(x.clicks)||0),0);
  const pTotLeads=cPrev.reduce((s,x)=>s+(Number(x.leads)||0),0);
  const pTotReach=cPrev.reduce((s,x)=>s+(Number(x.reach)||0),0);
  const pAvgCtr=pTotImpr?(pTotClicks/pTotImpr*100):0;
  const pTotCpl=pTotLeads?(pTotSpend/pTotLeads):null;
  const pAvgCpc=pTotClicks?(pTotSpend/pTotClicks):null;
  const metaFreq=(function(){const f=projRows.map(r=>r.freq).filter(x=>x>0);return f.length?(f.reduce((a,b)=>a+b,0)/f.length):0;})();
  const metaBudget=projRows.reduce((s,r)=>s+r.budget,0);
  const kpis=[['Spend ('+periodLabel+')',inr(totalSpend),accounts.length+' projects'],['Results (Leads)',num(totalLeads),''],['Cost / Lead',totalCpl!=null?inr(totalCpl):'—','',totalCpl!=null?'#16855a':'var(--slate)'],['Impressions',num(totalImpr),''],['Avg CTR',avgCtr.toFixed(2)+'%','',avgCtr>=1?'#16855a':'#c2410c']];
  let body;
  if(ti===0){ body='<div class="cmp-charts">'
      +'<div class="cmp-chcard"><h4>Spend by project</h4><div class="sub">'+esc(periodLabel)+' · click a bar for campaign detail</div><div style="height:260px"><canvas id="cmpCh1"></canvas></div></div>'
      +'<div class="cmp-chcard"><h4>Results (Leads) by project</h4><div class="sub">'+esc(periodLabel)+' · click a bar for campaign detail</div><div style="height:260px"><canvas id="cmpCh2"></canvas></div></div>'
      +'<div class="cmp-chcard"><h4>Spend share</h4><div class="sub">where the budget is going</div><div style="height:260px"><canvas id="cmpCh3"></canvas></div></div>'
      +'<div class="cmp-chcard"><h4>Cost per lead by project</h4><div class="sub">lower is better · in ₹</div><div style="height:260px"><canvas id="cmpCh4"></canvas></div></div>'
    +'</div>'; }
  else if(ti===1){
    // Campaign-wise, with Active / Inactive filtering
    const all=campaigns.map(function(c){
      const acc=accounts.find(function(a){return a.ad_account_id===c.ad_account_id;});
      const i=cInsMap[c.id]||null, p=cPrevMap[c.id]||null;
      const spend=i?(Number(i.spend)||0):0, leads=i?(Number(i.leads)||0):0;
      const budget=c.daily_budget!=null?Number(c.daily_budget):(c.lifetime_budget!=null?Number(c.lifetime_budget):null);
      return {c:c,acc:acc,i:i,p:p,spend:spend,leads:leads,budget:budget,
        cpl:leads?spend/leads:null,ctr:i&&i.ctr!=null?Number(i.ctr):null,
        pspend:p?(Number(p.spend)||0):null,
        pcpl:(p&&(Number(p.leads)||0))?((Number(p.spend)||0)/(Number(p.leads)||0)):null,
        pctr:p&&p.ctr!=null?Number(p.ctr):null,
        active:cmpIsActive(c.status)};
    }).filter(function(r){return r.acc;})
      .filter(function(r){return CMP_CAMP_PROJECT==='all'||r.acc.ad_account_id===CMP_CAMP_PROJECT;});
    const counts={all:all.length,active:all.filter(function(r){return r.active;}).length,inactive:all.filter(function(r){return !r.active;}).length};
    const shown=all.filter(function(r){return CMP_STATUS==='all'||(CMP_STATUS==='active'?r.active:!r.active);}).sort(function(a,b){return b.spend-a.spend;});
    const projBar='<div class="cmp-projbar"><select class="cmp-projsel" onchange="cmpSetCampProject(this.value)">'
      +'<option value="all"'+(CMP_CAMP_PROJECT==='all'?' selected':'')+'>All Projects</option>'
      +accounts.map(function(a){return '<option value="'+esc(a.ad_account_id)+'"'+(CMP_CAMP_PROJECT===a.ad_account_id?' selected':'')+'>'+esc(a.name)+'</option>';}).join('')
      +'</select></div>';
    const rowsHtml=shown.length?shown.map(function(r){
      const used=r.budget?Math.round(r.spend/r.budget*100):null;
      return '<tr><td><div class="cmp-nm">'+esc(r.c.name||'—')+'</div><div class="cmp-sub">'+esc(r.acc.name)+(r.c.objective?(' · '+esc(String(r.c.objective).replace(/_/g,' ').toLowerCase())):'')+'</div></td>'
        +'<td>'+(r.active?'<span class="cmp-fg ok"><i class="fa-solid fa-circle"></i> Active</span>':'<span class="cmp-fg na" style="color:#98a2b3"><i class="fa-solid fa-circle"></i> '+esc(r.c.status?String(r.c.status).charAt(0)+String(r.c.status).slice(1).toLowerCase():'Inactive')+'</span>')+'</td>'
        +'<td class="num">'+(r.budget?(inr(r.budget)+(used!=null?'<div class="cmp-sub" style="text-align:right'+(used>100?';color:#c0392f':'')+'">'+used+'% used</div>':'')):'—')+'</td>'
        +'<td class="num strong">'+inr(r.spend)+'</td>'
        +'<td class="num">'+cmpTrend(r.spend,r.pspend,false)+'</td>'
        +'<td class="num">'+num(r.leads)+'</td>'
        +'<td class="num">'+(r.cpl!=null?inr(r.cpl):'—')+'</td>'
        +'<td class="num">'+cmpTrend(r.cpl,r.pcpl,true)+'</td>'
        +'<td class="num">'+(r.ctr!=null?r.ctr.toFixed(2)+'%':'—')+'</td>'
        +'<td>'+cmpFatigue(r.i?(Number(r.i.frequency)||0):0,r.ctr,r.pctr)+'</td></tr>';
    }).join(''):'<tr><td colspan="10" class="cmp-none">No campaigns match this filter</td></tr>';
    body=projBar+cmpStatusBar(counts)+'<div class="cmp-panel"><div class="cmp-phead"><div><span class="cmp-over">Campaigns</span><h3>'+shown.length+' campaign'+(shown.length===1?'':'s')+'</h3></div><span class="cmp-chip">'+esc(periodLabel)+'</span></div>'
      +'<div class="cmp-tblwrap"><table class="cmp-tbl"><thead><tr><th>Campaign</th><th>Status</th><th class="num">Budget</th><th class="num">Spend</th><th class="num">Trend</th><th class="num">Leads</th><th class="num">Cost / Lead</th><th class="num">vs prev</th><th class="num">CTR</th><th>Fatigue</th></tr></thead><tbody>'+rowsHtml+'</tbody></table></div></div>';
  }
  else if(ti===2){
    const sorted=projRows.slice().sort((a,b)=>b.spend-a.spend);
    body=sorted.length?('<div class="card qc-table-card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+
      ['Project','Campaigns','Daily Budget','Spend','Trend','Results (Leads)','Cost / Lead','Reach','CTR','Fatigue'].map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+
      '</tr></thead><tbody>'+
      sorted.map(function(r){
        const used=r.budget?Math.round(r.spend/r.budget*100):null;
        return '<tr class="clk" onclick="cmpShowProject(\''+r.acc.ad_account_id+'\',\'by_project\')">'+
        '<td style="font-weight:600">'+esc(r.acc.name)+'</td>'+
        '<td style="text-align:right">'+r.campaigns+'</td>'+
        '<td style="text-align:right">'+(r.budget?(inr(r.budget)+'<span style="color:var(--slate);font-size:11px">/day</span>'+(used!=null?'<div style="font-size:10.5px;color:'+(used>100?'#b91c1c':'var(--slate)')+'">'+used+'% used</div>':'')):'—')+'</td>'+
        '<td style="text-align:right;font-weight:600">'+inr(r.spend)+'</td>'+
        '<td style="text-align:right">'+cmpTrend(r.spend,r.pspend,false)+'</td>'+
        '<td style="text-align:right">'+num(r.leads)+' '+cmpTrend(r.leads,r.pleads,false)+'</td>'+
        '<td style="text-align:right">'+(r.cpl!=null?inr(r.cpl):'—')+' '+cmpTrend(r.cpl,r.pcpl,true)+'</td>'+
        '<td style="text-align:right">'+num(r.reach)+'</td>'+
        '<td style="text-align:right">'+r.ctr.toFixed(2)+'%</td>'+
        '<td style="text-align:right">'+cmpFatigue(r.freq,r.ctr,r.pctr)+'</td>'+
      '</tr>';}).join('')+
      '</tbody></table></div></div>'):'<div class="card card-pad empty"><i class="fa-solid fa-chart-pie"></i><div>No project data for this period</div></div>';
  }
  else if(ti===4){
    // ---- Trend page ----
    body=cmpTrendPage(projRows.map(function(r){return {name:r.acc.name,sub:r.campaigns+' campaign'+(r.campaigns===1?'':'s'),spend:r.spend,pspend:r.pspend,res:r.leads,pres:r.pleads,cpr:r.cpl,pcpr:r.pcpl};}),
      {spend:totalSpend,pspend:pTotSpend,res:totalLeads,pres:pTotLeads,cpr:totalCpl,pcpr:pTotCpl,clk:totalClicks,pclk:pTotClicks,ctr:avgCtr,pctr:pAvgCtr},inr,num,'leads');
  }
  else if(ti===5){
    // ---- Ad Fatigue page (per ad when available, else per campaign) ----
    const fr=[];
    ads.forEach(function(a){
      const i=aInsMap[a.id]; if(!i)return;
      const p=aPrevMap[a.id]||null;
      const acc=accounts.find(function(x){return x.ad_account_id===a.ad_account_id;});
      const camp=campMap[a.campaign_id];
      fr.push({name:a.name||'Ad',sub:[(acc&&acc.name)||'',(camp&&camp.name)||''].filter(Boolean).join(' · '),
        freq:Number(i.frequency)||0,ctr:i.ctr!=null?Number(i.ctr):null,pctr:p&&p.ctr!=null?Number(p.ctr):null,
        spend:Number(i.spend)||0,impr:Number(i.impressions)||0});
    });
    if(!fr.length){
      campaigns.forEach(function(c){
        const i=cInsMap[c.id]; if(!i)return;
        const p=cPrevMap[c.id]||null;
        const acc=accounts.find(function(x){return x.ad_account_id===c.ad_account_id;});
        fr.push({name:c.name||'Campaign',sub:(acc&&acc.name)||'',freq:Number(i.frequency)||0,
          ctr:i.ctr!=null?Number(i.ctr):null,pctr:p&&p.ctr!=null?Number(p.ctr):null,
          spend:Number(i.spend)||0,impr:Number(i.impressions)||0});
      });
    }
    body=cmpFatiguePage(fr.filter(function(x){return x.spend>0||x.impr>0;}),inr,num,'Meta · per-person frequency + CTR trend');
  }
  else if(ti===6){
    // ---- AI Insights: Opportunity Score, anomalies, performance trend (Meta Ads MCP) ----
    const mcpByAcc={}; mcpRows.forEach(function(r){ mcpByAcc[r.ad_account_id]=r; });
    const scoreColor=function(s){ return s==null?'var(--slate)':(s>=80?'#16a34a':(s>=50?'#c2410c':'#b91c1c')); };
    const agoText=function(iso){
      if(!iso) return null;
      const mins=Math.round((Date.now()-new Date(iso).getTime())/60000);
      if(mins<2) return 'just now';
      if(mins<60) return mins+' min ago';
      const hrs=Math.round(mins/60);
      if(hrs<48) return hrs+' hr'+(hrs===1?'':'s')+' ago';
      return Math.round(hrs/24)+' days ago';
    };
    const pre=function(text){ return '<pre style="white-space:pre-wrap;font-family:inherit;font-size:12.5px;color:var(--ink,#0f172a);background:#f8fafc;border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:6px 0 0;max-height:260px;overflow:auto">'+esc(text)+'</pre>'; };
    const cards=accounts.map(function(acc){
      const m=mcpByAcc[acc.ad_account_id];
      if(!m){
        return '<div class="cmp-chcard"><h4>'+esc(acc.name)+'</h4><div class="sub">Not yet refreshed — the hourly Meta Ads MCP job hasn\'t run for this account yet.</div></div>';
      }
      const recs=(Array.isArray(m.recommendations)?m.recommendations:[])
        .slice().sort(function(a,b){ return (Number(b&&b.recommendation_content&&b.recommendation_content.opportunity_score_lift)||0)-(Number(a&&a.recommendation_content&&a.recommendation_content.opportunity_score_lift)||0); })
        .slice(0,3);
      const recsHtml=recs.length?('<ul style="margin:6px 0 0;padding-left:18px;font-size:12.5px;line-height:1.6">'+recs.map(function(r){
        const rc=r&&r.recommendation_content||{};
        return '<li><b>'+esc(rc.lift_estimate||'Recommendation')+'</b> — '+esc(rc.body||'')+(r.url?' <a href="'+esc(r.url)+'" target="_blank" rel="noopener" style="color:var(--brand)">Open in Ads Manager</a>':'')+'</li>';
      }).join('')+'</ul>'):'<div class="sub">No recommendations returned.</div>';
      const anomText=(m.anomalies&&m.anomalies.result)?m.anomalies.result:null;
      const trendAd=(m.performance_trends&&m.performance_trends.ad&&m.performance_trends.ad.result)?m.performance_trends.ad.result:null;
      const trendAdset=(m.performance_trends&&m.performance_trends.adset&&m.performance_trends.adset.result)?m.performance_trends.adset.result:null;
      return '<div class="cmp-chcard">'
        +'<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">'
          +'<h4>'+esc(acc.name)+'</h4>'
          +'<span style="font-weight:800;font-size:16px;color:'+scoreColor(m.opportunity_score)+'">'+(m.opportunity_score!=null?m.opportunity_score:'—')+(m.opportunity_score!=null?'<span style="font-size:11px;font-weight:600;color:var(--slate)">/100</span>':'')+'</span>'
        +'</div>'
        +'<div class="sub">Opportunity Score'+(agoText(m.fetched_at)?(' · updated '+agoText(m.fetched_at)):'')+'</div>'
        +'<h5 style="margin:12px 0 0;font-size:12px;color:var(--slate);text-transform:uppercase;letter-spacing:.03em">Top recommendations</h5>'+recsHtml
        +'<h5 style="margin:14px 0 0;font-size:12px;color:var(--slate);text-transform:uppercase;letter-spacing:.03em">Anomalies</h5>'+(anomText?pre(anomText):'<div class="sub">No anomalies flagged.</div>')
        +'<h5 style="margin:14px 0 0;font-size:12px;color:var(--slate);text-transform:uppercase;letter-spacing:.03em">Performance trend — Ads</h5>'+(trendAd?pre(trendAd):'<div class="sub">Not available.</div>')
        +'<h5 style="margin:14px 0 0;font-size:12px;color:var(--slate);text-transform:uppercase;letter-spacing:.03em">Performance trend — Ad sets</h5>'+(trendAdset?pre(trendAdset):'<div class="sub">Not available.</div>')
      +'</div>';
    });
    body='<div class="cmp-cap"><i class="fa-solid fa-wand-magic-sparkles" style="color:#7c3aed"></i> From the Meta Ads MCP tool · refreshed hourly by a scheduled Claude Code job, independent of the period picker above</div>'
      +'<div class="cmp-charts">'+cards.join('')+'</div>';
  }
  else {
    const filteredAccIds=new Set((CMP_AD_PROJECT==='all'?accounts:accounts.filter(a=>a.ad_account_id===CMP_AD_PROJECT)).map(a=>a.ad_account_id));
    const allAdRows=ads.map(a=>{const i=aInsMap[a.id];const camp=campMap[a.campaign_id];const acc=accounts.find(x=>x.ad_account_id===a.ad_account_id);return {a,i,camp,acc,spend:i?Number(i.spend)||0:0};})
      .filter(r=>r.i&&r.acc&&filteredAccIds.has(r.acc.ad_account_id)&&r.camp&&belongsToProj(r.camp,r.acc)).sort((x,y)=>y.spend-x.spend);
    const projFilterBar='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">'+
      '<select onchange="cmpSetAdProject(this.value)" style="padding:7px 10px;border:1px solid var(--line);border-radius:8px;font-size:12.5px;font-family:inherit">'+
        '<option value="all"'+(CMP_AD_PROJECT==='all'?' selected':'')+'>All Projects</option>'+
        accounts.map(function(a){return '<option value="'+esc(a.ad_account_id)+'"'+(CMP_AD_PROJECT===a.ad_account_id?' selected':'')+'>'+esc(a.name)+'</option>';}).join('')+
      '</select>'+
      '<span style="color:var(--slate);font-size:12.5px">'+allAdRows.length+' ad'+(allAdRows.length===1?'':'s')+'</span>'+
    '</div>';
    const PAGE_SIZE=25;
    const totalPages=Math.max(1,Math.ceil(allAdRows.length/PAGE_SIZE));
    const curPage=Math.min(CMP_AD_PAGE,totalPages-1);
    const pageRows=allAdRows.slice(curPage*PAGE_SIZE,(curPage+1)*PAGE_SIZE);
    const tbl=pageRows.length?('<div class="card qc-table-card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+
      ['Ad','Project','Campaign','Status','Spend','Trend','Clicks','CTR','Fatigue'].map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+
      '</tr></thead><tbody>'+
      pageRows.map(function(r){
        const p=aPrevMap[r.a.id]||null;
        const pSp=p?(Number(p.spend)||0):null, pCt=p?(Number(p.ctr)||0):null;
        return '<tr class="clk" onclick="cmpShowProjectAds(\''+r.acc.ad_account_id+'\')">'+
        '<td style="font-weight:600">'+esc(r.a.name)+'</td>'+
        '<td>'+esc(r.acc.name)+'</td>'+
        '<td>'+esc(r.camp.name)+'</td>'+
        '<td>'+esc(r.a.effective_status||r.a.status||'—')+'</td>'+
        '<td style="text-align:right;font-weight:600">'+inr(r.spend)+'</td>'+
        '<td style="text-align:right">'+cmpTrend(r.spend,pSp,false)+'</td>'+
        '<td style="text-align:right">'+num(r.i.clicks)+'</td>'+
        '<td style="text-align:right">'+(r.i.ctr!=null?Number(r.i.ctr).toFixed(2)+'%':'—')+'</td>'+
        '<td style="text-align:right">'+cmpFatigue(Number(r.i.frequency)||0,r.i.ctr,pCt)+'</td>'+
      '</tr>';}).join('')+
      '</tbody></table></div></div>'):'<div class="card card-pad empty"><i class="fa-solid fa-rectangle-ad"></i><div>No ad-level data for this project/period</div></div>';
    const pager=allAdRows.length>PAGE_SIZE?('<div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:12px">'+
      '<button class="btn" style="padding:6px 12px;font-size:12.5px" '+(curPage<=0?'disabled':('onclick="cmpSetAdPage('+(curPage-1)+')"'))+'>Prev</button>'+
      '<span style="color:var(--slate);font-size:12.5px">Page '+(curPage+1)+' of '+totalPages+'</span>'+
      '<button class="btn" style="padding:6px 12px;font-size:12.5px" '+(curPage>=totalPages-1?'disabled':('onclick="cmpSetAdPage('+(curPage+1)+')"'))+'>Next</button>'+
    '</div>'):'';
    body=projFilterBar+tbl+pager;
  }
  const totalReach=projRows.reduce((s,r)=>s+r.reach,0);
  const avgCpc=totalClicks?(totalSpend/totalClicks):null;
  // Scoped premium styling for the dashboard (re-injected with the view; harmless to repeat).
  const cmpCss='<style>'
    +'.cmp-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:0 0 18px}'
    +'@media(max-width:1100px){.cmp-kpis{grid-template-columns:repeat(3,1fr)}}'
    +'@media(max-width:640px){.cmp-kpis{grid-template-columns:repeat(2,1fr);gap:10px}.cmp-kpi{padding:12px 13px}.cmp-kpi .kv{font-size:20px}.cmp-kpi .ki{width:30px;height:30px;font-size:13px}}'
    +'.cmp-kpi{position:relative;background:#fff;border:1px solid var(--line);border-radius:14px;padding:15px 16px;box-shadow:var(--shadow);overflow:hidden}'
    +'.cmp-kpi::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--kc,#db2777)}'
    +'.cmp-kpi .kh{display:flex;align-items:center;justify-content:space-between;gap:8px}'
    +'.cmp-kpi .ki{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;background:var(--kbg,#fdf2f8);color:var(--kc,#db2777)}'
    +'.cmp-kpi .kl{font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--slate)}'
    +'.cmp-kpi .kv{font-size:24px;font-weight:800;letter-spacing:-.5px;color:var(--ink,#0f172a);margin-top:12px;line-height:1}'
    +'.cmp-kpi .ks{font-size:11.5px;color:var(--slate);margin-top:5px;min-height:14px}'
    +'.cmp-charts{display:grid;grid-template-columns:1fr 1fr;gap:16px}'
    +'@media(max-width:900px){.cmp-charts{grid-template-columns:1fr}}'
    +'.cmp-chcard{background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);padding:16px}'
    +'.cmp-chcard h4{margin:0;font-size:13.5px;font-weight:700;color:var(--ink,#0f172a)}'
    +'.cmp-chcard .sub{font-size:11.5px;color:var(--slate);margin:3px 0 12px}'
    +'.cmp-cap{font-size:12px;color:var(--slate);margin:-4px 0 14px;display:flex;align-items:center;gap:7px}'
    +'</style>';
  const cmpKpi=function(icon,label,value,sub,color,bg,trend){return '<div class="cmp-kpi" style="--kc:'+color+';--kbg:'+bg+'"><div class="kh"><span class="kl">'+esc(label)+'</span><span class="ki"><i class="fa-solid '+icon+'"></i></span></div><div class="kv">'+esc(value)+'</div><div class="ks">'+esc(sub||'')+'</div>'+(trend?'<div class="ktr">'+trend+'</div>':'')+'</div>';};
  const kpiStrip='<div class="cmp-kpis">'
    +cmpKpi('fa-indian-rupee-sign','Spend',inr(totalSpend),accounts.length+' project'+(accounts.length===1?'':'s'),'#db2777','#fdf2f8',cmpTrend(totalSpend,pTotSpend,false))
    +cmpKpi('fa-wallet','Daily Budget',metaBudget?inr(metaBudget):'—','across campaigns','#6366f1','#eef2ff',metaBudget?('<span class="cmp-tr flat" title="Share of the daily budget already spent"><i class="fa-solid fa-gauge-high"></i> '+Math.round(totalSpend/metaBudget*100)+'% used</span>'):'')
    +cmpKpi('fa-user-plus','Results (Leads)',num(totalLeads),totalLeads?'generated':'no leads yet','#7c3aed','#f5f3ff',cmpTrend(totalLeads,pTotLeads,false))
    +cmpKpi('fa-tags','Cost / Lead',totalCpl!=null?inr(totalCpl):'—','lower is better','#0ea5e9','#f0f9ff',cmpTrend(totalCpl,pTotCpl,true))
    +cmpKpi('fa-eye','Impressions',num(totalImpr),'','#0891b2','#ecfeff',cmpTrend(totalImpr,pTotImpr,false))
    +cmpKpi('fa-users','Reach',num(totalReach),(totalReach&&totalImpr)?((totalImpr/totalReach).toFixed(1)+'x seen on avg'):'','#0d9488','#f0fdfa',cmpTrend(totalReach,pTotReach,false))
    +cmpKpi('fa-hand-pointer','Clicks',num(totalClicks),'','#2563eb','#eff6ff',cmpTrend(totalClicks,pTotClicks,false))
    +cmpKpi('fa-percent','Avg CTR',avgCtr.toFixed(2)+'%',avgCtr>=1?'healthy':'below 1%','#16a34a','#f0fdf4',cmpTrend(avgCtr,pAvgCtr,false))
    +cmpKpi('fa-coins','Avg CPC',avgCpc!=null?inr(avgCpc):'—','per click','#c2410c','#fff7ed',cmpTrend(avgCpc,pAvgCpc,true))
    +cmpKpi('fa-fire','Ad Fatigue',metaFreq?(metaFreq.toFixed(1)+'x'):'—','seen per person','#e11d48','#fff1f2',cmpFatigue(metaFreq,avgCtr,pAvgCtr))
    +'</div>';
  // No longer "Live" - see the note above where the old refresh call used to be. last_synced_at
  // is stamped by the MCP ingest task each time it writes ad_accounts, so this is genuinely when
  // the numbers on screen were last fetched, not just when the page happened to load.
  const lastSynced=accounts.map(function(a){return a.last_synced_at;}).filter(Boolean).sort().pop();
  // Shared by the sync caption below and the last-run-result line further down.
  const agoWords=function(iso){
    if(!iso) return null;
    const mins=Math.round((Date.now()-new Date(iso).getTime())/60000);
    if(mins<2) return 'just now';
    if(mins<60) return mins+' min ago';
    const hrs=Math.round(mins/60);
    if(hrs<48) return hrs+' hr'+(hrs===1?'':'s')+' ago';
    return Math.round(hrs/24)+' days ago';
  };
  const syncAgo=lastSynced?('synced '+agoWords(lastSynced)):'never synced — run the MCP refresh task';
  // The button itself. A pending/running request disables it and shows a spinner instead - the
  // watcher polls every ~20s and a full refresh can take several minutes (6 accounts x 16
  // period-buckets x 2 levels, plus the AI Insights calls), so repeated clicks would just queue
  // more work behind the one already running for no benefit.
  const reqBusy=refreshReq&&(refreshReq.status==='pending'||refreshReq.status==='running');
  const runBtn=reqBusy
    ? '<button class="ac-btn ic" disabled title="'+(refreshReq.status==='pending'?'Waiting for the local watcher to pick this up':'Running — this can take several minutes')+'"><i class="fa-solid fa-spinner fa-spin"></i> '+(refreshReq.status==='pending'?'Queued…':'Running…')+'</button>'
    : '<button class="ac-btn ic" onclick="cmpRunMcpRefresh()" title="Queues a full Meta Ads MCP refresh — picked up by the local watcher on the always-on PC, not run in this browser"><i class="fa-solid fa-arrows-rotate"></i> Run via MCP</button>';
  const lastResult=(refreshReq&&(refreshReq.status==='done'||refreshReq.status==='failed'))
    ? '<div class="cmp-cap" style="color:'+(refreshReq.status==='failed'?'#b91c1c':'var(--slate)')+'"><i class="fa-solid '+(refreshReq.status==='failed'?'fa-triangle-exclamation':'fa-circle-check')+'"></i> Last run '+(refreshReq.status==='failed'?'failed':'finished')+(refreshReq.finished_at?(' '+esc(agoWords(refreshReq.finished_at)||'')):'')+(refreshReq.summary?(': '+esc(refreshReq.summary)):'')+'</div>'
    : '';
  const syncCap='<div class="cmp-cap" style="justify-content:space-between;display:flex;align-items:center;flex-wrap:wrap;gap:10px"><span><i class="fa-brands fa-facebook" style="color:#1877f2"></i> Meta Ads via MCP · '+esc(periodLabel)+(accounts.length?(' · '+accounts.length+' ad account'+(accounts.length===1?'':'s')):'')+' · <span title="Data comes from a manually-triggered Claude Code task, not a live page-load fetch">'+esc(syncAgo)+'</span></span>'+runBtn+'</div>'+lastResult
    // Custom ranges are the one thing the MCP refresh task does not pre-compute (it only fetches
    // the 10 fixed presets, each account x each preset x campaign+ad level being expensive enough
    // already) - a picked custom range will show empty rather than fetch anything, so say so
    // plainly instead of leaving a silent "no data" that looks like a bug.
    +(CMP_PERIOD==='custom'?'<div class="cmp-cap" style="color:#c2410c"><i class="fa-solid fa-triangle-exclamation"></i> Custom ranges aren\'t fetched by the MCP refresh task — pick one of the preset periods above, or ask for this range to be pulled directly.</div>':'');
  const legend='<div class="cmp-legend"><span>Trend compares with '+esc(cmpPrevLabel())+'</span><span>Fatigue = times each person saw the ad + whether CTR is falling</span></div>';
  const showKpis=(ti!==4&&ti!==5&&ti!==6);
  v.innerHTML=cmpCss+CMP_EXTRA_CSS+mHead('fa-bullhorn','#db2777','Campaign Analytics')+cmpSourceBar()+cmpPeriodBar()+mTabs('campaigns',tabs,ti)+'<div style="margin-top:14px">'+(showKpis?kpiStrip:'')+syncCap+legend+body+'</div>';
  cmpRunAlerts();
  if(ti===0&&window.Chart){setTimeout(function(){
    const labels=projRows.map(r=>r.acc.name);
    const accIds=projRows.map(r=>r.acc.ad_account_id);
    const clickPt=function(evt,elements){if(elements&&elements.length){cmpShowProject(accIds[elements[0].index]);}};
    const hoverPt=function(evt,elements){if(evt&&evt.native&&evt.native.target)evt.native.target.style.cursor=elements.length?'pointer':'default';};
    const palette=['#db2777','#7c3aed','#2563eb','#0891b2','#0d9488','#16a34a','#c2410c','#eab308','#e11d48','#4f46e5'];
    const gy={grid:{color:'#f1f5f9'},ticks:{font:{size:11}}},gx={grid:{display:false},ticks:{font:{size:11}}};
    try{new Chart(document.getElementById('cmpCh1'),{type:'bar',data:{labels,datasets:[{label:'Spend (₹)',data:projRows.map(r=>r.spend),backgroundColor:'#db2777',borderRadius:6,maxBarThickness:48}]},options:{responsive:true,maintainAspectRatio:false,onClick:clickPt,onHover:hoverPt,plugins:{legend:{display:false}},scales:{y:gy,x:gx}}});}catch(e){}
    try{new Chart(document.getElementById('cmpCh2'),{type:'bar',data:{labels,datasets:[{label:'Leads',data:projRows.map(r=>r.leads),backgroundColor:'#0A2640',borderRadius:6,maxBarThickness:48}]},options:{responsive:true,maintainAspectRatio:false,onClick:clickPt,onHover:hoverPt,plugins:{legend:{display:false}},scales:{y:gy,x:gx}}});}catch(e){}
    try{new Chart(document.getElementById('cmpCh3'),{type:'doughnut',data:{labels,datasets:[{data:projRows.map(r=>r.spend),backgroundColor:labels.map(function(_,i){return palette[i%palette.length];}),borderWidth:2,borderColor:'#fff'}]},options:{responsive:true,maintainAspectRatio:false,cutout:'60%',onClick:clickPt,onHover:hoverPt,plugins:{legend:{position:'right',labels:{boxWidth:12,font:{size:11}}}}}});}catch(e){}
    try{new Chart(document.getElementById('cmpCh4'),{type:'bar',data:{labels,datasets:[{label:'Cost / Lead (₹)',data:projRows.map(r=>r.cpl!=null?Math.round(r.cpl):0),backgroundColor:'#0ea5e9',borderRadius:6,maxBarThickness:48}]},options:{responsive:true,maintainAspectRatio:false,onClick:clickPt,onHover:hoverPt,plugins:{legend:{display:false}},scales:{y:gy,x:gx}}});}catch(e){}
  },60);}
};