/* ===== SECURITY · Credentials (admin only) ===== */
VIEWS.security=async function(v,seg){
  if(!state.super){return noAccess(v);}
  if(seg[0]==='user'){return secUserDetail(v,decodeURIComponent(seg[1]||''));}
  return secList(v);
};
let SEC_USERS=[];
function secRowsHtml(list){
  if(!list.length)return '<div class="empty">No matches</div>';
  return `<table class="tbl sec-tbl"><thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Level</th><th>Tabs</th><th></th></tr></thead><tbody>`+
    list.map(u=>{const pending=u.onboarded&&!u.super_admin&&!(Array.isArray(u.modules)&&u.modules.length);const valid=Array.isArray(u.modules)?u.modules.filter(m=>MODSET.has(m)):[];const noRestrict=u.modules===null||u.modules===undefined;const tabsCell=u.super_admin?'All':noRestrict?DEFAULT_MODULES.length+' (default)':valid.length===0?'0 — needs setup':valid.length>=MODLIST.length?'All':String(valid.length);return `<tr class="rowlink${pending?' pending-row':''}" onclick="navTo('security/user/'+encodeURIComponent('${esc(u.email)}'))"><td>${avatar(u.full_name)} <b>${esc(u.full_name)}</b>${u.super_admin?' <span class="tag t-purple">Admin</span>':''}${pending?' <span class="tag t-amber">New · needs setup</span>':''}</td><td style="color:var(--slate)">${esc(u.email)}</td><td>${(Array.isArray(u.department)&&u.department.length)?u.department.map(d=>avatar(d)).join(''):'—'}</td><td>${esc(u.lvl||'Employee')}</td><td>${tabsCell}</td><td style="text-align:right"><i class="fa-solid fa-chevron-right" style="color:#cbd5e1"></i></td></tr>`;}).join('')+`</tbody></table>`;
}
window.secFilterUsers=function(){
  const q=(($('secSearch')||{}).value||'').trim().toLowerCase();
  const list=!q?SEC_USERS:SEC_USERS.filter(u=>{
    const dept=Array.isArray(u.department)?u.department.join(' ').toLowerCase():'';
    return (u.full_name||'').toLowerCase().includes(q)||(u.email||'').toLowerCase().includes(q)||dept.includes(q);
  });
  const host=$('secRows');if(host)host.innerHTML=secRowsHtml(list);
};
async function secList(v){
  setCrumb(['Control Panel']);
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-sliders" style="color:#7c3aed"></i> Control Panel</h1><p>Approve new people and manage everyone's department, level and tab access</p></div>`
    +`<div class="search-box" style="max-width:320px"><i class="fa-solid fa-magnifying-glass"></i><input id="secSearch" placeholder="Search by name, email or department…" oninput="secFilterUsers()"></div></div>`
    +`<div class="card card-pad" id="secRows"><div class="loader"><div class="spin"></div></div></div>`;
  try{const {data,error}=await sb.schema('adm').rpc('admin_list_users');if(error)throw error;SEC_USERS=data||[];}
  catch(e){$('secRows').innerHTML='<div class="empty">Could not load users: '+esc(e.message||String(e))+'</div>';return;}
  $('secRows').innerHTML=secRowsHtml(SEC_USERS);
}
async function secUserDetail(v,email){
  setCrumb(['Control Panel',email]);
  loader(v);
  let users=[];try{const {data}=await sb.schema('adm').rpc('admin_list_users');users=data||[];}catch(e){}
  const u=(users||[]).find(x=>x.email===email);
  if(!u){v.innerHTML='<div class="card card-pad empty">User not found</div>';return;}
  const mods=Array.isArray(u.modules)?u.modules:DEFAULT_MODULES.slice();
  SEC_DEPTS=Array.isArray(u.department)?u.department.slice():[];
  v.innerHTML=`<div class="page-head"><div><h1>${avatar(u.full_name)} ${esc(u.full_name)}</h1><p>${esc(u.email)}${u.super_admin?' · <span class="tag t-purple">Administrator</span>':''}</p></div><button class="btn" onclick="navTo('security')"><i class="fa-solid fa-arrow-left"></i> Back</button></div>
  <div class="card card-pad frm">
    <div class="two"><div><label>Name</label><input value="${esc(u.full_name)}" disabled></div><div><label>Email</label><input value="${esc(u.email)}" disabled></div></div>
    <div class="two"><div><label>Department</label>${deptPickerHtml(SEC_DEPTS)}</div><div><label>Level</label><select id="secLevel" ${u.super_admin?'disabled':''}>${LEVELS.map(l=>'<option '+(l===(u.lvl||'Employee')?'selected':'')+'>'+l+'</option>').join('')}</select></div></div>
    <div style="border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-top:14px">
      <div style="padding:11px 16px;display:flex;align-items:center;justify-content:space-between;background:#fafbfd;border-bottom:1px solid var(--line)">
        <div style="font-weight:600;font-size:13.5px"><i class="fa-solid fa-table-cells-large" style="color:#7c3aed;margin-right:7px"></i>Module Access</div>
        ${u.super_admin?'<span style="font-size:12px;color:var(--slate)">Full access — Administrator</span>':'<div style="display:flex;gap:6px"><button type="button" class="btn btn-sm" onclick="secAllTabs(true)">Select all</button><button type="button" class="btn btn-sm" onclick="secAllTabs(false)">Clear all</button></div>'}
      </div>
      <div style="padding:14px 16px 16px">
        <div class="tab-grid">${NAV.flatMap(g=>{const gi=g.items.filter(m=>MODSET.has(m.id));if(!gi.length)return[];return['<div class="tab-grid-head">'+esc(g.group)+'</div>',...gi.flatMap(m=>['<label class="chk-tile"><input type="checkbox" class="secMod" value="'+m.id+'" '+((m.id==='network'||mods.includes(m.id))?'checked':'')+' '+((u.super_admin||m.id==='network')?'disabled':'')+'><i class="fa-solid '+m.icon+' tile-ic"></i>'+esc(m.label)+'</label>']
            .concat(m.id==='custportal_admin'?['<label class="chk-tile" title="Opens Customer Portal Admin with only the Photos &amp; Videos tab"><input type="checkbox" class="secMod" value="custportal_photos" '+(mods.includes('custportal_photos')?'checked':'')+' '+(u.super_admin?'disabled':'')+'><i class="fa-solid fa-photo-film tile-ic"></i>Customer Portal: Photos &amp; Videos only</label>',
              '<label class="chk-tile" title="May publish or reject construction photos and videos before customers see them (Photos &amp; Videos &gt; Review)"><input type="checkbox" class="secMod" value="custportal_photo_approver" '+(mods.includes('custportal_photo_approver')?'checked':'')+' '+(u.super_admin?'disabled':'')+'><i class="fa-solid fa-stamp tile-ic"></i>Customer Portal: approve photos</label>']:[]))];}).join('')}</div>
      </div>
    </div>
    ${u.super_admin?'<p style="color:var(--slate);font-size:13px;margin-top:12px">This person is an administrator and always has full access.</p>':`<div style="margin-top:18px;display:flex;justify-content:flex-end;gap:10px"><button class="btn" onclick="navTo('security')">Cancel</button><button class="btn btn-primary" id="secSaveBtn" onclick="secSave('${esc(email)}')"><i class="fa-solid fa-check"></i> Save access</button></div>`}
  </div>`;
}
let SEC_DEPTS=[];
function deptPickerHtml(selected){
  selected=selected||[];
  const chips=selected.length?selected.map(d=>avatar(d)).join(''):'<span style="color:#94a3b8;font-size:13px">No department selected</span>';
  const rows=DEPARTMENTS.map(d=>{
    const on=selected.includes(d);
    return `<div class="secDeptRow" data-d="${esc(d)}" onclick="secDeptToggle(this)" style="display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;cursor:pointer;${on?'background:var(--brand-a10,#eef2ff)':''}">${avatar(d)}<span style="flex:1;font-size:13px;color:var(--ink)">${esc(d)}</span><i class="fa-solid fa-check" style="color:var(--brand);opacity:${on?'1':'0'}"></i></div>`;
  }).join('');
  return `<div style="position:relative">
    <div id="secDeptBtn" onclick="secDeptPanelToggle()" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;border:1px solid var(--line);border-radius:9px;padding:8px 10px;cursor:pointer;min-height:38px;box-sizing:border-box">${chips}<i class="fa-solid fa-chevron-down" style="margin-left:auto;color:var(--slate);font-size:11px"></i></div>
    <div id="secDeptPanel" style="display:none;position:absolute;z-index:50;top:calc(100% + 4px);left:0;right:0;background:var(--bg-card,#fff);border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 32px rgba(2,6,23,.18);max-height:260px;overflow:auto;padding:4px">${rows}</div>
  </div>`;
}
window.secDeptPanelToggle=function(){ const p=$('secDeptPanel'); if(!p)return; p.style.display=p.style.display==='none'?'':'none'; };
window.secDeptToggle=function(el){
  const d=el.dataset.d; const i=SEC_DEPTS.indexOf(d);
  if(i>=0)SEC_DEPTS.splice(i,1); else SEC_DEPTS.push(d);
  const on=SEC_DEPTS.includes(d);
  el.style.background=on?'var(--brand-a10,#eef2ff)':'';
  const chk=el.querySelector('.fa-check'); if(chk)chk.style.opacity=on?'1':'0';
  const btn=$('secDeptBtn');
  if(btn){ const chips=SEC_DEPTS.length?SEC_DEPTS.map(x=>avatar(x)).join(''):'<span style="color:#94a3b8;font-size:13px">No department selected</span>'; btn.innerHTML=chips+'<i class="fa-solid fa-chevron-down" style="margin-left:auto;color:var(--slate);font-size:11px"></i>'; }
};
document.addEventListener('click',function(e){
  const panel=$('secDeptPanel'); if(!panel||panel.style.display==='none')return;
  const btn=$('secDeptBtn');
  if(panel.contains(e.target)||(btn&&btn.contains(e.target)))return;
  panel.style.display='none';
});
window.secAllTabs=function(on){document.querySelectorAll('.secMod').forEach(c=>{if(!c.disabled)c.checked=on;});};
window.secSave=async function(email){
  const level=$('secLevel').value;
  const mods=[...document.querySelectorAll('.secMod:checked')].map(c=>c.value);
  const b=$('secSaveBtn');if(b){b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving…';}
  const dept=SEC_DEPTS.slice();
  const {error}=await sb.schema('adm').rpc('admin_set_access',{target_email:email,p_department:dept,p_level:level,p_modules:mods});
  if(error){toast(error.message,'err');if(b){b.disabled=false;b.innerHTML='<i class="fa-solid fa-check"></i> Save access';}return;}
  toast('Access updated for '+email,'ok');navTo('security');
};
function noAccess(v){ setCrumb(['Access']); v.innerHTML=`<div class="card card-pad empty" style="max-width:520px;margin:24px auto;text-align:center"><i class="fa-solid fa-lock" style="font-size:30px;color:#94a3b8"></i><h2 style="margin-top:12px">No access to this module</h2><p style="color:var(--slate)">You do not have permission to view this page. Contact your administrator if you need access.</p><button class="btn btn-primary" style="margin-top:14px" onclick="navTo('dashboard')">Go to Dashboard</button></div>`; }

