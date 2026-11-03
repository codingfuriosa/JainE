/* ============================ ACCOUNTS - LEDGERS & POSTINGS (tab 2) ============================
   Bill postings (Purchase bills, debit notes and Engineering RA bills become entries with GST, TDS and
   retention), the Post Sales flow (receipts as advance received from customers; only the GST of invoices),
   the chart of accounts, ledger opening balances (general, cost / custom ledgers and their sub-ledgers),
   ledger statements and the trial balance, and the posting-ledger rules.
   Shares window.ACX with accounts.js. Functions: supabase/migrations/20261005120000_accounts_postings_reports.sql.
   Routes: accounts/1/<postings|postsales|chart|openings|ledgers|rules>. The Audit tab (accounts/2) is at the end of this file. */
(function(){
if(window.__ACX_BOOKS_LOADED) return;
window.__ACX_BOOKS_LOADED=true;
const X=window.ACX; if(!X){ console.error('accounts-books.js needs accounts.js first'); return; }
const {S,AC,PU,num,r2,money,drcr,dmy,dmyTime,today,val,chk,fail,rpc,opt,opts,field,vtag,askReason,SRC_LABEL}=X;
const SECS=[['postings','Bill postings'],['postsales','Post Sales flow'],['chart','Chart of accounts'],['openings','Ledger opening'],['ledgers','Ledgers & trial balance'],['rules','Posting ledgers']];

window.acxBooksRender=function(host,seg){
  return X.shell(host,seg||[],1,SECS,'postings',{
    postings:renderPostings.bind(null,{sources:['purchase_bill','purchase_dn','ra_bill'],kind:'bills',title:'Bill postings',
      hint:'A bill booked in Purchase or Engineering waits here. Posting it makes the entries: the expense or work cost, input GST (CGST + SGST, or IGST), TDS payable, retention money on an RA bill, and the vendor’s account. Posted bills appear in Transactions › Bills & on-account.'}),
    postsales:renderPostings.bind(null,{sources:['ps_receipt','ps_invoice'],kind:'ps',title:'Post Sales flow',
      hint:'Money receipts from Post Sales are booked as advance received from customers (one account per booking). For invoices, only the GST is booked — the invoice value itself never enters Accounts.'}),
    chart:renderChart,openings:renderOpenings,ledgers:renderLedgers,rules:renderRules});
};

/* =================================================================== POSTINGS */
const NEEDS={purchase_bill:['vendor_control','purchases','input_cgst','input_sgst','input_igst','tds_payable'],purchase_dn:['vendor_control','purchase_return','input_cgst','input_sgst','input_igst'],
  ra_bill:['vendor_control','contractor_cost','input_cgst','input_sgst','input_igst','retention_payable','tds_payable','other_recoveries'],ps_receipt:['customer_advance','cash'],ps_invoice:['customer_advance','output_cgst','output_sgst','output_igst']};
const KEY_LABEL={cash:'Cash in hand',vendor_control:'Sundry creditors (vendors & contractors)',retention_payable:'Retention money payable',tds_payable:'TDS payable',input_cgst:'Input CGST',input_sgst:'Input SGST',input_igst:'Input IGST',
  output_cgst:'Output CGST',output_sgst:'Output SGST',output_igst:'Output IGST',customer_advance:'Advance received from customers',purchases:'Material purchases',contractor_cost:'Contractor / works cost',
  expense_default:'Other expenses (unclassified)',purchase_return:'Purchase returns',other_recoveries:'Recoveries from contractors'};
const PB={cfg:null,source:'',data:null,counts:{},posted:[],sel:new Set(),missing:[]};
const SRC_TITLE={purchase_bill:'Purchase bills',purchase_dn:'Debit notes',ra_bill:'RA bills (Engineering)',ps_receipt:'Receipts',ps_invoice:'Invoices (GST only)'};
const POST_FN={purchase_bill:'post_purchase_bill',purchase_dn:'post_debit_note',ra_bill:'post_ra_bill',ps_receipt:'post_ps_receipt',ps_invoice:'post_ps_invoice'};

async function renderPostings(cfg,host){
  PB.cfg=cfg; if(!cfg.sources.includes(PB.source)) PB.source=cfg.sources[0]; PB.sel=new Set();
  await pbLoad(host);
}
async function pbLoad(host){
  host=host||$('acxSec'); if(!host) return;
  const cfg=PB.cfg;
  const calls=cfg.sources.map(s=>rpc('pending_postings',{p_source:s,p_company:S.coId,p_limit:s===PB.source?400:1}));
  const [ready,counts,posted,...pend]=await Promise.all([rpc('company_readiness',{p_company:S.coId}),rpc('posting_counts',{p_company:S.coId}),
    AC().from('vouchers').select('id,doc_no,voucher_date,narration,amount,status,source_type,business_unit_id').eq('company_id',S.coId).eq('source_type',PB.source).eq('status','posted').order('voucher_date',{ascending:false}).order('id',{ascending:false}).limit(200),...calls]);
  const bad=[ready,counts,posted,...pend].find(r=>r.error); if(bad) throw bad.error;
  PB.missing=ready.data||[]; PB.counts=counts.data||{}; PB.posted=posted.data||[]; PB.pendAll={}; PB.supply='intra';
  if(cfg.kind==='ps'){ const st=await AC().from('settings').select('value').eq('company_id',S.coId).eq('key','customer_gst.supply').maybeSingle(); if(st.data&&st.data.value) PB.supply=st.data.value; }
  cfg.sources.forEach((s,i)=>PB.pendAll[s]=pend[i].data); PB.data=PB.pendAll[PB.source];
  pbDraw(host);
}
function pvLine(sign,label,amt){ return amt>0.004?'<span style="white-space:nowrap">'+sign+' <b>'+esc(label)+'</b> '+money(amt)+'</span>':''; }
function preview(src,r){
  const x=r.extra||{}; const j=a=>a.filter(Boolean).join(' · ');
  if(src==='purchase_bill') return j([pvLine('Dr',x.type==='goods'?'Purchases':'Expense',x.taxable),pvLine('Dr','Input GST',x.gst),pvLine('Cr','Vendor',r.amount-(x.tds||0)),pvLine('Cr','TDS payable',x.tds)]);
  if(src==='purchase_dn') return j([pvLine('Dr','Vendor',r.amount),pvLine('Cr','Purchase returns',x.taxable),pvLine('Cr','Input GST',x.gst)]);
  if(src==='ra_bill') return j([pvLine('Dr','Works cost',x.gross),pvLine('Dr','Input GST',x.gst),pvLine('Cr','Contractor',x.net),pvLine('Cr','Retention'+(x.retention_pct?' '+x.retention_pct+'%':''),x.retention),pvLine('Cr','TDS payable',x.tds),pvLine('Cr','Recoveries',x.other)]);
  if(src==='ps_receipt') return j([pvLine('Dr',x.account||MODE(x.mode),r.amount),pvLine('Cr','Customer advance',r.amount)]);
  if(src==='ps_invoice') return j([pvLine('Dr','Customer advance',r.amount),pvLine('Cr','Output GST',r.amount)])+'<div class="acx-hint">Invoice value '+money(x.total)+' is not booked here</div>';
  return '';
}
const MODE=m=>({cash:'Cash',cheque:'Bank (cheque)',dd:'Bank (DD)',net_banking:'Bank',transfer:'Bank',rtgs_neft_imps:'Bank',jv:'Adjustment'}[m]||'Bank');
function pbDraw(host){
  const cfg=PB.cfg, d=PB.data||{}, src=PB.source;
  const need=(NEEDS[src]||[]); const miss=PB.missing.filter(m=>need.includes(m.key));
  const rows=(d.rows||[]).map(r=>{
    const ok=!r.blocker, x=r.extra||{};
    return '<tr><td style="width:28px">'+(ok&&S.canPost?'<input type="checkbox" class="acx-chk" '+(PB.sel.has(r.id)?'checked':'')+' onchange="acxPbSel('+r.id+',this.checked)">':'')+'</td>'
      +'<td><span class="acx-code">'+esc(r.ref)+'</span>'+(x.invoice?'<div class="acx-hint">Invoice '+esc(x.invoice)+'</div>':'')+(x.wo?'<div class="acx-hint">'+esc(x.wo)+'</div>':'')+(x.hold?' <span class="tag t-amber">On hold</span>':'')+'</td>'
      +'<td style="white-space:nowrap">'+dmy(r.dt)+'</td><td>'+esc(r.party||'—')+'</td><td>'+esc(r.project||'—')+'</td><td class="acx-num"><b>'+money(r.amount)+'</b></td><td style="font-size:12.5px">'+preview(src,r)+'</td>'
      +'<td class="acx-act">'+(ok?(S.canPost?'<button class="btn btn-sm btn-primary" onclick="acxPbPost('+r.id+')">Post</button>':''):'<span class="tag t-amber" title="'+esc(r.blocker)+'">'+esc(r.blocker)+'</span>')+'</td></tr>';}).join('');
  const postedRows=PB.posted.map(v=>'<tr><td><span class="acx-code acx-link" onclick="acxVoucherOpen('+v.id+')">'+esc(v.doc_no)+'</span></td><td style="white-space:nowrap">'+dmy(v.voucher_date)+'</td><td>'+esc(v.narration||'')+'</td><td>'+esc(v.business_unit_id?X.buName(v.business_unit_id):'')+'</td>'
    +'<td class="acx-num"><b>'+money(v.amount)+'</b></td><td class="acx-act"><button class="btn btn-sm btn-ghost" onclick="acxVoucherOpen('+v.id+')">Entries</button>'+(S.canPost?'<button class="btn btn-sm btn-ghost" title="Reverse this posting" onclick="acxPbReverse('+v.id+')"><i class="fa-solid fa-rotate-left"></i></button>':'')+'</td></tr>').join('');
  const revRows=(d.reverse_rows||[]).map(r=>'<tr><td><span class="acx-code acx-link" onclick="acxVoucherOpen('+r.voucher_id+')">'+esc(r.voucher_no)+'</span></td><td>'+esc(r.ref||'')+'</td><td>'+dmy(r.dt)+'</td><td class="acx-num">'+money(r.amount)+'</td><td>'+esc(r.why)+'</td>'
    +'<td class="acx-act">'+(S.canPost?'<button class="btn btn-sm btn-danger" onclick="acxPbReverse('+r.voucher_id+')">Reverse</button>':'')+'</td></tr>').join('');
  const blockers=d.blockers||{};
  const chips=cfg.sources.map(s=>{const p=PB.pendAll[s]||{total:0,blocked:0};return '<span class="chip'+(s===src?' active':'')+'" onclick="acxPbSource(\''+s+'\')">'+SRC_TITLE[s]+' · '+(p.total-p.blocked)+' ready'+(p.blocked?' · '+p.blocked+' blocked':'')+(p.reverse?' · '+p.reverse+' to reverse':'')+'</span>';}).join('');
  const postedCount=PB.counts[src]||0;
  const ready=d.total-d.blocked;
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">'+esc(cfg.title)+'</div><div class="acx-hint" style="margin:0">'+esc(cfg.hint)+'</div></div></div>'
    +(miss.length?'<div class="acx-warn"><b>Set these posting ledgers first:</b> '+miss.map(m=>esc(m.label)).join(', ')+'. <span class="acx-link" onclick="navTo(\'accounts/1/rules\')">Open Posting ledgers →</span> (or load the standard chart under Transactions › Structure).</div>':'')
    +'<div class="acx-subs">'+chips+'</div>'
    +(cfg.kind==='ps'?psExplain():'')
    +'<div class="acx-kpis"><div class="acx-kpi"><div class="k">Ready to post</div><div class="v">'+ready+'</div></div><div class="acx-kpi"><div class="k">Blocked</div><div class="v">'+d.blocked+'</div><div class="s">need something set up first</div></div><div class="acx-kpi"><div class="k">Posted so far</div><div class="v">'+postedCount+'</div></div>'
      +(d.reverse?'<div class="acx-kpi"><div class="k">To reverse</div><div class="v" style="color:#b91c1c">'+d.reverse+'</div><div class="s">source cancelled after posting</div></div>':'')+'</div>'
    +(Object.keys(blockers).length?'<div class="acx-warn"><b>Why some are blocked:</b><ul style="margin:4px 0 0 18px;padding:0">'+Object.keys(blockers).map(k=>'<li>'+esc(k)+' — '+blockers[k]+'</li>').join('')+'</ul></div>':'')
    +(S.canPost?'<div class="acx-top"><button class="btn btn-primary" onclick="acxPbSelected()"><i class="fa-solid fa-check"></i> Post selected (<span id="pbSelN">'+PB.sel.size+'</span>)</button><button class="btn" onclick="acxPbAll()" '+(ready?'':'disabled')+'><i class="fa-solid fa-forward"></i> Post next '+Math.min(ready,300)+' ready</button>'
      +'<span class="acx-hint">Posting is not automatic: nothing reaches the ledgers until you post it.</span></div>':'')
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th></th><th>Reference</th><th>Date</th><th>'+(cfg.kind==='ps'?'Customer':'Vendor')+'</th><th>Project</th><th class="acx-num">'+(src==='ps_invoice'?'GST':'Amount')+'</th><th>Entries that will be made</th><th></th></tr></thead><tbody>'
    +(rows||'<tr><td colspan="8"><div class="empty" style="padding:24px"><div>Nothing is waiting to be posted</div></div></td></tr>')+'</tbody></table></div></div>'
    +(d.total>(d.rows||[]).length?'<div class="acx-hint" style="margin-top:6px">Showing the first '+(d.rows||[]).length+' of '+d.total+' (ready ones first).</div>':'')
    +(revRows?'<div class="acx-sec-title" style="color:#b91c1c">Posted, but the source has since been cancelled</div><div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl acx-mini"><thead><tr><th>Entry</th><th>Source</th><th>Date</th><th class="acx-num">Amount</th><th>Why</th><th></th></tr></thead><tbody>'+revRows+'</tbody></table></div></div>':'')
    +'<div class="acx-sec-title">Posted ('+(postedCount>PB.posted.length?'latest '+PB.posted.length+' of '+postedCount:postedCount)+')</div><div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl acx-mini"><thead><tr><th>Entry</th><th>Date</th><th>Narration</th><th>Business unit</th><th class="acx-num">Amount</th><th></th></tr></thead><tbody>'
    +(postedRows||'<tr><td colspan="6"><div class="empty" style="padding:18px"><div>Nothing posted yet</div></div></td></tr>')+'</tbody></table></div></div>';
}
function psExplain(){
  const co=X.curCo();
  return '<div class="card" style="padding:12px 16px;margin-bottom:14px"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;font-size:13px">'
    +'<div><b>Money receipt</b><div class="acx-hint">Dr Bank (or cash) · Cr Advance received from customers — a separate account for each booking. The bank account of the receipt must be linked to a ledger under <span class="acx-link" onclick="navTo(\'accounts/1/rules\')">Posting ledgers</span>.</div></div>'
    +'<div><b>Invoice</b><div class="acx-hint">Only the GST: Dr Advance from customers · Cr Output CGST + SGST (or IGST). Split for '+esc(co?co.name:'this company')+': <select id="psSupply" onchange="acxPsSupply()" '+(S.isAdmin?'':'disabled')+'><option value="intra"'+(PB.supply==='inter'?'':' selected')+'>CGST + SGST</option><option value="inter"'+(PB.supply==='inter'?' selected':'')+'>IGST</option></select></div></div></div></div>';
}
window.acxPsSupply=async function(){ const v=val('psSupply'); const {error}=await AC().from('settings').upsert({company_id:S.coId,key:'customer_gst.supply',value:v},{onConflict:'company_id,key'}); if(fail(error)) return; toast('Saved','ok'); };
window.acxPbSource=function(s){ PB.source=s; PB.sel=new Set(); pbLoad(); };
window.acxPbSel=function(id,on){ if(on) PB.sel.add(id); else PB.sel.delete(id); const n=$('pbSelN'); if(n) n.textContent=PB.sel.size; };
function batchResult(res){
  const r=res||{}; let msg=(r.posted||0)+' posted'+(r.failed?', '+r.failed+' failed':'');
  if(r.failed){ openModal('<div class="modal-head"><h3>'+esc(msg)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body"><div class="acx-hint" style="margin-bottom:8px">These could not be posted:</div><ul style="margin:0 0 0 18px;padding:0;font-size:13px">'
    +(r.errors||[]).map(e=>'<li><b>'+esc(e.ref||e.id)+'</b> — '+esc(e.error)+'</li>').join('')+'</ul></div><div class="modal-foot"><button class="btn" onclick="closeModal();route()">Close</button></div>'); return; }
  toast(msg,'ok'); route();
}
window.acxPbPost=async function(id){
  const {error}=await rpc(POST_FN[PB.source],{p_id:id}); if(fail(error,'Could not post')) return; toast('Posted','ok'); pbLoad();
};
window.acxPbSelected=async function(){
  const ids=[...PB.sel]; if(!ids.length){ toast('Tick the ones to post','err'); return; }
  const {data,error}=await rpc('post_batch',{p_source:PB.source,p_company:S.coId,p_ids:ids,p_limit:300}); if(fail(error,'Could not post')) return; batchResult(data);
};
window.acxPbAll=async function(){
  if(!await confirmDialog('Post the next batch (up to 300) of ready '+SRC_TITLE[PB.source].toLowerCase()+' to the ledgers?',{danger:false,okLabel:'Post'})) return;
  const {data,error}=await rpc('post_batch',{p_source:PB.source,p_company:S.coId,p_limit:300}); if(fail(error,'Could not post')) return; batchResult(data);
};
window.acxPbReverse=async function(vid){
  const reason=await askReason('Reverse this posting','Why? The source document is released so it can be corrected and posted again.','Reverse'); if(!reason) return;
  const {error}=await rpc('reverse_posting',{p_voucher_id:vid,p_reason:reason}); if(fail(error,'Could not reverse')) return; toast('Posting reversed','ok'); pbLoad();
};

/* =================================================================== CHART OF ACCOUNTS */
const CH={q:'',inactive:false};
async function renderChart(host){
  const adm=S.isAdmin;
  const hasChart=S.groups.length>0;
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">Chart of accounts</div><div class="acx-hint" style="margin:0">Groups and ledgers of '+esc((X.curCo()||{}).name||'')+'. General ledgers carry the balances; cost and custom ledgers are analytical ledgers that voucher lines can be tagged to. Vendors and customers sit as sub-ledgers under a control ledger.</div></div>'
    +(S.canPost?'<button class="btn" onclick="acxLedgerForm(0,\'general\')"><i class="fa-solid fa-plus"></i> Ledger</button><button class="btn" onclick="acxLedgerForm(0,\'cost\')"><i class="fa-solid fa-plus"></i> Cost / custom ledger</button>':'')
    +(adm?'<button class="btn" onclick="acxGroupForm()"><i class="fa-solid fa-plus"></i> Group</button>':'')+'</div>'
    +(!hasChart?'<div class="card"><div class="empty" style="padding:28px"><i class="fa-solid fa-list-check"></i><div>No chart of accounts yet.</div>'+(adm?'<div style="margin-top:10px"><button class="btn btn-primary" onclick="acxSeedChart('+S.coId+')">Load the standard chart</button></div>':'<div class="acx-hint">Ask an Accounts administrator to load it.</div>')+'</div></div>':'')
    +(hasChart?'<div class="acx-top"><input class="grow" id="chQ" placeholder="Search ledgers" value="'+esc(CH.q)+'" oninput="acxChSearch()"><label class="acx-hint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="chInact" '+(CH.inactive?'checked':'')+' onchange="acxChSearch()"> Show inactive</label>'+X.dlBtns('acxChartDownload')+'</div><div id="chBody"></div>':'');
  if(hasChart) chDraw();
}
window.acxChSearch=function(){ CH.q=val('chQ'); CH.inactive=chk('chInact'); chDraw(); const e=$('chQ'); if(e){ e.focus(); e.setSelectionRange(e.value.length,e.value.length); } };
function chDraw(){
  const body=$('chBody'); if(!body) return; const q=CH.q.toLowerCase();
  const led=l=>(CH.inactive||l.active)&&(!q||(l.name+' '+l.code+' '+(l.bank_name||'')).toLowerCase().includes(q));
  const gl=S.ledgers.filter(l=>l.ledger_type==='general'&&led(l));
  const kids=pid=>S.groups.filter(g=>(g.parent_id||null)===pid).sort((a,b)=>(a.sort_order-b.sort_order)||a.name.localeCompare(b.name));
  const hasLed=gid=>{ if(gl.some(l=>l.group_id===gid)) return true; return kids(gid).some(g=>hasLed(g.id)); };
  const NAT={asset:'Asset',liability:'Liability',income:'Income',expense:'Expense'};
  let rows='';
  const ledRow=(l,depth)=>'<tr><td style="padding-left:'+(16+depth*18)+'px"><i class="fa-solid fa-book" style="color:#94a3b8;margin-right:6px"></i><b>'+esc(l.name)+'</b>'+(l.active?'':' <span class="tag t-gray">Inactive</span>')+'</td><td><span class="acx-code">'+esc(l.code)+'</span></td>'
    +'<td>'+(l.is_bank?'<span class="tag t-blue">Bank</span> ':'')+(l.is_cash?'<span class="tag t-blue">Cash</span> ':'')+(l.sub_ledger_type?'<span class="acx-pill">sub-ledgers: '+esc(l.sub_ledger_type)+'</span> ':'')+(l.system_key?'<span class="tag t-purple" title="Used by automatic postings">'+esc(KEY_LABEL[l.system_key]||l.system_key)+'</span> ':'')+(l.ps_bank_account_id?'<span class="acx-pill">Post Sales a/c linked</span>':'')
    +(l.bank_name?'<div class="acx-hint">'+esc(l.bank_name)+(l.account_no?' · '+esc(l.account_no):'')+(l.ifsc?' · '+esc(l.ifsc):'')+'</div>':'')+'</td>'
    +'<td class="acx-act">'+(l.sub_ledger_type?'<button class="btn btn-sm btn-ghost" title="Sub-ledgers" onclick="acxSubsOpen('+l.id+')"><i class="fa-solid fa-users"></i></button>':'')+(S.canPost?'<button class="btn btn-sm btn-ghost" title="Edit" onclick="acxLedgerForm('+l.id+')"><i class="fa-solid fa-pen"></i></button>':'')+'</td></tr>';
  const walk=(g,depth)=>{
    if(!hasLed(g.id)&&q) return;
    rows+='<tr style="background:#f8fafc"><td colspan="3" style="padding-left:'+(10+depth*18)+'px"><i class="fa-solid fa-folder" style="color:#0e7490;margin-right:6px"></i><b>'+esc(g.name)+'</b> <span class="acx-hint">'+NAT[g.nature]+'</span></td><td class="acx-act">'+(S.isAdmin?'<button class="btn btn-sm btn-ghost" title="Edit group" onclick="acxGroupForm('+g.id+')"><i class="fa-solid fa-pen"></i></button>':'')+'</td></tr>';
    gl.filter(l=>l.group_id===g.id).forEach(l=>{ rows+=ledRow(l,depth+1); });
    kids(g.id).forEach(k=>walk(k,depth+1));
  };
  kids(null).forEach(g=>walk(g,0));
  const cc=S.ledgers.filter(l=>l.ledger_type!=='general'&&led(l));
  body.innerHTML='<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Group / ledger</th><th>Code</th><th>Details</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div></div>'
    +'<div class="acx-sec-title">Cost and custom ledgers</div><div class="acx-hint" style="margin-bottom:8px">Analytical ledgers — tag a voucher line to one (and to one of its sub-ledgers) to see cost to date by head, block, contractor or any other custom dimension. They are outside the trial balance.</div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Ledger</th><th>Code</th><th>Details</th><th></th></tr></thead><tbody>'
    +(cc.map(l=>'<tr><td><i class="fa-solid fa-diagram-successor" style="color:#94a3b8;margin-right:6px"></i><b>'+esc(l.name)+'</b>'+(l.active?'':' <span class="tag t-gray">Inactive</span>')+'</td><td><span class="acx-code">'+esc(l.code)+'</span></td><td><span class="tag t-gray">'+(l.ledger_type==='cost'?'Cost ledger':'Custom ledger')+'</span> '+(l.sub_ledger_type?'<span class="acx-pill">sub-ledgers: '+esc(l.sub_ledger_type)+'</span>':'')+'</td>'
      +'<td class="acx-act"><button class="btn btn-sm btn-ghost" title="Sub-ledgers" onclick="acxSubsOpen('+l.id+')"><i class="fa-solid fa-users"></i></button>'+(S.canPost?'<button class="btn btn-sm btn-ghost" title="Edit" onclick="acxLedgerForm('+l.id+')"><i class="fa-solid fa-pen"></i></button>':'')+'</td></tr>').join('')||'<tr><td colspan="4"><div class="empty" style="padding:18px"><div>None yet</div></div></td></tr>')+'</tbody></table></div></div>';
}
window.acxChartDownload=function(fmt,btn){
  const gn=id=>X.groupName(id), TL={general:'General',cost:'Cost',custom:'Custom'}, co=X.curCo()||{};
  X.download(fmt,{title:'Chart of accounts',file:'Chart_of_accounts_'+(co.short_code||''),
    sub:(co.name||'')+' · '+S.ledgers.length+' ledgers (including inactive ones)',
    cols:[{h:'Code'},{h:'Ledger'},{h:'Type'},{h:'Group'},{h:'Sub-ledgers'},{h:'Bank'},{h:'Cash'},{h:'Role in automatic postings'},{h:'Active'}],
    rows:S.ledgers.slice().sort((a,b)=>String(a.code).localeCompare(String(b.code))).map(l=>[l.code,l.name,TL[l.ledger_type]||l.ledger_type,gn(l.group_id),l.sub_ledger_type||'',l.is_bank?'Yes':'',l.is_cash?'Yes':'',l.system_key?(KEY_LABEL[l.system_key]||l.system_key):'',l.active?'Yes':'No'])},btn);
};
function groupOpts(sel,exclude){
  const out=[]; const walk=(pid,d)=>S.groups.filter(g=>(g.parent_id||null)===pid).sort((a,b)=>(a.sort_order-b.sort_order)||a.name.localeCompare(b.name)).forEach(g=>{ if(g.id!==exclude){ out.push(opt(g.id,'  '.repeat(d)+g.name,sel)); walk(g.id,d+1);} });
  walk(null,0); return out.join('');
}
window.acxGroupForm=function(id){
  const g=id?S.groups.find(x=>x.id===id):{name:'',parent_id:'',nature:'asset',sort_order:0};
  X.formModal(id?'Edit group':'New group',field('Group name','<input id="gName" value="'+esc(g.name)+'">')
    +'<div class="acx-grid2">'+field('Under','<select id="gParent" onchange="acxGParent()">'+opt('','— a top-level group —',g.parent_id||'')+groupOpts(g.parent_id,id)+'</select>')
    +field('Nature','<select id="gNature" '+(g.parent_id?'disabled':'')+'>'+opts([['asset','Asset'],['liability','Liability'],['income','Income'],['expense','Expense']],g.nature)+'</select><div class="h">A sub-group takes the nature of its parent</div>')+'</div>'
    +field('Sort order','<input id="gSort" inputmode="numeric" value="'+esc(g.sort_order||0)+'">'),'acxGroupSave('+(id||0)+')');
};
window.acxGParent=function(){ const p=parseInt(val('gParent'),10); const n=$('gNature'); if(!n) return; if(p){ const pg=S.groups.find(x=>x.id===p); if(pg) n.value=pg.nature; n.disabled=true; } else n.disabled=false; };
window.acxGroupSave=async function(id){
  const row={company_id:S.coId,name:val('gName'),parent_id:val('gParent')?parseInt(val('gParent'),10):null,nature:val('gNature'),sort_order:parseInt(val('gSort'),10)||0};
  if(!row.name){ toast('Enter the group name','err'); return; }
  if(row.parent_id){ const pg=S.groups.find(x=>x.id===row.parent_id); if(pg) row.nature=pg.nature; }
  const {error}=id?await AC().from('account_groups').update(row).eq('id',id):await AC().from('account_groups').insert(row); if(fail(error)) return; closeModal(); toast('Saved','ok'); route();
};
let PSB=null;
window.acxLedgerForm=async function(id,type){
  const l=id?X.ledgerById(id):{ledger_type:type||'general',name:'',code:'',group_id:'',sub_ledger_type:'',is_bank:false,is_cash:false,bank_name:'',account_no:'',ifsc:'',ps_bank_account_id:'',active:true};
  const isGen=l.ledger_type==='general';
  if(isGen&&PSB===null){ const {data}=await sb.schema('postsales').from('bank_accounts').select('id,name,bank_name,active').order('id'); PSB=data||[]; }
  const label={general:'General ledger',cost:'Cost ledger',custom:'Custom ledger'};
  X.formModal(id?'Edit ledger':'New '+(isGen?'ledger':'cost / custom ledger'),
    '<div class="acx-grid2">'+field('Ledger name','<input id="lName" value="'+esc(l.name)+'">')+field('Code','<input id="lCode" value="'+esc(l.code)+'" placeholder="Automatic"><div class="h">Leave blank for an automatic code</div>')+'</div>'
    +'<div class="acx-grid2">'+(isGen?field('Type','<div style="height:38px;display:flex;align-items:center"><span class="tag t-blue">General ledger</span></div>'):field('Type','<select id="lType">'+opts([['cost','Cost ledger'],['custom','Custom ledger']],l.ledger_type)+'</select>'))
      +(isGen?field('Group','<select id="lGroup">'+opt('','Choose group…',l.group_id)+groupOpts(l.group_id)+'</select>'):field('Sub-ledger type','<select id="lSubType">'+opts([['','No sub-ledgers'],['vendor','Vendor / contractor'],['customer','Customer'],['employee','Employee'],['other','Other']],l.sub_ledger_type||'')+'</select>'))+'</div>'
    +(isGen?'<div class="acx-grid2">'+field('Sub-ledgers','<select id="lSubType">'+opts([['','No sub-ledgers'],['vendor','Vendor / contractor'],['customer','Customer'],['employee','Employee'],['other','Other']],l.sub_ledger_type||'')+'</select><div class="h">When set, every voucher line on this ledger must name a sub-ledger</div>')
      +field('Kind','<label style="display:flex;gap:8px;align-items:center;height:20px"><input type="checkbox" id="lBank" '+(l.is_bank?'checked':'')+' onchange="acxLBank()"> Bank account</label><label style="display:flex;gap:8px;align-items:center;height:20px"><input type="checkbox" id="lCash" '+(l.is_cash?'checked':'')+' onchange="acxLCash()"> Cash in hand / cheques in hand</label>')+'</div>'
      +'<div id="lBankBox" style="display:'+(l.is_bank?'block':'none')+'"><div class="acx-grid3">'+field('Bank','<input id="lBankName" value="'+esc(l.bank_name||'')+'">')+field('Account no','<input id="lAcc" value="'+esc(l.account_no||'')+'">')+field('IFSC','<input id="lIfsc" value="'+esc(l.ifsc||'')+'" style="text-transform:uppercase">')+'</div></div>'
      +field('Post Sales account linked to this ledger','<select id="lPs">'+opt('','Not linked',l.ps_bank_account_id||'')+(PSB||[]).map(b=>opt(b.id,b.name+(b.active?'':' (inactive)'),l.ps_bank_account_id)).join('')+'</select><div class="h">Customer receipts from that account in Post Sales are booked to this ledger. Use it for bank accounts and for adjustment accounts like “TDS receivable”.</div>'):'')
    +(id?'<div class="acx-field"><label><input type="checkbox" id="lActive" '+(l.active?'checked':'')+'> Active</label></div>':'')
    +(l.system_key?'<div class="acx-hint">This ledger plays the role “'+esc(KEY_LABEL[l.system_key]||l.system_key)+'” in automatic postings.</div>':''),'acxLedgerSave('+(id||0)+',\''+(isGen?'general':'x')+'\')','lg');
};
window.acxLBank=function(){ if(chk('lBank')){ $('lCash').checked=false; } $('lBankBox').style.display=chk('lBank')?'block':'none'; };
window.acxLCash=function(){ if(chk('lCash')){ $('lBank').checked=false; $('lBankBox').style.display='none'; } };
window.acxLedgerSave=async function(id,kind){
  const gen=kind==='general';
  const row={company_id:S.coId,name:val('lName'),code:val('lCode')||'',ledger_type:gen?'general':val('lType'),sub_ledger_type:val('lSubType')||null};
  if(!row.name){ toast('Enter the ledger name','err'); return; }
  if(gen){
    row.group_id=val('lGroup')?parseInt(val('lGroup'),10):null; if(!row.group_id){ toast('Choose the group','err'); return; }
    row.is_bank=chk('lBank'); row.is_cash=chk('lCash'); row.bank_name=row.is_bank?(val('lBankName')||null):null; row.account_no=row.is_bank?(val('lAcc')||null):null; row.ifsc=row.is_bank?(val('lIfsc').toUpperCase()||null):null;
    const ps=val('lPs')?parseInt(val('lPs'),10):null;
    if(ps){ const r=await AC().from('ledgers').update({ps_bank_account_id:null}).eq('ps_bank_account_id',ps).neq('id',id||0); if(fail(r.error)) return; }
    row.ps_bank_account_id=ps;
  }
  if(id) row.active=chk('lActive');
  if(!id) delete row.active;
  const {error}=id?await AC().from('ledgers').update(row).eq('id',id):await AC().from('ledgers').insert(row); if(fail(error)) return;
  closeModal(); toast('Saved','ok'); route();
};
window.acxSubsOpen=async function(ledgerId){
  const l=X.ledgerById(ledgerId); openModal('<div class="modal-body"><div class="loader"><div class="spin"></div></div></div>');
  const {data,error}=await AC().from('sub_ledgers').select('*').eq('ledger_id',ledgerId).order('name').limit(1500); if(error){ closeModal(); fail(error,'Could not load'); return; }
  const auto=l.sub_ledger_type==='vendor'||l.sub_ledger_type==='customer';
  openModal('<div class="modal-head"><h3>Sub-ledgers of '+esc(l.name)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body">'
    +'<div class="acx-hint" style="margin-bottom:8px">'+(auto?'Vendors and customers get their sub-ledger automatically when a bill, payment or customer receipt is posted. You can also add one by hand.':'Add the sub-ledgers you need.')+' '+(data.length>=1500?'Showing the first 1,500.':'')+'</div>'
    +'<div class="acx-top"><input class="grow" id="subNew" placeholder="New sub-ledger name"><button class="btn btn-primary" onclick="acxSubAdd('+ledgerId+')">Add</button></div>'
    +'<div class="card" style="padding:0;max-height:50vh;overflow:auto"><table class="tbl acx-mini"><thead><tr><th>Name</th><th>From</th><th>Active</th></tr></thead><tbody>'
    +(data.map(s=>'<tr><td>'+esc(s.name)+'</td><td>'+(s.party_type?'<span class="acx-pill">'+esc(s.party_type)+'</span>':'—')+'</td><td><input type="checkbox" class="acx-chk" '+(s.active?'checked':'')+' '+(S.canPost?'':'disabled')+' onchange="acxSubActive('+s.id+',this.checked)"></td></tr>').join('')||'<tr><td colspan="3"><div class="empty" style="padding:16px"><div>None yet</div></div></td></tr>')+'</tbody></table></div></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>');
};
window.acxSubAdd=async function(ledgerId){
  const name=val('subNew'); if(!name){ toast('Enter a name','err'); return; }
  const {error}=await AC().from('sub_ledgers').insert({ledger_id:ledgerId,name}); if(fail(error,'Could not add')) return; delete S.subCache[ledgerId]; toast('Added','ok'); acxSubsOpen(ledgerId);
};
window.acxSubActive=async function(id,on){ const {error}=await AC().from('sub_ledgers').update({active:on}).eq('id',id); if(fail(error)) return; S.subCache={}; };

/* =================================================================== LEDGER OPENING */
const OP={rows:[],subs:{},bu:''};
async function renderOpenings(host){
  const co=X.curCo(); OP.bu=S.buId||'';
  let q=AC().from('opening_balances').select('*').eq('company_id',S.coId).limit(8000);
  q=OP.bu?q.eq('business_unit_id',OP.bu):q.is('business_unit_id',null);
  const {data,error}=await q; if(error) throw error; OP.rows=data||[];
  const subIds=[...new Set(OP.rows.map(r=>r.sub_ledger_id).filter(Boolean))]; OP.subs={};
  if(subIds.length){ for(let i=0;i<subIds.length;i+=400){ const {data:sl}=await AC().from('sub_ledgers').select('id,name,ledger_id').in('id',subIds.slice(i,i+400)); (sl||[]).forEach(s=>OP.subs[s.id]=s); } }
  opDraw(host,co);
}
const opKey=(l,s)=>l+'_'+(s||0);
function opRow(ledgerId,subId){ return OP.rows.find(r=>r.ledger_id===ledgerId&&(r.sub_ledger_id||null)===(subId||null)); }
function opDraw(host,co){
  host=host||$('acxSec'); co=co||X.curCo();
  const ledTot=lid=>OP.rows.filter(r=>r.ledger_id===lid).reduce((a,r)=>[a[0]+Number(r.dr),a[1]+Number(r.cr)],[0,0]);
  const gen=S.ledgers.filter(l=>l.ledger_type==='general'&&(l.active||ledTot(l.id)[0]||ledTot(l.id)[1])); const cc=S.ledgers.filter(l=>l.ledger_type!=='general'&&(l.active||ledTot(l.id)[0]||ledTot(l.id)[1]));
  const sumDr=gen.reduce((s,l)=>s+ledTot(l.id)[0],0), sumCr=gen.reduce((s,l)=>s+ledTot(l.id)[1],0), diff=r2(sumDr-sumCr);
  const order={asset:1,liability:2,income:3,expense:4};
  const gOf=l=>S.groups.find(g=>g.id===l.group_id)||{name:'',nature:'expense'};
  gen.sort((a,b)=>(order[gOf(a).nature]||9)-(order[gOf(b).nature]||9)||gOf(a).name.localeCompare(gOf(b).name)||a.name.localeCompare(b.name));
  const input=(l,sid,kind,v)=>'<input class="n" inputmode="decimal" id="op_'+kind+'_'+opKey(l.id,sid)+'" value="'+(v>0?esc(v):'')+'" '+(S.canPost?'':'disabled')+' onchange="acxOpSave('+l.id+','+(sid||0)+')" style="width:140px;height:32px;border:1px solid var(--line);border-radius:6px;padding:0 8px;text-align:right">';
  const line=l=>{ const t=ledTot(l.id), r=opRow(l.id,null);
    return '<tr><td><b>'+esc(l.name)+'</b><div class="acx-hint">'+esc(gOf(l).name)+(l.sub_ledger_type?' · sub-ledgers':'')+'</div></td>'
      +(l.sub_ledger_type?'<td class="acx-num">'+(t[0]>0?money(t[0]):'')+'</td><td class="acx-num">'+(t[1]>0?money(t[1]):'')+'</td><td class="acx-act"><button class="btn btn-sm" onclick="acxOpSubs('+l.id+')">Sub-ledgers…</button></td>'
        :'<td class="acx-num">'+input(l,0,'d',r?Number(r.dr):0)+'</td><td class="acx-num">'+input(l,0,'c',r?Number(r.cr):0)+'</td><td></td>')+'</tr>'; };
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">Ledger opening</div><div class="acx-hint" style="margin:0">Opening balances of '+esc(co.name)+' as at <b>'+dmy(co.books_start)+'</b>'+(OP.bu?' — for the business unit <b>'+esc(X.buName(parseInt(OP.bu,10)))+'</b> only':' — at company level')+'. Choose a business unit above to enter its openings separately. Ledgers with sub-ledgers (vendors, customers) take their opening against each sub-ledger.</div></div></div>'
    +'<div class="acx-kpis"><div class="acx-kpi"><div class="k">Total debit</div><div class="v">'+money(sumDr)+'</div></div><div class="acx-kpi"><div class="k">Total credit</div><div class="v">'+money(sumCr)+'</div></div>'
    +'<div class="acx-kpi"><div class="k">Difference</div><div class="v" style="color:'+(Math.abs(diff)<0.005?'#15803d':'#b91c1c')+'">'+(Math.abs(diff)<0.005?'Tallies ✔':drcr(diff))+'</div><div class="s">general ledgers, this scope</div></div></div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>General ledger</th><th class="acx-num">Debit</th><th class="acx-num">Credit</th><th></th></tr></thead><tbody>'+(gen.map(line).join('')||'<tr><td colspan="4"><div class="empty" style="padding:18px"><div>No ledgers yet</div></div></td></tr>')+'</tbody></table></div></div>'
    +'<div class="acx-sec-title">Cost and custom ledgers</div><div class="acx-hint" style="margin-bottom:8px">Cost brought forward by head (outside the trial balance, so they need not tally).</div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Ledger</th><th class="acx-num">Debit</th><th class="acx-num">Credit</th><th></th></tr></thead><tbody>'+(cc.map(line).join('')||'<tr><td colspan="4"><div class="empty" style="padding:18px"><div>None</div></div></td></tr>')+'</tbody></table></div></div>';
}
window.acxOpSave=async function(ledgerId,subId){
  subId=subId||null; const dv=r2(num(val('op_d_'+opKey(ledgerId,subId)))), cv=r2(num(val('op_c_'+opKey(ledgerId,subId))));
  const ex=opRow(ledgerId,subId);
  if(dv>0&&cv>0){ toast('Enter either a debit or a credit balance, not both','err'); return; }
  let error;
  if(dv===0&&cv===0){ if(!ex) return; ({error}=await AC().from('opening_balances').delete().eq('id',ex.id)); if(!fail(error,'Could not clear')) OP.rows=OP.rows.filter(r=>r.id!==ex.id); }
  else if(ex){ ({error}=await AC().from('opening_balances').update({dr:dv,cr:cv}).eq('id',ex.id)); if(!fail(error)) { ex.dr=dv; ex.cr=cv; } }
  else{ const r=await AC().from('opening_balances').insert({company_id:S.coId,ledger_id:ledgerId,sub_ledger_id:subId,business_unit_id:OP.bu?parseInt(OP.bu,10):null,dr:dv,cr:cv}).select('*').single(); error=r.error; if(!fail(error)) OP.rows.push(r.data); }
  if(error) return; if($('opSubBody')) opSubDraw(OPS.ledger); else opDraw();
};
let OPS={ledger:0,subList:[]};
window.acxOpSubs=async function(ledgerId){
  OPS.ledger=ledgerId; openModal('<div class="modal-body"><div class="loader"><div class="spin"></div></div></div>','lg');
  const {data,error}=await AC().from('sub_ledgers').select('id,name,party_type,party_id,active').eq('ledger_id',ledgerId).order('name').limit(3000); if(error){ closeModal(); fail(error,'Could not load'); return; }
  OPS.subList=data||[]; (data||[]).forEach(s=>OP.subs[s.id]=Object.assign(OP.subs[s.id]||{},s)); opSubDraw(ledgerId);
};
function opSubDraw(ledgerId){
  const l=X.ledgerById(ledgerId); const q=($('opSubQ')?val('opSubQ'):'').toLowerCase();
  const withOb=new Set(OP.rows.filter(r=>r.ledger_id===ledgerId&&r.sub_ledger_id).map(r=>r.sub_ledger_id));
  const list=OPS.subList.filter(s=>(withOb.has(s.id)||q)&&(!q||s.name.toLowerCase().includes(q))).slice(0,300);
  const inp=(s,kind,v)=>'<input class="n" inputmode="decimal" id="op_'+kind+'_'+opKey(ledgerId,s.id)+'" value="'+(v>0?esc(v):'')+'" '+(S.canPost?'':'disabled')+' onchange="acxOpSave('+ledgerId+','+s.id+')" style="width:130px;height:32px;border:1px solid var(--line);border-radius:6px;padding:0 8px;text-align:right">';
  const tot=OP.rows.filter(r=>r.ledger_id===ledgerId).reduce((a,r)=>[a[0]+Number(r.dr),a[1]+Number(r.cr)],[0,0]);
  const vendorAdd=l.sub_ledger_type==='vendor'?'<select id="opVendor" class="grow" style="height:36px;border:1px solid var(--line);border-radius:8px;padding:0 10px"><option value="">Add an opening for a vendor…</option>'+S.vendors.map(v=>opt(v.id,(v.trade_name||v.legal_name)+' ('+v.code+')')).join('')+'</select><button class="btn" onclick="acxOpAddVendor('+ledgerId+')">Add</button>':'';
  openModal('<div class="modal-head"><h3>Opening balances — '+esc(l.name)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body"><div id="opSubBody">'
    +'<div class="acx-hint" style="margin-bottom:8px">Total opening: Dr '+money(tot[0])+' · Cr '+money(tot[1])+'. Type a name to find a sub-ledger that has no opening yet.</div>'
    +'<div class="acx-top"><input class="grow" id="opSubQ" placeholder="Search a sub-ledger to give it an opening balance" value="'+esc(q)+'" oninput="acxOpSubSearch()">'+vendorAdd
    +(S.canPost?'<input id="opSubNew" placeholder="Or a new sub-ledger name" style="height:36px;border:1px solid var(--line);border-radius:8px;padding:0 10px"><button class="btn" onclick="acxOpAddNew('+ledgerId+')">Add new</button>':'')+'</div>'
    +'<div class="card" style="padding:0;max-height:48vh;overflow:auto"><table class="tbl acx-mini"><thead><tr><th>Sub-ledger</th><th class="acx-num">Debit</th><th class="acx-num">Credit</th></tr></thead><tbody>'
    +(list.map(s=>'<tr><td>'+esc(s.name)+'</td><td class="acx-num">'+inp(s,'d',(opRow(ledgerId,s.id)||{dr:0}).dr)+'</td><td class="acx-num">'+inp(s,'c',(opRow(ledgerId,s.id)||{cr:0}).cr)+'</td></tr>').join('')||'<tr><td colspan="3"><div class="empty" style="padding:16px"><div>No sub-ledger has an opening balance yet</div></div></td></tr>')+'</tbody></table></div></div></div><div class="modal-foot"><button class="btn btn-primary" onclick="closeModal();acxOpDone()">Done</button></div>','lg');
  if(q){ const e=$('opSubQ'); if(e){ e.focus(); e.setSelectionRange(e.value.length,e.value.length); } }
}
window.acxOpDone=function(){ opDraw(); };
window.acxOpSubSearch=function(){ opSubDraw(OPS.ledger); };
window.acxOpAddVendor=async function(ledgerId){
  const vid=parseInt(val('opVendor'),10); if(!vid){ toast('Choose a vendor','err'); return; }
  const v=S.vendors.find(x=>x.id===vid); const name=(v.trade_name||v.legal_name)+' ('+v.code+')';
  let {data}=await AC().from('sub_ledgers').select('id,name,party_type,party_id,active').eq('ledger_id',ledgerId).eq('party_type','vendor').eq('party_id',vid).maybeSingle();
  if(!data){ const r=await AC().from('sub_ledgers').insert({ledger_id:ledgerId,name,party_type:'vendor',party_id:vid}).select('id,name,party_type,party_id,active').single(); if(fail(r.error,'Could not add')) return; data=r.data; }
  if(!OPS.subList.find(s=>s.id===data.id)) OPS.subList.push(data); OP.subs[data.id]=data;
  // an empty opening row makes it show up
  if(!opRow(ledgerId,data.id)){ const r=await AC().from('opening_balances').insert({company_id:S.coId,ledger_id:ledgerId,sub_ledger_id:data.id,business_unit_id:OP.bu?parseInt(OP.bu,10):null,dr:0,cr:0}).select('*').single(); if(!r.error) OP.rows.push(r.data); }
  opSubDraw(ledgerId);
};
window.acxOpAddNew=async function(ledgerId){
  const name=val('opSubNew'); if(!name){ toast('Enter a name','err'); return; }
  const r=await AC().from('sub_ledgers').insert({ledger_id:ledgerId,name}).select('id,name,party_type,party_id,active').single(); if(fail(r.error,'Could not add')) return;
  OPS.subList.push(r.data); OP.subs[r.data.id]=r.data; delete S.subCache[ledgerId];
  const o=await AC().from('opening_balances').insert({company_id:S.coId,ledger_id:ledgerId,sub_ledger_id:r.data.id,business_unit_id:OP.bu?parseInt(OP.bu,10):null,dr:0,cr:0}).select('*').single(); if(!o.error) OP.rows.push(o.data);
  opSubDraw(ledgerId);
};

/* =================================================================== LEDGERS, SUB-LEDGERS, TRIAL BALANCE */
const LG={view:'statement',ledger:'',sub:'',from:'',to:'',data:null,tb:null,subs:null,asOn:''};
async function renderLedgers(host){
  const co=X.curCo(); if(!LG.from) LG.from=co.books_start>X.fyStart(today())?co.books_start:X.fyStart(today()); if(!LG.to) LG.to=today(); if(!LG.asOn) LG.asOn=today();
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">Ledgers & trial balance</div><div class="acx-hint" style="margin:0">Statements of general ledgers, cost / custom ledgers and their sub-ledgers, and the trial balance. Use the business unit above to see one unit only. Balances: Dr = debit, Cr = credit.</div></div></div>'
    +'<div class="acx-subs">'+[['statement','Ledger statement'],['subs','Sub-ledger balances'],['tb','Trial balance']].map(v=>'<span class="chip'+(LG.view===v[0]?' active':'')+'" onclick="acxLgView(\''+v[0]+'\')">'+v[1]+'</span>').join('')+'</div><div id="lgBody"></div>';
  await lgDraw();
}
window.acxLgView=function(v){ LG.view=v; LG.data=null; renderLedgers($('acxSec')); };
function ledgerPick(sel,onlySub){
  const gen=S.ledgers.filter(l=>l.ledger_type==='general'&&(!onlySub||l.sub_ledger_type)), cc=S.ledgers.filter(l=>l.ledger_type!=='general'&&(!onlySub||l.sub_ledger_type));
  const byG={}; gen.forEach(l=>{(byG[l.group_id]=byG[l.group_id]||[]).push(l);});
  const ord={asset:1,liability:2,income:3,expense:4};
  const gs=S.groups.filter(g=>byG[g.id]).sort((a,b)=>(ord[a.nature]||9)-(ord[b.nature]||9)||a.name.localeCompare(b.name));
  return opt('','Choose a ledger…',sel)+gs.map(g=>'<optgroup label="'+esc(g.name)+'">'+byG[g.id].sort((a,b)=>a.name.localeCompare(b.name)).map(l=>opt(l.id,l.name+(l.active?'':' (inactive)'),sel)).join('')+'</optgroup>').join('')
    +(cc.length?'<optgroup label="Cost and custom ledgers">'+cc.map(l=>opt(l.id,l.name,sel)).join('')+'</optgroup>':'');
}
async function lgDraw(){
  const body=$('lgBody'); if(!body) return;
  if(LG.view==='tb') return lgTb(body);
  if(LG.view==='subs') return lgSubs(body);
  const led=LG.ledger?X.ledgerById(parseInt(LG.ledger,10)):null; let subs=[];
  if(led&&led.sub_ledger_type) subs=await X.subsOf(led.id);
  body.innerHTML='<div class="acx-top"><select id="lgLed" onchange="acxLgLedger()" style="max-width:340px">'+ledgerPick(LG.ledger)+'</select>'
    +(led&&led.sub_ledger_type?'<select id="lgSub" style="max-width:300px" onchange="acxLgRun()">'+opt('','All sub-ledgers',LG.sub)+subs.map(s=>opt(s.id,s.name,LG.sub)).join('')+'</select>':'')
    +'<input type="date" id="lgFrom" value="'+LG.from+'" onchange="acxLgRun()"><span class="acx-hint">to</span><input type="date" id="lgTo" value="'+LG.to+'" onchange="acxLgRun()">'+X.dlBtns('acxLgDownload','acx-right')+'</div><div id="lgOut"></div>';
  if(led) await acxLgRun(true);
  else $('lgOut').innerHTML='<div class="empty" style="padding:30px"><i class="fa-solid fa-book"></i><div>Choose a ledger to see its statement.</div></div>';
}
window.acxLgLedger=function(){ LG.ledger=val('lgLed'); LG.sub=''; LG.data=null; lgDraw(); };
window.acxLgRun=async function(first){
  LG.sub=$('lgSub')?val('lgSub'):''; LG.from=val('lgFrom')||LG.from; LG.to=val('lgTo')||LG.to;
  const led=X.ledgerById(parseInt(LG.ledger,10)); if(!led) return; const out=$('lgOut'); if(!out) return; loader(out);
  const args={p_company:S.coId,p_ledger:led.id,p_sub:LG.sub?parseInt(LG.sub,10):null,p_from:LG.from,p_to:LG.to,p_bu:S.buId||null};
  const {data,error}=await rpc(led.ledger_type==='general'?'ledger_statement':'cost_statement',args); if(error){ out.innerHTML=X.errHtml(error); return; }
  LG.data=data; LG.dataType=led.ledger_type;
  const rows=(data.rows||[]).map(r=>'<tr><td style="white-space:nowrap">'+dmy(r.dt)+'</td><td><span class="acx-code acx-link" onclick="acxVoucherOpen('+r.voucher_id+')">'+esc(r.doc_no)+'</span> '+vtag(r.vtype)+'</td><td>'+esc(r.narration||'')+(r.ledger?'<div class="acx-hint">'+esc(r.ledger)+'</div>':'')+'</td><td>'+esc(r.sub_ledger||'')+'</td>'
    +'<td class="acx-num">'+(r.dr>0?money(r.dr):'')+'</td><td class="acx-num">'+(r.cr>0?money(r.cr):'')+'</td><td class="acx-num">'+drcr(r.balance)+'</td></tr>').join('');
  out.innerHTML='<div class="acx-kpis"><div class="acx-kpi"><div class="k">Opening</div><div class="v">'+drcr(data.opening)+'</div></div><div class="acx-kpi"><div class="k">Debits</div><div class="v">'+money(data.total_dr)+'</div></div><div class="acx-kpi"><div class="k">Credits</div><div class="v">'+money(data.total_cr)+'</div></div><div class="acx-kpi"><div class="k">Closing</div><div class="v">'+drcr(data.closing)+'</div></div></div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Date</th><th>Voucher</th><th>Particulars</th><th>Sub-ledger</th><th class="acx-num">Debit</th><th class="acx-num">Credit</th><th class="acx-num">Balance</th></tr></thead><tbody>'
    +'<tr style="background:#f8fafc"><td colspan="6"><b>Opening balance</b></td><td class="acx-num"><b>'+drcr(data.opening)+'</b></td></tr>'+(rows||'<tr><td colspan="7"><div class="empty" style="padding:18px"><div>No entries in this period</div></div></td></tr>')
    +'<tr style="background:#f8fafc"><td colspan="4"><b>Closing balance</b></td><td class="acx-num"><b>'+money(data.total_dr)+'</b></td><td class="acx-num"><b>'+money(data.total_cr)+'</b></td><td class="acx-num"><b>'+drcr(data.closing)+'</b></td></tr></tbody></table></div></div>';
  const b=document.querySelector('#lgBody .btn.right'); if(b) b.disabled=false;
};
window.acxLgDownload=function(fmt,btn){
  const d=LG.data; if(!d){ toast('Choose a ledger first','warn'); return; }
  const subTxt=(LG.sub&&$('lgSub'))?(($('lgSub').selectedOptions[0]||{}).text||''):'';
  const rows=[['','','Opening balance','',null,null,d.opening]].concat((d.rows||[]).map(r=>[r.dt,r.doc_no,(r.narration||'')+(r.ledger?' ('+r.ledger+')':''),r.sub_ledger||'',r.dr>0?r.dr:null,r.cr>0?r.cr:null,r.balance]));
  X.download(fmt,{title:LG.dataType==='general'?'Ledger statement':'Cost / custom ledger statement',file:'Ledger_'+d.ledger,
    sub:d.ledger+(subTxt?' · '+subTxt:'')+' · '+dmy(d.from)+' to '+dmy(d.to)+(S.buId?' · Business unit: '+X.buName(S.buId):' · All business units'),
    cols:[{h:'Date',t:'d'},{h:'Voucher'},{h:'Particulars'},{h:'Sub-ledger'},{h:'Debit',t:'n'},{h:'Credit',t:'n'},{h:'Balance',t:'b'}],
    rows:rows,foot:['','','Closing balance','',d.total_dr,d.total_cr,d.closing]},btn);
};
async function lgSubs(body){
  body.innerHTML='<div class="acx-top"><select id="lgLed" onchange="acxLgSubsRun()" style="max-width:340px">'+ledgerPick(LG.ledger,true)+'</select><span class="acx-hint">as on</span><input type="date" id="lgAsOn" value="'+LG.asOn+'" onchange="acxLgSubsRun()">'+X.dlBtns('acxLgSubsDownload','acx-right')+'</div><div id="lgOut"></div>';
  if(LG.ledger) await acxLgSubsRun(true); else $('lgOut').innerHTML='<div class="empty" style="padding:30px"><i class="fa-solid fa-users"></i><div>Choose a ledger that has sub-ledgers — Sundry creditors for vendors, Advance from customers for customers, or a cost ledger.</div></div>';
}
window.acxLgSubsRun=async function(){
  LG.ledger=val('lgLed'); LG.asOn=val('lgAsOn')||LG.asOn; const out=$('lgOut'); if(!LG.ledger||!out) return; loader(out);
  const {data,error}=await rpc('sub_ledger_balances',{p_company:S.coId,p_ledger:parseInt(LG.ledger,10),p_as_on:LG.asOn,p_bu:S.buId||null}); if(error){ out.innerHTML=X.errHtml(error); return; }
  LG.subs=data; const rows=data.rows||[]; const td=rows.reduce((s,r)=>s+Number(r.dr),0), tc=rows.reduce((s,r)=>s+Number(r.cr),0);
  out.innerHTML='<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Sub-ledger</th><th class="acx-num">Debit</th><th class="acx-num">Credit</th><th class="acx-num">Balance</th><th></th></tr></thead><tbody>'
    +(rows.map(r=>'<tr><td><b>'+esc(r.name)+'</b></td><td class="acx-num">'+money(r.dr)+'</td><td class="acx-num">'+money(r.cr)+'</td><td class="acx-num"><b>'+drcr(r.balance)+'</b></td><td class="acx-act"><button class="btn btn-sm btn-ghost" onclick="acxLgOpenSub('+r.sub_ledger_id+')">Statement</button></td></tr>').join('')||'<tr><td colspan="5"><div class="empty" style="padding:18px"><div>No balances</div></div></td></tr>')
    +'<tr style="background:#f8fafc"><td><b>Total</b></td><td class="acx-num"><b>'+money(td)+'</b></td><td class="acx-num"><b>'+money(tc)+'</b></td><td class="acx-num"><b>'+drcr(td-tc)+'</b></td><td></td></tr></tbody></table></div></div>';
};
window.acxLgOpenSub=function(id){ LG.view='statement'; LG.sub=String(id); renderLedgers($('acxSec')); };
window.acxLgSubsDownload=function(fmt,btn){
  const d=LG.subs; if(!d){ toast('Choose a ledger first','warn'); return; }
  const rows=d.rows||[], td=rows.reduce((s,r)=>s+Number(r.dr||0),0), tc=rows.reduce((s,r)=>s+Number(r.cr||0),0);
  X.download(fmt,{title:'Sub-ledger balances',file:'Sub-ledger_balances_'+d.ledger,
    sub:d.ledger+' · as on '+dmy(LG.asOn)+(S.buId?' · Business unit: '+X.buName(S.buId):' · All business units'),
    cols:[{h:'Sub-ledger'},{h:'Debit',t:'n'},{h:'Credit',t:'n'},{h:'Balance',t:'b'}],
    rows:rows.map(r=>[r.name,r.dr,r.cr,r.balance]),foot:['Total ('+rows.length+')',td,tc,td-tc],orient:'portrait'},btn);
};
async function lgTb(body){
  body.innerHTML='<div class="acx-top"><input type="date" id="tbFrom" value="'+LG.from+'" onchange="acxTbRun()"><span class="acx-hint">to</span><input type="date" id="tbTo" value="'+LG.to+'" onchange="acxTbRun()">'+X.dlBtns('acxTbDownload','acx-right')+'</div><div id="lgOut"></div>';
  await acxTbRun();
}
window.acxTbRun=async function(){
  LG.from=val('tbFrom')||LG.from; LG.to=val('tbTo')||LG.to; const out=$('lgOut'); if(!out) return; loader(out);
  const {data,error}=await rpc('trial_balance',{p_company:S.coId,p_from:LG.from,p_to:LG.to,p_bu:S.buId||null}); if(error){ out.innerHTML=X.errHtml(error); return; }
  LG.tb=data; const rows=data.rows||[]; const NAT={asset:'Assets',liability:'Liabilities',income:'Income',expense:'Expenses'};
  const sum=k=>rows.reduce((s,r)=>s+Number(r[k]),0);
  const clos=r=>Number(r.closing), opn=r=>Number(r.opening);
  let html='', cur='';
  rows.forEach(r=>{ if(r.nature!==cur){ cur=r.nature; html+='<tr style="background:#f8fafc"><td colspan="6"><b>'+NAT[cur]+'</b></td></tr>'; }
    html+='<tr><td style="padding-left:24px">'+esc(r.name)+'<div class="acx-hint">'+esc(r.group)+'</div></td><td class="acx-num">'+(Math.abs(opn(r))>0.004?drcr(opn(r)):'')+'</td><td class="acx-num">'+(r.dr>0?money(r.dr):'')+'</td><td class="acx-num">'+(r.cr>0?money(r.cr):'')+'</td><td class="acx-num"><b>'+(Math.abs(clos(r))>0.004?drcr(clos(r)):'')+'</b></td><td class="acx-act">'+(r.ledger_id?'<button class="btn btn-sm btn-ghost" onclick="acxTbOpen('+r.ledger_id+')">Statement</button>':'')+'</td></tr>'; });
  const net=sum('closing'), od=sum('opening');
  out.innerHTML='<div class="acx-kpis"><div class="acx-kpi"><div class="k">Total debit (period)</div><div class="v">'+money(sum('dr'))+'</div></div><div class="acx-kpi"><div class="k">Total credit (period)</div><div class="v">'+money(sum('cr'))+'</div></div>'
    +'<div class="acx-kpi"><div class="k">Books tally?</div><div class="v" style="color:'+(Math.abs(net)<0.005&&Math.abs(od)<0.005?'#15803d':'#b91c1c')+'">'+(Math.abs(net)<0.005&&Math.abs(od)<0.005?'Yes ✔':'No')+'</div><div class="s">'+(Math.abs(net)<0.005&&Math.abs(od)<0.005?'opening and closing balances both net to nil':Math.abs(od)>=0.005?'opening balances do not tally — see Ledger opening':'closing balances do not net to nil — an entry is out of balance')+'</div></div></div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Ledger</th><th class="acx-num">Opening</th><th class="acx-num">Debit</th><th class="acx-num">Credit</th><th class="acx-num">Closing</th><th></th></tr></thead><tbody>'
    +(html||'<tr><td colspan="6"><div class="empty" style="padding:18px"><div>No entries or opening balances</div></div></td></tr>')+'<tr style="background:#f8fafc"><td><b>Total</b></td><td class="acx-num"><b>'+drcr(od)+'</b></td><td class="acx-num"><b>'+money(sum('dr'))+'</b></td><td class="acx-num"><b>'+money(sum('cr'))+'</b></td><td class="acx-num"><b>'+drcr(net)+'</b></td><td></td></tr></tbody></table></div></div>';
};
window.acxTbOpen=function(id){ LG.view='statement'; LG.ledger=String(id); LG.sub=''; renderLedgers($('acxSec')); };
window.acxTbDownload=function(fmt,btn){
  const d=LG.tb; if(!d){ toast('Nothing to download yet','warn'); return; }
  const rows=d.rows||[], s=k=>rows.reduce((a,r)=>a+Number(r[k]||0),0);
  X.download(fmt,{title:'Trial balance',file:'Trial_balance_'+((X.curCo()||{}).short_code||''),
    sub:dmy(d.from)+' to '+dmy(d.to)+(S.buId?' · Business unit: '+X.buName(S.buId):' · All business units'),
    cols:[{h:'Ledger'},{h:'Group'},{h:'Nature'},{h:'Opening',t:'b'},{h:'Debit',t:'n'},{h:'Credit',t:'n'},{h:'Closing',t:'b'}],
    rows:rows.map(r=>[r.name,r.group,r.nature,r.opening,r.dr,r.cr,r.closing]),foot:['Total ('+rows.length+')','','',s('opening'),s('dr'),s('cr'),s('closing')]},btn);
};

/* =================================================================== POSTING LEDGERS (rules) */
const ROLE_ROWS=[
  ['vendor_control','Sundry creditors','Every vendor and contractor gets a sub-ledger here (bills credit it, payments debit it).','vendor'],
  ['purchases','Material purchases','Goods bills are booked here.',null],
  ['expense_default','Other expenses (unclassified)','Service and non-store bills whose expense head has no ledger below.',null],
  ['contractor_cost','Contractor / works cost','Gross value of RA bills (before GST and deductions).',null],
  ['purchase_return','Purchase returns','Debit notes reduce purchases here.',null],
  ['input_cgst','Input CGST','GST paid on bills (CGST half).',null],['input_sgst','Input SGST','GST paid on bills (SGST half).',null],['input_igst','Input IGST','GST paid on bills from another state.',null],
  ['tds_payable','TDS payable','TDS deducted from vendors and contractors — one sub-ledger per deductee.','vendor'],
  ['retention_payable','Retention money payable','Amount held back from RA bills, released later.','vendor'],
  ['other_recoveries','Recoveries from contractors','Other deductions on an RA bill (penalties, recoveries).',null],
  ['customer_advance','Advance received from customers','Post Sales receipts credit it, one sub-ledger per booking.','customer'],
  ['output_cgst','Output CGST','GST on Post Sales invoices (CGST half).',null],['output_sgst','Output SGST','GST on Post Sales invoices (SGST half).',null],['output_igst','Output IGST','GST on Post Sales invoices, if charged as IGST.',null],
  ['cash','Cash in hand','Post Sales cash receipts are booked here.',null]];
const RL={heads:[],headMap:{},psb:[]};
async function renderRules(host){
  const [h,m,p,eg,al]=await Promise.all([PU().from('expense_heads').select('id,name').is('deleted_at',null).order('sort_order').order('name'),AC().from('expense_head_ledgers').select('*').eq('company_id',S.coId),
    sb.schema('postsales').from('bank_accounts').select('id,name,bank_name,active,project_id').order('id'),
    rpc('eng_activity_groups'),AC().from('activity_group_ledgers').select('*').eq('company_id',S.coId)]);
  RL.heads=h.data||[]; RL.headMap={}; (m.data||[]).forEach(x=>RL.headMap[x.expense_head_id]=x.ledger_id); RL.psb=p.data||[];
  RL.groups=(eg.data||[]).filter(x=>x.active!==false); RL.aglMap={}; (al.data||[]).forEach(x=>RL.aglMap[x.activity_group_id]=x.ledger_id);
  const costLeds=S.ledgers.filter(l=>l.active&&l.ledger_type!=='general'&&!l.sub_ledger_type);
  const adm=S.canPost;
  const lopts=(sel,f)=>opt('','— not set —',sel)+S.ledgers.filter(l=>l.active&&l.ledger_type==='general'&&(!f||f(l))).sort((a,b)=>a.name.localeCompare(b.name)).map(l=>opt(l.id,l.name,sel)).join('');
  const holder=k=>(S.ledgers.find(l=>l.system_key===k)||{}).id||'';
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">Posting ledgers</div><div class="acx-hint" style="margin:0">Which ledgers the automatic postings use for '+esc((X.curCo()||{}).name||'')+'. “Load standard chart” under Transactions › Structure sets all of these up in one go.</div></div></div>'
    +'<div class="acx-sec-title" style="margin-top:0">Roles</div><div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Role</th><th>Ledger</th><th></th></tr></thead><tbody>'
    +ROLE_ROWS.map(r=>{const cur=holder(r[0]);return '<tr><td><b>'+esc(r[1])+'</b><div class="acx-hint">'+esc(r[2])+'</div></td><td style="min-width:260px"><select id="rl_'+r[0]+'" '+(adm?'':'disabled')+' style="width:100%;height:36px;border:1px solid var(--line);border-radius:8px;padding:0 10px" onchange="acxRoleSave(\''+r[0]+'\')">'+lopts(cur,l=>!r[3]||l.sub_ledger_type===r[3])+'</select>'+(r[3]?'<div class="acx-hint">Must have vendor sub-ledgers'.replace('vendor',r[3])+'</div>':'')+'</td><td>'+(cur?'<span class="tag t-green">Set</span>':'<span class="tag t-amber">Missing</span>')+'</td></tr>';}).join('')
    +'</tbody></table></div></div>'
    +'<div class="acx-sec-title">Post Sales bank accounts</div><div class="acx-hint" style="margin-bottom:8px">Each Post Sales receipt names the account the money went into. Link every account to a ledger of this company — bank accounts to bank ledgers, and adjustment accounts such as “TDS receivable” or “Discount allowed” to the ledger they belong to.</div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Post Sales account</th><th>Ledger in this company</th></tr></thead><tbody>'
    +(RL.psb.map(b=>{const cur=(S.ledgers.find(l=>l.ps_bank_account_id===b.id)||{}).id||'';return '<tr><td><b>'+esc(b.name)+'</b><div class="acx-hint">'+esc(b.bank_name||'')+(b.active?'':' · inactive')+' · project '+esc(X.projName(b.project_id))+'</div></td><td style="min-width:260px"><select id="psb_'+b.id+'" '+(adm?'':'disabled')+' style="width:100%;height:36px;border:1px solid var(--line);border-radius:8px;padding:0 10px" onchange="acxPsbSave('+b.id+')">'+lopts(cur)+'</select></td></tr>';}).join('')||'<tr><td colspan="2"><div class="empty" style="padding:16px"><div>No Post Sales accounts</div></div></td></tr>')
    +'</tbody></table></div></div>'
    +'<div class="acx-sec-title">Engineering activity groups → cost ledgers</div><div class="acx-hint" style="margin-bottom:8px">When an RA bill is posted, its contractor cost is split by the activity group of the work (Civil, Electrical …). A group mapped here is tagged to that cost ledger, so cost to date by group can be read under Ledgers & trial balance. Unmapped groups stay on the plain “Contractor / works cost” line. Only cost or custom ledgers without sub-ledgers can be chosen.</div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Activity group</th><th>Cost ledger</th></tr></thead><tbody>'
    +(RL.groups.map(x=>'<tr><td><b>'+esc(x.name)+'</b></td><td style="min-width:260px"><select id="ag_'+x.id+'" '+(adm?'':'disabled')+' style="width:100%;height:36px;border:1px solid var(--line);border-radius:8px;padding:0 10px" onchange="acxAgSave('+x.id+')">'+opt('','— not tagged —',RL.aglMap[x.id]||'')+costLeds.map(l=>opt(l.id,l.name+' ('+(l.ledger_type==='cost'?'cost':'custom')+')',RL.aglMap[x.id])).join('')+'</select></td></tr>').join('')
      ||'<tr><td colspan="2"><div class="empty" style="padding:16px"><div>'+(eg.error?'Engineering activity groups are not available':'No activity groups yet (Engineering › Masters)')+'</div></div></td></tr>')
    +'</tbody></table></div></div>'
    +(costLeds.length?'':'<div class="acx-hint" style="margin-top:6px">There is no cost or custom ledger yet — add one under Chart of accounts › Cost / custom ledger.</div>')
    +'<div class="acx-sec-title">Expense heads of service and non-store bills</div><div class="acx-hint" style="margin-bottom:8px">Choose the ledger each expense head is booked to. Heads left unset go to “Other expenses (unclassified)”. Goods bills always go to Material purchases.</div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Expense head</th><th>Ledger</th></tr></thead><tbody>'
    +(RL.heads.map(x=>'<tr><td><b>'+esc(x.name)+'</b></td><td style="min-width:260px"><select id="eh_'+x.id+'" '+(adm?'':'disabled')+' style="width:100%;height:36px;border:1px solid var(--line);border-radius:8px;padding:0 10px" onchange="acxEhSave('+x.id+')">'+lopts(RL.headMap[x.id]||'',l=>{const g=S.groups.find(y=>y.id===l.group_id);return g&&g.nature==='expense'||g&&g.nature==='asset';})+'</select></td></tr>').join('')||'<tr><td colspan="2"><div class="empty" style="padding:16px"><div>No expense heads (Inventory › Setup › Expense heads)</div></div></td></tr>')
    +'</tbody></table></div></div>';
}
window.acxRoleSave=async function(key){
  const id=val('rl_'+key)?parseInt(val('rl_'+key),10):null;
  let r=await AC().from('ledgers').update({system_key:null}).eq('company_id',S.coId).eq('system_key',key); if(fail(r.error)) return;
  if(id){ r=await AC().from('ledgers').update({system_key:key}).eq('id',id); if(fail(r.error)) { await X.loadLedgers(); return; } }
  await X.loadLedgers(); toast('Saved','ok'); renderRules($('acxSec'));
};
window.acxPsbSave=async function(psId){
  const id=val('psb_'+psId)?parseInt(val('psb_'+psId),10):null;
  let r=await AC().from('ledgers').update({ps_bank_account_id:null}).eq('ps_bank_account_id',psId); if(fail(r.error)) return;
  if(id){ r=await AC().from('ledgers').update({ps_bank_account_id:psId}).eq('id',id); if(fail(r.error)) { await X.loadLedgers(); return; } }
  await X.loadLedgers(); toast('Saved','ok'); renderRules($('acxSec'));
};
window.acxAgSave=async function(groupId){
  const id=val('ag_'+groupId)?parseInt(val('ag_'+groupId),10):null;
  const r=id?await AC().from('activity_group_ledgers').upsert({company_id:S.coId,activity_group_id:groupId,ledger_id:id},{onConflict:'company_id,activity_group_id'}):await AC().from('activity_group_ledgers').delete().eq('company_id',S.coId).eq('activity_group_id',groupId);
  if(fail(r.error)) return; RL.aglMap[groupId]=id; toast('Saved','ok');
};
window.acxEhSave=async function(headId){
  const id=val('eh_'+headId)?parseInt(val('eh_'+headId),10):null;
  const r=id?await AC().from('expense_head_ledgers').upsert({company_id:S.coId,expense_head_id:headId,ledger_id:id},{onConflict:'company_id,expense_head_id'}):await AC().from('expense_head_ledgers').delete().eq('company_id',S.coId).eq('expense_head_id',headId);
  if(fail(r.error)) return; RL.headMap[headId]=id; toast('Saved','ok');
};

/* =================================================================== AUDIT (tab 3)
   Four registers. Deleted and Modification read accounts.audit_log, which the database fills by itself whenever
   one of the editable records is changed or removed (20261102150000_accounts_audit_registers.sql) - so they hold
   only what happened from that day on. Transfer (contra, deposit, withdrawal) and Document reversal (cancelled
   vouchers and opening bills) read the vouchers themselves, so they cover everything ever posted.
   Routes: accounts/2/<deleted|modified|transfers|reversals>. */
const AUD_SECS=[['deleted','Deleted'],['modified','Modification'],['transfers','Transfer'],['reversals','Document reversal']];
const AUD={cur:'',from:'',to:'',q:'',rt:'',tt:'',rows:[],draw:null,load:null};
window.acxAuditRender=async function(host,seg){
  if(!(await window.acxIsAdmin())){
    host.innerHTML='<div class="empty"><i class="fa-solid fa-lock"></i><div style="font-weight:600">The audit registers are for Accounts administrators</div><div class="acx-hint" style="margin-top:4px">Ask an Accounts administrator if you need to see them.</div></div>'; return;
  }
  return X.shell(host,seg||[],2,AUD_SECS,'deleted',{
    deleted:renderAuditLog.bind(null,'Deleted'),modified:renderAuditLog.bind(null,'Modified'),
    transfers:renderAuditTransfers,reversals:renderAuditReversals});
};
function audEnter(key){
  if(!AUD.from) AUD.from=X.fyStart(today()); if(!AUD.to) AUD.to=today();
  if(AUD.cur!==key){ AUD.cur=key; AUD.q=''; AUD.rt=''; AUD.tt=''; AUD.rows=[]; }
}
const audStart=iso=>new Date(iso+'T00:00:00').toISOString(), audEnd=iso=>new Date(iso+'T23:59:59.999').toISOString();
function audTop(extra,dlFn,placeholder){
  return '<div class="acx-top">'+(extra||'')
    +'<input type="date" id="audFrom" value="'+AUD.from+'" onchange="acxAudDates()"><span class="acx-hint">to</span><input type="date" id="audTo" value="'+AUD.to+'" onchange="acxAudDates()">'
    +'<input class="grow" id="audQ" placeholder="'+esc(placeholder)+'" value="'+esc(AUD.q)+'" oninput="acxAudSearch()">'+X.dlBtns(dlFn)+'</div>';
}
window.acxAudDates=function(){ AUD.from=val('audFrom')||AUD.from; AUD.to=val('audTo')||AUD.to; if(AUD.load) AUD.load(); };
window.acxAudSearch=function(){ AUD.q=val('audQ'); if(AUD.draw) AUD.draw(); const e=$('audQ'); if(e){ e.focus(); e.setSelectionRange(e.value.length,e.value.length); } };
window.acxAudType=function(v){ AUD.rt=v; if(AUD.draw) AUD.draw(); };
window.acxAudTt=function(v){ AUD.tt=v; if(AUD.draw) AUD.draw(); };
const audHas=(q,parts)=>!q||parts.join(' ').toLowerCase().includes(q.toLowerCase());
const audEmpty=(cols,msg)=>'<tr><td colspan="'+cols+'"><div class="empty" style="padding:24px"><div>'+msg+'</div></div></td></tr>';
const audBy=r=>esc(r||'—');

/* ---- what a column was called, and how a stored value reads ---- */
const AUD_FIELD={name:'Name',code:'Code',short_code:'Short code',gstin:'GSTIN',pan:'PAN',state_code:'State code',fy_start_month:'Financial year starts in',books_start:'Books start on',
  books_locked_till:'Books locked up to',active:'Active',is_bank:'Bank account',is_cash:'Cash account',bank_name:'Bank',account_no:'Account no',ifsc:'IFSC',ledger_type:'Ledger type',
  sub_ledger_type:'Sub-ledger type',system_key:'Posting role',group_id:'Account group',parent_id:'Parent group',business_unit_id:'Business unit',ledger_id:'Ledger',cost_ledger_id:'Cost ledger',
  nature:'Nature',role:'Role',email:'Email',dr:'Debit',cr:'Credit',cleared_on:'Cleared on',instrument_no:'Cheque / instrument no',instrument_date:'Instrument date',payee:'Payee',
  narration:'Narration',mode:'Mode',as_on:'As on',closing_balance:'Closing balance',note:'Note',key:'Setting',value:'Value',label:'Label',prefix:'Prefix',from_no:'From no',to_no:'To no',
  next_no:'Next no',width:'Width',party_type:'Party type',sort_order:'Sort order',is_system:'System record',ps_bank_account_id:'Post Sales bank account',width_mm:'Width (mm)',height_mm:'Height (mm)',
  layout:'Layout',legal_entity_id:'Legal entity',project_id:'Project'};
const AUD_SKIP=['id','created_at','created_by','updated_at','updated_by','company_id'];
const audLabel=k=>AUD_FIELD[k]||(k.charAt(0).toUpperCase()+k.slice(1).replace(/_/g,' '));
const MONTHS=['','January','February','March','April','May','June','July','August','September','October','November','December'];
function audVal(k,v){
  if(v==null||v==='') return '(blank)';
  if(typeof v==='boolean') return v?'Yes':'No';
  if(k==='group_id'||k==='parent_id'){ const g=S.groups.find(x=>x.id===v); return g?g.name:'#'+v; }
  if(k==='ledger_id'||k==='cost_ledger_id'){ const l=X.ledgerById(v); return l?l.name:'#'+v; }
  if(k==='business_unit_id'){ const b=S.bu.find(x=>x.id===v); return b?b.name:'#'+v; }
  if(k==='fy_start_month') return MONTHS[v]||String(v);
  if(k==='mode') return X.MODE_LABEL[v]||String(v);
  if(['dr','cr','closing_balance'].includes(k)) return money(v);
  if(/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return dmy(v);
  if(typeof v==='object') return JSON.stringify(v);
  return String(v);
}
// a column worth showing: not bookkeeping, and not an id nobody can read
const audShow=(k,v)=>v!=null&&v!==''&&!AUD_SKIP.includes(k)&&(!/_id$/.test(k)||['group_id','parent_id','ledger_id','cost_ledger_id','business_unit_id'].includes(k));
const audPairs=o=>Object.keys(o||{}).filter(k=>audShow(k,o[k])).map(k=>[audLabel(k),audVal(k,o[k])]);

/* ---- Deleted / Modification ---- */
async function renderAuditLog(action,host){
  audEnter(action==='Deleted'?'deleted':'modified'); AUD.action=action;
  const del=action==='Deleted';
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">'+(del?'Deleted records':'Modification register')+'</div><div class="acx-hint" style="margin:0">'
    +(del?'Every record taken out of Accounts - a ledger, a sub-ledger, an opening balance, a ledger link, a person’s access and so on - with who removed it and what it held. A posted voucher can never be deleted: it is cancelled, and appears under Document reversal.'
         :'Every change to an existing record - who changed it, when, and the value before and after. Covers ledgers, sub-ledgers, groups, opening balances, business units, companies, access, cheque books and layouts, and the cheque number or bank clearance on a posted voucher. A posted voucher’s entries cannot be edited: it is cancelled and entered again.')
    +' Shown for the whole company, whichever business unit is chosen. Kept from 2 Nov 2026 onwards - nothing earlier was recorded.</div></div></div><div id="audBody"></div>';
  AUD.load=audLogLoad; AUD.draw=audLogDraw; await audLogLoad();
}
async function audLogLoad(){
  const {data,error}=await AC().from('v_audit_log').select('*').eq('action',AUD.action).gte('at',audStart(AUD.from)).lte('at',audEnd(AUD.to))
    .or('company_id.eq.'+S.coId+',company_id.is.null,company_gone.eq.true').order('at',{ascending:false}).order('id',{ascending:false}).limit(1000);
  if(error) throw error; AUD.rows=data||[]; audLogDraw();
}
function audLogList(){
  return AUD.rows.filter(r=>(!AUD.rt||r.record_type===AUD.rt)&&audHas(AUD.q,[r.record_label,r.record_type,r.by,r.company_name,audPairs(r.new_data||r.old_data).map(p=>p.join(' ')).join(' ')]));
}
function audChanged(r){ return Object.keys(r.old_data||{}).filter(k=>!AUD_SKIP.includes(k)).map(k=>[audLabel(k),audVal(k,r.old_data[k]),audVal(k,(r.new_data||{})[k])]); }
function audLogDraw(){
  const body=$('audBody'); if(!body) return;
  const del=AUD.action==='Deleted', list=audLogList();
  const types=[...new Set(AUD.rows.map(r=>r.record_type))].sort();
  const typeSel='<select id="audType" onchange="acxAudType(this.value)" style="max-width:220px">'+opt('','All record types',AUD.rt)+types.map(t=>opt(t,t,AUD.rt)).join('')+'</select>';
  const rows=list.map(r=>{
    const what=del?(()=>{ const p=audPairs(r.old_data); return p.slice(0,5).map(x=>'<span class="acx-dim">'+esc(x[0])+':</span> '+esc(x[1])).join(' · ')+(p.length>5?' <span class="acx-link" onclick="acxAudRow('+r.id+')">+ '+(p.length-5)+' more</span>':''); })()
      :audChanged(r).map(c=>'<div><span class="acx-dim">'+esc(c[0])+':</span> '+esc(c[1])+' <span class="acx-dim">→</span> <b>'+esc(c[2])+'</b></div>').join('');
    return '<tr><td style="white-space:nowrap">'+dmyTime(r.at)+'</td><td>'+audBy(r.by)+'</td><td><span class="acx-pill">'+esc(r.record_type)+'</span></td>'
      +'<td><b>'+esc(r.record_label)+'</b>'+(r.company_gone?'<div class="acx-hint">Company "'+esc(r.company_name||'')+'" no longer exists</div>':'')+'</td><td>'+(what||'—')+'</td></tr>';
  }).join('');
  body.innerHTML=audTop(typeSel,'acxAudLogDownload','Search by record, person or value')
    +'<div class="acx-hint" style="margin-bottom:8px">'+list.length+' '+(del?'deletion':'change')+(list.length===1?'':'s')+(AUD.rows.length>=1000?' · showing the latest 1,000 — narrow the dates':'')+'</div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>When</th><th>'+(del?'Deleted':'Changed')+' by</th><th>Record type</th><th>Record</th><th>'+(del?'What it held':'What changed (before → after)')+'</th></tr></thead><tbody>'
    +(rows||audEmpty(5,'Nothing '+(del?'was deleted':'was changed')+' in this period'))+'</tbody></table></div></div>';
}
window.acxAudRow=function(id){
  const r=AUD.rows.find(x=>x.id===id); if(!r) return;
  openModal('<div class="modal-head"><h3>'+esc(r.record_type)+' — '+esc(r.record_label)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body">'
    +'<div class="acx-hint" style="margin-bottom:10px">'+esc(r.action)+' '+dmyTime(r.at)+' by '+esc(r.by||'')+'</div>'
    +'<div class="card" style="padding:0"><table class="tbl acx-mini"><tbody>'+audPairs(r.old_data).map(p=>'<tr><td style="width:40%"><b>'+esc(p[0])+'</b></td><td>'+esc(p[1])+'</td></tr>').join('')+'</tbody></table></div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>');
};
window.acxAudLogDownload=function(fmt,btn){
  const del=AUD.action==='Deleted', list=audLogList();
  X.download(fmt,{title:del?'Deleted records':'Modification register',file:del?'Audit_deleted':'Audit_modification',
    sub:dmy(AUD.from)+' to '+dmy(AUD.to)+(AUD.rt?' · '+AUD.rt:' · All record types')+(AUD.q?' · Search: "'+AUD.q+'"':''),
    cols:[{h:'When'},{h:(del?'Deleted':'Changed')+' by'},{h:'Record type'},{h:'Record'},{h:del?'What it held':'What changed (before -> after)'}],
    rows:list.map(r=>[dmyTime(r.at),r.by||'',r.record_type,r.record_label,del?audPairs(r.old_data).map(p=>p[0]+': '+p[1]).join('; '):audChanged(r).map(c=>c[0]+': '+c[1]+' -> '+c[2]).join('; ')]),
    foot:['Total ('+list.length+')','','','','']},btn);
};

/* ---- Transfer: money moved between our own cash and bank accounts ---- */
async function renderAuditTransfers(host){
  audEnter('transfers');
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">Transfer register</div><div class="acx-hint" style="margin:0">Money moved between the company’s own cash and bank accounts - contra entries, cash deposited in the bank and cash drawn from it - with the account it left, the account it reached, who entered it, and whether it has since been cancelled. Journals are in Transactions › Journal.</div></div></div><div id="audBody"></div>';
  AUD.load=audTrLoad; AUD.draw=audTrDraw; await audTrLoad();
}
async function audTrLoad(){
  let q=AC().from('v_audit_transfers').select('*').eq('company_id',S.coId).gte('voucher_date',AUD.from).lte('voucher_date',AUD.to).order('voucher_date',{ascending:false}).order('id',{ascending:false}).limit(1000);
  if(S.buId) q=q.eq('business_unit_id',S.buId);
  const {data,error}=await q; if(error) throw error; AUD.rows=data||[]; audTrDraw();
}
function audTrList(){ return AUD.rows.filter(v=>(!AUD.tt||v.voucher_type===AUD.tt)&&audHas(AUD.q,[v.doc_no,v.from_account,v.to_account,v.narration,v.instrument_no,v.created_by])); }
function audTrDraw(){
  const body=$('audBody'); if(!body) return;
  const list=audTrList(), live=list.filter(v=>v.status==='posted'), total=live.reduce((s,v)=>s+Number(v.amount||0),0), cx=list.length-live.length;
  const chips='<div class="acx-subs" style="margin:0">'+[['','All'],['contra','Contra'],['deposit','Deposits'],['withdrawal','Withdrawals']].map(s=>'<span class="chip'+(AUD.tt===s[0]?' active':'')+'" onclick="acxAudTt(\''+s[0]+'\')">'+s[1]+'</span>').join('')+'</div>';
  const rows=list.map(v=>'<tr style="cursor:pointer" onclick="acxVoucherOpen('+v.id+')"><td><span class="acx-code">'+esc(v.doc_no)+'</span></td><td style="white-space:nowrap">'+dmy(v.voucher_date)+'</td><td>'+vtag(v.voucher_type)+'</td>'
    +'<td>'+esc(v.from_account||'—')+'</td><td>'+esc(v.to_account||'—')+'</td><td class="acx-num"><b>'+money(v.amount)+'</b></td>'
    +'<td>'+esc(X.MODE_LABEL[v.mode]||'—')+(v.instrument_no?'<div class="acx-hint">'+esc(v.instrument_no)+(v.instrument_date?' · '+dmy(v.instrument_date):'')+'</div>':'')+'</td>'
    +'<td>'+esc(v.business_unit_id?X.buName(v.business_unit_id):'Company level')+'</td><td>'+audBy(v.created_by)+'<div class="acx-hint">'+dmyTime(v.created_at)+'</div></td>'
    +'<td>'+(v.status==='posted'?'<span class="tag t-green">Posted</span>':'<span class="tag t-red">Cancelled</span><div class="acx-hint">'+esc(v.cancelled_by||'')+(v.cancel_reason?': '+esc(v.cancel_reason):'')+'</div>')+'</td></tr>').join('');
  body.innerHTML=audTop(chips,'acxAudTrDownload','Search by number, account, cheque no or person')
    +'<div class="acx-hint" style="margin-bottom:8px">'+list.length+' transfer'+(list.length===1?'':'s')+' · '+money(total)+' moved'+(cx?' · '+cx+' cancelled (not counted)':'')+(AUD.rows.length>=1000?' · showing the latest 1,000 — narrow the dates':'')+'</div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Voucher no</th><th>Date</th><th>Type</th><th>From</th><th>To</th><th class="acx-num">Amount</th><th>Mode</th><th>Business unit</th><th>Entered by</th><th>Status</th></tr></thead><tbody>'
    +(rows||audEmpty(10,'No transfers in this period'))+'</tbody></table></div></div>';
}
window.acxAudTrDownload=function(fmt,btn){
  const list=audTrList(), live=list.filter(v=>v.status==='posted'), total=live.reduce((s,v)=>s+Number(v.amount||0),0);
  X.download(fmt,{title:'Transfer register',file:'Audit_transfers',
    sub:dmy(AUD.from)+' to '+dmy(AUD.to)+(AUD.tt?' · '+(X.VTYPE[AUD.tt]||[AUD.tt])[0]:' · Contra, deposits and withdrawals')+(S.buId?' · Business unit: '+X.buName(S.buId):' · All business units')+(AUD.q?' · Search: "'+AUD.q+'"':''),
    cols:[{h:'Voucher no'},{h:'Date',t:'d'},{h:'Type'},{h:'From'},{h:'To'},{h:'Amount',t:'n'},{h:'Mode'},{h:'Instrument no'},{h:'Business unit'},{h:'Entered by'},{h:'Entered on'},{h:'Status'},{h:'Cancelled by'},{h:'Reason'}],
    rows:list.map(v=>[v.doc_no,v.voucher_date,(X.VTYPE[v.voucher_type]||[v.voucher_type])[0],v.from_account||'',v.to_account||'',v.amount,X.MODE_LABEL[v.mode]||'',v.instrument_no||'',v.business_unit_id?X.buName(v.business_unit_id):'Company level',v.created_by||'',dmyTime(v.created_at),v.status==='posted'?'Posted':'Cancelled',v.cancelled_by||'',v.cancel_reason||'']),
    foot:['Total ('+live.length+' posted)','','','','',total,'','','','','','','','']},btn);
};

/* ---- Document reversal: cancelled vouchers and opening bills ---- */
async function renderAuditReversals(host){
  audEnter('reversals');
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">Document reversal register</div><div class="acx-hint" style="margin:0">Every document that was cancelled after it was posted - a receipt, payment, journal, bill, or a posting reversed from Ledgers &amp; postings - and every opening bill cancelled: who entered it, who reversed it, when, and why. The dates below are the dates of reversal.</div></div></div><div id="audBody"></div>';
  AUD.load=audRvLoad; AUD.draw=audRvDraw; await audRvLoad();
}
async function audRvLoad(){
  let q=AC().from('v_audit_reversals').select('*').eq('company_id',S.coId).gte('reversed_at',audStart(AUD.from)).lte('reversed_at',audEnd(AUD.to)).order('reversed_at',{ascending:false}).limit(1000);
  if(S.buId) q=q.eq('business_unit_id',S.buId);
  const {data,error}=await q; if(error) throw error; AUD.rows=data||[]; audRvDraw();
}
const audRvType=r=>r.kind==='opening_bill'?'<span class="tag t-gray">Opening bill</span>':vtag(r.doc_type);
function audRvList(){ return AUD.rows.filter(r=>audHas(AUD.q,[r.doc_no,r.particulars,r.reason,r.entered_by,r.reversed_by])); }
function audRvDraw(){
  const body=$('audBody'); if(!body) return;
  const list=audRvList(), total=list.reduce((s,r)=>s+Number(r.amount||0),0);
  const rows=list.map(r=>'<tr style="cursor:pointer" onclick="'+(r.kind==='opening_bill'?'acxBillHist(':'acxVoucherOpen(')+r.id+')"><td><span class="acx-code">'+esc(r.doc_no)+'</span>'+(r.source_type&&r.source_type!=='opening'?'<div class="acx-hint">Posting reversed · '+esc(SRC_LABEL[r.source_type]||r.source_type)+'</div>':'')+'</td>'
    +'<td>'+audRvType(r)+'</td><td style="white-space:nowrap">'+dmy(r.doc_date)+'</td><td>'+esc(r.particulars||'—')+'</td><td class="acx-num"><b>'+money(r.amount)+'</b></td>'
    +'<td>'+audBy(r.entered_by)+'<div class="acx-hint">'+dmyTime(r.entered_at)+'</div></td><td>'+audBy(r.reversed_by)+'<div class="acx-hint">'+dmyTime(r.reversed_at)+'</div></td><td>'+esc(r.reason||'—')+'</td></tr>').join('');
  body.innerHTML=audTop('','acxAudRvDownload','Search by number, party, reason or person')
    +'<div class="acx-hint" style="margin-bottom:8px">'+list.length+' reversal'+(list.length===1?'':'s')+' · '+money(total)+' reversed'+(AUD.rows.length>=1000?' · showing the latest 1,000 — narrow the dates':'')+'</div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Document</th><th>Type</th><th>Document date</th><th>Particulars</th><th class="acx-num">Amount</th><th>Entered by</th><th>Reversed by</th><th>Reason</th></tr></thead><tbody>'
    +(rows||audEmpty(8,'No document was reversed in this period'))+'</tbody></table></div></div>';
}
window.acxAudRvDownload=function(fmt,btn){
  const list=audRvList(), total=list.reduce((s,r)=>s+Number(r.amount||0),0);
  X.download(fmt,{title:'Document reversal register',file:'Audit_document_reversal',
    sub:'Reversed '+dmy(AUD.from)+' to '+dmy(AUD.to)+(S.buId?' · Business unit: '+X.buName(S.buId):' · All business units')+(AUD.q?' · Search: "'+AUD.q+'"':''),
    cols:[{h:'Document'},{h:'Type'},{h:'Document date',t:'d'},{h:'Particulars'},{h:'Amount',t:'n'},{h:'Came from'},{h:'Entered by'},{h:'Entered on'},{h:'Reversed by'},{h:'Reversed on'},{h:'Reason'}],
    rows:list.map(r=>[r.doc_no,r.kind==='opening_bill'?'Opening bill':(X.VTYPE[r.doc_type]||[r.doc_type])[0],r.doc_date,r.particulars||'',r.amount,r.source_type&&r.source_type!=='opening'?'Posting reversed · '+(SRC_LABEL[r.source_type]||r.source_type):'Entered here',r.entered_by||'',dmyTime(r.entered_at),r.reversed_by||'',dmyTime(r.reversed_at),r.reason||'']),
    foot:['Total ('+list.length+')','','','',total,'','','','','','']},btn);
};
})();
