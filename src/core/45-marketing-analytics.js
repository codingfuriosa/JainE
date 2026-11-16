/* ============================ MARKETING ANALYTICS ============================
   The "Analytics" tab of Campaign Analytics (16 Nov 2026, Ayush: "make a new Tab named Analytics and start with these
   Mathematical Models"). Decision support only - it reads, calculates and explains; it changes nothing on Google or
   Meta. Four models, all from data JainE already stores (camp.ads_daily, camp.crm_google_daily, camp.ads_entities):

   1. QUALITY OF SPEND - cost per qualified lead (QL), per site visit and per booking from the CRM, per project, platform
      and campaign. A campaign that brings cheap leads nobody qualifies is worse than a dearer one that brings QLs.
      The CRM marks a lead qualified days or weeks later, so this reads a window that ENDS 21 DAYS AGO (MA_SETTLE).
   2. WHY DID COST PER LEAD CHANGE - the last 7 days against the 28 before. Cost per lead = cost per 1,000 impressions /
      (1,000 x click rate x lead rate), so its change splits exactly (in logs) into: ads dearer to show (auction),
      fewer people clicking (creative), fewer clickers becoming leads (form / landing page). A Poisson test says whether
      the change in leads is more than normal day-to-day noise.
   3. MONEY-WASTING ALERTS - (a) a lead campaign spending for 7 days with no lead when its own past rate says leads were
      due; (b) a campaign whose CRM leads, over the settled window, produced no QL when its project's QL rate says some
      were due. Both flagged only when the chance of it being bad luck is under 5%.
   4. MONTH-END FORECAST - spend, platform leads and CRM leads by month-end from the pace of the last 7 complete days,
      as a range (spend: day-to-day variation; leads: Poisson), beside last month and today's budgets.

   Leads: Google = lead-form submissions (form_leads, as on the Overview); Facebook = Results of lead / WhatsApp
   campaigns only (obIsLead) - awareness and engagement results are never counted as leads. CRM figures only where the
   CRM ties the lead to one of our campaigns (same rules as the Overview); its WhatsApp line goes on the project only. */
const MA_SETTLE=21, MA_DAYS_BACK=200;
let MA={win:90}, MA_D=null;
const MA_CSS='<style>'
  /* calm styling (16 Nov 2026, Ayush: "the styling hurts the eyes"): dark figures, one neutral icon style, status shown
     by a small dot or a soft pill, light tables */
  +'.ma-sec{margin:0 0 22px}.ma-h{font-weight:700;font-size:16px;color:#0f172a;margin:0 0 12px;display:flex;align-items:center;gap:8px}'
  +'.ma-h>i:first-child{width:28px;height:28px;border-radius:8px;background:#f1f5f9;color:#475569!important;display:inline-flex;align-items:center;justify-content:center;font-size:13px}'
  +'.ma-why{font-size:12px;color:#64748b;margin:0 0 10px;line-height:1.5;max-width:980px}'
  +'.ma-tbl{width:100%;border-collapse:separate;border-spacing:0;font-size:13px;color:#1e293b;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}'
  +'.ma-tbl th{font-size:11.5px;font-weight:600;color:#64748b;text-align:right;padding:10px 12px;border-bottom:1px solid #e2e8f0;white-space:nowrap;background:#f8fafc}'
  +'.ma-tbl th:first-child,.ma-tbl td:first-child{text-align:left}'
  +'.ma-tbl td{padding:10px 12px;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}'
  +'.ma-tbl tr:last-child td{border-bottom:0}.ma-tbl tbody tr:hover td{background:#fafbfc}'
  +'.ma-tbl tr.ma-p td{font-weight:600;background:#f8fafc;color:#0f172a}.ma-tbl td.ma-n{white-space:normal;min-width:220px}'
  +'.ma-b{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap;border:1px solid transparent}'
  +'.ma-b.bad{background:#fef2f2;color:#b91c1c;border-color:#fde2e2}.ma-b.good{background:#f0fdf4;color:#15803d;border-color:#dcfce7}.ma-b.mid{background:#f8fafc;color:#64748b;border-color:#e2e8f0}.ma-b.warn{background:#fffbeb;color:#a16207;border-color:#fef3c7}'
  +'.ma-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin:0 0 10px;font-size:13px;line-height:1.55;color:#334155}'
  +'.ma-card b{font-weight:700}.ma-sub{font-size:11px;color:var(--slate)}'
  +'.ma-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 14px}'
  +'.ma-bar select{height:34px;padding:0 10px;border:1px solid var(--line);border-radius:9px;font-size:13px;font-weight:600;background:var(--bg-card);color:var(--ink)}'
  +'.ca-tabs{display:flex;gap:6px;margin:0 0 14px;border-bottom:1px solid var(--line)}'
  +'.ca-tab{border:0;background:none;padding:9px 14px;font-size:13.5px;font-weight:700;color:var(--slate);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}'
  +'.ca-tab.on{color:var(--ink);border-bottom-color:#b3171d}'
  +'</style>';

// ---------------------------------------------------------------- maths
function maPoisCdf(k,l){ // P(X <= k), X ~ Poisson(l)
  if(l<=0) return 1; if(k<0) return 0;
  if(l>200){ const z=(k+0.5-l)/Math.sqrt(l); return maNorm(z); }
  let t=Math.exp(-l), s=t; for(let i=1;i<=k;i++){ t*=l/i; s+=t; } return Math.min(1,s); }
function maNorm(z){ const t=1/(1+0.2316419*Math.abs(z)), d=0.3989423*Math.exp(-z*z/2);
  const p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274)))); return z>0?1-p:p; }
// two-sided chance that a count this far from what was expected is just noise
function maPoisP(k,l){ if(l<=0) return k>0?0:1; const lo=maPoisCdf(k,l), hi=1-maPoisCdf(k-1,l); return Math.min(1,2*Math.min(lo,hi)); }
function maSd(a){ if(a.length<2) return 0; const m=a.reduce((s,x)=>s+x,0)/a.length; return Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/(a.length-1)); }
function maPct(x){ return x==null||!isFinite(x)?'—':(x>0?'+':'')+Math.round(x*100)+'%'; }
function maRate(n,d){ return d>0?n/d:null; }

// ---------------------------------------------------------------- data
async function maAll(q){ const out=[]; for(let f=0;;f+=1000){ const r=await q().range(f,f+999); if(r.error) throw r.error; out.push.apply(out,r.data||[]); if(!r.data||r.data.length<1000) break; } return out; }
async function maLoad(){
  const today=obIst(), from=obAdd(today,-MA_DAYS_BACK);
  // the CRM a full 12 months back (16 Nov 2026: quality trend over the whole year)
  const crmFrom=new Date(Date.UTC(+today.slice(0,4),+today.slice(5,7)-12,1)).toISOString().slice(0,10);
  const [acc,em,eg,days,crm]=await Promise.all([
    sb.schema('camp').from('ads_accounts').select('platform,account_id,name,project').eq('include',true),
    obEntities('meta'), obEntities('google'),
    maAll(function(){ return sb.schema('camp').from('ads_daily').select('platform,account_id,campaign_id,day,spend,impressions,clicks,results,form_leads').gte('day',from).order('day'); }),
    maAll(function(){ return sb.schema('camp').from('crm_google_daily').select('day,business_unit,campaign_type,campaign_id,leads,qualified,site_visited,booked').gte('day',crmFrom).order('day'); })
  ]);
  if(acc.error) throw acc.error;
  const A={}; (acc.data||[]).forEach(function(a){ A[a.platform+':'+a.account_id]=a.project||a.name||a.account_id; });
  const E={}; em.concat(eg).forEach(function(x){ E[x.kind+':'+x.id]=x; });
  const camp={}; // campaign_id -> {platform, project, name, lead}
  const rows=[]; days.forEach(function(d){ const p=A[d.platform+':'+d.account_id]; if(!p) return;
    let c=camp[d.campaign_id]; if(!c){ const e=E['campaign:'+d.campaign_id]||{};
      c=camp[d.campaign_id]={id:d.campaign_id,platform:d.platform,project:p,name:e.name||d.campaign_id,status:e.status,budget:e.daily_budget,lead:d.platform==='google'?true:obIsLead(E,{campaign_id:d.campaign_id})}; }
    const leads=d.platform==='google'?(d.form_leads!=null?+d.form_leads:null):(c.lead?+d.results||0:null);
    rows.push({c:c,day:d.day,spend:+d.spend||0,impr:+d.impressions||0,clicks:+d.clicks||0,leads:leads}); });
  // CRM rows tied to our campaigns (or a project's WhatsApp line), as on the Overview
  const pn=function(x){ return String(x||'').toLowerCase().replace(/dream|banquets?/g,'').replace(/[^a-z0-9]/g,''); };
  const projN={}; Object.keys(A).forEach(function(k){ projN[pn(A[k])]=A[k]; });
  // (the entity rows carry no platform field: which list they came from says it)
  const own={}; [['meta',em],['google',eg]].forEach(function(x){ x[1].forEach(function(e){ if(e.kind!=='campaign') return; const p=A[x[0]+':'+e.account_id]; if(p) own[x[0]+':'+e.id]=p; }); });
  const crmRows=[]; crm.forEach(function(x){ const fb=x.campaign_type==='facebook', id=String(x.campaign_id), o=own[(fb?'meta':'google')+':'+id], wa=fb&&/^whatsapp/i.test(id);
    if(!o&&!wa) return; crmRows.push({day:x.day,platform:fb?'meta':'google',cid:o?id:null,project:o||projN[pn(x.business_unit)]||x.business_unit,
      leads:+x.leads||0,ql:+x.qualified||0,sv:+x.site_visited||0,bk:+x.booked||0}); });
  MA_D={today:today,rows:rows,camp:camp,crm:crmRows,E:E,A:A};
}

// ---------------------------------------------------------------- view
/* COMPACT (16 Nov 2026, Ayush: "too long ... too much text"). Four summary cards on top, one per model; a click opens
   that model's detail under them, one at a time. Explanations sit behind an (i) tooltip; the full maths is in the
   document "JainE Marketing Analytics: Models and Calculations". Long lists open on demand. */
const MA_CSS2='<style>'
  +'.ma-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 22px}'
  +'@media(max-width:1000px){.ma-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.ma-cards{grid-template-columns:1fr}}'
  +'.ma-k{position:relative;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px;min-height:118px;cursor:pointer;text-align:left;font-family:inherit;color:#0f172a;transition:box-shadow .15s,border-color .15s;box-shadow:0 1px 2px rgba(15,23,42,.04)}'
  +'.ma-k:hover{border-color:#cbd5e1;box-shadow:0 4px 14px rgba(15,23,42,.07)}'
  +'.ma-kt{display:flex;align-items:center;gap:9px;margin:0 0 10px;padding-right:14px}'
  +'.ma-ic{flex:none;width:28px;height:28px;border-radius:8px;background:#f1f5f9;color:#475569;display:inline-flex;align-items:center;justify-content:center;font-size:12.5px}'
  +'.ma-kn{font-size:13px;font-weight:600;color:#334155;line-height:1.25}'
  +'.ma-dot{position:absolute;top:16px;right:16px;width:8px;height:8px;border-radius:50%;background:#cbd5e1}'
  +'.ma-dot.bad{background:#ef4444}.ma-dot.warn{background:#f59e0b}.ma-dot.good{background:#22c55e}'
  +'.ma-kv{font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-.01em;margin:0 0 3px;font-variant-numeric:tabular-nums}'
  +'.ma-ks{font-size:12px;color:#64748b;line-height:1.4}'
  +'.ma-grp{font-size:12.5px;font-weight:600;color:#64748b;margin:2px 2px 10px}'
  +'.ma-kl{font-size:12.5px;font-weight:600;color:#64748b}'
  +'.ma-i{color:#cbd5e1;cursor:help;font-size:13px;margin-left:2px}.ma-i:hover{color:#64748b}'
  +'.ma-row{cursor:pointer}'
  +'.ma-more{border:0;background:none;color:#475569;font-weight:600;font-size:13px;cursor:pointer;padding:10px 2px}.ma-more:hover{color:#0f172a}'
  +'.ma-up{color:#15803d}.ma-dn{color:#b91c1c}'
  // four big cards, proper buttons, stat tiles, the watch feed
  +'.ma-big{display:flex;flex-wrap:wrap;gap:12px}.ma-big>.ma-k{flex:1 1 calc(25% - 12px);min-width:200px}'   // every row filled edge to edge: 4 + 3 stretch, no empty space
  +'.ma-big .ma-k{min-height:150px;padding:18px 20px}.ma-big .ma-kv{font-size:24px;margin-top:6px}.ma-big .ma-ks{font-size:12.5px;max-width:92%}'
  +'.ma-open{display:inline-flex;gap:6px;align-items:center;margin-top:12px;font-size:12.5px;font-weight:600;color:#334155;border:1px solid #e2e8f0;border-radius:8px;padding:5px 10px;background:#f8fafc}'
  +'.ma-k:hover .ma-open{background:#0f172a;color:#fff;border-color:#0f172a}'
  +'.ma-btn{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 14px;border:1px solid #e2e8f0;border-radius:9px;background:#fff;color:#334155;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 1px 2px rgba(15,23,42,.04)}'
  +'.ma-btn:hover{background:#f8fafc;border-color:#cbd5e1;color:#0f172a}'
  +'.ma-seg{display:inline-flex;border:1px solid #e2e8f0;border-radius:10px;padding:3px;background:#f8fafc;gap:2px}'
  +'.ma-seg button{border:0;background:none;height:28px;padding:0 12px;border-radius:7px;font-family:inherit;font-size:12.5px;font-weight:600;color:#64748b;cursor:pointer}'
  +'.ma-seg button:hover{color:#0f172a}.ma-seg button.on{background:#fff;color:#0f172a;box-shadow:0 1px 3px rgba(15,23,42,.12)}'
  +'.ma-h .ma-seg{margin-left:auto}'
  +'.ma-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:0 0 14px}'
  +'.ma-st{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px}.ma-stl{font-size:12px;font-weight:600;color:#64748b}'
  +'.ma-stv{font-size:22px;font-weight:700;color:#0f172a;margin:4px 0 2px;font-variant-numeric:tabular-nums}'
  +'.ma-note{font-size:12.5px;color:#64748b;margin:0 0 14px}'
  +'.ma-feed{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}'
  +'.ma-fi{display:grid;grid-template-columns:14px 1fr minmax(180px,30%);gap:12px;padding:12px 16px;border-bottom:1px solid #f1f5f9;align-items:start}.ma-fi:last-child{border-bottom:0}'
  +'@media(max-width:760px){.ma-fi{grid-template-columns:14px 1fr}.ma-fa{grid-column:2}}'
  +'.ma-dot2{width:8px;height:8px;border-radius:50%;background:#cbd5e1;margin-top:6px}.ma-dot2.bad{background:#ef4444}.ma-dot2.warn{background:#f59e0b}.ma-dot2.good{background:#22c55e}'
  +'.ma-ft{font-size:13.5px;font-weight:600;color:#0f172a}.ma-fc{font-size:12px;color:#64748b;margin-top:2px}.ma-fw{font-size:12.5px;color:#334155;margin-top:4px}'
  +'.ma-fa{font-size:12.5px;color:#475569;background:#f8fafc;border-radius:8px;padding:7px 10px}'
  +'</style>';
let MA_VIEW=null, MA_OPEN=null, MA_ALL=false;
async function maView(host){
  host.innerHTML=MA_CSS+MA_CSS2+'<div id="maBody"><div class="loader"><div class="spin"></div></div></div>';
  try{ if(!MA_D||MA_D.today!==obIst()) await maLoad(); }
  catch(e){ $('maBody').innerHTML='<div class="card card-pad" style="color:#b91c1c">Could not load: '+esc(e.message||String(e))+'</div>'; return; }
  maPaint();
  // models that need more data (ad level, impression share) load it after the first paint (46-marketing-intel-more.js)
  if(typeof maLoadExtra==='function') maLoadExtra().then(maPaint,function(){ maPaint(); });
}
window.maSetWin=function(v){ MA.win=+v; MA_OPEN=null; maPaint(); };
window.maGo=function(v){ MA_VIEW=v; MA_ALL=false; maPaint(); };
window.maOpen=function(p){ MA_OPEN=MA_OPEN===p?null:p; maPaint(); };
window.maAllToggle=function(){ MA_ALL=!MA_ALL; maPaint(); };
function maSum(list,f){ return list.reduce(function(s,x){ return s+(+x[f]||0); },0); }
function maIn(d,s,e){ return d>=s&&d<=e; }
function maInfo(t){ return '<i class="fa-solid fa-circle-info ma-i" title="'+esc(t)+'"></i>'; }
function maVs(a,b){ if(!(b>0)) return ''; const c=a/b-1; return '<span class="'+(c>=0?'ma-up':'ma-dn')+'">'+maPct(c)+'</span>'; }
function obDmyS(d){ const s=String(d).split('-'); return s[2]+'/'+s[1]; }
function maPlat(pl){ return pl==='google'?'<i class="fa-brands fa-google" style="color:#ea4335"></i>':'<i class="fa-brands fa-facebook" style="color:#1877f2"></i>'; }

/* CARDS THAT OPEN PAGES (16 Nov 2026, Ayush: "I just want Cards when one is clicked a different page showcasing it").
   Every model registers itself in MA_REG: {id, group, title, icon, color, data(), card(d) -> {val, sub, tone}, view(d),
   ready()? (false while its extra data is still loading)}. The grid shows one card per model, grouped; a click opens
   that model alone with a back link. Each model's data() runs once per paint and is shared by its card and page. */
const MA_REG=[];
function maReg(m){ MA_REG.push(m); }
function maPaint(){
  const b=$('maBody'); if(!b) return;
  const cache={}; const dataOf=function(m){ if(!(m.id in cache)){ try{ cache[m.id]=m.data(); }catch(e){ cache[m.id]={__err:e.message||String(e)}; } } return cache[m.id]; };
  const page=MA_VIEW&&MA_REG.find(function(m){ return m.id===MA_VIEW; });
  if(page){
    const d=dataOf(page);
    b.innerHTML='<div style="margin:0 0 14px"><button class="ma-btn" onclick="maGo(null)"><i class="fa-solid fa-arrow-left"></i> All insights</button></div>'
      +(page.ready&&!page.ready()?'<div class="loader"><div class="spin"></div></div>':d&&d.__err?'<div class="ma-card" style="color:#b91c1c">Could not work this out: '+esc(d.__err)+'</div>':page.view(d));
    return;
  }
  // four cards, 2 x 2 (16 Nov 2026: the twelve earlier cards merged into four - 46-marketing-intel-more.js)
  b.innerHTML='<div class="ma-cards ma-big">'+MA_REG.map(function(m){
      let c; if(m.ready&&!m.ready()) c={val:'…',sub:'Working it out'}; else { const d=dataOf(m); c=d&&d.__err?{val:'—',sub:'Could not work this out'}:m.card(d); }
      return '<button class="ma-k" onclick="maGo(\''+m.id+'\')"><span class="ma-dot'+(c.tone?' '+c.tone:'')+'"></span>'
        +'<div class="ma-kt"><span class="ma-ic"><i class="'+m.icon+'"></i></span><span class="ma-kn">'+m.title+'</span></div>'
        +'<div class="ma-kv">'+c.val+'</div><div class="ma-ks">'+c.sub+'</div><span class="ma-open">Open <i class="fa-solid fa-arrow-right"></i></span></button>'; }).join('')+'</div>';
}
function maHead(icon,color,title,info,extra){ return '<div class="ma-h"><i class="'+icon+'"></i> '+title+maInfo(info)+(extra||'')+'</div>'; }

// 4. MONTH-END FORECAST ---------------------------------------------------------
function maForecastData(){
  const D=MA_D, today=D.today, y=obAdd(today,-1), m0=today.slice(0,8)+'01';
  const dim=new Date(Date.UTC(+today.slice(0,4),+today.slice(5,7),0)).getUTCDate(), done=+today.slice(8,10)-1, left=dim-done;
  const lm0=obAdd(m0,-1).slice(0,8)+'01', lm1=obAdd(m0,-1), r0=obAdd(today,-7);
  const projects={}; D.rows.forEach(function(r){ projects[r.c.project]=1; });
  const bud={}; Object.keys(D.camp).forEach(function(k){ const c=D.camp[k]; if(caLive(c.status)&&c.budget!=null) bud[c.project]=(bud[c.project]||0)+(+c.budget||0); });
  const line=function(p){
    const rs=D.rows.filter(function(r){ return !p||r.c.project===p; }), cr=D.crm.filter(function(r){ return !p||r.project===p; });
    const mtd=rs.filter(function(r){ return maIn(r.day,m0,y); }), rec=rs.filter(function(r){ return maIn(r.day,r0,y); }), lm=rs.filter(function(r){ return maIn(r.day,lm0,lm1); });
    const daily={}; rec.forEach(function(r){ daily[r.day]=(daily[r.day]||0)+r.spend; }); const dv=[]; for(let d=r0;d<=y;d=obAdd(d,1)) dv.push(daily[d]||0);
    const sRate=maSum(rec,'spend')/7, lRate=maSum(rec.filter(function(r){ return r.leads!=null; }),'leads')/7;
    const cMtd=maSum(cr.filter(function(r){ return maIn(r.day,m0,y); }),'leads'), cRate=maSum(cr.filter(function(r){ return maIn(r.day,r0,y); }),'leads')/7;
    const sMtd=maSum(mtd,'spend'), sF=sMtd+sRate*left, sE=1.96*maSd(dv)*Math.sqrt(left);
    const lMtd=maSum(mtd.filter(function(r){ return r.leads!=null; }),'leads'), lam=lRate*left, lF=lMtd+lam, lE=1.96*Math.sqrt(lam);
    const cl=cRate*left, cF=cMtd+cl, cE=1.96*Math.sqrt(cl);
    const bTot=p?bud[p]:Object.keys(bud).reduce(function(s,k){ return s+bud[k]; },0);
    return {p:p,spend:sF,spendLo:Math.max(sMtd,sF-sE),spendHi:sF+sE,leads:lF,leadsLo:Math.max(lMtd,lF-lE),leadsHi:lF+lE,crm:cF,crmLo:Math.max(cMtd,cF-cE),crmHi:cF+cE,
      lmSpend:maSum(lm,'spend'),lmLeads:maSum(lm.filter(function(r){ return r.leads!=null; }),'leads'),atBudget:bTot!=null?sMtd+bTot*left:null};
  };
  return {done:done,left:left,today:today,rows:Object.keys(projects).map(line).filter(function(x){ return x.spend>0||x.lmSpend>0; }).sort(function(a,b){ return b.spend-a.spend; }),tot:line(null)};
}
function maForecastView(F){
  const mName=new Date(Date.UTC(+F.today.slice(0,4),+F.today.slice(5,7)-1,1)).toLocaleString('en-IN',{month:'long',timeZone:'UTC'});
  const head=maHead('fa-solid fa-flag-checkered','#2563eb','Month-end forecast · '+esc(mName),
    'If the last 7 days\u2019 pace holds for the remaining days. Small figures = likely range (95%). Hover a spend figure for what today\u2019s budgets would spend. No monthly targets in JainE yet, so the comparison is last month.',
    '<span class="ma-sub" style="font-weight:500;margin-left:6px">'+F.done+' days done · '+F.left+' to go</span>');
  if(F.done<1) return head+'<div class="ma-card">The month started today: the forecast begins tomorrow.</div>';
  const n0=function(x){ return obNum(Math.round(x)); };
  const tr=function(x,cls){ return '<tr'+(cls?' class="'+cls+'"':'')+'><td>'+esc(x.p||'All projects')+'</td>'
    +'<td title="At today\u2019s budgets: '+esc(obMoney(x.atBudget))+'"><b>'+obMoney(x.spend)+'</b><div class="ma-sub">'+obMoney(x.spendLo)+' – '+obMoney(x.spendHi)+'</div></td><td>'+maVs(x.spend,x.lmSpend)+'</td>'
    +'<td><b>'+n0(x.leads)+'</b><div class="ma-sub">'+n0(x.leadsLo)+' – '+n0(x.leadsHi)+'</div></td><td>'+maVs(x.leads,x.lmLeads)+'</td>'
    +'<td>'+n0(x.crm)+'</td><td>'+obMoney(x.leads>0?x.spend/x.leads:null)+'</td></tr>'; };
  return head+'<div style="overflow-x:auto"><table class="ma-tbl"><thead><tr><th>Project</th><th>Spend</th><th>vs last month</th><th>Leads</th><th>vs last month</th><th>CRM leads</th><th>Cost per lead</th></tr></thead><tbody>'
    +F.rows.map(function(x){ return tr(x); }).join('')+tr(F.tot,'ma-p')+'</tbody></table></div>';
}

// 2. WHY DID COST PER LEAD CHANGE ------------------------------------------------
function maParts(rs){ const s=maSum(rs,'spend'), i=maSum(rs,'impr'), c=maSum(rs,'clicks'), l=maSum(rs,'leads');
  return {spend:s,impr:i,clicks:c,leads:l,cpm:i?s/i*1000:null,ctr:i?c/i:null,cvr:c?l/c:null,cpl:l?s/l:null}; }
function maChangesData(){
  const D=MA_D, y=obAdd(D.today,-1), r0=obAdd(D.today,-7), b1=obAdd(D.today,-8), b0=obAdd(D.today,-35);
  const groups={};
  D.rows.forEach(function(r){ if(r.leads==null) return; const k=r.c.id; (groups[k]=groups[k]||{c:r.c,rec:[],base:[]});
    if(maIn(r.day,r0,y)) groups[k].rec.push(r); else if(maIn(r.day,b0,b1)) groups[k].base.push(r); });
  const out=[];
  Object.keys(groups).forEach(function(k){ const g=groups[k], R=maParts(g.rec), B=maParts(g.base);
    if(!(R.spend>0)||!(B.leads>=10)||!(B.spend>0)||!caLive(g.c.status)) return;
    const lam=R.spend*B.leads/B.spend, p=maPoisP(Math.round(R.leads),lam);
    const ch={cpl:R.cpl&&B.cpl?R.cpl/B.cpl-1:null,cpm:R.cpm&&B.cpm?R.cpm/B.cpm-1:null,ctr:R.ctr&&B.ctr?R.ctr/B.ctr-1:null,cvr:R.cvr!=null&&B.cvr?R.cvr/B.cvr-1:null};
    let why='';
    if(R.leads>0&&R.impr>0&&R.clicks>0&&B.impr>0&&B.clicks>0){
      const a=Math.log(R.cpm/B.cpm), c=-Math.log(R.ctr/B.ctr), v=-Math.log(R.cvr/B.cvr), t=a+c+v;
      const parts=[[a,'auction cost',ch.cpm],[c,'click rate',ch.ctr],[v,'clicks to leads',ch.cvr]]
        .filter(function(x){ return Math.abs(x[0])>0.02; }).sort(function(x,y2){ return Math.abs(y2[0])-Math.abs(x[0]); });
      if(parts.length&&Math.abs(t)>0.02) why=parts.slice(0,2).map(function(x){ return x[1]+' '+maPct(x[2]); }).join(', ');
    } else if(R.leads===0) why='no lead in 7 days';
    out.push({c:g.c,R:R,B:B,lam:lam,p:p,ch:ch,why:why}); });
  return out.sort(function(a,b){ return a.p-b.p||b.R.spend-a.R.spend; });
}
function maChangesView(F,C){
  const real=C.filter(function(x){ return x.p<0.05; }), list=MA_ALL?C:real;
  const head=maHead('fa-solid fa-magnifying-glass-chart','#7c3aed','Why did cost per lead change?',
    'Last 7 complete days vs the 28 before, for running lead campaigns with 10+ earlier leads. Cost per lead = auction cost \u00f7 (click rate \u00d7 clicks-to-leads), so "Main cause" names the lever that moved it most. "Real" = leads too far from what the earlier rate predicted to be chance (under 5%).');
  const verdict=function(x){ return x.p>=0.05?'<span class="ma-b mid">Normal</span>':x.R.leads<x.lam?'<span class="ma-b bad">Real: fewer leads</span>':'<span class="ma-b good">Real: more leads</span>'; };
  const body=list.length?'<div style="overflow-x:auto"><table class="ma-tbl"><thead><tr><th>Campaign</th><th>Verdict</th><th>Leads (expected)</th><th>Cost per lead</th><th>Main cause</th></tr></thead><tbody>'
    +list.map(function(x){ return '<tr><td class="ma-n">'+maPlat(x.c.platform)+' '+esc(x.c.name)+'<div class="ma-sub">'+esc(x.c.project)+'</div></td><td>'+verdict(x)+'</td>'
      +'<td>'+obNum(Math.round(x.R.leads))+' <span class="ma-sub">('+obNum(Math.round(x.lam))+')</span></td><td>'+obMoney(x.R.cpl)+' <span class="'+((x.ch.cpl||0)>0?'ma-dn':'ma-up')+'">'+maPct(x.ch.cpl)+'</span></td><td class="ma-n">'+esc(x.why||'—')+'</td></tr>'; }).join('')+'</tbody></table></div>'
    :'<div class="ma-card"><span class="ma-b good">All normal</span> No lead campaign changed beyond normal variation in the last 7 days.</div>';
  const more=C.length>real.length?'<button class="ma-more" onclick="maAllToggle()">'+(MA_ALL?'Show only real changes':'Show all '+C.length+' campaigns')+'</button>':'';
  return head+body+more;
}

// 3. MONEY-WASTING ALERTS --------------------------------------------------------
function maAlertsData(){
  const D=MA_D, y=obAdd(D.today,-1), r0=obAdd(D.today,-7), b1=obAdd(D.today,-8), b0=obAdd(D.today,-35);
  const wEnd=obAdd(D.today,-MA_SETTLE), wStart=obAdd(wEnd,-(MA.win-1));
  const out=[];
  const by={}; D.rows.forEach(function(r){ if(r.leads==null||!caLive(r.c.status)) return; const g=by[r.c.id]=by[r.c.id]||{c:r.c,rs:0,rl:0,bs:0,bl:0};
    if(maIn(r.day,r0,y)){ g.rs+=r.spend; g.rl+=r.leads; } else if(maIn(r.day,b0,b1)){ g.bs+=r.spend; g.bl+=r.leads; } });
  Object.keys(by).forEach(function(k){ const g=by[k]; if(g.rs<3000||g.rl>0||g.bs<=0) return; const lam=g.rs*g.bl/g.bs, p=Math.exp(-lam);
    if(p<0.05) out.push({w:g.rs,c:g.c,kind:'No leads in 7 days',cls:'bad',what:'Spent '+obMoney(g.rs)+', 0 leads; ~'+obNum(Math.round(lam))+' were due',check:'form / landing page, tracking, recent ad changes'}); });
  const cw=D.crm.filter(function(r){ return maIn(r.day,wStart,wEnd); });
  const pr={}; cw.forEach(function(r){ const k=r.project+'|'+r.platform; const x=pr[k]=pr[k]||{l:0,q:0}; x.l+=r.leads; x.q+=r.ql; });
  const cc={}; cw.forEach(function(r){ if(!r.cid) return; const x=cc[r.cid]=cc[r.cid]||{l:0,q:0}; x.l+=r.leads; x.q+=r.ql; });
  const sp={}; D.rows.forEach(function(r){ if(maIn(r.day,wStart,wEnd)) sp[r.c.id]=(sp[r.c.id]||0)+r.spend; });
  Object.keys(cc).forEach(function(id){ const x=cc[id], c=D.camp[id]; if(!c||x.l<15||x.q>0) return; const base=pr[c.project+'|'+c.platform]; if(!base||!base.l) return;
    const exp=x.l*base.q/base.l; if(Math.exp(-exp)>=0.05) return;
    out.push({w:sp[id]||0,c:c,kind:'Leads, no qualified leads',cls:'warn',what:obNum(x.l)+' CRM leads, 0 QL; ~'+obNum(Math.round(exp))+' were due',check:'targeting, the ad\u2019s promise, the form\u2019s questions'}); });
  return out.sort(function(a,b){ return b.w-a.w; });
}
function maAlertsView(F,C,A){
  const head=maHead('fa-solid fa-triangle-exclamation','#dc2626','Money-wasting alerts',
    'Flagged only when zero results would happen by chance less than 5% of the time. "No leads": last 7 days vs the campaign\u2019s own 28 days before. "No qualified leads": the settled window (ends 21 days ago) vs the project\u2019s QL rate.');
  if(!A.length) return head+'<div class="ma-card"><span class="ma-b good">Nothing to flag</span> No campaign is spending without results beyond what chance explains.</div>';
  return head+'<div style="overflow-x:auto"><table class="ma-tbl"><thead><tr><th>Campaign</th><th>Alert</th><th>What happened</th><th>Check</th></tr></thead><tbody>'
    +A.map(function(a){ return '<tr><td class="ma-n">'+maPlat(a.c.platform)+' '+esc(a.c.name)+'<div class="ma-sub">'+esc(a.c.project)+(caLive(a.c.status)?'':' · paused')+'</div></td><td><span class="ma-b '+a.cls+'">'+a.kind+'</span></td><td class="ma-n">'+esc(a.what)+'</td><td class="ma-n ma-sub">'+esc(a.check)+'</td></tr>'; }).join('')
    +'</tbody></table></div>';
}

// 1. QUALITY OF SPEND --------------------------------------------------------------
function maQAgg(rows,crm){ const s=maSum(rows,'spend'), l=maSum(rows.filter(function(r){ return r.leads!=null; }),'leads');
  const cl=maSum(crm,'leads'), q=maSum(crm,'ql'), v=maSum(crm,'sv'), b=maSum(crm,'bk');
  return {s:s,l:l,cl:cl,q:q,v:v,b:b,cpl:maRate(s,l),cpq:q?s/q:null,cpv:v?s/v:null,qr:maRate(q,cl)}; }
function maQualityData(){
  const D=MA_D, wEnd=obAdd(D.today,-MA_SETTLE), wStart=obAdd(wEnd,-(MA.win-1));
  const rs=D.rows.filter(function(r){ return maIn(r.day,wStart,wEnd); }), cr=D.crm.filter(function(r){ return maIn(r.day,wStart,wEnd); });
  const P={}; rs.forEach(function(r){ P[r.c.project]=1; });
  const projects=Object.keys(P).map(function(p){ return {p:p,x:maQAgg(rs.filter(function(r){ return r.c.project===p; }),cr.filter(function(r){ return r.project===p; }))}; })
    .filter(function(o){ return o.x.s>0; }).sort(function(a,b){ return b.x.s-a.x.s; });
  const ids={}; rs.forEach(function(r){ ids[r.c.id]=1; });
  const camps=Object.keys(ids).map(function(id){ return {c:D.camp[id],x:maQAgg(rs.filter(function(r){ return r.c.id===id; }),cr.filter(function(r){ return r.cid===id; }))}; })
    .filter(function(z){ return z.x.s>=5000; });
  return {wStart:wStart,wEnd:wEnd,rs:rs,cr:cr,projects:projects,camps:camps};
}
function maQualityView(F,C,A,Q){
  const sure=function(x){ return x.cl>=40?'':x.cl>=15?' <span class="ma-b mid">rough</span>':' <span class="ma-b warn">few</span>'; };
  const cells=function(x){ return '<td>'+obMoney(x.s)+'</td><td>'+obNum(x.cl)+'</td><td>'+(x.qr==null?'—':Math.round(x.qr*100)+'%')+sure(x)+'</td><td>'+obMoney(x.cpl)+'</td><td><b>'+obMoney(x.cpq)+'</b></td><td>'+obMoney(x.cpv)+'</td><td>'+obNum(x.b)+'</td>'; };
  let body='';
  Q.projects.forEach(function(o){
    const open=MA_OPEN===o.p;
    body+='<tr class="ma-p ma-row" onclick="maOpen(\''+esc(o.p).replace(/'/g,"\\'")+'\')"><td><i class="fa-solid fa-chevron-'+(open?'down':'right')+'" style="font-size:10px;color:#94a3b8;margin-right:6px"></i>'+esc(o.p)+'</td>'+cells(o.x)+'</tr>';
    if(!open) return;
    ['google','meta'].forEach(function(pl){
      const prs=Q.rs.filter(function(r){ return r.c.project===o.p&&r.c.platform===pl; }); if(!maSum(prs,'spend')) return;
      body+='<tr><td style="padding-left:24px">'+maPlat(pl)+' '+(pl==='google'?'Google':'Facebook')+'</td>'+cells(maQAgg(prs,Q.cr.filter(function(r){ return r.project===o.p&&r.platform===pl; })))+'</tr>';
      Q.camps.filter(function(z){ return z.c.project===o.p&&z.c.platform===pl; }).sort(function(a,b){ return (a.x.cpq||9e15)-(b.x.cpq||9e15)||b.x.s-a.x.s; }).forEach(function(z){
        const note=pl==='meta'&&!z.x.cl?(z.c.lead?' <span class="ma-sub">· WhatsApp, on project line</span>':' <span class="ma-sub">· not a lead campaign</span>'):'';
        body+='<tr><td class="ma-n" style="padding-left:44px">'+esc(z.c.name)+(caLive(z.c.status)?'':' <span class="ma-b mid">paused</span>')+note+'</td>'+cells(z.x)+'</tr>'; });
    }); });
  return maHead('fa-solid fa-ranking-star','#059669','Cost per qualified lead',
      'Spend \u00f7 CRM qualified leads (and site visits), over a window ending 21 days ago because the CRM qualifies leads late. Click a project for its platforms and campaigns (\u20b95,000+ spend), cheapest per QL first. "rough" = 15-39 CRM leads, "few" = under 15.',
      '<select class="ma-sel" style="margin-left:auto;height:30px;border:1px solid var(--line);border-radius:8px;font-size:12.5px;font-weight:600;background:var(--bg-card);color:var(--ink)" onchange="maSetWin(this.value)">'+[[30,'30 days'],[60,'60 days'],[90,'90 days']].map(function(o){ return '<option value="'+o[0]+'"'+(MA.win===o[0]?' selected':'')+'>'+o[1]+'</option>'; }).join('')+'</select><span class="ma-sub" style="font-weight:500;margin-left:8px">'+esc(obDmyS(Q.wStart))+' – '+esc(obDmyS(Q.wEnd))+'</span>')
    +'<div style="overflow-x:auto"><table class="ma-tbl"><thead><tr><th>Project</th><th>Spend</th><th>CRM leads</th><th>QL rate</th><th>Cost per lead</th><th>Cost per QL</th><th>Cost per SV</th><th>Booked</th></tr></thead><tbody>'
    +(body||'<tr><td colspan="8">No spend in this window.</td></tr>')+'</tbody></table></div>';
}
