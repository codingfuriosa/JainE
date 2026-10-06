/* ============================ PURCHASE & STORES — ACCOUNTS PAYABLE (Stages 7 and 8) ============================
   Bill booking against received goods (3-way match: PO <-> GRN <-> invoice), debit notes (quantity, rate or
   amount based), non-store purchases and service work orders (approved like a PO), and service bills booked
   against a work order or directly. A booked bill is "ready to post" for Accounts. Contractor services belong
   to the Engineering module, not here. Spec: docs/purchase-stores-spec.md §7 and §8.
   Tables and functions: supabase/migrations/20261004370000_purchase_bills_orders.sql - every write goes
   through bill_* / debit_note_* / eo_* functions, which enforce the rules (billing never exceeds what was
   received, rate variance, mandatory HSN/SAC, who may approve).
   Routes: inventory/7/<bills|pending|orders|debit>[/<id>]. */
(function(){
if(window.__PAP_LOADED) return;
window.__PAP_LOADED=true;

const U=()=>window.PUS;
// Same rule as purchase orders (po.allow_self_approval); the database enforces it.
const selfApproval=()=>U().rule('po.allow_self_approval')==='true';
const qty=n=>Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:3});
const money=n=>(n==null||n==='')?'—':'₹'+Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const me=()=>String(state.email||'').toLowerCase();
const today=()=>{ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const uname=e=>U().userName(e);
const projName=id=>{const p=U().S.projects.find(x=>x.id===id);return p?p.name:'—';};
const ro=(l,v,h)=>U().roField(l,v,h);
const field=(label,ctl)=>'<div class="pi-row"><div class="l">'+label+'</div><div>'+ctl+'</div></div>';
const num=v=>{const n=parseFloat(v);return isFinite(n)?n:0;};
const r2=n=>Math.round((n+Number.EPSILON)*100)/100;
const profile=email=>{
  const e=String(email||'').toLowerCase(), ids=U().S.roleMembers.filter(m=>m.email===e).map(m=>m.role_id);
  const names=U().S.roles.filter(r=>ids.includes(r.id)).map(r=>r.name);
  return names.length?names.join(', '):'—';
};
const SECTIONS=[['bills','Bills'],['pending','Awaiting bill'],['orders','Non-store & services'],['debit','Debit notes']];
const BTYPE={goods:'Goods',non_store:'Non-store',service:'Service'};
const permFor=t=>t==='goods'?'bill.book':'nonstore.purchase';
const B={bills:[],dns:[],vendors:[],pos:[],heads:[],q:'',filter:'all',type:'all',oq:'',ofilter:'all',orders:[],olines:[],oapp:[],pending:[]};
const vendorById=id=>B.vendors.find(v=>v.id===id);
const vName=id=>{const v=vendorById(id);return v?(v.trade_name||v.legal_name):'—';};
const poById=id=>B.pos.find(p=>p.id===id);
const poNo=id=>{const p=poById(id);return p?(p.doc_no||'PO'):'—';};
const headName=id=>{const h=B.heads.find(x=>x.id===id);return h?h.name:'—';};
const listShell=(title,hint,addLabel,addFn,heads,rows,top)=>'<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">'+esc(title)+'</div><div class="pus-hint" style="margin:0">'+hint+'</div></div>'
  +(addFn?'<button class="btn btn-primary" onclick="'+addFn+'"><i class="fa-solid fa-plus"></i> '+esc(addLabel)+'</button>':'')+'</div>'+(top||'')
  +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+heads.map(h=>'<th'+(h[1]?' class="pus-num"':'')+'>'+esc(h[0])+'</th>').join('')+'</tr></thead><tbody>'
  +(rows||'<tr><td colspan="'+heads.length+'"><div class="empty" style="padding:24px"><div>Nothing here yet</div></div></td></tr>')+'</tbody></table></div></div>';
function logRows(log){
  const rows=log.map(x=>'<tr><td>'+esc(uname(x.by))+'</td><td style="white-space:nowrap">'+U().dmyTime(x.at)+'</td><td>'+esc(x.action)+(x.remark?'<div style="font-size:12px;color:var(--slate)">'+esc(x.remark)+'</div>':'')+'</td><td>'+esc(x.ip||'—')+'</td></tr>').join('');
  return '<div class="card" style="padding:0"><table class="tbl"><thead><tr><th>User</th><th>Modified Time</th><th>Action</th><th>IP Address</th></tr></thead><tbody>'+(rows||'<tr><td colspan="4"><div class="empty" style="padding:18px"><div>No history</div></div></td></tr>')+'</tbody></table></div>';
}
async function loadLog(type,id){ const {data}=await U().PU().from('doc_log').select('*').eq('doc_type',type).eq('doc_id',id).order('at'); return data||[]; }
const canAct=(rec,perm)=>U().can(perm)&&(String(rec.raised_by||'').toLowerCase()===me()||state.super);

let SEQ=0, CURSEC='bills';
async function baseLoad(){
  await U().load();
  const PU=U().PU;
  const [v,p,h]=await Promise.all([
    PU().from('vendors').select('id,code,legal_name,trade_name,gstin,pan,state,vendor_type,status').is('deleted_at',null),
    PU().from('pos').select('id,doc_no,vendor_id,project_id,status').is('deleted_at',null),
    PU().from('expense_heads').select('*').is('deleted_at',null).order('sort_order').order('name')
  ]);
  const bad=[v,p,h].find(x=>x.error); if(bad) throw bad.error;
  B.vendors=v.data||[]; B.pos=p.data||[]; B.heads=h.data||[];
}

window.pusPayableRender=async function(host,seg){
  if(!window.PUS||!window.PUS.piCss){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Purchase could not finish loading - refresh the page.</div></div>'; return; }
  U().css(); U().vcss(); U().piCss();
  const mine=++SEQ, stale=()=>mine!==SEQ||!host.isConnected;
  seg=seg||[]; CURSEC=SECTIONS.some(s=>s[0]===seg[0])?seg[0]:'bills';
  loader(host);
  try{ await baseLoad(); }
  catch(e){ if(!stale()) host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load: '+esc(e.message||e)+'</div></div>'; return; }
  if(stale()) return;
  host.innerHTML='<div class="pus-subs">'+SECTIONS.map(s=>'<span class="chip'+(s[0]===CURSEC?' active':'')+'" onclick="navTo(\'inventory/7/'+s[0]+'\')">'+s[1]+'</span>').join('')+'</div><div id="papBody"></div>';
  const body=$('papBody'); loader(body);
  try{ await ({bills:billList,pending:pendingList,orders:orderList,debit:dnList}[CURSEC])(body); }
  catch(e){ if(!stale()) body.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load: '+esc(e.message||e)+'</div></div>'; return; }
  const id=parseInt(seg[1],10);
  if(id&&!stale()) ({bills:window.pusBillOpen,orders:window.pusEoOpen}[CURSEC]||function(){})(id);
};

/* ======================================================= BILLS ======================================================= */
function billStatus(b){
  if(b.status==='draft') return ['Draft','t-gray'];
  if(b.status==='cancelled') return ['Cancelled','t-red'];
  if(b.accounts_status==='posted') return ['Posted to Accounts','t-green'];
  if(b.accounts_status==='hold') return ['On hold (Accounts)','t-amber'];
  return ['Ready to post','t-blue'];
}
const billTag=b=>{const s=billStatus(b);return '<span class="tag '+s[1]+'">'+s[0]+'</span>';};
const billNo=b=>b.doc_no||('Draft #'+b.id);
async function billList(host){
  const PU=U().PU;
  const [b,d]=await Promise.all([PU().from('bills').select('*').is('deleted_at',null).order('created_at',{ascending:false}),PU().from('debit_notes').select('*').order('created_at',{ascending:false})]);
  const bad=[b,d].find(x=>x.error); if(bad) throw bad.error;
  B.bills=b.data||[]; B.dns=d.data||[];
  billRender(host);
}
function billRender(host){
  host=host||$('papBody'); if(!host) return;
  const q=B.q.toLowerCase();
  const inF=(b,k)=>k==='all'||(k==='draft'&&b.status==='draft')||(k==='ready'&&b.status==='booked'&&b.accounts_status==='ready')||(k==='posted'&&b.status==='booked'&&b.accounts_status==='posted')||(k==='cancelled'&&b.status==='cancelled');
  const base=B.bills.filter(b=>B.type==='all'||b.bill_type===B.type);
  const list=base.filter(b=>inF(b,B.filter)&&(!q||(billNo(b)+' '+vName(b.vendor_id)+' '+b.invoice_no+' '+projName(b.project_id)+' '+poNo(b.po_id)).toLowerCase().includes(q)));
  const chips=[['all','All'],['draft','Drafts'],['ready','Ready to post'],['posted','Posted'],['cancelled','Cancelled']].map(([k,l])=>'<span class="chip'+(B.filter===k?' active':'')+'" onclick="pusBillFilter(\''+k+'\')">'+l+' ('+base.filter(b=>inF(b,k)).length+')</span>').join('');
  const rows=list.map(b=>'<tr style="cursor:pointer" onclick="pusBillOpen('+b.id+')"><td><span class="pus-code">'+esc(billNo(b))+'</span></td><td>'+esc(BTYPE[b.bill_type])+'</td><td><b>'+esc(vName(b.vendor_id))+'</b></td><td>'+esc(projName(b.project_id))+'</td>'
    +'<td>'+esc(b.invoice_no)+'<div style="font-size:12px;color:var(--slate)">'+U().dmy(b.invoice_date)+'</div></td><td class="pus-num">'+money(b.taxable_value)+'</td><td class="pus-num">'+money(b.gst_total)+'</td><td class="pus-num"><b>'+money(b.total_amount)+'</b></td>'
    +'<td class="pus-num">'+(b.status==='booked'?'<b>'+money(b.payable_amount)+'</b>'+(+b.debit_noted>0?'<div style="font-size:11.5px;color:var(--slate)">after debit notes '+money(b.debit_noted)+'</div>':''):'—')+'</td><td>'+billTag(b)+'</td></tr>').join('');
  const canAny=U().can('bill.book')||U().can('nonstore.purchase');
  host.innerHTML=listShell('Bills','Book the vendor\'s invoice against what was received (goods), an approved non-store purchase or work order, or directly for a service. A booked bill is ready to post to Accounts.',
    'New bill',canAny?'pusBillNew()':'',[['Bill no'],['Type'],['Vendor'],['Project'],['Invoice'],['Taxable',1],['GST',1],['Total',1],['Payable',1],['Status']],rows,
    '<div class="pus-top"><div class="pus-subs" style="margin:0">'+chips+'</div><select id="papType" onchange="pusBillType()"><option value="all">All types</option>'+Object.keys(BTYPE).map(k=>'<option value="'+k+'"'+(B.type===k?' selected':'')+'>'+BTYPE[k]+'</option>').join('')+'</select>'
    +'<input class="grow" id="papQ" placeholder="Search by bill, vendor, invoice, PO or project" value="'+esc(B.q)+'" oninput="pusBillSearch()"></div>');
}
window.pusBillFilter=function(k){ B.filter=k; billRender(); };
window.pusBillType=function(){ B.type=U().val('papType'); billRender(); };
window.pusBillSearch=function(){ B.q=U().val('papQ'); billRender(); const e=$('papQ'); if(e){ e.focus(); e.setSelectionRange(e.value.length,e.value.length); } };

/* ---------------- awaiting bill: goods received and not yet billed ---------------- */
async function pendingList(host){
  const {data,error}=await U().PU().from('grn_lines').select('id,grn_id,po_line_id,accepted_qty,returned_qty,billed_qty,rate,gst_rate,grns!inner(id,doc_no,po_id,vendor_id,project_id,grn_date,status)').eq('grns.status','posted');
  if(error) throw error;
  const by={};
  (data||[]).forEach(l=>{ const av=+l.accepted_qty-+l.returned_qty-+l.billed_qty; if(av<=0.0005||!l.grns) return;
    const k=l.grns.po_id; const o=by[k]||(by[k]={po_id:k,vendor_id:l.grns.vendor_id,project_id:l.grns.project_id,grns:new Set(),lines:0,value:0,last:''});
    o.grns.add(l.grns.id); o.lines++; o.value+=av*+l.rate*(1+ +l.gst_rate/100); if(l.grns.grn_date>o.last) o.last=l.grns.grn_date; });
  B.pending=Object.values(by).sort((a,b)=>a.last<b.last?1:-1);
  const rows=B.pending.map(o=>'<tr><td><span class="pus-code">'+esc(poNo(o.po_id))+'</span></td><td><b>'+esc(vName(o.vendor_id))+'</b></td><td>'+esc(projName(o.project_id))+'</td><td class="pus-num">'+o.grns.size+'</td><td class="pus-num">'+o.lines+'</td>'
    +'<td style="white-space:nowrap">'+U().dmy(o.last)+'</td><td class="pus-num"><b>'+money(r2(o.value))+'</b></td><td class="pus-act">'+(U().can('bill.book')?'<button class="btn btn-sm btn-primary" onclick="pusBillForm({type:\'goods\',poId:'+o.po_id+'})">Book bill</button>':'')+'</td></tr>').join('');
  host.innerHTML=listShell('Awaiting bill','Goods that have been received (accepted, net of returns) but not yet billed, by purchase order. The value is at PO rates including GST.','',null,
    [['PO'],['Vendor'],['Project'],['GRNs',1],['Lines',1],['Last receipt'],['Value',1],['']],rows);
}

/* ---------------- new bill: choose what it is for ---------------- */
window.pusBillNew=function(){
  const g=U().can('bill.book'), n=U().can('nonstore.purchase');
  const opt=(ok,icon,title,sub,fn)=>'<button class="btn" style="display:flex;gap:14px;align-items:center;text-align:left;width:100%;padding:14px 16px;margin-bottom:10px;'+(ok?'':'opacity:.5')+'" '+(ok?'onclick="'+fn+'"':'disabled title="You do not have permission for this"')+'><i class="fa-solid '+icon+'" style="font-size:20px;width:26px;text-align:center"></i><span><b>'+title+'</b><div style="font-size:12.5px;color:var(--slate);font-weight:400">'+sub+'</div></span></button>';
  openModal('<div class="modal-head"><h3>New bill</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body">'
    +opt(g,'fa-boxes-stacked','Goods bill','Against goods received on a purchase order (checked against the GRN and PO rate).','pusBillPick(\'goods\')')
    +opt(n,'fa-receipt','Non-store purchase bill','Against an approved non-store purchase (expenses that do not go into stores).','pusBillPick(\'non_store\')')
    +opt(n,'fa-screwdriver-wrench','Service bill — against a work order','Against an approved service work order.','pusBillPick(\'service\')')
    +opt(n,'fa-file-invoice','Service bill — direct','A service bill with no work order. HSN / SAC is mandatory on every line.','pusBillForm({type:\'service\',direct:true})')
    +'<div class="pus-hint" style="margin-bottom:0">Services bought from contractors are billed in the Engineering module, not here.</div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button></div>');
};
window.pusBillPick=async function(type){
  const PU=U().PU;
  if(type==='goods'){
    const {data,error}=await PU().from('grn_lines').select('accepted_qty,returned_qty,billed_qty,grns!inner(po_id,status)').eq('grns.status','posted');
    if(error){ toast('Could not load: '+error.message,'err'); return; }
    const ids=new Set((data||[]).filter(l=>+l.accepted_qty-+l.returned_qty-+l.billed_qty>0.0005).map(l=>l.grns.po_id));
    const list=B.pos.filter(p=>ids.has(p.id));
    openModal('<div class="modal-head"><h3>Goods bill — choose the purchase order</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm">'
      +(list.length?'<label>Purchase order</label><select id="papPick"><option value="">Choose…</option>'+list.map(p=>'<option value="'+p.id+'">'+esc(p.doc_no||'PO')+' — '+esc(vName(p.vendor_id))+' — '+esc(projName(p.project_id))+'</option>').join('')+'</select>'
        :'<div class="empty" style="padding:18px"><div>No purchase order has goods that are received and still unbilled.</div></div>')+'</div>'
      +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>'+(list.length?'<button class="btn btn-primary" onclick="pusBillPicked(\'goods\')">Continue</button>':'')+'</div>');
    return;
  }
  const kind=type==='non_store'?'non_store':'service';
  const [o,l]=await Promise.all([PU().from('expense_orders').select('id,doc_no,vendor_id,project_id,subject,total_amount').eq('kind',kind).eq('status','approved').is('deleted_at',null).order('order_date',{ascending:false}),PU().from('expense_order_lines').select('order_id,qty,billed_qty')]);
  if(o.error||l.error){ toast('Could not load orders','err'); return; }
  const list=(o.data||[]).filter(x=>(l.data||[]).some(y=>y.order_id===x.id&&+y.qty-+y.billed_qty>0.0005));
  const what=kind==='non_store'?'non-store purchase order':'work order';
  openModal('<div class="modal-head"><h3>'+(kind==='non_store'?'Non-store purchase':'Service')+' bill — choose the '+what+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm">'
    +(list.length?'<label>Approved '+what+'</label><select id="papPick"><option value="">Choose…</option>'+list.map(x=>'<option value="'+x.id+'">'+esc(x.doc_no||'Order')+' — '+esc(vName(x.vendor_id))+' — '+esc(x.subject)+' ('+money(x.total_amount)+')</option>').join('')+'</select>'
      :'<div class="empty" style="padding:18px"><div>No approved '+what+' has anything left to bill.'+(kind==='service'?' You can still book a direct service bill.':'')+'</div></div>')+'</div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>'+(list.length?'<button class="btn btn-primary" onclick="pusBillPicked(\''+type+'\')">Continue</button>':'')+'</div>');
};
window.pusBillPicked=function(type){
  const id=parseInt(U().val('papPick'),10); if(!id){ toast('Choose one to continue','err'); return; }
  window.pusBillForm(type==='goods'?{type:'goods',poId:id}:{type,orderId:id});
};

/* ---------------- the bill form ---------------- */
let BF=null;   // {id, type, mode:'goods'|'order'|'direct', po, order, project_id, vendor_id, rows:[...], head:{...}}
async function bfLoadRows(opt,draft){
  const PU=U().PU, dl={}; (draft||[]).forEach(l=>{ dl[l.grn_line_id?'g'+l.grn_line_id:l.order_line_id?'o'+l.order_line_id:'x'+l.line_no]=l; });
  if(opt.type==='goods'){
    const [g,pl]=await Promise.all([
      PU().from('grn_lines').select('*, items(code,name), grns!inner(id,doc_no,po_id,status,grn_date,challan_no,invoice_no,invoice_date)').eq('grns.po_id',opt.poId).eq('grns.status','posted').order('grn_id').order('line_no'),
      PU().from('po_lines').select('id,rate,gst_rate,hsn_code').eq('po_id',opt.poId)]);
    if(g.error||pl.error) throw (g.error||pl.error);
    const plm={}; (pl.data||[]).forEach(x=>plm[x.id]=x);
    const rows=(g.data||[]).map(l=>{ const av=+l.accepted_qty-+l.returned_qty-+l.billed_qty, d=dl['g'+l.id], p=plm[l.po_line_id]||{};
      return {grn_line_id:l.id,grn:l.grns,label:l.items.name,sub:l.items.code,hsn:p.hsn_code||'',unit:U().uomCode(l.uom_id),avail:av,ref:+p.rate||0,rate:d?+d.rate:(+p.rate||+l.rate),gst:d?+d.gst_rate:(p.gst_rate!=null?+p.gst_rate:+l.gst_rate),qty:d?+d.qty:av,checked:!!d}; })
      .filter(r=>r.avail>0.0005||r.checked);
    const grnCount=new Set(rows.map(r=>r.grn.id)).size;
    if(!draft&&grnCount===1) rows.forEach(r=>r.checked=true);
    return rows;
  }
  if(opt.orderId){
    const {data,error}=await PU().from('expense_order_lines').select('*').eq('order_id',opt.orderId).order('line_no');
    if(error) throw error;
    return (data||[]).map(l=>{ const av=+l.qty-+l.billed_qty, d=dl['o'+l.id];
      return {order_line_id:l.id,label:l.description,sub:'',hsn:l.hsn_sac,unit:l.unit,avail:av,ref:+l.rate,rate:d?+d.rate:+l.rate,gst:d?+d.gst_rate:+l.gst_rate,qty:d?+d.qty:av,checked:draft?!!d:av>0.0005}; })
      .filter(r=>r.avail>0.0005||r.checked);
  }
  return (draft&&draft.length?draft:[{}]).map(l=>({description:l.description||'',hsn_sac:l.hsn_sac||'',qty:l.qty!=null?+l.qty:'',unit:l.unit||'Nos',rate:l.rate!=null?+l.rate:'',gst:l.gst_rate!=null?+l.gst_rate:0}));
}
window.pusBillForm=async function(opt){
  const PU=U().PU; closeModal();
  let b=null, draft=null;
  try{
    if(opt.id){
      const [h,l]=await Promise.all([PU().from('bills').select('*').eq('id',opt.id).single(),PU().from('bill_lines').select('*').eq('bill_id',opt.id).order('line_no')]);
      if(h.error||l.error) throw (h.error||l.error);
      b=h.data; draft=l.data||[];
      opt={id:b.id,type:b.bill_type,poId:b.po_id,orderId:b.order_id,direct:!b.po_id&&!b.order_id};
    }
    let po=null, order=null;
    if(opt.poId) po=B.pos.find(p=>p.id===opt.poId)||(await PU().from('pos').select('id,doc_no,vendor_id,project_id,status').eq('id',opt.poId).single()).data;
    if(opt.orderId){ const r=await PU().from('expense_orders').select('*').eq('id',opt.orderId).single(); if(r.error) throw r.error; order=r.data; }
    const rows=await bfLoadRows(opt,draft);
    BF={id:opt.id||null,type:opt.type,mode:opt.poId?'goods':opt.orderId?'order':'direct',po,order,project_id:po?po.project_id:order?order.project_id:(b?b.project_id:null),vendor_id:po?po.vendor_id:order?order.vendor_id:(b?b.vendor_id:null),rows,
      head:b||{invoice_no:'',invoice_date:'',due_date:'',gst_type:'intra',other_charges:0,other_charges_gst:0,tds_rate:0,variance_note:'',remarks:'',expense_head_id:order?order.expense_head_id:null}};
  }catch(e){ toast('Could not open the bill form: '+(e.message||e),'err'); return; }
  bfRender();
};
const tolPct=()=>num(U().rule('billing.rate_tolerance_pct'));
const varMode=()=>U().rule('billing.rate_variance')||'reason';
function bfRowsHtml(){
  if(BF.mode==='direct') return BF.rows.map((r,i)=>'<tr class="bf-row" data-i="'+i+'"><td>'+(i+1)+'</td><td><input class="bf-desc" style="min-width:200px" value="'+esc(r.description)+'" placeholder="What was provided"></td><td><input class="bf-hsn" style="width:90px" value="'+esc(r.hsn_sac)+'" placeholder="HSN / SAC"></td>'
    +'<td><input class="bf-unit" style="width:64px" value="'+esc(r.unit)+'"></td><td><input class="bf-qty" type="number" step="0.001" min="0" style="width:88px" value="'+esc(r.qty)+'" oninput="pusBfCalc()"></td><td><input class="bf-rate" type="number" step="0.01" min="0" style="width:100px" value="'+esc(r.rate)+'" oninput="pusBfCalc()"></td>'
    +'<td><input class="bf-gst" type="number" step="0.01" min="0" max="100" style="width:68px" value="'+esc(r.gst)+'" oninput="pusBfCalc()"></td><td class="pus-num bf-tot"></td><td>'+(BF.rows.length>1?'<button class="btn btn-sm btn-ghost" title="Remove" onclick="pusBfDel('+i+')"><i class="fa-solid fa-trash"></i></button>':'')+'</td></tr>').join('');
  let out='', last=null;
  BF.rows.forEach((r,i)=>{
    if(BF.mode==='goods'&&r.grn.id!==last){ last=r.grn.id; out+='<tr class="bf-grp"><td></td><td colspan="9" style="background:var(--bg,#f6f7f9);font-size:12.5px"><b>'+esc(r.grn.doc_no||'GRN')+'</b> · '+U().dmy(r.grn.grn_date)+(r.grn.challan_no?' · Challan '+esc(r.grn.challan_no):'')+(r.grn.invoice_no?' · Invoice '+esc(r.grn.invoice_no):'')+' &nbsp; <a style="cursor:pointer;color:var(--blue,#2563eb)" onclick="pusBfGrp('+r.grn.id+')">tick all</a></td></tr>'; }
    out+='<tr class="bf-row" data-i="'+i+'"'+(BF.mode==='goods'?' data-grn="'+r.grn.id+'"':'')+'><td><input type="checkbox" class="bf-on"'+(r.checked?' checked':'')+' onchange="pusBfTick()" style="width:auto"></td><td><b>'+esc(r.label)+'</b>'+(r.sub?'<div style="font-size:12px;color:var(--slate)">'+esc(r.sub)+'</div>':'')+'</td><td>'+esc(r.hsn)+'</td><td>'+esc(r.unit)+'</td>'
      +'<td class="pus-num">'+qty(r.avail)+'</td><td><input class="bf-qty" type="number" step="0.001" min="0" style="width:88px" value="'+esc(r.qty)+'" oninput="pusBfCalc()"></td>'
      +'<td><input class="bf-rate" type="number" step="0.01" min="0" style="width:100px" value="'+esc(r.rate)+'" oninput="pusBfCalc()"><div class="bf-var" style="font-size:11.5px;color:var(--slate)">Agreed '+money(r.ref)+'</div></td>'
      +'<td><input class="bf-gst" type="number" step="0.01" min="0" max="100" style="width:68px" value="'+esc(r.gst)+'" oninput="pusBfCalc()"></td><td class="pus-num bf-tot"></td></tr>';
  });
  return out;
}
function bfRender(){
  const h=BF.head, direct=BF.mode==='direct', tds=U().rule('billing.capture_tds')==='true';
  const v=vendorById(BF.vendor_id), vendors=B.vendors.filter(x=>x.status==='approved'&&(x.vendor_type==='service'||x.vendor_type==='both'));
  const heads=B.heads.filter(x=>x.active||x.id===h.expense_head_id);
  const src=BF.mode==='goods'?ro('Purchase order',(BF.po&&BF.po.doc_no)||'PO'):BF.mode==='order'?ro('Order',(BF.order.doc_no||'Order')+' — '+BF.order.subject):ro('Order','None — direct service bill');
  const left=(direct?field('Project','<select id="bfProj"><option value="">Choose…</option>'+U().S.projects.map(p=>'<option value="'+p.id+'"'+(p.id===BF.project_id?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select>')
      +field('Vendor','<select id="bfVendor"><option value="">Choose…</option>'+vendors.map(x=>'<option value="'+x.id+'"'+(x.id===BF.vendor_id?' selected':'')+'>'+esc(x.trade_name||x.legal_name)+'</option>').join('')+'</select>')
    :ro('Project',projName(BF.project_id))+ro('Vendor',vName(BF.vendor_id)+(v&&v.gstin?'  ·  GSTIN '+v.gstin:'')))+src
    +(BF.type!=='goods'?field('Expense head','<select id="bfHead"><option value="">—</option>'+heads.map(x=>'<option value="'+x.id+'"'+(x.id===h.expense_head_id?' selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select>'):'');
  const right=field('Vendor\'s invoice no <span style="color:#dc2626">*</span>','<input id="bfInv" value="'+esc(h.invoice_no||'')+'">')+field('Invoice date <span style="color:#dc2626">*</span>','<input id="bfInvDate" type="date" max="'+today()+'" value="'+esc(h.invoice_date||'')+'">')
    +field('Due date','<input id="bfDue" type="date" value="'+esc(h.due_date||'')+'">')
    +field('GST','<select id="bfGstType" onchange="pusBfCalc()"><option value="intra"'+(h.gst_type!=='inter'?' selected':'')+'>Within the state — CGST + SGST</option><option value="inter"'+(h.gst_type==='inter'?' selected':'')+'>Inter-state — IGST</option></select>');
  const head=BF.mode==='direct'?'<th>#</th><th>Description</th><th>HSN / SAC *</th><th>Unit</th><th>Qty</th><th>Rate (₹)</th><th>GST %</th><th class="pus-num">Line total</th><th></th>'
    :'<th></th><th>Item</th><th>'+(BF.type==='goods'?'HSN':'HSN / SAC')+'</th><th>Unit</th><th class="pus-num">Can bill</th><th>Qty billed</th><th>Rate (₹)</th><th>GST %</th><th class="pus-num">Line total</th>';
  openModal('<div class="modal-head"><h3>'+(BF.id?'Edit':'New')+' '+(BF.type==='goods'?'goods':BF.type==='non_store'?'non-store purchase':'service')+' bill</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm" style="max-height:calc(90vh - 150px);overflow:auto">'
    +(BF.mode==='goods'?'<div class="pus-hint" style="margin-top:0">Tick the lines this invoice covers. The most you can bill on a line is what was accepted, less returns and anything already billed. The agreed rate is the rate on the purchase order.</div>':BF.mode==='order'?'<div class="pus-hint" style="margin-top:0">Tick the lines this invoice covers. The most you can bill on a line is what is left of the order.</div>':'<div class="pus-hint" style="margin-top:0">A direct service bill has no work order. Describe each service and give its HSN / SAC code.</div>')
    +'<div class="pi-form"><div>'+left+'</div><div>'+right+'</div></div>'
    +'<div class="card" style="padding:0;margin-top:8px"><div style="overflow-x:auto"><table class="tbl" id="bfTbl"><thead><tr>'+head+'</tr></thead><tbody id="bfBody">'+bfRowsHtml()+'</tbody></table></div></div>'
    +(direct?'<div style="margin-top:8px"><button class="btn btn-sm" onclick="pusBfAdd()"><i class="fa-solid fa-plus"></i> Add a line</button></div>':'')
    +'<div class="pi-form" style="margin-top:14px"><div>'
      +field('Other charges (₹)','<div style="display:flex;gap:8px;align-items:center"><input id="bfOc" type="number" step="0.01" min="0" style="width:120px" value="'+esc(h.other_charges||0)+'" oninput="pusBfCalc()"> <span>GST %</span> <input id="bfOcg" type="number" step="0.01" min="0" max="100" style="width:70px" value="'+esc(h.other_charges_gst||0)+'" oninput="pusBfCalc()"></div>')
      +(tds?field('TDS %','<input id="bfTds" type="number" step="0.01" min="0" max="100" style="width:90px" value="'+esc(h.tds_rate||0)+'" oninput="pusBfCalc()">'):'')
      +'<div id="bfVarBox" style="display:none">'+field('Reason for paying above the agreed rate','<textarea id="bfVar" rows="2">'+esc(h.variance_note||'')+'</textarea>')+'</div>'
      +field('Remarks','<textarea id="bfRem" rows="2">'+esc(h.remarks||'')+'</textarea>')
    +'</div><div><div id="bfTotals"></div></div></div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn" onclick="pusBfSave(false)">Save as draft</button><button class="btn btn-primary" onclick="pusBfSave(true)">Save & book</button></div>','xl');
  window.pusBfCalc();
}
window.pusBfGrp=function(grnId){ const rs=[...document.querySelectorAll('.bf-row[data-grn="'+grnId+'"] .bf-on')]; const all=rs.every(c=>c.checked); rs.forEach(c=>c.checked=!all); window.pusBfTick(); };
// Ticking lines fills in the vendor's invoice number and date from the goods receipt, if they were noted there and the field is still empty.
window.pusBfTick=function(){
  if(BF.mode==='goods'){
    const on=[...document.querySelectorAll('#bfBody .bf-row')].filter(tr=>tr.querySelector('.bf-on').checked).map(tr=>BF.rows[+tr.dataset.i].grn);
    const nos=[...new Set(on.map(g=>g.invoice_no).filter(Boolean))];
    if(nos.length===1&&!$('bfInv').value.trim()){ $('bfInv').value=nos[0]; const g=on.find(x=>x.invoice_no===nos[0]); if(g.invoice_date&&!$('bfInvDate').value) $('bfInvDate').value=g.invoice_date; }
  }
  window.pusBfCalc();
};
// Read what is on screen back into BF.rows (direct rows) before the table is redrawn.
function bfRead(){
  document.querySelectorAll('#bfBody .bf-row').forEach(tr=>{ const i=+tr.dataset.i, r=BF.rows[i]; if(!r) return;
    r.qty=tr.querySelector('.bf-qty').value; r.rate=tr.querySelector('.bf-rate').value; r.gst=tr.querySelector('.bf-gst').value;
    if(BF.mode==='direct'){ r.description=tr.querySelector('.bf-desc').value; r.hsn_sac=tr.querySelector('.bf-hsn').value; r.unit=tr.querySelector('.bf-unit').value; } else r.checked=tr.querySelector('.bf-on').checked; });
}
window.pusBfAdd=function(){ bfRead(); BF.rows.push({description:'',hsn_sac:'',qty:'',unit:'Nos',rate:'',gst:0}); $('bfBody').innerHTML=bfRowsHtml(); window.pusBfCalc(); };
window.pusBfDel=function(i){ bfRead(); BF.rows.splice(i,1); $('bfBody').innerHTML=bfRowsHtml(); window.pusBfCalc(); };
window.pusBfCalc=function(){
  const intra=(U().val('bfGstType')||BF.head.gst_type)!=='inter';
  let taxable=0, gst=0, over=false;
  document.querySelectorAll('#bfBody .bf-row').forEach(tr=>{ const r=BF.rows[+tr.dataset.i]; const on=BF.mode==='direct'||tr.querySelector('.bf-on').checked;
    const q=num(tr.querySelector('.bf-qty').value), rt=num(tr.querySelector('.bf-rate').value), g=num(tr.querySelector('.bf-gst').value);
    const a=r2(q*rt), ga=r2(a*g/100); tr.querySelector('.bf-tot').textContent=on?money(a+ga):'';
    const vb=tr.querySelector('.bf-var'); const bad=on&&r&&r.ref>0&&rt>r.ref*(1+tolPct()/100)+0.00001;
    if(vb){ vb.style.color=bad?'#b45309':'var(--slate)'; vb.innerHTML='Agreed '+money(r.ref)+(bad?' — invoice rate is higher':''); }
    if(on&&q>0){ taxable+=a; gst+=ga; } if(bad) over=true; });
  const oc=num(U().val('bfOc')), ocg=r2(oc*num(U().val('bfOcg'))/100); taxable+=oc; gst+=ocg;
  const tdsRate=$('bfTds')?num($('bfTds').value):0, tds=r2(taxable*tdsRate/100), total=r2(taxable+gst);
  const vb=$('bfVarBox'); if(vb) vb.style.display=over?'':'none';
  const e=$('bfTotals'); if(e) e.innerHTML='<table class="tbl" style="width:100%"><tbody><tr><td>Taxable value</td><td class="pus-num">'+money(taxable)+'</td></tr>'
    +(intra?'<tr><td>CGST</td><td class="pus-num">'+money(r2(gst/2))+'</td></tr><tr><td>SGST</td><td class="pus-num">'+money(r2(gst-r2(gst/2)))+'</td></tr>':'<tr><td>IGST</td><td class="pus-num">'+money(gst)+'</td></tr>')
    +'<tr><td><b>Invoice total</b></td><td class="pus-num"><b>'+money(total)+'</b></td></tr>'+(tdsRate>0?'<tr><td>TDS ('+qty(tdsRate)+'%)</td><td class="pus-num">− '+money(tds)+'</td></tr>':'')
    +'<tr><td><b>Payable</b></td><td class="pus-num"><b>'+money(r2(total-tds))+'</b></td></tr></tbody></table>'
    +(over&&varMode()==='block'?'<div class="pus-hint" style="color:#b91c1c">The invoice rate is above the agreed rate and this module does not allow such a bill to be booked. Correct the rate, or raise it with the vendor.</div>':'');
};
window.pusBfSave=async function(book){
  bfRead();
  const v=U().val, head={bill_type:BF.type,invoice_no:v('bfInv'),invoice_date:v('bfInvDate'),due_date:v('bfDue')||null,gst_type:v('bfGstType'),other_charges:num(v('bfOc')),other_charges_gst:num(v('bfOcg')),
    tds_rate:$('bfTds')?num($('bfTds').value):0,variance_note:$('bfVar')?$('bfVar').value.trim():'',remarks:v('bfRem'),expense_head_id:$('bfHead')?(parseInt(v('bfHead'),10)||null):null};
  if(BF.mode==='goods') head.po_id=BF.po.id; else if(BF.mode==='order') head.order_id=BF.order.id;
  else{ head.project_id=parseInt(v('bfProj'),10)||null; head.vendor_id=parseInt(v('bfVendor'),10)||null; if(!head.project_id){ toast('Choose the project','err'); return; } if(!head.vendor_id){ toast('Choose the vendor','err'); return; } }
  if(!head.invoice_no){ toast('Enter the vendor\'s invoice number','err'); return; }
  if(!head.invoice_date){ toast('Enter the invoice date','err'); return; }
  const lines=[];
  for(const [i,r] of BF.rows.entries()){
    if(BF.mode!=='direct'&&!r.checked) continue;
    const q=num(r.qty), rt=num(r.rate), g=num(r.gst);
    if(BF.mode==='direct'){
      if(!String(r.description).trim()){ toast('Line '+(i+1)+': describe the service','err'); return; }
      if(!/^[0-9]{4}([0-9]{2}([0-9]{2})?)?$/.test(String(r.hsn_sac).trim())){ toast('Line '+(i+1)+': HSN / SAC is mandatory (4, 6 or 8 digits)','err'); return; }
    }
    if(!(q>0)){ toast('Line '+(i+1)+': quantity must be more than 0','err'); return; }
    if(BF.mode!=='direct'&&q>r.avail+0.0005){ toast('Line '+(i+1)+': at most '+qty(r.avail)+' can be billed','err'); return; }
    if(!(rt>0)){ toast('Line '+(i+1)+': rate must be more than 0','err'); return; }
    if(!(g>=0&&g<=100)){ toast('Line '+(i+1)+': GST must be between 0 and 100','err'); return; }
    lines.push(BF.mode==='goods'?{grn_line_id:r.grn_line_id,qty:q,rate:rt,gst_rate:g}:BF.mode==='order'?{order_line_id:r.order_line_id,qty:q,rate:rt,gst_rate:g}:{description:String(r.description).trim(),hsn_sac:String(r.hsn_sac).trim(),unit:String(r.unit).trim()||'Nos',qty:q,rate:rt,gst_rate:g});
  }
  if(!lines.length){ toast('Tick at least one line','err'); return; }
  const {data:id,error}=await U().PU().rpc('bill_save',{p_id:BF.id,p_head:head,p_lines:lines});
  if(U().fail(error,'Could not save the bill')) return;
  if(book){
    const r=await U().PU().rpc('bill_book',{p_id:id});
    if(r.error){ toast('Saved as a draft, but it could not be booked: '+r.error.message,'warn'); closeModal(); navTo('inventory/7/bills/'+id); return; }
    closeModal(); toast('Booked as '+r.data+' — ready to post to Accounts','ok'); navTo('inventory/7/bills/'+id); return;
  }
  closeModal(); toast('Saved as a draft','ok'); navTo('inventory/7/bills/'+id);
};

/* ---------------- bill detail ---------------- */
let CB=null;   // {b, lines, dns, log}
window.pusBillOpen=async function(id,tab){
  const PU=U().PU;
  const [h,l,d,lg]=await Promise.all([PU().from('bills').select('*').eq('id',id).maybeSingle(),PU().from('bill_lines').select('*').eq('bill_id',id).order('line_no'),PU().from('debit_notes').select('*').eq('bill_id',id).order('created_at'),loadLog('bill',id)]);
  const bad=[h,l,d].find(x=>x.error);
  if(bad){ toast('Could not open the bill: '+bad.error.message,'err'); return; }
  const b=h.data; if(!b||b.deleted_at){ toast('That bill no longer exists','err'); return; }
  let order=null, grns=[];
  if(b.order_id){ const r=await PU().from('expense_orders').select('id,doc_no,subject').eq('id',b.order_id).maybeSingle(); order=r.data||null; }
  const gl=(l.data||[]).filter(x=>x.grn_line_id).map(x=>x.grn_line_id);
  if(gl.length){ const r=await PU().from('grn_lines').select('id,grns(id,doc_no,challan_no,invoice_no)').in('id',gl); const m={}; (r.data||[]).forEach(x=>{ if(x.grns) m[x.grns.id]=x.grns; }); grns=Object.values(m); }
  CB={b,lines:l.data||[],dns:d.data||[],log:lg,order,grns};
  const perm=permFor(b.bill_type), btn=[], left=[];
  if(b.status==='draft'&&canAct(b,perm)){ btn.push('<button class="btn" onclick="pusBillEdit('+id+')"><i class="fa-solid fa-pen"></i> Edit</button>','<button class="btn btn-primary" onclick="pusBillBook('+id+')"><i class="fa-solid fa-circle-check"></i> Book the bill</button>'); left.push('<button class="btn btn-ghost" onclick="pusBillDelete('+id+')"><i class="fa-solid fa-trash"></i> Delete draft</button>'); }
  if(b.status==='booked'&&U().can(perm)){ btn.push('<button class="btn" onclick="pusDnNew('+id+')"><i class="fa-solid fa-file-circle-minus"></i> Raise debit note…</button>'); if(b.accounts_status!=='posted') left.push('<button class="btn btn-ghost" onclick="pusBillCancel('+id+')"><i class="fa-solid fa-ban"></i> Cancel bill</button>'); }
  const issued=CB.dns.filter(x=>x.status==='issued').length;
  openModal('<div class="modal-head"><h3>Bill '+esc(billNo(b))+' '+billTag(b)+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="max-height:calc(90vh - 150px);overflow:auto"><div class="pi-tabs" id="pabTabs">'+[['main','Main Info'],['items','Items'],['dn','Debit notes'+(issued?' ('+issued+')':'')],['history','Change History']].map(t=>'<a data-t="'+t[0]+'" onclick="pusBillTab(\''+t[0]+'\')">'+t[1]+'</a>').join('')+'</div><div id="pabBody"></div></div>'
    +'<div class="modal-foot"><div style="margin-right:auto;display:flex;gap:6px">'+left.join('')+'</div><button class="btn" onclick="closeModal()">Close</button>'+btn.join('')+'</div>','xl');
  window.pusBillTab(tab||'main');
};
window.pusBillTab=function(t){
  document.querySelectorAll('#pabTabs a').forEach(a=>a.classList.toggle('on',a.dataset.t===t));
  const e=$('pabBody'); if(!e||!CB) return;
  e.innerHTML=({main:bMain,items:bItems,dn:bDn,history:()=>logRows(CB.log)}[t])();
};
function bMain(){
  const {b,order,grns}=CB, v=vendorById(b.vendor_id);
  const src=b.po_id?ro('Purchase order',poNo(b.po_id))+ro('Goods receipts',grns.map(g=>(g.doc_no||'GRN')+(g.challan_no?' (challan '+g.challan_no+')':'')).join(', ')||'—'):order?ro('Order',(order.doc_no||'Order')+' — '+order.subject):ro('Order','None — direct service bill');
  const acct=b.status!=='booked'?'':b.accounts_status==='posted'?'<div class="pus-hint" style="margin-top:10px"><b>Posted to Accounts</b>'+(b.accounts_ref?' as '+esc(b.accounts_ref):'')+(b.accounts_posted_at?' on '+U().dmyTime(b.accounts_posted_at):'')+'.</div>'
    :'<div class="pus-hint" style="margin-top:10px"><b>Ready to post to Accounts.</b> The bill is booked and Accounts can pick it up for posting. '+(+b.debit_noted>0?'Debit notes raised against it are posted with it.':'')+'</div>';
  const tr=(l,v,bold)=>'<tr><td>'+(bold?'<b>'+l+'</b>':l)+'</td><td class="pus-num">'+(bold?'<b>'+v+'</b>':v)+'</td></tr>';
  return '<div class="pi-form"><div>'+ro('Bill No',b.doc_no||'Assigned when booked')+ro('Type',BTYPE[b.bill_type]+' bill')+ro('Project',projName(b.project_id))+ro('Vendor',vName(b.vendor_id)+(v&&v.gstin?'  ·  GSTIN '+v.gstin:''))+src+(b.expense_head_id?ro('Expense head',headName(b.expense_head_id)):'')
    +'</div><div>'+ro('Vendor\'s invoice',b.invoice_no+'  ·  '+U().dmy(b.invoice_date))+ro('Due date',b.due_date?U().dmy(b.due_date):'—')+ro('Entered on',U().dmy(b.bill_date))+ro('Entered by',uname(b.raised_by))+ro('GST',b.gst_type==='inter'?'Inter-state (IGST)':'Within the state (CGST + SGST)')+'</div></div>'
    +(b.variance_note?'<div class="pi-row"><div class="l">Reason for rate variance</div><div class="v pi-ro" style="white-space:pre-wrap">'+esc(b.variance_note)+'</div></div>':'')
    +'<div class="pi-row"><div class="l">Remarks</div><div class="v pi-ro" style="min-height:40px;white-space:pre-wrap">'+(b.remarks?esc(b.remarks):'&nbsp;')+'</div></div>'
    +'<div style="display:flex;justify-content:flex-end"><table class="tbl" style="width:auto;min-width:320px"><tbody>'+tr('Taxable value',money(b.taxable_value))
    +(b.gst_type==='inter'?tr('IGST',money(b.igst)):tr('CGST',money(b.cgst))+tr('SGST',money(b.sgst)))+tr('Invoice total',money(b.total_amount),1)
    +(+b.tds_amount>0?tr('TDS ('+qty(b.tds_rate)+'%)','− '+money(b.tds_amount)):'')+(+b.debit_noted>0?tr('Debit notes','− '+money(b.debit_noted)):'')+tr('Payable',money(b.payable_amount),1)+'</tbody></table></div>'
    +acct+(b.status==='cancelled'?'<div class="pus-hint">Cancelled'+(b.cancel_reason?': '+esc(b.cancel_reason):'')+'</div>':'');
}
function bItems(){
  const {lines}=CB, rows=lines.map((l,i)=>{ const hi=l.ref_rate!=null&&+l.rate>+l.ref_rate;
    return '<tr><td>'+(i+1)+'</td><td><b>'+esc(l.description||'')+'</b></td><td>'+esc(l.hsn_sac||'')+'</td><td>'+esc(l.unit||'')+'</td><td class="pus-num">'+qty(l.qty)+'</td><td class="pus-num">'+money(l.rate)+(hi?' <span class="tag t-amber" title="Above the agreed rate">above</span>':'')+'</td>'
      +'<td class="pus-num">'+(l.ref_rate!=null?money(l.ref_rate):'—')+'</td><td class="pus-num">'+qty(l.gst_rate)+'%</td><td class="pus-num">'+money(l.taxable)+'</td><td class="pus-num">'+money(l.gst_amount)+'</td><td class="pus-num">'+(+l.debit_noted_qty?qty(l.debit_noted_qty):'—')+(l.rate_dn?' <span class="tag t-gray">rate DN</span>':'')+'</td></tr>'; }).join('');
  return '<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>S.No.</th><th>Description</th><th>HSN / SAC</th><th>Unit</th><th class="pus-num">Qty</th><th class="pus-num">Rate</th><th class="pus-num">Agreed rate</th><th class="pus-num">GST</th><th class="pus-num">Taxable</th><th class="pus-num">GST amt</th><th class="pus-num">Debited qty</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
}
const DNKIND={quantity:'Quantity',rate:'Rate',amount:'Amount'};
function bDn(){
  const {b,dns}=CB, canC=b.status==='booked'&&U().can(permFor(b.bill_type));
  const rows=dns.map(d=>'<tr><td><span class="pus-code">'+esc(d.doc_no)+'</span></td><td>'+U().dmy(d.dn_date)+'</td><td>'+DNKIND[d.kind]+'</td><td>'+esc(d.reason)+(d.status==='cancelled'&&d.cancel_reason?'<div style="font-size:12px;color:var(--slate)">Cancelled: '+esc(d.cancel_reason)+'</div>':'')+'</td>'
    +'<td class="pus-num">'+money(d.taxable_value)+'</td><td class="pus-num">'+money(d.gst_amount)+'</td><td class="pus-num"><b>'+money(d.total_amount)+'</b></td><td>'+(d.status==='cancelled'?'<span class="tag t-red">Cancelled</span>':d.accounts_status==='posted'?'<span class="tag t-green">Posted</span>':'<span class="tag t-blue">Ready to post</span>')+'</td>'
    +'<td class="pus-act">'+(canC&&d.status==='issued'&&d.accounts_status!=='posted'?'<button class="btn btn-sm btn-ghost" title="Cancel this debit note" onclick="pusDnCancel('+d.id+')"><i class="fa-solid fa-ban"></i></button>':'')+'</td></tr>').join('');
  return '<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Debit note</th><th>Date</th><th>Kind</th><th>Reason</th><th class="pus-num">Taxable</th><th class="pus-num">GST</th><th class="pus-num">Total</th><th>Status</th><th></th></tr></thead><tbody>'
    +(rows||'<tr><td colspan="9"><div class="empty" style="padding:18px"><div>No debit notes against this bill</div></div></td></tr>')+'</tbody></table></div></div>';
}
window.pusBillEdit=function(id){ window.pusBillForm({id}); };
window.pusBillBook=async function(id){
  const {data,error}=await U().PU().rpc('bill_book',{p_id:id});
  if(U().fail(error,'Could not book the bill')) return;
  closeModal(); toast('Booked as '+data+' — ready to post to Accounts','ok'); route();
};
window.pusBillDelete=async function(id){
  if(!await confirmDialog('Delete this draft bill?')) return;
  const {error}=await U().PU().rpc('bill_delete',{p_id:id});
  if(U().fail(error,'Delete failed')) return;
  closeModal(); toast('Draft deleted','ok'); navTo('inventory/7/bills');
};
window.pusBillCancel=function(id){
  openModal('<div class="modal-head"><h3>Cancel bill</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><div class="pus-hint" style="margin-top:0">The quantity goes back to "awaiting bill" so it can be billed again. Cancel any debit notes against the bill first. A bill Accounts has already posted must be reversed by Accounts.</div><label>Reason</label><textarea id="papWhy" rows="3"></textarea></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Keep it</button><button class="btn btn-primary" onclick="pusBillCancelSave('+id+')">Cancel bill</button></div>');
};
window.pusBillCancelSave=async function(id){
  const why=U().val('papWhy'); if(!why){ toast('Give a reason','err'); return; }
  const {error}=await U().PU().rpc('bill_cancel',{p_id:id,p_reason:why});
  if(U().fail(error,'Could not cancel')) return;
  closeModal(); toast('Bill cancelled','ok'); route();
};

/* ---------------- debit notes ---------------- */
let DN=null;
window.pusDnNew=async function(billId){
  const b=CB&&CB.b.id===billId?CB.b:null; if(!b) return;
  const lines=CB.lines;
  let rtvs=[]; if(b.bill_type==='goods'){ const r=await U().PU().from('rtvs').select('id,doc_no,rtv_date').eq('vendor_id',b.vendor_id).order('rtv_date',{ascending:false}).limit(50); rtvs=r.data||[]; }
  DN={b,lines,kind:'quantity'};
  const qrows=lines.map(l=>{ const left=+l.qty-+l.debit_noted_qty; return '<tr class="dn-q" data-id="'+l.id+'" data-max="'+left+'"><td><b>'+esc(l.description||'')+'</b></td><td class="pus-num">'+qty(l.qty)+'</td><td class="pus-num">'+qty(l.debit_noted_qty)+'</td><td class="pus-num">'+money(l.rate)+'</td><td><input class="dn-qty" type="number" step="0.001" min="0" max="'+left+'" style="width:96px" placeholder="0" oninput="pusDnCalc()"'+(left<=0.0005?' disabled':'')+'></td></tr>'; }).join('');
  const rrows=lines.map(l=>'<tr class="dn-r" data-id="'+l.id+'" data-rate="'+l.rate+'" data-left="'+(+l.qty-+l.debit_noted_qty)+'" data-gst="'+l.gst_rate+'"><td><b>'+esc(l.description||'')+'</b></td><td class="pus-num">'+(+l.qty-+l.debit_noted_qty)+'</td><td class="pus-num">'+money(l.rate)+'</td><td>'+(l.rate_dn?'<span class="tag t-gray">already raised</span>':'<input class="dn-nr" type="number" step="0.01" min="0" style="width:100px" placeholder="agreed rate" oninput="pusDnCalc()">')+'</td></tr>').join('');
  openModal('<div class="modal-head"><h3>Raise a debit note — bill '+esc(billNo(b))+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm" style="max-height:72vh;overflow:auto">'
    +'<div class="pus-hint" style="margin-top:0">A debit note reduces what is payable on this bill. It can never be more than the bill itself ('+money(b.total_amount)+', of which '+money(b.debit_noted)+' is already debited).</div>'
    +'<div class="pus-subs" id="dnKinds">'+[['quantity','Quantity — goods short or returned'],['rate','Rate — billed above the agreed rate'],['amount','Amount — a lump sum']].map(k=>'<span class="chip'+(k[0]==='quantity'?' active':'')+'" data-k="'+k[0]+'" onclick="pusDnKind(\''+k[0]+'\')">'+k[1]+'</span>').join('')+'</div>'
    +'<div id="dnPaneQ" class="card" style="padding:0;margin:8px 0"><table class="tbl"><thead><tr><th>Item</th><th class="pus-num">Billed</th><th class="pus-num">Already debited</th><th class="pus-num">Rate</th><th>Debit qty</th></tr></thead><tbody>'+qrows+'</tbody></table></div>'
    +'<div id="dnPaneR" class="card" style="padding:0;margin:8px 0;display:none"><table class="tbl"><thead><tr><th>Item</th><th class="pus-num">Qty</th><th class="pus-num">Invoice rate</th><th>Agreed rate</th></tr></thead><tbody>'+rrows+'</tbody></table><div class="pus-hint" style="padding:8px 12px;margin:0">Fill in the rate only on the lines to debit. The note is for the difference × the quantity still on the bill.</div></div>'
    +'<div id="dnPaneA" style="display:none;margin:8px 0"><div class="pi-form"><div>'+field('Amount (₹, before GST)','<input id="dnAmt" type="number" step="0.01" min="0" oninput="pusDnCalc()">')+'</div><div>'+field('GST %','<input id="dnGst" type="number" step="0.01" min="0" max="100" value="0" oninput="pusDnCalc()">')+'</div></div></div>'
    +'<div class="pi-form" style="margin-top:8px"><div>'+field('Date','<input id="dnDate" type="date" max="'+today()+'" value="'+today()+'">')+(rtvs.length?field('Linked return to vendor','<select id="dnRtv"><option value="">None</option>'+rtvs.map(r=>'<option value="'+r.id+'">'+esc(r.doc_no||'Return')+' — '+U().dmy(r.rtv_date)+'</option>').join('')+'</select>'):'')+'</div><div>'+field('Reason <span style="color:#dc2626">*</span>','<textarea id="dnWhy" rows="3" placeholder="Why the vendor is being debited"></textarea>')+'</div></div>'
    +'<div id="dnTot" style="text-align:right;font-weight:600;margin-top:6px"></div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusDnSave()">Raise debit note</button></div>');
  window.pusDnCalc();
};
window.pusDnKind=function(k){
  DN.kind=k; document.querySelectorAll('#dnKinds .chip').forEach(c=>c.classList.toggle('active',c.dataset.k===k));
  $('dnPaneQ').style.display=k==='quantity'?'':'none'; $('dnPaneR').style.display=k==='rate'?'':'none'; $('dnPaneA').style.display=k==='amount'?'':'none'; window.pusDnCalc();
};
window.pusDnCalc=function(){
  let tax=0, gst=0;
  if(DN.kind==='quantity') document.querySelectorAll('.dn-q').forEach(tr=>{ const q=num(tr.querySelector('.dn-qty').value), l=DN.lines.find(x=>x.id===+tr.dataset.id); const t=r2(q*+l.rate); tax+=t; gst+=r2(t*+l.gst_rate/100); });
  else if(DN.kind==='rate') document.querySelectorAll('.dn-r').forEach(tr=>{ const i=tr.querySelector('.dn-nr'); if(!i||i.value==='') return; const nr=num(i.value); if(nr<=0||nr>=+tr.dataset.rate) return; const t=r2(+tr.dataset.left*(+tr.dataset.rate-nr)); tax+=t; gst+=r2(t*+tr.dataset.gst/100); });
  else { tax=num(U().val('dnAmt')); gst=r2(tax*num(U().val('dnGst'))/100); }
  const e=$('dnTot'); if(e) e.textContent='Debit note value '+money(r2(tax+gst))+'  (taxable '+money(tax)+' + GST '+money(gst)+')';
};
window.pusDnSave=async function(){
  const v=U().val, head={reason:v('dnWhy'),dn_date:v('dnDate'),rtv_id:$('dnRtv')?(parseInt(v('dnRtv'),10)||null):null};
  if(!head.reason){ toast('Give the reason for the debit note','err'); return; }
  let lines=null;
  if(DN.kind==='quantity'){
    lines=[...document.querySelectorAll('.dn-q')].map(tr=>({bill_line_id:+tr.dataset.id,qty:num(tr.querySelector('.dn-qty').value),max:+tr.dataset.max})).filter(x=>x.qty>0);
    if(lines.some(x=>x.qty>x.max+0.0005)){ toast('A quantity is more than can still be debited','err'); return; }
    lines=lines.map(x=>({bill_line_id:x.bill_line_id,qty:x.qty}));
  } else if(DN.kind==='rate'){
    lines=[...document.querySelectorAll('.dn-r')].filter(tr=>{const i=tr.querySelector('.dn-nr');return i&&i.value!=='';}).map(tr=>({bill_line_id:+tr.dataset.id,new_rate:num(tr.querySelector('.dn-nr').value)}));
  } else { head.amount=num(v('dnAmt')); head.gst_rate=num(v('dnGst')); }
  if(DN.kind!=='amount'&&!lines.length){ toast(DN.kind==='quantity'?'Enter the quantity to debit on at least one item':'Enter the agreed rate on at least one item','err'); return; }
  const {data,error}=await U().PU().rpc('debit_note_create',{p_bill_id:DN.b.id,p_kind:DN.kind,p_head:head,p_lines:lines});
  if(U().fail(error,'Could not raise the debit note')) return;
  closeModal(); toast('Debit note '+data+' raised — the amount payable is reduced','ok'); window.pusBillOpen(DN.b.id,'dn'); billRefresh();
};
window.pusDnCancel=function(id){
  const billId=CB.b.id;
  openModal('<div class="modal-head"><h3>Cancel debit note</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><div class="pus-hint" style="margin-top:0">The amount goes back onto what is payable on the bill. A debit note Accounts has already posted must be reversed by Accounts.</div><label>Reason</label><textarea id="papWhy" rows="3"></textarea></div><div class="modal-foot"><button class="btn" onclick="pusBillOpen('+billId+',\'dn\')">Back</button><button class="btn btn-primary" onclick="pusDnCancelSave('+id+','+billId+')">Cancel debit note</button></div>');
};
window.pusDnCancelSave=async function(id,billId){
  const why=U().val('papWhy'); if(!why){ toast('Give a reason','err'); return; }
  const {error}=await U().PU().rpc('debit_note_cancel',{p_id:id,p_reason:why});
  if(U().fail(error,'Could not cancel')) return;
  toast('Debit note cancelled','ok'); window.pusBillOpen(billId,'dn'); billRefresh();
};
async function billRefresh(){ if(CURSEC!=='bills'&&CURSEC!=='debit') return; const h=$('papBody'); if(!h) return; try{ await ({bills:billList,debit:dnList}[CURSEC])(h); }catch(e){} }

async function dnList(host){
  const [d,b]=await Promise.all([U().PU().from('debit_notes').select('*').order('created_at',{ascending:false}),U().PU().from('bills').select('id,doc_no,bill_type,invoice_no').is('deleted_at',null)]);
  const bad=[d,b].find(x=>x.error); if(bad) throw bad.error;
  B.dns=d.data||[]; const bm={}; (b.data||[]).forEach(x=>bm[x.id]=x);
  const rows=B.dns.map(x=>{ const bl=bm[x.bill_id]||{}; return '<tr style="cursor:pointer" onclick="navTo(\'inventory/7/bills/'+x.bill_id+'\')"><td><span class="pus-code">'+esc(x.doc_no)+'</span></td><td>'+U().dmy(x.dn_date)+'</td><td>'+DNKIND[x.kind]+'</td><td>'+esc(bl.doc_no||'—')+'<div style="font-size:12px;color:var(--slate)">Invoice '+esc(bl.invoice_no||'')+'</div></td><td><b>'+esc(vName(x.vendor_id))+'</b></td><td>'+esc(projName(x.project_id))+'</td>'
    +'<td>'+esc(x.reason)+'</td><td class="pus-num"><b>'+money(x.total_amount)+'</b></td><td>'+(x.status==='cancelled'?'<span class="tag t-red">Cancelled</span>':x.accounts_status==='posted'?'<span class="tag t-green">Posted</span>':'<span class="tag t-blue">Ready to post</span>')+'</td></tr>'; }).join('');
  host.innerHTML=listShell('Debit notes','Raised from a booked bill (open the bill → Raise debit note) for short quantity, a rate above the agreed rate, or a lump amount. Each reduces what is payable on the bill.','',null,
    [['Debit note'],['Date'],['Kind'],['Bill'],['Vendor'],['Project'],['Reason'],['Total',1],['Status']],rows);
}

/* ======================================================= NON-STORE & SERVICE ORDERS ======================================================= */
const OSC=[['all','All'],['draft','Drafts'],['pending','Awaiting approval'],['mine','Awaiting my approval'],['approved','Approved'],['rejected','Rejected'],['closed','Closed'],['cancelled','Cancelled']];
const KIND={non_store:'Non-store purchase',service:'Service work order'};
const eoNo=o=>o.doc_no||('Draft #'+o.id);
function oTotals(id){ const ls=B.olines.filter(l=>l.order_id===id); let q=0,b=0; ls.forEach(l=>{q+=+l.qty;b+=+l.billed_qty;}); return {n:ls.length,qty:q,billed:b}; }
function oStatus(o){
  switch(o.status){
    case 'draft': return ['Draft','t-gray'];
    case 'pending_approval': return ['Awaiting level '+o.current_level,'t-amber'];
    case 'approved': { const t=oTotals(o.id); return t.billed>=t.qty-0.0005?['Fully billed','t-green']:t.billed>0?['Part billed','t-blue']:['Approved','t-green']; }
    case 'rejected': return ['Rejected','t-red'];
    case 'closed': return ['Closed','t-gray'];
    case 'cancelled': return ['Cancelled','t-red'];
  }
  return [o.status,'t-gray'];
}
const oTag=o=>{const s=oStatus(o);return '<span class="tag '+s[1]+'">'+esc(s[0])+'</span>';};
const oMine=o=>o.status==='pending_approval'&&(selfApproval()||String(o.raised_by).toLowerCase()!==me())&&B.oapp.some(a=>a.order_id===o.id&&a.approvers.some(e=>e.toLowerCase()===me()));
async function orderList(host){
  const PU=U().PU;
  const [o,l,a]=await Promise.all([PU().from('expense_orders').select('*').is('deleted_at',null).order('created_at',{ascending:false}),PU().from('expense_order_lines').select('id,order_id,qty,billed_qty'),PU().from('expense_order_approvals').select('order_id,level,approvers,round,status').eq('status','pending')]);
  const bad=[o,l,a].find(x=>x.error); if(bad) throw bad.error;
  B.orders=o.data||[]; B.olines=l.data||[]; B.oapp=a.data||[];
  orderRender(host);
}
function orderRender(host){
  host=host||$('papBody'); if(!host) return;
  const q=B.oq.toLowerCase();
  const inF=(o,k)=>k==='all'||(k==='draft'&&o.status==='draft')||(k==='pending'&&o.status==='pending_approval')||(k==='mine'&&oMine(o))||(k==='approved'&&o.status==='approved')||(k==='rejected'&&o.status==='rejected')||(k==='closed'&&o.status==='closed')||(k==='cancelled'&&o.status==='cancelled');
  const list=B.orders.filter(o=>inF(o,B.ofilter)&&(!q||(eoNo(o)+' '+o.subject+' '+vName(o.vendor_id)+' '+projName(o.project_id)).toLowerCase().includes(q)));
  const chips=OSC.map(([k,l])=>'<span class="chip'+(B.ofilter===k?' active':'')+'" onclick="pusEoFilter(\''+k+'\')">'+l+' ('+B.orders.filter(o=>inF(o,k)).length+')</span>').join('');
  const rows=list.map(o=>'<tr style="cursor:pointer" onclick="pusEoOpen('+o.id+')"><td><span class="pus-code">'+esc(eoNo(o))+'</span></td><td>'+esc(KIND[o.kind])+'</td><td><b>'+esc(o.subject)+'</b></td><td>'+esc(vName(o.vendor_id))+'</td><td>'+esc(projName(o.project_id))+'</td><td style="white-space:nowrap">'+U().dmy(o.order_date)+'</td>'
    +'<td class="pus-num"><b>'+money(o.total_amount)+'</b></td><td>'+oTag(o)+(oMine(o)?' <span class="tag t-blue">Your turn</span>':'')+'</td><td>'+esc(uname(o.raised_by))+'</td></tr>').join('');
  host.innerHTML=listShell('Non-store purchases & service work orders','Expenses that do not go into stores, and services bought from a vendor. Each is approved through the project\'s approvers (Admin → Approvers) before a bill can be booked against it. Contractor work belongs to the Engineering module.',
    'New order',U().can('nonstore.purchase')?'pusEoForm()':'',[['Order no'],['Kind'],['For'],['Vendor'],['Project'],['Date'],['Amount',1],['Status'],['Raised by']],rows,
    '<div class="pus-top"><div class="pus-subs" style="margin:0">'+chips+'</div><input class="grow" id="papOq" placeholder="Search by number, subject, vendor or project" value="'+esc(B.oq)+'" oninput="pusEoSearch()"></div>');
}
window.pusEoFilter=function(k){ B.ofilter=k; orderRender(); };
window.pusEoSearch=function(){ B.oq=U().val('papOq'); orderRender(); const e=$('papOq'); if(e){ e.focus(); e.setSelectionRange(e.value.length,e.value.length); } };

/* ---------------- order form ---------------- */
let EF=null;   // {id, kind, rows:[{description,hsn_sac,qty,unit,rate,gst}], o}
function efRowsHtml(){
  return EF.rows.map((r,i)=>'<tr class="ef-row" data-i="'+i+'"><td>'+(i+1)+'</td><td><input class="ef-desc" style="min-width:210px" value="'+esc(r.description)+'" placeholder="What is being bought / done"></td><td><input class="ef-hsn" style="width:90px" value="'+esc(r.hsn_sac)+'" placeholder="HSN / SAC"></td>'
    +'<td><input class="ef-qty" type="number" step="0.001" min="0" style="width:88px" value="'+esc(r.qty)+'" oninput="pusEfCalc()"></td><td><input class="ef-unit" style="width:64px" value="'+esc(r.unit)+'"></td><td><input class="ef-rate" type="number" step="0.01" min="0" style="width:100px" value="'+esc(r.rate)+'" oninput="pusEfCalc()"></td>'
    +'<td><input class="ef-gst" type="number" step="0.01" min="0" max="100" style="width:68px" value="'+esc(r.gst)+'" oninput="pusEfCalc()"></td><td class="pus-num ef-tot"></td><td>'+(EF.rows.length>1?'<button class="btn btn-sm btn-ghost" title="Remove" onclick="pusEfDel('+i+')"><i class="fa-solid fa-trash"></i></button>':'')+'</td></tr>').join('');
}
function efVendors(kind){ return B.vendors.filter(x=>x.status==='approved'&&(kind!=='service'||x.vendor_type==='service'||x.vendor_type==='both')); }
window.pusEoForm=async function(id){
  let o=null, rows=[{description:'',hsn_sac:'',qty:'',unit:'Nos',rate:'',gst:18}];
  if(id){
    const [h,l]=await Promise.all([U().PU().from('expense_orders').select('*').eq('id',id).single(),U().PU().from('expense_order_lines').select('*').eq('order_id',id).order('line_no')]);
    if(h.error||l.error){ toast('Could not open the order','err'); return; }
    o=h.data; rows=(l.data||[]).map(x=>({description:x.description,hsn_sac:x.hsn_sac,qty:+x.qty,unit:x.unit,rate:+x.rate,gst:+x.gst_rate}));
  }
  closeModal();
  EF={id:id||null,kind:o?o.kind:'non_store',rows,o,pending:!!(o&&o.status==='pending_approval')};
  const f=EF.o||{}, ven=efVendors(EF.kind), heads=B.heads.filter(x=>x.active||x.id===f.expense_head_id);
  const pendingNote='<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:11px 14px;margin-bottom:12px;font-size:13.5px"><b style="color:#b45309"><i class="fa-solid fa-hourglass-half"></i> Awaiting approval</b><div style="margin-top:4px">Saving your changes pulls this order back and sends it to the first approver again. Approvals given so far no longer count. Press Cancel to leave it as it is.</div></div>';
  openModal('<div class="modal-head"><h3>'+(id?'Edit '+esc(eoNo(o)):'New non-store purchase / service order')+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm" style="max-height:calc(90vh - 150px);overflow:auto">'+(EF.pending?pendingNote:'')
    +'<div class="pus-hint" style="margin-top:0">Non-store purchases are expenses that do not go into stores. A service work order is for a service bought from a vendor (not a contractor — that is the Engineering module). HSN / SAC is mandatory on every line.</div>'
    +'<div class="pi-form"><div>'
      +(id?ro('Kind',KIND[o.kind])+ro('Project',projName(o.project_id)):field('Kind','<select id="efKind" onchange="pusEfKind()"><option value="non_store">Non-store purchase</option><option value="service">Service work order</option></select>')+field('Project','<select id="efProj"><option value="">Choose…</option>'+U().S.projects.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join('')+'</select>'))
      +field('Vendor','<select id="efVendor"><option value="">Choose…</option>'+ven.map(x=>'<option value="'+x.id+'"'+(x.id===f.vendor_id?' selected':'')+'>'+esc(x.trade_name||x.legal_name)+'</option>').join('')+'</select>')
      +field('Expense head','<select id="efHead"><option value="">—</option>'+heads.map(x=>'<option value="'+x.id+'"'+(x.id===f.expense_head_id?' selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select>')
    +'</div><div>'
      +field('Date','<input id="efDate" type="date" max="'+today()+'" value="'+esc(f.order_date||today())+'">')
      +field('For <span style="color:#dc2626">*</span>','<input id="efSubject" value="'+esc(f.subject||'')+'" placeholder="e.g. Fire extinguisher refill, site painting">')
      +field('Payment terms','<input id="efPay" value="'+esc(f.payment_terms||'')+'">')
    +'</div></div>'
    +field('Scope / details','<textarea id="efScope" rows="2">'+esc(f.scope||'')+'</textarea>')
    +'<div class="card" style="padding:0;margin-top:8px"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>#</th><th>Description</th><th>HSN / SAC *</th><th>Qty</th><th>Unit</th><th>Rate (₹)</th><th>GST %</th><th class="pus-num">Line total</th><th></th></tr></thead><tbody id="efBody">'+efRowsHtml()+'</tbody><tfoot><tr><td colspan="7" style="text-align:right"><b>Order total</b></td><td class="pus-num"><b id="efTotal"></b></td><td></td></tr></tfoot></table></div></div>'
    +'<div style="margin-top:8px"><button class="btn btn-sm" onclick="pusEfAdd()"><i class="fa-solid fa-plus"></i> Add a line</button></div>'
    +field('Remarks','<textarea id="efRem" rows="2">'+esc(f.remarks||'')+'</textarea>')+'</div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>'+(EF.pending?'':'<button class="btn" onclick="pusEfSave(false)">Save as draft</button>')+'<button class="btn btn-primary" onclick="pusEfSave(true)">'+(EF.pending?'Save & send for approval again':'Save & submit')+'</button></div>','xl');
  window.pusEfCalc();
};
window.pusEfKind=function(){ const k=U().val('efKind'); EF.kind=k; const cur=U().val('efVendor'); $('efVendor').innerHTML='<option value="">Choose…</option>'+efVendors(k).map(x=>'<option value="'+x.id+'"'+(String(x.id)===cur?' selected':'')+'>'+esc(x.trade_name||x.legal_name)+'</option>').join(''); };
function efRead(){ document.querySelectorAll('#efBody .ef-row').forEach(tr=>{ const r=EF.rows[+tr.dataset.i]; if(!r) return; r.description=tr.querySelector('.ef-desc').value; r.hsn_sac=tr.querySelector('.ef-hsn').value; r.qty=tr.querySelector('.ef-qty').value; r.unit=tr.querySelector('.ef-unit').value; r.rate=tr.querySelector('.ef-rate').value; r.gst=tr.querySelector('.ef-gst').value; }); }
window.pusEfAdd=function(){ efRead(); EF.rows.push({description:'',hsn_sac:'',qty:'',unit:'Nos',rate:'',gst:18}); $('efBody').innerHTML=efRowsHtml(); window.pusEfCalc(); };
window.pusEfDel=function(i){ efRead(); EF.rows.splice(i,1); $('efBody').innerHTML=efRowsHtml(); window.pusEfCalc(); };
window.pusEfCalc=function(){
  let t=0; document.querySelectorAll('#efBody .ef-row').forEach(tr=>{ const a=r2(num(tr.querySelector('.ef-qty').value)*num(tr.querySelector('.ef-rate').value)), g=r2(a*num(tr.querySelector('.ef-gst').value)/100); t+=a+g; tr.querySelector('.ef-tot').textContent=money(a+g); });
  const e=$('efTotal'); if(e) e.textContent=money(r2(t));
};
window.pusEfSave=async function(submit){
  efRead(); const v=U().val, lines=[];
  const head={vendor_id:parseInt(v('efVendor'),10)||null,expense_head_id:parseInt(v('efHead'),10)||null,order_date:v('efDate'),subject:v('efSubject'),scope:v('efScope'),payment_terms:v('efPay'),remarks:v('efRem')};
  if(!EF.id){ head.kind=v('efKind'); head.project_id=parseInt(v('efProj'),10)||null; if(!head.project_id){ toast('Choose the project','err'); return; } }
  if(!head.vendor_id){ toast('Choose the vendor','err'); return; }
  if(!head.subject){ toast('Say what the order is for','err'); return; }
  for(const [i,r] of EF.rows.entries()){
    if(!String(r.description).trim()){ toast('Line '+(i+1)+': add a description','err'); return; }
    if(!/^[0-9]{4}([0-9]{2}([0-9]{2})?)?$/.test(String(r.hsn_sac).trim())){ toast('Line '+(i+1)+': HSN / SAC is mandatory (4, 6 or 8 digits)','err'); return; }
    if(!(num(r.qty)>0)){ toast('Line '+(i+1)+': quantity must be more than 0','err'); return; }
    if(!(num(r.rate)>0)){ toast('Line '+(i+1)+': rate must be more than 0','err'); return; }
    if(!(num(r.gst)>=0&&num(r.gst)<=100)){ toast('Line '+(i+1)+': GST must be between 0 and 100','err'); return; }
    lines.push({description:String(r.description).trim(),hsn_sac:String(r.hsn_sac).trim(),qty:num(r.qty),unit:String(r.unit).trim()||'Nos',rate:num(r.rate),gst_rate:num(r.gst)});
  }
  let pulledBack=false;
  if(EF.pending){                      // awaiting approval: pull it back first (database function), then it is an ordinary draft
    const w=await U().PU().rpc('eo_withdraw',{p_id:EF.id}); if(U().fail(w.error,'Could not pull the order back from approval')) return;
    pulledBack=true; submit=true;
  }
  const {data:id,error}=await U().PU().rpc('eo_save',{p_id:EF.id,p_head:head,p_lines:lines});
  if(U().fail(error,'Could not save')){ if(pulledBack) toast('The order was pulled back from approval and is now a draft. Fix the problem, then send it again.','warn'); return; }
  if(submit){
    const r=await U().PU().rpc('eo_submit',{p_id:id});
    if(r.error){ toast('Saved, but it could not be submitted: '+r.error.message.replace(/Admin > Approvers/,'Admin → Approvers'),'warn'); closeModal(); navTo('inventory/7/orders/'+id); return; }
    closeModal(); toast(pulledBack?'Saved and sent for approval again as '+r.data:'Submitted as '+r.data,'ok'); navTo('inventory/7/orders/'+id); return;
  }
  closeModal(); toast('Saved as a draft','ok'); navTo('inventory/7/orders/'+id);
};

/* ---------------- order detail ---------------- */
let CE=null;   // {o, lines, steps, log, bills}
window.pusEoOpen=async function(id,tab){
  const PU=U().PU;
  const [h,l,a,b,lg]=await Promise.all([PU().from('expense_orders').select('*').eq('id',id).maybeSingle(),PU().from('expense_order_lines').select('*').eq('order_id',id).order('line_no'),PU().from('expense_order_approvals').select('*').eq('order_id',id).order('round').order('level'),
    PU().from('bills').select('id,doc_no,invoice_no,invoice_date,total_amount,status,accounts_status,bill_type').eq('order_id',id).is('deleted_at',null).order('created_at'),loadLog('eo',id)]);
  const bad=[h,l,a,b].find(x=>x.error);
  if(bad){ toast('Could not open the order: '+bad.error.message,'err'); return; }
  const o=h.data; if(!o||o.deleted_at){ toast('That order no longer exists','err'); return; }
  CE={o,lines:l.data||[],steps:a.data||[],bills:b.data||[],log:lg};
  const perm='nonstore.purchase', mineRaised=canAct(o,perm), btn=[], left=[];
  // While it is awaiting approval its maker can still change or delete it. Once approved: never.
  const canEditPending=o.status==='pending_approval'&&mineRaised;
  const my=o.status==='pending_approval'&&(selfApproval()||String(o.raised_by).toLowerCase()!==me())&&CE.steps.some(s=>s.round===o.round&&s.level===o.current_level&&s.status==='pending'&&s.approvers.some(e=>e.toLowerCase()===me()));
  const open=CE.lines.some(x=>+x.qty-+x.billed_qty>0.0005), billed=CE.lines.some(x=>+x.billed_qty>0);
  if(mineRaised&&['draft','rejected'].includes(o.status)) btn.push('<button class="btn" onclick="pusEoForm('+id+')"><i class="fa-solid fa-pen"></i> Edit</button>','<button class="btn btn-primary" onclick="pusEoSubmit('+id+')"><i class="fa-solid fa-paper-plane"></i> '+(o.status==='rejected'?'Resubmit for approval':'Submit for approval')+'</button>');
  if(canEditPending) btn.push('<button class="btn" onclick="pusEoForm('+id+')" title="Pulls it back from approval; saving sends it to the first approver again"><i class="fa-solid fa-pen"></i> Edit</button>');
  if(my) btn.push('<button class="btn" onclick="pusEoDecide('+id+',false)"><i class="fa-solid fa-circle-xmark"></i> Reject</button>','<button class="btn btn-primary" onclick="pusEoDecide('+id+',true)"><i class="fa-solid fa-circle-check"></i> Approve</button>');
  if(o.status==='approved'&&open&&U().can(permFor(o.kind==='non_store'?'non_store':'service'))) btn.push('<button class="btn btn-primary" onclick="pusEoBill('+id+')"><i class="fa-solid fa-file-invoice"></i> Book a bill…</button>');
  if(U().can(perm)){
    if(o.status==='approved') left.push('<button class="btn btn-ghost" onclick="pusEoAsk('+id+',\'close\')"><i class="fa-solid fa-lock"></i> Close order…</button>');
    if(['draft','rejected'].includes(o.status)&&mineRaised||(o.status==='approved'&&!billed)) left.push('<button class="btn btn-ghost" onclick="pusEoAsk('+id+',\'cancel\')"><i class="fa-solid fa-ban"></i> Cancel order…</button>');
    if((o.status==='draft'&&mineRaised)||canEditPending) left.push('<button class="btn btn-ghost" onclick="pusEoDelete('+id+')"><i class="fa-solid fa-trash"></i> '+(o.status==='draft'?'Delete draft':'Delete')+'</button>');
  }
  openModal('<div class="modal-head"><h3>'+esc(KIND[o.kind])+' '+esc(eoNo(o))+' '+oTag(o)+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="max-height:calc(90vh - 150px);overflow:auto"><div class="pi-tabs" id="paoTabs">'+[['main','Main Info'],['items','Items'],['bills','Bills ('+CE.bills.length+')'],['approval','Approval History'],['history','Change History']].map(t=>'<a data-t="'+t[0]+'" onclick="pusEoTab(\''+t[0]+'\')">'+t[1]+'</a>').join('')+'</div><div id="paoBody"></div></div>'
    +'<div class="modal-foot"><div style="margin-right:auto;display:flex;gap:6px">'+left.join('')+'</div><button class="btn" onclick="closeModal()">Close</button>'+btn.join('')+'</div>','xl');
  window.pusEoTab(tab||'main');
};
window.pusEoTab=function(t){
  document.querySelectorAll('#paoTabs a').forEach(a=>a.classList.toggle('on',a.dataset.t===t));
  const e=$('paoBody'); if(!e||!CE) return;
  e.innerHTML=({main:eMain,items:eItems,bills:eBills,approval:eApproval,history:()=>logRows(CE.log)}[t])();
};
function eMain(){
  const {o}=CE, v=vendorById(o.vendor_id);
  return '<div class="pi-form"><div>'+ro('Kind',KIND[o.kind])+ro('Order No',o.doc_no||'Assigned on submission')+ro('Project',projName(o.project_id))+ro('Vendor',vName(o.vendor_id)+(v&&v.gstin?'  ·  GSTIN '+v.gstin:''))+ro('Expense head',o.expense_head_id?headName(o.expense_head_id):'—')
    +'</div><div>'+ro('Date',U().dmy(o.order_date))+ro('For',o.subject)+ro('Payment terms',o.payment_terms||'')+ro('Raised by',uname(o.raised_by))+'</div></div>'
    +'<div class="pi-row"><div class="l">Scope / details</div><div class="v pi-ro" style="min-height:40px;white-space:pre-wrap">'+(o.scope?esc(o.scope):'&nbsp;')+'</div></div>'
    +'<div class="pi-row"><div class="l">Remarks</div><div class="v pi-ro" style="min-height:40px;white-space:pre-wrap">'+(o.remarks?esc(o.remarks):'&nbsp;')+'</div></div>'
    +'<div style="display:flex;justify-content:flex-end"><table class="tbl" style="width:auto;min-width:300px"><tbody><tr><td>Basic amount</td><td class="pus-num">'+money(o.total_basic)+'</td></tr><tr><td>GST</td><td class="pus-num">'+money(o.total_gst)+'</td></tr><tr><td><b>Total</b></td><td class="pus-num"><b>'+money(o.total_amount)+'</b></td></tr></tbody></table></div>'
    +(o.status==='cancelled'?'<div class="pus-hint">Cancelled'+(o.cancel_reason?': '+esc(o.cancel_reason):'')+'</div>':'');
}
function eItems(){
  const rows=CE.lines.map((l,i)=>'<tr><td>'+(i+1)+'</td><td><b>'+esc(l.description)+'</b></td><td>'+esc(l.hsn_sac)+'</td><td>'+esc(l.unit)+'</td><td class="pus-num">'+qty(l.qty)+'</td><td class="pus-num">'+money(l.rate)+'</td><td class="pus-num">'+qty(l.gst_rate)+'%</td><td class="pus-num">'+money(l.amount)+'</td><td class="pus-num">'+money(l.gst_amount)+'</td><td class="pus-num"><b>'+money(+l.amount+ +l.gst_amount)+'</b></td><td class="pus-num">'+qty(l.billed_qty)+'</td><td class="pus-num"><b>'+qty(+l.qty-+l.billed_qty)+'</b></td></tr>').join('');
  return '<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>S.No.</th><th>Description</th><th>HSN / SAC</th><th>Unit</th><th class="pus-num">Qty</th><th class="pus-num">Rate</th><th class="pus-num">GST</th><th class="pus-num">Amount</th><th class="pus-num">GST amt</th><th class="pus-num">Total</th><th class="pus-num">Billed</th><th class="pus-num">Left</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
}
function eBills(){
  const rows=CE.bills.map(b=>'<tr style="cursor:pointer" onclick="navTo(\'inventory/7/bills/'+b.id+'\')"><td><span class="pus-code">'+esc(billNo(b))+'</span></td><td>'+esc(b.invoice_no)+'</td><td>'+U().dmy(b.invoice_date)+'</td><td class="pus-num">'+money(b.total_amount)+'</td><td>'+billTag(b)+'</td></tr>').join('');
  return '<div class="card" style="padding:0"><table class="tbl"><thead><tr><th>Bill</th><th>Invoice</th><th>Date</th><th class="pus-num">Total</th><th>Status</th></tr></thead><tbody>'+(rows||'<tr><td colspan="5"><div class="empty" style="padding:18px"><div>No bill booked against this order yet</div></div></td></tr>')+'</tbody></table></div>';
}
function eApproval(){
  const {o,steps}=CE, done=steps.filter(s=>s.status==='approved'||s.status==='rejected'), pend=steps.filter(s=>s.status==='pending'&&s.round===o.round&&o.status==='pending_approval');
  const doneRows=done.map(s=>'<tr><td>'+esc(uname(s.acted_by))+'</td><td>'+esc(profile(s.acted_by))+'</td><td>Level '+s.level+' ('+(s.status==='approved'?'Approved By':'Rejected By')+')</td><td>'+(s.status==='approved'?'Approve':'Reject')+'</td><td style="white-space:nowrap">'+U().dmyTime(s.acted_at)+'</td><td>'+esc(s.remark||'')+'</td></tr>').join('');
  const pendRows=pend.map(s=>s.approvers.map(e=>'<tr><td>'+esc(uname(e))+'</td><td>'+esc(profile(e))+'</td><td>Level '+s.level+' (Approval pending)</td></tr>').join('')).join('');
  return ro('Document No',o.doc_no||'Not submitted yet')
    +'<div class="card" style="padding:0;margin-top:6px"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Approved By</th><th>Profile</th><th>Action Information</th><th>Status</th><th>Date Time</th><th>Remarks</th></tr></thead><tbody>'+(doneRows||'<tr><td colspan="6"><div class="empty" style="padding:14px"><div>No decisions yet</div></div></td></tr>')+'</tbody></table></div></div>'
    +'<div class="card" style="padding:0;margin-top:14px"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Pending With</th><th>Profile</th><th>Action Information</th></tr></thead><tbody>'+(pendRows||'<tr><td colspan="3"><div class="empty" style="padding:14px"><div>Nothing pending</div></div></td></tr>')+'</tbody></table></div></div>';
}
window.pusEoSubmit=async function(id){
  const {data,error}=await U().PU().rpc('eo_submit',{p_id:id});
  if(U().fail(error,'Could not submit')) return;
  closeModal(); toast('Submitted as '+data,'ok'); navTo('inventory/7/orders/'+id);
};
window.pusEoDelete=async function(id){
  const pending=!!(CE&&CE.o.id===id&&CE.o.status==='pending_approval');
  if(!await confirmDialog(pending?'Delete this order? It is awaiting approval — the approvers will no longer see it. This cannot be undone.':'Delete this draft order?')) return;
  const {error}=await U().PU().rpc('eo_delete',{p_id:id});
  if(U().fail(error,'Delete failed')) return;
  closeModal(); toast(pending?'Order deleted':'Draft deleted','ok'); navTo('inventory/7/orders');
};
window.pusEoDecide=function(id,approve){
  openModal('<div class="modal-head"><h3>'+(approve?'Approve':'Reject')+' '+esc(eoNo(CE.o))+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm"><div class="pus-hint" style="margin-top:0">Total '+money(CE.o.total_amount)+' to '+esc(vName(CE.o.vendor_id))+' — '+esc(CE.o.subject)+'.</div><label>'+(approve?'Remark (optional)':'Reason for rejecting')+'</label><textarea id="paoNote" rows="3" placeholder="'+(approve?'':'The raiser sees this and can correct and resubmit')+'"></textarea></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusEoDecideSave('+id+','+approve+')">'+(approve?'Approve':'Reject')+'</button></div>');
};
window.pusEoDecideSave=async function(id,approve){
  const note=U().val('paoNote'); if(!approve&&!note){ toast('Give a reason for rejecting','err'); return; }
  const {data,error}=await U().PU().rpc('eo_decide',{p_id:id,p_approve:approve,p_remark:note||null});
  if(U().fail(error,approve?'Could not approve':'Could not reject')) return;
  closeModal(); toast(data==='approved'?'Approved — a bill can now be booked against it':data==='rejected'?'Rejected':'Approved — passed to the next level','ok'); route();
};
window.pusEoAsk=function(id,what){
  const close=what==='close';
  openModal('<div class="modal-head"><h3>'+(close?'Close order':'Cancel order')+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><div class="pus-hint" style="margin-top:0">'+(close?'No more bills can be booked against it. Bills already booked stay as they are.':'Only an order with no bill against it can be cancelled.')+'</div><label>Reason</label><textarea id="paoWhy" rows="3"></textarea></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Back</button><button class="btn btn-primary" onclick="pusEoAskSave('+id+',\''+what+'\')">'+(close?'Close order':'Cancel order')+'</button></div>');
};
window.pusEoAskSave=async function(id,what){
  const why=U().val('paoWhy'); if(!why){ toast('Give a reason','err'); return; }
  const {error}=await U().PU().rpc(what==='close'?'eo_close':'eo_cancel',{p_id:id,p_reason:why});
  if(U().fail(error,what==='close'?'Could not close':'Could not cancel')) return;
  closeModal(); toast(what==='close'?'Order closed':'Order cancelled','ok'); route();
};
window.pusEoBill=function(id){ const o=CE.o; closeModal(); window.pusBillForm({type:o.kind==='non_store'?'non_store':'service',orderId:id}); };
})();
