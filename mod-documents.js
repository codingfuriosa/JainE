const DEPT_META={Administration:['fa-landmark','#475569','#f1f5f9'],HR:['fa-users','#be123c','#fff1f2'],Legal:['fa-scale-balanced','#1e3a8a','#eff4ff'],Finance:['fa-indian-rupee-sign','#15803d','#f0fdf4'],CRM:['fa-handshake','#7c3aed','#f5f3ff'],Sales:['fa-tags','#c2410c','#fff7ed'],Construction:['fa-helmet-safety','#b45309','#fffbeb'],Procurement:['fa-cart-shopping','#0369a1','#f0f9ff'],Inventory:['fa-boxes-stacked','#0f766e','#f0fdfa'],Marketing:['fa-bullhorn','#db2777','#fdf2f8'],IT:['fa-laptop-code','#4f46e5','#eef2ff'],Maintenance:['fa-screwdriver-wrench','#7c3aed','#f5f3ff'],Systems:['fa-server','#0e7490','#ecfeff'],Operations:['fa-gears','#a16207','#fefce8'],Site:['fa-helmet-safety','#0f766e','#f0fdfa'],Purchase:['fa-basket-shopping','#1d4ed8','#eff6ff'],'Pre Sales':['fa-chart-line','#059669','#ecfdf5'],'Post Sales':['fa-headset','#7e22ce','#faf5ff'],'CP Sales':['fa-handshake-angle','#c026d3','#fdf4ff'],Accounts:['fa-calculator','#4d7c0f','#f7fee7'],Management:['fa-briefcase','#334155','#f8fafc']};
VIEWS.documents=function(v,seg){
  DOC.scope='documents';DOC.sel.clear();
  if(seg[0]==='dept'){
    const d=decodeURIComponent(seg[1]);
    if(d==='Legal'){ navTo('legal'); return; } // Legal has its own hierarchical module — the generic library here is a flat list and doesn't match Legal's folder-tree data model. navTo (not a raw hash change) is required since Documents and Legal are separate pages.
    DOC.dept=d;DOC.cat=null;return docLibrary(v);
  }
  if(seg[0]==='search'){DOC.q=decodeURIComponent(seg[1]||'');DOC.dept=null;return docAll(v,'Search: "'+DOC.q+'"');}
  if(seg[0]==='all'){DOC.dept=null;DOC.q='';return docAll(v,'All Documents');}
  DOC.dept=null;DOC.q='';return docHome(v);
};

async function docHome(v){
  setCrumb(['Documents','Libraries']);
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-folder-open" style="color:#1d4ed8"></i> Document Management</h1><p>Google Drive-style libraries for every department · stored securely in Supabase</p></div>
    <div style="display:flex;gap:10px"><button class="btn" onclick="location.hash='#/documents/all'"><i class="fa-solid fa-table-list"></i> All Documents</button>
    <button class="btn btn-primary" onclick="docUploadModal()"><i class="fa-solid fa-upload"></i> Upload</button></div></div>
    <div class="grid kpis" id="docKpis"></div>
    <div style="margin:22px 0 10px" class="sec-title">Department Libraries</div>
    <div class="grid lib-grid" id="libGrid"></div>
    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:22px">
      <div class="card card-pad"><div class="sec-title"><i class="fa-solid fa-thumbtack" style="color:#d97706"></i> Pinned</div><div class="sec-sub">Quick-access documents</div><div id="pinned"></div></div>
      <div class="card card-pad"><div class="sec-title"><i class="fa-solid fa-clock-rotate-left" style="color:#1d4ed8"></i> Recently Uploaded</div><div class="sec-sub">Latest across all libraries</div><div id="recent"></div></div>
    </div>`;
  // Company-wide totals can run past Supabase's default row cap on a plain select, which was silently
  // truncating "all" and undercounting departments/KPIs (e.g. Finance showing 5 instead of its real 155).
  // Exact counts (head:true) and a DB-side sum RPC sidestep that cap entirely instead of pulling every row.
  const deptCounts={};
  await Promise.all(DEPARTMENTS.map(async d=>{
    const {count}=await sb.schema('doc').from('documents').select('*',{count:'exact',head:true}).eq('department',d);
    deptCounts[d]=count||0;
  }));
  const [{count:total},{count:active},{count:restricted},{data:sizeData},{data:pinnedRows},{data:recentRows}]=await Promise.all([
    sb.schema('doc').from('documents').select('*',{count:'exact',head:true}),
    sb.schema('doc').from('documents').select('*',{count:'exact',head:true}).eq('status','Active'),
    sb.schema('doc').from('documents').select('*',{count:'exact',head:true}).eq('visibility','Restricted'),
    sb.schema('doc').rpc('total_storage_bytes'),
    sb.schema('doc').from('documents').select('*').eq('pinned',true).order('created_at',{ascending:false}).limit(5),
    sb.schema('doc').from('documents').select('*').order('created_at',{ascending:false}).limit(5)
  ]);
  const size=sizeData||0;
  $('docKpis').innerHTML=[['Total Documents',total||0,'fa-file-lines','#eff4ff','#1d4ed8'],['Active',active||0,'fa-circle-check','#f0fdf4','#16a34a'],['Restricted',restricted||0,'fa-lock','#fef2f2','#dc2626'],['Storage Used',fmtBytes(size),'fa-database','#f5f3ff','#7c3aed']].map(k=>`<div class="kpi"><div class="top"><div class="ic" style="background:${k[3]};color:${k[4]}"><i class="fa-solid ${k[2]}"></i></div></div><div class="val">${k[1]}</div><div class="lbl">${k[0]}</div></div>`).join('');
  $('libGrid').innerHTML=DEPARTMENTS.map(d=>{const m=DEPT_META[d]||['fa-folder','#64748b','#f1f5f9'];const c=deptCounts[d]||0;return `<div class="lib-card" onclick="location.hash='#/documents/dept/${encodeURIComponent(d)}'"><div class="ic" style="background:${m[2]};color:${m[1]}"><i class="fa-solid ${m[0]}"></i></div><div class="nm">${d}</div><div class="ct">${c} document${c===1?'':'s'}</div></div>`;}).join('');
  const pinned=pinnedRows||[];
  $('pinned').innerHTML=pinned.length?pinned.map(d=>docRowMini(d)).join(''):'<div class="empty" style="padding:24px"><i class="fa-regular fa-star"></i><div>No pinned documents</div></div>';
  $('recent').innerHTML=(recentRows||[]).map(d=>docRowMini(d)).join('');
}
function docRowMini(d){return `<div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--line-2);cursor:pointer" onclick="docPreview(${d.id})">${fileIcon(d.file_type)}<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.title)}</div><div style="color:var(--slate);font-size:11.5px">${esc(d.department)} · ${esc(d.category||'—')} · ${relTime(d.created_at)}</div></div></div>`;}

async function docLibrary(v){
  const dept=DOC.dept;const m=DEPT_META[dept]||['fa-folder','#64748b','#f1f5f9'];
  setCrumb(['Documents',dept]);
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid ${m[0]}" style="color:${m[1]}"></i> ${esc(dept)} Library</h1><p>Folder navigation, categories & version-controlled storage</p></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" onclick="goBack('documents')"><i class="fa-solid fa-arrow-left"></i> Libraries</button>
    <button class="btn" onclick="docNewFolder('${esc(dept)}')"><i class="fa-solid fa-folder-plus"></i> New Folder</button>
    <button class="btn btn-primary" onclick="docUploadModal('${esc(dept)}')"><i class="fa-solid fa-upload"></i> Upload</button></div></div>
    <div class="split"><div><div class="subnav" id="catNav"></div></div><div><div id="docTableHost"></div></div></div>`;
  const all=await docFetch({dept});
  const folders=await getFolders(dept);
  const cats={};all.forEach(d=>cats[d.category||'Uncategorised']=(cats[d.category||'Uncategorised']||0)+1);
  folders.forEach(f=>{if(!(f in cats))cats[f]=0;});
  const catList=Object.keys(cats).sort();
  $('catNav').innerHTML=`<div class="sn-title">Folders</div>`+
    `<div class="sn-item ${!DOC.cat?'active':''}" onclick="docPickCat(null)"><span><i class="fa-regular fa-folder-open"></i> All</span><span class="ct">${all.length}</span></div>`+
    catList.map(c=>`<div class="sn-item ${DOC.cat===c?'active':''}" onclick="docPickCat('${esc(c).replace(/'/g,"\\'")}')"><span><i class="fa-regular fa-folder"></i> ${esc(c)}</span><span class="ct">${cats[c]}</span></div>`).join('')+
    `<div class="sn-item" style="color:var(--brand)" onclick="docNewFolder('${esc(dept)}')"><span><i class="fa-solid fa-plus"></i> New folder</span></div>`;
  docRenderTable($('docTableHost'),dept);
}
async function docAll(v,title){
  setCrumb(['Documents',title]);
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-table-list" style="color:#1d4ed8"></i> ${esc(title)}</h1><p>Search and manage documents across every department</p></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" onclick="goBack('documents')"><i class="fa-solid fa-arrow-left"></i> Libraries</button>
    <button class="btn btn-primary" onclick="docUploadModal()"><i class="fa-solid fa-upload"></i> Upload</button></div></div>
    <div id="docTableHost"></div>`;
  docRenderTable($('docTableHost'),null);
}
