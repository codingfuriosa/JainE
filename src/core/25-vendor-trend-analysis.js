/* ===== VENDOR TREND ANALYSIS (Procurement → Vendor Trends) =====
   Backed by kraya.vtrend_vendors / vtrend_purchases (real Farvision PO-register data, one row per
   invoice line) and read entirely through kraya.vtrend_* RPCs, which already compute every
   classification (New / Growing / Stable / Declining / Inactive). Nothing here re-derives that
   logic client-side. Every RPC takes an optional p_business_units text[] filter — null means "all
   units" — so a fresh business unit's data just needs importing into vtrend_purchases; no report
   changes are needed for it to show up in the filter. */
const VT_PALETTE=['#0369a1','#db2777','#0d9488','#7c3aed','#ea4335','#16a34a','#c2410c','#eab308','#64748b'];
let VT_CACHE=null;   // {vendors:{id:{...summary, monthly:[{month,amount}]}}, catColor:{category:hex}}
let VT_BU_ALL=null;  // [{business_unit,vendor_count,tx_count,total_spend}] — every unit that has data, loaded once
let VT_BU_SEL=null;  // Set of currently-selected business_unit strings (defaults to "all selected")

function vtEmptyNote(msg){ return '<div class="card card-pad empty" style="padding:24px;text-align:center;color:var(--slate)">'+esc(msg)+'</div>'; }
function vtHhiLabel(h){ h=Number(h)||0; return h<1500?'unconcentrated':h<2500?'moderate concentration':'high concentration'; }
function vtInr(n){ return '₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0}); }
function vtPct(n){ return n==null?'—':(n>0?'+':'')+n+'%'; }
function vtPctColor(n){ return n==null?'var(--slate)':(n>0?'#16a34a':n<0?'#c83232':'var(--slate)'); }
function vtDfmt(d){ return d?new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'—'; }
function vtStatusTag(s){ return ({New:'<span class="tag t-blue">New</span>',Growing:'<span class="tag t-green">Growing</span>',
  Stable:'<span class="tag t-gray">Stable</span>',Declining:'<span class="tag t-amber">Declining</span>',
  Inactive:'<span class="tag t-red">Inactive</span>'}[s]||esc(s)); }
function vtDot(color){ return '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+color+';margin-right:7px;vertical-align:middle"></span>'; }
function vtCatCell(cat){ return vtDot((VT_CACHE&&VT_CACHE.catColor[cat])||'#94a3b8')+esc(cat); }
function vtVendorLink(id,name){ return '<a href="javascript:void(0)" onclick="vtOpenVendor('+id+')" style="font-weight:600;color:var(--brand);text-decoration:none" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">'+esc(name)+'</a>'; }

function vtBuFilterHtml(){
  if(!VT_BU_ALL||VT_BU_ALL.length<2) return ''; // one unit (or none yet) - a filter has nothing to filter
  const opts=VT_BU_ALL.map(function(b){
    const on=VT_BU_SEL.has(b.business_unit);
    return '<div class="ms-opt'+(on?' on':'')+'" onclick="vtBuToggle(\''+esc(b.business_unit).replace(/'/g,"\\'")+'\')">'+
      '<i class="fa-solid fa-'+(on?'square-check':'square')+'" style="width:18px;color:'+(on?'var(--brand)':'#94a3b8')+'"></i>'+
      '<span style="flex:1">'+esc(b.business_unit)+'</span>'+
      '<span style="color:var(--slate);font-size:11.5px">'+vtInr(b.total_spend)+'</span></div>';
  }).join('');
  const label=VT_BU_SEL.size===VT_BU_ALL.length?'All business units':VT_BU_SEL.size+' of '+VT_BU_ALL.length+' business units';
  return '<div class="card card-pad" style="margin-bottom:16px">'+
    '<label style="display:block;font-size:12.5px;font-weight:600;color:#334155;margin-bottom:6px"><i class="fa-solid fa-building"></i> Business unit</label>'+
    '<div class="ms" id="ms_vtbu">'+
      '<div class="ms-field" onclick="msFieldClick(\'vtbu\',event)">'+
        '<span class="ms-chips">'+esc(label)+'</span>'+
        '<i class="fa-solid fa-chevron-down" style="color:#94a3b8;font-size:12px"></i>'+
      '</div>'+
      '<div class="ms-panel" id="ms_vtbu_panel"><div class="ms-list">'+opts+'</div></div>'+
    '</div></div>';
}
window.vtBuToggle=function(bu){
  if(VT_BU_SEL.has(bu)){ if(VT_BU_SEL.size>1) VT_BU_SEL.delete(bu); } // always keep at least one selected
  else VT_BU_SEL.add(bu);
  procVendorTrendsRender();
};

async function procVendorTrendsRender(){
  const host=$('vtHost');if(!host)return;
  host.innerHTML='<div class="card card-pad empty" style="padding:48px;text-align:center;color:var(--slate)"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px;margin-bottom:10px;display:block"></i>Crunching vendor data…</div>';
  const K=sb.schema('kraya');
  if(!VT_BU_ALL){
    const bu=await K.rpc('vtrend_business_units');
    if(bu.error){ host.innerHTML=vtEmptyNote('Could not load business units: '+bu.error.message); return; }
    VT_BU_ALL=bu.data||[];
    VT_BU_SEL=new Set(VT_BU_ALL.map(function(b){return b.business_unit;})); // default: every unit selected
  }
  const buFilterHtml=vtBuFilterHtml();
  // null = "all units" (matches every RPC's default and lets the DB skip the filter entirely)
  const selBu=VT_BU_SEL.size===VT_BU_ALL.length?null:Array.from(VT_BU_SEL);
  const rpcArgs=selBu?{p_business_units:selBu}:{};
  const [ov,mo,cat,vs,an,vm]=await Promise.all([
    K.rpc('vtrend_overview',rpcArgs), K.rpc('vtrend_monthly',rpcArgs), K.rpc('vtrend_category_monthly',rpcArgs),
    K.rpc('vtrend_vendor_summary',rpcArgs), K.rpc('vtrend_anomalies',rpcArgs), K.rpc('vtrend_vendor_monthly_all',rpcArgs)
  ]);
  const firstErr=ov.error||mo.error||cat.error||vs.error||an.error||vm.error;
  if(firstErr){ host.innerHTML=buFilterHtml+vtEmptyNote('Could not load vendor trend data: '+firstErr.message); return; }

  const O=ov.data||{}, MO=mo.data||[], CAT=cat.data||[], VS=vs.data||[], AN=an.data||[], VM=vm.data||[];

  // One category → colour map, shared by the doughnut chart, every category cell's dot, and the
  // vendor detail modal — ranked by all-time spend so the biggest slice always reads as the same hue.
  const catTotalsAll={};
  CAT.forEach(function(c){ catTotalsAll[c.category]=(catTotalsAll[c.category]||0)+Number(c.amount); });
  const catOrder=Object.keys(catTotalsAll).sort(function(a,b){return catTotalsAll[b]-catTotalsAll[a];});
  const catColor={}; catOrder.forEach(function(c,i){ catColor[c]=VT_PALETTE[i%VT_PALETTE.length]; });

  const vendorMonthly={};
  VM.forEach(function(r){ (vendorMonthly[r.vendor_id]=vendorMonthly[r.vendor_id]||[]).push({month:r.month,amount:Number(r.amount)}); });
  const anomalySet=new Set(AN.map(function(a){ return a.vendor_id+'|'+a.month; }));
  const vendorsById={};
  VS.forEach(function(x){ vendorsById[x.vendor_id]=Object.assign({},x,{monthly:(vendorMonthly[x.vendor_id]||[]).sort(function(a,b){return new Date(a.month)-new Date(b.month);})}); });
  VT_CACHE={vendors:vendorsById, catColor:catColor, anomalySet:anomalySet};

  const kpis=[
    {ic:'fa-sack-dollar',bg:'#eff4ff',c:'#1d4ed8',val:vtInr(O.total_spend),lbl:'Total Spend (24 mo)',
      sub:(O.total_vendors||0)+' vendors · '+(O.total_transactions||0)+' invoices',go:'vt-sec-trend'},
    {ic:'fa-users',bg:'#f0fdf4',c:'#16a34a',val:O.active_vendors_90d||0,lbl:'Active Vendors (90d)',
      sub:'of '+(O.total_vendors||0)+' total',go:'vt-sec-all'},
    {ic:(O.yoy_change_pct>=0?'fa-arrow-trend-up':'fa-arrow-trend-down'),bg:'#fffbeb',c:'#d97706',val:vtPct(O.yoy_change_pct),lbl:'YoY Spend Change',
      sub:'vs prior 12 months',go:'vt-sec-growdecl'},
    {ic:'fa-layer-group',bg:'#f5f3ff',c:'#7c3aed',val:(O.top5_share_pct||0)+'%',lbl:'Top 5 Concentration',
      sub:'HHI '+O.hhi+' · '+(O.vendors_for_80pct||'—')+' vendors = 80% of spend',go:'vt-sec-conc'}
  ];
  const kpiHtml='<div class="grid kpis">'+kpis.map(function(k){
    return '<div class="kpi" onclick="vtScrollTo(\''+k.go+'\')" style="cursor:pointer;transition:transform .12s,box-shadow .12s" onmouseover="this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'var(--shadow-lg,0 10px 24px rgba(15,23,42,.12))\'" onmouseout="this.style.transform=\'\';this.style.boxShadow=\'\'">'+
      '<div class="top"><div class="ic" style="background:'+k.bg+';color:'+k.c+'"><i class="fa-solid '+k.ic+'"></i></div><i class="fa-solid fa-arrow-up-right-from-square" style="color:var(--slate-2);font-size:11px"></i></div>'+
      '<div class="val">'+k.val+'</div><div class="lbl">'+k.lbl+'</div>'+
      '<div style="font-size:11.5px;color:var(--slate);margin-top:6px">'+k.sub+'</div>'+
    '</div>';
  }).join('')+'</div>';

  const major=VS.slice().sort(function(a,b){return b.total_spend-a.total_spend;}).slice(0,10);
  const newV=VS.filter(function(x){return x.status==='New';});
  const inactiveV=VS.filter(function(x){return x.status==='Inactive';}).sort(function(a,b){return new Date(b.last_purchase)-new Date(a.last_purchase);});
  const growDecline=VS.filter(function(x){return x.status==='Growing'||x.status==='Declining';}).sort(function(a,b){return Math.abs(b.change_pct||0)-Math.abs(a.change_pct||0);});

  const majorRows=major.map(function(x){return [vtVendorLink(x.vendor_id,x.name),vtCatCell(x.category),vtInr(x.total_spend),x.share_pct+'%',vtStatusTag(x.status)];});
  const newRows=newV.map(function(x){return [vtVendorLink(x.vendor_id,x.name),vtCatCell(x.category),vtDfmt(x.first_purchase),vtInr(x.total_spend)];});
  const inactiveRows=inactiveV.map(function(x){return [vtVendorLink(x.vendor_id,x.name),vtCatCell(x.category),vtDfmt(x.last_purchase),vtInr(x.total_spend)];});
  const gdRows=growDecline.map(function(x){return [vtVendorLink(x.vendor_id,x.name),vtCatCell(x.category),vtStatusTag(x.status),'<span style="color:'+vtPctColor(x.change_pct)+';font-weight:600">'+vtPct(x.change_pct)+'</span>',vtInr(x.recent_spend)];});
  const anRows=AN.map(function(x){return [vtVendorLink(x.vendor_id,x.name),vtCatCell(x.category),new Date(x.month).toLocaleDateString('en-IN',{month:'short',year:'numeric'}),vtInr(x.amount),vtInr(x.trailing_avg),x.multiple+'×'];});

  // All Vendors gets its own hand-built table (not mTable) so each row can carry a search key for
  // the filter box above it — 43+ rows is exactly the case "don't discard the underlying data"
  // was written for, so the answer is a searchable table, not a trimmed one.
  const allBody=VS.map(function(x){
    return '<tr data-vt-s="'+esc((x.name+' '+x.category).toLowerCase())+'">'+
      '<td>'+vtVendorLink(x.vendor_id,x.name)+'</td><td>'+vtCatCell(x.category)+'</td>'+
      '<td>'+vtInr(x.total_spend)+'</td><td>'+x.share_pct+'%</td><td>'+vtStatusTag(x.status)+'</td><td>'+vtDfmt(x.last_purchase)+'</td></tr>';
  }).join('');

  host.innerHTML=
    buFilterHtml+
    kpiHtml+
    '<div class="grid" id="vt-sec-trend" style="grid-template-columns:1.4fr 1fr;gap:16px;margin-top:20px;scroll-margin-top:16px">'+
      '<div class="card card-pad"><h3 style="margin:0 0 12px"><i class="fa-solid fa-chart-line" style="color:#0369a1"></i> Monthly Spend Trend</h3><div style="height:260px"><canvas id="vtChMonthly"></canvas></div></div>'+
      '<div class="card card-pad"><h3 style="margin:0 0 12px"><i class="fa-solid fa-chart-pie" style="color:#0369a1"></i> Spend by Category (last 12 mo)</h3><div style="height:260px"><canvas id="vtChCategory"></canvas></div></div>'+
    '</div>'+
    '<div style="margin-top:22px"><h3><i class="fa-solid fa-crown" style="color:#b45309"></i> Major Vendors</h3><p style="color:var(--slate);font-size:13px;margin:2px 0 10px">Top 10 by total spend over the last 24 months — click a name for its full history.</p>'+mTable(['Vendor','Category','Total Spend','Share of Spend','Status'],majorRows)+'</div>'+
    '<div style="margin-top:22px"><h3><i class="fa-solid fa-star" style="color:#2563eb"></i> New Vendors</h3><p style="color:var(--slate);font-size:13px;margin:2px 0 10px">First purchase within the last 90 days.</p>'+(newRows.length?mTable(['Vendor','Category','First Purchase','Spend to Date'],newRows):vtEmptyNote('No new vendors in the last 90 days.'))+'</div>'+
    '<div style="margin-top:22px"><h3><i class="fa-solid fa-triangle-exclamation" style="color:#c83232"></i> Inactive Vendors</h3><p style="color:var(--slate);font-size:13px;margin:2px 0 10px">No purchase in the last 120+ days, despite prior activity.</p>'+(inactiveRows.length?mTable(['Vendor','Category','Last Purchase','Lifetime Spend'],inactiveRows):vtEmptyNote('No vendors have gone quiet.'))+'</div>'+
    '<div id="vt-sec-growdecl" style="margin-top:22px;scroll-margin-top:16px"><h3><i class="fa-solid fa-arrows-up-down" style="color:#0d9488"></i> Growing / Declining Dependency</h3><p style="color:var(--slate);font-size:13px;margin:2px 0 10px">Last 6 months vs. the 6 months before that, ranked by size of the swing.</p>'+(gdRows.length?mTable(['Vendor','Category','Trend','Change','Last 6 mo Spend'],gdRows):vtEmptyNote('No significant swings.'))+'</div>'+
    '<div id="vt-sec-conc" style="margin-top:22px;scroll-margin-top:16px"><h3><i class="fa-solid fa-layer-group" style="color:#7c3aed"></i> Vendor Concentration</h3>'+
      '<div class="grid" style="grid-template-columns:repeat(4,1fr);gap:14px">'+
        vtConcCard('fa-medal','#7c3aed',(O.top5_share_pct||0)+'%','held by top 5 vendors')+
        vtConcCard('fa-ranking-star','#7c3aed',(O.top10_share_pct||0)+'%','held by top 10 vendors')+
        vtConcCard('fa-gauge-high','#7c3aed',O.hhi,'HHI — '+vtHhiLabel(O.hhi))+
        vtConcCard('fa-scale-balanced','#7c3aed',O.vendors_for_80pct,'vendors make up 80% of spend')+
      '</div></div>'+
    '<div style="margin-top:22px"><h3><i class="fa-solid fa-bolt" style="color:#e08600"></i> Unusual / Exceptional Movements</h3><p style="color:var(--slate);font-size:13px;margin:2px 0 10px">A single month over 2.5× that vendor\'s own trailing 6-month average.</p>'+(anRows.length?mTable(['Vendor','Category','Month','Amount','Typical Month','Multiple'],anRows):vtEmptyNote('No unusual spikes detected.'))+'</div>'+
    '<div id="vt-sec-all" style="margin-top:22px;scroll-margin-top:16px"><h3><i class="fa-solid fa-list" style="color:#334155"></i> All Vendors ('+VS.length+')</h3><p style="color:var(--slate);font-size:13px;margin:2px 0 10px">Full vendor base, ranked by total spend. Click any name for its monthly history.</p>'+
      '<div style="margin-bottom:10px;max-width:320px"><div style="position:relative"><i class="fa-solid fa-magnifying-glass" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--slate-2);font-size:12px"></i><input id="vtSearch" oninput="vtFilterVendors()" placeholder="Search vendor or category…" style="width:100%;padding:9px 12px 9px 32px;border:1px solid var(--line);border-radius:8px;font-size:13px"></div></div>'+
      '<div class="card qc-table-card" style="padding:0"><div style="overflow-x:auto;max-height:520px"><table class="tbl"><thead><tr><th>Vendor</th><th>Category</th><th>Total Spend</th><th>Share</th><th>Status</th><th>Last Purchase</th></tr></thead><tbody id="vtAllBody">'+allBody+'</tbody></table></div></div>'+
      '<div id="vtSearchEmpty" style="display:none">'+vtEmptyNote('No vendor matches that search.')+'</div>'+
    '</div>'+
    '<div style="margin-top:14px;font-size:11.5px;color:var(--slate)">'+VS.length+' vendors, '+(O.total_transactions||0)+' invoices, as of '+vtDfmt(O.as_of)+(selBu?' · filtered to '+selBu.length+' of '+VT_BU_ALL.length+' business units':'')+'.</div>';

  setTimeout(function(){
    if(!window.Chart)return;
    const gy={grid:{color:'#f1f5f9'},ticks:{font:{size:11}}},gx={grid:{display:false},ticks:{font:{size:11}}};
    const mlabels=MO.map(function(m){return new Date(m.month).toLocaleDateString('en-IN',{month:'short',year:'2-digit'});});
    try{new Chart(document.getElementById('vtChMonthly'),{type:'line',data:{labels:mlabels,datasets:[{label:'Spend (₹)',data:MO.map(function(m){return m.amount;}),borderColor:'#0369a1',backgroundColor:'rgba(3,105,161,.08)',fill:true,tension:.3,pointRadius:0,borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:gy,x:gx}}});}catch(e){}

    const last12start=O.as_of?new Date(O.as_of):new Date();
    last12start.setMonth(last12start.getMonth()-11);
    const catTotals12={};
    CAT.forEach(function(c){ if(new Date(c.month)>=last12start){ catTotals12[c.category]=(catTotals12[c.category]||0)+Number(c.amount); } });
    const catLabels=catOrder.filter(function(c){return catTotals12[c];});
    try{new Chart(document.getElementById('vtChCategory'),{type:'doughnut',data:{labels:catLabels,datasets:[{data:catLabels.map(function(c){return catTotals12[c];}),backgroundColor:catLabels.map(function(c){return catColor[c];}),borderWidth:2,borderColor:'#fff'}]},options:{responsive:true,maintainAspectRatio:false,cutout:'58%',plugins:{legend:{position:'right',labels:{boxWidth:10,font:{size:10.5}}}}}});}catch(e){}
  },60);
}

function vtConcCard(icon,color,val,lbl){
  return '<div class="card card-pad" style="text-align:center">'+
    '<div class="ic" style="background:'+color+'18;color:'+color+';margin:0 auto 10px"><i class="fa-solid '+icon+'"></i></div>'+
    '<div style="font-size:22px;font-weight:700">'+val+'</div><div style="font-size:12px;color:var(--slate);margin-top:2px">'+esc(lbl)+'</div>'+
  '</div>';
}

window.vtScrollTo=function(id){ const el=$(id); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); };

window.vtFilterVendors=function(){
  const q=($('vtSearch').value||'').trim().toLowerCase();
  const rows=document.querySelectorAll('#vtAllBody tr');
  let shown=0;
  rows.forEach(function(tr){ const m=!q||tr.getAttribute('data-vt-s').indexOf(q)!==-1; tr.style.display=m?'':'none'; if(m)shown++; });
  const empty=$('vtSearchEmpty'); if(empty) empty.style.display=shown?'none':'block';
  usageQueueDebounced('procurement.vendor_trends.search_filter_vendors', q);
};

window.vtOpenVendor=function(id){
  if(!VT_CACHE||!VT_CACHE.vendors[id])return;
  const v=VT_CACHE.vendors[id];
  openModal(
    '<div class="modal-head"><h3><i class="fa-solid fa-building" style="color:#0369a1"></i> '+esc(v.name)+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'+
    '<div class="modal-body">'+
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:18px">'+vtStatusTag(v.status)+'<span class="tag t-gray">'+vtCatCell(v.category)+'</span></div>'+
      '<div class="grid" style="grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">'+
        vtStatBlock('Total Spend',vtInr(v.total_spend))+vtStatBlock('Share of Spend',v.share_pct+'%')+
        vtStatBlock('First Purchase',vtDfmt(v.first_purchase))+vtStatBlock('Last Purchase',vtDfmt(v.last_purchase))+
        vtStatBlock('Invoices',v.tx_count)+vtStatBlock('Last 6 mo',vtInr(v.recent_spend))+
        vtStatBlock('Prior 6 mo',vtInr(v.previous_spend))+vtStatBlock('Change','<span style="color:'+vtPctColor(v.change_pct)+'">'+vtPct(v.change_pct)+'</span>')+
      '</div>'+
      '<h4 style="margin:0 0 10px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--slate)">Monthly Spend History</h4>'+
      (v.monthly.length?'<div style="height:220px"><canvas id="vtVendorCh"></canvas></div>':vtEmptyNote('No purchases recorded for this vendor.'))+
      (v.monthly.some(function(m){return VT_CACHE.anomalySet.has(id+'|'+m.month);})?'<div style="margin-top:10px;font-size:12px;color:#e08600"><i class="fa-solid fa-bolt"></i> Amber bars mark months flagged as unusual spikes.</div>':'')+
    '</div>'+
    '<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>',
    'lg'
  );
  setTimeout(function(){
    if(!window.Chart||!v.monthly.length)return;
    const labels=v.monthly.map(function(m){return new Date(m.month).toLocaleDateString('en-IN',{month:'short',year:'2-digit'});});
    const colors=v.monthly.map(function(m){return VT_CACHE.anomalySet.has(id+'|'+m.month)?'#e08600':'#0369a1';});
    try{new Chart(document.getElementById('vtVendorCh'),{type:'bar',data:{labels:labels,datasets:[{label:'Spend',data:v.monthly.map(function(m){return m.amount;}),backgroundColor:colors,borderRadius:5,maxBarThickness:30}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{grid:{color:'#f1f5f9'},ticks:{font:{size:10.5}}},x:{grid:{display:false},ticks:{font:{size:10.5}}}}}});}catch(e){}
  },60);
};
function vtStatBlock(lbl,val){ return '<div><div style="font-size:11px;color:var(--slate)">'+esc(lbl)+'</div><div style="font-weight:700;font-size:16px;margin-top:2px">'+val+'</div></div>'; }

VIEWS.procurement=function(v,seg){
  setCrumb(['Operations','Procurement']);
  const tabs=['Indent','Quote Comp','PO','GRN','Vendor Trends'];const ti=mTab(seg,tabs.length);
  const cat=tabs[ti];
  const subtitle='Indents · Quote Comparison · Purchase Orders · GRN · Vendor Trends';
  PROC.sel.clear();
  if(ti===1){// Quote Comp
    v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-file-invoice" style="color:#0369a1"></i> Procurement</h1><p>${subtitle}</p></div></div>`+
      mTabs('procurement',tabs,ti)+
      `<div style="margin-top:20px">
        <div id="procBar" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px"></div>
        <div id="procHost"></div>
      </div>`;
    procRefresh(cat);
  } else if(ti===4){// Vendor Trends
    v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-file-invoice" style="color:#0369a1"></i> Procurement</h1><p>${subtitle}</p></div></div>`+
      mTabs('procurement',tabs,ti)+
      `<div style="margin-top:20px" id="vtHost"></div>`;
    procVendorTrendsRender();
  } else {
    v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-file-invoice" style="color:#0369a1"></i> Procurement</h1><p>${subtitle}</p></div></div>`+
      mTabs('procurement',tabs,ti)+
      `<div style="margin-top:20px">`+mSoon(cat)+`</div>`;
  }
};


VIEWS.maintenance=function(v,seg){
  setCrumb(['Operations','Assets & Maintenance']);
  const tabs=['Asset register','Preventive maintenance','Breakdowns & repairs','Location-wise'];const ti=mTab(seg,tabs.length);
  const kpis=[['Total assets','311','6 sites'],['Active','291','94%','#16855a'],['Under repair','4','2 overdue','#c83232'],['PM due (7 days)','12','across sites','#e08600']];
  let body;
  if(ti===0){ body=mTable(['Tag','Asset','Category','Location','Status','Warranty'],[['AST-0112','DG Set 250 kVA','Mechanical','Dream Valley','<span class="tag t-green">Active</span>','Till Mar-27'],['AST-0113','Passenger lift — Tower B','Mechanical','Jain Heights','<span class="tag t-red">Under repair</span>','AMC active'],['AST-0114','Tower crane','Civil','Dream Valley','<span class="tag t-green">Active</span>','Leased'],['AST-0115','Site office HVAC','Electrical','Trade Centre','<span class="tag t-green">Active</span>','Till Dec-26'],['AST-0116','Survey total station','IT','Green Acres','<span class="tag t-gray">Idle</span>','Expired']]); }
  else if(ti===1){ body=mTable(['Asset','Frequency','Last PM','Next PM','Owner'],[['DG Set 250 kVA','Monthly','02 Jun','02 Jul','Facility']]); }
  else if(ti===2){ body=mTable(['Ticket','Asset','Issue','Raised','Status'],[['BD-22','Passenger lift','Door fault','Today','Open']]); }
  else { body=mTable(['Location','Assets','Active','Under repair'],[['Dream Valley','86','80','3'],['Jain Heights','54','50','1']]); }
  v.innerHTML=mHead('fa-screwdriver-wrench','#7c3aed','Assets & Maintenance')+mKpis(kpis)+mTabs('maintenance',tabs,ti)+'<div style="margin-top:14px">'+body+'</div>';
};

/* ---------- INTERNET SPEED MONITOR ----------
   Reads the net_* tables (public schema) populated by the office laptops'
   speed-monitor agent. Read-only: RLS lets any signed-in user SELECT these. */
const NET_RANGES=[['today','Today'],['3d','Last 3 days'],['5d','Last 5 days'],['30d','Last 1 month']];
let NET_RANGE='today';
window.netRangeChange=function(v){
  /* The same picker is rendered on Overview and on All readings. Logged through USAGE_MAP it
     always reported the Overview key, so the All readings filter read 0 no matter how often it
     was used. The hash says which tab the person is actually on. */
  try{
    const seg=String(location.hash||'').replace(/^#\/?/,'').split('/').filter(Boolean);
    const onAll=(seg[seg.length-1]==='1');
    const label=((typeof NET_RANGES!=='undefined'&&(NET_RANGES.find(function(r){return r[0]===v;})||[]))[1])||v;
    usageQueue(onAll?'network.all_readings.filter_readings_by_date_range'
                   :'network.overview.filter_chart_by_date_range','search',{title:label});
  }catch(_e){}
  NET_RANGE=v; renderPage();
};

/* ---- Low-speed snapshot viewer: DISABLED ----------------------------------
   Snapshot images are no longer generated by the agent, so the Snapshot column
   and this modal are switched off. Un-comment this function and the two blocks
   marked "snapshot column" / "alerts" below to bring them back.

// Open a low-speed snapshot in a modal. URLs are held in window.__netSnaps and
// referenced by index, so nothing is injected into the onclick attribute.
window.netSnap=function(i){
  const url=(window.__netSnaps||[])[i]; if(!url)return;
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-image" style="color:#0ea5e9"></i> Low-speed snapshot</h3></div>'
    +'<div class="modal-body" style="text-align:center"><img src="'+esc(url)+'" alt="Low-speed snapshot" style="max-width:100%;border-radius:8px;border:1px solid var(--line-2)">'
    +'<div style="margin-top:12px"><a class="btn" href="'+esc(url)+'" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i> Open full size</a></div></div>','lg');
};
--------------------------------------------------------------------------- */

/* ---- "Refresh now" — measure the office line on demand --------------------
   The browser can't measure the office internet itself (it would measure
   whoever is viewing this page, possibly a phone on mobile data). So it asks
   the office laptop that is currently measuring to run a test: net_request_test
   queues the request, that laptop picks it up within ~10 seconds, runs a real
   Ookla test, stores the reading and reports back on the same row.

   Side effect by design: the laptop restarts its interval clock from that test,
   so the automatic schedule counts forward from this reading. */
const NET_LEASE_S=180;        // matches PRESENCE_LEASE_SECONDS in the agent
const NET_POLL_MS=2500;       // how often we re-check the request row
const NET_GIVEUP_MS=5*60*1000;
let NET_BUSY=false;           // a refresh we are waiting for (survives re-renders)

function netMsg(html,color){
  const e=$('netRefreshMsg'); if(!e)return;          // user may have switched tab
  e.innerHTML=html?('<span style="color:'+(color||'var(--slate)')+'">'+html+'</span>'):'';
}
function netBtnBusy(busy){
  const b=$('netRefreshBtn'); if(!b)return;
  b.disabled=!!busy;
  b.innerHTML=busy
    ? '<i class="fa-solid fa-spinner fa-spin"></i> Testing…'
    : '<i class="fa-solid fa-arrows-rotate"></i> Refresh now';
}
/** The laptops currently checked in, longest-present first (that one measures). */
async function netAliveLaptops(){
  const r=await sb.from('net_presence').select('device_key,last_seen,joined_at').order('joined_at',{ascending:true});
  if(r.error)throw r.error;
  const cut=Date.now()-NET_LEASE_S*1000;
  return (r.data||[]).filter(x=>new Date(x.last_seen).getTime()>=cut);
}
window.netRefresh=async function(){
  if(NET_BUSY)return;
  NET_BUSY=true; netBtnBusy(true);
  try{
    // Is any laptop there to run it? If not, that IS the answer — say so rather
    // than queueing a request nobody will ever pick up.
    const alive=await netAliveLaptops();
    if(!alive.length){
      netMsg('No internet connection — no office laptop is online to measure it. '
        +'Start the speed-monitor agent on an office laptop (office hours only).','#c83232');
      toast('No office laptop is online','err');
      return;
    }
    netMsg('Asking the <b>office network</b> to run a speed test… this takes about 30–60 seconds.');

    const q=await sb.rpc('net_request_test',{p_source:'intranet'});
    if(q.error)throw q.error;
    const req=Array.isArray(q.data)?q.data[0]:q.data;
    if(!req||!req.id)throw new Error('the database did not return a request to follow');

    await netFollowRequest(req.id);
  }catch(e){
    netMsg('Could not request a test — '+esc(e.message||String(e)),'#c83232');
    toast('Refresh failed','err');
  }finally{
    NET_BUSY=false; netBtnBusy(false);
  }
};
async function netFollowRequest(id){
  const t0=Date.now();
  while(Date.now()-t0<NET_GIVEUP_MS){
    await new Promise(r=>setTimeout(r,NET_POLL_MS));
    const r=await sb.from('net_test_requests').select('status,claimed_by,speed_test_id,error_message').eq('id',id).maybeSingle();
    if(r.error)continue;                              // a read hiccup is not a failed test
    const req=r.data;
    if(!req){ netMsg('The refresh request disappeared.','#c83232'); return; }
    const secs=Math.round((Date.now()-t0)/1000);

    if(req.status==='pending'){ netMsg('Waiting for the <b>office network</b> to pick it up… ('+secs+'s)'); continue; }
    if(req.status==='running'){ netMsg('The <b>office network</b> is testing the office internet now… ('+secs+'s)'); continue; }
    if(req.status==='done'){
      toast('Office internet measured','ok');
      renderPage();                                   // pulls the new reading in
      return;
    }
    // failed / expired
    netMsg('The test did not complete — '+esc(req.error_message||'the measuring laptop did not report a result.'),'#c83232');
    toast('Test did not complete','err');
    return;
  }
  netMsg('Gave up waiting for the office laptop — it may have gone offline mid-test.','#c83232');
}
VIEWS.network=async function(v,seg){
  setCrumb(['IT & Support','Internet Speed']);
  const tabs=['Overview','All readings'];
  const ti=mTab(seg,tabs.length);
  // The "Live check" bar sits OUTSIDE #netBody so a tab switch or a data reload
  // doesn't wipe the progress message of a refresh that is still running.
  v.innerHTML=mHead('fa-wifi','#0ea5e9','Internet Speed Monitor')+mTabs('network',tabs,ti)
    +'<div class="card card-pad net-livebar" style="margin-top:16px">'
      +'<div class="net-livebar-txt"><div class="sec-title" style="margin:0">Live check</div>'
      +'<div class="sec-sub" id="netPoolMsg" style="margin:0">Runs a speed test on the office line right now and stores the reading</div></div>'
      +'<button class="btn btn-primary" id="netRefreshBtn" onclick="netRefresh()">'
      +'<i class="fa-solid fa-arrows-rotate"></i> Refresh now</button>'
      +'<div id="netRefreshMsg" style="flex-basis:100%;font-size:13px"></div>'
    +'</div>'
    +'<div id="netBody" style="margin-top:16px"><div class="loader"><div class="spin"></div></div></div>';
  const host=$('netBody');
  netBtnBusy(NET_BUSY);   // a refresh may still be in flight from before this render
  const nf=(n,d=1)=>(n==null||isNaN(n))?'—':Number(n).toFixed(d);
  const tag=s=>'<span class="tag '+(s==='ok'?'t-green':s==='low'?'t-red':'t-amber')+'">'+esc(s||'—')+'</span>';
  try{
    const dayAgoMs=Date.now()-24*3600*1000;
    const [tRes,sRes,pRes]=await Promise.all([
      sb.from('net_speed_tests').select('id,device_key,tested_at,download_mbps,upload_mbps,ping_ms,jitter_ms,isp,server_location,status').order('tested_at',{ascending:false}).limit(5000),
      sb.from('net_settings').select('*').eq('device_key','office').maybeSingle(),
      sb.from('net_presence').select('device_key,last_seen,joined_at').order('joined_at',{ascending:true}),
      /* ---- alerts: DISABLED ------------------------------------------------
         The alert rows drove the Snapshot column and the "Low readings" KPI.
         Both now come from net_speed_tests.status instead, so net_alerts is no
         longer read here. Un-comment this fetch (and put aRes back in the
         destructuring above) to restore it.
      sb.from('net_alerts').select('*').order('occurred_at',{ascending:false}).limit(2000),
      --------------------------------------------------------------------- */
    ]);
    if(tRes.error)throw tRes.error;
    const tests=tRes.data||[];
    // const alerts=aRes.data||[];
    // Snapshot lookup (low reading id → image URL) — disabled with the alerts.
    // const alertByTestId={};
    // alerts.forEach(a=>{ if(a.speed_test_id!=null && a.screenshot_url) alertByTestId[a.speed_test_id]=a.screenshot_url; });
    const settings=(sRes&&sRes.data)||{};
    // Which laptops are checked in right now, longest-present first. The first
    // one is the single active measurer; an empty list means nothing is
    // measuring the office line at all.
    const aliveCut=Date.now()-NET_LEASE_S*1000;
    const alive=((pRes&&pRes.data)||[]).filter(x=>new Date(x.last_seen).getTime()>=aliveCut);
    // Say plainly whether anything is measuring — that is the difference between
    // "waiting for the next test" and "no internet connection at the office".
    // The actual laptop/device name is never shown to users — only this generic label.
    const pool=$('netPoolMsg');
    if(pool){
      pool.innerHTML=alive.length
        ? '<b>Office network</b> measuring'
        : '<span style="color:#c83232">No office laptop is online — nothing is measuring the office line right now.</span>';
    }

    if(!tests.length){
      host.innerHTML='<div class="card card-pad empty"><i class="fa-solid fa-wifi"></i><div style="font-weight:600;color:var(--ink)">No speed readings yet</div><p style="max-width:460px;margin:6px auto 0">Once a monitored laptop runs the speed-monitor agent, its readings appear here automatically.</p></div>';
      return;
    }

    /* ---- OVERVIEW ---- */
    if(ti===0){
      const latest=tests.find(t=>t.download_mbps!=null);
      // Counted from the readings themselves now that net_alerts isn't read.
      const a24=tests.filter(t=>t.status==='low'&&new Date(t.tested_at).getTime()>=dayAgoMs).length;
      const kpis=[
        ['Latest download', latest?nf(latest.download_mbps)+' Mbps':'—', latest?relTime(latest.tested_at):''],
        ['Latest upload', latest?nf(latest.upload_mbps)+' Mbps':'—', ''],
        ['Latest ping', latest?nf(latest.ping_ms,0)+' ms':'—', latest&&latest.isp?latest.isp:''],
        ['Low readings (24h)', String(a24), a24?'below threshold':'all healthy', a24?'#c83232':'#16855a'],
      ];
      const metaCells=[['Interval',(settings.interval_minutes||'—')+' min'],
        ['Office hours',settings.office_start_hour!=null?(settings.office_start_hour+':00–'+settings.office_end_hour+':00'):'—'],
        ['Download threshold',(settings.download_threshold||'—')+' Mbps'],
        ['Upload threshold',(settings.upload_threshold||'—')+' Mbps'],
        ['Ping threshold',(settings.ping_threshold||'—')+' ms']];
      const rangeLabel=(NET_RANGES.find(r=>r[0]===NET_RANGE)||NET_RANGES[0])[1];
      const rangeSel='<select class="sel net-range-sel" id="netRangeSel" onchange="netRangeChange(this.value)">'
        +NET_RANGES.map(r=>'<option value="'+r[0]+'"'+(r[0]===NET_RANGE?' selected':'')+'>'+r[1]+'</option>').join('')+'</select>';
      host.innerHTML=mKpis(kpis)
        +'<div class="card card-pad net-chart-card" style="margin-top:16px"><div class="net-chart-head"><div><div class="sec-title">Speed over time</div><div class="sec-sub">Download vs upload · '+esc(rangeLabel)+' · red dashed line = alert threshold</div></div>'+rangeSel+'</div><div class="net-chart-wrap"><canvas id="chNet"></canvas></div></div>'
        +'<div class="card card-pad" style="margin-top:16px"><div class="sec-title">Monitoring settings</div><div class="sec-sub">Shared configuration · change in the net_settings table</div>'
          +'<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-top:8px">'
          +metaCells.map(x=>'<div><div style="color:var(--slate);font-size:12px">'+esc(x[0])+'</div><div style="font-weight:700;font-size:15px;margin-top:2px">'+esc(x[1])+'</div></div>').join('')
          +'</div></div>';
      // chart — points within the selected range, else fall back to the most recent 100 readings
      const now=new Date();
      let sinceMs;
      if(NET_RANGE==='today') sinceMs=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
      else sinceMs=now.getTime()-({'3d':3,'5d':5,'30d':30}[NET_RANGE]||1)*24*3600*1000;
      let pts=tests.filter(t=>t.download_mbps!=null&&new Date(t.tested_at).getTime()>=sinceMs);
      if(!pts.length)pts=tests.filter(t=>t.download_mbps!=null).slice(0,100);
      pts=pts.slice().reverse();
      const labels=pts.map(p=>NET_RANGE==='today'
        ?new Date(p.tested_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})
        :new Date(p.tested_at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}));
      // Drop invalid values (negative / non-finite / absurd — e.g. the Ookla
      // upload glitch) so one garbage number can't blow out the whole scale.
      const clean=v=>{ v=Number(v); return (isFinite(v)&&v>=0&&v<=100000)?v:null; };
      const rawDls=pts.map(p=>Number(p.download_mbps)), rawUls=pts.map(p=>Number(p.upload_mbps));
      const dls=rawDls.map(clean), uls=rawUls.map(clean);
      // Where a value was invalid, show a full-height red column so the bad
      // reading is obvious instead of dragging the line off the chart.
      const bad=pts.map((p,i)=>(clean(rawDls[i])===null||clean(rawUls[i])===null)?400:null);
      const thr=Number(settings.download_threshold)||0;
      const ds=[
        {label:'Download',data:dls,borderColor:'#0ea5e9',backgroundColor:'rgba(14,165,233,.08)',fill:true,tension:.35,borderWidth:2,pointRadius:2,spanGaps:false,order:1},
        {label:'Upload',data:uls,borderColor:'#16a34a',backgroundColor:'rgba(22,163,74,.05)',fill:true,tension:.35,borderWidth:2,pointRadius:2,spanGaps:false,order:1},
      ];
      if(bad.some(x=>x!==null))ds.unshift({type:'bar',label:'Bad reading',data:bad,backgroundColor:'rgba(220,38,38,.16)',borderColor:'rgba(220,38,38,.35)',borderWidth:0,barPercentage:1,categoryPercentage:1,order:5});
      if(thr>0)ds.push({label:'Threshold',data:labels.map(()=>thr),borderColor:'#dc2626',borderDash:[5,4],borderWidth:1.5,pointRadius:0,fill:false,order:0});
      new Chart($('chNet'),{type:'line',data:{labels,datasets:ds},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{usePointStyle:true,boxWidth:7,font:{size:12}}}},scales:{y:{min:0,max:400,ticks:{stepSize:50},grid:{color:'#eef1f6'},border:{display:false},title:{display:true,text:'Mbps'}},x:{grid:{display:false},ticks:{maxTicksLimit:8,autoSkip:true}}}}});
      return;
    }

    /* ---- ALL READINGS (status column; snapshot column is switched off) ---- */
    if(ti===1){
      const now=new Date();
      let sinceMs;
      if(NET_RANGE==='today') sinceMs=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
      else sinceMs=now.getTime()-({'3d':3,'5d':5,'30d':30}[NET_RANGE]||3)*24*3600*1000;
      const filtered=tests.filter(t=>new Date(t.tested_at).getTime()>=sinceMs);
      const lowCount=filtered.filter(t=>t.status!=='ok').length;
      // Status shows ONLY "ok" or "low". mTable renders a cell as HTML only when
      // it starts with "<span", so every rich cell is wrapped.
      const stPill=s=> s==='ok'
        ? '<span class="tag t-green">ok</span>'
        : '<span class="tag t-red">low</span>';
      const rows=filtered.map(t=>{
        /* ---- snapshot column: DISABLED ------------------------------------
           Snapshot images are no longer generated. Un-comment this, the `snaps`
           array, window.__netSnaps, netSnap() above, the net_alerts fetch and
           the 'Snapshot' header below to bring the column back.
        const url=alertByTestId[t.id];
        let snap='<span style="color:var(--slate)">—</span>';
        if(url){
          const i=snaps.push(url)-1;
          snap='<span><button class="btn" style="padding:5px 12px;font-size:12px" onclick="netSnap('+i+')"><i class="fa-solid fa-image"></i> View image</button></span>';
        }
        ------------------------------------------------------------------- */
        return [
          new Date(t.tested_at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}),
          stPill(t.status),
          nf(t.download_mbps), nf(t.upload_mbps), t.ping_ms!=null?nf(t.ping_ms,0):'—',
          t.isp||'—',
        ];
      });
      const rangeSel='<select class="sel net-range-sel" id="netRangeSel" onchange="netRangeChange(this.value)">'
        +NET_RANGES.map(r=>'<option value="'+r[0]+'"'+(r[0]===NET_RANGE?' selected':'')+'>'+r[1]+'</option>').join('')+'</select>';
      host.innerHTML='<div class="net-readings-head">'
        +'<div class="sec-sub" style="margin:0">Showing '+rows.length+' reading'+(rows.length===1?'':'s')+(lowCount?' · <span style="color:#c83232">'+lowCount+' low</span>':'')+'</div>'
        +rangeSel+'</div>'
        +(rows.length?mTable(['Time','Status','↓ Mbps','↑ Mbps','Ping','ISP'],rows):'<div class="card card-pad empty">No readings in this range</div>');
      return;
    }
  }catch(e){
    host.innerHTML='<div class="card card-pad empty"><i class="fa-solid fa-triangle-exclamation" style="color:#c83232"></i><div style="font-weight:600;color:var(--ink)">Couldn\'t load speed data</div><p style="max-width:440px;margin:6px auto 0">'+esc(e.message||String(e))+'</p></div>';
  }
};

// ── Recruitment ──────────────────────────────────────────────────────────────
let RT_RECORDS=null; // cached tests from DB
// Default JDs bundled with the app (from ./jd/ folder)
const DEFAULT_JDS=[]; // all JDs now stored in Supabase (recruit.job_descriptions)
let REC_SEL=new Set();
// Recruitment (New) -- retired recruitment.html's four tabs, ManPower Form/Referrals rebuilt on
// talent's approval-workflow versions (tpManpower/tpReferrals) instead of v1's recManpower/
// recReferrals, which are deleted. Tests are unchanged (recTests) -- both v1 and talent already
// shared it. Descriptions stays restricted to the 3 named HR approvers + Administrator
// (rtCanManage()'s own allowlist, not the wider recCanWrite() HR-department group).
// Pending Approvals is NOT a tab here any more -- a ManPower JD ready for review or a Referral just
// submitted creates a real task in Accountability's own Pending Approval card instead (see
// acc.hr_approval_task_upsert, called from manpower-ai-generate and hr.referral_approval_task_trg).
VIEWS.recruitment_new=async function(v,seg){
  setCrumb(['People','Recruitment']);
  const canApprove=rtCanManage();
  const slots=[
    {label:'Tests',run:recTests},
    canApprove?{label:'Job Descriptions',run:()=>recLoadJDs(v)}:null,
    {label:'Hiring Request',run:tpManpower},
    {label:recCanWrite()?'Referrals':'Refer to HR',run:tpReferrals},
  ].filter(Boolean);
  const tabs=slots.map(s=>s.label);
  const ti=mTab(seg,tabs.length);
  v.innerHTML=REC_RO_CSS+TP_CSS+mHead('fa-user-plus','#0369a1','Recruitment')
    +(recCanWrite()?'':'<div class="rec-ro"><i class="fa-solid fa-lock"></i> Approving, editing and deleting here is limited to HR, Abhay Mati and Administrators — anyone can still submit a ManPower Form or Referral.</div>')
    +mTabs('recruitment_new',tabs,ti)+'<div id="recBody" style="margin-top:16px"><div class="loader"><div class="spin"></div></div></div>';
  recWatchPerms();
  await slots[ti].run();
};

/* ── Tests (dynamic, DB-backed) ── */
let RT_SEL=new Set();
async function recTests(){
  const b=$('recBody');
  loader(b);
  if(!RT_RECORDS){
    try{const{data,error}=await sb.schema('recruit').from('tests').select('*').order('sl',{ascending:true});
      if(error)throw error; RT_RECORDS=data||[];}catch(e){b.innerHTML='<div class="empty" style="padding:40px;color:var(--err)">'+esc(e.message)+'</div>';return;}
  }
  RT_SEL=new Set();
  rtRender();
}
function rtRender(){
  const b=$('recBody'); if(!b)return;
  const rows=RT_RECORDS||[];
  const dis='opacity:.38;cursor:not-allowed;pointer-events:none';
  b.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <div class="sec-title" style="margin:0">Assessment Tests <span class="tag t-gray" style="margin-left:4px">${rows.length}</span></div>
    <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
      <!-- RENAME AND DELETE ARE GONE, BY REQUEST. A test is not a document to tidy: results,
           attempts and answers hang off it, and renaming one silently relabels every result
           already recorded against it. Email is what this screen is for. The functions are left
           in the file, unreferenced, so nothing is lost if they are ever wanted back. -->
      ${rtCanManage()?`
      <button class="btn" id="rtShareBtn" disabled style="${dis}" onclick="rtShare()"><i class="fa-solid fa-envelope"></i> Email</button>`
      : `<span style="font-size:12px;color:var(--slate);display:inline-flex;align-items:center;gap:6px"><i class="fa-solid fa-lock"></i> View only</span>`}
    </div>
  </div>
  <!-- NO SIDEWAYS SCROLL. The Form Link column was the widest thing here and, now that every test
       is built in JainE rather than being a Google Form, it held nothing but the words "Built in
       JainE - no external link" on every row. Taking it out is what lets the remaining five
       columns fit, so the table no longer runs past its own edge and needs no scrollbar to reach
       the buttons at the end of a row. The Test Name takes the freed space. -->
  <div class="card" style="overflow:hidden">
  <table class="tbl" id="rtTbl" style="table-layout:fixed;width:100%">
    <thead><tr>
      <th style="width:36px;text-align:center"><input type="checkbox" id="rtChkAll" onchange="rtToggleAll(this)"></th>
      <th style="width:52px;text-align:center">Sl.</th>
      <th style="width:60px;text-align:center">Type</th>
      <th>Test Name</th>
      <th style="width:200px;text-align:center">Actions</th>
    </tr></thead>
    <!-- Sl. is the row's position in this list, not the stored sl column. That column keeps the
         number a test was given when it was created, so deleting three tests left the list reading
         1, 2, 5, 6, 9 - which looks like rows are missing rather than like numbers were reused. -->
    <tbody>${rows.length?rows.map((t,i)=>{
      const native=t.engine==='native';
      return `<tr>
      <td style="text-align:center"><input type="checkbox" class="rt-chk" value="${t.id}" onchange="rtSyncToolbar()"></td>
      <td style="text-align:center;color:var(--slate);font-size:13px">${i+1}</td>
      <td style="text-align:center"><span class="tag ${native?'t-green':'t-gray'}" style="font-size:11px">${native?'Native':'Legacy'}</span></td>
      <!-- THE NAME IS THE WAY INTO THE QUESTIONS. The row used to carry a fourth button for it,
           which is what pushed the last button out of sight, and a button that only ever repeats
           what the row already says is a button worth not having. Clicking the name of a test to
           edit that test needs no label and costs no width. -->
      <td style="font-weight:500;overflow-wrap:anywhere">${native
        ?`<a href="javascript:void(0)" onclick="rtManageQuestions(${t.id})" style="color:var(--brand);text-decoration:none" title="Open this test's questions">${esc(t.name)}</a>`
        :esc(t.name)}${native&&t.duration_seconds?`<div style="font-size:11px;color:var(--slate);font-weight:400">${Math.round(t.duration_seconds/60)} min</div>`:''}</td>
      <!-- TWO BUTTONS. There were four, in a fixed-width column set to never wrap, so the last one
           was cropped off the edge with no scrollbar to reach it - present in the page and
           unusable, which reads as missing. Questions moved onto the test name; Get Link went
           entirely, because Email already sends a test and a link copied by hand bypasses the very
           thing that ties a result to a named candidate. -->
      <!-- TRY IT REMOVED, BY REQUEST. Sitting the paper yourself minted a real attempt against
           your own address, which then had to be filtered out of Results everywhere it appeared.
           The questions are readable by clicking the test's name, which is what people actually
           wanted it for. -->
      <td style="text-align:center;white-space:nowrap;padding-right:14px">${native
        ?`<button class="btn btn-sm" style="font-size:12px" onclick="rtResultsNative(${t.id})"><i class="fa-solid fa-chart-simple"></i> Results</button>`
        :`<span style="font-size:12px;color:var(--slate)">—</span>`}</td>
    </tr>`;}).join(''):'<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--slate)">No tests set up yet.</td></tr>'}
    </tbody>
  </table>
  </div>
  <div id="rtPreviewPanel" style="display:none;margin-top:16px"></div>
  <div id="rtQuestionsPanel" style="display:none;margin-top:16px"></div>`;
}
window.rtToggleAll=function(el){document.querySelectorAll('.rt-chk').forEach(c=>c.checked=el.checked);rtSyncToolbar();};
window.rtSyncToolbar=function(){
  // the toolbar buttons only exist for the four who may use them
  if(!rtCanManage()) return;
  const sel=[...document.querySelectorAll('.rt-chk:checked')];
  const n=sel.length;
  // Rename and Delete no longer exist on this screen; only Email is driven by the ticks.
  const dis='opacity:.38;cursor:not-allowed;pointer-events:none';
  const shr=$('rtShareBtn');
  if(shr){shr.disabled=n!==1;shr.style.cssText=n===1?'':dis;}
};
window.rtAdd=function(){if(!recGuard()||!rtTestsGuard())return;
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-plus"></i> Add Test</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>Test Name *</label><input id="rtFName" class="inp" placeholder="e.g. Sales Aptitude">
    <label>Type *</label>
    <select id="rtFEngine" class="inp" onchange="rtAddEngineToggle()">
      <option value="native">Native — built in JainE (MCQ + descriptive, AI-graded)</option>
      <option value="legacy">Legacy — external Google Form link</option>
    </select>
    <div id="rtFNativeFields">
      <label>Duration <span style="font-size:11px;color:var(--slate)">(minutes — shown to the candidate, informational only)</span></label>
      <input id="rtFDuration" class="inp" type="number" min="1" placeholder="e.g. 20">
    </div>
    <div id="rtFLegacyFields" style="display:none">
      <label>Form Link</label><input id="rtFLink" class="inp" placeholder="http://form-timer.com/start/...">
      <label>Response Sheet URL <span style="font-size:11px;color:var(--slate)">(Google Sheets URL for Preview)</span></label>
      <input id="rtFSheet" class="inp" placeholder="https://docs.google.com/spreadsheets/d/...">
    </div>
  </div>
  <div class="modal-foot"><button class="btn btn-primary" onclick="rtSave()">Add Test</button><button class="btn" onclick="closeModal()">Cancel</button></div>`);
  setTimeout(()=>{const el=$('rtFName');if(el)el.focus();},100);
};
window.rtAddEngineToggle=function(){
  const native=($('rtFEngine')||{}).value==='native';
  if($('rtFNativeFields'))$('rtFNativeFields').style.display=native?'':'none';
  if($('rtFLegacyFields'))$('rtFLegacyFields').style.display=native?'none':'';
};
window.rtSave=async function(){
  if(!rtTestsGuard())return;
  const name=($('rtFName')||{}).value?.trim();
  const engine=($('rtFEngine')||{}).value==='legacy'?'legacy':'native';
  if(!name){toast('Test name is required','err');return;}
  const maxSl=(RT_RECORDS||[]).reduce((m,r)=>Math.max(m,r.sl||0),0)+1;
  const row={sl:maxSl,name,engine};
  if(engine==='native'){
    const mins=parseInt(($('rtFDuration')||{}).value||'',10);
    row.link=''; row.duration_seconds=mins>0?mins*60:null;
  }else{
    row.link=($('rtFLink')||{}).value?.trim()||'';
    row.response_sheet_url=($('rtFSheet')||{}).value?.trim()||null;
  }
  const{data,error}=await sb.schema('recruit').from('tests').insert(row).select().single();
  if(error){toast(error.message,'err');return;}
  RT_RECORDS=[...(RT_RECORDS||[]),data];
  closeModal();toast('Test added');rtRender();
  if(engine==='native')rtManageQuestions(data.id);
};

/* ── Native test authoring ("the making part") — questions live in recruit.test_questions, one
   row per question, MCQ or descriptive. Nothing here is exposed publicly: only the 4 people in
   RT_TESTS_ALLOWED can reach this panel; the public candidate side is recruit-test-start/submit,
   which strip correct_option/model_answer before anything leaves the server. ── */
let RT_QUESTIONS=null, RT_QUESTIONS_TEST=null;
window.rtManageQuestions=async function(testId){
  const test=(RT_RECORDS||[]).find(t=>t.id===testId); if(!test)return;
  RT_QUESTIONS_TEST=test;
  const panel=$('rtQuestionsPanel'); if(!panel)return;
  panel.style.display='';
  loader(panel);
  panel.scrollIntoView({behavior:'smooth',block:'start'});
  const{data,error}=await sb.schema('recruit').from('test_questions').select('*').eq('test_id',testId).order('seq',{ascending:true});
  if(error){panel.innerHTML='<div class="empty" style="padding:20px;color:var(--err)">'+esc(error.message)+'</div>';return;}
  RT_QUESTIONS=data||[];
  rtQuestionsRender();
};
function rtQuestionsRender(){
  const panel=$('rtQuestionsPanel'); if(!panel||!RT_QUESTIONS_TEST)return;
  const rows=RT_QUESTIONS||[];
  const canEdit=rtCanManage();
  panel.innerHTML=`<div class="card" style="padding:16px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <div class="sec-title" style="margin:0">Questions — ${esc(RT_QUESTIONS_TEST.name)} <span class="tag t-gray">${rows.length}</span></div>
      <div style="margin-left:auto;display:flex;gap:8px">
        ${canEdit?`<button class="btn btn-sm btn-primary" onclick="rtQAdd()"><i class="fa-solid fa-plus"></i> Add Question</button>`:''}
        <button class="btn btn-sm" onclick="rtQuestionsClose()"><i class="fa-solid fa-xmark"></i> Close</button>
      </div>
    </div>
    ${rows.length?rows.map((q,i)=>`<div class="card" style="padding:12px;margin-bottom:8px;background:var(--bg2)">
      <div style="display:flex;gap:8px;align-items:flex-start">
        <span class="tag ${q.type==='mcq'?'t-blue':'t-amber'}" style="font-size:11px;flex:none">${q.type==='mcq'?'MCQ':'Descriptive'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500">${i+1}. ${esc(q.prompt)}</div>
          ${q.type==='mcq'?`<div style="font-size:12px;color:var(--slate);margin-top:4px">${(q.options||[]).map(o=>`<div style="${o===q.correct_option?'color:var(--ok);font-weight:600':''}">${o===q.correct_option?'✓ ':'· '}${esc(o)}</div>`).join('')}</div>`
            :`<div style="font-size:12px;color:var(--slate);margin-top:4px">Model answer: ${esc(q.model_answer||'—')}</div>`}
          <div style="font-size:11px;color:var(--slate);margin-top:4px">${q.max_marks} mark${q.max_marks==1?'':'s'}</div>
        </div>
        ${canEdit?`<button class="btn btn-sm" style="color:var(--err);border-color:var(--err);flex:none" onclick="rtQDelete(${q.id})"><i class="fa-solid fa-trash"></i></button>`:''}
      </div>
    </div>`).join(''):'<div class="empty" style="padding:20px;color:var(--slate)">No questions yet — click Add Question</div>'}
  </div>`;
}
window.rtQuestionsClose=function(){RT_QUESTIONS=null;RT_QUESTIONS_TEST=null;const p=$('rtQuestionsPanel');if(p){p.style.display='none';p.innerHTML='';}};
/* The correct-answer picker sits RIGHT NEXT TO each option's own text box (a radio you click as you
   type it), instead of a separate dropdown that only ever said "Option 1/2/3/4" — that dropdown
   never showed what you'd actually typed, so picking the correct answer meant trusting a position
   number rather than seeing the real text, and it was easy to mark the wrong one correct without
   any way to notice. This can't have that failure mode: the radio is beside the text it marks. */
function rtQOptRow(i,placeholder){
  return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
    <input type="radio" name="rtQFCorrectRadio" value="${i}" id="rtQFCorrectR${i}" style="flex:none" title="Mark this the correct answer">
    <input id="rtQFOpt${i}" class="inp" placeholder="${esc(placeholder)}" style="flex:1">
  </div>`;
}
window.rtQAdd=function(){if(!rtTestsGuard()||!RT_QUESTIONS_TEST)return;
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-plus"></i> Add Question</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>Type *</label>
    <select id="rtQFType" class="inp" onchange="rtQTypeToggle()">
      <option value="mcq">Multiple Choice</option>
      <option value="descriptive">Descriptive (AI-graded)</option>
    </select>
    <label>Question *</label><textarea id="rtQFPrompt" class="inp" rows="2" placeholder="Type the question..."></textarea>
    <div id="rtQFMcq">
      <label>Options — click the radio beside the correct one *</label>
      ${rtQOptRow(0,'Option 1')}${rtQOptRow(1,'Option 2')}${rtQOptRow(2,'Option 3 (optional)')}${rtQOptRow(3,'Option 4 (optional)')}${rtQOptRow(4,'Option 5 (optional)')}${rtQOptRow(5,'Option 6 (optional)')}
    </div>
    <div id="rtQFDescriptive" style="display:none">
      <label>Model Answer <span style="font-size:11px;color:var(--slate)">(what ChatGPT grades against — not shown to the candidate)</span></label>
      <textarea id="rtQFModel" class="inp" rows="3" placeholder="An ideal answer..."></textarea>
    </div>
    <label>Marks *</label><input id="rtQFMarks" class="inp" type="number" min="1" value="1">
  </div>
  <div class="modal-foot"><button class="btn btn-primary" onclick="rtQSave()">Add Question</button><button class="btn" onclick="closeModal()">Cancel</button></div>`);
  setTimeout(()=>{const el=$('rtQFPrompt');if(el)el.focus();},100);
};
window.rtQTypeToggle=function(){
  const mcq=($('rtQFType')||{}).value==='mcq';
  if($('rtQFMcq'))$('rtQFMcq').style.display=mcq?'':'none';
  if($('rtQFDescriptive'))$('rtQFDescriptive').style.display=mcq?'none':'';
};
window.rtQSave=async function(){
  if(!rtTestsGuard()||!RT_QUESTIONS_TEST)return;
  const type=($('rtQFType')||{}).value==='descriptive'?'descriptive':'mcq';
  const prompt=($('rtQFPrompt')||{}).value?.trim();
  const marks=parseFloat(($('rtQFMarks')||{}).value||'1')||1;
  if(!prompt){toast('Question text is required','err');return;}
  const seq=((RT_QUESTIONS||[]).reduce((m,q)=>Math.max(m,q.seq||0),0))+1;
  const row={test_id:RT_QUESTIONS_TEST.id,seq,type,max_marks:marks};
  if(type==='mcq'){
    // Keyed by original slot (0..5), not compacted first — so a correct-answer radio always points
    // at the text actually beside it, even when an earlier slot was left blank.
    const slots=[0,1,2,3,4,5].map(i=>({i,v:(($('rtQFOpt'+i)||{}).value||'').trim()})).filter(s=>s.v);
    if(slots.length<2){toast('Add at least 2 options','err');return;}
    const checked=document.querySelector('input[name="rtQFCorrectRadio"]:checked');
    if(!checked){toast('Click the radio beside the correct option','err');return;}
    const correctSlot=slots.find(s=>s.i===parseInt(checked.value,10));
    if(!correctSlot){toast('The option you marked correct is empty — fill it in or pick another','err');return;}
    row.options=slots.map(s=>s.v); row.correct_option=correctSlot.v;
  }else{
    row.model_answer=($('rtQFModel')||{}).value?.trim()||'';
  }
  const{data,error}=await sb.schema('recruit').from('test_questions').insert(row).select().single();
  if(error){toast(error.message,'err');return;}
  RT_QUESTIONS=[...(RT_QUESTIONS||[]),data];
  closeModal();toast('Question added');rtQuestionsRender();
};
window.rtQDelete=async function(qId){
  if(!rtTestsGuard())return;
  if(!await confirmDialog('Delete this question? This cannot be undone.'))return;
  const{error}=await sb.schema('recruit').from('test_questions').delete().eq('id',qId);
  if(error){toast(error.message,'err');return;}
  RT_QUESTIONS=(RT_QUESTIONS||[]).filter(q=>q.id!==qId);
  toast('Question deleted');rtQuestionsRender();
};

/* ── Get Link: mints one recruit.test_attempts row via the already-authenticated edge function,
   for a specific candidate's email (and candidate_id if this test is being sent from a candidate's
   own row elsewhere — from the Tests tab directly there is no candidate context, so it's left null
   and Tests Sent/Test Passed stage automation simply does not fire for a link generated this way). ── */
/* One click, no form: mints a real attempt under the previewer's own email and opens it
   immediately in a new tab, so "does this test actually work" is answered by trying it, not by
   reading a link out of a modal. Uses the exact same recruit-test-generate-link function a real
   candidate's link comes from — this is not a fake/simulated preview, it is the real thing. */
/* THE BUTTON IS DRAWN FOR EVERYONE, AND THE SERVER DECIDES.

   It used to be hidden unless rtCanManage() said so, and when somebody who ought to have had it
   could not see it there was nothing on the screen to explain why - a control that is simply
   absent tells you nothing. Now it is always there, and a refusal comes back as a sentence naming
   the reason. Nothing is loosened: recruit-test-generate-link still asks the database whether this
   caller may do it, and a visible button does not make the request succeed.

   THE TAB IS OPENED BEFORE THE AWAIT, NOT AFTER. A window.open that runs after an await has lost
   the click that caused it, and browsers block it as a pop-up - so the old version could do
   everything correctly, mint the attempt, and then appear to do nothing whatsoever. Opening the
   tab while the click is still live and pointing it at the paper when the link arrives is what
   makes Preview work from the page. If the tab is blocked anyway, the address is handed over
   rather than the attempt being lost. */
window.rtPreviewNative=async function(testId){
  const test=(RT_RECORDS||[]).find(t=>t.id===testId);
  const tab=window.open('', '_blank');          // on the click, before anything is awaited
  if(tab){ try{ tab.document.write('<!doctype html><meta charset="utf-8"><title>Opening…</title>'
    +'<body style="font:16px system-ui;padding:40px;color:#334155">Opening the test…</body>'); }catch(_e){} }
  /* preview:true is what keeps a rehearsal out of Results. The attempt is still real - the paper
     opens and grades exactly as a candidate's would - it simply is not counted as somebody having
     sat the test, and carries no candidate, so it can never mark anybody 'Tests Sent'. */
  const{data,error}=await sb.functions.invoke('recruit-test-generate-link',
    {body:{test_id:testId,candidate_email:state.email||'preview@thejaingroup.com',
           origin:location.origin,preview:true}});
  if(error||data?.error){
    if(tab) try{ tab.close(); }catch(_e){}
    toast((data&&data.error)||(error&&error.message)||'Could not open the test','err');
    return;
  }
  if(tab){ try{ tab.location.href=data.link; }catch(_e){ try{ tab.close(); }catch(_x){} } }
  if(!tab||tab.closed){
    openModal('<div class="modal-head"><h3><i class="fa-solid fa-eye"></i> '+esc((test&&test.name)||'Test')+'</h3>'
      +'<span class="x" onclick="closeModal()">&times;</span></div>'
      +'<div class="modal-body frm"><p style="margin:0 0 10px;color:var(--slate);font-size:13px">'
      +'Your browser blocked the new tab. Open this instead — it is your preview, ready to sit.</p>'
      +'<input class="inp" readonly value="'+esc(data.link)+'" onclick="this.select()"></div>'
      +'<div class="modal-foot"><a class="btn btn-primary" href="'+esc(data.link)+'" target="_blank" rel="noopener">Open the test</a>'
      +'<button class="btn" onclick="closeModal()">Close</button></div>');
    return;
  }
  toast('Preview opened in a new tab — it will not appear in Results');
};
window.rtGetLink=function(testId){if(!rtTestsGuard())return;
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-link"></i> Get Test Link</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>Candidate Email *</label><input id="rtLinkEmail" class="inp" placeholder="candidate@example.com">
  </div>
  <div class="modal-foot"><button class="btn btn-primary" onclick="rtGetLinkGo(${testId})">Generate Link</button><button class="btn" onclick="closeModal()">Cancel</button></div>`);
  setTimeout(()=>{const el=$('rtLinkEmail');if(el)el.focus();},100);
};
window.rtGetLinkGo=async function(testId){
  const email=($('rtLinkEmail')||{}).value?.trim();
  if(!email){toast('Candidate email is required','err');return;}
  const test=(RT_RECORDS||[]).find(t=>t.id===testId);
  const{data,error}=await sb.functions.invoke('recruit-test-generate-link',{body:{test_id:testId,candidate_email:email,origin:location.origin}});
  if(error||data?.error){toast((data&&data.error)||error.message,'err');return;}
  window._rtLinkCtx={link:data.link,email,testId,testName:(test&&test.name)||data.test_name||'Assessment'};
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-check"></i> Link Ready</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>Send this link to ${esc(email)}</label>
    <input id="rtLinkOut" class="inp" readonly value="${esc(data.link)}" onclick="this.select()">
  </div>
  <div class="modal-foot"><button class="btn btn-primary" onclick="rtNativeSendPrompt()"><i class="fa-solid fa-envelope"></i> Send Email</button><button class="btn" onclick="navigator.clipboard.writeText('${esc(data.link)}');toast('Copied')"><i class="fa-solid fa-copy"></i> Copy</button><button class="btn" onclick="closeModal()">Close</button></div>`);
};
/* Same send-test-email function the legacy Google-Forms Share button already uses (recipients,
   subject, body, link) — a native test's link works there exactly the same way, so this reuses it
   rather than building a second mail-sending path. Requires the sender's own Gmail be connected
   (or falls back to the shared address with Reply-To them), same as Share already does. */
window.rtNativeSendPrompt=function(){
  const ctx=window._rtLinkCtx; if(!ctx)return;
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-envelope"></i> Send Test</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>To</label><input class="inp" value="${esc(ctx.email)}" disabled>
    <label>Subject</label><input id="rtSendSubject" class="inp" value="${esc(RT_MAIL_SUBJECT)}">
    <label>Message</label><textarea id="rtSendBody" class="inp" rows="4">${esc(rtMailBody(ctx.testName))}</textarea>
  </div>
  <div class="modal-foot"><button class="btn btn-primary" id="rtSendGoBtn" onclick="rtNativeSendGo()"><i class="fa-solid fa-paper-plane"></i> Send</button><button class="btn" onclick="closeModal()">Cancel</button></div>`);
};
window.rtNativeSendGo=async function(){
  const ctx=window._rtLinkCtx; if(!ctx)return;
  const subject=($('rtSendSubject')||{}).value?.trim()||RT_MAIL_SUBJECT;
  const body=($('rtSendBody')||{}).value?.trim()||'';
  const btn=$('rtSendGoBtn'); if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  try{
    const{data,error}=await sb.functions.invoke('send-test-email',{body:{test_name:ctx.testName,link:ctx.link,subject,body,recipients:[ctx.email]}});
    if(error||data?.error)throw new Error((data&&data.error)||error.message);
    closeModal();
    toast('Test sent to '+ctx.email+(data.via==='gmail'?' from '+(data.sent_as||'your address'):' from the shared address'));
  }catch(e){
    if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-paper-plane"></i> Send';}
    toast('Send failed: '+((e&&e.message)||'unknown error'),'err');
  }
};
window.rtRename=function(){if(!recGuard()||!rtTestsGuard())return;
  const sel=[...document.querySelectorAll('.rt-chk:checked')];
  if(sel.length!==1)return;
  const id=parseInt(sel[0].value);
  const rec=(RT_RECORDS||[]).find(r=>r.id===id);if(!rec)return;
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-pen"></i> Rename Test</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>Test Name *</label><input id="rtFRename" class="inp" value="${esc(rec.name)}">
    <label>Form Link</label><input id="rtFRLink" class="inp" value="${esc(rec.link||'')}">
    <label>Response Sheet URL</label><input id="rtFRSheet" class="inp" value="${esc(rec.response_sheet_url||'')}">
  </div>
  <div class="modal-foot"><button class="btn btn-primary" onclick="rtUpdate(${id})">Save</button><button class="btn" onclick="closeModal()">Cancel</button></div>`);
  setTimeout(()=>{const el=$('rtFRename');if(el)el.focus();},100);
};
window.rtUpdate=async function(id){
  if(!rtTestsGuard())return;
  const name=($('rtFRename')||{}).value?.trim();
  const link=($('rtFRLink')||{}).value?.trim()||'';
  const sheet=($('rtFRSheet')||{}).value?.trim()||'';
  if(!name){toast('Test name is required','err');return;}
  const{error}=await sb.schema('recruit').from('tests').update({name,link,response_sheet_url:sheet||null}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  const rec=(RT_RECORDS||[]).find(r=>r.id===id);
  if(rec){rec.name=name;rec.link=link;rec.response_sheet_url=sheet||null;}
  closeModal();toast('Test updated');rtRender();
};
window.rtDelete=async function(){if(!recGuard()||!rtTestsGuard())return;
  const sel=[...document.querySelectorAll('.rt-chk:checked')].map(c=>parseInt(c.value));
  if(!sel.length)return;
  if(!await confirmDialog('Delete '+sel.length+' test(s)? All associated responses will also be deleted. This cannot be undone.'))return;
  const{error}=await sb.schema('recruit').from('tests').delete().in('id',sel);
  if(error){toast(error.message,'err');return;}
  RT_RECORDS=(RT_RECORDS||[]).filter(r=>!sel.includes(r.id));
  toast(sel.length+' test(s) deleted');rtRender();
};

/* ── Share Test (email a form link to candidates via the Email API backend) ── */
// Visibility is limited to these people, matched by their JainE profile full name.
// (Others with recruitment access will NOT see the Share button.)
// NOTE: 'administrator' & 'abhay mati' added for testing — remove later if the 3 named
// staff should be the only ones with Share access.
/* Assessment Tests are managed by these four and nobody else - adding, renaming, deleting and
   sharing alike. Matched by EMAIL: the previous list matched display names and held
   "khushbu singh" while her profile reads "Khusbu Singh", so it never matched her and she could not
   see the Share button at all. A name is typed by hand and gets edited; an address does not drift.

   Mirrored by recruit.can_manage_tests() in the database, which is what actually enforces this -
   the page hiding a button is a courtesy, not a control. */
const RT_TESTS_ALLOWED=[
  'mgr.hr@thejaingroup.com',   // Shuchandra Das
  'hr@thejaingroup.com',       // Khusbu Singh
  'career@thejaingroup.com',   // Uzma Ahmed
  'ayushruia1@gmail.com',      // Administrator
  'system1@thejaingroup.com'   // Abhay Mati
];
function rtCanManage(){
  return RT_TESTS_ALLOWED.includes(String(state.email||'').trim().toLowerCase());
}
function rtTestsGuard(){
  if(rtCanManage()) return true;
  toast('Assessment Tests can only be changed by Shuchandra Das, Khusbu Singh, Uzma Ahmed or the Administrator','err');
  return false;
}
/* Connecting a referral to a position is HR's decision: HR, the Administrator, or Abhay Mati -
   the same group that can act anywhere else in Recruitment, and deliberately NOT the tighter
   four-person list that owns the test bank and may email candidates. Connecting is judging who
   fits a role, which is the job of whoever is running the hiring, not of whoever owns the tests.
   Somebody outside that group may still REFER a person; they simply cannot decide where that
   person goes. */
function rtRefConnectGuard(){
  if(recCanWrite()) return true;
  toast('Only HR, Abhay Mati and Administrators can approve or connect a referral','err');
  return false;
}
/* Whether this person has granted the app permission to send mail from their own Gmail. Read from
   acc.google_connections, a view that exposes only email / connected_at / can_send_mail - never a
   token. Connecting for Calendar alone does NOT include sending, so this is a separate question from
   "are they connected". */
let RT_CAN_SEND_AS_SELF=null;
async function rtShareCheckGmail(){
  try{
    const {data}=await sb.schema('acc').from('google_connections')
      .select('can_send_mail').eq('email',(state.email||'').toLowerCase()).maybeSingle();
    RT_CAN_SEND_AS_SELF=!!(data&&data.can_send_mail);
  }catch(e){ RT_CAN_SEND_AS_SELF=false; }
  return RT_CAN_SEND_AS_SELF;
}
window.rtShareConnectGoogle=function(){
  // Same one-time consent the Meetings page uses; it now asks for mail-sending as well.
  location.href='https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/google-oauth-start?email='
    +encodeURIComponent(state.email||'');
};
// Sharing is one of the managed actions, not a separately-permissioned one; the name is kept so
// the existing call sites read unchanged.
function rtCanShare(){ return rtCanManage(); }
/* A TEST GOES TO SOMEBODY IN THE INTERVIEW TRACKER, AND NOWHERE ELSE.

   This used to be five empty boxes to type addresses into, which meant a test could be sent to any
   address at all - a typo, a personal account, somebody who was never a candidate here. Nothing
   downstream could cope with that: the attempt, the answers, the time taken and the pass are all
   recorded against the address the link was minted for, so an address that belongs to no candidate
   produces a result that can never be tied back to a person, and a mistyped one silently sends the
   paper to a stranger while the real candidate waits.

   So the addresses are no longer typed - they are PICKED, from the Interview Tracker, which is the
   list of people who are actually being considered. Anyone who should get a test is added there
   first. That is also what lets 'Tests Sent' and 'Test Passed' land on the right row.

   Read straight from hr.interview_tracker rather than from TP_TR_RECORDS, because that variable is
   only filled while the Interview Tracker page is open and is empty when Tests is where you are. */
let RT_TRACKER_PEOPLE=null, RT_TRACKER_HIDDEN=0, RT_TRACKER_WAITING=0, RT_TRACKER_EXCLUDED=[];
/* ONLY SOMEBODY WHO HAS NOT BEEN ANYWHERE YET CAN BE SENT A TEST.

   A stage in the Feedback column means something has already happened to this person, and in every
   case it is a reason not to post them a paper:

     Tests Sent          they already have one, sitting unanswered - a second link would replace
                         nothing and leave two live attempts against one person
     Test Passed         they have sat it and passed; sending it again invites a second, different
                         score against the same name
     Interview Scheduled / Interview Done / Selected / Joined
                         they are past the testing stage entirely
     Rejected / Backed Out
                         they are not a candidate any more
     Hold                a decision has been deliberately paused; a test would restart it

   TP_STAGES is the funnel in order and begins at 'Tests Sent', so "everything from Tests Sent
   onward, plus Hold, Rejected, Selected and Backed Out" is in fact every stage in that list.

   WHICH IS WHY THIS HIDES THE NAMED STAGES RATHER THAN SHOWING ONLY BLANK ONES. Written the other
   way round - "only somebody with no stage at all" - it looked equivalent and was not: live rows
   carry 'Pending', which is not in TP_STAGES, and hiding it would have emptied this list of the
   only people eligible to sit a test. Anything that is not one of the stages below is somebody
   nothing has happened to yet, and they belong here.

   Note a test cannot be re-sent to the same person from here once it has gone: they move to Tests
   Sent the moment the link is generated and drop out of this list. If somebody never receives
   theirs, set their Feedback back in the Interview Tracker and they reappear. */
/* Built on first use, not at load. TP_STAGES is declared further down this same file, so reading
   it from a top-level const up here throws a ReferenceError the instant the script is parsed and
   takes every page of JAIN-E down with it. Inside the function it is only read on a click, long
   after the whole file has run. */
let RT_NOT_TESTABLE=null;
/* ONE SUBJECT FOR EVERY TEST EMAIL, AND THE TEST NAMED IN THE BODY.

   The subject used to carry the test name - "Check This Pre Sales provided by JainGroup" - so
   every paper arrived under a different heading and the line itself read like a mistake. It is
   fixed now, and the name moved into the message, which is where a candidate reads it anyway.

   Both live here rather than at the five call sites that used to build them by hand; that is
   how the send modal, the Share window and the per-position send came to word the same email
   three slightly different ways. */
const RT_MAIL_SUBJECT = 'Check This Assessment Provided by JainGroup';
/* THE TEST NAME IS A NAME, NOT A NOUN.

   This read "Please complete the Project Manager below at your convenience", because the name was
   dropped in where the thing being completed belongs. A candidate does not complete a Project
   Manager. The name needs a noun after it, so it gets one.

   Unless it already has one: a test called "Sales Aptitude Test" would otherwise become "the
   Sales Aptitude Test assessment". If the name already ends in a word that does the job, it is
   left to do it. */
const RT_NAME_ALREADY_A_NOUN = /\b(test|assessment|paper|quiz|exam|questionnaire|exercise|round)$/i;
function rtMailBody(testName){
  const name = String(testName || '').trim().replace(/\s+/g, ' ');
  const what = !name ? 'assessment'
             : RT_NAME_ALREADY_A_NOUN.test(name) ? name
             : name + ' assessment';
  return 'Hi,\n\nPlease complete the ' + what + ' below at your convenience.\n\nThanks';
}
function rtTestable(feedback){
  if(!RT_NOT_TESTABLE) RT_NOT_TESTABLE=new Set(TP_STAGES.map(x=>x.toLowerCase()));
  const f=String(feedback||'').trim().toLowerCase();
  return !RT_NOT_TESTABLE.has(f);
}
/* ONE ENTRY PER TRACKER ROW, NOT PER PERSON.

   The obvious thing is to list each address once, and it is wrong. One person can be a live
   candidate for two positions at the same time, and the two are judged separately - somebody who
   backed out of Operations Head can still be Pending for Sales Executive, which is exactly what
   the live data looks like. Collapsing them to one line per address means judging that person by
   whichever row happened to be newest, and hiding a candidate who is genuinely still in the
   running.

   A test is sent FOR A POSITION, and Monthly Update counts per position, so the row is the unit.
   Each row carries its own candidate_id, which is what makes the count land on the right position.

   candidate_id is the whole reason this is carried at all: without it recruit-test-generate-link
   has nobody to move to 'Tests Sent', so hr.candidates.stage never changes and Monthly Update -
   which counts those stages - stays at zero however many tests have actually gone out. */
async function rtTrackerPeople(force){
  if(RT_TRACKER_PEOPLE&&!force) return RT_TRACKER_PEOPLE;
  const {data,error}=await sb.schema('hr').from('interview_tracker')
    .select('id,candidate_id,candidate_name,email,position,feedback').order('id',{ascending:false});
  if(error) throw error;

  /* NOBODY UNAPPROVED IS OFFERED A TEST.
     The database refuses the stage change anyway, so sending to one would deliver an email and
     then fail to record it - the worst of both. Asking which candidates are approved here means
     they are simply not in the list, with the reason said once above it rather than as a failure
     per person. */
  /* AND NOBODY ON A FINISHED POSITION IS OFFERED ONE EITHER.
     Marking a position Complete in Monthly Progress closes the hiring out - feedback is locked for
     everyone on it. Sending those people a test afterwards is a form that cannot be acted on, so
     they come out of the list here, for the same reason and in the same way as the unapproved. */
  const ids=[...new Set((data||[]).map(r=>r.candidate_id).filter(x=>x!=null))];
  let approved=new Set(), onFinished=new Set();
  if(ids.length){
    const {data:cands}=await sb.schema('hr').from('candidates')
      .select('id,approval_status,tracker_row_id').in('id',ids);
    (cands||[]).forEach(c=>{ if((c.approval_status||'Approved')==='Approved') approved.add(c.id); });
    const rowIds=[...new Set((cands||[]).map(c=>c.tracker_row_id).filter(x=>x!=null))];
    if(rowIds.length){
      const {data:done}=await sb.schema('hr').from('tracker_rows')
        .select('id').in('id',rowIds).not('completed_at','is',null);
      const doneSet=new Set((done||[]).map(x=>x.id));
      (cands||[]).forEach(function(c){
        if(c.tracker_row_id!=null&&doneSet.has(c.tracker_row_id)) onFinished.add(c.id);
      });
    }
  }

  /* Counted apart, because they are different problems with different answers. "Waiting to be
     approved" is something you can go and fix in a minute; "already tested or moved on" is not a
     problem at all. Lumping them together produced the worst possible message for a brand new
     candidate: that they had already been sent a test and moved on. */
  /* WHY SOMEBODY IS NOT IN THE LIST IS KEPT PER ROW, NOT AS ONE TOTAL.

     The counts used to be two numbers for the whole tracker, and the message about a single
     position read from them. So on a position where everyone had already been tested, the window
     still said "1 is still waiting to be approved in Accountability" - counting somebody waiting
     on a completely different position. It sent people to Pending Approval to look for a task
     that had nothing to do with the position they were on.

     Each excluded row now carries its own position and reason, so the sentence can be counted
     from exactly the rows the sentence is about. */
  const out=[]; const excluded=[];
  for(const r of (data||[])){
    const em=String(r.email||'').trim().toLowerCase();
    if(!em) continue;
    const pos=r.position||'';
    if(r.candidate_id!=null && onFinished.has(r.candidate_id)){
      excluded.push({position:pos,reason:'completed'}); continue;
    }
    if(r.candidate_id!=null && !approved.has(r.candidate_id)){
      excluded.push({position:pos,reason:'waiting'}); continue;
    }
    if(!rtTestable(r.feedback)){
      excluded.push({position:pos,reason:'moved_on',feedback:r.feedback||''}); continue;
    }
    out.push({email:em,name:r.candidate_name||'',position:pos,
              feedback:r.feedback||'',candidateId:r.candidate_id||null});
  }
  RT_TRACKER_PEOPLE=out;
  RT_TRACKER_EXCLUDED=excluded;
  RT_TRACKER_HIDDEN=excluded.length;
  RT_TRACKER_WAITING=excluded.filter(function(x){return x.reason==='waiting';}).length;
  return out;
}
/* The sentence for one position, counted from that position's own rows. Returns null when there
   is genuinely nothing to say. */
function rtWhyNobody(position){
  const rows=(RT_TRACKER_EXCLUDED||[]).filter(function(x){
    return position==null || String(x.position||'')===String(position); });
  const waiting=rows.filter(function(x){return x.reason==='waiting';}).length;
  const movedOn=rows.filter(function(x){return x.reason==='moved_on';}).length;
  const finished=rows.filter(function(x){return x.reason==='completed';}).length;
  const who=position?('\u201c'+position+'\u201d'):'the Interview Tracker';
  if(!rows.length) return 'There is nobody on '+who+' to send a test to.';
  /* Said first and on its own, because it is the one reason with a single obvious answer: the
     position was closed out on purpose, and Undo on its Monthly Progress row reopens it. */
  if(finished&&!waiting&&!movedOn){
    return who+' is marked Complete in Monthly Progress, so nothing can be sent to its candidates '
      +'\u2014 press Undo on its row to reopen it.';
  }
  if(waiting&&movedOn){
    return 'Nobody on '+who+' can be sent a test right now '+'—'+' '+movedOn+' '
      +(movedOn===1?'has':'have')+' already been sent one or moved on, and '+waiting+' '
      +(waiting===1?'is':'are')+' still waiting to be approved in Accountability \u203a Pending Approval.';
  }
  if(waiting){
    return 'Nobody on '+who+' can be sent a test yet '+'—'+' '+waiting+' '
      +(waiting===1?'is':'are')+' still waiting to be approved in Accountability \u203a Pending Approval.';
  }
  return 'Nobody on '+who+' can be sent a test right now '+'—'
    +' they have all been sent one already, or moved on.';
}
/* Styled by .rt-cand-* in nexus.css, not inline, because this sits inside .frm - see the note
   there. The row must stay a <label> so that a click anywhere on it ticks the box. */
function rtSharePersonRow(p,preTick){
  const sub=[p.position,p.feedback].filter(Boolean).join(' \u00b7 ');
  return `<label class="rt-cand-row" data-hay="${esc((p.name+' '+p.email+' '+p.position).toLowerCase())}">
    <input type="checkbox" class="rt-cand-chk"${preTick?' checked':''} value="${esc(p.email)}" data-cand="${p.candidateId==null?'':p.candidateId}">
    <span style="min-width:0">
      <span class="rt-cand-name">${esc(p.name||p.email)}</span>
      <span class="rt-cand-mail">${esc(p.email)}</span>
      ${sub?`<span class="rt-cand-sub">${esc(sub)}</span>`:''}
    </span>
  </label>`;
}
/* Keeps the subject in step with the chosen test, but never overwrites wording somebody has
   typed - the default is recognisable, so anything else is theirs. */
window.rtShareTestChanged=function(){
  const selEl=$('rtShareTest'); if(!selEl)return;
  const t=(RT_RECORDS||[]).find(x=>String(x.id)===String(selEl.value));
  if(!t)return;
  /* The subject no longer moves - it is the same line for every test. It is the BODY that now
     carries the name, so it is the body that has to keep up when the dropdown changes. Wording
     somebody has typed is still left alone: only a message still matching one of the generated
     defaults is replaced, so an edit is never thrown away by touching the dropdown. */
  const bodyEl=$('rtShareBody');
  if(bodyEl){
    const cur=String(bodyEl.value||'').trim();
    const isGenerated=!cur||(RT_RECORDS||[]).some(function(x){ return rtMailBody(x.name).trim()===cur; });
    if(isGenerated) bodyEl.value=rtMailBody(t.name);
  }
};
window.rtShareFilter=function(q){
  const t=String(q||'').trim().toLowerCase();
  let shown=0;
  document.querySelectorAll('#rtEmailFields .rt-cand-row').forEach(function(el){
    const hit=!t||(el.dataset.hay||'').includes(t);
    el.style.display=hit?'':'none';   // '' falls back to the stylesheet's flex
    if(hit)shown++;
  });
  const none=$('rtCandNone'); if(none)none.style.display=shown?'none':'block';
};
window.rtShareCheckAll=function(el){
  /* Ticks only what is visible, so a filter then Select-all means "everyone matching this",
     not "everyone in the tracker" - which is what somebody filtering plainly intends. */
  document.querySelectorAll('#rtEmailFields .rt-cand-row').forEach(function(row){
    if(row.style.display==='none')return;
    const cb=row.querySelector('.rt-cand-chk'); if(cb)cb.checked=el.checked;
  });
  rtShareCountSel();
};
window.rtShareCountSel=function(){
  const n=document.querySelectorAll('#rtEmailFields .rt-cand-chk:checked').length;
  const lbl=$('rtCandCount'); if(lbl)lbl.textContent=n?(n+' selected'):'none selected';
};
/* fromPosition is set when this was opened from a Monthly Progress row. It narrows the list to
   that one position and ticks everybody, because on a position's own row the normal case is "send
   it to all of them" - unticking one is less work than ticking nine. Opened the usual way from
   Tests, nothing is narrowed and nothing is pre-ticked, which is the safer default when the whole
   company's candidates are on screen. */
window.rtShare=async function(fromPosition){
  if(!rtCanShare()){toast('You do not have permission to share tests','err');return;}
  await rtShareCheckGmail();

  /* WHICH TEST IS ASKED FOR, NOT ASSUMED.

     This used to read the ticked row in the Tests table and refuse with "Select exactly one test
     to share" if there was not exactly one. Opened from Tests that is fair. Opened from Monthly
     Progress it was nonsense: the Tests table is on a different tab, nothing there is ticked and
     nothing can be ticked without leaving the screen you are on - so the window refused, naming a
     control that was not on it, for a reason nobody could act on.

     From Monthly Progress the position is known and the test is not, so the test is a field in the
     window. From Tests the test is known and stays as it was. */
  const fromPos=fromPosition===true;
  let rec=null;
  if(!fromPos){
    const sel=[...document.querySelectorAll('.rt-chk:checked')].map(c=>parseInt(c.value));
    if(sel.length!==1){toast('Tick exactly one test to email','err');return;}
    rec=(RT_RECORDS||[]).find(r=>r.id===sel[0]);
    if(!rec)return;
  }else{
    const usable=(RT_RECORDS||[]).filter(t=>t.engine==='native');
    if(!usable.length){toast('There are no tests set up to send','err');return;}
    rec=usable[0];            // the window opens on the first, and the dropdown changes it
  }
  const senderName=(state.profile&&state.profile.full_name)||(state.roles&&state.roles.full_name)||(state.email||'').split('@')[0];
  const subject=RT_MAIL_SUBJECT;
  const body=rtMailBody(rec.name);
  let people=[];
  try{ people=await rtTrackerPeople(true); }
  catch(e){ toast('Could not read the Interview Tracker: '+((e&&e.message)||e),'err'); return; }
  const onlyPos=fromPosition===true?TP_MU_EMAIL_POS:null;
  if(onlyPos){
    people=people.filter(function(x){return String(x.position||'')===String(onlyPos);});
    if(!people.length){
      /* Says which of the two it is. A candidate added a minute ago being told they have "already
         been sent one" is a message that sends somebody looking for a test that was never sent. */
      toast(rtWhyNobody(onlyPos),'err');
      return;
    }
  }
  /* AN EMPTY WINDOW IS NOT AN ANSWER. Opening a Send window with nobody in it, and a sentence
     explaining why, asks somebody to read a dialog in order to learn there was nothing to do -
     and leaves a Send button on screen that cannot send. The reason is said as a message and the
     window stays shut. */
  if(!people.length){
    toast(RT_TRACKER_WAITING
      ? (RT_TRACKER_WAITING+' candidate'+(RT_TRACKER_WAITING===1?' is':'s are')
         +' waiting to be approved \u2014 approve them in Accountability \u203a Pending Approval, then send the test')
      : RT_TRACKER_HIDDEN
      ? 'Everybody in the Interview Tracker has already been sent a test or moved on'
      : 'Nobody in the Interview Tracker has an email address yet \u2014 add a candidate there first',
      'err');
    return;
  }

  const fields=people.length
    ? people.map(function(x){return rtSharePersonRow(x,!!onlyPos);}).join('')
    : '<div style="padding:18px;text-align:center;color:var(--slate);font-size:13px">'
      /* Three situations, three answers. Telling somebody their brand new candidate has "already
         been moved on" is worse than saying nothing: it describes a history that did not happen,
         and hides the one action that would actually fix it. */
      +(RT_TRACKER_WAITING
        ? '<b>'+RT_TRACKER_WAITING+' candidate'+(RT_TRACKER_WAITING===1?' is':'s are')+' waiting to be approved.</b>'
          +'<div style="margin-top:6px;font-size:12.5px">Approve them in <b>Accountability \u203a Pending '
          +'Approval</b> and they can be sent a test.</div>'
        : RT_TRACKER_HIDDEN
        ? 'Every candidate in the Interview Tracker has already been moved on \u2014 sent a test, '
          +'interviewed, selected, rejected, backed out or put on hold. Add a new candidate there to '
          +'send a test.'
        : 'Nobody in the Interview Tracker has an email address yet. Add the candidate there first, '
          +'with their email, and they will appear here.')
      +'</div>';
  /* THE WINDOW SAYS WHAT IT NEEDS AND NOTHING ELSE.

     It had grown four blocks of explanation - where the mail comes from, how per-person links work,
     why some candidates are missing, what the search box searches. Every one was true and together
     they buried the three things somebody actually came here to do: pick a test, write a line, tick
     people. Explanations that are never read are not documentation, they are noise with a cost.

     What stayed: the sender line, because a letter going out over the wrong address is worth one
     sentence; and the count of who is not shown, cut to the fact itself. Everything else moved to
     a tooltip or went. */
  openModal(/* wider: this window holds a subject, a message and a scrolling list of
     candidates, and at 560px the list was a narrow column with names wrapping onto two lines */
  `<div class="modal-head"><h3><i class="fa-solid fa-envelope"></i> Email Test</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <div style="font-size:12px;color:var(--slate);margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span><i class="fa-solid fa-paper-plane" style="opacity:.6"></i> From <b>${RT_CAN_SEND_AS_SELF?esc(state.email||''):'the shared JAIN-E address'}</b></span>
      ${RT_CAN_SEND_AS_SELF?'':`<button type="button" class="btn btn-sm" style="padding:2px 10px" onclick="rtShareConnectGoogle()" title="Send from your own address instead"><i class="fa-brands fa-google"></i> Use mine</button>`}
    </div>

    ${fromPos?`<label>Test</label>
    <select id="rtShareTest" class="sel" onchange="rtShareTestChanged()">
      ${(RT_RECORDS||[]).filter(t=>t.engine==='native').map(t=>`<option value="${t.id}"${t.id===rec.id?' selected':''}>${esc(t.name||'Untitled')}</option>`).join('')}
    </select>`:''}

    <label${fromPos?'':' style="margin-top:0"'}>Subject</label><input id="rtShareSubj" class="inp" value="${esc(subject)}">
    <label>Message</label><textarea id="rtShareBody" class="inp" rows="3" style="resize:vertical">${esc(body)}</textarea>
    ${rec.engine==='native'?'':(rec.link?'':'<div style="font-size:11.5px;color:var(--err);margin-top:2px">&#9888; This test has no form link.</div>')}

    <div style="display:flex;align-items:baseline;gap:8px;margin-top:14px;flex-wrap:wrap">
      <label style="margin:0">Send to${onlyPos?` <span style="font-weight:400;color:var(--slate)">\u00b7 ${esc(onlyPos)}</span>`:''}</label>
      ${RT_TRACKER_HIDDEN?`<span style="font-size:11.5px;color:var(--slate)" title="Candidates already sent a test, interviewed, selected, rejected, backed out, on hold, or still waiting to be approved">${RT_TRACKER_HIDDEN} not shown</span>`:''}
      <span id="rtCandCount" style="margin-left:auto;font-size:12px;color:var(--slate)">${onlyPos?(people.length+' selected'):'none selected'}</span>
    </div>
    <input id="rtCandSearch" class="inp" placeholder="Search\u2026" oninput="rtShareFilter(this.value)" style="margin:6px 0">
    <div class="rt-cand-tools" style="margin-bottom:6px">
      <label><input type="checkbox" onchange="rtShareCheckAll(this)"> Select all shown</label>
    </div>
    <div id="rtEmailFields" class="rt-cand-list" onchange="rtShareCountSel()">${fields}</div>
    <div id="rtCandNone" style="display:none;padding:12px;text-align:center;color:var(--slate);font-size:12.5px">Nobody matches that.</div>
  </div>
  <div class="modal-foot"><button class="btn btn-primary" id="rtShareSendBtn" onclick="${fromPos?'rtShareSendPicked()':'rtShareSend('+rec.id+')'}"><i class="fa-solid fa-paper-plane"></i> Send</button><button class="btn" onclick="closeModal()">Cancel</button></div>`,'lg');
};
/* The dropdown decides, not whatever the window opened on. Reading it at Send time is what makes
   changing the test actually change what goes out. */
window.rtShareSendPicked=function(){
  const selEl=$('rtShareTest');
  const id=selEl?parseInt(selEl.value,10):NaN;
  if(!id||isNaN(id)){toast('Choose a test to send','err');return;}
  return rtShareSend(id);
};
window.rtShareSend=async function(id){
  if(!rtCanShare()){toast('You do not have permission to share tests','err');return;}
  const rec=(RT_RECORDS||[]).find(r=>r.id===id);if(!rec)return;
  /* The recipients are the rows ticked in the Interview Tracker list - an address AND the
     candidate it belongs to. Nothing typed can reach here, so there is no shape to validate. */
  let picked=[...document.querySelectorAll('#rtEmailFields .rt-cand-chk:checked')].map(function(c){
    const cid=parseInt(c.dataset.cand,10);
    return {email:String(c.value||'').trim().toLowerCase(), candidateId:isNaN(cid)?null:cid};
  }).filter(function(x){return x.email;});
  if(!picked.length){toast('Tick at least one candidate to send this to','err');return;}

  /* NOBODY GETS THE SAME PAPER TWICE.

     There was a rule already, and it answered a different question. It asks the Interview
     Tracker "has this person been sent A test" - a single stage per row - so it cannot tell
     "Pre Sales" from "Project Manager", and one candidate collected both on the same morning.
     It also reads a list built when this window opened, so sending, then sending again a minute
     later, offered the same people.

     This asks the attempts table, about THIS test, at the moment of sending. It cannot go stale
     and it cannot be confused by a second paper. A form-engine test has no attempts, so nothing
     is skipped there and the behaviour is unchanged. */
  let blocked=[];
  try{
    const {data:prev}=await sb.schema('recruit').from('test_attempts')
      .select('candidate_email').eq('test_id',id).eq('is_preview',false)
      .in('candidate_email',picked.map(function(x){return x.email;}));
    const had=new Set((prev||[]).map(function(r){return String(r.candidate_email||'').trim().toLowerCase();}));
    blocked=picked.filter(function(x){return had.has(x.email);});
    picked=picked.filter(function(x){return !had.has(x.email);});
  }catch(_e){ /* if the check cannot run, send rather than block - the old behaviour */ }
  if(!picked.length){
    toast(blocked.length===1
      ? (blocked[0].email+' has already been sent this test')
      : ('All '+blocked.length+' of those have already been sent this test'),'warn');
    return;
  }
  if(blocked.length) toast('Skipping '+blocked.length+' who already had this test: '
    +blocked.slice(0,3).map(function(x){return x.email;}).join(', ')
    +(blocked.length>3?(' and '+(blocked.length-3)+' more'):''),'warn');

  const emails=picked.map(function(x){return x.email;});
  const subject=($('rtShareSubj')||{}).value?.trim()||RT_MAIL_SUBJECT;
  const body=($('rtShareBody')||{}).value?.trim()||'';
  const senderName=(state.profile&&state.profile.full_name)||(state.roles&&state.roles.full_name)||(state.email||'').split('@')[0];
  const btn=$('rtShareSendBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Sending…';}

  /* A NATIVE TEST HAS NO ONE LINK TO SHARE, which is why Share used to refuse with "this test has
     no form link". A Google Form is one address everybody opens; a paper built in JainE is minted
     per person, and that is the whole point - it is what ties the answers, the time taken and the
     pass to a named candidate instead of to an anonymous form response.

     So each recipient gets their own, one at a time. Generating a link is also what records
     'Tests Sent' against a candidate, which a shared form address could never do. One address
     failing does not stop the rest: the others still go, and the failures are named afterwards. */
  if(rec.engine==='native'){
    let sent=0, staged=0; const failed=[];
    for(const who of picked){
      const to=who.email;
      try{
        /* candidate_id is what moves this person to 'Tests Sent', which is what Monthly Update
           counts. Sending without it delivers the email and leaves every report reading zero. */
        const {data:gen,error:genErr}=await sb.functions.invoke('recruit-test-generate-link',
          {body:{test_id:id,candidate_email:to,candidate_id:who.candidateId,origin:location.origin}});
        if(genErr||gen?.error) throw new Error((gen&&gen.error)||genErr.message);
        const {data:sd,error:se}=await sb.functions.invoke('send-test-email',
          {body:{test_id:id,test_name:rec.name,link:gen.link,subject,body,recipients:[to],
                 sender_name:senderName,sender_email:state.email||''}});
        if(se||sd?.error) throw new Error((sd&&sd.error)||se.message);
        sent++; if(who.candidateId) staged++;
      }catch(e){ failed.push(to+' ('+((e&&e.message)||e)+')'); }
    }
    if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-paper-plane"></i> Send';}
    if(sent){
      try{usageQueue('recruitment.tests.share_test_via_email','update',{title:rec.name,recipients:sent});}catch(_e){}
      closeModal();
      toast('Sent to '+sent+' candidate'+(sent===1?'':'s')+' — each has their own link'
            +(staged?', and '+(staged===sent?(sent===1?'is':'are'):(staged+' of them are'))+' now at Tests Sent':''),'ok');
      /* A tracker row with no candidate_id behind it cannot be moved to a stage, so it will never
         appear in Monthly Update however many tests it receives. Better said out loud than left to
         be discovered as a report that quietly reads zero. */
      if(staged<sent) toast((sent-staged)+' of those are not linked to a candidate record, so they will not show in Monthly Update','err');
    }
    if(failed.length) toast('Could not send to: '+failed.slice(0,3).join(', ')+(failed.length>3?(' and '+(failed.length-3)+' more'):''),'err');
    if(!sent&&!failed.length) toast('Nothing was sent','err');
    return;
  }

  try{
    const {data:{session}}=await sb.auth.getSession();
    const token=session&&session.access_token;
    const res=await fetch(SUPABASE_URL+'/functions/v1/send-test-email',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},
      body:JSON.stringify({test_id:id,test_name:rec.name,link:rec.link||'',subject,body,recipients:emails,sender_name:senderName,sender_email:state.email||''})
    });
    const out=await res.json().catch(()=>({}));
    if(!res.ok||out.error)throw new Error(out.error||('send-test-email HTTP '+res.status));
    try{usageQueue('recruitment.tests.share_test_via_email','update',{title:rec.name,recipients:emails.length});}catch(_e){}
    closeModal();
    const n=Number(out.sent||emails.length);
    const who=(out.via==='gmail')
      ? ('from '+(out.sent_as||'your address'))
      : 'from the shared address (replies come to you)';
    toast('Test shared with '+n+' candidate'+(n>1?'s':'')+' '+who,'ok');
    // one failed address among several should not read as a clean success
    if(Array.isArray(out.failed)&&out.failed.length){
      toast(out.failed.length+' address'+(out.failed.length>1?'es':'')+' could not be reached','warn');
    }
  }catch(e){
    if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-paper-plane"></i> Send';}
    toast('Send failed: '+((e&&e.message)||'unknown error'),'err');
  }
};
/* Native tests' own results view — same shape as the Google-Forms one above (Score, Timestamps,
   one row per person), except the row is real and clicking it opens that person's actual answers,
   since native tests grade themselves instead of needing a response sheet imported by hand. */
/* SHOWPREVIEWS decides which of the two lists this is. Hiding rehearsals from the candidate
   results was right - HR checking a paper is not a result - but hiding them from EVERYWHERE was
   not: you could sit a test from JainE to check the grading and then have nowhere to see how it
   was marked, which is the one thing a preview is for. So they are a second list rather than no
   list, reached by a button, and never mixed into the first. */
window.rtResultsNative=async function(testId,showPreviews){
  const test=(RT_RECORDS||[]).find(t=>t.id===testId);if(!test)return;
  const panel=$('rtPreviewPanel');if(!panel)return;
  panel.style.display='block';
  panel.innerHTML=`<div class="card card-pad">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <i class="fa-solid fa-chart-simple" style="color:#0369a1;font-size:16px"></i>
      <span style="font-weight:700;font-size:15px">${esc(test.name)} — ${showPreviews?'My Previews':'Results'}</span>
      <button style="margin-left:auto;background:none;border:none;cursor:pointer;font-size:22px;line-height:1;color:var(--slate)" onclick="document.getElementById('rtPreviewPanel').style.display='none'">&times;</button>
    </div>
    <div id="rtResultsBody"><div class="loader"><div class="spin"></div></div></div>
  </div>`;
  panel.scrollIntoView({behavior:'smooth',block:'start'});
  const rb=$('rtResultsBody');
  try{
    // Rehearsals are excluded: HR checking the paper is not a result, and before this they piled
    // up in here beside the candidates - 18 of them under one address before a single real
    // candidate had sat anything.
    let{data,error}=await sb.schema('recruit').from('test_attempts')
      .select('id,candidate_email,status,started_at,submitted_at,mcq_score,mcq_max,ai_score,ai_max,ai_status,final_pct,pass_fail')
      .eq('test_id',testId).eq('is_preview',!!showPreviews).order('submitted_at',{ascending:false,nullsFirst:false});
    if(error)throw new Error(error.message);

    /* A RESULT IS SOMEBODY WHO PRESSED START. NOTHING ELSE.

       Sending a test creates an attempt row straight away - that is what mints the link and what
       moves the candidate to 'Tests Sent'. But an attempt that exists is not a person who sat
       anything: it is an invitation, and until they open the page and press Start no question has
       been seen and no answer exists. Listing those here filled Results with names scoring zero out
       of zero, which reads exactly like somebody who sat the paper and failed it - worse than
       showing nothing, because it is a wrong answer to "how did they do".

       started_at is stamped by the server when Start is pressed, so it is the honest dividing line:
       opened the email, opened the page, wandered off - no row here. Pressed Start - a row, even if
       they never submitted, because by then they have seen the paper and the clock has run. Those
       show as 'still open' rather than as a score.

       The ones still waiting are counted on the line above the table rather than dropped silently,
       so "sent to 5, two have sat it" is visible instead of looking like three sends went missing. */
    const all=data||[];
    const waiting=all.filter(function(r){return !r.started_at;}).length;
    data=all.filter(function(r){return !!r.started_at;});

    if(!data.length){
      rb.innerHTML='<div class="empty" style="padding:36px;color:var(--slate)">'
        +'<i class="fa-solid fa-inbox" style="font-size:28px;opacity:.3;display:block;margin-bottom:10px"></i>'
        +(showPreviews
          ? 'You have not previewed this test yet. Press Preview on its row to sit it \u2014 the marking will show up here.'
          : (waiting
             ? '<b>'+waiting+' candidate'+(waiting===1?' has':'s have')+' been sent this test, but nobody has started it yet.</b>'
               +'<div style="margin-top:6px;font-size:12.5px">A result appears the moment somebody opens their link and presses Start.</div>'
             : 'No candidate has taken this test yet.'))
        +'</div>';
      return;
    }
    window._rtResultsCache=data;
    const fmt=ts=>{if(!ts)return '—';try{return new Date(ts).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});}catch{return ts;}};
    /* HOW LONG IT TOOK, from the two timestamps the server already stamps - started_at when Start
       is pressed and submitted_at when it is handed in. Both are written by the server from its
       own clock, so neither can be dressed up from the candidate's machine. An attempt that was
       started and never submitted shows as still open rather than as a time, because it has not
       finished and any figure would be a guess. */
    const took=r=>{
      if(!r.started_at) return '—';
      if(!r.submitted_at) return '<span style="color:var(--slate)">still open</span>';
      const ms=new Date(r.submitted_at)-new Date(r.started_at);
      if(!isFinite(ms)||ms<0) return '—';
      const m=Math.floor(ms/60000), sec=Math.round((ms%60000)/1000);
      return m?(m+' min '+sec+' s'):(sec+' s');
    };
    const scoreTag=r=>{
      if(r.status!=='submitted')return '<span style="color:var(--slate)">In progress</span>';
      if(r.final_pct==null)return '<span style="color:#c08000">Grading '+(r.ai_status==='failed'?'failed — click to retry':'pending')+'</span>';
      const col=r.pass_fail?'#16855a':'#c83232';
      return `<b style="color:${col}">${r.final_pct}%</b> <span style="font-size:11px;color:var(--slate)">(${(Number(r.mcq_score||0)+Number(r.ai_score||0))} / ${(Number(r.mcq_max||0)+Number(r.ai_max||0))})</span> — <span style="color:${col};font-weight:600">${r.pass_fail?'Pass':'Fail'}</span>`;
    };
    rb.innerHTML=`
      <div style="font-size:12px;color:var(--slate);margin-bottom:10px">${data.length} ${showPreviews?('preview'+(data.length!==1?'s':'')+' · not counted anywhere'):('response'+(data.length!==1?'s':''))}${(!showPreviews&&waiting)?` · ${waiting} sent but not started yet`:''} · click a row to see answers</div>
      <div style="overflow-x:auto">
      <table class="tbl" style="min-width:500px">
        <thead><tr>
          <th style="width:36px;text-align:center">#</th>
          <th>Respondent</th>
          <th style="white-space:nowrap">Score</th>
          <th style="white-space:nowrap">Started</th>
          <th style="white-space:nowrap">Submitted</th>
          <th style="white-space:nowrap">Time taken</th>
        </tr></thead>
        <tbody>${data.map((r,i)=>`<tr style="cursor:pointer" onclick="rtResultsAttemptDetail('${r.id}')">
          <td style="text-align:center;color:var(--slate);font-size:12px">${i+1}</td>
          <td style="font-weight:500">${esc(r.candidate_email||'—')}</td>
          <td style="white-space:nowrap">${scoreTag(r)}</td>
          <td style="font-size:12px;color:var(--slate);white-space:nowrap">${fmt(r.started_at)}</td>
          <td style="font-size:12px;color:var(--slate);white-space:nowrap">${fmt(r.submitted_at)}</td>
          <td style="font-size:12px;white-space:nowrap">${took(r)}</td>
        </tr>`).join('')}
        </tbody>
      </table></div>`;
  }catch(e){
    rb.innerHTML=`<div class="empty" style="padding:30px;color:var(--err)"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(e.message)}</div>`;
  }
};
window.rtResultsAttemptDetail=async function(attemptId){
  const rb=$('rtResultsBody');if(!rb)return;
  rloader(b);
  try{
    // The cached row from the results list doesn't carry test_id, so the full attempt is re-fetched here.
    const{data:full}=await sb.schema('recruit').from('test_attempts').select('*').eq('id',attemptId).single();
    const{data:qs}=await sb.schema('recruit').from('test_questions').select('*').eq('test_id',full.test_id).order('seq',{ascending:true});
    const{data:answers}=await sb.schema('recruit').from('test_answers').select('*').eq('attempt_id',attemptId);
    const byQ={}; (answers||[]).forEach(a=>byQ[a.question_id]=a);
    rb.innerHTML=`<button class="btn btn-sm" onclick="rtResultsNative(${full.test_id},${!!full.is_preview})" style="margin-bottom:12px"><i class="fa-solid fa-arrow-left"></i> Back to ${full.is_preview?'Previews':'Results'}</button>
      <div style="font-size:13px;color:var(--slate);margin-bottom:14px">${esc(full.candidate_email||'—')} · ${full.final_pct!=null?full.final_pct+'% — '+(full.pass_fail?'Pass':'Fail'):'Not yet graded'}
        ${(full.mcq_max==null||Number(full.ai_max||0)>0)?`<button class="btn btn-sm" style="margin-left:8px"
            title="${full.ai_status==='failed'?'Grading did not finish — run it again':'Mark the written answers again'}"
            onclick="rtRegradeAttempt('${attemptId}')"><i class="fa-solid fa-rotate"></i> ${full.ai_status==='failed'?'Retry grading':'Re-grade'}</button>`:''}
      </div>
      ${(qs||[]).map((q,i)=>{
        const a=byQ[q.id]||{};
        const given=a.answer_text||'';
        const isMcq=q.type==='mcq';
        const marksTag=`<span class="tag ${a.marks_earned>=q.max_marks?'t-green':(a.marks_earned>0?'t-amber':'t-gray')}" style="font-size:12px;font-weight:700;flex:none">${a.marks_earned!=null?a.marks_earned:0} / ${q.max_marks} marks</span>`;
        return `<div class="card" style="padding:12px;margin-bottom:8px;background:var(--bg2)">
          <div style="display:flex;align-items:flex-start;gap:10px;justify-content:space-between">
            <div style="font-weight:500;flex:1">${i+1}. ${esc(q.prompt)}</div>
            ${marksTag}
          </div>
          ${isMcq
            ?`<div style="margin-top:8px">${(q.options||[]).map(o=>{
                const chosen=o===given, correct=o===q.correct_option;
                const style=correct?'color:var(--ok);font-weight:600':(chosen?'color:var(--err);font-weight:600':'color:var(--ink)');
                const tag=correct?' <span style="font-size:10.5px;color:var(--ok)">(correct answer)</span>':(chosen?' <span style="font-size:10.5px;color:var(--err)">(their answer)</span>':'');
                return `<div style="font-size:12.5px;padding:3px 0;${style}">${chosen||correct?(chosen?'●':'○'):'○'} ${esc(o)}${tag}</div>`;
              }).join('')}${!given?'<div style="font-size:11.5px;color:var(--slate);margin-top:4px">(no answer given)</div>':''}</div>`
            :`<div style="font-size:12.5px;margin-top:8px;white-space:pre-wrap;color:var(--ink)">${esc(given||'(no answer given)')}</div>
              ${a.ai_feedback?`<div style="font-size:11.5px;color:var(--slate);margin-top:6px;font-style:italic">AI feedback: ${esc(a.ai_feedback)}</div>`:''}`}
        </div>`;
      }).join('')}`;
  }catch(e){
    rb.innerHTML=`<div class="empty" style="padding:30px;color:var(--err)"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(e.message)}</div>`;
  }
};
window.rtRegradeAttempt=async function(attemptId){
  toast('Regrading…');
  try{
    const{data,error}=await sb.functions.invoke('recruit-test-regrade',{body:{attempt_id:attemptId}});
    if(error||data?.error)throw new Error((data&&data.error)||error.message);
    toast('Regraded: '+data.final_pct+'% — '+(data.pass_fail?'Pass':'Fail'));
    rtResultsAttemptDetail(attemptId);
  }catch(e){toast('Regrade failed: '+((e&&e.message)||e),'err');}
};
window.rtPreview=async function(id){
  const rec=(RT_RECORDS||[]).find(r=>r.id===id);if(!rec)return;
  const panel=$('rtPreviewPanel');if(!panel)return;
  panel.style.display='block';
  panel.innerHTML=`<div class="card card-pad">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <i class="fa-solid fa-list-check" style="color:#0369a1;font-size:16px"></i>
      <span style="font-weight:700;font-size:15px">${esc(rec.name)} — Responses</span>
      <button style="margin-left:auto;background:none;border:none;cursor:pointer;font-size:22px;line-height:1;color:var(--slate)" onclick="document.getElementById('rtPreviewPanel').style.display='none'">&times;</button>
    </div>
    <div id="rtPreviewBody"><div class="loader"><div class="spin"></div></div></div>
  </div>`;
  panel.scrollIntoView({behavior:'smooth',block:'start'});
  const pb=$('rtPreviewBody');
  try{
    const{data,error}=await sb.schema('recruit').from('test_responses')
      .select('respondent,score_got,score_total,time_taken,submitted_at,answers')
      .eq('test_id',id)
      .order('score_got',{ascending:false,nullsFirst:false});
    if(error)throw new Error(error.message);
    if(!data||!data.length){
      pb.innerHTML='<div class="empty" style="padding:36px;color:var(--slate)"><i class="fa-solid fa-inbox" style="font-size:28px;opacity:.3;display:block;margin-bottom:10px"></i>No responses imported yet for this test.</div>';
      return;
    }
    const pct=(g,t)=>t?Math.round(g/t*100):null;
    const scoreTag=(g,t)=>{
      if(g==null)return '<span style="color:var(--slate)">—</span>';
      const p=pct(g,t);
      const col=p==null?'var(--ink)':p>=70?'#16855a':p>=40?'#c08000':'#c83232';
      return `<b style="color:${col}">${g}${t?' / '+t:''}</b>${p!=null?` <span style="font-size:11px;color:var(--slate)">(${p}%)</span>`:''}`;
    };
    const fmtDate=ts=>{if(!ts)return '—';try{return new Date(ts).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});}catch{return ts;}};
    pb.innerHTML=`
      <div style="font-size:12px;color:var(--slate);margin-bottom:10px">${data.length} response${data.length!==1?'s':''} · sorted by score</div>
      <div style="overflow-x:auto">
      <table class="tbl" style="min-width:400px">
        <thead><tr>
          <th style="width:36px;text-align:center">#</th>
          <th>Respondent</th>
          <th style="text-align:center;white-space:nowrap">Score</th>
          <th style="white-space:nowrap">Time Taken</th>
          <th style="white-space:nowrap">Date</th>
        </tr></thead>
        <tbody>${data.map((r,i)=>`<tr>
          <td style="text-align:center;color:var(--slate);font-size:12px">${i+1}</td>
          <td style="font-weight:500">${esc(r.respondent||'—')}</td>
          <td style="text-align:center;white-space:nowrap">${scoreTag(r.score_got,r.score_total)}</td>
          <td style="font-size:12px;color:var(--slate);white-space:nowrap">${esc(r.time_taken||'—')}</td>
          <td style="font-size:12px;color:var(--slate);white-space:nowrap">${fmtDate(r.submitted_at)}</td>
        </tr>`).join('')}
        </tbody>
      </table></div>`;
  }catch(e){
    pb.innerHTML=`<div class="empty" style="padding:30px;color:var(--err)"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(e.message)}</div>`;
  }
};

/* ── ManPower Requisition Form ── */
let MP_RECORDS=null;
const MP_DEPTS=['Sales','Pre Sales','Channel Partner','Marketing','Accounts','Finance','IT','HR','Legal','Operations','Facility & Maintenance','Procurement','Admin','Other'];
const MP_EXP=['Fresher (0-1 yr)','1-2 years','2-3 years','3-4 years','3-5 years','4-6 years','5-7 years','7-10 years','10+ years','As per norms'];
const MP_SAL=['As per Company norms','Upto ₹10,000','₹10,000 - ₹15,000','₹15,000 - ₹20,000','₹20,000 - ₹25,000','₹25,000 - ₹30,000','₹30,000 - ₹40,000','₹40,000 - ₹55,000','₹55,000 - ₹75,000','Above ₹75,000','Negotiable'];
const MP_GEND=['Male','Female','Male / Female','Any'];
function mpToDateInput(s){
  if(!s)return '';
  if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.substring(0,10);
  const m=s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})$/);
  if(m){const y=m[3].length===2?'20'+m[3]:m[3];return y+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');}
  return '';
}
function mpFmtDate(s){
  const d=mpToDateInput(s);
  if(!d)return s||'—';
  const[y,mo,day]=d.split('-');
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return day+' '+months[parseInt(mo)-1]+' '+y;
}
/* THE DATE OF REQUEST IS TODAY, AND IT STAYS TODAY.
   It used to be an ordinary date box, which meant a requisition could be back-dated - and one
   back-dated by a week is a requisition that looks overdue for approval the moment it arrives,
   or one quietly aged to jump the queue. The date a request was raised is a fact about when it
   was raised, not a preference, so the form fills it in and greys it out. An existing
   requisition keeps the date it was actually raised on; it just can't be edited either. */
function mpTodayInput(){
  const d=new Date(), p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
}

/* THE JOB TITLE FILLS IN THE DEPARTMENT AND THE QUALIFICATION.
   Plain keyword matching, deliberately - no AI. Nothing here should depend on a model being
   reachable, costing money, or answering differently on a Tuesday; somebody typing "Site
   Engineer" wants the Department box to say Operations before their finger leaves the key.
   Both are only ever SUGGESTIONS: the moment anyone touches either box by hand it is theirs,
   and the title can then change as much as it likes without overwriting the choice.

   ORDER MATTERS in this list, because the first match wins and the titles overlap. "Pre Sales
   Executive" contains the word "sales", so Pre Sales has to be asked before Sales. "Site
   Engineer" contains "engineer", so Operations has to be asked before IT. Anything genuinely
   unrecognised leaves the boxes alone rather than guessing - a wrong department that looks
   deliberate is worse than an empty one. */
const MP_TITLE_DEPT=[
  ['Pre Sales',            ['pre sales','pre-sales','presales','telecaller','tele caller','tele-caller','inside sales','call centre','call center','lead qualification']],
  ['Channel Partner',      ['channel partner','channel sales','broker','cp manager']],
  ['HR',                   ['hr ','hr-','human resource','recruit','talent acquisition','payroll']],
  ['Legal',                ['legal','lawyer','advocate','litigation','compliance','company secretary']],
  ['Finance',              ['finance','financial','treasury','chartered accountant','taxation','gst','audit','cfo']],
  ['Accounts',             ['account','bookkeep','book keeping','billing','tally','invoice']],
  ['Procurement',          ['procure','purchase','vendor','supply chain','store keeper','storekeeper','inventory','material']],
  ['Facility & Maintenance',['facility','maintenance','housekeep','electrician','plumber','carpenter','security guard','gardener','caretaker','lift operator']],
  ['Operations',           ['site engineer','civil engineer','structural','project manager','project engineer','planning engineer','quantity surveyor','execution','site supervisor','architect','safety officer','qa/qc','quality control','operations']],
  ['Marketing',            ['marketing','digital','seo','social media','brand','content writer','copywriter','graphic','designer','creative','advertis','campaign','video editor','photographer','media buyer']],
  ['IT',                   ['software','developer','programmer','it executive','it manager','it support','system admin','network','database','devops','data analyst','tech support','hardware']],
  ['Sales',                ['sales','business development','relationship manager','closing manager']],
  ['Admin',                ['admin','receptionist','front desk','front office','office assistant','peon','driver','clerk','secretary','personal assistant']],
];
/* Qualification is a looser suggestion again - the usual entry requirement for that kind of
   role here, not a rule. Left blank when nothing obvious fits. */
const MP_TITLE_QUAL=[
  [['site engineer','civil engineer','structural','planning engineer','project engineer','quantity surveyor','execution'], 'B.E. / B.Tech (Civil)'],
  [['architect'],                                          'B.Arch'],
  [['software','developer','programmer','devops','database','network','data analyst','it executive','it manager','it support','tech support'], 'B.Tech / BCA / MCA'],
  [['chartered accountant',' ca ','taxation','gst','audit'],'CA / CA Inter'],
  [['account','finance','bookkeep','billing','tally'],      'B.Com (Hons) / M.Com'],
  [['hr ','human resource','recruit','talent acquisition','payroll'], 'MBA (HR) / MSW'],
  [['legal','lawyer','advocate','litigation'],              'LL.B'],
  [['company secretary'],                                   'CS'],
  [['marketing','digital','seo','social media','brand','campaign','media buyer'], 'MBA (Marketing) / Graduate'],
  [['graphic','designer','creative','video editor','photographer','content writer','copywriter'], 'Graduate / Diploma in Design'],
  [['electrician','plumber','carpenter','technician','lift operator'], 'ITI / Diploma'],
  [['driver'],                                              'Valid commercial driving licence'],
  [['security guard','housekeep','peon','gardener','caretaker'], 'Class VIII pass or above'],
  [['sales','business development','relationship manager','telecaller','tele caller','presales','pre sales','channel partner'], 'Graduate'],
  [['receptionist','front desk','front office','office assistant','admin','clerk','secretary'], 'Graduate'],
  [['purchase','procure','store keeper','storekeeper','inventory','project manager','safety officer'], 'Graduate / Diploma'],
];
function mpDeptFromTitle(title){
  const t=' '+String(title||'').toLowerCase().trim()+' ';
  if(t.trim().length<3) return '';
  for(const [dept,words] of MP_TITLE_DEPT){ if(words.some(w=>t.includes(w))) return dept; }
  return '';
}
function mpQualFromTitle(title){
  const t=' '+String(title||'').toLowerCase().trim()+' ';
  if(t.trim().length<3) return '';
  for(const [words,qual] of MP_TITLE_QUAL){ if(words.some(w=>t.includes(w))) return qual; }
  return '';
}
// Anything typed or chosen by hand is the person's own - never overwritten by a later title edit.
window.mpMarkTouched=function(el){ if(el) el._mpTouched=true; };
window.mpTitleSuggest=function(){
  const title=($('mpFTitle')||{}).value||'';
  const sel=$('mpFDeptSel');
  if(sel&&!sel._mpTouched){
    const dept=mpDeptFromTitle(title);
    if(dept&&MP_DEPTS.includes(dept)){ sel.value=dept; mpSelChange('mpFDept'); }
  }
  const qual=$('mpFQual');
  if(qual&&!qual._mpTouched){ qual.value=mpQualFromTitle(title); }
};
function mpSelOpt(id,opts,val){
  const known=opts.includes(val);
  let h=`<select id="${id}Sel" class="sel" onchange="mpMarkTouched(this);mpSelChange('${id}')">`;
  h+=opts.map(o=>`<option${o===val?' selected':''}>${esc(o)}</option>`).join('');
  h+=`<option value="__other"${!known&&val?' selected':''}>Other (type below)</option></select>`;
  h+=`<input id="${id}Custom" class="inp" style="margin-top:6px;display:${known||!val?'none':'block'}" value="${esc(!known?val:'')}">`;
  return h;
}
async function recManpower(){
  const b=$('recBody');
  if(!MP_RECORDS){
    b.innerHTML='<div class="empty" style="padding:40px"><i class="fa-solid fa-spinner fa-spin"></i></div>';
    try{const {data,error}=await sb.schema('hr').from('manpower_requests').select('*').order('submitted_at',{ascending:false});
      if(error)throw error; MP_RECORDS=data||[];}catch(e){b.innerHTML='<div class="empty" style="padding:40px;color:#c83232">'+esc(e.message)+'</div>';return;}
  }
  const rows=MP_RECORDS;
  const priTag=p=>p==='Urgent'?'<span class="tag t-red">Urgent</span>':'<span class="tag t-gray">'+(p||'—')+'</span>';
  const dis='opacity:.38;cursor:not-allowed;pointer-events:none';
  b.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <div class="sec-title" style="margin:0">Hiring Requests <span class="tag t-gray" style="margin-left:4px">${rows.length}</span></div>
    <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap" id="mpToolbar">
      <button class="btn btn-primary" onclick="mpFillForm()"><i class="fa-solid fa-pen-to-square"></i> Fill Form</button>
      <button class="btn" id="mpEditBtn" disabled style="${dis}" onclick="mpEditSel()"><i class="fa-solid fa-pen"></i> Edit</button>
      <button class="btn" id="mpDelBtn" disabled style="${dis};color:var(--err);border-color:var(--err)" onclick="mpDeleteSel()"><i class="fa-solid fa-trash"></i> Delete</button>
    </div>
  </div>
  <div style="overflow-x:auto">
  <table class="tbl" id="mpTbl">
    <thead><tr>
      <th style="width:36px;text-align:center"><input type="checkbox" id="mpChkAll" onchange="mpToggleAll(this)"></th>
      <th>Job Title</th><th>Department</th><th>Date of Request</th>
      <th style="text-align:center">Vacancy</th><th>Reporting To / HOD</th><th>Experience</th><th>Salary Range</th><th>Location</th><th>Priority</th>
    </tr></thead>
    <tbody>${rows.length?rows.map(r=>`<tr class="mp-row" style="cursor:pointer" onclick="mpShowDetail(${r.id},event)">
      <td style="text-align:center" onclick="event.stopPropagation()"><input type="checkbox" class="mp-chk" value="${r.id}" onchange="mpSyncToolbar()"></td>
      <td style="font-weight:600">${esc(r.job_title||'—')}</td>
      <td>${esc(r.department||'—')}</td>
      <td style="color:var(--slate);font-size:12px;white-space:nowrap">${esc(mpFmtDate(r.date_of_request))}</td>
      <td style="text-align:center">${esc(String(r.no_of_vacancy||'—'))}</td>
      <td style="font-size:12px">${esc(r.reporting_person||'—')}</td>
      <td style="font-size:12px">${esc(r.experience||'—')}</td>
      <td style="font-size:12px">${esc(r.salary_range||'—')}</td>
      <td>${esc(r.location||'—')}</td>
      <td>${priTag(r.priority)}</td>
    </tr>`).join(''):'<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--slate)">No hiring requests yet — click <b>Fill Form</b> to add one</td></tr>'}
    </tbody>
  </table>
  </div>
  <div id="mpDetail" style="display:none"></div>`;
}
window.mpToggleAll=function(el){document.querySelectorAll('.mp-chk').forEach(c=>c.checked=el.checked);mpSyncToolbar();};
window.mpSyncToolbar=function(){
  const sel=[...document.querySelectorAll('.mp-chk:checked')];
  const n=sel.length;
  const dis='opacity:.38;cursor:not-allowed;pointer-events:none';
  const editBtn=$('mpEditBtn'),delBtn=$('mpDelBtn');
  if(editBtn){editBtn.disabled=n!==1;editBtn.style.cssText=n===1?'':'opacity:.38;cursor:not-allowed;pointer-events:none';}
  if(delBtn){delBtn.disabled=n===0;delBtn.style.cssText=n>0?'color:var(--err);border-color:var(--err)':'opacity:.38;cursor:not-allowed;pointer-events:none;color:var(--err);border-color:var(--err)';}
};
window.mpEditSel=function(){if(!recGuard())return;
  const sel=[...document.querySelectorAll('.mp-chk:checked')];
  if(sel.length!==1)return;
  mpEdit(parseInt(sel[0].value));
};
window.mpDeleteSel=async function(){if(!recGuard())return;
  const sel=[...document.querySelectorAll('.mp-chk:checked')].map(c=>parseInt(c.value));
  if(!sel.length)return;
  if(!await confirmDialog('Delete '+sel.length+' hiring request'+(sel.length===1?'':'s')+'? This cannot be undone.'))return;
  const {error}=await sb.schema('hr').from('manpower_requests').delete().in('id',sel);
  if(error){toast(error.message,'err');return;}
  if(MP_RECORDS)MP_RECORDS=MP_RECORDS.filter(r=>!sel.includes(r.id));
  toast(sel.length+' deleted');mpRefreshList();
};
window.mpShowDetail=function(id,e){
  if(e&&e.target&&e.target.type==='checkbox')return;
  const rec=(MP_RECORDS||[]).find(r=>r.id===id);if(!rec)return;
  const panel=$('mpDetail');if(!panel)return;
  const priTag=p=>p==='Urgent'?'<span class="tag t-red">Urgent</span>':'<span class="tag t-gray">'+(p||'—')+'</span>';
  // Highlight active row
  document.querySelectorAll('.mp-row').forEach(tr=>tr.style.background='');
  const rows=[...document.querySelectorAll('.mp-row')];
  const activeRow=rows.find(tr=>{const chk=tr.querySelector('.mp-chk');return chk&&parseInt(chk.value)===id;});
  if(activeRow)activeRow.style.background='#fdf4f6';
  panel.style.display='block';
  panel.innerHTML=`<div class="card card-pad" style="margin-top:14px;position:relative">
    <button style="position:absolute;top:12px;right:12px;background:none;border:none;cursor:pointer;font-size:18px;color:var(--slate);line-height:1" onclick="mpCloseDetail()">&times;</button>
    <div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;padding-right:32px">
      <div style="flex:1;min-width:220px">
        <div style="font-size:18px;font-weight:700;color:var(--ink)">${esc(rec.job_title||'—')}</div>
        <div style="color:var(--slate);font-size:13px;margin-top:2px">${esc(rec.department||'—')} &nbsp;·&nbsp; ${mpFmtDate(rec.date_of_request)}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        ${priTag(rec.priority)}
        <button class="btn btn-sm btn-primary" onclick="mpEdit(${rec.id})"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn btn-sm" style="color:var(--err);border-color:var(--err)" onclick="mpDeleteOne(${rec.id})"><i class="fa-solid fa-trash"></i> Delete</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px 20px;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
      <div><div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--slate);letter-spacing:.04em">Vacancies</div><div style="font-size:14px;margin-top:2px">${esc(String(rec.no_of_vacancy||'—'))}</div></div>
      <div><div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--slate);letter-spacing:.04em">Reporting To / HOD</div><div style="font-size:14px;margin-top:2px">${esc(rec.reporting_person||'—')}</div></div>
      <div><div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--slate);letter-spacing:.04em">Qualification</div><div style="font-size:14px;margin-top:2px">${esc(rec.qualification||'—')}</div></div>
      <div><div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--slate);letter-spacing:.04em">Experience</div><div style="font-size:14px;margin-top:2px">${esc(rec.experience||'—')}</div></div>
      <div><div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--slate);letter-spacing:.04em">Gender</div><div style="font-size:14px;margin-top:2px">${esc(rec.gender||'—')}</div></div>
      <div><div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--slate);letter-spacing:.04em">Salary Range</div><div style="font-size:14px;margin-top:2px">${esc(rec.salary_range||'—')}</div></div>
      <div><div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--slate);letter-spacing:.04em">Location</div><div style="font-size:14px;margin-top:2px">${esc(rec.location||'—')}</div></div>
    </div>
    ${rec.job_description?`<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)"><div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--slate);letter-spacing:.04em;margin-bottom:6px">Job Description / KPI</div><div style="font-size:13.5px;white-space:pre-wrap;line-height:1.6;color:var(--ink)">${esc(rec.job_description)}</div></div>`:''}
    ${rec.notes?`<div style="margin-top:12px;padding:10px 14px;background:#fefce8;border-radius:8px;border:1px solid #fde68a"><span style="font-size:11px;font-weight:700;text-transform:uppercase;color:#a16207">Note · </span><span style="font-size:13px;color:#78350f">${esc(rec.notes)}</span></div>`:''}
    ${mpAiPanel(rec)}
  </div>`;
};
window.mpCloseDetail=function(){
  const p=$('mpDetail');if(p)p.style.display='none';
  document.querySelectorAll('.mp-row').forEach(tr=>tr.style.background='');
};
window.mpSelChange=function(id){
  const sel=$(`${id}Sel`),cust=$(`${id}Custom`);
  if(sel&&cust)cust.style.display=sel.value==='__other'?'block':'none';
};
function mpGetField(id,opts){
  const sel=$(id+'Sel'),cust=$(id+'Custom');
  if(!sel)return '';
  return sel.value==='__other'?(cust?cust.value.trim():''):sel.value;
}
function mpModal(title,vals,saveBtn){
  const locs=['HO','Site/Project Name','Durgapur','Siliguri'];
  /* HO on a new form, because most requests are for head office and an empty set of locations is
     never what anybody meant. An EXISTING request keeps exactly what it was saved with - including
     none - so editing one cannot quietly add a location nobody chose. */
  const selLocs=vals ? (vals.location?vals.location.split(',').map(s=>s.trim()):[]) : ['HO'];
  const locChk=locs.map(l=>`<label class="mpf-chip"><input type="checkbox" class="mp-loc" value="${l}"${selLocs.includes(l)?' checked':''}> ${l}</label>`).join('');
  // A new form opens on today; an existing one shows the day it was actually raised. Neither
  // can be typed over - see mpTodayInput above.
  const dateVal=mpToDateInput(vals&&vals.date_of_request||'')||mpTodayInput();
  /* THE FORM, REBUILT AROUND WHAT IS BEING ASKED RATHER THAN WHAT THE TABLE HOLDS.

     It used to be eleven fields in a flat stack, every one the same weight, with two of them
     explaining themselves in grey text underneath. Three things went:

       Date of Request  - it is always today and could never be edited. A disabled box that always
                          says the same thing is furniture, not a field. It is still recorded.
       Job Description  - a description is WRITTEN from this request, by AI, and then reviewed.
       / KPI              Asking for one here meant typing something that would be replaced.
       The suggestions  - Department and Qualification guessed from the job title. A guess that is
                          right most of the time is worse than no guess, because the times it is
                          wrong are the times nobody looks.

     What is left is grouped: the role, then the person, then the terms. Defaults are set where
     there is an obvious one - Location HO, Not Urgent - so the common request is mostly filled in
     before anybody types. */
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-file-pen"></i> ${title}</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <style>
    /* THREE GROUPS, AND YOU CAN SEE THAT THERE ARE THREE.

       The fields were already in sections, but the only thing separating them was a hairline and
       18px - less than the gap between two fields inside a section. So everything sat at the same
       distance from everything else and the form read as one long column of thirteen boxes.
       Things that belong together are now closer to each other than to anything else, which is
       what makes a group a group: each section is its own panel, with real space between panels
       and a quieter heading, because the panel already says where the boundary is. */
    .mpf-sec{background:#fff;border:1px solid var(--line);border-radius:12px;
      padding:16px 18px 18px;margin:0 0 16px}
    .mpf-sec:last-of-type{margin-bottom:4px}
    .mpf-sec-t{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:700;
      letter-spacing:.8px;text-transform:uppercase;color:var(--slate);margin:0 0 14px}
    .mpf-sec-t::after{content:"";flex:1;height:1px;background:var(--line)}
    .mpf-sec-t i{color:var(--brand);font-size:12px}
    /* 22px between rows, 20px between the two columns - a field is nearer its own label than the
       next field is, which is the whole point. */
    .frm .mpf-row{display:grid;grid-template-columns:1fr 1fr;gap:18px 20px;margin-bottom:18px}
    .frm .mpf-row:last-child{margin-bottom:0}
    .frm .mpf-row.one{grid-template-columns:1fr}
    .frm .mpf-row label{display:block;margin:0 0 6px;font-size:12px;font-weight:600;
      color:var(--slate);letter-spacing:.2px}
    .frm .mpf-row .inp,.frm .mpf-row .sel,.frm .mpf-row select{margin:0}
    .mpf-hint{font-size:11.5px;color:var(--slate);margin-top:7px;line-height:1.45}
    .mpf-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:2px}
    .mpf-chip{display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border:1px solid var(--line);
      border-radius:999px;cursor:pointer;font-size:13px;background:#fff;margin:0;transition:.12s}
    .mpf-chip:hover{background:#f8fafc;border-color:#94a3b8}
    .mpf-chip:has(input:checked){background:#eff6ff;border-color:var(--brand);color:#1e40af;font-weight:600}
    .frm .mpf-chip input{width:auto;margin:0;padding:0;border:0;box-shadow:none;background:none}
    @media(max-width:620px){
      .frm .mpf-row{grid-template-columns:1fr;gap:16px}
      .mpf-sec{padding:14px 14px 16px}
    }
  </style>
  <div class="modal-body frm" style="max-height:74vh;overflow-y:auto;background:var(--bg);padding-top:16px">
    <div class="mpf-sec">
    <div class="mpf-sec-t"><i class="fa-solid fa-briefcase"></i>The role</div>
    <div class="mpf-row">
      <div><label>Job Title *</label><input id="mpFTitle" class="inp" value="${esc(vals&&vals.job_title||'')}" placeholder="e.g. Sales Executive"></div>
      <div><label>Department *</label>${mpSelOpt('mpFDept',MP_DEPTS,vals&&vals.department||'')}</div>
    </div>
    <div class="mpf-row">
      <div><label>Number of People *</label><input id="mpFVac" class="inp" value="${esc(vals&&vals.no_of_vacancy||'')}" placeholder="e.g. 2"></div>
      <div><label>Reporting Person / HOD *</label><input id="mpFHOD" class="inp" value="${esc(vals&&vals.reporting_person||'')}" placeholder="Name"></div>
    </div>
    <div class="mpf-row one">
      <div><label>Location</label><div class="mpf-chips">${locChk}</div></div>
    </div>
    </div>

    <div class="mpf-sec">
    <div class="mpf-sec-t"><i class="fa-solid fa-user-check"></i>The person</div>
    <div class="mpf-row">
      <div><label>Experience</label>${mpSelOpt('mpFExp',MP_EXP,vals&&vals.experience||'')}</div>
      <div><label>Required Qualification</label><input id="mpFQual" class="inp" value="${esc(vals&&vals.qualification||'')}" placeholder="e.g. Graduate, B.Tech"></div>
    </div>
    <div class="mpf-row one">
      <div><label>Gender</label>
        <div class="mpf-chips">
          ${['Any','Male','Female'].map(g=>`<label class="mpf-chip"><input type="radio" name="mpGender" value="${g}"${(vals&&vals.gender||'Any')===g?' checked':''}> ${g}</label>`).join('')}
        </div>
      </div>
    </div>
    </div>

    <div class="mpf-sec">
    <div class="mpf-sec-t"><i class="fa-solid fa-file-signature"></i>The terms</div>
    <div class="mpf-row">
      <div><label>Salary Range</label>${mpSelOpt('mpFSalary',MP_SAL,vals&&vals.salary_range||'')}</div>
      <div><label>Priority</label>
        <div class="mpf-chips">
          <label class="mpf-chip"><input type="radio" name="mpPri" value="Not Urgent"${(vals&&vals.priority)==='Urgent'?'':' checked'}> Not Urgent</label>
          <label class="mpf-chip"><input type="radio" name="mpPri" value="Urgent"${(vals&&vals.priority)==='Urgent'?' checked':''}> <span style="color:#c83232;font-weight:600">Urgent</span></label>
        </div>
        <div class="mpf-hint">Urgent is for a sudden absence or resignation.</div>
      </div>
    </div>
    <div class="mpf-row one">
      <div><label>Notes / Reason</label><textarea id="mpFNotes" class="inp" rows="3" placeholder="Anything the approver should know">${esc(vals&&vals.notes||'')}</textarea></div>
    </div>
    </div>
    <input type="hidden" id="mpFDate" value="${dateVal}">
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>${saveBtn}</div>`);
}
function mpCollect(){
  const locs=[...document.querySelectorAll('.mp-loc:checked')].map(el=>el.value).join(', ');
  const pri=(document.querySelector('input[name="mpPri"]:checked')||{}).value||'Not Urgent';
  // Disabled inputs still hand their value to JavaScript, so this reads the locked box; the
  // fallback only matters if the field ever goes missing, and today is the right answer then.
  const rawDate=$('mpFDate')&&$('mpFDate').value?$('mpFDate').value:mpTodayInput();
  let fmtDate=rawDate;
  if(rawDate&&/^\d{4}-\d{2}-\d{2}$/.test(rawDate)){const[y,mo,d]=rawDate.split('-');fmtDate=d+'/'+mo+'/'+y;}
  return {
    job_title:($('mpFTitle').value||'').trim(),
    date_of_request:fmtDate,
    department:mpGetField('mpFDept',MP_DEPTS),
    no_of_vacancy:($('mpFVac').value||'').trim(),
    reporting_person:($('mpFHOD').value||'').trim(),
    qualification:($('mpFQual').value||'').trim(),
    experience:mpGetField('mpFExp',MP_EXP),
    gender:(document.querySelector('input[name="mpGender"]:checked')||{}).value||'Any',
    salary_range:mpGetField('mpFSalary',MP_SAL),
    location:locs,
    priority:pri,
    notes:($('mpFNotes').value||'').trim(),
    submitted_at:new Date().toISOString()
  };
}
window.mpFillForm=function(){if(!recGuard())return;mpModal('Hiring Request',null,'<button class="btn btn-primary" id="mpSaveBtn" onclick="mpSave()"><i class="fa-solid fa-check"></i> Submit</button>');};
window.mpSave=async function(){
  const d=mpCollect();
  if(!d.job_title){toast('Job Title is required','err');return;}
  const btn=$('mpSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const {data,error}=await sb.schema('hr').from('manpower_requests').insert(d).select().single();
  if(error){toast(error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Submit';}return;}
  MP_RECORDS=[data,...(MP_RECORDS||[])];closeModal();toast('Hiring request submitted');mpRefreshList();
};
/* REDRAW WHICHEVER LIST IS ACTUALLY ON SCREEN.

   Both layouts render into #recBody: the Hiring Request tab through tpMpRender, and the retired
   recruitment page through recManpower. Saving an edit called recManpower unconditionally, so the
   new tab was redrawn with the OLD toolbar - same data, different screen, and only ever after an
   edit, which is why it looked like the page had changed its mind. */
function mpRefreshList(){
  if(PAGE==='recruitment_new'&&typeof tpManpower==='function'){ tpManpower(); return; }
  recManpower();
}
window.mpEdit=function(id){if(!recGuard())return;
  const rec=(MP_RECORDS||[]).find(r=>r.id===id);if(!rec)return;
  mpModal('Edit Hiring Request',rec,`<button class="btn btn-primary" id="mpSaveBtn" onclick="mpUpdate(${id})"><i class="fa-solid fa-check"></i> Update</button>`);
};
window.mpUpdate=async function(id){
  const d=mpCollect();delete d.submitted_at;
  const btn=$('mpSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const prevRec=(MP_RECORDS||[]).find(r=>r.id===id);
  const {data,error}=await sb.schema('hr').from('manpower_requests').update(d).eq('id',id).select().single();
  if(error){toast(error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Update';}return;}
  if(prevRec&&prevRec.priority!==d.priority){ try{usageQueue('recruitment.manpower_form.mark_requisition_priority','update',{title:d.job_title,priority:d.priority});}catch(_e){} }
  const idx=(MP_RECORDS||[]).findIndex(r=>r.id===id);
  if(idx>-1&&MP_RECORDS)MP_RECORDS[idx]=data;
  closeModal();toast('Updated');mpRefreshList();
};
window.mpDeleteOne=async function(id){if(!recGuard())return;
  if(!await confirmDialog('Delete this hiring request?'))return;
  const {error}=await sb.schema('hr').from('manpower_requests').delete().eq('id',id);
  if(error){toast(error.message,'err');return;}
  if(MP_RECORDS)MP_RECORDS=MP_RECORDS.filter(r=>r.id!==id);
  toast('Deleted');mpRefreshList();
};
window.mpDelete=window.mpDeleteOne;
window.mpReload=function(){MP_RECORDS=null;if(PAGE==='recruitment')renderPage();};

/* ── ManPower: the AI-written JD, post text and creative ──
   The generation itself is the manpower-ai-generate edge function: it reads the requisition, takes
   up to three of our past Job Descriptions as style examples, and writes the JD, the shorter
   job-board post text and a creative. It stores all three and stamps ai_status on the requisition.
   Nothing was ever calling it, so this is the button. */
function mpAiPanel(rec){
  const st=rec.ai_status||'pending';
  // The document is built from the JSON in the browser, so that - not the stored file - is what
  // decides whether there is anything to show.
  const hasJd=!!rec.ai_job_description_json;
  const badge={pending:'<span class="tag t-gray">Not generated</span>',
               generating:'<span class="tag t-blue"><i class="fa-solid fa-spinner fa-spin"></i> Writing…</span>',
               ready:'<span class="tag t-green">Ready</span>',
               failed:'<span class="tag t-red">Failed</span>'}[st]||'';
  let inner;
  if(st==='ready'&&hasJd){
    inner='<div class="mp-ai-acts">'
      +'<button class="btn btn-sm btn-primary" onclick="mpJdDownload('+rec.id+')"><i class="fa-solid fa-file-lines"></i> Job Description</button>'
      +(rec.ai_creative_path
        ? '<button class="btn btn-sm" onclick="mpCreativePng('+rec.id+')"><i class="fa-solid fa-image"></i> Creative</button>'
        : '')
      +'<button class="btn btn-sm" onclick="mpAiCopyPost('+rec.id+')"><i class="fa-solid fa-copy"></i> Copy post text</button>'
      +'<button class="btn btn-sm" onclick="mpAiGenerate('+rec.id+',true)"><i class="fa-solid fa-rotate"></i> Rewrite</button>'
      /* ADD IS WHAT PUTS IT IN THE LIBRARY. Nothing else does - not writing it, not approving the
         hiring request. A description sits with its request until somebody decides it is good
         enough to keep, which is the decision the old approval step was pretending to be. The
         same button is in the email that announces the description, so it can be done from a
         phone without opening JAIN-E. */
      +'<span id="mpJdAddWrap'+rec.id+'"></span>'
      +'</div>'
      +(rec.ai_platform_post_text
        ? '<div class="mp-ai-post"><div class="mp-ai-lbl">Post text — for LinkedIn, Naukri or Indeed</div>'
          +'<div class="mp-ai-post-body" id="mpAiPost'+rec.id+'">'+esc(rec.ai_platform_post_text)+'</div></div>'
        : '');
  } else if(st==='generating'){
    inner='<div class="mp-ai-note">Writing the Job Description now. It takes a few seconds — press Refresh when it settles.</div>'
      +'<div class="mp-ai-acts"><button class="btn btn-sm" onclick="mpReload()"><i class="fa-solid fa-rotate"></i> Refresh</button></div>';
  } else {
    inner='<div class="mp-ai-note">'
      +(st==='failed'
        ? 'The last attempt failed. Trying again is safe — nothing was saved.'
        : 'Writes a full Job Description in our house style, the shorter text for a job board, and a creative to post with it.')
      +'</div>'
      +'<div class="mp-ai-acts"><button class="btn btn-sm btn-primary" onclick="mpAiGenerate('+rec.id+')">'
      +'<i class="fa-solid fa-wand-magic-sparkles"></i> '+(st==='failed'?'Try again':'Generate')+'</button></div>';
  }
  const html='<div class="mp-ai"><div class="mp-ai-hd"><i class="fa-solid fa-wand-magic-sparkles"></i> Job Description &amp; creative '+badge+'</div>'+inner+'</div>';
  /* Whether this description is already in the library is a fact about the DESCRIPTION, held in
     recruit.job_descriptions, not about the request - so it has to be looked up. Done after the
     panel is on screen rather than before: the panel is drawn from data already in hand, and
     holding it back for one more round trip would leave the whole request blank while it waited. */
  if(st==='ready'&&hasJd) setTimeout(function(){ mpJdAddRefresh(rec.id); },0);
  return html;
}

/* Draws the Add button, or says it is already added. Separate from mpAiPanel so pressing Add can
   redraw just this one span instead of the whole request. */
async function mpJdAddRefresh(reqId){
  const host=$('mpJdAddWrap'+reqId); if(!host) return;
  let jd=null;
  try{
    const {data}=await sb.schema('recruit').from('job_descriptions')
      .select('id,in_library,added_by')
      .eq('manpower_request_id',reqId).order('created_at',{ascending:false}).limit(1);
    jd=(data||[])[0]||null;
  }catch(_e){ return; }   // a failed lookup shows nothing rather than a button that cannot work
  if(!jd){ host.innerHTML=''; return; }
  host.innerHTML=jd.in_library
    ? '<span class="tag t-green" title="'+esc(jd.added_by||'')+'"><i class="fa-solid fa-check"></i> In Descriptions</span>'
    : '<button class="btn btn-sm btn-primary" id="mpJdAddBtn'+reqId+'" onclick="mpJdAdd('+reqId+',\''+esc(jd.id)+'\')">'
      +'<i class="fa-solid fa-plus"></i> Add to Descriptions</button>';
}

window.mpJdAdd=async function(reqId,jdId){
  if(!recGuard()) return;
  const btn=$('mpJdAddBtn'+reqId);
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>'; }
  try{
    // .select() for the same reason as jdEditorSave: an update that row-level security filters
    // out comes back as success with nothing changed, and a button that lies is worse than one
    // that fails.
    const {data,error}=await sb.schema('recruit').from('job_descriptions')
      .update({in_library:true,added_by:state.email,added_at:new Date().toISOString()})
      .eq('id',jdId).select('id');
    if(error) throw new Error(error.message);
    if(!data||!data.length) throw new Error('nothing changed — you may not have permission');
    toast('Added — it is in Recruitment › Job Descriptions now','ok');
    mpJdAddRefresh(reqId);
  }catch(e){
    toast('Could not add it: '+((e&&e.message)||e),'err');
    if(btn){ btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-plus"></i> Add to Descriptions'; }
  }
};

window.mpAiCopyPost=function(id){
  const rec=(MP_RECORDS||[]).find(function(r){return r.id===id;});
  const txt=(rec&&rec.ai_platform_post_text)||'';
  if(!txt){ toast('No post text yet','err'); return; }
  // navigator.clipboard needs a secure context and can be refused; the textarea fallback works
  // everywhere, so a copy never silently does nothing.
  const done=function(){ toast('Post text copied','ok'); };
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(done,function(){ mpCopyFallback(txt,done); });
  } else { mpCopyFallback(txt,done); }
};
function mpCopyFallback(txt,done){
  const ta=document.createElement('textarea');
  ta.value=txt; ta.style.position='fixed'; ta.style.top='-1000px';
  document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); done(); }
  catch(e){ toast('Could not copy — select the text and copy it by hand','err'); }
  document.body.removeChild(ta);
}

window.mpAiGenerate=async function(id,isRewrite){
  if(!recGuard()) return;
  if(isRewrite && !await confirmDialog(
      'Rewrite the Job Description, post text and creative for this hiring request? The current ones are replaced.',
      {title:'Rewrite', okLabel:'Rewrite', icon:'fa-rotate', danger:false})) return;
  const rec=(MP_RECORDS||[]).find(function(r){return r.id===id;});
  if(rec){ rec.ai_status='generating'; mpShowDetail(id); }
  toast('Writing the Job Description…','ok');
  try{
    const {data,error}=await sb.functions.invoke('manpower-ai-generate',
      {body:{request_id:id, requested_by:state.email}});
    if(error) throw error;
    if(data&&data.error) throw new Error(data.error);
    toast('Job Description ready','ok');
  }catch(e){
    // The requisition's own ai_status is set to 'failed' by the function, so the reload below
    // shows the real state rather than whatever this screen last guessed.
    toast('Could not generate: '+((e&&e.message)||e),'err');
  }
  MP_RECORDS=null;
  if(PAGE==='recruitment') await recManpower();
  const still=$('mpDetail');
  if(still) mpShowDetail(id);
};

/* The Job Description document, built in the browser.
   It used to be an HTML file uploaded to public storage, and that can never work: Supabase serves
   HTML out of a public bucket as text/plain on purpose (it stops a stored page running scripts on
   the storage domain). The browser therefore showed the raw source - which is the "no CSS, opens
   some Supabase code" everybody was seeing. Verified: that URL returns Content-Type: text/plain,
   while the SVG creative beside it correctly returns image/svg+xml.
   So the document is assembled here instead, from ai_job_description_json which is already stored
   on the requisition. Print gives a PDF, Download gives a real file, and neither depends on how
   storage chooses to serve a content type. */
const JD_LOGO='https://rkxsgtauigjrpcjkmccu.supabase.co/storage/v1/object/public/recruitment-creatives/brand/jain-group-logo.webp';

function mpJdDocHtml(rec){
  const s=rec.ai_job_description_json||{};
  const q=s.qualifications||{};
  const li=function(arr){
    return (Array.isArray(arr)&&arr.length)
      ? '<ul>'+arr.map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul>' : '';
  };
  const resp=(s.responsibilities||[]).map(function(r){
    return '<li>'+(r.label?'<b>'+esc(r.label)+'</b>: ':'')+esc(r.detail||'')+'</li>';
  }).join('');
  const qual=[];
  if(q.education) qual.push('<p><b>Educational Background:</b> '+esc(q.education)+'</p>');
  if(q.experience) qual.push('<p><b>Professional Experience:</b> '+esc(q.experience)+'</p>');
  if(q.skills&&q.skills.length) qual.push('<p><b>Skills:</b></p>'+li(q.skills));
  if(q.personal_attributes&&q.personal_attributes.length)
    qual.push('<p><b>Personal Attributes:</b></p>'+li(q.personal_attributes));

  return '<!doctype html><html><head><meta charset="utf-8">'
    +'<title>'+esc(s.job_title||rec.job_title||'Job Description')+' — Jain Group</title>'
    +'<style>'
      +'@page{margin:18mm 16mm}'
      +'*{box-sizing:border-box}'
      +'body{font-family:Inter,"Segoe UI",Arial,sans-serif;color:#111;max-width:820px;margin:0 auto;padding:44px 52px;line-height:1.6}'
      +'.lh{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;'
        +'border-bottom:3px solid #D21F3C;padding-bottom:16px;margin-bottom:26px}'
      +'.lh img{height:42px}'
      +'h1{font-size:23px;margin:0 0 3px;letter-spacing:-.2px}'
      +'.dept{color:#555;font-size:14px}'
      +'h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#D21F3C;'
        +'border-bottom:1px solid #eee;padding-bottom:5px;margin:26px 0 10px}'
      +'p,li{font-size:14px}'
      +'ul{margin:4px 0 4px;padding-left:20px}'
      +'li{margin-bottom:4px}'
      +'.foot{margin-top:38px;padding-top:13px;border-top:1px solid #eee;font-size:11.5px;color:#888}'
      /* the print button is for the person reading it on screen and must never appear on paper */
      +'.noprint{position:fixed;top:14px;right:14px}'
      +'.noprint button{font:600 13px Inter,Arial,sans-serif;padding:9px 15px;border-radius:8px;'
        +'border:0;background:#D21F3C;color:#fff;cursor:pointer}'
      +'@media print{.noprint{display:none}body{padding:0}}'
    +'</style></head><body>'
    +'<div class="noprint"><button onclick="window.print()">Print / Save as PDF</button></div>'
    +'<div class="lh"><div><h1>'+esc(s.job_title||rec.job_title||'')+'</h1>'
      +'<div class="dept">'+esc(s.department||rec.department||'')+'</div></div>'
      +'<img src="'+JD_LOGO+'" alt="Jain Group"></div>'
    +'<h2>Job Summary</h2><p>'+esc(s.job_summary||'')+'</p>'
    +(resp?'<h2>Key Responsibilities</h2><ul>'+resp+'</ul>':'')
    +(qual.length?'<h2>Required Qualifications</h2>'+qual.join(''):'')
    +(s.compensation?'<h2>Compensation and Benefits</h2><p>'+esc(s.compensation)+'</p>':'')
    +'<div class="foot">Jain Group — Caring for your dreams. '
      +esc([rec.location?'Location: '+rec.location:'',
            rec.no_of_vacancy?'Vacancies: '+rec.no_of_vacancy:''].filter(Boolean).join(' · '))
      +'</div></body></html>';
}

function mpJdRec(id){
  const rec=(MP_RECORDS||[]).find(function(r){return r.id===id;});
  if(!rec||!rec.ai_job_description_json){ toast('No Job Description generated yet','err'); return null; }
  return rec;
}

/* Last resort only. The Job Description is a download, not something that opens in a tab - but if
   the browser refuses the blob download there has to be some way to get at the document, so it is
   opened instead and the print dialog offered. */
function mpJdOpenFallback(rec){
  const w=window.open('','_blank');
  if(!w) return false;
  w.document.open(); w.document.write(mpJdDocHtml(rec)); w.document.close();
  return true;
}

// Saves a real file. A Blob URL downloads whatever the server would have argued about.
window.mpJdDownload=function(id){
  const rec=mpJdRec(id); if(!rec) return;
  if(!('download' in document.createElement('a'))){
    if(!mpJdOpenFallback(rec)) toast('Your browser will not download it — allow pop-ups for JAIN-E','err');
    return;
  }
  const name=String((rec.ai_job_description_json.job_title||rec.job_title||'Job Description'))
    .replace(/[^A-Za-z0-9 .()-]/g,'').trim().replace(/\s+/g,'_');
  const blob=new Blob([mpJdDocHtml(rec)],{type:'text/html;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=(name||'Job_Description')+' — Jain Group.html';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); },4000);
  toast('Downloaded','ok');
};

/* The creative is stored as SVG - text stays crisp at any size and the poster can be re-rendered
   from it - but what anybody actually posts to LinkedIn or WhatsApp is a PNG. The conversion runs
   here rather than on the server: rasterising in Deno would mean adding an image library, whereas
   the browser already has one.
   The SVG is fetched as TEXT and handed back as a same-origin blob. Pointing an <img> at the
   storage URL directly would taint the canvas and toBlob() would then be refused - the file is
   cross-origin even though storage does send permissive CORS headers. */
window.mpCreativePng=async function(id){
  const rec=(MP_RECORDS||[]).find(function(r){return r.id===id;});
  if(!rec||!rec.ai_creative_path){ toast('No creative generated yet','err'); return; }
  const btn=event&&event.currentTarget;
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Building…'; }
  let url=null;
  try{
    const res=await fetch(rec.ai_creative_path,{cache:'no-store'});
    if(!res.ok) throw new Error('could not read the creative ('+res.status+')');
    const svg=await res.text();
    url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
    const img=new Image();
    await new Promise(function(ok,bad){
      img.onload=ok;
      img.onerror=function(){ bad(new Error('the creative would not render')); };
      img.src=url;
    });
    // 1122x1402 is the artwork's own size, so this is a straight one-to-one raster, no resampling.
    const c=document.createElement('canvas'); c.width=1122; c.height=1402;
    const g=c.getContext('2d');
    g.drawImage(img,0,0,c.width,c.height);
    const blob=await new Promise(function(r){ c.toBlob(r,'image/png'); });
    if(!blob) throw new Error('the browser would not produce a PNG');
    const name=String(rec.job_title||'Hiring').replace(/[^A-Za-z0-9 ()-]/g,'').trim().replace(/\s+/g,'_');
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=(name||'Hiring')+' - We Are Hiring.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(a.href); },4000);
    toast('PNG downloaded','ok');
  }catch(e){
    toast('Could not make the PNG: '+((e&&e.message)||e),'err');
  }finally{
    if(url) URL.revokeObjectURL(url);
    if(btn){ btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-image"></i> Creative'; }
  }
};

/* ── Referrals ──
   Anyone signed in may refer somebody for an open position. A referral submitted by HR, the
   Administrator or Management is approved on the way in (hr.submission_self_approves); everyone
   else's waits for HR.
   A referral is recorded HERE AND NOWHERE ELSE - it does not create a candidate and does not appear
   in the Interview Tracker or in any Monthly Update column. Somebody has to pick it up deliberately. */
let REF_RECORDS=null, REF_POSITIONS=null;

async function recReferrals(){
  const b=$('recBody');
  if(!REF_RECORDS){
    b.innerHTML='<div class="empty" style="padding:40px"><i class="fa-solid fa-spinner fa-spin"></i></div>';
    try{
      const q=await sb.schema('hr').from('referrals').select('*').order('created_at',{ascending:false});
      if(q.error) throw q.error;
      REF_RECORDS=q.data||[];
    }catch(e){
      b.innerHTML='<div class="empty" style="padding:40px;color:var(--err)">'+esc(e.message||String(e))+'</div>';
      return;
    }
  }
  const rows=REF_RECORDS;
  const mine=rows.filter(function(r){return (r.referred_by||'').toLowerCase()===(state.email||'').toLowerCase();}).length;
  const waiting=rows.filter(function(r){return (r.approval_status||'Pending')==='Pending';}).length;
  const canDecide=hrCan();

  const stTag=function(r){
    const s=r.approval_status||'Pending';
    if(s==='Approved') return '<span class="tag t-green" title="'+esc('Approved by '+(r.approved_by||'—'))+'">Approved</span>';
    if(s==='Rejected') return '<span class="tag t-red" title="'+esc(r.rejection_reason||'')+'">Rejected</span>';
    return '<span class="tag t-amber">Waiting for HR</span>';
  };

  b.innerHTML='<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">'
      +'<div class="sec-title" style="margin:0">Referrals <span class="tag t-gray" style="margin-left:4px">'+rows.length+'</span>'
        +(waiting?' <span class="tag t-amber" style="margin-left:4px">'+waiting+' waiting</span>':'')+'</div>'
      +'<div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">'
        +'<button class="btn btn-primary" onclick="refForm()"><i class="fa-solid fa-user-plus"></i> Refer someone</button>'
      +'</div>'
    +'</div>'
    +'<div class="ref-note"><i class="fa-solid fa-circle-info"></i> '
      +'A referral is kept here only. It does not create a candidate and is not counted in the Interview Tracker '
      +'or the Monthly Update until someone takes it forward.'
      +(mine?' You have referred '+mine+' '+(mine===1?'person':'people')+'.':'')
    +'</div>'
    +(rows.length
      ? '<div class="card" style="overflow:hidden"><div style="overflow-x:auto"><table class="tbl">'
        +'<thead><tr><th>Name</th><th>Position</th><th>Phone</th><th>Email</th>'
          +'<th>Referred by</th><th>When</th><th>Status</th>'+(canDecide?'<th></th>':'')+'</tr></thead><tbody>'
        +rows.map(function(r){
          const pend=(r.approval_status||'Pending')==='Pending';
          return '<tr>'
            +'<td style="font-weight:600">'+esc(r.referred_name||'—')+'</td>'
            +'<td>'+esc(r.position||'—')+'</td>'
            +'<td style="white-space:nowrap">'+esc(r.referred_phone||'—')+'</td>'
            +'<td style="font-size:12px">'+esc(r.referred_email||'—')+'</td>'
            +'<td style="font-size:12px;color:var(--slate)">'+esc(r.referred_by||'—')+'</td>'
            +'<td style="white-space:nowrap;font-size:12px;color:var(--slate)">'+esc(refWhen(r.created_at))+'</td>'
            +'<td>'+stTag(r)+'</td>'
            +(canDecide
              ? '<td style="white-space:nowrap">'
                +(pend
                  ? '<button class="btn btn-sm btn-ok" onclick="refDecide('+r.id+',true)"><i class="fa-solid fa-check"></i> Approve</button> '
                    +'<button class="btn btn-sm btn-danger" onclick="refDecide('+r.id+',false)"><i class="fa-solid fa-xmark"></i> Reject</button>'
                  : '<button class="btn btn-sm btn-danger" onclick="refDelete('+r.id+')" title="Delete this referral"><i class="fa-solid fa-trash"></i></button>')
                +'</td>'
              : '')
            +'</tr>';
        }).join('')
        +'</tbody></table></div></div>'
      : '<div class="card card-pad empty"><i class="fa-solid fa-user-plus"></i>'
        +'<div style="font-weight:600;color:var(--ink)">No referrals yet</div>'
        +'<p style="max-width:400px;margin:6px auto 0">Know somebody good for an open role? Click <b>Refer someone</b>.</p></div>');
}

function refWhen(ts){
  if(!ts) return '—';
  try{ return new Date(ts).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
  catch(e){ return String(ts); }
}

window.refForm=async function(){
  if(!REF_POSITIONS){
    try{
      const {data}=await sb.schema('hr').rpc('open_positions');
      REF_POSITIONS=data||[];
    }catch(e){ REF_POSITIONS=[]; }
  }
  const opts=REF_POSITIONS.map(function(p){
    return '<option value="'+p.manpower_id+'">'+esc(p.job_title+(p.department?' — '+p.department:''))+'</option>';
  }).join('');
  const selfAppr=hrCan();
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-user-plus"></i> Refer someone</h3>'
      +'<span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm">'
      +'<div><label>Their name *</label><input id="refFName" class="inp" placeholder="Full name"></div>'
      +'<div class="two">'
        +'<div><label>Phone</label><input id="refFPhone" class="inp" placeholder="10-digit mobile"></div>'
        +'<div><label>Email</label><input id="refFEmail" class="inp" type="email" placeholder="name@example.com"></div>'
      +'</div>'
      +'<div><label>Position *</label><select id="refFPos" class="sel">'
        +(opts?'<option value="">— Choose an open position —</option>'+opts
              :'<option value="">No open positions right now</option>')
        +'</select></div>'
      +'<div><label>Anything we should know</label>'
        +'<textarea id="refFNotes" class="inp" rows="3" placeholder="How you know them, what they do now, why they would suit it"></textarea></div>'
      +'<div style="font-size:12.5px;color:var(--slate);margin-top:4px">'
        +(selfAppr
          ? 'You are in HR or Management, so this is approved as soon as you submit it.'
          : 'HR will see this and approve or reject it.')
      +'</div>'
    +'</div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>'
      +'<button class="btn btn-primary" id="refSaveBtn" onclick="refSave()"><i class="fa-solid fa-check"></i> Submit</button></div>');
  setTimeout(function(){ const el=$('refFName'); if(el) el.focus(); },50);
};

window.refSave=async function(){
  const name=(($('refFName')||{}).value||'').trim();
  const posId=(($('refFPos')||{}).value||'').trim();
  const phone=(($('refFPhone')||{}).value||'').trim();
  const email=(($('refFEmail')||{}).value||'').trim();
  if(!name){ toast('Enter their name','err'); return; }
  if(!posId){ toast('Choose the position','err'); return; }
  if(!phone&&!email){ toast('Give a phone number or an email — otherwise nobody can reach them','err'); return; }
  const pos=(REF_POSITIONS||[]).find(function(p){return String(p.manpower_id)===posId;});
  const btn=$('refSaveBtn');
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>'; }
  const {error}=await sb.schema('hr').from('referrals').insert({
    referred_name:name, referred_phone:phone||null, referred_email:email||null,
    position:(pos&&pos.job_title)||null, manpower_request_id:parseInt(posId,10),
    referred_by:state.email, notes:(($('refFNotes')||{}).value||'').trim()||null
  });
  if(error){
    toast(error.message,'err');
    if(btn){ btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-check"></i> Submit'; }
    return;
  }
  closeModal();
  toast(hrCan()?'Referral added and approved':'Referral sent to HR','ok');
  REF_RECORDS=null; recReferrals();
};

window.refDecide=async function(id,ok){
  if(!hrCan()){ toast('Only HR can approve a referral','err'); return; }
  const r=(REF_RECORDS||[]).find(function(x){return x.id===id;})||{};
  const who=r.referred_name||'this referral';
  if(!await confirmDialog((ok?'Approve the referral for ':'Reject the referral for ')+'“'+who+'”?',
      ok ? {title:'Approve referral', okLabel:'Approve', icon:'fa-circle-check', danger:false}
         : {title:'Reject referral',  okLabel:'Reject',  icon:'fa-circle-xmark', danger:true})) return;
  const {error}=await sb.schema('hr').from('referrals').update({
    approval_status: ok?'Approved':'Rejected',
    approved_by: state.email,
    approved_at: new Date().toISOString()
  }).eq('id',id);
  if(error){ toast(error.message,'err'); return; }
  toast(ok?'Approved':'Rejected','ok');
  REF_RECORDS=null; recReferrals();
};

window.refDelete=async function(id){
  if(!hrCan()){ toast('Only HR can delete a referral','err'); return; }
  const r=(REF_RECORDS||[]).find(function(x){return x.id===id;})||{};
  if(!await confirmDialog(
      'Delete the referral for “'+(r.referred_name||'this person')+'”? The candidate it '
      +'created is deleted as well, along with their CV. This cannot be undone.',
      {title:'Delete referral', okLabel:'Delete', icon:'fa-trash', danger:true})) return;
  /* Through the same function the other screen uses. This one used to delete the row straight
     out of the table, which left the candidate behind and skipped the rule entirely. */
  const {data,error}=await sb.schema('hr').rpc('referral_withdraw',{p_id:id});
  if(error){ toast(error.message,'err'); return; }
  await hrRemoveFiles(data);
  toast('Referral deleted \u2014 the candidate was removed too','ok');
  REF_RECORDS=null; recReferrals();
};

window.refReload=function(){ REF_RECORDS=null; REF_POSITIONS=null; if(PAGE==='recruitment')renderPage(); };

async function recLoadJDs(v){
  REC_SEL=new Set();
  let uploaded=[];
  // Newest first. Ordered the other way, a description written a minute ago arrived at the BOTTOM
  // of a grid of a dozen, which reads exactly like it was never created.
  try{const {data,error}=await sb.schema('recruit').from('job_descriptions').select('*').order('created_at',{ascending:false});if(!error)uploaded=data||[];}catch(e){}

  /* A DESCRIPTION IS HERE BECAUSE SOMEBODY ADDED IT, NOT BECAUSE IT WAS APPROVED.

     This used to hide an AI-written description until it had been APPROVED - its own approval, or
     its hiring request's as a fallback. That gate was never opened: every one of the eight
     AI-written descriptions sat at Pending, so none of them was ever visible here, while the eight
     hand-uploaded ones showed because they had never been part of the workflow at all. A gate
     nothing has passed through is not a safeguard.

     Approval is gone. In its place is a plain Add, on the hiring request that produced the
     description and in the email announcing it. Until somebody presses it the description still
     exists and can be read and corrected from the request - it is simply not in the library.

     in_library is a stored column rather than a rule recomputed here, so the Descriptions tab, the
     email's Add button and anything else all read the same answer. The backfill set it for exactly
     what this filter used to show, so nothing that was visible yesterday vanished today. */
  uploaded=uploaded.filter(jd=>jd.in_library===true);
  const uploadedCards=uploaded.map(jd=>({...jd,isDefault:false}));
  const allJDs=[...DEFAULT_JDS,...uploadedCards];
  window._recAllJDs=allJDs;
  const n=REC_SEL.size;
  const dis='opacity:.38;cursor:not-allowed;pointer-events:none';
  $('recBody').innerHTML=`
    <!-- THREE BUTTONS DID TWO JOBS, AND ONE OF THEM DID NOTHING NEW.
         Download sat here AND on every card, so downloading one description meant ticking it,
         coming back up here, and clicking - three actions to do what the card already did in one.
         The toolbar's Download is gone. Delete stays, because deleting several at once is the only
         thing the tick-boxes are genuinely for, and it now only appears once something is ticked
         rather than sitting greyed out asking to be understood. -->
    <div id="recBar" style="display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="recUploadModal()"><i class="fa-solid fa-upload"></i> Upload</button>
      ${n>0?`<button class="btn" style="color:var(--err)" onclick="recDeleteSel()"><i class="fa-solid fa-trash"></i> Delete ${n}</button>
      <button class="btn btn-ghost" onclick="recClearSel()">Clear</button>`:''}
    </div>
    <div class="grid lib-grid" id="recGrid">
      ${allJDs.map(jd=>recJDCard(jd)).join('')}
    </div>`;
}
/* A JOB DESCRIPTION OPENS IN ITS OWN TAB, AS SOMETHING YOU CAN CHANGE.

   It used to open as a finished PDF, which is the right thing to send to a candidate and the wrong
   thing to be handed when the text is AI-written and nearly always needs a line fixing. Reading it
   and correcting it were two different journeys: open the PDF, notice the mistake, go back, find
   Regenerate, hope the next draft was better.

   So Open gives you the text, in a full tab, editable, with Save and Download on it. Save writes
   back to the same record the PDF is built from, so the next PDF carries the correction.

   THE TAB IS OPENED ON THE CLICK, BEFORE ANY await. A window.open that happens after an await has
   lost the click that caused it and browsers block it as a pop-up - the same trap that made Preview
   look broken. The editor is written into the blank tab immediately and filled in afterwards.

   The child page is same-origin (about:blank inherits this origin), so it can call back into this
   page directly rather than needing its own database connection. */
/* ONE EDITOR, TWO WAYS IN.

   The same tab is opened from the Descriptions tab and from a hiring request's own panel, so the
   two cannot drift into behaving differently. What changes between them is only WHERE Save writes:
   a library description saves to recruit.job_descriptions, a request's description saves to the
   request itself. The caller passes that in.

   THE TAB IS OPENED ON THE CLICK, BEFORE ANY await. A window.open after an await has lost the
   click that caused it and browsers block it as a pop-up - the trap that made Preview look broken.

   The child page is same-origin (about:blank inherits this origin), so it calls back into this
   page directly rather than needing its own database connection. */
window.jdOpenEditorTab=function(title,text,onSave){
  const tab=window.open('','_blank');
  if(!tab){ toast('Your browser blocked the new tab','err'); return; }
  const escH=t=>String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  /* THE SAME GEOMETRY THE PDF IS BUILT WITH, IN PIXELS.

     jdBuildPdfBytes lays out A4 at 595.28 x 841.89 points with a 56pt margin, 10.5pt text on a
     15pt line, and a 15pt bold title. At 96dpi a point is 4/3 of a pixel, so those numbers are
     converted once here and used for both the sheets on screen and the measuring column that
     decides where each page ends.

     The header height is DERIVED, not eyeballed: the PDF draws the logo 150pt wide, the file is
     600x189, so it lands 47.25pt tall, then 10pt of gap, the rule, and a 24pt drop before text. */
  const PT=4/3;
  const PW=Math.round(595.28*PT), PH=Math.round(841.89*PT);   // 794 x 1123
  const MG=Math.round(56*PT);                                  // 75
  const FS=(10.5*PT).toFixed(2), LH=(15*PT).toFixed(2);        // 14 / 20
  const TITLE_FS=(15*PT).toFixed(2), TITLE_LH=(21*PT).toFixed(2);
  const LOGO_W=150, LOGO_H=LOGO_W*189/600;
  const HEAD_H=Math.round((LOGO_H+10+24)*PT);
  const FOOT_H=Math.round(24*PT);


  tab.document.write('<!doctype html><meta charset="utf-8"><title>'+escH(title)+'</title>'
  +'<style>'
  +'*{box-sizing:border-box}'
  +'body{margin:0;font:14px/1.5 Segoe UI,Arial,sans-serif;background:#535659;color:#0f172a;overflow:hidden}'
  +'header{position:fixed;inset:0 0 auto 0;z-index:5;background:#323639;color:#e8eaed}'
  +'.bar{display:flex;align-items:center;gap:10px;padding:0 14px;height:52px}'
  +'.bar2{display:flex;align-items:center;gap:6px;padding:0 14px 8px;flex-wrap:wrap}'
  +'header h1{font-size:14px;margin:0;font-weight:600;flex:1;min-width:90px;overflow:hidden;'
   +'text-overflow:ellipsis;white-space:nowrap}'
  +'.grp{display:flex;align-items:center;gap:2px;background:#3c4043;border-radius:8px;padding:3px}'
  +'.ic{min-width:32px;height:30px;border:0;border-radius:6px;background:transparent;color:#e8eaed;'
   +'font-size:15px;cursor:pointer;line-height:1;padding:0 7px}'
  +'.ic:hover{background:#4a4e51}.ic:disabled{opacity:.35;cursor:not-allowed}'
  +'.ic.on{background:#5f6368}'
  +'#zlabel{min-width:52px;text-align:center;font-size:12.5px;color:#e8eaed;cursor:pointer;'
   +'user-select:none;padding:0 4px}'
  +'#pglabel{font-size:12.5px;color:#bdc1c6;min-width:64px;text-align:center}'
  +'select.tb,input.tb{height:30px;border-radius:6px;border:1px solid #5f6368;background:#3c4043;'
   +'color:#e8eaed;font:13px Segoe UI,Arial,sans-serif;padding:0 6px}'
  +'input.tb[type=color]{width:34px;padding:2px;cursor:pointer}'
  +'button.txt{font:600 13px Segoe UI,Arial,sans-serif;padding:8px 14px;border-radius:7px;'
   +'border:1px solid #5f6368;background:#3c4043;color:#e8eaed;cursor:pointer}'
  +'button.txt:hover{background:#4a4e51}'
  +'button.primary{background:#e0121c;border-color:#e0121c;color:#fff}'
  +'button.txt:disabled{opacity:.5;cursor:not-allowed}'
  +'#msg{font-size:12.5px;color:#bdc1c6;min-width:10px}'
  +'#view{position:fixed;inset:96px 0 0 0;overflow:auto;padding:24px 0 40px}'
  +'#doc{transform-origin:top center;margin:0 auto;width:'+PW+'px}'
  +'.sheet{width:'+PW+'px;height:'+PH+'px;background:#fff;margin:0 auto 20px;position:relative;'
   +'box-shadow:0 1px 3px rgba(0,0,0,.4),0 6px 18px rgba(0,0,0,.25)}'
  +'.sheet .hd{position:absolute;left:'+MG+'px;right:'+MG+'px;top:'+MG+'px;'
   +'user-select:none;-webkit-user-select:none;pointer-events:none}'
  +'.sheet .logo{display:block;width:'+Math.round(LOGO_W*PT)+'px;height:auto}'
  +'.sheet .brand{font:700 15px Arial,Helvetica,sans-serif;letter-spacing:1.4px;color:#0f172a;'
   +'height:'+Math.round(LOGO_H*PT)+'px;display:flex;align-items:flex-end}'
  +'.sheet .rule{height:1.6px;background:#e0121c;margin-top:8px}'
  /* The title is page furniture, not text: outside the editable box, so it cannot be selected
     into, deleted, or dragged out of place. */
  +'.sheet .ttl{position:absolute;left:'+MG+'px;right:'+MG+'px;top:'+(MG+HEAD_H)+'px;'
   +'font:700 '+TITLE_FS+'px/'+TITLE_LH+'px Arial,Helvetica,sans-serif;'
   +'user-select:none;-webkit-user-select:none;pointer-events:none}'
  +'.sheet .bd{position:absolute;left:'+MG+'px;right:'+MG+'px;top:'+(MG+HEAD_H)+'px;'
   +'bottom:'+(MG+FOOT_H)+'px;font:'+FS+'px/'+LH+'px Arial,Helvetica,sans-serif;outline:0;'
   +'white-space:pre-wrap;word-wrap:break-word}'
  +'.sheet .pn{position:absolute;left:0;right:0;bottom:'+Math.round(MG/2)+'px;text-align:center;'
   +'font-size:11px;color:#94a3b8}'
  +'.ln{min-height:'+LH+'px}'
  +'#meas{position:absolute;visibility:hidden;left:-9999px;top:0;width:'+(PW-2*MG)+'px;'
   +'font:'+FS+'px/'+LH+'px Arial,Helvetica,sans-serif;white-space:pre-wrap;word-wrap:break-word}'
  +'#meas .ln{min-height:'+LH+'px}'
  +'</style>'
  +'<header>'
   +'<div class="bar">'
     +'<h1>'+escH(title)+'</h1>'
     +'<span id="pglabel">1 / 1</span>'
     +'<div class="grp">'
       +'<button class="ic" id="zo" title="Zoom out">&#8722;</button>'
       +'<span id="zlabel" title="Click to fit the width">100%</span>'
       +'<button class="ic" id="zi" title="Zoom in">&#43;</button>'
       +'<button class="ic" id="zf" title="Fit width">&#8596;</button>'
     +'</div>'
     +'<span id="msg"></span>'
     +'<button class="txt primary" id="save">Save</button>'
     +'<button class="txt" id="dl">Download PDF</button>'
   +'</div>'
   +'<div class="bar2">'
     +'<div class="grp">'
       +'<button class="ic" id="undo" title="Undo (Ctrl+Z)">&#8630;</button>'
       +'<button class="ic" id="redo" title="Redo (Ctrl+Y)">&#8631;</button>'
     +'</div>'
     +'<div class="grp">'
       +'<button class="ic" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>'
       +'<button class="ic" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>'
       +'<button class="ic" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>'
     +'</div>'
     /* Size, typeface and colour removed by request. Bold, italic and underline are the ones a
        job description actually uses, and they are the ones that read the same in every document;
        three people each picking their own font and colour is how a set of company documents
        stops looking like a set. The PDF still renders all of it, so anything already saved with
        a size or a colour keeps it. */
     +'<button class="ic" id="clr" title="Remove formatting" style="min-width:auto;padding:0 10px;font-size:13px">Clear</button>'
   +'</div>'
  +'</header>'
  +'<div id="view"><div id="doc"></div></div>'
  +'<div id="meas"></div>');
  tab.document.close();

  try{
    const d=tab.document, w=tab;
    const view=d.getElementById('view'), doc=d.getElementById('doc'),
          meas=d.getElementById('meas'), msg=d.getElementById('msg'),
          zlabel=d.getElementById('zlabel'), pglabel=d.getElementById('pglabel');


    /* THE SAME IMAGE THE PDF EMBEDS, not a typed approximation of it. Drawn outside the editable
       area and made unselectable, so it is on every page and cannot be edited out. */
    const LOGO_HTML=(typeof JG_LOGO_PNG_B64==='string'&&JG_LOGO_PNG_B64)
      ? '<img class="logo" alt="The Jain Group" src="data:image/png;base64,'+JG_LOGO_PNG_B64+'">'
      : '<div class="brand">THE JAIN GROUP</div>';

    /* A PARAGRAPH IS A STRING OF HTML, not a string of text.

       The document used to be plain lines, so there was nowhere to keep bold or a colour. Each
       paragraph is now its own fragment of HTML and that is what gets saved, measured and handed
       to the PDF builder.

       Plain text still loads: everything written before today is plain, and so is everything the
       AI writes. It is escaped line by line, and the old rule that a short line ending in a colon
       is a heading is applied ONCE on the way in - turning it into real bold that can then be
       edited, rather than a guess the PDF re-makes every time. */
    function parseInput(src){
      const raw=String(src||'');
      if(!/<[a-z!/]/i.test(raw)){
        return raw.split('\n').map(function(l){
          const head=/:$/.test(l.trim())&&l.trim().length<40;
          const e=escH(l);
          return l===''?'<br>':(head?'<b>'+e+'</b>':e);
        });
      }
      const dom=new DOMParser().parseFromString('<body>'+raw+'</body>','text/html');
      const kids=Array.prototype.filter.call(dom.body.children,function(n){
        return /^(DIV|P|LI|H[1-6])$/.test(n.tagName); });
      if(!kids.length) return [dom.body.innerHTML||'<br>'];
      return kids.map(function(n){ return n.innerHTML||'<br>'; });
    }

    let BLOCKS=parseInput(text);
    let PAGES=[];          // {start,end} indexes into BLOCKS
    let TITLE_H=0;
    let zoom=1, fitMode=false;

    /* WHERE THE PAGES BREAK, measured rather than guessed. Every paragraph is laid out once in a
       hidden column of exactly the page's text width, so one that wraps to three rows - or that
       carries a 24pt word - is counted at its real height. */
    function paginate(){
      meas.innerHTML=BLOCKS.map(function(h){return '<div class="ln">'+h+'</div>';}).join('');
      const els=meas.children;
      const th=d.createElement('div');
      th.style.cssText='font:700 '+TITLE_FS+'px/'+TITLE_LH+'px Arial,Helvetica,sans-serif';
      th.textContent=title||'Job Description';
      meas.appendChild(th);
      const titleH=th.getBoundingClientRect().height+8;
      TITLE_H=titleH;

      const hs=[];
      for(let i=0;i<BLOCKS.length;i++) hs.push(els[i]?els[i].getBoundingClientRect().height:parseFloat(LH));
      /* ONLY PAGE ONE CARRIES THE LETTERHEAD, so only page one pays for it. A later page starts
         at the top margin and has the logo's worth of extra room, which is why the two limits
         below are different rather than one number reused. */
      const FIRST_LIMIT=PH-2*MG-HEAD_H-titleH-FOOT_H;
      const REST_LIMIT =PH-2*MG-FOOT_H;
      /* A few pixels held back. The measuring column and the page's own text box agree to within
         about 3px - line boxes are not laid out identically in a bare div and in a contenteditable
         one - and the error always went the same way. Breaking a hair early is the safe direction. */
      const SAFE=6;
      PAGES=[]; let start=0, used=0, limit=FIRST_LIMIT-SAFE;
      for(let i=0;i<BLOCKS.length;i++){
        if(used+hs[i]>limit && i>start){
          PAGES.push({start:start,end:i});
          start=i; used=0; limit=REST_LIMIT-SAFE;
        }
        used+=hs[i];
      }
      PAGES.push({start:start,end:BLOCKS.length});
      meas.innerHTML='';
    }

    function render(){
      paginate();
      let html='';
      for(let p=0;p<PAGES.length;p++){
        const seg=BLOCKS.slice(PAGES[p].start,PAGES[p].end);
        const bodyTop=(p===0?MG+HEAD_H+Math.round(TITLE_H):MG);
        html+='<div class="sheet" data-p="'+p+'">'
          +(p===0?'<div class="hd">'+LOGO_HTML+'<div class="rule"></div></div>'
                 +'<div class="ttl">'+escH(title||'Job Description')+'</div>':'')
          +'<div class="bd" contenteditable="true" spellcheck="true" data-p="'+p+'"'
            +' style="top:'+bodyTop+'px">'
          +seg.map(function(h){ return '<div class="ln">'+(h||'<br>')+'</div>'; }).join('')
          +'</div>'
          +'<div class="pn">'+(p+1)+' / '+PAGES.length+'</div>'
          +'</div>';
      }
      doc.innerHTML=html;
      Array.prototype.forEach.call(d.querySelectorAll('.bd'),function(b){
        b.addEventListener('input',onInput);
        b.addEventListener('keydown',onKey);
        b.addEventListener('paste',onPaste);
        b.addEventListener('keyup',syncButtons);
        b.addEventListener('mouseup',syncButtons);
      });
      applyZoom();
      updatePageLabel();
    }

    // The paragraphs a page currently holds, read back off the screen.
    function blocksOf(bd){
      const out=[];
      Array.prototype.forEach.call(bd.children,function(c){ out.push(c.innerHTML); });
      return out;
    }
    function collect(){
      const all=[];
      Array.prototype.forEach.call(d.querySelectorAll('.bd'),function(b){
        Array.prototype.push.apply(all,blocksOf(b));
      });
      // What gets saved: one div per paragraph, which is what parseInput reads back.
      return all.map(function(h){ return '<div>'+h+'</div>'; }).join('');
    }

    /* THE CARET SURVIVES RE-PAGINATION. A paragraph never changes its position in the sequence
       when pages are recut - only which page it sits on - so the caret is remembered as
       "paragraph N, character C" and put back by the same pair. */
    function caretPos(){
      const sel=w.getSelection();
      if(!sel||!sel.rangeCount) return null;
      let node=sel.anchorNode; if(!node) return null;
      let el=node.nodeType===3?node.parentNode:node;
      let ln=el; while(ln&&!(ln.classList&&ln.classList.contains('ln'))) ln=ln.parentNode;
      if(!ln) return null;
      const bd=ln.closest('.bd'); if(!bd) return null;
      const p=parseInt(bd.getAttribute('data-p'),10)||0;
      const idx=Array.prototype.indexOf.call(bd.children,ln);
      if(idx<0) return null;
      const r=d.createRange(); r.selectNodeContents(ln);
      try{ r.setEnd(sel.anchorNode,sel.anchorOffset); }catch(_e){ return null; }
      return {block:PAGES[p].start+idx, ch:r.toString().length};
    }
    function setCaret(pos){
      if(!pos) return;
      for(let p=0;p<PAGES.length;p++){
        if(pos.block>=PAGES[p].start && pos.block<PAGES[p].end){
          const bd=d.querySelector('.bd[data-p="'+p+'"]'); if(!bd) return;
          const ln=bd.children[pos.block-PAGES[p].start]; if(!ln) return;
          const walker=d.createTreeWalker(ln,w.NodeFilter.SHOW_TEXT,null);
          let left=pos.ch, node=null;
          while(walker.nextNode()){
            node=walker.currentNode;
            if(left<=node.length) break;
            left-=node.length;
          }
          const r=d.createRange();
          if(node) r.setStart(node,Math.max(0,Math.min(left,node.length)));
          else { r.selectNodeContents(ln); }
          r.collapse(true);
          const sel=w.getSelection(); sel.removeAllRanges(); sel.addRange(r);
          bd.focus();
          return;
        }
      }
    }

    /* ── UNDO AND REDO ────────────────────────────────────────────────────────────────────
       The browser's own undo stack is useless here: re-cutting the pages replaces the whole
       document, and every replacement throws that stack away - which is why Ctrl+Z did nothing.
       So the editor keeps its own. A state is the list of paragraphs plus where the caret was,
       and one is recorded whenever a change settles, not on every keystroke, so a single undo
       takes back a word rather than a letter. */
    let HIST=[{blocks:BLOCKS.slice(),caret:null}], HPOS=0;
    const HMAX=200;
    function commit(){
      const st={blocks:BLOCKS.slice(),caret:caretPos()};
      // Nothing actually changed - do not fill the history with duplicates.
      if(HIST[HPOS] && HIST[HPOS].blocks.join('\u0001')===st.blocks.join('\u0001')) return;
      HIST=HIST.slice(0,HPOS+1);
      HIST.push(st);
      if(HIST.length>HMAX){ HIST.shift(); } else { HPOS++; }
      syncHistButtons();
    }
    function applyState(st){
      BLOCKS=st.blocks.slice();
      render();
      setCaret(st.caret);
      syncHistButtons();
    }
    function undo(){ if(HPOS>0){ HPOS--; applyState(HIST[HPOS]); } }
    function redo(){ if(HPOS<HIST.length-1){ HPOS++; applyState(HIST[HPOS]); } }
    function syncHistButtons(){
      d.getElementById('undo').disabled=HPOS<=0;
      d.getElementById('redo').disabled=HPOS>=HIST.length-1;
    }
    d.getElementById('undo').onclick=undo;
    d.getElementById('redo').onclick=redo;

    /* Re-cut on a pause, not on every keystroke: recutting mid-word would move the text under
       the cursor while somebody is still typing the word. */
    let t=null;
    function onInput(){
      clearTimeout(t);
      t=setTimeout(function(){
        const pos=caretPos();
        BLOCKS=(function(){ const a=[]; Array.prototype.forEach.call(d.querySelectorAll('.bd'),
          function(b){ Array.prototype.push.apply(a,blocksOf(b)); }); return a; })();
        render();
        setCaret(pos);
        commit();
      },400);
    }
    function onKey(e){
      const mod=e.ctrlKey||e.metaKey;
      if(mod&&e.key==='s'){ e.preventDefault(); d.getElementById('save').click(); return; }
      if(mod&&!e.shiftKey&&String(e.key).toLowerCase()==='z'){ e.preventDefault(); clearTimeout(t); undo(); return; }
      if(mod&&(String(e.key).toLowerCase()==='y'||(e.shiftKey&&String(e.key).toLowerCase()==='z'))){
        e.preventDefault(); clearTimeout(t); redo(); return; }
      // Ctrl+B/I/U are left to the browser, which applies them to the selection; the change is
      // picked up by the input handler like any other edit.
    }
    /* Pasting from Word brings its own fonts, colours, tables and class names with it. Only the
       words are taken, and anything you want emphasised you set here. */
    function onPaste(e){
      e.preventDefault();
      const txt=(e.clipboardData||w.clipboardData).getData('text/plain');
      d.execCommand('insertText',false,String(txt||''));
    }

    /* ── FORMATTING ───────────────────────────────────────────────────────────────────────
       styleWithCSS makes the browser write inline styles rather than <font> tags, which is what
       the PDF builder reads. Bold, italic and underline go through execCommand, which handles a
       selection spanning several paragraphs properly. */
    try{ d.execCommand('styleWithCSS',false,true); }catch(_e){}

    function afterFormat(){
      const pos=caretPos();
      BLOCKS=(function(){ const a=[]; Array.prototype.forEach.call(d.querySelectorAll('.bd'),
        function(b){ Array.prototype.push.apply(a,blocksOf(b)); }); return a; })();
      render(); setCaret(pos); commit();
    }
    Array.prototype.forEach.call(d.querySelectorAll('[data-cmd]'),function(btn){
      // mousedown is cancelled so the button never steals the selection it is about to act on.
      btn.addEventListener('mousedown',function(e){ e.preventDefault(); });
      btn.addEventListener('click',function(){
        d.execCommand(btn.getAttribute('data-cmd'),false,null);
        syncButtons(); afterFormat();
      });
    });
    d.getElementById('clr').addEventListener('mousedown',function(e){ e.preventDefault(); });
    d.getElementById('clr').onclick=function(){
      d.execCommand('removeFormat',false,null);
      syncButtons(); afterFormat();
    };
    // The B / I / U buttons light up when the caret is inside text that already has them.
    function syncButtons(){
      ['bold','italic','underline'].forEach(function(c){
        const btn=d.querySelector('[data-cmd="'+c+'"]'); if(!btn) return;
        let on=false; try{ on=d.queryCommandState(c); }catch(_e){}
        btn.classList.toggle('on',!!on);
      });
    }

    // ── zoom ────────────────────────────────────────────────────────────────────────────
    const STEPS=[0.5,0.67,0.75,0.9,1,1.1,1.25,1.5,1.75,2,2.5,3];
    function applyZoom(){
      doc.style.transform='scale('+zoom+')';
      const natural=PAGES.length*(PH+20);
      doc.style.marginBottom=((zoom-1)*natural)+'px';
      const wide=PW*zoom;
      doc.style.marginLeft=wide>view.clientWidth?((wide-PW)/2)+'px':'auto';
      doc.style.marginRight=doc.style.marginLeft==='auto'?'auto':'0';
      zlabel.textContent=Math.round(zoom*100)+'%';
    }
    function setZoom(z,keepFit){
      zoom=Math.max(0.25,Math.min(4,z));
      if(!keepFit) fitMode=false;
      applyZoom();
    }
    function fitWidth(){ fitMode=true; setZoom((view.clientWidth-48)/PW,true); }
    d.getElementById('zi').onclick=function(){
      const nx=STEPS.find(s=>s>zoom+0.001); setZoom(nx||Math.min(4,zoom*1.1));
    };
    d.getElementById('zo').onclick=function(){
      const pv=STEPS.slice().reverse().find(s=>s<zoom-0.001); setZoom(pv||Math.max(0.25,zoom/1.1));
    };
    d.getElementById('zf').onclick=fitWidth;
    zlabel.onclick=fitWidth;
    view.addEventListener('wheel',function(e){
      if(!(e.ctrlKey||e.metaKey)) return;
      e.preventDefault();
      setZoom(zoom*(e.deltaY<0?1.1:1/1.1));
    },{passive:false});
    d.addEventListener('keydown',function(e){
      if(!(e.ctrlKey||e.metaKey)) return;
      if(e.key==='='||e.key==='+'){ e.preventDefault(); d.getElementById('zi').click(); }
      else if(e.key==='-'){ e.preventDefault(); d.getElementById('zo').click(); }
      else if(e.key==='0'){ e.preventDefault(); setZoom(1); }
    });
    w.addEventListener('resize',function(){ if(fitMode) fitWidth(); });

    function updatePageLabel(){
      const sheets=d.querySelectorAll('.sheet');
      if(!sheets.length) return;
      const mid=view.scrollTop+view.clientHeight/2;
      let cur=1;
      for(let i=0;i<sheets.length;i++){ if(sheets[i].offsetTop*zoom<=mid) cur=i+1; }
      pglabel.textContent=cur+' / '+sheets.length;
    }
    view.addEventListener('scroll',updatePageLabel);

    // ── save / download ─────────────────────────────────────────────────────────────────
    d.getElementById('save').onclick=async function(){
      const btn=this; btn.disabled=true; msg.textContent='Saving…';
      try{
        await onSave(collect());
        /* SAVED MEANS DONE, SO THE TAB CLOSES. The short pause is so "Saved" is actually seen. */
        msg.textContent='Saved';
        setTimeout(function(){ try{ tab.close(); }catch(_e){} }, 600);
      }catch(e){
        msg.textContent='Could not save: '+((e&&e.message)||e);
        btn.disabled=false;
      }
    };
    d.getElementById('dl').onclick=async function(){
      const btn=this; btn.disabled=true; msg.textContent='Building the PDF…';
      try{ await window.opener.jdEditorDownload(title, collect()); msg.textContent=''; }
      catch(e){ msg.textContent='Could not build it: '+((e&&e.message)||e); }
      btn.disabled=false;
    };

    render();
    fitWidth();
    syncHistButtons();
  }catch(e){ /* the tab is still readable even if the controls could not be wired */ }
};
window.jdEditOpen=function(id){
  const jd=(window._recAllJDs||[]).find(j=>j.id===id);
  if(!jd){ toast('That description could not be found','err'); return; }
  if(jd.source!=='ai_generated'){
    // An uploaded PDF is a file, not text we hold - there is nothing here to edit, so it opens as
    // the file it is.
    return recJdOpen(id);
  }
  jdOpenEditorTab(String(jd.name||'Job Description'), String(jd.content_text||''),
    async function(text){ await jdEditorSave(id, text); });
};
/* Called by the editor tab. Kept on this page because this is where the database connection and
   the PDF builder already live. */
window.jdEditorSave=async function(id,text){
  /* .select() so the row that changed comes back, and an empty answer is treated as failure.
     Without it this said "saved" for months while saving nothing: the table had no UPDATE policy,
     row-level security filtered the row out, and PostgREST does not call an update that matched
     nothing an error - it returns success. An unchecked write is not a write. */
  const {data,error}=await sb.schema('recruit').from('job_descriptions')
    .update({content_text:String(text||'')}).eq('id',id).select('id');
  if(error) throw new Error(error.message);
  if(!data||!data.length) throw new Error('Nothing was saved — you may not have permission to change this description.');
  const jd=(window._recAllJDs||[]).find(j=>j.id===id);
  if(jd) jd.content_text=String(text||'');
  toast('Job description saved');
};
window.jdEditorDownload=async function(title,text){
  const bytes=await jdBuildPdfBytes(title||'Job Description',String(text||''));
  jdPdfOpen(bytes,(String(title||'job-description').replace(/[^A-Za-z0-9 ()-]/g,'').trim()||'job-description')+'.pdf',true);
};
window.recJdOpen=async function(id){
  const jd=(window._recAllJDs||[]).find(j=>j.id===id);if(!jd)return;
  if(jd.source==='ai_generated'){
    /* Opened as a PDF on the Jain Group letterhead, in its own tab - not as the raw HTML document
       and not as a wall of plain text. A job description is something that gets forwarded to a
       candidate or printed for an interview panel, so what is on screen is the same thing that
       comes out of Download, built from the same bytes. */
    if(!String(jd.content_text||'').trim()){ toast('This description has no text to print yet','err'); return; }
    try{
      const bytes=await jdBuildPdfBytes(jd.name||'Job Description',jd.content_text||'');
      jdPdfOpen(bytes,((jd.name||'job-description').replace(/[^A-Za-z0-9 ()-]/g,'').trim()||'job-description')+'.pdf',false);
    }catch(e){ toast('Could not build the PDF: '+((e&&e.message)||e),'err'); }
    return;
  }
  if(jd.isDefault){window.open(jd.url,'_blank');return;}
  if(isS3Path(jd.storage_path)){await s3OpenSigned(jd.storage_path);return;}
  if(!jd.storage_path){toast('This entry has no file attached','err');return;}
  const {data,error}=await sb.storage.from('recruitment').createSignedUrl(jd.storage_path,300);
  if(error){toast('Could not open file: '+error.message,'err');return;}
  window.open(data.signedUrl,'_blank');
};
window.recJdDownload=async function(id){
  const jd=(window._recAllJDs||[]).find(j=>j.id===id);if(!jd)return;
  if(jd.source==='ai_generated'){
    // The same PDF the Preview shows - it used to come down as .html or .txt.
    if(!String(jd.content_text||'').trim()){ toast('This description has no text to print yet','err'); return; }
    try{
      const bytes=await jdBuildPdfBytes(jd.name||'Job Description',jd.content_text||'');
      jdPdfOpen(bytes,((jd.name||'job-description').replace(/[^A-Za-z0-9 ()-]/g,'').trim()||'job-description')+'.pdf',true);
    }catch(e){ toast('Could not build the PDF: '+((e&&e.message)||e),'err'); }
    return;
  }
  if(jd.isDefault){const a=document.createElement('a');a.href=jd.url;a.download=jd.name+'.pdf';a.click();return;}
  if(isS3Path(jd.storage_path)){await s3OpenSigned(jd.storage_path,jd.name+'.pdf');return;}
  if(!jd.storage_path){toast('This entry has no file attached','err');return;}
  const {data,error}=await sb.storage.from('recruitment').createSignedUrl(jd.storage_path,300);
  if(error){toast('Could not download file: '+error.message,'err');return;}
  const a=document.createElement('a');a.href=data.signedUrl;a.download=jd.name+'.pdf';a.click();
};
function recJDCard(jd){
  const sel=REC_SEL.has(jd.id);
  return `<div class="card card-pad lib-card${sel?' selected':''}" id="rjd_${jd.id}" style="cursor:pointer;border:2px solid ${sel?'var(--brand)':'var(--line)'};position:relative" onclick="recToggleSel('${jd.id}')" ondblclick="event.stopPropagation();recJdOpen('${jd.id}')">
    ${sel?`<div style="position:absolute;top:10px;right:10px;width:20px;height:20px;background:var(--brand);border-radius:50%;display:flex;align-items:center;justify-content:center"><i class="fa-solid fa-check" style="color:#fff;font-size:10px"></i></div>`:''}
    ${jd.isDefault?`<div style="position:absolute;top:10px;left:10px"><span class="tag t-gray" style="font-size:10px">Default</span></div>`:''}
    ${jd.source==='ai_generated'?`<div style="position:absolute;top:10px;left:10px"><span class="tag" style="font-size:10px;background:#ede9fe;color:#6d28d9"><i class="fa-solid fa-wand-magic-sparkles"></i> AI</span></div>`:''}
    <div style="display:flex;align-items:center;gap:12px;${jd.isDefault||jd.source==='ai_generated'?'margin-top:18px':''}">
      <div style="width:44px;height:48px;background:${jd.source==='ai_generated'?'#f5f3ff':'#fff5f5'};border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:1px solid ${jd.source==='ai_generated'?'#ddd6fe':'#fecaca'}">
        <i class="fa-solid ${jd.source==='ai_generated'?'fa-wand-magic-sparkles':'fa-file-pdf'}" style="color:${jd.source==='ai_generated'?'#7c3aed':'#dc2626'};font-size:20px"></i>
      </div>
      <div style="min-width:0">
        <div style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(jd.name)}</div>
        ${!jd.isDefault&&jd.file_name?`<div style="font-size:11.5px;color:var(--slate);margin-top:2px">${esc(jd.file_name)}</div>`:''}
      </div>
    </div>
    <!-- Open reads it in a tab, Download saves the file. Both live on the card; what was removed
         was the DUPLICATE Download up on the toolbar, which needed a tick and a trip upwards to do
         what this button does in one click. -->
    <div style="margin-top:12px;display:flex;gap:8px">
      <button class="btn btn-sm" style="flex:1" onclick="event.stopPropagation();jdEditOpen('${jd.id}')"><i class="fa-solid fa-eye"></i> Open</button>
      <button class="btn btn-sm" style="flex:1" onclick="event.stopPropagation();recJdDownload('${jd.id}')"><i class="fa-solid fa-download"></i> Download</button>
    </div>
  </div>`;
}
window.recToggleSel=function(id){
  if(REC_SEL.has(id))REC_SEL.delete(id);else REC_SEL.add(id);
  const jd=(window._recAllJDs||[]).find(j=>j.id===id);
  if(jd){const el=document.getElementById('rjd_'+id);if(el){const tmp=document.createElement('div');tmp.innerHTML=recJDCard(jd);el.replaceWith(tmp.firstElementChild);}}
  recRefreshBar();
};
/* Untick everything at once. The toolbar only appears while something is selected, so without this
   the only way out of a selection you did not mean to make is to find and untick each card again. */
window.recClearSel=function(){
  const ids=[...REC_SEL];
  REC_SEL.clear();
  ids.forEach(function(id){
    const jd=(window._recAllJDs||[]).find(j=>j.id===id);
    if(!jd)return;
    const el=document.getElementById('rjd_'+id);
    if(el){const tmp=document.createElement('div');tmp.innerHTML=recJDCard(jd);el.replaceWith(tmp.firstElementChild);}
  });
  recRefreshBar();
};
window.recRefreshBar=function(){
  /* Must match the bar built in recLoadJDs exactly - this redraws it on every tick, so any
     difference between the two silently reinstates the old three-button version. */
  const n=REC_SEL.size;
  const bar=$('recBar');if(!bar)return;
  bar.innerHTML=`<button class="btn btn-primary" onclick="recUploadModal()"><i class="fa-solid fa-upload"></i> Upload</button>
    ${n>0?`<button class="btn" style="color:var(--err)" onclick="recDeleteSel()"><i class="fa-solid fa-trash"></i> Delete ${n}</button>
    <button class="btn btn-ghost" onclick="recClearSel()">Clear</button>`:''}`;
};
window.recUploadModal=function(){if(!recGuard())return;
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-file-pdf"></i> Upload Job Description</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>Position / Title</label><input id="recJdName" placeholder="e.g. General Manager Commercial">
    <label>PDF File</label><input type="file" id="recJdFile" accept="application/pdf">
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="recJdSaveBtn" onclick="recJdSave()"><i class="fa-solid fa-upload"></i> Upload</button></div>`);
};
window.recJdSave=async function(){
  const name=$('recJdName').value.trim();const file=$('recJdFile').files[0];
  if(!name){toast('Enter a position name','err');return;}
  if(!file){toast('Select a PDF file','err');return;}
  const btn=$('recJdSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Uploading…';}
  const key=s3KeyForJD(file.name);
  // Ensure session is fresh before upload
  const {data:{session:_sess}}=await sb.auth.getSession();
  if(!_sess){toast('Session expired — please sign in again','err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-upload"></i> Upload';}return;}
  const {data:upData,error:se}=await uploadFileToS3(key,file);
  if(se){toast('Upload failed: '+se.message,'err');console.error('JD S3 upload error',se);if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-upload"></i> Upload';}return;}
  const {error:de}=await sb.schema('recruit').from('job_descriptions').insert({name,storage_path:upData.path,file_name:file.name,file_size:file.size,uploaded_by:state.email});
  if(de){toast(de.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-upload"></i> Upload';}return;}
  closeModal();toast(name+' uploaded','ok');recLoadJDs($('view'));
  /* The three HRs are told, with the file attached. A description sitting in a library nobody has
     been pointed at is the same as not having one, and this is the moment there is something to
     point at. Sent from ai@ because nobody decided this - it happened, and they are being told. */
  const r=await hrNotify({kind:'job_description_created',title:name,
    created_by:state.email||'',storage_path:upData.path});
  if(r&&r.ok) toast('The HR team has been emailed the description','ok');
};
window.recDownloadSel=async function(){
  let jds=[];try{const {data}=await sb.schema('recruit').from('job_descriptions').select('*');jds=data||[];}catch(e){}
  for(const jd of jds.filter(j=>REC_SEL.has(j.id))){
    if(isS3Path(jd.storage_path)){
      await s3OpenSigned(jd.storage_path,jd.name+'.pdf');
    }else{
      const {data,error}=await sb.storage.from('recruitment').createSignedUrl(jd.storage_path,300);
      if(!error){const a=document.createElement('a');a.href=data.signedUrl;a.download=jd.name+'.pdf';a.click();}
    }
    await new Promise(r=>setTimeout(r,300));
  }
};
window.recDeleteSel=async function(){if(!recGuard())return;
  if(!REC_SEL.size)return;
  if(!await confirmDialog(`Delete ${REC_SEL.size} file(s)?`))return;
  let jds=[];try{const {data}=await sb.schema('recruit').from('job_descriptions').select('*');jds=data||[];}catch(e){}
  const toDelete=jds.filter(j=>REC_SEL.has(j.id));
  for(const jd of toDelete){
    if(!jd.storage_path)continue;
    if(isS3Path(jd.storage_path))await s3Delete(jd.storage_path);
    else await sb.storage.from('recruitment').remove([jd.storage_path]);
  }
  const ids=toDelete.map(j=>j.id);
  if(ids.length)await sb.schema('recruit').from('job_descriptions').delete().in('id',ids);
  REC_SEL=new Set();toast('Deleted','ok');recLoadJDs($('view'));
};

VIEWS.finance=function(v){
  setCrumb(['Governance','Finance Vault']);
  const kpis=[['Collections (FY)','₹121 Cr',''],['Outstanding dues','₹4.1 Cr',''],['Payables open','₹2.6 Cr','37 POs'],['Net group cash','₹13.5 Cr','']];
  const roll=(title,rows)=>'<div class="card card-pad"><div class="sec-title" style="margin:0 0 12px">'+title+'</div>'+rows.map(r=>'<div style="display:flex;justify-content:space-between;padding:11px 0;border-bottom:1px solid var(--line-2)"><span>'+esc(r[0])+'</span><b>'+esc(r[1])+'</b></div>').join('')+'</div>';
  v.innerHTML=mHead('fa-indian-rupee-sign','#15803d','Finance Vault')+
    '<div class="card card-pad" style="background:#fffbeb;border-color:#f0dfa8;margin-bottom:16px;font-size:13.5px"><i class="fa-solid fa-lock" style="color:#d98a00"></i> <b>Super-admin only.</b> Every table here is gated by RLS to the director role; the publishable key cannot read it.</div>'+
    mKpis(kpis)+
    '<div class="m2grid">'+roll('Collections roll-up (from CRM)',[['Dream Valley Ph-2','₹48.0 Cr'],['Jain Heights','₹39.5 Cr'],['Green Acres','₹28.0 Cr'],['Trade Centre','₹18.5 Cr'],['Royal Enclave','₹7.8 Cr']])+roll('Payables roll-up (from Procurement)',[['Contractor RA bills','₹1.42 Cr'],['Material POs','₹0.78 Cr'],['Service work orders','₹0.26 Cr'],['Vendor advances','₹0.14 Cr']])+'</div>';
};
VIEWS.compliance=function(v,seg){
  setCrumb(['Governance','Renewals & Compliance']);
  const tabs=['Compliance calendar','Licences repository','Warranties & guarantees'];const ti=mTab(seg,tabs.length);
  const kpis=[['Due in 30 days','14',''],['Overdue','2','action needed','#c83232'],['Licences tracked','58',''],['AMCs active','23','']];
  let body;
  if(ti===0){ body='<p style="color:var(--slate);font-size:13px;margin:6px 0 14px">Statutory and contractual due dates (RERA QPR, GST, TDS, PF/ESI/PT, labour, fire, lift, environment) with owners. Alerts surface into My Tasks and e-mail reminders.</p>'+mTable(['Due date','Obligation','Category','Owner','Status'],[['07 Jul','Salary TDS deposit','Statutory · TDS','Finance','<span class="tag t-amber">Pending</span>'],['10 Jul','Professional Tax (MP)','Statutory · PT','HR','<span class="tag t-amber">Pending</span>'],['11 Jul','GST GSTR-3B','Statutory · GST','Finance','<span class="tag t-blue">Scheduled</span>'],['15 Jul','PF + ESI deposit','Statutory · Labour','HR','<span class="tag t-purple">Computed</span>']]); }
  else if(ti===1){ body=mTable(['Licence','Authority','Project','Expiry','Status'],[['RERA — Dream Valley','MahaRERA','Dream Valley','14 Aug','Active'],['Fire NOC','Fire Dept','Jain Heights','02 Jul','Due soon']]); }
  else { body=mTable(['Item','Asset','Provider','Expiry','Status'],[['Lift AMC','Passenger lift','OTIS','Mar-27','Active'],['DG warranty','DG Set 250 kVA','Cummins','Dec-26','Active']]); }
  v.innerHTML=mHead('fa-calendar-check','#b45309','Renewals & Compliance')+mKpis(kpis)+mTabs('compliance',tabs,ti)+'<div style="margin-top:14px">'+body+'</div>';
};
let CMP_PERIOD='today',CMP_SINCE='',CMP_UNTIL='',CMP_LAST=null,CMP_AD_PROJECT='all',CMP_AD_PAGE=0,CMP_SOURCE='meta',CMP_STATUS='all',CMP_CAMP_PROJECT='all';
window.cmpSetStatus=function(s){CMP_STATUS=s;CMP_AD_PAGE=0;renderPage();};
function cmpStatusBar(counts){
  const b=function(k,label){return '<button class="cmp-fbtn'+(CMP_STATUS===k?' on':'')+'" onclick="cmpSetStatus(\''+k+'\')">'+esc(label)+(counts&&counts[k]!=null?(' <span class="cmp-fcount">'+counts[k]+'</span>'):'')+'</button>';};
  return '<div class="cmp-fbar">'+b('all','All')+b('active','Active')+b('inactive','Inactive')+'</div>';
}
function cmpIsActive(st){const s=String(st||'').toUpperCase();return s==='ACTIVE'||s==='ENABLED';}
const CMP_PRESETS=[['today','Today'],['yesterday','Yesterday'],['last_7d','Last 7 days'],['last_14d','Last 14 days'],['last_month','Last month'],['last_year','Last year'],['custom','Custom']];

