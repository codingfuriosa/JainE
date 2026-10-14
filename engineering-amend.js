/* ===========================================================================
   JAIN-E · ENGINEERING — Work Order Amendments   [loads after engineering-wo.js]
   Creating a work order lives under "Work Orders"; changing one that has already been issued lives here.
   An amendment is drafted (revise item quantities/rates, add BOQ lines, short-close items, revise end date,
   conditions and retention/TDS/GST), then issued — which applies everything to the work order in one step —
   and is kept forever as a record with before/after figures.
   Rate rule (enforced in the database): once work has been entered against an item its rate never changes.
   Changing the rate of a part-executed item keeps the work already done at the old rate and moves only the
   balance to the new rate, on a new line.  So a bill that has been raised can never change.
   =========================================================================== */
(function(){
  if(typeof window.ENG==='undefined')return;
  const ENG=window.ENG;
  const {E,lc,num,inr,q,dt,istToday,val,numOrNull,stTag,lvTag,LOAD,fail,run,fetchAll,head,modal,cancelBtn,opts,pager,projBar,curProject}=ENG;
  const L=()=>ENG.L;
  const PAGE_SIZE=100;
  const r2=n=>Math.round((n+Number.EPSILON)*100)/100;
  const who=e=>e?esc(String(e).split('@')[0]):'—';
  const sgn=n=>(n>=0?'+':'−')+inr(Math.abs(n));
  const linkWo=(id,no)=>'<a style="color:var(--brand);font-weight:600;cursor:pointer" onclick="navTo(\'engineering/wo/'+id+'\')">'+esc(no)+'</a>';
  const amTag=n=>'AM-'+String(n).padStart(2,'0');

  /* what an item-change line does, in words and in money (used for drafts and for history) */
  function chg(l,issued){
    const oldQty=issued?num(l.old_qty):num(l.cur_qty),oldRate=issued?num(l.old_rate):num(l.cur_rate);
    const exec=issued?num(l.executed_qty):num(l.cur_executed);
    const nq=num(l.new_qty),nr=num(l.new_rate);
    const rateChanged=nr!==oldRate,split=rateChanged&&exec>0,before=r2(oldQty*oldRate);
    let after,txt;
    if(nq===oldQty&&!rateChanged){after=before;txt='No change';}
    else if(split){
      if(nq>exec){after=r2(exec*oldRate+(nq-exec)*nr);txt=q(exec)+' already done stays at '+inr(oldRate)+'; the balance of '+q(nq-exec)+' moves to '+inr(nr)+' on a new line';}
      else{after=r2(nq*oldRate);txt='Closed at what is already done ('+q(exec)+')';}
    }else{
      after=r2(nq*nr);
      if(nq===0)txt='Short-closed — nothing further to execute';
      else if(rateChanged&&nq!==oldQty)txt='Quantity '+q(oldQty)+' → '+q(nq)+' and rate '+inr(oldRate)+' → '+inr(nr);
      else if(rateChanged)txt='Rate '+inr(oldRate)+' → '+inr(nr)+' (no work entered yet)';
      else txt=(nq>oldQty?'Quantity increased by ':'Quantity reduced by ')+q(Math.abs(nq-oldQty));
    }
    return {oldQty:oldQty,oldRate:oldRate,exec:exec,before:before,after:after,txt:txt,split:split,bad:nq<exec-1e-9};
  }
  ENG.chg=chg;

  /* ======================================================================= LIST */
  ENG.routes.amend=async function(v,a,t){
    if(a[0])return amendDetail(v,Number(a[0]),t);
    const pid=curProject();
    v.innerHTML=head('amend','Changes to issued work orders — revised quantities and rates, extra items, short-closing and new terms',
      '<button class="btn btn-primary" onclick="ENG.f.amendStart()"><i class="fa-solid fa-plus"></i> New amendment</button>')+projBar(true)+'<div id="engBody">'+LOAD+'</div>';
    const rows=await fetchAll(()=>{let x=E().from('v_wo_amendments').select('*').order('id',{ascending:false});if(pid)x=x.eq('project_id',pid);return x;});
    if(ENG.stale(t))return;
    L().amRows=rows;L().amF={status:'',q:'',page:0};
    $('engBody').innerHTML=
      '<div class="eng-note" style="margin-bottom:14px">New work orders are created in <a style="color:var(--brand);cursor:pointer" onclick="navTo(\'engineering/wo\')">Work Orders</a>. Once a work order is issued it can only be changed here, so every change is reviewed, dated and kept on record.</div>'+
      '<div class="eng-filter"><div class="toolbar grow" style="margin:0;flex:1;min-width:200px"><div class="grow"><i class="fa-solid fa-magnifying-glass"></i><input placeholder="Search amendment, work order, reason or contractor…" oninput="ENG.f.amFilter(\'q\',this.value)"></div></div>'+
      '<select class="sel" onchange="ENG.f.amFilter(\'status\',this.value)">'+opts(['Draft','Issued','Cancelled'],x=>x,x=>x,'','All statuses')+'</select></div><div class="card eng-tbl" id="amCard"></div>';
    ENG.f.amRender();
  };
  ENG.f.amFilter=function(k,v){const f=L().amF;f[k]=v;f.page=0;ENG.f.amRender();};
  ENG.f.amPage=function(p){L().amF.page=p;ENG.f.amRender();};
  ENG.f.amRender=function(){
    const f=L().amF,qq=lc(f.q).trim();
    const rows=(L().amRows||[]).filter(r=>(!f.status||r.status===f.status)&&(!qq||lc(r.amend_ref+' '+r.title+' '+r.vendor_name+' '+r.project_name).indexOf(qq)>=0));
    const pg=rows.slice(f.page*PAGE_SIZE,(f.page+1)*PAGE_SIZE);
    $('amCard').innerHTML=rows.length?
      '<table class="tbl"><thead><tr><th>Amendment</th><th>Parent contractor</th><th>Business unit</th><th>Effective</th><th class="r">Lines</th><th class="r">Value change</th><th>Status</th></tr></thead><tbody>'+
      pg.map(r=>'<tr class="clk" onclick="navTo(\'engineering/amend/'+r.id+'\')"><td><b>'+esc(r.amend_ref)+'</b><div class="sub" style="font-size:12px;color:var(--slate)">'+esc(r.title)+'</div></td><td>'+esc(r.vendor_name)+'</td><td>'+esc(r.project_name)+'</td><td>'+dt(r.effective_date)+'</td><td class="r">'+r.line_count+'</td><td class="r">'+(r.status==='Issued'?'<b>'+sgn(num(r.value_change))+'</b>':'<span style="color:var(--slate)">—</span>')+'</td><td>'+stTag(r.status)+'</td></tr>').join('')+
      '</tbody></table>'+pager(rows.length,f.page,PAGE_SIZE,'ENG.f.amPage'):
      '<div class="empty" style="padding:44px"><i class="fa-solid fa-pen-ruler"></i><div style="font-weight:600;color:var(--ink)">'+((L().amRows||[]).length?'No amendments match':'No amendments yet')+'</div>'+((L().amRows||[]).length?'':'<p>Start one from an issued work order, or use <b>New amendment</b>.</p>')+'</div>';
  };

  /* ======================================================================= START */
  ENG.f.amendStart=async function(woId){
    modal('New amendment',LOAD);
    try{
      if(woId){
        const {data}=await E().from('v_wo_amendments').select('id').eq('wo_id',woId).eq('status','Draft').maybeSingle();
        if(data){closeModal();toast('This work order already has a draft amendment — opening it','warn');return navTo('engineering/amend/'+data.id);}
      }
      const pid=curProject();
      let qy=E().from('v_work_orders').select('id,wo_no,title,project_id,project_name,vendor_name,wo_date').eq('status','Issued').order('id',{ascending:false});
      if(woId)qy=qy.eq('id',woId);else if(pid)qy=qy.eq('project_id',pid);
      const {data:wos,error}=await qy;if(error)throw error;
      const body=$('modalHost').querySelector('.modal-body');
      if(!wos||!wos.length){body.innerHTML='<div class="empty" style="padding:30px"><i class="fa-solid fa-file-contract"></i><div style="font-weight:600;color:var(--ink)">No issued work orders to amend</div><p>Only an issued work order can be amended. Drafts are edited directly under Work Orders.</p></div>';return;}
      L().amWos=wos;
      body.innerHTML=
        '<label>Work order</label><select id="asWo" '+(woId?'disabled':'')+'>'+opts(wos,w=>w.id,w=>w.wo_no+' — '+w.vendor_name+' · '+w.title,woId||wos[0].id)+'</select>'+
        '<label>Reason for the amendment</label><input id="asTitle" placeholder="e.g. Revised plaster rate from 1 Nov; extra work in Block A2">'+
        '<div class="two"><div><label>Effective from</label><input id="asDate" type="date" value="'+istToday()+'"></div><div></div></div>'+
        '<div class="eng-note" style="margin-top:14px">You will draft the changes next. Nothing touches the work order until you issue the amendment.</div>';
      $('modalHost').querySelector('.modal').insertAdjacentHTML('beforeend','<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="ENG.f.amendCreate(this)"><i class="fa-solid fa-pen-ruler"></i> Start amendment</button></div>');
    }catch(e){fail(e);}
  };
  ENG.f.amendCreate=function(btn){
    return run(btn,async()=>{
      const wo=Number(val('asWo')),title=val('asTitle').trim(),date=val('asDate');
      if(!wo)return toast('Select a work order','warn');
      if(!title)return toast('Give the reason for the amendment','warn');
      if(!date)return toast('Enter the effective date','warn');
      const {data:ex}=await E().from('v_wo_amendments').select('id').eq('wo_id',wo).eq('status','Draft').maybeSingle();
      if(ex){closeModal();toast('This work order already has a draft amendment — opening it','warn');return navTo('engineering/amend/'+ex.id);}
      const {data,error}=await E().from('wo_amendments').insert({wo_id:wo,title:title,effective_date:date}).select('id').single();
      if(error)throw error;
      closeModal();toast('Amendment started — draft the changes below','ok');navTo('engineering/amend/'+data.id);
    });
  };

  /* ======================================================================= DETAIL */
  async function amendDetail(v,id,t){
    v.innerHTML=head('amend','','')+LOAD;
    const [a,lines]=await Promise.all([
      E().from('v_wo_amendments').select('*').eq('id',id).maybeSingle(),
      fetchAll(()=>E().from('v_wo_amendment_items').select('*').eq('amendment_id',id).order('id'))
    ]);
    if(ENG.stale(t))return;
    if(a.error)throw a.error;
    if(!a.data){v.innerHTML=head('amend','','')+'<div class="card card-pad empty"><i class="fa-solid fa-pen-ruler"></i><div style="font-weight:600;color:var(--ink)">Amendment not found</div><p><a style="color:var(--brand);cursor:pointer" onclick="navTo(\'engineering/amend\')">Back to amendments</a></p></div>';return;}
    const A=a.data;
    const wr=await E().from('v_work_orders').select('*').eq('id',A.wo_id).single();
    if(ENG.stale(t))return;
    if(wr.error)throw wr.error;
    const W=wr.data;L().amCur=A;L().amLines=lines;L().amWo=W;
    const draft=A.status==='Draft',issued=A.status==='Issued';
    const changes=lines.filter(l=>l.action==='change'),adds=lines.filter(l=>l.action==='add');
    const delta=changes.reduce((s,l)=>{const c=chg(l,issued);return s+(c.after-c.before);},0)+adds.reduce((s,l)=>s+r2(num(l.new_qty)*num(l.new_rate)),0);
    const before=issued?num(A.value_before):num(W.value),after=issued?num(A.value_after):before+r2(delta),diff=issued?num(A.value_change):r2(delta);
    const cur=issued?(A.old_terms||{}):{end_date:W.end_date,terms:W.terms,retention_pct:W.retention_pct,tds_pct:W.tds_pct,gst_pct:W.gst_pct};
    const nw={end_date:A.new_end_date,terms:A.new_terms,retention_pct:A.new_retention_pct,tds_pct:A.new_tds_pct,gst_pct:A.new_gst_pct};
    const isCh=k=>nw[k]!=null&&String(k==='end_date'||k==='terms'?nw[k]:num(nw[k]))!==String(k==='end_date'||k==='terms'?(cur[k]||''):num(cur[k]));
    const fmt=(k,x)=>x==null||x===''?'—':(k==='end_date'?dt(x):k==='terms'?'<span style="white-space:pre-wrap">'+esc(x)+'</span>':q(x)+'%');
    const termRows=[['end_date','End date'],['retention_pct','Retention'],['tds_pct','TDS'],['gst_pct','GST'],['terms','Conditions']];
    const bad=changes.some(l=>chg(l,false).bad);
    const btns=draft?
      '<button class="btn" onclick="ENG.f.amRevise()"><i class="fa-solid fa-sliders"></i> Revise items</button><button class="btn" onclick="ENG.f.amAddItems()"><i class="fa-solid fa-plus"></i> Add new items</button><button class="btn" onclick="ENG.f.amHeader()"><i class="fa-solid fa-pen"></i> Terms &amp; details</button><button class="btn btn-ok" onclick="ENG.f.amIssue()"><i class="fa-solid fa-stamp"></i> Issue amendment</button><button class="btn btn-danger" onclick="ENG.f.amCancel()">Cancel</button>':'';
    v.innerHTML=head('amend','','')+
      '<div style="margin-bottom:14px"><button class="btn btn-sm" onclick="navTo(\'engineering/amend\')"><i class="fa-solid fa-arrow-left"></i> All amendments</button></div>'+
      '<div class="card card-pad" style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:flex-start"><div>'+
        '<div style="font-size:12px;letter-spacing:.06em;color:var(--slate);font-weight:700">WORK ORDER AMENDMENT</div>'+
        '<div style="font-size:20px;font-weight:700;margin-top:2px">'+esc(A.amend_ref)+' '+stTag(A.status)+'</div><div style="font-size:14px;margin-top:3px">'+esc(A.title)+'</div>'+
        '<div class="eng-sum" style="margin-top:10px"><span>Work order <b>'+linkWo(A.wo_id,A.wo_no)+'</b></span><span>Parent contractor <b>'+esc(A.vendor_name)+'</b></span>'+(W.sub_names?'<span>Sub-contractors <b>'+esc(W.sub_names)+'</b></span>':'')+'<span>Project <b>'+esc(A.project_name)+'</b></span><span>Effective <b>'+dt(A.effective_date)+'</b></span></div>'+
        (issued?'<div style="margin-top:8px;font-size:12px;color:var(--slate)">Issued by '+who(A.issued_by)+' on '+dt(A.issued_at)+'</div>':'')+
        (A.status==='Cancelled'?'<div class="eng-note" style="margin-top:10px">Cancelled'+(A.cancelled_by?' by '+who(A.cancelled_by):'')+': '+esc(A.cancel_reason||'')+'</div>':'')+
        (draft&&W.status!=='Issued'?'<div class="eng-note" style="margin-top:10px;color:var(--err)">This work order is '+esc(W.status)+', so the amendment can no longer be issued.</div>':'')+
      '</div><div class="eng-actions">'+btns+'</div></div></div>'+
      '<div class="eng-kpis">'+
        [[issued?'Work order value before':'Work order value now',inr(before),'fa-file-contract','#1d4ed8','#eff4ff'],[issued?'Value after':'Value after this amendment',inr(after),'fa-file-circle-check','#0f766e','#f0fdfa'],['Change',sgn(diff),'fa-arrows-up-down','#7c3aed','#f5f3ff']].map(k=>'<div class="kpi"><div class="top"><div class="ic" style="background:'+k[4]+';color:'+k[3]+'"><i class="fa-solid '+k[2]+'"></i></div></div><div class="val">'+k[1]+'</div><div class="lbl">'+k[0]+'</div></div>').join('')+'</div>'+
      '<div class="card eng-tbl" style="margin-bottom:16px"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="sec-title" style="margin:0">Terms</div><div class="sec-sub" style="margin:2px 0 0">'+(draft?'Only what you change here is applied. New retention, TDS and GST apply to RA bills raised after the amendment — bills already raised keep theirs.':'Terms before and after this amendment')+'</div></div>'+
        '<table class="tbl"><thead><tr><th>Term</th><th>'+(issued?'Before':'Current')+'</th><th>After</th></tr></thead><tbody>'+
        termRows.map(r=>'<tr><td><b>'+r[1]+'</b></td><td>'+fmt(r[0],cur[r[0]])+'</td><td>'+(isCh(r[0])?'<b style="color:#6d28d9">'+fmt(r[0],nw[r[0]])+'</b>':'<span style="color:var(--slate)">unchanged</span>')+'</td></tr>').join('')+'</tbody></table></div>'+
      '<div class="card eng-tbl" style="margin-bottom:16px"><div class="card-pad" style="border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div><div class="sec-title" style="margin:0">Changes to existing items</div><div class="sec-sub" style="margin:2px 0 0">New quantity is the new <b>total</b> for the item. Work already entered is never re-priced.</div></div>'+(draft?'<button class="btn btn-sm" onclick="ENG.f.amRevise()"><i class="fa-solid fa-sliders"></i> Revise items</button>':'')+'</div>'+
        (bad?'<div class="eng-note" style="margin:12px 16px;color:var(--err)">A line asks for less than has already been entered — reject or correct that work first.</div>':'')+
        (changes.length?'<table class="tbl"><thead><tr><th>Activity / location</th><th class="r">'+(issued?'Before':'Current')+'</th><th class="r">Done</th><th class="r">New</th><th>What happens</th><th class="r">Value</th>'+(draft?'<th></th>':'')+'</tr></thead><tbody>'+
          changes.map(l=>{const c=chg(l,issued);return '<tr><td><b>'+esc(l.activity_name)+'</b>'+(num(l.item_amend_no)>0?' <span class="tag t-purple">'+amTag(l.item_amend_no)+'</span>':'')+'<div class="sub" style="font-size:12px;color:var(--slate)">'+esc(l.location_label)+'</div></td>'+
            '<td class="r">'+q(c.oldQty)+' '+esc(l.uom)+'<div class="sub" style="font-size:12px;color:var(--slate)">@ '+inr(c.oldRate)+'</div></td><td class="r">'+q(c.exec)+'</td>'+
            '<td class="r"><b>'+q(l.new_qty)+' '+esc(l.uom)+'</b><div class="sub" style="font-size:12px;color:var(--slate)">@ '+inr(l.new_rate)+'</div></td>'+
            '<td style="max-width:340px;font-size:12.5px">'+esc(c.txt)+'</td><td class="r"><b>'+sgn(c.after-c.before)+'</b></td>'+
            (draft?'<td style="white-space:nowrap;text-align:right"><button class="btn btn-sm" onclick="ENG.f.amLineEdit('+l.id+')"><i class="fa-solid fa-pen"></i></button> <button class="btn btn-sm btn-danger" onclick="ENG.f.amLineDel('+l.id+')"><i class="fa-solid fa-xmark"></i></button></td>':'')+'</tr>';}).join('')+'</tbody></table>':
          '<div class="empty" style="padding:26px">No existing items changed'+(draft?' — use <b>Revise items</b> to change a quantity or rate, or to short-close an item':'')+'</div>')+'</div>'+
      '<div class="card eng-tbl"><div class="card-pad" style="border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div><div class="sec-title" style="margin:0">New items</div><div class="sec-sub" style="margin:2px 0 0">BOQ lines added to the work order by this amendment</div></div>'+(draft?'<button class="btn btn-sm" onclick="ENG.f.amAddItems()"><i class="fa-solid fa-plus"></i> Add new items</button>':'')+'</div>'+
        (adds.length?'<table class="tbl"><thead><tr><th>Activity / location</th><th class="r">Quantity</th><th class="r">Rate</th><th class="r">Amount</th>'+(draft?'<th></th>':'')+'</tr></thead><tbody>'+
          adds.map(l=>'<tr><td><b>'+esc(l.activity_name)+'</b><div class="sub" style="font-size:12px;color:var(--slate)">'+esc(l.location_label)+'</div></td><td class="r">'+q(l.new_qty)+' '+esc(l.uom)+'</td><td class="r">'+inr(l.new_rate)+'</td><td class="r">'+inr(r2(num(l.new_qty)*num(l.new_rate)))+'</td>'+(draft?'<td style="white-space:nowrap;text-align:right"><button class="btn btn-sm" onclick="ENG.f.amLineEdit('+l.id+')"><i class="fa-solid fa-pen"></i></button> <button class="btn btn-sm btn-danger" onclick="ENG.f.amLineDel('+l.id+')"><i class="fa-solid fa-xmark"></i></button></td>':'')+'</tr>').join('')+'</tbody></table>':
          '<div class="empty" style="padding:26px">No new items'+(draft?' — use <b>Add new items</b> to tag more BOQ lines':'')+'</div>')+'</div>';
  }

  /* ---------------------------------------------------------------- header / terms */
  ENG.f.amHeader=function(){
    const A=L().amCur,W=L().amWo;
    modal('Amendment details & terms — '+esc(A.amend_ref),
      '<label>Reason</label><input id="ahTitle" value="'+esc(A.title)+'"><div class="two"><div><label>Effective from</label><input id="ahDate" type="date" value="'+esc(A.effective_date)+'"></div><div><label>End date</label><input id="ahEnd" type="date" value="'+esc(A.new_end_date||W.end_date||'')+'"></div></div>'+
      '<div style="font-size:12.5px;font-weight:600;margin:16px 0 2px">Commercial terms <span style="color:var(--slate);font-weight:400">— for RA bills raised after this amendment</span></div>'+
      '<div class="two" style="grid-template-columns:1fr 1fr 1fr"><div><label>Retention %</label><input id="ahRet" type="number" min="0" max="100" step="0.01" value="'+num(A.new_retention_pct!=null?A.new_retention_pct:W.retention_pct)+'"></div><div><label>TDS %</label><input id="ahTds" type="number" min="0" max="100" step="0.01" value="'+num(A.new_tds_pct!=null?A.new_tds_pct:W.tds_pct)+'"></div><div><label>GST %</label><input id="ahGst" type="number" min="0" max="100" step="0.01" value="'+num(A.new_gst_pct!=null?A.new_gst_pct:W.gst_pct)+'"></div></div>'+
      '<label>Terms &amp; conditions</label><textarea id="ahTerms">'+esc(A.new_terms!=null?A.new_terms:(W.terms||''))+'</textarea>'+
      '<div class="eng-note" style="margin-top:12px">Only values that differ from the current work order are recorded as changes.</div>',
      cancelBtn+'<button class="btn btn-primary" onclick="ENG.f.amHeaderSave(this)"><i class="fa-solid fa-check"></i> Save</button>');
  };
  ENG.f.amHeaderSave=function(btn){
    return run(btn,async()=>{
      const A=L().amCur,W=L().amWo;
      const title=val('ahTitle').trim();if(!title)return toast('Give the reason for the amendment','warn');
      const p=k=>{const x=numOrNull(val(k));return x==null||isNaN(x)?NaN:x;};
      const ret=p('ahRet'),tds=p('ahTds'),gst=p('ahGst');
      for(const x of [ret,tds,gst])if(isNaN(x)||x<0||x>100)return toast('Retention, TDS and GST must be between 0 and 100','warn');
      const end=val('ahEnd')||null,terms=val('ahTerms').trim();
      const diffNum=(n,c)=>n===num(c)?null:n;
      const row={title:title,effective_date:val('ahDate')||A.effective_date,
        new_end_date:end&&end!==(W.end_date||'')?end:null,
        new_terms:terms&&terms!==(W.terms||'').trim()?terms:null,
        new_retention_pct:diffNum(ret,W.retention_pct),new_tds_pct:diffNum(tds,W.tds_pct),new_gst_pct:diffNum(gst,W.gst_pct)};
      const {error}=await E().from('wo_amendments').update(row).eq('id',A.id);if(error)throw error;
      closeModal();toast('Details saved','ok');renderPage();
    });
  };

  /* ---------------------------------------------------------------- revise existing items */
  const RV={items:[],sel:new Map(),q:''};
  ENG.f.amRevise=async function(){
    const A=L().amCur;
    modal('Revise items — '+esc(A.amend_ref),LOAD,'','xl');
    try{
      RV.items=await fetchAll(()=>E().from('v_wo_items').select('*').eq('wo_id',A.wo_id).order('tower_sort').order('floor_no',{nullsFirst:true}).order('flat_code',{nullsFirst:true}).order('activity_name').order('id'));
    }catch(e){return fail(e);}
    RV.sel=new Map();RV.q='';
    (L().amLines||[]).filter(l=>l.action==='change').forEach(l=>RV.sel.set(l.wo_item_id,{qty:num(l.new_qty),rate:num(l.new_rate),line:l.id}));
    $('modalHost').querySelector('.modal-body').innerHTML=
      '<div class="eng-note" style="margin-bottom:12px">Tick an item and enter its new <b>total</b> quantity and rate. Set the quantity to what has been done to close the item early, or to 0 to short-close an item with no work on it. If the rate changes on an item that already has work, that work stays at the old rate and only the balance moves to the new one.</div>'+
      '<div class="toolbar" style="margin-bottom:8px"><div class="grow"><i class="fa-solid fa-magnifying-glass"></i><input placeholder="Search activity or location…" oninput="ENG.f.rvSearch(this.value)"></div><span id="rvSum" style="font-size:12.5px;color:var(--slate)"></span></div>'+
      '<div class="eng-tbl" style="border:1px solid var(--line);border-radius:9px;max-height:50vh;overflow:auto" id="rvList"></div>';
    $('modalHost').querySelector('.modal').insertAdjacentHTML('beforeend','<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="ENG.f.rvSave(this)"><i class="fa-solid fa-check"></i> Save changes</button></div>');
    ENG.f.rvRender();
  };
  ENG.f.rvSearch=(function(){let tm=null;return function(s){RV.q=s;clearTimeout(tm);tm=setTimeout(ENG.f.rvRender,200);};})();
  ENG.f.rvRender=function(){
    const host=$('rvList');if(!host)return;
    const qq=lc(RV.q).trim();
    const all=RV.items.filter(r=>!qq||lc(r.activity_name+' '+r.location_label).indexOf(qq)>=0);
    const rows=all.slice(0,300);
    host.innerHTML=rows.length?
      '<table class="tbl"><thead><tr><th style="width:34px"></th><th>Activity / location</th><th class="r">Qty</th><th class="r">Done</th><th class="r">Rate</th><th class="r" style="width:110px">New qty</th><th class="r" style="width:120px">New rate</th><th>Effect</th></tr></thead><tbody>'+
      rows.map(r=>{
        const s=RV.sel.get(r.id),done=num(r.verified_qty)+num(r.pending_qty);
        let eff='';
        if(s){const c=chg({cur_qty:r.qty,cur_rate:r.rate,cur_executed:done,new_qty:s.qty,new_rate:s.rate},false);eff=c.bad?'<span style="color:var(--err)">Below the '+q(done)+' already entered</span>':esc(c.txt)+(c.after!==c.before?' · <b>'+sgn(c.after-c.before)+'</b>':'');}
        return '<tr class="'+(s?'sel':'')+'"><td><input type="checkbox" '+(s?'checked':'')+' onchange="ENG.f.rvTick('+r.id+',this.checked)"></td><td><b>'+esc(r.activity_name)+'</b>'+(num(r.amend_no)>0?' <span class="tag t-purple">'+amTag(r.amend_no)+'</span>':'')+'<div class="sub" style="font-size:12px;color:var(--slate)">'+esc(r.location_label)+'</div></td>'+
          '<td class="r">'+q(r.qty)+' '+esc(r.uom)+'</td><td class="r">'+q(done)+'</td><td class="r">'+inr(r.rate)+'</td>'+
          '<td><input type="number" min="0" step="0.001" style="width:100%;text-align:right" value="'+(s?s.qty:num(r.qty))+'" onchange="ENG.f.rvEdit('+r.id+',\'qty\',this.value)"></td>'+
          '<td><input type="number" min="0" step="0.01" style="width:100%;text-align:right" value="'+(s?s.rate:num(r.rate))+'" onchange="ENG.f.rvEdit('+r.id+',\'rate\',this.value)"></td>'+
          '<td style="font-size:12.5px;max-width:300px">'+eff+'</td></tr>';
      }).join('')+'</tbody></table>'+(all.length>300?'<div class="eng-pager"><span>Showing the first 300 of '+all.length+' — search to narrow</span></div>':''):
      '<div class="empty" style="padding:30px">No items match</div>';
    const s=$('rvSum');if(s)s.innerHTML='<b>'+RV.sel.size+'</b> selected';
  };
  ENG.f.rvTick=function(id,on){
    if(!on)RV.sel.delete(id);else{const r=RV.items.find(x=>x.id===id);if(r)RV.sel.set(id,{qty:num(r.qty),rate:num(r.rate)});}
    ENG.f.rvRender();
  };
  ENG.f.rvEdit=function(id,k,v){
    const r=RV.items.find(x=>x.id===id);
    const cur=RV.sel.get(id)||{qty:num(r.qty),rate:num(r.rate)};
    cur[k]=num(v);RV.sel.set(id,cur);ENG.f.rvRender();
  };
  ENG.f.rvSave=function(btn){
    return run(btn,async()=>{
      const A=L().amCur,existing={};
      (L().amLines||[]).filter(l=>l.action==='change').forEach(l=>existing[l.wo_item_id]=l);
      const byId={};RV.items.forEach(r=>byId[r.id]=r);
      const toDelete=[],toUpdate=[],toInsert=[];let unchanged=0;
      for(const id of Object.keys(existing).map(Number))if(!RV.sel.has(id))toDelete.push(existing[id].id);
      for(const [id,s] of RV.sel){
        const r=byId[id];if(!r)continue;
        const done=num(r.verified_qty)+num(r.pending_qty);
        if(isNaN(s.qty)||s.qty<0)return toast('Quantities cannot be negative','warn');
        if(isNaN(s.rate)||s.rate<0)return toast('Enter a valid rate','warn');
        if(s.qty<done-1e-9)return toast('“'+r.activity_name+'” has '+q(done)+' already entered — the new quantity can’t be lower','warn');
        const same=s.qty===num(r.qty)&&s.rate===num(r.rate);
        if(same){if(existing[id])toDelete.push(existing[id].id);else unchanged++;continue;}
        if(existing[id])toUpdate.push({id:existing[id].id,new_qty:s.qty,new_rate:s.rate});
        else toInsert.push({amendment_id:A.id,action:'change',wo_item_id:id,new_qty:s.qty,new_rate:s.rate});
      }
      if(!toDelete.length&&!toUpdate.length&&!toInsert.length)return toast(unchanged?'Nothing to save — the ticked items have no change':'Nothing to save','warn');
      if(toDelete.length){const {error}=await E().from('wo_amendment_items').delete().in('id',toDelete);if(error)throw error;}
      for(const u of toUpdate){const {error}=await E().from('wo_amendment_items').update({new_qty:u.new_qty,new_rate:u.new_rate}).eq('id',u.id);if(error)throw error;}
      if(toInsert.length){const {error}=await E().from('wo_amendment_items').insert(toInsert);if(error)throw error;}
      closeModal();toast('Changes saved to the amendment'+(unchanged?' ('+unchanged+' ticked item'+(unchanged===1?'':'s')+' had no change)':''),'ok');renderPage();
    });
  };

  /* ---------------------------------------------------------------- add new items (BOQ picker shared with work orders) */
  ENG.f.amAddItems=function(){
    const A=L().amCur,W=L().amWo;
    return ENG.boqPicker({title:'Add new items — '+A.amend_ref,project_id:W.project_id,project_name:W.project_name,okLabel:'Add to amendment',
      intro:'Set the quantity and the contractor’s rate. These lines join the work order when the amendment is issued.',
      save:async(rows,btn)=>{
        const {error}=await E().from('wo_amendment_items').insert(rows.map(r=>({amendment_id:A.id,action:'add',boq_item_id:r.boq_item_id,new_qty:r.qty,new_rate:r.rate})));
        if(error)throw error;
        closeModal();toast(rows.length+' item'+(rows.length===1?'':'s')+' added to the amendment','ok');renderPage();
      }});
  };

  /* ---------------------------------------------------------------- single line edit / remove */
  ENG.f.amLineEdit=function(id){
    const l=(L().amLines||[]).find(x=>x.id===id);if(!l)return;
    const add=l.action==='add';
    modal(add?'Edit new item':'Edit item change',
      '<div style="font-weight:600">'+esc(l.activity_name)+'</div><div style="color:var(--slate);font-size:13px;margin-top:2px">'+esc(l.location_label)+'</div>'+
      (add?'':'<div class="eng-note" style="margin-top:10px">Currently '+q(l.cur_qty)+' '+esc(l.uom)+' @ '+inr(l.cur_rate)+' · '+q(l.cur_executed)+' already entered. The quantity is the new <b>total</b> for the item.</div>')+
      '<div class="two"><div><label>'+(add?'Quantity':'New total quantity')+' ('+esc(l.uom)+')</label><input id="alQty" type="number" min="0" step="0.001" value="'+num(l.new_qty)+'"></div><div><label>'+(add?'Rate':'New rate')+' (₹)</label><input id="alRate" type="number" min="0" step="0.01" value="'+num(l.new_rate)+'"></div></div>',
      cancelBtn+'<button class="btn btn-primary" onclick="ENG.f.amLineSave(this,'+id+')"><i class="fa-solid fa-check"></i> Save</button>');
  };
  ENG.f.amLineSave=function(btn,id){
    return run(btn,async()=>{
      const qty=numOrNull(val('alQty')),rate=numOrNull(val('alRate'));
      if(qty==null||isNaN(qty)||qty<0)return toast('Enter a quantity','warn');
      if(rate==null||isNaN(rate)||rate<0)return toast('Enter the rate','warn');
      const {error}=await E().from('wo_amendment_items').update({new_qty:qty,new_rate:rate}).eq('id',id);if(error)throw error;
      closeModal();toast('Line updated','ok');renderPage();
    });
  };
  ENG.f.amLineDel=async function(id){
    if(!await confirmDialog('Remove this line from the amendment?',{okLabel:'Remove'}))return;
    try{const {error}=await E().from('wo_amendment_items').delete().eq('id',id);if(error)throw error;toast('Line removed','ok');renderPage();}catch(e){fail(e);}
  };

  /* ---------------------------------------------------------------- issue / cancel */
  ENG.f.amIssue=async function(){
    const A=L().amCur,W=L().amWo,lines=L().amLines||[];
    const delta=lines.filter(l=>l.action==='change').reduce((s,l)=>{const c=chg(l,false);return s+(c.after-c.before);},0)+lines.filter(l=>l.action==='add').reduce((s,l)=>s+r2(num(l.new_qty)*num(l.new_rate)),0);
    const msg='Issue '+A.amend_ref+'? '+W.wo_no+' will change from '+inr(W.value)+' to '+inr(num(W.value)+r2(delta))+' ('+sgn(r2(delta))+'). This is applied immediately and the amendment stays on record permanently.';
    if(!await confirmDialog(msg,{okLabel:'Issue amendment',danger:false,icon:'fa-stamp',title:'Issue amendment'}))return;
    try{const {error}=await E().rpc('wo_amend_issue',{p_id:A.id});if(error)throw error;toast('Amendment issued — the work order has been updated','ok');renderPage();}catch(e){fail(e);}
  };
  ENG.f.amCancel=function(){
    const A=L().amCur;
    modal('Cancel '+esc(A.amend_ref),'<div class="eng-note">The work order stays exactly as it is. A cancelled amendment is kept for the record.</div><label>Reason</label><textarea id="acWhy" placeholder="Why is this amendment being cancelled?"></textarea>',
      cancelBtn.replace('Cancel','Back')+'<button class="btn btn-danger-solid" onclick="ENG.f.amCancelSave(this)">Cancel amendment</button>');
  };
  ENG.f.amCancelSave=function(btn){
    return run(btn,async()=>{
      const why=val('acWhy').trim();if(!why)return toast('Give a reason','warn');
      const {error}=await E().from('wo_amendments').update({status:'Cancelled',cancel_reason:why}).eq('id',L().amCur.id);if(error)throw error;
      closeModal();toast('Amendment cancelled','ok');renderPage();
    });
  };
})();
