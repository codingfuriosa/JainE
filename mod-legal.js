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
    const allF=await docFetch({dept:'Legal'});
    const listF=await legalFolderTree();
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

/* ============================ LEGAL MIS ============================ */
/* Hearing-date window. Filters the table by Next Date and is what the causelist export
   uses — the export refuses to run on "All dates", since a causelist is by definition
   for a period. */
// [value, label, icon] — a native <select> can't carry icons, so this feeds a custom menu.
async function legalActions(){
  setCrumb(['Legal','Actions']);
  const hAct=$('legalHeadActions'); if(hAct)hAct.innerHTML='';
  const body=$('legalBody'); if(!body)return;
  loader(body);
  let rows=[];
  try{
    const {data}=await sb.from('mis_actions').select('*').order('executed_date_iso',{ascending:true,nullsFirst:true}).order('action_date_iso',{ascending:true});
    rows=data||[];
  }catch(e){}
  let cases=[];
  try{ const {data}=await sb.from('mis_cases').select('id,cause_title,case_no,case_type'); cases=data||[]; }catch(e){}
  const byCase={}; cases.forEach(c=>{byCase[c.id]=c;});
  const nameOfCase=id=>{const c=byCase[id];if(!c)return '—';return (c.cause_title||c.case_no||('Case '+id));};
  window._misActionRows=rows.map(r=>Object.assign({},r,{_case:nameOfCase(r.case_id)}));
  const open=rows.filter(r=>!r.executed_date_iso).length;
  body.innerHTML=`<style>
    .act-bar{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-bottom:13px}
    .act-search{position:relative;flex:1;min-width:180px;display:flex;align-items:center}
    .act-search i{position:absolute;left:11px;color:var(--slate);font-size:12.5px;pointer-events:none}
    .act-search input{width:100%;height:38px;padding:0 12px 0 32px;border:1px solid var(--line);border-radius:9px;font-size:13px;font-family:inherit;background:var(--bg-card);color:var(--ink)}
    .act-search input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10)}
    .act-sel{height:38px;padding:0 34px 0 13px;border:1px solid var(--line);border-radius:9px;font-size:13px;
      font-weight:600;font-family:inherit;background:var(--bg-card);color:var(--ink);cursor:pointer;
      appearance:none;-webkit-appearance:none;transition:border-color .12s,box-shadow .12s;
      background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%231e3a8a' stroke-width='2' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
      background-repeat:no-repeat;background-position:right 12px center;background-size:11px 8px}
    .act-sel:hover{border-color:var(--slate)}
    .act-sel:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10)}
    @media(max-width:760px){.act-search,.act-sel{flex:1 1 100%}}
    #actTbl{width:100%;border-collapse:collapse;font-size:13px}
    #actTbl th{text-align:left;padding:10px 12px;background:var(--bg-subtle,#f8fafc);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--slate);border-bottom:2px solid var(--line);white-space:nowrap}
    #actTbl td{padding:10px 12px;border-bottom:1px solid var(--line-2);vertical-align:top}
    @media(max-width:760px){#actTbl{min-width:640px}}
  </style>
  <div class="act-bar">
    <div class="act-search"><i class="fa-solid fa-magnifying-glass"></i><input id="actQ" placeholder="Search action, case or date…" oninput="legalActionsFilter()"></div>
    <select class="act-sel" id="actState" onchange="legalActionsFilter()">
      <option value="all">All actions (${rows.length})</option>
      <option value="open">Still open (${open})</option>
      <option value="done">Executed (${rows.length-open})</option>
    </select>
  </div>
  <div class="card" style="overflow:hidden"><div style="overflow-x:auto">
    <table id="actTbl"><thead><tr>
      <th>Action</th><th>Action Date</th><th>Executed Date</th><th>Case</th><th>Remarks</th>
    </tr></thead><tbody id="actBody"></tbody></table>
  </div></div>
  <div class="empty" id="actEmpty" style="padding:34px;display:none"><i class="fa-regular fa-square-check"></i><div>Nothing here.</div>
    <div style="font-size:12.5px;color:var(--slate);margin-top:6px">Actions are raised from the MIS tab — click a case to add one.</div></div>`;
  legalActionsFilter();
}
window.legalActionsFilter=function(){
  const rows=window._misActionRows||[];
  const q=(($('actQ')||{}).value||'').trim().toLowerCase();
  const st=(($('actState')||{}).value)||'all';
  const list=rows.filter(r=>{
    if(st==='open'&&r.executed_date_iso) return false;
    if(st==='done'&&!r.executed_date_iso) return false;
    if(!q) return true;
    return [r.action_needed,r.action_date,r.executed_date,r._case,r.remarks].filter(Boolean).join(' ').toLowerCase().indexOf(q)!==-1;
  });
  const tb=$('actBody'); if(!tb)return;
  tb.innerHTML=list.map(r=>'<tr>'
    +'<td><b class="lg-clamp" title="'+esc(r.action_needed||'')+'">'+esc(r.action_needed||'—')+'</b></td>'
    +'<td style="white-space:nowrap">'+esc(r.action_date||'—')+'</td>'
    +'<td style="white-space:nowrap">'+(r.executed_date
        ?('<span class="mis-ptag mis-ptag--green">'+esc(r.executed_date)+'</span>')
        :'<span class="mis-ptag mis-ptag--amber">Open</span>')+'</td>'
    +'<td><span class="lg-clamp" title="'+esc(r._case||'')+'">'+esc(r._case||'—')+'</span></td>'
    +'<td style="color:var(--slate)"><span class="lg-clamp" title="'+esc(r.remarks||'')+'">'+esc(r.remarks||'')+'</span></td>'
  +'</tr>').join('');
  const em=$('actEmpty'); if(em)em.style.display=list.length?'none':'';
  usageQueueDebounced('legal.actions.view_search_filter_case_actions', q);
};

/* ---------- Causelist Reviews -----------------------------------------------------------------
   Where the causelist action-review popup's decisions actually live once made - not just today's
   snapshot on mis_cases (pending/answered/who), but the full history from
   mis_causelist_review_log: every export claim, every answer, every time someone closed the popup
   without answering. Also the on-demand way back into it: the toolbar nudge in legalMIS() covers
   "I have some to answer"; this covers "let me see all of them, and who else does too". Sourced
   from the log table itself (a case appears here iff it has at least one log row) rather than a
   field-presence filter on mis_cases, so this and the log agree by construction. */
function clrevDT(iso){ if(!iso) return '—'; const d=new Date(iso); if(isNaN(d)) return String(iso);
  return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear()
    +', '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
async function legalCauselistReviews(){
  setCrumb(['Legal','Causelist Reviews']);
  const hAct=$('legalHeadActions'); if(hAct)hAct.innerHTML='';
  const body=$('legalBody'); if(!body)return;
  loader(body);
  try{ await getPeople(); }catch(e){}
  try{ await clrevLoadLegal(); }catch(e){}   // populates window._clrevLegal for the inline person picker below
  let logs=[], cases=[];
  try{ const {data}=await sb.from('mis_causelist_review_log').select('*').order('created_at',{ascending:true}); logs=data||[]; }catch(e){}
  const ids=Array.from(new Set(logs.map(function(l){return l.case_id;})));
  if(ids.length){
    try{
      // The date fields are needed for misHearingIso() when an inline answer creates a task -
      // the narrower column set used before was fine for display but left the task description's
      // hearing date blank.
      const {data}=await sb.from('mis_cases').select('id,case_no,case_type,cause_title,court,'
        +'causelist_pending_by,causelist_reviewed_at,causelist_action_needed,causelist_reviewed_by,'
        +'case_next_date_iso,case_next_date,next_date_iso,next_date').in('id',ids);
      cases=data||[];
    }catch(e){}
  }
  const byCase={};
  logs.forEach(function(l){ (byCase[l.case_id]=byCase[l.case_id]||[]).push(l); });
  const rows=cases.map(function(c){
    const hist=byCase[c.id]||[];
    // The most recent DECISION (first answer or any later edit of it) - this is what the Due /
    // Responsible cells show, and where an edit reads the previous task id from.
    const decisions=hist.filter(function(l){return l.event==='answered'||l.event==='edited';});
    const closes=hist.filter(function(l){return l.event==='closed_without_answering';}).length;
    return Object.assign({}, c, {_hist:hist, _lastAnswered:decisions[decisions.length-1]||null,
      _closes:closes, _pending:!!c.causelist_pending_by && !c.causelist_reviewed_at});
  }).sort(function(a,b){
    // Pending first (soonest claimed first among those), then most recently answered.
    if(a._pending!==b._pending) return a._pending?-1:1;
    return String((b.causelist_reviewed_at||b._hist[0]&&b._hist[0].created_at)||'').localeCompare(String((a.causelist_reviewed_at||a._hist[0]&&a._hist[0].created_at)||''));
  });
  window._clrevReviewRows=rows;
  const pendingCount=rows.filter(function(r){return r._pending;}).length;
  body.innerHTML=`<style>
    .crv-bar{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-bottom:13px}
    .crv-search{position:relative;flex:1;min-width:180px;display:flex;align-items:center}
    .crv-search i{position:absolute;left:11px;color:var(--slate);font-size:12.5px;pointer-events:none}
    .crv-search input{width:100%;height:38px;padding:0 12px 0 32px;border:1px solid var(--line);border-radius:9px;font-size:13px;font-family:inherit;background:var(--bg-card);color:var(--ink)}
    .crv-search input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10)}
    .crv-sel{height:38px;padding:0 34px 0 13px;border:1px solid var(--line);border-radius:9px;font-size:13px;
      font-weight:600;font-family:inherit;background:var(--bg-card);color:var(--ink);cursor:pointer;
      appearance:none;-webkit-appearance:none;
      background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%231e3a8a' stroke-width='2' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
      background-repeat:no-repeat;background-position:right 12px center;background-size:11px 8px}
    @media(max-width:760px){.crv-search,.crv-sel{flex:1 1 100%}}
    #crvTbl{width:100%;border-collapse:collapse;font-size:13px}
    #crvTbl th{text-align:left;padding:10px 12px;background:var(--bg-subtle,#f8fafc);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--slate);border-bottom:2px solid var(--line);white-space:nowrap}
    #crvTbl td{padding:10px 12px;border-bottom:1px solid var(--line-2);vertical-align:top}
    /* Pending rows answer inline, right on the line item - no click-through, no popup. */
    .crv-seg{display:inline-flex;gap:4px;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:2px;margin-left:6px;vertical-align:middle}
    .crv-seg-btn{border:none;background:transparent;color:var(--slate);font-size:11.5px;font-weight:600;padding:4px 8px;border-radius:6px;cursor:pointer;white-space:nowrap}
    .crv-seg-btn:hover{color:var(--ink)}
    .crv-seg-btn.on{background:var(--card);color:var(--brand);box-shadow:var(--shadow)}
    .crv-inline-fields{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
    .crv-inline-fields input,.crv-inline-fields select{padding:5px 7px;border:1px solid var(--line);border-radius:6px;font-size:12.5px;color:var(--ink);background:var(--card)}
    @media(max-width:760px){#crvTbl{min-width:820px}}
  </style>
  <div class="crv-bar">
    <div class="crv-search"><i class="fa-solid fa-magnifying-glass"></i><input id="crvQ" placeholder="Search case, exporter or reviewer…" oninput="legalCauselistFilter()"></div>
    <select class="crv-sel" id="crvState" onchange="legalCauselistFilter()">
      <option value="all">All (${rows.length})</option>
      <option value="pending">Pending review (${pendingCount})</option>
      <option value="needed">Action needed (${rows.filter(function(r){return r.causelist_action_needed===true;}).length})</option>
      <option value="noaction">No action needed (${rows.filter(function(r){return r.causelist_action_needed===false;}).length})</option>
    </select>
  </div>
  <div class="card" style="overflow:hidden"><div style="overflow-x:auto">
    <table id="crvTbl"><thead><tr>
      <th>Case</th><th>Status</th><th>Pending with</th><th>Answered by</th><th>Due</th><th>Responsible</th>
    </tr></thead><tbody id="crvBody"></tbody></table>
  </div></div>
  <div class="empty" id="crvEmpty" style="padding:34px;display:none"><i class="fa-regular fa-square-check"></i><div>Nothing here yet.</div>
    <div style="font-size:12.5px;color:var(--slate);margin-top:6px">This fills in as causelists get exported from the MIS tab.</div></div>`;
  legalCauselistFilter();
}
// Answering a pending row - or EDITING an already-answered one - happens right on the line item: a
// segmented control in the Status cell, and (once "Action needed" is picked) a date input +
// Legal-person select in the Due cell, both live in window._crvEdit until Save. No popup, no
// click-through: every control needed is always visible on its own row.
//
// A row is "editable" either because it's genuinely still pending, or because Edit was explicitly
// clicked on an already-answered one (window._crvEditingIds). The two look the same but behave
// slightly differently: a fresh pending row's "No action" saves in one click since there's nothing
// to lose; an explicit edit always needs a deliberate Save, even for "No action", since that can
// delete an existing task.
window._crvEdit={};
window._crvEditingIds=new Set();
function crvGetEdit(id){ return window._crvEdit[id] || (window._crvEdit[id]={needed:null,due:'',person:''}); }
function crvEditable(r){ return r._pending || window._crvEditingIds.has(r.id); }
function crvIsExplicitEdit(r){ return !r._pending && window._crvEditingIds.has(r.id); }
function legalCauselistStatusPill(r){
  if(!crvEditable(r)){
    if(r.causelist_action_needed===true) return '<span class="mis-ptag mis-ptag--green">Action needed</span> '
      +'<a href="javascript:void(0)" onclick="legalCauselistOpenHistory('+r.id+')" style="font-size:12px;color:var(--slate)">History</a>'
      +' · <a href="javascript:void(0)" onclick="legalCauselistEditStart('+r.id+')" style="font-size:12px">Edit</a>';
    if(r.causelist_action_needed===false) return '<span class="mis-ptag">No action needed</span> '
      +'<a href="javascript:void(0)" onclick="legalCauselistOpenHistory('+r.id+')" style="font-size:12px;color:var(--slate)">History</a>'
      +' · <a href="javascript:void(0)" onclick="legalCauselistEditStart('+r.id+')" style="font-size:12px">Edit</a>';
    return '—';
  }
  const e=crvGetEdit(r.id);
  return '<span class="mis-ptag mis-ptag--amber">'+(r._pending?'Pending':'Editing')+'</span>'
    +'<span class="crv-seg">'
      +'<button type="button" class="crv-seg-btn'+(e.needed===true?' on':'')+'" onclick="crvSetNeeded('+r.id+',true)"><i class="fa-solid fa-flag"></i> Action needed</button>'
      +'<button type="button" class="crv-seg-btn'+(e.needed===false?' on':'')+'" onclick="crvSetNeeded('+r.id+',false)"><i class="fa-solid fa-check"></i> No action</button>'
    +'</span>'
    +((r._hist||[]).length?' <a href="javascript:void(0)" onclick="legalCauselistOpenHistory('+r.id+')" style="font-size:12px;color:var(--slate)">History</a>':'')
    +(crvIsExplicitEdit(r)?' <a href="javascript:void(0)" onclick="legalCauselistEditCancel('+r.id+')" style="font-size:12px;color:var(--slate)">Cancel</a>':'');
}
function crvDueCellHtml(r){
  if(!crvEditable(r)){
    // Assigned person lives in its own Responsible column now (crvResponsibleName) - just the date here.
    const detail=(r._lastAnswered&&r._lastAnswered.detail)||{};
    return (r.causelist_action_needed===true) ? esc(detail.due?clrevDmy(detail.due):'—') : '—';
  }
  const e=crvGetEdit(r.id);
  if(e.needed===null) return '—';
  if(e.needed!==true){
    // Explicit edit landing on "No action" still needs a deliberate Save - a fresh pending row
    // never reaches this branch, since crvSetNeeded already saved it and left edit mode.
    return crvIsExplicitEdit(r)
      ? '<div class="crv-inline-fields">—&nbsp;<button type="button" class="btn btn-primary" id="crvSaveBtn_'+r.id+'" style="padding:5px 10px;font-size:12px" onclick="crvSaveInline('+r.id+')">Save</button></div>'
      : '—';
  }
  const legal=window._clrevLegal||[];
  const opts='<option value="">— choose —</option>'+legal.map(function(p){
    return '<option value="'+esc(p.email)+'"'+(e.person===p.email?' selected':'')+'>'+esc(p.name)+'</option>'; }).join('');
  const hearing=misHearingIso(r);
  return '<div class="crv-inline-fields">'
    +'<input type="date" id="crvDue_'+r.id+'" value="'+esc(e.due||'')+'"'+(hearing?' max="'+esc(hearing)+'"':'')+' title="'+(hearing?'On or before the '+esc(clrevDmy(hearing))+' hearing':'')+'" onchange="crvFieldChange('+r.id+')">'
    +'<select id="crvPerson_'+r.id+'" onchange="crvFieldChange('+r.id+')">'+opts+'</select>'
    +'<button type="button" class="btn btn-primary" id="crvSaveBtn_'+r.id+'" style="padding:5px 10px;font-size:12px" onclick="crvSaveInline('+r.id+')" title="Save"><i class="fa-solid fa-check"></i></button>'
  +'</div>';
}
// Who's actually doing it, once a matter has been marked action-needed and saved. Blank for
// anything still pending (nobody's assigned yet) or answered as no-action (nobody needs to be).
function crvResponsibleName(r){
  const detail=(r._lastAnswered&&r._lastAnswered.detail)||{};
  return (r.causelist_action_needed===true && detail.person) ? esc(nameOf(detail.person)) : '—';
}
function crvRepaintRow(id){
  const r=(window._clrevReviewRows||[]).find(function(x){return x.id===id;}); if(!r) return;
  const st=$('crvStat_'+id); if(st) st.innerHTML=legalCauselistStatusPill(r);
  const da=$('crvDA_'+id); if(da) da.innerHTML=crvDueCellHtml(r);
}
window.legalCauselistEditStart=function(id){
  const r=(window._clrevReviewRows||[]).find(function(x){return x.id===id;}); if(!r) return;
  window._crvEditingIds.add(id);
  const detail=(r._lastAnswered&&r._lastAnswered.detail)||{};
  window._crvEdit[id]={needed:r.causelist_action_needed, due:detail.due||'', person:detail.person||''};
  crvRepaintRow(id);
};
window.legalCauselistEditCancel=function(id){
  window._crvEditingIds.delete(id);
  delete window._crvEdit[id];
  crvRepaintRow(id);
};
window.crvSetNeeded=function(id,val){
  const r=(window._clrevReviewRows||[]).find(function(x){return x.id===id;}); if(!r) return;
  const e=crvGetEdit(id);
  e.needed=val;
  // Fresh (not-yet-answered) "No action" still saves in one click - nothing at stake to lose.
  if(val===false && r._pending && !crvIsExplicitEdit(r)){ crvSaveInline(id); return; }
  crvRepaintRow(id);
};
window.crvFieldChange=function(id){
  const e=crvGetEdit(id), d=$('crvDue_'+id), p=$('crvPerson_'+id);
  const r=(window._clrevReviewRows||[]).find(function(x){return x.id===id;});
  const hearing=r?misHearingIso(r):null;
  if(d && clrevDueTooLate(d.value,hearing)){
    toast('Due date can\'t be after the '+clrevDmy(hearing)+' hearing — reset to that date','warn');
    d.value=hearing;
  }
  if(d) e.due=d.value||''; if(p) e.person=p.value||'';
};
window.crvSaveInline=async function(id){
  const r=(window._clrevReviewRows||[]).find(function(x){return x.id===id;});
  if(!r) return;
  const e=crvGetEdit(id);
  if(e.needed===null) return;
  if(e.needed===true){
    crvFieldChange(id);
    if(!e.due||!e.person){ toast('Pick a due date and a responsible person first','warn'); return; }
    if(clrevDueTooLate(e.due,misHearingIso(r))){ toast('Due date can\'t be after the '+clrevDmy(misHearingIso(r))+' hearing','warn'); return; }
  }
  const isEdit=!r._pending;
  const prevTaskId=(r._lastAnswered&&r._lastAnswered.detail&&r._lastAnswered.detail.task_id)||null;
  const btn=$('crvSaveBtn_'+id);
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>'; }
  try{
    await clrevSaveOneRow({id:r.id, case_no:r.case_no, cause_title:r.cause_title, court:r.court,
      hearing:misHearingIso(r), needed:e.needed, due:e.due, person:e.person}, {prevTaskId:prevTaskId, isEdit:isEdit});
  }catch(err){
    toast('Could not save: '+((err&&err.message)||err),'err');
    if(btn){ btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-check"></i>'; }
    return;
  }
  window._crvEditingIds.delete(id);
  delete window._crvEdit[id];
  toast(isEdit?'Updated':'Saved','ok');
  legalCauselistReviews();
};
window.legalCauselistFilter=function(){
  const rows=window._clrevReviewRows||[];
  const q=(($('crvQ')||{}).value||'').trim().toLowerCase();
  const st=(($('crvState')||{}).value)||'all';
  const list=rows.filter(function(r){
    if(st==='pending'&&!r._pending) return false;
    if(st==='needed'&&r.causelist_action_needed!==true) return false;
    if(st==='noaction'&&r.causelist_action_needed!==false) return false;
    if(!q) return true;
    return [r.case_no,r.cause_title,r.causelist_pending_by,r.causelist_reviewed_by].filter(Boolean).join(' ').toLowerCase().indexOf(q)!==-1;
  });
  const tb=$('crvBody'); if(!tb)return;
  tb.innerHTML=list.map(function(r){
    return '<tr>'
      +'<td><b class="lg-clamp" title="'+esc(r.cause_title||'')+'">'+esc(r.case_no||('#'+r.id))+'</b>'
        +'<div style="color:var(--slate);font-size:12px" class="lg-clamp">'+esc(r.cause_title||'')+'</div></td>'
      +'<td id="crvStat_'+r.id+'">'+legalCauselistStatusPill(r)+'</td>'
      +'<td style="white-space:nowrap">'+(r.causelist_pending_by?esc(nameOf(r.causelist_pending_by)):'—')+'</td>'
      +'<td style="white-space:nowrap">'+(r.causelist_reviewed_by?(esc(nameOf(r.causelist_reviewed_by))+' · '+esc(clrevDmy(String(r.causelist_reviewed_at||'').slice(0,10)))):'—')+'</td>'
      +'<td id="crvDA_'+r.id+'">'+crvDueCellHtml(r)+'</td>'
      +'<td>'+crvResponsibleName(r)+'</td>'
    +'</tr>';
  }).join('');
  const em=$('crvEmpty'); if(em)em.style.display=list.length?'none':'';
};
window.legalCauselistOpenHistory=function(id){
  const r=(window._clrevReviewRows||[]).find(function(x){return x.id===id;});
  if(!r) return;
  const hist=r._hist||[];
  const rowsHtml=hist.length ? hist.map(function(l){
    let what='';
    if(l.event==='exported') what='Exported / claimed by '+esc(nameOf(l.actor));
    else if(l.event==='closed_without_answering') what='Closed the popup without answering — '+esc(nameOf(l.actor));
    else if(l.event==='answered'||l.event==='edited'){
      const d=l.detail||{}, verb=(l.event==='edited')?'Edited to':'Marked';
      what=d.needed
        ? verb+' <b>action needed</b> by '+esc(nameOf(l.actor))+' — due '+esc(d.due?clrevDmy(d.due):'—')+', assigned to '+esc(d.person?nameOf(d.person):'—')
        : verb+' <b>no action needed</b> by '+esc(nameOf(l.actor));
    }
    return '<div style="padding:9px 0;border-bottom:1px solid var(--line-2)"><div style="font-size:12px;color:var(--slate)">'+esc(clrevDT(l.created_at))+'</div><div>'+what+'</div></div>';
  }).join('') : '<div style="color:var(--slate);padding:14px 0">No history recorded.</div>';
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-clock-rotate-left"></i> '+esc(r.case_no||('Case '+r.id))+' — review history</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="width:min(94vw,560px);max-height:70vh;overflow:auto">'+rowsHtml+'</div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>','md');
};

/* ---------- Advocates ----------------------------------------------------------------------- */
function misActionScore(a){
  if(!a||!a.action_date_iso||!a.executed_date_iso)return null;
  const gap=Math.round((new Date(String(a.action_date_iso).slice(0,10)+'T00:00:00')-new Date(String(a.executed_date_iso).slice(0,10)+'T00:00:00'))/86400000);
  if(gap>7)return 1;
  if(gap>0)return 0;
  return -1;
}
/* The Scoreboard is paused while the action cycle beds in: it scored off action dates, and those
   have just been cleared for a fresh start, so any figure it showed now would be meaningless.
   The workings below are left intact - flip SCOREBOARD_LIVE back to true to bring it back. */
const SCOREBOARD_LIVE=false;
async function legalScoreboard(){
  setCrumb(['Legal','Scoreboard']);
  const hAct=$('legalHeadActions');if(hAct)hAct.innerHTML='';
  const body=$('legalBody');if(!body)return;
  if(!SCOREBOARD_LIVE){
    body.innerHTML='<div class="card card-pad" style="max-width:620px;margin:26px auto;text-align:center">'
      +'<div style="font-size:34px;color:#1e3a8a;margin-bottom:12px"><i class="fa-solid fa-ranking-star"></i></div>'
      +'<div style="font-weight:700;font-size:17px;margin-bottom:8px">Scoreboard — coming soon</div>'
      +'<p style="color:var(--slate);font-size:13.5px;line-height:1.6;margin:0">'
      +'It scores each case on how much notice an action was given before its date. The action log has '
      +'just been cleared for a fresh start, so there is nothing meaningful to score yet — it will come '
      +'back once actions have been running for a while.</p>'
      +'<div style="margin-top:16px"><button class="btn" onclick="navTo(\'legal/mis\')"><i class="fa-solid fa-gavel"></i> Go to MIS</button></div>'
    +'</div>';
    return;
  }
  loader(body);
  let cases=[], actions=[];
  try{
    const {data:cd,error:ce}=await sb.from('mis_cases').select('id,case_type,cause_title,case_no,priority,completed_at'); if(ce)throw ce; cases=cd||[];
    const {data:ad}=await sb.from('mis_actions').select('case_id,action_date_iso,executed_date_iso'); actions=ad||[];
  }catch(e){toast((e&&e.message)||'Could not load Scoreboard','err');}
  // Every case with actions is scored (completed cases stay on the Scoreboard, keeping their score);
  // each case aggregates the scores of its executed actions.
  const byCase={};
  cases.forEach(c=>{ byCase[c.id]={c:c,total:0,scored:0,count:0}; });
  actions.forEach(a=>{ const g=byCase[a.case_id]; if(!g)return; g.count++; const s=misActionScore(a); if(s!==null){ g.total+=s; g.scored++; } });
  const list=Object.values(byCase).filter(g=>g.count>0).sort((a,b)=>(b.total-a.total)||(b.scored-a.scored));
  const grand=list.reduce((a,g)=>a+g.total,0);
  const totalScored=list.reduce((a,g)=>a+g.scored,0);
  const scoreCell=n=>{const col=n>0?'#16a34a':(n<0?'#dc2626':'#64748b');return `<span style="font-weight:800;color:${col}">${n>0?'+':''}${n}</span>`;};
  body.innerHTML=`<div class="card" style="overflow:hidden"><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="background:var(--bg-subtle,#f8fafc)">
      ${['Case Type','Cause Title / Parties','Case No.','Priority','Actions','Score'].map(l=>`<th style="padding:10px 12px;text-align:left;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--slate);border-bottom:2px solid var(--line)">${esc(l)}</th>`).join('')}
    </tr></thead>
    <tbody>
      ${list.length?list.map(g=>{
        const r=g.c;
        return `<tr style="border-bottom:1px solid var(--line-2)">
          <td style="padding:11px 12px;font-weight:600">${esc(r.case_type||'—')}</td>
          <td style="padding:11px 12px">${esc(r.cause_title||'—')}${r.completed_at?' <span style="font-size:10px;font-weight:700;color:#16a34a;background:#dcfce7;padding:2px 7px;border-radius:99px;white-space:nowrap">✓ Completed</span>':''}</td>
          <td style="padding:11px 12px;color:var(--slate)">${esc(r.case_no||'—')}</td>
          <td style="padding:11px 12px">${misPriorityTag(r.priority)}</td>
          <td style="padding:11px 12px;color:var(--slate)">${g.scored} of ${g.count} scored</td>
          <td style="padding:11px 12px">${scoreCell(g.total)}</td>
        </tr>`;
      }).join(''):`<tr><td colspan="6"><div class="empty" style="padding:30px"><i class="fa-regular fa-calendar-check"></i><div>No scored cases yet — score comes from executed actions (Action Date vs Execution Date).</div></div></td></tr>`}
    </tbody>
    ${list.length?`<tfoot><tr style="background:var(--bg-subtle,#f8fafc)">
      <td colspan="5" style="padding:11px 12px;text-align:right;font-weight:700;border-top:2px solid var(--line)">Total (${totalScored} action${totalScored===1?'':'s'} scored across ${list.length} case${list.length===1?'':'s'})</td>
      <td style="padding:11px 12px;font-weight:800;border-top:2px solid var(--line)">${scoreCell(grand)}</td>
    </tr></tfoot>`:''}
  </table></div></div>`;
}
/* ---- Causelist export ------------------------------------------------------------------
   Mirrors CAUSTLIST - AUGUST26.pdf: title, generated stamp, then
   SL NO. | CASE TYPE | CASE DETAILS | CASE NO. | DATE | Advocate incharge | Court Name |
   STATUS | ACTION NEEDED.
   A causelist covers a period, so it refuses to run until a date range is chosen. */
// Shared by View and Export - both need the identical sheet, one just renders it in a new
// tab instead of triggering a download. Returns null (having already shown its own warning
// toast) on every validation failure, so a caller never has to duplicate those checks, and
// a usage event only ever gets logged where a real sheet actually came out the other end.