/* ============================ NAV ============================ */
const NAV=[
  {group:'Feedback',items:[
    {id:'feedback_hub',label:'Feedback Hub',icon:'fa-qrcode'},
  ]},
  {group:'Overview',items:[
    {id:'dashboard',label:'Home / Dashboards',icon:'fa-gauge-high'},
    {id:'tasks',label:'Accountability',icon:'fa-clipboard-check'},
    {id:'scoreboard',label:'Scoreboard',icon:'fa-ranking-star'},
    /* Sits under Overview rather than Operations because it is read by the people who chair the
       meeting, not only by the people doing the work it creates. */
    {id:'weekly_status',label:'Weekly Status',icon:'fa-people-group'},
  ]},
  {group:'Sales',items:[
    {id:'gtd',label:'GTD',icon:'fa-brain'},
    {id:'crm',label:'CRM & Sales',icon:'fa-handshake'},
    {id:'postsales',label:'Post Sales',icon:'fa-headset'},
    // Site Visit / Booked customers by PIN code on a map, month by month - src/core/41-lead-map.js
    {id:'lead_map',label:'Lead Map',icon:'fa-map-location-dot'},
  ]},
  {group:'Operations',items:[
    {id:'projects',label:'Projects',icon:'fa-building'},
    {id:'scheduling',label:'Project Scheduling',icon:'fa-diagram-project'},
    {id:'construction',label:'Construction',icon:'fa-helmet-safety'},
    {id:'engineering',label:'Engineering',icon:'fa-compass-drafting'},
    {id:'inventory',label:'Inventory',icon:'fa-boxes-stacked'},
    {id:'procurement',label:'Procurement',icon:'fa-cart-shopping'},
    {id:'maintenance',label:'Assets & Maintenance',icon:'fa-screwdriver-wrench'},
    {id:'inspection',label:'Inspection',icon:'fa-clipboard-list'},
  ]},
  {group:'People',items:[
    {id:'recruitment_new',label:'Recruitment',icon:'fa-user-plus'},
    {id:'hr_new',label:'Human Resources',icon:'fa-users'},
  ]},
  {group:'Governance',items:[
    {id:'finance',label:'Finance Vault',icon:'fa-indian-rupee-sign'},
    {id:'accounts',label:'Accounts',icon:'fa-calculator'},
    {id:'legal',label:'Legal',icon:'fa-scale-balanced'},
    {id:'compliance',label:'Renewals & Compliance',icon:'fa-calendar-check'},
  ]},
  {group:'Growth & Strategy',items:[
    /* Grouped by WHOSE data it is (16 Oct 2026) - see src/core/40-marketing-modules.js. 'campaigns'
       and 'competitors' keep their ids (were Campaign Analytics and Competitor Ads) so the access
       people already hold in adm.users.modules carries over; only the labels changed. Digital
       Metrics no longer has a page: its tabs live in Our Brand and Competitor Data. */
    {id:'campaigns',label:'Our Brand',icon:'fa-bullhorn'},
    {id:'competitors',label:'Competitor Data',icon:'fa-magnifying-glass-chart'},
    {id:'channel_partners',label:'Channel Partners',icon:'fa-people-arrows'},
    {id:'transcription',label:'Transcription',icon:'fa-microphone-lines'},
    {id:'scaling',label:'Scaling Up',icon:'fa-arrow-trend-up'},
    {id:'playbook',label:'Playbook',icon:'fa-book-open'},
  ]},
  {group:'Knowledge',items:[
    {id:'documents',label:'Document Library',icon:'fa-folder-open'},
    {id:'video',label:'Video Library',icon:'fa-clapperboard'},
    {id:'reports',label:'Reports',icon:'fa-chart-pie'},
  ]},
  {group:'Stakeholder Portals',items:[
    // Deliberately no 'customer' entry here — customer.html is a real customer-only login
    // (customer-login.html), never reached by clicking through the staff sidebar. Staff manage
    // and preview it from Customer Portal Admin ("View portal" per customer needs no password).
    {id:'custportal_admin',label:'Customer Portal Admin',icon:'fa-address-card'},
    {id:'supplier',label:'Supplier Portal',icon:'fa-truck'},
    {id:'whatsapp',label:'WhatsApp Bot',icon:'fa-comment-dots'},
    {id:'mail',label:"Naren's Mail",icon:'fa-envelope'},
  ]},
  {group:'System',items:[
    {id:'settings',label:'Settings',icon:'fa-gear'},
  ]},
  // Last on purpose. Internet Speed is a thing you go and look at when something feels slow, not
  // something you work in, so it sat oddly as the second group in the sidebar — above Sales,
  // Operations and everything people actually open all day. It keeps its own group rather than
  // being folded into System, so the sidebar still says what it is.
  {group:'IT & Support',items:[
    {id:'network',label:'Internet Speed',icon:'fa-wifi'},
  ]},
];
const LABELS={};const ICONS={};NAV.forEach(g=>g.items.forEach(i=>{LABELS[i.id]=i.label;ICONS[i.id]=i.icon;}));LABELS.security='Control Panel';ICONS.security='fa-sliders';LABELS.daily_checks='Daily Checks';ICONS.daily_checks='fa-list-check';LABELS.usability='Usability';ICONS.usability='fa-chart-simple';
const MODLIST=[];NAV.forEach(g=>g.items.forEach(i=>MODLIST.push([i.id,i.label])));
const MODSET=new Set(MODLIST.map(m=>m[0]));
const LEVELS=['Manager','Employee','New','Intern'];
const DEFAULT_MODULES=['dashboard','tasks','projects','settings','network','scheduling'];
/* Modules nobody needs to be granted — they are part of the furniture, and were previously spelled
   out three separate times inside allowedSet() plus once more in pageAllowed(), which is how a new
   one gets added to some of them and not others.

   The Scoreboard is here because it is meant to be seen by everyone: it is a company-wide
   leaderboard, and a leaderboard half the company cannot open is not a leaderboard. This replaces
   the narrower "holding tasks grants scoreboard" rule it shipped with a few commits ago.

   This decides only whether a menu entry is drawn and a page will open. It is not a grant of
   anything else: the figures come from acc.scoreboard(), which is SECURITY DEFINER, reads only
   already-approved task counts, and is unchanged. Customers never reach any of this — pageAllowed()
   sends a customer session to the customer page before it gets here. */
const ALWAYS_ON=['dashboard','settings','network','scoreboard'];
function navIcon(id){return ICONS[id]||'fa-square';}
/* THE PAGES WERE RENAMED AND NOBODY'S PERMISSIONS FOLLOWED.

   Recruitment and Human Resources became recruitment_new and hr_new. The menu is filtered by the
   ids in a person's modules, nothing mapped the old names onto the new ones, and not one of the 84
   accounts carries the new ids - so the two entries were invisible to everybody except the two
   super admins, who bypass the filter. 71 people hold 'recruitment' and 10 hold 'hr', and all of
   them had silently lost pages they used to be able to open.

   Rather than rewrite 71 rows, the old id grants the page it was renamed to. That restores what
   people had before the rename and nothing more.

   THIS GRANTS NO EDITING RIGHTS. modules decides only whether a menu entry is drawn. What anybody
   may change once inside is decided separately and is untouched - recCanWrite() by department,
   app.can_write('hr') by role, recruit.can_manage_tests() by its own list, each re-checked in the
   database on every write. Somebody who could only look before can still only look. */
const MODULE_RENAMES={recruitment:'recruitment_new', hr:'hr_new'};
function expandModules(ss){
  Object.keys(MODULE_RENAMES).forEach(function(oldId){
    if(ss.has(oldId)) ss.add(MODULE_RENAMES[oldId]);
  });
  if(ss.has('custportal_photos')||ss.has('custportal_photo_approver')||ss.has('custportal_photo_backup')) ss.add('custportal_admin');
  ALWAYS_ON.forEach(function(id){ ss.add(id); });
  return ss;
}
/* 'custportal_photos' = Customer Portal Admin limited to its Photos & Videos tab. The database
   enforces the same boundary (app.is_custportal_media_editor): such an account can write the four
   photo tables and read project names and a bare flat list, and nothing else in cust.*. */
function cpaPhotosOnly(){ if(state.super)return false; const m=state.roles&&state.roles.modules;
  // A photo approver without Customer Portal Admin of their own gets the same single Photos tab.
  return Array.isArray(m)&&(m.indexOf('custportal_photos')!==-1||((m.indexOf('custportal_photo_approver')!==-1||m.indexOf('custportal_photo_backup')!==-1)&&m.indexOf('custportal_admin')===-1)); }
/* 'custportal_photo_approver' = may publish or reject construction photos and videos (Photos & Videos
   > Review). The database holds the same rule - app.is_photo_approver() in cust.review_media() - and
   also refuses an approver's own uploads; this only decides whether to show the Review screen. */
/* 'custportal_photo_backup' = a backup approver: may do everything an approver does, but the
   database only tells them about photos that have waited more than 2 days (cust.media_daily_digest),
   so they are not woken for what the approver is about to deal with anyway. */
function cpaIsPhotoApprover(){ if(state.super)return true; const m=state.roles&&state.roles.modules; return Array.isArray(m)&&(m.indexOf('custportal_photo_approver')!==-1||m.indexOf('custportal_photo_backup')!==-1); }
function allowedSet(){if(state.super)return null;const m=state.roles&&state.roles.modules;if(m===null||m===undefined)return expandModules(new Set(DEFAULT_MODULES));if(Array.isArray(m)&&m.length)return expandModules(new Set(m));return expandModules(new Set());}
/* Usability sits under Control Panel in Administration, but unlike Control Panel it is NOT
   superadmin-only: the Systems department are the people who actually read it, and they are not
   superadmins. So it is granted the ordinary way — 'usability' in a person's modules — and the
   Administration group appears for anyone holding either of the two. The database enforces the same
   rule inside erp_usability_report(), which is what actually protects the numbers; this only decides
   whether the menu entry is worth drawing. */
function hasUsability(){ if(state.super)return true; const m=state.roles&&state.roles.modules; return Array.isArray(m)&&m.indexOf('usability')!==-1; }
/* FEEDBACK HUB IS FOR THREE PEOPLE, BY NAME.

   Not "granted the ordinary way" like every other module, and deliberately not open to every
   superadmin either: the instruction was the Administrator and Shuchandra Das (and, from 26 Oct
   2026, Prerna Gupta - businessanalyst@), and there is a
   second superadmin account (system1@) that would otherwise pick it up silently. So the test
   runs BEFORE the state.super shortcut in pageAllowed, and the list is one constant here
   rather than a condition spread across the two places that ask.

   To change who can see it, add an address to this list - nothing else needs touching. */
const FEEDBACK_HUB_PEOPLE=['ayushruia1@gmail.com','mgr.hr@thejaingroup.com','businessanalyst@thejaingroup.com'];
function canFeedbackHub(){
  if(state.isCustomer||state.impersonating) return false;
  const me=String(state.email||'').trim().toLowerCase();
  return FEEDBACK_HUB_PEOPLE.indexOf(me)!==-1;
}
/* INVENTORY (PURCHASE & STORES) IS FOR THREE PEOPLE, BY NAME, WHILE IT IS BEING BUILT AND REVIEWED.

   Same arrangement as the Feedback Hub above: not granted through modules, and not open to every
   superadmin either, so the test runs BEFORE the state.super shortcut in pageAllowed. The three are
   the module's own administrators (Administrator, Prerna, Vivky) - the same people listed in
   purchase.module_admins.

   This decides only whether the menu entry is drawn and the page opens. It is not a database rule:
   the purchase tables stay readable by signed-in staff through the API, and what anybody may change is
   enforced by the database separately (roles, approvers and module administrators in the purchase schema).

   To open it up later, delete this block, the two checks for 'inventory' below, and let it be granted
   through modules like any other page. To add someone for now, add an address here. */
/* 2026-10-06: the Systems team (department "Systems" in adm.users) was added to the three administrators, and made
   Purchase administrators too: system.admin@ (Ayush Ruia's other login), system1@, system2.thejaingroup@,
   system6thejaingroup@, ai@. Keep this list and purchase.module_admins the same people. */
const INVENTORY_PEOPLE=['ayushruia1@gmail.com','businessanalyst@thejaingroup.com','system3.thejaingroup@gmail.com',
  'system.admin@thejaingroup.com','system1@thejaingroup.com','system2.thejaingroup@gmail.com','system6thejaingroup@gmail.com','ai@thejaingroup.com'];
function canInventory(){
  if(state.isCustomer||state.impersonating) return false;
  const me=String(state.email||'').trim().toLowerCase();
  return INVENTORY_PEOPLE.indexOf(me)!==-1;
}
/* ACCOUNTS IS FOR THREE PEOPLE, BY NAME.
   Administrator, Prerna and Vicky - the same people who hold the module's own administrator role in
   accounts.access. Same arrangement as Inventory above: the test runs BEFORE the state.super shortcut
   in pageAllowed, so the other super admins do not get the menu entry and cannot open the page.

   This decides only whether the menu entry is drawn and the page opens. It is not a database rule:
   accounts.can_read() still lets any super admin (or anyone granted 'accounts') read the accounts
   tables through the API, and what anybody may post or change is enforced by the database separately
   (accounts.access roles, posted vouchers are immutable).

   To add someone for now, add an address here AND a row in accounts.access.
   To open it up later, delete this block and the two checks for 'accounts' below. */
const ACCOUNTS_PEOPLE=['ayushruia1@gmail.com','businessanalyst@thejaingroup.com','system3.thejaingroup@gmail.com'];
function canAccounts(){
  if(state.isCustomer||state.impersonating) return false;
  const me=String(state.email||'').trim().toLowerCase();
  return ACCOUNTS_PEOPLE.indexOf(me)!==-1;
}
/* WEEKLY STATUS IS FOR PRERNA ALONE, BY NAME.
   Same arrangement as the Feedback Hub and Inventory above: not granted through modules and not
   open to every superadmin, so the test runs BEFORE the state.super shortcut in pageAllowed.
   The database half of this is app.has_module('weekly_status'), which for this one module ignores
   the superadmin bypass and needs the id in the person's own adm.users.modules - so the ops.*
   tables and RPCs refuse anyone else even if they reach the page some other way.
   To add someone: add the address here AND put 'weekly_status' in their adm.users.modules. */
const WEEKLY_STATUS_PEOPLE=['businessanalyst@thejaingroup.com'];
function canWeeklyStatus(){
  if(state.isCustomer||state.impersonating) return false;
  const me=String(state.email||'').trim().toLowerCase();
  return WEEKLY_STATUS_PEOPLE.indexOf(me)!==-1;
}
function effectiveNav(){const allow=allowedSet();let groups=NAV.map(g=>({group:g.group,items:g.items.filter(it=>(it.id==='feedback_hub')?canFeedbackHub():(it.id==='inventory')?canInventory():(it.id==='accounts')?canAccounts():(it.id==='weekly_status')?canWeeklyStatus():(!allow||allow.has(it.id)))})).filter(g=>g.items.length);
  const admItems=[];
  if(state.super) admItems.push({id:'security',label:'Control Panel',icon:'fa-sliders'});
  if(hasUsability()) admItems.push({id:'usability',label:'Usability',icon:'fa-chart-simple'});
  if(hasUsability()) admItems.push({id:'daily_checks',label:'Daily Checks',icon:'fa-list-check'});
  if(admItems.length) groups=[{group:'Administration',items:admItems}].concat(groups);
  return groups;}
function pageAllowed(id){if(state.isCustomer||state.impersonating)return id==='customer';if(id==='feedback_hub')return canFeedbackHub();if(id==='inventory')return canInventory();if(id==='accounts')return canAccounts();if(id==='weekly_status')return canWeeklyStatus();if(state.super)return true;if(id==='security')return false;if(id==='usability'||id==='daily_checks')return hasUsability();if(id==='placeholder'||ALWAYS_ON.includes(id))return true;const m=state.roles&&state.roles.modules;if(m===null||m===undefined)return DEFAULT_MODULES.includes(id);if(Array.isArray(m)&&m.length)return expandModules(new Set(m)).has(id);return false;}

function renderShell(){
  const nav=$('sbNav');nav.innerHTML='';
  effectiveNav().forEach(g=>{
    nav.appendChild(el('div','sb-group',g.group));
    g.items.forEach(it=>{
      const a=el('a','sb-item','<i class="fa-solid '+it.icon+'"></i> '+it.label);
      // href stays a real URL — Ctrl/Cmd/middle-click still opens a genuine new tab, which should
      // do its own real boot() rather than inherit this tab's SPA state. A plain left-click is
      // intercepted below to swap in place instead, which is what actually removes the reload.
      a.href=fileFor(it.id);a.dataset.id=it.id;
      a.onclick=function(e){
        if(e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
        e.preventDefault();
        navTo(it.id);
      };
      nav.appendChild(a);
    });
  });
  // The logo/"back to home" link is static markup in each .html shell (not built by effectiveNav()
  // above), but it's the exact same kind of cross-module link, so it gets the exact same treatment.
  const brand=document.querySelector('.sb-brand');
  if(brand&&!brand.dataset.spaBound){
    brand.dataset.spaBound='1';
    brand.addEventListener('click',function(e){
      if(e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
      e.preventDefault();
      navTo('dashboard');
    });
  }
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
  _gs.addEventListener('keydown',async e=>{
    if(e.key!=='Enter')return;
    const q=e.target.value.trim();_gsDrop.style.display='none';
    if(!q)return;
    // Same exact-id lookup gsLiveSearch does for the dropdown, so pressing Enter before the debounced
    // dropdown appears (or with it dismissed) still lands on the lead instead of a text search for it.
    if(/^\d+$/.test(q)){
      try{
        const route=await trcResolveLeadRoute(q);
        if(route){navTo(route);return;}
        if(PAGE==='transcription'){_gsDrop.innerHTML='<div style="padding:12px 14px;color:var(--slate);font-size:13px;text-align:center">No lead found with ID '+esc(q)+'</div>';_gsDrop.style.display='block';return;}
      }catch(e){}
    }
    navTo('documents/search/'+encodeURIComponent(q));
  });
  /* On the Transcription page the search box doubles as a lead-id jump: a bare number opens that
     lead's detail page as soon as the lookup finds it (no Enter needed), changing the number opens
     the new lead, and clearing the box returns to the default Transcription list. Only a lead
     detail route is left on clear - a tab the user chose themselves is not theirs to be pulled off.
     _gsSeq discards a lookup that finished after the box had already changed again. */
  let _gsSeq=0;
  const _trLeadRoute=()=>/^#\/(lead|auto|r\d+)\/./i.test(location.hash);
  /* Leaving a lead page by any other route (its Back button, the browser's back, a tab) empties the
     box: the id in it described the page that is now gone. */
  window.addEventListener('hashchange',()=>{
    if(PAGE!=='transcription'||_trLeadRoute()||!_gs.value)return;
    clearTimeout(_gsTimer);_gsSeq++;_gs.value='';_gsDrop.style.display='none';
  });
  _gs.addEventListener('input',e=>{
    clearTimeout(_gsTimer);const q=e.target.value.trim();const seq=++_gsSeq;
    if(!q){
      _gsDrop.style.display='none';
      if(PAGE==='transcription'&&_trLeadRoute())navTo('transcription');
      return;
    }
    if(PAGE==='transcription'&&/^\d+$/.test(q)){
      _gsTimer=setTimeout(async()=>{
        try{
          const route=await trcResolveLeadRoute(q);
          if(seq!==_gsSeq)return;
          if(route){
            _gsDrop.style.display='none';
            if(location.hash!=='#/'+route.split('/').slice(1).join('/'))navTo(route);
            return;
          }
          _gsDrop.innerHTML='<div style="padding:12px 14px;color:var(--slate);font-size:13px;text-align:center">No lead found with ID '+esc(q)+'</div>';
          _gsDrop.style.display='block';
          return;
        }catch(err){
          if(seq===_gsSeq){_gsDrop.innerHTML='<div style="padding:12px 14px;color:var(--err);font-size:13px;text-align:center">Could not search leads: '+esc((err&&err.message)||String(err))+'</div>';_gsDrop.style.display='block';}
          return;
        }
      },350);
      return;
    }
    _gsTimer=setTimeout(()=>gsLiveSearch(q),250);
  });
  document.addEventListener('click',e=>{if(!_gs.parentElement.contains(e.target))_gsDrop.style.display='none';});
  // hamburger / responsive sidebar
  if(window.innerWidth>1024 && localStorage.getItem('nav_closed')==='1') document.body.classList.add('nav-closed');
  var hb=$('hamburger'); if(hb) hb.onclick=function(e){ e.stopPropagation(); var mobile=window.innerWidth<=1024; document.body.classList.toggle(mobile?'nav-open':'nav-closed'); if(!mobile){ try{ localStorage.setItem('nav_closed', document.body.classList.contains('nav-closed')?'1':'0'); }catch(_){} } };
  var bd=$('sbBackdrop'); if(bd) bd.onclick=function(){ document.body.classList.remove('nav-open'); };
  document.querySelectorAll('.sb-item').forEach(function(a){ a.addEventListener('click',function(){ document.body.classList.remove('nav-open'); }); });
}
async function doSignOut(){ bgForget(); try{ await sb.auth.signOut(); }catch(e){} try{ Object.keys(localStorage).forEach(function(k){ if(/sb-.*-auth-token/.test(k)||k.indexOf('supabase')>=0) localStorage.removeItem(k); }); }catch(e){} try{ sessionStorage.removeItem(BOOT_CACHE_KEY); }catch(e){} location.replace(LOGIN_PAGE); }
window.doSignOut=doSignOut;

/* Where a typed lead id lives. crm_lead_detail answers every id asked for, so an unknown id still
   comes back as a row with a null lead and no follow-ups - only a lead row or a history counts as
   found. A lead can also exist ONLY as a transcribed call (acc.transcriptions, e.g. the lost-call sync
   saw it before the CRM export did); that call's own page is the best thing to open for it. Returns
   a navTo path, or null when the id is nowhere in Supabase. Throws on a failed query. */
async function trcResolveLeadRoute(q){
  const {data,error}=await sb.schema('acc').rpc('crm_lead_detail',{p_lead_ids:[Number(q)]});
  if(error)throw error;
  const hit=(data||[])[0];
  if(hit&&(hit.lead||(Array.isArray(hit.followups)&&hit.followups.length)))return 'transcription/lead/'+Number(q);
  const {data:tr,error:e2}=await sb.schema('acc').from('transcriptions').select('id').eq('lead_id',Number(q)).is('deleted_at',null).order('created_at',{ascending:false}).limit(1);
  if(e2)throw e2;
  if(tr&&tr.length)return 'transcription/auto/'+tr[0].id;
  return null;
}
// Universal live document search (top nav)
async function gsLiveSearch(q){
  const drop=document.getElementById('gsDrop');if(!drop)return;
  drop.style.display='block';
  drop.innerHTML='<div style="padding:10px 14px;color:var(--slate);font-size:13px">Searching…</div>';
  const ql=q.toLowerCase();
  // A bare number is treated as a lead id lookup rather than a text search: acc.crm_lead_detail takes
  // a bigint id and does an EXACT match, so this is "find this one lead", not "find leads like this".
  // It returns the lead row plus its whole follow-up history (recordings included) in one round trip,
  // the same RPC the Transcription lead page itself uses (see trcLeadFetchByIds) - so a hit here always
  // opens straight into that same detail page, never a partial or reconstructed view of it.
  let leadRow='';
  if(/^\d+$/.test(q)){
    try{
      const {data,error}=await sb.schema('acc').rpc('crm_lead_detail',{p_lead_ids:[Number(q)]});
      if(error)throw error;
      const hit=(data||[])[0];
      if(hit&&hit.lead){
        const lead=hit.lead;
        const followups=Array.isArray(hit.followups)?hit.followups:[];
        const calls=followups.filter(f=>f&&(f.has_recording||f.recording_url)).length;
        const sub='Lead · '+followups.length+' follow-up'+(followups.length===1?'':'s')
          +(calls?' · '+calls+' call recording'+(calls===1?'':'s'):'')
          +(lead.status?' · '+lead.status:'');
        leadRow='<div style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;border-bottom:1px solid var(--line-2);background:#f0fdfa" '
          +'onmousedown="event.preventDefault();navTo(\'transcription/lead/'+esc(String(lead.lead_id))+'\');document.getElementById(\'gsDrop\').style.display=\'none\'">'
          +'<i class="fa-solid fa-user-clock" style="color:#0d9488;width:14px;font-size:13px"></i>'
          +'<div><div style="font-size:13px;font-weight:500">'+esc(lead.lead_name||('Lead '+lead.lead_id))+'</div>'
          +'<div style="font-size:11px;color:var(--slate)">'+esc(sub)+'</div></div></div>';
      }
    }catch(e){}
  }
  // Search documents
  let docs=[];
  try{const {data}=await sb.schema('doc').from('documents').select('id,title,file_name,category,department,storage_path').or('file_name.ilike.%'+q+'%,title.ilike.%'+q+'%,doc_no.ilike.%'+q+'%').limit(6);docs=data||[];}catch(e){}
  // Search JDs
  let jds=[];
  try{const {data}=await sb.schema('recruit').from('job_descriptions').select('id,name,storage_path').limit(6);jds=(data||[]).filter(j=>j.name.toLowerCase().includes(ql));}catch(e){}
  const defJds=(typeof DEFAULT_JDS!=='undefined'?DEFAULT_JDS:[]).filter(j=>j.name.toLowerCase().includes(ql));
  if(!leadRow&&!docs.length&&!jds.length&&!defJds.length){drop.innerHTML='<div style="padding:12px 14px;color:var(--slate);font-size:13px;text-align:center">No results found</div>';return;}
  const row=(icon,name,sub,url)=>`<div style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;border-bottom:1px solid var(--line-2)" onmousedown="event.preventDefault();window.open('${url}','_blank');document.getElementById('gsDrop').style.display='none'">
    <i class="fa-solid ${icon}" style="color:#64748b;width:14px;font-size:13px"></i>
    <div><div style="font-size:13px;font-weight:500">${esc(name)}</div><div style="font-size:11px;color:var(--slate)">${esc(sub)}</div></div>
  </div>`;
  const docRows=docs.map(r=>{const url=r.storage_path?SUPABASE_URL+'/storage/v1/object/public/documents/'+encodeURIComponent(r.storage_path).replace(/%2F/g,'/'):'#';const sub=[r.department,r.category].filter(Boolean).join(' · ')||'Document Library';return row('fa-file',r.title||r.file_name,sub,url);});
  const jdDbRows=jds.map(j=>{const url=j.storage_path?SUPABASE_URL+'/storage/v1/object/public/recruitment/'+encodeURIComponent(j.storage_path).replace(/%2F/g,'/'):'#';return row('fa-file-pdf',j.name,'Job Description · Recruitment',url);});
  const jdDefRows=defJds.map(j=>row('fa-file-pdf',j.name,'Job Description · Recruitment',j.url));
  drop.innerHTML=leadRow+docRows.join('')+jdDbRows.join('')+jdDefRows.join('')+
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
  let ok=false;
  try{const {error}=await sb.schema('acc').from('notif_dismissed_tasks').upsert(items.map(t=>({email:state.email,task_id:t.id})));ok=!error;}catch(e){}
  // Logged here rather than through USAGE_MAP so both "Mark all read" links - this one and the
  // Updates one below - record the same feature with the same verb, and so a click that saved
  // nothing is not counted. How many were cleared is the only detail worth keeping.
  if(ok){ try{ usageQueue('tasks.tasks.mark_all_notifications_as_read','update',{title:items.length+' due reminder'+(items.length>1?'s':'')}); }catch(_e){} }
  await renderNotifDropdown();refreshNotifState();
};
// "Mark all read" for the Updates bucket (project-added / task-delegated) — Approvals are deliberately
// excluded, since those need an actual Approve/Decline action, not just dismissal.
window.notifMarkAllGeneralRead=async function(){
  // This is the "Mark all read" people actually press - the Updates bucket - and it was the one
  // the usage catalog never watched: only notifDismissAllDue (the Due bucket) was mapped, and
  // acc.notif_dismissed_tasks shows that link has never been clicked once, so the feature read 0
  // uses while thousands of notifications were being cleared here. .select() is what makes the
  // count knowable; with nothing unread the click is a no-op and is not counted.
  // Counted BEFORE the update, with a plain select, rather than from what the update returns:
  // an update's returning rows depend on the row-level policy still matching the row after the
  // change, and read:true is exactly what changed. A count taken first cannot be caught by that.
  let n=0;
  try{const {data:un}=await sb.schema('acc').from('notifications').select('id').eq('recipient',state.email).eq('read',false);n=(un||[]).length;}catch(e){}
  let ok=false;
  try{const {error}=await sb.schema('acc').from('notifications').update({read:true}).eq('recipient',state.email).eq('read',false);ok=!error;}catch(e){}
  if(n&&ok){ try{ usageQueue('tasks.tasks.mark_all_notifications_as_read','update',{title:n+' notification'+(n>1?'s':'')}); }catch(_e){} }
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
  // Construction photo approval (cust.review_media / cust.notify_media_uploaded).
  if(n.kind==='media_pending')return {icon:'fa-stamp',cls:'t-amber',text:'Photos to approve',taskId:null,go:"notifOpenMedia('review')"};
  if(n.kind==='media_digest')return {icon:'fa-stamp',cls:'t-amber',text:n.body||'Photos waiting for approval',taskId:null,go:"notifOpenMedia('review')"};
  if(n.kind==='media_rejected')return {icon:'fa-circle-xmark',cls:'t-red',text:n.body||'Photos rejected',taskId:null,go:"notifOpenMedia('upload')"};
  if(n.kind==='media_published')return {icon:'fa-circle-check',cls:'t-green',text:'Photos published',taskId:null,go:"notifOpenMedia('upload')"};
  return {icon:'fa-bell',cls:'t-gray',text:n.body||'Notification',taskId:n.task_id||null};
}
// Opens Customer Portal Admin > Photos & Videos: Review for an approver's "to approve", the upload
// list (with each item's status and any rejection reason) for the uploader.
window.notifOpenMedia=function(mode){
  const dd=$('notifDd'); if(dd) dd.classList.remove('show');
  CPA_PH.mode=(mode==='review'&&cpaIsPhotoApprover())?'review':'upload';
  if(CPA_PH.mode==='review'){ CPA_RV.status='pending'; CPA_RV.sel.clear(); CPA_RV.picked=false; }
  navTo('custportal_admin/'+(cpaPhotosOnly()?0:3));
};
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
      return `<div class="n-it" onclick="notifMarkRead(${n.id});${meta.go?meta.go:meta.taskId?`goToTask(${meta.taskId})`:`$('notifDd').classList.remove('show')`}"><div class="n-ic ${meta.cls}"><i class="fa-solid ${meta.icon}"></i></div><div><div style="font-weight:600;font-size:13px">${esc(n.title||meta.text)}</div><div style="color:var(--slate);font-size:12px">${meta.text} · ${relTime(n.created_at)}</div></div></div>`;
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

