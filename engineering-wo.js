/* ===========================================================================
   JAIN-E · ENGINEERING — Work Orders and Work Done   [loads after engineering-boq.js]
   Work order: tag BOQ lines (qty + the contractor's rate) -> issue (locks it) -> record work done
   against its items -> someone else verifies -> verified work is billed through RA bills.
   =========================================================================== */
(function(){
  if(typeof window.ENG==='undefined')return;
  const ENG=window.ENG;
  const {E,lc,num,inr,cr,q,dt,istToday,pct,val,numOrNull,stTag,lvTag,LOAD,fail,run,fetchAll,chunk,head,modal,cancelBtn,opts,pager,bar,projBar,projName,curProject,vendorName,C}=ENG;
  const L=()=>ENG.L;
  const PAGE_SIZE=100;
  const me=()=>lc(state.email);
  const canVerify=r=>r.status==='Entered'&&(state.super||lc(r.entered_by)!==me());
  const canEditOwn=r=>(r.status==='Entered'||r.status==='Rejected')&&(state.super||lc(r.entered_by)===me());
  const who=e=>e?esc(String(e).split('@')[0]):'—';
  const idx=()=>(L().wdIndex=L().wdIndex||{});
  const indexRows=rows=>{const m=idx();(rows||[]).forEach(r=>m[r.id]=r);};
  const woLink=(id,no)=>'<a style="color:var(--brand);font-weight:600;cursor:pointer" onclick="navTo(\'engineering/wo/'+id+'\')">'+esc(no)+'</a>';

  /* ======================================================================= WORK ORDER LIST */
  ENG.routes.wo=async function(v,a,t){
    if(a[0])return woDetail(v,Number(a[0]),t);
    const pid=curProject();
    v.innerHTML=head('wo','Work orders raised on contractors by tagging BOQ lines',
      '<button class="btn btn-primary" onclick="ENG.f.woForm()"><i class="fa-solid fa-plus"></i> New work order</button>')+projBar(true)+'<div id="engBody">'+LOAD+'</div>';
    const rows=await fetchAll(()=>{let x=E().from('v_work_orders').select('*').order('id',{ascending:false});if(pid)x=x.eq('project_id',pid);return x;});
    if(ENG.stale(t))return;
    L().woRows=rows;L().woF={status:'',q:'',page:0};
    $('engBody').innerHTML=
      '<div class="eng-filter"><div class="toolbar grow" style="margin:0;flex:1;min-width:200px"><div class="grow"><i class="fa-solid fa-magnifying-glass"></i><input placeholder="Search number, title, contractor or sub-contractor…" oninput="ENG.f.woFilter(\'q\',this.value)"></div></div>'+
      '<select class="sel" onchange="ENG.f.woFilter(\'status\',this.value)">'+opts(['Draft','Issued','Closed','Cancelled'],x=>x,x=>x,'','All statuses')+'</select></div>'+
      '<div class="card eng-tbl" id="woCard"></div>';
    ENG.f.woRender();
  };
  ENG.f.woFilter=function(k,v){const f=L().woF;f[k]=v;f.page=0;ENG.f.woRender();};
  ENG.f.woPage=function(p){L().woF.page=p;ENG.f.woRender();};
  ENG.f.woRender=function(){
    const f=L().woF,qq=lc(f.q).trim();
    const rows=(L().woRows||[]).filter(r=>(!f.status||r.status===f.status)&&(!qq||lc(r.wo_no+' '+r.title+' '+r.vendor_name+' '+(r.sub_names||'')+' '+r.project_name).indexOf(qq)>=0));
    const pg=rows.slice(f.page*PAGE_SIZE,(f.page+1)*PAGE_SIZE);
    $('woCard').innerHTML=rows.length?
      '<table class="tbl"><thead><tr><th>Work order</th><th>Parent contractor</th><th>Business unit</th><th class="r">Items</th><th class="r">Value</th><th class="r">Verified</th><th class="r">Billed</th><th>Status</th></tr></thead><tbody>'+
      pg.map(r=>'<tr class="clk" onclick="navTo(\'engineering/wo/'+r.id+'\')"><td><b>'+esc(r.wo_no)+'</b><div class="sub" style="font-size:12px;color:var(--slate)">'+esc(r.title)+' · '+dt(r.wo_date)+'</div></td><td>'+esc(r.vendor_name)+(r.sub_names?'<div class="sub" style="font-size:12px;color:var(--slate)">Sub: '+esc(r.sub_names)+'</div>':'')+'</td><td>'+esc(r.project_name)+'</td><td class="r">'+r.item_count+'</td><td class="r">'+inr(r.value)+'</td><td class="r">'+inr(r.verified_value)+'</td><td class="r">'+inr(r.billed_value)+'</td><td>'+stTag(r.status)+(num(r.pending_items)>0?' <span class="tag t-amber" title="Entries awaiting verification">'+r.pending_items+' to verify</span>':'')+'</td></tr>').join('')+
      '</tbody></table>'+pager(rows.length,f.page,PAGE_SIZE,'ENG.f.woPage'):
      '<div class="empty" style="padding:44px"><i class="fa-solid fa-file-contract"></i><div style="font-weight:600;color:var(--ink)">'+((L().woRows||[]).length?'No work orders match':'No work orders yet')+'</div>'+((L().woRows||[]).length?'':'<p>Create one, then tag BOQ lines onto it.</p>')+'</div>';
  };

  /* ---------------------------------------------------------------- create / edit */
  function woFormHtml(w,isNew){
    const vendors=C.vendors;
    return (isNew?'<label>Business unit</label><select id="woProj">'+opts(C.projects,p=>p.id,p=>p.name,curProject()||'','Select a business unit…')+'</select>':'')+
      '<label>Parent (main) contractor</label><select id="woVendor"'+(isNew?' onchange="ENG.f.woSubsRender()"':'')+'>'+opts(vendors,x=>x.id,x=>vendorName(x)+(x.code?' ('+x.code+')':'')+(x.status&&x.status!=='approved'?' — '+x.status:''),w.vendor_id||'',vendors.length?'Select a contractor…':'No contractors in the Purchase vendor master yet')+'</select>'+
      (vendors.length?'':'<div class="eng-note" style="margin-top:8px">Contractors come from the Purchase module’s vendor master. Add the contractor there first, then reopen this form.</div>')+
      (isNew?'<label>Sub-contractors <span style="color:var(--slate);font-weight:400">optional — you can add or change them later</span></label><div id="woSubsHost"></div>':'')+
      '<label>Title / scope</label><input id="woTitle" value="'+esc(w.title||'')+'" placeholder="e.g. Plastering & putty — Block A1">'+
      '<div class="two"><div><label>Work order date</label><input id="woDate" type="date" value="'+(w.wo_date||istToday())+'"></div><div></div></div>'+
      '<div class="two"><div><label>Start date <span style="color:var(--slate);font-weight:400">optional</span></label><input id="woStart" type="date" value="'+(w.start_date||'')+'"></div><div><label>End date <span style="color:var(--slate);font-weight:400">optional</span></label><input id="woEnd" type="date" value="'+(w.end_date||'')+'"></div></div>'+
      '<div style="font-size:12.5px;font-weight:600;margin:16px 0 2px">Commercial terms <span style="color:var(--slate);font-weight:400">— copied onto every RA bill; locked once the work order is issued</span></div>'+
      '<div class="two" style="grid-template-columns:1fr 1fr 1fr"><div><label>Retention %</label><input id="woRet" type="number" min="0" max="100" step="0.01" value="'+(w.retention_pct!=null?w.retention_pct:5)+'"></div><div><label>TDS %</label><input id="woTds" type="number" min="0" max="100" step="0.01" value="'+(w.tds_pct!=null?w.tds_pct:1)+'"></div><div><label>GST %</label><input id="woGst" type="number" min="0" max="100" step="0.01" value="'+(w.gst_pct!=null?w.gst_pct:18)+'"></div></div>'+
      '<label>Terms &amp; conditions <span style="color:var(--slate);font-weight:400">optional</span></label><textarea id="woTerms">'+esc(w.terms||'')+'</textarea>';
  }
  ENG.f.woForm=function(){
    modal('New work order',woFormHtml({},true),cancelBtn+'<button class="btn btn-primary" onclick="ENG.f.woSave(this,0)"><i class="fa-solid fa-check"></i> Create</button>');
    ENG.f.woSubsRender();
  };
  ENG.f.woSubsRender=function(){
    const host=$('woSubsHost');if(!host)return;
    const parent=val('woVendor');
    const prev=new Set(Array.prototype.slice.call(document.querySelectorAll('#woSubGrid input[type=checkbox]:checked')).map(x=>String(x.value)));
    const list=C.vendors.filter(x=>String(x.id)!==String(parent));
    host.innerHTML=list.length?'<div class="eng-grid" id="woSubGrid">'+list.map(x=>'<label><input type="checkbox" value="'+x.id+'"'+(prev.has(String(x.id))?' checked':'')+'> '+esc(vendorName(x))+'</label>').join('')+'</div>':'<div class="eng-note">There are no other contractors in the vendor master yet.</div>';
  };
  ENG.f.woEdit=function(id){
    const w=L().woCur;if(!w||w.id!==id)return;
    modal('Edit work order — '+esc(w.wo_no),woFormHtml(w,false),cancelBtn+'<button class="btn btn-primary" onclick="ENG.f.woSave(this,'+id+')"><i class="fa-solid fa-check"></i> Save</button>');
  };
  function woRow(isNew){
    const p=n=>{const x=numOrNull(val(n));return x==null||isNaN(x)?NaN:x;};
    const row={vendor_id:Number(val('woVendor'))||null,title:val('woTitle').trim(),wo_date:val('woDate')||null,start_date:val('woStart')||null,end_date:val('woEnd')||null,
      retention_pct:p('woRet'),tds_pct:p('woTds'),gst_pct:p('woGst'),terms:val('woTerms').trim()||null};
    if(isNew)row.project_id=Number(val('woProj'))||null;
    return row;
  }
  ENG.f.woSave=function(btn,id){
    return run(btn,async()=>{
      const row=woRow(!id);
      if(!id&&!row.project_id)return toast('Select a project','warn');
      if(!row.vendor_id)return toast('Select the parent contractor','warn');
      if(!row.title)return toast('Enter a title','warn');
      if(!row.wo_date)return toast('Enter the work order date','warn');
      for(const k of ['retention_pct','tds_pct','gst_pct'])if(isNaN(row[k])||row[k]<0||row[k]>100)return toast('Retention, TDS and GST must be between 0 and 100','warn');
      if(id){const {error}=await E().from('work_orders').update(row).eq('id',id);if(error)throw error;closeModal();toast('Work order updated','ok');renderPage();}
      else{
        const {data,error}=await E().from('work_orders').insert(row).select('id').single();if(error)throw error;
        const subs=Array.prototype.slice.call(document.querySelectorAll('#woSubGrid input[type=checkbox]:checked')).map(x=>Number(x.value)).filter(x=>x&&x!==row.vendor_id);
        if(subs.length){const r2=await E().from('wo_subcontractors').insert(subs.map(v=>({wo_id:data.id,vendor_id:v})));if(r2.error)toast('Work order created, but the sub-contractors could not be added: '+ENG.errMsg(r2.error),'warn');}
        closeModal();toast('Work order created — now tag BOQ lines onto it','ok');navTo('engineering/wo/'+data.id);
      }
    });
  };

  /* ======================================================================= WORK ORDER DETAIL */
  async function woDetail(v,id,t){
    v.innerHTML=head('wo','',' ')+LOAD;
    const [w,it,wd,ra,am,su]=await Promise.all([
      E().from('v_work_orders').select('*').eq('id',id).maybeSingle(),
      fetchAll(()=>E().from('v_wo_items').select('*').eq('wo_id',id).order('tower_sort').order('floor_no',{nullsFirst:true}).order('flat_code',{nullsFirst:true}).order('activity_name').order('id')),
      fetchAll(()=>E().from('v_work_done').select('*').eq('wo_id',id).order('entry_date',{ascending:false}).order('id',{ascending:false})),
      E().from('v_ra_bills').select('*').eq('wo_id',id).order('ra_seq'),
      E().from('v_wo_amendments').select('*').eq('wo_id',id).order('amend_no'),
      E().from('v_wo_subcontractors').select('*').eq('wo_id',id).order('vendor_name')
    ]);
    if(ENG.stale(t))return;
    if(w.error)throw w.error;if(ra.error)throw ra.error;if(am.error)throw am.error;if(su.error)throw su.error;
    if(!w.data){v.innerHTML=head('wo','','')+'<div class="card card-pad empty"><i class="fa-solid fa-file-contract"></i><div style="font-weight:600;color:var(--ink)">Work order not found</div><p><a style="color:var(--brand);cursor:pointer" onclick="navTo(\'engineering/wo\')">Back to work orders</a></p></div>';return;}
    const W=w.data;L().woCur=W;L().woItems=it;L().woItemsPage=0;L().woWdRows=wd;L().woSubs=su.data||[];L().woItemSel=new Set();L().woAsgTo='';indexRows(wd);
    const draft=W.status==='Draft',issued=W.status==='Issued';
    const unbilled=wd.filter(r=>r.status==='Verified'&&!r.ra_bill_id).length;
    const amends=am.data||[],draftAm=amends.find(x=>x.status==='Draft');
    const btns=
      (draft?'<button class="btn btn-primary" onclick="ENG.f.woTag('+id+')"><i class="fa-solid fa-link"></i> Tag BOQ lines</button><button class="btn" onclick="ENG.f.woEdit('+id+')"><i class="fa-solid fa-pen"></i> Edit</button><button class="btn btn-ok" onclick="ENG.f.woIssue('+id+')"><i class="fa-solid fa-paper-plane"></i> Issue</button><button class="btn btn-danger" onclick="ENG.f.woDelete('+id+')"><i class="fa-solid fa-trash"></i></button>':'')+
      (issued?'<button class="btn btn-primary" onclick="ENG.f.wdEntry('+id+')"><i class="fa-solid fa-person-digging"></i> Enter work done</button><button class="btn" '+(unbilled?'':'disabled')+' onclick="ENG.f.raNew('+id+')"><i class="fa-solid fa-file-invoice-dollar"></i> Raise RA bill</button>'+(draftAm?'<button class="btn" style="border-color:#c4b5fd;color:#6d28d9" onclick="navTo(\'engineering/amend/'+draftAm.id+'\')"><i class="fa-solid fa-pen-ruler"></i> Open draft amendment</button>':'<button class="btn" style="border-color:#c4b5fd;color:#6d28d9" onclick="ENG.f.amendStart('+id+')"><i class="fa-solid fa-pen-ruler"></i> Amend</button>')+'<button class="btn" onclick="ENG.f.woClose('+id+')"><i class="fa-solid fa-lock"></i> Close</button><button class="btn btn-danger" onclick="ENG.f.woCancel('+id+')">Cancel</button>':'');
    v.innerHTML=head('wo','','')+
      '<div style="margin-bottom:14px"><button class="btn btn-sm" onclick="navTo(\'engineering/wo\')"><i class="fa-solid fa-arrow-left"></i> All work orders</button></div>'+
      '<div class="card card-pad" style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:flex-start"><div>'+
        '<div style="font-size:20px;font-weight:700">'+esc(W.wo_no)+' '+stTag(W.status)+'</div><div style="font-size:14px;margin-top:3px">'+esc(W.title)+'</div>'+
        '<div class="eng-sum" style="margin-top:10px"><span>Project <b>'+esc(W.project_name)+'</b></span><span>Parent contractor <b>'+esc(W.vendor_name)+'</b></span>'+(W.sub_names?'<span>Sub-contractors <b>'+esc(W.sub_names)+'</b></span>':'')+'<span>Dated <b>'+dt(W.wo_date)+'</b></span>'+(W.start_date||W.end_date?'<span>Period <b>'+dt(W.start_date)+' → '+dt(W.end_date)+'</b></span>':'')+'<span>Retention <b>'+q(W.retention_pct)+'%</b> · TDS <b>'+q(W.tds_pct)+'%</b> · GST <b>'+q(W.gst_pct)+'%</b></span></div>'+
        (W.terms?'<div style="margin-top:10px;font-size:12.5px;color:var(--slate);white-space:pre-wrap">'+esc(W.terms)+'</div>':'')+
        (W.status==='Cancelled'&&W.cancel_reason?'<div class="eng-note" style="margin-top:10px">Cancelled: '+esc(W.cancel_reason)+'</div>':'')+
      '</div><div class="eng-actions">'+btns+'</div></div></div>'+
      '<div class="eng-kpis">'+
        [['Work order value',inr(W.value),'fa-file-contract','#1d4ed8','#eff4ff'],['Work verified',inr(W.verified_value),'fa-circle-check','#0f766e','#f0fdfa'],['Billed',inr(W.billed_value),'fa-file-invoice-dollar','#15803d','#f0fdf4'],['Yet to execute',inr(Math.max(0,num(W.value)-num(W.verified_value))),'fa-hourglass-half','#b45309','#fffbeb']].map(k=>'<div class="kpi"><div class="top"><div class="ic" style="background:'+k[4]+';color:'+k[3]+'"><i class="fa-solid '+k[2]+'"></i></div></div><div class="val">'+k[1]+'</div><div class="lbl">'+k[0]+'</div></div>').join('')+'</div>'+
      (draft||issued?contractorsCard(W,it,su.data||[]):'')+
      '<div class="card eng-tbl" style="margin-bottom:16px"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="sec-title" style="margin:0">Items</div><div class="sec-sub" style="margin:2px 0 0">'+(draft?'Tag BOQ lines to add scope. Once the work order is issued, quantities, rates and terms change only through an amendment.':'BOQ lines tagged on this work order — lines added or re-rated by an amendment carry its tag')+'</div></div><div id="woItems"></div></div>'+
      (amends.length||issued?'<div class="card eng-tbl" style="margin-bottom:16px"><div class="card-pad" style="border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div><div class="sec-title" style="margin:0">Amendments</div><div class="sec-sub" style="margin:2px 0 0">Changes to this work order after it was issued — each one is kept as a permanent record</div></div>'+(issued&&!draftAm?'<button class="btn btn-sm" onclick="ENG.f.amendStart('+id+')"><i class="fa-solid fa-pen-ruler"></i> New amendment</button>':'')+'</div>'+
        (amends.length?'<table class="tbl"><thead><tr><th>Amendment</th><th>Effective</th><th class="r">Lines</th><th class="r">Value change</th><th>Status</th></tr></thead><tbody>'+amends.map(a=>'<tr class="clk" onclick="navTo(\'engineering/amend/'+a.id+'\')"><td><b>'+esc(a.amend_ref)+'</b><div class="sub" style="font-size:12px;color:var(--slate)">'+esc(a.title)+'</div></td><td>'+dt(a.effective_date)+'</td><td class="r">'+a.line_count+'</td><td class="r">'+(a.status==='Issued'?'<b>'+(num(a.value_change)>=0?'+':'−')+inr(Math.abs(num(a.value_change)))+'</b>':'—')+'</td><td>'+stTag(a.status)+'</td></tr>').join('')+'</tbody></table>':'<div class="empty" style="padding:22px">No amendments — this work order is as originally issued</div>')+'</div>':'')+
      '<div class="card eng-tbl" style="margin-bottom:16px"><div class="card-pad" style="border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div><div class="sec-title" style="margin:0">Work done</div><div class="sec-sub" style="margin:2px 0 0">Entered on site, then verified by a different person before it can be billed</div></div>'+(issued?'<button class="btn btn-sm btn-primary" onclick="ENG.f.wdEntry('+id+')"><i class="fa-solid fa-plus"></i> Enter work done</button>':'')+'</div>'+wdTable(wd,false,true)+'</div>'+
      '<div class="card eng-tbl"><div class="card-pad" style="border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center"><div class="sec-title" style="margin:0">RA bills</div>'+(issued&&unbilled?'<button class="btn btn-sm btn-primary" onclick="ENG.f.raNew('+id+')"><i class="fa-solid fa-plus"></i> Raise RA bill</button>':'')+'</div>'+
      (ra.data&&ra.data.length?'<table class="tbl"><thead><tr><th>Bill</th><th>Date</th><th class="r">Gross</th><th class="r">Net payable</th><th>Status</th></tr></thead><tbody>'+ra.data.map(b=>'<tr class="clk" onclick="navTo(\'engineering/ra/'+b.id+'\')"><td><b>'+esc(b.bill_no)+'</b></td><td>'+dt(b.bill_date)+'</td><td class="r">'+inr(b.gross)+'</td><td class="r">'+inr(b.net_payable)+'</td><td>'+stTag(b.status)+'</td></tr>').join('')+'</tbody></table>':'<div class="empty" style="padding:26px">No RA bills yet</div>')+'</div>';
    ENG.f.woItemsRender();
  }
  ENG.f.woItemsRender=function(){
    const W=L().woCur,it=L().woItems||[],draft=W.status==='Draft',pg=L().woItemsPage||0;
    const rows=it.slice(pg*PAGE_SIZE,(pg+1)*PAGE_SIZE);
    const subs=L().woSubs||[],canAssign=(draft||W.status==='Issued')&&subs.length>0,sel=L().woItemSel||new Set();
    const toolbar=canAssign?'<div class="card-pad" style="border-bottom:1px solid var(--line);display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-size:12.5px;color:var(--slate)">'+sel.size+' selected</span><select class="sel" id="woAsgTo" onchange="ENG.f.woAsgPick(this.value)"><option value="">Done by the parent contractor</option>'+subs.map(x=>'<option value="'+x.vendor_id+'"'+(String(L().woAsgTo)===String(x.vendor_id)?' selected':'')+'>Sub: '+esc(x.vendor_name)+'</option>').join('')+'</select><button class="btn btn-sm" '+(sel.size?'':'disabled')+' onclick="ENG.f.woAssign()"><i class="fa-solid fa-people-arrows"></i> Assign selected</button></div>':'';
    $('woItems').innerHTML=it.length?toolbar+
      '<table class="tbl"><thead><tr>'+(canAssign?'<th style="width:34px"><input type="checkbox" onchange="ENG.f.woItemTickPage(this.checked)"></th>':'')+'<th>Activity</th><th>Location</th><th>Done by</th><th class="r">Quantity</th><th class="r">Rate</th><th class="r">Amount</th><th style="min-width:130px">Executed</th><th class="r">Billed</th>'+(draft?'<th></th>':'')+'</tr></thead><tbody>'+
      rows.map(r=>{
        const done=num(r.verified_qty)+num(r.pending_qty),closed=num(r.qty)===0;
        return '<tr style="'+(closed?'opacity:.55':'')+'">'+(canAssign?'<td><input type="checkbox" '+(sel.has(r.id)?'checked':'')+' onchange="ENG.f.woItemTick('+r.id+',this.checked)"></td>':'')+'<td><b>'+esc(r.activity_name)+'</b>'+(num(r.amend_no)>0?' <span class="tag t-purple" title="Added or re-rated by an amendment">AM-'+String(r.amend_no).padStart(2,'0')+'</span>':'')+(closed?' <span class="tag t-gray">Short-closed</span>':'')+'<div class="sub" style="font-size:12px;color:var(--slate)">'+esc(r.group_name)+'</div></td><td>'+lvTag(r.location_level)+' <span style="margin-left:4px">'+esc(r.location_label)+'</span></td>'+
          '<td>'+(r.sub_vendor_name?'<span class="tag t-purple">'+esc(r.sub_vendor_name)+'</span>':'<span style="color:var(--slate);font-size:12.5px">Parent</span>')+'</td>'+
          '<td class="r">'+q(r.qty)+' <span style="color:var(--slate)">'+esc(r.uom)+'</span></td><td class="r">'+inr(r.rate)+'</td><td class="r">'+inr(r.amount)+'</td>'+
          '<td>'+bar(done,num(r.qty))+'<div style="font-size:11px;color:var(--slate);margin-top:3px">'+q(r.verified_qty)+' verified'+(num(r.pending_qty)>0?' · <span style="color:#b45309">'+q(r.pending_qty)+' to verify</span>':'')+'</div></td>'+
          '<td class="r">'+q(r.billed_qty)+'</td>'+
          (draft?'<td style="white-space:nowrap;text-align:right"><button class="btn btn-sm" onclick="ENG.f.woItemEdit('+r.id+')"><i class="fa-solid fa-pen"></i></button> <button class="btn btn-sm btn-danger" onclick="ENG.f.woItemDel('+r.id+')"><i class="fa-solid fa-xmark"></i></button></td>':'')+'</tr>';
      }).join('')+'</tbody></table>'+pager(it.length,pg,PAGE_SIZE,'ENG.f.woItemsPage'):
      '<div class="empty" style="padding:34px"><i class="fa-solid fa-link"></i><div style="font-weight:600;color:var(--ink)">No items yet</div>'+(draft?'<p>Use <b>Tag BOQ lines</b> to add the scope of this work order.</p>':'')+'</div>';
  };
  ENG.f.woItemsPage=function(p){L().woItemsPage=p;ENG.f.woItemsRender();};

  /* parent contractor + sub-contractors: who holds the work order, who does which part, and what each is worth */
  function contractorsCard(W,items,subs){
    const live=items.filter(i=>num(i.qty)>0),mine=live.filter(i=>!i.sub_vendor_id);
    const tot=(arr,k)=>arr.reduce((x,i)=>x+num(i[k]),0);
    return '<div class="card eng-tbl" style="margin-bottom:16px"><div class="card-pad" style="border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div><div class="sec-title" style="margin:0">Contractors</div><div class="sec-sub" style="margin:2px 0 0">The parent contractor holds the work order; sub-contractors do part of the work under it</div></div>'+
      '<button class="btn btn-sm" onclick="ENG.f.woSubsManage('+W.id+')"><i class="fa-solid fa-people-group"></i> Manage sub-contractors</button></div>'+
      '<table class="tbl"><thead><tr><th>Contractor</th><th>Role</th><th>Scope</th><th class="r">Items</th><th class="r">Value</th><th class="r">Verified</th><th class="r">Billed</th></tr></thead><tbody>'+
      '<tr><td><b>'+esc(W.vendor_name)+'</b></td><td><span class="tag t-blue">Parent</span></td><td style="color:var(--slate)">Items not given to a sub-contractor</td><td class="r">'+mine.length+'</td><td class="r">'+inr(tot(mine,'amount'))+'</td><td class="r">'+inr(tot(mine,'verified_amount'))+'</td><td class="r">'+inr(tot(mine,'billed_amount'))+'</td></tr>'+
      subs.map(x=>'<tr><td><i class="fa-solid fa-turn-up fa-rotate-90" style="color:var(--slate);margin-right:6px"></i><b>'+esc(x.vendor_name)+'</b></td><td><span class="tag t-purple">Sub-contractor</span></td><td>'+esc(x.scope||'—')+'</td><td class="r">'+x.item_count+'</td><td class="r">'+inr(x.value)+'</td><td class="r">'+inr(x.verified_value)+'</td><td class="r">'+inr(x.billed_value)+'</td></tr>').join('')+
      '</tbody></table></div>';
  }
  ENG.f.woItemTick=function(id,on){const s=L().woItemSel;on?s.add(id):s.delete(id);ENG.f.woItemsRender();};
  ENG.f.woItemTickPage=function(on){const pg=L().woItemsPage||0,s=L().woItemSel;(L().woItems||[]).slice(pg*PAGE_SIZE,(pg+1)*PAGE_SIZE).forEach(r=>on?s.add(r.id):s.delete(r.id));ENG.f.woItemsRender();};
  ENG.f.woAsgPick=function(v){L().woAsgTo=v;};
  ENG.f.woAssign=async function(){
    const ids=[...L().woItemSel];if(!ids.length)return;
    const to=val('woAsgTo')?Number(val('woAsgTo')):null;
    try{
      for(const c of chunk(ids,200)){const {error}=await E().from('wo_items').update({sub_vendor_id:to}).in('id',c);if(error)throw error;}
      toast(ids.length+' item'+(ids.length===1?'':'s')+' assigned','ok');renderPage();
    }catch(e){fail(e);}
  };
  const SM={cur:{},list:[],wo:null,q:''};
  ENG.f.woSubsManage=function(woId){
    const W=L().woCur;SM.wo=W;SM.cur={};(L().woSubs||[]).forEach(x=>SM.cur[x.vendor_id]=x);SM.q='';
    SM.list=C.vendors.filter(x=>x.id!==W.vendor_id);
    modal('Sub-contractors — '+esc(W.wo_no),
      '<div class="eng-note" style="margin-bottom:12px">Parent contractor: <b>'+esc(W.vendor_name)+'</b>. Tick the contractors who work under it and note their scope. A sub-contractor with items assigned to it can only be removed after those items are reassigned.</div>'+
      '<div class="toolbar" style="margin-bottom:8px"><div class="grow"><i class="fa-solid fa-magnifying-glass"></i><input placeholder="Search contractors…" oninput="ENG.f.smSearch(this.value)"></div></div>'+
      '<div class="eng-tbl" style="border:1px solid var(--line);border-radius:9px;max-height:44vh;overflow:auto" id="smList"></div>',
      cancelBtn+'<button class="btn btn-primary" onclick="ENG.f.woSubsSave(this)"><i class="fa-solid fa-check"></i> Save</button>','lg');
    ENG.f.smRender();
  };
  ENG.f.smSearch=function(v){
    SM.q=lc(v).trim();
    document.querySelectorAll('#smList tbody tr').forEach(tr=>{tr.style.display=(!SM.q||(tr.getAttribute('data-t')||'').indexOf(SM.q)>=0)?'':'none';});
  };
  ENG.f.smRender=function(){
    const host=$('smList');if(!host)return;
    host.innerHTML=SM.list.length?'<table class="tbl"><thead><tr><th style="width:34px"></th><th>Contractor</th><th>Scope of work</th></tr></thead><tbody>'+
      SM.list.map(x=>{const c=SM.cur[x.id];return '<tr data-t="'+esc(lc(vendorName(x)+' '+(x.code||'')))+'"><td><input type="checkbox" id="smCk_'+x.id+'" '+(c?'checked':'')+'></td><td><b>'+esc(vendorName(x))+'</b>'+(x.code?'<div class="sub" style="font-size:12px;color:var(--slate)">'+esc(x.code)+'</div>':'')+'</td><td><input id="smSc_'+x.id+'" value="'+esc(c?c.scope:'')+'" placeholder="e.g. Plastering" style="width:100%"></td></tr>';}).join('')+'</tbody></table>':
      '<div class="empty" style="padding:30px">There are no other contractors in the Purchase vendor master yet.</div>';
  };
  ENG.f.woSubsSave=function(btn){
    return run(btn,async()=>{
      const W=SM.wo,del=[],upd=[],ins=[];
      SM.list.forEach(x=>{
        const ck=document.getElementById('smCk_'+x.id),sc=document.getElementById('smSc_'+x.id);
        const on=!!(ck&&ck.checked),scope=((sc&&sc.value)||'').trim()||null,c=SM.cur[x.id];
        if(on&&!c)ins.push({wo_id:W.id,vendor_id:x.id,scope:scope});
        else if(on&&c&&(c.scope||null)!==scope)upd.push({id:c.id,scope:scope});
        else if(!on&&c)del.push(c.id);
      });
      if(!del.length&&!upd.length&&!ins.length)return toast('Nothing to save','warn');
      for(const id of del){const {error}=await E().from('wo_subcontractors').delete().eq('id',id);if(error)throw error;}
      for(const u of upd){const {error}=await E().from('wo_subcontractors').update({scope:u.scope}).eq('id',u.id);if(error)throw error;}
      if(ins.length){const {error}=await E().from('wo_subcontractors').insert(ins);if(error)throw error;}
      closeModal();toast('Sub-contractors updated','ok');renderPage();
    });
  };

  /* ---------------------------------------------------------------- status changes */
  ENG.f.woIssue=async function(id){
    const W=L().woCur;
    if(!await confirmDialog('Issue '+W.wo_no+' to '+W.vendor_name+'? Its items, quantities, rates and terms will be locked.',{okLabel:'Issue',danger:false,icon:'fa-paper-plane'}))return;
    try{const {error}=await E().from('work_orders').update({status:'Issued'}).eq('id',id);if(error)throw error;toast('Work order issued','ok');renderPage();}catch(e){fail(e);}
  };
  ENG.f.woClose=async function(id){
    if(!await confirmDialog('Close this work order? You can’t enter more work or raise more RA bills afterwards.',{okLabel:'Close work order',danger:false,icon:'fa-lock'}))return;
    try{const {error}=await E().from('work_orders').update({status:'Closed'}).eq('id',id);if(error)throw error;toast('Work order closed','ok');renderPage();}catch(e){fail(e);}
  };
  ENG.f.woDelete=async function(id){
    if(!await confirmDialog('Delete this draft work order and its tagged items?',{okLabel:'Delete'}))return;
    try{const {error}=await E().from('work_orders').delete().eq('id',id);if(error)throw error;toast('Work order deleted','ok');navTo('engineering/wo');}catch(e){fail(e);}
  };
  ENG.f.woCancel=function(id){
    modal('Cancel work order','<div class="eng-note">Only possible while no work has been recorded against it. Otherwise close it instead.</div><label>Reason</label><textarea id="woWhy" placeholder="Why is this work order being cancelled?"></textarea>',
      cancelBtn.replace('Cancel','Back')+'<button class="btn btn-danger-solid" onclick="ENG.f.woCancelSave(this,'+id+')">Cancel work order</button>');
  };
  ENG.f.woCancelSave=function(btn,id){
    return run(btn,async()=>{
      const why=val('woWhy').trim();if(!why)return toast('Give a reason','warn');
      const {error}=await E().from('work_orders').update({status:'Cancelled',cancel_reason:why}).eq('id',id);if(error)throw error;
      closeModal();toast('Work order cancelled','ok');renderPage();
    });
  };

  /* ---------------------------------------------------------------- items on a draft work order */
  ENG.f.woItemEdit=function(id){
    const r=(L().woItems||[]).find(x=>x.id===id);if(!r)return;
    modal('Edit item','<div style="font-weight:600">'+esc(r.activity_name)+'</div><div style="color:var(--slate);font-size:13px;margin-top:2px">'+esc(r.location_label)+'</div>'+
      '<div class="two"><div><label>Quantity ('+esc(r.uom)+')</label><input id="wiQty" type="number" min="0" step="0.001" value="'+num(r.qty)+'"></div><div><label>Contractor rate (₹)</label><input id="wiRate" type="number" min="0" step="0.01" value="'+num(r.rate)+'"></div></div>',
      cancelBtn+'<button class="btn btn-primary" onclick="ENG.f.woItemSave(this,'+id+')"><i class="fa-solid fa-check"></i> Save</button>');
  };
  ENG.f.woItemSave=function(btn,id){
    return run(btn,async()=>{
      const qty=numOrNull(val('wiQty')),rate=numOrNull(val('wiRate'));
      if(qty==null||isNaN(qty)||qty<=0)return toast('Enter a quantity above zero','warn');
      if(rate==null||isNaN(rate)||rate<0)return toast('Enter the rate','warn');
      const {error}=await E().from('wo_items').update({qty:qty,rate:rate}).eq('id',id);if(error)throw error;
      closeModal();toast('Item updated','ok');renderPage();
    });
  };
  ENG.f.woItemDel=async function(id){
    if(!await confirmDialog('Remove this item from the work order? The BOQ line becomes available to tag again.',{okLabel:'Remove'}))return;
    try{const {error}=await E().from('wo_items').delete().eq('id',id);if(error)throw error;toast('Item removed','ok');renderPage();}catch(e){fail(e);}
  };

  /* ---------------------------------------------------------------- tag BOQ onto a work order */
  // A reusable picker of untagged BOQ lines, used both to tag lines onto a draft work order and to add new items in an amendment.
  // cfg: {title, project_id, project_name, intro, okLabel, save:async(rows:[{boq_item_id,qty,rate}], btn)=>void}
  const PK={cfg:null,project_id:null,rows:[],total:0,page:0,sel:new Map(),f:{tower:'',group:'',level:'',q:''},towers:[]};
  const PK_SIZE=50;
  ENG.f.woTag=function(id){
    const W=L().woCur;
    return ENG.boqPicker({title:'Tag BOQ lines — '+W.wo_no,project_id:W.project_id,project_name:W.project_name,okLabel:'Tag selected',
      intro:'Set the quantity and the contractor’s rate for each line you want on this work order.',
      save:async(rows,btn)=>{
        let n=0;
        for(const c of chunk(rows,200)){
          btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> '+n+' / '+rows.length;
          const {error}=await E().from('wo_items').insert(c.map(r=>({wo_id:W.id,boq_item_id:r.boq_item_id,qty:r.qty,rate:r.rate})));if(error)throw error;n+=c.length;
        }
        closeModal();toast(n+' item'+(n===1?'':'s')+' tagged','ok');renderPage();
      }});
  };
  ENG.boqPicker=async function(cfg){
    PK.cfg=cfg;PK.project_id=cfg.project_id;PK.rows=[];PK.total=0;PK.page=0;PK.sel=new Map();PK.f={tower:'',group:'',level:'',q:''};
    modal(esc(cfg.title),LOAD,'','xl');
    try{PK.towers=await ENG.loadTowers(cfg.project_id);}catch(e){PK.towers=[];}
    $('modalHost').querySelector('.modal-body').innerHTML=
      '<div class="eng-note" style="margin-bottom:12px">Only BOQ lines of <b>'+esc(cfg.project_name)+'</b> with quantity still untagged are shown. '+esc(cfg.intro||'')+'</div>'+
      '<div class="eng-filter"><div class="toolbar grow" style="margin:0;flex:1;min-width:180px"><div class="grow"><i class="fa-solid fa-magnifying-glass"></i><input placeholder="Search activity or location…" oninput="ENG.f.pkFilter(\'q\',this.value)"></div></div>'+
      '<select class="sel" onchange="ENG.f.pkFilter(\'tower\',this.value)"><option value="">All locations</option><option value="P">Business unit level</option>'+opts(PK.towers,x=>x.id,x=>x.name,'')+'</select>'+
      '<select class="sel" onchange="ENG.f.pkFilter(\'group\',this.value)">'+opts(C.groups,g=>g.id,g=>g.name,'','All groups')+'</select>'+
      '<select class="sel" onchange="ENG.f.pkFilter(\'level\',this.value)">'+opts(['Project','Block','Floor','Flat','Portion'],x=>x,x=>x,'','All levels')+'</select></div>'+
      '<div id="pkSum" class="eng-sum" style="margin-bottom:8px"></div><div class="eng-tbl" style="border:1px solid var(--line);border-radius:9px;max-height:46vh;overflow:auto" id="pkList"></div>';
    $('modalHost').querySelector('.modal').insertAdjacentHTML('beforeend','<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="pkGo" onclick="ENG.f.pkSave(this)"><i class="fa-solid fa-link"></i> '+esc(cfg.okLabel||'Select')+'</button></div>');
    ENG.f.pkLoad();
  };
  let pkTimer=null;
  ENG.f.pkFilter=function(k,v){PK.f[k]=v;PK.page=0;clearTimeout(pkTimer);pkTimer=setTimeout(ENG.f.pkLoad,k==='q'?250:0);};
  function pkQuery(){
    let x=E().from('v_boq').select('*',{count:'exact'}).eq('project_id',PK.project_id).gt('remaining_qty',0);
    const f=PK.f;
    if(f.tower)x=f.tower==='P'?x.is('tower_id',null):x.eq('tower_id',Number(f.tower));
    if(f.group)x=x.eq('group_id',Number(f.group));
    if(f.level)x=x.eq('location_level',f.level);
    const qq=f.q.trim().replace(/[%,()]/g,' ');
    if(qq)x=x.or('activity_name.ilike.%'+qq+'%,location_label.ilike.%'+qq+'%');
    return x.order('group_sort').order('activity_name').order('tower_sort').order('floor_no',{nullsFirst:true}).order('flat_code',{nullsFirst:true}).order('id');
  }
  ENG.f.pkLoad=async function(){
    const host=$('pkList');if(!host)return;
    host.innerHTML=LOAD;
    try{
      const {data,error,count}=await pkQuery().range(PK.page*PK_SIZE,(PK.page+1)*PK_SIZE-1);
      if(error)throw error;
      PK.rows=data||[];PK.total=count||0;ENG.f.pkRender();
    }catch(e){host.innerHTML=ENG.errCard(e);}
  };
  ENG.f.pkRender=function(){
    const host=$('pkList');if(!host)return;
    host.innerHTML=PK.rows.length?
      '<table class="tbl"><thead><tr><th style="width:34px"><input type="checkbox" onchange="ENG.f.pkTickPage(this.checked)"></th><th>Activity</th><th>Location</th><th class="r">Untagged</th><th class="r" style="width:120px">Quantity</th><th class="r" style="width:130px">Rate (₹)</th></tr></thead><tbody>'+
      PK.rows.map(r=>{const s=PK.sel.get(r.id);return '<tr class="'+(s?'sel':'')+'"><td><input type="checkbox" '+(s?'checked':'')+' onchange="ENG.f.pkTick('+r.id+',this.checked)"></td><td><b>'+esc(r.activity_name)+'</b><div class="sub" style="font-size:12px;color:var(--slate)">'+esc(r.group_name)+'</div></td><td>'+lvTag(r.location_level)+' <span style="margin-left:4px">'+esc(r.location_label)+'</span></td><td class="r">'+q(r.remaining_qty)+' '+esc(r.uom)+'</td>'+
        '<td><input type="number" min="0" step="0.001" style="width:100%;text-align:right" value="'+(s?s.qty:num(r.remaining_qty))+'" onchange="ENG.f.pkEdit('+r.id+',\'qty\',this.value)"></td>'+
        '<td><input type="number" min="0" step="0.01" style="width:100%;text-align:right" value="'+(s?s.rate:num(r.rate))+'" onchange="ENG.f.pkEdit('+r.id+',\'rate\',this.value)"></td></tr>';}).join('')+'</tbody></table>'+pager(PK.total,PK.page,PK_SIZE,'ENG.f.pkPage'):
      '<div class="empty" style="padding:36px"><i class="fa-solid fa-list-ol"></i><div style="font-weight:600;color:var(--ink)">No untagged BOQ lines match</div><p>Add BOQ lines in the BOQ tab, or change the filters.</p></div>';
    ENG.f.pkSum();
  };
  ENG.f.pkSum=function(){
    const s=$('pkSum');if(!s)return;
    let amt=0;PK.sel.forEach(x=>amt+=num(x.qty)*num(x.rate));
    s.innerHTML='<span><b>'+PK.sel.size+'</b> selected</span><span>Value <b>'+inr(amt)+'</b></span>'+
      (PK.total>PK_SIZE?'<span><a style="cursor:pointer;color:var(--brand)" onclick="ENG.f.pkAll()">Select all '+PK.total+' matching</a></span>':'')+
      (PK.sel.size?'<span><a style="cursor:pointer;color:var(--brand)" onclick="ENG.f.pkClear()">Clear selection</a></span>':'');
    const go=$('pkGo');if(go)go.disabled=!PK.sel.size;
  };
  ENG.f.pkPage=function(p){PK.page=p;ENG.f.pkLoad();};
  ENG.f.pkTick=function(id,on){
    if(!on){PK.sel.delete(id);}else{const r=PK.rows.find(x=>x.id===id);if(r)PK.sel.set(id,{qty:num(r.remaining_qty),rate:num(r.rate),max:num(r.remaining_qty)});}
    ENG.f.pkRender();
  };
  ENG.f.pkTickPage=function(on){PK.rows.forEach(r=>on?PK.sel.set(r.id,PK.sel.get(r.id)||{qty:num(r.remaining_qty),rate:num(r.rate),max:num(r.remaining_qty)}):PK.sel.delete(r.id));ENG.f.pkRender();};
  ENG.f.pkEdit=function(id,k,v){
    const r=PK.rows.find(x=>x.id===id);
    const cur=PK.sel.get(id)||{qty:num(r&&r.remaining_qty),rate:num(r&&r.rate),max:num(r&&r.remaining_qty)};
    cur[k]=num(v);PK.sel.set(id,cur);ENG.f.pkRender();
  };
  ENG.f.pkAll=async function(){
    try{
      const rows=await fetchAll(()=>pkQuery());
      rows.forEach(r=>{if(!PK.sel.has(r.id))PK.sel.set(r.id,{qty:num(r.remaining_qty),rate:num(r.rate),max:num(r.remaining_qty)});});
      ENG.f.pkRender();
    }catch(e){fail(e);}
  };
  ENG.f.pkClear=function(){PK.sel=new Map();ENG.f.pkRender();};
  ENG.f.pkSave=function(btn){
    return run(btn,async()=>{
      const rows=[];
      for(const [id,s] of PK.sel){
        if(!(s.qty>0))return toast('Every selected line needs a quantity above zero','warn');
        if(s.qty>s.max+1e-9)return toast('A quantity is more than what is still untagged','warn');
        if(isNaN(s.rate)||s.rate<0)return toast('Every selected line needs a rate','warn');
        rows.push({boq_item_id:id,qty:s.qty,rate:s.rate});
      }
      if(!rows.length)return;
      await PK.cfg.save(rows,btn);
    });
  };

  /* ======================================================================= WORK DONE — entry */
  const WE={wo:null,items:[]};
  ENG.f.wdEntry=async function(woId){
    modal('Enter work done',LOAD,'','xl');
    try{
      const w=(L().woCur&&L().woCur.id===woId)?L().woCur:(await E().from('v_work_orders').select('*').eq('id',woId).single()).data;
      WE.wo=w;
      const items=(L().woItems&&L().woCur&&L().woCur.id===woId)?L().woItems:await fetchAll(()=>E().from('v_wo_items').select('*').eq('wo_id',woId).order('id'));
      WE.items=items.map(r=>Object.assign({},r,{balance:num(r.qty)-num(r.verified_qty)-num(r.pending_qty)})).filter(r=>r.balance>0.0005);
    }catch(e){return fail(e);}
    const body=$('modalHost').querySelector('.modal-body');
    if(!WE.items.length){body.innerHTML='<div class="empty" style="padding:30px"><i class="fa-solid fa-circle-check"></i><div style="font-weight:600;color:var(--ink)">Everything on this work order has been entered</div></div>';return;}
    body.innerHTML=
      '<div class="eng-note" style="margin-bottom:12px">Enter the quantity completed for each item since the last entry — leave the rest blank. A different person will verify it before it can be billed.</div>'+
      '<div class="two"><div><label>Date of work</label><input id="weDate" type="date" max="'+istToday()+'" value="'+istToday()+'"></div><div><label>Remarks <span style="color:var(--slate);font-weight:400">optional, applies to all</span></label><input id="weRem"></div></div>'+
      '<div class="toolbar" style="margin:14px 0 8px"><div class="grow"><i class="fa-solid fa-magnifying-glass"></i><input placeholder="Search activity or location…" oninput="ENG.f.weFilter(this.value)"></div><span id="weSum" style="font-size:12.5px;color:var(--slate)"></span></div>'+
      '<div class="eng-tbl" style="border:1px solid var(--line);border-radius:9px;max-height:46vh;overflow:auto"><table class="tbl"><thead><tr><th>Activity</th><th>Location</th><th class="r">Ordered</th><th class="r">Done so far</th><th class="r">Balance</th><th class="r" style="width:130px">Done now</th></tr></thead><tbody>'+
      WE.items.map(r=>'<tr data-t="'+esc(lc(r.activity_name+' '+r.location_label))+'"><td><b>'+esc(r.activity_name)+'</b></td><td>'+esc(r.location_label)+'</td><td class="r">'+q(r.qty)+' '+esc(r.uom)+'</td><td class="r">'+q(num(r.verified_qty)+num(r.pending_qty))+'</td><td class="r">'+q(r.balance)+'</td><td><input type="number" class="weIn" data-id="'+r.id+'" data-max="'+r.balance+'" min="0" step="0.001" style="width:100%;text-align:right" oninput="ENG.f.weSum()"></td></tr>').join('')+'</tbody></table></div>';
    $('modalHost').querySelector('.modal').insertAdjacentHTML('beforeend','<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="ENG.f.weSave(this)"><i class="fa-solid fa-check"></i> Save entries</button></div>');
    ENG.f.weSum();
  };
  ENG.f.weFilter=function(s){s=lc(s).trim();document.querySelectorAll('#modalHost tbody tr').forEach(tr=>tr.style.display=(!s||(tr.getAttribute('data-t')||'').indexOf(s)>=0)?'':'none');};
  ENG.f.weSum=function(){
    let n=0,amt=0;const byId={};WE.items.forEach(r=>byId[r.id]=r);
    document.querySelectorAll('.weIn').forEach(i=>{const x=num(i.value);if(x>0){n++;amt+=x*num(byId[i.getAttribute('data-id')].rate);}});
    const s=$('weSum');if(s)s.innerHTML='<b>'+n+'</b> item'+(n===1?'':'s')+' · value <b>'+inr(amt)+'</b>';
  };
  ENG.f.weSave=function(btn){
    return run(btn,async()=>{
      const date=val('weDate'),rem=val('weRem').trim()||null;
      if(!date)return toast('Enter the date of work','warn');
      const rows=[];let bad=null;
      document.querySelectorAll('.weIn').forEach(i=>{
        const x=num(i.value);if(!(x>0))return;
        if(x>num(i.getAttribute('data-max'))+1e-9)bad=true;
        rows.push({wo_item_id:Number(i.getAttribute('data-id')),entry_date:date,qty:x,remarks:rem});
      });
      if(bad)return toast('One of the quantities is more than the balance on the work order','warn');
      if(!rows.length)return toast('Enter a quantity for at least one item','warn');
      for(const c of chunk(rows,200)){const {error}=await E().from('work_done').insert(c);if(error)throw error;}
      closeModal();toast(rows.length+' entr'+(rows.length===1?'y':'ies')+' saved — waiting for verification','ok');renderPage();
    });
  };

  /* ======================================================================= WORK DONE — list & verification */
  function wdTable(rows,selectable,compact){
    if(!rows.length)return '<div class="empty" style="padding:30px"><i class="fa-solid fa-person-digging"></i><div style="font-weight:600;color:var(--ink)">Nothing here</div></div>';
    const sel=L().wdSel||new Set();
    return '<table class="tbl"><thead><tr>'+(selectable?'<th style="width:34px"><input type="checkbox" onchange="ENG.f.wdTickPage(this.checked)"></th>':'')+'<th>Date</th>'+(compact?'':'<th>Work order</th>')+'<th>Activity / location</th><th class="r">Quantity</th><th class="r">Value</th><th>Status</th><th>Entered by</th><th>Billing</th><th></th></tr></thead><tbody>'+
      rows.map(r=>{
        const acts=[];
        if(canVerify(r))acts.push('<button class="btn btn-sm btn-ok" onclick="ENG.f.wdVerify(['+r.id+'])"><i class="fa-solid fa-check"></i> Verify</button><button class="btn btn-sm btn-danger" onclick="ENG.f.wdReject('+r.id+')">Reject</button>');
        else if(r.status==='Entered')acts.push('<span style="font-size:11.5px;color:var(--slate)" title="Verification needs a different person">you entered this</span>');
        if(canEditOwn(r))acts.push('<button class="btn btn-sm" title="'+(r.status==='Rejected'?'Correct and re-submit':'Edit')+'" onclick="ENG.f.wdEdit('+r.id+')"><i class="fa-solid '+(r.status==='Rejected'?'fa-rotate-left':'fa-pen')+'"></i></button><button class="btn btn-sm btn-danger" title="Delete" onclick="ENG.f.wdDel('+r.id+')"><i class="fa-solid fa-trash"></i></button>');
        return '<tr class="'+(sel.has(r.id)?'sel':'')+'">'+(selectable?'<td>'+(canVerify(r)?'<input type="checkbox" '+(sel.has(r.id)?'checked':'')+' onchange="ENG.f.wdTick('+r.id+',this.checked)">':'')+'</td>':'')+
          '<td>'+dt(r.entry_date)+'</td>'+(compact?'':'<td>'+woLink(r.wo_id,r.wo_no)+'</td>')+
          '<td><b>'+esc(r.activity_name)+'</b>'+(r.sub_vendor_name?' <span class="tag t-purple">'+esc(r.sub_vendor_name)+'</span>':'')+'<div class="sub" style="font-size:12px;color:var(--slate)">'+esc(r.location_label)+(r.remarks?' · “'+esc(r.remarks)+'”':'')+'</div></td>'+
          '<td class="r">'+q(r.qty)+' '+esc(r.uom)+'</td><td class="r">'+inr(r.value)+'</td>'+
          '<td>'+stTag(r.status)+(r.status==='Rejected'&&r.verify_remarks?'<div style="font-size:11.5px;color:var(--err);margin-top:3px;max-width:200px">'+esc(r.verify_remarks)+'</div>':'')+(r.verified_by?'<div style="font-size:11.5px;color:var(--slate);margin-top:3px">by '+who(r.verified_by)+'</div>':'')+'</td>'+
          '<td>'+who(r.entered_by)+'</td><td>'+(r.bill_no?'<a style="color:var(--brand);cursor:pointer" onclick="navTo(\'engineering/ra/'+r.ra_bill_id+'\')">'+esc(r.bill_no)+'</a> '+(r.bill_status==='Draft'?'<span class="tag t-amber">draft</span>':''):(r.status==='Verified'?'<span class="tag t-blue">ready to bill</span>':'<span style="color:var(--slate)">—</span>'))+'</td>'+
          '<td style="white-space:nowrap;text-align:right">'+acts.join(' ')+'</td></tr>';
      }).join('')+'</tbody></table>';
  }

  ENG.routes.wd=async function(v,a,t){
    const pid=curProject();
    v.innerHTML=head('wd','Work recorded on site against work order items — verified by someone other than the person who entered it')+projBar(true)+
      '<div class="eng-filter"><div class="eng-chips" id="wdChips"></div><div class="toolbar grow" style="margin:0;flex:1;min-width:200px"><div class="grow"><i class="fa-solid fa-magnifying-glass"></i><input placeholder="Search work order, activity or location…" oninput="ENG.f.wdSearch(this.value)"></div></div></div>'+
      '<div class="card eng-tbl"><div id="wdHead" class="card-pad" style="border-bottom:1px solid var(--line)"></div><div id="wdTable">'+LOAD+'</div></div>';
    L().wdF=L().wdF||{status:'Entered',q:'',page:0};L().wdF.page=0;L().wdSel=new Set();
    ENG.f.wdLoad();
  };
  ENG.f.wdSearch=(function(){let tm=null;return function(s){L().wdF.q=s;L().wdF.page=0;clearTimeout(tm);tm=setTimeout(ENG.f.wdLoad,250);};})();
  ENG.f.wdStatus=function(s){L().wdF.status=s;L().wdF.page=0;L().wdSel=new Set();ENG.f.wdLoad();};
  ENG.f.wdPage=function(p){L().wdF.page=p;ENG.f.wdLoad();};
  ENG.f.wdLoad=async function(){
    const f=L().wdF,pid=curProject();
    const chips=$('wdChips');if(!chips)return;
    chips.innerHTML=[['Entered','Awaiting verification'],['Verified','Verified'],['Rejected','Rejected'],['','All']].map(c=>'<span class="chip'+(f.status===c[0]?' active':'')+'" onclick="ENG.f.wdStatus(\''+c[0]+'\')">'+c[1]+'</span>').join('');
    $('wdTable').innerHTML=LOAD;
    try{
      let x=E().from('v_work_done').select('*',{count:'exact'});
      if(pid)x=x.eq('project_id',pid);
      if(f.status)x=x.eq('status',f.status);
      const qq=f.q.trim().replace(/[%,()]/g,' ');
      if(qq)x=x.or('wo_no.ilike.%'+qq+'%,activity_name.ilike.%'+qq+'%,location_label.ilike.%'+qq+'%');
      const {data,error,count}=await x.order('entry_date',{ascending:false}).order('id',{ascending:false}).range(f.page*PAGE_SIZE,(f.page+1)*PAGE_SIZE-1);
      if(error)throw error;
      L().wdRows=data||[];indexRows(L().wdRows);
      const amt=(data||[]).reduce((s,r)=>s+num(r.value),0);
      const verifiable=L().wdRows.filter(canVerify).length;
      $('wdHead').innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div class="eng-sum"><span><b>'+(count||0)+'</b> entr'+(count===1?'y':'ies')+'</span><span>This page <b>'+inr(amt)+'</b></span></div>'+
        (f.status==='Entered'&&verifiable?'<div style="display:flex;gap:8px;align-items:center"><span style="font-size:12.5px;color:var(--slate)">'+L().wdSel.size+' selected</span><button class="btn btn-sm btn-ok" '+(L().wdSel.size?'':'disabled')+' onclick="ENG.f.wdVerifySel()"><i class="fa-solid fa-check-double"></i> Verify selected</button></div>':'')+'</div>';
      $('wdTable').innerHTML=wdTable(L().wdRows,f.status==='Entered',false)+pager(count||0,f.page,PAGE_SIZE,'ENG.f.wdPage');
    }catch(e){$('wdTable').innerHTML=ENG.errCard(e);}
  };
  ENG.f.wdTick=function(id,on){const s=L().wdSel;on?s.add(id):s.delete(id);ENG.f.wdLoadLocal();};
  ENG.f.wdTickPage=function(on){const s=L().wdSel;(L().wdRows||[]).filter(canVerify).forEach(r=>on?s.add(r.id):s.delete(r.id));ENG.f.wdLoadLocal();};
  ENG.f.wdLoadLocal=function(){   // re-draw from the rows already loaded (keeps the selection)
    const f=L().wdF;if(!$('wdTable'))return;
    $('wdTable').innerHTML=wdTable(L().wdRows||[],f.status==='Entered',false)+$('wdTable').querySelector('.eng-pager').outerHTML;
    const btn=$('wdHead').querySelector('.btn-ok'),cnt=btn&&btn.previousElementSibling;
    if(btn){btn.disabled=!L().wdSel.size;if(cnt)cnt.textContent=L().wdSel.size+' selected';}
  };

  async function wdSetStatus(ids,status,remarks){
    let ok=0;const errors=[];
    for(const id of ids){
      const patch={status:status};if(remarks)patch.verify_remarks=remarks;
      const {error}=await E().from('work_done').update(patch).eq('id',id);
      if(error)errors.push(error.message);else ok++;
    }
    return {ok:ok,errors:errors};
  }
  ENG.f.wdVerify=async function(ids){
    const r=await wdSetStatus(ids,'Verified');
    if(r.ok)toast(r.ok+' entr'+(r.ok===1?'y':'ies')+' verified','ok');
    if(r.errors.length)toast(r.errors[0]+(r.errors.length>1?' (+'+(r.errors.length-1)+' more)':''),'err');
    L().wdSel=new Set();renderPage();
  };
  ENG.f.wdVerifySel=async function(){
    const ids=[...L().wdSel];if(!ids.length)return;
    if(!await confirmDialog('Verify '+ids.length+' entr'+(ids.length===1?'y':'ies')+'? Verified work can then be billed.',{okLabel:'Verify',danger:false,icon:'fa-check-double'}))return;
    ENG.f.wdVerify(ids);
  };
  ENG.f.wdReject=function(id){
    modal('Reject entry','<div class="eng-note">The person who entered it will see your reason and can correct and re-submit it.</div><label>Reason</label><textarea id="wdWhy" placeholder="What is wrong with this entry?"></textarea>',
      cancelBtn+'<button class="btn btn-danger-solid" onclick="ENG.f.wdRejectSave(this,'+id+')">Reject</button>');
  };
  ENG.f.wdRejectSave=function(btn,id){
    return run(btn,async()=>{
      const why=val('wdWhy').trim();if(!why)return toast('Give a reason','warn');
      const r=await wdSetStatus([id],'Rejected',why);
      if(r.errors.length)throw new Error(r.errors[0]);
      closeModal();toast('Entry rejected','ok');renderPage();
    });
  };
  ENG.f.wdEdit=function(id){
    const r=idx()[id];if(!r)return;
    modal('Edit entry','<div style="font-weight:600">'+esc(r.activity_name)+'</div><div style="color:var(--slate);font-size:13px;margin-top:2px">'+esc(r.wo_no)+' · '+esc(r.location_label)+'</div>'+
      '<div class="two"><div><label>Date of work</label><input id="wxDate" type="date" max="'+istToday()+'" value="'+esc(r.entry_date)+'"></div><div><label>Quantity ('+esc(r.uom)+')</label><input id="wxQty" type="number" min="0" step="0.001" value="'+num(r.qty)+'"></div></div>'+
      '<label>Remarks</label><input id="wxRem" value="'+esc(r.remarks)+'">',
      cancelBtn+'<button class="btn btn-primary" onclick="ENG.f.wdEditSave(this,'+id+')"><i class="fa-solid fa-check"></i> Save</button>');
  };
  ENG.f.wdEditSave=function(btn,id){
    return run(btn,async()=>{
      const qty=numOrNull(val('wxQty'));
      if(qty==null||isNaN(qty)||qty<=0)return toast('Enter a quantity above zero','warn');
      const {error}=await E().from('work_done').update({status:'Entered',qty:qty,entry_date:val('wxDate'),remarks:val('wxRem').trim()||null}).eq('id',id);if(error)throw error;
      closeModal();toast('Entry saved — waiting for verification','ok');renderPage();
    });
  };
  ENG.f.wdDel=async function(id){
    if(!await confirmDialog('Delete this entry?',{okLabel:'Delete'}))return;
    try{const {error}=await E().from('work_done').delete().eq('id',id);if(error)throw error;toast('Entry deleted','ok');renderPage();}catch(e){fail(e);}
  };
})();
