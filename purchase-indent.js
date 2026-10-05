/* ============================ PURCHASE & STORES — INDENTS (Stage 3) ============================
   Raise an indent against a project's warehouse, submit it through the project's approver chain, approve /
   reject it, and short close what will not be ordered. Spec: docs/purchase-stores-spec.md §3.
   The screens follow the layout of Farvision's indent: Main Info, Delivery Info, Change History and Approval
   History (no attachments). Items are picked by their unique item code (Setup -> Items).
   Two sections: "Create an indent" (new indents and the whole approval flow) and "Revise an indent" (indents
   that were rejected - the raiser corrects them and sends them for approval again). An approved indent is
   never changed; what is no longer needed is short closed.
   Tables and the submit / decide / short-close functions: supabase/migrations/20261004190000_purchase_indents.sql
   and 20261004270000_purchase_indent_farvision_fields.sql (its indent_attachments table is no longer used).
   The rules (who may approve, when an indent is locked, numbering) live in the database; this file only
   shows them and calls the functions. Shares helpers with purchase.js through window.PUS.
   Routes: inventory/2/create, inventory/2/revise (inventory/2/<section>/<id> or inventory/2/<id> opens that indent). */
(function(){
if(window.__PUI_LOADED) return;
window.__PUI_LOADED=true;

const I={rows:[],lines:[],pending:[],rej:[],types:[],rfqs:{},sec:'create',filter:'all',rv:'all',project:'',q:''};
const SC=[['all','All'],['draft','Drafts'],['pending','Awaiting approval'],['mine','Awaiting my approval'],['approved','Approved'],['closed','Closed']];
const qty=n=>Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:3});
const me=()=>String(state.email||'').toLowerCase();
const U=()=>window.PUS;
// The person who raised an indent can decide it only when the rule "let a person approve an indent they raised" is on (Admin -> Rules); the database enforces the same.
const selfApproval=()=>U().rule('indent.allow_self_approval')==='true';
const dmy=d=>{ if(!d) return '—'; const x=new Date(d); return isNaN(x)?'—':String(x.getDate()).padStart(2,'0')+'/'+String(x.getMonth()+1).padStart(2,'0')+'/'+x.getFullYear(); };
const dmyTime=d=>{ const x=new Date(d); return isNaN(x)?'—':x.toLocaleString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})+', '+x.getDate()+' '+x.toLocaleString('en-IN',{month:'short'})+" '"+String(x.getFullYear()).slice(2); };
// Financial year of a date: 1 April - 31 March.
function fy(d){
  const x=d?new Date(d):new Date(); let y=x.getFullYear(); if(x.getMonth()<3) y--;
  return {label:y+'-'+String((y+1)%100).padStart(2,'0'),text:'01-04-'+y+' - 31-03-'+(y+1)};
}

// RFQs (not draft, not cancelled) that cover some of this indent.
const activeRfqs=id=>(I.rfqs[id]||[]).filter(x=>x.status==='open'||x.status==='closed'||x.status==='ordered');
function lineTotals(id){
  const ls=I.lines.filter(l=>l.indent_id===id);
  const t={n:ls.length,qty:0,ordered:0,short:0};
  ls.forEach(l=>{t.qty+=+l.qty;t.ordered+=+l.ordered_qty;t.short+=+l.short_closed_qty;});
  t.open=t.qty-t.ordered-t.short;
  return t;
}
function status(r){
  const t=lineTotals(r.id);
  switch(r.status){
    case 'draft': return ['Draft','t-gray'];
    case 'pending_approval': return ['Awaiting level '+r.current_level,'t-amber'];
    case 'approved': return t.ordered>0?['Partly ordered','t-blue']:(activeRfqs(r.id).length?['RFQ raised','t-blue']:['Approved','t-green']);
    case 'rejected': return ['Rejected','t-red'];
    case 'closed': return r.closed_kind==='short_closed'?['Short closed','t-gray']:['Fully ordered','t-green'];
  }
  return [r.status,'t-gray'];
}
const statusTag=r=>{const s=status(r);return '<span class="tag '+s[1]+'">'+esc(s[0])+'</span>';};
const isMine=r=>r.status==='pending_approval'&&(selfApproval()||r.raised_by.toLowerCase()!==me())&&I.pending.some(a=>a.indent_id===r.id&&a.approvers.some(e=>e.toLowerCase()===me()));
const canEdit=r=>(r.status==='draft'||r.status==='rejected')&&(r.raised_by.toLowerCase()===me()||state.super)&&U().can('indent.raise');
const docNo=r=>r.doc_no||('Draft #'+r.id);
const projName=id=>{const p=U().S.projects.find(x=>x.id===id);return p?p.name:'—';};
const whName=id=>{const w=U().S.warehouses.find(x=>x.id===id);return w?w.name:'—';};
const typeName=id=>{const t=I.types.find(x=>x.id===id);return t?t.name:'—';};
// The person's role(s) in this module - Farvision's "Profile" column.
const profile=email=>{
  const e=String(email||'').toLowerCase(), ids=U().S.roleMembers.filter(m=>m.email===e).map(m=>m.role_id);
  const names=U().S.roles.filter(r=>ids.includes(r.id)).map(r=>r.name);
  return names.length?names.join(', '):'—';
};

async function iLoad(){
  await U().load();
  const [r,l,a,x,t,rs]=await Promise.all([
    U().PU().from('indents').select('*').is('deleted_at',null).order('created_at',{ascending:false}),
    U().PU().from('indent_lines').select('id,indent_id,qty,ordered_qty,short_closed_qty'),
    U().PU().from('indent_approvals').select('indent_id,level,approvers,round,status').eq('status','pending'),
    U().PU().from('indent_approvals').select('indent_id,level,round,acted_by,acted_at,remark').eq('status','rejected'),
    U().PU().from('indent_types').select('*').is('deleted_at',null).order('sort_order'),
    U().PU().from('rfq_sources').select('indent_id,rfq_id,rfqs(doc_no,status,deleted_at)')
  ]);
  const bad=[r,l,a,x,t,rs].find(y=>y.error); if(bad) throw bad.error;
  I.rfqs={}; (rs.data||[]).forEach(s=>{ if(s.rfqs&&!s.rfqs.deleted_at){ const a=(I.rfqs[s.indent_id]=I.rfqs[s.indent_id]||[]); if(!a.some(x=>x.rfq_id===s.rfq_id)) a.push({rfq_id:s.rfq_id,doc_no:s.rfqs.doc_no,status:s.rfqs.status}); } });
  I.rows=r.data||[]; I.lines=l.data||[]; I.pending=a.data||[]; I.rej=x.data||[]; I.types=t.data||[];
}
// The latest rejection of an indent: who, when, why.
const lastRejection=id=>I.rej.filter(x=>x.indent_id===id).sort((a,b)=>(b.round-a.round)||String(b.acted_at).localeCompare(String(a.acted_at)))[0]||null;

let SEQ=0;
window.pusIndentRender=async function(host,seg){
  if(!window.PUS){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Purchase could not finish loading - refresh the page.</div></div>'; return; }
  U().css(); U().vcss(); piCss();
  const mine=++SEQ, stale=()=>mine!==SEQ||!host.isConnected;
  seg=seg||[]; const explicit=seg[0]==='create'||seg[0]==='revise';
  if(explicit) I.sec=seg[0];
  const id=parseInt(seg[explicit?1:0],10);
  loader(host);
  try{ await iLoad(); }
  catch(e){ if(!stale()) host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load indents: '+esc(e.message||e)+'</div></div>'; return; }
  if(stale()) return;
  if(id&&!explicit){ const r=I.rows.find(x=>x.id===id); if(r) I.sec=r.status==='rejected'?'revise':'create'; }
  host.innerHTML='<div id="puiHost"></div>';
  iRender();
  if(id) window.pusIndOpen(id);
};

function piCss(){
  if($('piCss')) return;
  const st=document.createElement('style'); st.id='piCss';
  st.textContent=`
  /* The shared dialog container sizes itself to its widest content (a wide table), which pushes the dialog off the
     left edge of a narrow window. Let it shrink to the window instead; tables scroll sideways inside the dialog. */
  #modalHost{min-width:0;max-width:100%}
  .pi-form{display:grid;grid-template-columns:1fr 1fr;gap:12px 36px;margin-bottom:6px}
  .pi-row{display:grid;grid-template-columns:150px 1fr;gap:10px;align-items:start;margin-bottom:10px}
  .pi-row .l{font-size:13px;font-weight:600;color:var(--slate);padding-top:8px;text-align:right}
  .pi-row .v{padding-top:8px;font-size:14px;min-height:34px}
  .pi-row input,.pi-row select,.pi-row textarea{width:100%}
  .pi-ro{background:#f1f5f9;border:1px solid var(--line);border-radius:8px;padding:8px 11px!important;color:#334155}
  .pi-tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);margin-bottom:16px;flex-wrap:wrap}
  .pi-tabs a{padding:10px 16px;font-size:13.5px;font-weight:600;color:var(--slate);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;text-decoration:none}
  .pi-tabs a.on{color:#0f766e;border-bottom-color:#0f766e}
  .pui-head,.pui-line{display:grid;grid-template-columns:150px minmax(0,1.5fr) 56px 100px minmax(0,2fr) 36px;gap:8px;align-items:center}
  .pui-head{font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--slate);margin-bottom:4px}
  .pui-line{margin-bottom:8px}
  .pui-line .il-desc{min-width:0;overflow-wrap:anywhere}
  .pui-line .il-uom{font-size:13px;color:var(--slate)}
  .pui-line .btn{padding-left:0;padding-right:0;justify-content:center}
  .pic{position:relative}
  .pic input{width:100%}
  .pic-list{position:absolute;left:0;right:0;top:100%;z-index:60;max-height:230px;overflow:auto;background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.14);margin-top:2px}
  .pic-opt{padding:8px 11px;font-size:13.5px;cursor:pointer}
  .pic-opt:hover{background:#f0fdfa}
  .pic-none{padding:9px 11px;font-size:13px;color:var(--slate)}
  @media(max-width:900px){.pi-form{grid-template-columns:1fr}}
  @media(max-width:760px){
    .pi-row{grid-template-columns:1fr}.pi-row .l{text-align:left;padding-top:0}
    .pui-head{display:none}
    .pui-line{grid-template-columns:minmax(0,1fr) 56px 36px;border:1px solid var(--line);border-radius:10px;padding:10px;gap:8px 10px}
    .pui-line .pic,.pui-line .il-desc,.pui-line .il-rem{grid-column:1/-1}
    .pui-line .il-qty{grid-column:1;grid-row:3}
    .pui-line .il-uom{grid-column:2;grid-row:3}
    .pui-line .btn{grid-column:3;grid-row:3}
  }
  `;
  document.head.appendChild(st);
}

const searchText=r=>docNo(r)+' '+projName(r.project_id)+' '+whName(r.warehouse_id)+' '+typeName(r.indent_type_id)+' '+U().userName(r.raised_by)+' '+(r.purpose||'');
const projSelect=()=>'<select id="puiProj" onchange="pusIndProject()"><option value="">All projects</option>'+U().S.projects.map(p=>'<option value="'+p.id+'"'+(String(p.id)===I.project?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select>';
function iRender(){
  const host=$('puiHost'); if(!host) return;
  const nRej=I.rows.filter(r=>r.status==='rejected').length;
  const secs='<div class="pus-subs" style="margin-bottom:12px"><span class="chip'+(I.sec==='create'?' active':'')+'" onclick="navTo(\'inventory/2/create\')">Create an indent</span>'
    +'<span class="chip'+(I.sec==='revise'?' active':'')+'" onclick="navTo(\'inventory/2/revise\')">Revise an indent'+(nRej?' <b style="color:#b91c1c">('+nRej+')</b>':'')+'</span></div>';
  host.innerHTML=secs+'<div id="puiBody"></div>';
  (I.sec==='revise'?renderRevise:renderCreate)($('puiBody'));
}
// Section 1: create an indent, and follow every indent through approval. Rejected ones are in the Revise section.
function renderCreate(host){
  const q=I.q.toLowerCase();
  const inFilter=(r,k)=>k==='all'||(k==='draft'&&r.status==='draft')||(k==='pending'&&r.status==='pending_approval')||(k==='mine'&&isMine(r))||(k==='approved'&&r.status==='approved')||(k==='closed'&&r.status==='closed');
  const base=I.rows.filter(r=>r.status!=='rejected'&&(!I.project||String(r.project_id)===I.project));
  const list=base.filter(r=>inFilter(r,I.filter)&&(!q||searchText(r).toLowerCase().includes(q)));
  const chips=SC.map(([k,l])=>'<span class="chip'+(I.filter===k?' active':'')+'" onclick="pusIndFilter(\''+k+'\')">'+l+' ('+base.filter(r=>inFilter(r,k)).length+')</span>').join('');
  const rows=list.map(r=>'<tr style="cursor:pointer" onclick="pusIndOpen('+r.id+')"><td><span class="pus-code">'+esc(docNo(r))+'</span></td><td>'+esc(typeName(r.indent_type_id))+'</td><td>'+esc(projName(r.project_id))+'</td><td>'+esc(whName(r.warehouse_id))+'</td>'
    +'<td style="white-space:nowrap">'+dmy(r.indent_date)+'</td><td style="white-space:nowrap">'+dmy(r.required_by)+'</td><td class="pus-num">'+lineTotals(r.id).n+'</td>'
    +'<td>'+esc(U().userName(r.raised_by))+'</td><td>'+statusTag(r)+(isMine(r)?' <span class="tag t-blue">Your turn</span>':'')+'</td></tr>').join('');
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">Create an indent</div><div class="pus-hint" style="margin:0">Raise what a site needs and send it for approval. Once approved it can be put out for quotation and ordered. An indent that is rejected moves to <b>Revise an indent</b>.</div></div>'
    +(U().can('indent.raise')?'<button class="btn btn-primary" onclick="pusIndEdit()"><i class="fa-solid fa-plus"></i> New indent</button>':'')+'</div>'
    +'<div class="pus-top"><div class="pus-subs" style="margin:0">'+chips+'</div>'+projSelect()
    +'<input class="grow" id="puiQ" placeholder="Search by number, type, project, warehouse or person" value="'+esc(I.q)+'" oninput="pusIndSearch()"></div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Document no</th><th>Type</th><th>Project</th><th>Warehouse</th><th>Date</th><th>Required by</th><th class="pus-num">Items</th><th>Raised by</th><th>Status</th></tr></thead><tbody>'
    +(rows||'<tr><td colspan="9"><div class="empty" style="padding:24px"><div>'+(base.length?'No indents match':'No indents yet')+'</div></div></td></tr>')+'</tbody></table></div></div>';
}
// Section 2: revise an indent. Only rejected indents can be revised: the raiser sees why it was rejected, corrects it
// and sends it for approval again. An approved indent is never edited (short close what is no longer needed).
function renderRevise(host){
  const q=I.q.toLowerCase();
  const rejected=I.rows.filter(r=>r.status==='rejected'&&(!I.project||String(r.project_id)===I.project));
  const mineOnly=r=>r.raised_by.toLowerCase()===me();
  const list=rejected.filter(r=>(I.rv==='all'||mineOnly(r))&&(!q||searchText(r).toLowerCase().includes(q)));
  const chips=[['all','All rejected',rejected.length],['mine','Raised by me',rejected.filter(mineOnly).length]].map(([k,l,n])=>'<span class="chip'+(I.rv===k?' active':'')+'" onclick="pusIndRv(\''+k+'\')">'+l+' ('+n+')</span>').join('');
  const rows=list.map(r=>{ const j=lastRejection(r.id), can=canEdit(r);
    return '<tr style="cursor:pointer" onclick="pusIndOpen('+r.id+')"><td><span class="pus-code">'+esc(docNo(r))+'</span></td><td>'+esc(typeName(r.indent_type_id))+'</td><td>'+esc(projName(r.project_id))+'</td><td>'+esc(whName(r.warehouse_id))+'</td>'
      +'<td class="pus-num">'+lineTotals(r.id).n+'</td><td>'+(j?esc(U().userName(j.acted_by))+'<div style="font-size:12px;color:var(--slate)">Level '+j.level+' · '+dmy(j.acted_at)+'</div>':'—')+'</td>'
      +'<td style="max-width:320px;white-space:pre-wrap">'+(j&&j.remark?esc(j.remark):'<span style="color:var(--slate)">No reason given</span>')+'</td><td>'+esc(U().userName(r.raised_by))+'</td>'
      +'<td class="pus-act">'+(can?'<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();pusIndEdit('+r.id+')"><i class="fa-solid fa-pen"></i> Revise</button>':'')+'</td></tr>'; }).join('');
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">Revise an indent</div><div class="pus-hint" style="margin:0">Indents that an approver rejected. Open one to see why, correct the items or details, and send it for approval again. Only the person who raised an indent can revise it. An approved indent cannot be changed — use <b>Short close</b> on it for anything no longer needed.</div></div></div>'
    +'<div class="pus-top"><div class="pus-subs" style="margin:0">'+chips+'</div>'+projSelect()
    +'<input class="grow" id="puiQ" placeholder="Search by number, type, project, warehouse or person" value="'+esc(I.q)+'" oninput="pusIndSearch()"></div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Document no</th><th>Type</th><th>Project</th><th>Warehouse</th><th class="pus-num">Items</th><th>Rejected by</th><th>Reason</th><th>Raised by</th><th></th></tr></thead><tbody>'
    +(rows||'<tr><td colspan="9"><div class="empty" style="padding:24px"><div>'+(rejected.length?'No rejected indents match':'No rejected indents — nothing to revise')+'</div></div></td></tr>')+'</tbody></table></div></div>';
}
window.pusIndRv=function(k){ I.rv=k; iRender(); };
window.pusIndFilter=function(k){ I.filter=k; iRender(); };
window.pusIndProject=function(){ I.project=U().val('puiProj'); iRender(); };
window.pusIndSearch=function(){ I.q=U().val('puiQ'); const b=$('puiBody'); if(b) (I.sec==='revise'?renderRevise:renderCreate)(b); const e=$('puiQ'); if(e){ e.focus(); e.setSelectionRange(e.value.length,e.value.length); } };

/* ---------------- detail: Main Info / Delivery Info / Change History / Approval History ---------------- */
const TABS=[['main','Main Info'],['delivery','Delivery Info'],['history','Change History'],['approval','Approval History']];
// A read-only field. `val` is text (escaped); pass html:true for markup.
const roField=(label,val,html)=>'<div class="pi-row"><div class="l">'+label+'</div><div class="v pi-ro">'+(val===''||val==null?'&nbsp;':(html?val:esc(val)))+'</div></div>';
let CUR=null;   // the indent open in the detail modal: {r,lines,steps,log}

window.pusIndOpen=async function(id,tab){
  const {PU}=U();
  const [h,ls,ap,lg]=await Promise.all([
    PU().from('indents').select('*').eq('id',id).maybeSingle(),
    PU().from('indent_lines').select('*, items(code,name,hsn_code)').eq('indent_id',id).order('line_no'),
    PU().from('indent_approvals').select('*').eq('indent_id',id).order('round').order('level'),
    PU().from('doc_log').select('*').eq('doc_type','indent').eq('doc_id',id).order('at')
  ]);
  const bad=[h,ls,ap,lg].find(x=>x.error);
  if(bad){ toast('Could not open the indent: '+bad.error.message,'err'); return; }
  const r=h.data; if(!r||r.deleted_at){ toast('That indent no longer exists','err'); return; }
  CUR={r,lines:ls.data||[],steps:ap.data||[],log:lg.data||[]};
  const open=CUR.lines.some(l=>+l.qty-+l.ordered_qty-+l.short_closed_qty>0);
  const my=r.status==='pending_approval'&&(selfApproval()||r.raised_by.toLowerCase()!==me())&&CUR.steps.some(s=>s.round===r.round&&s.level===r.current_level&&s.status==='pending'&&s.approvers.some(e=>e.toLowerCase()===me()));
  const btn=[];
  if(canEdit(r)) btn.push('<button class="btn'+(r.status==='rejected'?' btn-primary':'')+'" onclick="pusIndEdit('+id+')"><i class="fa-solid fa-pen"></i> '+(r.status==='rejected'?'Revise…':'Edit')+'</button>',r.status==='rejected'?'<button class="btn" onclick="pusIndSubmit('+id+')" title="Send it for approval again without changes"><i class="fa-solid fa-paper-plane"></i> Resubmit unchanged</button>':'<button class="btn btn-primary" onclick="pusIndSubmit('+id+')"><i class="fa-solid fa-paper-plane"></i> Submit for approval</button>');
  if(my) btn.push('<button class="btn" onclick="pusIndDecide('+id+',false)"><i class="fa-solid fa-circle-xmark"></i> Reject</button>','<button class="btn btn-primary" onclick="pusIndDecide('+id+',true)"><i class="fa-solid fa-circle-check"></i> Approve</button>');
  if(r.status==='approved'&&open&&U().can('indent.short_close')) btn.push('<button class="btn" onclick="pusIndShortClose('+id+')"><i class="fa-solid fa-scissors"></i> Short close…</button>');
  const del=r.status==='draft'&&canEdit(r)?'<button class="btn btn-ghost" style="margin-right:auto" onclick="pusIndDelete('+id+')"><i class="fa-solid fa-trash"></i> Delete draft</button>':'';
  openModal('<div class="modal-head"><h3>Indent '+esc(docNo(r))+' '+statusTag(r)+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="max-height:calc(90vh - 150px);overflow:auto"><div class="pi-tabs" id="piTabs">'+TABS.map(t=>'<a data-t="'+t[0]+'" onclick="pusIndTab(\''+t[0]+'\')">'+t[1]+'</a>').join('')+'</div><div id="piTabBody"></div></div>'
    +'<div class="modal-foot">'+del+'<button class="btn" onclick="closeModal()">Close</button>'+btn.join('')+'</div>','xl');
  window.pusIndTab(tab||'main');
};
window.pusIndTab=function(t){
  document.querySelectorAll('#piTabs a').forEach(a=>a.classList.toggle('on',a.dataset.t===t));
  const b=$('piTabBody'); if(!b||!CUR) return;
  b.innerHTML=({main:tabMain,delivery:tabDelivery,history:tabHistory,approval:tabApproval}[t]||tabMain)();
};

// Why a rejected indent came back - shown on the indent and at the top of the revise form.
function rejectedBanner(r){
  if(r.status!=='rejected') return '';
  const j=lastRejection(r.id)||CUR&&CUR.steps.filter(s=>s.status==='rejected').sort((a,b)=>b.round-a.round)[0];
  return '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:11px 14px;margin-bottom:12px;font-size:13.5px"><b style="color:#b91c1c"><i class="fa-solid fa-circle-xmark"></i> Rejected</b>'
    +(j?' by <b>'+esc(U().userName(j.acted_by))+'</b> at level '+j.level+' on '+dmy(j.acted_at):'')+(j&&j.remark?'<div style="margin-top:4px;white-space:pre-wrap">'+esc(j.remark)+'</div>':'<div style="margin-top:4px;color:var(--slate)">No reason was given.</div>')
    +'<div style="margin-top:6px;color:var(--slate)">Correct what is needed and send it for approval again (<b>Revise…</b>).</div></div>';
}
function tabMain(){
  const {r,lines}=CUR, uom=u=>U().uomCode(u), f=fy(r.indent_date);
  const rows=lines.map((l,i)=>{
    const bal=+l.qty-+l.ordered_qty-+l.short_closed_qty;
    return '<tr><td>'+(i+1)+'</td><td><span class="pus-code">'+esc(l.items?l.items.code:'')+'</span></td><td><b>'+esc(l.items?l.items.name:'')+'</b></td><td>'+esc(uom(l.uom_id))+'</td>'
      +'<td class="pus-num">'+qty(l.qty)+'</td><td>'+esc(l.remark||'')+'</td><td class="pus-num">'+qty(l.ordered_qty)+'</td><td class="pus-num">'+(+l.short_closed_qty?qty(l.short_closed_qty):'—')+'</td><td class="pus-num"><b>'+qty(bal)+'</b></td></tr>'
      +(+l.short_closed_qty&&l.short_close_reason?'<tr><td></td><td colspan="8" style="font-size:12px;color:var(--slate)">Short closed by '+esc(U().userName(l.short_closed_by))+' on '+dmy(l.short_closed_at)+': '+esc(l.short_close_reason)+'</td></tr>':'');
  }).join('');
  return rejectedBanner(r)+'<div class="pi-form"><div>'+roField('Project',projName(r.project_id))+roField('Document Type',typeName(r.indent_type_id))+roField('Document No',r.doc_no||'Assigned on submission')+roField('RFQs',(I.rfqs[r.id]||[]).map(x=>(x.doc_no||'Draft RFQ')+(x.status==='cancelled'?' (cancelled)':'')).join(', ')||'None yet')
    +'<div class="pi-row"><div class="l">Remarks</div><div class="v pi-ro" style="min-height:70px;white-space:pre-wrap">'+(r.purpose?esc(r.purpose):'&nbsp;')+'</div></div></div>'
    +'<div>'+roField('Financial Year',f.text)+roField('Document Date',dmy(r.indent_date))+roField('Raised by',U().userName(r.raised_by))+'</div></div>'
    +'<div class="card" style="padding:0;margin-top:8px"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>S.No.</th><th>Code</th><th>Description</th><th>Unit</th><th class="pus-num">Quantity</th><th>Detail Description</th><th class="pus-num">Ordered</th><th class="pus-num">Short closed</th><th class="pus-num">Balance</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
}
function tabDelivery(){
  const {r}=CUR;
  return '<div class="pi-form"><div>'+roField('Warehouse',whName(r.warehouse_id))+roField('Required by',dmy(r.required_by))+'</div><div>'
    +'<div class="pi-row"><div class="l">Delivery address</div><div class="v pi-ro" style="min-height:70px;white-space:pre-wrap">'+(r.delivery_address?esc(r.delivery_address):'&nbsp;')+'</div></div>'
    +roField('Contact person',r.contact_person||'')+roField('Contact phone',r.contact_phone||'')+'</div></div>';
}
function tabHistory(){
  const rows=CUR.log.map(x=>'<tr><td>'+esc(U().userName(x.by))+'</td><td style="white-space:nowrap">'+dmyTime(x.at)+'</td><td>'+esc(x.action)+(x.remark?'<div style="font-size:12px;color:var(--slate)">'+esc(x.remark)+'</div>':'')+'</td><td>'+esc(x.ip||'—')+'</td></tr>').join('');
  return '<div class="card" style="padding:0"><table class="tbl"><thead><tr><th>User</th><th>Modified Time</th><th>Action</th><th>IP Address</th></tr></thead><tbody>'+(rows||'<tr><td colspan="4"><div class="empty" style="padding:18px"><div>No history</div></div></td></tr>')+'</tbody></table></div>';
}
function tabApproval(){
  const {r,steps}=CUR, f=fy(r.indent_date);
  const rounds=[...new Set(steps.map(s=>s.round))];
  const done=steps.filter(s=>s.status==='approved'||s.status==='rejected'), pend=steps.filter(s=>s.status==='pending'&&s.round===r.round&&r.status==='pending_approval');
  const doneRows=done.map(s=>'<tr><td>'+esc(U().userName(s.acted_by))+'</td><td>'+esc(profile(s.acted_by))+'</td><td>Level '+s.level+' ('+(s.status==='approved'?'Approved By':'Rejected By')+')</td><td>'+(s.status==='approved'?'Approve':'Reject')+'</td><td style="white-space:nowrap">'+dmyTime(s.acted_at)+'</td><td>'+esc(s.remark||'')+'</td><td>'+esc(U().userName(r.raised_by))+'</td></tr>').join('');
  const pendRows=pend.map(s=>s.approvers.map(e=>'<tr><td>'+esc(U().userName(e))+'</td><td>'+esc(profile(e))+'</td><td>Level '+s.level+' (Approval pending)</td><td>'+esc(U().userName(r.raised_by))+'</td></tr>').join('')).join('');
  return roField('Document No',r.doc_no||'Not submitted yet')
    +'<div class="pi-row"><div class="l">Narration</div><div class="v">Document No : <b>'+esc(r.doc_no||'—')+'</b> &nbsp; Document Date : <b>'+dmy(r.indent_date)+'</b> &nbsp; Type : <b>'+esc(typeName(r.indent_type_id))+'</b> &nbsp; Financial Year : <b>'+esc(f.label)+'</b><br>Remarks : <b>'+esc(r.purpose||'')+'</b></div></div>'
    +'<div class="card" style="padding:0;margin-top:6px"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Approved By</th><th>Profile</th><th>Action Information</th><th>Status</th><th>Date Time</th><th>Remarks</th><th>Created By</th></tr></thead><tbody>'
    +(doneRows||'<tr><td colspan="7"><div class="empty" style="padding:14px"><div>No decisions yet</div></div></td></tr>')+'</tbody></table></div></div>'
    +'<div class="card" style="padding:0;margin-top:14px"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Pending With</th><th>Profile</th><th>Action Information</th><th>Created By</th></tr></thead><tbody>'
    +(pendRows||'<tr><td colspan="4"><div class="empty" style="padding:14px"><div>Nothing pending</div></div></td></tr>')+'</tbody></table></div></div>'
    +(rounds.length>1?'<div class="pus-hint" style="margin-top:10px">This indent has been submitted '+rounds.length+' times; the table lists the decisions from every submission.</div>':'');
}

/* ---------------- create / edit ---------------- */
let ED=null;
// Items are identified by their unique code (Setup -> Items; a code can belong to one item only). On a line you type
// or pick the CODE; the description and unit fill in from the item. The same code cannot be on an indent twice.
const NOITEM='<span style="color:var(--slate)">Auto-filled</span>';
const descHtml=it=>it?'<b>'+esc(it.name)+'</b><div style="font-size:12px;color:var(--slate)">HSN '+esc(it.hsn_code||'—')+(it.make?' · '+esc(it.make):'')+'</div>':NOITEM;
// Layout of the item rows lives in piCss() (.pui-head / .pui-line) so the header and every row share the same columns
// and so a phone gets stacked rows instead of six squashed columns.
const lineHead='<div class="pui-head"><span>Code</span><span>Description</span><span>Unit</span><span>Quantity</span><span>Detail description</span><span></span></div>';
function resolveItem(txt){
  const t=String(txt||'').trim(); if(!t) return null;
  const items=U().S.items.filter(i=>i.active), up=t.toUpperCase();
  return items.find(i=>i.code.toUpperCase()===up)||items.find(i=>(i.code+' — '+i.name).toUpperCase()===up)||items.find(i=>i.name.toLowerCase()===t.toLowerCase())||null;
}
const lineRow=(l)=>{
  const it=l&&U().S.items.find(x=>x.id===l.item_id);
  return '<div class="pui-line"><div class="pic"><input class="il-item" autocomplete="off" placeholder="Item code" value="'+esc(it?it.code:'')+'" data-id="'+(it?it.id:'')+'" onfocus="pusIndCb(this)" oninput="pusIndCbType(this)" onblur="pusIndCbBlur(this)"><div class="pic-list" style="display:none;min-width:360px"></div></div>'
    +'<div class="il-desc" style="font-size:13.5px">'+descHtml(it)+'</div>'
    +'<span class="il-uom" style="font-size:13px;color:var(--slate)">'+(it?esc(U().uomCode(it.receipt_uom_id)):'Unit')+'</span>'
    +'<input class="il-qty" type="number" step="0.001" min="0" placeholder="Quantity" value="'+(l?esc(l.qty):'')+'">'
    +'<input class="il-rem" placeholder="Detail description" value="'+esc(l&&l.remark||'')+'"><button class="btn btn-sm btn-ghost" title="Remove" onclick="this.parentNode.remove()"><i class="fa-solid fa-xmark"></i></button></div>';
};
// The item picker offers ONLY items registered in Setup: a line's item is whatever was picked from the list or typed
// as its exact code (stored in data-id); anything else typed is cleared again when the box loses focus.
function cbSet(inp,it){
  inp.dataset.id=it?it.id:''; inp.value=it?it.code:'';
  const row=inp.closest('.pui-line'), u=row.querySelector('.il-uom'), d=row.querySelector('.il-desc');
  if(u) u.textContent=it?U().uomCode(it.receipt_uom_id):'Unit'; if(d) d.innerHTML=descHtml(it);
}
function cbShow(inp){
  const list=inp.parentNode.querySelector('.pic-list'), q=(inp.dataset.id?'':inp.value).trim().toLowerCase();
  const taken=new Set([...document.querySelectorAll('#puiLines .il-item')].filter(x=>x!==inp&&x.dataset.id).map(x=>x.dataset.id));
  const all=U().S.items.filter(i=>i.active&&!taken.has(String(i.id))&&(!q||(i.code+' '+i.name+' '+i.hsn_code).toLowerCase().includes(q)));
  list.innerHTML=all.slice(0,60).map(i=>'<div class="pic-opt" onmousedown="pusIndCbPick(this,'+i.id+')"><span class="pus-code">'+esc(i.code)+'</span> '+esc(i.name)+' <span style="color:var(--slate)">· '+esc(U().uomCode(i.receipt_uom_id))+'</span></div>').join('')
    +(all.length>60?'<div class="pic-none">'+(all.length-60)+' more — keep typing to narrow</div>':'')
    +(all.length?'':'<div class="pic-none">'+(U().S.items.some(i=>i.active)?'No registered item matches':'No items registered yet — add them under Setup → Items')+'</div>');
  list.style.display='block';
}
window.pusIndCb=function(inp){ cbShow(inp); };
window.pusIndCbType=function(inp){
  inp.dataset.id=''; const row=inp.closest('.pui-line'), u=row.querySelector('.il-uom'), d=row.querySelector('.il-desc'); if(u) u.textContent='Unit'; if(d) d.innerHTML=NOITEM;
  // typing a complete, exact item code fills the line straight away (unless that code is already on another line)
  const t=inp.value.trim().toUpperCase(), it=t?U().S.items.find(i=>i.active&&i.code.toUpperCase()===t):null;
  if(it&&![...document.querySelectorAll('#puiLines .il-item')].some(x=>x!==inp&&x.dataset.id===String(it.id))){ cbSet(inp,it); inp.parentNode.querySelector('.pic-list').style.display='none'; return; }
  cbShow(inp);
};
window.pusIndCbPick=function(opt,id){ const inp=opt.closest('.pic').querySelector('.il-item'); cbSet(inp,U().S.items.find(i=>i.id===id)); opt.closest('.pic-list').style.display='none'; };
window.pusIndCbBlur=function(inp){
  const list=inp.parentNode.querySelector('.pic-list'); if(list) list.style.display='none';
  if(inp.dataset.id) return;                       // a real pick - keep it
  const it=resolveItem(inp.value);                 // typed an exact registered code / name: accept it
  const dup=it&&[...document.querySelectorAll('#puiLines .il-item')].some(x=>x!==inp&&x.dataset.id===String(it.id));
  if(it&&!dup) cbSet(inp,it);
  else if(dup){ toast(it.code+' is already on this indent — change its quantity instead','err'); cbSet(inp,null); }
  else if(inp.value.trim()){ toast('"'+inp.value.trim()+'" is not a registered item code — type a code or pick one from the list','err'); cbSet(inp,null); }
};
window.pusIndAddLine=function(){ $('puiLines').insertAdjacentHTML('beforeend',lineRow(null)); };
function whOptions(pid,sel){
  const w=U().S.warehouses.filter(x=>x.project_id===pid&&x.active);
  return w.length?'<option value="">Choose…</option>'+w.map(x=>'<option value="'+x.id+'"'+(x.id===sel?' selected':'')+'>'+esc(x.name)+' ('+esc(x.code)+')</option>').join(''):'<option value="">No warehouse for this project</option>';
}
window.pusIndProj=function(){ const pid=parseInt(U().val('pieProj'),10)||0; $('pieWh').innerHTML=whOptions(pid,null); };
window.pusIndFy=function(){ const f=$('pieFy'); if(f) f.textContent=fy(U().val('pieDate')).text; };
window.pusIndETab=function(t){
  document.querySelectorAll('#piETabs a').forEach(a=>a.classList.toggle('on',a.dataset.t===t));
  ['main','delivery'].forEach(x=>{ const e=$('pie_'+x); if(e) e.style.display=x===t?'':'none'; });
};
const field=(label,ctl)=>'<div class="pi-row"><div class="l">'+label+'</div><div>'+ctl+'</div></div>';

window.pusIndEdit=async function(id){
  let r=null, lines=[];
  if(id){
    const [h,ls]=await Promise.all([U().PU().from('indents').select('*').eq('id',id).single(),U().PU().from('indent_lines').select('*').eq('indent_id',id).order('line_no')]);
    if(h.error||ls.error){ toast('Could not open the indent','err'); return; }
    r=h.data; lines=ls.data||[];
  }
  ED={id:id||null,locked:!!(r&&r.doc_no),revising:!!(r&&r.status==='rejected')};
  const pid=r?r.project_id:(parseInt(I.project,10)||null), date=r?r.indent_date:new Date().toISOString().slice(0,10);
  const typeOpts='<option value="">Choose…</option>'+I.types.filter(t=>t.active||(r&&r.indent_type_id===t.id)).map(t=>'<option value="'+t.id+'"'+(r&&r.indent_type_id===t.id?' selected':'')+'>'+esc(t.name)+'</option>').join('');
  const revising=!!(r&&r.status==='rejected');
  openModal('<div class="modal-head"><h3>'+(revising?'Revise indent '+esc(docNo(r)):r?'Edit indent '+esc(docNo(r)):'New indent')+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm" style="max-height:calc(90vh - 150px);overflow:auto">'+(revising?rejectedBanner(r):'')+'<div class="pi-tabs" id="piETabs"><a data-t="main" class="on" onclick="pusIndETab(\'main\')">Main Info</a><a data-t="delivery" onclick="pusIndETab(\'delivery\')">Delivery Info</a></div>'
    +'<div id="pie_main"><div class="pi-form"><div>'
      +field('Project','<select id="pieProj" onchange="pusIndProj()"><option value="">Choose…</option>'+U().S.projects.map(p=>'<option value="'+p.id+'"'+(p.id===pid?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select>')
      +field('Document Type','<select id="pieType">'+typeOpts+'</select>')
      +roField('Document No',r&&r.doc_no?r.doc_no:'Assigned on submission')
      +field('Remarks','<textarea id="piePurpose" rows="3" placeholder="e.g. 3rd floor slab, Tower B. Requisition slip no.">'+esc(r&&r.purpose||'')+'</textarea>')
    +'</div><div>'
      +roField('Financial Year','<span id="pieFy">'+fy(date).text+'</span>',true)
      +field('Document Date','<input id="pieDate" type="date" value="'+esc(date)+'" oninput="pusIndFy()"'+(ED.locked?' disabled title="The number is already issued for this financial year"':'')+'>')
    +'</div></div>'
    +'<div class="pus-sub">Items <span style="font-weight:400;text-transform:none;letter-spacing:0">— type or pick the item code; quantity is in the item\'s receiving unit</span></div>'
    +lineHead+'<div id="puiLines">'+(lines.length?lines.map(lineRow).join(''):lineRow(null))+'</div><button class="btn btn-sm" onclick="pusIndAddLine()"><i class="fa-solid fa-plus"></i> Add item</button>'
    +(U().S.items.some(i=>i.active)?'':'<div class="pus-hint" style="margin-top:10px">No items yet — add them under Setup → Items.</div>')+'</div>'
    +'<div id="pie_delivery" style="display:none"><div class="pi-form"><div>'
      +field('Warehouse','<select id="pieWh">'+(pid?whOptions(pid,r?r.warehouse_id:null):'<option value="">Choose a project first</option>')+'</select>')
      +field('Required by','<input id="pieReq" type="date" value="'+esc(r&&r.required_by||'')+'">')
    +'</div><div>'
      +field('Delivery address','<textarea id="pieAddr" rows="3" placeholder="Where the material should be delivered">'+esc(r&&r.delivery_address||'')+'</textarea>')
      +field('Contact person','<input id="pieContact" value="'+esc(r&&r.contact_person||'')+'">')
      +field('Contact phone','<input id="piePhone" value="'+esc(r&&r.contact_phone||'')+'">')
    +'</div></div></div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>'+'<button class="btn" onclick="pusIndSave(false)">'+(revising?'Save changes':'Save draft')+'</button><button class="btn btn-primary" onclick="pusIndSave(true)">'+(revising?'Save & send for approval':'Save & submit')+'</button></div>','xl');
};

window.pusIndSave=async function(submit){
  const {PU,fail,val}=U();
  const project_id=parseInt(val('pieProj'),10), warehouse_id=parseInt(val('pieWh'),10), indent_type_id=parseInt(val('pieType'),10)||null;
  if(!project_id){ toast('Choose the project','err'); return; }
  if(I.types.length&&!indent_type_id){ toast('Choose the document type','err'); return; }
  if(!warehouse_id){ window.pusIndETab('delivery'); toast('Choose the warehouse (Delivery Info)','err'); return; }
  const lines=[], seen=new Set();
  for(const d of document.querySelectorAll('#puiLines .pui-line')){
    const box=d.querySelector('.il-item'), txt=box.value, q=parseFloat(d.querySelector('.il-qty').value), rem=d.querySelector('.il-rem').value.trim();
    if(!txt.trim()&&!d.querySelector('.il-qty').value) continue;
    const it=U().S.items.find(x=>String(x.id)===box.dataset.id);
    if(!it){ toast(txt.trim()?'"'+txt.trim()+'" is not a registered item — pick one from the list':'Pick an item for the line with quantity '+d.querySelector('.il-qty').value,'err'); return; }
    if(!(q>0)){ toast('Enter a quantity for '+it.name,'err'); return; }
    if(seen.has(it.id)){ toast(it.name+' is on the indent twice — combine the quantities','err'); return; }
    seen.add(it.id);
    lines.push({item_id:it.id,qty:q,uom_id:it.receipt_uom_id,remark:rem||null});
  }
  if(!lines.length){ toast('Add at least one item','err'); return; }
  const head={project_id,warehouse_id,indent_type_id,required_by:val('pieReq')||null,purpose:val('piePurpose')||null,
    delivery_address:val('pieAddr')||null,contact_person:val('pieContact')||null,contact_phone:val('piePhone')||null};
  if(!ED.locked&&val('pieDate')) head.indent_date=val('pieDate');
  let iid=ED.id;
  if(iid){ const {error}=await PU().from('indents').update(head).eq('id',iid); if(fail(error)) return; }
  else { const {data,error}=await PU().from('indents').insert(head).select('id').single(); if(fail(error)) return; iid=data.id; }
  const del=await PU().from('indent_lines').delete().eq('indent_id',iid); if(fail(del.error,'Could not update the items')) return;
  const ins=await PU().from('indent_lines').insert(lines.map((l,i)=>({...l,indent_id:iid,line_no:i+1}))); if(fail(ins.error,'Could not save the items')) return;
  if(submit){
    const {data,error}=await PU().rpc('indent_submit',{p_id:iid});
    if(error){ toast('Saved as a draft, but it could not be submitted: '+error.message.replace(/Setup > Approvals/g,'Admin > Approvers'),'warn'); closeModal(); route(); return; }
    closeModal(); toast('Submitted as '+data,'ok'); route(); return;
  }
  closeModal(); toast(ED.revising?'Changes saved — send it for approval when it is ready':'Draft saved','ok'); route();
};

window.pusIndSubmit=async function(id){
  const {data,error}=await U().PU().rpc('indent_submit',{p_id:id});
  if(U().fail(error,'Could not submit')) return;
  closeModal(); toast('Submitted as '+data,'ok'); route();
};

window.pusIndDelete=async function(id){
  if(!await confirmDialog('Delete this draft indent?')) return;
  const {error}=await U().PU().from('indents').update(U().soft()).eq('id',id);
  if(U().fail(error,'Delete failed')) return;
  closeModal(); toast('Draft deleted','ok'); navTo('inventory/2');
};

/* ---------------- approve / reject / short close ---------------- */
window.pusIndDecide=function(id,approve){
  const r=I.rows.find(x=>x.id===id);
  openModal('<div class="modal-head"><h3>'+(approve?'Approve':'Reject')+' indent '+esc(r?docNo(r):'')+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm"><label>'+(approve?'Remark (optional)':'Reason for rejecting')+'</label><textarea id="pidNote" rows="3" placeholder="'+(approve?'':'The raiser sees this and can correct and resubmit')+'"></textarea></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusIndDecideSave('+id+','+approve+')">'+(approve?'Approve':'Reject')+'</button></div>');
};
window.pusIndDecideSave=async function(id,approve){
  const note=U().val('pidNote');
  if(!approve&&!note){ toast('Give a reason for rejecting','err'); return; }
  const {data,error}=await U().PU().rpc('indent_decide',{p_id:id,p_approve:approve,p_remark:note||null});
  if(U().fail(error,approve?'Could not approve':'Could not reject')) return;
  closeModal(); toast(data==='approved'?'Indent approved':data==='rejected'?'Indent rejected':'Approved — passed to the next level','ok'); route();
};

window.pusIndShortClose=async function(id){
  const {data,error}=await U().PU().from('indent_lines').select('*, items(code,name)').eq('indent_id',id).order('line_no');
  if(error){ toast('Could not load the items','err'); return; }
  const open=(data||[]).filter(l=>+l.qty-+l.ordered_qty-+l.short_closed_qty>0);
  openModal('<div class="modal-head"><h3>Short close items</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm">'
    +'<div class="pus-hint" style="margin-top:0">Short closing drops the quantity that has not been ordered yet — it will not be put out for quotation or ordered. It cannot be undone. When nothing is left to order, the indent closes.</div>'
    +open.map(l=>'<label style="display:flex;gap:10px;align-items:center;margin:6px 0"><input type="checkbox" class="pisc" value="'+l.id+'" checked style="width:auto"> <span><b>'+esc(l.items.name)+'</b> — balance '+qty(+l.qty-+l.ordered_qty-+l.short_closed_qty)+' '+esc(U().uomCode(l.uom_id))+'</span></label>').join('')
    +'<label style="margin-top:12px">Reason</label><textarea id="piscReason" rows="3" placeholder="Why is this no longer needed?"></textarea></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusIndShortCloseSave('+id+')">Short close</button></div>');
};
window.pusIndShortCloseSave=async function(id){
  const ids=[...document.querySelectorAll('.pisc:checked')].map(c=>parseInt(c.value,10)), reason=U().val('piscReason');
  if(!ids.length){ toast('Select at least one item','err'); return; }
  if(!reason){ toast('Give a reason','err'); return; }
  const {error}=await U().PU().rpc('indent_short_close',{p_id:id,p_line_ids:ids,p_reason:reason});
  if(U().fail(error,'Could not short close')) return;
  closeModal(); toast('Short closed','ok'); route();
};
// Shared with purchase-rfq.js (same look: tabs, read-only fields).
window.PUS.piCss=piCss; window.PUS.roField=roField; window.PUS.dmy=dmy; window.PUS.dmyTime=dmyTime; window.PUS.fy=fy;
})();
