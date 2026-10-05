/* ===========================================================================
   JAIN-E · ENGINEERING — Retention   [loads after engineering-ra.js]
   Retention money is held back from a contractor's RA bill. It is released only on Engineering's certificate:
     1. an engineer REQUESTS a release  (which RA bills, how much, and why — completion certificate, defect period over …)
     2. a DIFFERENT person APPROVES it   (never the person who requested it)
     3. ACCOUNTS pays exactly what was approved (Accounts › Bills & on-account) — the release then shows Paid.
   Only bills that Accounts has posted hold retention that can be released. Everything is enforced by the database
   (accounts.retention_*), this file only presents it. Spec: docs/accounts-spec.md §4.5.
   =========================================================================== */
(function(){
  if(typeof window.ENG==='undefined')return;
  const ENG=window.ENG;
  const {num,inr,dt,val,fail,run,head,modal,cancelBtn,projBar,curProject,LOAD}=ENG;
  const A=()=>sb.schema('accounts');
  const L=()=>ENG.L;
  const me=()=>String(state.email||'').toLowerCase();
  const who=e=>e?esc(String(e).split('@')[0]):'—';
  const TAGC={Requested:'t-amber',Approved:'t-blue',Paid:'t-green',Rejected:'t-red',Cancelled:'t-gray'};
  const LABEL={Requested:'Awaiting approval',Approved:'Approved — waiting for Accounts to pay',Paid:'Paid',Rejected:'Rejected',Cancelled:'Cancelled'};
  const tag=s=>'<span class="tag '+(TAGC[s]||'t-gray')+'">'+esc(LABEL[s]||s)+'</span>';
  const sub=h=>'<div style="font-size:12px;color:var(--slate)">'+h+'</div>';

  ENG.routes.ret=async function(v,a,t){
    const pid=curProject();
    v.innerHTML=head('ret','Retention held back from RA bills — released on Engineering’s certificate, paid by Accounts','')+projBar(true)+'<div id="engBody">'+LOAD+'</div>';
    const [ov,rl]=await Promise.all([A().rpc('retention_overview',{p_project:pid||null}),A().rpc('retention_releases_view',{p_project:pid||null})]);
    if(ENG.stale(t))return;
    if(ov.error)throw ov.error;if(rl.error)throw rl.error;
    L().retBills=ov.data||[];L().retRel=rl.data||[];
    draw();
  };

  function byWo(){
    const m={};
    (L().retBills||[]).forEach(r=>{
      const w=m[r.wo_id]=m[r.wo_id]||{wo_id:r.wo_id,wo_no:r.wo_no,status:r.wo_status,project:r.project,vendor:r.vendor,retention:0,released:0,pending:0,available:0,unposted:0,unpostedAmt:0,bills:[]};
      w.retention+=num(r.retention);w.released+=num(r.released);w.pending+=num(r.pending);w.available+=num(r.available);
      if(!r.posted){w.unposted++;w.unpostedAmt+=num(r.retention);}
      w.bills.push(r);
    });
    return Object.values(m);
  }

  function draw(){
    const host=document.getElementById('engBody');if(!host)return;
    const wos=byWo(),rel=L().retRel||[];
    const sum=k=>wos.reduce((s,w)=>s+w[k],0);
    const awaiting=rel.filter(r=>r.status==='Requested').reduce((s,r)=>s+num(r.amount),0);
    const approved=rel.filter(r=>r.status==='Approved').reduce((s,r)=>s+num(r.amount),0);
    const kp=[['Retention deducted',inr(sum('retention')),'fa-hand-holding-dollar','#b45309','#fffbeb'],['Released and paid',inr(sum('released')),'fa-circle-check','#15803d','#f0fdf4'],
      ['Awaiting approval',inr(awaiting),'fa-hourglass-half','#b45309','#fffbeb'],['Approved, awaiting payment',inr(approved),'fa-money-check-dollar','#1d4ed8','#eff4ff'],['Available to release',inr(sum('available')),'fa-unlock','#0e7490','#ecfeff']];
    host.innerHTML=
      '<div class="eng-kpis">'+kp.map(k=>'<div class="kpi"><div class="top"><div class="ic" style="background:'+k[4]+';color:'+k[3]+'"><i class="fa-solid '+k[2]+'"></i></div></div><div class="val" style="font-size:19px">'+k[1]+'</div><div class="lbl">'+k[0]+'</div></div>').join('')+'</div>'+
      '<div class="eng-note" style="margin-bottom:14px">Retention can be released only for bills Accounts has already posted. A release is requested here, <b>approved by a different person</b>, and then paid from Accounts — Accounts cannot pay retention any other way.</div>'+
      '<div class="card eng-tbl" style="margin-bottom:16px"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="sec-title" style="margin:0">By work order</div><div class="sec-sub" style="margin:2px 0 0">Work orders whose RA bills carry retention</div></div>'+
        (wos.length?'<table class="tbl"><thead><tr><th>Work order</th><th>Contractor</th><th>Business unit</th><th class="r">Deducted</th><th class="r">Released</th><th class="r">In progress</th><th class="r">Available</th><th></th></tr></thead><tbody>'+
          wos.map(w=>'<tr><td><b>'+esc(w.wo_no)+'</b>'+sub(esc(w.status)+' · '+w.bills.length+' bill'+(w.bills.length===1?'':'s'))+'</td><td>'+esc(w.vendor)+'</td><td>'+esc(w.project)+'</td><td class="r">'+inr(w.retention)+'</td><td class="r">'+inr(w.released)+'</td><td class="r">'+(w.pending>0?inr(w.pending):'—')+'</td>'+
            '<td class="r"><b>'+inr(w.available)+'</b>'+(w.unposted?sub(w.unposted+' bill'+(w.unposted===1?'':'s')+' ('+inr(w.unpostedAmt)+') not yet posted in Accounts'):'')+'</td>'+
            '<td style="text-align:right;white-space:nowrap">'+(w.available>0.004?'<button class="btn btn-sm btn-primary" onclick="ENG.f.retNew('+w.wo_id+')">Request release</button>':'')+'</td></tr>').join('')+'</tbody></table>'
          :'<div class="empty" style="padding:34px"><i class="fa-solid fa-hand-holding-dollar"></i><div style="font-weight:600;color:var(--ink)">No retention yet</div><p>Retention appears here once an RA bill with retention has been booked.</p></div>')+'</div>'+
      '<div class="card eng-tbl"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="sec-title" style="margin:0">Release requests</div><div class="sec-sub" style="margin:2px 0 0">Approve or reject requests raised by someone else; follow each one through to payment</div></div>'+
        (rel.length?'<table class="tbl"><thead><tr><th>Release</th><th>Work order / contractor</th><th class="r">Amount</th><th>Why</th><th>Requested</th><th>Status</th><th></th></tr></thead><tbody>'+
          rel.map(r=>{
            const mine=String(r.requested_by).toLowerCase()===me(), mineOrApprover=mine||String(r.decided_by||'').toLowerCase()===me()||!!(state&&state.super);
            return '<tr><td><b>'+esc(r.doc_no)+'</b>'+sub(esc(r.company))+'</td><td><b>'+esc(r.wo_no)+'</b>'+sub(esc(r.vendor)+' · '+esc(r.project))+'</td><td class="r"><b>'+inr(r.amount)+'</b>'+sub((r.lines||[]).map(l=>esc(l.bill_no.split('/').pop())+' '+inr(l.amount)).join(' · '))+'</td>'+
              '<td style="max-width:260px;white-space:normal">'+esc(r.reason)+'</td><td>'+who(r.requested_by)+sub(dt(r.requested_at))+'</td>'+
              '<td>'+tag(r.status)+(r.status==='Paid'?sub(esc(r.paid_voucher_no||'')+' · '+dt(r.paid_at)):'')+(r.decided_by&&r.status!=='Requested'&&r.status!=='Cancelled'?sub((r.status==='Rejected'?'Rejected':'Approved')+' by '+who(r.decided_by)+(r.decision_note?': '+esc(r.decision_note):'')):'')+(r.status==='Cancelled'?sub('by '+who(r.cancelled_by)+': '+esc(r.cancel_reason||'')):'')+'</td>'+
              '<td style="text-align:right;white-space:nowrap">'+
                (r.status==='Requested'&&!mine?'<button class="btn btn-sm btn-ok" onclick="ENG.f.retApprove('+r.id+')">Approve</button> <button class="btn btn-sm btn-danger" onclick="ENG.f.retReject('+r.id+')">Reject</button> ':'')+
                (r.status==='Requested'&&mine?'<span style="font-size:12px;color:var(--slate)">needs someone else to approve</span> ':'')+
                ((r.status==='Requested'||r.status==='Approved')&&mineOrApprover?'<button class="btn btn-sm" onclick="ENG.f.retCancel('+r.id+')">Cancel</button>':'')+'</td></tr>';}).join('')+'</tbody></table>'
          :'<div class="empty" style="padding:30px"><i class="fa-solid fa-file-circle-check"></i><div style="font-weight:600;color:var(--ink)">No release requests yet</div></div>')+'</div>';
  }

  /* ---------------------------------------------------------------- request */
  let N=null;
  ENG.f.retNew=function(woId){
    const w=byWo().find(x=>x.wo_id===woId);if(!w)return;
    N={wo:w};
    const rows=w.bills.filter(b=>num(b.available)>0.004);
    modal('Request retention release — '+esc(w.wo_no),
      '<div class="eng-sum" style="margin-bottom:12px"><span>Contractor <b>'+esc(w.vendor)+'</b></span><span>Project <b>'+esc(w.project)+'</b></span></div>'+
      '<div class="eng-tbl" style="border:1px solid var(--line);border-radius:9px"><table class="tbl"><thead><tr><th>RA bill</th><th class="r">Retention</th><th class="r">Released</th><th class="r">Pending</th><th class="r">Can release</th><th style="width:150px">Release now (₹)</th></tr></thead><tbody>'+
      rows.map(b=>'<tr><td><b>'+esc(b.bill_no)+'</b>'+sub(dt(b.bill_date))+'</td><td class="r">'+inr(b.retention)+'</td><td class="r">'+inr(b.released)+'</td><td class="r">'+(num(b.pending)>0?inr(b.pending):'—')+'</td><td class="r"><b>'+inr(b.available)+'</b></td>'+
        '<td><input id="rrAmt_'+b.ra_bill_id+'" type="number" min="0" max="'+num(b.available)+'" step="0.01" value="'+num(b.available)+'" oninput="ENG.f.retSum()" style="width:100%;text-align:right"></td></tr>').join('')+'</tbody></table></div>'+
      '<div id="rrTot" style="text-align:right;margin:8px 2px;font-size:13.5px"></div>'+
      '<label>Why can it be released? <span style="color:var(--slate);font-weight:400">e.g. completion certificate no. and date, defect liability period over</span></label><textarea id="rrWhy" placeholder="Required — this is what the approver reads"></textarea>'+
      '<div class="eng-note" style="margin-top:10px">Someone else must approve this before Accounts can pay it.</div>',
      cancelBtn+'<button class="btn btn-primary" onclick="ENG.f.retSave(this)"><i class="fa-solid fa-paper-plane"></i> Send for approval</button>');
    ENG.f.retSum();
  };
  ENG.f.retSum=function(){
    if(!N)return;let s=0;N.wo.bills.forEach(b=>{const e=document.getElementById('rrAmt_'+b.ra_bill_id);if(e)s+=num(e.value);});
    const t=document.getElementById('rrTot');if(t)t.innerHTML='Total requested <b>'+inr(s)+'</b>';
  };
  ENG.f.retSave=function(btn){
    return run(btn,async()=>{
      const lines=[];
      for(const b of N.wo.bills){
        const e=document.getElementById('rrAmt_'+b.ra_bill_id);if(!e)continue;const x=Math.round(num(e.value)*100)/100;
        if(x<0)return toast('Amounts cannot be negative','warn');
        if(x>num(b.available)+0.004)return toast('Only '+inr(b.available)+' of the retention on '+b.bill_no+' can be released','warn');
        if(x>0)lines.push({ra_bill_id:b.ra_bill_id,amount:x});
      }
      if(!lines.length)return toast('Enter the amount to release against at least one bill','warn');
      const why=val('rrWhy').trim();if(!why)return toast('Say why the retention can be released','warn');
      const {error}=await A().rpc('retention_release_request',{p_wo:N.wo.wo_id,p_lines:lines,p_reason:why});if(error)throw error;
      closeModal();toast('Release sent for approval','ok');renderPage();
    });
  };

  /* ---------------------------------------------------------------- decide / cancel */
  ENG.f.retApprove=async function(id){
    const r=(L().retRel||[]).find(x=>x.id===id);if(!r)return;
    if(!await confirmDialog('Approve releasing '+inr(r.amount)+' of retention to '+r.vendor+' on '+r.wo_no+'? Accounts will then be able to pay it.\n\nReason given: '+r.reason,{okLabel:'Approve',danger:false,icon:'fa-unlock',title:'Approve '+r.doc_no}))return;
    try{const {error}=await A().rpc('retention_release_decide',{p_id:id,p_approve:true,p_note:null});if(error)throw error;toast('Approved — Accounts can now pay it','ok');renderPage();}catch(e){fail(e);}
  };
  ENG.f.retReject=function(id){
    const r=(L().retRel||[]).find(x=>x.id===id);if(!r)return;
    modal('Reject '+esc(r.doc_no),'<div class="eng-note">The retention stays held. The person who requested it can raise a new request later.</div><label>Reason</label><textarea id="rrNote" placeholder="Why is this release being rejected?"></textarea>',
      cancelBtn.replace('Cancel','Back')+'<button class="btn btn-danger-solid" onclick="ENG.f.retRejectSave(this,'+id+')">Reject release</button>');
  };
  ENG.f.retRejectSave=function(btn,id){
    return run(btn,async()=>{
      const note=val('rrNote').trim();if(!note)return toast('Give a reason','warn');
      const {error}=await A().rpc('retention_release_decide',{p_id:id,p_approve:false,p_note:note});if(error)throw error;
      closeModal();toast('Release rejected','ok');renderPage();
    });
  };
  ENG.f.retCancel=function(id){
    const r=(L().retRel||[]).find(x=>x.id===id);if(!r)return;
    modal('Cancel '+esc(r.doc_no),'<div class="eng-note">'+(r.status==='Approved'?'This release is already approved; cancelling it stops Accounts from paying it. ':'')+'The retention goes back to “available”.</div><label>Reason</label><textarea id="rrNote" placeholder="Why is this release being cancelled?"></textarea>',
      cancelBtn.replace('Cancel','Back')+'<button class="btn btn-danger-solid" onclick="ENG.f.retCancelSave(this,'+id+')">Cancel release</button>');
  };
  ENG.f.retCancelSave=function(btn,id){
    return run(btn,async()=>{
      const why=val('rrNote').trim();if(!why)return toast('Give a reason','warn');
      const {error}=await A().rpc('retention_release_cancel',{p_id:id,p_reason:why});if(error)throw error;
      closeModal();toast('Release cancelled','ok');renderPage();
    });
  };
})();
