/* ============================ BACKGROUND LOADING ============================
   Pages named in BG_TARGETS are kept ready while the viewer is elsewhere, so opening one shows it
   at once instead of waiting on the database.

   HOW. Every database read a target page makes while it is on screen is remembered (the request
   only - address, schema, filters - never the sign-in token, and never what came back), and its
   answer is kept in memory - so going Tasks -> Workflow -> Tasks shows Tasks again at once. As soon
   as ANY page is drawn (the Dashboard included), the other target pages' remembered reads are
   repeated straight away and their answers held too. When a target page is drawn, any read that
   matches one held exactly is answered from memory; anything else goes to the database as always.

   WHY IT CANNOT SHOW WRONG DATA FOR LONG, OR CHANGE ANY.
     - Only reads are ever repeated: plain table reads, and database functions on BG_READ_RPCS,
       every one of which Postgres itself marks read-only (STABLE) or is read-only by design.
     - An answer is only used within BG_TTL_MS of being fetched. After that the page asks the
       database as normal (and the next page drawn fetches it fresh in the background).
     - Any save, edit, delete or other non-read call made from this tab throws away everything held,
       so nothing fetched before a change can be shown after it.
     - Signing out forgets the remembered reads as well. */
const BG_NATIVE_FETCH=window.fetch.bind(window);
const BG_TTL_MS=30000;
const BG_MIN_GAP_MS=3000;                    // a burst of draws does not re-check the same page
/* Database functions that only read. All but the last two are every function in the app's schemas
   that Postgres itself marks STABLE or IMMUTABLE (taken from pg_proc on 2026-10-13) - Postgres
   refuses any write inside such a function, so answering one from memory can never skip a change.
   people and wf_case_page are VOLATILE in name only and read-only by design. A function missing
   from here is simply treated as a save: everything held is dropped, which is the safe direction. */
const BG_READ_RPCS=new Set(('_bu_company,_check_open,_doc_prefix,_eng_guard,_fy_start,_gst_lines,_guard_post,_key_label,_key_ledger,_po_guard,_ra_amounts,_retention_free,_rfq_guard,_stock_factor,_wf_equiv_check,_wf_flow_equiv_check,_wf_flow_rowlevel,_wf_rowlevel_check,_wf_smoke,acc_my_tasks,acc_scoreboard,acc_whoami,account_status,agent_can_use,agent_check_secret,brs,can,can_delegate,can_email_candidates,can_manage_tests,can_post,can_read,can_read_goal,can_see_task,can_write,cancellation_charge,client_ip,company_readiness,competitor_ad_counts,competitor_pull_status,cost_statement,crm_lead_count_in_range,crm_lead_detail,crm_num,crm_personnel_team,crm_pipeline_health_check,crm_presales_emails,crm_rank_status,crm_status_canon,crm_status_detail,crm_status_head,crm_status_level,crm_status_rank,crm_text,current_approver_info,current_customer_id,current_user_email,doc_dashboard,doc_search_snippets,doc_whoami,eligible_kpis,eng_activity_groups,eng_budget_actuals,eng_head_actuals,erp_usability_feature_user_events,erp_usability_feature_users,erp_usability_report,erp_usability_transcription_health,erp_usability_user_activity,erp_usability_workflow_health,erp_usability_workflow_stuck_steps,feature_on,fully_approved_batch,fv_fingerprint,fv_flat,fv_health,fv_label,fv_ledger_mismatches,fv_n,fv_norm,fv_project,fv_stage_hash,fv_truthy,fv_unit,fy_label,fy_of,get_zoho_secrets,has_module,hr_dashboard,hr_emails,hr_whoami,in_fn,in_task,interest_calc,interest_summary,interview_task_text,interviewable_candidates,interviews_info,is_admin,is_current_task_approver,is_customer,is_custportal_media_editor,is_custportal_staff,is_fully_approved,is_goal_member,is_hr_or_admin,is_module_admin,is_photo_approver,is_project_manager_for_unit,is_project_member,is_s3_staff,is_superadmin,is_task_parent_owner,ist_today,kraya_dashboard,kraya_stock,kraya_whoami,ledger_balance,ledger_statement,legal_ocr_progress,legal_ocr_remaining,list_custportal_staff,login_auth_user_for_email,login_customer_for_email,may_send_interview_rejection,me,media_place,media_unit_list,mis_fix_typos,mis_outstanding,mis_parse_date,module_role,monthly_months,monthly_view,my_pending_approvals,my_permissions,net_current_measurer,next_claimable_follow_up,nexus_whoami,open_positions,ops_weekly_items,ops_weekly_meetings,owns_goal,owns_project,payroll,peek_doc_no,position_slug,posting_counts,projects,public_position,public_positions,ra_bill_accounts,recur_days_for_month,recur_matches,recur_missed_date,recur_next,reimbursement_forward_batch,report_demand_collection,report_item_ledger,report_outstanding,report_stock_ageing,report_stock_summary,resolve_owner,resolve_project,retention_overview,retention_releases_view,s3_key_allowed,scoreboard,scoreboard_causelist,setting,slugify,sub_ledger_balances,submission_self_approves,support_ticket_is_mine,tasks_overview,total_storage_bytes,trc_calls_page,trc_distinct_filters,trc_leads_page,trc_scope_counts,trial_balance,unlinked_farvision_units,upi_scanner_get,usability_can_view,vtrend_anomalies,vtrend_asof,vtrend_business_units,vtrend_category_monthly,vtrend_monthly,vtrend_overview,vtrend_vendor_monthly_all,vtrend_vendor_summary,wf_active_count,wf_after_in_route,wf_can_create_flow,wf_can_see_case,wf_can_see_flow,wf_due,wf_file_referenced,wf_has_full_case_access,wf_has_full_flow_access,wf_is_admin_dept,wf_may_act_as,wf_my_case_ids,wf_new_instance_block_reason,wf_next_seq,wf_prev_seq,wf_proxy_principals,wf_proxy_task_ids,wf_task_desc,wf_task_desc_booking,wf_task_desc_invoice,wf_unseen_count,wf_visible_case_ids,wf_visible_flow_ids'
  +',people,wf_case_page').split(','));
/* Writes that cannot change anything a page shows: the usage log, which fires on most clicks in
   every module. Letting it drop everything held is what made Tasks load again after Documents. */
const BG_HARMLESS_WRITES=new Set(['erp_log_usage']);
let BG_REFILL_T=null;
/* WHICH PAGES ARE KEPT READY. Accountability's five tabs and each workflow's own page (Invoice
   Processing, Reimbursement, ...), and the landing page of CRM & Sales, Post Sales, Campaign
   Analytics, Competitor Ads, Transcription and Legal. Each only for someone who has that module
   (pageAllowed - the same check the sidebar uses): nobody's browser fetches a module they cannot
   open. Individual task, meeting and lead pages are left out: there are thousands of them and each
   is opened once. */
const BG_TARGETS=['tasks#/work','tasks#/calendar','tasks#/meetings','tasks#/workflow','tasks#/archive',
                  'crm#/','postsales#/','campaigns#/','competitors#/','transcription#/','legal#/'];
function bgIsTarget(route){ return BG_TARGETS.indexOf(route)!==-1 || /^tasks#\/workflow\/\d+$/.test(route); }
function bgAllowed(route){
  try{ return typeof pageAllowed==='function' && !!pageAllowed(String(route).split('#')[0]); }catch(_e){ return false; }
}
const BG_ALIASES={'tasks#/':'tasks#/work','tasks#/home':'tasks#/work'};
const BG_STORE_KEY='jaine_bg_reads_v1';
const BG_CACHE=new Map();                    // request -> {at, p} - memory only, never stored
const BG_LAST={};                            // route -> when it was last fetched in the background
let BG_ROUTE=null, BG_ROUTE_AT=0, BG_REC=[], BG_SAVE_T=null, BG_PREFETCH_T=null;
let BG_DRAW_AT=0;                            // when the page on screen started drawing

function bgHeaders(h){
  const out={}; if(!h) return out;
  if(typeof Headers!=='undefined' && h instanceof Headers){ h.forEach(function(v,k){ out[k.toLowerCase()]=v; }); }
  else if(Array.isArray(h)){ h.forEach(function(p){ out[String(p[0]).toLowerCase()]=p[1]; }); }
  else Object.keys(h).forEach(function(k){ out[k.toLowerCase()]=h[k]; });
  return out;
}
function bgReq(input, init){
  return { url:(typeof input==='string')?input:((input&&input.url)||String(input)),
           method:String((init&&init.method)||(input&&input.method)||'GET').toUpperCase(),
           headers:bgHeaders((init&&init.headers)||(input&&input.headers)),
           body:(init&&typeof init.body==='string')?init.body:null };
}
function bgIsRead(r){
  if(r.method==='GET'||r.method==='HEAD') return true;
  const m=r.url.match(/\/rest\/v1\/rpc\/([A-Za-z0-9_]+)/);
  return r.method==='POST' && !!m && BG_READ_RPCS.has(m[1]);
}
// Two requests are the same read only if every part that shapes the answer matches.
function bgKey(r){
  const h=r.headers;
  return [r.method, r.url, h['accept-profile']||'', h['content-profile']||'', h['prefer']||'', h['range']||'', h['accept']||'', r.body||''].join('\n');
}
function bgResponse(s){
  const empty=(s.status===204||s.status===304||!s.body);
  return new Response(empty?null:s.body.slice(0), {status:s.status, statusText:s.statusText, headers:s.headers});
}
function bgRouteNow(){
  const k=PAGE+'#/'+String(location.hash||'').replace(/^#\/?/,'');
  return BG_ALIASES[k]||k;
}
function bgLoadReads(){
  try{
    const o=JSON.parse(localStorage.getItem(BG_STORE_KEY)||'null');
    if(o && o.owner===String(state.email||'').toLowerCase() && o.routes) return o.routes;
  }catch(_e){}
  return {};
}
function bgSaveRoute(route, list){
  if(!route || !list.length || !state.email) return;
  // most recent last; past 16 pages the longest-unvisited workflow pages are forgotten
  const routes=bgLoadReads(); delete routes[route]; routes[route]=list;
  const keys=Object.keys(routes);
  for(let i=0; keys.length-i>24 && i<keys.length; i++){ if(BG_TARGETS.indexOf(keys[i])===-1) delete routes[keys[i]]; }
  try{ localStorage.setItem(BG_STORE_KEY, JSON.stringify({owner:String(state.email).toLowerCase(), routes:routes})); }catch(_e){}
}
function bgSaveReads(){
  clearTimeout(BG_SAVE_T);
  const route=BG_ROUTE, list=BG_REC.slice();
  BG_SAVE_T=setTimeout(function(){ bgSaveRoute(route, list); }, 1500);
}
function bgReadEntry(r){ const h=Object.assign({}, r.headers); delete h.authorization; return {u:r.url, m:r.method, h:h, b:r.body}; }
// Remembers the reads a target page makes in the few seconds after it is drawn.
function bgRecord(r){
  if(!BG_ROUTE || Date.now()-BG_ROUTE_AT>8000 || BG_REC.length>=60) return;
  BG_REC.push(bgReadEntry(r));
  bgSaveReads();
}
/* WARMING A PAGE THAT IS NOT ON SCREEN. fn() makes exactly the reads that page makes when it opens
   (Accountability passes each workflow's own loading function - nothing is drawn); while it runs,
   every read is kept in memory AND remembered under that page's route, so from then on it is kept
   ready like any page that has been visited. One page at a time - see wfWarmAll. */
let BG_CAPTURE=null;
async function bgCapture(route, fn){
  if(document.hidden || !state.email || state.isCustomer || state.impersonating) return null;
  const cap={route:route, rec:[], until:Date.now()+15000};
  BG_CAPTURE=cap;
  try{ return await fn(); }
  finally{
    if(BG_CAPTURE===cap) BG_CAPTURE=null;
    if(cap.rec.length) bgSaveRoute(route, cap.rec.slice(0,60));
    BG_LAST[route]=Date.now();
  }
}
window.bgCapture=bgCapture;
/* A rate-limited token refresh is "try again shortly", not "your sign-in is over" - but supabase-js
   only treats 5xx answers that way, and on a 429 it deletes the stored session, which every open
   JainE page then reads as a sign-out. Reported to it as 503 instead, it keeps the session, backs off
   and tries again later (see authTransient in the auth code). */
function bgAuthFetch(input, init){
  return BG_NATIVE_FETCH(input, init).then(function(res){
    if(res.status!==429) return res;
    console.warn('[auth] token refresh rate-limited (429) - kept the session, will retry');
    return new Response(null, {status:503, statusText:'Rate limited (429)', headers:res.headers});
  });
}
function bgFetch(input, init){
  let r; try{ r=bgReq(input, init); }catch(_e){ return BG_NATIVE_FETCH(input, init); }
  if(r.url.indexOf(SUPABASE_URL+'/auth/v1/token')===0) return bgAuthFetch(input, init);
  const isApi=r.url.indexOf(SUPABASE_URL+'/rest/v1/')===0 || r.url.indexOf(SUPABASE_URL+'/functions/v1/')===0;
  if(!isApi) return BG_NATIVE_FETCH(input, init);
  // anything that is not a read may change what a held answer says - drop them all
  if(!bgIsRead(r)){
    const fn=(r.url.match(/\/rest\/v1\/rpc\/([A-Za-z0-9_]+)/)||[])[1];
    if(fn && BG_HARMLESS_WRITES.has(fn)) return BG_NATIVE_FETCH(input, init);
    BG_CACHE.clear();
    /* ...and once the save has settled, get the pages ready again - fresh, so they show the change
       and are instant again rather than waiting for the next page draw to notice. */
    clearTimeout(BG_REFILL_T);
    BG_REFILL_T=setTimeout(function(){ for(const k in BG_LAST) delete BG_LAST[k]; bgPrefetchOthers(); }, 1500);
    return BG_NATIVE_FETCH(input, init);
  }
  const cap=(BG_CAPTURE && Date.now()<BG_CAPTURE.until) ? BG_CAPTURE : null;
  if(cap) cap.rec.push(bgReadEntry(r)); else bgRecord(r);
  const k=bgKey(r), hit=BG_CACHE.get(k);
  /* Held answers are for a page that is being DRAWN - its first few seconds. A page that keeps
     checking afterwards (a transcript being waited on, a live status) always reaches the database. */
  if(hit && Date.now()-hit.at < BG_TTL_MS && Date.now()-BG_DRAW_AT < 4000){
    return hit.p.then(function(s){ return (s.status>=200&&s.status<300) ? bgResponse(s) : BG_NATIVE_FETCH(input, init); },
                      function(){ return BG_NATIVE_FETCH(input, init); });
  }
  if(hit) BG_CACHE.delete(k);                  // too old to show
  const live=BG_NATIVE_FETCH(input, init);
  // a target page's own reads are kept as they arrive, so coming back to it is instant
  if(cap || (BG_ROUTE && Date.now()-BG_ROUTE_AT<=8000)){
    const held=live.then(function(res){ const c=res.clone(); return c.arrayBuffer().then(function(b){
      return {status:res.status, statusText:res.statusText, headers:Array.from(c.headers.entries()), body:b}; }); });
    held.catch(function(){});
    BG_CACHE.set(k, {at:Date.now(), p:held});
  }
  return live;
}
// Repeats a target page's remembered reads and holds the answers.
async function bgPrefetch(route){
  if(document.hidden || state.isCustomer || state.impersonating) return;
  if(!bgAllowed(route)) return;                // not their module: never fetched
  if(Date.now()-(BG_LAST[route]||0) < BG_MIN_GAP_MS) return;
  const list=bgLoadReads()[route]; if(!list || !list.length) return;
  BG_LAST[route]=Date.now();
  /* The token the auth listener already holds. Asking getSession() here meant one more chance to
     refresh per page kept ready - a dozen per page draw - which on a PC with a wrong clock was most
     of the refresh storm that got people signed out. */
  let token=(typeof USAGE_TOKEN!=='undefined' && USAGE_TOKEN) || null;
  if(!token){ try{ const {data}=await sb.auth.getSession(); token=data&&data.session&&data.session.access_token; }catch(_e){} }
  if(!token) return;
  const sent=[];
  list.forEach(function(q){
    const k=bgKey({url:q.u, method:q.m, headers:q.h, body:q.b});
    // re-fetched once it is 20 s old, so a fresh answer replaces it before it expires at 30 s
    const held=BG_CACHE.get(k); if(held && Date.now()-held.at < BG_TTL_MS-10000) return;
    const p=BG_NATIVE_FETCH(q.u, {method:q.m, headers:Object.assign({}, q.h, {authorization:'Bearer '+token}), body:q.b||undefined})
      .then(function(res){ return res.arrayBuffer().then(function(b){
        return {status:res.status, statusText:res.statusText, headers:Array.from(res.headers.entries()), body:b}; }); });
    p.catch(function(){});
    BG_CACHE.set(k, {at:Date.now(), p:p});
    sent.push(p);
  });
  // resolves once this page's reads are all back, so the next page waits its turn (bgPrefetchOthers)
  await Promise.all(sent.map(function(p){ return p.catch(function(){}); }));
}
// Called on every draw: starts remembering if this is a target page, and straight away gets the
// OTHER target pages ready - from the Dashboard on, so they are waiting before they are opened.
function bgOnRender(){
  const route=bgRouteNow();
  BG_ROUTE=bgIsTarget(route)?route:null; BG_ROUTE_AT=Date.now(); BG_REC=[];
  BG_DRAW_AT=Date.now();
  clearTimeout(BG_PREFETCH_T);
  BG_PREFETCH_T=setTimeout(bgPrefetchOthers, 0);
}
/* The five tabs, plus every workflow page this person has opened before. The timed refresh below
   passes tabsOnly: workflow pages are kept ready when a page is drawn, not every 25 s. */
/* Refreshed every 25 s: Tasks and the Workflow list only. All five tabs together came to ~64 reads
   a round - about 2.5 a second per person with JainE open - which is more load than the gain is
   worth on the database's size; the other tabs are still made ready whenever any page is drawn. */
const BG_KEEP_WARM=['tasks#/work','tasks#/workflow'];
/* ONE PAGE AT A TIME. With six more modules a person can have a dozen pages kept ready; sending
   all of their reads at once would put a burst of a few hundred requests on the database on every
   page draw. Each page's reads go out together, and the next page waits until they are back. */
let BG_QUEUE_BUSY=false, BG_QUEUE_AGAIN=false;
async function bgPrefetchOthers(tabsOnly){
  bgWarmScripts();
  if(BG_QUEUE_BUSY){ BG_QUEUE_AGAIN=true; return; }
  BG_QUEUE_BUSY=true;
  try{
    do{
      BG_QUEUE_AGAIN=false;
      const here=bgRouteNow();
      const routes=(tabsOnly===true) ? BG_KEEP_WARM.slice() : BG_TARGETS.slice();
      if(tabsOnly!==true) Object.keys(bgLoadReads()).forEach(function(r){ if(bgIsTarget(r) && routes.indexOf(r)===-1) routes.push(r); });
      for(const t of routes){
        if(t===here || !bgAllowed(t)) continue;
        try{ await bgPrefetch(t); }catch(_e){}
      }
      tabsOnly=false;
    } while(BG_QUEUE_AGAIN);
  } finally { BG_QUEUE_BUSY=false; }
}
/* A target page in another module also needs that module's own script (accountability.js for
   Tasks and Workflow, ~1 MB) before it can draw, and the first in-place visit used to wait for the
   download. It is fetched ahead too - DOWNLOADED only, into the browser's cache at exactly the
   address loadPageScript will ask for; nothing is run until the page is actually opened. */
function bgWarmScripts(){
  if(document.hidden) return;
  BG_TARGETS.forEach(function(t){
    if(!bgAllowed(t)) return;                  // only the code of modules this person can open
    const entry=PAGE_EXTRA_SCRIPT[t.split('#')[0]]; if(!entry) return;
    [].concat(entry).forEach(function(src){
      if(_loadedPageScripts.has(src)) return;
      const already=[].slice.call(document.scripts).some(function(s){ return (s.getAttribute('src')||'').split('?')[0]===src; });
      if(already) return;
      const href=src+'?v='+(PAGE_SCRIPT_VERSION[src]||'20261003a');
      if(document.querySelector('link[rel="prefetch"][href="'+href+'"]')) return;
      const l=document.createElement('link'); l.rel='prefetch'; l.as='script'; l.href=href;
      document.head.appendChild(l);
    });
  });
}
// A page that opened in a background tab skipped this; do it when the tab is actually looked at.
document.addEventListener('visibilitychange', function(){ if(!document.hidden) bgPrefetchOthers(); });
/* KEPT READY WHILE YOU ARE ELSEWHERE. Answers expire after 30 s, so someone who spent a minute in
   another module came back to a normal load. Every 25 s - only while JainE is open, visible and
   signed in - Tasks and the Workflow list (whichever is not on screen) are fetched again, so they
   are always ready and never more than about 25 s old. */
setInterval(function(){
  if(document.hidden || !state.email || state.isCustomer || state.impersonating) return;
  for(const k in BG_LAST) delete BG_LAST[k];
  bgPrefetchOthers(true);
}, 25000);
function bgForget(){ BG_CACHE.clear(); try{ localStorage.removeItem(BG_STORE_KEY); }catch(_e){} }

const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{global:{fetch:bgFetch}});
const $=id=>document.getElementById(id);
const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
const esc=s=>(s==null?'':String(s)).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
/* For a value being dropped INSIDE a single-quoted JS string in an onclick attribute, which esc()
   alone cannot make safe: it escapes & < > " and deliberately leaves the apostrophe alone, because
   an apostrophe is harmless in HTML text. Inside onclick="f('...')" it is not harmless - it closes
   the string early and the whole handler becomes a syntax error, so the click silently does
   nothing. Real feature names hit this: "Open a day's agenda panel", "View a department's library",
   "View a lead's combined call history".
   Order matters. The backslash goes in FIRST, for the JS parser, and only then esc() for the HTML
   parser - the other way round would HTML-encode the apostrophe to &#39;, which the browser decodes
   back to a bare ' before the JS is ever parsed, leaving the bug exactly where it was. */
const escJs=s=>esc(String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"));

