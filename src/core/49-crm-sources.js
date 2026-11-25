
/* ============================ CAMPAIGN ANALYTICS - SOURCES (19 Nov 2026) ============================
   Ayush: "Yes build the Sources view". What every lead source produced in the CRM - not just the ads: Online (Facebook,
   Google ...), Agent, Walk In, Hoarding, Other Project Campaign, Reference ... - as Qualified, Site visits, Revisits,
   Booked and Lost, for the dates chosen.
   Data: camp.crm_source_daily, the CRM's source_wise_absolute_api read one day at a time at night (ads-daily-sync
   {srcwise}). Each row is one node of the CRM's source tree (category > source > campaign > ad set > ad) on one day;
   tot_* is the node with everything under it, so a period is the days added up.
   The page: the period (as on the Campaigns tab) and a project; five figures across the top; "By source" - every
   top-level source over the projects shown; "By project" - each project opening into its sources, and each source into
   its campaigns, ad sets and ads, as deep as the CRM goes.
   20 Nov: "the dropdown is not good ... I want two dropdowns to compare the range" - the period and project are
   button pickers (as on the Campaigns tab); Compare sets Range A against Range B, each its own period or dates (B can
   also be the period just before A); the same choice cannot be made on both sides. */
let SRC={period:'last_30d',from:'',to:'',bper:'prev',bfrom:'',bto:'',proj:'all',cmp:false,pop:null,open:{},data:null,prev:null,busy:false};
const SRC_BOPTS=[['prev','Period before A']].concat(OB_PERIODS);
const SRC_CSS='<style>'
  +'.src-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 14px}'
  +'.src-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin:0 0 16px}@media(max-width:900px){.src-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}'
  +'.src-k{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 14px}.src-k .l{font-size:11px;font-weight:700;color:var(--slate);text-transform:uppercase;letter-spacing:.4px}'
  +'.src-k .v{font-size:22px;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums}.src-k .c{font-size:11.5px;margin-top:2px;color:var(--slate)}'
  +'.src-t{width:100%;border-collapse:collapse;font-size:13px}.src-t th{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--slate);background:#f8fafc;padding:9px 12px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}'
  +'.src-t th:first-child,.src-t td:first-child{text-align:left}.src-t td{padding:9px 12px;border-bottom:1px solid #eef1f4;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}'
  +'.src-t tr.on>td{background:#eef4ff}.src-t tr.op{cursor:pointer}.src-t tr.op:hover>td{background:#f8fafc}'
  +'.src-t td.nm{white-space:normal;max-width:420px}.src-t .car{color:#94a3b8;font-size:11px;width:14px;display:inline-block}'
  +'.src-t tr.tot td{font-weight:800;background:#f1f5f9;border-top:2px solid #cbd5e1}'
  +'.src-cmp{font-size:11px;color:#94a3b8;margin-top:1px}.src-cmp .g{color:#15803d;font-weight:700}.src-cmp .b{color:#b91c1c;font-weight:700}'
  +'.src-h{font-weight:800;font-size:14px;margin:18px 2px 8px}.src-note{font-size:11.5px;color:var(--slate);margin:10px 2px;line-height:1.5}'
  +'</style>';
// Leads added 23 Nov 2026 (Ayush: "Yes, add Leads") - the CRM report now carries a lead count for every source
const SRC_K=[['l','Leads',true],['q','Qualified',true],['sv','Site visits',true],['rv','Revisits',true],['bk','Booked',true],['lost','Lost',false]];
function srcRangeOf(p,f,t){ const keep=OB_P; OB_P=Object.assign({},OB_P,{period:p,from:f,to:t}); try{ return obRange(); } finally{ OB_P=keep; } }
function srcRange(){ return srcRangeOf(SRC.period,SRC.from,SRC.to); }
// Range B: its own period or dates, or the same number of days just before A
function srcRangeB(){ const a=srcRange(); if(SRC.bper==='prev') return {s:a.ps,e:a.pe}; const b=srcRangeOf(SRC.bper,SRC.bfrom,SRC.bto); return {s:b.s,e:b.e}; }
function srcSame(){ const a=srcRange(), b=srcRangeB(); return a.s===b.s&&a.e===b.e; }
// a button that opens a list - the Campaigns tab's period picker, for the Sources tab
function srcPicker(id,opts,cur,pick,off,tag){
  const open=SRC.pop===id, c=opts.filter(function(o){ return String(o[0])===String(cur); })[0];
  const item=function(o){ const dis=off!=null&&off!=='custom'&&String(o[0])===String(off), sel=String(o[0])===String(cur);
    return '<button type="button"'+(dis?' disabled title="Chosen on the other side"':'')+' onclick="'+pick+'('+esc(JSON.stringify(String(o[0])))+')" style="display:block;width:100%;text-align:left;border:0;background:'+(sel?'#eef4ff':'transparent')+';color:'+(dis?'#cbd5e1':sel?'#1d4ed8':'var(--ink)')+';font:inherit;font-size:13px;font-weight:'+(sel?700:500)+';padding:7px 10px;border-radius:6px;cursor:'+(dis?'not-allowed':'pointer')+';white-space:nowrap">'+esc(o[1])+'</button>'; };
  return '<span onclick="event.stopPropagation()" style="position:relative;display:inline-block"><button type="button" onclick="srcPop(\''+id+'\')" style="height:36px;padding:0 11px;border:1px solid '+(open?'#93c5fd':'var(--line)')+';border-radius:9px;font:inherit;font-size:13px;font-weight:600;background:var(--bg-card);color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;gap:8px;white-space:nowrap">'
    +(tag?'<span style="font-size:10.5px;font-weight:800;color:#fff;background:'+(tag==='A'?'#2563eb':'#7c3aed')+';border-radius:5px;padding:1px 6px">'+tag+'</span>':'')
    +esc(c?c[1]:'Choose')+' <i class="fa-solid fa-chevron-'+(open?'up':'down')+'" style="font-size:10px;color:var(--slate)"></i></button>'
    +(open?'<div style="position:absolute;left:0;top:calc(100% + 4px);z-index:40;background:var(--bg-card,#fff);border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(15,23,42,.14);padding:6px;min-width:170px;max-height:340px;overflow-y:auto">'+opts.map(item).join('')+'</div>':'')+'</span>';
}
function srcDates(r,fk,tk){ return '<input type="date" value="'+esc(r.s)+'" onchange="SRC.'+fk+'=this.value;srcLoad()" style="height:36px"><span style="color:var(--slate)">to</span><input type="date" value="'+esc(r.e)+'" onchange="SRC.'+tk+'=this.value;srcLoad()" style="height:36px">'; }
window.srcPop=function(id){ SRC.pop=SRC.pop===id?null:id; srcPaint(); };
window.srcPickA=function(v){ SRC.pop=null; if(v===SRC.period){ srcPaint(); return; } SRC.period=v; srcLoad(); };
window.srcPickB=function(v){ SRC.pop=null; if(v===SRC.bper){ srcPaint(); return; } SRC.bper=v; srcLoad(); };
window.srcPickP=function(v){ SRC.pop=null; SRC.proj=v; srcPaint(); };
window.srcCmp=function(on){ SRC.cmp=on; if(on&&SRC.bper===SRC.period&&SRC.bper!=='custom') SRC.bper='prev'; srcLoad(); };
if(!window._srcDoc){ window._srcDoc=true; document.addEventListener('click',function(){ if(SRC.pop){ SRC.pop=null; srcPaint(); } }); }
async function srcRows(s,e){
  const out=[]; for(let f=0;;f+=1000){
    const cols='bu_id,business_unit,node_id,parent_id,level,top_source,source,tot_q,tot_sv,tot_rv,tot_bk,tot_lost';
    let q=await sb.schema('camp').from('crm_source_daily').select(cols+',tot_leads').gte('day',s).lte('day',e).range(f,f+999);
    if(q.error&&/tot_leads/.test(q.error.message)) q=await sb.schema('camp').from('crm_source_daily').select(cols).gte('day',s).lte('day',e).range(f,f+999);   // before the leads column exists
    if(q.error) return {error:q.error}; out.push.apply(out,q.data||[]); if(!q.data||q.data.length<1000) break; }
  // the period: each project's node added up over the days
  const by={};
  out.forEach(function(r){ const k=r.bu_id+'|'+r.node_id; const x=by[k]||(by[k]={bu:r.bu_id,project:r.business_unit,id:r.node_id,parent:r.parent_id,level:r.level,top:r.top_source,name:r.source,l:0,q:0,sv:0,rv:0,bk:0,lost:0});
    x.l+=r.tot_leads||0; x.q+=r.tot_q; x.sv+=r.tot_sv; x.rv+=r.tot_rv; x.bk+=r.tot_bk; x.lost+=r.tot_lost; });
  return {nodes:by,days:new Set(out.map(function(r){ return r.day; })).size};
}
async function srcView(host){
  host.innerHTML=SRC_CSS+'<div id="srcHead"></div><div id="srcBody"><div class="loader"><div class="spin"></div></div></div>';
  await srcLoad();
}
async function srcLoad(){
  const r=srcRange();
  if($('srcBody')&&SRC.data) $('srcBody').style.opacity='.55';
  const rb=srcRangeB();
  const [a,b]=await Promise.all([srcRows(r.s,r.e), SRC.cmp?srcRows(rb.s,rb.e):Promise.resolve({nodes:{}})]);
  if($('srcBody')) $('srcBody').style.opacity='';
  if(a.error){ SRC.data=null; srcPaint(a.error.message); return; }
  SRC.data=a; SRC.prev=b.error?null:b; srcPaint();
}
function srcPaint(err){
  const head=$('srcHead'), body=$('srcBody'); if(!head||!body) return;
  const r=srcRange();
  const projects=SRC.data?[...new Set(Object.keys(SRC.data.nodes).map(function(k){ return SRC.data.nodes[k].project; }))].sort():[];
  const rb=srcRangeB(), same=SRC.cmp&&srcSame();
  head.innerHTML='<div class="src-bar">'
    +srcPicker('proj',[['all','All projects']].concat(projects.map(function(p){ return [p,p]; })),SRC.proj,'srcPickP')
    +srcPicker('a',OB_PERIODS,SRC.period,'srcPickA',SRC.cmp?SRC.bper:null,SRC.cmp?'A':'')
    +(SRC.period==='custom'?srcDates(r,'from','to'):'')
    +'<label class="ca-sw'+(SRC.cmp?' on':'')+'" title="Compare two date ranges"><input type="checkbox"'+(SRC.cmp?' checked':'')+' onchange="srcCmp(this.checked)"><span class="k"></span>Compare</label>'
    +(SRC.cmp?'<b style="color:#334155;font-size:12.5px">vs</b>'+srcPicker('b',SRC_BOPTS,SRC.bper,'srcPickB',SRC.period,'B')+(SRC.bper==='custom'?srcDates(rb,'bfrom','bto'):''):'')
    +'</div><div style="font-size:12.5px;color:var(--slate);margin:-6px 2px 12px">'
    +(SRC.cmp?'<b style="color:#2563eb">A</b> '+esc(fmtDate(r.s))+' – '+esc(fmtDate(r.e))+' &nbsp;<b style="color:#334155">vs</b>&nbsp; <b style="color:#7c3aed">B</b> '+esc(fmtDate(rb.s))+' – '+esc(fmtDate(rb.e))+' · the small grey figure under each number is B'
      +(same?' <span style="color:#b91c1c;font-weight:700"> · A and B are the same dates - choose different ones</span>':'')
      :esc(fmtDate(r.s))+' – '+esc(fmtDate(r.e))+' · from the CRM')+'</div>';
  if(err){ body.innerHTML=/crm_source_daily|does not exist|schema cache/i.test(err)
      ?'<div class="card card-pad" style="color:var(--slate)"><i class="fa-solid fa-moon"></i> The CRM\'s source figures are read at night - they show here from tomorrow morning.</div>'
      :'<div class="card card-pad" style="color:#b91c1c">Could not load: '+esc(err)+'</div>'; return; }
  const N=SRC.data.nodes, P=(SRC.prev&&SRC.prev.nodes)||{};
  const inP=function(x){ return SRC.proj==='all'||x.project===SRC.proj; };
  const keys=Object.keys(N).filter(function(k){ return inP(N[k]); });
  const zero=function(x){ return !(x.l||x.q||x.sv||x.rv||x.bk||x.lost); };
  const add=function(t,x){ SRC_K.forEach(function(k){ t[k[0]]+=(x&&x[k[0]])||0; }); return t; };
  const blank=function(){ return {l:0,q:0,sv:0,rv:0,bk:0,lost:0}; };
  const pct=function(a,b){ return b?Math.round(a/b*100)+'%':'—'; };
  const chg=function(now,was,goodUp){ if(!SRC.cmp) return ''; let c=''; if(was){ const p=(now-was)/was*100; c=Math.abs(p)<0.5?'=':'<span class="'+((p>0)===goodUp?'g':'b')+'">'+(p>0?'▲':'▼')+Math.abs(p).toFixed(0)+'%</span>'; } else if(now) c='<span class="'+(goodUp?'g':'b')+'">new</span>';
    return '<div class="src-cmp">'+obNum(was||0)+' '+c+'</div>'; };
  const cells=function(t,w){ w=w||blank(); return SRC_K.map(function(k){ return '<td>'+(k[0]==='q'||k[0]==='bk'?'<b>':'')+obNum(t[k[0]])+(k[0]==='q'||k[0]==='bk'?'</b>':'')+chg(t[k[0]],w[k[0]],k[2])+'</td>'; }).join('')
    +'<td>'+pct(t.sv,t.q)+'</td><td>'+pct(t.bk,t.sv)+'</td>'; };
  const thead=function(first){ return '<thead><tr><th>'+first+'</th>'+SRC_K.map(function(k){ return '<th>'+k[1]+'</th>'; }).join('')+'<th title="Site visits as a share of Qualified">QL to SV %</th><th title="Booked as a share of Site visits">SV to Booked %</th></tr></thead>'; };
  // the totals: every project's top-level sources
  const tops=keys.filter(function(k){ return N[k].level===0; });
  const T=tops.reduce(function(t,k){ return add(t,N[k]); },blank());
  const TW=Object.keys(P).filter(function(k){ return P[k].level===0&&inP(P[k]); }).reduce(function(t,k){ return add(t,P[k]); },blank());
  let h='<div class="src-kpis">'+SRC_K.map(function(k){ return '<div class="src-k"><div class="l">'+k[1]+'</div><div class="v">'+obNum(T[k[0]])+'</div>'+(SRC.cmp?'<div class="c">'+chg(T[k[0]],TW[k[0]],k[2]).replace('src-cmp','')+'</div>':'')+'</div>'; }).join('')+'</div>';
  // BY SOURCE: each top-level source over the projects shown
  const bySrc={}, bySrcW={};
  tops.forEach(function(k){ const x=N[k]; add(bySrc[x.name]||(bySrc[x.name]=blank()),x); });
  Object.keys(P).forEach(function(k){ const x=P[k]; if(x.level===0&&inP(x)) add(bySrcW[x.name]||(bySrcW[x.name]=blank()),x); });
  const srcNames=Object.keys(bySrc).filter(function(n){ return !zero(bySrc[n]); }).sort(function(a,b){ return bySrc[b].q-bySrc[a].q||bySrc[b].sv-bySrc[a].sv; });
  h+='<div class="src-h"><i class="fa-solid fa-filter"></i> By source <span style="font-weight:500;color:var(--slate);font-size:12px">- '+(SRC.proj==='all'?'all projects':esc(SRC.proj))+'</span></div>'
    +'<div class="card" style="overflow-x:auto"><table class="src-t">'+thead('Source')+'<tbody>'
    +(srcNames.length?srcNames.map(function(n){ return '<tr><td class="nm"><b>'+esc(n)+'</b></td>'+cells(bySrc[n],bySrcW[n])+'</tr>'; }).join(''):'<tr><td colspan="9" style="text-align:center;color:var(--slate);padding:20px">Nothing in these dates</td></tr>')
    +'</tbody><tfoot><tr class="tot"><td>Total</td>'+cells(T,TW)+'</tr></tfoot></table></div>';
  // BY PROJECT: project > source > campaign > ad set > ad
  const kids={}; keys.forEach(function(k){ const x=N[k]; const pk=x.parent==null?('p:'+x.bu):(x.bu+'|'+x.parent); (kids[pk]||(kids[pk]=[])).push(k); });
  const projT={}; tops.forEach(function(k){ const x=N[k]; add(projT[x.bu]||(projT[x.bu]=Object.assign(blank(),{name:x.project})),x); });
  const projW={}; Object.keys(P).forEach(function(k){ const x=P[k]; if(x.level===0&&inP(x)) add(projW[x.bu]||(projW[x.bu]=blank()),x); });
  const rowsOf=function(pk,depth){ return (kids[pk]||[]).filter(function(k){ return !zero(N[k]); }).sort(function(a,b){ return N[b].q-N[a].q||N[b].sv-N[a].sv; }).map(function(k){
      const x=N[k], has=(kids[k]||[]).some(function(c){ return !zero(N[c]); }), on=!!SRC.open[k];
      return '<tr class="'+(has?'op':'')+(on?' on':'')+'"'+(has?' onclick="srcToggle(\''+k+'\')"':'')+'><td class="nm" style="padding-left:'+(12+depth*20)+'px"><span class="car">'+(has?'<i class="fa-solid fa-chevron-'+(on?'down':'right')+'"></i>':'')+'</span>'+esc(x.name)+'</td>'+cells(x,P[k])+'</tr>'
        +(on?rowsOf(k,depth+1):''); }).join(''); };
  const projIds=Object.keys(projT).filter(function(b){ return !zero(projT[b]); }).sort(function(a,b){ return projT[b].q-projT[a].q; });
  h+='<div class="src-h"><i class="fa-solid fa-building"></i> By project <span style="font-weight:500;color:var(--slate);font-size:12px">- open a project for its sources, a source for its campaigns, ad sets and ads</span></div>'
    +'<div class="card" style="overflow-x:auto"><table class="src-t">'+thead('Project / source')+'<tbody>'
    +(projIds.length?projIds.map(function(b){ const pk='p:'+b, on=!!SRC.open[pk];
        return '<tr class="op'+(on?' on':'')+'" onclick="srcToggle(\''+pk+'\')"><td class="nm"><span class="car"><i class="fa-solid fa-chevron-'+(on?'down':'right')+'"></i></span><b>'+esc(projT[b].name)+'</b></td>'+cells(projT[b],projW[b])+'</tr>'+(on?rowsOf(pk,1):''); }).join('')
      :'<tr><td colspan="9" style="text-align:center;color:var(--slate);padding:20px">Nothing in these dates</td></tr>')
    +'</tbody></table></div>'
    +'<div class="src-note">From the CRM\'s source report (its absolute figures), all lead sources - not only ads. Read every night; today is not included.'+(SRC.data.days?'':' No days read for these dates yet.')+'</div>';
  body.innerHTML=h;
}
window.srcToggle=function(k){ SRC.open[k]=!SRC.open[k]; srcPaint(); };
