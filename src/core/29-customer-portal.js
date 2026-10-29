/* ============================ CUSTOMER PORTAL (real data) ============================ */
// Backs both the staff-facing "Customer Portal Admin" module (project/unit/customer CRUD, Farvision
// CSV import, photo & document uploads) and the customer-facing VIEWS.customer below — both read the
// same cust.* schema. A customer's RLS (20260828090000_customer_portal_schema.sql) scopes every query
// to their own unit(s) automatically, so the customer-facing view code never filters by customer_id
// itself; it only ever sees what RLS already let through.
const custInr=n=>{const v=Number(n||0);return '₹'+v.toLocaleString('en-IN',{minimumFractionDigits:v%1?2:0,maximumFractionDigits:2});};
// A non-escaping sibling of mTable (nexus-core.js) — this module builds every cell itself (escaping
// DB text with esc() inline) so it can freely embed buttons/tags without mTable's "only <span survives
// unescaped" rule getting in the way.
function cpaTable(cols,rows){return '<div class="card qc-table-card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+cols.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></div>';}

const CPA={projects:null,units:null,customers:null,amenities:null,paymentSettings:null,projectManagers:null,staffOptions:null};
async function cpaProjects(force){
  if(CPA.projects&&!force)return CPA.projects;
  const {data}=await sb.schema('cust').from('projects').select('*').is('deleted_at',null).order('name');
  CPA.projects=data||[];return CPA.projects;
}
async function cpaUnits(force){
  if(CPA.units&&!force)return CPA.units;
  if(cpaPhotosOnly()){
    // cust.units itself is closed to a photos-only account (agreement values, customer links).
    const {data}=await sb.schema('cust').rpc('media_unit_list');
    CPA.units=(data||[]).map(u=>({...u,projects:{id:u.project_id,name:u.project_name}}));return CPA.units;
  }
  const {data}=await sb.schema('cust').from('units').select('*, projects(id,name)').is('deleted_at',null).order('id',{ascending:false});
  CPA.units=data||[];return CPA.units;
}
async function cpaCustomers(force){
  if(CPA.customers&&!force)return CPA.customers;
  const {data}=await sb.schema('cust').from('customers').select('*').is('deleted_at',null).order('full_name');
  CPA.customers=data||[];return CPA.customers;
}
async function cpaAmenities(force){
  if(CPA.amenities&&!force)return CPA.amenities;
  const {data}=await sb.schema('cust').from('amenities').select('*, projects(id,name)').is('deleted_at',null).order('name');
  CPA.amenities=data||[];return CPA.amenities;
}
async function cpaPaymentSettings(force){
  if(CPA.paymentSettings&&!force)return CPA.paymentSettings;
  const {data}=await sb.schema('cust').from('payment_settings').select('*').eq('id',1).maybeSingle();
  CPA.paymentSettings=data||{id:1,upi_id:null,qr_storage_path:null};return CPA.paymentSettings;
}
async function cpaProjectManagers(force){
  if(CPA.projectManagers&&!force)return CPA.projectManagers;
  const {data}=await sb.schema('cust').from('project_managers').select('*, projects(id,name)').is('deleted_at',null).order('assigned_at',{ascending:false});
  CPA.projectManagers=data||[];return CPA.projectManagers;
}
// adm.users only lets a staff member read their own row via RLS, so a "pick a Project Manager"
// dropdown can't just query it directly - app.list_custportal_staff() is the narrow function that
// returns name+email for anyone eligible, same trust boundary as app.is_custportal_staff() itself.
async function cpaStaffOptions(force){
  if(CPA.staffOptions&&!force)return CPA.staffOptions;
  const {data}=await sb.schema('app').rpc('list_custportal_staff');
  CPA.staffOptions=data||[];return CPA.staffOptions;
}

VIEWS.custportal_admin=async function(v,seg){
  setCrumb(['Stakeholder Portals','Customer Portal Admin']);
  /* ".../custportal-admin.html#/3/review" - the "Review now" link in an approver's email - opens
     Photos & Videos on Review. Taken once and dropped from the address, so switching back to Upload
     afterwards is not overruled by it. */
  if(Array.isArray(seg)&&seg.indexOf('review')!==-1){
    if(cpaIsPhotoApprover()){ CPA_PH.mode='review'; CPA_RV.status='pending'; CPA_RV.sel.clear(); CPA_RV.picked=false; }
    try{ history.replaceState(history.state,'',location.pathname+location.search+'#/'+seg.filter(s=>s!=='review').join('/')); }catch(_e){}
  }
  if(cpaPhotosOnly()){
    v.innerHTML=mHead('fa-address-card','#0f766e','Customer Portal Admin')+mTabs('custportal_admin',['Photos & Videos'],0)+'<div id="cpaBody" style="margin-top:14px"><div class="loader"><div class="spin"></div></div></div>';
    const h=$('cpaBody');if(h) await cpaRenderPhotos(h);
    return;
  }
  // Customer Features is last so every older tab keeps its number - the index is the route.
  const tabs=['Projects & Units','Customers','Farvision Import','Photos & Videos','Inspection','Documents','Amenities','Sub-meter','Support','Referrals','Maintenance','Modification Requests','Customer Features'];
  const ti=mTab(seg,tabs.length);
  // The tab strip stays in view under the top bar while a long list scrolls (6 Oct 2026).
  v.innerHTML=mHead('fa-address-card','#0f766e','Customer Portal Admin')
    +'<div style="position:sticky;top:var(--topbar,60px);z-index:25;background:var(--bg,#f4f6fb);margin:0 -4px;padding:6px 4px 0">'+mTabs('custportal_admin',tabs,ti)+'</div>'
    +'<div id="cpaBody" style="margin-top:14px"><div class="loader"><div class="spin"></div></div></div>';
  const host=$('cpaBody');if(!host)return;
  if(ti===0) await cpaRenderProjectsUnits(host);
  else if(ti===1) await cpaRenderCustomers(host);
  else if(ti===2) await cpaRenderImport(host,seg);
  else if(ti===3) await cpaRenderPhotos(host);
  else if(ti===4) await cpaRenderInspection(host);
  else if(ti===5) await cpaRenderDocuments(host);
  else if(ti===6) await cpaRenderAmenities(host);
  else if(ti===7) await cpaRenderSubmeter(host);
  else if(ti===8) await cpaRenderSupport(host);
  else if(ti===9) await cpaRenderReferrals(host);
  else if(ti===10) await cpaRenderMaintenance(host,seg);
  else if(ti===11) await cpaRenderModificationRequests(host);
  else await cpaRenderFeatures(host);
};

/* ---------- Tab 13: Customer Features - which sections customers see, per project and block ----------
   Rows live in cust.feature_access; the customer portal resolves them with custFeatureOn() (block,
   then project, then the all-projects default). Home is always shown and is not listed. */
let CPA_FEAT_PROJ='';
// Shown beside a section so nobody switches on something that is not finished (audit, 30 Sep 2026).
// Sign-in first - with it off for a block, that block's customers cannot get in to see anything else.
function cpaFeatureRows(){
  // Flat photos sit right under Construction Progress, the section they appear in.
  const rows=CUST_FEATURES.map(f=>({key:f.key,label:CUST_TABS[f.tab]}));
  const at=rows.findIndex(r=>r.key==='progress')+1;
  rows.splice(at,0,{key:'flat_photos',label:'↳ Flat photos'});
  return [{key:'login',label:'Customer sign-in'}].concat(rows);
}
const CPA_FEATURE_NOTES={
  login:'Who can sign in with a code sent to the email on their booking. Off = these customers cannot sign in at all.',
  flat_photos:'Photos of the customer\'s own flat inside Construction Progress. Off = only block photos are shown. Hidden on 1 Oct 2026 while the flat photos are checked.',
  inspection:'Not finished - staff cannot list or delete an uploaded checklist or update.',
  documents:'Not finished - staff cannot list or delete an uploaded document.',
  videos:'Ready - but no process videos have been uploaded yet.',
  support:'Ready - needs the Zoho Desk connection; replies are made in Zoho Desk.',
  amenities:'Not finished - a customer can see other flats\' bookings. After possession only.',
  submeter:'Ready - payment is by UPI reference, confirmed by staff.',
  referrals:'Not finished - "Refer & earn" has no reward or sales hand-off yet.',
  maintenance:'Not finished - a confirmed payment does not reduce the balance until the next import. After possession only.',
  modifications:'Ready - assign a Project Manager per project first. After possession only.'
};
async function cpaRenderFeatures(host){
  const [projects,units,rulesRes]=await Promise.all([cpaProjects(true),cpaUnits(true),
    sb.schema('cust').from('feature_access').select('*')]);
  if(rulesRes.error){ host.innerHTML='<div class="card card-pad empty">Could not load the section settings: '+esc(rulesRes.error.message)+'</div>'; return; }
  CPA.featureRules=rulesRes.data||[];
  const proj=projects.find(p=>String(p.id)===CPA_FEAT_PROJ)||null;
  if(!proj)CPA_FEAT_PROJ='';
  const natural=(a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});
  const blocks=proj?[...new Set(units.filter(u=>u.project_id===proj.id&&u.tower&&u.status!=='cancelled').map(u=>u.tower))].sort(natural):[];
  const rules=CPA.featureRules;
  const exact=(key,pid,tower)=>rules.find(r=>r.feature===key&&(r.project_id||null)===(pid||null)&&(r.tower||null)===(tower||null));
  const onOff=b=>b?'On':'Off';
  // One dropdown per cell. "Follow ..." means no row at this level; the label shows what that gives.
  const cell=(key,pid,tower)=>{
    const own=exact(key,pid,tower);
    const val=own?(own.enabled?'on':'off'):'';
    const eff=custFeatureOn(rules,key,pid,tower);
    const followLbl=pid==null?null:(tower?'Same as project':'Same as default')+' ('+onOff(tower?custFeatureOn(rules,key,pid,null):custFeatureOn(rules,key,null,null))+')';
    const opts=(followLbl?`<option value=""${val===''?' selected':''}>${followLbl}</option>`:'')+
      `<option value="on"${val==='on'?' selected':''}>On</option><option value="off"${val==='off'?' selected':''}>Off</option>`;
    const style=eff?'color:#15803d;border-color:#bbf7d0;background:#f0fdf4':'color:#64748b;background:#f8fafc';
    return `<select class="mu-sel" style="min-width:128px;font-weight:${val?'600':'400'};${style}" title="${eff?'Customers see this section':'Hidden from customers'}"
      onchange="cpaFeatureSet('${key}',${pid==null?'null':pid},${esc(JSON.stringify(tower||null))},this.value)">${opts}</select>`;
  };
  const head=['Section'].concat(proj?['Whole project'].concat(blocks):['All projects']);
  const rows=cpaFeatureRows().map(f=>{
    const note=CPA_FEATURE_NOTES[f.key]||'Ready.';
    const warn=/^Not finished/.test(note);
    return [`<div style="min-width:250px;max-width:340px"><b>${f.key==='login'?'<i class="fa-solid fa-right-to-bracket" style="color:#1d4ed8"></i> ':''}${esc(f.label)}</b>`+
      `<div style="font-size:12px;line-height:1.45;margin-top:2px;color:${warn?'#b45309':'var(--slate)'}">${warn?'<i class="fa-solid fa-triangle-exclamation"></i> ':''}${esc(note)}</div></div>`]
      .concat(proj?[cell(f.key,proj.id,null)].concat(blocks.map(b=>cell(f.key,proj.id,b))):[cell(f.key,null,null)]);
  });
  const projOpts=projects.map(p=>`<option value="${p.id}"${String(p.id)===CPA_FEAT_PROJ?' selected':''}>${esc(p.name)}</option>`).join('');
  host.innerHTML=`<div class="sec-title" style="margin:0 0 6px">Customer Features</div>
    <div style="font-size:13px;color:var(--slate);margin-bottom:12px;line-height:1.55">Choose which customers can sign in, and which sections they see. <b>Home</b> is always shown.
      A block's setting beats its project's, and a project's beats the default for all projects. Customers see a change the next time they open or refresh the portal.
      To check, use the <i class="fa-solid fa-eye"></i> preview on the Customers tab.</div>
    <div class="mu-filters"><select id="cpaFeatProj" class="mu-sel" style="max-width:360px" onchange="CPA_FEAT_PROJ=this.value;route()">
      <option value=""${CPA_FEAT_PROJ?'':' selected'}>Default — all projects</option>${projOpts}</select>
      ${proj&&!blocks.length?'<span class="mu-count">This project has no blocks with a live flat yet.</span>':''}</div>
    <div style="overflow-x:auto">${cpaTable(head,rows)}</div>`;
}
window.cpaFeatureSet=async function(key,pid,tower,value){
  const rules=CPA.featureRules||[];
  const own=rules.find(r=>r.feature===key&&(r.project_id||null)===(pid||null)&&(r.tower||null)===(tower||null));
  let error;
  if(value===''){ if(own)({error}=await sb.schema('cust').from('feature_access').delete().eq('id',own.id)); }
  else{
    const row={enabled:value==='on',updated_at:new Date().toISOString(),updated_by:state.email};
    if(own)({error}=await sb.schema('cust').from('feature_access').update(row).eq('id',own.id));
    else ({error}=await sb.schema('cust').from('feature_access').insert({...row,feature:key,project_id:pid,tower}));
  }
  if(error){ toast('Could not save: '+error.message,'err'); }
  else{
    const where=tower?tower:pid!=null?'the whole project':'all projects';
    toast((cpaFeatureRows().find(f=>f.key===key)||{label:key}).label+': '+(value===''?'following the level above':value==='on'?'switched on':'switched off')+' for '+where,'ok');
  }
  route();
};

/* ---------- Tab 1: Projects & Units ---------- */
let CPA_UNIT_FILTER={proj:'',q:''};
async function cpaRenderProjectsUnits(host){
  const [projects,units]=await Promise.all([cpaProjects(true),cpaUnits(true),cpaCustomers(true)]);
  const projRows=projects.map(p=>{
    const mine=units.filter(u=>u.project_id===p.id);
    return [esc(p.name),esc(p.farvision_project_code||'—'),String(mine.length),
      String(new Set(mine.map(u=>u.customer_id).filter(Boolean)).size),
      `<button class="btn btn-sm" onclick="cpaUnitsFor(${p.id})"><i class="fa-solid fa-list"></i> Units</button>`+
      ` <button class="btn btn-sm" onclick="cpaProjectModal(${p.id})"><i class="fa-solid fa-pen"></i> Edit</button>`];
  });
  const projOpts=projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  host.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div class="sec-title" style="margin:0">Projects</div><button class="btn btn-primary" onclick="cpaProjectModal()"><i class="fa-solid fa-plus"></i> New project</button></div>`+
    cpaTable(['Project','Farvision code','Units','Customers',''],projRows.length?projRows:[['No projects yet','','','','']])+
    `<div style="display:flex;justify-content:space-between;align-items:center;margin:22px 0 10px"><div class="sec-title" style="margin:0">Units</div><button class="btn btn-primary" onclick="cpaUnitModal()"><i class="fa-solid fa-plus"></i> New unit</button></div>
    <div class="mu-filters">
      <select id="cpaUnitProj" class="mu-sel" onchange="cpaUnitFilter()" style="max-width:320px"><option value="">All projects</option>${projOpts}</select>
      <span class="mu-sw"><i class="fa-solid fa-magnifying-glass"></i><input id="cpaUnitQ" placeholder="Search unit code, tower or customer" oninput="cpaUnitFilter()"></span>
      <span class="mu-count" id="cpaUnitCount"></span>
    </div>
    <div id="cpaUnitList"></div>`;
  cpaUnitList();
  if(CPA_UNIT_FILTER.proj)$('cpaUnitProj').value=CPA_UNIT_FILTER.proj;
  if(CPA_UNIT_FILTER.q)$('cpaUnitQ').value=CPA_UNIT_FILTER.q;
}
window.cpaUnitFilter=function(){
  CPA_UNIT_FILTER.proj=$('cpaUnitProj').value;
  CPA_UNIT_FILTER.q=$('cpaUnitQ').value.trim().toLowerCase();
  cpaUnitList();
};
// "Units" on a project row jumps the list below to that project rather than opening a second screen.
window.cpaUnitsFor=function(pid){
  CPA_UNIT_FILTER.proj=String(pid);
  const sel=$('cpaUnitProj');if(sel)sel.value=String(pid);
  cpaUnitList();
  const list=$('cpaUnitList');if(list)list.scrollIntoView({behavior:'smooth',block:'center'});
};
function cpaUnitList(){
  const units=CPA.units||[],{proj,q}=CPA_UNIT_FILTER;
  const custById={};(CPA.customers||[]).forEach(c=>{custById[c.id]=c;});
  const list=units.filter(u=>{
    if(proj&&String(u.project_id)!==proj)return false;
    if(q){
      const c=custById[u.customer_id];
      if(![u.unit_code,u.tower,c&&c.full_name,c&&c.email].join(' ').toLowerCase().includes(q))return false;
    }
    return true;
  });
  const rows=list.map(u=>{
    const c=custById[u.customer_id];
    return [esc(u.unit_code),(u.projects&&u.projects.name)?cpaProjectChip(u.projects.name):'—',esc(u.tower||'—'),esc(u.unit_category||'—'),esc(u.unit_type||'—'),
      `<span class="tag t-blue">${esc(u.status||'—')}</span>`,
      c?`<span style="white-space:nowrap">${esc(c.full_name)}</span>`:'<span class="tag t-gray">Unassigned</span>',
      `<button class="btn btn-sm" title="Edit unit" onclick="cpaUnitModal(${u.id})"><i class="fa-solid fa-pen"></i></button>`];
  });
  const cnt=$('cpaUnitCount');if(cnt)cnt.textContent=list.length+' of '+units.length;
  $('cpaUnitList').innerHTML=cpaTable(['Unit code','Project','Tower','Category','Sub-type','Status','Customer',''],
    rows.length?rows:[['No units match this filter','','','','','','','']]);
}
window.cpaProjectModal=function(id){
  const p=id?(CPA.projects||[]).find(x=>x.id===id):null;
  openModal(`<div class="modal-head"><h3>${p?'Edit project':'New project'}</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm"><label>Project name</label><input id="cpaPName" value="${p?esc(p.name):''}">
    <label>Farvision project code (optional)</label><input id="cpaPCode" value="${p?esc(p.farvision_project_code||''):''}"></div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="cpaProjectSave(${p?p.id:'null'})">Save</button></div>`);
};
window.cpaProjectSave=async function(id){
  const name=$('cpaPName').value.trim();const farvision_project_code=$('cpaPCode').value.trim()||null;
  if(!name){toast('Enter a project name','err');return;}
  let error;
  if(id){({error}=await sb.schema('cust').from('projects').update({name,farvision_project_code}).eq('id',id));}
  else{({error}=await sb.schema('cust').from('projects').insert({name,farvision_project_code,created_by:state.email}));}
  if(error){toast('Save failed: '+error.message,'err');return;}
  closeModal();toast('Project saved','ok');route();
};
// Mirrors Farvision's own Unit master form (Unit Specification / Basic Specification / Area
// Specification / Secondary Area Specification) - see the migration this shipped alongside for the
// exact field mapping. Still one row per saleable flat, not Farvision's Tower/Floor/Flat hierarchy.
window.cpaUnitModal=async function(id){
  const [projects,customers,units]=await Promise.all([cpaProjects(),cpaCustomers(),cpaUnits()]);
  const u=id?units.find(x=>x.id===id):null;
  const projOpts=projects.map(p=>`<option value="${p.id}" ${u&&u.project_id===p.id?'selected':''}>${esc(p.name)}</option>`).join('');
  const custOpts='<option value="">— Unassigned —</option>'+customers.map(c=>`<option value="${c.id}" ${u&&u.customer_id===c.id?'selected':''}>${esc(c.full_name)}</option>`).join('');
  const statusOpts=['booked','registered','possession','cancelled'].map(s=>`<option ${u&&u.status===s?'selected':''}>${s}</option>`).join('');
  const area=(id,val)=>`<input id="${id}" type="number" value="${val!=null?val:''}">`;
  openModal(`<div class="modal-head"><h3>${u?'Edit unit':'New unit'}</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm">
    <div class="sec-title" style="margin:0 0 8px">Unit Specification</div>
    <label>Business Unit (Project)</label><select id="cpaUProject">${projOpts}</select>
    <div class="two"><div><label>Code</label><input id="cpaUCode" value="${u?esc(u.unit_code):''}"></div><div><label>Unit Type</label><input id="cpaUCategory" value="${u?esc(u.unit_category||''):''}" placeholder="Flat / Shop / Office / Parking"></div></div>
    <div class="two"><div><label>Sub-Unit Type</label><input id="cpaUType" value="${u?esc(u.unit_type||''):''}" placeholder="3BHK"></div><div><label>Tower</label><input id="cpaUTower" value="${u?esc(u.tower||''):''}"></div></div>
    <label>Floor no.</label><input id="cpaUFloor" value="${u?esc(u.floor_no||''):''}">

    <div class="sec-title" style="margin:18px 0 8px">Basic Specification</div>
    <div class="two"><div><label>Allotted To</label><select id="cpaUCustomer">${custOpts}</select></div><div><label>Status</label><select id="cpaUStatus">${statusOpts}</select></div></div>
    <label>Agreement value (₹)</label><input id="cpaUAgVal" type="number" value="${u&&u.agreement_value!=null?u.agreement_value:''}">

    <div class="sec-title" style="margin:18px 0 8px">Area Specification (Sq. Feet)</div>
    <div class="two"><div><label>Super Built-up</label>${area('cpaUSuperBuiltUp',u&&u.super_built_up_area_sqft)}</div><div><label>Built-up</label>${area('cpaUBuiltUp',u&&u.built_up_area_sqft)}</div></div>
    <div class="two"><div><label>Carpet</label>${area('cpaUArea',u&&u.carpet_area_sqft)}</div><div><label>Land</label>${area('cpaULand',u&&u.land_area_sqft)}</div></div>

    <div class="sec-title" style="margin:18px 0 8px">Secondary Area Specification (Sq. Feet — optional)</div>
    <div class="two"><div><label>Super Built-up</label>${area('cpaUSecSuperBuiltUp',u&&u.secondary_super_built_up_area_sqft)}</div><div><label>Built-up</label>${area('cpaUSecBuiltUp',u&&u.secondary_built_up_area_sqft)}</div></div>
    <div class="two"><div><label>Carpet</label>${area('cpaUSecCarpet',u&&u.secondary_carpet_area_sqft)}</div><div><label>Land</label>${area('cpaUSecLand',u&&u.secondary_land_area_sqft)}</div></div>
    </div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="cpaUnitSave(${u?u.id:'null'})">Save</button></div>`,'lg');
};
window.cpaUnitSave=async function(id){
  const project_id=Number($('cpaUProject').value);const unit_code=$('cpaUCode').value.trim();
  if(!project_id||!unit_code){toast('Project and unit code are required','err');return;}
  const num=elId=>$(elId).value?Number($(elId).value):null;
  const row={project_id,unit_code,
    unit_category:$('cpaUCategory').value.trim()||null,unit_type:$('cpaUType').value.trim()||null,
    tower:$('cpaUTower').value.trim()||null,floor_no:$('cpaUFloor').value.trim()||null,
    carpet_area_sqft:num('cpaUArea'),super_built_up_area_sqft:num('cpaUSuperBuiltUp'),built_up_area_sqft:num('cpaUBuiltUp'),land_area_sqft:num('cpaULand'),
    secondary_carpet_area_sqft:num('cpaUSecCarpet'),secondary_super_built_up_area_sqft:num('cpaUSecSuperBuiltUp'),secondary_built_up_area_sqft:num('cpaUSecBuiltUp'),secondary_land_area_sqft:num('cpaUSecLand'),
    agreement_value:num('cpaUAgVal'),
    status:$('cpaUStatus').value,customer_id:$('cpaUCustomer').value?Number($('cpaUCustomer').value):null};
  let error;
  if(id){({error}=await sb.schema('cust').from('units').update(row).eq('id',id));}
  else{row.created_by=state.email;({error}=await sb.schema('cust').from('units').insert(row));}
  if(error){toast('Save failed: '+error.message,'err');return;}
  closeModal();toast('Unit saved','ok');route();
};
/* ---------- Tab 2: Customers ---------- */
// A customer's project is not a column on the customer - it comes from the unit(s) they hold, and a
// customer can legitimately hold units in more than one project. So both are derived per row rather
// than stored, and the project filter asks "does this customer hold a unit HERE".
let CPA_CUST_FILTER={proj:'',block:'',q:''};
/* Block = the unit's tower ("BLOCK B", "BLOCK-1"). Two projects can both have a "BLOCK A", so a block
   is always kept together with its project: the option value is "<projectId>|<tower>", and with no
   project picked the blocks are grouped under each project's name. */
function cpaCustBlockKey(u){ return u.project_id+'|'+(u.tower||''); }
function cpaCustBlockOpts(proj){
  if(proj==='none') return '<option value="">All blocks</option>';
  const natural=(a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});
  const byProj={};
  (CPA.units||[]).forEach(u=>{
    if(!u.tower||!u.customer_id||u.status==='cancelled')return;
    if(proj&&String(u.project_id)!==proj)return;
    (byProj[u.project_id]=byProj[u.project_id]||new Set()).add(u.tower);
  });
  const opt=(pid,t)=>`<option value="${esc(pid+'|'+t)}">${esc(t)}</option>`;
  const projects=(CPA.projects||[]).filter(p=>byProj[p.id]);
  const body=proj
    ?[...(byProj[proj]||[])].sort(natural).map(t=>opt(proj,t)).join('')
    :projects.map(p=>`<optgroup label="${esc(projShortName(p.name))}">${[...byProj[p.id]].sort(natural).map(t=>opt(p.id,t)).join('')}</optgroup>`).join('');
  return '<option value="">All blocks</option>'+body;
}
async function cpaRenderCustomers(host){
  const [customers,,projects,rulesRes,invRes]=await Promise.all([cpaCustomers(true),cpaUnits(true),cpaProjects(true),
    sb.schema('cust').from('feature_access').select('*'),
    sb.schema('cust').from('portal_invites').select('customer_id,status,error,sent_at,sent_by').order('sent_at',{ascending:false}).limit(5000)]);
  CPA.featureRules=(rulesRes&&rulesRes.data)||[];
  CPA.invites=(invRes&&invRes.data)||[];
  const projOpts=projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  host.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap"><div class="sec-title" style="margin:0">Customers</div>
    <span style="display:inline-flex;gap:8px"><button class="btn" onclick="cpaInviteModal()" title="Email the customers shown below an invitation to sign in to the portal"><i class="fa-solid fa-paper-plane"></i> Send invitation</button>
    <button class="btn btn-primary" onclick="cpaCustomerModal()"><i class="fa-solid fa-plus"></i> New customer</button></span></div>
    <div class="mu-filters">
      <select id="cpaCustProj" class="mu-sel" onchange="cpaCustFilter(true)" style="max-width:320px"><option value="">All projects</option>${projOpts}<option value="none">— Cancelled / no unit (hidden by default) —</option></select>
      <select id="cpaCustBlock" class="mu-sel" onchange="cpaCustFilter()" style="max-width:200px" title="Customers holding a flat in this block">${cpaCustBlockOpts(CPA_CUST_FILTER.proj)}</select>
      <span class="mu-sw"><i class="fa-solid fa-magnifying-glass"></i><input id="cpaCustQ" placeholder="Search name, email, phone or unit code" oninput="cpaCustFilter()"></span>
      <span class="mu-count" id="cpaCustCount"></span>
    </div>
    <div id="cpaCustList"></div>`;
  if(CPA_CUST_FILTER.proj)$('cpaCustProj').value=CPA_CUST_FILTER.proj;
  if(CPA_CUST_FILTER.block){ $('cpaCustBlock').value=CPA_CUST_FILTER.block; if($('cpaCustBlock').value!==CPA_CUST_FILTER.block)CPA_CUST_FILTER.block=''; }
  if(CPA_CUST_FILTER.q)$('cpaCustQ').value=CPA_CUST_FILTER.q;
  $('cpaCustBlock').disabled=CPA_CUST_FILTER.proj==='none';
  cpaCustList();
}
window.cpaCustFilter=function(projChanged){
  CPA_CUST_FILTER.proj=$('cpaCustProj').value;
  const sel=$('cpaCustBlock');
  if(projChanged){
    // A new project brings its own blocks; keep the chosen one only if it belongs to that project.
    const keep=CPA_CUST_FILTER.block;
    sel.innerHTML=cpaCustBlockOpts(CPA_CUST_FILTER.proj);
    sel.value=keep; if(sel.value!==keep)sel.value='';
    sel.disabled=CPA_CUST_FILTER.proj==='none';
  }
  CPA_CUST_FILTER.block=sel.value;
  CPA_CUST_FILTER.q=$('cpaCustQ').value.trim().toLowerCase();
  cpaCustList();
};
// Farvision project names carry a location suffix - "DREAM GURUKUL(DOLTALA MADHYAMGRAM)" - which
// wrapped to three lines in a table cell and made every row triple height. Show the name itself and
// keep the full string on hover, since the suffix is what distinguishes two same-named projects.
function projShortName(name){
  const s=String(name||''),i=s.indexOf('(');
  return i>0?s.slice(0,i).trim():s;
}
function cpaProjectChip(name){
  return '<span title="'+esc(name||'')+'" style="white-space:nowrap">'+esc(projShortName(name))+'</span>';
}
function cpaCustUnitsByCustomer(){
  const by={};(CPA.units||[]).forEach(u=>{if(u.customer_id)(by[u.customer_id]=by[u.customer_id]||[]).push(u);});
  return by;
}
// The customers the current filters show - the list below, and exactly who "Send invitation" emails.
function cpaCustFiltered(){
  const all=CPA.customers||[],byCustomer=cpaCustUnitsByCustomer(),{proj,block,q}=CPA_CUST_FILTER;
  /* A customer with no unit holds no flat with us - a cancelled booking (Sales Details imports only
     Active rows, so cancellation leaves the customer behind without one) or a duplicate record left
     by an email that differed between exports. Neither belongs in the working list, so the default
     view is customers who actually hold a unit. "Without a unit" still reaches them. */
  const customers=proj==='none'?all:all.filter(c=>(byCustomer[c.id]||[]).length>0);
  const list=customers.filter(c=>{
    const mine=byCustomer[c.id]||[];
    if(proj==='none'){if(mine.length)return false;}
    else if(proj&&!mine.some(u=>String(u.project_id)===proj))return false;
    // A flat they have cancelled does not put them in that block.
    if(block&&proj!=='none'&&!mine.some(u=>u.status!=='cancelled'&&cpaCustBlockKey(u)===block))return false;
    if(q&&![c.full_name,c.email,c.phone].concat(mine.map(u=>u.unit_code)).join(' ').toLowerCase().includes(q))return false;
    return true;
  });
  return {customers,list,byCustomer};
}
// Sign-in is the 'login' row of Customer Features, per project and block.
function cpaCustCanSignIn(mine){
  return mine.some(u=>u.status!=='cancelled'&&custFeatureOn(CPA.featureRules,'login',u.project_id,u.tower));
}
// Latest invitation per customer (cust.portal_invites), newest first.
function cpaCustLastInvite(id){ return (CPA.invites||[]).find(r=>r.customer_id===id)||null; }
function cpaCustList(){
  const {customers,list,byCustomer}=cpaCustFiltered();
  const rows=list.map(c=>{
    const mine=byCustomer[c.id]||[];
    const projNames=[...new Set(mine.map(u=>(u.projects&&u.projects.name)||'').filter(Boolean))];
    // Customers sign in with an emailed code (customer-invite edge function), so there is nothing for staff to create:
    // this only says whether they can, whether they have been invited, and whether they have signed in.
    const canSignIn=cpaCustCanSignIn(mine);
    const inv=cpaCustLastInvite(c.id);
    const loginTag=c.auth_user_id&&canSignIn?'<span class="tag t-green" title="Has signed in with an email code">Signed in</span>'
      :canSignIn&&inv&&inv.status==='sent'?`<span class="tag t-amber" style="white-space:nowrap" title="Invitation emailed ${esc(fmtDate(inv.sent_at))} by ${esc(inv.sent_by||'')} - not signed in yet">Invited ${esc(fmtDateShort(inv.sent_at))}</span>`
      :canSignIn&&inv&&inv.status==='failed'?`<span class="tag t-red" title="${esc(inv.error||'')}">Invite failed</span>`
      :canSignIn?'<span class="tag t-blue" title="Can sign in with an email code - nothing to set up">Ready</span>'
      :'<span class="tag t-gray" title="Customer sign-in is off for this flat\'s project or block (Customer Features tab)">Not live</span>';
    return [`<span style="white-space:nowrap">${esc(c.full_name)}</span>`,
      projNames.length?projNames.map(cpaProjectChip).join(' '):'<span class="tag t-amber">No unit</span>',
      mine.length?`<span style="white-space:nowrap">${mine.map(u=>esc(u.unit_code)+(u.tower?' <span style="color:var(--slate)">('+esc(u.tower)+')</span>':'')).join(', ')}</span>`:'—',
      esc(c.email),`<span style="white-space:nowrap">${esc(c.phone||'—')}</span>`,
      loginTag,
      `<span style="display:inline-flex;gap:6px;white-space:nowrap">`+
      `<button class="btn btn-sm" title="Edit customer" onclick="cpaCustomerModal(${c.id})"><i class="fa-solid fa-pen"></i></button>`+
      `<button class="btn btn-sm" onclick="window.open('customer.html?as=${c.id}','_blank')" title="See exactly what this customer sees, without needing a customer login"><i class="fa-solid fa-eye"></i></button>`+
      `</span>`];
  });
  const cnt=$('cpaCustCount');if(cnt)cnt.textContent=list.length+' of '+customers.length;
  $('cpaCustList').innerHTML=cpaTable(['Name','Project','Unit','Email','Phone','Login','Actions'],
    rows.length?rows:[['No customers match this filter','','','','','','']]);
}
/* "Send invitation": emails the customers the filters currently show a "your portal is open - here is
   how to sign in" email from customercare1@thejaingroup.com (customer-invite edge function, action
   'invite'). Only customers who can actually sign in are sent it; anyone already invited or already
   signed in is left out unless staff tick them back in. Sent in small batches so one slow reply from
   Gmail cannot time the whole run out, and each email is recorded in cust.portal_invites. */
const CPA_INVITE_HELP_KEY='cpa_invite_help';
// Completes "If you have any trouble signing in, …" in the invitation (staff can change it per send).
const CPA_INVITE_HELP_DEFAULT='please contact your relationship manager at 84205 41541 or customercare1@thejaingroup.com';
function cpaInvitePlan(resend,includeSignedIn){
  const {list,byCustomer}=cpaCustFiltered();
  const send=[],skip={off:[],invited:[],signed:[]};
  list.forEach(c=>{
    const mine=byCustomer[c.id]||[];
    if(!cpaCustCanSignIn(mine)){skip.off.push(c);return;}
    if(c.auth_user_id&&!includeSignedIn){skip.signed.push(c);return;}
    const inv=cpaCustLastInvite(c.id);
    if(inv&&inv.status==='sent'&&!resend){skip.invited.push(c);return;}
    send.push(c);
  });
  return {list,send,skip};
}
function cpaInviteScope(){
  const {proj,block,q}=CPA_CUST_FILTER;
  const p=(CPA.projects||[]).find(x=>String(x.id)===proj);
  const parts=[p?projShortName(p.name):'All projects'];
  if(block)parts.push(block.split('|').slice(1).join('|'));
  if(q)parts.push('matching "'+q+'"');
  return parts.join(' · ');
}
window.cpaInviteModal=function(){
  let help='';try{help=localStorage.getItem(CPA_INVITE_HELP_KEY)||'';}catch(e){}
  if(!help)help=CPA_INVITE_HELP_DEFAULT;
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-paper-plane"></i> Send portal invitation</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm" id="cpaInvBody">
      <div style="font-size:13px;color:var(--slate);margin:-4px 0 10px">Customers shown: <b style="color:var(--ink)">${esc(cpaInviteScope())}</b>. Change the filters on the Customers list to pick a different group.</div>
      <div id="cpaInvSummary"></div>
      <label style="display:flex;gap:8px;align-items:center;font-weight:500;margin-top:10px"><input type="checkbox" id="cpaInvResend" onchange="cpaInviteRefresh()" style="width:auto"> Also send to customers invited before</label>
      <label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="cpaInvSigned" onchange="cpaInviteRefresh()" style="width:auto"> Also send to customers who have already signed in</label>
      <label style="margin-top:12px">"If you have any trouble signing in, …"</label>
      <input id="cpaInvHelp" maxlength="200" value="${esc(help)}" placeholder="${esc(CPA_INVITE_HELP_DEFAULT)}">
      <div style="font-size:12px;color:var(--slate);margin-top:-6px">Finishes that sentence in the email. Leave empty to use: ${esc(CPA_INVITE_HELP_DEFAULT)}.</div>
      <div style="margin-top:14px;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:#f8fafc;font-size:13px;line-height:1.55">
        <div><b>From:</b> Jain Group Customer Care &lt;customercare1@thejaingroup.com&gt;</div>
        <div><b>Subject:</b> Your Dream Gurukul home is now online – Jain Group Customer Portal</div>
        <div style="color:var(--slate);margin-top:4px">Each customer gets their own email with their name and the email address they sign in with, the four sections they can see, the three sign-in steps and a button to the portal.</div>
      </div>
      <div id="cpaInvProgress" style="margin-top:12px"></div>
    </div>
    <div class="modal-foot" id="cpaInvFoot"><button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn" id="cpaInvTestBtn" onclick="cpaInviteTest()"><i class="fa-solid fa-flask"></i> Send a test to me</button>
      <button class="btn btn-primary" id="cpaInvSendBtn" onclick="cpaInviteSend()"><i class="fa-solid fa-paper-plane"></i> Send</button></div>`);
  cpaInviteRefresh();
};
window.cpaInviteRefresh=function(){
  const plan=cpaInvitePlan($('cpaInvResend').checked,$('cpaInvSigned').checked);
  const names=a=>a.slice(0,6).map(c=>esc(custFirstName(c.full_name)||c.full_name)).join(', ')+(a.length>6?' and '+(a.length-6)+' more':'');
  const line=(n,txt,who)=>n?`<li style="margin:2px 0">${n} ${txt}${who?' <span style="color:var(--slate)">('+who+')</span>':''}</li>`:'';
  // Which blocks those emails land in, so a send meant for one block cannot quietly go to a whole
  // project (30 Sep: the list was left on "All projects" and the window offered all 89 in Gurukul).
  const byCust=cpaCustUnitsByCustomer(),perBlock={};
  plan.send.forEach(c=>{
    const blocks=new Set((byCust[c.id]||[]).filter(u=>u.status!=='cancelled'&&custFeatureOn(CPA.featureRules,'login',u.project_id,u.tower))
      .map(u=>projShortName(((CPA.projects||[]).find(p=>p.id===u.project_id)||{}).name||'')+' '+(u.tower||'')));
    blocks.forEach(b=>{perBlock[b]=(perBlock[b]||0)+1;});
  });
  const natural=(a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});
  const blockKeys=Object.keys(perBlock).sort(natural);
  const breakdown=blockKeys.length?`<div style="font-size:12.5px;color:var(--slate);margin-top:4px">${blockKeys.map(k=>esc(k)+': <b style="color:var(--ink)">'+perBlock[k]+'</b>').join(' · ')}</div>`:'';
  const wide=blockKeys.length>1&&!CPA_CUST_FILTER.block;
  const warn=wide?`<div style="margin-top:8px;padding:9px 12px;border-radius:9px;background:#fffbeb;border:1px solid #f0dfa8;color:#92400e;font-size:13px"><i class="fa-solid fa-triangle-exclamation"></i> This goes to <b>${blockKeys.length} blocks</b>. To invite one block only, close this, pick the project and block in the Customers filters, and open Send invitation again.</div>`:'';
  $('cpaInvSummary').innerHTML=`<div style="font-size:15px"><b style="font-size:22px;color:#1d4ed8">${plan.send.length}</b> customer${plan.send.length===1?'':'s'} will be emailed</div>`+breakdown+warn+
    `<ul style="margin:6px 0 0 18px;padding:0;font-size:13px;color:var(--ink)">`+
    line(plan.skip.invited.length,'left out — already invited',names(plan.skip.invited))+
    line(plan.skip.signed.length,'left out — already signed in',names(plan.skip.signed))+
    line(plan.skip.off.length,'left out — sign-in is off for their flat (Customer Features)','')+
    `</ul>`;
  const b=$('cpaInvSendBtn');b.disabled=!plan.send.length;
  b.dataset.armed='';b.classList.remove('btn-danger-solid');b.classList.add('btn-primary');
  b.innerHTML='<i class="fa-solid fa-paper-plane"></i> Send to '+plan.send.length;
};
async function cpaInviteCall(body){
  const {data:{session}}=await sb.auth.getSession();
  const res=await fetch(SUPABASE_URL+'/functions/v1/customer-invite',{method:'POST',
    headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+((session&&session.access_token)||'')},
    body:JSON.stringify(body)});
  const out=await res.json().catch(()=>({}));
  if(!res.ok||out.error)throw new Error(out.error||('HTTP '+res.status));
  return out;
}
function cpaInviteHelp(){
  const v=$('cpaInvHelp').value.trim().replace(/[.\s]+$/,'')||CPA_INVITE_HELP_DEFAULT;
  try{localStorage.setItem(CPA_INVITE_HELP_KEY,v);}catch(e){}
  return v;
}
window.cpaInviteTest=async function(){
  const b=$('cpaInvTestBtn');b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Sending…';
  try{ const out=await cpaInviteCall({action:'invite_test',helpLine:cpaInviteHelp()}); toast('Test sent to '+(out.to||'you')+' — check your inbox','ok'); }
  catch(e){ toast('Test not sent: '+e.message,'err'); }
  b.disabled=false;b.innerHTML='<i class="fa-solid fa-flask"></i> Send a test to me';
};
window.cpaInviteSend=async function(){
  const plan=cpaInvitePlan($('cpaInvResend').checked,$('cpaInvSigned').checked);
  if(!plan.send.length)return;
  // Two clicks, inside this window: the first asks, the second sends. (confirmDialog would replace
  // this window, and with it the progress bar.)
  const sendBtn=$('cpaInvSendBtn');
  if(!sendBtn.dataset.armed){
    sendBtn.dataset.armed='1';sendBtn.classList.remove('btn-primary');sendBtn.classList.add('btn-danger-solid');
    sendBtn.innerHTML='<i class="fa-solid fa-triangle-exclamation"></i> Yes, email '+plan.send.length+' customer'+(plan.send.length===1?'':'s')+' now';
    return;
  }
  const helpLine=cpaInviteHelp();
  ['cpaInvSendBtn','cpaInvTestBtn','cpaInvResend','cpaInvSigned','cpaInvHelp'].forEach(id=>{const b=$(id);if(b)b.disabled=true;});
  const prog=$('cpaInvProgress');
  const tally={sent:0,failed:0,skipped:0},fails=[];
  const draw=done=>{ const pct=Math.round(done/plan.send.length*100);
    prog.innerHTML=`<div style="height:8px;border-radius:6px;background:#e5e9f0;overflow:hidden"><div style="height:100%;width:${pct}%;background:#1d4ed8;transition:width .3s"></div></div>
      <div style="font-size:13px;margin-top:6px">${done} of ${plan.send.length} — <b style="color:#15803d">${tally.sent} sent</b>${tally.failed?` · <b style="color:#b91c1c">${tally.failed} failed</b>`:''}${tally.skipped?` · ${tally.skipped} skipped`:''}</div>`; };
  draw(0);
  const ids=plan.send.map(c=>c.id);let stopped='';
  for(let i=0;i<ids.length;i+=10){
    const batch=ids.slice(i,i+10);
    try{
      const out=await cpaInviteCall({action:'invite',customerIds:batch,resend:$('cpaInvResend').checked,helpLine});
      (out.results||[]).forEach(r=>{ tally[r.status]=(tally[r.status]||0)+1; if(r.status==='failed')fails.push(r.reason); });
      // The function stops early when Gmail refuses (bad login, sending limit): stop here too.
      if((out.results||[]).length<batch.length&&fails.length){stopped=fails[fails.length-1];}
    }catch(e){ stopped=e.message; }
    draw(Math.min(i+batch.length,ids.length));
    if(stopped)break;
  }
  if(stopped) prog.insertAdjacentHTML('beforeend',`<div style="margin-top:8px;color:#b91c1c;font-size:13px"><i class="fa-solid fa-circle-exclamation"></i> Stopped: ${esc(stopped)}</div>`);
  $('cpaInvFoot').innerHTML='<button class="btn btn-primary" onclick="closeModal();route()">Done</button>';
  toast(tally.sent+' invitation'+(tally.sent===1?'':'s')+' sent'+(tally.failed?', '+tally.failed+' failed':''),tally.failed||stopped?'warn':'ok');
};
window.cpaCustomerModal=function(id){
  const c=id?(CPA.customers||[]).find(x=>x.id===id):null;
  openModal(`<div class="modal-head"><h3>${c?'Edit customer':'New customer'}</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm"><label>Full name</label><input id="cpaCName" value="${c?esc(c.full_name):''}">
    <label>Email</label><input id="cpaCEmail" value="${c?esc(c.email):''}" ${c&&c.auth_user_id?'disabled':''}>
    ${c&&c.auth_user_id?'<div style="font-size:12px;color:var(--slate);margin-top:-8px">Email is locked once the customer has signed in.</div>':''}
    <label>Phone</label><input id="cpaCPhone" value="${c?esc(c.phone||''):''}"></div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="cpaCustomerSave(${c?c.id:'null'})">Save</button></div>`);
};
window.cpaCustomerSave=async function(id){
  const full_name=$('cpaCName').value.trim();const phone=$('cpaCPhone').value.trim()||null;
  let error;
  if(id){({error}=await sb.schema('cust').from('customers').update({full_name,phone}).eq('id',id));}
  else{
    const email=$('cpaCEmail').value.trim();
    if(!full_name||!email){toast('Name and email are required','err');return;}
    ({error}=await sb.schema('cust').from('customers').insert({full_name,email,phone,created_by:state.email}));
  }
  if(error){toast('Save failed: '+error.message,'err');return;}
  closeModal();toast('Customer saved','ok');route();
};

/* ---------- Tab 3: Farvision Import ---------- */
// ---- Real Farvision .xlsx parsing (Sales Details / Outstanding / Invoice & Receipt Register) ----
// These four are read straight from the .xlsx via SheetJS, not converted to CSV first: every real
// export has a several-row title/metadata block before the actual header row, and Sales Details
// additionally uses a 3-tier merged header for its cost-sheet columns (Charge Type -> Basic/Tax ->
// component name) - none of that survives a CSV round-trip. maintenance_bills/maintenance_receipts
// still use the older generic CSV path below (no real maintenance export has been reconciled yet).
/* ==FARVISION-PARSERS-START== (9 Oct 2026)
   Everything between this line and FARVISION-PARSERS-END is also run, unchanged, by the automatic
   daily import (tools/farvision-auto-import.mjs on GitHub Actions), so a fix to a parser here is a
   fix to both. Keep it self-contained: only XLSX (and window.XLSX) may be used inside. */
function xlsxSheetRows(wb){ const ws=wb.Sheets[wb.SheetNames[0]]; return {ws,rows:XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null})}; }
function xlsxFindHeaderRow(rows,mustContain){ for(let r=0;r<rows.length;r++){ const row=rows[r]||[]; if(row.some(v=>typeof v==='string'&&v.trim()===mustContain)) return r; } return -1; }
function xlsxMergedLabel(ws,rows,r,c){
  const direct=rows[r]&&rows[r][c]; if(direct!=null&&direct!=='') return direct;
  const merges=ws['!merges']||[];
  for(const m of merges){ if(r>=m.s.r&&r<=m.e.r&&c>=m.s.c&&c<=m.e.c){ const a=rows[m.s.r]&&rows[m.s.r][m.s.c]; return a!=null?a:null; } }
  return direct;
}
// A Date cell is read off its LOCAL calendar day, nudged half a minute forward first - never via
// toISOString(). The reader builds a cell's Date at local midnight minus a few seconds, so in India
// the UTC string is the previous day: every invoice, receipt and transfer the Gmail queue imported
// was landing one day early (Farvision 14 Jul, portal 13 Jul). Same trap as misCellDate above.
function xlsxExcelDate(v){
  if(v==null||v==='') return null;
  if(v instanceof Date){ if(isNaN(v)) return null; const t=new Date(v.getTime()+30000);
    return t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0'); }
  if(typeof v==='number'){ const d=window.XLSX&&XLSX.SSF&&XLSX.SSF.parse_date_code(v); if(d) return d.y+'-'+String(d.m).padStart(2,'0')+'-'+String(d.d).padStart(2,'0'); }
  if(typeof v==='string'){ const d=new Date(v); if(!isNaN(d)) return d.toISOString().slice(0,10); }
  return null;
}
function xlsxHeaderIndex(row){ const idx={}; (row||[]).forEach((h,i)=>{ if(h!=null) idx[String(h).trim()]=i; }); return idx; }

function cpaParseSalesDetails(wb){
  const {ws,rows}=xlsxSheetRows(wb);
  const hr=xlsxFindHeaderRow(rows,'Payment Plan');
  if(hr<0) throw new Error('Could not find the header row (no "Payment Plan" column) — is this really a Sales Details export?');
  const headers=rows[hr], idx=xlsxHeaderIndex(headers);
  const need=['Business Unit','Status','Application No','Booking No','Customer Name','Unit Code','Level3','MobileNo','Email Id','Correspondence Address','Booking Date','Agreement Date','Total Basic','Total Tax'];
  const missing=need.filter(h=>!(h in idx));
  if(missing.length) throw new Error('Missing column(s): '+missing.join(', '));
  const totalBasicCol=idx['Total Basic'], componentRow=hr-1, basicTaxRow=hr-2;
  const out=[];
  for(let r=hr+1;r<rows.length;r++){
    const row=rows[r]; if(!row||row[idx['Business Unit']]==null||row[idx['Application No']]==null) continue;
    if(String(row[idx['Status']]||'').trim()==='Cancel') continue; // Skip cancelled customers
    const get=h=>(idx[h]!=null?row[idx[h]]:null);
    const rec={businessUnit:get('Business Unit'),status:get('Status'),applicationNo:String(get('Application No')),
      bookingNo:get('Booking No')!=null?String(get('Booking No')):null,customerName:get('Customer Name'),
      typology:get('Typology'),unitCode:get('Unit Code'),tower:get('Level3'),floor:get('Floor'),
      mobile:get('MobileNo'),email:get('Email Id'),address:get('Correspondence Address'),
      bookingDate:xlsxExcelDate(get('Booking Date')),agreementDate:xlsxExcelDate(get('Agreement Date')),
      superBuiltUp:get('Super Built-Up'),builtUp:get('Built-Up'),carpet:get('Carpet'),
      totalBasic:Number(get('Total Basic')||0),totalTax:Number(get('Total Tax')||0),costItems:[]};
    const seen={};
    for(let c=totalBasicCol+2;c<headers.length;c++){
      const metric=String(headers[c]||'').trim();
      // Each component carries a BASIC tier and (for a few, e.g. Unit Cost) a TAX tier, each with
      // its own Basic/Bill/Received/Balance/Onaccount Amount columns. amount/taxAmount come from
      // the two tiers' "Basic Amount" metric; bill/received/balance/onaccount are summed GROSS
      // across both tiers - a customer-facing statement wants what was billed/received/still-due
      // for the whole charge line, not split by its own internal tax portion.
      const field=metric==='Basic  Amount'||metric==='Basic Amount'?'amount'
        :metric==='Bill Amount'?'bill':metric==='Received Amount'?'received'
        :metric==='Balance Amount'?'balance':metric==='Onaccount Amount'?'onaccount':null;
      if(!field) continue;
      const component=xlsxMergedLabel(ws,rows,componentRow,c);
      const basicTax=xlsxMergedLabel(ws,rows,basicTaxRow,c);
      if(!component) continue;
      const key=component+'|'+basicTax+'|'+field; if(seen[key]) continue; seen[key]=true; // dedupes a header quirk where "Unit Cost" is labelled twice
      const val=row[c]; if(val==null||val==='') continue;
      const cleanName=String(component).replace(/^\d+\.\s*/,'').trim();
      let bucket=rec.costItems.find(i=>i.component===cleanName);
      if(!bucket){ bucket={component:cleanName,basicAmount:0,taxAmount:0,billAmount:0,receivedAmount:0,balanceAmount:0,onaccountAmount:0}; rec.costItems.push(bucket); }
      if(field==='amount'){ if(basicTax==='BASIC') bucket.basicAmount=Number(val); else bucket.taxAmount=Number(val); }
      else if(field==='bill') bucket.billAmount+=Number(val);
      else if(field==='received') bucket.receivedAmount+=Number(val);
      else if(field==='balance') bucket.balanceAmount+=Number(val);
      else if(field==='onaccount') bucket.onaccountAmount+=Number(val);
    }
    out.push(rec);
  }
  return out;
}
function cpaParseFlatSheet(wb,anchorHeader,requiredCols){
  const {rows}=xlsxSheetRows(wb);
  const hr=xlsxFindHeaderRow(rows,anchorHeader);
  if(hr<0) throw new Error('Could not find the header row (no "'+anchorHeader+'" column) — is this the right report?');
  const headers=rows[hr], idx=xlsxHeaderIndex(headers);
  const missing=requiredCols.filter(c=>!(c in idx));
  if(missing.length) throw new Error('Missing column(s): '+missing.join(', '));
  const out=[];
  for(let r=hr+1;r<rows.length;r++){
    const row=rows[r]; if(!row||row[idx[requiredCols[0]]]==null) continue;
    out.push(h=>(idx[h]!=null?row[idx[h]]:null));
  }
  return out;
}
function cpaParseOutstanding(wb){
  return cpaParseFlatSheet(wb,'Net Outstanding',['Booking No.','Customer Name','Unit No.','Customer Status','Net Outstanding']).map(get=>({
    businessUnit:get('Business Unit'),bookingNo:get('Booking No.')!=null?String(get('Booking No.')):null,
    customerName:get('Customer Name'),unitCode:get('Unit No.'),tower:get('Level3'),status:get('Customer Status'),
    totalConsideration:get('Total Consideration'),billOutstanding:get('Bill Outstanding'),onAccount:get('On Account'),
    netOutstanding:get('Net Outstanding'),lateFee:get('Late Payment Fee Accrued As on Date'),
    noOfBills:get('No. Of Bills')!=null?Number(get('No. Of Bills')):null,
  }));
}
function cpaParseInvoiceRegister(wb){
  return cpaParseFlatSheet(wb,'Schedule Description',['Document No','Booking No','Business Unit']).map(get=>({
    businessUnit:get('Business Unit'),docNo:String(get('Document No')),docDate:xlsxExcelDate(get('Document Date')),
    bookingNo:get('Booking No')!=null?String(get('Booking No')):null,customerName:get('Customer Name'),
    unitCode:get('Unit'),tower:get('Hierarchy Level 3'),dueDate:xlsxExcelDate(get('Due Date')),
    schedule:get('Schedule Description'),revenueHead:get('RevenueHead Description'),
    amount:Number(get('Amount')||0),tax:Number(get('Tax')||0),netAmount:Number(get('Net Amount')||0),status:get('Status'),
  }));
}
function cpaParseReceiptRegister(wb){
  return cpaParseFlatSheet(wb,'Money Receipt No',['Money Receipt No','Booking No','Business Unit']).map(get=>({
    businessUnit:get('Business Unit'),receiptNo:String(get('Money Receipt No')),receiptDate:xlsxExcelDate(get('Money Receipt Date')),
    bookingNo:get('Booking No')!=null?String(get('Booking No')):null,customerName:get('Customer Name'),
    unitCode:get('Unit No'),tower:get('Level3'),invoiceNo:get('Invoice No')!=null?String(get('Invoice No')):null,
    schedule:get('Schedule'),revenueHead:get('Revenue Head'),amount:Number(get('Amount')||0),
    mode:get('PaymentMode'),isReversed:get('Is Reversed'),unitStatus:get('Unit Status'),
    // The instrument block of the printed Money Receipt (27 Oct 2026). These columns were always in
    // the export but were never read, so every receipt imported since the Gmail queue started showed
    // "—" for Drawn On / Instn. No. / Instn. Date. Farvision pads some bank names with a no-break
    // space ("YES BANK\u00a0"), so text is trimmed of it.
    instrumentNo:xlsxText(get('Instrument No')),instrumentDate:xlsxExcelDate(get('Instrument Date')),
    drawnOn:xlsxText(get('Drawn On')),drawnOnBranch:xlsxText(get('Drawn On Branch')),
    depositBank:xlsxText(get('Deposit Bank/Debit Ledger')),narration:xlsxText(get('Narration')),
  }));
}
function xlsxText(v){ if(v==null) return null; const s=String(v).replace(/\u00a0/g,' ').trim(); return s||null; }
function cpaParseReceiptReversal(wb){
  return cpaParseFlatSheet(wb,'Receipt Reversal No',['Receipt Reversal No','Booking No','Business Unit']).map(get=>({
    businessUnit:get('Business Unit'),reversalNo:String(get('Receipt Reversal No')),
    reversalDate:xlsxExcelDate(get('Receipt Reversal Date')),
    receiptNo:get('Receipt No')!=null?String(get('Receipt No')):null,
    receiptDate:xlsxExcelDate(get('Receipt Date')),
    bookingNo:get('Booking No')!=null?String(get('Booking No')):null,
    instrumentNo:get('Instrument No'),instrumentDate:xlsxExcelDate(get('Instrument Date')),
    reversalAmount:Number(get('Reversal Amount')||0),totalReversalAmount:Number(get('Total Reversal Amount')||0),
    narration:get('Narration'),bankDescription:get('Bank Description'),reason:get('Reason'),
  }));
}
// Farvision's Booking Register Summary names these columns "Booking Status", "Unit" and "Document
// Date". This used to read "Status", "Unit Code" and "Booking Date", which the report does not have,
// so every row came back with no status and a booking cancelled or transferred in Farvision (Arup
// Bhawal's D/8G -> D/8H, 26.09.2026) stayed live in the portal. "Booking Status" is now required, so
// a renamed column stops the import instead of quietly reading nothing.
function cpaParseBookingRegister(wb){
  return cpaParseFlatSheet(wb,'Booking Id',['Booking Id','Business Unit','Booking Status']).map(get=>({
    businessUnit:get('Business Unit'),bookingId:get('Booking Id'),
    bookingNo:get('Booking No')!=null?String(get('Booking No')):null,
    customerName:get('Customer Name'),status:String(get('Booking Status')||'').trim()||null,
    unitCode:get('Unit')!=null?String(get('Unit')):null,tower:get('Level3'),
    bookingDate:xlsxExcelDate(get('Document Date')),
  }));
}
// Farvision's PTC (Payment To Customer) register - booking transfers and refunds. Filed under the
// SOURCE booking; a transfer additionally names "Booking No. of Transferee", the unit the money
// actually lands on. A refund is just a row with no transferee - the money left the business rather
// than another unit. No narration parsing needed: both cases resolve the same way at import time
// (debit source if it resolves, credit transferee if it resolves).
function cpaParsePTC(wb){
  return cpaParseFlatSheet(wb,'PTC Created By',['Document No','Booking No','Business Unit']).map(get=>({
    businessUnit:get('Business Unit'),documentNo:String(get('Document No')),
    documentDate:xlsxExcelDate(get('Document Date')),
    sourceBookingNo:get('Booking No')!=null?String(get('Booking No')):null,
    transfereeBookingNo:get('Booking No. of Transferee')!=null?String(get('Booking No. of Transferee')):null,
    amount:Number(get('Amount')||0),narration:get('Narration'),
    isReversed:String(get('Is Reversed')||'').trim().toUpperCase()==='YES',
  }));
}
// Which of the seven reports a workbook is, from its header row. Most specific first - Booking
// Register has "Payment Plan" too, so "Booking Id" is checked before "Payment Plan".
function cpaDetectReportType(wb){
  const {rows}=xlsxSheetRows(wb);
  for(let r=0;r<Math.min(rows.length,20);r++){
    const vals=(rows[r]||[]).map(v=>typeof v==='string'?v.trim():'');
    if(vals.includes('Receipt Reversal No')) return 'receipt_reversal';
    if(vals.includes('Money Receipt No')&&vals.includes('Drawn On')) return 'receipt_register';
    if(vals.includes('Schedule Description')&&vals.includes('RevenueHead Description')) return 'invoice_register';
    if(vals.includes('Net Outstanding')&&vals.includes('Bill Outstanding')) return 'outstanding';
    if(vals.includes('Booking Id')&&!vals.includes('Total Basic')) return 'booking_register';
    if(vals.includes('PTC Created By')) return 'ptc_transfer';
    if(vals.includes('Payment Plan')&&vals.includes('Total Basic')) return 'sales_details';
  }
  return null;
}
function cpaParseByType(type,wb){
  if(type==='sales_details') return cpaParseSalesDetails(wb);
  if(type==='outstanding') return cpaParseOutstanding(wb);
  if(type==='invoice_register') return cpaParseInvoiceRegister(wb);
  if(type==='receipt_register') return cpaParseReceiptRegister(wb);
  if(type==='receipt_reversal') return cpaParseReceiptReversal(wb);
  if(type==='booking_register') return cpaParseBookingRegister(wb);
  if(type==='ptc_transfer') return cpaParsePTC(wb);
  throw new Error('Type '+type+' not yet supported for auto-import');
}
/* ==FARVISION-PARSERS-END== */
// Booking No is the real join key (unlike unit_code, which repeats across towers). A record that
// carries a Booking No resolves by it or not at all: falling back to (tower, unit code) whenever the
// lookup missed attached every cancelled booking's invoices, receipts and Outstanding row to whoever
// holds that flat now - another buyer's money in the current owner's ledger. The flat-level lookup
// is only for the rare record with no Booking No.
function cpaResolveUnit(units,projectId,bookingNo,tower,unitCode){
  if(bookingNo) return units.find(u=>u.booking_no===bookingNo)||null;
  return cpaResolveFlat(units,projectId,tower,unitCode);
}
function cpaResolveFlat(units,projectId,tower,unitCode){
  if(!projectId||!unitCode) return null;
  const norm=s=>String(s||'').trim().toLowerCase();
  return units.find(u=>u.project_id===projectId&&norm(u.tower)===norm(tower)&&norm(u.unit_code)===norm(unitCode))||null;
}
function cpaResolveProject(projects,businessUnit){
  if(!businessUnit) return null;
  const norm=s=>String(s).trim().toLowerCase();
  const bu=norm(businessUnit);
  // farvision_project_code holds Farvision's own (often ugly, ALL-CAPS) Business Unit string, kept
  // separate from the friendly display name staff pick for cust.projects.name - match that first.
  return projects.find(p=>p.farvision_project_code&&norm(p.farvision_project_code)===bu)
    ||projects.find(p=>norm(p.name)===bu)||null;
}

const CPA_XLSX_IMPORT_TYPES=new Set(['sales_details','outstanding','invoice_register','receipt_register','receipt_reversal','booking_register','ptc_transfer']);
const CPA_IMPORT_COLUMNS={
  maintenance_bills:{required:['unit_code','bill_no','bill_date','amount'],optional:['bill_period','due_date','gst_amount','total_amount','status']},
  maintenance_receipts:{required:['unit_code','receipt_no','receipt_date','amount'],optional:['mode','against_bill_no']}
};
const CPA_IMPORT_LABELS={sales_details:'Sales Details',outstanding:'Outstanding',invoice_register:'Invoice Register (Demand)',receipt_register:'Receipt Register (Receipts)',receipt_reversal:'Receipt Reversal (Cheque Return)',booking_register:'Booking Register',ptc_transfer:'Payment To Customer (Transfers & Refunds)',maintenance_bills:'Maintenance Bills',maintenance_receipts:'Maintenance Receipts',demand:'Demand',receipts:'Money Receipts',contacts:'Contacts & Dates'};
let CPA_IMPORT_STATE=null;
async function cpaRenderImport(host,seg){
  const projects=await cpaProjects();
  if(seg&&seg[1]==='history'){ await cpaRenderImportHistory(host,projects); return; }

  // Gmail queue section
  const {data:queueRows}=await sb.schema('cust').from('import_queue').select('*').eq('status','pending').order('created_at',{ascending:false});
  const queue=queueRows||[];
  let queueHtml='';
  if(queue.length){
    const qRows=queue.map(q=>[
      '<i class="fa-solid fa-file-excel" style="color:#16a34a"></i> '+esc(q.file_name),
      (q.file_size/1024).toFixed(0)+' KB',
      fmtDate(q.created_at),
      esc(q.email_subject||'—'),
      `<button class="btn btn-sm btn-primary" onclick="cpaQueueImport(${q.id})"><i class="fa-solid fa-file-import"></i> Import</button>`+
      ` <button class="btn btn-sm" onclick="cpaQueueDismiss(${q.id})" title="Skip this file"><i class="fa-solid fa-xmark"></i></button>`
    ]);
    queueHtml=`<div class="card card-pad" style="background:#eff6ff;border-color:#bfdbfe;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div><i class="fa-solid fa-envelope-open-text" style="color:var(--brand)"></i> <b>${queue.length} file${queue.length>1?'s':''} from Gmail</b>
        <span style="font-size:12.5px;color:var(--slate);margin-left:8px">Auto-fetched from Farvision email</span></div>
        <button class="btn btn-sm btn-primary" id="cpaAutoImportBtn" onclick="cpaQueueImportAll()"><i class="fa-solid fa-bolt"></i> Import all</button>
      </div>`+cpaTable(['File','Size','Received','Email subject','Action'],qRows)+`</div>`;
  }

  const projOpts=projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  // All six .xlsx reports, not four. Manual upload is the fallback whenever the Gmail fetcher is
  // down - it was missing exactly the two types that could not then be imported by any route.
  const typeOpts=Object.keys(CPA_IMPORT_COLUMNS).concat(['sales_details','outstanding','invoice_register','receipt_register','receipt_reversal','booking_register'])
    .map(k=>`<option value="${k}">${esc(CPA_IMPORT_LABELS[k]||k)}</option>`).join('');
  host.innerHTML=`<div class="tabs" style="margin-bottom:14px"><div class="tab active">Import</div><div class="tab" onclick="navTo('custportal_admin/2/history')">Import History</div></div>
    <div id="cpaAutoCard"></div>
    ${queueHtml}
    <div class="card card-pad frm"><div class="two"><div><label>Import type</label><select id="cpaImpType" onchange="cpaImportTypeChange()">${typeOpts}</select></div>
    <div id="cpaImpProjectWrap"><label>Project (for matching unit codes)</label><select id="cpaImpProject">${projOpts}</select></div></div>
    <label id="cpaImpFileLabel">File</label><input type="file" id="cpaImpFile">
    <div id="cpaImpColsHelp" style="font-size:12px;color:var(--slate);margin-top:6px"></div>
    <div style="margin-top:14px"><button class="btn btn-primary" onclick="cpaImportPreview()"><i class="fa-solid fa-magnifying-glass"></i> Preview</button></div>
    </div><div id="cpaImpPreview" style="margin-top:16px"></div>`;
  window.cpaImportTypeChange();
  // No auto-import on load — user clicks "Import all" when ready
  cpaAutoImportCard();
}
/* AUTOMATIC IMPORT status (9 Oct 2026). What the unattended daily import did today - see
   supabase/migrations/20261009100000_farvision_auto_import.sql. In test mode it applies the day's
   files, compares the result with what is already there (the manual import) and undoes it; in live
   mode it keeps it. Retry / Import anyway are the two decisions it can ask staff for. */
const CPA_AUTO_LABEL={sales_details:'Sales Details',booking_register:'Booking Register',invoice_register:'Invoice Register',
  receipt_register:'Receipt Register',receipt_reversal:'Receipt Reversal',ptc_transfer:'Payment To Customer',outstanding:'Customer Outstanding'};
async function cpaAutoImportCard(){
  const host=$('cpaAutoCard'); if(!host) return;
  const [{data:runs},{data:cfg}]=await Promise.all([
    sb.schema('cust').from('import_runs').select('id,run_date,status,mode,attempts,last_error,summary,applied_at,updated_at').order('run_date',{ascending:false}).limit(1),
    sb.schema('cust').from('import_config').select('mode,alert_after,give_up_after').maybeSingle()]);
  if(!cfg) return;
  const run=(runs||[])[0], sm=(run&&run.summary)||{}, w=sm.waiting||{};
  const live=cfg.mode==='live', test=cfg.mode==='dry_run';
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
  const isToday=run&&run.run_date===today;
  const time=t=>t?new Date(t).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'}):'';
  const list=a=>(a||[]).map(x=>esc(CPA_AUTO_LABEL[x]||x)).join(', ');
  let tone='#eff6ff',bd='#bfdbfe',icon='fa-clock',head='',lines=[],btns='';
  const st=isToday?run.status:'none';
  if(st==='none'){ head='No Farvision files today yet'; lines.push('Files usually arrive at about 10:12.'); }
  else if(st==='collecting'||st==='applying'){
    head='Waiting for the full set of files';
    if(w.files_today!=null) lines.push(w.files_today+' file'+(w.files_today===1?'':'s')+' received so far.');
    if((w.missing||[]).length) lines.push('Not received yet: '+list(w.missing)+'.');
    if((w.not_read||[]).length) lines.push((w.not_read||[]).length+' file'+((w.not_read||[]).length===1?'':'s')+' still to be read by the automatic reader.');
    if((w.unreadable||[]).length){ lines.push('Could not be read: '+(w.unreadable||[]).map(esc).join('; ')); tone='#fffbeb'; bd='#f0dfa8'; }
    if(test&&!(w.missing||[]).length&&!(w.not_read||[]).length) lines.push('Test mode: it runs once your own "Import all" has finished.');
  }else if(st==='applied'){
    tone='#f0fdf4'; bd='#bbf7d0'; icon='fa-circle-check';
    const a=sm.after||{};
    head='Imported automatically at '+time(run.applied_at);
    lines.push((sm.file_count||0)+' files. '+((a.live_units||0)-(a.ledger_mismatch||0))+' of '+(a.live_units||0)+' flats match Farvision.');
  }else if(st==='dry_run_ok'){
    tone='#f0fdf4'; bd='#bbf7d0'; icon='fa-circle-check';
    head='Test run matched your import exactly';
    lines.push('The automatic import read the same '+(sm.file_count||0)+' files and produced exactly the figures already on the portal. Nothing was changed.');
  }else if(st==='dry_run_diff'){
    tone='#fffbeb'; bd='#f0dfa8'; icon='fa-triangle-exclamation';
    head='Test run differs from your import in '+(sm.diff_count||0)+' place'+(sm.diff_count===1?'':'s');
    lines.push('Nothing was changed. First differences: '+(sm.diff||[]).slice(0,8).map(d=>esc((d.tower||'')+' '+(d.unit||'')+' - '+d.part)).join('; ')+'.');
  }else if(st==='needs_approval'){
    tone='#fffbeb'; bd='#f0dfa8'; icon='fa-hand';
    head='Held - nothing was changed';
    (sm.problems||[]).forEach(x=>lines.push(esc(x)));
    if(live) btns='<button class="btn btn-sm btn-primary" onclick="cpaAutoAction('+run.id+',\'force\')"><i class="fa-solid fa-check"></i> Import anyway</button>'
      +' <button class="btn btn-sm" onclick="cpaAutoAction('+run.id+',\'retry\')"><i class="fa-solid fa-rotate"></i> Check again</button>';
  }else if(st==='failed'){
    tone='#fef2f2'; bd='#fecaca'; icon='fa-circle-xmark';
    head='Failed - nothing was changed';
    lines.push(esc(run.last_error||sm.error||'Unknown error')+' (tried '+run.attempts+' time'+(run.attempts===1?'':'s')+')');
    btns='<button class="btn btn-sm btn-primary" onclick="cpaAutoAction('+run.id+',\'retry\')"><i class="fa-solid fa-rotate"></i> Retry</button>';
  }
  if((sm.sales_details_missing||[]).length&&st!=='collecting') lines.push('No Sales Details for: '+(sm.sales_details_missing||[]).map(esc).join(', ')+' - their cost sheets stay as last imported.');
  const modeTag=live?'<span class="tag t-green">Live</span>':test?'<span class="tag t-amber">Test mode - changes nothing</span>':'<span class="tag">Off</span>';
  host.innerHTML='<div class="card card-pad" style="background:'+tone+';border-color:'+bd+';margin-bottom:16px">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">'
    +'<div><i class="fa-solid '+icon+'" style="color:var(--brand)"></i> <b>Automatic import</b> · '+esc(head)+'</div>'+modeTag+'</div>'
    +lines.map(l=>'<div style="font-size:13px;color:var(--slate);margin-top:3px">'+l+'</div>').join('')
    +(btns?'<div style="margin-top:10px">'+btns+'</div>':'')+'</div>';
}
window.cpaAutoAction=async function(runId,action){
  const {error}=await sb.schema('cust').rpc('fv_run_action',{p_run:runId,p_action:action});
  if(error){ toast('Could not do that: '+error.message,'err'); return; }
  toast(action==='force'?'Importing anyway - it runs within 5 minutes':'Will check again within 5 minutes','ok');
  cpaAutoImportCard();
};
// Queue: auto-detect type, parse, and import directly — no manual steps
/* LIVE AUTOMATIC IMPORT (10 Oct 2026): once cust.import_config.mode is 'live', "Import all" and
   the per-file Import button no longer write customer data from the browser. They read today's
   files with the same parsers and hand the rows to the same staging table the GitHub reader uses;
   the database then applies the whole day at once (all or nothing) within 5 minutes. */
async function cpaAutoMode(){
  try{ const {data}=await sb.schema('cust').from('import_config').select('mode').maybeSingle(); return (data&&data.mode)||'dry_run'; }
  catch(_e){ return 'dry_run'; }
}
async function cpaAutoReadNow(){
  const btn=document.getElementById('cpaAutoImportBtn');
  if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Reading…';}
  try{
    const XL=await loadXLSX(); if(!XL) throw new Error('Could not load spreadsheet reader');
    const {data:list,error}=await sb.schema('cust').rpc('fv_staff_files');
    if(error) throw error;
    const todo=((list&&list.files)||[]).filter(f=>!f.staged);
    if(!todo.length){ toast('All of today\'s files are already read - the automatic import takes it from here','ok'); return; }
    let done=0; const bad=[];
    for(const f of todo){
      const base={p_run:list.run_id,p_queue:f.queue_id,p_file:f.file_name,p_created:f.created_at};
      const {data:blob,error:dlErr}=await sb.storage.from('farvision-imports').download(f.storage_path);
      if(dlErr||!blob){ bad.push(f.file_name+' (download failed)'); continue; }
      let type=null, rows;
      try{
        const wb=XL.read(new Uint8Array(await blob.arrayBuffer()),{type:'array'});
        type=cpaDetectReportType(wb);
        if(!type) throw new Error('Could not detect report type');
        rows=JSON.parse(JSON.stringify(cpaParseByType(type,wb)));
      }catch(e){
        await sb.schema('cust').rpc('fv_staff_stage',{...base,p_type:type,p_rows_total:0,p_chunk:0,p_chunks:1,p_rows:[],p_parse_error:String(e.message||e).slice(0,300)});
        bad.push(f.file_name+' (could not be read)'); continue;
      }
      const CH=2000, chunks=Math.max(1,Math.ceil(rows.length/CH));
      let ok=true;
      for(let c=0;c<chunks&&ok;c++){
        const {error:se}=await sb.schema('cust').rpc('fv_staff_stage',{...base,p_type:type,p_rows_total:rows.length,p_chunk:c,p_chunks:chunks,p_rows:rows.slice(c*CH,(c+1)*CH),p_parse_error:null});
        if(se){ ok=false; bad.push(f.file_name+' ('+se.message+')'); }
      }
      if(ok) done++;
      if(btn) btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Reading '+(done+bad.length)+'/'+todo.length+'…';
    }
    toast(done+' file'+(done===1?'':'s')+' read - the automatic import applies the whole day within 5 minutes'+(bad.length?'. Not read: '+bad.join('; '):''),bad.length?'warn':'ok');
  }catch(e){ toast('Could not read the files: '+(e.message||e),'err'); }
  finally{ if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-bolt"></i> Import all';} cpaAutoImportCard(); }
}
window.cpaQueueImport=async function(queueId){
  if(await cpaAutoMode()==='live'){ await cpaAutoReadNow(); return true; }
  const {data:q,error}=await sb.schema('cust').from('import_queue').select('*').eq('id',queueId).single();
  if(error||!q){toast('Queue item not found','err');return;}
  await sb.schema('cust').from('import_queue').update({status:'processing'}).eq('id',queueId);
  toast('Importing '+q.file_name+'…','ok');
  try{
    const XL=await loadXLSX(); if(!XL) throw new Error('Could not load spreadsheet reader');
    const {data:blob,error:dlErr}=await sb.storage.from('farvision-imports').download(q.storage_path);
    if(dlErr||!blob)throw new Error(dlErr?.message||'Download failed');
    const buf=await blob.arrayBuffer();
    // Serials, not Dates - the same as a manual upload, and read to the exact day by xlsxExcelDate.
    const wb=XL.read(new Uint8Array(buf),{type:'array'});
    // Detect type, then parse - the same two steps the automatic import runs
    const type=cpaDetectReportType(wb);
    if(!type) throw new Error('Could not detect report type');
    const parsed=cpaParseByType(type,wb);
    // Match to projects/units (only registered projects pass through)
    const projects=await cpaProjects();
    const units=await cpaUnits();
    const matched=[],unmatched=[],fileProjectIds=new Set();
    for(const rec of parsed){
      const project=cpaResolveProject(projects,rec.businessUnit);
      if(!project){unmatched.push(rec);continue;}
      fileProjectIds.add(project.id);
      if(type==='sales_details'){matched.push({project,rec});}
      else if(type==='ptc_transfer'){
        // See the note in cpaImportPreviewXlsx: neither side is required alone, only that at least
        // one resolves to a unit we can attach the money to.
        const sourceUnit=cpaResolveUnit(units,project.id,rec.sourceBookingNo,null,null);
        const transfereeUnit=rec.transfereeBookingNo?cpaResolveUnit(units,project.id,rec.transfereeBookingNo,null,null):null;
        if(sourceUnit||transfereeUnit) matched.push({project,sourceUnit,transfereeUnit,rec}); else unmatched.push(rec);
      }
      else{
        const unit=cpaResolveUnit(units,project.id,rec.bookingNo,rec.tower,rec.unitCode);
        // A cancelled booking keeps its unit row for audit but must not take financial rows - those
        // would surface in that customer's portal. booking_register is exempt: cancelling is its job.
        if(unit&&unit.status==='cancelled'&&type!=='booking_register') continue;
        if(unit) matched.push({project,unit,rec}); else unmatched.push(rec);
      }
    }
    if(!matched.length) throw new Error('No rows matched registered projects ('+unmatched.length+' unmatched)');
    // Import using existing confirm logic
    const st={type,fileName:q.file_name,parsedCount:parsed.length,matched,unmatched,fileProjectIds:[...fileProjectIds]};
    CPA_IMPORT_STATE=st;
    window._cpaQueueId=queueId;
    if(CPA_XLSX_IMPORT_TYPES.has(type)) await cpaImportConfirmXlsx(st);
    // Queue item is marked completed inside cpaImportConfirm
    await sb.schema('cust').from('import_queue').update({status:'completed',processed_at:new Date().toISOString()}).eq('id',queueId);
    window._cpaQueueId=null;
    toast(matched.length+' rows imported from '+q.file_name,'ok');
    return true;
  }catch(e){
    await sb.schema('cust').from('import_queue').update({status:'failed',error_message:e.message}).eq('id',queueId);
    toast('Failed: '+e.message,'err');
    return false;
  }
};
window.cpaQueueImportAll=async function(){
  if(await cpaAutoMode()==='live'){ await cpaAutoReadNow(); return; }
  const {data:pending}=await sb.schema('cust').from('import_queue').select('id,file_name').eq('status','pending').order('created_at');
  if(!pending||!pending.length){toast('No pending files','ok');return;}
  const btn=document.getElementById('cpaAutoImportBtn');
  if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Importing…';}
  let done=0,failed=0;
  for(const item of pending){
    try{
      const ok=await cpaQueueImport(item.id);
      if(ok) done++; else failed++;
    }catch(e){failed++;}
  }
  toast(done+' file(s) imported'+(failed?' ('+failed+' failed)':''),'ok');
  route();
};
window.cpaQueueDismiss=async function(queueId){
  await sb.schema('cust').from('import_queue').update({status:'completed',processed_at:new Date().toISOString()}).eq('id',queueId);
  toast('Dismissed','ok');route();
};
// Auto-import on page load if pending items exist
async function cpaAutoImportPending(){
  const {data:pending}=await sb.schema('cust').from('import_queue').select('id').eq('status','pending');
  if(pending&&pending.length) await cpaQueueImportAll();
}
window.cpaImportTypeChange=function(){
  const type=$('cpaImpType').value, help=$('cpaImpColsHelp'), file=$('cpaImpFile'), projWrap=$('cpaImpProjectWrap');
  const isXlsx=CPA_XLSX_IMPORT_TYPES.has(type);
  file.setAttribute('accept',isXlsx?'.xlsx':'.csv');
  $('cpaImpFileLabel').textContent=isXlsx?'Farvision .xlsx export':'CSV file';
  // sales_details/outstanding/invoice_register/receipt_register resolve their project(s) from the
  // file's own Business Unit column per row, so a project doesn't need picking up front - unlike the
  // generic CSV imports, which only ever carry a bare unit_code with no project of its own.
  if(projWrap) projWrap.style.display=isXlsx?'none':'';
  if(isXlsx){
    help.textContent={
      sales_details:'Real "Sales Details" export — customer/booking master + full cost sheet, one row per booking.',
      outstanding:'Real "Customer Outstanding Summary" export — an as-on-date balance snapshot, one row per booking.',
      invoice_register:'Real "Invoice Register Details" export — dated demand, one row per invoice line.',
      receipt_register:'Real "Receipt Register Details" export — dated receipts, one row per receipt-to-invoice allocation.',
      receipt_reversal:'Real "Receipt Reversal Register Details" export — cheque returns, one row per reversal revenue-head line.',
      booking_register:'Real "Booking Register Summary" export — booking status per unit; marks cancelled bookings cancelled.',
      ptc_transfer:'Real "Payment To Customer Register" export — booking transfers and refunds, one row per PTC document.',
    }[type]||'';
  }else{
    const c=CPA_IMPORT_COLUMNS[type];
    help.textContent=c?('Required columns: '+c.required.join(', ')+'. Optional: '+c.optional.join(', ')+'.'):'';
  }
};
window.cpaImportPreview=async function(){
  const type=$('cpaImpType').value;
  const file=$('cpaImpFile').files[0];
  if(!file){toast('Choose a file','err');return;}
  if(CPA_XLSX_IMPORT_TYPES.has(type)){ await cpaImportPreviewXlsx(type,file); return; }
  await cpaImportPreviewCsv(type,file);
};
async function cpaImportPreviewXlsx(type,file,preloadedWb){
  const XL=await loadXLSX();
  if(!XL){toast('Could not load the spreadsheet reader — check your connection','err');return;}
  let wb,parsed;
  try{
    if(preloadedWb){wb=preloadedWb;}
    else{const buf=await file.arrayBuffer();wb=XL.read(buf,{type:'array'});}
    parsed=type==='sales_details'?cpaParseSalesDetails(wb)
      :type==='outstanding'?cpaParseOutstanding(wb)
      :type==='invoice_register'?cpaParseInvoiceRegister(wb)
      :type==='receipt_reversal'?cpaParseReceiptReversal(wb)
      :type==='booking_register'?cpaParseBookingRegister(wb)
      :type==='ptc_transfer'?cpaParsePTC(wb)
      :cpaParseReceiptRegister(wb);
  }catch(e){toast(e.message,'err');return;}
  if(!parsed.length){toast('No data rows found in that file','err');return;}
  const [projects,units]=await Promise.all([cpaProjects(),cpaUnits()]);
  const matched=[],unmatched=[],outOfScope=[],fileProjectIds=new Set();
  parsed.forEach(rec=>{
    const project=cpaResolveProject(projects,rec.businessUnit);
    if(!project){ outOfScope.push(rec); return; } // a project we don't manage in the portal yet - not an error
    fileProjectIds.add(project.id);
    if(type==='sales_details'){
      if(rec.status!=='Active'){ return; } // cancelled bookings don't get a portal unit
      matched.push({rec,project});
      return;
    }
    if(type==='ptc_transfer'){
      // Both sides are looked up independently, and neither is required alone: the source booking is
      // very often a cancelled booking that was never Active (so Sales Details never created a unit
      // for it, per the same rule above) - that's expected, not a failure, since the whole point of
      // the transferee side is to land the money on a unit that DOES exist. Only genuinely unmatched
      // if NEITHER side resolves to anything we can attach money to.
      const sourceUnit=cpaResolveUnit(units,project.id,rec.sourceBookingNo,null,null);
      const transfereeUnit=rec.transfereeBookingNo?cpaResolveUnit(units,project.id,rec.transfereeBookingNo,null,null):null;
      if(!sourceUnit&&!transfereeUnit){ unmatched.push(rec); return; }
      matched.push({rec,project,sourceUnit,transfereeUnit});
      return;
    }
    const unit=cpaResolveUnit(units,project.id,rec.bookingNo,rec.tower,rec.unitCode);
    // Cancelled bookings keep their unit row for audit but take no financial rows - see the note in
    // the queue importer. booking_register is exempt, since cancelling is what it does.
    if(unit&&unit.status==='cancelled'&&type!=='booking_register'){ outOfScope.push(rec); return; }
    if(!unit){ unmatched.push(rec); return; }
    matched.push({rec,project,unit});
  });
  CPA_IMPORT_STATE={type,fileName:file.name,parsedCount:parsed.length,matched,unmatched,outOfScope,fileProjectIds:[...fileProjectIds]};
  // Shown before Confirm: flats whose customer the import will deliberately NOT change.
  let sdNote='';
  if(type==='sales_details'){
    const sdCustomers=await cpaCustomers(true);
    sdNote=cpaSdFlagNote(matched.map(m=>cpaSdCustomerGuard(m.rec,units,sdCustomers).flag).filter(Boolean));
  }
  const sampleCols=type==='sales_details'?['Booking No','Customer','Unit','Tower','Project','Cost items']
    :type==='outstanding'?['Booking No','Customer','Unit','Net Outstanding','On Account']
    :type==='invoice_register'?['Doc No','Date','Booking No','Customer','Unit','Schedule','Amount']
    :type==='ptc_transfer'?['Doc No','Date','Amount','Debit unit','Credit unit','Narration']
    :['Receipt No','Date','Booking No','Customer','Invoice No','Amount'];
  const sampleRows=matched.slice(0,10).map(m=>{
    const r=m.rec;
    if(type==='sales_details') return [esc(r.bookingNo),esc(r.customerName),esc(r.unitCode),esc(r.tower),esc(m.project.name),r.costItems.length];
    if(type==='outstanding') return [esc(r.bookingNo),esc(r.customerName),esc(r.unitCode),custInr(r.netOutstanding),custInr(r.onAccount)];
    if(type==='invoice_register') return [esc(r.docNo),fmtDate(r.docDate),esc(r.bookingNo),esc(r.customerName),esc(r.unitCode),esc(r.schedule),custInr(r.netAmount)];
    if(type==='ptc_transfer') return [esc(r.documentNo),fmtDate(r.documentDate),custInr(r.amount),
      m.sourceUnit?esc(m.sourceUnit.unit_code):'—',m.transfereeUnit?esc(m.transfereeUnit.unit_code):'—',esc(r.narration||'—')];
    return [esc(r.receiptNo),fmtDate(r.receiptDate),esc(r.bookingNo),esc(r.customerName),esc(r.invoiceNo||'—'),custInr(r.amount)];
  });
  $('cpaImpPreview').innerHTML=`<div class="card card-pad">
    <div class="sec-title" style="margin:0 0 10px">Preview — ${parsed.length} row(s), ${matched.length} ready to import${unmatched.length?`, <span style="color:#c83232">${unmatched.length} unmatched</span>`:''}${outOfScope.length?`, ${outOfScope.length} for a project not yet in the portal`:''}</div>
    ${unmatched.length?`<div style="font-size:12.5px;color:#92400e;background:#fffbeb;border:1px solid #f0dfa8;border-radius:8px;padding:8px 10px;margin-bottom:10px">Could not resolve a unit for: ${esc(unmatched.slice(0,15).map(r=>r.bookingNo||r.unitCode).join(', '))}${unmatched.length>15?' …':''} — run a Sales Details import for these first.</div>`:''}
    ${sdNote}
    ${matched.length?mTable(sampleCols,sampleRows):''}
    <div style="margin-top:12px;display:flex;gap:10px"><button class="btn" onclick="$('cpaImpPreview').innerHTML=''">Cancel</button>
    ${matched.length?`<button class="btn btn-primary" onclick="cpaImportConfirm(this)"><i class="fa-solid fa-check"></i> Confirm import (${matched.length} row${matched.length>1?'s':''})</button>`:''}
    </div></div>`;
}
async function cpaImportPreviewCsv(type,file){
  const Papa=await loadPapaParse();
  if(!Papa){toast('Could not load the CSV parser — check your connection','err');return;}
  const projectId=Number(($('cpaImpProject')||{}).value);
  const text=await file.text();
  const parsed=Papa.parse(text,{header:true,skipEmptyLines:true,transformHeader:h=>String(h).trim().toLowerCase().replace(/\s+/g,'_')});
  if(parsed.errors&&parsed.errors.length){toast('CSV parse error: '+parsed.errors[0].message,'err');return;}
  const rows=parsed.data||[];
  if(!rows.length){toast('No rows found in that file','err');return;}
  const cols=CPA_IMPORT_COLUMNS[type];
  const headerSet=new Set(Object.keys(rows[0]));
  const missing=cols.required.filter(c=>!headerSet.has(c));
  if(missing.length){toast('Missing required column(s): '+missing.join(', '),'err');return;}
  const units=(await cpaUnits()).filter(u=>u.project_id===projectId);
  const byCode={};units.forEach(u=>{byCode[String(u.unit_code).trim().toLowerCase()]=u;});
  const matched=[],unmatchedCodes=[];
  rows.forEach(r=>{
    const code=String(r.unit_code||'').trim();
    const u=byCode[code.toLowerCase()];
    if(u)matched.push({unit:u,row:r});else if(code)unmatchedCodes.push(code);
  });
  CPA_IMPORT_STATE={type,projectId,fileName:file.name,rows,matched,unmatchedCodes};
  const allCols=cols.required.concat(cols.optional);
  const previewRows=matched.slice(0,10).map(m=>allCols.map(c=>esc(m.row[c]||'—')));
  $('cpaImpPreview').innerHTML=`<div class="card card-pad">
    <div class="sec-title" style="margin:0 0 10px">Preview — ${rows.length} row(s), ${matched.length} matched to a unit${unmatchedCodes.length?`, <span style="color:#c83232">${unmatchedCodes.length} unmatched</span>`:''}</div>
    ${unmatchedCodes.length?`<div style="font-size:12.5px;color:#92400e;background:#fffbeb;border:1px solid #f0dfa8;border-radius:8px;padding:8px 10px;margin-bottom:10px">Unmatched unit codes (will be skipped): ${esc(unmatchedCodes.slice(0,20).join(', '))}${unmatchedCodes.length>20?' …':''}</div>`:''}
    ${matched.length?mTable(allCols,previewRows):''}
    <div style="margin-top:12px;display:flex;gap:10px"><button class="btn" onclick="$('cpaImpPreview').innerHTML=''">Cancel</button>
    ${matched.length?`<button class="btn btn-primary" onclick="cpaImportConfirm(this)"><i class="fa-solid fa-check"></i> Confirm import (${matched.length} row${matched.length>1?'s':''})</button>`:''}
    </div></div>`;
}
window.cpaImportConfirm=async function(btn){
  const st=CPA_IMPORT_STATE;if(!st){toast('Nothing to import','err');return;}
  if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Importing…';}
  try{
    if(CPA_XLSX_IMPORT_TYPES.has(st.type)){ await cpaImportConfirmXlsx(st); }
    else{ await cpaImportConfirmCsv(st); }
    // Mark queue item as completed if this import came from Gmail queue
    if(window._cpaQueueId){
      await sb.schema('cust').from('import_queue').update({status:'completed',processed_at:new Date().toISOString()}).eq('id',window._cpaQueueId);
      window._cpaQueueId=null;
    }
    CPA_IMPORT_STATE=null;
    navTo('custportal_admin/2/history');
  }catch(e){toast('Import failed: '+e.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Confirm import';}}
};
/* raw_rows is an audit copy of what was parsed. It is INSPECTION ONLY - undo_import_batch does not
   read it, it reverts via import_batch_id on the data tables - so capping it loses no ability to
   undo and changes no imported figure.

   Why it needs a cap: a Receipt Register carries ~14k matched rows, which is ~6MB of JSON in the
   single INSERT that opens every import. That sat just under the 8s statement_timeout on the
   `authenticated` role until Dream Ananta was added; the extra matched rows tipped it over and the
   import began failing outright with "canceling statement due to statement timeout" - and it would
   have failed for every project added after that too.

   Above the cap the column is left empty rather than partially filled: a truncated array reads like
   a complete one and would be worse than nothing for anyone auditing a figure. The .xlsx itself is
   kept in the farvision-imports bucket and is a better record than a JSON copy of it. */
const CPA_RAW_ROWS_MAX=2000;

/* The current rows for this batch's units, keyed `unit_id|<keyCol>` -> id.
   Stands in for ON CONFLICT, which cannot infer these tables' PARTIAL unique indexes.
   Paged explicitly: PostgREST caps a response at 1000 rows, and a row missed here would be inserted
   as a duplicate instead of updated, leaving two "current" rows for one document and a ledger that
   double-counts it. Silent wrong money is the one outcome worth being long-winded about. */
async function cpaCurrentByKey(table,keyCol,matched){
  const unitIds=[...new Set(matched.map(m=>m.unit&&m.unit.id).filter(Boolean))];
  const map={},PAGE=1000;
  for(let i=0;i<unitIds.length;i+=100){
    const chunk=unitIds.slice(i,i+100);
    for(let from=0;;from+=PAGE){
      const {data,error}=await sb.schema('cust').from(table).select('id,unit_id,'+keyCol)
        .in('unit_id',chunk).is('deleted_at',null).eq('is_current',true)
        .order('id').range(from,from+PAGE-1);
      if(error)throw error;
      (data||[]).forEach(r=>{map[r.unit_id+'|'+r[keyCol]]=r.id;});
      if(!data||data.length<PAGE)break;
    }
  }
  return map;
}
/* Who a Sales Details row's flat should belong to, without letting a routine re-import move an
   existing flat away from the customer who already logs in to it.
     * Same booking, email left blank in Farvision -> keep the flat's current customer. (It used to be
       set to nobody, and the customer lost the flat from their portal.)
     * Same booking, email different from the current customer's -> keep the current customer and
       flag it. A new email on the SAME booking is an edit in Farvision, not a new buyer - moving the
       flat would create a second customer and leave the real one's login empty. Staff decide.
     * A different booking on the flat (a rebooking - the old buyer's row matched by tower/unit) or a
       brand-new flat -> the file's email decides, as before: that is a genuinely different buyer.
   Returns {keep: customerId|null, flag: null|{bookingNo, name, current, file}}; keep=null means
   "resolve by the file's email". */
function cpaSdCustomerGuard(r,units,customers){
  const byBooking=r.bookingNo?units.find(u=>u.booking_no===r.bookingNo):null;
  if(!byBooking||!byBooking.customer_id) return {keep:null,flag:null};
  const norm=s=>String(s||'').trim().toLowerCase();
  if(!norm(r.email)) return {keep:byBooking.customer_id,flag:null};
  const cur=customers.find(c=>c.id===byBooking.customer_id);
  if(!cur||norm(cur.email)===norm(r.email)) return {keep:null,flag:null};
  return {keep:byBooking.customer_id,flag:{bookingNo:r.bookingNo,name:r.customerName,unit:byBooking.unit_code,current:cur.email,file:r.email}};
}
function cpaSdFlagNote(flags){
  if(!flags.length) return '';
  return '<div style="font-size:12.5px;color:#92400e;background:#fffbeb;border:1px solid #f0dfa8;border-radius:8px;padding:8px 10px;margin-bottom:10px">'
    +'<b>Email changed in Farvision - please check.</b> These flats were kept with their current customer so nobody loses access: '
    +flags.map(f=>esc(f.name)+' ('+esc(f.unit||f.bookingNo)+'): portal '+esc(f.current)+' → Farvision '+esc(f.file)).join('; ')
    +'. If the new email is right, update it on the customer in Customer Portal Admin.</div>';
}
async function cpaImportConfirmXlsx(st){
  // No project_id: an .xlsx report resolves a project per row from its own Business Unit column, so
  // one file can span several projects at once. project_names records the set it actually touched.
  const {data:batch,error:beErr}=await sb.schema('cust').from('import_batches').insert({
    import_type:st.type,file_name:st.fileName,imported_by:state.email,
    project_names:[...new Set(st.matched.map(m=>m.project&&m.project.name).filter(Boolean))].sort(),
    row_count:st.parsedCount,matched_count:st.matched.length,unmatched_count:st.unmatched.length,
    unmatched_codes:st.unmatched.map(r=>r.bookingNo||r.unitCode||r.documentNo||'').filter(Boolean),
    raw_rows:st.matched.length<=CPA_RAW_ROWS_MAX?st.matched.map(m=>m.rec):[]}).select('id').single();
  if(beErr)throw beErr;
  const batchId=batch.id;

  if(st.type==='sales_details'){
    const sdCustomers=await cpaCustomers(true), sdFlags=[];
    for(const m of st.matched){
      const r=m.rec;
      // Customers are matched by email — the only field guaranteed to identify one person across
      // bookings; a row with no email can't be created here (it also couldn't get a portal login).
      // cpaSdCustomerGuard first: an existing flat never loses its customer to a blank or edited email.
      const guard=cpaSdCustomerGuard(r,await cpaUnits(),sdCustomers);
      if(guard.flag) sdFlags.push(guard.flag);
      let customerId=guard.keep;
      if(customerId==null&&r.email){
        const {data:existing}=await sb.schema('cust').from('customers').select('id').ilike('email',r.email).is('deleted_at',null).maybeSingle();
        if(existing) customerId=existing.id;
        else{
          const {data:created,error}=await sb.schema('cust').from('customers').insert({full_name:r.customerName,email:r.email,phone:r.mobile,created_by:state.email}).select('id').single();
          if(error)throw error; customerId=created.id;
        }
      }
      // Sales Details lists Active bookings only, and a flat has one non-cancelled row
      // (units_project_tower_code_active_uq), so a rebooked flat must still find its existing row.
      const allUnits=await cpaUnits();
      const existingUnit=cpaResolveUnit(allUnits,m.project.id,r.bookingNo,null,null)||cpaResolveFlat(allUnits,m.project.id,r.tower,r.unitCode);
      const unitRow={project_id:m.project.id,unit_code:r.unitCode,tower:r.tower,floor_no:r.floor||null,
        unit_type:r.typology||null,carpet_area_sqft:r.carpet||null,super_built_up_area_sqft:r.superBuiltUp||null,
        built_up_area_sqft:r.builtUp||null,agreement_value:r.totalBasic+r.totalTax,booking_no:r.bookingNo,
        application_no:r.applicationNo,customer_id:customerId,updated_at:new Date().toISOString()};
      let unitId;
      if(existingUnit){ const {error}=await sb.schema('cust').from('units').update(unitRow).eq('id',existingUnit.id); if(error)throw error; unitId=existingUnit.id; }
      else{ const {data:createdUnit,error}=await sb.schema('cust').from('units').insert({...unitRow,created_by:state.email}).select('id').single(); if(error)throw error; unitId=createdUnit.id; await cpaUnits(true); }

      await sb.schema('cust').from('cost_sheet_items').update({is_current:false}).eq('unit_id',unitId).eq('is_current',true);
      if(r.costItems.length){
        const items=r.costItems.map((ci,i)=>({unit_id:unitId,component:ci.component,amount:ci.basicAmount,tax_amount:ci.taxAmount,
          bill_amount:ci.billAmount,received_amount:ci.receivedAmount,balance_amount:ci.balanceAmount,onaccount_amount:ci.onaccountAmount,
          sort_order:i,is_current:true,import_batch_id:batchId}));
        const {error}=await sb.schema('cust').from('cost_sheet_items').insert(items); if(error)throw error;
      }
      await sb.schema('cust').from('farvision_contacts').update({is_current:false}).eq('unit_id',unitId).eq('is_current',true);
      const {error:ceErr}=await sb.schema('cust').from('farvision_contacts').insert({unit_id:unitId,unit_code:r.unitCode,booking_no:r.bookingNo,
        contact_name:r.customerName,contact_phone:r.mobile,contact_email:r.email,contact_address:r.address,
        booking_date:r.bookingDate,agreement_date:r.agreementDate,is_current:true,import_batch_id:batchId});
      if(ceErr)throw ceErr;
    }
    // The queue import has no preview screen, so the warning has to reach staff here as well.
    st.sdFlags=sdFlags;
    if(sdFlags.length){
      console.warn('Sales Details: email changed in Farvision, flat kept with its current customer',sdFlags);
      toast(sdFlags.length+' flat'+(sdFlags.length===1?'':'s')+' kept with the current customer - email changed in Farvision ('
        +sdFlags.map(f=>f.name+' '+(f.unit||f.bookingNo)).join(', ')+'). Please check.','warn');
    }
  }else if(st.type==='outstanding'){
    for(const m of st.matched){
      const r=m.rec;
      await sb.schema('cust').from('outstanding_snapshot').update({is_current:false}).eq('unit_id',m.unit.id).eq('is_current',true);
      const {error}=await sb.schema('cust').from('outstanding_snapshot').insert({unit_id:m.unit.id,as_on_date:new Date().toISOString().slice(0,10),
        total_consideration:r.totalConsideration,bill_outstanding:r.billOutstanding,on_account:r.onAccount,
        net_outstanding:r.netOutstanding,late_fee_accrued:r.lateFee,no_of_bills:r.noOfBills,is_current:true,import_batch_id:batchId});
      if(error)throw error;
    }
    /* Farvision leaves a flat out of the Outstanding Summary once nothing is outstanding. Without this
       its last snapshot stayed current: Mohmmad Anwar (Gateway 1E) cleared 31,44,019 on 29 Sep and was
       absent from the 30 Sep file, yet his home screen kept showing that amount as due. So every flat
       of a project this file covers that is not in it loses its snapshot, and the portal falls back to
       the Sales Details cost sheet, as it already does for fully-paid flats. Projects the file does not
       cover at all are left alone, so a single-project export cannot wipe the others. */
    const inFile=new Set(st.matched.map(m=>m.unit.id));
    const projIds=new Set(st.fileProjectIds||st.matched.map(m=>m.project.id));
    const gone=(await cpaUnits(true)).filter(u=>projIds.has(u.project_id)&&!inFile.has(u.id)).map(u=>u.id);
    for(let i=0;i<gone.length;i+=200){
      const {error}=await sb.schema('cust').from('outstanding_snapshot').update({is_current:false})
        .in('unit_id',gone.slice(i,i+200)).eq('is_current',true);
      if(error)throw error;
    }
  }else if(st.type==='invoice_register'){
    // Write to NEW tables: cust.invoices (headers) + cust.invoice_items (lines)
    // Group by document_no → one invoice header per doc, multiple item lines
    const byDoc={};
    for(const m of st.matched){
      const r=m.rec, key=m.unit.id+'|'+r.docNo;
      if(!byDoc[key]) byDoc[key]={unit:m.unit,rec:r,items:[]};
      byDoc[key].items.push(r);
    }
    /* invoices_uq is a PARTIAL unique index (WHERE deleted_at is null and is_current). Postgres
       cannot infer a partial index from a bare column list, so .upsert({onConflict:'unit_id,
       document_no'}) raised "no unique or exclusion constraint matching the ON CONFLICT
       specification" on every run - which is why cust.invoices was last written on 11 Sep while
       every import since reported success. Look the current rows up ourselves instead. */
    const existingInv=await cpaCurrentByKey('invoices','document_no',st.matched);
    for(const key of Object.keys(byDoc)){
      const {unit,rec,items}=byDoc[key];
      const invRow={unit_id:unit.id,document_no:rec.docNo,document_date:rec.docDate,
        invoice_type:rec.invoiceType||'Payment Plan',due_date:rec.dueDate,gstin:rec.gstin,
        status:rec.status,is_current:true,import_batch_id:batchId};
      let invId=existingInv[unit.id+'|'+rec.docNo];
      if(invId){ const {error:ue}=await sb.schema('cust').from('invoices').update(invRow).eq('id',invId); if(ue)throw ue; }
      else{
        const {data:ins,error:ie}=await sb.schema('cust').from('invoices').insert(invRow).select('id').single();
        if(ie)throw ie; invId=ins.id; existingInv[unit.id+'|'+rec.docNo]=invId;
      }
      const inv={id:invId};
      // Delete old items for this invoice, insert fresh
      await sb.schema('cust').from('invoice_items').delete().eq('invoice_id',inv.id);
      const itemRows=items.map((r,i)=>({
        invoice_id:inv.id,schedule:r.schedule,revenue_head:r.revenueHead,
        amount:r.amount,tax:r.tax,net_amount:r.netAmount,sort_order:i
      }));
      if(itemRows.length){const {error}=await sb.schema('cust').from('invoice_items').insert(itemRows);if(error)throw error;}
    }
  }else if(st.type==='receipt_register'){
    // Write to NEW tables: cust.money_receipts (headers) + cust.receipt_items (lines)
    // Group by receipt_no → one receipt header per receipt, multiple item lines
    const byReceipt={};
    for(const m of st.matched){
      const r=m.rec, key=m.unit.id+'|'+r.receiptNo;
      if(!byReceipt[key]) byReceipt[key]={unit:m.unit,rec:r,items:[]};
      byReceipt[key].items.push(r);
    }
    // money_receipts_uq is partial in the same way invoices_uq is - see the note above.
    const existingRcpt=await cpaCurrentByKey('money_receipts','receipt_no',st.matched);
    for(const key of Object.keys(byReceipt)){
      const {unit,rec,items}=byReceipt[key];
      const totalAmt=items.reduce((s,r)=>s+Number(r.totalAmount||r.amount||0),0);
      const rcptRow={unit_id:unit.id,receipt_no:rec.receiptNo,receipt_date:rec.receiptDate,
        payment_mode:rec.mode,instrument_no:rec.instrumentNo,instrument_date:rec.instrumentDate,
        drawn_on:rec.drawnOn,drawn_on_branch:rec.drawnOnBranch,deposit_bank:rec.depositBank,
        narration:rec.narration,total_amount:totalAmt,
        is_reversed:rec.isReversed==='Yes',unit_status_at_receipt:rec.unitStatus,
        is_current:true,import_batch_id:batchId};
      let rcptId=existingRcpt[unit.id+'|'+rec.receiptNo];
      if(rcptId){ const {error:ue}=await sb.schema('cust').from('money_receipts').update(rcptRow).eq('id',rcptId); if(ue)throw ue; }
      else{
        const {data:ins,error:re}=await sb.schema('cust').from('money_receipts').insert(rcptRow).select('id').single();
        if(re)throw re; rcptId=ins.id; existingRcpt[unit.id+'|'+rec.receiptNo]=rcptId;
      }
      const rcpt={id:rcptId};
      // Delete old items, insert fresh
      await sb.schema('cust').from('receipt_items').delete().eq('receipt_id',rcpt.id);
      const itemRows=items.map((r,i)=>({
        receipt_id:rcpt.id,against_demand_no:r.invoiceNo,schedule:r.schedule,
        revenue_head:r.revenueHead,amount:r.amount,sort_order:i
      }));
      if(itemRows.length){const {error}=await sb.schema('cust').from('receipt_items').insert(itemRows);if(error)throw error;}
    }
  }else if(st.type==='receipt_reversal'){
    // One report row per revenue-head line, and every consumer (Ledger, reconciliation) sums
    // reversal_amount across a reversal's rows - so all lines must land. Skipping a reversal number
    // once its first line existed kept Rs 3,201 of a Rs 10,00,000 bounced cheque.
    const byRev={};
    for(const m of st.matched){ const k=m.unit.id+'|'+m.rec.reversalNo; (byRev[k]=byRev[k]||{unit:m.unit,lines:[]}).lines.push(m.rec); }
    for(const k of Object.keys(byRev)){
      const {unit,lines}=byRev[k];
      const {error:ue}=await sb.schema('cust').from('receipt_reversals').update({is_current:false})
        .eq('unit_id',unit.id).eq('receipt_reversal_no',lines[0].reversalNo).eq('is_current',true);
      if(ue)throw ue;
      const {error}=await sb.schema('cust').from('receipt_reversals').insert(lines.map(r=>({
        unit_id:unit.id,receipt_reversal_no:r.reversalNo,receipt_reversal_date:r.reversalDate,
        receipt_no:r.receiptNo,receipt_date:r.receiptDate,
        instrument_no:r.instrumentNo,instrument_date:r.instrumentDate,
        reversal_amount:r.reversalAmount,total_reversal_amount:r.totalReversalAmount,
        narration:r.narration,bank_description:r.bankDescription,reason:r.reason,
        is_current:true,import_batch_id:batchId})));
      if(error)throw error;
    }
  }else if(st.type==='booking_register'){
    // Only the two moves this report actually knows about: Cancel cancels, and Active brings back a
    // unit wrongly left cancelled. 'registered' / 'possession' are set by staff and are not this
    // report's to overwrite, and a row with no readable status changes nothing.
    for(const m of st.matched){
      const r=m.rec;
      const newStatus=r.status==='Cancel'?'cancelled'
        :(r.status==='Active'&&m.unit.status==='cancelled')?'booked':null;
      if(!newStatus||newStatus===m.unit.status) continue;
      const {error}=await sb.schema('cust').from('units').update({status:newStatus,updated_at:new Date().toISOString()}).eq('id',m.unit.id);
      if(error)throw error;
    }
  }else if(st.type==='ptc_transfer'){
    // ptc_transfers_doc_uq is a PARTIAL unique index (WHERE deleted_at is null) - same reason
    // .upsert({onConflict:...}) silently broke cust.invoices/cust.money_receipts for eleven days.
    // Look the row up ourselves instead of trusting Postgres to infer the index.
    const docNos=st.matched.map(m=>m.rec.documentNo);
    const existingByDoc={};
    for(let i=0;i<docNos.length;i+=100){
      const {data}=await sb.schema('cust').from('ptc_transfers').select('id,document_no')
        .in('document_no',docNos.slice(i,i+100)).is('deleted_at',null);
      (data||[]).forEach(r=>{existingByDoc[r.document_no]=r.id;});
    }
    for(const m of st.matched){
      const r=m.rec;
      const row={document_no:r.documentNo,document_date:r.documentDate,amount:r.amount,narration:r.narration,
        source_booking_no:r.sourceBookingNo,source_unit_id:(m.sourceUnit&&m.sourceUnit.id)||null,
        transferee_booking_no:r.transfereeBookingNo,transferee_unit_id:(m.transfereeUnit&&m.transfereeUnit.id)||null,
        is_reversed:r.isReversed,is_current:true,import_batch_id:batchId};
      const existingId=existingByDoc[r.documentNo];
      if(existingId){ const {error}=await sb.schema('cust').from('ptc_transfers').update(row).eq('id',existingId); if(error)throw error; }
      else{ const {error}=await sb.schema('cust').from('ptc_transfers').insert(row); if(error)throw error; }
    }
  }
  toast(st.matched.length+' row(s) imported','ok');
}
async function cpaImportConfirmCsv(st){
  const {data:batch,error:beErr}=await sb.schema('cust').from('import_batches').insert({
    import_type:st.type,project_id:st.projectId,file_name:st.fileName,imported_by:state.email,
    row_count:st.rows.length,matched_count:st.matched.length,unmatched_count:st.unmatchedCodes.length,
    unmatched_codes:st.unmatchedCodes,raw_rows:st.rows}).select('id').single();
  if(beErr)throw beErr;
  const batchId=batch.id;
  if(st.type==='maintenance_bills'){
    const rows=st.matched.map(m=>({unit_id:m.unit.id,unit_code:m.unit.unit_code,bill_no:String(m.row.bill_no),bill_period:m.row.bill_period||null,bill_date:m.row.bill_date||null,due_date:m.row.due_date||null,amount:m.row.amount?Number(m.row.amount):null,gst_amount:m.row.gst_amount?Number(m.row.gst_amount):null,total_amount:m.row.total_amount?Number(m.row.total_amount):null,status:m.row.status||null,raw:m.row,import_batch_id:batchId}));
    const {error}=await sb.schema('cust').from('maintenance_bills').upsert(rows,{onConflict:'unit_id,bill_no'});
    if(error)throw error;
  }else if(st.type==='maintenance_receipts'){
    const rows=st.matched.map(m=>({unit_id:m.unit.id,unit_code:m.unit.unit_code,receipt_no:String(m.row.receipt_no),receipt_date:m.row.receipt_date||null,amount:m.row.amount?Number(m.row.amount):null,mode:m.row.mode||null,against_bill_no:m.row.against_bill_no||null,raw:m.row,import_batch_id:batchId}));
    const {error}=await sb.schema('cust').from('maintenance_receipts').upsert(rows,{onConflict:'unit_id,receipt_no'});
    if(error)throw error;
  }
  toast(st.matched.length+' row(s) imported','ok');
}
async function cpaRenderImportHistory(host,projects){
  // Named columns rather than '*': raw_rows carries every parsed row of every batch (86k rows and
  // growing, most of this table's bulk) and nothing on this screen reads it.
  const {data}=await sb.schema('cust').from('import_batches')
    .select('id,import_type,project_id,project_names,file_name,imported_at,imported_by,matched_count,unmatched_count,status')
    .order('imported_at',{ascending:false}).limit(200);
  const rows=(data||[]).map(b=>{
    const proj=projects.find(p=>p.id===b.project_id);
    // .xlsx batches span projects and carry project_names; the CSV imports pick one project up front.
    const projLabel=(b.project_names&&b.project_names.length)?b.project_names.join(', '):(proj?proj.name:'—');
    return [CPA_IMPORT_LABELS[b.import_type]||b.import_type,esc(projLabel),esc(b.file_name||'—'),
      fmtDate(b.imported_at),esc(b.imported_by||'—'),
      b.matched_count+' matched'+(b.unmatched_count?', '+b.unmatched_count+' unmatched':''),
      b.status==='undone'?'<span class="tag t-gray">Undone</span>':'<span class="tag t-green">Completed</span>',
      b.status==='undone'?'—':`<button class="btn btn-sm btn-danger" onclick="cpaUndoImport(${b.id})">Undo</button>`];
  });
  host.innerHTML=`<div class="tabs" style="margin-bottom:14px"><div class="tab" onclick="navTo('custportal_admin/2')">Import</div><div class="tab active">Import History</div></div>`+
    cpaTable(['Type','Project','File','Imported','By','Rows','Status','Undo'],rows.length?rows:[['No imports yet','','','','','','','']]);
}
window.cpaUndoImport=async function(id){
  if(!await confirmDialog('Undo this import? Every row it wrote will be soft-deleted, and — for cost sheet / contacts — the prior data will be restored.',{okLabel:'Undo import'}))return;
  const {error}=await sb.schema('cust').rpc('undo_import_batch',{p_batch_id:id});
  if(error){toast('Undo failed: '+error.message,'err');return;}
  toast('Import undone','ok');route();
};

/* ---------- Tab 4: Photos (project-wide, tower-wide, floor-wide, per-flat - each accepts
   images and videos together, multiple files at once, and lists what's already there with a
   Delete button so staff can remove anything wrongly uploaded) ---------- */
function cpaTowersForProject(units,projectId){return [...new Set(units.filter(u=>u.project_id===Number(projectId)&&u.tower).map(u=>u.tower))].sort();}
/* ══════════════════════════════════════════════════════════════════════════════════════════
   CONSTRUCTION PHOTOS & VIDEOS — one screen, three levels, one place to say where.

   What was here before: four near-identical forms stacked two-by-two, every one of them on
   screen at once, each with its own project picker, its own date, its own caption and its own
   list of what had already been uploaded. To put photos against a flat you scrolled past three
   forms you were not using, then hunted the flat in a single dropdown holding every unit in
   every tower of every project. The most frequent job on the screen was the hardest one to do.

   What it is now. WHERE is asked once, at the top, and it cascades: Project, then Block, then
   Flat, with a search box because a block can hold ninety flats. WHAT LEVEL is a row of three
   buttons, and only that level's form is on screen. Below, one panel to upload into and one
   panel showing what is already there.

   THE FLAT LEVEL TAKES THREE SETS OF FILES AT ONCE - common area, bathroom, kitchen - because
   that is how somebody walks a flat and how a customer asks about it. Any one, any two, or all
   three; whatever is filled in goes up together on one press.

   FLOOR LEVEL IS GONE, by request. It held nothing (the table was empty), it sat between two
   levels people actually use, and deriving a floor from a unit code was a guess.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

const CPA_PH_AREAS=[['common','Common area','fa-couch'],
                    ['bathroom','Bathroom','fa-bath'],
                    ['kitchen','Kitchen','fa-kitchen-set']];
/* The sections offered when UPLOADING for a flat. The site supervisor (the 'Photos & Videos only'
   tile) uploads Common area and Kitchen only - Bathroom was taken off his screen on 5 Oct 2026.
   Everyone else still has all three, and bathroom photos already uploaded are untouched: the
   lists, Review and the customer's view still know the section. */
function cpaPhUploadAreas(){ return cpaPhotosOnly()?CPA_PH_AREAS.filter(a=>a[0]!=='bathroom'):CPA_PH_AREAS; }
// level -> which of the three pickers it needs. Flat needs all three; the project level needs
// only the project, so the pickers it does not use are hidden rather than left there to be
// filled in pointlessly.
const CPA_PH_LEVELS=[['project','Whole project','fa-city'],
                     ['tower','Block / Tower','fa-building'],
                     ['unit','Flat','fa-door-open']];
let CPA_PH={mode:'upload',level:'project',project:'',tower:'',unit:'',files:{all:[],common:[],bathroom:[],kitchen:[]}};
/* Review (photo approvers only): which section, project, block and status is being looked at, and
   what is ticked. Nothing a site supervisor uploads reaches a customer until it is published here -
   see supabase/migrations/20261005110000_construction_media_approval.sql. */
const CPA_RV={sec:'unit_photos',project:'',tower:'',status:'pending',sel:new Set(),shown:[]};
const CPA_RV_SECS=[['project_photos','Projects','fa-city'],['tower_photos','Blocks','fa-building'],['unit_photos','Flats','fa-door-open']];
const CPA_MEDIA_STATUS={pending:['Waiting for approval','t-amber','fa-hourglass-half'],published:['Published','t-green','fa-circle-check'],
  rejected:['Rejected','t-red','fa-circle-xmark'],unpublished:['Unpublished','t-gray','fa-eye-slash']};
/* What the review panel is showing. It starts wherever the upload pickers are pointing, because
   that is almost always what you want to check straight after uploading - but '' means "all", so
   it can be widened to a whole block or a whole project without disturbing the upload target. */
let CPA_PHF={project:'',tower:'',unit:'',area:''};

function cpaPhCss(){return `<style>
  /* Everything here is sized so the whole screen - pick, upload, review - fits a laptop
     without scrolling. The first version let the chosen-files list grow under the drop zones,
     so each batch pushed the Upload button further down and by the third area it was off the
     bottom of the screen. Nothing on this screen grows now: the zones are a fixed height and
     the file list scrolls inside the zone it belongs to. */
  .cph-wrap{display:flex;flex-direction:column;gap:12px}
  .cph-card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .cph-h{font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:var(--slate);
    margin:0 0 14px;display:flex;align-items:center;gap:8px}
  .cph-h::after{content:"";flex:1;height:1px;background:var(--line)}
  /* Upload | Review, and the approval screen */
  .cph-modes{display:inline-flex;gap:4px;padding:4px;background:#eef2f7;border-radius:11px;align-self:flex-start}
  .cph-md{border:0;background:transparent;padding:8px 16px;border-radius:8px;font:inherit;font-size:13.5px;font-weight:600;color:var(--slate);cursor:pointer;display:inline-flex;align-items:center;gap:8px}
  .cph-md.on{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(15,23,42,.12)}
  .cph-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:#e08600;color:#fff;font-size:11px;font-weight:700;margin-left:4px}
  .cph-note{display:flex;gap:9px;align-items:flex-start;padding:10px 14px;border-radius:10px;background:#fffbeb;border:1px solid #f0dfa8;color:#92400e;font-size:13px}
  .cph-note i{margin-top:2px}
  .cph-why{font-size:11.5px;color:#b91c1c;margin-top:3px;line-height:1.35;max-width:240px}
  .cph-rvbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;min-height:30px}
  .cph-rvg{margin-bottom:18px}
  .cph-rvgh{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:9px;font-size:13.5px}
  .cph-rvgh span{color:var(--slate);font-size:12.5px;margin-right:auto}
  .cph-rvgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
  .cph-rvc{position:relative;border:1px solid var(--line);border-radius:11px;overflow:hidden;background:#fff;display:flex;flex-direction:column;transition:box-shadow .15s,border-color .15s}
  /* Ticked. Its own class name: the site-wide .sel (dropdowns) is 36px tall and squashed the card. */
  .cph-rvc.cph-picked{border-color:#1d4ed8;background:#eff6ff;box-shadow:0 0 0 2px rgba(29,78,216,.28)}
  .cph-rvc.cph-picked .cph-rvm{opacity:.82}
  .cph-rvc.cph-picked .cph-rvd{color:#1d4ed8}
  .btn.cph-tickon{border-color:#1d4ed8;color:#1d4ed8;background:#eff6ff}
  .cph-rvck{position:absolute;top:7px;left:7px;z-index:2;background:rgba(255,255,255,.92);border-radius:6px;padding:3px 4px;line-height:0}
  .cph-rvck input{width:17px;height:17px;margin:0;cursor:pointer}
  .cph-rvm{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;cursor:zoom-in;background:#0f172a}
  .cph-rvm.vid{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:#cbd5e1;font-size:26px;cursor:pointer}
  .cph-rvm.vid span{font-size:11.5px}
  .cph-rvi{padding:8px 10px 4px;font-size:12px}
  .cph-rvd{font-weight:600;color:var(--ink)}
  .cph-rvu{color:var(--slate);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cph-rva{display:flex;gap:6px;padding:4px 10px 10px;margin-top:auto}
  .cph-rva button{flex:1;height:34px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:14px}
  .cph-ok{color:#15803d}.cph-ok:hover{background:#f0fdf4;border-color:#86efac}
  .cph-no{color:#b91c1c}.cph-no:hover{background:#fef2f2;border-color:#fca5a5}
  .cph-un{color:#475569}.cph-un:hover{background:#f1f5f9}
  .cph-mine{font-size:11.5px;color:var(--slate);padding:8px 0}
  /* Review preview */
  .cph-box.cph-pv{padding:0;background:#000}
  .cph-pv .cph-boxbar{z-index:3;padding:14px 18px 30px;background:linear-gradient(rgba(0,0,0,.7),transparent)}
  .cph-pvstage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
  .cph-pv .cph-pvstage img,.cph-pv .cph-pvstage video{position:absolute;inset:0;width:100%;height:100%;max-width:none;max-height:none;
    object-fit:contain;background:transparent;box-shadow:none;border-radius:0}
  .cph-pvload{color:#cbd5e1;font-size:26px}
  .cph-pvhint{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);z-index:2;background:rgba(15,23,42,.72);color:#e2e8f0;
    font-size:12.5px;padding:6px 12px;border-radius:999px;white-space:nowrap}
  .cph-pvn{color:#cbd5e1;font-size:12.5px;margin-left:10px;white-space:nowrap}
  .cph-pvnav{position:absolute;z-index:2;top:50%;transform:translateY(-50%);width:46px;height:46px;border-radius:50%;border:0;
    background:rgba(255,255,255,.16);color:#fff;font-size:18px;cursor:pointer}
  .cph-pvnav:hover{background:rgba(255,255,255,.3)}
  .cph-pvnav.l{left:18px}.cph-pvnav.r{right:18px}
  .cph-pvacts{position:absolute;z-index:3;top:62px;left:0;right:0;display:flex;justify-content:center;gap:12px;flex-wrap:wrap;
    padding:0 16px;pointer-events:none}
  .cph-pvacts>*{pointer-events:auto}
  .cph-pvbtn{height:46px;padding:0 26px;border-radius:10px;border:0;font:inherit;font-size:15px;font-weight:700;cursor:pointer;
    display:inline-flex;align-items:center;gap:9px;box-shadow:0 6px 20px rgba(0,0,0,.55)}
  .cph-pvbtn.ok{background:#16a34a;color:#fff}.cph-pvbtn.ok:hover{background:#15803d}
  .cph-pvbtn.no{background:#dc2626;color:#fff}.cph-pvbtn.no:hover{background:#b91c1c}
  .cph-pvbtn.un{background:#fff;color:#334155}
  .cph-pvnote{color:#e2e8f0;background:rgba(255,255,255,.12);padding:11px 16px;border-radius:10px;font-size:14px}
  @media(max-width:760px){.cph-rvgrid{grid-template-columns:repeat(2,1fr)}.cph-md{padding:8px 12px}
    .cph-pvnav{top:auto;bottom:18px;transform:none}.cph-pvbtn{height:44px;padding:0 20px}}

  /* level buttons and the pickers share one row on a wide screen */
  .cph-bar{display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap}
  .cph-levels{display:flex;gap:6px;background:#f1f5f9;padding:4px;border-radius:10px;flex:none}
  .cph-lv{display:inline-flex;align-items:center;gap:7px;padding:7px 14px;border:0;border-radius:7px;
    background:transparent;cursor:pointer;font:600 13px Segoe UI,Arial,sans-serif;color:var(--slate);transition:.12s}
  .cph-lv:hover{color:var(--ink)}
  .cph-lv.on{background:#fff;color:var(--brand);box-shadow:0 1px 2px rgba(15,23,42,.12)}

  .cph-pick{display:flex;gap:12px;flex-wrap:wrap;flex:1;min-width:0}
  .cph-f{display:flex;flex-direction:column;gap:5px;min-width:150px;flex:1}
  .cph-f>label{font-size:10.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--slate)}
  /* A real menu control rather than the browser's default: fixed height, its own caret, and a
     focus ring that matches the rest of JainE. */
  .cph-sel{position:relative;display:block}
  .cph-sel select,.cph-in{width:100%;height:34px;border:1px solid var(--line);border-radius:8px;
    padding:0 30px 0 11px;font:13.5px Segoe UI,Arial,sans-serif;background:#fff;color:var(--ink);
    appearance:none;-webkit-appearance:none;cursor:pointer;text-overflow:ellipsis}
  .cph-in{padding-right:11px;cursor:text}
  .cph-sel::after{content:"";position:absolute;right:11px;top:50%;margin-top:-2px;pointer-events:none;
    border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid #64748b}
  .cph-sel select:hover{border-color:#94a3b8}
  .cph-sel select:focus,.cph-in:focus{outline:0;border-color:var(--brand);box-shadow:0 0 0 3px rgba(37,99,235,.12)}
  /* The open list itself - a long block of flats should scroll, not run off the screen. */
  .cph-sel select option{padding:6px 8px}

  /* ── drop zones: FIXED height, whatever is in them ── */
  .cph-zones{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
  .cph-zone{border:1.5px dashed var(--line);border-radius:10px;background:#fafcff;cursor:pointer;
    transition:.12s;height:132px;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden}
  .cph-zone:hover{border-color:var(--brand);background:#eff6ff}
  .cph-zone.over{border-color:var(--brand);background:#dbeafe;border-style:solid}
  .cph-zone.has{border-style:solid;border-color:#86efac;background:#fff}
  .cph-zhead{display:flex;align-items:center;gap:7px;padding:0 11px;height:36px;flex:none;box-sizing:border-box}
  .cph-zhead i{font-size:14px;color:var(--slate)}
  .cph-zone.has .cph-zhead i{color:#16a34a}
  .cph-zt{font-size:12.5px;font-weight:700;color:var(--ink)}
  .cph-zn{margin-left:auto;font-size:11px;font-weight:700;color:#16a34a;background:#f0fdf4;
    border:1px solid #bbf7d0;border-radius:999px;padding:1px 7px}
  .cph-zbody{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:5px;color:var(--slate);font-size:11.5px;padding:0 10px 8px;text-align:center}
  /* Camera / Video / Gallery - icon over label so three fit a 200px zone */
  .cph-zbtns{display:flex;gap:6px;width:100%}
  .cph-zb{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;
    height:48px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);cursor:pointer;
    font:600 11.5px Segoe UI,Arial,sans-serif;padding:0 4px}
  .cph-zb i{font-size:15px;color:var(--brand)}
  .cph-zb:hover{border-color:var(--brand);background:#eff6ff}
  .cph-zb:active{background:#dbeafe}
  .cph-zhint{font-size:11px}
  /* the only scrolling part of the screen */
  /* ── what you have chosen but not yet sent: pictures, not filenames ──
     A filename tells you nothing about whether you picked the right photo. These are the real
     images, read straight off the disk before anything is uploaded. The strip sits under the
     zones rather than inside them, and scrolls once it is three rows deep so the Upload button
     never walks off the bottom of the screen. */
  .cph-staged{margin-top:12px;border-top:1px solid var(--line);padding-top:12px}
  .cph-sgroup{margin-bottom:10px}
  .cph-sgroup:last-child{margin-bottom:0}
  .cph-sh{font-size:11px;font-weight:700;color:var(--slate);margin:0 0 6px;display:flex;align-items:center;gap:6px}
  .cph-sh i{color:#16a34a;font-size:11px}
  .cph-sh .n{font-weight:500}
  .cph-strip{display:flex;flex-wrap:wrap;gap:7px;max-height:186px;overflow-y:auto}
  .cph-sthumb{position:relative;width:74px;height:74px;border-radius:8px;overflow:hidden;
    border:1px solid var(--line);background:#f1f5f9;flex:none}
  .cph-sthumb img{width:100%;height:100%;object-fit:cover;display:block}
  .cph-sthumb .vid{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#64748b}
  .cph-sx{position:absolute;top:3px;right:3px;width:19px;height:19px;border-radius:5px;border:0;
    background:rgba(15,23,42,.66);color:#fff;cursor:pointer;font-size:10px;line-height:1;padding:0}
  .cph-sx:hover{background:var(--err)}

  .cph-acts{display:flex;align-items:center;gap:10px;margin-top:12px;flex-wrap:wrap}

  /* ── already uploaded: one row each, so a date, a flat and a caption can be read across ── */
  .cph-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
  /* The headers sat hard against the top of their strip and hard against the title above it.
     A fixed height with vertical-align:middle centres the text in the strip whatever the font
     does, and the strip itself is pushed clear of the section title. */
  .cph-tbl{margin-top:4px}
  .cph-tbl thead th{text-align:left;font-size:10.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;
    color:var(--slate);padding:0 10px;height:36px;vertical-align:middle;background:#f8fafc;
    border-top:1px solid var(--line);border-bottom:1px solid var(--line);white-space:nowrap}
  .cph-tbl thead th:first-child{border-radius:8px 0 0 8px;border-left:1px solid var(--line)}
  .cph-tbl thead th:last-child{border-radius:0 8px 8px 0;border-right:1px solid var(--line)}
  .cph-tbl td{padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
  .cph-tbl tr:last-child td{border-bottom:0}
  .cph-tbl tbody tr:hover{background:#f8fafc}
  .cph-th{width:46px;height:46px;border-radius:7px;object-fit:cover;display:block;cursor:pointer;border:1px solid var(--line)}
  .cph-th.vid{background:#eef2f7;display:flex;align-items:center;justify-content:center;color:#64748b}
  img.cph-th:not([src]),img.cph-rvm:not([src]){background:linear-gradient(90deg,#eef2f7,#f8fafc,#eef2f7);background-size:200% 100%;animation:cphShim 1.2s linear infinite}
  img.cph-noimg{animation:none;background:#eef2f7}
  .cph-vth{position:relative;display:block}
  .cph-vth>i{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#fff;font-size:15px;
    text-shadow:0 1px 6px rgba(0,0,0,.6);pointer-events:none}
  .cph-rvc .cph-vth>i{font-size:30px}
  /* To retake: the uploader's rejected photos, each one tap from the camera for the same place */
  .cph-fix{border-color:#fecaca;background:#fffafa}
  .cph-fix .cph-h{color:#b91c1c}
  .cph-fixsub{font-weight:400;color:var(--slate);font-size:12px;margin-left:8px;text-transform:none;letter-spacing:0}
  .cph-fixl{display:flex;flex-direction:column;gap:8px;max-height:65vh;overflow:auto}
  .cph-fixi{display:flex;align-items:center;gap:12px;padding:8px 10px;border:1px solid #fee2e2;border-radius:10px;background:#fff}
  .cph-fixi .cph-th{width:54px;height:54px;flex:none}
  .cph-fixw{flex:1;min-width:0;font-size:12.5px;color:var(--slate);line-height:1.45}
  .cph-fixw b{display:block;color:var(--ink);font-size:13.5px}
  .cph-fixpv{position:relative;flex:none;padding:0;border:0;background:none;cursor:zoom-in;border-radius:8px}
  .cph-fixpv:hover .cph-th{box-shadow:0 0 0 2px #b91c1c}
  .cph-fixpn{position:absolute;right:-6px;top:-6px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#b91c1c;
    color:#fff;font-size:11px;font-weight:800;display:grid;place-items:center}
  .cph-cnts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}
  .cph-cnt{display:flex;align-items:center;gap:9px;padding:10px 12px;border:1px solid var(--line);border-left:4px solid var(--c);
    border-radius:10px;background:#fff;cursor:pointer;font:inherit;text-align:left}
  .cph-cnt i{color:var(--c);font-size:15px}
  .cph-cnt b{font-size:20px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums}
  .cph-cnt span{font-size:12.5px;color:var(--slate);font-weight:600}
  .cph-cnt:hover{background:#f8fafc}
  .cph-cnt.on{background:color-mix(in srgb,var(--c) 10%,#fff);border-color:var(--c)}
  @media(max-width:620px){ .cph-cnts{grid-template-columns:repeat(2,minmax(0,1fr))} }
  .cph-cntline{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:10px 14px;margin-bottom:12px;border:1px solid var(--line);
    border-radius:12px;background:#fff;font-size:13px}
  .cph-cntline b{color:var(--ink)}
  .cph-cntline span{display:inline-flex;align-items:center;gap:6px;color:var(--ink);font-weight:600}
  .cph-cntline span i{color:var(--c)}
  .cph-fixbtns{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
  .cph-fixst{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;white-space:nowrap}
  .cph-fixst.busy{color:#1d4ed8;padding:0 6px}
  .cph-fixst.taken{background:#dcfce7;border-color:#86efac;color:#15803d}
  .cph-fixi.st-busy,.cph-fixi.st-taken{border-color:#bbf7d0;background:#f7fef9}
  .cph-fixnew{position:relative;flex:none;padding:0;border:0;background:none;cursor:zoom-in}
  .cph-fixnew .cph-th{width:54px;height:54px;border:2px solid #16a34a}
  .cph-fixok{position:absolute;right:-6px;top:-6px;width:18px;height:18px;border-radius:50%;background:#16a34a;color:#fff;font-size:10px;display:grid;place-items:center}
  .cph-fixup{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:4px 0 10px;padding:10px 12px;
    border:1px solid #86efac;background:#f0fdf4;border-radius:10px;font-size:13px;color:#166534;font-weight:600}
  .cph-fixup span i{margin-right:5px}
  @media(max-width:620px){ .cph-fixup .btn{width:100%;justify-content:center} }
  /* The section always sits on its own line under the flat number, so every row lines up the same. */
  .cph-fixsec{display:table;margin-top:4px;padding:1px 9px;border-radius:999px;background:#fef2f2;color:#b91c1c;font-size:12px;font-weight:700;white-space:nowrap}
  @media(max-width:620px){ .cph-fixi{flex-wrap:wrap} .cph-fixbtns{width:100%} .cph-fixbtns .btn{flex:1 1 0;justify-content:center} }
  .cph-fixg{font-size:11.5px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#b91c1c;margin:6px 2px -2px}
  .cph-fixg:first-child{margin-top:0}
  .cph-fixs{display:flex;flex-direction:column;gap:6px;margin:2px 0 4px}
  .cph-fixr{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .cph-fixp{min-width:150px;font-size:13px;font-weight:700;color:var(--ink)}
  .cph-fixcs{display:flex;gap:6px;flex-wrap:wrap}
  .cph-fixc{display:inline-flex;align-items:center;gap:8px;border:1px solid #fecaca;background:#fff;color:#b91c1c;border-radius:999px;
    padding:5px 6px 5px 13px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
  .cph-fixc b{min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:#fee2e2;color:#b91c1c;font-size:12px;
    display:inline-grid;place-items:center;font-weight:800}
  .cph-fixc:hover{background:#fef2f2}
  .cph-fixc.on{background:#b91c1c;border-color:#b91c1c;color:#fff}
  .cph-fixc.on b{background:#fff;color:#b91c1c}
  .cph-fixt{margin:12px 0 8px;padding-top:10px;border-top:1px solid #fde2e2;font-size:12px;font-weight:800;letter-spacing:.4px;
    text-transform:uppercase;color:#7f1d1d}
  .cph-fixhint{margin-top:10px;font-size:12.5px;color:var(--slate)}
  .cph-fixhint i{color:#b91c1c;margin-right:4px}
  @media(max-width:620px){ .cph-fixp{min-width:0;width:100%} }
  .cph-retake{display:inline-flex;align-items:center;gap:6px;margin-top:5px;padding:5px 11px;border-radius:8px;cursor:pointer;
    font:inherit;font-size:12px;font-weight:700;border:1px solid #1d4ed8;background:#1d4ed8;color:#fff}
  .cph-retake:hover{background:#1e40af}
  @keyframes cphShim{to{background-position:-200% 0}}
  .cph-when{white-space:nowrap;font-weight:600;color:var(--ink)}
  .cph-area{display:inline-block;font-size:11px;font-weight:600;padding:2px 9px;border-radius:999px;
    background:#eff6ff;color:#1e40af;white-space:nowrap}
  .cph-rm{border:1px solid var(--line);background:#fff;color:var(--slate);border-radius:7px;
    width:28px;height:28px;cursor:pointer;font-size:11px}
  .cph-rm:hover{border-color:var(--err);color:var(--err)}

  /* Filters for what is already there. Separate from the pickers at the top: those say where the
     next upload goes, these say what you want to look at, and the two are not always the same
     question - "show me every kitchen in Block E" is not an upload target. */
  .cph-filters{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px;
    padding-bottom:14px;border-bottom:1px solid var(--line)}
  .cph-filters .cph-f{min-width:130px}
  .cph-fcount{font-size:11.5px;color:var(--slate);margin-left:auto;padding-bottom:8px;white-space:nowrap}

  /* A staged photo, full size, before it goes anywhere. */
  .cph-box{position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,.82);display:flex;
    align-items:center;justify-content:center;padding:32px}
  .cph-box img,.cph-box video{max-width:92vw;max-height:84vh;border-radius:10px;display:block;
    box-shadow:0 20px 60px rgba(0,0,0,.5);background:#000}
  .cph-boxbar{position:absolute;top:0;left:0;right:0;padding:14px 18px;display:flex;align-items:center;
    gap:12px;color:#e8eaed;font-size:13px;background:linear-gradient(rgba(0,0,0,.55),transparent)}
  .cph-boxbar .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cph-boxx{margin-left:auto;border:0;background:rgba(255,255,255,.14);color:#fff;border-radius:8px;
    width:32px;height:32px;cursor:pointer;font-size:16px;line-height:1;flex:none}
  .cph-boxx:hover{background:rgba(255,255,255,.28)}
  .cph-sthumb{cursor:zoom-in}
  .cph-empty{padding:18px;text-align:center;color:var(--slate);font-size:12.5px;
    border:1px dashed var(--line);border-radius:10px}
  /* the review panel is the one thing allowed to be long, and it scrolls on its own */
  .cph-review{max-height:330px;overflow-y:auto}
  .cph-areahead{font-size:11.5px;font-weight:700;color:var(--ink);margin:12px 0 7px;display:flex;align-items:center;gap:7px}
  .cph-areahead .n{font-weight:500;color:var(--slate)}
  @media(max-width:820px){.cph-bar{align-items:stretch}.cph-pick{width:100%}}
  /* Phone - mostly site staff standing in the flat. Full-width tap targets, 16px controls (smaller
     makes iOS zoom on focus), zones stacked, and the uploaded list reflowed into rows of
     thumbnail | details | delete instead of a table squeezed sideways. */
  @media(max-width:760px){
    .cph-card{padding:12px}
    .cph-levels{width:100%;box-sizing:border-box}
    .cph-lv{flex:1;justify-content:center;padding:10px 6px}
    .cph-f{flex:1 1 100%;min-width:0;max-width:none!important}
    .cph-sel select,.cph-in{height:46px;font-size:16px}
    .cph-zones{grid-template-columns:1fr!important}
    .cph-zone{height:auto;min-height:0}
    .cph-zb{height:56px;font-size:13px}
    .cph-zb i{font-size:18px}
    .cph-zhint{display:none}
    .cph-acts .btn{flex:1;justify-content:center;min-height:48px;font-size:15px}
    .cph-acts span{flex-basis:100%}
    .cph-filters .cph-f{flex:1 1 calc(50% - 5px)}
    .cph-fcount{margin-left:0;padding-bottom:0;flex-basis:100%}
    .cph-review{max-height:none}
    .cph-tbl,.cph-tbl tbody{display:block;width:100%}
    .cph-tbl thead{display:none}
    .cph-tbl tr{display:grid;grid-template-columns:56px minmax(0,1fr) auto;column-gap:12px;row-gap:0;
      align-items:center;padding:10px 2px;border-bottom:1px solid var(--line)}
    .cph-tbl tr:last-child{border-bottom:0}
    .cph-tbl td{display:block;padding:1px 0;border:0;grid-column:2;min-width:0;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .cph-tbl td:first-child{grid-column:1;grid-row:1/span 20;padding:0}
    .cph-tbl td:last-child{grid-column:3;grid-row:1/span 20;padding:0}
    .cph-th{width:56px;height:56px}
    .cph-rm{width:40px;height:40px;font-size:13px}
    .cph-box{padding:12px}
  }
</style>`;}

async function cpaRenderPhotos(host){
  const [projects,units]=await Promise.all([cpaProjects(),cpaUnits()]);
  if(!CPA_PH.project&&projects.length) CPA_PH.project=await cpaPhStartProject(projects,units);
  host.innerHTML=cpaPhCss()+'<div class="cph-wrap" id="cphWrap"></div>';
  if(CPA_PH.mode==='review'&&cpaIsPhotoApprover()) cpaRvPaint(projects,units);
  else{ CPA_PH.mode='upload'; cpaPhPaint(projects,units); }
}
/* Which project Photos & Videos opens on (7 Oct 2026). The first one alphabetically was Dream
   Ananta, so the site team - who work on Dream Gurukul - opened on a project with nothing for them.
   Now: the project with the most rejected photos waiting for a retake (that this account can retake),
   otherwise the one with the most flats. */
async function cpaPhStartProject(projects,units){
  const ids=new Set(projects.map(p=>String(p.id)));
  const unitProj={}; (units||[]).forEach(u=>{ unitProj[u.id]=String(u.project_id); });
  const score={};
  try{
    const areas=cpaPhUploadAreas().map(a=>a[0]);
    const [up,tp,pp]=await Promise.all([
      sb.schema('cust').from('unit_photos').select('unit_id,area').eq('status','rejected').is('deleted_at',null).limit(5000),
      sb.schema('cust').from('tower_photos').select('project_id').eq('status','rejected').is('deleted_at',null).limit(5000),
      sb.schema('cust').from('project_photos').select('project_id').eq('status','rejected').is('deleted_at',null).limit(5000)]);
    ((up&&up.data)||[]).forEach(r=>{ if(areas.indexOf(r.area||'common')===-1) return; const k=unitProj[r.unit_id]; if(k) score[k]=(score[k]||0)+1; });
    ((tp&&tp.data)||[]).concat((pp&&pp.data)||[]).forEach(r=>{ const k=String(r.project_id); score[k]=(score[k]||0)+1; });
  }catch(_e){}
  const flats={}; (units||[]).forEach(u=>{ if(u.status!=='cancelled'){ const k=String(u.project_id); flats[k]=(flats[k]||0)+1; } });
  const best=Object.keys(score).filter(k=>ids.has(k)).sort((a,b)=>score[b]-score[a])[0]
    ||Object.keys(flats).filter(k=>ids.has(k)).sort((a,b)=>flats[b]-flats[a])[0];
  return best||String(projects[0].id);
}
// Upload | Review, for photo approvers. The Review count is everything still waiting, anywhere.
function cpaPhModeBar(){
  if(!cpaIsPhotoApprover()) return '';
  const b=(m,ic,label,extra)=>'<button class="cph-md'+(CPA_PH.mode===m?' on':'')+'" onclick="cpaPhSetMode(\''+m+'\')"><i class="fa-solid '+ic+'"></i>'+label+(extra||'')+'</button>';
  return '<div class="cph-modes">'+b('upload','fa-cloud-arrow-up','Upload')
    +b('review','fa-stamp','Review','<span class="cph-badge" id="cphPendBadge" style="display:none"></span>')+'</div>';
}
async function cpaPhFillBadge(){
  const el=$('cphPendBadge'); if(!el) return;
  try{
    const res=await Promise.all(CPA_RV_SECS.map(s=>sb.schema('cust').from(s[0]).select('id',{count:'exact',head:true}).eq('status','pending').is('deleted_at',null)));
    const n=res.reduce((t,r)=>t+(r.count||0),0);
    el.textContent=n>999?'999+':String(n); el.style.display=n?'inline-flex':'none';
  }catch(_e){}
}
window.cpaPhSetMode=function(m){ CPA_PH.mode=m; CPA_RV.sel.clear(); if(m==='review'){ CPA_RV.status='pending'; CPA_RV.picked=false; } route(); };

// Everything on screen is redrawn from CPA_PH, so there is one description of the state and no
// way for the pickers, the form and the list to disagree about which flat is being looked at.
async function cpaPhPaint(projects,units){
  projects=projects||await cpaProjects(); units=units||await cpaUnits();
  const wrap=$('cphWrap'); if(!wrap) return;
  const lvl=CPA_PH.level;
  const needTower=(lvl==='tower'||lvl==='unit'), needUnit=(lvl==='unit');

  const towers=cpaTowersForProject(units,CPA_PH.project);
  if(needTower&&towers.length&&towers.indexOf(CPA_PH.tower)<0) CPA_PH.tower=towers[0];
  const flats=cpaPhFlats(units);
  if(needUnit&&flats.length&&!flats.some(u=>String(u.id)===String(CPA_PH.unit))) CPA_PH.unit=String(flats[0].id);

  const today=new Date().toISOString().slice(0,10);
  // When each flat last had something uploaded, shown beside it in the Flat picker (dd/mm/yy).
  const lastUp=needUnit?await cpaPhLastUploads(flats.map(u=>u.id)):{};
  if(!$('cphWrap')) return;
  wrap.innerHTML=cpaPhModeBar()
    +'<div id="cphFix"></div>'
    +'<div class="cph-card">'
      +'<div class="cph-bar">'
        +'<div class="cph-levels">'
          +CPA_PH_LEVELS.map(l=>'<button class="cph-lv'+(lvl===l[0]?' on':'')+'" onclick="cpaPhSetLevel(\''+l[0]+'\')">'
             +'<i class="fa-solid '+l[2]+'"></i>'+esc(l[1])+'</button>').join('')
        +'</div>'
        +'<div class="cph-pick">'
          +'<div class="cph-f"><label>Project</label><div class="cph-sel"><select onchange="cpaPhSet(\'project\',this.value)">'
            +projects.map(p=>'<option value="'+p.id+'"'+(String(p.id)===String(CPA_PH.project)?' selected':'')+'>'+esc(p.name)+'</option>').join('')
          +'</select></div></div>'
          +(needTower?'<div class="cph-f"><label>Block</label><div class="cph-sel"><select id="cphTower" onchange="cpaPhSet(\'tower\',this.value)">'
            +(towers.length?towers.map(t=>'<option'+(t===CPA_PH.tower?' selected':'')+'>'+esc(t)+'</option>').join('')
                           :'<option value="">No blocks on record</option>')
          +'</select></div></div>':'')
          +(needUnit?'<div class="cph-f"><label>Flat</label><div class="cph-sel"><select id="cphUnit" onchange="cpaPhSet(\'unit\',this.value)">'
            +(flats.length?flats.map(u=>'<option value="'+u.id+'"'+(String(u.id)===String(CPA_PH.unit)?' selected':'')+'>'+esc(u.unit_code)
                +(lastUp[u.id]?'\u00a0\u00a0\u00a0\u00a0\u00b7\u00a0\u00a0\u00a0\u00a0'+cpaDdMmYy(lastUp[u.id]):'')+'</option>').join('')
                          :'<option value="">No flats in this block</option>')
          +'</select></div></div>':'')
        +'</div>'
      +'</div>'
    +'</div>'

    +'<div class="cph-card">'
      +'<div class="cph-bar" style="margin-bottom:12px">'
        +'<div class="cph-f" style="max-width:190px"><label>Date shown to customers</label>'
          +'<input type="date" class="cph-in" id="cphDate" value="'+today+'"></div>'
      +'</div>'
      +(lvl==='unit'
        ? '<div class="cph-zones">'+cpaPhUploadAreas().map(a=>cpaPhZone(a[0],a[1],a[2])).join('')+'</div>'
        : '<div class="cph-zones" style="grid-template-columns:1fr">'+cpaPhZone('all','Photos or videos','fa-images')+'</div>')
      +'<div class="cph-staged" id="cphStaged" style="display:none"></div>'
      +'<div class="cph-acts">'
        +'<button class="btn btn-primary" id="cphGo" onclick="cpaPhUpload()">'
          +'<i class="fa-solid fa-cloud-arrow-up"></i> Upload</button>'
        +'<button class="btn" id="cphClear" onclick="cpaPhClear()">Clear all</button>'
        +(lvl==='unit'?'<span style="font-size:11.5px;color:var(--slate)">'+(cpaPhUploadAreas().length===2?'Either or both':'Any one, two or all three')+' \u2014 they go up together.</span>':'')
      +'</div>'
    +'</div>'

    // A photos-only account (the site team) has no "Already uploaded" list: what it needs to act on
    // is in "To retake", and the review is the post-sales team's (6 Oct 2026). Without #cphList,
    // cpaPhList() does nothing.
    +(cpaPhotosOnly()?'':'<div class="cph-card">'
      +'<div class="cph-h"><i class="fa-solid fa-images"></i>Already uploaded</div>'
      +'<div id="cphList" class="cph-review"><div class="cph-empty">Loading\u2026</div></div>'
    +'</div>');

  cpaPhWireZones();
  cpaPhStaged();
  cpaPhSyncActions();
  cpaPhList();
  cpaPhFillBadge();
  cpaPhFixList(projects,units);
}

/* TO RETAKE: every rejected photo still waiting for a replacement, whoever took it - on site,
   whoever is there retakes it. One line per place (flat and section, block, or project), because
   one new photo there replaces all the rejected ones at that place (cust.replace_rejected_media).
   Retake opens the camera at once and points the form at that place. The same Retake is on each
   rejected row of "Already uploaded" (cpaPhRetakeBtn). */
async function cpaPhFixList(projects,units){
  const host=$('cphFix'); if(!host) return;
  projects=projects||CPA_PH.fixProjects||await cpaProjects(); units=units||CPA.units||await cpaUnits();
  CPA_PH.fixProjects=projects;
  // Retaking is the site team's job: only photos-only accounts get this list (6 Oct 2026). An admin
  // sees rejected photos in "Already uploaded" and in Review > Rejected, without Retake.
  if(!cpaPhotosOnly()){ host.innerHTML=''; return; }
  const res=await Promise.all(CPA_RV_SECS.map(s=>sb.schema('cust').from(s[0]).select('*').eq('status','rejected')
    .is('deleted_at',null).order('reviewed_at',{ascending:false}).limit(200)));
  if(!$('cphFix')) return;
  const projOf={}; (projects||[]).forEach(p=>{projOf[p.id]=p;});
  const byPlace={}, order=[];
  CPA_RV_SECS.forEach((s,k)=>((res[k]&&res[k].data)||[]).forEach(p=>{
    const t=s[0], w=cpaPhPlaceOf(t,p,units);
    // Only what this person can retake: a photos-only uploader has no Bathroom section, so rejected
    // Bathroom photos are not theirs to fix and are left out (6 Oct 2026).
    if(!w.can) return;
    const key=t+'|'+w.key;
    if(!byPlace[key]){ byPlace[key]={t,p,w,place:w.place,can:w.can,pn:projOf[w.pid]?String(projOf[w.pid].name).split('(')[0].trim():'',
      n:0,when:p.reviewed_at||p.created_at,notes:[]}; order.push(key); }
    const g=byPlace[key]; g.n++; (g.ps=g.ps||[]).push(p);
    if(p.review_note&&g.notes.indexOf(p.review_note)===-1) g.notes.push(p.review_note);
  }));
  /* Floor-wise, the way the site is walked: project by project; within one, the whole-project
     photos, then the blocks, then the flats - block by block, floor by floor (ground up), flat by
     flat, section by section. Asked for on 6 Oct 2026. */
  const nat=(a,b)=>String(a||'').localeCompare(String(b||''),undefined,{numeric:true,sensitivity:'base'});
  const items=order.map(k=>byPlace[k]).sort((a,b)=>{
    const x=a.w, y=b.w;
    return nat(a.pn,b.pn)||(x.lvl-y.lvl)||nat(x.tower,y.tower)
      ||((x.floor==null)-(y.floor==null))||((x.floor||0)-(y.floor||0))||nat(x.code,y.code)||((x.areaIdx||0)-(y.areaIdx||0));
  });
  CPA_PH.fixItems=items;
  cpaPhFixRender();
}
/* Where a row stands right now (8 Oct 2026), so it is never unclear what has been taken: being
   uploaded; taken and waiting in the upload form (the upload failed, or it was added by hand); or
   still to retake. */
function cpaPhFixState(it){
  const key=it.t+'|'+it.w.key;
  if(CPA_PH.fixBusy&&CPA_PH.fixBusy.has&&CPA_PH.fixBusy.has(key)) return 'busy';
  return (CPA_PH.retakes||{})[key]?'taken':'';
}
function cpaPhFixRender(){
  const host=$('cphFix'); if(!host||!CPA_PH.fixItems) return;
  const items=CPA_PH.fixItems;
  /* The site team's view (7 Oct 2026): only the project picked above; the count on top is in
     PLACES to photograph - flats, blocks - not photos. The list is block by block ("A1 · 3 flats"),
     then one row per flat and section ("Flat 2A · Common area", "Flat 2A · Kitchen"), each with its
     own Retake, floor by floor. */
  const LV={project:0,tower:1,unit:2}, LVKEY=['project','tower','unit'], LVNAME=['Whole project','Blocks','Flats'];
  const cur=LV[CPA_PH.level]!=null?LV[CPA_PH.level]:0, pid=String(CPA_PH.project||'');
  const mine=items.filter(it=>String(it.w.pid)===pid);
  CPA_PH.fix=mine;                      // Retake refers to these by index
  // The full-size view steps through one row's photos: one group per row.
  CPA_PH.fixGroups=mine.map(it=>({lvl:it.w.lvl,w:it.w,items:[it]}));
  if(!mine.length){ host.innerHTML=''; return; }
  const places=l=>new Set(mine.filter(it=>it.w.lvl===l).map(it=>l===2?String(it.p.unit_id):l===1?it.w.tower:'p')).size;
  const counts=[places(0),places(1),places(2)];
  const blk=t=>String(t||'').replace(/^block\s*/i,'').trim();
  const secName=it=>(CPA_PH_AREAS.find(a=>a[0]===(it.p.area||'common'))||[0,'Photo'])[1];
  const chips='<div class="cph-fixcs" style="margin:2px 0 4px">'+[0,1,2].filter(l=>counts[l]).map(l=>{
      const on=l===cur;
      return '<button class="cph-fixc'+(on?' on':'')+'" onclick="cpaPhSetLevel(\''+LVKEY[l]+'\')"'+(on?' aria-current="true"':'')+'>'
        +LVNAME[l]+'<b>'+counts[l]+'</b></button>'; }).join('')+'</div>';
  const shown=mine.filter(it=>it.w.lvl===cur);
  const flatsIn={}; shown.forEach(it=>{ if(it.w.lvl===2) (flatsIn[it.w.tower||'']=flatsIn[it.w.tower||'']||new Set()).add(String(it.p.unit_id)); });
  const rows=shown.map((it,n)=>{
    const w=it.w, prev=shown[n-1], k=mine.indexOf(it);
    const head=w.lvl===2&&(!prev||prev.w.tower!==w.tower)
      ?'<div class="cph-fixg">'+esc(blk(w.tower)||'Flats')+' · '+flatsIn[w.tower||''].size+' flat'+(flatsIn[w.tower||''].size===1?'':'s')+'</div>':'';
    const p=it.p, isVid=(p.file_type||'').indexOf('video')===0;
    const th=(isVid&&!p.thumb_path?'<div class="cph-th vid"><i class="fa-solid fa-circle-play"></i></div>'
      :'<img class="cph-th" '+cphThumbAttrs(p,it.t)+' alt="" decoding="async">');
    const thBtn='<button type="button" class="cph-fixpv" onclick="cpaPhFixPreview('+k+',0)" title="See what was rejected, full size">'+th
      +(it.n>1?'<span class="cph-fixpn">'+it.n+'</span>':'')+'</button>';
    const title=w.lvl===2?'Flat '+(w.code||''):w.lvl===1?(w.tower||'Block'):'Whole project';
    const st=cpaPhFixState(it), rkey=it.t+'|'+w.key, rt=(CPA_PH.retakes||{})[rkey];
    const newPic=rt?'<button type="button" class="cph-fixnew" onclick="cpaPhRetakeView(\''+rkey.replace(/'/g,"\\'")+'\')" title="Check the new photo full size">'
        +(rt.isVid||!rt.url?'<div class="cph-th vid"><i class="fa-solid fa-circle-play"></i></div>':'<img class="cph-th" src="'+rt.url+'" alt="">')
        +'<span class="cph-fixok"><i class="fa-solid fa-check"></i></span></button>':'';
    const right=st==='busy'?'<span class="cph-fixst busy"><i class="fa-solid fa-spinner fa-spin"></i> Uploading…</span>'
      :st==='taken'?newPic+'<div class="cph-fixbtns"><button class="btn btn-sm" onclick="cpaPhRetake('+k+','+(isVid?1:0)+')"><i class="fa-solid fa-camera-rotate"></i> Retake again</button>'
          +'<button class="btn btn-sm" onclick="cpaPhRetakeDrop(\''+rkey.replace(/'/g,"\\'")+'\')" title="Discard the new photo">&times;</button></div>'
      :(it.can?'<button class="btn btn-sm btn-primary" onclick="cpaPhRetake('+k+','+(isVid?1:0)+')"><i class="fa-solid fa-'+(isVid?'video':'camera')+'"></i> Retake</button>':'');
    return head+'<div class="cph-fixi'+(st?' st-'+st:'')+'">'+thBtn
      +'<div class="cph-fixw"><b>'+esc(title)+'</b>'+(w.lvl===2?'<span class="cph-fixsec">'+esc(secName(it))+'</span>':'')
        +esc(it.notes.join(' · '))+'</div>'
      +right
      +'</div>';
  }).join('');
  const nTaken=Object.keys(CPA_PH.retakes||{}).length, uploading=!!(CPA_PH.fixBusy&&CPA_PH.fixBusy.size);
  const upBar=nTaken||uploading?'<div class="cph-fixup"><span><i class="fa-solid fa-circle-check"></i> '+(uploading?'Uploading…':nTaken+' new photo'+(nTaken===1?'':'s')+' taken - check them, then upload')+'</span>'
      +'<button class="btn btn-primary" onclick="cpaPhRetakeUpload()"'+(uploading?' disabled':'')+'><i class="fa-solid fa-'+(uploading?'spinner fa-spin':'cloud-arrow-up')+'"></i> Upload'+(nTaken?' '+nTaken+' photo'+(nTaken===1?'':'s'):'')+'</button></div>':'';
  host.innerHTML='<div class="cph-card cph-fix"><div class="cph-h"><i class="fa-solid fa-camera-rotate"></i>Photos to retake</div>'
    +upBar
    +chips
    +(shown.length?'<div class="cph-fixl" style="margin-top:10px">'+rows+'</div>'
      :'<div class="cph-fixhint"><i class="fa-solid fa-hand-pointer"></i> Tap a number above to see those and retake them.</div>')
    +'</div>';
  cphLazy(host);
}
/* Full-size view of what was rejected for one flat (or block): every rejected photo there, section
   by section, the reviewer's reason if given, and Retake for the section on screen. */
window.cpaPhFixPreview=async function(gi,k){
  const g=(CPA_PH.fixGroups||[])[gi]; if(!g) return;
  const list=[]; g.items.forEach(it=>(it.ps&&it.ps.length?it.ps:[it.p]).forEach(ph=>list.push({it,ph})));
  k=Math.max(0,Math.min(list.length-1,k||0));
  const {it,ph}=list[k], isVid=(ph.file_type||'').indexOf('video')===0;
  const old=$('cphFixPv'); if(old) old.remove();
  const box=document.createElement('div'); box.className='cph-box cph-pv'; box.id='cphFixPv';
  const blk=t=>String(t||'').replace(/^block\s*/i,'').trim();
  const title=g.lvl===2?(blk(g.w.tower)?blk(g.w.tower)+' · ':'')+'Flat '+(g.w.code||''):g.lvl===1?(g.w.tower||'Block'):'Whole project';
  const sec=g.lvl===2?((CPA_PH_AREAS.find(a=>a[0]===(ph.area||'common'))||[0,''])[1]):'';
  const info=[sec,ph.review_note?'Reason: '+ph.review_note:''].filter(Boolean).join(' · ');
  box.innerHTML='<div class="cph-boxbar"><i class="fa-solid '+(isVid?'fa-circle-play':'fa-image')+'"></i>'
      +'<span class="nm"><b>'+esc(title)+'</b>'+(info?' · '+esc(info):'')+'</span>'
      +(list.length>1?'<span class="cph-pvn">'+(k+1)+' of '+list.length+'</span>':'')
      +'<button class="cph-boxx" title="Close (Esc)">&times;</button></div>'
    +(k>0?'<button class="cph-pvnav l" title="Previous (←)"><i class="fa-solid fa-chevron-left"></i></button>':'')
    +(k<list.length-1?'<button class="cph-pvnav r" title="Next (→)"><i class="fa-solid fa-chevron-right"></i></button>':'')
    +(it.can?'<div class="cph-pvacts"><button class="cph-pvbtn ok cph-fixrt"><i class="fa-solid fa-'+(isVid?'video':'camera')+'"></i> Retake'+(sec?' '+esc(sec):'')+'</button></div>':'')
    +'<div class="cph-pvstage"><div class="cph-pvload"><i class="fa-solid fa-spinner fa-spin"></i></div></div>';
  const shut=()=>{ document.removeEventListener('keydown',onKey); box.remove(); };
  const onKey=e=>{ if(e.key==='Escape') shut(); else if(e.key==='ArrowRight'&&k<list.length-1){ shut(); cpaPhFixPreview(gi,k+1); }
    else if(e.key==='ArrowLeft'&&k>0){ shut(); cpaPhFixPreview(gi,k-1); } };
  box.querySelector('.cph-boxx').onclick=shut;
  const l=box.querySelector('.cph-pvnav.l'), r=box.querySelector('.cph-pvnav.r');
  if(l) l.onclick=()=>{ shut(); cpaPhFixPreview(gi,k-1); };
  if(r) r.onclick=()=>{ shut(); cpaPhFixPreview(gi,k+1); };
  // Retake straight from here: the camera has to open inside this tap.
  const rt=box.querySelector('.cph-fixrt'); if(rt) rt.onclick=()=>{ shut(); cpaPhRetake(CPA_PH.fix.indexOf(it),isVid?1:0); };
  box.onclick=e=>{ if(e.target===box) shut(); };
  document.addEventListener('keydown',onKey);
  document.body.appendChild(box);
  const stage=box.querySelector('.cph-pvstage'); if(!stage) return;
  cphPreload(list[k+1]&&list[k+1].ph); cphPreload(list[k-1]&&list[k-1].ph);
  await cphFullInto(stage,box,ph);
};
// A button in "Photos to retake": open that project at that level. Same project: only the level
// changes, so the block and flat picked stay as they were.
window.cpaPhFixGo=function(projectId,level){
  if(String(projectId)!==String(CPA_PH.project)){ CPA_PH.project=String(projectId); CPA_PH.tower=''; CPA_PH.unit=''; }
  cpaPhSetLevel(level);
};
// The floor a flat is on, from its code: 2G -> 2, 11A -> 11, 13-14A -> 13. Codes that do not start
// with a number (the Eco City bungalows: A1, K6) have no floor and sort after the rest by code.
function cpaFloorOf(code){ const m=/^(\d+)/.exec(String(code||'').trim()); return m?Number(m[1]):null; }
// Where a photo belongs, in words, and whether this uploader's screen can take a new one there
// (a photos-only uploader has no Bathroom section).
function cpaPhPlaceOf(t,p,units){
  if(t==='unit_photos'){
    const u=(units||CPA.units||[]).find(x=>String(x.id)===String(p.unit_id));
    const area=p.area||'common';
    const a=(CPA_PH_AREAS.find(x=>x[0]===area)||[0,area])[1];
    return {key:p.unit_id+'|'+area, pid:u&&u.project_id,
      place:(u?(u.tower?u.tower+' · ':'')+'Flat '+u.unit_code:'Flat')+' · '+a,
      can:!!u&&cpaPhUploadAreas().some(x=>x[0]===area),
      lvl:2, tower:u?String(u.tower||''):'', code:u?String(u.unit_code||''):'', floor:u?cpaFloorOf(u.unit_code):null,
      areaIdx:Math.max(0,CPA_PH_AREAS.findIndex(x=>x[0]===area))};
  }
  if(t==='tower_photos') return {key:p.project_id+'|'+p.tower, pid:p.project_id, place:p.tower||'Block', can:true, lvl:1, tower:String(p.tower||'')};
  if(t==='project_photos') return {key:String(p.project_id), pid:p.project_id, place:'Whole project', can:true, lvl:0};
  return {key:t+p.id, pid:p.project_id, place:'Floor '+(p.floor_no||''), can:false};
}
window.cpaPhRetake=function(i,isVid){ const it=(CPA_PH.fix||[])[i]; if(it) cpaPhRetakeAt(it.t,it.p,it.place,isVid); };
// Retake on a rejected row of "Already uploaded".
const CPA_PH_REJ={};
function cpaPhRetakeBtn(t,p){
  if(!cpaPhotosOnly()) return '';
  const w=cpaPhPlaceOf(t,p); if(!w.can) return '';
  CPA_PH_REJ[t+':'+p.id]=p;
  const isVid=(p.file_type||'').indexOf('video')===0;
  return '<button class="cph-retake" onclick="cpaPhRetakeRow(\''+t+'\','+p.id+','+(isVid?1:0)+')"><i class="fa-solid fa-'+(isVid?'video':'camera')+'"></i> Retake</button>';
}
window.cpaPhRetakeRow=function(t,id,isVid){ const p=CPA_PH_REJ[t+':'+id]; if(p) cpaPhRetakeAt(t,p,cpaPhPlaceOf(t,p).place,isVid); };
/* RETAKE (8 Oct 2026): the camera opens and the new photo is kept in its row - not uploaded - so
   it can be looked at and retaken again until it is clear. "Upload N photos" at the top of the card
   sends every retaken photo to its own flat and section in one go (cpaPhRetakeUpload). The upload
   form below is not touched, so a retake can never go up under another flat. */
function cpaPhRetakeAt(t,p,place,isVid){
  CPA_PH.retakes=CPA_PH.retakes||{};
  const key=t+'|'+cpaPhPlaceOf(t,p).key;
  // The camera has to open inside this tap - a phone refuses it once the click has been handled.
  const inp=document.createElement('input');
  inp.type='file'; inp.accept=isVid?'video/*':'image/*'; inp.setAttribute('capture','environment');
  inp.onchange=function(){
    const f=inp.files&&inp.files[0]; if(!f) return;
    const old=CPA_PH.retakes[key]; if(old&&old.url){ try{ URL.revokeObjectURL(old.url); }catch(_e){} }
    let url=''; try{ url=URL.createObjectURL(f); }catch(_e){}
    CPA_PH.retakes[key]={file:f,url,t,p,place,isVid:/^video\//.test(f.type||'')};
    cpaPhFixRender();
    toast('Taken for '+place+' — check it, then Upload','ok');
  };
  inp.click();
}
window.cpaPhRetakeDrop=function(key){
  const r=(CPA_PH.retakes||{})[key]; if(!r) return;
  if(r.url){ try{ URL.revokeObjectURL(r.url); }catch(_e){} }
  delete CPA_PH.retakes[key]; cpaPhFixRender();
};
// The retaken photo, full size, before it is uploaded.
window.cpaPhRetakeView=function(key){
  const r=(CPA_PH.retakes||{})[key]; if(!r||!r.url) return;
  const box=document.createElement('div'); box.className='cph-box';
  box.innerHTML='<div class="cph-boxbar"><i class="fa-solid '+(r.isVid?'fa-circle-play':'fa-image')+'"></i><span class="nm"><b>New photo</b> · '+esc(r.place)+'</span>'
    +'<button class="cph-boxx" title="Close (Esc)">&times;</button></div>'
    +(r.isVid?'<video src="'+r.url+'" controls autoplay playsinline></video>':'<img src="'+r.url+'" alt="">');
  const shut=()=>{ document.removeEventListener('keydown',onKey); box.remove(); };
  const onKey=e=>{ if(e.key==='Escape') shut(); };
  box.onclick=e=>{ if(e.target===box) shut(); };
  box.querySelector('.cph-boxx').onclick=shut;
  document.addEventListener('keydown',onKey);
  document.body.appendChild(box);
};
// Sends every retaken photo to its own place: made smaller first, a thumbnail, a pending row, the
// approvers told, and the rejected photo at that place replaced - the same as an ordinary upload.
window.cpaPhRetakeUpload=async function(){
  const all=CPA_PH.retakes||{}, keys=Object.keys(all); if(!keys.length) return;
  const takenOn=($('cphDate')||{}).value||new Date().toISOString().slice(0,10);
  CPA_PH.fixBusy=new Set(keys); cpaPhFixRender();
  let ok=0; const failed=[], newIds={};
  for(const key of keys){
    const r=all[key], f=r.file, p=r.p, t=r.t;
    try{
      const prep=await cphPrepare(f);
      const name=prep.full!==f?String(f.name||'photo').replace(/\.[^.]*$/,'')+'.jpg':(f.name||'photo');
      let sk,row;
      if(t==='unit_photos'){ sk=s3KeyForUnitPhoto(p.unit_id,name); row={unit_id:Number(p.unit_id),area:p.area||'common'}; }
      else if(t==='tower_photos'){ sk=s3KeyForTowerPhoto(p.project_id,p.tower,name); row={project_id:Number(p.project_id),tower:p.tower}; }
      else { sk=s3KeyForProjectPhoto(p.project_id,name); row={project_id:Number(p.project_id)}; }
      const {data,error}=await uploadFileToS3(sk,prep.full);
      if(error) throw new Error(error.message);
      let thumbPath=null;
      if(prep.thumb){ try{ const tu=await uploadFileToS3(cphThumbKey(sk),prep.thumb); if(!tu.error) thumbPath=tu.data.path; }catch(_e){} }
      const {data:ins,error:insErr}=await sb.schema('cust').from(t).insert(Object.assign(row,{
        taken_on:takenOn,caption:null,storage_path:data.path,thumb_path:thumbPath,file_name:name,
        file_size:prep.full.size,file_type:prep.full.type||f.type,uploaded_by:state.email})).select('id').single();
      if(insErr) throw new Error(insErr.message);
      (newIds[t]=newIds[t]||[]).push(ins.id);
      ok++;
      if(r.url){ try{ URL.revokeObjectURL(r.url); }catch(_e){} }
      delete all[key];
    }catch(e){ failed.push(r.place+' — '+((e&&e.message)||e)); }
    CPA_PH.fixBusy.delete(key); cpaPhFixRender();
  }
  let told=0, replaced=0;
  for(const t of Object.keys(newIds)){
    try{ const {data:n}=await sb.schema('cust').rpc('notify_media_uploaded',{p_table:t,p_ids:newIds[t]}); told=Math.max(told,Number(n||0)); }catch(_e){}
    try{ const {data:old}=await sb.schema('cust').rpc('replace_rejected_media',{p_table:t,p_ids:newIds[t]}); replaced+=(old||[]).length; }catch(_e){}
  }
  CPA_PH.fixBusy=null;
  if(ok) toast(ok+' photo'+(ok===1?'':'s')+' uploaded — waiting for approval'+(replaced?' · replaces '+replaced+' rejected':''),'ok');
  if(failed.length) toast(failed.length+' could not be uploaded (they are kept - try again): '+failed[0],'err');
  await cpaPhFixList();
  cpaPhList();
};

// Latest upload per flat (any status, not deleted) - newest first, so the first row per flat wins.
async function cpaPhLastUploads(ids){
  if(!ids||!ids.length) return {};
  try{
    const {data}=await sb.schema('cust').from('unit_photos').select('unit_id,created_at').in('unit_id',ids)
      .is('deleted_at',null).order('created_at',{ascending:false}).limit(1000);
    const out={}; (data||[]).forEach(r=>{ if(!out[r.unit_id]) out[r.unit_id]=r.created_at; });
    return out;
  }catch(_e){ return {}; }
}
function cpaDdMmYy(d){ const x=new Date(d); if(isNaN(x)) return '';
  return String(x.getDate()).padStart(2,'0')+'/'+String(x.getMonth()+1).padStart(2,'0')+'/'+String(x.getFullYear()).slice(2); }
// The flats of the chosen project and block, cancelled rows dropped (a cancelled booking keeps
// its row for audit, which is why the same physical flat could appear two to four times), and
// filtered by whatever has been typed.
function cpaPhFlats(units){
  return (units||[]).filter(u=>
      u.status!=='cancelled'
      && String(u.project_id)===String(CPA_PH.project)
      && (!CPA_PH.tower||String(u.tower||'')===String(CPA_PH.tower)))
    .sort((a,b)=>String(a.unit_code).localeCompare(String(b.unit_code),undefined,{numeric:true}));
}
/* The zone says what it is for and how much is in it. What was actually chosen is shown as
   pictures underneath, where there is room for them - a filename in a narrow box told you
   nothing about whether you had picked the right photo. */
function cpaPhZone(key,title,icon){
  const n=(CPA_PH.files[key]||[]).length;
  return '<div class="cph-zone'+(n?' has':'')+'" data-zone="'+key+'" tabindex="0">'
    +'<div class="cph-zhead"><i class="fa-solid '+(n?'fa-circle-check':icon)+'"></i>'
      +'<span class="cph-zt">'+esc(title)+'</span>'
      +(n?'<span class="cph-zn">'+n+'</span>':'')
    +'</div>'
    +'<div class="cph-zbody"><div class="cph-zbtns">'
      +'<button type="button" class="cph-zb" onclick="cpaPhPick(\''+key+'\',\'photo\',event)"><i class="fa-solid fa-camera"></i>Camera</button>'
      +'<button type="button" class="cph-zb" onclick="cpaPhPick(\''+key+'\',\'video\',event)"><i class="fa-solid fa-video"></i>Video</button>'
      +'<button type="button" class="cph-zb" onclick="cpaPhPick(\''+key+'\',\'gallery\',event)"><i class="fa-solid fa-images"></i>Gallery</button>'
      +'</div><div class="cph-zhint">'+(n?'Add more, or drop files here':'or drop files here')+'</div></div>'
    +'</div>';
}

/* A preview for something that has not left the computer yet. The object URL is kept on the
   file and revoked when it is taken back out, so choosing forty photos and changing your mind
   does not leave forty images pinned in memory. */
function cpaPhPreview(f){
  if(!f.__u){ try{ f.__u=URL.createObjectURL(f); }catch(_e){ f.__u=''; } }
  return f.__u;
}
function cpaPhForget(f){
  if(f&&f.__u){ try{ URL.revokeObjectURL(f.__u); }catch(_e){} f.__u=null; }
}
/* Full size, before it is uploaded. A 74px tile is enough to see that you picked a photo and
   not enough to see whether it is the right one or whether it came out blurred - which is the
   moment to find out, not after it is in front of a customer. Video plays in place with the
   browser's own controls. */
window.cpaPhZoom=function(key,idx){
  const f=(CPA_PH.files[key]||[])[idx]; if(!f) return;
  const isVid=/^video\//.test(f.type||'');
  const url=cpaPhPreview(f);
  const box=document.createElement('div');
  box.className='cph-box';
  box.innerHTML='<div class="cph-boxbar"><i class="fa-solid '+(isVid?'fa-circle-play':'fa-image')+'"></i>'
    +'<span class="nm">'+esc(f.name)+'</span>'
    +'<button class="cph-boxx" title="Close (Esc)">&times;</button></div>'
    +(isVid?'<video src="'+url+'" controls autoplay playsinline></video>'
           :'<img src="'+url+'" alt="">');
  const shut=function(){
    try{ document.removeEventListener('keydown',onKey); }catch(_e){}
    if(box.parentNode) box.parentNode.removeChild(box);
  };
  const onKey=function(e){ if(e.key==='Escape') shut(); };
  // Clicking the picture itself must not close it - only the backdrop or the button.
  box.onclick=function(e){ if(e.target===box) shut(); };
  box.querySelector('.cph-boxx').onclick=shut;
  document.addEventListener('keydown',onKey);
  document.body.appendChild(box);
};
function cpaPhStaged(){
  const host=$('cphStaged'); if(!host) return;
  const keys=CPA_PH.level==='unit'?CPA_PH_AREAS.map(a=>a[0]):['all'];
  let html='';
  keys.forEach(function(k){
    const fs=CPA_PH.files[k]||[]; if(!fs.length) return;
    const meta=CPA_PH_AREAS.concat([['all','Chosen','fa-images']]).find(a=>a[0]===k);
    html+='<div class="cph-sgroup">'
      +(CPA_PH.level==='unit'
        ? '<div class="cph-sh"><i class="fa-solid fa-circle-check"></i>'+esc(meta[1])
          +' <span class="n">\u00b7 '+fs.length+'</span></div>' : '')
      +'<div class="cph-strip">'
      +fs.map(function(f,i){
          const isVid=/^video\//.test(f.type||'');
          const inner=isVid
            ? '<div class="vid"><i class="fa-solid fa-circle-play fa-lg"></i></div>'
            : '<img src="'+cpaPhPreview(f)+'" alt="">';
          return '<div class="cph-sthumb" title="'+esc(f.name)+'" onclick="cpaPhZoom(\''+k+'\','+i+')">'+inner
            +'<button class="cph-sx" title="Remove" onclick="event.stopPropagation();cpaPhDrop(\''+k+'\','+i+')">&times;</button></div>';
        }).join('')
      +'</div></div>';
  });
  host.innerHTML=html;
  host.style.display=html?'':'none';
}

/* Click and drag-and-drop both, on every zone. The file input is made here rather than living in
   the markup so that choosing a second batch ADDS to the first instead of replacing it - a plain
   <input type=file> forgets everything it held the moment you pick again, which is why adding
   "just one more photo" used to silently drop the rest. */
/* Camera / Video open the phone's camera straight away (capture="environment" = the rear camera);
   Gallery is the multi-select picker. On a computer, capture is ignored and all three open the file
   picker. Every capture goes through cpaPhAdd, so shooting five photos one after another adds five,
   the same as picking five. */
window.cpaPhPick=function(key,mode,ev,after){
  if(ev) ev.stopPropagation();
  const inp=document.createElement('input');
  inp.type='file';
  if(mode==='gallery'){ inp.multiple=true; inp.accept='image/*,video/*'; }
  else{ inp.accept=mode==='video'?'video/*':'image/*'; inp.setAttribute('capture','environment'); }
  inp.onchange=function(){ cpaPhAdd(key,[...inp.files]); if(after&&inp.files.length) after(); };
  inp.click();
};
function cpaPhWireZones(){
  Array.prototype.forEach.call(document.querySelectorAll('.cph-zone'),function(z){
    const key=z.getAttribute('data-zone');
    const open=function(){ cpaPhPick(key,'gallery'); };
    z.onclick=open;
    // Enter on one of the zone's own buttons is that button's click - not the zone's as well.
    z.onkeydown=function(e){ if(e.target!==z) return; if(e.key==='Enter'||e.key===' '){ e.preventDefault(); open(); } };
    z.ondragover=function(e){ e.preventDefault(); z.classList.add('over'); };
    z.ondragleave=function(){ z.classList.remove('over'); };
    z.ondrop=function(e){
      e.preventDefault(); z.classList.remove('over');
      cpaPhAdd(key,[...(e.dataTransfer&&e.dataTransfer.files||[])]);
    };
  });
}
function cpaPhAdd(key,files){
  const keep=(files||[]).filter(f=>/^(image|video)\//.test(f.type||''));
  const dropped=(files||[]).length-keep.length;
  if(dropped) toast(dropped+' file'+(dropped===1?' was':'s were')+' not a photo or video and '+(dropped===1?'was':'were')+' skipped','warn');
  if(!keep.length) return;
  // Same file picked twice is the same file once.
  const have=new Set((CPA_PH.files[key]||[]).map(f=>f.name+'|'+f.size));
  CPA_PH.files[key]=(CPA_PH.files[key]||[]).concat(keep.filter(f=>!have.has(f.name+'|'+f.size)));
  cpaPhRepaintZones();
}
window.cpaPhDrop=function(key,idx){
  cpaPhForget(CPA_PH.files[key][idx]);
  CPA_PH.files[key].splice(idx,1);
  cpaPhRepaintZones();
};
window.cpaPhClear=function(){
  Object.keys(CPA_PH.files).forEach(k=>(CPA_PH.files[k]||[]).forEach(cpaPhForget));
  CPA_PH.files={all:[],common:[],bathroom:[],kitchen:[]};
  cpaPhRepaintZones();
};
/* Redrawing one zone in place keeps the caret and the scroll position of the others, which
   matters when three of them are on screen. */
function cpaPhRepaintZones(){
  Array.prototype.forEach.call(document.querySelectorAll('.cph-zone'),function(z){
    const key=z.getAttribute('data-zone');
    const meta=CPA_PH_AREAS.concat([['all','Photos or videos','fa-images']]).find(a=>a[0]===key);
    const holder=document.createElement('div');
    holder.innerHTML=cpaPhZone(key,meta?meta[1]:'Files',meta?meta[2]:'fa-images');
    const fresh=holder.firstChild;
    z.className=fresh.className;
    z.innerHTML=fresh.innerHTML;
  });
  cpaPhStaged();
  cpaPhSyncActions();
}
// The two buttons that act on what has been chosen sit together and know how much there is.
function cpaPhSyncActions(){
  const keys=CPA_PH.level==='unit'?cpaPhUploadAreas().map(a=>a[0]):['all'];
  const total=keys.reduce((t,k)=>t+((CPA_PH.files[k]||[]).length),0);
  const go=$('cphGo'), clr=$('cphClear');
  if(go){
    go.disabled=!total; go.style.opacity=total?'':'.5';
    go.innerHTML='<i class="fa-solid fa-cloud-arrow-up"></i> '+(total?('Upload '+total+' file'+(total===1?'':'s')):'Upload');
  }
  if(clr){ clr.disabled=!total; clr.style.opacity=total?'':'.4'; }
}

window.cpaPhSetLevel=function(l){ CPA_PH.level=l; cpaPhFollowPickers(); cpaPhPaint(); };
// The filters snap back to the upload target whenever that target moves, so the panel always
// opens on "what I am about to add to" rather than on a stale view of somewhere else.
function cpaPhFollowPickers(){
  CPA_PHF={project:CPA_PH.project,tower:CPA_PH.tower,unit:CPA_PH.unit,area:''};
}
window.cpaPhFilter=function(k,v){ CPA_PHF[k]=v; if(k==='project'){CPA_PHF.tower='';CPA_PHF.unit='';} if(k==='tower'){CPA_PHF.unit='';} cpaPhList(); };
window.cpaPhSet=function(k,v){
  CPA_PH[k]=v;
  // Changing the project invalidates the block and the flat under it.
  if(k==='project'){ CPA_PH.tower=''; CPA_PH.unit=''; }
  if(k==='tower'){ CPA_PH.unit=''; }
  cpaPhFollowPickers();
  cpaPhPaint();
};
window.cpaPhUpload=async function(){
  const takenOn=($('cphDate')||{}).value;
  // Captions were asked for on every upload and almost never written; the date, the flat and
  // the section already say what a photo is. The column is left on the tables so anything
  // written before today is not lost - it is simply no longer asked for or shown.
  const caption=null;
  const lvl=CPA_PH.level;
  const jobs=[];
  if(lvl==='unit'){
    const unitId=Number(CPA_PH.unit);
    if(!unitId){ toast('Choose a flat first','err'); return; }
    cpaPhUploadAreas().forEach(a=>(CPA_PH.files[a[0]]||[]).forEach(f=>jobs.push({f,area:a[0]})));
  } else {
    (CPA_PH.files.all||[]).forEach(f=>jobs.push({f,area:null}));
  }
  if(!jobs.length){ toast('Add at least one photo or video','err'); return; }
  if(lvl==='tower'&&!CPA_PH.tower){ toast('Choose a block first','err'); return; }

  const go=$('cphGo'); go.disabled=true;
  let ok=0; const failed=[], newIds={};
  for(let i=0;i<jobs.length;i++){
    const {f,area}=jobs[i];
    go.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Uploading '+(i+1)+' of '+jobs.length+'…';
    try{
      // Made smaller here first (cphPrepare), so a site upload over mobile data takes seconds.
      const prep=await cphPrepare(f);
      const name=prep.full!==f?f.name.replace(/\.[^.]*$/,'')+'.jpg':f.name;
      let key,table,row;
      if(lvl==='project'){
        key=s3KeyForProjectPhoto(CPA_PH.project,name); table='project_photos';
        row={project_id:Number(CPA_PH.project)};
      }else if(lvl==='tower'){
        key=s3KeyForTowerPhoto(CPA_PH.project,CPA_PH.tower,name); table='tower_photos';
        row={project_id:Number(CPA_PH.project),tower:CPA_PH.tower};
      }else{
        key=s3KeyForUnitPhoto(CPA_PH.unit,name); table='unit_photos';
        row={unit_id:Number(CPA_PH.unit),area:area};
      }
      const {data,error}=await uploadFileToS3(key,prep.full);
      if(error) throw new Error(error.message);
      // A thumbnail that fails to go up is not worth failing the photo for - one is made later.
      let thumbPath=null;
      if(prep.thumb){ try{ const tu=await uploadFileToS3(cphThumbKey(key),prep.thumb); if(!tu.error) thumbPath=tu.data.path; }catch(_e){} }
      // Stored as 'pending' whatever is sent - the database sets that (media_status_guard).
      const {data:ins,error:insErr}=await sb.schema('cust').from(table).insert(Object.assign(row,{
        taken_on:takenOn,caption,storage_path:data.path,thumb_path:thumbPath,file_name:name,
        file_size:prep.full.size,file_type:prep.full.type||f.type,uploaded_by:state.email})).select('id').single();
      if(insErr) throw new Error(insErr.message);
      (newIds[table]=newIds[table]||[]).push(ins.id);
      ok++;
    }catch(e){ failed.push(f.name+' — '+((e&&e.message)||e)); }
  }
  go.disabled=false;
  /* Only what actually went up is cleared. A failed file stays in the list so it can be tried
     again, instead of being quietly dropped along with the ones that worked. */
  if(!failed.length) cpaPhClear(); else cpaPhRepaintZones();
  // One notification per batch to the approvers, not one per file.
  let told=0, replaced=0;
  for(const t of Object.keys(newIds)){
    try{ const {data:n}=await sb.schema('cust').rpc('notify_media_uploaded',{p_table:t,p_ids:newIds[t]}); told=Math.max(told,Number(n||0)); }catch(_e){}
    // What was rejected at the same place (flat and section, block, or project) is replaced by
    // these. Only the rows leave the screens - photo files are never deleted from S3.
    try{
      const {data:old}=await sb.schema('cust').rpc('replace_rejected_media',{p_table:t,p_ids:newIds[t]});
      replaced+=(old||[]).length;
    }catch(_e){}
  }
  if(ok) toast(ok+' file'+(ok===1?'':'s')+' uploaded — waiting for approval'+(replaced?' · replaces '+replaced+' rejected':'')+(told?'':'. No photo approver is set up yet (Control Panel).'),told?'ok':'warn');
  if(failed.length) toast(failed.length+' could not be uploaded: '+failed[0],'err');
  cpaPhList();
  // What was replaced leaves "Photos to retake" at once - no page refresh.
  await cpaPhFixList();
};

/* What is already there, as thumbnails rather than a table of 52px squares. At flat level it is
   split by area, because that is the question being asked of it. */
/* WHAT IS ALREADY THERE, AS ROWS, WITH ITS OWN FILTERS.

   The columns follow the level - a project-wide photo has no block or flat to name, and only a
   flat photo has a section - and so do the filters. They start on whatever the upload pickers
   are pointing at and can then be widened: every block in the project, every flat in a block,
   one section across all of them. That is a different question from "where does the next upload
   go", which is why it is asked separately here rather than driven by the strip at the top. */
async function cpaPhList(){
  const host=$('cphList'); if(!host) return;
  const lvl=CPA_PH.level;
  host.innerHTML='<div class="cph-empty">Loading\u2026</div>';
  try{
    const [projects,units]=await Promise.all([cpaProjects(),cpaUnits()]);
    const live=(units||[]).filter(u=>u.status!=='cancelled');
    const nameOf=id=>{const x=(projects||[]).find(y=>String(y.id)===String(id));return (x&&x.name)||'\u2014';};

    // ── the filter bar, showing only what this level can be filtered by ──
    const towers=[...new Set(live.filter(u=>String(u.project_id)===String(CPA_PHF.project)&&u.tower)
                                 .map(u=>u.tower))].sort();
    const flats=live.filter(u=>String(u.project_id)===String(CPA_PHF.project)
                             &&(!CPA_PHF.tower||String(u.tower||'')===String(CPA_PHF.tower)))
                    .sort((x,y)=>String(x.unit_code).localeCompare(String(y.unit_code),undefined,{numeric:true}));
    const sel=(id,label,opts,val,allLabel)=>
      '<div class="cph-f"><label>'+esc(label)+'</label><div class="cph-sel">'
      +'<select onchange="cpaPhFilter(\''+id+'\',this.value)">'
      +(allLabel?'<option value=""'+(val?'':' selected')+'>'+esc(allLabel)+'</option>':'')
      +opts.map(o=>'<option value="'+esc(o[0])+'"'+(String(o[0])===String(val)?' selected':'')+'>'+esc(o[1])+'</option>').join('')
      +'</select></div></div>';

    let bar='<div class="cph-filters">'
      +sel('project','Project',(projects||[]).map(x=>[x.id,x.name]),CPA_PHF.project,'');
    if(lvl!=='project') bar+=sel('tower','Block',towers.map(t=>[t,t]),CPA_PHF.tower,'All blocks');
    if(lvl==='unit'){
      bar+=sel('unit','Flat',flats.map(u=>[u.id,u.unit_code]),CPA_PHF.unit,'All flats');
      // Only the sections this person uploads to: a photos-only account has no Bathroom, so it is
      // neither offered here nor listed below (6 Oct 2026).
      const areas=cpaPhUploadAreas();
      if(CPA_PHF.area&&!areas.some(x=>x[0]===CPA_PHF.area)) CPA_PHF.area='';
      bar+=sel('area','Section',areas.map(x=>[x[0],x[1]]),CPA_PHF.area,'All sections');
    }
    bar+='<span class="cph-fcount" id="cphCount"></span></div>';

    // ── the rows ──
    let rowsHtml,count=0;
    if(lvl==='project'){
      const {data}=await sb.schema('cust').from('project_photos').select('*')
        .eq('project_id',Number(CPA_PHF.project)).is('deleted_at',null).order('taken_on',{ascending:false});
      const list=data||[]; count=list.length;
      rowsHtml=await cpaPhRows(list,'project_photos',['Project'],
        ()=>[esc(nameOf(CPA_PHF.project))],'Nothing uploaded for this project yet.');
    }else if(lvl==='tower'){
      let q=sb.schema('cust').from('tower_photos').select('*').eq('project_id',Number(CPA_PHF.project));
      if(CPA_PHF.tower) q=q.eq('tower',CPA_PHF.tower);
      const {data}=await q.is('deleted_at',null).order('taken_on',{ascending:false});
      const list=data||[]; count=list.length;
      rowsHtml=await cpaPhRows(list,'tower_photos',['Project','Block'],
        p=>[esc(nameOf(CPA_PHF.project)),esc(p.tower||'\u2014')],
        CPA_PHF.tower?'Nothing uploaded for this block yet.':'Nothing uploaded for any block on this project yet.');
    }else{
      // "All flats" means every flat in scope, so the ids are gathered and asked for together
      // rather than one query per flat.
      const ids=CPA_PHF.unit?[Number(CPA_PHF.unit)]:flats.map(u=>u.id);
      if(!ids.length){
        rowsHtml='<div class="cph-empty">There are no flats in this block.</div>';
      }else{
        let q=sb.schema('cust').from('unit_photos').select('*').in('unit_id',ids);
        if(CPA_PHF.area) q=q.eq('area',CPA_PHF.area);
        else if(cpaPhUploadAreas().length<CPA_PH_AREAS.length){
          // An unset section counts as Common area, so it stays in.
          const ok=cpaPhUploadAreas().map(x=>x[0]);
          q=q.or('area.is.null,area.in.('+ok.join(',')+')');
        }
        const {data}=await q.is('deleted_at',null).order('taken_on',{ascending:false});
        const list=data||[]; count=list.length;
        const byId={}; live.forEach(u=>{byId[u.id]=u;});
        rowsHtml=await cpaPhRows(list,'unit_photos',['Project','Block','Flat','Section'],
          function(p){
            const u=byId[p.unit_id]||{};
            const ar=CPA_PH_AREAS.find(x=>x[0]===(p.area||'common'));
            return [esc(nameOf(u.project_id||CPA_PHF.project)),esc(u.tower||'\u2014'),esc(u.unit_code||'\u2014'),
                    '<span class="cph-area">'+esc(ar?ar[1]:p.area)+'</span>'];
          },'Nothing uploaded here yet.');
      }
    }
    host.innerHTML=bar+rowsHtml;
    cphLazy(host);
    const c=$('cphCount'); if(c) c.textContent=count?(count+(count===1?' item':' items')):'';
  }catch(e){ host.innerHTML='<div class="cph-empty" style="color:var(--err)">'+esc((e&&e.message)||String(e))+'</div>'; }
}
/* Thumbnails load only as they scroll into view, a few at a time, and a signed link is reused for a
   few minutes. Signing every row's file up front - one s3-sign call each, now with an access check
   behind it - and then decoding a full-size original per row is what made a long list hang while
   scrolling (5 Oct 2026: a block with 100+ flat photos). */
const CPH_URLS={};
async function cphSignedUrl(path){
  const c=CPH_URLS[path];
  if(c&&Date.now()-c.t<240000) return c.url;   // signed links last 5 minutes
  const url=await s3SignedUrl(path);
  if(url) CPH_URLS[path]={url,t:Date.now()};
  return url;
}
let cphIO=null; const cphQ=[]; let cphBusy=0;
function cphPump(){
  while(cphBusy<6&&cphQ.length){
    const img=cphQ.shift(); if(!img.isConnected) continue;
    cphBusy++;
    // onerror: a file that is no longer in S3 (rejected before 5 Oct 2026 files were kept) shows
    // as missing rather than as a broken image.
    cphSignedUrl(img.getAttribute('data-ph')).then(u=>{ if(u){ img.onerror=()=>img.classList.add('cph-noimg');
        img.onload=()=>{ const bf=img.getAttribute('data-bf'); if(bf) cphBackfill(bf); }; img.src=u; } else img.classList.add('cph-noimg'); })
      .catch(()=>img.classList.add('cph-noimg')).finally(()=>{ cphBusy--; cphPump(); });
  }
}
function cphLazy(root){
  const imgs=(root||document).querySelectorAll('img[data-ph]:not([src])');
  if(!('IntersectionObserver' in window)){ imgs.forEach(i=>cphQ.push(i)); cphPump(); return; }
  if(!cphIO) cphIO=new IntersectionObserver(es=>es.forEach(e=>{ if(e.isIntersecting){ cphIO.unobserve(e.target); cphQ.push(e.target); cphPump(); } }),{rootMargin:'300px 0px'});
  imgs.forEach(i=>cphIO.observe(i));
}
/* PHOTOS ARE MADE SMALLER ON THE PHONE, AND EACH GETS A THUMBNAIL (5 Oct 2026).

   A phone photo is 4-8 MB and 4000px wide; nobody - customer or approver - looks at it larger than
   a screen. Before upload it is redrawn at most 2560px on its long side (JPEG, quality 0.85: about
   0.4-0.8 MB, no visible loss at screen size) plus a 480px thumbnail, and lists show the thumbnail.
   The original is kept as taken when it is already smaller, or when the browser cannot read it
   (some HEIC). Videos go up as they are, with a thumbnail from a frame at about one second. */
const CPH_FULL=2560, CPH_THUMB=480;
async function cphDecode(blob){
  if(window.createImageBitmap){ try{ return await createImageBitmap(blob,{imageOrientation:'from-image'}); }catch(_e){} }
  return await new Promise((res,rej)=>{ const u=URL.createObjectURL(blob); const im=new Image();
    im.onload=()=>{ URL.revokeObjectURL(u); res(im); }; im.onerror=()=>{ URL.revokeObjectURL(u); rej(new Error('Could not read the image')); }; im.src=u; });
}
function cphJpeg(src,w,h,max,q){
  if(!w||!h) return Promise.resolve(null);
  const k=Math.min(1,max/Math.max(w,h)), cw=Math.max(1,Math.round(w*k)), ch=Math.max(1,Math.round(h*k));
  const c=document.createElement('canvas'); c.width=cw; c.height=ch;
  const g=c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,cw,ch); g.drawImage(src,0,0,cw,ch);
  return new Promise(r=>c.toBlob(b=>r(b),'image/jpeg',q));
}
// A frame from a video (a local file, or a signed S3 address for one already uploaded).
function cphVideoFrame(src,local){
  return new Promise(res=>{
    const v=document.createElement('video'); v.muted=true; v.playsInline=true; v.preload='auto';
    if(!local) v.crossOrigin='anonymous';
    let done=false;
    const fin=b=>{ if(done) return; done=true; clearTimeout(tm); if(local) URL.revokeObjectURL(src); try{ v.removeAttribute('src'); v.load(); }catch(_e){} res(b||null); };
    const tm=setTimeout(()=>fin(null),12000);
    v.onloadedmetadata=()=>{ try{ v.currentTime=Math.min(1,(v.duration||2)/2); }catch(_e){ fin(null); } };
    v.onseeked=()=>{ cphJpeg(v,v.videoWidth,v.videoHeight,CPH_THUMB,0.72).then(fin,()=>fin(null)); };
    v.onerror=()=>fin(null);
    v.src=src;
  });
}
// -> {full, thumb}: what to upload, and its thumbnail (null when none could be made).
async function cphPrepare(file){
  const t=file.type||'';
  if(/^video\//.test(t)) return {full:file,thumb:await cphVideoFrame(URL.createObjectURL(file),true)};
  if(!/^image\//.test(t)||/gif|svg/.test(t)) return {full:file,thumb:null};
  try{
    const im=await cphDecode(file); const w=im.width||im.naturalWidth, h=im.height||im.naturalHeight;
    const big=await cphJpeg(im,w,h,CPH_FULL,0.85), thumb=await cphJpeg(im,w,h,CPH_THUMB,0.72);
    if(im.close) im.close();
    return {full:(big&&big.size<file.size)?big:file,thumb};
  }catch(_e){ return {full:file,thumb:null}; }
}
// customer-portal/units/9/photos/123_a.png -> customer-portal/units/9/photos/thumbs/123_a.jpg
function cphThumbKey(key){ return key.replace(/\/([^\/]+)$/,(m,n)=>'/thumbs/'+n.replace(/\.[^.]*$/,'')+'.jpg'); }

/* Photos uploaded before thumbnails existed get one the first time a staff screen shows them: the
   full file is read once more, shrunk here, and the thumbnail saved (cust.set_media_thumb). One at a
   time, after the list itself has loaded, and at most once per photo per visit. Photos only - a
   video frame from S3 is left to the next upload. */
const cphBfQ=[], cphBfSeen=new Set(); let cphBfBusy=false;
function cphBackfill(spec){ if(!spec||cphBfSeen.has(spec)) return; cphBfSeen.add(spec); cphBfQ.push(spec); cphBfPump(); }
async function cphBfPump(){
  if(cphBfBusy) return; const spec=cphBfQ.shift(); if(!spec) return; cphBfBusy=true;
  try{
    const i=spec.indexOf(':'), j=spec.indexOf(':',i+1);
    const table=spec.slice(0,i), id=Number(spec.slice(i+1,j)), path=spec.slice(j+1);
    const key=path.slice(3);
    const {data,error}=await s3Sign('get',key);
    if(!error&&data){
      const r=await fetch(data.url);
      if(r.ok){
        const im=await cphDecode(await r.blob());
        const thumb=await cphJpeg(im,im.width||im.naturalWidth,im.height||im.naturalHeight,CPH_THUMB,0.72);
        if(im.close) im.close();
        if(thumb){
          const up=await uploadFileToS3(cphThumbKey(key),thumb);
          if(!up.error) await sb.schema('cust').rpc('set_media_thumb',{p_table:table,p_id:id,p_thumb:up.data.path});
        }
      }
    }
  }catch(_e){}
  cphBfBusy=false; setTimeout(cphBfPump,150);
}
/* FULL-SIZE VIEWS OPEN AT ONCE (8 Oct 2026). Most photos uploaded before 5 Oct are the phone's
   original, several MB, and over site mobile data the view sat on a spinner. The thumbnail - already
   signed and loaded for the list - is shown straight away (cphFullInto), the full photo takes its
   place when it has arrived, and the photos either side are fetched ahead (cphPreload) so the
   arrows do not wait either. */
const cphPreloaded=new Map();
function cphPreload(ph){
  if(!ph||!ph.storage_path||cphPreloaded.has(ph.storage_path)) return;
  if((ph.file_type||'').indexOf('video')===0) return;
  cphPreloaded.set(ph.storage_path,true);
  cphSignedUrl(ph.storage_path).then(u=>{ if(u){ const im=new Image(); im.decoding='async'; im.src=u; cphPreloaded.set(ph.storage_path,im); } });
}
async function cphFullInto(stage,box,ph){
  const isVid=(ph.file_type||'').indexOf('video')===0;
  if(!isVid&&ph.thumb_path){
    const tu=await cphSignedUrl(ph.thumb_path);
    if(tu&&box.isConnected&&!stage.querySelector('img.cph-full'))
      stage.innerHTML='<img src="'+tu+'" alt=""><div class="cph-pvhint"><i class="fa-solid fa-spinner fa-spin"></i> Loading full photo…</div>';
  }
  const url=await cphSignedUrl(ph.storage_path);
  if(!box.isConnected) return;
  if(!url){ if(!stage.querySelector('img')) stage.innerHTML='<div class="cph-pvload">File not available</div>'; return; }
  if(isVid){ stage.innerHTML='<video src="'+url+'" controls autoplay playsinline></video>'; return; }
  const pre=cphPreloaded.get(ph.storage_path);
  const full=(pre&&pre.complete&&pre.naturalWidth)?pre:new Image();
  full.className='cph-full'; full.alt='';
  const show=()=>{ if(box.isConnected){ stage.innerHTML=''; stage.appendChild(full); } };
  if(full.complete&&full.naturalWidth){ show(); return; }
  full.onload=show;
  full.onerror=()=>{ if(box.isConnected){ const h=stage.querySelector('.cph-pvhint'); if(h) h.remove(); if(!stage.querySelector('img')) stage.innerHTML='<div class="cph-pvload">File not available</div>'; } };
  full.src=url;
}
// The image a list shows for a photo: its thumbnail, or the full file for one that has none yet
// (data-bf asks for a thumbnail to be made once it has loaded).
function cphThumbAttrs(p,table){
  const isVideo=(p.file_type||'').indexOf('video')===0;
  return 'data-ph="'+esc(p.thumb_path||p.storage_path)+'"'
    +(!p.thumb_path&&!isVideo&&table?' data-bf="'+esc(table+':'+p.id+':'+p.storage_path)+'"':'');
}
// `cols` names the middle columns and `vals` fills them for one row, so the three levels share
// one table rather than three that could drift apart.
async function cpaPhRows(list,table,cols,vals,emptyMsg){
  if(!list.length) return '<div class="cph-empty">'+esc(emptyMsg)+'</div>';
  const rows=await Promise.all(list.map(async function(p){
    const isVideo=(p.file_type||'').indexOf('video')===0;
    const open="s3OpenSigned('"+p.storage_path.replace(/'/g,"\\'")+"')";
    let thumb;
    if(isVideo&&p.thumb_path){ thumb='<span class="cph-vth" onclick="'+open+'" title="Open video"><img class="cph-th" '+cphThumbAttrs(p,table)+' alt="" decoding="async"><i class="fa-solid fa-circle-play"></i></span>'; }
    else if(isVideo){ thumb='<div class="cph-th vid" onclick="'+open+'" title="Open video"><i class="fa-solid fa-circle-play"></i></div>'; }
    else thumb='<img class="cph-th" '+cphThumbAttrs(p,table)+' alt="" decoding="async" onclick="'+open+'" title="Open full size">';
    return '<tr><td>'+thumb+'</td>'
      +'<td class="cph-when">'+esc(fmtDate(p.taken_on))+'</td>'
      +'<td>'+cpaMediaStatusTag(p)+(p.status==='rejected'?cpaPhRetakeBtn(table,p):'')+'</td>'
      +vals(p).map(v=>'<td>'+v+'</td>').join('')
      +'<td style="text-align:right"><button class="cph-rm" title="Remove from the customer portal" '
        +'onclick="cpaPhDelete(\''+table+'\','+p.id+')"><i class="fa-solid fa-trash"></i></button></td></tr>';
  }));
  return '<table class="cph-tbl"><thead><tr><th style="width:56px"></th><th>Date</th><th>Status</th>'
    +cols.map(c=>'<th>'+esc(c)+'</th>').join('')
    +'<th style="width:44px"></th></tr></thead><tbody>'+rows.join('')+'</tbody></table>';
}
// Waiting / Published / Rejected (with the reason) / Unpublished, and who decided it.
function cpaMediaStatusTag(p){
  const s=CPA_MEDIA_STATUS[p.status]||CPA_MEDIA_STATUS.pending;
  const who=p.reviewed_by&&p.status!=='pending'&&!/^already live/.test(p.reviewed_by)?' by '+String(p.reviewed_by).split('@')[0]:'';
  return '<span class="tag '+s[1]+'" style="white-space:nowrap" title="'+esc(s[0]+who+(p.reviewed_at?' · '+fmtDate(p.reviewed_at):''))+'">'
    +'<i class="fa-solid '+s[2]+'"></i> '+esc(s[0])+'</span>'
    +(p.status==='rejected'?'<div class="cph-why">'+(p.review_note?esc(p.review_note)+' · ':'')+'Upload a new one to replace it</div>':'');
}
window.cpaPhDelete=async function(table,id){
  if(!await confirmDialog('Remove this from the customer portal? The customer will no longer see it.',
     {title:'Remove', okLabel:'Remove', icon:'fa-trash', danger:true})) return;
  const {error}=await sb.schema('cust').from(table).update({deleted_at:new Date().toISOString(),deleted_by:state.email}).eq('id',id);
  if(error){ toast('Could not remove it: '+error.message,'err'); return; }
  toast('Removed','ok'); cpaPhList();
};

/* ---------- Photos & Videos > Review: publish or reject before customers see anything ----------
   Split the way things are uploaded - Projects (whole-project photos), Blocks, Flats - and within
   that grouped by where they are, so a whole flat or block can be published in one go. Approve,
   reject (one click; the file is kept, a rejected photo can still be published, and the
   uploader's next photo for the same place replaces it) and unpublish all go through cust.review_media(), which also refuses an approver's own uploads. */
/* Everything waiting, counted per project, per section and per block, so the pickers can say where
   the work is. (5 Oct 2026: Review opened on the first project alphabetically, Dream Ananta, while
   all 262 waiting photos were Dream Gurukul flats - the screen read "nothing waiting".) */
async function cpaRvPending(units){
  const unitOf={}; (units||[]).forEach(u=>{unitOf[u.id]=u;});
  const q=(t,cols)=>sb.schema('cust').from(t).select(cols).eq('status','pending').is('deleted_at',null).limit(5000).then(r=>r.data||[],()=>[]);
  const [pp,tp,up]=await Promise.all([q('project_photos','project_id'),q('tower_photos','project_id,tower'),q('unit_photos','unit_id')]);
  const out={};
  const add=(pid,sec,tower)=>{ if(pid==null) return;
    const o=out[pid]=out[pid]||{total:0,project_photos:0,tower_photos:0,unit_photos:0,towers:{}};
    o.total++; o[sec]++;
    if(tower){ const t=o.towers[tower]=o.towers[tower]||{tower_photos:0,unit_photos:0}; t[sec]++; } };
  pp.forEach(r=>add(r.project_id,'project_photos'));
  tp.forEach(r=>add(r.project_id,'tower_photos',r.tower));
  up.forEach(r=>{ const u=unitOf[r.unit_id]; if(u) add(u.project_id,'unit_photos',u.tower); });
  return out;
}
/* How many photos and videos are waiting / approved (published) / rejected / unpublished, for one
   project - one section of it, or all three - and optionally one block (7 Oct 2026). Counted in the
   database (head requests), so nothing is downloaded to count it. */
const CPA_COUNT_KEYS=['pending','published','rejected','unpublished'];
async function cpaMediaCounts(projectId,units,secs,tower){
  const pid=Number(projectId), out={pending:0,published:0,rejected:0,unpublished:0};
  if(!pid) return out;
  const unitIds=(units||[]).filter(u=>u.status!=='cancelled'&&String(u.project_id)===String(pid)&&(!tower||u.tower===tower)).map(u=>u.id);
  const jobs=[];
  (secs||CPA_RV_SECS.map(x=>x[0])).forEach(function(t){
    CPA_COUNT_KEYS.forEach(function(st){
      let q=sb.schema('cust').from(t).select('id',{count:'exact',head:true}).eq('status',st).is('deleted_at',null);
      if(t==='unit_photos'){ if(!unitIds.length) return; q=q.in('unit_id',unitIds); }
      else { q=q.eq('project_id',pid); if(t==='tower_photos'&&tower) q=q.eq('tower',tower); }
      jobs.push(q.then(r=>{ out[st]+=(r&&r.count)||0; },()=>{}));
    });
  });
  await Promise.all(jobs);
  return out;
}
const CPA_COUNT_LABEL={pending:['Waiting','fa-hourglass-half','#d97706'],published:['Approved','fa-circle-check','#16a34a'],
  rejected:['Rejected','fa-circle-xmark','#dc2626'],unpublished:['Unpublished','fa-eye-slash','#64748b']};
// The section of a project that has the most waiting, or the current one if nothing is waiting.
function cpaRvBusiestSec(p){
  if(!p||!p.total) return CPA_RV.sec;
  return CPA_RV_SECS.map(s=>s[0]).sort((a,b)=>(p[b]||0)-(p[a]||0))[0];
}
async function cpaRvPaint(projects,units){
  projects=projects||await cpaProjects(); units=units||await cpaUnits();
  const wrap=$('cphWrap'); if(!wrap) return;
  const pend=await cpaRvPending(units);
  CPA_RV.pend=pend;
  // First time in (or arriving from a notification): go where the waiting items are.
  if(!CPA_RV.picked){
    const best=Object.keys(pend).sort((a,b)=>pend[b].total-pend[a].total)[0];
    if(best&&CPA_RV.status==='pending'){ CPA_RV.project=String(best); CPA_RV.tower=''; CPA_RV.sec=cpaRvBusiestSec(pend[best]); }
    CPA_RV.picked=true;
  }
  if(!CPA_RV.project&&projects.length) CPA_RV.project=CPA_PH.project||String(projects[0].id);
  const live=(units||[]).filter(u=>u.status!=='cancelled');
  const towers=cpaTowersForProject(live,CPA_RV.project);
  if(CPA_RV.tower&&towers.indexOf(CPA_RV.tower)<0) CPA_RV.tower='';
  const projUnits=live.filter(u=>String(u.project_id)===String(CPA_RV.project));
  // Waiting counts per section for the chosen project - what the section buttons show.
  const pp=pend[CPA_RV.project]||{};
  const counts=CPA_RV_SECS.map(s=>pp[s[0]]||0);
  const waitTxt=n=>n?' ('+n+' waiting)':'';
  const projOpts=projects.map(p=>[p.id,p.name+waitTxt((pend[p.id]||{}).total)]);
  const towerOpts=towers.map(t=>{ const c=(pp.towers&&pp.towers[t])||{}; return [t,t+waitTxt(c[CPA_RV.sec]||0)]; });
  const rvCounts=await cpaMediaCounts(CPA_RV.project,units,[CPA_RV.sec],CPA_RV.sec==='project_photos'?'':CPA_RV.tower);
  if(!$('cphWrap')) return;
  const sel=(id,label,opts,val,allLabel)=>'<div class="cph-f"><label>'+esc(label)+'</label><div class="cph-sel"><select onchange="cpaRvSet(\''+id+'\',this.value)">'
    +(allLabel?'<option value=""'+(val?'':' selected')+'>'+esc(allLabel)+'</option>':'')
    +opts.map(o=>'<option value="'+esc(o[0])+'"'+(String(o[0])===String(val)?' selected':'')+'>'+esc(o[1])+'</option>').join('')+'</select></div></div>';
  wrap.innerHTML=cpaPhModeBar()
    +'<div class="cph-card">'
      +'<div class="cph-levels" style="margin-bottom:12px">'
        +CPA_RV_SECS.map((s,i)=>'<button class="cph-lv'+(CPA_RV.sec===s[0]?' on':'')+'" onclick="cpaRvSet(\'sec\',\''+s[0]+'\')"><i class="fa-solid '+s[2]+'"></i>'+esc(s[1])
          +(counts[i]?'<span class="cph-badge">'+counts[i]+'</span>':'')+'</button>').join('')
      +'</div>'
      +'<div class="cph-filters" style="margin:0">'
        +sel('project','Project',projOpts,CPA_RV.project,'')
        +(CPA_RV.sec!=='project_photos'?sel('tower','Block',towerOpts,CPA_RV.tower,'All blocks'):'')
        +sel('status','Showing',Object.keys(CPA_MEDIA_STATUS).map(k=>[k,CPA_MEDIA_STATUS[k][0]+(rvCounts[k]!=null?' ('+rvCounts[k]+')':'')]),CPA_RV.status,'')
      +'</div>'
      // Tap a tile to see those: the counts are for the project, section and block chosen above.
      +'<div class="cph-cnts">'+CPA_COUNT_KEYS.map(k=>{ const L=CPA_COUNT_LABEL[k];
          return '<button class="cph-cnt'+(CPA_RV.status===k?' on':'')+'" style="--c:'+L[2]+'" onclick="cpaRvSet(\'status\',\''+k+'\')">'
            +'<i class="fa-solid '+L[1]+'"></i><b>'+(rvCounts[k]||0)+'</b><span>'+L[0]+'</span></button>'; }).join('')+'</div>'
    +'</div>'
    +'<div class="cph-card"><div class="cph-rvbar" id="cphRvBar"></div><div id="cphRvList"><div class="cph-empty">Loading…</div></div></div>';
  cpaPhFillBadge();
  await cpaRvList(projUnits);
}
window.cpaRvSet=function(k,v){
  CPA_RV[k]=v; CPA_RV.sel.clear();
  if(k==='project'){
    CPA_RV.tower='';
    // A project chosen while looking at what is waiting opens on a section that has some.
    const p=(CPA_RV.pend||{})[v];
    if(CPA_RV.status==='pending'&&p&&p.total&&!p[CPA_RV.sec]) CPA_RV.sec=cpaRvBusiestSec(p);
  }
  cpaRvPaint();
};
async function cpaRvList(projUnits){
  const host=$('cphRvList'); if(!host) return;
  try{
    if(!projUnits){ const units=await cpaUnits(); projUnits=(units||[]).filter(u=>u.status!=='cancelled'&&String(u.project_id)===String(CPA_RV.project)); }
    const t=CPA_RV.sec, pid=Number(CPA_RV.project);
    let q=sb.schema('cust').from(t).select('*').eq('status',CPA_RV.status).is('deleted_at',null);
    let byUnit={};
    if(t==='unit_photos'){
      const scope=projUnits.filter(u=>!CPA_RV.tower||u.tower===CPA_RV.tower);
      scope.forEach(u=>{byUnit[u.id]=u;});
      CPA_RV.byUnit=byUnit;
      const ids=scope.map(u=>u.id);
      if(!ids.length){ host.innerHTML='<div class="cph-empty">No flats here.</div>'; cpaRvBar(); return; }
      q=q.in('unit_id',ids);
    }else{
      q=q.eq('project_id',pid);
      if(t==='tower_photos'&&CPA_RV.tower) q=q.eq('tower',CPA_RV.tower);
    }
    const {data,error}=await q.order('created_at',{ascending:false}).limit(240);
    if(error) throw error;
    const list=data||[];
    CPA_RV.shown=list;
    if(!list.length){
      host.innerHTML='<div class="cph-empty">'+(CPA_RV.status==='pending'?'Nothing waiting for approval here. ✓':'Nothing '+esc(CPA_MEDIA_STATUS[CPA_RV.status][0].toLowerCase())+' here.')+'</div>';
      cpaRvBar(); return;
    }
    // Group by place: one group for the project, one per block, one per flat.
    const natural=(a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true});
    const groups={};
    list.forEach(p=>{
      let k,label;
      if(t==='unit_photos'){ const u=byUnit[p.unit_id]||{}; k='u'+p.unit_id; label=(u.tower||'')+' · Flat '+(u.unit_code||'?'); }
      else if(t==='tower_photos'){ k='t'+p.tower; label=p.tower||'Block'; }
      else { k='p'; label='Whole project'; }
      (groups[k]=groups[k]||{label,items:[]}).items.push(p);
    });
    const keys=Object.keys(groups).sort((a,b)=>natural(groups[a].label,groups[b].label));
    CPA_RV.order=keys.flatMap(k=>groups[k].items.map(p=>p.id));   // the preview's arrows follow this
    const cards=await Promise.all(list.map(p=>cpaRvCard(p,t)));
    const cardOf={}; list.forEach((p,i)=>{cardOf[p.id]=cards[i];});
    const canPublish=CPA_RV.status!=='published';
    const me=String(state.email||'').toLowerCase();
    host.innerHTML=keys.map(k=>{
      const g=groups[k];
      // An approver's own uploads are left out: the database would refuse them anyway.
      const ids=g.items.filter(p=>state.super||String(p.uploaded_by||'').toLowerCase()!==me).map(p=>p.id);
      return '<div class="cph-rvg"><div class="cph-rvgh"><b>'+esc(g.label)+'</b><span>'+g.items.length+' item'+(g.items.length===1?'':'s')+'</span>'
        +(canPublish&&ids.length?'<button class="btn btn-sm" onclick="cpaRvDecide(\'publish\','+JSON.stringify(ids)+')"><i class="fa-solid fa-check"></i> Publish all '+ids.length+'</button>':'')
        +(ids.length?'<button class="btn btn-sm" data-tick-ids="'+JSON.stringify(ids)+'" onclick="cpaRvTick('+JSON.stringify(ids)+')"><i class="fa-regular fa-square-check"></i> Tick all</button>':'')+'</div>'
        +'<div class="cph-rvgrid">'+g.items.map(p=>cardOf[p.id]).join('')+'</div></div>';
    }).join('')
      +(list.length>=240?'<div class="cph-empty">Showing the newest 240. Publish or reject these to see the rest.</div>':'');
    cphLazy(host);
    cpaRvSyncTickAll();
    cpaRvBar();
  }catch(e){ host.innerHTML='<div class="cph-empty" style="color:var(--err)">'+esc((e&&e.message)||String(e))+'</div>'; }
}
async function cpaRvCard(p,t){
  const isVideo=(p.file_type||'').indexOf('video')===0;
  const open="s3OpenSigned('"+String(p.storage_path||'').replace(/'/g,"\\'")+"')";
  let media;
  const prev='cpaRvPreview('+p.id+')';
  if(isVideo&&p.thumb_path) media='<span class="cph-vth" onclick="'+prev+'" title="Play video"><img class="cph-rvm" '+cphThumbAttrs(p,t)+' alt="" decoding="async"><i class="fa-solid fa-circle-play"></i></span>';
  else if(isVideo) media='<div class="cph-rvm vid" onclick="'+prev+'" title="Play video"><i class="fa-solid fa-circle-play"></i><span>Video</span></div>';
  else media='<img class="cph-rvm" '+cphThumbAttrs(p,t)+' alt="" decoding="async" onclick="'+prev+'" title="Open larger, with Publish / Reject">';
  const area=t==='unit_photos'?((CPA_PH_AREAS.find(a=>a[0]===(p.area||'common'))||[0,p.area])[1]):'';
  const mine=String(p.uploaded_by||'').toLowerCase()===String(state.email||'').toLowerCase()&&!state.super;
  const on=CPA_RV.sel.has(p.id);
  const id=JSON.stringify([p.id]);
  let acts='';
  if(mine) acts='<span class="cph-mine" title="Another approver has to review your own uploads">Your upload</span>';
  else if(p.status==='pending'||p.status==='unpublished')
    acts='<button class="cph-ok" onclick="cpaRvDecide(\'publish\','+id+')" title="Publish - customers will see it"><i class="fa-solid fa-check"></i></button>'
        +'<button class="cph-no" onclick="cpaRvDecide(\'reject\','+id+')" title="Reject - the uploader is asked for a better one"><i class="fa-solid fa-xmark"></i></button>';
  else if(p.status==='published')
    acts='<button class="cph-un" onclick="cpaRvDecide(\'unpublish\','+id+')" title="Unpublish - hide it from customers again"><i class="fa-solid fa-eye-slash"></i></button>'
        +'<button class="cph-no" onclick="cpaRvDecide(\'reject\','+id+')" title="Reject - hide it and ask the uploader for a better one"><i class="fa-solid fa-xmark"></i></button>';
  else if(p.status==='rejected')
    acts='<button class="cph-ok" onclick="cpaRvDecide(\'publish\','+id+')" title="Publish after all - customers will see it"><i class="fa-solid fa-check"></i></button>';
  return '<div class="cph-rvc'+(on?' cph-picked':'')+'" data-id="'+p.id+'">'
    +(!mine?'<label class="cph-rvck"><input type="checkbox" '+(on?'checked':'')+' onchange="cpaRvToggle('+p.id+',this.checked)"></label>':'')
    +media
    +'<div class="cph-rvi"><div class="cph-rvd">'+esc(fmtDate(p.taken_on))+(area?' · '+esc(area):'')+'</div>'
      +'<div class="cph-rvu" title="'+esc(p.uploaded_by||'')+'">'+esc(String(p.uploaded_by||'').split('@')[0])+'</div>'
      +(p.status==='rejected'&&p.review_note?'<div class="cph-why">'+esc(p.review_note)+'</div>':'')
    +'</div>'
    +'<div class="cph-rva">'+acts+'</div></div>';
}
function cpaRvBar(){
  const bar=$('cphRvBar'); if(!bar) return;
  const n=CPA_RV.sel.size, st=CPA_RV.status;
  const ids=JSON.stringify([...CPA_RV.sel]);
  bar.innerHTML='<span class="cph-fcount">'+(n?n+' ticked':'Tick photos to act on several at once')+'</span>'
    +(n?(st!=='published'?'<button class="btn btn-sm btn-primary" onclick="cpaRvDecide(\'publish\','+ids+')"><i class="fa-solid fa-check"></i> Publish '+n+'</button>':'')
      +(st==='published'?'<button class="btn btn-sm" onclick="cpaRvDecide(\'unpublish\','+ids+')"><i class="fa-solid fa-eye-slash"></i> Unpublish '+n+'</button>':'')
      +(st!=='rejected'?'<button class="btn btn-sm btn-danger" onclick="cpaRvDecide(\'reject\','+ids+')"><i class="fa-solid fa-xmark"></i> Reject '+n+'</button>':'')
      +'<button class="btn btn-sm" onclick="cpaRvClearSel()">Clear</button>':'');
}
window.cpaRvToggle=function(id,on){
  if(on) CPA_RV.sel.add(id); else CPA_RV.sel.delete(id);
  const c=document.querySelector('.cph-rvc[data-id="'+id+'"]'); if(c) c.classList.toggle('cph-picked',on);
  cpaRvSyncTickAll();
  cpaRvBar();
};
// Tick all / Untick all for one group: ticks every photo in it, or - when they are all ticked
// already - unticks them again.
window.cpaRvTick=function(ids){
  const all=ids.length&&ids.every(id=>CPA_RV.sel.has(id));
  ids.forEach(id=>{
    if(all) CPA_RV.sel.delete(id); else CPA_RV.sel.add(id);
    const c=document.querySelector('.cph-rvc[data-id="'+id+'"]');
    if(c){ c.classList.toggle('cph-picked',!all); const cb=c.querySelector('input'); if(cb) cb.checked=!all; }
  });
  cpaRvSyncTickAll();
  cpaRvBar();
};
// Each group's button says what it will do next.
function cpaRvSyncTickAll(){
  document.querySelectorAll('[data-tick-ids]').forEach(b=>{
    let ids=[]; try{ ids=JSON.parse(b.getAttribute('data-tick-ids')); }catch(_e){}
    const all=ids.length&&ids.every(id=>CPA_RV.sel.has(id));
    b.innerHTML=all?'<i class="fa-solid fa-square-minus"></i> Untick all':'<i class="fa-regular fa-square-check"></i> Tick all';
    b.classList.toggle('cph-tickon',!!all);
  });
}
window.cpaRvClearSel=function(){ CPA_RV.sel.clear(); document.querySelectorAll('.cph-rvc.cph-picked').forEach(c=>{c.classList.remove('cph-picked'); const cb=c.querySelector('input'); if(cb) cb.checked=false;}); cpaRvSyncTickAll(); cpaRvBar(); };
/* Larger preview with the decision buttons, so a photo can be checked properly before it is
   published. Arrows (and the keyboard arrows) move through the list in the order it is shown;
   after Publish / Reject / Unpublish it moves on to the next one by itself. */
function cpaRvPlace(p){
  const t=CPA_RV.sec;
  if(t==='unit_photos'){ const u=(CPA_RV.byUnit||{})[p.unit_id]||{};
    const area=(CPA_PH_AREAS.find(a=>a[0]===(p.area||'common'))||[0,p.area||''])[1];
    return (u.tower||'')+' · Flat '+(u.unit_code||'?')+(area?' · '+area:''); }
  if(t==='tower_photos') return p.tower||'Block';
  return 'Whole project';
}
window.cpaRvPreview=async function(id){
  const order=CPA_RV.order||[], i=order.indexOf(id);
  const p=(CPA_RV.shown||[]).find(x=>x.id===id); if(!p) return;
  cpaRvPreviewClose();
  const isVid=(p.file_type||'').indexOf('video')===0;
  const mine=String(p.uploaded_by||'').toLowerCase()===String(state.email||'').toLowerCase()&&!state.super;
  const one=JSON.stringify([p.id]);
  let acts;
  if(mine) acts='<span class="cph-pvnote">Your upload — another approver has to review it.</span>';
  else if(p.status==='pending'||p.status==='unpublished')
    acts='<button class="cph-pvbtn ok" onclick="cpaRvPvDecide(\'publish\','+p.id+')"><i class="fa-solid fa-check"></i> Publish</button>'
        +'<button class="cph-pvbtn no" onclick="cpaRvPvDecide(\'reject\','+p.id+')"><i class="fa-solid fa-xmark"></i> Reject</button>';
  else if(p.status==='published')
    acts='<button class="cph-pvbtn un" onclick="cpaRvPvDecide(\'unpublish\','+p.id+')"><i class="fa-solid fa-eye-slash"></i> Unpublish</button>'
        +'<button class="cph-pvbtn no" onclick="cpaRvPvDecide(\'reject\','+p.id+')"><i class="fa-solid fa-xmark"></i> Reject</button>';
  else acts='<button class="cph-pvbtn ok" onclick="cpaRvPvDecide(\'publish\','+p.id+')"><i class="fa-solid fa-check"></i> Publish after all</button>';
  const box=document.createElement('div');
  box.className='cph-box cph-pv'; box.id='cphPv';
  box.innerHTML='<div class="cph-boxbar"><i class="fa-solid '+(isVid?'fa-circle-play':'fa-image')+'"></i>'
      +'<span class="nm"><b>'+esc(cpaRvPlace(p))+'</b> · '+esc(fmtDate(p.taken_on))+' · '+esc(String(p.uploaded_by||'').split('@')[0])+'</span>'
      +'<span class="cph-pvn">'+(i+1)+' of '+order.length+'</span>'
      +'<button class="cph-boxx" title="Close (Esc)" onclick="cpaRvPreviewClose()">&times;</button></div>'
    +(i>0?'<button class="cph-pvnav l" title="Previous (←)" onclick="cpaRvPreviewStep(-1)"><i class="fa-solid fa-chevron-left"></i></button>':'')
    +(i<order.length-1?'<button class="cph-pvnav r" title="Next (→)" onclick="cpaRvPreviewStep(1)"><i class="fa-solid fa-chevron-right"></i></button>':'')
    +'<div class="cph-pvacts">'+acts+'</div>'
    +'<div class="cph-pvstage"><div class="cph-pvload"><i class="fa-solid fa-spinner fa-spin"></i></div></div>';
  box.onclick=function(e){ if(e.target===box) cpaRvPreviewClose(); };
  document.body.appendChild(box);
  CPA_RV.pvId=p.id;
  if(!window.__cphPvKeys){ window.__cphPvKeys=true;
    document.addEventListener('keydown',function(e){
      if(!$('cphPv')) return;
      if(e.key==='Escape') cpaRvPreviewClose();
      else if(e.key==='ArrowRight') cpaRvPreviewStep(1);
      else if(e.key==='ArrowLeft') cpaRvPreviewStep(-1);
    }); }
  // The thumbnail at once, the full photo when it has arrived, and the next ones fetched ahead.
  const stage=box.querySelector('.cph-pvstage'); if(!stage) return;
  const shownList=CPA_RV.shown||[], byId=id=>shownList.find(x=>x.id===id);
  cphPreload(byId(order[i+1])); cphPreload(byId(order[i+2])); cphPreload(byId(order[i-1]));
  await cphFullInto(stage,box,p);
};
window.cpaRvPreviewClose=function(){ const b=$('cphPv'); if(b) b.remove(); };
window.cpaRvPreviewStep=function(d){
  const order=CPA_RV.order||[], i=order.indexOf(CPA_RV.pvId), j=i+d;
  if(i<0||j<0||j>=order.length) return;
  cpaRvPreview(order[j]);
};
// A decision from the preview: remember what comes next, so the preview reopens on it afterwards.
window.cpaRvPvDecide=function(decision,id){
  const order=CPA_RV.order||[], i=order.indexOf(id);
  CPA_RV.pvNext=order[i+1]!=null?order[i+1]:(order[i-1]!=null?order[i-1]:null);
  cpaRvPreviewClose();
  cpaRvDecide(decision,[id],true);
};
// Reject is one click. Nothing is lost by it: the file stays, the photo can still be published
// from 'Rejected', and the uploader's next photo for the same place replaces it.
window.cpaRvDecide=function(decision,ids,fromPreview){
  if(!fromPreview) CPA_RV.pvNext=null;
  ids=(ids||[]).filter(Boolean);
  if(!ids.length) return;
  cpaRvDo(decision,ids,null);
};
async function cpaRvDo(decision,ids,note){
  const {data,error}=await sb.schema('cust').rpc('review_media',{p_table:CPA_RV.sec,p_ids:ids,p_decision:decision,p_note:note});
  if(error){ toast(error.message,'err'); return; }
  const done=data||[];
  const skipped=ids.length-done.length;
  const verb={publish:'published',reject:'rejected',unpublish:'unpublished'}[decision];
  toast(done.length+' '+verb+(skipped?' · '+skipped+' skipped (your own uploads, or already changed)':''),skipped&&!done.length?'warn':'ok');
  CPA_RV.sel.clear();
  const next=CPA_RV.pvNext; CPA_RV.pvNext=null;
  await cpaRvPaint();
  // Decided from the preview: carry on with the next photo, if it is still in the list.
  if(next!=null&&(CPA_RV.order||[]).indexOf(next)!==-1) cpaRvPreview(next);
}

/* ---------- Tab 5: Inspection (checklist scan + dated photo/video update trail, per unit) ---------- */
async function cpaRenderInspection(host){
  const units=await cpaUnits();
  const unitOpts=units.map(u=>`<option value="${u.id}">${esc(u.unit_code)} · ${esc((u.projects&&u.projects.name)||'')}</option>`).join('');
  const today=new Date().toISOString().slice(0,10);
  host.innerHTML=`<div class="grid" style="grid-template-columns:1fr 1fr;gap:16px">
    <div class="card card-pad frm"><div class="sec-title">Inspection checklist</div>
    <p style="font-size:12.5px;color:var(--slate);margin:0 0 6px">One checklist per unit — uploading a new one replaces the current one.</p>
    <label>Unit</label><select id="cpaIcUnit">${unitOpts}</select>
    <label>Checklist file (photo or PDF)</label><input type="file" id="cpaIcFile">
    <div style="margin-top:12px"><button class="btn btn-primary" id="cpaIcBtn" onclick="cpaUploadInspectionChecklist()"><i class="fa-solid fa-upload"></i> Upload / replace</button></div>
    </div>
    <div class="card card-pad frm"><div class="sec-title">Inspection updates</div>
    <p style="font-size:12.5px;color:var(--slate);margin:0 0 6px">Dated photo or video updates against the checklist — the customer sees these as a timeline.</p>
    <label>Unit</label><select id="cpaIuUnit">${unitOpts}</select>
    <label>Date shown to customers</label><input type="date" id="cpaIuDate" value="${today}">
    <label>Caption (optional)</label><input id="cpaIuCaption">
    <label>Photos or videos</label><input type="file" id="cpaIuFiles" accept="image/*,video/*" multiple>
    <div style="margin-top:12px"><button class="btn btn-primary" id="cpaIuBtn" onclick="cpaUploadInspectionUpdate()"><i class="fa-solid fa-upload"></i> Upload</button></div>
    </div></div>`;
}
window.cpaUploadInspectionChecklist=async function(){
  const unitId=Number($('cpaIcUnit').value);
  const f=$('cpaIcFile').files[0];if(!f){toast('Choose a file','err');return;}
  const btn=$('cpaIcBtn');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Uploading…';
  const {data,error}=await uploadFileToS3(s3KeyForInspectionChecklist(unitId,f.name),f);
  if(error){toast('Upload failed: '+error.message,'err');btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-upload"></i> Upload / replace';return;}
  const {error:insErr}=await sb.schema('cust').from('inspection_checklists')
    .upsert({unit_id:unitId,storage_path:data.path,file_name:f.name,file_size:f.size,file_type:f.type,uploaded_by:state.email,updated_at:new Date().toISOString()},{onConflict:'unit_id'});
  btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-upload"></i> Upload / replace';
  if(insErr){toast('Saved file but metadata failed: '+insErr.message,'err');return;}
  toast('Inspection checklist saved','ok');$('cpaIcFile').value='';
};
window.cpaUploadInspectionUpdate=async function(){
  const unitId=Number($('cpaIuUnit').value),takenOn=$('cpaIuDate').value,caption=$('cpaIuCaption').value.trim()||null;
  const files=[...$('cpaIuFiles').files];if(!files.length){toast('Choose at least one file','err');return;}
  const btn=$('cpaIuBtn');btn.disabled=true;let ok=0;
  for(const f of files){
    btn.innerHTML=`<i class="fa-solid fa-spinner fa-spin"></i> Uploading ${ok+1}/${files.length}…`;
    const {data,error}=await uploadFileToS3(s3KeyForInspectionUpdate(unitId,f.name),f);
    if(error){toast('Upload failed: '+error.message,'err');continue;}
    const {error:insErr}=await sb.schema('cust').from('inspection_updates').insert({unit_id:unitId,taken_on:takenOn,caption,storage_path:data.path,file_name:f.name,file_size:f.size,file_type:f.type,uploaded_by:state.email});
    if(insErr){toast('Saved file but metadata failed: '+insErr.message,'err');}else ok++;
  }
  btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-upload"></i> Upload';
  if(ok)toast(ok+' update(s) uploaded','ok');
  $('cpaIuFiles').value='';
};

/* ---------- Tab 6: Documents (+ company-wide process videos) ---------- */
const CPA_PROJECT_DOC_TYPES={brochure:'Brochure',legal:'Legal documentation'};
const CPA_CUSTOMER_DOC_TYPES={cost_sheet:'Cost Sheet',celebration_photo:'Celebration photo',celebration_video:'Celebration video',draft_agreement:'Draft Agreement for Sale',possession_letter:'Possession Letter',parking_allotment:'Parking Allotment Letter'};
const CPA_VIDEO_CATEGORIES={registry:'Registry Process',agreement:'Agreement Process',nomination:'Nomination Process'};
async function cpaRenderDocuments(host){
  const [projects,units]=await Promise.all([cpaProjects(),cpaUnits()]);
  const projOpts=projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const unitOpts=units.map(u=>`<option value="${u.id}">${esc(u.unit_code)} · ${esc((u.projects&&u.projects.name)||'')}</option>`).join('');
  host.innerHTML=`<div class="grid" style="grid-template-columns:1fr 1fr;gap:16px">
    <div class="card card-pad frm"><div class="sec-title">Project documents (brochure / legal)</div>
    <label>Project</label><select id="cpaPdProject" onchange="cpaPdLoad()">${projOpts}</select>
    <label>Document type</label><select id="cpaPdType" onchange="cpaPdDraw()">${Object.keys(CPA_PROJECT_DOC_TYPES).map(k=>`<option value="${k}"${k==='legal'?' selected':''}>${CPA_PROJECT_DOC_TYPES[k]}</option>`).join('')}</select>
    <label>Files</label>
    <div class="dropzone" id="cpaPdDrop" onclick="document.getElementById('cpaPdFile').click()"
      ondragover="event.preventDefault();this.style.borderColor='var(--brand)'" ondragleave="this.style.borderColor=''" ondrop="cpaPdDrop(event)">
      <i class="fa-solid fa-cloud-arrow-up"></i><div>Drag &amp; drop or click to choose files</div>
      <div style="font-size:12px;margin-top:4px">PDF, Word, images — as many as you like. Give each one the title customers will see.</div></div>
    <input type="file" id="cpaPdFile" class="hidden" multiple onchange="cpaPdAdd(this.files);this.value=''">
    <div id="cpaPdQueue" style="margin-top:8px"></div>
    <div style="margin-top:12px"><button class="btn btn-primary" id="cpaPdBtn" onclick="cpaUploadProjectDocs()" disabled><i class="fa-solid fa-upload"></i> Upload</button></div>
    </div>
    <div class="card card-pad frm"><div class="sec-title">Customer documents (per flat)</div>
    <label>Unit</label><select id="cpaCdUnit">${unitOpts}</select>
    <label>Document type</label><select id="cpaCdType">${Object.keys(CPA_CUSTOMER_DOC_TYPES).map(k=>`<option value="${k}">${CPA_CUSTOMER_DOC_TYPES[k]}</option>`).join('')}</select>
    <label>Title (optional)</label><input id="cpaCdTitle">
    <label>File</label><input type="file" id="cpaCdFile">
    <div style="margin-top:12px"><button class="btn btn-primary" id="cpaCdBtn" onclick="cpaUploadCustomerDoc()"><i class="fa-solid fa-upload"></i> Upload</button></div>
    </div></div>
    <div class="card card-pad" style="margin-top:16px"><div class="sec-title" id="cpaPdListTitle">Project documents on the portal</div>
    <div id="cpaPdList"><div class="loader"><div class="spin"></div></div></div></div>
    <div class="card card-pad frm" style="margin-top:16px"><div class="sec-title">Process explainer videos (company-wide — every customer sees these, regardless of project)</div>
    <div class="two"><div><label>Process</label><select id="cpaPvCategory">${Object.keys(CPA_VIDEO_CATEGORIES).map(k=>`<option value="${k}">${CPA_VIDEO_CATEGORIES[k]}</option>`).join('')}</select></div><div><label>Title (optional)</label><input id="cpaPvTitle"></div></div>
    <label>Video file</label><input type="file" id="cpaPvFile" accept="video/*">
    <div style="margin-top:12px"><button class="btn btn-primary" id="cpaPvBtn" onclick="cpaUploadProcessVideo()"><i class="fa-solid fa-upload"></i> Upload</button></div>
    <div id="cpaPvList" style="margin-top:16px"></div>
    </div>`;
  CPA_PD.files=[];
  cpaPdLoad();
  cpaRenderProcessVideoList();
}
async function cpaRenderProcessVideoList(){
  const host=$('cpaPvList');if(!host)return;
  const {data}=await sb.schema('cust').from('process_videos').select('*').is('deleted_at',null).order('category').order('created_at',{ascending:false});
  const rows=(data||[]).map(v=>[CPA_VIDEO_CATEGORIES[v.category]||v.category,esc(v.title||v.file_name||'—'),fmtDate(v.created_at),
    `<button class="btn btn-sm btn-danger" onclick="cpaDeleteProcessVideo(${v.id})">Delete</button>`]);
  host.innerHTML=cpaTable(['Process','Title','Uploaded','Delete'],rows.length?rows:[['No videos yet','','','']]);
}
window.cpaUploadProcessVideo=async function(){
  const category=$('cpaPvCategory').value,title=$('cpaPvTitle').value.trim()||null;
  const f=$('cpaPvFile').files[0];if(!f){toast('Choose a video file','err');return;}
  const btn=$('cpaPvBtn');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Uploading…';
  const {data,error}=await uploadFileToS3(s3KeyForProcessVideo(category,f.name),f);
  btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-upload"></i> Upload';
  if(error){toast('Upload failed: '+error.message,'err');return;}
  const {error:insErr}=await sb.schema('cust').from('process_videos').insert({category,title,storage_path:data.path,file_name:f.name,file_size:f.size,file_type:f.type,uploaded_by:state.email});
  if(insErr){toast('Saved file but metadata failed: '+insErr.message,'err');return;}
  toast('Video uploaded','ok');$('cpaPvFile').value='';$('cpaPvTitle').value='';
  cpaRenderProcessVideoList();
};
window.cpaDeleteProcessVideo=async function(id){
  if(!await confirmDialog('Remove this video from the customer portal?',{okLabel:'Delete'}))return;
  const {error}=await sb.schema('cust').from('process_videos').update({deleted_at:new Date().toISOString(),deleted_by:state.email}).eq('id',id);
  if(error){toast('Delete failed: '+error.message,'err');return;}
  toast('Video removed','ok');cpaRenderProcessVideoList();
};
/* PROJECT DOCUMENTS GO UP SEVERAL AT A TIME (29 Oct 2026). A project's legal set is a folder of
   papers - board resolution, certificate of incorporation, deeds, declarations, trade licence - and
   the card took one file per upload with no way to see what was already there. Now any number of
   files can be picked or dropped; each gets its own title (what the customer reads, prefilled from
   the file name); a file already on the portal for that project and type is flagged before it goes
   up twice; and the list below the cards shows exactly what that project's customers see, with
   rename and remove. Files go up one at a time, so one failure leaves the rest in place to retry.
   Removing only hides the row (deleted_at) - the file stays on S3. */
const CPA_PD={files:[],existing:[],busy:false};
function cpaPdName(d){ return d.title||(d.file_name||'Document').replace(/\.[^.]+$/,''); }
function cpaPdTitleFromFile(name){ return name.replace(/\.[^.]+$/,'').replace(/[_]+/g,' ').replace(/\s+/g,' ').trim(); }
window.cpaPdAdd=function(files){
  if(CPA_PD.busy) return;
  [...(files||[])].forEach(f=>{
    if(CPA_PD.files.some(q=>q.file.name===f.name&&q.file.size===f.size)) return;   // picked twice
    CPA_PD.files.push({file:f,title:cpaPdTitleFromFile(f.name)});
  });
  cpaPdDraw();
};
window.cpaPdDrop=function(e){
  e.preventDefault(); e.currentTarget.style.borderColor='';
  cpaPdAdd(e.dataTransfer&&e.dataTransfer.files);
};
window.cpaPdTitle=function(i,v){ if(CPA_PD.files[i]) CPA_PD.files[i].title=v; };
window.cpaPdRemove=function(i){ if(!CPA_PD.busy){ CPA_PD.files.splice(i,1); cpaPdDraw(); } };
window.cpaPdDraw=function(){
  const host=$('cpaPdQueue');if(!host)return;
  const type=$('cpaPdType').value;
  const have=new Set(CPA_PD.existing.filter(d=>d.doc_type===type).map(d=>(d.file_name||'').toLowerCase()));
  host.innerHTML=CPA_PD.files.map((q,i)=>{
    const f=q.file;
    const st=q.state==='up'?'<span style="color:var(--brand)"><i class="fa-solid fa-spinner fa-spin"></i> Uploading…</span>'
      :q.state==='err'?'<span class="tag t-red" title="'+esc(q.err||'')+'">Failed — will retry</span>'
      :have.has(f.name.toLowerCase())?'<span class="tag t-amber">Already on the portal</span>':'';
    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line-2)">${fileIcon(f.name.split('.').pop())}
      <div style="flex:1;min-width:0"><input value="${esc(q.title)}" oninput="cpaPdTitle(${i},this.value)" ${CPA_PD.busy?'disabled':''} placeholder="Title customers will see"
        style="width:100%;font-size:13px;font-weight:500;border:1px solid var(--line);border-radius:7px;padding:6px 9px;color:var(--ink);margin:0">
      <div style="font-size:11.5px;color:var(--slate);margin-top:3px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">${esc(f.name)} · ${fmtBytes(f.size)}</span>${st}</div></div>
      <button class="btn btn-sm" title="Remove from this upload" onclick="cpaPdRemove(${i})" ${CPA_PD.busy?'disabled':''}><i class="fa-solid fa-xmark"></i></button></div>`;
  }).join('');
  const btn=$('cpaPdBtn');
  if(btn&&!CPA_PD.busy){
    const n=CPA_PD.files.length;
    btn.disabled=!n;
    btn.innerHTML='<i class="fa-solid fa-upload"></i> '+(n>1?'Upload '+n+' files':'Upload');
  }
};
window.cpaPdLoad=async function(){
  const sel=$('cpaPdProject');if(!sel)return;
  const pid=Number(sel.value);
  const {data,error}=await sb.schema('cust').from('project_documents').select('*').eq('project_id',pid).is('deleted_at',null);
  if(!$('cpaPdProject')||Number($('cpaPdProject').value)!==pid) return;   // switched project meanwhile
  if(error){ $('cpaPdList').innerHTML='<div class="empty">Could not load documents: '+esc(error.message)+'</div>'; return; }
  CPA_PD.existing=data||[];
  cpaPdDraw(); cpaPdDrawList();
};
function cpaPdDrawList(){
  const host=$('cpaPdList');if(!host)return;
  const sel=$('cpaPdProject'), proj=sel.options[sel.selectedIndex]?sel.options[sel.selectedIndex].text:'';
  $('cpaPdListTitle').textContent='What '+proj+' customers see';
  const byName=(a,b)=>cpaPdName(a).localeCompare(cpaPdName(b),undefined,{numeric:true,sensitivity:'base'});
  const groups=Object.keys(CPA_PROJECT_DOC_TYPES).map(t=>{
    const docs=CPA_PD.existing.filter(d=>d.doc_type===t).sort(byName);
    const rows=docs.map(d=>[
      `<div style="display:flex;align-items:center;gap:8px;min-width:260px">${fileIcon((d.file_name||'').split('.').pop())}<input value="${esc(cpaPdName(d))}" title="${esc(d.file_name||'')}" onchange="cpaPdRename(${d.id},this)"
        style="flex:1;font-size:13px;border:1px solid transparent;border-radius:6px;padding:5px 8px;background:transparent;color:var(--ink)" onfocus="this.style.borderColor='var(--line)'" onblur="this.style.borderColor='transparent'"></div>`,
      fmtBytes(d.file_size),
      fmtDate(d.created_at)+(d.uploaded_by?'<div style="font-size:11.5px;color:var(--slate)">'+esc(String(d.uploaded_by).split('@')[0])+'</div>':''),
      `<button class="btn btn-sm" onclick="s3OpenSigned('${d.storage_path.replace(/'/g,"\\'")}')"><i class="fa-solid fa-eye"></i> View</button> <button class="btn btn-sm btn-danger" onclick="cpaPdDelete(${d.id})">Remove</button>`]);
    return '<div style="font-size:13px;font-weight:700;color:var(--ink);margin:'+(t==='brochure'?'4px':'16px')+' 0 8px">'+esc(CPA_PROJECT_DOC_TYPES[t])+' <span style="color:var(--slate);font-weight:500">· '+docs.length+'</span></div>'
      +(rows.length?cpaTable(['Title (click to rename)','Size','Uploaded','Actions'],rows):'<div style="font-size:13px;color:var(--slate);padding:2px 0 4px">None yet.</div>');
  });
  host.innerHTML=groups.join('');
}
window.cpaPdRename=async function(id,inp){
  const d=CPA_PD.existing.find(x=>x.id===id);if(!d)return;
  const title=inp.value.trim();
  if(!title){inp.value=cpaPdName(d);toast('The title cannot be empty','err');return;}
  const {error}=await sb.schema('cust').from('project_documents').update({title}).eq('id',id);
  if(error){inp.value=cpaPdName(d);toast('Rename failed: '+error.message,'err');return;}
  d.title=title;toast('Title saved','ok');
};
window.cpaPdDelete=async function(id){
  const d=CPA_PD.existing.find(x=>x.id===id);if(!d)return;
  if(!await confirmDialog('Remove "'+cpaPdName(d)+'" from the customer portal? Customers of this project will no longer see it.',{okLabel:'Remove'}))return;
  const {error}=await sb.schema('cust').from('project_documents').update({deleted_at:new Date().toISOString(),deleted_by:state.email}).eq('id',id);
  if(error){toast('Remove failed: '+error.message,'err');return;}
  toast('Document removed','ok');cpaPdLoad();
};
window.cpaUploadProjectDocs=async function(){
  if(CPA_PD.busy)return;
  const projectId=Number($('cpaPdProject').value),docType=$('cpaPdType').value;
  const todo=CPA_PD.files.slice();
  if(!todo.length){toast('Choose at least one file','err');return;}
  if(todo.some(q=>!String(q.title||'').trim())){toast('Every file needs a title','err');return;}
  CPA_PD.busy=true;
  const btn=$('cpaPdBtn'), lock=v=>['cpaPdProject','cpaPdType'].forEach(id=>{ if($(id)) $(id).disabled=v; });
  btn.disabled=true;lock(true);
  let ok=0,n=0;
  for(const q of todo){
    n++;btn.innerHTML=`<i class="fa-solid fa-spinner fa-spin"></i> Uploading ${n}/${todo.length}…`;
    q.state='up';q.err=null;cpaPdDraw();
    const f=q.file;
    const {data,error}=await uploadFileToS3(s3KeyForProjectDoc(projectId,docType,f.name),f);
    if(error){q.state='err';q.err=error.message;continue;}
    const {error:insErr}=await sb.schema('cust').from('project_documents').insert({project_id:projectId,doc_type:docType,title:q.title.trim(),storage_path:data.path,file_name:f.name,file_size:f.size,file_type:f.type,uploaded_by:state.email});
    if(insErr){q.state='err';q.err=insErr.message;continue;}
    q.state='ok';ok++;
  }
  CPA_PD.files=CPA_PD.files.filter(q=>q.state!=='ok');
  CPA_PD.busy=false;lock(false);
  const failed=todo.length-ok;
  if(ok) toast(ok+' document'+(ok===1?'':'s')+' uploaded'+(failed?' · '+failed+' failed — press Upload to retry':''),failed?'warn':'ok');
  else toast('Upload failed: '+(todo[0].err||'unknown error'),'err');
  await cpaPdLoad();
};
window.cpaUploadCustomerDoc=async function(){
  const unitId=Number($('cpaCdUnit').value),docType=$('cpaCdType').value,title=$('cpaCdTitle').value.trim()||null;
  const f=$('cpaCdFile').files[0];if(!f){toast('Choose a file','err');return;}
  const btn=$('cpaCdBtn');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Uploading…';
  const {data,error}=await uploadFileToS3(s3KeyForCustomerDoc(unitId,docType,f.name),f);
  btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-upload"></i> Upload';
  if(error){toast('Upload failed: '+error.message,'err');return;}
  const {error:insErr}=await sb.schema('cust').from('customer_documents').insert({unit_id:unitId,doc_type:docType,title,storage_path:data.path,file_name:f.name,file_size:f.size,file_type:f.type,uploaded_by:state.email});
  if(insErr){toast('Saved file but metadata failed: '+insErr.message,'err');return;}
  toast('Document uploaded','ok');$('cpaCdFile').value='';
};

/* ---------- Tab 7: Amenities (booking calendar + manual QR/UPI payment, post-possession only) ---------- */
async function cpaRenderAmenities(host){
  const [projects,amenities,pay]=await Promise.all([cpaProjects(),cpaAmenities(true),cpaPaymentSettings(true)]);
  const projOpts=projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const amRows=amenities.map(a=>[esc(a.name),esc((a.projects&&a.projects.name)||'—'),a.rental_amount!=null?custInr(a.rental_amount):'—',
    `<button class="btn btn-sm btn-danger" onclick="cpaDeleteAmenity(${a.id})">Delete</button>`]);
  host.innerHTML=`<div class="grid" style="grid-template-columns:1fr 1fr;gap:16px">
    <div class="card card-pad frm"><div class="sec-title">New amenity</div>
    <label>Project</label><select id="cpaAmProject">${projOpts}</select>
    <label>Name</label><input id="cpaAmName" placeholder="Banquet Hall">
    <label>Description (optional)</label><textarea id="cpaAmDesc"></textarea>
    <label>Rental amount (₹, optional)</label><input id="cpaAmAmount" type="number">
    <div style="margin-top:12px"><button class="btn btn-primary" onclick="cpaAmenitySave()"><i class="fa-solid fa-plus"></i> Add amenity</button></div>
    </div>
    <div class="card card-pad frm"><div class="sec-title">Payment QR / UPI <span style="font-weight:400;color:var(--slate);font-size:12px">— shared by amenities &amp; sub-meter</span></div>
    <label>UPI ID</label><input id="cpaPayUpi" value="${esc(pay.upi_id||'')}" placeholder="jaingroup@upi">
    <label>QR code image (optional)</label><input type="file" id="cpaPayQrFile" accept="image/*">
    ${pay.qr_storage_path?`<div style="margin:8px 0"><button class="btn btn-sm" onclick="s3OpenSigned('${pay.qr_storage_path.replace(/'/g,"\\'")}')"><i class="fa-solid fa-qrcode"></i> View current QR</button></div>`:''}
    <div style="margin-top:12px"><button class="btn btn-primary" onclick="cpaPaymentSettingsSave()"><i class="fa-solid fa-save"></i> Save</button></div>
    </div></div>
    <div class="sec-title" style="margin:20px 0 10px">Amenities</div>
    ${amRows.length?cpaTable(['Name','Project','Rental amount','Delete'],amRows):'<div class="card card-pad empty">No amenities yet.</div>'}
    <div class="sec-title" style="margin:20px 0 10px">Bookings</div>
    <div id="cpaAmBookings"><div class="loader"><div class="spin"></div></div></div>`;
  cpaRenderAmenityBookings();
}
window.cpaAmenitySave=async function(){
  const project_id=Number($('cpaAmProject').value),name=$('cpaAmName').value.trim(),
    description=$('cpaAmDesc').value.trim()||null,rental_amount=$('cpaAmAmount').value?Number($('cpaAmAmount').value):null;
  if(!project_id||!name){toast('Project and name are required','err');return;}
  const {error}=await sb.schema('cust').from('amenities').insert({project_id,name,description,rental_amount,created_by:state.email});
  if(error){toast('Save failed: '+error.message,'err');return;}
  toast('Amenity added','ok');route();
};
window.cpaDeleteAmenity=async function(id){
  if(!await confirmDialog('Remove this amenity? Existing bookings stay on record.',{okLabel:'Delete'}))return;
  const {error}=await sb.schema('cust').from('amenities').update({deleted_at:new Date().toISOString(),deleted_by:state.email}).eq('id',id);
  if(error){toast('Delete failed: '+error.message,'err');return;}
  toast('Amenity removed','ok');route();
};
window.cpaPaymentSettingsSave=async function(){
  const upi_id=$('cpaPayUpi').value.trim()||null;
  const f=$('cpaPayQrFile').files[0];
  const row={id:1,upi_id,updated_at:new Date().toISOString(),updated_by:state.email};
  if(f){
    const {data,error}=await uploadFileToS3(s3KeyForPaymentQR(f.name),f);
    if(error){toast('QR upload failed: '+error.message,'err');return;}
    row.qr_storage_path=data.path;
  }
  const {error}=await sb.schema('cust').from('payment_settings').upsert(row,{onConflict:'id'});
  if(error){toast('Save failed: '+error.message,'err');return;}
  toast('Payment settings saved','ok');route();
};
async function cpaRenderAmenityBookings(){
  const host=$('cpaAmBookings');if(!host)return;
  const {data}=await sb.schema('cust').from('amenity_bookings').select('*, amenities(name), units(unit_code)').order('booking_date',{ascending:false}).limit(200);
  const rows=(data||[]).map(b=>[esc((b.amenities&&b.amenities.name)||'—'),esc((b.units&&b.units.unit_code)||'—'),fmtDate(b.booking_date),
    b.amount!=null?custInr(b.amount):'—',
    b.status==='confirmed'?'<span class="tag t-green">Confirmed</span>':b.status==='cancelled'?'<span class="tag t-gray">Cancelled</span>':'<span class="tag t-amber">Pending payment</span>',
    esc(b.payment_reference||'—'),
    b.status==='pending_payment'?`<button class="btn btn-sm btn-primary" onclick="cpaConfirmBooking(${b.id})">Confirm</button> <button class="btn btn-sm btn-danger" onclick="cpaCancelBooking(${b.id})">Cancel</button>`:'—']);
  host.innerHTML=rows.length?cpaTable(['Amenity','Unit','Date','Amount','Status','Payment ref','Actions'],rows):'<div class="card card-pad empty">No bookings yet.</div>';
}
window.cpaConfirmBooking=async function(id){
  const {error}=await sb.schema('cust').from('amenity_bookings').update({status:'confirmed',marked_paid_by:state.email,marked_paid_at:new Date().toISOString()}).eq('id',id);
  if(error){toast('Failed: '+error.message,'err');return;}
  toast('Booking confirmed','ok');cpaRenderAmenityBookings();
};
window.cpaCancelBooking=async function(id){
  if(!await confirmDialog('Cancel this booking? The date becomes available again.',{okLabel:'Cancel booking'}))return;
  const {error}=await sb.schema('cust').from('amenity_bookings').update({status:'cancelled'}).eq('id',id);
  if(error){toast('Failed: '+error.message,'err');return;}
  toast('Booking cancelled','ok');cpaRenderAmenityBookings();
};

/* ---------- Tab 8: Sub-meter fixing requests ---------- */
async function cpaRenderSubmeter(host){
  const {data}=await sb.schema('cust').from('submeter_requests').select('*, units(unit_code, projects(name))').order('requested_at',{ascending:false}).limit(200);
  const tagFor={requested:'<span class="tag t-amber">Requested</span>',invoiced:'<span class="tag t-blue">Invoiced</span>',paid:'<span class="tag t-green">Paid</span>',completed:'<span class="tag t-green">Completed</span>',cancelled:'<span class="tag t-gray">Cancelled</span>'};
  const rows=(data||[]).map(r=>{
    let actions='—';
    if(r.status==='requested')actions=`<button class="btn btn-sm btn-primary" onclick="cpaSubmeterInvoiceModal(${r.id},${r.unit_id})">Invoice</button>`;
    else if(r.status==='invoiced')actions=`<button class="btn btn-sm btn-primary" onclick="cpaSubmeterMarkPaid(${r.id})">Mark paid</button>`;
    else if(r.status==='paid')actions=`<button class="btn btn-sm btn-primary" onclick="cpaSubmeterMarkCompleted(${r.id})">Mark completed</button>`;
    return [esc((r.units&&r.units.unit_code)||'—'),esc((r.units&&r.units.projects&&r.units.projects.name)||'—'),fmtDate(r.requested_at),
      r.invoice_amount!=null?custInr(r.invoice_amount):'—',tagFor[r.status]||esc(r.status),actions];
  });
  host.innerHTML=rows.length?cpaTable(['Unit','Project','Requested','Invoice amount','Status','Actions'],rows):'<div class="card card-pad empty">No sub-meter requests yet.</div>';
}
window.cpaSubmeterInvoiceModal=function(id,unitId){
  openModal(`<div class="modal-head"><h3>Raise invoice</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm"><label>Invoice amount (₹)</label><input id="cpaSmAmount" type="number">
    <label>Invoice document (optional)</label><input type="file" id="cpaSmFile"></div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="cpaSubmeterInvoiceSave(${id},${unitId})">Save</button></div>`);
};
window.cpaSubmeterInvoiceSave=async function(id,unitId){
  const amount=Number($('cpaSmAmount').value||0);
  if(!amount){toast('Enter an invoice amount','err');return;}
  const f=$('cpaSmFile').files[0];
  const row={status:'invoiced',invoice_amount:amount,invoiced_at:new Date().toISOString(),invoiced_by:state.email};
  if(f){
    const {data,error}=await uploadFileToS3(s3KeyForSubmeterInvoice(unitId,f.name),f);
    if(error){toast('Invoice upload failed: '+error.message,'err');return;}
    row.invoice_storage_path=data.path;
  }
  const {error}=await sb.schema('cust').from('submeter_requests').update(row).eq('id',id);
  if(error){toast('Save failed: '+error.message,'err');return;}
  closeModal();toast('Invoice raised','ok');route();
};
window.cpaSubmeterMarkPaid=async function(id){
  const {error}=await sb.schema('cust').from('submeter_requests').update({status:'paid',marked_paid_by:state.email,paid_at:new Date().toISOString()}).eq('id',id);
  if(error){toast('Failed: '+error.message,'err');return;}
  toast('Marked paid','ok');route();
};
window.cpaSubmeterMarkCompleted=async function(id){
  const {error}=await sb.schema('cust').from('submeter_requests').update({status:'completed',completed_at:new Date().toISOString()}).eq('id',id);
  if(error){toast('Failed: '+error.message,'err');return;}
  toast('Marked completed','ok');route();
};

/* ---------- Tab 9: Support tickets (local mirror of Zoho Desk) ---------- */
// Buckets (open/in_progress/on_hold/closed) only ever drive the tag's colour - the label itself is
// always Zoho's own literal status text, since orgs add custom statuses a fixed set of labels can't
// predict ("show the same status as Zoho" was the explicit ask).
const SUPPORT_STATUS_CLASS={open:'t-amber',in_progress:'t-blue',on_hold:'t-gray',closed:'t-green'};
function supportStatusTag(t){
  const cls=SUPPORT_STATUS_CLASS[t.status]||'t-blue';
  const label=t.zoho_status||(t.zoho_ticket_id?t.status:'Not yet in Zoho');
  return `<span class="tag ${cls}">${esc(label)}</span>`;
}
/* Admin Support list, filtered by Zoho status, how the ticket came in, and a search over subject,
   customer and ticket number. All three filter the list already loaded, so changing one is instant. */
let CPA_SUP={rows:null,status:'',via:'',q:''};
async function cpaRenderSupport(host){
  const {data}=await sb.schema('cust').from('support_tickets').select('*, units(unit_code), customers(full_name)').is('deleted_at',null)
    .order('created_at',{ascending:false}).limit(1000);
  CPA_SUP.rows=(data||[]).sort((a,b)=>String(b.zoho_created_time||b.created_at).localeCompare(String(a.zoho_created_time||a.created_at)));
  const ids=CPA_SUP.rows.map(t=>t.id);
  const {data:atts}=ids.length?await sb.schema('cust').from('support_ticket_attachments').select('*').in('ticket_id',ids).is('deleted_at',null):{data:[]};
  CPA_SUP.atts={};(atts||[]).forEach(a=>{(CPA_SUP.atts[a.ticket_id]=CPA_SUP.atts[a.ticket_id]||[]).push(a);});
  const statusOf=t=>t.zoho_status||(t.zoho_ticket_id?t.status:'Not yet in Zoho');
  const counts={};CPA_SUP.rows.forEach(t=>{const k=statusOf(t);counts[k]=(counts[k]||0)+1;});
  const vias={};CPA_SUP.rows.forEach(t=>{const k=custTicketVia(t)[0];vias[k]=(vias[k]||0)+1;});
  const opt=(v,l,cur)=>'<option value="'+esc(v)+'"'+(v===cur?' selected':'')+'>'+esc(l)+'</option>';
  host.innerHTML='<div class="cph-filters" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">'
      +'<div class="frm" style="min-width:200px"><label>Status</label><select onchange="CPA_SUP.status=this.value;cpaSupPaint()">'
        +opt('','All statuses ('+CPA_SUP.rows.length+')',CPA_SUP.status)
        +Object.keys(counts).sort((a,b)=>counts[b]-counts[a]).map(k=>opt(k,k+' ('+counts[k]+')',CPA_SUP.status)).join('')+'</select></div>'
      +'<div class="frm" style="min-width:150px"><label>Via</label><select onchange="CPA_SUP.via=this.value;cpaSupPaint()">'
        +opt('','All',CPA_SUP.via)+Object.keys(vias).sort().map(k=>opt(k,k+' ('+vias[k]+')',CPA_SUP.via)).join('')+'</select></div>'
      +'<div class="frm" style="flex:1 1 220px"><label>Search</label><input placeholder="Subject, customer or ticket #" value="'+esc(CPA_SUP.q)+'" oninput="CPA_SUP.q=this.value;cpaSupPaint()"></div>'
      +'<span id="cpaSupCount" style="font-size:12.5px;color:var(--slate);padding-bottom:9px"></span></div>'
    +'<div id="cpaSupList"></div>'
    +'<div style="font-size:12px;color:var(--slate);margin-top:10px">Zoho Desk is the system of record for tickets — resolve/reply from Zoho Desk itself. Tickets customers email to customer care are brought in every 10 minutes (last two months). "Conversation" fetches the latest messages from Zoho as it opens.</div>';
  cpaSupPaint();
}
window.cpaSupPaint=function(){
  const host=$('cpaSupList'); if(!host||!CPA_SUP.rows) return;
  const q=CPA_SUP.q.trim().toLowerCase();
  const statusOf=t=>t.zoho_status||(t.zoho_ticket_id?t.status:'Not yet in Zoho');
  const list=CPA_SUP.rows.filter(t=>(!CPA_SUP.status||statusOf(t)===CPA_SUP.status)&&(!CPA_SUP.via||custTicketVia(t)[0]===CPA_SUP.via)
    &&(!q||[t.subject,t.zoho_ticket_number,t.customers&&t.customers.full_name,t.zoho_contact_email,t.units&&t.units.unit_code].some(x=>String(x||'').toLowerCase().indexOf(q)!==-1)));
  const c=$('cpaSupCount'); if(c) c.textContent=list.length+' of '+CPA_SUP.rows.length;
  const rows=list.map(t=>[esc((t.customers&&t.customers.full_name)||t.zoho_contact_email||'—')+'<div style="font-size:11.5px;color:var(--slate)">'+esc((t.units&&t.units.unit_code)||'All flats')+'</div>',
    esc(custTicketVia(t)[0]),esc(t.subject),esc(t.zoho_ticket_number||'—'),
    supportStatusTag(t),
    (CPA_SUP.atts[t.id]||[]).map(a=>`<button class="btn btn-sm" onclick="s3OpenSigned('${a.storage_path.replace(/'/g,"\\'")}','${esc(a.file_name||'file').replace(/'/g,"\\'")}')" title="${esc(a.file_name||'')}${a.zoho_attachment_id?' (in Zoho)':' (not in Zoho)'}"><i class="fa-solid fa-paperclip"></i></button>`).join(' ')||'—',
    fmtDate(t.zoho_created_time||t.created_at),
    (t.zoho_ticket_id?`<button class="btn btn-sm" onclick="cpaTicketDetail(${t.id})"><i class="fa-solid fa-comments"></i> Conversation</button> <button class="btn btn-sm" onclick="cpaSyncTicket(${t.id})"><i class="fa-solid fa-rotate"></i> Refresh</button>`:`<button class="btn btn-sm" onclick="cpaRetryTicket(${t.id})"><i class="fa-solid fa-rotate-right"></i> Retry</button>`)]);
  host.innerHTML=rows.length?cpaTable(['Customer','Via','Subject','Zoho #','Status','Attachments','Raised','Actions'],rows)
    :'<div class="card card-pad empty">No tickets match.</div>';
};
function cpaBuildBubbles(t,threads,comments){
  const msgs=(t.source==='zoho'?[]:[{time:t.created_at,author:'Customer',content:t.description||t.subject}])
    .concat((threads||[]).map(m=>({time:m.zoho_created_time||m.created_at,out:m.direction==='out',author:m.direction==='out'?((m.author_name||'Agent')+' (agent)'):((m.author_name||'Customer')+' (customer)'),content:m.content})))
    .concat((comments||[]).map(m=>({time:m.zoho_commented_time||m.created_at,out:!m.posted_by_customer,author:m.posted_by_customer?((m.commenter_name||'Customer')+' (customer, via portal)'):((m.commenter_name||'Agent')+' (agent comment)'),content:m.content})));
  msgs.sort((a,b)=>new Date(a.time||0)-new Date(b.time||0));
  // Agent messages on the right, customer messages on the left - and the time as well as the date.
  const when=d=>d?new Date(d).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
  return msgs.map(m=>`<div style="margin-bottom:10px;display:flex;flex-direction:column;align-items:${m.out?'flex-end':'flex-start'}"><div style="font-size:11.5px;color:var(--slate);margin-bottom:2px">${esc(m.author)} · ${esc(when(m.time))}</div><div class="card card-pad" style="white-space:pre-wrap;font-size:13.5px;max-width:88%;background:${m.out?'#eff6ff':'#fff'}">${esc(m.content||'')}</div></div>`).join('')||'<div class="card card-pad empty">No messages yet.</div>';
}
let CPA_TICKET_POLL_TIMER=null;
// Brings one ticket's status and whole conversation down from Zoho (zoho-desk 'sync'). Errors are
// left for the caller's own message; a failure here still shows whatever is already stored.
async function supTicketSync(id){
  try{
    const {data:{session}}=await sb.auth.getSession();const token=session&&session.access_token;
    const res=await fetch(SUPABASE_URL+'/functions/v1/zoho-desk',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},body:JSON.stringify({action:'sync',ticketId:id})});
    return await res.json().catch(()=>({}));
  }catch(e){ return {error:String(e&&e.message||e)}; }
}
window.cpaTicketDetail=async function(id){
  openModal('<div class="card-pad" style="text-align:center;color:var(--slate)"><div class="loader"><div class="spin"></div></div>Fetching the conversation from Zoho…</div>');
  await supTicketSync(id);
  const {data:t}=await sb.schema('cust').from('support_tickets').select('*').eq('id',id).maybeSingle();
  const [{data:threads},{data:comments}]=await Promise.all([
    sb.schema('cust').from('support_ticket_threads').select('*').eq('ticket_id',id),
    sb.schema('cust').from('support_ticket_comments').select('*').eq('ticket_id',id)
  ]);
  openModal(`<div class="modal-head"><h3>${esc(t.subject)}</h3><span class="x" onclick="cpaTicketDetailClose()">&times;</span></div>
    <div class="modal-body"><div id="cpaMsgsContainer">${cpaBuildBubbles(t,threads,comments)}</div></div>
    <div class="modal-foot"><button class="btn" onclick="cpaTicketDetailClose()">Close</button></div>`,'lg');
  if(CPA_TICKET_POLL_TIMER)clearInterval(CPA_TICKET_POLL_TIMER);
  CPA_TICKET_POLL_TIMER=setInterval(()=>cpaTicketPollTick(id),20000);
};
window.cpaTicketDetailClose=function(){
  if(CPA_TICKET_POLL_TIMER){clearInterval(CPA_TICKET_POLL_TIMER);CPA_TICKET_POLL_TIMER=null;}
  closeModal();
};
async function cpaTicketPollTick(id){
  const container=$('cpaMsgsContainer');
  if(!container){if(CPA_TICKET_POLL_TIMER){clearInterval(CPA_TICKET_POLL_TIMER);CPA_TICKET_POLL_TIMER=null;}return;}
  if(document.hidden)return; // don't burn Zoho API calls on a backgrounded tab
  try{
    const {data:{session}}=await sb.auth.getSession();const token=session&&session.access_token;
    await fetch(SUPABASE_URL+'/functions/v1/zoho-desk',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},body:JSON.stringify({action:'sync',ticketId:id})});
  }catch(e){/* silent - next tick retries */}
  const stillThere=$('cpaMsgsContainer');if(!stillThere)return;
  const [{data:t},{data:threads},{data:comments}]=await Promise.all([
    sb.schema('cust').from('support_tickets').select('*').eq('id',id).maybeSingle(),
    sb.schema('cust').from('support_ticket_threads').select('*').eq('ticket_id',id),
    sb.schema('cust').from('support_ticket_comments').select('*').eq('ticket_id',id)
  ]);
  const container2=$('cpaMsgsContainer');
  if(container2&&t)container2.innerHTML=cpaBuildBubbles(t,threads,comments);
};
window.cpaSyncTicket=async function(id){
  toast('Refreshing status…','');
  try{
    const {data:{session}}=await sb.auth.getSession();const token=session&&session.access_token;
    const res=await fetch(SUPABASE_URL+'/functions/v1/zoho-desk',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},body:JSON.stringify({action:'sync',ticketId:id})});
    const out=await res.json().catch(()=>({}));
    if(!res.ok||out.error){toast('Refresh failed: '+(out.error||res.status),'err');return;}
    if(out.attachmentErrors&&out.attachmentErrors.length)toast('Status updated, but some attachments still haven’t reached Zoho Desk: '+out.attachmentErrors.join('; '),'err');
    else toast('Status updated','ok');
    route();
  }catch(e){toast('Refresh failed: '+e.message,'err');}
};
window.cpaRetryTicket=async function(id){
  toast('Retrying Zoho Desk create…','');
  try{
    const {data:{session}}=await sb.auth.getSession();const token=session&&session.access_token;
    const res=await fetch(SUPABASE_URL+'/functions/v1/zoho-desk',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},body:JSON.stringify({action:'create',ticketId:id})});
    const out=await res.json().catch(()=>({}));
    if(!res.ok||out.error){toast('Retry failed: '+(out.error||res.status),'err');return;}
    toast('Created in Zoho Desk','ok');route();
  }catch(e){toast('Retry failed: '+e.message,'err');}
};

/* ---------- Tab 10: Referrals ---------- */
const CPA_REFERRAL_STATUSES={submitted:'Submitted',contacted:'Contacted',interested:'Interested',visited_site:'Visited Site',booked:'Booked',not_interested:'Not Interested'};
async function cpaRenderReferrals(host){
  await custRefProjects();
  const {data}=await sb.schema('cust').from('referrals').select('*, units(unit_code), referral_projects(name)').order('created_at',{ascending:false}).limit(200);
  const rows=(data||[]).map(r=>[esc((r.units&&r.units.unit_code)||'—'),esc(r.prospect_name),esc(r.prospect_phone||'—'),esc(r.prospect_email||'—'),
    esc(custRefProjectNames(r)||'—'),
    '<span style="font-size:12.5px;color:var(--slate)">'+esc(r.notes||'—')+'</span>',
    cpaReferralCrmCell(r),
    `<select onchange="cpaReferralStatusChange(${r.id},this.value)">${Object.keys(CPA_REFERRAL_STATUSES).map(k=>`<option value="${k}" ${k===r.status?'selected':''}>${CPA_REFERRAL_STATUSES[k]}</option>`).join('')}</select>`,
    fmtDate(r.created_at)]);
  host.innerHTML=rows.length?cpaTable(['Unit','Prospect','Phone','Email','Project','Looking for','CRM','Status','Submitted'],rows):'<div class="card card-pad empty">No referrals submitted yet.</div>';
}
window.cpaReferralStatusChange=async function(id,status){
  const {error}=await sb.schema('cust').from('referrals').update({status,updated_at:new Date().toISOString(),updated_by:state.email}).eq('id',id);
  if(error){toast('Update failed: '+error.message,'err');return;}
  toast('Status updated','ok');
};
// Where the referral is in the CRM: its lead number once created, or why it is not there yet.
function cpaReferralCrmCell(r){
  const again='<button class="btn btn-sm" style="margin-top:4px" onclick="cpaReferralCrmRetry('+r.id+',this)"><i class="fa-solid fa-rotate-right"></i> Send '+(r.crm_status?'again':'')+'</button>';
  if(r.crm_status==='sent') return '<span class="tag t-green" title="Sent '+esc(fmtDate(r.crm_sent_at))+'"><i class="fa-solid fa-circle-check"></i> Lead '+esc(r.crm_lead_id||'')+'</span>';
  if(r.crm_status==='sending') return '<span class="tag t-amber"><i class="fa-solid fa-spinner fa-spin"></i> Sending…</span>';
  if(r.crm_status==='failed') return '<span class="tag t-red" title="'+esc(r.crm_error||'')+'"><i class="fa-solid fa-triangle-exclamation"></i> Failed</span>'
    +'<div style="font-size:11.5px;color:var(--err);max-width:220px;margin-top:3px">'+esc(r.crm_error||'')+'</div>'+again;
  return '<span class="tag t-gray">Not sent</span><div>'+again+'</div>';
}
window.cpaReferralCrmRetry=async function(id,btn){
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>'; }
  const {data,error}=await sb.schema('cust').rpc('referral_crm_retry',{p_id:id});
  if(error){ toast(error.message,'err'); }
  else if(!data){ toast('Not sent — sending to the CRM is switched off, or the referral has no consent','warn'); }
  else toast('Sent to the CRM — the lead number appears here within a minute','ok');
  route();
};

/* ---------- Tab 11: Maintenance (post-possession QR payments to confirm, upcoming demand preview) ---------- */
async function cpaRenderMaintenance(host,seg){
  if(seg&&seg[1]==='upcoming'){ await cpaRenderMaintenanceUpcoming(host); return; }
  const {data}=await sb.schema('cust').from('maintenance_payments').select('*, units(unit_code)').order('submitted_at',{ascending:false}).limit(200);
  const tagFor={submitted:'<span class="tag t-amber">Awaiting confirmation</span>',confirmed:'<span class="tag t-green">Confirmed</span>',rejected:'<span class="tag t-gray">Rejected</span>'};
  const rows=(data||[]).map(p=>[esc((p.units&&p.units.unit_code)||'—'),custInr(p.amount),esc(p.payment_reference||'—'),
    p.receipt_storage_path?`<button class="btn btn-sm" onclick="s3OpenSigned('${p.receipt_storage_path.replace(/'/g,"\\'")}','receipt')"><i class="fa-solid fa-receipt"></i> View</button>`:'—',
    fmtDate(p.submitted_at),tagFor[p.status]||esc(p.status),
    p.status==='submitted'?`<button class="btn btn-sm btn-primary" onclick="cpaConfirmMaintenancePayment(${p.id})">Confirm</button> <button class="btn btn-sm btn-danger" onclick="cpaRejectMaintenancePayment(${p.id})">Reject</button>`:'—']);
  host.innerHTML=`<div class="tabs" style="margin-bottom:14px"><div class="tab active">Payments</div><div class="tab" onclick="navTo('custportal_admin/10/upcoming')">Upcoming Demand</div></div>`+
    `<p style="font-size:12.5px;color:var(--slate);margin:0 0 12px">Maintenance bills/receipts import under Farvision Import (types "Maintenance Bills" / "Maintenance Receipts"). This tab is for the customer-submitted QR payment proofs — confirming here does not itself create a receipt row; record the actual receipt via the next Farvision import once the money is verified.</p>`+
    (rows.length?cpaTable(['Unit','Amount','Reference','Receipt','Submitted','Status','Actions'],rows):'<div class="card card-pad empty">No payments submitted yet.</div>');
}
window.cpaConfirmMaintenancePayment=async function(id){
  const {error}=await sb.schema('cust').from('maintenance_payments').update({status:'confirmed',confirmed_at:new Date().toISOString(),confirmed_by:state.email}).eq('id',id);
  if(error){toast('Failed: '+error.message,'err');return;}
  toast('Payment confirmed','ok');route();
};
window.cpaRejectMaintenancePayment=async function(id){
  if(!await confirmDialog('Reject this payment submission? The customer will need to submit again.',{okLabel:'Reject'}))return;
  const {error}=await sb.schema('cust').from('maintenance_payments').update({status:'rejected',confirmed_at:new Date().toISOString(),confirmed_by:state.email}).eq('id',id);
  if(error){toast('Failed: '+error.message,'err');return;}
  toast('Payment rejected','ok');route();
};
async function cpaRenderMaintenanceUpcoming(host){
  const {data:upcoming}=await sb.schema('cust').from('maintenance_upcoming').select('*, units(unit_code)').order('expected_date',{ascending:true});
  const rows=(upcoming||[]).map(u=>[esc((u.units&&u.units.unit_code)||'—'),custInr(u.amount),fmtDate(u.expected_date),esc(u.note||'—'),
    `<button class="btn btn-sm" onclick="cpaMaintenanceUpcomingModal(${u.unit_id})"><i class="fa-solid fa-pen"></i> Edit</button>`]);
  host.innerHTML=`<div class="tabs" style="margin-bottom:14px"><div class="tab" onclick="navTo('custportal_admin/10')">Payments</div><div class="tab active">Upcoming Demand</div></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div class="sec-title" style="margin:0">Upcoming maintenance demand — shown to customers as a preview</div><button class="btn btn-primary" onclick="cpaMaintenanceUpcomingModal()"><i class="fa-solid fa-plus"></i> Set preview</button></div>`+
    (rows.length?cpaTable(['Unit','Amount','Expected date','Note',''],rows):'<div class="card card-pad empty">No previews set yet.</div>');
}
window.cpaMaintenanceUpcomingModal=async function(unitId){
  const units=await cpaUnits();
  let row=null;
  if(unitId){const {data}=await sb.schema('cust').from('maintenance_upcoming').select('*').eq('unit_id',unitId).maybeSingle();row=data;}
  const unitOpts=units.map(u=>`<option value="${u.id}" ${unitId===u.id?'selected':''}>${esc(u.unit_code)} · ${esc((u.projects&&u.projects.name)||'')}</option>`).join('');
  openModal(`<div class="modal-head"><h3>Upcoming maintenance demand</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm"><label>Unit</label><select id="cpaMuUnit" ${unitId?'disabled':''}>${unitOpts}</select>
    <label>Amount (₹)</label><input id="cpaMuAmount" type="number" value="${row&&row.amount!=null?row.amount:''}">
    <label>Expected date</label><input type="date" id="cpaMuDate" value="${row&&row.expected_date?row.expected_date:''}">
    <label>Note (optional)</label><input id="cpaMuNote" value="${row?esc(row.note||''):''}"></div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="cpaMaintenanceUpcomingSave(${unitId||'null'})">Save</button></div>`);
};
window.cpaMaintenanceUpcomingSave=async function(unitId){
  const uid=unitId||Number($('cpaMuUnit').value);
  const amount=$('cpaMuAmount').value?Number($('cpaMuAmount').value):null;
  const expected_date=$('cpaMuDate').value||null;
  const note=$('cpaMuNote').value.trim()||null;
  const {error}=await sb.schema('cust').from('maintenance_upcoming').upsert({unit_id:uid,amount,expected_date,note,updated_at:new Date().toISOString(),updated_by:state.email},{onConflict:'unit_id'});
  if(error){toast('Save failed: '+error.message,'err');return;}
  closeModal();toast('Preview saved','ok');route();
};

/* ---------- Tab 12: Modification Requests (routed to the Project Manager assigned to that project) ---------- */
async function cpaRenderModificationRequests(host){
  const [projects,pms,staff,{data:reqs}]=await Promise.all([
    cpaProjects(),cpaProjectManagers(true),cpaStaffOptions(),
    sb.schema('cust').from('modification_requests').select('*, units(unit_code,project_id,customers(full_name))').order('created_at',{ascending:false}).limit(200)
  ]);
  const staffNameByEmail={};staff.forEach(s=>{staffNameByEmail[(s.email||'').toLowerCase()]=s.full_name;});
  const projOpts=projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const staffOpts=staff.map(s=>`<option value="${esc(s.email)}">${esc(s.full_name||s.email)}</option>`).join('');
  const pmRows=pms.map(pm=>[esc((pm.projects&&pm.projects.name)||'—'),esc(staffNameByEmail[(pm.staff_email||'').toLowerCase()]||pm.staff_email||'—'),
    `<button class="btn btn-sm btn-danger" onclick="cpaRemoveProjectManager(${pm.id})"><i class="fa-solid fa-xmark"></i> Remove</button>`]);
  const tagFor={submitted:'<span class="tag t-amber">Awaiting PM response</span>',pm_responded:'<span class="tag t-blue">Awaiting customer decision</span>',accepted:'<span class="tag t-blue">Accepted — awaiting acknowledgement</span>',rejected:'<span class="tag t-gray">Rejected by customer</span>',acknowledged:'<span class="tag t-green">Acknowledged</span>'};
  const reqRows=(reqs||[]).map(r=>[esc((r.units&&r.units.unit_code)||'—'),esc((r.units&&r.units.customers&&r.units.customers.full_name)||'—'),esc(r.title),tagFor[r.status]||esc(r.status),
    r.estimate_amount!=null?custInr(r.estimate_amount):'—',fmtDate(r.created_at),
    `<button class="btn btn-sm" onclick="cpaModReqDetail(${r.id})"><i class="fa-solid fa-eye"></i> Open</button>`]);
  host.innerHTML=`<div class="sec-title" style="margin:0 0 10px">Project Managers</div>
    <div class="card card-pad frm" style="margin-bottom:16px"><div class="two"><div><label>Project</label><select id="cpaPmProject">${projOpts}</select></div><div><label>Staff</label><select id="cpaPmEmail">${staffOpts}</select></div></div>
    <div style="margin-top:10px"><button class="btn btn-primary" onclick="cpaAssignProjectManager()"><i class="fa-solid fa-plus"></i> Assign</button></div></div>
    ${pmRows.length?cpaTable(['Project','Staff name',''],pmRows):'<div class="card card-pad empty" style="margin-bottom:16px">No project managers assigned yet.</div>'}
    <div class="sec-title" style="margin:22px 0 10px">Requests</div>
    ${reqRows.length?cpaTable(['Unit','Customer','Title','Status','Estimate','Submitted',''],reqRows):'<div class="card card-pad empty">No modification requests yet.</div>'}`;
}
window.cpaAssignProjectManager=async function(){
  const project_id=Number($('cpaPmProject').value),staff_email=$('cpaPmEmail').value.trim();
  if(!project_id||!staff_email){toast('Choose a project and a staff member','err');return;}
  const {error}=await sb.schema('cust').from('project_managers').insert({project_id,staff_email,assigned_by:state.email});
  if(error){toast('Failed: '+error.message,'err');return;}
  toast('Project manager assigned','ok');route();
};
window.cpaRemoveProjectManager=async function(id){
  if(!await confirmDialog('Remove this project manager assignment?',{okLabel:'Remove'}))return;
  const {error}=await sb.schema('cust').from('project_managers').update({deleted_at:new Date().toISOString(),deleted_by:state.email}).eq('id',id);
  if(error){toast('Failed: '+error.message,'err');return;}
  toast('Removed','ok');route();
};
window.cpaModReqDetail=async function(id){
  const {data:r}=await sb.schema('cust').from('modification_requests').select('*, units(unit_code,customers(full_name))').eq('id',id).maybeSingle();
  if(!r){toast('Not found','err');return;}
  const canRespond=r.status==='submitted';
  const canAcknowledge=r.status==='accepted';
  openModal(`<div class="modal-head"><h3>${esc(r.title)}</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm">
    <p style="font-size:12.5px;color:var(--slate);margin:0 0 4px">${esc((r.units&&r.units.customers&&r.units.customers.full_name)||'—')} · Unit ${esc((r.units&&r.units.unit_code)||'—')} · submitted ${fmtDate(r.created_at)}</p>
    <p style="font-size:13.5px">${esc(r.description||'—')}</p>
    ${r.attachment_storage_path?`<button class="btn btn-sm" style="margin-bottom:10px" onclick="s3OpenSigned('${r.attachment_storage_path.replace(/'/g,"\\'")}')"><i class="fa-solid fa-paperclip"></i> View attachment</button>`:''}
    ${r.pm_response_text?`<div class="card card-pad" style="margin:10px 0"><b>Response:</b> ${esc(r.pm_response_text)}${r.estimate_amount!=null?`<div style="margin-top:6px"><b>Estimate:</b> ${custInr(r.estimate_amount)}</div>`:''}</div>`:''}
    ${r.decision?`<p style="font-size:13px">Customer <b>${esc(r.decision)}</b> this${r.decided_at?' on '+fmtDate(r.decided_at):''}.</p>`:''}
    ${r.acknowledged_at?`<p style="font-size:13px;color:#16a34a">Acknowledged ${fmtDate(r.acknowledged_at)} by ${esc(r.acknowledged_by||'—')}</p>`:''}
    ${canRespond?`<label>Your response — what can and cannot be done</label><textarea id="cpaMrResponse"></textarea><label>Estimate (₹, optional)</label><input id="cpaMrEstimate" type="number">`:''}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button>
    ${canRespond?`<button class="btn btn-primary" onclick="cpaModReqRespond(${r.id})">Send response</button>`:''}
    ${canAcknowledge?`<button class="btn btn-primary" onclick="cpaModReqAcknowledge(${r.id})">Acknowledge acceptance</button>`:''}
    </div>`,'lg');
};
window.cpaModReqRespond=async function(id){
  const pm_response_text=$('cpaMrResponse').value.trim();
  const estimate_amount=$('cpaMrEstimate').value?Number($('cpaMrEstimate').value):null;
  if(!pm_response_text){toast('Enter your response','err');return;}
  const {data,error}=await sb.schema('cust').from('modification_requests').update({pm_response_text,estimate_amount,status:'pm_responded',responded_at:new Date().toISOString(),responded_by:state.email}).eq('id',id).select('id');
  if(error){toast('Failed: '+error.message,'err');return;}
  if(!data||!data.length){toast('You are not the assigned Project Manager for this unit’s project','err');return;}
  closeModal();toast('Response sent to the customer','ok');route();
};
window.cpaModReqAcknowledge=async function(id){
  const {data,error}=await sb.schema('cust').from('modification_requests').update({status:'acknowledged',acknowledged_at:new Date().toISOString(),acknowledged_by:state.email}).eq('id',id).select('id');
  if(error){toast('Failed: '+error.message,'err');return;}
  if(!data||!data.length){toast('You are not the assigned Project Manager for this unit’s project','err');return;}
  closeModal();toast('Acknowledged','ok');route();
};

