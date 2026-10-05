/* ============================ ACCOUNTS - BANK RECONCILIATION AND CHEQUE PRINTING ============================
   Part of the Transactions tab (accounts.js). Bank reconciliation (BRS): mark each bank entry cleared on the
   date the bank cleared it, enter the bank statement balance, see the reconciliation statement. Cheque
   printing: cheque books per bank account, cheques issued from payment vouchers, a printable cheque leaf with
   amount in words, and a per-bank layout (millimetre positions) that can be adjusted and test-printed.
   Tables and functions: supabase/migrations/20261005110000_accounts_payables_banking.sql.
   Routes: accounts/0/brs and accounts/0/cheques. */
(function(){
if(window.__ACX_BANK_LOADED) return;
window.__ACX_BANK_LOADED=true;
const X=window.ACX; if(!X){ console.error('accounts-bank.js needs accounts.js first'); return; }
const {S,AC,num,r2,money,drcr,dmy,dmyTime,today,val,chk,fail,rpc,opt,opts,field,MODE_LABEL,vtag,csv,inrWords,askReason}=X;
const hasX=()=>!!window.ACX;

/* =================================================================== BANK RECONCILIATION */
const BR={ledger:'',asOn:'',view:'uncleared',lines:[],sel:new Set(),sum:null,clearOn:''};
X.renderBrs=async function(host){
  const banks=S.ledgers.filter(l=>l.active&&l.is_bank);
  if(!banks.length){ host.innerHTML='<div class="empty"><i class="fa-solid fa-building-columns"></i><div>This company has no bank ledger yet. Add one under Ledgers & postings › Chart of accounts and mark it as a bank account.</div></div>'; return; }
  if(!BR.ledger||!banks.find(b=>String(b.id)===String(BR.ledger))) BR.ledger=banks[0].id;
  if(!BR.asOn) BR.asOn=today();
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">Bank reconciliation</div><div class="acx-hint" style="margin:0">Mark each bank entry cleared on the day the bank cleared it, enter the balance on the bank statement, and the statement below shows what is still to clear. It covers the whole bank account, across business units.</div></div></div>'
    +'<div class="acx-top"><select id="brBank" onchange="acxBrChange()">'+banks.map(b=>opt(b.id,b.name+(b.account_no?' · '+b.account_no:''),BR.ledger)).join('')+'</select>'
    +'<span class="acx-hint">as on</span><input type="date" id="brAsOn" value="'+BR.asOn+'" onchange="acxBrChange()">'
    +'<div class="acx-subs" style="margin:0">'+[['uncleared','Not yet cleared'],['cleared','Cleared'],['all','All']].map(v=>'<span class="chip'+(BR.view===v[0]?' active':'')+'" onclick="acxBrView(\''+v[0]+'\')">'+v[1]+'</span>').join('')+'</div>'
    +'<button class="btn acx-right" onclick="acxBrCsv()"><i class="fa-solid fa-file-csv"></i> CSV</button></div><div id="brBody"></div>';
  await brLoad();
};
window.acxBrChange=function(){ BR.ledger=parseInt(val('brBank'),10); BR.asOn=val('brAsOn')||today(); brLoad(); };
window.acxBrView=function(v){ BR.view=v; brLoad(); };
async function brLoad(){
  const body=$('brBody'); if(!body) return; loader(body);
  let lq=AC().from('voucher_lines').select('id,dr,cr,cleared_on,voucher_id,vouchers!inner(id,doc_no,voucher_date,voucher_type,mode,instrument_no,instrument_date,payee,narration,status)')
    .eq('ledger_id',BR.ledger).eq('vouchers.status','posted').lte('vouchers.voucher_date',BR.asOn).limit(4000);
  if(BR.view==='uncleared') lq=lq.is('cleared_on',null); else if(BR.view==='cleared') lq=lq.not('cleared_on','is',null);
  const [r,l]=await Promise.all([rpc('brs',{p_ledger:BR.ledger,p_as_on:BR.asOn}),lq]);
  if(r.error){ body.innerHTML=X.errHtml(r.error); return; } if(l.error){ body.innerHTML=X.errHtml(l.error); return; }
  BR.sum=r.data; BR.lines=(l.data||[]).slice().sort((a,b)=>(a.vouchers.voucher_date<b.vouchers.voucher_date?-1:a.vouchers.voucher_date>b.vouchers.voucher_date?1:a.id-b.id));
  BR.sel=new Set(); if(!BR.clearOn) BR.clearOn=BR.asOn; brDraw();
}
function brDraw(){
  const body=$('brBody'); if(!body) return; const s=BR.sum;
  const row=(label,amt,cls,bold)=>'<tr'+(bold?' style="font-weight:700;background:#f8fafc"':'')+'><td>'+label+'</td><td class="acx-num '+(cls||'')+'">'+amt+'</td></tr>';
  const stmtVal=s.statement_balance!=null?s.statement_balance:'';
  const diff=s.difference;
  const sumHtml='<div class="card" style="padding:0;margin-bottom:14px"><table class="tbl"><tbody>'
    +row('Balance as per books as on '+dmy(BR.asOn),drcr(s.book_balance),'',true)
    +row('Add: cheques issued but not yet presented ('+(s.uncleared_payments||[]).length+')',money(s.total_payments))
    +row('Less: cheques / deposits not yet credited by the bank ('+(s.uncleared_receipts||[]).length+')',money(s.total_receipts))
    +row('Balance as per bank (worked out)',drcr(s.balance_per_bank),'',true)
    +'<tr><td>Balance on the bank statement'+(s.statement_as_on?' <span class="acx-hint">(entered for '+dmy(s.statement_as_on)+')</span>':'')+'<div class="acx-hint">Enter the closing balance shown by the bank as on '+dmy(BR.asOn)+' (negative if overdrawn)</div></td>'
    +'<td class="acx-num"><input id="brStmt" inputmode="decimal" style="width:150px;height:34px;border:1px solid var(--line);border-radius:6px;padding:0 8px;text-align:right" value="'+(s.statement_as_on===BR.asOn?stmtVal:'')+'"> <button class="btn btn-sm" onclick="acxBrStmtSave()">Save</button></td></tr>'
    +(diff!=null?row('Difference (statement − worked out)',Math.abs(diff)<0.005?'<span style="color:#15803d">Reconciled ✔</span>':'<span style="color:#b91c1c">'+drcr(diff)+'</span>','',true):'')
    +'</tbody></table></div>';
  const mk=(title,list,isRec)=>{
    const rows=list.map(x=>{const v=x.vouchers, amt=isRec?x.dr:x.cr, cl=x.cleared_on;
      return '<tr><td style="width:28px">'+(S.canPost?'<input type="checkbox" class="acx-chk" '+(BR.sel.has(x.id)?'checked':'')+' onchange="acxBrSel('+x.id+',this.checked)">':'')+'</td><td><span class="acx-code acx-link" onclick="acxVoucherOpen('+v.id+')">'+esc(v.doc_no)+'</span></td><td style="white-space:nowrap">'+dmy(v.voucher_date)+'</td>'
        +'<td>'+esc(MODE_LABEL[v.mode]||'')+(v.instrument_no?' · <b>'+esc(v.instrument_no)+'</b>':'')+(v.instrument_date?'<div class="acx-hint">'+dmy(v.instrument_date)+'</div>':'')+'</td><td>'+esc(v.payee||v.narration||'—')+'</td>'
        +'<td class="acx-num"><b>'+money(amt)+'</b></td><td style="white-space:nowrap">'+(cl?'<span class="tag t-green">'+dmy(cl)+'</span>':'<span class="tag t-amber">Not cleared</span>')+'</td></tr>';}).join('');
    return '<div class="acx-sec-title" style="display:flex;align-items:center;gap:10px">'+title+' <span class="acx-pill">'+list.length+'</span><span class="grow" style="flex:1"></span>'
      +(S.canPost&&list.length?'<span class="acx-link" style="font-size:12.5px" onclick="acxBrAll('+(isRec?1:0)+')">Select all</span>':'')+'</div>'
      +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl acx-mini"><thead><tr><th></th><th>Voucher</th><th>Date</th><th>Mode / instrument</th><th>Particulars</th><th class="acx-num">Amount</th><th>Bank cleared</th></tr></thead><tbody>'
      +(rows||'<tr><td colspan="7"><div class="empty" style="padding:16px"><div>Nothing here</div></div></td></tr>')+'</tbody></table></div></div>';
  };
  const recs=BR.lines.filter(x=>x.dr>0), pays=BR.lines.filter(x=>x.cr>0);
  const act=S.canPost?'<div class="card" style="padding:10px 14px;margin:14px 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b id="brSelCount">'+BR.sel.size+' selected</b><span class="acx-hint">Bank cleared them on</span>'
    +'<input type="date" id="brClearOn" value="'+esc(BR.clearOn)+'" max="'+today()+'" style="height:34px;border:1px solid var(--line);border-radius:6px;padding:0 8px" onchange="acxBrClearOn()"><button class="btn btn-primary btn-sm" onclick="acxBrMark(false)">Mark cleared</button>'
    +'<button class="btn btn-sm" onclick="acxBrMark(true)" title="Clears each selected entry on its own voucher date">Clear on voucher date</button><button class="btn btn-sm" onclick="acxBrUnmark()">Un-mark cleared</button></div>':'';
  body.innerHTML=sumHtml+act+mk('Receipts and deposits',recs,true)+mk('Payments and cheques issued',pays,false);
}
window.acxBrClearOn=function(){ BR.clearOn=val('brClearOn')||BR.clearOn; };
window.acxBrSel=function(id,on){ if(on) BR.sel.add(id); else BR.sel.delete(id); const c=$('brSelCount'); if(c) c.textContent=BR.sel.size+' selected'; };
window.acxBrAll=function(rec){ const list=BR.lines.filter(x=>rec?x.dr>0:x.cr>0); list.forEach(x=>BR.sel.add(x.id)); brDraw(); };
window.acxBrMark=async function(own){
  const ids=[...BR.sel]; if(!ids.length){ toast('Select the entries first','err'); return; }
  let n=0;
  if(own){
    const byDate={}; BR.lines.filter(x=>BR.sel.has(x.id)).forEach(x=>{(byDate[x.vouchers.voucher_date]=byDate[x.vouchers.voucher_date]||[]).push(x.id);});
    for(const d of Object.keys(byDate)){ const {data,error}=await rpc('mark_cleared',{p_line_ids:byDate[d],p_date:d}); if(fail(error,'Could not mark cleared')) return; n+=data; }
  }else{
    BR.clearOn=val('brClearOn')||BR.clearOn; if(!BR.clearOn){ toast('Enter the clearing date','err'); return; }
    const {data,error}=await rpc('mark_cleared',{p_line_ids:ids,p_date:BR.clearOn}); if(fail(error,'Could not mark cleared')) return; n=data;
  }
  toast(n+' entr'+(n===1?'y':'ies')+' marked cleared','ok'); brLoad();
};
window.acxBrUnmark=async function(){
  const ids=[...BR.sel]; if(!ids.length){ toast('Select the entries first','err'); return; }
  const {data,error}=await rpc('unmark_cleared',{p_line_ids:ids}); if(fail(error,'Could not un-mark')) return; toast(data+' entr'+(data===1?'y':'ies')+' un-marked','ok'); brLoad();
};
window.acxBrStmtSave=async function(){
  const raw=val('brStmt'); if(raw===''||!isFinite(parseFloat(raw.replace(/,/g,'')))){ toast('Enter the statement balance','err'); return; }
  const {error}=await AC().from('bank_statements').upsert({ledger_id:BR.ledger,as_on:BR.asOn,closing_balance:r2(num(raw)),updated_at:new Date().toISOString()},{onConflict:'ledger_id,as_on'});
  if(fail(error)) return; toast('Saved','ok'); brLoad();
};
window.acxBrCsv=function(){
  if(!BR.sum) return; const s=BR.sum;
  const rows=[['Bank reconciliation statement',s.ledger,'as on '+BR.asOn],['Balance as per books',s.book_balance],['Add: cheques issued not yet presented',s.total_payments],['Less: receipts / deposits not yet credited',s.total_receipts],['Balance as per bank (worked out)',s.balance_per_bank],['Balance on bank statement',s.statement_balance==null?'':s.statement_balance],[]];
  rows.push(['Voucher','Date','Type','Mode','Instrument','Particulars','Receipt','Payment','Bank cleared']);
  BR.lines.forEach(x=>rows.push([x.vouchers.doc_no,x.vouchers.voucher_date,x.vouchers.voucher_type,x.vouchers.mode||'',x.vouchers.instrument_no||'',x.vouchers.payee||x.vouchers.narration||'',x.dr||'',x.cr||'',x.cleared_on||'']));
  csv('bank-reconciliation-'+BR.asOn+'.csv',[],rows);
};

/* =================================================================== CHEQUE PRINTING */
const CHQ_DEF={date:{x:150,y:9,size:10,spacing:3.4},payee:{x:24,y:21,size:11},words1:{x:30,y:30,size:10,chars:58},words2:{x:12,y:38,size:10},amount:{x:152,y:36,size:12},acpayee:{x:8,y:8,size:9,show:1}};
const CQ={view:'print',filter:'todo',q:'',books:[],rows:[],cheques:{},bankOf:{},fmtLedger:'',fmt:null,from:'',to:''};
X.renderCheques=async function(host){
  if(!CQ.from) CQ.from=X.fyStart(today()); if(!CQ.to) CQ.to=today();
  const banks=S.ledgers.filter(l=>l.active&&l.is_bank);
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">Cheque printing</div><div class="acx-hint" style="margin:0">Issue cheques from payment vouchers, print them on the bank’s cheque leaf with the amount in words, and keep track of the cheque books.</div></div></div>'
    +(banks.length?'':'<div class="acx-warn">This company has no bank ledger yet — add one under Ledgers & postings › Chart of accounts.</div>')
    +'<div class="acx-subs">'+[['print','Cheques to print'],['books','Cheque books'],['format','Cheque layout']].map(v=>'<span class="chip'+(CQ.view===v[0]?' active':'')+'" onclick="acxCqView(\''+v[0]+'\')">'+v[1]+'</span>').join('')+'</div><div id="cqBody"></div>';
  await cqLoad();
};
window.acxCqView=function(v){ CQ.view=v; X.renderCheques($('acxSec')); };
async function cqLoad(){
  const body=$('cqBody'); if(!body) return; loader(body);
  const bankIds=S.ledgers.filter(l=>l.is_bank).map(l=>l.id);
  if(CQ.view==='books') return cqBooks(body,bankIds);
  if(CQ.view==='format') return cqFormat(body);
  // payments by cheque
  let vq=AC().from('vouchers').select('id,doc_no,voucher_date,payee,narration,amount,instrument_no,instrument_date,business_unit_id,status').eq('company_id',S.coId).eq('voucher_type','payment').eq('mode','cheque').eq('status','posted')
    .gte('voucher_date',CQ.from).lte('voucher_date',CQ.to).order('voucher_date',{ascending:false}).order('id',{ascending:false}).limit(600);
  if(S.buId) vq=vq.eq('business_unit_id',S.buId);
  const v=await vq; if(v.error){ body.innerHTML=X.errHtml(v.error); return; }
  CQ.rows=v.data||[]; const ids=CQ.rows.map(x=>x.id); CQ.cheques={}; CQ.bankOf={};
  if(ids.length){
    const [c,l]=await Promise.all([AC().from('cheques').select('*').in('voucher_id',ids).order('id'),AC().from('voucher_lines').select('voucher_id,ledger_id,cr').in('voucher_id',ids).gt('cr',0)]);
    (c.data||[]).forEach(x=>{ (CQ.cheques[x.voucher_id]=CQ.cheques[x.voucher_id]||[]).push(x); });
    (l.data||[]).forEach(x=>{ if(bankIds.includes(x.ledger_id)) CQ.bankOf[x.voucher_id]=x.ledger_id; });
  }
  cqDraw();
}
function activeCheque(vid){ const l=CQ.cheques[vid]||[]; return l.filter(c=>c.status!=='cancelled').slice(-1)[0]||null; }
function cqDraw(){
  const body=$('cqBody'); if(!body) return; const q=CQ.q.toLowerCase();
  const list=CQ.rows.filter(r=>{
    const c=activeCheque(r.id), st=!c?'none':c.status;
    if(CQ.filter==='todo'&&st==='printed') return false; if(CQ.filter==='printed'&&st!=='printed') return false;
    return !q||((r.doc_no||'')+' '+(r.payee||'')+' '+(r.narration||'')+' '+(c?c.cheque_no:r.instrument_no||'')).toLowerCase().includes(q);
  });
  const rows=list.map(r=>{const c=activeCheque(r.id), bank=CQ.bankOf[r.id], st=!c?['No cheque yet','t-gray']:c.status==='printed'?['Printed','t-green']:['Issued, not printed','t-amber'];
    return '<tr><td><span class="acx-code acx-link" onclick="acxVoucherOpen('+r.id+')">'+esc(r.doc_no)+'</span></td><td style="white-space:nowrap">'+dmy(r.voucher_date)+'</td><td>'+esc(r.payee||r.narration||'—')+'</td><td>'+esc(bank?X.ledName(bank):'—')+'</td>'
      +'<td class="acx-num"><b>'+money(r.amount)+'</b></td><td>'+(c?'<b>'+esc(c.cheque_no)+'</b>':(r.instrument_no?esc(r.instrument_no):'—'))+(c&&c.print_count?'<div class="acx-hint">printed '+c.print_count+'×</div>':'')+'</td><td><span class="tag '+st[1]+'">'+st[0]+'</span></td>'
      +'<td class="acx-act">'+(S.canPost?'<button class="btn btn-sm '+(c&&c.status==='printed'?'':'btn-primary')+'" onclick="acxChequeFor('+r.id+')">'+(c?(c.status==='printed'?'Reprint':'Print'):'Issue &amp; print')+'</button>'+(c?'<button class="btn btn-sm btn-ghost" title="Cancel this cheque (spoilt / lost)" onclick="acxChequeCancel('+c.id+')"><i class="fa-solid fa-ban"></i></button>':''):'')+'</td></tr>';}).join('');
  body.innerHTML='<div class="acx-top"><div class="acx-subs" style="margin:0">'+[['todo','To print'],['printed','Printed'],['all','All']].map(f=>'<span class="chip'+(CQ.filter===f[0]?' active':'')+'" onclick="acxCqFilter(\''+f[0]+'\')">'+f[1]+'</span>').join('')+'</div>'
    +'<input type="date" id="cqFrom" value="'+CQ.from+'" onchange="acxCqDates()"><span class="acx-hint">to</span><input type="date" id="cqTo" value="'+CQ.to+'" onchange="acxCqDates()"><input class="grow" id="cqQ" placeholder="Search by voucher, payee or cheque no." value="'+esc(CQ.q)+'" oninput="acxCqSearch()"></div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Payment</th><th>Date</th><th>Payee</th><th>Bank account</th><th class="acx-num">Amount</th><th>Cheque no</th><th>Status</th><th></th></tr></thead><tbody>'
    +(rows||'<tr><td colspan="8"><div class="empty" style="padding:24px"><div>No cheque payments here. Post a payment by cheque (Receipts & payments › New payment, or Pay a vendor) and it appears.</div></div></td></tr>')+'</tbody></table></div></div>';
}
window.acxCqFilter=function(f){ CQ.filter=f; cqDraw(); };
window.acxCqDates=function(){ CQ.from=val('cqFrom')||CQ.from; CQ.to=val('cqTo')||CQ.to; cqLoad(); };
window.acxCqSearch=function(){ CQ.q=val('cqQ'); cqDraw(); const e=$('cqQ'); if(e){ e.focus(); e.setSelectionRange(e.value.length,e.value.length); } };
window.acxChequeCancel=async function(id){
  const reason=await askReason('Cancel this cheque','Why? (spoilt, lost, stopped …)','Cancel cheque'); if(!reason) return;
  const {error}=await rpc('cheque_cancel',{p_id:id,p_reason:reason}); if(fail(error,'Could not cancel the cheque')) return; toast('Cheque cancelled — the next print uses the next number','ok');
  if(window.ACX&&$('cqBody')) cqLoad(); else route();
};

/* ---------------- cheque books ---------------- */
async function cqBooks(body,bankIds){
  const {data,error}=bankIds.length?await AC().from('cheque_books').select('*').in('ledger_id',bankIds).order('id',{ascending:false}):{data:[]};
  if(error){ body.innerHTML=X.errHtml(error); return; } CQ.books=data||[];
  const rows=CQ.books.map(b=>{const left=Math.max(0,b.to_no-b.next_no+1), used=b.next_no>b.to_no;
    return '<tr><td><b>'+esc(X.ledName(b.ledger_id))+'</b></td><td>'+esc(b.label||'—')+'</td><td>'+esc(b.prefix+String(b.from_no).padStart(b.width,'0'))+' – '+esc(b.prefix+String(b.to_no).padStart(b.width,'0'))+'</td>'
      +'<td>'+(used?'—':esc(b.prefix+String(b.next_no).padStart(b.width,'0')))+'</td><td class="acx-num">'+left+'</td><td>'+(used?'<span class="tag t-gray">Used up</span>':b.active?'<span class="tag t-green">In use</span>':'<span class="tag t-gray">Inactive</span>')+'</td>'
      +'<td class="acx-act">'+(S.canPost?'<button class="btn btn-sm btn-ghost" title="Edit" onclick="acxBookForm('+b.id+')"><i class="fa-solid fa-pen"></i></button>':'')+'</td></tr>';}).join('');
  body.innerHTML='<div class="toolbar"><div style="flex:1" class="acx-hint">A payment by cheque takes the next number from the bank account’s active cheque book.</div>'+(S.canPost?'<button class="btn btn-primary" onclick="acxBookForm()"><i class="fa-solid fa-plus"></i> Cheque book</button>':'')+'</div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Bank account</th><th>Label</th><th>Series</th><th>Next cheque</th><th class="acx-num">Left</th><th>Status</th><th></th></tr></thead><tbody>'
    +(rows||'<tr><td colspan="7"><div class="empty" style="padding:24px"><div>No cheque book yet</div></div></td></tr>')+'</tbody></table></div></div>';
}
window.acxBookForm=function(id){
  const banks=S.ledgers.filter(l=>l.active&&l.is_bank); if(!banks.length){ toast('Add a bank ledger first','err'); return; }
  const b=id?CQ.books.find(x=>x.id===id):{ledger_id:banks[0].id,label:'',prefix:'',from_no:'',to_no:'',next_no:'',width:6,active:true};
  X.formModal(id?'Edit cheque book':'New cheque book',
    field('Bank account','<select id="cbBank" '+(id?'disabled':'')+'>'+banks.map(l=>opt(l.id,l.name,b.ledger_id)).join('')+'</select>')
    +'<div class="acx-grid2">'+field('Label','<input id="cbLabel" value="'+esc(b.label||'')+'" placeholder="e.g. Book 3 — 2026">')+field('Prefix (optional)','<input id="cbPrefix" value="'+esc(b.prefix||'')+'">')+'</div>'
    +'<div class="acx-grid4">'+field('First cheque no','<input id="cbFrom" inputmode="numeric" value="'+esc(b.from_no)+'">')+field('Last cheque no','<input id="cbTo" inputmode="numeric" value="'+esc(b.to_no)+'">')
      +field('Next to use','<input id="cbNext" inputmode="numeric" value="'+esc(b.next_no)+'"><div class="h">Blank = the first</div>')+field('Digits','<input id="cbWidth" inputmode="numeric" value="'+esc(b.width)+'"><div class="h">Leading zeros</div>')+'</div>'
    +(id?'<div class="acx-field"><label><input type="checkbox" id="cbActive" '+(b.active?'checked':'')+'> In use</label></div>':''),'acxBookSave('+(id||0)+')');
};
window.acxBookSave=async function(id){
  const from=parseInt(val('cbFrom'),10), to=parseInt(val('cbTo'),10), width=parseInt(val('cbWidth'),10)||6;
  if(!isFinite(from)||!isFinite(to)||from>to){ toast('Enter the first and last cheque numbers','err'); return; }
  const nextRaw=val('cbNext'); const next=nextRaw===''?from:parseInt(nextRaw,10);
  if(!isFinite(next)||next<from||next>to+1){ toast('The next number must fall inside the book','err'); return; }
  const row={label:val('cbLabel')||null,prefix:val('cbPrefix'),from_no:from,to_no:to,next_no:next,width};
  if(!id) row.ledger_id=parseInt(val('cbBank'),10); else row.active=chk('cbActive');
  const {error}=id?await AC().from('cheque_books').update(row).eq('id',id):await AC().from('cheque_books').insert(row); if(fail(error)) return;
  closeModal(); toast('Saved','ok'); cqLoad();
};

/* ---------------- cheque layout ---------------- */
const FIELD_DEF=[['date','Date','Date (DDMMYYYY, one box per digit)'],['payee','Payee','Payee name'],['words1','Words — line 1','Amount in words, first line'],['words2','Words — line 2','Amount in words, second line'],['amount','Figures','Amount in figures'],['acpayee','A/C payee','“A/C PAYEE” crossing']];
async function cqFormat(body){
  const banks=S.ledgers.filter(l=>l.active&&l.is_bank); if(!banks.length){ body.innerHTML='<div class="empty"><div>No bank ledger yet</div></div>'; return; }
  if(!CQ.fmtLedger||!banks.find(b=>String(b.id)===String(CQ.fmtLedger))) CQ.fmtLedger=banks[0].id;
  const {data}=await AC().from('cheque_formats').select('*').eq('ledger_id',CQ.fmtLedger).maybeSingle();
  CQ.fmt=fmtFrom(data);
  body.innerHTML='<div class="acx-top"><select id="cfBank" onchange="acxCfBank()">'+banks.map(b=>opt(b.id,b.name,CQ.fmtLedger)).join('')+'</select><span class="acx-hint">Positions are in millimetres from the top-left corner of the cheque leaf. Print a test on plain paper, hold it against a real cheque, adjust, and save.</span></div>'
    +'<div class="acx-grid4">'+field('Cheque width (mm)','<input id="cfW" value="'+esc(CQ.fmt.width_mm)+'" oninput="acxCfPrev()">')+field('Cheque height (mm)','<input id="cfH" value="'+esc(CQ.fmt.height_mm)+'" oninput="acxCfPrev()">')+'<div></div><div></div></div>'
    +'<div class="card" style="padding:0;margin-bottom:12px"><div style="overflow-x:auto"><table class="tbl acx-mini"><thead><tr><th>Field</th><th>From left (mm)</th><th>From top (mm)</th><th>Size (pt)</th><th>Extra</th></tr></thead><tbody>'
    +FIELD_DEF.map(f=>{const L=CQ.fmt.layout[f[0]]; const inp=(k,w)=>'<input id="cf_'+f[0]+'_'+k+'" value="'+esc(L[k])+'" oninput="acxCfPrev()" style="width:'+(w||80)+'px;height:32px;border:1px solid var(--line);border-radius:6px;padding:0 8px;text-align:right">';
      return '<tr><td><b>'+f[1]+'</b><div class="acx-hint">'+f[2]+'</div></td><td>'+inp('x')+'</td><td>'+inp('y')+'</td><td>'+inp('size')+'</td><td>'
        +(f[0]==='date'?'Gap between digits (mm) '+inp('spacing'):f[0]==='words1'?'Characters on line 1 '+inp('chars'):f[0]==='acpayee'?'<label><input type="checkbox" id="cf_acpayee_show" '+(L.show?'checked':'')+' onchange="acxCfPrev()"> Print by default</label>':'')+'</td></tr>';}).join('')
    +'</tbody></table></div></div>'
    +'<div class="acx-top">'+(S.canPost?'<button class="btn btn-primary" onclick="acxCfSave()">Save layout</button><button class="btn" onclick="acxCfReset()">Reset to standard</button>':'')+'<button class="btn" onclick="acxCfTest()"><i class="fa-solid fa-print"></i> Print test</button></div>'
    +'<div id="cfPrev" style="overflow:auto;background:#e2e8f0;padding:14px;border-radius:10px"></div>';
  acxCfPrev();
}
function fmtFrom(row){
  const layout=JSON.parse(JSON.stringify(CHQ_DEF)); const sv=row&&row.layout||{};
  Object.keys(layout).forEach(k=>{ if(sv[k]) Object.assign(layout[k],sv[k]); });
  return {width_mm:row?Number(row.width_mm):202,height_mm:row?Number(row.height_mm):92,layout};
}
function fmtRead(){
  const f={width_mm:num(val('cfW'))||202,height_mm:num(val('cfH'))||92,layout:JSON.parse(JSON.stringify(CHQ_DEF))};
  FIELD_DEF.forEach(d=>{ const L=f.layout[d[0]]; Object.keys(L).forEach(k=>{ if(k==='show') L.show=chk('cf_acpayee_show')?1:0; else { const e=$('cf_'+d[0]+'_'+k); if(e&&e.value!=='') L[k]=num(e.value); } }); });
  return f;
}
window.acxCfBank=function(){ CQ.fmtLedger=parseInt(val('cfBank'),10); cqLoad(); };
window.acxCfPrev=function(){ const h=$('cfPrev'); if(!h) return; const f=fmtRead(); h.innerHTML=chequePreview(f,SAMPLE()); fitCheque(h); };
window.acxCfReset=function(){ CQ.fmt={width_mm:202,height_mm:92,layout:JSON.parse(JSON.stringify(CHQ_DEF))}; cqFormat($('cqBody')); };
window.acxCfSave=async function(){
  const f=fmtRead(); const {error}=await AC().from('cheque_formats').upsert({ledger_id:CQ.fmtLedger,width_mm:f.width_mm,height_mm:f.height_mm,layout:f.layout,updated_at:new Date().toISOString()},{onConflict:'ledger_id'});
  if(fail(error)) return; toast('Layout saved','ok');
};
window.acxCfTest=function(){ printHtml(chequeDoc(fmtRead(),SAMPLE())); };
const SAMPLE=()=>({payee:'SAMPLE PAYEE NAME PRIVATE LIMITED',amount:1234567.5,cheque_date:today(),crossed:true});

/* ---------------- drawing and printing one cheque ---------------- */
function chequeFields(f,c){
  const L=f.layout, dt=String(c.cheque_date||today()).slice(0,10).split('-'), digits=(dt[2]+dt[1]+dt[0]).split('');
  const words=inrWords(c.amount).replace(/ and /,' and '); const cut=Math.max(10,L.words1.chars||58);
  let w1=words, w2=''; if(words.length>cut){ let i=words.lastIndexOf(' ',cut); if(i<10) i=cut; w1=words.slice(0,i); w2=words.slice(i).trim(); }
  const amtTxt=Number(c.amount).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})+'/-';
  const pos=(k,extra)=>'left:'+L[k].x+'mm;top:'+L[k].y+'mm;font-size:'+L[k].size+'pt;'+(extra||'');
  let h='';
  h+='<div class="cf" style="'+pos('date')+'">'+digits.map(d=>'<span style="display:inline-block;width:'+(L.date.spacing||3.4)+'mm;text-align:center">'+d+'</span>').join('')+'</div>';
  h+='<div class="cf" style="'+pos('payee')+'text-transform:uppercase;font-weight:600">'+esc(c.payee||'')+'</div>';
  h+='<div class="cf" style="'+pos('words1')+'">'+esc(w1)+'</div>';
  if(w2) h+='<div class="cf" style="'+pos('words2')+'">'+esc(w2)+'</div>';
  h+='<div class="cf" style="'+pos('amount')+'font-weight:700">'+esc(amtTxt)+'</div>';
  if(c.crossed&&L.acpayee.show!==0) h+='<div class="cf" style="'+pos('acpayee','border-top:.35mm solid #000;border-bottom:.35mm solid #000;padding:.4mm 2.5mm;transform:rotate(-28deg);transform-origin:left top;font-weight:700;letter-spacing:.2mm')+'">A/C PAYEE</div>';
  return h;
}
const CF_CSS='.cf{position:absolute;white-space:nowrap;font-family:Arial,Helvetica,sans-serif;color:#000;line-height:1}';
function chequePreview(f,c){
  return '<div class="cqp" data-w="'+f.width_mm+'" data-h="'+f.height_mm+'" style="width:'+(f.width_mm*3.7795)+'px;height:'+(f.height_mm*3.7795)+'px"><div style="width:'+f.width_mm+'mm;height:'+f.height_mm+'mm;position:relative;background:#fffef7;border:1px solid #94a3b8;transform-origin:top left;box-shadow:0 1px 4px rgba(0,0,0,.15)"><style>'+CF_CSS+'</style>'+chequeFields(f,c)
    +'<div style="position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;background-image:linear-gradient(#0000 calc(100% - 1px),#e5e7eb 0);background-size:100% 10mm;opacity:.5"></div></div></div>';
}
// shrink the preview to fit the box it sits in (the cheque leaf is wider than a phone or a small modal)
function fitCheque(host){
  const p=host&&host.querySelector('.cqp'); if(!p) return;
  const w=parseFloat(p.dataset.w)*3.7795, h=parseFloat(p.dataset.h)*3.7795, avail=Math.max(120,host.clientWidth-30), s=Math.min(1,avail/w);
  p.style.width=(w*s)+'px'; p.style.height=(h*s)+'px'; p.firstElementChild.style.transform='scale('+s+')';
}
function chequeDoc(f,c){
  return '<!doctype html><html><head><meta charset="utf-8"><title>Cheque</title><style>@page{size:'+f.width_mm+'mm '+f.height_mm+'mm;margin:0}html,body{margin:0;padding:0}'+CF_CSS+'</style></head><body><div style="position:relative;width:'+f.width_mm+'mm;height:'+f.height_mm+'mm;overflow:hidden">'+chequeFields(f,c)+'</div></body></html>';
}
function printHtml(html){
  const old=document.getElementById('acxPrintFrame'); if(old) old.remove();
  const fr=document.createElement('iframe'); fr.id='acxPrintFrame'; fr.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(fr); const d=fr.contentWindow.document; d.open(); d.write(html); d.close();
  setTimeout(()=>{ try{ fr.contentWindow.focus(); fr.contentWindow.print(); }catch(e){ toast('Could not open the print dialog','err'); } },250);
}
X.printHtml=printHtml;

// Issue (if needed) and show the cheque of a payment voucher, ready to print.
let CP=null;
window.acxChequeFor=async function(voucherId){
  let r=await rpc('cheque_issue',{p_voucher_id:voucherId}); if(fail(r.error,'Could not issue the cheque')) return;
  const cid=r.data;
  const [c,v]=await Promise.all([AC().from('cheques').select('*').eq('id',cid).single(),AC().from('vouchers').select('id,doc_no,payee,narration').eq('id',voucherId).single()]);
  if(c.error){ fail(c.error,'Could not load the cheque'); return; }
  const {data:fm}=await AC().from('cheque_formats').select('*').eq('ledger_id',c.data.ledger_id).maybeSingle();
  CP={cheque:c.data,fmt:fmtFrom(fm),voucher:v.data};
  cpDraw();
};
function cpDraw(){
  const c=CP.cheque, f=CP.fmt, name=X.ledName(c.ledger_id);
  openModal('<div class="modal-head"><h3>Cheque '+esc(c.cheque_no)+' — '+esc(name)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body">'
    +'<div class="acx-grid3">'+field('Payee','<input id="cpPayee" value="'+esc(c.payee||'')+'" oninput="acxCpPrev()">')+field('Cheque date','<input type="date" id="cpDate" value="'+esc(c.cheque_date)+'" oninput="acxCpPrev()">')
      +field('Crossing','<label style="display:flex;gap:8px;align-items:center;height:38px"><input type="checkbox" id="cpCross" '+(c.crossed?'checked':'')+' onchange="acxCpPrev()"> A/C PAYEE</label>')+'</div>'
    +'<div class="acx-hint" style="margin-bottom:8px">Amount '+money(c.amount)+' · '+esc(inrWords(c.amount))+'. Make sure the cheque leaf is loaded the right way round, then print.'+(c.status==='printed'?' <b>This cheque has been printed '+c.print_count+' time'+(c.print_count===1?'':'s')+' already.</b>':'')+'</div>'
    +'<div id="cpPrev" style="overflow:auto;background:#e2e8f0;padding:14px;border-radius:10px"></div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button><button class="btn btn-primary" onclick="acxCpPrint()"><i class="fa-solid fa-print"></i> Print cheque</button></div>','lg');
  acxCpPrev();
}
function cpCurrent(){ const c=CP.cheque; return {payee:val('cpPayee')||c.payee,amount:Number(c.amount),cheque_date:val('cpDate')||c.cheque_date,crossed:chk('cpCross')}; }
window.acxCpPrev=function(){ const h=$('cpPrev'); if(h){ h.innerHTML=chequePreview(CP.fmt,cpCurrent()); fitCheque(h); } };
window.acxCpPrint=async function(){
  printHtml(chequeDoc(CP.fmt,cpCurrent()));
  const {error}=await rpc('cheque_mark_printed',{p_id:CP.cheque.id}); if(fail(error,'Printed, but could not record it')) return;
  toast('Sent to the printer — marked as printed','ok');
  if($('cqBody')) cqLoad();
};
})();
