
/* ============================ OUR BRAND - FACEBOOK and GOOGLE ADS ============================
   30 Oct 2026. Replaces the old Campaign Analytics views (28-campaign-trends.js) on Our Brand.

   WHY. Those views added up one stored total per campaign per named period ('last_month', 'today'),
   rows that were never cleared - a stopped campaign's June row still counted in an August
   'last_month' (Rs 11.0 lakh shown, Rs 6.4 lakh real). They also summed reach across campaigns,
   divided a month's spend by one day's budget, and left out campaigns not named after their
   account. Facebook rows came from a PC script that stopped on 12 Oct.

   NOW. Everything is read from camp.ads_daily / ads_ad_daily: one row per campaign (and per ad)
   per DAY, refreshed on the server every 3 hours by the ads-daily-sync edge function (see its
   header). A period is the sum of its days - nothing else is ever added in. Only what can honestly
   be added up is shown: spend, impressions, clicks, leads / conversions, and what follows from
   them (cost per lead, CTR). Reach and frequency are left out: they count unique people and cannot
   be added across days or campaigns.

   One renderer, two platforms: obAdsView(host, 'meta' | 'google'). */
const OB_ADS_WORD={
  meta:{name:'Facebook',res:'Leads',per:'Cost per lead',one:'lead',src:'Meta Ads Manager',icon:'fa-brands fa-facebook',color:'#1877f2'},
  google:{name:'Google',res:'Conversions',per:'Cost per conversion',one:'conversion',src:'Google Ads',icon:'fa-brands fa-google',color:'#ea4335'}
};
const OB_PERIODS=[['yesterday','Yesterday'],['last_7d','Last 7 days'],['last_30d','Last 30 days'],['this_month','This month'],['last_month','Last month'],['last_90d','Last 90 days'],['custom','Custom']];
let OB_P={period:'last_30d',from:'',to:'',acct:'all',showAds:12};
let OB_CHART=null;
function obIst(){ return new Date(Date.now()+5.5*3600000).toISOString().slice(0,10); }
function obAdd(d,n){ return new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10); }
// The period's first and last day (IST). Presets end yesterday, as Ads Manager's do: today is not
// over yet. The comparison period is the same number of days just before it.
function obRange(){
  const t=obIst(), y=obAdd(t,-1); let s,e;
  switch(OB_P.period){
    case 'yesterday': s=y; e=y; break;
    case 'last_7d': s=obAdd(t,-7); e=y; break;
    case 'this_month': s=t.slice(0,8)+'01'; e=t; break;
    case 'last_month': { const f=new Date(Date.UTC(+t.slice(0,4),+t.slice(5,7)-2,1)); s=f.toISOString().slice(0,10); e=obAdd(t.slice(0,8)+'01',-1); break; }
    case 'last_90d': s=obAdd(t,-90); e=y; break;
    case 'custom': s=OB_P.from||obAdd(t,-30); e=OB_P.to||y; if(e<s){ const x=s; s=e; e=x; } break;
    default: s=obAdd(t,-30); e=y;
  }
  const n=Math.round((Date.parse(e)-Date.parse(s))/864e5)+1;
  return {s:s,e:e,n:n,ps:obAdd(s,-n),pe:obAdd(s,-1)};
}
function obMoney(x){ return x==null||!isFinite(x)?'—':'₹'+Math.round(x).toLocaleString('en-IN'); }
function obNum(x,dp){ return x==null||!isFinite(x)?'—':Number(x).toLocaleString('en-IN',{maximumFractionDigits:dp||0}); }
function obPct(x){ return x==null||!isFinite(x)?'—':x.toFixed(2)+'%'; }
// Change against the previous period, coloured by whether the move is good (spend is neutral).
function obChange(now,prev,goodUp){
  if(prev==null||!isFinite(prev)||prev===0||now==null||!isFinite(now)) return '<div class="ob-chg ob-flat">no earlier figure</div>';
  const p=(now-prev)/Math.abs(prev)*100;
  if(Math.abs(p)<0.5) return '<div class="ob-chg ob-flat">same as before</div>';
  const cls=goodUp==null?'ob-flat':((p>0)===goodUp?'ob-good':'ob-bad');
  return '<div class="ob-chg '+cls+'">'+(p>0?'▲ ':'▼ ')+Math.abs(p).toFixed(0)+'% vs previous</div>';
}
function obSum(rows){ const t={spend:0,impressions:0,clicks:0,results:0}; rows.forEach(function(r){ t.spend+=Number(r.spend)||0; t.impressions+=Number(r.impressions)||0; t.clicks+=Number(r.clicks)||0; t.results+=Number(r.results)||0; }); return t; }
const OB_CSS='<style>'
  +'.ob-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 14px}'
  +'.ob-bar select,.ob-bar input{height:36px;padding:0 11px;border:1px solid var(--line);border-radius:9px;font-size:13px;font-weight:600;font-family:inherit;background:var(--bg-card);color:var(--ink)}'
  +'.ob-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:14px}'
  +'.ob-kpi{background:var(--bg-card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}'
  +'.ob-kpi .l{font-size:12px;color:var(--slate);font-weight:600}.ob-kpi .v{font-size:24px;font-weight:800;margin-top:4px;font-variant-numeric:tabular-nums}'
  +'.ob-chg{font-size:11.5px;font-weight:600;margin-top:3px}.ob-good{color:#15803d}.ob-bad{color:#b91c1c}.ob-flat{color:var(--slate);font-weight:500}'
  +'.ob-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}'
  +'.ob-ads{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}'
  +'.ob-ad{border:1px solid var(--line);border-radius:11px;overflow:hidden;background:var(--bg-card);display:flex;flex-direction:column}'
  +'.ob-ad .pic{height:150px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;overflow:hidden}.ob-ad .pic img{width:100%;height:100%;object-fit:cover}'
  +'.ob-ad .txt{padding:12px;font-size:13px;line-height:1.45;color:#1a0dab;background:#fff;height:150px;overflow:hidden;box-sizing:border-box;border-bottom:1px solid var(--line)}'
  +'.ob-ad .m{padding:10px 12px;font-size:12px;display:grid;grid-template-columns:1fr 1fr;gap:4px 10px}.ob-ad .m b{font-variant-numeric:tabular-nums}'
  +'.tbl tr.ob-sel td{background:rgba(3,105,161,.08)}'
  +'</style>';

async function obAdsView(host,platform){
  const W=OB_ADS_WORD[platform];
  host.innerHTML=OB_CSS+'<div id="obHead"></div><div id="obBody"><div class="loader"><div class="spin"></div></div></div>';
  const [acc,ent,log]=await Promise.all([
    sb.schema('camp').from('ads_accounts').select('*').eq('platform',platform).eq('include',true).order('name'),
    sb.schema('camp').from('ads_entities').select('kind,id,account_id,campaign_id,name,status,daily_budget,lifetime_budget,thumbnail,body').eq('platform',platform),
    sb.schema('camp').from('ads_sync_log').select('ok,message,finished_at').eq('platform',platform).not('finished_at','is',null).order('started_at',{ascending:false}).limit(1)
  ]);
  window._obAcc=acc.data||[]; window._obEnt={}; (ent.data||[]).forEach(function(x){ window._obEnt[x.kind+':'+x.id]=x; });
  window._obPlat=platform; window._obLog=(log.data||[])[0]||null;
  if(OB_P.acct!=='all'&&!window._obAcc.some(function(a){ return a.account_id===OB_P.acct; })) OB_P.acct='all';
  await obAdsLoad();
}
async function obAdsLoad(){
  const platform=window._obPlat, W=OB_ADS_WORD[platform], r=obRange();
  const rpc=function(fn,args){ return sb.schema('camp').rpc(fn,args); };
  const [cur,prev,days,ads]=await Promise.all([
    rpc('ads_campaign_totals',{p_platform:platform,p_from:r.s,p_to:r.e}),
    rpc('ads_campaign_totals',{p_platform:platform,p_from:r.ps,p_to:r.pe}),
    rpc('ads_by_day',{p_platform:platform,p_from:r.s,p_to:r.e}),
    rpc('ads_ad_totals',{p_platform:platform,p_from:r.s,p_to:r.e,p_limit:200})
  ]);
  const err=cur.error||prev.error||days.error||ads.error;
  if(err){ $('obBody').innerHTML='<div class="card card-pad" style="color:#b91c1c">Could not load: '+esc(err.message)+'</div>'; return; }
  window._obCur=cur.data||[]; window._obPrev=prev.data||[]; window._obDays=days.data||[]; window._obAds=ads.data||[];
  obAdsPaint();
}
function obAdsPaint(){
  const platform=window._obPlat, W=OB_ADS_WORD[platform], r=obRange(), E=window._obEnt||{}, accs=window._obAcc||[];
  const aName={}; accs.forEach(function(a){ aName[a.account_id]=a.project||a.name||a.account_id; });
  const pick=function(rows){ return OB_P.acct==='all'?rows:rows.filter(function(x){ return x.account_id===OB_P.acct; }); };
  const cur=pick(window._obCur||[]), prev=pick(window._obPrev||[]);
  const T=obSum(cur), P=obSum(prev);
  const cpl=T.results?T.spend/T.results:null, pcpl=P.results?P.spend/P.results:null;
  const ctr=T.impressions?T.clicks/T.impressions*100:null, pctr=P.impressions?P.clicks/P.impressions*100:null;
  // ---- header: period picker, account picker, freshness
  const lg=window._obLog, lastOk=accs.reduce(function(m,a){ return a.last_ok_at&&(!m||a.last_ok_at>m)?a.last_ok_at:m; },null);
  const errs=accs.filter(function(a){ return a.last_error; });
  let fresh='<span style="font-size:12.5px;color:var(--slate)"><i class="fa-solid fa-clock-rotate-left"></i> '
    +(lastOk?'Straight from '+W.src+', updated '+ciAgo(lastOk)+' (every 3 hours)':'Not read from '+W.src+' yet')+'</span>';
  let warn='';
  if(!lastOk&&lg&&!lg.ok) warn=obSetupNote(platform,lg.message||'');
  else if(errs.length) warn='<div class="card card-pad" style="border-color:#fcd34d;background:#fffbeb;color:#92400e;font-size:12.5px;margin-bottom:14px"><i class="fa-solid fa-triangle-exclamation"></i> Could not be read on the last run, so their figures may be behind: '
    +errs.map(function(a){ return '<b>'+esc(a.name||a.account_id)+'</b> ('+esc(String(a.last_error).slice(0,140))+')'; }).join('; ')+'</div>';
  $('obHead').innerHTML='<div class="ob-bar">'
      +compSelHtml('obPer',OB_PERIODS,OB_P.period,"OB_P.period=this.value;OB_P.showAds=12;obAdsLoad()")
      +(OB_P.period==='custom'?'<input type="date" value="'+esc(r.s)+'" onchange="OB_P.from=this.value;obAdsLoad()"><span style="color:var(--slate)">to</span><input type="date" value="'+esc(r.e)+'" onchange="OB_P.to=this.value;obAdsLoad()">':'')
      +(accs.length>1?compSelHtml('obAcc',[['all','All '+(platform==='meta'?'projects':'accounts')]].concat(accs.map(function(a){ return [a.account_id,a.project||a.name||a.account_id]; })),OB_P.acct,"OB_P.acct=this.value;OB_P.showAds=12;obAdsPaint()"):'')
      +'<span style="font-size:12.5px;color:var(--slate)">'+esc(fmtDate(r.s))+' – '+esc(fmtDate(r.e))+' · compared with the '+r.n+' days before</span>'
      +'<span style="margin-left:auto">'+fresh+'</span>'
    +'</div>'+warn;
  if(!lastOk&&!(window._obCur||[]).length){ $('obBody').innerHTML=''; return; }
  // ---- KPIs
  const kpi=function(l,v,ch){ return '<div class="ob-kpi"><div class="l">'+l+'</div><div class="v">'+v+'</div>'+ch+'</div>'; };
  let html='<div class="ob-kpis">'
    +kpi('Spend',obMoney(T.spend),obChange(T.spend,P.spend,null))
    +kpi(W.res,obNum(T.results,platform==='google'?1:0),obChange(T.results,P.results,true))
    +kpi(W.per,obMoney(cpl),obChange(cpl,pcpl,false))
    +kpi('Clicks',obNum(T.clicks),obChange(T.clicks,P.clicks,true))
    +kpi('Click rate (CTR)',obPct(ctr),obChange(ctr,pctr,true))
    +'</div>';
  // ---- chart
  html+='<div class="card card-pad" style="margin-bottom:14px"><div style="font-weight:700;font-size:13.5px;margin-bottom:8px">Spend and '+W.res.toLowerCase()+' by day'+(OB_P.acct==='all'?'':' - '+esc(aName[OB_P.acct]||''))+'</div><div style="height:230px"><canvas id="obChart"></canvas></div></div>';
  // ---- by project / account
  const byAcc={}; (window._obCur||[]).forEach(function(c){ const a=byAcc[c.account_id]||(byAcc[c.account_id]={spend:0,clicks:0,impressions:0,results:0}); a.spend+=+c.spend||0; a.clicks+=+c.clicks||0; a.impressions+=+c.impressions||0; a.results+=+c.results||0; });
  const allSpend=Object.keys(byAcc).reduce(function(s,k){ return s+byAcc[k].spend; },0);
  const accRows=Object.keys(byAcc).filter(function(k){ return byAcc[k].spend>0||byAcc[k].results>0; }).sort(function(a,b){ return byAcc[b].spend-byAcc[a].spend; }).map(function(k){
    const a=byAcc[k];
    return '<tr style="cursor:pointer" class="'+(OB_P.acct===k?'ob-sel':'')+'" onclick="OB_P.acct=(OB_P.acct===\''+k+'\'?\'all\':\''+k+'\');OB_P.showAds=12;obAdsPaint()"><td><b>'+esc(aName[k]||k)+'</b></td>'
      +'<td class="ob-num">'+obMoney(a.spend)+'</td><td class="ob-num" style="color:var(--slate)">'+(allSpend?Math.round(a.spend/allSpend*100):0)+'%</td>'
      +'<td class="ob-num">'+obNum(a.results,platform==='google'?1:0)+'</td><td class="ob-num">'+obMoney(a.results?a.spend/a.results:null)+'</td>'
      +'<td class="ob-num">'+obNum(a.clicks)+'</td><td class="ob-num">'+obPct(a.impressions?a.clicks/a.impressions*100:null)+'</td></tr>';
  }).join('');
  if(accRows) html+='<div class="card" style="margin-bottom:14px;overflow-x:auto"><div style="padding:12px 15px;font-weight:700;font-size:13.5px">By '+(platform==='meta'?'project':'account')+' <span style="font-weight:500;color:var(--slate);font-size:12px">- click one to see only its campaigns and ads</span></div>'
    +'<table class="tbl" style="width:100%;font-size:13px"><thead><tr><th>'+(platform==='meta'?'Project':'Account')+'</th><th class="ob-num">Spend</th><th class="ob-num">Share</th><th class="ob-num">'+W.res+'</th><th class="ob-num">'+W.per+'</th><th class="ob-num">Clicks</th><th class="ob-num">CTR</th></tr></thead><tbody>'+accRows+'</tbody></table></div>';
  // ---- campaigns with spend in the period
  const camps=cur.filter(function(c){ return (+c.spend||0)>0||(+c.results||0)>0; }).sort(function(a,b){ return b.spend-a.spend; });
  const st=function(s){ s=String(s||''); const on=s==='ACTIVE'||s==='ENABLED'; return '<span class="tag '+(on?'t-green':'t-gray')+'">'+(on?'Running':s?s.charAt(0)+s.slice(1).toLowerCase().replace(/_/g,' '):'—')+'</span>'; };
  html+='<div class="card" style="margin-bottom:14px;overflow-x:auto"><div style="padding:12px 15px;font-weight:700;font-size:13.5px">Campaigns <span style="font-weight:500;color:var(--slate);font-size:12px">- '+camps.length+' that spent in this period</span></div>'
    +(camps.length?'<table class="tbl" style="width:100%;font-size:12.5px"><thead><tr><th>Campaign</th>'+(OB_P.acct==='all'?'<th>'+(platform==='meta'?'Project':'Account')+'</th>':'')+'<th>Status</th><th class="ob-num">Budget</th><th class="ob-num">Spend</th><th class="ob-num">'+W.res+'</th><th class="ob-num">'+W.per+'</th><th class="ob-num">Clicks</th><th class="ob-num">CTR</th></tr></thead><tbody>'
      +camps.map(function(c){
        const e=E['campaign:'+c.campaign_id]||{};
        const bud=e.daily_budget!=null?obMoney(e.daily_budget)+'<span style="color:var(--slate);font-size:11px"> /day</span>':(e.lifetime_budget!=null?obMoney(e.lifetime_budget)+'<span style="color:var(--slate);font-size:11px"> total</span>':'—');
        return '<tr><td style="max-width:340px">'+esc(e.name||c.campaign_id)+'</td>'+(OB_P.acct==='all'?'<td style="font-size:12px">'+esc(aName[c.account_id]||'')+'</td>':'')
          +'<td>'+st(e.status)+'</td><td class="ob-num">'+bud+'</td><td class="ob-num"><b>'+obMoney(c.spend)+'</b></td><td class="ob-num">'+obNum(c.results,platform==='google'?1:0)+'</td>'
          +'<td class="ob-num">'+obMoney(+c.results?c.spend/c.results:null)+'</td><td class="ob-num">'+obNum(c.clicks)+'</td><td class="ob-num">'+obPct(+c.impressions?c.clicks/c.impressions*100:null)+'</td></tr>';
      }).join('')+'</tbody></table>':'<div class="card-pad" style="color:var(--slate);font-size:13px">No campaign spent in this period.</div>')+'</div>';
  // ---- ads
  const ads=pick(window._obAds||[]), shown=ads.slice(0,OB_P.showAds);
  if(ads.length){
    html+='<div style="font-weight:700;font-size:13.5px;margin:4px 0 10px">Ads by spend <span style="font-weight:500;color:var(--slate);font-size:12px">- '+ads.length+' that ran in this period</span></div><div class="ob-ads">'
      +shown.map(function(a){
        const e=E['ad:'+a.ad_id]||{};
        const pic=e.thumbnail?'<div class="pic"><img src="'+esc(e.thumbnail)+'" loading="lazy" referrerpolicy="no-referrer" alt=""></div>'
          :'<div class="txt">'+esc(e.body||e.name||('Ad '+a.ad_id))+'</div>';
        return '<div class="ob-ad">'+pic+'<div style="padding:9px 12px 0;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(e.name||'')+'">'+esc(e.name||('Ad '+a.ad_id))+'</div>'
          +'<div style="padding:0 12px;font-size:11.5px;color:var(--slate)">'+esc(aName[a.account_id]||'')+' · '+st(e.status)+'</div>'
          +'<div class="m"><span>Spend</span><b>'+obMoney(a.spend)+'</b><span>'+W.res+'</span><b>'+obNum(a.results,platform==='google'?1:0)+'</b><span>'+W.per+'</span><b>'+obMoney(+a.results?a.spend/a.results:null)+'</b><span>CTR</span><b>'+obPct(+a.impressions?a.clicks/a.impressions*100:null)+'</b></div></div>';
      }).join('')+'</div>'
      +(ads.length>shown.length?'<div style="text-align:center;margin:14px 0"><button class="btn" onclick="OB_P.showAds+=24;obAdsPaint()">Show more ('+shown.length+' of '+ads.length+')</button></div>':'');
  }
  html+='<div style="font-size:11.5px;color:var(--slate);margin:16px 0 4px">'+(platform==='meta'
      ?'Figures are Meta\'s own, using each account\'s attribution setting - the same as Ads Manager. Leads = Meta\'s "Leads" count. Reach is not shown: it counts unique people, so it cannot be added across days or campaigns.'
      :'Figures are Google Ads\' own. Conversions = Google\'s "Conversions" column (it can include fractions and every conversion action set as primary). Google keeps adding late conversions to recent days for up to 30 days, so those can still rise.')+'</div>';
  $('obBody').innerHTML=html;
  // chart: day-by-day for the chosen account, or all
  const c=$('obChart'); if(!c||typeof Chart==='undefined') return;
  let days=window._obDays||[];
  if(OB_P.acct!=='all') days=null;   // per-account days come from the campaign rows below
  obDrawChart(c,platform,r,days);
}
async function obDrawChart(c,platform,r,days){
  const W=OB_ADS_WORD[platform];
  if(!days){
    const {data}=await sb.schema('camp').from('ads_daily').select('day,spend,results').eq('platform',platform).eq('account_id',OB_P.acct).gte('day',r.s).lte('day',r.e).limit(5000);
    const m={}; (data||[]).forEach(function(x){ const d=m[x.day]||(m[x.day]={day:x.day,spend:0,results:0}); d.spend+=+x.spend||0; d.results+=+x.results||0; });
    days=Object.keys(m).sort().map(function(k){ return m[k]; });
  }
  const all=[]; for(let d=r.s; d<=r.e; d=obAdd(d,1)) all.push(d);
  const by={}; days.forEach(function(x){ by[x.day]=x; });
  if(OB_CHART){ try{ OB_CHART.destroy(); }catch(e){} }
  if(!c.isConnected) return;
  OB_CHART=new Chart(c,{data:{labels:all.map(function(d){ return fmtDateShort(d); }),datasets:[
      {type:'bar',label:'Spend (₹)',data:all.map(function(d){ return by[d]?Math.round(+by[d].spend):0; }),backgroundColor:W.color+'55',borderColor:W.color,borderWidth:1,yAxisID:'y'},
      {type:'line',label:W.res,data:all.map(function(d){ return by[d]?+by[d].results:0; }),borderColor:'#16a34a',backgroundColor:'#16a34a',pointRadius:all.length>45?0:2,tension:.25,yAxisID:'y2'}]},
    options:{maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'bottom',labels:{usePointStyle:true,boxWidth:7}}},
      scales:{x:{ticks:{maxTicksLimit:12}},y:{beginAtZero:true,title:{display:true,text:'Spend'}},y2:{beginAtZero:true,position:'right',grid:{drawOnChartArea:false},title:{display:true,text:W.res}}}}});
}
// What to do when the platform cannot be read yet (most often: the Facebook key is not added).
function obSetupNote(platform,msg){
  if(platform==='meta'&&/access key|META_SYSTEM_USER_TOKEN|token|OAuth|code 190/i.test(msg))
    return '<div class="card card-pad" style="border-color:#fcd34d;background:#fffbeb;color:#713f12;font-size:13px;line-height:1.6;margin-bottom:14px">'
      +'<b><i class="fa-solid fa-key"></i> Facebook figures need a permanent Meta access key - one-time setup by a Business Manager admin.</b>'
      +'<ol style="margin:8px 0 0 18px;padding:0">'
      +'<li>Meta Business Settings → Users → <b>System users</b> → Add (role: Admin).</li>'
      +'<li>Assign assets → Ad accounts: tick the 10 accounts (Dream Valley, Gurukul, One, Eco City, Exotica, World City, Ananta, Diamond, Durbaar Banquets, Sarovar Hotel) with <b>View performance</b>.</li>'
      +'<li>Generate new token → pick the JainE app → permissions <b>ads_read</b> (and read_insights) → expiry <b>Never</b>.</li>'
      +'<li>Supabase → Project Settings → Edge Functions → Secrets → add <code>META_SYSTEM_USER_TOKEN</code> with that token. Figures appear within 3 hours.</li></ol>'
      +'<div style="margin-top:6px;font-size:12px">Last attempt said: '+esc(msg.slice(0,200))+'</div></div>';
  return '<div class="card card-pad" style="color:#b91c1c;margin-bottom:14px;font-size:13px"><i class="fa-solid fa-triangle-exclamation"></i> Could not read '+esc(OB_ADS_WORD[platform].src)+': '+esc(msg.slice(0,300))+'</div>';
}
