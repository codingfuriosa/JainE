/* ============================ PURCHASE & STORES — SETUP (Stage 1) ============================
   Item groups (nestable) → items (mandatory HSN, receipt UOM + optional issue UOM), UOMs, warehouses per
   project, legal entities and which entity each project belongs to.
   Spec: docs/purchase-stores-spec.md §1. Tables: supabase/migrations/20261004100000_purchase_setup.sql.

   Loaded on demand by nexus-core.js (PAGE_EXTRA_SCRIPT.inventory). Everything is assigned onto window and
   the guard below skips a second run. Route: inventory/0/<section>. */
(function(){
if(window.__PUS_LOADED) return;
window.__PUS_LOADED=true;

const PU=()=>sb.schema('purchase');
const SETUP_SECTIONS=[['items','Items'],['groups','Item groups'],['uoms','UOM'],['warehouses','Warehouses'],['entities','Legal entities'],['indent_types','Indent types'],['po_types','PO types'],['expense_heads','Expense heads']];
const ADMIN_SECTIONS=[['approvals','Approvers'],['roles','Roles'],['rules','Rules'],['admins','Administrators']];
const S={sec:'items',mode:'setup',perms:[],permCat:[],roles:[],rolePerms:[],roleMembers:[],settings:{},admins:[],isAdmin:false,groups:[],items:[],uoms:[],warehouses:[],entities:[],projEntity:[],projects:[],chains:[],users:[],q:'',groupId:'',whProject:'',bu:''};
const can=p=>Array.isArray(S.perms)&&S.perms.includes(p);

const num=v=>{const n=Number(v);return isFinite(n)?n:0;};
const val=id=>{const e=$(id);if(!e)return '';const s=String(e.value);
  /* Only a grouped AMOUNT field is stripped. val() reads every kind of field here, and a vendor
     called "Bengal Constructions, Pvt Ltd" must keep its comma. */
  return (e.dataset&&e.dataset.money==='1'?moneyStrip(s):s).trim();};
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
  m=m.replace(/Setup > Approvals/g,'Admin > Approvers');
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
  .pus-prow{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line-2,#eef0f3)}
  .pus-prow:last-child{border-bottom:none}
  .pus-prow:hover{background:#fafbfc}
  .pus-prow .pp-t{flex:1;min-width:0}
  .pus-prow .pp-n{font-weight:600;font-size:13.5px}
  .pus-prow .pp-e{font-size:12px;color:var(--slate)}
  .pus-prow .pp-d{font-size:12.5px;color:var(--slate);white-space:nowrap}
  .pus-lv{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:4px 0}
  .pus-lvl{border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:10px;background:#fff}
  /* Active / Inactive switch (a real checkbox underneath, so it reads as checked/unchecked everywhere) */
  .frm label.pus-switch,label.pus-switch{display:inline-flex;align-items:center;gap:10px;margin:14px 0 0;cursor:pointer;font-size:13.5px;font-weight:600;color:var(--slate);user-select:none;position:relative}
  label.pus-switch input[type=checkbox]{position:absolute;opacity:0;width:0;height:0;margin:0;padding:0;border:0}
  .pus-switch .trk{position:relative;flex:none;width:40px;height:22px;border-radius:999px;background:#cbd5e1;transition:background .15s}
  .pus-switch .trk::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.35);transition:transform .15s}
  .pus-switch input:checked + .trk{background:#0f766e}
  .pus-switch input:checked + .trk::after{transform:translateX(18px)}
  .pus-switch input:focus-visible + .trk{outline:2px solid #0f766e;outline-offset:2px}
  .pus-switch .on{display:none;color:#0f766e}
  .pus-switch input:checked ~ .on{display:inline}
  .pus-switch input:checked ~ .off{display:none}
  `;
  document.head.appendChild(st);
}

async function load(){
  const [g,i,u,w,e,pe,p,ch,us,ad,st,mp,pc,ro,rp,rm]=await Promise.all([
    PU().from('item_groups').select('*').is('deleted_at',null).order('sort_order').order('name'),
    PU().from('items').select('*').is('deleted_at',null).order('code'),
    PU().from('uoms').select('*').is('deleted_at',null).order('code'),
    PU().from('warehouses').select('*').is('deleted_at',null).order('code'),
    PU().from('legal_entities').select('*').is('deleted_at',null).order('name'),
    PU().from('project_entity').select('*'),
    sb.schema('cust').from('projects').select('id,name').order('name'),
    PU().from('approval_chains').select('*').order('level'),
    sb.schema('adm').from('users').select('email,full_name,active').order('full_name'),
    PU().from('module_admins').select('*').order('created_at'),
    PU().from('settings').select('*'),
    PU().rpc('my_permissions'),
    PU().from('permissions').select('*').order('sort'),
    PU().from('roles').select('*').order('id'),
    PU().from('role_permissions').select('*'),
    PU().from('role_members').select('*').order('created_at')
  ]);
  const bad=[g,i,u,w,e,pe,p,ch,us,ad,st,mp,pc,ro,rp,rm].find(r=>r.error);
  if(bad) throw bad.error;
  S.perms=mp.data||[]; S.permCat=pc.data||[]; S.roles=ro.data||[]; S.rolePerms=rp.data||[]; S.roleMembers=rm.data||[];
  S.settings={}; (st.data||[]).forEach(x=>S.settings[x.key]=x.value);
  S.admins=ad.data||[]; S.isAdmin=S.admins.some(a=>String(a.email).toLowerCase()===String(state.email||'').toLowerCase());
  S.groups=g.data||[]; S.items=i.data||[]; S.uoms=u.data||[]; S.warehouses=w.data||[];
  S.entities=e.data||[]; S.projEntity=pe.data||[]; S.projects=p.data||[]; S.chains=ch.data||[];
  S.users=(us.data||[]).filter(x=>x.active!==false);
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

const actBtns=(edit,del,perm)=>!(perm==='admin'?S.isAdmin:can(perm||'item.manage'))?'<td></td>':'<td class="pus-act"><button class="btn btn-sm btn-ghost" title="Edit" onclick="'+edit+'"><i class="fa-solid fa-pen"></i></button> <button class="btn btn-sm btn-ghost" title="Delete" onclick="'+del+'"><i class="fa-solid fa-trash"></i></button></td>';
function listCard(title,hint,addLabel,addFn,heads,rows,top){
  return '<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">'+esc(title)+'</div><div class="pus-hint" style="margin:0">'+hint+'</div></div>'
    +(addFn?'<button class="btn btn-primary" onclick="'+addFn+'"><i class="fa-solid fa-plus"></i> '+esc(addLabel)+'</button>':'')+'</div>'
    +(top||'')
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+heads.map(h=>'<th'+(h[1]?' class="pus-num"':'')+'>'+esc(h[0])+'</th>').join('')+'<th></th></tr></thead><tbody>'
    +(rows||'<tr><td colspan="'+(heads.length+1)+'"><div class="empty" style="padding:24px"><div>Nothing added yet</div></div></td></tr>')+'</tbody></table></div></div>';
}
const activeSwitch=(id,on)=>'<label class="pus-switch"><input type="checkbox" id="'+id+'"'+(on?' checked':'')+'><span class="trk"></span><span class="on">Active</span><span class="off">Inactive</span></label>';
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
// mode 'setup' = the Setup tab (items, groups, UOM - open to all staff); 'admin' = the Admin tab
// (approvers, warehouses, legal entities, administrators - module administrators only).
window.pusRender=async function(host,seg,mode){
  css();
  seg=seg||[];
  S.mode=mode==='admin'?'admin':'setup';
  const SECS=S.mode==='admin'?ADMIN_SECTIONS:SETUP_SECTIONS;
  const mine=++RENDER_SEQ, stale=()=>mine!==RENDER_SEQ||!host.isConnected;
  S.sec=SECS.some(s=>s[0]===seg[0])?seg[0]:SECS[0][0];
  loader(host);
  try{ await load(); }
  catch(e){ if(!stale()) host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load Purchase setup: '+esc(e.message||e)+'</div></div>'; return; }
  try{ await getPeople(); }catch(e){ /* names fall back to the registered-user list */ }
  if(stale()) return;
  if(S.mode==='admin'&&!S.isAdmin){ host.innerHTML='<div class="empty"><i class="fa-solid fa-lock"></i><div>This page is for Purchase administrators only.</div></div>'; return; }
  host.innerHTML='<div class="pus-subs">'+SECS.map(s=>'<span class="chip'+(s[0]===S.sec?' active':'')+'" onclick="pusGo(\''+s[0]+'\')">'+esc(s[1])+'</span>').join('')+'</div><div id="pusSec"></div>';
  const sec=$('pusSec');
  ({items:renderItems,groups:renderGroups,uoms:renderUoms,warehouses:renderWarehouses,entities:renderEntities,approvals:renderApprovals,roles:renderRoles,rules:renderRules,admins:renderAdmins,indent_types:renderIndentTypes,po_types:renderPoTypes,expense_heads:renderExpenseHeads}[S.sec])(sec);
};
window.pusGo=function(sec){ navTo('inventory/'+(S.mode==='admin'?8:0)+'/'+sec); };

// Is the signed-in person a Purchase administrator? Cached for the session (reset when the list changes).
// Only decides whether the Admin tab is shown - the database refuses admin writes to anyone else regardless.
let ADMIN_CACHE=null;
window.pusIsAdmin=async function(){
  const email=String(state.email||'').toLowerCase();
  if(ADMIN_CACHE&&ADMIN_CACHE.email===email) return ADMIN_CACHE.v;
  const {data,error}=await PU().from('module_admins').select('email');
  if(error) return false;
  const v=(data||[]).some(a=>String(a.email).toLowerCase()===email);
  ADMIN_CACHE={email,v}; return v;
};

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
  host.innerHTML=listCard('Items','Every item carries an HSN code. Items with two UOMs are received in one and issued in the other; stock is held in the issue UOM. '+list.length+' of '+S.items.length+' shown.','Add item',can('item.manage')?'pusItemModal()':'',
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
    +activeSwitch('pusIActive',!i||i.active),
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
  host.innerHTML=listCard('Item groups','Groups can sit inside other groups. The code is the prefix of automatic item codes (CEM-0001).','Add group',can('item.manage')?'pusGroupModal()':'',[['Group'],['Code'],['Items',1]],rows);
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
  host.innerHTML=listCard('Units of measure','Used by items as the receipt UOM and, for dual-UOM items, the issue UOM.','Add UOM',can('item.manage')?'pusUomModal()':'',[['Code'],['Name'],['Items',1]],rows);
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
  const rows=list.map(w=>'<tr><td><span class="pus-code">'+esc(w.code)+'</span></td><td><b>'+esc(w.name)+'</b>'+(w.active?'':' <span class="tag t-gray">Inactive</span>')+'</td><td>'+esc(w.wh_type||'')+'</td><td>'+esc(projName(w.project_id))+'</td>'+actBtns('pusWhModal('+w.id+')','pusWhDelete('+w.id+')','admin')+'</tr>').join('');
  const top='<div class="pus-top"><select id="pusWP" onchange="pusWhFilter()"><option value="">All projects</option>'+S.projects.map(p=>'<option value="'+p.id+'"'+(String(p.id)===S.whProject?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></div>';
  host.innerHTML=listCard('Warehouses','Any number of warehouses (stores) under a project.','Add warehouse',S.isAdmin?'pusWhModal()':'',[['Code'],['Description'],['Type'],['Project']],rows,top);
}
// Types already used, plus the usual ones - offered as suggestions; any text is accepted.
const WH_TYPES=['Main store','Site store','Sub store','Godown','Yard'];
const whTypeOptions=()=>[...new Set(WH_TYPES.concat(S.warehouses.map(w=>w.wh_type).filter(Boolean)))].map(t=>'<option value="'+esc(t)+'"></option>').join('');
window.pusWhFilter=function(){ S.whProject=val('pusWP'); renderWarehouses($('pusSec')); };
window.pusWhModal=function(id){
  const w=id?S.warehouses.find(x=>x.id===id):null;
  const pid=w?w.project_id:(parseInt(S.whProject,10)||null);
  modal(w?'Edit warehouse':'Add warehouse',
    '<label>Project</label><select id="pusWProj"'+(w?' disabled':'')+'><option value="">Choose…</option>'+S.projects.map(p=>'<option value="'+p.id+'"'+(p.id===pid?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select>'
    +'<div class="two"><div><label>Code</label><input id="pusWCode" maxlength="10" value="'+esc(w?w.code:'')+'" placeholder="MAIN"></div><div><label>Description</label><input id="pusWName" value="'+esc(w?w.name:'')+'" placeholder="Main store"></div></div>'
    +'<label>Type <span style="color:var(--slate);font-weight:400">(optional)</span></label><input id="pusWType" list="pusWTypes" autocomplete="off" maxlength="40" value="'+esc(w&&w.wh_type||'')+'" placeholder="Choose or type, e.g. Site store"><datalist id="pusWTypes">'+whTypeOptions()+'</datalist>'
    +activeSwitch('pusWActive',!w||w.active),
    'pusWhSave('+(w?w.id:'null')+')');
};
window.pusWhSave=async function(id){
  const project_id=parseInt(val('pusWProj'),10), code=val('pusWCode').toUpperCase(), name=val('pusWName');
  if(!id&&!project_id){ toast('Choose a project','err'); return; }
  if(!code||!name){ toast('Enter a code and a description','err'); return; }
  const row={code,name,wh_type:val('pusWType')||null,active:$('pusWActive').checked};
  if(!id) row.project_id=project_id;
  await save('warehouses',id,row,'Warehouse saved');
};
window.pusWhDelete=function(id){ const w=S.warehouses.find(x=>x.id===id); remove('warehouses',id,'warehouse '+w.name); };

/* ---------------- Legal entities ---------------- */
function renderEntities(host){
  const projCount=id=>S.projEntity.filter(p=>p.legal_entity_id===id).length;
  const rows=S.entities.map(e=>'<tr><td><b>'+esc(e.name)+'</b></td><td>'+esc(e.gstin||'')+'</td><td>'+esc(e.pan||'')+'</td><td class="pus-num">'+projCount(e.id)+'</td>'+actBtns('pusEntModal('+e.id+')','pusEntDelete('+e.id+')','admin')+'</tr>').join('');
  const peBy={}; S.projEntity.forEach(p=>peBy[p.project_id]=p.legal_entity_id);
  const map='<div class="sec-title" style="margin-top:26px">Which entity owns each project</div><div class="pus-hint">Material moved between two projects of the same entity is a pure transfer; between different entities it goes through a linked stock adjustment at each end.</div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Project</th><th>Legal entity</th></tr></thead><tbody>'
    +S.projects.map(p=>'<tr><td>'+esc(p.name)+'</td><td><select onchange="pusProjEntity('+p.id+',this.value)" style="height:32px;min-width:240px"'+(S.isAdmin?'':' disabled')+'><option value="">— Not set —</option>'+S.entities.map(e=>'<option value="'+e.id+'"'+(peBy[p.id]===e.id?' selected':'')+'>'+esc(e.name)+'</option>').join('')+'</select></td></tr>').join('')
    +'</tbody></table></div></div>';
  host.innerHTML=listCard('Legal entities','The companies / firms that own projects.','Add legal entity',S.isAdmin?'pusEntModal()':'',[['Name'],['GSTIN'],['PAN'],['Projects',1]],rows)+map;
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

/* ---------------- Roles (who may do what in this module) ---------------- */
function renderRoles(host){
  const enforce=S.settings['roles.enforce']!=='false';
  const has=(rid,perm)=>S.rolePerms.some(x=>x.role_id===rid&&x.permission===perm);
  const grps=[...new Set(S.permCat.map(p=>p.grp))];
  const matrix='<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>What a person can do</th>'+S.roles.map(r=>'<th style="text-align:center;min-width:96px">'+esc(r.name)+'</th>').join('')+'</tr></thead><tbody>'
    +grps.map(g=>'<tr><td colspan="'+(S.roles.length+1)+'" style="background:#f8fafc;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--slate)">'+esc(g)+'</td></tr>'
      +S.permCat.filter(p=>p.grp===g).map(p=>'<tr><td>'+esc(p.label)+(p.stage?' <span class="tag t-gray">Applies from '+esc(p.stage)+'</span>':'')+'</td>'
        +S.roles.map(r=>'<td style="text-align:center"><input type="checkbox" style="width:auto"'+(has(r.id,p.key)?' checked':'')+' onchange="pusRolePerm('+r.id+',\''+p.key+'\',this.checked)"></td>').join('')+'</tr>').join('')).join('')
    +'</tbody></table></div></div>';
  const people=S.roles.map(r=>{
    const mem=S.roleMembers.filter(m=>m.role_id===r.id);
    return '<div class="card card-pad" style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><b>'+esc(r.name)+'</b>'+(r.built_in?'':' <span class="tag t-blue">Custom</span>')
      +'<div class="pus-hint" style="margin:2px 0 8px">'+esc(r.description||'')+'</div></div>'
      +(!r.built_in&&!mem.length?'<button class="btn btn-sm btn-ghost" title="Delete this role" onclick="pusRoleDelete('+r.id+')"><i class="fa-solid fa-trash"></i></button>':'')+'</div>'
      +msHtml('rol'+r.id)+'</div>';
  }).join('');
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">Roles</div><div class="pus-hint" style="margin:0">A role is a bundle of permissions. Everyone on staff can <b>see</b> the module; a person can only add or change things if they hold a role that allows it. Administrators can always do everything. A person may hold several roles.</div></div>'
    +'<button class="btn btn-primary" onclick="pusRoleModal()"><i class="fa-solid fa-plus"></i> Add role</button></div>'
    +'<div class="card card-pad" style="margin-bottom:16px;display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap"><div style="flex:1;min-width:260px"><div style="font-weight:600">Enforce roles</div><div class="pus-hint" style="margin:3px 0 0">On: people without a suitable role can look but not add or change. Off: every staff member can do everything, as before roles existed.</div></div>'
    +'<select onchange="pusEnforceSet(this.value)"><option value="true"'+(enforce?' selected':'')+'>On</option><option value="false"'+(enforce?'':' selected')+'>Off</option></select></div>'
    +'<div class="pus-sub" style="margin-top:0">What each role can do</div>'+matrix
    +'<div class="pus-sub">Who holds each role</div>'+people;
  rolesInitMs();
}
window.pusEnforceSet=async function(v){
  const {error}=await PU().from('settings').upsert({key:'roles.enforce',value:v,updated_at:new Date().toISOString(),updated_by:state.email},{onConflict:'key'});
  if(fail(error,'Could not save')){ renderRoles($('pusSec')); return; }
  S.settings['roles.enforce']=v; toast(v==='true'?'Roles are enforced':'Roles are not enforced — everyone can do everything','ok');
};
window.pusRolePerm=async function(rid,perm,checked){
  const q=PU().from('role_permissions');
  const {error}=checked?await q.insert({role_id:rid,permission:perm}):await q.delete().eq('role_id',rid).eq('permission',perm);
  if(fail(error,'Could not save')){ renderRoles($('pusSec')); return; }
  if(checked) S.rolePerms.push({role_id:rid,permission:perm}); else S.rolePerms=S.rolePerms.filter(x=>!(x.role_id===rid&&x.permission===perm));
  toast('Saved','ok');
};
// Role members use the shared people picker; every tick / untick is saved straight away.
function rolesInitMs(){
  const pool=msPool();
  S.roles.forEach(r=>{
    const key='rol'+r.id;
    msInit(key,S.roleMembers.filter(m=>m.role_id===r.id).map(m=>poolEmail(m.email)),pool,false,[]);
    MS[key].onChange=(email,on)=>window.pusRoleMember(r.id,email,on);
  });
}
window.pusRoleMember=async function(rid,email,on){
  email=String(email).toLowerCase();
  const q=PU().from('role_members');
  const {error}=on?await q.insert({role_id:rid,email}):await q.delete().eq('role_id',rid).eq('email',email);
  if(fail(error,'Could not save')){
    const m=MS['rol'+rid], pe=poolEmail(email);       // put the picker back as it was
    if(m){ if(on) m.sel.delete(pe); else m.sel.add(pe); msRenderChips('rol'+rid); msRenderList('rol'+rid); }
    return;
  }
  if(on) S.roleMembers.push({role_id:rid,email}); else S.roleMembers=S.roleMembers.filter(m=>!(m.role_id===rid&&m.email===email));
  toast(on?'Added':'Removed','ok');
};
window.pusRoleModal=function(){
  modal('Add role','<label>Role name</label><input id="pusRName" placeholder="e.g. Project coordinator"><label>What it is for <span style="color:var(--slate);font-weight:400">(optional)</span></label><input id="pusRDesc">','pusRoleSave()');
};
window.pusRoleSave=async function(){
  const name=val('pusRName'); if(!name){ toast('Enter a name','err'); return; }
  const {error}=await PU().from('roles').insert({name,description:val('pusRDesc')||null,built_in:false});
  if(error&&/roles_name_uq/.test(error.message||'')){ toast('A role with that name already exists','err'); return; }
  if(fail(error)) return;
  closeModal(); toast('Role added — now tick what it can do','ok'); route();
};
window.pusRoleDelete=async function(id){
  const r=S.roles.find(x=>x.id===id);
  if(!await confirmDialog('Delete the role '+r.name+'?')) return;
  const {error}=await PU().from('roles').delete().eq('id',id);
  if(fail(error,'Could not delete')) return;
  toast('Deleted','ok'); route();
};

/* ---------------- Rules (decisions administrators control) ---------------- */
// live: true  -> enforced / honoured today.   later: 'Stage N' -> stored now, used when that stage is built.
const RULES=[
  {key:'indent.allow_self_approval',group:'Indents',type:'bool',def:'false',live:true,label:'Let a person approve an indent they raised themselves',
    help:'Off (recommended): the person who raised an indent can never decide it, even if they are listed as an approver.'},
  {key:'indent.require_required_by',group:'Indents',type:'bool',def:'false',live:true,label:'Require a "required by" date on every indent',
    help:'On: an indent without that date cannot be submitted for approval.'},
  {key:'vendor.docs_before_approval',group:'Vendors',type:'choice',def:'warn',live:true,label:'PAN card and GST certificate before a vendor is approved',
    options:[['off','Do not check'],['warn','Warn, but allow approval'],['block','Block approval until uploaded']],
    help:'Only the documents the vendor needs are checked: PAN card if it has a PAN, GST certificate if it has a GSTIN.'},
  {key:'vendor.reapprove_on_change',group:'Vendors',type:'bool',def:'true',live:true,label:'Send an approved vendor back for approval when its GSTIN or PAN changes',
    help:'Guards against tax identity being altered after approval.'},
  {key:'compare.basis',group:'Purchasing',type:'choice',def:'basic',live:true,label:'Rank vendor quotes (L1, L2, L3) on',
    options:[['basic','Basic rate'],['landed','Rate including GST']],help:'The comparison always shows GST and the terms alongside. Freight is stated in words by vendors, so it is shown but cannot be added into the ranking.'},
  {key:'po.allow_self_approval',group:'Purchasing',type:'bool',def:'false',live:true,label:'Let a person approve a purchase order, non-store purchase or work order they raised themselves',
    help:'Off (recommended): the person who raised the document can never decide it, even if they are listed as an approver.'},
  {key:'grn.over_receipt_pct',group:'Stores',type:'number',def:'0',live:true,label:'Over-receipt tolerance against a PO (%)',
    help:'0 means a goods receipt can never exceed the quantity ordered.'},
  {key:'transfer.in_transit',group:'Stores',type:'bool',def:'true',live:true,label:'Transfers between sites of the same legal entity pass through an in-transit step',
    help:'On: stock leaves the sending site, then is received at the other. Off: it moves in one step.'},
  {key:'adjustment.allow_self_approval',group:'Stores',type:'bool',def:'false',live:true,label:'Let a person approve a stock adjustment they raised themselves',
    help:'Off (recommended): the person who raised an adjustment can never decide it, even if they are listed as an approver.'},
  {key:'billing.capture_tds',group:'Billing',type:'bool',def:'false',live:true,label:'Capture TDS when booking a bill',
    help:'Off: TDS is left to Accounts. On: a TDS rate can be entered on a bill and is deducted from the amount payable.'},
  {key:'billing.rate_variance',group:'Billing',type:'choice',def:'reason',live:true,label:'When the invoice rate is above the rate agreed on the PO or order',
    options:[['reason','Allow, but ask for the reason'],['block','Do not allow the bill to be booked']],help:'The rate on the purchase order is the agreed rate. A rate below it is always fine.'},
  {key:'billing.rate_tolerance_pct',group:'Billing',type:'number',def:'0',live:true,label:'Rate difference allowed before the rule above applies (%)',
    help:'0 means any rate above the agreed rate counts. For example 2 lets an invoice rate up to 2% above the PO rate through without a reason.'}
];
const rule=key=>{ const r=RULES.find(x=>x.key===key); return S.settings&&S.settings[key]!==undefined?S.settings[key]:(r?r.def:''); };
function renderRules(host){
  const groups=[...new Set(RULES.map(r=>r.group))];
  host.innerHTML='<div class="sec-title">Rules</div><div class="pus-hint">The choices that decide how the module behaves. Changes apply immediately to everyone. Rules marked with a stage are saved now and take effect when that stage is built.</div>'
    +groups.map(g=>'<div class="pus-sub">'+esc(g)+'</div><div class="card" style="padding:0">'+RULES.filter(r=>r.group===g).map(r=>{
      const v=rule(r.key);
      const ctl=r.type==='bool'?'<select onchange="pusRuleSet(\''+r.key+'\',this.value)"><option value="true"'+(v==='true'?' selected':'')+'>On</option><option value="false"'+(v!=='true'?' selected':'')+'>Off</option></select>'
        :r.type==='choice'?'<select onchange="pusRuleSet(\''+r.key+'\',this.value)">'+r.options.map(o=>'<option value="'+o[0]+'"'+(v===o[0]?' selected':'')+'>'+esc(o[1])+'</option>').join('')+'</select>'
        :'<input type="number" min="0" step="0.1" style="width:90px" value="'+esc(v)+'" onchange="pusRuleSet(\''+r.key+'\',this.value)">';
      return '<div style="display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:14px 16px;border-bottom:1px solid var(--line)"><div style="flex:1;min-width:260px"><div style="font-weight:600">'+esc(r.label)
        +(r.later?' <span class="tag t-gray">Applies from '+r.later+'</span>':'')+'</div><div class="pus-hint" style="margin:3px 0 0">'+esc(r.help)+'</div></div><div>'+ctl+'</div></div>';
    }).join('')+'</div>').join('');
}
window.pusRuleSet=async function(key,value){
  const r=RULES.find(x=>x.key===key); value=String(value).trim();
  if(r.type==='number'&&!(value!==''&&isFinite(Number(value))&&Number(value)>=0)){ toast('Enter a number, 0 or more','err'); renderRules($('pusSec')); return; }
  const {error}=await PU().from('settings').upsert({key,value,updated_at:new Date().toISOString(),updated_by:state.email},{onConflict:'key'});
  if(fail(error,'Could not save the rule')){ renderRules($('pusSec')); return; }
  S.settings[key]=value; toast('Rule saved','ok');
};

/* ---------------- Indent types (the "Document Type" of an indent) ---------------- */
let ITYPES=[];
async function renderIndentTypes(host){
  loader(host);
  const {data,error}=await PU().from('indent_types').select('*').is('deleted_at',null).order('sort_order');
  if(error){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load: '+esc(error.message)+'</div></div>'; return; }
  ITYPES=data||[];
  const rows=ITYPES.map(t=>'<tr><td><b>'+esc(t.name)+'</b></td><td>'+(t.active?'<span class="tag t-green">Active</span>':'<span class="tag t-gray">Inactive</span>')+'</td>'
    +'<td class="pus-act">'+(S.isAdmin?'<button class="btn btn-sm btn-ghost" title="Edit" onclick="pusItypeModal('+t.id+')"><i class="fa-solid fa-pen"></i></button>':'')+'</td></tr>').join('');
  host.innerHTML=listCard('Indent types','The "Document Type" chosen on every indent (for example BOQ and non-BOQ). Make a type inactive to stop it being chosen without losing it from old indents.','Add indent type',S.isAdmin?'pusItypeModal()':'',[['Type'],['Status']],rows);
}
window.pusItypeModal=function(id){
  const t=id?ITYPES.find(x=>x.id===id):null;
  modal(t?'Edit indent type':'Add indent type','<label>Name</label><input id="pusItName" value="'+esc(t?t.name:'')+'" placeholder="e.g. Indent (BOQ)">'
    +'<label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="pusItActive"'+(!t||t.active?' checked':'')+' style="width:auto"> Active</label>','pusItypeSave('+(t?t.id:'null')+')');
};
window.pusItypeSave=async function(id){
  const name=val('pusItName'); if(!name){ toast('Enter a name','err'); return; }
  const row={name,active:$('pusItActive').checked};
  const {error}=id?await PU().from('indent_types').update(row).eq('id',id):await PU().from('indent_types').insert({...row,sort_order:ITYPES.length+1});
  if(error&&/indent_types_name_uq/.test(error.message||'')){ toast('That type already exists','err'); return; }
  if(fail(error)) return;
  closeModal(); toast('Saved','ok'); route();
};

/* ---------------- PO types (the "Document Type" of a purchase order) ---------------- */
let PTYPES=[];
async function renderPoTypes(host){
  loader(host);
  const {data,error}=await PU().from('po_types').select('*').is('deleted_at',null).order('sort_order');
  if(error){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load: '+esc(error.message)+'</div></div>'; return; }
  PTYPES=data||[];
  const rows=PTYPES.map(t=>'<tr><td><b>'+esc(t.name)+'</b></td><td>'+(t.active?'<span class="tag t-green">Active</span>':'<span class="tag t-gray">Inactive</span>')+'</td>'
    +'<td class="pus-act">'+(S.isAdmin?'<button class="btn btn-sm btn-ghost" title="Edit" onclick="pusPtypeModal('+t.id+')"><i class="fa-solid fa-pen"></i></button>':'')+'</td></tr>').join('');
  host.innerHTML=listCard('PO types','The "Document Type" chosen on every purchase order (for example Purchase Order, Capital Purchase Order). Make a type inactive to stop it being chosen without losing it from old orders.','Add PO type',S.isAdmin?'pusPtypeModal()':'',[['Type'],['Status']],rows);
}
window.pusPtypeModal=function(id){
  const t=id?PTYPES.find(x=>x.id===id):null;
  modal(t?'Edit PO type':'Add PO type','<label>Name</label><input id="pusPtName" value="'+esc(t?t.name:'')+'" placeholder="e.g. Purchase Order">'
    +'<label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="pusPtActive"'+(!t||t.active?' checked':'')+' style="width:auto"> Active</label>','pusPtypeSave('+(t?t.id:'null')+')');
};
window.pusPtypeSave=async function(id){
  const name=val('pusPtName'); if(!name){ toast('Enter a name','err'); return; }
  const row={name,active:$('pusPtActive').checked};
  const {error}=id?await PU().from('po_types').update(row).eq('id',id):await PU().from('po_types').insert({...row,sort_order:PTYPES.length+1});
  if(error&&/po_types_name_uq/.test(error.message||'')){ toast('That type already exists','err'); return; }
  if(fail(error)) return;
  closeModal(); toast('Saved','ok'); route();
};

/* ---------------- Expense heads (what a non-store purchase or a service is charged to) ---------------- */
let EHEADS=[];
async function renderExpenseHeads(host){
  loader(host);
  const {data,error}=await PU().from('expense_heads').select('*').is('deleted_at',null).order('sort_order').order('name');
  if(error){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load: '+esc(error.message)+'</div></div>'; return; }
  EHEADS=data||[];
  const rows=EHEADS.map(t=>'<tr><td><b>'+esc(t.name)+'</b></td><td>'+(t.active?'<span class="tag t-green">Active</span>':'<span class="tag t-gray">Inactive</span>')+'</td>'
    +'<td class="pus-act">'+(can('item.manage')?'<button class="btn btn-sm btn-ghost" title="Edit" onclick="pusEheadModal('+t.id+')"><i class="fa-solid fa-pen"></i></button>':'')+'</td></tr>').join('');
  host.innerHTML=listCard('Expense heads','What a non-store purchase or a service bill is charged to (for example repairs, printing, professional fees). Accounts can map each head to a ledger later. Make a head inactive to stop it being chosen without losing it from old documents.','Add expense head',can('item.manage')?'pusEheadModal()':'',[['Expense head'],['Status']],rows);
}
window.pusEheadModal=function(id){
  const t=id?EHEADS.find(x=>x.id===id):null;
  modal(t?'Edit expense head':'Add expense head','<label>Name</label><input id="pusEhName" value="'+esc(t?t.name:'')+'" placeholder="e.g. Repairs &amp; maintenance">'
    +'<label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="pusEhActive"'+(!t||t.active?' checked':'')+' style="width:auto"> Active</label>','pusEheadSave('+(t?t.id:'null')+')');
};
window.pusEheadSave=async function(id){
  const name=val('pusEhName'); if(!name){ toast('Enter a name','err'); return; }
  const row={name,active:$('pusEhActive').checked};
  const {error}=id?await PU().from('expense_heads').update(row).eq('id',id):await PU().from('expense_heads').insert({...row,sort_order:EHEADS.length+1});
  if(error&&/expense_heads_name_uq/.test(error.message||'')){ toast('That expense head already exists','err'); return; }
  if(fail(error)) return;
  closeModal(); toast('Saved','ok'); route();
};

/* ---------------- People: same look as Accountability's people pickers ----------------
   The Admin panel uses nexus-core's shared people multi-select (msHtml / msInit / getMS): coloured-initial
   avatars, names grouped by department, search, and chips - so choosing people here reads like choosing
   people for a task. The pool is the people registered in JainE. */
const userName=e=>{
  const em=String(e||'').toLowerCase();
  const p=(typeof PEOPLE!=='undefined'&&PEOPLE)?PEOPLE.find(x=>String(x.email).toLowerCase()===em):null;
  if(p&&p.name) return p.name;
  const u=S.users.find(x=>x.email&&x.email.toLowerCase()===em);
  return u&&u.full_name?u.full_name:String(e||'');
};
// Make sure every registered user is in the shared PEOPLE list (so chips and names resolve), and return the pool.
function msPool(){
  const have=new Map(((typeof PEOPLE!=='undefined'&&PEOPLE)||[]).map(p=>[String(p.email).toLowerCase(),p]));
  const out=[];
  S.users.filter(u=>u.email).forEach(u=>{
    const k=u.email.toLowerCase();
    let p=have.get(k);
    if(!p){ p={email:u.email,name:u.full_name||u.email.split('@')[0],depts:[]}; if(typeof PEOPLE!=='undefined'&&PEOPLE) PEOPLE.push(p); }
    out.push(p);
  });
  return out;
}
const poolEmail=e=>{ const k=String(e||'').toLowerCase(), p=msPool().find(x=>String(x.email).toLowerCase()===k); return p?p.email:e; };
const personChip=e=>'<span class="ms-chip">'+avatar(userName(e))+' '+esc(userName(e))+'</span>';

/* ---------------- Administrators ---------------- */
function renderAdmins(host){
  const me=String(state.email||'').toLowerCase();
  const rows=S.admins.map(a=>'<div class="pus-prow">'+avatar(userName(a.email))+'<div class="pp-t"><div class="pp-n">'+esc(userName(a.email))+(String(a.email).toLowerCase()===me?' <span class="tag t-blue">You</span>':'')+'</div><div class="pp-e">'+esc(a.email)+'</div></div>'
    +'<div class="pp-d">Since '+fmtDate(a.created_at)+'</div>'
    +(S.admins.length>1?'<button class="btn btn-sm btn-ghost" title="Remove" onclick="pusAdminRemove(\''+esc(a.email)+'\')"><i class="fa-solid fa-user-minus"></i></button>':'')+'</div>').join('');
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">Administrators</div><div class="pus-hint" style="margin:0">Only these people see the Admin tab and can change approvers, roles, rules, warehouses, legal entities and this list. Everyone else on staff keeps using the rest of the module as normal.</div></div>'
    +'<button class="btn btn-primary" onclick="pusAdminModal()"><i class="fa-solid fa-plus"></i> Add administrator</button></div>'
    +'<div class="card" style="padding:4px 0">'+(rows||'<div class="empty" style="padding:24px"><div>No administrators</div></div>')+'</div>';
}
window.pusAdminModal=function(){
  const have=new Set(S.admins.map(a=>String(a.email).toLowerCase()));
  modal('Add administrators','<label>People</label>'+msHtml('admn')+'<div class="pus-hint">Pick one or more people registered in JainE.</div>','pusAdminSave()');
  msInit('admn',[],msPool().filter(p=>!have.has(String(p.email).toLowerCase())),false,[]);
};
window.pusAdminSave=async function(){
  const emails=getMS('admn').map(e=>e.toLowerCase()); if(!emails.length){ toast('Choose at least one person','err'); return; }
  const {error}=await PU().from('module_admins').insert(emails.map(email=>({email})));
  if(fail(error)) return;
  ADMIN_CACHE=null; closeModal(); toast(emails.length===1?'Administrator added':emails.length+' administrators added','ok'); route();
};
window.pusAdminRemove=async function(email){
  const me=String(state.email||'').toLowerCase();
  if(S.admins.length<2){ toast('There must always be at least one administrator','err'); return; }
  if(!await confirmDialog('Remove '+userName(email)+' as an administrator?'+(String(email).toLowerCase()===me?' You will lose access to this page.':''),{title:'Remove administrator',okLabel:'Remove'})) return;
  const {error}=await PU().from('module_admins').delete().eq('email',email);
  if(fail(error,'Could not remove')) return;
  ADMIN_CACHE=null; toast('Removed','ok'); route();
};

/* ---------------- Approvals (who approves a project's indents) ---------------- */
const chainOf=(pid,doc)=>S.chains.filter(c=>c.project_id===pid&&c.doc_type===(doc||'indent')).sort((a,b)=>a.level-b.level);
const DOC_NAMES={indent:'Indents',po:'Purchase orders',adjustment:'Stock adjustments',nonstore:'Non-store purchases',wo:'Service work orders'};
const rupee=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
function renderApprovals(host){
  const lvRows=(ch,po)=>ch.map((c,i)=>'<div class="pus-lv"><span class="pus-code">Level '+(i+1)+'</span>'+(po?'<span style="font-size:12px;color:var(--slate)">valued at '+(Number(c.min_value)>0?rupee(c.min_value)+' and above':'any value')+'</span>':'')+c.approvers.map(personChip).join('')+'</div>').join('');
  const block=(p,doc,title)=>{
    const ch=chainOf(p.id,doc), po=doc!=='indent';
    return '<div style="display:flex;gap:10px;align-items:flex-start;padding:4px 0"><div style="width:110px;flex:0 0 110px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--slate);padding-top:6px">'+title+'</div>'
      +'<div style="flex:1;min-width:0">'+(ch.length?lvRows(ch,po):'<span class="tag t-amber">No approver — '+(DOC_NAMES[doc]||'documents').toLowerCase()+' cannot be submitted</span>')+'</div>'
      +'<button class="btn btn-sm" onclick="pusChainModal('+p.id+',\''+doc+'\')"><i class="fa-solid fa-pen"></i> '+(ch.length?'Edit':'Set up')+'</button></div>';
  };
  const rows=S.projects.map(p=>'<div class="pus-prow" style="align-items:flex-start;flex-direction:column;gap:2px"><div class="pp-n" style="padding:2px 0 4px">'+esc(p.name)+'</div>'+block(p,'indent','Indents')+block(p,'po','Purchase orders')+block(p,'adjustment','Adjustments')+block(p,'nonstore','Non-store')+block(p,'wo','Work orders')+'</div>').join('');
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">Approvers</div><div class="pus-hint" style="margin:0">Each project has an ordered chain for indents and another for purchase orders. A document goes to level 1, then level 2, and so on; at each level any <b>one</b> of the people listed can approve or reject. Purchase order levels can start at a value, so bigger orders go through more people. Nobody can approve a document they raised themselves (unless you allow it under Rules).</div></div></div>'
    +'<div class="card" style="padding:4px 0">'+(rows||'<div class="empty" style="padding:24px"><div>No projects</div></div>')+'</div>';
}
let CH=null;   // the chain being edited: {pid, doc, levels:[[email,...],...], mins:[number,...]}
function chainBody(){
  const po=CH.doc!=='indent';
  return '<div class="pus-hint" style="margin-top:0">'+(po?'A document goes through every level whose starting value is at or below its total. Search by name and tick the people at each level.':'An indent for this project goes through these levels in order. Search by name and tick the people at each level.')+'</div>'
    +CH.levels.map((lv,i)=>'<div class="pus-lvl"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:10px;flex-wrap:wrap"><div><b>Level '+(i+1)+'</b> <span style="font-size:12px;color:var(--slate)">— any one of them can decide</span></div>'
      +(po?'<label style="display:flex;gap:6px;align-items:center;font-size:12.5px;margin:0">Applies from a value of ₹ <input class="ch-min" type="number" min="0" step="1000" style="width:130px" value="'+esc(CH.mins[i]||0)+'"></label>':'')
      +'<button class="btn btn-sm btn-ghost" title="Remove this level" onclick="pusChainDelLevel('+i+')"><i class="fa-solid fa-trash"></i></button></div>'+msHtml('apl'+i)+'</div>').join('')
    +'<button class="btn btn-sm" onclick="pusChainAddLevel()"><i class="fa-solid fa-plus"></i> Add a level</button>';
}
function chainInit(){ const pool=msPool(); CH.levels.forEach((lv,i)=>msInit('apl'+i,lv.map(poolEmail),pool,false,[])); }
// Read the picks (and, for purchase orders, the starting values) back from the screen before redrawing or saving.
function chainSync(){
  CH.levels=CH.levels.map((lv,i)=>MS['apl'+i]?getMS('apl'+i).map(e=>e.toLowerCase()):lv);
  const ins=[...document.querySelectorAll('.ch-min')]; if(ins.length) CH.mins=CH.levels.map((_,i)=>ins[i]?(parseFloat(ins[i].value)||0):(CH.mins[i]||0));
}
window.pusChainModal=function(pid,doc){
  doc=doc||'indent';
  const p=S.projects.find(x=>x.id===pid), ch=chainOf(pid,doc);
  CH={pid,doc,levels:ch.length?ch.map(c=>c.approvers.map(e=>e.toLowerCase())):[[]],mins:ch.length?ch.map(c=>Number(c.min_value)||0):[0]};
  openModal('<div class="modal-head"><h3>'+({po:'Purchase order',adjustment:'Stock adjustment',nonstore:'Non-store purchase',wo:'Service work order'}[doc]||'Indent')+' approvers — '+esc(p.name)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm" id="pusChainBody" style="max-height:68vh;overflow:auto">'+chainBody()+'</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusChainSave()">Save</button></div>');
  chainInit();
};
const chainRedraw=()=>{ chainSync(); const b=$('pusChainBody'); if(b){ b.innerHTML=chainBody(); chainInit(); } };
window.pusChainAddLevel=function(){ chainSync(); const last=CH.mins.length?Math.max(...CH.mins):0; CH.levels.push([]); CH.mins.push(CH.doc==='po'?last:0); chainRedraw(); };
window.pusChainDelLevel=function(i){ chainSync(); CH.levels.splice(i,1); CH.mins.splice(i,1); chainRedraw(); };
window.pusChainSave=async function(){
  chainSync();
  const levels=CH.levels, po=CH.doc!=='indent';
  if(levels.some(l=>!l.length)){ toast('Every level needs at least one approver — remove the empty level or add someone','err'); return; }
  if(po&&!(Number(CH.mins[0])===0)){ toast('Level 1 must apply from ₹0, so every document has at least one approver','err'); return; }
  if(po&&CH.mins.some((m,i)=>i>0&&m<CH.mins[i-1])){ toast('Each level must start at the same value or higher than the one before it','err'); return; }
  const {error:de}=await PU().from('approval_chains').delete().eq('project_id',CH.pid).eq('doc_type',CH.doc);
  if(fail(de)) return;
  if(levels.length){
    const {error}=await PU().from('approval_chains').insert(levels.map((l,i)=>({project_id:CH.pid,doc_type:CH.doc,level:i+1,approvers:l,min_value:po?(CH.mins[i]||0):0})));
    if(fail(error)) return;
  }
  closeModal(); toast('Approvers saved','ok'); route();
};

/* ============================ VENDORS (Stage 2) ============================
   Vendor enlistment: master details, ONE vendor email (RFQ mails are sent there), the ledger name / parent / group,
   the vendor's bank account details (one account, kept in purchase.vendor_banks), the item groups a vendor supplies,
   and the approval step. No contacts list, no trade name and no MSME / Udyam number on the form.
   Spec: docs/purchase-stores-spec.md §2.
   Tables: supabase/migrations/20261004150000_purchase_vendors.sql (+ 20261004410000 / 20261004430000).
   Route: inventory/1. */
const V={rows:[],vgroups:[],docs:[],invites:[],banks:[],status:'all',q:''};
const DOC_LBL={pan:'PAN card',gst_certificate:'GST certificate',cancelled_cheque:'Cancelled cheque',msme_certificate:'MSME certificate',other:'Other'};
const VSTATUS={pending:['Pending approval','t-amber'],approved:['Approved','t-green'],rejected:['Rejected','t-red'],blocked:['Blocked','t-gray']};
const VTYPE={supplier:'Supplier',service:'Service provider',both:'Supplier & service provider'};
const vTag=s=>'<span class="tag '+VSTATUS[s][1]+'">'+VSTATUS[s][0]+'</span>';
const PAN_RE=/^[A-Z]{5}[0-9]{4}[A-Z]$/, GST_RE=/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, EMAIL_RE=/^[^@\s]+@[^@\s]+\.[^@\s]+$/, IFSC_RE=/^[A-Z]{4}0[A-Z0-9]{6}$/;
// The account shown on the form: the default one, else the oldest (a self-registered vendor may have sent several).
const bankOf=vid=>V.banks.filter(b=>b.vendor_id===vid).sort((a,b)=>(+!!b.is_default-+!!a.is_default)||(a.id-b.id))[0]||null;

function vcss(){
  if($('pusVCss')) return;
  const st=document.createElement('style'); st.id='pusVCss';
  st.textContent=`
  .pus-vrow{display:grid;grid-template-columns:1.2fr 1fr 1.3fr 1fr auto auto auto;gap:8px;align-items:center;margin-bottom:8px}
  .pus-vrow input{width:100%;min-width:0}
  .pus-vrow label.ck{display:flex;gap:4px;align-items:center;font-size:12px;margin:0;white-space:nowrap}
  .pus-vrow label.ck input{width:auto}
  .pus-checks{display:flex;gap:6px 14px;flex-wrap:wrap}
  .pus-checks label{display:flex;gap:6px;align-items:center;font-size:13px;margin:0}
  .pus-checks input{width:auto}
  .pus-sub{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--slate);margin:18px 0 8px}
  @media(max-width:700px){.pus-vrow{grid-template-columns:1fr 1fr}}
  `;
  document.head.appendChild(st);
}

async function vLoad(){
  const [v,g,ig,d,inv,st,mp,bk]=await Promise.all([
    PU().from('vendors').select('*').is('deleted_at',null).order('code'),
    PU().from('vendor_groups').select('*'),
    PU().from('item_groups').select('*').is('deleted_at',null).order('sort_order').order('name'),
    PU().from('vendor_documents').select('*').is('deleted_at',null).order('uploaded_at',{ascending:false}),
    PU().from('vendor_invites').select('id,email,contact_name,vendor_name,token,created_at,created_by,expires_at,emailed_at,used_at,vendor_id,revoked_at').order('created_at',{ascending:false}),
    PU().from('settings').select('*'),
    PU().rpc('my_permissions'),
    PU().from('vendor_banks').select('*')
  ]);
  const bad=[v,g,ig,d,inv,st,mp,bk].find(r=>r.error); if(bad) throw bad.error;
  S.perms=mp.data||[];
  S.settings={}; (st.data||[]).forEach(x=>S.settings[x.key]=x.value);
  V.rows=v.data||[]; V.vgroups=g.data||[]; S.groups=ig.data||[]; V.docs=d.data||[]; V.invites=inv.data||[]; V.banks=bk.data||[];
}

let VSEQ=0;
window.pusVendorRender=async function(host){
  css(); vcss();
  const mine=++VSEQ, stale=()=>mine!==VSEQ||!host.isConnected;
  loader(host);
  try{ await vLoad(); }
  catch(e){ if(!stale()) host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load vendors: '+esc(e.message||e)+'</div></div>'; return; }
  if(stale()) return;
  host.innerHTML='<div id="pusVHost"></div>';
  vRender();
};

function vRender(){
  const host=$('pusVHost'); if(!host) return;
  const count=s=>V.rows.filter(r=>s==='all'||r.status===s).length;
  const q=V.q.toLowerCase();
  const list=V.rows.filter(r=>(V.status==='all'||r.status===V.status)&&(!q||(r.code+' '+r.legal_name+' '+(r.trade_name||'')+' '+(r.gstin||'')+' '+(r.pan||'')+' '+(r.city||'')+' '+(r.email||'')+' '+(r.ledger_name||'')).toLowerCase().includes(q)));
  const chips=[['all','All'],['pending','Pending approval'],['approved','Approved'],['rejected','Rejected'],['blocked','Blocked']]
    .map(([k,l])=>'<span class="chip'+(V.status===k?' active':'')+'" onclick="pusVFilter(\''+k+'\')">'+l+' ('+count(k)+')</span>').join('');
  const rows=list.map(r=>{
    const gnames=V.vgroups.filter(x=>x.vendor_id===r.id).map(x=>{const g=groupById(x.group_id);return g?g.name:'';}).filter(Boolean);
    const act=[];
    if(r.status==='pending') act.push(['Approve','pusVStatus('+r.id+',\'approved\')','fa-circle-check'],['Reject','pusVStatus('+r.id+',\'rejected\')','fa-circle-xmark']);
    else if(r.status==='approved') act.push(['Block','pusVStatus('+r.id+',\'blocked\')','fa-ban']);
    else if(r.status==='rejected') act.push(['Re-open','pusVStatus('+r.id+',\'pending\')','fa-rotate-left']);
    else act.push(['Unblock','pusVStatus('+r.id+',\'approved\')','fa-lock-open']);
    return '<tr><td><span class="pus-code">'+esc(r.code)+'</span></td>'
      +'<td><b>'+esc(r.trade_name||r.legal_name)+'</b>'+(r.source==='self_registered'?' <span class="tag t-blue" title="Registered through the invitation link">Self-registered</span>':'')+(r.trade_name&&r.trade_name!==r.legal_name?'<div style="font-size:12px;color:var(--slate)">'+esc(r.legal_name)+'</div>':'')+'</td>'
      +'<td>'+esc(VTYPE[r.vendor_type])+'</td><td>'+esc(r.gstin||'—')+'</td><td>'+esc(r.city||'')+'</td>'
      +'<td>'+(r.email?esc(r.email):'<span class="tag t-amber" title="RFQ mails cannot be sent until an email is added">No email</span>')+'</td>'
      +'<td style="max-width:220px">'+(gnames.length?esc(gnames.join(', ')):'<span style="color:var(--slate)">—</span>')+'</td>'
      +'<td><button class="btn btn-sm btn-ghost" title="Documents" onclick="pusVDocs('+r.id+')"><i class="fa-solid fa-paperclip"></i> '+V.docs.filter(d=>d.vendor_id===r.id).length+'</button></td>'
      +'<td>'+vTag(r.status)+(r.status_remark&&r.status!=='approved'?'<div style="font-size:12px;color:var(--slate);max-width:180px">'+esc(r.status_remark)+'</div>':'')+'</td>'
      +'<td class="pus-act">'+(can('vendor.approve')?act.map(a=>'<button class="btn btn-sm" onclick="'+a[1]+'"><i class="fa-solid '+a[2]+'"></i> '+a[0]+'</button>').join(' '):'')
      +(can('vendor.manage')?' <button class="btn btn-sm btn-ghost" title="Edit" onclick="pusVendorModal('+r.id+')"><i class="fa-solid fa-pen"></i></button>'
      +' <button class="btn btn-sm btn-ghost" title="Delete" onclick="pusVendorDelete('+r.id+')"><i class="fa-solid fa-trash"></i></button>':'')+'</td></tr>';
  }).join('');
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">Vendors</div><div class="pus-hint" style="margin:0">Enlist a vendor, then approve it. Only approved vendors can be sent an RFQ or given a purchase order.</div></div>'
    +(can('vendor.manage')?'<button class="btn" onclick="pusInviteModal()"><i class="fa-solid fa-envelope"></i> Invite to register</button> <button class="btn btn-primary" onclick="pusVendorModal()"><i class="fa-solid fa-plus"></i> Enlist vendor</button>':'')+'</div>'
    +'<div class="pus-top"><div class="pus-subs" style="margin:0">'+chips+'</div><input class="grow" id="pusVQ" placeholder="Search by name, code, GSTIN, PAN, city, email or ledger" value="'+esc(V.q)+'" oninput="pusVSearch()"></div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Code</th><th>Vendor</th><th>Type</th><th>GSTIN</th><th>City</th><th>Email (RFQs)</th><th>Supplies</th><th>Docs</th><th>Status</th><th></th></tr></thead><tbody>'
    +(rows||'<tr><td colspan="10"><div class="empty" style="padding:24px"><div>'+(V.rows.length?'No vendors match':'No vendors enlisted yet')+'</div></div></td></tr>')+'</tbody></table></div></div>'
    +vInvitesHtml();
}
window.pusVFilter=function(s){ V.status=s; vRender(); };
window.pusVSearch=function(){ V.q=val('pusVQ'); vRender(); const e=$('pusVQ'); if(e){ e.focus(); e.setSelectionRange(e.value.length,e.value.length); } };

/* ---- add / edit ---- */
// Suggestions for the ledger fields: whatever has already been typed on other vendors, so the same wording is reused.
const ledgerLists=()=>[['pvDlGroup','ledger_group']].map(([id,k])=>'<datalist id="'+id+'">'+[...new Set(V.rows.map(x=>x[k]).filter(Boolean))].sort().map(v=>'<option value="'+esc(v)+'"></option>').join('')+'</datalist>').join('');
// Bank account details: all optional, but a bank needs its name, account number and IFSC together.
const bankSection=b=>'<div class="pus-sub">Bank account details <span style="font-weight:400;text-transform:none;letter-spacing:0">— where payments to this vendor are made</span></div>'
  +'<div class="two"><div><label>Bank name</label><input id="pvBank" value="'+esc(b&&b.bank_name||'')+'"></div><div><label>Branch</label><input id="pvBranch" value="'+esc(b&&b.branch||'')+'"></div></div>'
  +'<div class="two"><div><label>Account holder name</label><input id="pvAcName" value="'+esc(b&&b.account_name||'')+'" placeholder="As in the bank records"></div><div><label>Account number</label><input id="pvAcNo" inputmode="numeric" maxlength="20" autocomplete="off" value="'+esc(b&&b.account_no||'')+'"></div></div>'
  +'<div class="two"><div><label>IFSC</label><input id="pvIfsc" maxlength="11" autocomplete="off" style="text-transform:uppercase" value="'+esc(b&&b.ifsc||'')+'" placeholder="e.g. HDFC0001234"></div><div></div></div>';
window.pusVendorModal=function(id){
  const r=id?V.rows.find(x=>x.id===id):null;
  const gsel=new Set(r?V.vgroups.filter(x=>x.vendor_id===id).map(x=>x.group_id):[]);
  const opt=(o,v)=>Object.keys(o).map(k=>'<option value="'+k+'"'+(v===k?' selected':'')+'>'+esc(o[k])+'</option>').join('');
  openModal('<div class="modal-head"><h3>'+(r?'Edit vendor '+esc(r.code):'Enlist vendor')+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm" style="max-height:72vh;overflow:auto">'
    +'<div class="two"><div><label>Legal name</label><input id="pvLegal" value="'+esc(r&&r.legal_name||'')+'" placeholder="As on GST / PAN"></div><div><label>Vendor type</label><select id="pvType">'+opt(VTYPE,r?r.vendor_type:'supplier')+'</select></div></div>'
    +'<label>Default payment terms</label><input id="pvTerms" value="'+esc(r&&r.payment_terms||'')+'" placeholder="e.g. 30 days from invoice">'
    +'<div class="pus-sub">Tax</div>'
    +'<div class="two"><div><label>GSTIN</label><input id="pvGst" maxlength="15" style="text-transform:uppercase" value="'+esc(r&&r.gstin||'')+'"></div><div><label>PAN</label><input id="pvPan" maxlength="10" style="text-transform:uppercase" value="'+esc(r&&r.pan||'')+'"></div></div>'
    +'<div class="pus-sub">Address</div>'
    +'<label>Address</label><input id="pvAddr" value="'+esc(r&&r.address||'')+'">'
    +'<div class="two"><div><label>City</label><input id="pvCity" value="'+esc(r&&r.city||'')+'"></div><div><label>State</label><input id="pvState" value="'+esc(r&&r.state||'')+'"></div></div>'
    +'<div class="two"><div><label>PIN code</label><input id="pvPin" maxlength="6" inputmode="numeric" value="'+esc(r&&r.pincode||'')+'"></div><div></div></div>'
    +'<div class="pus-sub">Vendor email</div>'
    +'<label>Email <span style="color:var(--slate);font-weight:400">— RFQ mails are sent to this address</span></label><input id="pvEmail" type="email" autocomplete="off" value="'+esc(r&&r.email||'')+'" placeholder="orders@vendor.com">'
    +bankSection(r?bankOf(r.id):null)
    +'<div class="pus-sub">Ledger <span style="font-weight:400;text-transform:none;letter-spacing:0">— this vendor\'s account in the Accounts ledger</span></div>'
    +'<div class="two"><div><label>Ledger Name</label><input id="pvLName" value="'+esc(r&&r.ledger_name||'')+'" placeholder="Name of the ledger account"></div><div><label>Parent Description</label><input id="pvLParent" value="'+esc(r&&r.ledger_parent_description||'')+'"></div></div>'
    +'<div class="two"><div><label>Last Modified On</label><input id="pvLMod" disabled value="'+esc(r&&r.ledger_modified_at?new Date(r.ledger_modified_at).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}):'—')+'" title="Set automatically when a ledger detail is added or changed"></div><div><label>Group</label><input id="pvLGroup" list="pvDlGroup" value="'+esc(r&&r.ledger_group||'')+'"></div></div>'
    +ledgerLists()
    +'<div class="pus-sub">Item groups supplied</div>'
    +(S.groups.length?'<div class="pus-checks">'+groupTree().map(x=>'<label style="padding-left:'+(x.depth*16)+'px"><input type="checkbox" class="pv-group" value="'+x.g.id+'"'+(gsel.has(x.g.id)?' checked':'')+'> '+esc(x.g.name)+'</label>').join('')+'</div>':'<div class="pus-hint">No item groups yet — add them under Setup → Item groups.</div>')
    +(r&&r.status==='approved'&&rule('vendor.reapprove_on_change')==='true'?'<div class="pus-hint" style="margin-top:14px"><i class="fa-solid fa-circle-info"></i> Changing the GSTIN or PAN of an approved vendor sends it back for re-approval.</div>':'')
    +'</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusVendorSave('+(r?r.id:'null')+')">Save</button></div>','lg');
};

window.pusVendorSave=async function(id){
  const legal=val('pvLegal'), gst=val('pvGst').toUpperCase(), pan=val('pvPan').toUpperCase(), pin=val('pvPin'), email=val('pvEmail').toLowerCase();
  if(!legal){ toast('Enter the vendor\'s legal name','err'); return; }
  if(gst&&!GST_RE.test(gst)){ toast('That GSTIN is not valid (15 characters)','err'); return; }
  if(pan&&!PAN_RE.test(pan)){ toast('That PAN is not valid (e.g. ABCDE1234F)','err'); return; }
  if(gst&&pan&&gst.slice(2,12)!==pan){ toast('The PAN inside the GSTIN does not match the PAN entered','err'); return; }
  if(pin&&!/^\d{6}$/.test(pin)){ toast('PIN code is 6 digits','err'); return; }
  if(!email){ toast('Enter the vendor\'s email — RFQ mails are sent there','err'); return; }
  if(!EMAIL_RE.test(email)){ toast('That email address is not valid','err'); return; }
  const bank={bank_name:val('pvBank'),branch:val('pvBranch'),account_name:val('pvAcName'),account_no:val('pvAcNo').replace(/\s+/g,''),ifsc:val('pvIfsc').toUpperCase()};
  const hasBank=Object.values(bank).some(Boolean);
  if(hasBank){
    if(!bank.bank_name){ toast('Enter the bank name','err'); return; }
    if(!bank.account_no){ toast('Enter the account number','err'); return; }
    if(!/^\d{6,20}$/.test(bank.account_no)){ toast('The account number should be 6 to 20 digits','err'); return; }
    if(!bank.ifsc){ toast('Enter the IFSC code','err'); return; }
    if(!IFSC_RE.test(bank.ifsc)){ toast('That IFSC is not valid (4 letters, a 0, then 6 letters or digits - e.g. HDFC0001234)','err'); return; }
  }
  const groupIds=[...document.querySelectorAll('.pv-group:checked')].map(c=>parseInt(c.value,10));
  const row={legal_name:legal,vendor_type:val('pvType'),pan:pan||null,gstin:gst||null,address:val('pvAddr')||null,
    city:val('pvCity')||null,state:val('pvState')||null,pincode:pin||null,payment_terms:val('pvTerms')||null,email,
    ledger_name:val('pvLName')||null,ledger_parent_description:val('pvLParent')||null,ledger_group:val('pvLGroup')||null};
  let reverify=false;
  if(id){
    const old=V.rows.find(x=>x.id===id);
    if(old.status==='approved'&&rule('vendor.reapprove_on_change')==='true'&&((old.gstin||null)!==row.gstin||(old.pan||null)!==row.pan)){
      reverify=true; row.status='pending'; row.status_remark='GSTIN or PAN changed — needs re-approval';
    }
  }
  const res=id?await PU().from('vendors').update(row).eq('id',id).select('id').single():await PU().from('vendors').insert(row).select('id').single();
  if(res.error){ if(/vendors_gstin_uq/.test(res.error.message||'')) toast('Another vendor already has that GSTIN','err'); else fail(res.error); return; }
  const vid=res.data.id;
  // Bank account: update the one shown on the form, add it if there was none, remove it if every box was emptied.
  const oldBank=id?bankOf(id):null;
  if(hasBank){
    const brow={bank_name:bank.bank_name,branch:bank.branch||null,account_name:bank.account_name||null,account_no:bank.account_no,ifsc:bank.ifsc};
    const bs=oldBank?await PU().from('vendor_banks').update(brow).eq('id',oldBank.id):await PU().from('vendor_banks').insert({...brow,vendor_id:vid,is_default:true});
    if(bs.error) fail(bs.error,'Vendor saved, but the bank details did not');
  }else if(oldBank){
    const bd=await PU().from('vendor_banks').delete().eq('id',oldBank.id); if(bd.error) fail(bd.error,'Vendor saved, but the old bank details could not be removed');
  }
  if(id){ const del=await PU().from('vendor_groups').delete().eq('vendor_id',vid); if(del.error) fail(del.error,'Vendor saved, but its item groups could not be updated'); }
  if(groupIds.length){ const ins=await PU().from('vendor_groups').insert(groupIds.map(g=>({vendor_id:vid,group_id:g}))); if(ins.error) fail(ins.error,'Vendor saved, but its item groups did not'); }
  closeModal(); toast(id?(reverify?'Vendor saved — sent back for re-approval':'Vendor saved'):'Vendor enlisted — awaiting approval','ok'); route();
};

window.pusVStatus=async function(id,status){
  const r=V.rows.find(x=>x.id===id); const needNote=status==='rejected'||status==='blocked';
  const verb={approved:'Approve',rejected:'Reject',blocked:'Block',pending:'Re-open'}[status];
  const docRule=rule('vendor.docs_before_approval');
  if(status==='approved'&&r.status==='pending'&&docRule!=='off'){
    // Approval is the control point: the Admin tab's rule decides whether missing paperwork warns or blocks.
    const have=new Set(V.docs.filter(d=>d.vendor_id===id).map(d=>d.doc_type)), miss=[];
    if(r.pan&&!have.has('pan')) miss.push(DOC_LBL.pan);
    if(r.gstin&&!have.has('gst_certificate')) miss.push(DOC_LBL.gst_certificate);
    if(miss.length&&docRule==='block'){ toast('This vendor cannot be approved yet - missing: '+miss.join(', ')+'. Upload them first (Docs button).','err'); return; }
    if(miss.length&&!await confirmDialog('No '+miss.join(', ')+' on file for this vendor. Approve anyway?',{title:'Approve vendor',okLabel:'Approve anyway',danger:false})) return;
  }
  if(!needNote){ pusVStatusSave(id,status,false); return; }
  openModal('<div class="modal-head"><h3>'+verb+' '+esc(r.trade_name||r.legal_name)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><label>Reason</label><textarea id="pvNote" rows="3" placeholder="Why?"></textarea></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pusVStatusSave('+id+',\''+status+'\',true)">'+verb+'</button></div>');
};
window.pusVStatusSave=async function(id,status,needNote){
  const note=needNote?val('pvNote'):null;
  if(needNote&&!note){ toast('Give a reason','err'); return; }
  const {error}=await PU().from('vendors').update({status,status_remark:note}).eq('id',id);
  if(fail(error,'Could not update the vendor')) return;
  closeModal(); toast(status==='approved'?'Vendor approved':'Vendor updated','ok'); route();
};
window.pusVendorDelete=function(id){ const r=V.rows.find(x=>x.id===id); remove('vendors',id,'vendor '+(r.trade_name||r.legal_name)); };

/* ---- documents (PAN, GST certificate, cancelled cheque ...) ---- */
const DOC_EXT=['pdf','jpg','jpeg','png'], DOC_MAX_MB=8;
const fmtDate=d=>d?new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'—';
function docsBody(id){
  const list=V.docs.filter(d=>d.vendor_id===id);
  return (list.length?'<div class="card" style="padding:0"><table class="tbl"><thead><tr><th>Type</th><th>File</th><th>Added</th><th></th></tr></thead><tbody>'
    +list.map(d=>'<tr><td><b>'+esc(DOC_LBL[d.doc_type]||d.doc_type)+'</b></td><td>'+esc(d.file_name)+'</td><td style="white-space:nowrap">'+fmtDate(d.uploaded_at)+'<div style="font-size:12px;color:var(--slate)">'+esc((d.uploaded_by||'').replace(/^vendor: /,'by vendor: '))+'</div></td>'
      +'<td class="pus-act"><button class="btn btn-sm" onclick="pusDocOpen('+d.id+')"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open</button>'+(can('vendor.manage')?' <button class="btn btn-sm btn-ghost" title="Delete" onclick="pusDocDelete('+d.id+','+id+')"><i class="fa-solid fa-trash"></i></button>':'')+'</td></tr>').join('')
    +'</tbody></table></div>':'<div class="empty" style="padding:18px"><div>No documents yet</div></div>')
    +(!can('vendor.manage')?'':'<div class="pus-sub">Add a document</div><div class="pus-vrow" style="grid-template-columns:200px 1fr auto"><select id="pvdType">'+Object.keys(DOC_LBL).map(k=>'<option value="'+k+'">'+esc(DOC_LBL[k])+'</option>').join('')+'</select>'
    +'<input type="file" id="pvdFile" accept=".pdf,.jpg,.jpeg,.png"><button class="btn btn-primary" id="pvdGo" onclick="pusDocUpload('+id+')"><i class="fa-solid fa-upload"></i> Upload</button></div>'
    +'<div class="pus-hint">PDF, JPG or PNG, up to '+DOC_MAX_MB+' MB.</div>')+'';
}
window.pusVDocs=function(id){
  const r=V.rows.find(x=>x.id===id);
  openModal('<div class="modal-head"><h3>Documents — '+esc(r.trade_name||r.legal_name)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm" id="pvdBody" style="max-height:70vh;overflow:auto">'+docsBody(id)+'</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>','lg');
};
window.pusDocUpload=async function(vid){
  const f=$('pvdFile').files[0], type=val('pvdType');
  if(!f){ toast('Choose a file first','err'); return; }
  const ext=(f.name.split('.').pop()||'').toLowerCase();
  if(!DOC_EXT.includes(ext)){ toast('Upload a PDF, JPG or PNG','err'); return; }
  if(f.size>DOC_MAX_MB*1024*1024){ toast('That file is larger than '+DOC_MAX_MB+' MB','err'); return; }
  const btn=$('pvdGo'); btn.disabled=true;
  const up=await uploadFileToS3('purchase/vendors/'+vid+'/'+s3SafeSeg(type)+'/'+s3Stamp()+'_'+s3SafeName(f.name),f);
  if(up.error){ btn.disabled=false; toast('Upload failed: '+up.error.message,'err'); return; }
  const {data,error}=await PU().from('vendor_documents').insert({vendor_id:vid,doc_type:type,file_name:f.name,storage_path:up.data.path,uploaded_by:state.email}).select('*').single();
  if(fail(error,'File uploaded but not recorded')){ btn.disabled=false; return; }
  V.docs.unshift(data); $('pvdBody').innerHTML=docsBody(vid); vRender(); toast('Document added','ok');
};
window.pusDocOpen=function(id){ const d=V.docs.find(x=>x.id===id); if(d) s3OpenSigned(d.storage_path); };
window.pusDocDelete=async function(id,vid){
  const d=V.docs.find(x=>x.id===id);
  if(!await confirmDialog('Remove '+(DOC_LBL[d.doc_type]||'document')+' '+d.file_name+'?',{title:'Remove document',okLabel:'Remove'})) return;
  const {error}=await PU().from('vendor_documents').update(soft()).eq('id',id);
  if(fail(error,'Delete failed')) return;
  V.docs=V.docs.filter(x=>x.id!==id); $('pvdBody').innerHTML=docsBody(vid); vRender(); toast('Removed','ok');
};

/* ---- registration invitations ---- */
const inviteState=i=>i.used_at?['Registered','t-green']:i.revoked_at?['Cancelled','t-gray']:new Date(i.expires_at)<new Date()?['Expired','t-red']:i.emailed_at?['Sent','t-blue']:['Not emailed yet','t-amber'];
const inviteLink=i=>location.origin+location.pathname.replace(/[^/]*$/,'')+'vendor-register.html?t='+encodeURIComponent(i.token);
function vInvitesHtml(){
  if(!V.invites.length) return '';
  const rows=V.invites.map(i=>{
    const st=inviteState(i), open=!i.used_at&&!i.revoked_at&&new Date(i.expires_at)>=new Date(), vend=i.vendor_id?V.rows.find(v=>v.id===i.vendor_id):null;
    return '<tr><td>'+esc(i.email)+'</td><td>'+esc([i.vendor_name,i.contact_name].filter(Boolean).join(' · '))+'</td><td style="white-space:nowrap">'+fmtDate(i.created_at)+'</td><td style="white-space:nowrap">'+fmtDate(i.expires_at)+'</td>'
      +'<td><span class="tag '+st[1]+'">'+st[0]+'</span>'+(vend?' <span class="pus-code">'+esc(vend.code)+'</span>':'')+'</td>'
      +'<td class="pus-act">'+(open?'<button class="btn btn-sm" onclick="pusInviteCopy('+i.id+')"><i class="fa-solid fa-link"></i> Copy link</button> <button class="btn btn-sm" onclick="pusInviteSend('+i.id+')"><i class="fa-solid fa-paper-plane"></i> '+(i.emailed_at?'Resend':'Send')+'</button> <button class="btn btn-sm btn-ghost" title="Cancel invitation" onclick="pusInviteCancel('+i.id+')"><i class="fa-solid fa-ban"></i></button>':'')+'</td></tr>';
  }).join('');
  return '<div class="sec-title" style="margin-top:26px">Registration invitations</div><div class="pus-hint">A vendor opens the link, fills in their own details and uploads their documents. They then appear above as Pending approval.</div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Email</th><th>For</th><th>Invited</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
}
window.pusInviteModal=function(){
  modal('Invite a vendor to register',
    '<div class="pus-hint" style="margin-top:0">We email the vendor a personal link. They fill in their details and upload their documents themselves; you then review and approve.</div>'
    +'<label>Vendor\'s email</label><input id="pviEmail" type="email" placeholder="accounts@vendor.com">'
    +'<div class="two"><div><label>Contact person <span style="color:var(--slate);font-weight:400">(optional)</span></label><input id="pviContact"></div><div><label>Vendor name <span style="color:var(--slate);font-weight:400">(optional)</span></label><input id="pviVendor"></div></div>',
    'pusInviteSave()');
};
window.pusInviteSave=async function(){
  const email=val('pviEmail').toLowerCase();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ toast('Enter a valid email address','err'); return; }
  const {data,error}=await PU().from('vendor_invites').insert({email,contact_name:val('pviContact')||null,vendor_name:val('pviVendor')||null}).select('*').single();
  if(fail(error,'Could not create the invitation')) return;
  V.invites.unshift(data); closeModal(); vRender();
  await pusInviteSend(data.id);
};
window.pusInviteCopy=async function(id){
  const i=V.invites.find(x=>x.id===id), link=inviteLink(i);
  try{ await navigator.clipboard.writeText(link); toast('Link copied','ok'); }
  catch(e){ openModal('<div class="modal-head"><h3>Registration link</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><input readonly value="'+esc(link)+'" onclick="this.select()"></div><div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Close</button></div>'); }
};
window.pusInviteSend=async function(id){
  const i=V.invites.find(x=>x.id===id);
  const {data:{session}}=await sb.auth.getSession();
  try{
    const res=await fetch(SUPABASE_URL+'/functions/v1/vendor-invite-mailer',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(session&&session.access_token),'apikey':SUPABASE_KEY},body:JSON.stringify({invite_id:id})});
    const out=await res.json().catch(()=>({}));
    if(!res.ok||out.error) throw new Error(out.error||('status '+res.status));
    i.emailed_at=new Date().toISOString(); vRender(); toast('Registration link emailed to '+i.email,'ok');
  }catch(e){
    toast('The invitation is saved but the email could not be sent ('+e.message+'). Use "Copy link" and send it yourself.','warn');
  }
};
window.pusInviteCancel=async function(id){
  const i=V.invites.find(x=>x.id===id);
  if(!await confirmDialog('Cancel the invitation to '+i.email+'? The link will stop working.',{title:'Cancel invitation',okLabel:'Yes, cancel it'})) return;
  const {error}=await PU().from('vendor_invites').update({revoked_at:new Date().toISOString(),revoked_by:state.email}).eq('id',id);
  if(fail(error,'Could not cancel')) return;
  i.revoked_at=new Date().toISOString(); vRender(); toast('Invitation cancelled','ok');
};

// What purchase-indent.js (and the later Purchase stages) share with this file.
// Business-unit filter shared by the Stores and Stock & reports tabs. S.bu is a project id ('' = all business units) and is kept
// while the page stays open, so the choice follows you from one section to the next.
const buOptions=()=>'<option value="">All business units</option>'+S.projects.map(p=>'<option value="'+p.id+'"'+(String(p.id)===String(S.bu)?' selected':'')+'>'+esc(p.name)+'</option>').join('');
const inBu=pid=>!S.bu||String(pid)===String(S.bu);
window.pusBuSet=function(v){ S.bu=v||''; route(); };
window.PUS={PU,S,load,rule,can,val,num,fail,soft,css,vcss,modal,remove,groupById,uomCode,userName,chainOf,fmtDate,buOptions,inBu};
})();
