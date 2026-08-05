/* ============================ CONFIG ============================ */
const SUPABASE_URL='https://rkxsgtauigjrpcjkmccu.supabase.co';
const SUPABASE_KEY='sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n';
const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const $=id=>document.getElementById(id);
const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
const esc=s=>(s==null?'':String(s)).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const state={user:null,email:null,profile:null,roles:null,super:false};
const PAGE=window.PAGE||'dashboard';
function fileFor(id){if(id==='dashboard')return 'index.html';if(id==='tasks')return 'accountability.html';return id+'.html';}
function navTo(path){const seg=String(path).split('/');const first=seg[0];if(first===PAGE){location.hash=seg.length>1?('#/'+seg.slice(1).join('/')):'#/';renderPage();}else{const hash=seg.length>1?('#/'+seg.slice(1).join('/')):'';location.href=fileFor(first)+hash;}}
window.navTo=navTo;
function goToTask(id){ const dd=$('notifDd'); if(dd)dd.classList.remove('show'); if(PAGE==='tasks'){location.hash='#/task/'+id;renderPage();} else location.href='tasks.html#/task/'+id; }

/* ============================ HELPERS ============================ */
function toast(msg,type){if(type==='err')console.error('[toast]',msg);const t=el('div','toast '+(type||''),'<i class="fa-solid fa-'+(type==='err'?'circle-exclamation':type==='ok'?'circle-check':type==='warn'?'triangle-exclamation':'circle-info')+'"></i>'+esc(msg));$('toasts').appendChild(t);setTimeout(()=>t.remove(),(type==='err'||type==='warn')?9000:3400);}
function fmtBytes(b){if(!b)return '—';const u=['B','KB','MB','GB'];let i=0;b=Number(b);while(b>=1024&&i<3){b/=1024;i++;}return b.toFixed(b<10&&i>0?1:0)+' '+u[i];}
function fmtDate(d){if(!d)return '—';const dt=new Date(d);return dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});}
function fmtDateShort(d){if(!d)return '—';return new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short'});}
function relTime(d){const s=(Date.now()-new Date(d))/1000;if(s<60)return 'just now';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';if(s<604800)return Math.floor(s/86400)+'d ago';return fmtDate(d);}
const PALETTE=['#1e3a8a','#0f766e','#7c3aed','#b45309','#be123c','#0369a1','#15803d','#9333ea','#c2410c','#1d4ed8'];
function colorFor(s){s=s||'?';let h=0;for(let i=0;i<s.length;i++)h=s.charCodeAt(i)+((h<<5)-h);return PALETTE[Math.abs(h)%PALETTE.length];}
function initials(name){if(!name)return '?';const p=name.trim().split(/\s+/);return ((p[0]||'')[0]||'')+((p[1]||'')[0]||'');}
function avatar(name,sm){const c=colorFor(name);return '<span class="avatar-sm" style="background:'+c+'" title="'+esc(name)+'">'+esc(initials(name).toUpperCase())+'</span>';}
/* ---- overlapping avatar stack (up to 3 shown, "+N" beyond that) for task-row sub-labels ---- */
function avatarStackHtml(emails){
  const list=(emails||[]).filter(Boolean);
  if(!list.length)return '';
  const shown=list.slice(0,3);
  const extra=list.length-shown.length;
  return '<span class="avatar-stack">'+shown.map(e=>avatar(nameOf(e))).join('')+(extra>0?'<span class="avatar-sm avatar-extra" title="'+esc(list.slice(3).map(nameOf).join(', '))+'">+'+extra+'</span>':'')+'</span>';
}
/* ---- task row sub-label: "Assigned/Delegated to {avatar stack} by {name}" ---- */
function dgRowLabelHtml(word,toEmails,byEmail){
  const to=(toEmails||[]).filter(Boolean);
  if(!to.length&&!byEmail)return '';
  let html=esc(word)+' to '+(to.length?avatarStackHtml(to):'<span style="color:var(--slate)">—</span>');
  if(byEmail)html+=' by <b>'+(byEmail===state.email?'you':esc(nameOf(byEmail)))+'</b>';
  return html;
}
function fileIcon(ft){ft=(ft||'').toLowerCase();if(ft.includes('pdf'))return '<span class="ftype fp-pdf"><i class="fa-solid fa-file-pdf"></i></span>';if(ft.includes('xls')||ft.includes('csv'))return '<span class="ftype fp-xlsx"><i class="fa-solid fa-file-excel"></i></span>';if(ft.includes('doc'))return '<span class="ftype fp-docx"><i class="fa-solid fa-file-word"></i></span>';if(ft.match(/png|jpg|jpeg|gif|webp|svg/))return '<span class="ftype fp-img"><i class="fa-solid fa-file-image"></i></span>';return '<span class="ftype fp-other"><i class="fa-solid fa-file-lines"></i></span>';}
function statusTag(s){const m={'Active':'t-green','Completed':'t-green','Archived':'t-gray','Draft':'t-amber','In Progress':'t-blue','Not Started':'t-gray','Blocked':'t-red','Upcoming':'t-gray','Current':'t-blue','Due':'t-red','Pending':'t-amber','Awaiting Approval':'t-amber','Done':'t-blue'};return '<span class="tag '+(m[s]||'t-gray')+'">'+esc(s||'—')+'</span>';}
function prioTag(p){const m={'Urgent':'t-red','High':'t-amber','Medium':'t-blue','Low':'t-gray'};return '<span class="tag '+(m[p]||'t-gray')+'">'+esc(p||'—')+'</span>';}
function loader(host){host.innerHTML='<div class="loader"><div class="spin"></div></div>';}

/* modal */
function openModal(html,size){const h=$('modalHost');h.innerHTML='<div class="modal '+(size||'')+'">'+html+'</div>';$('overlay').classList.add('show');}
function closeModal(){$('overlay').classList.remove('show');$('modalHost').innerHTML='';if(__confirmResolve){const r=__confirmResolve;__confirmResolve=null;r(false);}}
$('overlay').addEventListener('click',e=>{if(e.target===$('overlay')){ if(window._modalMandatory)return; closeModal(); }});
/* ---- custom confirm dialog — replaces the native confirm() everywhere so delete/decline
   prompts look and behave the same on every device, instead of relying on the browser's own
   "This page says…" dialog (whose styling/wording is desktop-Chrome-specific and inconsistent
   or absent on mobile browsers). Usage: if(!await confirmDialog('Delete this task?'))return; */
let __confirmResolve=null;
function confirmDialog(message,opts){
  opts=opts||{};
  const danger=opts.danger!==false;
  return new Promise(resolve=>{
    __confirmResolve=resolve;
    openModal(`<div class="modal-head"><h3><i class="fa-solid ${opts.icon||(danger?'fa-triangle-exclamation':'fa-circle-question')}" style="color:${danger?'var(--err)':'var(--brand)'}"></i> ${esc(opts.title||'Please confirm')}</h3></div>
      <div class="modal-body">${esc(message)}</div>
      <div class="modal-foot"><button class="btn" onclick="__confirmAnswer(false)">Cancel</button><button class="btn ${danger?'btn-danger':'btn-primary'}" onclick="__confirmAnswer(true)">${esc(opts.okLabel||'Delete')}</button></div>`);
  });
}
window.__confirmAnswer=function(val){
  const r=__confirmResolve;__confirmResolve=null;
  closeModal();
  if(r)r(val);
};

/* ============================ AUTH ============================ */
function fatal(msg){
  var a=$('authLoad');
  if(a){a.style.display='flex';a.innerHTML='<div style="text-align:center;max-width:420px;padding:30px;font-family:Inter,system-ui,sans-serif"><div style="font-size:34px">⚠️</div><div style="margin-top:12px;font-weight:700;font-size:17px">Couldn’t load the workspace</div><div style="color:#64748b;font-size:13.5px;margin-top:8px;line-height:1.5">'+msg+'</div><a href="login.html" style="display:inline-block;margin-top:16px;background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:9px;text-decoration:none;font-weight:600;font-size:14px">Go to Sign In</a></div>';}
}
window.addEventListener('error',function(e){ if(!state.user){ fatal((e.message||'A script error occurred')+'.'); } });
async function autoProvisionGoogleProfile(){
  try{
    const meta=(state.user&&state.user.user_metadata)||{};
    const full_name=meta.full_name||meta.name||(state.email||'').split('@')[0];
    const row={email:state.email,full_name,designation:null,reporting_manager:null,onboarded:true,avatar_color:colorFor(state.email),password_set:false};
    const {error}=await sb.schema('acc').from('user_profile').upsert(row,{onConflict:'email'});
    if(!error){ state.profile=Object.assign(state.profile||{},row); }
  }catch(e){}
}
async function boot(){
  let sess;
  try{ const {data}=await sb.auth.getSession(); sess=data.session; }
  catch(err){ fatal('Could not reach the authentication service. Check your internet connection. ('+err.message+')'); return; }
  if(!sess){
    // Right after a Google-sign-in redirect, a brand-new page load can momentarily
    // read no session before it's finished settling — wait a beat and check once
    // more before concluding there's really no session (avoids a login-page flash).
    await new Promise(r=>setTimeout(r,700));
    try{ const {data}=await sb.auth.getSession(); sess=data.session; }catch(e){}
  }
  if(!sess){ location.replace('login.html'); return; }
  state.user=sess.user; state.email=state.user.email;
  // ensure profile + permission rows exist (idempotent self-provision)
  try{
    const {data:prof}=await sb.schema('acc').from('user_profile').select('*').eq('email',state.email).maybeSingle();
    state.profile=prof;
  }catch(e){}
  try{
    const {data:me}=await sb.schema('adm').from('users').select('*').eq('email',state.email).maybeSingle();
    state.roles=me;
  }catch(e){}
  try{
    const {data:p}=await sb.schema('adm').from('user_permissions').select('super_admin').eq('email',state.email).maybeSingle();
    state.super=!!(p&&p.super_admin);
  }catch(e){}

  // Landed here right after a Google OAuth redirect (oauth-verify.html forwards
  // straight to index.html?intent=login|signup with no visible page of its own).
  // Decide here, before the shell ever renders, so a denied login never flashes
  // the dashboard and a fresh signup never shows an extra confirmation step.
  const _qp=new URLSearchParams(location.search);
  const _intent=_qp.get('intent');
  if(_intent){
    try{ history.replaceState({},document.title,location.pathname); }catch(e){}
    const _viaGoogle=!!(state.user.app_metadata&&state.user.app_metadata.provider==='google');
    const _completed=!!(state.profile&&state.profile.onboarded);
    if(_viaGoogle && _intent==='login' && !_completed){
      try{ await sb.auth.signOut(); }catch(e){}
      location.replace('signup.html?notsignedup=1');
      return;
    }
    if(_viaGoogle && _intent==='signup' && _completed){
      try{ await sb.auth.signOut(); }catch(e){}
      location.replace('login.html?alreadyhave=1');
      return;
    }
    if(_viaGoogle && !_completed){ await autoProvisionGoogleProfile(); }
  }

  renderShell();
  $('authLoad').style.display='none';
  if(!state.super && !(state.profile&&state.profile.onboarded)){
    const viaGoogle=!!(state.user&&state.user.app_metadata&&state.user.app_metadata.provider==='google');
    if(viaGoogle) await autoProvisionGoogleProfile();
  }
  if(!state.super && !(state.profile&&state.profile.onboarded)){ renderOnboarding(); return; }
  $('shell').style.display='block';
  renderPage();
  startSessionGuard();
  promptSetPassword();
}
// Continuously enforce the session: if the token is gone/expired/tampered, log out.
function startSessionGuard(){
  let kicking=false;
  async function kick(){
    if(kicking)return; kicking=true;
    try{ const {data}=await sb.auth.getSession(); if(!data||!data.session){ location.replace('login.html'); } }
    catch(e){ location.replace('login.html'); }
    finally{ kicking=false; }
  }
  // Fast, local-only check (no network round-trip) — safe to run on every in-app navigation.
  // getSession() just reads the cached token, so it can't detect a user deleted server-side
  // whose JWT hasn't expired yet — that needs a real round-trip, see kickHard() below.
  let kickingHard=false;
  async function kickHard(){
    if(kickingHard)return; kickingHard=true;
    try{
      const {data:sd}=await sb.auth.getSession();
      if(!sd||!sd.session){ location.replace('login.html'); return; }
      // getUser() actually asks Supabase to validate the token against auth.users —
      // if the account was deleted (e.g. from the admin panel) this comes back with
      // an error even though the locally-cached JWT hasn't expired yet.
      const {error}=await sb.auth.getUser();
      if(error){
        // getUser() reports failures as a returned {error}, not a thrown exception — so a plain
        // network hiccup (e.g. coming back from a long idle period before WiFi reconnects) lands
        // here too, not in the catch below. Only actually sign out for a real auth rejection
        // (invalid/expired token, deleted user) — anything else, leave the session alone and just
        // let the next periodic check retry.
        const status=error.status||(error.originalError&&error.originalError.status);
        const isAuthRejection=status===401||status===403||/invalid|expired|not.?found|jwt/i.test(error.message||'');
        if(isAuthRejection){ try{await sb.auth.signOut();}catch(e){} location.replace('login.html'); }
      }
    }catch(e){ /* network hiccup — don't log the user out over a transient failure */ }
    finally{ kickingHard=false; }
  }
  // token removed/changed in this or another tab (e.g. localStorage cleared)
  window.addEventListener('storage', function(e){ if(!e.key || /auth-token/.test(e.key)) kick(); });
  // re-check whenever the tab regains focus and on every in-app navigation
  document.addEventListener('visibilitychange', function(){ if(document.visibilityState==='visible') kickHard(); });
  window.addEventListener('hashchange', kick);
  // periodic safety check — this is what catches a deleted user within ~45s even if they never touch the tab
  setInterval(kickHard, 45000);
  kickHard();
}
sb.auth.onAuthStateChange((ev)=>{if(ev==='SIGNED_OUT')location.replace('login.html'); else if(ev==='PASSWORD_RECOVERY'){ if(typeof resetPasswordModal==='function') resetPasswordModal(); }});

/* ============================ NAV ============================ */
const NAV=[
  {group:'Overview',items:[
    {id:'dashboard',label:'Home / Dashboards',icon:'fa-gauge-high'},
    {id:'tasks',label:'Accountability',icon:'fa-clipboard-check'},
  ]},
  {group:'Sales',items:[
    {id:'gtd',label:'GTD',icon:'fa-brain'},
    {id:'crm',label:'CRM & Sales',icon:'fa-handshake'},
    {id:'postsales',label:'Post Sales',icon:'fa-headset'},
  ]},
  {group:'Operations',items:[
    {id:'projects',label:'Projects',icon:'fa-building'},
    {id:'construction',label:'Construction',icon:'fa-helmet-safety'},
    {id:'inventory',label:'Inventory',icon:'fa-boxes-stacked'},
    {id:'procurement',label:'Procurement',icon:'fa-cart-shopping'},
    {id:'maintenance',label:'Assets & Maintenance',icon:'fa-screwdriver-wrench'},
    {id:'inspection',label:'Inspection',icon:'fa-clipboard-list'},
  ]},
  {group:'People',items:[
    {id:'hr',label:'Human Resources',icon:'fa-users'},
    {id:'recruitment',label:'Recruitment (ATS)',icon:'fa-user-plus'},
  ]},
  {group:'Governance',items:[
    {id:'finance',label:'Finance Vault',icon:'fa-indian-rupee-sign'},
    {id:'legal',label:'Legal',icon:'fa-scale-balanced'},
    {id:'compliance',label:'Renewals & Compliance',icon:'fa-calendar-check'},
  ]},
  {group:'Growth & Strategy',items:[
    {id:'campaigns',label:'Campaign Analytics',icon:'fa-bullhorn'},
    {id:'competitors',label:'Competitor Ads',icon:'fa-magnifying-glass-chart'},
    {id:'organic',label:'Posts & Reels',icon:'fa-photo-film'},
    {id:'transcription',label:'Transcription',icon:'fa-microphone-lines'},
    {id:'scaling',label:'Scaling Up',icon:'fa-arrow-trend-up'},
    {id:'playbook',label:'Playbook',icon:'fa-book-open'},
  ]},
  {group:'Knowledge',items:[
    {id:'documents',label:'Document Library',icon:'fa-folder-open'},
    {id:'video',label:'Video Library',icon:'fa-clapperboard'},
    {id:'helpdesk',label:'AI Help Desk',icon:'fa-headset'},
    {id:'reports',label:'Reports',icon:'fa-chart-pie'},
  ]},
  {group:'Stakeholder Portals',items:[
    {id:'customer',label:'Customer Portal',icon:'fa-user-tie'},
    {id:'supplier',label:'Supplier Portal',icon:'fa-truck'},
    {id:'whatsapp',label:'WhatsApp Bot',icon:'fa-comment-dots'},
    {id:'mail',label:"Naren's Mail",icon:'fa-envelope'},
  ]},
  {group:'IT & Support',items:[
    {id:'network',label:'Internet Speed',icon:'fa-wifi'},
  ]},
  {group:'System',items:[
    {id:'settings',label:'Settings',icon:'fa-gear'},
  ]},
];
const LABELS={};const ICONS={};NAV.forEach(g=>g.items.forEach(i=>{LABELS[i.id]=i.label;ICONS[i.id]=i.icon;}));LABELS.security='Control Panel';ICONS.security='fa-sliders';
const MODLIST=[];NAV.forEach(g=>g.items.forEach(i=>MODLIST.push([i.id,i.label])));
const MODSET=new Set(MODLIST.map(m=>m[0]));
const LEVELS=['Manager','Employee','New','Intern'];
const DEFAULT_MODULES=['dashboard','tasks','projects','settings','network'];
function navIcon(id){return ICONS[id]||'fa-square';}
function allowedSet(){if(state.super)return null;const m=state.roles&&state.roles.modules;if(m===null||m===undefined)return new Set(DEFAULT_MODULES);if(Array.isArray(m)&&m.length){const ss=new Set(m);ss.add('dashboard');ss.add('settings');ss.add('network');return ss;}const ss=new Set(['dashboard','settings','network']);return ss;}
function effectiveNav(){const allow=allowedSet();let groups=NAV.map(g=>({group:g.group,items:g.items.filter(it=>!allow||allow.has(it.id))})).filter(g=>g.items.length);if(state.super)groups=[{group:'Administration',items:[{id:'security',label:'Control Panel',icon:'fa-sliders'}]}].concat(groups);return groups;}
function pageAllowed(id){if(state.super)return true;if(id==='security')return false;if(id==='dashboard'||id==='settings'||id==='placeholder'||id==='network')return true;const m=state.roles&&state.roles.modules;if(m===null||m===undefined)return DEFAULT_MODULES.includes(id);if(Array.isArray(m)&&m.length)return m.includes(id);return id==='dashboard'||id==='settings';}

function renderShell(){
  const nav=$('sbNav');nav.innerHTML='';
  effectiveNav().forEach(g=>{
    nav.appendChild(el('div','sb-group',g.group));
    g.items.forEach(it=>{
      const a=el('a','sb-item','<i class="fa-solid '+it.icon+'"></i> '+it.label);
      a.href=fileFor(it.id);a.dataset.id=it.id;
      nav.appendChild(a);
    });
  });
  if(state.super)secPendingBadge();
  // profile avatar + dropdown
  const nm=(state.profile&&state.profile.full_name)||(state.roles&&state.roles.full_name)||state.email.split('@')[0];
  $('profileBtn').style.background=colorFor(state.email);
  $('profileBtn').textContent=initials(nm).toUpperCase();
  $('profileDd').innerHTML=
    '<div class="dd-head"><span class="avatar-sm" style="background:'+colorFor(state.email)+'" title="'+esc(state.email)+'">'+esc(initials(nm).toUpperCase())+'</span>'+
    '<div class="dd-head-txt" title="'+esc(state.email)+'"><div class="nm">'+esc(nm)+'</div><div class="em">'+esc(state.email)+'</div></div></div>'+
    '<div class="dd-item" onclick="navTo(\'tasks/profile\')"><i class="fa-regular fa-user"></i> My Profile</div>'+
    '<div class="dd-item" onclick="navTo(\'settings\')"><i class="fa-solid fa-gear"></i> Settings</div>'+
    (state.super?'<div class="dd-item"><i class="fa-solid fa-shield-halved"></i> Super Admin <span class="tag t-purple" style="margin-left:auto">ON</span></div>':'')+
    '<div style="height:1px;background:var(--line-2);margin:6px 0"></div>'+
    '<div class="dd-item" style="color:var(--err)" onclick="doSignOut()"><i class="fa-solid fa-arrow-right-from-bracket"></i> Sign Out</div>';
  $('profileBtn').onclick=e=>{e.stopPropagation();$('notifDd').classList.remove('show');$('profileDd').classList.toggle('show');};
  $('notifBtn').onclick=e=>{e.stopPropagation();$('profileDd').classList.remove('show');toggleNotif();};
  refreshNotifState();
  document.addEventListener('click',()=>{$('profileDd').classList.remove('show');$('notifDd').classList.remove('show');});
  const _gs=$('globalSearch');
  let _gsTimer=null;
  const _gsDrop=document.createElement('div');
  _gsDrop.id='gsDrop';_gsDrop.style.cssText='position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:9999;max-height:340px;overflow-y:auto;display:none';
  _gs.parentElement.style.position='relative';_gs.parentElement.appendChild(_gsDrop);
  _gs.addEventListener('keydown',e=>{if(e.key==='Enter'){const q=e.target.value.trim();_gsDrop.style.display='none';if(q)navTo('documents/search/'+encodeURIComponent(q));}});
  _gs.addEventListener('input',e=>{
    clearTimeout(_gsTimer);const q=e.target.value.trim();
    if(!q){_gsDrop.style.display='none';return;}
    _gsTimer=setTimeout(()=>gsLiveSearch(q),250);
  });
  document.addEventListener('click',e=>{if(!_gs.parentElement.contains(e.target))_gsDrop.style.display='none';});
  // hamburger / responsive sidebar
  if(window.innerWidth>1024 && localStorage.getItem('nav_closed')==='1') document.body.classList.add('nav-closed');
  var hb=$('hamburger'); if(hb) hb.onclick=function(e){ e.stopPropagation(); var mobile=window.innerWidth<=1024; document.body.classList.toggle(mobile?'nav-open':'nav-closed'); if(!mobile){ try{ localStorage.setItem('nav_closed', document.body.classList.contains('nav-closed')?'1':'0'); }catch(_){} } };
  var bd=$('sbBackdrop'); if(bd) bd.onclick=function(){ document.body.classList.remove('nav-open'); };
  document.querySelectorAll('.sb-item').forEach(function(a){ a.addEventListener('click',function(){ document.body.classList.remove('nav-open'); }); });
}
async function doSignOut(){ try{ await sb.auth.signOut(); }catch(e){} try{ Object.keys(localStorage).forEach(function(k){ if(/sb-.*-auth-token/.test(k)||k.indexOf('supabase')>=0) localStorage.removeItem(k); }); }catch(e){} location.replace('login.html'); }
window.doSignOut=doSignOut;

// Universal live document search (top nav)
async function gsLiveSearch(q){
  const drop=document.getElementById('gsDrop');if(!drop)return;
  drop.style.display='block';
  drop.innerHTML='<div style="padding:10px 14px;color:var(--slate);font-size:13px">Searching…</div>';
  const ql=q.toLowerCase();
  // Search documents
  let docs=[];
  try{const {data}=await sb.schema('doc').from('documents').select('id,title,file_name,category,department,storage_path').or('file_name.ilike.%'+q+'%,title.ilike.%'+q+'%,doc_no.ilike.%'+q+'%').limit(6);docs=data||[];}catch(e){}
  // Search JDs
  let jds=[];
  try{const {data}=await sb.schema('recruit').from('job_descriptions').select('id,name,storage_path').limit(6);jds=(data||[]).filter(j=>j.name.toLowerCase().includes(ql));}catch(e){}
  const defJds=(typeof DEFAULT_JDS!=='undefined'?DEFAULT_JDS:[]).filter(j=>j.name.toLowerCase().includes(ql));
  if(!docs.length&&!jds.length&&!defJds.length){drop.innerHTML='<div style="padding:12px 14px;color:var(--slate);font-size:13px;text-align:center">No documents found</div>';return;}
  const row=(icon,name,sub,url)=>`<div style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;border-bottom:1px solid var(--line-2)" onmousedown="event.preventDefault();window.open('${url}','_blank');document.getElementById('gsDrop').style.display='none'">
    <i class="fa-solid ${icon}" style="color:#64748b;width:14px;font-size:13px"></i>
    <div><div style="font-size:13px;font-weight:500">${esc(name)}</div><div style="font-size:11px;color:var(--slate)">${esc(sub)}</div></div>
  </div>`;
  const docRows=docs.map(r=>{const url=r.storage_path?SUPABASE_URL+'/storage/v1/object/public/documents/'+encodeURIComponent(r.storage_path).replace(/%2F/g,'/'):'#';const sub=[r.department,r.category].filter(Boolean).join(' · ')||'Document Library';return row('fa-file',r.title||r.file_name,sub,url);});
  const jdDbRows=jds.map(j=>{const url=j.storage_path?SUPABASE_URL+'/storage/v1/object/public/recruitment/'+encodeURIComponent(j.storage_path).replace(/%2F/g,'/'):'#';return row('fa-file-pdf',j.name,'Job Description · Recruitment',url);});
  const jdDefRows=defJds.map(j=>row('fa-file-pdf',j.name,'Job Description · Recruitment',j.url));
  drop.innerHTML=docRows.join('')+jdDbRows.join('')+jdDefRows.join('')+
    `<div style="padding:8px 14px;font-size:12px;color:var(--brand);font-weight:600;cursor:pointer;text-align:center" onmousedown="event.preventDefault();navTo('documents/search/'+encodeURIComponent('${q}'));document.getElementById('gsDrop').style.display='none'">See all results →</div>`;
}

function todayStr(){return new Date().toISOString().slice(0,10);}
function tomorrowStr(){const d=new Date();d.setDate(d.getDate()+1);return d.toISOString().slice(0,10);}
async function fetchNotifTasks(){
  // Urgent window: due today or tomorrow (and anything still overdue).
  // Only for whoever is actually holding the task right now (owner/assignee/member) —
  // NOT the creator/delegator, since delegating it away means it's no longer your responsibility.
  let items=[];
  try{
    const [{data:memRows},{data:dismissedRows}]=await Promise.all([
      sb.schema('acc').from('task_members').select('task_id').eq('email',state.email),
      sb.schema('acc').from('notif_dismissed_tasks').select('task_id').eq('email',state.email)
    ]);
    const memIds=(memRows||[]).map(r=>r.task_id);
    const dismissed=new Set((dismissedRows||[]).map(r=>r.task_id));
    const orParts=['owner.eq.'+state.email,'assigned_to.eq.'+state.email];
    if(memIds.length)orParts.push('id.in.('+memIds.join(',')+')');
    const {data}=await sb.schema('acc').from('tasks').select('id,title,due_date,status,owner,assigned_to,created_by').neq('status','Completed').lte('due_date',tomorrowStr()).or(orParts.join(',')).order('due_date',{ascending:true}).limit(20);
    items=(data||[]).filter(t=>t.due_date&&!dismissed.has(t.id));
  }catch(e){}
  return items;
}
// "Mark all read" for the Due/Urgent bucket — there's no stored read-state for these (they're computed
// live from due_date), so dismissal is tracked per-user in notif_dismissed_tasks instead. Re-appears on
// its own once the due date moves again, since a new due_date effectively makes it a fresh reminder.
window.notifDismissAllDue=async function(){
  const items=await fetchNotifTasks();
  if(!items.length)return;
  try{await sb.schema('acc').from('notif_dismissed_tasks').upsert(items.map(t=>({email:state.email,task_id:t.id})));}catch(e){}
  await renderNotifDropdown();refreshNotifState();
};
// "Mark all read" for the Updates bucket (project-added / task-delegated) — Approvals are deliberately
// excluded, since those need an actual Approve/Decline action, not just dismissal.
window.notifMarkAllGeneralRead=async function(){
  try{await sb.schema('acc').from('notifications').update({read:true}).eq('recipient',state.email).eq('read',false);}catch(e){}
  await renderNotifDropdown();refreshNotifState();
};
function notifIsHighlight(t){
  // Due today or already overdue — tomorrow is listed but not highlighted
  return t.due_date<=todayStr();
}
async function fetchNotifApprovals(){
  try{
    const {data}=await sb.schema('acc').rpc('my_pending_approvals');
    return data||[];
  }catch(e){return [];}
}
function approvalIsOld(a){
  if(!a.approval_requested_at)return false;
  return (Date.now()-new Date(a.approval_requested_at).getTime())>2*24*60*60*1000;
}
async function fetchNotifGeneral(){
  try{
    const {data}=await sb.schema('acc').from('notifications').select('*').eq('recipient',state.email).eq('read',false).order('created_at',{ascending:false}).limit(20);
    return data||[];
  }catch(e){return [];}
}
window.notifMarkRead=async function(nid){
  try{await sb.schema('acc').from('notifications').update({read:true}).eq('id',nid);}catch(e){}
};
function notifGeneralMeta(n){
  // The old per-project Projects/Goals pages are retired (Accountability now runs entirely on the
  // new ptasks-based system in accountability.js), so any project-only link has nowhere left to go.
  // Task links route through goToTask() (page-aware — see its definition near navTo above).
  if(n.kind==='project_member_added')return {icon:'fa-user-plus',cls:'t-blue',text:'Added you as a member',taskId:null};
  if(n.kind==='project_owner_added')return {icon:'fa-user-shield',cls:'t-blue',text:'Added you as an owner',taskId:null};
  if(n.kind==='task_delegated')return {icon:'fa-share-nodes',cls:'t-amber',text:'Delegated a task to you',taskId:n.task_id||null};
  if(n.kind==='comment')return {icon:'fa-comment-dots',cls:'t-blue',text:'Commented on a task',taskId:n.task_id||null};
  return {icon:'fa-bell',cls:'t-gray',text:n.body||'Notification',taskId:n.task_id||null};
}
async function toggleNotif(){
  const dd=$('notifDd');dd.className='dropdown notif';
  dd.classList.toggle('show');if(!dd.classList.contains('show'))return;
  await renderNotifDropdown();
}
async function renderNotifDropdown(){
  const dd=$('notifDd');if(!dd||!dd.classList.contains('show'))return;
  const head='<div class="dd-head"><div><div class="nm">Notifications</div><div class="em">Approvals, delegations and tasks due soon</div></div></div>';
  dd.innerHTML=head+'<div class="loader"><div class="spin"></div></div>';
  const [items,approvals,general]=await Promise.all([fetchNotifTasks(),fetchNotifApprovals(),fetchNotifGeneral()]);
  if(!items.length&&!approvals.length&&!general.length){dd.innerHTML=head+'<div class="n-it"><div class="n-ic t-green"><i class="fa-solid fa-circle-check"></i></div><div><div style="font-weight:600;font-size:13px">You\'re all caught up</div><div style="color:var(--slate);font-size:12px">No tasks need your attention</div></div></div>';return;}
  const ts=todayStr();
  // Approvals never get a bulk "Mark all read" — each one needs an actual Approve/Decline, not just
  // dismissal. Due (urgent) and Updates (project/task) both get one, since those are pure FYI items.
  const subhead=(txt,markFn)=>`<div style="padding:9px 14px 3px;display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="font-size:10.5px;font-weight:700;color:var(--slate);text-transform:uppercase;letter-spacing:.4px">${txt}</span>${markFn?`<span style="font-size:11px;font-weight:600;color:var(--brand);cursor:pointer" onclick="event.stopPropagation();${markFn}">Mark all read</span>`:''}</div>`;
  let html='';
  if(approvals.length){
    html+=subhead('Approvals')+approvals.map(a=>{
      const old=approvalIsOld(a);
      return `<div class="n-it ${old?'hl':''}" onclick="goToTask(${a.id})"><div class="n-ic ${old?'t-red':'t-amber'}"><i class="fa-solid fa-stamp"></i></div><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px">${esc(a.title)}</div><div style="color:var(--slate);font-size:12px">Awaiting your approval · ${relTime(a.approval_requested_at)}</div></div><button class="btn btn-sm btn-primary" style="flex:none" onclick="notifApprove(event,${a.approval_id},${a.id})"><i class="fa-solid fa-check"></i> Approve</button></div>`;
    }).join('');
  }
  if(general.length){
    html+=subhead('Updates','notifMarkAllGeneralRead()')+general.map(n=>{
      const meta=notifGeneralMeta(n);
      return `<div class="n-it" onclick="notifMarkRead(${n.id});${meta.taskId?`goToTask(${meta.taskId})`:`$('notifDd').classList.remove('show')`}"><div class="n-ic ${meta.cls}"><i class="fa-solid ${meta.icon}"></i></div><div><div style="font-weight:600;font-size:13px">${esc(n.title||meta.text)}</div><div style="color:var(--slate);font-size:12px">${meta.text} · ${relTime(n.created_at)}</div></div></div>`;
    }).join('');
  }
  if(items.length){
    html+=subhead('Due','notifDismissAllDue()');
    html+=items.map(t=>{
      const hl=notifIsHighlight(t);const overdue=t.due_date<ts;const tomorrow=t.due_date===tomorrowStr();
      return `<div class="n-it ${hl?'hl':''}" onclick="goToTask(${t.id})"><div class="n-ic ${hl?'t-red':'t-blue'}"><i class="fa-solid ${overdue?'fa-triangle-exclamation':'fa-list-check'}"></i></div><div><div style="font-weight:600;font-size:13px">${esc(t.title)}</div><div style="color:var(--slate);font-size:12px">${overdue?'Overdue':tomorrow?'Due tomorrow':'Due today'}</div></div></div>`;
    }).join('');
  }
  dd.innerHTML=head+html;
}
// Tiered count so the badge never grows unreadably wide: exact up to 10, then rounds down to the last
// clean milestone (10+, 50+, 100+, 500+, 1000+) instead of showing every exact number past that.
function fmtBadgeCount(n){
  if(n<=0)return '';
  if(n<=10)return String(n);
  if(n<=50)return '10+';
  if(n<=100)return '50+';
  if(n<=500)return '100+';
  if(n<=1000)return '500+';
  return '1000+';
}
async function refreshNotifState(){
  const btn=$('notifBtn');if(!btn)return;
  const dot=btn.querySelector('.dot');
  try{
    const [items,approvals,general]=await Promise.all([fetchNotifTasks(),fetchNotifApprovals(),fetchNotifGeneral()]);
    const total=items.length+approvals.length+general.length;
    btn.classList.toggle('ringing',total>0);
    if(dot){dot.textContent=fmtBadgeCount(total);dot.style.display=total>0?'flex':'none';}
  }catch(e){}
}

/* ============================ ROUTER ============================ */
// Top-level crumb labels that correspond to one real single page (as opposed to a sidebar group heading
// like "Operations" or "Home", which isn't itself a page) — clicking these jumps straight back there.
const CRUMB_ROOT_LINKS={'Accountability':'#/tasks','Documents':'#/documents','Legal':'#/legal'};
// Each part is either a plain string (label only) or a [label, hash] pair (clickable, jumps to hash).
// Plain strings for the known root labels above are auto-linked; everything else stays as-is so group
// headings and the current (last) page never render as clickable.
function setCrumb(parts){
  $('crumb').innerHTML=parts.map((p,i)=>{
    const isLast=i===parts.length-1;
    let label=p,hash=null;
    if(Array.isArray(p)){label=p[0];hash=p[1];}
    else if(!isLast&&CRUMB_ROOT_LINKS[p]){hash=CRUMB_ROOT_LINKS[p];}
    const inner=(!isLast&&hash)?`<span class="cl" onclick="location.hash='${hash.replace(/'/g,"\\'")}'">${esc(label)}</span>`:`<span class="${isLast?'cur':''}">${esc(label)}</span>`;
    return (i?'<i class="fa-solid fa-chevron-right"></i>':'')+inner;
  }).join(' ');
}
function setActive(id){document.querySelectorAll('.sb-item').forEach(a=>a.classList.toggle('active',a.dataset.id===id));}
function renderPage(){
  let seg=location.hash.replace(/^#\/?/,'').split('/').filter(Boolean);
  if(seg[0]===PAGE)seg=seg.slice(1);
  setActive(PAGE);
  const v=$('view');
  if(!pageAllowed(PAGE)){ return noAccess(v); }
  const fn=VIEWS[PAGE]||VIEWS.placeholder;
  fn(v,seg);
  refreshNotifState();
}
function route(){renderPage();}
window.addEventListener('hashchange',renderPage);

/* ============================ VIEWS ============================ */
const VIEWS={};

/* ---------- DASHBOARD ---------- */
VIEWS.dashboard=async function(v){
  setCrumb(['Home','Dashboard']);
  const nm=(state.profile&&state.profile.full_name)||state.email.split('@')[0];
  v.innerHTML=
   '<div class="page-head"><div><h1>Welcome back, '+esc(nm.split(' ')[0])+' 👋</h1><p>Here\'s what\'s happening across Jain Group today · '+fmtDate(new Date())+'</p></div>'+
   '<div style="display:flex;gap:10px"><button class="btn" onclick="navTo(\'reports\')"><i class="fa-solid fa-download"></i> Reports</button></div></div>'+
   '<div class="grid kpis" id="kpis" style="grid-template-columns:repeat(3,1fr)"></div>'+
   '<div class="card card-pad" style="margin-top:16px"><div class="sec-title">Sales & Collections</div><div class="sec-sub">Monthly trend across active projects</div><canvas id="chSales" height="100"></canvas></div>'+
   '<div class="card card-pad" style="margin-top:16px"><div class="sec-title">Inventory by Status</div><div class="sec-sub">Unit allocation overview</div><div style="max-width:380px;margin:8px auto 0"><canvas id="chInv" height="240"></canvas></div></div>'+
   '<div class="card card-pad" style="margin-top:16px"><div class="sec-title">Recent Documents</div><div class="sec-sub">Latest uploads across the company</div><div id="wDocs"></div></div>'+
   '<div class="card card-pad" style="margin-top:16px"><div class="sec-title">Quick Actions</div><div class="sec-sub">Jump back in</div><div id="wQuick"></div></div>'+
   '<div class="card card-pad" style="margin-top:16px"><div class="sec-title">Recent Activity</div><div class="sec-sub">Company-wide</div><div id="wAct" style="margin-top:8px"></div></div>';

  // KPIs (live counts where possible, sample otherwise)
  let docCount=48,taskOpen=0,leads=5,projects=3;
  try{const {count}=await sb.schema('doc').from('documents').select('*',{count:'exact',head:true});if(count!=null)docCount=count;}catch(e){}
  try{const {count}=await sb.schema('acc').from('tasks').select('*',{count:'exact',head:true}).neq('status','Completed');if(count!=null)taskOpen=count;}catch(e){}
  try{const {count}=await sb.schema('crm').from('leads').select('*',{count:'exact',head:true});if(count!=null)leads=count;}catch(e){}
  // Use CONS_ONGOING (the live projects array) — matches the Projects panel exactly
  projects=CONS_ONGOING.length;
  const kpis=[
    {ic:'fa-building',bg:'#eff4ff',c:'#1d4ed8',val:projects,lbl:'Active Projects',tr:'across Kolkata · Siliguri · Durgapur',up:1},
    {ic:'fa-folder-open',bg:'#f0fdf4',c:'#16a34a',val:docCount,lbl:'Documents Stored',tr:'live count',up:1},
    {ic:'fa-handshake',bg:'#f5f3ff',c:'#7c3aed',val:leads,lbl:'Active Leads',tr:'+3 today',up:1},
  ];
  $('kpis').innerHTML=kpis.map(k=>'<div class="kpi"><div class="top"><div class="ic" style="background:'+k.bg+';color:'+k.c+'"><i class="fa-solid '+k.ic+'"></i></div></div><div class="val">'+k.val+'</div><div class="lbl">'+k.lbl+'</div><div class="trend '+(k.up?'up':'down')+'"><i class="fa-solid fa-arrow-'+(k.up?'up':'down')+'"></i> '+k.tr+'</div></div>').join('');

  // charts
  new Chart($('chSales'),{type:'line',data:{labels:['Jan','Feb','Mar','Apr','May','Jun'],datasets:[
    {label:'Sales (₹ Cr)',data:[8,11,9.5,14,12,16],borderColor:'#1d4ed8',backgroundColor:'rgba(29,78,216,.08)',fill:true,tension:.4,borderWidth:2,pointRadius:3},
    {label:'Collections (₹ Cr)',data:[6,7.5,8,9,10.5,12],borderColor:'#16a34a',backgroundColor:'rgba(22,163,74,.06)',fill:true,tension:.4,borderWidth:2,pointRadius:3}
  ]},options:{plugins:{legend:{position:'bottom',labels:{usePointStyle:true,boxWidth:7,font:{size:12}}}},scales:{y:{grid:{color:'#eef1f6'},border:{display:false}},x:{grid:{display:false}}}}});
  new Chart($('chInv'),{type:'doughnut',data:{labels:['Available','Booked','Registered','Blocked'],datasets:[{data:[42,28,18,12],backgroundColor:['#1d4ed8','#16a34a','#7c3aed','#d97706'],borderWidth:0}]},options:{cutout:'62%',plugins:{legend:{position:'bottom',labels:{usePointStyle:true,boxWidth:7,font:{size:11.5},padding:12}}}}});

  // recent docs
  try{
    const {data}=await sb.schema('doc').from('documents').select('id,title,file_type,department,created_at').order('created_at',{ascending:false}).limit(4);
    $('wDocs').innerHTML=(data||[]).map(d=>'<div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--line-2);cursor:pointer" onclick="navTo(\'documents\')">'+fileIcon(d.file_type)+'<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(d.title)+'</div><div style="color:var(--slate);font-size:11.5px">'+esc(d.department)+' · '+relTime(d.created_at)+'</div></div></div>').join('');
  }catch(e){}

  // recent activity (company-wide, live)
  try{
    let feed=[];
    const dr=await sb.schema('doc').from('documents').select('title,uploaded_by,created_at').order('created_at',{ascending:false}).limit(6);
    (dr.data||[]).forEach(d=>feed.push({t:new Date(d.created_at),ic:'fa-file-arrow-up',c:'t-blue',who:(d.uploaded_by||'Someone').split('@')[0],act:'uploaded',obj:d.title}));
    const trq=await sb.schema('acc').from('tasks').select('title,created_by,created_at').order('created_at',{ascending:false}).limit(6);
    (trq.data||[]).forEach(t=>feed.push({t:new Date(t.created_at),ic:'fa-list-check',c:'t-purple',who:(t.created_by||'Someone').split('@')[0],act:'created task',obj:t.title}));
    feed.sort((a,b)=>b.t-a.t);feed=feed.slice(0,7);
    $('wAct').innerHTML=feed.length?feed.map(a=>'<div style="display:flex;align-items:center;gap:11px;padding:10px 0;border-bottom:1px solid var(--line-2)"><div class="n-ic '+a.c+'"><i class="fa-solid '+a.ic+'"></i></div><div style="font-size:13px"><b>'+esc(a.who)+'</b> '+a.act+' <b>'+esc(a.obj)+'</b><div style="color:var(--slate);font-size:11.5px">'+relTime(a.t)+'</div></div></div>').join(''):'<div class="empty" style="padding:22px"><i class="fa-regular fa-clock"></i><div>No recent activity</div></div>';
  }catch(e){$('wAct').innerHTML='<div class="empty" style="padding:22px">No recent activity</div>';}

  // quick actions
  const q=[{l:'Upload Document',i:'fa-upload',h:'documents'},{l:'New Task',i:'fa-list-check',h:'tasks'},{l:'Legal Vault',i:'fa-scale-balanced',h:'legal'},{l:'Add Lead',i:'fa-handshake',h:'crm'},{l:'View Reports',i:'fa-chart-pie',h:'reports'},{l:'Help Desk',i:'fa-headset',h:'helpdesk'},{l:'New Inspection',i:'fa-clipboard-check',h:'inspection/new'},{l:'Projects',i:'fa-building',h:'projects'},{l:'Finance Vault',i:'fa-indian-rupee-sign',h:'finance'},{l:'Renewals',i:'fa-calendar-check',h:'compliance'}];
  $('wQuick').innerHTML='<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px">'+q.map(x=>'<div class="lib-card" style="padding:14px;display:flex;align-items:center;gap:10px" onclick="navTo(\''+x.h+'\')"><div class="ic" style="width:36px;height:36px;margin:0;background:var(--brand-50);color:var(--brand)"><i class="fa-solid '+x.i+'"></i></div><div style="font-weight:600;font-size:13px">'+x.l+'</div></div>').join('')+'</div>';


};

/* ---------- GENERIC PLACEHOLDER MODULES ---------- */
const MODMETA={
  crm:{icon:'fa-handshake',c:'#7c3aed',bg:'#f5f3ff',desc:'Leads, pipeline, bookings, demands & collections.',kpis:[['Active Leads','5','fa-user-tag'],['Site Visits (wk)','12','fa-location-dot'],['Bookings (mo)','7','fa-file-signature'],['Collections','₹1.2 Cr','fa-indian-rupee-sign']],cols:['Lead','Project','Stage','Owner','Value'],rows:[['Rahul Mehta','Skyline','Site Visit','You','₹85L'],['Priya Shah','Greenfield','Negotiation','You','₹1.1Cr'],['Amit Patel','Skyline','Booking','You','₹92L']]},
  projects:{icon:'fa-building',c:'#1d4ed8',bg:'#eff4ff',desc:'Projects, towers, units, BOQ, construction stages & contractor work orders.',kpis:[['Active Projects','3','fa-building'],['Total Units','100','fa-door-open'],['Avg. Completion','64%','fa-helmet-safety'],['Open WOs','9','fa-file-contract']],cols:['Project','Tower','Stage','% Complete','Status'],rows:[['Skyline','Tower A','RCC Floor 12','62%','On Track'],['Greenfield','Block B','Finishing','88%','On Track'],['Riverdale','Phase 1','Plinth','24%','Delayed']]},
  inventory:{icon:'fa-boxes-stacked',c:'#0f766e',bg:'#f0fdfa',desc:'One stock truth — indents, GRNs, issues, returns & moving-average valuation.',kpis:[['SKUs','248','fa-tags'],['Stock Value','₹3.4 Cr','fa-warehouse'],['Low Stock','6','fa-triangle-exclamation'],['Pending GRN','3','fa-truck-ramp-box']],cols:['Item','Category','In Stock','UoM','Value'],rows:[['OPC 53 Cement','Cement','420','Bags','₹1.6L'],['TMT Steel 12mm','Steel','18','MT','₹9.2L'],['River Sand','Aggregates','60','Brass','₹3.0L']]},
  procurement:{icon:'fa-cart-shopping',c:'#b45309',bg:'#fffbeb',desc:'Indent → RFQ → PO → GRN with multi-level approvals & 3-way match.',kpis:[['Open POs','14','fa-file-invoice'],['Pending Approval','5','fa-clock'],['Vendors','86','fa-store'],['Spend (mo)','₹62L','fa-indian-rupee-sign']],cols:['PO No','Vendor','Amount','Status','Date'],rows:[['PO-0042','ACC Cement','₹4.2L','Pending','27 Jun'],['PO-0041','Tata Steel','₹9.1L','Approved','25 Jun'],['PO-0040','Pidilite','₹1.3L','Received','22 Jun']]},
  finance:{icon:'fa-indian-rupee-sign',c:'#15803d',bg:'#f0fdf4',desc:'Director vault — collections, dues, payables & project P&L.',kpis:[['Collections (mo)','₹1.2 Cr','fa-arrow-down'],['Outstanding','₹3.8 Cr','fa-hourglass'],['Payables','₹64L','fa-file-invoice-dollar'],['Net Position','₹5.6 Cr','fa-scale-balanced']],cols:['Account','Type','Amount','Status','Date'],rows:[['Skyline Collections','Inflow','₹42L','Cleared','26 Jun'],['Contractor Payment','Outflow','₹18L','Pending','27 Jun']]},
  hr:{icon:'fa-users',c:'#be123c',bg:'#fff1f2',desc:'Directory, attendance, payroll-grade data, performance & statutory.',kpis:[['Headcount','3','fa-users'],['Present Today','3','fa-user-check'],['On Leave','0','fa-plane'],['Open Requests','2','fa-inbox']],cols:['Employee','Department','Designation','Status','Joined'],rows:[['(salary columns are protected)','—','—','—','—']]},
  recruitment:{icon:'fa-user-plus',c:'#0369a1',bg:'#f0f9ff',desc:'Hiring funnel — requisition → applications → interviews → offer → onboarding.',kpis:[['Open Roles','4','fa-briefcase'],['Applicants','37','fa-id-card'],['Interviews (wk)','6','fa-comments'],['Offers Out','2','fa-envelope-open-text']],cols:['Applicant','Role','Stage','Score','Status'],rows:[['Neha Verma','Site Engineer','Interview L2','82','Active'],['Karan Singh','Accountant','Shortlisted','—','Active']]},
  maintenance:{icon:'fa-screwdriver-wrench',c:'#7c3aed',bg:'#f5f3ff',desc:'Asset register, preventive-maintenance schedules & breakdown tracking.',kpis:[['Assets','64','fa-gears'],['PM Due (wk)','8','fa-calendar-check'],['Under Repair','2','fa-wrench'],['Downtime','3.2h','fa-clock']],cols:['Asset','Category','Location','Next PM','Status'],rows:[['DG Set 250kVA','Electrical','Skyline','02 Jul','Active'],['Passenger Lift 1','Mechanical','Greenfield','—','Under Repair']]},
  reports:{icon:'fa-chart-pie',c:'#1d4ed8',bg:'#eff4ff',desc:'Cross-module analytics, scoreboards & reconciliation tools.',kpis:[['Saved Reports','12','fa-floppy-disk'],['Reconciliations','4','fa-not-equal'],['Scheduled','3','fa-clock'],['Exports (mo)','28','fa-file-export']],cols:['Report','Module','Type','Last Run','Owner'],rows:[['Collections vs Demand','CRM','Reconciliation','Today','You'],['Stock Variance','Inventory','Reconciliation','Yesterday','You']]},
  helpdesk:{icon:'fa-headset',c:'#0f766e',bg:'#f0fdfa',desc:'AI-assisted answers from the company knowledge base, with ticket fallback.',kpis:[['Open Tickets','3','fa-ticket'],['Resolved (mo)','41','fa-circle-check'],['KB Articles','58','fa-book'],['Avg. Response','12m','fa-stopwatch']],cols:['Ticket','Subject','Department','Status','Raised'],rows:[['HD-0091','VPN access','IT','Open','Today'],['HD-0090','Salary slip','HR','Resolved','Yesterday']]},
  gtd:{icon:'fa-brain',c:'#7c3aed',bg:'#f5f3ff',desc:'Getting Things Done — one trusted system: capture, clarify, organise, reflect, engage.',kpis:[['Inbox','9','fa-inbox'],['Next Actions','14','fa-bolt'],['Waiting On','5','fa-hourglass-half'],['Someday','21','fa-cloud']],cols:['Action','Context','Project','Due','Status'],rows:[['Finalise RERA filing','@office','Skyline','Today','Next'],['Call structural consultant','@calls','Riverdale','Tomorrow','Waiting'],['Review tender draft','@computer','Greenfield','2 days','Next']]},
  compliance:{icon:'fa-calendar-check',c:'#b45309',bg:'#fffbeb',desc:'Licences, RERA, NOCs, insurance & statutory renewals — never miss an expiry.',kpis:[['Active Licences','38','fa-id-badge'],['Due in 30d','6','fa-bell'],['Expired','1','fa-triangle-exclamation'],['Renewed (mo)','4','fa-rotate']],cols:['Item','Type','Authority','Expiry','Status'],rows:[['RERA — Skyline','Registration','MahaRERA','14 Aug','Active'],['Fire NOC — Greenfield','NOC','Fire Dept','02 Jul','Due Soon'],['Labour Licence','Statutory','Labour Dept','—','Expired']]},
  campaigns:{icon:'fa-bullhorn',c:'#db2777',bg:'#fdf2f8',desc:'Marketing campaign performance — channels, leads, cost per lead & ROAS.',kpis:[['Active Campaigns','5','fa-rectangle-ad'],['Leads (mo)','428','fa-user-plus'],['Cost / Lead','₹540','fa-indian-rupee-sign'],['ROAS','4.2x','fa-arrow-trend-up']],cols:['Campaign','Channel','Spend','Leads','CPL'],rows:[['Skyline Launch','Meta','₹3.2L','186','₹172'],['Festive Offer','Google','₹2.1L','142','₹148'],['Brand Awareness','Hoardings','₹1.8L','100','₹1800']]},
  scaling:{icon:'fa-arrow-trend-up',c:'#0d9488',bg:'#f0fdfa',desc:'Growth priorities, quarterly rocks, OKRs & execution rhythm.',kpis:[['Priorities','5','fa-flag'],['On Track','3','fa-circle-check'],['At Risk','1','fa-circle-exclamation'],['Quarter','Q2 FY27','fa-calendar']],cols:['Priority','Owner','Quarter','Progress','Status'],rows:[['Launch Riverdale Ph-1','Rishi','Q2','45%','On Track'],['Digitise procurement','Ops','Q2','70%','On Track'],['New CRM rollout','Sales','Q2','30%','At Risk']]},
  playbook:{icon:'fa-book-open',c:'#4338ca',bg:'#eef2ff',desc:'Standard operating procedures & process playbooks for every function.',kpis:[['Playbooks','22','fa-book'],['SOPs','146','fa-list-check'],['Owners','11','fa-user-gear'],['Updated (mo)','9','fa-pen']],cols:['Playbook','Department','Owner','Version','Updated'],rows:[['Site Handover','Projects','PMO','v3.1','Jun 2026'],['Lead to Booking','Sales','CRM Lead','v2.0','May 2026'],['Vendor Onboarding','Procurement','Purchase','v1.4','Jun 2026']]},
  intranet:{icon:'fa-landmark',c:'#0369a1',bg:'#f0f9ff',desc:'Company announcements, policies, quick links & the people directory.',kpis:[['Announcements','7','fa-bullhorn'],['Policies','34','fa-file-shield'],['Quick Links','19','fa-link'],['Birthdays','3','fa-cake-candles']],cols:['Item','Type','Posted by','Date','Pinned'],rows:[['Diwali holiday calendar','Notice','HR','24 Jun','Yes'],['Updated travel policy','Policy','Admin','20 Jun','No'],['New Mumbai office','Announcement','MD Office','18 Jun','Yes']]},
  training:{icon:'fa-graduation-cap',c:'#7c3aed',bg:'#f5f3ff',desc:'Courses, learning paths & certifications for every team.',kpis:[['Courses','28','fa-chalkboard'],['Enrolled','64','fa-user-graduate'],['Avg. Completion','71%','fa-percent'],['Certificates','42','fa-award']],cols:['Course','Category','Enrolled','Completion','Status'],rows:[['Site Safety L1','Safety','38','86%','Active'],['RERA Essentials','Compliance','22','64%','Active'],['Excel for PMO','Productivity','14','58%','Active']]},
  video:{icon:'fa-clapperboard',c:'#be123c',bg:'#fff1f2',desc:'Training videos, site walkthroughs & recorded sessions.',kpis:[['Videos','73','fa-film'],['Categories','9','fa-folder-tree'],['Views (mo)','1.2k','fa-eye'],['Hours','41','fa-clock']],cols:['Title','Category','Duration','Views','Added'],rows:[['Skyline drone walkthrough','Site','6:24','312','Jun 2026'],['How to raise an indent','SOP','3:10','188','Jun 2026'],['Safety induction','Safety','9:45','405','May 2026']]},
  customer:{icon:'fa-user-tie',c:'#1d4ed8',bg:'#eff4ff',desc:'Buyer self-service — bookings, payment schedule, documents & construction updates.',kpis:[['Customers','312','fa-users'],['Active Bookings','184','fa-file-signature'],['Payments Due','₹2.4 Cr','fa-clock'],['Open Tickets','7','fa-headset']],cols:['Customer','Unit','Stage','Next Due','Status'],rows:[['Rahul Mehta','Skyline A-1204','Booked','₹4.2L · 30 Jun','Active'],['Priya Shah','Greenfield B-803','Registered','—','Active'],['Amit Patel','Skyline A-905','Possession','—','Closed']]},
  supplier:{icon:'fa-truck',c:'#0f766e',bg:'#f0fdfa',desc:'Vendor self-service — POs, invoices, GRNs & payment status.',kpis:[['Suppliers','86','fa-store'],['Open POs','14','fa-file-invoice'],['Invoices Due','₹38L','fa-file-invoice-dollar'],['Pending GRN','3','fa-truck-ramp-box']],cols:['Supplier','PO No','Amount','Status','Due'],rows:[['ACC Cement','PO-0042','₹4.2L','Approved','01 Jul'],['Tata Steel','PO-0041','₹9.1L','Dispatched','28 Jun'],['Pidilite','PO-0040','₹1.3L','Paid','—']]},
  whatsapp:{icon:'fa-comment-dots',c:'#16a34a',bg:'#f0fdf4',desc:'Automated WhatsApp flows — lead capture, reminders & status updates.',kpis:[['Subscribers','1.9k','fa-address-book'],['Messages (mo)','8.4k','fa-paper-plane'],['Auto-replies','94%','fa-robot'],['Open Rate','72%','fa-envelope-open']],cols:['Flow','Trigger','Sent','Delivered','Replies'],rows:[['Payment reminder','Due date','420','410','96'],['Site visit confirm','Booking','188','185','142'],['New launch blast','Campaign','1900','1840','312']]},
  mail:{icon:'fa-envelope',c:'#475569',bg:'#f8fafc',desc:'Connected mailbox — unified inbox, flags & quick replies.',kpis:[['Unread','12','fa-envelope'],['Sent (mo)','248','fa-paper-plane'],['Flagged','5','fa-flag'],['Drafts','3','fa-pen']],cols:['From','Subject','Folder','Date','Status'],rows:[['MahaRERA','Filing acknowledgement','Compliance','Today','Unread'],['Tata Steel','Invoice INV-2291','Accounts','Today','Flagged'],['Rahul Mehta','Re: Possession date','Sales','Yesterday','Read']]},
  control:{icon:'fa-sliders',c:'#334155',bg:'#f1f5f9',locked:!state.super,desc:'System administration — users, roles, integrations & audit trail.',kpis:[['Users','8','fa-users'],['Roles','4','fa-user-shield'],['Integrations','6','fa-plug'],['Audit Events','1.4k','fa-clipboard-list']],cols:['Setting','Area','Value','Updated','By'],rows:[['SMTP provider','Email','Resend','Jun 2026','Admin'],['Storage','Files','Amazon S3','Jun 2026','Admin'],['Session timeout','Security','45 min','Jun 2026','Admin']]},
};

/* ---- per-module sub-tabs (reference-style tabbed pages) ---- */
const MODTABS={
  crm:[
    {t:'Pipeline',cols:['Lead','Project','Stage','Owner','Value'],rows:[['Rahul Mehta','Skyline','Site Visit','You','₹85L'],['Priya Shah','Greenfield','Negotiation','You','₹1.1Cr'],['Amit Patel','Skyline','Booking','You','₹92L']]},
    {t:'Bookings',cols:['Customer','Unit','Date','Value','Status'],rows:[['Amit Patel','Skyline A-905','24 Jun','₹92L','Confirmed'],['Sneha R.','Greenfield B-210','22 Jun','₹78L','Token']]},
    {t:'Collections',cols:['Customer','Due','Amount','Mode','Status'],rows:[['Rahul Mehta','30 Jun','₹4.2L','Cheque','Pending'],['Amit Patel','—','₹0','—','Cleared']]},
    {t:'Site Visits',cols:['Lead','Project','Slot','Owner','Status'],rows:[['Priya Shah','Greenfield','Sat 11 AM','You','Confirmed'],['New enquiry','Skyline','Sun 4 PM','You','Pending']]}],
  projects:[
    {t:'Towers & Units',cols:['Project','Tower','Units','Sold','Stage'],rows:[['Skyline','Tower A','48','31','RCC F12'],['Greenfield','Block B','36','28','Finishing']]},
    {t:'Construction Stages',cols:['Project','Stage','% Complete','Target','Status'],rows:[['Skyline','RCC','62%','Aug 26','On Track'],['Riverdale','Plinth','24%','Jul 26','Delayed']]},
    {t:'Work Orders',cols:['WO No','Contractor','Scope','Amount','Status'],rows:[['WO-118','Shree Const.','RCC F12','₹42L','Open'],['WO-117','Glaze India','Glazing','₹18L','Approved']]}],
  inventory:[
    {t:'Stock',cols:['Item','Category','In Stock','UoM','Value'],rows:[['OPC 53 Cement','Cement','420','Bags','₹1.6L'],['TMT 12mm','Steel','18','MT','₹9.2L']]},
    {t:'Indents',cols:['Indent','Project','Items','Raised by','Status'],rows:[['IND-204','Skyline','Cement x500','Site A','Pending'],['IND-203','Greenfield','Steel x20MT','Site B','Approved']]},
    {t:'GRNs',cols:['GRN','PO','Supplier','Date','Status'],rows:[['GRN-091','PO-0042','ACC Cement','26 Jun','Received'],['GRN-090','PO-0041','Tata Steel','25 Jun','QC Pending']]}],
  procurement:[
    {t:'Purchase Orders',cols:['PO No','Vendor','Amount','Status','Date'],rows:[['PO-0042','ACC Cement','₹4.2L','Pending','27 Jun'],['PO-0041','Tata Steel','₹9.1L','Approved','25 Jun']]},
    {t:'RFQs',cols:['RFQ','Item','Vendors','Best Quote','Status'],rows:[['RFQ-58','Tiles','4','₹3.1L','Open'],['RFQ-57','Paint','3','₹1.3L','Awarded']]},
    {t:'Vendors',cols:['Vendor','Category','Rating','Orders','Status'],rows:[['ACC Cement','Cement','4.6','42','Active'],['Tata Steel','Steel','4.8','31','Active']]}],
  finance:[
    {t:'Collections',cols:['Account','Project','Amount','Mode','Date'],rows:[['Skyline Collections','Skyline','₹42L','RTGS','26 Jun'],['Greenfield','Greenfield','₹28L','Cheque','25 Jun']]},
    {t:'Payables',cols:['Payee','Type','Amount','Due','Status'],rows:[['Shree Const.','Contractor','₹18L','28 Jun','Pending'],['Tata Steel','Supplier','₹9.1L','01 Jul','Scheduled']]},
    {t:'Project P&L',cols:['Project','Revenue','Cost','Margin','Status'],rows:[['Skyline','₹62Cr','₹44Cr','29%','Healthy'],['Riverdale','₹18Cr','₹15Cr','17%','Watch']]}],
  recruitment:[
    {t:'Openings',cols:['Role','Dept','Location','Applicants','Status'],rows:[['Site Engineer','Projects','Mumbai','18','Open'],['Accountant','Finance','Mumbai','12','Open']]},
    {t:'Applicants',cols:['Applicant','Role','Stage','Score','Status'],rows:[['Neha Verma','Site Engineer','Interview L2','82','Active'],['Karan Singh','Accountant','Shortlisted','—','Active']]},
    {t:'Interviews',cols:['Candidate','Role','Round','Date','Panel'],rows:[['Neha Verma','Site Engineer','L2','30 Jun','PMO'],['Rohit S.','Sales Exec','L1','01 Jul','Sales Head']]}],
  maintenance:[
    {t:'Assets',cols:['Asset','Category','Location','Next PM','Status'],rows:[['DG Set 250kVA','Electrical','Skyline','02 Jul','Active'],['Lift 1','Mechanical','Greenfield','—','Under Repair']]},
    {t:'PM Schedule',cols:['Asset','Frequency','Last PM','Next PM','Owner'],rows:[['DG Set','Monthly','02 Jun','02 Jul','Facility'],['STP','Weekly','24 Jun','01 Jul','Facility']]},
    {t:'Breakdowns',cols:['Ticket','Asset','Issue','Raised','Status'],rows:[['BD-22','Lift 1','Door fault','Today','Open'],['BD-21','Pump 3','Leak','Yesterday','Closed']]}],
  reports:[
    {t:'Dashboards',cols:['Report','Module','Type','Last Run','Owner'],rows:[['Collections vs Demand','CRM','Dashboard','Today','You'],['Stock Variance','Inventory','Dashboard','Yesterday','You']]},
    {t:'Reconciliations',cols:['Reconciliation','Module','Variance','Status','Run'],rows:[['Cash vs Ledger','Finance','₹0','Matched','Today'],['GRN vs PO','Procurement','2 items','Review','Today']]},
    {t:'Scheduled',cols:['Report','Frequency','Next Run','Format','Owner'],rows:[['MIS Pack','Weekly','Mon 9 AM','PDF','You'],['Sales Funnel','Daily','6 PM','Excel','Sales']]}],
  gtd:[
    {t:'Inbox',cols:['Item','Captured','Source','Clarify?','Status'],rows:[['Email from RERA','Today','Mail','Yes','New'],['Site note — crack A','Today','Site','Yes','New']]},
    {t:'Next Actions',cols:['Action','Context','Project','Due','Status'],rows:[['Finalise RERA filing','@office','Skyline','Today','Next'],['Call consultant','@calls','Riverdale','Tomorrow','Next']]},
    {t:'Waiting On',cols:['Item','Waiting on','Since','Project','Follow-up'],rows:[['Soil report','Geotech lab','3 days','Riverdale','Tomorrow'],['Loan sanction','HDFC','1 wk','—','Fri']]},
    {t:'Someday',cols:['Idea','Area','Added','Priority','Status'],rows:[['Clubhouse revamp','Skyline','Jun 26','Low','Parked'],['EV charging','All sites','Jun 26','Med','Parked']]}],
  compliance:[
    {t:'Licences',cols:['Item','Type','Authority','Expiry','Status'],rows:[['RERA — Skyline','Registration','MahaRERA','14 Aug','Active'],['Trade Licence','Statutory','BMC','30 Sep','Active']]},
    {t:'Renewals Due',cols:['Item','Expiry','Owner','Reminder','Status'],rows:[['Fire NOC','02 Jul','Admin','Sent','Due Soon'],['Insurance','18 Jul','Finance','Pending','Upcoming']]},
    {t:'NOCs',cols:['NOC','Project','Authority','Status','Date'],rows:[['Fire NOC','Greenfield','Fire Dept','Approved','Jun 26'],['Env NOC','Riverdale','SEIAA','In Process','—']]}],
  campaigns:[
    {t:'Campaigns',cols:['Campaign','Channel','Spend','Leads','CPL'],rows:[['Skyline Launch','Meta','₹3.2L','186','₹172'],['Festive Offer','Google','₹2.1L','142','₹148']]},
    {t:'Channels',cols:['Channel','Spend','Leads','CPL','ROAS'],rows:[['Meta','₹3.2L','186','₹172','4.6x'],['Google','₹2.1L','142','₹148','4.1x']]},
    {t:'Lead Sources',cols:['Source','Leads','Qualified','Booked','Conv%'],rows:[['Meta','186','92','11','5.9%'],['Portals','120','61','7','5.8%']]}],
  scaling:[
    {t:'Priorities',cols:['Priority','Owner','Quarter','Progress','Status'],rows:[['Launch Riverdale Ph-1','Rishi','Q2','45%','On Track'],['Digitise procurement','Ops','Q2','70%','On Track']]},
    {t:'OKRs',cols:['Objective','Key Result','Owner','Target','Progress'],rows:[['Grow bookings','+25% QoQ','Sales','25%','12%'],['Cut cycle time','-15%','Ops','15%','9%']]},
    {t:'Quarterly Rocks',cols:['Rock','Owner','Due','Health','Status'],rows:[['CRM rollout','Sales','Q2','Yellow','At Risk'],['Vendor portal','Procurement','Q2','Green','On Track']]}],
  playbook:[
    {t:'Playbooks',cols:['Playbook','Department','Owner','Version','Updated'],rows:[['Site Handover','Projects','PMO','v3.1','Jun 26'],['Lead to Booking','Sales','CRM Lead','v2.0','May 26']]},
    {t:'SOPs',cols:['SOP','Process','Owner','Version','Status'],rows:[['Indent raising','Procurement','Purchase','v1.4','Active'],['Visitor entry','Admin','Security','v1.1','Active']]},
    {t:'Checklists',cols:['Checklist','Frequency','Owner','Items','Status'],rows:[['Site safety','Daily','Site','18','Active'],['Sales kit','Per lead','Sales','9','Active']]}],
  intranet:[
    {t:'Announcements',cols:['Title','Type','Posted by','Date','Pinned'],rows:[['Diwali calendar','Notice','HR','24 Jun','Yes'],['New Mumbai office','News','MD Office','18 Jun','Yes']]},
    {t:'Policies',cols:['Policy','Category','Owner','Version','Updated'],rows:[['Travel policy','HR','Admin','v2','Jun 26'],['IT usage','IT','IT','v1.3','May 26']]},
    {t:'Directory',cols:['Name','Department','Designation','Location','Ext'],rows:[['Rishi Jain','Management','Director','HO','101'],['Prerna Gupta','Strategy','Business Analyst','HO','118']]}],

  video:[
    {t:'All Videos',cols:['Title','Category','Duration','Views','Added'],rows:[['Skyline drone walkthrough','Site','6:24','312','Jun 26'],['How to raise an indent','SOP','3:10','188','Jun 26']]},
    {t:'Categories',cols:['Category','Videos','Views','Hours','Updated'],rows:[['Site','22','540','4.1','Jun 26'],['SOP','18','410','2.8','Jun 26']]},
    {t:'Playlists',cols:['Playlist','Videos','For','Views','Status'],rows:[['Onboarding','6','New joiners','220','Active'],['Safety','9','Site staff','405','Active']]}],
  customer:[
    {t:'My Bookings',cols:['Customer','Unit','Stage','Next Due','Status'],rows:[['Rahul Mehta','Skyline A-1204','Booked','₹4.2L · 30 Jun','Active'],['Priya Shah','Greenfield B-803','Registered','—','Active']]},
    {t:'Payments',cols:['Customer','Milestone','Amount','Due','Status'],rows:[['Rahul Mehta','On RCC F10','₹4.2L','30 Jun','Pending'],['Amit Patel','On Possession','₹6.0L','—','Upcoming']]},
    {t:'Documents',cols:['Customer','Document','Type','Shared','Status'],rows:[['Rahul Mehta','Allotment Letter','PDF','24 Jun','Available'],['Priya Shah','Agreement','PDF','—','Pending']]}],
  supplier:[
    {t:'Purchase Orders',cols:['Supplier','PO No','Amount','Status','Due'],rows:[['ACC Cement','PO-0042','₹4.2L','Approved','01 Jul'],['Tata Steel','PO-0041','₹9.1L','Dispatched','28 Jun']]},
    {t:'Invoices',cols:['Supplier','Invoice','Amount','Status','Due'],rows:[['Tata Steel','INV-2291','₹9.1L','Submitted','10 Jul'],['Pidilite','INV-2287','₹1.3L','Paid','—']]},
    {t:'GRNs',cols:['GRN','PO','Items','Date','Status'],rows:[['GRN-091','PO-0042','Cement x500','26 Jun','Accepted'],['GRN-090','PO-0041','Steel x20MT','25 Jun','QC Pending']]}],
  whatsapp:[
    {t:'Flows',cols:['Flow','Trigger','Sent','Delivered','Replies'],rows:[['Payment reminder','Due date','420','410','96'],['Site visit confirm','Booking','188','185','142']]},
    {t:'Broadcasts',cols:['Broadcast','Audience','Sent','Read','Date'],rows:[['New launch blast','All leads','1900','1368','24 Jun'],['Festive offer','Customers','820','602','20 Jun']]},
    {t:'Subscribers',cols:['Name','Number','Tag','Opted In','Last Msg'],rows:[['Rahul Mehta','+91•••210','Lead','Yes','Today'],['Amit Patel','+91•••884','Customer','Yes','2 days']]}],
  mail:[
    {t:'Inbox',cols:['From','Subject','Folder','Date','Status'],rows:[['MahaRERA','Filing acknowledgement','Compliance','Today','Unread'],['Tata Steel','Invoice INV-2291','Accounts','Today','Flagged']]},
    {t:'Sent',cols:['To','Subject','Folder','Date','Status'],rows:[['Rahul Mehta','Possession date','Sales','Today','Sent'],['Shree Const.','WO-118 approval','Projects','Yesterday','Sent']]},
    {t:'Flagged',cols:['From','Subject','Reason','Date','Status'],rows:[['Tata Steel','Invoice INV-2291','Payment due','Today','Open'],['HDFC','Loan sanction','Follow-up','Yesterday','Open']]}],
  control:[
    {t:'Users',cols:['User','Email','Level','Tabs','Status'],rows:[['Administrator','ayushruia1@…','Manager','All','Active'],['Prerna Gupta','businessanalyst@…','Employee','12','Active']]},
    {t:'Roles & Access',cols:['Role','Members','Modules','Scope','Status'],rows:[['Manager','3','All','Company','Active'],['Employee','5','Assigned','Dept','Active']]},
    {t:'Integrations',cols:['Integration','Type','Status','Updated','By'],rows:[['Resend','Email','Connected','Jun 26','Admin'],['Amazon S3','Storage','Connected','Jun 26','Admin']]},
    {t:'Audit Log',cols:['Event','User','Module','Time','IP'],rows:[['Access updated','Administrator','Security','10:24','•••'],['Login','Prerna Gupta','Auth','09:50','•••']]}],
};

MODMETA.construction=MODMETA.projects;MODTABS.construction=MODTABS.projects;
VIEWS.placeholder=function(v,seg){
  const mod=PAGE;const m=MODMETA[mod];
  if(!m){v.innerHTML='<div class="empty"><i class="fa-solid fa-cube"></i><div>Module not found</div></div>';return;}
  setCrumb(['Home',LABELS[mod]||mod]);
  if(m.locked){
    v.innerHTML='<div class="page-head"><div><h1><i class="fa-solid '+m.icon+'" style="color:'+m.c+'"></i> '+(LABELS[mod])+'</h1><p>'+m.desc+'</p></div></div>'+
    '<div class="card card-pad empty"><i class="fa-solid fa-lock"></i><div style="font-weight:600;font-size:15px;color:var(--ink)">Restricted Module</div><p style="max-width:420px;margin:8px auto 0">This is a director-only area. Your account does not have super-admin access. Contact a director to request access.</p></div>';
    return;
  }
  const tabs=MODTABS[mod]||[{t:'Recent Records',cols:m.cols,rows:m.rows}];
  let ti=parseInt((seg&&seg[0]));if(isNaN(ti)||ti<0||ti>=tabs.length)ti=0;
  const tab=tabs[ti];
  v.innerHTML='<div class="page-head"><div><h1><i class="fa-solid '+m.icon+'" style="color:'+m.c+'"></i> '+(LABELS[mod])+'</h1><p>'+m.desc+'</p></div>'+
   '<div style="display:flex;gap:10px"><button class="btn"><i class="fa-solid fa-filter"></i> Filter</button><button class="btn btn-primary"><i class="fa-solid fa-plus"></i> New</button></div></div>'+
   '<div class="grid kpis">'+m.kpis.map(k=>'<div class="kpi"><div class="top"><div class="ic" style="background:'+m.bg+';color:'+m.c+'"><i class="fa-solid '+k[2]+'"></i></div></div><div class="val">'+k[1]+'</div><div class="lbl">'+k[0]+'</div></div>').join('')+'</div>'+
   '<div class="tabs" style="margin-top:18px;margin-bottom:0">'+tabs.map((x,i)=>'<div class="tab '+(i===ti?'active':'')+'" onclick="navTo(\''+mod+'/'+i+'\')">'+esc(x.t)+'</div>').join('')+'</div>'+
   '<div class="card" style="border-top-left-radius:0"><div class="card-pad" style="border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center"><div class="sec-title" style="margin:0">'+esc(tab.t)+'</div><span class="tag t-blue"><i class="fa-solid fa-circle-info"></i> Sample data</span></div>'+
   '<table><thead><tr>'+tab.cols.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+tab.rows.map(r=>'<tr>'+r.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
};
['construction','procurement','reports'].forEach(m=>VIEWS[m]=VIEWS.placeholder);

/* ============================ DOCUMENTS ENGINE (shared by Documents + Legal) ============================ */
const DEPARTMENTS=['Administration','HR','Legal','Finance','Systems','Sales','Operations','Marketing','IT','Maintenance','Purchase','Pre Sales','Post Sales','CP Sales','Accounts','Management'];
const DEPT_META={Administration:['fa-landmark','#475569','#f1f5f9'],HR:['fa-users','#be123c','#fff1f2'],Legal:['fa-scale-balanced','#1e3a8a','#eff4ff'],Finance:['fa-indian-rupee-sign','#15803d','#f0fdf4'],CRM:['fa-handshake','#7c3aed','#f5f3ff'],Sales:['fa-tags','#c2410c','#fff7ed'],Construction:['fa-helmet-safety','#b45309','#fffbeb'],Procurement:['fa-cart-shopping','#0369a1','#f0f9ff'],Inventory:['fa-boxes-stacked','#0f766e','#f0fdfa'],Marketing:['fa-bullhorn','#db2777','#fdf2f8'],IT:['fa-laptop-code','#4f46e5','#eef2ff'],Maintenance:['fa-screwdriver-wrench','#7c3aed','#f5f3ff'],Systems:['fa-server','#0e7490','#ecfeff'],Operations:['fa-gears','#a16207','#fefce8'],Purchase:['fa-basket-shopping','#1d4ed8','#eff6ff'],'Pre Sales':['fa-chart-line','#059669','#ecfdf5'],'Post Sales':['fa-headset','#7e22ce','#faf5ff'],'CP Sales':['fa-handshake-angle','#c026d3','#fdf4ff'],Accounts:['fa-calculator','#4d7c0f','#f7fee7'],Management:['fa-briefcase','#334155','#f8fafc']};
const LEGAL_CATS=['Land Documents','Title Deeds','Sale Deeds','Lease Agreements','Joint Development Agreements','Joint Venture Agreements','Contracts','Government Approvals','Building Plan Approvals','RERA Documents','NOCs','Property Tax Records','Court Cases','Legal Notices','Compliance Documents','Templates','Archive'];
const VIS=['Public','Internal','Restricted'];
const DOCSTATUS=['Active','Draft','Archived'];
function bucketFor(dept){return dept==='Legal'?'legal-docs':'documents';}

// Resumable TUS upload for large files (>6MB), standard for small
async function uploadFileToStorage(bucket,path,file,onProgress){
  const CHUNK=6*1024*1024;// 6MB chunks
  if(file.size<=CHUNK){
    // Small file — standard single-request upload
    return sb.storage.from(bucket).upload(path,file,{cacheControl:'3600',upsert:false});
  }
  // Large file — TUS resumable upload via Supabase native endpoint
  const tus=await loadTusJs();if(!tus)return {error:{message:'TUS library failed to load'}};
  const {data:{session}}=await sb.auth.getSession();
  const token=session&&session.access_token;
  if(!token)return {error:{message:'Not authenticated'}};
  return new Promise(resolve=>{
    const up=new tus.Upload(file,{
      endpoint:SUPABASE_URL+'/storage/v1/upload/resumable',
      retryDelays:[0,3000,5000,10000,20000],
      headers:{authorization:'Bearer '+token,'x-upsert':'false'},
      uploadDataDuringCreation:true,
      removeFingerprintOnSuccess:true,
      metadata:{bucketName:bucket,objectName:path,contentType:file.type||'application/octet-stream',cacheControl:'3600'},
      chunkSize:CHUNK,
      onProgress:function(uploaded,total){if(onProgress)onProgress(Math.round(uploaded/total*100));},
      onError:function(e){resolve({data:null,error:{message:e.message||String(e)}});},
      onSuccess:function(){resolve({data:{path},error:null});},
    });
    up.start();
  });
}

/* ---- S3 (private bucket, presigned URLs via the `s3-sign` edge function) ---- */
async function s3Sign(action,key){
  const {data:{session}}=await sb.auth.getSession();
  const token=session&&session.access_token;
  if(!token)return {error:{message:'Not authenticated'}};
  try{
    const res=await fetch(SUPABASE_URL+'/functions/v1/s3-sign',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'apikey':SUPABASE_KEY},
      body:JSON.stringify({action,key})
    });
    const out=await res.json().catch(()=>({}));
    if(!res.ok||out.error)return {error:{message:out.error||('s3-sign '+res.status)}};
    return {data:out};
  }catch(e){return {error:{message:String(e)}};}
}
function isS3Path(p){return typeof p==='string'&&p.indexOf('s3:')===0;}
/* ---------- canonical S3 hierarchy ----------
   portal/documents/<Department>/...            Document Library + Procurement (non-Legal)
   portal/accountability/tasks/<taskId>/...      Task attachments (legacy nexus-core task system)
   portal/accountability/delegation/<taskId>/... Delegated-task attachments (legacy nexus-core task system)
   portal/accountability/ptasks/<taskId>/...     Task attachments (live Accountability module, accountability.js)
   portal/defect-img/...                         Inspection defect photos
   portal/hr/resumes/...                         Resumes
   portal/recruitment/descriptions/...           Job Descriptions
   legal/<category path>/...                     Legal Vault (own top-level root, NOT under portal/)
   portal/postsales/adhoc/...                    Post Sales ADHOC-replace converted output files
------------------------------------------------- */
function s3Stamp(){return Date.now()+'_'+Math.random().toString(36).slice(2,7);}
function s3SafeName(name){return String(name||'file').replace(/[^\w.\-]/g,'_');}
function s3SafeSeg(seg){return String(seg||'').trim().replace(/[^\w.\- ]/g,'_');}
function s3KeyForDoc(dept,catPath,filename){
  const stamp=s3Stamp(),name=s3SafeName(filename);
  if(dept==='Legal'){
    // catPath must be an ARRAY of folder-name segments (e.g. ['Dream Palazzo','History of Land / Chain']).
    // Never split a joined display string here — category names can themselves contain '/', which
    // would corrupt the S3 path (e.g. "History of Land / Chain" would wrongly split into 2 segments).
    const arr=Array.isArray(catPath)?catPath:[catPath];
    const segs=arr.map(s=>s3SafeSeg(s)).filter(Boolean);
    return 'legal/'+(segs.length?segs.join('/')+'/':'')+stamp+'_'+name;
  }
  return `documents/${s3SafeSeg(dept)}/${stamp}_${name}`;
}
function s3KeyForTask(taskId,isDelegation,filename){
  return `accountability/${isDelegation?'delegation':'tasks'}/${s3Stamp()}_${s3SafeName(filename)}`;
}
function s3KeyForProject(projectId,filename){
  return `accountability/projects/${projectId}/${s3Stamp()}_${s3SafeName(filename)}`;
}
function s3KeyForGoal(goalId,filename){
  return `accountability/goals/${goalId}/${s3Stamp()}_${s3SafeName(filename)}`;
}
function s3KeyForPTask(taskId,filename){
  return `accountability/ptasks/${taskId}/${s3Stamp()}_${s3SafeName(filename)}`;
}
function s3KeyForResume(filename){return `hr/resumes/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForJD(filename){return `recruitment/descriptions/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForDefectImg(filename){return `defect-img/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForPostSalesAdhoc(filename){return `postsales/adhoc/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForTranscription(filename){return `transcription/${s3Stamp()}_${s3SafeName(filename)}`;}
async function uploadFileToS3(key,file,onProgress){
  const {data,error}=await s3Sign('put',key);
  if(error)return {error};
  return new Promise(resolve=>{
    const xhr=new XMLHttpRequest();
    xhr.open('PUT',data.url,true);
    xhr.setRequestHeader('Content-Type',file.type||'application/octet-stream');
    xhr.upload.onprogress=function(e){if(onProgress&&e.lengthComputable)onProgress(Math.round(e.loaded/e.total*100));};
    xhr.onload=function(){
      if(xhr.status>=200&&xhr.status<300)resolve({data:{path:'s3:'+data.key},error:null});
      else resolve({data:null,error:{message:'S3 upload failed (HTTP '+xhr.status+')'}});
    };
    xhr.onerror=function(){resolve({data:null,error:{message:'S3 upload network error'}});};
    xhr.send(file);
  });
}
async function s3OpenSigned(storagePath,downloadName){
  const key=storagePath.slice(3);
  const {data,error}=await s3Sign('get',key);
  if(error){toast('Could not open file: '+error.message,'err');return;}
  if(downloadName){const a=document.createElement('a');a.href=data.url;a.download=downloadName;document.body.appendChild(a);a.click();a.remove();}
  else window.open(data.url,'_blank');
}
async function s3Delete(storagePath){
  const key=storagePath.slice(3);
  const {data,error}=await s3Sign('delete',key);
  if(error||!data)return;
  try{await fetch(data.url,{method:'DELETE'});}catch(e){/* best-effort */}
}
const DOC={dept:null,cat:null,q:'',sort:'created_at.desc',page:1,per:10,sel:new Set(),scope:'documents',legalExpanded:new Set()};

// `full` pulls content_text too — needed only by the re-index staleness check (docReindexAll),
// which needs to know how much text a doc already has. Every other caller only renders
// title/category/size/etc., so leaving content_text out saves dragging up to ~400KB of OCR text
// per row (Legal has hundreds of OCR'd PDFs now) across the wire just to draw a file list.
const DOC_LIST_COLS='id,doc_no,title,register_code,department,doc_type,version,tags,storage_path,link,status,confidential,uploaded_by,created_at,category,subcategory,description,file_name,file_size,file_type,visibility,pinned,folder,updated_at,folder_id';
async function docFetch({dept,cat,q,extraNonLegal,folderId,folderIds,full}={}){
  const [col,dir]=DOC.sort.split('.');
  const build=()=>{
    let qb=sb.schema('doc').from('documents').select(full?'*':DOC_LIST_COLS);
    if(dept)qb=qb.eq('department',dept);
    if(extraNonLegal)qb=qb.neq('department','Legal');
    if(cat)qb=qb.eq('category',cat);
    if(folderIds&&folderIds.length)qb=qb.in('folder_id',folderIds);
    else if(folderId)qb=qb.eq('folder_id',folderId);
    if(q){
      const t=q.trim().replace(/\s+/g,' ').trim();
      if(DOC.scope==='legal'){
        qb=qb.or('file_name.ilike.%'+t+'%,title.ilike.%'+t+'%,doc_no.ilike.%'+t+'%,content_text.ilike.%'+t+'%');
      } else {
        qb=qb.or('file_name.ilike.%'+t+'%,title.ilike.%'+t+'%,doc_no.ilike.%'+t+'%');
      }
    }
    return qb.order(col,{ascending:dir==='asc'});
  };
  // Supabase caps a plain select at ~1000 rows by default, which was silently truncating cross-department
  // fetches (company now has 1000+ documents) and undercounting things downstream. Page through with
  // .range() until a short page comes back so every matching row is actually returned.
  let all=[],from=0;const PAGE=1000;
  while(true){
    const {data,error}=await build().range(from,from+PAGE-1);
    if(error){toast('Load failed: '+error.message,'err');break;}
    all=all.concat(data||[]);
    if(!data||data.length<PAGE)break;
    from+=PAGE;
  }
  return all;
}

/* ---------- DOCUMENTS module ---------- */
VIEWS.documents=function(v,seg){
  DOC.scope='documents';DOC.sel.clear();
  if(seg[0]==='dept'){
    const d=decodeURIComponent(seg[1]);
    if(d==='Legal'){ navTo('legal'); return; } // Legal has its own hierarchical module — the generic library here is a flat list and doesn't match Legal's folder-tree data model. navTo (not a raw hash change) is required since Documents and Legal are separate pages.
    DOC.dept=d;DOC.cat=null;return docLibrary(v);
  }
  if(seg[0]==='search'){DOC.q=decodeURIComponent(seg[1]||'');DOC.dept=null;return docAll(v,'Search: "'+DOC.q+'"');}
  if(seg[0]==='all'){DOC.dept=null;DOC.q='';return docAll(v,'All Documents');}
  DOC.dept=null;DOC.q='';return docHome(v);
};

async function docHome(v){
  setCrumb(['Documents','Libraries']);
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-folder-open" style="color:#1d4ed8"></i> Document Management</h1><p>Google Drive-style libraries for every department · stored securely in Supabase</p></div>
    <div style="display:flex;gap:10px"><button class="btn" onclick="location.hash='#/documents/all'"><i class="fa-solid fa-table-list"></i> All Documents</button>
    <button class="btn btn-primary" onclick="docUploadModal()"><i class="fa-solid fa-upload"></i> Upload</button></div></div>
    <div class="grid kpis" id="docKpis"></div>
    <div style="margin:22px 0 10px" class="sec-title">Department Libraries</div>
    <div class="grid lib-grid" id="libGrid"></div>
    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:22px">
      <div class="card card-pad"><div class="sec-title"><i class="fa-solid fa-thumbtack" style="color:#d97706"></i> Pinned</div><div class="sec-sub">Quick-access documents</div><div id="pinned"></div></div>
      <div class="card card-pad"><div class="sec-title"><i class="fa-solid fa-clock-rotate-left" style="color:#1d4ed8"></i> Recently Uploaded</div><div class="sec-sub">Latest across all libraries</div><div id="recent"></div></div>
    </div>`;
  // Company-wide totals can run past Supabase's default row cap on a plain select, which was silently
  // truncating "all" and undercounting departments/KPIs (e.g. Finance showing 5 instead of its real 155).
  // Exact counts (head:true) and a DB-side sum RPC sidestep that cap entirely instead of pulling every row.
  const deptCounts={};
  await Promise.all(DEPARTMENTS.map(async d=>{
    const {count}=await sb.schema('doc').from('documents').select('*',{count:'exact',head:true}).eq('department',d);
    deptCounts[d]=count||0;
  }));
  const [{count:total},{count:active},{count:restricted},{data:sizeData},{data:pinnedRows},{data:recentRows}]=await Promise.all([
    sb.schema('doc').from('documents').select('*',{count:'exact',head:true}),
    sb.schema('doc').from('documents').select('*',{count:'exact',head:true}).eq('status','Active'),
    sb.schema('doc').from('documents').select('*',{count:'exact',head:true}).eq('visibility','Restricted'),
    sb.schema('doc').rpc('total_storage_bytes'),
    sb.schema('doc').from('documents').select('*').eq('pinned',true).order('created_at',{ascending:false}).limit(5),
    sb.schema('doc').from('documents').select('*').order('created_at',{ascending:false}).limit(5)
  ]);
  const size=sizeData||0;
  $('docKpis').innerHTML=[['Total Documents',total||0,'fa-file-lines','#eff4ff','#1d4ed8'],['Active',active||0,'fa-circle-check','#f0fdf4','#16a34a'],['Restricted',restricted||0,'fa-lock','#fef2f2','#dc2626'],['Storage Used',fmtBytes(size),'fa-database','#f5f3ff','#7c3aed']].map(k=>`<div class="kpi"><div class="top"><div class="ic" style="background:${k[3]};color:${k[4]}"><i class="fa-solid ${k[2]}"></i></div></div><div class="val">${k[1]}</div><div class="lbl">${k[0]}</div></div>`).join('');
  $('libGrid').innerHTML=DEPARTMENTS.map(d=>{const m=DEPT_META[d]||['fa-folder','#64748b','#f1f5f9'];const c=deptCounts[d]||0;return `<div class="lib-card" onclick="location.hash='#/documents/dept/${encodeURIComponent(d)}'"><div class="ic" style="background:${m[2]};color:${m[1]}"><i class="fa-solid ${m[0]}"></i></div><div class="nm">${d}</div><div class="ct">${c} document${c===1?'':'s'}</div></div>`;}).join('');
  const pinned=pinnedRows||[];
  $('pinned').innerHTML=pinned.length?pinned.map(d=>docRowMini(d)).join(''):'<div class="empty" style="padding:24px"><i class="fa-regular fa-star"></i><div>No pinned documents</div></div>';
  $('recent').innerHTML=(recentRows||[]).map(d=>docRowMini(d)).join('');
}
function docRowMini(d){return `<div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--line-2);cursor:pointer" onclick="docPreview(${d.id})">${fileIcon(d.file_type)}<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.title)}</div><div style="color:var(--slate);font-size:11.5px">${esc(d.department)} · ${esc(d.category||'—')} · ${relTime(d.created_at)}</div></div></div>`;}

async function getFolders(dept){
  try{const {data}=await sb.schema('doc').from('folders').select('name').eq('department',dept).order('name');return (data||[]).map(f=>f.name);}catch(e){return [];}
}

/* ---------- Legal category tree (hierarchical, unlimited depth, Legal-only) ---------- */
async function legalFolderTree(){
  const {data}=await sb.schema('doc').from('folders').select('id,name,parent_id').eq('department','Legal');
  return data||[];
}
function buildFolderTree(list){
  const byId={};list.forEach(f=>byId[f.id]={...f,children:[]});
  const roots=[];
  list.forEach(f=>{const node=byId[f.id];if(f.parent_id&&byId[f.parent_id])byId[f.parent_id].children.push(node);else roots.push(node);});
  const sortRec=arr=>{arr.sort((a,b)=>a.name.localeCompare(b.name));arr.forEach(n=>sortRec(n.children));};
  sortRec(roots);
  return {roots,byId};
}
function folderPath(byId,id){
  const path=[];let cur=byId[id];
  while(cur){path.unshift(cur.name);cur=cur.parent_id?byId[cur.parent_id]:null;}
  return path;
}
function flattenTreeOptions(nodes,depth,out){
  out=out||[];
  nodes.forEach(n=>{out.push({id:n.id,label:(depth?'— '.repeat(depth):'')+n.name});flattenTreeOptions(n.children,depth+1,out);});
  return out;
}
// Every id in the subtree rooted at rootId (inclusive) — used so selecting a parent
// folder shows documents filed anywhere underneath it, not just directly on it.
function collectDescendantIds(byId,rootId){
  const out=[rootId];
  const node=byId[rootId];
  if(node)node.children.forEach(c=>{out.push(...collectDescendantIds(byId,c.id));});
  return out;
}
async function docLibrary(v){
  const dept=DOC.dept;const m=DEPT_META[dept]||['fa-folder','#64748b','#f1f5f9'];
  setCrumb(['Documents',dept]);
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid ${m[0]}" style="color:${m[1]}"></i> ${esc(dept)} Library</h1><p>Folder navigation, categories & version-controlled storage</p></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" onclick="location.hash='#/documents'"><i class="fa-solid fa-arrow-left"></i> Libraries</button>
    <button class="btn" onclick="docNewFolder('${esc(dept)}')"><i class="fa-solid fa-folder-plus"></i> New Folder</button>
    <button class="btn btn-primary" onclick="docUploadModal('${esc(dept)}')"><i class="fa-solid fa-upload"></i> Upload</button></div></div>
    <div class="split"><div><div class="subnav" id="catNav"></div></div><div><div id="docTableHost"></div></div></div>`;
  const all=await docFetch({dept});
  const folders=await getFolders(dept);
  const cats={};all.forEach(d=>cats[d.category||'Uncategorised']=(cats[d.category||'Uncategorised']||0)+1);
  folders.forEach(f=>{if(!(f in cats))cats[f]=0;});
  const catList=Object.keys(cats).sort();
  $('catNav').innerHTML=`<div class="sn-title">Folders</div>`+
    `<div class="sn-item ${!DOC.cat?'active':''}" onclick="docPickCat(null)"><span><i class="fa-regular fa-folder-open"></i> All</span><span class="ct">${all.length}</span></div>`+
    catList.map(c=>`<div class="sn-item ${DOC.cat===c?'active':''}" onclick="docPickCat('${esc(c).replace(/'/g,"\\'")}')"><span><i class="fa-regular fa-folder"></i> ${esc(c)}</span><span class="ct">${cats[c]}</span></div>`).join('')+
    `<div class="sn-item" style="color:var(--brand)" onclick="docNewFolder('${esc(dept)}')"><span><i class="fa-solid fa-plus"></i> New folder</span></div>`;
  docRenderTable($('docTableHost'),dept);
}
window.docNewFolder=async function(dept,parentId,parentLabel){
  const isLegal=dept==='Legal';
  const title=isLegal?(parentLabel?'Add category in '+esc(parentLabel):'Add main folder in Legal'):('New folder in '+esc(dept));
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-folder-plus"></i> ${title}</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><label>${isLegal?'Category':'Folder / category'} name</label><input id="nfName" placeholder="e.g. Bank Guarantees"></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="docNewFolderSave('${esc(dept)}',${parentId!=null?parentId:'null'})">Create</button></div>`);
  setTimeout(()=>{var n=$('nfName');if(n){n.focus();n.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();docNewFolderSave(dept,parentId!=null?parentId:null);}};}},50);
};
window.docNewFolderSave=async function(dept,parentId){
  const name=$('nfName').value.trim();if(!name){toast('Enter a name','err');return;}
  const payload={department:dept,name,created_by:state.email};
  if(dept==='Legal')payload.parent_id=parentId||null;
  const {data,error}=await sb.schema('doc').from('folders').insert(payload).select('id').single();
  if(error){toast(/duplicate|unique/i.test(error.message)?'A category with that name already exists here':error.message,'err');return;}
  closeModal();toast(dept==='Legal'?'Category created':'Folder created','ok');
  if(dept==='Legal'){ if(parentId)DOC.legalExpanded.add(parentId); location.hash='#/legal/cat/'+data.id; } else { DOC.cat=name;route(); }
};
window.docPickCat=function(c){DOC.cat=c;DOC.page=1;document.querySelectorAll('#catNav .sn-item').forEach(x=>x.classList.remove('active'));docRenderTable($('docTableHost'),DOC.dept);
  // re-highlight
  const items=[...document.querySelectorAll('#catNav .sn-item')];items.forEach(it=>{const t=it.querySelector('span').textContent.trim();if((c===null&&t==='All')||(c&&t.replace(/^.*?\s/,'')===c)) it.classList.add('active');});};

async function docAll(v,title){
  setCrumb(['Documents',title]);
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-table-list" style="color:#1d4ed8"></i> ${esc(title)}</h1><p>Search and manage documents across every department</p></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" onclick="location.hash='#/documents'"><i class="fa-solid fa-arrow-left"></i> Libraries</button>
    <button class="btn btn-primary" onclick="docUploadModal()"><i class="fa-solid fa-upload"></i> Upload</button></div></div>
    <div id="docTableHost"></div>`;
  docRenderTable($('docTableHost'),null);
}

async function docRenderTable(host,dept){
  loader(host);
  let legalFolderIds=null;
  if(DOC.scope==='legal'&&DOC.cat){
    const list=await legalFolderTree();
    const {byId}=buildFolderTree(list);
    legalFolderIds=collectDescendantIds(byId,Number(DOC.cat));
  }
  const rows=await docFetch({dept:DOC.scope==='legal'?'Legal':dept,cat:DOC.scope==='legal'?null:DOC.cat,folderIds:legalFolderIds,q:DOC.q});
  // toolbar
  const toolbar=`<div class="toolbar">
    <div class="grow"><i class="fa-solid fa-magnifying-glass"></i><input id="dtSearch" placeholder="${DOC.scope==='legal'?'Search by name or keyword inside file…':'Search by file name or title…'}" value="${esc(DOC.q)}"></div>
    <button class="btn" id="dtSearchBtn"><i class="fa-solid fa-magnifying-glass"></i> Search</button>
    ${DOC.q?`<button class="btn" id="dtClear" onclick="DOC.q='';docRenderTable(document.getElementById('docTableHost'),${dept?("'"+esc(dept)+"'"):'null'})"><i class="fa-solid fa-xmark"></i> Clear</button>`:''}
    <select class="sel" id="dtSort">
      <option value="created_at.desc">Newest first</option><option value="created_at.asc">Oldest first</option>
      <option value="title.asc">Title A–Z</option><option value="title.desc">Title Z–A</option>
      <option value="file_size.desc">Largest</option></select>
    <select class="sel" id="dtStatus"><option value="">All status</option>${DOCSTATUS.map(s=>'<option>'+s+'</option>').join('')}</select>
    <button class="btn" id="dtBulkDl" disabled><i class="fa-solid fa-download"></i> Download</button>
    <button class="btn btn-danger" id="dtBulkDel" disabled><i class="fa-solid fa-trash"></i> Delete</button>
  </div>`;
  let filtered=rows;
  const stEl=()=>$('dtStatus')?$('dtStatus').value:'';
  const draw=()=>{
    const st=stEl();
    let list=rows.filter(r=>!st||r.status===st);
    const start=(DOC.page-1)*DOC.per;const pageRows=list.slice(start,start+DOC.per);
    const totalPages=Math.max(1,Math.ceil(list.length/DOC.per));
    const body=pageRows.length?pageRows.map(d=>{
      const sel=DOC.sel.has(d.id);
      return `<tr>
        <td><input type="checkbox" class="checkbox dtChk" data-id="${d.id}" ${sel?'checked':''}></td>
        <td><div style="display:flex;align-items:center;gap:11px">${fileIcon(d.file_type)}<div style="min-width:0"><div style="font-weight:600;cursor:pointer" onclick="docPreview(${d.id})">${esc(d.title)} ${d.pinned?'<i class="fa-solid fa-thumbtack" style="color:#d97706;font-size:11px"></i>':''}</div><div style="color:var(--slate);font-size:11.5px">${esc(d.doc_no||'')} · ${esc(d.file_name||'')}</div></div></div></td>
        <td>${esc(d.category||'—')}</td>
        <td><span class="tag t-gray">${esc((d.file_type||'').toUpperCase())}</span></td>
        <td>${fmtBytes(d.file_size)}</td>
        <td><span class="tag ${d.visibility==='Restricted'?'t-red':d.visibility==='Public'?'t-green':'t-blue'}">${esc(d.visibility||'Internal')}</span></td>
        <td>v${esc((d.version||'1').replace('v',''))}</td>
        <td>${statusTag(d.status)}</td>
        <td>${fmtDate(d.created_at)}</td>
        <td style="text-align:right"><button class="btn btn-sm btn-ghost" onclick="docMenu(event,${d.id})"><i class="fa-solid fa-ellipsis-vertical"></i></button></td>
      </tr>`;}).join(''):`<tr><td colspan="10"><div class="empty"><i class="fa-regular fa-folder-open"></i><div>No documents found</div><button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="docUploadModal('${dept?esc(dept):''}')"><i class="fa-solid fa-upload"></i> Upload a document</button></div></td></tr>`;
    host.innerHTML=toolbar+`<div class="card"><table><thead><tr>
      <th style="width:38px"><input type="checkbox" class="checkbox" id="dtAll"></th><th>Document</th><th>Category</th><th>Type</th><th>Size</th><th>Visibility</th><th>Ver</th><th>Status</th><th>Uploaded</th><th></th>
    </tr></thead><tbody>${body}</tbody></table>
    <div style="display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-top:1px solid var(--line)">
      <span style="color:var(--slate);font-size:12.5px">${list.length} document${list.length===1?'':'s'} · page ${DOC.page} of ${totalPages}</span>
      <div style="display:flex;gap:8px"><button class="btn btn-sm" ${DOC.page<=1?'disabled':''} onclick="docPage(-1)"><i class="fa-solid fa-chevron-left"></i></button><button class="btn btn-sm" ${DOC.page>=totalPages?'disabled':''} onclick="docPage(1,${totalPages})"><i class="fa-solid fa-chevron-right"></i></button></div>
    </div></div>`;
    wire();
  };
  const wire=()=>{
    const s=$('dtSearch');if(s){s.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();DOC.q=s.value.trim();DOC.page=1;docRenderTable(host,dept);}};}
    const sb2=$('dtSearchBtn');if(sb2)sb2.onclick=()=>{DOC.q=($('dtSearch')?$('dtSearch').value.trim():'');DOC.page=1;docRenderTable(host,dept);};
    const so=$('dtSort');if(so){so.value=DOC.sort;so.onchange=e=>{DOC.sort=e.target.value;docRenderTable(host,dept);};}
    const stt=$('dtStatus');if(stt)stt.onchange=()=>{DOC.page=1;draw();};
    document.querySelectorAll('.dtChk').forEach(c=>c.onchange=e=>{const id=+e.target.dataset.id;e.target.checked?DOC.sel.add(id):DOC.sel.delete(id);updateBulk();});
    const all=$('dtAll');if(all)all.onchange=e=>{document.querySelectorAll('.dtChk').forEach(c=>{c.checked=e.target.checked;const id=+c.dataset.id;e.target.checked?DOC.sel.add(id):DOC.sel.delete(id);});updateBulk();};
    updateBulk();
  };
  const updateBulk=()=>{const n=DOC.sel.size;const dl=$('dtBulkDl'),del=$('dtBulkDel');if(dl){dl.disabled=!n;dl.innerHTML='<i class="fa-solid fa-download"></i> Download'+(n?' ('+n+')':'');dl.onclick=()=>DOC.sel.forEach(id=>docDownload(id));}if(del){del.disabled=!n;del.innerHTML='<i class="fa-solid fa-trash"></i> Delete'+(n?' ('+n+')':'');del.onclick=()=>docBulkDelete();}};
  window.docPage=(d,tp)=>{DOC.page=Math.max(1,DOC.page+d);if(tp)DOC.page=Math.min(DOC.page,tp);draw();};
  draw();
}

/* ---------- doc actions ---------- */
window.docMenu=function(e,id){
  e.stopPropagation();
  const exists=document.getElementById('docCtx');if(exists)exists.remove();
  const menu=el('div','dropdown show');menu.id='docCtx';menu.style.cssText='position:fixed;width:200px;z-index:120';
  menu.innerHTML=[['fa-eye','Preview','docPreview'],['fa-download','Download','docDownload'],['fa-pen','Rename','docRename'],['fa-code-branch','Replace Version','docReplaceVersion'],['fa-clock-rotate-left','Version History','docVersions'],['fa-folder-tree','Move','docMove'],['fa-thumbtack','Pin / Unpin','docPin'],['fa-magnifying-glass','Re-index for search','docReindex']].map(a=>`<div class="dd-item" onclick="${a[2]}(${id});document.getElementById('docCtx').remove()"><i class="fa-solid ${a[0]}"></i> ${a[1]}</div>`).join('')+`<div style="height:1px;background:var(--line-2);margin:6px 0"></div><div class="dd-item" style="color:var(--err)" onclick="docDelete(${id});document.getElementById('docCtx').remove()"><i class="fa-solid fa-trash"></i> Delete</div>`;
  document.body.appendChild(menu);
  const r=e.target.getBoundingClientRect();menu.style.top=(r.bottom+4)+'px';menu.style.left=(r.right-200)+'px';
  setTimeout(()=>document.addEventListener('click',function h(){menu.remove();document.removeEventListener('click',h);}),0);
};
async function getDoc(id){const {data}=await sb.schema('doc').from('documents').select('*').eq('id',id).single();return data;}
window.docPreview=async function(id){
  const d=await getDoc(id);if(!d)return;
  if(!d.storage_path){ if(d.link){window.open(d.link,'_blank');return;} toast('No file attached to this record.','');return; }
  if(isS3Path(d.storage_path)){ await s3OpenSigned(d.storage_path); return; }
  const {data,error}=await sb.storage.from(bucketFor(d.department)).createSignedUrl(d.storage_path,120);
  if(error){toast('Preview failed: '+error.message,'err');return;}
  window.open(data.signedUrl,'_blank');
};
window.docDownload=async function(id){
  const d=await getDoc(id);if(!d)return;
  if(!d.storage_path){ if(d.link){window.open(d.link,'_blank');return;} toast('No file to download.','');return; }
  if(isS3Path(d.storage_path)){ await s3OpenSigned(d.storage_path,d.file_name||'download'); return; }
  const {data,error}=await sb.storage.from(bucketFor(d.department)).createSignedUrl(d.storage_path,120,{download:d.file_name||true});
  if(error){toast('Download failed: '+error.message,'err');return;}
  const a=document.createElement('a');a.href=data.signedUrl;a.download=d.file_name||'';document.body.appendChild(a);a.click();a.remove();
};
window.docPin=async function(id){const d=await getDoc(id);await sb.schema('doc').from('documents').update({pinned:!d.pinned}).eq('id',id);toast(d.pinned?'Unpinned':'Pinned','ok');route();};
window.docRename=async function(id){
  const d=await getDoc(id);
  openModal(`<div class="modal-head"><h3>Rename document</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><label>Title</label><input id="rnTitle" value="${esc(d.title)}"></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="docRenameSave(${id})">Save</button></div>`);
};
window.docRenameSave=async function(id){const t=$('rnTitle').value.trim();if(!t)return;const {error}=await sb.schema('doc').from('documents').update({title:t}).eq('id',id);if(error){toast(error.message,'err');return;}closeModal();toast('Renamed','ok');route();};
window.docMove=async function(id){
  const d=await getDoc(id);
  if(d.department==='Legal'){
    const list=await legalFolderTree();
    const {roots}=buildFolderTree(list);
    const opts=flattenTreeOptions(roots,0);
    openModal(`<div class="modal-head"><h3>Move document</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><label>Department</label><select id="mvDept" disabled><option selected>Legal</option></select><label>Category</label><select id="mvFolder">${opts.map(o=>'<option value="'+o.id+'" '+(o.id===d.folder_id?'selected':'')+'>'+esc(o.label)+'</option>').join('')}</select></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="docMoveSaveLegal(${id})">Move</button></div>`);
    return;
  }
  const cats=['Policies','SOPs','Templates','Statutory','Budgets','Brand','Collateral','Plans','Data','Pricing','Drawings','BOQ','Reports','Quotes','Ledgers','Registers','Assets','Schedules','Contracts','Minutes','Reference','Agreements','Uncategorised'];
  openModal(`<div class="modal-head"><h3>Move document</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><div class="two"><div><label>Department</label><select id="mvDept">${DEPARTMENTS.map(x=>'<option '+(x===d.department?'selected':'')+'>'+x+'</option>').join('')}</select></div><div><label>Category / Folder</label><select id="mvCat">${cats.map(x=>'<option '+(x===d.category?'selected':'')+'>'+x+'</option>').join('')}</select></div></div></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="docMoveSave(${id})">Move</button></div>`);
};
window.docMoveSave=async function(id){const dept=$('mvDept').value,cat=$('mvCat').value;const {error}=await sb.schema('doc').from('documents').update({department:dept,category:cat,folder_id:null}).eq('id',id);if(error){toast(error.message,'err');return;}closeModal();toast('Moved to '+dept,'ok');route();};
window.docMoveSaveLegal=async function(id){
  const folderId=Number($('mvFolder').value);
  const list=await legalFolderTree();const {byId}=buildFolderTree(list);
  const path=folderPath(byId,folderId).join(' / ');
  const {error}=await sb.schema('doc').from('documents').update({folder_id:folderId,category:path}).eq('id',id);
  if(error){toast(error.message,'err');return;}closeModal();toast('Moved','ok');route();
};
window.docDelete=async function(id){
  const d=await getDoc(id);
  openModal(`<div class="modal-head"><h3>Delete document</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body">Delete <b>${esc(d.title)}</b>? This removes the file and its metadata permanently.</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-danger" onclick="docDeleteConfirm(${id})"><i class="fa-solid fa-trash"></i> Delete</button></div>`);
};
window.docDeleteConfirm=async function(id){
  const d=await getDoc(id);
  if(d.storage_path){ if(isS3Path(d.storage_path)) await s3Delete(d.storage_path); else await sb.storage.from(bucketFor(d.department)).remove([d.storage_path]); }
  const {error}=await sb.schema('doc').from('documents').delete().eq('id',id);
  if(error){toast(error.message,'err');return;}
  DOC.sel.delete(id);closeModal();toast('Deleted','ok');route();
};
async function docBulkDelete(){
  if(!DOC.sel.size)return;
  openModal(`<div class="modal-head"><h3>Delete ${DOC.sel.size} documents</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body">Permanently delete the selected documents and their files?</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-danger" onclick="docBulkDeleteConfirm()"><i class="fa-solid fa-trash"></i> Delete all</button></div>`);
}
window.docBulkDeleteConfirm=async function(){
  for(const id of DOC.sel){const d=await getDoc(id);if(d&&d.storage_path){ if(isS3Path(d.storage_path)) await s3Delete(d.storage_path); else await sb.storage.from(bucketFor(d.department)).remove([d.storage_path]); } await sb.schema('doc').from('documents').delete().eq('id',id);}
  DOC.sel.clear();closeModal();toast('Deleted','ok');route();
};
window.docVersions=async function(id){
  const d=await getDoc(id);
  const {data:vers}=await sb.schema('doc').from('document_versions').select('*').eq('document_id',id).order('created_at',{ascending:false});
  const list=(vers&&vers.length)?vers.map(x=>`<div style="display:flex;align-items:center;gap:11px;padding:10px 0;border-bottom:1px solid var(--line-2)">${fileIcon(x.file_type)}<div style="flex:1"><div style="font-weight:600;font-size:13px">${esc(x.version||'—')} · ${esc(x.file_name||'')}</div><div style="color:var(--slate);font-size:11.5px">${fmtBytes(x.file_size)} · ${relTime(x.created_at)} · ${esc(x.uploaded_by||'')}</div></div></div>`).join(''):'<div class="empty" style="padding:24px"><i class="fa-regular fa-clock"></i><div>No prior versions</div></div>';
  openModal(`<div class="modal-head"><h3>Version history · ${esc(d.title)}</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body"><div style="display:flex;align-items:center;gap:11px;padding:10px 0;border-bottom:2px solid var(--brand);margin-bottom:6px">${fileIcon(d.file_type)}<div style="flex:1"><div style="font-weight:600;font-size:13px">${esc(d.version||'v1')} · ${esc(d.file_name||'')} <span class="tag t-green">Current</span></div><div style="color:var(--slate);font-size:11.5px">${fmtBytes(d.file_size)} · ${relTime(d.updated_at||d.created_at)}</div></div></div>${list}</div><div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Close</button></div>`);
};
window.docReplaceVersion=function(id){
  openModal(`<div class="modal-head"><h3>Replace version</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><p style="color:var(--slate);font-size:13px;margin-bottom:6px">Upload a new file. The current version is archived to history.</p><div class="dropzone" onclick="document.getElementById('rvFile').click()"><i class="fa-solid fa-cloud-arrow-up"></i><div id="rvName">Click to choose a file</div></div><input type="file" id="rvFile" class="hidden" onchange="document.getElementById('rvName').textContent=this.files[0]?this.files[0].name:'Click to choose a file'"></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="docReplaceSave(${id})"><i class="fa-solid fa-code-branch"></i> Replace</button></div>`);
};
window.docReplaceSave=async function(id){
  const f=$('rvFile').files[0];if(!f){toast('Choose a file first','err');return;}
  const d=await getDoc(id);
  // archive current
  if(d.storage_path){await sb.schema('doc').from('document_versions').insert({document_id:id,version:d.version,storage_path:d.storage_path,file_name:d.file_name,file_size:d.file_size,file_type:d.file_type,uploaded_by:d.uploaded_by});}
  let catForKey=d.category;
  if(d.department==='Legal' && d.folder_id){
    try{const list=await legalFolderTree();const {byId}=buildFolderTree(list);catForKey=folderPath(byId,d.folder_id);}catch(e){}
  }
  const key=s3KeyForDoc(d.department,catForKey,f.name);
  const {data:upData,error:upErr}=await uploadFileToS3(key,f);
  if(upErr){toast('Upload failed: '+upErr.message,'err');return;}
  const newVer='v'+(parseInt((d.version||'v1').replace('v',''))+1);
  const {error}=await sb.schema('doc').from('documents').update({storage_path:upData.path,file_name:f.name,file_size:f.size,file_type:f.name.split('.').pop(),version:newVer}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  closeModal();toast('New version '+newVer+' saved','ok');route();
};

/* ---------- upload modal ---------- */
window.docUploadModal=async function(presetDept){
  const isLegal=DOC.scope==='legal'||presetDept==='Legal';
  const dept=presetDept||(isLegal?'Legal':(DOC.dept||''));
  const locked=!!dept;
  let catField;
  if(isLegal){
    const list=await legalFolderTree();
    const {roots}=buildFolderTree(list);
    const opts=flattenTreeOptions(roots,0);
    const curFolderId=DOC.cat?Number(DOC.cat):(opts[0]?opts[0].id:'');
    catField=`<div><label>Category</label><select id="upFolderId">${opts.map(o=>'<option value="'+o.id+'" '+(o.id===curFolderId?'selected':'')+'>'+esc(o.label)+'</option>').join('')}</select></div>`;
  } else {
    const curCat=(DOC.cat&&DOC.cat!=='All')?DOC.cat:'';
    let cats=[];
    if(dept){try{const f=await getFolders(dept);f.forEach(c=>{if(!cats.includes(c))cats.push(c);});}catch(e){}
      try{const ex=await docFetch({dept});[...new Set(ex.map(d=>d.category).filter(Boolean))].forEach(c=>{if(!cats.includes(c))cats.push(c);});}catch(e){}}
    catField=`<div><label>Folder / Category <span style="color:#94a3b8;font-weight:400">(pick or type new)</span></label><input id="upCat" list="upCatList" value="${esc(curCat)}" placeholder="${cats[0]?esc(cats[0]):'e.g. Policies'}"><datalist id="upCatList">${cats.map(x=>'<option value="'+esc(x)+'">').join('')}</datalist></div>`;
  }
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-upload"></i> Upload document${dept?' · '+esc(dept):''}</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <div class="dropzone" onclick="document.getElementById('upFile').click()"><i class="fa-solid fa-cloud-arrow-up"></i><div id="upName">Drag & drop or click to select files</div><div style="font-size:12px;margin-top:4px">PDF, Word, Excel, images — multiple allowed. Each file's name can be edited below.</div></div>
    <input type="file" id="upFile" class="hidden" multiple onchange="docUpPick()">
    <div id="upList" style="margin-top:8px"></div>
    <div class="two">
      <div><label>Department ${locked?'<span style="color:#94a3b8;font-weight:400">(locked)</span>':''}</label><select id="upDept" ${locked?'disabled':''}>${DEPARTMENTS.map(x=>'<option '+(x===dept?'selected':'')+'>'+x+'</option>').join('')}</select></div>
      ${catField}
    </div>
    <div class="two"><div><label>Version</label><input id="upVer" value="v1"></div><div><label>Visibility</label><select id="upVis">${VIS.map(x=>'<option '+(x==='Internal'?'selected':'')+'>'+x+'</option>').join('')}</select></div></div>
    <label>Description</label><textarea id="upDesc" placeholder="Short description…"></textarea>
    <div class="two"><div><label>Status</label><select id="upStatus">${DOCSTATUS.map(x=>'<option>'+x+'</option>').join('')}</select></div><div><label>Confidential</label><select id="upConf"><option value="false">No</option><option value="true">Yes (super-admin only)</option></select></div></div>
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="upBtn" onclick="docUploadSave()"><i class="fa-solid fa-upload"></i> Upload</button></div>`,'lg');
};
window.docUpPick=function(){const fs=[...$('upFile').files];$('upName').textContent=fs.length?fs.length+' file(s) selected — edit names below':'Drag & drop or click to select files';$('upList').innerHTML=fs.map((f,i)=>`<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line-2)">${fileIcon(f.name.split('.').pop())}<input class="upTitleIn" data-i="${i}" value="${esc(f.name.replace(/\.[^.]+$/,''))}" title="${esc(f.name)}" style="flex:1;font-size:13px;font-weight:500;border:1px solid var(--line);border-radius:7px;padding:6px 9px;color:var(--ink)"><span style="color:var(--slate);font-size:12px;white-space:nowrap">${fmtBytes(f.size)}</span></div>`).join('');};
async function loadPdfJs(){
  if(window.pdfjsLib)return window.pdfjsLib;
  await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';sc.onload=res;sc.onerror=rej;document.head.appendChild(sc);});
  if(window.pdfjsLib)window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return window.pdfjsLib;
}
async function loadTesseract(){
  if(window.Tesseract)return window.Tesseract;
  await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';sc.onload=res;sc.onerror=rej;document.head.appendChild(sc);});
  return window.Tesseract;
}
async function loadXLSX(){
  if(window.XLSX)return window.XLSX;
  await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';sc.onload=res;sc.onerror=rej;document.head.appendChild(sc);});
  return window.XLSX||null;
}
async function loadTusJs(){
  if(window.tus)return window.tus;
  await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdn.jsdelivr.net/npm/tus-js-client@3/dist/tus.min.js';sc.onload=res;sc.onerror=rej;document.head.appendChild(sc);});
  return window.tus||null;
}
async function loadJSZip(){
  if(window.JSZip)return window.JSZip;
  await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';sc.onload=res;sc.onerror=rej;document.head.appendChild(sc);});
  return window.JSZip||null;
}
async function loadMammoth(){
  if(window.mammoth)return window.mammoth;
  await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';sc.onload=res;sc.onerror=rej;document.head.appendChild(sc);});
  return window.mammoth||null;
}
async function loadPdfLib(){
  if(window.PDFLib)return window.PDFLib;
  await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';sc.onload=res;sc.onerror=rej;document.head.appendChild(sc);});
  return window.PDFLib||null;
}
function _letters(t){return (String(t||'').match(/[A-Za-z]/g)||[]).length;}

// Lightweight in-place OCR preprocessing — one canvas, one pass
// Grayscale + contrast stretch — no extra canvas copies, no memory blow-up
function ocrPreprocess(canvas){
  const ctx=canvas.getContext('2d');
  const W=canvas.width,H=canvas.height;
  const id=ctx.getImageData(0,0,W,H);
  const d=id.data;
  // Step 1: grayscale + contrast stretch + S-curve
  let mn=255,mx=0;
  for(let i=0;i<d.length;i+=4){
    const g=(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])|0;
    d[i]=d[i+1]=d[i+2]=g;if(g<mn)mn=g;if(g>mx)mx=g;
  }
  const range=mx-mn||1;
  const lut=new Uint8Array(256);
  for(let v=0;v<256;v++){
    let g=((v-mn)/range*255)|0;
    g=(255/(1+Math.exp(-0.06*(g-128)))+0.5)|0;
    lut[v]=Math.min(255,Math.max(0,g));
  }
  for(let i=0;i<d.length;i+=4){d[i]=d[i+1]=d[i+2]=lut[d[i]];}
  // Step 2: double unsharp mask — sharpens edges for small text & grey-bg rows
  const buf=new Uint8Array(W*H);
  for(let pass=0;pass<2;pass++){
    for(let y=0;y<H;y++){
      for(let x=0;x<W;x++){
        const l=x>0?d[((y*W+(x-1))*4)]:d[(y*W+x)*4];
        const c=d[(y*W+x)*4];
        const r=x<W-1?d[((y*W+(x+1))*4)]:c;
        buf[y*W+x]=((l+c+r)/3+0.5)|0;
      }
    }
    for(let y=0;y<H;y++){
      for(let x=0;x<W;x++){
        const u=y>0?buf[((y-1)*W+x)]:buf[y*W+x];
        const c=buf[y*W+x];
        const b=y<H-1?buf[((y+1)*W+x)]:c;
        const blurV=((u+c+b)/3+0.5)|0;
        const orig=d[(y*W+x)*4];
        const sharp=Math.min(255,Math.max(0,(orig+2.0*(orig-blurV)+0.5)|0));
        d[(y*W+x)*4]=d[(y*W+x)*4+1]=d[(y*W+x)*4+2]=sharp;
      }
    }
  }
  // Step 3: hard binarize at 160 — makes grey-background text (TOTAL rows, headers) readable
  for(let i=0;i<d.length;i+=4){const v=d[i]>160?255:0;d[i]=d[i+1]=d[i+2]=v;}
  ctx.putImageData(id,0,0);
  return canvas;
}
async function ocrImageSource(src){
  // src can be a File/Blob OR a URL string
  try{
    const T=await loadTesseract();if(!T)return '';
    const isBlob=src instanceof Blob;
    const url=isBlob?URL.createObjectURL(src):src;
    const img=await new Promise((res,rej)=>{
      const i=new Image();
      if(!isBlob)i.crossOrigin='anonymous';
      i.onload=()=>res(i);i.onerror=rej;i.src=url;
    });
    const longEdge=Math.max(img.naturalWidth||1,img.naturalHeight||1);
    const scale=Math.min(8,Math.max(1,Math.ceil(4000/longEdge)));// 4000px target
    const c=document.createElement('canvas');c.width=img.naturalWidth*scale;c.height=img.naturalHeight*scale;
    const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(img,0,0,c.width,c.height);
    const processed=ocrPreprocess(c);
    const dpi=Math.round(scale*96);
    const r1=await T.recognize(processed,'eng',{tessedit_pageseg_mode:'3',tessedit_ocr_engine_mode:'1',user_defined_dpi:String(dpi)});
    const r2=await T.recognize(processed,'eng',{tessedit_pageseg_mode:'6',tessedit_ocr_engine_mode:'1',user_defined_dpi:String(dpi)});
    if(isBlob)URL.revokeObjectURL(url);
    return (((r1&&r1.data&&r1.data.text)||'')+' '+((r2&&r2.data&&r2.data.text)||'')).trim();
  }catch(e){console.warn('ocr img failed',e);return '';}
}
async function ocrPdf(file){
  try{
    const lib=await loadPdfJs();const T=await loadTesseract();if(!lib||!T)return '';
    const buf=await file.arrayBuffer();const pdf=await lib.getDocument({data:buf}).promise;
    let txt='';const n=Math.min(pdf.numPages,20);
    for(let i=1;i<=n;i++){
      const page=await pdf.getPage(i);
      // 4x scale ≈ 288 DPI — captures small text (6pt+ reliable, 4pt+ often readable)
      const vp=page.getViewport({scale:4});
      const canvas=document.createElement('canvas');canvas.width=vp.width;canvas.height=vp.height;
      const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
      await page.render({canvasContext:ctx,viewport:vp}).promise;
      const processed=ocrPreprocess(canvas);
      const r1=await T.recognize(processed,'eng',{tessedit_pageseg_mode:'3',tessedit_ocr_engine_mode:'1',user_defined_dpi:'288'});
      const r2=await T.recognize(processed,'eng',{tessedit_pageseg_mode:'6',tessedit_ocr_engine_mode:'1',user_defined_dpi:'288'});
      const r3=await T.recognize(processed,'eng',{tessedit_pageseg_mode:'11',tessedit_ocr_engine_mode:'1',user_defined_dpi:'288'});
      txt+=((r1&&r1.data&&r1.data.text)||'')+' '+((r2&&r2.data&&r2.data.text)||'')+' '+((r3&&r3.data&&r3.data.text)||'')+' ';
    }
    return txt.replace(/(\d),(?=\d)/g,'$1').replace(/\s+/g,' ').trim();
  }catch(e){console.warn('ocr pdf failed',e);return '';}
}
async function extractFileText(file){
  const ext=(file.name.split('.').pop()||'').toLowerCase();
  try{
    if(['txt','csv','md','json','html'].includes(ext)){return (await file.text()).replace(/\s+/g,' ').slice(0,400000);}
    if(['png','jpg','jpeg','webp','bmp','gif','tif','tiff'].includes(ext)){
      const t=await ocrImageSource(file);return (t||'').replace(/\s+/g,' ').trim().slice(0,400000)||null;
    }
    if(ext==='pdf'){
      const lib=await loadPdfJs();if(!lib)return null;
      const buf=await file.arrayBuffer();
      const pdf=await lib.getDocument({data:buf}).promise;
      // Step 1: extract the text layer (font-based text — fast)
      let layerTxt='';const n=Math.min(pdf.numPages,80);
      for(let i=1;i<=n;i++){const pg=await pdf.getPage(i);const c=await pg.getTextContent();layerTxt+=c.items.map(it=>it.str).join(' ')+' ';}
      layerTxt=layerTxt.replace(/\s+/g,' ').trim();
      // Step 2: ALWAYS run OCR on first 10 pages — catches image text in brochures/scans
      // This runs regardless of whether the text layer has content
      let ocrTxt='';
      try{
        const T=await loadTesseract();
        if(T){
          const nOcr=Math.min(pdf.numPages,10);
          for(let i=1;i<=nOcr;i++){
            const page=await pdf.getPage(i);
            const vp=page.getViewport({scale:4});
            const canvas=document.createElement('canvas');canvas.width=vp.width;canvas.height=vp.height;
            const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
            await page.render({canvasContext:ctx,viewport:vp}).promise;
            const prep=ocrPreprocess(canvas);
            const r1=await T.recognize(prep,'eng',{tessedit_pageseg_mode:'3',tessedit_ocr_engine_mode:'1',user_defined_dpi:'288'});
            const r2=await T.recognize(prep,'eng',{tessedit_pageseg_mode:'6',tessedit_ocr_engine_mode:'1',user_defined_dpi:'288'});
            const r3=await T.recognize(prep,'eng',{tessedit_pageseg_mode:'11',tessedit_ocr_engine_mode:'1',user_defined_dpi:'288'});
            ocrTxt+=((r1&&r1.data&&r1.data.text)||'')+' '+((r2&&r2.data&&r2.data.text)||'')+' '+((r3&&r3.data&&r3.data.text)||'')+' ';
          }
        }
      }catch(e){console.warn('pdf ocr pass failed',e);}
      // Combine both — font text + image text — for maximum coverage
      const combined=(layerTxt+' '+ocrTxt)
        .replace(/(\d),(?=\d)/g,'$1')
        .replace(/\s+/g,' ').trim();
      return combined.slice(0,400000)||null;
    }
    if(['xlsx','xls','ods'].includes(ext)){
      const XL=await loadXLSX();if(!XL)return null;
      const buf=await file.arrayBuffer();
      const wb=XL.read(buf,{type:'array'});
      let txt='';
      wb.SheetNames.forEach(sn=>{
        const ws=wb.Sheets[sn];
        const rows=XL.utils.sheet_to_json(ws,{header:1,defval:''});
        rows.forEach(row=>{txt+=row.filter(Boolean).join(' ')+' ';});
        txt+=' ';
      });
      return txt.replace(/\s+/g,' ').trim().slice(0,400000)||null;
    }
    if(['docx','docm'].includes(ext)){
      const JZ=await loadJSZip();if(!JZ)return null;
      const buf=await file.arrayBuffer();
      const zip=await JZ.loadAsync(buf);
      const xmlFile=zip.files['word/document.xml'];
      if(!xmlFile)return null;
      const xml=await xmlFile.async('string');
      // Strip XML tags, decode common entities, collapse whitespace
      const txt=xml
        .replace(/<w:p[ >]/g,' ')
        .replace(/<[^>]+>/g,'')
        .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').replace(/&#x[0-9A-Fa-f]+;/g,' ')
        .replace(/\s+/g,' ').trim();
      return txt.slice(0,400000)||null;
    }
    if(['pptx','pptm'].includes(ext)){
      const JZ=await loadJSZip();if(!JZ)return null;
      const buf=await file.arrayBuffer();
      const zip=await JZ.loadAsync(buf);
      let txt='';
      const slideFiles=Object.keys(zip.files).filter(n=>n.match(/^ppt\/slides\/slide\d+\.xml$/));
      for(const sf of slideFiles){
        const xml=await zip.files[sf].async('string');
        txt+=xml.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()+' ';
      }
      return txt.slice(0,400000)||null;
    }
  }catch(e){console.warn('text extract failed',e);}
  return null;
}
async function extractUrlText(url,fileType){
  try{const r=await fetch(url);const blob=await r.blob();const f=new File([blob],'f.'+(fileType||'pdf'));return await extractFileText(f);}catch(e){console.warn(e);return null;}
}
async function docSignedUrlFor(d,seconds){
  if(isS3Path(d.storage_path)){const {data,error}=await s3Sign('get',d.storage_path.slice(3));if(error)return {error};return {data:{signedUrl:data.url}};}
  return sb.storage.from(bucketFor(d.department)).createSignedUrl(d.storage_path,seconds);
}
// File types the Gemini OCR edge function handles (scanned PDFs & images — the Legal case).
// Everything else (docx/xlsx/pptx/txt) still uses the client-side extractor below.
const DOC_GEMINI_TYPES=['pdf','png','jpg','jpeg','webp','heic','heif'];
function docFileExt(d){return (d.file_type||(d.file_name||'').split('.').pop()||'').toLowerCase();}
// Server-side OCR/text extraction via Gemini. Returns {ok,chars} | {skip} | {error}.
async function docOcrGemini(id){
  const {data:{session}}=await sb.auth.getSession();
  const token=session&&session.access_token;
  try{
    const res=await fetch(SUPABASE_URL+'/functions/v1/document-ocr',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},body:JSON.stringify({action:'ocr',id:id})});
    return await res.json();
  }catch(e){return {error:String(e)};}
}
// Index one document into content_text: Gemini for scans/images, client-side reader otherwise.
async function docIndexOne(d){
  const ext=docFileExt(d);
  if(DOC_GEMINI_TYPES.includes(ext)){
    const out=await docOcrGemini(d.id);
    if(out&&out.ok)return out.chars?true:false;      // done (true if any text found)
    if(!(out&&out.skip))return false;                 // hard error — skip (re-runnable later)
    // out.skip -> fall through to the client-side reader
  }
  const {data,error}=await docSignedUrlFor(d,300);
  if(error)return false;
  const txt=await extractUrlText(data.signedUrl,d.file_type);
  if(txt==null)return false;
  await sb.schema('doc').from('documents').update({content_text:txt}).eq('id',d.id);
  return true;
}
window.docReindex=async function(id){
  const d=await getDoc(id);if(!d)return;
  if(!d.storage_path){toast(d.link?'Linked intranet files cannot be content-indexed':'No file to index','');return;}
  toast('Reading the text inside this file…','');
  const ok=await docIndexOne(d);
  toast(ok?'Indexed — words inside the file are now searchable':'Could not read text from this file.',ok?'ok':'err');
  const host=$('docTableHost');if(host)docRenderTable(host,DOC.dept||undefined);
};
window.docReindexAll=async function(dept){
  const all=await docFetch({dept:dept||undefined,extraNonLegal:!dept,full:true});
  const toIndex=all.filter(d=>d.storage_path&&(!d.content_text||d.content_text.length<200));
  if(!toIndex.length){toast('All files already indexed','ok');return;}
  const total=toIndex.length;
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-wand-magic-sparkles"></i> Indexing files for search</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body"><p style="font-size:13px;color:var(--slate);margin:0 0 12px">Reading the text inside <b>'+total+'</b> file(s) with AI (Gemini) so words <i>inside</i> them become searchable — scanned/unclear legal documents included. This can take a while for large batches; keep this window open.</p>'
    +'<div class="psa-progress"><div class="psa-progress-bar"><div class="psa-progress-fill" id="docIdxFill" style="width:0%"></div></div><div class="psa-progress-label" id="docIdxLbl">Starting…</div></div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>','md');
  let done=0,failed=0,idx=0;
  const paint=function(){const p=Math.round((done+failed)/total*100);const f=$('docIdxFill');if(f)f.style.width=p+'%';const l=$('docIdxLbl');if(l)l.textContent='Processed '+(done+failed)+' of '+total+' · '+done+' indexed'+(failed?', '+failed+' skipped':'');};
  paint();
  const worker=async function(){
    while(idx<toIndex.length){
      const d=toIndex[idx++];
      try{ if(await docIndexOne(d))done++; else failed++; }catch(e){ failed++; }
      paint();
    }
  };
  const K=Math.min(4,toIndex.length);
  await Promise.all(Array.from({length:K},function(){return worker();}));
  const l=$('docIdxLbl');if(l)l.textContent='Done — '+done+' indexed'+(failed?', '+failed+' skipped (re-run to retry)':'');
  toast(done+' file(s) indexed'+(failed?' · '+failed+' skipped':''),'ok');
  // Refresh the table in place — don't call route() which resets the search
  const host=$('docTableHost');
  if(host)docRenderTable(host,DOC.dept||undefined);
};
window.docUploadSave=async function(){
  const files=[...$('upFile').files];if(!files.length){toast('Select at least one file','err');return;}
  const dept=$('upDept').value,ver=$('upVer').value||'v1',desc=$('upDesc').value,vis=$('upVis').value,status=$('upStatus').value,conf=$('upConf').value==='true';
  let cat='',folderId=null,catSegs=null;
  if(dept==='Legal'){
    folderId=Number($('upFolderId').value);
    const list=await legalFolderTree();const {byId}=buildFolderTree(list);
    catSegs=folderPath(byId,folderId); // array of folder names, e.g. ['Dream Palazzo','History of Land / Chain'] — used for the S3 key
    cat=catSegs.join(' / '); // display string only — never re-split for S3 keys, a category name can itself contain '/'
  } else {
    cat=$('upCat').value;
  }
  const titleIns=[...document.querySelectorAll('.upTitleIn')];
  const btn=$('upBtn');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Uploading…';
  let ok=0;
  for(let idx=0;idx<files.length;idx++){const f=files[idx];
    const key=s3KeyForDoc(dept,dept==='Legal'?catSegs:cat,f.name);
    const pctEl=$('upBtn');
    const {data:upData,error:upErr}=await uploadFileToS3(key,f,pct=>{
      if(pctEl)pctEl.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Uploading '+pct+'%…';
    });
    if(upErr){toast('Upload failed: '+upErr.message,'err');continue;}
    const ti=titleIns.find(x=>x.dataset.i==idx);
    const title=(ti&&ti.value.trim())||f.name.replace(/\.[^.]+$/,'');
    const fileExt=(f.name.split('.').pop()||'').toLowerCase();
    const useGemini=DOC_GEMINI_TYPES.includes(fileExt); // scanned PDFs / images -> strong Gemini OCR (server-side)
    let ctext=null;
    if(!useGemini){ btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Reading & indexing…'; ctext=await extractFileText(f); }
    btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
    const {data:insData,error}=await sb.schema('doc').from('documents').insert({title,department:dept,category:cat,folder_id:folderId,description:desc,version:ver,tags:'',visibility:vis,status,confidential:conf,file_name:f.name,file_size:f.size,file_type:fileExt,storage_path:upData.path,content_text:ctext,uploaded_by:state.email}).select('id').single();
    if(error){toast('Saved file but metadata failed: '+error.message,'err');}
    // Auto-index scanned/image uploads with Gemini in the background — no "Index All" needed, search just works.
    else { ok++; if(useGemini&&insData&&insData.id){ docOcrGemini(insData.id); } }
  }
  closeModal();if(ok)toast(ok+' document'+(ok>1?'s':'')+' uploaded to S3','ok');route();
};

/* ---------- LEGAL module (dedicated DMS, hierarchical category tree) ---------- */
VIEWS.legal=async function(v,seg){
  const tab=(seg[0]==='mis')?'mis':(seg[0]==='scoreboard')?'scoreboard':'docs';
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-scale-balanced" style="color:#1e3a8a"></i> Legal</h1><p>Document vault and litigation MIS for the Legal department</p></div>
    <div id="legalHeadActions" style="display:flex;gap:10px;flex-wrap:wrap"></div></div>
    <div class="tabs">
      <div class="tab ${tab==='docs'?'active':''}" onclick="navTo('legal')"><i class="fa-solid fa-folder-open"></i> Documents</div>
      <div class="tab ${tab==='mis'?'active':''}" onclick="navTo('legal/mis')"><i class="fa-solid fa-gavel"></i> MIS</div>
      <div class="tab ${tab==='scoreboard'?'active':''}" onclick="navTo('legal/scoreboard')"><i class="fa-solid fa-ranking-star"></i> Scoreboard</div>
    </div>
    <div id="legalBody"><div class="loader"><div class="spin"></div></div></div>`;
  if(tab==='mis') legalMIS();
  else if(tab==='scoreboard') legalScoreboard();
  else legalDocsView(seg);
};
async function legalDocsView(seg){
  DOC.scope='legal';DOC.dept='Legal';DOC.sel.clear();
  DOC.cat=(seg[0]==='cat')?decodeURIComponent(seg[1]):null;
  let crumbTail='All Documents';
  if(DOC.cat){
    const list=await legalFolderTree();const {byId}=buildFolderTree(list);
    const path=folderPath(byId,Number(DOC.cat));
    if(path.length)crumbTail=path.join(' / ');
  }
  setCrumb(['Legal',crumbTail]);
  const hAct=$('legalHeadActions');
  if(hAct)hAct.innerHTML=`<button class="btn btn-primary" onclick="docUploadModal('Legal')"><i class="fa-solid fa-upload"></i> Upload</button>`;
  const body=$('legalBody');if(!body)return;
  body.innerHTML=`<div class="split"><div><div class="subnav" id="legalNav"></div></div><div><div id="docTableHost"></div></div></div>`;
  legalNav();
  docRenderTable($('docTableHost'),'Legal');
}
async function legalNav(){
  const all=await docFetch({dept:'Legal'});
  const counts={};all.forEach(d=>{if(d.folder_id)counts[d.folder_id]=(counts[d.folder_id]||0)+1;});
  const list=await legalFolderTree();
  const {roots,byId}=buildFolderTree(list);
  // Totals = own direct document count + every descendant's count, recomputed on
  // every render so parent folders ("Projects", "Dream Apartment", etc.) show the
  // combined count of everything nested under them, not just documents attached
  // directly to that folder (which is normally zero for non-leaf folders).
  const totals={};
  const sumNode=node=>{let n=counts[node.id]||0;node.children.forEach(c=>{n+=sumNode(c);});totals[node.id]=n;return n;};
  roots.forEach(sumNode);
  // auto-expand the path down to whichever category is currently selected
  if(DOC.cat){let cur=byId[Number(DOC.cat)];while(cur&&cur.parent_id){DOC.legalExpanded.add(cur.parent_id);cur=byId[cur.parent_id];}}
  const renderNode=(node,depth)=>{
    const hasKids=node.children.length>0;
    const expanded=DOC.legalExpanded.has(node.id);
    const active=DOC.cat&&Number(DOC.cat)===node.id;
    const caret=hasKids?`<i class="fa-solid fa-chevron-${expanded?'down':'right'} sn-caret" onclick="event.stopPropagation();legalToggleExpand(${node.id})"></i>`:`<i class="fa-regular fa-folder sn-caret-spacer"></i>`;
    const kids=hasKids&&expanded?`<div class="sn-children">${node.children.map(c=>renderNode(c,depth+1)).join('')}</div>`:'';
    return `<div class="sn-tree-node" style="margin-left:${depth*13}px">
      <div class="sn-item ${active?'active':''}" onclick="legalSelectCat(${node.id})">
        <span>${caret} ${esc(node.name)}</span>
        <span class="sn-actions"><span class="ct">${totals[node.id]||0}</span><i class="fa-solid fa-plus sn-add" title="Add category inside ${esc(node.name)}" onclick="event.stopPropagation();docNewFolder('Legal',${node.id},'${esc(node.name).replace(/'/g,"\\'")}')"></i></span>
      </div>
      ${kids}
    </div>`;
  };
  $('legalNav').innerHTML=`<div class="sn-title">Categories</div>`+
    `<div class="sn-item ${!DOC.cat?'active':''}" onclick="location.hash='#/legal'"><span><i class="fa-solid fa-layer-group"></i> All Documents</span><span class="ct">${all.length}</span></div>`+
    `<div class="sn-tree">${roots.map(r=>renderNode(r,0)).join('')}</div>`+
    `<div class="sn-item" style="color:var(--brand)" onclick="docNewFolder('Legal',null,null)"><span><i class="fa-solid fa-plus"></i> Add main folder</span></div>`;
}
window.legalToggleExpand=function(id){if(DOC.legalExpanded.has(id))DOC.legalExpanded.delete(id);else DOC.legalExpanded.add(id);legalNav();};
window.legalSelectCat=function(id){location.hash='#/legal/cat/'+id;};

/* ============================ LEGAL MIS ============================ */
const MIS_FIELDS=[
  {k:'case_type',l:'Case Type'},
  {k:'cause_title',l:'Cause Title / Parties'},
  {k:'case_no',l:'Case No.'},
  {k:'previous_date',l:'Previous Date'},
  {k:'next_date',l:'Next Date'},
  {k:'priority',l:'Priority'},
  {k:'advocate_incharge',l:'Advocate In-Charge'},
  {k:'court',l:'Court'},
  {k:'status',l:'Status / Purpose'},
  {k:'remarks',l:'Remarks'},
  {k:'project_land_name',l:'Project / Land'},
  {k:'date_of_filing',l:'Date of Filing'},
  {k:'pc_in_charge',l:'PC In-Charge'},
  {k:'file_no',l:'File No.'},
  {k:'cnr_no',l:'CNR No.'}
];
function misLabel(k){const f=MIS_FIELDS.find(x=>x.k===k);return f?f.l:k;}
function misInput(k,vals){return '<div><label>'+misLabel(k)+'</label><input id="misF_'+k+'" class="sel" value="'+esc((vals||{})[k]||'')+'"></div>';}
function misArea(k,vals,rows){return '<div style="margin-bottom:14px"><label>'+misLabel(k)+'</label><textarea id="misF_'+k+'" class="sel" rows="'+(rows||3)+'">'+esc((vals||{})[k]||'')+'</textarea></div>';}
const MIS_AREA_FIELDS=new Set(['cause_title','status','remarks']);
function misFormHtml(vals){
  vals=vals||{};
  let html='', pending=null;
  function flush(){ if(pending!==null){ html+='<div class="two">'+pending+'</div>'; pending=null; } }
  MIS_FIELDS.forEach(f=>{
    if(MIS_AREA_FIELDS.has(f.k)){
      flush();
      html+=misArea(f.k,vals,f.k==='cause_title'?2:3);
    } else if(pending===null){
      pending=misInput(f.k,vals);
    } else {
      html+='<div class="two">'+pending+misInput(f.k,vals)+'</div>';
      pending=null;
    }
  });
  flush();
  return html;
}
function misTrunc(s,n){s=String(s==null?'':s).replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n-1)+'…':s;}
function misPriorityTag(p){
  const s=String(p||'').toLowerCase();
  let cls='t-gray',label=p||'—';
  if(s.indexOf('high')===0){cls='t-red';}
  else if(s.indexOf('medium')===0){cls='t-amber';}
  else if(s.indexOf('low')===0){cls='t-green';}
  if(!p)return '<span class="mis-ptag mis-ptag--gray">—</span>';
  return '<span class="mis-ptag mis-ptag--'+cls.replace('t-','')+'">'+esc(misTrunc(label,14))+'</span>';
}
const MIS_CLAMP=new Set(['cause_title','court','status','remarks','project_land_name']);
const MIS_NOWRAP_TRUNC=new Set(['case_no','advocate_incharge','file_no','cnr_no']);
const MIS_WIDTH={case_type:110,cause_title:240,case_no:160,previous_date:100,next_date:100,priority:100,advocate_incharge:150,court:160,status:200,remarks:180,project_land_name:160,date_of_filing:105,pc_in_charge:120,file_no:130,cnr_no:130};
function misCellHtml(f,r){
  const v=r[f.k];
  if(f.k==='priority')return '<td>'+misPriorityTag(v)+'</td>';
  if(f.k==='case_type')return '<td style="font-weight:600;white-space:nowrap">'+esc(v||'—')+'</td>';
  if(MIS_CLAMP.has(f.k))return '<td><div class="mis-cell-clamp">'+esc(v||'—')+'</div></td>';
  if(MIS_NOWRAP_TRUNC.has(f.k))return '<td style="white-space:nowrap;color:var(--slate)">'+esc(misTrunc(v,26)||'—')+'</td>';
  return '<td style="white-space:nowrap;color:var(--slate)">'+esc(v||'—')+'</td>';
}
// "Pinned" rows (a parsed, non-past next_date_iso — i.e. currently showing on the Calendar) get a
// dedicated 6-dot grip handle next to the checkbox. Sliding THAT HANDLE left toggles the checkbox
// into a grey, disabled "handled" state (slide again to release it) — a normal click directly on
// the checkbox is a totally separate action (plain bulk-select, unaffected). While grey/handled,
// the row is excluded from the Edit/Delete selection count; a normally-checked row still counts as
// one selected row same as always.
function misRowHtml(r,isPinned){
  const handled=isPinned&&r.next_date_recorded_at;
  const cbAttrs=handled?'checked disabled':'';
  const cbCls='mis-cb mis-row-cb'+(handled?' mis-handled':'');
  // Reuses the app's existing .drag-handle look (accountability task/checklist rows) instead of a
  // one-off style, so spacing/size/touch-target match what's already established elsewhere.
  const handle=isPinned?`<i class="fa-solid fa-grip-vertical drag-handle mis-handle" data-id="${r.id}" title="Slide left to mark this Next Date handled"></i>`:'';
  return `<tr data-id="${r.id}" class="${isPinned?'mis-pinned':''}" style="${isPinned?'border-left:3px solid #1e3a8a':''}" onclick="if(!event.target.closest('.mis-cb')&&!event.target.closest('.mis-handle'))misEdit(${r.id})">
    <td onclick="event.stopPropagation()" class="mis-cb-cell"><input type="checkbox" class="${cbCls}" data-id="${r.id}" ${cbAttrs} onchange="misRowCheck(this)">${handle}</td>
    ${MIS_FIELDS.map(f=>misCellHtml(f,r)).join('')}
  </tr>`;
}
// Sliding the grip handle left toggles next_date_recorded_at (today's date, or cleared) — feeds
// the Scoreboard score. Mouse AND touch both use pointer events. Scoped to the handle icon only —
// dragging elsewhere on the row does nothing, so a plain click anywhere else still opens Edit.
function misWireSwipe(){
  document.querySelectorAll('#misTbody .mis-handle').forEach(function(handle){
    if(handle._dragWired)return; handle._dragWired=true;
    handle.style.touchAction='pan-y';
    handle.addEventListener('pointerdown',function(e){
      e.stopPropagation();
      const tr=handle.closest('tr'); if(!tr)return;
      const startX=e.clientX,startY=e.clientY;
      let dx=0,armed=false;
      function move(ev){
        dx=ev.clientX-startX; const dy=ev.clientY-startY;
        if(!armed){ if(Math.abs(dx)<8||Math.abs(dx)<Math.abs(dy))return; armed=true; tr.classList.add('mis-swiping'); }
        if(dx<0){ ev.preventDefault(); tr.style.transition='none'; tr.style.transform='translateX('+Math.max(dx,-88)+'px)'; }
      }
      function up(){
        document.removeEventListener('pointermove',move);
        document.removeEventListener('pointerup',up);
        tr.classList.remove('mis-swiping');
        tr.style.transition='transform .15s'; tr.style.transform='';
        if(armed&&dx<-44) misSwipeToggle(Number(tr.dataset.id));
      }
      document.addEventListener('pointermove',move);
      document.addEventListener('pointerup',up);
    });
  });
}
window.misSwipeToggle=async function(id){
  const row=(window._misRows||[]).find(r=>r.id===id);
  if(!row)return;
  const nowHandled=!row.next_date_recorded_at;
  const {error}=await sb.from('mis_cases').update({next_date_recorded_at:nowHandled?todayStr():null}).eq('id',id);
  if(error){toast('Could not update: '+error.message,'err');return;}
  row.next_date_recorded_at=nowHandled?todayStr():null;
  const cb=document.querySelector('#misTbody tr[data-id="'+id+'"] .mis-row-cb');
  if(cb){
    cb.checked=nowHandled; cb.disabled=nowHandled; cb.classList.toggle('mis-handled',nowHandled);
    // Going grey always drops it from the bulk-selection set — "handled" and "selected" are
    // mutually exclusive states for this checkbox.
    if(nowHandled&&window._misSel.has(id)){
      window._misSel.delete(id); const tr=cb.closest('tr'); if(tr)tr.classList.remove('mis-selected'); misUpdateToolbar();
    }
  }
  toast(nowHandled?'Marked handled — recorded today':'Unmarked','ok');
};
async function legalMIS(){
  setCrumb(['Legal','MIS']);
  const hAct=$('legalHeadActions');if(hAct)hAct.innerHTML='';
  const body=$('legalBody');if(!body)return;
  loader(body);
  let rows=[];
  try{const {data,error}=await sb.from('mis_cases').select('*').order('id',{ascending:true});if(error)throw error;rows=data||[];}catch(e){toast((e&&e.message)||'Could not load MIS cases','err');}
  window._misRows=rows;
  window._misSel=new Set();
  const searchKeys=MIS_FIELDS.map(f=>f.k);
  rows.forEach(r=>{ r._blob=searchKeys.map(k=>String(r[k]||'')).join(' ␟ ').toLowerCase(); });
  // "Pinned" = currently showing on the Calendar (next_date_iso parsed and not in the past) — not a
  // stored flag, so it can never drift out of sync with what the Calendar actually shows.
  const todayS=todayStr();
  const misPinned=rows.filter(r=>r.next_date_iso&&r.next_date_iso>=todayS).sort((a,b)=>String(a.next_date_iso).localeCompare(String(b.next_date_iso)));
  const misRest=rows.filter(r=>!(r.next_date_iso&&r.next_date_iso>=todayS));
  const misOrdered=misPinned.concat(misRest);
  body.innerHTML=`
    <style>
      .mis-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}
      .mis-toolbar .mis-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-width:0}
      .mis-toolbar .mis-filters{display:flex;gap:8px;align-items:center;margin-left:auto;flex:1 1 260px;flex-wrap:wrap;min-width:0}
      .mis-search-wrap{position:relative;display:flex;align-items:center;flex:1;min-width:0}
      .mis-search-wrap i{position:absolute;left:10px;color:var(--slate);font-size:13px;pointer-events:none}
      .mis-search-wrap input{padding-left:30px;height:36px;width:100%;min-width:0;border:1px solid var(--line);border-radius:8px;font-size:13px;background:var(--bg-card);color:var(--ink)}
      .mis-search-wrap input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10)}
      select.mis-sel{height:36px;padding:0 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:var(--bg-card);color:var(--ink);cursor:pointer;min-width:150px}
      select.mis-sel:focus{outline:none;border-color:var(--brand)}
      .mis-count{font-size:12.5px;color:var(--slate);white-space:nowrap;padding:0 4px}
      .mis-ptag{display:inline-flex;align-items:center;padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:600;white-space:nowrap}
      .mis-ptag--red{background:#fee2e2;color:#991b1b}
      .mis-ptag--amber{background:#fef3c7;color:#92400e}
      .mis-ptag--green{background:#d1fae5;color:#065f46}
      .mis-ptag--gray{background:#f1f5f9;color:#475569}
      #misTbl{width:100%;border-collapse:collapse;font-size:13px;min-width:2200px;table-layout:fixed}
      #misTbl thead th{background:var(--bg-subtle,#f8fafc);font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--slate);padding:10px 12px;border-bottom:2px solid var(--line);text-align:left;white-space:nowrap}
      #misTbl tbody tr{border-bottom:1px solid var(--line-2);transition:background .12s;cursor:pointer}
      #misTbl tbody tr:hover{background:var(--bg-hover,#f8fafc)}
      #misTbl tbody tr.mis-selected{background:#eff6ff}
      #misTbl tbody tr.mis-ai-match{background:#fefaf0}
      .mis-ai-badge{margin-left:6px}
      #misTbl tbody td{padding:11px 12px;vertical-align:top}
      .mis-cb{width:16px;height:16px;cursor:pointer;accent-color:var(--brand)}
      .mis-cb:disabled{cursor:not-allowed}
      .mis-cb.mis-handled{accent-color:#94a3b8}
      .mis-cb-cell{display:flex;align-items:center;gap:11px}
      .mis-handle{touch-action:pan-y;-webkit-user-select:none;user-select:none}
      #misTbl tbody tr.mis-swiping{background:#eef2ff;-webkit-user-select:none;user-select:none}
      .mis-cell-clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;width:100%}
      #misTbl td,#misTbl th{overflow:hidden}
      @media(max-width:768px){
        .mis-toolbar{flex-direction:column;align-items:stretch}
        .mis-toolbar .mis-actions{width:100%}
        .mis-toolbar .mis-actions .btn{flex:1 1 auto;justify-content:center}
        .mis-count{width:100%;text-align:center;order:99}
        .mis-toolbar .mis-filters{margin-left:0;width:100%}
        .mis-search-wrap{width:100%}
        .mis-search-wrap input{min-width:0;width:100%}
        select.mis-sel{min-width:0;width:100%}
        #misTbl{min-width:1500px;font-size:12.5px}
        #misTbl thead th,#misTbl tbody td{padding:9px 8px}
      }
    </style>
    <div class="mis-toolbar">
      <div class="mis-actions">
        <button class="btn btn-primary" onclick="misCreate()"><i class="fa-solid fa-plus"></i> Add Case</button>
        <button class="btn" id="misEditBtn" onclick="misEditSel()" disabled style="opacity:.45"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn" id="misDelBtn" onclick="misDeleteSel()" disabled style="opacity:.45;color:var(--err);border-color:var(--err)"><i class="fa-solid fa-trash"></i> Delete</button>
        <span class="mis-count" id="misCount">${rows.length} cases</span>
      </div>
      <div class="mis-filters">
        <div class="mis-search-wrap">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input id="misSearch" placeholder="Search anything — a value, a column name, or e.g. &quot;priority is empty&quot;" oninput="misFilter()">
        </div>
        <span class="mis-count" id="misAiStatus"></span>
      </div>
    </div>
    <div class="card" style="overflow:hidden">
      <div style="overflow-x:auto">
      <table id="misTbl">
        <colgroup><col style="width:60px">${MIS_FIELDS.map(f=>`<col style="width:${MIS_WIDTH[f.k]||140}px">`).join('')}</colgroup>
        <thead><tr>
          <th style="width:60px"><input type="checkbox" class="mis-cb" id="misChkAll" onchange="misToggleAll(this)"></th>
          ${MIS_FIELDS.map(f=>`<th>${esc(f.l)}</th>`).join('')}
        </tr></thead>
        <tbody id="misTbody">
          ${misPinned.map(r=>misRowHtml(r,true)).join('')}
          ${misPinned.length&&misRest.length?`<tr class="mis-spacer" style="cursor:default"><td colspan="${MIS_FIELDS.length+1}" style="height:18px;background:var(--bg-subtle,#f8fafc);border-bottom:2px solid var(--line)"></td></tr>`:''}
          ${misRest.map(r=>misRowHtml(r,false)).join('')}
        </tbody>
      </table>
      </div>
    </div>`;
  misWireSwipe();
}
// Score = how far ahead of the deadline the case was actually handled, using the confirmed rule:
// gap = Next Date − Recorded Date (days). gap>7 -> +1 (handled well ahead), 0..7 -> 0 (cut it
// close), gap<=0 (recorded on/after the Next Date) -> -1 (missed/late). No score yet if the
// "Handled" checkbox in MIS hasn't been ticked for this Next Date.
function misScoreOf(r){
  if(!r.next_date_recorded_at||!r.next_date_iso)return null;
  const gap=Math.round((new Date(r.next_date_iso+'T00:00:00')-new Date(r.next_date_recorded_at+'T00:00:00'))/86400000);
  if(gap>7)return 1;
  if(gap>=0)return 0;
  return -1;
}
function misScoreTag(s){
  if(s===null)return '<span class="mis-ptag mis-ptag--gray">Pending</span>';
  if(s===1)return '<span class="mis-ptag mis-ptag--green">+1</span>';
  if(s===0)return '<span class="mis-ptag mis-ptag--amber">0</span>';
  return '<span class="mis-ptag mis-ptag--red">−1</span>';
}
async function legalScoreboard(){
  setCrumb(['Legal','Scoreboard']);
  const hAct=$('legalHeadActions');if(hAct)hAct.innerHTML='';
  const body=$('legalBody');if(!body)return;
  loader(body);
  let rows=[];
  try{
    const todayS=todayStr();
    const {data,error}=await sb.from('mis_cases').select('id,case_type,cause_title,case_no,priority,next_date_iso,next_date_recorded_at').gte('next_date_iso',todayS).order('next_date_iso',{ascending:true});
    if(error)throw error; rows=data||[];
  }catch(e){toast((e&&e.message)||'Could not load Scoreboard','err');}
  // Total only sums cases that actually have a score yet (checkbox ticked) — "Pending" ones
  // shouldn't silently count as 0 and dilute the total for cases nobody has acted on yet.
  const scored=rows.map(misScoreOf).filter(s=>s!==null);
  const scoreTotal=scored.reduce((a,s)=>a+s,0);
  body.innerHTML=`<div class="card" style="overflow:hidden"><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="background:var(--bg-subtle,#f8fafc)">
      ${['Case Type','Cause Title / Parties','Case No.','Priority','Next Date','Recorded Date','Score'].map(l=>`<th style="padding:10px 12px;text-align:left;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--slate);border-bottom:2px solid var(--line)">${esc(l)}</th>`).join('')}
    </tr></thead>
    <tbody>
      ${rows.length?rows.map(r=>{
        const score=misScoreOf(r);
        return `<tr style="border-bottom:1px solid var(--line-2)">
          <td style="padding:11px 12px;font-weight:600">${esc(r.case_type||'—')}</td>
          <td style="padding:11px 12px">${esc(r.cause_title||'—')}</td>
          <td style="padding:11px 12px;color:var(--slate)">${esc(r.case_no||'—')}</td>
          <td style="padding:11px 12px">${misPriorityTag(r.priority)}</td>
          <td style="padding:11px 12px;color:var(--slate)">${fmtDate(r.next_date_iso)}</td>
          <td style="padding:11px 12px;color:var(--slate)">${r.next_date_recorded_at?fmtDate(r.next_date_recorded_at):'—'}</td>
          <td style="padding:11px 12px">${misScoreTag(score)}</td>
        </tr>`;
      }).join(''):`<tr><td colspan="7"><div class="empty" style="padding:30px"><i class="fa-regular fa-calendar-check"></i><div>No cases currently pinned to the Calendar (need a parseable, upcoming Next Date in MIS)</div></div></td></tr>`}
    </tbody>
    ${rows.length?`<tfoot><tr style="background:var(--bg-subtle,#f8fafc)">
      <td colspan="6" style="padding:11px 12px;text-align:right;font-weight:700;border-top:2px solid var(--line)">Total (${scored.length} scored of ${rows.length})</td>
      <td style="padding:11px 12px;font-weight:800;border-top:2px solid var(--line)">${scoreTotal>0?'+':''}${scoreTotal}</td>
    </tr></tfoot>`:''}
  </table></div></div>`;
}
window.misRowCheck=function(cb){
  const id=Number(cb.dataset.id);
  if(cb.checked) window._misSel.add(id); else window._misSel.delete(id);
  cb.closest('tr').classList.toggle('mis-selected',cb.checked);
  misUpdateToolbar();
};
window.misToggleAll=function(master){
  document.querySelectorAll('.mis-row-cb').forEach(cb=>{
    const tr=cb.closest('tr');
    if(tr.style.display==='none')return;
    cb.checked=master.checked;
    const id=Number(cb.dataset.id);
    if(master.checked) window._misSel.add(id); else window._misSel.delete(id);
    tr.classList.toggle('mis-selected',master.checked);
  });
  misUpdateToolbar();
};
window.misUpdateToolbar=function(){
  const n=window._misSel.size;
  const editBtn=$('misEditBtn'),delBtn=$('misDelBtn');
  if(editBtn){editBtn.disabled=(n!==1);editBtn.style.opacity=(n===1)?'1':'.45';}
  if(delBtn){delBtn.disabled=(n===0);delBtn.style.opacity=(n>0)?'1':'.45';}
};
const MIS_ALIASES={
  case_type:['case type','type of case'],
  cause_title:['cause title','parties','party'],
  case_no:['case no.','case no','case number','caseno'],
  previous_date:['previous date'],
  next_date:['next date'],
  priority:['priority'],
  advocate_incharge:['advocate in-charge','advocate incharge','advocate in charge','advocate'],
  court:['court'],
  status:['status','purpose'],
  remarks:['remarks','remark'],
  project_land_name:['project / land','project/land','project land','project name','land name','project'],
  date_of_filing:['date of filing','filing date'],
  pc_in_charge:['pc in-charge','pc incharge','pc in charge','pc'],
  file_no:['file no.','file no','file number'],
  cnr_no:['cnr no.','cnr no','cnr number']
};
function misKeywords(q){
  const stop=new Set(['give','giv','show','find','all','the','rows','row','cases','case','which','are','is','where','that','having','with','for','of','a','an','me','list','display','get','or','and','this','these']);
  return q.split(/[^a-z0-9]+/).filter(w=>w&&!stop.has(w));
}
function misParseQuery(raw){
  const q=(raw||'').toLowerCase().trim();
  if(!q)return {type:'none'};
  const candidates=[];
  Object.keys(MIS_ALIASES).forEach(k=>{
    MIS_ALIASES[k].forEach(alias=>{
      if(alias.length<3)return;
      let idx=-1;
      while((idx=q.indexOf(alias, idx+1))!==-1){ candidates.push({k, alias, start:idx, end:idx+alias.length}); }
    });
  });
  if(!candidates.length) return {type:'keywords', words:misKeywords(q)};
  // longest alias first at any given position, then earliest position
  candidates.sort((a,b)=> a.start-b.start || (b.end-b.start)-(a.end-a.start));
  const picked=[];
  let lastEnd=-1;
  candidates.forEach(c=>{ if(c.start>=lastEnd){ picked.push(c); lastEnd=c.end; } });

  const conds=[];
  for(let i=0;i<picked.length;i++){
    const c=picked[i];
    const nextStart=(i+1<picked.length)?picked[i+1].start:q.length;
    let arg=q.slice(c.end, nextStart).trim();
    arg=arg.replace(/^(is|are|:|=|contains|has|with|of|for|,|the)\s*/,'').trim();
    arg=arg.replace(/^(is|are)\s*/,'').trim();
    if(/^(not\s*(empty|blank)|filled|present|not\s*missing)\b/.test(arg)){
      conds.push({type:'filled', field:c.k});
    } else if(/^(empty|blank|missing|null)\b/.test(arg)){
      conds.push({type:'empty', field:c.k});
    } else if(arg){
      conds.push({type:'value', field:c.k, value:arg});
    }
  }
  if(!conds.length) return {type:'keywords', words:misKeywords(q)};
  return {type:'fields', conds};
}
window.misFilter=function(){
  const raw=($('misSearch').value||'').trim();
  const q=raw.toLowerCase();
  const wantsCompleteness=q.indexOf('completeness')!==-1;
  if(wantsCompleteness&&!window._misCompletenessOpen){ window._misCompletenessOpen=true; misStats(); }
  else if(!wantsCompleteness){ window._misCompletenessOpen=false; }
  const parsed=misParseQuery(q);
  let vis=0;
  document.querySelectorAll('#misTbody tr').forEach(tr=>{
    if(tr.classList.contains('mis-spacer')) return; // the pinned/rest divider row is never a searchable case
    const id=Number(tr.dataset.id);
    const row=(window._misRows||[]).find(r=>r.id===id);
    let show;
    if(!raw) show=true;
    else if(parsed.type==='fields'){
      show=!!row&&parsed.conds.every(cond=>{
        const v=row[cond.field];
        const empty=(v===null||v===undefined||String(v).trim()==='');
        if(cond.type==='empty')return empty;
        if(cond.type==='filled')return !empty;
        return !empty && String(v).toLowerCase().indexOf(cond.value)!==-1;
      });
    }
    else { const blob=row?row._blob:''; show=parsed.words&&parsed.words.length?parsed.words.every(w=>blob.indexOf(w)!==-1):(blob.indexOf(q)!==-1); }
    tr.style.display=show?'':'none';if(show)vis++;
  });
  const c=$('misCount');if(c)c.textContent=vis+' cases';
  document.querySelectorAll('#misTbody tr').forEach(tr=>{
    if(tr.style.display==='none'){
      const cb=tr.querySelector('.mis-row-cb');
      if(cb&&cb.checked){cb.checked=false;window._misSel.delete(Number(cb.dataset.id));tr.classList.remove('mis-selected');}
    }
  });
  misUpdateToolbar();
  // Instant substring search above stays as-is; this ADDS rows ChatGPT judges relevant in meaning
  // (e.g. "eviction" also finding a "tenant removal" row), a few hundred ms later, without touching
  // rows the fast keyword pass already matched.
  clearTimeout(window._misAiT);
  const qEl=$('misAiStatus'); if(qEl)qEl.textContent='';
  if(raw&&raw.length>=3) window._misAiT=setTimeout(()=>misAiSearch(raw),500);
};
window.misAiSearch=async function(raw){
  const statusEl=$('misAiStatus');
  try{
    if(statusEl)statusEl.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Checking for related cases…';
    const {data:{session}}=await sb.auth.getSession();
    const token=session&&session.access_token;
    const rows=(window._misRows||[]).map(r=>({id:r.id,case_type:r.case_type,cause_title:r.cause_title,case_no:r.case_no,status:r.status,remarks:r.remarks,court:r.court}));
    const res=await fetch(SUPABASE_URL+'/functions/v1/mis-ai-search',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},
      body:JSON.stringify({query:raw,rows})});
    const jr=await res.json().catch(()=>({}));
    if(($('misSearch')&&$('misSearch').value.trim().toLowerCase())!==raw)return; // query changed while we waited — drop stale results
    if(jr.error){ if(statusEl)statusEl.innerHTML='<i class="fa-solid fa-triangle-exclamation"></i> AI search unavailable ('+esc(String(jr.error).slice(0,60))+')'; return; }
    const ids=jr.ids||[];
    let added=0;
    ids.forEach(id=>{
      const tr=document.querySelector('#misTbody tr[data-id="'+id+'"]');
      if(tr && tr.style.display==='none'){ tr.style.display=''; tr.classList.add('mis-ai-match'); added++;
        if(!tr.querySelector('.mis-ai-badge')){ const td=tr.querySelector('td:last-child'); if(td)td.insertAdjacentHTML('beforeend',' <span class="mis-ai-badge mis-ptag mis-ptag--gray" title="Matched by meaning, not exact text"><i class="fa-solid fa-wand-magic-sparkles"></i> AI</span>'); }
      }
    });
    if(added){ const c=$('misCount'); if(c)c.textContent=(parseInt(c.textContent,10)||0)+added+' cases'; }
    if(statusEl)statusEl.textContent=added?added+' more found by meaning':'';
  }catch(e){ if(statusEl)statusEl.textContent=''; }
};
window.misCreate=function(){
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-gavel"></i> Add Case</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">${misFormHtml({})}</div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="misSaveBtn" onclick="misSave()"><i class="fa-solid fa-check"></i> Save</button></div>`,'lg');
};
function misCollect(){
  const row={};
  MIS_FIELDS.forEach(f=>{ const el=$('misF_'+f.k); row[f.k]=el?(((el.value||'').trim())||null):null; });
  return row;
}
window.misSave=async function(){
  const row=misCollect();
  if(!row.cause_title&&!row.case_no){toast('Enter at least a Cause Title or Case No.','err');return;}
  const btn=$('misSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  row.created_by=state.email;
  const {error}=await sb.from('mis_cases').insert(row);
  if(error){toast(error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Save';}return;}
  closeModal();toast('Case added','ok');legalMIS();
};
window.misEditSel=function(){
  const sel=[...window._misSel];
  if(sel.length===0){toast('Select a case first','err');return;}
  if(sel.length>1){toast('Select only one case to edit','err');return;}
  misEdit(sel[0]);
};
window.misEdit=async function(id){
  const r=(window._misRows||[]).find(x=>x.id===id);if(!r)return;
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-pen"></i> Edit Case</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">${misFormHtml(r)}</div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="misSaveBtn" onclick="misUpdate(${id})"><i class="fa-solid fa-check"></i> Update</button></div>`,'lg');
};
window.misUpdate=async function(id){
  const row=misCollect();
  const btn=$('misSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const {error}=await sb.from('mis_cases').update(row).eq('id',id);
  if(error){toast(error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Update';}return;}
  closeModal();toast('Updated','ok');legalMIS();
};
window.misDeleteSel=async function(){
  const sel=[...window._misSel];
  if(!sel.length)return;
  if(!await confirmDialog('Delete '+sel.length+' case'+(sel.length>1?'s':'')+'?'))return;
  const {error}=await sb.from('mis_cases').delete().in('id',sel);
  if(error){toast(error.message,'err');return;}
  toast(sel.length>1?(sel.length+' cases deleted'):'Case deleted','ok');
  legalMIS();
};
window.misStats=function(){
  const rows=window._misRows||[];
  const total=rows.length;
  const stats=MIS_FIELDS.map(f=>{
    const filled=rows.filter(r=>{const v=r[f.k];return v!==null&&v!==undefined&&String(v).trim()!=='';}).length;
    const blank=total-filled;
    const pct=total?Math.round(blank/total*100):0;
    return {l:f.l,filled,blank,pct};
  }).sort((a,b)=>b.blank-a.blank);
  const rowsHtml=stats.map(s=>`<tr><td style="font-weight:600">${esc(s.l)}</td><td style="color:var(--slate)">${s.filled} / ${total}</td><td style="color:${s.blank?'#b91c1c':'var(--slate)'}">${s.blank} (${s.pct}%)</td></tr>`).join('');
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-chart-simple"></i> Field Completeness — ${total} cases</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body">
    <div style="overflow-x:auto"><table class="tbl" style="width:100%;font-size:13px">
      <thead><tr><th style="text-align:left">Field</th><th style="text-align:left">Filled</th><th style="text-align:left">Blank</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>
  </div>
  <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Close</button></div>`,'lg');
};

/* ============================ TASK & DELEGATION ============================ */
let PEOPLE=null;
async function getPeople(){
  if(PEOPLE)return PEOPLE;
  const map={};
  try{const {data}=await sb.schema('acc').rpc('people');(data||[]).forEach(e=>{if(e.email)map[e.email]={email:e.email,name:e.full_name||e.email,depts:Array.isArray(e.department)?e.department:[]};});}catch(e){}
  try{const {data}=await sb.schema('hr').from('employees').select('full_name,email');(data||[]).forEach(e=>{if(e.email&&!map[e.email])map[e.email]={email:e.email,name:e.full_name};});}catch(e){}
  if(!map[state.email])map[state.email]={email:state.email,name:(state.profile&&state.profile.full_name)||state.email};
  PEOPLE=Object.values(map);return PEOPLE;
}
function nameOf(email){if(!email)return '—';const p=(PEOPLE||[]).find(x=>x.email===email);return p?p.name:email.split('@')[0];}
function taskTabs(active){
  const t=[['','Home','fa-house'],['list','Projects','fa-diagram-project'],['scoreboard','Scoreboard','fa-trophy']];
  return '<div class="tabs">'+t.map(x=>`<div class="tab ${active===x[0]?'active':''}" onclick="location.hash='#/tasks${x[0]?'/'+x[0]:''}'"><i class="fa-solid ${x[2]}"></i> ${x[1]}</div>`).join('')+'</div>';
}

VIEWS.tasks=async function(v,seg){
  await getPeople();
  // reset list filters on every fresh navigation into Accountability (not on in-page filter changes)
  PFILTER.prio='All';PFILTER.status='All';
  GFILTER.prio='All';GFILTER.status='All';
  PJTFILTER.status='All';PJTFILTER.person='All';PJTFILTER.stage='All';GLTFILTER.status='All';
  GSCOPE='personal';
  // first-login onboarding gate
  if((!state.profile||!state.profile.onboarded)&&seg[0]!=='profile'){return taskOnboard(v);}
  if(seg[0]==='profile')return taskProfile(v);
  if(seg[0]==='view')return taskDetail(v,seg[1],seg[2]);
  if(seg[0]==='project'&&seg[1]==='none')return noProjectDetail(v);
  if(seg[0]==='project')return projectDetail(v,seg[1]);
  if(seg[0]==='goal')return goalDetail(v,seg[1]);
  if(seg[0]==='goals')return taskGoals(v);
  if(seg[0]==='scoreboard')return taskScoreboard(v);
  if(seg[0]==='list'||seg[0]==='projects')return taskProjects(v);
  return taskHome(v);
};

/* ---------- onboarding ---------- */
/* ---------- Reporting-manager picker — single-select, but shares the exact same
   .ms-field/.ms-panel/.ms-list/.ms-dept/.ms-opt styling + open/close/positioning
   behaviour as the "person picker" used elsewhere (msHtml/msOpen/msFieldClick) ---------- */
const RM_STATE={people:[],sel:''};
function rmOptRow(p,on){ return '<div class="ms-opt'+(on?' on':'')+'" onclick="rmPick(\''+esc(p.email)+'\')">'+avatar(p.name)+' <span style="flex:1">'+esc(p.name)+'</span>'+(on?' <i class="fa-solid fa-check" style="color:var(--brand)"></i>':'')+'</div>'; }
function rmListHtml(q){
  q=(q||'').toLowerCase();
  const people=RM_STATE.people.filter(p=>!q||(p.name||'').toLowerCase().includes(q)||(p.email||'').toLowerCase().includes(q));
  const noneOn=!RM_STATE.sel;
  const noneRow='<div class="ms-opt'+(noneOn?' on':'')+'" onclick="rmPick(\'\')"><span style="width:22px;height:22px;border-radius:50%;background:#e2e8f0;display:inline-flex;align-items:center;justify-content:center;color:#64748b;font-size:10px;flex:none">—</span> <span style="flex:1">None</span>'+(noneOn?' <i class="fa-solid fa-check" style="color:var(--brand)"></i>':'')+'</div>';
  if(!people.length) return noneRow+'<div style="padding:10px;color:#94a3b8;font-size:13px">No matches</div>';
  return noneRow+groupByDept(people).map(g=>'<div class="ms-dept">'+esc(g.dept)+'</div>'+g.people.map(p=>rmOptRow(p,p.email===RM_STATE.sel)).join('')).join('');
}
function rmChipsHtml(){
  const p=RM_STATE.people.find(x=>x.email===RM_STATE.sel);
  return p?('<span class="ms-chip">'+avatar(p.name)+' '+esc(p.name)+' <i class="fa-solid fa-xmark" onclick="event.stopPropagation();rmPick(\'\')"></i></span>'):'<span style="color:#94a3b8;font-size:13px">None</span>';
}
function rmPickerHtml(people,currentEmail){
  RM_STATE.people=(people||[]).filter(p=>p.email!==state.email);
  RM_STATE.sel=currentEmail||'';
  return '<label>Reporting manager <span style="color:var(--slate);font-weight:400">(optional — can add later)</span></label>'+
    '<input type="hidden" id="obMgr" value="'+esc(currentEmail||'')+'">'+
    '<div class="ms" id="ms_rm">'+
      '<div class="ms-field" onclick="msFieldClick(\'rm\',event)">'+
        '<span class="ms-chips" id="ms_rm_chips">'+rmChipsHtml()+'</span>'+
        '<input class="ms-typein" id="ms_rm_in" placeholder="Search people…" autocomplete="off" oninput="msOpen(\'rm\');rmRenderList()" onfocus="msOpen(\'rm\')" onclick="event.stopPropagation()">'+
        '<i class="fa-solid fa-chevron-down" style="color:#94a3b8;font-size:12px"></i>'+
      '</div>'+
      '<div class="ms-panel" id="ms_rm_panel"><div class="ms-list" id="ms_rm_list">'+rmListHtml('')+'</div></div>'+
    '</div>';
}
function rmRenderList(){ const list=$('ms_rm_list'); if(!list)return; const q=($('ms_rm_in')||{}).value||''; list.innerHTML=rmListHtml(q); }
window.rmPick=function(email){
  RM_STATE.sel=email||'';
  if($('obMgr'))$('obMgr').value=email||'';
  const chips=$('ms_rm_chips'); if(chips)chips.innerHTML=rmChipsHtml();
  const inp=$('ms_rm_in'); if(inp)inp.value='';
  rmRenderList();
  const panel=$('ms_rm_panel'); if(panel)panel.classList.remove('show');
};

async function taskOnboard(v){
  setCrumb(['Accountability','Set up profile']);
  const people=await getPeople();
  const fetchedName=(state.profile&&state.profile.full_name)||(state.roles&&state.roles.full_name)||(state.user&&state.user.user_metadata&&state.user.user_metadata.full_name)||'';
  const deptVal=(state.profile&&state.profile.department)||'';
  v.innerHTML=`<div style="max-width:680px;margin:10px auto">
    <div class="card card-pad" style="text-align:center;padding:32px">
      <div class="ic" style="width:60px;height:60px;border-radius:14px;background:var(--brand-50);color:var(--brand);display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto 14px"><i class="fa-solid fa-list-check"></i></div>
      <h1 style="font-size:22px">Welcome to Accountability</h1>
      <p style="color:var(--slate);margin-top:6px">Let's set up your profile. This is account-specific and powers your tasks, delegation and scoreboard.</p>
    </div>
    <div class="card card-pad frm" style="margin-top:16px">
      <div class="two"><div><label>Full name</label><input id="obName" value="${esc(fetchedName)}"></div>
      <div><label>Designation <span style="color:var(--slate);font-weight:400">(optional)</span></label><input id="obDesig" placeholder="e.g. Project Manager" value="${esc((state.profile&&state.profile.designation)||'')}"></div></div>
      <div class="two"><div><label>Department</label><input id="obDept" disabled value="${esc(deptVal)}" placeholder="Not assigned yet" style="background:#f1f5f9;color:var(--slate);cursor:not-allowed"></div>
      <div>${rmPickerHtml(people,(state.profile&&state.profile.reporting_manager)||'')}</div></div>
      <div style="margin-top:20px;display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="taskOnboardSave()"><i class="fa-solid fa-check"></i> Complete setup</button></div>
      <p style="color:var(--slate);font-size:12px;margin-top:12px;text-align:center">Department is assigned by your administrator. Anyone can delegate work to anyone — no extra permission needed.</p>
    </div></div>`;
}

window.taskOnboardSave=async function(){
  const name=$('obName').value.trim();if(!name){toast('Enter your name','err');return;}
  const row={email:state.email,full_name:name,designation:$('obDesig').value,reporting_manager:$('obMgr').value||null,onboarded:true,avatar_color:colorFor(state.email)};
  const {error}=await sb.schema('acc').from('user_profile').upsert(row,{onConflict:'email'});
  if(error){toast(error.message,'err');return;}
  state.profile=Object.assign(state.profile||{},row);PEOPLE=null;toast('Profile saved','ok');location.hash='#/tasks';route();
};
async function taskProfile(v){
  await taskOnboard(v);
  setCrumb(['Accountability','My Profile']);
  // preselect existing values
  if(state.profile){
    if(state.profile.designation)$('obDesig').value=state.profile.designation;
  }
}

/* ---------- task data ---------- */
async function fetchTasks(filter){
  let qb=sb.schema('acc').from('tasks').select('*').order('due_date',{ascending:true});
  if(filter==='delegation')qb=qb.eq('kind','delegation');
  const {data,error}=await qb;if(error){toast(error.message,'err');return [];}return data||[];
}
async function fetchTaskMemberships(me){
  // myTaskIds = tasks where I am listed as a member
  const {data:myRows}=await sb.schema('acc').from('task_members').select('task_id').eq('email',me);
  const myTaskIds=new Set((myRows||[]).map(r=>r.task_id));
  // sharedTaskIds = all task_ids that have ANY member entry (= "shared" tasks)
  const {data:allRows}=await sb.schema('acc').from('task_members').select('task_id');
  const sharedTaskIds=new Set((allRows||[]).map(r=>r.task_id));
  return {myTaskIds,sharedTaskIds};
}
async function fetchGoalMemberships(me){
  const {data:myRows}=await sb.schema('acc').from('goal_members').select('goal_id').eq('email',me);
  const myGoalIds=new Set((myRows||[]).map(r=>r.goal_id));
  return {myGoalIds};
}
/* anyone assigned to a task inside a Project/Goal automatically becomes a member of that Project/Goal, so they can actually see it */
async function syncParentMembership(projectId,goalId,emails){
  const list=[...new Set((emails||[]).filter(Boolean))];
  if(!list.length)return;
  if(projectId){
    const {data:cur}=await sb.schema('acc').from('project_members').select('email').eq('project_id',projectId);
    const have=new Set((cur||[]).map(m=>m.email));
    const toAdd=list.filter(e=>!have.has(e));
    if(toAdd.length)await sb.schema('acc').from('project_members').insert(toAdd.map(e=>({project_id:projectId,email:e})));
  }
  if(goalId){
    const {data:cur}=await sb.schema('acc').from('goal_members').select('email').eq('goal_id',goalId);
    const have=new Set((cur||[]).map(m=>m.email));
    const toAdd=list.filter(e=>!have.has(e));
    if(toAdd.length)await sb.schema('acc').from('goal_members').insert(toAdd.map(e=>({goal_id:goalId,email:e})));
  }
}
/* every hand-off of a project task is a delegation edge — this is what makes the task visible to both
   sides and lets approval climb back up the chain later */
async function insertDelegationEdges(taskId,delegator,delegatees){
  const list=[...new Set((delegatees||[]).filter(e=>e&&e!==delegator))];
  if(!list.length)return;
  // ignoreDuplicates — a delegatee can only ever have one edge per task (enforced by a unique constraint
  // on task_id+delegatee), so a double-click or re-adding someone already in the chain just silently
  // no-ops instead of erroring.
  await sb.schema('acc').from('task_delegations').upsert(list.map(e=>({task_id:taskId,delegator,delegatee:e})),{onConflict:'task_id,delegatee',ignoreDuplicates:true});
}
/* Removing someone from a task's Assignees has to prune their WHOLE branch, not just the one edge —
   otherwise a further sub-delegatee (e.g. Dibas removed, but Dibas already handed part of it to
   system3) is left dangling: still delegated-to on paper, just disconnected from anyone above them. */
async function cascadeDeleteDelegationBranch(taskId,rootDelegatees){
  let frontier=[...new Set((rootDelegatees||[]).filter(Boolean))];
  const toDelete=new Set();
  for(let i=0;i<20&&frontier.length;i++){
    frontier.forEach(f=>toDelete.add(f));
    const {data:children}=await sb.schema('acc').from('task_delegations').select('delegatee').eq('task_id',taskId).in('delegator',frontier);
    frontier=[...new Set((children||[]).map(c=>c.delegatee).filter(d=>!toDelete.has(d)))];
  }
  if(toDelete.size)await sb.schema('acc').from('task_delegations').delete().eq('task_id',taskId).in('delegatee',[...toDelete]);
  return toDelete;
}
async function fetchProjectMemberships(me){
  const [{data:myRows},{data:myOwnerRows}]=await Promise.all([
    sb.schema('acc').from('project_members').select('project_id').eq('email',me),
    sb.schema('acc').from('project_owners').select('project_id').eq('email',me)
  ]);
  const myProjectIds=new Set([...(myRows||[]).map(r=>r.project_id),...(myOwnerRows||[]).map(r=>r.project_id)]);
  return {myProjectIds};
}
async function fetchMyProjects(me){
  let all=[];try{const {data}=await sb.schema('acc').from('projects').select('*').eq('archived',false).order('created_at',{ascending:false});all=data||[];}catch(e){}
  const {myProjectIds}=await fetchProjectMemberships(me);
  return all.filter(p=>p.owner===me||p.created_by===me||myProjectIds.has(p.id));
}
function bucketOf(t){
  if(t.archived)return 'Archived';
  if(t.status==='Completed')return 'Completed';
  const today=new Date();today.setHours(0,0,0,0);
  const due=t.due_date?new Date(t.due_date):null;
  if(due&&due<=today)return 'Due';
  if(due&&due>today)return 'Upcoming';
  return 'Current';
}

async function taskHome(v){
  setCrumb(['Accountability','Home']);
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-list-check" style="color:#1d4ed8"></i> Accountability</h1><p>Your personal command centre — Asana-style, account-specific</p></div>
    </div>`+taskTabs('')+`<div id="thBody"><div class="loader"><div class="spin"></div></div></div>`;
  const allRaw=await fetchTasks();
  const me=state.email;
  const {myTaskIds,sharedTaskIds}=await fetchTaskMemberships(me);
  let goals=[];try{const {data}=await sb.schema('acc').from('goals').select('*');goals=data||[];}catch(e){}
  const {myGoalIds}=await fetchGoalMemberships(me);
  const myProjects=await fetchMyProjects(me);
  // Team Tasks: shared tasks I'm involved in
  const teamTasks=allRaw.filter(t=>t.kind!=='delegation'&&sharedTaskIds.has(t.id)&&(myTaskIds.has(t.id)||t.owner===me||t.created_by===me||t.assigned_to===me));
  // Delegation widgets — standalone delegation-kind tasks + project-linked delegation-chain tasks
  let delOutIds=new Set(),delInIds=new Set();
  try{
    const [{data:outEdges},{data:inEdges}]=await Promise.all([
      sb.schema('acc').from('task_delegations').select('task_id').eq('delegator',me),
      sb.schema('acc').from('task_delegations').select('task_id').eq('delegatee',me)
    ]);
    (outEdges||[]).forEach(e=>delOutIds.add(e.task_id));
    (inEdges||[]).forEach(e=>delInIds.add(e.task_id));
  }catch(e){}
  const assignedToMe=allRaw.filter(t=>(t.kind==='delegation'&&t.assigned_to===me&&t.created_by!==me)||(t.project_id&&delInIds.has(t.id)));
  const assignedByMe=allRaw.filter(t=>(t.kind==='delegation'&&t.created_by===me&&t.assigned_to&&t.assigned_to!==me)||(t.project_id&&delOutIds.has(t.id)));
  const widget=(title,icon,col,items,empty,render)=>`<div class="card card-pad"><div class="sec-title"><i class="fa-solid ${icon}" style="color:${col}"></i> ${title} <span class="tag t-gray" style="margin-left:6px">${items.length}</span></div><div style="margin-top:10px">${items.length?items.slice(0,5).map(render||taskMini).join(''):'<div class="empty" style="padding:22px"><i class="fa-regular fa-circle-check"></i><div>'+empty+'</div></div>'}</div></div>`;
  // Completed this week (based on updated_at, which is touched whenever a task's status/progress changes)
  const weekAgo=new Date();weekAgo.setDate(weekAgo.getDate()-7);
  const completedThisWeek=allRaw.filter(t=>t.status==='Completed'&&t.updated_at&&new Date(t.updated_at)>=weekAgo).sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));
  const openTasks=allRaw.filter(t=>t.status!=='Completed'&&!t.archived);
  $('thBody').innerHTML=`<div class="grid grid-2 widget-grid">
    ${widget('Projects','fa-diagram-project','#1d4ed8',myProjects,'No projects yet',projectMini)}
    <div class="card card-pad"><div class="sec-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><span><i class="fa-solid fa-scale-balanced" style="color:#1d4ed8"></i> Workload</span><div class="seg" id="wlSeg"><button type="button" class="seg-btn on" onclick="wlSetMode('priority',this)">Priority</button><button type="button" class="seg-btn" onclick="wlSetMode('due',this)">Due Date</button></div></div><div id="wlBody" style="margin-top:8px"></div></div>
  </div>
  <div class="grid grid-2" style="margin-top:16px">
    ${widget('Assigned By Me','fa-share-nodes','#d97706',assignedByMe,'You have not delegated anything')}
    ${widget('Assigned To Me','fa-inbox','#7c3aed',assignedToMe,'Nothing delegated to you')}
  </div>
  <div class="card card-pad" style="margin-top:16px"><div class="sec-title"><i class="fa-solid fa-circle-check" style="color:#16a34a"></i> Completed This Week <span class="tag t-green" style="margin-left:6px">${completedThisWeek.length}</span></div><div style="margin-top:8px">${completedThisWeek.length?completedThisWeek.slice(0,6).map(completedMini).join(''):'<div class="empty" style="padding:22px"><i class="fa-regular fa-circle-check"></i><div>Nothing completed yet this week</div></div>'}</div></div>`;
  window.__openTasks=openTasks;
  window.__wlMode='priority';
  renderWorkload();
}
function completedMini(t){return `<div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--line-2);cursor:pointer" onclick="location.hash='#/tasks/view/${t.id}'"><div style="width:30px;height:30px;border-radius:50%;background:#f0fdf4;color:#16a34a;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0"><i class="fa-solid fa-check"></i></div><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#334155">${esc(t.title)}</div><div style="color:var(--slate);font-size:11.5px">${t.kind==='delegation'?'Delegation':'Task'} · completed ${relTime(t.updated_at)}</div></div><i class="fa-solid fa-chevron-right" style="color:#cbd5e1;font-size:11px"></i></div>`;}
function workloadMini(t){
  const overdue=!!(t.due_date&&new Date(t.due_date)<new Date(new Date().toDateString()));
  const urgent=t.priority==='Urgent';
  return `<div class="${(urgent||overdue)?'row-urgent':''}" style="display:flex;align-items:center;gap:11px;padding:9px 0 9px 6px;border-bottom:1px solid var(--line-2);cursor:pointer" onclick="location.hash='#/tasks/view/${t.id}'"><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title)}</div><div class="${overdue?'due-overdue':''}" style="color:var(--slate);font-size:11.5px">${prioTag(t.priority)} · ${t.due_date?(overdue?'Overdue · ':'Due ')+fmtDateShort(t.due_date):'No due date'}</div></div></div>`;
}
window.wlSetMode=function(mode,btn){
  document.querySelectorAll('#wlSeg .seg-btn').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
  window.__wlMode=mode;
  renderWorkload();
};
window.renderWorkload=function(){
  const mode=window.__wlMode||'priority';
  const items=window.__openTasks||[];
  let list;
  if(mode==='priority'){list=items.filter(t=>t.priority==='Urgent');}
  else{
    const ts=todayStr();const tmrw=new Date();tmrw.setDate(tmrw.getDate()+1);const tms=tmrw.toISOString().slice(0,10);
    list=items.filter(t=>t.due_date&&t.due_date>=ts&&t.due_date<=tms).slice().sort((a,b)=>new Date(a.due_date)-new Date(b.due_date));
  }
  $('wlBody').innerHTML=list.length?list.slice(0,6).map(workloadMini).join(''):`<div class="empty" style="padding:22px"><i class="fa-regular fa-circle-check"></i><div>${mode==='priority'?'No urgent tasks':'No tasks due today or tomorrow'}</div></div>`;
};
function taskMini(t){return `<div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--line-2);cursor:pointer" onclick="location.hash='#/tasks/view/${t.id}'"><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title)}</div><div style="color:var(--slate);font-size:11.5px"><span class="tag ${t.kind==='delegation'?'t-purple':'t-blue'}" style="padding:1px 7px;font-size:10px">${t.kind==='delegation'?'Delegation':'Task'}</span> · Due ${fmtDateShort(t.due_date)}</div></div><div style="width:42px;text-align:right;font-size:12px;font-weight:600;color:var(--brand)">${t.progress}%</div></div>`;}
function goalMini(g){return `<div style="padding:10px 0;border-bottom:1px solid var(--line-2);cursor:pointer" onclick="location.hash='#/tasks/goal/${g.id}'"><div style="display:flex;justify-content:space-between"><div style="font-weight:600;font-size:13px">${esc(g.name)}</div><span class="tag ${g.scope==='company'?'t-purple':g.scope==='team'?'t-blue':'t-gray'}">${esc(g.scope)}</span></div><div style="margin-top:4px">${prioTag(g.priority)} ${statusTag(g.status)}</div><div class="progress" style="margin-top:7px"><span style="width:${g.progress||0}%"></span></div></div>`;}
function projectMini(p){return `<div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--line-2);cursor:pointer" onclick="location.hash='#/tasks/project/${p.id}'"><div class="ic" style="width:32px;height:32px;border-radius:9px;background:#eff4ff;color:#1d4ed8;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0"><i class="fa-solid fa-diagram-project"></i></div><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</div><div style="color:var(--slate);font-size:11.5px">Owner ${esc(nameOf(p.owner||p.created_by))}</div></div><i class="fa-solid fa-chevron-right" style="color:#cbd5e1;font-size:12px"></i></div>`;}


/* ---------- create / edit task ---------- */
function peopleCheckboxes(cls,selected){selected=selected||[];return (PEOPLE||[]).map(p=>`<label style="display:inline-flex;align-items:center;gap:7px;padding:5px 9px;border:1px solid var(--line);border-radius:8px;margin:3px;cursor:pointer;font-size:12.5px;font-weight:500"><input type="checkbox" class="checkbox ${cls}" value="${esc(p.email)}" ${selected.includes(p.email)?'checked':''}> ${esc(p.name)}</label>`).join('');}
/* group a people array by department; people without one fall into "Unassigned" — depts with nobody in them simply never appear.
   Each person appears exactly ONCE, under a heading naming every department they belong
   to (comma-joined) — no duplicate rows for people in multiple departments. */
function groupByDept(list){
  const groups={};
  (list||[]).forEach(p=>{
    const raw=Array.isArray(p.depts)?p.depts:(Array.isArray(p.department)?p.department:(p.dept?[p.dept]:[]));
    const ds=raw.map(x=>String(x||'').trim()).filter(Boolean);
    const key=ds.length?ds.slice().sort().join(', '):'Unassigned';
    (groups[key]=groups[key]||[]).push(p);
  });
  return Object.keys(groups).sort((a,b)=>a==='Unassigned'?1:b==='Unassigned'?-1:a.localeCompare(b)).map(d=>({dept:d,people:groups[d]}));
}
function peopleOptions(sel,list){return groupByDept(list||PEOPLE).map(g=>`<optgroup label="${esc(g.dept)}">${g.people.map(p=>`<option value="${esc(p.email)}" ${p.email===sel?'selected':''}>${esc(p.name)}</option>`).join('')}</optgroup>`).join('');}

/* ---- reusable multi-select dropdown (everyone in the company) ---- */
const MS={};
function msHtml(key){return `<div class="ms" id="ms_${key}">
  <div class="ms-field" onclick="msFieldClick('${key}',event)">
    <span class="ms-chips" id="ms_${key}_chips"></span>
    <input class="ms-typein" id="ms_${key}_in" placeholder="Type to search…" autocomplete="off" oninput="msOpen('${key}');msRenderList('${key}')" onfocus="msOpen('${key}')" onclick="event.stopPropagation()">
    <i class="fa-solid fa-chevron-down" style="color:#94a3b8;font-size:12px"></i>
  </div>
  <div class="ms-panel" id="ms_${key}_panel">
    <div class="ms-list" id="ms_${key}_list"></div>
  </div></div>`;}
function msInit(key,selected,peopleList,ranked,locked){MS[key]={sel:new Set(selected||[]),people:peopleList||null,ranked:!!ranked,locked:new Set(locked||[])};(locked||[]).forEach(e=>MS[key].sel.add(e));msRenderChips(key);msRenderList(key);}
function ownerRankLabel(i){if(i<=0)return 'Owner';return 'Sub-'.repeat(i-1)+'Sub Owner';}
function msRenderChips(key){
  const c=document.getElementById('ms_'+key+'_chips');if(!c)return;
  const sel=[...MS[key].sel];
  const ranked=MS[key].ranked;
  const locked=MS[key].locked||new Set();
  c.innerHTML=sel.length?sel.map((e,i)=>`<span class="ms-chip">${ranked?`<b class="ms-rank">${ownerRankLabel(i)}</b>`:''}${avatar(nameOf(e))} ${esc(nameOf(e))} ${locked.has(e)?'<i class="fa-solid fa-lock" title="Always included"></i>':'<i class="fa-solid fa-xmark" onclick="event.stopPropagation();msPick(\''+key+'\',\''+esc(e)+'\')"></i>'}</span>`).join(''):'<span style="color:#94a3b8;font-size:13px">Select people…</span>';
}
function msRenderList(key){
  const list=document.getElementById('ms_'+key+'_list');if(!list)return;
  const q=(document.getElementById('ms_'+key+'_in')||{}).value||'';
  const ql=q.toLowerCase();
  const pool=(MS[key]&&MS[key].people)||PEOPLE||[];
  const people=pool.filter(p=>!ql||(p.name||'').toLowerCase().includes(ql)||(p.email||'').toLowerCase().includes(ql));
  if(!people.length){list.innerHTML='<div style="padding:10px;color:#94a3b8;font-size:13px">No matches</div>';return;}
  const locked=MS[key].locked||new Set();
  const optHtml=(p)=>{const on=MS[key].sel.has(p.email);const lk=locked.has(p.email);return `<div class="ms-opt ${on?'on':''}" ${lk?'':`onclick="msPick('${key}','${esc(p.email)}')"`}>${avatar(p.name)} <span style="flex:1">${esc(p.name)}</span> ${lk?'<i class="fa-solid fa-lock" style="color:#94a3b8;font-size:11px"></i>':on?'<i class="fa-solid fa-check" style="color:var(--brand)"></i>':''}</div>`;};
  list.innerHTML=groupByDept(people).map(g=>`<div class="ms-dept">${esc(g.dept)}</div>${g.people.map(optHtml).join('')}`).join('');
}
function msPositionPanel(key){
  const p=document.getElementById('ms_'+key+'_panel');
  const field=document.querySelector('#ms_'+key+' .ms-field');
  if(!p||!field)return;
  const r=field.getBoundingClientRect();
  p.style.position='fixed';p.style.top=(r.bottom+5)+'px';p.style.left=r.left+'px';p.style.width=r.width+'px';p.style.right='auto';
}
window.msOpen=function(key){
  const p=document.getElementById('ms_'+key+'_panel');if(!p)return;
  if(!p.classList.contains('show')){
    document.querySelectorAll('.ms-panel.show').forEach(x=>x.classList.remove('show'));
    msPositionPanel(key);
    p.classList.add('show');
  }
};
window.msFieldClick=function(key,e){if(e)e.stopPropagation();msOpen(key);const inp=document.getElementById('ms_'+key+'_in');if(inp)inp.focus();};
window.msToggle=function(key,e){if(e)e.stopPropagation();const p=document.getElementById('ms_'+key+'_panel');if(p&&p.classList.contains('show')){p.classList.remove('show');}else{msOpen(key);}};
window.msPick=function(key,email){const m=MS[key];if(m.locked&&m.locked.has(email))return;const s=m.sel;s.has(email)?s.delete(email):s.add(email);msRenderChips(key);const inp=document.getElementById('ms_'+key+'_in');if(inp){inp.value='';inp.focus();}msRenderList(key);msPositionPanel(key);};
function getMS(key){return MS[key]?[...MS[key].sel]:[];}
document.addEventListener('click',function(e){if(!e.target.closest('.ms'))document.querySelectorAll('.ms-panel.show').forEach(x=>x.classList.remove('show'));});
window.addEventListener('scroll',function(){document.querySelectorAll('.ms-panel.show').forEach(p=>{const key=p.id.replace(/^ms_/,'').replace(/_panel$/,'');msPositionPanel(key);});},true);
window.addEventListener('resize',function(){document.querySelectorAll('.ms-panel.show').forEach(p=>{const key=p.id.replace(/^ms_/,'').replace(/_panel$/,'');msPositionPanel(key);});});

/* ---- reusable single-select filter dropdown (styled like .ms) ---- */
function fsHtml(key,label,options,current,cb){
  current=current||'All';
  return `<div class="fs" id="fs_${key}">
    <div class="fs-field" onclick="fsToggle('${key}',event)"><i class="fa-solid fa-filter" style="font-size:10px;color:#94a3b8"></i><span class="fs-label">${esc(label)}</span><span class="fs-val">${esc(current)}</span><i class="fa-solid fa-chevron-down fs-chev"></i></div>
    <div class="fs-panel" id="fs_${key}_panel">
      <div class="fs-opt ${current==='All'?'on':''}" onclick="fsPick('${key}','All','${cb}')">All</div>
      ${options.map(o=>`<div class="fs-opt ${current===o?'on':''}" onclick="fsPick('${key}','${esc(o)}','${cb}')">${esc(o)}</div>`).join('')}
    </div>
  </div>`;
}
window.fsToggle=function(key,e){if(e)e.stopPropagation();const p=document.getElementById('fs_'+key+'_panel');const wrap=document.getElementById('fs_'+key);const open=p.classList.contains('show');document.querySelectorAll('.fs-panel.show').forEach(x=>x.classList.remove('show'));document.querySelectorAll('.fs.open').forEach(x=>x.classList.remove('open'));if(!open){p.classList.add('show');wrap.classList.add('open');}};
/* On phones, several fsHtml() pills sitting side by side wrap badly and eat vertical space.
   fsGroupHtml collapses any set of them into a single "Filters" dropdown containing one
   single-select group per original filter (still one pick per category, never multi-select) —
   desktop keeps showing the separate pills unchanged; only <=760px swaps to the combined one. */
function fsGroupHtml(groupKey,filters){
  filters=(filters||[]).filter(Boolean);
  if(!filters.length)return '';
  const activeCount=filters.filter(f=>f.current&&f.current!=='All').length;
  const desktopHtml=filters.map(f=>fsHtml(f.key,f.label,f.options,f.current,f.cb)).join('');
  const mobileBody=filters.map(f=>`<div class="fsg-group">
      <div class="fsg-group-label">${esc(f.label)}</div>
      <div class="fs-opt ${(!f.current||f.current==='All')?'on':''}" onclick="fsPick('${f.key}','All','${f.cb}')">All</div>
      ${f.options.map(o=>`<div class="fs-opt ${f.current===o?'on':''}" onclick="fsPick('${f.key}','${esc(o)}','${f.cb}')">${esc(o)}</div>`).join('')}
    </div>`).join('');
  return `<span class="fs-desktop-only">${desktopHtml}</span>
    <div class="fs fsg-combined" id="fs_${groupKey}">
      <div class="fs-field" onclick="fsToggle('${groupKey}',event)"><i class="fa-solid fa-filter" style="font-size:10px;color:#94a3b8"></i><span class="fs-label">Filters</span>${activeCount?`<span class="fs-val">${activeCount} active</span>`:''}<i class="fa-solid fa-chevron-down fs-chev"></i></div>
      <div class="fs-panel fsg-panel" id="fs_${groupKey}_panel">${mobileBody}</div>
    </div>`;
}
window.fsPick=function(key,val,cb){const p=document.getElementById('fs_'+key+'_panel');if(p)p.classList.remove('show');window[cb](val);};
document.addEventListener('click',function(e){if(!e.target.closest('.fs')){document.querySelectorAll('.fs-panel.show').forEach(x=>x.classList.remove('show'));document.querySelectorAll('.fs.open').forEach(x=>x.classList.remove('open'));}});
window.taskCreateModal=async function(kind,projectId,projectName,goalId,goalName){
  kind=kind||'task';const isDel=kind==='delegation';
  if(isDel && !(state.profile && state.profile.can_delegate)){toast('You are not permitted to delegate tasks. Enable it in your profile.','err');return;}
  const delList=(state.profile&&state.profile.delegate_to)||[];
  const assignPeople=isDel?(PEOPLE||[]).filter(p=>delList.includes(p.email)||state.super):(PEOPLE||[]);
  const dateOptional=!!((projectId||goalId)&&!isDel);
  let scopedPeople=null;
  if(!isDel&&projectId){
    const [{data:pmem},{data:proj},{data:powners}]=await Promise.all([
      sb.schema('acc').from('project_members').select('email').eq('project_id',projectId),
      sb.schema('acc').from('projects').select('owner,created_by').eq('id',projectId).single(),
      sb.schema('acc').from('project_owners').select('email').eq('project_id',projectId)
    ]);
    const emails=new Set((pmem||[]).map(m=>m.email));
    (powners||[]).forEach(o=>emails.add(o.email));
    if(proj){if(proj.owner)emails.add(proj.owner);if(proj.created_by)emails.add(proj.created_by);}
    scopedPeople=(PEOPLE||[]).filter(p=>emails.has(p.email));
  } else if(!isDel&&goalId){
    const [{data:gmem},{data:g}]=await Promise.all([
      sb.schema('acc').from('goal_members').select('email').eq('goal_id',goalId),
      sb.schema('acc').from('goals').select('owner,created_by').eq('id',goalId).single()
    ]);
    const emails=new Set((gmem||[]).map(m=>m.email));
    if(g){if(g.owner)emails.add(g.owner);if(g.created_by)emails.add(g.created_by);}
    scopedPeople=(PEOPLE||[]).filter(p=>emails.has(p.email));
  }
  const parentName=projectName||goalName;
  const ownerOpts=projectId?(scopedPeople||[]).filter(p=>p.email!==state.email):null;
  openModal(`<div class="modal-head"><h3><i class="fa-solid ${isDel?'fa-share-nodes':'fa-list-check'}"></i> ${isDel?'Delegate work':(parentName?'New task in '+esc(parentName):'New task')}</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>Title</label><input id="tkTitle" placeholder="What needs to be done?">
    <label>Description</label>
    <div style="border:1px solid var(--line);border-radius:8px;overflow:hidden">
      <div style="display:flex;gap:2px;padding:6px;border-bottom:1px solid var(--line);background:#fafbfd">
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('bold')"><b>B</b></button>
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('italic')"><i>I</i></button>
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('insertUnorderedList')"><i class="fa-solid fa-list-ul"></i></button>
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('insertOrderedList')"><i class="fa-solid fa-list-ol"></i></button>
      </div>
      <div id="tkDesc" contenteditable="true" style="min-height:80px;padding:10px 12px;font-size:13.5px;outline:none"></div>
    </div>
    ${isDel?`<label>Assign to</label><select id="tkAssignee">${assignPeople.length?peopleOptions('',assignPeople):'<option value="">No one available</option>'}</select>`:projectId?`<label>Assign to <span style="font-weight:400;color:var(--slate);text-transform:none;font-size:11.5px">— project members, excluding you</span></label>${msHtml('tkAssignTo')}`:`<label>Owner</label><select id="tkOwner">${peopleOptions(state.email)}</select>`}
    <label style="margin-top:14px">Due date${dateOptional?' (optional)':''}</label><input type="date" id="tkDue">
    ${(isDel||projectId)?'':`<label style="display:flex;align-items:center;gap:8px;margin-top:13px;cursor:pointer;text-transform:none;font-weight:500;font-size:13px"><input type="checkbox" class="checkbox" id="tkMultiToggle" onchange="tkToggleMembers(this.checked)"> Assign to more than one person</label>
    <div id="tkMembersWrap" style="display:none"><label>Members ${goalId?'<span style="font-weight:400;color:var(--slate);text-transform:none;font-size:11.5px">— only people in this goal</span>':''}</label>${msHtml('tkMembers')}</div>`}
    <label style="margin-top:14px">Attachment (optional)</label>
    <div class="dropzone" onclick="document.getElementById('tkFile').click()"><i class="fa-solid fa-paperclip"></i><div id="tkFName">Click to choose a file</div></div>
    <input type="file" id="tkFile" class="hidden" onchange="document.getElementById('tkFName').textContent=this.files[0]?this.files[0].name:'Click to choose a file'">
    <input type="hidden" id="tkProjectId" value="${projectId||''}">
    <input type="hidden" id="tkGoalId" value="${goalId||''}">
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="tkSave" onclick="taskSave('${kind}')"><i class="fa-solid fa-check"></i> ${isDel?'Delegate':'Create'}</button></div>`,'lg');
  if(projectId&&!isDel)setTimeout(()=>msInit('tkAssignTo',[],ownerOpts),30);
  else if(!isDel)setTimeout(()=>msInit('tkMembers',[],scopedPeople),30);
};
window.tkToggleMembers=function(on){const w=$('tkMembersWrap');if(w)w.style.display=on?'':'none';};
window.taskSave=async function(kind){
  const isDel=kind==='delegation';
  if(isDel && !(state.profile && state.profile.can_delegate)){toast('You are not permitted to delegate tasks.','err');return;}
  const title=$('tkTitle').value.trim();if(!title){toast('Enter a title','err');return;}
  const projIdRaw=$('tkProjectId')?$('tkProjectId').value:'';
  const projectId=projIdRaw?parseInt(projIdRaw):null;
  const goalIdRaw=$('tkGoalId')?$('tkGoalId').value:'';
  const goalId=goalIdRaw?parseInt(goalIdRaw):null;
  if(!isDel&&!projectId&&!goalId&&!$('tkDue').value){toast('Select a due date','err');return;}
  const desc=$('tkDesc').innerHTML;
  // Every task always starts life Pending — status from here on is driven entirely by the
  // Ask Approval / approval flow, never picked manually.
  const row={kind,title,description:desc,due_date:$('tkDue').value||null,progress:0,status:'Pending',created_by:state.email};
  if(projectId)row.project_id=projectId;
  if(goalId)row.goal_id=goalId;
  let mem=[];
  if(isDel){row.assigned_to=$('tkAssignee').value;row.owner=$('tkAssignee').value;}
  else if(projectId){
    const assignTo=getMS('tkAssignTo');
    if(!assignTo.length){toast('Select at least one person to assign this task to','err');return;}
    row.owner=assignTo[0];mem=assignTo.slice(1);
  }
  else{row.owner=$('tkOwner').value;mem=getMS('tkMembers');}
  if(projectId){
    const delegatees=[row.owner,...mem].filter(e=>e&&e!==state.email);
    if(delegatees.length&&!(state.profile&&state.profile.can_delegate)){toast('You are not permitted to delegate tasks. Enable it in your profile.','err');return;}
  }
  const btn=$('tkSave');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';
  const {data,error}=await sb.schema('acc').from('tasks').insert(row).select().single();
  if(error){toast(error.message,'err');btn.disabled=false;return;}
  if(!isDel&&mem.length)await sb.schema('acc').from('task_members').insert(mem.map(e=>({task_id:data.id,email:e})));
  if(projectId||goalId)await syncParentMembership(projectId,goalId,[row.owner,...mem]);
  if(projectId)await insertDelegationEdges(data.id,state.email,[row.owner,...mem]);
  // attachment
  const f=$('tkFile').files[0];
  if(f){const key=s3KeyForTask(data.id,isDel,f.name);const {data:upData,error:ue}=await uploadFileToS3(key,f);if(ue)toast('Task created, but attachment upload failed: '+ue.message,'err');else await sb.schema('acc').from('task_files').insert({task_id:data.id,file_name:f.name,storage_path:upData.path,file_size:f.size,uploaded_by:state.email});}
  await sb.schema('acc').from('task_activity').insert({task_id:data.id,actor:state.email,action:isDel?'delegated this task to '+nameOf(row.assigned_to):'created this task'});
  closeModal();toast(isDel?'Task delegated':'Task created','ok');
  if(goalId)await recalcGoalProgress(goalId);
  if(projectId)await recalcProjectProgress(projectId);
  location.hash='#/tasks/view/'+data.id;route();
};

/* ---------- task detail ---------- */
async function taskDetail(v,id,dgCtx){
  loader(v);
  const {data:t,error}=await sb.schema('acc').from('tasks').select('*').eq('id',id).single();
  if(error||!t){v.innerHTML='<div class="empty"><i class="fa-solid fa-ban"></i><div>Task not found or no access</div></div>';return;}
  let proj=null,goalP=null;
  if(t.project_id){try{const {data}=await sb.schema('acc').from('projects').select('id,name').eq('id',t.project_id).single();proj=data||null;}catch(e){}}
  if(t.goal_id){try{const {data}=await sb.schema('acc').from('goals').select('id,name').eq('id',t.goal_id).single();goalP=data||null;}catch(e){}}
  setCrumb(['Accountability',t.kind==='delegation'?'Delegation':[goalP?'Goals':'Projects',goalP?'#/tasks/goals':'#/tasks/list'],...(proj?[[proj.name,'#/tasks/project/'+proj.id]]:goalP?[[goalP.name,'#/tasks/goal/'+goalP.id]]:[]),t.title]);
  const [{data:members},{data:comments},{data:checklist},{data:files},{data:taskDgs},{data:apprRows}]=await Promise.all([
    sb.schema('acc').from('task_members').select('*').eq('task_id',id),
    sb.schema('acc').from('task_comments').select('*').eq('task_id',id).order('created_at'),
    sb.schema('acc').from('task_checklist').select('*').eq('task_id',id).order('sort'),
    sb.schema('acc').from('task_files').select('*').eq('task_id',id),
    sb.schema('acc').from('task_delegations').select('delegator,delegatee').eq('task_id',id),
    sb.schema('acc').from('task_approvals').select('*').eq('task_id',id)
  ]);
  const mem=members||[];const canEdit=true;
  // Anyone anywhere in this task's delegation chain (not just whoever currently holds it) can mark it
  // complete directly — e.g. the original delegator closing it out themselves. Approval still climbs
  // normally from whoever actually clicked it: a root delegator with no one above them auto-approves,
  // an intermediate delegator still needs their own delegator's sign-off.
  const inDelegationChain=(taskDgs||[]).some(d=>d.delegator===state.email||d.delegatee===state.email);
  // Members/Owner are scoped to WHICH TAB the viewer navigated in from, computed LOCALLY relative to
  // whoever's asking — not against the absolute graph root. My "received" group is whoever MY OWN direct
  // delegator handed this to (their full delegatee set, siblings + me) — that stays correct at any depth:
  // Prerna's received group is Administrator's delegatees {Dibas, Prerna}, but Akashnil's received group
  // is Prerna's delegatees {Akashnil} only, even though Administrator's group further up is {Dibas, Prerna}.
  // Viewing via "Assigned to me" (or no context) always shows my received group, no matter how much I've
  // since sub-delegated. Viewing via my OWN "Assigned by me" tab narrows to just whoever I personally
  // handed it to — not myself too, since I'm already shown separately as Owner right above. A root
  // delegator (nobody delegated it to them) always sees their own outgoing group the same way.
  const dgEdges=taskDgs||[];
  const myOutgoing=[...new Set(dgEdges.filter(d=>d.delegator===state.email).map(d=>d.delegatee))];
  const myIncoming=[...new Set(dgEdges.filter(d=>d.delegatee===state.email).map(d=>d.delegator))];
  const myDirectDelegator=myIncoming[0]||null;
  const receivedGroup=myDirectDelegator?[...new Set(dgEdges.filter(d=>d.delegator===myDirectDelegator).map(d=>d.delegatee))]:[];
  const fallbackTeam=[t.owner,...mem.map(m=>m.email)].filter(Boolean);
  let ownerEmail,originalTeam;
  if(!dgEdges.length){
    ownerEmail=t.owner||t.assigned_to||t.created_by;
    originalTeam=fallbackTeam;
  }else if(!myDirectDelegator){
    ownerEmail=state.email;
    originalTeam=myOutgoing.length?myOutgoing:fallbackTeam;
  }else if(dgCtx==='delegated'){
    ownerEmail=state.email;
    originalTeam=myOutgoing;
  }else{
    ownerEmail=myDirectDelegator;
    originalTeam=receivedGroup.length?receivedGroup:fallbackTeam;
  }
  const cl=checklist||[];const clTotal=cl.length;const clDone=cl.filter(c=>c.done).length;const clPct=clTotal?Math.round(clDone/clTotal*100):0;
  window.__TS_ITEMS=window.__TS_ITEMS||{};cl.forEach(c=>window.__TS_ITEMS[c.id]=c);
  window.__TS_ORDER=cl.map(c=>c.id);
  const dueHist=t.due_date_history||[];
  // Per-branch approval: each "Ask Approval" click created its own acc.task_approvals row that
  // climbs hop-by-hop (current_approver moves up the delegation chain). To find MY role in whichever
  // pending row is relevant to me, walk from that row's submitter up through task_delegations edges —
  // if I'm the current_approver, it's my turn; if I'm the submitter or anyone strictly between the
  // submitter and current_approver, my part is already signed off (shown as "Done") even though the
  // task overall is still climbing toward the true root Assignor. Anyone further up who hasn't been
  // reached yet (or who isn't in this branch at all) gets no row and sees a plain, name-free tag —
  // this is what keeps one branch's approval chatter from leaking into an unrelated branch/viewer.
  const allApprRows=apprRows||[];
  const pendingRows=allApprRows.filter(a=>a.decision==='pending');
  const roleResult=resolveApprovalRole(dgEdges,pendingRows,state.email);
  const myApprRow=roleResult?roleResult.row:null;
  const myApprRole=roleResult?roleResult.role:null;
  const latestApproved=allApprRows.filter(a=>a.decision==='approved').sort((a,b)=>new Date(b.decided_at)-new Date(a.decided_at))[0];
  const isPendingApproval=t.status==='Awaiting Approval';
  const approvalOld=myApprRole==='current_approver'&&myApprRow.requested_at&&(Date.now()-new Date(myApprRow.requested_at).getTime())>2*24*60*60*1000;
  const stageText=myApprRole==='current_approver'?` from ${esc(nameOf(myApprRow.submitter))}`:'';
  const awaitingLabel=myApprRole==='current_approver'?`Awaiting Approval${stageText}${approvalOld?' (2+ days)':''}`:myApprRole==='done'?'Done':'Awaiting Approval';
  const statusTagHtml=t.status==='Completed'?statusTag('Completed'):isPendingApproval?`<span class="tag ${myApprRole==='done'?'t-blue':approvalOld?'t-red':'t-amber'}">${esc(awaitingLabel)}</span>`:statusTag(t.status);
  const apprText=(t.status==='Completed'&&latestApproved)?` · Approved by ${esc(nameOf(latestApproved.decided_by))}`:'';
  const showApprovalButtons=isPendingApproval&&myApprRole==='current_approver';
  window.__TS_OPEN=window.__TS_OPEN||{};
  const tsOpen=!!window.__TS_OPEN[id];
  // The can_delegate profile toggle only gates handing out brand-new work (creating a task and
  // assigning it to someone else). Once a task has actually reached you through delegation, you can
  // always pass it on further — the chain has to be able to keep going indefinitely. This must check
  // the delegation chain (task_delegations), NOT t.owner/task_members directly — taskDelegateSave
  // reassigns owner and deletes task_members rows on every re-delegation, so someone still legitimately
  // in the chain (e.g. a co-assignee who hasn't delegated yet) would otherwise lose the button the
  // moment anyone else in the chain delegates further.
  const canDelegateThis=!!(t.project_id&&(inDelegationChain||t.owner===state.email||mem.some(m=>m.email===state.email))&&t.status!=='Completed');
  const isCurrentHolder=!t.project_id||t.owner===state.email||mem.some(m=>m.email===state.email);
  const canComplete=isCurrentHolder||inDelegationChain;
  const completeBtnHtml=t.status==='Completed'
    ?(!canComplete?`<button class="btn" disabled title="Only ${esc(nameOf(t.owner))} or someone in this task's delegation chain can reopen it"><i class="fa-solid fa-lock"></i> Completed</button>`
      :`<button class="btn btn-primary" onclick="taskMarkComplete(${id},false)"><i class="fa-solid fa-circle-check"></i> Completed</button>`)
    :isPendingApproval
    ?`<button class="btn" disabled><i class="fa-solid ${myApprRole==='done'?'fa-check':'fa-hourglass-half'}"></i> ${myApprRole==='done'?'Done':'Awaiting Approval'}</button>`
    :!canComplete
    ?`<button class="btn" disabled title="Only ${esc(nameOf(t.owner))} or someone in this task's delegation chain can ask for approval"><i class="fa-solid fa-lock"></i> Ask Approval</button>`
    :`<button class="btn" onclick="taskMarkComplete(${id},true)"><i class="fa-solid fa-paper-plane"></i> Ask Approval</button>`;
  // Same "Assigned/Delegated to {avatars} by {name}" treatment as the project row label, but computed
  // from this specific viewer's local hop (ownerEmail/originalTeam above) so it matches what's actually
  // shown in Details → Members just below it.
  const dgWord=!dgEdges.length?'':(!myDirectDelegator?'Assigned':dgCtx==='delegated'?(t.created_by===state.email?'Assigned':'Delegated'):(myDirectDelegator===t.created_by?'Assigned':'Delegated'));
  const subLabel=t.kind==='delegation'?'Delegated to <b>'+esc(nameOf(t.assigned_to))+'</b> by '+esc(nameOf(t.created_by)):t.project_id?(dgEdges.length?dgRowLabelHtml(dgWord,originalTeam,ownerEmail):'Delegated to <b>'+esc(nameOf(t.owner))+'</b> by '+esc(nameOf(t.created_by))):'Owned by <b>'+esc(nameOf(t.owner))+'</b>';
  v.innerHTML=`<div class="page-head"><div><button class="btn btn-sm" onclick="history.back()"><i class="fa-solid fa-arrow-left"></i> Back</button>
    ${proj?`<div style="margin-top:10px"><span class="tag t-blue" style="cursor:pointer" onclick="location.hash='#/tasks/project/${proj.id}'"><i class="fa-solid fa-diagram-project"></i> ${esc(proj.name)}</span></div>`:goalP?`<div style="margin-top:10px"><span class="tag t-amber" style="cursor:pointer" onclick="location.hash='#/tasks/goal/${goalP.id}'"><i class="fa-solid fa-bullseye"></i> ${esc(goalP.name)}</span></div>`:''}
    <h1 style="margin-top:10px">${t.kind==='delegation'?'<i class="fa-solid fa-share-nodes" style="color:#0f766e"></i> ':''}${esc(t.title)}</h1>
    <p>${subLabel} · ${statusTagHtml}${apprText}</p></div>
    <div class="th-actions">
      ${completeBtnHtml}
      <button class="btn" onclick="tkToggleTS(${id})"><i class="fa-solid fa-list-check"></i> Time Sheet${clTotal?` (${clDone}/${clTotal})`:''}</button>
      ${canDelegateThis?`<button class="btn" onclick="taskDelegateModal(${id},${t.project_id})"><i class="fa-solid fa-share-nodes"></i> Delegate</button>`:''}
      ${showApprovalButtons?`<div class="th-appr-grp">
        <button class="btn btn-ok" onclick="taskApprove(${myApprRow.id},${id})"><i class="fa-solid fa-check"></i> Approve</button>
        <button class="btn btn-danger-solid" onclick="taskDecline(${myApprRow.id},${id})"><i class="fa-solid fa-xmark"></i> Decline</button>
      </div>`:''}
    </div>
  </div>
  <div class="card card-pad"><div class="sec-title">Description</div><div style="margin-top:6px;font-size:14px;color:#334155;line-height:1.6">${t.description||'<span style="color:#94a3b8">No description</span>'}</div></div>
  <div class="${tsOpen?'grid grid-2':''}" style="margin-top:12px;align-items:start">
  ${tsOpen?`<div class="card card-pad"><div class="sec-title" style="display:flex;justify-content:space-between;align-items:center">Time sheet <span style="font-weight:400;color:var(--slate);text-transform:none;font-size:11.5px">optional</span> ${clTotal?`<span style="font-size:12px;font-weight:500;color:var(--slate)">${clDone}/${clTotal} · ${clPct}%</span>`:''}</div>
    ${clTotal?`<div class="progress" style="margin-top:8px"><span style="width:${clPct}%"></span></div>`:''}
    <div id="clList" style="margin-top:8px">${cl.map(c=>clItem(c,id)).join('')||'<div style="color:var(--slate);font-size:13px">No items yet — add one to start tracking progress.</div>'}</div>
    <button class="btn btn-sm btn-primary" style="margin-top:10px" onclick="subTaskModal(${id})"><i class="fa-solid fa-plus"></i> Add item</button>
  </div>`:''}
  <div class="card card-pad" style="text-align:center;padding-top:14px;padding-bottom:16px"><div class="sec-title" style="text-align:left">Progress</div>
    <div style="position:relative;width:${tsOpen?110:150}px;height:${tsOpen?110:150}px;margin:10px auto"><canvas id="chTask"></canvas><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:${tsOpen?20:26}px;font-weight:700">${t.progress}%</div></div>
    <div style="color:var(--slate);font-size:12.5px">${clTotal?`Auto-tracked from ${clDone}/${clTotal} Time Sheet items`:'No Time Sheet items yet — tracked manually until you add some'}</div>
    <div class="info-divider" style="margin:14px 0"></div>
    <div style="display:flex;justify-content:space-around;gap:10px;text-align:center">
      <div><div style="font-size:10.5px;color:var(--slate);text-transform:uppercase;letter-spacing:.4px;font-weight:700;margin-bottom:5px">Status</div>${statusTag(t.status)}</div>
      <div><div style="font-size:10.5px;color:var(--slate);text-transform:uppercase;letter-spacing:.4px;font-weight:700;margin-bottom:5px">Due</div><div style="font-size:13px;font-weight:600;${t.due_date&&t.due_date<todayStr()&&t.status!=='Completed'?'color:var(--err)':''}">${t.due_date?fmtDateShort(t.due_date):'Not set'}</div></div>
      <div><div style="font-size:10.5px;color:var(--slate);text-transform:uppercase;letter-spacing:.4px;font-weight:700;margin-bottom:5px">Updated</div><div style="font-size:13px;font-weight:600">${relTime(t.updated_at)}</div></div>
    </div>
  </div>
  </div>
  <div class="card card-pad" style="margin-top:12px"><div class="sec-title"><i class="fa-solid fa-bullhorn"></i> Updates & Feedback</div>
    <div id="cmList" class="chat-wrap" style="margin-top:8px">${(comments||[]).map(c=>cmItem(c,id)).join('')||'<div style="color:var(--slate);font-size:13px">No updates yet — post the first one.</div>'}</div>
    <div id="cmFileChip" style="display:none;align-items:center;gap:8px;margin-top:8px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;font-size:12.5px;color:var(--slate);width:fit-content"><i class="fa-solid fa-paperclip"></i><span id="cmFileName"></span><i class="fa-solid fa-xmark" style="cursor:pointer;color:var(--err)" onclick="cmClearFile()"></i></div>
    <input type="file" id="cmFile" style="display:none" onchange="cmFilePicked(this)">
    <div class="chat-composer"><button class="btn" title="Attach a file" onclick="document.getElementById('cmFile').click()"><i class="fa-solid fa-paperclip"></i></button><input id="cmNew" placeholder="Post an update or feedback…" onkeydown="if(event.key==='Enter')cmAdd(${id})"><button class="btn btn-primary" onclick="cmAdd(${id})"><i class="fa-solid fa-paper-plane"></i></button></div>
  </div>
  <div class="card card-pad" style="margin-top:12px">
    <div class="sec-title" style="display:flex;justify-content:space-between;align-items:center">Details ${canEdit?`<button class="btn btn-sm" onclick='taskEditModal(${id},${JSON.stringify(originalTeam)})'><i class="fa-solid fa-pen"></i> Edit</button>`:''}</div>
    <div class="info-grid">
      <div class="fld"><div class="k"><i class="fa-solid fa-calendar-day"></i> Due date</div><div class="v date-field"><input type="date" id="tkDueEdit" value="${t.due_date||''}" style="border:1px solid var(--line);border-radius:6px;padding:4px 7px;font-size:13px;font-family:inherit;font-weight:600;color:var(--ink)"><button class="file-act-btn" title="Save" onclick="taskUpdateDue(${id})"><i class="fa-solid fa-check"></i></button>${dueHist.length?`<button class="file-act-btn" title="History" onclick="toggleHist('tkDueHist',event)"><i class="fa-solid fa-clock-rotate-left"></i></button>`:''}</div></div>
      <div class="fld"><div class="k"><i class="fa-regular fa-calendar"></i> Created</div><div class="v">${fmtDate(t.created_at)}</div></div>
      <div class="fld"><div class="k"><i class="fa-regular fa-user"></i> Owner</div><div class="v">${avatar(nameOf(ownerEmail))} ${esc(nameOf(ownerEmail))}</div></div>
      <div class="fld"><div class="k"><i class="fa-solid fa-circle-dot"></i> Status</div><div class="v">${statusTag(t.status)}</div></div>
    </div>
    ${dueHist.length?`<div id="tkDueHist" class="hist-section">
      <div class="h-title"><i class="fa-solid fa-clock-rotate-left"></i> Due date history</div>
      ${dueHist.slice().reverse().map(h=>`<div class="h-row">${h.old?fmtDateShort(h.old):'Not set'} <i class="fa-solid fa-arrow-right"></i> <b>${h.new?fmtDateShort(h.new):'Not set'}</b> <span class="h-meta">· ${esc(nameOf(h.by))}, ${relTime(h.at)}</span></div>`).join('')}
    </div>`:''}
    <div class="info-divider"></div>
    <div class="info-sub" style="display:flex;justify-content:space-between;align-items:center">Attachments <span class="attach-actions" style="display:flex;gap:6px">
      <button class="btn btn-sm" onclick="filesDownloadSel('tkAttachList')"><i class="fa-solid fa-download"></i> Download</button>
      <button class="btn btn-sm btn-danger" onclick="taskAttachDeleteSel(${id})"><i class="fa-solid fa-trash"></i> Delete</button>
      <button class="btn btn-sm" onclick="document.getElementById('tkAttachAdd').click()"><i class="fa-solid fa-paperclip"></i> Add</button>
    </span></div>
    <input type="file" id="tkAttachAdd" style="display:none" onchange="taskAttachUpload(${id},this)">
    <div id="tkAttachList" class="attach-grid">${(files||[]).map(f=>`<label class="attach-card"><input type="checkbox" class="checkbox attach-chk" data-id="${f.id}" data-path="${esc(f.storage_path)}" data-name="${esc(f.file_name)}"><i class="fa-solid fa-paperclip"></i><span class="name" title="${esc(f.file_name)}">${esc(f.file_name)}</span></label>`).join('')||'<span style="color:var(--slate);font-size:12px">None</span>'}</div>
    <div class="info-divider"></div>
    <div class="info-sub">Members</div>
    <div class="people-grid">${originalTeam.filter((x,i,a)=>a.indexOf(x)===i).map(e=>`<span class="people-chip">${avatar(nameOf(e))} ${esc(nameOf(e))}</span>`).join('')||'<span style="color:var(--slate);font-size:12px">None</span>'}</div>
    <div class="info-divider"></div>
    <div style="display:flex;justify-content:flex-end;gap:8px">
      <button class="btn btn-sm" onclick="taskArchive(${id},${t.archived})"><i class="fa-solid fa-box-archive"></i> ${t.archived?'Unarchive':'Archive'}</button>
      ${(t.owner===state.email||state.super)?`<button class="btn btn-sm btn-danger" onclick="taskDelete(${id})"><i class="fa-solid fa-trash"></i> Delete</button>`:''}
    </div>
  </div>`;
  const pct=t.progress;
  new Chart($('chTask'),{type:'doughnut',data:{datasets:[{data:[pct,100-pct],backgroundColor:[pct===100?'#16a34a':'#1d4ed8','#eef1f6'],borderWidth:0}]},options:{cutout:'78%',plugins:{legend:{display:false},tooltip:{enabled:false}}}});
  const cmW=$('cmList');if(cmW)cmW.scrollTop=cmW.scrollHeight;
}
function clItem(c,taskId){
  const assignees=c.assignees||[];
  return `<div class="ts-item drag-row" draggable="true" data-id="${c.id}"
      ondragstart="event.dataTransfer.setData('text/plain','${c.id}');this.classList.add('dragging')"
      ondragend="this.classList.remove('dragging')"
      ondragover="event.preventDefault();taskDragOver(event,this)"
      ondragleave="this.classList.remove('drop-above','drop-below')"
      ondrop="clReorderDrop(event,this,${taskId})">
    <i class="fa-solid fa-grip-vertical drag-handle"></i>
    <input type="checkbox" class="checkbox" ${c.done?'checked':''} onchange="event.stopPropagation();clToggle(${c.id},this.checked,${taskId})">
    <div class="ts-body" onclick="tsViewPopup(${c.id})">
      <span class="ts-name" style="${c.done?'text-decoration:line-through;color:#94a3b8':''}">${esc(c.label)}</span>
      <span class="ts-mem avatar-stack">${assignees.slice(0,3).map(e=>avatar(nameOf(e))).join('')}</span>
    </div>
    <i class="fa-solid fa-xmark" title="Remove" style="cursor:pointer;color:var(--err);font-size:13px;padding:4px" onclick="event.stopPropagation();clDelete(${c.id},${taskId})"></i>
  </div>`;
}
window.clReorderDrop=async function(e,row,taskId){
  e.preventDefault();
  const above=row.classList.contains('drop-above');
  row.classList.remove('drop-above','drop-below');
  const draggedId=parseInt(e.dataTransfer.getData('text/plain'));
  const targetId=parseInt(row.dataset.id);
  if(!draggedId||draggedId===targetId)return;
  let order=(window.__TS_ORDER||[]).slice();
  order=order.filter(cid=>cid!==draggedId);
  let idx=order.indexOf(targetId);
  if(idx===-1)idx=order.length;
  order.splice(above?idx:idx+1,0,draggedId);
  window.__TS_ORDER=order;
  await Promise.all(order.map((cid,i)=>sb.schema('acc').from('task_checklist').update({sort:i}).eq('id',cid)));
  taskDetail($('view'),taskId);
};
window.tsViewPopup=function(cid){
  const c=(window.__TS_ITEMS||{})[cid];if(!c)return;
  const assignees=c.assignees||[];
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-list-check"></i> Sub task</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body">
      <div style="font-size:11px;color:var(--slate);text-transform:uppercase;font-weight:700;letter-spacing:.4px;margin-bottom:7px">Name</div>
      <div style="font-size:15.5px;font-weight:600;margin-bottom:20px;${c.done?'text-decoration:line-through;color:#94a3b8':''}">${esc(c.label)}</div>
      <div style="font-size:11px;color:var(--slate);text-transform:uppercase;font-weight:700;letter-spacing:.4px;margin-bottom:10px">Members</div>
      <div style="display:flex;flex-direction:column;gap:12px">${assignees.length?assignees.map(e=>`<div style="display:flex;align-items:center;gap:10px">${avatar(nameOf(e))}<span style="font-size:13.5px">${esc(nameOf(e))}</span></div>`).join(''):'<span style="color:var(--slate);font-size:13px">No members assigned</span>'}</div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>`);
};
window.subTaskModal=async function(taskId){
  const [{data:t},{data:mem}]=await Promise.all([
    sb.schema('acc').from('tasks').select('owner,assigned_to').eq('id',taskId).single(),
    sb.schema('acc').from('task_members').select('email').eq('task_id',taskId)
  ]);
  const people=new Set([t&&(t.owner||t.assigned_to),...(mem||[]).map(m=>m.email)].filter(Boolean));
  const singlePerson=people.size<=1;
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-list-check"></i> Add sub task</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm">
      <label>Name</label><input id="stName" placeholder="e.g. Collect site photos">
      ${singlePerson?'':`<label>Members</label>${msHtml('stMembers')}`}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="subTaskSave(${taskId})"><i class="fa-solid fa-check"></i> Add</button></div>`,'xl');
  if(!singlePerson)setTimeout(()=>msInit('stMembers',[]),30);
};
window.subTaskSave=async function(taskId){
  const name=$('stName').value.trim();if(!name){toast('Enter a name','err');return;}
  const assignees=getMS('stMembers');
  await sb.schema('acc').from('task_checklist').insert({task_id:taskId,label:name,assignees});
  await recalcTaskProgress(taskId);
  closeModal();
  taskDetail($('view'),taskId);
};
function cmItem(c,taskId){
  const mine=c.author===state.email;
  return `<div class="chat-msg ${mine?'mine':''}">
    ${mine?'':avatar(nameOf(c.author))}
    <div style="min-width:0">
      <div class="chat-meta"><b>${esc(mine?'You':nameOf(c.author))}</b><span>${relTime(c.created_at)}${c.edited?' · edited':''}</span></div>
      <div class="chat-bubble">
        <div id="cm_body_${c.id}">${esc(c.body)}</div>
      </div>
    </div>
  </div>`;
}
window.tkToggleTS=function(id){window.__TS_OPEN=window.__TS_OPEN||{};window.__TS_OPEN[id]=!window.__TS_OPEN[id];taskDetail($('view'),id);};
window.taskUpdateDue=async function(id){
  const val=$('tkDueEdit').value||null;
  const {data:cur}=await sb.schema('acc').from('tasks').select('due_date,due_date_history').eq('id',id).single();
  const hist=(cur&&cur.due_date_history)||[];
  const oldVal=cur?cur.due_date:null;
  if(oldVal===val){toast('No change','ok');return;}
  hist.push({old:oldVal,new:val,by:state.email,at:new Date().toISOString()});
  const {error}=await sb.schema('acc').from('tasks').update({due_date:val,due_date_history:hist}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  await sb.schema('acc').from('task_activity').insert({task_id:id,actor:state.email,action:'changed the due date'});
  toast('Due date updated','ok');taskDetail($('view'),id);
};
window.taskUpdateProgress=async function(id){
  const p=Math.min(100,Math.max(0,parseInt($('tkProgManual').value)||0));
  const {data:cur}=await sb.schema('acc').from('tasks').select('status').eq('id',id).single();
  let status=cur?cur.status:null;
  if(p===100)status='Completed';else if(status==='Completed')status='Pending';
  const {error}=await sb.schema('acc').from('tasks').update({progress:p,status}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  await sb.schema('acc').from('task_activity').insert({task_id:id,actor:state.email,action:'updated progress to '+p+'%'});
  toast('Progress updated','ok');taskDetail($('view'),id);
};
async function recalcTaskProgress(id){
  const {data:cl}=await sb.schema('acc').from('task_checklist').select('done').eq('task_id',id);
  const items=cl||[];
  const {data:cur}=await sb.schema('acc').from('tasks').select('status').eq('id',id).single();
  let status=cur?cur.status:null;
  if(!items.length){
    // no Time sheet items — progress must show 0%, and it can't stay Completed without one
    if(status==='Completed')status='Pending';
    await sb.schema('acc').from('tasks').update({progress:0,status}).eq('id',id);
    return;
  }
  const p=Math.round(items.filter(c=>c.done).length/items.length*100);
  if(p===100)status='Completed';else if(status==='Completed')status='Pending';
  await sb.schema('acc').from('tasks').update({progress:p,status}).eq('id',id);
}
const NEEDS_TASK_PAGE_MSG='Open the task and click Ask Approval — this task needs sign-off before it can be marked complete.';
/* when a task is marked Completed, its Time sheet sub-items should all be ticked off too */
async function completeTaskChecklist(taskId){
  await sb.schema('acc').from('task_checklist').update({done:true}).eq('task_id',taskId).eq('done',false);
}
async function completeTaskChecklists(taskIds){
  if(!taskIds||!taskIds.length)return;
  await sb.schema('acc').from('task_checklist').update({done:true}).in('task_id',taskIds).eq('done',false);
}
window.clAdd=async function(id){const t=$('clNew').value.trim();if(!t)return;await sb.schema('acc').from('task_checklist').insert({task_id:id,label:t});await recalcTaskProgress(id);taskDetail($('view'),id);};
window.clToggle=async function(cid,done,taskId){await sb.schema('acc').from('task_checklist').update({done}).eq('id',cid);await recalcTaskProgress(taskId);taskDetail($('view'),taskId);};
window.clDelete=async function(cid,taskId){await sb.schema('acc').from('task_checklist').delete().eq('id',cid);await recalcTaskProgress(taskId);taskDetail($('view'),taskId);};
window.toggleHist=function(id,e){if(e)e.stopPropagation();const el=$(id);if(!el)return;const willShow=!el.classList.contains('show');document.querySelectorAll('.hist-section.show').forEach(x=>x.classList.remove('show'));if(willShow){el.classList.add('show');el.scrollIntoView({behavior:'smooth',block:'nearest'});}};
window.cmFilePicked=function(inputEl){
  const f=inputEl.files[0];const chip=$('cmFileChip'),nm=$('cmFileName');
  if(!f){if(chip)chip.style.display='none';return;}
  if(nm)nm.textContent=f.name;if(chip)chip.style.display='flex';
};
window.cmClearFile=function(){const inp=$('cmFile');if(inp)inp.value='';const chip=$('cmFileChip');if(chip)chip.style.display='none';};
window.cmAdd=async function(id){
  const bEl=$('cmNew');const b=(bEl.value||'').trim();
  const fEl=$('cmFile');const f=fEl&&fEl.files&&fEl.files[0];
  if(!b&&!f)return;
  let body=b;
  if(f){
    const {data:t2}=await sb.schema('acc').from('tasks').select('kind').eq('id',id).single();
    const key=s3KeyForTask(id,t2&&t2.kind==='delegation',f.name);
    toast('Uploading '+f.name+'\u2026','ok');
    const {data:upData,error:ue}=await uploadFileToS3(key,f);
    if(ue){toast('Attachment upload failed: '+ue.message,'err');return;}
    await sb.schema('acc').from('task_files').insert({task_id:id,file_name:f.name,storage_path:upData.path,file_size:f.size,uploaded_by:state.email});
    body=(b?b+' ':'')+'\ud83d\udcce '+f.name;
  }
  await sb.schema('acc').from('task_comments').insert({task_id:id,author:state.email,body});
  await sb.schema('acc').from('task_activity').insert({task_id:id,actor:state.email,action:'commented'});
  taskDetail($('view'),id);
};
window.cmEdit=function(cid,taskId){
  const el=$('cm_body_'+cid);if(!el)return;const cur=el.textContent;
  el.innerHTML=`<div style="display:flex;gap:8px"><input id="cmEditIn_${cid}" class="sel" style="flex:1;height:32px" value="${esc(cur)}"><button class="btn btn-sm btn-primary" onclick="cmEditSave(${cid},${taskId})"><i class="fa-solid fa-check"></i></button></div>`;
  $('cmEditIn_'+cid).focus();
};
window.cmEditSave=async function(cid,taskId){
  const v=$('cmEditIn_'+cid).value.trim();if(!v)return;
  const {error}=await sb.schema('acc').from('task_comments').update({body:v,edited:true}).eq('id',cid);
  if(error){toast(error.message,'err');return;}
  toast('Comment updated','ok');taskDetail($('view'),taskId);
};
window.cmDelete=async function(cid,taskId){
  if(!await confirmDialog('Delete this comment?'))return;
  const {error}=await sb.schema('acc').from('task_comments').delete().eq('id',cid);
  if(error){toast(error.message,'err');return;}
  toast('Comment deleted','ok');taskDetail($('view'),taskId);
};
window.taskArchive=async function(id,cur){await sb.schema('acc').from('tasks').update({archived:!cur}).eq('id',id);toast(cur?'Unarchived':'Archived','ok');taskDetail($('view'),id);};
/* Ask Approval / reopen. makeComplete=true is the "Ask Approval" click while Pending — the server
   RPC (acc.task_ask_approval) decides for itself whether this viewer has anyone to ask (climbs the
   delegation chain one hop) or is root for this branch and can complete outright. makeComplete=false
   is a plain reopen (Completed -> Pending), no approval involved either way. */
window.taskMarkComplete=async function(id,makeComplete){
  if(makeComplete){
    const {data:resultStatus,error}=await sb.schema('acc').rpc('task_ask_approval',{tid:id});
    if(error){toast(error.message,'err');return;}
    await sb.schema('acc').from('task_activity').insert({task_id:id,actor:state.email,action:resultStatus==='Completed'?'marked this task complete':'asked for approval on this task'});
    const {data:t2}=await sb.schema('acc').from('tasks').select('project_id,goal_id').eq('id',id).single();
    if(t2&&t2.project_id)await recalcProjectProgress(t2.project_id);
    if(t2&&t2.goal_id)await recalcGoalProgress(t2.goal_id);
    toast(resultStatus==='Awaiting Approval'?'Sent for approval':'Marked complete','ok');
  }else{
    await sb.schema('acc').from('tasks').update({status:'Pending'}).eq('id',id);
    await recalcTaskProgress(id);
    await sb.schema('acc').from('task_activity').insert({task_id:id,actor:state.email,action:'reopened this task'});
    const {data:t2}=await sb.schema('acc').from('tasks').select('project_id,goal_id').eq('id',id).single();
    if(t2&&t2.project_id)await recalcProjectProgress(t2.project_id);
    if(t2&&t2.goal_id)await recalcGoalProgress(t2.goal_id);
    toast('Reopened','ok');
  }
  taskDetail($('view'),id);
};
async function advanceApprovalCore(approvalId,taskId,decision){
  const {data,error}=await sb.schema('acc').rpc('task_approval_decide',{aid:approvalId,decision});
  if(!error)await sb.schema('acc').from('task_activity').insert({task_id:taskId,actor:state.email,action:decision==='approve'?'approved this task':'declined this task'});
  return {data,error};
}
window.taskApprove=async function(approvalId,taskId){
  const {data:result,error}=await advanceApprovalCore(approvalId,taskId,'approve');
  if(error){toast(error.message,'err');return;}
  toast(result==='approved'?'Approved — task completed':'Approved — sent up for further approval','ok');
  taskDetail($('view'),taskId);
  refreshNotifState();
};
window.taskDecline=async function(approvalId,taskId){
  if(!await confirmDialog('Decline this task? It will be sent back and marked as needing rework.'))return;
  const {error}=await advanceApprovalCore(approvalId,taskId,'decline');
  if(error){toast(error.message,'err');return;}
  toast('Task declined — add feedback below','ok');
  await taskDetail($('view'),taskId);
  refreshNotifState();
  const wrap=document.querySelector('.chat-wrap');if(wrap)wrap.scrollIntoView({behavior:'smooth',block:'center'});
  const cm=$('cmNew');if(cm)cm.focus();
};
window.notifApprove=async function(e,approvalId,taskId){
  e.stopPropagation();
  const {error}=await advanceApprovalCore(approvalId,taskId,'approve');
  if(error){toast(error.message,'err');return;}
  toast('Approved','ok');
  renderNotifDropdown();
  refreshNotifState();
  if(location.hash.includes('/tasks/view/'+taskId))taskDetail($('view'),taskId);
};
window.taskDelete=async function(id){
  if(!await confirmDialog('Delete this task permanently?'))return;
  const {data:files}=await sb.schema('acc').from('task_files').select('storage_path').eq('task_id',id);
  for(const f of (files||[])){ if(f.storage_path){ if(isS3Path(f.storage_path)) await s3Delete(f.storage_path); else await sb.storage.from('documents').remove([f.storage_path]); } }
  // Only the current owner can delete (enforced by RLS too) — .select() so a permission mismatch
  // shows up as "0 rows" instead of a false "Deleted" toast over a task that's actually still there.
  const {data:del,error}=await sb.schema('acc').from('tasks').delete().eq('id',id).select('id');
  if(error){toast(error.message,'err');return;}
  if(!del||!del.length){toast('Only the current owner can delete this task','err');return;}
  toast('Deleted','ok');location.hash='#/tasks/list';
};
window.taskEditModal=async function(id,currentTeam){
  const {data:t,error}=await sb.schema('acc').from('tasks').select('*').eq('id',id).single();
  if(error||!t){toast('Could not load task','err');return;}
  let scopedPeople=null;
  const {data:curMem}=await sb.schema('acc').from('task_members').select('email').eq('task_id',id);
  const current=(curMem||[]).map(m=>m.email);
  if(t.project_id){
    const [{data:pmem},{data:proj},{data:powners}]=await Promise.all([
      sb.schema('acc').from('project_members').select('email').eq('project_id',t.project_id),
      sb.schema('acc').from('projects').select('owner,created_by').eq('id',t.project_id).single(),
      sb.schema('acc').from('project_owners').select('email').eq('project_id',t.project_id)
    ]);
    const emails=new Set((pmem||[]).map(m=>m.email));
    (powners||[]).forEach(o=>emails.add(o.email));
    if(proj){if(proj.owner)emails.add(proj.owner);if(proj.created_by)emails.add(proj.created_by);}
    scopedPeople=(PEOPLE||[]).filter(p=>emails.has(p.email));
  } else if(t.goal_id){
    const [{data:gmem},{data:g}]=await Promise.all([
      sb.schema('acc').from('goal_members').select('email').eq('goal_id',t.goal_id),
      sb.schema('acc').from('goals').select('owner,created_by').eq('id',t.goal_id).single()
    ]);
    const emails=new Set((gmem||[]).map(m=>m.email));
    if(g){if(g.owner)emails.add(g.owner);if(g.created_by)emails.add(g.created_by);}
    scopedPeople=(PEOPLE||[]).filter(p=>emails.has(p.email));
  }
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-pen"></i> Edit task</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm">
      <label>Title</label><input id="teTitle" value="${esc(t.title)}">
      <label>Description</label>
      <div style="border:1px solid var(--line);border-radius:8px;overflow:hidden">
        <div style="display:flex;gap:2px;padding:6px;border-bottom:1px solid var(--line);background:#fafbfd">
          <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('bold')"><b>B</b></button>
          <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('italic')"><i>I</i></button>
          <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('insertUnorderedList')"><i class="fa-solid fa-list-ul"></i></button>
        </div>
        <div id="teDesc" contenteditable="true" style="min-height:70px;padding:10px 12px;font-size:13.5px;outline:none">${t.description||''}</div>
      </div>
      ${t.project_id?`<label>Assignees <span style="font-weight:400;color:var(--slate);text-transform:none;font-size:11.5px">— project members</span></label>${msHtml('teAssignTo')}`:`<label>Owner</label><select id="teOwner">${peopleOptions(t.owner)}</select>
      <label>Members</label>${msHtml('teMembers')}`}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="taskEditSave(${id})"><i class="fa-solid fa-check"></i> Save</button></div>`,'lg');
  // Pre-select whatever Details → Members is actually showing this viewer (the stable, per-viewer
  // delegation-chain group) — NOT t.owner/task_members directly, since those get rewritten to whoever
  // currently "holds" the task on every re-delegation and can drift from what Members displays.
  const preSelect=(currentTeam&&currentTeam.length)?currentTeam:[t.owner,...current];
  if(t.project_id)setTimeout(()=>msInit('teAssignTo',preSelect.filter(Boolean),scopedPeople),30);
  else setTimeout(()=>msInit('teMembers',current,scopedPeople),30);
};
window.taskEditSave=async function(id){
  const title=$('teTitle').value.trim();if(!title){toast('Enter a title','err');return;}
  const isProj=!!$('ms_teAssignTo');
  let owner;
  if(isProj){
    const assignTo=getMS('teAssignTo');
    if(!assignTo.length){toast('Select at least one assignee','err');return;}
    owner=assignTo[0];
  }else{
    owner=$('teOwner').value;
  }
  const desc=$('teDesc').innerHTML;
  const next=new Set(isProj?getMS('teAssignTo').filter(e=>e!==owner):getMS('teMembers'));
  // Members shown in Task Detail come from task_delegations (MY outgoing edges for this task), not
  // task_members — so the Assignees picker has to reconcile edges too, not just task_members, or
  // removing someone here never actually makes them disappear as a Member. Work out what that
  // reconciliation would require, and confirm with the editor BEFORE writing anything, so a "no" on
  // the sub-branch warning leaves the task completely untouched rather than half-saved.
  let removeDeleg=[],addDeleg=[];
  if(isProj){
    const wanted=new Set([owner,...next].filter(e=>e&&e!==state.email));
    const {data:myEdges}=await sb.schema('acc').from('task_delegations').select('delegatee').eq('task_id',id).eq('delegator',state.email);
    const haveOutgoing=new Set((myEdges||[]).map(e=>e.delegatee));
    const candidateAdds=[...wanted].filter(e=>!haveOutgoing.has(e));
    removeDeleg=[...haveOutgoing].filter(e=>!wanted.has(e));
    // A person can only ever be delegated to once per task (one delegator each) — if someone I'm
    // trying to add already has an edge under a DIFFERENT delegator (they're already part of another
    // branch on this same task, e.g. someone my delegatee already sub-delegated to), silently
    // inserting a second edge would just no-op against the unique constraint while task_members still
    // "added" them — the exact half-saved state that made this look broken. Block those specific
    // additions and say so instead.
    addDeleg=candidateAdds;
    if(candidateAdds.length){
      const {data:existingElsewhere}=await sb.schema('acc').from('task_delegations').select('delegatee,delegator').eq('task_id',id).in('delegatee',candidateAdds).neq('delegator',state.email);
      if(existingElsewhere&&existingElsewhere.length){
        const blocked=new Set(existingElsewhere.map(e=>e.delegatee));
        const blockedNames=existingElsewhere.map(e=>`${nameOf(e.delegatee)} (already under ${nameOf(e.delegator)})`).join(', ');
        toast(`Couldn't add ${blockedNames} — already assigned to this task under someone else.`,'err');
        addDeleg=candidateAdds.filter(e=>!blocked.has(e));
        blocked.forEach(e=>next.delete(e));
      }
    }
    if(removeDeleg.length){
      const {data:subEdges}=await sb.schema('acc').from('task_delegations').select('delegator').eq('task_id',id).in('delegator',removeDeleg);
      if(subEdges&&subEdges.length){
        const names=[...new Set(subEdges.map(e=>e.delegator))].map(nameOf).join(', ');
        if(!await confirmDialog(`${names} already delegated part of this task further. Removing them will also remove that branch. Continue?`))return;
      }
    }
  }
  const {error}=await sb.schema('acc').from('tasks').update({title,description:desc,owner}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  const {data:curMem}=await sb.schema('acc').from('task_members').select('email').eq('task_id',id);
  const current=new Set((curMem||[]).map(m=>m.email));
  const toAdd=[...next].filter(e=>!current.has(e));
  const toRemove=[...current].filter(e=>!next.has(e));
  if(toAdd.length)await sb.schema('acc').from('task_members').insert(toAdd.map(e=>({task_id:id,email:e})));
  for(const e of toRemove){await sb.schema('acc').from('task_members').delete().eq('task_id',id).eq('email',e);}
  const {data:t2}=await sb.schema('acc').from('tasks').select('project_id,goal_id').eq('id',id).single();
  if(t2&&(t2.project_id||t2.goal_id))await syncParentMembership(t2.project_id,t2.goal_id,[owner,...next]);
  if(t2&&t2.project_id){
    if(removeDeleg.length)await cascadeDeleteDelegationBranch(id,removeDeleg);
    if(addDeleg.length)await insertDelegationEdges(id,state.email,addDeleg);
  }
  closeModal();toast('Task updated','ok');taskDetail($('view'),id);
};
/* ---- sub-delegation: hand a project task off to someone else, preserving the chain ---- */
window.taskDelegateModal=async function(taskId,projectId){
  // Sub-delegation can go to anyone in the org, not just existing project members — whoever it's handed
  // to is auto-added to the project so they can see it (syncParentMembership). But each delegatee belongs
  // privately to whoever handed it to them: exclude anyone already ANYWHERE in this task's delegation
  // graph, so the same task can never fork to the same person via two separate branches.
  const {data:existingEdges}=await sb.schema('acc').from('task_delegations').select('delegatee').eq('task_id',taskId);
  const claimed=new Set([state.email,...(existingEdges||[]).map(d=>d.delegatee)]);
  const scopedPeople=(PEOPLE||[]).filter(p=>!claimed.has(p.email));
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-share-nodes"></i> Delegate this task</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm">
      <div style="color:var(--slate);font-size:12px;margin-bottom:6px">Hand this task off to one or more people. You'll keep visibility, but they become the ones working it.</div>
      <label>Delegate to</label>${msHtml('tdgTo')}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="taskDelegateSave(${taskId})"><i class="fa-solid fa-check"></i> Delegate</button></div>`,'lg');
  setTimeout(()=>msInit('tdgTo',[],scopedPeople),30);
};
window.taskDelegateSave=async function(taskId){
  const to=getMS('tdgTo');
  if(!to.length){toast('Select at least one person','err');return;}
  const {data:t}=await sb.schema('acc').from('tasks').select('project_id,owner').eq('id',taskId).single();
  if(!t){toast('Could not load task','err');return;}
  await insertDelegationEdges(taskId,state.email,to);
  const wasOwner=t.owner===state.email;
  if(wasOwner){
    await sb.schema('acc').from('tasks').update({owner:to[0]}).eq('id',taskId);
    const rest=to.slice(1);
    if(rest.length)await sb.schema('acc').from('task_members').insert(rest.map(e=>({task_id:taskId,email:e})));
  }else{
    await sb.schema('acc').from('task_members').delete().eq('task_id',taskId).eq('email',state.email);
    const {data:curMem}=await sb.schema('acc').from('task_members').select('email').eq('task_id',taskId);
    const have=new Set((curMem||[]).map(m=>m.email));
    const toAdd=to.filter(e=>!have.has(e)&&e!==t.owner);
    if(toAdd.length)await sb.schema('acc').from('task_members').insert(toAdd.map(e=>({task_id:taskId,email:e})));
  }
  if(t.project_id)await syncParentMembership(t.project_id,null,to);
  await sb.schema('acc').from('task_activity').insert({task_id:taskId,actor:state.email,action:'delegated this task to '+to.map(nameOf).join(', ')});
  closeModal();toast('Delegated','ok');taskDetail($('view'),taskId);
};
window.taskFileDl=async function(path,name){
  if(isS3Path(path)){ await s3OpenSigned(path,name||'download'); return; }
  const {data,error}=await sb.storage.from('task-attachments').createSignedUrl(path,120,{download:name});if(error){toast(error.message,'err');return;}window.open(data.signedUrl,'_blank');
};
window.taskAttachUpload=async function(id,inputEl){
  const f=inputEl.files[0];if(!f)return;
  const t2=await sb.schema('acc').from('tasks').select('kind').eq('id',id).single();
  const key=s3KeyForTask(id,t2.data&&t2.data.kind==='delegation',f.name);
  toast('Uploading '+f.name+'…','ok');
  const {data:upData,error:ue}=await uploadFileToS3(key,f);
  if(ue){toast('Attachment upload failed: '+ue.message,'err');inputEl.value='';return;}
  const {error}=await sb.schema('acc').from('task_files').insert({task_id:id,file_name:f.name,storage_path:upData.path,file_size:f.size,uploaded_by:state.email});
  if(error){toast(error.message,'err');return;}
  toast('Attachment added','ok');taskDetail($('view'),id);
};
window.taskAttachDelete=async function(id,fileId,path){
  if(!await confirmDialog('Remove this attachment?'))return;
  if(path){ if(isS3Path(path)) await s3Delete(path); else await sb.storage.from('task-attachments').remove([path]); }
  await sb.schema('acc').from('task_files').delete().eq('id',fileId);
  toast('Attachment removed','ok');taskDetail($('view'),id);
};
window.taskAttachDeleteSel=async function(id){
  const checked=[...document.querySelectorAll('#tkAttachList .attach-chk:checked')];
  if(!checked.length)return;
  if(!await confirmDialog(`Delete ${checked.length} file(s)?`))return;
  for(const cb of checked){
    const path=cb.dataset.path;
    if(path){ if(isS3Path(path)) await s3Delete(path); else await sb.storage.from('task-attachments').remove([path]); }
    await sb.schema('acc').from('task_files').delete().eq('id',cb.dataset.id);
  }
  toast('Attachments removed','ok');taskDetail($('view'),id);
};

/* ---------- projects (now the content of the Tasks tab) ---------- */
const PFILTER={prio:'All',status:'All'};
window.pfPrioChange=function(v){PFILTER.prio=v;taskProjects($('view'));};
window.pfStatusChange=function(v){PFILTER.status=v;taskProjects($('view'));};
async function taskProjects(v){
  setCrumb(['Accountability','Projects']);
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-diagram-project" style="color:#1d4ed8"></i> Projects</h1><p>Group tasks by project and share them with your team</p></div>
    <button class="btn btn-primary" onclick="projectCreateModal()"><i class="fa-solid fa-plus"></i> New Project</button></div>`+taskTabs('list')+
    `<div class="toolbar" style="justify-content:flex-end;gap:8px">
      ${fsGroupHtml('pfGroup',[
        {key:'pfPrio',label:'Priority',options:['Low','Medium','High','Urgent'],current:PFILTER.prio,cb:'pfPrioChange'},
        {key:'pfStatus',label:'Status',options:['Pending','In Progress','Completed'],current:PFILTER.status,cb:'pfStatusChange'}
      ])}
    </div><div id="projBody"><div class="loader"><div class="spin"></div></div></div>`;
  const me=state.email;
  let projects=await fetchMyProjects(me);
  if(PFILTER.prio!=='All')projects=projects.filter(p=>p.priority===PFILTER.prio);
  if(PFILTER.status!=='All')projects=projects.filter(p=>p.status===PFILTER.status);
  // Not every task lives inside a project — solo tasks and one-off delegations don't. Rather than
  // leave those scattered and hard to find, a virtual "No Project" card gathers them here too,
  // filtered the same way (respects the same Priority/Status pickers isn't meaningful for it since
  // it has no priority/status of its own — it's just a doorway to noProjectDetail's own task list).
  let noProjCount=0;
  try{const {count}=await sb.schema('acc').from('tasks').select('id',{count:'exact',head:true}).is('project_id',null).is('goal_id',null);noProjCount=count||0;}catch(e){}
  const noProjCard=`<div class="card card-pad" style="cursor:pointer" onclick="location.hash='#/tasks/project/none'">
      <div style="display:flex;justify-content:space-between;align-items:flex-start"><div class="ic" style="width:42px;height:42px;border-radius:11px;background:#f1f5f9;color:#64748b;display:flex;align-items:center;justify-content:center;font-size:17px"><i class="fa-solid fa-folder-open"></i></div></div>
      <div style="font-weight:600;font-size:15px;margin-top:12px">No Project</div>
      <div style="color:var(--slate);font-size:12.5px;margin-top:4px;min-height:34px">Solo tasks and one-off delegations not tied to any project</div>
      <div style="font-size:12px;color:var(--slate);margin-top:10px">${noProjCount} task${noProjCount===1?'':'s'}</div></div>`;
  if(!projects.length){$('projBody').innerHTML=`<div class="grid lib-grid">${noProjCard}</div>`;return;}
  const ids=projects.map(p=>p.id);
  const taskCounts={};
  try{const {data}=await sb.schema('acc').from('tasks').select('id,project_id,status').in('project_id',ids);(data||[]).forEach(t=>{const c=taskCounts[t.project_id]||{total:0,done:0};c.total++;if(t.status==='Completed')c.done++;taskCounts[t.project_id]=c;});}catch(e){}
  const memberCounts={};
  try{const {data}=await sb.schema('acc').from('project_members').select('project_id').in('project_id',ids);(data||[]).forEach(m=>{memberCounts[m.project_id]=(memberCounts[m.project_id]||0)+1;});}catch(e){}
  $('projBody').innerHTML=`<div class="grid lib-grid">${noProjCard}${projects.map(p=>{
    const c=taskCounts[p.id]||{total:0,done:0};
    const pct=c.total?Math.round(c.done/c.total*100):0;
    const mcount=memberCounts[p.id]||0;
    return `<div class="card card-pad" style="cursor:pointer" onclick="location.hash='#/tasks/project/${p.id}'">
      <div style="display:flex;justify-content:space-between;align-items:flex-start"><div class="ic" style="width:42px;height:42px;border-radius:11px;background:#eff4ff;color:#1d4ed8;display:flex;align-items:center;justify-content:center;font-size:17px"><i class="fa-solid fa-diagram-project"></i></div><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${prioTag(p.priority)}${statusTag(p.status)}</div></div>
      <div style="font-weight:600;font-size:15px;margin-top:12px">${esc(p.name)}</div>
      <div style="color:var(--slate);font-size:12.5px;margin-top:4px;min-height:34px">${esc((p.description||'').replace(/<[^>]+>/g,'').slice(0,80))}</div>
      <div style="font-size:12px;color:var(--slate);margin-top:10px">${mcount} member${mcount===1?'':'s'} · ${c.total} task${c.total===1?'':'s'}${c.total?' · '+c.done+' completed':''}</div></div>`;
  }).join('')}</div>`;
}
/* ---- virtual "No Project" bucket: tasks/delegations with no project_id (and no goal_id), grouped
   the same way Home groups them (My Tasks / Assigned To Me / Assigned By Me), just without any of
   the owners/members/attachments machinery a real project has since there's no project row to hang
   that off of. ---- */
const NOPFILTER={status:'All'};
window.nopStatusChange=function(v){NOPFILTER.status=v;noProjectDetail($('view'));};
function noProjRowHtml(t){
  return `<div class="drag-row" style="cursor:pointer" onclick="location.hash='#/tasks/view/${t.id}'">
    <div style="flex:1;min-width:0">
      <div style="font-weight:600;font-size:13px">${esc(t.title)}</div>
      <div style="color:var(--slate);font-size:11.5px">${t.due_date?'Due '+fmtDateShort(t.due_date):'No due date'}</div>
    </div>
    ${statusTag(t.status)}
    <div style="width:42px;text-align:right;font-size:12px;font-weight:600;color:var(--brand)">${t.progress}%</div>
  </div>`;
}
function noProjListHtml(tasks){
  if(!tasks.length)return '<div class="empty" style="padding:22px"><i class="fa-regular fa-circle-check"></i><div>No tasks</div></div>';
  return `<div class="drag-list">${tasks.map(noProjRowHtml).join('')}</div>`;
}
async function noProjectDetail(v){
  loader(v);
  setCrumb(['Accountability',['Projects','#/tasks/list'],'No Project']);
  const me=state.email;
  const {data:tasks}=await sb.schema('acc').from('tasks').select('*').is('project_id',null).is('goal_id',null).order('due_date',{ascending:true});
  let list=tasks||[];
  if(NOPFILTER.status!=='All')list=list.filter(t=>t.status===NOPFILTER.status);
  const myTasks=list.filter(t=>t.kind!=='delegation'&&t.owner===me);
  const toMe=list.filter(t=>t.kind==='delegation'&&t.assigned_to===me&&t.created_by!==me);
  const byMe=list.filter(t=>t.kind==='delegation'&&t.created_by===me&&t.assigned_to!==me);
  v.innerHTML=`<div class="page-head"><div><button class="btn btn-sm" onclick="location.hash='#/tasks/list'"><i class="fa-solid fa-arrow-left"></i> Back</button>
    <h1 style="margin-top:10px"><i class="fa-solid fa-folder-open" style="color:#64748b"></i> No Project</h1>
    <p>Solo tasks and one-off delegations not tied to any project</p></div>
    <div>${fsHtml('nopStatus','Status',['Pending','Awaiting Approval','Completed'],NOPFILTER.status,'nopStatusChange')}</div>
  </div>
  <div class="card card-pad"><div class="sec-title">My Tasks <span class="tag t-gray" style="margin-left:4px">${myTasks.length}</span></div>
    <div style="margin-top:6px">${noProjListHtml(myTasks)}</div></div>
  <div class="card card-pad" style="margin-top:12px"><div class="sec-title">Assigned To Me <span class="tag t-gray" style="margin-left:4px">${toMe.length}</span></div>
    <div style="margin-top:6px">${noProjListHtml(toMe)}</div></div>
  <div class="card card-pad" style="margin-top:12px"><div class="sec-title">Assigned By Me <span class="tag t-gray" style="margin-left:4px">${byMe.length}</span></div>
    <div style="margin-top:6px">${noProjListHtml(byMe)}</div></div>`;
}
window.projectCreateModal=function(){
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-diagram-project"></i> New project</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>Project name</label><input id="pjName" placeholder="e.g. Dream Eco City Launch">
    <label>Description</label>
    <div style="border:1px solid var(--line);border-radius:8px;overflow:hidden">
      <div style="display:flex;gap:2px;padding:6px;border-bottom:1px solid var(--line);background:#fafbfd">
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('bold')"><b>B</b></button>
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('italic')"><i>I</i></button>
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('insertUnorderedList')"><i class="fa-solid fa-list-ul"></i></button>
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('insertOrderedList')"><i class="fa-solid fa-list-ol"></i></button>
      </div>
      <div id="pjDesc" contenteditable="true" style="min-height:80px;padding:10px 12px;font-size:13.5px;outline:none"></div>
    </div>
    <label>Owners</label>
    <div style="color:var(--slate);font-size:12px;margin:-3px 0 6px">Owners can manage this project's members, owners, and settings.</div>
    ${msHtml('pjOwners')}
    <div class="two"><div><label>Priority</label><select id="pjPrio"><option>Low</option><option selected>Medium</option><option>High</option><option>Urgent</option></select></div>
    <div><label>Due date (optional)</label><input type="date" id="pjDue"></div></div>
    <label>Members</label>${msHtml('pjMembers')}
    <label>Status</label><div class="seg" id="pjStatusSeg">${['Pending','In Progress','Completed'].map((x,i)=>'<button type="button" class="seg-btn'+(i===0?' on':'')+'" onclick="pjPickStatus(this,\''+x+'\')">'+x+'</button>').join('')}</div><input type="hidden" id="pjStatus" value="Pending">
    <label>Attachment (optional)</label>
    <div class="dropzone" onclick="document.getElementById('pjFile').click()"><i class="fa-solid fa-paperclip"></i><div id="pjFName">Click to choose a file</div></div>
    <input type="file" id="pjFile" class="hidden" onchange="document.getElementById('pjFName').textContent=this.files[0]?this.files[0].name:'Click to choose a file'">
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="pjSave" onclick="projectSave()"><i class="fa-solid fa-check"></i> Create project</button></div>`,'lg');
  setTimeout(()=>{msInit('pjOwners',[state.email],null,false,[state.email]);msInit('pjMembers',[]);},30);
};
window.pjPickStatus=function(btn,val){document.querySelectorAll('#pjStatusSeg .seg-btn').forEach(b=>b.classList.remove('on'));btn.classList.add('on');$('pjStatus').value=val;};
window.projectSave=async function(){
  const name=$('pjName').value.trim();if(!name){toast('Enter a project name','err');return;}
  const owners=getMS('pjOwners');if(!owners.length){toast('Select at least one owner','err');return;}
  const status=$('pjStatus').value;
  const row={name,description:$('pjDesc').innerHTML,owner:owners[0],created_by:state.email,priority:$('pjPrio').value,due_date:$('pjDue').value||null,progress:0,status};
  const btn=$('pjSave');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';
  const {data,error}=await sb.schema('acc').from('projects').insert(row).select().single();
  if(error){toast(error.message,'err');btn.disabled=false;return;}
  await sb.schema('acc').from('project_owners').insert(owners.map((e,i)=>({project_id:data.id,email:e,rank:i})));
  const mem=getMS('pjMembers');if(mem.length)await sb.schema('acc').from('project_members').insert(mem.map(e=>({project_id:data.id,email:e})));
  const f=$('pjFile').files[0];
  if(f){const key=s3KeyForProject(data.id,f.name);const {data:upData,error:ue}=await uploadFileToS3(key,f);if(ue)toast('Project created, but attachment upload failed: '+ue.message,'err');else await sb.schema('acc').from('project_files').insert({project_id:data.id,file_name:f.name,storage_path:upData.path,file_size:f.size,uploaded_by:state.email});}
  closeModal();toast('Project created','ok');location.hash='#/tasks/project/'+data.id;route();
};
const PJTFILTER={status:'All',person:'All',stage:'All'};
window.pjtStatusChange=function(v){PJTFILTER.status=v;projectDetail($('view'),window.__PJT_ID);};
window.pjtPersonChange=function(v){PJTFILTER.person=v;projectDetail($('view'),window.__PJT_ID);};
window.pjtStageChange=function(v){PJTFILTER.stage=v;projectDetail($('view'),window.__PJT_ID);};
window.pjDelSetTab=function(tab){window.__PJ_DEL_TAB=tab;PJTFILTER.person='All';projectDetail($('view'),window.__PJT_ID);};
/* Per-task approval role resolution, shared by taskDetail (single task) and projectDetail (list —
   called once per task with that task's own slice of edges/pending rows). A pending task_approvals
   row climbs hop-by-hop (current_approver moves up the delegation chain per approval). Walking from
   the row's submitter up through the edges tells us whether "me" is the current approver, already
   signed off ("done" — passed already, even though the overall task is still climbing toward the
   root Assignor), or not involved in this particular branch at all (returns null — keeps one
   branch's approval chatter from leaking into an unrelated branch/viewer). */
function resolveApprovalRole(edgesForTask,pendingRowsForTask,me){
  const directDelegatorOf=who=>{const e=edgesForTask.find(d=>d.delegatee===who);return e?e.delegator:null;};
  let best=null;
  for(const row of (pendingRowsForTask||[])){
    let role=null;
    if(row.current_approver===me)role='current_approver';
    else if(row.submitter===me)role='done';
    else{
      let walker=row.submitter;
      for(let i=0;i<50&&walker&&walker!==row.current_approver;i++){
        walker=directDelegatorOf(walker);
        if(walker===me){role='done';break;}
      }
    }
    if(role==='current_approver')return {role,row};
    if(role==='done'&&!best)best={role,row};
  }
  return best;
}
/* Todo/Followup stage for one task, from one viewer's side of a delegation edge.
   tab: 'tome' = I'm the recipient (Assigned to me); 'mine' = I'm the delegator (Assigned by me).
   Rule of thumb: Todo = it's my move right now; Followup = I'm waiting on the other party;
   null = nothing to act on (already Completed) — drops out of both filtered views, though it still
   shows up normally when Stage isn't filtered. Relies on t._apprRole, set by the caller from a
   resolveApprovalRole() call scoped to this task. */
function pjDgTodoFollowup(t,tab){
  if(t.status==='Completed')return null;
  if(tab==='tome'){
    if(t.status==='Pending')return 'todo';
    if(t.status==='Awaiting Approval')return 'followup';
    return null;
  }
  if(t.status==='Pending')return 'followup';
  if(t.status==='Awaiting Approval')return t._apprRole==='current_approver'?'todo':'followup';
  return null;
}
async function projectDetail(v,id){
  loader(v);
  window.__PJT_ID=id;
  const {data:p,error}=await sb.schema('acc').from('projects').select('*').eq('id',id).single();
  if(error||!p){v.innerHTML='<div class="empty"><i class="fa-solid fa-ban"></i><div>Project not found or no access</div></div>';return;}
  setCrumb(['Accountability',['Projects','#/tasks/list'],p.name]);
  const [{data:members},{data:tasks},{data:files},{data:ownerRows},{data:delegations}]=await Promise.all([
    sb.schema('acc').from('project_members').select('*').eq('project_id',id),
    sb.schema('acc').from('tasks').select('*').eq('project_id',id).order('due_date',{ascending:true}),
    sb.schema('acc').from('project_files').select('*').eq('project_id',id),
    sb.schema('acc').from('project_owners').select('email,rank').eq('project_id',id).order('rank',{ascending:true}),
    sb.schema('acc').from('task_delegations').select('task_id,delegator,delegatee')
  ]);
  const mem=members||[];const list=tasks||[];const me=state.email;
  const owners=(ownerRows&&ownerRows.length)?ownerRows.map(o=>o.email):[p.owner].filter(Boolean);
  const dgs=(delegations||[]).filter(d=>list.some(t=>t.id===d.task_id));
  const awaitingIds=list.filter(t=>t.status==='Awaiting Approval').map(t=>t.id);
  const {data:apprAll}=awaitingIds.length?await sb.schema('acc').from('task_approvals').select('*').in('task_id',awaitingIds).eq('decision','pending'):{data:[]};
  const roleForTask=tid=>resolveApprovalRole(dgs.filter(d=>d.task_id===tid),(apprAll||[]).filter(a=>a.task_id===tid),me);
  const iDelegatedIds=new Set(dgs.filter(d=>d.delegator===me).map(d=>d.task_id));
  const toMeIds=new Set(dgs.filter(d=>d.delegatee===me).map(d=>d.task_id));
  // Each person's "Assigned by me"/"Assigned to me" shows ONLY their own direct edge for this task —
  // whoever they personally delegated to, or whoever personally delegated to them. Nothing further
  // down or up the chain is resolved or surfaced: sub-delegation stays fully invisible beyond one hop.
  const iGaveTo={};dgs.filter(d=>d.delegator===me).forEach(d=>{(iGaveTo[d.task_id]=iGaveTo[d.task_id]||[]).push(d.delegatee);});
  const iGotFrom={};dgs.filter(d=>d.delegatee===me).forEach(d=>{(iGotFrom[d.task_id]=iGotFrom[d.task_id]||[]).push(d.delegator);});
  let flist=list;
  if(PJTFILTER.status!=='All')flist=flist.filter(t=>t.status===PJTFILTER.status);
  // Within each tab, rows split into "Task Assigned" vs "Task Delegated" based on the task's true
  // original creator (created_by), the root of its delegation graph. On "Assigned by me": if I'm the
  // creator handing it out directly, that's a first-hop Task Assigned; if I received it from someone
  // else and passed it on, that's a Task Delegated re-hop. On "Assigned to me": getting it straight
  // from the creator is Task Assigned; getting it from anyone further down the chain is Task Delegated.
  // Row label in the project list stays plain text — the richer "Assigned/Delegated to {avatars} by
  // {name}" treatment lives on the Task Detail page under the task title instead (see taskDetail).
  let delegatedList=flist.filter(t=>iDelegatedIds.has(t.id)).map(t=>({...t,_dgLabel:'To '+(iGaveTo[t.id]||[]).map(nameOf).join(', '),_bucket:t.created_by===me?'assigned':'delegated',_needsApproval:!!(iGotFrom[t.id]||[]).length,_apprRole:(roleForTask(t.id)||{}).role||null}));
  const delegatedToMeList=flist.filter(t=>toMeIds.has(t.id)||t.owner===me).map(t=>{
    const fromCreator=(iGotFrom[t.id]||[]).includes(t.created_by);
    return {...t,_dgLabel:(iGotFrom[t.id]||[]).length?'From '+iGotFrom[t.id].map(nameOf).join(', '):'Assigned to you',_bucket:(!toMeIds.has(t.id)||fromCreator)?'assigned':'delegated',_needsApproval:!!(iGotFrom[t.id]||[]).length,_apprRole:(roleForTask(t.id)||{}).role||null};
  });
  // Someone who isn't permitted to delegate never has an "Assigned by me" side to show.
  const canDelegateAtAll=!!(state.profile&&state.profile.can_delegate);
  const pjDelTab=canDelegateAtAll?(window.__PJ_DEL_TAB||'tome'):'tome';
  // Person filter — delegator-only: everyone I've personally delegated a task to in this project
  const personOpts=[...new Set(Object.values(iGaveTo).flat())].map(nameOf).filter(Boolean);
  if(pjDelTab==='mine'&&PJTFILTER.person!=='All')delegatedList=delegatedList.filter(t=>(iGaveTo[t.id]||[]).map(nameOf).includes(PJTFILTER.person));
  let curPjList=pjDelTab==='mine'?delegatedList:delegatedToMeList;
  if(PJTFILTER.stage!=='All'){const stageWant=PJTFILTER.stage.toLowerCase();curPjList=curPjList.filter(t=>pjDgTodoFollowup(t,pjDelTab)===stageWant);}
  const pjBucketAssigned=curPjList.filter(t=>t._bucket==='assigned');
  const pjBucketDelegated=curPjList.filter(t=>t._bucket==='delegated');
  const canManage=state.super||owners.includes(me)||p.created_by===me;
  const peopleList=[...owners,...mem.map(m=>m.email)].filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i);
  const dueHist=p.due_date_history||[];
  const statusOpts=['Pending','Awaiting Approval','Completed'];
  v.innerHTML=`<div class="page-head"><div><button class="btn btn-sm" onclick="location.hash='#/tasks/list'"><i class="fa-solid fa-arrow-left"></i> Back</button>
    <h1 style="margin-top:10px"><i class="fa-solid fa-diagram-project" style="color:#1d4ed8"></i> ${esc(p.name)}</h1>
    <p>Owned by <b>${owners.length?owners.map(e=>esc(nameOf(e))).join(', '):esc(nameOf(p.created_by))}</b> · ${prioTag(p.priority)} ${statusTag(p.status)} · ${mem.length} member${mem.length===1?'':'s'} · ${list.length} task${list.length===1?'':'s'}</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="taskCreateModal('task',${id},'${esc(p.name).replace(/'/g,"\\'")}')"><i class="fa-solid fa-share-nodes"></i> Assign Task</button>
    </div></div>
  <div class="card card-pad"><div class="sec-title">Description</div><div style="margin-top:6px;font-size:14px;color:#334155;line-height:1.6">${p.description||'<span style="color:#94a3b8">No description</span>'}</div></div>
  <div class="card card-pad" style="margin-top:12px"><div class="sec-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
    <div class="seg" id="pjDelSeg">
      <button type="button" class="seg-btn ${pjDelTab==='tome'?'on':''}" onclick="pjDelSetTab('tome')">Assigned to me <span class="tag t-gray" style="margin-left:4px">${delegatedToMeList.length}</span></button>
      ${canDelegateAtAll?`<button type="button" class="seg-btn ${pjDelTab==='mine'?'on':''}" onclick="pjDelSetTab('mine')">Assigned by me <span class="tag t-gray" style="margin-left:4px">${delegatedList.length}</span></button>`:''}
    </div>
    <span style="display:flex;gap:8px">
      ${fsGroupHtml('pjtGroup',[
        {key:'pjtStatus',label:'Status',options:statusOpts,current:PJTFILTER.status,cb:'pjtStatusChange'},
        {key:'pjtStage',label:'Stage',options:['Todo','Followup'],current:PJTFILTER.stage,cb:'pjtStageChange'},
        pjDelTab==='mine'&&personOpts.length?{key:'pjtPerson',label:'Person',options:personOpts,current:PJTFILTER.person,cb:'pjtPersonChange'}:null
      ])}
    </span></div>
    <div style="margin-top:14px"><div style="font-size:11.5px;font-weight:700;color:var(--slate);text-transform:uppercase;letter-spacing:.5px">Task Assigned <span class="tag t-gray" style="margin-left:4px">${pjBucketAssigned.length}</span></div>
      <div style="margin-top:6px">${renderTaskDragList(pjBucketAssigned,'project',id,pjDelTab==='mine'?'delegated':'received')}</div></div>
    <div style="margin-top:16px"><div style="font-size:11.5px;font-weight:700;color:var(--slate);text-transform:uppercase;letter-spacing:.5px">Task Delegated <span class="tag t-gray" style="margin-left:4px">${pjBucketDelegated.length}</span></div>
      <div style="margin-top:6px">${renderTaskDragList(pjBucketDelegated,'project',id,pjDelTab==='mine'?'delegated':'received')}</div></div>
  </div>
  <div class="card card-pad" style="margin-top:12px">
    <div class="sec-title" style="display:flex;justify-content:space-between;align-items:center">Details <button class="btn btn-sm" onclick="projectEditModal(${id})"><i class="fa-solid fa-pen"></i> Edit</button></div>
    <div class="info-grid">
      <div class="fld"><div class="k"><i class="fa-solid fa-calendar-day"></i> Due date</div><div class="v date-field"><input type="date" id="pjDueEdit" value="${p.due_date||''}" style="border:1px solid var(--line);border-radius:6px;padding:4px 7px;font-size:13px;font-family:inherit;font-weight:600;color:var(--ink)"><button class="file-act-btn" title="Save" onclick="projectUpdateDue(${id})"><i class="fa-solid fa-check"></i></button>${dueHist.length?`<button class="file-act-btn" title="History" onclick="toggleHist('pjDueHist',event)"><i class="fa-solid fa-clock-rotate-left"></i></button>`:''}</div></div>
      <div class="fld"><div class="k"><i class="fa-regular fa-calendar"></i> Created</div><div class="v">${fmtDate(p.created_at)}</div></div>
      <div class="fld"><div class="k"><i class="fa-solid fa-flag"></i> Priority</div><div class="v">${prioTag(p.priority)}</div></div>
      <div class="fld"><div class="k"><i class="fa-solid fa-circle-dot"></i> Status</div><div class="v">${statusTag(p.status)}</div></div>
    </div>
    ${dueHist.length?`<div id="pjDueHist" class="hist-section">
      <div class="h-title"><i class="fa-solid fa-clock-rotate-left"></i> Due date history</div>
      ${dueHist.slice().reverse().map(h=>`<div class="h-row">${h.old?fmtDateShort(h.old):'Not set'} <i class="fa-solid fa-arrow-right"></i> <b>${h.new?fmtDateShort(h.new):'Not set'}</b> <span class="h-meta">· ${esc(nameOf(h.by))}, ${relTime(h.at)}</span></div>`).join('')}
    </div>`:''}
    <div class="info-divider"></div>
    <div class="info-sub" style="display:flex;justify-content:space-between;align-items:center">Attachments <span class="attach-actions" style="display:flex;gap:6px">
      <button class="btn btn-sm" onclick="filesDownloadSel('pjAttachList')"><i class="fa-solid fa-download"></i> Download</button>
      <button class="btn btn-sm btn-danger" onclick="projectAttachDeleteSel(${id})"><i class="fa-solid fa-trash"></i> Delete</button>
      <button class="btn btn-sm" onclick="document.getElementById('pjAttachAdd').click()"><i class="fa-solid fa-paperclip"></i> Add</button>
    </span></div>
    <input type="file" id="pjAttachAdd" style="display:none" onchange="projectAttachUpload(${id},this)">
    <div id="pjAttachList" class="attach-grid">${(files||[]).map(f=>`<label class="attach-card"><input type="checkbox" class="checkbox attach-chk" data-id="${f.id}" data-path="${esc(f.storage_path)}" data-name="${esc(f.file_name)}"><i class="fa-solid fa-paperclip"></i><span class="name" title="${esc(f.file_name)}">${esc(f.file_name)}</span></label>`).join('')||'<span style="color:var(--slate);font-size:12px">None</span>'}</div>
    <div class="info-divider"></div>
    <div class="info-sub" style="display:flex;justify-content:space-between;align-items:center">Owners ${canManage?`<button class="btn btn-sm" onclick="projectOwnersModal(${id})"><i class="fa-solid fa-user-shield"></i> Manage</button>`:''}</div>
    <div class="people-grid">${owners.map(e=>`<span class="people-chip">${avatar(nameOf(e))} ${esc(nameOf(e))}</span>`).join('')||'<span style="color:var(--slate);font-size:13px">No owners</span>'}</div>
    <div class="info-divider"></div>
    <div class="info-sub">Members ${canManage?`<button class="btn btn-sm" onclick="projectMembersModal(${id})"><i class="fa-solid fa-user-plus"></i> Manage</button>`:''}</div>
    <div class="people-grid">${peopleList.map(e=>`<span class="people-chip">${avatar(nameOf(e))} ${esc(nameOf(e))} ${owners.includes(e)?'<i class="fa-solid fa-shield-halved" style="color:#1d4ed8;font-size:10px" title="Owner"></i>':''}</span>`).join('')||'<span style="color:var(--slate);font-size:12px">None</span>'}</div>
    ${canManage?`<div class="info-divider"></div><div style="display:flex;justify-content:flex-end"><button class="btn btn-sm btn-danger" onclick="projectDelete(${id})"><i class="fa-solid fa-trash"></i> Delete project</button></div>`:''}
  </div>`;
  wireProjTaskDrag('project',id);
}
window.projectUpdateDue=async function(id){
  const val=$('pjDueEdit').value||null;
  const {data:cur}=await sb.schema('acc').from('projects').select('due_date,due_date_history').eq('id',id).single();
  const hist=(cur&&cur.due_date_history)||[];
  const oldVal=cur?cur.due_date:null;
  if(oldVal===val){toast('No change','ok');return;}
  hist.push({old:oldVal,new:val,by:state.email,at:new Date().toISOString()});
  const {error}=await sb.schema('acc').from('projects').update({due_date:val,due_date_history:hist}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  toast('Due date updated','ok');projectDetail($('view'),id);
};
async function recalcProjectProgress(projectId){
  const {data:tasks}=await sb.schema('acc').from('tasks').select('status').eq('project_id',projectId);
  const items=tasks||[];const total=items.length;
  const done=items.filter(t=>t.status==='Completed').length;
  const p=total?Math.round(done/total*100):0;
  let status=(total&&p===100)?'Completed':p>0?'In Progress':'Pending';
  await sb.schema('acc').from('projects').update({progress:p,status}).eq('id',projectId);
}
window.pjTaskToggle=async function(taskId,projectId,done){
  if(done){
    const {data:resultStatus,error}=await sb.schema('acc').rpc('task_ask_approval',{tid:taskId});
    if(error){toast(error.message,'err');projectDetail($('view'),projectId);return;}
    if(resultStatus==='Awaiting Approval'){toast(NEEDS_TASK_PAGE_MSG,'warn');projectDetail($('view'),projectId);return;}
    await sb.schema('acc').from('task_activity').insert({task_id:taskId,actor:state.email,action:'marked this task complete'});
    toast('Marked complete','ok');
  }else{
    await sb.schema('acc').from('tasks').update({status:'Pending'}).eq('id',taskId);
    await recalcTaskProgress(taskId);
    toast('Reopened','ok');
  }
  await recalcProjectProgress(projectId);
  projectDetail($('view'),projectId);
};
/* ---- shared drag-to-reorder Task list for Projects & Goals (position = priority, doesn't touch the priority column) ---- */
function taskRowHtml(t,parentType,parentId,dgCtx){
  const toggleFn=parentType==='project'?'pjTaskToggle':'glTaskToggle';
  // dgCtx tags which tab this row was opened from ("received" = Assigned to me, "delegated" = Assigned by me)
  // so the Task Detail page knows which Members view to show — see taskDetail's originalTeam logic.
  const hashSuffix=dgCtx?'/'+dgCtx:'';
  // Whoever has nobody delegating this specific task TO them (root for their own branch, see
  // _needsApproval set by the caller) can tick the box straight from the row and it completes for
  // real. Everyone who'd actually need approval still has to open the task page.
  const canDirectCheck=t.status==='Pending'&&!t._needsApproval;
  const checkDisabled=!(t.status==='Completed'||canDirectCheck);
  return `<div class="drag-row" data-id="${t.id}">
    <i class="fa-solid fa-grip-vertical drag-handle"></i>
    <input type="checkbox" class="checkbox" ${t.status==='Completed'?'checked':''} ${checkDisabled?'disabled title="Open the task to mark it complete"':''} onchange="${toggleFn}(${t.id},${parentId},this.checked)">
    <div style="flex:1;min-width:0;cursor:pointer" onclick="location.hash='#/tasks/view/${t.id}${hashSuffix}'">
      <div style="font-weight:600;font-size:13px">${esc(t.title)}</div>
      <div style="color:var(--slate);font-size:11.5px">${t._dgLabel?'<span class="dg-label">'+t._dgLabel+' · </span>':''}${t.due_date?'Due '+fmtDateShort(t.due_date):'No due date'}</div>
    </div>
    ${statusTag(t.status)}
    <div style="width:42px;text-align:right;font-size:12px;font-weight:600;color:var(--brand)">${t.progress}%</div>
  </div>`;
}
function renderTaskDragList(tasks,parentType,parentId,dgCtx){
  const list=tasks.slice().sort((a,b)=>(a.sort_order??999999)-(b.sort_order??999999));
  if(parentType==='project')window.__PJT_ORDER=list.map(t=>t.id);
  else window.__GL_ORDER=list.map(t=>t.id);
  if(!list.length)return '<div class="empty" style="padding:22px"><i class="fa-regular fa-circle-check"></i><div>No tasks match</div></div>';
  return `<div class="drag-list">${list.map(t=>taskRowHtml(t,parentType,parentId,dgCtx)).join('')}</div>`;
}
/* ---- pointer-events drag-to-reorder (works on mouse + touch, unlike native HTML5 DnD) ---- */
function wireProjTaskDrag(parentType,parentId){
  document.querySelectorAll('.drag-list').forEach(list=>{
    list.querySelectorAll('.drag-row').forEach(row=>{
      const grip=row.querySelector('.drag-handle'); if(!grip)return;
      grip.style.touchAction='none';
      grip.onpointerdown=function(e){
        e.preventDefault(); e.stopPropagation();
        try{grip.setPointerCapture(e.pointerId);}catch(_){}
        window._dragging=true; row.classList.add('dragging');
        function move(ev){
          const el=document.elementFromPoint(ev.clientX,ev.clientY);
          const tgt=el&&el.closest('.drag-row');
          if(tgt&&tgt!==row&&list.contains(tgt)){
            const r=tgt.getBoundingClientRect();
            if(ev.clientY<r.top+r.height/2)list.insertBefore(row,tgt); else list.insertBefore(row,tgt.nextSibling);
          }
        }
        function up(){
          try{grip.releasePointerCapture(e.pointerId);}catch(_){}
          window._dragging=false; row.classList.remove('dragging');
          document.removeEventListener('pointermove',move);
          document.removeEventListener('pointerup',up);
          persistProjTaskOrder(list,parentType,parentId);
        }
        document.addEventListener('pointermove',move);
        document.addEventListener('pointerup',up);
      };
    });
  });
}
async function persistProjTaskOrder(list,parentType,parentId){
  const ids=[...list.querySelectorAll('.drag-row')].map(r=>Number(r.dataset.id));
  await Promise.all(ids.map((tid,i)=>sb.schema('acc').from('tasks').update({sort_order:i}).eq('id',tid)));
  if(parentType==='project')projectDetail($('view'),parentId); else goalDetail($('view'),parentId);
}
window.taskDragOver=function(e,row){
  const r=row.getBoundingClientRect();
  const above=(e.clientY-r.top)<r.height/2;
  row.classList.toggle('drop-above',above);
  row.classList.toggle('drop-below',!above);
};
window.taskReorderDrop=async function(e,row,parentType,parentId){
  e.preventDefault();
  const above=row.classList.contains('drop-above');
  row.classList.remove('drop-above','drop-below');
  const draggedId=parseInt(e.dataTransfer.getData('text/plain'));
  const targetId=parseInt(row.dataset.id);
  if(!draggedId||draggedId===targetId)return;
  const orderKey=parentType==='project'?'__PJT_ORDER':'__GL_ORDER';
  let order=(window[orderKey]||[]).slice();
  order=order.filter(tid=>tid!==draggedId);
  let idx=order.indexOf(targetId);
  if(idx===-1)idx=order.length;
  order.splice(above?idx:idx+1,0,draggedId);
  window[orderKey]=order;
  await Promise.all(order.map((tid,i)=>sb.schema('acc').from('tasks').update({sort_order:i}).eq('id',tid)));
  if(parentType==='project')projectDetail($('view'),parentId);
  else goalDetail($('view'),parentId);
};
window.projectAttachUpload=async function(id,inputEl){
  const f=inputEl.files[0];if(!f)return;
  const key=s3KeyForProject(id,f.name);
  toast('Uploading '+f.name+'…','ok');
  const {data:upData,error:ue}=await uploadFileToS3(key,f);
  if(ue){toast('Attachment upload failed: '+ue.message,'err');inputEl.value='';return;}
  const {error}=await sb.schema('acc').from('project_files').insert({project_id:id,file_name:f.name,storage_path:upData.path,file_size:f.size,uploaded_by:state.email});
  if(error){toast(error.message,'err');return;}
  toast('Attachment added','ok');projectDetail($('view'),id);
};
window.projectAttachDelete=async function(id,fileId,path){
  if(!await confirmDialog('Remove this attachment?'))return;
  if(path){ if(isS3Path(path)) await s3Delete(path); else await sb.storage.from('documents').remove([path]); }
  await sb.schema('acc').from('project_files').delete().eq('id',fileId);
  toast('Attachment removed','ok');projectDetail($('view'),id);
};
window.filesDownloadSel=function(containerId){
  const checked=[...document.querySelectorAll('#'+containerId+' .attach-chk:checked')];
  if(!checked.length)return;
  checked.forEach((cb,i)=>setTimeout(()=>taskFileDl(cb.dataset.path,cb.dataset.name),i*300));
};
window.projectAttachDeleteSel=async function(id){
  const checked=[...document.querySelectorAll('#pjAttachList .attach-chk:checked')];
  if(!checked.length)return;
  if(!await confirmDialog(`Delete ${checked.length} file(s)?`))return;
  for(const cb of checked){
    const path=cb.dataset.path;
    if(path){ if(isS3Path(path)) await s3Delete(path); else await sb.storage.from('documents').remove([path]); }
    await sb.schema('acc').from('project_files').delete().eq('id',cb.dataset.id);
  }
  toast('Attachments removed','ok');projectDetail($('view'),id);
};
window.projectMembersModal=async function(id){
  const {data:members}=await sb.schema('acc').from('project_members').select('email').eq('project_id',id);
  const current=(members||[]).map(m=>m.email);
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-users"></i> Manage members</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm"><label>Members</label>${msHtml('pjmMembers')}</div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="projectMembersSave(${id})"><i class="fa-solid fa-check"></i> Save</button></div>`,'lg');
  setTimeout(()=>msInit('pjmMembers',current),30);
};
window.projectMembersSave=async function(id){
  const {data:members}=await sb.schema('acc').from('project_members').select('email').eq('project_id',id);
  const current=new Set((members||[]).map(m=>m.email));
  const next=new Set(getMS('pjmMembers'));
  const toAdd=[...next].filter(e=>!current.has(e));
  const toRemove=[...current].filter(e=>!next.has(e));
  if(toAdd.length)await sb.schema('acc').from('project_members').insert(toAdd.map(e=>({project_id:id,email:e})));
  for(const e of toRemove){await sb.schema('acc').from('project_members').delete().eq('project_id',id).eq('email',e);}
  closeModal();toast('Members updated','ok');projectDetail($('view'),id);
};
window.projectOwnersModal=async function(id){
  const [{data:owners},{data:proj}]=await Promise.all([
    sb.schema('acc').from('project_owners').select('email,rank').eq('project_id',id).order('rank',{ascending:true}),
    sb.schema('acc').from('projects').select('created_by').eq('id',id).single()
  ]);
  const creator=proj&&proj.created_by;
  const current=[...new Set([...(owners||[]).map(o=>o.email),...(creator?[creator]:[])])];
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-user-shield"></i> Manage owners</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm"><label>Owners</label>
  <div style="color:var(--slate);font-size:12px;margin:-3px 0 6px">Owners can manage this project's members, owners, and settings. The project creator always stays an owner.</div>
  ${msHtml('pjoOwners')}</div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="projectOwnersSave(${id})"><i class="fa-solid fa-check"></i> Save</button></div>`,'lg');
  setTimeout(()=>msInit('pjoOwners',current,null,false,creator?[creator]:[]),30);
};
window.projectOwnersSave=async function(id){
  const next=getMS('pjoOwners');
  if(!next.length){toast('A project needs at least one owner','err');return;}
  await sb.schema('acc').from('project_owners').delete().eq('project_id',id);
  await sb.schema('acc').from('project_owners').insert(next.map((email,i)=>({project_id:id,email,rank:i})));
  await sb.schema('acc').from('projects').update({owner:next[0]}).eq('id',id);
  closeModal();toast('Owners updated','ok');projectDetail($('view'),id);
};
window.projectDelete=async function(id){
  if(!await confirmDialog('Delete this project? Its tasks will remain but lose their project link.'))return;
  const {data:files}=await sb.schema('acc').from('project_files').select('storage_path').eq('project_id',id);
  for(const f of (files||[])){ if(f.storage_path){ if(isS3Path(f.storage_path)) await s3Delete(f.storage_path); else await sb.storage.from('documents').remove([f.storage_path]); } }
  await sb.schema('acc').from('projects').delete().eq('id',id);
  toast('Project deleted','ok');location.hash='#/tasks/list';
};
window.projectEditModal=async function(id){
  const {data:p,error}=await sb.schema('acc').from('projects').select('*').eq('id',id).single();
  if(error||!p){toast('Could not load project','err');return;}
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-pen"></i> Edit project</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm">
      <label>Project name</label><input id="peName" value="${esc(p.name)}">
      <label>Description</label>
      <div style="border:1px solid var(--line);border-radius:8px;overflow:hidden">
        <div style="display:flex;gap:2px;padding:6px;border-bottom:1px solid var(--line);background:#fafbfd">
          <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('bold')"><b>B</b></button>
          <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('italic')"><i>I</i></button>
          <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('insertUnorderedList')"><i class="fa-solid fa-list-ul"></i></button>
        </div>
        <div id="peDesc" contenteditable="true" style="min-height:70px;padding:10px 12px;font-size:13.5px;outline:none">${p.description||''}</div>
      </div>
      <label>Priority</label><select id="pePrio">${['Low','Medium','High','Urgent'].map(x=>`<option ${x===p.priority?'selected':''}>${x}</option>`).join('')}</select>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="projectEditSave(${id})"><i class="fa-solid fa-check"></i> Save</button></div>`,'lg');
};
window.projectEditSave=async function(id){
  const name=$('peName').value.trim();if(!name){toast('Enter a project name','err');return;}
  const {error}=await sb.schema('acc').from('projects').update({name,description:$('peDesc').innerHTML,priority:$('pePrio').value}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  closeModal();toast('Project updated','ok');projectDetail($('view'),id);
};
window.projectMarkComplete=async function(id,makeComplete){
  if(makeComplete){
    const {data:tks}=await sb.schema('acc').from('tasks').select('id').eq('project_id',id);
    const ids=(tks||[]).map(t=>t.id);
    if(ids.length){
      await sb.schema('acc').from('tasks').update({status:'Completed',progress:100}).in('id',ids);
      await completeTaskChecklists(ids);
    }
    await sb.schema('acc').from('projects').update({status:'Completed',progress:100}).eq('id',id);
  }else{
    await sb.schema('acc').from('projects').update({status:'In Progress'}).eq('id',id);
    await recalcProjectProgress(id);
  }
  toast(makeComplete?'Project marked complete':'Reopened','ok');
  projectDetail($('view'),id);
};

/* ---------- goals ---------- */
let GSCOPE='personal';
const GFILTER={prio:'All',status:'All'};
window.gfPrioChange=function(v){GFILTER.prio=v;taskGoals($('view'));};
window.gfStatusChange=function(v){GFILTER.status=v;taskGoals($('view'));};
async function taskGoals(v){
  setCrumb(['Accountability','Goals']);
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-bullseye" style="color:#d97706"></i> Goals</h1><p>Track personal, team and company objectives</p></div>
    <button class="btn btn-primary" onclick="goalCreateModal()"><i class="fa-solid fa-plus"></i> New Goal</button></div>`+taskTabs('goals')+
    `<div class="toolbar" style="justify-content:flex-end;flex-wrap:wrap;gap:10px">
      <div style="display:flex;gap:8px">
        ${fsGroupHtml('gfGroup',[
          {key:'gfScope',label:'Scope',options:['Personal','Team','Company'],current:GSCOPE.charAt(0).toUpperCase()+GSCOPE.slice(1),cb:'gfScopeChange'},
          {key:'gfPrio',label:'Priority',options:['Low','Medium','High','Urgent'],current:GFILTER.prio,cb:'gfPrioChange'},
          {key:'gfStatus',label:'Status',options:['Pending','In Progress','Completed'],current:GFILTER.status,cb:'gfStatusChange'}
        ])}
      </div>
    </div><div id="goalBody"><div class="loader"><div class="spin"></div></div></div>`;
  const me=state.email;
  const {myGoalIds}=await fetchGoalMemberships(me);
  let goalsRaw=[];try{const {data}=await sb.schema('acc').from('goals').select('*').eq('scope',GSCOPE).order('created_at',{ascending:false});goalsRaw=data||[];}catch(e){}
  let goals=goalsRaw;
  if(GSCOPE==='personal'){
    goals=goalsRaw.filter(g=>g.owner===me||g.created_by===me);
  } else if(GSCOPE==='team'){
    goals=goalsRaw.filter(g=>myGoalIds.has(g.id)||g.owner===me||g.created_by===me);
  }
  // company scope: show all (no filter)
  if(GFILTER.prio!=='All')goals=goals.filter(g=>g.priority===GFILTER.prio);
  if(GFILTER.status!=='All')goals=goals.filter(g=>(g.status||'Pending')===GFILTER.status);
  $('goalBody').innerHTML=goals.length?`<div class="grid lib-grid">${goals.map(g=>`<div class="card card-pad" style="cursor:pointer" onclick="location.hash='#/tasks/goal/${g.id}'">
    <div style="display:flex;justify-content:space-between;align-items:flex-start"><div class="ic" style="width:42px;height:42px;border-radius:11px;background:#fffbeb;color:#d97706;display:flex;align-items:center;justify-content:center;font-size:17px"><i class="fa-solid fa-bullseye"></i></div><span class="tag ${g.scope==='company'?'t-purple':g.scope==='team'?'t-blue':'t-gray'}" style="text-transform:capitalize">${esc(g.scope)}</span></div>
    <div style="font-weight:600;font-size:15px;margin-top:12px">${esc(g.name)}</div>
    <div style="color:var(--slate);font-size:12.5px;margin-top:4px;min-height:34px">${esc((g.description||'').replace(/<[^>]+>/g,' ').slice(0,80))}</div>
    <div style="margin-top:8px">${prioTag(g.priority)} ${statusTag(g.status||'Pending')}</div>
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:10px"><span style="color:var(--slate)">Progress</span><b>${g.progress||0}%</b></div>
    <div class="progress" style="margin-top:6px"><span style="width:${g.progress||0}%"></span></div></div>`).join('')}</div>`:`<div class="card card-pad empty"><i class="fa-regular fa-circle-dot"></i><div>No ${GSCOPE} goals match</div><button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="goalCreateModal()"><i class="fa-solid fa-plus"></i> Create one</button></div>`;
}
window.gfScopeChange=function(v){GSCOPE=v.toLowerCase();taskGoals($('view'));};
window.goalCreateModal=function(){
  const defScope=GSCOPE||'personal';const hide=defScope==='personal'?'display:none':'';
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-bullseye"></i> New goal</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>Goal name</label><input id="glName" placeholder="e.g. Achieve ₹50 Cr in bookings">
    <label>Description</label>
    <div style="border:1px solid var(--line);border-radius:8px;overflow:hidden">
      <div style="display:flex;gap:2px;padding:6px;border-bottom:1px solid var(--line);background:#fafbfd">
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('bold')"><b>B</b></button>
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('italic')"><i>I</i></button>
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('insertUnorderedList')"><i class="fa-solid fa-list-ul"></i></button>
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('insertOrderedList')"><i class="fa-solid fa-list-ol"></i></button>
      </div>
      <div id="glDesc" contenteditable="true" style="min-height:70px;padding:10px 12px;font-size:13.5px;outline:none"></div>
    </div>
    <div class="two"><div><label>Scope</label><select id="glScope" onchange="glScopeChange()"><option value="personal" ${defScope==='personal'?'selected':''}>Personal</option><option value="team" ${defScope==='team'?'selected':''}>Team</option><option value="company" ${defScope==='company'?'selected':''}>Company</option></select></div>
    <div><label>Priority</label><select id="glPrio"><option>Low</option><option selected>Medium</option><option>High</option><option>Urgent</option></select></div></div>
    <div id="glOwnerWrap" style="${hide}"><label>Owner</label><select id="glOwner">${peopleOptions(state.email)}</select></div>
    <div class="two"><div><label>Start date</label><input type="date" id="glStart"></div><div><label>End date (optional)</label><input type="date" id="glEnd"></div></div>
    <div id="glMembersWrap" style="${hide}"><label>Members</label>${msHtml('glMembers')}</div>
    <label>Status</label><div class="seg" id="glStatusSeg">${['Pending','In Progress','Completed'].map((x,i)=>'<button type="button" class="seg-btn'+(i===0?' on':'')+'" onclick="glPickStatus(this,\''+x+'\')">'+x+'</button>').join('')}</div><input type="hidden" id="glStatus" value="Pending">
    <label>Attachment (optional)</label><input type="file" id="glFile">
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="glSave" onclick="goalSave()"><i class="fa-solid fa-check"></i> Create goal</button></div>`,'lg');
  setTimeout(()=>msInit('glMembers',[]),30);
};
window.glScopeChange=function(){const show=$('glScope').value!=='personal';$('glOwnerWrap').style.display=show?'':'none';$('glMembersWrap').style.display=show?'':'none';};
window.glPickStatus=function(btn,val){document.querySelectorAll('#glStatusSeg .seg-btn').forEach(b=>b.classList.remove('on'));btn.classList.add('on');$('glStatus').value=val;};
window.goalSave=async function(){
  const name=$('glName').value.trim();if(!name){toast('Enter a goal name','err');return;}
  const scope=$('glScope').value;
  const status=$('glStatus').value;
  const row={name,scope,description:$('glDesc').innerHTML,start_date:$('glStart').value||null,end_date:$('glEnd').value||null,progress:0,status,priority:$('glPrio').value,created_by:state.email,owner:scope==='personal'?state.email:($('glOwner')?$('glOwner').value:state.email)};
  const btn=$('glSave');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';
  const {data,error}=await sb.schema('acc').from('goals').insert(row).select().single();
  if(error){toast(error.message,'err');btn.disabled=false;return;}
  if(scope!=='personal'){const mem=getMS('glMembers');if(mem.length)await sb.schema('acc').from('goal_members').insert(mem.map(e=>({goal_id:data.id,email:e})));}
  const f=$('glFile').files[0];
  if(f){const key=s3KeyForGoal(data.id,f.name);const {data:upData,error:ue}=await uploadFileToS3(key,f);if(ue)toast('Goal created, but attachment upload failed: '+ue.message,'err');else await sb.schema('acc').from('goal_files').insert({goal_id:data.id,file_name:f.name,storage_path:upData.path,file_size:f.size,uploaded_by:state.email});}
  closeModal();toast('Goal created','ok');location.hash='#/tasks/goal/'+data.id;route();
};
const GLTFILTER={status:'All'};
window.gltStatusChange=function(v){GLTFILTER.status=v;goalDetail($('view'),window.__GL_ID);};
window.glTaskToggle=async function(taskId,goalId,done){
  if(done){
    const {data:resultStatus,error}=await sb.schema('acc').rpc('task_ask_approval',{tid:taskId});
    if(error){toast(error.message,'err');goalDetail($('view'),goalId);return;}
    if(resultStatus==='Awaiting Approval'){toast(NEEDS_TASK_PAGE_MSG,'warn');goalDetail($('view'),goalId);return;}
    await sb.schema('acc').from('task_activity').insert({task_id:taskId,actor:state.email,action:'marked this task complete'});
    toast('Marked complete','ok');
  }else{
    await sb.schema('acc').from('tasks').update({status:'Pending'}).eq('id',taskId);
    await recalcTaskProgress(taskId);
    toast('Reopened','ok');
  }
  await recalcGoalProgress(goalId);
  goalDetail($('view'),goalId);
};
async function goalDetail(v,id){
  loader(v);
  window.__GL_ID=id;
  const {data:g,error}=await sb.schema('acc').from('goals').select('*').eq('id',id).single();
  if(error||!g){v.innerHTML='<div class="empty"><i class="fa-solid fa-ban"></i><div>Goal not found</div></div>';return;}
  setCrumb(['Accountability',['Goals','#/tasks/goals'],g.name]);
  const [{data:mem},{data:files},{data:tasks},{data:comments}]=await Promise.all([
    sb.schema('acc').from('goal_members').select('*').eq('goal_id',id),
    sb.schema('acc').from('goal_files').select('*').eq('goal_id',id),
    sb.schema('acc').from('tasks').select('*').eq('goal_id',id).order('due_date',{ascending:true}),
    sb.schema('acc').from('goal_comments').select('*').eq('goal_id',id).order('created_at')
  ]);
  const list=tasks||[];
  let flist=list;
  if(GLTFILTER.status!=='All')flist=flist.filter(t=>t.status===GLTFILTER.status);
  const statusOpts=['Pending','Awaiting Approval','Completed'];
  const prog=g.progress||0;
  v.innerHTML=`<div class="page-head"><div><button class="btn btn-sm" onclick="history.back()"><i class="fa-solid fa-arrow-left"></i> Back</button><h1 style="margin-top:10px"><i class="fa-solid fa-bullseye" style="color:#d97706"></i> ${esc(g.name)}</h1><p><span class="tag ${g.scope==='company'?'t-purple':g.scope==='team'?'t-blue':'t-gray'}" style="text-transform:capitalize">${esc(g.scope)}</span> ${prioTag(g.priority)} ${statusTag(g.status||'Pending')} · Owner ${esc(nameOf(g.owner))} · ${list.length} task${list.length===1?'':'s'}</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn ${g.status==='Completed'?'btn-primary':''}" onclick="goalMarkComplete(${id},${g.status!=='Completed'})"><i class="fa-solid fa-circle-check"></i> ${g.status==='Completed'?'Completed':'Mark Complete'}</button>
      <button class="btn btn-primary" onclick="taskCreateModal('task',null,null,${id},'${esc(g.name).replace(/'/g,"\\'")}')"><i class="fa-solid fa-plus"></i> New Task</button>
    </div>
  </div>
  <div class="detail-grid">
    <div>
      <div class="card card-pad"><div class="sec-title">Description</div><div style="margin-top:8px;line-height:1.6;color:#334155;font-size:14px">${g.description||'<span style="color:#94a3b8">No description</span>'}</div></div>
      <div class="card card-pad" style="margin-top:16px"><div class="sec-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <span>Tasks</span>
        <span style="display:flex;gap:8px">
          ${fsHtml('gltStatus','Status',statusOpts,GLTFILTER.status,'gltStatusChange')}
        </span></div>
        <div style="margin-top:10px">${renderTaskDragList(flist,'goal',id)}</div>
      </div>
    </div>
    <div>
      <div class="card card-pad" style="text-align:center;padding-top:20px;padding-bottom:26px"><div class="sec-title" style="text-align:left">Progress</div>
        <div style="position:relative;width:180px;height:180px;margin:20px auto"><canvas id="chGoal"></canvas><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:700">${prog}%</div></div>
        <div style="color:var(--slate);font-size:12.5px;margin-top:10px">${list.length?`Auto-tracked from ${list.filter(t=>t.status==='Completed').length}/${list.length} tasks completed`:'Add tasks and tick them off to track progress'}</div>
      </div>
    </div>
  </div>
  <div class="card card-pad" style="margin-top:16px"><div class="sec-title"><i class="fa-solid fa-bullhorn"></i> Updates & Feedback</div>
    <div id="glCmList" class="chat-wrap" style="margin-top:10px">${(comments||[]).map(c=>glCmItem(c,id)).join('')||'<div style="color:var(--slate);font-size:13px">No updates yet — post the first one.</div>'}</div>
    <div id="glCmFileChip" style="display:none;align-items:center;gap:8px;margin-top:8px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;font-size:12.5px;color:var(--slate);width:fit-content"><i class="fa-solid fa-paperclip"></i><span id="glCmFileName"></span><i class="fa-solid fa-xmark" style="cursor:pointer;color:var(--err)" onclick="glCmClearFile()"></i></div>
    <input type="file" id="glCmFile" style="display:none" onchange="glCmFilePicked(this)">
    <div class="chat-composer"><button class="btn" title="Attach a file" onclick="document.getElementById('glCmFile').click()"><i class="fa-solid fa-paperclip"></i></button><input id="glCmNew" placeholder="Post an update or feedback…" onkeydown="if(event.key==='Enter')glCmAdd(${id})"><button class="btn btn-primary" onclick="glCmAdd(${id})"><i class="fa-solid fa-paper-plane"></i></button></div>
  </div>
  <div class="card card-pad" style="margin-top:16px">
    <div class="sec-title" style="display:flex;justify-content:space-between;align-items:center">Details <button class="btn btn-sm" onclick="goalEditModal(${id})"><i class="fa-solid fa-pen"></i> Edit</button></div>
    <div class="info-grid">
      <div class="fld"><div class="k"><i class="fa-solid fa-calendar-day"></i> Start date</div><div class="v">${fmtDate(g.start_date)}</div></div>
      <div class="fld"><div class="k"><i class="fa-solid fa-calendar-check"></i> End date</div><div class="v">${fmtDate(g.end_date)}</div></div>
      <div class="fld"><div class="k"><i class="fa-regular fa-user"></i> Owner</div><div class="v">${avatar(nameOf(g.owner))} ${esc(nameOf(g.owner))}</div></div>
      <div class="fld"><div class="k"><i class="fa-solid fa-flag"></i> Priority</div><div class="v">${prioTag(g.priority)}</div></div>
      <div class="fld"><div class="k"><i class="fa-solid fa-circle-dot"></i> Status</div><div class="v">${statusTag(g.status||'Pending')}</div></div>
    </div>
    <div class="info-divider"></div>
    <div class="info-sub" style="display:flex;justify-content:space-between;align-items:center">Attachments <span style="display:flex;gap:6px">
      <button class="btn btn-sm" onclick="filesDownloadSel('glAttachList')"><i class="fa-solid fa-download"></i> Download</button>
      <button class="btn btn-sm btn-danger" onclick="goalAttachDeleteSel(${id})"><i class="fa-solid fa-trash"></i> Delete</button>
      <button class="btn btn-sm" onclick="document.getElementById('glAttachAdd').click()"><i class="fa-solid fa-paperclip"></i> Add</button>
    </span></div>
    <input type="file" id="glAttachAdd" style="display:none" onchange="goalAttachUpload(${id},this)">
    <div id="glAttachList" class="attach-grid">${(files||[]).map(f=>`<label class="attach-card"><input type="checkbox" class="checkbox attach-chk" data-id="${f.id}" data-path="${esc(f.storage_path)}" data-name="${esc(f.file_name)}"><i class="fa-solid fa-paperclip"></i><span class="name" title="${esc(f.file_name)}">${esc(f.file_name)}</span></label>`).join('')||'<span style="color:var(--slate);font-size:12px">None</span>'}</div>
    <div class="info-divider"></div>
    <div class="info-sub" style="display:flex;justify-content:space-between;align-items:center">Members ${g.scope!=='personal'?`<button class="btn btn-sm" onclick="goalMembersModal(${id})"><i class="fa-solid fa-user-plus"></i> Manage</button>`:''}</div>
    ${g.scope!=='personal'?`<div class="people-grid">${(mem||[]).map(m=>`<span class="people-chip">${avatar(nameOf(m.email))} ${esc(nameOf(m.email))}</span>`).join('')||'<span style="color:var(--slate);font-size:13px">No members</span>'}</div>`:'<div style="color:var(--slate);font-size:12.5px">Personal goal — just you</div>'}
    <div class="info-divider"></div>
    <div style="display:flex;justify-content:flex-end"><button class="btn btn-sm btn-danger" onclick="goalDelete(${id})"><i class="fa-solid fa-trash"></i> Delete goal</button></div>
  </div>`;
  new Chart($('chGoal'),{type:'doughnut',data:{datasets:[{data:[prog,100-prog],backgroundColor:[prog===100?'#16a34a':'#d97706','#eef1f6'],borderWidth:0}]},options:{cutout:'78%',plugins:{legend:{display:false},tooltip:{enabled:false}}}});
  const glCmW=$('glCmList');if(glCmW)glCmW.scrollTop=glCmW.scrollHeight;
  wireProjTaskDrag('goal',id);
}
async function recalcGoalProgress(id){
  const {data:tasks}=await sb.schema('acc').from('tasks').select('status').eq('goal_id',id);
  const items=tasks||[];
  const total=items.length,done=items.filter(t=>t.status==='Completed').length;
  const p=total?Math.round(done/total*100):0;
  const {data:cur}=await sb.schema('acc').from('goals').select('status').eq('id',id).single();
  let status=cur?cur.status:null;
  if(p===100)status='Completed';else if(status==='Completed')status='In Progress';else if(p>0)status='In Progress';
  await sb.schema('acc').from('goals').update({progress:p,status}).eq('id',id);
}
function glCmItem(c,goalId){
  const mine=c.author===state.email;
  return `<div class="chat-msg ${mine?'mine':''}">
    ${mine?'':avatar(nameOf(c.author))}
    <div style="min-width:0">
      <div class="chat-meta">${mine?'':`<b>${esc(nameOf(c.author))}</b>`}<span>${relTime(c.created_at)}${c.edited?' · edited':''}</span></div>
      <div class="chat-bubble">
        <div id="glcm_body_${c.id}">${esc(c.body)}</div>
        ${mine?`<div class="chat-actions"><i class="fa-solid fa-pen chat-act-ic" title="Edit" onclick="glCmEdit(${c.id},${goalId})"></i><i class="fa-solid fa-trash chat-act-ic danger" title="Delete" onclick="glCmDelete(${c.id},${goalId})"></i></div>`:''}
      </div>
    </div>
  </div>`;
}
window.glCmFilePicked=function(inputEl){
  const f=inputEl.files[0];const chip=$('glCmFileChip'),nm=$('glCmFileName');
  if(!f){if(chip)chip.style.display='none';return;}
  if(nm)nm.textContent=f.name;if(chip)chip.style.display='flex';
};
window.glCmClearFile=function(){const inp=$('glCmFile');if(inp)inp.value='';const chip=$('glCmFileChip');if(chip)chip.style.display='none';};
window.glCmAdd=async function(id){
  const bEl=$('glCmNew');const b=(bEl.value||'').trim();
  const fEl=$('glCmFile');const f=fEl&&fEl.files&&fEl.files[0];
  if(!b&&!f)return;
  let body=b;
  if(f){
    const key=s3KeyForGoal(id,f.name);
    toast('Uploading '+f.name+'\u2026','ok');
    const {data:upData,error:ue}=await uploadFileToS3(key,f);
    if(ue){toast('Attachment upload failed: '+ue.message,'err');return;}
    await sb.schema('acc').from('goal_files').insert({goal_id:id,file_name:f.name,storage_path:upData.path,file_size:f.size,uploaded_by:state.email});
    body=(b?b+' ':'')+'\ud83d\udcce '+f.name;
  }
  await sb.schema('acc').from('goal_comments').insert({goal_id:id,author:state.email,body});
  goalDetail($('view'),id);
};
window.glCmEdit=function(cid,goalId){
  const el=$('glcm_body_'+cid);if(!el)return;const cur=el.textContent;
  el.innerHTML=`<div style="display:flex;gap:8px"><input id="glCmEditIn_${cid}" class="sel" style="flex:1;height:32px" value="${esc(cur)}"><button class="btn btn-sm btn-primary" onclick="glCmEditSave(${cid},${goalId})"><i class="fa-solid fa-check"></i></button></div>`;
  $('glCmEditIn_'+cid).focus();
};
window.glCmEditSave=async function(cid,goalId){
  const v=$('glCmEditIn_'+cid).value.trim();if(!v)return;
  const {error}=await sb.schema('acc').from('goal_comments').update({body:v,edited:true}).eq('id',cid);
  if(error){toast(error.message,'err');return;}
  toast('Message updated','ok');goalDetail($('view'),goalId);
};
window.glCmDelete=async function(cid,goalId){
  if(!await confirmDialog('Delete this message?'))return;
  const {error}=await sb.schema('acc').from('goal_comments').delete().eq('id',cid);
  if(error){toast(error.message,'err');return;}
  toast('Message deleted','ok');goalDetail($('view'),goalId);
};
window.goalMembersModal=async function(id){
  const {data:members}=await sb.schema('acc').from('goal_members').select('email').eq('goal_id',id);
  const current=(members||[]).map(m=>m.email);
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-users"></i> Manage members</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm"><label>Members</label>${msHtml('glmMembers')}</div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="goalMembersSave(${id})"><i class="fa-solid fa-check"></i> Save</button></div>`,'lg');
  setTimeout(()=>msInit('glmMembers',current),30);
};
window.goalMembersSave=async function(id){
  const {data:members}=await sb.schema('acc').from('goal_members').select('email').eq('goal_id',id);
  const current=new Set((members||[]).map(m=>m.email));
  const next=new Set(getMS('glmMembers'));
  const toAdd=[...next].filter(e=>!current.has(e));
  const toRemove=[...current].filter(e=>!next.has(e));
  if(toAdd.length)await sb.schema('acc').from('goal_members').insert(toAdd.map(e=>({goal_id:id,email:e})));
  for(const e of toRemove){await sb.schema('acc').from('goal_members').delete().eq('goal_id',id).eq('email',e);}
  closeModal();toast('Members updated','ok');goalDetail($('view'),id);
};
window.goalAttachUpload=async function(id,inputEl){
  const f=inputEl.files[0];if(!f)return;
  const key=s3KeyForGoal(id,f.name);
  toast('Uploading '+f.name+'…','ok');
  const {data:upData,error:ue}=await uploadFileToS3(key,f);
  if(ue){toast('Attachment upload failed: '+ue.message,'err');inputEl.value='';return;}
  const {error}=await sb.schema('acc').from('goal_files').insert({goal_id:id,file_name:f.name,storage_path:upData.path,file_size:f.size,uploaded_by:state.email});
  if(error){toast(error.message,'err');return;}
  toast('Attachment added','ok');goalDetail($('view'),id);
};
window.goalAttachDelete=async function(id,fileId,path){
  if(!await confirmDialog('Remove this attachment?'))return;
  if(path){ if(isS3Path(path)) await s3Delete(path); else await sb.storage.from('documents').remove([path]); }
  await sb.schema('acc').from('goal_files').delete().eq('id',fileId);
  toast('Attachment removed','ok');goalDetail($('view'),id);
};
window.goalAttachDeleteSel=async function(id){
  const checked=[...document.querySelectorAll('#glAttachList .attach-chk:checked')];
  if(!checked.length)return;
  if(!await confirmDialog(`Delete ${checked.length} file(s)?`))return;
  for(const cb of checked){
    const path=cb.dataset.path;
    if(path){ if(isS3Path(path)) await s3Delete(path); else await sb.storage.from('documents').remove([path]); }
    await sb.schema('acc').from('goal_files').delete().eq('id',cb.dataset.id);
  }
  toast('Attachments removed','ok');goalDetail($('view'),id);
};
window.goalDelete=async function(id){
  if(!await confirmDialog('Delete this goal permanently?'))return;
  const {data:files}=await sb.schema('acc').from('goal_files').select('storage_path').eq('goal_id',id);
  for(const f of (files||[])){ if(f.storage_path){ if(isS3Path(f.storage_path)) await s3Delete(f.storage_path); else await sb.storage.from('documents').remove([f.storage_path]); } }
  await sb.schema('acc').from('goals').delete().eq('id',id);
  toast('Goal deleted','ok');location.hash='#/tasks/goals';
};
window.goalEditModal=async function(id){
  const {data:g,error}=await sb.schema('acc').from('goals').select('*').eq('id',id).single();
  if(error||!g){toast('Could not load goal','err');return;}
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-pen"></i> Edit goal</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm">
      <label>Goal name</label><input id="geName" value="${esc(g.name)}">
      <label>Description</label>
      <div style="border:1px solid var(--line);border-radius:8px;overflow:hidden">
        <div style="display:flex;gap:2px;padding:6px;border-bottom:1px solid var(--line);background:#fafbfd">
          <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('bold')"><b>B</b></button>
          <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('italic')"><i>I</i></button>
          <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('insertUnorderedList')"><i class="fa-solid fa-list-ul"></i></button>
        </div>
        <div id="geDesc" contenteditable="true" style="min-height:70px;padding:10px 12px;font-size:13.5px;outline:none">${g.description||''}</div>
      </div>
      <div class="two"><div><label>Start date</label><input type="date" id="geStart" value="${g.start_date||''}"></div><div><label>End date</label><input type="date" id="geEnd" value="${g.end_date||''}"></div></div>
      <div class="two"><div><label>Owner</label><select id="geOwner">${peopleOptions(g.owner)}</select></div>
      <div><label>Priority</label><select id="gePrio">${['Low','Medium','High','Urgent'].map(x=>`<option ${x===g.priority?'selected':''}>${x}</option>`).join('')}</select></div></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="goalEditSave(${id})"><i class="fa-solid fa-check"></i> Save</button></div>`,'lg');
};
window.goalEditSave=async function(id){
  const name=$('geName').value.trim();if(!name){toast('Enter a goal name','err');return;}
  const {error}=await sb.schema('acc').from('goals').update({name,description:$('geDesc').innerHTML,start_date:$('geStart').value||null,end_date:$('geEnd').value||null,owner:$('geOwner').value,priority:$('gePrio').value}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  closeModal();toast('Goal updated','ok');goalDetail($('view'),id);
};
window.goalMarkComplete=async function(id,makeComplete){
  if(makeComplete){
    const {data:tks}=await sb.schema('acc').from('tasks').select('id').eq('goal_id',id);
    const ids=(tks||[]).map(t=>t.id);
    if(ids.length){
      await sb.schema('acc').from('tasks').update({status:'Completed',progress:100}).in('id',ids);
      await completeTaskChecklists(ids);
    }
    await sb.schema('acc').from('goals').update({status:'Completed',progress:100}).eq('id',id);
  }else{
    await sb.schema('acc').from('goals').update({status:'In Progress'}).eq('id',id);
    await recalcGoalProgress(id);
  }
  toast(makeComplete?'Marked complete':'Reopened','ok');
  goalDetail($('view'),id);
};

/* ---------- SETTINGS ---------- */
VIEWS.settings=async function(v){
  setCrumb(['Home','Settings']);
  const nm=(state.profile&&state.profile.full_name)||state.email.split('@')[0];
  const roles=state.roles||{};
  const modRows=[['doc','Documents'],['acc','Accountability / Tasks'],['crm','CRM'],['hr','HR'],['projects','Projects'],['finance','Finance'],['kraya','Procurement'],['masters','Masters']];
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-gear" style="color:#475569"></i> Settings</h1><p>Your account, access and workspace preferences</p></div></div>
  <div class="grid grid-2">
    <div class="card card-pad"><div class="sec-title">Account</div>
      <div style="display:flex;align-items:center;gap:14px;margin-top:14px"><span class="avatar-sm" style="width:54px;height:54px;font-size:18px;background:${colorFor(state.email)}">${esc(initials(nm).toUpperCase())}</span><div><div style="font-weight:700;font-size:16px">${esc(nm)}</div><div style="color:var(--slate);font-size:13px">${esc(state.email)}</div>${state.super?'<span class="tag t-purple" style="margin-top:6px"><i class="fa-solid fa-shield-halved"></i> Super Admin</span>':''}</div></div>
      <div style="margin-top:18px;display:flex;gap:10px"><button class="btn" onclick="navTo('tasks/profile')"><i class="fa-regular fa-user"></i> Edit profile</button></div>
    </div>
    <div class="card card-pad"><div class="sec-title">Module Access</div><div class="sec-sub">Your role per module (set by an administrator)</div>
      <table style="margin-top:6px"><tbody>${modRows.map(m=>`<tr><td style="font-weight:500">${m[1]}</td><td style="text-align:right">${roles[m[0]]?'<span class="tag t-green">'+esc(roles[m[0]])+'</span>':'<span class="tag t-gray">No access</span>'}</td></tr>`).join('')}</tbody></table>
    </div>
  </div>
  <div class="card card-pad" style="margin-top:16px"><div class="sec-title">Workspace</div><div class="sec-sub">Connection & system information</div>
    <table style="margin-top:6px"><tbody>
      <tr><td style="color:var(--slate)">Organisation</td><td style="text-align:right"><b>Jain Group</b></td></tr>
      <tr><td style="color:var(--slate)">Database</td><td style="text-align:right"><b>Supabase · ap-south-1</b> <span class="tag t-green">Connected</span></td></tr>
      <tr><td style="color:var(--slate)">Storage buckets</td><td style="text-align:right"><b>documents, legal-docs, task-attachments, branding</b></td></tr>
      <tr><td style="color:var(--slate)">Security</td><td style="text-align:right">Row-Level Security <span class="tag t-green">Enforced</span></td></tr>
      <tr><td style="color:var(--slate)">Version</td><td style="text-align:right"><b>Nexus-RE v1.0</b></td></tr>
      <tr><td style="color:var(--slate)">This session</td><td style="text-align:right" id="sessInfo">…</td></tr>
    </tbody></table>
  </div>`;
  try{
    const {data}=await sb.auth.getSession();
    const tok=data&&data.session&&data.session.access_token;
    const el=document.getElementById('sessInfo');
    if(tok&&el){
      const p=JSON.parse(atob(tok.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
      el.innerHTML='started <b>'+new Date(p.iat*1000).toLocaleTimeString()+'</b> · token …'+esc(tok.slice(-10));
    }
  }catch(e){}
};


/* ============================ HELP DESK ============================ */
const UNDER_CONSTRUCTION='This module is currently <b>under construction</b> — no further details can be provided at this time. Please raise a ticket if you need help.';
const HD_KB=[
 // ── Documents ──────────────────────────────────────────────────────────────
 {k:['upload document','upload file','add document','add file','put file','upload a doc'],a:`To upload a document: open <b>Document Library</b> from the sidebar, pick a department tab, then click <b>Upload</b>. Select your file, choose or type a <b>Category/Folder</b>, and save. Large files (up to 5 GB) are supported via resumable upload.`},
 {k:['folder','category','new folder','create folder','add category'],a:`To create a folder/category: inside any Document Library click <b>+ New Folder</b>. In <b>Legal</b>, every folder and category in the tree has a small <b>+</b> icon — click it to add a category inside that exact spot (Litigation, Projects, a project, or a category), or use <b>+ Add main folder</b> at the bottom for a brand-new top-level folder.`},
 {k:['search document','find document','document search','search file','search by name'],a:`Use the <b>Find a Document</b> tab here to search by file name, title or document number. In the Document Library you can filter by status and date. Word-inside-file search has been replaced with name-based search for speed.`},
 {k:['reindex','re-index','index all','ocr','scan document','search inside'],a:`Indexing is now <b>automatic</b> — when you upload a scanned PDF or image it is read by AI (Gemini OCR) in the background, so the words inside it become searchable within moments. There's nothing to click: just type in the search box in a Document Library or the Legal module and matching files appear by name and by text inside them.`},
 {k:['download file','download document','get file','open file','preview file'],a:`To download or preview: find the file in <b>Document Library</b>, click the file row to open its detail panel, then click <b>Open</b> or <b>Download</b>. Files open in a new tab.`},
 {k:['delete document','remove file','delete file'],a:`To delete a document: open the file in <b>Document Library</b>, then click <b>Delete</b> in the detail panel. This removes both the database record and the stored file.`},
 {k:['legal','vault','title deed','deed','rera','agreement','noc','sanction','land record','court'],a:`The <b>Legal Vault</b> is organised as a tree: two main folders, <b>Litigation</b> and <b>Projects</b>. Under <b>Projects</b> sit the individual projects (Dream Gurukul, Dream World City, Dream One, Dream Eco City, Dream Valley, Dream Exotica, Dream Ananta), and each project has <b>History of Land / Chain</b>, <b>Title Papers</b>, <b>Permissions & Sanctions</b>, <b>RERA & Compliance</b> and <b>Project Manual</b>. Click the <b>+</b> next to any folder to add a category inside it, and <b>Upload</b> to add files to a category.`},
 // ── Accountability ─────────────────────────────────────────────────────────
 {k:['task','new task','create task','to-do','todo','make task'],a:`To create a task: go to <b>Accountability → Tasks</b> and click <b>New Task</b>. Add title, description, owner, members, priority, due date and progress. Tasks with members added appear in the <b>Tasks</b> tab for all members. Solo tasks (no members) appear only in your <b>Home → My Tasks</b>.`},
 {k:['team task','shared task','task member','add member to task'],a:`Tasks with members are called <b>Team Tasks</b>. Add members in the New Task form. They appear in the <b>Tasks</b> tab for every member and the creator. Personal tasks with no members only appear in your <b>Home → My Tasks</b>.`},
 {k:['delegate','delegation','assign','give work','assign task'],a:`To delegate: go to <b>Accountability → Delegation</b> and click <b>Delegate a task</b>. Choose the person from your delegation list, fill in details and due date. It shows under <b>I've Assigned</b> in your Home, and under <b>I've Been Assigned</b> for the recipient. Delegation requires the <b>can delegate</b> setting to be enabled in your profile.`},
 {k:['goal','objective','target','personal goal','team goal','company goal'],a:`Goals are in <b>Accountability → Goals</b>. Choose scope — <b>Personal</b> (yours only, visible in Home → My Goals), <b>Team</b> (shared with added members, visible in Team Goals tab), or <b>Company</b> (visible to everyone). Click <b>New Goal</b> and fill in name, dates and description.`},
 {k:['home','my tasks','accountability home','my goals','assigned to me'],a:`<b>Accountability Home</b> shows: <b>My Tasks</b> (your solo tasks), <b>Assigned To Me</b> (delegations from others), <b>I've Assigned</b> (delegations you sent), plus <b>My Goals</b>, an Activity Feed, and productivity/workload charts.`},
 {k:['profile','designation','department','reporting manager','edit profile'],a:`Your profile (name, designation, department, reporting manager, delegation settings) is set when you first open Accountability, and editable anytime from <b>Settings → Edit profile</b>.`},
 // ── Procurement ────────────────────────────────────────────────────────────
 {k:['procurement','indent','quote','po','grn','purchase order','quotation'],a:`The <b>Procurement</b> module has four tabs: <b>Indent</b> (purchase requests), <b>Quote Comp</b> (quotation comparison sheets — upload, preview, download, select and delete), <b>PO</b> (purchase orders), and <b>GRN</b> (goods received notes).`},
 {k:['quote comp','quotation comparison','sheet upload','procurement upload'],a:`In <b>Procurement → Quote Comp</b>: click <b>Upload</b> to add a sheet (PDF, Excel etc.), enter a name, and save. Cards appear for each sheet. Click to select (blue border), double-click to preview in a new tab. With one selected you can <b>Edit</b> (rename/replace file), <b>Download</b>, or <b>Delete</b>. Multiple selections allow Download and Delete but not Edit.`},
 // ── Recruitment ────────────────────────────────────────────────────────────
 {k:['recruitment','test','assessment','aptitude test','hiring test','job test'],a:`<b>Recruitment → Tests</b> lists all assessment links (Common Attitude, Accounts, Legal, Post Sales Admin, HR, Sales, Tele Sales, Legal New). Click any link to open the test form in a new tab. This table is read-only.`},
 {k:['job description','jd','description','position description'],a:`<b>Recruitment → Descriptions</b> shows job description PDFs for all positions. Click a card to select it, double-click or press <b>Preview</b> to open the PDF, or <b>Download</b> to save it. Admins can add new JDs via <b>Upload JD</b>, and remove any of them from there too.`},
 // ── Control Panel ──────────────────────────────────────────────────────────
 {k:['control panel','admin','administrator','user access','module access','tab access','permissions'],a:`The <b>Control Panel</b> is visible only to administrators. It lists all users — new signups show an amber <b>New · needs setup</b> badge with 0 tabs until configured. Click a user to set their department, level (Manager/Employee etc.) and which modules they can access using the grouped checkbox panel.`},
 {k:['new user','signup','onboarding','approve user','set up user'],a:`When someone signs up, they fill an onboarding form (name, designation, reporting manager). They then appear in the <b>Control Panel</b> with 0 tabs and a pending badge. An admin must open their profile and assign department, level and module access, then click <b>Save access</b>.`},
 // ── Projects / Dashboard ───────────────────────────────────────────────────
 {k:['projects','active projects','dashboard','kpi','project count'],a:`The <b>Dashboard</b> shows KPIs including Active Projects (currently 6 — Dream Valley Ph-2, Jain Heights, Green Acres, Royal Enclave, Trade Centre, Siliguri). The Projects panel lists all ongoing construction projects with their site and status.`},
 // ── Help Desk ──────────────────────────────────────────────────────────────
 {k:['ticket','raise ticket','support ticket','help ticket','complaint','problem'],a:`To raise a support ticket: open <b>Help Desk → My Tickets</b>, fill in the subject, department and description, then click <b>Submit ticket</b>. You can track all your tickets in the same tab.`},
 {k:['password','reset password','forgot password','sign in','login','log in'],a:`To reset your password: use <b>Forgot password?</b> on the sign-in page. You'll receive an email link to set a new one. Alternatively, contact your administrator.`},
 {k:['navigate','menu','sidebar','module','how to use','get around'],a:`Use the left sidebar to navigate: <b>Dashboard</b> (overview KPIs), <b>Accountability</b> (tasks, goals, delegation), <b>Document Library</b> & <b>Legal</b> (files), <b>Procurement</b>, <b>Recruitment</b>, <b>Help Desk</b>, and <b>Control Panel</b> (admins only). The <b>JAIN-E</b> logo always brings you Home.`},
 // ── Construction module ───────────────────────────────────────────────────
 {k:['construction','construction module','site','rcc','work order','contractor','tower','plinth','finishing','stage','construction stage'],a:`The <b>Construction</b> module shows live site data across all active projects. It has three tabs: <b>Towers & Units</b> (project tower breakdown, units sold, current stage), <b>Construction Stages</b> (% complete, target date, on-track/delayed status per project), and <b>Work Orders</b> (WO number, contractor, scope, amount, status).`},
 // ── Sign out ───────────────────────────────────────────────────────────────
 {k:['sign out','signout','log out','logout','exit','how to sign out','how to log out'],a:`To sign out: click your <b>avatar / name</b> in the top-right corner of the screen, then click <b>Sign out</b> from the dropdown menu.`},
 // ── Recruitment PDFs ───────────────────────────────────────────────────────
 {k:['find jd','search jd','find job description','search job description','general manager','executive pr','gm sales','human resource','litigation officer','accountant','compliance officer','executive sales','recruitment pdf'],a:`Job Description PDFs are in <b>Recruitment → Descriptions</b>. Eight positions are available by default: General Manager Commercial, Executive PR, GM Sales & Marketing, Human Resource, Executive Sales, Litigation Officer, Accountant, and Compliance Officer. Click any card to select it, then <b>Preview</b> to open or <b>Download</b> to save.`},
 // ── Under construction catch-all ───────────────────────────────────────────
 {k:['gtd','get things done','crm','sales pipeline','maintenance','asset','inspection','finance','financial','compliance','renewal','video library','scaling','playbook','customer portal','supplier portal','whatsapp bot','mail','naren'],a:`${UNDER_CONSTRUCTION}`},
];
function hdAnswer(q){
  const ql=' '+q.toLowerCase()+' ';
  let best=null,score=0;
  const UNDER=['gtd','crm','maintenance','asset','inspection','finance','compliance','renewal','video','scaling','playbook','customer portal','supplier portal','whatsapp','naren'];/* construction, campaign analytics are live */
  const isUnder=UNDER.some(k=>ql.includes(k));
  HD_KB.forEach(e=>{let sc=0;e.k.forEach(k=>{if(ql.includes(k))sc+=k.length*2;});if(sc>score){score=sc;best=e;}});
  if(score>0)return best.a;
  if(isUnder)return 'This module is currently <b>under construction</b> — no further details can be provided at this time. Please <a style="color:var(--brand);font-weight:600;cursor:pointer" onclick="navTo(`helpdesk/tickets`)">raise a ticket</a> if you need help.';
  return null;
}

let HD_MSGS=[];
VIEWS.helpdesk=function(v,seg){
  setCrumb(['Home','Help Desk']);
  const tab=(seg[0]||'assistant');
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-headset" style="color:#0f766e"></i> Help Desk</h1><p>Ask a question, find a document, or get help using the portal</p></div></div>
  <div class="tabs">
    <div class="tab ${tab==='assistant'?'active':''}" onclick="navTo('helpdesk/assistant')"><i class="fa-solid fa-robot"></i> Assistant</div>
    <div class="tab ${tab==='docs'?'active':''}" onclick="navTo('helpdesk/docs')"><i class="fa-solid fa-folder-open"></i> Find a Document</div>
    <div class="tab ${tab==='tickets'?'active':''}" onclick="navTo('helpdesk/tickets')"><i class="fa-solid fa-ticket"></i> My Tickets</div>
  </div><div id="hdBody"></div>`;
  if(tab==='docs')hdDocs(); else if(tab==='tickets')hdTickets(); else hdAssistant();
};
function hdAssistant(){
  const b=$('hdBody');
  b.innerHTML=`<div class="card" style="max-width:840px;margin:0 auto">
    <div id="hdChat" style="padding:18px;height:44vh;min-height:300px;overflow:auto;background:#fafbfd"></div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;padding:10px 16px;border-top:1px solid var(--line)" id="hdChips"></div>
    <div style="display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--line)">
      <input id="hdQ" class="sel" style="flex:1;height:42px" placeholder="Ask anything… e.g. How do I upload a document?" onkeydown="if(event.key==='Enter')hdSend()">
      <button class="btn btn-primary" onclick="hdSend()"><i class="fa-solid fa-paper-plane"></i> Send</button>
    </div></div>`;
  const chips=['How do I upload a document?','How do I delegate a task?','How do I create a task?','What is Procurement?','What is in the Legal module?','How does Control Panel work?'];
  $('hdChips').innerHTML=chips.map(c=>`<div class="chip" onclick="hdAsk(this.textContent)">${esc(c)}</div>`).join('');
  if(!HD_MSGS.length)HD_MSGS=[{who:'bot',text:`Hi! I'm the <b>JAIN-E</b> assistant. Ask me how to do something in the portal, find a document, or I can raise a ticket for you. Try a suggestion below.`}];
  hdRenderChat();
}
function hdRenderChat(){
  const c=$('hdChat');if(!c)return;
  c.innerHTML=HD_MSGS.map(m=>m.who==='bot'
    ?`<div style="display:flex;gap:10px;margin-bottom:14px"><div class="n-ic t-green" style="flex-shrink:0;width:32px;height:32px"><i class="fa-solid fa-robot"></i></div><div style="background:#fff;border:1px solid var(--line);border-radius:2px 12px 12px 12px;padding:11px 14px;font-size:13.5px;max-width:80%;line-height:1.55">${m.text}</div></div>`
    :`<div style="display:flex;gap:10px;margin-bottom:14px;flex-direction:row-reverse"><div class="avatar-sm" style="flex-shrink:0;background:${colorFor(state.email)}">${esc(initials((state.profile&&state.profile.full_name)||state.email).toUpperCase())}</div><div style="background:var(--brand);color:#fff;border-radius:12px 2px 12px 12px;padding:11px 14px;font-size:13.5px;max-width:80%">${esc(m.text)}</div></div>`).join('');
  c.scrollTop=c.scrollHeight;
}
window.hdAsk=function(q){const i=$('hdQ');if(i){i.value=q;}hdSend();};
window.hdSend=async function(){
  const inp=$('hdQ');const q=(inp.value||'').trim();if(!q)return;inp.value='';inp.disabled=true;
  HD_MSGS.push({who:'me',text:q});
  HD_MSGS.push({who:'bot',text:'<span class="hd-typing"><span></span><span></span><span></span></span>',isLoading:true});
  hdRenderChat();
  // Call the AI edge function
  try{
    const {data:{session}}=await sb.auth.getSession();
    const token=session&&session.access_token;
    const res=await fetch(SUPABASE_URL+'/functions/v1/helpdesk-ai',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},
      body:JSON.stringify({question:q})
    });
    const {answer}=await res.json();
    HD_MSGS=HD_MSGS.filter(m=>!m.isLoading);
    // If AI not configured yet, fall back to KB silently
    const finalAns=(answer&&!answer.startsWith('AI assistant is not configured'))
      ?answer:(hdAnswer(q)||answer||'Sorry, no answer available.');
    HD_MSGS.push({who:'bot',text:(finalAns||'Sorry, no answer available.')+
      '<div style="margin-top:8px;color:var(--slate);font-size:12px">Not what you needed? <a style="color:var(--brand);font-weight:600;cursor:pointer" onclick="navTo(`helpdesk/tickets`)">Raise a ticket</a>.</div>'});
  }catch(e){
    HD_MSGS=HD_MSGS.filter(m=>!m.isLoading);
    // fallback to KB
    const ans=hdAnswer(q);
    HD_MSGS.push({who:'bot',text:ans||'Having trouble connecting. Please try again or <a style="color:var(--brand);font-weight:600;cursor:pointer" onclick="navTo(`helpdesk/tickets`)">raise a ticket</a>.'});
  }
  inp.disabled=false;inp.focus();
  hdRenderChat();
};
function hdDocs(){
  $('hdBody').innerHTML=`<div class="card card-pad" style="max-width:880px;margin:0 auto">
   <div class="sec-title">Find a document</div><div class="sec-sub">Search all uploaded documents and job descriptions by file name</div>
   <div class="toolbar"><div class="grow"><i class="fa-solid fa-magnifying-glass"></i><input id="hdDocQ" placeholder="Type a word and press Enter…" onkeydown="if(event.key==='Enter')hdDocSearch()"></div><button class="btn btn-primary" onclick="hdDocSearch()"><i class="fa-solid fa-magnifying-glass"></i> Search</button></div>
   <div id="hdDocRes"><div class="empty" style="padding:30px"><i class="fa-regular fa-folder-open"></i><div>Search to find documents you can open or download</div></div></div></div>`;
}
window.hdDocSearch=async function(){
  const q=($('hdDocQ').value||'').trim();const host=$('hdDocRes');if(!q)return;
  host.innerHTML='<div class="loader"><div class="spin"></div></div>';
  const ql=q.toLowerCase();
  // 1. Search document library
  let docs=[];
  try{const {data}=await sb.schema('doc').from('documents').select('id,title,file_name,category,department,storage_path,doc_no,created_at').or('file_name.ilike.%'+q+'%,title.ilike.%'+q+'%,doc_no.ilike.%'+q+'%').order('created_at',{ascending:false}).limit(40);docs=data||[];}catch(e){}
  // 2. Search uploaded JDs
  let jdUploaded=[];
  try{const {data}=await sb.schema('recruit').from('job_descriptions').select('*');jdUploaded=data||[];}catch(e){}
  // 3. Include default JDs matching query
  const defaultMatches=(typeof DEFAULT_JDS!=='undefined'?DEFAULT_JDS:[]).filter(j=>j.name.toLowerCase().includes(ql));
  const uploadedJdMatches=jdUploaded.filter(j=>j.name.toLowerCase().includes(ql)||(j.file_name||'').toLowerCase().includes(ql));
  // Build combined rows
  const docRows=docs.map(r=>({file:r.file_name||r.title||'—',title:r.title||'—',cat:r.category||'—',dept:r.department||'—',date:r.created_at,url:r.storage_path?SUPABASE_URL+'/storage/v1/object/public/documents/'+encodeURIComponent(r.storage_path).replace(/%2F/g,'/'):null}));
  const jdRows=[...defaultMatches,...uploadedJdMatches].map(j=>({file:j.name+'.pdf',title:j.name,cat:'Job Description',dept:'Recruitment',date:j.created_at||null,url:j.url||(j.storage_path?SUPABASE_URL+'/storage/v1/object/public/recruitment/'+encodeURIComponent(j.storage_path).replace(/%2F/g,'/'):null)}));
  const all=[...docRows,...jdRows];
  if(!all.length){host.innerHTML='<div class="empty" style="padding:30px"><i class="fa-regular fa-folder-open"></i><div>No documents found for <b>'+esc(q)+'</b></div></div>';return;}
  host.innerHTML='<div style="margin-top:6px;font-size:12.5px;color:var(--slate);margin-bottom:10px">'+all.length+' result(s) for <b>'+esc(q)+'</b></div>'+
    '<table class="tbl"><thead><tr><th>File Name</th><th>Category</th><th>Department</th><th>Date</th><th></th></tr></thead><tbody>'+
    all.map(r=>'<tr><td style="font-weight:500">'+esc(r.file)+'</td><td>'+esc(r.cat)+'</td><td>'+esc(r.dept)+'</td><td style="color:var(--slate);font-size:12px">'+(r.date?fmtDate(r.date):'—')+'</td><td>'+(r.url?'<a href="'+r.url+'" target="_blank" class="btn btn-sm"><i class="fa-solid fa-eye"></i> Open</a>':'—')+'</td></tr>').join('')+
    '</tbody></table>';
}
window.hdTicketSave=async function(){
  const subject=$('hdSub').value.trim(),category=$('hdDept').value,message=$('hdMsg').value.trim();
  if(!subject||!message){toast('Add a subject and a description','err');return;}
  const btn=$('hdSubmitBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';}
  const {error}=await sb.schema('acc').from('helpdesk_tickets').insert({subject,category,message,status:'Open',raised_by:state.email,assigned_dept:category});
  if(error){toast(error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-paper-plane"></i> Submit ticket';}return;}
  // email the support inbox via Web3Forms (no backend needed)
  try{
    await fetch('https://api.web3forms.com/submit',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify({access_key:'9fa7700f-b082-46a4-8b70-e1861c554bb4',subject:'New Help Desk Ticket: '+subject,from_name:'JAIN-E Help Desk',Ticket_Subject:subject,Category:category,Description:message,Raised_by:state.email,Submitted_at:new Date().toLocaleString()})});
  }catch(e){console.warn('email relay failed',e);}
  toast('Ticket submitted & emailed to support','ok');
  $('hdSub').value='';$('hdMsg').value='';
  if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-paper-plane"></i> Submit ticket';}
  hdLoadTickets();
};

function hdTickets(){
  const b=$('hdBody');
  const depts=['IT','HR','Finance','Operations','Legal','Admin','Other'];
  b.innerHTML=`
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:1000px;margin:0 auto" class="hdTicketLayout">
    <div class="card card-pad">
      <div class="sec-title" style="margin:0 0 14px"><i class="fa-solid fa-ticket" style="color:#0f766e"></i> Raise a Ticket</div>
      <div class="frm">
        <label>Subject</label>
        <input id="hdSub" class="sel" placeholder="e.g. Can't access Legal Vault">
        <label>Department</label>
        <select id="hdDept" class="sel">
          ${depts.map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('')}
        </select>
        <label>Description</label>
        <textarea id="hdMsg" class="sel" rows="5" placeholder="Describe your issue in detail…" style="resize:vertical"></textarea>
      </div>
      <button class="btn btn-primary" id="hdSubmitBtn" style="margin-top:14px;width:100%" onclick="hdTicketSave()">
        <i class="fa-solid fa-paper-plane"></i> Submit ticket
      </button>
    </div>
    <div>
      <div class="card card-pad" style="margin-bottom:0">
        <div class="sec-title" style="margin:0 0 12px"><i class="fa-solid fa-list-check" style="color:#0f766e"></i> My Tickets</div>
        <div id="hdTicketList"><div class="loader"><div class="spin"></div></div></div>
      </div>
    </div>
  </div>`;
  // Responsive: stack on mobile
  const style=document.createElement('style');
  style.textContent='@media(max-width:700px){.hdTicketLayout{grid-template-columns:1fr!important}}';
  document.head.appendChild(style);
  hdLoadTickets();
}
async function hdLoadTickets(){
  const el=$('hdTicketList');if(!el)return;
  el.innerHTML='<div class="loader"><div class="spin"></div></div>';
  let rows=[];
  try{const {data}=await sb.schema('acc').from('helpdesk_tickets').select('*').eq('raised_by',state.email).order('created_at',{ascending:false}).limit(30);rows=data||[];}catch(e){}
  if(!rows.length){el.innerHTML='<div style="color:var(--slate);font-size:13px;padding:8px 0">No tickets yet.</div>';return;}
  const badge=s=>{const m={'Open':'t-amber','In Progress':'t-blue','Resolved':'t-green','Closed':'t-gray'};return`<span class="tag ${m[s]||'t-gray'}">${esc(s)}</span>`;};
  el.innerHTML='<div style="display:flex;flex-direction:column;gap:10px">'+rows.map(r=>`
    <div style="border:1px solid var(--line);border-radius:10px;padding:12px 14px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="font-weight:600;font-size:13.5px">${esc(r.subject||'—')}</div>
        ${badge(r.status||'Open')}
      </div>
      <div style="font-size:12px;color:var(--slate);margin-top:4px">${esc(r.assigned_dept||r.category||'—')} · ${r.created_at?new Date(r.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'}):'—'}</div>
      ${r.message?`<div style="font-size:12.5px;color:var(--body);margin-top:6px;line-height:1.5">${esc(r.message.slice(0,140))}${r.message.length>140?'…':''}</div>`:''}
    </div>`).join('')+'</div>';
}


/* ============================ HUMAN RESOURCES ============================ */
let HR_EMP=null, HR_DIR_Q='', HR_DIR_DEPT='', HR_ATT_DATE=null;
async function hrEmployees(force){
  if(HR_EMP&&!force)return HR_EMP;
  try{const {data}=await sb.schema('hr').from('employees').select('id,emp_code,full_name,department,designation,email,phone,date_of_joining,location,reporting_to,status').order('full_name');HR_EMP=data||[];}catch(e){HR_EMP=[];}
  return HR_EMP;
}
function hrName(code){const e=(HR_EMP||[]).find(x=>x.emp_code===code);return e?e.full_name:(code||'—');}
function hrCan(){return state.super||(state.roles&&state.roles.hr);}
function hrCanWrite(){return state.super||(state.roles&&['ADMIN','MANAGER','EDITOR','HR'].includes(state.roles.hr));}

/* ---- Recruitment write access ------------------------------------------------------------
   Adding, editing and deleting anything in Recruitment is limited to Administrators, Abhay
   Mati, and whoever sits in the HR department. Everyone else keeps read-only access: the
   controls are stripped from the page AND every action re-checks, so a stale page can't be
   used to slip a change through. */
const REC_RO_CSS='<style id="recRoCss">.rec-ro{display:flex;align-items:center;gap:9px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:10px;padding:10px 14px;font-size:12.5px;font-weight:600;margin:0 0 14px}.rec-ro i{color:#d97706}</style>';
function recCanWrite(){
  if(state.super) return true;
  const p=state.profile||{}, r=state.roles||{};
  const em=String(state.email||'').trim().toLowerCase();
  const nm=String(p.full_name||r.full_name||'').trim().toLowerCase();
  if(em==='system1@thejaingroup.com'||nm==='abhay mati') return true;
  const dep=[].concat(p.department||r.department||[]);
  return dep.some(function(d){ return /^\s*(hr|human\s*resources?)\s*$/i.test(String(d||'')); });
}
function recGuard(){
  if(recCanWrite()) return true;
  toast('Read-only — only HR, Abhay Mati and Administrators can change Recruitment records','err');
  return false;
}
const REC_WRITE_FNS=['rtAdd','rtRename','rtDelete','rtSave','rtUpdate','rtShareAddN','rtShareSend',
  'mpFillForm','mpEditSel','mpDeleteSel','mpEdit','mpDeleteOne','mpUpdate','mpSave',
  'recUploadModal','recDeleteSel','recJdSave','recJdDelete'];
function recStripWriteControls(root){
  if(recCanWrite()) return;
  const re=new RegExp('^\\s*(?:'+REC_WRITE_FNS.join('|')+')\\s*\\(');
  (root||document).querySelectorAll('[onclick]').forEach(function(el){
    if(re.test(el.getAttribute('onclick')||'')) el.remove();
  });
}
// Several Recruitment bars are re-rendered on the fly, so watch the view and re-strip.
function recWatchPerms(){
  if(recCanWrite()) return;
  const host=document.getElementById('view'); if(!host) return;
  recStripWriteControls(host);
  if(window._recObs) window._recObs.disconnect();
  window._recObs=new MutationObserver(function(){ recStripWriteControls(host); recStripWriteControls(document.getElementById('modalHost')); });
  window._recObs.observe(host,{childList:true,subtree:true});
  const mh=document.getElementById('modalHost');
  if(mh) window._recObs.observe(mh,{childList:true,subtree:true});
}
function hrEmpOptions(sel){return (HR_EMP||[]).map(e=>`<option value="${esc(e.emp_code)}" ${e.emp_code===sel?'selected':''}>${esc(e.full_name)} (${esc(e.emp_code)})</option>`).join('');}

VIEWS.hr=async function(v,seg){
  setCrumb(['People','Human Resources']);
  if(!hrCan()){
    v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-users" style="color:#be123c"></i> Human Resources</h1></div></div><div class="card card-pad empty"><i class="fa-solid fa-lock"></i><div style="font-weight:600;font-size:15px;color:var(--ink)">Restricted</div><p style="max-width:420px;margin:8px auto 0">You don't have HR access. Ask a director to grant you the HR role in Settings.</p></div>`;
    return;
  }
  const tab=seg[0]||'hs';
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-users" style="color:#be123c"></i> Human Resources</h1><p>H/S Candidates · Monthly Update · Interview Tracker · Resumes · Interview Qs</p></div></div>
  <div class="tabs">
    <div class="tab ${tab==='hs'?'active':''}" onclick="navTo('hr/hs')"><i class="fa-solid fa-user-check"></i> H/S Candidates</div>
    <div class="tab ${tab==='monthly'?'active':''}" onclick="navTo('hr/monthly')"><i class="fa-solid fa-chart-bar"></i> Monthly Update</div>
    <div class="tab ${tab==='tracker'?'active':''}" onclick="navTo('hr/tracker')"><i class="fa-solid fa-calendar-check"></i> Interview Tracker</div>
    <div class="tab ${tab==='resumes'?'active':''}" onclick="navTo('hr/resumes')"><i class="fa-solid fa-id-card-clip"></i> Resumes</div>
    <div class="tab ${tab==='interviewqs'?'active':''}" onclick="navTo('hr/interviewqs')"><i class="fa-solid fa-comments"></i> Interview Qs</div>
  </div><div id="hrBody"><div class="loader"><div class="spin"></div></div></div>`;
  if(tab==='monthly') hrMonthlyUpdate();
  else if(tab==='tracker') hrTracker();
  else if(tab==='resumes') hrResumes();
  else if(tab==='interviewqs') hrInterviewQs();
  else hrHS();
};

/* ── H/S Candidates ── */
async function hrHS(){
  const b=$('hrBody');
  loader(b);
  let rows=[];
  try{const {data}=await sb.schema('hr').from('hs_candidates').select('*').order('id',{ascending:false});rows=data||[];}catch(e){}
  window._hsRows=rows;
  window._hsSel=new Set();
  const statusTag=s=>{
    const m={'Hold':'t-amber','Selected':'t-green','Offer Decline':'t-red','Backout':'t-gray','Interview Not Done':'t-blue','Not Mentioned':'t-gray'};
    return `<span class="hs-stag hs-stag--${(m[s]||'t-amber').replace('t-','')}">${esc(s||'Hold')}</span>`;
  };
  b.innerHTML=`
    <style>
      .hs-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}
      .hs-toolbar .hs-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-width:0}
      .hs-toolbar .hs-filters{display:flex;gap:8px;align-items:center;margin-left:auto;flex-wrap:wrap;min-width:0}
      .hs-search-wrap{position:relative;display:flex;align-items:center;min-width:0}
      .hs-search-wrap i{position:absolute;left:10px;color:var(--slate);font-size:13px;pointer-events:none}
      .hs-search-wrap input{padding-left:30px;height:36px;min-width:200px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:var(--bg-card);color:var(--ink)}
      .hs-search-wrap input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10)}
      select.hs-sel{height:36px;padding:0 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:var(--bg-card);color:var(--ink);cursor:pointer;min-width:150px}
      select.hs-sel:focus{outline:none;border-color:var(--brand)}
      .hs-count{font-size:12.5px;color:var(--slate);white-space:nowrap;padding:0 4px}
      .hs-stag{display:inline-flex;align-items:center;padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:600;white-space:nowrap}
      .hs-stag--amber{background:#fef3c7;color:#92400e}
      .hs-stag--green{background:#d1fae5;color:#065f46}
      .hs-stag--red{background:#fee2e2;color:#991b1b}
      .hs-stag--gray{background:#f1f5f9;color:#475569}
      .hs-stag--blue{background:#dbeafe;color:#1e40af}
      #hsTbl{width:100%;border-collapse:collapse;font-size:13px;min-width:640px}
      #hsTbl thead th{background:var(--bg-subtle,#f8fafc);font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--slate);padding:10px 12px;border-bottom:2px solid var(--line);text-align:left;white-space:nowrap}
      #hsTbl tbody tr{border-bottom:1px solid var(--line-2);transition:background .12s}
      #hsTbl tbody tr:hover{background:var(--bg-hover,#f8fafc)}
      #hsTbl tbody tr.hs-selected{background:#eff6ff}
      #hsTbl tbody td{padding:11px 12px;vertical-align:middle;white-space:nowrap}
      .hs-cb{width:16px;height:16px;cursor:pointer;accent-color:var(--brand)}
      @media(max-width:768px){
        .hs-toolbar{flex-direction:column;align-items:stretch}
        .hs-toolbar .hs-actions{width:100%}
        .hs-toolbar .hs-actions .btn{flex:1 1 auto;justify-content:center}
        .hs-count{width:100%;text-align:center;order:99}
        .hs-toolbar .hs-filters{margin-left:0;width:100%}
        .hs-search-wrap{width:100%}
        .hs-search-wrap input{min-width:0;width:100%}
        select.hs-sel{min-width:0;width:100%}
        #hsTbl{min-width:600px;font-size:12.5px}
        #hsTbl thead th,#hsTbl tbody td{padding:9px 8px}
      }
    </style>
    <div class="hs-toolbar">
      <div class="hs-actions">
        <button class="btn btn-primary" onclick="hsCreate()"><i class="fa-solid fa-plus"></i> Add</button>
        <button class="btn" id="hsEditBtn" onclick="hsEditSel()" disabled style="opacity:.45"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn" id="hsDelBtn" onclick="hsDeleteSel()" disabled style="opacity:.45;color:var(--err);border-color:var(--err)"><i class="fa-solid fa-trash"></i> Delete</button>
        <span class="hs-count" id="hsCount">${rows.length} candidates</span>
      </div>
      <div class="hs-filters">
        <div class="hs-search-wrap">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input id="hsSearch" placeholder="Search name, position…" oninput="hsFilter()">
        </div>
        <select class="hs-sel" id="hsStatusFilter" onchange="hsFilter()">
          <option value="">All Status</option>
          <option>Hold</option><option>Selected</option><option>Offer Decline</option><option>Backout</option><option>Interview Not Done</option>
        </select>
      </div>
    </div>
    <div class="card" style="overflow:hidden">
      <div style="overflow-x:auto">
      <table id="hsTbl">
        <thead><tr>
          <th style="width:36px"><input type="checkbox" class="hs-cb" id="hsChkAll" onchange="hsToggleAll(this)"></th>
          <th>Name</th><th>Position</th><th>Phone</th><th>Email</th><th>Interview Date</th><th>Status</th>
        </tr></thead>
        <tbody id="hsTbody">
          ${rows.map((r)=>`<tr data-id="${r.id}" data-name="${esc((r.name||'').toLowerCase())}" data-pos="${esc((r.position||'').toLowerCase())}" data-status="${esc(r.status||'')}">
            <td><input type="checkbox" class="hs-cb hs-row-cb" data-id="${r.id}" onchange="hsRowCheck(this)"></td>
            <td style="font-weight:600">${esc(r.name||'—')}</td>
            <td style="color:var(--slate)">${esc(r.position||'—')}</td>
            <td style="font-family:monospace;font-size:12px">${esc(r.number||'—')}</td>
            <td style="font-size:12px"><a href="mailto:${esc(r.email||'')}" style="color:var(--brand)">${esc(r.email||'—')}</a></td>
            <td style="color:var(--slate)">${esc(r.interview_date||'—')}</td>
            <td>${statusTag(r.status)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>
    </div>`;
}
window.hsRowCheck=function(cb){
  const id=Number(cb.dataset.id);
  if(cb.checked) window._hsSel.add(id); else window._hsSel.delete(id);
  cb.closest('tr').classList.toggle('hs-selected',cb.checked);
  hsUpdateToolbar();
};
window.hsToggleAll=function(master){
  document.querySelectorAll('.hs-row-cb').forEach(cb=>{
    const tr=cb.closest('tr');
    if(tr.style.display==='none')return;
    cb.checked=master.checked;
    const id=Number(cb.dataset.id);
    if(master.checked) window._hsSel.add(id); else window._hsSel.delete(id);
    tr.classList.toggle('hs-selected',master.checked);
  });
  hsUpdateToolbar();
};
window.hsUpdateToolbar=function(){
  const n=window._hsSel.size;
  const editBtn=$('hsEditBtn'),delBtn=$('hsDelBtn');
  if(editBtn){editBtn.disabled=(n!==1);editBtn.style.opacity=(n===1)?'1':'.45';}
  if(delBtn){delBtn.disabled=(n===0);delBtn.style.opacity=(n>0)?'1':'.45';}
};
window.hsFilter=function(){
  const q=($('hsSearch').value||'').toLowerCase();
  const st=$('hsStatusFilter').value;
  let vis=0;
  document.querySelectorAll('#hsTbody tr').forEach(tr=>{
    const nm=tr.dataset.name||'',pos=tr.dataset.pos||'',s=tr.dataset.status||'';
    const show=(!q||(nm.includes(q)||pos.includes(q)))&&(!st||s===st);
    tr.style.display=show?'':'none';if(show)vis++;
  });
  const c=$('hsCount');if(c)c.textContent=vis+' candidates';
  // deselect hidden rows
  document.querySelectorAll('#hsTbody tr').forEach(tr=>{
    if(tr.style.display==='none'){
      const cb=tr.querySelector('.hs-row-cb');
      if(cb&&cb.checked){cb.checked=false;window._hsSel.delete(Number(cb.dataset.id));tr.classList.remove('hs-selected');}
    }
  });
  hsUpdateToolbar();
};
window.hsCreate=function(){
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-user-plus"></i> Add Candidate</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <div class="two"><div><label>Full Name *</label><input id="hsFName" class="sel" placeholder="e.g. Priya Sharma"></div>
    <div><label>Position *</label><input id="hsFPos" class="sel" placeholder="e.g. Sales Manager"></div></div>
    <div class="two"><div><label>Phone Number</label><input id="hsFNum" class="sel" placeholder="e.g. 9876543210"></div>
    <div><label>Email</label><input id="hsFEmail" class="sel" type="email" placeholder="e.g. priya@email.com"></div></div>
    <div class="two"><div><label>Interview Date</label><input id="hsFDate" class="sel" placeholder="e.g. 15.07.2026"></div>
    <div><label>Status</label><select id="hsFStatus" class="sel">
      <option>Hold</option><option>Selected</option><option>Offer Decline</option><option>Backout</option><option>Interview Not Done</option>
    </select></div></div>
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="hsSaveBtn" onclick="hsSave()"><i class="fa-solid fa-check"></i> Save</button></div>`);
};
window.hsSave=async function(){
  const name=($('hsFName').value||'').trim();
  const pos=($('hsFPos').value||'').trim();
  if(!name){toast('Enter a name','err');return;}
  const btn=$('hsSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const {error}=await sb.schema('hr').from('hs_candidates').insert({name,position:pos,number:($('hsFNum').value||'').trim(),email:($('hsFEmail').value||'').trim(),interview_date:($('hsFDate').value||'').trim(),status:$('hsFStatus').value||'Hold'});
  if(error){toast(error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Save';}return;}
  closeModal();toast('Candidate added','ok');hrHS();
};
window.hsEditSel=function(){
  const sel=[...window._hsSel];
  if(sel.length===0){toast('Select a candidate first','err');return;}
  if(sel.length>1){toast('Select only one candidate to edit','err');return;}
  hsEdit(sel[0]);
};
window.hsEdit=async function(id){
  const r=(window._hsRows||[]).find(x=>x.id===id);if(!r)return;
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-pen"></i> Edit Candidate</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <div class="two"><div><label>Full Name *</label><input id="hsFName" class="sel" value="${esc(r.name||'')}"></div>
    <div><label>Position</label><input id="hsFPos" class="sel" value="${esc(r.position||'')}"></div></div>
    <div class="two"><div><label>Phone Number</label><input id="hsFNum" class="sel" value="${esc(r.number||'')}"></div>
    <div><label>Email</label><input id="hsFEmail" class="sel" value="${esc(r.email||'')}"></div></div>
    <div class="two"><div><label>Interview Date</label><input id="hsFDate" class="sel" value="${esc(r.interview_date||'')}"></div>
    <div><label>Status</label><select id="hsFStatus" class="sel">
      ${['Hold','Selected','Offer Decline','Backout','Interview Not Done'].map(s=>`<option ${r.status===s?'selected':''}>${s}</option>`).join('')}
    </select></div></div>
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="hsSaveBtn" onclick="hsUpdate(${id})"><i class="fa-solid fa-check"></i> Update</button></div>`);
};
window.hsUpdate=async function(id){
  const name=($('hsFName').value||'').trim();if(!name){toast('Enter a name','err');return;}
  const btn=$('hsSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const {error}=await sb.schema('hr').from('hs_candidates').update({name,position:($('hsFPos').value||'').trim(),number:($('hsFNum').value||'').trim(),email:($('hsFEmail').value||'').trim(),interview_date:($('hsFDate').value||'').trim(),status:$('hsFStatus').value||'Hold'}).eq('id',id);
  if(error){toast(error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Update';}return;}
  closeModal();toast('Updated','ok');hrHS();
};
window.hsDeleteSel=async function(){
  const sel=[...window._hsSel];
  if(!sel.length)return;
  if(!await confirmDialog(`Delete ${sel.length} candidate${sel.length>1?'s':''}?`))return;
  const {error}=await sb.schema('hr').from('hs_candidates').delete().in('id',sel);
  if(error){toast(error.message,'err');return;}
  toast(sel.length>1?`${sel.length} candidates deleted`:'Candidate deleted','ok');
  hrHS();
};

/* ── Monthly Update ── */
let MU_RECORDS=null,MU_CUR=null;
const MU_COLS=[
  {l:'Tests Sent',          r:'RM',  t:'1 Day'},
  {l:'Test Responses\nReceived', r:'RM', t:'3 Days'},
  {l:'Passed Test CVs',     r:'RM',  t:'1 day'},
  {l:'Schedule Interview',  r:'RM',  t:'1 day'},
  {l:'Interview Done',      r:'MC',  t:'7 days'},
  {l:'Selected',            r:'',    t:''},
  {l:'Negotiation +\nOffer',r:'MC',  t:'1 day'},
  {l:'Back Out',            r:'',    t:''},
  {l:'To Join in Future',   r:'MC',  t:''},
  {l:'Joined',              r:'MC',  t:''},
  {l:'Joining Formalities', r:'MC',  t:'same day'},
];
const MU_POSITIONS=['Sales Manager','SR.Sales Advisor','Pre Sales Manager','CP Sales Executive','Backend Developer','Process Coordinator','Pre Sales Executive','Sr.Engineer','Supervisor','Wholetimer','Social Executive'];
const MU_MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
function muEmptyRows(){return [];}
async function hrMonthlyUpdate(){
  const b=$('hrBody');
  if(!MU_RECORDS){
    b.innerHTML='<div class="empty" style="padding:40px"><i class="fa-solid fa-spinner fa-spin"></i></div>';
    try{const {data,error}=await sb.schema('hr').from('monthly_updates').select('*').order('id',{ascending:true});
      if(error)throw error;
      const MU_MON_ORD=['January','February','March','April','May','June','July','August','September','October','November','December'];
      const muSort=l=>{const[m,y]=(l||'').split(' ');return (parseInt(y)||0)*100+(MU_MON_ORD.indexOf(m)+1);};
      MU_RECORDS=(data||[]).sort((a,b)=>muSort(a.month_label)-muSort(b.month_label));}catch(e){b.innerHTML='<div class="empty" style="padding:40px;color:#c83232">'+esc(e.message)+'</div>';return;}
  }
  if(MU_CUR!=null){muRenderDetail(b);return;}
  muRenderList(b);
}
function muRenderList(b){
  const rows=MU_RECORDS;
  let html='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><div class="sec-title" style="margin:0">Monthly Updates</div><button class="btn btn-primary" onclick="muCreate()"><i class="fa-solid fa-plus"></i> New Month</button></div>';
  if(!rows.length){html+='<div class="card card-pad empty"><i class="fa-regular fa-calendar"></i><div style="font-weight:600;color:var(--ink)">No monthly records yet</div><p style="max-width:360px;margin:6px auto 0">Click <b>New Month</b> to create your first monthly update.</p></div>';}
  else{html+='<div class="mu-grid">'+rows.map(r=>`<div class="mu-card" onclick="muViewMonth(${r.id})"><div class="mu-card-icon"><i class="fa-solid fa-calendar-days"></i></div><div class="mu-card-body"><div class="mu-card-label">${esc(r.month_label)}</div><div class="mu-card-meta">${(r.data||[]).filter(x=>x.values&&x.values.some(v=>v)).length} of ${(r.data||[]).length} positions have data</div></div><i class="fa-solid fa-chevron-right mu-card-arrow"></i></div>`).join('')+'</div>';}
  b.innerHTML=html;
}
function muRenderDetail(b){
  const rec=MU_RECORDS.find(r=>r.id===MU_CUR);if(!rec)return muBack();
  const data=rec.data||[];
  const rows=data.length?data:[];
  const respBadge=r=>r?`<span class="mu-resp mu-resp-${r.toLowerCase()}">${r}</span>`:'';
  let tbl='<div class="mu-tbl-wrap"><table class="mu-tbl"><thead>';
  tbl+='<tr><th style="width:36px;text-align:center;background:#fdf4f6" rowspan="3"><input type="checkbox" id="muChkAll" onchange="muToggleAll(this)" title="Select all"></th><th class="mu-pos-col" rowspan="3">Position</th>'+MU_COLS.map(c=>`<th class="mu-hdr-top">${respBadge(c.r)||'&nbsp;'}</th>`).join('')+'</tr>';
  tbl+='<tr>'+MU_COLS.map(c=>`<th class="mu-hdr-mid">${esc(c.t)||'&nbsp;'}</th>`).join('')+'</tr>';
  tbl+='<tr>'+MU_COLS.map(c=>`<th class="mu-hdr-col">${c.l.replace('\n','<br>')}</th>`).join('')+'</tr>';
  tbl+='</thead><tbody>';
  rows.forEach((row,ri)=>{
    tbl+=`<tr><td style="text-align:center;padding:0 8px;vertical-align:middle"><input type="checkbox" class="mu-row-chk" data-ri="${ri}"></td><td class="mu-pos-cell">${esc(row.position)}</td>`+
      row.values.map((v,ci)=>`<td class="mu-cell"><input class="mu-inp" type="number" min="0" value="${v!=null?v:''}" placeholder="" data-ri="${ri}" data-ci="${ci}" onchange="muSaveCell(${rec.id},${ri},${ci},this.value)"></td>`).join('')+'</tr>';
  });
  tbl+='</tbody></table></div>';
  b.innerHTML=`<div class="mu-detail-bar">
    <button class="btn" onclick="muBack()"><i class="fa-solid fa-arrow-left"></i> Back</button>
    <h2 style="margin:0;font-size:18px;font-weight:700"><i class="fa-solid fa-calendar-days" style="color:#be123c;margin-right:8px"></i>${esc(rec.month_label)}</h2>
    <span class="mu-autosave-hint"><i class="fa-solid fa-pencil" style="font-size:10px"></i> Cells auto-save</span>
    <div class="mu-detail-actions">
      <button class="btn btn-sm btn-primary" onclick="muAddRow(${rec.id})"><i class="fa-solid fa-plus"></i> Add Row</button>
      <button class="btn btn-sm" style="color:#c83232;border-color:#fecaca" onclick="muDeleteChecked(${rec.id})"><i class="fa-solid fa-trash"></i> Delete Selected</button>
      <button class="btn btn-sm" style="color:#c83232;border-color:#fecaca;background:#fff5f5" onclick="muDeleteMonth(${rec.id})"><i class="fa-solid fa-calendar-xmark"></i> Delete Month</button>
    </div>
  </div>`+tbl;
}
window.muToggleAll=function(el){document.querySelectorAll('.mu-row-chk').forEach(c=>c.checked=el.checked);};
window.muAddRow=function(id){
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-plus"></i> Add Position Row</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <div><label>Position Name *</label><input id="muRowName" class="inp" placeholder="e.g. Sales Manager"></div>
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="muAddRowSave(${id})"><i class="fa-solid fa-check"></i> Add</button></div>`);
  setTimeout(()=>{const el=$('muRowName');if(el)el.focus();},50);
};
window.muAddRowSave=async function(id){
  const name=($('muRowName').value||'').trim();
  if(!name){toast('Enter a position name','err');return;}
  const rec=MU_RECORDS.find(r=>r.id===id);if(!rec)return;
  const data=JSON.parse(JSON.stringify(rec.data||[]));
  if(data.find(r=>r.position===name)){toast('Position already exists','err');return;}
  data.push({position:name,values:Array(11).fill(null)});
  const {error}=await sb.schema('hr').from('monthly_updates').update({data}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  rec.data=data;closeModal();muRenderDetail($('hrBody'));
};
window.muDeleteChecked=async function(id){
  const checked=[...document.querySelectorAll('.mu-row-chk:checked')].map(el=>parseInt(el.dataset.ri));
  if(!checked.length){toast('Select at least one row to delete','err');return;}
  if(!await confirmDialog('Delete '+checked.length+' row(s)? This cannot be undone.'))return;
  const rec=MU_RECORDS.find(r=>r.id===id);if(!rec)return;
  const data=(rec.data||[]).filter((_,i)=>!checked.includes(i));
  const {error}=await sb.schema('hr').from('monthly_updates').update({data}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  rec.data=data;muRenderDetail($('hrBody'));
};
window.muViewMonth=function(id){MU_CUR=id;hrMonthlyUpdate();};
window.muBack=function(){MU_CUR=null;hrMonthlyUpdate();};
window.muCreate=function(){
  const yr=new Date().getFullYear();
  const curMo=new Date().getMonth(); // 0-indexed
  const yrs=[yr-1,yr,yr+1];
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-calendar-plus"></i> New Monthly Update</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <div class="two">
      <div><label>Month *</label><select id="muFMon" class="sel"><option value="">— Month —</option>${MU_MONTHS.map((m,i)=>`<option value="${m}"${i===curMo?' selected':''}>${m}</option>`).join('')}</select></div>
      <div><label>Year *</label><select id="muFYr" class="sel">${yrs.map(y=>`<option${y===yr?' selected':''}>${y}</option>`).join('')}</select></div>
    </div>
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="muSaveBtn" onclick="muSaveNew()"><i class="fa-solid fa-check"></i> Create</button></div>`);
};
window.muSaveNew=async function(){
  const mon=($('muFMon').value||'').trim(), yr=($('muFYr').value||'').trim();
  const lbl=mon&&yr?`${mon} ${yr}`:'';
  if(!lbl){toast('Select month and year','err');return;}
  if(MU_RECORDS&&MU_RECORDS.find(r=>r.month_label===lbl)){toast('That month already exists','err');return;}
  const btn=$('muSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const {data,error}=await sb.schema('hr').from('monthly_updates').insert({month_label:lbl,data:muEmptyRows()}).select().single();
  if(error){toast(error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Create';}return;}
  MU_RECORDS=[...(MU_RECORDS||[]),data];
  const MU_MON_ORD2=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const muSort2=l=>{const[m,y]=(l||'').split(' ');return (parseInt(y)||0)*100+(MU_MON_ORD2.indexOf(m)+1);};
  MU_RECORDS.sort((a,b)=>muSort2(a.month_label)-muSort2(b.month_label));
  closeModal();MU_CUR=data.id;hrMonthlyUpdate();
};
window.muSaveCell=async function(id,ri,ci,val){
  const rec=MU_RECORDS&&MU_RECORDS.find(r=>r.id===id);if(!rec)return;
  const data=JSON.parse(JSON.stringify(rec.data||[]));
  // ensure row exists
  if(!data[ri]){data[ri]={position:'',values:Array(11).fill(null)};}
  if(!data[ri].values){data[ri].values=Array(11).fill(null);}
  data[ri].values[ci]=val===''||val==null?null:Number(val);
  const {error}=await sb.schema('hr').from('monthly_updates').update({data}).eq('id',id);
  if(error){toast('Save failed: '+error.message,'err');}
  else{
    rec.data=data;
    // keep the desktop table and mobile card copies of this cell in sync
    document.querySelectorAll('.mu-inp[data-ri="'+ri+'"][data-ci="'+ci+'"]').forEach(el=>{el.value=(val===''||val==null)?'':val;});
  }
};
window.muDeleteMonth=async function(id){
  if(!await confirmDialog('Delete this monthly record?'))return;
  const {error}=await sb.schema('hr').from('monthly_updates').delete().eq('id',id);
  if(error){toast(error.message,'err');return;}
  MU_RECORDS=(MU_RECORDS||[]).filter(r=>r.id!==id);
  MU_CUR=null;hrMonthlyUpdate();toast('Deleted','ok');
};
window.muReload=function(){MU_RECORDS=null;MU_CUR=null;if(PAGE==='hr')renderPage();};

/* ── Interview Tracker ── */
async function hrTracker(){
  const b=$('hrBody');
  loader(b);
  let rows=[];
  try{const {data}=await sb.schema('hr').from('interview_tracker').select('*').order('id',{ascending:false});rows=data||[];}catch(e){}
  window._trRows=rows;
  window._trSel=new Set();
  const fbTag=s=>{
    const m={'Shortlisted':'tr-green','Selected':'tr-green','Rejected':'tr-red','No Show':'tr-gray','Pending':'tr-amber','Hold':'tr-amber'};
    return s?`<span class="tr-tag tr-tag--${(m[s]||'tr-amber').replace('tr-','')}">${esc(s)}</span>`:'';
  };
  const cel=v=>v?esc(v):'';
  b.innerHTML=`
    <style>
      .tr-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}
      .tr-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-width:0}
      .tr-filters{display:flex;gap:8px;align-items:center;margin-left:auto;flex-wrap:wrap;min-width:0}
      .tr-sw{position:relative;display:flex;align-items:center;min-width:0}
      .tr-sw i{position:absolute;left:10px;color:var(--slate);font-size:12px;pointer-events:none}
      .tr-sw input{padding-left:28px;height:36px;min-width:190px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:var(--bg-card);color:var(--ink)}
      .tr-sw input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10)}
      select.tr-sel{height:36px;padding:0 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:var(--bg-card);color:var(--ink);min-width:140px;cursor:pointer}
      select.tr-sel:focus{outline:none;border-color:var(--brand)}
      .tr-count{font-size:12.5px;color:var(--slate);white-space:nowrap;padding:0 2px}
      .tr-tag{display:inline-flex;align-items:center;padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:600;white-space:nowrap}
      .tr-tag--green{background:#d1fae5;color:#065f46}
      .tr-tag--red{background:#fee2e2;color:#991b1b}
      .tr-tag--gray{background:#f1f5f9;color:#475569}
      .tr-tag--amber{background:#fef3c7;color:#92400e}
      #trTbl{width:100%;border-collapse:collapse;font-size:13.5px;min-width:1480px;table-layout:fixed}
      #trTbl thead th{background:var(--bg-subtle,#f8fafc);font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--slate);padding:11px 14px;border-bottom:2px solid var(--line);text-align:left;white-space:normal;word-break:break-word;vertical-align:bottom}
      #trTbl tbody tr{border-bottom:1px solid var(--line-2);transition:background .12s}
      #trTbl tbody tr:hover{background:var(--bg-hover,#f8fafc)}
      #trTbl tbody tr.tr-selected{background:#eff6ff}
      #trTbl tbody td{padding:12px 14px;vertical-align:middle;white-space:normal;word-break:break-word;overflow-wrap:anywhere;line-height:1.4}
      #trTbl td.tr-nowrap,#trTbl th.tr-nowrap{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .tr-cb{width:16px;height:16px;cursor:pointer;accent-color:var(--brand)}
      @media(max-width:900px){
        .tr-toolbar{flex-direction:column;align-items:stretch}
        .tr-actions{width:100%}
        .tr-actions .btn{flex:1 1 auto;justify-content:center}
        .tr-count{width:100%;text-align:center;order:99}
        .tr-filters{margin-left:0;width:100%}
        .tr-sw{width:100%}
        .tr-sw input{min-width:0;width:100%}
        select.tr-sel{min-width:0;width:100%}
        #trTbl{min-width:1300px;font-size:13px}
        #trTbl thead th,#trTbl tbody td{padding:9px 10px}
      }
    </style>
    <div class="tr-toolbar">
      <div class="tr-actions">
        <button class="btn btn-primary" onclick="trackerCreate()"><i class="fa-solid fa-plus"></i> Add</button>
        <button class="btn" id="trEditBtn" onclick="trackerEditSel()" disabled style="opacity:.45"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn" id="trDelBtn" onclick="trackerDeleteSel()" disabled style="opacity:.45;color:var(--err);border-color:var(--err)"><i class="fa-solid fa-trash"></i> Delete</button>
        <span class="tr-count" id="trCount">${rows.length} entries</span>
      </div>
      <div class="tr-filters">
        <div class="tr-sw"><i class="fa-solid fa-magnifying-glass"></i><input id="trQ" placeholder="Search name, position…" oninput="trackerFilter()"></div>
        <select class="tr-sel" id="trFbF" onchange="trackerFilter()">
          <option value="">All Feedback</option>
          <option>Shortlisted</option><option>Selected</option><option>Rejected</option><option>No Show</option><option>Hold</option>
        </select>
        <select class="tr-sel" id="trEntityF" onchange="trackerFilter()">
          <option value="">All Entities</option>
          ${[...new Set(rows.map(r=>r.entity).filter(Boolean))].sort().map(e=>`<option>${esc(e)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="card" style="overflow:hidden">
      <div style="overflow-x:auto">
      <table id="trTbl">
        <thead><tr>
          <th class="tr-nowrap" style="width:36px"><input type="checkbox" class="tr-cb" id="trChkAll" onchange="trToggleAll(this)"></th>
          <th style="width:14%">Candidate</th><th style="width:11%">Position</th><th style="width:9%">Source</th><th style="width:9%">Entity</th><th class="tr-nowrap" style="width:12%">Phone</th><th style="width:14%">Email</th><th class="tr-nowrap" style="width:14%">Date & Time</th><th class="tr-nowrap" style="width:11%">Feedback</th><th style="width:16%">Notes</th>
        </tr></thead>
        <tbody id="trTbody">
          ${rows.length?rows.map(r=>`<tr data-id="${r.id}" data-name="${esc((r.candidate_name||'').toLowerCase())}" data-pos="${esc((r.position||'').toLowerCase())}" data-fb="${esc(r.feedback||'')}" data-entity="${esc((r.entity||'').toLowerCase())}">
            <td class="tr-nowrap"><input type="checkbox" class="tr-cb tr-row-cb" data-id="${r.id}" onchange="trRowCheck(this)"></td>
            <td style="font-weight:600">${cel(r.candidate_name)}</td>
            <td style="color:var(--slate)">${cel(r.position)}</td>
            <td style="font-size:12px;color:var(--slate)">${cel(r.source)}</td>
            <td style="font-size:12px">${cel(r.entity)}</td>
            <td class="tr-nowrap" style="font-family:monospace;font-size:12px">${cel(r.number)}</td>
            <td style="font-size:12px">${r.email?`<a href="mailto:${esc(r.email)}" style="color:var(--brand)">${esc(r.email)}</a>`:''}</td>
            <td class="tr-nowrap" style="font-size:12px;color:var(--slate)">${cel(r.scheduled_date)}</td>
            <td class="tr-nowrap">${fbTag(r.feedback)}</td>
            <td style="font-size:12px;color:var(--slate)">${cel(r.notes)}</td>
          </tr>`).join(''):'<tr><td colspan="10"><div class="empty" style="padding:32px"><i class="fa-regular fa-calendar"></i><div style="font-weight:600;color:var(--ink)">No interviews yet</div><p>Click <b>Add</b> to schedule the first interview.</p></div></td></tr>'}
        </tbody>
      </table>
      </div>
    </div>`;
}
window.trRowCheck=function(cb){
  const id=Number(cb.dataset.id);
  if(cb.checked)window._trSel.add(id);else window._trSel.delete(id);
  cb.closest('tr').classList.toggle('tr-selected',cb.checked);
  trUpdateToolbar();
};
window.trToggleAll=function(master){
  document.querySelectorAll('.tr-row-cb').forEach(cb=>{
    const tr=cb.closest('tr');if(tr.style.display==='none')return;
    cb.checked=master.checked;
    const id=Number(cb.dataset.id);
    if(master.checked)window._trSel.add(id);else window._trSel.delete(id);
    tr.classList.toggle('tr-selected',master.checked);
  });
  trUpdateToolbar();
};
window.trUpdateToolbar=function(){
  const n=window._trSel.size;
  const e=$('trEditBtn'),d=$('trDelBtn');
  if(e){e.disabled=(n!==1);e.style.opacity=(n===1)?'1':'.45';}
  if(d){d.disabled=(n===0);d.style.opacity=(n>0)?'1':'.45';}
};
window.trackerFilter=function(){
  const q=($('trQ').value||'').toLowerCase();
  const fb=$('trFbF').value;
  const ent=$('trEntityF').value.toLowerCase();
  let vis=0;
  document.querySelectorAll('#trTbody tr[data-id]').forEach(tr=>{
    const nm=tr.dataset.name||'',pos=tr.dataset.pos||'',f=tr.dataset.fb||'',e=tr.dataset.entity||'';
    const show=(!q||(nm.includes(q)||pos.includes(q)))&&(!fb||f===fb)&&(!ent||e===ent);
    tr.style.display=show?'':'none';if(show)vis++;
    if(!show&&tr.querySelector('.tr-row-cb').checked){
      tr.querySelector('.tr-row-cb').checked=false;
      window._trSel.delete(Number(tr.dataset.id));
      tr.classList.remove('tr-selected');
    }
  });
  const c=$('trCount');if(c)c.textContent=vis+' entries';
  trUpdateToolbar();
};
window.trackerCreate=function(){
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-calendar-check"></i> Schedule Interview</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <div class="two"><div><label>Candidate Name *</label><input id="trFName" class="sel" placeholder="Full name"></div>
    <div><label>Position *</label><input id="trFPos" class="sel" placeholder="e.g. Sales Executive"></div></div>
    <div class="two"><div><label>Entity</label><input id="trFEntity" class="sel" placeholder="e.g. Rajanya, Zainab"></div>
    <div><label>Source</label><input id="trFSrc" class="sel" placeholder="e.g. Naukri, Apna, Reference"></div></div>
    <div class="two"><div><label>Interview Date</label><input id="trFDate" class="sel" type="date"></div>
    <div><label>Interview Time</label><input id="trFTime" class="sel" type="time"></div></div>
    <div class="two"><div><label>Phone</label><input id="trFNum" class="sel" placeholder="10-digit number"></div>
    <div><label>Email</label><input id="trFEmail" class="sel" type="email" placeholder="candidate@email.com"></div></div>
    <div class="two"><div><label>Feedback</label><select id="trFFb" class="sel">
      <option value="">— Select —</option><option>Shortlisted</option><option>Selected</option><option>Rejected</option><option>No Show</option><option>Hold</option>
    </select></div>
    <div><label>Notes</label><input id="trFNotes" class="sel" placeholder="Any remarks (optional)"></div></div>
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="trSaveBtn" onclick="trackerSave()"><i class="fa-solid fa-check"></i> Save</button></div>`);
};
function trDateStr(){
  const d=($('trFDate').value||'').trim(),t=($('trFTime').value||'').trim();
  if(d&&t){const [y,mo,dy]=d.split('-');const [h,mi]=t.split(':');const hr=parseInt(h);const ampm=hr>=12?'PM':'AM';const h12=hr%12||12;return `${parseInt(dy)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo)-1]}, ${y} @ ${h12}:${mi} ${ampm}`;}
  if(d){const [y,mo,dy]=d.split('-');return `${parseInt(dy)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo)-1]}, ${y}`;}
  return '';
}
window.trackerSave=async function(){
  const name=($('trFName').value||'').trim(),pos=($('trFPos').value||'').trim();
  if(!name||!pos){toast('Name and position required','err');return;}
  const btn=$('trSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const dateStr=trDateStr();
  const fb=($('trFFb').value||'').trim();
  const notes=($('trFNotes').value||'').trim();
  const {error}=await sb.schema('hr').from('interview_tracker').insert({
    candidate_name:name,position:pos,entity:($('trFEntity').value||'').trim()||null,
    source:($('trFSrc').value||'').trim()||null,scheduled_date:dateStr||null,
    number:($('trFNum').value||'').trim()||null,email:($('trFEmail').value||'').trim()||null,
    feedback:fb||null,notes:notes||null
  });
  if(error){toast('Could not save: '+error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Save';}return;}
  closeModal();toast('Interview scheduled','ok');hrTracker();
};
window.trackerEditSel=function(){
  const sel=[...window._trSel];
  if(sel.length===0){toast('Select a row first','err');return;}
  if(sel.length>1){toast('Select only one entry to edit','err');return;}
  const r=(window._trRows||[]).find(x=>x.id===sel[0]);if(!r)return;
  // Parse date back for input
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-pen"></i> Edit Interview</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <div class="two"><div><label>Candidate Name *</label><input id="trFName" class="sel" value="${esc(r.candidate_name||'')}"></div>
    <div><label>Position *</label><input id="trFPos" class="sel" value="${esc(r.position||'')}"></div></div>
    <div class="two"><div><label>Entity</label><input id="trFEntity" class="sel" value="${esc(r.entity||'')}"></div>
    <div><label>Source</label><input id="trFSrc" class="sel" value="${esc(r.source||'')}"></div></div>
    <div class="two"><div><label>Date & Time (text)</label><input id="trFDateTxt" class="sel" value="${esc(r.scheduled_date||'')}" placeholder="e.g. 15 Jul, Tuesday @ 3 PM"></div>
    <div><label>Phone</label><input id="trFNum" class="sel" value="${esc(r.number||'')}"></div></div>
    <div class="two"><div><label>Email</label><input id="trFEmail" class="sel" value="${esc(r.email||'')}"></div>
    <div><label>Feedback</label><select id="trFFb" class="sel">
      <option value="">— Select —</option>${['Shortlisted','Selected','Rejected','No Show','Hold'].map(s=>`<option ${r.feedback===s?'selected':''}>${s}</option>`).join('')}
    </select></div></div>
    <div><label>Notes</label><input id="trFNotes" class="sel" value="${esc(r.notes||'')}" placeholder="Any remarks (optional)"></div>
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="trSaveBtn" onclick="trackerUpdate(${r.id})"><i class="fa-solid fa-check"></i> Update</button></div>`);
};
window.trackerUpdate=async function(id){
  const name=($('trFName').value||'').trim(),pos=($('trFPos').value||'').trim();
  if(!name||!pos){toast('Name and position required','err');return;}
  const btn=$('trSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const {error}=await sb.schema('hr').from('interview_tracker').update({
    candidate_name:name,position:pos,entity:($('trFEntity').value||'').trim()||null,
    source:($('trFSrc').value||'').trim()||null,scheduled_date:($('trFDateTxt').value||'').trim()||null,
    number:($('trFNum').value||'').trim()||null,email:($('trFEmail').value||'').trim()||null,
    feedback:($('trFFb').value||'')||null,notes:($('trFNotes').value||'').trim()||null
  }).eq('id',id);
  if(error){toast(error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Update';}return;}
  closeModal();toast('Updated','ok');hrTracker();
};
window.trackerDeleteSel=async function(){
  const sel=[...window._trSel];if(!sel.length)return;
  if(!await confirmDialog(`Delete ${sel.length} entr${sel.length>1?'ies':'y'}?`))return;
  const {error}=await sb.schema('hr').from('interview_tracker').delete().in('id',sel);
  if(error){toast(error.message,'err');return;}
  toast(sel.length>1?`${sel.length} entries deleted`:'Entry deleted','ok');
  hrTracker();
};
window.trackerDelete=async function(id){
  if(!await confirmDialog('Delete this entry?'))return;
  const {error}=await sb.schema('hr').from('interview_tracker').delete().eq('id',id);
  if(error){toast(error.message,'err');return;}
  toast('Deleted','ok');hrTracker();
};

/* ── AI edge function helper (shared by Resumes + Interview Qs) ── */
async function resumeAI(payload){
  const {data:{session}}=await sb.auth.getSession();
  const token=session&&session.access_token;
  const res=await fetch(SUPABASE_URL+'/functions/v1/resume-ai',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},
    body:JSON.stringify(payload)
  });
  const out=await res.json().catch(()=>({}));
  if(!res.ok||out.error)throw new Error(out.error||('resume-ai '+res.status));
  return out;
}

/* ── Resumes (AI-parsed resume bank) ── */
let RS_ROWS=null, RS_SEARCH=null, RS_SEL=new Set();
async function hrResumes(){
  const b=$('hrBody');loader(b);
  try{const {data,error}=await sb.schema('hr').from('resumes').select('*').order('created_at',{ascending:false});if(error)throw error;RS_ROWS=data||[];}
  catch(e){b.innerHTML='<div class="empty" style="padding:40px;color:var(--err)">'+esc(e.message)+'</div>';return;}
  RS_SEARCH=null;RS_SEL=new Set();
  rsRender();
}
function rsCard(r){
  const status=r.ai_status;
  const badge=status==='pending'?'<span class="tag t-amber" style="margin-left:8px"><i class="fa-solid fa-spinner fa-spin"></i> Analyzing…</span>':status==='error'?'<span class="tag t-red" style="margin-left:8px" title="'+esc(r.ai_error||'')+'">AI failed</span>':'';
  const matchBadge=(r._match&&r._match.score!=null)?`<span class="tag t-green" style="margin-left:8px">${r._match.score}% match</span>`:'';
  const sub=[r.role_title,r.company,r.location].filter(Boolean).join(' · ');
  return `<div class="card rs-card" onclick="rsOpenDetail(${r.id})">
    <input type="checkbox" class="rs-chk" value="${r.id}" ${RS_SEL.has(r.id)?'checked':''} onclick="event.stopPropagation()" onchange="rsSyncToolbar()">
    <div class="avatar-sm rs-card-avatar" style="background:${colorFor(r.candidate_name||r.file_name||'?')}">${esc(initials(r.candidate_name||r.file_name||'?').toUpperCase())}</div>
    <div class="rs-card-body">
      <div class="rs-card-name">${esc(r.candidate_name||r.file_name||'Unnamed')}${badge}${matchBadge}</div>
      <div class="rs-card-sub">${esc(sub||'—')}</div>
    </div>
    <button class="btn btn-sm btn-ghost rs-card-eye" title="Preview resume file" onclick="event.stopPropagation();rsPreview(${r.id})"><i class="fa-solid fa-eye"></i></button>
  </div>`;
}
function rsRender(){
  const b=$('hrBody');if(!b)return;
  const rows=RS_SEARCH?RS_SEARCH:(RS_ROWS||[]);
  const dis='opacity:.38;cursor:not-allowed;pointer-events:none';
  b.innerHTML=`<div class="rs-toolbar-row">
    <div class="sec-title" style="margin:0">Resume Bank <span class="tag t-gray" style="margin-left:4px">${(RS_ROWS||[]).length}</span></div>
    <div class="rs-toolbar-actions">
      <button class="btn btn-primary" onclick="rsUploadModal()"><i class="fa-solid fa-upload"></i> Upload Resume</button>
      <button class="btn" id="rsDlBtn" disabled style="${dis}" onclick="rsBulkDownload()"><i class="fa-solid fa-download"></i> Download</button>
      <button class="btn" id="rsDelBtn" disabled style="${dis};color:var(--err);border-color:var(--err)" onclick="rsBulkDelete()"><i class="fa-solid fa-trash"></i> Delete</button>
    </div>
  </div>
  <div class="card card-pad rs-ai-card">
    <label class="rs-ai-label"><i class="fa-solid fa-wand-magic-sparkles" style="color:#7c3aed"></i> Ask AI to find a candidate</label>
    <div class="rs-ai-row">
      <input id="rsQ" class="rs-ai-input" placeholder="e.g. someone with 3+ years in sales who knows CRM tools" onkeydown="if(event.key==='Enter')rsSearch()">
      <button class="btn btn-primary" id="rsSearchBtn" onclick="rsSearch()"><i class="fa-solid fa-magnifying-glass"></i> Search</button>
      ${RS_SEARCH?'<button class="btn" onclick="rsClearSearch()"><i class="fa-solid fa-xmark"></i> Clear</button>':''}
    </div>
  </div>
  <div id="rsList" class="grid rs-list">${rows.length?rows.map(r=>rsCard(r)).join(''):'<div class="empty" style="padding:40px;grid-column:1/-1"><i class="fa-solid fa-id-card-clip"></i><div>No resumes yet — click Upload Resume</div></div>'}</div>`;
  rsSyncToolbar();
}
window.rsSyncToolbar=function(){
  const sel=[...document.querySelectorAll('.rs-chk:checked')];
  RS_SEL=new Set(sel.map(c=>parseInt(c.value)));
  const n=RS_SEL.size;
  const dl=$('rsDlBtn'),del=$('rsDelBtn');
  const dis='opacity:.38;cursor:not-allowed;pointer-events:none';
  if(dl){dl.disabled=n===0;dl.style.cssText=n>0?'':dis;dl.innerHTML='<i class="fa-solid fa-download"></i> Download'+(n?' ('+n+')':'');}
  if(del){del.disabled=n===0;del.style.cssText=n>0?'color:var(--err);border-color:var(--err)':dis+';color:var(--err);border-color:var(--err)';del.innerHTML='<i class="fa-solid fa-trash"></i> Delete'+(n?' ('+n+')':'');}
};
window.rsBulkDownload=async function(){
  for(const id of RS_SEL){ await rsDownload(id); }
};
window.rsBulkDelete=async function(){
  if(!RS_SEL.size)return;
  if(!await confirmDialog('Delete '+RS_SEL.size+' resume(s) permanently?'))return;
  for(const id of RS_SEL){
    const r=(RS_ROWS||[]).find(x=>x.id===id);
    if(r&&r.storage_path){ if(isS3Path(r.storage_path)) await s3Delete(r.storage_path); else await sb.storage.from('resumes').remove([r.storage_path]); }
    await sb.schema('hr').from('resumes').delete().eq('id',id);
  }
  RS_ROWS=(RS_ROWS||[]).filter(x=>!RS_SEL.has(x.id));
  if(RS_SEARCH)RS_SEARCH=(RS_SEARCH||[]).filter(x=>!RS_SEL.has(x.id));
  RS_SEL=new Set();
  toast('Deleted','ok');rsRender();
};
function rsDetailRow(label,html){
  if(!html)return '';
  return `<div style="margin-bottom:14px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--slate);font-weight:700;margin-bottom:4px">${label}</div><div style="font-size:13.5px;color:var(--ink);line-height:1.6">${html}</div></div>`;
}
window.rsOpenDetail=function(id){
  const pool=(RS_SEARCH&&RS_SEARCH.length?RS_SEARCH:RS_ROWS)||[];
  const r=pool.find(x=>x.id===id)||(RS_ROWS||[]).find(x=>x.id===id);
  if(!r)return;
  const a=r.analysis||{};
  const expParts=[];
  if(r.experience_years!=null&&r.experience_years!=='')expParts.push(esc(String(r.experience_years))+' years');
  if(a.experience_summary)expParts.push(esc(a.experience_summary));
  const deptParts=[];
  if(a.recommended_departments&&a.recommended_departments.length)deptParts.push(esc(a.recommended_departments.join(', ')));
  if(a.department_fit)deptParts.push(esc(a.department_fit));
  const skillsHtml=(r.skills&&r.skills.length)?r.skills.map(s=>`<span class="tag t-gray" style="margin:2px 5px 2px 0;display:inline-block">${esc(s)}</span>`).join(''):'';
  const strengthsHtml=(a.strengths&&a.strengths.length)?('<ul style="padding-left:18px;margin:0">'+a.strengths.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>'):'';
  const certsHtml=(r.certifications&&r.certifications.length)?esc(r.certifications.join(', ')):'';
  const contact=[r.email,r.phone].filter(Boolean).map(esc).join(' · ');
  let aiNote='';
  if(r.ai_status==='error')aiNote=rsDetailRow('AI status','<span style="color:var(--err)">Analysis failed — '+esc(r.ai_error||'')+'</span>');
  else if(r.ai_status==='pending')aiNote=rsDetailRow('AI status','<span style="color:#c08000">Still analyzing…</span>');
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-id-card-clip"></i> Candidate Profile</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body">
    <div style="display:flex;gap:14px;align-items:center;margin-bottom:18px">
      <div class="avatar-sm" style="width:52px;height:52px;font-size:18px;background:${colorFor(r.candidate_name||r.file_name||'?')}">${esc(initials(r.candidate_name||r.file_name||'?').toUpperCase())}</div>
      <div>
        <div style="font-weight:700;font-size:17px">${esc(r.candidate_name||r.file_name||'Unnamed')}</div>
        <div style="color:var(--slate);font-size:13px">${esc([r.role_title,r.company].filter(Boolean).join(' at ')||'—')}</div>
      </div>
    </div>
    ${rsDetailRow('Department fit',deptParts.join(' — '))}
    ${rsDetailRow('Location',esc(r.location||''))}
    ${rsDetailRow('Experience',expParts.join(' — '))}
    ${rsDetailRow('Credentials',esc(a.credentials||''))}
    ${rsDetailRow('Education',esc(r.education||''))}
    ${rsDetailRow('Summary',esc(r.summary||''))}
    ${rsDetailRow('Strengths',strengthsHtml)}
    ${rsDetailRow('Skills',skillsHtml)}
    ${rsDetailRow('Certifications',certsHtml)}
    ${rsDetailRow('Contact',contact)}
    ${aiNote}
  </div>
  <div class="modal-foot"><button class="btn" onclick="rsPreview(${r.id})"><i class="fa-solid fa-eye"></i> Preview file</button><button class="btn btn-primary" onclick="closeModal()">Close</button></div>`,'lg');
};
window.rsClearSearch=function(){RS_SEARCH=null;rsRender();};
window.rsSearch=async function(){
  const q=($('rsQ')||{}).value?.trim();if(!q)return;
  const btn=$('rsSearchBtn');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Searching…';
  try{
    const candidates=(RS_ROWS||[]).map(r=>({id:r.id,candidate_name:r.candidate_name,role_title:r.role_title,company:r.company,experience_years:r.experience_years,location:r.location,skills:r.skills,summary:r.summary,department_fit:r.analysis&&r.analysis.department_fit,recommended_departments:r.analysis&&r.analysis.recommended_departments}));
    const out=await resumeAI({action:'search',query:q,candidates});
    const results=out.results||[];
    const byId={};(RS_ROWS||[]).forEach(r=>byId[r.id]=r);
    RS_SEARCH=results.map(x=>{const r=byId[x.id];if(!r)return null;return {...r,_match:{score:x.score,reason:x.reason}};}).filter(Boolean);
    if(!RS_SEARCH.length)toast('No strong matches found','');
  }catch(e){toast('Search failed: '+e.message,'err');}
  const btn2=$('rsSearchBtn');if(btn2){btn2.disabled=false;btn2.innerHTML='<i class="fa-solid fa-magnifying-glass"></i> Search';}
  rsRender();
};
window.rsUploadModal=function(){
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-upload"></i> Upload Resume</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <div class="dropzone" onclick="document.getElementById('rsFile').click()"><i class="fa-solid fa-cloud-arrow-up"></i><div id="rsFName">Click to choose a PDF, Word doc, or image</div></div>
    <input type="file" id="rsFile" class="hidden" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onchange="document.getElementById('rsFName').textContent=this.files[0]?this.files[0].name:'Click to choose a PDF, Word doc, or image'">
    <p style="font-size:12px;color:var(--slate);margin-top:10px">AI will automatically read the resume and fill in name, contact info, skills, experience and a summary — no need to type it in.</p>
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="rsUpBtn" onclick="rsUploadSave()"><i class="fa-solid fa-upload"></i> Upload & Analyze</button></div>`);
};
window.rsUploadSave=async function(){
  const fEl=$('rsFile');const f=fEl&&fEl.files&&fEl.files[0];if(!f){toast('Choose a file first','err');return;}
  const btn=$('rsUpBtn');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Uploading…';
  const key=s3KeyForResume(f.name);
  const {data:upData,error:upErr}=await uploadFileToS3(key,f);
  if(upErr){toast('Upload failed: '+upErr.message,'err');btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-upload"></i> Upload & Analyze';return;}
  btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Reading file…';
  const ctext=await extractFileText(f);
  const {data:row,error}=await sb.schema('hr').from('resumes').insert({file_name:f.name,storage_path:upData.path,file_size:f.size,file_type:f.name.split('.').pop(),uploaded_by:state.email,content_text:ctext,ai_status:'pending'}).select().single();
  if(error){toast('Saved file but record failed: '+error.message,'err');closeModal();hrResumes();return;}
  closeModal();toast('Resume uploaded — analyzing with AI…','ok');
  RS_ROWS=[row,...(RS_ROWS||[])];rsRender();
  if(!ctext||ctext.replace(/\s/g,'').length<20){
    await sb.schema('hr').from('resumes').update({ai_status:'error',ai_error:'Could not read text from this file'}).eq('id',row.id);
    const idx=(RS_ROWS||[]).findIndex(x=>x.id===row.id);if(idx>-1){RS_ROWS[idx].ai_status='error';RS_ROWS[idx].ai_error='Could not read text from this file';}
    rsRender();return;
  }
  try{
    const out=await resumeAI({action:'analyze',text:ctext});
    const p=out.profile||{};
    const patch={ai_status:'done',ai_error:null,candidate_name:p.candidate_name||null,email:p.email||null,phone:p.phone||null,location:p.location||null,role_title:p.role_title||null,company:p.company||null,experience_years:p.experience_years||null,education:p.education||null,summary:p.summary||null,skills:p.skills||[],certifications:p.certifications||[],analysis:p};
    await sb.schema('hr').from('resumes').update(patch).eq('id',row.id);
    const idx=(RS_ROWS||[]).findIndex(x=>x.id===row.id);if(idx>-1)RS_ROWS[idx]={...RS_ROWS[idx],...patch};
    toast('Resume analyzed','ok');
  }catch(e){
    await sb.schema('hr').from('resumes').update({ai_status:'error',ai_error:e.message}).eq('id',row.id);
    const idx=(RS_ROWS||[]).findIndex(x=>x.id===row.id);if(idx>-1){RS_ROWS[idx].ai_status='error';RS_ROWS[idx].ai_error=e.message;}
    toast('AI analysis failed: '+e.message,'err');
  }
  rsRender();
};
async function rsGet(id){const {data}=await sb.schema('hr').from('resumes').select('*').eq('id',id).single();return data;}
window.rsPreview=async function(id){
  const r=await rsGet(id);if(!r||!r.storage_path){toast('No file attached','');return;}
  if(isS3Path(r.storage_path)){ await s3OpenSigned(r.storage_path); return; }
  const {data,error}=await sb.storage.from('resumes').createSignedUrl(r.storage_path,120);
  if(error){toast('Preview failed: '+error.message,'err');return;}
  window.open(data.signedUrl,'_blank');
};
window.rsDownload=async function(id){
  const r=await rsGet(id);if(!r||!r.storage_path){toast('No file attached','');return;}
  if(isS3Path(r.storage_path)){ await s3OpenSigned(r.storage_path,r.file_name||'download'); return; }
  const {data,error}=await sb.storage.from('resumes').createSignedUrl(r.storage_path,120,{download:r.file_name||true});
  if(error){toast('Download failed: '+error.message,'err');return;}
  const a=document.createElement('a');a.href=data.signedUrl;a.download=r.file_name||'';document.body.appendChild(a);a.click();a.remove();
};
window.rsDelete=async function(id){
  if(!await confirmDialog('Delete this resume permanently?'))return;
  const r=await rsGet(id);
  if(r&&r.storage_path){ if(isS3Path(r.storage_path)) await s3Delete(r.storage_path); else await sb.storage.from('resumes').remove([r.storage_path]); }
  const {error}=await sb.schema('hr').from('resumes').delete().eq('id',id);
  if(error){toast(error.message,'err');return;}
  RS_ROWS=(RS_ROWS||[]).filter(x=>x.id!==id);
  if(RS_SEARCH)RS_SEARCH=RS_SEARCH.filter(x=>x.id!==id);
  toast('Deleted','ok');rsRender();
};

/* ── Interview Qs (AI-generated interview guides) ── */
let IG_ROWS=null;
async function hrInterviewQs(){
  const b=$('hrBody');loader(b);
  try{const {data,error}=await sb.schema('hr').from('interview_guides').select('*').order('created_at',{ascending:false});if(error)throw error;IG_ROWS=data||[];}
  catch(e){b.innerHTML='<div class="empty" style="padding:40px;color:var(--err)">'+esc(e.message)+'</div>';return;}
  igRender();
}
function igRender(){
  const b=$('hrBody');if(!b)return;
  const rows=IG_ROWS||[];
  b.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <div class="sec-title" style="margin:0">Interview Guides <span class="tag t-gray" style="margin-left:4px">${rows.length}</span></div>
    <div style="margin-left:auto"><button class="btn btn-primary" onclick="igGenModal()"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate Guide</button></div>
  </div>
  <div id="igList">${rows.length?rows.map(g=>`<div class="card card-pad" style="margin-bottom:12px;cursor:pointer" onclick="igOpen(${g.id})">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
      <div style="min-width:0"><div style="font-weight:700;font-size:14.5px">${esc((g.guide&&g.guide.title)||g.title||'Interview Guide')}</div>
      <div style="color:var(--slate);font-size:12.5px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.brief||'')}</div>
      <div style="color:var(--slate);font-size:11.5px;margin-top:5px">${relTime(g.created_at)} · ${esc(g.created_by||'')}</div></div>
      <button class="btn btn-sm" style="color:var(--err);border-color:var(--err);flex-shrink:0" onclick="event.stopPropagation();igDelete(${g.id})"><i class="fa-solid fa-trash"></i></button>
    </div></div>`).join(''):'<div class="empty" style="padding:40px"><i class="fa-solid fa-comments"></i><div>No interview guides yet — click Generate Guide</div></div>'}</div>
  <div id="igDetail"></div>`;
}
window.igGenModal=function(){
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-wand-magic-sparkles"></i> Generate Interview Guide</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>Describe the hiring situation</label>
    <textarea id="igBrief" rows="4" placeholder="e.g. Hiring a mid-level Sales Executive for residential real estate, 2-4 years experience, needs strong negotiation and client-facing skills"></textarea>
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="igGenBtn" onclick="igGenerate()"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate</button></div>`,'lg');
  setTimeout(()=>{const el=$('igBrief');if(el)el.focus();},100);
};
window.igGenerate=async function(){
  const brief=($('igBrief')||{}).value?.trim();if(!brief){toast('Describe the hiring situation first','err');return;}
  const btn=$('igGenBtn');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Generating…';
  try{
    const out=await resumeAI({action:'interview',brief});
    const guide=out.guide;if(!guide)throw new Error('AI returned no guide');
    const {data:row,error}=await sb.schema('hr').from('interview_guides').insert({title:guide.title||brief.slice(0,80),brief,guide,created_by:state.email}).select().single();
    if(error)throw new Error(error.message);
    IG_ROWS=[row,...(IG_ROWS||[])];
    closeModal();toast('Interview guide generated','ok');
    igRender();igOpen(row.id);
  }catch(e){toast('Generation failed: '+e.message,'err');const b2=$('igGenBtn');if(b2){b2.disabled=false;b2.innerHTML='<i class="fa-solid fa-wand-magic-sparkles"></i> Generate';}}
};
window.igOpen=function(id){
  const g=(IG_ROWS||[]).find(x=>x.id===id);const host=$('igDetail');if(!g||!host)return;
  const guide=g.guide||{};
  host.innerHTML=`<div class="card card-pad" style="margin-top:6px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
      <div><div style="font-weight:700;font-size:16px">${esc(guide.title||g.title||'')}</div>
      <p style="font-size:13px;color:var(--slate);margin-top:5px;max-width:640px">${esc(guide.overview||'')}</p></div>
      <button style="background:none;border:none;cursor:pointer;font-size:20px;color:var(--slate)" onclick="document.getElementById('igDetail').innerHTML=''">&times;</button>
    </div>
    ${(guide.sections||[]).map(s=>`<div style="margin-top:16px"><div style="font-weight:700;font-size:13.5px;color:#0369a1;margin-bottom:8px">${esc(s.name||'')}</div>
      ${(s.questions||[]).map(q=>`<div style="padding:10px 0;border-bottom:1px solid var(--line-2)"><div style="font-weight:500;font-size:13.5px">${esc(q.q||'')}</div><div style="font-size:12px;color:var(--slate);margin-top:3px"><i class="fa-solid fa-eye" style="width:12px"></i> Look for: ${esc(q.look_for||'')}</div></div>`).join('')}
    </div>`).join('')}
    ${(guide.red_flags||[]).length?`<div style="margin-top:16px"><div style="font-weight:700;font-size:13px;color:#c83232;margin-bottom:6px"><i class="fa-solid fa-triangle-exclamation"></i> Red flags</div><ul style="font-size:12.5px;color:var(--ink);padding-left:18px;line-height:1.7">${guide.red_flags.map(x=>'<li>'+esc(x)+'</li>').join('')}</ul></div>`:''}
    ${(guide.tips||[]).length?`<div style="margin-top:14px"><div style="font-weight:700;font-size:13px;color:#15803d;margin-bottom:6px"><i class="fa-solid fa-lightbulb"></i> Tips</div><ul style="font-size:12.5px;color:var(--ink);padding-left:18px;line-height:1.7">${guide.tips.map(x=>'<li>'+esc(x)+'</li>').join('')}</ul></div>`:''}
  </div>`;
  host.scrollIntoView({behavior:'smooth',block:'start'});
};
window.igDelete=async function(id){
  if(!await confirmDialog('Delete this interview guide?'))return;
  const {error}=await sb.schema('hr').from('interview_guides').delete().eq('id',id);
  if(error){toast(error.message,'err');return;}
  IG_ROWS=(IG_ROWS||[]).filter(x=>x.id!==id);
  toast('Deleted','ok');igRender();
};


/* ── Inspection globals & helpers ── */
let INSP_ROWS=null, INSP_SCOPE={block:'All',floor:'All',flat:'All',work:'All',project:'All'}, INSP_DRILL=null, INSP_SUBS=[];
let INSP_FORM_STATE=null; // {cat, answers:{ 'component::section::itemId': status }}
let INSP_RESP_FILTER={q:'',work:'All'};
let INSP_LOG_FILTER={q:'',block:'All',cat:'All',status:'All',section:'All'};
async function inspFetch(){ const {data,error}=await sb.schema('acc').from('inspection').select('*').order('ts',{ascending:false}).limit(20000); if(error)throw error; return data||[]; }
function inspLoc(r){ return (r.project?esc(r.project)+' · ':'')+'B'+esc(r.block||'?')+(r.floor?' · '+esc(r.floor):'')+' · '+esc(r.flat||'?'); }
function qcStat(rows){ let ok=0,no=0,na=0; rows.forEach(r=>{const u=(r.status||'').trim().toUpperCase(); if(u==='OK')ok++; else if(/NOT\s*OK/.test(u)){no++;} else if(u==='NA'||u==='N/A')na++;}); const rated=ok+no; const checks=ok+no+na; return {checks,ok,no,na,open:no,rated,pass:rated?Math.round(ok/rated*100):0}; }
function statusBadge(s){const u=(s||'').toUpperCase(); if(u==='OK')return '<span class="tag t-green">OK</span>'; if(/NOT\s*OK/.test(u))return '<span class="tag t-red">NOT OK</span>'; if(u==='NA'||u==='N/A')return '<span class="tag t-gray">NA</span>'; return esc(s);}
function passbar(p){const col=p>=80?'#16855a':p>=50?'#d98a00':'#c83232';return '<div style="display:flex;align-items:center;gap:7px"><div class="progress" style="max-width:84px;flex:1"><span style="width:'+p+'%;background:'+col+'"></span></div><span style="font-size:11.5px;color:var(--slate)">'+p+'%</span></div>';}
window.inspReload=function(){ INSP_ROWS=null; if(PAGE==='inspection')renderPage(); };
window.inspScope=function(dim,val){ INSP_SCOPE[dim]=val; if(PAGE==='inspection')renderPage(); };
window.inspScopeClear=function(){ INSP_SCOPE={block:'All',floor:'All',flat:'All',work:'All',project:'All'}; if(PAGE==='inspection')renderPage(); };
window.inspDrill=function(dim,key,col){ INSP_DRILL={dim,key,col}; try{window.scrollTo(0,0);}catch(e){} if(PAGE==='inspection')renderPage(); };
window.inspOpenSub=function(i){ INSP_DRILL={dim:'sub',i}; try{window.scrollTo(0,0);}catch(e){} if(PAGE==='inspection')renderPage(); };
window.inspBack=function(){ INSP_DRILL=null; if(PAGE==='inspection')renderPage(); };
window.inspGo=function(tab){ INSP_DRILL=null; navTo('inspection'+(tab==='console'?'':'/'+tab)); };
function inspHeadTabs(tab){
  const tabs=[['console','Console','fa-table-cells-large'],['responses','Form Responses','fa-file-lines'],['log','Inspection Log','fa-list']];
  return '<div class="page-head"><div><h1><i class="fa-solid fa-clipboard-check" style="color:#0f766e"></i> Inspection</h1><p>Site quality inspection console</p></div><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" onclick="inspReload()"><i class="fa-solid fa-rotate"></i> Refresh</button><button class="btn btn-primary" onclick="navTo(\'inspection/new\')"><i class="fa-solid fa-plus"></i> New Inspection</button></div></div>'+
   '<div class="tabs">'+tabs.map(t=>'<div class="tab '+(tab===t[0]?'active':'')+'" onclick="inspGo(\''+t[0]+'\')"><i class="fa-solid '+t[2]+'"></i> '+t[1]+'</div>').join('')+'</div>';
}

VIEWS.inspection=async function(v,seg){
  setCrumb(['Operations','Inspection']);
  if(seg&&seg[0]==='new'){ INSP_DRILL=null; return inspForm(v); }
  if(!INSP_ROWS){
    v.innerHTML='<div class="page-head"><div><h1><i class="fa-solid fa-clipboard-check" style="color:#0f766e"></i> Inspection</h1></div></div><div class="card card-pad"><div class="loader"><div class="spin"></div></div></div>';
    try{ INSP_ROWS=await inspFetch(); }catch(e){ v.innerHTML='<div class="card card-pad empty"><i class="fa-solid fa-triangle-exclamation"></i><div style="font-weight:600">Could not load inspections</div><p>'+esc(e.message||String(e))+'</p></div>'; return; }
  }
  const tab=(seg&&seg[0])||'console';
  if(tab==='responses') return inspResponses(v,INSP_ROWS);
  if(tab==='log') return inspLog(v,INSP_ROWS);
  if(INSP_DRILL && INSP_DRILL.dim!=='sub') return inspDrillView(v,INSP_ROWS);
  inspConsole(v,INSP_ROWS);
};
function inspConsole(v,rows){
  const overall=qcStat(rows);
  const sc=INSP_SCOPE;
  const scoped=rows.filter(r=>(sc.project==='All'||r.project===sc.project)&&(sc.block==='All'||r.block===sc.block)&&(sc.floor==='All'||r.floor===sc.floor)&&(sc.flat==='All'||r.flat===sc.flat)&&(sc.work==='All'||r.work_category===sc.work));
  const ss=qcStat(scoped); const scopeActive=sc.project!=='All'||sc.block!=='All'||sc.floor!=='All'||sc.flat!=='All'||sc.work!=='All';
  const B=(window.INSP_BLOCKS||[...new Set(rows.map(r=>r.block).filter(Boolean))]);
  const C=(window.INSP_CATS||[...new Set(rows.map(r=>r.work_category).filter(Boolean))]);
  const PR=(window.INSP_PROJECTS||[...new Set(rows.map(r=>r.project).filter(Boolean))]);
  const LVD=(window.INSP_LEVELS||[...new Set(rows.map(r=>r.insp_level).filter(Boolean))]);
  const byBlock=B.map(x=>({key:x,s:qcStat(rows.filter(r=>r.block===x))})).filter(x=>x.s.checks>0);
  const byCat=C.map(x=>({key:x,s:qcStat(rows.filter(r=>r.work_category===x))})).filter(x=>x.s.checks>0);
  const byProject=PR.map(x=>({key:x,s:qcStat(rows.filter(r=>r.project===x))})).filter(x=>x.s.checks>0);
  const byLevel=LVD.map(x=>({key:x,s:qcStat(rows.filter(r=>r.insp_level===x))})).filter(x=>x.s.checks>0);
  const openDefects=rows.filter(r=>/NOT\s*OK/.test((r.status||'').toUpperCase()));
  const kpis=[['Total Logs',overall.checks,'#1763A6','fa-list-check'],['OK',overall.ok,'#16855A','fa-circle-check'],['NOT OK',overall.no,'#C83232','fa-circle-xmark'],['Not Applicable',overall.na,'#94a3b8','fa-circle-minus'],['Percentage',overall.pass+'%','#F2A104','fa-percent']];
  const kpiBand='<div class="grid kpis" style="grid-template-columns:repeat(5,1fr)">'+kpis.map(k=>'<div class="kpi"><div class="top"><div class="ic" style="background:'+k[2]+'18;color:'+k[2]+'"><i class="fa-solid '+k[3]+'"></i></div></div><div class="val">'+k[1]+'</div><div class="lbl">'+k[0]+'</div></div>').join('')+'</div>';
  const opt=(dim,cur,vals)=>'<select onchange="inspScope(\''+dim+'\',this.value)"><option value="All"'+(cur==='All'?' selected':'')+'>All</option>'+(vals||[]).map(x=>'<option'+(cur===String(x)?' selected':'')+'>'+esc(x)+'</option>').join('')+'</select>';
  const P=window.INSP_PROJECTS||[];
  const scopeCard='<div class="card card-pad" style="margin-top:16px"><div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:8px"><div><div class="insp-kicker">DRILL-DOWN</div><div class="sec-title" style="margin:2px 0 0">Filter by Project · Block · Floor · Flat · Work Type</div></div><span class="insp-count">'+scoped.length+' of '+rows.length+' checks</span></div>'+
    '<div class="insp-filter-row">'+
    '<div class="insp-field"><label>Project</label>'+opt('project',sc.project,P)+'</div>'+
    '<div class="insp-field"><label>Block</label>'+opt('block',sc.block,B)+'</div>'+
    '<div class="insp-field"><label>Floor</label>'+opt('floor',sc.floor,window.INSP_FLOORS||[])+'</div>'+
    '<div class="insp-field"><label>Flat</label>'+opt('flat',sc.flat,window.INSP_FLATS||[])+'</div>'+
    '<div class="insp-field"><label>Work Type</label>'+opt('work',sc.work,C)+'</div>'+
    (scopeActive?'<button class="btn insp-clear-btn" onclick="inspScopeClear()"><i class=\"fa-solid fa-xmark\"></i> Clear</button>':'')+'</div>'+
    '<div style="display:flex;align-items:center;gap:18px;margin-top:14px;padding-top:14px;border-top:1px dashed var(--line);flex-wrap:wrap">'+
     '<div class="insp-skpi"><div class="n">'+ss.checks+'</div><div class="l">Total Logs</div></div>'+
     '<div class="insp-skpi"><div class="n" style="color:#16855A">'+ss.ok+'</div><div class="l">OK</div></div>'+
     '<div class="insp-skpi"><div class="n" style="color:#C83232">'+ss.no+'</div><div class="l">Not OK</div></div>'+
     '<div class="insp-skpi"><div class="n" style="color:#94a3b8">'+ss.na+'</div><div class="l">Not Applicable</div></div>'+
     '<div class="insp-skpi"><div class="n" style="color:#1763A6">'+ss.pass+'%</div><div class="l">Percentage</div></div>'+
     '<div style="flex:1;min-width:150px">'+passbar(ss.pass)+'</div></div>'+
    (scopeActive&&ss.checks===0?'<div style="margin-top:12px;font-size:13px;color:#C83232;background:#fbe7e7;padding:9px 13px;border-radius:8px">No checks logged for this scope yet.</div>':'')+'</div>';
  const num=(dim,key,col,val,cls)=>'<a class="insp-num '+(cls||'')+'" onclick="inspDrill(\''+dim+'\',\''+esc(String(key)).replace(/'/g,"&#39;")+'\',\''+col+'\')">'+val+'</a>';
  const DIM_LABEL={block:'Block',cat:'Category',project:'Project',level:'Level'};
  const matrix=(arr,dim,head)=>'<div class="card qc-table-card" style="padding:0"><div class="card-pad" style="border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:flex-end"><div><div class="insp-kicker">STATUS</div><div class="sec-title" style="margin:2px 0 0">'+head+'</div></div><span class="qc-hint" style="font-size:11.5px;color:#94a3b8;font-style:italic">Click any number to drill in</span></div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>'+(DIM_LABEL[dim]||'Key')+'</th><th>Total Logs</th><th>OK</th><th>Not OK</th><th>Not Applicable</th><th>Percentage</th></tr></thead><tbody>'+
    (arr.length?arr.map(x=>'<tr><td><b>'+esc(x.key)+'</b></td><td>'+num(dim,x.key,'all',x.s.checks,'')+'</td><td>'+num(dim,x.key,'ok',x.s.ok,'ok')+'</td><td>'+num(dim,x.key,'notok',x.s.no,'no')+'</td><td>'+num(dim,x.key,'na',x.s.na,'')+'</td><td>'+passbar(x.s.pass)+'</td></tr>').join(''):'<tr><td colspan="6"><div class="empty" style="padding:20px">No data</div></td></tr>')+'</tbody></table></div></div>';
  const openCard='<div class="card qc-table-card" style="padding:0;margin-top:16px"><div class="card-pad" style="border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:flex-end"><div><div class="insp-kicker" style="color:#E08600">NEEDS ATTENTION</div><div class="sec-title" style="margin:2px 0 0">Not OK Items</div></div><span class="insp-pill">'+openDefects.length+'</span></div>'+
    (openDefects.length===0?'<div class="empty" style="padding:36px"><i class="fa-solid fa-circle-check" style="color:#16855a"></i><div style="font-weight:600">No Not OK items</div><p>Everything logged so far is OK.</p></div>':'<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Block</th><th>Floor</th><th>Flat</th><th>Category</th><th>Item ID</th><th>Inspection Check</th><th>Status</th><th>Inspector</th></tr></thead><tbody>'+openDefects.map(r=>'<tr><td>'+esc(r.block)+'</td><td>'+esc(r.floor)+'</td><td>'+esc(r.flat)+'</td><td>'+esc(r.work_category)+'</td><td><b>'+esc(r.item_id)+'</b></td><td style="max-width:280px;color:#475569">'+esc(r.inspection_check)+'</td><td>'+statusBadge(r.status)+'</td><td>'+esc(r.inspector)+'</td></tr>').join('')+'</tbody></table></div>')+'</div>';
  const empty=rows.length===0?'<div class="card card-pad empty" style="margin-top:16px"><i class="fa-regular fa-clipboard"></i><div style="font-weight:600;color:var(--ink)">No inspections logged yet</div><p style="max-width:420px;margin:6px auto 0">Click <b>New Inspection</b> to record one — it saves straight to the database.</p></div>':'';
  v.innerHTML=inspHeadTabs('console')+kpiBand+scopeCard+(rows.length?('<div class="insp-matrix-grid">'+matrix(byBlock,'block','By Block')+matrix(byCat,'cat','By Work Category')+matrix(byProject,'project','By Project')+matrix(byLevel,'level','By Level')+'</div>'+openCard):empty);
}
const INSP_DIM_FIELD={block:'block',cat:'work_category',project:'project',level:'insp_level'};
function inspDrillView(v,rows){
  const d=INSP_DRILL; const field=INSP_DIM_FIELD[d.dim]||'work_category'; const dimRows=rows.filter(r=>r[field]===d.key);
  const u=r=>(r.status||'').toUpperCase();
  const colRows=d.col==='ok'?dimRows.filter(r=>u(r)==='OK'):d.col==='notok'?dimRows.filter(r=>/NOT\s*OK/.test(u(r))):d.col==='na'?dimRows.filter(r=>u(r)==='NA'||u(r)==='N/A'):dimRows;
  const lbl={all:'All checks',ok:'OK',notok:'Not OK',na:'Not Applicable'}[d.col]||'Checks';
  v.innerHTML=inspHeadTabs('console')+'<button class="btn" style="margin-bottom:14px" onclick="inspBack()"><i class="fa-solid fa-arrow-left"></i> Back to console</button>'+
    '<div class="card qc-table-card" style="padding:0"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="insp-kicker">'+{block:'BLOCK',cat:'WORK CATEGORY',project:'PROJECT',level:'LEVEL'}[d.dim]+' · '+esc(d.key)+'</div><div class="sec-title" style="margin:2px 0 0">'+lbl+' · '+colRows.length+' checks</div></div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Date</th><th>Inspector</th><th>Location</th><th>Category</th><th>Item</th><th>Check</th><th>Status</th><th>Remarks</th></tr></thead><tbody>'+
    (colRows.length?colRows.map(r=>'<tr><td>'+esc(fmtDate(r.ts))+'</td><td>'+esc(r.inspector)+'</td><td>'+inspLoc(r)+'</td><td>'+esc(r.work_category)+'</td><td><b>'+esc(r.item_id)+'</b></td><td style="max-width:260px;color:#475569">'+esc(r.inspection_check)+'</td><td>'+statusBadge(r.status)+'</td><td style="color:var(--slate);max-width:200px">'+esc(r.remarks)+'</td></tr>').join(''):'<tr><td colspan="8"><div class="empty">No checks</div></td></tr>')+'</tbody></table></div></div>';
}
function inspResponses(v,rows){
  const map={}; rows.forEach(r=>{const k=[r.ts,r.inspector,r.block,r.floor,r.flat,r.work_category].join('|'); if(!map[k])map[k]={ts:r.ts,ins:r.inspector,block:r.block,floor:r.floor,flat:r.flat,cat:r.work_category,loc:inspLoc(r),rows:[],ok:0,no:0,sec:r.remarks||'',photo:r.defect_photo||'',overall:r.overall_remark||''}; const o=map[k]; o.rows.push(r); const uu=(r.status||'').toUpperCase(); if(uu==='OK')o.ok++; else if(/NOT\s*OK/.test(uu))o.no++;});
  INSP_SUBS=Object.values(map);
  if(INSP_DRILL && INSP_DRILL.dim==='sub'){
    const s=INSP_SUBS[INSP_DRILL.i]; if(!s){ INSP_DRILL=null; return inspResponses(v,rows); }
    if(INSP_DRILL.edit) return inspEditView(v,s);
    v.innerHTML=inspHeadTabs('responses')+
      '<div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap"><button class="btn" onclick="inspBack()"><i class="fa-solid fa-arrow-left"></i> Back to responses</button><button class="btn btn-primary" onclick="inspEditSub()"><i class="fa-solid fa-pen"></i> Edit response</button></div>'+
      '<div class="card card-pad"><div class="insp-kicker">SUBMISSION</div><div class="sec-title" style="margin:2px 0 8px">'+esc(s.cat)+' · '+s.loc+'</div><div style="display:flex;flex-wrap:wrap;gap:10px">'+
      [['Date',esc(fmtDate(s.ts))],['Inspector',esc(s.ins)],['OK',s.ok],['Not OK',s.no],['Total Log',s.ok+s.no]].map(f=>'<div class="insp-fact"><div class="fl">'+f[0]+'</div><div class="fv">'+f[1]+'</div></div>').join('')+'</div>'+
      (s.sec?'<div style="margin-top:12px"><label style="font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--slate);text-transform:uppercase">Section Remark</label><div style="font-size:13px;margin-top:3px">'+esc(s.sec)+'</div></div>':'')+
      (s.photo?'<div style="margin-top:10px"><label style="font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--slate);text-transform:uppercase">Defect Photos</label><div style="font-size:13px;margin-top:3px">'+(isS3Path(s.photo)?'<button class="btn btn-sm" onclick="inspOpenPhoto(\''+esc(s.photo)+'\')"><i class="fa-solid fa-image"></i> View photo</button>':'<a href="'+esc(s.photo)+'" target="_blank" rel="noopener" style="color:var(--brand)">'+esc(s.photo)+'</a>')+'</div></div>':'')+
      (s.overall?'<div style="margin-top:10px"><label style="font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--slate);text-transform:uppercase">Overall Remarks</label><div style="font-size:13px;margin-top:3px">'+esc(s.overall)+'</div></div>':'')+'</div>'+
      '<div class="card qc-table-card" style="padding:0;margin-top:16px"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="sec-title" style="margin:0">Checks · '+s.rows.length+'</div></div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Item</th><th>Check</th><th>Status</th></tr></thead><tbody>'+s.rows.map(r=>'<tr><td><b>'+esc(r.item_id)+'</b></td><td style="max-width:420px;color:#475569">'+esc(r.inspection_check)+'</td><td>'+statusBadge(r.status)+'</td></tr>').join('')+'</tbody></table></div></div>';
    return;
  }
  const C=window.INSP_CATS||[...new Set(rows.map(r=>r.work_category).filter(Boolean))];
  const f=INSP_RESP_FILTER, q=(f.q||'').trim().toLowerCase();
  const passF=x=>(f.work==='All'||x.cat===f.work)&&(!q||[x.ins,x.block,x.flat].some(v=>String(v||'').toLowerCase().includes(q)));
  const shown=INSP_SUBS.map((x,i)=>({x,i})).filter(o=>passF(o.x));
  const toolbar='<div class="toolbar" style="margin-bottom:14px">'+
    '<div class="grow"><i class="fa-solid fa-magnifying-glass"></i><input id="respQ" placeholder="Search Inspector, Block or Flat…" value="'+esc(f.q)+'" oninput="inspRespFilter()"></div>'+
    '<select class="sel" id="respWork" onchange="inspRespFilter()"><option value="All">All Work Types</option>'+C.map(c=>'<option'+(f.work===c?' selected':'')+'>'+esc(c)+'</option>').join('')+'</select>'+
    (q||f.work!=='All'?'<button class="btn" onclick="inspRespFilterClear()"><i class="fa-solid fa-xmark"></i> Clear</button>':'')+
    '</div>';
  const respRow=({x,i})=>'<tr class="rowlink" onclick="inspOpenSub('+i+')"><td>'+esc(fmtDate(x.ts))+'</td><td>'+esc(x.ins)+'</td><td>'+x.loc+'</td><td>'+esc(x.cat)+'</td><td style="color:#16855a;font-weight:600">'+x.ok+'</td><td style="color:#c83232;font-weight:600">'+x.no+'</td><td style="font-weight:600">'+(x.ok+x.no)+'</td><td style="text-align:right"><i class="fa-solid fa-chevron-right" style="color:#cbd5e1"></i></td></tr>';
  v.innerHTML=inspHeadTabs('responses')+toolbar+'<div class="card qc-table-card" style="padding:0"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="sec-title" style="margin:0">Form Responses</div><div class="sec-sub" id="respSecSub">'+shown.length+' of '+INSP_SUBS.length+' submissions · click a row to open it</div></div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Date</th><th>Inspector</th><th>Location</th><th>Category</th><th>OK</th><th>Not OK</th><th>Total Log</th><th></th></tr></thead><tbody id="respTbody">'+
    (shown.length?shown.map(respRow).join(''):'<tr><td colspan="8"><div class="empty">No submissions match this search/filter.</div></td></tr>')+'</tbody></table></div></div>';
}
window.inspRespFilter=function(){
  const qEl=$('respQ'), wEl=$('respWork'); if(!qEl||!wEl)return;
  INSP_RESP_FILTER={q:qEl.value,work:wEl.value};
  const f=INSP_RESP_FILTER, q=(f.q||'').trim().toLowerCase();
  const passF=x=>(f.work==='All'||x.cat===f.work)&&(!q||[x.ins,x.block,x.flat].some(v=>String(v||'').toLowerCase().includes(q)));
  const shown=INSP_SUBS.map((x,i)=>({x,i})).filter(o=>passF(o.x));
  const respRow=({x,i})=>'<tr class="rowlink" onclick="inspOpenSub('+i+')"><td>'+esc(fmtDate(x.ts))+'</td><td>'+esc(x.ins)+'</td><td>'+x.loc+'</td><td>'+esc(x.cat)+'</td><td style="color:#16855a;font-weight:600">'+x.ok+'</td><td style="color:#c83232;font-weight:600">'+x.no+'</td><td style="font-weight:600">'+(x.ok+x.no)+'</td><td style="text-align:right"><i class="fa-solid fa-chevron-right" style="color:#cbd5e1"></i></td></tr>';
  const tb=$('respTbody'); if(tb)tb.innerHTML=shown.length?shown.map(respRow).join(''):'<tr><td colspan="8"><div class="empty">No submissions match this search/filter.</div></td></tr>';
  const sub=$('respSecSub'); if(sub)sub.textContent=shown.length+' of '+INSP_SUBS.length+' submissions · click a row to open it';
};
window.inspRespFilterClear=function(){ INSP_RESP_FILTER={q:'',work:'All'}; if(PAGE==='inspection')renderPage(); };
function inspEditView(v,s){
  v.innerHTML=inspHeadTabs('responses')+
    '<div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap"><button class="btn" onclick="inspCancelEdit()"><i class="fa-solid fa-arrow-left"></i> Cancel</button></div>'+
    '<div class="card card-pad frm" style="max-width:920px"><div class="insp-kicker">EDIT SUBMISSION</div><div class="sec-title" style="margin:2px 0 4px">'+esc(s.cat)+' · '+s.loc+'</div><div style="color:var(--slate);font-size:12.5px;margin-bottom:10px">'+esc(fmtDate(s.ts))+' · '+esc(s.ins)+'</div>'+
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px"><div class="sec-title" style="margin:0;font-size:14px">Checks · '+s.rows.length+'</div><button type="button" class="btn btn-sm" onclick="inspBulkE(\'OK\')">All OK</button></div>'+
    '<div id="eItems">'+(()=>{
      const groups=[]; let cur=null;
      s.rows.forEach(r=>{
        const key=(r.sub_area||'')+'::'+(r.component||'')+'::'+(r.section||'');
        if(!cur||cur.key!==key){ cur={key,label:[r.sub_area,r.component,r.section].filter(Boolean).join(' · '),rows:[]}; groups.push(cur); }
        cur.rows.push(r);
      });
      const mkRow=r=>{const u=(r.status||'').toUpperCase();const mk=(st)=>{const sel=(st==='OK'&&u==='OK')||(/NOT/.test(st)&&/NOT\s*OK/.test(u))||(st==='NA'&&(u==='NA'||u==='N/A'));const cls=st==='OK'?'ok':/NOT/.test(st)?'no':'na';return '<button type="button" class="ic-btn'+(sel?' on '+cls:'')+'" data-s="'+st+'" onclick="inspPick(this)">'+st+'</button>';};return '<div class="insp-check" data-id="'+r.id+'" data-status="'+esc(r.status||'')+'"><div class="ic-main"><div class="ic-id">'+esc(r.item_id)+'</div><div class="ic-txt">'+esc(r.inspection_check)+'</div></div><div class="ic-seg">'+['OK','NOT OK','NA'].map(mk).join('')+'</div></div>';};
      return groups.map(g=>g.label?('<div class="insp-comp-group"><div class="insp-comp-head">'+esc(g.label)+'<span class="insp-comp-count">'+g.rows.length+' checks</span></div><div class="insp-checks">'+g.rows.map(mkRow).join('')+'</div></div>'):('<div class="insp-checks">'+g.rows.map(mkRow).join('')+'</div>')).join('');
    })()+'</div>'+
    '<label style="margin-top:14px">Section Remark</label><textarea id="eSec">'+esc(s.sec)+'</textarea>'+
    '<label>Defect Photos</label>'+
    (s.photo&&isS3Path(s.photo)?'<div style="font-size:12.5px;margin-bottom:4px"><button type="button" class="btn btn-sm" onclick="inspOpenPhoto(\''+esc(s.photo)+'\')"><i class="fa-solid fa-image"></i> View current photo</button></div>':'')+
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input id="ePhoto" placeholder="Paste a link (optional)" value="'+esc(isS3Path(s.photo)?'':(s.photo||''))+'" style="flex:1;min-width:180px"><button type="button" class="btn btn-sm" onclick="document.getElementById(\'ePhotoFile\').click()"><i class="fa-solid fa-camera"></i> Replace photo</button><input type="file" id="ePhotoFile" class="hidden" accept="image/*" onchange="document.getElementById(\'ePhotoName\').textContent=this.files[0]?this.files[0].name:\'\'"><span id="ePhotoName" style="font-size:12px;color:var(--slate)"></span></div>'+
    '<label>Overall Remarks</label><textarea id="eOverall">'+esc(s.overall)+'</textarea>'+
    '<div style="margin-top:18px;display:flex;justify-content:flex-end;gap:10px"><button class="btn" onclick="inspCancelEdit()">Cancel</button><button class="btn btn-primary" id="eSaveBtn" onclick="inspUpdateSub()"><i class="fa-solid fa-check"></i> Save changes</button></div></div>';
}
window.inspOpenPhoto=async function(path){ if(isS3Path(path)){ await s3OpenSigned(path); } else if(path){ window.open(path,'_blank'); } };
window.inspEditSub=function(){ if(INSP_DRILL){INSP_DRILL.edit=true; try{window.scrollTo(0,0);}catch(e){} renderPage();} };
window.inspCancelEdit=function(){ if(INSP_DRILL){INSP_DRILL.edit=false; renderPage();} };
window.inspBulkE=function(st){ document.querySelectorAll('#eItems .insp-check').forEach(row=>{row.querySelectorAll('.ic-btn').forEach(b=>b.classList.remove('on','ok','no','na')); const b=[...row.querySelectorAll('.ic-btn')].find(x=>x.dataset.s===st); if(b){b.classList.add('on',st==='OK'?'ok':/NOT/.test(st)?'no':'na'); row.dataset.status=st;}}); };
window.inspUpdateSub=async function(){
  const sec=($('eSec').value||'').trim(), overall=($('eOverall').value||'').trim();
  const checks=[...document.querySelectorAll('#eItems .insp-check')];
  const b=$('eSaveBtn'); if(b){b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving…';}
  let photo=($('ePhoto').value||'').trim();
  const photoFile=$('ePhotoFile')&&$('ePhotoFile').files[0];
  if(photoFile){
    b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Uploading photo…';
    const {data:upData,error:upErr}=await uploadFileToS3(s3KeyForDefectImg(photoFile.name),photoFile);
    if(upErr){toast('Photo upload failed: '+upErr.message,'err'); b.disabled=false;b.innerHTML='<i class="fa-solid fa-check"></i> Save changes'; return;}
    photo=upData.path;
  } else if(!photo && INSP_DRILL){
    const cur=(INSP_SUBS||[])[INSP_DRILL.i];
    if(cur&&isS3Path(cur.photo))photo=cur.photo;
  }
  let err=null;
  for(const c of checks){ const {error}=await sb.schema('acc').from('inspection').update({status:c.dataset.status||'',remarks:sec,defect_photo:photo,overall_remark:overall}).eq('id',c.dataset.id); if(error){err=error.message;break;} }
  if(err){toast(err,'err'); if(b){b.disabled=false;b.innerHTML='<i class="fa-solid fa-check"></i> Save changes';} return;}
  INSP_ROWS=null; INSP_DRILL=null; toast('Response updated','ok'); renderPage();
};
function inspLogRow(r){ return '<tr><td>'+esc(fmtDate(r.ts))+'</td><td>'+esc(r.inspector)+'</td><td>'+inspLoc(r)+'</td><td>'+esc(r.work_category)+(r.section?'<div style="font-size:11px;color:var(--slate)">'+esc(r.section)+'</div>':'')+'</td><td><b>'+esc(r.item_id)+'</b></td><td style="max-width:260px;color:#475569">'+esc(r.inspection_check)+'</td><td>'+statusBadge(r.status)+'</td><td style="color:var(--slate);max-width:200px">'+esc(r.remarks)+'</td></tr>'; }
function inspLogFiltered(rows){
  const f=INSP_LOG_FILTER, q=(f.q||'').trim().toLowerCase();
  const su=s=>(s||'').toUpperCase();
  return rows.filter(r=>
    (f.block==='All'||r.block===f.block)&&
    (f.cat==='All'||r.work_category===f.cat)&&
    (f.section==='All'||r.section===f.section||(f.section==='(none)'&&!r.section))&&
    (f.status==='All'||(f.status==='NOT OK'?/NOT\s*OK/.test(su(r.status)):(f.status==='NA'?(su(r.status)==='NA'||su(r.status)==='N/A'):su(r.status)===f.status)))&&
    (!q||[r.inspection_check,r.item_id,r.inspector].some(v=>String(v||'').toLowerCase().includes(q)))
  );
}
function inspLog(v,rows){
  const B=window.INSP_BLOCKS||[...new Set(rows.map(r=>r.block).filter(Boolean))];
  const C=window.INSP_CATS||[...new Set(rows.map(r=>r.work_category).filter(Boolean))];
  const S=[...new Set(rows.map(r=>r.section).filter(Boolean))].sort();
  const f=INSP_LOG_FILTER;
  const shown=inspLogFiltered(rows);
  const toolbar='<div class="toolbar" style="margin-bottom:14px">'+
    '<div class="grow"><i class="fa-solid fa-magnifying-glass"></i><input id="logQ" placeholder="Search Check Description, Item Id or Inspector…" value="'+esc(f.q)+'" oninput="inspLogFilter()"></div>'+
    '<select class="sel" id="logBlock" onchange="inspLogFilter()"><option value="All">All Blocks</option>'+B.map(b=>'<option'+(f.block===String(b)?' selected':'')+'>'+esc(b)+'</option>').join('')+'</select>'+
    '<select class="sel" id="logCat" onchange="inspLogFilter()"><option value="All">All Categories</option>'+C.map(c=>'<option'+(f.cat===c?' selected':'')+'>'+esc(c)+'</option>').join('')+'</select>'+
    (S.length?'<select class="sel" id="logSection" onchange="inspLogFilter()"><option value="All">All Sections</option>'+S.map(s=>'<option'+(f.section===s?' selected':'')+'>'+esc(s)+'</option>').join('')+'<option value="(none)"'+(f.section==='(none)'?' selected':'')+'>(no section)</option></select>':'')+
    '<select class="sel" id="logStatus" onchange="inspLogFilter()"><option value="All">All Status</option>'+['OK','NOT OK','NA'].map(s=>'<option'+(f.status===s?' selected':'')+'>'+s+'</option>').join('')+'</select>'+
    (f.q||f.block!=='All'||f.cat!=='All'||f.status!=='All'||f.section!=='All'?'<button class="btn" onclick="inspLogFilterClear()"><i class="fa-solid fa-xmark"></i> Clear</button>':'')+
    '</div>';
  v.innerHTML=inspHeadTabs('log')+toolbar+'<div class="card qc-table-card" style="padding:0"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="sec-title" style="margin:0">Inspection Log</div><div class="sec-sub" id="logSecSub">'+shown.length+' of '+rows.length+' checks</div></div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Date</th><th>Inspector</th><th>Location</th><th>Category</th><th>Item</th><th>Check</th><th>Status</th><th>Remarks</th></tr></thead><tbody id="logTbody">'+
    (shown.length?shown.map(inspLogRow).join(''):'<tr><td colspan="8"><div class="empty">No checks match this search/filter.</div></td></tr>')+'</tbody></table></div></div>';
}
window.inspLogFilter=function(){
  const qEl=$('logQ'),bEl=$('logBlock'),cEl=$('logCat'),sEl=$('logStatus'),secEl=$('logSection'); if(!qEl)return;
  INSP_LOG_FILTER={q:qEl.value,block:bEl.value,cat:cEl.value,status:sEl.value,section:secEl?secEl.value:'All'};
  const shown=inspLogFiltered(INSP_ROWS||[]);
  const tb=$('logTbody'); if(tb)tb.innerHTML=shown.length?shown.map(inspLogRow).join(''):'<tr><td colspan="8"><div class="empty">No checks match this search/filter.</div></td></tr>';
  const sub=$('logSecSub'); if(sub)sub.textContent=shown.length+' of '+(INSP_ROWS||[]).length+' checks';
};
window.inspLogFilterClear=function(){ INSP_LOG_FILTER={q:'',block:'All',cat:'All',status:'All',section:'All'}; if(PAGE==='inspection')renderPage(); };
const PM_PROJECT_MAP={
  'projectmanager1@thejaingroup.com':'Dream World City',
  'dgm.project@thejaingroup.com':'Dream Gurukul'
};
function inspLockedProject(){ return PM_PROJECT_MAP[(state.email||'').toLowerCase()]||''; }
function inspForm(v){
  setCrumb(['Operations','Inspection','New inspection']);
  const B=window.INSP_BLOCKS||[],F=window.INSP_FLOORS||[],FL=window.INSP_FLATS||[],C=window.INSP_CATS||[],LV=window.INSP_LEVELS||[];
  const lockedProject=inspLockedProject();
  const projectField=lockedProject?
    ('<div style="height:38px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font-size:13px;display:flex;align-items:center;background:#f1f5f9;color:var(--ink);font-weight:600">'+esc(lockedProject)+'</div><input type="hidden" id="inProject" value="'+esc(lockedProject)+'">')
    :('<select id="inProject"><option value="">-- Select Project --</option>'+(window.INSP_PROJECTS||[]).map(p=>'<option>'+esc(p)+'</option>').join('')+'</select>');
  v.innerHTML='<div class="page-head"><div><h1><i class="fa-solid fa-clipboard-check" style="color:#0f766e"></i> New Inspection</h1><p>Record a site inspection — saved straight to the database</p></div><button class="btn" onclick="navTo(\'inspection\')"><i class="fa-solid fa-arrow-left"></i> Back</button></div>'+
  '<div class="card card-pad frm" style="max-width:920px">'+
    '<div class="two"><div><label><i class="fa-solid fa-user"></i> Inspector</label><input id="inInsp" placeholder="Inspector name"></div><div><label><i class="fa-solid fa-list-check"></i> Work Category</label><select id="inCat" onchange="inspItems()"><option value="">Select…</option>'+C.map(c=>'<option>'+esc(c)+'</option>').join('')+'</select></div></div>'+
    '<div class="insp-form-grid">'+
      '<div class="insp-fg"><label><i class="fa-solid fa-sitemap"></i> Level</label>'
        +'<div class="insp-dd" id="levelDd"><button type="button" class="insp-dd-btn" onclick="inspLevelDdToggle(event)"><i class="fa-solid fa-door-open" id="levelDdIcon"></i><span id="levelDdLabel">Flat Level (General)</span><i class="fa-solid fa-chevron-down insp-dd-caret"></i></button>'
        +'<div class="insp-dd-menu" id="levelDdMenu">'
          +'<div class="insp-dd-item" onclick="inspLevelPick(\'Project Level\',\'\',\'fa-diagram-project\',\'Project Level\')"><i class="fa-solid fa-diagram-project"></i> Project Level</div>'
          +'<div class="insp-dd-item" onclick="inspLevelPick(\'Tower Level\',\'\',\'fa-building\',\'Tower Level\')"><i class="fa-solid fa-building"></i> Tower Level</div>'
          +'<div class="insp-dd-item" onclick="inspLevelPick(\'Floor Level\',\'\',\'fa-layer-group\',\'Floor Level\')"><i class="fa-solid fa-layer-group"></i> Floor Level</div>'
          +'<div class="insp-dd-group">Flat Level</div>'
          +'<div class="insp-dd-item sub" onclick="inspLevelPick(\'Flat Level\',\'\',\'fa-door-open\',\'Flat Level (General)\')"><i class="fa-solid fa-door-open"></i> General</div>'
          +'<div class="insp-dd-item sub" onclick="inspLevelPick(\'Flat Level\',\'Kitchen\',\'fa-kitchen-set\',\'Flat Level — Kitchen\')"><i class="fa-solid fa-kitchen-set"></i> Kitchen</div>'
          +'<div class="insp-dd-item sub" onclick="inspLevelPick(\'Flat Level\',\'Bathroom\',\'fa-bath\',\'Flat Level — Bathroom\')"><i class="fa-solid fa-bath"></i> Bathroom</div>'
          +'<div class="insp-dd-item sub" onclick="inspLevelPick(\'Flat Level\',\'Others\',\'fa-ellipsis\',\'Flat Level — Others\')"><i class="fa-solid fa-ellipsis"></i> Others</div>'
        +'</div></div>'
        +'<input type="hidden" id="inLevel" value="Flat Level">'
      +'</div>'+
      '<div class="insp-fg"><label><i class="fa-solid fa-city"></i> Project</label>'+projectField+'</div>'+
      '<div class="insp-fg" id="fgBlock"><label><i class="fa-solid fa-building"></i> Block</label><select id="inBlock">'+B.map(b=>'<option>'+esc(b)+'</option>').join('')+'</select></div>'+
      '<div class="insp-fg" id="fgFloor"><label><i class="fa-solid fa-layer-group"></i> Floor</label><select id="inFloor">'+F.map(f=>'<option'+(f==='Ground'?' selected':'')+'>'+esc(f)+'</option>').join('')+'</select></div>'+
      '<div class="insp-fg" id="fgFlat"><label><i class="fa-solid fa-door-closed"></i> Flat</label><select id="inFlat">'+FL.map(f=>'<option>'+esc(f)+'</option>').join('')+'</select></div>'+
    '</div>'+
    '<div id="inItems" style="margin-top:14px"><div class="empty" style="padding:24px">Select a work category to load its checklist.</div></div>'+
    '<label style="margin-top:14px">Section Remark</label><textarea id="inSec" placeholder="A remark for this section/category (optional)"></textarea>'+
    '<label>Defect Photos</label>'+
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input id="inPhoto" placeholder="Paste a link (optional)" style="flex:1;min-width:180px"><button type="button" class="btn btn-sm" onclick="document.getElementById(\'inPhotoFile\').click()"><i class="fa-solid fa-camera"></i> Upload photo</button><input type="file" id="inPhotoFile" class="hidden" accept="image/*" onchange="document.getElementById(\'inPhotoName\').textContent=this.files[0]?this.files[0].name:\'\'"><span id="inPhotoName" style="font-size:12px;color:var(--slate)"></span></div>'+
    '<label>Overall Remarks</label><textarea id="inOverall" placeholder="Overall site remarks (optional)"></textarea>'+
    '<div style="margin-top:18px;display:flex;justify-content:flex-end;gap:10px"><button class="btn" onclick="navTo(\'inspection\')">Cancel</button><button class="btn btn-primary" id="inSaveBtn" onclick="inspSave()"><i class="fa-solid fa-check"></i> Submit</button></div>'+
  '</div>';
  inspLevelChange();
}
window.inspLevelChange=function(){
  const raw=($('inLevel')&&$('inLevel').value)||'Flat Level';
  const lvl=raw.split('::')[0];
  const show={
    'Project Level':{block:false,floor:false,flat:false},
    'Tower Level':{block:true,floor:false,flat:false},
    'Floor Level':{block:true,floor:true,flat:false},
    'Flat Level':{block:true,floor:true,flat:true}
  }[lvl]||{block:true,floor:true,flat:true};
  const set=(id,vis)=>{const el=$(id); if(el)el.style.display=vis?'':'none';};
  set('fgBlock',show.block); set('fgFloor',show.floor); set('fgFlat',show.flat);
};
/* ---- Level field: custom icon dropdown (backed by the hidden #inLevel input) ---- */
window.inspLevelDdToggle=function(ev){
  if(ev)ev.stopPropagation();
  const m=$('levelDdMenu'); if(!m)return;
  document.querySelectorAll('.insp-dd-menu.show').forEach(x=>{ if(x!==m)x.classList.remove('show'); });
  m.classList.toggle('show');
};
window.inspLevelPick=function(level,area,icon,label){
  const val=area?(level+'::'+area):level;
  const inp=$('inLevel'); if(inp)inp.value=val;
  const iconEl=$('levelDdIcon'); if(iconEl)iconEl.className='fa-solid '+icon;
  const labelEl=$('levelDdLabel'); if(labelEl)labelEl.textContent=label;
  const m=$('levelDdMenu'); if(m)m.classList.remove('show');
  inspLevelChange();
};
document.addEventListener('click',function(e){ if(!e.target.closest('.insp-dd')) document.querySelectorAll('.insp-dd-menu.show').forEach(x=>x.classList.remove('show')); });
/* ---- Component > Section checklist (New Inspection form) ----
   Place has been removed — each Work Category is now a single flat checklist.
   Every component's checklist is grouped into one or more named `sections`
   ({name, items}). Sections are purely organizational — every item in every
   section is required, same as the rest of the form. */
function inspComponentsFor(cat){ return (window.INSP_TREE||{})[cat]||[]; }
function inspAnsKey(comp,section,id){ return comp+'::'+(section||'')+'::'+id; }
function inspCompSections(comp){ return (comp.sections&&comp.sections.length)?comp.sections:[{name:null,items:comp.items||[]}]; }
function inspRequiredTotal(cat){
  let n=0;
  inspComponentsFor(cat).forEach(c=>inspCompSections(c).forEach(s=>{ n+=s.items.length; }));
  return n;
}
function inspAnsweredCount(){ return INSP_FORM_STATE?Object.values(INSP_FORM_STATE.answers).filter(Boolean).length:0; }
window.inspItems=function(){
  const cat=$('inCat').value, host=$('inItems');
  if(!cat){ INSP_FORM_STATE=null; host.innerHTML='<div class="empty" style="padding:24px">Select a work category to load its checklist.</div>'; return; }
  const comps=inspComponentsFor(cat);
  if(!comps.length){ INSP_FORM_STATE=null; host.innerHTML='<div class="empty" style="padding:24px">No checklist configured yet for '+esc(cat)+'.</div>'; return; }
  INSP_FORM_STATE={cat,answers:{}};
  inspRenderChecklist();
};
function inspRenderChecklist(){
  const st=INSP_FORM_STATE, host=$('inItems'); if(!st||!host)return;
  const comps=inspComponentsFor(st.cat);
  const total=inspRequiredTotal(st.cat), answered=inspAnsweredCount();
  const pct=total?Math.round(answered/total*100):0;
  const mkRow=(comp,secName,it)=>{
    const key=inspAnsKey(comp.name,secName,it.id), status=st.answers[key]||'';
    const mk=s=>{const sel=status===s;const cls=s==='OK'?'ok':/NOT/.test(s)?'no':'na';return '<button type="button" class="ic-btn'+(sel?' on '+cls:'')+'" data-s="'+s+'" onclick="inspPick(this)">'+s+'</button>';};
    return '<div class="insp-check" data-key="'+esc(key)+'" data-status="'+esc(status)+'"><div class="ic-main"><div class="ic-id">'+esc(it.id)+'</div><div class="ic-txt">'+esc(it.check)+(it.criteria?'<div class="ic-cri">'+esc(it.criteria)+'</div>':'')+'</div></div><div class="ic-seg">'+['OK','NOT OK','NA'].map(mk).join('')+'</div></div>';
  };
  const compsHtml=comps.map(comp=>{
    const secs=inspCompSections(comp);
    const totalCount=secs.reduce((n,s)=>n+s.items.length,0);
    const body=secs.map(s=>{
      const rowsHtml='<div class="insp-checks">'+s.items.map(it=>mkRow(comp,s.name,it)).join('')+'</div>';
      if(!s.name)return rowsHtml;
      const ansInSec=s.items.filter(it=>st.answers[inspAnsKey(comp.name,s.name,it.id)]).length;
      return '<div class="insp-sec-group"><div class="insp-sec-head">'+esc(s.name)+'<span class="insp-comp-count">'+ansInSec+' / '+s.items.length+'</span></div>'+rowsHtml+'</div>';
    }).join('');
    return '<div class="insp-comp-group"><div class="insp-comp-head">'+esc(comp.name)+'<span class="insp-comp-count">'+totalCount+' checks</span></div>'+body+'</div>';
  }).join('');
  host.innerHTML=
    '<div class="insp-progress-row"><div class="progress" style="flex:1"><span style="width:'+pct+'%"></span></div><span class="insp-progress-txt">'+answered+' / '+total+' answered</span></div>'+
    '<div style="display:flex;justify-content:flex-end;gap:8px;margin:10px 0 4px"><button type="button" class="btn btn-sm" onclick="inspBulk(\'OK\')">All OK</button><button type="button" class="btn btn-sm" onclick="inspBulk(\'\')">Clear</button></div>'+
    compsHtml;
}
window.inspPick=function(btn){
  const row=btn.closest('.insp-check'), st=btn.dataset.s;
  row.querySelectorAll('.ic-btn').forEach(b=>b.classList.remove('on','ok','no','na'));
  btn.classList.add('on', st==='OK'?'ok':/NOT/.test(st)?'no':'na');
  row.dataset.status=st;
  if(INSP_FORM_STATE){ INSP_FORM_STATE.answers[row.dataset.key]=st; inspUpdateProgress(); }
};
function inspUpdateProgress(){
  if(!INSP_FORM_STATE)return;
  const total=inspRequiredTotal(INSP_FORM_STATE.cat), answered=inspAnsweredCount();
  const bar=document.querySelector('#inItems .insp-progress-row .progress span'), txt=document.querySelector('#inItems .insp-progress-txt');
  if(bar)bar.style.width=(total?Math.round(answered/total*100):0)+'%';
  if(txt)txt.textContent=answered+' / '+total+' answered';
  // refresh per-section answered/total counters + component header counts
  document.querySelectorAll('#inItems .insp-sec-group').forEach(g=>{
    const rows=[...g.querySelectorAll('.insp-check')];
    const ans=rows.filter(r=>r.dataset.status).length;
    const tag=g.querySelector('.insp-comp-count'); if(tag)tag.textContent=ans+' / '+rows.length;
  });
}
window.inspBulk=function(st){
  if(!INSP_FORM_STATE)return;
  document.querySelectorAll('#inItems .insp-check').forEach(row=>{
    row.querySelectorAll('.ic-btn').forEach(b=>b.classList.remove('on','ok','no','na'));
    if(st){ const b=[...row.querySelectorAll('.ic-btn')].find(x=>x.dataset.s===st); if(b){b.classList.add('on',st==='OK'?'ok':'no'); row.dataset.status=st; INSP_FORM_STATE.answers[row.dataset.key]=st;} }
    else { row.dataset.status=''; delete INSP_FORM_STATE.answers[row.dataset.key]; }
  });
  inspUpdateProgress();
};
window.inspSave=async function(){
  const cat=$('inCat').value; if(!cat){toast('Select a work category','err');return;}
  const insp=($('inInsp').value||'').trim(); if(!insp){toast('Enter the inspector name','err');return;}
  if(!INSP_FORM_STATE||INSP_FORM_STATE.cat!==cat){toast('Reload the checklist for this category','err');return;}
  const comps=inspComponentsFor(cat);
  const total=inspRequiredTotal(cat), answered=inspAnsweredCount();
  if(answered<total){
    toast('Every check needs OK / Not OK / NA before you can submit — '+answered+' of '+total+' done','err');
    return;
  }
  const rawLevel=($('inLevel')&&$('inLevel').value)||'Flat Level';
  const levelParts=rawLevel.split('::'), level=levelParts[0], areaDetail=levelParts[1]||'';
  const lvlShow={
    'Project Level':{block:false,floor:false,flat:false},
    'Tower Level':{block:true,floor:false,flat:false},
    'Floor Level':{block:true,floor:true,flat:false},
    'Flat Level':{block:true,floor:true,flat:true}
  }[level]||{block:true,floor:true,flat:true};
  const project=($('inProject')&&$('inProject').value?$('inProject').value:'');
  const block=lvlShow.block?$('inBlock').value:'', floor=lvlShow.floor?$('inFloor').value:'', flat=lvlShow.flat?$('inFlat').value:'';
  const sec=($('inSec').value||'').trim(), overall=($('inOverall').value||'').trim();
  const b=$('inSaveBtn'); if(b){b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving…';}
  let photo=($('inPhoto').value||'').trim();
  const photoFile=$('inPhotoFile')&&$('inPhotoFile').files[0];
  if(photoFile){
    if(b)b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Uploading photo…';
    const {data:upData,error:upErr}=await uploadFileToS3(s3KeyForDefectImg(photoFile.name),photoFile);
    if(upErr){toast('Photo upload failed: '+upErr.message,'err'); if(b){b.disabled=false;b.innerHTML='<i class="fa-solid fa-check"></i> Submit';} return;}
    photo=upData.path;
  }
  const fkParts=[]; if(block)fkParts.push('B'+block); if(floor)fkParts.push(floor); if(flat)fkParts.push(flat); if(areaDetail)fkParts.push(areaDetail);
  const fk=fkParts.length?fkParts.join('-'):(project||level), now=new Date().toISOString();
  const rows=[];
  comps.forEach(c=>inspCompSections(c).forEach(s=>s.items.forEach(it=>{
    const status=INSP_FORM_STATE.answers[inspAnsKey(c.name,s.name,it.id)];
    if(!status)return;
    rows.push({ts:now,inspector:insp,project:project||null,block:block||null,floor:floor||null,flat:flat||null,work_category:cat,sub_area:null,component:c.name,section:s.name||null,item_id:it.id,inspection_check:it.check,status:status,remarks:sec,defect_photo:photo,overall_remark:overall,flat_key:fk,created_by:state.email,insp_level:level,area_detail:areaDetail||null});
  })));
  const {error}=await sb.schema('acc').from('inspection').insert(rows);
  if(error){toast(error.message,'err'); if(b){b.disabled=false;b.innerHTML='<i class="fa-solid fa-check"></i> Submit';} return;}
  INSP_ROWS=null; INSP_FORM_STATE=null; toast(rows.length+' checks submitted','ok'); navTo('inspection');
};
/* ---- set/change password so Google users can also use email+password ---- */
function userHasPassword(){ try{ return !(state.profile && state.profile.password_set===false); }catch(e){ return true; } }
window.setPasswordModal=function(){
  window._modalMandatory=true;
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-key"></i> Set a password</h3></div>
  <div class="modal-body frm">
    <p style="color:var(--slate);font-size:13.5px;margin-bottom:4px">Set a password so you can sign in with <b>email + password</b> as well as Google. This is required before you can continue.</p>
    <label>New password</label><input type="password" id="npw" autocomplete="new-password" placeholder="At least 6 characters">
    <label>Confirm password</label><input type="password" id="npw2" autocomplete="new-password" placeholder="Re-enter password">
  </div>
  <div class="modal-foot"><button class="btn btn-primary" id="spwBtn" onclick="setPasswordSave()"><i class="fa-solid fa-check"></i> Save password</button></div>`);
};
window.setPasswordSave=async function(){
  const p=$('npw').value, p2=$('npw2').value;
  if(!p||p.length<6){toast('Password must be at least 6 characters','err');return;}
  if(p!==p2){toast('Passwords do not match','err');return;}
  const b=$('spwBtn');if(b){b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const {error}=await sb.auth.updateUser({password:p});
  if(error){toast(error.message,'err');if(b){b.disabled=false;b.innerHTML='Save password';}return;}
  try{ await sb.schema('acc').from('user_profile').update({password_set:true}).eq('email',state.email); state.profile=Object.assign(state.profile||{},{password_set:true}); }catch(e){}
  window._modalMandatory=false;
  closeModal();toast('Password set — you can now sign in with email + password too','ok');
};
/* ---- complete a "Forgot password" reset (lands here via PASSWORD_RECOVERY after the emailed link) ---- */
window.resetPasswordModal=function(){
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-key"></i> Reset your password</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <p style="color:var(--slate);font-size:13.5px;margin-bottom:4px">Enter a new password for your JAIN-E account.</p>
    <label>New password</label><input type="password" id="rpw" autocomplete="new-password" placeholder="At least 6 characters">
    <label>Confirm password</label><input type="password" id="rpw2" autocomplete="new-password" placeholder="Re-enter password">
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="rpwBtn" onclick="resetPasswordSave()"><i class="fa-solid fa-check"></i> Save new password</button></div>`);
};
window.resetPasswordSave=async function(){
  const p=$('rpw').value, p2=$('rpw2').value;
  if(!p||p.length<6){toast('Password must be at least 6 characters','err');return;}
  if(p!==p2){toast('Passwords do not match','err');return;}
  const b=$('rpwBtn');if(b){b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const {error}=await sb.auth.updateUser({password:p});
  if(error){toast(error.message,'err');if(b){b.disabled=false;b.innerHTML='Save new password';}return;}
  try{ await sb.schema('acc').from('user_profile').update({password_set:true}).eq('email',state.email); state.profile=Object.assign(state.profile||{},{password_set:true}); }catch(e){}
  closeModal();toast('Password updated — you can sign in with it from now on','ok');
};
function promptSetPassword(){
  try{
    if(!userHasPassword()){
      setTimeout(function(){ if(typeof setPasswordModal==='function') setPasswordModal(); }, 1400);
    }
  }catch(e){}
}


boot();


/* ===== SECURITY · Credentials (admin only) ===== */
VIEWS.security=async function(v,seg){
  if(!state.super){return noAccess(v);}
  if(seg[0]==='user'){return secUserDetail(v,decodeURIComponent(seg[1]||''));}
  return secList(v);
};
async function secList(v){
  setCrumb(['Control Panel']);
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-sliders" style="color:#7c3aed"></i> Control Panel</h1><p>Approve new people and manage everyone's department, level and tab access</p></div></div><div class="card card-pad" id="secRows"><div class="loader"><div class="spin"></div></div></div>`;
  let users=[];
  try{const {data,error}=await sb.schema('adm').rpc('admin_list_users');if(error)throw error;users=data||[];}
  catch(e){$('secRows').innerHTML='<div class="empty">Could not load users: '+esc(e.message||String(e))+'</div>';return;}
  $('secRows').innerHTML=`<table class="tbl sec-tbl"><thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Level</th><th>Tabs</th><th></th></tr></thead><tbody>`+
    users.map(u=>{const pending=u.onboarded&&!u.super_admin&&!(Array.isArray(u.modules)&&u.modules.length);const valid=Array.isArray(u.modules)?u.modules.filter(m=>MODSET.has(m)):[];const noRestrict=u.modules===null||u.modules===undefined;const tabsCell=u.super_admin?'All':noRestrict?DEFAULT_MODULES.length+' (default)':valid.length===0?'0 — needs setup':valid.length>=MODLIST.length?'All':String(valid.length);return `<tr class="rowlink${pending?' pending-row':''}" onclick="navTo('security/user/'+encodeURIComponent('${esc(u.email)}'))"><td>${avatar(u.full_name)} <b>${esc(u.full_name)}</b>${u.super_admin?' <span class="tag t-purple">Admin</span>':''}${pending?' <span class="tag t-amber">New · needs setup</span>':''}</td><td style="color:var(--slate)">${esc(u.email)}</td><td>${(Array.isArray(u.department)&&u.department.length)?u.department.map(d=>avatar(d)).join(''):'—'}</td><td>${esc(u.lvl||'Employee')}</td><td>${tabsCell}</td><td style="text-align:right"><i class="fa-solid fa-chevron-right" style="color:#cbd5e1"></i></td></tr>`;}).join('')+`</tbody></table>`;
}
async function secUserDetail(v,email){
  setCrumb(['Control Panel',email]);
  v.innerHTML='<div class="loader"><div class="spin"></div></div>';
  let users=[];try{const {data}=await sb.schema('adm').rpc('admin_list_users');users=data||[];}catch(e){}
  const u=(users||[]).find(x=>x.email===email);
  if(!u){v.innerHTML='<div class="card card-pad empty">User not found</div>';return;}
  const mods=Array.isArray(u.modules)?u.modules:DEFAULT_MODULES.slice();
  SEC_DEPTS=Array.isArray(u.department)?u.department.slice():[];
  v.innerHTML=`<div class="page-head"><div><h1>${avatar(u.full_name)} ${esc(u.full_name)}</h1><p>${esc(u.email)}${u.super_admin?' · <span class="tag t-purple">Administrator</span>':''}</p></div><button class="btn" onclick="navTo('security')"><i class="fa-solid fa-arrow-left"></i> Back</button></div>
  <div class="card card-pad frm" style="max-width:780px">
    <div class="two"><div><label>Name</label><input value="${esc(u.full_name)}" disabled></div><div><label>Email</label><input value="${esc(u.email)}" disabled></div></div>
    <div class="two"><div><label>Department</label>${deptPickerHtml(SEC_DEPTS)}</div><div><label>Level</label><select id="secLevel" ${u.super_admin?'disabled':''}>${LEVELS.map(l=>'<option '+(l===(u.lvl||'Employee')?'selected':'')+'>'+l+'</option>').join('')}</select></div></div>
    <div style="border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-top:14px">
      <div style="padding:11px 16px;display:flex;align-items:center;justify-content:space-between;background:#fafbfd;border-bottom:1px solid var(--line)">
        <div style="font-weight:600;font-size:13.5px"><i class="fa-solid fa-table-cells-large" style="color:#7c3aed;margin-right:7px"></i>Module Access</div>
        ${u.super_admin?'<span style="font-size:12px;color:var(--slate)">Full access — Administrator</span>':'<div style="display:flex;gap:6px"><button type="button" class="btn btn-sm" onclick="secAllTabs(true)">Select all</button><button type="button" class="btn btn-sm" onclick="secAllTabs(false)">Clear all</button></div>'}
      </div>
      <div style="padding:14px 16px 16px">
        <div class="tab-grid">${NAV.flatMap(g=>{const gi=g.items.filter(m=>MODSET.has(m.id));if(!gi.length)return[];return['<div class="tab-grid-head">'+esc(g.group)+'</div>',...gi.map(m=>'<label class="chk-tile"><input type="checkbox" class="secMod" value="'+m.id+'" '+(mods.includes(m.id)?'checked':'')+' '+(u.super_admin?'disabled':'')+'><i class="fa-solid '+m.icon+' tile-ic"></i>'+esc(m.label)+'</label>')];}).join('')}</div>
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

async function taskScoreboard(v){
  setCrumb(['Accountability','Scoreboard']);
  v.innerHTML=taskTabs('scoreboard')+'<div class="card card-pad"><div class="loader"><div class="spin"></div></div></div>';
  await getPeople();
  let rowsRaw=[];try{const {data}=await sb.schema('acc').rpc('scoreboard');rowsRaw=data||[];}catch(e){}
  let rows=rowsRaw.map(r=>{
    const tasksTotal=(r.tasks_on_time||0)+(r.tasks_late||0);
    const punctuality=tasksTotal?Math.round((r.tasks_on_time||0)/tasksTotal*100):null;
    // Score: task closure + punctuality + checklist volume (normalised), lightly penalised for frequent due-date extensions
    const closureScore=Math.min(100,(r.tasks_completed||0)*8);
    const checklistScore=Math.min(100,(r.checklist_items_done||0)*4);
    const parts=[punctuality,closureScore,checklistScore].filter(x=>x!=null);
    let score=parts.length?Math.round(parts.reduce((a,b)=>a+b,0)/parts.length):0;
    score=Math.max(0,score-Math.min(20,(r.due_date_extensions||0)*3));
    return {name:r.full_name||nameOf(r.email),email:r.email,checklist:r.checklist_items_done||0,completed:r.tasks_completed||0,punctuality,extensions:r.due_date_extensions||0,score};
  }).sort((a,b)=>b.score-a.score);
  const bar=(val,col)=>val==null?'<span style="color:#94a3b8">—</span>':'<div style="display:flex;align-items:center;gap:8px"><div class="progress" style="flex:1;max-width:130px"><span style="width:'+val+'%;background:'+col+'"></span></div><span style="font-size:12px;color:var(--slate);min-width:34px">'+val+'%</span></div>';
  const medal=i=>i===0?'<span style="font-size:18px">🥇</span>':i===1?'<span style="font-size:18px">🥈</span>':i===2?'<span style="font-size:18px">🥉</span>':'<span style="color:var(--slate);font-weight:600">'+(i+1)+'</span>';
  v.innerHTML=taskTabs('scoreboard')+
    '<p style="color:var(--slate);font-size:13px;margin:6px 2px 14px">Score = Time Sheet items completed + tasks finished + punctuality against due dates, with a penalty for frequent due-date extensions.</p>'+
    '<div class="card"><table class="tbl"><thead><tr><th>Rank</th><th>Person</th><th>Time Sheet items done</th><th>Tasks completed</th><th>Punctuality</th><th>Due-date extensions</th><th>Score</th></tr></thead><tbody>'+
    (rows.length?rows.map((r,i)=>'<tr><td>'+medal(i)+'</td><td>'+avatar(r.name)+' <b>'+esc(r.name)+'</b></td><td>'+r.checklist+'</td><td>'+r.completed+'</td><td>'+bar(r.punctuality,'#0f766e')+'</td><td style="color:var(--slate)">'+r.extensions+'</td><td style="font-weight:700;font-size:15px">'+r.score+'</td></tr>').join(''):'<tr><td colspan="7"><div class="empty" style="padding:22px">No completed work yet</div></td></tr>')+
    '</tbody></table></div>';
}

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
  state.profile=Object.assign(state.profile||{},row);PEOPLE=null;
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


/* ===== CONSTRUCTION · project portfolio ===== */
const CONS_ONGOING=[
  {n:'Dream World City',loc:'Pailan, near IIM Joka, Kolkata',meta:'Ready to move · 1, 2 & 3 BHK',price:'₹27.5 lacs onwards',url:'https://dreamworldcity.co.in/',img:'https://thejaingroup.com/img/dream-world-city3.jpg'},
  {n:'Dream Gurukul',loc:'Madhyamgram, Doltala, Kolkata',meta:'Possession Dec 2027 · 2 & 3 BHK',price:'₹50 lacs onwards',url:'https://dreamgurukul.in/',img:'https://codingfuriosa.github.io/JainGroup/images/Dream%20Gurukul%201.jpg'},
  {n:'Dream One',loc:'New Town, Kolkata',meta:'Ready to move · 2, 3 & 4 BHK',price:'₹98 lacs onwards',url:'https://dreamone.co.in/',img:'https://codingfuriosa.github.io/JainGroup/images/Dream%20One%201.jpg'},
  {n:'Dream Eco City',loc:'Muchipara, Durgapur',meta:'Ready to move · 2, 3 & 4 BHK',price:'₹35 lacs onwards',url:'https://dreamecocity.com/',img:'https://codingfuriosa.github.io/JainGroup/images/Dream%20Eco%20City%201.jpg'},
  {n:'Dream Exotica',loc:'Kolkata',meta:'Ready to move · 1, 2 & 3 BHK',price:'Enquire for pricing',url:'https://thejaingroup.com/our-development.html',img:'https://codingfuriosa.github.io/JainGroup/images/Dream%20Exotica.jpg'},
  {n:'Dream Valley',loc:'Hill Cart Road, Siliguri',meta:'Ready to move · 3 BHK',price:'₹72 lacs onwards',url:'https://dreamvalley.net.in/',img:'https://codingfuriosa.github.io/JainGroup/images/Dream%20Valley%201.jpg'},
];
const CONS_SOLDOUT=[
  {n:'Dream Pratham',loc:'Madhyamgram, Kolkata',meta:'120 flats · 2 & 3 BHK',img:'https://codingfuriosa.github.io/JainGroup/images/Dream%20Pratham.jpg'},
  {n:'Dream Residency Manor',loc:'Kolkata',meta:'2, 3 & 4 BHK',img:'https://codingfuriosa.github.io/JainGroup/images/Dream%20Residency%20Manor.jpg'},
  {n:'Dream Excellency',loc:'Kolkata',meta:'162 flats',img:'https://codingfuriosa.github.io/JainGroup/images/Dream%20Excellency.jpg'},
  {n:'Dream Villa',loc:'Kolkata',meta:'Duplex & Triplex',img:'https://codingfuriosa.github.io/JainGroup/images/Dream%20Villa.jpg'},
  {n:'Dream Park',loc:'Kolkata',meta:'164 flats · 520–1,255 sq.ft',img:'https://codingfuriosa.github.io/JainGroup/images/Dream%20Park.jpg'},
  {n:'Dream Residency',loc:'Kolkata',meta:'135 flats · 930–1,620 sq.ft',img:'https://codingfuriosa.github.io/JainGroup/images/Dream%20Residency.jpg'},
];
VIEWS.projects=function(v){
  setCrumb(['Operations','Projects']);
  const card=(p,sold)=>`<div class="proj-card${sold?' sold':''}" ${sold?'':`onclick="window.open('${p.url}','_blank','noopener')"`}>
    <div class="proj-img" style="background-image:url('${p.img}')"><span class="proj-badge${sold?' sold':''}">${sold?'Sold Out':'Ongoing'}</span></div>
    <div class="proj-body">
      <h3>${esc(p.n)}</h3>
      <div class="proj-loc"><i class="fa-solid fa-location-dot"></i> ${esc(p.loc)}</div>
      <div class="proj-meta">${esc(p.meta)}</div>
      <div class="proj-price${sold?' sold':''}">${sold?'Sold Out':esc(p.price)}</div>
      ${sold?'<button class="btn proj-btn" disabled>Sold Out</button>':`<a class="btn btn-primary proj-btn" href="${p.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">View Project <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:11px"></i></a>`}
    </div>
  </div>`;
  v.innerHTML='<div class="page-head"><div><h1><i class="fa-solid fa-building" style="color:#1d4ed8"></i> Projects</h1><p>Ongoing developments and delivered projects across Kolkata, Siliguri & Durgapur</p></div></div>'+
    '<div class="sec-title" style="margin:4px 0 12px"><i class="fa-solid fa-circle" style="color:#16855a;font-size:8px;vertical-align:middle;margin-right:7px"></i>Ongoing Projects</div>'+
    '<div class="proj-grid">'+CONS_ONGOING.map(p=>card(p,false)).join('')+'</div>'+
    '<div class="sec-title" style="margin:28px 0 12px"><i class="fa-solid fa-circle" style="color:#c83232;font-size:8px;vertical-align:middle;margin-right:7px"></i>Sold Out</div>'+
    '<div class="proj-grid">'+CONS_SOLDOUT.map(p=>card(p,true)).join('')+'</div>';
};


/* ===== VIDEO LIBRARY ===== */
const VIDEOS=[
  // ── Training videos (open directly in YouTube) ──────────────────────────
  {t:'Dream Eco City - B',cat:'Training',yt:'hW168rf3DWg',url:'https://youtu.be/hW168rf3DWg'},
  {t:'Dream Eco City - HO',cat:'Training',yt:'Q4j5TSYPX50',url:'https://youtu.be/Q4j5TSYPX50'},
  {t:'Sales Training Pitch',cat:'Training',yt:'u5lcUE7ocwU',url:'https://youtu.be/u5lcUE7ocwU'},
  {t:'Dream Gurukul Sales Pitch',cat:'Training',yt:'tynTW_MhGLY',url:'https://www.youtube.com/watch?v=tynTW_MhGLY'},
  {t:'Dream Eco City Bungalows Pitch',cat:'Training',yt:'hW168rf3DWg',url:'https://youtu.be/hW168rf3DWg'},
  {t:'Sales Training Pitch (Oct 19)',cat:'Training',yt:'Q4j5TSYPX50',url:'https://youtu.be/Q4j5TSYPX50'},
  {t:'TagAtask Training 1',cat:'Training',yt:'t2PmvQ2RUxg',url:'https://youtu.be/t2PmvQ2RUxg'},
  {t:'TagAtask Training 2',cat:'Training',yt:'inunx2qhPCI',url:'https://youtu.be/inunx2qhPCI'},
  {t:'Training for TagAtask',cat:'Training',yt:'1QrBgnMboXE',url:'https://youtu.be/1QrBgnMboXE'},
  {t:'Hotel Bill Tracker Video',cat:'Training',yt:'E_O2VTMljcs',url:'https://youtu.be/E_O2VTMljcs'},
  {t:'Head Office Bill Tracker System',cat:'Training',yt:'hrmF_Q6FHic',url:'https://youtu.be/hrmF_Q6FHic'},
  {t:'Tele Caller Training Part 1',cat:'Training',yt:'nBp1DihUvsc',url:'https://youtu.be/nBp1DihUvsc'},
  {t:'Tele Caller Training Part 2',cat:'Training',yt:'iUR7r2nshAw',url:'https://youtu.be/iUR7r2nshAw'},
  {t:'ChatGPT Hindi',cat:'Training',yt:'Nz1MI8nsFTs',url:'https://youtu.be/Nz1MI8nsFTs'},
  // ── WalkThrough videos ───────────────────────────────────────────────────
  {t:'Dream Gurukul',cat:'WalkThrough',yt:'4bWFJfU5AYg',url:'https://youtu.be/4bWFJfU5AYg?list=PLYy3u2uXULpWE5EzepbEQ5IcBWJaCYUWE'},
  {t:'Dream World City',cat:'WalkThrough',yt:'2hUcUUbF_1k',url:'https://youtu.be/2hUcUUbF_1k?list=PLYy3u2uXULpVxlLWwmLfW36kHn8j2gKcr'},
  {t:'Dream One',cat:'WalkThrough',yt:'YEHL1Wi16d0',url:'https://youtu.be/YEHL1Wi16d0?list=PLYy3u2uXULpV91mBBQeJFAQq5zyWcTQB9'},
  {t:'Dream Valley',cat:'WalkThrough',yt:'v43BAzo-Ric',url:'https://youtu.be/v43BAzo-Ric?list=PLYy3u2uXULpV5xDmsOWOw8cmctDH07LZm'},
  {t:'Dream Eco City',cat:'WalkThrough',yt:'mOymoLR5nro',url:'https://youtu.be/mOymoLR5nro?list=PLYy3u2uXULpX1O7WknBnY7v61xr9EW_wC'}
];
VIEWS.video=function(v,seg){
  setCrumb(['Knowledge','Video Library']);
  const tabs=['All Videos','Training','Youtube','WalkThrough'];
  let ti=parseInt(seg&&seg[0]); if(isNaN(ti)||ti<0||ti>=tabs.length)ti=0;
  const tname=tabs[ti];
  const list=ti===0?VIDEOS:VIDEOS.filter(x=>x.cat===tname);
  const tabbar='<div class="tabs">'+tabs.map((t,i)=>'<div class="tab '+(i===ti?'active':'')+'" onclick="navTo(\'video/'+i+'\')">'+esc(t)+'</div>').join('')+'</div>';
  function vidCard(x){
    const ytOpen=(x.cat==='Youtube'||x.cat==='WalkThrough'||x.cat==='Training');
    const ytUrl=x.url||('https://www.youtube.com/watch?v='+x.yt);
    const badge=ytOpen?'<span style="position:absolute;top:8px;right:8px;background:#ff0000;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;letter-spacing:.4px;line-height:1.6"><i class=\"fa-brands fa-youtube\"></i> YouTube</span>':'';
    const thumbUrl=x.yt?('https://img.youtube.com/vi/'+x.yt+'/hqdefault.jpg'):'';const thumbStyle=thumbUrl?'background-image:url('+thumbUrl+')':'background:#0a2640';const thumbInner=thumbUrl?'<span class="vid-play"><i class="fa-solid fa-play"></i></span>'+badge:'<span style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px"><i class="fa-brands fa-youtube" style="color:#ff0000;font-size:38px"></i><span style="color:#fff;font-size:11px;font-weight:600;letter-spacing:.5px;opacity:.8">PLAYLIST</span></span>';const thumb='<div class="vid-thumb" style="'+thumbStyle+'">'+thumbInner+'</div>';
    const meta='<div class="vid-meta"><div class="vid-title">'+esc(x.t)+'</div><div class="vid-cat"><i class="fa-brands fa-youtube" style="color:#ff0000"></i> '+esc(x.cat)+'</div></div>';
    // Use <a> tag for YouTube — anchor clicks are never blocked by popup blockers
    if(ytOpen) return '<a class="vid-card" href="'+ytUrl+'" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:block">'+thumb+meta+'</a>';
    return '<div class="vid-card" onclick="vidPlay(\''+x.yt+'\',\''+esc(x.t).replace(/'/g,'\\x27')+'\')">'+thumb+meta+'</div>';
  }
  const grid=list.length?'<div class="vid-grid">'+list.map(vidCard).join('')+'</div>':'<div class="card card-pad empty" style="margin-top:0"><i class="fa-regular fa-circle-play"></i><div style="font-weight:600;color:var(--ink)">No videos in '+esc(tname)+' yet</div><p style="max-width:380px;margin:6px auto 0">Videos added to this section will appear here.</p></div>';
  v.innerHTML='<div class="page-head"><div><h1><i class="fa-solid fa-clapperboard" style="color:#be123c"></i> Video Library</h1><p>Training videos, project walkthroughs & recorded sessions</p></div></div>'+tabbar+grid;
};
window.vidPlay=function(yt,title){ openModal('<div class="modal-head"><h3><i class="fa-brands fa-youtube" style="color:#ff0000"></i> '+esc(title)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body" style="padding:0;background:#000"><div style="position:relative;padding-bottom:56.25%;height:0"><iframe src="https://www.youtube.com/embed/'+yt+'?autoplay=1&rel=0" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe></div></div>','lg'); };

/* ===== reference-matched module builders ===== */
function mTabs(id,tabs,ti){return '<div class="tabs">'+tabs.map((t,i)=>'<div class="tab '+(i===ti?'active':'')+'" onclick="navTo(\''+id+'/'+i+'\')">'+esc(t)+'</div>').join('')+'</div>';}
function mKpis(arr){return '<div class="grid kpis" style="grid-template-columns:repeat('+arr.length+',1fr)">'+arr.map(k=>'<div class="kpi"><div class="lbl" style="margin-bottom:7px">'+esc(k[0])+'</div><div class="val">'+esc(k[1])+'</div><div style="font-size:12px;color:'+(k[3]||'var(--slate)')+';margin-top:3px">'+esc(k[2]||'')+'</div></div>').join('')+'</div>';}
function mStep(steps,active){const ai=steps.indexOf(active);return '<div class="mstep">'+steps.map((s,i)=>'<span class="mstep-i'+(s===active?' on':(i<ai?' done':''))+'">'+esc(s)+'</span>'+(i<steps.length-1?'<span class="mstep-a">→</span>':'')).join('')+'</div>';}
function mFunnel(items){const max=Math.max.apply(null,items.map(x=>x[1]));return '<div class="mfunnel">'+items.map(x=>'<div class="mfunnel-r"><div class="mfunnel-bar" style="width:'+Math.max(20,Math.round(x[1]/max*100))+'%">'+esc(x[0])+'</div><span class="mfunnel-v">'+x[1]+'</span></div>').join('')+'</div>';}
function mTable(cols,rows){return '<div class="card qc-table-card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+cols.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+(String(c).slice(0,6)==='<span'?c:esc(c))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></div>';}
function mCard(title,inner){return '<div class="card card-pad"><div class="sec-title" style="margin:0 0 12px">'+esc(title)+'</div>'+inner+'</div>';}
function mHead(icon,color,title){return '<div class="page-head"><div><h1><i class="fa-solid '+icon+'" style="color:'+color+'"></i> '+esc(title)+'</h1></div></div>';}
function mTab(seg,n){let t=parseInt(seg&&seg[0]);return (isNaN(t)||t<0||t>=n)?0:t;}
function mSoon(name){return '<div class="card card-pad empty" style="margin-top:14px"><i class="fa-regular fa-clipboard"></i><div style="font-weight:600;color:var(--ink)">'+esc(name)+'</div><p style="max-width:420px;margin:6px auto 0">This section is being built to match the reference.</p></div>';}

VIEWS.gtd=function(v,seg){
  setCrumb(['Sales','GTD']);
  const tabs=['Inbox','Next actions','Projects','Waiting for','Someday / Maybe','Weekly review'];const ti=mTab(seg,tabs.length);
  const kpis=[['Inbox to clarify','5','capture is clean','#16855a'],['Next actions','14','across 5 contexts'],['Active projects','6','each has a next step'],['Waiting for','4','oldest 9 days','#e08600']];
  let body;
  if(ti===0){
    body='<div class="card card-pad"><p style="color:var(--slate);font-size:13px;margin-bottom:12px">Capture first, decide later. Each item gets clarified into a next action, project, waiting-for, someday, or done.</p><div style="display:flex;gap:10px;margin-bottom:14px"><input class="sel" style="flex:1;height:42px" placeholder="Capture anything on your mind…"><button class="btn btn-primary"><i class="fa-solid fa-plus"></i> Capture</button></div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Captured item</th><th>Clarify into</th></tr></thead><tbody>'+
      ['Idea: loyalty referral scheme for buyers','Mr. Agarwal asked about parking — follow up','Broker agreement template needs legal review'].map(it=>'<tr><td>'+esc(it)+'</td><td><div style="display:flex;gap:6px;flex-wrap:wrap">'+['Next action','Project','Waiting','Someday','Done'].map(b=>'<button class="btn btn-sm">'+b+'</button>').join('')+'</div></td></tr>').join('')+'</tbody></table></div></div>';
  } else if(ti===1){ body=mTable(['Next action','Context','Project','Due'],[['Call structural consultant','@calls','Dream Valley','Today'],['Finalise RERA filing','@office','Skyline','Tomorrow']]); }
  else if(ti===2){ body=mTable(['Project','Next step','Owner','Status'],[['Riverdale launch','Approve creatives','You','Active'],['Vendor portal','Spec sign-off','Ops','Active']]); }
  else if(ti===3){ body=mTable(['Waiting on','Item','Since','Follow-up'],[['Geotech lab','Soil report','3 days','Tomorrow'],['HDFC','Loan sanction','1 wk','Fri']]); }
  else if(ti===4){ body=mTable(['Idea','Area','Added'],[['Clubhouse revamp','Skyline','Jun 26'],['EV charging','All sites','Jun 26']]); }
  else { body=mTable(['Review step','Status'],[['Clear inbox','Done'],['Review next actions','Pending'],['Review projects','Pending']]); }
  v.innerHTML=mHead('fa-brain','#7c3aed','GTD')+mKpis(kpis)+mTabs('gtd',tabs,ti)+'<div style="margin-top:14px">'+body+'</div>';
};

VIEWS.crm=function(v,seg){
  setCrumb(['Sales','CRM & Sales']);
  const tabs=['Pipeline & funnel','Leads','Bookings','Directory & hierarchy','Comm history','Demands & collections','Brokers','Post-sale'];const ti=mTab(seg,tabs.length);
  let body;
  if(ti===0){
    const funnel=mCard('Conversion funnel (this quarter)',mFunnel([['Leads',428],['Contacted',286],['Site visit',171],['Negotiation',98],['Booking',61],['Agreement',47],['Registered',38]]));
    const ageing=mCard('Stage ageing','<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Stage</th><th>Avg days in stage</th><th>Oldest</th></tr></thead><tbody>'+[['Contacted','3.1 d','11 d'],['Site visit','6.4 d','19 d'],['Negotiation','9.8 d','27 d'],['Booking','4.2 d','14 d']].map(r=>'<tr><td>'+r[0]+'</td><td>'+r[1]+'</td><td>'+r[2]+'</td></tr>').join('')+'</tbody></table></div>');
    body='<div class="m2grid">'+funnel+ageing+'</div>';
  } else if(ti===1){ body=mTable(['Lead','Project','Stage','Owner','Value'],[['Rahul Mehta','Dream Valley','Site visit','You','₹85L'],['Priya Shah','Dream One','Negotiation','You','₹1.1Cr']]); }
  else if(ti===2){ body=mTable(['Customer','Unit','Date','Value','Status'],[['Amit Patel','DV A-905','24 Jun','₹92L','Confirmed']]); }
  else if(ti===4){ body=mTable(['Lead','Channel','Last contact','Note'],[['Rahul Mehta','Call','Today','Site visit booked']]); }
  else if(ti===5){ body=mTable(['Customer','Demand','Due','Amount','Status'],[['Rahul Mehta','On RCC F10','30 Jun','₹4.2L','Pending']]); }
  else if(ti===6){ body=mTable(['Broker','Deals','Commission','Status'],[['Skyline Realty','12','₹6.2L','Active']]); }
  else { body=mSoon(tabs[ti]); }
  v.innerHTML=mHead('fa-handshake','#7c3aed','CRM & Sales')+mTabs('crm',tabs,ti)+'<div style="margin-top:16px">'+body+'</div>';
};

/* ============================ POST SALES — ADHOC bulk replace ============================
   Converted output files upload to S3 (postsales/adhoc/...) and the conversion record (file
   name, replacement count, uploader, timestamp) is stored in postsales.adhoc_docs — a shared,
   company-wide log: everyone with Post Sales access sees everyone else's conversions, not just
   their own, and can download/preview them anytime via a signed URL. Upload -> replace "adhoc"
   (any case) with "Contracted Extra Charges" in the browser (JSZip for .docx, pdf.js+pdf-lib for
   .pdf) -> upload the result to S3 -> record it -> preview (mammoth.js / embedded PDF) or
   download. */
let PSA_SEQ=1;
const PSA={queue:[],loaded:false};
async function psaFetchAll(){
  try{
    const {data,error}=await sb.schema('postsales').from('adhoc_docs').select('*').order('created_at',{ascending:false});
    if(error||!data) return [];
    return data.map(function(d){
      return {
        id:d.id,name:d.file_name,size:d.size_bytes||0,count:d.replacements_count||0,
        status:d.status,error:d.error_text||'',
        ts:d.created_at?new Date(d.created_at).getTime():Date.now(),
        s3Path:d.s3_path||null,uploadedBy:d.uploaded_by||'',blob:null
      };
    });
  }catch(e){ return []; }
}
VIEWS.postsales=async function(v,seg){
  setCrumb(['Sales','Post Sales']);
  const tabs=[['adhoc','ADHOC']];
  const tab=(seg&&seg[0])||'adhoc';
  v.innerHTML=mHead('fa-headset','#7e22ce','Post Sales')
    +'<div class="tabs" style="margin-top:14px">'+tabs.map(function(t){return '<div class="tab '+(tab===t[0]?'active':'')+'" onclick="navTo(\'postsales/'+t[0]+'\')">'+t[1]+'</div>';}).join('')+'</div>'
    +'<div id="psaBody" style="margin-top:16px"></div>';
  if(tab==='adhoc'){
    const host=$('psaBody'); if(host) loader(host);
    PSA.queue=await psaFetchAll();
    PSA.queue.forEach(function(r){ if(typeof r.id==='number'&&r.id>=PSA_SEQ) PSA_SEQ=r.id+1; });
    PSA.loaded=true;
    psaRender();
  }
};
function psaRender(){
  const host=$('psaBody'); if(!host)return;
  const rows=PSA.queue;
  const processed=rows.filter(function(r){return r.status==='done';}).length;
  const totalRepl=rows.reduce(function(s,r){return s+(r.count||0);},0);
  const failed=rows.filter(function(r){return r.status==='error';}).length;
  const kpis=mKpis([
    ['All Time',String(processed),'documents processed'],
    ['"ADHOC" Replaced',String(totalRepl),'to "Contracted Extra Charges" · all time'],
    ['Failed',String(failed),failed?'check & re-upload':'all clear',failed?'#dc2626':'#16a34a'],
  ]);
  const toolbar='<div class="toolbar psa-toolbar">'
    +'<div class="psa-hint"><i class="fa-solid fa-shield-halved"></i> Converted files are saved to a shared Post Sales folder — visible to everyone with Post Sales access, downloadable anytime. Removing a row deletes it for everyone (and from S3).</div>'
    +'<button class="btn" id="psaBulkDl" '+(rows.length?'':'disabled')+' onclick="psaDownloadAllZip()"><i class="fa-solid fa-file-zipper"></i> Download All'+(rows.length>1?' (ZIP)':'')+'</button>'
    +'<button class="btn btn-primary" onclick="psaUploadModal()"><i class="fa-solid fa-upload"></i> Upload Documents</button>'
    +'</div>';
  const body=rows.length?rows.map(psaRowHtml).join(''):'<tr><td colspan="6"><div class="empty"><i class="fa-regular fa-file-word"></i><div>No documents processed yet</div><button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="psaUploadModal()"><i class="fa-solid fa-upload"></i> Upload documents</button></div></td></tr>';
  host.innerHTML=kpis+toolbar+'<div class="card psa-card"><div style="overflow-x:auto"><table class="tbl psa-tbl"><thead><tr>'
    +'<th>Document</th><th>Uploaded by</th><th>Replacements</th><th>Size</th><th>Status</th><th></th>'
    +'</tr></thead><tbody>'+body+'</tbody></table></div></div>';
}
function psaExt(name){return (String(name||'').split('.').pop()||'').toLowerCase();}
function psaRowHtml(r){
  const statusTag=r.status==='error'
    ? '<span class="tag t-red" title="'+esc(r.error||'Error')+'"><i class="fa-solid fa-circle-exclamation"></i> Error</span>'
    : '<span class="tag t-green"><i class="fa-solid fa-circle-check"></i> Ready</span>';
  const hasFile=!!(r.blob||r.s3Path);
  return '<tr>'
    +'<td><div style="display:flex;align-items:center;gap:9px"><i class="fa-solid '+(psaExt(r.name)==='pdf'?'fa-file-pdf" style="color:#dc2626;font-size:18px"':'fa-file-word" style="color:#2563eb;font-size:18px"')+'></i><div class="psa-fname" id="psaName_'+r.id+'" title="'+esc(r.name)+'">'+esc(r.name)+'</div><button class="btn btn-sm btn-ghost psa-rename-btn" title="Rename" onclick="psaRenameStart('+r.id+')"><i class="fa-solid fa-pen"></i></button></div></td>'
    +'<td class="psa-uploader" title="'+esc(r.uploadedBy||'')+'">'+esc((r.uploadedBy||'').split('@')[0]||'—')+'</td>'
    +'<td>'+(r.count?('<span class="tag t-blue">'+r.count+' replaced</span>'):'<span style="color:var(--slate)">—</span>')+'</td>'
    +'<td>'+fmtBytes(r.size)+'</td>'
    +'<td>'+statusTag+(r.status==='done'&&!hasFile?'<div class="psa-expired">Upload failed to save — re-upload</div>':'')+'</td>'
    +'<td class="psa-row-actions">'
      +(r.status==='done'&&hasFile?'<button class="btn btn-sm btn-ghost" title="Preview" onclick="psaPreview('+r.id+')"><i class="fa-solid fa-eye"></i></button>':'')
      +(r.status==='done'&&hasFile?'<button class="btn btn-sm btn-ghost" title="Download" onclick="psaDownloadOne('+r.id+')"><i class="fa-solid fa-download"></i></button>':'')
      +'<button class="btn btn-sm btn-ghost" title="Remove" onclick="psaRemove('+r.id+')"><i class="fa-solid fa-trash"></i></button>'
    +'</td></tr>';
}
function psaSplitExt(name){
  const s=String(name||''); const i=s.lastIndexOf('.');
  if(i<=0) return [s,'']; return [s.slice(0,i), s.slice(i)];
}
window.psaRenameStart=function(id){
  const r=psaFind(id); if(!r)return;
  const cell=$('psaName_'+id); if(!cell)return;
  const parts=psaSplitExt(r.name);
  cell.innerHTML='<input type="text" id="psaRenameInput_'+id+'" class="psa-rename-input" value="'+esc(parts[0])+'">'
    +'<span class="psa-rename-ext">'+esc(parts[1])+'</span>';
  const inp=$('psaRenameInput_'+id); if(!inp)return;
  inp.focus(); inp.select();
  inp.addEventListener('keydown',function(e){
    if(e.key==='Enter'){ e.preventDefault(); psaRenameSave(id); }
    else if(e.key==='Escape'){ e.preventDefault(); psaRender(); }
  });
  inp.addEventListener('blur',function(){ psaRenameSave(id); });
};
window.psaRenameSave=async function(id){
  const r=psaFind(id); if(!r){ psaRender(); return; }
  const inp=$('psaRenameInput_'+id);
  if(inp){
    const parts=psaSplitExt(r.name);
    const base=String(inp.value||'').trim();
    if(base){
      const newName=base+parts[1];
      r.name=newName;
      try{ await sb.schema('postsales').from('adhoc_docs').update({file_name:newName}).eq('id',id); }catch(e){}
    }
  }
  psaRender();
};
window.psaRemove=async function(id){
  const r=psaFind(id);
  PSA.queue=PSA.queue.filter(function(x){return x.id!==id;});
  psaRender();
  if(r){
    try{ await sb.schema('postsales').from('adhoc_docs').delete().eq('id',id); }catch(e){}
    if(r.s3Path) s3Delete(r.s3Path);
  }
};
function psaFind(id){ return PSA.queue.find(function(r){return r.id===id;}); }
async function psaGetBlob(r){
  if(r.blob) return r.blob;
  if(!r.s3Path) return null;
  try{
    const key=r.s3Path.slice(3);
    const {data,error}=await s3Sign('get',key);
    if(error||!data) return null;
    const resp=await fetch(data.url);
    if(!resp.ok) return null;
    const blob=await resp.blob();
    r.blob=blob;
    return blob;
  }catch(e){ return null; }
}
window.psaDownloadOne=async function(id){
  const r=psaFind(id); if(!r)return;
  const blob=await psaGetBlob(r);
  if(!blob){ toast('Could not retrieve this file','err'); return; }
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=r.name; document.body.appendChild(a); a.click(); a.remove();
};
window.psaDownloadAllZip=async function(){
  const rows=PSA.queue.filter(function(r){return r.status==='done'&&(r.blob||r.s3Path);});
  if(!rows.length){toast('Nothing to download','warn');return;}
  if(rows.length===1){ psaDownloadOne(rows[0].id); return; }
  const JZ=await loadJSZip(); if(!JZ){toast('ZIP library failed to load','err');return;}
  const zip=new JZ(); const used={};
  for(const r of rows){
    const blob=await psaGetBlob(r); if(!blob)continue;
    let name=r.name;
    if(used[name]!=null){ used[name]++; name=name.replace(/(\.[^.]+)?$/,'_'+used[name]+'$1'); } else used[name]=0;
    zip.file(name,blob);
  }
  const out=await zip.generateAsync({type:'blob'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(out); a.download='adhoc-contracted-extra-charges.zip'; document.body.appendChild(a); a.click(); a.remove();
};
window.psaPreview=async function(id){
  const r=psaFind(id); if(!r)return;
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-eye"></i> '+esc(r.name)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body" id="psaPreviewBody" style="max-height:70vh;overflow:auto;padding:'+(psaExt(r.name)==='pdf'?'0':'')+'"><div class="loader"><div class="spin"></div></div></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button><button class="btn btn-primary" onclick="psaDownloadOne('+id+')"><i class="fa-solid fa-download"></i> Download</button></div>','lg');
  const el=$('psaPreviewBody'); if(!el)return;
  const blob=await psaGetBlob(r);
  if(!blob){ el.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not retrieve this file</div></div>'; return; }
  if(psaExt(r.name)==='pdf'){
    const url=URL.createObjectURL(blob);
    el.innerHTML='<embed src="'+url+'" type="application/pdf" style="width:100%;height:70vh;border:0">';
    return;
  }
  try{
    const MM=await loadMammoth();
    if(!MM){ el.innerHTML='<div class="empty"><i class="fa-regular fa-file-word"></i><div>Preview unavailable — download to view</div></div>'; return; }
    const buf=await blob.arrayBuffer();
    const result=await MM.convertToHtml({arrayBuffer:buf});
    el.innerHTML='<div class="psa-preview-doc">'+result.value+'</div>';
  }catch(e){ el.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not render preview</div></div>'; }
};
window.psaUploadModal=function(){
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-upload"></i> Upload documents — ADHOC replace</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm">'
    +'<div class="dropzone" ondragover="event.preventDefault()" ondrop="psaDrop(event)" onclick="document.getElementById(\'psaFile\').click()"><i class="fa-solid fa-cloud-arrow-up"></i><div id="psaUpName">Drag & drop or click to select Word or PDF documents</div><div style="font-size:12px;margin-top:4px">.docx and .pdf · up to 500 at once · every "ADHOC" (any case) becomes "Contracted Extra Charges" · converted file is saved to your Post Sales S3 folder</div></div>'
    +'<input type="file" id="psaFile" class="hidden" multiple accept=".docx,.pdf" onchange="psaUpPick()">'
    +'<div id="psaUpList" style="margin-top:10px"></div>'
    +'</div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="psaUpBtn" onclick="psaUploadStart()" disabled><i class="fa-solid fa-wand-magic-sparkles"></i> Process</button></div>','lg');
};
window.psaDrop=function(ev){
  ev.preventDefault();
  const dt=ev.dataTransfer; if(!dt||!dt.files||!dt.files.length)return;
  const inp=$('psaFile'); if(!inp)return;
  const buf=new DataTransfer();
  [...dt.files].forEach(function(f){buf.items.add(f);});
  inp.files=buf.files;
  psaUpPick();
};
window.psaUpPick=function(){
  const fs=[...$('psaFile').files];
  const supported=fs.filter(function(f){return /\.(docx|pdf)$/i.test(f.name);});
  const unsupported=fs.length-supported.length;
  $('psaUpName').textContent=fs.length?(fs.length+' file(s) selected'):'Drag & drop or click to select Word or PDF documents';
  let notes='';
  if(unsupported) notes+='<div class="tag t-red" style="margin-bottom:8px"><i class="fa-solid fa-triangle-exclamation"></i> '+unsupported+' file(s) are not .docx or .pdf and will be skipped</div>';
  $('psaUpList').innerHTML=notes;
  const btn=$('psaUpBtn'); if(btn) btn.disabled=!supported.length;
};
window.psaUploadStart=async function(){
  const fs=[...$('psaFile').files].filter(function(f){return /\.(docx|pdf)$/i.test(f.name);});
  if(!fs.length){toast('Select at least one .docx or .pdf file','err');return;}
  const btn=$('psaUpBtn'); btn.disabled=true;
  const listHost=$('psaUpList');
  let done=0, ok=0, fail=0;
  const total=fs.length;
  const renderProgress=function(current){
    if(!listHost)return;
    listHost.innerHTML='<div class="psa-progress"><div class="psa-progress-bar"><div class="psa-progress-fill" style="width:'+Math.round(done/total*100)+'%"></div></div>'
      +'<div class="psa-progress-label">Processing '+done+' of '+total+' — '+ok+' done'+(fail?(', '+fail+' failed'):'')+(current?('<br><span style="color:var(--slate)">'+esc(current)+'</span>'):'')+'</div></div>';
  };
  renderProgress('');
  const CONCURRENCY=4;
  let idx=0;
  async function worker(){
    while(idx<fs.length){
      const my=idx++; const f=fs[my];
      renderProgress(f.name);
      const rec={id:null,name:f.name,size:f.size,blob:null,count:0,status:'error',error:'',s3Path:null,uploadedBy:''};
      try{
        const out=await psaProcessOne(f);
        rec.blob=out.blob; rec.size=out.blob.size; rec.count=out.count; rec.status='done';
        ok++;
        try{
          const key=s3KeyForPostSalesAdhoc(f.name);
          const up=await uploadFileToS3(key,out.blob);
          if(up&&up.data&&up.data.path) rec.s3Path=up.data.path;
        }catch(e){ /* best-effort — row still usable for this session via the in-memory blob */ }
      }catch(e){ rec.error=String((e&&e.message)||e); fail++; }
      rec.ts=Date.now();
      try{
        const {data}=await sb.schema('postsales').from('adhoc_docs').insert({
          file_name:rec.name,s3_path:rec.s3Path,replacements_count:rec.count,
          size_bytes:rec.size,status:rec.status,error_text:rec.error||null
        }).select('id,uploaded_by,created_at').single();
        if(data){
          rec.id=data.id; rec.uploadedBy=data.uploaded_by||'';
          rec.ts=data.created_at?new Date(data.created_at).getTime():rec.ts;
        }
      }catch(e){ /* row still shows for this session even if the shared record failed to save */ }
      if(rec.id==null) rec.id=PSA_SEQ++;
      PSA.queue.unshift(rec);
      done++;
      renderProgress('');
    }
  }
  await Promise.all(Array.from({length:Math.min(CONCURRENCY,fs.length)},worker));
  toast(ok+' document'+(ok!==1?'s':'')+' processed'+(fail?(', '+fail+' failed'):''),fail?'warn':'ok');
  closeModal();
  psaRender();
};
function psaReplaceInXml(xml){
  let count=0;
  const wordRe=/\badhoc\b/gi;
  const decode=function(s){return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');};
  const encode=function(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');};
  const newXml=xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g,function(pBlock){
    const tRe=/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g;
    let m, matches=[];
    while((m=tRe.exec(pBlock))){ matches.push({attrs:m[1],inner:m[2],index:m.index,len:m[0].length}); }
    if(!matches.length)return pBlock;
    const combined=matches.map(function(x){return decode(x.inner);}).join('');
    wordRe.lastIndex=0;
    if(!wordRe.test(combined))return pBlock;
    wordRe.lastIndex=0;
    const localMatches=combined.match(wordRe)||[];
    count+=localMatches.length;
    const replaced=combined.replace(wordRe,'Contracted Extra Charges');
    let result='',cursor=0;
    matches.forEach(function(mt,i){
      result+=pBlock.slice(cursor,mt.index);
      let attrs=mt.attrs;
      if(!/xml:space=/.test(attrs)) attrs=attrs+' xml:space="preserve"';
      if(i===0) result+='<w:t'+attrs+'>'+encode(replaced)+'</w:t>';
      else result+='<w:t'+attrs+'></w:t>';
      cursor=mt.index+mt.len;
    });
    result+=pBlock.slice(cursor);
    return result;
  });
  return {xml:newXml,count:count};
}
async function psaProcessOne(file){
  return psaExt(file.name)==='pdf' ? psaProcessPdf(file) : psaProcessDocx(file);
}
async function psaProcessDocx(file){
  const JZ=await loadJSZip();
  if(!JZ) throw new Error('ZIP library failed to load');
  const buf=await file.arrayBuffer();
  const zip=await JZ.loadAsync(buf);
  const targets=Object.keys(zip.files).filter(function(p){return /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(p);});
  let total=0;
  for(const path of targets){
    const xml=await zip.files[path].async('string');
    const out=psaReplaceInXml(xml);
    if(out.count){ zip.file(path,out.xml); total+=out.count; }
  }
  const blob=await zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',compression:'DEFLATE'});
  return {blob:blob,count:total};
}
// PDF has no reflow like Word does, so "replacement" here is a visual redact + overlay:
// each pdf.js text item containing "adhoc" is whited out ENTIRELY and redrawn with the
// reconstructed string (original text, every "adhoc" occurrence replaced), using a bold or
// regular weight to match what the original item actually looked like (a bold "Adhoc" that
// got redrawn in plain Helvetica used to visibly lose its weight). When the longer replacement
// doesn't fit before a real neighboring item on the same row, it is NOT crammed in by shrinking
// the font (that reads as cramped/too-close text) — instead it word-wraps onto extra line(s)
// below, at the ORIGINAL font size, same as the line above; that wrapped text keeps the same
// bold/regular weight decision as the single-line case. Wrapping is only used when the space
// below is actually clear of real content; if something genuine is sitting there (so wrapping
// would draw over it), that's the one case font-shrink is still used as a fallback, since
// overwriting unrelated real content is worse than a slightly smaller word.
async function psaProcessPdf(file){
  const pdfjsLib=await loadPdfJs();
  const PDFLibMod=await loadPdfLib();
  if(!pdfjsLib||!PDFLibMod) throw new Error('PDF library failed to load');
  const buf=await file.arrayBuffer();
  const pdf=await pdfjsLib.getDocument({data:buf.slice(0)}).promise;
  const pdfDoc=await PDFLibMod.PDFDocument.load(buf);
  const fontRegular=await pdfDoc.embedFont(PDFLibMod.StandardFonts.Helvetica);
  const fontBold=await pdfDoc.embedFont(PDFLibMod.StandardFonts.HelveticaBold);
  const NEW_TEXT='Contracted Extra Charges';
  let total=0;
  const n=pdf.numPages;
  function isBoldItem(page,item){
    try{
      const fo=page.commonObjs.get(item.fontName);
      if(!fo)return false;
      if(fo.bold||fo.black)return true;
      const nm=String(fo.name||fo.fallbackName||'').toLowerCase();
      return /bold|black|semibold|heavy/.test(nm);
    }catch(e){ return false; }
  }
  function rowTolFor(a,b){ return Math.max(4,a*0.9,b*0.9); }
  function wrapToWidth(text,size,maxWidth,fnt){
    const words=text.split(' ');
    const lines=[]; let cur='';
    for(const w of words){
      const test=cur?cur+' '+w:w;
      if(!cur||fnt.widthOfTextAtSize(test,size)<=maxWidth){ cur=test; }
      else { lines.push(cur); cur=w; }
    }
    if(cur) lines.push(cur);
    return lines;
  }
  for(let i=1;i<=n;i++){
    const page=await pdf.getPage(i);
    const content=await page.getTextContent();
    const pdfPage=pdfDoc.getPage(i-1);
    const items=content.items;
    for(let idx=0;idx<items.length;idx++){
      const item=items[idx];
      const str=item.str||'';
      const matches=str.match(/adhoc/gi);
      if(!matches)continue;
      total+=matches.length;
      const newStr=str.replace(/adhoc/gi,NEW_TEXT);
      const font=isBoldItem(page,item)?fontBold:fontRegular;
      const tr=item.transform;
      const fontSize=Math.hypot(tr[2],tr[3])||10;
      const x0=tr[4];
      const y0=tr[5];
      const oldW=item.width||font.widthOfTextAtSize(str,fontSize);
      // nearest real text item to the right on the same visual row — caps how wide we can safely draw
      let limitX=null;
      for(let j=0;j<items.length;j++){
        if(j===idx)continue;
        const o=items[j];
        if(!o.str||!o.str.trim())continue;
        const otr=o.transform;
        const oFontSize=Math.hypot(otr[2],otr[3])||fontSize;
        if(Math.abs(otr[5]-y0)>rowTolFor(fontSize,oFontSize))continue;
        if(otr[4]<=x0)continue;
        if(limitX===null||otr[4]<limitX) limitX=otr[4];
      }
      const requiredGap=Math.max(15,fontSize*2.2);
      const budget=limitX!==null?Math.max(oldW,(limitX-x0)-requiredGap):oldW*5;
      const fullW=font.widthOfTextAtSize(newStr,fontSize);
      const lineHeight=fontSize*1.25;
      let size=fontSize, lines=[newStr];
      if(fullW>budget){
        const wrapped=wrapToWidth(newStr,fontSize,budget,font);
        // always prefer wrapping at the ORIGINAL font size over shrinking — the only time that's
        // not possible is an unbreakable single word wider than the budget, with no space to wrap on
        if(wrapped.length>1){ lines=wrapped; }
        else { size=Math.max(fontSize*0.45,fontSize*(budget/fullW)); lines=[newStr]; }
      }
      const maxLineW=Math.max(oldW, lines.reduce(function(m,l){return Math.max(m,font.widthOfTextAtSize(l,size));},0));
      const rectTop=y0+fontSize*0.95;
      const rectBottom=y0-fontSize*0.28-lineHeight*(lines.length-1);
      pdfPage.drawRectangle({x:x0-1,y:rectBottom,width:maxLineW+2,height:rectTop-rectBottom,color:PDFLibMod.rgb(1,1,1)});
      lines.forEach(function(ln,k){
        pdfPage.drawText(ln,{x:x0,y:y0-lineHeight*k,size:size,font:font,color:PDFLibMod.rgb(0,0,0)});
      });
    }
  }
  const outBytes=await pdfDoc.save();
  const blob=new Blob([outBytes],{type:'application/pdf'});
  return {blob:blob,count:total};
}

VIEWS.inventory=function(v,seg){
  setCrumb(['Operations','Inventory']);
  const tabs=['Indents & RFQ','Quote comparison','Purchase orders','GRN & QC','Stock ledger','Accounts payable'];const ti=mTab(seg,tabs.length);
  let body;
  if(ti===0){
    body=mStep(['Indent','RFQ','Quote compare','PO + approval','Gate entry','GRN + QC','Stock'],'Quote compare')+
      mTable(['Indent','Material','Qty','Project','Source','RFQ status'],[['IND-0512','OPC 53 cement','400 bags','Dream Valley','Auto (reorder)','<span class="tag t-blue">RFQ sent</span>'],['IND-0513','TMT steel Fe550','12 MT','Dream Valley','BOQ-002','<span class="tag t-amber">Quotes in</span>'],['IND-0514','Vitrified tiles','2,200 sqft','Trade Centre','Manual','<span class="tag t-gray">Draft</span>'],['IND-0515','Waterproof compound','60 drums','Green Acres','Maintenance','<span class="tag t-blue">RFQ sent</span>']]);
  } else if(ti===1){ body=mTable(['RFQ','Item','Vendors','Best quote','Status'],[['RFQ-58','Tiles','4','₹3.1L','Open']]); }
  else if(ti===2){ body=mTable(['PO No','Vendor','Amount','Status','Date'],[['PO-0042','ACC Cement','₹4.2L','Pending','27 Jun']]); }
  else if(ti===3){ body=mTable(['GRN','PO','Supplier','QC','Status'],[['GRN-091','PO-0042','ACC Cement','Pass','Received']]); }
  else if(ti===4){ body=mTable(['Item','Category','In stock','UoM','Value'],[['OPC 53 cement','Cement','420','Bags','₹1.6L']]); }
  else { body=mTable(['Supplier','Invoice','Amount','Due','Status'],[['Tata Steel','INV-2291','₹9.1L','10 Jul','Submitted']]); }
  v.innerHTML=mHead('fa-boxes-stacked','#0f766e','Inventory & Procurement')+mTabs('inventory',tabs,ti)+'<div style="margin-top:16px">'+body+'</div>';
};

/* ===== PROCUREMENT MODULE ===== */
const PROC={sel:new Set(),tab:'Quote Comp'};

async function procFetch(cat){
  const {data,error}=await sb.schema('doc').from('documents')
    .select('*').eq('department','Procurement').eq('category',cat)
    .order('created_at',{ascending:false});
  if(error){toast('Load failed: '+error.message,'err');return[];}
  return data||[];
}

function procRefresh(cat){
  const host=$('procHost');if(!host)return;
  procFetch(cat).then(docs=>{ host.innerHTML=procCardsHtml(docs,cat); procActionBar(cat); });
}

function procActionBar(cat){
  const bar=$('procBar');if(!bar)return;
  const n=PROC.sel.size;
  const dis='opacity:.38;cursor:not-allowed;pointer-events:none';
  bar.innerHTML=
    `<button class="btn btn-primary" onclick="procUploadModal('${cat}')"><i class="fa-solid fa-upload"></i> Upload</button>`+
    `<button class="btn" onclick="procDownloadSel()" ${n===0?'disabled':''} style="${n===0?dis:''}"><i class="fa-solid fa-download"></i> Download</button>`+
    `<button class="btn" onclick="procEditModal()" ${n!==1?'disabled':''} style="${n!==1?dis:''}" title="${n>1?'Select only one file to edit':'Edit selected'}"><i class="fa-solid fa-pen"></i> Edit</button>`+
    `<button class="btn" style="${n===0?dis:'color:var(--err)'}" ${n===0?'disabled':''} onclick="procDeleteSel('${cat}')"><i class="fa-solid fa-trash"></i> Delete</button>`+
    (n>0?`<span style="font-size:12px;color:var(--slate);margin-left:4px">${n} selected</span>`:'');
}

function procCardsHtml(docs,cat){
  if(!docs.length)return '<div class="empty" style="padding:48px;text-align:center;color:var(--slate)"><i class="fa-solid fa-file-circle-plus" style="font-size:32px;margin-bottom:12px;display:block"></i>No sheets yet — upload one</div>';
  return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;padding:4px 0">'+
    docs.map(d=>{
      const sel=PROC.sel.has(d.id);
      const ext=(d.file_name||'').split('.').pop().toLowerCase();
      return `<div class="proc-card${sel?' proc-sel':''}" onclick="procToggle(${d.id},'${cat}')" ondblclick="event.stopPropagation();docPreview(${d.id})" title="Click to select · Double-click to preview" style="border:2px solid ${sel?'var(--brand)':'var(--line)'};border-radius:12px;padding:16px 14px;cursor:pointer;position:relative;background:${sel?'#eff6ff':'var(--card)'}">
        <div style="position:absolute;top:10px;right:10px;width:18px;height:18px;border-radius:50%;border:2px solid ${sel?'var(--brand)':'var(--line)'};background:${sel?'var(--brand)':'transparent'};display:flex;align-items:center;justify-content:center">
          ${sel?'<i class="fa-solid fa-check" style="color:#fff;font-size:9px"></i>':''}
        </div>
        <div style="font-size:32px;margin-bottom:10px;text-align:center">${fileIcon(ext)||'<span style="font-size:32px">📄</span>'}</div>
        <div style="font-weight:600;font-size:13px;word-break:break-word;margin-bottom:4px">${esc(d.title||d.file_name)}</div>
        <div style="font-size:11px;color:var(--slate)">${fmtBytes(d.file_size)} · ${d.created_at?new Date(d.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):''}</div>
      </div>`;
    }).join('')+'</div>';
}

window.procToggle=function(id,cat){
  if(PROC.sel.has(id))PROC.sel.delete(id);else PROC.sel.add(id);
  procRefresh(cat);
};

window.procDownloadSel=async function(){
  for(const id of PROC.sel){
    const d=await getDoc(id);if(!d||!d.storage_path)continue;
    if(isS3Path(d.storage_path)){ await s3OpenSigned(d.storage_path,d.file_name||'file'); continue; }
    const {data}=await sb.storage.from(bucketFor(d.department)).createSignedUrl(d.storage_path,120);
    if(data){const a=document.createElement('a');a.href=data.signedUrl;a.download=d.file_name||'file';document.body.appendChild(a);a.click();a.remove();}
  }
};

window.procDeleteSel=async function(cat){
  if(!PROC.sel.size)return;
  if(!await confirmDialog('Delete '+PROC.sel.size+' file(s)? This cannot be undone.'))return;
  for(const id of [...PROC.sel]){
    const d=await getDoc(id);if(!d)continue;
    if(d.storage_path){ if(isS3Path(d.storage_path)) await s3Delete(d.storage_path); else await sb.storage.from(bucketFor(d.department)).remove([d.storage_path]); }
    await sb.schema('doc').from('documents').delete().eq('id',id);
  }
  PROC.sel.clear();toast('Deleted','ok');procRefresh(cat);
};

window.procUploadModal=function(cat){
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-upload"></i> Upload Sheet</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm">
      <label>File(s)</label>
      <input type="file" id="procUpFile" multiple accept=".xlsx,.xls,.csv,.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg">
      <label>Name <span style="color:var(--slate);font-weight:400">(optional — uses filename if blank)</span></label>
      <input id="procUpName" placeholder="Custom name…">
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="procUploadSave('${cat}')"><i class="fa-solid fa-upload"></i> Upload</button>
    </div>`,'');
};

window.procUploadSave=async function(cat){
  const files=[...(($('procUpFile')&&$('procUpFile').files)||[])];
  if(!files.length){toast('Select a file','err');return;}
  const customName=$('procUpName')&&$('procUpName').value.trim();
  let ok=0;
  for(const f of files){
    const key=s3KeyForDoc('Procurement',cat,f.name);
    const {data:upData,error:upErr}=await uploadFileToS3(key,f);
    if(upErr){toast('Upload failed: '+upErr.message,'err');continue;}
    const title=(files.length===1&&customName)||f.name.replace(/\.[^.]+$/,'');
    const {error}=await sb.schema('doc').from('documents').insert({title,department:'Procurement',category:cat,file_name:f.name,file_size:f.size,file_type:f.name.split('.').pop(),storage_path:upData.path,uploaded_by:state.email,visibility:'internal',status:'Active',confidential:false,version:'v1',tags:'',description:''});
    if(!error)ok++;
  }
  closeModal();if(ok)toast(ok+' sheet(s) uploaded','ok');procRefresh(cat);
};

window.procEditModal=async function(){
  if(PROC.sel.size!==1){toast('Select exactly one file to edit','err');return;}
  const id=[...PROC.sel][0];
  const d=await getDoc(id);if(!d)return;
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-pen"></i> Edit Sheet</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm">
      <label>Name</label>
      <input id="procEditName" value="${esc(d.title||d.file_name)}">
      <label>Replace file <span style="color:var(--slate);font-weight:400">(optional — leave blank to keep existing)</span></label>
      <input type="file" id="procEditFile" accept=".xlsx,.xls,.csv,.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg">
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="procEditSave(${id},'${d.category}','${esc(d.storage_path||'')}','${esc(d.department||'')}')">Save</button>
    </div>`,'');
};

window.procEditSave=async function(id,cat,oldPath,dept){
  const newName=($('procEditName')&&$('procEditName').value.trim())||'';
  const file=$('procEditFile')&&$('procEditFile').files[0];
  let update={};
  if(newName)update.title=newName;
  if(file){
    const key=s3KeyForDoc(dept||'Procurement',cat,file.name);
    const {data:upData,error:upErr}=await uploadFileToS3(key,file);
    if(upErr){toast('Upload failed: '+upErr.message,'err');return;}
    update.storage_path=upData.path;update.file_name=file.name;update.file_size=file.size;update.file_type=file.name.split('.').pop();
    // Remove old file
    if(oldPath){ if(isS3Path(oldPath)) await s3Delete(oldPath); else await sb.storage.from('documents').remove([oldPath]); }
  }
  if(!Object.keys(update).length){closeModal();return;}
  const {error}=await sb.schema('doc').from('documents').update(update).eq('id',id);
  if(error){toast('Save failed: '+error.message,'err');return;}
  closeModal();PROC.sel.clear();toast('Updated','ok');procRefresh(cat);
};

VIEWS.procurement=function(v,seg){
  setCrumb(['Operations','Procurement']);
  const tabs=['Indent','Quote Comp','PO','GRN'];const ti=mTab(seg,tabs.length);
  const cat=tabs[ti];
  PROC.sel.clear();
  if(ti===1){// Quote Comp
    v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-file-invoice" style="color:#0369a1"></i> Procurement</h1><p>Indents · Quote Comparison · Purchase Orders · GRN</p></div></div>`+
      mTabs('procurement',tabs,ti)+
      `<div style="margin-top:20px">
        <div id="procBar" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px"></div>
        <div id="procHost"></div>
      </div>`;
    procRefresh(cat);
  } else {
    v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-file-invoice" style="color:#0369a1"></i> Procurement</h1><p>Indents · Quote Comparison · Purchase Orders · GRN</p></div></div>`+
      mTabs('procurement',tabs,ti)+
      `<div style="margin-top:20px">`+mSoon(cat)+`</div>`;
  }
};


VIEWS.maintenance=function(v,seg){
  setCrumb(['Operations','Assets & Maintenance']);
  const tabs=['Asset register','Preventive maintenance','Breakdowns & repairs','Location-wise'];const ti=mTab(seg,tabs.length);
  const kpis=[['Total assets','311','6 sites'],['Active','291','94%','#16855a'],['Under repair','4','2 overdue','#c83232'],['PM due (7 days)','12','across sites','#e08600']];
  let body;
  if(ti===0){ body=mTable(['Tag','Asset','Category','Location','Status','Warranty'],[['AST-0112','DG Set 250 kVA','Mechanical','Dream Valley','<span class="tag t-green">Active</span>','Till Mar-27'],['AST-0113','Passenger lift — Tower B','Mechanical','Jain Heights','<span class="tag t-red">Under repair</span>','AMC active'],['AST-0114','Tower crane','Civil','Dream Valley','<span class="tag t-green">Active</span>','Leased'],['AST-0115','Site office HVAC','Electrical','Trade Centre','<span class="tag t-green">Active</span>','Till Dec-26'],['AST-0116','Survey total station','IT','Green Acres','<span class="tag t-gray">Idle</span>','Expired']]); }
  else if(ti===1){ body=mTable(['Asset','Frequency','Last PM','Next PM','Owner'],[['DG Set 250 kVA','Monthly','02 Jun','02 Jul','Facility']]); }
  else if(ti===2){ body=mTable(['Ticket','Asset','Issue','Raised','Status'],[['BD-22','Passenger lift','Door fault','Today','Open']]); }
  else { body=mTable(['Location','Assets','Active','Under repair'],[['Dream Valley','86','80','3'],['Jain Heights','54','50','1']]); }
  v.innerHTML=mHead('fa-screwdriver-wrench','#7c3aed','Assets & Maintenance')+mKpis(kpis)+mTabs('maintenance',tabs,ti)+'<div style="margin-top:14px">'+body+'</div>';
};

/* ---------- INTERNET SPEED MONITOR ----------
   Reads the net_* tables (public schema) populated by the office laptops'
   speed-monitor agent. Read-only: RLS lets any signed-in user SELECT these. */
const NET_RANGES=[['today','Today'],['3d','Last 3 days'],['5d','Last 5 days'],['30d','Last 1 month']];
let NET_RANGE='today';
window.netRangeChange=function(v){ NET_RANGE=v; renderPage(); };
VIEWS.network=async function(v,seg){
  setCrumb(['IT & Support','Internet Speed']);
  const tabs=['Overview','All readings','Alerts'];
  const ti=mTab(seg,tabs.length);
  v.innerHTML=mHead('fa-wifi','#0ea5e9','Internet Speed Monitor')+mTabs('network',tabs,ti)
    +'<div id="netBody" style="margin-top:16px"><div class="loader"><div class="spin"></div></div></div>';
  const host=$('netBody');
  const nf=(n,d=1)=>(n==null||isNaN(n))?'—':Number(n).toFixed(d);
  const tag=s=>'<span class="tag '+(s==='ok'?'t-green':s==='low'?'t-red':'t-amber')+'">'+esc(s||'—')+'</span>';
  try{
    const dayAgoMs=Date.now()-24*3600*1000;
    const [tRes,aRes,sRes,dRes]=await Promise.all([
      sb.from('net_speed_tests').select('id,device_key,tested_at,download_mbps,upload_mbps,ping_ms,jitter_ms,isp,server_location,status').order('tested_at',{ascending:false}).limit(5000),
      sb.from('net_alerts').select('*').order('occurred_at',{ascending:false}).limit(24),
      sb.from('net_settings').select('*').eq('device_key','office').maybeSingle(),
      sb.from('net_devices').select('device_key,display_name'),
    ]);
    if(tRes.error)throw tRes.error;
    const tests=tRes.data||[];
    const alerts=aRes.data||[];
    const settings=(sRes&&sRes.data)||{};
    const devMap={};(dRes.data||[]).forEach(d=>devMap[d.device_key]=d.display_name||d.device_key);
    const nameOfDev=k=>devMap[k]||k||'—';

    if(!tests.length){
      host.innerHTML='<div class="card card-pad empty"><i class="fa-solid fa-wifi"></i><div style="font-weight:600;color:var(--ink)">No speed readings yet</div><p style="max-width:460px;margin:6px auto 0">Once a monitored laptop runs the speed-monitor agent, its readings appear here automatically.</p></div>';
      return;
    }

    /* ---- OVERVIEW ---- */
    if(ti===0){
      const latest=tests.find(t=>t.download_mbps!=null);
      const a24=alerts.filter(a=>new Date(a.occurred_at).getTime()>=dayAgoMs).length;
      const kpis=[
        ['Latest download', latest?nf(latest.download_mbps)+' Mbps':'—', latest?relTime(latest.tested_at):''],
        ['Latest upload', latest?nf(latest.upload_mbps)+' Mbps':'—', ''],
        ['Latest ping', latest?nf(latest.ping_ms,0)+' ms':'—', latest&&latest.isp?latest.isp:''],
        ['Alerts (24h)', String(a24), a24?'below threshold':'all healthy', a24?'#c83232':'#16855a'],
      ];
      const metaCells=[['Interval',(settings.interval_minutes||'—')+' min'],
        ['Office hours',settings.office_start_hour!=null?(settings.office_start_hour+':00–'+settings.office_end_hour+':00'):'—'],
        ['Download threshold',(settings.download_threshold||'—')+' Mbps'],
        ['Upload threshold',(settings.upload_threshold||'—')+' Mbps'],
        ['Ping threshold',(settings.ping_threshold||'—')+' ms']];
      host.innerHTML=mKpis(kpis)
        +'<div class="card card-pad" style="margin-top:16px"><div class="sec-title">Speed over time · last 24h</div><div class="sec-sub">Download vs upload over the last 24 hours · red dashed line = alert threshold</div><canvas id="chNet" height="110"></canvas></div>'
        +'<div class="card card-pad" style="margin-top:16px"><div class="sec-title">Monitoring settings</div><div class="sec-sub">Shared configuration · change in the net_settings table</div>'
          +'<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-top:8px">'
          +metaCells.map(x=>'<div><div style="color:var(--slate);font-size:12px">'+esc(x[0])+'</div><div style="font-weight:700;font-size:15px;margin-top:2px">'+esc(x[1])+'</div></div>').join('')
          +'</div></div>';
      // chart — last 24h if available, else the most recent 100 readings
      let pts=tests.filter(t=>t.download_mbps!=null&&new Date(t.tested_at).getTime()>=dayAgoMs);
      if(!pts.length)pts=tests.filter(t=>t.download_mbps!=null).slice(0,100);
      pts=pts.slice().reverse();
      const labels=pts.map(p=>new Date(p.tested_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}));
      const dls=pts.map(p=>Number(p.download_mbps)), uls=pts.map(p=>Number(p.upload_mbps));
      const thr=Number(settings.download_threshold)||0;
      const ds=[
        {label:'Download',data:dls,borderColor:'#0ea5e9',backgroundColor:'rgba(14,165,233,.08)',fill:true,tension:.35,borderWidth:2,pointRadius:2},
        {label:'Upload',data:uls,borderColor:'#16a34a',backgroundColor:'rgba(22,163,74,.05)',fill:true,tension:.35,borderWidth:2,pointRadius:2},
      ];
      if(thr>0)ds.push({label:'Threshold',data:dls.map(()=>thr),borderColor:'#dc2626',borderDash:[5,4],borderWidth:1.5,pointRadius:0,fill:false});
      new Chart($('chNet'),{type:'line',data:{labels,datasets:ds},options:{plugins:{legend:{position:'bottom',labels:{usePointStyle:true,boxWidth:7,font:{size:12}}}},scales:{y:{grid:{color:'#eef1f6'},border:{display:false},title:{display:true,text:'Mbps'}},x:{grid:{display:false},ticks:{maxTicksLimit:8}}}}});
      return;
    }

    /* ---- ALL READINGS ---- */
    if(ti===1){
      const now=new Date();
      let sinceMs;
      if(NET_RANGE==='today') sinceMs=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
      else sinceMs=now.getTime()-({'3d':3,'5d':5,'30d':30}[NET_RANGE]||3)*24*3600*1000;
      const filtered=tests.filter(t=>new Date(t.tested_at).getTime()>=sinceMs);
      const rows=filtered.map(t=>[
        new Date(t.tested_at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}),
        nf(t.download_mbps), nf(t.upload_mbps), t.ping_ms!=null?nf(t.ping_ms,0):'—',
        t.isp||'—',
      ]);
      const rangeSel='<select class="sel" id="netRangeSel" style="margin-left:auto" onchange="netRangeChange(this.value)">'
        +NET_RANGES.map(r=>'<option value="'+r[0]+'"'+(r[0]===NET_RANGE?' selected':'')+'>'+r[1]+'</option>').join('')+'</select>';
      host.innerHTML='<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">'
        +'<div class="sec-sub" style="margin:0">Showing '+rows.length+' reading'+(rows.length===1?'':'s')+'</div>'
        +rangeSel+'</div>'
        +(rows.length?mTable(['Time','↓ Mbps','↑ Mbps','Ping','ISP'],rows):'<div class="card card-pad empty">No readings in this range</div>');
      return;
    }

    /* ---- ALERTS ---- */
    if(ti===2){
      if(!alerts.length){
        host.innerHTML='<div class="card card-pad empty"><i class="fa-regular fa-circle-check" style="color:#16855a"></i><div style="font-weight:600;color:var(--ink)">No low-speed alerts</div><p style="max-width:440px;margin:6px auto 0">Every test so far has stayed above the threshold. When a reading falls below, a screenshot is captured automatically and shown here.</p></div>';
        return;
      }
      host.innerHTML='<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px">'+alerts.map(a=>{
        const img=a.screenshot_url
          ?'<a href="'+esc(a.screenshot_url)+'" target="_blank" rel="noopener"><img src="'+esc(a.screenshot_url)+'" alt="Screenshot" style="width:100%;aspect-ratio:16/9;object-fit:cover;background:#000;display:block" loading="lazy"></a>'
          :'<div style="width:100%;aspect-ratio:16/9;background:var(--line-2);display:flex;align-items:center;justify-content:center;color:var(--slate);font-size:12px">no screenshot</div>';
        return '<div class="card" style="overflow:hidden;padding:0">'+img
          +'<div style="padding:12px"><div style="font-weight:700;font-size:12.5px;color:#c83232"><i class="fa-solid fa-triangle-exclamation"></i> '+esc(a.reason||'Low speed')+'</div>'
          +'<div style="font-family:monospace;font-size:12px;margin-top:6px">↓'+nf(a.download_mbps)+' ↑'+nf(a.upload_mbps)+' Mbps · '+nf(a.ping_ms,0)+'ms</div>'
          +'<div style="color:var(--slate);font-size:11.5px;margin-top:6px">'+esc(nameOfDev(a.device_key))+' · '+fmtDate(a.occurred_at)+' '+new Date(a.occurred_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})+'</div>'
          +'</div></div>';
      }).join('')+'</div>';
      return;
    }
  }catch(e){
    host.innerHTML='<div class="card card-pad empty"><i class="fa-solid fa-triangle-exclamation" style="color:#c83232"></i><div style="font-weight:600;color:var(--ink)">Couldn\'t load speed data</div><p style="max-width:440px;margin:6px auto 0">'+esc(e.message||String(e))+'</p></div>';
  }
};

// ── Recruitment ──────────────────────────────────────────────────────────────
let RT_RECORDS=null; // cached tests from DB
// Default JDs bundled with the app (from ./jd/ folder)
const DEFAULT_JDS=[]; // all JDs now stored in Supabase (recruit.job_descriptions)
let REC_SEL=new Set();
VIEWS.recruitment=async function(v,seg){
  setCrumb(['People','Recruitment (ATS)']);
  const tabs=['Tests','Descriptions','ManPower Form'];const ti=mTab(seg,tabs.length);
  v.innerHTML=REC_RO_CSS+mHead('fa-user-plus','#0369a1','Recruitment (ATS)')
    +(recCanWrite()?'':'<div class="rec-ro"><i class="fa-solid fa-lock"></i> Read-only — adding, editing and deleting here is limited to HR, Abhay Mati and Administrators.</div>')
    +mTabs('recruitment',tabs,ti)+'<div id="recBody" style="margin-top:16px"><div class="loader"><div class="spin"></div></div></div>';
  recWatchPerms();
  if(ti===2){recManpower();return;}
  if(ti===0){await recTests();return;}
  await recLoadJDs(v);
};

/* ── Tests (dynamic, DB-backed) ── */
let RT_SEL=new Set();
async function recTests(){
  const b=$('recBody');
  b.innerHTML='<div class="loader"><div class="spin"></div></div>';
  if(!RT_RECORDS){
    try{const{data,error}=await sb.schema('recruit').from('tests').select('*').order('sl',{ascending:true});
      if(error)throw error; RT_RECORDS=data||[];}catch(e){b.innerHTML='<div class="empty" style="padding:40px;color:var(--err)">'+esc(e.message)+'</div>';return;}
  }
  RT_SEL=new Set();
  rtRender();
}
function rtRender(){
  const b=$('recBody'); if(!b)return;
  const rows=RT_RECORDS||[];
  const dis='opacity:.38;cursor:not-allowed;pointer-events:none';
  b.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <div class="sec-title" style="margin:0">Assessment Tests <span class="tag t-gray" style="margin-left:4px">${rows.length}</span></div>
    <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="rtAdd()"><i class="fa-solid fa-plus"></i> Add Test</button>
      <button class="btn" id="rtRenBtn" disabled style="${dis}" onclick="rtRename()"><i class="fa-solid fa-pen"></i> Rename</button>
      <button class="btn" id="rtDelBtn" disabled style="${dis};color:var(--err);border-color:var(--err)" onclick="rtDelete()"><i class="fa-solid fa-trash"></i> Delete</button>
      ${rtCanShare()?`<button class="btn" id="rtShareBtn" disabled style="${dis}" onclick="rtShare()"><i class="fa-solid fa-share-nodes"></i> Share</button>`:''}
    </div>
  </div>
  <div class="card" style="overflow:hidden">
  <table class="tbl" id="rtTbl" style="table-layout:fixed;width:100%">
    <thead><tr>
      <th style="width:36px;text-align:center"><input type="checkbox" id="rtChkAll" onchange="rtToggleAll(this)"></th>
      <th style="width:56px;text-align:center">Sl.</th>
      <th style="width:160px">Test Name</th>
      <th>Form Link</th>
      <th style="width:120px;text-align:center">Actions</th>
    </tr></thead>
    <tbody>${rows.length?rows.map(t=>`<tr>
      <td style="text-align:center"><input type="checkbox" class="rt-chk" value="${t.id}" onchange="rtSyncToolbar()"></td>
      <td style="text-align:center;color:var(--slate);font-size:13px">${t.sl}</td>
      <td style="font-weight:500;overflow-wrap:anywhere">${esc(t.name)}</td>
      <td style="overflow-wrap:anywhere">${t.link?`<a href="${esc(t.link)}" target="_blank" rel="noopener" style="color:#0369a1;display:inline-flex;align-items:flex-start;gap:5px;font-size:13px;text-decoration:none;white-space:normal;overflow-wrap:anywhere;word-break:break-all"><i class="fa-solid fa-arrow-up-right-from-square" style="font-size:11px;margin-top:2px;flex:none"></i><span>${esc(t.link)}</span></a>`:'<span style="color:var(--slate)">—</span>'}</td>
      <td style="text-align:center"><button class="btn btn-sm btn-primary" style="font-size:12px" onclick="rtPreview(${t.id})"><i class="fa-solid fa-plus"></i> Preview</button></td>
    </tr>`).join(''):'<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--slate)">No tests yet — click <b>Add Test</b></td></tr>'}
    </tbody>
  </table>
  </div>
  <div id="rtPreviewPanel" style="display:none;margin-top:16px"></div>`;
}
window.rtToggleAll=function(el){document.querySelectorAll('.rt-chk').forEach(c=>c.checked=el.checked);rtSyncToolbar();};
window.rtSyncToolbar=function(){
  const sel=[...document.querySelectorAll('.rt-chk:checked')];
  const n=sel.length;
  const ren=$('rtRenBtn'),del=$('rtDelBtn');
  const dis='opacity:.38;cursor:not-allowed;pointer-events:none';
  if(ren){ren.disabled=n!==1;ren.style.cssText=n===1?'':dis;}
  if(del){del.disabled=n===0;del.style.cssText=n>0?'color:var(--err);border-color:var(--err)':dis+';color:var(--err);border-color:var(--err)';}
  const shr=$('rtShareBtn');
  if(shr){shr.disabled=n!==1;shr.style.cssText=n===1?'':dis;}
};
window.rtAdd=function(){if(!recGuard())return;
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-plus"></i> Add Test</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>Test Name *</label><input id="rtFName" class="inp" placeholder="e.g. Test for HR">
    <label>Form Link</label><input id="rtFLink" class="inp" placeholder="http://form-timer.com/start/...">
    <label>Response Sheet URL <span style="font-size:11px;color:var(--slate)">(Google Sheets URL for Preview)</span></label>
    <input id="rtFSheet" class="inp" placeholder="https://docs.google.com/spreadsheets/d/...">
  </div>
  <div class="modal-foot"><button class="btn btn-primary" onclick="rtSave()">Add Test</button><button class="btn" onclick="closeModal()">Cancel</button></div>`);
  setTimeout(()=>{const el=$('rtFName');if(el)el.focus();},100);
};
window.rtSave=async function(){
  const name=($('rtFName')||{}).value?.trim();
  const link=($('rtFLink')||{}).value?.trim()||'';
  const sheet=($('rtFSheet')||{}).value?.trim()||'';
  if(!name){toast('Test name is required','err');return;}
  const maxSl=(RT_RECORDS||[]).reduce((m,r)=>Math.max(m,r.sl||0),0)+1;
  const{data,error}=await sb.schema('recruit').from('tests').insert({sl:maxSl,name,link,response_sheet_url:sheet||null}).select().single();
  if(error){toast(error.message,'err');return;}
  RT_RECORDS=[...(RT_RECORDS||[]),data];
  closeModal();toast('Test added');rtRender();
};
window.rtRename=function(){if(!recGuard())return;
  const sel=[...document.querySelectorAll('.rt-chk:checked')];
  if(sel.length!==1)return;
  const id=parseInt(sel[0].value);
  const rec=(RT_RECORDS||[]).find(r=>r.id===id);if(!rec)return;
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-pen"></i> Rename Test</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>Test Name *</label><input id="rtFRename" class="inp" value="${esc(rec.name)}">
    <label>Form Link</label><input id="rtFRLink" class="inp" value="${esc(rec.link||'')}">
    <label>Response Sheet URL</label><input id="rtFRSheet" class="inp" value="${esc(rec.response_sheet_url||'')}">
  </div>
  <div class="modal-foot"><button class="btn btn-primary" onclick="rtUpdate(${id})">Save</button><button class="btn" onclick="closeModal()">Cancel</button></div>`);
  setTimeout(()=>{const el=$('rtFRename');if(el)el.focus();},100);
};
window.rtUpdate=async function(id){
  const name=($('rtFRename')||{}).value?.trim();
  const link=($('rtFRLink')||{}).value?.trim()||'';
  const sheet=($('rtFRSheet')||{}).value?.trim()||'';
  if(!name){toast('Test name is required','err');return;}
  const{error}=await sb.schema('recruit').from('tests').update({name,link,response_sheet_url:sheet||null}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  const rec=(RT_RECORDS||[]).find(r=>r.id===id);
  if(rec){rec.name=name;rec.link=link;rec.response_sheet_url=sheet||null;}
  closeModal();toast('Test updated');rtRender();
};
window.rtDelete=async function(){if(!recGuard())return;
  const sel=[...document.querySelectorAll('.rt-chk:checked')].map(c=>parseInt(c.value));
  if(!sel.length)return;
  if(!await confirmDialog('Delete '+sel.length+' test(s)? All associated responses will also be deleted. This cannot be undone.'))return;
  const{error}=await sb.schema('recruit').from('tests').delete().in('id',sel);
  if(error){toast(error.message,'err');return;}
  RT_RECORDS=(RT_RECORDS||[]).filter(r=>!sel.includes(r.id));
  toast(sel.length+' test(s) deleted');rtRender();
};

/* ── Share Test (email a form link to candidates via the Email API backend) ── */
// Visibility is limited to these people, matched by their JainE profile full name.
// (Others with recruitment access will NOT see the Share button.)
// NOTE: 'administrator' & 'abhay mati' added for testing — remove later if the 3 named
// staff should be the only ones with Share access.
const RT_SHARE_ALLOWED=['shuchandra das','khushbu singh','uzma ahmed','administrator','abhay mati'];
function rtShareNorm(s){return (s||'').trim().toLowerCase().replace(/\s+/g,' ');}
function rtCanShare(){
  const nm=rtShareNorm((state.profile&&state.profile.full_name)||(state.roles&&state.roles.full_name)||'');
  return RT_SHARE_ALLOWED.includes(nm);
}
function rtShareFieldRow(val){
  return `<div class="rt-share-field" style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
    <input class="inp rt-email-inp" type="email" placeholder="candidate@email.com" value="${val?esc(val):''}" style="flex:1">
    <button type="button" class="btn btn-sm" style="color:var(--err);border-color:var(--err);flex:none;padding:6px 10px" onclick="rtShareRemoveField(this)" title="Remove this email"><i class="fa-solid fa-xmark"></i></button>
  </div>`;
}
window.rtShareRemoveField=function(btn){const row=btn.closest('.rt-share-field');if(row)row.remove();};
window.rtShareAddN=function(){
  const raw=parseInt(($('rtAddN')||{}).value);
  const n=Math.max(1,Math.min(50,isNaN(raw)?1:raw));
  const cont=$('rtEmailFields');if(!cont)return;
  for(let i=0;i<n;i++)cont.insertAdjacentHTML('beforeend',rtShareFieldRow());
};
window.rtShare=function(){
  if(!rtCanShare()){toast('You do not have permission to share tests','err');return;}
  const sel=[...document.querySelectorAll('.rt-chk:checked')].map(c=>parseInt(c.value));
  if(sel.length!==1){toast('Select exactly one test to share','err');return;}
  const rec=(RT_RECORDS||[]).find(r=>r.id===sel[0]);if(!rec)return;
  const senderName=(state.profile&&state.profile.full_name)||(state.roles&&state.roles.full_name)||(state.email||'').split('@')[0];
  const subject=`Check This ${rec.name} provided by JainGroup`;
  const body=`Dear Candidate,\nFill This Test at the latest.\nTest Attachment`;
  const fields=Array.from({length:5}).map(()=>rtShareFieldRow()).join('');
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-share-nodes"></i> Share Test</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <div style="background:var(--bg-subtle,#f8fafc);border:1px solid var(--line);border-radius:8px;padding:9px 12px;font-size:12.5px;color:var(--slate);margin-bottom:4px">Sending as <b style="color:var(--ink)">${esc(senderName)}</b> · ${esc(state.email||'')}</div>
    <label>Test</label><input class="inp" value="${esc(rec.name)}" disabled>
    <label>Subject</label><input id="rtShareSubj" class="inp" value="${esc(subject)}">
    <label>Message</label><textarea id="rtShareBody" class="inp" rows="3" style="resize:vertical">${esc(body)}</textarea>
    ${rec.link?`<div style="font-size:11.5px;color:var(--slate);margin-top:2px"><i class="fa-solid fa-paperclip"></i> Test link attached: <span style="word-break:break-all">${esc(rec.link)}</span></div>`:'<div style="font-size:11.5px;color:var(--err);margin-top:2px">&#9888; This test has no form link.</div>'}
    <label style="margin-top:6px">Candidate Emails <span style="font-size:11px;color:var(--slate)">(each field must be filled)</span></label>
    <div id="rtEmailFields">${fields}</div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
      <input id="rtAddN" type="number" min="1" max="50" value="1" class="inp" style="width:84px" title="How many fields to add">
      <button type="button" class="btn btn-sm" onclick="rtShareAddN()"><i class="fa-solid fa-plus"></i> Add Field(s)</button>
    </div>
  </div>
  <div class="modal-foot"><button class="btn btn-primary" id="rtShareSendBtn" onclick="rtShareSend(${rec.id})"><i class="fa-solid fa-paper-plane"></i> Send</button><button class="btn" onclick="closeModal()">Cancel</button></div>`);
};
window.rtShareSend=async function(id){
  if(!rtCanShare()){toast('You do not have permission to share tests','err');return;}
  const rec=(RT_RECORDS||[]).find(r=>r.id===id);if(!rec)return;
  const inps=[...document.querySelectorAll('#rtEmailFields .rt-email-inp')];
  if(!inps.length){toast('Add at least one candidate email','err');return;}
  const re=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emails=[];
  for(const el of inps){
    const v=(el.value||'').trim();
    el.style.borderColor='';
    if(!v){el.style.borderColor='var(--err)';toast('Every email field must be filled (or remove it)','err');el.focus();return;}
    if(!re.test(v)){el.style.borderColor='var(--err)';toast('Invalid email: '+v,'err');el.focus();return;}
    if(emails.includes(v.toLowerCase())){el.style.borderColor='var(--err)';toast('Duplicate email: '+v,'err');el.focus();return;}
    emails.push(v.toLowerCase());
  }
  const subject=($('rtShareSubj')||{}).value?.trim()||`Check This ${rec.name} provided by JainGroup`;
  const body=($('rtShareBody')||{}).value?.trim()||'';
  const senderName=(state.profile&&state.profile.full_name)||(state.roles&&state.roles.full_name)||(state.email||'').split('@')[0];
  const btn=$('rtShareSendBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Sending…';}
  try{
    const {data:{session}}=await sb.auth.getSession();
    const token=session&&session.access_token;
    const res=await fetch(SUPABASE_URL+'/functions/v1/send-test-email',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},
      body:JSON.stringify({test_id:id,test_name:rec.name,link:rec.link||'',subject,body,recipients:emails,sender_name:senderName,sender_email:state.email||''})
    });
    const out=await res.json().catch(()=>({}));
    if(!res.ok||out.error)throw new Error(out.error||('send-test-email HTTP '+res.status));
    closeModal();toast('Test shared with '+emails.length+' candidate'+(emails.length>1?'s':''),'ok');
  }catch(e){
    if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-paper-plane"></i> Send';}
    toast('Send failed: '+((e&&e.message)||'unknown error'),'err');
  }
};
window.rtPreview=async function(id){
  const rec=(RT_RECORDS||[]).find(r=>r.id===id);if(!rec)return;
  const panel=$('rtPreviewPanel');if(!panel)return;
  panel.style.display='block';
  panel.innerHTML=`<div class="card card-pad">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <i class="fa-solid fa-list-check" style="color:#0369a1;font-size:16px"></i>
      <span style="font-weight:700;font-size:15px">${esc(rec.name)} — Responses</span>
      <button style="margin-left:auto;background:none;border:none;cursor:pointer;font-size:22px;line-height:1;color:var(--slate)" onclick="document.getElementById('rtPreviewPanel').style.display='none'">&times;</button>
    </div>
    <div id="rtPreviewBody"><div class="loader"><div class="spin"></div></div></div>
  </div>`;
  panel.scrollIntoView({behavior:'smooth',block:'start'});
  const pb=$('rtPreviewBody');
  try{
    const{data,error}=await sb.schema('recruit').from('test_responses')
      .select('respondent,score_got,score_total,time_taken,submitted_at,answers')
      .eq('test_id',id)
      .order('score_got',{ascending:false,nullsFirst:false});
    if(error)throw new Error(error.message);
    if(!data||!data.length){
      pb.innerHTML='<div class="empty" style="padding:36px;color:var(--slate)"><i class="fa-solid fa-inbox" style="font-size:28px;opacity:.3;display:block;margin-bottom:10px"></i>No responses imported yet for this test.</div>';
      return;
    }
    const pct=(g,t)=>t?Math.round(g/t*100):null;
    const scoreTag=(g,t)=>{
      if(g==null)return '<span style="color:var(--slate)">—</span>';
      const p=pct(g,t);
      const col=p==null?'var(--ink)':p>=70?'#16855a':p>=40?'#c08000':'#c83232';
      return `<b style="color:${col}">${g}${t?' / '+t:''}</b>${p!=null?` <span style="font-size:11px;color:var(--slate)">(${p}%)</span>`:''}`;
    };
    const fmtDate=ts=>{if(!ts)return '—';try{return new Date(ts).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});}catch{return ts;}};
    pb.innerHTML=`
      <div style="font-size:12px;color:var(--slate);margin-bottom:10px">${data.length} response${data.length!==1?'s':''} · sorted by score</div>
      <div style="overflow-x:auto">
      <table class="tbl" style="min-width:400px">
        <thead><tr>
          <th style="width:36px;text-align:center">#</th>
          <th>Respondent</th>
          <th style="text-align:center;white-space:nowrap">Score</th>
          <th style="white-space:nowrap">Time Taken</th>
          <th style="white-space:nowrap">Date</th>
        </tr></thead>
        <tbody>${data.map((r,i)=>`<tr>
          <td style="text-align:center;color:var(--slate);font-size:12px">${i+1}</td>
          <td style="font-weight:500">${esc(r.respondent||'—')}</td>
          <td style="text-align:center;white-space:nowrap">${scoreTag(r.score_got,r.score_total)}</td>
          <td style="font-size:12px;color:var(--slate);white-space:nowrap">${esc(r.time_taken||'—')}</td>
          <td style="font-size:12px;color:var(--slate);white-space:nowrap">${fmtDate(r.submitted_at)}</td>
        </tr>`).join('')}
        </tbody>
      </table></div>`;
  }catch(e){
    pb.innerHTML=`<div class="empty" style="padding:30px;color:var(--err)"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(e.message)}</div>`;
  }
};

/* ── ManPower Requisition Form ── */
let MP_RECORDS=null;
const MP_DEPTS=['Sales','Pre Sales','Channel Partner','Marketing','Accounts','Finance','IT','HR','Legal','Operations','Facility & Maintenance','Procurement','Admin','Other'];
const MP_EXP=['Fresher (0-1 yr)','1-2 years','2-3 years','3-4 years','3-5 years','4-6 years','5-7 years','7-10 years','10+ years','As per norms'];
const MP_SAL=['As per Company norms','Upto ₹10,000','₹10,000 - ₹15,000','₹15,000 - ₹20,000','₹20,000 - ₹25,000','₹25,000 - ₹30,000','₹30,000 - ₹40,000','₹40,000 - ₹55,000','₹55,000 - ₹75,000','Above ₹75,000','Negotiable'];
const MP_GEND=['Male','Female','Male / Female','Any'];
function mpToDateInput(s){
  if(!s)return '';
  if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.substring(0,10);
  const m=s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})$/);
  if(m){const y=m[3].length===2?'20'+m[3]:m[3];return y+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');}
  return '';
}
function mpFmtDate(s){
  const d=mpToDateInput(s);
  if(!d)return s||'—';
  const[y,mo,day]=d.split('-');
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return day+' '+months[parseInt(mo)-1]+' '+y;
}
function mpSelOpt(id,opts,val){
  const known=opts.includes(val);
  let h=`<select id="${id}Sel" class="sel" onchange="mpSelChange('${id}')">`;
  h+=opts.map(o=>`<option${o===val?' selected':''}>${esc(o)}</option>`).join('');
  h+=`<option value="__other"${!known&&val?' selected':''}>Other (type below)</option></select>`;
  h+=`<input id="${id}Custom" class="inp" style="margin-top:6px;display:${known||!val?'none':'block'}" value="${esc(!known?val:'')}">`;
  return h;
}
async function recManpower(){
  const b=$('recBody');
  if(!MP_RECORDS){
    b.innerHTML='<div class="empty" style="padding:40px"><i class="fa-solid fa-spinner fa-spin"></i></div>';
    try{const {data,error}=await sb.schema('hr').from('manpower_requests').select('*').order('submitted_at',{ascending:false});
      if(error)throw error; MP_RECORDS=data||[];}catch(e){b.innerHTML='<div class="empty" style="padding:40px;color:#c83232">'+esc(e.message)+'</div>';return;}
  }
  const rows=MP_RECORDS;
  const priTag=p=>p==='Urgent'?'<span class="tag t-red">Urgent</span>':'<span class="tag t-gray">'+(p||'—')+'</span>';
  const dis='opacity:.38;cursor:not-allowed;pointer-events:none';
  b.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <div class="sec-title" style="margin:0">ManPower Requisitions <span class="tag t-gray" style="margin-left:4px">${rows.length}</span></div>
    <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap" id="mpToolbar">
      <button class="btn btn-primary" onclick="mpFillForm()"><i class="fa-solid fa-pen-to-square"></i> Fill Form</button>
      <button class="btn" id="mpEditBtn" disabled style="${dis}" onclick="mpEditSel()"><i class="fa-solid fa-pen"></i> Edit</button>
      <button class="btn" id="mpDelBtn" disabled style="${dis};color:var(--err);border-color:var(--err)" onclick="mpDeleteSel()"><i class="fa-solid fa-trash"></i> Delete</button>
    </div>
  </div>
  <div style="overflow-x:auto">
  <table class="tbl" id="mpTbl">
    <thead><tr>
      <th style="width:36px;text-align:center"><input type="checkbox" id="mpChkAll" onchange="mpToggleAll(this)"></th>
      <th>Job Title</th><th>Department</th><th>Date of Request</th>
      <th style="text-align:center">Vacancy</th><th>Reporting To / HOD</th><th>Experience</th><th>Salary Range</th><th>Location</th><th>Priority</th>
    </tr></thead>
    <tbody>${rows.length?rows.map(r=>`<tr class="mp-row" style="cursor:pointer" onclick="mpShowDetail(${r.id},event)">
      <td style="text-align:center" onclick="event.stopPropagation()"><input type="checkbox" class="mp-chk" value="${r.id}" onchange="mpSyncToolbar()"></td>
      <td style="font-weight:600">${esc(r.job_title||'—')}</td>
      <td>${esc(r.department||'—')}</td>
      <td style="color:var(--slate);font-size:12px;white-space:nowrap">${esc(mpFmtDate(r.date_of_request))}</td>
      <td style="text-align:center">${esc(String(r.no_of_vacancy||'—'))}</td>
      <td style="font-size:12px">${esc(r.reporting_person||'—')}</td>
      <td style="font-size:12px">${esc(r.experience||'—')}</td>
      <td style="font-size:12px">${esc(r.salary_range||'—')}</td>
      <td>${esc(r.location||'—')}</td>
      <td>${priTag(r.priority)}</td>
    </tr>`).join(''):'<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--slate)">No requisitions yet — click <b>Fill Form</b> to add one</td></tr>'}
    </tbody>
  </table>
  </div>
  <div id="mpDetail" style="display:none"></div>`;
}
window.mpToggleAll=function(el){document.querySelectorAll('.mp-chk').forEach(c=>c.checked=el.checked);mpSyncToolbar();};
window.mpSyncToolbar=function(){
  const sel=[...document.querySelectorAll('.mp-chk:checked')];
  const n=sel.length;
  const dis='opacity:.38;cursor:not-allowed;pointer-events:none';
  const editBtn=$('mpEditBtn'),delBtn=$('mpDelBtn');
  if(editBtn){editBtn.disabled=n!==1;editBtn.style.cssText=n===1?'':'opacity:.38;cursor:not-allowed;pointer-events:none';}
  if(delBtn){delBtn.disabled=n===0;delBtn.style.cssText=n>0?'color:var(--err);border-color:var(--err)':'opacity:.38;cursor:not-allowed;pointer-events:none;color:var(--err);border-color:var(--err)';}
};
window.mpEditSel=function(){if(!recGuard())return;
  const sel=[...document.querySelectorAll('.mp-chk:checked')];
  if(sel.length!==1)return;
  mpEdit(parseInt(sel[0].value));
};
window.mpDeleteSel=async function(){if(!recGuard())return;
  const sel=[...document.querySelectorAll('.mp-chk:checked')].map(c=>parseInt(c.value));
  if(!sel.length)return;
  if(!await confirmDialog('Delete '+sel.length+' requisition(s)? This cannot be undone.'))return;
  const {error}=await sb.schema('hr').from('manpower_requests').delete().in('id',sel);
  if(error){toast(error.message,'err');return;}
  if(MP_RECORDS)MP_RECORDS=MP_RECORDS.filter(r=>!sel.includes(r.id));
  toast(sel.length+' deleted');recManpower();
};
window.mpShowDetail=function(id,e){
  if(e&&e.target&&e.target.type==='checkbox')return;
  const rec=(MP_RECORDS||[]).find(r=>r.id===id);if(!rec)return;
  const panel=$('mpDetail');if(!panel)return;
  const priTag=p=>p==='Urgent'?'<span class="tag t-red">Urgent</span>':'<span class="tag t-gray">'+(p||'—')+'</span>';
  // Highlight active row
  document.querySelectorAll('.mp-row').forEach(tr=>tr.style.background='');
  const rows=[...document.querySelectorAll('.mp-row')];
  const activeRow=rows.find(tr=>{const chk=tr.querySelector('.mp-chk');return chk&&parseInt(chk.value)===id;});
  if(activeRow)activeRow.style.background='#fdf4f6';
  panel.style.display='block';
  panel.innerHTML=`<div class="card card-pad" style="margin-top:14px;position:relative">
    <button style="position:absolute;top:12px;right:12px;background:none;border:none;cursor:pointer;font-size:18px;color:var(--slate);line-height:1" onclick="mpCloseDetail()">&times;</button>
    <div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;padding-right:32px">
      <div style="flex:1;min-width:220px">
        <div style="font-size:18px;font-weight:700;color:var(--ink)">${esc(rec.job_title||'—')}</div>
        <div style="color:var(--slate);font-size:13px;margin-top:2px">${esc(rec.department||'—')} &nbsp;·&nbsp; ${mpFmtDate(rec.date_of_request)}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        ${priTag(rec.priority)}
        <button class="btn btn-sm btn-primary" onclick="mpEdit(${rec.id})"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn btn-sm" style="color:var(--err);border-color:var(--err)" onclick="mpDeleteOne(${rec.id})"><i class="fa-solid fa-trash"></i> Delete</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px 20px;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
      <div><div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--slate);letter-spacing:.04em">Vacancies</div><div style="font-size:14px;margin-top:2px">${esc(String(rec.no_of_vacancy||'—'))}</div></div>
      <div><div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--slate);letter-spacing:.04em">Reporting To / HOD</div><div style="font-size:14px;margin-top:2px">${esc(rec.reporting_person||'—')}</div></div>
      <div><div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--slate);letter-spacing:.04em">Qualification</div><div style="font-size:14px;margin-top:2px">${esc(rec.qualification||'—')}</div></div>
      <div><div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--slate);letter-spacing:.04em">Experience</div><div style="font-size:14px;margin-top:2px">${esc(rec.experience||'—')}</div></div>
      <div><div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--slate);letter-spacing:.04em">Gender</div><div style="font-size:14px;margin-top:2px">${esc(rec.gender||'—')}</div></div>
      <div><div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--slate);letter-spacing:.04em">Salary Range</div><div style="font-size:14px;margin-top:2px">${esc(rec.salary_range||'—')}</div></div>
      <div><div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--slate);letter-spacing:.04em">Location</div><div style="font-size:14px;margin-top:2px">${esc(rec.location||'—')}</div></div>
    </div>
    ${rec.job_description?`<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)"><div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--slate);letter-spacing:.04em;margin-bottom:6px">Job Description / KPI</div><div style="font-size:13.5px;white-space:pre-wrap;line-height:1.6;color:var(--ink)">${esc(rec.job_description)}</div></div>`:''}
    ${rec.notes?`<div style="margin-top:12px;padding:10px 14px;background:#fefce8;border-radius:8px;border:1px solid #fde68a"><span style="font-size:11px;font-weight:700;text-transform:uppercase;color:#a16207">Note · </span><span style="font-size:13px;color:#78350f">${esc(rec.notes)}</span></div>`:''}
  </div>`;
};
window.mpCloseDetail=function(){
  const p=$('mpDetail');if(p)p.style.display='none';
  document.querySelectorAll('.mp-row').forEach(tr=>tr.style.background='');
};
window.mpSelChange=function(id){
  const sel=$(`${id}Sel`),cust=$(`${id}Custom`);
  if(sel&&cust)cust.style.display=sel.value==='__other'?'block':'none';
};
function mpGetField(id,opts){
  const sel=$(id+'Sel'),cust=$(id+'Custom');
  if(!sel)return '';
  return sel.value==='__other'?(cust?cust.value.trim():''):sel.value;
}
function mpModal(title,vals,saveBtn){
  const locs=['HO','Site/Project Name','Durgapur','Siliguri'];
  const selLocs=vals&&vals.location?vals.location.split(',').map(s=>s.trim()):[];
  const locChk=locs.map(l=>`<label style="display:inline-flex;align-items:center;gap:5px;margin-right:14px;margin-bottom:4px"><input type="checkbox" class="mp-loc" value="${l}"${selLocs.includes(l)?' checked':''}> ${l}</label>`).join('');
  const dateVal=mpToDateInput(vals&&vals.date_of_request||'');
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-file-pen"></i> ${title}</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm" style="max-height:72vh;overflow-y:auto">
    <div class="two">
      <div><label>Job Title *</label><input id="mpFTitle" class="inp" value="${esc(vals&&vals.job_title||'')}" placeholder="e.g. Sales Executive"></div>
      <div><label>Date of Request *</label><input id="mpFDate" type="date" class="inp" value="${dateVal}"></div>
    </div>
    <div class="two">
      <div><label>Department *</label>${mpSelOpt('mpFDept',MP_DEPTS,vals&&vals.department||'')}</div>
      <div><label>No. of Vacancy *</label><input id="mpFVac" class="inp" value="${esc(vals&&vals.no_of_vacancy||'')}" placeholder="e.g. 2"></div>
    </div>
    <div class="two">
      <div><label>Reporting Person / HOD *</label><input id="mpFHOD" class="inp" value="${esc(vals&&vals.reporting_person||'')}" placeholder="Name"></div>
      <div><label>Required Qualification</label><input id="mpFQual" class="inp" value="${esc(vals&&vals.qualification||'')}" placeholder="e.g. Graduate, B.Tech"></div>
    </div>
    <div class="two">
      <div><label>Experience</label>${mpSelOpt('mpFExp',MP_EXP,vals&&vals.experience||'')}</div>
      <div><label>Gender</label><select id="mpFGender" class="sel"><option value="">— Select —</option>${MP_GEND.map(g=>`<option${g===(vals&&vals.gender||'')?'  selected':''}>${g}</option>`).join('')}<option value="Other"${!MP_GEND.includes(vals&&vals.gender||'')?'  selected':''}>Other</option></select></div>
    </div>
    <div><label>Salary Range</label>${mpSelOpt('mpFSalary',MP_SAL,vals&&vals.salary_range||'')}</div>
    <div><label>Location</label><div style="display:flex;flex-wrap:wrap;margin-top:6px">${locChk}</div></div>
    <div><label>Job Description / KPI</label><textarea id="mpFJD" class="inp" rows="4" placeholder="Key responsibilities and requirements...">${esc(vals&&vals.job_description||'')}</textarea></div>
    <div><label>Priority</label><div style="display:flex;gap:20px;margin-top:6px">
      <label style="display:inline-flex;align-items:center;gap:5px"><input type="radio" name="mpPri" value="Urgent"${vals&&vals.priority==='Urgent'?' checked':''}> <span style="color:#c83232;font-weight:600">Urgent</span></label>
      <label style="display:inline-flex;align-items:center;gap:5px"><input type="radio" name="mpPri" value="Not Urgent"${vals&&vals.priority==='Not Urgent'?' checked':!vals?' checked':''}> Not Urgent</label>
    </div><div style="font-size:11.5px;color:var(--slate);margin-top:4px">Kindly use Urgent only in rare cases (sudden absence/resignation). Non Urgent is default.</div></div>
    <div><label>Notes / Reason</label><textarea id="mpFNotes" class="inp" rows="2" placeholder="Any additional context...">${esc(vals&&vals.notes||'')}</textarea></div>
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>${saveBtn}</div>`);
}
function mpCollect(){
  const locs=[...document.querySelectorAll('.mp-loc:checked')].map(el=>el.value).join(', ');
  const pri=(document.querySelector('input[name="mpPri"]:checked')||{}).value||'Not Urgent';
  const rawDate=$('mpFDate')&&$('mpFDate').value?$('mpFDate').value:'';
  let fmtDate=rawDate;
  if(rawDate&&/^\d{4}-\d{2}-\d{2}$/.test(rawDate)){const[y,mo,d]=rawDate.split('-');fmtDate=d+'/'+mo+'/'+y;}
  return {
    job_title:($('mpFTitle').value||'').trim(),
    date_of_request:fmtDate,
    department:mpGetField('mpFDept',MP_DEPTS),
    no_of_vacancy:($('mpFVac').value||'').trim(),
    reporting_person:($('mpFHOD').value||'').trim(),
    qualification:($('mpFQual').value||'').trim(),
    experience:mpGetField('mpFExp',MP_EXP),
    gender:$('mpFGender')&&$('mpFGender').value&&$('mpFGender').value!=='— Select —'?$('mpFGender').value:'',
    salary_range:mpGetField('mpFSalary',MP_SAL),
    location:locs,
    job_description:($('mpFJD').value||'').trim(),
    priority:pri,
    notes:($('mpFNotes').value||'').trim(),
    submitted_at:new Date().toISOString()
  };
}
window.mpFillForm=function(){if(!recGuard())return;mpModal('ManPower Requisition Form',null,'<button class="btn btn-primary" id="mpSaveBtn" onclick="mpSave()"><i class="fa-solid fa-check"></i> Submit</button>');};
window.mpSave=async function(){
  const d=mpCollect();
  if(!d.job_title){toast('Job Title is required','err');return;}
  const btn=$('mpSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const {data,error}=await sb.schema('hr').from('manpower_requests').insert(d).select().single();
  if(error){toast(error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Submit';}return;}
  MP_RECORDS=[data,...(MP_RECORDS||[])];closeModal();toast('Requisition submitted');recManpower();
};
window.mpEdit=function(id){if(!recGuard())return;
  const rec=(MP_RECORDS||[]).find(r=>r.id===id);if(!rec)return;
  mpModal('Edit Requisition',rec,`<button class="btn btn-primary" id="mpSaveBtn" onclick="mpUpdate(${id})"><i class="fa-solid fa-check"></i> Update</button>`);
};
window.mpUpdate=async function(id){
  const d=mpCollect();delete d.submitted_at;
  const btn=$('mpSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const {data,error}=await sb.schema('hr').from('manpower_requests').update(d).eq('id',id).select().single();
  if(error){toast(error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Update';}return;}
  const idx=(MP_RECORDS||[]).findIndex(r=>r.id===id);
  if(idx>-1&&MP_RECORDS)MP_RECORDS[idx]=data;
  closeModal();toast('Updated');recManpower();
};
window.mpDeleteOne=async function(id){if(!recGuard())return;
  if(!await confirmDialog('Delete this requisition?'))return;
  const {error}=await sb.schema('hr').from('manpower_requests').delete().eq('id',id);
  if(error){toast(error.message,'err');return;}
  if(MP_RECORDS)MP_RECORDS=MP_RECORDS.filter(r=>r.id!==id);
  toast('Deleted');recManpower();
};
window.mpDelete=window.mpDeleteOne;
window.mpReload=function(){MP_RECORDS=null;if(PAGE==='recruitment')renderPage();};

async function recLoadJDs(v){
  REC_SEL=new Set();
  let uploaded=[];
  try{const {data,error}=await sb.schema('recruit').from('job_descriptions').select('*').order('created_at',{ascending:true});if(!error)uploaded=data||[];}catch(e){}
  const uploadedCards=uploaded.map(jd=>({...jd,isDefault:false}));
  const allJDs=[...DEFAULT_JDS,...uploadedCards];
  window._recAllJDs=allJDs;
  const n=REC_SEL.size;
  const dis='opacity:.38;cursor:not-allowed;pointer-events:none';
  $('recBody').innerHTML=`
    <div id="recBar" style="display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="recUploadModal()"><i class="fa-solid fa-upload"></i> Upload JD</button>
      <button class="btn" ${n===0?'disabled':''} style="${n===0?dis:''}" onclick="recDownloadSel()"><i class="fa-solid fa-download"></i> Download</button>
      <button class="btn" ${n===0?'disabled':''} style="${n===0?dis:'color:var(--err)'}" onclick="recDeleteSel()"><i class="fa-solid fa-trash"></i> Delete</button>
      ${n>0?`<span style="font-size:12px;color:var(--slate)">${n} selected</span>`:''}
    </div>
    <div class="grid lib-grid" id="recGrid">
      ${allJDs.map(jd=>recJDCard(jd)).join('')}
    </div>`;
}
window.recJdOpen=async function(id){
  const jd=(window._recAllJDs||[]).find(j=>j.id===id);if(!jd)return;
  if(jd.isDefault){window.open(jd.url,'_blank');return;}
  if(isS3Path(jd.storage_path)){await s3OpenSigned(jd.storage_path);return;}
  const {data,error}=await sb.storage.from('recruitment').createSignedUrl(jd.storage_path,300);
  if(error){toast('Could not open file: '+error.message,'err');return;}
  window.open(data.signedUrl,'_blank');
};
window.recJdDownload=async function(id){
  const jd=(window._recAllJDs||[]).find(j=>j.id===id);if(!jd)return;
  if(jd.isDefault){const a=document.createElement('a');a.href=jd.url;a.download=jd.name+'.pdf';a.click();return;}
  if(isS3Path(jd.storage_path)){await s3OpenSigned(jd.storage_path,jd.name+'.pdf');return;}
  const {data,error}=await sb.storage.from('recruitment').createSignedUrl(jd.storage_path,300);
  if(error){toast('Could not download file: '+error.message,'err');return;}
  const a=document.createElement('a');a.href=data.signedUrl;a.download=jd.name+'.pdf';a.click();
};
function recJDCard(jd){
  const sel=REC_SEL.has(jd.id);
  return `<div class="card card-pad lib-card${sel?' selected':''}" id="rjd_${jd.id}" style="cursor:pointer;border:2px solid ${sel?'var(--brand)':'var(--line)'};position:relative" onclick="recToggleSel('${jd.id}')" ondblclick="event.stopPropagation();recJdOpen('${jd.id}')">
    ${sel?`<div style="position:absolute;top:10px;right:10px;width:20px;height:20px;background:var(--brand);border-radius:50%;display:flex;align-items:center;justify-content:center"><i class="fa-solid fa-check" style="color:#fff;font-size:10px"></i></div>`:''}
    ${jd.isDefault?`<div style="position:absolute;top:10px;left:10px"><span class="tag t-gray" style="font-size:10px">Default</span></div>`:''}
    <div style="display:flex;align-items:center;gap:12px;${jd.isDefault?'margin-top:18px':''}">
      <div style="width:44px;height:48px;background:#fff5f5;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:1px solid #fecaca">
        <i class="fa-solid fa-file-pdf" style="color:#dc2626;font-size:20px"></i>
      </div>
      <div style="min-width:0">
        <div style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(jd.name)}</div>
        ${!jd.isDefault&&jd.file_name?`<div style="font-size:11.5px;color:var(--slate);margin-top:2px">${esc(jd.file_name)}</div>`:''}
      </div>
    </div>
    <div style="margin-top:12px;display:flex;gap:8px">
      <button class="btn btn-sm" style="flex:1" onclick="event.stopPropagation();recJdOpen('${jd.id}')"><i class="fa-solid fa-eye"></i> Preview</button>
      <button class="btn btn-sm" style="flex:1" onclick="event.stopPropagation();recJdDownload('${jd.id}')"><i class="fa-solid fa-download"></i> Download</button>
    </div>
  </div>`;
}
window.recToggleSel=function(id){
  if(REC_SEL.has(id))REC_SEL.delete(id);else REC_SEL.add(id);
  const jd=(window._recAllJDs||[]).find(j=>j.id===id);
  if(jd){const el=document.getElementById('rjd_'+id);if(el){const tmp=document.createElement('div');tmp.innerHTML=recJDCard(jd);el.replaceWith(tmp.firstElementChild);}}
  recRefreshBar();
};
window.recRefreshBar=function(){
  const n=REC_SEL.size;const dis='opacity:.38;cursor:not-allowed;pointer-events:none';
  const bar=$('recBar');if(!bar)return;
  bar.innerHTML=`<button class="btn btn-primary" onclick="recUploadModal()"><i class="fa-solid fa-upload"></i> Upload JD</button>
    <button class="btn" ${n===0?'disabled':''} style="${n===0?dis:''}" onclick="recDownloadSel()"><i class="fa-solid fa-download"></i> Download</button>
    <button class="btn" ${n===0?'disabled':''} style="${n===0?dis:'color:var(--err)'}" onclick="recDeleteSel()"><i class="fa-solid fa-trash"></i> Delete</button>
    ${n>0?`<span style="font-size:12px;color:var(--slate)">${n} selected</span>`:''}`;
};
window.recUploadModal=function(){if(!recGuard())return;
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-file-pdf"></i> Upload Job Description</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>Position / Title</label><input id="recJdName" placeholder="e.g. General Manager Commercial">
    <label>PDF File</label><input type="file" id="recJdFile" accept="application/pdf">
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="recJdSaveBtn" onclick="recJdSave()"><i class="fa-solid fa-upload"></i> Upload</button></div>`);
};
window.recJdSave=async function(){
  const name=$('recJdName').value.trim();const file=$('recJdFile').files[0];
  if(!name){toast('Enter a position name','err');return;}
  if(!file){toast('Select a PDF file','err');return;}
  const btn=$('recJdSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Uploading…';}
  const key=s3KeyForJD(file.name);
  // Ensure session is fresh before upload
  const {data:{session:_sess}}=await sb.auth.getSession();
  if(!_sess){toast('Session expired — please sign in again','err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-upload"></i> Upload';}return;}
  const {data:upData,error:se}=await uploadFileToS3(key,file);
  if(se){toast('Upload failed: '+se.message,'err');console.error('JD S3 upload error',se);if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-upload"></i> Upload';}return;}
  const {error:de}=await sb.schema('recruit').from('job_descriptions').insert({name,storage_path:upData.path,file_name:file.name,file_size:file.size,uploaded_by:state.email});
  if(de){toast(de.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-upload"></i> Upload';}return;}
  closeModal();toast(name+' uploaded to S3','ok');recLoadJDs($('view'));
};
window.recDownloadSel=async function(){
  let jds=[];try{const {data}=await sb.schema('recruit').from('job_descriptions').select('*');jds=data||[];}catch(e){}
  for(const jd of jds.filter(j=>REC_SEL.has(j.id))){
    if(isS3Path(jd.storage_path)){
      await s3OpenSigned(jd.storage_path,jd.name+'.pdf');
    }else{
      const {data,error}=await sb.storage.from('recruitment').createSignedUrl(jd.storage_path,300);
      if(!error){const a=document.createElement('a');a.href=data.signedUrl;a.download=jd.name+'.pdf';a.click();}
    }
    await new Promise(r=>setTimeout(r,300));
  }
};
window.recDeleteSel=async function(){if(!recGuard())return;
  if(!REC_SEL.size)return;
  if(!await confirmDialog(`Delete ${REC_SEL.size} file(s)?`))return;
  let jds=[];try{const {data}=await sb.schema('recruit').from('job_descriptions').select('*');jds=data||[];}catch(e){}
  const toDelete=jds.filter(j=>REC_SEL.has(j.id));
  for(const jd of toDelete){
    if(!jd.storage_path)continue;
    if(isS3Path(jd.storage_path))await s3Delete(jd.storage_path);
    else await sb.storage.from('recruitment').remove([jd.storage_path]);
  }
  const ids=toDelete.map(j=>j.id);
  if(ids.length)await sb.schema('recruit').from('job_descriptions').delete().in('id',ids);
  REC_SEL=new Set();toast('Deleted','ok');recLoadJDs($('view'));
};

VIEWS.finance=function(v){
  setCrumb(['Governance','Finance Vault']);
  const kpis=[['Collections (FY)','₹121 Cr',''],['Outstanding dues','₹4.1 Cr',''],['Payables open','₹2.6 Cr','37 POs'],['Net group cash','₹13.5 Cr','']];
  const roll=(title,rows)=>'<div class="card card-pad"><div class="sec-title" style="margin:0 0 12px">'+title+'</div>'+rows.map(r=>'<div style="display:flex;justify-content:space-between;padding:11px 0;border-bottom:1px solid var(--line-2)"><span>'+esc(r[0])+'</span><b>'+esc(r[1])+'</b></div>').join('')+'</div>';
  v.innerHTML=mHead('fa-indian-rupee-sign','#15803d','Finance Vault')+
    '<div class="card card-pad" style="background:#fffbeb;border-color:#f0dfa8;margin-bottom:16px;font-size:13.5px"><i class="fa-solid fa-lock" style="color:#d98a00"></i> <b>Super-admin only.</b> Every table here is gated by RLS to the director role; the publishable key cannot read it.</div>'+
    mKpis(kpis)+
    '<div class="m2grid">'+roll('Collections roll-up (from CRM)',[['Dream Valley Ph-2','₹48.0 Cr'],['Jain Heights','₹39.5 Cr'],['Green Acres','₹28.0 Cr'],['Trade Centre','₹18.5 Cr'],['Royal Enclave','₹7.8 Cr']])+roll('Payables roll-up (from Procurement)',[['Contractor RA bills','₹1.42 Cr'],['Material POs','₹0.78 Cr'],['Service work orders','₹0.26 Cr'],['Vendor advances','₹0.14 Cr']])+'</div>';
};
VIEWS.compliance=function(v,seg){
  setCrumb(['Governance','Renewals & Compliance']);
  const tabs=['Compliance calendar','Licences repository','Warranties & guarantees'];const ti=mTab(seg,tabs.length);
  const kpis=[['Due in 30 days','14',''],['Overdue','2','action needed','#c83232'],['Licences tracked','58',''],['AMCs active','23','']];
  let body;
  if(ti===0){ body='<p style="color:var(--slate);font-size:13px;margin:6px 0 14px">Statutory and contractual due dates (RERA QPR, GST, TDS, PF/ESI/PT, labour, fire, lift, environment) with owners. Alerts surface into My Tasks and e-mail reminders.</p>'+mTable(['Due date','Obligation','Category','Owner','Status'],[['07 Jul','Salary TDS deposit','Statutory · TDS','Finance','<span class="tag t-amber">Pending</span>'],['10 Jul','Professional Tax (MP)','Statutory · PT','HR','<span class="tag t-amber">Pending</span>'],['11 Jul','GST GSTR-3B','Statutory · GST','Finance','<span class="tag t-blue">Scheduled</span>'],['15 Jul','PF + ESI deposit','Statutory · Labour','HR','<span class="tag t-purple">Computed</span>']]); }
  else if(ti===1){ body=mTable(['Licence','Authority','Project','Expiry','Status'],[['RERA — Dream Valley','MahaRERA','Dream Valley','14 Aug','Active'],['Fire NOC','Fire Dept','Jain Heights','02 Jul','Due soon']]); }
  else { body=mTable(['Item','Asset','Provider','Expiry','Status'],[['Lift AMC','Passenger lift','OTIS','Mar-27','Active'],['DG warranty','DG Set 250 kVA','Cummins','Dec-26','Active']]); }
  v.innerHTML=mHead('fa-calendar-check','#b45309','Renewals & Compliance')+mKpis(kpis)+mTabs('compliance',tabs,ti)+'<div style="margin-top:14px">'+body+'</div>';
};
let CMP_PERIOD='today',CMP_SINCE='',CMP_UNTIL='',CMP_LAST=null,CMP_AD_PROJECT='all',CMP_AD_PAGE=0,CMP_SOURCE='meta',CMP_STATUS='all',CMP_CAMP_PROJECT='all';
window.cmpSetStatus=function(s){CMP_STATUS=s;CMP_AD_PAGE=0;renderPage();};
function cmpStatusBar(counts){
  const b=function(k,label){return '<button class="cmp-fbtn'+(CMP_STATUS===k?' on':'')+'" onclick="cmpSetStatus(\''+k+'\')">'+esc(label)+(counts&&counts[k]!=null?(' <span class="cmp-fcount">'+counts[k]+'</span>'):'')+'</button>';};
  return '<div class="cmp-fbar">'+b('all','All')+b('active','Active')+b('inactive','Inactive')+'</div>';
}
function cmpIsActive(st){const s=String(st||'').toUpperCase();return s==='ACTIVE'||s==='ENABLED';}
const CMP_PRESETS=[['today','Today'],['yesterday','Yesterday'],['last_7d','Last 7 days'],['last_14d','Last 14 days'],['last_month','Last month'],['last_year','Last year'],['custom','Custom']];

/* ============ Trend / Fatigue / Best-&-Worst (shared by the Meta, Google and Both tabs) ============
   "Trend" = this period compared with the SAME-LENGTH period immediately before it. We ask the live
   sync functions for that earlier window too (as a custom range), then compare the two. */
function cmpDayStr(d){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),dd=String(d.getDate()).padStart(2,'0');return y+'-'+m+'-'+dd;}
function cmpAddDays(d,n){const x=new Date(d.getTime());x.setDate(x.getDate()+n);return x;}
// The equivalent window immediately before the one being viewed.
function cmpPrevRange(){
  const today=new Date();today.setHours(12,0,0,0);
  const P=CMP_PERIOD;
  if(P==='today'){const d=cmpAddDays(today,-1);return {since:cmpDayStr(d),until:cmpDayStr(d)};}
  if(P==='yesterday'){const d=cmpAddDays(today,-2);return {since:cmpDayStr(d),until:cmpDayStr(d)};}
  if(P==='last_7d')return {since:cmpDayStr(cmpAddDays(today,-14)),until:cmpDayStr(cmpAddDays(today,-8))};
  if(P==='last_14d')return {since:cmpDayStr(cmpAddDays(today,-28)),until:cmpDayStr(cmpAddDays(today,-15))};
  if(P==='last_month'){const first=new Date(today.getFullYear(),today.getMonth()-2,1);const last=new Date(today.getFullYear(),today.getMonth()-1,0);return {since:cmpDayStr(first),until:cmpDayStr(last)};}
  if(P==='last_year')return {since:cmpDayStr(cmpAddDays(today,-729)),until:cmpDayStr(cmpAddDays(today,-365))};
  if(P==='custom'&&CMP_SINCE&&CMP_UNTIL){
    const s=new Date(CMP_SINCE+'T12:00:00'),u=new Date(CMP_UNTIL+'T12:00:00');
    const len=Math.max(1,Math.round((u-s)/86400000)+1);
    return {since:cmpDayStr(cmpAddDays(s,-len)),until:cmpDayStr(cmpAddDays(s,-1))};
  }
  return null;
}
function cmpPrevKey(){const p=cmpPrevRange();return p?('custom:'+p.since+':'+p.until):null;}
function cmpPrevLabel(){const p=cmpPrevRange();return p?(p.since===p.until?p.since:(p.since+' → '+p.until)):'previous period';}
// Sync the previous window for META only — google-ads-live now fills both buckets in one call
// (see its prev_since/prev_until parameters), so asking it twice is unnecessary.
async function cmpSyncPrev(which){
  if(which!=='meta'&&which!=='both')return;
  const p=cmpPrevRange(); if(!p)return;
  try{
    const {data:{session}}=await sb.auth.getSession();const token=session&&session.access_token;
    const hdr={'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY};
    await fetch(SUPABASE_URL+'/functions/v1/campaign-analytics-live',{method:'POST',headers:hdr,body:JSON.stringify({level:'campaign',period:'custom',since:p.since,until:p.until})}).catch(function(){});
  }catch(e){}
}
// Trend pill. lowerIsBetter=true for cost metrics (a fall is good).
function cmpTrend(cur,prev,lowerIsBetter){
  cur=Number(cur)||0;
  if(prev===null||prev===undefined||!isFinite(Number(prev))||Number(prev)===0){
    return '<span class="cmp-tr none" title="No data for '+esc(cmpPrevLabel())+' to compare against">—</span>';
  }
  prev=Number(prev);
  const pct=(cur-prev)/Math.abs(prev)*100;
  if(Math.abs(pct)<1)return '<span class="cmp-tr flat" title="Barely changed vs '+esc(cmpPrevLabel())+'"><i class="fa-solid fa-minus"></i> 0%</span>';
  const up=pct>0, good=lowerIsBetter?!up:up;
  const tip=(up?'Up ':'Down ')+Math.abs(pct).toFixed(0)+'% vs '+cmpPrevLabel()+(good?' — better':' — worse');
  return '<span class="cmp-tr '+(good?'good':'bad')+'" title="'+esc(tip)+'"><i class="fa-solid '+(up?'fa-arrow-trend-up':'fa-arrow-trend-down')+'"></i> '+(up?'+':'−')+Math.abs(pct).toFixed(0)+'%</span>';
}
/* Ad fatigue. Meta gives a real per-person "frequency" (how many times each person saw the ad) —
   high frequency plus a falling CTR is classic creative burnout. Google Ads has no per-user
   frequency for Search, so there we score on the CTR fall alone. */
function cmpFatigue(freq,ctr,prevCtr){
  const f=Number(freq)||0;
  const c=(ctr==null)?null:Number(ctr), pc=(prevCtr==null)?null:Number(prevCtr);
  const drop=(pc&&pc>0&&c!=null)?(1-(c/pc)):null;
  if(!f&&drop===null)return '<span class="cmp-fg na" title="Not enough data yet">—</span>';
  let score=0;
  if(f>=4)score+=2;else if(f>=3)score+=1.5;else if(f>=2.5)score+=1;
  if(drop!==null&&drop>=0.30)score+=2;else if(drop!==null&&drop>=0.15)score+=1;
  const bits=[];
  if(f)bits.push('Seen '+f.toFixed(1)+'x per person');
  if(drop!==null)bits.push(drop>0?('CTR down '+Math.round(drop*100)+'%'):('CTR up '+Math.round(-drop*100)+'%'));
  const tip=bits.join(' · ')||'No signal';
  if(score>=3)return '<span class="cmp-fg hi" title="'+esc(tip+' — refresh the creative')+'"><i class="fa-solid fa-fire"></i> High</span>';
  if(score>=1.5)return '<span class="cmp-fg md" title="'+esc(tip+' — keep an eye on it')+'"><i class="fa-solid fa-triangle-exclamation"></i> Watch</span>';
  return '<span class="cmp-fg ok" title="'+esc(tip)+'"><i class="fa-solid fa-circle-check"></i> Fresh</span>';
}
/* ---------------- TREND page ----------------
   rows = [{name, sub, spend, pspend, res, pres, cpr, pcpr, ctr, pctr}] */
function cmpTrendPage(rows,totals,inr,num,resLabel){
  const chg=function(cur,prev){ if(prev==null||!isFinite(Number(prev))||Number(prev)===0)return null; return (Number(cur||0)-Number(prev))/Math.abs(Number(prev))*100; };
  const mrow=function(label,cur,prev,fmt,lowerIsBetter){
    const c=chg(cur,prev);
    return '<tr><td class="cmp-mlbl">'+esc(label)+'</td>'
      +'<td class="num muted">'+fmt(prev)+'</td>'
      +'<td class="num strong">'+fmt(cur)+'</td>'
      +'<td class="num">'+cmpTrend(cur,prev,lowerIsBetter)+'</td>'
      +'<td class="cmp-bar">'+(c==null?'':('<span class="cmp-barfill '+(((lowerIsBetter?-c:c)>=0)?'up':'down')+'" style="width:'+Math.min(100,Math.abs(c))+'%"></span>'))+'</td></tr>';
  };
  const summary='<div class="cmp-panel"><div class="cmp-phead"><div><span class="cmp-over">Period comparison</span><h3>This period vs the one before</h3></div><span class="cmp-chip">'+esc(cmpPrevLabel())+'</span></div>'
    +'<div class="cmp-tblwrap"><table class="cmp-tbl"><thead><tr><th>Metric</th><th class="num">Previous</th><th class="num">Current</th><th class="num">Change</th><th style="width:120px"></th></tr></thead><tbody>'
    +mrow('Spend',totals.spend,totals.pspend,inr,false)
    +mrow(resLabel.charAt(0).toUpperCase()+resLabel.slice(1),totals.res,totals.pres,function(v){return num(Math.round(Number(v)||0));},false)
    +mrow('Cost per '+resLabel.replace(/s$/,''),totals.cpr,totals.pcpr,function(v){return v==null?'—':inr(v);},true)
    +mrow('Clicks',totals.clk,totals.pclk,function(v){return num(Math.round(Number(v)||0));},false)
    +mrow('CTR',totals.ctr,totals.pctr,function(v){return (Number(v)||0).toFixed(2)+'%';},false)
    +'</tbody></table></div></div>';
  const sorted=rows.slice().sort(function(a,b){return (b.spend||0)-(a.spend||0);});
  const body=sorted.length?sorted.map(function(r){
    const c=chg(r.spend,r.pspend);
    return '<tr><td><div class="cmp-nm">'+esc(r.name)+'</div>'+(r.sub?'<div class="cmp-sub">'+esc(r.sub)+'</div>':'')+'</td>'
      +'<td class="num muted">'+inr(r.pspend||0)+'</td>'
      +'<td class="num strong">'+inr(r.spend||0)+'</td>'
      +'<td class="num">'+cmpTrend(r.spend,r.pspend,false)+'</td>'
      +'<td class="num muted">'+num(Math.round(r.pres||0))+'</td>'
      +'<td class="num strong">'+num(Math.round(r.res||0))+'</td>'
      +'<td class="num">'+cmpTrend(r.res,r.pres,false)+'</td>'
      +'<td class="num">'+(r.cpr!=null?inr(r.cpr):'—')+'</td>'
      +'<td class="num">'+cmpTrend(r.cpr,r.pcpr,true)+'</td></tr>';
  }).join(''):'<tr><td colspan="9" class="cmp-none">No data for this period</td></tr>';
  const detail='<div class="cmp-panel"><div class="cmp-phead"><div><span class="cmp-over">Breakdown</span><h3>Movement by '+esc(resLabel==='conversions'?'account':'project')+'</h3></div></div>'
    +'<div class="cmp-tblwrap"><table class="cmp-tbl"><thead><tr><th>Name</th><th class="num" colspan="3">Spend — prev / now / change</th><th class="num" colspan="3">'+esc(resLabel)+' — prev / now / change</th><th class="num" colspan="2">Cost / '+esc(resLabel.replace(/s$/,''))+'</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
  return summary+detail;
}
/* ---------------- AD FATIGUE page ----------------
   rows = [{name, sub, freq, ctr, pctr, spend, impr}] */
function cmpFatiguePage(rows,inr,num,note,hideFreq){
  const grade=function(r){
    const f=Number(r.freq)||0, c=(r.ctr==null?null:Number(r.ctr)), pc=(r.pctr==null?null:Number(r.pctr));
    const drop=(pc&&pc>0&&c!=null)?(1-(c/pc)):null;
    let s=0;
    if(f>=4)s+=2;else if(f>=3)s+=1.5;else if(f>=2.5)s+=1;
    if(drop!==null&&drop>=0.30)s+=2;else if(drop!==null&&drop>=0.15)s+=1;
    return {score:s,drop:drop,level:(s>=3?'hi':(s>=1.5?'md':'ok'))};
  };
  const scored=rows.map(function(r){return Object.assign({},r,{g:grade(r)});})
    .sort(function(a,b){ if(b.g.score!==a.g.score)return b.g.score-a.g.score; return (b.spend||0)-(a.spend||0); });
  const nHi=scored.filter(function(x){return x.g.level==='hi';}).length;
  const nMd=scored.filter(function(x){return x.g.level==='md';}).length;
  const nOk=scored.length-nHi-nMd;
  const stat=function(v,l,cls){return '<div class="cmp-stat '+cls+'"><div class="v">'+v+'</div><div class="l">'+esc(l)+'</div></div>';};
  const advice=function(x){
    if(x.g.level==='hi')return 'Refresh the creative — swap images/headlines';
    if(x.g.level==='md')return 'Watch it; plan a new variant';
    return 'Healthy';
  };
  // Google Ads publishes no per-person frequency, so on that source we drop the column entirely
  // rather than showing a row of dashes.
  const cols=hideFreq?7:8;
  const body=scored.length?scored.map(function(x){
    return '<tr><td><div class="cmp-nm">'+esc(x.name)+'</div>'+(x.sub?'<div class="cmp-sub">'+esc(x.sub)+'</div>':'')+'</td>'
      +(hideFreq?'':'<td class="num">'+(x.freq?(Number(x.freq).toFixed(1)+'×'):'—')+'</td>')
      +'<td class="num muted">'+(x.pctr!=null?(Number(x.pctr).toFixed(2)+'%'):'—')+'</td>'
      +'<td class="num strong">'+(x.ctr!=null?(Number(x.ctr).toFixed(2)+'%'):'—')+'</td>'
      +'<td class="num">'+(x.g.drop===null?'—':('<span class="'+(x.g.drop>0?'cmp-dn':'cmp-up')+'">'+(x.g.drop>0?'−':'+')+Math.abs(Math.round(x.g.drop*100))+'%</span>'))+'</td>'
      +'<td class="num">'+inr(x.spend||0)+'</td>'
      +'<td>'+cmpFatigue(x.freq,x.ctr,x.pctr)+'</td>'
      +'<td class="cmp-adv">'+esc(advice(x))+'</td></tr>';
  }).join(''):'<tr><td colspan="'+cols+'" class="cmp-none">Not enough data to judge fatigue yet</td></tr>';
  return '<div class="cmp-stats">'+stat(nHi,'Need refresh','hi')+stat(nMd,'Watching','md')+stat(nOk,'Healthy','ok')+'</div>'
    +'<div class="cmp-panel"><div class="cmp-phead"><div><span class="cmp-over">Ad fatigue</span><h3>Worst first</h3></div><span class="cmp-chip">'+esc(note||'')+'</span></div>'
    +'<div class="cmp-tblwrap"><table class="cmp-tbl"><thead><tr><th>Name</th>'+(hideFreq?'':'<th class="num">Seen / person</th>')+'<th class="num">CTR before</th><th class="num">CTR now</th><th class="num">Change</th><th class="num">Spend</th><th>Verdict</th><th>What to do</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
}
/* Refined, restrained visual language — neutral surfaces, one accent, no candy colours.
   Loaded AFTER each view's older inline styles so these rules win. */
const CMP_EXTRA_CSS='<style>'
  /* neutralise the old colourful KPI treatment */
  +'.cmp-kpi{border-radius:12px!important;box-shadow:none!important;border:1px solid var(--line)!important;padding:14px 15px!important;background:#fff!important}'
  +'.cmp-kpi::before{display:none!important}'
  +'.cmp-kpi .ki{background:transparent!important;color:#94a3b8!important;width:auto!important;height:auto!important;font-size:12.5px!important}'
  +'.cmp-kpi .kl{font-size:10.5px!important;letter-spacing:.07em!important;color:#8a94a6!important;font-weight:600!important}'
  +'.cmp-kpi .kv{font-size:23px!important;font-weight:650!important;letter-spacing:-.6px!important;margin-top:9px!important;color:var(--ink)!important;font-variant-numeric:tabular-nums}'
  +'.cmp-kpi .ks{font-size:11px!important;color:#98a2b3!important;margin-top:3px!important}'
  +'.cmp-kpi:hover{border-color:#d6dced!important}'
  +'.cmp-kpis{gap:12px!important;margin-bottom:16px!important}'
  +'.cmp-kpi .ktr{margin-top:8px}'
  /* trend + fatigue: quiet text, not loud pills */
  +'.cmp-tr{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:600;white-space:nowrap;vertical-align:middle;cursor:default;font-variant-numeric:tabular-nums}'
  +'.cmp-tr i{font-size:9.5px}'
  +'.cmp-tr.good{color:#15803d}.cmp-tr.bad{color:#c0392f}.cmp-tr.flat{color:#98a2b3}.cmp-tr.none{color:#cbd5e1}'
  +'.cmp-fg{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;white-space:nowrap;cursor:default}'
  +'.cmp-fg i{font-size:9px}'
  +'.cmp-fg.hi{color:#c0392f}.cmp-fg.md{color:#a16207}.cmp-fg.ok{color:#5b6674}.cmp-fg.na{color:#cbd5e1}'
  +'.cmp-up{color:#15803d;font-weight:600}.cmp-dn{color:#c0392f;font-weight:600}'
  /* panels */
  +'.cmp-panel{background:#fff;border:1px solid var(--line);border-radius:12px;margin:0 0 16px;overflow:hidden}'
  +'.cmp-phead{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;padding:15px 18px 13px;border-bottom:1px solid var(--line-2)}'
  +'.cmp-over{display:block;font-size:10px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:#a3adbe;margin-bottom:3px}'
  +'.cmp-phead h3{margin:0;font-size:15px;font-weight:650;letter-spacing:-.2px;color:var(--ink)}'
  +'.cmp-chip{font-size:11px;color:#7d8798;background:#f6f8fc;border:1px solid var(--line-2);border-radius:6px;padding:3px 9px;white-space:nowrap}'
  /* tables */
  +'.cmp-tblwrap{overflow-x:auto}'
  +'.cmp-tbl{width:100%;border-collapse:collapse;font-size:13px}'
  +'.cmp-tbl th{text-align:left;font-size:10px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#a3adbe;padding:10px 14px;border-bottom:1px solid var(--line);white-space:nowrap;background:#fcfdff}'
  +'.cmp-tbl th.num{text-align:right}'
  +'.cmp-tbl td{padding:11px 14px;border-bottom:1px solid var(--line-2);vertical-align:middle}'
  +'.cmp-tbl tbody tr:last-child td{border-bottom:0}'
  +'.cmp-tbl tbody tr:hover{background:#fbfcfe}'
  +'.cmp-tbl td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}'
  +'.cmp-tbl td.muted{color:#98a2b3}.cmp-tbl td.strong{font-weight:650;color:var(--ink)}'
  +'.cmp-mlbl{font-weight:600;color:#5b6674}'
  +'.cmp-nm{font-weight:600;color:var(--ink);max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  +'.cmp-sub{font-size:11px;color:#98a2b3;margin-top:2px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  +'.cmp-adv{font-size:12px;color:#7d8798}'
  +'.cmp-none{text-align:center;color:#a3adbe;padding:28px 14px;font-size:12.5px}'
  +'.cmp-bar{padding-right:18px!important}'
  +'.cmp-barfill{display:block;height:5px;border-radius:3px;background:#dbe2ee;min-width:2px}'
  +'.cmp-barfill.up{background:#9fc9ae}.cmp-barfill.down{background:#e0b4ae}'
  /* stat strip on the fatigue page */
  +'.cmp-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:0 0 16px}'
  +'.cmp-stat{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px;position:relative}'
  +'.cmp-stat .v{font-size:25px;font-weight:650;letter-spacing:-.7px;color:var(--ink);font-variant-numeric:tabular-nums}'
  +'.cmp-stat .l{font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#8a94a6;margin-top:4px}'
  +'.cmp-stat.hi .v{color:#c0392f}.cmp-stat.md .v{color:#a16207}'
  +'@media(max-width:640px){.cmp-stats{grid-template-columns:1fr}}'
  /* filter row */
  +'.cmp-fbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px}'
  +'.cmp-projbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px}'
  +'.cmp-projsel{height:38px;min-width:210px;border:1px solid var(--line);border-radius:9px;padding:0 32px 0 12px;font-size:13px;font-family:inherit;font-weight:600;color:var(--ink);background-color:var(--bg-card);cursor:pointer;appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 12 8\'%3E%3Cpath d=\'M1 1l5 5 5-5\' stroke=\'%2364748b\' stroke-width=\'1.8\' fill=\'none\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 11px center;background-size:11px 8px}'
  +'.cmp-projsel:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10,#eef2ff)}'
  +'.cmp-reload{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 15px;border:1px solid var(--line);border-radius:9px;background:var(--bg-card);font-size:13px;font-weight:600;color:var(--ink);cursor:pointer;margin-top:10px}'
  +'.cmp-reload:hover{border-color:var(--brand);color:var(--brand)}'
  +'.cmp-fbtn{font-size:12.5px;font-weight:600;color:#5b6674;background:#fff;border:1px solid var(--line);border-radius:8px;padding:6px 13px;cursor:pointer;transition:.12s;font-family:inherit}'
  +'.cmp-fbtn:hover{border-color:#c3ccdd;color:var(--ink)}'
  +'.cmp-fbtn.on{background:#111318;border-color:#111318;color:#fff}'
  +'.cmp-fcount{font-size:12px;color:#98a2b3;margin-left:2px}'
  +'.cmp-legend{display:flex;align-items:center;gap:16px;flex-wrap:wrap;font-size:11.5px;color:#98a2b3;margin:-4px 0 16px}'
  +'.cmp-cap{font-size:11.5px!important;color:#98a2b3!important}'
  +'.cmp-chcard{border-radius:12px!important;box-shadow:none!important;border:1px solid var(--line)!important}'
  +'.cmp-chcard h4{font-size:14px!important;font-weight:650!important;letter-spacing:-.2px}'
  +'.cmp-chcard .sub{font-size:11px!important;color:#98a2b3!important}'
  +'</style>';
// Background watchdog: raise email + bell alerts for spend spikes and other critical problems.
// Safe to call often — the server only alerts once per issue per day.
function cmpRunAlerts(){
  if(window._cmpAlertsRan)return; window._cmpAlertsRan=true;
  try{ fetch(SUPABASE_URL+'/functions/v1/campaign-alerts',{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:'{}'}).catch(function(){}); }catch(e){}
}
window.cmpSetSource=function(s){CMP_SOURCE=s;CMP_AD_PAGE=0;location.hash='#/campaigns';renderPage();};
function cmpSourceBar(){return '<div style="margin-bottom:12px"><div class="seg"><button class="seg-btn'+(CMP_SOURCE==='meta'?' on':'')+'" onclick="cmpSetSource(\'meta\')"><i class="fa-brands fa-facebook"></i> &nbsp;Meta</button><button class="seg-btn'+(CMP_SOURCE==='google'?' on':'')+'" onclick="cmpSetSource(\'google\')"><i class="fa-brands fa-google"></i> &nbsp;Google Ads</button><button class="seg-btn'+(CMP_SOURCE==='both'?' on':'')+'" onclick="cmpSetSource(\'both\')"><i class="fa-solid fa-layer-group"></i> &nbsp;Both</button></div></div>';}
window.cmpSetPeriod=function(p){CMP_PERIOD=p;if(p!=='custom'){CMP_SINCE='';CMP_UNTIL='';}renderPage();};
window.cmpSetCustom=function(){const s=$('cmpSince')&&$('cmpSince').value,u=$('cmpUntil')&&$('cmpUntil').value;if(!s||!u){toast('Pick both dates','err');return;}if(s>u){toast('Start date must be before end date','err');return;}CMP_SINCE=s;CMP_UNTIL=u;CMP_PERIOD='custom';renderPage();};
window.cmpSetAdProject=function(v){CMP_AD_PROJECT=v;CMP_AD_PAGE=0;renderPage();};
window.cmpSetCampProject=function(v){CMP_CAMP_PROJECT=v;renderPage();};
// Pull Google ad-level rows for the period on screen. The first fetch for an unseen period can
// take a while (it walks every account), so this reports honestly instead of failing silently.
window.cmpLoadGoogleAds=async function(){
  const btn=document.querySelector('.cmp-reload');
  if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-rotate fa-spin"></i> Loading — this can take a minute…';}
  try{
    const {data:{session}}=await sb.auth.getSession();
    const token=session&&session.access_token;
    const base=CMP_PERIOD==='custom'?{period:'custom',since:CMP_SINCE,until:CMP_UNTIL,level:'ad'}:{period:CMP_PERIOD,level:'ad'};
    const res=await fetch(SUPABASE_URL+'/functions/v1/google-ads-live',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},
      body:JSON.stringify(base)});
    const jr=await res.json().catch(function(){return {};});
    if(!res.ok||jr.error) throw new Error(jr.error||('Google returned '+res.status));
    toast('Loaded '+(jr.ad_insight_rows!=null?jr.ad_insight_rows:0)+' ad rows','ok');
  }catch(e){ toast('Could not load ad data: '+((e&&e.message)||e),'err'); }
  renderPage();
};
window.cmpSetAdPage=function(p){CMP_AD_PAGE=p;renderPage();};
function cmpPeriodBar(){
  const segBtns=CMP_PRESETS.map(function(p){return '<button class="seg-btn'+(CMP_PERIOD===p[0]?' on':'')+'" onclick="cmpSetPeriod(\''+p[0]+'\')">'+p[1]+'</button>';}).join('');
  let custom='';
  if(CMP_PERIOD==='custom'){
    custom='<div style="display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-top:10px;padding:14px;background:#f8fafc;border:1px solid var(--line-2);border-radius:10px">'+
      '<div><div style="font-size:11px;color:var(--slate);text-transform:uppercase;letter-spacing:.4px;font-weight:700;margin-bottom:6px">From</div><input type="date" id="cmpSince" value="'+esc(CMP_SINCE)+'" style="padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;font-family:inherit"></div>'+
      '<div><div style="font-size:11px;color:var(--slate);text-transform:uppercase;letter-spacing:.4px;font-weight:700;margin-bottom:6px">To</div><input type="date" id="cmpUntil" value="'+esc(CMP_UNTIL)+'" style="padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;font-family:inherit"></div>'+
      '<button class="btn btn-primary" style="padding:9px 20px" onclick="cmpSetCustom()">Apply</button>'+
      (CMP_SINCE&&CMP_UNTIL?'<div style="color:var(--slate);font-size:12.5px;padding-bottom:10px">Showing '+esc(CMP_SINCE)+' → '+esc(CMP_UNTIL)+'</div>':'')+
    '</div>';
  }
  return '<div class="seg">'+segBtns+'</div>'+custom+'<div style="height:14px"></div>';
}
window.cmpShowProject=function(accId){
  if(!CMP_LAST)return;
  const acc=CMP_LAST.accounts.find(a=>a.ad_account_id===accId);
  if(!acc)return;
  const inr=CMP_LAST.inr,num=CMP_LAST.num;
  const belongsToProj=function(c,a){ return c.name&&a.name&&String(c.name).trim().toLowerCase().startsWith(String(a.name).trim().toLowerCase()); };
  const prevMap=CMP_LAST.cPrevMap||{};
  const rows=CMP_LAST.campaigns.filter(c=>c.ad_account_id===accId&&belongsToProj(c,acc)).map(c=>{
    const i=CMP_LAST.cInsMap[c.id]||{};
    const p=prevMap[c.id]||null;
    const spend=Number(i.spend)||0,leads=Number(i.leads)||0;
    const budget=c.daily_budget!=null?Number(c.daily_budget):(c.lifetime_budget!=null?Number(c.lifetime_budget):null);
    const pspend=p?(Number(p.spend)||0):null, pleads=p?(Number(p.leads)||0):0;
    return {c,i,spend,leads,budget,cpl:leads?spend/leads:null,
      pspend,pcpl:pleads?((Number(p.spend)||0)/pleads):null,pctr:p?(Number(p.ctr)||0):null};
  }).sort((a,b)=>b.spend-a.spend);
  const totalSpend=rows.reduce((s,r)=>s+r.spend,0);
  const totalLeads=rows.reduce((s,r)=>s+r.leads,0);
  const statusTag=function(st){const s=(st||'').toUpperCase();if(s==='ACTIVE')return '<span class="tag t-green">Active</span>';if(s==='PAUSED')return '<span class="tag t-amber">Paused</span>';return s?'<span class="tag" style="background:#f1f5f9;color:#475569">'+esc(s)+'</span>':'—';};
  const tbl=rows.length?('<div class="card qc-table-card" style="padding:0;margin-top:14px"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+
    ['Campaign','Status','Budget','Spend','Trend','Results (Leads)','Cost / Lead','Reach','CTR','Fatigue'].map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+
    '</tr></thead><tbody>'+
    rows.map(function(r){return '<tr>'+
      '<td style="font-weight:600">'+esc(r.c.name||'—')+'</td>'+
      '<td>'+statusTag(r.c.status)+'</td>'+
      '<td style="text-align:right">'+(r.budget?inr(r.budget)+(r.c.daily_budget!=null?'/day':' total'):'—')+'</td>'+
      '<td style="text-align:right;font-weight:600">'+inr(r.spend)+'</td>'+
      '<td style="text-align:right">'+cmpTrend(r.spend,r.pspend,false)+'</td>'+
      '<td style="text-align:right">'+num(r.leads)+'</td>'+
      '<td style="text-align:right">'+(r.cpl!=null?inr(r.cpl):'—')+' '+cmpTrend(r.cpl,r.pcpl,true)+'</td>'+
      '<td style="text-align:right">'+num(r.i.reach)+'</td>'+
      '<td style="text-align:right">'+(r.i.ctr!=null?Number(r.i.ctr).toFixed(2)+'%':'—')+'</td>'+
      '<td style="text-align:right">'+cmpFatigue(Number(r.i.frequency)||0,r.i.ctr,r.pctr)+'</td>'+
    '</tr>';}).join('')+
    '</tbody></table></div></div>'):'<div class="card card-pad empty" style="margin-top:14px"><i class="fa-solid fa-chart-line"></i><div>No campaign data for this period</div></div>';
  openModal(
    '<div class="modal-head"><div><div style="font-weight:700;font-size:16.5px">'+esc(acc.name)+'</div><div style="color:var(--slate);font-size:12.5px;margin-top:2px">'+esc(CMP_LAST.periodLabel)+' · '+rows.length+' campaign'+(rows.length===1?'':'s')+'</div></div><div class="x" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></div></div>'+
    '<div class="modal-body">'+mKpis([['Spend',inr(totalSpend),''],['Results (Leads)',num(totalLeads),''],['Cost / Lead',totalLeads?inr(totalSpend/totalLeads):'—','']])+tbl+'</div>',
    'lg'
  );
};
window.cmpShowProjectAds=function(accId){
  if(!CMP_LAST||!CMP_LAST.ads)return;
  const acc=CMP_LAST.accounts.find(a=>a.ad_account_id===accId);
  if(!acc)return;
  const inr=CMP_LAST.inr,num=CMP_LAST.num;
  const belongsToProj=function(c,a){ return c.name&&a.name&&String(c.name).trim().toLowerCase().startsWith(String(a.name).trim().toLowerCase()); };
  const rows=CMP_LAST.ads.filter(a=>a.ad_account_id===accId).map(a=>{
    const i=CMP_LAST.aInsMap[a.id]||{};
    const camp=CMP_LAST.campMap[a.campaign_id];
    return {a,i,camp,spend:Number(i.spend)||0};
  }).filter(r=>r.camp&&belongsToProj(r.camp,acc)).sort((x,y)=>y.spend-x.spend);
  const totalSpend=rows.reduce((s,r)=>s+r.spend,0);
  const statusTag=function(st){const s=(st||'').toUpperCase();if(s==='ACTIVE')return '<span class="tag t-green">Active</span>';if(s==='PAUSED')return '<span class="tag t-amber">Paused</span>';return s?'<span class="tag" style="background:#f1f5f9;color:#475569">'+esc(s)+'</span>':'—';};
  const tbl=rows.length?('<div class="card qc-table-card" style="padding:0;margin-top:14px"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+
    ['Ad','Campaign','Status','Spend','Trend','Clicks','CTR','Fatigue'].map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+
    '</tr></thead><tbody>'+
    rows.map(function(r){
      const p=(CMP_LAST.aPrevMap||{})[r.a.id]||null;
      return '<tr>'+
      '<td style="font-weight:600">'+esc(r.a.name||'—')+'</td>'+
      '<td>'+esc(r.camp?r.camp.name:'—')+'</td>'+
      '<td>'+statusTag(r.a.effective_status||r.a.status)+'</td>'+
      '<td style="text-align:right;font-weight:600">'+inr(r.spend)+'</td>'+
      '<td style="text-align:right">'+cmpTrend(r.spend,p?(Number(p.spend)||0):null,false)+'</td>'+
      '<td style="text-align:right">'+num(r.i.clicks)+'</td>'+
      '<td style="text-align:right">'+(r.i.ctr!=null?Number(r.i.ctr).toFixed(2)+'%':'—')+'</td>'+
      '<td style="text-align:right">'+cmpFatigue(Number(r.i.frequency)||0,r.i.ctr,p?(Number(p.ctr)||0):null)+'</td>'+
    '</tr>';}).join('')+
    '</tbody></table></div></div>'):'<div class="card card-pad empty" style="margin-top:14px"><i class="fa-solid fa-rectangle-ad"></i><div>No ad data for this period</div></div>';
  openModal(
    '<div class="modal-head"><div><div style="font-weight:700;font-size:16.5px">'+esc(acc.name)+'</div><div style="color:var(--slate);font-size:12.5px;margin-top:2px">'+esc(CMP_LAST.periodLabel)+' · '+rows.length+' ad'+(rows.length===1?'':'s')+'</div></div><div class="x" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></div></div>'+
    '<div class="modal-body">'+mKpis([['Spend',inr(totalSpend),'']])+tbl+'</div>',
    'lg'
  );
};
async function cmpBothView(v,seg){
  const tabs=['Overview','Sources','Trend','Ad Fatigue'];const ti=mTab(seg,tabs.length);
  v.innerHTML=cmpSourceBar()+cmpPeriodBar()+'<div class="loader"><div class="spin"></div></div>';
  const periodKey=CMP_PERIOD==='custom'?('custom:'+CMP_SINCE+':'+CMP_UNTIL):CMP_PERIOD;
  const periodLabel=CMP_PERIOD==='custom'?(CMP_SINCE&&CMP_UNTIL?CMP_SINCE+' → '+CMP_UNTIL:'Custom range'):((CMP_PRESETS.find(function(p){return p[0]===CMP_PERIOD;})||[])[1]||CMP_PERIOD);
  if(CMP_PERIOD!=='custom'||(CMP_SINCE&&CMP_UNTIL)){
    try{
      const {data:{session}}=await sb.auth.getSession();const token=session&&session.access_token;
      const hdr={'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY};
      const mbody=CMP_PERIOD==='custom'?{level:'campaign',period:'custom',since:CMP_SINCE,until:CMP_UNTIL}:{level:'campaign',period:CMP_PERIOD};
      const gbody=CMP_PERIOD==='custom'?{period:'custom',since:CMP_SINCE,until:CMP_UNTIL}:{period:CMP_PERIOD};
      const pr0=cmpPrevRange(); if(pr0){gbody.prev_since=pr0.since;gbody.prev_until=pr0.until;}
      await Promise.all([
        fetch(SUPABASE_URL+'/functions/v1/campaign-analytics-live',{method:'POST',headers:hdr,body:JSON.stringify(mbody)}).catch(function(){}),
        fetch(SUPABASE_URL+'/functions/v1/google-ads-live',{method:'POST',headers:hdr,body:JSON.stringify(gbody)}).catch(function(){})
      ]);
    }catch(e){}
  }
  await cmpSyncPrev('both');
  const C=function(){return sb.schema('camp');};
  const prevKey=cmpPrevKey();
  let mIns=[],gIns=[],mPrev=[],gPrev=[],mAccts=[],mCamps=[],gAccts=[],gCamps=[];
  try{
    const calls=[
      C().from('campaign_insights').select('campaign_id,spend,impressions,clicks,leads,frequency').eq('period',periodKey),
      C().from('g_campaign_insights').select('campaign_id,spend,impressions,clicks,conversions,ctr').eq('period',periodKey),
      C().from('ad_accounts').select('ad_account_id,name'),
      C().from('campaigns').select('id,ad_account_id,name,daily_budget,lifetime_budget,status'),
      C().from('g_accounts').select('customer_id,name'),
      C().from('g_campaigns').select('id,customer_id,name,status,budget_amount')
    ];
    if(prevKey){
      calls.push(C().from('campaign_insights').select('campaign_id,spend,impressions,clicks,leads,frequency').eq('period',prevKey));
      calls.push(C().from('g_campaign_insights').select('campaign_id,spend,impressions,clicks,conversions,ctr').eq('period',prevKey));
    }
    const r=await Promise.all(calls);
    mIns=r[0].data||[];gIns=r[1].data||[];mAccts=r[2].data||[];mCamps=r[3].data||[];gAccts=r[4].data||[];gCamps=r[5].data||[];
    if(prevKey){mPrev=(r[6]&&r[6].data)||[];gPrev=(r[7]&&r[7].data)||[];}
  }catch(e){}
  const sum=function(arr,k){return arr.reduce(function(s,x){return s+(Number(x[k])||0);},0);};
  const M={spend:sum(mIns,'spend'),res:sum(mIns,'leads'),impr:sum(mIns,'impressions'),clk:sum(mIns,'clicks')};
  const Gg={spend:sum(gIns,'spend'),res:sum(gIns,'conversions'),impr:sum(gIns,'impressions'),clk:sum(gIns,'clicks')};
  const T={spend:M.spend+Gg.spend,res:M.res+Gg.res,impr:M.impr+Gg.impr,clk:M.clk+Gg.clk};
  const Mp={spend:sum(mPrev,'spend'),res:sum(mPrev,'leads'),impr:sum(mPrev,'impressions'),clk:sum(mPrev,'clicks')};
  const Gp={spend:sum(gPrev,'spend'),res:sum(gPrev,'conversions'),impr:sum(gPrev,'impressions'),clk:sum(gPrev,'clicks')};
  const Tp={spend:Mp.spend+Gp.spend,res:Mp.res+Gp.res,impr:Mp.impr+Gp.impr,clk:Mp.clk+Gp.clk};
  const avgFreq=function(arr){const f=arr.map(function(x){return Number(x.frequency)||0;}).filter(function(x){return x>0;});return f.length?(f.reduce(function(a,b){return a+b;},0)/f.length):0;};
  const mFreq=avgFreq(mIns);
  // total live daily budget across both platforms — ACTIVE campaigns only, since a paused
  // campaign isn't spending its budget and shouldn't inflate the figure
  const mBudget=mCamps.filter(function(c){return cmpIsActive(c.status);}).reduce(function(s,c){return s+(Number(c.daily_budget)||0);},0);
  const gBudget=gCamps.filter(function(c){return String(c.status||'').toUpperCase()==='ENABLED';}).reduce(function(s,c){return s+(Number(c.budget_amount)||0);},0);
  const tBudget=mBudget+gBudget;
  // combined best / worst across Meta projects and Google accounts
  const mInsMap={};mIns.forEach(function(x){mInsMap[x.campaign_id]=x;});
  const gInsMap={};gIns.forEach(function(x){gInsMap[x.campaign_id]=x;});
  const bwItems=[];
  mAccts.forEach(function(a){
    let sp=0,rs=0;
    mCamps.filter(function(c){return c.ad_account_id===a.ad_account_id&&c.name&&a.name&&String(c.name).trim().toLowerCase().indexOf(String(a.name).trim().toLowerCase())===0;}).forEach(function(c){const i=mInsMap[c.id];if(i){sp+=Number(i.spend)||0;rs+=Number(i.leads)||0;}});
    if(sp>0)bwItems.push({name:'Meta · '+a.name,spend:sp,res:rs,cpr:rs?sp/rs:null});
  });
  gAccts.forEach(function(a){
    let sp=0,rs=0;
    gCamps.filter(function(c){return c.customer_id===a.customer_id;}).forEach(function(c){const i=gInsMap[c.id];if(i){sp+=Number(i.spend)||0;rs+=Number(i.conversions)||0;}});
    if(sp>0)bwItems.push({name:'Google · '+a.name,spend:sp,res:rs,cpr:rs?sp/rs:null});
  });
  const inr=function(n){return '₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});};
  const num=function(n){return Number(n||0).toLocaleString('en-IN');};
  const cmpCss='<style>'
    +'.cmp-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:0 0 18px}'
    +'@media(max-width:1100px){.cmp-kpis{grid-template-columns:repeat(3,1fr)}}'
    +'@media(max-width:640px){.cmp-kpis{grid-template-columns:repeat(2,1fr);gap:10px}.cmp-kpi{padding:12px 13px}.cmp-kpi .kv{font-size:20px}.cmp-kpi .ki{width:30px;height:30px;font-size:13px}}'
    +'.cmp-kpi{position:relative;background:#fff;border:1px solid var(--line);border-radius:14px;padding:15px 16px;box-shadow:var(--shadow);overflow:hidden}'
    +'.cmp-kpi::before{content:\"\";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--kc,#334155)}'
    +'.cmp-kpi .kh{display:flex;align-items:center;justify-content:space-between;gap:8px}'
    +'.cmp-kpi .ki{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;background:var(--kbg,#f1f5f9);color:var(--kc,#334155)}'
    +'.cmp-kpi .kl{font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--slate)}'
    +'.cmp-kpi .kv{font-size:24px;font-weight:800;letter-spacing:-.5px;color:var(--ink,#0f172a);margin-top:12px;line-height:1}'
    +'.cmp-kpi .ks{font-size:11.5px;color:var(--slate);margin-top:5px;min-height:14px}'
    +'.cmp-charts{display:grid;grid-template-columns:1fr 1fr;gap:16px}'
    +'@media(max-width:900px){.cmp-charts{grid-template-columns:1fr}}'
    +'.cmp-chcard{background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);padding:16px}'
    +'.cmp-chcard h4{margin:0;font-size:13.5px;font-weight:700;color:var(--ink,#0f172a)}'
    +'.cmp-chcard .sub{font-size:11.5px;color:var(--slate);margin:3px 0 12px}'
    +'</style>';
  const cmpKpi=function(iconCls,label,value,sub,color,bg,trend){return '<div class="cmp-kpi" style="--kc:'+color+';--kbg:'+bg+'"><div class="kh"><span class="kl">'+esc(label)+'</span><span class="ki"><i class="'+iconCls+'"></i></span></div><div class="kv">'+esc(value)+'</div><div class="ks">'+esc(sub||'')+'</div>'+(trend?'<div class="ktr">'+trend+'</div>':'')+'</div>';};
  const cpr=T.res?T.spend/T.res:null, pcpr=Tp.res?Tp.spend/Tp.res:null;
  const kpiStrip='<div class="cmp-kpis">'
    +cmpKpi('fa-solid fa-indian-rupee-sign','Total Spend',inr(T.spend),'Meta + Google','#334155','#f1f5f9',cmpTrend(T.spend,Tp.spend,false))
    +cmpKpi('fa-solid fa-wallet','Daily Budget',tBudget?inr(tBudget):'—','both platforms','#6366f1','#eef2ff',tBudget?('<span class="cmp-tr flat" title="Share of the daily budget already spent"><i class="fa-solid fa-gauge-high"></i> '+Math.round(T.spend/tBudget*100)+'% used</span>'):'')
    +cmpKpi('fa-solid fa-bullseye','Total Results',num(Math.round(T.res)),'leads + conversions','#0d9488','#f0fdfa',cmpTrend(T.res,Tp.res,false))
    +cmpKpi('fa-solid fa-tags','Cost / Result',cpr!=null?inr(cpr):'—','blended','#0ea5e9','#f0f9ff',cmpTrend(cpr,pcpr,true))
    +cmpKpi('fa-solid fa-eye','Impressions',num(T.impr),'','#7c3aed','#f5f3ff',cmpTrend(T.impr,Tp.impr,false))
    +cmpKpi('fa-solid fa-hand-pointer','Clicks',num(T.clk),'','#2563eb','#eff6ff',cmpTrend(T.clk,Tp.clk,false))
    +cmpKpi('fa-brands fa-facebook','Meta Spend',inr(M.spend),T.spend?Math.round(M.spend/T.spend*100)+'% of spend':'','#1877f2','#eff6ff',cmpTrend(M.spend,Mp.spend,false))
    +cmpKpi('fa-brands fa-google','Google Spend',inr(Gg.spend),T.spend?Math.round(Gg.spend/T.spend*100)+'% of spend':'','#ea4335','#fef2f2',cmpTrend(Gg.spend,Gp.spend,false))
    +'</div>';
  const legend='<div class="cmp-legend"><span>Trend compares with '+esc(cmpPrevLabel())+'</span><span>Fatigue: Meta uses real per-person frequency, Google uses CTR decline</span></div>';
  let body;
  if(ti===0){
    body='<div class="cmp-charts">'
      +'<div class="cmp-chcard"><h4>Spend: Meta vs Google</h4><div class="sub">'+esc(periodLabel)+'</div><div style="height:260px"><canvas id="bCh1"></canvas></div></div>'
      +'<div class="cmp-chcard"><h4>Results: Meta vs Google</h4><div class="sub">leads + conversions</div><div style="height:260px"><canvas id="bCh2"></canvas></div></div>'
      +'</div>';
  } else if(ti===1){
    const mCtr=M.impr?M.clk/M.impr*100:0, mpCtr=Mp.impr?Mp.clk/Mp.impr*100:0;
    const gCtr=Gg.impr?Gg.clk/Gg.impr*100:0, gpCtr=Gp.impr?Gp.clk/Gp.impr*100:0;
    const tCtr=T.impr?T.clk/T.impr*100:0, tpCtr=Tp.impr?Tp.clk/Tp.impr*100:0;
    const rowT=function(label,d,p,ctr,pCtr,budget,fatigue,isTotal){
      const c=d.res?d.spend/d.res:null, pc=p&&p.res?p.spend/p.res:null;
      return '<tr'+(isTotal?' style="background:#fbfcfe"':'')+'><td'+(isTotal?' class="strong"':'')+'>'+label+'</td>'
      +'<td class="num">'+(budget?inr(budget):'—')+'</td>'
      +'<td class="num strong">'+inr(d.spend)+'</td>'
      +'<td class="num">'+cmpTrend(d.spend,p?p.spend:null,false)+'</td>'
      +'<td class="num">'+num(Math.round(d.res))+'</td>'
      +'<td class="num">'+cmpTrend(d.res,p?p.res:null,false)+'</td>'
      +'<td class="num">'+(c!=null?inr(c):'—')+'</td>'
      +'<td class="num">'+cmpTrend(c,pc,true)+'</td>'
      +'<td class="num">'+ctr.toFixed(2)+'%</td>'
      +'<td>'+fatigue+'</td></tr>';
    };
    body='<div class="cmp-panel"><div class="cmp-phead"><div><span class="cmp-over">Sources</span><h3>Meta vs Google</h3></div><span class="cmp-chip">'+esc(periodLabel)+'</span></div>'
      +'<div class="cmp-tblwrap"><table class="cmp-tbl"><thead><tr><th>Source</th><th class="num">Budget / day</th><th class="num">Spend</th><th class="num">Trend</th><th class="num">Results</th><th class="num">vs prev</th><th class="num">Cost / Result</th><th class="num">vs prev</th><th class="num">CTR</th><th>Fatigue</th></tr></thead><tbody>'
      +rowT('<i class="fa-brands fa-facebook" style="color:#8a94a6"></i> &nbsp;Meta',M,Mp,mCtr,mpCtr,mBudget,cmpFatigue(mFreq,mCtr,mpCtr),false)
      +rowT('<i class="fa-brands fa-google" style="color:#8a94a6"></i> &nbsp;Google',Gg,Gp,gCtr,gpCtr,gBudget,cmpFatigue(0,gCtr,gpCtr),false)
      +rowT('Total',T,Tp,tCtr,tpCtr,tBudget,cmpFatigue(mFreq,tCtr,tpCtr),true)
      +'</tbody></table></div></div>';
  } else if(ti===2){
    const tCtr=T.impr?T.clk/T.impr*100:0, tpCtr=Tp.impr?Tp.clk/Tp.impr*100:0;
    const prevByName={};
    const pmMap={};mPrev.forEach(function(x){pmMap[x.campaign_id]=x;});
    const pgMap={};gPrev.forEach(function(x){pgMap[x.campaign_id]=x;});
    mAccts.forEach(function(a){
      let sp=0,rs=0;
      mCamps.filter(function(c){return c.ad_account_id===a.ad_account_id&&c.name&&a.name&&String(c.name).trim().toLowerCase().indexOf(String(a.name).trim().toLowerCase())===0;}).forEach(function(c){const p=pmMap[c.id];if(p){sp+=Number(p.spend)||0;rs+=Number(p.leads)||0;}});
      prevByName['Meta · '+a.name]={spend:sp,res:rs};
    });
    gAccts.forEach(function(a){
      let sp=0,rs=0;
      gCamps.filter(function(c){return c.customer_id===a.customer_id;}).forEach(function(c){const p=pgMap[c.id];if(p){sp+=Number(p.spend)||0;rs+=Number(p.conversions)||0;}});
      prevByName['Google · '+a.name]={spend:sp,res:rs};
    });
    body=cmpTrendPage(bwItems.map(function(x){
      const p=prevByName[x.name]||{spend:null,res:0};
      return {name:x.name,sub:'',spend:x.spend,pspend:p.spend,res:x.res,pres:p.res,cpr:x.cpr,pcpr:p.res?(p.spend/p.res):null};
    }),{spend:T.spend,pspend:Tp.spend,res:T.res,pres:Tp.res,cpr:cpr,pcpr:pcpr,clk:T.clk,pclk:Tp.clk,ctr:tCtr,pctr:tpCtr},inr,num,'results');
  } else {
    const fr=[];
    const mAccName={};mAccts.forEach(function(a){mAccName[a.ad_account_id]=a.name;});
    const gAccName={};gAccts.forEach(function(a){gAccName[a.customer_id]=a.name;});
    const pmMap={};mPrev.forEach(function(x){pmMap[x.campaign_id]=x;});
    const pgMap={};gPrev.forEach(function(x){pgMap[x.campaign_id]=x;});
    mCamps.forEach(function(c){
      const i=mInsMap[c.id]; if(!i)return; const p=pmMap[c.id]||null;
      const imp=Number(i.impressions)||0, pimp=p?(Number(p.impressions)||0):0;
      fr.push({name:c.name||'Campaign',sub:'Meta · '+(mAccName[c.ad_account_id]||''),freq:Number(i.frequency)||0,
        ctr:imp?((Number(i.clicks)||0)/imp*100):null,
        pctr:pimp?((Number(p.clicks)||0)/pimp*100):null,
        spend:Number(i.spend)||0,impr:imp});
    });
    gCamps.forEach(function(c){
      const i=gInsMap[c.id]; if(!i)return; const p=pgMap[c.id]||null;
      fr.push({name:c.name||'Campaign',sub:'Google · '+(gAccName[c.customer_id]||''),freq:0,
        ctr:i.ctr!=null?Number(i.ctr):null,pctr:p&&p.ctr!=null?Number(p.ctr):null,
        spend:Number(i.spend)||0,impr:Number(i.impressions)||0});
    });
    body=cmpFatiguePage(fr.filter(function(x){return x.spend>0||x.impr>0;}),inr,num,'Meta + Google · campaign level');
  }
  const showKpis=(ti!==2&&ti!==3);
  v.innerHTML=cmpCss+CMP_EXTRA_CSS+mHead('fa-bullhorn','#db2777','Campaign Analytics')+cmpSourceBar()+cmpPeriodBar()+mTabs('campaigns',tabs,ti)+'<div style="margin-top:14px">'+(showKpis?kpiStrip:'')+legend+body+'</div>';
  cmpRunAlerts();
  if(ti===0&&window.Chart){setTimeout(function(){
    const opt={responsive:true,maintainAspectRatio:false,cutout:'60%',plugins:{legend:{position:'bottom',labels:{boxWidth:12,font:{size:12}}}}};
    try{new Chart(document.getElementById('bCh1'),{type:'doughnut',data:{labels:['Meta','Google'],datasets:[{data:[M.spend,Gg.spend],backgroundColor:['#1877f2','#ea4335'],borderWidth:2,borderColor:'#fff'}]},options:opt});}catch(e){}
    try{new Chart(document.getElementById('bCh2'),{type:'doughnut',data:{labels:['Meta','Google'],datasets:[{data:[M.res,Gg.res],backgroundColor:['#1877f2','#ea4335'],borderWidth:2,borderColor:'#fff'}]},options:opt});}catch(e){}
  },60);}
}
async function cmpGoogleView(v,seg){
  const tabs=['Overview','Accounts','Campaigns','Ads','Trend','Ad Fatigue'];const ti=mTab(seg,tabs.length);
  const needGAds=(ti===3||ti===5);
  v.innerHTML=cmpSourceBar()+cmpPeriodBar()+'<div class="loader"><div class="spin"></div></div>';
  const periodKey=CMP_PERIOD==='custom'?('custom:'+CMP_SINCE+':'+CMP_UNTIL):CMP_PERIOD;
  const periodLabel=CMP_PERIOD==='custom'?(CMP_SINCE&&CMP_UNTIL?CMP_SINCE+' → '+CMP_UNTIL:'Custom range'):((CMP_PRESETS.find(function(p){return p[0]===CMP_PERIOD;})||[])[1]||CMP_PERIOD);
  // Ask the Google Ads live function to refresh this period (it pulls fresh from Google, then we read the tables).
  if(CMP_PERIOD!=='custom'||(CMP_SINCE&&CMP_UNTIL)){
    try{
      const {data:{session}}=await sb.auth.getSession();const token=session&&session.access_token;
      const pr=cmpPrevRange();
      const base=CMP_PERIOD==='custom'?{period:'custom',since:CMP_SINCE,until:CMP_UNTIL}:{period:CMP_PERIOD};
      if(pr){base.prev_since=pr.since;base.prev_until=pr.until;}   // one call fills both buckets
      const hdr={'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY};
      const jobs=[fetch(SUPABASE_URL+'/functions/v1/google-ads-live',{method:'POST',headers:hdr,body:JSON.stringify(base)}).catch(function(){})];
      if(needGAds)jobs.push(fetch(SUPABASE_URL+'/functions/v1/google-ads-live',{method:'POST',headers:hdr,body:JSON.stringify(Object.assign({},base,{level:'ad'}))}).catch(function(){}));
      await Promise.all(jobs);
    }catch(e){}
  }
  const G=function(){return sb.schema('camp');};
  const prevKey=cmpPrevKey();
  let accts=[],camps=[],ins=[],pIns=[],gAds=[],gAdIns=[],gAdPrev=[];
  try{
    const calls=[G().from('g_accounts').select('*').order('name'),G().from('g_campaigns').select('*'),G().from('g_campaign_insights').select('*').eq('period',periodKey)];
    const iPrev=calls.length; if(prevKey)calls.push(G().from('g_campaign_insights').select('*').eq('period',prevKey));
    let iAds=-1,iAdIns=-1,iAdPrev=-1;
    if(needGAds){ iAds=calls.length; calls.push(G().from('g_ads').select('*')); iAdIns=calls.length; calls.push(G().from('g_ad_insights').select('*').eq('period',periodKey)); if(prevKey){ iAdPrev=calls.length; calls.push(G().from('g_ad_insights').select('*').eq('period',prevKey)); } }
    const r=await Promise.all(calls);
    const at=function(i){return (i>=0&&r[i]&&r[i].data)?r[i].data:[];};
    accts=at(0);camps=at(1);ins=at(2);
    if(prevKey)pIns=at(iPrev);
    if(needGAds){gAds=at(iAds);gAdIns=at(iAdIns);if(iAdPrev>=0)gAdPrev=at(iAdPrev);}
  }catch(e){}
  const insMap={};ins.forEach(function(x){insMap[x.campaign_id]=x;});
  const pInsMap={};pIns.forEach(function(x){pInsMap[x.campaign_id]=x;});
  const gAdInsMap={};gAdIns.forEach(function(x){gAdInsMap[x.ad_id]=x;});
  const gAdPrevMap={};gAdPrev.forEach(function(x){gAdPrevMap[x.ad_id]=x;});
  const inr=function(n){return '₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});};
  const num=function(n){return Number(n||0).toLocaleString('en-IN');};
  const isLive=function(c){return String(c.status||'').toUpperCase()==='ENABLED';};
  const rows=accts.map(function(a){
    const acs=camps.filter(function(c){return c.customer_id===a.customer_id;});
    let spend=0,impr=0,clk=0,conv=0,budget=0;
    let pspend=0,pimpr=0,pclk=0,pconv=0;
    acs.forEach(function(c){
      const i=insMap[c.id];if(i){spend+=Number(i.spend)||0;impr+=Number(i.impressions)||0;clk+=Number(i.clicks)||0;conv+=Number(i.conversions)||0;}
      const p=pInsMap[c.id];if(p){pspend+=Number(p.spend)||0;pimpr+=Number(p.impressions)||0;pclk+=Number(p.clicks)||0;pconv+=Number(p.conversions)||0;}
      if(isLive(c))budget+=Number(c.budget_amount)||0;
    });
    return {a:a,campaigns:acs.length,spend:spend,impr:impr,clk:clk,conv:conv,budget:budget,
      ctr:impr?clk/impr*100:0,cpl:conv?spend/conv:null,
      pspend:pspend,pconv:pconv,pctr:pimpr?pclk/pimpr*100:0,pcpl:pconv?pspend/pconv:null};
  }).sort(function(x,y){return y.spend-x.spend;});
  const tSpend=rows.reduce(function(s,r){return s+r.spend;},0),tImpr=rows.reduce(function(s,r){return s+r.impr;},0),tClk=rows.reduce(function(s,r){return s+r.clk;},0),tConv=rows.reduce(function(s,r){return s+r.conv;},0);
  const tBudget=rows.reduce(function(s,r){return s+r.budget;},0);
  const pSpend=rows.reduce(function(s,r){return s+r.pspend;},0),pConv=rows.reduce(function(s,r){return s+r.pconv;},0);
  const pImprT=pIns.reduce(function(s,x){return s+(Number(x.impressions)||0);},0),pClkT=pIns.reduce(function(s,x){return s+(Number(x.clicks)||0);},0);
  const pAvgCtr=pImprT?pClkT/pImprT*100:0, pCpl=pConv?pSpend/pConv:null, pAvgCpc=pClkT?pSpend/pClkT:null;
  const avgCtr=tImpr?tClk/tImpr*100:0,avgCpc=tClk?tSpend/tClk:null,cpl=tConv?tSpend/tConv:null;
  const cmpCss='<style>'
    +'.cmp-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:0 0 18px}'
    +'@media(max-width:1100px){.cmp-kpis{grid-template-columns:repeat(3,1fr)}}'
    +'@media(max-width:640px){.cmp-kpis{grid-template-columns:repeat(2,1fr);gap:10px}.cmp-kpi{padding:12px 13px}.cmp-kpi .kv{font-size:20px}.cmp-kpi .ki{width:30px;height:30px;font-size:13px}}'
    +'.cmp-kpi{position:relative;background:#fff;border:1px solid var(--line);border-radius:14px;padding:15px 16px;box-shadow:var(--shadow);overflow:hidden}'
    +'.cmp-kpi::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--kc,#4285f4)}'
    +'.cmp-kpi .kh{display:flex;align-items:center;justify-content:space-between;gap:8px}'
    +'.cmp-kpi .ki{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;background:var(--kbg,#eff6ff);color:var(--kc,#4285f4)}'
    +'.cmp-kpi .kl{font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--slate)}'
    +'.cmp-kpi .kv{font-size:24px;font-weight:800;letter-spacing:-.5px;color:var(--ink,#0f172a);margin-top:12px;line-height:1}'
    +'.cmp-kpi .ks{font-size:11.5px;color:var(--slate);margin-top:5px;min-height:14px}'
    +'.cmp-charts{display:grid;grid-template-columns:1fr 1fr;gap:16px}'
    +'@media(max-width:900px){.cmp-charts{grid-template-columns:1fr}}'
    +'.cmp-chcard{background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);padding:16px}'
    +'.cmp-chcard h4{margin:0;font-size:13.5px;font-weight:700;color:var(--ink,#0f172a)}'
    +'.cmp-chcard .sub{font-size:11.5px;color:var(--slate);margin:3px 0 12px}'
    +'.cmp-cap{font-size:12px;color:var(--slate);margin:-4px 0 14px;display:flex;align-items:center;gap:7px}'
    +'</style>';
  const cmpKpi=function(icon,label,value,sub,color,bg,trend){return '<div class="cmp-kpi" style="--kc:'+color+';--kbg:'+bg+'"><div class="kh"><span class="kl">'+esc(label)+'</span><span class="ki"><i class="fa-solid '+icon+'"></i></span></div><div class="kv">'+esc(value)+'</div><div class="ks">'+esc(sub||'')+'</div>'+(trend?'<div class="ktr">'+trend+'</div>':'')+'</div>';};
  const kpiStrip='<div class="cmp-kpis">'
    +cmpKpi('fa-indian-rupee-sign','Spend',inr(tSpend),accts.length+' account'+(accts.length===1?'':'s'),'#4285f4','#eff6ff',cmpTrend(tSpend,pSpend,false))
    +cmpKpi('fa-wallet','Daily Budget',tBudget?inr(tBudget):'—','active campaigns','#6366f1','#eef2ff',tBudget?('<span class="cmp-tr flat" title="Share of today\'s budget already spent"><i class="fa-solid fa-gauge-high"></i> '+Math.round(tSpend/tBudget*100)+'% used</span>'):'')
    +cmpKpi('fa-bullseye','Conversions',num(Math.round(tConv)),tConv?'':'none yet','#0d9488','#f0fdfa',cmpTrend(tConv,pConv,false))
    +cmpKpi('fa-tags','Cost / Conv.',cpl!=null?inr(cpl):'—','lower is better','#0ea5e9','#f0f9ff',cmpTrend(cpl,pCpl,true))
    +cmpKpi('fa-eye','Impressions',num(tImpr),'','#7c3aed','#f5f3ff',cmpTrend(tImpr,pImprT,false))
    +cmpKpi('fa-hand-pointer','Clicks',num(tClk),'','#2563eb','#eff6ff',cmpTrend(tClk,pClkT,false))
    +cmpKpi('fa-percent','Avg CTR',avgCtr.toFixed(2)+'%',avgCtr>=1?'healthy':'','#16a34a','#f0fdf4',cmpTrend(avgCtr,pAvgCtr,false))
    +cmpKpi('fa-coins','Avg CPC',avgCpc!=null?inr(avgCpc):'—','per click','#c2410c','#fff7ed',cmpTrend(avgCpc,pAvgCpc,true))
    +'</div>';
  const cap='<div class="cmp-cap"><i class="fa-brands fa-google" style="color:#ea4335"></i> Live Google Ads · '+esc(periodLabel)+' · '+accts.length+' account'+(accts.length===1?'':'s')+'</div>';
  const legend='<div class="cmp-legend"><span>Trend compares with '+esc(cmpPrevLabel())+'</span><span>Google has no per-person frequency, so fatigue = CTR falling while spend continues</span></div>';
  let body;
  if(ti===0){
    body='<div class="cmp-charts">'
      +'<div class="cmp-chcard"><h4>Spend by account</h4><div class="sub">'+esc(periodLabel)+'</div><div style="height:260px"><canvas id="gCh1"></canvas></div></div>'
      +'<div class="cmp-chcard"><h4>Conversions by account</h4><div class="sub">'+esc(periodLabel)+'</div><div style="height:260px"><canvas id="gCh2"></canvas></div></div>'
      +'<div class="cmp-chcard"><h4>Spend share</h4><div class="sub">where the budget goes</div><div style="height:260px"><canvas id="gCh3"></canvas></div></div>'
      +'<div class="cmp-chcard"><h4>Cost per conversion by account</h4><div class="sub">lower is better · in ₹</div><div style="height:260px"><canvas id="gCh4"></canvas></div></div>'
      +'</div>';
  } else if(ti===1){
    body=rows.length?('<div class="card qc-table-card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+['Account','Campaigns','Daily Budget','Spend','Trend','Conversions','Cost / Conv','Clicks','CTR','Fatigue'].map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+'</tr></thead><tbody>'+rows.map(function(r){
      const used=r.budget?Math.round(r.spend/r.budget*100):null;
      return '<tr><td style="font-weight:600">'+esc(r.a.name)+'</td><td style="text-align:right">'+r.campaigns+'</td>'
      +'<td style="text-align:right">'+(r.budget?(inr(r.budget)+'<span style="color:var(--slate);font-size:11px">/day</span>'+(used!=null?'<div style="font-size:10.5px;color:'+(used>100?'#b91c1c':'var(--slate)')+'">'+used+'% used</div>':'')):'—')+'</td>'
      +'<td style="text-align:right;font-weight:600">'+inr(r.spend)+'</td>'
      +'<td style="text-align:right">'+cmpTrend(r.spend,r.pspend,false)+'</td>'
      +'<td style="text-align:right">'+num(Math.round(r.conv))+'</td>'
      +'<td style="text-align:right">'+(r.cpl!=null?inr(r.cpl):'—')+' '+cmpTrend(r.cpl,r.pcpl,true)+'</td>'
      +'<td style="text-align:right">'+num(r.clk)+'</td><td style="text-align:right">'+r.ctr.toFixed(2)+'%</td>'
      +'<td style="text-align:right">'+cmpFatigue(0,r.ctr,r.pctr)+'</td></tr>';}).join('')+'</tbody></table></div></div>'):'<div class="card card-pad empty"><i class="fa-solid fa-chart-pie"></i><div>No Google Ads data for this period</div></div>';
  } else if(ti===2){
    const all=camps.map(function(c){const i=insMap[c.id]||null;const p=pInsMap[c.id]||null;const acc=accts.find(function(a){return a.customer_id===c.customer_id;});
      return {c:c,i:i||{},p:p,acc:acc,spend:i?(Number(i.spend)||0):0,active:cmpIsActive(c.status),hasData:!!i};}).filter(function(r){return r.acc;});
    const counts={all:all.length,active:all.filter(function(r){return r.active;}).length,inactive:all.filter(function(r){return !r.active;}).length};
    const crow=all.filter(function(r){return CMP_STATUS==='all'||(CMP_STATUS==='active'?r.active:!r.active);}).sort(function(x,y){return y.spend-x.spend;}).slice(0,300);
    const rowsHtml=crow.length?crow.map(function(r){
      const bud=Number(r.c.budget_amount)||0, sp=r.spend;
      const conv=Number(r.i.conversions)||0, cpc=conv?sp/conv:null;
      const psp=r.p?(Number(r.p.spend)||0):null;
      const pconv=r.p?(Number(r.p.conversions)||0):0, pcpc=(r.p&&pconv)?((Number(r.p.spend)||0)/pconv):null;
      const pctr=r.p?(Number(r.p.ctr)||0):null;
      const used=bud?Math.round(sp/bud*100):null;
      const chan=String(r.c.channel_type||'').replace(/_/g,' ').toLowerCase();
      return '<tr><td><div class="cmp-nm">'+esc(r.c.name)+'</div><div class="cmp-sub">'+esc(r.acc.name)+(chan?(' · '+esc(chan)):'')+'</div></td>'
      +'<td>'+(r.active?'<span class="cmp-fg ok"><i class="fa-solid fa-circle"></i> Active</span>':'<span class="cmp-fg na" style="color:#98a2b3"><i class="fa-solid fa-circle"></i> '+esc(String(r.c.status||'Inactive').replace('PAUSED','Paused').replace('REMOVED','Removed'))+'</span>')+'</td>'
      +'<td class="num">'+(bud?(inr(bud)+(used!=null?'<div class="cmp-sub" style="text-align:right'+(used>100?';color:#c0392f':'')+'">'+used+'% used</div>':'')):'—')+'</td>'
      +'<td class="num strong">'+inr(sp)+'</td>'
      +'<td class="num">'+cmpTrend(sp,psp,false)+'</td>'
      +'<td class="num">'+num(Math.round(conv))+'</td>'
      +'<td class="num">'+(cpc!=null?inr(cpc):'—')+'</td>'
      +'<td class="num">'+cmpTrend(cpc,pcpc,true)+'</td>'
      +'<td class="num">'+(Number(r.i.ctr)||0).toFixed(2)+'%</td>'
      +'<td>'+cmpFatigue(0,Number(r.i.ctr)||0,pctr)+'</td></tr>';}).join(''):'<tr><td colspan="10" class="cmp-none">No campaigns match this filter</td></tr>';
    body=cmpStatusBar(counts)+'<div class="cmp-panel"><div class="cmp-phead"><div><span class="cmp-over">Campaigns</span><h3>'+crow.length+' campaign'+(crow.length===1?'':'s')+'</h3></div><span class="cmp-chip">'+esc(periodLabel)+'</span></div>'
      +'<div class="cmp-tblwrap"><table class="cmp-tbl"><thead><tr><th>Campaign</th><th>Status</th><th class="num">Budget</th><th class="num">Spend</th><th class="num">Trend</th><th class="num">Conv</th><th class="num">Cost / Conv</th><th class="num">vs prev</th><th class="num">CTR</th><th>Fatigue</th></tr></thead><tbody>'+rowsHtml+'</tbody></table></div></div>';
  } else if(ti===3){
    // ---- Ad-wise (Google) ----
    const campNameMap={};camps.forEach(function(c){campNameMap[c.id]=c.name;});
    const all=gAds.map(function(a){
      const i=gAdInsMap[a.id]||null, p=gAdPrevMap[a.id]||null;
      const acc=accts.find(function(x){return x.customer_id===a.customer_id;});
      return {a:a,i:i||{},p:p,acc:acc,spend:i?(Number(i.spend)||0):0,active:cmpIsActive(a.status),hasData:!!i};
    }).filter(function(r){return r.hasData;});
    const counts={all:all.length,active:all.filter(function(r){return r.active;}).length,inactive:all.filter(function(r){return !r.active;}).length};
    const shown=all.filter(function(r){return CMP_STATUS==='all'||(CMP_STATUS==='active'?r.active:!r.active);}).sort(function(x,y){return y.spend-x.spend;}).slice(0,300);
    const rowsHtml=shown.length?shown.map(function(r){
      const conv=Number(r.i.conversions)||0, sp=r.spend, cpc=conv?sp/conv:null;
      const psp=r.p?(Number(r.p.spend)||0):null;
      const pconv=r.p?(Number(r.p.conversions)||0):0, pcpc=(r.p&&pconv)?((Number(r.p.spend)||0)/pconv):null;
      const pctr=r.p?(Number(r.p.ctr)||0):null;
      const sub=[(r.acc&&r.acc.name)||'',campNameMap[r.a.campaign_id]||'',r.a.ad_group_name||''].filter(Boolean).join(' · ');
      return '<tr><td><div class="cmp-nm">'+esc(r.a.name||'Ad')+'</div><div class="cmp-sub">'+esc(sub)+'</div></td>'
      +'<td>'+(r.active?'<span class="cmp-fg ok"><i class="fa-solid fa-circle"></i> Active</span>':'<span class="cmp-fg na" style="color:#98a2b3"><i class="fa-solid fa-circle"></i> '+esc(String(r.a.status||'Inactive').replace('PAUSED','Paused').replace('REMOVED','Removed'))+'</span>')+'</td>'
      +'<td class="num strong">'+inr(sp)+'</td>'
      +'<td class="num">'+cmpTrend(sp,psp,false)+'</td>'
      +'<td class="num">'+num(Math.round(conv))+'</td>'
      +'<td class="num">'+(cpc!=null?inr(cpc):'—')+'</td>'
      +'<td class="num">'+cmpTrend(cpc,pcpc,true)+'</td>'
      +'<td class="num">'+num(r.i.clicks)+'</td>'
      +'<td class="num">'+(Number(r.i.ctr)||0).toFixed(2)+'%</td>'
      +'<td>'+cmpFatigue(0,Number(r.i.ctr)||0,pctr)+'</td></tr>';}).join('')
      // Ad-level data is pulled per period on demand and the first pull for a new period is slow,
      // so an empty table usually just means "not fetched yet" — offer the retry rather than a dead end.
      :'<tr><td colspan="10" class="cmp-none">No ad data loaded for '+esc(periodLabel)+' yet.'
        +'<div><button class="cmp-reload" onclick="cmpLoadGoogleAds()"><i class="fa-solid fa-rotate"></i> Load ad data for this period</button></div></td></tr>';
    body=cmpStatusBar(counts)+'<div class="cmp-panel"><div class="cmp-phead"><div><span class="cmp-over">Ads</span><h3>'+shown.length+' ad'+(shown.length===1?'':'s')+'</h3></div><span class="cmp-chip">'+esc(periodLabel)+'</span></div>'
      +'<div class="cmp-tblwrap"><table class="cmp-tbl"><thead><tr><th>Ad</th><th>Status</th><th class="num">Spend</th><th class="num">Trend</th><th class="num">Conv</th><th class="num">Cost / Conv</th><th class="num">vs prev</th><th class="num">Clicks</th><th class="num">CTR</th><th>Fatigue</th></tr></thead><tbody>'+rowsHtml+'</tbody></table></div></div>';
  } else if(ti===4){
    body=cmpTrendPage(rows.map(function(r){return {name:r.a.name,sub:r.campaigns+' campaign'+(r.campaigns===1?'':'s'),spend:r.spend,pspend:r.pspend,res:r.conv,pres:r.pconv,cpr:r.cpl,pcpr:r.pcpl};}),
      {spend:tSpend,pspend:pSpend,res:tConv,pres:pConv,cpr:cpl,pcpr:pCpl,clk:tClk,pclk:pClkT,ctr:avgCtr,pctr:pAvgCtr},inr,num,'conversions');
  } else {
    // ---- Ad Fatigue (Google): per ad when loaded, else per campaign ----
    const campNameMap={};camps.forEach(function(c){campNameMap[c.id]=c.name;});
    const fr=[];
    gAds.forEach(function(a){
      const i=gAdInsMap[a.id]; if(!i)return;
      const p=gAdPrevMap[a.id]||null;
      const acc=accts.find(function(x){return x.customer_id===a.customer_id;});
      fr.push({name:a.name||'Ad',sub:[(acc&&acc.name)||'',campNameMap[a.campaign_id]||''].filter(Boolean).join(' · '),
        freq:0,ctr:i.ctr!=null?Number(i.ctr):null,pctr:p&&p.ctr!=null?Number(p.ctr):null,
        spend:Number(i.spend)||0,impr:Number(i.impressions)||0});
    });
    if(!fr.length){
      camps.forEach(function(c){
        const i=insMap[c.id]; if(!i)return;
        const p=pInsMap[c.id]||null;
        const acc=accts.find(function(x){return x.customer_id===c.customer_id;});
        fr.push({name:c.name||'Campaign',sub:(acc&&acc.name)||'',freq:0,
          ctr:i.ctr!=null?Number(i.ctr):null,pctr:p&&p.ctr!=null?Number(p.ctr):null,
          spend:Number(i.spend)||0,impr:Number(i.impressions)||0});
      });
    }
    body=cmpFatiguePage(fr.filter(function(x){return x.spend>0||x.impr>0;}),inr,num,'Google · CTR trend (Google publishes no per-person frequency)',true);
  }
  const showKpis=(ti!==4&&ti!==5);
  v.innerHTML=cmpCss+CMP_EXTRA_CSS+mHead('fa-bullhorn','#db2777','Campaign Analytics')+cmpSourceBar()+cmpPeriodBar()+mTabs('campaigns',tabs,ti)+'<div style="margin-top:14px">'+(showKpis?kpiStrip:'')+cap+legend+body+'</div>';
  cmpRunAlerts();
  if(ti===0&&window.Chart){setTimeout(function(){
    const labels=rows.map(function(r){return r.a.name;});
    const palette=['#4285f4','#db2777','#0d9488','#7c3aed','#ea4335','#16a34a','#c2410c','#eab308','#2563eb','#0891b2'];
    const gy={grid:{color:'#f1f5f9'},ticks:{font:{size:11}}},gx={grid:{display:false},ticks:{font:{size:11}}};
    try{new Chart(document.getElementById('gCh1'),{type:'bar',data:{labels:labels,datasets:[{label:'Spend (₹)',data:rows.map(function(r){return r.spend;}),backgroundColor:'#4285f4',borderRadius:6,maxBarThickness:48}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:gy,x:gx}}});}catch(e){}
    try{new Chart(document.getElementById('gCh2'),{type:'bar',data:{labels:labels,datasets:[{label:'Conversions',data:rows.map(function(r){return r.conv;}),backgroundColor:'#0d9488',borderRadius:6,maxBarThickness:48}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:gy,x:gx}}});}catch(e){}
    try{new Chart(document.getElementById('gCh3'),{type:'doughnut',data:{labels:labels,datasets:[{data:rows.map(function(r){return r.spend;}),backgroundColor:labels.map(function(_,i){return palette[i%palette.length];}),borderWidth:2,borderColor:'#fff'}]},options:{responsive:true,maintainAspectRatio:false,cutout:'60%',plugins:{legend:{position:'right',labels:{boxWidth:12,font:{size:11}}}}}});}catch(e){}
    try{new Chart(document.getElementById('gCh4'),{type:'bar',data:{labels:labels,datasets:[{label:'Cost / Conv (₹)',data:rows.map(function(r){return r.cpl!=null?Math.round(r.cpl):0;}),backgroundColor:'#0ea5e9',borderRadius:6,maxBarThickness:48}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:gy,x:gx}}});}catch(e){}
  },60);}
}
VIEWS.campaigns=async function(v,seg){
  setCrumb(['Growth & Strategy','Campaign Analytics']);
  if(CMP_SOURCE==='google'){ return cmpGoogleView(v,seg); }
  if(CMP_SOURCE==='both'){ return cmpBothView(v,seg); }
  const tabs=['Overview','Campaigns','By Project','Ads','Trend','Ad Fatigue'];const ti=mTab(seg,tabs.length);
  v.innerHTML=cmpSourceBar()+cmpPeriodBar()+'<div class="loader"><div class="spin"></div></div>';
  const needAd=(ti===3||ti===5);
  const periodKey=CMP_PERIOD==='custom'?('custom:'+CMP_SINCE+':'+CMP_UNTIL):CMP_PERIOD;
  const periodLabel=CMP_PERIOD==='custom'?(CMP_SINCE&&CMP_UNTIL?CMP_SINCE+' → '+CMP_UNTIL:'Custom range'):((CMP_PRESETS.find(function(p){return p[0]===CMP_PERIOD;})||[])[1]||CMP_PERIOD);
  // Ask the live Edge Function to make sure this exact period+level is fresh (it caches
  // for a few minutes server-side, so repeat opens are fast — only a real cache miss
  // actually calls out to Meta).
  if(CMP_PERIOD!=='custom'||(CMP_SINCE&&CMP_UNTIL)){
    try{
      const {data:{session}}=await sb.auth.getSession();
      const token=session&&session.access_token;
      const reqBody=CMP_PERIOD==='custom'?{level:needAd?'ad':'campaign',period:'custom',since:CMP_SINCE,until:CMP_UNTIL}:{level:needAd?'ad':'campaign',period:CMP_PERIOD};
      await fetch(SUPABASE_URL+'/functions/v1/campaign-analytics-live',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},body:JSON.stringify(reqBody)});
    }catch(e){}
  }
  await cmpSyncPrev('meta');
  const CMP=()=>sb.schema('camp');
  const prevKey=cmpPrevKey();
  let accounts=[],campaigns=[],cIns=[],ads=[],aIns=[],cPrev=[],aPrev=[];
  try{
    const calls=[
      CMP().from('ad_accounts').select('*').order('name'),
      CMP().from('campaigns').select('*'),
      CMP().from('campaign_insights').select('*').eq('period',periodKey)
    ];
    const iPrevC=calls.length; if(prevKey)calls.push(CMP().from('campaign_insights').select('*').eq('period',prevKey));
    let iAds=-1,iAdIns=-1,iPrevA=-1;
    if(needAd){ iAds=calls.length; calls.push(CMP().from('ads').select('*')); iAdIns=calls.length; calls.push(CMP().from('ad_insights').select('*').eq('period',periodKey)); if(prevKey){ iPrevA=calls.length; calls.push(CMP().from('ad_insights').select('*').eq('period',prevKey)); } }
    const results=await Promise.all(calls);
    const at=function(i){return (i>=0&&results[i]&&results[i].data)?results[i].data:[];};
    accounts=at(0);campaigns=at(1);cIns=at(2);
    if(prevKey)cPrev=at(iPrevC);
    if(needAd){ads=at(iAds);aIns=at(iAdIns);if(iPrevA>=0)aPrev=at(iPrevA);}
  }catch(e){}
  const cPrevMap={};cPrev.forEach(function(x){cPrevMap[x.campaign_id]=x;});
  const aPrevMap={};aPrev.forEach(function(x){aPrevMap[x.ad_id]=x;});
  const cInsMap={};cIns.forEach(x=>cInsMap[x.campaign_id]=x);
  const aInsMap={};aIns.forEach(x=>aInsMap[x.ad_id]=x);
  const campMap={};campaigns.forEach(x=>campMap[x.id]=x);
  const inr=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});
  const num=n=>Number(n||0).toLocaleString('en-IN');
  const belongsToProj=function(c,acc){ return c.name&&acc.name&&String(c.name).trim().toLowerCase().startsWith(String(acc.name).trim().toLowerCase()); };
  const projRows=accounts.map(acc=>{
    const accCamps=campaigns.filter(c=>c.ad_account_id===acc.ad_account_id&&belongsToProj(c,acc));
    let spend=0,impr=0,clicks=0,leads=0,reach=0,budget=0,freqSum=0,freqN=0;
    let pspend=0,pimpr=0,pclicks=0,pleads=0;
    accCamps.forEach(c=>{
      const i=cInsMap[c.id];
      if(i){spend+=Number(i.spend)||0;impr+=Number(i.impressions)||0;clicks+=Number(i.clicks)||0;leads+=Number(i.leads)||0;reach+=Number(i.reach)||0;const f=Number(i.frequency)||0;if(f>0){freqSum+=f;freqN++;}}
      const p=cPrevMap[c.id];
      if(p){pspend+=Number(p.spend)||0;pimpr+=Number(p.impressions)||0;pclicks+=Number(p.clicks)||0;pleads+=Number(p.leads)||0;}
      // budget counts ACTIVE campaigns only — paused ones aren't spending
      if(cmpIsActive(c.status)) budget+=Number(c.daily_budget)||Number(c.lifetime_budget)||0;
    });
    return {acc,campaigns:accCamps.length,spend,impr,clicks,leads,reach,budget,
      freq:freqN?(freqSum/freqN):0,
      ctr:impr?(clicks/impr*100):0,cpl:leads?(spend/leads):null,
      pspend,pleads,pctr:pimpr?(pclicks/pimpr*100):0,pcpl:pleads?(pspend/pleads):null};
  });
  CMP_LAST={accounts,campaigns,cInsMap,periodLabel,inr,num,ads,aInsMap,campMap,cPrevMap,aPrevMap};
  const totalSpend=projRows.reduce((s,r)=>s+r.spend,0);
  const totalImpr=projRows.reduce((s,r)=>s+r.impr,0);
  const totalClicks=projRows.reduce((s,r)=>s+r.clicks,0);
  const totalLeads=projRows.reduce((s,r)=>s+r.leads,0);
  const avgCtr=totalImpr?(totalClicks/totalImpr*100):0;
  const totalCpl=totalLeads?(totalSpend/totalLeads):null;
  // previous-period totals (for the Trend pills)
  const pTotSpend=cPrev.reduce((s,x)=>s+(Number(x.spend)||0),0);
  const pTotImpr=cPrev.reduce((s,x)=>s+(Number(x.impressions)||0),0);
  const pTotClicks=cPrev.reduce((s,x)=>s+(Number(x.clicks)||0),0);
  const pTotLeads=cPrev.reduce((s,x)=>s+(Number(x.leads)||0),0);
  const pTotReach=cPrev.reduce((s,x)=>s+(Number(x.reach)||0),0);
  const pAvgCtr=pTotImpr?(pTotClicks/pTotImpr*100):0;
  const pTotCpl=pTotLeads?(pTotSpend/pTotLeads):null;
  const pAvgCpc=pTotClicks?(pTotSpend/pTotClicks):null;
  const metaFreq=(function(){const f=projRows.map(r=>r.freq).filter(x=>x>0);return f.length?(f.reduce((a,b)=>a+b,0)/f.length):0;})();
  const metaBudget=projRows.reduce((s,r)=>s+r.budget,0);
  const kpis=[['Spend ('+periodLabel+')',inr(totalSpend),accounts.length+' projects'],['Results (Leads)',num(totalLeads),''],['Cost / Lead',totalCpl!=null?inr(totalCpl):'—','',totalCpl!=null?'#16855a':'var(--slate)'],['Impressions',num(totalImpr),''],['Avg CTR',avgCtr.toFixed(2)+'%','',avgCtr>=1?'#16855a':'#c2410c']];
  let body;
  if(ti===0){ body='<div class="cmp-charts">'
      +'<div class="cmp-chcard"><h4>Spend by project</h4><div class="sub">'+esc(periodLabel)+' · click a bar for campaign detail</div><div style="height:260px"><canvas id="cmpCh1"></canvas></div></div>'
      +'<div class="cmp-chcard"><h4>Results (Leads) by project</h4><div class="sub">'+esc(periodLabel)+' · click a bar for campaign detail</div><div style="height:260px"><canvas id="cmpCh2"></canvas></div></div>'
      +'<div class="cmp-chcard"><h4>Spend share</h4><div class="sub">where the budget is going</div><div style="height:260px"><canvas id="cmpCh3"></canvas></div></div>'
      +'<div class="cmp-chcard"><h4>Cost per lead by project</h4><div class="sub">lower is better · in ₹</div><div style="height:260px"><canvas id="cmpCh4"></canvas></div></div>'
    +'</div>'; }
  else if(ti===1){
    // Campaign-wise, with Active / Inactive filtering
    const all=campaigns.map(function(c){
      const acc=accounts.find(function(a){return a.ad_account_id===c.ad_account_id;});
      const i=cInsMap[c.id]||null, p=cPrevMap[c.id]||null;
      const spend=i?(Number(i.spend)||0):0, leads=i?(Number(i.leads)||0):0;
      const budget=c.daily_budget!=null?Number(c.daily_budget):(c.lifetime_budget!=null?Number(c.lifetime_budget):null);
      return {c:c,acc:acc,i:i,p:p,spend:spend,leads:leads,budget:budget,
        cpl:leads?spend/leads:null,ctr:i&&i.ctr!=null?Number(i.ctr):null,
        pspend:p?(Number(p.spend)||0):null,
        pcpl:(p&&(Number(p.leads)||0))?((Number(p.spend)||0)/(Number(p.leads)||0)):null,
        pctr:p&&p.ctr!=null?Number(p.ctr):null,
        active:cmpIsActive(c.status)};
    }).filter(function(r){return r.acc;})
      .filter(function(r){return CMP_CAMP_PROJECT==='all'||r.acc.ad_account_id===CMP_CAMP_PROJECT;});
    const counts={all:all.length,active:all.filter(function(r){return r.active;}).length,inactive:all.filter(function(r){return !r.active;}).length};
    const shown=all.filter(function(r){return CMP_STATUS==='all'||(CMP_STATUS==='active'?r.active:!r.active);}).sort(function(a,b){return b.spend-a.spend;});
    const projBar='<div class="cmp-projbar"><select class="cmp-projsel" onchange="cmpSetCampProject(this.value)">'
      +'<option value="all"'+(CMP_CAMP_PROJECT==='all'?' selected':'')+'>All Projects</option>'
      +accounts.map(function(a){return '<option value="'+esc(a.ad_account_id)+'"'+(CMP_CAMP_PROJECT===a.ad_account_id?' selected':'')+'>'+esc(a.name)+'</option>';}).join('')
      +'</select></div>';
    const rowsHtml=shown.length?shown.map(function(r){
      const used=r.budget?Math.round(r.spend/r.budget*100):null;
      return '<tr><td><div class="cmp-nm">'+esc(r.c.name||'—')+'</div><div class="cmp-sub">'+esc(r.acc.name)+(r.c.objective?(' · '+esc(String(r.c.objective).replace(/_/g,' ').toLowerCase())):'')+'</div></td>'
        +'<td>'+(r.active?'<span class="cmp-fg ok"><i class="fa-solid fa-circle"></i> Active</span>':'<span class="cmp-fg na" style="color:#98a2b3"><i class="fa-solid fa-circle"></i> '+esc(r.c.status?String(r.c.status).charAt(0)+String(r.c.status).slice(1).toLowerCase():'Inactive')+'</span>')+'</td>'
        +'<td class="num">'+(r.budget?(inr(r.budget)+(used!=null?'<div class="cmp-sub" style="text-align:right'+(used>100?';color:#c0392f':'')+'">'+used+'% used</div>':'')):'—')+'</td>'
        +'<td class="num strong">'+inr(r.spend)+'</td>'
        +'<td class="num">'+cmpTrend(r.spend,r.pspend,false)+'</td>'
        +'<td class="num">'+num(r.leads)+'</td>'
        +'<td class="num">'+(r.cpl!=null?inr(r.cpl):'—')+'</td>'
        +'<td class="num">'+cmpTrend(r.cpl,r.pcpl,true)+'</td>'
        +'<td class="num">'+(r.ctr!=null?r.ctr.toFixed(2)+'%':'—')+'</td>'
        +'<td>'+cmpFatigue(r.i?(Number(r.i.frequency)||0):0,r.ctr,r.pctr)+'</td></tr>';
    }).join(''):'<tr><td colspan="10" class="cmp-none">No campaigns match this filter</td></tr>';
    body=projBar+cmpStatusBar(counts)+'<div class="cmp-panel"><div class="cmp-phead"><div><span class="cmp-over">Campaigns</span><h3>'+shown.length+' campaign'+(shown.length===1?'':'s')+'</h3></div><span class="cmp-chip">'+esc(periodLabel)+'</span></div>'
      +'<div class="cmp-tblwrap"><table class="cmp-tbl"><thead><tr><th>Campaign</th><th>Status</th><th class="num">Budget</th><th class="num">Spend</th><th class="num">Trend</th><th class="num">Leads</th><th class="num">Cost / Lead</th><th class="num">vs prev</th><th class="num">CTR</th><th>Fatigue</th></tr></thead><tbody>'+rowsHtml+'</tbody></table></div></div>';
  }
  else if(ti===2){
    const sorted=projRows.slice().sort((a,b)=>b.spend-a.spend);
    body=sorted.length?('<div class="card qc-table-card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+
      ['Project','Campaigns','Daily Budget','Spend','Trend','Results (Leads)','Cost / Lead','Reach','CTR','Fatigue'].map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+
      '</tr></thead><tbody>'+
      sorted.map(function(r){
        const used=r.budget?Math.round(r.spend/r.budget*100):null;
        return '<tr class="clk" onclick="cmpShowProject(\''+r.acc.ad_account_id+'\')">'+
        '<td style="font-weight:600">'+esc(r.acc.name)+'</td>'+
        '<td style="text-align:right">'+r.campaigns+'</td>'+
        '<td style="text-align:right">'+(r.budget?(inr(r.budget)+'<span style="color:var(--slate);font-size:11px">/day</span>'+(used!=null?'<div style="font-size:10.5px;color:'+(used>100?'#b91c1c':'var(--slate)')+'">'+used+'% used</div>':'')):'—')+'</td>'+
        '<td style="text-align:right;font-weight:600">'+inr(r.spend)+'</td>'+
        '<td style="text-align:right">'+cmpTrend(r.spend,r.pspend,false)+'</td>'+
        '<td style="text-align:right">'+num(r.leads)+' '+cmpTrend(r.leads,r.pleads,false)+'</td>'+
        '<td style="text-align:right">'+(r.cpl!=null?inr(r.cpl):'—')+' '+cmpTrend(r.cpl,r.pcpl,true)+'</td>'+
        '<td style="text-align:right">'+num(r.reach)+'</td>'+
        '<td style="text-align:right">'+r.ctr.toFixed(2)+'%</td>'+
        '<td style="text-align:right">'+cmpFatigue(r.freq,r.ctr,r.pctr)+'</td>'+
      '</tr>';}).join('')+
      '</tbody></table></div></div>'):'<div class="card card-pad empty"><i class="fa-solid fa-chart-pie"></i><div>No project data for this period</div></div>';
  }
  else if(ti===4){
    // ---- Trend page ----
    body=cmpTrendPage(projRows.map(function(r){return {name:r.acc.name,sub:r.campaigns+' campaign'+(r.campaigns===1?'':'s'),spend:r.spend,pspend:r.pspend,res:r.leads,pres:r.pleads,cpr:r.cpl,pcpr:r.pcpl};}),
      {spend:totalSpend,pspend:pTotSpend,res:totalLeads,pres:pTotLeads,cpr:totalCpl,pcpr:pTotCpl,clk:totalClicks,pclk:pTotClicks,ctr:avgCtr,pctr:pAvgCtr},inr,num,'leads');
  }
  else if(ti===5){
    // ---- Ad Fatigue page (per ad when available, else per campaign) ----
    const fr=[];
    ads.forEach(function(a){
      const i=aInsMap[a.id]; if(!i)return;
      const p=aPrevMap[a.id]||null;
      const acc=accounts.find(function(x){return x.ad_account_id===a.ad_account_id;});
      const camp=campMap[a.campaign_id];
      fr.push({name:a.name||'Ad',sub:[(acc&&acc.name)||'',(camp&&camp.name)||''].filter(Boolean).join(' · '),
        freq:Number(i.frequency)||0,ctr:i.ctr!=null?Number(i.ctr):null,pctr:p&&p.ctr!=null?Number(p.ctr):null,
        spend:Number(i.spend)||0,impr:Number(i.impressions)||0});
    });
    if(!fr.length){
      campaigns.forEach(function(c){
        const i=cInsMap[c.id]; if(!i)return;
        const p=cPrevMap[c.id]||null;
        const acc=accounts.find(function(x){return x.ad_account_id===c.ad_account_id;});
        fr.push({name:c.name||'Campaign',sub:(acc&&acc.name)||'',freq:Number(i.frequency)||0,
          ctr:i.ctr!=null?Number(i.ctr):null,pctr:p&&p.ctr!=null?Number(p.ctr):null,
          spend:Number(i.spend)||0,impr:Number(i.impressions)||0});
      });
    }
    body=cmpFatiguePage(fr.filter(function(x){return x.spend>0||x.impr>0;}),inr,num,'Meta · per-person frequency + CTR trend');
  }
  else {
    const filteredAccIds=new Set((CMP_AD_PROJECT==='all'?accounts:accounts.filter(a=>a.ad_account_id===CMP_AD_PROJECT)).map(a=>a.ad_account_id));
    const allAdRows=ads.map(a=>{const i=aInsMap[a.id];const camp=campMap[a.campaign_id];const acc=accounts.find(x=>x.ad_account_id===a.ad_account_id);return {a,i,camp,acc,spend:i?Number(i.spend)||0:0};})
      .filter(r=>r.i&&r.acc&&filteredAccIds.has(r.acc.ad_account_id)&&r.camp&&belongsToProj(r.camp,r.acc)).sort((x,y)=>y.spend-x.spend);
    const projFilterBar='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">'+
      '<select onchange="cmpSetAdProject(this.value)" style="padding:7px 10px;border:1px solid var(--line);border-radius:8px;font-size:12.5px;font-family:inherit">'+
        '<option value="all"'+(CMP_AD_PROJECT==='all'?' selected':'')+'>All Projects</option>'+
        accounts.map(function(a){return '<option value="'+esc(a.ad_account_id)+'"'+(CMP_AD_PROJECT===a.ad_account_id?' selected':'')+'>'+esc(a.name)+'</option>';}).join('')+
      '</select>'+
      '<span style="color:var(--slate);font-size:12.5px">'+allAdRows.length+' ad'+(allAdRows.length===1?'':'s')+'</span>'+
    '</div>';
    const PAGE_SIZE=25;
    const totalPages=Math.max(1,Math.ceil(allAdRows.length/PAGE_SIZE));
    const curPage=Math.min(CMP_AD_PAGE,totalPages-1);
    const pageRows=allAdRows.slice(curPage*PAGE_SIZE,(curPage+1)*PAGE_SIZE);
    const tbl=pageRows.length?('<div class="card qc-table-card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+
      ['Ad','Project','Campaign','Status','Spend','Trend','Clicks','CTR','Fatigue'].map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+
      '</tr></thead><tbody>'+
      pageRows.map(function(r){
        const p=aPrevMap[r.a.id]||null;
        const pSp=p?(Number(p.spend)||0):null, pCt=p?(Number(p.ctr)||0):null;
        return '<tr class="clk" onclick="cmpShowProjectAds(\''+r.acc.ad_account_id+'\')">'+
        '<td style="font-weight:600">'+esc(r.a.name)+'</td>'+
        '<td>'+esc(r.acc.name)+'</td>'+
        '<td>'+esc(r.camp.name)+'</td>'+
        '<td>'+esc(r.a.effective_status||r.a.status||'—')+'</td>'+
        '<td style="text-align:right;font-weight:600">'+inr(r.spend)+'</td>'+
        '<td style="text-align:right">'+cmpTrend(r.spend,pSp,false)+'</td>'+
        '<td style="text-align:right">'+num(r.i.clicks)+'</td>'+
        '<td style="text-align:right">'+(r.i.ctr!=null?Number(r.i.ctr).toFixed(2)+'%':'—')+'</td>'+
        '<td style="text-align:right">'+cmpFatigue(Number(r.i.frequency)||0,r.i.ctr,pCt)+'</td>'+
      '</tr>';}).join('')+
      '</tbody></table></div></div>'):'<div class="card card-pad empty"><i class="fa-solid fa-rectangle-ad"></i><div>No ad-level data for this project/period</div></div>';
    const pager=allAdRows.length>PAGE_SIZE?('<div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:12px">'+
      '<button class="btn" style="padding:6px 12px;font-size:12.5px" '+(curPage<=0?'disabled':('onclick="cmpSetAdPage('+(curPage-1)+')"'))+'>Prev</button>'+
      '<span style="color:var(--slate);font-size:12.5px">Page '+(curPage+1)+' of '+totalPages+'</span>'+
      '<button class="btn" style="padding:6px 12px;font-size:12.5px" '+(curPage>=totalPages-1?'disabled':('onclick="cmpSetAdPage('+(curPage+1)+')"'))+'>Next</button>'+
    '</div>'):'';
    body=projFilterBar+tbl+pager;
  }
  const totalReach=projRows.reduce((s,r)=>s+r.reach,0);
  const avgCpc=totalClicks?(totalSpend/totalClicks):null;
  // Scoped premium styling for the dashboard (re-injected with the view; harmless to repeat).
  const cmpCss='<style>'
    +'.cmp-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:0 0 18px}'
    +'@media(max-width:1100px){.cmp-kpis{grid-template-columns:repeat(3,1fr)}}'
    +'@media(max-width:640px){.cmp-kpis{grid-template-columns:repeat(2,1fr);gap:10px}.cmp-kpi{padding:12px 13px}.cmp-kpi .kv{font-size:20px}.cmp-kpi .ki{width:30px;height:30px;font-size:13px}}'
    +'.cmp-kpi{position:relative;background:#fff;border:1px solid var(--line);border-radius:14px;padding:15px 16px;box-shadow:var(--shadow);overflow:hidden}'
    +'.cmp-kpi::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--kc,#db2777)}'
    +'.cmp-kpi .kh{display:flex;align-items:center;justify-content:space-between;gap:8px}'
    +'.cmp-kpi .ki{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;background:var(--kbg,#fdf2f8);color:var(--kc,#db2777)}'
    +'.cmp-kpi .kl{font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--slate)}'
    +'.cmp-kpi .kv{font-size:24px;font-weight:800;letter-spacing:-.5px;color:var(--ink,#0f172a);margin-top:12px;line-height:1}'
    +'.cmp-kpi .ks{font-size:11.5px;color:var(--slate);margin-top:5px;min-height:14px}'
    +'.cmp-charts{display:grid;grid-template-columns:1fr 1fr;gap:16px}'
    +'@media(max-width:900px){.cmp-charts{grid-template-columns:1fr}}'
    +'.cmp-chcard{background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);padding:16px}'
    +'.cmp-chcard h4{margin:0;font-size:13.5px;font-weight:700;color:var(--ink,#0f172a)}'
    +'.cmp-chcard .sub{font-size:11.5px;color:var(--slate);margin:3px 0 12px}'
    +'.cmp-cap{font-size:12px;color:var(--slate);margin:-4px 0 14px;display:flex;align-items:center;gap:7px}'
    +'</style>';
  const cmpKpi=function(icon,label,value,sub,color,bg,trend){return '<div class="cmp-kpi" style="--kc:'+color+';--kbg:'+bg+'"><div class="kh"><span class="kl">'+esc(label)+'</span><span class="ki"><i class="fa-solid '+icon+'"></i></span></div><div class="kv">'+esc(value)+'</div><div class="ks">'+esc(sub||'')+'</div>'+(trend?'<div class="ktr">'+trend+'</div>':'')+'</div>';};
  const kpiStrip='<div class="cmp-kpis">'
    +cmpKpi('fa-indian-rupee-sign','Spend',inr(totalSpend),accounts.length+' project'+(accounts.length===1?'':'s'),'#db2777','#fdf2f8',cmpTrend(totalSpend,pTotSpend,false))
    +cmpKpi('fa-wallet','Daily Budget',metaBudget?inr(metaBudget):'—','across campaigns','#6366f1','#eef2ff',metaBudget?('<span class="cmp-tr flat" title="Share of the daily budget already spent"><i class="fa-solid fa-gauge-high"></i> '+Math.round(totalSpend/metaBudget*100)+'% used</span>'):'')
    +cmpKpi('fa-user-plus','Results (Leads)',num(totalLeads),totalLeads?'generated':'no leads yet','#7c3aed','#f5f3ff',cmpTrend(totalLeads,pTotLeads,false))
    +cmpKpi('fa-tags','Cost / Lead',totalCpl!=null?inr(totalCpl):'—','lower is better','#0ea5e9','#f0f9ff',cmpTrend(totalCpl,pTotCpl,true))
    +cmpKpi('fa-eye','Impressions',num(totalImpr),'','#0891b2','#ecfeff',cmpTrend(totalImpr,pTotImpr,false))
    +cmpKpi('fa-users','Reach',num(totalReach),(totalReach&&totalImpr)?((totalImpr/totalReach).toFixed(1)+'x seen on avg'):'','#0d9488','#f0fdfa',cmpTrend(totalReach,pTotReach,false))
    +cmpKpi('fa-hand-pointer','Clicks',num(totalClicks),'','#2563eb','#eff6ff',cmpTrend(totalClicks,pTotClicks,false))
    +cmpKpi('fa-percent','Avg CTR',avgCtr.toFixed(2)+'%',avgCtr>=1?'healthy':'below 1%','#16a34a','#f0fdf4',cmpTrend(avgCtr,pAvgCtr,false))
    +cmpKpi('fa-coins','Avg CPC',avgCpc!=null?inr(avgCpc):'—','per click','#c2410c','#fff7ed',cmpTrend(avgCpc,pAvgCpc,true))
    +cmpKpi('fa-fire','Ad Fatigue',metaFreq?(metaFreq.toFixed(1)+'x'):'—','seen per person','#e11d48','#fff1f2',cmpFatigue(metaFreq,avgCtr,pAvgCtr))
    +'</div>';
  const syncCap='<div class="cmp-cap"><i class="fa-brands fa-facebook" style="color:#1877f2"></i> Live Meta Ads · '+esc(periodLabel)+(accounts.length?(' · '+accounts.length+' ad account'+(accounts.length===1?'':'s')):'')+'</div>';
  const legend='<div class="cmp-legend"><span>Trend compares with '+esc(cmpPrevLabel())+'</span><span>Fatigue = times each person saw the ad + whether CTR is falling</span></div>';
  const showKpis=(ti!==4&&ti!==5);
  v.innerHTML=cmpCss+CMP_EXTRA_CSS+mHead('fa-bullhorn','#db2777','Campaign Analytics')+cmpSourceBar()+cmpPeriodBar()+mTabs('campaigns',tabs,ti)+'<div style="margin-top:14px">'+(showKpis?kpiStrip:'')+syncCap+legend+body+'</div>';
  cmpRunAlerts();
  if(ti===0&&window.Chart){setTimeout(function(){
    const labels=projRows.map(r=>r.acc.name);
    const accIds=projRows.map(r=>r.acc.ad_account_id);
    const clickPt=function(evt,elements){if(elements&&elements.length){cmpShowProject(accIds[elements[0].index]);}};
    const hoverPt=function(evt,elements){if(evt&&evt.native&&evt.native.target)evt.native.target.style.cursor=elements.length?'pointer':'default';};
    const palette=['#db2777','#7c3aed','#2563eb','#0891b2','#0d9488','#16a34a','#c2410c','#eab308','#e11d48','#4f46e5'];
    const gy={grid:{color:'#f1f5f9'},ticks:{font:{size:11}}},gx={grid:{display:false},ticks:{font:{size:11}}};
    try{new Chart(document.getElementById('cmpCh1'),{type:'bar',data:{labels,datasets:[{label:'Spend (₹)',data:projRows.map(r=>r.spend),backgroundColor:'#db2777',borderRadius:6,maxBarThickness:48}]},options:{responsive:true,maintainAspectRatio:false,onClick:clickPt,onHover:hoverPt,plugins:{legend:{display:false}},scales:{y:gy,x:gx}}});}catch(e){}
    try{new Chart(document.getElementById('cmpCh2'),{type:'bar',data:{labels,datasets:[{label:'Leads',data:projRows.map(r=>r.leads),backgroundColor:'#0A2640',borderRadius:6,maxBarThickness:48}]},options:{responsive:true,maintainAspectRatio:false,onClick:clickPt,onHover:hoverPt,plugins:{legend:{display:false}},scales:{y:gy,x:gx}}});}catch(e){}
    try{new Chart(document.getElementById('cmpCh3'),{type:'doughnut',data:{labels,datasets:[{data:projRows.map(r=>r.spend),backgroundColor:labels.map(function(_,i){return palette[i%palette.length];}),borderWidth:2,borderColor:'#fff'}]},options:{responsive:true,maintainAspectRatio:false,cutout:'60%',onClick:clickPt,onHover:hoverPt,plugins:{legend:{position:'right',labels:{boxWidth:12,font:{size:11}}}}}});}catch(e){}
    try{new Chart(document.getElementById('cmpCh4'),{type:'bar',data:{labels,datasets:[{label:'Cost / Lead (₹)',data:projRows.map(r=>r.cpl!=null?Math.round(r.cpl):0),backgroundColor:'#0ea5e9',borderRadius:6,maxBarThickness:48}]},options:{responsive:true,maintainAspectRatio:false,onClick:clickPt,onHover:hoverPt,plugins:{legend:{display:false}},scales:{y:gy,x:gx}}});}catch(e){}
  },60);}
};
VIEWS.scaling=function(v,seg){
  setCrumb(['Growth & Strategy','Scaling Up']);
  const tabs=['Strategy (OPSP)','Priorities (Rocks)','KPI scoreboard','Meeting rhythm','Learning hub'];const ti=mTab(seg,tabs.length);
  let body;
  if(ti===0){
    const txt=(t,b)=>'<div class="card card-pad"><div class="sec-title" style="margin:0 0 8px">'+t+'</div><p style="color:#3C4B59;font-size:13.5px;line-height:1.5">'+b+'</p></div>';
    const lst=(t,rows)=>'<div class="card card-pad"><div class="sec-title" style="margin:0 0 4px">'+t+'</div>'+rows.map(r=>'<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line-2)"><span style="color:var(--slate)">'+esc(r[0])+'</span><b>'+esc(r[1])+'</b></div>').join('')+'</div>';
    body='<div class="m3grid">'+txt('Core purpose','Building landmark spaces that families and businesses are proud to own.')+txt('Core values','Integrity · Quality · On-time delivery · Customer-first · Discipline.')+txt('BHAG (10-yr)','Be Central India’s most-trusted developer — 10,000 homes delivered, zero RERA defaults.')+
      lst('3-yr target',[['Revenue','₹450 Cr'],['Active projects','10'],['Units / yr','600']])+lst('1-yr plan (FY26-27)',[['Revenue','₹165 Cr'],['Bookings','260 units'],['Collections','92%+']])+lst('Brand promise KPIs',[['On-time handover','≥ 95%'],['CSAT','≥ 4.5 / 5'],['Snag closure','≤ 7 days']])+'</div>';
  } else if(ti===1){ body=mTable(['Rock','Owner','Quarter','Progress','Status'],[['Launch Riverdale Ph-1','Rishi','Q2','45%','On Track'],['Digitise procurement','Ops','Q2','70%','On Track']]); }
  else if(ti===2){ body=mTable(['KPI','Target','Actual','Status'],[['On-time handover','≥95%','93%','Watch'],['CSAT','≥4.5','4.6','Good']]); }
  else if(ti===3){ body=mTable(['Meeting','Cadence','Owner','Next'],[['Daily huddle','Daily','Ops','Tomorrow'],['Weekly L10','Weekly','Leadership','Mon']]); }
  else { body=mTable(['Resource','Type','Added'],[['Scaling Up (Verne Harnish)','Book','Jun 26'],['OKR masterclass','Course','May 26']]); }
  v.innerHTML=mHead('fa-arrow-trend-up','#0d9488','Scaling Up')+mTabs('scaling',tabs,ti)+'<div style="margin-top:16px">'+body+'</div>';
};
VIEWS.playbook=function(v,seg){
  setCrumb(['Growth & Strategy','Playbook']);
  const tabs=['All plays','Featured play','Roles (RACI)'];const ti=mTab(seg,tabs.length);
  let body;
  if(ti===0){
    const pills=['All','Sales','Projects','Procurement','HR','Finance','Legal'].map((p,i)=>'<button class="btn btn-sm'+(i===0?' btn-primary':'')+'">'+p+'</button>').join(' ');
    body='<div class="card card-pad"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px"><div style="flex:1;min-width:170px"><input class="sel" style="width:100%;height:38px" placeholder="Search plays…"></div>'+pills+'</div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Play</th><th>Department</th><th>Steps</th><th>Owner</th><th>Runs in</th><th>Status</th></tr></thead><tbody>'+
      [['Lead → Booking','Sales','8','Sales Head','CRM','<span class="tag t-green">Live · v3</span>'],['Booking → Registration','Sales / Legal','7','Sales Head','CRM + Legal','<span class="tag t-green">Live · v2</span>'],['Indent → Goods receipt','Procurement','6','Procurement Mgr','Procurement','<span class="tag t-green">Live · v2</span>'],['Contractor onboarding','Procurement / Legal','5','Procurement Mgr','Procurement','<span class="tag t-green">Live · v1</span>'],['Stage handover (unit)','Projects','6','Projects Head','Projects','<span class="tag t-green">Live · v2</span>'],['Hire → Induct','HR','9','HR Manager','Recruitment + HR','<span class="tag t-green">Live · v2</span>'],['Monthly compliance close','Finance / Legal','7','CFO','Compliance','<span class="tag t-green">Live · v1</span>'],['Demand → Collection','Finance','5','CFO','CRM + Finance','<span class="tag t-amber">Draft · v1</span>']].map(r=>'<tr><td><b>'+r[0]+'</b></td><td>'+r[1]+'</td><td>'+r[2]+'</td><td>'+r[3]+'</td><td>'+r[4]+'</td><td>'+r[5]+'</td></tr>').join('')+'</tbody></table></div></div>';
  } else if(ti===1){ body=mCard('Featured play — Lead → Booking',mStep(['Capture','Qualify','Site visit','Negotiate','Token','Booking','Agreement','Register'],'Site visit')); }
  else { body=mTable(['Step','Responsible','Accountable','Consulted','Informed'],[['Site visit','Sales Exec','Sales Head','CRM','Director'],['Booking','Sales Head','Director','Finance','Legal']]); }
  v.innerHTML=mHead('fa-book-open','#4338ca','Playbook')+mTabs('playbook',tabs,ti)+'<div style="margin-top:16px">'+body+'</div>';
};

/* ---------- COMPETITOR ADS — Meta Ad Library watchlist ---------- */
// Tracks a fixed watchlist of competitors against Meta's public Ad Library API (ads_archive) via
// the competitor-ads-sync edge function. Deliberately NOT spend/reach — Meta only exposes those
// for political/issue ads, never ordinary commercial ones — this is "what are they running and
// for how long", sourced from camp.competitor_watchlist / camp.competitor_ads.
VIEWS.competitors=async function(v,seg){
  setCrumb(['Growth & Strategy','Competitor Ads']);
  v.innerHTML=mHead('fa-magnifying-glass-chart','#0369a1','Competitor Ads')
    +'<div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;margin:-8px 0 16px">'
      +'<p style="color:var(--slate);margin:0;flex:1;min-width:240px;font-size:13px">Public ad creative from Meta\'s Ad Library — not spend or reach, which Meta only exposes for political/issue ads.</p>'
      +'<div style="display:flex;gap:10px;flex-wrap:wrap">'
        +'<button class="btn" onclick="compAddModal()"><i class="fa-solid fa-plus"></i> Add Competitor</button>'
        +'<button class="btn btn-primary" id="compSyncAllBtn" onclick="compSyncAll()"><i class="fa-solid fa-rotate"></i> Sync All</button>'
      +'</div>'
    +'</div>'
    +'<div id="compBody"><div class="loader"><div class="spin"></div></div></div>';
  await compRender();
};
async function compRender(){
  const host=$('compBody'); if(!host)return;
  let wl=[],ads=[];
  try{ const {data}=await sb.schema('camp').from('competitor_watchlist').select('*').order('created_at',{ascending:false}); wl=data||[]; }catch(e){}
  try{ const {data}=await sb.schema('camp').from('competitor_ads').select('*').order('last_seen_at',{ascending:false}).limit(500); ads=data||[]; }catch(e){}
  if(!wl.length){ host.innerHTML='<div class="empty" style="padding:40px"><i class="fa-regular fa-folder-open"></i><div>No competitors added yet.</div></div>'; return; }
  host.innerHTML=wl.map(function(w){
    const wads=ads.filter(function(a){return a.watchlist_id===w.id;});
    const running=wads.filter(function(a){return !a.ad_delivery_stop_time;}).length;
    return '<div class="card card-pad" style="margin-bottom:16px">'
      +'<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">'
        +'<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:15px">'+esc(w.name)+'</div><div style="color:var(--slate);font-size:12px">Search term: "'+esc(w.search_term)+'" · '+wads.length+' ad(s) seen · '+running+' currently running</div></div>'
        +'<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--slate)"><input type="checkbox" '+(w.active?'checked':'')+' onchange="compToggleActive('+w.id+',this.checked)"> Active</label>'
        +'<button class="btn btn-sm" onclick="compSync('+w.id+',this)"><i class="fa-solid fa-rotate"></i> Sync</button>'
        +'<button class="btn btn-sm btn-danger" onclick="compRemove('+w.id+')"><i class="fa-solid fa-trash"></i></button>'
      +'</div>'
      +(wads.length
        ?'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">'+wads.slice(0,24).map(compAdCard).join('')+'</div>'
        :'<div class="empty" style="padding:20px"><i class="fa-regular fa-clock"></i><div>Not synced yet — click Sync</div></div>')
      +'</div>';
  }).join('');
}
function compAdCard(a){
  const stillRunning=!a.ad_delivery_stop_time;
  const bodies=Array.isArray(a.ad_creative_bodies)?a.ad_creative_bodies:[];
  const bodyText=bodies.length?String(bodies[0]).slice(0,140):'(no ad text)';
  const platforms=(Array.isArray(a.publisher_platforms)?a.publisher_platforms:[]).join(', ')||'—';
  const thumb=a.media_s3_path
    ?'<div style="height:120px;background:var(--bg,#f1f5f9);border:1px solid var(--line);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--slate);cursor:pointer" onclick="s3OpenSigned(\''+esc(a.media_s3_path)+'\')"><i class="fa-regular fa-image" style="font-size:20px"></i></div>'
    :(a.ad_snapshot_url?'<a href="'+esc(a.ad_snapshot_url)+'" target="_blank" rel="noopener" style="height:120px;background:var(--bg,#f1f5f9);border:1px solid var(--line);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--slate);font-size:12px;text-decoration:none">View on Facebook →</a>':'');
  return '<div style="border:1px solid var(--line);border-radius:10px;padding:10px">'
    +thumb
    +'<div style="font-size:12.5px;margin:8px 0 4px;line-height:1.4;max-height:56px;overflow:hidden">'+esc(bodyText)+'</div>'
    +'<div style="font-size:11px;color:var(--slate)">'+esc(a.page_name||'')+' · '+esc(platforms)+'</div>'
    +'<div style="font-size:11px;color:var(--slate);margin-top:4px">'+(stillRunning?'<span style="color:#16a34a;font-weight:600">Still running</span>':'Ended '+fmtDate(a.ad_delivery_stop_time))+' · since '+fmtDate(a.ad_delivery_start_time)+'</div>'
  +'</div>';
}
window.compAddModal=function(){
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-plus"></i> Add Competitor</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm"><label>Display name<input id="compName" placeholder="e.g. Godrej Properties"></label>'
    +'<label>Search term sent to Meta<input id="compSearchTerm" placeholder="Defaults to the name above"></label></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="compSave()"><i class="fa-solid fa-check"></i> Add</button></div>','md');
};
window.compSave=async function(){
  const name=(($('compName')&&$('compName').value)||'').trim();
  const term=(($('compSearchTerm')&&$('compSearchTerm').value)||'').trim()||name;
  if(!name){toast('Enter a name','err');return;}
  const {error}=await sb.schema('camp').from('competitor_watchlist').insert({name:name,search_term:term});
  if(error){toast(error.message,'err');return;}
  closeModal();toast('Competitor added','ok');
  await compRender();
};
window.compToggleActive=async function(id,active){
  await sb.schema('camp').from('competitor_watchlist').update({active:active}).eq('id',id);
};
window.compRemove=async function(id){
  const ok=await confirmDialog('Remove this competitor? Its stored ads will be deleted too.',{okLabel:'Remove'});
  if(!ok)return;
  await sb.schema('camp').from('competitor_watchlist').delete().eq('id',id);
  toast('Removed','ok');
  await compRender();
};
window.compSync=async function(id,btn){
  if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  try{
    const {data:{session}}=await sb.auth.getSession();
    const token=session&&session.access_token;
    const res=await fetch(SUPABASE_URL+'/functions/v1/competitor-ads-sync',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},
      body:JSON.stringify({watchlist_id:id})});
    const jr=await res.json().catch(function(){return {};});
    if(jr.error){toast(jr.error,'err');}
    else toast('Synced — '+(jr.newAds||0)+' new ad(s)','ok');
  }catch(e){toast('Sync failed','err');}
  await compRender();
};
window.compSyncAll=async function(){
  const btn=$('compSyncAllBtn');
  if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Syncing…';}
  try{
    const {data:{session}}=await sb.auth.getSession();
    const token=session&&session.access_token;
    const res=await fetch(SUPABASE_URL+'/functions/v1/competitor-ads-sync',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},
      body:JSON.stringify({})});
    const jr=await res.json().catch(function(){return {};});
    if(jr.error){toast(jr.error,'err');}
    else toast('Synced — '+(jr.newAds||0)+' new ad(s) across '+(jr.synced||0)+' total','ok');
  }catch(e){toast('Sync failed','err');}
  if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-rotate"></i> Sync All';}
  await compRender();
};


VIEWS.customer=function(v,seg){
  setCrumb(['Stakeholder Portals','Customer Portal']);
  const tabs=['My units','Payments & demands','Construction progress','My documents','Service requests'];const ti=mTab(seg,tabs.length);
  const kpis=[['My units','1','DV-C-1204'],['Total paid','25%','of agreement value'],['Next demand','05 Jul','15% on agreement','#e08600'],['Open requests','1','']];
  let body;
  if(ti===0){ body=mTable(['Unit','Project','Type','Carpet','Status','Agreement value'],[['DV-C-1204','Dream Valley Ph-2','3BHK','1180 sqft','<span class="tag t-amber">Booked</span>','₹1.18 Cr']]); }
  else if(ti===1){ body=mTable(['Milestone','Demand','Due','Amount','Status'],[['On booking','10%','Paid','₹11.8L','<span class="tag t-green">Paid</span>'],['On agreement','15%','05 Jul','₹17.7L','<span class="tag t-amber">Due</span>']]); }
  else if(ti===2){ body=mTable(['Tower','Stage','% Complete','Updated'],[['Tower C','Finishing','62%','Today']]); }
  else if(ti===3){ body=mTable(['Document','Type','Shared','Status'],[['Allotment Letter','PDF','24 Jun','Available']]); }
  else { body=mTable(['Ticket','Subject','Raised','Status'],[['SR-014','Parking allocation query','2 days','Open']]); }
  v.innerHTML=mHead('fa-user-tie','#1d4ed8','Customer Portal')+
    '<div class="card card-pad" style="background:#eff4ff;border-color:#cfe0ef;margin-bottom:16px;font-size:13.5px"><i class="fa-solid fa-user"></i> Signed in as <b>Suresh Agarwal</b> (customer). A customer sees only their own data — a separate, tokenised login backed by the same <b>core.parties</b> master, never the staff screens.</div>'+
    mKpis(kpis)+mTabs('customer',tabs,ti)+'<div style="margin-top:14px">'+body+'</div>';
};
VIEWS.supplier=function(v,seg){
  setCrumb(['Stakeholder Portals','Supplier Portal']);
  const tabs=['RFQs to respond','My POs / WOs','Invoices & RA bills','Payments','KYC & documents'];const ti=mTab(seg,tabs.length);
  const kpis=[['Open RFQs','2','awaiting your quote'],['Active POs','3',''],['Invoices pending','1','under 3-way match'],['Payments due','₹1.78 L','next 15 days','#16855a']];
  let body;
  if(ti===0){ body=mTable(['RFQ','Material','Qty','Project','Respond by','Status'],[['IND-0512','OPC 53 cement','400 bags','Dream Valley','29 Jun','<span class="tag t-amber">Open</span>'],['IND-0515','Waterproof compound','60 drums','Green Acres','01 Jul','<span class="tag t-amber">Open</span>']])+'<div style="margin-top:14px"><button class="btn btn-primary"><i class="fa-solid fa-plus"></i> Submit quote</button></div>'; }
  else if(ti===1){ body=mTable(['PO / WO','Item','Amount','Status','Date'],[['PO-0042','OPC 53 cement','₹4.2L','Dispatched','25 Jun']]); }
  else if(ti===2){ body=mTable(['Invoice','Against','Amount','Status','Due'],[['INV-2291','PO-0042','₹9.1L','3-way match','10 Jul']]); }
  else if(ti===3){ body=mTable(['Payment','Invoice','Amount','Mode','Date'],[['PMT-118','INV-2287','₹1.3L','RTGS','Paid']]); }
  else { body=mTable(['Document','Type','Status','Expiry'],[['GST certificate','KYC','Verified','—'],['PAN','KYC','Verified','—']]); }
  v.innerHTML=mHead('fa-truck','#0f766e','Supplier Portal')+
    '<div class="card card-pad" style="background:#fffbeb;border-color:#f0dfa8;margin-bottom:16px;font-size:13.5px"><i class="fa-solid fa-truck"></i> Signed in as <b>Shakti RMC</b> (vendor). Suppliers see only their own RFQs, POs and payments — same <b>core.parties</b> master, separate tokenised login.</div>'+
    mKpis(kpis)+mTabs('supplier',tabs,ti)+'<div style="margin-top:14px">'+body+'</div>';
};
VIEWS.whatsapp=function(v,seg){
  setCrumb(['Stakeholder Portals','WhatsApp Bot']);
  const tabs=['Live demo','Intents & flows','Broadcasts & templates','Conversations','Analytics'];const ti=mTab(seg,tabs.length);
  let body;
  if(ti===0){
    const roles=['Customer','Prospective buyer (lead)','Supplier / contractor','Employee','Prospective employee'].map((r,i)=>'<button class="btn'+(i===0?' btn-primary':'')+'" style="width:100%;justify-content:flex-start;margin-bottom:8px">'+r+'</button>').join('');
    body='<div class="grid" style="grid-template-columns:1.6fr 1fr;gap:16px"><div class="card" style="background:#e5ddd5;min-height:340px;padding:18px"><div style="background:#fff;border-radius:10px;padding:13px 15px;max-width:80%;font-size:13.5px;box-shadow:0 1px 2px rgba(0,0,0,.1)">Hi! I can share your payment status, construction progress, demand due dates and receipts, or log a service request. <span style="color:var(--slate)">(Demo: for DV-C-1204, 25% paid, next demand ₹17.7 L due 05 Jul, Tower C 62% complete.)</span></div></div>'+
      '<div><div class="card card-pad"><div class="sec-title" style="margin:0 0 12px">I am a…</div>'+roles+'</div><div class="card card-pad" style="margin-top:14px;background:#fffbeb;border-color:#f0dfa8;font-size:12.5px"><i class="fa-solid fa-lock" style="color:#d98a00"></i> The bot answers only from approved, non-confidential content and a stakeholder’s own records. It never exposes pricing, salaries or other customers’ data, and escalates to a human ticket when unsure.</div></div></div>';
  } else if(ti===1){ body=mTable(['Intent','Trigger','Flow','Status'],[['Payment status','"balance"','Lookup → reply','Live'],['Site visit','"visit"','Book slot','Live']]); }
  else if(ti===2){ body=mTable(['Broadcast','Audience','Sent','Read','Date'],[['New launch','All leads','1,900','1,368','24 Jun']]); }
  else if(ti===3){ body=mTable(['Contact','Tag','Last message','Status'],[['Suresh Agarwal','Customer','Payment query','Resolved']]); }
  else { body=mTable(['Metric','Value','Trend'],[['Messages (mo)','8.4k','+12%'],['Auto-resolve','94%','+3%']]); }
  v.innerHTML=mHead('fa-comment-dots','#16a34a','WhatsApp Bot')+mTabs('whatsapp',tabs,ti)+'<div style="margin-top:16px">'+body+'</div>';
};
VIEWS.mail=function(v,seg){
  setCrumb(['Stakeholder Portals',"Naren's Mail"]);
  const kpis=[['Unread','12',''],['Needs action','7','AI-flagged','#c83232'],['Awaiting approval','3',''],['Auto-summarised','100%','by AI','#16855a']];
  const folders=[['Needs action',3,true],['Awaiting approval',3],['Customers',2],['FYI / digest',2]];
  const fol='<div class="card card-pad" style="height:fit-content">'+folders.map(f=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 11px;border-radius:8px;margin-bottom:4px;font-size:13px;font-weight:500;'+(f[2]?'background:#0a2640;color:#fff':'color:var(--ink)')+'"><span>'+esc(f[0])+'</span><span style="opacity:.7">'+f[1]+'</span></div>').join('')+'</div>';
  const mail=(from,init,subj,prev,tag,tagc,time,btns)=>'<div style="padding:14px 0;border-bottom:1px solid var(--line-2)"><div style="display:flex;justify-content:space-between;gap:10px"><div style="display:flex;gap:11px"><span class="avatar-sm" style="background:#0a2640">'+init+'</span><div><div style="font-weight:700;font-size:13.5px">'+esc(from)+'</div><div style="font-size:13px;margin-top:2px">'+esc(subj)+'</div><div style="font-size:12px;color:var(--slate);margin-top:2px">'+esc(prev)+'</div></div></div><div style="text-align:right;white-space:nowrap"><span class="tag '+tagc+'">'+tag+'</span><div style="font-size:11px;color:#94a3b8;margin-top:4px">'+time+'</div></div></div><div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;margin-left:42px">'+btns.map(b=>'<button class="btn btn-sm'+(b[1]?' btn-primary':'')+'">'+b[0]+'</button>').join('')+'</div></div>';
  const list='<div class="card card-pad"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div class="sec-title" style="margin:0">Needs action</div><span class="tag t-gray">3 messages</span></div>'+
    mail('BuildWell Constr.','BW','RA bill RA-0312-05 submitted — please approve','Net payable enclosed for Tower C, Jun 16-30…','Approve','t-amber','2h',[['+ AI summary'],['↩ Reply'],['→ raise approval in Projects',true]])+
    mail('R. Agarwal','RA','Re: Registration date for DV-C-1204','Can we confirm the sub-registrar slot for next week?','Reply + task','t-blue','4h',[['+ AI summary'],['↩ Reply'],['+ task',true]])+'</div>';
  v.innerHTML=mHead('fa-envelope','#475569',"Naren's Mail")+
    '<div class="card card-pad" style="background:#eff4ff;border-color:#cfe0ef;margin-bottom:16px;font-size:13.5px"><i class="fa-solid fa-envelope"></i> Connected mailbox: <b>naren@thejaingroup.com</b> (demo). AI triage labels each mail and proposes the next action; converting a mail writes back into Accountability / CRM / Procurement via RPC.</div>'+
    mKpis(kpis)+'<div class="grid" style="grid-template-columns:210px 1fr;gap:16px;margin-top:16px">'+fol+list+'</div>';
};

/* ============================ TRANSCRIPTION ============================ */
/* Upload a recording -> stored in S3 (portal/transcription/) -> transcribed
   & analysed by Gladia (Hindi / English / Bengali, code-switching aware) via
   the `transcription-analyze` edge function. Results land in acc.transcriptions. */
const TR_LANG_NAMES={hi:'Hindi',en:'English',bn:'Bengali',ur:'Urdu',ta:'Tamil',te:'Telugu',mr:'Marathi',gu:'Gujarati',pa:'Punjabi'};
const TR_TIMERS={};
let TR_ROWS=null;
function trLangName(c){return TR_LANG_NAMES[c]||(c?String(c).toUpperCase():'—');}
function trLangTags(langs){if(!langs||!langs.length)return '<span style="color:var(--slate)">—</span>';return langs.map(function(c){return '<span class="tag t-blue" style="margin-right:4px">'+esc(trLangName(c))+'</span>';}).join('');}
function trFmtDur(s){s=Number(s||0);if(!s)return '—';const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=Math.floor(s%60);const p=function(n){return (n<10?'0':'')+n;};return (h?h+':':'')+p(m)+':'+p(ss);}
function trStatusTag(st){
  if(st==='done')return '<span class="tag t-green"><i class="fa-solid fa-circle-check"></i> Ready</span>';
  if(st==='error')return '<span class="tag t-red"><i class="fa-solid fa-circle-exclamation"></i> Failed</span>';
  return '<span class="tag t-amber"><i class="fa-solid fa-spinner fa-spin"></i> Processing</span>';
}
// Phone helpers (Indian mobile). Normalise to 10 digits, validate 6-9 start, pretty-print.
function trPhoneNorm(s){s=String(s||'').replace(/[^\d]/g,'');if(s.length===12&&s.slice(0,2)==='91')s=s.slice(2);if(s.length===11&&s.charAt(0)==='0')s=s.slice(1);return s;}
function trPhoneValid(s){return /^[6-9]\d{9}$/.test(trPhoneNorm(s));}
function trPhoneFmt(s){const d=trPhoneNorm(s);if(/^[6-9]\d{9}$/.test(d))return '+91 '+d.slice(0,5)+' '+d.slice(5);return s?esc(String(s)):'—';}
// Qualification / status badge shown in the list + detail.
function trQualTag(r){
  if(r.status==='processing')return '<span class="tag t-amber"><i class="fa-solid fa-spinner fa-spin"></i> Analysing</span>';
  if(r.status==='error')return '<span class="tag t-red"><i class="fa-solid fa-circle-exclamation"></i> Failed</span>';
  if(r.qualification==='Qualified')return '<span class="tag t-green"><i class="fa-solid fa-circle-check"></i> Qualified</span>';
  if(r.qualification==='Not Qualified')return '<span class="tag t-red"><i class="fa-solid fa-circle-xmark"></i> Not Qualified</span>';
  return '<span class="tag t-gray">—</span>';
}

async function trFetch(force){
  if(TR_ROWS&&!force)return TR_ROWS;
  try{const {data}=await sb.schema('acc').from('transcriptions').select('*').order('created_at',{ascending:false}).limit(200);TR_ROWS=data||[];}catch(e){TR_ROWS=[];}
  return TR_ROWS;
}

/* ==========================================================================================
   ORGANIC — Posts & Reels  (mirrors Business Suite > Content, for our own Pages + Instagram)
   ========================================================================================== */
let ORG_PERIOD='last_28d', ORG_SINCE='', ORG_UNTIL='', ORG_NET='all', ORG_KIND='all',
    ORG_PAGE='all', ORG_SORT='date', ORG_Q='', ORG_PG=0, ORG_ROWS=null, ORG_PAGES=null, ORG_OPEN=false;
const ORG_PER=25;
const ORG_PRESETS=[
  ['yesterday','Yesterday'],['last_7d','Last 7 days'],['last_28d','Last 28 days'],['last_90d','Last 90 days'],
  ['this_week','This week'],['this_month','This month'],['this_year','This year'],
  ['last_week','Last week'],['last_month','Last month'],['lifetime','Lifetime'],['custom','Custom']
];
function orgDay(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function orgAdd(d,n){const x=new Date(d.getTime());x.setDate(x.getDate()+n);return x;}
// Monday-start weeks, to match how Business Suite reports.
function orgMonday(d){const x=new Date(d.getTime());const off=(x.getDay()+6)%7;x.setDate(x.getDate()-off);return x;}
function orgRange(){
  const today=new Date(); today.setHours(12,0,0,0);
  const P=ORG_PERIOD;
  if(P==='lifetime')   return {since:'',until:''};
  if(P==='custom')     return {since:ORG_SINCE,until:ORG_UNTIL};
  if(P==='yesterday'){ const d=orgAdd(today,-1); return {since:orgDay(d),until:orgDay(d)}; }
  if(P==='last_7d')    return {since:orgDay(orgAdd(today,-7)),  until:orgDay(orgAdd(today,-1))};
  if(P==='last_28d')   return {since:orgDay(orgAdd(today,-28)), until:orgDay(orgAdd(today,-1))};
  if(P==='last_90d')   return {since:orgDay(orgAdd(today,-90)), until:orgDay(orgAdd(today,-1))};
  if(P==='this_week')  return {since:orgDay(orgMonday(today)), until:orgDay(today)};
  if(P==='this_month') return {since:orgDay(new Date(today.getFullYear(),today.getMonth(),1)), until:orgDay(today)};
  if(P==='this_year')  return {since:orgDay(new Date(today.getFullYear(),0,1)), until:orgDay(today)};
  if(P==='last_week'){ const m=orgMonday(today); return {since:orgDay(orgAdd(m,-7)), until:orgDay(orgAdd(m,-1))}; }
  if(P==='last_month'){ const f=new Date(today.getFullYear(),today.getMonth()-1,1), l=new Date(today.getFullYear(),today.getMonth(),0);
                        return {since:orgDay(f),until:orgDay(l)}; }
  return {since:'',until:''};
}
function orgRangeLabel(){
  if(ORG_PERIOD==='lifetime') return 'All time';
  const r=orgRange(); if(!r.since||!r.until) return 'Pick two dates';
  const f=function(s){const d=new Date(s+'T00:00:00');return d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});};
  return r.since===r.until ? f(r.since) : (f(r.since)+' – '+f(r.until));
}
function orgPresetLabel(){ return ((ORG_PRESETS.find(function(p){return p[0]===ORG_PERIOD;})||[])[1])||'Custom'; }

const ORG_CSS='<style id="orgCss">'
+'.org-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}'
+'.org-dp{position:relative}'
+'.org-dp-btn{display:flex;align-items:center;gap:10px;height:42px;padding:0 14px;border:1px solid var(--line);border-radius:10px;background:var(--bg-card);cursor:pointer;transition:.15s;min-width:0}'
+'.org-dp-btn:hover{border-color:var(--brand)}'
+'.org-dp.open .org-dp-btn{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10,#eef2ff)}'
+'.org-dp-btn i.cal{color:var(--brand);font-size:14px}'
+'.org-dp-lab{display:flex;flex-direction:column;align-items:flex-start;line-height:1.25;min-width:0}'
+'.org-dp-lab b{font-size:13px;font-weight:700;color:var(--ink);white-space:nowrap}'
+'.org-dp-lab span{font-size:11px;color:var(--slate);white-space:nowrap}'
+'.org-dp-btn i.cv{margin-left:6px;color:var(--slate);font-size:11px;transition:transform .15s}'
+'.org-dp.open .org-dp-btn i.cv{transform:rotate(180deg)}'
+'.org-dp-pan{position:absolute;top:calc(100% + 6px);left:0;z-index:80;background:var(--bg-card);border:1px solid var(--line);border-radius:12px;box-shadow:0 14px 38px rgba(15,23,42,.18);padding:9px;display:none;width:352px;max-width:92vw;box-sizing:border-box}'
+'.org-dp.open .org-dp-pan{display:block}'
+'.org-dp-list{display:grid;grid-template-columns:1fr 1fr;gap:3px}'
+'.org-dp-opt{padding:8px 11px;border-radius:8px;font-size:12.5px;font-weight:600;color:var(--ink);cursor:pointer;white-space:nowrap;border:1px solid transparent}'
+'.org-dp-opt:hover{background:var(--bg,#f8fafc)}'
+'.org-dp-opt.on{background:var(--brand-a10,#eef2ff);color:var(--brand);border-color:var(--brand)}'
+'.org-dp-cus{border-top:1px solid var(--line);margin-top:8px;padding-top:10px;display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap}'
+'.org-dp-cus label{display:flex;flex-direction:column;gap:4px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--slate);flex:1 1 130px;min-width:0}'
+'.org-dp-cus input{height:36px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font-size:13px;font-family:inherit;color:var(--ink);background:var(--bg-card);width:100%;box-sizing:border-box}'
+'.org-dp-cus button{height:36px;padding:0 16px;border-radius:8px;border:0;background:var(--brand);color:#fff;font-size:13px;font-weight:700;cursor:pointer}'
+'.org-fbar{display:flex;gap:6px;flex-wrap:wrap;align-items:center}'
+'.org-fbtn{height:34px;padding:0 13px;border:1px solid var(--line);border-radius:20px;background:var(--bg-card);font-size:12.5px;font-weight:600;color:var(--slate);cursor:pointer;transition:.14s;display:inline-flex;align-items:center;gap:6px}'
+'.org-fbtn:hover{border-color:var(--brand);color:var(--brand)}'
+'.org-fbtn.on{background:var(--brand);border-color:var(--brand);color:#fff}'
+'.org-fbtn .n{font-size:11px;opacity:.75;font-weight:700}'
+'.org-search{height:38px;border:1px solid var(--line);border-radius:9px;padding:0 12px;font-size:13px;font-family:inherit;min-width:190px;flex:1 1 190px;max-width:300px;background:var(--bg-card);color:var(--ink);box-sizing:border-box}'
+'.org-sel{height:38px;border:1px solid var(--line);border-radius:9px;padding:0 30px 0 11px;font-size:13px;font-family:inherit;background:var(--bg-card);color:var(--ink);cursor:pointer;appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 12 8\'%3E%3Cpath d=\'M1 1l5 5 5-5\' stroke=\'%2364748b\' stroke-width=\'1.8\' fill=\'none\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;background-size:11px 8px}'
+'.org-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px}'
+'.org-kpi{background:var(--bg-card);border:1px solid var(--line);border-radius:12px;padding:13px 15px}'
+'.org-kpi .k{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--slate);display:flex;align-items:center;gap:6px}'
+'.org-kpi .v{font-size:22px;font-weight:800;color:var(--ink);margin-top:5px;letter-spacing:-.02em}'
+'.org-kpi .s{font-size:11.5px;color:var(--slate);margin-top:2px}'
+'.org-tblwrap{border:1px solid var(--line);border-radius:12px;overflow-x:auto;background:var(--bg-card)}'
+'.org-tbl{width:100%;border-collapse:collapse;font-size:13px;min-width:900px}'
+'.org-tbl th{text-align:left;padding:11px 13px;background:var(--bg,#f8fafc);color:var(--slate);font-weight:700;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap;border-bottom:1px solid var(--line);position:sticky;top:0}'
+'.org-tbl th.n,.org-tbl td.n{text-align:right}'
+'.org-tbl td{padding:11px 13px;border-bottom:1px solid var(--line);color:var(--ink);vertical-align:middle}'
+'.org-tbl tbody tr{cursor:pointer;transition:background .12s}'
+'.org-tbl tbody tr:hover{background:var(--bg,#f8fafc)}'
+'.org-tbl tbody tr:last-child td{border-bottom:0}'
+'.org-post{display:flex;align-items:center;gap:11px;min-width:0;max-width:390px}'
+'.org-thumb{width:44px;height:44px;border-radius:8px;object-fit:cover;flex:none;background:var(--bg,#f1f5f9);border:1px solid var(--line)}'
+'.org-thumb-ph{width:44px;height:44px;border-radius:8px;flex:none;background:var(--bg,#f1f5f9);border:1px solid var(--line);display:grid;place-items:center;color:#cbd5e1;font-size:15px}'
+'.org-ptxt{min-width:0}'
+'.org-ptxt b{display:block;font-size:13px;font-weight:600;color:var(--ink);line-height:1.35;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}'
+'.org-ptxt span{font-size:11.5px;color:var(--slate)}'
+'.org-tag{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:20px;text-transform:capitalize;white-space:nowrap}'
+'.org-tag.reel{background:#fae8ff;color:#a21caf}.org-tag.video{background:#e0e7ff;color:#3730a3}.org-tag.photo{background:#dcfce7;color:#166534}'
+'.org-tag.carousel{background:#fef3c7;color:#92400e}.org-tag.link{background:#e0f2fe;color:#075985}.org-tag.post,.org-tag.status{background:#f1f5f9;color:#475569}'
+'.org-net{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--slate);white-space:nowrap}'
+'.org-net i.fa-facebook{color:#1877f2}.org-net i.fa-instagram{color:#e1306c}'
+'.org-er{font-weight:700}'
+'.org-na{color:#cbd5e1;cursor:help}'
+'.org-zero{color:#94a3b8}'
+'.org-date{white-space:nowrap;font-size:12.5px;color:var(--slate)}'
+'.org-netic{margin-left:auto;flex:none;font-size:13px;opacity:.55}'
+'.org-netic.fa-facebook{color:#1877f2}.org-netic.fa-instagram{color:#e1306c}'
+'.org-pager{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;flex-wrap:wrap}'
+'.org-pager .info{font-size:12.5px;color:var(--slate)}'
+'.org-pager button{height:34px;padding:0 14px;border:1px solid var(--line);border-radius:8px;background:var(--bg-card);font-size:13px;font-weight:600;color:var(--ink);cursor:pointer}'
+'.org-pager button:disabled{opacity:.45;cursor:not-allowed}'
+'.org-note{display:flex;align-items:flex-start;gap:9px;background:var(--bg,#f8fafc);border:1px solid var(--line);border-radius:10px;padding:10px 13px;font-size:12px;color:var(--slate);line-height:1.55;margin:-6px 0 16px}'
+'.org-note i{color:#94a3b8;margin-top:2px;flex:none}'
+'.org-empty{border:1px dashed var(--line);border-radius:12px;padding:34px 20px;text-align:center;color:var(--slate);font-size:13.5px;line-height:1.6}'
+'.org-empty i{font-size:26px;color:#cbd5e1;display:block;margin-bottom:10px}'
+'.org-dtl-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 20px;margin-top:4px}'
+'.org-dtl-f{min-width:0}'
+'.org-dtl-f .k{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--slate)}'
+'.org-dtl-f .v{font-size:14px;font-weight:700;color:var(--ink);margin-top:2px;overflow-wrap:anywhere}'
/* the whole picture, letterboxed - never cropped, never wider than the dialog */
+'.org-dtl-img{width:100%;max-width:100%;background:var(--bg,#f1f5f9);border:1px solid var(--line);border-radius:10px;margin-bottom:12px;overflow:hidden;display:flex;align-items:center;justify-content:center}'
+'.org-dtl-img img{max-width:100%;max-height:340px;width:auto;height:auto;object-fit:contain;display:block}'
+'.org-dtl-img .org-thumb-ph{width:100%;height:150px}'
+'.org-dtl-msg{font-size:13.5px;line-height:1.6;color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;max-height:170px;overflow-y:auto;overflow-x:hidden}'
+'.org-dtl *{max-width:100%;box-sizing:border-box}'
+'.org-fresh{font-size:11.5px;color:var(--slate);margin-left:auto;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}'
+'@media(max-width:1100px){.org-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}'
+'@media(max-width:760px){.org-dp-list{grid-template-columns:1fr}.org-kpi .v{font-size:19px}.org-post{max-width:220px}.org-fresh{margin-left:0}}'
+'@media(max-width:480px){.org-kpis{grid-template-columns:1fr}}'
+'</style>';

function orgN(v){const n=Number(v)||0; if(n>=1e7)return (n/1e7).toFixed(2).replace(/\.00$/,'')+' Cr'; if(n>=1e5)return (n/1e5).toFixed(2).replace(/\.00$/,'')+' L'; if(n>=1000)return (n/1000).toFixed(1).replace(/\.0$/,'')+'k'; return String(n);}
function orgDT(s){ if(!s)return '—'; try{return new Date(s).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});}catch(e){return String(s);} }
function orgEng(r){ return (Number(r.likes)||0)+(Number(r.comments)||0)+(Number(r.shares)||0)+(Number(r.saves)||0); }
// Meta retired per-post reach on the API, so an engagement RATE is only meaningful where a
// reach/impression figure actually came back (reels, Instagram). Elsewhere we show '—'.
function orgHasReach(r){ return (Number(r.reach)||0)>0; }
function orgER(r){ const reach=Number(r.reach)||0; return reach? (orgEng(r)/reach*100) : null; }
function orgKindLabel(k){ return k==='reel'?'Reel':(k==='carousel'?'Carousel':'Post'); }
// Meta reports watch time in milliseconds.
function orgSecs(ms){ const s=(Number(ms)||0)/1000; return s>=60?(Math.floor(s/60)+'m '+Math.round(s%60)+'s'):(s<10?s.toFixed(1)+'s':Math.round(s)+'s'); }
function orgWatch(ms){ const s=(Number(ms)||0)/1000;
  if(s>=3600){ const h=Math.floor(s/3600); return h+'h '+Math.round((s%3600)/60)+'m'; }
  if(s>=60) return Math.floor(s/60)+'m '+Math.round(s%60)+'s';
  return Math.round(s)+'s'; }
// Some thumbnails 404 or are blocked; swap in a placeholder rather than a broken image.
window.orgThumbFail=function(img){
  const ph=document.createElement('div'); ph.className=img.className.replace('org-thumb','org-thumb-ph');
  ph.innerHTML='<i class="fa-regular fa-image"></i>';
  if(img.parentNode) img.parentNode.replaceChild(ph,img);
};

window.orgToggleDp=function(e){ if(e)e.stopPropagation(); ORG_OPEN=!ORG_OPEN; renderPage(); };
window.orgSetPeriod=function(p){
  ORG_PERIOD=p; ORG_PG=0;
  if(p==='custom'){ if(!ORG_SINCE||!ORG_UNTIL){ const r=orgRange(); const t=new Date(); ORG_UNTIL=orgDay(t); ORG_SINCE=orgDay(orgAdd(t,-27)); } renderPage(); return; }
  ORG_OPEN=false; renderPage();
};
window.orgApplyCustom=function(){
  const a=document.getElementById('orgFrom'), b=document.getElementById('orgTo');
  if(!a||!b||!a.value||!b.value){ toast('Pick both dates','warn'); return; }
  if(a.value>b.value){ toast('The From date must come before the To date','warn'); return; }
  ORG_SINCE=a.value; ORG_UNTIL=b.value; ORG_PERIOD='custom'; ORG_OPEN=false; ORG_PG=0; renderPage();
};
window.orgSetNet=function(n){ORG_NET=n;ORG_PG=0;renderPage();};
window.orgSetKind=function(k){ORG_KIND=k;ORG_PG=0;renderPage();};
window.orgSetPageId=function(v){ORG_PAGE=v;ORG_PG=0;renderPage();};
window.orgSetSort=function(v){ORG_SORT=v;ORG_PG=0;renderPage();};
window.orgSearch=function(v){ORG_Q=v;ORG_PG=0;
  clearTimeout(window._orgQT); window._orgQT=setTimeout(function(){renderPage(); const el=document.getElementById('orgQ'); if(el){el.focus(); el.setSelectionRange(el.value.length,el.value.length);} },320);
};
window.orgGo=function(d){ORG_PG=Math.max(0,ORG_PG+d);renderPage();};

// Refresh in the background whenever the page is opened, so there is no button to press.
// Rows already on screen stay visible while it runs; the table re-renders when it lands.
window.orgAutoSync=async function(){
  if(window._orgSyncing) return;
  window._orgSyncing=true;
  const tag=document.getElementById('orgFresh');
  if(tag) tag.innerHTML='<i class="fa-solid fa-rotate fa-spin"></i> Updating…';
  try{
    const {data:{session}}=await sb.auth.getSession();
    const token=session&&session.access_token;
    // Deliberately NOT bounded by the displayed date range. Preset ranges like "Last 28 days"
    // end yesterday, so passing them as the sync window skipped anything posted today and left
    // fresh content showing stale view counts. Facebook returns newest-first, so paging from the
    // top always refreshes the most recent content; the range still filters what's displayed.
    const res=await fetch(SUPABASE_URL+'/functions/v1/social-organic-live',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},
      body:JSON.stringify(ORG_PERIOD==='lifetime'?{max_pages:8,reel_pages:4}:{max_pages:2,reel_pages:1})});
    const jr=await res.json().catch(function(){return {};});
    if(jr.error){ if(tag) tag.innerHTML='<i class="fa-solid fa-triangle-exclamation" style="color:#d97706"></i> '+esc(String(jr.error).slice(0,90)); window._orgSyncing=false; return; }
    ORG_ROWS=null; ORG_PAGES=null;
    window._orgSyncing=false; window._orgSyncedAt=Date.now();
    if(ROUTE_PAGE()==='organic') renderPage();
    return;
  }catch(e){ if(tag) tag.innerHTML='<i class="fa-solid fa-triangle-exclamation" style="color:#d97706"></i> Could not refresh'; }
  window._orgSyncing=false;
};
function ROUTE_PAGE(){ return PAGE; }

window.orgSync=async function(){
  const btn=document.getElementById('orgSyncBtn');
  if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-rotate fa-spin"></i> Syncing…';}
  try{
    const {data:{session}}=await sb.auth.getSession();
    const token=session&&session.access_token;
    const r=orgRange();
    const res=await fetch(SUPABASE_URL+'/functions/v1/social-organic-live',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},
      body:JSON.stringify(ORG_PERIOD==='lifetime'?{full:true}:{since:r.since,until:r.until})});
    const jr=await res.json().catch(function(){return{};});
    if(jr.error){ toast(jr.error,'err'); }
    else { toast('Synced '+(jr.posts||0)+' posts, '+(jr.reels||0)+' reels'+(jr.ig?', '+jr.ig+' Instagram':''),'ok');
           if((jr.errors||[]).length) console.warn('organic sync notes:',jr.errors); }
  }catch(e){ toast('Sync failed: '+((e&&e.message)||e),'err'); }
  ORG_ROWS=null; renderPage();
};

window.orgOpen=function(id){
  const r=(ORG_ROWS||[]).find(function(x){return String(x.id)===String(id);}); if(!r)return;
  const rx=r.reactions||{};
  const f=function(k,v){return '<div class="org-dtl-f"><div class="k">'+k+'</div><div class="v">'+v+'</div></div>';};
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-photo-film"></i> '+esc(orgKindLabel(r.kind))+' details</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    // width is capped and everything inside is box-sized, so the body never scrolls sideways;
    // the image is CONTAINed rather than cropped, so the whole picture is visible
    +'<div class="modal-body org-dtl" style="width:min(94vw,640px);max-width:100%;box-sizing:border-box;overflow-x:hidden">'
      +(r.thumbnail?'<div class="org-dtl-img"><img src="'+esc(r.thumbnail)+'" referrerpolicy="no-referrer" onerror="orgThumbFail(this)"></div>':'')
      +'<div class="org-dtl-msg">'+esc(r.message||'(no caption)')+'</div>'
      +'<div style="font-size:12px;color:var(--slate);margin:10px 0 4px">'+esc(r.page_name||'')+' · '+orgDT(r.created_time)+'</div>'
      +'<div class="org-dtl-grid">'
        +f('Interactions',orgN(orgEng(r)))
        +f('Likes',orgN(r.likes))+f('Comments',orgN(r.comments))+f('Shares',orgN(r.shares))
        +(Number(r.reach)?f('Reach',orgN(r.reach)):'')
        +(Number(r.video_views)?f('Views',orgN(r.video_views)):'')
        +(Number(r.viewers)?f('Viewers',orgN(r.viewers)):'')
        +(Number(r.follows)?f('Follows',orgN(r.follows)):'')
        +(Number(r.clicks)?f('Clicks on post',orgN(r.clicks)):'')
        +(Number(r.saves)?f('Saves',orgN(r.saves)):'')
        +(Number(r.video_total_time_ms)?f('Watch time',orgWatch(r.video_total_time_ms)):'')
        +(Number(r.video_avg_watch_ms)?f('Avg play time',orgSecs(r.video_avg_watch_ms)):'')
        +(Number(r.video_length_s)?f('Duration',orgSecs(Number(r.video_length_s)*1000)):'')
        +(orgHasReach(r)?f('Engagement rate',(orgER(r)||0).toFixed(2)+'%'):'')
        +((rx.like||rx.love||rx.wow||rx.haha||rx.sad||rx.angry||rx.care)
           ?f('Reactions','👍 '+orgN(rx.like)+'  ❤️ '+orgN(rx.love)+'  😮 '+orgN(rx.wow)+'  😂 '+orgN(rx.haha)+'  😢 '+orgN(rx.sad)+'  😠 '+orgN(rx.angry)+'  🤗 '+orgN(rx.care)):'')
      +'</div>'
    +'</div>'
    +'<div class="modal-foot">'+(r.permalink?'<a class="btn" target="_blank" rel="noopener" href="'+esc(r.permalink)+'"><i class="fa-solid fa-arrow-up-right-from-square"></i> View on '+(r.network==='instagram'?'Instagram':'Facebook')+'</a>':'')
      +'<button class="btn primary" onclick="closeModal()">Close</button></div>','md');
};

function orgDatePicker(){
  const opts=ORG_PRESETS.map(function(p){
    return '<div class="org-dp-opt'+(ORG_PERIOD===p[0]?' on':'')+'" onclick="event.stopPropagation();orgSetPeriod(\''+p[0]+'\')">'+esc(p[1])+'</div>';
  }).join('');
  const cus=ORG_PERIOD==='custom'
    ? '<div class="org-dp-cus" onclick="event.stopPropagation()">'
      +'<label>From<input type="date" id="orgFrom" value="'+esc(ORG_SINCE||'')+'"></label>'
      +'<label>To<input type="date" id="orgTo" value="'+esc(ORG_UNTIL||'')+'"></label>'
      +'<button onclick="orgApplyCustom()">Apply</button></div>'
    : '';
  return '<div class="org-dp'+(ORG_OPEN?' open':'')+'" id="orgDp">'
    +'<div class="org-dp-btn" onclick="orgToggleDp(event)">'
      +'<i class="fa-regular fa-calendar cal"></i>'
      +'<span class="org-dp-lab"><b>'+esc(orgPresetLabel())+'</b><span>'+esc(orgRangeLabel())+'</span></span>'
      +'<i class="fa-solid fa-chevron-down cv"></i></div>'
    +'<div class="org-dp-pan"><div class="org-dp-list">'+opts+'</div>'+cus+'</div></div>';
}

VIEWS.organic=async function(v,seg){
  setCrumb(['Growth & Strategy','Posts & Reels']);
  const tabs=['Overview','All content','Top performers'];
  const ti=mTab(seg,tabs.length);
  if(!window._orgDocWired){ window._orgDocWired=true;
    document.addEventListener('click',function(e){ if(ORG_OPEN && !(e.target&&e.target.closest&&e.target.closest('.org-dp'))){ ORG_OPEN=false; renderPage(); } });
  }
  v.innerHTML=ORG_CSS+mHead('fa-photo-film','#7c3aed','Posts & Reels')+'<div class="loader"><div class="spin"></div></div>';

  if(!ORG_PAGES){ try{ const {data}=await sb.schema('camp').from('social_pages').select('*').order('name'); ORG_PAGES=data||[]; }catch(e){ ORG_PAGES=[]; } }
  if(!ORG_ROWS){ try{ const {data}=await sb.schema('camp').from('social_posts').select('*').order('created_time',{ascending:false}).limit(3000); ORG_ROWS=data||[]; }catch(e){ ORG_ROWS=[]; } }

  const R=orgRange();
  let rows=(ORG_ROWS||[]).filter(function(r){
    if(R.since && r.created_time && String(r.created_time).slice(0,10) < R.since) return false;
    if(R.until && r.created_time && String(r.created_time).slice(0,10) > R.until) return false;
    if(ORG_NET!=='all'  && r.network!==ORG_NET) return false;
    if(ORG_KIND!=='all' && r.kind!==ORG_KIND) return false;
    if(ORG_PAGE!=='all' && String(r.page_id)!==String(ORG_PAGE)) return false;
    if(ORG_Q){ const q=ORG_Q.toLowerCase(); if(!String(r.message||'').toLowerCase().includes(q) && !String(r.page_name||'').toLowerCase().includes(q)) return false; }
    return true;
  });
  const S=ORG_SORT;
  const nOf=function(r,k){return Number(r[k])||0;};
  rows.sort(function(a,b){
    const vw=function(r){return nOf(r,'video_views')||nOf(r,'impressions');};
    if(S==='views')        return vw(b)-vw(a);
    if(S==='interactions') return orgEng(b)-orgEng(a);
    if(S==='follows')      return nOf(b,'follows')-nOf(a,'follows');
    if(S==='watch')        return nOf(b,'video_total_time_ms')-nOf(a,'video_total_time_ms');
    if(S==='avgwatch')     return nOf(b,'video_avg_watch_ms')-nOf(a,'video_avg_watch_ms');
    return String(b.created_time||'').localeCompare(String(a.created_time||''));
  });

  const tot=rows.reduce(function(a,r){
    a.reach+=Number(r.reach)||0; a.eng+=orgEng(r);
    a.likes+=Number(r.likes)||0; a.comments+=Number(r.comments)||0; a.shares+=Number(r.shares)||0;
    a.clicks+=Number(r.clicks)||0; a.vv+=(Number(r.video_views)||Number(r.impressions)||0);
    a.viewers+=Number(r.viewers)||0; a.follows+=Number(r.follows)||0;
    a.watch+=Number(r.video_total_time_ms)||0;
    return a;
  },{reach:0,eng:0,likes:0,comments:0,shares:0,clicks:0,vv:0,viewers:0,follows:0,watch:0});

  const kpi=function(icon,k,val,sub){return '<div class="org-kpi"><div class="k"><i class="fa-solid '+icon+'"></i> '+k+'</div><div class="v">'+val+'</div>'+(sub?'<div class="s">'+sub+'</div>':'')+'</div>';};
  // Exactly eight cards, four to a row. Reach and Viewers are deliberately absent: Facebook
  // rejects every per-post impression metric on every API version from v18 to v25, so a card for
  // them could only ever read zero.
  const nReels=rows.filter(function(r){return r.kind==='reel';}).length;
  const avgEng=rows.length?Math.round(tot.eng/rows.length):0;
  const kpis='<div class="org-kpis">'
    +kpi('fa-layer-group','Posts',String(rows.length),rows.length?(nReels+' reels · '+(rows.length-nReels)+' posts'):'')
    +kpi('fa-users','Reach',tot.reach?orgN(tot.reach):'—','Instagram only')
    +kpi('fa-play','Views',tot.vv?orgN(tot.vv):'—','plays & post views')
    +kpi('fa-hand-pointer','Interactions',orgN(tot.eng),'')
    +kpi('fa-user-plus','Follows',tot.follows?orgN(tot.follows):'—','from video')
    +kpi('fa-clock','Total Watch Time',tot.watch?orgWatch(tot.watch):'—','')
    +kpi('fa-stopwatch','Avg Watch Time',tot.watch&&nReels?orgSecs(tot.watch/Math.max(1,nReels)):'—','per reel')
    +kpi('fa-chart-simple','Avg per post',orgN(avgEng),'interactions')
    +'</div>'
    +'<div class="org-note"><i class="fa-solid fa-circle-info"></i> Columns adapt to what Facebook reports for the content on screen — reels carry watch time and duration; photo posts carry shares and clicks. <b>Views</b> is Meta\'s current measure (it replaced Impressions in Nov 2025) and now fills for every content type.</div>';

  // filter bar
  const kinds=['all','post','reel','carousel'];
  const kc={}; rows.forEach(function(r){kc[r.kind]=(kc[r.kind]||0)+1;});
  const kbtns=kinds.map(function(k){
    const n=k==='all'?rows.length:(kc[k]||0);
    if(k!=='all'&&!n&&ORG_KIND!==k) return '';
    const lbl=k==='all'?'All types':(k==='post'?'Posts':(k==='reel'?'Reels':'Carousel'));
    return '<button class="org-fbtn'+(ORG_KIND===k?' on':'')+'" onclick="orgSetKind(\''+k+'\')">'+esc(lbl)+'<span class="n">'+n+'</span></button>';
  }).join('');
  const nbtns=[['all','All'],['facebook','Facebook'],['instagram','Instagram']].map(function(n){
    return '<button class="org-fbtn'+(ORG_NET===n[0]?' on':'')+'" onclick="orgSetNet(\''+n[0]+'\')">'+esc(n[1])+'</button>';
  }).join('');
  const pageSel='<select class="org-sel" onchange="orgSetPageId(this.value)"><option value="all"'+(ORG_PAGE==='all'?' selected':'')+'>All pages</option>'
    +(ORG_PAGES||[]).map(function(p){return '<option value="'+esc(p.id)+'"'+(String(ORG_PAGE)===String(p.id)?' selected':'')+'>'+esc(p.name||p.id)+'</option>';}).join('')+'</select>';
  const sortSel='<select class="org-sel" onchange="orgSetSort(this.value)">'
    +[['date','Newest first'],['views','Most views'],['interactions','Most interactions'],['follows','Most follows'],['watch','Most watch time'],['avgwatch','Longest avg watch']]
      .map(function(o){return '<option value="'+o[0]+'"'+(ORG_SORT===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select>';

  const bar='<div class="org-bar">'+orgDatePicker()
    +'<input class="org-search" id="orgQ" placeholder="Search caption or page…" value="'+esc(ORG_Q)+'" oninput="orgSearch(this.value)">'
    +pageSel+sortSel
    +'<span class="org-fresh" id="orgFresh"></span></div>'
    +'<div class="org-bar">'+nbtns+'<span style="width:8px"></span>'+kbtns+'</div>';

  // ---- body ----
  let body='';
  if(!rows.length){
    const anyData=(ORG_ROWS||[]).length>0;
    body='<div class="org-empty"><i class="fa-regular fa-folder-open"></i>'
      +(anyData?'No content in this date range or filter.<br>Try widening the dates, or choose <b>Lifetime</b>.'
               :'Fetching your content from Meta…<br>If nothing appears, the system user needs the Pages assigned with the <b>Insights</b> task.')
      +'</div>';
  } else if(ti===0){
    // Overview: breakdown by type and by page
    const agg=function(keyFn){
      const o={}; rows.forEach(function(r){ const k=keyFn(r)||'—';
        (o[k]=o[k]||{n:0,views:0,eng:0,likes:0,comments:0});
        o[k].n++; o[k].views+=Number(r.video_views)||0; o[k].eng+=orgEng(r);
        o[k].likes+=Number(r.likes)||0; o[k].comments+=Number(r.comments)||0; });
      return o;
    };
    const byKind=agg(function(r){return r.kind||'post';});
    const byPage=agg(function(r){return r.page_name;});
    const tbl=function(obj,lbl){
      const keys=Object.keys(obj).sort(function(a,b){return obj[b].eng-obj[a].eng;});
      return '<div class="org-tblwrap" style="margin-bottom:14px"><table class="org-tbl" style="min-width:560px"><thead><tr><th>'+lbl+'</th><th class="n">Posts</th><th class="n">Views</th><th class="n">Likes</th><th class="n">Comments</th><th class="n">Engagement</th><th class="n">Avg / post</th></tr></thead><tbody>'
        +keys.map(function(k){const o=obj[k];return '<tr style="cursor:default"><td><b>'+esc(k)+'</b></td><td class="n">'+o.n+'</td>'
          +'<td class="n">'+(o.views?orgN(o.views):'—')+'</td><td class="n">'+orgN(o.likes)+'</td><td class="n">'+orgN(o.comments)+'</td>'
          +'<td class="n">'+orgN(o.eng)+'</td><td class="n org-er">'+orgN(Math.round(o.eng/o.n))+'</td></tr>';}).join('')
        +'</tbody></table></div>';
    };
    body=tbl(byKind,'Content type')+tbl(byPage,'Page');
  } else {
    const list=(ti===2)?rows.slice().sort(function(a,b){return orgEng(b)-orgEng(a);}).slice(0,20):rows;
    const pages=Math.max(1,Math.ceil(list.length/ORG_PER));
    if(ORG_PG>=pages)ORG_PG=pages-1;
    const slice=(ti===2)?list:list.slice(ORG_PG*ORG_PER,(ORG_PG+1)*ORG_PER);
    // Only show a metric column if something on screen actually has that metric. Facebook gives
    // completely different fields per content type — reels have views/watch/duration but never
    // shares or clicks; photo posts have shares and clicks but no video data at all — so a fixed
    // column set leaves most cells blank. Filtering to Reels or Posts narrows the table to just
    // the numbers that type reports.
    // The requested column set. `has` says whether Facebook reports the metric for that content
    // type, so a genuine 0 is distinguishable from "not applicable" (which shows a dot + tooltip).
    // These columns are ALWAYS shown even when empty — they were asked for explicitly — except
    // the video-only ones, which appear when there is video on screen.
    const isReel=function(r){return r.kind==='reel';};
    const hasVideo=function(r){return isReel(r)||Number(r.video_views)>0||Number(r.video_length_s)>0;};
    const COLS=[
      // Reach: no per-post reach metric exists on Facebook — 30 names and 42 permutations probed
      // across v18-v25. Business Suite shows it because Meta computes it internally without
      // exposing it. Instagram does report true unique reach, so this fills for IG content.
      {k:'Reach',            get:function(r){return Number(r.reach)||0;},               fmt:orgN,
       has:function(r){return r.network==='instagram';},
       why:'Facebook does not expose per-post Reach through its API — Instagram does'},
      {k:'Views',            get:function(r){return Number(r.video_views)||Number(r.impressions)||0;}, fmt:orgN,
       has:function(){return true;}},
      {k:'Interactions',     get:function(r){return orgEng(r);},                        fmt:orgN, strong:true,
       has:function(){return true;}},
      {k:'Follows',          get:function(r){return Number(r.follows)||0;},             fmt:orgN, has:hasVideo,
       why:'follows gained are only reported for video'},
      {k:'Duration',         get:function(r){return (Number(r.video_length_s)||0)*1000;},fmt:orgSecs, has:hasVideo,
       why:'video only'},
      {k:'Avg Watch Time',   get:function(r){return Number(r.video_avg_watch_ms)||0;},  fmt:orgSecs,  has:hasVideo,
       why:'video only'},
      {k:'Total Watch Time', get:function(r){return Number(r.video_total_time_ms)||0;}, fmt:orgWatch, has:hasVideo,
       why:'video only'}
    ];

    body='<div class="org-tblwrap"><table class="org-tbl"><thead><tr>'
      +'<th>Post Date</th><th>Post</th><th>Format</th>'
      +COLS.map(function(c){return '<th class="n">'+esc(c.k)+'</th>';}).join('')
      +'</tr></thead><tbody>'
      +slice.map(function(r){
        const thumb=r.thumbnail?'<img class="org-thumb" src="'+esc(r.thumbnail)+'" loading="lazy" referrerpolicy="no-referrer" onerror="orgThumbFail(this)">'
                               :'<div class="org-thumb-ph"><i class="fa-regular fa-image"></i></div>';
        const txt=String(r.message||'').replace(/\s+/g,' ').trim()||'(no caption)';
        return '<tr onclick="orgOpen(\''+esc(String(r.id))+'\')">'
          +'<td class="org-date">'+orgDT(r.created_time)+'</td>'
          +'<td><div class="org-post">'+thumb+'<div class="org-ptxt"><b>'+esc(txt.slice(0,120))+'</b></div>'
            +'<i class="fa-brands '+(r.network==='instagram'?'fa-instagram':'fa-facebook')+' org-netic" title="'+esc(r.page_name||'')+'"></i></div></td>'
          +'<td><span class="org-tag '+esc(r.kind||'post')+'">'+esc(orgKindLabel(r.kind))+'</span></td>'
          // A genuine zero is data — a post published an hour ago really does have 0 likes.
          // Show it as 0 (muted) rather than a dot, which read as "missing" and made the table
          // look half-broken. The dot is reserved for a metric this content type cannot report.
          +COLS.map(function(c){ const v=c.get(r), na=!c.has(r);
            const tip=c.why||('Facebook does not report this for a '+orgKindLabel(r.kind));
            return '<td class="n'+(c.strong?' org-er':'')+'">'
              +(na?'<span class="org-na" title="'+esc(tip)+'">·</span>'
                  :(v?c.fmt(v):'<span class="org-zero">0</span>'))+'</td>'; }).join('')
        +'</tr>';
      }).join('')+'</tbody></table></div>'
      +(ti===2?'':'<div class="org-pager"><span class="info">Showing '+(ORG_PG*ORG_PER+1)+'–'+Math.min((ORG_PG+1)*ORG_PER,list.length)+' of '+list.length+'</span>'
        +'<span><button onclick="orgGo(-1)"'+(ORG_PG<=0?' disabled':'')+'><i class="fa-solid fa-chevron-left"></i> Previous</button> '
        +'<button onclick="orgGo(1)"'+(ORG_PG>=pages-1?' disabled':'')+'>Next <i class="fa-solid fa-chevron-right"></i></button></span></div>');
  }

  v.innerHTML=ORG_CSS+mHead('fa-photo-film','#7c3aed','Posts & Reels')+bar+mTabs('organic',tabs,ti)
    +'<div style="margin-top:14px">'+(rows.length?kpis:'')+body+'</div>';
  // Refresh once per visit, and again if the page has been open a while. The sync is no longer
  // tied to the date range, so changing dates just re-filters what is already held.
  const STALE_MS=5*60*1000;
  const age=Date.now()-(window._orgSyncedAt||0);
  if(!window._orgSyncedAt || age>STALE_MS){ window._orgSyncedAt=Date.now(); orgAutoSync(); }
  else { const tag=document.getElementById('orgFresh');
         if(tag&&!window._orgSyncing) tag.innerHTML='<i class="fa-solid fa-circle-check" style="color:#16a34a"></i> Updated '+Math.max(1,Math.round(age/60000))+'m ago'; }
};

VIEWS.transcription=async function(v,seg){
  setCrumb(['Growth & Strategy','Transcription']);
  if(seg[0]==='view'&&seg[1]){return trDetail(v,seg[1]);}
  v.innerHTML=mHead('fa-microphone-lines','#0d9488','Transcription')
    +'<div class="card card-pad" style="background:#f0fdfa;border-color:#99f6e4;margin:14px 0 16px;font-size:13.5px"><i class="fa-solid fa-language" style="color:#0d9488"></i> Upload a pre-sales call recording — it is transcribed in <b>Hindi, English &amp; Bengali</b> (code-switching aware) and the lead is automatically marked <b>Qualified</b> or <b>Not Qualified</b> against the JainGroup projects, with a reason.</div>'
    +'<div id="trKpis"></div>'
    +'<div class="toolbar" style="margin:16px 0 0"><div class="grow"></div><button class="btn btn-primary" onclick="trUploadModal()"><i class="fa-solid fa-cloud-arrow-up"></i> Upload recording</button></div>'
    +'<div class="card" style="margin-top:14px"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Recording</th><th>Status</th><th>Reason</th><th>Languages</th><th>Duration</th><th>Uploaded</th><th></th></tr></thead><tbody id="trRows"><tr><td colspan="7"><div class="loader"><div class="spin"></div></div></td></tr></tbody></table></div></div>';
  const rows=await trFetch(true);
  trRenderList();
  rows.forEach(function(r){if(r.status==='processing')trStartPolling(r.id);});
};

function trRenderList(){
  const rows=TR_ROWS||[];
  const kh=$('trKpis');
  if(kh){
    const qual=rows.filter(function(r){return r.qualification==='Qualified';}).length;
    const notq=rows.filter(function(r){return r.qualification==='Not Qualified';}).length;
    const proc=rows.filter(function(r){return r.status==='processing';}).length;
    kh.innerHTML=mKpis([
      ['Calls',String(rows.length),'all time'],
      ['Qualified',String(qual),'leads matched','#16a34a'],
      ['Not Qualified',String(notq),'did not match','#dc2626'],
      ['Processing',String(proc),proc?'in progress':'all clear',proc?'#d97706':'#16a34a'],
    ]);
  }
  const host=$('trRows');if(!host)return;
  if(!rows.length){host.innerHTML='<tr><td colspan="7"><div class="empty" style="padding:34px"><i class="fa-solid fa-microphone-lines"></i><div>No calls yet</div><button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="trUploadModal()"><i class="fa-solid fa-cloud-arrow-up"></i> Upload a recording</button></div></td></tr>';return;}
  host.innerHTML=rows.map(function(r){
    const fname=r.file_name||'Recording';
    const clickable=(r.status==='done')?' style="cursor:pointer" onclick="navTo(\'transcription/view/'+r.id+'\')" title="Open this call"':'';
    // Main line = the recording's file name (truncated with … if too long, full name on hover);
    // below it = the detected customer name, when the call identified one.
    const nameLine=r.customer_name?'<div style="font-size:11px;color:var(--slate)">'+esc(r.customer_name)+'</div>':'';
    return '<tr'+clickable+'>'
      +'<td><div style="display:flex;align-items:center;gap:9px"><i class="fa-solid fa-file-audio" style="color:#0d9488;font-size:15px"></i><div style="min-width:0"><div style="font-weight:600;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(fname)+'">'+esc(fname)+'</div>'+nameLine+'</div></div></td>'
      +'<td>'+trQualTag(r)+(r.status==='error'&&r.error_text?'<div style="font-size:11px;color:#dc2626;margin-top:3px" title="'+esc(r.error_text)+'">'+esc(String(r.error_text).slice(0,60))+'</div>':'')+'</td>'
      +'<td style="max-width:260px"><div title="'+(r.reason?esc(r.reason):'')+'" style="font-size:12.5px;color:var(--slate);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">'+(r.reason?esc(r.reason):'—')+'</div>'+(r.project&&r.project!=='Unclear'?'<div style="font-size:11px;color:#0d9488;font-weight:600;margin-top:2px">'+esc(r.project)+'</div>':'')+'</td>'
      +'<td>'+trLangTags(r.languages)+'</td>'
      +'<td>'+trFmtDur(r.duration_seconds)+'</td>'
      +'<td style="color:var(--slate);font-size:12px">'+fmtDate(r.created_at)+'</td>'
      +'<td style="white-space:nowrap" onclick="event.stopPropagation()">'
        +(r.status==='error'?'<button class="btn btn-sm" title="Retry analysis" onclick="trRetry('+r.id+')"><i class="fa-solid fa-rotate-right"></i> Retry</button> ':'')
        +'<button class="btn btn-sm btn-ghost" title="Delete" onclick="trDelete('+r.id+')"><i class="fa-solid fa-trash"></i></button>'
      +'</td></tr>';
  }).join('');
}

async function trPollOnce(id){
  const {data:{session}}=await sb.auth.getSession();
  const token=session&&session.access_token;
  const res=await fetch(SUPABASE_URL+'/functions/v1/transcription-analyze',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},body:JSON.stringify({action:'poll',id:id})});
  return res.json().catch(function(){return null;});
}
function trStartPolling(id){
  if(TR_TIMERS[id])return;
  const tick=async function(){
    let out=null;try{out=await trPollOnce(id);}catch(e){}
    if(out&&out.row){const i=(TR_ROWS||[]).findIndex(function(x){return x.id===out.row.id;});if(i>=0)TR_ROWS[i]=out.row;}
    const st=out&&(out.status||(out.row&&out.row.status));
    if(st==='done'||st==='error'){delete TR_TIMERS[id];if(PAGE==='transcription')renderPage();return;}
    TR_TIMERS[id]=setTimeout(tick,6000);
  };
  TR_TIMERS[id]=setTimeout(tick,3000);
}

window.trDelete=async function(id){
  const ok=await confirmDialog('Delete this recording and its transcript? This cannot be undone.');
  if(!ok)return;
  const r=(TR_ROWS||[]).find(function(x){return x.id===id;});
  TR_ROWS=(TR_ROWS||[]).filter(function(x){return x.id!==id;});
  trRenderList();
  try{await sb.schema('acc').from('transcriptions').delete().eq('id',id);}catch(e){}
  if(r&&r.s3_path)try{s3Delete(r.s3_path);}catch(e){}
  toast('Recording deleted','ok');
};

// Re-run analysis on a failed row using the recording already in S3 — no re-upload needed.
window.trRetry=async function(id){
  const i=(TR_ROWS||[]).findIndex(function(x){return x.id===id;});
  if(i>=0){ TR_ROWS[i].status='processing'; TR_ROWS[i].error_text=null; trRenderList(); }
  const {data:{session}}=await sb.auth.getSession();
  const token=session&&session.access_token;
  try{
    const res=await fetch(SUPABASE_URL+'/functions/v1/transcription-analyze',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},body:JSON.stringify({action:'retry',id:id})});
    const out=await res.json().catch(function(){return {};});
    if(!res.ok||!out.row) throw new Error(out.error||'could not retry');
    trStartPolling(id);
    toast('Retrying…','ok');
  }catch(e){
    toast('Could not retry: '+((e&&e.message)||e),'err');
    if(i>=0){ TR_ROWS[i].status='error'; trRenderList(); }
  }
};

window.trUploadModal=function(){
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-cloud-arrow-up"></i> Upload call recordings</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm">'
    +'<div class="dropzone" ondragover="event.preventDefault()" ondrop="trDrop(event)" onclick="document.getElementById(\'trFile\').click()"><i class="fa-solid fa-file-audio"></i><div id="trUpName">Drag &amp; drop or click to select recordings — pick up to 50 at once</div><div style="font-size:12px;margin-top:4px">mp3 · wav · m4a · webm · mp4 · mov and more · Hindi / English / Bengali</div></div>'
    +'<input type="file" id="trFile" class="hidden" multiple accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.opus,.webm,.flac,.mp4,.mov,.mkv,.3gp,.amr" onchange="trUpPick()">'
    +'<div id="trFileList" style="margin-top:12px"></div>'
    +'<div id="trUpMsg" style="margin-top:10px"></div>'
    +'</div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="trUpBtn" onclick="trUploadStart()" disabled><i class="fa-solid fa-wand-magic-sparkles"></i> Transcribe &amp; Qualify</button></div>','md');
};
window.trDrop=function(ev){ev.preventDefault();const dt=ev.dataTransfer;if(!dt||!dt.files||!dt.files.length)return;const inp=$('trFile');if(!inp)return;const buf=new DataTransfer();for(let i=0;i<dt.files.length;i++)buf.items.add(dt.files[i]);inp.files=buf.files;trUpPick();};
window.trUpPick=function(){
  const files=Array.prototype.slice.call(($('trFile').files)||[]);
  const over=files.length>50;const n=Math.min(files.length,50);
  $('trUpName').textContent=files.length?(files.length===1?files[0].name:(files.length+' files selected'+(over?' — first 50 will be used':''))):'Drag & drop or click to select recordings — pick up to 50 at once';
  const list=$('trFileList');
  if(list){
    list.innerHTML=n?('<label style="display:block;margin-bottom:6px">Selected recording'+(n>1?'s':'')+'</label>'
      +'<div style="max-height:280px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:8px">'
      +files.slice(0,50).map(function(f,i){
        return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'
          +'<i class="fa-solid fa-file-audio" style="color:#0d9488"></i>'
          +'<div style="flex:1;min-width:0"><div style="font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(f.name)+'">'+esc(f.name)+'</div></div>'
          +'</div>';
      }).join('')+'</div>'
      +(over?'<div style="font-size:12px;color:#d97706;margin-top:6px"><i class="fa-solid fa-triangle-exclamation"></i> You picked '+files.length+' files — only the first 50 upload at a time.</div>':'')):'';
  }
  trUpValidate();
};
window.trUpValidate=function(){
  // No phone field anymore — just enable the button once at least one recording is picked.
  const n=Math.min((($('trFile').files||[]).length),50);
  const btn=$('trUpBtn');if(btn){btn.disabled=!(n>0);btn.innerHTML='<i class="fa-solid fa-wand-magic-sparkles"></i> Transcribe &amp; Qualify'+(n>1?(' '+n+' calls'):'');}
};
// Upload one recording: try direct browser->S3 first (fast, no size limit, works on the live
// domain); if that's blocked (e.g. testing from localhost, whose origin S3's CORS doesn't allow)
// fall back to the server-side proxy so it still uploads from anywhere.
// Read an audio/video file's duration (seconds) in the browser, so the list shows real length.
function trAudioDuration(file){return new Promise(function(resolve){try{const el=document.createElement('audio');el.preload='metadata';const url=URL.createObjectURL(file);let done=false;const fin=function(d){if(done)return;done=true;try{URL.revokeObjectURL(url);}catch(_){}resolve(d);};el.onloadedmetadata=function(){const d=el.duration;fin(isFinite(d)&&d>0?Math.round(d):null);};el.onerror=function(){fin(null);};setTimeout(function(){fin(null);},8000);el.src=url;}catch(e){resolve(null);}});}
async function trUploadOne(f,token){
  const key=s3KeyForTranscription(f.name);
  let path=null;
  try{ const up=await uploadFileToS3(key,f); if(up&&up.data&&up.data.path) path=up.data.path; }catch(_e){}
  if(!path){
    const up=await fetch(SUPABASE_URL+'/functions/v1/transcription-upload?key='+encodeURIComponent(key),{method:'POST',headers:{'Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY,'Content-Type':f.type||'application/octet-stream'},body:f});
    const uj=await up.json().catch(function(){return {};});
    if(!up.ok||!uj.path) throw new Error(uj.error||'upload failed');
    path=uj.path;
  }
  return path;
}
window.trUploadStart=async function(){
  let files=Array.prototype.slice.call(($('trFile').files)||[]);
  if(!files.length){toast('Select at least one recording','err');return;}
  if(files.length>50)files=files.slice(0,50);
  // Phone field removed — the caller's name/number is picked up from the call itself.
  const phones=files.map(function(){return null;});
  const btn=$('trUpBtn');if(btn)btn.disabled=true;
  const msg=$('trUpMsg');
  const {data:{session}}=await sb.auth.getSession();
  const token=session&&session.access_token;
  const total=files.length;let done=0,failed=0,idx=0;
  const paint=function(){const pct=Math.round((done+failed)/total*100);if(msg)msg.innerHTML='<div class="psa-progress"><div class="psa-progress-bar"><div class="psa-progress-fill" style="width:'+pct+'%"></div></div><div class="psa-progress-label">Processed '+(done+failed)+' of '+total+' · '+done+' ok'+(failed?', '+failed+' failed':'')+'</div></div>';};
  paint();
  const worker=async function(){
    while(idx<files.length){
      const i=idx++;const f=files[i];
      try{
        const dur=await trAudioDuration(f);
        const path=await trUploadOne(f,token);
        const res=await fetch(SUPABASE_URL+'/functions/v1/transcription-analyze',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},body:JSON.stringify({action:'start',key:path,phone:phones[i],name:f.name,size:f.size,duration:dur})});
        const out=await res.json().catch(function(){return {};});
        if(!res.ok||!out.row) throw new Error(out.error||'could not start');
        if(!TR_ROWS)TR_ROWS=[];
        TR_ROWS.unshift(out.row);
        trStartPolling(out.row.id);
        done++;
      }catch(e){ failed++; }
      paint();
    }
  };
  const K=Math.min(4,files.length);
  await Promise.all(Array.from({length:K},function(){return worker();}));
  toast(done+' call'+(done===1?'':'s')+' submitted'+(failed?(', '+failed+' failed'):''), failed?'warn':'ok');
  closeModal();
  if(PAGE==='transcription')renderPage();
};

async function trDetail(v,id){
  setCrumb([['Growth & Strategy','#/'],['Transcription','#/'],'Recording']);
  v.innerHTML='<div class="loader"><div class="spin"></div></div>';
  let r=null;
  try{const {data}=await sb.schema('acc').from('transcriptions').select('*').eq('id',id).single();r=data;}catch(e){}
  if(!r){v.innerHTML=mHead('fa-microphone-lines','#0d9488','Transcription')+'<div class="card card-pad empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Recording not found</div><button class="btn btn-sm" style="margin-top:12px" onclick="navTo(\'transcription\')">Back</button></div>';return;}
  const phone=r.phone||r.title||'';
  const name=phone?trPhoneFmt(phone):(r.file_name||'Recording');
  const a=r.analysis||{};
  const sub=(r.customer_name?esc(r.customer_name)+' · ':'')+fmtDate(r.created_at)+' · '+esc((r.created_by||'').split('@')[0]);
  const qb=r.qualification==='Qualified';
  const banner=(r.status==='done'&&r.qualification)?('<div class="card card-pad" style="margin:6px 0 16px;border-left:5px solid '+(qb?'#16a34a':'#dc2626')+'"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span class="tag '+(qb?'t-green':'t-red')+'" style="font-size:14px;padding:6px 12px"><i class="fa-solid '+(qb?'fa-circle-check':'fa-circle-xmark')+'"></i> '+esc(r.qualification)+'</span>'+(r.project&&r.project!=='Unclear'?'<span style="font-weight:700;color:#0d9488;font-size:15px">'+esc(r.project)+'</span>':'')+'</div>'+(r.reason?'<div style="margin-top:10px;font-size:14px;line-height:1.55">'+esc(r.reason)+'</div>':'')+'</div>'):'';
  const backBtn='<button class="btn btn-sm" onclick="navTo(\'transcription\')"><i class="fa-solid fa-arrow-left"></i> All calls</button>';
  v.innerHTML='<div class="page-head"><div><h1><i class="fa-solid fa-phone" style="color:#0d9488"></i> '+esc(name)+'</h1><p>'+sub+'</p></div><div style="display:flex;gap:10px">'+backBtn+'<button class="btn" onclick="trDownload('+r.id+')"><i class="fa-solid fa-download"></i> Recording</button></div></div>'
    +'<div id="trAudio" style="margin:6px 0 16px"></div>'
    +banner
    +mKpis([
      ['Duration',trFmtDur(r.duration_seconds),''],
      ['Languages',(r.languages&&r.languages.length?r.languages.map(trLangName).join(', '):'—'),'detected'],
      ['Project',(r.project&&r.project!=='Unclear'?r.project:'—'),'discussed'],
      ['Speakers',String(a.num_speakers||0),'diarised'],
    ])
    +'<div class="grid" style="grid-template-columns:1fr 1fr;gap:16px;margin-top:16px" id="trGrid">'
      +'<div class="card card-pad"><div class="sec-title" style="margin:0 0 10px"><i class="fa-solid fa-wand-magic-sparkles" style="color:#0d9488"></i> Summary</div><div style="font-size:14px;line-height:1.6;white-space:pre-wrap">'+(r.summary?esc(r.summary):'<span style="color:var(--slate)">No summary available.</span>')+'</div></div>'
      +'<div class="card card-pad"><div class="sec-title" style="margin:0 0 10px"><i class="fa-solid fa-list-check" style="color:#0d9488"></i> Qualification checklist</div>'+trCriteriaHtml(r)+'<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line)">'+trAnalysisHtml(r)+'</div></div>'
    +'</div>'
    +'<div class="card card-pad" style="margin-top:16px"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 0 12px"><div class="sec-title" style="margin:0"><i class="fa-solid fa-quote-left" style="color:#0d9488"></i> Transcript</div><div style="display:flex;gap:6px"><button class="btn btn-sm btn-primary" id="trLangEn" onclick="trSetLang(\'en\')">English</button><button class="btn btn-sm" id="trLangBn" onclick="trSetLang(\'bn\')">বাংলা / Original</button></div></div><div id="trTranscriptBody">'+trTranscriptHtml(r,'en')+'</div></div>';
  TR_DETAIL_ROW=r;
  const st=document.createElement('style');st.textContent='@media(max-width:800px){#trGrid{grid-template-columns:1fr!important}}';document.head.appendChild(st);
  if(r.s3_path){
    try{const key=r.s3_path.slice(3);const {data}=await s3Sign('get',key);if(data&&data.url){const ah=$('trAudio');if(ah)ah.innerHTML='<audio controls preload="none" style="width:100%" src="'+data.url+'"></audio>';}}catch(e){}
  }
}

function trCriteriaHtml(r){
  const c=r.criteria||{};
  const items=[['site_visit_interested','Wants a site visit'],['location_match','Location match'],['bhk_match','BHK available'],['budget_match','Budget match'],['ready_move_match','Ready / Under-construction']];
  return '<div style="display:flex;flex-direction:column;gap:8px">'+items.map(function(it,idx){
    const ok=c[it[0]]===true;
    const badge=(idx===0)?'<span style="font-size:10px;font-weight:700;color:#0d9488;background:#f0fdfa;border:1px solid #99f6e4;border-radius:4px;padding:1px 5px;margin-left:6px">PRIORITY</span>':'';
    return '<div style="display:flex;align-items:center;gap:8px;font-size:13.5px"><i class="fa-solid '+(ok?'fa-circle-check':'fa-circle-xmark')+'" style="color:'+(ok?'#16a34a':'#dc2626')+';width:16px"></i> '+it[1]+badge+'</div>';
  }).join('')+'<div style="margin-top:9px;padding-top:8px;border-top:1px dashed var(--line);font-size:11.5px;color:var(--slate);line-height:1.4">Qualified if <b>site visit</b> is agreed — or if <b>Location, BHK, Budget &amp; Ready/Construction</b> all match.</div></div>';
}
function trAnalysisHtml(r){
  const a=r.analysis||{};
  const lb=a.language_breakdown||{};
  const rows=[];
  const langKeys=Object.keys(lb);
  if(langKeys.length){
    const total=langKeys.reduce(function(s,k){return s+lb[k];},0)||1;
    rows.push('<div style="font-size:12px;color:var(--slate);margin-bottom:6px">Language mix (by utterances)</div>');
    langKeys.sort(function(x,y){return lb[y]-lb[x];}).forEach(function(k){
      const pct=Math.round(lb[k]/total*100);
      rows.push('<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:3px"><span>'+esc(trLangName(k))+'</span><span style="color:var(--slate)">'+pct+'%</span></div><div style="height:7px;background:#e2e8f0;border-radius:4px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:#0d9488"></div></div></div>');
    });
  }
  if(Array.isArray(a.entities)&&a.entities.length){
    const ents=a.entities.slice(0,24).map(function(e){return '<span class="tag t-gray" style="margin:0 4px 4px 0">'+esc(e.text||e.value||e.entity||'')+'</span>';}).join('');
    if(ents.trim())rows.push('<div style="font-size:12px;color:var(--slate);margin:12px 0 6px">Key entities mentioned</div><div>'+ents+'</div>');
  }
  if(!rows.length)return '<div style="color:var(--slate);font-size:13px">No additional analysis available.</div>';
  return rows.join('');
}

let TR_DETAIL_ROW=null;
function trTranscriptHtml(r,lang){
  const txt=(lang==='bn')?(r.transcript_bn||r.transcript||''):(r.transcript_en||r.transcript||'');
  if(txt)return '<div style="font-size:13.5px;line-height:1.7;white-space:pre-wrap;max-height:60vh;overflow:auto">'+esc(txt)+'</div>';
  return '<div style="color:var(--slate);font-size:13px">Transcript not available.</div>';
}
window.trSetLang=function(lang){
  if(!TR_DETAIL_ROW)return;
  const b=$('trTranscriptBody');if(b)b.innerHTML=trTranscriptHtml(TR_DETAIL_ROW,lang);
  const en=$('trLangEn'),bn=$('trLangBn');
  if(en)en.className='btn btn-sm'+(lang==='en'?' btn-primary':'');
  if(bn)bn.className='btn btn-sm'+(lang==='bn'?' btn-primary':'');
};

window.trDownload=async function(id){
  const r=(TR_ROWS||[]).find(function(x){return x.id===id;});
  let path=r&&r.s3_path;
  if(!path){try{const {data}=await sb.schema('acc').from('transcriptions').select('s3_path,file_name').eq('id',id).single();if(data){path=data.s3_path;}}catch(e){}}
  if(!path){toast('Recording file not available','err');return;}
  s3OpenSigned(path,(r&&r.file_name)||undefined);
};
