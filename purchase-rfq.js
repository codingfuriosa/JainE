/* ============================ PURCHASE & STORES — RFQ & QUOTATIONS (Stage 4) ============================
   Put the open items of approved indents out for quotation to approved vendors, record the quotations
   (entered by Purchase on a vendor's behalf, or - once the public vendor page is live - by the vendors
   themselves through their personal link), keeping every revision. Spec: docs/purchase-stores-spec.md §4.
   Tables and functions: supabase/migrations/20261004290000_purchase_rfq.sql. All writes go through the
   rfq_* / quotation_* functions; this file only shows state and calls them.
   Route: inventory/3 (inventory/3/<id> opens that RFQ). */
(function(){
if(window.__PUR_LOADED) return;
window.__PUR_LOADED=true;

const R={rows:[],lines:[],rvs:[],vendors:[],vgroups:[],poTypes:[],filter:'all',project:'',q:''};
const SC=[['all','All'],['draft','Draft'],['open','Open'],['closed','Closed'],['ordered','Ordered'],['cancelled','Cancelled']];
const U=()=>window.PUS;
const qty=n=>Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:3});
const money=n=>(n==null||n==='')?'—':'₹'+Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const me=()=>String(state.email||'').toLowerCase();
const today=()=>new Date().toISOString().slice(0,10);
const projName=id=>{const p=U().S.projects.find(x=>x.id===id);return p?p.name:'—';};
const vName=v=>v?(v.trade_name||v.legal_name):'—';
const docNo=r=>r.doc_no||('Draft #'+r.id);
const pastDue=r=>r.due_date&&r.due_date<today();

function status(r){
  switch(r.status){
    case 'draft': return ['Draft','t-gray'];
    case 'open': return pastDue(r)?['Open · last date passed','t-amber']:['Open','t-blue'];
    case 'closed': return ['Closed','t-amber'];
    case 'cancelled': return ['Cancelled','t-red'];
    case 'ordered': return ['Ordered','t-green'];
  }
  return [r.status,'t-gray'];
}
const statusTag=r=>{const s=status(r);return '<span class="tag '+s[1]+'">'+esc(s[0])+'</span>';};

async function rLoad(){
  await U().load();
  const PU=U().PU;
  const [r,l,rv,v,vg,pt]=await Promise.all([
    PU().from('rfqs').select('*').is('deleted_at',null).order('created_at',{ascending:false}),
    PU().from('rfq_lines').select('id,rfq_id'),
    PU().from('rfq_vendors').select('id,rfq_id,vendor_id,status,token,invited_at,emailed_at,decline_reason'),
    PU().from('vendors').select('id,code,legal_name,trade_name,status,email').is('deleted_at',null).order('legal_name'),
    PU().from('vendor_groups').select('*'),
    PU().from('po_types').select('id,name,active').is('deleted_at',null).order('sort_order')
  ]);
  const bad=[r,l,rv,v,vg,pt].find(x=>x.error); if(bad) throw bad.error;
  R.rows=r.data||[]; R.lines=l.data||[]; R.rvs=rv.data||[]; R.vendors=v.data||[]; R.vgroups=vg.data||[]; R.poTypes=pt.data||[];
}
const vendorById=id=>R.vendors.find(v=>v.id===id);
// RFQ mails go to the vendor's one email address (Vendors tab).
const rfqEmails=vid=>{ const v=vendorById(vid); return v&&v.email?[v.email]:[]; };

let SEQ=0;
window.pusRfqRender=async function(host,seg){
  if(!window.PUS||!window.PUS.piCss){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Purchase could not finish loading - refresh the page.</div></div>'; return; }
  U().css(); U().vcss(); U().piCss();
  const mine=++SEQ, stale=()=>mine!==SEQ||!host.isConnected;
  loader(host);
  try{ await rLoad(); }
  catch(e){ if(!stale()) host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load RFQs: '+esc(e.message||e)+'</div></div>'; return; }
  if(stale()) return;
  host.innerHTML='<div id="purHost"></div>';
  rRender();
  const id=parseInt(seg&&seg[0],10);
  if(id) window.pusRfqOpen(id);
};

function rRender(){
  const host=$('purHost'); if(!host) return;
  const q=R.q.toLowerCase();
  const base=R.rows.filter(r=>!R.project||String(r.project_id)===R.project);
  const inF=(r,k)=>k==='all'||r.status===k;
  const list=base.filter(r=>inF(r,R.filter)&&(!q||(docNo(r)+' '+projName(r.project_id)+' '+U().userName(r.created_by)).toLowerCase().includes(q)));
  const chips=SC.map(([k,l])=>'<span class="chip'+(R.filter===k?' active':'')+'" onclick="pusRfqFilter(\''+k+'\')">'+l+' ('+base.filter(r=>inF(r,k)).length+')</span>').join('');
  const rows=list.map(r=>{
    const vs=R.rvs.filter(x=>x.rfq_id===r.id), got=vs.filter(x=>x.status==='quoted').length;
    return '<tr style="cursor:pointer" onclick="pusRfqOpen('+r.id+')"><td><span class="pus-code">'+esc(docNo(r))+'</span></td><td>'+esc(projName(r.project_id))+'</td><td class="pus-num">'+R.lines.filter(l=>l.rfq_id===r.id).length+'</td>'
      +'<td>'+vs.length+' invited'+(r.status==='draft'?'':' · <b>'+got+'</b> quoted')+'</td><td style="white-space:nowrap">'+U().dmy(r.due_date)+'</td><td>'+statusTag(r)+'</td><td>'+esc(U().userName(r.created_by))+'</td></tr>';
  }).join('');
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">RFQs & quotations</div><div class="pus-hint" style="margin:0">Put approved indent items out for quotation to approved vendors, then record what each vendor quotes. The comparison comes next.</div></div>'
    +(U().can('rfq.manage')?'<button class="btn btn-primary" onclick="pusRfqEdit()"><i class="fa-solid fa-plus"></i> New RFQ</button>':'')+'</div>'
    +'<div class="pus-top"><div class="pus-subs" style="margin:0">'+chips+'</div>'
    +'<select id="purProj" onchange="pusRfqProject()"><option value="">All business units</option>'+U().S.projects.map(p=>'<option value="'+p.id+'"'+(String(p.id)===R.project?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select>'
    +'<input class="grow" id="purQ" placeholder="Search by number, business unit or person" value="'+esc(R.q)+'" oninput="pusRfqSearch()"></div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>RFQ no</th><th>Business unit</th><th class="pus-num">Items</th><th>Vendors</th><th>Last date</th><th>Status</th><th>Created by</th></tr></thead><tbody>'
    +(rows||'<tr><td colspan="7"><div class="empty" style="padding:24px"><div>'+(R.rows.length?'No RFQs match':'No RFQs yet')+'</div></div></td></tr>')+'</tbody></table></div></div>';
}
window.pusRfqFilter=function(k){ R.filter=k; rRender(); };
window.pusRfqProject=function(){ R.project=U().val('purProj'); rRender(); };
window.pusRfqSearch=function(){ R.q=U().val('purQ'); rRender(); const e=$('purQ'); if(e){ e.focus(); e.setSelectionRange(e.value.length,e.value.length); } };

/* ---------------- detail ---------------- */
const TABS=[['details','Details'],['vendors','Vendors & Quotations'],['compare','Comparison'],['bids','Bid history'],['history','Change History']];
let CUR=null;   // {r, lines, sources, rvs, log, qs}

window.pusRfqOpen=async function(id,tab){
  const PU=U().PU;
  const [h,ls,src,rv,lg]=await Promise.all([
    PU().from('rfqs').select('*').eq('id',id).maybeSingle(),
    PU().from('rfq_lines').select('*, items(code,name,hsn_code)').eq('rfq_id',id).order('line_no'),
    PU().from('rfq_sources').select('*, indents(doc_no)').eq('rfq_id',id),
    PU().from('rfq_vendors').select('*').eq('rfq_id',id).order('id'),
    PU().from('doc_log').select('*').eq('doc_type','rfq').eq('doc_id',id).order('at')
  ]);
  const bad=[h,ls,src,rv,lg].find(x=>x.error);
  if(bad){ toast('Could not open the RFQ: '+bad.error.message,'err'); return; }
  const r=h.data; if(!r||r.deleted_at){ toast('That RFQ no longer exists','err'); return; }
  const rvIds=(rv.data||[]).map(x=>x.id);
  let qs=[];
  if(rvIds.length){ const q=await PU().from('quotations').select('id,rfq_vendor_id,revision,is_current,source,entered_by,submitted_at').in('rfq_vendor_id',rvIds).order('revision'); if(!q.error) qs=q.data||[]; }
  CUR={r,lines:ls.data||[],sources:src.data||[],rvs:rv.data||[],log:lg.data||[],qs}; CMP=null; SEL={};
  const can=U().can('rfq.manage'), btn=[];
  if(can){
    if(r.status==='draft') btn.push('<button class="btn" onclick="pusRfqEdit('+id+')"><i class="fa-solid fa-pen"></i> Edit</button>','<button class="btn btn-primary" onclick="pusRfqSend('+id+')"><i class="fa-solid fa-paper-plane"></i> Send to vendors</button>');
    if(r.status==='open') btn.push('<button class="btn" onclick="pusRfqReopen('+id+',true)"><i class="fa-solid fa-calendar-plus"></i> Extend last date</button>','<button class="btn btn-primary" onclick="pusRfqClose('+id+')"><i class="fa-solid fa-lock"></i> Close quotations</button>');
    if(r.status==='closed') btn.push('<button class="btn btn-primary" onclick="pusRfqReopen('+id+',false)"><i class="fa-solid fa-lock-open"></i> Reopen</button>');
    if(['draft','open','closed'].includes(r.status)) btn.push('<button class="btn btn-ghost" onclick="pusRfqCancel('+id+')"><i class="fa-solid fa-ban"></i> Cancel RFQ</button>');
  }
  const del=can&&r.status==='draft'?'<button class="btn btn-ghost" style="margin-right:auto" onclick="pusRfqDelete('+id+')"><i class="fa-solid fa-trash"></i> Delete draft</button>':'';
  openModal('<div class="modal-head"><h3>RFQ '+esc(docNo(r))+' '+statusTag(r)+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="max-height:74vh;overflow:auto"><div class="pi-tabs" id="prTabs">'+TABS.map(t=>'<a data-t="'+t[0]+'" onclick="pusRfqTab(\''+t[0]+'\')">'+t[1]+'</a>').join('')+'</div><div id="prBody"></div></div>'
    +'<div class="modal-foot">'+del+'<button class="btn" onclick="closeModal()">Close</button>'+btn.join('')+'</div>','xl');
  window.pusRfqTab(tab||'details');
};
window.pusRfqTab=async function(t){
  document.querySelectorAll('#prTabs a').forEach(a=>a.classList.toggle('on',a.dataset.t===t));
  const b=$('prBody'); if(!b||!CUR) return;
  if(t==='compare'||t==='bids'){
    b.innerHTML='<div class="pus-hint">Loading…</div>';
    try{ await cmpLoad(); }catch(e){ b.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load the comparison: '+esc(e.message||e)+'</div></div>'; return; }
  }
  if(!document.querySelector('#prTabs a.on')||document.querySelector('#prTabs a.on').dataset.t!==t) return;   // the user moved on while it loaded
  b.innerHTML=({details:tabDetails,vendors:tabVendors,compare:tabCompare,bids:tabBids,history:tabHistory}[t])();
};

function tabDetails(){
  const {r,lines,sources}=CUR, ro=U().roField;
  const rows=lines.map((l,i)=>{
    const src=sources.filter(s=>s.rfq_line_id===l.id).map(s=>esc((s.indents&&s.indents.doc_no)||'Indent')+' ('+qty(s.qty)+')').join(', ');
    return '<tr><td>'+(i+1)+'</td><td><span class="pus-code">'+esc(l.items.code)+'</span></td><td><b>'+esc(l.items.name)+'</b><div style="font-size:12px;color:var(--slate)">HSN '+esc(l.items.hsn_code)+'</div></td><td>'+esc(U().uomCode(l.uom_id))+'</td><td class="pus-num"><b>'+qty(l.qty)+'</b></td><td style="font-size:12.5px">'+src+'</td></tr>';
  }).join('');
  return '<div class="pi-form"><div>'+ro('Business unit',projName(r.project_id))+ro('RFQ No',r.doc_no||'Assigned when sent')+ro('RFQ Date',U().dmy(r.rfq_date))
    +'</div><div>'+ro('Last date for quotes',U().dmy(r.due_date))+ro('Created by',U().userName(r.created_by))+(r.status==='cancelled'?ro('Cancelled because',r.cancel_reason||''):'')+'</div></div>'
    +'<div class="pi-row"><div class="l">Remarks</div><div class="v pi-ro" style="min-height:48px;white-space:pre-wrap">'+(r.remarks?esc(r.remarks):'&nbsp;')+'</div></div>'
    +'<div class="pi-row"><div class="l">Terms requested</div><div class="v pi-ro" style="min-height:48px;white-space:pre-wrap">'+(r.terms_requested?esc(r.terms_requested):'&nbsp;')+'</div></div>'
    +'<div class="card" style="padding:0;margin-top:6px"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>S.No.</th><th>Code</th><th>Description</th><th>Unit</th><th class="pus-num">Quantity</th><th>From indent</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
}

const linkOf=rv=>location.origin+location.pathname.replace(/[^/]*$/,'')+'vendor-quote.html?t='+encodeURIComponent(rv.token);
function tabVendors(){
  const {r,rvs,qs}=CUR, can=U().can('rfq.manage'), live=r.status==='open'||r.status==='closed';
  const rows=rvs.map(rv=>{
    const v=vendorById(rv.vendor_id), mine=qs.filter(q=>q.rfq_vendor_id===rv.id), cur=mine.find(q=>q.is_current), em=rfqEmails(rv.vendor_id);
    const st=rv.status==='quoted'?'<span class="tag t-green">Quoted</span> <span style="font-size:12px;color:var(--slate)">rev '+cur.revision+(cur.source==='vendor'?' · by vendor':' · by Purchase')+'</span>'
      :rv.status==='declined'?'<span class="tag t-red">Declined</span>'+(rv.decline_reason?'<div style="font-size:12px;color:var(--slate)">'+esc(rv.decline_reason)+'</div>':'')
      :'<span class="tag t-gray">Not quoted yet</span>';
    return '<tr><td><span class="pus-code">'+esc(v?v.code:'')+'</span> <b>'+esc(vName(v))+'</b></td><td style="font-size:12.5px">'+(em.length?esc(em.join(', ')):'<span class="tag t-amber">No RFQ email</span>')+'</td><td>'+st+'</td>'
      +'<td class="pus-act">'+(mine.length?'<button class="btn btn-sm" onclick="pusRfqViewQuote('+rv.id+')"><i class="fa-solid fa-eye"></i> View</button> ':'')
      +(can&&live?'<button class="btn btn-sm btn-primary" onclick="pusRfqQuote('+rv.id+')"><i class="fa-solid fa-pen-to-square"></i> '+(cur?'Revise':'Enter quotation')+'</button> ':'')
      +(live?'<button class="btn btn-sm" title="Copy the vendor\'s personal quote link" onclick="pusRfqLink('+rv.id+')"><i class="fa-solid fa-link"></i></button> <button class="btn btn-sm" title="Email the link to the vendor" onclick="pusRfqEmail('+rv.id+')"><i class="fa-solid fa-envelope"></i></button>':'')+'</td></tr>';
  }).join('');
  return '<div class="pus-hint" style="margin-top:0">'+(r.status==='draft'?'The vendors below are invited when you send the RFQ.':'Each vendor has a personal link to quote without signing in. You can also enter a quotation for a vendor yourself (phone, email, PDF) — every save is kept as a new revision.')+'</div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Vendor</th><th>RFQ emails go to</th><th>Quotation</th><th></th></tr></thead><tbody>'
    +(rows||'<tr><td colspan="4"><div class="empty" style="padding:18px"><div>No vendors invited</div></div></td></tr>')+'</tbody></table></div></div>';
}
function tabHistory(){
  const rows=CUR.log.map(x=>'<tr><td>'+esc(String(x.by||'').startsWith('vendor: ')?x.by:U().userName(x.by))+'</td><td style="white-space:nowrap">'+U().dmyTime(x.at)+'</td><td>'+esc(x.action)+(x.remark?'<div style="font-size:12px;color:var(--slate)">'+esc(x.remark)+'</div>':'')+'</td><td>'+esc(x.ip||'—')+'</td></tr>').join('');
  return '<div class="card" style="padding:0"><table class="tbl"><thead><tr><th>User</th><th>Modified Time</th><th>Action</th><th>IP Address</th></tr></thead><tbody>'+(rows||'<tr><td colspan="4"><div class="empty" style="padding:18px"><div>No history</div></div></td></tr>')+'</tbody></table></div>';
}

window.pusRfqLink=async function(rvId){
  const rv=CUR.rvs.find(x=>x.id===rvId), link=linkOf(rv);
  try{ await navigator.clipboard.writeText(link); toast('Link copied — it is personal to this vendor','ok'); }
  catch(e){ openModal('<div class="modal-head"><h3>Vendor quote link</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><input readonly value="'+esc(link)+'" onclick="this.select()"></div><div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Close</button></div>'); }
};
window.pusRfqEmail=async function(rvId){
  const {data:{session}}=await sb.auth.getSession();
  try{
    const res=await fetch(SUPABASE_URL+'/functions/v1/rfq-mailer',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(session&&session.access_token),'apikey':SUPABASE_KEY},body:JSON.stringify({rfq_vendor_id:rvId})});
    const out=await res.json().catch(()=>({}));
    if(!res.ok||out.error) throw new Error(out.error||('status '+res.status));
    toast('Link emailed to the vendor','ok');
  }catch(e){ toast('The email could not be sent ('+e.message+'). Use the link button and send it yourself.','warn'); }
};

/* ---------------- viewing a quotation (all revisions) ---------------- */
window.pusRfqViewQuote=async function(rvId){
  const PU=U().PU, rv=CUR.rvs.find(x=>x.id===rvId), v=vendorById(rv.vendor_id);
  const {data,error}=await PU().from('quotations').select('*, quotation_lines(*)').eq('rfq_vendor_id',rvId).order('revision',{ascending:false});
  if(error){ toast('Could not load the quotation: '+error.message,'err'); return; }
  const revs=data||[]; window.__PR_REVS=revs;
  openModal('<div class="modal-head"><h3>Quotation — '+esc(vName(v))+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body" style="max-height:72vh;overflow:auto">'
    +'<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px"><label style="font-size:13px;color:var(--slate)">Revision</label><select id="prRev" onchange="pusRfqShowRev()">'+revs.map(q=>'<option value="'+q.revision+'">'+q.revision+(q.is_current?' (latest)':'')+' — '+U().dmyTime(q.submitted_at)+' — '+(q.source==='vendor'?'by vendor':'by Purchase')+'</option>').join('')+'</select></div><div id="prRevBody"></div></div>'
    +'<div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Close</button></div>','xl');
  window.pusRfqShowRev();
};
window.pusRfqShowRev=function(){
  const rev=parseInt(U().val('prRev'),10), q=(window.__PR_REVS||[]).find(x=>x.revision===rev); if(!q) return;
  const lineBy={}; (q.quotation_lines||[]).forEach(l=>lineBy[l.rfq_line_id]=l);
  const rows=CUR.lines.map((l,i)=>{ const x=lineBy[l.id];
    if(!x||!x.quoting) return '<tr><td>'+(i+1)+'</td><td><b>'+esc(l.items.name)+'</b></td><td class="pus-num">'+qty(l.qty)+' '+esc(U().uomCode(l.uom_id))+'</td><td colspan="5" style="color:var(--slate)">Not quoting'+(x&&x.remark?' — '+esc(x.remark):'')+'</td></tr>';
    return '<tr><td>'+(i+1)+'</td><td><b>'+esc(l.items.name)+'</b></td><td class="pus-num">'+qty(l.qty)+' '+esc(U().uomCode(l.uom_id))+'</td><td>'+esc(U().uomCode(x.uom_id))+(x.uom_id!==l.uom_id?' <span class="tag t-amber" title="Quoted in a different unit than requested">different unit</span>':'')+'</td><td class="pus-num"><b>'+money(x.rate)+'</b></td><td class="pus-num">'+qty(x.gst_rate)+'%</td><td>'+esc(x.make||'')+'</td><td>'+esc(x.remark||'')+'</td></tr>'; }).join('');
  const terms=[['Payment',q.payment_terms],['Delivery',q.delivery_terms],['Warranty / guarantee',q.warranty_terms],['Freight',q.freight_terms],['Price validity',q.price_validity],['Other',q.other_terms],['Remarks',q.remarks]].filter(t=>t[1]);
  $('prRevBody').innerHTML='<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>#</th><th>Item</th><th class="pus-num">Requested</th><th>Unit</th><th class="pus-num">Rate</th><th class="pus-num">GST</th><th>Make</th><th>Remark</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>'
    +'<div class="pus-sub">Terms</div>'+(terms.length?terms.map(t=>'<div style="display:flex;gap:12px;padding:4px 0;font-size:13.5px"><div style="width:160px;color:var(--slate)">'+t[0]+'</div><div style="flex:1;white-space:pre-wrap">'+esc(t[1])+'</div></div>').join(''):'<div style="color:var(--slate);font-size:13px">No terms stated</div>');
};

/* ---------------- entering / revising a quotation on a vendor's behalf ---------------- */
window.pusRfqQuote=async function(rvId){
  const PU=U().PU, rv=CUR.rvs.find(x=>x.id===rvId), v=vendorById(rv.vendor_id);
  const {data}=await PU().from('quotations').select('*, quotation_lines(*)').eq('rfq_vendor_id',rvId).eq('is_current',true).maybeSingle();
  const cur=data||null, lineBy={}; if(cur) (cur.quotation_lines||[]).forEach(l=>lineBy[l.rfq_line_id]=l);
  const uomOpts=sel=>U().S.uoms.map(u=>'<option value="'+u.id+'"'+(u.id===sel?' selected':'')+'>'+esc(u.code)+'</option>').join('');
  const rows=CUR.lines.map((l,i)=>{
    const x=lineBy[l.id], quoting=x?x.quoting:true;
    return '<tr class="pq-line" data-line="'+l.id+'"><td>'+(i+1)+'</td><td><b>'+esc(l.items.name)+'</b><div style="font-size:12px;color:var(--slate)">'+qty(l.qty)+' '+esc(U().uomCode(l.uom_id))+' · HSN '+esc(l.items.hsn_code)+'</div></td>'
      +'<td><input type="checkbox" class="pq-on" style="width:auto"'+(quoting?' checked':'')+' onchange="pusRfqQuoteToggle(this)"></td>'
      +'<td><select class="pq-uom" style="min-width:76px">'+uomOpts(x&&x.uom_id?x.uom_id:l.uom_id)+'</select></td>'
      +'<td><input class="pq-rate" type="number" step="0.01" min="0" style="width:110px" value="'+(x&&x.rate!=null?esc(x.rate):'')+'"></td>'
      +'<td><input class="pq-gst" type="number" step="0.01" min="0" max="100" style="width:72px" value="'+(x&&x.gst_rate!=null?esc(x.gst_rate):esc(l.items.gst_rate!=null?l.items.gst_rate:18))+'"></td>'
      +'<td><input class="pq-make" style="width:120px" value="'+esc(x&&x.make||'')+'"></td><td><input class="pq-rem" style="width:140px" value="'+esc(x&&x.remark||'')+'"></td></tr>';
  }).join('');
  const t=f=>esc(cur&&cur[f]||'');
  openModal('<div class="modal-head"><h3>'+(cur?'Revise':'Enter')+' quotation — '+esc(vName(v))+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm" style="max-height:74vh;overflow:auto"><div class="pus-hint" style="margin-top:0">Entered by you on the vendor\'s behalf. Saving creates a new revision'+(cur?' (the current one is revision '+cur.revision+')':'')+'; earlier ones stay on record. Tick "Quoting" off for items the vendor will not quote.</div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>#</th><th>Item</th><th>Quoting</th><th>Unit</th><th>Rate (₹)</th><th>GST %</th><th>Make</th><th>Remark</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>'
    +'<div class="pus-sub">Terms (common to all items)</div>'
    +'<div class="two"><div><label>Payment terms</label><input id="pqPay" value="'+t('payment_terms')+'" placeholder="e.g. 30 days from invoice"></div><div><label>Delivery</label><input id="pqDel" value="'+t('delivery_terms')+'" placeholder="e.g. within 7 days of order"></div></div>'
    +'<div class="two"><div><label>Warranty / guarantee</label><input id="pqWar" value="'+t('warranty_terms')+'"></div><div><label>Freight</label><input id="pqFre" value="'+t('freight_terms')+'" placeholder="e.g. included / extra at actuals"></div></div>'
    +'<div class="two"><div><label>Price validity</label><input id="pqVal" value="'+t('price_validity')+'" placeholder="e.g. 30 days"></div><div><label>Other terms</label><input id="pqOth" value="'+t('other_terms')+'"></div></div>'
    +'<label>Remarks</label><input id="pqRem" value="'+t('remarks')+'"></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusRfqQuoteSave('+rvId+')">Save quotation</button></div>','xl');
  document.querySelectorAll('.pq-line').forEach(tr=>window.pusRfqQuoteToggle(tr.querySelector('.pq-on')));
};
window.pusRfqQuoteToggle=function(cb){ const tr=cb.closest('tr'); tr.querySelectorAll('.pq-uom,.pq-rate,.pq-gst,.pq-make').forEach(e=>{ e.disabled=!cb.checked; }); };
window.pusRfqQuoteSave=async function(rvId){
  const lines=[];
  for(const tr of document.querySelectorAll('.pq-line')){
    const on=tr.querySelector('.pq-on').checked, rate=parseFloat(tr.querySelector('.pq-rate').value);
    if(on&&!(rate>0)){ toast('Enter a rate for every item that is being quoted','err'); return; }
    lines.push({rfq_line_id:parseInt(tr.dataset.line,10),quoting:on,uom_id:on?parseInt(tr.querySelector('.pq-uom').value,10):null,rate:on?rate:null,
      gst_rate:on?(parseFloat(tr.querySelector('.pq-gst').value)||0):null,make:on?tr.querySelector('.pq-make').value.trim()||null:null,remark:tr.querySelector('.pq-rem').value.trim()||null});
  }
  if(!lines.some(l=>l.quoting)){ toast('Quote at least one item','err'); return; }
  const v=U().val;
  const {data,error}=await U().PU().rpc('quotation_save_manual',{p_rfq_vendor_id:rvId,p:{lines,payment_terms:v('pqPay'),delivery_terms:v('pqDel'),warranty_terms:v('pqWar'),freight_terms:v('pqFre'),price_validity:v('pqVal'),other_terms:v('pqOth'),remarks:v('pqRem')}});
  if(U().fail(error,'Could not save the quotation')) return;
  closeModal(); toast('Quotation saved (revision '+data+')','ok'); window.pusRfqOpen(CUR.r.id,'vendors');
};

/* ---------------- state changes ---------------- */
window.pusRfqSend=async function(id){
  if(!await confirmDialog('Send this RFQ to the invited vendors? It gets its number and the vendors\' links become active.')) return;
  const {data,error}=await U().PU().rpc('rfq_send',{p_id:id});
  if(U().fail(error,'Could not send')) return;
  toast('Sent as '+data+' — now email or copy each vendor\'s link under Vendors & Quotations','ok'); closeModal(); route();
};
window.pusRfqClose=async function(id){
  if(!await confirmDialog('Close quotations? Vendors will no longer be able to quote. You can reopen it.')) return;
  const {error}=await U().PU().rpc('rfq_close',{p_id:id});
  if(U().fail(error,'Could not close')) return;
  toast('Quotations closed','ok'); closeModal(); route();
};
window.pusRfqReopen=function(id,extend){
  const r=CUR.r;
  openModal('<div class="modal-head"><h3>'+(extend?'Extend last date':'Reopen RFQ')+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><label>New last date for quotations</label><input id="prDue" type="date" min="'+today()+'" value="'+esc(r.due_date&&r.due_date>=today()?r.due_date:'')+'"></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusRfqReopenSave('+id+')">'+(extend?'Extend':'Reopen')+'</button></div>');
};
window.pusRfqReopenSave=async function(id){
  const d=U().val('prDue'); if(!d){ toast('Choose the new last date','err'); return; }
  const {error}=await U().PU().rpc('rfq_reopen',{p_id:id,p_due:d});
  if(U().fail(error,'Could not update')) return;
  closeModal(); toast('RFQ is open until '+U().dmy(d),'ok'); route();
};
window.pusRfqCancel=function(id){
  openModal('<div class="modal-head"><h3>Cancel RFQ</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><div class="pus-hint" style="margin-top:0">Vendors can no longer quote. The indent items become free to put in another RFQ.</div><label>Reason</label><textarea id="prWhy" rows="3"></textarea></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Keep it</button><button class="btn btn-primary" onclick="pusRfqCancelSave('+id+')">Cancel RFQ</button></div>');
};
window.pusRfqCancelSave=async function(id){
  const why=U().val('prWhy'); if(!why){ toast('Give a reason','err'); return; }
  const {error}=await U().PU().rpc('rfq_cancel',{p_id:id,p_reason:why});
  if(U().fail(error,'Could not cancel')) return;
  closeModal(); toast('RFQ cancelled','ok'); route();
};
window.pusRfqDelete=async function(id){
  if(!await confirmDialog('Delete this draft RFQ?')) return;
  const {error}=await U().PU().rpc('rfq_delete',{p_id:id});
  if(U().fail(error,'Delete failed')) return;
  closeModal(); toast('Draft deleted','ok'); navTo('inventory/3');
};

/* ---------------- create / edit a draft ---------------- */
let ED=null;   // {id, project, picks:{indent_line_id:{qty}}, vendors:Set, avail:[...]}
async function loadAvail(project){
  const PU=U().PU;
  const {data:inds,error}=await PU().from('indents').select('id,doc_no,indent_date').eq('project_id',project).eq('status','approved').is('deleted_at',null).order('indent_date');
  if(error) throw error;
  const ids=(inds||[]).map(i=>i.id); if(!ids.length) return [];
  const [ls,sr]=await Promise.all([
    PU().from('indent_lines').select('*, items(code,name,hsn_code,group_id)').in('indent_id',ids).order('line_no'),
    PU().from('rfq_sources').select('indent_line_id,qty,rfqs(status,doc_no,deleted_at)').in('indent_id',ids)
  ]);
  if(ls.error) throw ls.error; if(sr.error) throw sr.error;
  const inRfq={}; (sr.data||[]).forEach(s=>{ if(s.rfqs&&!s.rfqs.deleted_at&&['draft','open','closed'].includes(s.rfqs.status)) (inRfq[s.indent_line_id]=inRfq[s.indent_line_id]||[]).push(s.rfqs.doc_no||'draft RFQ'); });
  const out=[];
  (inds||[]).forEach(i=>(ls.data||[]).filter(l=>l.indent_id===i.id).forEach(l=>{
    const bal=+l.qty-+l.ordered_qty-+l.short_closed_qty;
    if(bal>0) out.push({indent:i,line:l,bal,inRfq:inRfq[l.id]||[]});
  }));
  return out;
}
const groupNameOf=id=>{const g=U().S.groups.find(x=>x.id===id);return g?g.name:'—';};
// The earlier (approved) indents of the chosen business unit, one row per item still to be quoted:
// Indent No, Date, Group and Item, then how much is open and how much to put out for quotation.
const availText=a=>(a.indent.doc_no||'')+' '+U().dmy(a.indent.indent_date)+' '+groupNameOf(a.line.items.group_id)+' '+a.line.items.name+' '+a.line.items.code;
const availBody=()=>{
  if(!ED.project) return '<div class="pus-hint">Choose the business unit to see its approved indents.</div>';
  if(!ED.avail.length) return '<div class="empty" style="padding:18px"><div>This business unit has no approved indent items waiting to be quoted.</div></div>';
  const q=(ED.q||'').trim().toLowerCase(), shown=ED.avail.filter(a=>!q||availText(a).toLowerCase().includes(q));
  return '<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th></th><th>Indent No</th><th>Date</th><th>Group</th><th>Item</th><th class="pus-num">Open balance</th><th class="pus-num">Quote for</th><th>Already in</th></tr></thead><tbody>'
    +shown.map(a=>{ const id=a.line.id, p=ED.picks[id];
      return '<tr><td><input type="checkbox" style="width:auto"'+(p?' checked':'')+' onchange="pusRfqPick('+id+',this.checked)"></td><td><span class="pus-code">'+esc(a.indent.doc_no||'')+'</span></td><td style="white-space:nowrap">'+U().dmy(a.indent.indent_date)+'</td><td>'+esc(groupNameOf(a.line.items.group_id))+'</td>'
        +'<td><b>'+esc(a.line.items.name)+'</b><div style="font-size:12px;color:var(--slate)">'+esc(a.line.items.code)+'</div></td><td class="pus-num">'+qty(a.bal)+' '+esc(U().uomCode(a.line.uom_id))+'</td>'
        +'<td class="pus-num"><input type="number" step="0.001" min="0" max="'+a.bal+'" style="width:100px" value="'+(p?esc(p.qty):'')+'" '+(p?'':'disabled')+' onchange="pusRfqPickQty('+id+',this.value)"></td>'
        +'<td style="font-size:12px;color:var(--slate)">'+(a.inRfq.length?esc(a.inRfq.join(', ')):'—')+'</td></tr>'; }).join('')
    +(shown.length?'':'<tr><td colspan="8"><div class="empty" style="padding:16px"><div>No indent item matches “'+esc(ED.q)+'”</div></div></td></tr>')+'</tbody></table></div></div>'
    +'<div class="pus-hint" style="margin-top:6px">'+Object.keys(ED.picks).length+' item'+(Object.keys(ED.picks).length===1?'':'s')+' selected'+(q?' · '+shown.length+' of '+ED.avail.length+' shown':'')+'</div>';
};
window.pusRfqAvailSearch=function(){ ED.q=U().val('prAvailQ'); $('prAvail').innerHTML=availBody(); };
const vendorsBody=()=>{
  const groups=new Set(Object.keys(ED.picks).map(id=>{ const a=ED.avail.find(x=>String(x.line.id)===id); return a&&a.line.items.group_id; }).filter(Boolean));
  const approved=R.vendors.filter(v=>v.status==='approved');
  const sugg=v=>R.vgroups.some(g=>g.vendor_id===v.id&&groups.has(g.group_id));
  const sorted=approved.slice().sort((a,b)=>(sugg(b)?1:0)-(sugg(a)?1:0));
  if(!approved.length) return '<div class="empty" style="padding:18px"><div>No approved vendors yet — enlist and approve vendors on the Vendors tab.</div></div>';
  return '<div class="card" style="padding:0;max-height:260px;overflow:auto"><table class="tbl"><tbody>'+sorted.map(v=>{ const em=rfqEmails(v.id);
    return '<tr><td style="width:36px"><input type="checkbox" style="width:auto"'+(ED.vendors.has(v.id)?' checked':'')+' onchange="pusRfqVend('+v.id+',this.checked)"></td><td><span class="pus-code">'+esc(v.code)+'</span> <b>'+esc(vName(v))+'</b>'
      +(sugg(v)?' <span class="tag t-green">Supplies these items</span>':'')+(em.length?'':' <span class="tag t-amber">No RFQ email</span>')+'</td><td style="font-size:12.5px;color:var(--slate)">'+esc(em.join(', '))+'</td></tr>'; }).join('')+'</tbody></table></div>';
};
window.pusRfqPick=function(id,on){ if(on){ const a=ED.avail.find(x=>x.line.id===id); ED.picks[id]={qty:a.bal}; } else delete ED.picks[id]; $('prAvail').innerHTML=availBody(); $('prVend').innerHTML=vendorsBody(); };
window.pusRfqPickQty=function(id,v){ const a=ED.avail.find(x=>x.line.id===id), n=parseFloat(v); if(!(n>0)||n>a.bal){ toast('Quantity must be more than 0 and at most the open balance ('+qty(a.bal)+')','err'); $('prAvail').innerHTML=availBody(); return; } ED.picks[id].qty=n; };
window.pusRfqVend=function(id,on){ if(on) ED.vendors.add(id); else ED.vendors.delete(id); };
window.pusRfqProjectPick=async function(){
  ED.project=parseInt(U().val('prProj'),10)||null; ED.picks={}; ED.avail=[]; ED.q=''; if($('prAvailQ')) $('prAvailQ').value='';
  $('prAvail').innerHTML='<div class="pus-hint">Loading…</div>';
  if(ED.project){ try{ ED.avail=await loadAvail(ED.project); }catch(e){ toast('Could not load indent items: '+e.message,'err'); } }
  $('prAvail').innerHTML=availBody(); $('prVend').innerHTML=vendorsBody();
};

window.pusRfqEdit=async function(id){
  let r=null, rvs=[];
  if(id){
    const [h,rv]=await Promise.all([U().PU().from('rfqs').select('*').eq('id',id).single(),U().PU().from('rfq_vendors').select('vendor_id').eq('rfq_id',id)]);
    if(h.error||rv.error){ toast('Could not open the RFQ','err'); return; }
    r=h.data; rvs=rv.data||[];
  }
  ED={id:id||null,project:r?r.project_id:(parseInt(R.project,10)||null),picks:{},avail:[],q:'',vendors:new Set(rvs.map(x=>x.vendor_id))};
  const edit=!!r;
  openModal('<div class="modal-head"><h3>'+(edit?'Edit draft RFQ':'New RFQ')+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm" style="max-height:74vh;overflow:auto">'
    +'<div class="two"><div><label>Business unit <span style="color:var(--slate);font-weight:400">(project)</span></label><select id="prProj" onchange="pusRfqProjectPick()"'+(edit?' disabled':'')+'><option value="">Choose…</option>'+U().S.projects.map(p=>'<option value="'+p.id+'"'+(p.id===ED.project?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></div>'
    +'<div><label>Last date for quotations</label><input id="prDue" type="date" min="'+today()+'" value="'+esc(r&&r.due_date||'')+'"></div></div>'
    +(edit?'<div class="pus-hint">The items of a draft cannot be changed — delete the draft and start again to change them. You can still change the vendors, date and notes.</div>':'<div class="pus-sub">Select from the indents made earlier <span style="font-weight:400;text-transform:none;letter-spacing:0">— approved indents of this business unit, with what is still open. The same item on several indents is quoted once.</span></div>'
      +'<input id="prAvailQ" placeholder="Search by indent no, date, group or item" style="margin-bottom:8px" oninput="pusRfqAvailSearch()"><div id="prAvail">'+availBody()+'</div>')
    +'<div class="pus-sub">Vendors to invite <span style="font-weight:400;text-transform:none;letter-spacing:0">— approved vendors only</span></div><div id="prVend">'+vendorsBody()+'</div>'
    +'<div class="pus-sub">Notes</div><label>Remarks (internal)</label><input id="prRemarks" value="'+esc(r&&r.remarks||'')+'">'
    +'<label>Terms requested from vendors</label><textarea id="prTerms" rows="3" placeholder="e.g. Please state payment terms, delivery period, warranty and freight.">'+esc(r&&r.terms_requested||'')+'</textarea></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusRfqSave()">Save draft</button></div>','xl');
  if(!edit&&ED.project){ try{ ED.avail=await loadAvail(ED.project); $('prAvail').innerHTML=availBody(); }catch(e){ toast('Could not load indent items: '+e.message,'err'); } }
};
window.pusRfqSave=async function(){
  const v=U().val, due=v('prDue'), vendors=[...ED.vendors];
  if(!ED.project){ toast('Choose the business unit','err'); return; }
  if(!due){ toast('Set the last date for quotations','err'); return; }
  if(due<today()){ toast('The last date must be today or later','err'); return; }
  if(!vendors.length){ toast('Invite at least one vendor','err'); return; }
  if(ED.id){
    const {error}=await U().PU().rpc('rfq_update',{p_id:ED.id,p_vendor_ids:vendors,p_due:due,p_remarks:v('prRemarks'),p_terms:v('prTerms')});
    if(U().fail(error,'Could not save')) return;
    closeModal(); toast('Draft saved','ok'); route(); return;
  }
  const sources=Object.keys(ED.picks).map(id=>({indent_line_id:parseInt(id,10),qty:ED.picks[id].qty}));
  if(!sources.length){ toast('Tick at least one item to quote','err'); return; }
  const {data,error}=await U().PU().rpc('rfq_create',{p_project:ED.project,p_sources:sources,p_vendor_ids:vendors,p_due:due,p_remarks:v('prRemarks'),p_terms:v('prTerms')});
  if(U().fail(error,'Could not create the RFQ')) return;
  closeModal(); toast('Draft RFQ saved — open it to send it to the vendors','ok'); route();
};

/* ---------------- Comparison (L1, L2, L3 ...), terms, last orders, counter offer, bid history, make a PO ---------------- */
let CMP=null;   // {qs:[quotation+lines], rounds:[], targets:[], last:{item_id:[...]}, pos:[...]}
async function cmpLoad(){
  if(CMP&&CMP.rfq===CUR.r.id) return;
  const PU=U().PU, ids=CUR.rvs.map(x=>x.id), itemIds=CUR.lines.map(l=>l.item_id);
  const lineIds=CUR.lines.map(l=>l.id);
  const [q,rr,rt,pl,po,pol]=await Promise.all([
    ids.length?PU().from('quotations').select('*, quotation_lines(*)').in('rfq_vendor_id',ids).order('revision'):Promise.resolve({data:[]}),
    PU().from('rfq_rounds').select('*').eq('rfq_id',CUR.r.id).order('round_no'),
    ids.length?PU().from('rfq_round_targets').select('*').in('rfq_vendor_id',ids):Promise.resolve({data:[]}),
    itemIds.length?PU().from('po_lines').select('item_id,rate,gst_rate,pos!inner(doc_no,po_date,vendor_id,status,deleted_at)').in('item_id',itemIds).in('pos.status',['approved','closed']):Promise.resolve({data:[]}),
    PU().from('pos').select('id,doc_no,status,vendor_id,total_amount,deleted_at').eq('rfq_id',CUR.r.id),
    lineIds.length?PU().from('po_lines').select('rfq_line_id,qty,pos!inner(status,deleted_at)').in('rfq_line_id',lineIds):Promise.resolve({data:[]})
  ]);
  const bad=[q,rr,rt,pl,po,pol].find(x=>x.error); if(bad) throw bad.error;
  const last={}; (pl.data||[]).filter(x=>x.pos&&!x.pos.deleted_at).sort((a,b)=>String(b.pos.po_date).localeCompare(String(a.pos.po_date))).forEach(x=>{ const a=(last[x.item_id]=last[x.item_id]||[]); if(a.length<3) a.push(x); });
  CMP={rfq:CUR.r.id,qs:q.data||[],rounds:rr.data||[],targets:rt.data||[],last,pos:(po.data||[]).filter(x=>!x.deleted_at),polines:(pol.data||[]).filter(x=>x.pos&&!x.pos.deleted_at&&x.pos.status!=='cancelled')};
}
const effRate=(rate,gst)=>U().rule('compare.basis')==='landed'?Number(rate)*(1+Number(gst||0)/100):Number(rate);
// the current quotation of a vendor, and a map line_id -> quote line
function curQuote(rvId){ const q=CMP.qs.find(x=>x.rfq_vendor_id===rvId&&x.is_current); if(!q) return null; const by={}; (q.quotation_lines||[]).forEach(l=>by[l.rfq_line_id]=l); return {q,by}; }
let SEL={};     // rfq_line_id -> rfq_vendor_id chosen for an order

function cmpModel(){
  const vs=CUR.rvs.filter(rv=>rv.status==='quoted'&&curQuote(rv.id)), lines=CUR.lines;
  const cells={}, ranks={}, best={};
  lines.forEach(l=>{
    const list=[];
    vs.forEach(rv=>{ const c=curQuote(rv.id).by[l.id]; const ok=c&&c.quoting; const same=ok&&c.uom_id===l.uom_id;
      cells[l.id+'|'+rv.id]={c,ok,same,eff:ok&&same?effRate(c.rate,c.gst_rate):null};
      if(ok&&same) list.push({rv,eff:Math.round(effRate(c.rate,c.gst_rate)*100)/100}); });
    list.sort((a,b)=>a.eff-b.eff);
    let rank=0, prev=null; list.forEach(x=>{ if(prev===null||x.eff!==prev){ rank++; prev=x.eff; } ranks[l.id+'|'+x.rv.id]=rank; });
    best[l.id]=list.length?list[0].rv.id:null;
  });
  return {vs,lines,cells,ranks,best};
}
const rankTag=n=>n?'<span class="tag '+(n===1?'t-green':n===2?'t-blue':'t-gray')+'" style="font-weight:700">L'+n+'</span>':'';

function tabCompare(){
  const M=cmpModel(), r=CUR.r, canPo=U().can('po.create'), canRfq=U().can('rfq.manage');
  if(M.vs.length<1) return '<div class="empty" style="padding:24px"><div>No quotations yet. The comparison appears once at least one vendor has quoted'+(M.vs.length===0&&CUR.rvs.some(x=>x.status==='quoted')?'':'.')+'</div></div>';
  // how much of each line is already on live POs (so it cannot be given out again)
  const head='<tr><th style="min-width:200px">Item</th>'+M.vs.map(rv=>{ const v=vendorById(rv.vendor_id), cq=curQuote(rv.id);
    return '<th style="min-width:170px">'+esc(vName(v))+'<div style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;color:var(--slate)">rev '+cq.q.revision+(cq.q.round_no?' · counter '+cq.q.round_no:'')+'</div></th>'; }).join('')+'<th style="min-width:130px">Give to</th></tr>';
  const rows=M.lines.map((l,i)=>{
    const last=(CMP.last[l.item_id]||[]).map(x=>'<div>'+money(x.rate)+' · '+esc(vName(vendorById(x.pos.vendor_id)))+' · '+U().dmy(x.pos.po_date)+'</div>').join('');
    const done=lineFullyOrdered(l.id);
    return '<tr><td><b>'+(i+1)+'. '+esc(l.items.name)+'</b><div style="font-size:12px;color:var(--slate)">'+qty(l.qty)+' '+esc(U().uomCode(l.uom_id))+'</div>'
      +'<div style="font-size:11.5px;color:var(--slate);margin-top:4px">'+(last?'<b>Last orders</b>'+last:'No earlier orders')+'</div></td>'
      +M.vs.map(rv=>{ const x=M.cells[l.id+'|'+rv.id], rk=M.ranks[l.id+'|'+rv.id], tgt=CMP.targets.find(t=>t.rfq_vendor_id===rv.id&&t.rfq_line_id===l.id);
        if(!x.c||!x.ok) return '<td style="color:var(--slate)">'+(x.c?'Not quoting':'—')+'</td>';
        const diff=!x.same?'<div class="tag t-amber" style="margin-top:3px" title="Quoted in a different unit than requested - not ranked">'+esc(U().uomCode(x.c.uom_id))+' · not comparable</div>':'';
        return '<td style="'+(rk===1?'background:#f0fdf4':'')+'"><div style="display:flex;gap:6px;align-items:center">'+rankTag(rk)+'<b>'+money(x.c.rate)+'</b></div><div style="font-size:12px;color:var(--slate)">GST '+qty(x.c.gst_rate)+'%'+(x.c.make?' · '+esc(x.c.make):'')+'</div>'
          +'<div style="font-size:12px">'+money(Number(x.c.rate)*Number(l.qty))+' basic</div>'+diff+(tgt?'<div style="font-size:11.5px;color:#b45309">target '+money(tgt.target_rate)+'</div>':'')+'</td>'; }).join('')
      +'<td>'+(done?'<span class="tag t-green">Ordered</span>':canPo?'<select class="cmp-sel" data-line="'+l.id+'" onchange="pusCmpSel('+l.id+',this.value)"><option value="">— nobody —</option>'+M.vs.filter(rv=>M.cells[l.id+'|'+rv.id].ok&&M.cells[l.id+'|'+rv.id].same).map(rv=>'<option value="'+rv.id+'"'+(String(SEL[l.id])===String(rv.id)?' selected':'')+'>'+esc(vName(vendorById(rv.vendor_id)))+(M.ranks[l.id+'|'+rv.id]===1?' (L1)':'')+'</option>').join('')+'</select>':'')+'</td></tr>'; }).join('');
  // totals
  const tot=rv=>{ let basic=0,gst=0,n=0; M.lines.forEach(l=>{ const x=M.cells[l.id+'|'+rv.id]; if(x.ok&&x.same){ const b=Number(x.c.rate)*Number(l.qty); basic+=b; gst+=b*Number(x.c.gst_rate||0)/100; n++; } }); return {basic,gst,n}; };
  const l1basic=M.lines.reduce((s,l)=>{ const b=M.best[l.id]; if(!b) return s; return s+Number(M.cells[l.id+'|'+b].c.rate)*Number(l.qty); },0);
  const foot='<tr style="background:#f8fafc"><td><b>Total (items quoted)</b></td>'+M.vs.map(rv=>{ const t=tot(rv); return '<td><b>'+money(t.basic)+'</b> basic<div style="font-size:12px;color:var(--slate)">+ GST '+money(t.gst)+'<br>'+t.n+' of '+M.lines.length+' items</div></td>'; }).join('')+'<td></td></tr>'
    +'<tr style="background:#f0fdf4"><td colspan="'+(M.vs.length+1)+'"><b>Lowest rate on every item (basic):</b> '+money(l1basic)+' <span style="color:var(--slate);font-size:12px">— what the order would cost if each item went to its L1 vendor</span></td><td id="cmpSelTotal" style="font-size:12.5px"></td></tr>';
  // terms
  const termRows=[['Payment','payment_terms'],['Delivery','delivery_terms'],['Warranty / guarantee','warranty_terms'],['Freight','freight_terms'],['Price validity','price_validity'],['Other terms','other_terms'],['Remarks','remarks']]
    .map(t=>'<tr><td><b>'+t[0]+'</b></td>'+M.vs.map(rv=>{ const v=curQuote(rv.id).q[t[1]]; return '<td style="white-space:pre-wrap">'+(v?esc(v):'<span style="color:var(--slate)">—</span>')+'</td>'; }).join('')+'</tr>').join('');
  const posList=CMP.pos.length?'<div class="pus-sub">Purchase orders from this RFQ</div><div class="card" style="padding:0"><table class="tbl"><tbody>'+CMP.pos.map(p=>'<tr style="cursor:pointer" onclick="closeModal();navTo(\'inventory/4/'+p.id+'\')"><td><span class="pus-code">'+esc(p.doc_no||('Draft #'+p.id))+'</span></td><td>'+esc(vName(vendorById(p.vendor_id)))+'</td><td class="pus-num">'+money(p.total_amount)+'</td><td><span class="tag t-gray">'+esc(p.status.replace('_',' '))+'</span></td></tr>').join('')+'</tbody></table></div>':'';
  const bar='<div style="display:flex;gap:10px;flex-wrap:wrap;margin:0 0 12px;align-items:center"><div class="pus-hint" style="margin:0;flex:1;min-width:240px">Rates ranked '+(U().rule('compare.basis')==='landed'?'including GST':'on the basic rate')+' (change under Admin → Rules). Lowest is <b>L1</b>. Quotes in a different unit than requested are shown but not ranked.</div>'
    +(canRfq&&r.status==='open'&&M.vs.length?'<button class="btn" onclick="pusCmpCounter()"><i class="fa-solid fa-handshake"></i> Send counter offer…</button>':'')
    +(canPo&&['open','closed'].includes(r.status)?'<button class="btn btn-primary" onclick="pusCmpMakePo()"><i class="fa-solid fa-file-invoice"></i> Create purchase order(s)…</button>':'')+'</div>';
  setTimeout(cmpSelTotal,0);
  return bar+'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead>'+head+'</thead><tbody>'+rows+foot+'</tbody></table></div></div>'
    +'<div class="pus-sub">Terms compared</div><div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th style="min-width:160px">Heading</th>'+M.vs.map(rv=>'<th>'+esc(vName(vendorById(rv.vendor_id)))+'</th>').join('')+'</tr></thead><tbody>'+termRows+'</tbody></table></div></div>'+posList;
}
// A line is fully ordered when live POs already cover its whole quantity.
function lineFullyOrdered(lineId){ const l=CUR.lines.find(x=>x.id===lineId); const cov=(CMP.polines||[]).filter(x=>x.rfq_line_id===lineId).reduce((s,x)=>s+Number(x.qty),0); return l&&cov>=Number(l.qty); }
function cmpSelTotal(){
  const el=$('cmpSelTotal'); if(!el) return;
  const M=cmpModel(); let basic=0,n=0;
  M.lines.forEach(l=>{ const v=SEL[l.id]; if(!v) return; const x=M.cells[l.id+'|'+v]; if(x&&x.ok) { basic+=Number(x.c.rate)*Number(l.qty); n++; } });
  el.innerHTML=n?'Your selection: <b>'+money(basic)+'</b> basic ('+n+' item'+(n===1?'':'s')+')':'';
}
window.pusCmpSel=function(lineId,v){ if(v) SEL[lineId]=parseInt(v,10); else delete SEL[lineId]; cmpSelTotal(); };

/* ---- bid history ---- */
function tabBids(){
  const vs=CUR.rvs.filter(rv=>CMP.qs.some(q=>q.rfq_vendor_id===rv.id));
  if(!vs.length) return '<div class="empty" style="padding:24px"><div>No quotations yet</div></div>';
  const rounds=[0,...CMP.rounds.map(r=>r.round_no)];
  const roundInfo=CMP.rounds.length?'<div class="pus-hint" style="margin-top:0">'+CMP.rounds.map(r=>'<b>Round '+r.round_no+'</b> — '+U().dmyTime(r.created_at)+(r.note?': '+esc(r.note):'')).join('<br>')+'</div>':'<div class="pus-hint" style="margin-top:0">No counter offers sent yet — this shows every vendor\'s original quotation. Each counter-offer round adds a column.</div>';
  const rateFor=(rvId,lineId,round)=>{ const qs=CMP.qs.filter(q=>q.rfq_vendor_id===rvId&&q.round_no===round).sort((a,b)=>b.revision-a.revision); if(!qs.length) return null; const l=(qs[0].quotation_lines||[]).find(x=>x.rfq_line_id===lineId); return {l,n:qs.length,rev:qs[0].revision}; };
  const body=CUR.lines.map((line,i)=>'<div class="pus-sub">'+(i+1)+'. '+esc(line.items.name)+' <span style="font-weight:400;text-transform:none;letter-spacing:0">— '+qty(line.qty)+' '+esc(U().uomCode(line.uom_id))+'</span></div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Vendor</th>'+rounds.map(r=>'<th class="pus-num">'+(r===0?'Original':'Counter '+r)+'</th>').join('')+'</tr></thead><tbody>'
    +vs.map(rv=>'<tr><td><b>'+esc(vName(vendorById(rv.vendor_id)))+'</b></td>'+rounds.map(r=>{
        const x=rateFor(rv.id,line.id,r); const tgt=r>0?CMP.targets.find(t=>t.rfq_vendor_id===rv.id&&t.rfq_line_id===line.id&&CMP.rounds.find(z=>z.round_no===r&&z.id===t.round_id)):null;
        let cell;
        if(!x) cell='<span style="color:var(--slate)">—</span>';
        else if(!x.l||!x.l.quoting) cell='<span style="color:var(--slate)">not quoting</span>';
        else cell='<b>'+money(x.l.rate)+'</b>'+(x.n>1?'<div style="font-size:11px;color:var(--slate)">'+x.n+' revisions</div>':'');
        return '<td class="pus-num">'+cell+(tgt?'<div style="font-size:11.5px;color:#b45309">target '+money(tgt.target_rate)+'</div>':'')+'</td>'; }).join('')+'</tr>').join('')
    +'</tbody></table></div></div>').join('');
  return roundInfo+body;
}

/* ---- counter offer ---- */
window.pusCmpCounter=function(){
  const M=cmpModel();
  openModal('<div class="modal-head"><h3>Counter offer</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm" style="max-height:74vh;overflow:auto">'
    +'<div class="pus-hint" style="margin-top:0">Ask the vendors you choose to sharpen their quotation. They revise through the same personal link, and every round is kept in the bid history. A target rate is optional.</div>'
    +'<div class="pus-sub">Send to</div>'+M.vs.map(rv=>'<label style="display:flex;gap:8px;align-items:center;margin:4px 0"><input type="checkbox" class="co-v" value="'+rv.id+'" style="width:auto" onchange="pusCmpCounterTargets()"> '+esc(vName(vendorById(rv.vendor_id)))+'</label>').join('')
    +'<div class="pus-sub">Target rates <span style="font-weight:400;text-transform:none;letter-spacing:0">— optional, per item</span></div><div id="coTargets"><div class="pus-hint">Choose the vendors above first.</div></div>'
    +'<label style="margin-top:12px">Note to the vendors</label><textarea id="coNote" rows="3" placeholder="e.g. Please give your best rate; we are ordering this week."></textarea></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusCmpCounterSend()">Send counter offer</button></div>','xl');
};
window.pusCmpCounterTargets=function(){
  const M=cmpModel(), sel=[...document.querySelectorAll('.co-v:checked')].map(c=>parseInt(c.value,10));
  if(!sel.length){ $('coTargets').innerHTML='<div class="pus-hint">Choose the vendors above first.</div>'; return; }
  $('coTargets').innerHTML='<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Item</th>'+sel.map(id=>{ const rv=CUR.rvs.find(x=>x.id===id); return '<th>'+esc(vName(vendorById(rv.vendor_id)))+'</th>'; }).join('')+'<th>L1 now</th></tr></thead><tbody>'
    +M.lines.map((l,i)=>{ const b=M.best[l.id], l1=b?M.cells[l.id+'|'+b].c.rate:null;
      return '<tr><td>'+(i+1)+'. '+esc(l.items.name)+'</td>'+sel.map(id=>{ const x=M.cells[l.id+'|'+id]; return '<td>'+(x&&x.ok?'<div style="font-size:12px;color:var(--slate)">now '+money(x.c.rate)+'</div><input class="co-t" type="number" step="0.01" min="0" style="width:110px" data-v="'+id+'" data-l="'+l.id+'" value="'+(l1&&x.eff>l1?l1:'')+'" placeholder="target">':'<span style="color:var(--slate)">—</span>')+'</td>'; }).join('')+'<td>'+(l1?money(l1):'—')+'</td></tr>'; }).join('')
    +'</tbody></table></div></div><div class="pus-hint">Pre-filled with the current lowest rate for vendors who are above it — change or clear any.</div>';
};
window.pusCmpCounterSend=async function(){
  const vendors=[...document.querySelectorAll('.co-v:checked')].map(c=>parseInt(c.value,10));
  if(!vendors.length){ toast('Choose at least one vendor','err'); return; }
  const targets=[...document.querySelectorAll('.co-t')].filter(i=>parseFloat(i.value)>0).map(i=>({rfq_vendor_id:parseInt(i.dataset.v,10),rfq_line_id:parseInt(i.dataset.l,10),target_rate:parseFloat(i.value)}));
  const {data,error}=await U().PU().rpc('counter_offer_create',{p_rfq_id:CUR.r.id,p_rfq_vendor_ids:vendors,p_targets:targets,p_note:U().val('coNote')});
  if(U().fail(error,'Could not send the counter offer')) return;
  CMP=null; closeModal(); toast('Counter offer '+data+' recorded — the vendors answer through their links (use the link / email buttons under Vendors & Quotations)','ok'); window.pusRfqOpen(CUR.r.id,'bids');
};

/* ---- make purchase orders ---- */
window.pusCmpMakePo=function(){
  const M=cmpModel(), sel=Object.keys(SEL).map(id=>parseInt(id,10)).filter(id=>M.lines.some(l=>l.id===id));
  if(!sel.length){ toast('First choose a vendor for at least one item in the "Give to" column','err'); return; }
  const byV={}; sel.forEach(id=>{ (byV[SEL[id]]=byV[SEL[id]]||[]).push(id); });
  const wh=U().S.warehouses.filter(w=>w.project_id===CUR.r.project_id&&w.active);
  const blocks=Object.keys(byV).map(vid=>{ const rv=CUR.rvs.find(x=>x.id===parseInt(vid,10)); let basic=0, gst=0;
    const rows=byV[vid].map(lid=>{ const l=M.lines.find(x=>x.id===lid), x=M.cells[lid+'|'+vid]; const b=Number(x.c.rate)*Number(l.qty); basic+=b; gst+=b*Number(x.c.gst_rate||0)/100;
      return '<tr><td>'+esc(l.items.name)+'</td><td class="pus-num">'+qty(l.qty)+' '+esc(U().uomCode(l.uom_id))+'</td><td class="pus-num">'+money(x.c.rate)+'</td><td class="pus-num">'+money(b)+'</td></tr>'; }).join('');
    return '<div class="card card-pad" style="margin-bottom:10px"><b>'+esc(vName(vendorById(rv.vendor_id)))+'</b> <span class="tag t-gray">1 purchase order</span><table class="tbl" style="margin-top:8px"><tbody>'+rows+'</tbody></table><div style="text-align:right;margin-top:6px">Basic '+money(basic)+' + GST '+money(gst)+' = <b>'+money(basic+gst)+'</b></div></div>'; }).join('');
  openModal('<div class="modal-head"><h3>Create purchase orders</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm" style="max-height:74vh;overflow:auto">'
    +'<div class="pus-hint" style="margin-top:0">One draft purchase order is made for each vendor, with their quoted rates, GST, make and terms. You can adjust a draft, then submit it for approval; the indent quantity is reserved when it is submitted.</div>'
    +blocks+'<div class="two"><div><label>Document Type</label><select id="cmpType">'+R.poTypes.filter(t=>t.active).map(t=>'<option value="'+t.id+'">'+esc(t.name)+'</option>').join('')+'</select></div><div></div></div>'
    +'<label>Deliver to (warehouse)</label><select id="cmpWh">'+(wh.length?'<option value="">Choose…</option>'+wh.map(w=>'<option value="'+w.id+'">'+esc(w.name)+' ('+esc(w.code)+')</option>').join(''):'<option value="">No warehouse for this project</option>')+'</select></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusCmpMakePoSave()">Create draft order'+(Object.keys(byV).length>1?'s':'')+'</button></div>','xl');
};
window.pusCmpMakePoSave=async function(){
  const wh=parseInt(U().val('cmpWh'),10); if(!wh){ toast('Choose the delivery warehouse','err'); return; }
  const sel=Object.keys(SEL).map(id=>({rfq_line_id:parseInt(id,10),rfq_vendor_id:SEL[id]}));
  const {data,error}=await U().PU().rpc('po_create_from_rfq',{p_rfq_id:CUR.r.id,p_selections:sel,p_warehouse_id:wh,p_type_id:parseInt(U().val('cmpType'),10)||null});
  if(U().fail(error,'Could not create the purchase orders')) return;
  SEL={}; CMP=null; closeModal(); toast(data.length+' draft purchase order'+(data.length===1?'':'s')+' created','ok');
  navTo(data.length===1?'inventory/4/'+data[0]:'inventory/4');
};
})();
