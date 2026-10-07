/* ===========================================================================
   JAIN-E · ENGINEERING — core, Overview, Budget, Masters   [loads after nexus-core.js]
   Flow:  Activities -> Budget -> BOQ -> Work Order (tags BOQ) -> Work Done (verified) -> RA Bill
   Data:  schema `eng` (db/engineering-schema.sql). Projects/blocks/floors/flats are read from
          cust.projects + postsales.*; contractors/materials/UoM from purchase.vendors/items/uoms.
   Rules (quantity caps, maker-checker, locking) are enforced by triggers in the database; this
   file only presents them and shows the database's message when it refuses something.
   Companion files: engineering-boq.js, engineering-wo.js, engineering-ra.js (all register on window.ENG).
   =========================================================================== */
(function(){
  if(typeof sb==='undefined'||typeof VIEWS==='undefined')return;
  const ENG=window.ENG={routes:{},f:{},rt:0,L:{}};
  const E=()=>sb.schema('eng'), PS=()=>sb.schema('postsales'), PU=()=>sb.schema('purchase');

  /* ---------- formatting ---------- */
  const lc=s=>String(s||'').toLowerCase();
  const num=n=>Number(n||0);
  const inr=n=>'₹'+num(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const cr=n=>{n=num(n);const a=Math.abs(n);return a>=1e7?'₹'+(n/1e7).toFixed(2)+' Cr':a>=1e5?'₹'+(n/1e5).toFixed(2)+' L':inr(n);};
  const q=n=>num(n).toLocaleString('en-IN',{maximumFractionDigits:3});
  const dt=d=>{if(!d)return '—';const x=/^\d{4}-\d{2}-\d{2}$/.test(d)?new Date(d+'T00:00:00'):new Date(d);return isNaN(x)?'—':x.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});};
  const istToday=()=>new Date(Date.now()+19800000).toISOString().slice(0,10);   // Asia/Kolkata, same clock the database checks against
  const pct=(a,b)=>b>0?Math.round(a/b*1000)/10:0;
  const val=id=>{const x=document.getElementById(id);return x?x.value:'';};
  const numOrNull=s=>{s=String(s==null?'':s).trim();if(s==='')return null;const n=Number(s);return isNaN(n)?NaN:n;};
  const TAGC={Draft:'t-amber',Issued:'t-blue',Closed:'t-green',Cancelled:'t-gray',Entered:'t-amber',Verified:'t-green',Rejected:'t-red',Booked:'t-green',Active:'t-green',Inactive:'t-gray'};
  const stTag=s=>'<span class="tag '+(TAGC[s]||'t-gray')+'">'+esc(s==='Entered'?'Awaiting verification':s)+'</span>';
  const LVC={Project:'t-purple',Block:'t-blue',Floor:'t-blue',Flat:'t-green',Portion:'t-amber','Activity Group':'t-blue',Material:'t-amber'};
  const lvTag=s=>'<span class="tag '+(LVC[s]||'t-gray')+'">'+esc(s)+'</span>';
  const LOAD='<div class="loader"><div class="spin"></div></div>';

  function errMsg(e){
    let m=(e&&e.message)||String(e||'Something went wrong');
    if(/budgets_scope_uq/.test(m))return 'A budget already exists for this scope — edit that one instead.';
    if(/budgets_inflow_scope/.test(m))return 'Inflow budgets can only be set against a project or a block.';
    if(/wo_amendments_one_draft/.test(m))return 'This work order already has a draft amendment — open it, or issue or cancel it first.';
    if(/wo_amend_item_(change|add)_uq/.test(m))return 'That item is already on this amendment.';
    if(/boq_items_loc_uq/.test(m))return 'That activity is already in the BOQ for this location.';
    if(/activities_name_uq/.test(m))return 'This group already has an activity with that name.';
    if(/activity_groups_name_uq/.test(m))return 'An activity group with that name already exists.';
    if(/violates foreign key constraint/.test(m))return 'This is in use elsewhere, so it can’t be removed. Mark it inactive instead.';
    if(/row-level security/.test(m))return 'You don’t have access to Engineering. Ask an admin to enable the module for you.';
    return m;
  }
  const fail=e=>toast(errMsg(e),'err');
  const errCard=e=>'<div class="card card-pad empty"><i class="fa-solid fa-triangle-exclamation"></i><div style="font-weight:600;color:var(--ink)">Couldn’t load this page</div><p style="max-width:520px;margin:6px auto 0">'+esc(errMsg(e))+'</p></div>';
  async function run(btn,fn){ if(btn)btn.disabled=true; try{ return await fn(); }catch(e){ fail(e); }finally{ if(btn)btn.disabled=false; } }

  /* every list can exceed the API's 1000-row page, so read in pages (build() must return a fresh, ordered query) */
  async function fetchAll(build){
    const out=[];const step=1000;
    for(let from=0;;from+=step){
      const {data,error}=await build().range(from,from+step-1);
      if(error)throw error;
      out.push.apply(out,data||[]);
      if(!data||data.length<step)break;
    }
    return out;
  }
  const chunk=(a,n)=>{const r=[];for(let i=0;i<a.length;i+=n)r.push(a.slice(i,i+n));return r;};

  /* ---------- shared UI ---------- */
  const st=document.createElement('style');
  st.textContent=
   '.eng-actions{display:flex;gap:10px;flex-wrap:wrap}.eng-tabs{overflow-x:auto;overflow-y:hidden}'+
   '.eng-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(178px,1fr));gap:16px;margin-bottom:16px}'+
   '.eng-kpis .kpi .val{font-size:22px}'+
   '.eng-bar{height:6px;background:#eef1f6;border-radius:4px;overflow:hidden;min-width:70px}.eng-bar i{display:block;height:100%;background:var(--brand);border-radius:4px}.eng-bar.over i{background:var(--err)}.eng-bar.ok i{background:var(--ok)}'+
   '.eng-att{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin-bottom:16px}'+
   '.eng-att a{display:flex;align-items:center;gap:12px;padding:14px 16px;background:#fff;border:1px solid var(--line);border-radius:var(--radius);cursor:pointer;text-decoration:none;color:inherit}'+
   '.eng-att a:hover{background:#f8fafc}.eng-att .n{font-size:20px;font-weight:700;line-height:1.1}.eng-att .l{font-size:12px;color:var(--slate)}'+
   '.eng-att .ic{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:none}'+
   '.eng-tbl{overflow-x:auto}.eng-tbl table th.r,.eng-tbl table td.r{text-align:right;font-variant-numeric:tabular-nums}'+
   '.eng-tbl td.sub{color:var(--slate);font-size:12.5px}.eng-tbl tr.sel td{background:#f5f8ff}'+
   '.eng-filter{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}.eng-filter .sel{min-width:150px}'+
   '.eng-chips{display:flex;gap:6px;flex-wrap:wrap}.eng-pager{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-top:1px solid var(--line);font-size:12.5px;color:var(--slate)}'+
   '.eng-note{background:#f8fafc;border:1px dashed var(--line);border-radius:9px;padding:10px 13px;font-size:12.5px;color:var(--slate)}'+
   '.eng-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px 12px;max-height:190px;overflow:auto;padding:8px 10px;border:1px solid var(--line);border-radius:8px}'+
   '.eng-grid label{display:flex;align-items:center;gap:7px;margin:0!important;font-weight:500!important;font-size:13px!important;cursor:pointer}.eng-grid input{width:auto!important}'+
   '.eng-sum{display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--slate)}.eng-sum b{color:var(--ink)}'+
   '.eng-sheet{padding:22px}.eng-tot{margin-left:auto;width:340px;max-width:100%}.eng-tot div{display:flex;justify-content:space-between;padding:6px 0;font-size:13.5px}.eng-tot .net{border-top:2px solid var(--ink);margin-top:6px;padding-top:10px;font-weight:700;font-size:16px}'+
   '@media print{.sidebar,.topbar,.eng-tabs,.page-head .eng-actions,.eng-noprint,#toasts,.sb-backdrop{display:none!important}.main{margin:0!important}.view{padding:0!important}.card{box-shadow:none!important;border:0!important}}';
  document.head.appendChild(st);

  const TABS=[['','Overview'],['budget','Budget'],['boq','BOQ'],['wo','Work Orders'],['amend','Amendments'],['wd','Work Done'],['ra','RA Bills'],['ret','Retention'],['masters','Masters']];
  const TABNAME={};TABS.forEach(t=>TABNAME[t[0]]=t[1]);
  function head(tab,sub,actions){
    return '<div class="page-head"><div><h1><i class="fa-solid fa-compass-drafting" style="color:#0e7490"></i> Engineering</h1><p>'+sub+'</p></div><div class="eng-actions">'+(actions||'')+'</div></div>'+
      '<div class="tabs eng-tabs">'+TABS.map(t=>'<div class="tab'+(t[0]===tab?' active':'')+'" onclick="navTo(\'engineering'+(t[0]?'/'+t[0]:'')+'\')">'+t[1]+'</div>').join('')+'</div>';
  }
  function modal(title,body,foot,size){
    openModal('<div class="modal-head"><h3>'+title+'</h3><div class="x" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></div></div><div class="modal-body frm">'+body+'</div>'+(foot?'<div class="modal-foot">'+foot+'</div>':''),size||'');
  }
  const cancelBtn='<button class="btn" onclick="closeModal()">Cancel</button>';
  const opts=(rows,valFn,lblFn,sel,blank)=>(blank!=null?'<option value="">'+esc(blank)+'</option>':'')+rows.map(r=>'<option value="'+esc(valFn(r))+'"'+(String(valFn(r))===String(sel)?' selected':'')+'>'+esc(lblFn(r))+'</option>').join('');
  function pager(total,page,size,fn){
    if(total<=size)return '<div class="eng-pager"><span>'+total+' row'+(total===1?'':'s')+'</span></div>';
    const pages=Math.ceil(total/size);
    return '<div class="eng-pager"><span>'+(page*size+1)+'–'+Math.min(total,(page+1)*size)+' of '+total+'</span><span><button class="btn btn-sm" '+(page<=0?'disabled':'')+' onclick="'+fn+'('+(page-1)+')"><i class="fa-solid fa-chevron-left"></i></button> Page '+(page+1)+' / '+pages+' <button class="btn btn-sm" '+(page>=pages-1?'disabled':'')+' onclick="'+fn+'('+(page+1)+')"><i class="fa-solid fa-chevron-right"></i></button></span></div>';
  }
  const bar=(used,total)=>{const p=pct(used,total);const cls=total>0&&used>total?'over':(total>0&&p>=100?'ok':'');return '<div class="eng-bar '+cls+'" title="'+p+'%"><i style="width:'+Math.min(100,p)+'%"></i></div>';};

  /* ---------- project selection (remembered for the session) ---------- */
  const S=ENG.S={project:''};
  try{S.project=sessionStorage.getItem('eng.project')||'';}catch(e){}
  ENG.f.setProject=function(v){S.project=v||'';try{sessionStorage.setItem('eng.project',S.project);}catch(e){}ENG.L={};renderPage();};
  const curProject=()=>S.project?Number(S.project):null;
  function projBar(allowAll,extra){
    const C=ENG.C;
    return '<div class="eng-filter"><select class="sel" onchange="ENG.f.setProject(this.value)" style="min-width:230px">'+
      (allowAll?'<option value="">All business units</option>':'<option value="">Select a business unit…</option>')+
      C.projects.map(p=>'<option value="'+p.id+'"'+(String(p.id)===String(S.project)?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select>'+(extra||'')+'</div>';
  }
  const projName=id=>{const p=ENG.C.projects.find(x=>x.id===Number(id));return p?p.name:'—';};

  /* ---------- reference data ---------- */
  const C=ENG.C={geo:{},projects:[],groups:[],acts:[],uoms:[],vendors:[],items:[],heads:[],ledgers:[]};
  async function loadMasters(force){
    if(C.ready&&!force)return;
    const [pr,gr,ac,um,ve,it,bh,lg]=await Promise.all([
      E().rpc('projects'),
      E().from('activity_groups').select('*').order('sort_order').order('name'),
      E().from('activities').select('*').order('name'),
      PU().from('uoms').select('code,name').is('deleted_at',null).order('code'),
      PU().from('vendors').select('id,code,legal_name,trade_name,vendor_type,status').is('deleted_at',null).order('legal_name'),
      PU().from('items').select('id,code,name,active').is('deleted_at',null).order('name'),
      E().from('budget_heads').select('*').order('sort_order').order('name'),
      /* The Accounts ledgers a budget head can point at. Read straight from Accounts: a head is
         only as good as the ledger behind it, and offering a free-text name would let somebody
         create a head whose actual can never be found. Accounts may be unreadable to this person
         (it is name-limited) — then the picker simply has nothing to offer and says so. */
      sb.schema('accounts').from('ledgers').select('id,name,code,active').order('name')
    ]);
    if(pr.error)throw pr.error;if(gr.error)throw gr.error;if(ac.error)throw ac.error;
    C.projects=(pr.data||[]).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name)));
    C.groups=gr.data||[];C.acts=ac.data||[];
    C.uoms=um.error?[]:(um.data||[]);C.vendors=ve.error?[]:(ve.data||[]);C.items=it.error?[]:(it.data||[]);
    C.heads=bh.error?[]:(bh.data||[]);C.ledgers=lg.error?[]:(lg.data||[]);
    C.ready=true;
  }
  /* Exposed so the other engineering files can refresh the masters after writing one — BOQ adds an
     activity inline and needs the new row in C.acts before it can select it. Defined here rather
     than inside loadMasters, so it exists whether or not a load has run yet. */
  ENG.reloadMasters=()=>loadMasters(true);
  const vendorName=v=>v?(v.trade_name||v.legal_name||v.code||('#'+v.id)):'—';
  async function loadTowers(pid){
    const g=C.geo[pid]=C.geo[pid]||{};
    if(g.towers)return g.towers;
    const {data,error}=await PS().from('towers').select('id,name,floor_from,floor_to,sort_order').eq('project_id',pid).is('deleted_at',null).order('sort_order').order('name');
    if(error)throw error;
    g.towers=data||[];return g.towers;
  }
  async function loadGeo(pid){
    const g=C.geo[pid]=C.geo[pid]||{};
    if(g.full)return g;
    const towers=await loadTowers(pid);const ids=towers.map(x=>x.id);
    if(!ids.length){g.floors=[];g.flats=[];g.positions=[];g.full=true;return g;}
    const [fl,fs,ps]=await Promise.all([
      fetchAll(()=>PS().from('floors').select('id,tower_id,floor_no,label').in('tower_id',ids).order('id')),
      fetchAll(()=>PS().from('flats').select('id,tower_id,floor_id,position_id,flat_code').in('tower_id',ids).is('deleted_at',null).order('id')),
      PS().from('tower_positions').select('id,tower_id,code,sort_order').in('tower_id',ids)
    ]);
    g.floors=fl;g.flats=fs;g.positions=ps.data||[];g.full=true;return g;
  }
  const actById=id=>C.acts.find(a=>a.id===Number(id));
  const groupById=id=>C.groups.find(g=>g.id===Number(id));

  Object.assign(ENG,{E,PS,PU,lc,num,inr,cr,q,dt,istToday,pct,val,numOrNull,stTag,lvTag,LOAD,errMsg,fail,errCard,run,fetchAll,chunk,head,modal,cancelBtn,opts,pager,bar,projBar,projName,curProject,loadMasters,loadTowers,loadGeo,vendorName,actById,groupById});

  /* ---------- router ---------- */
  VIEWS.engineering=async function(v,seg){
    const tab=(seg&&seg[0])||'';
    const t=++ENG.rt;
    setCrumb(['Operations','Engineering'].concat(tab&&TABNAME[tab]?[TABNAME[tab]]:[]));
    v.innerHTML=head(tab,'')+LOAD;
    try{ await loadMasters(); }catch(e){ v.innerHTML=head(tab,'')+errCard(e); return; }
    if(t!==ENG.rt)return;
    const fn=ENG.routes[tab];
    if(!fn){ v.innerHTML=head('','')+errCard('Unknown page'); return; }
    try{ await fn(v,(seg||[]).slice(1),t); }catch(e){ if(t===ENG.rt)v.innerHTML=head(tab,'')+errCard(e); }
  };
  ENG.stale=t=>t!==ENG.rt;

  /* ======================================================================= OVERVIEW */
  const dirTag=d=>'<span class="tag '+(d==='Inflow'?'t-green':'t-amber')+'"><i class="fa-solid fa-arrow-'+(d==='Inflow'?'down':'up')+'"></i> '+esc(d)+'</span>';
  ENG.dirTag=dirTag;
  /* ---- actual payments, from Accounts. accounts.eng_budget_actuals() returns, per project / block / activity group, how much
     of the work billed on RA bills Accounts has posted has been paid (GST, TDS and retention left out, so it compares directly
     with the budget and with "billed"), and how much retention is still held. If Accounts is not available the column shows "—". ---- */
  async function accActuals(pid){
    try{const {data,error}=await sb.schema('accounts').rpc('eng_budget_actuals',{p_project:pid||null});if(error)return null;return data||[];}catch(e){return null;}
  }
  function actFor(b){
    const rows=ENG.L.act;if(!rows)return null;
    let paid=0,gross=0,ret=0;
    rows.forEach(r=>{if(r.project_id===b.project_id&&(!b.tower_id||r.tower_id===b.tower_id)&&(!b.group_id||r.group_id===b.group_id)){paid+=num(r.paid_value);gross+=num(r.gross);ret+=num(r.retention_held);}});
    return {paid:paid,gross:gross,ret:ret};
  }
  const actProject=pid=>{const rows=ENG.L.act;if(!rows)return null;return rows.filter(r=>r.project_id===pid).reduce((s,r)=>s+num(r.paid_value),0);};
  const paidCell=b=>{
    const a=actFor(b);if(!a)return '<td class="r sub">—</td>';
    const bl=num(b.billed);
    return '<td class="r">'+inr(a.paid)+'<div class="sub" style="font-size:11px;color:var(--slate)">'+(bl>0?pct(a.paid,bl)+'% of billed':'nothing billed')+(a.ret>0?' · '+inr(a.ret)+' retention held':'')+'</div></td>';
  };
  ENG.routes['']=async function(v,a,t){
    v.innerHTML=head('','Budget → BOQ → work order → work done → RA bill, in one place')+projBar(true)+'<div id="engBody">'+LOAD+'</div>';
    const pid=curProject();
    let s=E().from('v_project_summary').select('*').order('project_name');
    let b=E().from('v_budget_status').select('*').order('project_name');
    let c=E().from('v_contractor_summary').select('*').order('project_name').order('parent_name').order('sub_name',{nullsFirst:true});
    if(pid){s=s.eq('project_id',pid);b=b.eq('project_id',pid);c=c.eq('project_id',pid);}
    const [sm,bd,cs]=await Promise.all([s,b,c]);
    if(sm.error)throw sm.error;if(bd.error)throw bd.error;if(cs.error)throw cs.error;
    if(t!==ENG.rt)return;
    ENG.L.act=await accActuals(pid);
    if(t!==ENG.rt)return;
    const rows=sm.data||[];const sum=k=>rows.reduce((x,r)=>x+num(r[k]),0);
    const paidAll=ENG.L.act?ENG.L.act.reduce((s,r)=>s+num(r.paid_value),0):null;
    const kp=[['Outflow budget',sum('outflow_budget')?cr(sum('outflow_budget')):'—','fa-wallet','#b45309','#fffbeb'],['Committed (work orders)',cr(sum('committed')),'fa-file-contract','#1d4ed8','#eff4ff'],['Work verified',cr(sum('verified')),'fa-circle-check','#0f766e','#f0fdfa'],['Billed (RA bills)',cr(sum('billed')),'fa-file-invoice-dollar','#7c3aed','#f5f3ff'],['Paid (via Accounts)',paidAll==null?'—':cr(paidAll),'fa-money-check-dollar','#0e7490','#ecfeff'],
      ['Inflow budget',sum('inflow_budget')?cr(sum('inflow_budget')):'—','fa-piggy-bank','#15803d','#f0fdf4'],['Received (collections)',cr(sum('received')),'fa-hand-holding-dollar','#15803d','#f0fdf4']];
    const att=[
      ['wd','Awaiting verification',sum('awaiting_verification'),'fa-hourglass-half','#b45309','#fffbeb'],
      ['ra','Verified, not yet billed',cr(sum('unbilled_value')),'fa-file-invoice','#1d4ed8','#eff4ff'],
      ['wo','Draft work orders',sum('wo_draft'),'fa-file-pen','#475569','#f1f5f9'],
      ['amend','Draft amendments',sum('amend_draft'),'fa-pen-ruler','#7c3aed','#f5f3ff'],
      ['ra','Draft RA bills',sum('ra_draft'),'fa-file-circle-exclamation','#be123c','#fff1f2']];
    const sorted=r=>r.slice().sort((x,y)=>String(x.project_name).localeCompare(String(y.project_name))||LVL_ORD[x.level]-LVL_ORD[y.level]||String(scopeLabel(x)).localeCompare(String(scopeLabel(y))));
    const outRows=sorted((bd.data||[]).filter(x=>x.direction!=='Inflow')),inRows=sorted((bd.data||[]).filter(x=>x.direction==='Inflow'));
    $('engBody').innerHTML=
      '<div class="eng-kpis">'+kp.map(k=>'<div class="kpi"><div class="top"><div class="ic" style="background:'+k[4]+';color:'+k[3]+'"><i class="fa-solid '+k[2]+'"></i></div></div><div class="val">'+k[1]+'</div><div class="lbl">'+k[0]+'</div></div>').join('')+'</div>'+
      '<div class="eng-att">'+att.map(x=>'<a onclick="navTo(\'engineering/'+x[0]+'\')"><span class="ic" style="background:'+x[5]+';color:'+x[4]+'"><i class="fa-solid '+x[3]+'"></i></span><span><div class="n">'+x[2]+'</div><div class="l">'+x[1]+'</div></span></a>').join('')+'</div>'+
      (pid?'':
        '<div class="card eng-tbl" style="margin-bottom:16px"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="sec-title" style="margin:0">Business units</div><div class="sec-sub" style="margin:2px 0 0">Click a project to focus on it</div></div>'+
        '<table class="tbl"><thead><tr><th>Business unit</th><th class="r">BOQ value</th><th class="r">Outflow budget</th><th class="r">Committed</th><th class="r">Billed</th><th class="r">Paid</th><th class="r">Inflow budget</th><th class="r">Received</th><th class="r">Open WOs</th></tr></thead><tbody>'+
        (rows.length?rows.map(r=>'<tr class="clk" onclick="ENG.f.setProject(\''+r.project_id+'\')"><td><b>'+esc(r.project_name)+'</b></td><td class="r">'+inr(r.boq_value)+'</td><td class="r">'+(num(r.outflow_budget)?inr(r.outflow_budget):'—')+'</td><td class="r">'+inr(r.committed)+'</td><td class="r">'+inr(r.billed)+'</td><td class="r">'+(actProject(r.project_id)==null?'—':inr(actProject(r.project_id)))+'</td><td class="r">'+(num(r.inflow_budget)?inr(r.inflow_budget):'—')+'</td><td class="r">'+inr(r.received)+'</td><td class="r">'+(num(r.wo_draft)+num(r.wo_issued))+'</td></tr>').join(''):'<tr><td colspan="9"><div class="empty" style="padding:24px">No business units available</div></td></tr>')+
        '</tbody></table></div>')+
      '<div class="card eng-tbl" style="margin-bottom:16px"><div class="card-pad" style="border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div><div class="sec-title" style="margin:0">'+dirTag('Outflow')+' Budget vs actual</div><div class="sec-sub" style="margin:4px 0 0">Committed = value of work orders issued against the budgeted scope · Paid = the part of the billed work already paid through Accounts (GST, TDS and retention left out)</div></div><button class="btn btn-sm" onclick="navTo(\'engineering/budget\')">Manage budgets</button></div>'+
        outflowTable(outRows,false)+'</div>'+
      '<div class="card eng-tbl" style="margin-bottom:16px"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="sec-title" style="margin:0">'+dirTag('Inflow')+' Collections vs budget</div><div class="sec-sub" style="margin:4px 0 0">Received = active receipts recorded in Post Sales, less refunds</div></div>'+
        inflowTable(inRows,false)+'</div>'+
      '<div class="card eng-tbl"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="sec-title" style="margin:0">By contractor</div><div class="sec-sub" style="margin:2px 0 0">Parent contractors with their sub-contractors — issued and closed work orders</div></div>'+
        contractorTable(cs.data||[],!pid)+'</div>';
  };
  const LVL_ORD={Project:0,Block:1,'Activity Group':2,Material:3};
  function scopeLabel(b){
    if(b.level==='Project')return b.project_name;
    if(b.level==='Block')return b.tower_name;
    if(b.level==='Activity Group')return (b.tower_name?b.tower_name+' · ':'')+b.group_name;
    return (b.tower_name?b.tower_name+' · ':'')+(b.item_name||'')+(b.item_code?' ('+b.item_code+')':'');
  }
  function contractorTable(rows,showProject){
    if(!rows.length)return '<div class="empty" style="padding:30px"><i class="fa-solid fa-helmet-safety"></i><div style="font-weight:600;color:var(--ink)">No issued work orders yet</div></div>';
    let prev='';
    return '<table class="tbl"><thead><tr>'+(showProject?'<th>Business unit</th>':'')+'<th>Parent contractor</th><th>Sub-contractor</th><th class="r">Work orders</th><th class="r">Committed</th><th class="r">Verified</th><th class="r">Billed</th></tr></thead><tbody>'+
      rows.map(r=>{
        const key=r.project_id+'|'+r.parent_id,first=key!==prev;prev=key;
        return '<tr>'+(showProject?'<td>'+(first?esc(r.project_name):'')+'</td>':'')+'<td>'+(first?'<b>'+esc(r.parent_name)+'</b>':'')+'</td><td>'+(r.sub_id?'<i class="fa-solid fa-turn-up fa-rotate-90" style="color:var(--slate);margin-right:6px"></i>'+esc(r.sub_name):'<span style="color:var(--slate)">Parent itself</span>')+'</td><td class="r">'+r.wo_count+'</td><td class="r">'+inr(r.committed)+'</td><td class="r">'+inr(r.verified)+'</td><td class="r">'+inr(r.billed)+'</td></tr>';
      }).join('')+'</tbody></table>';
  }
  const rowActions=b=>'<td style="white-space:nowrap"><button class="btn btn-sm" onclick="ENG.f.budgetForm('+b.id+')"><i class="fa-solid fa-pen"></i></button> <button class="btn btn-sm btn-danger" onclick="ENG.f.budgetDel('+b.id+')"><i class="fa-solid fa-trash"></i></button></td>';
  const scopeCell=b=>'<td><b>'+esc(scopeLabel(b))+'</b>'+(b.remarks?'<div class="sub" style="font-size:12px;color:var(--slate)">'+esc(b.remarks)+'</div>':'')+'</td>';
  function outflowTable(rows,manage){
    if(!rows.length)return '<div class="empty" style="padding:34px"><i class="fa-solid fa-wallet"></i><div style="font-weight:600;color:var(--ink)">No outflow budgets set yet</div><p>Set a cost budget against a project, block, activity group or material.</p></div>';
    return '<table class="tbl"><thead><tr><th>Business unit</th><th>Level</th><th>Scope</th><th class="r">Budget</th><th class="r">BOQ value</th><th class="r">Committed</th><th class="r">Billed</th><th class="r">Paid</th><th style="min-width:120px">Committed vs budget</th>'+(manage?'<th></th>':'')+'</tr></thead><tbody>'+
      rows.map(b=>{
        const mat=b.level==='Material';
        return '<tr><td>'+esc(b.project_name)+'</td><td>'+lvTag(b.level)+'</td>'+scopeCell(b)+'<td class="r">'+inr(b.amount)+'</td>'+
        (mat?'<td class="r sub" colspan="5" style="text-align:center">Material budgets aren’t tracked against work orders</td>':
          '<td class="r">'+inr(b.boq_value)+'</td><td class="r">'+inr(b.committed)+'</td><td class="r">'+inr(b.billed)+'</td>'+paidCell(b)+'<td>'+bar(num(b.committed),num(b.amount))+'<div style="font-size:11px;color:var(--slate);margin-top:3px">'+pct(num(b.committed),num(b.amount))+'% · '+(num(b.committed)>num(b.amount)?'<span style="color:var(--err);font-weight:600">over by '+inr(num(b.committed)-num(b.amount))+'</span>':inr(num(b.amount)-num(b.committed))+' left')+'</div></td>')+
        (manage?rowActions(b):'')+'</tr>';
      }).join('')+'</tbody></table>';
  }
  function inflowTable(rows,manage){
    if(!rows.length)return '<div class="empty" style="padding:34px"><i class="fa-solid fa-piggy-bank"></i><div style="font-weight:600;color:var(--ink)">No inflow budgets set yet</div><p>Set an expected-collections budget against a project or a block.</p></div>';
    return '<table class="tbl"><thead><tr><th>Business unit</th><th>Level</th><th>Scope</th><th class="r">Budget</th><th class="r">Received</th><th style="min-width:140px">Collected vs budget</th>'+(manage?'<th></th>':'')+'</tr></thead><tbody>'+
      rows.map(b=>'<tr><td>'+esc(b.project_name)+'</td><td>'+lvTag(b.level)+'</td>'+scopeCell(b)+'<td class="r">'+inr(b.amount)+'</td><td class="r">'+inr(b.received)+'</td><td>'+bar(num(b.received),num(b.amount))+'<div style="font-size:11px;color:var(--slate);margin-top:3px">'+pct(num(b.received),num(b.amount))+'% · '+(num(b.received)>=num(b.amount)?'<span style="color:var(--ok);font-weight:600">target met</span>':inr(num(b.amount)-num(b.received))+' to collect')+'</div></td>'+(manage?rowActions(b):'')+'</tr>').join('')+'</tbody></table>';
  }

  /* ======================================================================= BUDGET */
  ENG.routes.budget=async function(v,a,t){
    v.innerHTML=head('budget','Outflow budgets control cost; inflow budgets track expected collections',
      '<button class="btn btn-primary" onclick="ENG.f.budgetForm(0,\'Outflow\')"><i class="fa-solid fa-arrow-up"></i> Outflow budget</button><button class="btn" style="border-color:#bbf7d0;color:#15803d" onclick="ENG.f.budgetForm(0,\'Inflow\')"><i class="fa-solid fa-arrow-down"></i> Inflow budget</button>')+projBar(true)+'<div id="engBody">'+LOAD+'</div>';
    const pid=curProject();
    let b=E().from('v_budget_status').select('*').order('project_name');
    if(pid)b=b.eq('project_id',pid);
    const r=await b;if(r.error)throw r.error;
    if(t!==ENG.rt)return;
    ENG.L.act=await accActuals(pid);
    if(t!==ENG.rt)return;
    ENG.L.budgets=r.data||[];
    const sorted=x=>x.slice().sort((p,q2)=>String(p.project_name).localeCompare(String(q2.project_name))||LVL_ORD[p.level]-LVL_ORD[q2.level]||String(scopeLabel(p)).localeCompare(String(scopeLabel(q2))));
    const outRows=sorted(ENG.L.budgets.filter(x=>x.direction!=='Inflow')),inRows=sorted(ENG.L.budgets.filter(x=>x.direction==='Inflow'));
    // planned net uses whole-project lines only, so block lines are not counted twice
    const projOut=outRows.filter(x=>x.level==='Project').reduce((s,x)=>s+num(x.amount),0),projIn=inRows.filter(x=>x.level==='Project').reduce((s,x)=>s+num(x.amount),0);
    $('engBody').innerHTML=
      '<div class="eng-sum" style="margin-bottom:14px"><span>Planned inflow <b>'+inr(projIn)+'</b></span><span>Planned outflow <b>'+inr(projOut)+'</b></span><span>Planned net <b style="color:'+(projIn-projOut>=0?'var(--ok)':'var(--err)')+'">'+inr(projIn-projOut)+'</b></span><span style="color:var(--slate)">whole-project lines only</span></div>'+
      '<div class="card eng-tbl" style="margin-bottom:16px"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="sec-title" style="margin:0">'+dirTag('Outflow')+' Cost budgets</div></div>'+outflowTable(outRows,true)+'</div>'+
      '<div class="card eng-tbl"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="sec-title" style="margin:0">'+dirTag('Inflow')+' Collection budgets</div><div class="sec-sub" style="margin:4px 0 0">Compared with active receipts in Post Sales, less refunds. Set against a project or a block.</div></div>'+inflowTable(inRows,true)+'</div>'+
      '<div class="eng-note" style="margin-top:12px">Budgets at different levels are independent controls — they are not required to add up to each other. Material budgets come from the Purchase item master and are shown for reference only. <b>Paid</b> is what Accounts has actually paid against posted RA bills, shown as the part of the billed work it settles (GST, TDS and retention left out); retention still held is noted under it and is released from the Retention tab.</div>';
  };
  /* 'head' first among the trade-level choices: a spend head is the one of these that finance
     recognises, and its actual comes straight from Accounts rather than from the BOQ. */
  const LEVELS_ALL=[['project','Whole business unit'],['block','A block / tower'],['head','A budget head (Accounts)'],['group','An activity group'],['block_group','Activity group within a block'],['material','A material'],['block_material','Material within a block']];
  const levelsFor=d=>d==='Inflow'?LEVELS_ALL.slice(0,2):LEVELS_ALL;
  ENG.f.budgetForm=async function(id,dirPreset){
    const cur=id?(ENG.L.budgets||[]).find(x=>x.id===id):null;
    const pid=cur?cur.project_id:(curProject()||'');
    const dir=cur?(cur.direction||'Outflow'):(dirPreset||'Outflow');
    const lvl=cur?(cur.head_id?'head':cur.item_id?(cur.tower_id?'block_material':'material'):cur.group_id?(cur.tower_id?'block_group':'group'):cur.tower_id?'block':'project'):'project';
    modal((cur?'Edit ':'Set ')+dir.toLowerCase()+' budget',
      '<label>Direction</label><select id="bfDir" '+(cur?'disabled':'onchange="ENG.f.bfDir()"')+'>'+opts([['Outflow','Outflow — a cost budget (work orders and bills)'],['Inflow','Inflow — expected collections (compared with receipts)']],x=>x[0],x=>x[1],dir)+'</select>'+
      '<label>Business unit</label><select id="bfProj" '+(cur?'disabled':'onchange="ENG.f.bfRefresh()"')+'>'+opts(C.projects,p=>p.id,p=>p.name,pid,'Select a business unit…')+'</select>'+
      '<label>Set against</label><select id="bfLevel" '+(cur?'disabled':'onchange="ENG.f.bfRefresh()"')+'>'+opts(levelsFor(dir),x=>x[0],x=>x[1],lvl)+'</select>'+
      '<div id="bfScope"></div>'+
      '<div class="two"><div><label>Budget amount (₹)</label><input id="bfAmt" type="number" min="0" step="0.01" value="'+(cur?num(cur.amount):'')+'"></div><div></div></div>'+
      '<label>Remarks <span style="color:var(--slate);font-weight:400">(optional)</span></label><input id="bfRem" value="'+esc(cur?cur.remarks:'')+'">',
      cancelBtn+'<button class="btn btn-primary" onclick="ENG.f.budgetSave(this,'+(id||0)+')"><i class="fa-solid fa-check"></i> Save</button>');
    await ENG.f.bfRefresh(cur);
  };
  ENG.f.bfDir=function(){
    const sel=$('bfLevel');if(!sel)return;
    const keep=sel.value,list=levelsFor(val('bfDir'));
    sel.innerHTML=opts(list,x=>x[0],x=>x[1],list.some(x=>x[0]===keep)?keep:'project');
    ENG.f.bfRefresh();
  };
  ENG.f.bfRefresh=async function(cur){
    const host=$('bfScope');if(!host)return;
    const pid=Number(val('bfProj'))||(cur&&cur.project_id)||null;const lvl=val('bfLevel');
    const needT=/block/.test(lvl),needG=/group/.test(lvl),needM=/material/.test(lvl),needH=lvl==='head';
    if(!pid){host.innerHTML='';return;}
    let towers=[];if(needT){try{towers=await loadTowers(pid);}catch(e){fail(e);}}
    const keep=k=>{const x=document.getElementById(k);return x?x.value:'';};
    const tSel=cur?String(cur.tower_id||''):keep('bfTower'),gSel=cur?String(cur.group_id||''):keep('bfGroup'),mSel=cur?String(cur.item_id||''):keep('bfItem'),hSel=cur?String(cur.head_id||''):keep('bfHead');
    const heads=(C.heads||[]).filter(h=>h.active);
    host.innerHTML=
      (needT?'<label>Block</label><select id="bfTower" '+(cur?'disabled':'')+'>'+opts(towers,x=>x.id,x=>x.name,tSel,'Select a block…')+'</select>':'')+
      (needH?'<label>Budget head</label><select id="bfHead" '+(cur?'disabled':'')+'>'+opts(heads,x=>x.id,x=>x.name,hSel,heads.length?'Select a head…':'No budget heads yet — add one under Masters')+'</select>'+
        '<div class="eng-note" style="margin-top:8px">Spend on a head comes from its Accounts ledger, not from the BOQ — so BOQ value, committed and billed are left blank for it.</div>':'')+
      (needG?'<label>Activity group</label><select id="bfGroup" '+(cur?'disabled':'')+'>'+opts(C.groups,x=>x.id,x=>x.name,gSel,'Select a group…')+'</select>':'')+
      (needM?'<label>Material</label><select id="bfItem" '+(cur?'disabled':'')+'>'+opts(C.items,x=>x.id,x=>x.name+(x.code?' ('+x.code+')':''),mSel,C.items.length?'Select a material…':'No materials in the Purchase item master yet')+'</select>':'');
  };
  ENG.f.budgetSave=function(btn,id){
    return run(btn,async()=>{
      const amt=numOrNull(val('bfAmt'));
      if(amt==null||isNaN(amt)||amt<0)return toast('Enter the budget amount','warn');
      const rem=val('bfRem').trim()||null;
      if(id){const {error}=await E().from('budgets').update({amount:amt,remarks:rem}).eq('id',id);if(error)throw error;}
      else{
        const lvl=val('bfLevel'),pid=Number(val('bfProj')),dir=val('bfDir')||'Outflow';
        if(!pid)return toast('Select a business unit','warn');
        const row={project_id:pid,direction:dir,amount:amt,remarks:rem};
        if(/block/.test(lvl)){row.tower_id=Number(val('bfTower'))||null;if(!row.tower_id)return toast('Select a block','warn');}
        if(lvl==='head'){row.head_id=Number(val('bfHead'))||null;if(!row.head_id)return toast('Select a budget head','warn');}
        if(/group/.test(lvl)){row.group_id=Number(val('bfGroup'))||null;if(!row.group_id)return toast('Select an activity group','warn');}
        if(/material/.test(lvl)){row.item_id=Number(val('bfItem'))||null;if(!row.item_id)return toast('Select a material','warn');}
        const {error}=await E().from('budgets').insert(row);if(error)throw error;
      }
      closeModal();toast('Budget saved','ok');renderPage();
    });
  };
  ENG.f.budgetDel=async function(id){
    if(!await confirmDialog('Delete this budget line?',{okLabel:'Delete'}))return;
    try{const {error}=await E().from('budgets').delete().eq('id',id);if(error)throw error;toast('Budget deleted','ok');renderPage();}catch(e){fail(e);}
  };

  /* ======================================================================= MASTERS */
  /* Masters has three things in it now and they are not read together: the trade structure, the
     activity list, and the spend heads that Accounts budgets against. Sub-tabs rather than one
     long page, so "add an activity" is somewhere you go rather than something you hunt for under
     the right group heading. */
  const MSUB=[['','Activity groups'],['acts','Activities'],['heads','Budget heads']];
  function msubBar(cur){
    return '<div class="tabs eng-tabs" style="margin-top:-4px">'+MSUB.map(s=>
      '<div class="tab'+(s[0]===cur?' active':'')+'" onclick="navTo(\'engineering/masters'+(s[0]?'/'+s[0]:'')+'\')">'+s[1]+'</div>').join('')+'</div>';
  }
  ENG.routes.masters=async function(v,a,t){
    const sub=(a&&a[0])||'';
    if(sub==='acts')  return ENG.f.mastersActs(v);
    if(sub==='heads') return ENG.f.mastersHeads(v);
    const used={};
    v.innerHTML=head('masters','Activity groups and the activities in them — the building blocks of every BOQ',
      '<button class="btn btn-primary" onclick="ENG.f.groupForm()"><i class="fa-solid fa-plus"></i> New group</button>')+
      msubBar('')+
      '<div id="engBody">'+(C.groups.length?C.groups.map(g=>{
        const acts=C.acts.filter(x=>x.group_id===g.id);
        return '<div class="card eng-tbl" style="margin-bottom:14px"><div class="card-pad" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--line)"><div><span class="sec-title" style="margin:0">'+esc(g.name)+'</span> '+(g.active?'':stTag('Inactive'))+' <span style="color:var(--slate);font-size:12.5px">· '+acts.length+' activit'+(acts.length===1?'y':'ies')+'</span></div><div style="display:flex;gap:8px"><button class="btn btn-sm" onclick="ENG.f.activityForm(0,'+g.id+')"><i class="fa-solid fa-plus"></i> Activity</button><button class="btn btn-sm" onclick="ENG.f.groupForm('+g.id+')"><i class="fa-solid fa-pen"></i></button><button class="btn btn-sm btn-danger" onclick="ENG.f.groupDel('+g.id+')"><i class="fa-solid fa-trash"></i></button></div></div>'+
          (acts.length?'<table class="tbl"><thead><tr><th>Activity</th><th>UoM</th><th class="r">Estimated rate</th><th>Status</th><th></th></tr></thead><tbody>'+acts.map(x=>'<tr><td><b>'+esc(x.name)+'</b></td><td>'+esc(x.uom)+'</td><td class="r">'+(x.est_rate!=null?inr(x.est_rate):'—')+'</td><td>'+stTag(x.active?'Active':'Inactive')+'</td><td style="white-space:nowrap;text-align:right"><button class="btn btn-sm" onclick="ENG.f.activityForm('+x.id+')"><i class="fa-solid fa-pen"></i></button> <button class="btn btn-sm btn-danger" onclick="ENG.f.activityDel('+x.id+')"><i class="fa-solid fa-trash"></i></button></td></tr>').join('')+'</tbody></table>':'<div class="empty" style="padding:22px">No activities in this group yet</div>')+'</div>';
      }).join(''):'<div class="card card-pad empty"><i class="fa-solid fa-sliders"></i><div style="font-weight:600;color:var(--ink)">No activity groups yet</div><p>Create a group, then add activities to it.</p></div>')+'</div>';
  };
  /* ---- Masters -> Activities: the flat list, and the one place built for adding one ---- */
  const groupName=id=>{const g=groupById(id);return g?g.name:'—';};
  ENG.f.mastersActs=function(v){
    const rows=C.acts.slice().sort((x,y)=>String(groupName(x.group_id)+x.name).localeCompare(String(groupName(y.group_id)+y.name)));
    v.innerHTML=head('masters','Every activity in the master, with the group it belongs to',
      '<button class="btn btn-primary" onclick="ENG.f.activityForm(0)"><i class="fa-solid fa-plus"></i> New activity</button>')+
      msubBar('acts')+
      '<div class="card eng-tbl">'+(rows.length
        ? '<table class="tbl"><thead><tr><th>Activity</th><th>Parent group</th><th>Unit</th><th class="r">Estimated rate</th><th>Status</th><th></th></tr></thead><tbody>'+
          rows.map(x=>'<tr><td><b>'+esc(x.name)+'</b>'+
              (x.description?'<div class="sub" style="font-size:12px;color:var(--slate)">'+esc(x.description)+'</div>':'')+
              (x.long_description?'<div class="sub" style="font-size:11.5px;color:var(--slate);opacity:.8;margin-top:2px">'+esc(x.long_description.length>120?x.long_description.slice(0,120)+'…':x.long_description)+'</div>':'')+
            '</td><td>'+esc(groupName(x.group_id))+'</td><td>'+esc(x.uom)+'</td>'+
            '<td class="r">'+(x.est_rate!=null?inr(x.est_rate):'—')+'</td><td>'+stTag(x.active?'Active':'Inactive')+'</td>'+
            '<td style="white-space:nowrap;text-align:right"><button class="btn btn-sm" onclick="ENG.f.activityForm('+x.id+')"><i class="fa-solid fa-pen"></i></button> <button class="btn btn-sm btn-danger" onclick="ENG.f.activityDel('+x.id+')"><i class="fa-solid fa-trash"></i></button></td></tr>').join('')+
          '</tbody></table>'
        : '<div class="empty" style="padding:34px"><i class="fa-solid fa-list-check"></i><div style="font-weight:600;color:var(--ink)">No activities yet</div><p>Add one here, or from the BOQ screen while you are building a bill of quantities.</p></div>')+
      '</div>';
  };

  /* ---- Masters -> Budget heads: the spend heads Accounts budgets against ---- */
  ENG.f.mastersHeads=function(v){
    const led=id=>{const l=(C.ledgers||[]).find(x=>x.id===id);return l?l.name:null;};
    v.innerHTML=head('masters','Spend heads a budget can be set against, each pointing at one Accounts ledger',
      '<button class="btn btn-primary" onclick="ENG.f.headForm()"><i class="fa-solid fa-plus"></i> New budget head</button>')+
      msubBar('heads')+
      '<div class="card eng-tbl">'+((C.heads||[]).length
        ? '<table class="tbl"><thead><tr><th>Budget head</th><th>Accounts ledger</th><th class="r">Sort</th><th>Status</th><th></th></tr></thead><tbody>'+
          C.heads.map(h=>'<tr><td><b>'+esc(h.name)+'</b>'+
              (h.description?'<div class="sub" style="font-size:12px;color:var(--slate)">'+esc(h.description)+'</div>':'')+'</td>'+
            '<td>'+(h.ledger_id?esc(led(h.ledger_id)||('Ledger #'+h.ledger_id)):'<span style="color:#b45309">Not linked — no actual can be shown</span>')+'</td>'+
            '<td class="r">'+num(h.sort_order)+'</td><td>'+stTag(h.active?'Active':'Inactive')+'</td>'+
            '<td style="white-space:nowrap;text-align:right"><button class="btn btn-sm" onclick="ENG.f.headForm('+h.id+')"><i class="fa-solid fa-pen"></i></button> <button class="btn btn-sm btn-danger" onclick="ENG.f.headDel('+h.id+')"><i class="fa-solid fa-trash"></i></button></td></tr>').join('')+
          '</tbody></table>'
        : '<div class="empty" style="padding:34px"><i class="fa-solid fa-wallet"></i><div style="font-weight:600;color:var(--ink)">No budget heads yet</div><p>A head is a spend head to budget against — Civil, MEP, Site establishment — pointing at the Accounts ledger its money is booked to.</p></div>')+
      '</div>'+
      ((C.ledgers||[]).length?'':'<div class="eng-note" style="margin-top:12px">No Accounts ledgers are readable from here, so a head cannot be linked yet. Accounts is limited by name; ask whoever holds it to add the ledgers, or to grant you access.</div>');
  };
  ENG.f.headForm=function(id){
    const h=id?(C.heads||[]).find(x=>x.id===id):{name:'',ledger_id:'',description:'',sort_order:(C.heads||[]).length+1,active:true};
    if(!h)return;
    const leds=(C.ledgers||[]).filter(l=>l.active!==false);
    modal(id?'Edit budget head':'New budget head',
      '<label>Budget head name</label><input id="bhName" value="'+esc(h.name)+'" placeholder="e.g. Civil works">'+
      '<label>Accounts ledger <span style="color:var(--slate);font-weight:400">the actual spend on this head is read from here</span></label>'+
      '<select id="bhLedger">'+opts(leds,l=>l.id,l=>l.name+(l.code?' ('+l.code+')':''),h.ledger_id||'',leds.length?'Select a ledger…':'No Accounts ledgers readable')+'</select>'+
      '<label>Description <span style="color:var(--slate);font-weight:400">optional</span></label><input id="bhDesc" value="'+esc(h.description||'')+'">'+
      '<div class="two"><div><label>Sort order</label><input id="bhSort" type="number" value="'+num(h.sort_order)+'"></div>'+
      '<div><label>Status</label><select id="bhAct"><option value="1"'+(h.active?' selected':'')+'>Active</option><option value="0"'+(h.active?'':' selected')+'>Inactive</option></select></div></div>'+
      '<div class="eng-note" style="margin-top:12px">One ledger per head. Two heads sharing a ledger would each report the whole of that ledger as their own spend.</div>',
      cancelBtn+'<button class="btn btn-primary" onclick="ENG.f.headSave(this,'+(id||0)+')"><i class="fa-solid fa-check"></i> Save</button>');
  };
  ENG.f.headSave=function(btn,id){
    return run(btn,async()=>{
      const row={name:val('bhName').trim(),ledger_id:Number(val('bhLedger'))||null,
        description:val('bhDesc').trim()||null,sort_order:Number(val('bhSort'))||0,active:val('bhAct')==='1'};
      if(!row.name)return toast('Enter the budget head name','warn');
      const r=id?await E().from('budget_heads').update(row).eq('id',id):await E().from('budget_heads').insert(row);
      if(r.error)throw r.error;
      await loadMasters(true);closeModal();toast('Budget head saved','ok');renderPage();
    });
  };
  ENG.f.headDel=async function(id){
    const h=(C.heads||[]).find(x=>x.id===id);if(!h)return;
    if(!await confirmDialog('Delete the budget head “'+h.name+'”? This only works if no budget uses it.',{okLabel:'Delete'}))return;
    try{const r=await E().from('budget_heads').delete().eq('id',id);if(r.error)throw r.error;
      await loadMasters(true);toast('Budget head deleted','ok');renderPage();}catch(e){fail(e);}
  };

  ENG.f.groupForm=function(id){
    const g=id?groupById(id):{name:'',sort_order:C.groups.length+1,active:true};
    modal(id?'Edit activity group':'New activity group',
      '<label>Group name</label><input id="mgName" value="'+esc(g.name)+'" placeholder="e.g. Plastering">'+
      '<div class="two"><div><label>Sort order</label><input id="mgSort" type="number" value="'+g.sort_order+'"></div><div><label>Status</label><select id="mgAct"><option value="1"'+(g.active?' selected':'')+'>Active</option><option value="0"'+(g.active?'':' selected')+'>Inactive</option></select></div></div>',
      cancelBtn+'<button class="btn btn-primary" onclick="ENG.f.groupSave(this,'+(id||0)+')"><i class="fa-solid fa-check"></i> Save</button>');
  };
  ENG.f.groupSave=function(btn,id){
    return run(btn,async()=>{
      const row={name:val('mgName').trim(),sort_order:Number(val('mgSort'))||0,active:val('mgAct')==='1'};
      if(!row.name)return toast('Enter a name','warn');
      const r=id?await E().from('activity_groups').update(row).eq('id',id):await E().from('activity_groups').insert(row);
      if(r.error)throw r.error;
      await loadMasters(true);closeModal();toast('Group saved','ok');renderPage();
    });
  };
  ENG.f.groupDel=async function(id){
    const g=groupById(id);
    if(C.acts.some(x=>x.group_id===id))return toast('Delete or move this group’s activities first — or mark the group inactive.','warn');
    if(!await confirmDialog('Delete the group “'+g.name+'”? This only works if no budget uses it.',{okLabel:'Delete'}))return;
    try{const r=await E().from('activity_groups').delete().eq('id',id);if(r.error)throw r.error;await loadMasters(true);toast('Group deleted','ok');renderPage();}catch(e){fail(e);}
  };
  const UOM_FALLBACK=['Cum','Sqm','Rmt','Kg','Nos','Mtr','Sqft','MT','Ltr','Set'];
  ENG.f.activityForm=function(id,groupId){
    const a=id?actById(id):{group_id:groupId||'',name:'',uom:'',est_rate:'',active:true};
    const uoms=(C.uoms.length?C.uoms.map(u=>u.code):UOM_FALLBACK).slice();
    if(a.uom&&uoms.indexOf(a.uom)<0)uoms.push(a.uom);
    modal(id?'Edit activity':'New activity',
      '<label>Activity name</label><input id="maName" value="'+esc(a.name)+'" placeholder="e.g. Internal plaster">'+
      '<label>Parent activity group</label><select id="maGroup">'+opts(C.groups,g=>g.id,g=>g.name,a.group_id,'Select a group…')+'</select>'+
      '<div class="two"><div><label>Unit</label><select id="maUom">'+opts(uoms,u=>u,u=>u,a.uom,'Select…')+'</select></div><div><label>Estimated rate (₹) <span style="color:var(--slate);font-weight:400">optional</span></label><input id="maRate" type="number" min="0" step="0.01" value="'+(a.est_rate!=null?a.est_rate:'')+'"></div></div>'+
      /* Two descriptions, because they answer different questions. The short one rides along
         wherever the activity is picked — BOQ, work orders — so it has to fit on one line. The long
         one is the specification nobody wants in a dropdown but somebody needs before ordering the
         work, so it lives on the master and is read here. */
      '<label>Description <span style="color:var(--slate);font-weight:400">one line, shown wherever this activity is picked</span></label>'+
      '<input id="maDesc" value="'+esc(a.description||'')+'" placeholder="e.g. 12mm cement plaster on internal walls">'+
      '<label>Long description <span style="color:var(--slate);font-weight:400">the full specification — optional</span></label>'+
      '<textarea id="maLong" rows="4" placeholder="Method, materials, finish, acceptance — whatever the contractor needs to price and execute it.">'+esc(a.long_description||'')+'</textarea>'+
      '<label>Status</label><select id="maAct"><option value="1"'+(a.active?' selected':'')+'>Active</option><option value="0"'+(a.active?'':' selected')+'>Inactive</option></select>',
      cancelBtn+'<button class="btn btn-primary" onclick="ENG.f.activitySave(this,'+(id||0)+')"><i class="fa-solid fa-check"></i> Save</button>');
  };
  ENG.f.activitySave=function(btn,id){
    return run(btn,async()=>{
      const rate=numOrNull(val('maRate'));
      const row={group_id:Number(val('maGroup')),name:val('maName').trim(),uom:val('maUom'),est_rate:rate,
        description:val('maDesc').trim()||null,long_description:val('maLong').trim()||null,
        active:val('maAct')==='1'};
      if(!row.group_id)return toast('Select a parent activity group','warn');
      if(!row.name)return toast('Enter the activity name','warn');
      if(!row.uom)return toast('Select the unit','warn');
      if(rate!=null&&(isNaN(rate)||rate<0))return toast('Enter a valid rate','warn');
      const r=id?await E().from('activities').update(row).eq('id',id).select('id').maybeSingle()
                :await E().from('activities').insert(row).select('id').maybeSingle();
      if(r.error)throw r.error;
      await loadMasters(true);closeModal();toast('Activity saved','ok');renderPage();
    });
  };
  ENG.f.activityDel=async function(id){
    const a=actById(id);
    if(!await confirmDialog('Delete the activity “'+a.name+'”? This only works if no BOQ uses it yet.',{okLabel:'Delete'}))return;
    try{const r=await E().from('activities').delete().eq('id',id);if(r.error)throw r.error;await loadMasters(true);toast('Activity deleted','ok');renderPage();}catch(e){fail(e);}
  };
})();
