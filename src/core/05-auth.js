/* ============================ AUTH ============================ */
function fatal(msg){
  var a=$('authLoad');
  if(a){a.style.display='flex';a.innerHTML='<div style="text-align:center;max-width:420px;padding:30px;font-family:Inter,system-ui,sans-serif"><div style="font-size:34px">⚠️</div><div style="margin-top:12px;font-weight:700;font-size:17px">Couldn’t load the workspace</div><div style="color:#64748b;font-size:13.5px;margin-top:8px;line-height:1.5">'+msg+'</div><a href="'+LOGIN_PAGE+'" style="display:inline-block;margin-top:16px;background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:9px;text-decoration:none;font-weight:600;font-size:14px">Go to Sign In</a></div>';}
}
window.addEventListener('error',function(e){ if(!state.user){ fatal((e.message||'A script error occurred')+'.'); } });

/* WRONG COMPUTER CLOCK. A sign-in lasts an hour, and supabase-js decides when it has run out by the
   computer's own clock. A PC running two hours fast therefore sees every token as already expired and
   asks for a new one on every getSession() - several a second across the session guard, background
   loading and the page itself - until Supabase answers 429 and the library signs the person out. It
   looked like "JainE logs me out after a few seconds" (15 Oct 2026: one PC, 2h fast, Windows Time
   stopped). Nothing in the browser can correct the clock, so the person is told plainly how to.
   The measure: a token's iat is the server's time when it was issued. Right after a sign-in or a
   refresh, now - iat is the clock error (plus a second or two of network). Any token issued "in the
   future" means the clock is slow - that holds for an old token too. */
const CLOCK_SKEW_LIMIT_S=300;
let CLOCK_BANNER_SHOWN=false;
function tokenIssuedAt(token){
  try{
    const part=String(token||'').split('.')[1]; if(!part) return null;
    const json=JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')));
    return typeof json.iat==='number'?json.iat:null;
  }catch(_e){ return null; }
}
// fresh: the token was issued just now (SIGNED_IN / TOKEN_REFRESHED), so a fast clock shows too
function checkClockSkew(session, fresh){
  const iat=tokenIssuedAt(session&&session.access_token); if(iat==null) return;
  const skew=Math.round(Date.now()/1000-iat);     // >0: this computer is ahead of the server
  if(skew<-CLOCK_SKEW_LIMIT_S || (fresh && skew>CLOCK_SKEW_LIMIT_S)) showClockBanner(skew);
}
function showClockBanner(skew){
  if(CLOCK_BANNER_SHOWN) return; CLOCK_BANNER_SHOWN=true;
  const mins=Math.round(Math.abs(skew)/60), h=Math.floor(mins/60), m=mins%60;
  const by=(h?h+' hour'+(h>1?'s':''):'')+(h&&m?' ':'')+(m?m+' minute'+(m>1?'s':''):'');
  const b=document.createElement('div');
  b.id='clockSkewBanner';
  b.setAttribute('role','alert');
  b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:100000;background:#b91c1c;color:#fff;padding:10px 44px 10px 16px;font:500 13.5px/1.45 Inter,system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25)';
  b.innerHTML='<i class="fa-solid fa-clock"></i> <b>This computer\'s clock is about '+esc(by)+' '+(skew>0?'fast':'slow')+'.</b> '+
    'JainE cannot keep you signed in until it is correct. On Windows: Settings &rarr; Time &amp; language &rarr; Date &amp; time &rarr; turn on <b>Set time automatically</b> &rarr; <b>Sync now</b>. Then reload this page.'+
    '<button type="button" aria-label="Dismiss" style="position:absolute;right:10px;top:8px;background:none;border:0;color:#fff;font-size:18px;cursor:pointer">&times;</button>';
  b.querySelector('button').onclick=function(){ b.remove(); };
  (document.body||document.documentElement).appendChild(b);
  console.warn('[clock] this computer is '+skew+'s '+(skew>0?'ahead of':'behind')+' the server');
}
/* A failed token refresh that is only "try again later" (rate limit, server busy) leaves getSession()
   with no session AND an error. That is not a sign-out: the stored sign-in is still there and works
   once the refresh goes through, so none of the checks below send the person to the login page for it.
   bgFetch reports a 429 on /auth/v1/token as 503 so supabase-js files it under this kind. */
function authTransient(error){
  return !!error && (error.name==='AuthRetryableFetchError' || error.status===429 || error.status===503);
}

// Every navigation between modules is a full page load of a different .html file (each pulling in
// this same multi-megabyte script fresh), so boot()'s who-is-this + profile/roles/permissions
// fetches used to re-run in full on every single click between tabs — the visible "Loading your
// workspace" pause. This sessionStorage cache skips that on every navigation after the first one in
// a tab; refreshBootCache() is called anywhere state.profile/roles/super changes mid-session (a
// Settings save, password-set, onboarding) so a cache hit within BOOT_CACHE_TTL_MS never serves data
// staler than the user's own last edit. An admin changing someone ELSE's access still takes up to
// BOOT_CACHE_TTL_MS to show up for that person — an acceptable trade for data that changes by
// administrative action, not by the second.
const BOOT_CACHE_KEY='nexusBootCacheV1';
const BOOT_CACHE_TTL_MS=3*60*1000;
function refreshBootCache(){
  try{ sessionStorage.setItem(BOOT_CACHE_KEY,JSON.stringify({email:state.email,at:Date.now(),profile:state.profile,roles:state.roles,super:state.super})); }catch(e){}
}
function readBootCache(){
  try{
    const raw=sessionStorage.getItem(BOOT_CACHE_KEY);
    if(!raw)return null;
    const parsed=JSON.parse(raw);
    if(parsed&&parsed.email===state.email&&(Date.now()-parsed.at)<BOOT_CACHE_TTL_MS)return parsed;
  }catch(e){}
  return null;
}
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
  let sess, sessErr=null;
  try{ const {data,error}=await sb.auth.getSession(); sess=data.session; sessErr=error||null; }
  catch(err){ fatal('Could not reach the authentication service. Check your internet connection. ('+err.message+')'); return; }
  if(!sess){
    // Right after a Google-sign-in redirect, a brand-new page load can momentarily
    // read no session before it's finished settling — wait a beat and check once
    // more before concluding there's really no session (avoids a login-page flash).
    await new Promise(r=>setTimeout(r,700));
    try{ const {data,error}=await sb.auth.getSession(); sess=data.session; sessErr=error||null; }catch(e){}
  }
  if(!sess && authTransient(sessErr)){
    fatal('Your sign-in could not be renewed just now. Wait a minute and reload the page.'+
      (CLOCK_BANNER_SHOWN?' First correct this computer\'s clock (see the red bar at the top).':''));
    return;
  }
  if(!sess){ location.replace(LOGIN_PAGE); return; }
  checkClockSkew(sess,false);
  state.user=sess.user; state.email=state.user.email;
  // Cached for usageFlushOnUnload's hand-built fetch — getSession() itself only reads a local
  // cache, but a tab-close/hide handler can't safely await anything, so the token is kept ready
  // ahead of time instead of being fetched at the moment it's needed.
  USAGE_TOKEN=sess.access_token||null;

  // Every existing staff table's RLS was `using(true)` until a real customer login existed
  // (see 20260828090100_customer_portal_isolation_retrofit.sql), so the ONLY safe place to keep a
  // customer session away from the staff shell is here, before anything staff-only is fetched.
  // RLS is the real boundary now (prof_read is `not app.is_customer()`, adm.* keys off the caller's
  // own email/super_admin), so this ordering is a courtesy fast-path today, not the security check
  // it originally had to be — which is what makes it safe to cache (see refreshBootCache() above).
  const cachedBoot=readBootCache();
  let custRow=null;
  if(cachedBoot){
    state.profile=cachedBoot.profile;
    state.roles=cachedBoot.roles;
    state.super=cachedBoot.super;
  }else{
    try{
      const {data}=await sb.schema('cust').from('customers').select('id,full_name').eq('auth_user_id',state.user.id).eq('status','active').is('deleted_at',null).maybeSingle();
      custRow=data||null;
    }catch(e){}
  }
  if(custRow){
    if(PAGE!=='customer'){
      // A customer JWT trying to load a staff page. Sign out rather than silently redirect — an
      // active staff session must never keep running for someone who is, in fact, a customer.
      try{ await sb.auth.signOut(); }catch(e){}
      location.replace('customer-login.html'); return;
    }
    await customerBoot(custRow,false);
    return;
  }
  if(PAGE==='customer'){
    // Not a linked customer login. The one other legitimate reason to be here is a staff member
    // previewing a specific customer's portal (Customer Portal Admin > Customers > "View portal"),
    // flagged by ?as=<customerId> — so support/sales can see exactly what a buyer sees without
    // needing a customer account of their own. Anyone else is bounced to the customer sign-in page.
    const asId=Number(new URLSearchParams(location.search).get('as'));
    if(asId){
      try{
        const [rolesRes,permRes]=await Promise.all([
          sb.schema('adm').from('users').select('*').eq('email',state.email).maybeSingle().then(r=>r,()=>({data:null})),
          sb.schema('adm').from('user_permissions').select('super_admin').eq('email',state.email).maybeSingle().then(r=>r,()=>({data:null})),
        ]);
        state.roles=rolesRes.data||null;
        state.super=!!(permRes.data&&permRes.data.super_admin);
      }catch(e){}
      // Client-side check decides only whether we ATTEMPT the preview — same as every other
      // module-visibility check in this app (see hasUsability() above). The real boundary is RLS:
      // cust.*'s staff_all policies (app.is_custportal_staff()) are what actually let this account
      // read another customer's data at all, and a non-staff account gets zero rows regardless.
      const canPreview=state.super||(state.roles&&Array.isArray(state.roles.modules)&&state.roles.modules.includes('custportal_admin'));
      if(canPreview){
        const {data:targetCust}=await sb.schema('cust').from('customers').select('id,full_name,email').eq('id',asId).is('deleted_at',null).maybeSingle();
        if(targetCust){ await customerBoot(targetCust,true); return; }
      }
    }
    location.replace('customer-login.html'); return;
  }

  // ensure profile + permission rows exist (idempotent self-provision)
  // These three are independent of each other (different tables, no data dependency), so a fresh
  // fetch runs them together instead of one-after-another — and a cache hit above skips this
  // whole block, since state.profile/roles/super are already populated from it.
  if(!cachedBoot){
    try{
      const [profRes,rolesRes,permRes]=await Promise.all([
        sb.schema('acc').from('user_profile').select('*').eq('email',state.email).maybeSingle().then(r=>r,()=>({data:null})),
        sb.schema('adm').from('users').select('*').eq('email',state.email).maybeSingle().then(r=>r,()=>({data:null})),
        sb.schema('adm').from('user_permissions').select('super_admin').eq('email',state.email).maybeSingle().then(r=>r,()=>({data:null})),
      ]);
      state.profile=profRes.data||null;
      state.roles=rolesRes.data||null;
      state.super=!!(permRes.data&&permRes.data.super_admin);
      refreshBootCache();
    }catch(e){}
  }

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
    if(_viaGoogle && !_completed){
      await autoProvisionGoogleProfile();
      refreshBootCache();
    }
  }

  renderShell();
  $('authLoad').style.display='none';
  if(!state.super && !(state.profile&&state.profile.onboarded)){
    const viaGoogle=!!(state.user&&state.user.app_metadata&&state.user.app_metadata.provider==='google');
    if(viaGoogle){
      await autoProvisionGoogleProfile();
      refreshBootCache();
    }
  }
  // A brand-new signup who hasn't finished onboarding yet still gets straight into the same
  // baseline modules an onboarded-but-unassigned user already has (DEFAULT_MODULES) — dashboard,
  // Accountability, Projects, Settings and Internet Speed — instead of being walled off behind
  // the profile-setup screen for all of them.
  if(!state.super && !(state.profile&&state.profile.onboarded) && !DEFAULT_MODULES.includes(PAGE)){ renderOnboarding(); return; }
  $('shell').style.display='block';
  renderPage();
  startSessionGuard();
  promptSetPassword();
  // Not tied to the page just rendered - only to whether this user can see Legal MIS at all
  // (clrevCheckPending checks pageAllowed('legal') itself). Fire-and-forget: it puts its own
  // modal up over whatever renderPage() just drew, it doesn't need to be awaited first.
  // Causelist Reviews were retired on 29 Oct 2026: every MIS case now carries its own action and task.
}
// The customer portal's sections used to be a horizontally-scrolling tab row above the page body -
// with 13 of them the active one was often scrolled out of view. They live in the sidebar instead
// now, one item per section; .sb-nav is already flex:1+overflow-y:auto (same as the staff nav with
// its own long lists), so this scrolls for free with no CSS changes.
// 'Home' is the landing page and must stay at index 0 - the tab index IS the route (customer/<i>),
// so anything hard-coding a number moves with it.
// Construction Progress sits right after Statement (was after Cost Sheet) - a homebuyer mid-build
// wants to see the site before the accounting. CUST_TAB_ICONS stays a parallel array in the same
// order; the render switch below and the one hardcoded navTo('customer/N') deep link (the
// Statement tab's "View full ledger" jump) were renumbered to match.
const CUST_TABS=['Home','Statement','Construction Progress','Ledger','Cost Sheet','Inspection Checklist','Documents','Process Videos','Support','Amenities','Sub-meter','Referrals','Maintenance','Modification Requests'];
const CUST_TAB_ICONS=['fa-house','fa-file-invoice-dollar','fa-helmet-safety','fa-book-open','fa-calculator','fa-clipboard-check','fa-folder-open','fa-clapperboard','fa-headset','fa-water-ladder','fa-gauge','fa-gift','fa-screwdriver-wrench','fa-pen-to-square'];
/* Which sections a customer sees is decided by staff in Customer Portal Admin > Customer Features,
   per project and per block (cust.feature_access). Each section's key, in CUST_TABS order from
   index 1 - Home (index 0) is the landing page and is always shown. */
const CUST_FEATURES=[
  {key:'statement',tab:1},{key:'progress',tab:2},{key:'ledger',tab:3},{key:'cost_sheet',tab:4},
  {key:'inspection',tab:5},{key:'documents',tab:6},{key:'videos',tab:7},{key:'support',tab:8},
  {key:'amenities',tab:9},{key:'submeter',tab:10},{key:'referrals',tab:11},{key:'maintenance',tab:12},
  {key:'modifications',tab:13}];
/* Used only where no rule exists at any level - including when the rules could not be read at all.
   The money and progress sections are on; everything else stays hidden until staff turn it on, so a
   failed read never exposes an unfinished section. */
const CUST_FEATURE_FALLBACK={statement:true,progress:true,ledger:true,cost_sheet:true};
// The most specific rule wins: this block, then the whole project, then the all-projects default.
function custFeatureRule(rules,key,projectId,tower){
  const find=(p,t)=>(rules||[]).find(r=>r.feature===key&&(r.project_id||null)===(p||null)&&(r.tower||null)===(t||null));
  return (tower&&find(projectId,tower))||find(projectId,null)||find(null,null)||null;
}
function custFeatureOn(rules,key,projectId,tower){
  const r=custFeatureRule(rules,key,projectId,tower);
  return r?!!r.enabled:!!CUST_FEATURE_FALLBACK[key];
}
function custTabAllowed(ti,unit){
  if(ti===0)return true;
  const f=CUST_FEATURES.find(x=>x.tab===ti);if(!f)return false;
  if(!unit)return false;
  return custFeatureOn(CUST_DATA&&CUST_DATA.featureRules,f.key,unit.project_id,unit.tower);
}
function custCurrentUnit(){
  const units=(CUST_DATA&&CUST_DATA.units)||[];
  return units.find(u=>u.id===CUST_SELECTED_UNIT)||units[0]||null;
}
function custSidebarTabs(ti){
  const nav=$('sbNav');
  if(!nav)return;
  nav.innerHTML='';
  nav.appendChild(el('div','sb-group','Customer Portal'));
  // Before the customer's flats have loaded nothing is known about which sections apply, so only
  // Home is listed; the sidebar is rebuilt as soon as the data arrives.
  const unit=custCurrentUnit();
  /* "Earn" badge on Referrals - only while this customer has never submitted one. Reads CUST_DATA
     directly rather than taking a parameter: the sidebar paints once at boot (renderCustomerShell,
     before any data exists - CUST_DATA is null, badge stays off rather than flash on) and again from
     VIEWS.customer once custLoadData resolves, so it appears a beat after first paint rather than
     ever having to be taken back. custNewReferralSave flips CUST_DATA.hasReferred straight to true on
     a successful submit, so the badge is gone on the very next sidebar rebuild - no stale cache read. */
  const showReferralBadge=CUST_DATA&&CUST_DATA.hasReferred===false;
  CUST_TABS.forEach(function(t,i){
    if(!custTabAllowed(i,unit))return;
    const badge=(t==='Referrals'&&showReferralBadge)?' <span class="sb-badge-gold">Earn</span>':'';
    const a=el('a','sb-item'+(i===ti?' active':''),'<i class="fa-solid '+(CUST_TAB_ICONS[i]||'fa-circle')+'"></i> <span class="sb-item-label">'+t+'</span>'+badge);
    a.href='javascript:void(0)';
    a.onclick=function(){navTo('customer/'+i);};
    nav.appendChild(a);
  });
  // Same "tap a nav item, close the mobile drawer" behavior renderShell() wires up for staff pages
  // (nexus-core.js:432) - this sidebar is rebuilt fresh on every render so it needs its own copy.
  nav.querySelectorAll('.sb-item').forEach(function(a){ a.addEventListener('click',function(){ document.body.classList.remove('nav-open'); }); });
  // Animated crane + building scene at the bottom of the sidebar
  if(!nav.querySelector('.cust-sb-scene')){
    var scene=document.createElement('div');
    scene.className='cust-sb-scene';
    scene.innerHTML='<div class="csb-crane"><div class="csb-mast"></div><div class="csb-jib"></div><div class="csb-cable"></div><div class="csb-hook"></div></div>'+
      '<div class="csb-buildings"><div class="csb-b csb-b1"></div><div class="csb-b csb-b2"></div><div class="csb-b csb-b3"></div><div class="csb-b csb-b4"></div></div>'+
      '<div class="csb-ground"></div>';
    nav.appendChild(scene);
  }
}
// A minimal shell for a customer session: same DOM (sidebar/topbar/view) every staff page uses,
// so the existing CSS just works, but with the section list instead of a search box, and a
// sign-out-only profile menu instead of the full staff renderShell()/effectiveNav() (which reads
// adm.users data a customer session never fetches — see the customer-detection block in boot() above).
function renderCustomerShell(){
  custSidebarTabs(0);
  // During impersonation, show the CUSTOMER's identity throughout (matching the "viewing as X"
  // banner in VIEWS.customer) rather than the staff member's own — seeing your own email here while
  // the banner says you're previewing someone else read as a bug, even though it wasn't one: the
  // session really is the staff member's, only the data shown is scoped to the customer.
  const nm=(state.customer&&state.customer.full_name)||(state.email||'').split('@')[0];
  const displayEmail=state.impersonating?((state.customer&&state.customer.email)||''):state.email;
  const pb=$('profileBtn');
  if(pb){
    pb.style.background=colorFor(displayEmail);pb.textContent=initials(nm).toUpperCase();
    pb.onclick=e=>{e.stopPropagation();$('profileDd').classList.toggle('show');};
  }
  const dd=$('profileDd');
  if(dd){
    // Impersonation "signs out" of the PREVIEW only — a staff member's real session must survive
    // exiting a customer preview, so this never calls doSignOut() (which ends their actual login).
    const exitAction=state.impersonating?"location.href='custportal-admin.html'":'doSignOut()';
    const exitLabel=state.impersonating?'Exit preview':'Sign Out';
    dd.innerHTML='<div class="dd-head"><span class="avatar-sm" style="background:'+colorFor(displayEmail)+'">'+esc(initials(nm).toUpperCase())+'</span>'+
      '<div class="dd-head-txt"><div class="nm">'+esc(nm)+'</div><div class="em">'+esc(displayEmail)+'</div></div></div>'+
      '<div style="height:1px;background:var(--line-2);margin:6px 0"></div>'+
      '<div class="dd-item" style="color:var(--err)" onclick="'+exitAction+'"><i class="fa-solid fa-arrow-right-from-bracket"></i> '+exitLabel+'</div>';
    document.addEventListener('click',()=>{dd.classList.remove('show');});
  }
  const nb=$('notifBtn');if(nb)nb.style.display='none';
  const gsBox=$('globalSearch');if(gsBox){const box=gsBox.closest('.search-box');if(box)box.style.display='none';}
  // .search-box normally carries margin-left:auto, which is what pushes .topbar-actions to the
  // right edge - hiding it here removes that spacer, leaving the profile avatar sitting right next
  // to the breadcrumb instead of in the corner. Put the same push directly on topbar-actions.
  const ta=document.querySelector('.topbar-actions');if(ta)ta.style.marginLeft='auto';
  const hb=$('hamburger');if(hb)hb.onclick=function(e){e.stopPropagation();document.body.classList.toggle('nav-open');};
  const bd=$('sbBackdrop');if(bd)bd.onclick=function(){document.body.classList.remove('nav-open');};
}
async function customerBoot(custRow,impersonating){
  state.isCustomer=!impersonating;state.impersonating=!!impersonating;state.customer=custRow;
  renderCustomerShell();
  $('authLoad').style.display='none';
  $('shell').style.display='block';
  renderPage();
  startSessionGuard();
}
// Continuously enforce the session: if the token is gone/expired/tampered, log out.
function startSessionGuard(){
  let kicking=false;
  async function kick(){
    if(kicking)return; kicking=true;
    try{ const {data,error}=await sb.auth.getSession(); if((!data||!data.session) && !authTransient(error)){ location.replace(LOGIN_PAGE); } }
    catch(e){ location.replace(LOGIN_PAGE); }
    finally{ kicking=false; }
  }
  // Fast, local-only check (no network round-trip) — safe to run on every in-app navigation.
  // getSession() just reads the cached token, so it can't detect a user deleted server-side
  // whose JWT hasn't expired yet — that needs a real round-trip, see kickHard() below.
  let kickingHard=false;
  async function kickHard(){
    if(kickingHard)return; kickingHard=true;
    try{
      const {data:sd,error:sdErr}=await sb.auth.getSession();
      if(!sd||!sd.session){ if(!authTransient(sdErr)) location.replace(LOGIN_PAGE); return; }
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
        if(isAuthRejection){ try{await sb.auth.signOut();}catch(e){} location.replace(LOGIN_PAGE); }
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
  // not while the tab is hidden - it is checked again the moment it is looked at (visibilitychange)
  setInterval(function(){ if(!document.hidden) kickHard(); }, 45000);
  kickHard();
}
sb.auth.onAuthStateChange((ev,session)=>{
  if(session&&session.access_token) USAGE_TOKEN=session.access_token;   // stays current across TOKEN_REFRESHED, not just the initial boot()
  /* TOKEN_REFRESHED only. supabase-js also reports SIGNED_IN when a tab comes back into view or a
     stored sign-in is recovered, carrying the SAME old token - an hour-old iat then read as a clock
     an hour fast, and the red bar came up on a PC whose clock was right (15 Oct 2026). Only a
     refresh is guaranteed to hand over a token issued this moment. */
  if(ev==='TOKEN_REFRESHED') checkClockSkew(session,true);
  if(ev==='SIGNED_OUT'){ bgForget(); location.replace(LOGIN_PAGE); } else if(ev==='PASSWORD_RECOVERY'){ if(typeof resetPasswordModal==='function') resetPasswordModal(); }
});

