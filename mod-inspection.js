let INSP_RESP_FILTER={q:'',work:'All'};
let INSP_LOG_FILTER={q:'',block:'All',cat:'All',status:'All',section:'All'};
async function inspFetch(){ const {data,error}=await sb.schema('acc').from('inspection').select('*').order('ts',{ascending:false}).limit(20000); if(error)throw error; return data||[]; }
function inspLoc(r){ return (r.project?esc(r.project)+' · ':'')+'B'+esc(r.block||'?')+(r.floor?' · '+esc(r.floor):'')+' · '+esc(r.flat||'?'); }
/* ---- What an inspection action was ABOUT, for the Usability report ---------------------------
   Every action on this screen happens to one specific place - a flat, a floor, a tower, a project -
   and the report had no way of saying which: 137 inspection events, all of them reading "—". The
   unit is the one fact that makes an inspection row mean anything ("marked 12 items on 703" rather
   than "marked 12 items"), and it is sitting right there in the form the whole time.
   Plain text, not the escaped HTML inspLoc builds, because this goes into a JSON field and is
   escaped again when the report draws it. Empty parts are dropped rather than printed as "B?" -
   a Project-level inspection genuinely has no block or flat, and inventing a "?" for it reads as
   missing data rather than as "this level does not have one". */
function qcStat(rows){ let ok=0,no=0,na=0; rows.forEach(r=>{const u=(r.status||'').trim().toUpperCase(); if(u==='OK')ok++; else if(/NOT\s*OK/.test(u)){no++;} else if(u==='NA'||u==='N/A')na++;}); const rated=ok+no; const checks=ok+no+na; return {checks,ok,no,na,open:no,rated,pass:rated?Math.round(ok/rated*100):0}; }
function statusBadge(s){const u=(s||'').toUpperCase(); if(u==='OK')return '<span class="tag t-green">OK</span>'; if(/NOT\s*OK/.test(u))return '<span class="tag t-red">NOT OK</span>'; if(u==='NA'||u==='N/A')return '<span class="tag t-gray">NA</span>'; return esc(s);}
function passbar(p){const col=p>=80?'#16855a':p>=50?'#d98a00':'#c83232';return '<div style="display:flex;align-items:center;gap:7px"><div class="progress" style="max-width:84px;flex:1"><span style="width:'+p+'%;background:'+col+'"></span></div><span style="font-size:11.5px;color:var(--slate)">'+p+'%</span></div>';}
window.inspReload=function(){ INSP_ROWS=null; if(PAGE==='inspection')renderPage(); };
window.inspScopeClear=function(){ INSP_SCOPE={block:'All',floor:'All',flat:'All',work:'All',project:'All'}; if(PAGE==='inspection')renderPage(); };
window.inspBack=function(){ INSP_DRILL=null; if(PAGE==='inspection')renderPage(); };
function inspHeadTabs(tab){
  const tabs=[['console','Console','fa-table-cells-large'],['responses','Form Responses','fa-file-lines'],['log','Inspection Log','fa-list']];
  return '<div class="page-head"><div><h1><i class="fa-solid fa-clipboard-check" style="color:#0f766e"></i> Inspection</h1><p>Site quality inspection console</p></div><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" onclick="inspReload()"><i class="fa-solid fa-rotate"></i> Refresh</button><button class="btn btn-primary" onclick="navTo(\'inspection/new\')"><i class="fa-solid fa-plus"></i> New Inspection</button></div></div>'+
   '<div class="tabs">'+tabs.map(t=>'<div class="tab '+(tab===t[0]?'active':'')+'" onclick="inspGo(\''+t[0]+'\')"><i class="fa-solid '+t[2]+'"></i> '+t[1]+'</div>').join('')+'</div>';
}

VIEWS.inspection=async function(v,seg){
  setCrumb(['Operations','Inspection']);
  if(seg&&seg[0]==='new'){ INSP_DRILL=null; return inspForm(v); }
  if(!INSP_ROWS){
    v.innerHTML='<div class="page-head"><div><h1><i class="fa-solid fa-clipboard-check" style="color:#0f766e"></i> Inspection</h1></div></div><div class="card card-pad"><div class="loader"><div class="spin"></div></div></div>';
    try{ INSP_ROWS=await inspFetch(); }catch(e){ v.innerHTML='<div class="card card-pad empty"><i class="fa-solid fa-triangle-exclamation"></i><div style="font-weight:600">Could not load inspections</div><p>'+esc(e.message||String(e))+'</p></div>'; return; }
  }
  const tab=(seg&&seg[0])||'console';
  if(tab==='responses') return inspResponses(v,INSP_ROWS);
  if(tab==='log') return inspLog(v,INSP_ROWS);
  if(INSP_DRILL && INSP_DRILL.dim!=='sub') return inspDrillView(v,INSP_ROWS);
  inspConsole(v,INSP_ROWS);
};
function inspConsole(v,rows){
  const overall=qcStat(rows);
  const sc=INSP_SCOPE;
  const scoped=rows.filter(r=>(sc.project==='All'||r.project===sc.project)&&(sc.block==='All'||r.block===sc.block)&&(sc.floor==='All'||r.floor===sc.floor)&&(sc.flat==='All'||r.flat===sc.flat)&&(sc.work==='All'||r.work_category===sc.work));
  const ss=qcStat(scoped); const scopeActive=sc.project!=='All'||sc.block!=='All'||sc.floor!=='All'||sc.flat!=='All'||sc.work!=='All';
  const B=(window.INSP_BLOCKS||[...new Set(rows.map(r=>r.block).filter(Boolean))]);
  const C=(window.INSP_CATS||[...new Set(rows.map(r=>r.work_category).filter(Boolean))]);
  const PR=(window.INSP_PROJECTS||[...new Set(rows.map(r=>r.project).filter(Boolean))]);
  const LVD=(window.INSP_LEVELS||[...new Set(rows.map(r=>r.insp_level).filter(Boolean))]);
  const byBlock=B.map(x=>({key:x,s:qcStat(rows.filter(r=>r.block===x))})).filter(x=>x.s.checks>0);
  const byCat=C.map(x=>({key:x,s:qcStat(rows.filter(r=>r.work_category===x))})).filter(x=>x.s.checks>0);
  const byProject=PR.map(x=>({key:x,s:qcStat(rows.filter(r=>r.project===x))})).filter(x=>x.s.checks>0);
  const byLevel=LVD.map(x=>({key:x,s:qcStat(rows.filter(r=>r.insp_level===x))})).filter(x=>x.s.checks>0);
  const openDefects=rows.filter(r=>/NOT\s*OK/.test((r.status||'').toUpperCase()));
  const kpis=[['Total Logs',overall.checks,'#1763A6','fa-list-check'],['OK',overall.ok,'#16855A','fa-circle-check'],['NOT OK',overall.no,'#C83232','fa-circle-xmark'],['Not Applicable',overall.na,'#94a3b8','fa-circle-minus'],['Percentage',overall.pass+'%','#F2A104','fa-percent']];
  const kpiBand='<div class="grid kpis" style="grid-template-columns:repeat(5,1fr)">'+kpis.map(k=>'<div class="kpi"><div class="top"><div class="ic" style="background:'+k[2]+'18;color:'+k[2]+'"><i class="fa-solid '+k[3]+'"></i></div></div><div class="val">'+k[1]+'</div><div class="lbl">'+k[0]+'</div></div>').join('')+'</div>';
  const opt=(dim,cur,vals)=>'<select onchange="inspScope(\''+dim+'\',this.value)"><option value="All"'+(cur==='All'?' selected':'')+'>All</option>'+(vals||[]).map(x=>'<option'+(cur===String(x)?' selected':'')+'>'+esc(x)+'</option>').join('')+'</select>';
  const P=window.INSP_PROJECTS||[];
  const scopeCard='<div class="card card-pad" style="margin-top:16px"><div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:8px"><div><div class="insp-kicker">DRILL-DOWN</div><div class="sec-title" style="margin:2px 0 0">Filter by Project · Block · Floor · Flat · Work Type</div></div><span class="insp-count">'+scoped.length+' of '+rows.length+' checks</span></div>'+
    '<div class="insp-filter-row">'+
    '<div class="insp-field"><label>Project</label>'+opt('project',sc.project,P)+'</div>'+
    '<div class="insp-field"><label>Block</label>'+opt('block',sc.block,B)+'</div>'+
    '<div class="insp-field"><label>Floor</label>'+opt('floor',sc.floor,window.INSP_FLOORS||[])+'</div>'+
    '<div class="insp-field"><label>Flat</label>'+opt('flat',sc.flat,window.INSP_FLATS||[])+'</div>'+
    '<div class="insp-field"><label>Work Type</label>'+opt('work',sc.work,C)+'</div>'+
    (scopeActive?'<button class="btn insp-clear-btn" onclick="inspScopeClear()"><i class=\"fa-solid fa-xmark\"></i> Clear</button>':'')+'</div>'+
    '<div style="display:flex;align-items:center;gap:18px;margin-top:14px;padding-top:14px;border-top:1px dashed var(--line);flex-wrap:wrap">'+
     '<div class="insp-skpi"><div class="n">'+ss.checks+'</div><div class="l">Total Logs</div></div>'+
     '<div class="insp-skpi"><div class="n" style="color:#16855A">'+ss.ok+'</div><div class="l">OK</div></div>'+
     '<div class="insp-skpi"><div class="n" style="color:#C83232">'+ss.no+'</div><div class="l">Not OK</div></div>'+
     '<div class="insp-skpi"><div class="n" style="color:#94a3b8">'+ss.na+'</div><div class="l">Not Applicable</div></div>'+
     '<div class="insp-skpi"><div class="n" style="color:#1763A6">'+ss.pass+'%</div><div class="l">Percentage</div></div>'+
     '<div style="flex:1;min-width:150px">'+passbar(ss.pass)+'</div></div>'+
    (scopeActive&&ss.checks===0?'<div style="margin-top:12px;font-size:13px;color:#C83232;background:#fbe7e7;padding:9px 13px;border-radius:8px">No checks logged for this scope yet.</div>':'')+'</div>';
  const num=(dim,key,col,val,cls)=>'<a class="insp-num '+(cls||'')+'" onclick="inspDrill(\''+dim+'\',\''+esc(String(key)).replace(/'/g,"&#39;")+'\',\''+col+'\')">'+val+'</a>';
  const DIM_LABEL={block:'Block',cat:'Category',project:'Project',level:'Level'};
  const matrix=(arr,dim,head)=>'<div class="card qc-table-card" style="padding:0"><div class="card-pad" style="border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:flex-end"><div><div class="insp-kicker">STATUS</div><div class="sec-title" style="margin:2px 0 0">'+head+'</div></div><span class="qc-hint" style="font-size:11.5px;color:#94a3b8;font-style:italic">Click any number to drill in</span></div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>'+(DIM_LABEL[dim]||'Key')+'</th><th>Total Logs</th><th>OK</th><th>Not OK</th><th>Not Applicable</th><th>Percentage</th></tr></thead><tbody>'+
    (arr.length?arr.map(x=>'<tr><td><b>'+esc(x.key)+'</b></td><td>'+num(dim,x.key,'all',x.s.checks,'')+'</td><td>'+num(dim,x.key,'ok',x.s.ok,'ok')+'</td><td>'+num(dim,x.key,'notok',x.s.no,'no')+'</td><td>'+num(dim,x.key,'na',x.s.na,'')+'</td><td>'+passbar(x.s.pass)+'</td></tr>').join(''):'<tr><td colspan="6"><div class="empty" style="padding:20px">No data</div></td></tr>')+'</tbody></table></div></div>';
  const openCard='<div class="card qc-table-card" style="padding:0;margin-top:16px"><div class="card-pad" style="border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:flex-end"><div><div class="insp-kicker" style="color:#E08600">NEEDS ATTENTION</div><div class="sec-title" style="margin:2px 0 0">Not OK Items</div></div><span class="insp-pill">'+openDefects.length+'</span></div>'+
    (openDefects.length===0?'<div class="empty" style="padding:36px"><i class="fa-solid fa-circle-check" style="color:#16855a"></i><div style="font-weight:600">No Not OK items</div><p>Everything logged so far is OK.</p></div>':'<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Block</th><th>Floor</th><th>Flat</th><th>Category</th><th>Item ID</th><th>Inspection Check</th><th>Status</th><th>Inspector</th></tr></thead><tbody>'+openDefects.map(r=>'<tr><td>'+esc(r.block)+'</td><td>'+esc(r.floor)+'</td><td>'+esc(r.flat)+'</td><td>'+esc(r.work_category)+'</td><td><b>'+esc(r.item_id)+'</b></td><td style="max-width:280px;color:#475569">'+esc(r.inspection_check)+'</td><td>'+statusBadge(r.status)+'</td><td>'+esc(r.inspector)+'</td></tr>').join('')+'</tbody></table></div>')+'</div>';
  const empty=rows.length===0?'<div class="card card-pad empty" style="margin-top:16px"><i class="fa-regular fa-clipboard"></i><div style="font-weight:600;color:var(--ink)">No inspections logged yet</div><p style="max-width:420px;margin:6px auto 0">Click <b>New Inspection</b> to record one — it saves straight to the database.</p></div>':'';
  v.innerHTML=inspHeadTabs('console')+kpiBand+scopeCard+(rows.length?('<div class="insp-matrix-grid">'+matrix(byBlock,'block','By Block')+matrix(byCat,'cat','By Work Category')+matrix(byProject,'project','By Project')+matrix(byLevel,'level','By Level')+'</div>'+openCard):empty);
}
const INSP_DIM_FIELD={block:'block',cat:'work_category',project:'project',level:'insp_level'};
function inspDrillView(v,rows){
  const d=INSP_DRILL; const field=INSP_DIM_FIELD[d.dim]||'work_category'; const dimRows=rows.filter(r=>r[field]===d.key);
  const u=r=>(r.status||'').toUpperCase();
  const colRows=d.col==='ok'?dimRows.filter(r=>u(r)==='OK'):d.col==='notok'?dimRows.filter(r=>/NOT\s*OK/.test(u(r))):d.col==='na'?dimRows.filter(r=>u(r)==='NA'||u(r)==='N/A'):dimRows;
  const lbl={all:'All checks',ok:'OK',notok:'Not OK',na:'Not Applicable'}[d.col]||'Checks';
  v.innerHTML=inspHeadTabs('console')+'<button class="btn" style="margin-bottom:14px" onclick="inspBack()"><i class="fa-solid fa-arrow-left"></i> Back to console</button>'+
    '<div class="card qc-table-card" style="padding:0"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="insp-kicker">'+{block:'BLOCK',cat:'WORK CATEGORY',project:'PROJECT',level:'LEVEL'}[d.dim]+' · '+esc(d.key)+'</div><div class="sec-title" style="margin:2px 0 0">'+lbl+' · '+colRows.length+' checks</div></div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Date</th><th>Inspector</th><th>Location</th><th>Category</th><th>Item</th><th>Check</th><th>Status</th><th>Remarks</th></tr></thead><tbody>'+
    (colRows.length?colRows.map(r=>'<tr><td>'+esc(fmtDate(r.ts))+'</td><td>'+esc(r.inspector)+'</td><td>'+inspLoc(r)+'</td><td>'+esc(r.work_category)+'</td><td><b>'+esc(r.item_id)+'</b></td><td style="max-width:260px;color:#475569">'+esc(r.inspection_check)+'</td><td>'+statusBadge(r.status)+'</td><td style="color:var(--slate);max-width:200px">'+esc(r.remarks)+'</td></tr>').join(''):'<tr><td colspan="8"><div class="empty">No checks</div></td></tr>')+'</tbody></table></div></div>';
}
function inspResponses(v,rows){
  const map={}; rows.forEach(r=>{const k=[r.ts,r.inspector,r.block,r.floor,r.flat,r.work_category].join('|'); if(!map[k])map[k]={ts:r.ts,ins:r.inspector,block:r.block,floor:r.floor,flat:r.flat,cat:r.work_category,loc:inspLoc(r),rows:[],ok:0,no:0,sec:r.remarks||'',photo:r.defect_photo||'',overall:r.overall_remark||''}; const o=map[k]; o.rows.push(r); const uu=(r.status||'').toUpperCase(); if(uu==='OK')o.ok++; else if(/NOT\s*OK/.test(uu))o.no++;});
  INSP_SUBS=Object.values(map);
  if(INSP_DRILL && INSP_DRILL.dim==='sub'){
    const s=INSP_SUBS[INSP_DRILL.i]; if(!s){ INSP_DRILL=null; return inspResponses(v,rows); }
    if(INSP_DRILL.edit) return inspEditView(v,s);
    v.innerHTML=inspHeadTabs('responses')+
      '<div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap"><button class="btn" onclick="inspBack()"><i class="fa-solid fa-arrow-left"></i> Back to responses</button><button class="btn btn-primary" onclick="inspEditSub()"><i class="fa-solid fa-pen"></i> Edit response</button></div>'+
      '<div class="card card-pad"><div class="insp-kicker">SUBMISSION</div><div class="sec-title" style="margin:2px 0 8px">'+esc(s.cat)+' · '+s.loc+'</div><div style="display:flex;flex-wrap:wrap;gap:10px">'+
      [['Date',esc(fmtDate(s.ts))],['Inspector',esc(s.ins)],['OK',s.ok],['Not OK',s.no],['Total Log',s.ok+s.no]].map(f=>'<div class="insp-fact"><div class="fl">'+f[0]+'</div><div class="fv">'+f[1]+'</div></div>').join('')+'</div>'+
      (s.sec?'<div style="margin-top:12px"><label style="font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--slate);text-transform:uppercase">Section Remark</label><div style="font-size:13px;margin-top:3px">'+esc(s.sec)+'</div></div>':'')+
      (s.photo?'<div style="margin-top:10px"><label style="font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--slate);text-transform:uppercase">Defect Photos</label><div style="font-size:13px;margin-top:3px">'+(isS3Path(s.photo)?'<button class="btn btn-sm" onclick="inspOpenPhoto(\''+esc(s.photo)+'\')"><i class="fa-solid fa-image"></i> View photo</button>':'<a href="'+esc(s.photo)+'" target="_blank" rel="noopener" style="color:var(--brand)">'+esc(s.photo)+'</a>')+'</div></div>':'')+
      (s.overall?'<div style="margin-top:10px"><label style="font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--slate);text-transform:uppercase">Overall Remarks</label><div style="font-size:13px;margin-top:3px">'+esc(s.overall)+'</div></div>':'')+'</div>'+
      '<div class="card qc-table-card" style="padding:0;margin-top:16px"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="sec-title" style="margin:0">Checks · '+s.rows.length+'</div></div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Item</th><th>Check</th><th>Status</th></tr></thead><tbody>'+s.rows.map(r=>'<tr><td><b>'+esc(r.item_id)+'</b></td><td style="max-width:420px;color:#475569">'+esc(r.inspection_check)+'</td><td>'+statusBadge(r.status)+'</td></tr>').join('')+'</tbody></table></div></div>';
    return;
  }
  const C=window.INSP_CATS||[...new Set(rows.map(r=>r.work_category).filter(Boolean))];
  const f=INSP_RESP_FILTER, q=(f.q||'').trim().toLowerCase();
  const passF=x=>(f.work==='All'||x.cat===f.work)&&(!q||[x.ins,x.block,x.flat].some(v=>String(v||'').toLowerCase().includes(q)));
  const shown=INSP_SUBS.map((x,i)=>({x,i})).filter(o=>passF(o.x));
  const toolbar='<div class="toolbar" style="margin-bottom:14px">'+
    '<div class="grow"><i class="fa-solid fa-magnifying-glass"></i><input id="respQ" placeholder="Search Inspector, Block or Flat…" value="'+esc(f.q)+'" oninput="inspRespFilter()"></div>'+
    '<select class="sel" id="respWork" onchange="inspRespFilter()"><option value="All">All Work Types</option>'+C.map(c=>'<option'+(f.work===c?' selected':'')+'>'+esc(c)+'</option>').join('')+'</select>'+
    (q||f.work!=='All'?'<button class="btn" onclick="inspRespFilterClear()"><i class="fa-solid fa-xmark"></i> Clear</button>':'')+
    '</div>';
  const respRow=({x,i})=>'<tr class="rowlink" onclick="inspOpenSub('+i+')"><td>'+esc(fmtDate(x.ts))+'</td><td>'+esc(x.ins)+'</td><td>'+x.loc+'</td><td>'+esc(x.cat)+'</td><td style="color:#16855a;font-weight:600">'+x.ok+'</td><td style="color:#c83232;font-weight:600">'+x.no+'</td><td style="font-weight:600">'+(x.ok+x.no)+'</td><td style="text-align:right"><i class="fa-solid fa-chevron-right" style="color:#cbd5e1"></i></td></tr>';
  v.innerHTML=inspHeadTabs('responses')+toolbar+'<div class="card qc-table-card" style="padding:0"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="sec-title" style="margin:0">Form Responses</div><div class="sec-sub" id="respSecSub">'+shown.length+' of '+INSP_SUBS.length+' submissions · click a row to open it</div></div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Date</th><th>Inspector</th><th>Location</th><th>Category</th><th>OK</th><th>Not OK</th><th>Total Log</th><th></th></tr></thead><tbody id="respTbody">'+
    (shown.length?shown.map(respRow).join(''):'<tr><td colspan="8"><div class="empty">No submissions match this search/filter.</div></td></tr>')+'</tbody></table></div></div>';
}
window.inspRespFilter=function(){
  const qEl=$('respQ'), wEl=$('respWork'); if(!qEl||!wEl)return;
  INSP_RESP_FILTER={q:qEl.value,work:wEl.value};
  const f=INSP_RESP_FILTER, q=(f.q||'').trim().toLowerCase();
  const passF=x=>(f.work==='All'||x.cat===f.work)&&(!q||[x.ins,x.block,x.flat].some(v=>String(v||'').toLowerCase().includes(q)));
  const shown=INSP_SUBS.map((x,i)=>({x,i})).filter(o=>passF(o.x));
  const respRow=({x,i})=>'<tr class="rowlink" onclick="inspOpenSub('+i+')"><td>'+esc(fmtDate(x.ts))+'</td><td>'+esc(x.ins)+'</td><td>'+x.loc+'</td><td>'+esc(x.cat)+'</td><td style="color:#16855a;font-weight:600">'+x.ok+'</td><td style="color:#c83232;font-weight:600">'+x.no+'</td><td style="font-weight:600">'+(x.ok+x.no)+'</td><td style="text-align:right"><i class="fa-solid fa-chevron-right" style="color:#cbd5e1"></i></td></tr>';
  const tb=$('respTbody'); if(tb)tb.innerHTML=shown.length?shown.map(respRow).join(''):'<tr><td colspan="8"><div class="empty">No submissions match this search/filter.</div></td></tr>';
  const sub=$('respSecSub'); if(sub)sub.textContent=shown.length+' of '+INSP_SUBS.length+' submissions · click a row to open it';
  usageQueueDebounced('inspection.responses.search_filter_submissions', q);
};
window.inspRespFilterClear=function(){ INSP_RESP_FILTER={q:'',work:'All'}; if(PAGE==='inspection')renderPage(); };
function inspEditView(v,s){
  v.innerHTML=inspHeadTabs('responses')+
    '<div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap"><button class="btn" onclick="inspCancelEdit()"><i class="fa-solid fa-arrow-left"></i> Cancel</button></div>'+
    '<div class="card card-pad frm" style="max-width:920px"><div class="insp-kicker">EDIT SUBMISSION</div><div class="sec-title" style="margin:2px 0 4px">'+esc(s.cat)+' · '+s.loc+'</div><div style="color:var(--slate);font-size:12.5px;margin-bottom:10px">'+esc(fmtDate(s.ts))+' · '+esc(s.ins)+'</div>'+
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px"><div class="sec-title" style="margin:0;font-size:14px">Checks · '+s.rows.length+'</div><button type="button" class="btn btn-sm" onclick="inspBulkE(\'OK\')">All OK</button></div>'+
    '<div id="eItems">'+(()=>{
      const groups=[]; let cur=null;
      s.rows.forEach(r=>{
        const key=(r.sub_area||'')+'::'+(r.component||'')+'::'+(r.section||'');
        if(!cur||cur.key!==key){ cur={key,label:[r.sub_area,r.component,r.section].filter(Boolean).join(' · '),rows:[]}; groups.push(cur); }
        cur.rows.push(r);
      });
      const mkRow=r=>{const u=(r.status||'').toUpperCase();const mk=(st)=>{const sel=(st==='OK'&&u==='OK')||(/NOT/.test(st)&&/NOT\s*OK/.test(u))||(st==='NA'&&(u==='NA'||u==='N/A'));const cls=st==='OK'?'ok':/NOT/.test(st)?'no':'na';return '<button type="button" class="ic-btn'+(sel?' on '+cls:'')+'" data-s="'+st+'" onclick="inspPick(this)">'+st+'</button>';};return '<div class="insp-check" data-id="'+r.id+'" data-status="'+esc(r.status||'')+'"><div class="ic-main"><div class="ic-id">'+esc(r.item_id)+'</div><div class="ic-txt">'+esc(r.inspection_check)+'</div></div><div class="ic-seg">'+['OK','NOT OK','NA'].map(mk).join('')+'</div></div>';};
      return groups.map(g=>g.label?('<div class="insp-comp-group"><div class="insp-comp-head">'+esc(g.label)+'<span class="insp-comp-count">'+g.rows.length+' checks</span></div><div class="insp-checks">'+g.rows.map(mkRow).join('')+'</div></div>'):('<div class="insp-checks">'+g.rows.map(mkRow).join('')+'</div>')).join('');
    })()+'</div>'+
    '<label style="margin-top:14px">Section Remark</label><textarea id="eSec">'+esc(s.sec)+'</textarea>'+
    '<label>Defect Photos</label>'+
    (s.photo&&isS3Path(s.photo)?'<div style="font-size:12.5px;margin-bottom:4px"><button type="button" class="btn btn-sm" onclick="inspOpenPhoto(\''+esc(s.photo)+'\')"><i class="fa-solid fa-image"></i> View current photo</button></div>':'')+
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input id="ePhoto" placeholder="Paste a link (optional)" value="'+esc(isS3Path(s.photo)?'':(s.photo||''))+'" style="flex:1;min-width:180px"><button type="button" class="btn btn-sm" onclick="document.getElementById(\'ePhotoFile\').click()"><i class="fa-solid fa-camera"></i> Replace photo</button><input type="file" id="ePhotoFile" class="hidden" accept="image/*" onchange="document.getElementById(\'ePhotoName\').textContent=this.files[0]?this.files[0].name:\'\'"><span id="ePhotoName" style="font-size:12px;color:var(--slate)"></span></div>'+
    '<label>Overall Remarks</label><textarea id="eOverall">'+esc(s.overall)+'</textarea>'+
    '<div style="margin-top:18px;display:flex;justify-content:flex-end;gap:10px"><button class="btn" onclick="inspCancelEdit()">Cancel</button><button class="btn btn-primary" id="eSaveBtn" onclick="inspUpdateSub()"><i class="fa-solid fa-check"></i> Save changes</button></div></div>';
}
window.inspOpenPhoto=async function(path){ if(isS3Path(path)){ await s3OpenSigned(path); } else if(path){ window.open(path,'_blank'); } };
window.inspCancelEdit=function(){ if(INSP_DRILL){INSP_DRILL.edit=false; renderPage();} };
function inspLogRow(r){ return '<tr><td>'+esc(fmtDate(r.ts))+'</td><td>'+esc(r.inspector)+'</td><td>'+inspLoc(r)+'</td><td>'+esc(r.work_category)+(r.section?'<div style="font-size:11px;color:var(--slate)">'+esc(r.section)+'</div>':'')+'</td><td><b>'+esc(r.item_id)+'</b></td><td style="max-width:260px;color:#475569">'+esc(r.inspection_check)+'</td><td>'+statusBadge(r.status)+'</td><td style="color:var(--slate);max-width:200px">'+esc(r.remarks)+'</td></tr>'; }
function inspLogFiltered(rows){
  const f=INSP_LOG_FILTER, q=(f.q||'').trim().toLowerCase();
  const su=s=>(s||'').toUpperCase();
  return rows.filter(r=>
    (f.block==='All'||r.block===f.block)&&
    (f.cat==='All'||r.work_category===f.cat)&&
    (f.section==='All'||r.section===f.section||(f.section==='(none)'&&!r.section))&&
    (f.status==='All'||(f.status==='NOT OK'?/NOT\s*OK/.test(su(r.status)):(f.status==='NA'?(su(r.status)==='NA'||su(r.status)==='N/A'):su(r.status)===f.status)))&&
    (!q||[r.inspection_check,r.item_id,r.inspector].some(v=>String(v||'').toLowerCase().includes(q)))
  );
}
function inspLog(v,rows){
  const B=window.INSP_BLOCKS||[...new Set(rows.map(r=>r.block).filter(Boolean))];
  const C=window.INSP_CATS||[...new Set(rows.map(r=>r.work_category).filter(Boolean))];
  const S=[...new Set(rows.map(r=>r.section).filter(Boolean))].sort();
  const f=INSP_LOG_FILTER;
  const shown=inspLogFiltered(rows);
  const toolbar='<div class="toolbar" style="margin-bottom:14px">'+
    '<div class="grow"><i class="fa-solid fa-magnifying-glass"></i><input id="logQ" placeholder="Search Check Description, Item Id or Inspector…" value="'+esc(f.q)+'" oninput="inspLogFilter()"></div>'+
    '<select class="sel" id="logBlock" onchange="inspLogFilter()"><option value="All">All Blocks</option>'+B.map(b=>'<option'+(f.block===String(b)?' selected':'')+'>'+esc(b)+'</option>').join('')+'</select>'+
    '<select class="sel" id="logCat" onchange="inspLogFilter()"><option value="All">All Categories</option>'+C.map(c=>'<option'+(f.cat===c?' selected':'')+'>'+esc(c)+'</option>').join('')+'</select>'+
    (S.length?'<select class="sel" id="logSection" onchange="inspLogFilter()"><option value="All">All Sections</option>'+S.map(s=>'<option'+(f.section===s?' selected':'')+'>'+esc(s)+'</option>').join('')+'<option value="(none)"'+(f.section==='(none)'?' selected':'')+'>(no section)</option></select>':'')+
    '<select class="sel" id="logStatus" onchange="inspLogFilter()"><option value="All">All Status</option>'+['OK','NOT OK','NA'].map(s=>'<option'+(f.status===s?' selected':'')+'>'+s+'</option>').join('')+'</select>'+
    (f.q||f.block!=='All'||f.cat!=='All'||f.status!=='All'||f.section!=='All'?'<button class="btn" onclick="inspLogFilterClear()"><i class="fa-solid fa-xmark"></i> Clear</button>':'')+
    '</div>';
  v.innerHTML=inspHeadTabs('log')+toolbar+'<div class="card qc-table-card" style="padding:0"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="sec-title" style="margin:0">Inspection Log</div><div class="sec-sub" id="logSecSub">'+shown.length+' of '+rows.length+' checks</div></div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Date</th><th>Inspector</th><th>Location</th><th>Category</th><th>Item</th><th>Check</th><th>Status</th><th>Remarks</th></tr></thead><tbody id="logTbody">'+
    (shown.length?shown.map(inspLogRow).join(''):'<tr><td colspan="8"><div class="empty">No checks match this search/filter.</div></td></tr>')+'</tbody></table></div></div>';
}
window.inspLogFilter=function(){
  const qEl=$('logQ'),bEl=$('logBlock'),cEl=$('logCat'),sEl=$('logStatus'),secEl=$('logSection'); if(!qEl)return;
  INSP_LOG_FILTER={q:qEl.value,block:bEl.value,cat:cEl.value,status:sEl.value,section:secEl?secEl.value:'All'};
  const shown=inspLogFiltered(INSP_ROWS||[]);
  const tb=$('logTbody'); if(tb)tb.innerHTML=shown.length?shown.map(inspLogRow).join(''):'<tr><td colspan="8"><div class="empty">No checks match this search/filter.</div></td></tr>';
  const sub=$('logSecSub'); if(sub)sub.textContent=shown.length+' of '+(INSP_ROWS||[]).length+' checks';
  usageQueueDebounced('inspection.log.search_filter_inspection_log', INSP_LOG_FILTER.q);
};
window.inspLogFilterClear=function(){ INSP_LOG_FILTER={q:'',block:'All',cat:'All',status:'All',section:'All'}; if(PAGE==='inspection')renderPage(); };
const PM_PROJECT_MAP={
  'projectmanager1@thejaingroup.com':'Dream World City',
  'dgm.project@thejaingroup.com':'Dream Gurukul'
};
function inspLockedProject(){ return PM_PROJECT_MAP[(state.email||'').toLowerCase()]||''; }
function inspForm(v){
  setCrumb(['Operations','Inspection','New inspection']);
  const B=window.INSP_BLOCKS||[],F=window.INSP_FLOORS||[],FL=window.INSP_FLATS||[],C=window.INSP_CATS||[],LV=window.INSP_LEVELS||[];
  const lockedProject=inspLockedProject();
  const projectField=lockedProject?
    ('<div style="height:38px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font-size:13px;display:flex;align-items:center;background:#f1f5f9;color:var(--ink);font-weight:600">'+esc(lockedProject)+'</div><input type="hidden" id="inProject" value="'+esc(lockedProject)+'">')
    :('<select id="inProject"><option value="">-- Select Project --</option>'+(window.INSP_PROJECTS||[]).map(p=>'<option>'+esc(p)+'</option>').join('')+'</select>');
  v.innerHTML='<div class="page-head"><div><h1><i class="fa-solid fa-clipboard-check" style="color:#0f766e"></i> New Inspection</h1><p>Record a site inspection — saved straight to the database</p></div><button class="btn" onclick="navTo(\'inspection\')"><i class="fa-solid fa-arrow-left"></i> Back</button></div>'+
  '<div class="card card-pad frm" style="max-width:920px">'+
    '<div class="two"><div><label><i class="fa-solid fa-user"></i> Inspector</label><input id="inInsp" placeholder="Inspector name"></div><div><label><i class="fa-solid fa-list-check"></i> Work Category</label><select id="inCat" onchange="inspItems()"><option value="">Select…</option>'+C.map(c=>'<option>'+esc(c)+'</option>').join('')+'</select></div></div>'+
    '<div class="insp-form-grid">'+
      '<div class="insp-fg"><label><i class="fa-solid fa-sitemap"></i> Level</label>'
        +'<div class="insp-dd" id="levelDd"><button type="button" class="insp-dd-btn" onclick="inspLevelDdToggle(event)"><i class="fa-solid fa-door-open" id="levelDdIcon"></i><span id="levelDdLabel">Flat Level (General)</span><i class="fa-solid fa-chevron-down insp-dd-caret"></i></button>'
        +'<div class="insp-dd-menu" id="levelDdMenu">'
          +'<div class="insp-dd-item" onclick="inspLevelPick(\'Project Level\',\'\',\'fa-diagram-project\',\'Project Level\')"><i class="fa-solid fa-diagram-project"></i> Project Level</div>'
          +'<div class="insp-dd-item" onclick="inspLevelPick(\'Tower Level\',\'\',\'fa-building\',\'Tower Level\')"><i class="fa-solid fa-building"></i> Tower Level</div>'
          +'<div class="insp-dd-item" onclick="inspLevelPick(\'Floor Level\',\'\',\'fa-layer-group\',\'Floor Level\')"><i class="fa-solid fa-layer-group"></i> Floor Level</div>'
          +'<div class="insp-dd-group">Flat Level</div>'
          +'<div class="insp-dd-item sub" onclick="inspLevelPick(\'Flat Level\',\'\',\'fa-door-open\',\'Flat Level (General)\')"><i class="fa-solid fa-door-open"></i> General</div>'
          +'<div class="insp-dd-item sub" onclick="inspLevelPick(\'Flat Level\',\'Kitchen\',\'fa-kitchen-set\',\'Flat Level — Kitchen\')"><i class="fa-solid fa-kitchen-set"></i> Kitchen</div>'
          +'<div class="insp-dd-item sub" onclick="inspLevelPick(\'Flat Level\',\'Bathroom\',\'fa-bath\',\'Flat Level — Bathroom\')"><i class="fa-solid fa-bath"></i> Bathroom</div>'
          +'<div class="insp-dd-item sub" onclick="inspLevelPick(\'Flat Level\',\'Others\',\'fa-ellipsis\',\'Flat Level — Others\')"><i class="fa-solid fa-ellipsis"></i> Others</div>'
        +'</div></div>'
        +'<input type="hidden" id="inLevel" value="Flat Level">'
      +'</div>'+
      '<div class="insp-fg"><label><i class="fa-solid fa-city"></i> Project</label>'+projectField+'</div>'+
      '<div class="insp-fg" id="fgBlock"><label><i class="fa-solid fa-building"></i> Block</label><select id="inBlock">'+B.map(b=>'<option>'+esc(b)+'</option>').join('')+'</select></div>'+
      '<div class="insp-fg" id="fgFloor"><label><i class="fa-solid fa-layer-group"></i> Floor</label><select id="inFloor">'+F.map(f=>'<option'+(f==='Ground'?' selected':'')+'>'+esc(f)+'</option>').join('')+'</select></div>'+
      '<div class="insp-fg" id="fgFlat"><label><i class="fa-solid fa-door-closed"></i> Flat</label><select id="inFlat">'+FL.map(f=>'<option>'+esc(f)+'</option>').join('')+'</select></div>'+
    '</div>'+
    '<div id="inItems" style="margin-top:14px"><div class="empty" style="padding:24px">Select a work category to load its checklist.</div></div>'+
    '<label style="margin-top:14px">Section Remark</label><textarea id="inSec" placeholder="A remark for this section/category (optional)"></textarea>'+
    '<label>Defect Photos</label>'+
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input id="inPhoto" placeholder="Paste a link (optional)" style="flex:1;min-width:180px"><button type="button" class="btn btn-sm" onclick="document.getElementById(\'inPhotoFile\').click()"><i class="fa-solid fa-camera"></i> Upload photo</button><input type="file" id="inPhotoFile" class="hidden" accept="image/*" onchange="document.getElementById(\'inPhotoName\').textContent=this.files[0]?this.files[0].name:\'\'"><span id="inPhotoName" style="font-size:12px;color:var(--slate)"></span></div>'+
    '<label>Overall Remarks</label><textarea id="inOverall" placeholder="Overall site remarks (optional)"></textarea>'+
    '<div style="margin-top:18px;display:flex;justify-content:flex-end;gap:10px"><button class="btn" onclick="navTo(\'inspection\')">Cancel</button><button class="btn btn-primary" id="inSaveBtn" onclick="inspSave()"><i class="fa-solid fa-check"></i> Submit</button></div>'+
  '</div>';
  inspLevelChange();
}
window.inspLevelDdToggle=function(ev){
  if(ev)ev.stopPropagation();
  const m=$('levelDdMenu'); if(!m)return;
  document.querySelectorAll('.insp-dd-menu.show').forEach(x=>{ if(x!==m)x.classList.remove('show'); });
  m.classList.toggle('show');
};
window.inspItems=function(){
  const cat=$('inCat').value, host=$('inItems');
  if(!cat){ INSP_FORM_STATE=null; host.innerHTML='<div class="empty" style="padding:24px">Select a work category to load its checklist.</div>'; return; }
  const comps=inspComponentsFor(cat);
  if(!comps.length){ INSP_FORM_STATE=null; host.innerHTML='<div class="empty" style="padding:24px">No checklist configured yet for '+esc(cat)+'.</div>'; return; }
  INSP_FORM_STATE={cat,answers:{}};
  inspRenderChecklist();
};
function inspRenderChecklist(){
  const st=INSP_FORM_STATE, host=$('inItems'); if(!st||!host)return;
  const comps=inspComponentsFor(st.cat);
  const total=inspRequiredTotal(st.cat), answered=inspAnsweredCount();
  const pct=total?Math.round(answered/total*100):0;
  const mkRow=(comp,secName,it)=>{
    const key=inspAnsKey(comp.name,secName,it.id), status=st.answers[key]||'';
    const mk=s=>{const sel=status===s;const cls=s==='OK'?'ok':/NOT/.test(s)?'no':'na';return '<button type="button" class="ic-btn'+(sel?' on '+cls:'')+'" data-s="'+s+'" onclick="inspPick(this)">'+s+'</button>';};
    return '<div class="insp-check" data-key="'+esc(key)+'" data-status="'+esc(status)+'"><div class="ic-main"><div class="ic-id">'+esc(it.id)+'</div><div class="ic-txt">'+esc(it.check)+(it.criteria?'<div class="ic-cri">'+esc(it.criteria)+'</div>':'')+'</div></div><div class="ic-seg">'+['OK','NOT OK','NA'].map(mk).join('')+'</div></div>';
  };
  const compsHtml=comps.map(comp=>{
    const secs=inspCompSections(comp);
    const totalCount=secs.reduce((n,s)=>n+s.items.length,0);
    const body=secs.map(s=>{
      const rowsHtml='<div class="insp-checks">'+s.items.map(it=>mkRow(comp,s.name,it)).join('')+'</div>';
      if(!s.name)return rowsHtml;
      const ansInSec=s.items.filter(it=>st.answers[inspAnsKey(comp.name,s.name,it.id)]).length;
      return '<div class="insp-sec-group"><div class="insp-sec-head">'+esc(s.name)+'<span class="insp-comp-count">'+ansInSec+' / '+s.items.length+'</span></div>'+rowsHtml+'</div>';
    }).join('');
    return '<div class="insp-comp-group"><div class="insp-comp-head">'+esc(comp.name)+'<span class="insp-comp-count">'+totalCount+' checks</span></div>'+body+'</div>';
  }).join('');
  host.innerHTML=
    '<div class="insp-progress-row"><div class="progress" style="flex:1"><span style="width:'+pct+'%"></span></div><span class="insp-progress-txt">'+answered+' / '+total+' answered</span></div>'+
    '<div style="display:flex;justify-content:flex-end;gap:8px;margin:10px 0 4px"><button type="button" class="btn btn-sm" onclick="inspBulk(\'OK\')">All OK</button><button type="button" class="btn btn-sm" onclick="inspBulk(\'\')">Clear</button></div>'+
    compsHtml;
}