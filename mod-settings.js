VIEWS.settings=async function(v){
  setCrumb(['Home','Settings']);
  const nm=(state.profile&&state.profile.full_name)||state.email.split('@')[0];
  const roles=state.roles||{};
  const modRows=[['doc','Documents'],['acc','Accountability / Tasks'],['crm','CRM'],['hr','HR'],['projects','Projects'],['finance','Finance'],['kraya','Procurement'],['masters','Masters']];
  const myModRows=modRows.filter(m=>roles[m[0]]);
  const people=await getPeople();
  // acc.user_profile.department is an array column (a person can belong to more than one dept) —
  // not a plain string, so this needs an array membership check, not ===.
  const rawDept=state.profile&&state.profile.department;
  const deptArr=Array.isArray(rawDept)?rawDept:(rawDept?[rawDept]:[]);
  const dept=deptArr.join(', ');
  // Workspace/connection info: the administrator account (Super Admin) plus every user in the
  // Systems department — nobody else.
  const canSeeWorkspace=!!(state.super||deptArr.includes('Systems'));
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-gear" style="color:#475569"></i> Settings</h1><p>Your account, access and workspace preferences</p></div></div>
  <div class="grid grid-2">
    <div class="card card-pad"><div class="sec-title">Account</div>
      <div style="display:flex;align-items:center;gap:14px;margin-top:14px"><span class="avatar-sm" style="width:54px;height:54px;font-size:18px;background:${colorFor(state.email)}">${esc(initials(nm).toUpperCase())}</span><div><div style="font-weight:700;font-size:16px">${esc(nm)}</div><div style="color:var(--slate);font-size:13px">${esc(state.email)}</div>${state.super?'<span class="tag t-purple" style="margin-top:6px"><i class="fa-solid fa-shield-halved"></i> Super Admin</span>':''}</div></div>
      <div class="frm" style="margin-top:18px">
        <label>Full name</label><input id="obName" value="${esc(nm)}">
        <label>Designation <span style="color:var(--slate);font-weight:400">(optional)</span></label><input id="obDesig" placeholder="e.g. Project Manager" value="${esc((state.profile&&state.profile.designation)||'')}">
        <label>Department</label><input disabled value="${esc(dept)}" placeholder="Not assigned yet" style="background:#f1f5f9;color:var(--slate);cursor:not-allowed">
        ${rmPickerHtml(people,(state.profile&&state.profile.reporting_manager)||'')}
        <div style="margin-top:16px"><button class="btn btn-primary" onclick="setProfileSave()"><i class="fa-solid fa-check"></i> Save changes</button></div>
      </div>
    </div>
    <div class="card card-pad"><div class="sec-title">Module Access</div><div class="sec-sub">Your role per module (set by an administrator)</div>
      ${myModRows.length?`<table style="margin-top:6px"><tbody>${myModRows.map(m=>`<tr><td style="font-weight:500">${m[1]}</td><td style="text-align:right"><span class="tag t-green">${esc(roles[m[0]])}</span></td></tr>`).join('')}</tbody></table>`:'<div style="color:var(--slate);font-size:13px;margin-top:12px">No module access assigned yet — ask an administrator.</div>'}
    </div>
  </div>
  ${canSeeWorkspace?`<div class="card card-pad" style="margin-top:16px"><div class="sec-title">Workspace</div><div class="sec-sub">Connection & system information</div>
    <table style="margin-top:6px"><tbody>
      <tr><td style="color:var(--slate)">Organisation</td><td style="text-align:right"><b>Jain Group</b></td></tr>
      <tr><td style="color:var(--slate)">Database</td><td style="text-align:right"><b>Supabase · ap-south-1</b> <span class="tag t-green">Connected</span></td></tr>
      <tr><td style="color:var(--slate)">Storage buckets</td><td style="text-align:right"><b>documents, legal-docs, task-attachments, branding</b></td></tr>
      <tr><td style="color:var(--slate)">Security</td><td style="text-align:right">Row-Level Security <span class="tag t-green">Enforced</span></td></tr>
      <tr><td style="color:var(--slate)">Version</td><td style="text-align:right"><b>Nexus-RE v1.0</b></td></tr>
      <tr><td style="color:var(--slate)">This session</td><td style="text-align:right" id="sessInfo">…</td></tr>
    </tbody></table>
  </div>`:''}`;
  if(canSeeWorkspace)try{
    const {data}=await sb.auth.getSession();
    const tok=data&&data.session&&data.session.access_token;
    const el=document.getElementById('sessInfo');
    if(tok&&el){
      const p=JSON.parse(atob(tok.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
      el.innerHTML='started <b>'+new Date(p.iat*1000).toLocaleTimeString()+'</b> · token …'+esc(tok.slice(-10));
    }
  }catch(e){}
};
window.setProfileSave=async function(){
  const name=$('obName').value.trim();if(!name){toast('Enter your name','err');return;}
  const row={email:state.email,full_name:name,designation:$('obDesig').value,reporting_manager:$('obMgr').value||null,onboarded:true,avatar_color:colorFor(state.email)};
  const {error}=await sb.schema('acc').from('user_profile').upsert(row,{onConflict:'email'});
  if(error){toast(error.message,'err');return;}
  state.profile=Object.assign(state.profile||{},row);refreshBootCache();PEOPLE=null;toast('Profile saved','ok');
  VIEWS.settings($('view'));
};


/* ============================ HUMAN RESOURCES ============================ */