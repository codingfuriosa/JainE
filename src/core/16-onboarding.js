/* ===== Global first-login onboarding (full screen, no sidebar) ===== */
async function renderOnboarding(){
  const people=await getPeople();
  let host=document.getElementById('onboardHost');
  if(!host){host=document.createElement('div');host.id='onboardHost';document.body.appendChild(host);}
  host.style.cssText='position:fixed;inset:0;z-index:200;background:linear-gradient(160deg,#eef2f9,#f8fafc);overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:30px 14px';
  const fetchedName=(state.profile&&state.profile.full_name)||(state.roles&&state.roles.full_name)||(state.user&&state.user.user_metadata&&state.user.user_metadata.full_name)||'';
  host.innerHTML=`<div style="width:100%;max-width:600px">
    <div class="card" style="overflow:hidden">
      <div style="background:linear-gradient(135deg,#103A63,#0A2640);color:#fff;padding:24px 26px">
        <div style="display:flex;align-items:center;gap:12px"><div style="width:40px;height:40px;border-radius:9px;background:linear-gradient(160deg,#F2A104,#D98A00);display:grid;place-items:center;color:#0A2640;font-weight:700;font-family:'IBM Plex Mono',monospace">J</div>
        <div><div style="font-weight:700;font-size:18px;letter-spacing:.02em">Welcome to JAIN-E</div><div style="color:#9DB6CE;font-size:13px">Set up your profile to get started</div></div></div>
      </div>
      <div class="card-pad frm">
        <label>Full name</label><input id="obName" placeholder="Your name" value="${esc(fetchedName)}">
        <label>Position / Post <span style="color:var(--slate);font-weight:400">(optional — can add later)</span></label><input id="obDesig" placeholder="e.g. Project Manager" value="${esc((state.profile&&state.profile.designation)||'')}">
        ${rmPickerHtml(people,'')}
        <div style="margin-top:22px;display:flex;justify-content:flex-end"><button class="btn btn-primary" id="obSaveBtn" onclick="onboardSave()"><i class="fa-solid fa-check"></i> Complete setup</button></div>
        <p style="color:var(--slate);font-size:12px;margin-top:12px;text-align:center">Your department is assigned by your administrator after setup. Anyone can delegate work to anyone — no extra permission needed.</p>
      </div>
    </div></div>`;
}
window.onboardSave=async function(){
  const name=$('obName').value.trim();if(!name){toast('Please enter your name','err');return;}
  const b=$('obSaveBtn');if(b){b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving…';}
  const row={email:state.email,full_name:name,designation:$('obDesig').value,reporting_manager:$('obMgr').value||null,onboarded:true,avatar_color:colorFor(state.email)};
  const {error}=await sb.schema('acc').from('user_profile').upsert(row,{onConflict:'email'});
  if(error){toast(error.message,'err');if(b){b.disabled=false;b.innerHTML='<i class="fa-solid fa-check"></i> Complete setup';}return;}
  state.profile=Object.assign(state.profile||{},row);refreshBootCache();PEOPLE=null;
  const host=document.getElementById('onboardHost');if(host)host.remove();
  $('shell').style.display='block';location.hash='';renderShell();renderPage();startSessionGuard();
};
/* pending-user badge on the Control Panel nav item (admins) */
async function secPendingBadge(){
  try{const {data}=await sb.schema('adm').rpc('admin_list_users');
    const pend=(data||[]).filter(u=>u.onboarded&&!u.super_admin&&!(Array.isArray(u.modules)&&u.modules.length)).length;
    const a=document.querySelector('.sb-item[data-id="security"]');if(!a)return;
    const old=a.querySelector('.sb-badge');if(old)old.remove();a.classList.remove('pending');
    if(pend>0){const sp=document.createElement('span');sp.className='sb-badge';sp.textContent=pend;a.appendChild(sp);a.classList.add('pending');}
  }catch(e){}
}


