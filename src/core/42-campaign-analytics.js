
/* ============================ CAMPAIGN ANALYTICS - BY PROJECT, GOOGLE AND FACEBOOK TOGETHER ============================
   6 Nov 2026, as Ayush asked: not a Facebook tab and a Google tab, but one page.
     Period (or a date range) and, if wanted, a project at the top.
     A row per project: Google and Facebook added together.
     Click a project (or choose it) - its combined figures open under it, with a Google and a Facebook tile.
     Click Google or Facebook - that platform's campaigns for the project, and every ad of all of them.
     Click a campaign - its ad sets (Facebook) / ad groups (Google), the lowest level, and only its ads.
     Click an ad set - only its ads.
   Each step down filters the figures and the ads; the trail at the top of the platform section goes back up.
   Data: camp.ads_daily / ads_ad_daily via the RPCs and helpers of 41-our-brand-ads.js (obRange, obIsLead ...).
   Ad sets come from ads_ad_daily.adset_id, recorded from 6 Nov 2026 (migration 20261106200000). */
/* WHERE YOU WERE (18 Nov 2026, Ayush: "a reload opens Campaigns instead of where I was working"): the tab, the open project and
   the open platform are kept in this browser and come back after a reload. */
const CA_WHERE=(function(){ try{ return JSON.parse(localStorage.getItem('caWhere')||'{}')||{}; }catch(e){ return {}; } })();
let CA={proj:'all',open:CA_WHERE.open||null,plat:CA_WHERE.plat||null,camp:null,adset:null,showAds:12,cmp:{on:false,period:'prev',from:'',to:''}};
let CA_D=null;   // the period's data: {acc, ent, cur, prev, ads, hasSets}
const CA_PLAT={google:{name:'Google',icon:'fa-brands fa-google',color:'#ea4335',res:'Leads',per:'Cost per lead',set:'Ad group',sets:'Ad groups'},
               meta:{name:'Facebook',icon:'fa-brands fa-facebook',color:'#1877f2',res:'Leads & chats',per:'Cost per lead',set:'Ad set',sets:'Ad sets'}};
const CA_CSS='<style>'
  +'.ca-tbl{width:100%;border-collapse:collapse;font-size:13px}.ca-tbl th{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--slate);background:#f8fafc;padding:9px 12px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}'
  +'.ca-tbl th:first-child,.ca-tbl td:first-child{text-align:left}.ca-tbl td{padding:11px 12px;border-bottom:1px solid #eef1f4;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}'
  +'.ca-tbl tr.ca-row{cursor:pointer}.ca-tbl tr.ca-row:hover td{background:#f8fafc}.ca-tbl tr.ca-on>td{background:#eef4ff}'
  +'.ca-tbl tr.ca-row td:first-child{font-weight:700}.ca-tbl .ca-caret{color:#94a3b8;font-size:11px;margin-right:8px;width:10px;display:inline-block}'
  // thin rows under a project, each level indented a step further and a shade lighter in weight
  +'.ca-tbl tr.ca-l1 td,.ca-tbl tr.ca-l2 td,.ca-tbl tr.ca-l3 td{padding-top:7px;padding-bottom:7px;font-size:12.5px}'
  +'.ca-tbl tr.ca-l1 td:first-child{padding-left:34px;font-weight:650}'
  +'.ca-tbl tr.ca-l2 td:first-child{padding-left:58px;font-weight:500;white-space:normal;max-width:460px}'
  +'.ca-tbl tr.ca-l3 td:first-child{padding-left:82px;font-weight:400;white-space:normal;max-width:460px;color:#334155}'
  +'.ca-tbl tr.ca-l1 td{background:#fcfcfd}.ca-tbl tr.ca-l2 td{background:#fafbfc}.ca-tbl tr.ca-l3 td{background:#f8f9fb}'
  +'.ca-tbl tr.ca-none td{color:var(--slate);font-size:12px;text-align:left}.ca-tbl tr.ca-row.ca-on>td{background:#eef4ff}'
  +'.ca-tbl tr.ca-l2.ca-none td:first-child{padding-left:58px}.ca-tbl tr.ca-l3.ca-none td:first-child{padding-left:82px}'
  // the platform section sits in the table, right under its Google / Facebook row
  +'.ca-below{margin-top:14px;scroll-margin-top:80px}'
  +'.ca-sec .ca-tbl tr.ca-l0 td{font-size:13px;padding-top:9px;padding-bottom:9px}.ca-sec .ca-tbl tr.ca-l0 td:first-child{font-weight:600;min-width:280px}.ca-sec .ca-tbl tr.ca-l1 td:first-child{min-width:280px}'
  +'.ca-sec{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff}.ca-sec .ob-ads{padding:0 12px 12px}.ca-sec>div:last-child{padding-bottom:4px}'
  +'.ca-cmp{font-size:11px;font-weight:500;color:#94a3b8;margin-top:2px;white-space:nowrap}.ca-cmp .good{color:#15803d;font-weight:700}.ca-cmp .bad{color:#b91c1c;font-weight:700}.ca-cmp .flat{color:#64748b;font-weight:600}'
  +'.ca-tbl tr.ca-tot td{font-weight:700;background:#f1f5f9;border-top:2px solid #cbd5e1;border-bottom:0}.ca-tbl tr.ca-tot td b{font-weight:800}'
  +'.ca-sw{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;color:#334155;cursor:pointer;user-select:none;padding:0 4px}.ca-sw input{display:none}.ca-sw .k{width:32px;height:18px;border-radius:10px;background:#cbd5e1;position:relative;transition:background .15s}.ca-sw .k:after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:left .15s}.ca-sw.on .k{background:#2563eb}.ca-sw.on .k:after{left:16px}'
  // the CRM's columns: a violet rule down their left edge and a violet group heading over them
  // the CRM's columns have violet headings; a name column has one width and never wraps
  +'.ca-tbl th.ca-crm{color:#6d28d9;background:#f5f3ff}'
  +'.ca-sec .ca-tbl td.ca-nm,.ca-sec .ca-tbl th.ca-nm{width:340px;min-width:340px;max-width:340px}.ca-nmx{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  +'.ca-sub{font-size:10.5px;color:#94a3b8;margin-top:1px;white-space:nowrap}'
  // 18 Nov 2026 (Ayush: "when I choose Custom it goes to a 2nd line"): narrower date boxes and gaps keep the strip on one line
  +'.ob-bar{gap:8px}.ob-bar input[type=date]{width:120px;padding:0 4px 0 8px;font-size:12.5px}'
  +'.ca-stg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff}.ca-st{display:inline-flex;align-items:center;gap:6px;padding:6px 9px;font-size:12.5px;font-weight:600;color:#334155;cursor:pointer;border-right:1px solid var(--line)}.ca-st:last-child{border-right:0}.ca-st input{margin:0;accent-color:#2563eb}.ca-st.on{background:#eef4ff;color:#1d4ed8}'
  // a video ad's card: a play mark over its picture (17 Nov 2026)
  // the card's figures two pairs to a line, so every card is short and the same height (17 Nov 2026, Ayush); the picture
  // stays the fixed 190 px, cropped to fill (41-our-brand-ads.js)
  +'.ca-sec .ob-ad .m{grid-template-columns:auto 1fr auto 1fr;gap:3px 8px;font-size:11.5px;margin-top:auto}.ca-sec .ob-ad .m span{color:var(--slate)}.ca-sec .ob-ad .m b{text-align:right;white-space:nowrap}'
  +'.ob-ad .pic{position:relative}.ob-ad .pic .ca-play{display:none;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:46px;height:46px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;align-items:center;justify-content:center;font-size:17px;padding-left:3px;pointer-events:none}.ob-ad .pic.ca-isvid .ca-play{display:flex}'
  +'.ca-warn{margin:-4px 0 12px;padding:9px 12px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;font-size:12.5px}'
  /* PHONE (17 Nov 2026, Ayush: "in phone nothing is responsive"). The controls wrap onto lines of their own; in the
     tables the name column stays pinned on the left while the figures scroll sideways under it, with a narrower
     name, smaller indents and tighter cells; ad cards go one or two to a line; the ad popup fits the screen. */
  +'@media(max-width:760px){'
  +'.ob-bar{gap:8px}.ob-bar>select,.ob-bar>.comp-sel{flex:1 1 140px;min-width:0}.ob-bar input[type=date]{flex:1 1 120px;min-width:0}'
  +'.ob-bar>span[style*="margin-left:auto"]{margin-left:0!important;width:100%;justify-content:space-between}'
  +'.ca-stg{flex:1 1 100%}.ca-st{flex:1;justify-content:center}'
  +'.ca-tbl{font-size:12px}.ca-tbl th{padding:8px 8px;font-size:10px}.ca-tbl td{padding:9px 8px}'
  +'.ca-tbl th:first-child,.ca-tbl td:first-child{position:sticky;left:0;z-index:1;background:#fff;box-shadow:1px 0 0 #e2e8f0}'
  +'.ca-tbl th:first-child{background:#f8fafc}.ca-tbl tr.ca-l1 td:first-child{background:#fcfcfd}.ca-tbl tr.ca-l2 td:first-child{background:#fafbfc}'
  +'.ca-tbl tr.ca-l3 td:first-child{background:#f8f9fb}.ca-tbl tr.ca-on>td:first-child{background:#eef4ff}.ca-tbl tr.ca-tot td:first-child{background:#f1f5f9}'
  +'.ca-tbl td:first-child{white-space:normal;min-width:130px;max-width:170px}'
  +'.ca-tbl tr.ca-l1 td:first-child{padding-left:16px}.ca-tbl tr.ca-l2 td:first-child,.ca-tbl tr.ca-l2.ca-none td:first-child{padding-left:26px;max-width:170px}'
  +'.ca-tbl tr.ca-l3 td:first-child,.ca-tbl tr.ca-l3.ca-none td:first-child{padding-left:36px;max-width:170px}'
  +'.ca-sec .ca-tbl td.ca-nm,.ca-sec .ca-tbl th.ca-nm{width:170px;min-width:150px;max-width:170px}'
  +'.ca-sec .ca-tbl tr.ca-l0 td:first-child,.ca-sec .ca-tbl tr.ca-l1 td:first-child{min-width:150px}'
  +'.ca-nmx{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}'
  +'.ca-tbl .ca-caret{margin-right:4px}'
  +'.ca-sec .ob-ads{padding:0 8px 8px}'
  +'.modal-body div[style*="height:360px"]{height:240px!important}'
  +'}'
  +'@media(max-width:520px){.ob-ads{grid-template-columns:1fr!important}}'
  +'</style>';

// Leads that can honestly be added up: Google conversions, and Facebook results of lead / chat campaigns only.
function caAgg(rows){
  const E=CA_D.ent, t={spend:0,leads:0,lspend:0,clicks:0,impr:0,form:0,hasForm:false};
  rows.forEach(function(c){ const s=+c.spend||0; t.spend+=s; t.clicks+=+c.clicks||0; t.impr+=+c.impressions||0;
    if(c.platform==='google'||obIsLead(E,c)){ t.leads+=+c.results||0; t.lspend+=s; }
    if(c.platform==='google'&&c.form_leads!=null){ t.form+=+c.form_leads||0; t.hasForm=true; } });
  t.cpl=t.leads?t.lspend/t.leads:null; t.ctr=t.impr?t.clicks/t.impr*100:null; return t;
}
// Running now (Facebook ACTIVE, Google ENABLED) - only these are listed below a platform (6 Nov 2026).
function caLive(s){ s=String(s||''); return s==='ACTIVE'||s==='ENABLED'; }
/* ACTIVE / INACTIVE / BOTH (16 Nov 2026, Ayush: "while viewing, at the top there will be an option to tick Active, Inactive,
   Both"). Active = campaigns switched on now (Facebook ACTIVE, Google ENABLED); Inactive = paused, ended or removed ones;
   Both = all. The choice filters everything on the page together - the project and platform totals, the campaign and
   ad set lists, the ads and the CRM figures - so the numbers always add up to what is listed. CRM leads the CRM cannot tie
   to one campaign are left out of Active / Inactive (a WhatsApp line goes with its project's WhatsApp campaigns). */
let CA_ST='both';
function caStOk(live){ return CA_ST==='both'||(CA_ST==='active')===!!live; }
function caStatusApply(){
  const R=CA_D.raw, E=CA_D.ent;
  const okC=function(cid){ const e=E['campaign:'+cid]; return caStOk(!!e&&caLive(e.status)); };
  const f=function(rows){ return (rows||[]).filter(function(c){ return okC(c.campaign_id); }); };
  CA_D.cur=f(R.cur); CA_D.prev=f(R.prev); CA_D.ads=f(R.ads); if(CA_D.cmp) CA_D.cmp.ads=f(R.cmpAds);
  /* BUDGETS (16 Nov 2026, Ayush: "for paused ones BUDGET is still there"). Every listed campaign shows the daily budget set
     on it, paused ones too. A totals row adds up the budgets of the campaigns listed under the choice, except a switched-on
     campaign with no activity (no spend, impression or click) in the last 3 days - shown greyed as "not spending". */
  const bud={}, seen={};
  CA_D.cur.forEach(function(c){ if(!caAct(c)||seen[c.campaign_id]) return; seen[c.campaign_id]=1; const b=caCampBud(c.campaign_id); if(b==null) return; const k=c.project+'|'+c.platform; bud[k]=(bud[k]||0)+(+b); });
  CA_D.bud=bud;
  const waLive={}; Object.keys(E).forEach(function(k){ const x=E[k]; if(k.indexOf('adset:')!==0||!x||!/CONVERSATIONS|MESSAGING/.test(String(x.objective||''))) return;
    const c=E['campaign:'+x.campaign_id]; const a=c&&CA_D.acc['meta:'+c.account_id]; if(a&&caLive(c.status)) waLive[a.project]=1; });
  const okR=function(x){ if(CA_ST==='both') return true; if(x.untied) return false; if(x.wa) return caStOk(!!waLive[x.project]); return !!E['campaign:'+x.campaign_id]&&okC(x.campaign_id); };
  CA_D.crm=R.crm?{cur:R.crm.cur.filter(okR),prev:R.crm.prev.filter(okR)}:null;
  CA_D.crmSet=R.crmSet?{cur:R.crmSet.cur.filter(okR),prev:R.crmSet.prev.filter(okR)}:null;
}
/* PUBLIC LINK (17 Nov 2026, Ayush: "one public link which can be shared to people ... a toggle switch to allow or disallow
   viewing, or copy the link; if disallowed nothing will be visible in the link"). The switch and Copy link sit at the right
   of the bar, for super admins. The link opens ads-report.html - a page with no JainE code that gets only a summary from
   the campaign-share function, and only while the switch is on. */
let CA_SHARE={loaded:false,on:false,token:null,busy:false};
async function caShareCall(body){
  const {data:{session}}=await sb.auth.getSession();
  const r=await fetch(SUPABASE_URL+'/functions/v1/campaign-share',{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+((session&&session.access_token)||'')},body:JSON.stringify(body)});
  const t=await r.json().catch(function(){ return {}; }); if(!r.ok||t.error) throw new Error(t.error||('server said '+r.status)); return t;
}
// besides super admins, the people who may switch the link and copy it - the same list as the campaign-share function
// (17 Nov 2026, Ayush: "Yes, give Manash")
const CA_SHARE_PEOPLE=['digitalmarketing@thejaingroup.com'];
function caShareBar(){
  if(!state.super&&CA_SHARE_PEOPLE.indexOf(String(state.email||'').trim().toLowerCase())===-1) return '';
  if(!CA_SHARE.loaded&&!CA_SHARE.busy){ CA_SHARE.busy=true; caShareCall({action:'status'}).then(function(t){ CA_SHARE.on=!!t.on; CA_SHARE.token=t.token||null; }).catch(function(){}).then(function(){ CA_SHARE.loaded=true; CA_SHARE.busy=false; if(CA_D) caPaint(); }); }
  return '<span style="margin-left:auto;display:inline-flex;gap:8px;align-items:center">'
    +'<label class="ca-sw'+(CA_SHARE.on?' on':'')+'" title="Anyone with the link can see the campaign report while this is on"><input type="checkbox"'+(CA_SHARE.on?' checked':'')+(CA_SHARE.loaded?'':' disabled')+' onchange="caShareSet(this.checked)"><span class="k"></span>Public link</label>'
    +'<button class="btn btn-sm" style="height:32px;width:36px;padding:0;justify-content:center;gap:0" onclick="caShareCopy()"'+(CA_SHARE.token?' title="Copy the public link"':' disabled title="Switch the public link on first"')+'><i class="fa-regular fa-copy"></i></button></span>';
}
window.caShareSet=async function(on){
  try{ const t=await caShareCall({action:'set',on:!!on}); CA_SHARE.on=!!t.on; CA_SHARE.token=t.token||null; toast(t.on?'Public link is on - anyone with the link can see the report':'Public link is off - the link now shows nothing','ok'); }
  catch(e){ toast('Could not change the public link: '+e.message,'err'); }
  caPaint();
};
window.caShareCopy=function(){
  if(!CA_SHARE.token){ toast('Switch the public link on first','err'); return; }
  const link=location.origin+'/ads-report.html#k='+CA_SHARE.token;
  const done=function(){ toast(CA_SHARE.on?'Link copied':'Link copied - it shows nothing until the public link is switched on','ok'); };
  try{ navigator.clipboard.writeText(link).then(done,function(){ prompt('Copy this link',link); }); }catch(e){ prompt('Copy this link',link); }
};
// some activity in the period: spend, impressions or clicks (a paused remarketing campaign can show ads without spend)
// green = switched on (Facebook ACTIVE, Google ENABLED), red = paused / ended / removed (16 Nov 2026, Ayush)
function caDot(st){ const on=caLive(st); return '<span title="'+(on?'Enabled':esc(String(st||'Stopped').charAt(0)+String(st||'stopped').slice(1).toLowerCase()))+'" style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;vertical-align:1px;background:'+(on?'#16a34a':'#dc2626')+'"></span>'; }
function caAct(c){ return (+c.spend||0)>0||(+c.impressions||0)>0||(+c.clicks||0)>0||(+c.results||0)>0; }
// a campaign's daily budget: its own, or (Facebook ABO) its ad sets' - running ones, else all of them;
// null for a switched-on campaign with no activity in the last 3 days (it is not spending)
function caCampBud(id,raw){ const E=CA_D.ent, e=E['campaign:'+id]||{};
  let b=e.daily_budget!=null?+e.daily_budget:null;
  if(b==null){ const sets=Object.keys(E).filter(function(k){ return k.indexOf('adset:')===0&&E[k]&&E[k].campaign_id===id&&E[k].daily_budget!=null; }).map(function(k){ return E[k]; });
    const run=sets.filter(function(x){ return caLive(x.status); }), use=run.length?run:sets;
    if(use.length) b=use.reduce(function(t,x){ return t+(+x.daily_budget||0); },0); }
  if(raw) return b;
  return b!=null&&caLive(e.status)&&CA_D.sp3&&!CA_D.sp3[id]?null:b; }
window.caSt=function(v){ if(v===CA_ST||!CA_D) return; CA_ST=v; CA.camp=null; CA.adset=null; caStatusApply(); caPaint(); };
function caLeads(x){ return obNum(x,0); } // whole numbers everywhere (14 Nov 2026, Ayush): Google splits a lead's credit across campaigns, so its counts arrive as 30.6 etc.

/* TWO TABS (16 Nov 2026, Ayush: "make a new Tab named Analytics"): Overview (this page as it was) and Analytics
   (45-marketing-analytics.js - the models). */
let CA_TAB=['overview','ads','audience','checklist','analytics','sources'].indexOf(CA_WHERE.tab)>=0?CA_WHERE.tab:'overview';
function caKeepWhere(){ try{ localStorage.setItem('caWhere',JSON.stringify({tab:CA_TAB,open:CA.open,plat:CA.plat})); }catch(e){} }
async function caView(host){
  host.innerHTML=OB_CSS+CA_CSS+MA_CSS+'<div class="ca-tabs" id="caTabs"></div><div id="caMain"></div>';
  caTabsPaint(); await caShowTab();
}
function caTabsPaint(){ const t=$('caTabs'); if(!t) return;
  // 17 Nov 2026 (Ayush): Overview renamed Campaigns; a new Ads tab - the same page, read from the ad upwards
  t.innerHTML=[['overview','Campaigns'],['ads','Ads'],['audience','Audience'],['checklist','Checklist'],['analytics','Analytics'],['sources','Sources']].map(function(x){ return '<button class="ca-tab'+(CA_TAB===x[0]?' on':'')+'" onclick="caTab(\''+x[0]+'\')">'+x[1]+'</button>'; }).join(''); }
window.caTab=function(t){ if(t===CA_TAB) return;
  // Campaigns <-> Ads share the loaded data: only the table is drawn again
  if(t!=='analytics'&&CA_TAB!=='analytics'&&t!=='sources'&&CA_TAB!=='sources'&&CA_D&&$('caBody')){ CA_TAB=t; caTabsPaint(); caPaint(); return; }
  CA_TAB=t; caKeepWhere(); caTabsPaint(); caShowTab(); };
async function caShowTab(){
  const m=$('caMain'); if(!m) return;
  if(CA_TAB==='analytics') return maView(m);
  if(CA_TAB==='sources') return srcView(m);   // 19 Nov 2026: what every lead source produced, from the CRM (49-crm-sources.js)
  m.innerHTML='<div id="caHead"></div><div id="caBody"><div class="loader"><div class="spin"></div></div></div>';
  CA_D=null; await caLoad();
}
/* COMPARE MODE (7 Nov 2026, Ayush): off by default; switched on, every figure in the tables shows the other
   period's figure and the change under it. The other period is "Previous period" (the same number of days just
   before) or any option of the normal dropdown, or a custom range - never the same dates as the main period. */
const CA_CMP_OPTS=[['prev','Previous period']].concat(OB_PERIODS);
function caRangeOf(period,from,to){ const keep=OB_P; OB_P=Object.assign({},OB_P,{period:period,from:from||'',to:to||''}); try{ return obRange(); } finally{ OB_P=keep; } }
function caCmpRange(){ const r=obRange(); if(CA.cmp.period==='prev') return {s:r.ps,e:r.pe}; return caRangeOf(CA.cmp.period,CA.cmp.from,CA.cmp.to); }
function caCmpSame(){ if(!CA.cmp.on) return false; const r=obRange(), c=caCmpRange(); return r.s===c.s&&r.e===c.e; }
// every row of a query, all pages read at once (the row count first); null when the table cannot be read
// qf() builds the query afresh. The first page, then the next four pages at once, and so on until a page comes back short
// (counting the rows first cost ~0.8 s on its own).
async function caAllPages(qf){
  const c=await qf().range(0,999); if(c.error) return null;
  let out=c.data||[], f=1000;
  if(out.length<1000) return out;
  for(;;){
    const batch=[0,1,2,3].map(function(i){ return qf().range(f+i*1000,f+i*1000+999); });
    const got=await Promise.all(batch); let short=false;
    for(const p of got){ if(p.error) return null; out=out.concat(p.data||[]); if((p.data||[]).length<1000){ short=true; break; } }
    if(short) return out; f+=4000;
  }
}
// names, status, budgets and pictures of every campaign / ad set / ad, kept for 10 minutes
window._caEnt=window._caEnt||{};
/* FASTER AGAIN (18 Nov 2026, Ayush: "Campaign & Ads tab is very slow"). Every campaign, ad set AND ad ever run was read before
   the first paint - 5,200 rows, 3,900 of them ads with their words and pictures (~4 s), alongside the CRM's 4,000 ad-level rows,
   all slowing each other down (each request took 5-7 s). Now the table is drawn from the campaigns and ad sets only (1,300
   short rows); the ads' names and pictures are read only for the ads that ran in the period (~250, not 3,900), together with
   the other ad-level figures, after the table is on screen. */
async function caEntities(platform){
  const hit=window._caEnt[platform]; if(hit&&hit.at>Date.now()-600000) return hit.rows;
  const rows=await caAllPages(function(){ return sb.schema('camp').from('ads_entities').select('kind,id,account_id,campaign_id,name,status,objective,daily_budget,lifetime_budget').eq('platform',platform).in('kind',['campaign','adset']).order('kind').order('id'); });
  if(!rows) return obEntities(platform);
  window._caEnt[platform]={at:Date.now(),rows:rows}; return rows;
}
// the ads' own names, status, words and pictures - only the ones asked for, 150 a request, all at once; kept for 10 minutes
window._caAdEnt=window._caAdEnt||{};
async function caAdEntities(ids){
  const now=Date.now(), need=[...new Set(ids.map(String))].filter(function(id){ const h=window._caAdEnt[id]; return !h||h.at<now-600000; });
  const parts=[]; for(let i=0;i<need.length;i+=150) parts.push(need.slice(i,i+150));
  const got=await Promise.all(parts.map(function(p){ return sb.schema('camp').from('ads_entities').select('kind,id,account_id,campaign_id,name,status,objective,daily_budget,lifetime_budget,thumbnail,body').eq('kind','ad').in('id',p).then(function(r){ return r.data||[]; },function(){ return []; }); }));
  got.forEach(function(rows){ rows.forEach(function(x){ window._caAdEnt[String(x.id)]={at:now,row:x}; }); });
  return ids.map(function(id){ const h=window._caAdEnt[String(id)]; return h&&h.row; }).filter(Boolean);
}
async function caLoad(){
  const r=obRange(), rpc=function(fn,a){ return sb.schema('camp').rpc(fn,a); };
  const cmp=CA.cmp.on&&!caCmpSame(), c=cmp?caCmpRange():{s:r.ps,e:r.pe};
  if(CA_D) $('caBody').style.opacity='.55';
  // v4 (16 Nov 2026): an ad's figures per campaign and ad group, so an ad copied into another campaign counts in each
  // v5 (18 Nov 2026 night): v4 + video plays (25 / 50 / 75 / 100%, 3-second) and the first / last day the ad ran in the period
  const ads=async function(p,s,e){ const v5=await rpc('ads_ad_totals_v5',{p_platform:p,p_from:s,p_to:e,p_limit:5000}); if(!v5.error) return {rows:v5.data||[],sets:true,video:true};
    const v4=await rpc('ads_ad_totals_v4',{p_platform:p,p_from:s,p_to:e,p_limit:5000}); if(!v4.error) return {rows:v4.data||[],sets:true};
    const v3=await rpc('ads_ad_totals_v3',{p_platform:p,p_from:s,p_to:e,p_limit:5000}); if(!v3.error) return {rows:v3.data||[],sets:true};
    const v=await rpc('ads_ad_totals_v2',{p_platform:p,p_from:s,p_to:e,p_limit:5000});
    if(!v.error) return {rows:v.data||[],sets:true};
    const o=await rpc('ads_ad_totals',{p_platform:p,p_from:s,p_to:e,p_limit:5000}); return {rows:o.data||[],sets:false,error:o.error}; };
  const none=Promise.resolve({rows:[],sets:true});
  // Google with its form leads (ads_campaign_totals_v2, from 11 Nov 2026 night); before that the old totals, no form leads
  const gTot=async function(s,e){ const v=await rpc('ads_campaign_totals_v2',{p_platform:'google',p_from:s,p_to:e}); return v.error?rpc('ads_campaign_totals',{p_platform:'google',p_from:s,p_to:e}):v; };
  // CRM (RealtyBucket) Google leads after its filtering, by day (camp.crm_google_daily, filled at night by
  // ads-daily-sync {crm}). null = not there (yet): the CRM columns then say so instead of showing 0.
  /* FASTER (17 Nov 2026, Ayush: "the Campaign Analytics data is loading too slow"). The big reads came 1,000 rows at a time,
     one page after another (~2.5 s each); now the row count is asked first and every page is read at once. Names and
     pictures are kept for 10 minutes, so changing the period does not read them again, and the other period's CRM figures
     are read only when Compare is on (they show nowhere else). */
  const crmRows=function(s,e){ return caAllPages(function(){ return sb.schema('camp').from('crm_google_daily').select('business_unit,campaign_type,campaign_id,leads,qualified,site_visited,booked,lost').gte('day',s).lte('day',e).order('day').order('campaign_id').order('business_unit'); }); };
  // CRM figures per ad set / ad group and per ad (camp.crm_adset_daily, 16 Nov 2026: the CRM API now breaks campaigns down)
  const crmSets=function(s,e){ return caAllPages(function(){ return sb.schema('camp').from('crm_adset_daily').select('src,level,campaign_id,adset_id,ad_id,leads,qualified,site_visited,booked,lost').gte('day',s).lte('day',e).order('day').order('src').order('level').order('adset_id').order('ad_id'); }); };
  const noRows=Promise.resolve([]);
  // the ad-level figures (ads, ad sets, the CRM by ad set / ad) are only seen once a platform is opened: they are read
  // alongside but the table is drawn without waiting for them, and filled in when they arrive
  // started only once the table is drawn (18 Nov 2026), so it does not slow the first paint
  const startLater=function(){ return Promise.all([ads('meta',r.s,r.e), ads('google',r.s,r.e), cmp?ads('meta',c.s,c.e):none, cmp?ads('google',c.s,c.e):none, crmSets(r.s,r.e), cmp?crmSets(c.s,c.e):noRows])
    .then(async function(L){ const ids=[]; [0,1,2,3].forEach(function(i){ ((L[i]&&L[i].rows)||[]).forEach(function(a){ if(a.ad_id) ids.push(a.ad_id); }); }); L.adEnt=await caAdEntities(ids); return L; }); };
  const res=await Promise.all([
    sb.schema('camp').from('ads_accounts').select('platform,account_id,name,project').eq('include',true),
    caEntities('meta'), caEntities('google'),
    rpc('ads_campaign_totals',{p_platform:'meta',p_from:r.s,p_to:r.e}), gTot(r.s,r.e),
    rpc('ads_campaign_totals',{p_platform:'meta',p_from:c.s,p_to:c.e}), gTot(c.s,c.e),
    none, none, none, none,
    crmRows(r.s,r.e), cmp?crmRows(c.s,c.e):noRows, Promise.resolve(null), noRows,
    // campaigns that spent in the last 3 days (today, yesterday, the day before) - only their budgets count (see caSpending)
    sb.schema('camp').from('ads_daily').select('campaign_id').gte('day',new Date(Date.now()+5.5*3600e3-2*86400e3).toISOString().slice(0,10)).or('spend.gt.0,impressions.gt.0,clicks.gt.0').limit(20000)]);
  $('caBody').style.opacity='';
  const bad=[res[0],res[3],res[4],res[5],res[6]].filter(function(x){ return x.error; })[0];
  if(bad){ $('caBody').innerHTML='<div class="card card-pad" style="color:#b91c1c">Could not load: '+esc(bad.error.message)+'</div>'; return; }
  const acc={}; (res[0].data||[]).forEach(function(a){ acc[a.platform+':'+a.account_id]={project:a.project||a.name||a.account_id,name:a.name}; });
  const ent={}; res[1].concat(res[2]).forEach(function(x){ ent[x.kind+':'+x.id]=x; });
  /* GOOGLE LEADS = FORM LEADS (13 Nov 2026, Ayush: "Keep FORM LEADS remove the other one and rename it LEADS"). Google's
     Conversions follow each campaign's goal (Demand Gen counts qualified leads), so a Google row's results become its
     lead-form submissions. Where those are not read yet (ads, until 13 Nov 2026 night) the figure is empty, not Conversions. */
  const tag=function(p,rows){ return (rows||[]).filter(function(c){ return acc[p+':'+c.account_id]; }).map(function(c){ const o=Object.assign({platform:p,project:acc[p+':'+c.account_id].project},c);
    if(p==='google'){ o.conversions=o.results; o.results=o.form_leads!=null?+o.form_leads:null; } return o; }); };
  // Daily budget set today (7 Nov 2026, Ayush): the daily budgets of the running campaigns, per project and platform.
  // A Facebook campaign without its own budget carries its running ad sets' budgets (ads-daily-sync).
  /* ONLY CAMPAIGNS THAT ARE SPENDING (16 Nov 2026, Ayush, on Dream Gurukul's ₹18,500: "Yes, only spending"). Google showed
     five Gurukul campaigns switched on, but four had not spent for weeks or ever - their ₹11,500 counted as budget though
     nothing ran. A campaign's budget now counts only when it spent something in the last 3 days. */
  const sp3={}; ((res[15]&&res[15].data)||[]).forEach(function(x){ sp3[x.campaign_id]=1; });
  const bud={};
  [['meta',res[1]],['google',res[2]]].forEach(function(x){ x[1].forEach(function(e){
    const a=acc[x[0]+':'+e.account_id]; if(e.kind!=='campaign'||!a||!caLive(e.status)||e.daily_budget==null||(res[15]&&!res[15].error&&!sp3[e.id])) return;
    const k=a.project+'|'+x[0]; bud[k]=(bud[k]||0)+(+e.daily_budget||0); }); });
  CA_D={acc:acc,ent:ent,bud:bud,sp3:(res[15]&&!res[15].error)?sp3:null,cur:tag('meta',res[3].data).concat(tag('google',res[4].data)),prev:tag('meta',res[5].data).concat(tag('google',res[6].data)),
        ads:tag('meta',res[7].rows).concat(tag('google',res[8].rows)),hasSets:res[7].sets&&res[8].sets,
        cmp:cmp?{s:c.s,e:c.e,ads:tag('meta',res[9].rows).concat(tag('google',res[10].rows))}:null};
  // the CRM names its projects a little differently (Durbaar Banquets, Ananta): matched without "Dream" / "Banquets"
  const pn=function(x){ return String(x||'').toLowerCase().replace(/dream|banquets?/g,'').replace(/[^a-z0-9]/g,''); };
  const projN={}; Object.keys(acc).forEach(function(k){ projN[pn(acc[k].project)]=acc[k].project; });
  /* Only leads the CRM ties to one of our Google campaigns (11 Nov 2026, Ayush: no "Call" numbers and no other
     unnecessary things). The CRM's Google figure also holds phone calls (campaign "Call"), leads with no campaign ('')
     and odd ids (YNOC, kvywjtjh...) - none of them are in Google's own count, so they are left out here. */
  /* A lead counts under the project of the Google campaign it came from (11 Nov 2026): the CRM had put one lead from
     Dream World City's Demand Gen under Dream Gurukul, so Gurukul showed another project's campaign. */
  const gCamp={}; res[2].forEach(function(e){ const a=acc['google:'+e.account_id]; if(e.kind==='campaign') gCamp[String(e.id)]=a?a.project:1; });
  /* FACEBOOK TOO (14 Nov 2026): the CRM's Facebook rows (campaign_type 'facebook') count when they are one of our Facebook
     campaigns, under that campaign's project, or the CRM's "WhatsApp" line - all of a project's WhatsApp campaigns counted
     together, which can only go on the project and its Facebook row. "Others" (no campaign) is left out, as for Google. */
  const mCamp={}; res[1].forEach(function(e){ const a=acc['meta:'+e.account_id]; if(e.kind==='campaign') mCamp[String(e.id)]=a?a.project:1; });
  const crmTag=function(rows){ return (rows||[]).map(function(x){
      const fb=x.campaign_type==='facebook', id=String(x.campaign_id==null?'':x.campaign_id).trim(), own=fb?mCamp[id]:gCamp[id], wa=fb&&/^whatsapp/i.test(id);
      /* NOT TIED TO A CAMPAIGN (17 Nov 2026, Ayush: "the CRM leads are not matching the CRM"). Until now a CRM lead counted only
         when the CRM had tagged it to one of our ad campaigns - for 1-16 Nov that dropped 150 of 293 Google leads (blank, "Call",
         "1", junk ids) and 165 of 2,508 Facebook ones ("Others"). They now count on the project and Google / Facebook rows (so
         those match the CRM) and sit in a row of their own in the platform section; campaign, ad set and ad rows are unchanged. */
      if(!own&&!wa) return Object.assign({},x,{src:fb?'facebook':'google',wa:false,untied:true,
        utype:id===''?'No campaign':/^call$/i.test(id)?'Call':id==='-1'?'Others':'Other tags',project:projN[pn(x.business_unit)]||x.business_unit});
      const o=Object.assign({},x,{src:fb?'facebook':'google',wa:wa});
      o.project=own&&own!==1?own:(projN[pn(x.business_unit)]||x.business_unit); return o; }).filter(Boolean); };
  CA_D.crm=res[11]==null?null:{cur:crmTag(res[11]),prev:crmTag(res[12])};
  CA_D.crmSet=res[13]==null?null:{cur:res[13],prev:res[14]||[]};
  CA_D.raw={cur:CA_D.cur,prev:CA_D.prev,ads:CA_D.ads,cmpAds:CA_D.cmp?CA_D.cmp.ads:null,bud:CA_D.bud,crm:CA_D.crm,crmSet:CA_D.crmSet};
  CA_D.adsLoading=true;
  caStatusApply();
  caPaint();
  const D0=CA_D;
  startLater().then(function(L){ if(CA_D!==D0) return;   // a newer load has started
    (L.adEnt||[]).forEach(function(x){ D0.ent['ad:'+x.id]=x; });
    D0.raw.ads=tag('meta',L[0].rows).concat(tag('google',L[1].rows)); D0.hasSets=L[0].sets&&L[1].sets;
    if(D0.cmp) D0.raw.cmpAds=tag('meta',L[2].rows).concat(tag('google',L[3].rows));
    D0.raw.crmSet=L[4]==null?null:{cur:L[4],prev:L[5]||[]};
    D0.video=!!L[0].video;
    D0.adsLoading=false; caStatusApply(); caPaint(); });
}
// every project with an account on either platform, the biggest spender first
function caProjects(){
  const all={}; Object.keys(CA_D.acc).forEach(function(k){ all[CA_D.acc[k].project]=1; });
  const sp={}; CA_D.cur.forEach(function(c){ sp[c.project]=(sp[c.project]||0)+(+c.spend||0); });
  return Object.keys(all).sort(function(a,b){ return (sp[b]||0)-(sp[a]||0)||a.localeCompare(b); });
}
/* ONE THIN TABLE, OPENED LIKE A TREE (6 Nov 2026, Ayush: no thick panel - a project opens into a thin
   Google row and a thin Facebook row, a platform into its campaign rows, a campaign into its ad set rows).
   Every row has the same columns; only the indent and the caret say how deep it is. The ads of whatever
   is open sit under the table and narrow as you go down. */
function caPaint(){
  caKeepWhere();
  if(CA_TAB==='checklist'){ ckPaint(); return; }   // the Checklist tab is the alerts layout (ckPaint), not the projects table
  const r=obRange(), P=caProjects(), E=CA_D.ent; window._caP=P;
  if(CA.proj!=='all'&&P.indexOf(CA.proj)===-1) CA.proj='all';
  const C=CA.cmp, same=caCmpSame(), cmpOn=C.on&&!same&&!!CA_D.cmp, cr=C.on?caCmpRange():null;
  // a select whose one option (the other side's choice) cannot be picked - "Custom" stays open on both, its dates are checked
  const sel=function(id,list,cur,onch,off){ return '<select class="comp-sel" id="'+id+'" onchange="'+onch+'">'+list.map(function(o){
    const dis=off&&off!=='custom'&&o[0]===off; return '<option value="'+o[0]+'"'+(String(cur)===String(o[0])?' selected':'')+(dis?' disabled':'')+'>'+esc(o[1])+(dis?' (chosen on the other side)':'')+'</option>'; }).join('')+'</select>'; };
  $('caHead').innerHTML='<div class="ob-bar">'
    +caPerPicker(C.on?C.period:null)
    +(OB_P.period==='custom'?'<input type="date" value="'+esc(r.s)+'" onchange="OB_P.from=this.value;caLoad()"><span style="color:var(--slate)">–</span><input type="date" value="'+esc(r.e)+'" onchange="OB_P.to=this.value;caLoad()">':'')
    +'<span class="ca-stg">'+[['active','Active'],['inactive','Inactive'],['both','Both']].map(function(o){ return '<label class="ca-st'+(CA_ST===o[0]?' on':'')+'"><input type="radio" name="caSt"'+(CA_ST===o[0]?' checked':'')+' onchange="caSt(\''+o[0]+'\')">'+o[1]+'</label>'; }).join('')+'</span>'
    // 17 Nov 2026 (Ayush): the projects dropdown and the dates line under the bar removed to save space - the dates show on
    // hover over the period, and in Compare mode beside "with"
    +'<label class="ca-sw'+(C.on?' on':'')+'" title="Compare with another period"><input type="checkbox"'+(C.on?' checked':'')+' onchange="caCmpToggle(this.checked)"><span class="k"></span>Compare</label>'
    +(C.on?'<span style="color:var(--slate);font-size:12.5px" title="'+esc(fmtDate(r.s))+' – '+esc(fmtDate(r.e))+' vs '+esc(fmtDate(cr.s))+' – '+esc(fmtDate(cr.e))+'">with</span>'+sel('caCmpPer',CA_CMP_OPTS,C.period,"caCmpPick(this.value)",OB_P.period)
      +(C.period==='custom'?'<input type="date" value="'+esc(cr.s)+'" onchange="CA.cmp.from=this.value;caLoad()"><span style="color:var(--slate)">–</span><input type="date" value="'+esc(cr.e)+'" onchange="CA.cmp.to=this.value;caLoad()">':''):'')
    +caShareBar()+'</div>'
    +(C.on&&same?'<div class="ca-warn"><i class="fa-solid fa-triangle-exclamation"></i> Both sides are the same dates ('+esc(fmtDate(r.s))+' – '+esc(fmtDate(r.e))+'). Pick a different period to compare with.</div>':'');
  CA.proj='all';
  const ps=$('caPer'); if(ps) ps.title=fmtDate(r.s)+' – '+fmtDate(r.e);
  const caret=function(on){ return '<span class="ca-caret"><i class="fa-solid fa-chevron-'+(on?'down':'right')+'"></i></span>'; };
  /* Every figure cell. In Compare mode the other period's figure and the change sit under it - green when the move is good,
     red when bad (more leads, clicks, CTR good; a higher cost per lead bad; spend neither). */
  const cell=function(now,was,fmt,goodUp,bold){
    const top=bold?'<b>'+fmt(now)+'</b>':fmt(now);
    if(!cmpOn) return '<td>'+top+'</td>';
    let chg='';
    if(now!=null&&was!=null&&isFinite(now)&&isFinite(was)&&was!==0){ const p=(now-was)/Math.abs(was)*100;
      chg=Math.abs(p)<0.5?'<span class="flat">=</span>':'<span class="'+(goodUp==null?'flat':((p>0)===goodUp?'good':'bad'))+'">'+(p>0?'▲':'▼')+Math.abs(p).toFixed(0)+'%</span>'; }
    else if(was===0&&now>0) chg='<span class="'+(goodUp==null?'flat':goodUp?'good':'bad')+'">new</span>';
    return '<td>'+top+'<div class="ca-cmp">'+fmt(was)+' '+chg+'</div></td>'; };
  /* THE COLUMNS, IN THE ORDER ASKED (10 Nov 2026): Spend | Leads | CRM leads, QL, SV, Booked, Lost | Cost per lead | CPQL |
     Clicks | CTR | QL%, QL to SV %. t = this period, w = the other (Compare), x = the CRM's figures for the row:
     undefined = no CRM columns at all (Facebook section), {why} = dashes with the reason, {t,w} = the figures. */
  const cols=function(t,w,x){ w=w||{};
    return cell(t.spend,w.spend,obMoney,null,true)
      +(cmpOn?cell(t.ln,w.ln,function(v){ return caLeads(v,t.pl); },true).replace('</td>',(t.tag||'')+'</td>'):'<td>'+t.lead+'</td>')
      +crmPart(x,'a')+cell(t.cpl,w.cpl,obMoney,false)+crmPart(x,'b')+(fbX?xCells(t,w,fbX):cell(t.clicks,w.clicks,obNum,true)+cell(t.ctr,w.ctr,obPct,true)+(gxL&&gxL.length?gCells(t,w,gxL):''))+crmPart(x,'c'); };
  const sum=function(rows,pl){ const a=caAgg(rows); return {spend:a.spend,ln:a.leads,pl:pl,lead:caLeads(a.leads,pl),cpl:a.cpl,clicks:a.clicks,ctr:a.ctr,imp:a.impr,fl:a.hasForm?a.form:null,gc:(rows||[]).map(function(x){ return x.campaign_id; }).filter(Boolean)}; };
  const raw=function(x,pl,lead){ x=x||{}; const s=+x.spend||0, rr=x.results==null&&x.spend!=null?null:+x.results||0, tag=lead===false?' <span class="tag t-gray" style="font-size:10px">not leads</span>':'';
    return {spend:s,ln:rr,pl:pl==='google'?'google':'meta',tag:tag,lead:(rr==null?'<span style="color:#94a3b8" title="Google leads per ad group are read from 13 Nov 2026 night">—</span>':obNum(rr,0))+tag,cpl:rr?s/rr:null,imp:+x.impressions||0,clicks:+x.clicks||0,ctr:+x.impressions?x.clicks/x.impressions*100:null,fl:x.form_leads!=null?+x.form_leads:null,gc:x.campaign_id&&!x.adset_id&&!x.ad_id?[x.campaign_id]:(x.gc||null)}; };
  const prev=CA_D.prev||[];
  /* CRM COLUMNS (10 Nov 2026, Ayush): beside the platforms' own leads, the CRM's count of the Google leads left after
     its filtering, so the two can be compared - and how far they got: QL% (qualified of CRM leads), CPQL (Google spend
     per qualified lead), SV (site visits), QL to SV %, Booked, Lost. Google only: the CRM has no Facebook figure yet. */
  const CR=CA_D.crm, NCRM=9;   // 17 Nov 2026: + CRM CPL (spend per CRM lead), beside the platform's own CPL
  const crmAgg=function(list,pred){ const t={leads:0,ql:0,sv:0,bk:0,lost:0}; (list||[]).forEach(function(x){ if(!pred(x)) return;
    t.leads+=+x.leads||0; t.ql+=+x.qualified||0; t.sv+=+x.site_visited||0; t.bk+=+x.booked||0; t.lost+=+x.lost||0; }); return t; };
  const crmT=function(a,spend){ return {leads:a.leads,cplc:a.leads&&spend>0?spend/a.leads:null,ql:a.ql,qlp:a.leads?a.ql/a.leads*100:null,cpql:a.ql&&spend>0?spend/a.ql:null,sv:a.sv,svp:a.ql?a.sv/a.ql*100:null,bk:a.bk,lost:a.lost}; };
  // the spend the CRM's leads are set against: Google's, Facebook's, or both (src empty)
  const gSpend=function(list,pred,src){ const plat=src==='facebook'?'meta':src; return (list||[]).reduce(function(t,c){ return (!plat||c.platform===plat)&&pred(c)?t+(+c.spend||0):t; },0); };
  const pc0=function(x){ return x==null||!isFinite(x)?'—':x.toFixed(0)+'%'; };
  // the Ads tab has no QL to SV % (18 Nov 2026, Ayush: "the last column QL to SV % is not required"); set while it is drawn
  let noSvp=false;
  /* THE COLUMNS DROPDOWN (18 Nov 2026, Ayush: "Frequency, Reach, Impressions, CPM, CPC, CTR, Clicks - hidden by default, a dropdown
     where more than one column can be shown or hidden, for both tabs, Facebook only; in Ads CTR, Impressions, Reach won't be
     there"). fbX = the extra columns picked for the Facebook section being drawn (null = the usual Clicks and CTR). */
  let fbX=null;
  /* GOOGLE'S EXTRA COLUMNS (19 Nov 2026, Ayush): gxL = the extras picked for the Google section being drawn, added after Clicks and CTR.
     Impression share is Google's own figure per campaign and day (camp.ads_daily, read the first time a share column is picked): the
     period's share = impressions / the impressions the campaign was eligible for (impressions / share, every day added up); the lost
     shares are weighted the same way. Ad groups and ads have none. */
  let gxL=null;
  window._caGis=window._caGis||{};
  const gisKey=function(s,e){ return s+'|'+e; };
  const gisRows=function(s,e){ const b=window._caGis[gisKey(s,e)]; return b&&b.st==='ok'?b.d:null; };
  const gisVal=function(ids,s,e,k){ const rows=gisRows(s,e); if(!ids||!rows) return undefined;
    const m={}; ids.forEach(function(i){ m[i]=1; }); let el=0, im=0, lb=0, lr=0, n=0;
    rows.forEach(function(x){ if(!m[x.campaign_id]) return; const sh=+x.imp_share, imp=+x.impressions; if(!(sh>0)||!(imp>=0)) return; const ee=imp/sh; el+=ee; im+=imp; lb+=ee*(+x.budget_lost_is||0); lr+=ee*(+x.rank_lost_is||0); n++; });
    if(!n||!(el>0)) return null; return k==='is'?im/el*100:k==='blis'?lb/el*100:lr/el*100; };
  const gisNeed=function(s,e){ const key=gisKey(s,e); if(window._caGis[key]) return; window._caGis[key]={st:'load'}; caGisLoad(key,s,e); };
  const xHead=function(list){ return list.map(function(k){ return '<th'+(k==='is'?' title="Google\'s Search impression share: the share of the searches you could have shown on that you did"':k==='blis'?' title="Search impressions lost because the budget ran out"':k==='rlis'?' title="Search impressions lost because the ad rank was too low"':'')+'>'+CA_XC_NAMES[k]+'</th>'; }).join(''); };
  const gCells=function(t,w,list){ w=w||{}; const cr0=r, c0=cr; return list.map(function(k){ const imp=t.imp, sp=t.spend;
    if(k==='imp') return cell(imp,w.imp,obNum,true);
    if(k==='cpm') return cell(imp&&sp!=null?sp/imp*1000:null,w.imp&&w.spend!=null?w.spend/w.imp*1000:null,obMoney,false);
    if(k==='cpc') return cell(t.clicks&&sp!=null?sp/t.clicks:null,w.clicks&&w.spend!=null?w.spend/w.clicks:null,obMoney,false);
    const v=gisVal(t.gc,cr0.s,cr0.e,k), vw=cmpOn&&c0?gisVal(w.gc,c0.s,c0.e,k):null;
    if(v===undefined) return '<td title="'+(t.gc?'Reading the impression share':'Impression share is Google\'s figure per campaign - ad groups and ads have none')+'"><span style="color:#94a3b8">'+(t.gc?'…':'—')+'</span></td>';
    if(v===null) return '<td title="Google gave no impression share for these dates (Display, Video and very small campaigns have none)"><span style="color:#94a3b8">—</span></td>';
    return cell(v,vw,obPct,k==='is'?true:false); }).join(''); };
  const rCell=function(R,fmt){ if(!R) return '<td><span style="color:#94a3b8">—</span></td>'; if(R.st==='load') return '<td title="Asking Meta for the reach of these dates"><i class="fa-solid fa-spinner fa-spin" style="color:#94a3b8;font-size:11px"></i></td>';
    if(R.st==='err'||R.v==null) return '<td title="'+esc(R.why||'No reach from Meta for these dates')+'"><span style="color:#94a3b8">—</span></td>'; return '<td>'+fmt(R.v)+'</td>'; };
  const xCells=function(t,w,list){ w=w||{}; return list.map(function(k){ const imp=t.imp, sp=t.spend;
    if(k==='freq') return rCell(t.rk,function(v){ return v&&imp?(imp/v).toFixed(2):'—'; });
    if(k==='reach') return rCell(t.rk,function(v){ return obNum(v); });
    if(k==='imp') return cell(imp,w.imp,obNum,true);
    if(k==='cpm') return cell(imp&&sp!=null?sp/imp*1000:null,w.imp&&w.spend!=null?w.spend/w.imp*1000:null,obMoney,false);
    if(k==='cpc') return cell(t.clicks&&sp!=null?sp/t.clicks:null,w.clicks&&w.spend!=null?w.spend/w.clicks:null,obMoney,false);
    if(k==='ctr') return cell(t.ctr,w.ctr,obPct,true);
    return cell(t.clicks,w.clicks,obNum,true); }).join(''); };
  const crmPart=function(x,which){
    if(!x) return '';
    const n={a:5,b:2,c:noSvp?1:2}[which];
    if(!CR||x.why){ const why=!CR?'CRM figures are read at night - they show from the next morning':x.why; let h='';
      for(let i=0;i<n;i++) h+='<td class="ca-crm" title="'+esc(why)+'"><span style="color:#94a3b8">—</span></td>'; return h; }
    const t=x.t, w=x.w||{};
    const h=which==='a'?cell(t.leads,w.leads,obNum,true,true)+cell(t.ql,w.ql,obNum,true)+cell(t.sv,w.sv,obNum,true)+cell(t.bk,w.bk,obNum,true)+cell(t.lost,w.lost,obNum,false)
      :which==='b'?cell(t.cplc,w.cplc,obMoney,false)+cell(t.cpql,w.cpql,obMoney,false):cell(t.qlp,w.qlp,pc0,true)+(noSvp?'':cell(t.svp,w.svp,pc0,true));
    return h.replace(/<td>/g,'<td class="ca-crm">'); };
  // sp: which ad rows' spend goes against these leads, when it is not the same test (a WhatsApp campaign)
  const crmX=function(pred,src,sp){ if(!CR) return {}; if(src==='facebook'&&!CR.cur.some(function(x){ return x.src==='facebook'; })) return {why:'No Facebook figures from the CRM yet for these dates - they are read at night and show from the next morning'}; const p2=function(x){ return (!src||x.src===src)&&pred(x); }, ps=sp||pred;
    return {t:crmT(crmAgg(CR.cur,p2),gSpend(CA_D.cur,ps,src)),w:crmT(crmAgg(CR.prev,p2),gSpend(prev,ps,src))}; };
  // a Facebook campaign whose ad sets go for WhatsApp chats: the CRM only counts those all together, on the Facebook row
  const isWa=function(cid){ return Object.keys(E).some(function(k){ const x=E[k]; return k.indexOf('adset:')===0&&x&&x.campaign_id===cid&&/CONVERSATIONS|MESSAGING/.test(String(x.objective||'')); }); };
  const crmNo=function(why){ return {why:why}; };
  // an ad set / ad group's own CRM figures (16 Nov 2026: the CRM API now gives them); leads without ad set tracking stay on the campaign row only
  const CS=CA_D.crmSet;
  const crmSetX=function(sid,sp,spw){ if(!CS) return crmNo('CRM figures by ad set are read at night - they show from the next morning'); const p=function(x){ return x.level==='adset'&&x.adset_id===String(sid); };
    if(!CS.cur.some(p)) return crmNo('The CRM has no leads tied to this ad set for these dates'); return {t:crmT(crmAgg(CS.cur,p),+sp||0),w:crmT(crmAgg(CS.prev,p),+spw||0)}; };
  // an ad's own CRM figures (camp.crm_adset_daily level 'ad': Facebook ad / Google creative)
  const crmAdX=function(aid,sp,spw){ if(!CS) return crmNo('CRM figures by ad are read at night - they show from the next morning'); const p=function(x){ return x.level==='ad'&&x.ad_id===String(aid); };
    if(!CS.cur.some(p)) return crmNo('The CRM has no leads tied to this ad for these dates'); return {t:crmT(crmAgg(CS.cur,p),+sp||0),w:crmT(crmAgg(CS.prev,p),+spw||0)}; };
  const ct=function(t,title){ return '<th class="ca-crm" title="'+esc(title)+'">'+t+'</th>'; };
  const head=function(name,res,cpl,crm){ return '<tr><th class="ca-nm">'+name+'</th><th title="Daily budget as set today">Daily budget</th><th>Spend</th><th>'+res+'</th>'
    +(crm?ct('CRM leads','Google and Facebook leads in the CRM after its filtering')+ct('QL','Qualified leads (CRM)')+ct('SV','Site visits (CRM)')+ct('Booked','Booked (CRM)')+ct('Lost','Lost (CRM)'):'')
    +'<th>'+cpl+'</th>'+(crm?ct('CRM CPL','Spend per CRM lead - the cost per lead counted on the CRM\x27s leads, not the platform\x27s')+ct('CPQL','Spend per qualified lead (CRM)'):'')+(fbX?xHead(fbX):'<th>Clicks</th><th>CTR</th>'+(gxL&&gxL.length?xHead(gxL):''))
    +(crm?ct('QL%','Qualified leads as a share of CRM leads')+(noSvp?'':ct('QL to SV %','Site visits as a share of qualified leads')):'')+'</tr>'; };
  // a name never wraps: it stops at the column's width with "...", the whole name on hover
  const nm=function(lead,text){ return '<td class="ca-nm"><span class="ca-nmx" title="'+esc(text)+'">'+lead+esc(text)+'</span></td>'; };
  const money=function(v){ return '<td>'+(v==null?'<span style="color:#94a3b8">—</span>':obMoney(v))+'</td>'; };
  const cBud=function(id){ return caCampBud(id); };
  const idle=function(id){ const b=caCampBud(id,true); return '<td title="Switched on with '+obMoney(b)+' a day, but nothing spent in the last 3 days - not counted"><span style="color:#94a3b8">—</span><div class="ca-sub">not spending</div></td>'; };
  /* A PLATFORM'S SECTION (6 Nov 2026, Ayush): its running campaigns in a section of their own, under the whole
     projects table - the page scrolls to it on the click, as at the foot of the page it otherwise sat unseen; a campaign opens its running ad sets inside it, and the ads
     follow whatever is open. Paused, ended and deleted ones are left out here - their spend still counts above.
     7 Nov 2026: a Total row under the campaigns - all the listed campaigns together. */
  const section=function(){
    const p=CA.open, pl=CA.plat, W=CA_PLAT[pl]; window._caRowAds=[];
    const camps=CA_D.cur.filter(function(c){ return c.project===p&&c.platform===pl&&caAct(c); }).sort(function(a,b){ return b.spend-a.spend; });
    const was=function(id){ return prev.filter(function(x){ return x.platform===pl&&x.campaign_id===id; }); };
    const setsOf=function(list,cid){ const g={}; list.forEach(function(a){ if(a.platform!==pl||a.campaign_id!==cid||!a.adset_id) return; const x=g[a.adset_id]||(g[a.adset_id]={adset_id:a.adset_id,spend:0,results:null,clicks:0,impressions:0}); x.spend+=+a.spend||0; if(a.results!=null) x.results=(x.results||0)+(+a.results); x.clicks+=+a.clicks||0; x.impressions+=+a.impressions||0; }); return g; };
    fbX=pl==='meta'?caXcList('camp'):null;
    gxL=pl==='google'?caXcList('gcamp'):null;
    if(gxL&&gxL.some(function(k){ return k==='is'||k==='blis'||k==='rlis'; })){ gisNeed(r.s,r.e); if(cmpOn&&cr) gisNeed(cr.s,cr.e); }
    const nc=7+NCRM+(fbX?fbX.length-2:0)+(gxL?gxL.length:0);
    // Reach / Frequency picked: asked from Meta for exactly these dates (ad-reach), campaigns, ad sets and ads of the section
    const needR=!!fbX&&(fbX.indexOf('freq')>=0||fbX.indexOf('reach')>=0), SK='sec|'+[r.s,r.e,p,CA_ST].join('|');
    window._caReach=window._caReach||{};
    if(needR&&camps.length&&!CA_D.adsLoading){ const b0=window._caReach[SK]; if(!b0||b0.at<Date.now()-600000){
      const req={from:r.s,to:r.e,accounts:{},groups:{}}, accOf=function(id){ return req.accounts[id]||(req.accounts[id]={ad:[],adset:[],campaign:[]}); }, inC={}, ss={}, aa={};
      Object.keys(CA_D.acc).forEach(function(k){ if(k.indexOf('meta:')===0&&CA_D.acc[k].project===p) accOf(k.slice(5)); });
      camps.forEach(function(c){ inC[c.campaign_id]=1; accOf(c.account_id).campaign.push(c.campaign_id); });
      CA_D.ads.forEach(function(a){ if(a.platform!=='meta'||!inC[a.campaign_id]) return; if(a.adset_id&&!ss[a.adset_id]){ ss[a.adset_id]=1; accOf(a.account_id).adset.push(a.adset_id); } if(!aa[a.ad_id]){ aa[a.ad_id]=1; accOf(a.account_id).ad.push(a.ad_id); } });
      window._caReach[SK]={st:'load',at:Date.now()}; caReachLoad(SK,req); } }
    const rS=function(level,id){ if(!needR) return null; const b=window._caReach[SK]; if(!b||b.st==='load') return {st:'load'}; if(b.st==='err') return {st:'err',why:b.why};
      if(level==='total'){ let t0=null; Object.keys(b.d.account||{}).forEach(function(a){ t0=(t0||0)+(+b.d.account[a]); }); return {st:'ok',v:t0}; }
      const v=(b.d[level]||{})[id]; return {st:'ok',v:v==null?null:+v}; };
    const RX=function(t,level,id){ if(fbX) t.rk=rS(level,id); return t; };
    const waOne=pl==='meta'&&camps.filter(function(c){ return isWa(c.campaign_id); }).length===1;
    let sec='';
    camps.forEach(function(c){
      const e=E['campaign:'+c.campaign_id]||{}, con=CA.camp===c.campaign_id, lead=pl==='meta'?obIsLead(E,c):null;
      const src=pl==='google'?'google':'facebook';
      // one WhatsApp campaign in the project: the CRM's WhatsApp count is all its own (14 Nov 2026)
      const cx=pl==='meta'&&isWa(c.campaign_id)&&waOne?crmX(function(x){ return x.wa&&x.project===p; },'facebook',function(x){ return x.campaign_id===c.campaign_id; }):pl==='meta'&&isWa(c.campaign_id)?crmNo('A WhatsApp campaign: the CRM counts all WhatsApp campaigns of a project together - they are in the Facebook row above'):crmX(function(x){ return x.campaign_id===c.campaign_id; },src);
      sec+='<tr class="ca-row ca-l0'+(con?' ca-on':'')+'" onclick="caCamp(\''+c.campaign_id+'\')">'+nm(caret(con)+caDot(e.status),e.name||c.campaign_id)+(cBud(c.campaign_id)==null&&caCampBud(c.campaign_id,true)!=null&&caLive(e.status)?idle(c.campaign_id):!caLive(e.status)?'<td>'+(cBud(c.campaign_id)==null?'<span style="color:#94a3b8">—</span>':obMoney(cBud(c.campaign_id)))+'<div class="ca-sub">'+esc(String(e.status||'stopped').toLowerCase())+'</div></td>':money(cBud(c.campaign_id)))+cols(RX(raw(c,pl,lead),'campaign',c.campaign_id),raw(was(c.campaign_id)[0],pl,lead),cx)+'</tr>';
      if(!con) return;
      const ads=CA_D.ads.filter(function(a){ return a.platform===pl&&a.campaign_id===c.campaign_id; });
      if(CA_D.adsLoading){ sec+='<tr class="ca-l1 ca-none"><td colspan="'+nc+'"><i class="fa-solid fa-spinner fa-spin"></i> Loading '+W.sets.toLowerCase()+'…</td></tr>'; return; }
      if(!CA_D.hasSets||!ads.some(function(a){ return a.adset_id; })){
        sec+='<tr class="ca-l1 ca-none"><td colspan="'+nc+'"><i class="fa-solid fa-circle-info"></i> '+W.sets+' are recorded from tonight (6 Nov 2026) and show here from tomorrow.</td></tr>'; return; }
      const g=setsOf(ads,c.campaign_id), gw=cmpOn?setsOf(CA_D.cmp.ads,c.campaign_id):{};
      const cOn=caLive(e.status), sets=Object.keys(g).filter(function(k){ const on=caLive((E['adset:'+k]||{}).status); return CA_ST==='both'||(CA_ST==='active'?on:(!cOn||!on)); }).map(function(k){ return g[k]; }).sort(function(a,b){ return b.spend-a.spend; });
      if(!sets.length) sec+='<tr class="ca-l1 ca-none"><td colspan="'+nc+'">No running '+W.set.toLowerCase()+' in this campaign</td></tr>';
      sets.forEach(function(s){
        const son=CA.adset===s.adset_id;
        sec+='<tr class="ca-row ca-l1'+(son?' ca-on':'')+'" onclick="caSet(\''+s.adset_id+'\')">'+nm(caret(son)+caDot((E['adset:'+s.adset_id]||{}).status||e.status),(E['adset:'+s.adset_id]||{}).name||s.adset_id)+(function(){
          // its own budget; or, when the budget is set on the campaign (Facebook CBO, every Google ad group), the campaign's, marked shared
          const b=(E['adset:'+s.adset_id]||{}).daily_budget; if(cBud(c.campaign_id)==null&&CA_D.sp3&&!CA_D.sp3[c.campaign_id]) return money(null); if(b!=null) return money(b);
          return e.daily_budget!=null?'<td title="The budget is set on the campaign and shared by its '+W.sets.toLowerCase()+'"><span style="color:#64748b">'+obMoney(e.daily_budget)+'</span><div class="ca-sub">shared</div></td>':money(null); })()
          +cols(RX(raw(s,pl,null),'adset',s.adset_id),raw(gw[s.adset_id],pl,null),crmSetX(s.adset_id,s.spend,(gw[s.adset_id]||{}).spend))+'</tr>';
        if(!son) return;
        /* AD ROWS (17 Nov 2026, Ayush: "in Facebook and Google I want to see ad-wise data as well, so even ad sets will have a
           dropdown"). An open ad set lists its ads, the same columns, following Active / Inactive / Both; a row opens the ad. */
        const adRows=ads.filter(function(a){ return a.adset_id===s.adset_id&&caAdOk(a)&&((+a.spend||0)>0||(+a.impressions||0)>0||(+a.clicks||0)>0||(+a.results||0)>0); }).sort(function(x,y){ return (+y.spend||0)-(+x.spend||0); });
        if(!adRows.length){ sec+='<tr class="ca-l2 ca-none"><td colspan="'+nc+'">No ad here for this choice</td></tr>'; return; }
        adRows.forEach(function(a){
          const ae=E['ad:'+a.ad_id]||{}, aw=cmpOn?(CA_D.cmp.ads||[]).filter(function(x){ return x.ad_id===a.ad_id&&x.adset_id===a.adset_id; })[0]:null;
          const ri=(window._caRowAds=window._caRowAds||[]).push(a)-1;
          sec+='<tr class="ca-row ca-l2" onclick="event.stopPropagation();caAdOpenRow('+ri+')" title="Open this ad">'+nm(caDot(ae.status),ae.name||('Ad '+a.ad_id))+money(null)
            +cols(RX(raw(a,pl,null),'ad',a.ad_id),raw(aw,pl,null),crmAdX(a.ad_id,a.spend,aw&&aw.spend))+'</tr>';
        });
      });
    });
    // CRM leads of this project and platform that the CRM did not tie to any of our campaigns (see crmTag) - their own row
    { const srcU=pl==='google'?'google':'facebook', ut=((CA_D.crm&&CA_D.crm.cur)||[]).filter(function(x){ return x.untied&&x.project===p&&x.src===srcU; });
      if(ut.length){ const by={}; ut.forEach(function(x){ by[x.utype]=(by[x.utype]||0)+(+x.leads||0); });
        const dash='<span style="color:#94a3b8">—</span>';
        sec+='<tr class="ca-l0" title="Leads the CRM has for '+esc(p)+' from '+W.name+' without one of our ad campaigns on them - counted in the project and '+W.name+' rows, not under any campaign"><td class="ca-nm"><span class="ca-nmx" style="font-style:italic"><i class="fa-solid fa-link-slash" style="color:#94a3b8;margin-right:6px"></i>Not tied to a campaign</span><div class="ca-sub">'
          +esc(Object.keys(by).sort(function(a,b){ return by[b]-by[a]; }).map(function(k){ return k+' '+by[k]; }).join(' · '))+'</div></td>'+money(null)
          +cols({spend:null,ln:null,pl:pl,lead:dash,cpl:null,clicks:null,ctr:null},{},crmX(function(x){ return x.untied&&x.project===p; },srcU,function(){ return false; }))+'</tr>'; } }
    // the total counts leads only (Google conversions, Facebook lead / chat campaigns), as reach or engagement results cannot be added to them
    const ids={}; camps.forEach(function(c){ ids[c.campaign_id]=1; });
    const tot=camps.length?'<tfoot><tr class="ca-tot"><td>Total · '+camps.length+' campaign'+(camps.length===1?'':'s')+(pl==='meta'?' <span style="font-weight:500;color:var(--slate);font-size:11px">(leads only)</span>':'')+'</td>'
      +money(camps.reduce(function(t,c){ const b=cBud(c.campaign_id); return b==null?t:(t||0)+(+b); },null))
      +cols(RX(sum(camps,pl),'total'),sum(prev.filter(function(x){ return x.platform===pl&&ids[x.campaign_id]; }),pl),crmX(function(x){ return x.project===p; },pl==='google'?'google':'facebook'))+'</tr></tfoot>':'';
    // 18 Nov 2026 (Ayush: "Dream World City: the table total shows 56, the row above 62 counting the 6 not tied to a campaign -
    // misleading"): the Total's CRM figures are the project's whole platform figure - the same as its Google / Facebook row
    // above - so they include the "Not tied to a campaign" row and the WhatsApp leads counted for the project as a whole.
    const secOut='<div class="ca-sec"><div style="padding:11px 14px;font-weight:700;font-size:13.5px;border-bottom:1px solid var(--line)"><i class="'+W.icon+'" style="color:'+W.color+'"></i> '+W.name+' · '+esc(p)
      +' <span style="font-weight:500;color:var(--slate);font-size:12px">- '+camps.length+' '+(CA_ST==='active'?'active':CA_ST==='inactive'?'inactive':'')+(CA_ST==='both'?'':' ')+'campaign'+(camps.length===1?'':'s')+'; click one for its '+W.sets.toLowerCase()+'</span></div>'
      +'<div style="overflow-x:auto"><table class="ca-tbl"><thead>'+head('Campaign',pl==='meta'?'Results':W.res,pl==='meta'?'Cost per result':W.per,true)+'</thead><tbody>'
      +(sec||'<tr><td colspan="'+nc+'" style="text-align:center;color:var(--slate);padding:18px">No '+(CA_ST==='both'?'':CA_ST+' ')+'campaign spent in this period</td></tr>')+'</tbody>'+tot+'</table></div></div>';
    fbX=null; gxL=null;
    return secOut+caAds(p,pl);
  };
  const shown=CA.proj==='all'?P:[CA.proj];
  const B=CA_D.bud||{};
  const budV=function(p,pl){ return pl?B[p+'|'+pl]:(B[p+'|google']==null&&B[p+'|meta']==null?null:(B[p+'|google']||0)+(B[p+'|meta']||0)); };
  /* THE ADS TAB (17 Nov 2026, Ayush: "the same thing as Overview ... I want ascending hierarchy in Ads", "project wise like in
     Campaigns - Projects, Google or Facebook, then in the table below Ads, Ad Sets, Campaigns", then "more than one ad is
     repeated - the one ad will show the campaigns it's in and, going further, the ad sets it's in"). The projects table is
     the same as on Campaigns; Google / Facebook opens the section below. There every ad is ONE row - copies of it (an ad
     copied into another campaign or ad set gets a new id but keeps its name) are counted together - and its arrow opens
     the campaigns it runs in, each campaign the ad sets / ad groups it runs in there. Every row shows that row's own
     figures, with the same columns, budgets, CRM and Active / Inactive / Both. The picture opens the ad. */
  const adsTree=function(p,pl){ gxL=pl==='google'?caXcList('gads'):null; try{ return adsTree0(p,pl); } finally{ gxL=null; } };
  const adsTree0=function(p,pl){
    const W=CA_PLAT[pl], FB=pl==='meta';
    noSvp=true;
    const top='<div class="ca-sec"><div style="padding:11px 14px;font-weight:700;font-size:13.5px;border-bottom:1px solid var(--line)"><i class="'+W.icon+'" style="color:'+W.color+'"></i> '+W.name+' · '+esc(p);
    if(CA_D.adsLoading) return top+'</div><div style="padding:16px;color:var(--slate)"><i class="fa-solid fa-spinner fa-spin"></i> Loading ads…</div></div>';
    const AX=CA.ax=CA.ax||{ad:null,camp:null}, ashow=CA.adShow||50;
    const keyOf=function(a){ return a.platform+':'+String((E['ad:'+a.ad_id]||{}).name||a.ad_id).trim().toLowerCase().replace(/\s+/g,' '); };
    const live=CA_D.ads.filter(function(a){ return a.project===p&&a.platform===pl&&caAdOk(a)&&((+a.spend||0)>0||(+a.impressions||0)>0||(+a.clicks||0)>0||(+a.results||0)>0); });
    // video plays of the rows added up (ads_ad_totals_v5, from 18 Nov 2026 night); hasV = any row had them read
    const VF=['v_plays','v_3s','v_p25','v_p50','v_p75','v_p100'];
    const vAdd=function(m,a){ VF.forEach(function(f){ if(m[f]==null) m[f]=0; if(a[f]!=null){ m[f]+=+a[f]||0; m.hasV=true; } }); };
    const grp=function(list){ const by={}, out=[]; list.forEach(function(a){ const k=keyOf(a); let m=by[k];
      if(!m){ m=by[k]={k:k,platform:a.platform,ad_id:a.ad_id,project:a.project,campaign_id:a.campaign_id,adset_id:null,spend:0,results:null,clicks:0,impressions:0,rows:[],ids:{},top:0}; out.push(m); }
      m.spend+=+a.spend||0; m.clicks+=+a.clicks||0; m.impressions+=+a.impressions||0; if(a.results!=null) m.results=(m.results==null?0:m.results)+(+a.results); vAdd(m,a);
      m.rows.push(a); m.ids[String(a.ad_id)]=1; if((+a.spend||0)>m.top){ m.top=+a.spend||0; m.ad_id=a.ad_id; m.campaign_id=a.campaign_id; } }); return {by:by,out:out}; };
    const G=grp(live), ads=G.out.sort(function(x,y){ return y.spend-x.spend; }), W2=cmpOn?grp((CA_D.cmp&&CA_D.cmp.ads)||[]).by:{};
    // the CRM's figures of every copy of the ad together
    const crmIds=function(ids,sp,spw){ if(!CS) return crmNo('CRM figures by ad are read at night - they show from the next morning'); const pp=function(x){ return x.level==='ad'&&ids[x.ad_id]; };
      if(!CS.cur.some(pp)) return crmNo('The CRM has no leads tied to this ad for these dates'); return {t:crmT(crmAgg(CS.cur,pp),+sp||0),w:crmT(crmAgg(CS.prev,pp),+spw||0)}; };
    // every ad row of this platform that passes pred, added up (an ad set's, or for Facebook a campaign's video plays and dates)
    const agg=function(list,pred){ const x={spend:0,results:null,clicks:0,impressions:0,ids:{}}; list.forEach(function(a){ if(a.platform!==pl||!pred(a)) return; x.spend+=+a.spend||0; x.clicks+=+a.clicks||0; x.impressions+=+a.impressions||0; if(a.results!=null) x.results=(x.results||0)+(+a.results); vAdd(x,a); x.ids[String(a.ad_id)]=1; }); return x; };
    const setAgg=function(list,sid){ return agg(list,function(a){ return a.adset_id===sid; }); };
    /* THE FACEBOOK COLUMNS (18 Nov 2026, Ayush: "the Facebook metrics in the Ads tab for each project - Facebook only, not for
       Google"): Spend | Leads Generated | CPL | Qualified | QL% | CPQL | Site Visited | Lost | ThumbStop % | CTL % | CTR % |
       Cost Per 1K Reach | Impressions | Reach | 25 / 50 / 75 / 100% Play | the same as %.
       QL% = qualified (CRM) of the leads generated; ThumbStop % = 3-second plays of impressions; CTL % = leads of clicks;
       play % = people who watched that far of the people reached (Ayush's sheet: 25% Play ÷ Reach, every row). Reach is people,
       so it is asked from Meta for exactly these dates (edge function ad-reach) - it cannot be added up from days.
       18 Nov 2026 (Ayush): Started and Last Run removed. */
    window._caReach=window._caReach||{};
    const RK=FB?[r.s,r.e,p,CA_ST,ashow].join('|'):'', RCH=FB?window._caReach[RK]:null;
    const reachOf=function(level,id){ if(!FB) return null; const b=window._caReach[RK]; if(!b||b.st==='load') return {st:'load'}; if(b.st==='err') return {st:'err',why:b.why};
      const v=level==='total'?id.reduce(function(t,a){ return b.d.account[a]==null?t:(t==null?0:t)+(+b.d.account[a]); },null):(b.d[level]||{})[id];
      return {st:'ok',v:v==null?null:+v}; };
    const dash0=function(why,cls){ return '<td'+(cls?' class="'+cls+'"':'')+(why?' title="'+esc(why)+'"':'')+'><span style="color:#94a3b8">—</span></td>'; };
    const reachCell=function(R,fmt){ if(!R) return dash0(''); if(R.st==='load') return '<td title="Asking Meta for the reach of these dates"><i class="fa-solid fa-spinner fa-spin" style="color:#94a3b8;font-size:11px"></i></td>';
      if(R.st==='err') return dash0('Meta did not give the reach: '+(R.why||'')); return R.v==null?dash0('No reach from Meta for these dates'):'<td>'+fmt(R.v)+'</td>'; };
    const fh=function(t,title){ return '<th'+(title?' title="'+esc(title)+'"':'')+'>'+t+'</th>'; };
    const fbHead=function(name){ return '<tr><th class="ca-nm">'+name+'</th>'+fh('Spend')+fh('Leads Generated','Leads of lead / chat campaigns - Ads Manager\x27s Results')+fh('CPL','Spend per lead generated')
      +ct('Qualified','Qualified leads (CRM)')+ct('QL%','Qualified leads (CRM) as a share of the leads generated')+ct('CPQL','Spend per qualified lead (CRM)')+ct('Site Visited','Site visits (CRM)')+ct('Lost','Lost (CRM)')
      +fh('ThumbStop %','3-second video plays as a share of impressions')+fh('CTL %','Leads generated as a share of clicks')+fh('CTR %','Clicks as a share of impressions')
      +fh('Cost Per 1K Reach','Spend per 1,000 people reached')+fh('Impressions')+fh('Reach','People reached in these dates, from Meta')
      +fh('25% Play','Video plays watched to 25%')+fh('50% Play','Video plays watched to 50%')+fh('75% Play','Video plays watched to 75%')+fh('100% Play','Video plays watched to the end')
      +fh('25% Play %','People who watched to 25% as a share of the people reached')+fh('50% Play %','People who watched to 50% as a share of the people reached')+fh('75% Play %','People who watched to 75% as a share of the people reached')+fh('100% Play %','People who watched to the end as a share of the people reached')+xHead(fbXa)+'</tr>'; };
    const fbXa=FB?caXcList('ads'):[], NFB=23+fbXa.length;
    const fbCols=function(t,w,x,v){ w=w||{}; v=v||{};
      const hasC=!!(CR&&x&&x.t), c=hasC?x.t:{}, cw=hasC?(x.w||{}):{}, why=!CR?'CRM figures are read at night - they show from the next morning':((x&&x.why)||'');
      const crm=function(val,was,fmt,up){ return hasC?cell(val,was,fmt,up).replace('<td>','<td class="ca-crm">'):dash0(why,'ca-crm'); };
      const pct=function(a,b){ return a!=null&&b?a/b*100:null; };
      const ln=t.ln, vwhy='Video plays are read from 18 Nov 2026 night - they show from then', vid=!!v.hasV;
      const vc=function(n){ return vid?cell(n,null,obNum,true):dash0(vwhy); }, vp=function(n){ return !vid?dash0(vwhy):reachCell(v.reach,function(rv){ return obPct(pct(n,rv)); }); };
      return cell(t.spend,w.spend,obMoney,null,true)
        +(cmpOn?cell(t.ln,w.ln,function(n){ return caLeads(n,t.pl); },true).replace('</td>',(t.tag||'')+'</td>'):'<td>'+t.lead+'</td>')
        +cell(t.cpl,w.cpl,obMoney,false)
        +crm(c.ql,cw.ql,obNum,true)+crm(pct(c.ql,ln),pct(cw.ql,w.ln),pc0,true)+crm(c.cpql,cw.cpql,obMoney,false)+crm(c.sv,cw.sv,obNum,true)+crm(c.lost,cw.lost,obNum,false)
        +(vid?cell(pct(v.v_3s,v.imp),null,obPct,true):dash0(vwhy))
        +cell(pct(ln,t.clicks),pct(w.ln,w.clicks),obPct,true)
        +cell(t.ctr,w.ctr,obPct,true)
        +reachCell(v.reach,function(rv){ return rv&&t.spend!=null?obMoney(t.spend/rv*1000):'—'; })
        +(v.imp==null?dash0(''):cell(v.imp,null,obNum,true))
        +reachCell(v.reach,function(rv){ return obNum(rv); })
        +vc(v.v_p25)+vc(v.v_p50)+vc(v.v_p75)+vc(v.v_p100)+vp(v.v_p25)+vp(v.v_p50)+vp(v.v_p75)+vp(v.v_p100)
        +fbXa.map(function(k){ if(k==='freq') return reachCell(v.reach,function(rv){ return rv&&v.imp?(v.imp/rv).toFixed(2):'—'; });
          if(k==='cpm') return cell(v.imp&&t.spend!=null?t.spend/v.imp*1000:null,null,obMoney,false);
          if(k==='cpc') return cell(t.clicks&&t.spend!=null?t.spend/t.clicks:null,w.clicks&&w.spend!=null?w.spend/w.clicks:null,obMoney,false);
          return cell(t.clicks,w.clicks,obNum,true); }).join(''); };
    const vOf=function(m,R){ return {hasV:m.hasV,v_plays:m.v_plays,v_3s:m.v_3s,v_p25:m.v_p25,v_p50:m.v_p50,v_p75:m.v_p75,v_p100:m.v_p100,imp:m.impressions,reach:R}; };
    // one set of columns or the other: Facebook its own, Google as on Campaigns (less QL to SV %)
    const rowCols=function(t,w,x,m,R){ return FB?fbCols(t,w,x,vOf(m,R)):cols(t,w,x); };
    /* LEADS GENERATED = LEADS ONLY (18 Nov 2026, found checking the page): an ad of an awareness / engagement campaign showed its
       reach or views (2,459, 48,118) as leads. A Facebook row counts results only of rows whose campaign is a lead / chat
       campaign - as the Total does; with none, "—" (not a lead campaign). Its CPL and CTL % follow. */
    const isLeadC=function(cid){ return obIsLead(E,{campaign_id:cid,platform:'meta'}); };
    const fbT=function(x,pl0,rowsOf){ if(!FB||!x) return raw(x,pl0,null); const rs=rowsOf||[];
      const lr=rs.filter(function(r0){ return isLeadC(r0.campaign_id); });
      if(!lr.length) return Object.assign(raw(Object.assign({},x,{results:0}),pl0,null),{ln:null,cpl:null,lead:'<span style="color:#94a3b8" title="Not a lead campaign - its results are reach, views or engagement, not leads">—</span>'});
      const n=lr.reduce(function(t0,r0){ return r0.results==null?t0:t0+(+r0.results||0); },0);
      return raw(Object.assign({},x,{results:n}),pl0,null); };
    const nc=FB?NFB:6+NCRM+(gxL?gxL.length:0);
    window._caAdsTab=[]; window._caAxK=[]; let rows='';
    ads.slice(0,ashow).forEach(function(a){
      const ae=E['ad:'+a.ad_id]||{}, aon=AX.ad===a.k, i=window._caAdsTab.push(a)-1, copies=Object.keys(a.ids).length;
      const anyLive=a.rows.some(function(r){ return caLive((E['ad:'+r.ad_id]||{}).status); });
      const thumb=ae.thumbnail?'<img src="'+esc(ae.thumbnail)+'" referrerpolicy="no-referrer" alt="" onclick="event.stopPropagation();caAdTabOpen('+i+')" title="Open this ad" style="width:26px;height:26px;object-fit:cover;border-radius:5px;vertical-align:middle;margin-right:8px;cursor:zoom-in">'
        :'<i class="fa-regular fa-rectangle-list" onclick="event.stopPropagation();caAdTabOpen('+i+')" title="Open this ad" style="color:#94a3b8;margin-right:8px;cursor:zoom-in"></i>';
      const nCamps=[...new Set(a.rows.map(function(r){ return r.campaign_id; }))].length;
      rows+='<tr class="ca-row ca-l0'+(aon?' ca-on':'')+'" onclick="caAx(\'ad\',_caAxK['+(window._caAxK.push(a.k)-1)+'])" title="'+(nCamps>1?'In '+nCamps+' campaigns':'')+(copies>1?(nCamps>1?' · ':'')+copies+' copies counted together':'')+'">'
        +nm(caret(aon)+caDot(anyLive?'ACTIVE':ae.status)+thumb,(ae.name||('Ad '+a.ad_id))+(nCamps>1?'  ·  '+nCamps+' campaigns':''))+(FB?'':money(null))
        +rowCols(fbT(a,pl,a.rows),W2[a.k]?fbT(W2[a.k],pl,W2[a.k].rows):raw(null,pl,null),crmIds(a.ids,a.spend,(W2[a.k]||{}).spend),a,copies>1?reachOf('group',a.k):reachOf('ad',Object.keys(a.ids)[0]))+'</tr>';
      if(!aon) return;
      // up one: every campaign the ad runs in - the campaign's own figures
      const cids=[...new Set(a.rows.map(function(r){ return r.campaign_id; }))].sort(function(x,y){ const cx=CA_D.cur.filter(function(c){ return c.campaign_id===x; })[0]||{}, cy=CA_D.cur.filter(function(c){ return c.campaign_id===y; })[0]||{}; return (+cy.spend||0)-(+cx.spend||0); });
      cids.forEach(function(cid){
        const c=CA_D.cur.filter(function(x){ return x.platform===pl&&x.campaign_id===cid; })[0]||{campaign_id:cid,platform:pl,project:p,spend:0,clicks:0,impressions:0,results:0};
        const ce=E['campaign:'+cid]||{}, ck=a.k+'|'+cid, con=AX.camp===ck, lead=pl==='meta'?obIsLead(E,c):null, was=prev.filter(function(x){ return x.platform===pl&&x.campaign_id===cid; })[0];
        rows+='<tr class="ca-row ca-l1'+(con?' ca-on':'')+'" onclick="caAx(\'camp\',_caAxK['+(window._caAxK.push(ck)-1)+'])">'+nm(caret(con)+caDot(ce.status),ce.name||cid)
          +(FB?'':(cBud(cid)==null&&caCampBud(cid,true)!=null&&caLive(ce.status)?idle(cid):!caLive(ce.status)?'<td>'+(cBud(cid)==null?'<span style="color:#94a3b8">—</span>':obMoney(cBud(cid)))+'<div class="ca-sub">'+esc(String(ce.status||'stopped').toLowerCase())+'</div></td>':money(cBud(cid))))
          +rowCols(FB?fbT(c,pl,[c]):raw(c,pl,lead),FB&&was?fbT(was,pl,[was]):raw(was,pl,lead),crmX(function(x){ return x.campaign_id===cid; },pl==='google'?'google':'facebook'),FB?Object.assign(agg(CA_D.ads,function(r){ return r.campaign_id===cid; }),{impressions:+c.impressions||0}):null,reachOf('campaign',cid))+'</tr>';
        if(!con) return;
        // up again: the ad sets / ad groups of that campaign the ad runs in - the ad set's own figures
        const sids=[...new Set(a.rows.filter(function(r){ return r.campaign_id===cid&&r.adset_id; }).map(function(r){ return r.adset_id; }))];
        if(!sids.length){ rows+='<tr class="ca-l2 ca-none"><td colspan="'+nc+'">No '+W.set.toLowerCase()+' recorded for this ad here</td></tr>'; return; }
        sids.forEach(function(sid){
          const se=E['adset:'+sid]||{}, sa=setAgg(CA_D.ads,sid), sw=cmpOn?setAgg((CA_D.cmp&&CA_D.cmp.ads)||[],sid):null;
          const sb=se.daily_budget!=null?money(se.daily_budget):ce.daily_budget!=null?'<td title="The budget is set on the campaign and shared by its '+W.sets.toLowerCase()+'"><span style="color:#64748b">'+obMoney(ce.daily_budget)+'</span><div class="ca-sub">shared</div></td>':money(null);
          rows+='<tr class="ca-l2"><td class="ca-nm"><span class="ca-nmx" title="'+esc(se.name||sid)+'">'+caDot(se.status||ce.status)+esc(se.name||sid)+'</span></td>'+(FB?'':sb)+rowCols(fbT(sa,pl,[{campaign_id:cid,results:sa.results}]),sw?fbT(sw,pl,[{campaign_id:cid,results:sw.results}]):raw(null,pl,null),crmSetX(sid,sa.spend,sw&&sw.spend),sa,reachOf('adset',sid))+'</tr>';
        });
      });
    });
    /* LEADS ONLY IN THE TOTAL (18 Nov 2026, found checking every total against its row): the Facebook Total added every ad's
       result - reach, views, engagement of non-lead campaigns too - so Dream Ananta's Total read 188,317 against 526 leads in
       the row above. As on the Campaigns tab, a Facebook ad's results count in the Total only when its campaign is a lead /
       chat campaign; Google's are form leads already. */
    const tot=G.out.reduce(function(t,a){ t.spend+=a.spend; t.clicks+=a.clicks; t.impressions+=a.impressions; a.rows.forEach(function(r0){ vAdd(t,r0); }); Object.keys(a.ids).forEach(function(k){ t.ids[k]=1; });
      a.rows.forEach(function(r){ if(r.results==null) return; if(pl==='meta'&&!obIsLead(E,{campaign_id:r.campaign_id,platform:'meta'})) return; t.results=(t.results||0)+(+r.results||0); }); return t; },{spend:0,clicks:0,impressions:0,results:null,ids:{}});
    const allIds=tot.ids;
    /* TOTAL = THE PLATFORM ROW (18 Nov 2026, Ayush: a total that differs from the row above "is misleading - fix it
       everywhere"). The CRM ties only some leads to an ad; the Total shows the project's whole Google / Facebook CRM figure
       (as the projects table does) and the leads it could not tie to an ad have a row of their own, so the rows add up. */
    const srcA=pl==='google'?'google':'facebook', TT=crmX(function(x){ return x.project===p; },srcA), AA=crmIds(allIds,tot.spend,0);
    let untiedAd='';
    if(TT&&TT.t){ const A0=(AA&&AA.t)||{leads:0,ql:0,sv:0,bk:0,lost:0};
      const d={leads:Math.max(0,TT.t.leads-A0.leads),ql:Math.max(0,TT.t.ql-A0.ql),sv:Math.max(0,TT.t.sv-A0.sv),bk:Math.max(0,TT.t.bk-A0.bk),lost:Math.max(0,TT.t.lost-A0.lost)};
      if(d.leads||d.ql||d.sv||d.bk||d.lost){ const dash='<span style="color:#94a3b8">—</span>';
        untiedAd='<tr class="ca-l0" title="Leads the CRM has for '+esc(p)+' from '+W.name+' without an ad tied to them - counted in the Total and the projects table"><td class="ca-nm"><span class="ca-nmx" style="font-style:italic"><i class="fa-solid fa-link-slash" style="color:#94a3b8;margin-right:6px"></i>Not tied to an ad</span></td>'+(FB?'':money(null))
          +(FB?fbCols({spend:null,ln:null,pl:pl,lead:dash,cpl:null,clicks:null,ctr:null},{},{t:crmT(d,0)},{imp:null}):cols({spend:null,ln:null,pl:pl,lead:dash,cpl:null,clicks:null,ctr:null},{},{t:crmT(d,0)}))+'</tr>'; } }
    if(rows) rows+=untiedAd;
    // Facebook: ask Meta once for the reach of everything listed (ads, copies together, ad sets, campaigns, each account), then draw again
    if(FB&&(!RCH||RCH.at<Date.now()-600000)&&ads.length){
      const req={from:r.s,to:r.e,accounts:{},groups:{}};
      const accOf=function(id){ if(!req.accounts[id]) req.accounts[id]={ad:[],adset:[],campaign:[]}; return req.accounts[id]; };
      Object.keys(CA_D.acc).forEach(function(k){ if(k.indexOf('meta:')===0&&CA_D.acc[k].project===p) accOf(k.slice(5)); });
      const seenC={}, seenS={};
      ads.slice(0,ashow).forEach(function(a){ const ids=Object.keys(a.ids);
        if(ids.length===1) accOf(a.rows[0].account_id).ad.push(ids[0]);
        else { const g=req.groups[a.k]={}; a.rows.forEach(function(r0){ const l=g[r0.account_id]=g[r0.account_id]||[]; if(l.indexOf(String(r0.ad_id))<0) l.push(String(r0.ad_id)); }); }
        a.rows.forEach(function(r0){ const ac=accOf(r0.account_id); if(r0.campaign_id&&!seenC[r0.campaign_id]){ seenC[r0.campaign_id]=1; ac.campaign.push(r0.campaign_id); } if(r0.adset_id&&!seenS[r0.adset_id]){ seenS[r0.adset_id]=1; ac.adset.push(r0.adset_id); } }); });
      window._caReach[RK]={st:'load',at:Date.now()};
      caReachLoad(RK,req);
    }
    const accsP=Object.keys(CA_D.acc).filter(function(k){ return k.indexOf('meta:')===0&&CA_D.acc[k].project===p; }).map(function(k){ return k.slice(5); });
    const foot=ads.length?'<tfoot><tr class="ca-tot"><td>Total · '+ads.length+' ad'+(ads.length===1?'':'s')+(pl==='meta'?' <span style="font-weight:500;color:var(--slate);font-size:11px">(leads only)</span>':'')+'</td>'+(FB?'':money(null))
      +(FB?fbCols(raw(tot,pl,null),{},TT&&TT.t?TT:AA,vOf(tot,reachOf('total',accsP))):cols(raw(tot,pl,null),{},TT&&TT.t?TT:AA))+'</tr></tfoot>':'';
    return top+' <span style="font-weight:500;color:var(--slate);font-size:12px">- '+ads.length+' ad'+(ads.length===1?'':'s')+'; click one for the campaigns it runs in, then its '+W.sets.toLowerCase()+'</span></div>'
      +'<div style="overflow-x:auto"><table class="ca-tbl'+(FB?' ca-fb':'')+'"><thead>'+(FB?fbHead('Ad'):head('Ad',W.res,W.per,true))+'</thead><tbody>'
      +(rows||'<tr><td colspan="'+nc+'" style="text-align:center;color:var(--slate);padding:18px">No ad ran here in this period for this choice</td></tr>')+'</tbody>'
      +foot+'</table></div>'
      +(ads.length>ashow?'<div style="text-align:center;margin:14px 0"><button class="btn" onclick="CA.adShow=(CA.adShow||50)+50;caPaint()">Show more ('+ashow+' of '+ads.length+')</button></div>':'')
      +'</div>';
  };
  /* THE AUDIENCE TAB (18 Nov 2026, Ayush: "a new Audience tab, the same structure as Campaigns and Ads" - "in Audience only Who It
     Is will be there"). The projects table as on Campaigns; Facebook opens the section below. Each row is an audience: the
     targeting of the ad sets that ran in the period, ad sets with the same targeting counted as one. Its arrow opens the
     campaigns using it, each campaign its ad sets. Columns: Audience type (Advantage+ / Lookalike / Custom list / Interest /
     Broad - the interests and audiences on hover), Locations, Age, Gender, and Meta's estimate of the people it can reach.
     Read from Meta now (edge function ad-audience), kept 10 minutes. Google ad groups have no such targeting here. */
  const audTree=function(p,pl){
    const W=CA_PLAT[pl];
    const top='<div class="ca-sec"><div style="padding:11px 14px;font-weight:700;font-size:13.5px;border-bottom:1px solid var(--line)"><i class="'+W.icon+'" style="color:'+W.color+'"></i> '+W.name+' · '+esc(p);
    if(pl!=='meta') return top+'</div><div style="padding:16px;color:var(--slate)"><i class="fa-solid fa-circle-info"></i> Audiences are shown for Facebook ad sets - open Facebook above.</div></div>';
    if(CA_D.adsLoading) return top+'</div><div style="padding:16px;color:var(--slate)"><i class="fa-solid fa-spinner fa-spin"></i> Loading audiences…</div></div>';
    const AU=CA.au=CA.au||{a:null,camp:null};
    // the ad sets that ran here in the period (following Active / Inactive / Both), biggest spend first
    const sp={}, campOf={};
    CA_D.ads.forEach(function(a){ if(a.project!==p||a.platform!=='meta'||!a.adset_id||!caAdOk(a)) return; if(!((+a.spend||0)>0||(+a.impressions||0)>0)) return;
      sp[a.adset_id]=(sp[a.adset_id]||0)+(+a.spend||0); campOf[a.adset_id]=a.campaign_id; });
    const sids=Object.keys(sp).sort(function(x,y){ return sp[y]-sp[x]; });
    window._caAud=window._caAud||{};
    const now=Date.now(), need=sids.filter(function(id){ const h=window._caAud[id]; return !h||h.at<now-600000; });
    if(need.length&&!window._caAudBusy&&!((window._caAudErrAt||0)>now-60000)) caAudLoad(need);   // after a failure, asked again a minute later
    const A=function(id){ const h=window._caAud[id]; return h&&h.d; };
    const dash='<span style="color:#94a3b8">—</span>';
    const big=function(n){ return n>=1e7?(n/1e7).toFixed(1)+' Cr':n>=1e5?(n/1e5).toFixed(1)+' L':obNum(n); };
    const listCell=function(list,n){ if(!list||!list.length) return '<td style="text-align:left">'+dash+'</td>';
      return '<td style="text-align:left;white-space:normal;min-width:180px;max-width:280px" title="'+esc(list.join('\n'))+'">'+esc(list.slice(0,n).join(', '))+(list.length>n?' <span style="color:var(--slate)">+'+(list.length-n)+' more</span>':'')+'</td>'; };
    const who=function(d){ if(!d) return '<td colspan="5" style="text-align:left;color:var(--slate)">'+(window._caAudErr?'Meta did not answer: '+esc(window._caAudErr):'<i class="fa-solid fa-spinner fa-spin"></i> Asking Meta…')+'</td>';
      const names=(d.audiences||[]).concat(d.interests||[]);
      const sub=[(d.audiences||[]).length?d.audiences.length+' audience'+(d.audiences.length===1?'':'s'):'',(d.interests||[]).length?d.interests.length+' interest'+(d.interests.length===1?'':'s'):''].filter(Boolean).join(' · ');
      return '<td style="text-align:left"'+(names.length?' title="'+esc(names.join('\n'))+'"':'')+'><b>'+esc(d.type||'—')+'</b>'+(sub?'<div class="ca-sub">'+esc(sub)+'</div>':'')+'</td>'
        +listCell((d.locations||[]).map(function(x){ return /^-?\d+\.\d+, -?\d+\.\d+/.test(x)?'Pin '+x:x; }),2)+'<td>'+esc(d.age||'—')+'</td><td>'+esc(d.gender||'—')+'</td>'
        +'<td title="Meta\x27s estimate of the people this ad set can reach (monthly active)">'+(!d.size?dash:d.size.hi<=1000?'Below 1,000':big(d.size.lo)+' – '+big(d.size.hi))+'</td>'; };
    const keyOf=function(d){ return d?JSON.stringify([d.type,(d.audiences||[]).slice().sort(),(d.interests||[]).slice().sort(),(d.locations||[]).slice().sort(),(d.excluded||[]).slice().sort(),d.age,d.gender]):''; };
    // ad sets with the same targeting together; ones not read yet stand alone
    const groups=[], byK={};
    sids.forEach(function(id){ const d=A(id), k=d?keyOf(d):'id:'+id; let g=byK[k]; if(!g){ g=byK[k]={k:k,ids:[],spend:0}; groups.push(g); } g.ids.push(id); g.spend+=sp[id]; });
    groups.sort(function(x,y){ return y.spend-x.spend; });
    window._caAuK=[]; let rows='';
    groups.forEach(function(g){
      const lead=g.ids[0], d=A(lead), on=AU.a===g.k, nm0=(E['adset:'+lead]||{}).name||(d&&d.name)||lead;
      const nC=[...new Set(g.ids.map(function(id){ return campOf[id]; }))].length;
      rows+='<tr class="ca-row ca-l0'+(on?' ca-on':'')+'" onclick="caAu(\'a\',_caAuK['+(window._caAuK.push(g.k)-1)+'])">'
        +nm(caret(on),nm0+(g.ids.length>1?'  ·  '+g.ids.length+' ad sets':''))+who(d)+'</tr>';
      if(!on) return;
      [...new Set(g.ids.map(function(id){ return campOf[id]; }))].forEach(function(cid){
        const ce=E['campaign:'+cid]||{}, ck=g.k+'|'+cid, con=AU.camp===ck, mine=g.ids.filter(function(id){ return campOf[id]===cid; });
        rows+='<tr class="ca-row ca-l1'+(con?' ca-on':'')+'" onclick="caAu(\'camp\',_caAuK['+(window._caAuK.push(ck)-1)+'])">'+nm(caret(con)+caDot(ce.status),ce.name||cid)+who(d)+'</tr>';
        if(!con) return;
        mine.forEach(function(sid){ const se=E['adset:'+sid]||{};
          rows+='<tr class="ca-l2"><td class="ca-nm"><span class="ca-nmx" title="'+esc(se.name||sid)+'">'+caDot(se.status||ce.status)+esc(se.name||sid)+'</span></td>'+who(A(sid))+'</tr>'; });
      });
    });
    return top+' <span style="font-weight:500;color:var(--slate);font-size:12px">- '+groups.length+' audience'+(groups.length===1?'':'s')+' from '+sids.length+' ad set'+(sids.length===1?'':'s')+'; click one for the campaigns using it, then its ad sets</span></div>'
      +'<div style="overflow-x:auto"><table class="ca-tbl"><thead><tr><th class="ca-nm">Audience</th><th style="text-align:left">Audience type</th><th style="text-align:left">Locations</th><th>Age</th><th>Gender</th><th title="Meta\x27s estimate of the people it can reach (monthly active)">Est. audience size</th></tr></thead><tbody>'
      +(rows||'<tr><td colspan="6" style="text-align:center;color:var(--slate);padding:18px">No ad set ran here in this period for this choice</td></tr>')+'</tbody></table></div></div>';
  };
  const bud=function(v){ return '<td>'+(v==null?'<span style="color:#94a3b8">—</span>':obMoney(v))+'</td>'; };
  let rows='';
  /* THE AUDIENCE TAB IS FACEBOOK ONLY (18 Nov 2026, Ayush: "in Audience why is there Google?"): its projects table lists only
     projects with a Facebook account, their rows and the Total count Facebook alone, and there is no Google row. */
  const AUD=CA_TAB==='audience'||CA_TAB==='checklist', fbOf=function(list){ return AUD?list.filter(function(c){ return c.platform==='meta'; }):list; };
  const hasFb=function(p){ return Object.keys(CA_D.acc).some(function(k){ return k.indexOf('meta:')===0&&CA_D.acc[k].project===p; }); };
  if(AUD&&CA.plat!=='meta') CA.plat=CA.open?'meta':CA.plat;
  const shownT=AUD?shown.filter(hasFb):shown, srcT=AUD?'facebook':undefined;
  shownT.forEach(function(p){
    const cur=fbOf(CA_D.cur.filter(function(c){ return c.project===p; })), pw=fbOf(prev.filter(function(c){ return c.project===p; })), on=CA.open===p;
    rows+='<tr class="ca-row ca-l0'+(on?' ca-on':'')+'" onclick="caToggle('+P.indexOf(p)+')"><td>'+caret(on)+esc(p)+'</td>'+bud(AUD?budV(p,'meta'):budV(p))+cols(sum(cur,AUD?'meta':undefined),sum(pw,AUD?'meta':undefined),crmX(function(x){ return x.project===p; },srcT))+'</tr>';
    if(!on) return;
    (AUD?['meta']:['google','meta']).forEach(function(pl){
      const W=CA_PLAT[pl], pc=cur.filter(function(c){ return c.platform===pl; }), pon=CA.plat===pl;
      const has=Object.keys(CA_D.acc).some(function(k){ return k.indexOf(pl+':')===0&&CA_D.acc[k].project===p; });
      // a platform the project has no account on is not listed at all (11 Nov 2026, Ayush: Sarovar Hotel's "Google" row removed)
      if(!has) return;
      // no caret: Google / Facebook do not open in the table, a click shows their section below (6 Nov 2026)
      rows+='<tr class="ca-row ca-l1'+(pon?' ca-on':'')+'" onclick="caPlat(\''+pl+'\')"><td><span class="ca-caret"></span><i class="'+W.icon+'" style="color:'+W.color+'"></i> '+W.name+'</td>'+bud(budV(p,pl))+cols(sum(pc,pl),sum(pw.filter(function(c){ return c.platform===pl; }),pl),crmX(function(x){ return x.project===p; },pl==='google'?'google':'facebook'))+'</tr>';
    });
  });
  // 7 Nov 2026: the overall Total under the projects - every project shown, Google and Facebook together
  const inP={}; shownT.forEach(function(p){ inP[p]=1; });
  const tb=shownT.reduce(function(s,p){ const v=AUD?budV(p,'meta'):budV(p); return v==null?s:(s||0)+v; },null);
  const foot=shownT.length>1||CA.proj==='all'?'<tfoot><tr class="ca-tot"><td>Total</td>'+bud(tb)
    +cols(sum(fbOf(CA_D.cur.filter(function(c){ return inP[c.project]; })),AUD?'meta':undefined),sum(fbOf(prev.filter(function(c){ return inP[c.project]; })),AUD?'meta':undefined),crmX(function(x){ return inP[x.project]; },srcT))+'</tr></tfoot>':'';
  let html='<div class="card" style="overflow-x:auto"><table class="ca-tbl"><thead>'+head('Project','Leads','Cost per lead',true)+'</thead><tbody>'
    +(rows||'<tr><td colspan="'+(7+NCRM)+'" style="text-align:center;color:var(--slate);padding:24px">No ad accounts</td></tr>')+'</tbody>'+foot+'</table></div>';
  // the open platform's campaigns, ad sets and ads come under the whole projects table, and the page
  // scrolls down to them (caPlat) so they are seen
  // the Ads tab shows the open platform's ads, ad sets and campaigns from the ad upwards (adsTree)
  if(CA.open&&CA.plat) html+='<div class="ca-below" id="caBelow">'+(CA_TAB==='ads'?adsTree(CA.open,CA.plat):CA_TAB==='audience'?audTree(CA.open,CA.plat):section())+'</div>';
  // (16 Nov 2026, Ayush: the explanation paragraph under the table removed)
  $('caBody').innerHTML=caNA(html);
}
// the Ads tab: open / close a level (ad, ad set) and an ad's popup
/* THE CHECKLIST TAB, ALERTS FIRST (18 Nov 2026, Ayush: "not project-wise - the section, the point, and under it what the
   problem is; nothing out of sight; a public link and a nice PDF"). The tab is the alerts themselves, drawn by
   assets/ck-render.js - the same drawing the public link (checklist-report.html) and the PDF use - with a strip above:
   a download (PDF) icon, and for super admins / Manash the public link switch and copy button (18 Nov 2026, Ayush: no Run
   button). It shows the latest saved run: the daily points (every day 00:00 IST) and the latest weekly (Mondays 01:00 IST). */
let CK_SHARE={loaded:false,on:false,token:null,busy:false};
let CK_PLAT='facebook';
window.ckPlat=function(k){ if(CK_PLAT===k) return; CK_PLAT=k; ckPaint(); };
async function ckShareCall(body){
  const {data:{session}}=await sb.auth.getSession();
  const r=await fetch(SUPABASE_URL+'/functions/v1/checklist-share',{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+((session&&session.access_token)||'')},body:JSON.stringify(body)});
  const t=await r.json().catch(function(){ return {}; }); if(!r.ok||t.error) throw new Error(t.error||('server said '+r.status)); return t;
}
function ckShareBar(){
  if(!state.super&&CA_SHARE_PEOPLE.indexOf(String(state.email||'').trim().toLowerCase())===-1) return '';
  if(!CK_SHARE.loaded&&!CK_SHARE.busy){ CK_SHARE.busy=true; ckShareCall({action:'status'}).then(function(t){ CK_SHARE.on=!!t.on; CK_SHARE.token=t.token||null; }).catch(function(){}).then(function(){ CK_SHARE.loaded=true; CK_SHARE.busy=false; if(CA_TAB==='checklist') ckPaint(); }); }
  return '<span style="display:inline-flex;gap:8px;align-items:center">'
    +'<label class="ca-sw'+(CK_SHARE.on?' on':'')+'" title="Anyone with the link can see the checklist alerts while this is on"><input type="checkbox"'+(CK_SHARE.on?' checked':'')+(CK_SHARE.loaded?'':' disabled')+' onchange="ckShareSet(this.checked)"><span class="k"></span>Public link</label>'
    +'<button class="btn btn-sm" style="height:32px;width:36px;padding:0;justify-content:center;gap:0" onclick="ckShareCopy()"'+(CK_SHARE.token?' title="Copy the public link"':' disabled title="Switch the public link on first"')+'><i class="fa-regular fa-copy"></i></button></span>';
}
window.ckShareSet=async function(on){
  try{ const t=await ckShareCall({action:'set',on:!!on}); CK_SHARE.on=!!t.on; CK_SHARE.token=t.token||null; toast(t.on?'Public link is on - anyone with the link can see the checklist alerts':'Public link is off - the link now shows nothing','ok'); }
  catch(e){ toast('Could not change the public link: '+e.message,'err'); }
  ckPaint();
};
window.ckShareCopy=function(){
  if(!CK_SHARE.token){ toast('Switch the public link on first','err'); return; }
  const link=location.origin+'/checklist-report.html#k='+CK_SHARE.token;
  const done=function(){ toast(CK_SHARE.on?'Link copied':'Link copied - it shows nothing until the public link is switched on','ok'); };
  if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done,function(){ prompt('Copy this link',link); });
  else prompt('Copy this link',link);
};
// the shared drawing (assets/ck-render.js), loaded once
function ckEnsure(cb){
  if(window.ckRender) return cb();
  if(window._ckLoading){ window._ckLoading.push(cb); return; }
  window._ckLoading=[cb];
  const s=document.createElement('script'); s.src='assets/ck-render.js?v=6';
  s.onload=function(){ const st=document.createElement('style'); st.textContent=window.CK_CSS||''; document.head.appendChild(st); const l=window._ckLoading; window._ckLoading=null; l.forEach(function(f){ f(); }); };
  s.onerror=function(){ const l=window._ckLoading; window._ckLoading=null; l.forEach(function(f){ f(true); }); };
  document.head.appendChild(s);
}
function ckPaint(){
  const head=$('caHead'), body=$('caBody'); if(!head||!body) return;
  const G=CK_PLAT==='google', K=G?window._caCkG:window._caCk;
  if(!K) caCkLoad(CK_PLAT);
  /* FACEBOOK | GOOGLE (19 Nov 2026, Ayush: "Execute the Google Checklist, Facebook is done already"): one Checklist tab, the platform
     chosen at the top. Google's points come from the Google sheet of "Pre-emptive Alert - Checklists" (edge function gads-checklist,
     saved in camp.gads_check_runs / gads_check_flags). The public link shows the Facebook checklist only. */
  const sw=function(k,t){ return '<button type="button" onclick="ckPlat(\''+k+'\')" style="height:34px;padding:0 14px;border:0;border-radius:8px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;background:'+(CK_PLAT===k?'var(--bg-card,#fff)':'transparent')+';color:'+(CK_PLAT===k?'var(--ink)':'var(--slate)')+';box-shadow:'+(CK_PLAT===k?'0 1px 3px rgba(15,23,42,.15)':'none')+'">'+t+'</button>'; };
  head.innerHTML='<div class="ob-bar"><span style="display:inline-flex;gap:2px;padding:3px;border-radius:11px;background:#eef2f7">'+sw('facebook','Facebook Checklist')+sw('google','Google Checklist')+'</span>'
    +'<span style="margin-left:auto;display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap">'
    +'<button class="btn" style="height:36px;width:40px;padding:0;justify-content:center;gap:0" onclick="ckPdf()"'+(K&&K.flags&&K.flags.length?' title="Download PDF"':' disabled title="Nothing to download yet"')+'><i class="fa-solid fa-download"></i></button>'
    +(G?'':ckShareBar())+'</span></div>';
  if(!K||K.st==='load'){ body.innerHTML='<div class="loader"><div class="spin"></div></div>'; return; }
  ckEnsure(function(err){
    if(err){ body.innerHTML='<div class="card card-pad" style="color:#b91c1c">Could not load the checklist layout - reload the page.</div>'; return; }
    body.innerHTML='<div style="padding:2px 0 30px">'+window.ckRender({flags:K.flags||[],runs:K.runs||[],live:!!K.live,emptyNote:G?'No Google check has been saved yet. The daily points are checked every day at 00:15 IST, the weekly points every Monday at 01:15 IST.':''},{})+'</div>';
  });
}
/* DIRECT DOWNLOAD (19 Nov 2026, Ayush: "direct file download", no print preview then Save). The checklist is drawn
   off-screen and html2pdf turns it into an A4 PDF that downloads straight away. The library loads only on first use. */
let CK_PDF_LIB=null;
function ckPdfLib(cb){
  if(window.html2pdf) return cb();
  if(!CK_PDF_LIB){ CK_PDF_LIB=[]; const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    s.onload=function(){ const q=CK_PDF_LIB; CK_PDF_LIB=null; q.forEach(function(f){ f(); }); };
    s.onerror=function(){ const q=CK_PDF_LIB; CK_PDF_LIB=null; q.forEach(function(f){ f('lib'); }); };
    document.head.appendChild(s); }
  CK_PDF_LIB.push(cb);
}
window.ckPdf=function(){
  const G=CK_PLAT==='google', K=G?window._caCkG:window._caCk, PT=G?'Google Checklist':'Facebook Checklist'; if(!K||!K.flags||!K.flags.length) return;
  if(window._ckPdfBusy) return; window._ckPdfBusy=true;
  toast('Making the PDF…');
  ckEnsure(function(err){
    if(err){ window._ckPdfBusy=false; toast('Could not make the PDF - reload the page','err'); return; }
    ckPdfLib(function(e2){
      if(e2){ window._ckPdfBusy=false; toast('Could not load the PDF maker - check the internet connection','err'); return; }
      const box=document.createElement('div');
      box.id='ckPdfBox'; box.style.cssText='position:fixed;left:-12000px;top:0;width:1000px;background:#fff;font-family:Inter,system-ui,Segoe UI,Arial,sans-serif';
      box.innerHTML='<style>#ckPdfBox .hd{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #e0121c;padding:0 0 10px;margin:0 0 14px}#ckPdfBox .hd b{font-size:18px}#ckPdfBox .hd span{color:#64748b;font-size:12px}'
        +window.CK_CSS+'#ckPdfBox .ck-noprint{display:none!important}#ckPdfBox .ck tr{break-inside:avoid}</style>'
        +'<div class="hd"><b>'+PT+' · The Jain Group</b><span>'+esc(new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}))+'</span></div>'
        +window.ckRender({flags:K.flags,runs:K.runs||[],live:!!K.live},{print:true});
      document.body.appendChild(box);
      const done=function(){ box.remove(); window._ckPdfBusy=false; };
      window.html2pdf().set({ margin:[10,8,10,8], filename:PT+' '+new Date().toISOString().slice(0,10)+' - The Jain Group.pdf',
        image:{type:'jpeg',quality:0.95}, html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff',windowWidth:1000},
        jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}, pagebreak:{mode:['css','legacy'],avoid:['tr','.ck-ph']} })
        .from(box).save().then(done,function(){ done(); toast('Could not make the PDF','err'); });
    });
  });
};
// the Columns dropdown of the Facebook sections (Campaigns: CA_XC.camp, Ads: CA_XC.ads), kept in this browser
const CA_XC_NAMES={freq:'Frequency',reach:'Reach',imp:'Impressions',cpm:'CPM',cpc:'CPC',ctr:'CTR',clicks:'Clicks',is:'Search impression share',blis:'Lost IS (budget)',rlis:'Lost IS (rank)'};
/* GOOGLE'S EXTRA COLUMNS (19 Nov 2026, Ayush: "the extra things add in the dropdown like it happens for Facebook"): gcamp = Campaigns
   tab, gads = Ads tab (impression share is per campaign, so only the Campaigns tab has it). Clicks and CTR stay in Google's table as before. */
const CA_XC_OPTS={camp:['freq','reach','imp','cpm','cpc','ctr','clicks'],ads:['freq','cpm','cpc','clicks'],gcamp:['imp','cpc','cpm','is','blis','rlis'],gads:['imp','cpc','cpm']};
window.CA_XC=(function(){ try{ return JSON.parse(localStorage.getItem('caXC')||'{}')||{}; }catch(e){ return {}; } })();
function caXcList(tab){ const on=(window.CA_XC[tab]||[]); return CA_XC_OPTS[tab].filter(function(k){ return on.indexOf(k)>=0; }); }
function caXcPicker(tab){ const on=caXcList(tab);
  return '<span onclick="event.stopPropagation()" style="position:relative;display:inline-block" title="Extra Facebook columns"><button class="btn" style="height:36px;padding:0 12px;font-size:13px;font-weight:600" onclick="caXcOpen(\''+tab+'\')"><i class="fa-solid fa-table-columns"></i> Columns'+(on.length?' ('+on.length+')':'')+' <i class="fa-solid fa-chevron-'+(window._caXcOpen===tab?'up':'down')+'" style="font-size:10px"></i></button>'
    +(window._caXcOpen===tab?'<div style="position:absolute;left:0;top:calc(100% + 4px);z-index:30;background:var(--bg-card,#fff);border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(15,23,42,.14);padding:6px;min-width:170px;text-align:left">'
      +CA_XC_OPTS[tab].map(function(k){ return '<label style="display:flex;gap:8px;align-items:center;padding:6px 8px;font-size:13px;cursor:pointer;border-radius:6px;white-space:nowrap;margin:0"><input type="checkbox" style="height:auto;width:auto;padding:0;margin:0;border:0"'+(on.indexOf(k)>=0?' checked':'')+' onchange="caXcSet(\''+tab+'\',\''+k+'\',this.checked)"> '+CA_XC_NAMES[k]+'</label>'; }).join('')+'</div>':'')+'</span>'; }
/* THE DATE RANGE DROPDOWN WITH THE COLUMNS IN IT (18 Nov 2026, Ayush: "merge Columns into the Date Range dropdown"). One button
   on the top strip: the period on the left of its menu, and on the Campaigns / Ads tabs the extra Facebook columns on the
   right (hidden by default). A period the Compare side already uses cannot be picked (as before). */
function caPerPicker(off){
  const tab=CA_TAB==='overview'?'camp':CA_TAB==='ads'?'ads':null, on=tab?caXcList(tab).concat(caXcList('g'+tab)):[], open=window._caXcOpen==='per';
  const cur=OB_PERIODS.filter(function(o){ return String(o[0])===String(OB_P.period); })[0];
  const label=esc(cur?cur[1]:'Period')+(on.length?' <span style="color:var(--slate);font-weight:500">· '+on.length+' col'+(on.length===1?'':'s')+'</span>':'');
  const item=function(o){ const dis=off&&off!=='custom'&&o[0]===off, sel=String(o[0])===String(OB_P.period);
    return '<button type="button"'+(dis?' disabled title="Chosen on the Compare side"':'')+' onclick="caPerPick('+esc(JSON.stringify(String(o[0])))+')" style="display:block;width:100%;text-align:left;border:0;background:'+(sel?'#eef4ff':'transparent')+';color:'+(dis?'#cbd5e1':sel?'#1d4ed8':'var(--ink)')+';font:inherit;font-size:13px;font-weight:'+(sel?700:500)+';height:32px;padding:0 10px;border-radius:6px;cursor:'+(dis?'not-allowed':'pointer')+';white-space:nowrap">'+esc(o[1])+'</button>'; };
  /* THREE EVEN COLUMNS (20 Nov 2026, Ayush: "the 2 sections are still not nicely divided, not nicely aligned"): Date range | Facebook columns |
     Google columns - the same width, the same heading strip, every row the same height, a thin divider the full height between them. */
  const colBox=function(title,icon,body,first){ var w=first?176:206; return '<div style="flex:0 0 '+w+'px;width:'+w+'px;padding:0 6px;box-sizing:border-box'+(first?'':';border-left:1px solid var(--line)')+'"><div style="height:30px;display:flex;align-items:center;gap:7px;padding:0 10px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--slate);white-space:nowrap;border-bottom:1px solid var(--line);margin-bottom:4px">'+icon+title+'</div>'+body+'</div>'; };
  const panel=function(tb,title,icon){ const onT=caXcList(tb); return colBox(title,icon,CA_XC_OPTS[tb].map(function(k){ return '<label style="display:flex;gap:9px;align-items:center;height:32px;padding:0 10px;font-size:13px;font-weight:500;cursor:pointer;border-radius:6px;white-space:nowrap;margin:0"><input type="checkbox" style="height:auto;width:auto;padding:0;margin:0;border:0;flex:none"'+(onT.indexOf(k)>=0?' checked':'')+' onchange="caXcSet(\''+tb+'\',\''+k+'\',this.checked)"><span>'+CA_XC_NAMES[k]+'</span></label>'; }).join(''),false); };
  const cols=tab?panel(tab,'Facebook','<i class="fa-brands fa-facebook" style="color:#1877f2;font-size:13px"></i>')+panel('g'+tab,'Google','<i class="fa-brands fa-google" style="color:#ea4335;font-size:12px"></i>'):'';
  return '<span onclick="event.stopPropagation()" style="position:relative;display:inline-block"><button type="button" id="caPer" onclick="caXcOpen(\'per\')" style="height:36px;padding:0 11px;border:1px solid var(--line);border-radius:9px;font:inherit;font-size:13px;font-weight:600;background:var(--bg-card);color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;gap:8px;white-space:nowrap">'+label+' <i class="fa-solid fa-chevron-'+(open?'up':'down')+'" style="font-size:10px;color:var(--slate)"></i></button>'
    +(open?'<div style="position:absolute;left:0;top:calc(100% + 4px);z-index:40;background:var(--bg-card,#fff);border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(15,23,42,.14);padding:8px 4px;display:flex;align-items:stretch">'+colBox('Date range','<i class="fa-regular fa-calendar" style="font-size:12px"></i>',OB_PERIODS.map(item).join(''),true)+cols+'</div>':'')+'</span>';
}
window.caPerPick=function(v){ window._caXcOpen=null; if(String(v)===String(OB_P.period)){ caPaint(); return; } OB_P.period=v; caReset(); caLoad(); };
// Google's impression share per campaign and day for the dates on screen (camp.ads_daily, kept for the visit), then drawn again
window.caGisLoad=async function(key,s,e){
  const box=window._caGis[key];
  try{ box.d=(await caAllPages(function(){ return sb.schema('camp').from('ads_daily').select('campaign_id,day,impressions,imp_share,budget_lost_is,rank_lost_is').eq('platform','google').gte('day',s).lte('day',e).not('imp_share','is',null).order('day').order('campaign_id'); }))||[]; }
  catch(err){ console.warn('impression share',err); box.d=[]; }
  box.st='ok';
  if(typeof CA_TAB!=='undefined'&&(CA_TAB==='overview')&&CA_D&&!CA_D.adsLoading) caPaint();
};
window.caXcOpen=function(tab){ window._caXcOpen=window._caXcOpen===tab?null:tab; caPaint(); };
window.caXcSet=function(tab,k,on){ const l=(window.CA_XC[tab]||[]).filter(function(x){ return x!==k; }); if(on) l.push(k); window.CA_XC[tab]=l; try{ localStorage.setItem('caXC',JSON.stringify(window.CA_XC)); }catch(e){} caPaint(); };
if(!window._caXcDoc){ window._caXcDoc=true; document.addEventListener('click',function(){ if(window._caXcOpen){ window._caXcOpen=null; if(typeof CA_D!=='undefined'&&CA_D) caPaint(); } }); }
// the Checklist tab: open / close a campaign or an ad set; the latest saved runs; a check worked out now (nothing saved or sent)
window.caCk=function(level,id){ const CK=CA.ck=CA.ck||{c:null,s:null}; if(level==='c'){ CK.c=CK.c===id?null:id; CK.s=null; } else CK.s=CK.s===id?null:id; caPaint(); };
window.caCkLoad=async function(plat){
  const G=plat==='google', slot=G?'_caCkG':'_caCk', pre=G?'gads':'fb';
  window[slot]={st:'load'};
  try{
    const r=await sb.schema('camp').from(pre+'_check_runs').select('id,kind,run_day,ran_at,period_from,period_to,flags').order('ran_at',{ascending:false}).limit(20);
    if(r.error) throw r.error;
    const runs=[]; ['daily','weekly'].forEach(function(k){ const x=(r.data||[]).filter(function(y){ return y.kind===k; })[0]; if(x) runs.push(x); });
    let flags=[]; if(runs.length){ const q=await sb.schema('camp').from(pre+'_check_flags').select('*').in('run_id',runs.map(function(x){ return x.id; })).limit(5000); if(q.error) throw q.error; flags=q.data||[]; }
    window[slot]={st:'ok',runs:runs,flags:runs.length?flags:null};
  }catch(e){ window[slot]={st:'ok',runs:[],flags:null,err:String(e&&e.message||e)}; }
  if(CA_TAB==='checklist') ckPaint();
};
window.caCkRun=async function(){
  const K=window._caCk||{st:'ok'}; K.busy=true; window._caCk=K; caPaint();
  try{ const {data:{session}}=await sb.auth.getSession();
    const res=await fetch(SUPABASE_URL+'/functions/v1/fb-checklist',{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+((session&&session.access_token)||'')},body:JSON.stringify({kind:'all',dry:true})});
    const t=await res.json().catch(function(){ return {}; });
    if(!res.ok||!t.ok) throw new Error(t.error||('HTTP '+res.status));
    window._caCk={st:'ok',live:true,runs:[],flags:t.flags||[]};
  }catch(e){ K.busy=false; alert('The check could not run: '+(e&&e.message||e)); }
  if(CA_TAB==='checklist') ckPaint();
};
// the Audience tab: open / close an audience or a campaign under it
window.caAu=function(level,k){ const AU=CA.au=CA.au||{a:null,camp:null};
  if(level==='a'){ AU.a=AU.a===k?null:k; AU.camp=null; } else AU.camp=AU.camp===k?null:k; caPaint(); };
// who the ad sets are shown to, from Meta (edge function ad-audience), 150 a request; kept 10 minutes
window.caAudLoad=async function(ids){
  window._caAudBusy=true; window._caAudErr='';
  try{ const {data:{session}}=await sb.auth.getSession();
    for(let i=0;i<ids.length;i+=150){
      const res=await fetch(SUPABASE_URL+'/functions/v1/ad-audience',{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+((session&&session.access_token)||'')},body:JSON.stringify({adsets:ids.slice(i,i+150)})});
      const t=await res.json().catch(function(){ return {}; });
      if(!res.ok||!t.ok){ window._caAudErr=t.error||('HTTP '+res.status); break; }
      const at=Date.now(); ids.slice(i,i+150).forEach(function(id){ window._caAud[id]={at:at,d:(t.adsets||{})[id]||{type:'—',locations:[],interests:[],audiences:[],age:'—',gender:'—',size:null}}; });
    }
  }catch(e){ window._caAudErr=String(e&&e.message||e); }
  window._caAudBusy=false; if(window._caAudErr) window._caAudErrAt=Date.now();
  if(CA_TAB==='audience'&&CA_D&&!CA_D.adsLoading) caPaint();
};
window.caAx=function(level,k){ const AX=CA.ax=CA.ax||{ad:null,set:null,camp:null};
  if(level==='ad'){ AX.ad=AX.ad===k?null:k; AX.set=null; AX.camp=null; } else if(level==='set'){ AX.set=AX.set===k?null:k; AX.camp=null; } else AX.camp=AX.camp===k?null:k;
  caPaint(); };
// the Facebook Ads tab's Reach for exactly the dates on screen (edge function ad-reach asks Meta; nothing is stored), kept 10 minutes
window.caReachLoad=async function(key,req){
  const box=window._caReach[key];
  try{ const {data:{session}}=await sb.auth.getSession();
    const res=await fetch(SUPABASE_URL+'/functions/v1/ad-reach',{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+((session&&session.access_token)||'')},body:JSON.stringify(req)});
    const t=await res.json().catch(function(){ return {}; });
    if(!res.ok||!t.ok){ box.st='err'; box.why=t.error||('HTTP '+res.status); }
    else { box.st='ok'; box.d=t; if(t.errors&&t.errors.length) console.warn('ad-reach',t.errors); }
  }catch(e){ box.st='err'; box.why=String(e&&e.message||e); }
  if(window._caReach[key]===box&&typeof CA_TAB!=='undefined'&&(CA_TAB==='ads'||CA_TAB==='overview')&&CA_D&&!CA_D.adsLoading) caPaint();
};
window.caAdTabOpen=function(i){ const a=(window._caAdsTab||[])[i]; if(a) caAdShow(a); };
window.caCmpToggle=function(on){ CA.cmp.on=!!on;
  // the default other side: the previous period, unless that is what the main side already is
  if(on&&CA.cmp.period!=='custom'&&CA.cmp.period===OB_P.period) CA.cmp.period='prev';
  caLoad(); };
window.caCmpPick=function(v){ CA.cmp.period=v; if(v==='custom'&&!CA.cmp.from){ const r=obRange(); CA.cmp.from=r.ps; CA.cmp.to=r.pe; } caLoad(); };
// The ads of what is open: every campaign of the platform, one campaign, or one ad set.
// an ad's own CRM leads and qualified leads (camp.crm_adset_daily level 'ad', 16 Nov 2026); nothing shown when the CRM has none for it
// 17 Nov 2026 (Ayush): the card also shows SV and CPQL, and NA (not a dash, not left out) when the CRM has nothing for the ad
function caAdCrm(id,spend){ const C=CA_D&&CA_D.crmSet; let l=0,q=0,sv=0,n=0; if(C) C.cur.forEach(function(x){ if(x.level==='ad'&&x.ad_id===String(id)){ n++; l+=+x.leads||0; q+=+x.qualified||0; sv+=+x.site_visited||0; } });
  const na='<b style="color:#94a3b8">NA</b>';
  if(!n) return '<span>CRM leads</span>'+na+'<span>QL</span>'+na+'<span>SV</span>'+na+'<span>CPQL</span>'+na;
  return '<span>CRM leads</span><b>'+obNum(l)+'</b><span>QL</span><b>'+obNum(q)+(l?' <span style="font-weight:500;color:#64748b">('+Math.round(q/l*100)+'%)</span>':'')+'</b>'
    +'<span>SV</span><b>'+obNum(sv)+'</b><span>CPQL</span><b>'+(q&&+spend>0?obMoney(spend/q):'NA')+'</b>'; }
// NA instead of a dash in every empty figure (17 Nov 2026, Ayush: "Any ---- will be NA instead"). Only a dash standing alone
// as a cell's or line's value is changed, never one inside a campaign's or ad's name.
function caNA(h){ return String(h).replace(/>(\s*)—(?=\s*<|\s)/g,'>$1NA'); }
// an ad that is running now: the ad, its campaign and its ad set all switched on - used by the Active / Inactive / Both choice
function caAdLive(a){ const E=CA_D.ent; return caLive((E['ad:'+a.ad_id]||{}).status)&&caLive((E['campaign:'+a.campaign_id]||{}).status)&&(!a.adset_id||caLive((E['adset:'+a.adset_id]||{}).status)); }
function caAdOk(a){ return CA_ST==='both'||(CA_ST==='active')===caAdLive(a); }
/* VIDEOS PLAY (17 Nov 2026, Ayush: "the video thumbnail is showing, I want the video to play"). Google video ads are YouTube
   videos (played in place). For a Facebook ad the edge function ad-video asks Meta: its video, or Meta's own preview of the
   ad, which plays it as it looks in the feed. Asked once per ad and kept for the visit; cards of video ads get a play mark. */
window._caVid=window._caVid||{};
async function caVidLoad(ids){
  ids=ids.filter(function(id){ return !(id in window._caVid); }); if(!ids.length) return;
  ids.forEach(function(id){ window._caVid[id]=null; });
  try{ const {data:{session}}=await sb.auth.getSession();
    const r=await fetch(SUPABASE_URL+'/functions/v1/ad-video',{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+((session&&session.access_token)||'')},body:JSON.stringify({ads:ids})});
    const t=await r.json().catch(function(){ return {}; });
    Object.keys((t&&t.ads)||{}).forEach(function(id){ window._caVid[id]=t.ads[id]; });
  }catch(e){ ids.forEach(function(id){ delete window._caVid[id]; }); }
}
function caVidMarks(){ document.querySelectorAll('[data-cavid]').forEach(function(el){ const v=window._caVid[el.getAttribute('data-cavid')]; if(v&&(v.iframe||v.src)) el.classList.add('ca-isvid'); }); }
function caAds(p,pl){
  const W=CA_PLAT[pl], E=CA_D.ent;
  if(CA_D.adsLoading) return '<div style="font-weight:700;font-size:13.5px;margin:16px 2px 10px"><i class="'+W.icon+'" style="color:'+W.color+'"></i> Ads</div><div style="font-size:12.5px;color:var(--slate);margin:0 2px"><i class="fa-solid fa-spinner fa-spin"></i> Loading ads…</div>';
  let ads=CA_D.ads.filter(function(a){ return a.project===p&&a.platform===pl&&caAdOk(a); });
  if(CA.camp) ads=ads.filter(function(a){ return a.campaign_id===CA.camp; });
  if(CA.adset) ads=ads.filter(function(a){ return a.adset_id===CA.adset; });
  else { // rows come per ad group (v4): one card per ad, its ad groups added together
    const by={}, out=[]; ads.forEach(function(a){ const m=by[a.ad_id]; if(!m){ by[a.ad_id]=Object.assign({},a); out.push(by[a.ad_id]); return; }
      ['spend','impressions','clicks'].forEach(function(f){ m[f]=(+m[f]||0)+(+a[f]||0); });
      if(a.results!=null) m.results=(m.results==null?0:+m.results)+(+a.results); });
    ads=out.sort(function(x,y){ return (+y.spend||0)-(+x.spend||0); }); }
  const where=CA.adset?(E['adset:'+CA.adset]||{}).name||W.set:CA.camp?(E['campaign:'+CA.camp]||{}).name||'this campaign':'all '+W.name+' campaigns';
  const stat=function(s){ s=String(s||''); const on=s==='ACTIVE'||s==='ENABLED'; return '<span class="tag '+(on?'t-green':'t-gray')+'" style="font-size:10.5px">'+(on?'Running':s?s.charAt(0)+s.slice(1).toLowerCase().replace(/_/g,' '):'—')+'</span>'; };
  const shown=ads.slice(0,CA.showAds);
  let h='<div style="font-weight:700;font-size:13.5px;margin:16px 2px 10px"><i class="'+W.icon+'" style="color:'+W.color+'"></i> Ads <span style="font-weight:500;color:var(--slate);font-size:12px">- '+ads.length+' that ran in this period · '+esc(p)+' · '+esc(where)+'</span></div>';
  if(!ads.length) return h+'<div style="font-size:12.5px;color:var(--slate);margin:0 2px">No ad ran here in this period.</div>';
  window._caAds=shown;
  // Facebook cards: ask which are videos (once per ad), then put the play mark on them
  const fbIds=shown.filter(function(a){ return a.platform==='meta'; }).map(function(a){ return String(a.ad_id); });
  if(fbIds.length) setTimeout(function(){ caVidLoad(fbIds).then(caVidMarks); caVidMarks(); },0);
  return h+'<div class="ob-ads">'+shown.map(function(a,i){
      const e=E['ad:'+a.ad_id]||{}, words=String(e.body||e.name||('Ad '+a.ad_id)).split('\n');
      const yt=pl==='google'&&caYtId(e.thumbnail);
      const pic=e.thumbnail?'<div class="pic'+(yt?' ca-isvid':'')+'" data-cavid="'+esc(String(a.ad_id))+'"><img src="'+esc(e.thumbnail)+'" loading="lazy" referrerpolicy="no-referrer" alt=""><span class="ca-play"><i class="fa-solid fa-play"></i></span></div>'
        :'<div class="txt">'+(pl==='google'?'<div class="sp">Sponsored</div>':'')+'<div class="h">'+esc(words[0])+'</div>'+(words[1]?'<div class="d">'+esc(words.slice(1).join(' '))+'</div>':'')+'</div>';
      return '<div class="ob-ad" style="cursor:pointer" title="Open this ad" onclick="caAdOpen('+i+')">'+pic+'<div style="padding:9px 12px 0;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(e.name||'')+'">'+esc(e.name||('Ad '+a.ad_id))+'</div>'
        +'<div style="padding:0 12px;font-size:11.5px;color:var(--slate)">'+stat(e.status)+'</div>'
        +'<div class="m"><span>Spend</span><b>'+obMoney(a.spend)+'</b><span>'+(pl==='meta'?'Results':W.res)+'</span><b>'+obNum(a.results,0)+'</b><span>Cost per result</span><b>'+obMoney(+a.results?a.spend/a.results:null)+'</b><span>CTR</span><b>'+obPct(+a.impressions?a.clicks/a.impressions*100:null)+'</b>'+caAdCrm(a.ad_id,a.spend)+'</div></div>';
    }).join('')+'</div>'
    +(ads.length>shown.length?'<div style="text-align:center;margin:14px 0"><button class="btn" onclick="CA.showAds+='+obAdStep(ads.length)+';caPaint()">Show more ('+shown.length+' of '+ads.length+')</button></div>':'');
}
/* AN AD, OPENED (7 Nov 2026, Ayush: "the Ads which show if clicked should open nicely in a popup", then "open like
   it opens in Meta Ad Library Tab"). The same popup as the Meta Ad Library: the ad in a fixed frame on the left,
   shown whole (never cropped), on the right the details table, the figures for the period, the ad's words, and
   the status at the foot. A Google video ad plays its YouTube video in the frame ("In Google the Video does not
   play"). A Facebook ad shows its full picture (video ads their cover frame - Meta gives the video itself only
   through a separate call). */
function caYtId(u){ const m=String(u||'').match(/ytimg\.com\/vi\/([A-Za-z0-9_-]{6,})\//); return m?m[1]:null; }
window.caAdOpen=function(i){ const a=(window._caAds||[])[i]; if(a) caAdShow(a); };
window.caAdOpenRow=function(i){ const a=(window._caRowAds||[])[i]; if(a) caAdShow(a); };
// a Facebook video in the popup frame: the file itself, else Meta's preview of the ad (which plays it)
function caFbMedia(v,frame){
  if(v&&v.src) return '<div style="'+frame+';background:#000"><video src="'+esc(v.src)+'"'+(v.poster?' poster="'+esc(v.poster)+'"':'')+' controls autoplay muted playsinline style="width:100%;height:100%;object-fit:contain"></video></div>';
  if(v&&v.iframe) return '<div style="'+frame.replace('height:360px','height:560px')+';background:#fff"><iframe src="'+esc(v.iframe)+'" style="width:100%;height:100%;border:0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen scrolling="yes"></iframe></div>';
  return null;
}
function caAdShow(a){
  const pl=a.platform, W=CA_PLAT[pl], E=CA_D.ent, e=E['ad:'+a.ad_id]||{};
  const camp=(E['campaign:'+a.campaign_id]||{}).name||a.campaign_id, set=a.adset_id?((E['adset:'+a.adset_id]||{}).name||a.adset_id):null;
  const words=String(e.body||'').split('\n').filter(Boolean);
  const s=+a.spend||0, rr=a.results==null?null:+a.results, im=+a.impressions||0, cl=+a.clicks||0;
  const on=caLive(e.status), yt=pl==='google'?caYtId(e.thumbnail):null, r=obRange();
  const frame='height:360px;background:var(--bg,#f1f5f9);border:1px solid var(--line);border-radius:10px;display:flex;align-items:center;justify-content:center;overflow:hidden;color:var(--slate)';
  const fbv=pl==='meta'?caFbMedia(window._caVid[String(a.ad_id)],frame):null;
  const media=fbv?fbv:yt
    ?'<div style="'+frame+';background:#000"><iframe src="'+oaYtSrc(yt,true)+'" referrerpolicy="strict-origin-when-cross-origin" style="width:100%;height:100%;border:0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>'
    :e.thumbnail
      ?'<div style="'+frame+'"><img src="'+esc(e.thumbnail)+'" referrerpolicy="no-referrer" alt="" style="max-width:100%;max-height:100%;object-fit:contain;display:block"></div>'
      :'<div style="'+frame+';align-items:flex-start;justify-content:flex-start;background:#fff;padding:18px 20px;overflow:auto"><div>'+(pl==='google'?'<div style="font-size:11px;font-weight:700;color:#202124;margin-bottom:4px">Sponsored</div>':'')
        +'<div style="font-size:18px;color:#1a0dab;line-height:1.35;margin-bottom:6px">'+esc(words[0]||e.name||('Ad '+a.ad_id))+'</div>'
        +(words.length>1?'<div style="font-size:13px;color:#4d5156;line-height:1.5">'+esc(words.slice(1).join(' '))+'</div>':'')+'</div></div>';
  const lbl=function(t){ return '<div style="font-size:11.5px;color:var(--slate);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin:14px 0 5px">'+t+'</div>'; };
  const n=function(v){ return '<span style="font-variant-numeric:tabular-nums">'+v+'</span>'; };
  const openModal=function(h,sz){ return window.openModal(caNA(h),sz); };   // NA instead of dashes in the popup too
  openModal('<div class="modal-head"><h3><i class="'+W.icon+'" style="color:'+W.color+'"></i> '+esc(e.name||('Ad '+a.ad_id))+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="display:flex;gap:18px;flex-wrap:wrap">'
      +'<div id="caAdMedia" style="flex:1 1 320px;min-width:280px">'+media+'</div>'
      +'<div style="flex:1 1 300px;min-width:270px">'
        +'<table style="width:100%;border-collapse:collapse;font-size:12.5px">'
          +compDetailRow('Project',esc(a.project))+compDetailRow('Campaign',esc(camp))+(set?compDetailRow(W.set,esc(set)):'')
        +'</table>'
        +lbl(esc(fmtDate(r.s))+' – '+esc(fmtDate(r.e)))
        +'<table style="width:100%;border-collapse:collapse;font-size:12.5px">'
          +compDetailRow('Spend',n(obMoney(s)))+compDetailRow(pl==='meta'?'Results':W.res,n(obNum(rr,0)))+compDetailRow('Cost per result',n(obMoney(rr?s/rr:null)))
          +compDetailRow('Impressions',n(obNum(im)))+compDetailRow('Clicks',n(obNum(cl)))+compDetailRow('CTR',n(obPct(im?cl/im*100:null)))
        +'</table>'
        +((e.thumbnail||yt)&&words.length?lbl('Description')+'<div style="font-size:13px;line-height:1.55;white-space:pre-wrap;max-height:160px;overflow-y:auto;padding-right:4px">'+esc(words.join('\n'))+'</div>':'')
        +'<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line);display:flex;align-items:center;gap:9px;flex-wrap:wrap">'
          +'<span class="tag '+(on?'t-green':'t-gray')+'">'+(on?'Active':'Inactive')+'</span>'
          +'<span style="font-size:12px;color:var(--slate)"><i class="'+W.icon+'" style="color:'+W.color+'"></i> '+W.name+'</span>'
          +(yt?'<a href="https://www.youtube.com/watch?v='+esc(yt)+'" target="_blank" rel="noopener" class="btn btn-sm" style="margin-left:auto"><i class="fa-brands fa-youtube"></i> Watch on YouTube</a>':'')
        +'</div>'
      +'</div>'
    +'</div>','lg');
  // a Facebook ad not asked about yet: ask now, and play its video in the frame once Meta answers
  if(pl==='meta'&&!fbv&&!(String(a.ad_id) in window._caVid)) caVidLoad([String(a.ad_id)]).then(function(){
    const m=caFbMedia(window._caVid[String(a.ad_id)],frame), host=$('caAdMedia'); if(m&&host) host.innerHTML=m; });
}
function caReset(){ CA.open=CA.proj==='all'?null:CA.proj; CA.plat=null; CA.camp=null; CA.adset=null; CA.showAds=12; }
window.caPickProject=function(v){ CA.proj=v; CA.open=v==='all'?null:v; CA.plat=null; CA.camp=null; CA.adset=null; CA.showAds=12; caPaint(); };
window.caToggle=function(i){ const p=window._caP[i]; CA.open=CA.open===p?null:p; CA.ax=null; CA.adShow=50; CA.plat=null; CA.camp=null; CA.adset=null; CA.showAds=12; caPaint(); };
window.caPlat=function(p){ CA.plat=CA.plat===p?null:p; CA.ax=null; CA.adShow=50; CA.camp=null; CA.adset=null; CA.showAds=12; caPaint();
  requestAnimationFrame(function(){ const s=$('caBelow'); if(s) s.scrollIntoView({block:'start'}); }); };
window.caCamp=function(id){ CA.camp=CA.camp===id?null:id; CA.adset=null; CA.showAds=12; caPaint(); };
window.caSet=function(id){ CA.adset=CA.adset===id?null:id; CA.showAds=12; caPaint(); };
window.caUp=function(level){ if(level<=0){ CA.plat=null; } if(level<=1) CA.camp=null; CA.adset=null; CA.showAds=12; caPaint(); };

