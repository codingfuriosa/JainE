/* ===========================================================================
   JAIN-E · ENGINEERING — RA Bills   [loads after engineering-wo.js]
   A running-account bill books verified work done: gross = Σ (quantity × work-order rate),
   + GST, − retention, − TDS, − other deductions = net payable.  A bill starts as a Draft (it reserves
   the work it covers), is then Booked (locked), and can be cancelled with a reason to release the work.
   The same arithmetic runs in the database views, so what is shown here is what is stored.
   =========================================================================== */
(function(){
  if(typeof window.ENG==='undefined')return;
  const ENG=window.ENG;
  const {E,lc,num,inr,q,dt,istToday,val,numOrNull,stTag,LOAD,fail,run,fetchAll,head,modal,cancelBtn,opts,pager,projBar,projName,curProject,C}=ENG;
  const L=()=>ENG.L;
  const PAGE_SIZE=100;
  const r2=n=>Math.round((n+Number.EPSILON)*100)/100;
  function totals(gross,b){
    const gst=r2(gross*num(b.gst_pct)/100),ret=r2(gross*num(b.retention_pct)/100),tds=r2(gross*num(b.tds_pct)/100),oth=num(b.other_deduction);
    return {gross:gross,gst:gst,ret:ret,tds:tds,oth:oth,net:r2(gross+gst-ret-tds-oth)};
  }
  const totBox=(t,b)=>'<div class="eng-tot"><div><span>Gross value of work</span><b>'+inr(t.gross)+'</b></div><div><span>+ GST @ '+q(b.gst_pct)+'%</span><span>'+inr(t.gst)+'</span></div><div><span>− Retention @ '+q(b.retention_pct)+'%</span><span>'+inr(t.ret)+'</span></div><div><span>− TDS @ '+q(b.tds_pct)+'%</span><span>'+inr(t.tds)+'</span></div>'+
    (t.oth?'<div><span>− Other deductions'+(b.other_deduction_note?' <span style="color:var(--slate)">('+esc(b.other_deduction_note)+')</span>':'')+'</span><span>'+inr(t.oth)+'</span></div>':'')+
    '<div class="net"><span>Net payable</span><span>'+inr(t.net)+'</span></div></div>';

  /* ---- Accounts link: has this booked bill been posted to the ledgers, and how much of it is paid?
     Read through accounts.ra_bill_accounts(), which shows Engineering only these figures. If Accounts is not set
     up (or the call fails) the screens simply show "not posted" and carry on. ---- */
  const chunk=(a,n)=>{const r=[];for(let i=0;i<a.length;i+=n)r.push(a.slice(i,i+n));return r;};
  async function accStatus(ids){
    const out={};
    try{
      for(const part of chunk(ids,500)){
        const {data,error}=await sb.schema('accounts').rpc('ra_bill_accounts',{p_ids:part});
        if(error)return out;
        (data||[]).forEach(x=>{out[x.ra_bill_id]=x;});
      }
    }catch(e){}
    return out;
  }
  const accCell=r=>{
    if(r.status!=='Booked')return '<span style="color:var(--slate)">—</span>';
    const a=(L().raAcc||{})[r.id];
    if(!a)return '<span class="tag t-amber">Not yet posted</span>';
    const out=num(a.outstanding);
    return '<span class="tag '+(out<=0.004&&a.net!=null?'t-green':'t-blue')+'">'+(out<=0.004&&a.net!=null?'Paid':'Posted')+'</span><div class="sub" style="font-size:12px;color:var(--slate)">Paid '+inr(a.paid)+' of '+inr(a.net)+'</div>';
  };
  const accBox=B=>{
    if(B.status!=='Booked')return '';
    const a=(L().raAcc||{})[B.id];
    if(!a)return '<div class="eng-note eng-noprint" style="margin-top:14px"><b>Accounts:</b> not posted yet. Accounts posts booked bills to the ledgers — GST, TDS and retention are entered there, and payment is made from there.</div>';
    return '<div class="eng-noprint" style="margin-top:14px;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:#f8fafc"><div style="font-weight:700;margin-bottom:6px"><i class="fa-solid fa-calculator" style="color:#0e7490"></i> Accounts</div>'+
      '<div class="eng-sum" style="gap:6px 22px;flex-wrap:wrap"><span>Posted as <b>'+esc(a.voucher_no)+'</b> <span style="color:var(--slate)">('+esc(a.company)+', '+dt(a.posted_on)+')</span></span><span>Net payable <b>'+inr(a.net)+'</b></span><span>Paid <b>'+inr(a.paid)+'</b></span><span>Outstanding <b>'+inr(a.outstanding)+'</b></span>'+
      (num(a.retention)>0?'<span>Retention held <b>'+inr(a.retention)+'</b> <span style="color:var(--slate)">(released '+inr(a.retention_released)+', still held '+inr(a.retention_outstanding)+')</span></span>':'')+'</div></div>';
  };

  /* ======================================================================= LIST / DETAIL */
  ENG.routes.ra=async function(v,a,t){
    if(a[0])return raDetail(v,Number(a[0]),t);
    const pid=curProject();
    v.innerHTML=head('ra','Running-account bills booked against verified work',
      '<button class="btn btn-primary" onclick="ENG.f.raNew()"><i class="fa-solid fa-plus"></i> New RA bill</button>')+projBar(true)+'<div id="engBody">'+LOAD+'</div>';
    const rows=await fetchAll(()=>{let x=E().from('v_ra_bills').select('*').order('id',{ascending:false});if(pid)x=x.eq('project_id',pid);return x;});
    if(ENG.stale(t))return;
    L().raRows=rows;L().raF={status:'',q:'',page:0};
    L().raAcc=await accStatus(rows.filter(r=>r.status==='Booked').map(r=>r.id));
    if(ENG.stale(t))return;
    $('engBody').innerHTML=
      '<div class="eng-filter"><div class="toolbar grow" style="margin:0;flex:1;min-width:200px"><div class="grow"><i class="fa-solid fa-magnifying-glass"></i><input placeholder="Search bill, work order or contractor…" oninput="ENG.f.raFilter(\'q\',this.value)"></div></div>'+
      '<select class="sel" onchange="ENG.f.raFilter(\'status\',this.value)">'+opts(['Draft','Booked','Cancelled'],x=>x,x=>x,'','All statuses')+'</select></div><div class="card eng-tbl" id="raCard"></div>';
    ENG.f.raRender();
  };
  ENG.f.raFilter=function(k,v){const f=L().raF;f[k]=v;f.page=0;ENG.f.raRender();};
  ENG.f.raPage=function(p){L().raF.page=p;ENG.f.raRender();};
  ENG.f.raRender=function(){
    const f=L().raF,qq=lc(f.q).trim();
    const rows=(L().raRows||[]).filter(r=>(!f.status||r.status===f.status)&&(!qq||lc(r.bill_no+' '+r.wo_no+' '+r.vendor_name+' '+(r.sub_names||'')+' '+r.contractor_ref).indexOf(qq)>=0));
    const pg=rows.slice(f.page*PAGE_SIZE,(f.page+1)*PAGE_SIZE);
    const booked=rows.filter(r=>r.status==='Booked');
    $('raCard').innerHTML=rows.length?
      '<div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="eng-sum"><span><b>'+rows.length+'</b> bill'+(rows.length===1?'':'s')+'</span><span>Booked gross <b>'+inr(booked.reduce((s,r)=>s+num(r.gross),0))+'</b></span><span>Booked net payable <b>'+inr(booked.reduce((s,r)=>s+num(r.net_payable),0))+'</b></span></div></div>'+
      '<table class="tbl"><thead><tr><th>Bill</th><th>Parent contractor</th><th>Business unit</th><th>Date</th><th class="r">Gross</th><th class="r">Net payable</th><th>Status</th><th>Accounts</th></tr></thead><tbody>'+
      pg.map(r=>'<tr class="clk" onclick="navTo(\'engineering/ra/'+r.id+'\')"><td><b>'+esc(r.bill_no)+'</b>'+(r.contractor_ref?'<div class="sub" style="font-size:12px;color:var(--slate)">Contractor ref '+esc(r.contractor_ref)+'</div>':'')+'</td><td>'+esc(r.vendor_name)+(r.sub_names?'<div class="sub" style="font-size:12px;color:var(--slate)">Sub: '+esc(r.sub_names)+'</div>':'')+'</td><td>'+esc(r.project_name)+'</td><td>'+dt(r.bill_date)+'</td><td class="r">'+inr(r.gross)+'</td><td class="r"><b>'+inr(r.net_payable)+'</b></td><td>'+stTag(r.status)+'</td><td>'+accCell(r)+'</td></tr>').join('')+
      '</tbody></table>'+pager(rows.length,f.page,PAGE_SIZE,'ENG.f.raPage'):
      '<div class="empty" style="padding:44px"><i class="fa-solid fa-file-invoice-dollar"></i><div style="font-weight:600;color:var(--ink)">'+((L().raRows||[]).length?'No bills match':'No RA bills yet')+'</div>'+((L().raRows||[]).length?'':'<p>Once work done has been verified, raise an RA bill against it.</p>')+'</div>';
  };

  async function raDetail(v,id,t){
    v.innerHTML=head('ra','','')+LOAD;
    const [b,lines]=await Promise.all([
      E().from('v_ra_bills').select('*').eq('id',id).maybeSingle(),
      fetchAll(()=>E().from('v_ra_bill_lines').select('*').eq('ra_bill_id',id).order('activity_name').order('location_label').order('wo_item_id'))
    ]);
    if(ENG.stale(t))return;
    if(b.error)throw b.error;
    if(!b.data){v.innerHTML=head('ra','','')+'<div class="card card-pad empty"><i class="fa-solid fa-file-invoice-dollar"></i><div style="font-weight:600;color:var(--ink)">RA bill not found</div><p><a style="color:var(--brand);cursor:pointer" onclick="navTo(\'engineering/ra\')">Back to RA bills</a></p></div>';return;}
    const B=b.data;L().raCur=B;
    if(B.status==='Booked'){const m=await accStatus([id]);L().raAcc=Object.assign(L().raAcc||{},m);if(ENG.stale(t))return;}
    const t0=totals(num(B.gross),B);
    const draft=B.status==='Draft',booked=B.status==='Booked',posted=booked&&!!(L().raAcc||{})[id];
    v.innerHTML=head('ra','','')+
      '<div class="eng-noprint" style="margin-bottom:14px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><button class="btn btn-sm" onclick="navTo(\'engineering/ra\')"><i class="fa-solid fa-arrow-left"></i> All RA bills</button>'+
        '<div class="eng-actions">'+
        (draft?'<button class="btn" onclick="ENG.f.raEdit('+id+')"><i class="fa-solid fa-pen"></i> Edit details</button><button class="btn btn-ok" onclick="ENG.f.raBook('+id+')"><i class="fa-solid fa-stamp"></i> Book bill</button>':'')+
        (booked?'<button class="btn" onclick="window.print()"><i class="fa-solid fa-print"></i> Print</button>':'')+
        (draft||(booked&&!posted)?'<button class="btn btn-danger" onclick="ENG.f.raCancel('+id+')">Cancel bill</button>':'')+
        (posted?'<button class="btn btn-danger" disabled title="Accounts has posted this bill. Ask Accounts to reverse the posting first, then cancel it here.">Cancel bill</button>':'')+'</div></div>'+
      '<div class="card eng-sheet">'+
        '<div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap"><div><div style="font-size:12px;letter-spacing:.06em;color:var(--slate);font-weight:700">RUNNING ACCOUNT BILL</div><div style="font-size:22px;font-weight:700;margin-top:2px">'+esc(B.bill_no)+' '+stTag(B.status)+'</div>'+
        (draft?'<div class="eng-note eng-noprint" style="margin-top:8px">Draft — this bill reserves the work below. Book it to lock it, or cancel it to release the work.</div>':'')+
        (B.status==='Cancelled'?'<div class="eng-note" style="margin-top:8px">Cancelled'+(B.cancelled_by?' by '+esc(String(B.cancelled_by).split('@')[0]):'')+': '+esc(B.cancel_reason||'')+'</div>':'')+'</div>'+
        '<div class="eng-sum" style="flex-direction:column;gap:4px;align-items:flex-end"><span>Bill date <b>'+dt(B.bill_date)+'</b></span>'+
          (B.billing_type?'<span>Type <b>'+esc(B.billing_type)+(B.ra_seq?' '+B.ra_seq:'')+'</b></span>':'')+
          (B.financial_year?'<span>Financial year <b>'+esc(B.financial_year)+'</b></span>':'')+
          (B.contractor_ref?'<span>Invoice no. <b>'+esc(B.contractor_ref)+'</b>'+(B.invoice_date?' dated <b>'+dt(B.invoice_date)+'</b>':'')+'</span>':'')+
          (B.due_date?'<span>Due <b>'+dt(B.due_date)+'</b></span>':'')+
          (B.wo_value!=null?'<span>Work order amount <b>'+inr(B.wo_value)+'</b></span>':'')+
          (B.parent_contractor?'<span>Parent contractor <b>'+esc(B.parent_contractor)+'</b></span>':'')+
          (B.period_from||B.period_to?'<span>Period <b>'+dt(B.period_from)+' → '+dt(B.period_to)+'</b></span>':'')+'</div></div>'+
        '<div class="eng-sum" style="margin:16px 0"><span>Parent contractor <b>'+esc(B.vendor_name)+'</b></span>'+(B.sub_names?'<span>Sub-contractors <b>'+esc(B.sub_names)+'</b></span>':'')+'<span>Project <b>'+esc(B.project_name)+'</b></span><span>Work order <b><a style="color:var(--brand);cursor:pointer" onclick="navTo(\'engineering/wo/'+B.wo_id+'\')">'+esc(B.wo_no)+'</a></b></span></div>'+
        '<div class="eng-tbl"><table class="tbl"><thead><tr><th>#</th><th>Activity / location</th><th class="r">Rate</th><th class="r">WO qty</th><th class="r">Previous</th><th class="r">This bill</th><th class="r">Cumulative</th><th class="r">Amount</th></tr></thead><tbody>'+
        (lines.length?lines.map((l,i)=>{const cum=num(l.prev_qty)+num(l.qty);return '<tr><td>'+(i+1)+'</td><td><b>'+esc(l.activity_name)+'</b>'+(l.sub_vendor_name?' <span class="tag t-purple">'+esc(l.sub_vendor_name)+'</span>':'')+'<div class="sub" style="font-size:12px;color:var(--slate)">'+esc(l.location_label)+'</div></td><td class="r">'+inr(l.rate)+'</td><td class="r">'+q(l.wo_qty)+' '+esc(l.uom)+'</td><td class="r">'+q(l.prev_qty)+'</td><td class="r"><b>'+q(l.qty)+'</b></td><td class="r">'+q(cum)+' <span style="color:var(--slate)">('+ENG.pct(cum,num(l.wo_qty))+'%)</span></td><td class="r">'+inr(l.amount)+'</td></tr>';}).join(''):'<tr><td colspan="8"><div class="empty" style="padding:24px">No work on this bill</div></td></tr>')+
        '</tbody></table></div>'+
        '<div style="display:flex;gap:24px;flex-wrap:wrap;margin-top:18px"><div class="eng-sum" style="flex-direction:column;gap:5px;align-self:flex-start"><span>Billed on earlier RA bills <b>'+inr(B.prev_gross)+'</b></span><span>Cumulative gross to this bill <b>'+inr(num(B.prev_gross)+num(B.gross))+'</b></span>'+(B.remarks?'<span style="max-width:360px;white-space:pre-wrap">Remarks: <b>'+esc(B.remarks)+'</b></span>':'')+'</div>'+totBox(t0,B)+'</div>'+
        accBox(B)+
        (B.booked_by?'<div style="margin-top:18px;font-size:12px;color:var(--slate)">Booked by '+esc(String(B.booked_by).split('@')[0])+' on '+dt(B.booked_at)+'</div>':'')+
      '</div>';
  }

  /* ---------------------------------------------------------------- edit / book / cancel */
  ENG.f.raEdit=function(id){
    const B=L().raCur;if(!B||B.id!==id)return;
    modal('Edit RA bill — '+esc(B.bill_no),
      '<div class="two"><div><label>Bill date</label><input id="raDate" type="date" value="'+esc(B.bill_date)+'"></div><div><label>Financial year</label><input id="raFY" value="'+esc(B.financial_year||'')+'" placeholder="2026-27"></div></div>'+
      '<div class="two"><div><label>Invoice number <span style="color:var(--slate);font-weight:400">the contractor’s own bill no.</span></label><input id="raRef" value="'+esc(B.contractor_ref)+'"></div>'+
      '<div><label>Invoice date</label><input id="raInvD" type="date" value="'+esc(B.invoice_date||'')+'"></div></div>'+
      '<div class="two"><div><label>Due date</label><input id="raDue" type="date" value="'+esc(B.due_date||'')+'"></div>'+
      '<div><label>Billing type</label><select id="raType">'+opts(['RA Bill','Sub-Bill','Final Bill','Advance'],x=>x,x=>x,B.billing_type||'RA Bill')+'</select></div></div>'+
      '<label>Parent contractor <span style="color:var(--slate);font-weight:400">optional</span></label><input id="raParent" value="'+esc(B.parent_contractor||'')+'">'+
      '<div class="two"><div><label>Period from</label><input id="raFrom" type="date" value="'+esc(B.period_from||'')+'"></div><div><label>Period to</label><input id="raTo" type="date" value="'+esc(B.period_to||'')+'"></div></div>'+
      '<div class="two" style="grid-template-columns:1fr 1fr 1fr"><div><label>Retention %</label><input id="raRet" type="number" min="0" max="100" step="0.01" value="'+num(B.retention_pct)+'"></div><div><label>TDS %</label><input id="raTds" type="number" min="0" max="100" step="0.01" value="'+num(B.tds_pct)+'"></div><div><label>GST %</label><input id="raGst" type="number" min="0" max="100" step="0.01" value="'+num(B.gst_pct)+'"></div></div>'+
      '<div class="two"><div><label>Other deduction (₹)</label><input id="raOth" type="number" min="0" step="0.01" value="'+num(B.other_deduction)+'"></div><div><label>Deduction note</label><input id="raOthN" value="'+esc(B.other_deduction_note)+'" placeholder="e.g. material issued, penalty"></div></div>'+
      '<label>Remarks</label><textarea id="raRem">'+esc(B.remarks)+'</textarea>',
      cancelBtn+'<button class="btn btn-primary" onclick="ENG.f.raEditSave(this,'+id+')"><i class="fa-solid fa-check"></i> Save</button>');
  };
  ENG.f.raEditSave=function(btn,id){
    return run(btn,async()=>{
      const n=k=>{const x=numOrNull(val(k));return x==null||isNaN(x)?NaN:x;};
      const row={bill_date:val('raDate')||null,contractor_ref:val('raRef').trim()||null,period_from:val('raFrom')||null,period_to:val('raTo')||null,
        retention_pct:n('raRet'),tds_pct:n('raTds'),gst_pct:n('raGst'),other_deduction:n('raOth'),other_deduction_note:val('raOthN').trim()||null,remarks:val('raRem').trim()||null,
        invoice_date:val('raInvD')||null,due_date:val('raDue')||null,billing_type:val('raType')||null,
        parent_contractor:val('raParent').trim()||null,financial_year:val('raFY').trim()||null};
      if(!row.bill_date)return toast('Enter the bill date','warn');
      /* Blanking these on an edit would leave Accounts with a payable it cannot age and a bill in
         no financial year, so they fall back to what the bill date implies rather than to null. */
      if(!row.due_date)row.due_date=row.bill_date;
      if(!row.financial_year){const y=Number(row.bill_date.slice(0,4)),m=Number(row.bill_date.slice(5,7)),s=(m>=4)?y:y-1;
        row.financial_year=s+'-'+String((s+1)%100).padStart(2,'0');}
      for(const k of ['retention_pct','tds_pct','gst_pct'])if(isNaN(row[k])||row[k]<0||row[k]>100)return toast('Retention, TDS and GST must be between 0 and 100','warn');
      if(isNaN(row.other_deduction)||row.other_deduction<0)return toast('Enter a valid other deduction (0 if none)','warn');
      const {error}=await E().from('ra_bills').update(row).eq('id',id);if(error)throw error;
      closeModal();toast('Bill updated','ok');renderPage();
    });
  };
  ENG.f.raBook=async function(id){
    const B=L().raCur;
    if(!await confirmDialog('Book '+B.bill_no+' for '+inr(B.net_payable)+' net payable? A booked bill is locked.',{okLabel:'Book bill',danger:false,icon:'fa-stamp'}))return;
    try{const {error}=await E().rpc('ra_bill_book',{p_id:id});if(error)throw error;toast('RA bill booked','ok');renderPage();}catch(e){fail(e);}
  };
  ENG.f.raCancel=function(id){
    const B=L().raCur;
    modal('Cancel '+esc(B.bill_no),'<div class="eng-note">The work on this bill is released, so it can be billed again on a new RA bill.</div><label>Reason</label><textarea id="raWhy" placeholder="Why is this bill being cancelled?"></textarea>',
      cancelBtn.replace('Cancel','Back')+'<button class="btn btn-danger-solid" onclick="ENG.f.raCancelSave(this,'+id+')">Cancel bill</button>');
  };
  ENG.f.raCancelSave=function(btn,id){
    return run(btn,async()=>{
      const why=val('raWhy').trim();if(!why)return toast('Give a reason','warn');
      const {error}=await E().rpc('ra_bill_cancel',{p_id:id,p_reason:why});if(error)throw error;
      closeModal();toast('RA bill cancelled — the work is available to bill again','ok');renderPage();
    });
  };

  /* ======================================================================= NEW RA BILL */
  const N={entries:[],wos:{},byWo:{},sel:new Set(),woId:null};
  ENG.f.raNew=async function(woId){
    modal('New RA bill',LOAD,'','xl');
    try{
      const pid=curProject();
      N.entries=await fetchAll(()=>{let x=E().from('v_work_done').select('*').eq('status','Verified').is('ra_bill_id',null).eq('wo_status','Issued').order('wo_id').order('entry_date').order('id');if(pid)x=x.eq('project_id',pid);return x;});
      const ids=[...new Set(N.entries.map(e=>e.wo_id))];
      N.wos={};N.byWo={};
      // `value` is the work order's own amount, shown beside the bill the way the old system did.
      if(ids.length){const {data,error}=await E().from('v_work_orders').select('id,wo_no,project_id,project_name,vendor_name,sub_names,retention_pct,tds_pct,gst_pct,value').in('id',ids);if(error)throw error;(data||[]).forEach(w=>N.wos[w.id]=w);}
      N.entries.forEach(e=>(N.byWo[e.wo_id]=N.byWo[e.wo_id]||[]).push(e));
    }catch(e){return fail(e);}
    const body=$('modalHost').querySelector('.modal-body');
    const ids=Object.keys(N.byWo).map(Number);
    if(!ids.length){body.innerHTML='<div class="empty" style="padding:34px"><i class="fa-solid fa-circle-check"></i><div style="font-weight:600;color:var(--ink)">No verified work is waiting to be billed</div><p>Enter work done on an issued work order and have it verified by another person first.</p></div>';return;}
    N.woId=(woId&&N.byWo[woId])?woId:ids[0];
    body.innerHTML=
      '<label>Work order</label><select id="rnWo" onchange="ENG.f.rnWo()">'+opts(ids.map(i=>N.wos[i]).filter(Boolean),w=>w.id,w=>w.wo_no+' — '+w.vendor_name+(w.sub_names?' (sub: '+w.sub_names+')':'')+' · '+w.project_name+' · '+N.byWo[w.id].length+' entr'+(N.byWo[w.id].length===1?'y':'ies'),N.woId)+'</select>'+
      /* Business unit, contractor and the order's value are not asked for — they are facts about
         the work order already chosen above, so they are shown rather than typed. Storing them on
         the bill as well would be a second copy that can disagree with the order. */
      '<div id="rnHdr" class="eng-note" style="margin:8px 0 2px"></div>'+
      '<div class="two" style="margin-top:4px"><div><label>Bill date</label><input id="rnDate" type="date" value="'+istToday()+'" onchange="ENG.f.rnDates()"></div>'+
      '<div><label>Financial year</label><input id="rnFY" placeholder="2026-27"></div></div>'+
      '<div class="two"><div><label>Invoice number <span style="color:var(--slate);font-weight:400">the contractor’s own bill no.</span></label><input id="rnRef"></div>'+
      '<div><label>Invoice date <span style="color:var(--slate);font-weight:400">on the contractor’s bill</span></label><input id="rnInvD" type="date"></div></div>'+
      '<div class="two"><div><label>Due date</label><input id="rnDue" type="date"></div>'+
      '<div><label>Billing type</label><select id="rnType">'+opts(['RA Bill','Sub-Bill','Final Bill','Advance'],x=>x,x=>x,'RA Bill')+'</select></div></div>'+
      '<label>Parent contractor <span style="color:var(--slate);font-weight:400">the control account this contractor sits under — optional</span></label><input id="rnParent" placeholder="e.g. Sundry creditors – expenses">'+
      '<div class="two"><div><label>Period from <span style="color:var(--slate);font-weight:400">optional</span></label><input id="rnFrom" type="date"></div><div><label>Period to <span style="color:var(--slate);font-weight:400">optional</span></label><input id="rnTo" type="date"></div></div>'+
      '<div style="font-size:12.5px;font-weight:600;margin:16px 0 6px">Verified work to bill</div><div id="rnList" class="eng-tbl" style="border:1px solid var(--line);border-radius:9px;max-height:34vh;overflow:auto"></div>'+
      '<div class="two" style="margin-top:6px"><div><label>Other deduction (₹) <span style="color:var(--slate);font-weight:400">optional</span></label><input id="rnOth" type="number" min="0" step="0.01" value="0" oninput="ENG.f.rnSum()"></div><div><label>Deduction note</label><input id="rnOthN" placeholder="e.g. material issued, penalty"></div></div>'+
      '<label>Narration <span style="color:var(--slate);font-weight:400">optional</span></label><input id="rnRem" placeholder="e.g. being amount payable for labour charges">'+
      '<div id="rnSum" style="margin-top:14px"></div>';
    $('modalHost').querySelector('.modal').insertAdjacentHTML('beforeend','<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="rnGo" onclick="ENG.f.rnSave(this)"><i class="fa-solid fa-file-invoice-dollar"></i> Create draft bill</button></div>');
    ENG.f.rnDates();
    ENG.f.rnWo();
  };
  /* Financial year and due date follow the bill date until somebody changes them by hand, which
     is what they are for: a bill dated in April can belong to the year just closed. Both are only
     ever PREFILLED — once a field holds something, re-dating the bill leaves it alone. */
  ENG.f.rnDates=function(){
    const d=val('rnDate'); if(!d) return;
    const y=Number(d.slice(0,4)), m=Number(d.slice(5,7));
    const start=(m>=4)?y:y-1;
    const fy=$('rnFY'), due=$('rnDue');
    if(fy&&!fy.dataset.touched) fy.value=start+'-'+String((start+1)%100).padStart(2,'0');
    if(due&&!due.dataset.touched) due.value=d;
    if(fy&&!fy._w){fy._w=1;fy.addEventListener('input',()=>{fy.dataset.touched='1';});}
    if(due&&!due._w){due._w=1;due.addEventListener('input',()=>{due.dataset.touched='1';});}
  };
  ENG.f.rnWo=function(){
    N.woId=Number(val('rnWo'));
    const w=N.wos[N.woId], hdr=$('rnHdr');
    if(hdr&&w){
      const cell=(k,v)=>'<div><div style="font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--slate);font-weight:700">'+k+'</div><div style="font-weight:600;margin-top:1px">'+v+'</div></div>';
      hdr.innerHTML='<div style="display:flex;gap:26px;flex-wrap:wrap">'+
        cell('Business unit',esc(w.project_name))+
        cell('Contractor',esc(w.vendor_name)+(w.sub_names?' <span class="tag t-purple">sub: '+esc(w.sub_names)+'</span>':''))+
        cell('Work order',esc(w.wo_no))+
        cell('Work order amount',w.value!=null?inr(w.value):'—')+'</div>';
    }
    const rows=N.byWo[N.woId]||[];
    N.sel=new Set(rows.map(r=>r.id));
    $('rnList').innerHTML='<table class="tbl"><thead><tr><th style="width:34px"><input type="checkbox" checked onchange="ENG.f.rnTickAll(this.checked)"></th><th>Date</th><th>Activity / location</th><th class="r">Quantity</th><th class="r">Value</th></tr></thead><tbody>'+
      rows.map(r=>'<tr><td><input type="checkbox" class="rnCk" data-id="'+r.id+'" checked onchange="ENG.f.rnTick('+r.id+',this.checked)"></td><td>'+dt(r.entry_date)+'</td><td><b>'+esc(r.activity_name)+'</b>'+(r.sub_vendor_name?' <span class="tag t-purple">'+esc(r.sub_vendor_name)+'</span>':'')+'<div class="sub" style="font-size:12px;color:var(--slate)">'+esc(r.location_label)+'</div></td><td class="r">'+q(r.qty)+' '+esc(r.uom)+'</td><td class="r">'+inr(r.value)+'</td></tr>').join('')+'</tbody></table>';
    ENG.f.rnSum();
  };
  ENG.f.rnTick=function(id,on){on?N.sel.add(id):N.sel.delete(id);ENG.f.rnSum();};
  ENG.f.rnTickAll=function(on){const rows=N.byWo[N.woId]||[];N.sel=on?new Set(rows.map(r=>r.id)):new Set();document.querySelectorAll('.rnCk').forEach(c=>c.checked=on);ENG.f.rnSum();};
  ENG.f.rnSum=function(){
    const w=N.wos[N.woId];if(!w)return;
    // gross is rounded per work-order item after summing its quantities — the same way the database does it
    const per={};(N.byWo[N.woId]||[]).filter(r=>N.sel.has(r.id)).forEach(r=>{const k=r.wo_item_id;per[k]=per[k]||{qty:0,rate:num(r.rate)};per[k].qty+=num(r.qty);});
    const gross=Object.keys(per).reduce((s,k)=>s+r2(per[k].qty*per[k].rate),0);
    const oth=numOrNull(val('rnOth'));
    const t0=totals(r2(gross),{gst_pct:w.gst_pct,retention_pct:w.retention_pct,tds_pct:w.tds_pct,other_deduction:(oth&&!isNaN(oth))?oth:0,other_deduction_note:val('rnOthN')});
    $('rnSum').innerHTML='<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;justify-content:space-between"><div class="eng-note" style="max-width:340px">Retention, TDS and GST come from the work order ('+q(w.retention_pct)+'% / '+q(w.tds_pct)+'% / '+q(w.gst_pct)+'%). You can still adjust them on the draft bill.</div>'+totBox(t0,{gst_pct:w.gst_pct,retention_pct:w.retention_pct,tds_pct:w.tds_pct,other_deduction:t0.oth,other_deduction_note:''})+'</div>';
    const go=$('rnGo');if(go)go.disabled=!N.sel.size;
  };
  ENG.f.rnSave=function(btn){
    return run(btn,async()=>{
      if(!N.sel.size)return toast('Select the work to bill','warn');
      const oth=numOrNull(val('rnOth'));
      if(oth!=null&&(isNaN(oth)||oth<0))return toast('Enter a valid other deduction','warn');
      const {data,error}=await E().rpc('ra_bill_create',{
        p_wo:N.woId,p_entry_ids:[...N.sel],p_bill_date:val('rnDate')||null,p_period_from:val('rnFrom')||null,p_period_to:val('rnTo')||null,
        p_contractor_ref:val('rnRef').trim()||null,p_other_deduction:oth||0,p_other_note:val('rnOthN').trim()||null,p_remarks:val('rnRem').trim()||null,
        p_invoice_date:val('rnInvD')||null,p_due_date:val('rnDue')||null,p_billing_type:val('rnType')||null,
        p_parent_contractor:val('rnParent').trim()||null,p_financial_year:val('rnFY').trim()||null});
      if(error)throw error;
      closeModal();toast('Draft RA bill created — review it, then book it','ok');navTo('engineering/ra/'+data);
    });
  };
})();
