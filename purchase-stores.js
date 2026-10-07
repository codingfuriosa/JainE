/* ============================ PURCHASE & STORES — STORES (Stage 6) ============================
   Goods receipt (GRN) against approved purchase orders, returns to vendors, issues and issue returns,
   stock adjustments (approved before they post), transfers between warehouses, and the stock ledger.
   Spec: docs/purchase-stores-spec.md §6. Tables and functions: supabase/migrations/20261004350000_purchase_stores.sql.
   Every write goes through the grn_* / rtv_* / issue_* / adjustment_* / transfer_* functions, which keep the
   stock ledger and weighted-average balances right (stock can never go negative).
   Routes: inventory/5/<grn|rtv|issues|returns|adjustments|transfers>[/<id>]  and  inventory/6 (stock ledger). */
(function(){
if(window.__PST_LOADED) return;
window.__PST_LOADED=true;

const U=()=>window.PUS;
// The person who raised an adjustment can decide it only when the matching rule is on (Admin -> Rules); the database enforces the same.
const selfApproval=()=>U().rule('adjustment.allow_self_approval')==='true';
const qty=n=>Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:3});
const money=n=>(n==null||n==='')?'—':'₹'+Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const me=()=>String(state.email||'').toLowerCase();
const today=()=>new Date().toISOString().slice(0,10);
const itemById=id=>U().S.items.find(i=>i.id===id);
const itemName=id=>{const i=itemById(id);return i?i.name:'—';};
const stockUnit=id=>{const i=itemById(id);return i?U().uomCode(i.stock_uom_id):'';};
const whById=id=>U().S.warehouses.find(w=>w.id===id);
const whName=id=>{const w=whById(id);return w?w.name:'—';};
const projName=id=>{const p=U().S.projects.find(x=>x.id===id);return p?p.name:'—';};
const uname=e=>U().userName(e);
const SECTIONS=[['grn','GRN'],['rtv','Returns to vendor'],['issues','Issues'],['returns','Issue returns'],['adjustments','Adjustments'],['transfers','Transfers']];
const SECPERM={grn:'grn.post',rtv:'grn.post',issues:'stock.issue',returns:'stock.issue',adjustments:'stock.adjust',transfers:'stock.transfer'};
const ro=(l,v,h)=>U().roField(l,v,h);
const profile=email=>{
  const e=String(email||'').toLowerCase(), ids=U().S.roleMembers.filter(m=>m.email===e).map(m=>m.role_id);
  const names=U().S.roles.filter(r=>ids.includes(r.id)).map(r=>r.name);
  return names.length?names.join(', '):'—';
};
const whOptions=(sel,filter)=>'<option value="">Choose…</option>'+U().S.warehouses.filter(w=>w.active&&(!filter||filter(w))).map(w=>'<option value="'+w.id+'"'+(w.id===sel?' selected':'')+'>'+esc(w.name)+' ('+esc(projName(w.project_id))+')</option>').join('');
const field=(label,ctl)=>'<div class="pi-row"><div class="l">'+label+'</div><div>'+ctl+'</div></div>';
const num=(v)=>{const n=parseFloat(v);return isFinite(n)?n:0;};

let SEQ=0, CURSEC='grn';
async function ensureData(){ await U().load(); }

window.pusStoresRender=async function(host,seg){
  if(!window.PUS||!window.PUS.piCss){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Purchase could not finish loading - refresh the page.</div></div>'; return; }
  U().css(); U().vcss(); U().piCss();
  const mine=++SEQ, stale=()=>mine!==SEQ||!host.isConnected;
  seg=seg||[]; CURSEC=SECTIONS.some(s=>s[0]===seg[0])?seg[0]:'grn';
  loader(host);
  try{ await ensureData(); }
  catch(e){ if(!stale()) host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load: '+esc(e.message||e)+'</div></div>'; return; }
  if(stale()) return;
  host.innerHTML='<div class="pus-subs">'+SECTIONS.map(s=>'<span class="chip'+(s[0]===CURSEC?' active':'')+'" onclick="navTo(\'inventory/5/'+s[0]+'\')">'+s[1]+'</span>').join('')+'</div><div id="pstBody"></div>';
  const body=$('pstBody'); loader(body);
  try{ await ({grn:grnList,rtv:rtvList,issues:issueList,returns:returnList,adjustments:adjList,transfers:trfList}[CURSEC])(body); }
  catch(e){ if(!stale()) body.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load: '+esc(e.message||e)+'</div></div>'; return; }
  const id=parseInt(seg[1],10);
  if(id&&!stale()) ({grn:window.pusGrnOpen,issues:window.pusIssueOpen,adjustments:window.pusAdjOpen,transfers:window.pusTrfOpen}[CURSEC]||function(){})(id);
};

// Business-unit filter at the front of every list's filter row (shared state: U().S.bu, set by pusBuSet in purchase.js).
const inBu=pid=>U().inBu(pid);
const buSel=()=>'<select id="pstBu" onchange="pusBuSet(this.value)" title="Business unit">'+U().buOptions()+'</select>';
const buBar=top=>top?top.replace('<div class="pus-top">','<div class="pus-top">'+buSel()):'<div class="pus-top">'+buSel()+'</div>';
const listShell=(title,hint,addLabel,addFn,heads,rows,top)=>'<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">'+esc(title)+'</div><div class="pus-hint" style="margin:0">'+hint+'</div></div>'
  +(addFn?'<button class="btn btn-primary" onclick="'+addFn+'"><i class="fa-solid fa-plus"></i> '+esc(addLabel)+'</button>':'')+'</div>'+buBar(top)
  +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+heads.map(h=>'<th'+(h[1]?' class="pus-num"':'')+'>'+esc(h[0])+'</th>').join('')+'</tr></thead><tbody>'
  +(rows||'<tr><td colspan="'+heads.length+'"><div class="empty" style="padding:24px"><div>Nothing here yet</div></div></td></tr>')+'</tbody></table></div></div>';
const tabsBar=(id,tabs)=>'<div class="pi-tabs" id="'+id+'">'+tabs.map(t=>'<a data-t="'+t[0]+'" onclick="'+id+'Go(\''+t[0]+'\')">'+t[1]+'</a>').join('')+'</div>';
function logRows(log){
  const rows=log.map(x=>'<tr><td>'+esc(uname(x.by))+'</td><td style="white-space:nowrap">'+U().dmyTime(x.at)+'</td><td>'+esc(x.action)+(x.remark?'<div style="font-size:12px;color:var(--slate)">'+esc(x.remark)+'</div>':'')+'</td><td>'+esc(x.ip||'—')+'</td></tr>').join('');
  return '<div class="card" style="padding:0"><table class="tbl"><thead><tr><th>User</th><th>Modified Time</th><th>Action</th><th>IP Address</th></tr></thead><tbody>'+(rows||'<tr><td colspan="4"><div class="empty" style="padding:18px"><div>No history</div></div></td></tr>')+'</tbody></table></div>';
}
async function loadLog(type,id){ const {data}=await U().PU().from('doc_log').select('*').eq('doc_type',type).eq('doc_id',id).order('at'); return data||[]; }

/* ======================================================= GRN ======================================================= */
const G={rows:[],lines:[],pos:[],vendors:[],q:'',filter:'all'};
async function grnList(host){
  const PU=U().PU;
  const [g,l,p,v]=await Promise.all([
    PU().from('grns').select('*').is('deleted_at',null).order('created_at',{ascending:false}),
    PU().from('grn_lines').select('grn_id,received_qty,accepted_qty,rejected_qty,returned_qty'),
    PU().from('pos').select('id,doc_no,vendor_id,project_id').is('deleted_at',null),
    PU().from('vendors').select('id,code,legal_name,trade_name,ledger_parent_description')
  ]);
  const bad=[g,l,p,v].find(x=>x.error); if(bad) throw bad.error;
  G.rows=g.data||[]; G.lines=l.data||[]; G.pos=p.data||[]; G.vendors=v.data||[];
  grnRender(host);
}
const vName=id=>{const v=G.vendors.find(x=>x.id===id);return v?(v.trade_name||v.legal_name):'—';};
// Parent Account Head: the supplier's ledger parent description (Vendors tab -> Ledger), as on the purchase order.
const parentHead=id=>{const v=G.vendors.find(x=>x.id===id);return v&&v.ledger_parent_description?v.ledger_parent_description:'—';};
const poNo=id=>{const p=G.pos.find(x=>x.id===id);return p?(p.doc_no||'PO'):'—';};
function grnRender(host){
  host=host||$('pstBody'); if(!host) return;
  const q=G.q.toLowerCase();
  const list=G.rows.filter(r=>inBu(r.project_id)&&(G.filter==='all'||r.status===G.filter)&&(!q||((r.doc_no||'')+' '+poNo(r.po_id)+' '+vName(r.vendor_id)+' '+(r.challan_no||'')+' '+(r.invoice_no||'')).toLowerCase().includes(q)));
  const chips=[['all','All'],['draft','Draft'],['posted','Posted']].map(([k,l])=>'<span class="chip'+(G.filter===k?' active':'')+'" onclick="pusGrnFilter(\''+k+'\')">'+l+' ('+G.rows.filter(r=>inBu(r.project_id)&&(k==='all'||r.status===k)).length+')</span>').join('');
  const rows=list.map(r=>{ const ls=G.lines.filter(x=>x.grn_id===r.id); const rej=ls.reduce((s,x)=>s+ +x.rejected_qty,0);
    return '<tr style="cursor:pointer" onclick="pusGrnOpen('+r.id+')"><td><span class="pus-code">'+esc(r.doc_no||('Draft #'+r.id))+'</span></td><td>'+esc(poNo(r.po_id))+'</td><td><b>'+esc(vName(r.vendor_id))+'</b></td><td>'+esc(whName(r.warehouse_id))+'</td>'
      +'<td style="white-space:nowrap">'+U().dmy(r.grn_date)+'</td><td>'+esc(r.invoice_no||(r.challan_no?'Challan '+r.challan_no:''))+'</td><td class="pus-num">'+ls.length+(rej>0?' <span class="tag t-amber" title="Some quantity was rejected">rejected '+qty(rej)+'</span>':'')+'</td>'
      +'<td>'+(r.status==='posted'?'<span class="tag t-green">Posted</span>':'<span class="tag t-gray">Draft</span>')+'</td></tr>'; }).join('');
  host.innerHTML=listShell('Goods receipts (GRN)','Record what arrived against an approved purchase order — accepted quantity goes into stock, rejected quantity does not. A delivery can be partial.',
    'New GRN',U().can('grn.post')?'pusGrnNew()':'',[['GRN no'],['PO'],['Vendor'],['Warehouse'],['Date'],['Vendor doc no'],['Items',1],['Status']],rows,
    '<div class="pus-top"><div class="pus-subs" style="margin:0">'+chips+'</div><input class="grow" id="pstQ" placeholder="Search by GRN, PO, vendor or vendor doc no" value="'+esc(G.q)+'" oninput="pusGrnSearch()"></div>');
}
window.pusGrnFilter=function(k){ G.filter=k; grnRender(); };
window.pusGrnSearch=function(){ G.q=U().val('pstQ'); grnRender(); const e=$('pstQ'); if(e){ e.focus(); e.setSelectionRange(e.value.length,e.value.length); } };

// Step 1: choose an approved PO that still has something to receive.
window.pusGrnNew=async function(){
  const PU=U().PU;
  const [p,l]=await Promise.all([PU().from('pos').select('id,doc_no,vendor_id,project_id,po_date').eq('status','approved').is('deleted_at',null).order('po_date',{ascending:false}),
    PU().from('po_lines').select('po_id,qty,received_qty,short_closed_qty')]);
  if(p.error||l.error){ toast('Could not load purchase orders','err'); return; }
  const tol=num(U().rule('grn.over_receipt_pct'));
  const open=(p.data||[]).filter(po=>(l.data||[]).some(x=>x.po_id===po.id&&(+x.qty-+x.received_qty-+x.short_closed_qty>0||(tol>0&&+x.received_qty<+x.qty*(1+tol/100)))));
  openModal('<div class="modal-head"><h3>New goods receipt</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm">'
    +(open.length?'<label>Purchase order</label><select id="pgPo"><option value="">Choose…</option>'+open.map(po=>'<option value="'+po.id+'">'+esc(po.doc_no||'PO')+' — '+esc(vName(po.vendor_id))+' — '+esc(projName(po.project_id))+'</option>').join('')+'</select>'
      :'<div class="empty" style="padding:18px"><div>No approved purchase order has anything left to receive.</div></div>')+'</div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>'+(open.length?'<button class="btn btn-primary" onclick="pusGrnForm(parseInt(document.getElementById(\'pgPo\').value,10)||null)">Continue</button>':'')+'</div>');
};
let GF=null;   // {id, po, lines:[{pl, item, existing}], tol}
window.pusGrnForm=async function(poId,gid){
  const PU=U().PU; if(!poId&&!gid){ toast('Choose a purchase order','err'); return; }
  let g=null, existing={};
  if(gid){ const [h,ls]=await Promise.all([PU().from('grns').select('*').eq('id',gid).single(),PU().from('grn_lines').select('*').eq('grn_id',gid)]); if(h.error){ toast('Could not open the receipt','err'); return; } g=h.data; poId=g.po_id; (ls.data||[]).forEach(x=>existing[x.po_line_id]=x); }
  const [po,pl]=await Promise.all([PU().from('pos').select('*').eq('id',poId).single(),PU().from('po_lines').select('*, items(code,name)').eq('po_id',poId).order('line_no')]);
  if(po.error||pl.error){ toast('Could not load the purchase order','err'); return; }
  if(!G.vendors.length){ const v=await PU().from('vendors').select('id,code,legal_name,trade_name,ledger_parent_description'); G.vendors=v.data||[]; }
  const tol=num(U().rule('grn.over_receipt_pct')), P=po.data;
  const lines=(pl.data||[]).map(l=>({pl:l,ex:existing[l.id]||null,bal:Math.max(0,+l.qty-+l.received_qty-+l.short_closed_qty),max:Math.max(0,+l.qty-+l.received_qty-+l.short_closed_qty)+ +l.qty*tol/100}))
    .filter(x=>x.ex||x.max>0);
  GF={id:gid||null,po:P,lines,tol};
  // The goods go into the order's delivery warehouse (a draft keeps the one it was saved with); there is no warehouse box on the form.
  const whRow=U().S.warehouses.find(w=>w.id===(g?g.warehouse_id:P.warehouse_id)&&w.project_id===P.project_id&&w.active)||null;
  GF.wh=whRow?whRow.id:null;
  const docDate=g?g.grn_date:today();
  const rows=lines.map((x,i)=>'<tr class="pg-line" data-pl="'+x.pl.id+'"><td>'+(i+1)+'</td><td><b>'+esc(x.pl.items.name)+'</b><div style="font-size:12px;color:var(--slate)">'+esc(x.pl.items.code)+' · '+esc(U().uomCode(x.pl.uom_id))+'</div></td>'
    +'<td class="pus-num">'+qty(x.pl.qty)+'</td><td class="pus-num">'+qty(x.pl.received_qty-(x.ex&&g&&g.status==='posted'?x.ex.accepted_qty:0))+'</td><td class="pus-num"><b>'+qty(x.bal)+'</b>'+(tol>0?'<div style="font-size:11px;color:var(--slate)">up to '+qty(x.max)+'</div>':'')+'</td>'
    +'<td><input class="pg-rec" type="number" step="0.001" min="0" style="width:96px" value="'+(x.ex?esc(x.ex.received_qty):'')+'" oninput="pusGrnCalc(this)"></td>'
    +'<td><input class="pg-acc" type="number" step="0.001" min="0" style="width:96px" value="'+(x.ex?esc(x.ex.accepted_qty):'')+'" oninput="pusGrnCalc(this)"></td>'
    +'<td class="pus-num pg-rej">'+(x.ex?qty(x.ex.rejected_qty):'')+'</td><td><input class="pg-why" style="width:150px" placeholder="reason if rejected" value="'+esc(x.ex&&x.ex.rejection_reason||'')+'"></td></tr>').join('');
  const t=k=>esc(g&&g[k]||'');
  openModal('<div class="modal-head"><h3>'+(g?'Edit goods receipt':'New goods receipt')+' — '+esc(P.doc_no||'PO')+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm" style="max-height:calc(90vh - 150px);overflow:auto">'
    +'<div class="pus-hint" style="margin-top:0">Vendor: <b>'+esc(vName(P.vendor_id))+'</b>. Enter what physically arrived. <b>Accepted</b> goes into stock; the rest is <b>rejected</b> (give a reason) and does not.'+(tol>0?' Over-receipt up to '+tol+'% of the ordered quantity is allowed.':'')
      +(whRow?' Received into <b>'+esc(whRow.name)+'</b> (the order\'s delivery warehouse).':' <b style="color:#b91c1c">The order\'s delivery warehouse is not available - ask a Purchase administrator.</b>')+'</div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>#</th><th>Item</th><th class="pus-num">Ordered</th><th class="pus-num">Received so far</th><th class="pus-num">Balance</th><th>Received now</th><th>Accepted</th><th class="pus-num">Rejected</th><th>Reason</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>'
    +'<div class="pi-form" style="margin-top:14px"><div>'
      +ro('Business Unit',projName(P.project_id))
      +field('Document Date','<input id="pgDate" type="date" max="'+today()+'" value="'+esc(docDate)+'" oninput="pusGrnFy()">')
      +ro('Supplier',vName(P.vendor_id))
      +field('Vendor Doc No','<input id="pgVdNo" maxlength="60" value="'+t('invoice_no')+'" placeholder="Vendor\'s challan / invoice no">')
    +'</div><div>'
      +'<div class="pi-row"><div class="l">Financial Year</div><div class="v pi-ro" id="pgFy">'+esc(U().fy(docDate).text)+'</div></div>'
      +ro('Document No',(g&&g.doc_no)||'Assigned on posting')
      +ro('Parent Account Head',parentHead(P.vendor_id))
      +field('Vendor Doc Date','<input id="pgVdDate" type="date" value="'+t('invoice_date')+'">')
    +'</div></div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn" onclick="pusGrnSave(false)">Save draft</button><button class="btn btn-primary" onclick="pusGrnSave(true)">Save & post to stock</button></div>','xl');
};
// The financial year follows the document date (1 April - 31 March).
window.pusGrnFy=function(){ const e=$('pgFy'); if(e) e.textContent=U().fy(U().val('pgDate')||today()).text; };
window.pusGrnCalc=function(inp){
  const tr=inp.closest('tr'), rec=num(tr.querySelector('.pg-rec').value);
  const accEl=tr.querySelector('.pg-acc');
  if(inp.classList.contains('pg-rec')&&accEl.value==='') accEl.value=rec||'';
  let acc=num(accEl.value); if(acc>rec){ acc=rec; accEl.value=rec; }
  const rej=Math.round((rec-acc)*1000)/1000; tr.querySelector('.pg-rej').textContent=rec?qty(rej):'';
};
window.pusGrnSave=async function(post){
  const v=U().val, lines=[];
  for(const tr of document.querySelectorAll('.pg-line')){
    const rec=num(tr.querySelector('.pg-rec').value); if(!(rec>0)) continue;
    const acc=tr.querySelector('.pg-acc').value===''?rec:num(tr.querySelector('.pg-acc').value), why=tr.querySelector('.pg-why').value.trim();
    if(acc>rec){ toast('Accepted cannot be more than received','err'); return; }
    if(rec-acc>0.0005&&!why){ toast('Give a reason for the rejected quantity','err'); return; }
    lines.push({po_line_id:parseInt(tr.dataset.pl,10),received_qty:rec,accepted_qty:acc,rejection_reason:why||null});
  }
  if(!lines.length){ toast('Enter the quantity received for at least one item','err'); return; }
  if(!GF.wh){ toast('The order\'s delivery warehouse is not available - ask a Purchase administrator','err'); return; }
  const docDate=v('pgDate')||today(); if(docDate>today()){ toast('The document date cannot be in the future','err'); return; }
  // Vendor Doc No / Date are kept in the receipt's invoice no / date (bill booking reads them from there).
  const head={warehouse_id:GF.wh,grn_date:docDate,invoice_no:v('pgVdNo'),invoice_date:v('pgVdDate')||null};
  const {data:id,error}=await U().PU().rpc('grn_save',{p_id:GF.id,p_po_id:GF.po.id,p_head:head,p_lines:lines});
  if(U().fail(error,'Could not save')) return;
  if(post){
    const r=await U().PU().rpc('grn_post',{p_id:id});
    if(r.error){ toast('Saved as a draft, but it could not be posted: '+r.error.message,'warn'); closeModal(); route(); return; }
    closeModal(); toast('Posted as '+r.data+' — stock updated','ok'); route(); return;
  }
  closeModal(); toast('Draft saved','ok'); route();
};

let GC=null;
window.pusGrnOpen=async function(id,tab){
  const PU=U().PU;
  const [h,ls,lg]=await Promise.all([PU().from('grns').select('*').eq('id',id).maybeSingle(),PU().from('grn_lines').select('*, items(code,name)').eq('grn_id',id).order('line_no'),loadLog('grn',id)]);
  if(h.error||ls.error||!h.data||h.data.deleted_at){ toast('Could not open the goods receipt','err'); return; }
  if(!G.vendors.length||!G.pos.length){ const [v,p]=await Promise.all([PU().from('vendors').select('id,code,legal_name,trade_name,ledger_parent_description'),PU().from('pos').select('id,doc_no,vendor_id,project_id')]); G.vendors=v.data||[]; G.pos=p.data||[]; }
  const g=h.data; GC={g,lines:ls.data||[],log:lg};
  const can=U().can('grn.post'), mine=g.raised_by.toLowerCase()===me()||state.super, btn=[];
  if(g.status==='draft'&&can&&mine) btn.push('<button class="btn" onclick="pusGrnForm(null,'+id+')"><i class="fa-solid fa-pen"></i> Edit</button>','<button class="btn btn-primary" onclick="pusGrnPost('+id+')"><i class="fa-solid fa-boxes-packing"></i> Post to stock</button>');
  if(g.status==='posted'&&can&&GC.lines.some(l=>+l.accepted_qty-+l.returned_qty>0)) btn.push('<button class="btn" onclick="pusRtvNew('+id+')"><i class="fa-solid fa-rotate-left"></i> Return to vendor…</button>');
  const del=g.status==='draft'&&can&&mine?'<button class="btn btn-ghost" style="margin-right:auto" onclick="pusGrnDelete('+id+')"><i class="fa-solid fa-trash"></i> Delete draft</button>':'';
  openModal('<div class="modal-head"><h3>Goods receipt '+esc(g.doc_no||('Draft #'+g.id))+' '+(g.status==='posted'?'<span class="tag t-green">Posted</span>':'<span class="tag t-gray">Draft</span>')+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="max-height:calc(90vh - 150px);overflow:auto">'+tabsBar('pstG',[['main','Main Info'],['items','Items'],['history','Change History']])+'<div id="pstGBody"></div></div>'
    +'<div class="modal-foot">'+del+'<button class="btn" onclick="closeModal()">Close</button>'+btn.join('')+'</div>','xl');
  window.pstGGo(tab||'main');
};
window.pstGGo=function(t){
  document.querySelectorAll('#pstG a').forEach(a=>a.classList.toggle('on',a.dataset.t===t));
  const {g,lines,log}=GC, b=$('pstGBody'); if(!b) return;
  if(t==='main') b.innerHTML='<div class="pi-form"><div>'+ro('Business Unit',projName(g.project_id))+ro('Document Date',U().dmy(g.grn_date))+ro('Supplier',vName(g.vendor_id))+ro('Vendor Doc No',g.invoice_no||g.challan_no||'')+ro('Purchase order',poNo(g.po_id))+'</div><div>'
      +ro('Financial Year',U().fy(g.grn_date).text)+ro('Document No',g.doc_no||'Assigned on posting')+ro('Parent Account Head',parentHead(g.vendor_id))+ro('Vendor Doc Date',g.invoice_date?U().dmy(g.invoice_date):'')+ro('Warehouse',whName(g.warehouse_id))+ro('Entered by',uname(g.raised_by))+'</div></div>';
  else if(t==='items') b.innerHTML='<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>#</th><th>Item</th><th>Unit</th><th class="pus-num">Received</th><th class="pus-num">Accepted</th><th class="pus-num">Rejected</th><th>Reason</th><th class="pus-num">Rate</th><th class="pus-num">Into stock</th><th class="pus-num">Returned</th></tr></thead><tbody>'
      +lines.map((l,i)=>'<tr><td>'+(i+1)+'</td><td><span class="pus-code">'+esc(l.items.code)+'</span> <b>'+esc(l.items.name)+'</b></td><td>'+esc(U().uomCode(l.uom_id))+'</td><td class="pus-num">'+qty(l.received_qty)+'</td><td class="pus-num"><b>'+qty(l.accepted_qty)+'</b></td><td class="pus-num">'+(+l.rejected_qty?qty(l.rejected_qty):'—')+'</td><td>'+esc(l.rejection_reason||'')+'</td><td class="pus-num">'+money(l.rate)+'</td><td class="pus-num">'+(l.stock_qty!=null?qty(l.stock_qty)+' '+esc(stockUnit(l.item_id)):'—')+'</td><td class="pus-num">'+(+l.returned_qty?qty(l.returned_qty):'—')+'</td></tr>').join('')+'</tbody></table></div></div>';
  else b.innerHTML=logRows(log);
};
window.pusGrnPost=async function(id){
  if(!await confirmDialog('Post this goods receipt? The accepted quantity goes into stock and the PO balance reduces. A posted receipt cannot be edited (use a return to the vendor to correct it).',{title:'Post goods receipt',okLabel:'Post receipt',danger:false})) return;
  const {data,error}=await U().PU().rpc('grn_post',{p_id:id});
  if(U().fail(error,'Could not post')) return;
  closeModal(); toast('Posted as '+data+' — stock updated','ok'); route();
};
window.pusGrnDelete=async function(id){
  if(!await confirmDialog('Delete this draft goods receipt?')) return;
  const {error}=await U().PU().rpc('grn_delete',{p_id:id});
  if(U().fail(error,'Delete failed')) return;
  closeModal(); toast('Draft deleted','ok'); route();
};

/* ---- return to vendor ---- */
window.pusRtvNew=function(gid){
  const {g,lines}=GC, open=lines.filter(l=>+l.accepted_qty-+l.returned_qty>0);
  openModal('<div class="modal-head"><h3>Return goods to vendor — '+esc(g.doc_no||'GRN')+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm" style="max-height:72vh;overflow:auto">'
    +'<div class="pus-hint" style="margin-top:0">Takes the goods out of stock and puts the returned quantity back on the purchase order, so the vendor still owes it.</div>'
    +'<div class="card" style="padding:0"><table class="tbl"><thead><tr><th>Item</th><th class="pus-num">Can still return</th><th>Return now</th></tr></thead><tbody>'
    +open.map(l=>'<tr class="pr-line" data-id="'+l.id+'"><td><b>'+esc(l.items.name)+'</b></td><td class="pus-num">'+qty(+l.accepted_qty-+l.returned_qty)+' '+esc(U().uomCode(l.uom_id))+'</td><td><input class="pr-qty" type="number" step="0.001" min="0" max="'+(+l.accepted_qty-+l.returned_qty)+'" style="width:100px"></td></tr>').join('')
    +'</tbody></table></div><div class="two" style="margin-top:12px"><div><label>Date</label><input id="prDate" type="date" max="'+today()+'" value="'+today()+'"></div><div><label>Reason</label><input id="prReason" placeholder="e.g. failed quality test"></div></div>'
    +'<label>Remarks (optional)</label><input id="prRem"></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusRtvSave('+gid+')">Return goods</button></div>');
};
window.pusRtvSave=async function(gid){
  const lines=[...document.querySelectorAll('.pr-line')].map(tr=>({grn_line_id:parseInt(tr.dataset.id,10),qty:num(tr.querySelector('.pr-qty').value)})).filter(x=>x.qty>0);
  if(!lines.length){ toast('Enter a quantity to return','err'); return; }
  if(!U().val('prReason')){ toast('Give the reason for the return','err'); return; }
  const {data,error}=await U().PU().rpc('rtv_create',{p_grn_id:gid,p_head:{rtv_date:U().val('prDate')||today(),reason:U().val('prReason'),remarks:U().val('prRem')},p_lines:lines});
  if(U().fail(error,'Could not return the goods')) return;
  closeModal(); toast('Returned — '+data,'ok'); route();
};
async function rtvList(host){
  const PU=U().PU;
  const [r,l,g,v]=await Promise.all([PU().from('rtvs').select('*').order('created_at',{ascending:false}),PU().from('rtv_lines').select('rtv_id,item_id,qty'),PU().from('grns').select('id,doc_no'),PU().from('vendors').select('id,legal_name,trade_name')]);
  const bad=[r,l,g,v].find(x=>x.error); if(bad) throw bad.error; G.vendors=v.data||[];
  const rows=(r.data||[]).filter(x=>inBu(x.project_id)).map(x=>{ const ls=(l.data||[]).filter(y=>y.rtv_id===x.id); const gn=(g.data||[]).find(y=>y.id===x.grn_id);
    return '<tr><td><span class="pus-code">'+esc(x.doc_no)+'</span></td><td>'+esc(gn?gn.doc_no:'')+'</td><td><b>'+esc(vName(x.vendor_id))+'</b></td><td>'+esc(whName(x.warehouse_id))+'</td><td style="white-space:nowrap">'+U().dmy(x.rtv_date)+'</td><td>'+esc(x.reason)+'</td><td>'+ls.map(y=>esc(itemName(y.item_id))+' × '+qty(y.qty)).join(', ')+'</td><td>'+esc(uname(x.created_by))+'</td></tr>'; }).join('');
  host.innerHTML=listShell('Returns to vendor','Goods sent back to a vendor — quality or other reasons. Made from a posted GRN (open the GRN → Return to vendor).','',null,[['Return no'],['GRN'],['Vendor'],['Warehouse'],['Date'],['Reason'],['Items'],['By']],rows);
}

/* ===================================================== ISSUES ===================================================== */
const I={rows:[],lines:[],q:'',wh:''};
async function issueList(host){
  const PU=U().PU;
  const [a,b]=await Promise.all([PU().from('issues').select('*').order('created_at',{ascending:false}),PU().from('issue_lines').select('issue_id,item_id,qty,value,returned_qty')]);
  const bad=[a,b].find(x=>x.error); if(bad) throw bad.error; I.rows=a.data||[]; I.lines=b.data||[];
  issueRender(host);
}
function issueRender(host){
  host=host||$('pstBody'); if(!host) return; const q=I.q.toLowerCase();
  if(I.wh&&!inBu((whById(parseInt(I.wh,10))||{}).project_id)) I.wh='';   // the warehouse chosen earlier is not in this business unit
  const list=I.rows.filter(r=>inBu(r.project_id)&&(!I.wh||String(r.warehouse_id)===I.wh)&&(!q||((r.doc_no||'')+' '+(r.requested_by||'')+' '+(r.activity||'')+' '+(r.block||'')).toLowerCase().includes(q)));
  const rows=list.map(r=>{ const ls=I.lines.filter(x=>x.issue_id===r.id); const val=ls.reduce((s,x)=>s+ +x.value,0);
    return '<tr style="cursor:pointer" onclick="pusIssueOpen('+r.id+')"><td><span class="pus-code">'+esc(r.doc_no)+'</span></td><td>'+esc(whName(r.warehouse_id))+'</td><td style="white-space:nowrap">'+U().dmy(r.issue_date)+'</td><td>'+esc([r.cost_project_id?projName(r.cost_project_id):'',r.block,r.activity].filter(Boolean).join(' · '))+'</td><td>'+esc(r.requested_by||'')+'</td><td class="pus-num">'+ls.length+'</td><td class="pus-num">'+money(val)+'</td><td>'+esc(uname(r.created_by))+'</td></tr>'; }).join('');
  host.innerHTML=listShell('Issues','Material given out of a warehouse for a purpose. Stock is reduced at the current average cost; an issue cannot take more than is in stock.','New issue',U().can('stock.issue')?'pusIssueNew()':'',
    [['Issue no'],['Warehouse'],['Date'],['For'],['Requested by'],['Items',1],['Value',1],['By']],rows,
    '<div class="pus-top"><select id="pstWh" onchange="pusIssueFilter()"><option value="">All warehouses</option>'+U().S.warehouses.filter(w=>inBu(w.project_id)).map(w=>'<option value="'+w.id+'"'+(String(w.id)===I.wh?' selected':'')+'>'+esc(w.name)+'</option>').join('')+'</select><input class="grow" id="pstQ" placeholder="Search by issue no, person, block or activity" value="'+esc(I.q)+'" oninput="pusIssueSearch()"></div>');
}
window.pusIssueFilter=function(){ I.wh=U().val('pstWh'); issueRender(); };
window.pusIssueSearch=function(){ I.q=U().val('pstQ'); issueRender(); const e=$('pstQ'); if(e){ e.focus(); e.setSelectionRange(e.value.length,e.value.length); } };

let BAL={};   // item_id -> {qty,avg} for the warehouse chosen in a form
async function loadBalances(wh){ BAL={}; if(!wh) return; const {data}=await U().PU().from('stock_balances').select('item_id,qty,avg_rate,value').eq('warehouse_id',wh); (data||[]).forEach(b=>BAL[b.item_id]={qty:+b.qty,avg:+b.avg_rate,value:+b.value}); }
const stockOptions=(sel,onlyStock)=>'<option value="">Choose item…</option>'+U().S.items.filter(i=>i.active).filter(i=>!onlyStock||(BAL[i.id]&&BAL[i.id].qty>0)).map(i=>'<option value="'+i.id+'"'+(i.id===sel?' selected':'')+'>'+esc(i.name)+' ('+esc(i.code)+') — '+qty((BAL[i.id]||{}).qty)+' '+esc(U().uomCode(i.stock_uom_id))+' in stock</option>').join('');
const itemLine=(l,cls,withRate)=>'<div class="pus-vrow '+cls+'" style="grid-template-columns:3fr 110px '+(withRate?'110px ':'')+'1.6fr auto"><select class="sl-item" onchange="pusStoreItemPick(this)">'+stockOptions(l&&l.item_id,cls==='sl-issue'||cls==='sl-trf')+'</select>'
  +'<input class="sl-qty" type="number" step="0.001" min="0" placeholder="Quantity" value="'+(l&&l.qty?esc(l.qty):'')+'">'+(withRate?'<input class="sl-rate" type="number" step="0.01" min="0" placeholder="Rate (increase)" value="'+(l&&l.rate?esc(l.rate):'')+'">':'')
  +'<input class="sl-note" placeholder="Remark" value="'+esc(l&&l.note||'')+'"><button class="btn btn-sm btn-ghost" title="Remove" onclick="this.parentNode.remove()"><i class="fa-solid fa-xmark"></i></button></div>';
window.pusStoreItemPick=function(sel){ const q=sel.parentNode.querySelector('.sl-qty'), b=BAL[parseInt(sel.value,10)]; if(q&&b) q.max=b.qty; };
async function refreshStockSelects(cls,onlyStock){ document.querySelectorAll('.'+cls+' .sl-item').forEach(s=>{ const cur=parseInt(s.value,10)||null; s.innerHTML=stockOptions(cur,onlyStock); }); }

window.pusIssueNew=async function(){
  const wh=U().S.warehouses.find(w=>w.active); await loadBalances(wh&&wh.id);
  openModal('<div class="modal-head"><h3>New issue</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm" style="max-height:calc(90vh - 150px);overflow:auto">'
    +'<div class="pi-form"><div>'+field('Issue from','<select id="piWh" onchange="pusIssueWh()">'+whOptions(wh&&wh.id)+'</select>')+field('Date','<input id="piDate" type="date" max="'+today()+'" value="'+today()+'">')+field('Requested by','<input id="piBy" placeholder="who asked for it">')+'</div>'
    +'<div>'+field('Charged to project','<select id="piProj"><option value="">— same as warehouse —</option>'+U().S.projects.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join('')+'</select>')+field('Block / tower','<input id="piBlock">')+field('Activity','<input id="piAct" placeholder="e.g. 3rd floor slab">')+'</div></div>'
    +'<div class="pus-sub">Items</div><div id="piLines">'+itemLine(null,'sl-issue',false)+'</div><button class="btn btn-sm" onclick="pusIssueAddLine()"><i class="fa-solid fa-plus"></i> Add item</button>'
    +'<label style="margin-top:12px">Remarks</label><input id="piRem"></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusIssueSave()">Issue material</button></div>','xl');
};
window.pusIssueWh=async function(){ await loadBalances(parseInt(U().val('piWh'),10)||null); await refreshStockSelects('sl-issue',true); };
window.pusIssueAddLine=function(){ $('piLines').insertAdjacentHTML('beforeend',itemLine(null,'sl-issue',false)); };
window.pusIssueSave=async function(){
  const wh=parseInt(U().val('piWh'),10); if(!wh){ toast('Choose the warehouse','err'); return; }
  const lines=[], seen=new Set();
  for(const d of document.querySelectorAll('#piLines .sl-issue')){ const it=parseInt(d.querySelector('.sl-item').value,10), q=num(d.querySelector('.sl-qty').value);
    if(!it&&!q) continue; if(!it){ toast('Choose the item','err'); return; } if(!(q>0)){ toast('Enter a quantity for '+itemName(it),'err'); return; }
    if(seen.has(it)){ toast(itemName(it)+' is on the issue twice — combine the quantities','err'); return; } seen.add(it);
    if(BAL[it]&&q>BAL[it].qty){ toast('Only '+qty(BAL[it].qty)+' '+stockUnit(it)+' of '+itemName(it)+' is in stock','err'); return; }
    lines.push({item_id:it,qty:q,remark:d.querySelector('.sl-note').value.trim()||null}); }
  if(!lines.length){ toast('Add at least one item','err'); return; }
  const v=U().val, head={warehouse_id:wh,issue_date:v('piDate')||today(),requested_by:v('piBy'),block:v('piBlock'),activity:v('piAct'),cost_project_id:v('piProj')||null,remarks:v('piRem')};
  const {data,error}=await U().PU().rpc('issue_create',{p_head:head,p_lines:lines});
  if(U().fail(error,'Could not issue')) return;
  closeModal(); toast('Issued — '+data,'ok'); route();
};
let IC=null;
window.pusIssueOpen=async function(id){
  const PU=U().PU;
  const [h,ls,rt,lg]=await Promise.all([PU().from('issues').select('*').eq('id',id).maybeSingle(),PU().from('issue_lines').select('*').eq('issue_id',id).order('line_no'),PU().from('issue_returns').select('*').eq('issue_id',id).order('created_at'),loadLog('issue',id)]);
  if(h.error||!h.data){ toast('Could not open the issue','err'); return; }
  IC={i:h.data,lines:ls.data||[],returns:rt.data||[],log:lg};
  const canRet=U().can('stock.issue')&&IC.lines.some(l=>+l.qty-+l.returned_qty>0);
  openModal('<div class="modal-head"><h3>Issue '+esc(IC.i.doc_no)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body" style="max-height:calc(90vh - 150px);overflow:auto">'
    +'<div class="pi-form"><div>'+ro('Warehouse',whName(IC.i.warehouse_id))+ro('Date',U().dmy(IC.i.issue_date))+ro('Requested by',IC.i.requested_by||'')+'</div><div>'+ro('Charged to',IC.i.cost_project_id?projName(IC.i.cost_project_id):'Warehouse project')+ro('Block / activity',[IC.i.block,IC.i.activity].filter(Boolean).join(' · '))+ro('Issued by',uname(IC.i.created_by))+'</div></div>'
    +'<div class="card" style="padding:0"><table class="tbl"><thead><tr><th>Item</th><th>Unit</th><th class="pus-num">Quantity</th><th class="pus-num">Rate</th><th class="pus-num">Value</th><th class="pus-num">Returned</th></tr></thead><tbody>'
    +IC.lines.map(l=>'<tr><td><b>'+esc(itemName(l.item_id))+'</b></td><td>'+esc(stockUnit(l.item_id))+'</td><td class="pus-num">'+qty(l.qty)+'</td><td class="pus-num">'+money(l.rate)+'</td><td class="pus-num">'+money(l.value)+'</td><td class="pus-num">'+(+l.returned_qty?qty(l.returned_qty):'—')+'</td></tr>').join('')+'</tbody></table></div>'
    +(IC.returns.length?'<div class="pus-sub">Returned to store</div>'+IC.returns.map(r=>'<div style="font-size:13px;padding:2px 0"><span class="pus-code">'+esc(r.doc_no)+'</span> '+U().dmy(r.return_date)+(r.reason?' — '+esc(r.reason):'')+'</div>').join(''):'')
    +'<div class="pus-sub">Change history</div>'+logRows(IC.log)+'</div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button>'+(canRet?'<button class="btn btn-primary" onclick="pusIssueReturn('+id+')"><i class="fa-solid fa-rotate-left"></i> Return to store…</button>':'')+'</div>','xl');
};
window.pusIssueReturn=function(id){
  const open=IC.lines.filter(l=>+l.qty-+l.returned_qty>0);
  openModal('<div class="modal-head"><h3>Return to store — '+esc(IC.i.doc_no)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm">'
    +'<div class="pus-hint" style="margin-top:0">Material not used comes back into the warehouse at the cost it was issued at.</div>'
    +'<div class="card" style="padding:0"><table class="tbl"><thead><tr><th>Item</th><th class="pus-num">Can return</th><th>Return now</th></tr></thead><tbody>'
    +open.map(l=>'<tr class="ir-line" data-id="'+l.id+'"><td><b>'+esc(itemName(l.item_id))+'</b></td><td class="pus-num">'+qty(+l.qty-+l.returned_qty)+' '+esc(stockUnit(l.item_id))+'</td><td><input class="ir-qty" type="number" step="0.001" min="0" max="'+(+l.qty-+l.returned_qty)+'" style="width:100px"></td></tr>').join('')
    +'</tbody></table></div><div class="two" style="margin-top:12px"><div><label>Date</label><input id="irDate" type="date" max="'+today()+'" value="'+today()+'"></div><div><label>Reason</label><input id="irWhy"></div></div><label>Returned by</label><input id="irBy"></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusIssueReturnSave('+id+')">Return to store</button></div>');
};
window.pusIssueReturnSave=async function(id){
  const lines=[...document.querySelectorAll('.ir-line')].map(tr=>({issue_line_id:parseInt(tr.dataset.id,10),qty:num(tr.querySelector('.ir-qty').value)})).filter(x=>x.qty>0);
  if(!lines.length){ toast('Enter a quantity to return','err'); return; }
  const v=U().val, {data,error}=await U().PU().rpc('issue_return_create',{p_issue_id:id,p_head:{return_date:v('irDate')||today(),reason:v('irWhy'),returned_by:v('irBy')},p_lines:lines});
  if(U().fail(error,'Could not return')) return;
  closeModal(); toast('Returned to store — '+data,'ok'); route();
};
async function returnList(host){
  const PU=U().PU;
  const [r,l,i]=await Promise.all([PU().from('issue_returns').select('*').order('created_at',{ascending:false}),PU().from('issue_return_lines').select('return_id,item_id,qty,value'),PU().from('issues').select('id,doc_no')]);
  const bad=[r,l,i].find(x=>x.error); if(bad) throw bad.error;
  const rows=(r.data||[]).filter(x=>inBu(x.project_id)).map(x=>{ const ls=(l.data||[]).filter(y=>y.return_id===x.id); const is=(i.data||[]).find(y=>y.id===x.issue_id);
    return '<tr><td><span class="pus-code">'+esc(x.doc_no)+'</span></td><td>'+esc(is?is.doc_no:'')+'</td><td>'+esc(whName(x.warehouse_id))+'</td><td style="white-space:nowrap">'+U().dmy(x.return_date)+'</td><td>'+ls.map(y=>esc(itemName(y.item_id))+' × '+qty(y.qty)).join(', ')+'</td><td class="pus-num">'+money(ls.reduce((s,y)=>s+ +y.value,0))+'</td><td>'+esc(x.reason||'')+'</td><td>'+esc(uname(x.created_by))+'</td></tr>'; }).join('');
  host.innerHTML=listShell('Issue returns','Material that came back into a warehouse after being issued. Made from an issue (open the issue → Return to store).','',null,[['Return no'],['Issue'],['Warehouse'],['Date'],['Items'],['Value',1],['Reason'],['By']],rows);
}

/* ================================================== ADJUSTMENTS ================================================== */
const A={rows:[],lines:[],pending:[],filter:'all',q:''};
const ADJKIND={physical_count:'Physical count',damage:'Damage / loss',other:'Other',transfer:'Inter-entity transfer'};
async function adjList(host){
  const PU=U().PU;
  const [a,l,p]=await Promise.all([PU().from('stock_adjustments').select('*').is('deleted_at',null).order('created_at',{ascending:false}),PU().from('adjustment_lines').select('adjustment_id,item_id,direction,qty,value'),PU().from('adjustment_approvals').select('adjustment_id,approvers,status').eq('status','pending')]);
  const bad=[a,l,p].find(x=>x.error); if(bad) throw bad.error; A.rows=a.data||[]; A.lines=l.data||[]; A.pending=p.data||[];
  adjRender(host);
}
const adjStatus=a=>({draft:['Draft','t-gray'],pending_approval:['Awaiting level '+a.current_level,'t-amber'],approved:['Posted','t-green'],rejected:['Rejected','t-red'],cancelled:['Cancelled','t-red']}[a.status]||[a.status,'t-gray']);
const adjMine=a=>a.status==='pending_approval'&&(selfApproval()||a.raised_by.toLowerCase()!==me())&&A.pending.some(p=>p.adjustment_id===a.id&&p.approvers.some(e=>e.toLowerCase()===me()));
function adjRender(host){
  host=host||$('pstBody'); if(!host) return; const q=A.q.toLowerCase();
  const inF=(a,k)=>k==='all'||(k==='draft'&&a.status==='draft')||(k==='pending'&&a.status==='pending_approval')||(k==='mine'&&adjMine(a))||(k==='approved'&&a.status==='approved')||(k==='rejected'&&a.status==='rejected');
  const base=A.rows.filter(a=>inBu(a.project_id));
  const list=base.filter(a=>inF(a,A.filter)&&(!q||((a.doc_no||'')+' '+a.reason+' '+whName(a.warehouse_id)).toLowerCase().includes(q)));
  const chips=[['all','All'],['draft','Drafts'],['pending','Awaiting approval'],['mine','Awaiting my approval'],['approved','Posted'],['rejected','Rejected']].map(([k,l])=>'<span class="chip'+(A.filter===k?' active':'')+'" onclick="pusAdjFilter(\''+k+'\')">'+l+' ('+base.filter(a=>inF(a,k)).length+')</span>').join('');
  const rows=list.map(a=>{ const s=adjStatus(a), ls=A.lines.filter(x=>x.adjustment_id===a.id);
    return '<tr style="cursor:pointer" onclick="pusAdjOpen('+a.id+')"><td><span class="pus-code">'+esc(a.doc_no||('Draft #'+a.id))+'</span>'+(a.accounts_flag?' <span class="tag t-blue" title="Created by a transfer between legal entities - for Accounts">for Accounts</span>':'')+'</td><td>'+esc(whName(a.warehouse_id))+'</td><td style="white-space:nowrap">'+U().dmy(a.adj_date)+'</td><td>'+esc(ADJKIND[a.kind]||a.kind)+'</td><td>'+esc(a.reason)+'</td><td class="pus-num">'+ls.length+'</td><td class="pus-num">'+money(a.total_value)+'</td><td><span class="tag '+s[1]+'">'+esc(s[0])+'</span>'+(adjMine(a)?' <span class="tag t-blue">Your turn</span>'+U().rowDecide('pusAdjDecide',a.id):'')+'</td></tr>'; }).join('');
  host.innerHTML=listShell('Stock adjustments','Corrections for a physical count or damaged / lost material. They go through an approver before they change stock. (Transfers between legal entities create linked adjustments automatically.)','New adjustment',U().can('stock.adjust')?'pusAdjEdit()':'',
    [['Adjustment no'],['Warehouse'],['Date'],['Kind'],['Reason'],['Items',1],['Value',1],['Status']],rows,
    '<div class="pus-top"><div class="pus-subs" style="margin:0">'+chips+'</div><input class="grow" id="pstQ" placeholder="Search" value="'+esc(A.q)+'" oninput="pusAdjSearch()"></div>');
}
window.pusAdjFilter=function(k){ A.filter=k; adjRender(); };
window.pusAdjSearch=function(){ A.q=U().val('pstQ'); adjRender(); const e=$('pstQ'); if(e){ e.focus(); e.setSelectionRange(e.value.length,e.value.length); } };
const adjLine=(l)=>'<div class="pus-vrow sl-adj" style="grid-template-columns:2.6fr 120px 100px 110px 1.4fr auto"><select class="sl-item">'+stockOptions(l&&l.item_id,false)+'</select>'
  +'<select class="sl-dir"><option value="decrease"'+(l&&l.direction==='decrease'?' selected':'')+'>Decrease</option><option value="increase"'+(l&&l.direction==='increase'?' selected':'')+'>Increase</option></select>'
  +'<input class="sl-qty" type="number" step="0.001" min="0" placeholder="Quantity" value="'+(l?esc(l.qty):'')+'"><input class="sl-rate" type="number" step="0.01" min="0" placeholder="Rate (increase)" value="'+(l&&l.rate&&l.direction==='increase'?esc(l.rate):'')+'">'
  +'<input class="sl-note" placeholder="Note" value="'+esc(l&&l.note||'')+'"><button class="btn btn-sm btn-ghost" title="Remove" onclick="this.parentNode.remove()"><i class="fa-solid fa-xmark"></i></button></div>';
let AE=null;
window.pusAdjEdit=async function(id){
  let a=null, ls=[];
  if(id){ const [h,l]=await Promise.all([U().PU().from('stock_adjustments').select('*').eq('id',id).single(),U().PU().from('adjustment_lines').select('*').eq('adjustment_id',id).order('line_no')]); if(h.error){ toast('Could not open','err'); return; } a=h.data; ls=l.data||[]; }
  AE={id:id||null,pending:!!(a&&a.status==='pending_approval')}; const wh=a?a.warehouse_id:(U().S.warehouses.find(w=>w.active)||{}).id; await loadBalances(wh);
  const pendingNote='<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:11px 14px;margin-bottom:12px;font-size:13.5px"><b style="color:#b45309"><i class="fa-solid fa-hourglass-half"></i> Awaiting approval</b><div style="margin-top:4px">Saving your changes pulls this adjustment back and sends it to the first approver again. Approvals given so far no longer count. Press Cancel to leave it as it is.</div></div>';
  openModal('<div class="modal-head"><h3>'+(a?'Edit adjustment':'New stock adjustment')+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm" style="max-height:calc(90vh - 150px);overflow:auto">'+(AE.pending?pendingNote:'')
    +'<div class="pi-form"><div>'+field('Warehouse','<select id="paWh" onchange="pusAdjWh()"'+(a?' disabled':'')+'>'+whOptions(wh)+'</select>')+field('Date','<input id="paDate" type="date" max="'+today()+'" value="'+esc(a?a.adj_date:today())+'">')+'</div>'
    +'<div>'+field('Kind','<select id="paKind">'+Object.keys(ADJKIND).filter(k=>k!=='transfer').map(k=>'<option value="'+k+'"'+(a&&a.kind===k?' selected':'')+'>'+ADJKIND[k]+'</option>').join('')+'</select>')+field('Reason','<input id="paReason" placeholder="e.g. found short in stock-take" value="'+esc(a?a.reason:'')+'">')+'</div></div>'
    +'<div class="pus-sub">Items</div><div class="pus-hint" style="margin-top:0">A <b>decrease</b> takes stock out at the average cost; an <b>increase</b> brings it in at the rate you give (or the current average if you leave it empty).</div>'
    +'<div id="paLines">'+(ls.length?ls.map(adjLine).join(''):adjLine(null))+'</div><button class="btn btn-sm" onclick="pusAdjAddLine()"><i class="fa-solid fa-plus"></i> Add item</button></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>'+(AE.pending?'':'<button class="btn" onclick="pusAdjSave(false)">Save draft</button>')+'<button class="btn btn-primary" onclick="pusAdjSave(true)">'+(AE.pending?'Save & send for approval again':a&&a.status==='rejected'?'Save & resubmit':'Save & submit for approval')+'</button></div>','xl');
};
window.pusAdjWh=async function(){ await loadBalances(parseInt(U().val('paWh'),10)||null); refreshStockSelects('sl-adj',false); };
window.pusAdjAddLine=function(){ $('paLines').insertAdjacentHTML('beforeend',adjLine(null)); };
window.pusAdjSave=async function(submit){
  const wh=parseInt(document.getElementById('paWh').value,10); if(!wh){ toast('Choose the warehouse','err'); return; }
  if(!U().val('paReason')){ toast('Give the reason for the adjustment','err'); return; }
  const lines=[], seen=new Set();
  for(const d of document.querySelectorAll('#paLines .sl-adj')){ const it=parseInt(d.querySelector('.sl-item').value,10), q=num(d.querySelector('.sl-qty').value);
    if(!it&&!q) continue; if(!it){ toast('Choose the item','err'); return; } if(!(q>0)){ toast('Enter a quantity for '+itemName(it),'err'); return; }
    if(seen.has(it)){ toast(itemName(it)+' is listed twice','err'); return; } seen.add(it);
    const dir=d.querySelector('.sl-dir').value; if(dir==='decrease'&&BAL[it]&&q>BAL[it].qty){ toast('Only '+qty(BAL[it].qty)+' '+stockUnit(it)+' of '+itemName(it)+' is in stock','err'); return; }
    lines.push({item_id:it,direction:dir,qty:q,rate:dir==='increase'?(d.querySelector('.sl-rate').value||null):null,note:d.querySelector('.sl-note').value.trim()||null}); }
  if(!lines.length){ toast('Add at least one item','err'); return; }
  const head={warehouse_id:wh,adj_date:U().val('paDate')||today(),kind:U().val('paKind'),reason:U().val('paReason')};
  let pulledBack=false;
  if(AE.pending){                      // awaiting approval: pull it back first (database function), then it is an ordinary draft
    const w=await U().PU().rpc('adjustment_withdraw',{p_id:AE.id}); if(U().fail(w.error,'Could not pull the adjustment back from approval')) return;
    pulledBack=true; submit=true;
  }
  const {data:id,error}=await U().PU().rpc('adjustment_save',{p_id:AE.id,p_head:head,p_lines:lines});
  if(U().fail(error,'Could not save')){ if(pulledBack) toast('The adjustment was pulled back from approval and is now a draft. Fix the problem, then send it again.','warn'); return; }
  if(submit){ const r=await U().PU().rpc('adjustment_submit',{p_id:id}); if(r.error){ toast('Saved as a draft, but it could not be submitted: '+r.error.message.replace(/Setup > Approvals/g,'Admin > Approvers'),'warn'); closeModal(); route(); return; } closeModal(); toast(pulledBack?'Saved and sent for approval again as '+r.data:'Submitted as '+r.data,'ok'); route(); return; }
  closeModal(); toast('Draft saved','ok'); route();
};
let AC=null;
window.pusAdjOpen=async function(id,tab){
  const PU=U().PU;
  const [h,ls,ap,lg]=await Promise.all([PU().from('stock_adjustments').select('*').eq('id',id).maybeSingle(),PU().from('adjustment_lines').select('*').eq('adjustment_id',id).order('line_no'),PU().from('adjustment_approvals').select('*').eq('adjustment_id',id).order('round').order('level'),loadLog('adjustment',id)]);
  if(h.error||!h.data||h.data.deleted_at){ toast('Could not open the adjustment','err'); return; }
  const a=h.data; AC={a,lines:ls.data||[],steps:ap.data||[],log:lg};
  const mineTurn=a.status==='pending_approval'&&(selfApproval()||a.raised_by.toLowerCase()!==me())&&AC.steps.some(s=>s.round===a.round&&s.level===a.current_level&&s.status==='pending'&&s.approvers.some(e=>e.toLowerCase()===me()));
  const canEdit=['draft','rejected'].includes(a.status)&&(a.raised_by.toLowerCase()===me()||state.super)&&U().can('stock.adjust'), btn=[];
  // While it is awaiting approval its maker can still change or delete it. Once approved (posted to stock): never.
  const canEditPending=a.status==='pending_approval'&&(a.raised_by.toLowerCase()===me()||state.super)&&U().can('stock.adjust');
  if(canEdit) btn.push('<button class="btn" onclick="pusAdjEdit('+id+')"><i class="fa-solid fa-pen"></i> Edit</button>','<button class="btn btn-primary" onclick="pusAdjSubmit('+id+')"><i class="fa-solid fa-paper-plane"></i> '+(a.status==='rejected'?'Resubmit':'Submit for approval')+'</button>');
  if(canEditPending) btn.push('<button class="btn" onclick="pusAdjEdit('+id+')" title="Pulls it back from approval; saving sends it to the first approver again"><i class="fa-solid fa-pen"></i> Edit</button>');
  if(mineTurn) btn.push('<button class="btn" onclick="pusAdjDecide('+id+',false)"><i class="fa-solid fa-circle-xmark"></i> Reject</button>','<button class="btn btn-primary" onclick="pusAdjDecide('+id+',true)"><i class="fa-solid fa-circle-check"></i> Approve & post</button>');
  const del=(a.status==='draft'&&canEdit)||canEditPending?'<button class="btn btn-ghost" style="margin-right:auto" onclick="pusAdjDelete('+id+')"><i class="fa-solid fa-trash"></i> '+(a.status==='draft'?'Delete draft':'Delete')+'</button>':'';
  const s=adjStatus(a);
  openModal('<div class="modal-head"><h3>Adjustment '+esc(a.doc_no||('Draft #'+a.id))+' <span class="tag '+s[1]+'">'+esc(s[0])+'</span></h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="max-height:calc(90vh - 150px);overflow:auto">'+U().stuckBanner({status:a.status,round:a.round,level:a.current_level,steps:AC.steps,raisedBy:a.raised_by,allowSelf:selfApproval(),what:'adjustment'})+tabsBar('pstA',[['main','Main Info'],['history','Change History'],['approval','Approval History']])+'<div id="pstABody"></div></div><div class="modal-foot">'+del+'<button class="btn" onclick="closeModal()">Close</button>'+btn.join('')+'</div>','xl');
  window.pstAGo(tab||'main');
};
window.pstAGo=function(t){
  document.querySelectorAll('#pstA a').forEach(a=>a.classList.toggle('on',a.dataset.t===t));
  const {a,lines,steps,log}=AC, b=$('pstABody'); if(!b) return;
  if(t==='main') b.innerHTML='<div class="pi-form"><div>'+ro('Warehouse',whName(a.warehouse_id))+ro('Date',U().dmy(a.adj_date))+ro('Kind',ADJKIND[a.kind]||a.kind)+'</div><div>'+ro('Raised by',uname(a.raised_by))+ro('Value',money(a.total_value))+(a.accounts_flag?ro('Note','Created by a transfer between legal entities — flagged for Accounts'):'')+'</div></div>'
      +'<div class="pi-row"><div class="l">Reason</div><div class="v pi-ro" style="min-height:44px;white-space:pre-wrap">'+esc(a.reason)+'</div></div>'
      +'<div class="card" style="padding:0"><table class="tbl"><thead><tr><th>#</th><th>Item</th><th>Direction</th><th class="pus-num">Quantity</th><th>Unit</th><th class="pus-num">Rate</th><th class="pus-num">Value</th><th>Note</th></tr></thead><tbody>'
      +lines.map((l,i)=>'<tr><td>'+(i+1)+'</td><td><b>'+esc(itemName(l.item_id))+'</b></td><td>'+(l.direction==='increase'?'<span class="tag t-green">Increase</span>':'<span class="tag t-red">Decrease</span>')+'</td><td class="pus-num">'+qty(l.qty)+'</td><td>'+esc(stockUnit(l.item_id))+'</td><td class="pus-num">'+(l.rate!=null?money(l.rate):'—')+'</td><td class="pus-num">'+(l.value!=null?money(l.value):'—')+'</td><td>'+esc(l.note||'')+'</td></tr>').join('')+'</tbody></table></div>';
  else if(t==='history') b.innerHTML=logRows(log);
  else { const done=steps.filter(s=>s.status==='approved'||s.status==='rejected'), pend=steps.filter(s=>s.status==='pending'&&s.round===a.round&&a.status==='pending_approval');
    b.innerHTML='<div class="card" style="padding:0"><table class="tbl"><thead><tr><th>Approved By</th><th>Profile</th><th>Action Information</th><th>Status</th><th>Date Time</th><th>Remarks</th></tr></thead><tbody>'
      +(done.map(s=>'<tr><td>'+esc(uname(s.acted_by))+'</td><td>'+esc(profile(s.acted_by))+'</td><td>Level '+s.level+' ('+(s.status==='approved'?'Approved By':'Rejected By')+')</td><td>'+(s.status==='approved'?'Approve':'Reject')+'</td><td style="white-space:nowrap">'+U().dmyTime(s.acted_at)+'</td><td>'+esc(s.remark||'')+'</td></tr>').join('')||'<tr><td colspan="6"><div class="empty" style="padding:14px"><div>No decisions yet</div></div></td></tr>')+'</tbody></table></div>'
      +'<div class="card" style="padding:0;margin-top:14px"><table class="tbl"><thead><tr><th>Pending With</th><th>Profile</th><th>Action Information</th></tr></thead><tbody>'
      +(pend.map(s=>s.approvers.map(e=>'<tr><td>'+esc(uname(e))+'</td><td>'+esc(profile(e))+'</td><td>Level '+s.level+' (Approval pending with '+esc(uname(e))+')</td></tr>').join('')).join('')||'<tr><td colspan="3"><div class="empty" style="padding:14px"><div>Nothing pending</div></div></td></tr>')+'</tbody></table></div>'; }
};
window.pusAdjSubmit=async function(id){ const {data,error}=await U().PU().rpc('adjustment_submit',{p_id:id}); if(U().fail(error,'Could not submit')) return; closeModal(); toast('Submitted as '+data,'ok'); route(); };
window.pusAdjDelete=async function(id){
  const pending=!!(AC&&AC.a.id===id&&AC.a.status==='pending_approval');
  if(!await confirmDialog(pending?'Delete this adjustment? It is awaiting approval — the approvers will no longer see it. This cannot be undone.':'Delete this draft adjustment?')) return;
  const {error}=await U().PU().rpc('adjustment_delete',{p_id:id}); if(U().fail(error,'Delete failed')) return; closeModal(); toast(pending?'Adjustment deleted':'Draft deleted','ok'); route();
};
window.pusAdjDecide=function(id,approve){
  openModal('<div class="modal-head"><h3>'+(approve?'Approve and post':'Reject')+' adjustment</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm">'+(approve?'<div class="pus-hint" style="margin-top:0">On the final approval the adjustment changes stock immediately, valued at today\'s average cost.</div>':'')
    +'<label>'+(approve?'Remark (optional)':'Reason for rejecting')+'</label><textarea id="paNote" rows="3"></textarea></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusAdjDecideSave('+id+','+approve+')">'+(approve?'Approve':'Reject')+'</button></div>');
};
window.pusAdjDecideSave=async function(id,approve){
  const note=U().val('paNote'); if(!approve&&!note){ toast('Give a reason for rejecting','err'); return; }
  const {data,error}=await U().PU().rpc('adjustment_decide',{p_id:id,p_approve:approve,p_remark:note||null});
  if(U().fail(error,approve?'Could not approve':'Could not reject')) return;
  closeModal(); toast(data==='approved'?'Approved — stock updated':data==='rejected'?'Rejected':'Approved — passed to the next level','ok'); route();
};

/* ================================================== TRANSFERS ================================================== */
const T={rows:[],lines:[],q:''};
async function trfList(host){
  const PU=U().PU;
  const [t,l]=await Promise.all([PU().from('transfers').select('*').order('dispatched_at',{ascending:false}),PU().from('transfer_lines').select('transfer_id,item_id,qty,value')]);
  const bad=[t,l].find(x=>x.error); if(bad) throw bad.error; T.rows=t.data||[]; T.lines=l.data||[]; trfRender(host);
}
const trfStatus=t=>({in_transit:['In transit','t-amber'],received:['Received','t-green'],completed:['Completed','t-green']}[t.status]||[t.status,'t-gray']);
function trfRender(host){
  host=host||$('pstBody'); if(!host) return; const q=T.q.toLowerCase();
  // a transfer belongs to both business units it touches: show it under either one
  const rows=T.rows.filter(t=>(inBu(t.from_project_id)||inBu(t.to_project_id))&&(!q||((t.doc_no||'')+' '+whName(t.from_wh)+' '+whName(t.to_wh)).toLowerCase().includes(q))).map(t=>{ const ls=T.lines.filter(x=>x.transfer_id===t.id), s=trfStatus(t);
    return '<tr style="cursor:pointer" onclick="pusTrfOpen('+t.id+')"><td><span class="pus-code">'+esc(t.doc_no)+'</span></td><td>'+esc(whName(t.from_wh))+' <i class="fa-solid fa-arrow-right" style="color:var(--slate);font-size:11px"></i> '+esc(whName(t.to_wh))+'</td><td style="white-space:nowrap">'+U().dmy(t.transfer_date)+'</td>'
      +'<td>'+(t.kind==='same_entity'?'<span class="tag t-gray">Same legal entity</span>':'<span class="tag t-blue">Different legal entity</span>')+'</td><td class="pus-num">'+ls.length+'</td><td class="pus-num">'+money(ls.reduce((s,x)=>s+ +x.value,0))+'</td><td><span class="tag '+s[1]+'">'+esc(s[0])+'</span></td><td>'+esc(uname(t.dispatched_by))+'</td></tr>'; }).join('');
  host.innerHTML=listShell('Transfers between warehouses','Between sites of the same legal entity it is a pure transfer (out of one, received at the other, via "in transit" unless switched off in Admin → Rules). Between different legal entities it is recorded as a linked stock adjustment decrease and increase, flagged for Accounts.',
    'New transfer',U().can('stock.transfer')?'pusTrfNew()':'',[['Transfer no'],['From → To'],['Date'],['Entity'],['Items',1],['Value',1],['Status'],['By']],rows,
    '<div class="pus-top"><input class="grow" id="pstQ" placeholder="Search by transfer no or warehouse" value="'+esc(T.q)+'" oninput="pusTrfSearch()"></div>');
}
window.pusTrfSearch=function(){ T.q=U().val('pstQ'); trfRender(); const e=$('pstQ'); if(e){ e.focus(); e.setSelectionRange(e.value.length,e.value.length); } };
const entityOf=wh=>{ const w=whById(wh); if(!w) return null; const pe=U().S.projEntity.find(p=>p.project_id===w.project_id); return pe?pe.legal_entity_id:null; };
window.pusTrfNew=async function(){
  const w=U().S.warehouses.find(x=>x.active); await loadBalances(w&&w.id);
  openModal('<div class="modal-head"><h3>New transfer</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm" style="max-height:calc(90vh - 150px);overflow:auto">'
    +'<div class="pi-form"><div>'+field('From warehouse','<select id="ptFrom" onchange="pusTrfWh()">'+whOptions(w&&w.id)+'</select>')+field('To warehouse','<select id="ptTo" onchange="pusTrfWh()">'+whOptions(null)+'</select>')+'</div>'
    +'<div>'+field('Date','<input id="ptDate" type="date" max="'+today()+'" value="'+today()+'">')+field('Vehicle no','<input id="ptVeh">')+'</div></div>'
    +'<div id="ptKind" class="pus-hint"></div>'
    +'<div class="pus-sub">Items</div><div id="ptLines">'+itemLine(null,'sl-trf',false)+'</div><button class="btn btn-sm" onclick="pusTrfAddLine()"><i class="fa-solid fa-plus"></i> Add item</button>'
    +'<label style="margin-top:12px">Remarks</label><input id="ptRem"></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusTrfSave()">Dispatch</button></div>','xl');
};
window.pusTrfWh=async function(){
  const f=parseInt(U().val('ptFrom'),10)||null, t=parseInt(U().val('ptTo'),10)||null;
  await loadBalances(f); refreshStockSelects('sl-trf',true);
  const k=$('ptKind'); if(!k) return;
  if(!f||!t){ k.innerHTML=''; return; }
  const ef=entityOf(f), et=entityOf(t);
  if(!ef||!et) k.innerHTML='<span class="tag t-red">Set the legal entity of both projects first (Setup → Legal entities)</span>';
  else if(ef===et) k.innerHTML='<span class="tag t-gray">Same legal entity</span> A pure transfer'+(U().rule('transfer.in_transit')==='true'?': the stock leaves now and is received at the other warehouse later (in transit).':': the stock moves in one step.');
  else k.innerHTML='<span class="tag t-blue">Different legal entity</span> Recorded as a linked stock adjustment decrease at the sender and increase at the receiver, at the same cost — flagged for Accounts. It completes in one step.';
};
window.pusTrfAddLine=function(){ $('ptLines').insertAdjacentHTML('beforeend',itemLine(null,'sl-trf',false)); };
window.pusTrfSave=async function(){
  const f=parseInt(U().val('ptFrom'),10), t=parseInt(U().val('ptTo'),10);
  if(!f||!t){ toast('Choose both warehouses','err'); return; } if(f===t){ toast('The two warehouses must be different','err'); return; }
  const lines=[], seen=new Set();
  for(const d of document.querySelectorAll('#ptLines .sl-trf')){ const it=parseInt(d.querySelector('.sl-item').value,10), q=num(d.querySelector('.sl-qty').value);
    if(!it&&!q) continue; if(!it){ toast('Choose the item','err'); return; } if(!(q>0)){ toast('Enter a quantity for '+itemName(it),'err'); return; }
    if(seen.has(it)){ toast(itemName(it)+' is listed twice','err'); return; } seen.add(it);
    if(BAL[it]&&q>BAL[it].qty){ toast('Only '+qty(BAL[it].qty)+' '+stockUnit(it)+' of '+itemName(it)+' is in stock','err'); return; }
    lines.push({item_id:it,qty:q,remark:d.querySelector('.sl-note').value.trim()||null}); }
  if(!lines.length){ toast('Add at least one item','err'); return; }
  const v=U().val, {data,error}=await U().PU().rpc('transfer_dispatch',{p_head:{from_wh:f,to_wh:t,transfer_date:v('ptDate')||today(),vehicle_no:v('ptVeh'),remarks:v('ptRem')},p_lines:lines});
  if(U().fail(error,'Could not dispatch')) return;
  closeModal(); toast('Done — '+data,'ok'); route();
};
let TC=null;
window.pusTrfOpen=async function(id){
  const PU=U().PU;
  const [h,ls,lg]=await Promise.all([PU().from('transfers').select('*').eq('id',id).maybeSingle(),PU().from('transfer_lines').select('*').eq('transfer_id',id).order('line_no'),loadLog('transfer',id)]);
  if(h.error||!h.data){ toast('Could not open the transfer','err'); return; }
  TC={t:h.data,lines:ls.data||[],log:lg}; const t=TC.t, s=trfStatus(t);
  openModal('<div class="modal-head"><h3>Transfer '+esc(t.doc_no)+' <span class="tag '+s[1]+'">'+esc(s[0])+'</span></h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body" style="max-height:calc(90vh - 150px);overflow:auto">'
    +'<div class="pi-form"><div>'+ro('From',whName(t.from_wh)+'  ('+projName(t.from_project_id)+')')+ro('To',whName(t.to_wh)+'  ('+projName(t.to_project_id)+')')+ro('Date',U().dmy(t.transfer_date))+'</div><div>'+ro('Legal entity',t.kind==='same_entity'?'Same — a pure transfer':'Different — recorded as linked stock adjustments (for Accounts)')+ro('Vehicle no',t.vehicle_no||'')+ro('Dispatched by',uname(t.dispatched_by))+(t.received_by?ro('Received by',uname(t.received_by)+'  ·  '+U().dmyTime(t.received_at)):'')+'</div></div>'
    +'<div class="card" style="padding:0"><table class="tbl"><thead><tr><th>Item</th><th>Unit</th><th class="pus-num">Sent</th><th class="pus-num">Received</th><th class="pus-num">Sent back</th><th class="pus-num">Rate</th><th class="pus-num">Value</th></tr></thead><tbody>'
    +TC.lines.map(l=>'<tr><td><b>'+esc(itemName(l.item_id))+'</b></td><td>'+esc(stockUnit(l.item_id))+'</td><td class="pus-num">'+qty(l.qty)+'</td><td class="pus-num">'+(t.status==='in_transit'?'—':qty(l.received_qty))+'</td><td class="pus-num">'+(+l.returned_qty?qty(l.returned_qty):'—')+'</td><td class="pus-num">'+money(l.rate)+'</td><td class="pus-num">'+money(l.value)+'</td></tr>').join('')+'</tbody></table></div>'
    +'<div class="pus-sub">Change history</div>'+logRows(lg)+'</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button>'
    +(t.status==='in_transit'&&U().can('stock.transfer')?'<button class="btn btn-primary" onclick="pusTrfReceive('+id+')"><i class="fa-solid fa-box-open"></i> Receive…</button>':'')+'</div>','xl');
};
window.pusTrfReceive=function(id){
  openModal('<div class="modal-head"><h3>Receive transfer '+esc(TC.t.doc_no)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm">'
    +'<div class="pus-hint" style="margin-top:0">Enter what actually arrived at '+esc(whName(TC.t.to_wh))+'. Anything that did not arrive goes back into stock at '+esc(whName(TC.t.from_wh))+'.</div>'
    +'<div class="card" style="padding:0"><table class="tbl"><thead><tr><th>Item</th><th class="pus-num">Sent</th><th>Received</th></tr></thead><tbody>'
    +TC.lines.map(l=>'<tr class="pt-line" data-id="'+l.id+'"><td><b>'+esc(itemName(l.item_id))+'</b></td><td class="pus-num">'+qty(l.qty)+' '+esc(stockUnit(l.item_id))+'</td><td><input class="pt-qty" type="number" step="0.001" min="0" max="'+l.qty+'" value="'+l.qty+'" style="width:100px"></td></tr>').join('')+'</tbody></table></div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusTrfReceiveSave('+id+')">Receive</button></div>');
};
window.pusTrfReceiveSave=async function(id){
  const lines=[...document.querySelectorAll('.pt-line')].map(tr=>({line_id:parseInt(tr.dataset.id,10),received_qty:num(tr.querySelector('.pt-qty').value)}));
  const {error}=await U().PU().rpc('transfer_receive',{p_id:id,p_lines:lines});
  if(U().fail(error,'Could not receive')) return;
  closeModal(); toast('Received','ok'); route();
};

/* ================================================== STOCK LEDGER ================================================== */
const L={view:'balances',wh:'',item:''};
window.pusLedgerRender=async function(host,seg){
  if(!window.PUS||!window.PUS.piCss){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Purchase could not finish loading - refresh the page.</div></div>'; return; }
  U().css(); U().vcss(); U().piCss(); loader(host);
  try{ await ensureData(); }catch(e){ host.innerHTML='<div class="empty"><div>Could not load: '+esc(e.message||e)+'</div></div>'; return; }
  seg=seg||[];
  // Stage 9 reports (stock summary, item ledger, ageing) live in purchase-reports.js.
  if(['summary','item','ageing'].includes(seg[0])){
    if(typeof window.pusReportRender!=='function'){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>The reports could not finish loading - refresh the page.</div></div>'; return; }
    await window.pusReportRender(host,seg[0]); return;
  }
  if(seg[0]==='movements') L.view='ledger'; else if(seg[0]==='stock') L.view='balances';
  host.innerHTML='<div id="pslHost"></div>'; await ledgerDraw();
};
async function ledgerDraw(){
  const host=$('pslHost'); if(!host) return; const PU=U().PU;
  const it=L.item?parseInt(L.item,10):null;
  // business unit: only the warehouses of that unit (a warehouse chosen earlier that is not in it is dropped)
  const buWhs=U().S.warehouses.filter(w=>inBu(w.project_id)).map(w=>w.id);
  if(L.wh&&!buWhs.includes(parseInt(L.wh,10))) L.wh='';
  const narrow=q=>L.wh?q.eq('warehouse_id',parseInt(L.wh,10)):(U().S.bu?q.in('warehouse_id',buWhs):q);
  let rowsHtml='', foot='';
  if(L.view==='balances'){
    let q=narrow(PU().from('stock_balances').select('*').gt('qty',0)); if(it) q=q.eq('item_id',it);
    const {data,error}=await q; if(error){ host.innerHTML='<div class="empty"><div>'+esc(error.message)+'</div></div>'; return; }
    const list=(data||[]).sort((a,b)=>itemName(a.item_id).localeCompare(itemName(b.item_id))||whName(a.warehouse_id).localeCompare(whName(b.warehouse_id)));
    rowsHtml=list.map(b=>'<tr><td><b>'+esc(itemName(b.item_id))+'</b><div style="font-size:12px;color:var(--slate)">'+esc((itemById(b.item_id)||{}).code||'')+'</div></td><td>'+esc(whName(b.warehouse_id))+'</td><td>'+esc(stockUnit(b.item_id))+'</td><td class="pus-num"><b>'+qty(b.qty)+'</b></td><td class="pus-num">'+money(b.avg_rate)+'</td><td class="pus-num">'+money(b.value)+'</td></tr>').join('');
    foot='<tr style="background:#f8fafc"><td colspan="5"><b>Total stock value</b></td><td class="pus-num"><b>'+money(list.reduce((s,b)=>s+ +b.value,0))+'</b></td></tr>';
    host.innerHTML=ledgerBar()+'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Item</th><th>Warehouse</th><th>Unit</th><th class="pus-num">In stock</th><th class="pus-num">Average cost</th><th class="pus-num">Value</th></tr></thead><tbody>'+(rowsHtml||'<tr><td colspan="6"><div class="empty" style="padding:24px"><div>No stock</div></div></td></tr>')+foot+'</tbody></table></div></div>';
  } else {
    let q=narrow(PU().from('stock_ledger').select('*').order('id',{ascending:false}).limit(300)); if(it) q=q.eq('item_id',it);
    const {data,error}=await q; if(error){ host.innerHTML='<div class="empty"><div>'+esc(error.message)+'</div></div>'; return; }
    rowsHtml=(data||[]).map(x=>'<tr><td style="white-space:nowrap">'+U().dmy(x.moved_on)+'</td><td>'+esc(whName(x.warehouse_id))+'</td><td><b>'+esc(itemName(x.item_id))+'</b></td><td><span class="pus-code">'+esc(x.doc_type)+'</span> '+esc(x.doc_no||'')+'<div style="font-size:12px;color:var(--slate)">'+esc(x.narration||'')+'</div></td>'
      +'<td class="pus-num" style="color:#15803d">'+(+x.qty>0?qty(x.qty):'')+'</td><td class="pus-num" style="color:#b91c1c">'+(+x.qty<0?qty(-x.qty):'')+'</td><td class="pus-num">'+money(x.rate)+'</td><td class="pus-num">'+money(x.value)+'</td><td class="pus-num"><b>'+qty(x.balance_qty)+'</b></td><td class="pus-num">'+money(x.balance_value)+'</td></tr>').join('');
    host.innerHTML=ledgerBar()+'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Date</th><th>Warehouse</th><th>Item</th><th>Document</th><th class="pus-num">In</th><th class="pus-num">Out</th><th class="pus-num">Rate</th><th class="pus-num">Value</th><th class="pus-num">Balance</th><th class="pus-num">Balance value</th></tr></thead><tbody>'+(rowsHtml||'<tr><td colspan="10"><div class="empty" style="padding:24px"><div>No movements</div></div></td></tr>')+'</tbody></table></div></div>'
      +((data||[]).length>=300?'<div class="pus-hint" style="margin-top:8px">Showing the latest 300 movements — filter by warehouse or item to narrow it.</div>':'');
  }
}
const ledgerBar=()=>'<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">Stock ledger</div><div class="pus-hint" style="margin:0">Every movement is recorded and cannot be edited; stock is valued at the weighted-average cost.</div></div></div>'
  +'<div class="pus-top"><div class="pus-subs" style="margin:0"><span class="chip'+(L.view==='balances'?' active':'')+'" onclick="pusLedgerView(\'balances\')">Current stock</span><span class="chip'+(L.view==='ledger'?' active':'')+'" onclick="pusLedgerView(\'ledger\')">Movements</span>'
  +(U().can('report.view')?'<span class="chip" onclick="navTo(\'inventory/6/summary\')">Stock summary</span><span class="chip" onclick="navTo(\'inventory/6/item\')">Item ledger</span><span class="chip" onclick="navTo(\'inventory/6/ageing\')">Stock ageing</span>':'')+'</div>'
  +buSel()+'<select id="plWh" onchange="pusLedgerFilter()"><option value="">All warehouses</option>'+U().S.warehouses.filter(w=>inBu(w.project_id)).map(w=>'<option value="'+w.id+'"'+(String(w.id)===L.wh?' selected':'')+'>'+esc(w.name)+'</option>').join('')+'</select>'
  +'<select id="plItem" onchange="pusLedgerFilter()"><option value="">All items</option>'+U().S.items.map(i=>'<option value="'+i.id+'"'+(String(i.id)===L.item?' selected':'')+'>'+esc(i.name)+'</option>').join('')+'</select></div>';
window.pusLedgerView=function(v){ L.view=v; ledgerDraw(); };
window.pusLedgerFilter=function(){ L.wh=U().val('plWh'); L.item=U().val('plItem'); ledgerDraw(); };
})();
