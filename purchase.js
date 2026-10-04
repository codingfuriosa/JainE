/* ============================ PURCHASE & STORES — SETUP (Stage 1) ============================
   Item groups (nestable) → items (mandatory HSN, receipt UOM + optional issue UOM), UOMs, warehouses per
   project, legal entities and which entity each project belongs to.
   Spec: docs/purchase-stores-spec.md §1. Tables: supabase/migrations/20261004100000_purchase_setup.sql.

   Loaded on demand by nexus-core.js (PAGE_EXTRA_SCRIPT.inventory). Everything is assigned onto window and
   the guard below skips a second run. Route: inventory/6/<section>. */
(function(){
if(window.__PUS_LOADED) return;
window.__PUS_LOADED=true;

const PU=()=>sb.schema('purchase');
const SECTIONS=[['items','Items'],['groups','Item groups'],['uoms','UOM'],['warehouses','Warehouses'],['entities','Legal entities']];
const S={sec:'items',groups:[],items:[],uoms:[],warehouses:[],entities:[],projEntity:[],projects:[],q:'',groupId:'',whProject:''};

const num=v=>{const n=Number(v);return isFinite(n)?n:0;};
const val=id=>{const e=$(id);return e?String(e.value).trim():'';};
const soft=()=>({deleted_at:new Date().toISOString(),deleted_by:state.email});
function fail(error,what){
  if(!error) return false;
  let m=error.message||'';
  if(/items_code_uq/.test(m)) m='an item with that code already exists';
  else if(/item_groups_code_uq/.test(m)) m='another group already uses that code';
  else if(/item_groups_name_uq/.test(m)) m='a group with that name already exists here';
  else if(/uoms_code_uq/.test(m)) m='that UOM already exists';
  else if(/warehouses_code_uq/.test(m)) m='another warehouse in this project uses that code';
  else if(/warehouses_name_uq/.test(m)) m='another warehouse in this project has that name';
  else if(/legal_entities_name_uq/.test(m)) m='that legal entity already exists';
  else if(/hsn_code_check/.test(m)) m='HSN must be 4, 6 or 8 digits';
  toast((what||'Save failed')+': '+m,'err'); return true;
}

function css(){
  if($('pusCss')) return;
  const st=document.createElement('style'); st.id='pusCss';
  st.textContent=`
  .pus-subs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 16px}
  .pus-top{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
  .pus-top select,.pus-top input{height:36px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font-size:13.5px;font-family:inherit;background:var(--bg-card,#fff);color:var(--ink)}
  .pus-top .grow{flex:1;min-width:200px}
  .pus-hint{font-size:12.5px;color:var(--slate);margin:2px 0 12px}
  .pus-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .pus-code{font-size:12px;font-weight:700;padding:2px 8px;border-radius:6px;background:#f0fdfa;color:#0f766e;white-space:nowrap}
  .pus-act{white-space:nowrap;text-align:right}
  `;
  document.head.appendChild(st);
}

async function load(){
  const [g,i,u,w,e,pe,p]=await Promise.all([
    PU().from('item_groups').select('*').is('deleted_at',null).order('sort_order').order('name'),
    PU().from('items').select('*').is('deleted_at',null).order('code'),
    PU().from('uoms').select('*').is('deleted_at',null).order('code'),
    PU().from('warehouses').select('*').is('deleted_at',null).order('code'),
    PU().from('legal_entities').select('*').is('deleted_at',null).order('name'),
    PU().from('project_entity').select('*'),
    sb.schema('cust').from('projects').select('id,name').order('name')
  ]);
  const bad=[g,i,u,w,e,pe,p].find(r=>r.error);
  if(bad) throw bad.error;
  S.groups=g.data||[]; S.items=i.data||[]; S.uoms=u.data||[]; S.warehouses=w.data||[];
  S.entities=e.data||[]; S.projEntity=pe.data||[]; S.projects=p.data||[];
}

const groupById=id=>S.groups.find(g=>g.id===id);
const uomCode=id=>{const u=S.uoms.find(x=>x.id===id);return u?u.code:'—';};
function groupPath(id){
  const out=[]; let g=groupById(id), guard=0;
  while(g&&guard++<20){ out.unshift(g.name); g=g.parent_id?groupById(g.parent_id):null; }
  return out.join(' › ');
}
// Groups in tree order with their depth, for indented lists and pickers.
function groupTree(){
  const out=[];
  (function walk(parent,depth){
    S.groups.filter(g=>(g.parent_id||null)===parent).forEach(g=>{ out.push({g,depth}); walk(g.id,depth+1); });
  })(null,0);
  return out;
}
function descendantIds(id){
  const ids=[id];
  for(let i=0;i<ids.length;i++) S.groups.forEach(g=>{ if(g.parent_id===ids[i]&&!ids.includes(g.id)) ids.push(g.id); });
  return ids;
}
const groupOpts=(sel,exclude)=>groupTree().filter(x=>!exclude||!exclude.includes(x.g.id))
  .map(x=>'<option value="'+x.g.id+'"'+(x.g.id===sel?' selected':'')+'>'+'&nbsp;&nbsp;'.repeat(x.depth)+esc(x.g.name)+'</option>').join('');
const uomOpts=(sel,blank)=>(blank?'<option value="">'+esc(blank)+'</option>':'')+S.uoms.map(u=>'<option value="'+u.id+'"'+(u.id===sel?' selected':'')+'>'+esc(u.code)+(u.name?' — '+esc(u.name):'')+'</option>').join('');

const actBtns=(edit,del)=>'<td class="pus-act"><button class="btn btn-sm btn-ghost" title="Edit" onclick="'+edit+'"><i class="fa-solid fa-pen"></i></button> <button class="btn btn-sm btn-ghost" title="Delete" onclick="'+del+'"><i class="fa-solid fa-trash"></i></button></td>';
function listCard(title,hint,addLabel,addFn,heads,rows,top){
  return '<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">'+esc(title)+'</div><div class="pus-hint" style="margin:0">'+hint+'</div></div>'
    +(addFn?'<button class="btn btn-primary" onclick="'+addFn+'"><i class="fa-solid fa-plus"></i> '+esc(addLabel)+'</button>':'')+'</div>'
    +(top||'')
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+heads.map(h=>'<th'+(h[1]?' class="pus-num"':'')+'>'+esc(h[0])+'</th>').join('')+'<th></th></tr></thead><tbody>'
    +(rows||'<tr><td colspan="'+(heads.length+1)+'"><div class="empty" style="padding:24px"><div>Nothing added yet</div></div></td></tr>')+'</tbody></table></div></div>';
}
function modal(title,body,saveFn){
  openModal('<div class="modal-head"><h3>'+esc(title)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm">'+body+'</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="'+saveFn+'">Save</button></div>');
}
async function save(table,id,row,okMsg){
  const {error}=id?await PU().from(table).update(row).eq('id',id):await PU().from(table).insert(row);
  if(fail(error)) return false;
  closeModal(); toast(okMsg,'ok'); route(); return true;
}
async function remove(table,id,label){
  if(!await confirmDialog('Delete '+label+'?')) return;
  const {error}=await PU().from(table).update(soft()).eq('id',id);
  if(fail(error,'Delete failed')) return;
  toast('Deleted','ok'); route();
}

/* ---------------- shell ---------------- */
let RENDER_SEQ=0;
window.pusRender=async function(host,seg){
  css();
  seg=seg||[];
  const mine=++RENDER_SEQ, stale=()=>mine!==RENDER_SEQ||!host.isConnected;
  S.sec=SECTIONS.some(s=>s[0]===seg[0])?seg[0]:'items';
  loader(host);
  try{ await load(); }
  catch(e){ if(!stale()) host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load Purchase setup: '+esc(e.message||e)+'</div></div>'; return; }
  if(stale()) return;
  host.innerHTML='<div class="pus-subs">'+SECTIONS.map(s=>'<span class="chip'+(s[0]===S.sec?' active':'')+'" onclick="pusGo(\''+s[0]+'\')">'+esc(s[1])+'</span>').join('')+'</div><div id="pusSec"></div>';
  const sec=$('pusSec');
  ({items:renderItems,groups:renderGroups,uoms:renderUoms,warehouses:renderWarehouses,entities:renderEntities}[S.sec])(sec);
};
window.pusGo=function(sec){ navTo('inventory/6/'+sec); };

/* ---------------- Items ---------------- */
function renderItems(host){
  const q=S.q.toLowerCase();
  const ids=S.groupId?descendantIds(parseInt(S.groupId,10)):null;
  const list=S.items.filter(i=>(!ids||ids.includes(i.group_id))&&(!q||(i.name+' '+i.code+' '+i.hsn_code+' '+(i.make||'')).toLowerCase().includes(q)));
  const rows=list.map(i=>'<tr><td><span class="pus-code">'+esc(i.code)+'</span></td><td><b>'+esc(i.name)+'</b>'+(i.active?'':' <span class="tag t-gray">Inactive</span>')+'</td>'
    +'<td>'+esc(groupPath(i.group_id))+'</td><td>'+esc(i.hsn_code)+'</td><td class="pus-num">'+num(i.gst_rate)+'%</td>'
    +'<td>'+esc(uomCode(i.receipt_uom_id))+(i.issue_uom_id?' → '+esc(uomCode(i.issue_uom_id))+' <span style="color:var(--slate)">(1 : '+num(i.conversion)+')</span>':'')+'</td>'
    +'<td>'+esc(i.make||'')+'</td>'+actBtns('pusItemModal('+i.id+')','pusItemDelete('+i.id+')')+'</tr>').join('');
  const top='<div class="pus-top"><input class="grow" id="pusQ" placeholder="Search by name, code, HSN or make" value="'+esc(S.q)+'" oninput="pusItemFilter()">'
    +'<select id="pusG" onchange="pusItemFilter()"><option value="">All groups</option>'+groupOpts(parseInt(S.groupId,10)||null)+'</select></div>';
  host.innerHTML=listCard('Items','Every item carries an HSN code. Items with two UOMs are received in one and issued in the other; stock is held in the issue UOM. '+list.length+' of '+S.items.length+' shown.','Add item','pusItemModal()',
    [['Code'],['Item'],['Group'],['HSN'],['GST',1],['UOM (receive → issue)'],['Make']],rows,top)
    ;
}
window.pusItemFilter=function(){ S.q=val('pusQ'); S.groupId=val('pusG'); const h=$('pusSec'); const f=document.activeElement&&document.activeElement.id; renderItems(h); if(f&&$(f)){ const e=$(f); e.focus(); if(e.setSelectionRange&&e.value) e.setSelectionRange(e.value.length,e.value.length); } };
window.pusItemModal=function(id){
  const i=id?S.items.find(x=>x.id===id):null;
  modal(i?'Edit item':'Add item',
    '<label>Item name</label><input id="pusIName" value="'+esc(i?i.name:'')+'" placeholder="OPC 53 Cement">'
    +'<div class="two"><div><label>Group</label><select id="pusIGroup" onchange="pusItemGroupPick()">'+(S.groups.length?'':'<option value="">Choose…</option>')+groupOpts(i?i.group_id:(parseInt(S.groupId,10)||null))+'<option value="new"'+(S.groups.length?'':' selected')+'>+ New group…</option></select></div>'
    +'<div><label>Item code <span style="color:var(--slate);font-weight:400">(blank = automatic)</span></label><input id="pusICode" value="'+esc(i?i.code:'')+'" placeholder="auto"></div></div>'
    +'<div id="pusINewGroup" class="two" style="display:'+(S.groups.length?'none':'grid')+'"><div><label>New group name</label><input id="pusINgName" placeholder="Cement"></div><div><label>Group code (2–6 letters)</label><input id="pusINgCode" maxlength="6" placeholder="CEM" style="text-transform:uppercase"></div></div>'
    +'<div class="two"><div><label>HSN code</label><input id="pusIHsn" inputmode="numeric" maxlength="8" value="'+esc(i?i.hsn_code:'')+'" placeholder="25232930"></div>'
    +'<div><label>GST %</label><input id="pusIGst" type="number" step="0.01" value="'+(i?i.gst_rate:18)+'"></div></div>'
    +'<div class="two"><div><label>Receipt UOM</label><select id="pusIRec">'+uomOpts(i?i.receipt_uom_id:null,'Choose…')+'</select></div>'
    +'<div><label>Make / brand</label><input id="pusIMake" value="'+esc(i&&i.make||'')+'"></div></div>'
    +'<div class="two"><div><label>Issue UOM <span style="color:var(--slate);font-weight:400">(only if different)</span></label><select id="pusIIss">'+uomOpts(i?i.issue_uom_id:null,'Same as receipt')+'</select></div>'
    +'<div><label>1 receipt unit = ? issue units</label><input id="pusIConv" type="number" step="0.0001" value="'+(i&&i.conversion!=null?i.conversion:'')+'" placeholder="e.g. 1000"></div></div>'
    +'<label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="pusIActive"'+(!i||i.active?' checked':'')+'> Active</label>',
    'pusItemSave('+(i?i.id:'null')+')');
};
window.pusItemGroupPick=function(){ const b=$('pusINewGroup'); if(b) b.style.display=val('pusIGroup')==='new'?'grid':'none'; };
window.pusItemSave=async function(id){
  const name=val('pusIName'), hsn=val('pusIHsn').replace(/\s/g,'');
  const rec=parseInt(val('pusIRec'),10)||null, iss=parseInt(val('pusIIss'),10)||null, conv=val('pusIConv');
  if(!name){ toast('Enter the item name','err'); return; }
  let groupId=parseInt(val('pusIGroup'),10)||null;
  const newGroup=val('pusIGroup')==='new'||(!S.groups.length&&!groupId);
  if(newGroup){
    const gn=val('pusINgName'), gc=val('pusINgCode').toUpperCase();
    if(!gn||!/^[A-Z0-9]{2,6}$/.test(gc)){ toast('Enter the new group\'s name and a 2–6 letter code','err'); return; }
  } else if(!groupId){ toast('Choose a group','err'); return; }
  if(!/^\d{4}(\d{2}(\d{2})?)?$/.test(hsn)){ toast('HSN code is mandatory — 4, 6 or 8 digits','err'); return; }
  if(!rec){ toast('Choose the receipt UOM','err'); return; }
  if(iss&&iss===rec){ toast('The issue UOM must differ from the receipt UOM — leave it as "Same as receipt"','err'); return; }
  if(iss&&!(num(conv)>0)){ toast('Enter how many issue units make one receipt unit','err'); return; }
  if(newGroup){
    const {data,error}=await PU().from('item_groups').insert({name:val('pusINgName'),code:val('pusINgCode').toUpperCase(),sort_order:S.groups.length}).select('id').single();
    if(fail(error,'Could not create the group')) return;
    groupId=data.id;
  }
  const row={name,group_id:groupId,code:val('pusICode')||null,hsn_code:hsn,gst_rate:num(val('pusIGst')),make:val('pusIMake')||null,
    receipt_uom_id:rec,issue_uom_id:iss,conversion:iss?num(conv):null,active:$('pusIActive').checked};
  if(id&&!row.code) delete row.code;
  await save('items',id,row,'Item saved');
};
window.pusItemDelete=function(id){ const i=S.items.find(x=>x.id===id); remove('items',id,'item '+i.name); };

/* ---------------- Item groups ---------------- */
function renderGroups(host){
  const rows=groupTree().map(({g,depth})=>{
    const n=S.items.filter(i=>i.group_id===g.id).length;
    return '<tr><td style="padding-left:'+(12+depth*22)+'px">'+(depth?'<i class="fa-solid fa-turn-up fa-rotate-90" style="color:var(--slate);margin-right:6px;font-size:11px"></i>':'')+'<b>'+esc(g.name)+'</b></td>'
      +'<td><span class="pus-code">'+esc(g.code)+'</span></td><td class="pus-num">'+n+'</td>'+actBtns('pusGroupModal('+g.id+')','pusGroupDelete('+g.id+')')+'</tr>';
  }).join('');
  host.innerHTML=listCard('Item groups','Groups can sit inside other groups. The code is the prefix of automatic item codes (CEM-0001).','Add group','pusGroupModal()',[['Group'],['Code'],['Items',1]],rows);
}
window.pusGroupModal=function(id){
  const g=id?groupById(id):null;
  modal(g?'Edit group':'Add group',
    '<label>Name</label><input id="pusGName" value="'+esc(g?g.name:'')+'" placeholder="Cement">'
    +'<div class="two"><div><label>Code (2–6 letters/digits)</label><input id="pusGCode" maxlength="6" value="'+esc(g?g.code:'')+'" placeholder="CEM" style="text-transform:uppercase"></div>'
    +'<div><label>Inside group</label><select id="pusGParent"><option value="">— Top level —</option>'+groupOpts(g?g.parent_id:null,g?descendantIds(g.id):null)+'</select></div></div>',
    'pusGroupSave('+(g?g.id:'null')+')');
};
window.pusGroupSave=async function(id){
  const name=val('pusGName'), code=val('pusGCode').toUpperCase();
  if(!name){ toast('Enter a name','err'); return; }
  if(!/^[A-Z0-9]{2,6}$/.test(code)){ toast('The code is 2 to 6 letters or digits, e.g. CEM','err'); return; }
  await save('item_groups',id,{name,code,parent_id:parseInt(val('pusGParent'),10)||null,...(id?{}:{sort_order:S.groups.length})},'Group saved');
};
window.pusGroupDelete=function(id){
  const g=groupById(id);
  if(S.groups.some(x=>x.parent_id===id)){ toast('Move or delete the groups inside '+g.name+' first','err'); return; }
  if(S.items.some(i=>i.group_id===id)){ toast(g.name+' still has items — move or delete them first','err'); return; }
  remove('item_groups',id,'group '+g.name);
};

/* ---------------- UOM ---------------- */
function renderUoms(host){
  const used=id=>S.items.filter(i=>i.receipt_uom_id===id||i.issue_uom_id===id).length;
  const rows=S.uoms.map(u=>'<tr><td><span class="pus-code">'+esc(u.code)+'</span></td><td>'+esc(u.name||'')+'</td><td class="pus-num">'+used(u.id)+'</td>'+actBtns('pusUomModal('+u.id+')','pusUomDelete('+u.id+')')+'</tr>').join('');
  host.innerHTML=listCard('Units of measure','Used by items as the receipt UOM and, for dual-UOM items, the issue UOM.','Add UOM','pusUomModal()',[['Code'],['Name'],['Items',1]],rows);
}
window.pusUomModal=function(id){
  const u=id?S.uoms.find(x=>x.id===id):null;
  modal(u?'Edit UOM':'Add UOM','<div class="two"><div><label>Code</label><input id="pusUCode" maxlength="10" value="'+esc(u?u.code:'')+'" placeholder="Kg"></div><div><label>Name</label><input id="pusUName" value="'+esc(u&&u.name||'')+'" placeholder="Kilogram"></div></div>','pusUomSave('+(u?u.id:'null')+')');
};
window.pusUomSave=async function(id){
  const code=val('pusUCode'); if(!code){ toast('Enter a code','err'); return; }
  await save('uoms',id,{code,name:val('pusUName')||null},'UOM saved');
};
window.pusUomDelete=function(id){
  const u=S.uoms.find(x=>x.id===id);
  if(S.items.some(i=>i.receipt_uom_id===id||i.issue_uom_id===id)){ toast(u.code+' is used by items — change them first','err'); return; }
  remove('uoms',id,'UOM '+u.code);
};

/* ---------------- Warehouses ---------------- */
const projName=id=>{const p=S.projects.find(x=>x.id===id);return p?p.name:'—';};
function renderWarehouses(host){
  const list=S.warehouses.filter(w=>!S.whProject||String(w.project_id)===S.whProject);
  const rows=list.map(w=>'<tr><td><span class="pus-code">'+esc(w.code)+'</span></td><td><b>'+esc(w.name)+'</b>'+(w.active?'':' <span class="tag t-gray">Inactive</span>')+'</td><td>'+esc(projName(w.project_id))+'</td><td>'+esc(w.in_charge||'')+'</td>'+actBtns('pusWhModal('+w.id+')','pusWhDelete('+w.id+')')+'</tr>').join('');
  const top='<div class="pus-top"><select id="pusWP" onchange="pusWhFilter()"><option value="">All projects</option>'+S.projects.map(p=>'<option value="'+p.id+'"'+(String(p.id)===S.whProject?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></div>';
  host.innerHTML=listCard('Warehouses','Any number of warehouses (stores) under a project.','Add warehouse','pusWhModal()',[['Code'],['Warehouse'],['Project'],['In-charge']],rows,top);
}
window.pusWhFilter=function(){ S.whProject=val('pusWP'); renderWarehouses($('pusSec')); };
window.pusWhModal=function(id){
  const w=id?S.warehouses.find(x=>x.id===id):null;
  const pid=w?w.project_id:(parseInt(S.whProject,10)||null);
  modal(w?'Edit warehouse':'Add warehouse',
    '<label>Project</label><select id="pusWProj"'+(w?' disabled':'')+'><option value="">Choose…</option>'+S.projects.map(p=>'<option value="'+p.id+'"'+(p.id===pid?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select>'
    +'<div class="two"><div><label>Code</label><input id="pusWCode" maxlength="10" value="'+esc(w?w.code:'')+'" placeholder="MAIN"></div><div><label>Name</label><input id="pusWName" value="'+esc(w?w.name:'')+'" placeholder="Main store"></div></div>'
    +'<label>In-charge (optional)</label><input id="pusWInch" value="'+esc(w&&w.in_charge||'')+'">'
    +'<label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="pusWActive"'+(!w||w.active?' checked':'')+'> Active</label>',
    'pusWhSave('+(w?w.id:'null')+')');
};
window.pusWhSave=async function(id){
  const project_id=parseInt(val('pusWProj'),10), code=val('pusWCode').toUpperCase(), name=val('pusWName');
  if(!id&&!project_id){ toast('Choose a project','err'); return; }
  if(!code||!name){ toast('Enter a code and a name','err'); return; }
  const row={code,name,in_charge:val('pusWInch')||null,active:$('pusWActive').checked};
  if(!id) row.project_id=project_id;
  await save('warehouses',id,row,'Warehouse saved');
};
window.pusWhDelete=function(id){ const w=S.warehouses.find(x=>x.id===id); remove('warehouses',id,'warehouse '+w.name); };

/* ---------------- Legal entities ---------------- */
function renderEntities(host){
  const projCount=id=>S.projEntity.filter(p=>p.legal_entity_id===id).length;
  const rows=S.entities.map(e=>'<tr><td><b>'+esc(e.name)+'</b></td><td>'+esc(e.gstin||'')+'</td><td>'+esc(e.pan||'')+'</td><td class="pus-num">'+projCount(e.id)+'</td>'+actBtns('pusEntModal('+e.id+')','pusEntDelete('+e.id+')')+'</tr>').join('');
  const peBy={}; S.projEntity.forEach(p=>peBy[p.project_id]=p.legal_entity_id);
  const map='<div class="sec-title" style="margin-top:26px">Which entity owns each project</div><div class="pus-hint">Material moved between two projects of the same entity is a pure transfer; between different entities it goes through a linked stock adjustment at each end.</div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Project</th><th>Legal entity</th></tr></thead><tbody>'
    +S.projects.map(p=>'<tr><td>'+esc(p.name)+'</td><td><select onchange="pusProjEntity('+p.id+',this.value)" style="height:32px;min-width:240px"><option value="">— Not set —</option>'+S.entities.map(e=>'<option value="'+e.id+'"'+(peBy[p.id]===e.id?' selected':'')+'>'+esc(e.name)+'</option>').join('')+'</select></td></tr>').join('')
    +'</tbody></table></div></div>';
  host.innerHTML=listCard('Legal entities','The companies / firms that own projects.','Add legal entity','pusEntModal()',[['Name'],['GSTIN'],['PAN'],['Projects',1]],rows)+map;
}
window.pusEntModal=function(id){
  const e=id?S.entities.find(x=>x.id===id):null;
  modal(e?'Edit legal entity':'Add legal entity','<label>Name</label><input id="pusEName" value="'+esc(e?e.name:'')+'" placeholder="Dream Gateway Hotels Ltd.">'
    +'<div class="two"><div><label>GSTIN</label><input id="pusEGst" maxlength="15" value="'+esc(e&&e.gstin||'')+'"></div><div><label>PAN</label><input id="pusEPan" maxlength="10" value="'+esc(e&&e.pan||'')+'"></div></div>','pusEntSave('+(e?e.id:'null')+')');
};
window.pusEntSave=async function(id){
  const name=val('pusEName'); if(!name){ toast('Enter a name','err'); return; }
  await save('legal_entities',id,{name,gstin:val('pusEGst').toUpperCase()||null,pan:val('pusEPan').toUpperCase()||null},'Legal entity saved');
};
window.pusEntDelete=function(id){
  const e=S.entities.find(x=>x.id===id);
  if(S.projEntity.some(p=>p.legal_entity_id===id)){ toast(e.name+' still has projects — move them to another entity first','err'); return; }
  remove('legal_entities',id,'legal entity '+e.name);
};
window.pusProjEntity=async function(projectId,entityId){
  const {error}=await PU().from('project_entity').upsert({project_id:projectId,legal_entity_id:parseInt(entityId,10)||null,updated_at:new Date().toISOString(),updated_by:state.email},{onConflict:'project_id'});
  if(fail(error)) return;
  const row=S.projEntity.find(p=>p.project_id===projectId);
  if(row) row.legal_entity_id=parseInt(entityId,10)||null; else S.projEntity.push({project_id:projectId,legal_entity_id:parseInt(entityId,10)||null});
  toast('Saved','ok');
};
})();
