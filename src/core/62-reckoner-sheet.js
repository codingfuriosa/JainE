/* =============================================================================================
   RECKONER - THE PAGE (23 Nov 2026, built from the approved Claude Design "Reckoner Design", Ayush).
   Design: "Claude outputs/Reckoner/design/project/Project.dc.html" (canvas https://claude.ai/artifact/EvFMD4CEFqYzzCrqrKKBTC).
     1. every project on one line, scrolling sideways, most qualified leads first
     2. name, place, status  |  one box for search OR a budget ("40 L 2 BHK")  |  pencil (editors), Download, Print icons
     3. first screen: Flats & car parking (prices + big parking tiles + other charges) | Key facts | Offers + Why buy
     4. Location | Amenities | Availability & booking
     5. Flat details, then Nearby (one line per kind of place, nearest first)
   No staff-only notes on this page. No adding or deleting.
   EDIT (pencil, rkCanApprove = super admins + Sales Heads): every changeable value gets a dashed outline and is typed over
   in place; Save sends each changed record through rk.propose + rk.review (so it is in the change history), Cancel drops it.
   Data and the edit form helpers: 60-reckoner.js.
   ============================================================================================= */
const RK_BU={'Dream World City':3,'Dream Exotica':4,'Dream Gurukul':70,'Dream Ananta':171,'Dream Valley':6,'Dream EcoCity':5,'Dream One':2,'Dream Residency Manor':8,'Dream EcoCity Bungalows':68,'Dream Palazzo':7,'Dream Diamond':138};
// qualified leads, last 90 days, read 23 Nov 2026 - used until rk.lead_counts() exists (then read live)
const RK_LEADS_SNAP={3:1125,4:236,70:229,171:147,6:70,5:56,2:50,8:18,68:7,7:4,138:0};
RK.leads=null; RK.cur=null; RK.q=''; RK.edit=false;
const RK_LMORDER=['Connectivity','Metro Station','Railway Station','Airport','School','Hospital','Shopping','Dining','Highway','Landmark'];

const RK4_CSS='<style>'
+'.rk4{font-family:Inter,system-ui,sans-serif;color:#0f172a;display:flex;flex-direction:column;gap:12px}'
+'.rk4-strip{display:flex;flex-wrap:nowrap;gap:2px;background:#e8ecf0;border-radius:10px;padding:3px;overflow-x:auto;scrollbar-width:thin}'
+'.rk4-strip button{border:0;background:transparent;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:600;color:#475569;white-space:nowrap;flex:0 0 auto;cursor:pointer;font-family:inherit}'
+'.rk4-strip button:hover{color:#0f172a}.rk4-strip button.on{background:#fff;color:#0f172a;font-weight:700;box-shadow:0 1px 2px rgba(15,23,42,.12)}.rk4-strip button.empty{color:#94a3b8;font-weight:500}'
+'.rk4-body{display:flex;flex-direction:column;gap:12px}#rk4Bud:empty,#rk4DetSlot:empty{display:none}'
+'.rk4-head{display:flex;align-items:center;gap:10px 12px;flex-wrap:nowrap;min-height:36px;min-width:0}'
+'.rk4-head h1{margin:0;font-size:23px;font-weight:800;letter-spacing:-.02em;white-space:nowrap;flex:0 0 auto}'
+'.rk4-place{color:#475569;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:40px;flex:0 1 auto}'
+'.rk4-fact.av>span:last-child{font-weight:500;color:#0f172a;line-height:1.45}.rk4-fact.av>span:last-child b{font-weight:800;color:#0f766e}'
+'.rk4-fg{margin:10px 0 2px;padding:9px 8px 7px;background:#f0fdfa;border:1px solid #ccfbf1;border-radius:10px;overflow-x:auto}.rk4-fg .cap{font-size:12.5px;font-weight:700;color:#0f766e;margin:0 0 7px;display:flex;align-items:center;gap:6px}'
+'.rk4-fg table{border-collapse:separate;border-spacing:2px;font-size:12px;width:100%;margin:-2px;table-layout:auto}.rk4-fg th,.rk4-fg td{padding:2px 1px;min-width:22px;text-transform:none;letter-spacing:0;text-align:center;white-space:nowrap;border-radius:6px;line-height:1.4}'
+'.rk4-fg th{color:#64748b;font-weight:600;font-size:10.5px}.rk4-fg td{background:#fff;border:1px solid #99f6e4;color:#0f766e;font-weight:800;font-size:13px}.rk4-fg td.no{background:transparent;border-color:transparent;color:#cbd5e1;font-weight:400}'
+'.rk4-fg td:first-child,.rk4-fg th:first-child{text-align:left;background:transparent;border-color:transparent;color:#0f172a;font-weight:700;font-size:12.5px;padding-left:0}'
+'.rk4-fl{display:block;grid-column:1/-1;font-size:12px;color:#0e7490;line-height:1.45;margin-top:-2px}.rk4-fl b{font-weight:700;color:#155e75}.rk4-fl i{font-style:normal;font-weight:700}'
+'.rk4-pnote{font-size:12.5px;color:#0f766e;background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:6px 10px;margin:0 0 8px}'
+'.rk4-fact.hl{background:#f0fdf4;border-radius:8px;padding:6px 8px;margin:2px -8px;border-bottom-color:transparent}.rk4-fact.hl>span:first-child{color:#166534;font-weight:600}.rk4-fact.hl>span:last-child{color:#14532d}'
+'.rk4-strip button.off{opacity:.4;cursor:not-allowed;text-decoration:line-through}'
+'.rk4-badge{background:#dcfce7;color:#166534;font-size:12px;font-weight:700;border-radius:999px;padding:4px 10px;white-space:nowrap}'
+'.rk4-tools{margin-left:auto;display:flex;align-items:center;gap:8px;flex:0 1 auto;min-width:0}'
+'.rk4-q{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #d6dde4;border-radius:9px;padding:0 11px;height:36px;width:250px;min-width:150px;flex:0 1 250px;box-sizing:border-box}'
+'.rk4-q input{border:0;outline:none;font:inherit;font-size:13px;width:100%;background:transparent;color:#0f172a}'
+'.rk4-ib{width:36px;height:36px;flex:0 0 36px;border:1px solid #d6dde4;border-radius:9px;background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#334155;font-size:14px}'
+'.rk4-ib:hover{background:#f8fafc}.rk4-ib.pen{border-color:#0f766e;background:#f0fdfa;color:#0f766e}'
+'.rk4-editbar{margin-left:auto;display:flex;align-items:center;gap:10px}'
+'.rk4-editbar span{font-size:13px;color:#0f766e;font-weight:600}'
+'.rk4-btn{height:36px;padding:0 14px;border:1px solid #d6dde4;border-radius:9px;background:#fff;color:#0f172a;font:inherit;font-size:13px;font-weight:600;cursor:pointer}'
+'.rk4-btn.pri{border:0;background:#0f766e;color:#fff;font-weight:700;padding:0 16px}'
+'.rk4-row{display:grid;gap:12px;align-items:stretch}'
+'.rk4-row.r1{grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr)}'
+'.rk4-row.r2{grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr)}.rk4-row.r2>[data-sec^="amenities"]{grid-column:span 2}'
+'.rk4-stack{display:flex;flex-direction:column;gap:12px;min-width:0}.rk4-stack>section:last-child{flex:1}'
+'.rk4-row>section{display:flex;flex-direction:column;min-width:0}'
+'.rk4-map{display:inline-flex;align-items:center;gap:7px;margin-top:auto;background:#0f766e;color:#fff!important;border-radius:9px;padding:8px 14px;font-size:13px;font-weight:700;text-decoration:none!important;align-self:flex-start}'
+'.rk4-map:hover{background:#115e59}'
+'.rk4-tile.book{background:#eff6ff;border-color:#bfdbfe}.rk4-tile.book .k{color:#1e40af}.rk4-tile .v.sm{font-size:15px;white-space:normal}.rk4-tile .n2{font-size:11.5px;color:#475569;margin-top:1px;line-height:1.3}'
+'.rk4-tile.none{background:#fffbeb;border-color:#fde68a}.rk4-tile.none .k{color:#92400e}'
+'.rk4-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:12px 15px}'
+'.rk4-card h2{margin:0 0 6px;padding:0 0 7px;border-bottom:2px solid #0f766e;font-size:13px;font-weight:800;color:#0f172a;text-transform:uppercase;letter-spacing:.05em}'
+'.rk4-off{background:#fffbeb;border-color:#fde68a}.rk4-off h2{color:#78350f;border-bottom-color:#f59e0b}'
+'.rk4-pt{display:grid;gap:10px;align-items:baseline;padding:7px 0;border-bottom:1px solid #f1f5f9}'
+'.rk4-pt.h{font-size:11.5px;font-weight:700;color:#475569;padding:2px 0 5px;border-bottom:1px solid #e2e8f0}'
+'.rk4-pt .t{font-size:15px;font-weight:700}.rk4-pt .t.rep{font-size:14px;font-weight:600;color:#94a3b8}'
+'.rk4-pt .z{font-size:14px;color:#334155}'
+'.rk4-pt .p{font-size:19px;font-weight:800}.rk4-pt .p.ask{font-size:13.5px;font-weight:600;color:#b45309}'
+'.rk4-pt .s{display:block;font-size:12px;color:#64748b;margin-top:2px;line-height:1.35}'
+'.rk4-pt .w{font-size:15px;font-weight:600;color:#334155}'
+'.rk4-park{margin-top:10px}'
+'.rk4-tiles{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:8px}'
+'.rk4-tile{background:#f0fdfa;border:1px solid #99f6e4;border-radius:11px;padding:8px 12px}'
+'.rk4-tile .k{font-size:12.5px;color:#115e59;font-weight:700}.rk4-tile .v{font-size:22px;font-weight:800;margin-top:2px;white-space:nowrap}'
+'.rk4-nopark{background:#fffbeb;border:1px solid #fde68a;border-radius:11px;padding:10px 12px;font-size:14px;color:#92400e;font-weight:600}'
+'.rk4-chg{display:grid;grid-template-columns:1fr auto;gap:10px;padding:7px 0 0;font-size:13.5px}'
+'.rk4-fact{display:grid;grid-template-columns:104px 1fr;gap:10px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13.5px}'
+'.rk4-reg{display:block;font-size:12px;overflow-wrap:anywhere;letter-spacing:-.02em}'
+'.rk4-fact>span:first-child{color:#64748b}.rk4-fact>span:last-child{font-weight:700;line-height:1.4;overflow-wrap:anywhere;min-width:0}'
+'.rk4-li{display:flex;gap:9px;padding:3px 0;font-size:13.5px;line-height:1.45}'
+'.rk4-li .d{width:6px;height:6px;border-radius:3px;background:#0f766e;margin-top:7px;flex:0 0 6px}'
+'.rk4-li .n{color:#0f766e;font-weight:800;flex:0 0 auto}'
+'.rk4-am{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 10px;font-size:13.5px;margin-top:4px}'
+'.rk4-amt{display:flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;padding:7px 10px;font-weight:600;color:#1e293b}'
+'.rk4-amt>i{color:#0f766e;font-size:11px;flex:0 0 auto}'
+'.rk4-row.r0{grid-template-columns:1fr}.rk4-row.r1b{grid-template-columns:repeat(3,minmax(0,1fr))}'
+'.rk4-cfgs{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:10px;margin-top:4px}'
+'.rk4-cfg{border:1px solid #e2e8f0;border-radius:11px;padding:9px 12px;background:#fcfdfd}'
+'.rk4-cfg .h{font-size:15px;font-weight:800;padding-bottom:6px;border-bottom:1px solid #e2e8f0;margin-bottom:2px;display:flex;flex-direction:column}.rk4-cfg .h>.sz{font-size:12px;font-weight:500;color:#64748b}'
+'.rk4-cfg .r{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:5px 0;border-bottom:1px solid #f1f5f9}.rk4-cfg .r:last-child{border-bottom:0}'
+'.rk4-cfg .z{display:flex;flex-direction:column;line-height:1.3}.rk4-cfg .z>b{font-size:13.5px;color:#0f172a}.rk4-cfg .z>i{font-style:normal;font-size:12px;color:#64748b}'
+'.rk4-tile.long .v{font-size:17px;white-space:nowrap}'
+'.rk4-cfg .lb{display:flex;justify-content:space-between;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#94a3b8;padding:2px 0 1px}.rk4-cfg .r{padding:7px 0}.rk4-cfg{display:flex;flex-direction:column}'
+'.rk4-sub{display:flex;flex-direction:column;gap:3px;margin-top:4px}.rk4-sub>span{position:relative;padding-left:12px;font-size:13px;color:#334155;line-height:1.4}.rk4-sub>span:before{content:"";position:absolute;left:0;top:7px;width:5px;height:5px;border-radius:3px;background:#94a3b8}'
+'.rk4-closes{margin:10px 0 0;border-top:1px solid #f1f5f9;padding-top:6px;display:flex;flex-direction:column}'
+'.rk4-close{display:grid;grid-template-columns:18px 1fr auto;gap:8px;align-items:baseline;font-size:13px;padding:3px 0}.rk4-close>i{color:#0f766e;font-size:12px;text-align:center}.rk4-close>b{font-size:12.5px;color:#0f172a;white-space:nowrap}'
+'.rk4-cfg .xz{font-size:12.5px;color:#475569}.rk4-cfg .p{font-size:16px;font-weight:800;white-space:nowrap}.rk4-cfg .p.ask{font-size:13px;color:#b45309}'
+'.rk4-det{display:grid;grid-template-columns:170px 1fr;gap:12px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13.5px}'
+'.rk4-det>span:last-child{color:#334155;line-height:1.45}'
+'.rk4-nb{display:grid;grid-template-columns:130px 1fr;gap:12px;align-items:start;padding:6px 0;border-bottom:1px solid #f1f5f9}'
+'.rk4-nb>span{font-size:13px;font-weight:700;color:#334155;padding-top:4px}'
+'.rk4-chips{display:flex;flex-wrap:wrap;gap:6px}'
+'.rk4-chip{display:inline-flex;align-items:baseline;gap:6px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:3px 9px;font-size:13px}'
+'.rk4-chip b{color:#0f766e;font-size:12px;white-space:nowrap}'
+'.rk4-none{font-size:14px;color:#64748b}'
+'.rk4-bud{background:#fff;border:1px solid #99f6e4;border-radius:14px;padding:12px 16px}'
+'.rk4-bud h2{margin:0 0 6px;font-size:12px;font-weight:700;color:#0f766e;text-transform:uppercase;letter-spacing:.06em;display:flex;gap:10px}'
+'.rk4-bud .r{display:grid;grid-template-columns:1.2fr 1fr 1fr .8fr 1fr 1.4fr;gap:10px;padding:7px 0;border-bottom:1px solid #f1f5f9;font-size:13.5px;cursor:pointer;align-items:baseline}'
+'.rk4-bud .r:hover{background:#f8fafc}.rk4-bud .r.h{font-size:11.5px;color:#64748b;font-weight:600;cursor:default}'
+'.rk4-hl{background:#fef08a;border-radius:2px}'
+'.rk4-v.on{outline:1.5px dashed #14b8a6;outline-offset:2px;border-radius:4px;background:#f0fdfa;cursor:text;min-width:24px;display:inline-block}'
+'.rk4-v.on:empty:before{content:"add";color:#94a3b8;font-weight:400}'
+'.rk4-v.on:focus{outline-style:solid;background:#fff}'
+'.rk4-v.chg{outline-color:#f59e0b;background:#fffbeb}'
+'.rk4.capturing .rk4-tools,.rk4.capturing .rk4-strip{display:none!important}'
// tablet: two cards a row, Offers and Why buy side by side under them
+'@media(max-width:1100px){.rk4-row.r1{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.rk4-row.r1>.rk4-stack{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.rk4-row.r2{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.rk4-row.r2>[data-sec^="amenities"]{grid-column:span 1}.rk4-row.r1b{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.rk4-cfgs{grid-auto-flow:row;grid-template-columns:repeat(2,minmax(0,1fr))}.rk4-q{width:220px}.rk4-tile .v{font-size:20px}}'
// phone: one column, in the order a call needs it
+'@media(max-width:760px){.rk4-row.r1,.rk4-row.r2,.rk4-row.r1>.rk4-stack{display:flex;flex-direction:column;gap:12px}.rk4-am{grid-template-columns:1fr 1fr}'
+'.rk4-head{flex-wrap:wrap}.rk4-head h1{font-size:20px}.rk4-tools{margin-left:0;width:100%}.rk4-q{flex:1;width:auto}.rk4-editbar{margin-left:0;width:100%;flex-wrap:wrap}'
+'.rk4-pt{grid-template-columns:1fr 1fr 1.3fr!important}.rk4-pt .w,.rk4-pt.h>span:nth-child(4){display:none}.rk4-tile .v{font-size:18px}'
+'.rk4-nb,.rk4-det{grid-template-columns:1fr;gap:4px}.rk4-nb>span{padding-top:0}.rk4-fact{grid-template-columns:96px 1fr}.rk4-bud .r{grid-template-columns:1fr 1fr 1fr}.rk4-bud .r>:nth-child(n+4){display:none}}'
+'@media print{.sidebar,.topbar,.sb-backdrop,.rk4-strip,.rk4-tools,.rk4-bud{display:none!important}.main{margin:0!important;padding:0!important}.view{padding:0!important}.rk4-card{break-inside:avoid}}'
+'</style>';

/* ---------------------------------------------------------------- order by leads */
async function rkLeads(){
  if(RK.leads) return RK.leads;
  let m=Object.assign({},RK_LEADS_SNAP);
  try{ const r=await RKS().rpc('lead_counts'); if(!r.error&&Array.isArray(r.data)&&r.data.length){ m={}; r.data.forEach(function(x){ m[x.bu_id]=Number(x.q90)||0; }); } }catch(e){}
  RK.leads=m; return m;
}
function rkHasData(p){ const n=(RK.stats[p.id]||{}).n||{}; return !!(n.configurations||n.charges||n.amenities||n.locations); }
/* ORDER AND DISABLED PROJECTS (25 Nov 2026, Ayush): the strip runs in this fixed order; Dream Diamond and Dream Excellency are
   disabled (shown greyed at the end, not clickable). Any other project follows, by qualified leads. */
const RK_ORDER=['Dream World City','Dream Ananta','Dream Gurukul','Dream Exotica','Dream One','Dream EcoCity','Dream Valley','Dream Residency Manor','Dream EcoCity Bungalows','Dream Palazzo'];
const RK_OFF=['Dream Diamond','Dream Excellency'];
function rkOff(p){ return RK_OFF.indexOf(p.name)!==-1; }
function rkOrdered(){
  const L=RK.leads||RK_LEADS_SNAP, pos=function(p){ const i=RK_ORDER.indexOf(p.name); return rkOff(p)?2000:i===-1?1000:i; };
  return (RK.projects||[]).slice().sort(function(a,b){
    const oa=pos(a), ob=pos(b); if(oa!==ob) return oa-ob;
    const ha=rkHasData(a)?1:0, hb=rkHasData(b)?1:0; if(ha!==hb) return hb-ha;
    const la=L[RK_BU[a.name]]||0, lb=L[RK_BU[b.name]]||0; if(la!==lb) return lb-la;
    return a.name.localeCompare(b.name); });
}
function rkTabName(n){ return n.replace(/^Dream /,'').replace('Residency Manor','Manor').replace('EcoCity Bungalows','Eco Bungalows').replace('Gateway Pailan','Gateway'); }

/* ---------------------------------------------------------------- page */
VIEWS.reckoner=async function(v,seg){
  setCrumb(['Sales','Reckoner']);
  const s0=seg&&seg[0]||'', head=RK4_CSS;
  try{
    if(!RK.projects){ v.innerHTML=head+'<div class="loader"><div class="spin"></div></div>'; await Promise.all([rkBase(),rkLeads()]); if(PAGE!=='reckoner') return; }
    const list=rkOrdered(); if(!list.length){ v.innerHTML=head+'<div class="rk4-card rk4-none">No projects yet.</div>'; return; }
    let id=(s0==='p'&&seg[1])?seg[1]:(RK.cur||list[0].id);
    if(!list.some(function(p){ return p.id===id&&!rkOff(p); })) id=list[0].id;
    if(RK.cur!==id) RK.edit=false;
    RK.cur=id;
    const strip=rkStrip4(list,id);
    if(!RK.proj[id]){ v.innerHTML=head+'<div class="rk4">'+strip+'<div class="loader"><div class="spin"></div></div></div>'; await rkDetail(id); if(PAGE!=='reckoner'||RK.cur!==id) return; }
    v.innerHTML=head+'<div class="rk4">'+strip+rkSheet4(RK.proj[id])+'</div>';
    if(RK.q) rkSearchApply();
    setTimeout(function(){ list.slice(0,6).forEach(function(p){ if(!RK.proj[p.id]) rkDetail(p.id).catch(function(){}); }); },400);
  }catch(e){
    v.innerHTML=head+'<div class="card card-pad" style="font-size:13.5px;color:#b91c1c"><i class="fa-solid fa-triangle-exclamation"></i> Reckoner could not be shown: '+esc(String((e&&e.message)||e))+'. <a href="javascript:void(0)" onclick="rkReload()">Try again</a></div>';
    try{ console.error('reckoner',e); }catch(_e){}
  }
};
window.rkReload=function(){ RK.projects=null; RK.proj={}; RK.leads=null; renderPage(); };
window.rkPick=function(id){ if(RK.edit&&!confirm('Leave without saving your changes?')) return; RK.edit=false; RK.cur=id; navTo('reckoner/p/'+id); };
function rkStrip4(list,id){
  const L=RK.leads||RK_LEADS_SNAP;
  return '<nav class="rk4-strip" aria-label="Projects">'+list.map(function(p){
    if(rkOff(p)) return '<button class="off" disabled title="'+esc(p.name)+' - not on sale">'+esc(rkTabName(p.name))+'</button>';
    return '<button class="'+(p.id===id?'on':'')+(rkHasData(p)?'':' empty')+'" onclick="rkPick(\''+p.id+'\')" title="'+esc(p.name)+(RK_BU[p.name]!=null?' - '+(L[RK_BU[p.name]]||0)+' qualified leads in 90 days':'')+'">'+esc(rkTabName(p.name))+'</button>'; }).join('')+'</nav>';
}

/* ---------------------------------------------------------------- formatting */
function rk4Big(n){ n=Number(n); const t=function(x){ return String(Math.round(x*100)/100); }; if(n>=1e7) return '₹'+(Math.round(n/1e5)/100).toFixed(2)+' Cr'; if(n>=1e5) return '₹'+t(n/1e5)+' L'; return rkInr(n); }
function rk4Money(c){ if(c.amount==null) return ''; if(c.unit==='percent') return rkNum(c.amount)+'%'; if(c.unit==='per_sqft') return rkInr(c.amount)+' / sq ft'; return rk4Big(c.amount); }
function rk4Area(c){ if(!c||(c.sba_min==null&&c.sba_max==null)) return ''; if(c.sba_min!=null&&c.sba_max!=null&&Number(c.sba_min)!==Number(c.sba_max)) return rkNum(c.sba_min)+' – '+rkNum(c.sba_max); return rkNum(c.sba_min!=null?c.sba_min:c.sba_max); }
// "₹82-85 L" in a price note -> shown as the price itself
const RK4_RANGE=/₹\s?(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(L|Lakhs?|Lacs?|Lakh|Cr)\b\.?/i;
function rk4Range(x){ const m=String(x.note||'').match(RK4_RANGE); if(!m) return ''; return '₹'+m[1]+'–'+m[2]+' '+(/^c/i.test(m[3])?'Cr':'L'); }
// booking amount as a tile: the amount big, the rest of the sentence small ("then 10%")
function rkBookTile(n,ed){
  if(ed) return '<div class="rk4-tile book" data-it><div class="k">Booking amount</div><div class="v sm">'+rkV('sales_notes',n.id,'body','text',n.body)+'</div></div>';
  const b=String(n.body||'').replace(/^(booking amount|token amount)\s*/i,'');
  const m=b.match(/₹\s?[\d,.]+\s*(lakhs?|lacs?|l\b|cr)?/i);
  const big=m?m[0].replace(/\s+/g,' ').replace(/lakhs?|lacs?/i,'Lakh').trim():b;
  const rest=m?b.replace(m[0],'').replace(/^[\s,;.-]+|[\s,;.]+$/g,'').replace(/\(([^)]*)\)/g,'$1'):'';
  // just the amount - the rest of the sentence ("down payment, after that 20%...") is left out (Ayush 23 Nov)
  return '<div class="rk4-tile book'+(big.length>8?' long':'')+'" data-it title="'+esc(n.body)+'"><div class="k">Booking amount</div><div class="v'+(big.length>12?' sm':'')+'">'+esc(big)+'</div></div>';
}
// registration numbers, one per line, never broken mid-number; the phase ("Precinct I") as a hover note
function rkRegNos(v){ return String(v||'').split(/,\s*/).filter(Boolean).map(function(x){ const m=x.match(/^(\S+)\s*(?:\((.*)\))?/); return '<span class="rk4-reg" title="'+esc(m&&m[2]||'')+'">'+esc(m?m[1]:x)+'</span>'; }).join(''); }
function rk4Live(rows){ return (rows||[]).filter(function(r){ return !r.archived&&r.vstatus!=='rejected'&&r.vstatus!=='na'; }); }
const RK4_MON=/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s*\d{4}|\b20\d\d\b/i;
function rk4PossShort(n){ n=String(n||''); if(!n) return ''; const h=n.match(/handover\b[^;]*/i); if(h){ const m=h[0].match(RK4_MON); if(m) return 'Handover '+m[0]; } const d=n.match(RK4_MON); return d?d[0]:n; }
/* A value: plain text when viewing; in edit mode an outlined box typed over in place. kind: text | money | num | sba */
function rkV(tbl,id,col,kind,shown,cls){
  shown=shown==null?'':String(shown);
  if(!RK.edit||!id) return '<span class="rk4-v'+(cls?' '+cls:'')+'">'+esc(shown)+'</span>';
  return '<span class="rk4-v on'+(cls?' '+cls:'')+'" contenteditable="true" spellcheck="false" data-e="'+tbl+'|'+id+'|'+col+'|'+kind+'" data-o="'+esc(shown)+'" onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}" oninput="this.classList.toggle(\'chg\',this.innerText.trim()!==this.getAttribute(\'data-o\'))">'+esc(shown)+'</span>';
}

/* ---------------------------------------------------------------- the project */
function rkSheet4(d){
  const p=d.p, id=p.id, ed=RK.edit;
  const cfg=rk4Live(d.cfg), chg=rk4Live(d.chg), notes=rk4Live(d.notes), am=rk4Live(d.am), lm=rk4Live(d.lm), loc=rk4Live(d.loc), bank=rk4Live(d.bank), off=rk4Live(d.off), plan=rk4Live(d.plan), units=d.units||[];
  const prices=chg.filter(function(c){ return c.kind==='unit_price'&&!c.internal; });
  const parking=chg.filter(function(c){ return c.kind==='parking'&&!c.internal; }).sort(function(a,b){ return (a.amount==null?1e12:a.amount)-(b.amount==null?1e12:b.amount); });
  const cheap=parking.find(function(x){ return x.amount!=null; });
  const charges=chg.filter(function(c){ return !c.internal&&c.kind!=='unit_price'&&c.kind!=='parking'; });
  const book=notes.filter(function(n){ return n.kind==='booking_procedure'; });
  const avail=notes.filter(function(n){ return n.kind==='other'&&/availab/i.test(n.title||''); });
  const why=notes.filter(function(n){ return ['usp','selling_point','differentiator','pitch','target_customer'].indexOf(n.kind)!==-1&&!n.internal; });
  const cfgOf=function(cid){ return cfg.find(function(c){ return c.id===cid; }); };
  const has=!!(cfg.length||chg.length||am.length||loc.length);
  const status=p.status||rk4PossShort(p.possession_note);
  const ap=rkCanApprove();

  // header
  let h='<div class="rk4-body"><div class="rk4-head"><h1>'+rkV('projects',id,'name','text',p.name)+'</h1><span class="rk4-place">'+esc([p.locality,p.city].filter(Boolean).join(', '))+'</span>'
    +(status?'<span class="rk4-badge">Possession: '+esc(status)+'</span>':'');
  if(ed) h+='<div class="rk4-editbar"><span>Editing - click any outlined value to change it</span><button class="rk4-btn" onclick="rkEditCancel()">Cancel</button><button class="rk4-btn pri" id="rk4Save" onclick="rkEditSave()">Save changes</button></div>';
  else h+='<div class="rk4-tools"><label class="rk4-q"><i class="fa-solid fa-magnifying-glass" style="color:#64748b;font-size:13px"></i><input id="rk4Q" type="search" aria-label="Search, or a customer budget" placeholder="Search or budget e.g. 40 L 2 BHK" value="'+esc(RK.q)+'" oninput="rkSearch(this.value)"></label>'
    +(ap&&has?'<button class="rk4-ib pen" title="Edit this project" aria-label="Edit this project" onclick="rkEditOn()"><i class="fa-solid fa-pen"></i></button>':'')
    +'<button class="rk4-ib" title="Download PDF" aria-label="Download PDF" onclick="rkDownload()"><i class="fa-solid fa-download"></i></button>'
    +'<button class="rk4-ib" title="Print" aria-label="Print" onclick="window.print()"><i class="fa-solid fa-print"></i></button></div>';
  h+='</div><div id="rk4Bud"></div>';
  if(!has) return h+'<div class="rk4-card rk4-none" style="padding:28px">Nothing is recorded for '+esc(p.name)+' yet. Its prices, sizes, location and selling points appear here once they are entered.</div></div>';

  // 1. flats & car parking
  // Ayush 23 Nov: no "with parking" column - the parking tiles below say it
  const parkHead='';
  const cols='0.9fr 1fr 1.7fr';
  const sqftIn=function(s){ const m=String(s||'').match(/(\d[\d,.]*)\s*sq\s*ft/i); return m?m[1]:null; };
  const sub=function(x,c){ const incA=[x.edc_included?'EDC':null,x.gst_included?'GST':null,x.parking_included===true?'parking':null].filter(Boolean);
    const inc=incA.length?'incl. '+(incA.length>1?incA.slice(0,-1).join(', ')+' & '+incA[incA.length-1]:incA[0]):'';
    // the note, short (Ayush 23 Nov: long notes shorter): the price range moves into the price (rk4Range), what is
    // included is already in "incl. ...", the rest is cut to "excl. ..." / "flat cost" / "all inclusive"
    const segs=String(x.note||'').replace(RK4_RANGE,'').replace(/\(various options\)/ig,'').split(/;|,(?![^()]*\))/).map(function(t){ return t.trim(); }).filter(Boolean);
    const keep=[]; segs.forEach(function(t){
      if(/^onwards$/i.test(t)) return;
      if(/unit price\s*\+|^(including|inclusive|incl\.?)\b(?!\s+all)/i.test(t)&&!/exclud/i.test(t)) return;
      t=t.replace(/\bonwards\b/ig,'').replace(/including all|inclusive all|inclusive$/ig,'all inclusive').replace(/excluding/ig,'excl.').replace(/car parking/ig,'parking').replace(/\s+and\s+/ig,' & ').replace(/\ball all inclusive\b/ig,'all inclusive').replace(/\s{2,}/g,' ').trim();
      if(t&&keep.indexOf(t)===-1) keep.push(t); });
    const lab=c?String(x.name).replace(c.name,'').replace(/\d[\d,.]*\s*sq\s*ft/i,'').replace(/[()]/g,'').replace(/^[\s,·-]+|[\s,·-]+$/g,''):'';
    let s=[lab||null,inc].concat(keep).filter(Boolean).join(' · ');
    if(/onwards/i.test(x.note||'')) s+=(s?' · ':'')+'onwards';
    return s.length>70?s.slice(0,68)+'…':s; };
  const withP=function(x){ if(x.parking_included===true) return 'Included'; if(cheap&&x.amount!=null&&x.unit==='lump_sum') return rk4Big(Number(x.amount)+Number(cheap.amount)); return '—'; };
  let rows='';
  cfg.forEach(function(c){
    const ps=prices.filter(function(x){ return x.configuration_id===c.id; });
    if(!ps.length) rows+='<div class="rk4-pt" data-it style="grid-template-columns:'+cols+'"><span class="t">'+rkV('configurations',c.id,'name','text',c.name)+'</span><span class="z">'+rkV('configurations',c.id,'sba','sba',rk4Area(c))+'</span><span class="p ask">Ask Sales Manager</span>'+(parkHead?'<span class="w">—</span>':'')+'</div>';
    ps.forEach(function(x,i){ const s=sub(x,c), fromName=sqftIn(x.name);
      rows+='<div class="rk4-pt" data-it style="grid-template-columns:'+cols+'"><span class="t'+(i?' rep':'')+'">'+(i?esc(c.name):rkV('configurations',c.id,'name','text',c.name))+'</span>'
        +'<span class="z">'+(fromName&&!(ps.length===1&&/–/.test(rk4Area(c)))?esc(rkNum(Number(String(fromName).split(',').join('')))):rkV('configurations',c.id,'sba','sba',rk4Area(c)))+'</span>'
        +'<span><span class="p">'+(ed?rkV('charges',x.id,'amount','money',rk4Money(x)):esc(rk4Range(x)||rk4Money(x)))+'</span>'+(s?'<span class="s">'+esc(s)+'</span>':'')+'</span>'+(ed&&i===ps.length-1&&c.floors&&c.floors.indexOf('G+')!==0?rk4Floors(c):'')
        +(parkHead?'<span class="w">'+esc(withP(x))+'</span>':'')+'</div>'; });
  });
  prices.filter(function(x){ return !x.configuration_id||!cfgOf(x.configuration_id); }).forEach(function(x){ const s=sub(x,null);
    rows+='<div class="rk4-pt" data-it style="grid-template-columns:'+cols+'"><span class="t">'+esc(x.name)+'</span><span class="z">'+esc(sqftIn(x.name)||'—')+'</span><span><span class="p">'+rkV('charges',x.id,'amount','money',rk4Money(x))+'</span>'+(s?'<span class="s">'+esc(s)+'</span>':'')+'</span>'+(parkHead?'<span class="w">'+esc(withP(x))+'</span>':'')+'</div>'; });
  // a line about every price (Dream One: what the box price includes) - a sales note titled "Price note" (Ayush 25 Nov)
  const pn=notes.filter(function(n){ return n.kind==='other'&&/^price note$/i.test(n.title||''); });
  const priceNote=pn.map(function(n){ return '<div class="rk4-pnote" data-it><i class="fa-solid fa-circle-info"></i> '+rkV('sales_notes',n.id,'body','text',n.body)+'</div>'; }).join('');
  const flats='<section class="rk4-card" data-sec="prices price flats bhk size parking"><h2>Flats &amp; car parking</h2>'+(prices.length>5?'':priceNote)
    +(rows?'<div class="rk4-pt h" style="grid-template-columns:'+cols+'"><span>Type</span><span>Size (sq ft)</span><span>Box Price</span>'+(parkHead?'<span>'+esc(parkHead)+'</span>':'')+'</div>'+rows:'')
    // parking tiles, and the booking amount as a tile beside them (Ayush 23 Nov: out of Key facts, beside Covered parking)
    +'<div class="rk4-park"><div class="rk4-tiles">'
    +(parking.length?parking.map(function(k){ const inc=k.note&&!/^included in the price$/i.test(k.note)&&k.note.charAt(0)!=='₹'?k.note:'Included', pv=k.amount==null&&k.parking_included?inc:/^₹/.test(k.note||'')?k.note:rk4Money(k)||'Ask Sales Manager'; return '<div class="rk4-tile'+(!ed&&String(pv).length>8?' long':'')+'" data-it><div class="k">'+esc(k.name.replace(/ car parking$/i,'').replace(/ parking$/i,''))+' parking</div><div class="v">'+(ed?rkV('charges',k.id,'amount','money',rk4Money(k)):esc(pv))+'</div></div>'; }).join('')
      :'<div class="rk4-tile none" data-it><div class="k">Car parking</div><div class="v sm">Ask Sales Manager</div></div>')
    +(book[0]?rkBookTile(book[0],ed):'')+'</div>'
    +charges.map(function(c){ return '<div class="rk4-chg" data-it><span style="color:#334155">'+esc(c.name)+(c.note?'<span style="color:#64748b;font-size:12px"> - '+esc(c.note)+'</span>':'')+'</span><span style="font-weight:700">'+(c.amount==null&&!ed?'Ask Sales Manager':rkV('charges',c.id,'amount','money',rk4Money(c)))+'</span></div>'; }).join('')+'</div></section>';

  // the same, laid out horizontally: one column per flat type, its sizes and prices under it, then parking below
  const flatsWide=prices.length>5?'<section class="rk4-card" data-sec="prices price flats bhk size parking"><h2>Flats &amp; car parking</h2>'+priceNote+'<div class="rk4-cfgs">'
    +cfg.map(function(c){ const ps=prices.filter(function(x){ return x.configuration_id===c.id; });
      return '<div class="rk4-cfg" data-it><div class="h">'+rkV('configurations',c.id,'name','text',c.name)+'<span class="sz">'+esc(rk4Area(c)?rk4Area(c)+' sq ft':'')+'</span></div><div class="lb"><span>Size · floor</span><span>Box Price</span></div>'
        +(ps.length?ps.map(function(x){ const fromName=sqftIn(x.name), s=sub(x,c).replace(/^[^·]*sq ft[^·]*·?\s*/i,'');
          // size in bold, the floor under it, the price on the right
          const fl=(x.name.match(/\(([^)]*floor[^)]*)\)/i)||[,''])[1];
          return '<div class="r"><span class="z"><b>'+esc(fromName?fromName+' sq ft':(rk4Area(c)?rk4Area(c)+' sq ft':''))+'</b>'+(fl?'<i>'+esc(fl.charAt(0).toUpperCase()+fl.slice(1))+'</i>':'')+'</span><span class="p">'+(ed?rkV('charges',x.id,'amount','money',rk4Money(x)):esc(rk4Range(x)||rk4Money(x)))+'</span></div>'; }).join('')
          :'<div class="r"><span class="p ask">Ask Sales Manager</span></div>')+'</div>'; }).join('')
    +'</div>'+flats.slice(flats.indexOf('<div class="rk4-park">'))
    :'';

  // 2. key facts
  const fact=function(k,html,show,hl){ return show||ed?'<div class="rk4-fact'+(hl?' hl':'')+'" data-it><span>'+k+'</span><span>'+html+'</span></div>':''; };
  const facts='<section class="rk4-card" data-sec="key facts possession booking land towers units rera loans"><h2>Key facts</h2>'
    // possession: just "Ready to Move", or the short handover date - never the long note (Ayush 23 Nov); editors see both fields
    +(ed?fact('Possession',rkV('projects',id,'status','text',p.status||'')+' · '+rkV('projects',id,'possession_note','text',p.possession_note||''),true,1)
      :fact('Possession',esc(p.status||rk4PossShort(p.possession_note)),p.status||p.possession_note,1))
    +fact('Sizes',esc((function(){ const a=[]; cfg.forEach(function(c){ if(c.sba_min!=null) a.push(Number(c.sba_min)); if(c.sba_max!=null) a.push(Number(c.sba_max)); }); if(!a.length) return ''; const lo=Math.min.apply(null,a), hi=Math.max.apply(null,a); return (lo===hi?rkNum(lo):rkNum(lo)+' – '+rkNum(hi))+' sq ft'; })()),cfg.some(function(c){ return c.sba_min!=null||c.sba_max!=null; })&&!ed,1)
    // land and units on one line, towers and floors on one line (shorter card - Ayush 23 Nov)
    +fact('Land · units',rkV('projects',id,'land_area','text',p.land_area||'')+(p.land_area&&p.total_units!=null?' · ':'')+(p.total_units!=null||ed?rkV('projects',id,'total_units','num',p.total_units!=null?rkNum(p.total_units):'')+' units':''),p.land_area||p.total_units!=null,1)
    +fact('Towers / Height',rkV('projects',id,'towers','text',p.towers||'')+(p.towers&&p.height?' · ':'')+rkV('projects',id,'height','text',p.height||''),p.towers||p.height,1)
    +fact('Open space',rkV('projects',id,'open_space','text',p.open_space||''),p.open_space)
    // (Stage left out - Possession already says it; Ayush 23 Nov: Key facts too long)
    // registration numbers: WB RERA in rera_no, WB HIRA in rera_note ("HIRA/P/..."); several phases separated by ", "
    // RERA No. only when the project has one (Ayush 23 Nov)
    +fact('RERA No.',ed?rkV('projects',id,'rera_no','text',p.rera_no||''):rkRegNos(p.rera_no),!!p.rera_no)
    +fact('HIRA No.',ed?rkV('projects',id,'rera_note','text',/HIRA/i.test(p.rera_note||'')?p.rera_note:''):rkRegNos(p.rera_note),/HIRA/i.test(p.rera_note||''))
    +(ed||prices.length>5?'':rk4FloorGrid(cfg))
    +(bank.length?fact('Home loans',bank.map(function(b){ return rkV('bank_approvals',b.id,'bank','text',b.bank); }).join(' · '),true):'')
    +'</section>';

  // 3. offers + why buy
  const offers='<section class="rk4-card rk4-off" data-sec="offers offer discount free"><h2>Offers</h2>'
    +(off.filter(function(o){ return !o.internal; }).map(function(o){ return '<div data-it style="padding:5px 0"><div style="font-size:14px;font-weight:700;line-height:1.35">'+rkV('offers',o.id,'title','text',o.title)+'</div>'
      +'<div style="font-size:12px;color:#92400e;margin-top:1px">'+(o.details||ed?rkV('offers',o.id,'details','text',o.details||'')+' · ':'')+(o.valid_until?'Until '+esc(fmtDate(o.valid_until)):'No end date - confirm before offering')+'</div></div>'; }).join('')||'<div class="rk4-none" style="color:#92400e">No offer running.</div>')+'</section>';
  const whyC='<section class="rk4-card" data-sec="why buy selling points usp"><h2>Why buy</h2>'
    // a point written on several lines (Ananta's premium specs) shows as a small list under its title
    +(why.map(function(w,i){ const lines=String(w.body||'').split('\n').map(function(t){ return t.trim(); }).filter(Boolean);
      if(lines.length>1&&!ed) return '<div class="rk4-li" data-it><span class="n">'+(i+1)+'</span><span>'+(w.title?'<b>'+esc(w.title)+'</b>':'')+'<span class="rk4-sub">'+lines.map(function(t){ return '<span>'+esc(t)+'</span>'; }).join('')+'</span></span></div>';
      return '<div class="rk4-li" data-it><span class="n">'+(i+1)+'</span><span style="white-space:pre-line">'+(w.title?'<b>'+rkV('sales_notes',w.id,'title','text',w.title)+'</b> - ':'')+rkV('sales_notes',w.id,'body','text',w.body)+'</span></div>'; }).join('')||'<div class="rk4-none">Selling points not recorded.</div>')+'</section>';


  // 4. location | amenities | availability & booking
  const locC='<section class="rk4-card" data-sec="location address directions map"><h2>Location</h2>'
    +(loc.map(function(l){ const addr=[l.address,l.pin&&String(l.address||'').indexOf(l.pin)===-1?l.pin:null].filter(Boolean).join(' - ');
      // the closest place of each kind a customer asks about, so the card answers "how far is..." (and has no empty bottom)
      return '<div data-it style="padding:2px 0 6px;display:flex;flex-direction:column;flex:1"><div><div style="font-size:14px;font-weight:700;line-height:1.4">'+rkV('locations',l.id,'address','text',l.address||'')+(l.pin&&String(l.address||'').indexOf(l.pin)===-1?' - '+rkV('locations',l.id,'pin','text',l.pin):'')+'</div>'
        +(l.directions||ed?'<div style="font-size:13.5px;color:#334155;line-height:1.55;margin-top:6px">'+rkV('locations',l.id,'directions','text',l.directions||'')+'</div>':'')
        // the project itself on Google Maps: its own pin when recorded, else a search for the project by name and area
        +'</div><a class="rk4-map" href="'+esc(l.maps_url||(l.lat&&l.lng?'https://www.google.com/maps/search/?api=1&query='+l.lat+','+l.lng:'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent([p.name,p.locality,p.city].filter(Boolean).join(', '))))+'" target="_blank" rel="noopener"><i class="fa-solid fa-location-dot"></i> Open in Google Maps</a></div>'; }).join('')||'<div class="rk4-none">Address not recorded.</div>')+'</section>';
  const amC='<section class="rk4-card" data-sec="amenities amenity facilities club pool gym"><h2>Amenities</h2>'
    +(am.length?'<div class="rk4-am">'+am.map(function(a){ return '<span class="rk4-amt" data-it><i class="fa-solid fa-check"></i>'+rkV('amenities',a.id,'name','text',a.name)+(a.status?' <span style="color:#64748b">('+esc(a.status)+')</span>':'')+'</span>'; }).join('')+'</div>':'<div class="rk4-none">Amenities not recorded.</div>')+'</section>';
  // (Availability & booking card removed - Ayush 23 Nov)


  // 5. flat details
  const det=cfg.map(function(c){
    const parts=[];
    if(c.room_sizes||ed) parts.push('Rooms '+rkV('configurations',c.id,'room_sizes','text',c.room_sizes||''));
    if(c.facing||ed) parts.push('Facing '+rkV('configurations',c.id,'facing','text',c.facing||''));
    const tb=[c.bathrooms!=null?rkNum(c.bathrooms)+' toilets':null,c.balconies!=null?rkNum(c.balconies)+' balconies':null].filter(Boolean).join(', '); if(tb) parts.push(esc(tb));
    if(c.carpet) parts.push(esc('Carpet '+rkNum(c.carpet)+' sq ft')); if(c.built_up) parts.push(esc('Built-up '+rkNum(c.built_up)+' sq ft'));
    if(c.area_note||ed) parts.push(rkV('configurations',c.id,'area_note','text',c.area_note||''));
    if(c.features||ed) parts.push(rkV('configurations',c.id,'features','text',c.features||''));
    return parts.length?'<div class="rk4-det" data-it><span style="font-weight:700">'+esc(c.name)+'</span><span>'+parts.join(' · ')+'</span></div>':''; }).join('');
  const detC='';   // Flat details removed from every project (Ayush 23 Nov)
  const specC='';   // premium specs now sit in Why buy (Ayush 23 Nov)
  // rows whose cards are the same height, so everything lines up (Ayush 23 Nov):
  // row 1  Flats & car parking | Key facts | Offers + Why buy      row 2  Location | Amenities (two columns wide)
  // a long flat list (Dream One: 8 prices) gets the whole width, laid out flat type by flat type side by side;
  // Key facts, Offers and Why buy then share the next row
  h+=(prices.length>5?'<div class="rk4-row r0">'+flatsWide+'</div><div class="rk4-row r1 r1b">'+facts+offers+whyC+'</div>'
    :'<div class="rk4-row r1">'+flats+facts+'<div class="rk4-stack">'+offers+whyC+'</div></div>')
    +'<div class="rk4-row r2">'+locC+amC+'</div>'+specC;
  const pool=[];

  // 6. nearby
  const g={}; lm.forEach(function(a){ (g[a.category||'Landmark']=g[a.category||'Landmark']||[]).push(a); });
  const order=RK_LMORDER.concat(Object.keys(g)).filter(function(k,i,a){ return g[k]&&a.indexOf(k)===i; });
  let nearC=''; if(order.length) nearC=('<section class="rk4-card" data-sec="nearby schools hospitals metro station airport shopping dining"><h2>Nearby</h2>'+order.map(function(k){
    const items=g[k].slice().sort(function(a,b){ return (a.travel_min==null?1e9:a.travel_min)-(b.travel_min==null?1e9:b.travel_min); });
    return '<div class="rk4-nb" data-grp><span>'+esc(k)+'</span><div class="rk4-chips">'+items.map(function(a){
      const km=a.distance_km!=null?rkNum(a.distance_km)+' km':'';
      const tm=a.travel_min!=null||ed?rkV('landmarks',a.id,'travel_min','num',a.travel_min!=null?rkNum(a.travel_min):'')+' min':'';
      return '<span class="rk4-chip" data-it>'+rkV('landmarks',a.id,'name','text',a.name)+'<b>'+[tm,km].filter(Boolean).join(' · ')+(!tm&&!km&&a.travel_note?esc(a.travel_note):'')+'</b></span>'; }).join('')+'</div></div>'; }).join('')+'</section>');
  // Flat details and Nearby run full width under the columns (long text reads best wide)
  h+='<div class="rk4-pool" style="display:none">'+pool.filter(Boolean).join('')+'</div><div id="rk4DetSlot">'+detC+'</div>'+nearC;
  return h+'<div class="rk4-none" id="rk4NoRes" style="display:none;padding:20px;text-align:center">Nothing on this project matches.</div></div>';
}

/* ---------------------------------------------------------------- one box: search, or a budget */
let RK4_T=null;
window.rkSearch=function(v){ RK.q=v; clearTimeout(RK4_T); RK4_T=setTimeout(rkSearchApply,150); };
function rkBudParse(q){
  const s=String(q||'').toLowerCase(); let max=null, bhk=null;
  const b=s.match(/(\d+(?:\.\d+)?)\s*(bhk|rk)/); if(b){ bhk=b[1]+' '+b[2].toUpperCase(); }
  const rest=b?s.replace(b[0],' '):s;
  const m=rest.match(/(\d+(?:\.\d+)?)\s*(cr|crore|l|lac|lacs|lakh|lakhs)\b/);   // a unit is needed: a bare number (a size, a RERA no.) is searched as text (25 Nov)
  if(m){ const n=parseFloat(m[1]); max=/^c/.test(m[2])?n*1e7:n*1e5; }
  return { max:max, bhk:bhk, on:!!(max||bhk) };
}
function rkBhk4(name){ const m=String(name||'').match(/(\d+(?:\.\d+)?)\s*(BHK|RK)/i); if(m) return m[1]+' '+m[2].toUpperCase(); if(/studio/i.test(name)) return '1 RK'; return null; }
function rkSearchApply(){
  const root=document.querySelector('.rk4-body'), bud=$('rk4Bud'); if(!root) return;
  const q=String(RK.q||'').trim(), B=rkBudParse(q);
  // budget: every flat type, in every project, that fits
  if(bud){
    if(B.on){
      const byP={}; (RK.projects||[]).forEach(function(p){ byP[p.id]=p; });
      const rows=[];
      RK.cfg.forEach(function(c){ if(!byP[c.project_id]) return; if(B.bhk&&rkBhk4(c.name)!==B.bhk) return;
        const ps=RK.rates.filter(function(r){ return r.configuration_id===c.id&&r.kind==='unit_price'&&r.unit==='lump_sum'&&!r.internal&&r.amount!=null&&r.vstatus!=='rejected'&&r.vstatus!=='na'; });
        if(!ps.length) return; const lo=Math.min.apply(null,ps.map(function(r){ return Number(r.amount); }));
        if(B.max&&lo>B.max) return; rows.push({p:byP[c.project_id],c:c,lo:lo}); });
      rows.sort(function(a,b){ return a.lo-b.lo; });
      bud.innerHTML='<div class="rk4-bud"><h2>Fits '+esc([B.max?'up to '+rk4Big(B.max):null,B.bhk].filter(Boolean).join(', '))+' - '+rows.length+' option'+(rows.length===1?'':'s')+'</h2>'
        +(rows.length?'<div class="r h"><span>Project</span><span>Type</span><span>Size (sq ft)</span><span>From</span><span>Possession</span><span>Where</span></div>'+rows.map(function(r){ const p=r.p;
          return '<div class="r" onclick="rkPick(\''+p.id+'\')"><b>'+esc(p.name)+'</b><span>'+esc(r.c.name)+'</span><span>'+esc(rk4Area(r.c))+'</span><b>'+esc(rk4Big(r.lo))+'</b><span>'+esc(p.status||rk4PossShort(p.possession_note))+'</span><span style="color:#64748b">'+esc([p.locality,p.city].filter(Boolean).join(', '))+'</span></div>'; }).join('')
          :'<div class="rk4-none">No flat with a recorded price fits. Try a higher budget or leave out the BHK.</div>')+'</div>';
    } else bud.innerHTML='';
  }
  // otherwise: narrow this project's page to what matches
  root.querySelectorAll('.rk4-hl').forEach(function(m){ const pn=m.parentNode; m.replaceWith(document.createTextNode(m.textContent)); pn.normalize(); });
  const words=B.on?[]:q.toLowerCase().split(/\s+/).filter(Boolean); let any=false;
  root.querySelectorAll('[data-sec]').forEach(function(sec){
    const title=String(sec.getAttribute('data-sec')).toLowerCase(), its=Array.from(sec.querySelectorAll('[data-it]'));
    // numbers match with or without commas ("1650" finds "1,650")
    const hit=its.map(function(it){ const tx=it.textContent.toLowerCase(), tn=tx.split(',').join(''); return !words.length||words.every(function(w){ return tx.indexOf(w)!==-1||tn.indexOf(w.split(',').join(''))!==-1; }); });
    const n=hit.filter(Boolean).length, byTitle=words.length&&!n&&words.every(function(w){ return title.indexOf(w)!==-1; });
    its.forEach(function(it,i){ const ok=hit[i]||byTitle; it.style.display=ok?'':'none'; if(hit[i]&&words.length) rkMark4(it,words); });
    sec.querySelectorAll('[data-grp]').forEach(function(gp){ gp.style.display=Array.from(gp.querySelectorAll('[data-it]')).some(function(x){ return x.style.display!=='none'; })?'':'none'; });
    const vis=n>0||byTitle; sec.style.display=vis?'':'none'; if(vis) any=true;
  });
  const nr=$('rk4NoRes'); if(nr) nr.style.display=any?'none':'block';
}
function rkMark4(el,words){
  const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT,null), nodes=[]; let n; while((n=walk.nextNode())) nodes.push(n);
  nodes.forEach(function(t){ const s=t.nodeValue, low=s.toLowerCase(); let hit=-1, len=0;
    words.forEach(function(w){ const i=low.indexOf(w); if(i!==-1&&(hit===-1||i<hit)){ hit=i; len=w.length; } });
    if(hit===-1) return; const sp=document.createElement('span'); sp.className='rk4-hl'; sp.textContent=s.slice(hit,hit+len);
    const after=t.splitText(hit); after.nodeValue=after.nodeValue.slice(len); t.parentNode.insertBefore(sp,after); });
}

/* ---------------------------------------------------------------- edit in place */
window.rkEditOn=function(){ if(!rkCanApprove()) return; RK.q=''; RK.edit=true; renderPage(); };
window.rkEditCancel=function(){ const n=document.querySelectorAll('.rk4-v.chg').length; if(n&&!confirm('Drop '+n+' unsaved change'+(n===1?'':'s')+'?')) return; RK.edit=false; renderPage(); };
function rkParseMoney(s){ s=String(s||'').replace(/₹|,|\/\s*sq\s*ft|onwards/gi,'').trim(); if(!s) return null; const m=s.match(/(\d+(?:\.\d+)?)\s*(cr|crore|l|lac|lakh|lakhs|%)?/i); if(!m) return NaN;
  const n=parseFloat(m[1]), u=(m[2]||'').toLowerCase(); return u[0]==='c'?n*1e7:(u&&u!=='%'?n*1e5:n); }
window.rkEditSave=async function(){
  const els=Array.from(document.querySelectorAll('.rk4-v.on')).filter(function(e){ return e.innerText.trim()!==e.getAttribute('data-o'); });
  if(!els.length){ RK.edit=false; renderPage(); return; }
  const recs={}, bad=[];
  els.forEach(function(e){ const parts=e.getAttribute('data-e').split('|'), tbl=parts[0], rid=parts[1], col=parts[2], kind=parts[3], txt=e.innerText.trim();
    const k=tbl+'|'+rid; recs[k]=recs[k]||{tbl:tbl,id:rid,payload:{}};
    if(kind==='money'){ const v=rkParseMoney(txt); if(v!==null&&!isFinite(v)){ bad.push(txt); return; } recs[k].payload[col]=v; }
    else if(kind==='num'){ const v=txt===''?null:parseFloat(txt.replace(/[^\d.]/g,'')); if(v!==null&&!isFinite(v)){ bad.push(txt); return; } recs[k].payload[col]=v; }
    else if(kind==='sba'){ const ns=(txt.match(/\d[\d,]*(?:\.\d+)?/g)||[]).map(function(x){ return parseFloat(x.replace(/,/g,'')); }); recs[k].payload.sba_min=ns.length?ns[0]:null; recs[k].payload.sba_max=ns.length?ns[ns.length-1]:null; }
    else recs[k].payload[col]=txt===''?null:txt; });
  if(bad.length){ toast('Not a number: '+bad.join(', '),'warn'); return; }
  const btn=$('rk4Save'); if(btn){ btn.disabled=true; btn.textContent='Saving...'; }
  let ok=0, fail=[];
  for(const k of Object.keys(recs)){ const r=recs[k];
    const pr=await RKS().rpc('propose',{p_tbl:r.tbl,p_record:r.id,p_op:'update',p_payload:r.payload,p_reason:'Edited on the Reckoner page',p_source:null,p_project:RK.cur,p_batch:null});
    if(pr.error){ fail.push(pr.error.message); continue; }
    const rv=await RKS().rpc('review',{p_id:pr.data,p_approve:true,p_remarks:'Saved by the editor'});
    if(rv.error) fail.push(rv.error.message); else ok++; }
  if(fail.length){ toast('Saved '+ok+', not saved '+fail.length+': '+fail[0],'err'); if(btn){ btn.disabled=false; btn.textContent='Save changes'; } return; }
  toast('Saved '+els.length+' change'+(els.length===1?'':'s'),'ok');
  RK.edit=false; try{ await rkDetail(RK.cur,true); await rkBase(true); }catch(e){}
  renderPage();
};

/* ---------------------------------------------------------------- Download PDF
   A real PDF (Ayush 23 Nov: "actual PDF made, not images"): selectable text and tables made with jsPDF + autotable,
   read from this project's cards in call order. The standard PDF fonts have no rupee sign, so prices read "Rs.". */
function rkLoadScript(src){ return new Promise(function(res,rej){ const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s); }); }
const RK_PDF_ORDER=['prices','key','offers','why','location','amenities','availability','flat','nearby'];
window.rkDownload=async function(){
  const d=RK.proj[RK.cur], body=document.querySelector('.rk4-body'); if(!d||!body) return;
  toast('Making the PDF...','info');
  try{
    if(!(window.jspdf&&window.jspdf.jsPDF)) await rkLoadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    if(!(window.jspdf.jsPDF.API&&window.jspdf.jsPDF.API.autoTable)) await rkLoadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
    const doc=new window.jspdf.jsPDF({unit:'pt',format:'a4'}), W=595.28, M=36, CW=W-2*M;
    // the PDF's standard font has no rupee sign or long dashes; "Open in Google Maps" is no use on paper
    const T=function(x){ return String(x==null?'':x).replace(/₹\s?/g,'Rs. ').replace(/[→]/g,'->').replace(/\s*[–—]\s*/g,' - ').replace(/Open in Google Maps/g,'').replace(/[ \t]+/g,' ').replace(/\n\s+/g,'\n').trim(); };
    const txt=function(el){ return T(el?el.innerText:''); };
    const p=d.p; let y=M;
    const room=function(h){ if(y+h>812){ doc.addPage(); y=M; } };
    // title
    doc.setFont('helvetica','bold'); doc.setFontSize(20); doc.setTextColor(15,23,42); doc.text(T(p.name),M,y+14); y+=26;
    doc.setFont('helvetica','normal'); doc.setFontSize(10.5); doc.setTextColor(71,85,105);
    doc.text(T([[p.locality,p.city].filter(Boolean).join(', '),p.status||rk4PossShort(p.possession_note)].filter(Boolean).join('  ·  ')),M,y); y+=18;
    const head=function(t){ room(40); doc.setFont('helvetica','bold'); doc.setFontSize(11.5); doc.setTextColor(15,23,42); doc.text(T(t).toUpperCase(),M,y+10);
      doc.setDrawColor(15,118,110); doc.setLineWidth(1.5); doc.line(M,y+15,M+CW,y+15); y+=24; };
    const table=function(hd,rows,widths){ if(!rows.length) return; const cs={}; (widths||[]).forEach(function(w,i){ cs[i]={cellWidth:w}; });
      doc.autoTable({startY:y,head:hd?[hd]:undefined,body:rows,margin:{left:M,right:M},theme:'plain',columnStyles:cs,
        styles:{font:'helvetica',fontSize:9.5,cellPadding:{top:3.5,bottom:3.5,left:4,right:4},textColor:[30,41,59],lineColor:[226,232,240],lineWidth:{bottom:0.5}},
        headStyles:{fontStyle:'bold',textColor:[71,85,105],fontSize:8.5}});
      y=doc.lastAutoTable.finalY+12; };
    const para=function(t){ const lines=doc.splitTextToSize(T(t),CW); doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(30,41,59);
      lines.forEach(function(l){ room(14); doc.text(l,M,y+9); y+=13; }); y+=6; };
    const secs=Array.from(body.querySelectorAll('[data-sec]')).filter(function(s){ return s.querySelector('h2'); });
    const byKey=function(k){ return secs.find(function(s){ return String(s.getAttribute('data-sec')).indexOf(k)===0; }); };
    RK_PDF_ORDER.forEach(function(k){ const s=byKey(k); if(!s) return; head(txt(s.querySelector('h2')));
      if(k==='prices'){
        const h=s.querySelector('.rk4-pt.h'); const hd=h?Array.from(h.children).map(txt):null;
        table(hd,Array.from(s.querySelectorAll('.rk4-pt:not(.h)')).map(function(r){ return Array.from(r.children).map(txt); }));
        const park=Array.from(s.querySelectorAll('.rk4-tile')).map(function(t){ return [txt(t.querySelector('.k')),txt(t.querySelector('.v'))]; })
          .concat(Array.from(s.querySelectorAll('.rk4-chg')).map(function(c){ return Array.from(c.children).map(txt); }));
        const none=s.querySelector('.rk4-nopark'); if(none) park.push([txt(none),'']);
        if(park.length){ table(['Car parking & other charges','Amount'],park,[CW-130,130]); }
      } else if(k==='key'){ table(null,Array.from(s.querySelectorAll('.rk4-fact')).map(function(f){ return Array.from(f.children).map(txt); }),[120,CW-120]); }
      else if(k==='flat'){ table(null,Array.from(s.querySelectorAll('.rk4-det')).map(function(f){ return Array.from(f.children).map(txt); }),[140,CW-140]); }
      else if(k==='nearby'){ table(null,Array.from(s.querySelectorAll('.rk4-nb')).map(function(g){ return [txt(g.querySelector(':scope>span')),Array.from(g.querySelectorAll('.rk4-chip')).map(txt).join(',  ')]; }),[110,CW-110]); }
      else if(k==='amenities'){ para(Array.from(s.querySelectorAll('.rk4-am>span')).map(txt).join('  ·  ')||txt(s.querySelector('.rk4-none'))); }
      else { const items=Array.from(s.querySelectorAll('[data-it]')).map(txt).filter(Boolean); if(!items.length){ para(txt(s.querySelector('.rk4-none'))); return; }
        table(null,items.map(function(t,i){ return [(k==='why'?(i+1)+'.':'-'),t.replace(/^\d+\s*/,k==='why'?'':'$&')]; }),[18,CW-18]); }
    });
    // footer on every page
    const n=doc.getNumberOfPages(); for(let i=1;i<=n;i++){ doc.setPage(i); doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(148,163,184);
      doc.text('Reckoner  ·  The Jain Group  ·  '+fmtDate(new Date()),M,828); doc.text(i+' / '+n,W-M,828,{align:'right'}); }
    doc.save('Reckoner - '+p.name+' - '+rkToday()+'.pdf');
  }catch(e){ toast('Could not make the PDF - use Print and save as PDF','err'); try{ console.error('reckoner pdf',e); }catch(_e){} }
};

/* ---------------------------------------------------------------- no empty space (Ayush 23 Nov)
   Flats, Key facts and Offers + Why buy keep their places at the top of the three columns. The other cards (Location,
   Amenities, Availability, Flat details, Nearby) are dealt, in that order, into whichever column is shortest at that
   moment, so the columns end level whatever a project has recorded. Tablet: two columns. Phone: one, in call order. */
function rkBalance(){
  const pool=document.querySelector('.rk4-pool'), cols=Array.from(document.querySelectorAll('.rk4-cols>.rk4-col'));
  if(!pool||cols.length<3) return;
  const cards=Array.from(document.querySelectorAll('.rk4-cols [data-move], .rk4-pool>section'));
  cards.forEach(function(c){ c.setAttribute('data-move','1'); pool.appendChild(c); });
  // Offers and Why buy: top of the right column on a desktop, under Key facts on a tablet
  const wide=window.innerWidth>1100, sel=Array.from(document.querySelectorAll('.rk4-cols [data-sec^="offers"], .rk4-cols [data-sec^="why"]'));
  sel.forEach(function(c){ (wide?cols[2]:cols[1]).appendChild(c); });
  const use=wide?cols:window.innerWidth>760?cols.slice(0,2):[cols[0]];
  // biggest card first, each into the shortest column (heights measured in a real column)
  const hs=new Map(); cards.forEach(function(c){ use[use.length-1].appendChild(c); hs.set(c,c.offsetHeight); });
  cards.forEach(function(c){ pool.appendChild(c); });
  cards.slice().sort(function(a,b){ return hs.get(b)-hs.get(a); }).forEach(function(c){ let best=use[0]; use.forEach(function(col){ if(col.offsetHeight<best.offsetHeight) best=col; }); best.appendChild(c); });
  // still a big hole (one tall card, e.g. Dream One's 8 prices)? Flat details moves up into the short column if it fits there
  const slot=$('rk4DetSlot'), det=document.querySelector('.rk4-body [data-sec^="flat"]');
  if(slot&&det){ slot.appendChild(det);
    if(use.length>1){ let lo=use[0], hi=use[0]; use.forEach(function(col){ if(col.offsetHeight<lo.offsetHeight) lo=col; if(col.offsetHeight>hi.offsetHeight) hi=col; });
      const gap=hi.offsetHeight-lo.offsetHeight; if(gap>200){ lo.appendChild(det); if(lo.offsetHeight>hi.offsetHeight+120) slot.appendChild(det); } } }
}
let RK_BAL_T=null;
if(!window._rkBalWired){ window._rkBalWired=true; window.addEventListener('resize',function(){ if(PAGE!=='reckoner') return; clearTimeout(RK_BAL_T); RK_BAL_T=setTimeout(rkBalance,150); }); }

/* AVAILABLE FLOORS (25 Nov 2026, Ayush: only the floor and the flats on it, no extra height): configurations.floors, one
   short line under the type's price - "1st (4) · 2nd (1) · 11th (2)" = floor (flats available); "Block 1: 6th, 8th" groups by block. */
function rk4Floors(c){
  if(RK.edit) return '<span class="rk4-fl">Floors: '+rkV('configurations',c.id,'floors','text',c.floors||'')+'</span>';
  const g=String(c.floors||'').split(';').map(function(t){ return t.trim(); }).filter(Boolean);
  if(!g.length) return '';
  const counts=g.some(function(t){ return /\(\d+\)/.test(t); });
  return '<span class="rk4-fl"><b>'+(counts?'Floors (flats):':'Floors:')+'</b> '+g.map(function(t){ const i=t.indexOf(':'); return i>0?'<i>'+esc(t.slice(0,i))+'</i> '+esc(t.slice(i+1).trim()):esc(t); }).join(' · ')+'</span>';
}

/* FLATS AVAILABLE, IN WORDS (25 Nov 2026, Ayush: "I can't understand anything by that Flat Availability"): one Key facts line
   per flat type, the way it is said on a call - "12 flats: 4 on the 1st floor, 2 on the 11th, 1 each on the 2nd, 4th, 5th, 6th,
   8th and 9th". Without counts: "On the 1st, 3rd, 6th ... floors". From configurations.floors ("1st (4); 2nd (1)"). */
function rk4FloorGrid(cfg){
  const ord=function(f){ const m=String(f).match(/\d+/); return m?Number(m[0]):0; };
  const and=function(a){ return a.length>1?a.slice(0,-1).join(', ')+' and '+a[a.length-1]:a[0]; };
  return cfg.map(function(c){
    if(!c.floors||c.floors.indexOf('G+')===0) return '';
    const it=String(c.floors).split(';').map(function(t){ return t.trim(); }).filter(Boolean).map(function(t){
      const x=t.match(/^(.*?)\s*(?:\((\d+)\))?$/); return {f:x[1].replace(/\s*floors?$/i,'').trim(),n:x[2]!=null?Number(x[2]):null}; }).filter(function(x){ return x.f; })
      .sort(function(a,b){ return ord(a.f)-ord(b.f); });
    if(!it.length) return '';
    let txt;
    if(it.every(function(x){ return x.n!=null; })){
      const tot=it.reduce(function(a,x){ return a+x.n; },0), by={};
      it.forEach(function(x){ (by[x.n]=by[x.n]||[]).push(x.f); });
      const parts=Object.keys(by).map(Number).sort(function(a,b){ return b-a; }).map(function(n){ const fl=by[n];
        return (fl.length>1?n+' each':n)+' on the '+and(fl)+(fl.length>1?' floors':' floor'); });
      txt=it.length===1?'<b>'+tot+' flat'+(tot===1?'':'s')+'</b> on the '+esc(it[0].f)+' floor':'<b>'+tot+' flats</b> - '+esc(parts.join('; '));
    } else txt='On the '+esc(and(it.map(function(x){ return x.f; })))+' floor'+(it.length>1?'s':'');
    return '<div class="rk4-fact av" data-it><span>'+esc(c.name)+' available</span><span>'+txt+'</span></div>';
  }).join('');
}
