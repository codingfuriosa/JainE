
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
let CA={proj:'all',open:null,plat:null,camp:null,adset:null,showAds:12,cmp:{on:false,period:'prev',from:'',to:''}};
let CA_D=null;   // the period's data: {acc, ent, cur, prev, ads, hasSets}
const CA_PLAT={google:{name:'Google',icon:'fa-brands fa-google',color:'#ea4335',res:'Conversions',per:'Cost per conversion',set:'Ad group',sets:'Ad groups'},
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
  +'.ca-warn{margin:-4px 0 12px;padding:9px 12px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;font-size:12.5px}'
  +'</style>';

// Leads that can honestly be added up: Google conversions, and Facebook results of lead / chat campaigns only.
function caAgg(rows){
  const E=CA_D.ent, t={spend:0,leads:0,lspend:0,clicks:0,impr:0};
  rows.forEach(function(c){ const s=+c.spend||0; t.spend+=s; t.clicks+=+c.clicks||0; t.impr+=+c.impressions||0;
    if(c.platform==='google'||obIsLead(E,c)){ t.leads+=+c.results||0; t.lspend+=s; } });
  t.cpl=t.leads?t.lspend/t.leads:null; t.ctr=t.impr?t.clicks/t.impr*100:null; return t;
}
// Running now (Facebook ACTIVE, Google ENABLED) - only these are listed below a platform (6 Nov 2026).
function caLive(s){ s=String(s||''); return s==='ACTIVE'||s==='ENABLED'; }
function caLeads(x,plat){ return obNum(x,plat==='google'||(plat==null&&x%1)?1:0); }

async function caView(host){
  host.innerHTML=OB_CSS+CA_CSS+'<div id="caHead"></div><div id="caBody"><div class="loader"><div class="spin"></div></div></div>';
  await caLoad();
}
/* COMPARE MODE (7 Nov 2026, Ayush): off by default; switched on, every figure in the tables shows the other
   period's figure and the change under it. The other period is "Previous period" (the same number of days just
   before) or any option of the normal dropdown, or a custom range - never the same dates as the main period. */
const CA_CMP_OPTS=[['prev','Previous period']].concat(OB_PERIODS);
function caRangeOf(period,from,to){ const keep=OB_P; OB_P=Object.assign({},OB_P,{period:period,from:from||'',to:to||''}); try{ return obRange(); } finally{ OB_P=keep; } }
function caCmpRange(){ const r=obRange(); if(CA.cmp.period==='prev') return {s:r.ps,e:r.pe}; return caRangeOf(CA.cmp.period,CA.cmp.from,CA.cmp.to); }
function caCmpSame(){ if(!CA.cmp.on) return false; const r=obRange(), c=caCmpRange(); return r.s===c.s&&r.e===c.e; }
async function caLoad(){
  const r=obRange(), rpc=function(fn,a){ return sb.schema('camp').rpc(fn,a); };
  const cmp=CA.cmp.on&&!caCmpSame(), c=cmp?caCmpRange():{s:r.ps,e:r.pe};
  if(CA_D) $('caBody').style.opacity='.55';
  const ads=async function(p,s,e){ const v=await rpc('ads_ad_totals_v2',{p_platform:p,p_from:s,p_to:e,p_limit:5000});
    if(!v.error) return {rows:v.data||[],sets:true};
    const o=await rpc('ads_ad_totals',{p_platform:p,p_from:s,p_to:e,p_limit:5000}); return {rows:o.data||[],sets:false,error:o.error}; };
  const none=Promise.resolve({rows:[],sets:true});
  const res=await Promise.all([
    sb.schema('camp').from('ads_accounts').select('platform,account_id,name,project').eq('include',true),
    obEntities('meta'), obEntities('google'),
    rpc('ads_campaign_totals',{p_platform:'meta',p_from:r.s,p_to:r.e}), rpc('ads_campaign_totals',{p_platform:'google',p_from:r.s,p_to:r.e}),
    rpc('ads_campaign_totals',{p_platform:'meta',p_from:c.s,p_to:c.e}), rpc('ads_campaign_totals',{p_platform:'google',p_from:c.s,p_to:c.e}),
    ads('meta',r.s,r.e), ads('google',r.s,r.e), cmp?ads('meta',c.s,c.e):none, cmp?ads('google',c.s,c.e):none]);
  $('caBody').style.opacity='';
  const bad=[res[0],res[3],res[4],res[5],res[6]].filter(function(x){ return x.error; })[0];
  if(bad){ $('caBody').innerHTML='<div class="card card-pad" style="color:#b91c1c">Could not load: '+esc(bad.error.message)+'</div>'; return; }
  const acc={}; (res[0].data||[]).forEach(function(a){ acc[a.platform+':'+a.account_id]={project:a.project||a.name||a.account_id,name:a.name}; });
  const ent={}; res[1].concat(res[2]).forEach(function(x){ ent[x.kind+':'+x.id]=x; });
  const tag=function(p,rows){ return (rows||[]).filter(function(c){ return acc[p+':'+c.account_id]; }).map(function(c){ return Object.assign({platform:p,project:acc[p+':'+c.account_id].project},c); }); };
  // Daily budget set today (7 Nov 2026, Ayush): the daily budgets of the running campaigns, per project and platform.
  // A Facebook campaign without its own budget carries its running ad sets' budgets (ads-daily-sync).
  const bud={};
  [['meta',res[1]],['google',res[2]]].forEach(function(x){ x[1].forEach(function(e){
    const a=acc[x[0]+':'+e.account_id]; if(e.kind!=='campaign'||!a||!caLive(e.status)||e.daily_budget==null) return;
    const k=a.project+'|'+x[0]; bud[k]=(bud[k]||0)+(+e.daily_budget||0); }); });
  CA_D={acc:acc,ent:ent,bud:bud,cur:tag('meta',res[3].data).concat(tag('google',res[4].data)),prev:tag('meta',res[5].data).concat(tag('google',res[6].data)),
        ads:tag('meta',res[7].rows).concat(tag('google',res[8].rows)),hasSets:res[7].sets&&res[8].sets,
        cmp:cmp?{s:c.s,e:c.e,ads:tag('meta',res[9].rows).concat(tag('google',res[10].rows))}:null};
  caPaint();
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
  const r=obRange(), P=caProjects(), E=CA_D.ent; window._caP=P;
  if(CA.proj!=='all'&&P.indexOf(CA.proj)===-1) CA.proj='all';
  const C=CA.cmp, same=caCmpSame(), cmpOn=C.on&&!same&&!!CA_D.cmp, cr=C.on?caCmpRange():null;
  // a select whose one option (the other side's choice) cannot be picked - "Custom" stays open on both, its dates are checked
  const sel=function(id,list,cur,onch,off){ return '<select class="comp-sel" id="'+id+'" onchange="'+onch+'">'+list.map(function(o){
    const dis=off&&off!=='custom'&&o[0]===off; return '<option value="'+o[0]+'"'+(String(cur)===String(o[0])?' selected':'')+(dis?' disabled':'')+'>'+esc(o[1])+(dis?' (chosen on the other side)':'')+'</option>'; }).join('')+'</select>'; };
  $('caHead').innerHTML='<div class="ob-bar">'
    +sel('caPer',OB_PERIODS,OB_P.period,"OB_P.period=this.value;caReset();caLoad()",C.on?C.period:null)
    +(OB_P.period==='custom'?'<input type="date" value="'+esc(r.s)+'" onchange="OB_P.from=this.value;caLoad()"><span style="color:var(--slate)">to</span><input type="date" value="'+esc(r.e)+'" onchange="OB_P.to=this.value;caLoad()">':'')
    +compSelHtml('caProj',[['all','All projects']].concat(P.map(function(p){ return [p,p]; })),CA.proj,"caPickProject(this.value)")
    +'<label class="ca-sw'+(C.on?' on':'')+'" title="Compare with another period"><input type="checkbox"'+(C.on?' checked':'')+' onchange="caCmpToggle(this.checked)"><span class="k"></span>Compare</label>'
    +(C.on?'<span style="color:var(--slate);font-size:12.5px">with</span>'+sel('caCmpPer',CA_CMP_OPTS,C.period,"caCmpPick(this.value)",OB_P.period)
      +(C.period==='custom'?'<input type="date" value="'+esc(cr.s)+'" onchange="CA.cmp.from=this.value;caLoad()"><span style="color:var(--slate)">to</span><input type="date" value="'+esc(cr.e)+'" onchange="CA.cmp.to=this.value;caLoad()">':''):'')
    +'<span style="font-size:12.5px;color:var(--slate)">'+esc(fmtDate(r.s))+' – '+esc(fmtDate(r.e))
      +(C.on?' <b style="color:#334155">vs</b> '+esc(fmtDate(cr.s))+' – '+esc(fmtDate(cr.e)):' · Google and Facebook together')+'</span></div>'
    +(C.on&&same?'<div class="ca-warn"><i class="fa-solid fa-triangle-exclamation"></i> Both sides are the same dates ('+esc(fmtDate(r.s))+' – '+esc(fmtDate(r.e))+'). Pick a different period to compare with.</div>':'');
  if(CA.proj!=='all') CA.open=CA.proj;
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
  // spend, leads (or results), cost per lead, clicks, CTR - the same five columns at every level; t = this period, w = the other
  const cols=function(t,w){ w=w||{};
    return cell(t.spend,w.spend,obMoney,null,true)
      +(cmpOn?cell(t.ln,w.ln,function(x){ return caLeads(x,t.pl); },true).replace('</td>',(t.tag||'')+'</td>'):'<td>'+t.lead+'</td>')
      +cell(t.cpl,w.cpl,obMoney,false)+cell(t.clicks,w.clicks,obNum,true)+cell(t.ctr,w.ctr,obPct,true); };
  const sum=function(rows,pl){ const a=caAgg(rows); return {spend:a.spend,ln:a.leads,pl:pl,lead:caLeads(a.leads,pl),cpl:a.cpl,clicks:a.clicks,ctr:a.ctr}; };
  const raw=function(x,pl,lead){ x=x||{}; const s=+x.spend||0, rr=+x.results||0, tag=lead===false?' <span class="tag t-gray" style="font-size:10px">not leads</span>':'';
    return {spend:s,ln:rr,pl:pl==='google'?'google':'meta',tag:tag,lead:obNum(rr,pl==='google'?1:0)+tag,cpl:rr?s/rr:null,clicks:+x.clicks||0,ctr:+x.impressions?x.clicks/x.impressions*100:null}; };
  const prev=CA_D.prev||[];
  /* A PLATFORM'S SECTION (6 Nov 2026, Ayush): its running campaigns in a section of their own, under the whole
     projects table - the page scrolls to it on the click, as at the foot of the page it otherwise sat unseen; a campaign opens its running ad sets inside it, and the ads
     follow whatever is open. Paused, ended and deleted ones are left out here - their spend still counts above.
     7 Nov 2026: a Total row under the campaigns - all the listed campaigns together. */
  const section=function(){
    const p=CA.open, pl=CA.plat, W=CA_PLAT[pl];
    const camps=CA_D.cur.filter(function(c){ return c.project===p&&c.platform===pl&&caLive((E['campaign:'+c.campaign_id]||{}).status)&&((+c.spend||0)>0||(+c.results||0)>0); }).sort(function(a,b){ return b.spend-a.spend; });
    const was=function(id){ return prev.filter(function(x){ return x.platform===pl&&x.campaign_id===id; }); };
    const setsOf=function(list,cid){ const g={}; list.forEach(function(a){ if(a.platform!==pl||a.campaign_id!==cid||!a.adset_id) return; const x=g[a.adset_id]||(g[a.adset_id]={adset_id:a.adset_id,spend:0,results:0,clicks:0,impressions:0}); x.spend+=+a.spend||0; x.results+=+a.results||0; x.clicks+=+a.clicks||0; x.impressions+=+a.impressions||0; }); return g; };
    let sec='';
    camps.forEach(function(c){
      const e=E['campaign:'+c.campaign_id]||{}, con=CA.camp===c.campaign_id, lead=pl==='meta'?obIsLead(E,c):null;
      sec+='<tr class="ca-row ca-l0'+(con?' ca-on':'')+'" onclick="caCamp(\''+c.campaign_id+'\')"><td style="white-space:normal">'+caret(con)+esc(e.name||c.campaign_id)+'</td>'+cols(raw(c,pl,lead),raw(was(c.campaign_id)[0],pl,lead))+'</tr>';
      if(!con) return;
      const ads=CA_D.ads.filter(function(a){ return a.platform===pl&&a.campaign_id===c.campaign_id; });
      if(!CA_D.hasSets||!ads.some(function(a){ return a.adset_id; })){
        sec+='<tr class="ca-l1 ca-none"><td colspan="6"><i class="fa-solid fa-circle-info"></i> '+W.sets+' are recorded from tonight (6 Nov 2026) and show here from tomorrow.</td></tr>'; return; }
      const g=setsOf(ads,c.campaign_id), gw=cmpOn?setsOf(CA_D.cmp.ads,c.campaign_id):{};
      const sets=Object.keys(g).filter(function(k){ return caLive((E['adset:'+k]||{}).status); }).map(function(k){ return g[k]; }).sort(function(a,b){ return b.spend-a.spend; });
      if(!sets.length) sec+='<tr class="ca-l1 ca-none"><td colspan="6">No running '+W.set.toLowerCase()+' in this campaign</td></tr>';
      sets.forEach(function(s){
        const son=CA.adset===s.adset_id;
        sec+='<tr class="ca-row ca-l1'+(son?' ca-on':'')+'" onclick="caSet(\''+s.adset_id+'\')"><td style="white-space:normal">'+esc((E['adset:'+s.adset_id]||{}).name||s.adset_id)+'</td>'+cols(raw(s,pl,null),raw(gw[s.adset_id],pl,null))+'</tr>';
      });
    });
    // the total counts leads only (Google conversions, Facebook lead / chat campaigns), as reach or engagement results cannot be added to them
    const ids={}; camps.forEach(function(c){ ids[c.campaign_id]=1; });
    const tot=camps.length?'<tfoot><tr class="ca-tot"><td>Total · '+camps.length+' campaign'+(camps.length===1?'':'s')+(pl==='meta'?' <span style="font-weight:500;color:var(--slate);font-size:11px">(leads only)</span>':'')+'</td>'
      +cols(sum(camps,pl),sum(prev.filter(function(x){ return x.platform===pl&&ids[x.campaign_id]; }),pl))+'</tr></tfoot>':'';
    return '<div class="ca-sec"><div style="padding:11px 14px;font-weight:700;font-size:13.5px;border-bottom:1px solid var(--line)"><i class="'+W.icon+'" style="color:'+W.color+'"></i> '+W.name+' · '+esc(p)
      +' <span style="font-weight:500;color:var(--slate);font-size:12px">- '+camps.length+' running campaign'+(camps.length===1?'':'s')+'; click one for its '+W.sets.toLowerCase()+'</span></div>'
      +'<div style="overflow-x:auto"><table class="ca-tbl"><thead><tr><th>Campaign</th><th>Spend</th><th>'+(pl==='meta'?'Results':W.res)+'</th><th>Cost per result</th><th>Clicks</th><th>CTR</th></tr></thead><tbody>'
      +(sec||'<tr><td colspan="6" style="text-align:center;color:var(--slate);padding:18px">No running campaign spent in this period</td></tr>')+'</tbody>'+tot+'</table></div></div>'
      +caAds(p,pl);
  };
  const shown=CA.proj==='all'?P:[CA.proj];
  const B=CA_D.bud||{};
  const budV=function(p,pl){ return pl?B[p+'|'+pl]:(B[p+'|google']==null&&B[p+'|meta']==null?null:(B[p+'|google']||0)+(B[p+'|meta']||0)); };
  const bud=function(v){ return '<td>'+(v==null?'<span style="color:#94a3b8">—</span>':obMoney(v))+'</td>'; };
  let rows='';
  shown.forEach(function(p){
    const cur=CA_D.cur.filter(function(c){ return c.project===p; }), pw=prev.filter(function(c){ return c.project===p; }), on=CA.open===p;
    rows+='<tr class="ca-row ca-l0'+(on?' ca-on':'')+'" onclick="caToggle('+P.indexOf(p)+')"><td>'+caret(on)+esc(p)+'</td>'+bud(budV(p))+cols(sum(cur),sum(pw))+'</tr>';
    if(!on) return;
    ['google','meta'].forEach(function(pl){
      const W=CA_PLAT[pl], pc=cur.filter(function(c){ return c.platform===pl; }), pon=CA.plat===pl;
      const has=Object.keys(CA_D.acc).some(function(k){ return k.indexOf(pl+':')===0&&CA_D.acc[k].project===p; });
      if(!has){ rows+='<tr class="ca-l1 ca-none"><td><span class="ca-caret"></span><i class="'+W.icon+'" style="color:'+W.color+'"></i> '+W.name+'</td><td colspan="6">No '+W.name+' account for this project</td></tr>'; return; }
      // no caret: Google / Facebook do not open in the table, a click shows their section below (6 Nov 2026)
      rows+='<tr class="ca-row ca-l1'+(pon?' ca-on':'')+'" onclick="caPlat(\''+pl+'\')"><td><span class="ca-caret"></span><i class="'+W.icon+'" style="color:'+W.color+'"></i> '+W.name+'</td>'+bud(budV(p,pl))+cols(sum(pc,pl),sum(pw.filter(function(c){ return c.platform===pl; }),pl))+'</tr>';
    });
  });
  // 7 Nov 2026: the overall Total under the projects - every project shown, Google and Facebook together
  const inP={}; shown.forEach(function(p){ inP[p]=1; });
  const tb=shown.reduce(function(s,p){ const v=budV(p); return v==null?s:(s||0)+v; },null);
  const foot=shown.length>1||CA.proj==='all'?'<tfoot><tr class="ca-tot"><td>Total</td>'+bud(tb)
    +cols(sum(CA_D.cur.filter(function(c){ return inP[c.project]; })),sum(prev.filter(function(c){ return inP[c.project]; })))+'</tr></tfoot>':'';
  let html='<div class="card" style="overflow-x:auto"><table class="ca-tbl"><thead><tr><th>Project</th><th title="Daily budgets of the running campaigns, as set today">Daily budget</th><th>Spend</th><th>Leads</th><th>Cost per lead</th><th>Clicks</th><th>CTR</th></tr></thead><tbody>'
    +(rows||'<tr><td colspan="7" style="text-align:center;color:var(--slate);padding:24px">No ad accounts</td></tr>')+'</tbody>'+foot+'</table></div>';
  // the open platform's campaigns, ad sets and ads come under the whole projects table, and the page
  // scrolls down to them (caPlat) so they are seen
  if(CA.open&&CA.plat) html+='<div class="ca-below" id="caBelow">'+section()+'</div>';
  html+='<div style="font-size:11.5px;color:var(--slate);margin:12px 2px 4px;line-height:1.5">Leads = Google conversions + Facebook leads and WhatsApp chats from lead campaigns. Below a project, each row shows its own Results (Facebook awareness or engagement campaigns are marked "not leads"). Daily budget is as set today'+(cmpOn?'; in Compare mode it is not compared':'')+'. Figures are Google Ads\' and Meta\'s own, refreshed through the day.</div>';
  $('caBody').innerHTML=html;
}
window.caCmpToggle=function(on){ CA.cmp.on=!!on;
  // the default other side: the previous period, unless that is what the main side already is
  if(on&&CA.cmp.period!=='custom'&&CA.cmp.period===OB_P.period) CA.cmp.period='prev';
  caLoad(); };
window.caCmpPick=function(v){ CA.cmp.period=v; if(v==='custom'&&!CA.cmp.from){ const r=obRange(); CA.cmp.from=r.ps; CA.cmp.to=r.pe; } caLoad(); };
// The ads of what is open: every campaign of the platform, one campaign, or one ad set.
function caAds(p,pl){
  const W=CA_PLAT[pl], E=CA_D.ent;
  let ads=CA_D.ads.filter(function(a){ return a.project===p&&a.platform===pl&&caLive((E['ad:'+a.ad_id]||{}).status)&&caLive((E['campaign:'+a.campaign_id]||{}).status)&&(!a.adset_id||caLive((E['adset:'+a.adset_id]||{}).status)); });
  if(CA.camp) ads=ads.filter(function(a){ return a.campaign_id===CA.camp; });
  if(CA.adset) ads=ads.filter(function(a){ return a.adset_id===CA.adset; });
  const where=CA.adset?(E['adset:'+CA.adset]||{}).name||W.set:CA.camp?(E['campaign:'+CA.camp]||{}).name||'this campaign':'all '+W.name+' campaigns';
  const stat=function(s){ s=String(s||''); const on=s==='ACTIVE'||s==='ENABLED'; return '<span class="tag '+(on?'t-green':'t-gray')+'" style="font-size:10.5px">'+(on?'Running':s?s.charAt(0)+s.slice(1).toLowerCase().replace(/_/g,' '):'—')+'</span>'; };
  const shown=ads.slice(0,CA.showAds);
  let h='<div style="font-weight:700;font-size:13.5px;margin:16px 2px 10px"><i class="'+W.icon+'" style="color:'+W.color+'"></i> Ads <span style="font-weight:500;color:var(--slate);font-size:12px">- '+ads.length+' that ran in this period · '+esc(p)+' · '+esc(where)+'</span></div>';
  if(!ads.length) return h+'<div style="font-size:12.5px;color:var(--slate);margin:0 2px">No ad ran here in this period.</div>';
  window._caAds=shown;
  return h+'<div class="ob-ads">'+shown.map(function(a,i){
      const e=E['ad:'+a.ad_id]||{}, words=String(e.body||e.name||('Ad '+a.ad_id)).split('\n');
      const pic=e.thumbnail?'<div class="pic"><img src="'+esc(e.thumbnail)+'" loading="lazy" referrerpolicy="no-referrer" alt=""></div>'
        :'<div class="txt">'+(pl==='google'?'<div class="sp">Sponsored</div>':'')+'<div class="h">'+esc(words[0])+'</div>'+(words[1]?'<div class="d">'+esc(words.slice(1).join(' '))+'</div>':'')+'</div>';
      return '<div class="ob-ad" style="cursor:pointer" title="Open this ad" onclick="caAdOpen('+i+')">'+pic+'<div style="padding:9px 12px 0;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(e.name||'')+'">'+esc(e.name||('Ad '+a.ad_id))+'</div>'
        +'<div style="padding:0 12px;font-size:11.5px;color:var(--slate)">'+stat(e.status)+'</div>'
        +'<div class="m"><span>Spend</span><b>'+obMoney(a.spend)+'</b><span>'+(pl==='meta'?'Results':W.res)+'</span><b>'+obNum(a.results,pl==='google'?1:0)+'</b><span>Cost per result</span><b>'+obMoney(+a.results?a.spend/a.results:null)+'</b><span>CTR</span><b>'+obPct(+a.impressions?a.clicks/a.impressions*100:null)+'</b></div></div>';
    }).join('')+'</div>'
    +(ads.length>shown.length?'<div style="text-align:center;margin:14px 0"><button class="btn" onclick="CA.showAds+='+obAdStep(ads.length)+';caPaint()">Show more ('+shown.length+' of '+ads.length+')</button></div>':'');
}
/* AN AD, OPENED (7 Nov 2026, Ayush: "the Ads which show if clicked should open nicely in a popup").
   The picture full size on the left (or the text ad as Google shows it), on the right where it runs
   and its figures for the period. */
window.caAdOpen=function(i){
  const a=(window._caAds||[])[i]; if(!a) return;
  const pl=a.platform, W=CA_PLAT[pl], E=CA_D.ent, e=E['ad:'+a.ad_id]||{};
  const camp=(E['campaign:'+a.campaign_id]||{}).name||a.campaign_id, set=a.adset_id?((E['adset:'+a.adset_id]||{}).name||a.adset_id):null;
  const words=String(e.body||'').split('\n').filter(Boolean);
  const s=+a.spend||0, rr=+a.results||0, im=+a.impressions||0, cl=+a.clicks||0;
  const on=caLive(e.status);
  const pic=e.thumbnail
    ?'<div style="background:#0f172a;border-radius:10px;display:flex;align-items:center;justify-content:center;overflow:hidden;min-height:260px"><img src="'+esc(e.thumbnail)+'" referrerpolicy="no-referrer" alt="" style="max-width:100%;max-height:70vh;display:block"></div>'
    :'<div style="border:1px solid var(--line);border-radius:10px;padding:16px 18px;background:#fff">'+(pl==='google'?'<div style="font-size:11px;font-weight:700;color:#202124;margin-bottom:4px">Sponsored</div>':'')
      +'<div style="font-size:17px;color:#1a0dab;line-height:1.35;margin-bottom:6px">'+esc(words[0]||e.name||('Ad '+a.ad_id))+'</div>'
      +(words.length>1?'<div style="font-size:13px;color:#4d5156;line-height:1.5">'+esc(words.slice(1).join(' '))+'</div>':'')+'</div>';
  const row=function(k,v){ return '<div style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #eef1f4;font-size:13px"><span style="color:var(--slate)">'+k+'</span><b style="font-variant-numeric:tabular-nums">'+v+'</b></div>'; };
  const r=obRange();
  openModal('<div class="modal-head"><h3 style="display:flex;align-items:center;gap:8px;min-width:0"><i class="'+W.icon+'" style="color:'+W.color+'"></i><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(e.name||('Ad '+a.ad_id))+'</span></h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body"><div style="display:grid;grid-template-columns:minmax(0,1.25fr) minmax(240px,1fr);gap:20px;align-items:start" class="ca-adpop">'
    +'<div>'+pic+(e.thumbnail&&words.length?'<div style="font-size:13px;line-height:1.55;color:#334155;margin-top:12px;white-space:pre-wrap">'+esc(words.join('\n'))+'</div>':'')+'</div>'
    +'<div><div style="margin-bottom:12px"><span class="tag '+(on?'t-green':'t-gray')+'" style="font-size:11px">'+(on?'Running':esc(String(e.status||'—').charAt(0)+String(e.status||'').slice(1).toLowerCase().replace(/_/g,' ')))+'</span></div>'
    +'<div style="font-size:12px;color:var(--slate);margin-bottom:2px">Project</div><div style="font-size:13px;font-weight:600;margin-bottom:10px">'+esc(a.project)+'</div>'
    +'<div style="font-size:12px;color:var(--slate);margin-bottom:2px">Campaign</div><div style="font-size:13px;font-weight:600;margin-bottom:10px">'+esc(camp)+'</div>'
    +(set?'<div style="font-size:12px;color:var(--slate);margin-bottom:2px">'+W.set+'</div><div style="font-size:13px;font-weight:600;margin-bottom:14px">'+esc(set)+'</div>':'')
    +'<div style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--slate);margin:6px 0 2px">'+esc(fmtDate(r.s))+' – '+esc(fmtDate(r.e))+'</div>'
    +row('Spend',obMoney(s))+row(pl==='meta'?'Results':W.res,obNum(rr,pl==='google'?1:0))+row('Cost per result',obMoney(rr?s/rr:null))
    +row('Impressions',obNum(im))+row('Clicks',obNum(cl))+row('CTR',obPct(im?cl/im*100:null))
    +'</div></div></div>'
    +'<style>@media(max-width:760px){.ca-adpop{grid-template-columns:1fr!important}}</style>','lg');
};
function caReset(){ CA.open=CA.proj==='all'?null:CA.proj; CA.plat=null; CA.camp=null; CA.adset=null; CA.showAds=12; }
window.caPickProject=function(v){ CA.proj=v; CA.open=v==='all'?null:v; CA.plat=null; CA.camp=null; CA.adset=null; CA.showAds=12; caPaint(); };
window.caToggle=function(i){ const p=window._caP[i]; CA.open=CA.open===p?null:p; CA.plat=null; CA.camp=null; CA.adset=null; CA.showAds=12; caPaint(); };
window.caPlat=function(p){ CA.plat=CA.plat===p?null:p; CA.camp=null; CA.adset=null; CA.showAds=12; caPaint();
  requestAnimationFrame(function(){ const s=$('caBelow'); if(s) s.scrollIntoView({block:'start'}); }); };
window.caCamp=function(id){ CA.camp=CA.camp===id?null:id; CA.adset=null; CA.showAds=12; caPaint(); };
window.caSet=function(id){ CA.adset=CA.adset===id?null:id; CA.showAds=12; caPaint(); };
window.caUp=function(level){ if(level<=0){ CA.plat=null; } if(level<=1) CA.camp=null; CA.adset=null; CA.showAds=12; caPaint(); };

