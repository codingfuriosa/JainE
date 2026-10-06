/* ============================ PURCHASE & STORES — PURCHASE ORDERS (Stage 5) ============================
   Draft orders are made from the quotation comparison (purchase-rfq.js). Here they are adjusted, submitted
   through the project's PO approver chain (value slabs), approved / rejected, amended, cancelled or short
   closed. Spec: docs/purchase-stores-spec.md §5.3. Tables and functions:
   supabase/migrations/20261004330000_purchase_po.sql (+ 20261004450000 for the document type) - every write goes
   through the po_* functions, which enforce the rules (who may approve, quantity reserved on the indents at
   submission, locking).
   Every order shows: Business Unit (the project), Document Type, Document No, Document Date, Financial Year,
   Supplier and Parent Account Head (the supplier's ledger parent description, from the vendor master).
   Two sections, like indents: "Purchase orders" (the register and the approval flow) and "Revise a purchase
   order" (rejected orders and orders being amended, to correct and send for approval again, plus approved
   orders that nothing has been received against, which can be amended).
   Routes: inventory/4/orders, inventory/4/revise (inventory/4/<section>/<id> or inventory/4/<id> opens that order). */
(function(){
if(window.__PUP_LOADED) return;
window.__PUP_LOADED=true;

const P={rows:[],lines:[],pending:[],vendors:[],types:[],rej:[],amends:[],sec:'orders',filter:'all',rv:'all',project:'',q:''};
const SC=[['all','All'],['draft','Drafts'],['pending','Awaiting approval'],['mine','Awaiting my approval'],['approved','Approved'],['closed','Closed'],['cancelled','Cancelled']];
const U=()=>window.PUS;
// The person who raised an order can decide it only when the rule "let a person approve a purchase order they raised" is on (Admin -> Rules); the database enforces the same.
const selfApproval=()=>U().rule('po.allow_self_approval')==='true';
const qty=n=>Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:3});
const money=n=>(n==null||n==='')?'—':'₹'+Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const me=()=>String(state.email||'').toLowerCase();
const projName=id=>{const p=U().S.projects.find(x=>x.id===id);return p?p.name:'—';};
const whName=id=>{const w=U().S.warehouses.find(x=>x.id===id);return w?w.name:'—';};
const vendorById=id=>P.vendors.find(v=>v.id===id);
const vName=v=>v?(v.trade_name||v.legal_name):'—';
const docNo=p=>p.doc_no||('Draft #'+p.id);
const profile=email=>{
  const e=String(email||'').toLowerCase(), ids=U().S.roleMembers.filter(m=>m.email===e).map(m=>m.role_id);
  const names=U().S.roles.filter(r=>ids.includes(r.id)).map(r=>r.name);
  return names.length?names.join(', '):'—';
};
function totals(id){ const ls=P.lines.filter(l=>l.po_id===id); const t={n:ls.length,qty:0,rec:0,short:0}; ls.forEach(l=>{t.qty+=+l.qty;t.rec+=+l.received_qty;t.short+=+l.short_closed_qty;}); t.open=t.qty-t.rec-t.short; return t; }
function status(p){
  switch(p.status){
    case 'draft': return ['Draft'+(p.revision>0?' (rev '+p.revision+')':''),'t-gray'];
    case 'pending_approval': return ['Awaiting level '+p.current_level,'t-amber'];
    case 'approved': { const t=totals(p.id); return t.rec>0?['Partly received','t-blue']:['Approved','t-green']; }
    case 'rejected': return ['Rejected','t-red'];
    case 'closed': return p.closed_kind==='short_closed'?['Short closed','t-gray']:['Fulfilled','t-green'];
    case 'cancelled': return ['Cancelled','t-red'];
  }
  return [p.status,'t-gray'];
}
const statusTag=p=>{const s=status(p);return '<span class="tag '+s[1]+'">'+esc(s[0])+'</span>';};
const isMine=p=>p.status==='pending_approval'&&(selfApproval()||p.raised_by.toLowerCase()!==me())&&P.pending.some(a=>a.po_id===p.id&&a.approvers.some(e=>e.toLowerCase()===me()));
const canEdit=p=>(p.status==='draft'||p.status==='rejected')&&(p.raised_by.toLowerCase()===me()||state.super)&&U().can('po.create');
// While an order is awaiting approval its maker can still change it (and delete it, if it was never approved before). Once approved: amend / cancel only.
const canEditPending=p=>p.status==='pending_approval'&&(p.raised_by.toLowerCase()===me()||state.super)&&U().can('po.create');

async function pLoad(){
  await U().load();
  const PU=U().PU;
  const [r,l,a,x,rv,t,v]=await Promise.all([
    PU().from('pos').select('*').is('deleted_at',null).order('created_at',{ascending:false}),
    PU().from('po_lines').select('id,po_id,qty,received_qty,short_closed_qty'),
    PU().from('po_approvals').select('po_id,level,approvers,round,status').eq('status','pending'),
    PU().from('po_approvals').select('po_id,level,round,acted_by,acted_at,remark').eq('status','rejected'),
    PU().from('po_revisions').select('po_id,revision,reason,created_by,created_at'),
    PU().from('po_types').select('*').is('deleted_at',null).order('sort_order'),
    PU().from('vendors').select('id,code,legal_name,trade_name,gstin,pan,address,city,state,ledger_parent_description').is('deleted_at',null)
  ]);
  const bad=[r,l,a,x,rv,t,v].find(y=>y.error); if(bad) throw bad.error;
  P.rows=r.data||[]; P.lines=l.data||[]; P.pending=a.data||[]; P.rej=x.data||[]; P.amends=rv.data||[]; P.types=t.data||[]; P.vendors=v.data||[];
}
const typeName=id=>{const t=P.types.find(x=>x.id===id);return t?t.name:'—';};
// Parent Account Head: the supplier's ledger parent description (Vendors tab -> Ledger).
const parentHead=id=>{const v=vendorById(id);return v&&v.ledger_parent_description?v.ledger_parent_description:'—';};
const lastRejection=id=>P.rej.filter(x=>x.po_id===id).sort((a,b)=>(b.round-a.round)||String(b.acted_at).localeCompare(String(a.acted_at)))[0]||null;
const lastAmendment=id=>P.amends.filter(x=>x.po_id===id).sort((a,b)=>b.revision-a.revision)[0]||null;
// An order that must be corrected and sent for approval again: rejected, or reopened by an amendment.
const needsRevision=p=>p.status==='rejected'||(p.status==='draft'&&p.revision>0);
// An approved order that nothing has been received against or short closed can still be amended.
const canAmend=p=>{ if(p.status!=='approved') return false; const t=totals(p.id); return t.rec===0&&t.short===0; };

let SEQ=0;
window.pusPoRender=async function(host,seg){
  if(!window.PUS||!window.PUS.piCss){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Purchase could not finish loading - refresh the page.</div></div>'; return; }
  U().css(); U().vcss(); U().piCss();
  const mine=++SEQ, stale=()=>mine!==SEQ||!host.isConnected;
  seg=seg||[]; const explicit=seg[0]==='orders'||seg[0]==='revise';
  if(explicit) P.sec=seg[0];
  const id=parseInt(seg[explicit?1:0],10);
  loader(host);
  try{ await pLoad(); }
  catch(e){ if(!stale()) host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load purchase orders: '+esc(e.message||e)+'</div></div>'; return; }
  if(stale()) return;
  if(id&&!explicit){ const p=P.rows.find(x=>x.id===id); if(p) P.sec=needsRevision(p)?'revise':'orders'; }
  host.innerHTML='<div id="pupHost"></div>';
  pRender();
  if(id) window.pusPoOpen(id);
};

const searchText=p=>docNo(p)+' '+typeName(p.po_type_id)+' '+projName(p.project_id)+' '+vName(vendorById(p.vendor_id))+' '+parentHead(p.vendor_id)+' '+U().fy(p.po_date).label+' '+U().userName(p.raised_by);
const projSelect=()=>'<select id="pupProj" onchange="pusPoProject()"><option value="">All business units</option>'+U().S.projects.map(p=>'<option value="'+p.id+'"'+(String(p.id)===P.project?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select>';
const revTag=p=>p.revision>0?' <span class="tag t-gray" title="Revision '+p.revision+'">Rev '+p.revision+'</span>':'';
function pRender(){
  const host=$('pupHost'); if(!host) return;
  const nFix=P.rows.filter(needsRevision).length, nAmend=P.rows.filter(canAmend).length;
  const secs='<div class="pus-subs" style="margin-bottom:12px"><span class="chip'+(P.sec==='orders'?' active':'')+'" onclick="navTo(\'inventory/4/orders\')">Purchase orders</span>'
    +'<span class="chip'+(P.sec==='revise'?' active':'')+'" onclick="navTo(\'inventory/4/revise\')">Revise a purchase order'+(nFix?' <b style="color:#b91c1c">('+nFix+')</b>':'')+'</span></div>';
  host.innerHTML=secs+'<div id="pupBody"></div>';
  (P.sec==='revise'?renderRevise:renderOrders)($('pupBody'));
}
// Section 1: every order, and the approval flow. Rejected orders and orders reopened by an amendment are in Revise.
function renderOrders(host){
  const q=P.q.toLowerCase();
  const inF=(p,k)=>k==='all'||(k==='draft'&&p.status==='draft')||(k==='pending'&&p.status==='pending_approval')||(k==='mine'&&isMine(p))||(k==='approved'&&p.status==='approved')||(k==='closed'&&p.status==='closed')||(k==='cancelled'&&p.status==='cancelled');
  const base=P.rows.filter(p=>!needsRevision(p)&&(!P.project||String(p.project_id)===P.project));
  const list=base.filter(p=>inF(p,P.filter)&&(!q||searchText(p).toLowerCase().includes(q)));
  const chips=SC.map(([k,l])=>'<span class="chip'+(P.filter===k?' active':'')+'" onclick="pusPoFilter(\''+k+'\')">'+l+' ('+base.filter(p=>inF(p,k)).length+')</span>').join('');
  const rows=list.map(p=>'<tr style="cursor:pointer" onclick="pusPoOpen('+p.id+')"><td>'+esc(projName(p.project_id))+'</td><td>'+esc(typeName(p.po_type_id))+'</td><td><span class="pus-code">'+esc(docNo(p))+'</span>'+revTag(p)+'</td>'
    +'<td style="white-space:nowrap">'+U().dmy(p.po_date)+'</td><td style="white-space:nowrap">'+esc(U().fy(p.po_date).label)+'</td><td><b>'+esc(vName(vendorById(p.vendor_id)))+'</b></td><td>'+esc(parentHead(p.vendor_id))+'</td>'
    +'<td class="pus-num">'+totals(p.id).n+'</td><td class="pus-num"><b>'+money(p.total_amount)+'</b></td><td>'+statusTag(p)+(isMine(p)?' <span class="tag t-blue">Your turn</span>'+U().rowDecide('pusPoDecide',p.id):'')+'</td><td>'+esc(U().userName(p.raised_by))+'</td></tr>').join('');
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">Purchase orders</div><div class="pus-hint" style="margin:0">Orders are created from the quotation comparison (RFQ & Quotes tab → open an RFQ → Comparison → Create purchase order). Here you finish, approve, cancel or short close them. Orders that were rejected, or reopened for an amendment, are under <b>Revise a purchase order</b>.</div></div></div>'
    +'<div class="pus-top"><div class="pus-subs" style="margin:0">'+chips+'</div>'+projSelect()
    +'<input class="grow" id="pupQ" placeholder="Search by document no, type, business unit, supplier or person" value="'+esc(P.q)+'" oninput="pusPoSearch()"></div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Business Unit</th><th>Document Type</th><th>Document No</th><th>Document Date</th><th>Financial Year</th><th>Supplier</th><th>Parent Account Head</th><th class="pus-num">Items</th><th class="pus-num">Amount</th><th>Status</th><th>Raised by</th></tr></thead><tbody>'
    +(rows||'<tr><td colspan="11"><div class="empty" style="padding:24px"><div>'+(base.length?'No purchase orders match':'No purchase orders yet')+'</div></div></td></tr>')+'</tbody></table></div></div>';
}
// Section 2: revise a purchase order.
//  - rejected: correct it and send it for approval again;
//  - reopened by an amendment (a new revision, in draft): finish the changes and send it for approval;
//  - approved with nothing received yet: amend it (it goes back to a draft as the next revision, the current version is kept).
function renderRevise(host){
  const q=P.q.toLowerCase();
  const base=P.rows.filter(p=>(needsRevision(p)||canAmend(p))&&(!P.project||String(p.project_id)===P.project));
  const inF=(p,k)=>k==='all'||(k==='fix'&&needsRevision(p))||(k==='amend'&&canAmend(p));
  const list=base.filter(p=>inF(p,P.rv)&&(!q||searchText(p).toLowerCase().includes(q))).sort((a,b)=>(needsRevision(b)?1:0)-(needsRevision(a)?1:0));
  const chips=[['all','All'],['fix','To revise'],['amend','Can be amended']].map(([k,l])=>'<span class="chip'+(P.rv===k?' active':'')+'" onclick="pusPoRv(\''+k+'\')">'+l+' ('+base.filter(p=>inF(p,k)).length+')</span>').join('');
  const rows=list.map(p=>{
    let why='—', state, act='';
    if(p.status==='rejected'){ const j=lastRejection(p.id); state='<span class="tag t-red">Rejected</span>';
      why=j?'<b>'+esc(U().userName(j.acted_by))+'</b> · level '+j.level+' · '+U().dmy(j.acted_at)+(j.remark?'<div style="white-space:pre-wrap">'+esc(j.remark)+'</div>':'<div style="color:var(--slate)">No reason given</div>'):'—'; }
    else if(p.status==='draft'){ const a=lastAmendment(p.id); state='<span class="tag t-amber">Revision '+p.revision+' in draft</span>';
      why=a?'<b>'+esc(U().userName(a.created_by))+'</b> · '+U().dmy(a.created_at)+(a.reason?'<div style="white-space:pre-wrap">'+esc(a.reason)+'</div>':''):'—'; }
    else state='<span class="tag t-green">Approved — can be amended</span>';
    if(needsRevision(p)&&canEdit(p)) act='<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();pusPoRevise('+p.id+')"><i class="fa-solid fa-pen"></i> Revise</button>';
    else if(canAmend(p)&&U().can('po.create')) act='<button class="btn btn-sm" onclick="event.stopPropagation();pusPoAmend('+p.id+')"><i class="fa-solid fa-file-pen"></i> Amend…</button>';
    return '<tr style="cursor:pointer" onclick="pusPoOpen('+p.id+')"><td>'+esc(projName(p.project_id))+'</td><td>'+esc(typeName(p.po_type_id))+'</td><td><span class="pus-code">'+esc(docNo(p))+'</span>'+revTag(p)+'</td><td><b>'+esc(vName(vendorById(p.vendor_id)))+'</b></td>'
      +'<td class="pus-num"><b>'+money(p.total_amount)+'</b></td><td>'+state+'</td><td style="max-width:320px">'+why+'</td><td>'+esc(U().userName(p.raised_by))+'</td><td class="pus-act">'+act+'</td></tr>'; }).join('');
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">Revise a purchase order</div><div class="pus-hint" style="margin:0">Correct an order an approver rejected, finish an amendment, or amend an approved order that nothing has been received against. A revised order is approved again; every earlier version is kept (Revisions tab). Once goods have been received an order can no longer be amended — short close what is not needed.</div></div></div>'
    +'<div class="pus-top"><div class="pus-subs" style="margin:0">'+chips+'</div>'+projSelect()
    +'<input class="grow" id="pupQ" placeholder="Search by document no, type, business unit, supplier or person" value="'+esc(P.q)+'" oninput="pusPoSearch()"></div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Business Unit</th><th>Document Type</th><th>Document No</th><th>Supplier</th><th class="pus-num">Amount</th><th>State</th><th>Reason</th><th>Raised by</th><th></th></tr></thead><tbody>'
    +(rows||'<tr><td colspan="9"><div class="empty" style="padding:24px"><div>'+(base.length?'No purchase orders match':'No purchase order needs revising, and none can be amended yet')+'</div></div></td></tr>')+'</tbody></table></div></div>';
}
window.pusPoRv=function(k){ P.rv=k; pRender(); };
window.pusPoFilter=function(k){ P.filter=k; pRender(); };
window.pusPoProject=function(){ P.project=U().val('pupProj'); pRender(); };
window.pusPoSearch=function(){ P.q=U().val('pupQ'); const b=$('pupBody'); if(b) (P.sec==='revise'?renderRevise:renderOrders)(b); const e=$('pupQ'); if(e){ e.focus(); e.setSelectionRange(e.value.length,e.value.length); } };

/* ---------------- detail ---------------- */
let CUR=null;   // {p, lines, steps, log, revs, rfq}
const ro=(l,v,h)=>U().roField(l,v,h);

// Fetch one order with its lines, approvals, history and revisions into CUR. False if it cannot be opened.
async function loadCur(id){
  const PU=U().PU;
  const [h,ls,ap,lg,rv]=await Promise.all([
    PU().from('pos').select('*').eq('id',id).maybeSingle(),
    PU().from('po_lines').select('*, items(code,name), po_line_sources(qty,released_qty,indent_lines(indents(doc_no)))').eq('po_id',id).order('line_no'),
    PU().from('po_approvals').select('*').eq('po_id',id).order('round').order('level'),
    PU().from('doc_log').select('*').eq('doc_type','po').eq('doc_id',id).order('at'),
    PU().from('po_revisions').select('*').eq('po_id',id).order('revision')
  ]);
  const bad=[h,ls,ap,lg,rv].find(x=>x.error);
  if(bad){ toast('Could not open the purchase order: '+bad.error.message,'err'); return false; }
  const p=h.data; if(!p||p.deleted_at){ toast('That purchase order no longer exists','err'); return false; }
  let rfq=null; if(p.rfq_id){ const r=await PU().from('rfqs').select('id,doc_no').eq('id',p.rfq_id).maybeSingle(); rfq=r.data||null; }
  if(!P.vendors.length){ const v=await PU().from('vendors').select('id,code,legal_name,trade_name,gstin,pan,address,city,state,ledger_parent_description'); P.vendors=v.data||[]; }
  if(!P.types.length){ const t=await PU().from('po_types').select('*').is('deleted_at',null).order('sort_order'); P.types=t.data||[]; }
  CUR={p,lines:ls.data||[],steps:ap.data||[],log:lg.data||[],revs:rv.data||[],rfq};
  return true;
}
window.pusPoOpen=async function(id,tab){
  if(!await loadCur(id)) return;
  const {p}=CUR;
  const open=CUR.lines.some(l=>+l.qty-+l.received_qty-+l.short_closed_qty>0), untouched=CUR.lines.every(l=>+l.received_qty===0&&+l.short_closed_qty===0);
  const my=p.status==='pending_approval'&&(selfApproval()||p.raised_by.toLowerCase()!==me())&&CUR.steps.some(s=>s.round===p.round&&s.level===p.current_level&&s.status==='pending'&&s.approvers.some(e=>e.toLowerCase()===me()));
  const canCreate=U().can('po.create'), btn=[];
  if(canEdit(p)) btn.push('<button class="btn'+(needsRevision(p)?' btn-primary':'')+'" onclick="pusPoEdit('+id+')"><i class="fa-solid fa-pen"></i> '+(needsRevision(p)?'Revise…':'Edit')+'</button>','<button class="btn'+(needsRevision(p)?'':' btn-primary')+'" onclick="pusPoSubmit('+id+')"'+(needsRevision(p)?' title="Send it for approval again without changing anything"':'')+'><i class="fa-solid fa-paper-plane"></i> '+(needsRevision(p)?'Resubmit unchanged':'Submit for approval')+'</button>');
  if(canEditPending(p)) btn.push('<button class="btn" onclick="pusPoEdit('+id+')" title="Pulls it back from approval; saving sends it to the first approver again"><i class="fa-solid fa-pen"></i> Edit</button>');
  if(my) btn.push('<button class="btn" onclick="pusPoDecide('+id+',false)"><i class="fa-solid fa-circle-xmark"></i> Reject</button>','<button class="btn btn-primary" onclick="pusPoDecide('+id+',true)"><i class="fa-solid fa-circle-check"></i> Approve</button>');
  if(p.status==='approved'&&canCreate&&untouched) btn.push('<button class="btn" onclick="pusPoAmend('+id+')"><i class="fa-solid fa-file-pen"></i> Amend…</button>');
  if(p.status==='approved'&&open&&U().can('po.short_close')) btn.push('<button class="btn" onclick="pusPoShortClose('+id+')"><i class="fa-solid fa-scissors"></i> Short close…</button>');
  const left=[];
  if(canCreate&&['draft','rejected'].includes(p.status)&&canEdit(p)) left.push('<button class="btn btn-ghost" onclick="pusPoCancel('+id+')"><i class="fa-solid fa-ban"></i> Cancel order</button>');
  if(canCreate&&p.status==='approved'&&untouched) left.push('<button class="btn btn-ghost" onclick="pusPoCancel('+id+')"><i class="fa-solid fa-ban"></i> Cancel order</button>');
  if(p.status==='draft'&&canEdit(p)&&p.revision===0) left.push('<button class="btn btn-ghost" onclick="pusPoDelete('+id+')"><i class="fa-solid fa-trash"></i> Delete draft</button>');
  if(canEditPending(p)&&p.revision===0) left.push('<button class="btn btn-ghost" onclick="pusPoDelete('+id+')"><i class="fa-solid fa-trash"></i> Delete</button>');
  const tabs=[['main','Main Info'],['items','Items'],['terms','Terms & Delivery'],['history','Change History'],['approval','Approval History']].concat(CUR.revs.length?[['revs','Revisions ('+CUR.revs.length+')']]:[]);
  openModal('<div class="modal-head"><h3>Purchase order '+esc(docNo(p))+' '+statusTag(p)+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="max-height:calc(90vh - 150px);overflow:auto">'+U().stuckBanner({status:p.status,round:p.round,level:p.current_level,steps:CUR.steps,raisedBy:p.raised_by,allowSelf:selfApproval(),what:'purchase order'})+'<div class="pi-tabs" id="ppTabs">'+tabs.map(t=>'<a data-t="'+t[0]+'" onclick="pusPoTab(\''+t[0]+'\')">'+t[1]+'</a>').join('')+'</div><div id="ppBody"></div></div>'
    +'<div class="modal-foot"><div style="margin-right:auto;display:flex;gap:6px">'+left.join('')+'</div><button class="btn" onclick="closeModal()">Close</button>'+btn.join('')+'</div>','xl');
  window.pusPoTab(tab||'main');
};
window.pusPoTab=function(t){
  document.querySelectorAll('#ppTabs a').forEach(a=>a.classList.toggle('on',a.dataset.t===t));
  const b=$('ppBody'); if(!b||!CUR) return;
  b.innerHTML=({main:tabMain,items:tabItems,terms:tabTerms,history:tabHistory,approval:tabApproval,revs:tabRevs}[t])();
};

// Why a rejected order came back - on the order itself and at the top of the revise form.
function rejectedBanner(p){
  if(p.status!=='rejected') return '';
  const j=lastRejection(p.id)||(CUR&&CUR.steps.filter(s=>s.status==='rejected').sort((a,b)=>b.round-a.round)[0]);
  return '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:11px 14px;margin-bottom:12px;font-size:13.5px"><b style="color:#b91c1c"><i class="fa-solid fa-circle-xmark"></i> Rejected</b>'
    +(j?' by <b>'+esc(U().userName(j.acted_by))+'</b> at level '+j.level+' on '+U().dmy(j.acted_at):'')+(j&&j.remark?'<div style="margin-top:4px;white-space:pre-wrap">'+esc(j.remark)+'</div>':'<div style="margin-top:4px;color:var(--slate)">No reason was given.</div>')
    +'<div style="margin-top:6px;color:var(--slate)">Correct what is needed and send it for approval again (<b>Revise…</b>).</div></div>';
}
function tabMain(){
  const {p,rfq}=CUR, v=vendorById(p.vendor_id), f=U().fy(p.po_date);
  const am=p.status==='draft'&&p.revision>0&&lastAmendment(p.id);
  return rejectedBanner(p)+(am?'<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:11px 14px;margin-bottom:12px;font-size:13.5px"><b style="color:#b45309"><i class="fa-solid fa-file-pen"></i> Revision '+p.revision+' in draft</b> — amended by '+esc(U().userName(am.created_by))+' on '+U().dmy(am.created_at)+(am.reason?': '+esc(am.reason):'')+'<div style="margin-top:6px;color:var(--slate)">Make the changes (<b>Edit</b>) and send it for approval.</div></div>':'')
    +'<div class="pi-form"><div>'+ro('Business Unit',projName(p.project_id))+ro('Document Type',typeName(p.po_type_id))+ro('Document No',p.doc_no||'Assigned on submission')+ro('Document Date',U().dmy(p.po_date))+ro('Financial Year',f.text)
    +ro('Supplier',vName(v)+(v&&v.gstin?'  ·  GSTIN '+v.gstin:''))+ro('Parent Account Head',parentHead(p.vendor_id))+'</div><div>'+ro('RFQ',rfq?(rfq.doc_no||'RFQ'):'—')+ro('Deliver to',whName(p.warehouse_id))+ro('Revision',String(p.revision))+ro('Raised by',U().userName(p.raised_by))+'</div></div>'
    +'<div class="pi-row"><div class="l">Remarks</div><div class="v pi-ro" style="min-height:48px;white-space:pre-wrap">'+(p.remarks?esc(p.remarks):'&nbsp;')+'</div></div>'
    +'<div style="display:flex;justify-content:flex-end"><table class="tbl" style="width:auto;min-width:300px"><tbody><tr><td>Basic amount</td><td class="pus-num">'+money(p.total_basic)+'</td></tr><tr><td>GST</td><td class="pus-num">'+money(p.total_gst)+'</td></tr><tr><td><b>Total</b></td><td class="pus-num"><b>'+money(p.total_amount)+'</b></td></tr></tbody></table></div>'
    +(p.status==='cancelled'?'<div class="pus-hint">Cancelled'+(p.cancel_reason?': '+esc(p.cancel_reason):'')+'</div>':'');
}
function tabItems(){
  const {lines}=CUR, uom=u=>U().uomCode(u);
  const rows=lines.map((l,i)=>{ const bal=+l.qty-+l.received_qty-+l.short_closed_qty;
    const src=(l.po_line_sources||[]).map(s=>esc((s.indent_lines&&s.indent_lines.indents&&s.indent_lines.indents.doc_no)||'Indent')+' ('+qty(s.qty)+')').join(', ');
    return '<tr><td>'+(i+1)+'</td><td><span class="pus-code">'+esc(l.items.code)+'</span></td><td><b>'+esc(l.items.name)+'</b>'+(l.make?'<div style="font-size:12px;color:var(--slate)">Make: '+esc(l.make)+'</div>':'')+(src?'<div style="font-size:11.5px;color:var(--slate)">From '+src+'</div>':'')+'</td><td>'+esc(l.hsn_code||'')+'</td><td>'+esc(uom(l.uom_id))+'</td>'
      +'<td class="pus-num">'+qty(l.qty)+'</td><td class="pus-num">'+money(l.rate)+'</td><td class="pus-num">'+qty(l.gst_rate)+'%</td><td class="pus-num">'+money(l.amount)+'</td><td class="pus-num">'+money(l.gst_amount)+'</td><td class="pus-num"><b>'+money(+l.amount+ +l.gst_amount)+'</b></td>'
      +'<td class="pus-num">'+qty(l.received_qty)+'</td><td class="pus-num">'+(+l.short_closed_qty?qty(l.short_closed_qty):'—')+'</td><td class="pus-num"><b>'+qty(bal)+'</b></td></tr>'
      +(+l.short_closed_qty&&l.short_close_reason?'<tr><td></td><td colspan="13" style="font-size:12px;color:var(--slate)">Short closed by '+esc(U().userName(l.short_closed_by))+' on '+U().dmy(l.short_closed_at)+': '+esc(l.short_close_reason)+'</td></tr>':''); }).join('');
  return '<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>S.No.</th><th>Code</th><th>Description</th><th>HSN</th><th>Unit</th><th class="pus-num">Qty</th><th class="pus-num">Rate</th><th class="pus-num">GST</th><th class="pus-num">Amount</th><th class="pus-num">GST amt</th><th class="pus-num">Total</th><th class="pus-num">Received</th><th class="pus-num">Short closed</th><th class="pus-num">Balance</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
}
function tabTerms(){
  const {p}=CUR, area=(l,v)=>'<div class="pi-row"><div class="l">'+l+'</div><div class="v pi-ro" style="min-height:48px;white-space:pre-wrap">'+(v?esc(v):'&nbsp;')+'</div></div>';
  return '<div class="pi-form"><div>'+area('Payment terms',p.payment_terms)+area('Delivery',p.delivery_terms)+area('Warranty / guarantee',p.warranty_terms)+area('Freight',p.freight_terms)+'</div><div>'
    +area('Price validity',p.price_validity)+area('Other terms',p.other_terms)+area('Delivery address',p.delivery_address)+ro('Contact person',p.contact_person||'')+ro('Contact phone',p.contact_phone||'')+'</div></div>';
}
function tabHistory(){
  const rows=CUR.log.map(x=>'<tr><td>'+esc(U().userName(x.by))+'</td><td style="white-space:nowrap">'+U().dmyTime(x.at)+'</td><td>'+esc(x.action)+(x.remark?'<div style="font-size:12px;color:var(--slate)">'+esc(x.remark)+'</div>':'')+'</td><td>'+esc(x.ip||'—')+'</td></tr>').join('');
  return '<div class="card" style="padding:0"><table class="tbl"><thead><tr><th>User</th><th>Modified Time</th><th>Action</th><th>IP Address</th></tr></thead><tbody>'+(rows||'<tr><td colspan="4"><div class="empty" style="padding:18px"><div>No history</div></div></td></tr>')+'</tbody></table></div>';
}
function tabApproval(){
  const {p,steps}=CUR, rounds=[...new Set(steps.map(s=>s.round))];
  const done=steps.filter(s=>s.status==='approved'||s.status==='rejected'), pend=steps.filter(s=>s.status==='pending'&&s.round===p.round&&p.status==='pending_approval');
  const doneRows=done.map(s=>'<tr><td>'+esc(U().userName(s.acted_by))+'</td><td>'+esc(profile(s.acted_by))+'</td><td>Level '+s.level+' ('+(s.status==='approved'?'Approved By':'Rejected By')+')</td><td>'+(s.status==='approved'?'Approve':'Reject')+'</td><td style="white-space:nowrap">'+U().dmyTime(s.acted_at)+'</td><td>'+esc(s.remark||'')+'</td><td>'+esc(U().userName(p.raised_by))+'</td></tr>').join('');
  const pendRows=pend.map(s=>s.approvers.map(e=>'<tr><td>'+esc(U().userName(e))+'</td><td>'+esc(profile(e))+'</td><td>Level '+s.level+' (Approval pending with '+esc(U().userName(e))+')</td><td>'+esc(U().userName(p.raised_by))+'</td></tr>').join('')).join('');
  return ro('Document No',p.doc_no||'Not submitted yet')
    +'<div class="pi-row"><div class="l">Narration</div><div class="v">PO No : <b>'+esc(p.doc_no||'—')+'</b> &nbsp; Date : <b>'+U().dmy(p.po_date)+'</b> &nbsp; Vendor : <b>'+esc(vName(vendorById(p.vendor_id)))+'</b> &nbsp; Amount : <b>'+money(p.total_amount)+'</b></div></div>'
    +'<div class="card" style="padding:0;margin-top:6px"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Approved By</th><th>Profile</th><th>Action Information</th><th>Status</th><th>Date Time</th><th>Remarks</th><th>Created By</th></tr></thead><tbody>'
    +(doneRows||'<tr><td colspan="7"><div class="empty" style="padding:14px"><div>No decisions yet</div></div></td></tr>')+'</tbody></table></div></div>'
    +'<div class="card" style="padding:0;margin-top:14px"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Pending With</th><th>Profile</th><th>Action Information</th><th>Created By</th></tr></thead><tbody>'
    +(pendRows||'<tr><td colspan="4"><div class="empty" style="padding:14px"><div>Nothing pending</div></div></td></tr>')+'</tbody></table></div></div>'
    +(rounds.length>1?'<div class="pus-hint" style="margin-top:10px">This order has been submitted '+rounds.length+' times; the table lists the decisions from every submission.</div>':'');
}
function tabRevs(){
  return CUR.revs.slice().reverse().map(r=>{ const s=r.snapshot||{}, po=s.po||{}, ls=s.lines||[];
    return '<div class="card card-pad" style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;gap:10px"><b>Revision '+r.revision+'</b><span style="color:var(--slate);font-size:12.5px">replaced on '+U().dmyTime(r.created_at)+' by '+esc(U().userName(r.created_by))+'</span></div>'
      +'<div class="pus-hint" style="margin:4px 0 8px">Reason: '+esc(r.reason||'')+' · total then '+money(po.total_amount)+'</div>'
      +'<table class="tbl"><thead><tr><th>Item</th><th class="pus-num">Qty</th><th class="pus-num">Rate</th><th class="pus-num">GST</th></tr></thead><tbody>'+ls.map(l=>'<tr><td>'+esc((CUR.lines.find(x=>x.item_id===l.item_id)||{items:{name:'Item '+l.item_id}}).items.name)+'</td><td class="pus-num">'+qty(l.qty)+'</td><td class="pus-num">'+money(l.rate)+'</td><td class="pus-num">'+qty(l.gst_rate)+'%</td></tr>').join('')+'</tbody></table></div>'; }).join('');
}

/* ---------------- edit a draft / rejected order ---------------- */
let ED=null;
window.pusPoEdit=function(id){
  const {p,lines}=CUR; ED={id,lines};
  const wh=U().S.warehouses.filter(w=>w.project_id===p.project_id&&w.active);
  const f=(label,ctl)=>'<div class="pi-row"><div class="l">'+label+'</div><div>'+ctl+'</div></div>';
  const rows=lines.map((l,i)=>'<tr class="pe-line" data-id="'+l.id+'"><td>'+(i+1)+'</td><td><b>'+esc(l.items.name)+'</b><div style="font-size:12px;color:var(--slate)">'+esc(l.items.code)+' · HSN '+esc(l.hsn_code||'')+' · '+esc(U().uomCode(l.uom_id))+'</div></td>'
    +'<td><input class="pe-qty" type="number" step="0.001" min="0" style="width:96px" value="'+esc(l.qty)+'" oninput="pusPoCalc()"></td><td><input class="pe-rate" type="number" step="0.01" min="0" style="width:100px" value="'+esc(l.rate)+'" oninput="pusPoCalc()"></td>'
    +'<td><input class="pe-gst" type="number" step="0.01" min="0" max="100" style="width:68px" value="'+esc(l.gst_rate)+'" oninput="pusPoCalc()"></td><td><input class="pe-make" style="width:110px" value="'+esc(l.make||'')+'"></td><td><input class="pe-rem" style="width:130px" value="'+esc(l.remark||'')+'"></td><td class="pus-num pe-tot"></td></tr>').join('');
  const t=k=>esc(p[k]||'');
  const revising=needsRevision(p), pending=p.status==='pending_approval', v=vendorById(p.vendor_id), fy=U().fy(p.po_date);
  ED.revising=revising; ED.pending=pending;
  const pendingNote='<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:11px 14px;margin-bottom:12px;font-size:13.5px"><b style="color:#b45309"><i class="fa-solid fa-hourglass-half"></i> Awaiting approval</b><div style="margin-top:4px">Saving your changes pulls this order back and sends it to the first approver again. Approvals given so far no longer count, and the indent quantity it holds is released and taken again. Press Cancel to leave it as it is.</div></div>';
  const typeOpts='<select id="peType">'+P.types.filter(x=>x.active||x.id===p.po_type_id).map(x=>'<option value="'+x.id+'"'+(x.id===p.po_type_id?' selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select>';
  const head='<div class="pi-form"><div>'+ro('Business Unit',projName(p.project_id))+f('Document Type',typeOpts)+ro('Document No',p.doc_no||'Assigned on submission')+ro('Document Date',U().dmy(p.po_date))+'</div><div>'
    +ro('Financial Year',fy.text)+ro('Supplier',vName(v)+(v&&v.gstin?'  ·  GSTIN '+v.gstin:''))+ro('Parent Account Head',parentHead(p.vendor_id))+'</div></div>';
  openModal('<div class="modal-head"><h3>'+(revising?'Revise':'Edit')+' purchase order '+esc(docNo(p))+(p.revision>0?' · Rev '+p.revision:'')+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm" style="max-height:calc(90vh - 150px);overflow:auto">'
    +rejectedBanner(p)+(pending?pendingNote:'')+head
    +'<div class="pus-hint" style="margin-top:0">Rates, GST and make came from the vendor\'s quotation. You can adjust quantities (never above what the RFQ asked for) and any number here; the vendor and items cannot be changed — cancel and make a new order for that.</div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Rate (₹)</th><th>GST %</th><th>Make</th><th>Remark</th><th class="pus-num">Line total</th></tr></thead><tbody>'+rows+'</tbody><tfoot><tr><td colspan="7" style="text-align:right"><b>Order total</b></td><td class="pus-num"><b id="peTotal"></b></td></tr></tfoot></table></div></div>'
    +'<div class="pi-form" style="margin-top:14px"><div>'
      +f('Deliver to','<select id="peWh">'+wh.map(w=>'<option value="'+w.id+'"'+(w.id===p.warehouse_id?' selected':'')+'>'+esc(w.name)+' ('+esc(w.code)+')</option>').join('')+'</select>')
      +f('Delivery address','<textarea id="peAddr" rows="2">'+t('delivery_address')+'</textarea>')+f('Contact person','<input id="peContact" value="'+t('contact_person')+'">')+f('Contact phone','<input id="pePhone" value="'+t('contact_phone')+'">')+f('Remarks','<textarea id="peRem" rows="2">'+t('remarks')+'</textarea>')
    +'</div><div>'
      +f('Payment terms','<input id="pePay" value="'+t('payment_terms')+'">')+f('Delivery','<input id="peDel" value="'+t('delivery_terms')+'">')+f('Warranty / guarantee','<input id="peWar" value="'+t('warranty_terms')+'">')
      +f('Freight','<input id="peFre" value="'+t('freight_terms')+'">')+f('Price validity','<input id="peVal" value="'+t('price_validity')+'">')+f('Other terms','<input id="peOth" value="'+t('other_terms')+'">')
    +'</div></div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>'+(pending?'':'<button class="btn" onclick="pusPoSave(false)">'+(revising?'Save changes':'Save')+'</button>')+'<button class="btn btn-primary" onclick="pusPoSave(true)">'+(pending?'Save & send for approval again':revising?'Save & send for approval':'Save & submit')+'</button></div>','xl');
  window.pusPoCalc();
};
window.pusPoCalc=function(){
  let basic=0, gst=0;
  document.querySelectorAll('.pe-line').forEach(tr=>{ const q=parseFloat(tr.querySelector('.pe-qty').value)||0, r=parseFloat(tr.querySelector('.pe-rate').value)||0, g=parseFloat(tr.querySelector('.pe-gst').value)||0;
    const a=Math.round(q*r*100)/100, ga=Math.round(a*g)/100; basic+=a; gst+=ga; tr.querySelector('.pe-tot').textContent=money(a+ga); });
  const e=$('peTotal'); if(e) e.textContent=money(basic+gst);
};
window.pusPoSave=async function(submit){
  const v=U().val, lines=[];
  for(const tr of document.querySelectorAll('.pe-line')){
    const q=parseFloat(tr.querySelector('.pe-qty').value), r=parseFloat(tr.querySelector('.pe-rate').value), g=parseFloat(tr.querySelector('.pe-gst').value);
    if(!(q>0)){ toast('Every quantity must be more than 0','err'); return; }
    if(!(r>0)){ toast('Every rate must be more than 0','err'); return; }
    if(!(g>=0&&g<=100)){ toast('GST must be between 0 and 100','err'); return; }
    lines.push({id:parseInt(tr.dataset.id,10),qty:q,rate:r,gst_rate:g,make:tr.querySelector('.pe-make').value.trim(),remark:tr.querySelector('.pe-rem').value.trim()});
  }
  const head={po_type_id:parseInt(v('peType'),10)||null,warehouse_id:parseInt(v('peWh'),10)||null,delivery_address:v('peAddr'),contact_person:v('peContact'),contact_phone:v('pePhone'),remarks:v('peRem'),
    payment_terms:v('pePay'),delivery_terms:v('peDel'),warranty_terms:v('peWar'),freight_terms:v('peFre'),price_validity:v('peVal'),other_terms:v('peOth')};
  let pulledBack=false;
  if(ED.pending){                      // awaiting approval: pull it back first (database function), then it is an ordinary draft
    const w=await U().PU().rpc('po_withdraw',{p_id:ED.id}); if(U().fail(w.error,'Could not pull the order back from approval')) return;
    pulledBack=true; submit=true;
  }
  const {error}=await U().PU().rpc('po_update',{p_id:ED.id,p_head:head,p_lines:lines});
  if(U().fail(error,'Could not save')){ if(pulledBack) toast('The order was pulled back from approval and is now a draft. Fix the problem, then send it again.','warn'); return; }
  if(submit){
    const r=await U().PU().rpc('po_submit',{p_id:ED.id});
    if(r.error){ toast('Saved, but it could not be submitted: '+r.error.message.replace(/Setup > Approvals/g,'Admin > Approvers'),'warn'); closeModal(); route(); return; }
    closeModal(); toast(pulledBack?'Saved and sent for approval again as '+r.data:'Submitted as '+r.data,'ok'); route(); return;
  }
  closeModal(); toast(ED.revising?'Changes saved — send it for approval when it is ready':'Saved','ok'); route();
};
// From the Revise list: open the correction form straight away.
window.pusPoRevise=async function(id){
  if(!await loadCur(id)) return;
  window.pusPoEdit(id);
};

/* ---------------- state changes ---------------- */
window.pusPoSubmit=async function(id){
  const {data,error}=await U().PU().rpc('po_submit',{p_id:id});
  if(U().fail(error,'Could not submit')) return;
  closeModal(); toast('Submitted as '+data+' — the indent quantity is now reserved','ok'); route();
};
window.pusPoDelete=async function(id){
  const p=(CUR&&CUR.p.id===id)?CUR.p:P.rows.find(x=>x.id===id), pending=!!(p&&p.status==='pending_approval');
  if(!await confirmDialog(pending?'Delete this purchase order? It is awaiting approval — the approvers will no longer see it, and the indent quantity it holds is released. This cannot be undone.':'Delete this draft purchase order?')) return;
  const {error}=await U().PU().rpc('po_delete',{p_id:id});
  if(U().fail(error,'Delete failed')) return;
  closeModal(); toast(pending?'Purchase order deleted':'Draft deleted','ok'); navTo('inventory/4');
};
window.pusPoDecide=function(id,approve){
  const p=(CUR&&CUR.p&&CUR.p.id===id)?CUR.p:P.rows.find(x=>x.id===id);   // from the open document, or straight from a register row
  if(!p) return;
  openModal('<div class="modal-head"><h3>'+(approve?'Approve':'Reject')+' purchase order '+esc(docNo(p))+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm"><div class="pus-hint" style="margin-top:0">Total '+money(p.total_amount)+' to '+esc(vName(vendorById(p.vendor_id)))+'.</div><label>'+(approve?'Remark (optional)':'Reason for rejecting')+'</label><textarea id="ppNote" rows="3" placeholder="'+(approve?'':'The raiser sees this and can correct and resubmit')+'"></textarea></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusPoDecideSave('+id+','+approve+')">'+(approve?'Approve':'Reject')+'</button></div>');
};
window.pusPoDecideSave=async function(id,approve){
  const note=U().val('ppNote'); if(!approve&&!note){ toast('Give a reason for rejecting','err'); return; }
  const {data,error}=await U().PU().rpc('po_decide',{p_id:id,p_approve:approve,p_remark:note||null});
  if(U().fail(error,approve?'Could not approve':'Could not reject')) return;
  closeModal(); toast(data==='approved'?'Purchase order approved':data==='rejected'?'Purchase order rejected — the indent quantity was released':'Approved — passed to the next level','ok'); route();
};
window.pusPoCancel=function(id){
  openModal('<div class="modal-head"><h3>Cancel purchase order</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><div class="pus-hint" style="margin-top:0">Any indent quantity this order holds is released, and the items become free to order again.</div><label>Reason</label><textarea id="ppWhy" rows="3"></textarea></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Keep it</button><button class="btn btn-primary" onclick="pusPoCancelSave('+id+')">Cancel order</button></div>');
};
window.pusPoCancelSave=async function(id){
  const why=U().val('ppWhy'); if(!why){ toast('Give a reason','err'); return; }
  const {error}=await U().PU().rpc('po_cancel',{p_id:id,p_reason:why});
  if(U().fail(error,'Could not cancel')) return;
  closeModal(); toast('Purchase order cancelled','ok'); route();
};
window.pusPoAmend=function(id){
  openModal('<div class="modal-head"><h3>Amend purchase order</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><div class="pus-hint" style="margin-top:0">The order goes back to a draft as the next revision (the current version is kept), and has to be approved again. Its indent quantity is released until you resubmit.</div><label>Reason for the amendment</label><textarea id="ppWhy" rows="3"></textarea></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusPoAmendSave('+id+')">Amend</button></div>');
};
window.pusPoAmendSave=async function(id){
  const why=U().val('ppWhy'); if(!why){ toast('Give a reason','err'); return; }
  const {data,error}=await U().PU().rpc('po_amend',{p_id:id,p_reason:why});
  if(U().fail(error,'Could not amend')) return;
  closeModal(); toast('Revision '+data+' opened as a draft — edit it, then resubmit','ok'); window.pusPoOpen(id);
};
window.pusPoShortClose=function(id){
  const open=CUR.lines.filter(l=>+l.qty-+l.received_qty-+l.short_closed_qty>0);
  openModal('<div class="modal-head"><h3>Short close items</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm">'
    +'<div class="pus-hint" style="margin-top:0">Closes the quantity not yet received. It cannot be undone. When nothing is left to receive, the order closes.</div>'
    +open.map(l=>'<label style="display:flex;gap:10px;align-items:center;margin:6px 0"><input type="checkbox" class="ppsc" value="'+l.id+'" checked style="width:auto"> <span><b>'+esc(l.items.name)+'</b> — balance '+qty(+l.qty-+l.received_qty-+l.short_closed_qty)+' '+esc(U().uomCode(l.uom_id))+'</span></label>').join('')
    +'<label style="display:flex;gap:10px;align-items:center;margin-top:12px"><input type="checkbox" id="ppRelease" style="width:auto"> <span>Return this quantity to the indents so it can be ordered again</span></label>'
    +'<label style="margin-top:12px">Reason</label><textarea id="ppscReason" rows="3"></textarea></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusPoShortCloseSave('+id+')">Short close</button></div>');
};
window.pusPoShortCloseSave=async function(id){
  const ids=[...document.querySelectorAll('.ppsc:checked')].map(c=>parseInt(c.value,10)), why=U().val('ppscReason');
  if(!ids.length){ toast('Select at least one item','err'); return; }
  if(!why){ toast('Give a reason','err'); return; }
  const {error}=await U().PU().rpc('po_short_close',{p_id:id,p_line_ids:ids,p_reason:why,p_release:$('ppRelease').checked});
  if(U().fail(error,'Could not short close')) return;
  closeModal(); toast('Short closed','ok'); route();
};
})();
