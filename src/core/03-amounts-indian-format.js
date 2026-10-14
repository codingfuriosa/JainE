/* ============================ AMOUNTS, GROUPED THE INDIAN WAY ============================
   Every field somebody types money into shows 12,34,567.89 as they type — last three digits,
   then pairs.

   WHY THE FIELDS HAD TO STOP BEING type="number". A number input cannot hold a comma: the browser
   rejects the character and, worse, silently reports an empty value for anything it considers
   invalid. So a money field is text with inputmode="decimal", which still brings up the numeric
   keypad on a phone but lets us control what is displayed.

   THE DANGEROUS HALF IS READING IT BACK. The moment a field can contain "12,34,567", every
   Number()/parseFloat() in a save path turns it into NaN — silently, on financial data. So the
   grouping is only ever applied to inputs this code has marked, and the handful of shared value
   readers (purchase.js val, engineering.js val/numOrNull, accounts.js num) strip commas. Nothing
   is formatted that is not also read back through one of those.

   moneyStrip is exported deliberately: anything that reads a money field's .value directly should
   call it rather than inventing another replace(/,/g,''). */
const moneyStrip=s=>String(s==null?'':s).replace(/,/g,'');
/* Groups the INTEGER part only, and leaves everything else exactly as typed — a trailing "."
   while somebody is mid-number, a half-typed decimal, a leading minus. Formatting as you type is
   only tolerable if it never fights the typing. */
function inrGroup(s){
  s=String(s==null?'':s);
  const neg=/^-/.test(s.trim());
  let v=moneyStrip(s).replace(/[^\d.]/g,'');
  const dot=v.indexOf('.');
  let ip=dot<0?v:v.slice(0,dot), fp=dot<0?'':v.slice(dot+1);
  ip=ip.replace(/^0+(?=\d)/,'');
  if(ip.length>3){
    const last3=ip.slice(-3);
    const rest=ip.slice(0,-3).replace(/\B(?=(\d{2})+(?!\d))/g,',');
    ip=rest+','+last3;
  }
  return (neg?'-':'')+ip+(dot<0?'':'.'+fp);
}
/* Reformats as the person types without the caret jumping to the end — the thing that makes most
   as-you-type formatting unusable. Counts the digits before the caret, rewrites, then puts the
   caret back after that same number of digits. */
function moneyFormatEl(el){
  if(!el||el.dataset.money!=='1')return;
  const before=el.value, pos=el.selectionStart==null?before.length:el.selectionStart;
  const digitsBefore=moneyStrip(before.slice(0,pos)).replace(/[^\d.-]/g,'').length;
  const after=inrGroup(before);
  if(after===before)return;
  el.value=after;
  let seen=0,i=0;
  for(;i<after.length&&seen<digitsBefore;i++){ if(after[i]!==',')seen++; }
  try{ el.setSelectionRange(i,i); }catch(e){}
}
/* Turns the money fields inside `root` into grouped text inputs, once each.
   WHICH FIELDS: anything already marked data-money, plus number inputs stepping in hundredths —
   which across this app is how money is written and quantities (step 0.001) are not. Percentages
   also step in hundredths and are swept up, which is harmless: no percentage reaches four digits,
   so no comma ever appears in one. */
function moneyUpgrade(root){
  const scope=root&&root.querySelectorAll?root:document;
  let list=[];
  try{ list=scope.querySelectorAll('input[data-money="1"]:not([data-money-ready]),input[type="number"][step="0.01"],input.n[inputmode="decimal"]:not([data-money-ready])'); }
  catch(e){ return; }
  [].slice.call(list).forEach(function(el){
    if(el.dataset.moneyReady==='1')return;
    if(el.type==='number'){ try{ el.type='text'; }catch(e){ return; } el.setAttribute('inputmode','decimal'); }
    el.dataset.money='1'; el.dataset.moneyReady='1';
    if(el.value!=='')el.value=inrGroup(el.value);
  });
}
/* One delegated listener for the whole app rather than a listener per field: money inputs are
   drawn inside modals that are rebuilt constantly, and per-field listeners leak with them. */
document.addEventListener('input',function(e){
  const el=e.target;
  if(el&&el.tagName==='INPUT'&&el.dataset&&el.dataset.money==='1')moneyFormatEl(el);
},true);
/* Fields appear whenever a view or a modal draws, which happens from dozens of places. Watching
   the DOM catches all of them without every caller having to remember to ask. */
try{
  new MutationObserver(function(muts){
    for(const m of muts){ if(m.addedNodes&&m.addedNodes.length){ moneyUpgrade(document); return; } }
  }).observe(document.documentElement,{childList:true,subtree:true});
}catch(e){}
const state={user:null,email:null,profile:null,roles:null,super:false};
// The access token, kept current from boot() and every onAuthStateChange firing. Usage telemetry's
// unload-time flush needs it synchronously (a pagehide handler can't safely await getSession()) —
// declared up here, by state, rather than down by the telemetry code that's its only reader, so
// boot() setting it doesn't read as a forward reference to something declared hundreds of lines later.
let USAGE_TOKEN=null;
// Mutable (not const): the App Shell reassigns this on an in-place cross-module navigation instead
// of loading a different .html document — see navTo()/activateModule() below. A direct load or
// refresh still sets it once from window.PAGE exactly as before; nothing about that path changes.
let PAGE=window.PAGE||'dashboard';
// A customer session never signs in through login.html and must never be sent back to it — see
// the customer-detection block in boot() below and the isolation-retrofit migration. Computed once
// here rather than read live off PAGE: a real customer session's own nav (renderCustomerShell(),
// navTo('customer/'+i)) never leaves PAGE==='customer' via activateModule(), so this can't go stale.
const LOGIN_PAGE=(PAGE==='customer')?'customer-login.html':'login.html';
function fileFor(id){if(id==='dashboard')return 'index.html';if(id==='tasks')return 'accountability.html';if(id==='custportal_admin')return 'custportal-admin.html';return id+'.html';}
// Reverse of fileFor(): which module id does a given pathname's filename belong to. Used by
// popstate (browser Back/Forward across modules) to recover PAGE from the URL alone.
function pageIdFromPath(pathname){
  const file=(pathname.split('/').pop()||'index.html');
  if(file==='index.html'||file==='')return 'dashboard';
  if(file==='accountability.html')return 'tasks';
  if(file==='custportal-admin.html')return 'custportal_admin';
  return file.replace(/\.html$/,'');
}
// Page-specific scripts that used to be a second <script> tag on that one .html file, loaded in
// parallel with nexus-core.js (see accountability.js's own "loads after nexus-core.js" comment, and
// the legacy-view race it guards against in VIEWS.tasks below). An in-place SPA navigation to one of
// these needs the same script loaded on demand, once, before rendering — never re-fetched on a
// second visit in the same tab.
// A page may list several scripts; they load one after another, in order (purchase-indent.js uses what
// purchase.js defines).
const PAGE_EXTRA_SCRIPT={tasks:'accountability.js',inspection:'insp-items.js',postsales:'postsales.js',inventory:['purchase.js','purchase-indent.js','purchase-rfq.js','purchase-po.js','purchase-stores.js','purchase-reports.js'],accounts:['accounts.js','accounts-bank.js','accounts-books.js'],scheduling:'scheduling.js'};
/* EVERY PAGE SCRIPT NEEDS A VERSION HERE, not just the purchase ones.
   accountability.js, insp-items.js and postsales.js were missing, so loadPageScript fell back
   to the default '20261003a' - and _headers tells the browser a .js URL is immutable for a
   year. Anyone who had opened Post Sales or Tasks since 3 October was pinned to that copy and
   saw none of the changes since, while someone landing on postsales.html directly got
   postsales.js?v=20261214 from its own script tag - a DIFFERENT url, a different cached file.
   Two people on the same build could see two different apps, which is exactly what "for some
   it is still the same" was. Both spellings are bumped together from now on. */
const PAGE_SCRIPT_VERSION={'accountability.js':'20261009a','insp-items.js':'x','postsales.js':'20261009a','scheduling.js':'20261007a','accounts.js':'20261005g','accounts-bank.js':'20261005b','accounts-books.js':'20261005d','purchase.js':'20261009a','purchase-indent.js':'20261006a','purchase-rfq.js':'20261005a','purchase-po.js':'20261006b','purchase-stores.js':'20261006b','purchase-reports.js':'20261006a'};
const _loadedPageScripts=new Set();
function ensurePageScript(id){
  const entry=PAGE_EXTRA_SCRIPT[id];
  if(!entry)return Promise.resolve();
  return [].concat(entry).reduce((p,src)=>p.then(()=>loadPageScript(src)),Promise.resolve());
}
function loadPageScript(src){
  if(_loadedPageScripts.has(src))return Promise.resolve();
  /* A PAGE MAY ALREADY CARRY THE SCRIPT AS A PLAIN TAG, AND postsales.html DOES.
     _loadedPageScripts only knows about the ones loaded from here, so on that page this appended
     a second copy and the browser ran the file twice. The second run hits the first top-level
     `const` and dies with "Identifier has already been declared" - the module half-initialises,
     the console fills with an error nobody put there, and whatever ran before the throw ran
     twice. Checking the document for the file settles it whichever way it arrived. */
  const already=[].slice.call(document.scripts).some(function(s){
    const u=(s.getAttribute('src')||'').split('?')[0];
    return u===src||u.endsWith('/'+src);
  });
  if(already){ _loadedPageScripts.add(src); return Promise.resolve(); }
  return new Promise((resolve)=>{
    const s=document.createElement('script');
    /* Bump this whenever accountability.js or insp-items.js changes, the same way the pages bump
       nexus-core.js. It had sat at 20260913c while thirty-five commits landed in
       accountability.js — every one of them invisible to a browser holding that URL. */
    s.src=src+'?v='+(PAGE_SCRIPT_VERSION[src]||'20261003a');
    s.onload=()=>{_loadedPageScripts.add(src);resolve();};
    // A failed load shouldn't hang navigation forever — render with whatever's already there
    // (the legacy VIEWS.tasks placeholder already has its own "could not finish loading" message
    // for exactly this case) rather than block the rest of the app on one missing file.
    s.onerror=()=>resolve();
    document.body.appendChild(s);
  });
}
// The in-place cross-module transition: swap PAGE, load that module's extra script if it has one,
// update the tab title (no new document is loaded, so nothing else will), then render. Called from
// navTo() for a sidebar click and from popstate for Back/Forward across modules.
async function activateModule(id){
  // Arriving at Transcription from a DIFFERENT module - not a reload of it, not an in-tab filter
  // change, both of which never call this function at all - so this is the one place "just came back
  // from elsewhere" is visible, and the one place that should reset it to its defaults. See TRC_F.
  if(id==='transcription'&&PAGE!=='transcription'&&typeof trcResetFilters==='function')trcResetFilters();
  PAGE=id; window.PAGE=id;
  await ensurePageScript(id);
  document.title=(LABELS[id]||id)+' · Nexus-RE · Jain Group';
  renderPage();
}
/* ONE DRAW PER NAVIGATION. Changing location.hash fires BOTH popstate and hashchange, and navTo()
   also draws the page itself straight after setting it - so every in-module click drew the page
   three times, and every plain hash change twice, each draw firing all of that page's requests
   again (the Tasks page sent ~37 where ~13 were needed). renderPage() records the hash it drew;
   the two events skip a hash that is already on screen. Back/Forward to a different hash still
   draws, because that hash is not the one recorded. */
let LAST_RENDER_HASH=null;
window.addEventListener('popstate',function(){
  const id=pageIdFromPath(location.pathname);
  if(id!==PAGE){ activateModule(id); }
  else if(location.hash!==LAST_RENDER_HASH){ renderPage(); }
});
/* Move to a hash on this page and draw it exactly once. Setting location.hash already draws it -
   Chrome fires popstate synchronously, and hashchange follows - so drawing again straight after
   was the second of every in-module click's two draws. Only when the hash did not change (a tab
   clicked again, a view refreshing itself) does nothing else draw it, so that case draws here. */
function showHash(h){
  const before=location.hash;
  location.hash=h;
  if(location.hash===before || location.hash!==LAST_RENDER_HASH) renderPage();
}
window.showHash=showHash;
function navTo(path){
  const seg=String(path).split('/');
  const first=seg[0];
  const hash=seg.length>1?('#/'+seg.slice(1).join('/')):'';
  if(first===PAGE){ showHash(hash||'#/'); return; }
  // Customer sessions (and an admin previewing one) never have a sidebar item for another module
  // to begin with, but navTo() is also called from things like breadcrumbs — staying on the current
  // real document for a customer session is the one case still worth a true navigation rather than
  // an in-place swap, since renderCustomerShell() is a different shell entirely from renderShell().
  if(state.isCustomer||state.impersonating){ location.href=fileFor(first)+hash; return; }
  try{ history.pushState({spaPageId:first},'',fileFor(first)+hash); }catch(e){ location.href=fileFor(first)+hash; return; }
  activateModule(first);
}
window.navTo=navTo;
function goToTask(id){ const dd=$('notifDd'); if(dd)dd.classList.remove('show'); if(PAGE==='tasks'){showHash('#/task/'+id);} else navTo('tasks/task/'+id); }

