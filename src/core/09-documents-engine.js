/* ============================ DOCUMENTS ENGINE (shared by Documents + Legal) ============================ */
/* 'Site' is the site-based half of what used to sit under Operations - the store and site staff
   who raise bills. The department picker on the Access screen is built from THIS list, so a
   department that only exists on the user records cannot be selected, and an admin editing one
   of those people would not see the department they are actually in. */
const DEPARTMENTS=['Administration','HR','Legal','Finance','Systems','Sales','Operations','Site','Marketing','IT','Maintenance','Purchase','Pre Sales','Post Sales','CP Sales','Accounts','Management'];
const DEPT_META={Administration:['fa-landmark','#475569','#f1f5f9'],HR:['fa-users','#be123c','#fff1f2'],Legal:['fa-scale-balanced','#1e3a8a','#eff4ff'],Finance:['fa-indian-rupee-sign','#15803d','#f0fdf4'],CRM:['fa-handshake','#7c3aed','#f5f3ff'],Sales:['fa-tags','#c2410c','#fff7ed'],Construction:['fa-helmet-safety','#b45309','#fffbeb'],Procurement:['fa-cart-shopping','#0369a1','#f0f9ff'],Inventory:['fa-boxes-stacked','#0f766e','#f0fdfa'],Marketing:['fa-bullhorn','#db2777','#fdf2f8'],IT:['fa-laptop-code','#4f46e5','#eef2ff'],Maintenance:['fa-screwdriver-wrench','#7c3aed','#f5f3ff'],Systems:['fa-server','#0e7490','#ecfeff'],Operations:['fa-gears','#a16207','#fefce8'],Site:['fa-helmet-safety','#0f766e','#f0fdfa'],Purchase:['fa-basket-shopping','#1d4ed8','#eff6ff'],'Pre Sales':['fa-chart-line','#059669','#ecfdf5'],'Post Sales':['fa-headset','#7e22ce','#faf5ff'],'CP Sales':['fa-handshake-angle','#c026d3','#fdf4ff'],Accounts:['fa-calculator','#4d7c0f','#f7fee7'],Management:['fa-briefcase','#334155','#f8fafc']};
const LEGAL_CATS=['Land Documents','Title Deeds','Sale Deeds','Lease Agreements','Joint Development Agreements','Joint Venture Agreements','Contracts','Government Approvals','Building Plan Approvals','RERA Documents','NOCs','Property Tax Records','Court Cases','Legal Notices','Compliance Documents','Templates','Archive'];
const VIS=['Public','Internal','Restricted'];
const DOCSTATUS=['Active','Draft','Archived'];
function bucketFor(dept){return dept==='Legal'?'legal-docs':'documents';}

// Resumable TUS upload for large files (>6MB), standard for small
async function uploadFileToStorage(bucket,path,file,onProgress){
  const CHUNK=6*1024*1024;// 6MB chunks
  if(file.size<=CHUNK){
    // Small file — standard single-request upload
    return sb.storage.from(bucket).upload(path,file,{cacheControl:'3600',upsert:false});
  }
  // Large file — TUS resumable upload via Supabase native endpoint
  const tus=await loadTusJs();if(!tus)return {error:{message:'TUS library failed to load'}};
  const {data:{session}}=await sb.auth.getSession();
  const token=session&&session.access_token;
  if(!token)return {error:{message:'Not authenticated'}};
  return new Promise(resolve=>{
    const up=new tus.Upload(file,{
      endpoint:SUPABASE_URL+'/storage/v1/upload/resumable',
      retryDelays:[0,3000,5000,10000,20000],
      headers:{authorization:'Bearer '+token,'x-upsert':'false'},
      uploadDataDuringCreation:true,
      removeFingerprintOnSuccess:true,
      metadata:{bucketName:bucket,objectName:path,contentType:file.type||'application/octet-stream',cacheControl:'3600'},
      chunkSize:CHUNK,
      onProgress:function(uploaded,total){if(onProgress)onProgress(Math.round(uploaded/total*100));},
      onError:function(e){resolve({data:null,error:{message:e.message||String(e)}});},
      onSuccess:function(){resolve({data:{path},error:null});},
    });
    up.start();
  });
}

/* ---- S3 (private bucket, presigned URLs via the `s3-sign` edge function) ---- */
async function s3Sign(action,key){
  const {data:{session}}=await sb.auth.getSession();
  const token=session&&session.access_token;
  if(!token)return {error:{message:'Not authenticated'}};
  try{
    const res=await fetch(SUPABASE_URL+'/functions/v1/s3-sign',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'apikey':SUPABASE_KEY},
      body:JSON.stringify({action,key})
    });
    const out=await res.json().catch(()=>({}));
    if(!res.ok||out.error)return {error:{message:out.error||('s3-sign '+res.status)}};
    return {data:out};
  }catch(e){return {error:{message:String(e)}};}
}
function isS3Path(p){return typeof p==='string'&&p.indexOf('s3:')===0;}
/* ---------- canonical S3 hierarchy ----------
   portal/documents/<Department>/...            Document Library + Procurement (non-Legal)
   portal/accountability/tasks/<taskId>/...      Task attachments (legacy nexus-core task system)
   portal/accountability/delegation/<taskId>/... Delegated-task attachments (legacy nexus-core task system)
   portal/accountability/ptasks/<taskId>/...     Task attachments (live Accountability module, accountability.js)
   portal/defect-img/...                         Inspection defect photos
   portal/hr/resumes/...                         Resumes
   portal/recruitment/descriptions/...           Job Descriptions
   legal/<category path>/...                     Legal Vault (own top-level root, NOT under portal/)
   portal/postsales/adhoc/...                    Post Sales ADHOC-replace converted output files
   customer-portal/projects/<id>/photos/...      Customer Portal — project-wide construction photos
   customer-portal/projects/<id>/<docType>/...   Customer Portal — brochure / legal (project-scoped)
   customer-portal/units/<id>/photos/...          Customer Portal — per-flat construction photos
   customer-portal/units/<id>/<docType>/...       Customer Portal — celebration/agreement/possession/parking (unit-scoped)
   customer-portal/process-videos/<category>/...  Customer Portal — Registry/Agreement/Nomination explainer videos (company-wide)
   customer-portal/units/<id>/inspection-checklist/... Customer Portal — the current inspection checklist scan (one per unit)
   customer-portal/units/<id>/inspection-updates/...   Customer Portal — dated photo/video updates against that checklist
------------------------------------------------- */
function s3Stamp(){return Date.now()+'_'+Math.random().toString(36).slice(2,7);}
function s3SafeName(name){return String(name||'file').replace(/[^\w.\-]/g,'_');}
function s3SafeSeg(seg){return String(seg||'').trim().replace(/[^\w.\- ]/g,'_');}
function s3KeyForDoc(dept,catPath,filename){
  const stamp=s3Stamp(),name=s3SafeName(filename);
  if(dept==='Legal'){
    // catPath must be an ARRAY of folder-name segments (e.g. ['Dream Palazzo','History of Land / Chain']).
    // Never split a joined display string here — category names can themselves contain '/', which
    // would corrupt the S3 path (e.g. "History of Land / Chain" would wrongly split into 2 segments).
    const arr=Array.isArray(catPath)?catPath:[catPath];
    const segs=arr.map(s=>s3SafeSeg(s)).filter(Boolean);
    return 'legal/'+(segs.length?segs.join('/')+'/':'')+stamp+'_'+name;
  }
  return `documents/${s3SafeSeg(dept)}/${stamp}_${name}`;
}
function s3KeyForTask(taskId,isDelegation,filename){
  return `accountability/${isDelegation?'delegation':'tasks'}/${s3Stamp()}_${s3SafeName(filename)}`;
}
function s3KeyForProject(projectId,filename){
  return `accountability/projects/${projectId}/${s3Stamp()}_${s3SafeName(filename)}`;
}
function s3KeyForGoal(goalId,filename){
  return `accountability/goals/${goalId}/${s3Stamp()}_${s3SafeName(filename)}`;
}
function s3KeyForPTask(taskId,filename){
  return `accountability/ptasks/${taskId}/${s3Stamp()}_${s3SafeName(filename)}`;
}
function s3KeyForResume(filename){return `hr/resumes/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForJD(filename){return `recruitment/descriptions/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForDefectImg(filename){return `defect-img/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForPostSalesAdhoc(filename){return `postsales/adhoc/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForTranscription(filename){return `transcription/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForFlowUpdate(caseId,filename){return `accountability/flow-updates/${caseId}/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForFlowEvent(flowId,filename){return `accountability/flow-events/${flowId}/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForProjectPhoto(projectId,filename){return `customer-portal/projects/${projectId}/photos/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForProjectDoc(projectId,docType,filename){return `customer-portal/projects/${projectId}/${s3SafeSeg(docType)}/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForUnitPhoto(unitId,filename){return `customer-portal/units/${unitId}/photos/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForTowerPhoto(projectId,tower,filename){return `customer-portal/projects/${projectId}/towers/${s3SafeSeg(tower)}/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForCustomerDoc(unitId,docType,filename){return `customer-portal/units/${unitId}/${s3SafeSeg(docType)}/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForProcessVideo(category,filename){return `customer-portal/process-videos/${s3SafeSeg(category)}/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForInspectionChecklist(unitId,filename){return `customer-portal/units/${unitId}/inspection-checklist/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForInspectionUpdate(unitId,filename){return `customer-portal/units/${unitId}/inspection-updates/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForPaymentQR(filename){return `customer-portal/payment-qr/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForSubmeterInvoice(unitId,filename){return `customer-portal/units/${unitId}/submeter-invoice/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForMaintenanceReceipt(unitId,filename){return `customer-portal/units/${unitId}/maintenance-payment-receipt/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForModificationRequest(unitId,filename){return `customer-portal/units/${unitId}/modification-request/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForSupportAttachment(ticketId,filename){return `customer-portal/support-tickets/${ticketId}/${s3Stamp()}_${s3SafeName(filename)}`;}
async function uploadFileToS3(key,file,onProgress){
  const {data,error}=await s3Sign('put',key);
  if(error)return {error};
  return new Promise(resolve=>{
    const xhr=new XMLHttpRequest();
    xhr.open('PUT',data.url,true);
    xhr.setRequestHeader('Content-Type',file.type||'application/octet-stream');
    xhr.upload.onprogress=function(e){if(onProgress&&e.lengthComputable)onProgress(Math.round(e.loaded/e.total*100));};
    xhr.onload=function(){
      if(xhr.status>=200&&xhr.status<300)resolve({data:{path:'s3:'+data.key},error:null});
      else resolve({data:null,error:{message:'S3 upload failed (HTTP '+xhr.status+')'}});
    };
    xhr.onerror=function(){resolve({data:null,error:{message:'S3 upload network error'}});};
    xhr.send(file);
  });
}
/* THE TAB IS OPENED ON THE CLICK, BEFORE THE URL IS SIGNED.

   This used to sign the URL first and call window.open afterwards. By then the click that caused it
   has been forgotten, so the browser treats the new tab as one the page opened by itself and blocks
   it as a pop-up - silently, with no error and no file. Every file in JAIN-E opens through here, so
   the Document Library, a CV, a job description and a test attachment all failed the same way and
   for the same reason.

   Opening a blank tab while the click is still live, then pointing it at the signed URL when it
   arrives, is what makes it work. Downloads are unaffected - an <a download> is not a pop-up - so
   that path is left exactly as it was.

   If the tab is blocked anyway (some browsers block even this when pop-ups are disabled outright),
   the address is handed over rather than lost. */
async function s3OpenSigned(storagePath,downloadName){
  const key=storagePath.slice(3);
  const tab=downloadName?null:window.open('','_blank');
  if(tab){
    try{ tab.document.write('<!doctype html><meta charset="utf-8"><title>Opening…</title>'
      +'<body style="font:16px system-ui;padding:40px;color:#334155">Opening the file…</body>'); }catch(_e){}
  }
  const {data,error}=await s3Sign('get',key);
  if(error){
    if(tab) try{ tab.close(); }catch(_e){}
    toast('Could not open file: '+error.message,'err');
    return;
  }
  if(downloadName){
    const a=document.createElement('a');a.href=data.url;a.download=downloadName;
    document.body.appendChild(a);a.click();a.remove();
    return;
  }
  if(tab&&!tab.closed){ try{ tab.location.href=data.url; return; }catch(_e){} }
  const w=window.open(data.url,'_blank');
  if(!w){
    openModal('<div class="modal-head"><h3><i class="fa-solid fa-file"></i> Open file</h3>'
      +'<span class="x" onclick="closeModal()">&times;</span></div>'
      +'<div class="modal-body frm"><p style="margin:0 0 10px;color:var(--slate);font-size:13px">'
      +'Your browser blocked the new tab. Open it from here instead.</p>'
      +'<input class="inp" readonly value="'+esc(data.url)+'" onclick="this.select()"></div>'
      +'<div class="modal-foot"><a class="btn btn-primary" href="'+esc(data.url)+'" target="_blank" rel="noopener">Open</a>'
      +'<button class="btn" onclick="closeModal()">Close</button></div>');
  }
}
// Signed URL for inline display (an <img src>, not a click-to-open/download) — used by the
// customer-portal photo galleries so a thumbnail actually shows the photo instead of a placeholder
// icon. Returns null on failure so callers can fall back to a placeholder rather than a broken <img>.
async function s3SignedUrl(storagePath){
  if(!isS3Path(storagePath))return null;
  const key=storagePath.slice(3);
  const {data,error}=await s3Sign('get',key);
  return error?null:data.url;
}
async function s3Delete(storagePath){
  const key=storagePath.slice(3);
  const {data,error}=await s3Sign('delete',key);
  if(error||!data)return;
  try{await fetch(data.url,{method:'DELETE'});}catch(e){/* best-effort */}
}
const DOC={dept:null,cat:null,q:'',sort:'created_at.desc',page:1,per:10,sel:new Set(),scope:'documents',legalExpanded:new Set()};

// `full` pulls content_text too — needed only by the re-index staleness check (docReindexAll),
// which needs to know how much text a doc already has. Every other caller only renders
// title/category/size/etc., so leaving content_text out saves dragging up to ~400KB of OCR text
// per row (Legal has hundreds of OCR'd PDFs now) across the wire just to draw a file list.
const DOC_LIST_COLS='id,doc_no,title,register_code,department,doc_type,version,tags,storage_path,link,status,confidential,uploaded_by,created_at,category,subcategory,description,file_name,file_size,file_type,visibility,pinned,folder,updated_at,folder_id';
async function docFetch({dept,cat,q,extraNonLegal,folderId,folderIds,full}={}){
  const [col,dir]=DOC.sort.split('.');
  const build=()=>{
    let qb=sb.schema('doc').from('documents').select(full?'*':DOC_LIST_COLS);
    if(dept)qb=qb.eq('department',dept);
    if(extraNonLegal)qb=qb.neq('department','Legal');
    if(cat)qb=qb.eq('category',cat);
    if(folderIds&&folderIds.length)qb=qb.in('folder_id',folderIds);
    else if(folderId)qb=qb.eq('folder_id',folderId);
    if(q){
      const t=q.trim().replace(/\s+/g,' ').trim();
      if(DOC.scope==='legal'){
        qb=qb.or('file_name.ilike.%'+t+'%,title.ilike.%'+t+'%,doc_no.ilike.%'+t+'%,content_text.ilike.%'+t+'%');
      } else {
        qb=qb.or('file_name.ilike.%'+t+'%,title.ilike.%'+t+'%,doc_no.ilike.%'+t+'%');
      }
    }
    return qb.order(col,{ascending:dir==='asc'});
  };
  // Supabase caps a plain select at ~1000 rows by default, which was silently truncating cross-department
  // fetches (company now has 1000+ documents) and undercounting things downstream. Page through with
  // .range() until a short page comes back so every matching row is actually returned.
  let all=[],from=0;const PAGE=1000;
  while(true){
    const {data,error}=await build().range(from,from+PAGE-1);
    if(error){toast('Load failed: '+error.message,'err');break;}
    all=all.concat(data||[]);
    if(!data||data.length<PAGE)break;
    from+=PAGE;
  }
  return all;
}

/* ---------- DOCUMENTS module ---------- */
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

async function getFolders(dept){
  try{const {data}=await sb.schema('doc').from('folders').select('name').eq('department',dept).order('name');return (data||[]).map(f=>f.name);}catch(e){return [];}
}

/* ---------- Legal category tree (hierarchical, unlimited depth, Legal-only) ---------- */
async function legalFolderTree(){
  const {data}=await sb.schema('doc').from('folders').select('id,name,parent_id').eq('department','Legal');
  return data||[];
}
function buildFolderTree(list){
  const byId={};list.forEach(f=>byId[f.id]={...f,children:[]});
  const roots=[];
  list.forEach(f=>{const node=byId[f.id];if(f.parent_id&&byId[f.parent_id])byId[f.parent_id].children.push(node);else roots.push(node);});
  const sortRec=arr=>{arr.sort((a,b)=>a.name.localeCompare(b.name));arr.forEach(n=>sortRec(n.children));};
  sortRec(roots);
  return {roots,byId};
}
function folderPath(byId,id){
  const path=[];let cur=byId[id];
  while(cur){path.unshift(cur.name);cur=cur.parent_id?byId[cur.parent_id]:null;}
  return path;
}
function flattenTreeOptions(nodes,depth,out){
  out=out||[];
  nodes.forEach(n=>{out.push({id:n.id,label:(depth?'— '.repeat(depth):'')+n.name});flattenTreeOptions(n.children,depth+1,out);});
  return out;
}
// Every id in the subtree rooted at rootId (inclusive) — used so selecting a parent
// folder shows documents filed anywhere underneath it, not just directly on it.
function collectDescendantIds(byId,rootId){
  const out=[rootId];
  const node=byId[rootId];
  if(node)node.children.forEach(c=>{out.push(...collectDescendantIds(byId,c.id));});
  return out;
}
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
window.docNewFolder=async function(dept,parentId,parentLabel){
  const isLegal=dept==='Legal';
  const title=isLegal?(parentLabel?'Add category in '+esc(parentLabel):'Add main folder in Legal'):('New folder in '+esc(dept));
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-folder-plus"></i> ${title}</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><label>${isLegal?'Category':'Folder / category'} name</label><input id="nfName" placeholder="e.g. Bank Guarantees"></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="docNewFolderSave('${esc(dept)}',${parentId!=null?parentId:'null'})">Create</button></div>`);
  setTimeout(()=>{var n=$('nfName');if(n){n.focus();n.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();docNewFolderSave(dept,parentId!=null?parentId:null);}};}},50);
};
window.docNewFolderSave=async function(dept,parentId){
  const name=$('nfName').value.trim();if(!name){toast('Enter a name','err');return;}
  const payload={department:dept,name,created_by:state.email};
  if(dept==='Legal')payload.parent_id=parentId||null;
  const {data,error}=await sb.schema('doc').from('folders').insert(payload).select('id').single();
  if(error){toast(/duplicate|unique/i.test(error.message)?'A category with that name already exists here':error.message,'err');return;}
  closeModal();toast(dept==='Legal'?'Category created':'Folder created','ok');
  if(dept==='Legal'){ if(parentId)DOC.legalExpanded.add(parentId); location.hash='#/legal/cat/'+data.id; } else { DOC.cat=name;route(); }
};
window.docPickCat=function(c){DOC.cat=c;DOC.page=1;document.querySelectorAll('#catNav .sn-item').forEach(x=>x.classList.remove('active'));docRenderTable($('docTableHost'),DOC.dept);
  // re-highlight
  const items=[...document.querySelectorAll('#catNav .sn-item')];items.forEach(it=>{const t=it.querySelector('span').textContent.trim();if((c===null&&t==='All')||(c&&t.replace(/^.*?\s/,'')===c)) it.classList.add('active');});};

async function docAll(v,title){
  setCrumb(['Documents',title]);
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-table-list" style="color:#1d4ed8"></i> ${esc(title)}</h1><p>Search and manage documents across every department</p></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" onclick="goBack('documents')"><i class="fa-solid fa-arrow-left"></i> Libraries</button>
    <button class="btn btn-primary" onclick="docUploadModal()"><i class="fa-solid fa-upload"></i> Upload</button></div></div>
    <div id="docTableHost"></div>`;
  docRenderTable($('docTableHost'),null);
}

async function docRenderTable(host,dept){
  loader(host);
  let legalFolderIds=null;
  if(DOC.scope==='legal'&&DOC.cat){
    const list=await legalFolderTree();
    const {byId}=buildFolderTree(list);
    legalFolderIds=collectDescendantIds(byId,Number(DOC.cat));
  }
  const rows=await docFetch({dept:DOC.scope==='legal'?'Legal':dept,cat:DOC.scope==='legal'?null:DOC.cat,folderIds:legalFolderIds,q:DOC.q});
  // toolbar
  /* The search box gets a line of its own, running the full width, with the buttons and dropdowns
     below it — searching inside a document is the main thing people come here to do, and it was
     squeezed into a fraction of the row alongside five other controls. */
  const toolbar=`<style>
    .doc-toolbar{margin-bottom:14px}
    .doc-searchrow{display:flex;align-items:center;position:relative;margin-bottom:9px}
    .doc-searchrow i.mag{position:absolute;left:13px;color:var(--slate);font-size:14px;pointer-events:none}
    .doc-searchrow input{width:100%;height:44px;padding:0 14px 0 38px;border:1px solid var(--line);border-radius:11px;
      font-size:14px;font-family:inherit;background:var(--bg-card);color:var(--ink)}
    .doc-searchrow input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10)}
    .doc-btnrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .doc-btnrow .sel{height:36px}
    @media(max-width:760px){
      .doc-searchrow input{height:42px}
      .doc-btnrow{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .doc-btnrow .btn,.doc-btnrow .sel{width:100%;justify-content:center}
    }
  </style>
  <div class="doc-toolbar">
    <div class="doc-searchrow"><i class="fa-solid fa-magnifying-glass mag"></i>
      <input id="dtSearch" placeholder="${DOC.scope==='legal'?'Search a file name, or any words written inside the documents…':'Search by file name or title…'}" value="${esc(DOC.q)}"></div>
    <div class="doc-btnrow">
      <button class="btn btn-primary" id="dtSearchBtn"><i class="fa-solid fa-magnifying-glass"></i> Search</button>
      ${DOC.q?`<button class="btn" id="dtClear" onclick="DOC.q='';docRenderTable(document.getElementById('docTableHost'),${dept?("'"+esc(dept)+"'"):'null'})"><i class="fa-solid fa-xmark"></i> Clear</button>`:''}
      <select class="sel" id="dtSort">
        <option value="created_at.desc">Newest first</option><option value="created_at.asc">Oldest first</option>
        <option value="title.asc">Title A–Z</option><option value="title.desc">Title Z–A</option>
        <option value="file_size.desc">Largest</option></select>
      <select class="sel" id="dtStatus"><option value="">All status</option>${DOCSTATUS.map(s=>'<option>'+s+'</option>').join('')}</select>
      <button class="btn" id="dtBulkDl" disabled><i class="fa-solid fa-download"></i> Download</button>
      <button class="btn btn-danger" id="dtBulkDel" disabled><i class="fa-solid fa-trash"></i> Delete</button>
    </div>
  </div>`;
  let filtered=rows;
  const stEl=()=>$('dtStatus')?$('dtStatus').value:'';
  const draw=()=>{
    const st=stEl();
    let list=rows.filter(r=>!st||r.status===st);
    const start=(DOC.page-1)*DOC.per;const pageRows=list.slice(start,start+DOC.per);
    const totalPages=Math.max(1,Math.ceil(list.length/DOC.per));
    const body=pageRows.length?pageRows.map(d=>{
      const sel=DOC.sel.has(d.id);
      return `<tr>
        <td><input type="checkbox" class="checkbox dtChk" data-id="${d.id}" ${sel?'checked':''}></td>
        <td><div style="display:flex;align-items:center;gap:11px">${fileIcon(d.file_type)}<div style="min-width:0"><div style="font-weight:600;cursor:pointer" onclick="docPreview(${d.id})">${esc(d.title)} ${d.pinned?'<i class="fa-solid fa-thumbtack" style="color:#d97706;font-size:11px"></i>':''}</div><div style="color:var(--slate);font-size:11.5px">${esc(d.doc_no||'')} · ${esc(d.file_name||'')}</div></div></div></td>
        <td>${esc(d.category||'—')}</td>
        <td><span class="tag t-gray">${esc((d.file_type||'').toUpperCase())}</span></td>
        <td>${fmtBytes(d.file_size)}</td>
        <td><span class="tag ${d.visibility==='Restricted'?'t-red':d.visibility==='Public'?'t-green':'t-blue'}">${esc(d.visibility||'Internal')}</span></td>
        <td>v${esc((d.version||'1').replace('v',''))}</td>
        <td>${statusTag(d.status)}</td>
        <td>${fmtDate(d.created_at)}</td>
        <td style="text-align:right"><button class="btn btn-sm btn-ghost" onclick="docMenu(event,${d.id})"><i class="fa-solid fa-ellipsis-vertical"></i></button></td>
      </tr>`;}).join(''):`<tr><td colspan="10"><div class="empty"><i class="fa-regular fa-folder-open"></i><div>No documents found</div><button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="docUploadModal('${dept?esc(dept):''}')"><i class="fa-solid fa-upload"></i> Upload a document</button></div></td></tr>`;
    host.innerHTML=toolbar+`<div class="card"><table><thead><tr>
      <th style="width:38px"><input type="checkbox" class="checkbox" id="dtAll"></th><th>Document</th><th>Category</th><th>Type</th><th>Size</th><th>Visibility</th><th>Ver</th><th>Status</th><th>Uploaded</th><th></th>
    </tr></thead><tbody>${body}</tbody></table>
    <div style="display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-top:1px solid var(--line)">
      <span style="color:var(--slate);font-size:12.5px">${list.length} document${list.length===1?'':'s'} · page ${DOC.page} of ${totalPages}</span>
      <div style="display:flex;gap:8px"><button class="btn btn-sm" ${DOC.page<=1?'disabled':''} onclick="docPage(-1)"><i class="fa-solid fa-chevron-left"></i></button><button class="btn btn-sm" ${DOC.page>=totalPages?'disabled':''} onclick="docPage(1,${totalPages})"><i class="fa-solid fa-chevron-right"></i></button></div>
    </div></div>`;
    wire();
  };
  const wire=()=>{
    /* Search only runs on Enter or the button, never per keystroke, so a plain log is right here -
       no debounce needed. Clearing the box is not a search, so an empty value is not counted. */
    const usbDoc=(m)=>{ try{ if(m) usageQueue('legal.documents.search_sort_filter_documents','search',m); }catch(_e){} };
    const s=$('dtSearch');if(s){s.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();DOC.q=s.value.trim();DOC.page=1;usbDoc(DOC.q?{query:DOC.q}:null);docRenderTable(host,dept);}};}
    const sb2=$('dtSearchBtn');if(sb2)sb2.onclick=()=>{DOC.q=($('dtSearch')?$('dtSearch').value.trim():'');DOC.page=1;usbDoc(DOC.q?{query:DOC.q}:null);docRenderTable(host,dept);};
    const so=$('dtSort');if(so){so.value=DOC.sort;so.onchange=e=>{DOC.sort=e.target.value;usbDoc({title:'Sorted by '+e.target.value});docRenderTable(host,dept);};}
    const stt=$('dtStatus');if(stt)stt.onchange=()=>{DOC.page=1;usbDoc({title:'Status: '+(stt.value||'all')});draw();};
    document.querySelectorAll('.dtChk').forEach(c=>c.onchange=e=>{const id=+e.target.dataset.id;e.target.checked?DOC.sel.add(id):DOC.sel.delete(id);updateBulk();});
    const all=$('dtAll');if(all)all.onchange=e=>{document.querySelectorAll('.dtChk').forEach(c=>{c.checked=e.target.checked;const id=+c.dataset.id;e.target.checked?DOC.sel.add(id):DOC.sel.delete(id);});updateBulk();};
    updateBulk();
  };
  const updateBulk=()=>{const n=DOC.sel.size;const dl=$('dtBulkDl'),del=$('dtBulkDel');if(dl){dl.disabled=!n;dl.innerHTML='<i class="fa-solid fa-download"></i> Download'+(n?' ('+n+')':'');dl.onclick=()=>{try{usageQueue('legal.documents.bulk_download_delete','export',{title:'Bulk download ('+DOC.sel.size+' documents)'});}catch(_e){}DOC.sel.forEach(id=>docDownload(id));};}if(del){del.disabled=!n;del.innerHTML='<i class="fa-solid fa-trash"></i> Delete'+(n?' ('+n+')':'');del.onclick=()=>docBulkDelete();}};
  window.docPage=(d,tp)=>{DOC.page=Math.max(1,DOC.page+d);if(tp)DOC.page=Math.min(DOC.page,tp);draw();};
  draw();
}

/* ---------- doc actions ---------- */
window.docMenu=function(e,id){
  e.stopPropagation();
  const exists=document.getElementById('docCtx');if(exists)exists.remove();
  const menu=el('div','dropdown show');menu.id='docCtx';menu.style.cssText='position:fixed;width:200px;z-index:120';
  menu.innerHTML=[['fa-eye','Preview','docPreview'],['fa-download','Download','docDownload'],['fa-pen','Rename','docRename'],['fa-code-branch','Replace Version','docReplaceVersion'],['fa-clock-rotate-left','Version History','docVersions'],['fa-folder-tree','Move','docMove'],['fa-thumbtack','Pin / Unpin','docPin'],['fa-magnifying-glass','Re-index for search','docReindex']].map(a=>`<div class="dd-item" onclick="${a[2]}(${id});document.getElementById('docCtx').remove()"><i class="fa-solid ${a[0]}"></i> ${a[1]}</div>`).join('')+`<div style="height:1px;background:var(--line-2);margin:6px 0"></div><div class="dd-item" style="color:var(--err)" onclick="docDelete(${id});document.getElementById('docCtx').remove()"><i class="fa-solid fa-trash"></i> Delete</div>`;
  document.body.appendChild(menu);
  const r=e.target.getBoundingClientRect();menu.style.top=(r.bottom+4)+'px';menu.style.left=(r.right-200)+'px';
  setTimeout(()=>document.addEventListener('click',function h(){menu.remove();document.removeEventListener('click',h);}),0);
};
async function getDoc(id){const {data}=await sb.schema('doc').from('documents').select('*').eq('id',id).single();return data;}
/* Logged here rather than from USAGE_MAP, and only once the document is actually in hand. A wrapper
   fires on the click with nothing but the row id, which is why every "Preview / download document"
   row in the report reads "—": 55 of them, and not one says which document. The name is the only
   thing that makes the row mean anything. */
window.docPreview=async function(id){
  const d=await getDoc(id);if(!d)return;
  try{ usageQueue('legal.documents.preview_download_document','view',
        {title:d.title||d.file_name||null, category:d.category||d.folder||null}); }catch(_e){}
  if(!d.storage_path){ if(d.link){window.open(d.link,'_blank');return;} toast('No file attached to this record.','');return; }
  if(isS3Path(d.storage_path)){ await s3OpenSigned(d.storage_path); return; }
  const {data,error}=await sb.storage.from(bucketFor(d.department)).createSignedUrl(d.storage_path,120);
  if(error){toast('Preview failed: '+error.message,'err');return;}
  window.open(data.signedUrl,'_blank');
};
window.docDownload=async function(id){
  const d=await getDoc(id);if(!d)return;
  try{ usageQueue('legal.documents.preview_download_document','export',
        {title:d.title||d.file_name||null, category:d.category||d.folder||null}); }catch(_e){}
  if(!d.storage_path){ if(d.link){window.open(d.link,'_blank');return;} toast('No file to download.','');return; }
  if(isS3Path(d.storage_path)){ await s3OpenSigned(d.storage_path,d.file_name||'download'); return; }
  const {data,error}=await sb.storage.from(bucketFor(d.department)).createSignedUrl(d.storage_path,120,{download:d.file_name||true});
  if(error){toast('Download failed: '+error.message,'err');return;}
  const a=document.createElement('a');a.href=data.signedUrl;a.download=d.file_name||'';document.body.appendChild(a);a.click();a.remove();
};
window.docPin=async function(id){const d=await getDoc(id);await sb.schema('doc').from('documents').update({pinned:!d.pinned}).eq('id',id);toast(d.pinned?'Unpinned':'Pinned','ok');route();};
window.docRename=async function(id){
  const d=await getDoc(id);
  openModal(`<div class="modal-head"><h3>Rename document</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><label>Title</label><input id="rnTitle" value="${esc(d.title)}"></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="docRenameSave(${id})">Save</button></div>`);
};
window.docRenameSave=async function(id){const t=$('rnTitle').value.trim();if(!t)return;const {error}=await sb.schema('doc').from('documents').update({title:t}).eq('id',id);if(error){toast(error.message,'err');return;}closeModal();toast('Renamed','ok');route();};
window.docMove=async function(id){
  const d=await getDoc(id);
  if(d.department==='Legal'){
    const list=await legalFolderTree();
    const {roots}=buildFolderTree(list);
    const opts=flattenTreeOptions(roots,0);
    openModal(`<div class="modal-head"><h3>Move document</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><label>Department</label><select id="mvDept" disabled><option selected>Legal</option></select><label>Category</label><select id="mvFolder">${opts.map(o=>'<option value="'+o.id+'" '+(o.id===d.folder_id?'selected':'')+'>'+esc(o.label)+'</option>').join('')}</select></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="docMoveSaveLegal(${id})">Move</button></div>`);
    return;
  }
  const cats=['Policies','SOPs','Templates','Statutory','Budgets','Brand','Collateral','Plans','Data','Pricing','Drawings','BOQ','Reports','Quotes','Ledgers','Registers','Assets','Schedules','Contracts','Minutes','Reference','Agreements','Uncategorised'];
  openModal(`<div class="modal-head"><h3>Move document</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><div class="two"><div><label>Department</label><select id="mvDept">${DEPARTMENTS.map(x=>'<option '+(x===d.department?'selected':'')+'>'+x+'</option>').join('')}</select></div><div><label>Category / Folder</label><select id="mvCat">${cats.map(x=>'<option '+(x===d.category?'selected':'')+'>'+x+'</option>').join('')}</select></div></div></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="docMoveSave(${id})">Move</button></div>`);
};
window.docMoveSave=async function(id){const dept=$('mvDept').value,cat=$('mvCat').value;const {error}=await sb.schema('doc').from('documents').update({department:dept,category:cat,folder_id:null}).eq('id',id);if(error){toast(error.message,'err');return;}closeModal();toast('Moved to '+dept,'ok');route();};
window.docMoveSaveLegal=async function(id){
  const folderId=Number($('mvFolder').value);
  const list=await legalFolderTree();const {byId}=buildFolderTree(list);
  const path=folderPath(byId,folderId).join(' / ');
  const {error}=await sb.schema('doc').from('documents').update({folder_id:folderId,category:path}).eq('id',id);
  if(error){toast(error.message,'err');return;}closeModal();toast('Moved','ok');route();
};
window.docDelete=async function(id){
  const d=await getDoc(id);
  openModal(`<div class="modal-head"><h3>Delete document</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body">Delete <b>${esc(d.title)}</b>? This removes the file and its metadata permanently.</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-danger" onclick="docDeleteConfirm(${id})"><i class="fa-solid fa-trash"></i> Delete</button></div>`);
};
window.docDeleteConfirm=async function(id){
  const d=await getDoc(id);
  if(d.storage_path){ if(isS3Path(d.storage_path)) await s3Delete(d.storage_path); else await sb.storage.from(bucketFor(d.department)).remove([d.storage_path]); }
  const {error}=await sb.schema('doc').from('documents').delete().eq('id',id);
  if(error){toast(error.message,'err');return;}
  DOC.sel.delete(id);closeModal();toast('Deleted','ok');route();
};
async function docBulkDelete(){
  if(!DOC.sel.size)return;
  openModal(`<div class="modal-head"><h3>Delete ${DOC.sel.size} documents</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body">Permanently delete the selected documents and their files?</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-danger" onclick="docBulkDeleteConfirm()"><i class="fa-solid fa-trash"></i> Delete all</button></div>`);
}
window.docBulkDeleteConfirm=async function(){
  for(const id of DOC.sel){const d=await getDoc(id);if(d&&d.storage_path){ if(isS3Path(d.storage_path)) await s3Delete(d.storage_path); else await sb.storage.from(bucketFor(d.department)).remove([d.storage_path]); } await sb.schema('doc').from('documents').delete().eq('id',id);}
  DOC.sel.clear();closeModal();toast('Deleted','ok');route();
};
window.docVersions=async function(id){
  const d=await getDoc(id);
  const {data:vers}=await sb.schema('doc').from('document_versions').select('*').eq('document_id',id).order('created_at',{ascending:false});
  const list=(vers&&vers.length)?vers.map(x=>`<div style="display:flex;align-items:center;gap:11px;padding:10px 0;border-bottom:1px solid var(--line-2)">${fileIcon(x.file_type)}<div style="flex:1"><div style="font-weight:600;font-size:13px">${esc(x.version||'—')} · ${esc(x.file_name||'')}</div><div style="color:var(--slate);font-size:11.5px">${fmtBytes(x.file_size)} · ${relTime(x.created_at)} · ${esc(x.uploaded_by||'')}</div></div></div>`).join(''):'<div class="empty" style="padding:24px"><i class="fa-regular fa-clock"></i><div>No prior versions</div></div>';
  openModal(`<div class="modal-head"><h3>Version history · ${esc(d.title)}</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body"><div style="display:flex;align-items:center;gap:11px;padding:10px 0;border-bottom:2px solid var(--brand);margin-bottom:6px">${fileIcon(d.file_type)}<div style="flex:1"><div style="font-weight:600;font-size:13px">${esc(d.version||'v1')} · ${esc(d.file_name||'')} <span class="tag t-green">Current</span></div><div style="color:var(--slate);font-size:11.5px">${fmtBytes(d.file_size)} · ${relTime(d.updated_at||d.created_at)}</div></div></div>${list}</div><div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Close</button></div>`);
};
window.docReplaceVersion=function(id){
  openModal(`<div class="modal-head"><h3>Replace version</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><p style="color:var(--slate);font-size:13px;margin-bottom:6px">Upload a new file. The current version is archived to history.</p><div class="dropzone" onclick="document.getElementById('rvFile').click()"><i class="fa-solid fa-cloud-arrow-up"></i><div id="rvName">Click to choose a file</div></div><input type="file" id="rvFile" class="hidden" onchange="document.getElementById('rvName').textContent=this.files[0]?this.files[0].name:'Click to choose a file'"></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="docReplaceSave(${id})"><i class="fa-solid fa-code-branch"></i> Replace</button></div>`);
};
window.docReplaceSave=async function(id){
  const f=$('rvFile').files[0];if(!f){toast('Choose a file first','err');return;}
  const d=await getDoc(id);
  // archive current
  if(d.storage_path){await sb.schema('doc').from('document_versions').insert({document_id:id,version:d.version,storage_path:d.storage_path,file_name:d.file_name,file_size:d.file_size,file_type:d.file_type,uploaded_by:d.uploaded_by});}
  let catForKey=d.category;
  if(d.department==='Legal' && d.folder_id){
    try{const list=await legalFolderTree();const {byId}=buildFolderTree(list);catForKey=folderPath(byId,d.folder_id);}catch(e){}
  }
  const key=s3KeyForDoc(d.department,catForKey,f.name);
  const {data:upData,error:upErr}=await uploadFileToS3(key,f);
  if(upErr){toast('Upload failed: '+upErr.message,'err');return;}
  const newVer='v'+(parseInt((d.version||'v1').replace('v',''))+1);
  const {error}=await sb.schema('doc').from('documents').update({storage_path:upData.path,file_name:f.name,file_size:f.size,file_type:f.name.split('.').pop(),version:newVer}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  closeModal();toast('New version '+newVer+' saved','ok');route();
};

/* ---------- upload modal ---------- */
window.docUploadModal=async function(presetDept){
  const isLegal=DOC.scope==='legal'||presetDept==='Legal';
  const dept=presetDept||(isLegal?'Legal':(DOC.dept||''));
  const locked=!!dept;
  let catField;
  if(isLegal){
    const list=await legalFolderTree();
    const {roots}=buildFolderTree(list);
    const opts=flattenTreeOptions(roots,0);
    const curFolderId=DOC.cat?Number(DOC.cat):(opts[0]?opts[0].id:'');
    catField=`<div><label>Category</label><select id="upFolderId">${opts.map(o=>'<option value="'+o.id+'" '+(o.id===curFolderId?'selected':'')+'>'+esc(o.label)+'</option>').join('')}</select></div>`;
  } else {
    const curCat=(DOC.cat&&DOC.cat!=='All')?DOC.cat:'';
    let cats=[];
    if(dept){try{const f=await getFolders(dept);f.forEach(c=>{if(!cats.includes(c))cats.push(c);});}catch(e){}
      try{const ex=await docFetch({dept});[...new Set(ex.map(d=>d.category).filter(Boolean))].forEach(c=>{if(!cats.includes(c))cats.push(c);});}catch(e){}}
    catField=`<div><label>Folder / Category <span style="color:#94a3b8;font-weight:400">(pick or type new)</span></label><input id="upCat" list="upCatList" value="${esc(curCat)}" placeholder="${cats[0]?esc(cats[0]):'e.g. Policies'}"><datalist id="upCatList">${cats.map(x=>'<option value="'+esc(x)+'">').join('')}</datalist></div>`;
  }
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-upload"></i> Upload document${dept?' · '+esc(dept):''}</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <div class="dropzone" onclick="document.getElementById('upFile').click()"><i class="fa-solid fa-cloud-arrow-up"></i><div id="upName">Drag & drop or click to select files</div><div style="font-size:12px;margin-top:4px">PDF, Word, Excel, images — multiple allowed. Each file's name can be edited below.</div></div>
    <input type="file" id="upFile" class="hidden" multiple onchange="docUpPick()">
    <div id="upList" style="margin-top:8px"></div>
    <div class="two">
      <div><label>Department ${locked?'<span style="color:#94a3b8;font-weight:400">(locked)</span>':''}</label><select id="upDept" ${locked?'disabled':''}>${DEPARTMENTS.map(x=>'<option '+(x===dept?'selected':'')+'>'+x+'</option>').join('')}</select></div>
      ${catField}
    </div>
    <div class="two"><div><label>Version</label><input id="upVer" value="v1"></div><div><label>Visibility</label><select id="upVis">${VIS.map(x=>'<option '+(x==='Internal'?'selected':'')+'>'+x+'</option>').join('')}</select></div></div>
    <label>Description</label><textarea id="upDesc" placeholder="Short description…"></textarea>
    <div class="two"><div><label>Status</label><select id="upStatus">${DOCSTATUS.map(x=>'<option>'+x+'</option>').join('')}</select></div><div><label>Confidential</label><select id="upConf"><option value="false">No</option><option value="true">Yes (super-admin only)</option></select></div></div>
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="upBtn" onclick="docUploadSave()"><i class="fa-solid fa-upload"></i> Upload</button></div>`,'lg');
};
window.docUpPick=function(){const fs=[...$('upFile').files];$('upName').textContent=fs.length?fs.length+' file(s) selected — edit names below':'Drag & drop or click to select files';$('upList').innerHTML=fs.map((f,i)=>`<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line-2)">${fileIcon(f.name.split('.').pop())}<input class="upTitleIn" data-i="${i}" value="${esc(f.name.replace(/\.[^.]+$/,''))}" title="${esc(f.name)}" style="flex:1;font-size:13px;font-weight:500;border:1px solid var(--line);border-radius:7px;padding:6px 9px;color:var(--ink)"><span style="color:var(--slate);font-size:12px;white-space:nowrap">${fmtBytes(f.size)}</span></div>`).join('');};
async function loadPdfJs(){
  if(window.pdfjsLib)return window.pdfjsLib;
  await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';sc.onload=res;sc.onerror=rej;document.head.appendChild(sc);});
  if(window.pdfjsLib)window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return window.pdfjsLib;
}
async function loadTesseract(){
  if(window.Tesseract)return window.Tesseract;
  await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';sc.onload=res;sc.onerror=rej;document.head.appendChild(sc);});
  return window.Tesseract;
}
async function loadXLSX(){
  if(window.XLSX)return window.XLSX;
  await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';sc.onload=res;sc.onerror=rej;document.head.appendChild(sc);});
  return window.XLSX||null;
}
async function loadTusJs(){
  if(window.tus)return window.tus;
  await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdn.jsdelivr.net/npm/tus-js-client@3/dist/tus.min.js';sc.onload=res;sc.onerror=rej;document.head.appendChild(sc);});
  return window.tus||null;
}
async function loadJSZip(){
  if(window.JSZip)return window.JSZip;
  await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';sc.onload=res;sc.onerror=rej;document.head.appendChild(sc);});
  return window.JSZip||null;
}
async function loadMammoth(){
  if(window.mammoth)return window.mammoth;
  await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';sc.onload=res;sc.onerror=rej;document.head.appendChild(sc);});
  return window.mammoth||null;
}
async function loadPdfLib(){
  if(window.PDFLib)return window.PDFLib;
  await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';sc.onload=res;sc.onerror=rej;document.head.appendChild(sc);});
  return window.PDFLib||null;
}
// Farvision CSV imports (Customer Portal Admin) need real CSV parsing — quoted fields with embedded
// commas (addresses, "1,000.00"-style amounts), a UTF-8 BOM, CRLF line endings — a hand-rolled
// split(',') silently mis-parses the first such row. PapaParse handles all of it.
async function loadPapaParse(){
  if(window.Papa)return window.Papa;
  await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js';sc.onload=res;sc.onerror=rej;document.head.appendChild(sc);});
  return window.Papa||null;
}
function _letters(t){return (String(t||'').match(/[A-Za-z]/g)||[]).length;}

// Lightweight in-place OCR preprocessing — one canvas, one pass
// Grayscale + contrast stretch — no extra canvas copies, no memory blow-up
function ocrPreprocess(canvas){
  const ctx=canvas.getContext('2d');
  const W=canvas.width,H=canvas.height;
  const id=ctx.getImageData(0,0,W,H);
  const d=id.data;
  // Step 1: grayscale + contrast stretch + S-curve
  let mn=255,mx=0;
  for(let i=0;i<d.length;i+=4){
    const g=(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])|0;
    d[i]=d[i+1]=d[i+2]=g;if(g<mn)mn=g;if(g>mx)mx=g;
  }
  const range=mx-mn||1;
  const lut=new Uint8Array(256);
  for(let v=0;v<256;v++){
    let g=((v-mn)/range*255)|0;
    g=(255/(1+Math.exp(-0.06*(g-128)))+0.5)|0;
    lut[v]=Math.min(255,Math.max(0,g));
  }
  for(let i=0;i<d.length;i+=4){d[i]=d[i+1]=d[i+2]=lut[d[i]];}
  // Step 2: double unsharp mask — sharpens edges for small text & grey-bg rows
  const buf=new Uint8Array(W*H);
  for(let pass=0;pass<2;pass++){
    for(let y=0;y<H;y++){
      for(let x=0;x<W;x++){
        const l=x>0?d[((y*W+(x-1))*4)]:d[(y*W+x)*4];
        const c=d[(y*W+x)*4];
        const r=x<W-1?d[((y*W+(x+1))*4)]:c;
        buf[y*W+x]=((l+c+r)/3+0.5)|0;
      }
    }
    for(let y=0;y<H;y++){
      for(let x=0;x<W;x++){
        const u=y>0?buf[((y-1)*W+x)]:buf[y*W+x];
        const c=buf[y*W+x];
        const b=y<H-1?buf[((y+1)*W+x)]:c;
        const blurV=((u+c+b)/3+0.5)|0;
        const orig=d[(y*W+x)*4];
        const sharp=Math.min(255,Math.max(0,(orig+2.0*(orig-blurV)+0.5)|0));
        d[(y*W+x)*4]=d[(y*W+x)*4+1]=d[(y*W+x)*4+2]=sharp;
      }
    }
  }
  // Step 3: hard binarize at 160 — makes grey-background text (TOTAL rows, headers) readable
  for(let i=0;i<d.length;i+=4){const v=d[i]>160?255:0;d[i]=d[i+1]=d[i+2]=v;}
  ctx.putImageData(id,0,0);
  return canvas;
}
async function ocrImageSource(src){
  // src can be a File/Blob OR a URL string
  try{
    const T=await loadTesseract();if(!T)return '';
    const isBlob=src instanceof Blob;
    const url=isBlob?URL.createObjectURL(src):src;
    const img=await new Promise((res,rej)=>{
      const i=new Image();
      if(!isBlob)i.crossOrigin='anonymous';
      i.onload=()=>res(i);i.onerror=rej;i.src=url;
    });
    const longEdge=Math.max(img.naturalWidth||1,img.naturalHeight||1);
    const scale=Math.min(8,Math.max(1,Math.ceil(4000/longEdge)));// 4000px target
    const c=document.createElement('canvas');c.width=img.naturalWidth*scale;c.height=img.naturalHeight*scale;
    const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(img,0,0,c.width,c.height);
    const processed=ocrPreprocess(c);
    const dpi=Math.round(scale*96);
    const r1=await T.recognize(processed,'eng',{tessedit_pageseg_mode:'3',tessedit_ocr_engine_mode:'1',user_defined_dpi:String(dpi)});
    const r2=await T.recognize(processed,'eng',{tessedit_pageseg_mode:'6',tessedit_ocr_engine_mode:'1',user_defined_dpi:String(dpi)});
    if(isBlob)URL.revokeObjectURL(url);
    return (((r1&&r1.data&&r1.data.text)||'')+' '+((r2&&r2.data&&r2.data.text)||'')).trim();
  }catch(e){console.warn('ocr img failed',e);return '';}
}
async function ocrPdf(file){
  try{
    const lib=await loadPdfJs();const T=await loadTesseract();if(!lib||!T)return '';
    const buf=await file.arrayBuffer();const pdf=await lib.getDocument({data:buf}).promise;
    let txt='';const n=Math.min(pdf.numPages,20);
    for(let i=1;i<=n;i++){
      const page=await pdf.getPage(i);
      // 4x scale ≈ 288 DPI — captures small text (6pt+ reliable, 4pt+ often readable)
      const vp=page.getViewport({scale:4});
      const canvas=document.createElement('canvas');canvas.width=vp.width;canvas.height=vp.height;
      const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
      await page.render({canvasContext:ctx,viewport:vp}).promise;
      const processed=ocrPreprocess(canvas);
      const r1=await T.recognize(processed,'eng',{tessedit_pageseg_mode:'3',tessedit_ocr_engine_mode:'1',user_defined_dpi:'288'});
      const r2=await T.recognize(processed,'eng',{tessedit_pageseg_mode:'6',tessedit_ocr_engine_mode:'1',user_defined_dpi:'288'});
      const r3=await T.recognize(processed,'eng',{tessedit_pageseg_mode:'11',tessedit_ocr_engine_mode:'1',user_defined_dpi:'288'});
      txt+=((r1&&r1.data&&r1.data.text)||'')+' '+((r2&&r2.data&&r2.data.text)||'')+' '+((r3&&r3.data&&r3.data.text)||'')+' ';
    }
    return txt.replace(/(\d),(?=\d)/g,'$1').replace(/\s+/g,' ').trim();
  }catch(e){console.warn('ocr pdf failed',e);return '';}
}
async function extractFileText(file){
  const ext=(file.name.split('.').pop()||'').toLowerCase();
  try{
    if(['txt','csv','md','json','html'].includes(ext)){return (await file.text()).replace(/\s+/g,' ').slice(0,400000);}
    if(['png','jpg','jpeg','webp','bmp','gif','tif','tiff'].includes(ext)){
      const t=await ocrImageSource(file);return (t||'').replace(/\s+/g,' ').trim().slice(0,400000)||null;
    }
    if(ext==='pdf'){
      const lib=await loadPdfJs();if(!lib)return null;
      const buf=await file.arrayBuffer();
      const pdf=await lib.getDocument({data:buf}).promise;
      // Step 1: extract the text layer (font-based text — fast)
      let layerTxt='';const n=Math.min(pdf.numPages,80);
      for(let i=1;i<=n;i++){const pg=await pdf.getPage(i);const c=await pg.getTextContent();layerTxt+=c.items.map(it=>it.str).join(' ')+' ';}
      layerTxt=layerTxt.replace(/\s+/g,' ').trim();
      // Step 2: ALWAYS run OCR on first 10 pages — catches image text in brochures/scans
      // This runs regardless of whether the text layer has content
      let ocrTxt='';
      try{
        const T=await loadTesseract();
        if(T){
          const nOcr=Math.min(pdf.numPages,10);
          for(let i=1;i<=nOcr;i++){
            const page=await pdf.getPage(i);
            const vp=page.getViewport({scale:4});
            const canvas=document.createElement('canvas');canvas.width=vp.width;canvas.height=vp.height;
            const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
            await page.render({canvasContext:ctx,viewport:vp}).promise;
            const prep=ocrPreprocess(canvas);
            const r1=await T.recognize(prep,'eng',{tessedit_pageseg_mode:'3',tessedit_ocr_engine_mode:'1',user_defined_dpi:'288'});
            const r2=await T.recognize(prep,'eng',{tessedit_pageseg_mode:'6',tessedit_ocr_engine_mode:'1',user_defined_dpi:'288'});
            const r3=await T.recognize(prep,'eng',{tessedit_pageseg_mode:'11',tessedit_ocr_engine_mode:'1',user_defined_dpi:'288'});
            ocrTxt+=((r1&&r1.data&&r1.data.text)||'')+' '+((r2&&r2.data&&r2.data.text)||'')+' '+((r3&&r3.data&&r3.data.text)||'')+' ';
          }
        }
      }catch(e){console.warn('pdf ocr pass failed',e);}
      // Combine both — font text + image text — for maximum coverage
      const combined=(layerTxt+' '+ocrTxt)
        .replace(/(\d),(?=\d)/g,'$1')
        .replace(/\s+/g,' ').trim();
      return combined.slice(0,400000)||null;
    }
    if(['xlsx','xls','ods'].includes(ext)){
      const XL=await loadXLSX();if(!XL)return null;
      const buf=await file.arrayBuffer();
      const wb=XL.read(buf,{type:'array'});
      let txt='';
      wb.SheetNames.forEach(sn=>{
        const ws=wb.Sheets[sn];
        const rows=XL.utils.sheet_to_json(ws,{header:1,defval:''});
        rows.forEach(row=>{txt+=row.filter(Boolean).join(' ')+' ';});
        txt+=' ';
      });
      return txt.replace(/\s+/g,' ').trim().slice(0,400000)||null;
    }
    if(['docx','docm'].includes(ext)){
      const JZ=await loadJSZip();if(!JZ)return null;
      const buf=await file.arrayBuffer();
      const zip=await JZ.loadAsync(buf);
      const xmlFile=zip.files['word/document.xml'];
      if(!xmlFile)return null;
      const xml=await xmlFile.async('string');
      // Strip XML tags, decode common entities, collapse whitespace
      const txt=xml
        .replace(/<w:p[ >]/g,' ')
        .replace(/<[^>]+>/g,'')
        .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').replace(/&#x[0-9A-Fa-f]+;/g,' ')
        .replace(/\s+/g,' ').trim();
      return txt.slice(0,400000)||null;
    }
    if(['pptx','pptm'].includes(ext)){
      const JZ=await loadJSZip();if(!JZ)return null;
      const buf=await file.arrayBuffer();
      const zip=await JZ.loadAsync(buf);
      let txt='';
      const slideFiles=Object.keys(zip.files).filter(n=>n.match(/^ppt\/slides\/slide\d+\.xml$/));
      for(const sf of slideFiles){
        const xml=await zip.files[sf].async('string');
        txt+=xml.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()+' ';
      }
      return txt.slice(0,400000)||null;
    }
  }catch(e){console.warn('text extract failed',e);}
  return null;
}
async function extractUrlText(url,fileType){
  try{const r=await fetch(url);const blob=await r.blob();const f=new File([blob],'f.'+(fileType||'pdf'));return await extractFileText(f);}catch(e){console.warn(e);return null;}
}
async function docSignedUrlFor(d,seconds){
  if(isS3Path(d.storage_path)){const {data,error}=await s3Sign('get',d.storage_path.slice(3));if(error)return {error};return {data:{signedUrl:data.url}};}
  return sb.storage.from(bucketFor(d.department)).createSignedUrl(d.storage_path,seconds);
}
// File types the Gemini OCR edge function handles (scanned PDFs & images — the Legal case).
// Everything else (docx/xlsx/pptx/txt) still uses the client-side extractor below.
const DOC_GEMINI_TYPES=['pdf','png','jpg','jpeg','webp','heic','heif'];
function docFileExt(d){return (d.file_type||(d.file_name||'').split('.').pop()||'').toLowerCase();}
// Server-side OCR/text extraction via Gemini. Returns {ok,chars} | {skip} | {error}.
async function docOcrGemini(id){
  const {data:{session}}=await sb.auth.getSession();
  const token=session&&session.access_token;
  try{
    const res=await fetch(SUPABASE_URL+'/functions/v1/document-ocr',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},body:JSON.stringify({action:'ocr',id:id})});
    return await res.json();
  }catch(e){return {error:String(e)};}
}
// Index one document into content_text: Gemini for scans/images, client-side reader otherwise.
async function docIndexOne(d){
  const ext=docFileExt(d);
  if(DOC_GEMINI_TYPES.includes(ext)){
    const out=await docOcrGemini(d.id);
    if(out&&out.ok)return out.chars?true:false;      // done (true if any text found)
    if(!(out&&out.skip))return false;                 // hard error — skip (re-runnable later)
    // out.skip -> fall through to the client-side reader
  }
  const {data,error}=await docSignedUrlFor(d,300);
  if(error)return false;
  const txt=await extractUrlText(data.signedUrl,d.file_type);
  if(txt==null)return false;
  await sb.schema('doc').from('documents').update({content_text:txt}).eq('id',d.id);
  return true;
}
window.docReindex=async function(id){
  const d=await getDoc(id);if(!d)return;
  if(!d.storage_path){toast(d.link?'Linked intranet files cannot be content-indexed':'No file to index','');return;}
  toast('Reading the text inside this file…','');
  const ok=await docIndexOne(d);
  toast(ok?'Indexed — words inside the file are now searchable':'Could not read text from this file.',ok?'ok':'err');
  const host=$('docTableHost');if(host)docRenderTable(host,DOC.dept||undefined);
};
window.docReindexAll=async function(dept){
  const all=await docFetch({dept:dept||undefined,extraNonLegal:!dept,full:true});
  const toIndex=all.filter(d=>d.storage_path&&(!d.content_text||d.content_text.length<200));
  if(!toIndex.length){toast('All files already indexed','ok');return;}
  const total=toIndex.length;
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-wand-magic-sparkles"></i> Indexing files for search</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body"><p style="font-size:13px;color:var(--slate);margin:0 0 12px">Reading the text inside <b>'+total+'</b> file(s) with AI (Gemini) so words <i>inside</i> them become searchable — scanned/unclear legal documents included. This can take a while for large batches; keep this window open.</p>'
    +'<div class="psa-progress"><div class="psa-progress-bar"><div class="psa-progress-fill" id="docIdxFill" style="width:0%"></div></div><div class="psa-progress-label" id="docIdxLbl">Starting…</div></div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>','md');
  let done=0,failed=0,idx=0;
  const paint=function(){const p=Math.round((done+failed)/total*100);const f=$('docIdxFill');if(f)f.style.width=p+'%';const l=$('docIdxLbl');if(l)l.textContent='Processed '+(done+failed)+' of '+total+' · '+done+' indexed'+(failed?', '+failed+' skipped':'');};
  paint();
  const worker=async function(){
    while(idx<toIndex.length){
      const d=toIndex[idx++];
      try{ if(await docIndexOne(d))done++; else failed++; }catch(e){ failed++; }
      paint();
    }
  };
  const K=Math.min(4,toIndex.length);
  await Promise.all(Array.from({length:K},function(){return worker();}));
  const l=$('docIdxLbl');if(l)l.textContent='Done — '+done+' indexed'+(failed?', '+failed+' skipped (re-run to retry)':'');
  toast(done+' file(s) indexed'+(failed?' · '+failed+' skipped':''),'ok');
  // Refresh the table in place — don't call route() which resets the search
  const host=$('docTableHost');
  if(host)docRenderTable(host,DOC.dept||undefined);
};
window.docUploadSave=async function(){
  const files=[...$('upFile').files];if(!files.length){toast('Select at least one file','err');return;}
  const dept=$('upDept').value,ver=$('upVer').value||'v1',desc=$('upDesc').value,vis=$('upVis').value,status=$('upStatus').value,conf=$('upConf').value==='true';
  let cat='',folderId=null,catSegs=null;
  if(dept==='Legal'){
    folderId=Number($('upFolderId').value);
    const list=await legalFolderTree();const {byId}=buildFolderTree(list);
    catSegs=folderPath(byId,folderId); // array of folder names, e.g. ['Dream Palazzo','History of Land / Chain'] — used for the S3 key
    cat=catSegs.join(' / '); // display string only — never re-split for S3 keys, a category name can itself contain '/'
  } else {
    cat=$('upCat').value;
  }
  const titleIns=[...document.querySelectorAll('.upTitleIn')];
  const btn=$('upBtn');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Uploading…';
  let ok=0;
  for(let idx=0;idx<files.length;idx++){const f=files[idx];
    const key=s3KeyForDoc(dept,dept==='Legal'?catSegs:cat,f.name);
    const pctEl=$('upBtn');
    const {data:upData,error:upErr}=await uploadFileToS3(key,f,pct=>{
      if(pctEl)pctEl.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Uploading '+pct+'%…';
    });
    if(upErr){toast('Upload failed: '+upErr.message,'err');continue;}
    const ti=titleIns.find(x=>x.dataset.i==idx);
    const title=(ti&&ti.value.trim())||f.name.replace(/\.[^.]+$/,'');
    const fileExt=(f.name.split('.').pop()||'').toLowerCase();
    const useGemini=DOC_GEMINI_TYPES.includes(fileExt); // scanned PDFs / images -> strong Gemini OCR (server-side)
    let ctext=null;
    if(!useGemini){ btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Reading & indexing…'; ctext=await extractFileText(f); }
    btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
    const {data:insData,error}=await sb.schema('doc').from('documents').insert({title,department:dept,category:cat,folder_id:folderId,description:desc,version:ver,tags:'',visibility:vis,status,confidential:conf,file_name:f.name,file_size:f.size,file_type:fileExt,storage_path:upData.path,content_text:ctext,uploaded_by:state.email}).select('id').single();
    if(error){toast('Saved file but metadata failed: '+error.message,'err');}
    // Auto-index scanned/image uploads with Gemini in the background — no "Index All" needed, search just works.
    else { ok++; if(useGemini&&insData&&insData.id){ docOcrGemini(insData.id); } }
  }
  closeModal();if(ok)toast(ok+' document'+(ok>1?'s':'')+' uploaded to S3','ok');route();
};

/* ---------- LEGAL module (dedicated DMS, hierarchical category tree) ---------- */
/* HOW MUCH OF THE ARCHIVE IS SEARCHABLE.
   Reading a document means Gemini extracting its text, and until that has happened the file can be
   found by its NAME but nothing inside it can be searched - so "1,349 documents" and "1,349
   searchable documents" are very different claims. This says which is true, per section, because
   Litigation and Projects are at completely different stages.
   Counted by the same rule the OCR job selects work with, so the bar and the job can never
   disagree. Word and Excel files are left out of the total as well as the backlog - OCR reads PDFs
   and images, so counting files it will never open would leave this permanently short of 100% and
   looking stuck. */
async function legalOcrBarPaint(){
  const host=document.getElementById('legalOcrBar'); if(!host) return;
  let rows=[];
  try{ const {data}=await sb.schema('doc').rpc('legal_ocr_progress'); rows=data||[]; }catch(_e){ return; }
  const all=rows.filter(r=>r.section==='All Legal')[0];
  if(!all||!all.total) { host.innerHTML=''; return; }
  const parts=rows.filter(r=>r.section!=='All Legal')
    .sort((a,b)=>a.section<b.section?-1:1)
    .map(r=>{
      const pct=r.total?Math.round(100*r.done/r.total):0;
      return '<div style="flex:1;min-width:190px">'
        +'<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">'
          +'<span style="font-weight:600">'+esc(r.section)+'</span>'
          +'<span style="color:var(--slate)">'+r.done+' of '+r.total+'</span></div>'
        +'<div style="height:6px;background:#e2e8f0;border-radius:999px;overflow:hidden">'
          +'<div style="height:100%;width:'+pct+'%;background:'+(pct>=100?'#16a34a':'#2563eb')+'"></div></div>'
        +'<div style="font-size:11px;color:var(--slate);margin-top:3px">'
          +(r.remaining?(r.remaining+' still to read'):'all read')
          +(r.unreadable?(' · '+r.unreadable+' could not be read'):'')+'</div>'
      +'</div>';
    }).join('');
  const pctAll=Math.round(100*all.done/all.total);
  host.innerHTML='<div style="border:1px solid var(--line,#e2e8f0);border-radius:10px;padding:13px 15px;margin:14px 0;background:var(--bg-card,#fff)">'
    +'<div style="display:flex;align-items:baseline;gap:9px;margin-bottom:11px;flex-wrap:wrap">'
      +'<b style="font-size:13px"><i class="fa-solid fa-magnifying-glass-chart" style="color:#1e3a8a"></i> Searchable text</b>'
      +'<span style="font-size:12px;color:var(--slate)">'
        +all.done+' of '+all.total+' documents read ('+pctAll+'%)'
        +(all.remaining?(' \u00b7 '+all.remaining+' still to go'):' \u00b7 complete')
        /* A scan Gemini cannot get text out of is retired after three tries and counted here.
           Left unsaid, the figure sits just short of complete for ever and reads as a stalled job. */
        +(all.unreadable?(' \u00b7 '+all.unreadable+' unreadable'):'')+'</span>'
      +'<button class="btn-sm" style="margin-left:auto" onclick="legalOcrBarPaint()">'
        +'<i class="fa-solid fa-rotate"></i> Refresh</button>'
    +'</div>'
    +'<div style="display:flex;gap:18px;flex-wrap:wrap">'+parts+'</div>'
    +(all.remaining?('<div style="font-size:11px;color:var(--slate);margin-top:9px">'
        +'Reading runs in the background, a few documents at a time. Until a document is read you '
        +'can find it by name, but not by what is written inside it.</div>'):'')
  +'</div>';
}
window.legalOcrBarPaint=legalOcrBarPaint;
VIEWS.legal=async function(v,seg){
  const known={mis:1,scoreboard:1,actions:1,advocates:1,causelist:1};
  const tab=known[seg[0]]?seg[0]:'docs';
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-scale-balanced" style="color:#1e3a8a"></i> Legal</h1><p>Document vault and litigation MIS for the Legal department</p></div>
    <div id="legalHeadActions" style="display:flex;gap:10px;flex-wrap:wrap"></div></div>
    <div class="tabs">
      <div class="tab ${tab==='docs'?'active':''}" onclick="navTo('legal')"><i class="fa-solid fa-folder-open"></i> Documents</div>
      <div class="tab ${tab==='mis'?'active':''}" onclick="navTo('legal/mis')"><i class="fa-solid fa-gavel"></i> MIS</div>
      <div class="tab ${tab==='actions'?'active':''}" onclick="navTo('legal/actions')"><i class="fa-solid fa-list-check"></i> Actions</div>
      <div class="tab ${tab==='causelist'?'active':''}" onclick="navTo('legal/causelist')"><i class="fa-solid fa-clipboard-check"></i> Causelist Reviews</div>
      <div class="tab ${tab==='advocates'?'active':''}" onclick="navTo('legal/advocates')"><i class="fa-solid fa-user-tie"></i> Advocates</div>
      <div class="tab ${tab==='scoreboard'?'active':''}" onclick="navTo('legal/scoreboard')"><i class="fa-solid fa-ranking-star"></i> Scoreboard</div>
    </div>
    <div id="legalOcrBar"></div>
    <div id="legalBody"><div class="loader"><div class="spin"></div></div></div>`;
  legalOcrBarPaint();
  if(tab==='mis') legalMIS();
  else if(tab==='scoreboard') legalScoreboard();
  else if(tab==='actions') legalActions();
  else if(tab==='causelist') legalCauselistReviews();
  else if(tab==='advocates') legalAdvocates();
  else legalDocsView(seg);
};
async function legalDocsView(seg){
  DOC.scope='legal';DOC.dept='Legal';DOC.sel.clear();
  DOC.cat=(seg[0]==='cat')?decodeURIComponent(seg[1]):null;
  /* Opening the Documents tab itself shows the tree closed. Which branches were expanded is
     remembered for the life of the page, so after visiting a category — or being sent to one by
     the Documents button in MIS — coming back to the tab left it hanging open with no way to
     collapse it, since the tree only reopens the path to whatever is selected. */
  if(!DOC.cat) DOC.legalExpanded.clear();
  let crumbTail='All Documents';
  if(DOC.cat){
    const list=await legalFolderTree();const {byId}=buildFolderTree(list);
    const path=folderPath(byId,Number(DOC.cat));
    if(path.length)crumbTail=path.join(' / ');
  }
  setCrumb(['Legal',crumbTail]);
  const hAct=$('legalHeadActions');
  if(hAct)hAct.innerHTML=`<button class="btn btn-primary" onclick="docUploadModal('Legal')"><i class="fa-solid fa-upload"></i> Upload</button>`;
  const body=$('legalBody');if(!body)return;
  body.innerHTML=`<div class="split"><div><div class="subnav" id="legalNav"></div></div><div><div id="docTableHost"></div></div></div>`;
  legalNav();
  docRenderTable($('docTableHost'),'Legal');
}
async function legalNav(reuse){
  // Counts + folder list used to be re-fetched (all ~hundreds of Legal docs) on EVERY expand/collapse
  // — that was the slow part. Cache them and reuse on toggle; a full navigation to the page (or an
  // upload/move/delete, which re-routes) refetches fresh.
  if(!(reuse && window._legalNavData)){
    /* The folder list does not depend on the document list, so both go out at once. Sequentially
       this was two trips to Mumbai, about 65ms each; now it is one. Promise.all is what actually
       sends them together - a Supabase builder does nothing until something calls .then() on it. */
    const [allF,listF]=await Promise.all([docFetch({dept:'Legal'}), legalFolderTree()]);
    window._legalNavData={all:allF,list:listF};
  }
  const all=window._legalNavData.all;
  const counts={};all.forEach(d=>{if(d.folder_id)counts[d.folder_id]=(counts[d.folder_id]||0)+1;});
  const list=window._legalNavData.list;
  const {roots,byId}=buildFolderTree(list);
  // Totals = own direct document count + every descendant's count, recomputed on
  // every render so parent folders ("Projects", "Dream Apartment", etc.) show the
  // combined count of everything nested under them, not just documents attached
  // directly to that folder (which is normally zero for non-leaf folders).
  const totals={};
  const sumNode=node=>{let n=counts[node.id]||0;node.children.forEach(c=>{n+=sumNode(c);});totals[node.id]=n;return n;};
  roots.forEach(sumNode);
  /* Open the path down to whichever category is selected — but only when arriving at it, never on
     a redraw. Doing it every time meant a selected category's parents were forced back open the
     instant you collapsed them: the caret worked, the tree redrew, and the auto-expand put them
     straight back. Now the path opens once per selection and stays under your control after that. */
  if(DOC.cat && !reuse && window._legalOpenedFor!==String(DOC.cat)){
    window._legalOpenedFor=String(DOC.cat);
    let cur=byId[Number(DOC.cat)];
    while(cur&&cur.parent_id){DOC.legalExpanded.add(cur.parent_id);cur=byId[cur.parent_id];}
  }
  if(!DOC.cat) window._legalOpenedFor=null;
  const renderNode=(node,depth)=>{
    const hasKids=node.children.length>0;
    const expanded=DOC.legalExpanded.has(node.id);
    const active=DOC.cat&&Number(DOC.cat)===node.id;
    const caret=hasKids?`<i class="fa-solid fa-chevron-${expanded?'down':'right'} sn-caret" onclick="event.stopPropagation();legalToggleExpand(${node.id})"></i>`:`<i class="fa-regular fa-folder sn-caret-spacer"></i>`;
    const kids=hasKids&&expanded?`<div class="sn-children">${node.children.map(c=>renderNode(c,depth+1)).join('')}</div>`:'';
    return `<div class="sn-tree-node" style="margin-left:${depth*13}px">
      <div class="sn-item ${active?'active':''}" onclick="legalSelectCat(${node.id})">
        <span>${caret} ${esc(node.name)}</span>
        <span class="sn-actions"><span class="ct">${totals[node.id]||0}</span><i class="fa-solid fa-plus sn-add" title="Add category inside ${esc(node.name)}" onclick="event.stopPropagation();docNewFolder('Legal',${node.id},'${esc(node.name).replace(/'/g,"\\'")}')"></i></span>
      </div>
      ${kids}
    </div>`;
  };
  $('legalNav').innerHTML=`<div class="sn-title">Categories</div>`+
    `<div class="sn-item ${!DOC.cat?'active':''}" onclick="location.hash='#/legal'"><span><i class="fa-solid fa-layer-group"></i> All Documents</span><span class="ct">${all.length}</span></div>`+
    `<div class="sn-tree">${roots.map(r=>renderNode(r,0)).join('')}</div>`+
    `<div class="sn-item" style="color:var(--brand)" onclick="docNewFolder('Legal',null,null)"><span><i class="fa-solid fa-plus"></i> Add main folder</span></div>`;
}
window.legalToggleExpand=function(id){if(DOC.legalExpanded.has(id))DOC.legalExpanded.delete(id);else DOC.legalExpanded.add(id);legalNav(true);};
window.legalSelectCat=function(id){location.hash='#/legal/cat/'+id;};

