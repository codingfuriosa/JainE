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
/* WHERE "BACK" ACTUALLY GOES.

   Back buttons used to carry a hard-coded destination - a meeting log sent you to that meeting's
   occurrence list however you had arrived, so reaching it from Archive and pressing Back put you
   somewhere you had never been. Each one was a guess about the single route somebody might have
   come from.

   This keeps the real trail instead. Every route the app renders is recorded, and goBack() walks
   it, so Back means the page you were actually on.

   WHY NOT history.back(). The browser's history is the whole TAB's, not the app's: it holds the
   inbox the customer clicked a deep link from, and the search results before that. history.back()
   from the first JAIN-E page a person lands on takes them out of JAIN-E entirely, and
   history.length > 1 cannot tell the two cases apart - it is already 2 on arrival from anywhere.
   Walking our own trail can only ever land on a page inside the app, and falls back to a stated
   route when there is nothing behind.

   Repeated renders of the same route (an async view repainting itself) are not pushed twice, or
   Back would appear to do nothing. */
const NAV_TRAIL=[];
function navRecord(route){
  if(!route) return;
  if(NAV_TRAIL[NAV_TRAIL.length-1]===route) return;
  NAV_TRAIL.push(route);
  if(NAV_TRAIL.length>60) NAV_TRAIL.shift();
}
/* fallback is where to go when this is the first page of the visit - a deep link opened from an
   email, or a fresh tab. Every caller passes the route that page sits under. */
window.goBack=function(fallback){
  NAV_TRAIL.pop();                     // the page we are on
  const prev=NAV_TRAIL.pop();          // the one before it; navTo re-records it
  navTo(prev||fallback||'dashboard');
};
function renderPage(){
  LAST_RENDER_HASH=location.hash;
  try{ bgOnRender(); }catch(_e){}            // background loading - see BG_TARGETS at the top
  let seg=location.hash.replace(/^#\/?/,'').split('/').filter(Boolean);
  if(seg[0]===PAGE)seg=seg.slice(1);
  navRecord(PAGE+(seg.length?'/'+seg.join('/'):''));
  setActive(PAGE);
  const v=$('view');
  if(!pageAllowed(PAGE)){ return noAccess(v); }
  const fn=VIEWS[PAGE]||VIEWS.placeholder;
  fn(v,seg);
  refreshNotifState();
}
function route(){renderPage();}
window.addEventListener('hashchange',function(){ if(location.hash!==LAST_RENDER_HASH) renderPage(); });
// Whenever a tab bar's active tab changes (a fresh page render, or a view re-rendering just its own
// tabs after an async fetch), scroll that tab into view within its own horizontally-scrolling row -
// otherwise a page with enough tabs to overflow (e.g. Campaign Analytics' source/period sub-tabs)
// leaves the active one wherever the row was last scrolled to, sometimes off-screen with no visual
// sign which tab is actually selected. Runs off a MutationObserver rather than only at navigation
// time because several views replace just their own tab row's innerHTML after loading data, not the
// whole page. (Customer Portal's sections moved to the sidebar and no longer use this row at all.)
(function(){
  const viewEl=document.getElementById('view');
  if(!viewEl)return;
  /* Moves the tab row's OWN horizontal scroll and nothing else. This used to be a scrollIntoView
     with block:'nearest', which is not the vertical no-op it reads as: for an element outside the
     viewport, "nearest" scrolls every scrollable ancestor - the page included - by the minimum
     needed to reveal it. So on any view scrolled down away from its tabs (Transcription landing on
     a deep-linked SL NO row, say), bringing the active tab "into view" meant yanking the whole page
     back to the top, silently undoing the scroll the view had just done. A MutationObserver
     callback lands as a microtask immediately after the render that queued it, so it won that race
     every time, from code the view itself could not see. */
  const scrollActiveTabIntoView=function(){
    const active=viewEl.querySelector('.tabs .tab.active');
    if(!active)return;
    const row=active.closest('.tabs');
    if(!row||row.scrollWidth<=row.clientWidth)return;   // not overflowing: nothing to reveal
    const r=row.getBoundingClientRect(),a=active.getBoundingClientRect();
    if(a.left<r.left)        row.scrollLeft-=(r.left-a.left);
    else if(a.right>r.right) row.scrollLeft+=(a.right-r.right);
  };
  // No setTimeout/rAF wrapper needed - MutationObserver already batches a burst of DOM changes
  // (e.g. rendering a whole page) into one callback call, so calling straight from it still fires
  // once per render, not once per node. (rAF was tried here first and verified to sometimes never
  // fire at all for a backgrounded tab - direct is both simpler and more reliable.)
  new MutationObserver(scrollActiveTabIntoView).observe(viewEl,{childList:true,subtree:true});
})();

