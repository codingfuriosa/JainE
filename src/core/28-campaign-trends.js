/* ============ Trend / Fatigue / Best-&-Worst (shared by the Meta, Google and Both tabs) ============
   "Trend" = this period compared with the SAME-LENGTH period immediately before it. We ask the live
   sync functions for that earlier window too (as a custom range), then compare the two. */
function cmpDayStr(d){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),dd=String(d.getDate()).padStart(2,'0');return y+'-'+m+'-'+dd;}
function cmpAddDays(d,n){const x=new Date(d.getTime());x.setDate(x.getDate()+n);return x;}
// The equivalent window immediately before the one being viewed.
function cmpPrevRange(){
  const today=new Date();today.setHours(12,0,0,0);
  const P=CMP_PERIOD;
  if(P==='today'){const d=cmpAddDays(today,-1);return {since:cmpDayStr(d),until:cmpDayStr(d)};}
  if(P==='yesterday'){const d=cmpAddDays(today,-2);return {since:cmpDayStr(d),until:cmpDayStr(d)};}
  if(P==='last_7d')return {since:cmpDayStr(cmpAddDays(today,-14)),until:cmpDayStr(cmpAddDays(today,-8))};
  if(P==='last_14d')return {since:cmpDayStr(cmpAddDays(today,-28)),until:cmpDayStr(cmpAddDays(today,-15))};
  if(P==='last_month'){const first=new Date(today.getFullYear(),today.getMonth()-2,1);const last=new Date(today.getFullYear(),today.getMonth()-1,0);return {since:cmpDayStr(first),until:cmpDayStr(last)};}
  if(P==='last_year')return {since:cmpDayStr(cmpAddDays(today,-729)),until:cmpDayStr(cmpAddDays(today,-365))};
  if(P==='custom'&&CMP_SINCE&&CMP_UNTIL){
    const s=new Date(CMP_SINCE+'T12:00:00'),u=new Date(CMP_UNTIL+'T12:00:00');
    const len=Math.max(1,Math.round((u-s)/86400000)+1);
    return {since:cmpDayStr(cmpAddDays(s,-len)),until:cmpDayStr(cmpAddDays(s,-1))};
  }
  return null;
}
function cmpPrevKey(){const p=cmpPrevRange();return p?('custom:'+p.since+':'+p.until):null;}
function cmpPrevLabel(){const p=cmpPrevRange();return p?(p.since===p.until?p.since:(p.since+' → '+p.until)):'previous period';}
// Meta's previous-period window is no longer live-fetched here: Meta is fully MCP-sourced now
// (the account owner's own call, over the Graph API). A manually triggered Claude Code task
// ("Refresh JainE Campaign Analytics (Meta) from MCP") computes and writes these same
// custom:since:until previous-period rows itself. google-ads-live still fills both of its own
// buckets in one call (its prev_since/prev_until parameters), so there is nothing left for this
// to do for either source; kept as a documented no-op rather than deleted, since cmpBothView
// still calls it.
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
function cmpTrend(cur,prev,lowerIsBetter){
  cur=Number(cur)||0;
  if(prev===null||prev===undefined||!isFinite(Number(prev))||Number(prev)===0){
    return '<span class="cmp-tr none" title="No data for '+esc(cmpPrevLabel())+' to compare against">—</span>';
  }
  prev=Number(prev);
  const pct=(cur-prev)/Math.abs(prev)*100;
  if(Math.abs(pct)<1)return '<span class="cmp-tr flat" title="Barely changed vs '+esc(cmpPrevLabel())+'"><i class="fa-solid fa-minus"></i> 0%</span>';
  const up=pct>0, good=lowerIsBetter?!up:up;
  const tip=(up?'Up ':'Down ')+Math.abs(pct).toFixed(0)+'% vs '+cmpPrevLabel()+(good?' — better':' — worse');
  return '<span class="cmp-tr '+(good?'good':'bad')+'" title="'+esc(tip)+'"><i class="fa-solid '+(up?'fa-arrow-trend-up':'fa-arrow-trend-down')+'"></i> '+(up?'+':'−')+Math.abs(pct).toFixed(0)+'%</span>';
}
/* Ad fatigue. Meta gives a real per-person "frequency" (how many times each person saw the ad) —
   high frequency plus a falling CTR is classic creative burnout. Google Ads has no per-user
   frequency for Search, so there we score on the CTR fall alone. */
function cmpFatigue(freq,ctr,prevCtr){
  const f=Number(freq)||0;
  const c=(ctr==null)?null:Number(ctr), pc=(prevCtr==null)?null:Number(prevCtr);
  const drop=(pc&&pc>0&&c!=null)?(1-(c/pc)):null;
  if(!f&&drop===null)return '<span class="cmp-fg na" title="Not enough data yet">—</span>';
  let score=0;
  if(f>=4)score+=2;else if(f>=3)score+=1.5;else if(f>=2.5)score+=1;
  if(drop!==null&&drop>=0.30)score+=2;else if(drop!==null&&drop>=0.15)score+=1;
  const bits=[];
  if(f)bits.push('Seen '+f.toFixed(1)+'x per person');
  if(drop!==null)bits.push(drop>0?('CTR down '+Math.round(drop*100)+'%'):('CTR up '+Math.round(-drop*100)+'%'));
  const tip=bits.join(' · ')||'No signal';
  if(score>=3)return '<span class="cmp-fg hi" title="'+esc(tip+' — refresh the creative')+'"><i class="fa-solid fa-fire"></i> High</span>';
  if(score>=1.5)return '<span class="cmp-fg md" title="'+esc(tip+' — keep an eye on it')+'"><i class="fa-solid fa-triangle-exclamation"></i> Watch</span>';
  return '<span class="cmp-fg ok" title="'+esc(tip)+'"><i class="fa-solid fa-circle-check"></i> Fresh</span>';
}
/* ---------------- TREND page ----------------
   rows = [{name, sub, spend, pspend, res, pres, cpr, pcpr, ctr, pctr}] */
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
window.cmpSetSource=function(s){CMP_SOURCE=s;CMP_AD_PAGE=0;showHash('#/campaigns');};
function cmpSourceBar(){return '<div style="margin-bottom:12px"><div class="seg"><button class="seg-btn'+(CMP_SOURCE==='meta'?' on':'')+'" onclick="cmpSetSource(\'meta\')"><i class="fa-brands fa-facebook"></i> &nbsp;Meta</button><button class="seg-btn'+(CMP_SOURCE==='google'?' on':'')+'" onclick="cmpSetSource(\'google\')"><i class="fa-brands fa-google"></i> &nbsp;Google Ads</button><button class="seg-btn'+(CMP_SOURCE==='both'?' on':'')+'" onclick="cmpSetSource(\'both\')"><i class="fa-solid fa-layer-group"></i> &nbsp;Both</button></div></div>';}
window.cmpSetPeriod=function(p){CMP_PERIOD=p;if(p!=='custom'){CMP_SINCE='';CMP_UNTIL='';}renderPage();};
window.cmpSetCustom=function(){const s=$('cmpSince')&&$('cmpSince').value,u=$('cmpUntil')&&$('cmpUntil').value;if(!s||!u){toast('Pick both dates','err');return;}if(s>u){toast('Start date must be before end date','err');return;}CMP_SINCE=s;CMP_UNTIL=u;CMP_PERIOD='custom';renderPage();};
window.cmpSetAdProject=function(v){CMP_AD_PROJECT=v;CMP_AD_PAGE=0;renderPage();};
window.cmpSetCampProject=function(v){CMP_CAMP_PROJECT=v;renderPage();};
// Pull Google ad-level rows for the period on screen. The first fetch for an unseen period can
// take a while (it walks every account), so this reports honestly instead of failing silently.
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
window.cmpShowProject=function(accId,srcTab){
  if(!CMP_LAST)return;
  const acc=CMP_LAST.accounts.find(a=>a.ad_account_id===accId);
  if(!acc)return;
  const inr=CMP_LAST.inr,num=CMP_LAST.num;
  const belongsToProj=function(c,a){ return c.name&&a.name&&String(c.name).trim().toLowerCase().startsWith(String(a.name).trim().toLowerCase()); };
  const prevMap=CMP_LAST.cPrevMap||{};
  const rows=CMP_LAST.campaigns.filter(c=>c.ad_account_id===accId&&belongsToProj(c,acc)).map(c=>{
    const i=CMP_LAST.cInsMap[c.id]||{};
    const p=prevMap[c.id]||null;
    const spend=Number(i.spend)||0,leads=Number(i.leads)||0;
    const budget=c.daily_budget!=null?Number(c.daily_budget):(c.lifetime_budget!=null?Number(c.lifetime_budget):null);
    const pspend=p?(Number(p.spend)||0):null, pleads=p?(Number(p.leads)||0):0;
    return {c,i,spend,leads,budget,cpl:leads?spend/leads:null,
      pspend,pcpl:pleads?((Number(p.spend)||0)/pleads):null,pctr:p?(Number(p.ctr)||0):null};
  }).sort((a,b)=>b.spend-a.spend);
  const totalSpend=rows.reduce((s,r)=>s+r.spend,0);
  const totalLeads=rows.reduce((s,r)=>s+r.leads,0);
  const statusTag=function(st){const s=(st||'').toUpperCase();if(s==='ACTIVE')return '<span class="tag t-green">Active</span>';if(s==='PAUSED')return '<span class="tag t-amber">Paused</span>';return s?'<span class="tag" style="background:#f1f5f9;color:#475569">'+esc(s)+'</span>':'—';};
  const tbl=rows.length?('<div class="card qc-table-card" style="padding:0;margin-top:14px"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+
    ['Campaign','Status','Budget','Spend','Trend','Results (Leads)','Cost / Lead','Reach','CTR','Fatigue'].map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+
    '</tr></thead><tbody>'+
    rows.map(function(r){return '<tr>'+
      '<td style="font-weight:600">'+esc(r.c.name||'—')+'</td>'+
      '<td>'+statusTag(r.c.status)+'</td>'+
      '<td style="text-align:right">'+(r.budget?inr(r.budget)+(r.c.daily_budget!=null?'/day':' total'):'—')+'</td>'+
      '<td style="text-align:right;font-weight:600">'+inr(r.spend)+'</td>'+
      '<td style="text-align:right">'+cmpTrend(r.spend,r.pspend,false)+'</td>'+
      '<td style="text-align:right">'+num(r.leads)+'</td>'+
      '<td style="text-align:right">'+(r.cpl!=null?inr(r.cpl):'—')+' '+cmpTrend(r.cpl,r.pcpl,true)+'</td>'+
      '<td style="text-align:right">'+num(r.i.reach)+'</td>'+
      '<td style="text-align:right">'+(r.i.ctr!=null?Number(r.i.ctr).toFixed(2)+'%':'—')+'</td>'+
      '<td style="text-align:right">'+cmpFatigue(Number(r.i.frequency)||0,r.i.ctr,r.pctr)+'</td>'+
    '</tr>';}).join('')+
    '</tbody></table></div></div>'):'<div class="card card-pad empty" style="margin-top:14px"><i class="fa-solid fa-chart-line"></i><div>No campaign data for this period</div></div>';
  openModal(
    '<div class="modal-head"><div><div style="font-weight:700;font-size:16.5px">'+esc(acc.name)+'</div><div style="color:var(--slate);font-size:12.5px;margin-top:2px">'+esc(CMP_LAST.periodLabel)+' · '+rows.length+' campaign'+(rows.length===1?'':'s')+'</div></div><div class="x" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></div></div>'+
    '<div class="modal-body">'+mKpis([['Spend',inr(totalSpend),''],['Results (Leads)',num(totalLeads),''],['Cost / Lead',totalLeads?inr(totalSpend/totalLeads):'—','']])+tbl+'</div>',
    'lg'
  );
};
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
/* The numbered analytics tabs of the Our Brand page (formerly Campaign Analytics), one list per
   Meta / Google / Both source. Kept in one place because the Our Brand page's own extra tabs
   (Meta Ad Library, YouTube, Maps... - src/core/40-marketing-modules.js) redraw this same bar
   when one of them is open, and must show exactly the tabs the source would have shown, at the
   same numeric routes (campaigns/0, campaigns/1, ...) that USAGE_VIEWS and bookmarks already use. */
function cmpBaseTabs(){
  if(CMP_SOURCE==='google') return ['Overview','Accounts','Campaigns','Ads','Trend','Ad Fatigue'];
  if(CMP_SOURCE==='both') return ['Overview','Sources','Trend','Ad Fatigue'];
  return ['Overview','Campaigns','By Project','Ads','Trend','Ad Fatigue','AI Insights'];
}
async function cmpBothView(v,seg){
  const tabs=cmpBaseTabs();const ti=mTab(seg,tabs.length);
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
  v.innerHTML=cmpCss+CMP_EXTRA_CSS+mHead('fa-bullhorn','#db2777','Our Brand')+cmpSourceBar()+cmpPeriodBar()+cmpTabsBar(tabs,ti)+'<div style="margin-top:14px">'+(showKpis?kpiStrip:'')+legend+body+'</div>';
  cmpRunAlerts();
  if(ti===0&&window.Chart){setTimeout(function(){
    const opt={responsive:true,maintainAspectRatio:false,cutout:'60%',plugins:{legend:{position:'bottom',labels:{boxWidth:12,font:{size:12}}}}};
    try{new Chart(document.getElementById('bCh1'),{type:'doughnut',data:{labels:['Meta','Google'],datasets:[{data:[M.spend,Gg.spend],backgroundColor:['#1877f2','#ea4335'],borderWidth:2,borderColor:'#fff'}]},options:opt});}catch(e){}
    try{new Chart(document.getElementById('bCh2'),{type:'doughnut',data:{labels:['Meta','Google'],datasets:[{data:[M.res,Gg.res],backgroundColor:['#1877f2','#ea4335'],borderWidth:2,borderColor:'#fff'}]},options:opt});}catch(e){}
  },60);}
}
async function cmpGoogleView(v,seg){
  const tabs=cmpBaseTabs();const ti=mTab(seg,tabs.length);
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
  v.innerHTML=cmpCss+CMP_EXTRA_CSS+mHead('fa-bullhorn','#db2777','Our Brand')+cmpSourceBar()+cmpPeriodBar()+cmpTabsBar(tabs,ti)+'<div style="margin-top:14px">'+(showKpis?kpiStrip:'')+cap+legend+body+'</div>';
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
const TP_CSS='<style id="tpCss">.tp-lbl{font-size:11px;font-weight:600;text-transform:uppercase;color:var(--slate);letter-spacing:.04em}.tp-mp-row:hover,.tp-ref-row:hover{background:#f8fafc}</style>';
let TP_REF_RECORDS=null;

window.tpDownloadUrl=async function(url,filename){
  try{
    const res=await fetch(url);
    const blob=await res.blob();
    const objUrl=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=objUrl;a.download=filename;a.click();
    setTimeout(()=>URL.revokeObjectURL(objUrl),1000);
  }catch(e){toast('Download failed: '+(e&&e.message||e),'err');}
};
function tpApprovalTag(rec){
  const s=rec.approval_status||'Pending';
  if(s==='Approved')return '<span class="tag t-green"><i class="fa-solid fa-check"></i> Approved</span>';
  if(s==='Rejected')return '<span class="tag t-red"><i class="fa-solid fa-xmark"></i> Rejected</span>';
  return '<span class="tag t-amber"><i class="fa-solid fa-hourglass-half"></i> Pending Approval</span>';
}

/* Pending Approvals is no longer a Recruitment tab — a ManPower JD ready for review, or a Referral
   just submitted, now creates a real task in Accountability's own Pending Approval card instead
   (acc.hr_approval_task_upsert; the domain-specific Approve/Reject there live in accountability.js
   as hrTaskApproveManpower/hrTaskRejectManpower/hrTaskConnectReferral/hrTaskRejectReferral). */
/* Plain, professional one-column PDF of the AI-generated Job Description text (already the exact
   wording an approver is judging) -- reuses loadPdfLib(), the same lazy-loaded pdf-lib this app
   already uses for the Booking Form checklist / Welcome Letter / Allotment Letter, rather than
   adding new PDF infrastructure. Paginates plainly; this is an internal approval attachment, not a
   branded document, so no logo/letterhead. */
/* THE JAIN GROUP LETTERHEAD, for anything printed out of Recruitment.

   The logo ships as a .webp, which is right for a web page and no use to pdf-lib - it can embed
   PNG and JPEG and nothing else. Rather than commit a second copy of the same picture in a second
   format (two files to keep in step, and the one nobody remembers to replace is the one that goes
   out to candidates), the browser converts it: it can already decode webp to draw it on screen, so
   it is drawn onto a canvas and read back as PNG. Done once and kept, because the same logo goes on
   every page of every description.

   Returns null if anything goes wrong. A job description with no logo is a small disappointment; a
   job description that would not open at all because of the logo is a real problem. */
let JG_LOGO_PNG=null;
/* THE LOGO IS CARRIED IN THE FILE, NOT FETCHED AND CONVERTED.

   Three things went wrong with loading it from assets/ and converting it through a canvas, and
   each one failed silently into "no logo, PDF otherwise perfect":

     - crossOrigin='anonymous' turned a same-origin read into a CORS check, which a file:// page
       can never satisfy;
     - even without that, drawing a file:// image onto a canvas TAINTS the canvas, so toBlob
       throws - there is no way around that from a page opened off disk;
     - the source was webp, and pdf-lib embeds PNG and JPEG only, so the canvas step was not
       optional as long as the source stayed webp.

   So the logo is a PNG, base64 here, decoded straight to bytes. No network, no canvas, no format
   conversion, and it behaves the same on the live site and from a local file. It is 15KB on a
   1.8MB file. assets/jain-group-logo.png is the same image if it is ever needed elsewhere.

   To replace it: convert the new artwork to PNG, base64 it, and swap the string. */
const JG_LOGO_PNG_B64='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';
async function jgLogoPngBytes(){
  if(JG_LOGO_PNG!==null) return JG_LOGO_PNG||null;
  try{
    const bin=atob(JG_LOGO_PNG_B64);
    const out=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
    JG_LOGO_PNG=out;
    return JG_LOGO_PNG;
  }catch(_e){ JG_LOGO_PNG=false; return null; }
}

/* Builds a job description as a real PDF: letterhead, title, then the text laid out so it breaks
   across pages properly. Returns the bytes; what the caller does with them - open a tab, save a
   file - is the caller's business, so preview and download cannot drift into showing two different
   documents. */
/* ── THE DESCRIPTION IS RICH TEXT NOW, AND THE PDF HAS TO CARRY IT ─────────────────────────
   The editor lets people set bold, italic, underline, size, colour and typeface, so a PDF that
   threw all of that away and re-derived its own bold from a colon would be showing something
   nobody wrote. This reads the editor's HTML and draws it.

   It still accepts PLAIN TEXT, unchanged, because every description written before today is
   plain and so is everything the AI generates. With no tags in it the old rule applies - a short
   line ending in a colon is a heading - so old documents come out exactly as they did.

   Only the three PDF base-14 families exist, in four styles each, so a font nobody can embed is
   mapped to its nearest relative rather than silently dropped. */
function jdRgbToPdf(L, css){
  const s = String(css || '').trim();
  let m = s.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) return L.rgb(+m[1] / 255, +m[2] / 255, +m[3] / 255);
  m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return L.rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255,
                 parseInt(h.slice(4, 6), 16) / 255);
  }
  return null;
}
function jdFamilyKey(css){
  const f = String(css || '').toLowerCase();
  if (/times|georgia|serif/.test(f) && !/sans/.test(f)) return 'times';
  if (/courier|mono|consolas/.test(f)) return 'courier';
  return 'helvetica';
}
/* The style in force at one piece of text, worked out by walking up its ancestors. The editor
   writes inline styles (styleWithCSS), and the browser's own execCommand still emits B/I/U in
   places, so both are read. */
function jdStyleAt(node, stopAt){
  const st = { b: false, i: false, u: false, size: null, color: null, fam: null };
  for (let n = node.parentNode; n && n !== stopAt.parentNode; n = n.parentNode) {
    if (n.nodeType !== 1) continue;
    const tag = n.tagName;
    if (tag === 'B' || tag === 'STRONG') st.b = true;
    if (tag === 'I' || tag === 'EM') st.i = true;
    if (tag === 'U') st.u = true;
    const s = n.style || {};
    const fw = String(s.fontWeight || '');
    if (fw === 'bold' || fw === 'bolder' || (parseInt(fw, 10) >= 600)) st.b = true;
    if (String(s.fontStyle || '') === 'italic') st.i = true;
    const dec = String(s.textDecoration || '') + ' ' + String(s.textDecorationLine || '');
    if (dec.indexOf('underline') >= 0) st.u = true;
    if (st.size === null && s.fontSize) { const v = parseFloat(s.fontSize); if (isFinite(v)) st.size = v; }
    if (st.color === null && s.color) st.color = s.color;
    if (st.fam === null && s.fontFamily) st.fam = s.fontFamily;
  }
  return st;
}
/* One entry per paragraph, each a list of runs. A run is a stretch of text that shares one
   style, which is the unit the layout below can measure and draw. */
function jdParseBlocks(input){
  const raw = String(input || '');
  if (!/<[a-z!/]/i.test(raw)) {
    // Plain text, the way it has always been stored.
    return raw.split('\n').map(function (line) {
      const head = /:$/.test(line.trim()) && line.trim().length < 40;
      return [{ text: line, b: head, i: false, u: false, size: null, color: null, fam: null }];
    });
  }
  const dom = new DOMParser().parseFromString('<body>' + raw + '</body>', 'text/html');
  const body = dom.body;
  let tops = Array.prototype.filter.call(body.childNodes, function (n) {
    return n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim() !== '');
  });
  if (!tops.length) return [[{ text: '', b: false, i: false, u: false, size: null, color: null, fam: null }]];
  // Bare text with no wrapper is still one paragraph.
  if (!tops.some(function (n) { return n.nodeType === 1 && /^(DIV|P|LI|H[1-6])$/.test(n.tagName); })) {
    tops = [body];
  }
  const blocks = [];
  tops.forEach(function (top) {
    if (top.nodeType === 3) {
      blocks.push([{ text: top.textContent, b: false, i: false, u: false, size: null, color: null, fam: null }]);
      return;
    }
    // A <br> ends a line inside a block, so each one starts another paragraph. brSplit records
    // that the block already contributed something, so <div><br></div> - an empty paragraph, the
    // commonest thing in these documents - yields ONE blank paragraph and not two.
    let runs = [], brSplit = false;
    const walk = function (n) {
      if (n.nodeType === 3) {
        const t = n.textContent.replace(/ /g, ' ');
        if (t !== '') { const s = jdStyleAt(n, top); runs.push({ text: t, b: s.b, i: s.i, u: s.u, size: s.size, color: s.color, fam: s.fam }); }
        return;
      }
      if (n.nodeType !== 1) return;
      if (n.tagName === 'BR') { blocks.push(runs); runs = []; brSplit = true; return; }
      Array.prototype.forEach.call(n.childNodes, walk);
    };
    Array.prototype.forEach.call(top.childNodes, walk);
    if (runs.length || !brSplit) blocks.push(runs);
  });
  return blocks.map(function (r) {
    return r.length ? r : [{ text: '', b: false, i: false, u: false, size: null, color: null, fam: null }];
  });
}

async function jdBuildPdfBytes(title,bodyText){
  const L=await loadPdfLib(); if(!L)throw new Error('the PDF library could not be loaded');
  const doc=await L.PDFDocument.create();
  const S=L.StandardFonts;
  const FAM={
    helvetica:{r:await doc.embedFont(S.Helvetica), b:await doc.embedFont(S.HelveticaBold),
               i:await doc.embedFont(S.HelveticaOblique), bi:await doc.embedFont(S.HelveticaBoldOblique)},
    times:{r:await doc.embedFont(S.TimesRoman), b:await doc.embedFont(S.TimesRomanBold),
           i:await doc.embedFont(S.TimesRomanItalic), bi:await doc.embedFont(S.TimesRomanBoldItalic)},
    courier:{r:await doc.embedFont(S.Courier), b:await doc.embedFont(S.CourierBold),
             i:await doc.embedFont(S.CourierOblique), bi:await doc.embedFont(S.CourierBoldOblique)}
  };
  const bold=FAM.helvetica.b;
  const W=595.28,Hh=841.89,M=56,SIZE=10.5,LEAD_RATIO=15/10.5,MAXW=W-2*M;
  const pick=(r)=>FAM[r.fam?jdFamilyKey(r.fam):'helvetica'][r.b&&r.i?'bi':r.b?'b':r.i?'i':'r'];
  // The editor works in CSS pixels; a PDF works in points.
  const sizeOf=(r)=>r.size?Math.max(4,Math.min(72,r.size*0.75)):SIZE;

  let logo=null,logoDims=null;
  const png=await jgLogoPngBytes();
  if(png){ try{ logo=await doc.embedPng(png); logoDims=logo.scale(150/logo.width); }catch(_e){ logo=null; } }

  function wrapLine(text,font,size){
    const words=String(text||'').split(' ');const out=[];let cur='';
    words.forEach(w=>{const t=cur?cur+' '+w:w; if(font.widthOfTextAtSize(t,size)<=MAXW){cur=t;}else{if(cur)out.push(cur);cur=w;}});
    if(cur)out.push(cur); return out.length?out:[''];
  }
  /* THE LETTERHEAD IS ON THE FIRST PAGE ONLY, and so is the title - the editor shows it that way
     and the two have to agree or the preview is lying about where the text will fall. A
     continuation page starts at the top margin with the full column to itself. */
  let pageNo=0;
  function newPage(){
    const pg=doc.addPage([W,Hh]);
    let top=Hh-M;
    if(pageNo===0){
      if(logo&&logoDims){
        pg.drawImage(logo,{x:M,y:top-logoDims.height,width:logoDims.width,height:logoDims.height});
        top-=logoDims.height+10;
      }
      pg.drawLine({start:{x:M,y:top},end:{x:W-M,y:top},thickness:1.2,
                   color:L.rgb(0.88,0.07,0.11)});
      top-=24;
    }
    pageNo++;
    return {pg,y:top};
  }
  let {pg:page,y}=newPage();
  wrapLine(title||'Job Description',bold,15).forEach(function(l){
    page.drawText(l,{x:M,y,size:15,font:bold}); y-=21;
  });
  y-=8;

  /* EACH PARAGRAPH IS WRAPPED ACROSS LINES AS A SEQUENCE OF STYLED PIECES.

     Words are measured with their own run's font and size, so a sentence that turns bold halfway
     wraps in the right place instead of at the place it would have wrapped had it all been one
     font. A line's leading follows its tallest piece, so a 24pt word does not sit on top of the
     line above it. */
  const blocks=jdParseBlocks(bodyText);
  blocks.forEach(function(runs){
    // Split the runs into words, each word remembering the style it came from.
    const words=[];
    runs.forEach(function(r){
      const parts=String(r.text||'').split(/(\s+)/);
      parts.forEach(function(p){ if(p!=='') words.push({t:p,r:r,space:/^\s+$/.test(p)}); });
    });
    /* An empty paragraph takes the same room it always did - one line plus the 4pt the old
       builder added - so a description written before today prints at exactly the same length. */
    if(!words.length){ y-=SIZE*LEAD_RATIO+4; return; }

    let line=[], lineW=0;
    const flush=function(){
      if(!line.length) return;
      const maxSize=line.reduce(function(m,x){return Math.max(m,sizeOf(x.r));},SIZE);
      const lead=maxSize*LEAD_RATIO;
      if(y<M+24){ const np=newPage(); page=np.pg; y=np.y; }
      let x=M;
      line.forEach(function(x2){
        const f=pick(x2.r), sz=sizeOf(x2.r);
        const col=x2.r.color?jdRgbToPdf(L,x2.r.color):null;
        const wpx=f.widthOfTextAtSize(x2.t,sz);
        if(x2.t.trim()!==''){
          page.drawText(x2.t,Object.assign({x:x,y:y,size:sz,font:f},col?{color:col}:{}));
          if(x2.r.u){
            page.drawLine({start:{x:x,y:y-sz*0.12},end:{x:x+wpx,y:y-sz*0.12},
                           thickness:Math.max(0.4,sz*0.05)},
                          );
          }
        }
        x+=wpx;
      });
      y-=lead;
      line=[]; lineW=0;
    };
    words.forEach(function(wd){
      const f=pick(wd.r), sz=sizeOf(wd.r);
      const wpx=f.widthOfTextAtSize(wd.t,sz);
      if(lineW+wpx>MAXW && line.length){
        // never start a wrapped line with the space that caused the wrap
        flush();
        if(wd.space) return;
      }
      line.push(wd); lineW+=wpx;
    });
    flush();
  });
  return await doc.save();
}

// Opens bytes in a new tab, or saves them, from one place so both behave the same.
function jdPdfOpen(bytes,filename,download){
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
  if(download){
    const a=document.createElement('a');a.href=url;a.download=filename;
    document.body.appendChild(a);a.click();a.remove();
  } else {
    // Some browsers block a tab opened after an await; fall back to saving rather than doing nothing.
    const w=window.open(url,'_blank');
    if(!w){ const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
            toast('Your browser blocked the preview tab, so it was downloaded instead',''); }
  }
  setTimeout(function(){URL.revokeObjectURL(url);},60000);
}

/* EDITING THE DESCRIPTION FROM THE REQUEST IT BELONGS TO.

   Open used to build a PDF. A PDF is the right thing to send somebody and the wrong thing to be
   handed when the text is AI-written and nearly always needs a line changed - correcting it meant
   going to the Descriptions tab and finding it there, and while the request is still Pending its
   description is not even shown there, so there was no way to edit it at all.

   The text for a hiring request lives on hr.manpower_requests.ai_job_description, which is what
   the PDF is built from, so saving here is what changes the document everybody else sees. Where a
   recruit.job_descriptions row also exists for this request, it is kept in step - otherwise the
   Descriptions tab would show the old wording after an edit. */
window.mpJdEditOpen=async function(manpowerId){
  await tpEnsurePositions();
  const rec=(MP_RECORDS||[]).find(r=>r.id===manpowerId);
  if(!rec||!String(rec.ai_job_description||'').trim()){toast('No description to edit yet','err');return;}
  jdOpenEditorTab('Job Description \u2014 '+(rec.job_title||''), rec.ai_job_description||'',
    async function(text){
      const {error}=await sb.schema('hr').from('manpower_requests')
        .update({ai_job_description:String(text||'')}).eq('id',manpowerId);
      if(error) throw new Error(error.message);
      rec.ai_job_description=String(text||'');
      try{
        await sb.schema('recruit').from('job_descriptions')
          .update({content_text:String(text||'')}).eq('manpower_request_id',manpowerId);
      }catch(_e){ /* the request's own copy is the one the PDF is built from */ }
      toast('Job description saved');
    });
};

window.hrJdPdfDownload=async function(manpowerId,download){
  await tpEnsurePositions();
  const rec=(MP_RECORDS||[]).find(r=>r.id===manpowerId);
  if(!rec||!rec.ai_job_description){toast('No description to show yet','err');return;}
  try{
    const bytes=await jdBuildPdfBytes('Job Description \u2014 '+(rec.job_title||''),rec.ai_job_description);
    jdPdfOpen(bytes,((rec.job_title||'job-description').replace(/[^A-Za-z0-9 ()-]/g,'').trim()||'job-description')+'.pdf',!!download);
  }catch(e){toast('Could not build the PDF: '+((e&&e.message)||e),'err');}
};

/* ── ManPower Form v2 (approval workflow + AI-content preview) ── */
/* ALWAYS READ FRESH. This used to keep MP_RECORDS for the life of the page and only fetch when it
   was empty - which is fine for a list nothing else changes, and wrong for this one. Approving a
   hiring request happens in Accountability, on another screen; coming back here showed the copy
   loaded before the approval, still saying Pending, with no way to tell it was stale. The database
   was right the whole time and the page was reporting an old answer as a current one.

   A list of open positions is small and read rarely. Caching it saved nothing worth this. */
async function tpManpower(){
  const b=$('recBody');
  if(!MP_RECORDS) b.innerHTML='<div class="empty" style="padding:40px"><i class="fa-solid fa-spinner fa-spin"></i></div>';
  try{
    const {data,error}=await sb.schema('hr').from('manpower_requests').select('*').order('submitted_at',{ascending:false});
    if(error)throw error;
    MP_RECORDS=data||[];
  }catch(e){
    // Keep whatever was on screen if the refresh fails - an empty list would read as "everything
    // was deleted", which is a worse lie than a slightly old one.
    if(!MP_RECORDS){ b.innerHTML='<div class="empty" style="padding:40px;color:#c83232">'+esc(e.message)+'</div>'; return; }
    toast('Could not refresh the list: '+((e&&e.message)||e),'err');
  }
  await tpMpLoadApplied();
  tpMpRender();
}

/* HOW MANY PEOPLE HAVE ALREADY APPLIED FOR EACH POSITION.

   Read here rather than per row, because the Edit button has to know before anybody clicks it -
   a button that looks live and then refuses is worse than one that is plainly switched off.
   Only fetched for people who can edit; everybody else never sees the button. A failure leaves
   the map empty, which unlocks Edit rather than locking everything - the database refuses the
   edit anyway, so the worst case is a clear error instead of a silent wrong state. */
let TP_MP_APPLIED={};
/* CANDIDATES ON EACH POSITION, AND HOW MANY HAVE BEEN MOVED PAST "APPLIED".
   Two more things hang on this now: whether clicking the row has anywhere to go, and whether the
   request may still be deleted. Most candidates carry no manpower_request_id - they were entered
   straight into Interviews - so the position is matched on the job title as well, compared
   without case. Read for everybody rather than only for people who can edit, because the row
   click is not an edit; if the read fails the map stays empty, rows simply do not open and
   nothing is deleted by accident. */
let TP_MP_CAND={};
function tpMpCandOf(id){ return TP_MP_CAND[id]||{n:0,started:0}; }
/* Counted by the database (hr.request_candidate_counts), not read from hr.candidates here: the
   person who raised a request cannot read candidates - that is HR's - but they still have to be
   told that their request is locked. The same count is what the database itself refuses on. */
async function tpMpLoadApplied(){
  TP_MP_APPLIED={}; TP_MP_CAND={};
  (MP_RECORDS||[]).forEach(function(r){ TP_MP_CAND[r.id]={n:0,started:0}; });
  try{
    const {data,error}=await sb.schema('hr').rpc('request_candidate_counts');
    if(error) throw error;
    (data||[]).forEach(function(c){
      const slot=TP_MP_CAND[c.manpower_request_id]; if(!slot) return;
      slot.n=Number(c.n)||0;
      TP_MP_APPLIED[c.manpower_request_id]=slot.n;
    });
  }catch(_e){ /* leave it empty - see above */ }
}
/* WHO MAY EDIT OR DELETE A REQUEST: HR, and whoever raised it - and nobody once a candidate is on
   it. The person who asked for the hire can still correct or withdraw it until it is under way. */
function tpMpMine(r){ return !!r && String(r.raised_by||'').trim().toLowerCase()===String(state.email||'').trim().toLowerCase(); }
function tpMpCanChange(r){ return !!r && (recCanWrite()||tpMpMine(r)); }
function tpMpRender(){
  const b=$('recBody'); if(!b)return;
  const rows=MP_RECORDS||[];
  const canOpen=recCanWrite();
  // The tick column and Edit/Delete are for anybody who may change at least one row on the list.
  const canTick=canOpen||rows.some(tpMpMine);
  /* Ticks that no longer match a visible row are dropped, so deleting a request cannot leave a
     phantom in the count. */
  TP_MP_SEL=new Set([...TP_MP_SEL].filter(id=>rows.some(r=>r.id===id&&tpMpCanChange(r))));
  const nSel=TP_MP_SEL.size;
  /* A POSITION WITH ANYBODY ON IT CANNOT BE DELETED, and the button says so before it is pressed.
     Deleting it would leave people mid-process for a job that no longer exists anywhere. */
  const delBlocked=[...TP_MP_SEL].filter(id=>tpMpCandOf(id).n>0)
    .map(id=>(rows.find(r=>r.id===id)||{}).job_title||('#'+id));
  const priTag=p=>p==='Urgent'?'<span class="tag t-red">Urgent</span>':'<span class="tag t-gray">'+(p||'—')+'</span>';
  b.innerHTML=TP_NOTE_CSS+`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
    <div class="sec-title" style="margin:0">Hiring Requests <span class="tag t-gray" style="margin-left:4px">${rows.length}</span></div>
    <!-- EDIT AND DELETE LIVE HERE, ON A SELECTION, NOT INSIDE EACH REQUEST.
         They used to sit on the detail panel, which meant opening a request to delete it - reading
         a thing in order to throw it away. Tick and act instead. Edit needs exactly one (there is
         nothing sensible to show when two are ticked); Delete takes as many as are ticked. -->
    <!-- ALWAYS DRAWN, SWITCHED OFF UNTIL SOMETHING IS TICKED.
         They used to appear only once a box was ticked, which makes the toolbar jump and, worse,
         hides the fact that ticking a row is what these are for - you cannot look for a button
         that is not there. Greyed out they explain themselves: the control is visible, the reason
         it cannot be pressed is in the tooltip, and the row does not move when it becomes live.
         Edit takes exactly one, because there is nothing sensible to show for two at once. -->
    <div style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      ${canTick?(function(){
        /* A POSITION WITH APPLICANTS CANNOT BE EDITED, AND THE BUTTON SAYS SO BEFORE IT IS CLICKED.
           People applied to the role as it was written; changing the title or the pay afterwards
           would quietly turn them into candidates for something else. The database refuses it too
           - this is the half that explains itself. */
        const selId=nSel===1?[...TP_MP_SEL][0]:null;
        const applied=selId!=null?(TP_MP_APPLIED[selId]||0):0;
        const canEditSel=nSel===1&&applied===0;
        const why=nSel!==1 ? 'Tick exactly one request to edit it'
          : applied ? ('Locked — '+applied+' candidate'+(applied===1?' has':'s have')+' already applied for this position')
          : 'Edit the ticked request';
        return `<span style="font-size:12px;color:var(--slate)">${nSel?(nSel+' selected'):'Tick a row to edit or delete'}</span>
        <button class="btn" ${canEditSel?'':'disabled style="opacity:.45;cursor:not-allowed"'}
          title="${why}"
          onclick="tpMpEditSel()">${applied&&nSel===1?'<i class="fa-solid fa-lock"></i>':'<i class="fa-solid fa-pen"></i>'} Edit</button>`;
      })()+`
        <button class="btn" ${nSel&&!delBlocked.length?'style="color:var(--err);border-color:var(--err)"':'disabled style="opacity:.45;cursor:not-allowed"'}
          title="${delBlocked.length?('Locked \u2014 '+delBlocked.join(', ')+' already has candidates')
            :(nSel?('Delete the '+nSel+' ticked request'+(nSel===1?'':'s')):'Tick at least one request to delete it')}"
          onclick="tpMpDeleteSel()">${delBlocked.length?'<i class="fa-solid fa-lock"></i>':'<i class="fa-solid fa-trash"></i>'} Delete</button>`:''}
      <button class="btn btn-primary" onclick="tpMpFillForm()"><i class="fa-solid fa-plus"></i> New Request</button>
    </div>
  </div>
  <!-- There used to be no Open button: the row itself was clickable, and the only hint was the
       mouse cursor changing. Nobody discovers that, and nothing on screen said a panel would
       appear, so the request looked like a dead list. The action is now a button that says Open. -->
  <div style="font-size:12px;color:var(--slate);margin-bottom:12px">${canOpen?'Click a request to open it below. <b>Details</b> shows the candidates on that position.':'Anyone can raise a request here. You can edit or delete your own until a candidate is on it.'}</div>
  <div style="overflow-x:auto">
  <table class="tbl" id="tpMpTbl">
    <!-- COLUMNS CHOSEN FOR WHAT SOMEBODY SCANS THIS LIST TO FIND OUT: which job, for which
         department, where, who asked, and has it been approved. Vacancy count and Priority were
         columns of their own and neither answers a question anybody asks of a list - the count
         matters once you open the request, and Priority only matters when it is Urgent. So Urgent
         now rides next to the job title as a red chip, where it is more visible than a column of
         mostly "Not Urgent", and both columns are gone. Location and Raised By took their place.
         Status went the same way: a description written for a position is published and linked
         straight away, so there is no approval left for a column to report. -->
    <thead><tr>${canTick?'<th style="width:34px;text-align:center"><input type="checkbox" onchange="tpMpToggleAll(this)"></th>':''}<th>Job Title</th><th>Department</th><th>Location</th><th>Raised By</th><th>Date</th>${canOpen?'<th style="width:90px"></th>':''}</tr></thead>
    <!-- CLICKING A ROW SHOWS THE PEOPLE ON THAT POSITION, the same way a Monthly Progress row
         does. A hiring request is a position, and the question you usually have of one is "who
         have we got for it" - which meant going to Interviews and filtering by hand. The tick box
         and the Details button keep their own jobs and stop the click reaching the row. -->
    <!-- A POSITION WITH NOBODY ON IT DOES NOT OPEN. It used to go to an empty filtered list,
         which reads as a broken screen rather than as "no applicants yet" - so the row stays put
         and the tooltip says why. -->
    <!-- THE ROW OPENS THE REQUEST; DETAILS OPENS ITS CANDIDATES. Clicking the row shows the request
         in the section below the table (HR only). The Details button takes you to Interviews,
         filtered to this position, and is switched off while nobody is on it. -->
    <tbody>${rows.length?rows.map(r=>{const cd=tpMpCandOf(r.id);return `<tr class="tp-mp-row${canOpen?' tp-mp-click':''}" data-id="${r.id}"
      ${canOpen?`onclick="tpMpShowDetail(${r.id})"`:''}
      title="${canOpen?'Open this request below':''}">
      ${canTick?`<td style="text-align:center" onclick="event.stopPropagation()">${tpMpCanChange(r)?`<input type="checkbox" class="tp-mp-cb" value="${r.id}"${TP_MP_SEL.has(r.id)?' checked':''} onchange="tpMpPick(${r.id},this.checked)">`:''}</td>`:''}
      <td style="font-weight:600">${esc(r.job_title||'—')}${r.priority==='Urgent'?' <span class="tag t-red" style="font-size:10px">Urgent</span>':''}</td>
      <td>${esc(r.department||'—')}</td>
      <td style="font-size:12px">${esc(r.location||'—')}</td>
      <td style="font-size:12px;color:var(--slate);overflow-wrap:anywhere">${esc(r.raised_by||'—')}</td>
      <td style="color:var(--slate);font-size:12px;white-space:nowrap">${esc(mpFmtDate(r.date_of_request))}</td>
      ${canOpen?`<td style="text-align:right" onclick="event.stopPropagation()"><button class="btn btn-sm" style="font-size:12px${cd.n?'':';opacity:.45;cursor:not-allowed'}" ${cd.n?'':'disabled'}
        title="${cd.n?('See the '+cd.n+' candidate'+(cd.n===1?'':'s')+' on '+esc(r.job_title||'this position')):'Nobody is on this position yet'}"
        onclick="tpMuOpenPeople(${esc(JSON.stringify(r.job_title||''))})"><i class="fa-solid fa-users"></i> Details</button></td>`:''}
    </tr>`;}).join(''):`<tr><td colspan="${(canTick?1:0)+5+(canOpen?1:0)}" style="text-align:center;padding:40px;color:var(--slate)">No hiring requests yet — click <b>New Request</b> to raise one</td></tr>`}
    </tbody>
  </table>
  </div>
  <div id="tpMpDetail" style="display:none"></div>`;
}
let TP_MP_SEL=new Set();
window.tpMpPick=function(id,on){ if(on)TP_MP_SEL.add(id); else TP_MP_SEL.delete(id); tpMpRender(); };
window.tpMpToggleAll=function(el){
  if(el.checked)(MP_RECORDS||[]).filter(tpMpCanChange).forEach(r=>TP_MP_SEL.add(r.id)); else TP_MP_SEL.clear();
  tpMpRender();
};
window.tpMpEditSel=function(){
  const id=[...TP_MP_SEL][0]; if(id==null){toast('Tick a request first','err');return;}
  if(!tpMpCanChange((MP_RECORDS||[]).find(r=>r.id===id))){toast('Only HR or whoever raised this request can edit it','err');return;}
  // The button is already disabled for this; the check is here for a screen left open while
  // somebody else's application landed.
  const applied=TP_MP_APPLIED[id]||0;
  if(applied){
    toast('This position cannot be edited — '+applied+' candidate'+(applied===1?' has':'s have')
          +' already applied for it','err');
    return;
  }
  mpEdit(id);
};
window.tpMpDeleteSel=async function(){
  const ids=[...TP_MP_SEL]; if(!ids.length){toast('Tick a request first','err');return;}
  if(ids.some(id=>!tpMpCanChange((MP_RECORDS||[]).find(r=>r.id===id)))){toast('Only HR or whoever raised a request can delete it','err');return;}
  // The button is already switched off for this; the check is here for a screen left open while
  // somebody's application landed. The database refuses it as well.
  const held=ids.filter(id=>tpMpCandOf(id).n>0)
    .map(id=>((MP_RECORDS||[]).find(r=>r.id===id)||{}).job_title||('#'+id));
  if(held.length){
    toast('Cannot delete '+held.join(', ')+' \u2014 '
          +(held.length===1?'it already has':'they already have')+' candidates','err');
    return;
  }
  /* Says what else goes, because it is not obvious: the approval tasks are about the request and
     follow it down. The job description does NOT - it is a document in its own right and keeps
     existing, unlinked. */
  /* JainE's own dialog, not the browser's. A window.confirm looks like the page has been taken
     over by something else, cannot say which records are going, and on some browsers carries a
     "prevent this page from creating more dialogs" tick that silently disables every later one. */
  if(!await confirmDialog(
      'Delete '+ids.length+' hiring request'+(ids.length===1?'':'s')+'? Their approval tasks will be '
      +'cancelled. Any job description written for them stays in the library.',
      {title:'Delete hiring request'+(ids.length===1?'':'s'), okLabel:'Delete', icon:'fa-trash', danger:true}))return;
  const {error}=await sb.schema('hr').from('manpower_requests').delete().in('id',ids);
  if(error){toast('Could not delete: '+error.message,'err');return;}
  MP_RECORDS=(MP_RECORDS||[]).filter(r=>!ids.includes(r.id));
  TP_MP_SEL=new Set();
  const det=$('tpMpDetail'); if(det)det.style.display='none';
  toast(ids.length+' deleted','ok');
  tpMpRender();
};
window.tpMpFillForm=function(){
  // Open to everyone — this is the "raise a need" side of the approval workflow, not a write-guarded action.
  mpModal('Hiring Request',null,'<button class="btn btn-primary" id="mpSaveBtn" onclick="tpMpSave()"><i class="fa-solid fa-check"></i> Submit</button>');
};
window.tpMpSave=async function(){
  const d=mpCollect();
  if(!d.job_title){toast('Job Title is required','err');return;}
  d.raised_by=state.email||'';
  const btn=$('mpSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const {data,error}=await sb.schema('hr').from('manpower_requests').insert(d).select().single();
  if(error){toast(error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Submit';}return;}
  MP_RECORDS=[data,...(MP_RECORDS||[])];closeModal();
  toast(data.approval_status==='Approved'?'Hiring request submitted and approved':'Hiring request submitted — HR has been asked to approve it');
  tpMpRender();
  // Fire the AI JD/Description/Creative generation in the background — the submitter doesn't need
  // to wait or have write access for this; it's just drafting content, not an approval action.
  sb.functions.invoke('manpower-ai-generate',{body:{request_id:data.id,requested_by:state.email||''}}).then(({data:gen,error})=>{
    const rec=(MP_RECORDS||[]).find(r=>r.id===data.id);if(!rec)return;
    if(error||!gen||gen.error){rec.ai_status='failed';return;}
    rec.ai_status='ready';rec.ai_job_description=gen.job_description;rec.ai_job_description_json=gen.job_description_json;rec.ai_platform_post_text=gen.platform_post_text;rec.ai_creative_path=gen.creative_path;
    /* NO EMAIL ANY MORE (27 Oct 2026). A new description used to be mailed to HR here; the
       approval task in Accountability already tells them, so the mail was a second copy of the
       same news. */
  });
};
/* thejaingroup.com does NOT serve this repo (confirmed live: career-position.html there falls back
   to the homepage) — but GitHub Pages does, confirmed live at this exact URL, serving the exact
   file just pushed. Swap this one constant if/when a custom domain is actually wired up to it. */
const CAREERS_BASE_URL='https://codingfuriosa.github.io/JainGroup';
function tpCareersLink(slug){ return CAREERS_BASE_URL+'/career-position.html?slug='+encodeURIComponent(slug||''); }
window.tpMpShowDetail=function(id){
 try{
  /* OPENING A ROW IS NOT FOR EVERYONE. Anyone may raise a requisition, and anyone may see the
     list of what has been raised - that is the point of a shared form. What sits behind the row
     is a different matter: the AI-written job description, the approval and rejection reasons,
     and the live Careers Page link, which is a public URL that puts the position on the
     internet the moment it is shared. That belongs to HR, Abhay Mati and Administrators. The
     rows are also drawn without a pointer for everyone else, so it does not merely fail on a
     click - it never looks clickable. */
  if(!recCanWrite()){
    toast('Only HR, Abhay Mati and Administrators can open a hiring request','err');
    return;
  }
  const rec=(MP_RECORDS||[]).find(r=>r.id===id);
  if(!rec){toast('Could not find hiring request #'+id+' — try refreshing the page','err');console.error('tpMpShowDetail: no record with id',id,'in MP_RECORDS',MP_RECORDS);return;}
  const panel=$('tpMpDetail');
  if(!panel){toast('Detail panel container missing from the page — try refreshing','err');console.error('tpMpShowDetail: #tpMpDetail not found in DOM');return;}
  document.querySelectorAll('.tp-mp-row').forEach(tr=>tr.style.background='');
  const activeRow=document.querySelector('.tp-mp-row[data-id="'+id+'"]');
  if(activeRow)activeRow.style.background='#fdf4f6';
  panel.style.display='block';
  const canAct=recCanWrite(), pending=(rec.approval_status||'Pending')==='Pending';
  const priTag=p=>p==='Urgent'?'<span class="tag t-red">Urgent</span>':'<span class="tag t-gray">'+(p||'—')+'</span>';
  /* THE PANEL WAS SIX BUTTONS AND A TITLE FIGHTING FOR ONE ROW, WITH THE WAY OUT AS A GREY ×.

     Approve, Reject, Edit and Delete all sat together at the same size and weight, so the one
     thing you came to do looked exactly like the one thing you must not do by accident. The close
     control was an 18px × floated over the corner - the smallest thing on a panel that fills the
     screen, and the only way back to the list.

     Now: a bar across the top that says what you are looking at and carries a real Close button
     with a word on it. Under it, one row of actions where Approve is the only filled button and
     Delete is pushed to the far right, away from everything else. Then plain sections with
     headings, so the panel reads in an order instead of all at once. */
  panel.innerHTML=`<div class="card card-pad" style="margin-top:14px">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-bottom:12px;border-bottom:2px solid var(--line)">
      <button class="btn btn-sm" style="font-weight:600" onclick="tpMpCloseDetail()"><i class="fa-solid fa-arrow-left"></i> Close</button>
      <div style="flex:1;min-width:220px">
        <div style="font-size:18px;font-weight:700;color:var(--ink)">${esc(rec.job_title||'—')}</div>
        <div style="color:var(--slate);font-size:13px;margin-top:2px">${esc(rec.department||'—')} &nbsp;·&nbsp; ${mpFmtDate(rec.date_of_request)} &nbsp;·&nbsp; raised by ${esc(rec.raised_by||'—')}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${priTag(rec.priority)}${tpApprovalTag(rec)}</div>
    </div>
    <!-- APPROVING DOES NOT HAPPEN HERE ANY MORE.

         A hiring request already raises a Pending Approval task for each approver in Accountability,
         which is where every other approval in JAIN-E is worked. Having Approve and Reject ALSO sit
         on this panel meant two places to do one job, and the two could disagree: approve it here
         and the task stayed open, waiting for somebody who had already decided. One queue, one
         decision. This panel is now for reading the request.

         What is left is Edit and Delete, and they are not peers - Edit is the ordinary thing and
         Delete is the one you cannot undo. They are separated, weighted differently, and Delete is
         a proper bordered button rather than red text, which read as a label rather than a control. -->
    <!-- Edit and Delete moved to the toolbar, on a tick. Opening a request in order to delete it
         meant reading a thing to throw it away, and put the most destructive control on the screen
         you land on after a click. -->
    ${pending?`<div style="margin-top:10px;font-size:12.5px;color:var(--slate);background:#f8fafc;border:1px solid var(--line);border-radius:8px;padding:9px 12px">
      <i class="fa-solid fa-circle-info"></i> Waiting for approval — approve or reject it from <b>Accountability › Pending Approval</b>.
    </div>`:''}
    ${rec.approval_status==='Rejected'&&rec.rejection_reason?`<div style="margin-top:10px;padding:10px 14px;background:#fef2f2;border-radius:8px;border:1px solid #fecaca"><span style="font-size:11px;font-weight:700;text-transform:uppercase;color:#b91c1c">Rejection reason · </span><span style="font-size:13px;color:#7f1d1d">${esc(rec.rejection_reason)}</span></div>`:''}
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">
      <div style="font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--slate);margin-bottom:10px">The request</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px 20px">
      <div><div class="tp-lbl">Vacancies</div><div style="font-size:14px;margin-top:2px">${esc(String(rec.no_of_vacancy||'—'))}</div></div>
      <div><div class="tp-lbl">Reporting To / HOD</div><div style="font-size:14px;margin-top:2px">${esc(rec.reporting_person||'—')}</div></div>
      <div><div class="tp-lbl">Qualification</div><div style="font-size:14px;margin-top:2px">${esc(rec.qualification||'—')}</div></div>
      <div><div class="tp-lbl">Experience</div><div style="font-size:14px;margin-top:2px">${esc(rec.experience||'—')}</div></div>
      <div><div class="tp-lbl">Gender</div><div style="font-size:14px;margin-top:2px">${esc(rec.gender||'—')}</div></div>
      <div><div class="tp-lbl">Salary Range</div><div style="font-size:14px;margin-top:2px">${esc(rec.salary_range||'—')}</div></div>
      <div><div class="tp-lbl">Location</div><div style="font-size:14px;margin-top:2px">${esc(rec.location||'—')}</div></div>
    </div>
    ${rec.job_description?`<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)"><div class="tp-lbl" style="margin-bottom:6px">Job Description / KPI (as filled in the form)</div><div style="font-size:13.5px;white-space:pre-wrap;line-height:1.6;color:var(--ink)">${esc(rec.job_description)}</div></div>`:''}
    ${rec.notes?`<div style="margin-top:12px;padding:10px 14px;background:#fefce8;border-radius:8px;border:1px solid #fde68a"><span style="font-size:11px;font-weight:700;text-transform:uppercase;color:#a16207">Note · </span><span style="font-size:13px;color:#78350f">${esc(rec.notes)}</span></div>`:''}
    <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--line)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--slate)">Job description</span>
        ${rec.ai_status==='generating'?'<span class="tag t-amber"><i class="fa-solid fa-spinner fa-spin"></i> Generating…</span>':''}
        ${rec.ai_status==='failed'?'<span class="tag t-red">Generation failed</span>':''}
        <!-- The generate button used to sit up here on its own, at the far end of a heading row,
             while Open and Download sat in the card below it. Three buttons about one document,
             in two places. It has moved down beside them. -->
      </div>
      <!-- THE SENTENCE AND THE BUTTONS SHARE A LINE. They were stacked, under an empty label, so
           three rows of card were spent saying one thing. The sentence explains what the buttons
           are for, so it belongs beside them, not above them. -->
      <div class="card" style="padding:12px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:200px;font-size:12.5px;color:var(--slate)">${rec.ai_job_description
            ? '<i class="fa-solid fa-file-lines"></i> A job description has been written for this position.'
            : 'No job description has been written yet.'}</div>
          <div style="display:flex;gap:6px;flex:none;flex-wrap:wrap">
            ${rec.ai_job_description?`
            <button class="btn btn-sm" onclick="mpJdEditOpen(${rec.id})"><i class="fa-solid fa-pen"></i> Open</button>
            <button class="btn btn-sm" onclick="hrJdPdfDownload(${rec.id},true)"><i class="fa-solid fa-download"></i> Download</button>`:''}
            ${canAct&&rec.ai_status!=='generating'?`<button class="btn btn-sm${rec.ai_job_description?'':' btn-primary'}" onclick="tpMpGenerate(${rec.id})"><i class="fa-solid fa-wand-magic-sparkles"></i> ${rec.ai_job_description?'Regenerate':'Generate with AI'}</button>`:''}
          </div>
        </div>
        <!-- The full text used to be printed below this, 260px of scrolling prose in the middle of
             a panel about a hiring request. Nobody reads a job description in a scroll box, and it
             buried everything under it. It is a document: the line above says whether one exists,
             and Open puts it in a tab where it can actually be read. -->
      </div>
      ${rec.ai_job_description_json?`<div class="card" style="padding:12px;margin-top:12px">
        <div style="font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--slate);margin-bottom:8px">Careers page</div>
        ${rec.status==='Open'?`
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input class="ac-in" readonly style="flex:1;min-width:220px;font-family:ui-monospace,Consolas,monospace;font-size:12.5px;background:#f8fafc;border:1px solid var(--line);border-radius:8px;padding:8px 10px;color:#0369a1" value="${esc(tpCareersLink(rec.slug))}" onclick="this.select()">
            <button class="btn btn-sm" onclick="navigator.clipboard.writeText('${esc(tpCareersLink(rec.slug))}');toast('Link copied')"><i class="fa-solid fa-copy"></i> Copy</button>
            <button class="btn btn-sm" style="color:var(--err);border-color:var(--err)" onclick="tpMpCloseHiring(${rec.id})"><i class="fa-solid fa-lock"></i> Close Hiring</button>
          </div>
          <div style="font-size:11px;color:var(--slate);margin-top:6px">Live now — anyone with this link can apply. Closing hiring takes the page down.</div>`
        :`<div style="font-size:12.5px;color:var(--slate)">Hiring is closed for this position — its page is no longer live.</div>
          <button class="btn btn-sm btn-primary" style="margin-top:8px" onclick="tpMpReopenHiring(${rec.id})"><i class="fa-solid fa-unlock"></i> Reopen Hiring</button>`}
      </div>`:`<div style="font-size:11.5px;color:var(--slate);margin-top:10px"><i class="fa-solid fa-circle-info"></i> The careers page link appears here once a job description has been written \u2014 use <b>Generate with AI</b> above.</div>`}
    </div>
  </div>`;
  panel.scrollIntoView({behavior:'smooth',block:'nearest'});
 }catch(e){
  console.error('tpMpShowDetail threw:',e);
  toast('Could not open that hiring request: '+(e&&e.message||e),'err');
 }
};
window.tpMpGenerate=async function(id){
  if(!recGuard())return;
  const rec=(MP_RECORDS||[]).find(r=>r.id===id);if(!rec)return;
  rec.ai_status='generating';tpMpShowDetail(id);
  const {data,error}=await sb.functions.invoke('manpower-ai-generate',{body:{request_id:id,requested_by:state.email||''}});
  if(error||!data||data.error){
    toast((error&&error.message)||(data&&data.error)||'Generation failed','err');
    rec.ai_status='failed';tpMpShowDetail(id);return;
  }
  rec.ai_status='ready';rec.ai_job_description=data.job_description;rec.ai_job_description_json=data.job_description_json;rec.ai_platform_post_text=data.platform_post_text;rec.ai_creative_path=data.creative_path;
  toast('Generated');tpMpShowDetail(id);
};
window.tpMpCloseDetail=function(){const p=$('tpMpDetail');if(p)p.style.display='none';document.querySelectorAll('.tp-mp-row').forEach(tr=>tr.style.background='');};
window.tpMpApprove=async function(id){if(!recGuard())return;
  const {data,error}=await sb.schema('hr').from('manpower_requests').update({approval_status:'Approved',approved_by:state.email,approved_at:new Date().toISOString(),rejection_reason:null}).eq('id',id).select().single();
  if(error){toast(error.message,'err');return;}
  const idx=(MP_RECORDS||[]).findIndex(r=>r.id===id); if(idx>-1)MP_RECORDS[idx]=data;
  toast('Approved');tpMpRender();tpMpShowDetail(id);
};
/* Opening/closing hiring reuses hr.set_hiring_open exactly as it always did — that RPC already
   flips status Open/Filled and is what hr.public_position (and so career-apply / career-position.html)
   gates on, so this is the real "take the page down" switch, not just a label change here. */
window.tpMpCloseHiring=async function(id){
  if(!await confirmDialog('Close hiring for this position? Its Careers Page will stop accepting applications immediately.',
      {title:'Close hiring', okLabel:'Close Hiring', icon:'fa-lock'}))return;
  try{
    // rpc() reports a refusal in {error}; it does not throw, so it has to be looked at.
    const {error}=await sb.schema('hr').rpc('set_hiring_open',{p_manpower_id:id,p_open:false});
    if(error) throw new Error(error.message);
    const idx=(MP_RECORDS||[]).findIndex(r=>r.id===id); if(idx>-1)MP_RECORDS[idx].status='Filled';
    toast('Hiring closed');tpMpRender();tpMpShowDetail(id);
  }catch(e){toast('Could not close hiring: '+((e&&e.message)||e),'err');}
};
window.tpMpReopenHiring=async function(id){
  try{
    const {error}=await sb.schema('hr').rpc('set_hiring_open',{p_manpower_id:id,p_open:true});
    if(error) throw new Error(error.message);
    const idx=(MP_RECORDS||[]).findIndex(r=>r.id===id); if(idx>-1)MP_RECORDS[idx].status='Open';
    toast('Hiring reopened');tpMpRender();tpMpShowDetail(id);
  }catch(e){toast('Could not reopen hiring: '+((e&&e.message)||e),'err');}
};
window.tpMpReject=function(id){if(!recGuard())return;
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-xmark"></i> Reject Hiring Request</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm"><label>Reason (optional, shown to the requester)</label><textarea id="tpRejReason" class="inp" rows="3" placeholder="Why is this being rejected?"></textarea></div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" style="background:var(--err);border-color:var(--err)" onclick="tpMpRejectConfirm(${id})"><i class="fa-solid fa-xmark"></i> Reject</button></div>`);
};
window.tpMpRejectConfirm=async function(id){
  const reason=($('tpRejReason')||{}).value?.trim()||null;
  const {data,error}=await sb.schema('hr').from('manpower_requests').update({approval_status:'Rejected',approved_by:state.email,approved_at:new Date().toISOString(),rejection_reason:reason}).eq('id',id).select().single();
  if(error){toast(error.message,'err');return;}
  const idx=(MP_RECORDS||[]).findIndex(r=>r.id===id); if(idx>-1)MP_RECORDS[idx]=data;
  closeModal();toast('Rejected — regenerating the description with your reason');tpMpRender();tpMpShowDetail(id);
  // Reject implies the draft needs to change, not just be recorded as refused -- regenerate right
  // away with the reason folded in, then (on success) manpower-ai-generate itself flips the row
  // back to Pending so the approver reviews a fresh version instead of a dead rejected one.
  if(reason){
    const rec=(MP_RECORDS||[]).find(r=>r.id===id);
    sb.functions.invoke('manpower-ai-generate',{body:{request_id:id,requested_by:state.email||'',rejection_reason:reason}}).then(({data:gen,error})=>{
      const rec2=(MP_RECORDS||[]).find(r=>r.id===id);if(!rec2)return;
      if(error||!gen||gen.error){rec2.ai_status='failed';tpMpRender();return;}
      rec2.ai_status='ready';rec2.ai_job_description=gen.job_description;rec2.ai_job_description_json=gen.job_description_json;
      rec2.ai_platform_post_text=gen.platform_post_text;rec2.ai_creative_path=gen.creative_path;
      if(gen.reset_to_pending){rec2.approval_status='Pending';rec2.rejection_reason=null;}
      tpMpRender();
    });
    if(rec)rec.ai_status='generating';
  }
};
window.tpMpDeleteOne=async function(id){if(!recGuard())return;
  const started=tpMpCandOf(id).started;
  if(started){
    toast('This position cannot be deleted \u2014 '+started+' candidate'
          +(started===1?' has':'s have')+' already started their stages','err');
    return;
  }
  if(!await confirmDialog('Delete this hiring request?'))return;
  const {error}=await sb.schema('hr').from('manpower_requests').delete().eq('id',id);
  if(error){toast(error.message,'err');return;}
  MP_RECORDS=(MP_RECORDS||[]).filter(r=>r.id!==id);
  tpMpCloseDetail();toast('Deleted');tpMpRender();
};

/* ── Referral Tab ── */
async function tpReferrals(){
  const b=$('recBody');
  b.innerHTML='<div class="empty" style="padding:40px"><i class="fa-solid fa-spinner fa-spin"></i></div>';
  try{const {data,error}=await sb.schema('hr').from('referrals').select('*').order('created_at',{ascending:false});
    if(error)throw error; TP_REF_RECORDS=data||[];}catch(e){b.innerHTML='<div class="empty" style="padding:40px;color:#c83232">'+esc(e.message)+'</div>';return;}
  tpRefRender();
}
const TP_NOTE_CSS=`<style>
  .tp-mp-click{cursor:pointer}
  .tp-mp-click:hover{background:#f8fafc}
  .tbl td.tp-note{font-size:12px;color:var(--slate);max-width:240px;white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis}
  .tbl td.tp-note[title]:not([title=""]){cursor:help}
</style>`;
function tpRefRender(){
  const b=$('recBody'); if(!b)return;
  const rows=TP_REF_RECORDS||[];
  const canAct=recCanWrite();
  b.innerHTML=TP_NOTE_CSS+`<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <div class="sec-title" style="margin:0">Employee Referrals <span class="tag t-gray" style="margin-left:4px">${rows.length}</span></div>
    <div style="margin-left:auto"><button class="btn btn-primary" onclick="tpRefAdd()"><i class="fa-solid fa-user-plus"></i> Refer Someone</button></div>
  </div>
  <div style="overflow-x:auto"><table class="tbl">
    <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Note</th><th>CV</th><th>Referred By</th><th>Date</th><th>Status</th></tr></thead>
    <tbody>${rows.length?rows.map(r=>{
      const connected=!!r.tracker_id;
      /* Connect sits on every row that has not already gone through, whatever its status - a
         referral turned down for one role can be the right person for another later, so a
         Rejected row is not a dead end. Once it IS in the Tracker the button goes: pressing it
         again would make a second candidate out of the same person. */
      /* CONNECT ONLY, AND ONLY ONCE APPROVED.

         Reject used to sit here too, which meant a referral could be turned down in two places -
         this row and the approval task - and the two did different things: the task told the
         referrer, this button did not. One decision with two buttons and two outcomes is worse
         than one button in the wrong place. Rejecting now belongs to the task, where it is asked.

         Connect appears only after the referral has been approved. It was offered on a Pending
         referral and then refused, which is a button that exists to say no. A Pending row says
         what it is waiting for instead. */
      const approved=(r.approval_status||'Pending')==='Approved';
      const acts=connected
        ? '<span class="tag t-gray">In Interviews</span>'
        : (canAct&&approved
            ? `<button class="btn btn-sm btn-primary" style="padding:3px 10px" onclick="tpRefConnect(${r.id})" title="Connect to an open position"><i class="fa-solid fa-link"></i> Connect</button>`
            : '');   // the Status pill beside this already says Pending - saying it twice, in
                       // two different forms of words, only made the cell look busy
      return `<tr class="tp-ref-row">
      <td style="font-weight:600">${esc(r.referred_name||'—')}</td>
      <td>${r.referred_email?`<a href="mailto:${esc(r.referred_email)}" style="color:var(--brand)">${esc(r.referred_email)}</a>`:'—'}</td>
      <td>${esc(r.referred_phone||'—')}</td>
      <!-- A long note used to wrap and push the whole row two or three lines tall, so a list of
           ten referrals scrolled like a list of thirty. One line, cut with an ellipsis, and the
           full text on hover - the note is worth reading, it is just not worth the whole table
           rearranging itself around it. -->
      <td class="tp-note" title="${esc(r.notes||'')}">${esc(r.notes||'—')}</td>
      <td>${r.resume_id?`<button class="btn btn-sm" style="padding:3px 8px" onclick="tpRefCv(${r.resume_id},${esc(JSON.stringify(r.referred_name||'CV'))})" title="Open the CV"><i class="fa-solid fa-file-arrow-down"></i> CV</button>`:'<span style="color:var(--slate)">—</span>'}</td>
      <td style="font-size:12px">${esc(r.referred_by||'—')}</td>
      <td style="color:var(--slate);font-size:12px;white-space:nowrap">${new Date(r.created_at).toLocaleDateString()}</td>
      <!-- THE STATUS AND THE BUTTONS ARE NOT THE SAME KIND OF THING, SO THEY DO NOT SIT TOGETHER.
           The pill reports what has happened; the buttons change it. Pressed up against each other
           they read as one control, and the eye cannot tell which part is clickable. The pill stays
           left, the actions are pushed to the right of the cell, and the gap between them says they
           are separate. -->
      <td style="white-space:nowrap">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="flex:none">${tpApprovalTag(r)}</span>
          <span style="margin-left:auto;display:flex;gap:6px;flex:none">${acts}${tpRefWithdrawBtn(r)}</span>
        </div>
      </td>
    </tr>`;}).join(''):'<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--slate)">No referrals yet — click <b>Refer Someone</b></td></tr>'}
    </tbody>
  </table></div>`;
}
/* WITHDRAW - shown to the person who made the referral, while it is still Pending, and to HR at
   any time. Before this, a referral could be raised by anyone and removed by nobody: refer the
   wrong person and it stayed for good. HR's existing control says Reject, which is a judgment on
   the candidate, not a way to take back your own mistake - so the two are kept apart. The database
   decides both questions again in hr.referral_withdraw; this only decides what is drawn. */
function tpRefWithdrawBtn(r){
  const me=String(state.email||'').toLowerCase();
  const mine=String(r.referred_by||'').toLowerCase()===me&&me!=='';
  const pending=(r.approval_status||'Pending')==='Pending';
  if(!(recCanWrite()||(mine&&pending))) return '';
  const label=recCanWrite()&&!mine?'Remove':'Withdraw';
  return `<button class="btn btn-sm" style="padding:3px 10px;color:var(--err);border-color:var(--err)"
    onclick="tpRefWithdraw(${r.id},${esc(JSON.stringify(r.referred_name||'this referral'))})"
    title="${label} this referral"><i class="fa-solid fa-trash"></i> ${label}</button>`;
}
window.tpRefWithdraw=async function(id,who){
  if(!await confirmDialog(
      'Withdraw the referral for '+(who||'this person')+'? The candidate it created is deleted as '
      +'well, along with their CV and any approval task \u2014 a referral and the candidate it put '
      +'forward are one and the same.',
      {title:'Withdraw referral', okLabel:'Withdraw', icon:'fa-trash', danger:true}))return;
  const {data,error}=await sb.schema('hr').rpc('referral_withdraw',{p_id:id});
  if(error){toast(error.message,'err');return;}
  await hrRemoveFiles(data);
  TP_REF_RECORDS=(TP_REF_RECORDS||[]).filter(r=>r.id!==id);
  // The candidate went with it, so the Tracker on screen is now out of date.
  TP_TR_RECORDS=null;
  toast('Referral withdrawn \u2014 the candidate was removed too','ok');
  tpRefRender();
};
/* Opens the CV behind a referral. The file keeps the candidate's own name rather than the stamped
   storage name, the same as the Resumes tab does. */
window.tpRefCv=async function(resumeId,who){
  const {data,error}=await sb.schema('hr').from('resumes').select('storage_path,file_name').eq('id',resumeId).maybeSingle();
  if(error||!data||!data.storage_path){toast('That CV is no longer on file','err');return;}
  const base=String(who||'CV').replace(/[^A-Za-z0-9 .()-]/g,'').trim()||'CV';
  const ext=String(data.file_name||'').split('.').pop().toLowerCase();
  s3OpenSigned(data.storage_path, base+(ext&&ext.length<=5?'.'+ext:''));
};
window.tpRefAdd=function(){
  // Open to everyone — referring a candidate is the "raise" side of the approval workflow.
  // No Position field here on purpose: a referral names a PERSON, not a role they're pre-committed
  // to — which position (if any, yet) fits them is a judgment call HR makes later, via Connect.
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-user-plus"></i> Refer Someone</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <!-- THE CV COMES FIRST. It was last, under a note field, at the bottom of a form - the single
       most useful thing in a referral, in the place people stop reading. HR judges a referral on
       the CV before anything typed about the person, so it is now the first thing asked for. -->
  <!-- Name, then the two ways of reaching them, then the CV, then the note. The CV was at the very
       bottom under the note, where people stop reading; putting it at the very top pushed the
       person's own name below the fold. Between contact details and the note is where it belongs -
       it is one more thing about who this person is, and it is the thing HR opens first. -->
  <div class="modal-body frm">
    <label>Candidate Name *</label><input id="tpRfName" class="inp">
    <div class="two"><div><label>Email</label><input id="tpRfEmail" class="inp"></div><div><label>Phone</label><input id="tpRfPhone" class="inp"></div></div>
    <!-- A FILE YOU HAVE CHOSEN CAN BE TAKEN OFF AGAIN. Picking the wrong CV used to be permanent
         for the life of the window: the box showed the filename and there was no way back to empty,
         so the only way to correct it was to close the form and lose everything typed. -->
    <label>CV <span style="color:var(--err)">*</span></label>
    <div class="dropzone" onclick="document.getElementById('tpRfCv').click()"><i class="fa-solid fa-cloud-arrow-up"></i><div id="tpRfCvName">Click to choose a PDF, Word doc, or image</div></div>
    <div id="tpRfCvPicked" style="display:none;align-items:center;gap:8px;margin-top:6px;font-size:12.5px">
      <i class="fa-solid fa-paperclip" style="color:var(--slate)"></i>
      <span id="tpRfCvPickedName" style="font-weight:600;overflow-wrap:anywhere"></span>
      <button type="button" class="btn btn-sm" style="margin-left:auto;padding:2px 10px;color:var(--err);border-color:var(--err)" onclick="tpRefCvClear()">Remove</button>
    </div>
    <input type="file" id="tpRfCv" class="hidden" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onchange="tpRefCvPicked(this)">
    <label>Note</label><textarea id="tpRfNotes" class="inp" rows="2" placeholder="How you know them, what they do now, why they'd be a good fit"></textarea>
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="tpRfSaveBtn" onclick="tpRefSave()"><i class="fa-solid fa-check"></i> Submit Referral</button></div>`);
  setTimeout(()=>{const el=$('tpRfName');if(el)el.focus();},100);
};
/* Choosing and un-choosing the CV. Clearing sets the input's value to '' rather than trying to
   build an empty FileList, which browsers do not allow. */
window.tpRefCvPicked=function(el){
  const f=el&&el.files&&el.files[0];
  const zone=document.getElementById('tpRfCvName');
  const box=document.getElementById('tpRfCvPicked');
  const nm=document.getElementById('tpRfCvPickedName');
  if(f){
    if(zone)zone.textContent='Choose a different file';
    if(nm)nm.textContent=f.name;
    if(box)box.style.display='flex';
  }else{
    if(zone)zone.textContent='Click to choose a PDF, Word doc, or image';
    if(box)box.style.display='none';
  }
};
window.tpRefCvClear=function(){
  const el=document.getElementById('tpRfCv');
  if(el)el.value='';
  tpRefCvPicked(el);
};
window.tpRefSave=async function(){
  const name=($('tpRfName')||{}).value?.trim();
  if(!name){toast('Candidate name is required','err');return;}
  const phone=($('tpRfPhone')||{}).value?.trim()||null, email=($('tpRfEmail')||{}).value?.trim()||null;
  if(!phone&&!email){toast('Give a phone number or an email — otherwise nobody can reach them','err');return;}
  /* THE CV IS REQUIRED. A referral without one is a name and a phone number, and HR judges a
     referral on the document before anything typed about the person - so a referral with no CV
     sits in the list waiting for somebody to chase the referrer for it. Better to ask now, while
     the person referring them still has the file to hand. */
  const cvPick=$('tpRfCv');
  if(!(cvPick&&cvPick.files&&cvPick.files[0])){toast('Attach their CV — a referral needs one','err');if(cvPick)cvPick.click();return;}
  const d={notes:($('tpRfNotes')||{}).value?.trim()||null};
  const btn=$('tpRfSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  /* The CV is uploaded first, then the referral and its Resumes record are written TOGETHER by
     hr.referral_submit.

     They have to go together because anybody signed in may refer somebody, but writing to Resumes
     needs HR access - so an ordinary employee attaching a CV would have had the referral accepted
     and the CV refused, leaving a referral claiming a file that was not there. The function does
     both as one, and only ever creates a CV row as part of creating a referral.

     It also takes "referred by" from the caller's own sign-in rather than from this page. A
     referral scheme is exactly the thing somebody has a reason to credit to the wrong person.

     The upload happens before either, so a failed upload leaves nothing behind at all. A referral
     with no CV still goes through; the file is optional. */
  const cvEl=$('tpRfCv'), cv=cvEl&&cvEl.files&&cvEl.files[0];
  let up=null;
  if(cv){
    const r=await uploadFileToS3(s3KeyForResume(cv.name),cv);
    if(r.error){
      toast('The CV could not be uploaded: '+r.error.message+' — nothing was saved','err');
      if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Submit Referral';}
      return;
    }
    up=r.data;
  }
  const {data:out,error}=await sb.schema('hr').rpc('referral_submit',{
    p_name:name, p_email:email, p_phone:phone, p_notes:d.notes,
    p_file_name:cv?cv.name:null, p_storage_path:up?up.path:null,
    p_file_size:cv?cv.size:null, p_file_type:cv?(cv.name.split('.').pop()||'').toLowerCase():null
  });
  if(error){toast(error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Submit Referral';}return;}
  // referral_submit returns one hr.referrals row, not a set, so it arrives as a plain object -
  // but take the first element too, so this keeps working if it is ever made set-returning.
  const data=Array.isArray(out)?out[0]:out;
  if(!data){toast('The referral was not saved','err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Submit Referral';}return;}
  TP_REF_RECORDS=[data,...(TP_REF_RECORDS||[])];closeModal();
  toast('Referral submitted — HR will connect it to a position');
  tpRefRender();
};
/* Connect: pick which open position this referral fits, right now, at connect time — not locked in
   at submission. Only HR/Administrator (rtRefConnectGuard). Approving and connecting are the same
   action: a referral isn't really "approved" in the abstract, it's approved FOR a specific role. */
/* The signed-in person's name as the Tracker's Entity column wants it. hr.entities is a short
   list of recruiters; matched case-insensitively so a stored "Khushbu Singh" still answers for a
   profile reading "Khusbu Singh" - the same mismatch that once silently cost somebody their
   Share button. Falls back to their own full name. */
async function tpEntityForMe(){
  const mine=((state.profile&&state.profile.full_name)||(state.roles&&state.roles.full_name)||'').trim();
  try{
    if(!window._tpEntities){
      const {data}=await sb.schema('hr').from('entities').select('name').eq('active',true).order('sort');
      window._tpEntities=data||[];
    }
    const hit=(window._tpEntities||[]).find(function(e){
      return String(e.name||'').trim().toLowerCase()===mine.toLowerCase(); });
    if(hit) return hit.name;
  }catch(_e){ /* the profile name will do */ }
  return mine||(state.email||'').split('@')[0]||null;
}
/* THE POSITIONS LIST IS LOADED WHERE IT IS USED, NOT WHERE IT HAPPENS TO HAVE BEEN LOADED.

   MP_RECORDS is filled by tpManpower(), which only runs when the Hiring Request tab is opened.
   Everything else that needs the list of open positions - Connect Referral, Add Candidate - read
   the cache directly, so on a fresh page load the dropdown was empty and the form said there were
   no approved positions. Going to Hiring Request and back filled it, which is exactly the detour
   that should not be necessary. This fetches it if it is not there yet. */
async function tpEnsurePositions(){
  if(MP_RECORDS) return MP_RECORDS;
  try{
    const {data,error}=await sb.schema('hr').from('manpower_requests').select('*')
      .order('submitted_at',{ascending:false});
    if(error)throw error;
    MP_RECORDS=data||[];
  }catch(e){
    // An empty list here reads as "no positions are open", which is a lie when the fetch failed.
    toast('Could not load the list of positions: '+((e&&e.message)||e),'err');
    MP_RECORDS=null;
  }
  return MP_RECORDS;
}

window.tpRefConnect=async function(id){if(!rtRefConnectGuard())return;
  const rec=(TP_REF_RECORDS||[]).find(r=>r.id===id); if(!rec)return;
  await tpEnsurePositions();
  const openReqs=(MP_RECORDS||[]).filter(r=>r.ai_job_description_json&&(r.status||'Open')==='Open');
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-link"></i> Connect Referral</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>${esc(rec.referred_name)} — connect to which open position?</label>
    <select id="tpRfConnectPos" class="sel">
      <option value="">— Select an open position —</option>
      ${openReqs.map(r=>`<option value="${r.id}">${esc(r.job_title||'—')}${r.department?' · '+esc(r.department):''}</option>`).join('')}
    </select>
    ${!openReqs.length?'<div style="font-size:11.5px;color:var(--slate);margin-top:4px">No approved open positions yet — approve a Hiring Request first.</div>':''}
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="tpRfConnectBtn" onclick="tpRefConnectGo(${id})"><i class="fa-solid fa-check"></i> Connect</button></div>`);
};
/* Approving a referral now connects it in the same step (hr.referral_approve_connect, 28 Oct
   2026), so this button only appears for referrals approved before that and never connected. It
   goes through the same function, so both paths make exactly the same candidate. */
window.tpRefConnectGo=async function(id){
  const reqId=parseInt(($('tpRfConnectPos')||{}).value||'');
  if(!reqId){toast('Pick a position','err');return;}
  const req=(MP_RECORDS||[]).find(r=>r.id===reqId);
  const btn=$('tpRfConnectBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const entity=await tpEntityForMe();
  const {data,error}=await sb.schema('hr').rpc('referral_approve_connect',{p_ref_id:id,p_req_id:reqId,p_entity:entity});
  if(error){toast(error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Connect';}return;}
  const idx=(TP_REF_RECORDS||[]).findIndex(r=>r.id===id); if(idx>-1)TP_REF_RECORDS[idx]=data;
  closeModal();
  toast('Connected to '+(req&&req.job_title||'position')+' and added to Interviews');tpRefRender();
};
window.tpRefReject=async function(id){if(!rtRefConnectGuard())return;
  if(!await confirmDialog('Reject this referral?'))return;
  const {data,error}=await sb.schema('hr').from('referrals').update({approval_status:'Rejected',approved_by:state.email,approved_at:new Date().toISOString()}).eq('id',id).select().single();
  if(error){toast(error.message,'err');return;}
  const idx=(TP_REF_RECORDS||[]).findIndex(r=>r.id===id); if(idx>-1)TP_REF_RECORDS[idx]=data;
  toast('Rejected');tpRefRender();
  /* The referrer is told, and nobody else. HR and administrators act on these all day; copying
     them on their own decision is noise they would learn to ignore. Sent from ai@ rather than from
     whoever pressed the button, because this is the company's answer and not one approver's
     opinion - putting a name on it invites the referrer to go and argue with a colleague. */
  if(String(data.referred_by||'').trim()){
    const r=await hrNotify({kind:'referral_decided',approved:false,
      referrer_email:data.referred_by,referrer_name:'',candidate_name:data.referred_name||''});
    if(r&&r.ok) toast('The person who referred them has been told','ok');
  }
};

/* ── Interview Tracker v2 ──
   Shows the Hold-only baseline (kept from before the reset) plus every fresh candidate created
   going forward by an Approved Referral or added here directly. Feedback drives hr.candidate_set_stage(),
   which keeps hr.candidates.stage and the legacy interview_tracker.feedback/status in sync. */
const TP_STAGES=['Tests Sent','Test Passed','Interview Scheduled','Interview Done','Selected','Rejected','Hold','Backed Out','Joined'];
// "Tests Sent"/"Test Passed" are set automatically (a test link being generated/sent, or a test
// being graded a pass) -- deliberately NOT removed from TP_STAGES itself (hr.candidate_set_stage
// looks stages up by label there and would break for that automatic path, and max_stage_seq
// sequencing assumes the full 9-value domain), just filtered out of what a person can pick by hand.
/* WHAT A PERSON MAY CHOOSE HERE, AND WHAT THEY MAY NOT.

   Tests Sent and Test Passed are stamped by the system - one when a link is generated, one when a
   paper clears the pass mark - so choosing them by hand would forge a record of something that did
   not happen.

   REJECTED IS DIFFERENT AND IS NOW ALSO OFF THE LIST. Turning somebody down is the one stage that
   sends a letter to the person it is about, and that letter cannot be recalled. Leaving it in a
   dropdown meant a rejection was one mis-click away, next to Hold and Interview Scheduled, with no
   pause and nobody else involved. It belongs where it is asked as a question: the approval task in
   Accountability, which names the person, warns that they will be emailed, and waits for an answer.

   The database still permits Rejected - that is how Accountability sets it - so this closes the
   accidental route without closing the deliberate one. */
/* WHAT HR MAY SET BY HAND, AND IN WHAT ORDER.

   Most stages are not HR's to type in any more, because something else owns them:

     Tests Sent, Test Passed   stamped when a link is generated and when a paper passes
     Interview Scheduled       set by scheduling an interview, which also books the interviewer
     Selected, Rejected        the interviewer's verdict, taken on their own task

   What is left is the three outcomes only HR knows about, because they come from talking to the
   person rather than from anything the system can see: they accepted, they are on hold, they
   walked away. Listed in the order they are most often needed rather than alphabetically. */
// Selected added back on 27 Oct 2026 at HR's request: they sometimes know the outcome before the
// interviewer records it on the task.
const TP_STAGES_SELECTABLE=['Selected','Joined','Hold','Backed Out'];
let TP_TR_RECORDS=null, TP_TR_SEL=new Set(), TP_TR_COMPLETED_ROWS=new Set();
/* Set by a click on a Monthly Progress row, read once by the Interviews list, and cleared the
   moment it is used - so it filters the visit it was meant for and does not quietly persist into
   the next one, which would look like rows going missing. */
let TP_TR_POS_FILTER=null;
window.tpMuOpenPeople=function(position){
  TP_TR_POS_FILTER=String(position||'')||null;
  navTo('hr_new/0');
};
window.tpTrClearPosFilter=function(){ TP_TR_POS_FILTER=null; tpTrRender(); };
async function tpTracker(){
  const b=$('recBody'); if(!b)return;
  b.innerHTML='<div class="empty" style="padding:40px"><i class="fa-solid fa-spinner fa-spin"></i></div>';
  try{
    // Two FKs exist between these tables now (candidates.tracker_id -> interview_tracker, and
    // interview_tracker.candidate_id -> candidates), so PostgREST can no longer guess which one an
    // unqualified embed means - named explicitly by the FK that actually points the way we want.
    const {data,error}=await sb.schema('hr').from('interview_tracker').select('*,candidates!interview_tracker_candidate_id_fkey(tracker_row_id,approval_status,resume_id)').order('id',{ascending:false});
    if(error)throw error; TP_TR_RECORDS=data||[];
    /* Loaded here, with the list, rather than after the Add window is already open. Fetching them
       afterwards meant the Source dropdown was empty the first time anybody used it and filled in
       a moment later - which reads as "there are no sources" and is how somebody ends up leaving
       it blank. Failure is not fatal: the column falls back to plain text. */
    if(!window._tpSources){
      try{
        const {data:src}=await sb.schema('hr').from('sources').select('name').order('sort');
        window._tpSources=src||[];
      }catch(_e){ window._tpSources=[]; }
    }
    const rowIds=[...new Set((TP_TR_RECORDS||[]).map(r=>r.candidates&&r.candidates.tracker_row_id).filter(Boolean))];
    TP_TR_COMPLETED_ROWS=new Set();
    if(rowIds.length){
      const {data:cr}=await sb.schema('hr').from('tracker_rows').select('id').in('id',rowIds).not('completed_at','is',null);
      (cr||[]).forEach(r=>TP_TR_COMPLETED_ROWS.add(r.id));
    }
  }catch(e){b.innerHTML='<div class="empty" style="padding:40px;color:#c83232">'+esc(e.message)+'</div>';return;}
  TP_TR_SEL=new Set();
  tpTrRender();
}
/* ONE LOOK FOR THE TWO EDITABLE CELLS. They were native selects with a couple of inline rules,
   so Source and Stage were different widths and different heights in the same row and neither
   lined up with the text beside them. */
const TP_SEL_CSS=`<style>
  .tp-sel{width:100%;max-width:170px;font-size:12px;line-height:1.3;padding:5px 26px 5px 9px;
    border:1px solid var(--line);border-radius:7px;background-color:#fff;color:var(--ink);
    height:30px;cursor:pointer;appearance:none;-webkit-appearance:none;
    background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath fill='%2364748b' d='M0 0h10L5 6z'/%3E%3C/svg%3E");
    background-repeat:no-repeat;background-position:right 9px center}
  .tp-sel:hover:not(:disabled){border-color:#94a3b8}
  .tp-sel:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(37,99,235,.12)}
  .tp-sel:disabled{opacity:.6;cursor:not-allowed;background-color:#f8fafc}
  .tp-sel optgroup{font-size:11px;color:var(--slate)}
</style>`;
function tpTrFbTag(s){
  const m={'Selected':'t-green','Joined':'t-green','Rejected':'t-red','Backed Out':'t-red','Hold':'t-amber','Tests Sent':'t-gray','Test Passed':'t-gray','Interview Scheduled':'t-gray','Interview Done':'t-gray'};
  return s?`<span class="tag ${m[s]||'t-gray'}">${esc(s)}</span>`:'<span class="tag t-gray">—</span>';
}
function tpTrRender(){
  const b=$('recBody'); if(!b)return;
  const all=TP_TR_RECORDS||[];
  const posFilter=TP_TR_POS_FILTER;
  const rows=posFilter
    ? all.filter(function(r){return String(r.position||'')===posFilter;})
    : all;
  const canAct=recCanWrite();
  /* Writing to a candidate is NOT ordinary Recruitment write access. It is the same four people who
     own the test bank - Shuchandra Das, Khusbu Singh, Uzma Ahmed, the Administrator - and the
     database says so too (recruit.can_email_candidates, which send-test-email asks with the
     caller's own token). Checked here as well so the rest of HR never gets a button that would
     refuse them only after they had written the message. */
  const canMail=rtCanManage();
  b.innerHTML=TP_SEL_CSS+TP_NOTE_CSS+`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
    <div class="sec-title" style="margin:0">Interviews <span class="tag t-gray" style="margin-left:4px">${rows.length}</span></div>
    <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="tpTrAdd()"><i class="fa-solid fa-plus"></i> Add</button>
      ${canAct?`<button class="btn" id="tpTrEditBtn" disabled style="opacity:.4" title="Tick one hand-added candidate to edit their details" onclick="tpTrEdit()"><i class="fa-solid fa-pen"></i> Edit</button>`:''}
      ${canMail?`<button class="btn" id="tpTrEmailBtn" disabled style="opacity:.4" onclick="tpTrEmailSel()"><i class="fa-solid fa-envelope"></i> Email</button>`:''}
      ${canAct?`<button class="btn" id="tpTrDelBtn" disabled style="opacity:.4;color:var(--err);border-color:var(--err)" onclick="tpTrDeleteSel()"><i class="fa-solid fa-trash"></i> Delete</button>`:''}
    </div>
  </div>
  ${posFilter?`<div style="display:flex;align-items:center;gap:8px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:12.5px;color:#1e40af">
    <i class="fa-solid fa-filter"></i> Showing only <b>${esc(posFilter)}</b> — ${rows.length} of ${all.length}
    <button class="btn btn-sm" style="margin-left:auto;padding:2px 10px" onclick="tpTrClearPosFilter()">Show all</button>
  </div>`:''}
  <div style="font-size:12px;color:var(--slate);margin-bottom:12px">Everyone who applied on the Careers page, was uploaded as a CV, was referred, or was added here by hand.</div>
  <div style="overflow-x:auto"><table class="tbl" style="min-width:1200px">
    <thead><tr>
      ${canAct?'<th style="width:32px"><input type="checkbox" onchange="tpTrToggleAll(this)"></th>':''}
      <th>Candidate</th><th>Position</th><th>Source</th><th>Handled By</th><th>Phone</th><th>Email</th><th>Date &amp; Time</th><th style="width:170px">Stage</th><th>Notes</th>
    </tr></thead>
    <tbody>${rows.length?rows.map(r=>`<tr>
      ${canAct?`<td><input type="checkbox" class="tp-tr-cb" data-id="${r.id}" data-email="${esc(r.email||'')}" onchange="tpTrRowCheck(this)"></td>`:''}
      <!-- WHETHER SOMEBODY HAS BEEN APPROVED IS SAID ON THEIR ROW, NOT ONLY WHEN YOU TRY TO ACT.
           Every candidate who is not a referral raises an approval task in Accountability, and
           until it is decided they cannot be sent a test or moved on. That was true already and
           invisible here: a waiting candidate looked exactly like an approved one, and the first
           anybody heard of it was the Email window refusing to list them. The chip says it where
           the person is, and the tooltip says where to go and do something about it. -->
      <td style="font-weight:600">${esc(r.candidate_name||'—')}${(()=>{
        const ap=String((r.candidates&&r.candidates.approval_status)||'Approved');
        if(ap==='Pending')return ' <span class="tag t-amber" style="font-size:10px" title="Waiting to be approved in Accountability \u203a Pending Approval \u2014 they cannot be sent a test until then">to approve</span>';
        if(ap==='Rejected')return ' <span class="tag t-red" style="font-size:10px" title="This candidate was not approved">not approved</span>';
        return '';
      })()}</td>
      <td>${esc(r.position||'—')}</td>
      <!-- SOURCE IS EDITABLE, THE SAME WAY STAGE IS. It was printed as text, so a row that came in
           with the wrong source - or none, which is what a hand-added candidate starts with - could
           only be corrected in the database. It is the field Monthly Progress and every "where do
           our candidates come from" question reads, so it has to be fixable where it is seen. -->
      <!-- SOURCE IS A FACT FOR A REFERRAL, NOT A CHOICE. Somebody referred this person; that is how
           they got here and no later edit changes it. Leaving the dropdown open invited a row to be
           relabelled LinkedIn, at which point nothing connects the candidate back to the colleague
           who put them forward - and referral credit is the whole reason people refer anybody. -->
      <td style="font-size:12px;color:var(--slate)">${String(r.source||'')==='Referral'
        ? '<span class="tag t-gray" title="Set when the referral was connected">Referral</span>'
        : canAct&&(window._tpSources||[]).length
        ? (function(){
            /* The current value is listed ONCE. A source that is not in the list any more was
               appended as an extra option, so anything still in the list appeared twice. */
            const names=(window._tpSources||[]).map(function(x){return x.name;});
            const cur=String(r.source||'');
            if(cur&&names.indexOf(cur)<0) names.push(cur);
            return `<select class="tp-sel" onchange="tpTrSource(${r.id},this.value)">
             <option value=""${cur?'':' selected'}>— None —</option>
             ${names.map(x=>`<option${cur===String(x)?' selected':''}>${esc(x)}</option>`).join('')}
           </select>`;
          })()
        : esc(r.source||'—')}</td>
      <td style="font-size:12px">${esc(r.entity||'—')}</td>
      <td style="font-family:monospace;font-size:12px">${esc(r.number||'—')}</td>
      <td style="font-size:12px">${r.email?`<a href="mailto:${esc(r.email)}" style="color:var(--brand)">${esc(r.email)}</a>`:'—'}</td>
      <td style="font-size:12px;color:var(--slate);white-space:nowrap">${esc(r.scheduled_date||'—')}</td>
      <td>${(()=>{
          const rowId=r.candidates&&r.candidates.tracker_row_id;
          const locked=rowId&&TP_TR_COMPLETED_ROWS.has(rowId);
          if(locked)return tpTrFbTag(r.feedback)+' <i class="fa-solid fa-lock" style="color:var(--slate);font-size:10px" title="This position is marked Complete in Monthly Update"></i>';
          if(!canAct)return tpTrFbTag(r.feedback);
          /* TESTS SENT AND TEST PASSED ARE NOT OFFERED, BUT THEY NO LONGER FREEZE THE ROW.

             Those two stages are stamped by the system - one when a test link is generated, one
             when a submission clears the pass mark - so they are deliberately absent from the list
             of things a person can choose. That much was right. What was wrong was hiding the whole
             dropdown once a candidate reached one of them: the moment you sent somebody a test they
             became stuck, and there was no way to move them on to Interview Scheduled, or to Reject
             them, without going into the database. A stage the system sets should stop you FORGING
             it, not stop you continuing.

             So the dropdown is always there. It shows the current stage as its heading when that
             stage is one of the automatic two, and every manual stage stays selectable. */
          /* The per-row "Send Test" button used to live here. Sending a test is now one of the
             things the Email Selected window can do, so it is done the same way as any other mail
             to a candidate - tick the rows, write the message, optionally attach a test - instead
             of through a second button with its own separate window. Attaching a test there still
             generates each candidate their own link and still moves them to Tests Sent. */
          /* THE DROPDOWN STILL HAS TO SAY WHERE THEY ARE.

             Most stages are no longer HR's to choose - the system sets Tests Sent and Test Passed,
             booking sets Interview Scheduled, the interviewer sets Selected and Rejected. But a
             stage you cannot choose is still a stage you need to SEE. With those removed from the
             list, the box fell back to "- Select -" and the column stopped reporting anything: a
             candidate sitting at Interview Scheduled looked identical to one who had just arrived.

             So the closed part of the box shows the stage they are actually at, and the list below
             offers only what this person may set. Reading and choosing are different jobs and the
             control does both. */
          const shown=String(r.feedback||'').trim();
          const canPick=TP_STAGES_SELECTABLE.indexOf(shown)>=0;
          /* REJECTED IS THE END OF THE ROAD, SO THE BOX STOPS OFFERING A WAY FORWARD.

             Failing the test now rejects a candidate, and the dropdown still offered Joined,
             Hold and Backed Out to somebody who had been rejected - picking one was refused by
             the database, but only after it had been chosen. The stage is still shown, because
             HR needs to see where the person stands; there is simply nothing left to pick. */
          if(shown==='Rejected'){
            return `<select class="tp-sel" disabled title="This candidate has been rejected — the decision is final"><option>Rejected</option></select>`;
          }
          /* THE CURRENT STAGE IS THE HEADING, NOT AN ITEM IN THE LIST.

             It used to be an ordinary option, so a candidate sitting at Pending showed "Pending"
             on the closed box and "Pending" again as the first line when you opened it - the
             thing you already are, offered as somewhere to go. `hidden` keeps it as the closed
             label and takes it out of the list, and `disabled` means it cannot be re-chosen even
             where a browser ignores `hidden`. What is left under it is only what you may pick. */
          const heading=shown?esc(shown):'Not started';
          return `<select class="tp-sel" onchange="tpTrFeedback(${r.id},this.value)">
            <option value="" selected disabled hidden>${heading}</option>
            <optgroup label="Move to…">
              ${TP_STAGES_SELECTABLE.filter(x=>x!==shown).map(x=>`<option>${x}</option>`).join('')}
            </optgroup>
          </select>`;
        })()}</td>
      <td class="tp-note" title="${esc(r.notes||'')}">${esc(r.notes||'—')}</td>
    </tr>`).join(''):`<tr><td colspan="${canAct?10:9}" style="text-align:center;padding:40px;color:var(--slate)">No candidates yet — click <b>Add</b></td></tr>`}
    </tbody>
  </table></div>`;
}
window.tpTrToggleAll=function(el){document.querySelectorAll('.tp-tr-cb').forEach(c=>{c.checked=el.checked;const id=Number(c.dataset.id);if(el.checked)TP_TR_SEL.add(id);else TP_TR_SEL.delete(id);});tpTrSyncToolbar();};
window.tpTrRowCheck=function(cb){const id=Number(cb.dataset.id);if(cb.checked)TP_TR_SEL.add(id);else TP_TR_SEL.delete(id);tpTrSyncToolbar();};
function tpTrSyncToolbar(){
  const n=TP_TR_SEL.size;
  const eb=$('tpTrEmailBtn'),db=$('tpTrDelBtn'),xb=$('tpTrEditBtn');
  if(eb){eb.disabled=n===0;eb.style.opacity=n>0?'1':'.4';}
  if(db){db.disabled=n===0;db.style.opacity=n>0?'1':'.4';}
  if(xb){
    const one=n===1?(TP_TR_RECORDS||[]).find(r=>r.id===[...TP_TR_SEL][0]):null;
    const ok=!!one&&tpTrHandAdded(one);
    xb.disabled=!ok; xb.style.opacity=ok?'1':'.4';
    xb.title=n!==1?'Tick one hand-added candidate to edit their details'
      :ok?'Edit this candidate’s details'
      :'Only candidates added by hand can be edited — this one came from the Careers page, a CV or a referral';
  }
}
/* HAND-ADDED = typed in here, not created from a Careers-page application, an uploaded CV or a
   referral. Those carry what the person themselves sent, so their details are not retyped here. */
function tpTrHandAdded(r){
  if(!r||String(r.source||'')==='Referral') return false;
  return !(r.candidates&&r.candidates.resume_id);
}
/* EDITING A HAND-ADDED CANDIDATE. Name, phone, email and notes - the things that are typed in and
   so get typed wrong. Position is not offered: it decides which month and which position they are
   counted under, so moving them is delete-and-add, not an edit. Allowed at any stage. */
window.tpTrEdit=function(){
  if(!recGuard())return;
  const r=(TP_TR_RECORDS||[]).find(x=>x.id===[...TP_TR_SEL][0]);
  if(!r||!tpTrHandAdded(r)){toast('Tick one hand-added candidate first','err');return;}
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-pen"></i> Edit Candidate</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <div class="two"><div><label>Candidate Name *</label><input id="tpTrEName" class="inp" value="${esc(r.candidate_name||'')}"></div>
    <div><label>Position</label><input class="inp" value="${esc(r.position||'')}" disabled title="To move someone to another position, delete them and add them again"></div></div>
    <div class="two"><div><label>Phone</label><input id="tpTrEPhone" class="inp" value="${esc(r.number||'')}"></div><div><label>Email</label><input id="tpTrEEmail" class="inp" value="${esc(r.email||'')}"></div></div>
    <label>Notes</label><textarea id="tpTrENotes" class="inp" rows="2">${esc(r.notes||'')}</textarea>
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="tpTrESaveBtn" onclick="tpTrEditSave(${r.id})"><i class="fa-solid fa-check"></i> Save</button></div>`);
};
window.tpTrEditSave=async function(trackerId){
  if(!recGuard())return;
  const r=(TP_TR_RECORDS||[]).find(x=>x.id===trackerId); if(!r)return;
  const name=String(($('tpTrEName')||{}).value||'').trim();
  if(!name){toast('Name is required','err');return;}
  const phone=String(($('tpTrEPhone')||{}).value||'').trim()||null;
  const email=String(($('tpTrEEmail')||{}).value||'').trim()||null;
  const notes=String(($('tpTrENotes')||{}).value||'').trim()||null;
  const btn=$('tpTrESaveBtn'); if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const {error}=await sb.schema('hr').from('interview_tracker')
    .update({candidate_name:name,number:phone,email,notes}).eq('id',trackerId);
  if(error){toast(error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Save';}return;}
  // The candidate record carries the same details and is what tests and emails are sent from.
  if(r.candidate_id){
    const {error:ce}=await sb.schema('hr').from('candidates').update({name,phone,email}).eq('id',r.candidate_id);
    if(ce){toast('Saved on the row, but not on the candidate record: '+ce.message,'err');}
  }
  Object.assign(r,{candidate_name:name,number:phone,email,notes});
  closeModal(); toast('Candidate updated','ok'); tpTrRender();
};
// candidate_set_stage takes a candidates.id, but the Tracker row's own id (interview_tracker.id) is what
// we render against — resolve via candidate_id when present, otherwise fall back to a direct tracker update
// (rows with no candidate_id are the pre-reset Hold rows carried over, which never got a hr.candidates row).
/* SENDING ONE OF THE THREE HR LETTERS.

   Every caller goes through here so the wording, the sender rules and the reporting stay in one
   place. It never throws: a letter failing must not undo the decision that prompted it - a
   candidate who has been rejected stays rejected whether or not the email left the building - so
   the outcome is reported and the caller carries on.

   When the sender's own Google is not connected the letter still goes, from the shared account,
   and the toast says so. Letting somebody believe a rejection went out over their name when it
   did not is the failure worth avoiding here. */
async function hrNotify(payload){
  try{
    const {data,error}=await sb.functions.invoke('hr-notify',{body:payload});
    if(error||(data&&data.error)) throw new Error((data&&data.error)||error.message);
    if(data&&data.not_connected){
      toast('Sent from the shared JAIN-E address \u2014 connect your Google account to send from your own','warn');
    }
    return data;
  }catch(e){
    toast('The email could not be sent: '+((e&&e.message)||e),'err');
    return null;
  }
}

window.tpTrFeedback=async function(trackerId,stage){
  if(!recGuard()||!stage)return;
  const rec=(TP_TR_RECORDS||[]).find(r=>r.id===trackerId); if(!rec)return;
  /* A REFUSED CHANGE PUTS THE DROPDOWN BACK.

     The database refuses to move an unapproved candidate, and that part worked - but a <select>
     keeps whatever was picked until something redraws it. So the toast said no and the box said
     yes, which reads as "it complained but did it anyway". Re-rendering from the record we still
     hold snaps it back to the truth, so the screen and the database never disagree. */
  if(rec.candidate_id){
    const {error}=await sb.schema('hr').rpc('candidate_set_stage',{p_id:rec.candidate_id,p_stage:stage});
    if(error){toast(error.message,'err');tpTrRender();return;}
  }else{
    const {error}=await sb.schema('hr').from('interview_tracker').update({feedback:stage,status:stage}).eq('id',trackerId);
    if(error){toast(error.message,'err');tpTrRender();return;}
  }
  rec.feedback=stage;toast('Updated');

  /* Moving the stage to Rejected used to offer to email the candidate. It no longer does:
     rejection is recorded and nothing is sent, from this screen or any other. The other stages
     never wrote to anybody - nobody expects a letter saying they have reached "Interview
     Scheduled". */
};
/* Written to the tracker row AND to the candidate record, because both carry a source and the two
   are read by different screens - the Tracker prints its own, Monthly Progress and the reports read
   the candidate's. Updating one would leave the other saying something else. */
window.tpTrSource=async function(trackerId,value){
  if(!recGuard())return;
  const rec=(TP_TR_RECORDS||[]).find(r=>r.id===trackerId); if(!rec)return;
  if(String(rec.source||'')==='Referral'){
    toast('A referred candidate stays a Referral — that is how they reached us','err');
    tpTrRender();
    return;
  }
  const v=String(value||'').trim()||null;
  const {error}=await sb.schema('hr').from('interview_tracker').update({source:v}).eq('id',trackerId);
  if(error){toast(error.message,'err');return;}
  if(rec.candidate_id){
    try{ await sb.schema('hr').from('candidates').update({source:v}).eq('id',rec.candidate_id); }catch(_e){}
  }
  rec.source=v;
  toast('Source updated');
};
window.tpTrAdd=async function(){
  if(!recGuard())return;
  await tpEnsurePositions();
  const openReqs=(MP_RECORDS||[]).filter(r=>r.ai_job_description_json);
  const entities=(window._tpEntities||[]);
  const sources=(window._tpSources||[]);
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-plus"></i> Add Candidate</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <div class="two"><div><label>Candidate Name *</label><input id="tpTrName" class="inp"></div>
    <div><label>Position *</label><select id="tpTrPos" class="sel"><option value="">— Select —</option>${openReqs.map(r=>`<option value="${r.id}">${esc(r.job_title||'—')}</option>`).join('')}</select></div></div>
    <!-- ENTITY IS NOT ASKED FOR. It is who handled this candidate, and that is whoever is filling
         this form in - asking them to pick themselves from a list is a question with one right
         answer. It is recorded from the signed-in user instead. -->
    <div><label>Source</label>
      <select id="tpTrSrc" class="sel" onchange="tpTrSrcPick(this)">
        <option value="">— Select —</option>
        ${sources.map(s=>`<option>${esc(s.name)}</option>`).join('')}
        <option value="__new">+ Add a new source…</option>
      </select>
      <div id="tpTrSrcNew" style="display:none;gap:6px;margin-top:6px">
        <input id="tpTrSrcNewName" class="inp" placeholder="Name of the new source" style="flex:1"
               onkeydown="if(event.key==='Enter'){event.preventDefault();tpTrSrcNewSave();}else if(event.key==='Escape'){event.preventDefault();tpTrSrcNewCancel();}">
        <button class="btn btn-primary" id="tpTrSrcNewBtn" type="button" onclick="tpTrSrcNewSave()"><i class="fa-solid fa-check"></i> Add</button>
        <button class="btn" type="button" onclick="tpTrSrcNewCancel()">Cancel</button>
      </div>
      <div style="font-size:11.5px;color:var(--slate);margin-top:4px">A source added here also appears on the careers page form.</div>
    </div>
    <div class="two"><div><label>Phone</label><input id="tpTrPhone" class="inp"></div><div><label>Email</label><input id="tpTrEmail" class="inp"></div></div>
    <label>Notes</label><textarea id="tpTrNotes" class="inp" rows="2"></textarea>
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="tpTrSaveBtn" onclick="tpTrSave()"><i class="fa-solid fa-check"></i> Add</button></div>`);
  if(!window._tpSources){
    sb.schema('hr').from('sources').select('name').order('sort').then(({data})=>{
      window._tpSources=data||[]; tpTrSrcRefill();
    });
  }
  setTimeout(()=>{const el=$('tpTrName');if(el)el.focus();},100);
};
/* Redraws the Source list from whatever is currently loaded, keeping what was chosen. Used after
   the list arrives and after a new source is added. */
function tpTrSrcRefill(keep){
  const el=$('tpTrSrc'); if(!el) return;
  const cur=keep!==undefined?keep:el.value;
  el.innerHTML='<option value="">\u2014 Select \u2014</option>'
    +(window._tpSources||[]).map(x=>`<option${String(cur)===String(x.name)?' selected':''}>${esc(x.name)}</option>`).join('')
    +'<option value="__new">+ Add a new source\u2026</option>';
}
/* Adding a source from the place you needed it, rather than sending somebody to a settings
   screen to come back later. It goes into hr.sources, which is the one list the Tracker, this
   form and the careers page all read - so a source added here really does show up on the
   website's "how did you hear about this opening?" the next time that page is opened. */
window.tpTrSrcPick=function(el){
  if(!el||el.value!=='__new') return;
  el.value='';
  // Inline, not a second modal on top of this one: the form stays where it is and the new name
  // is typed in the place the answer belongs.
  const box=$('tpTrSrcNew'); if(!box) return;
  el.style.display='none'; box.style.display='flex';
  const inp=$('tpTrSrcNewName'); if(inp){ inp.value=''; inp.focus(); }
};
window.tpTrSrcNewCancel=function(){
  const el=$('tpTrSrc'), box=$('tpTrSrcNew');
  if(box) box.style.display='none';
  if(el){ el.style.display=''; el.value=''; }
};
/* Adding a source where you needed it, rather than sending somebody to a settings screen to come
   back later. It goes into hr.sources, which is the one list the Tracker, this form and the
   careers page all read - so a source added here really does appear in the website's "how did you
   hear about this opening?" the next time that page loads. */
window.tpTrSrcNewSave=async function(){
  const inp=$('tpTrSrcNewName'); const v=String((inp&&inp.value)||'').trim();
  if(!v){ toast('Type a name for the source','err'); if(inp)inp.focus(); return; }
  if((window._tpSources||[]).some(x=>String(x.name).trim().toLowerCase()===v.toLowerCase())){
    toast('That source is already in the list','warn'); tpTrSrcNewCancel(); tpTrSrcRefill(v); return;
  }
  const btn=$('tpTrSrcNewBtn'); if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  try{
    const maxSort=(window._tpSources||[]).reduce((m,x)=>Math.max(m,Number(x.sort)||0),0)+10;
    const {error}=await sb.schema('hr').from('sources').insert({name:v,sort:maxSort});
    if(error) throw new Error(error.message);
    window._tpSources=[...(window._tpSources||[]),{name:v,sort:maxSort}];
    tpTrSrcNewCancel(); tpTrSrcRefill(v);
    toast('“'+v+'” added — it will show on the careers page too','ok');
  }catch(e){
    toast('Could not add that source: '+((e&&e.message)||e),'err');
    if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Add';}
  }
};
window.tpTrSave=async function(){
  const name=($('tpTrName')||{}).value?.trim();
  const reqId=parseInt(($('tpTrPos')||{}).value||'');
  if(!name||!reqId){toast('Name and Position are required','err');return;}
  const req=(MP_RECORDS||[]).find(r=>r.id===reqId);
  const btn=$('tpTrSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const {data:rowId,error:rrErr}=await sb.schema('hr').rpc('tracker_row_for_request',{p_req_id:reqId,p_month:null});
  if(rrErr){toast(rrErr.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Add';}return;}
  let source=($('tpTrSrc')||{}).value||null;
  if(source==='__new') source=null;            // the placeholder is not a source
  /* Handled By is whoever is adding them. tpEntityForMe resolves the signed-in person to an entity
     name where one matches, and falls back to their own name - which is more use than the blank
     the old optional dropdown usually left behind. */
  let entity=null;
  try{ entity=await tpEntityForMe(); }catch(_e){ entity=null; }
  if(!entity) entity=(req?req.approved_by:null)||state.email||null;
  const phone=($('tpTrPhone')||{}).value?.trim()||null, email=($('tpTrEmail')||{}).value?.trim()||null;
  const {data:cand,error:cErr}=await sb.schema('hr').from('candidates').insert({tracker_row_id:rowId,manpower_request_id:reqId,name,email,phone,
    // Same again - added to the Tracker, not yet tested. The Send Test button on the row is what
    // moves them on, via candidate_set_stage.
    position:req&&req.job_title,source,entity,created_by:state.email,applied_at:new Date().toISOString()}).select().single();
  if(cErr){toast(cErr.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Add';}return;}
  const notes=($('tpTrNotes')||{}).value?.trim()||null;
  const {data:tr,error:tErr}=await sb.schema('hr').from('interview_tracker').insert({candidate_name:name,position:req&&req.job_title,source,entity,number:phone,email,notes,candidate_id:cand.id}).select().single();
  if(tErr){toast(tErr.message,'err');return;}
  await sb.schema('hr').from('candidates').update({tracker_id:tr.id}).eq('id',cand.id);
  TP_TR_RECORDS=[tr,...(TP_TR_RECORDS||[])];closeModal();toast('Candidate added');tpTrRender();
};
/* EMAIL SELECTED - one window for writing to candidates, which can also carry a test.

   It used to hand the addresses to the computer's own mail program through a mailto: link. That
   is where the truncated and code-looking mail came from: a mailto: is a URL, everything in it is
   percent-encoded, and browsers and mail programs cut it off at a length nobody agrees on - so a
   message either arrived half-written or arrived full of %20 and %0A. It also meant the mail was
   never really sent by JAIN-E at all, so nothing could be recorded and nobody could be sure it
   went. Now it goes through send-test-email, the same path the Tests tab has always used: proper
   HTML with a plain-text alternative, base64-encoded so a long line or an accented character
   cannot corrupt it, one message per candidate so nobody sees anybody else's address, and sent
   from the writer's own Gmail when they have connected it.

   NOTHING IS PRE-FILLED. Subject and message start empty and are the writer's own words - the
   old version put "Regarding your application" in for them, which is how every candidate got an
   identical subject line nobody had chosen.

   Attaching a test is optional, and is what replaced the per-row Send Test button. When one is
   attached each candidate gets their OWN link, generated against their candidate record, which is
   what moves them to Tests Sent on the Monthly Update - the same mechanism as before, just reached
   from here. Anyone with no candidate record behind their row still gets the message; they simply
   cannot be given a personal link, and the window says so plainly rather than silently leaving
   them out. */
window.tpTrEmailSel=async function(){
  if(!rtCanManage()){toast('Only Shuchandra Das, Khusbu Singh, Uzma Ahmed or the Administrator can email candidates','err');return;}
  const rows=[...TP_TR_SEL].map(id=>(TP_TR_RECORDS||[]).find(x=>x.id===id)).filter(Boolean);
  const withEmail=rows.filter(r=>r.email);
  if(!withEmail.length){toast('None of the selected candidates have an email on file','err');return;}
  const noEmail=rows.length-withEmail.length;
  await rtShareCheckGmail();
  // Native tests only: a personal, trackable link can only be made for one of ours.
  await rtLoadQCounts();
  let tests=(RT_RECORDS||[]).filter(t=>t.engine==='native');
  if(!tests.length){
    try{const {data}=await sb.schema('recruit').from('tests').select('*').eq('engine','native').order('sl');
      tests=data||[];}catch(_e){ tests=[]; }
  }
  const noCand=withEmail.filter(r=>!r.candidate_id).length;
  /* A TEST CANNOT GO TO SOMEBODY WHO HAS ALREADY MOVED ON - THE MESSAGE STILL CAN.
     Somebody who has Joined, been selected, rejected, put on hold or already sent a test is past
     the point where an assessment means anything, and the database refuses the stage change in any
     case. That is a reason not to attach a TEST to them, not a reason they cannot be written to:
     a joining letter, an interview time or a thank-you is exactly the mail you send such a person.
     So they stay in the list, are told apart in it, and the attachment simply skips them. */
  const noTest=withEmail.filter(r=>!rtTestable(r.feedback)).length;
  const list=withEmail.map(function(r){
    const can=rtTestable(r.feedback);
    return '<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid var(--line-2)">'
      +'<span style="font-weight:600">'+esc(r.candidate_name||'\u2014')
      +(can?'':'<span class="tag t-gray" style="margin-left:6px;font-size:10px" title="'
          +esc('Already at '+(r.feedback||'a later stage')+' \u2014 no test will be attached for this person')
          +'">no test</span>')+'</span>'
      +'<span style="color:var(--slate);font-size:12px">'+esc(r.email)+'</span></div>';
  }).join('');
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-envelope"></i> Email Selected</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm" style="max-height:72vh;overflow-y:auto">
    ${RT_CAN_SEND_AS_SELF
      ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:9px 12px;font-size:12.5px;color:#166534;margin-bottom:4px"><i class="fa-brands fa-google"></i> Sending from <b>${esc(state.email||'')}</b> \u2014 it will be in your own Sent folder, and replies come straight to you.</div>`
      : `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:9px 12px;font-size:12.5px;color:#92400e;margin-bottom:4px">
           <div style="margin-bottom:7px">This will be sent from the shared JAIN-E address, signed by you, with replies pointed at <b>${esc(state.email||'')}</b>. Connect your Google account to send it from your own address instead.</div>
           <button type="button" class="btn btn-sm" onclick="rtShareConnectGoogle()"><i class="fa-brands fa-google"></i> Connect Google</button>
         </div>`}
    <label>To <span style="font-size:11px;color:var(--slate)">(${withEmail.length} candidate${withEmail.length>1?'s':''} \u2014 each gets their own copy)</span></label>
    <div style="border:1px solid var(--line);border-radius:8px;padding:6px 10px;max-height:132px;overflow-y:auto">${list}</div>
    ${noEmail?`<div style="font-size:11.5px;color:#92400e;margin-top:4px"><i class="fa-solid fa-triangle-exclamation"></i> ${noEmail} selected row${noEmail>1?'s have':' has'} no email on file and will be skipped.</div>`:''}
    <label style="margin-top:10px">Subject *</label><input id="tpTrMailSubj" class="inp" placeholder="Write the subject">
    <label>Message *</label><textarea id="tpTrMailBody" class="inp" rows="6" style="resize:vertical" placeholder="Write your message"></textarea>
    <label style="margin-top:10px">Attach a Test <span style="font-size:11px;color:var(--slate)">(optional)</span></label>
    <select id="tpTrMailTest" class="sel">
      <option value="">\u2014 No test \u2014</option>
      ${tests.map(t=>rtTestOpt(t,false)).join('')}
    </select>
    ${tests.length?`<div style="font-size:11.5px;color:var(--slate);margin-top:4px">Each candidate gets their own link, and moves to <b>Tests Sent</b> on the Monthly Update.${noCand?` ${noCand} of them ${noCand>1?'have':'has'} no candidate record, so ${noCand>1?'they':'it'} cannot be given one \u2014 ${noCand>1?'they':'it'} will still receive the message.`:''}${noTest?` ${noTest} ${noTest>1?'have':'has'} already moved past the test stage \u2014 ${noTest>1?'they':'it'} will get the message without a test link.`:''}</div>`
      :`<div style="font-size:11.5px;color:var(--slate);margin-top:4px">No tests exist yet \u2014 create one in the Tests tab to be able to attach it here.</div>`}
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="tpTrMailBtn" onclick="tpTrEmailSelSend()"><i class="fa-solid fa-paper-plane"></i> Send</button></div>`);
  setTimeout(()=>{const el=$('tpTrMailSubj');if(el)el.focus();},100);
};

window.tpTrEmailSelSend=async function(){
  if(!rtCanManage()){toast('Only Shuchandra Das, Khusbu Singh, Uzma Ahmed or the Administrator can email candidates','err');return;}
  const subject=(($('tpTrMailSubj')||{}).value||'').trim();
  const body=(($('tpTrMailBody')||{}).value||'').trim();
  // An empty subject or an empty message is a slip, not a choice - the window starts blank on
  // purpose, so there is nothing to fall back on if they are left that way.
  if(!subject){toast('Write a subject','err');const el=$('tpTrMailSubj');if(el)el.focus();return;}
  if(!body){toast('Write a message','err');const el=$('tpTrMailBody');if(el)el.focus();return;}
  const testId=parseInt((($('tpTrMailTest')||{}).value)||'')||null;
  const rows=[...TP_TR_SEL].map(id=>(TP_TR_RECORDS||[]).find(x=>x.id===id)).filter(r=>r&&r.email);
  if(!rows.length){toast('Nobody selected has an email on file','err');return;}
  const testName=testId?((RT_RECORDS||[]).find(t=>t.id===testId)||{}).name||'Assessment':'';
  const btn=$('tpTrMailBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Sending\u2026';}
  const {data:{session}}=await sb.auth.getSession();
  const token=session&&session.access_token;
  const post=async (payload)=>{
    const res=await fetch(SUPABASE_URL+'/functions/v1/send-test-email',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},
      body:JSON.stringify(payload)
    });
    const out=await res.json().catch(()=>({}));
    if(!res.ok||out.error)throw new Error(out.error||('send-test-email HTTP '+res.status));
    return out;
  };
  let sent=0, tested=0; const failed=[];
  try{
    if(!testId){
      /* No test: one call, and the function still writes one message per candidate so nobody sees
         anybody else's address. */
      const out=await post({test_name:'',link:'',subject,body,recipients:rows.map(r=>r.email.toLowerCase())});
      sent=Number(out.sent||rows.length);
      (out.failed||[]).forEach(f=>failed.push((f&&f.to)||'someone'));
    } else {
      /* A test: each candidate needs their OWN link, so this goes one at a time.
         recruit-test-generate-link is what calls candidate_set_stage(...,'Tests Sent'), and it
         only does so when a real candidate_id is passed - which is why somebody with no candidate
         record gets the message but not a link, rather than being quietly dropped. */
      for(const r of rows){
        let link='';
        /* rtTestable is the same rule the Email Test window uses and the same one the database
           enforces, so "no link for this person" is decided here rather than discovered as a
           failure after the mail has gone. They still get the message. */
        if(r.candidate_id&&rtTestable(r.feedback)){
          try{
            const {data,error}=await sb.functions.invoke('recruit-test-generate-link',
              {body:{test_id:testId,candidate_id:r.candidate_id,candidate_email:r.email,origin:location.origin}});
            if(error||data?.error)throw new Error(await fnErrText(error,data));
            link=data.link||'';
          }catch(e){ failed.push((r.candidate_name||r.email)+' (test link: '+((e&&e.message)||e)+')'); continue; }
        }
        try{
          await post({test_id:testId,test_name:link?testName:'',link,subject,body,recipients:[r.email.toLowerCase()]});
          sent++; if(link)tested++;
        }catch(e){ failed.push((r.candidate_name||r.email)+' ('+((e&&e.message)||e)+')'); }
      }
    }
  }catch(e){
    if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-paper-plane"></i> Send';}
    toast('Send failed: '+((e&&e.message)||'unknown error'),'err');
    return;
  }
  closeModal();
  if(sent)toast('Emailed '+sent+' candidate'+(sent===1?'':'s')+(tested?(' \u2014 '+tested+' now at Tests Sent'):''),'ok');
  // One address failing among several must not read as a clean success.
  if(failed.length)toast('Could not reach: '+failed.slice(0,3).join(', ')+(failed.length>3?(' and '+(failed.length-3)+' more'):''),'err');
  try{usageQueue('recruitment.interview_tracker.email_selected','update',{recipients:sent,test:testName||null});}catch(_e){}
  if(tested)tpTracker();
};
/* DELETING A CANDIDATE REMOVES THE CANDIDATE, NOT JUST THE LINE ON SCREEN.

   This used to delete from hr.interview_tracker and nothing else. That table is only the row you
   are looking at - the person lives in hr.candidates and their CV in hr.resumes - so a "deleted"
   candidate was still a candidate, and their CV stayed in the Resumes tab with nothing pointing
   at it and no way to tell whose it had been.

   hr.candidate_delete does all three and hands back the storage paths of the CV files, because a
   database call can delete a row but not a file in S3. The files are removed afterwards: a file
   left behind is waste, whereas a row left behind is a ghost candidate, so the rows go first and
   a failure to delete the file does not hold up the delete. */
window.tpTrDeleteSel=async function(){
  if(!recGuard())return;
  const ids=[...TP_TR_SEL]; if(!ids.length)return;
  const names=ids.map(id=>((TP_TR_RECORDS||[]).find(r=>r.id===id)||{}).candidate_name).filter(Boolean);
  if(!await confirmDialog(
      'Delete '+ids.length+' candidate'+(ids.length===1?'':'s')
      +(names.length&&names.length<=3?(' — '+names.join(', ')):'')
      +'? Their CV, any interviews booked for them, and the referral that put them forward are '
      +'deleted as well. This cannot be undone.',
      {title:'Delete candidate'+(ids.length===1?'':'s'), okLabel:'Delete', icon:'fa-trash', danger:true}))return;
  let paths=[];
  try{
    const {data,error}=await sb.schema('hr').rpc('candidate_delete',{p_tracker_ids:ids});
    if(error)throw new Error(error.message);
    paths=(data||[]).map(r=>r&&r.storage_path).filter(Boolean);
  }catch(e){ toast('Could not delete: '+((e&&e.message)||e),'err'); return; }
  // Best effort, and deliberately not fatal - see above.
  let fileFails=0;
  await Promise.all(paths.map(pth=>s3Delete(pth).catch(()=>{fileFails++;})));
  TP_TR_RECORDS=(TP_TR_RECORDS||[]).filter(r=>!ids.includes(r.id));TP_TR_SEL=new Set();
  toast(ids.length+' deleted'+(paths.length?(' — '+paths.length+' CV'+(paths.length===1?'':'s')+' removed'):''),'ok');
  if(fileFails)toast(fileFails+' CV file'+(fileFails===1?'':'s')+' could not be removed from storage','warn');
  tpTrRender();
};

/* ── Monthly Update v2 — one row per position per month, live stage counts, deletable ── */
let TP_MU_MONTHS=null, TP_MU_CUR=null, TP_MU_ROWS=null;
async function tpMonthlyUpdate(){
  const b=$('recBody'); if(!b)return;
  b.innerHTML='<div class="empty" style="padding:40px"><i class="fa-solid fa-spinner fa-spin"></i></div>';
  try{const {data,error}=await sb.schema('hr').from('tracker_rows').select('month').order('month',{ascending:false});
    if(error)throw error;
    TP_MU_MONTHS=[...new Set((data||[]).map(r=>r.month))];
  }catch(e){b.innerHTML='<div class="empty" style="padding:40px;color:#c83232">'+esc(e.message)+'</div>';return;}
  const curMonth=new Date().toISOString().slice(0,7)+'-01';
  if(!TP_MU_MONTHS.includes(curMonth))TP_MU_MONTHS=[curMonth,...TP_MU_MONTHS];
  TP_MU_CUR=TP_MU_CUR||TP_MU_MONTHS[0];
  await tpMuLoad();
}
function tpMuMonthLabel(m){const[y,mo]=m.split('-');return['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo)-1]+' '+y;}
async function tpMuLoad(){
  const b=$('recBody'); if(!b)return;
  b.innerHTML='<div class="empty" style="padding:40px"><i class="fa-solid fa-spinner fa-spin"></i></div>';
  let rows=[];
  try{const {data,error}=await sb.schema('hr').from('tracker_rows').select('*,manpower_requests(department)').eq('month',TP_MU_CUR).order('position');
    if(error)throw error; rows=data||[];}catch(e){b.innerHTML='<div class="empty" style="padding:40px;color:#c83232">'+esc(e.message)+'</div>';return;}
  let counts={};
  if(rows.length){
    const {data:cands}=await sb.schema('hr').from('candidates').select('tracker_row_id,stage').in('tracker_row_id',rows.map(r=>r.id));
    (cands||[]).forEach(c=>{counts[c.tracker_row_id]=counts[c.tracker_row_id]||{};counts[c.tracker_row_id][c.stage]=(counts[c.tracker_row_id][c.stage]||0)+1;});
  }
  TP_MU_ROWS=rows;
  window._tpMuCounts=counts;   // kept so tpMuPick can redraw without refetching
  tpMuRender(counts);
}
/* MONTHLY PROGRESS SHOWS A SUBSET, AND THAT IS DELIBERATE.

   The report's columns are not the same thing as the stages a candidate can be at. Interview Done
   is a step somebody passes through on the way to Selected or Rejected, and as a column it was a
   number nobody read between two that are. Dropping it from the report does not remove the stage -
   candidates still reach it, the Interviews list still shows it, and hr.tracker_stages still
   knows it. Only the column is gone.

   Kept as its own list so the two can differ without one quietly changing the other. */
const TP_MU_COLS=TP_STAGES.filter(s=>s!=='Interview Done');

function tpMuRender(counts){
  const b=$('recBody'); if(!b)return;
  const rows=TP_MU_ROWS||[];
  const canAct=recCanWrite();
  /* THE ACTIONS LIVE AT THE TOP, AND THE ROW IS CHOSEN FIRST.

     Upload and Email were on every row, which put two buttons on each of ten lines and pushed the
     numbers - the thing this screen exists to show - off to the side. One toolbar, and you say
     which position it applies to by picking the row.

     A RADIO, NOT A TICK BOX. Both actions need exactly one position: CVs are filed against one
     vacancy, and the email window narrows to one position's candidates. Tick boxes would invite
     choosing three and then being told you cannot, so the control only allows what the action
     allows. */
  const selPos=TP_MU_SEL;
  /* A POSITION THAT HAS BEEN COMPLETED CANNOT BE UPLOADED TO OR EMAILED FROM.
     Complete means the hiring is closed out: feedback is locked for everyone on it and the send
     window has nobody left to offer. Leaving the two buttons live meant opening a form that could
     not be submitted and being told why only afterwards. They are switched off instead, with the
     reason - and the way to undo it - in the tooltip. */
  const selRow=selPos!=null?rows.find(function(r){return String(r.position||'')===String(selPos);}):null;
  const selDone=!!(selRow&&selRow.completed_at);
  const actWhy=!selPos?'Select a position first'
    :selDone?('\u201c'+selPos+'\u201d is marked Complete \u2014 press Undo on its row to reopen it')
    :'';
  const canUse=!!selPos&&!selDone;
  b.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
    <div class="sec-title" style="margin:0">Monthly Progress</div>
    <select class="sel" style="margin-left:8px" onchange="tpMuSwitchMonth(this.value)">${(TP_MU_MONTHS||[]).map(m=>`<option value="${m}"${m===TP_MU_CUR?' selected':''}>${tpMuMonthLabel(m)}</option>`).join('')}</select>
    ${canAct?`<div style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      ${selPos?`<span style="font-size:12px;color:var(--slate)">Selected: <b>${esc(selPos)}</b>${selDone?' <span class="tag t-gray" style="font-size:10px">complete</span>':''}</span>`:'<span style="font-size:12px;color:var(--slate)">Select a position to upload or email</span>'}
      <button class="btn" ${canUse?'':'disabled style="opacity:.45;cursor:not-allowed"'} title="${esc(actWhy||('Upload CVs for '+selPos))}" onclick="tpMuUpload()"><i class="fa-solid fa-upload"></i> Upload</button>
      <button class="btn" ${canUse?'':'disabled style="opacity:.45;cursor:not-allowed"'} title="${esc(actWhy||('Email the candidates on '+selPos))}" onclick="tpMuEmail()"><i class="fa-solid fa-envelope"></i> Email</button>
    </div>`:''}
  </div>
  <style>
    .tp-mu-row:hover{background:#eff6ff}
    .tp-mu-row:hover .tp-mu-go{opacity:1}
  </style>
  <div style="font-size:12px;color:var(--slate);margin-bottom:12px">One row per position, counted automatically as people move through their stages — nothing here is typed in. <b>Click a row</b> to see the people behind its numbers.</div>
  <div style="overflow-x:auto"><table class="tbl" style="min-width:1100px">
    <thead><tr>${canAct?'<th style="width:34px"></th>':''}<th>Position</th><th>Department</th>${TP_MU_COLS.map(s=>`<th style="text-align:center;font-size:11px">${esc(s)}</th>`).join('')}${canAct?'<th></th>':''}</tr></thead>
    <tbody>${rows.length?rows.map(r=>{
      const c=counts[r.id]||{};
      /* A GRID OF NUMBERS YOU CANNOT OPEN IS A DEAD END. You could read "3" against Tests Sent and
         had no way to find out which three - you went to Interviews and read the whole list. The
         row now carries you there with that position already filtered, and it LOOKS like it will:
         a hover state, a pointer, and a chevron that appears on the row. An affordance nobody can
         see is the same as not having one, which is the mistake the Hiring Request rows made. */
      const isSel=selPos!=null&&String(r.position||'')===String(selPos);
      return `<tr class="tp-mu-row"${isSel?' style="background:#eff6ff"':' style="cursor:pointer"'} onclick="tpMuOpenPeople(${esc(JSON.stringify(r.position||''))})" title="See the people for ${esc(r.position||'this position')}">
        ${canAct?`<td onclick="event.stopPropagation()" style="text-align:center">
          <input type="radio" name="tpMuPick" ${isSel?'checked':''} onchange="tpMuPick(${esc(JSON.stringify(r.position||''))})" title="Choose this position">
        </td>`:''}
        <td style="font-weight:600">${esc(r.position||'—')}${r.carried_from_row_id?' <span class="tag t-amber" style="margin-left:4px">carried</span>':''}
          <i class="fa-solid fa-chevron-right tp-mu-go" style="margin-left:6px;font-size:10px;color:var(--brand);opacity:0;transition:opacity .12s"></i></td>
        <td style="font-size:12px;color:var(--slate)">${esc((r.manpower_requests&&r.manpower_requests.department)||'—')}</td>
        ${TP_MU_COLS.map(s=>`<td style="text-align:center">${c[s]||0}</td>`).join('')}
        ${canAct?`<td onclick="event.stopPropagation()">${r.completed_at
            ?`<button class="btn btn-sm" onclick="tpMuUncompleteRow(${r.id})" title="Completed ${esc(new Date(r.completed_at).toLocaleDateString())} — click to reopen"><i class="fa-solid fa-rotate-left"></i> Undo</button>`
            :`<button class="btn btn-sm btn-primary" onclick="tpMuCompleteRow(${r.id})"><i class="fa-solid fa-check-double"></i> Complete</button>`}</td>`:''}
      </tr>`;
    }).join(''):`<tr><td colspan="${2+TP_MU_COLS.length+(canAct?2:0)}" style="text-align:center;padding:40px;color:var(--slate)">No positions for this month yet</td></tr>`}
    </tbody>
  </table></div>`;
}
let TP_MU_SEL=null;
window.tpMuPick=function(position){
  TP_MU_SEL=String(position||'')||null;
  /* Redrawn rather than patched, so the toolbar's enabled state, its "Selected: ..." line and the
     highlighted row can never disagree with the radio. */
  tpMuRender(window._tpMuCounts||{});
};
window.tpMuSwitchMonth=function(m){TP_MU_CUR=m;TP_MU_SEL=null;tpMuLoad();};

/* UPLOAD AND EMAIL, FROM THE ROW OF THE POSITION THEY ARE ABOUT.

   Both of these were possible already, in two other places, and both needed the position chosen
   again by hand once you got there - which is how CVs end up filed against the wrong vacancy and
   how a test goes to somebody from a different role. Starting from the row means the position is
   already decided and cannot be got wrong.

   Monthly Progress rows are keyed by job title rather than by the hiring request id, so the title
   is what gets matched. Where a title has no open request behind it - a closed or carried row -
   Upload says so instead of opening a window that cannot file anything. */
/* STRAIGHT TO THE FILE PICKER. The position is already chosen - it is the row you ticked - so a
   window that exists only to ask for it again is a step that asks a question already answered.
   The picker opens, the files upload against that position, and the only thing on screen is
   progress.

   The <input> is created, used and thrown away each time rather than kept in the page, so choosing
   the same file twice in a row still fires a change event. */
window.tpMuUpload=async function(){
  const position=TP_MU_SEL;
  if(!position){ toast('Choose a position first','err'); return; }
  if(tpMuRowDone(position)){ toast(tpMuDoneWhy(position),'err'); return; }
  let positions=[];
  try{ positions=await hrOpenPositions(); }
  catch(e){ toast('Could not read the open positions: '+((e&&e.message)||e),'err'); return; }
  const match=positions.find(function(x){return String(x.job_title||'')===String(position||'');});
  if(!match){
    toast('There is no open hiring request for \u201c'+(position||'this position')+'\u201d, so CVs cannot be filed against it','err');
    return;
  }
  const inp=document.createElement('input');
  inp.type='file'; inp.multiple=true; inp.accept='.pdf,.doc,.docx,.png,.jpg,.jpeg';
  inp.style.display='none';
  document.body.appendChild(inp);
  inp.onchange=async function(){
    const files=inp.files?Array.prototype.slice.call(inp.files):[];
    document.body.removeChild(inp);
    if(!files.length) return;
    await rsUploadFiles(files, match.id, match.job_title||position);
  };
  inp.click();
};

/* The upload itself, with no window around it. rsUploadSave reads the form; this takes what it is
   given, so both the window and the direct picker end at the same code and cannot drift into
   filing CVs differently. */
window.rsUploadFiles=async function(files,posId,posText){
  const added=[]; const failed=[];
  toast('Uploading '+files.length+' file'+(files.length===1?'':'s')+'\u2026');
  for(let i=0;i<files.length;i++){
    const f=files[i];
    try{
      const up=await uploadFileToS3(s3KeyForResume(f.name),f);
      if(up.error) throw new Error(up.error.message);
      const {data:row,error}=await sb.schema('hr').from('resumes').insert({
        file_name:f.name, storage_path:up.data.path, file_size:f.size,
        file_type:(f.name.split('.').pop()||'').toLowerCase(), ai_status:'analyzing',
        manpower_request_id:Number(posId), position:posText||null,
        uploaded_by:state.email||null
      }).select().single();
      if(error) throw new Error(error.message);
      added.push(row);
    }catch(e){ failed.push(f.name+' ('+((e&&e.message)||e)+')'); }
  }
  if(added.length){
    RS_ROWS=added.slice().reverse().concat(RS_ROWS||[]);
    toast(added.length+' CV'+(added.length===1?'':'s')+' uploaded for '+(posText||'this position'),'ok');
    rsParseUploaded(added.map(function(r){return r.id;}));
  }
  if(failed.length) toast('Could not upload: '+failed.slice(0,3).join(', ')+(failed.length>3?(' and '+(failed.length-3)+' more'):''),'err');
};

/* Everybody on this position, already ticked. The window is the same one Tests uses, so the rules
   that matter still hold - the addresses come from the Interviews list, never typed, and anyone
   already sent a test or past that stage is not in it. Pre-ticking is the only difference: on a
   position's own row the normal case is "all of them", and unticking the odd one is less work than
   ticking nine. */
/* The buttons are already switched off for a completed position; these are here for a screen
   left open while somebody else closed it out. */
function tpMuRowDone(position){
  const r=(TP_MU_ROWS||[]).find(function(x){return String(x.position||'')===String(position||'');});
  return !!(r&&r.completed_at);
}
function tpMuDoneWhy(position){
  return '\u201c'+position+'\u201d is marked Complete \u2014 press Undo on its row to reopen it';
}
window.tpMuEmail=async function(){
  const position=TP_MU_SEL;
  if(!position){ toast('Choose a position first','err'); return; }
  if(tpMuRowDone(position)){ toast(tpMuDoneWhy(position),'err'); return; }
  if(!rtCanManage()){ toast('Only the test owners can email candidates','err'); return; }
  if(!RT_RECORDS){
    try{
      const {data,error}=await sb.schema('recruit').from('tests').select('*').order('sl',{ascending:true});
      if(error) throw error;
      RT_RECORDS=data||[];
    }catch(e){ toast('Could not load the tests: '+((e&&e.message)||e),'err'); return; }
  }
  TP_MU_EMAIL_POS=String(position||'')||null;
  await rtShare(true);
};
let TP_MU_EMAIL_POS=null;
window.tpMuOpenMonth=async function(){
  if(!recGuard())return;
  const {error}=await sb.schema('hr').rpc('tracker_open_month',{p_month:null});
  if(error){toast(error.message,'err');return;}
  toast('Refreshed');await tpMonthlyUpdate();
};
// Replaces the old tpMuDeleteRow -- a filled position should be closed out, not deleted (it's
// expected to have candidates linked, unlike the old delete which refused exactly that case).
// Completing locks every one of this row's candidates' Feedback dropdowns in Interview Tracker
// (see tpTrRender's completedRowIds check).
window.tpMuCompleteRow=async function(id){
  if(!recGuard())return;
  // Its own words and colour: the default dialog says "Delete" in red, which this is not.
  if(!await confirmDialog('Mark this position complete? Stages will be locked for all its candidates in Interviews.',
      {title:'Complete position', okLabel:'Complete', icon:'fa-flag-checkered', danger:false}))return;
  const {error}=await sb.schema('hr').from('tracker_rows').update({completed_at:new Date().toISOString()}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  toast('Marked complete');await tpMuLoad();
};
window.tpMuUncompleteRow=async function(id){
  if(!recGuard())return;
  const {error}=await sb.schema('hr').from('tracker_rows').update({completed_at:null}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  toast('Reopened \u2014 this position can take candidates again');await tpMuLoad();
};

VIEWS.campaigns=async function(v,seg){
  setCrumb(['Growth & Strategy','Our Brand']);
  if(CMP_SOURCE==='google'){ return cmpGoogleView(v,seg); }
  if(CMP_SOURCE==='both'){ return cmpBothView(v,seg); }
  const tabs=cmpBaseTabs();const ti=mTab(seg,tabs.length);
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
  v.innerHTML=cmpCss+CMP_EXTRA_CSS+mHead('fa-bullhorn','#db2777','Our Brand')+cmpSourceBar()+cmpPeriodBar()+cmpTabsBar(tabs,ti)+'<div style="margin-top:14px">'+(showKpis?kpiStrip:'')+syncCap+legend+body+'</div>';
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
VIEWS.scaling=function(v,seg){
  setCrumb(['Growth & Strategy','Scaling Up']);
  const tabs=['Strategy (OPSP)','Priorities (Rocks)','KPI scoreboard','Meeting rhythm','Learning hub'];const ti=mTab(seg,tabs.length);
  let body;
  if(ti===0){
    const txt=(t,b)=>'<div class="card card-pad"><div class="sec-title" style="margin:0 0 8px">'+t+'</div><p style="color:#3C4B59;font-size:13.5px;line-height:1.5">'+b+'</p></div>';
    const lst=(t,rows)=>'<div class="card card-pad"><div class="sec-title" style="margin:0 0 4px">'+t+'</div>'+rows.map(r=>'<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line-2)"><span style="color:var(--slate)">'+esc(r[0])+'</span><b>'+esc(r[1])+'</b></div>').join('')+'</div>';
    body='<div class="m3grid">'+txt('Core purpose','Building landmark spaces that families and businesses are proud to own.')+txt('Core values','Integrity · Quality · On-time delivery · Customer-first · Discipline.')+txt('BHAG (10-yr)','Be Central India’s most-trusted developer — 10,000 homes delivered, zero RERA defaults.')+
      lst('3-yr target',[['Revenue','₹450 Cr'],['Active projects','10'],['Units / yr','600']])+lst('1-yr plan (FY26-27)',[['Revenue','₹165 Cr'],['Bookings','260 units'],['Collections','92%+']])+lst('Brand promise KPIs',[['On-time handover','≥ 95%'],['CSAT','≥ 4.5 / 5'],['Snag closure','≤ 7 days']])+'</div>';
  } else if(ti===1){ body=mTable(['Rock','Owner','Quarter','Progress','Status'],[['Launch Riverdale Ph-1','Rishi','Q2','45%','On Track'],['Digitise procurement','Ops','Q2','70%','On Track']]); }
  else if(ti===2){ body=mTable(['KPI','Target','Actual','Status'],[['On-time handover','≥95%','93%','Watch'],['CSAT','≥4.5','4.6','Good']]); }
  else if(ti===3){ body=mTable(['Meeting','Cadence','Owner','Next'],[['Daily huddle','Daily','Ops','Tomorrow'],['Weekly L10','Weekly','Leadership','Mon']]); }
  else { body=mTable(['Resource','Type','Added'],[['Scaling Up (Verne Harnish)','Book','Jun 26'],['OKR masterclass','Course','May 26']]); }
  v.innerHTML=mHead('fa-arrow-trend-up','#0d9488','Scaling Up')+mTabs('scaling',tabs,ti)+'<div style="margin-top:16px">'+body+'</div>';
};
VIEWS.playbook=function(v,seg){
  setCrumb(['Growth & Strategy','Playbook']);
  const tabs=['All plays','Featured play','Roles (RACI)'];const ti=mTab(seg,tabs.length);
  let body;
  if(ti===0){
    const pills=['All','Sales','Projects','Procurement','HR','Finance','Legal'].map((p,i)=>'<button class="btn btn-sm'+(i===0?' btn-primary':'')+'">'+p+'</button>').join(' ');
    body='<div class="card card-pad"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px"><div style="flex:1;min-width:170px"><input class="sel" style="width:100%;height:38px" placeholder="Search plays…"></div>'+pills+'</div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Play</th><th>Department</th><th>Steps</th><th>Owner</th><th>Runs in</th><th>Status</th></tr></thead><tbody>'+
      [['Lead → Booking','Sales','8','Sales Head','CRM','<span class="tag t-green">Live · v3</span>'],['Booking → Registration','Sales / Legal','7','Sales Head','CRM + Legal','<span class="tag t-green">Live · v2</span>'],['Indent → Goods receipt','Procurement','6','Procurement Mgr','Procurement','<span class="tag t-green">Live · v2</span>'],['Contractor onboarding','Procurement / Legal','5','Procurement Mgr','Procurement','<span class="tag t-green">Live · v1</span>'],['Stage handover (unit)','Projects','6','Projects Head','Projects','<span class="tag t-green">Live · v2</span>'],['Hire → Induct','HR','9','HR Manager','Recruitment + HR','<span class="tag t-green">Live · v2</span>'],['Monthly compliance close','Finance / Legal','7','CFO','Compliance','<span class="tag t-green">Live · v1</span>'],['Demand → Collection','Finance','5','CFO','CRM + Finance','<span class="tag t-amber">Draft · v1</span>']].map(r=>'<tr><td><b>'+r[0]+'</b></td><td>'+r[1]+'</td><td>'+r[2]+'</td><td>'+r[3]+'</td><td>'+r[4]+'</td><td>'+r[5]+'</td></tr>').join('')+'</tbody></table></div></div>';
  } else if(ti===1){ body=mCard('Featured play — Lead → Booking',mStep(['Capture','Qualify','Site visit','Negotiate','Token','Booking','Agreement','Register'],'Site visit')); }
  else { body=mTable(['Step','Responsible','Accountable','Consulted','Informed'],[['Site visit','Sales Exec','Sales Head','CRM','Director'],['Booking','Sales Head','Director','Finance','Legal']]); }
  v.innerHTML=mHead('fa-book-open','#4338ca','Playbook')+mTabs('playbook',tabs,ti)+'<div style="margin-top:16px">'+body+'</div>';
};

/* ---------- COMPETITOR ADS — Meta Ad Library watchlist ---------- */
// Tracks a watchlist of competitors - and, on the Our Brands tab, our own pages - against Meta's
// public Ad Library, pulled through Proxy by the competitor-sync-test-probe edge function both
// nightly (cron) and from the Fetch button. Sourced from camp.competitor_watchlist /
// camp.competitor_ads; is_own_brand decides which tab a page sits on.
const COMP_PLATFORM_ICON={FACEBOOK:'fa-facebook',INSTAGRAM:'fa-instagram',WHATSAPP:'fa-whatsapp',MESSENGER:'fa-facebook-messenger',THREADS:'fa-threads'};
window._compAdsAll=window._compAdsAll||[];
window._compSignCache=window._compSignCache||{};
/* ---- Competitor Ads -----------------------------------------------------------------------
   One filter bar drives BOTH what you see and what gets scraped. Picking a competitor, a date
   range, a status and a media type filters the ads already stored; pressing Sync sends those same
   four choices to Meta's Ad Library, so you fetch exactly the slice you are looking at instead of
   pulling everything and sifting afterwards (which is billed per ad).                          */
const COMP_RANGES=[
  ['all','All time','fa-infinity'],
  ['last_7','Last 7 days','fa-calendar-day'],
  ['last_30','Last 30 days','fa-calendar-week'],
  ['last_90','Last 90 days','fa-calendar-days'],
  ['this_year','This year','fa-calendar'],
  ['custom','Custom range','fa-sliders']
];
const COMP_MEDIA=[['all','All media','fa-shapes'],['image','Images','fa-image'],['video','Videos','fa-video'],['carousel','Carousels','fa-images']];
const COMP_STATUS=[['all','Active & inactive','fa-layer-group'],['active','Active only','fa-circle-play'],['inactive','Inactive only','fa-circle-stop']];
let COMP_F={wl:'all',range:'last_30',from:'',to:'',status:'all',media:'all',q:''};
/* Three views over the one watchlist, by its category: other developers, our own pages, and our
   channel partners. Everything below - the picker, the table, the grid - only ever sees the rows
   of the open view, so our ads never sit among a competitor's or a partner's.
   They used to be three tabs of one Competitor Ads page. Since 16 Oct 2026 each lives in its own
   module (src/core/40-marketing-modules.js): competitors on Competitor Data (competitors), our
   own pages as the Meta Ad Library tab of Our Brand (campaigns/meta-ads), and partners on Channel
   Partners (channel_partners). compMetaView() draws whichever one into the host it is given.
   Each entry: [key, title, icon, category, [singular, plural], noun for buttons]. */
let COMP_TAB='competitors';
const COMP_TABS=[
  ['competitors','Competitors','fa-chess-knight','competitor',['competitor','competitors'],'Competitor'],
  ['brands','Our Brands','fa-building-flag','brand',['brand','brands'],'Brand'],
  ['partners','Channel Partners','fa-handshake','partner',['channel partner','channel partners'],'Channel Partner']
];
function compTabDef(){ return COMP_TABS.filter(function(t){ return t[0]===COMP_TAB; })[0]||COMP_TABS[0]; }
function compIsBrandTab(){ return COMP_TAB==='brands'; }
function compWord(n){ return compTabDef()[4][n===1?0:1]; }
function compTabNoun(){ return compTabDef()[5]; }
// Rows from before the category column fall back to is_own_brand.
function compCategoryOf(w){ return w.category||(w.is_own_brand?'brand':'competitor'); }
/* Channel Partners: only the ones that are actually pulled (27 Oct 2026, as asked - "temporarily").
   A partner without a Facebook Page ID is never pulled, so it only filled the list with empty rows;
   those 38 stay in the database, hidden here. Set COMP_SHOW_UNPULLED_PARTNERS to true to show them. */
const COMP_SHOW_UNPULLED_PARTNERS=false;
function compTabWl(){ const c=compTabDef()[3]; return (window._compWl||[]).filter(function(w){
  if(compCategoryOf(w)!==c) return false;
  if(c==='partner' && !COMP_SHOW_UNPULLED_PARTNERS && !String(w.page_id||'').trim()) return false;
  return true; }); }
/* Stored ads show straight away. They used to wait for a fetch in this visit, because the old
   scraper fetched exactly the filtered slice; the Proxy pull now runs every night for every page,
   so what is stored is current and the filters simply narrow it. */
function compRangeDates(){
  const d=new Date(); d.setHours(12,0,0,0);
  const iso=x=>x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
  const back=n=>{const x=new Date(d.getTime());x.setDate(x.getDate()-n);return x;};
  switch(COMP_F.range){
    case 'last_7':    return {from:iso(back(7)),  to:iso(d)};
    case 'last_30':   return {from:iso(back(30)), to:iso(d)};
    case 'last_90':   return {from:iso(back(90)), to:iso(d)};
    case 'this_year': return {from:d.getFullYear()+'-01-01', to:iso(d)};
    case 'custom':    return (COMP_F.from&&COMP_F.to)?{from:COMP_F.from,to:COMP_F.to}:null;
    default:          return null;
  }
}
function compAdMediaKind(a){
  const items=Array.isArray(a.media_items)?a.media_items:[];
  if(items.length>1) return 'carousel';
  const t=(items[0]&&items[0].media_type)||a.media_type||'';
  return t==='video'?'video':(t?'image':'');
}
// The ads currently on screen, after every filter in the bar.
function compFiltered(){
  const all=window._compAdsAll||[];
  const win=compRangeDates();
  const q=(COMP_F.q||'').trim().toLowerCase();
  const onTab={}; compTabWl().forEach(function(w){ onTab[w.id]=true; });
  return all.filter(function(a){
    if(!onTab[a.watchlist_id]) return false;
    if(COMP_F.wl!=='all' && String(a.watchlist_id)!==String(COMP_F.wl)) return false;
    const running=!a.ad_delivery_stop_time;
    if(COMP_F.status==='active' && !running) return false;
    if(COMP_F.status==='inactive' && running) return false;
    if(COMP_F.media!=='all' && compAdMediaKind(a)!==COMP_F.media) return false;
    // Match Meta's own meaning. Its filter chip reads "Impressions by date", i.e. ads that were
    // RUNNING at some point inside the window - not ads that STARTED inside it. An ad that began
    // in June and is still running today belongs in a July window, and filtering on the start date
    // alone wrongly dropped it, making our counts disagree with the Ad Library.
    if(win){
      const s=a.ad_delivery_start_time?String(a.ad_delivery_start_time).slice(0,10):'';
      if(!s || s>win.to) return false;                       // began after the window closed
      const e=a.ad_delivery_stop_time?String(a.ad_delivery_stop_time).slice(0,10):'';
      if(e && e<win.from) return false;                      // finished before it opened
    }
    if(q){
      const blob=[(Array.isArray(a.ad_creative_bodies)?a.ad_creative_bodies.join(' '):''),a.headline,a.description,a.page_name,a.cta_text,a.id]
        .filter(Boolean).join(' ').toLowerCase();
      if(blob.indexOf(q)===-1) return false;
    }
    return true;
  }).sort(function(x,y){ return String(y.ad_delivery_start_time||'').localeCompare(String(x.ad_delivery_start_time||'')); });
}
// Picking a row narrows the board to that page. Its stored ads are current (pulled nightly), so
// nothing is fetched here - Fetch from Meta is still there for a pull right now.
window.compShowOnly=function(id){
  COMP_F.wl=String(id);
  compPaint();
};
window.compSetFilter=function(k,val){
  COMP_F[k]=val;
  if(k==='range'&&val==='custom'&&(!COMP_F.from||!COMP_F.to)){
    const w=compRangeDates()||{}; const d=new Date();
    COMP_F.to=w.to||(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'));
    const b=new Date(); b.setDate(b.getDate()-30);
    COMP_F.from=w.from||(b.getFullYear()+'-'+String(b.getMonth()+1).padStart(2,'0')+'-'+String(b.getDate()).padStart(2,'0'));
  }
  compPaint();
};
window.compSetDate=function(which,val){
  COMP_F[which]=val;
  // To can never be before From
  if(COMP_F.from&&COMP_F.to&&COMP_F.to<COMP_F.from){
    if(which==='from') COMP_F.to=''; else { COMP_F.to=COMP_F.from; toast('To date cannot be before the From date','warn'); }
  }
  compPaint();
};
window.compSearch=function(val){ COMP_F.q=val; window._compShow=60; const g=$('compGrid'); if(g) compPaintGrid(); usageQueueDebounced('competitors.overview.search_ad_text_headline_or_page', val); };

/* Draws one watchlist view - key 'competitors', 'brands' or 'partners' (COMP_TABS) - into host,
   below whatever page header and tab bar the calling module has already drawn. The page shells
   live in src/core/40-marketing-modules.js; this only owns the Meta Ad Library part. Switching
   view clears the "one page only" pick, because a competitor's id means nothing on Our Brand. */
async function compMetaView(host,key){
  const tab=COMP_TABS.some(function(t){ return t[0]===key; })?key:'competitors';
  if(tab!==COMP_TAB){ COMP_TAB=tab; COMP_F.wl='all'; }
  /* Kept bare (26 Oct 2026, as asked: "remove so much text"): no explanatory paragraph and no
     schedule / credits line. Competitor Data has no Add or Pull button either - competitors are
     pulled only by the scheduled job. Our Brand and Channel Partners keep Add and Pull all now. */
  host.innerHTML=''
    +(COMP_TAB==='competitors'?'':'<div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin:0 0 12px">'
        +'<button class="btn" onclick="compAddModal()"><i class="fa-solid fa-plus"></i> Add '+esc(compTabNoun())+'</button>'
        +'<button class="btn btn-primary" id="compSyncBtn" onclick="compManualPull()"><i class="fa-solid fa-rotate"></i> Pull all now</button>'
      +'</div>')
    +'<div id="compProxyWarn"></div>'
    +'<div id="compPullStatus"></div>'
    +'<div id="compToolbar"></div>'
    +'<div id="compBody"><div class="loader"><div class="spin"></div></div></div>';
  await Promise.all([compRender(), compLoadStatus(), compCheckProxy()]);
}
/* WHEN THE PROXY SIGN-IN LAPSES, SAY SO AND OFFER THE FIX (26 Oct 2026). From 22 Oct every pull
   failed with "Proxy would not renew" and nothing on screen said so - the ads simply stopped
   getting newer. The newest finished pull decides: if it failed on the sign-in, a red line with a
   Reconnect button appears on every Meta Ads view. */
async function compCheckProxy(){
  const host=$('compProxyWarn'); if(!host) return;
  let bad=false;
  try{
    const {data}=await sb.schema('camp').from('competitor_pull_queue').select('status,error,finished_at')
      .not('finished_at','is',null).order('finished_at',{ascending:false}).limit(1);
    const r=data&&data[0];
    bad=!!(r&&r.status==='failed'&&/would not renew|not connected/i.test(r.error||''));
  }catch(_e){}
  host.innerHTML=bad
    ?'<div class="card card-pad" style="margin:0 0 14px;border-color:#fecaca;background:#fef2f2;color:#b91c1c;display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px">'
      +'<span style="flex:1;min-width:220px"><i class="fa-solid fa-plug-circle-xmark"></i> <b>Facebook ads are not updating.</b> JainE\'s sign-in to Proxy has expired.</span>'
      +'<button class="btn btn-primary" onclick="compProxyModal()"><i class="fa-solid fa-plug"></i> Reconnect Proxy</button></div>'
    :'<div style="display:flex;justify-content:flex-end;margin:0 0 8px"><button class="btn" style="height:30px;font-size:12.5px" onclick="compProxyModal()" title="The Proxy accounts Facebook ads are pulled with"><i class="fa-solid fa-plug"></i> Proxy accounts</button></div>';
}
async function compProxyCall(action,body){
  const {data:{session}}=await sb.auth.getSession();
  const res=await fetch(SUPABASE_URL+'/functions/v1/competitor-sync-test-probe?action='+action,{method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+((session&&session.access_token)||''),'apikey':SUPABASE_KEY},
    body:JSON.stringify(body||{})});
  const jr=await res.json().catch(function(){ return {}; });
  if(!res.ok||jr.error) throw new Error(jr.error||('HTTP '+res.status));
  return jr;
}
/* SEVERAL PROXY ACCOUNTS (27 Oct 2026). Each gives 20 free pages a day; the puller uses them one
   after another, moving on when one says its credits are spent. This lists them - working, used
   up for today, or signed out - and adds, reconnects or removes one. */
window._compProxyFor=null;   // the account being reconnected; null = adding a new one
window.compProxyModal=async function(){
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-plug"></i> Proxy accounts</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" id="compProxyBody" style="font-size:13.5px;line-height:1.6;min-width:min(92vw,460px)"><div class="loader"><div class="spin"></div></div></div>','md');
  let list=[];
  try{ list=(await compProxyCall('status')).accounts||[]; }
  catch(e){ const b=$('compProxyBody'); if(b) b.innerHTML='<p style="color:#b91c1c">'+esc(e.message||String(e))+'</p>'; return; }
  const b=$('compProxyBody'); if(!b) return;
  const day=function(x){ return x?new Date(x).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):''; };
  const rows=list.map(function(a,i){
    const state=!a.connected?['Signed out','#b91c1c']:a.used_up_today?['Used up today','#b45309']
      :(a.last_error&&/renew|not connected/i.test(a.last_error))?['Signed out','#b91c1c']:['Working','#15803d'];
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)">'
      +'<div style="flex:1;min-width:0"><b>Account '+(i+1)+'</b>'+(a.email?(' · '+esc(a.email)):'')
        +' <span style="color:'+state[1]+';font-weight:600;font-size:12.5px">'+state[0]+'</span>'
        +'<div style="font-size:12px;color:var(--slate)">'+(a.connected_by?('Signed in by '+esc(a.connected_by)+(a.connected_at?(', '+esc(day(a.connected_at))):'')):'')
        +(a.last_used_at?(' · last used '+esc(day(a.last_used_at))):'')+'</div></div>'
      +'<button class="btn" style="height:30px;font-size:12.5px" onclick="compProxySignIn('+a.id+')">Reconnect</button>'
      +'<button class="btn" style="height:30px;font-size:12.5px" onclick="compProxyRemove('+a.id+')" title="Remove this account"><i class="fa-solid fa-trash"></i></button>'
    +'</div>';
  }).join('');
  b.innerHTML=(rows||'<p style="margin:0 0 8px;color:var(--slate)">No Proxy account is connected.</p>')
    +'<p style="margin:12px 0 0;color:var(--slate);font-size:12.5px">Each account gives 20 pages a day; they are used one after another.</p>'
    +'<button class="btn btn-primary" style="margin-top:12px" onclick="compProxySignIn(null)"><i class="fa-solid fa-plus"></i> Add another account</button>';
};
window.compProxySignIn=function(id){
  window._compProxyFor=id;
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-plug"></i> '+(id?'Reconnect Proxy account':'Add a Proxy account')+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="font-size:13.5px;line-height:1.6">'
      +'<p style="margin:0 0 10px"><b>1.</b> Press the button and sign in to Proxy in the tab that opens'+(id?'':' - with the account you are adding')+'.</p>'
      +'<button class="btn btn-primary" onclick="compProxyBegin()"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open Proxy sign-in</button>'
      +'<p style="margin:16px 0 6px"><b>2.</b> After signing in, that tab shows <i>"This site can\'t be reached"</i>. That is expected. Copy the whole address from its address bar and paste it here:</p>'
      +'<input id="compProxyBack" placeholder="http://127.0.0.1:8765/callback?code=…" style="width:100%;height:38px;border:1px solid var(--line);border-radius:9px;padding:0 10px;font-family:inherit">'
    +'</div>'
    +'<div class="modal-foot"><button class="btn" onclick="compProxyModal()">Back</button><button class="btn btn-primary" id="compProxyDone" onclick="compProxyFinish()"><i class="fa-solid fa-check"></i> Connect</button></div>','md');
};
window.compProxyRemove=async function(id){
  if(!confirm('Remove this Proxy account from JainE?')) return;
  try{ await compProxyCall('remove',{account_id:id}); toast('Proxy account removed','ok'); }
  catch(e){ toast(e.message||String(e),'err'); }
  compProxyModal();
};
window.compProxyBegin=async function(){
  // The tab is opened before the wait, so the browser does not treat it as an unasked pop-up.
  const tab=window.open('about:blank','_blank');
  try{ const r=await compProxyCall('begin',window._compProxyFor?{account_id:window._compProxyFor}:{}); if(tab) tab.location.href=r.url; else window.open(r.url,'_blank'); }
  catch(e){ if(tab) tab.close(); toast(e.message||String(e),'err'); }
};
window.compProxyFinish=async function(){
  const v=(($('compProxyBack')&&$('compProxyBack').value)||'').trim();
  if(!v){ toast('Paste the address from the sign-in tab first','warn'); return; }
  const b=$('compProxyDone'); if(b){ b.disabled=true; b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Connecting…'; }
  try{
    await compProxyCall('finish',{url:v});
    closeModal(); toast((window._compProxyFor?'Proxy reconnected':'Proxy account added')+' - the waiting pages start pulling now','ok');
    try{ await compWork(); }catch(_e){}
    compCheckProxy();
  }catch(e){
    toast(e.message||String(e),'err');
    if(b){ b.disabled=false; b.innerHTML='<i class="fa-solid fa-check"></i> Connect'; }
  }
};
function compSelHtml(id,list,cur,onchange){
  return '<select class="comp-sel" id="'+id+'" onchange="'+onchange+'">'
    +list.map(function(o){ return '<option value="'+o[0]+'"'+(String(cur)===String(o[0])?' selected':'')+'>'+esc(o[1])+'</option>'; }).join('')
  +'</select>';
}
function compToolbarHtml(wl){
  const win=compRangeDates();
  const opts=[['all','All '+compWord(2)+' ('+wl.length+')']].concat(wl.map(function(w){
    const n=(window._compAdsAll||[]).filter(function(a){return a.watchlist_id===w.id;}).length;
    return [String(w.id), w.name+' ('+n+')'];
  }));
  const cur=(COMP_F.wl!=='all')?wl.filter(function(w){return String(w.id)===String(COMP_F.wl);})[0]:null;
  return '<style>'
    +'.comp-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:13px 14px;border:1px solid var(--line);border-radius:12px;background:var(--bg-card);margin-bottom:14px}'
    +'.comp-sel{height:36px;padding:0 32px 0 11px;border:1px solid var(--line);border-radius:9px;font-size:13px;font-weight:600;font-family:inherit;background:var(--bg-card);color:var(--ink);cursor:pointer;appearance:none;-webkit-appearance:none;'
      +'background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 12 8\'%3E%3Cpath d=\'M1 1l5 5 5-5\' stroke=\'%230369a1\' stroke-width=\'2\' fill=\'none\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 11px center;background-size:11px 8px}'
    +'.comp-sel:hover{border-color:var(--slate)}'
    +'.comp-sel:focus{outline:none;border-color:#0369a1;box-shadow:0 0 0 3px rgba(3,105,161,.13)}'
    +'.comp-date{height:36px;border:1px solid var(--line);border-radius:9px;padding:0 9px;font-size:12.5px;font-family:inherit;background:var(--bg-card);color:var(--ink)}'
    +'.comp-date:focus{outline:none;border-color:#0369a1;box-shadow:0 0 0 3px rgba(3,105,161,.13)}'
    +'.comp-search{position:relative;display:flex;align-items:center;flex:1;min-width:150px}'
    +'.comp-search i{position:absolute;left:11px;color:var(--slate);font-size:12.5px;pointer-events:none}'
    +'.comp-search input{width:100%;height:36px;padding:0 11px 0 31px;border:1px solid var(--line);border-radius:9px;font-size:13px;font-family:inherit;background:var(--bg-card);color:var(--ink)}'
    +'.comp-search input:focus{outline:none;border-color:#0369a1;box-shadow:0 0 0 3px rgba(3,105,161,.13)}'
    +'.comp-note{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--slate);padding:0 2px;margin:-6px 0 14px}'
    +'.comp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:13px}'
    +'@media(max-width:760px){.comp-bar{gap:8px}.comp-sel,.comp-search{flex:1 1 100%}.comp-search{min-width:0}}'
  +'</style>'
  +'<div class="comp-bar">'
    +compSelHtml('compWl',opts,COMP_F.wl,'compSetFilter(\'wl\',this.value)')
    +compSelHtml('compRange',COMP_RANGES.map(function(r){return [r[0],r[1]];}),COMP_F.range,'compSetFilter(\'range\',this.value)')
    +(COMP_F.range==='custom'
      ?('<input type="date" class="comp-date" value="'+esc(COMP_F.from)+'" onchange="compSetDate(\'from\',this.value)">'
        +'<span style="color:var(--slate);font-size:12px">to</span>'
        +'<input type="date" class="comp-date" min="'+esc(COMP_F.from)+'" value="'+esc(COMP_F.to)+'" onchange="compSetDate(\'to\',this.value)">')
      :'')
    +compSelHtml('compStatus',COMP_STATUS.map(function(r){return [r[0],r[1]];}),COMP_F.status,'compSetFilter(\'status\',this.value)')
    +compSelHtml('compMedia',COMP_MEDIA.map(function(r){return [r[0],r[1]];}),COMP_F.media,'compSetFilter(\'media\',this.value)')
    +'<div class="comp-search"><i class="fa-solid fa-magnifying-glass"></i>'
      +'<input placeholder="Search ad text, headline, page…" value="'+esc(COMP_F.q)+'" oninput="compSearch(this.value)"></div>'
  +'</div>'
  // One short line: when this was last pulled.
  +(function(){
      const ts=(cur?[cur]:wl).map(function(w){return w.last_sync_at||'';}).filter(Boolean).sort();
      return ts.length?'<div class="comp-note"><i class="fa-solid fa-clock-rotate-left"></i><span>Last pulled '+esc(fmtDate(ts[ts.length-1]))+'</span></div>':'';
    })();
}
// The Ad Library address for a competitor, rebuilt from its Page ID rather than stored, so the
// link can never drift out of step with what the sync actually asks Meta for.
function compAdLibUrl(w){
  if(w.page_id) return 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=IN'
    +'&media_type=all&search_type=page&view_all_page_id='+encodeURIComponent(w.page_id);
  return 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=IN'
    +'&media_type=all&search_type=keyword_unordered&q='+encodeURIComponent(w.search_term||w.name||'');
}
/* Every competitor in one table: the page being tracked, its Ad Library link, and whether it is
   pinned to a Page ID or still guessing by keyword. Shown when no single competitor is selected,
   so the whole watchlist can be checked at a glance. */
// The advertiser name Meta shows. Recorded on the watchlist where known; otherwise taken from the
// competitor's own fetched ads, so it fills in by itself after the first sync.
function compPageNameOf(w){
  if(w.page_name) return w.page_name;
  const a=(window._compAdsAll||[]).filter(function(x){return x.watchlist_id===w.id && x.page_name;})[0];
  return a?a.page_name:'';
}
function compWlTableHtml(wl){
  const ads=window._compAdsAll||[];
  const rows=wl.map(function(w){
    const mine=ads.filter(function(a){return a.watchlist_id===w.id;});
    const n=mine.length;
    const live=mine.filter(function(a){return !a.ad_delivery_stop_time;}).length;
    const pn=compPageNameOf(w);
    const pinned=!!String(w.page_id||'').trim();
    return '<tr>'
      +'<td><b>'+esc(w.name)+'</b>'+(pn&&pn!==w.name?('<div style="font-size:11px;color:var(--slate)">'+esc(pn)+'</div>'):'')+'</td>'
      +'<td>'+(pinned
          ?('<span class="tag t-green" title="Only this page\'s own ads"><i class="fa-solid fa-thumbtack"></i> Page ID</span>'
            +'<div style="font-size:10.5px;color:var(--slate);margin-top:3px">'+esc(w.page_id)+'</div>')
          // Pulls go by Page ID only, so a row without one is listed but never pulled.
          :('<span class="tag t-amber" title="Not pulled until a Page ID is added - paste their Ad Library link in Edit">No Page ID</span>'
            +'<div style="font-size:10.5px;color:var(--slate);margin-top:3px">not pulled</div>'))
      +'</td>'
      +'<td style="text-align:center">'+n+'</td>'
      +'<td style="text-align:center">'+(live?'<b style="color:#16a34a">'+live+'</b>':'<span style="color:var(--slate)">0</span>')+'</td>'
      +'<td style="white-space:nowrap;font-size:12px;color:var(--slate)">'+(w.last_sync_at?esc(fmtDate(w.last_sync_at)):'never')+'</td>'
      +'<td>'+(w.page_url?('<a href="'+esc(w.page_url)+'" target="_blank" rel="noopener" style="font-size:12px">'+esc(String(w.page_url).replace(/^https?:\/\/(www\.)?facebook\.com\//,'').replace(/\/$/,''))+'</a>'):'<span style="color:var(--slate);font-size:12px">—</span>')+'</td>'
      +'<td style="white-space:nowrap">'
        +'<a class="btn btn-sm" href="'+esc(compAdLibUrl(w))+'" target="_blank" rel="noopener" title="Open in Meta Ad Library"><i class="fa-solid fa-arrow-up-right-from-square"></i></a> '
        +'<button class="btn btn-sm" onclick="compShowOnly('+w.id+')" title="Show only this page\'s ads"><i class="fa-solid fa-filter"></i></button> '
        +'<button class="btn btn-sm" onclick="compEditModal('+w.id+')" title="Edit"><i class="fa-solid fa-pen"></i></button> '
        +'<button class="btn btn-sm btn-danger" onclick="compRemove('+w.id+')" title="Remove"><i class="fa-solid fa-trash"></i></button>'
      +'</td>'
    +'</tr>';
  }).join('');
  const keyword=wl.filter(function(w){return !String(w.page_id||'').trim();}).length;
  return '<details class="card" id="compWlPanel" style="margin-bottom:14px" '+(keyword?'open':'')+'>'
    +'<summary style="cursor:pointer;padding:13px 15px;font-weight:700;font-size:13.5px;list-style:none;display:flex;align-items:center;gap:9px">'
      +'<i class="fa-solid fa-list-check" style="color:#0369a1"></i> '+esc(compTabDef()[1])+' <span class="tag t-gray">'+wl.length+'</span>'
      +(keyword?'<span class="tag t-amber" title="Not pulled until a Page ID is added">'+keyword+' without a Page ID</span>':'<span class="tag t-green">all pinned to a Page ID</span>')
      +'<span style="margin-left:auto;font-size:11.5px;color:var(--slate);font-weight:500">click to open / close</span>'
    +'</summary>'
    +'<div style="overflow-x:auto;border-top:1px solid var(--line)">'
      +'<table class="tbl" style="width:100%;font-size:12.5px">'
        +'<thead><tr><th>'+esc(compTabNoun())+'</th><th>Targeting</th><th style="text-align:center">Ads</th><th style="text-align:center" title="Ads still running">Live now</th><th>Last pulled</th><th>Facebook page</th><th>Actions</th></tr></thead>'
        +'<tbody>'+rows+'</tbody>'
      +'</table>'
    +'</div>'
  +'</details>';
}
// Header strip for a single selected competitor: what it targets, and the row's own controls.
function compWlCardHtml(w){
  const ads=(window._compAdsAll||[]).filter(function(a){return a.watchlist_id===w.id;});
  const running=ads.filter(function(a){return !a.ad_delivery_stop_time;}).length;
  return '<div class="card card-pad" style="margin-bottom:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">'
    +'<div style="flex:1;min-width:0">'
      +'<div style="font-weight:700;font-size:15px">'+esc(w.name)
        +(function(){const pn=compPageNameOf(w);return (pn&&pn!==w.name)?(' <span style="font-weight:500;font-size:12.5px;color:var(--slate)">— '+esc(pn)+' on Facebook</span>'):'';})()+'</div>'
      +'<div style="color:var(--slate);font-size:12px">'
        +(w.page_id
          ?('<i class="fa-solid fa-circle-check" style="color:#16a34a"></i> Targets Page ID <b>'+esc(w.page_id)+'</b> — their own ads only')
          :('<i class="fa-solid fa-triangle-exclamation" style="color:#d97706"></i> No Page ID yet, so this page is not pulled — paste their Ad Library link in Edit'))
        +' · '+ads.length+' ad(s) stored · '+running+' running</div>'
      +'<div style="margin-top:5px;font-size:12px;display:flex;gap:12px;flex-wrap:wrap">'
        +'<a href="'+esc(compAdLibUrl(w))+'" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open in Ad Library</a>'
        +(w.page_url?('<a href="'+esc(w.page_url)+'" target="_blank" rel="noopener"><i class="fa-brands fa-facebook"></i> '+esc(String(w.page_url).replace(/^https?:\/\/(www\.)?facebook\.com\//,'').replace(/\/$/,''))+'</a>'):'')
      +'</div>'
    +'</div>'
    +'<button class="btn btn-sm" onclick="compSetFilter(\'wl\',\'all\')"><i class="fa-solid fa-arrow-left"></i> All</button>'
    +'<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--slate)"><input type="checkbox" '+(w.active?'checked':'')+' onchange="compToggleActive('+w.id+',this.checked)"> In auto-sync</label>'
    +'<button class="btn btn-sm" onclick="compEditModal('+w.id+')"><i class="fa-solid fa-pen"></i> Edit</button>'
    +'<button class="btn btn-sm btn-danger" onclick="compRemove('+w.id+')"><i class="fa-solid fa-trash"></i></button>'
  +'</div>';
}
function compPaintGrid(){
  const host=$('compGrid'); if(!host) return;
  const rows=compFiltered();
  const cnt=$('compCount');
  if(cnt) cnt.textContent=rows.length+' ad'+(rows.length===1?'':'s')
    +' · '+rows.filter(function(a){return !a.ad_delivery_stop_time;}).length+' running';
  // 60 at a time with a Show more button, so the first screen draws at once.
  window._compShow=window._compShow||60;
  host.innerHTML=rows.length
    ? rows.slice(0,window._compShow).map(compAdCard).join('')
      +(rows.length>window._compShow?'<div style="grid-column:1/-1;text-align:center;margin:8px 0"><button class="btn" onclick="window._compShow+=60;compPaintGrid()">Show more <span style="color:var(--slate);font-weight:500">('+window._compShow+' of '+rows.length+' shown)</span></button></div>':'')
    : '';
  const empty=$('compEmpty');
  if(empty) empty.style.display=rows.length?'none':'';
  compHydrateThumbs();
}
function compPaint(){
  window._compShow=60;
  const wl=compTabWl();
  const tb=$('compToolbar'); if(tb) tb.innerHTML=compToolbarHtml(wl);
  const host=$('compBody'); if(!host) return;
  if(!wl.length){ host.innerHTML='<div class="empty" style="padding:40px"><i class="fa-regular fa-folder-open"></i><div>No '+compWord(2)+' added yet.</div></div>'; return; }
  const cur=(COMP_F.wl!=='all')?wl.filter(function(w){return String(w.id)===String(COMP_F.wl);})[0]:null;
  host.innerHTML=(cur?compWlCardHtml(cur):compWlTableHtml(wl))
    +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">'
      +'<div id="compCount" style="font-size:12.5px;color:var(--slate);font-weight:600"></div>'
    +'</div>'
    +'<div class="comp-grid" id="compGrid"></div>'
    +'<div class="empty" id="compEmpty" style="padding:36px;display:none"><i class="fa-regular fa-folder-open"></i>'
      +'<div>No ads stored for these filters.</div>'
      +'<div style="font-size:12.5px;color:var(--slate);margin-top:6px">Try a wider date range or Active &amp; inactive'+(COMP_TAB==='competitors'?' - new ads arrive with the weekly automatic pull.':', or press <b>Pull all now</b> to pull the latest.')+'</div>'
    +'</div>';
  compPaintGrid();
}
async function compRender(){
  const host=$('compBody'); if(!host)return;
  let wl=[],ads=[];
  /* THE LIST AND THE ADS GO OUT TOGETHER (26 Oct 2026). The ads used to wait for the watchlist,
     because they were asked for by the tab's watchlist ids - three waits one after another, about
     4 s on a busy afternoon. They are now asked for by the tab's category, joined on the watchlist
     in the database, so both start at once. Every watchlist row has a category (checked), so this
     is the same set of ads. Only the open tab's ads, so a handful of our own never get pushed past
     the row cap by the hundreds a busy competitor runs.
     The database hands back at most 1,000 rows per request, so the ads are read in pages: the
     first two at once (every tab is under 2,000 today), then on until a page comes back short. */
  const cat=compTabDef()[3];
  const adsPage=function(from){
    return sb.schema('camp').from('competitor_ads').select('*,competitor_watchlist!inner(category)')
      .eq('competitor_watchlist.category',cat)
      .order('ad_delivery_start_time',{ascending:false}).order('id').range(from,from+999);
  };
  const got=await Promise.all([
    sb.schema('camp').from('competitor_watchlist').select('*').order('name',{ascending:true}).then(function(r){ return r; },function(){ return {}; }),
    adsPage(0).then(function(r){ return r; },function(){ return {}; }),
    adsPage(1000).then(function(r){ return r; },function(){ return {}; })
  ]);
  /* A page that failed (a timeout on a busy afternoon) is asked for again, up to twice. Without
     this the list quietly showed whichever page did arrive - 331 ads instead of 1,331. */
  const again=async function(r,from){
    for(let i=0;i<2 && !(r&&r.data);i++){ try{ r=await (from<0
      ? sb.schema('camp').from('competitor_watchlist').select('*').order('name',{ascending:true}) : adsPage(from)); }catch(_e){} }
    return r||{};
  };
  got[0]=await again(got[0],-1); got[1]=await again(got[1],0); got[2]=await again(got[2],1000);
  if(!(got[1]&&got[1].data) || !(got[2]&&got[2].data)) toast('Some ads could not be loaded - refresh to try again','warn');
  wl=(got[0]&&got[0].data)||[];
  window._compWl=wl;
  ads=((got[1]&&got[1].data)||[]).concat((got[2]&&got[2].data)||[]);
  try{
    for(let from=2000; got[2]&&got[2].data&&got[2].data.length===1000; from+=1000){
      const r=await adsPage(from);
      if(r.error) break;
      ads=ads.concat(r.data||[]);
      if(!r.data||r.data.length<1000) break;
    }
  }catch(e){}
  ads.forEach(function(a){ delete a.competitor_watchlist; });
  window._compAdsAll=ads;
  compPaint();
}
function compFirstMedia(a){
  if(Array.isArray(a.media_items)&&a.media_items.length)return a.media_items[0];
  if(a.media_s3_path)return {s3_path:a.media_s3_path,media_type:a.media_type||'image'};
  return null;
}
function compPlatformIcons(a){
  const list=Array.isArray(a.publisher_platforms)?a.publisher_platforms:[];
  if(!list.length)return '';
  return list.map(function(p){
    const icon=COMP_PLATFORM_ICON[p];
    return icon?'<i class="fa-brands '+icon+'" title="'+esc(p)+'" style="color:var(--slate);font-size:12px"></i>':'<i class="fa-solid fa-share-nodes" title="'+esc(p)+'" style="color:var(--slate);font-size:12px"></i>';
  }).join(' ');
}
/* HOW FAR THE AD GOT, SHOWN WHERE META SHOWS IT - beside Active, because that is where somebody
   looking at a competitor's ad already is.

   "Low impression count" is Meta's own badge and its own wording, kept rather than reworded: an
   advertiser arguing about it will go to the Ad Library and should find the same phrase. The
   figure is a RANGE ("<100"), never a number, so it is printed as given.

   ABSENCE IS NOT A HEALTHY AD. Meta only flags the low ones, the two sync routes do not all
   report it, and every ad collected before today has nothing stored. So an ad with nothing here
   is "not flagged", which is not the same as "did well" - and the tooltip on the figure says so
   rather than letting a blank card imply good news. */
function compReachBits(a){
  const flagged=a.low_impression===true;
  const txt=String(a.impressions_text||'').trim();
  let out='';
  if(flagged){
    out+=' <span class="tag t-amber" style="font-size:10px" title="'
      +esc('Meta flags this ad as having had very few impressions')
      +'"><i class="fa-solid fa-circle-exclamation"></i> Low impressions</span>';
  }
  if(txt){
    out+=' <span style="font-size:10.5px;color:var(--slate)" title="'
      +esc('Meta publishes a range, not an exact count. Nothing here means Meta did not report it '
           +'for this ad, not that the ad reached many people.')
      +'"><i class="fa-regular fa-eye"></i> '+esc(txt)+'</span>';
  }
  return out;
}
// Whole days an ad has run: start to stop, or start to today while it still runs. Meta gives both
// dates for every ad, so unlike spend or views this is a fact, not an estimate.
function compDaysRunning(a){
  const s=a.ad_delivery_start_time?new Date(a.ad_delivery_start_time):null;
  if(!s||isNaN(s)) return null;
  const e=a.ad_delivery_stop_time?new Date(a.ad_delivery_stop_time):new Date();
  return Math.max(0,Math.floor((e-s)/86400000));
}
function compAdCard(a){
  const stillRunning=!a.ad_delivery_stop_time;
  const days=compDaysRunning(a);
  const t=compAdText(a);
  const bodyText=t.text?t.text.slice(0,140):(t.dynamic?'Catalogue ad — wording changes per product':'(no ad text)');
  const th=compThumbFor(a);
  const thumb=th
    ?'<div class="comp-thumb" data-key="'+esc(th.key)+'" data-kind="'+esc(th.kind)+'" data-snap="'+esc(a.ad_snapshot_url||'')+'" data-overlay="'+(th.overlay?'1':'0')+'" style="position:relative;height:140px;background:var(--bg,#f1f5f9);border:1px solid var(--line);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--slate);overflow:hidden"><i class="fa-solid fa-spinner fa-spin"></i></div>'
    :(a.ad_snapshot_url?'<a href="'+esc(a.ad_snapshot_url)+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="height:140px;background:var(--bg,#f1f5f9);border:1px solid var(--line);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--slate);font-size:12px;text-decoration:none">View on Facebook →</a>':'');
  return '<div style="border:1px solid var(--line);border-radius:10px;padding:10px;cursor:pointer" onclick="compOpenDetail(\''+esc(a.id)+'\')">'
    +thumb
    +'<div style="display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap"><span class="tag '+(stillRunning?'t-green':'t-gray')+'">'+(stillRunning?'Active':'Inactive')+'</span>'+compReachBits(a)+compPlatformIcons(a)+'</div>'
    +'<div style="font-size:12.5px;margin:6px 0 4px;line-height:1.4;max-height:56px;overflow:hidden">'+esc(bodyText)+'</div>'
    +(a.cta_text?'<div style="margin:4px 0"><span class="tag t-blue">'+esc(a.cta_text)+'</span></div>':'')
    +'<div style="font-size:11px;color:var(--slate)">'+esc(a.page_name||'')+'</div>'
    +'<div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-top:4px">'
      +'<span style="font-size:11px;color:var(--slate)">'+(stillRunning?'Since ':'Ran from ')+fmtDate(a.ad_delivery_start_time)
        +(a.total_active_time?' \u00b7 active '+esc(a.total_active_time):'')+'</span>'
      +(days!=null?'<span title="'+(stillRunning?'Days running so far':'Days it ran')+'" style="font-size:13px;font-weight:700;white-space:nowrap;color:'+(stillRunning?'#16a34a':'var(--slate)')+'">'
        +days+' day'+(days===1?'':'s')+'</span>':'')
    +'</div>'
    +'<div style="font-size:10.5px;color:var(--slate);margin-top:4px;opacity:.7">ID '+esc(a.id)+'</div>'
  +'</div>';
}
/* ONE SIGNING CALL PER BATCH OF TILES, NOT PER TILE (26 Oct 2026). Each tile used to make its own
   s3-sign call - up to 200 for one screen, each with its own sign-in and access check - and they
   queued behind one another until many gave up as "Media unavailable". Tiles that come into view
   together now wait 40 ms and go as one list (s3-sign's `keys` mode). If that mode is not there
   (the function is older than this page), the batch falls back to one call per key. Links last
   15 minutes, so a cached one is reused for 12. */
const COMP_SIGN_TTL=12*60*1000;
window._compSignWait=window._compSignWait||{};
async function compSignBatch(keys){
  const out={};
  try{
    const {data:{session}}=await sb.auth.getSession();
    const res=await fetch(SUPABASE_URL+'/functions/v1/s3-sign',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+((session&&session.access_token)||''),'apikey':SUPABASE_KEY},
      body:JSON.stringify({action:'get',keys:keys.map(function(k){ return k.slice(3); })})});
    const jr=await res.json().catch(function(){ return {}; });
    if(res.ok&&jr.urls){ keys.forEach(function(k){ out[k]=jr.urls[k.slice(3)]||null; }); return out; }
  }catch(_e){}
  await Promise.all(keys.map(async function(k){
    try{ const {data,error}=await s3Sign('get',k.slice(3)); out[k]=(!error&&data)?data.url:null; }catch(_e){ out[k]=null; }
  }));
  return out;
}
function compSignedUrl(key){
  const hit=window._compSignCache[key];
  if(hit&&hit.at>Date.now()-COMP_SIGN_TTL) return Promise.resolve(hit.url);
  if(window._compSignWait[key]) return window._compSignWait[key];
  const p=new Promise(function(resolve){
    (window._compSignQ=window._compSignQ||[]).push({key:key,resolve:resolve});
    clearTimeout(window._compSignT);
    window._compSignT=setTimeout(async function(){
      const q=window._compSignQ.splice(0);
      for(let i=0;i<q.length;i+=100){
        const part=q.slice(i,i+100);
        const urls=await compSignBatch(part.map(function(x){ return x.key; }));
        part.forEach(function(x){
          const u=urls[x.key]||null;
          if(u) window._compSignCache[x.key]={url:u,at:Date.now()};
          delete window._compSignWait[x.key];
          x.resolve(u);
        });
      }
    },40);
  });
  window._compSignWait[key]=p;
  return p;
}
/* Why the tiles were blank: these ad videos are 5-27 MB each, and the grid was asking the browser
   to pull two dozen of them at once just to show a still. Nothing was broken - they simply never
   finished downloading.

   Two fixes. Ads fetched from now on carry a small poster image saved next to the video, which is
   what the tile shows. For ads captured before that, the video itself is used with #t=0.1 (which
   makes the browser seek to the first frame and paint it) but ONLY once the tile has actually
   scrolled into view, so a page of them no longer starts two dozen large downloads at once. */
function compThumbFor(a){
  const m=compFirstMedia(a);
  if(!m) return null;
  if(m.poster) return {key:m.poster, kind:'image', overlay:true};        // video, with its own still
  if(m.media_type==='video') return {key:m.s3_path, kind:'video', overlay:true};
  return {key:m.s3_path, kind:'image', overlay:false};
}
/* A video with no still of its own is shown by loading the clip's first frame. Four at a time: a
   screen of them all starting together is what left tiles spinning, and the pictures behind them
   waiting too. A slot is given back when the frame shows, on error, or after 10 s regardless. */
window._compVidBusy=window._compVidBusy||0;
window._compVidQ=window._compVidQ||[];
function compVideoSlot(){
  return new Promise(function(resolve){
    if(window._compVidBusy<4){ window._compVidBusy++; resolve(); }
    else window._compVidQ.push(resolve);
  });
}
function compVideoDone(){
  const next=window._compVidQ.shift();
  if(next) next(); else window._compVidBusy=Math.max(0,window._compVidBusy-1);
}
// When the file cannot be shown, the tile links to the ad on Facebook rather than a dead end.
function compThumbFail(el){
  const snap=el.getAttribute('data-snap');
  el.innerHTML=snap
    ?'<a href="'+esc(snap)+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="font-size:12px;text-decoration:none;color:var(--slate)">View on Facebook →</a>'
    :'<div style="font-size:11px;text-align:center;padding:8px">Media unavailable</div>';
}
/* MEDIA AT ANY COST (26 Oct 2026, as asked). 1,312 of 1,331 competitor ads have a working picture
   or video in storage; a tile still fell back to "View on Facebook" whenever ONE attempt failed -
   a signing call that timed out on a busy afternoon, or a picture that did not arrive. A tile now
   tries up to four times (after 2, 5 and 10 s), each time with a freshly signed link, and only
   then points to Facebook - which is then the truth: the file is not there. */
const COMP_RETRY_MS=[2000,5000,10000];
function compRetryThumb(el){
  const n=Number(el.dataset.tries||0);
  if(n>=COMP_RETRY_MS.length || !el.isConnected){ compThumbFail(el); return; }
  el.dataset.tries=String(n+1);
  delete window._compSignCache[el.getAttribute('data-key')];
  el.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';
  setTimeout(function(){ if(!el.isConnected) return; el.dataset.done=''; compFillThumb(el); }, COMP_RETRY_MS[n]);
}
async function compFillThumb(el){
  if(el.dataset.done==='1') return;
  el.dataset.done='1';
  const key=el.getAttribute('data-key'), kind=el.getAttribute('data-kind');
  let url=null;
  try{ url=await compSignedUrl(key); }catch(_e){}
  if(!el.isConnected) return;
  if(!url){ compRetryThumb(el); return; }
  if(kind==='video'){
    await compVideoSlot();
    if(!el.isConnected){ compVideoDone(); return; }
    let freed=false;
    const free=function(){ if(!freed){ freed=true; compVideoDone(); } };
    setTimeout(free,10000);
    el.innerHTML='<video src="'+esc(url)+'#t=0.1" preload="metadata" muted playsinline'
      +' style="width:100%;height:100%;object-fit:cover;background:#000"></video>';
    const v=el.querySelector('video');
    if(v){ v.onloadeddata=free; v.onerror=function(){ free(); compRetryThumb(el); }; }
  } else {
    el.innerHTML='<img src="'+esc(url)+'" style="width:100%;height:100%;object-fit:cover">';
    /* A picture that will not open may be a video stored under a .jpg name - an older pull saved
       every file as a picture (71 competitor ads were corrected on 26 Oct 2026). It is tried as a
       video once before anything else. */
    const i=el.querySelector('img'); if(i) i.onerror=function(){
      if(el.dataset.asvideo!=='1'){ el.dataset.asvideo='1'; el.setAttribute('data-kind','video'); el.setAttribute('data-overlay','1'); el.dataset.done=''; compFillThumb(el); }
      else compRetryThumb(el);
    };
  }
  if(el.getAttribute('data-overlay')==='1'){
    el.insertAdjacentHTML('beforeend','<span style="position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.62);'
      +'color:#fff;border-radius:5px;padding:1px 6px;font-size:10px"><i class="fa-solid fa-play"></i></span>');
  }
}
function compHydrateThumbs(){
  const els=Array.from(document.querySelectorAll('.comp-thumb[data-key]'));
  if(!els.length) return;
  if(!('IntersectionObserver' in window)){ els.forEach(compFillThumb); return; }
  const io=new IntersectionObserver(function(entries){
    entries.forEach(function(en){ if(en.isIntersecting){ compFillThumb(en.target); io.unobserve(en.target); } });
  },{rootMargin:'250px'});
  els.forEach(function(el){ io.observe(el); });
}
/* Catalogue ads (Advantage+ / dynamic product ads) store their text as a TEMPLATE - the real words
   are filled in per product when the ad is served, which is why the Ad Library shows a normal ad
   but the stored copy reads "{{product.brand}}". Show the real headline where there is one, and be
   honest about the rest rather than printing the placeholder. */
function compIsTemplate(s){ return /\{\{\s*product\.[a-z_]+\s*\}\}/i.test(String(s||'')); }
// Meta labels these display_format:"DCO". Trust that when present, fall back to the text otherwise.
function compIsCatalogue(a){
  return String(a&&a.display_format||'')==='DCO'
    || compIsTemplate((Array.isArray(a&&a.ad_creative_bodies)&&a.ad_creative_bodies[0])||'')
    || compIsTemplate(a&&a.headline);
}
function compAdText(a){
  const raw=(Array.isArray(a.ad_creative_bodies)&&a.ad_creative_bodies.length)?String(a.ad_creative_bodies[0]):'';
  const stripped=raw.replace(/\{\{\s*product\.[a-z_]+\s*\}\}/gi,'').trim();
  if(raw && !compIsTemplate(raw)) return {text:raw, dynamic:compIsCatalogue(a)};
  if(stripped) return {text:stripped, dynamic:true};
  const alt=[a.headline,a.description,(Array.isArray(a.ad_creative_link_titles)?a.ad_creative_link_titles[0]:'')]
    .map(function(x){return String(x||'').trim();}).filter(function(x){return x && !compIsTemplate(x);})[0];
  return {text:alt||'', dynamic:true};
}
/* A keyword search returns anything that merely MENTIONS the competitor - a broker's ad, a news
   post. Their Page ID pins it to ads that page actually ran. You get the ID by opening the
   competitor in Meta's Ad Library and copying the address; the number after view_all_page_id is
   it, and pasting the whole link here is enough. */
function compPageIdFrom(text){
  const s=String(text||'').trim();
  if(!s) return '';
  if(/^\d{6,}$/.test(s)) return s;                                  // already just an ID
  let m=s.match(/[?&]view_all_page_id=(\d+)/i);   if(m) return m[1];
  m=s.match(/[?&]page_ids?(?:%5B0%5D|\[0\])?=(\d+)/i); if(m) return m[1];
  m=s.match(/facebook\.com\/(?:profile\.php\?id=)?(\d{6,})/i);      if(m) return m[1];
  return '';
}
function compFormHtml(w){
  w=w||{};
  return '<div class="modal-body frm">'
    +'<label>Display name<input id="compName" value="'+esc(w.name||'')+'" placeholder="e.g. Godrej Properties"></label>'
    +'<label>Ad Library link or Page ID'
      +'<input id="compPageId" value="'+esc(w.page_id||'')+'" placeholder="Paste their Ad Library link, or the Page ID">'
      +'<div style="font-size:11.5px;color:var(--slate);margin-top:5px;line-height:1.5">'
        +'Needed to pull their ads — the weekly pull goes by Page ID only. Open the page in Meta\'s Ad Library, copy the address bar, paste it here; the Page ID is picked out for you.'
      +'</div>'
    +'</label>'
    +'<label>Search term (only for the Ad Library link when there is no Page ID)'
      +'<input id="compSearchTerm" value="'+esc(w.search_term||'')+'" placeholder="Defaults to the name above">'
      +'<div style="font-size:11.5px;color:var(--slate);margin-top:5px">Nothing is pulled by search term; it only opens a keyword search in the Ad Library.</div>'
    +'</label>'
  +'</div>';
}
window.compAddModal=function(){
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-plus"></i> Add '+esc(compTabNoun())+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +compFormHtml({})
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="compSave()"><i class="fa-solid fa-check"></i> Add</button></div>','md');
};
window.compEditModal=function(id){
  const w=(window._compWl||[]).filter(function(x){return String(x.id)===String(id);})[0];
  if(!w){toast('Competitor not found','err');return;}
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-pen"></i> Edit '+esc(w.name)+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +compFormHtml(w)
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="compSave('+w.id+')"><i class="fa-solid fa-check"></i> Save</button></div>','md');
};
window.compSave=async function(id){
  // Logged directly, after the row actually exists, rather than through USAGE_MAP - compSave
  // both adds and edits, has real validation that can silently stop it (no name, an unparseable
  // Page ID), and a DB call that can genuinely error, so a generic wrapper would have counted a
  // rejected click the same as a real save.
  const fk=id?'competitors.overview.edit_competitor':'competitors.overview.add_competitor';
  const name=(($('compName')&&$('compName').value)||'').trim();
  const term=(($('compSearchTerm')&&$('compSearchTerm').value)||'').trim()||name;
  const raw=(($('compPageId')&&$('compPageId').value)||'').trim();
  const pageId=compPageIdFrom(raw);
  if(!name){toast('Enter a name','err');try{usageQueue(fk,'error');}catch(_e){}return;}
  if(raw&&!pageId){toast('That doesn\'t look like an Ad Library link or Page ID — leave it blank to search by keyword','warn');try{usageQueue(fk,'error');}catch(_e){}return;}
  const row={name:name,search_term:term,page_id:pageId||null};
  // A row added on a tab belongs to that tab; is_own_brand is kept in step for older readers.
  if(!id){ row.category=compTabDef()[3]; row.is_own_brand=(row.category==='brand'); }
  const {error}=id
    ? await sb.schema('camp').from('competitor_watchlist').update(row).eq('id',id)
    : await sb.schema('camp').from('competitor_watchlist').insert(row);
  if(error){toast(error.message,'err');try{usageQueue(fk,'error');}catch(_e){}return;}
  closeModal();toast(id?'Competitor updated':'Competitor added','ok');
  try{usageQueue(fk,id?'update':'create');}catch(_e){}
  await compRender();
};
window.compToggleActive=async function(id,active){
  // Logged directly, after the update actually succeeds, rather than through USAGE_MAP - a toggle
  // here can genuinely fail (network error, RLS), and the wrapper fired on the click regardless.
  const {error}=await sb.schema('camp').from('competitor_watchlist').update({active:active}).eq('id',id);
  if(error){toast(error.message,'err');try{usageQueue('competitors.overview.toggle_auto_sync_for_a_competitor','error');}catch(_e){}return;}
  try{usageQueue('competitors.overview.toggle_auto_sync_for_a_competitor','update',{active:active});}catch(_e){}
};
window.compRemove=async function(id){
  const ok=await confirmDialog('Remove this competitor? Its stored ads will be deleted too.',{okLabel:'Remove'});
  if(!ok)return;
  // Logged directly, after the delete actually succeeds, rather than through USAGE_MAP - the
  // wrapper fires on the click itself, before the confirm dialog is even answered, so backing out
  // of the dialog (or a delete that genuinely fails) would still have counted as a removal.
  const {error}=await sb.schema('camp').from('competitor_watchlist').delete().eq('id',id);
  if(error){toast(error.message,'err');try{usageQueue('competitors.overview.remove_competitor','error');}catch(_e){}return;}
  toast('Removed','ok');
  try{usageQueue('competitors.overview.remove_competitor','delete');}catch(_e){}
  await compRender();
};
// featureKey is logged directly here, at the point the fetch actually succeeds or fails, rather
// than through USAGE_MAP - a click here can genuinely fail (network error, Meta error, wrong-page
// rows skipped), so the generic wrapper would have counted a failed sync as a real one.
/* PULLS RUN ON PROXY'S FREE ALLOWANCE (20 credits a day, no carry-over), THROUGH A QUEUE.
   Every watched page (competitors, our own, channel partners) is pulled once a week, each on its own weekday, by the
   competitor-ads-weekly-enqueue / competitor-ads-queue-worker cron jobs. On top of that the whole
   watchlist can be pulled by hand twice a calendar month; a third request is refused by the
   database, not just hidden here. A manual pull takes whatever today's leftover credits allow at
   once and finishes over the following days - the status line says how far it has got and roughly
   how long is left. Nothing here can ask Proxy for more than the day's budget: the database hands
   the worker only what the budget allows. */
window._compStatus=window._compStatus||null;
async function compLoadStatus(){
  try{
    const {data,error}=await sb.schema('camp').rpc('competitor_pull_status');
    if(!error) window._compStatus=data;
  }catch(e){}
  compPaintStatus();
}
function compPaintStatus(){
  const s=window._compStatus;
  const btn=$('compSyncBtn');
  const host=$('compPullStatus');
  if(!s){ if(host) host.innerHTML=''; return; }
  const limit=Number(s.manual_limit)||0, used=Number(s.manual_used)||0, left=Math.max(0,limit-used);
  const budget=Number(s.budget)||0, tracked=Number(s.pages_tracked)||0;
  const weeklyPerDay=Math.ceil(tracked/7);
  const spare=Math.max(1,budget-weeklyPerDay);
  const pendingManual=Number(s.pending_manual)||0;
  if(btn && !btn.dataset.busy){
    // A pull still working through the queue blocks another (the database refuses it, uncounted).
    btn.disabled=!left||pendingManual>0;
    btn.title=pendingManual>0?('A manual pull is still running ('+pendingManual+' pages to go). You can start another once it finishes.')
      :left?('Pull every watched page - competitors, our own and channel partners. Uses 1 of '+limit+' manual pulls this month.')
      :('Both manual pulls for this month are used. They reset on the 1st; the weekly pull carries on.');
    btn.innerHTML='<i class="fa-solid fa-rotate"></i> Pull all now <span style="opacity:.8;font-weight:500">('+left+' of '+limit+' left)</span>';
  }
  if(!host) return;
  const run=s.run;
  let runLine='';
  if(run && Number(run.finished)<Number(run.pages)){
    const days=Math.ceil(pendingManual/spare);
    runLine='<div><i class="fa-solid fa-spinner fa-spin" style="color:#0369a1"></i> Manual pull from '+esc(fmtDate(run.requested_at))
      +': <b>'+Number(run.finished)+' of '+Number(run.pages)+'</b> pages done'
      +(pendingManual?' · about '+days+' more day'+(days===1?'':'s')+' on the free allowance':'')+'</div>';
  }
  // Only a manual pull still in progress is mentioned, and only where it can be started.
  host.innerHTML=(runLine&&COMP_TAB!=='competitors')
    ?'<div class="comp-note" style="margin:0 0 14px">'+runLine+'</div>':'';
}
// Asks the worker to pull whatever today's credits still allow. Returns its report.
async function compWork(){
  try{
    const {data:{session}}=await sb.auth.getSession();
    const res=await fetch(SUPABASE_URL+'/functions/v1/competitor-sync-test-probe?action=work',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+((session&&session.access_token)||''),'apikey':SUPABASE_KEY},
      body:JSON.stringify({max:4})});
    const jr=await res.json().catch(function(){return {};});
    if(!res.ok&&!jr.error) jr.error='HTTP '+res.status;
    return jr;
  }catch(e){ return {error:'network error'}; }
}
// featureKey is logged directly, after the database has accepted or refused the request, rather
// than through USAGE_MAP - the third request in a month is refused, and must not count as a pull.
window.compManualPull=async function(){
  const fk='competitors.overview.fetch_ads_from_meta_ad_library';
  const s=window._compStatus;
  if(s && Number(s.manual_used)>=Number(s.manual_limit)){
    toast('Monthly limit reached ('+s.manual_used+' of '+s.manual_limit+'). Manual pulls reset on the 1st; the weekly pull carries on.','warn');
    try{usageQueue(fk,'error');}catch(_e){}
    return;
  }
  const left=s?Math.max(0,Number(s.manual_limit)-Number(s.manual_used)):null;
  const ok=await confirmDialog('Pull every page now - competitors, our own pages and channel partners?'
    +(left!=null?' This uses 1 of the '+left+' manual pull'+(left===1?'':'s')+' left this month.':'')
    +' What fits in today\'s free credits is pulled straight away; the rest finishes over the next few days.',{okLabel:'Pull all'});
  if(!ok) return;
  const btn=$('compSyncBtn');
  if(btn){ btn.dataset.busy='1'; btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Queuing…'; }
  const {data,error}=await sb.schema('camp').rpc('competitor_request_manual_pull');
  if(error){
    toast(error.message,'err');
    try{usageQueue(fk,'error');}catch(_e){}
    if(btn) delete btn.dataset.busy;
    await compLoadStatus();
    return;
  }
  try{usageQueue(fk,'update',{pages:data&&data.pages});}catch(_e){}
  // Pull what today's credits allow now, a few pages per call, so the first ads land straight away.
  let pages=0, saved=0, note='';
  for(let i=0;i<6;i++){
    if(btn) btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Pulling… '+pages+' done';
    const jr=await compWork();
    if(jr.error){ note=jr.error; break; }
    if(jr.refused){ note='Proxy has no credits left today'; break; }
    if(jr.idle||!jr.claimed) break;
    pages+=jr.answered||0; saved+=jr.written||0;
  }
  const queued=(data&&data.pages)||0;
  toast('Manual pull started for '+queued+' pages — '+pages+' pulled now ('+saved+' ads saved)'
    +(queued>pages?', the rest over the next few days':'')+(note?' · '+note:''),note?'warn':'ok');
  if(btn) delete btn.dataset.busy;
  await Promise.all([compRender(), compLoadStatus()]);
};
window.compOpenDetail=function(id){
  const a=window._compAdsAll.find(function(x){return String(x.id)===String(id);});
  if(!a){toast('Ad not found — try refreshing','err');return;}
  window._compDetailAd=a;
  window._compDetailIdx=0;
  openModal(compDetailHtml(a),'lg');
  compRenderDetailMedia();
  // Logged directly, after the ad is actually found and the detail modal opens, rather than
  // through USAGE_MAP - a stale id (filtered list moved on, page refreshed) hits the "Ad not
  // found" branch above and would otherwise still have counted as a detail view.
  try{usageQueue('competitors.overview.view_ad_detail','view',{page:a.page_name});}catch(_e){}
};
function compDetailHtml(a){
  const stillRunning=!a.ad_delivery_stop_time;
  const t=compAdText(a);
  const bodyText=t.text||'(no ad text)';
  const dynamicNote=t.dynamic
    ?'<div style="margin-bottom:7px;font-size:11.5px;color:#92400e;background:#fef3c7;border-radius:6px;padding:6px 9px;line-height:1.45">'
      +'<i class="fa-solid fa-circle-info"></i> Catalogue ad — Meta fills the wording in from the product feed as it is served, '
      +'so the Ad Library only stores the template. What you see on Facebook will differ.</div>'
    :'';
  const extraLinks=Array.isArray(a.extra_links)?a.extra_links:[];
  const media=Array.isArray(a.media_items)&&a.media_items.length?a.media_items:(compFirstMedia(a)?[compFirstMedia(a)]:[]);
  return '<div class="modal-head"><h3><i class="fa-solid fa-magnifying-glass-chart"></i> '+esc(a.page_name||'Ad detail')+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="display:flex;gap:18px;flex-wrap:wrap">'
      +'<div style="flex:1 1 320px;min-width:280px">'
        +'<div id="compDetailMedia" style="height:320px;background:var(--bg,#f1f5f9);border:1px solid var(--line);border-radius:10px;display:flex;align-items:center;justify-content:center;color:var(--slate)"><i class="fa-solid fa-spinner fa-spin"></i></div>'
        +(media.length>1
          ?'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">'
            +'<button class="btn btn-sm" onclick="compDetailNav(-1)"><i class="fa-solid fa-chevron-left"></i></button>'
            +'<span id="compDetailMediaCount" style="font-size:12px;color:var(--slate)">1 / '+media.length+'</span>'
            +'<button class="btn btn-sm" onclick="compDetailNav(1)"><i class="fa-solid fa-chevron-right"></i></button>'
          +'</div>'
          :'')
      +'</div>'
      // Right-hand column, in the order asked for: dates first (they are what people compare
      // between ads), then the copy, then the links and the actions.
      +'<div style="flex:1 1 300px;min-width:270px">'
        +'<table style="width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:14px">'
          +compDetailRow('Running since', fmtDate(a.ad_delivery_start_time))
          +compDetailRow('Last seen', fmtDate(a.last_seen_at))
          +compDetailRow(stillRunning?'Running for':'Ran for', compRunLength(a))
          +compDetailRow('Library ID', '<span style="font-family:ui-monospace,Menlo,monospace">'+esc(a.id)+'</span>')
        +'</table>'
        +'<div style="font-size:11.5px;color:var(--slate);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">Description</div>'
        +dynamicNote
        +'<div style="font-size:13px;line-height:1.55;white-space:pre-wrap;max-height:230px;overflow-y:auto;padding-right:4px">'+esc(bodyText)+'</div>'
        +(extraLinks.length
          ?'<div style="margin-top:14px"><div style="font-size:11.5px;color:var(--slate);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">Extra links</div>'
            +extraLinks.map(function(l){const u=l&&(l.url||l);
              return u?'<div style="margin-bottom:4px"><a href="'+esc(u)+'" target="_blank" rel="noopener" style="font-size:12px;word-break:break-all">'+esc(u)+'</a></div>':'';}).join('')
          +'</div>'
          :'')
        +'<div style="margin-top:16px;padding-top:13px;border-top:1px solid var(--line);display:flex;gap:9px;flex-wrap:wrap;align-items:center">'
          +(a.ad_snapshot_url?('<a href="'+esc(a.ad_snapshot_url)+'" target="_blank" rel="noopener" class="btn btn-sm"><i class="fa-brands fa-facebook"></i> View on Facebook Library</a>'):'')
          +(a.cta_text?(a.redirect_url
              ?('<a href="'+esc(a.redirect_url)+'" target="_blank" rel="noopener" class="btn btn-primary btn-sm">'+esc(a.cta_text)+' <i class="fa-solid fa-arrow-up-right-from-square"></i></a>')
              :('<span class="tag t-blue">'+esc(a.cta_text)+'</span>')):'')
        +'</div>'
        +'<div style="margin-top:11px;display:flex;align-items:center;gap:9px;flex-wrap:wrap">'
          +'<span class="tag '+(stillRunning?'t-green':'t-gray')+'">'+(stillRunning?'Active':'Inactive')+'</span>'
          +compPlatformIcons(a)
        +'</div>'
      +'</div>'
    +'</div>';
}
function compDetailRow(k,v){
  return '<tr><td style="padding:6px 0;color:var(--slate);width:112px;vertical-align:top;border-top:1px solid var(--line-2,#eef2f6)">'+esc(k)+'</td>'
    +'<td style="padding:6px 0;color:var(--ink);font-weight:600;border-top:1px solid var(--line-2,#eef2f6)">'+v+'</td></tr>';
}
// How long the ad has been running: start to end, or start to today while it is still live.
function compRunLength(a){
  const s=a.ad_delivery_start_time?new Date(a.ad_delivery_start_time):null;
  if(!s||isNaN(s)) return '—';
  const e=a.ad_delivery_stop_time?new Date(a.ad_delivery_stop_time):new Date();
  const days=Math.max(0,Math.round((e-s)/86400000));
  const months=Math.floor(days/30), rem=days%30;
  const txt=days<1?'less than a day':(days===1?'1 day':(months?(months+' month'+(months===1?'':'s')+(rem?' '+rem+' day'+(rem===1?'':'s'):'')):days+' days'));
  return esc(txt)+(a.ad_delivery_stop_time?'':' <span style="font-weight:400;color:var(--slate)">and counting</span>');
}
async function compRenderDetailMedia(){
  const a=window._compDetailAd; if(!a)return;
  const host=$('compDetailMedia'); if(!host)return;
  const media=Array.isArray(a.media_items)&&a.media_items.length?a.media_items:(compFirstMedia(a)?[compFirstMedia(a)]:[]);
  const item=media[window._compDetailIdx||0];
  if(!item){ host.innerHTML='<i class="fa-regular fa-image" style="font-size:28px"></i>'; return; }
  let url=null;
  try{ url=await compSignedUrl(item.s3_path); }catch(_e){}
  if(!host.isConnected)return;
  if(!url){ host.innerHTML='<div style="font-size:12.5px;text-align:center;padding:14px">Media could not be loaded</div>'; return; }
  // In the popup the video is the point, so it loads properly here (preload=auto) - unlike the
  // grid, where only a small poster is fetched. The poster fills the frame while it buffers, and
  // a spinner sits over it until enough has arrived to play.
  let posterUrl=null;
  if(item.media_type==='video' && item.poster){ try{ posterUrl=await compSignedUrl(item.poster); }catch(_e){} }
  if(item.media_type!=='video'){
    host.innerHTML='<img src="'+esc(url)+'" style="max-width:100%;max-height:100%;object-fit:contain">';
  } else {
    host.innerHTML='<video src="'+esc(url)+(posterUrl?'':'#t=0.1')+'" controls autoplay muted playsinline preload="auto"'
      +(posterUrl?(' poster="'+esc(posterUrl)+'"'):'')
      +' style="max-width:100%;max-height:100%;background:#000"></video>'
      +'<div id="compVidWait" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;'
      +'pointer-events:none;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.7)"><i class="fa-solid fa-spinner fa-spin"></i></div>';
    host.style.position='relative';
    const v=host.querySelector('video');
    const hideWait=function(){ const s=document.getElementById('compVidWait'); if(s)s.remove(); };
    if(v){
      v.addEventListener('loadeddata',hideWait);
      v.addEventListener('canplay',hideWait);
      v.addEventListener('error',function(){ host.innerHTML='<div style="font-size:12.5px;text-align:center;padding:14px">Video could not be loaded</div>'; });
      // some browsers block even a muted autoplay; the controls still work, so just clear the spinner
      const p=v.play(); if(p&&p.catch) p.catch(hideWait);
    }
  }
  const el=host.querySelector('video,img');
  if(el) el.onerror=function(){ host.innerHTML='<div style="font-size:12.5px;text-align:center;padding:14px">Media could not be loaded</div>'; };
}
window.compDetailNav=function(delta){
  const a=window._compDetailAd; if(!a)return;
  const media=Array.isArray(a.media_items)&&a.media_items.length?a.media_items:(compFirstMedia(a)?[compFirstMedia(a)]:[]);
  if(!media.length)return;
  window._compDetailIdx=((window._compDetailIdx||0)+delta+media.length)%media.length;
  const counter=$('compDetailMediaCount'); if(counter)counter.textContent=(window._compDetailIdx+1)+' / '+media.length;
  compRenderDetailMedia();
};


