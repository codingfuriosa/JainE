/* ============================================================ CRM SNAPSHOT QA
   The lead-wise view over the crm-snapshot-qa pipeline. Reads acc.followup_timeline_v, which is one
   row per FOLLOW-UP with its transcript and its QA joined on - so the CRM's own history, what was
   actually said, and where the two disagree all arrive together and cannot drift apart.

   WHY THIS EXISTS ALONGSIDE THE tra* VIEW BELOW. The tra* code reads acc.transcriptions, one row per
   LEAD with earlier calls folded into a JSON column. That shape came from a CRM feed that sent one
   row per call. The feed now sends one object per lead with its complete `history` array, and the
   pipeline stores every follow-up as its own durable row - so a lead's twelfth conversation is a row,
   not an entry inside a blob, and a recording that was already transcribed is reused rather than
   paid for twice while STILL appearing in the lead's history. Nothing here writes; the old view and
   its tabs are untouched and still serve every row imported before the changeover. */

const TRC_MISMATCH = {
  lost_should_not_have_been_lost: {
    label: 'Lost that should not have been Lost', short: 'Should not be Lost',
    tag: 't-red', icon: 'fa-door-open', colour: '#dc2626',
    blurb: 'The CRM marked the follow-up Lost, but the call reads as a lead that is still live. Re-open it.' },
  qualified_should_not_have_been_qualified: {
    label: 'Qualified that should not have been Qualified', short: 'Should not be Qualified',
    tag: 't-amber', icon: 'fa-circle-question', colour: '#d97706',
    blurb: 'The CRM marked the follow-up Qualified, but the conversation does not carry the evidence to qualify it.' },
  in_followup_should_have_been_lost: {
    label: 'In Follow Up that should have been Lost', short: 'Should be Lost',
    tag: 't-red', icon: 'fa-phone-slash', colour: '#dc2626',
    blurb: 'The CRM is still chasing this lead, but on the call the customer closed the door.' },
  in_followup_should_have_been_qualified: {
    label: 'In Follow Up that should have been Qualified', short: 'Should be Qualified',
    tag: 't-green', icon: 'fa-circle-up', colour: '#16a34a',
    blurb: 'The CRM has this lead in follow-up, but the call already meets the qualification test. Move it on.' }
};
const TRC_MISMATCH_KEYS = Object.keys(TRC_MISMATCH);

/* Every accuracy field in the QA result uses this same four-word vocabulary, so one map colours all
   of them and a new value shows up as itself rather than silently grey. */
const TRC_ACC_TAG = {
  'Accurate': 't-green', 'Partially Accurate': 't-amber',
  'Inaccurate': 't-red', 'Not Applicable': 't-gray'
};
const TRC_TR_META = {
  completed:         {label:'Transcribed',      tag:'t-green', icon:'fa-circle-check'},
  non_transcribable: {label:'No conversation',  tag:'t-gray',  icon:'fa-volume-xmark'},
  failed:            {label:'Transcription failed', tag:'t-red', icon:'fa-circle-exclamation'},
  not_transcribed:   {label:'Waiting',          tag:'t-amber', icon:'fa-clock'},
  no_recording:      {label:'No recording',     tag:'t-gray',  icon:'fa-phone-slash'},
  out_of_scope:      {label:'Not in scope',     tag:'t-gray',  icon:'fa-user-slash'}
};

/* NOT EVERY CALL IS QUEUED - crm_build_queue queues a lead's recorded calls for a snapshot only when
   that lead had at least one Pre-Sales call that day; a lead contacted by Sales alone that day queues
   nothing at all. (A lead contacted by BOTH gets every recorded call queued, Sales included - so
   personnel_team alone no longer says whether a call was in scope, only queue_status does.)
   The view has no way to say "never queued": a recording with no transcript yet reports
   'not_transcribed' regardless of why, which this page draws as an amber "Waiting". For a call that
   was genuinely never queued that is wrong - it is not waiting for anything and never will be, so it
   would sit in the day's backlog for ever and make every day look unfinished. queue_status is what
   tells the two apart: a queued call (whatever its team) always has a row in transcription_queue, so
   queue_status is set; a call that was never queued has none. Out of scope is counted separately from
   the real backlog.
   A Sales call transcribed BEFORE the queue existed, or riding along on a qualifying lead, keeps its
   own real status - those are left exactly as they are, transcript, QA and all. */
function trcTrStatus(r){
  if(!r)return '';
  const st=String(r.transcription_status||'');
  return (st==='not_transcribed'&&!r.queue_status) ? 'out_of_scope' : st;
}
/* trcTrStatus alone misses a whole class of failure: a call whose TRANSCRIPT completed fine but whose
   QA judge call then failed keeps transcription_status:'completed', so trcTrStatus reads it as a
   plain success - the QA failure only shows up in r.queue_status (transcription_queue.status, set to
   'failed' with fail_phase 'qa' either way, see crm-snapshot-qa/index.ts). Anything that needs "did
   this recording actually finish clean" - the Failed filter/count and the retry button below - has to
   check both, or a QA failure is invisible everywhere except the one lead's own detail card. */
function trcProcFailed(r){
  return !!(r && (trcTrStatus(r)==='failed' || r.queue_status==='failed'));
}
/* Retry is offered for every Waiting call, for a recording that failed, and for one queued/unfinished
   (transcribed but its QA never ran). A Waiting call the API flagged eligible but the queue build never
   picked up has no queue_status yet - the retry creates its queue row, so it gets the button too. */
function trcCanRetry(r){
  if(!r||!r.recording_url&&!r.has_recording&&!r.queue_status)return false;
  if(trcProcFailed(r))return true;
  if(['pending','transcribing','qa_pending','qa_running'].indexOf(String(r.queue_status||''))>=0)return true;
  return !!(r.has_recording&&trcRecordingEligible(r)&&trcEligBucket(r)==='not_transcribed');
}
function trcRetryLabel(r){return 'Retry';}
/* A Sales call still queues and is still attempted (a lead qualifies a whole day, Sales calls
   included - see TRANSCRIPTION-README.md), but one that never actually finished transcribing has
   nothing of its own worth putting in front of a reader: no CRM-vs-call comparison ran, so there is
   no AI status and no verdict, only a blank card where one would expect to see something. Filtered
   out wherever a lead's calls are listed, so what's left visible is the CALL that carries the last
   real verdict - by construction, whatever showed before this one stays the newest thing on screen. A
   Sales call that DID finish (has_recording and actually transcribed) is a real, QA'd conversation and
   is shown exactly like any other. */
function trcIsSkippedSalesCall(r){
  return !!(r && r.personnel_team==='Sales' && r.transcription_status!=='completed');
}
/* recording_eligible: the CRM API's own flag on each follow-up (stored in acc.crm_followups.recording_eligible,
   generated from the raw payload). "Eligible for transcription" is exactly the calls the API flags true,
   and every one of them lands in ONE of: transcribed, waiting, failed, no conversation, no recording
   (trcEligBucket) - so those five always add up to the eligible total. The dashboard's call-level
   numbers and lead list only cover these calls; the three history chips (Missed callback, Promised
   call, Late follow-ups) judge a lead's WHOLE history, so they look at every call - a missed incoming
   call has no recording and so can never be "eligible" itself. */
function trcRecordingEligible(r){return !!(r&&r.recording_eligible===true);}
/* Which single bucket an eligible call is in. Same precedence as acc.eligible_kpis (the SQL that the
   cards read): no recording, then failed (the transcript OR the queue failed), then transcribed, then
   no conversation, and whatever is left is still waiting. */
function trcEligBucket(r){
  if(!r)return '';
  if(!r.has_recording)return 'no_recording';
  if(trcProcFailed(r))return 'failed';
  const st=String(r.transcription_status||'');
  if(st==='completed'||st==='non_transcribable')return st;
  return 'not_transcribed';
}
const TRC_AI_TAG = {Lost:'t-red','In Follow Up':'t-amber',Qualified:'t-green',Unclear:'t-gray'};
/* "Qualified" alone reads as though the visit is done too - the one thing this label exists to say is
   that it is not, by requirement (2026-09-18). r.visit_pending comes off followup_qa (see
   crm-snapshot-qa/index.ts - it is the model's own call, checked against the EFFECTIVE status by the
   pipeline, so it can be true here even on a row whose own ai_assessed_status reads "In Follow Up").
   The colour lookup (TRC_AI_TAG) still keys off the raw status - only the text changes. */
function trcAiStatusLabel(r){
  if(!r||!r.ai_assessed_status)return null;
  return (r.ai_assessed_status==='Qualified'&&r.visit_pending)
    ? 'Qualified (visit pending)' : r.ai_assessed_status;
}

function trcTag(cls, icon, label, title){
  return '<span class="tag '+cls+'"'+(title?' title="'+esc(title)+'"':'')+'>'
    +(icon?'<i class="fa-solid '+icon+'"></i> ':'')+esc(label)+'</span>';
}
function trcTrTag(r){
  const m = TRC_TR_META[trcTrStatus(r)];
  return m ? trcTag(m.tag,m.icon,m.label) : trcTag('t-gray','','—');
}
function trcMismatchTag(r){
  if(!r || r.status_match===true) return trcTag('t-green','fa-equals','Agrees');
  if(r.status_match===false){
    const m = TRC_MISMATCH[String(r.mismatch_type||'')];
    return trcTag('t-red','fa-not-equal', m?m.short:'Disagrees');
  }
  return '<span style="color:var(--slate)">—</span>';
}
/* By requirement (2026-09-18): the mismatch DASHBOARD counts a lead's CURRENT state, not every call
   it ever had - a lead the CRM had wrong on the 1st that got corrected by the 4th, with a call to
   match, stops counting the moment that later call is assessed. is_latest_assessed is what says
   "this row IS that lead's most recent QA'd call" (see acc.crm_recompute_latest_assessed) - only rows
   where it's true ever count toward a total, a card, a chip or the Mismatch drill-down table.
   Deliberately NOT used for a single lead's own call-by-call HISTORY (trcCallHtml, trcMismatchTag) -
   the 1st's row still shows it disagreed on the 1st, exactly as it should; only what gets SUMMED
   changes, never what a single call's own record says happened. */
function trcCountsMatch(r){return !!(r&&r.status_match===true&&r.is_latest_assessed);}
function trcCountsMismatch(r){return !!(r&&r.status_match===false&&r.is_latest_assessed);}

/* call_start_time and next_follow_up_date arrive from the CRM as IST WALL CLOCK wearing a Z. Putting
   them through new Date() shifts every one of them by five and a half hours, which is how an 11 AM
   callback becomes 5:30 AM. The components are read straight out of the string instead. */
function trcWall(v, withTime){
  const m = String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if(!m) return null;
  const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day = Number(m[3])+' '+MON[Number(m[2])-1]+' '+m[1];
  if(!withTime || m[4]===undefined) return day;
  const h=Number(m[4]), h12=(h%12===0?12:h%12), ap=(h<12?'AM':'PM');
  return day+', '+h12+':'+m[5]+' '+ap;
}

/* ---- state. One object, so the cards, the table and the filters cannot drift apart. Defaults to
   Previous day - the day whose calls actually finished processing overnight - rather than All time,
   so opening the page does not mean scrolling past months of history first. ---- */
let TRC_ROWS=null;
/* Which window TRC_ROWS was actually fetched for ('from|to', '' meaning All time) - so a filter
   change knows whether the cache still answers it or a fresh, still-scoped fetch is needed. */
let TRC_ROWS_RANGE=null;
/* Whether TRC_ROWS is the full followup_timeline_v join (transcription_status/status_match present
   on every row) or the fast crm_followups-only fetch (present on none, until trcEnrichVisiblePage
   fills in whichever leads are on screen). See trcFetchLight/trcFetchFull/trcEnsureFullEnrichment. */
let TRC_ROWS_ENRICHED=false;
/* Which range's rows already have status_match/mismatch_type/ai_assessed_status/visit_pending merged
   in from acc.followup_qa directly (see trcEnsureQaFieldsMerged) - a light, join-free fetch that is
   enough to answer CRM Match/CRM Mismatch/a mismatch category without ever paying for
   transcription_status (call_transcripts/transcription_queue), which only trcEnsureFullEnrichment's
   full join provides. null whenever TRC_ROWS itself was replaced, exactly like TRC_ROWS_ENRICHED. */
let TRC_QA_MERGED_RANGE=null;

/* TRC_ROWS/TR_ROWS only survive as long as this tab's JS does - a reload throws the fetch away and
   pays the full CRM-join + transcription cost again even one minute later. sessionStorage backs the
   same rows with a wall-clock expiry, so a reload (or someone flipping tabs and back) within 5h of
   the last real fetch reads from the browser instead of hitting Supabase again. 5h - a full working
   session, not "until the tab closes" - because the underlying data does keep changing (new calls
   come in, transcriptions complete) - it just doesn't need re-checking on every reload.
   sessionStorage (not localStorage): this is a cache of one tab's own last fetch, not something that
   should leak into a different tab that might be looking at a different filter/date range. */
const TRC_CACHE_TTL_MS=5*60*60*1000;
function trCacheRead(key,matchKey){
  try{
    const c=JSON.parse(sessionStorage.getItem(key)||'null');
    if(!c||c.key!==matchKey)return null;
    if(Date.now()-c.ts>TRC_CACHE_TTL_MS)return null;
    return c.rows;
  }catch(e){return null;}
}
function trCacheWrite(key,matchKey,rows){
  /* Quota (or a private-browsing block on storage) is not worth failing the fetch over - the caller
     still has the rows in memory, it just won't survive a reload this time. */
  try{sessionStorage.setItem(key,JSON.stringify({key:matchKey,ts:Date.now(),rows:rows}));}catch(e){}
}
/* Every place that changes TR_ROWS/TRC_ROWS without going through a real trFetch/trcFetch
   (delete, restore, a fresh upload, a poll that just finished) has to drop the cached copy too -
   otherwise a reload in the next 5h would resurrect a deleted call, or hide one just restored or
   just uploaded, straight out of the stale snapshot. */
function trCacheClear(key){try{sessionStorage.removeItem(key);}catch(e){}}

/* ---- one lead's WHOLE follow-up history, cached under the same 5h expiry as the list itself.
   The list's own fetch (TRC_LIGHT) deliberately leaves out the transcripts and the five QA blobs,
   so opening a lead has always meant a second, per-lead round trip for select('*') - and clicking
   the same lead twice, or backing out and clicking back in, paid for it again every time. Every
   request to followup_timeline_v costs the same fixed ~3-7s no matter how many rows it returns (the
   window-function chain in lead_level_progress_v can't be pruned by the outer filter, see TRC_LIGHT),
   so a cache here is worth far more than the row count suggests: it is a whole request saved.
   In memory AND in sessionStorage, for two different jobs. Memory is the one that always works and
   holds a full day of transcripts without complaint; sessionStorage is what lets a RELOAD inside the
   window skip the fetch too, and is allowed to fail (quota, private browsing) without the caller
   ever knowing - the rows are already in hand either way. One key per lead rather than one map:
   writing a lead must not mean re-serialising every other lead already cached. */
const TRC_LEAD_CACHE_PREFIX='trc_lead_';
let TRC_LEAD_MEM=Object.create(null);
function trcLeadCacheRead(id){
  const k=String(id);
  const hit=TRC_LEAD_MEM[k];
  if(hit&&Date.now()-hit.ts<=TRC_CACHE_TTL_MS)return hit;
  try{
    const c=JSON.parse(sessionStorage.getItem(TRC_LEAD_CACHE_PREFIX+k)||'null');
    if(!c||Date.now()-c.ts>TRC_CACHE_TTL_MS)return null;
    TRC_LEAD_MEM[k]=c;                       // promote, so the next read never re-parses the JSON
    return c;
  }catch(e){return null;}
}
function trcLeadCacheWrite(id,lead,rows){
  const k=String(id),entry={ts:Date.now(),lead:lead||null,rows:rows||[]};
  TRC_LEAD_MEM[k]=entry;
  try{sessionStorage.setItem(TRC_LEAD_CACHE_PREFIX+k,JSON.stringify(entry));}catch(e){
    /* Out of room - a day of transcripts genuinely can be more than sessionStorage will hold. Drop
       the entries that are already past their expiry and try this one once more; if it still won't
       fit, memory keeps it for this tab's lifetime and only a reload pays the fetch again. */
    trcLeadCacheSweep(true);
    try{sessionStorage.setItem(TRC_LEAD_CACHE_PREFIX+k,JSON.stringify(entry));}catch(e2){}
  }
}
/* Prefixed keys only, so this can never touch the list caches or anything else in sessionStorage.
   Collected before removing: removeItem inside a live sessionStorage.key(i) walk reindexes it and
   silently skips entries. */
function trcLeadCacheSweep(expiredOnly){
  try{
    const kill=[];
    for(let i=0;i<sessionStorage.length;i++){
      const k=sessionStorage.key(i);
      if(!k||k.indexOf(TRC_LEAD_CACHE_PREFIX)!==0)continue;
      if(!expiredOnly){kill.push(k);continue;}
      let c=null;try{c=JSON.parse(sessionStorage.getItem(k)||'null');}catch(e){}
      if(!c||Date.now()-c.ts>TRC_CACHE_TTL_MS)kill.push(k);
    }
    kill.forEach(function(k){try{sessionStorage.removeItem(k);}catch(e){}});
  }catch(e){}
}
/* Anything that makes a lead's stored history wrong (an explicit Refresh, a Retry that re-runs the
   pipeline for one call) has to drop it here too - otherwise the detail page would render the
   pre-change snapshot straight back out of the cache for the next 5h. */
function trcLeadCacheDrop(id){
  const k=String(id);
  delete TRC_LEAD_MEM[k];
  try{sessionStorage.removeItem(TRC_LEAD_CACHE_PREFIX+k);}catch(e){}
}
function trcLeadCacheClearAll(){
  TRC_LEAD_MEM=Object.create(null);
  trcLeadCacheSweep(false);
}

/* Fills that cache for the whole list up front, in the background, so the first click on a lead is
   as instant as the second. Runs AFTER the table is on screen and never blocks it.
   Why this is affordable at all: the fixed per-request cost described above is paid per REQUEST, not
   per lead - so one select('*') for 25 leads costs about what one lead costs, and 25 clicks' worth of
   waiting collapses into a single trip. What it is NOT free in is bytes: these rows carry the full
   turn-by-turn transcripts, so a wide date range is a real download. Hence: sequential chunks rather
   than a burst of parallel requests, leads already cached skipped entirely, and a generation counter
   so leaving the page (or changing the filters) abandons the rest instead of finishing a download
   nobody is waiting for. */
const TRC_PREFETCH_CHUNK=25;
let TRC_PREFETCH_GEN=0;
/* Bumping the generation is all a cancel is: the in-flight loop compares against it after every
   await and returns the moment it no longer owns the prefetch. */
function trcPrefetchCancel(){TRC_PREFETCH_GEN++;}
/* Late follow-ups / Missed incoming call judge a lead's WHOLE history, so every
   lead in scope needs that history loaded before any of those numbers or filters can be trusted -
   not just the 25 leads on the current page. Until then those flags are "pending" (null), never
   guessed from the date range's own rows, which is what made the counts jump around and a selected
   chip drain to "Nothing matches" as histories trickled in. TRC_HIST_TRIED remembers ids whose
   fetch was already attempted, so a failing fetch cannot loop forever. */
const TRC_HIST_TRIED=Object.create(null);
const TRC_HIST_MAX_AUTO=500;
let TRC_HIST_PROMISE=null;
function trcHistoriesReady(ids){
  return (ids||[]).every(function(id){return id==null||TRC_HIST_TRIED[String(id)]||!!trcLeadCacheRead(id);});
}
async function trcEnsureHistories(ids){
  while(TRC_HIST_PROMISE){try{await TRC_HIST_PROMISE;}catch(e){}}
  const todo=[],seen=Object.create(null);
  (ids||[]).forEach(function(id){
    const k=String(id);
    if(id==null||seen[k])return;
    seen[k]=1;
    if(!TRC_HIST_TRIED[k]&&!trcLeadCacheRead(id))todo.push(id);
  });
  if(!todo.length)return;
  TRC_HIST_PROMISE=(async function(){
    for(let i=0;i<todo.length;i+=TRC_PREFETCH_CHUNK){
      const chunk=todo.slice(i,i+TRC_PREFETCH_CHUNK);
      try{
        const byId=await trcLeadFetchByIds(chunk);
        chunk.forEach(function(id){
          const d=byId[String(id)];
          trcLeadCacheWrite(id,(d&&d.lead)||null,(d&&d.rows)||[]);
        });
      }catch(e){}
      chunk.forEach(function(id){TRC_HIST_TRIED[String(id)]=1;});
    }
  })();
  try{await TRC_HIST_PROMISE;}finally{TRC_HIST_PROMISE=null;}
}
/* Ids of every lead behind the current list, before the history chips narrow it. */
let TRC_LIST_LEAD_IDS=[];
function trcHistChipOn(){return TRC_F.missedIn==='1'||TRC_F.cadence==='1'||TRC_F.promised==='1';}
async function trcWarmListHistories(){
  const ids=TRC_LIST_LEAD_IDS.slice();
  if(!ids.length||trcHistoriesReady(ids))return;
  if(ids.length>TRC_HIST_MAX_AUTO&&!trcHistChipOn())return;
  await trcEnsureHistories(ids);
  if($('trcRows'))trcRender(false,true);
}
async function trcPrefetchHistories(leadIds){
  const gen=++TRC_PREFETCH_GEN;
  const todo=[];
  const seen=Object.create(null);
  (leadIds||[]).forEach(function(id){
    const k=String(id);
    if(id==null||seen[k])return;
    seen[k]=1;
    if(!trcLeadCacheRead(id))todo.push(id);
  });
  if(!todo.length)return;
  for(let i=0;i<todo.length;i+=TRC_PREFETCH_CHUNK){
    if(gen!==TRC_PREFETCH_GEN)return;            // a newer prefetch (or a page change) owns this now
    const ids=todo.slice(i,i+TRC_PREFETCH_CHUNK);
    try{
      /* ONE request for the whole chunk, where this used to make two - and the per-lead pair the
         detail page makes on a click is the same one call. See acc.crm_lead_detail: the lead row
         and its complete follow-up history come back together, keyed by the id that was asked for.
         It also retires the paging this loop needed. The old shape asked for 25 leads' worth of
         timeline ROWS, and PostgREST answers an over-long result by silently truncating it at its
         own max-rows - which would have meant caching a lead's history with its oldest calls
         quietly missing, and the detail page then showing that as the whole story. Here each
         lead's history is one jsonb value inside its own row, so 25 leads is 25 rows and there is
         nothing left to truncate. */
      const byId=await trcLeadFetchByIds(ids);
      if(gen!==TRC_PREFETCH_GEN)return;
      /* Written for every id asked for, not just the ones that came back with rows - a lead with no
         follow-up history at all is a real answer, and caching it is what stops the detail page
         re-asking for that same empty answer on every click. */
      ids.forEach(function(id){
        const d=byId[String(id)];
        trcLeadCacheWrite(id,(d&&d.lead)||null,(d&&d.rows)||[]);
      });
    }catch(e){
      /* Silent by design: nothing on screen is waiting for this, and the detail page still fetches
         for itself on click. A failed chunk simply stays uncached. */
    }
  }
  /* Added so trcLeads' cadence/missedIn (see its own note) stop reading the range-limited rows the
     moment each lead's real history lands - a soft repaint, same as trcEnrichVisiblePage/
     trcBackfillLastJudgement already do on their own completion. Gated on the same generation check as
     everything above: a newer prefetch (or a page/filter change) means this one's result is stale and
     must not repaint over whatever now owns the screen. Only reached at all when todo was non-empty,
     so this never fires on a page that was already fully cached. */
  if(gen===TRC_PREFETCH_GEN)trcRender(false,true);
}

/* THE ONE PLACE A LEAD'S HISTORY IS FETCHED, for the click and for the prefetch alike.
   acc.crm_lead_detail is the find-a-lead-by-id API this module now goes through: it takes the ids
   as an array, and for each one returns that lead's row and its WHOLE follow-up timeline together,
   so opening a lead is a single round trip instead of two.
   WHY IT LIVES IN THE DATABASE rather than as two client queries. acc.followup_timeline_v joins a
   five-deep chain of window functions over every follow-up there has ever been, and until the
   matching migration the lead_id filter could not reach inside that chain - so asking for one
   lead's six calls cost the same ~7-8 SECONDS as asking for all thirteen thousand, which is what
   every click on this table was paying. Filtering by a single id now pushes all the way down to an
   index scan (measured 7839ms -> 15ms); filtering by a LIST still cannot, which is exactly why the
   batch is a loop inside the function rather than one `in('lead_id', ids)` out here. 25 leads:
   ~4.8s before, ~0.2s now.
   Returns a map keyed by the STRING id, with an entry for every id asked for - including ids that
   have nothing behind them, since "this lead has no history" is a real answer worth caching. */
async function trcLeadFetchByIds(ids){
  const {data,error}=await sb.schema('acc').rpc('crm_lead_detail',{p_lead_ids:ids});
  if(error)throw error;
  const out=Object.create(null);
  (data||[]).forEach(function(d){
    out[String(d.lead_id)]={lead:d.lead||null,rows:trcSortHistory(d.followups)};
  });
  ids.forEach(function(id){
    const k=String(id);
    if(!out[k])out[k]={lead:null,rows:[]};
  });
  return out;
}
/* The function already orders a lead's history by communication_time then follow_up_id. It is
   sorted again here because trcChrono is what the REST of this module means by chronological (it
   reads call_start_text first, see the note on trcChrono) - and a history that arrives in one
   order and is rolled up in another is how a lead's "latest call" quietly becomes the wrong call. */
function trcSortHistory(rows){
  return (Array.isArray(rows)?rows:[]).slice().sort(trcChrono);
}

/* By requirement (2026-09-18): a real browser reload of this page should show exactly the range and
   filters someone was just looking at; leaving to a different tab and coming back should not - that
   is a fresh visit to the page, not a continuation of the last one. The two need different mechanics
   because they are different EVENTS on a page that never fully reloads between them:
   - A reload re-runs this whole script from scratch, so TRC_F's own initial value - computed exactly
     once, right here - is the only chance to recover what was on screen. sessionStorage is what
     survives that reload (a plain JS variable does not); trc_filters_state is written on every render
     (see trcRender) precisely so it is always current when a reload happens to catch it.
   - Switching to a different tab and back does NOT reload the script - TRC_F is a module-level object
     that would otherwise just sit there unchanged. See trcResetFilters, called from activateModule the
     moment the incoming tab is 'transcription' and the outgoing one was something else - the one place
     that transition is visible - which resets TRC_F back to these same defaults and clears this same
     key, so a reload caught right after landing here restores THIS visit, not the one before it. */
const TRC_F=(function(){
  const fallback={from:traYesterday(),to:traYesterday(),proc:'all',match:'all',crm:'all',bu:'all',q:'',mismatch:'all',personnel:'all',fdate:'all',remarks:'all',pitch:'all',missedIn:'all',cadence:'all',promised:'all',etiquette:'all',queryHandling:'all',retention:'all',lostReason:'all',personalMobile:'all'};
  try{
    const saved=JSON.parse(sessionStorage.getItem('trc_filters_state')||'null');
    if(saved&&typeof saved==='object')return Object.assign(fallback,saved);
  }catch(e){}
  return fallback;
})();
/* Written on every render (trcRender) rather than at each individual setter, so one place is
   guaranteed current instead of every future TRC_F.x=y call site having to remember to call it too. */
function trcSaveFilterState(){
  try{sessionStorage.setItem('trc_filters_state',JSON.stringify(TRC_F));}catch(e){}
}
/* The "coming back from elsewhere" half of the rule above - see activateModule. Deliberately mutates
   the existing TRC_F object rather than reassigning the const, since closures elsewhere already hold
   this exact reference. */
function trcResetFilters(){
  const y=traYesterday();
  TRC_F.from=y;TRC_F.to=y;TRC_F.proc='all';TRC_F.match='all';TRC_F.mismatch='all';
  TRC_F.crm='all';TRC_F.bu='all';TRC_F.personnel='all';TRC_F.q='';
  TRC_F.fdate='all';TRC_F.remarks='all';TRC_F.pitch='all';TRC_F.missedIn='all';
  TRC_F.cadence='all';TRC_F.promised='all';TRC_F.etiquette='all';TRC_F.queryHandling='all';TRC_F.retention='all';TRC_F.lostReason='all';TRC_F.personalMobile='all';
  TRC_PAGE=0;
  TRC_ROWS=null;TRC_ROWS_RANGE=null;TRC_ROWS_ENRICHED=false;TRC_QA_MERGED_RANGE=null;
  TRC_KPI_FAST=null;TRC_KPI_FAST_RANGE=null;
  try{sessionStorage.removeItem('trc_filters_state');}catch(e){}
}

/* THE DAILY BREAKDOWN TABLE (2026-09-19, not yet on main). One row per calendar day, straight off
   acc.daily_qa_summary (pkey on date - this is already a single indexed range scan, not a fetch of
   every follow-up), independent of the main list's own date range so a wide breakdown and a narrow
   drill-down don't fight over the same two boxes. Every number in it is clickable: it re-points the
   main list at that exact day and category (trcDailyDrill), reusing trcFetchBoth/trcRender exactly the
   way the KPI cards above the table already do - no new fetch path, just a different way to set TRC_F. */
let TRC_DAILY_ROWS=null, TRC_DAILY_RANGE=null, TRC_DAILY_OPEN=false;
let TRC_DAILY_FROM=trcAddDays(traYesterday(),-6), TRC_DAILY_TO=traYesterday();

async function trcFetchDaily(force){
  const range=TRC_DAILY_FROM+'|'+TRC_DAILY_TO;
  if(!force&&TRC_DAILY_ROWS&&TRC_DAILY_RANGE===range)return TRC_DAILY_ROWS;
  const {data,error}=await sb.schema('acc').from('daily_qa_summary').select('*')
    .gte('date',TRC_DAILY_FROM).lte('date',TRC_DAILY_TO).order('date',{ascending:false});
  if(error){toast(error.message,'err');return TRC_DAILY_ROWS||[];}
  TRC_DAILY_ROWS=data||[];TRC_DAILY_RANGE=range;
  return TRC_DAILY_ROWS;
}

window.trcToggleDaily=async function(){
  TRC_DAILY_OPEN=!TRC_DAILY_OPEN;
  if(TRC_DAILY_OPEN)await trcFetchDaily(false);
  trcRenderDaily();
};
window.trcDailyApplyRange=async function(){
  const f=($('trcDailyFrom')&&$('trcDailyFrom').value)||TRC_DAILY_FROM;
  const t=($('trcDailyTo')&&$('trcDailyTo').value)||TRC_DAILY_TO;
  TRC_DAILY_FROM=f;TRC_DAILY_TO=t;
  await trcFetchDaily(true);
  trcRenderDaily();
};
/* Jumps the main list (below this panel, same page) at one exact day and category - the actual
   filtering, fetching and rendering is entirely trcCard/trcSetRange's own machinery; this only sets
   the same TRC_F fields those already set, so every existing rule (light vs full fetch, pagination,
   the mismatch sub-panel) applies unchanged. kind: 'all' | 'proc' | 'match' | 'mismatch'. */
window.trcDailyDrill=async function(date,kind,val){
  TRC_F.from=date;TRC_F.to=date;
  TRC_F.proc='all';TRC_F.match='all';TRC_F.mismatch='all';
  if(kind==='proc')TRC_F.proc=val;
  else if(kind==='match')TRC_F.match=val;
  else if(kind==='mismatch'){TRC_F.match='MISMATCH';TRC_F.mismatch=val;}
  trcShowLoading();
  if(TRC_F.proc!=='all')await trcEnsureFullEnrichment();
  await trcFetchBoth();
  trcRender(true);
  trcAfterListRender();
  const anchor=$('trcKpis');if(anchor)anchor.scrollIntoView({behavior:'smooth',block:'start'});
};

function trcDailyCell(date,kind,val,n,cls){
  const shown=n||0;
  if(!shown)return '<td style="text-align:center;color:var(--slate)">0</td>';
  return '<td style="text-align:center">'
    +'<a href="javascript:void(0)" onclick="trcDailyDrill(\''+date+'\',\''+kind+'\',\''+esc(val)+'\')"'
    +(cls?' class="'+cls+'"':'')+' style="font-weight:600">'+shown+'</a></td>';
}
/* HISTORICAL, NOT DRILLABLE - unlike every other cell in this table, this number is not "of the
   leads currently on screen, how many match this" (that's what trcCard's filters answer), it is
   "how many calls were EVER judged a mismatch on this date, corrected or not" (2026-09-23). Nothing
   in TRC_F/trcApply can reproduce that set - is_latest_assessed always narrows to a lead's current
   state - so this renders as a plain number, never a link, rather than a click that would silently
   show the wrong rows. */
function trcDailyPlainCell(n){
  const shown=n||0;
  return '<td style="text-align:center'+(shown?'':';color:var(--slate)')+'">'+shown+'</td>';
}
/* Reconciliation, point 2: not just the raw Transcribed/Failed counts already in the row (both were
   already columns in acc.daily_qa_summary, just never surfaced here as a rate) - the PROPORTION of the
   day's calls each one accounts for, so a day of 4 failed out of 6 calls reads as the crisis it is
   instead of looking the same as 4 failed out of 400. */
function trcDailyRateCell(n,total){
  if(!total)return '<td style="text-align:center;color:var(--slate)">—</td>';
  const pct=Math.round((Number(n||0)/Number(total))*1000)/10;
  return '<td style="text-align:center;font-variant-numeric:tabular-nums">'+pct+'%</td>';
}
function trcRenderDaily(){
  const el=$('trcDaily');if(!el)return;
  if(!TRC_DAILY_OPEN){el.innerHTML='';return;}
  const rows=TRC_DAILY_ROWS||[];
  const mmHead=TRC_MISMATCH_KEYS.map(function(k){return '<th title="'+esc(TRC_MISMATCH[k].label)+'">'+esc(TRC_MISMATCH[k].short)+'</th>';}).join('');
  const body=rows.length?rows.map(function(r){
    return '<tr>'
      +'<td style="white-space:nowrap;font-weight:600">'+esc(trcWall(r.date,true)||r.date)+'</td>'
      +trcDailyCell(r.date,'all','all',r.total_leads)
      +trcDailyCell(r.date,'all','all',r.total_followups)
      +trcDailyCell(r.date,'proc','no_recording',Math.max(0,Number(r.total_followups||0)-Number(r.recordings_available||0)))
      +trcDailyCell(r.date,'proc','non_transcribable',r.non_transcribable)
      +trcDailyCell(r.date,'proc','completed',r.transcribed)
      +trcDailyRateCell(r.transcribed,r.total_followups)
      +trcDailyPlainCell(r.already_transcribed)
      +trcDailyCell(r.date,'proc','failed',r.transcription_failed)
      +trcDailyRateCell(r.transcription_failed,r.total_followups)
      +trcDailyCell(r.date,'match','MATCH',r.status_match)
      +trcDailyCell(r.date,'match','MISMATCH',r.status_mismatch)
      +trcDailyPlainCell(r.historical_status_mismatch)
      +TRC_MISMATCH_KEYS.map(function(k){return trcDailyCell(r.date,'mismatch',k,r[k]);}).join('')
    +'</tr>';
  }).join(''):'<tr><td colspan="'+(13+TRC_MISMATCH_KEYS.length)+'" style="text-align:center;color:var(--slate);padding:18px">No days in this range yet</td></tr>';
  el.innerHTML='<div class="card card-pad" style="margin-top:14px">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">'
      +'<div class="sec-title" style="margin:0"><i class="fa-solid fa-table-list" style="color:#0d9488"></i> Daily breakdown</div>'
      +'<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
        +'<label style="font-size:12px;color:var(--slate)">From</label>'
        +'<input type="date" id="trcDailyFrom" value="'+esc(TRC_DAILY_FROM||'')+'" style="padding:5px 8px">'
        +'<label style="font-size:12px;color:var(--slate)">To</label>'
        +'<input type="date" id="trcDailyTo" value="'+esc(TRC_DAILY_TO||'')+'" style="padding:5px 8px">'
        +'<button class="btn btn-sm btn-primary" onclick="trcDailyApplyRange()"><i class="fa-solid fa-magnifying-glass"></i> Apply</button>'
      +'</div>'
    +'</div>'
    +'<div style="overflow-x:auto;margin-top:12px"><table class="tbl" style="width:100%">'
      +'<thead><tr><th>Date</th><th>Total leads</th><th>Total calls</th>'
        +'<th title="Total calls ÷ recordings available - calls with no recording at all to transcribe">No recording</th>'
        +'<th title="Had a recording, but nothing usable came out of it (silence, wrong number, too short, etc)">No conversation</th>'
        +'<th>Transcribed</th>'
        +'<th title="Transcribed ÷ Total calls">Success rate</th>'
        +'<th title="Of the Transcribed count, how many reused a recording already transcribed earlier - no repeat model call, no second bill. Not a link: this counts a fact about already-completed rows, not a separate status to filter the table by.">Reused (old transcript)</th>'
        +'<th>Failed</th><th title="Transcription failed ÷ Total calls">Failure rate</th>'
        +'<th>Matched</th><th title="Of this day\'s leads, how many are STILL a mismatch based on '
        +'each lead\'s latest assessed call - a lead corrected by a later call drops out of this the '
        +'moment that later call is judged.">Mismatched</th>'
        +'<th title="Every call actually judged a mismatch on this date, corrected or not since - '
        +'this number never goes down. Not clickable: it is not a set of CURRENT leads, so nothing on '
        +'this page can open it as one.">Mismatch events (historical)</th>'
        +mmHead+'</tr></thead>'
      +'<tbody>'+body+'</tbody>'
    +'</table></div>'
    +'<div style="font-size:11.5px;color:var(--slate);margin-top:8px">Click any number to open those leads for that day. "Mismatched" is today\'s unresolved count; "Mismatch events (historical)" is how many were ever flagged on that date, including ones since resolved - see a lead\'s own history for exactly when.</div>'
  +'</div>';
}

/* THE TABLE, PAGED. A wide range can mean 500+ leads; rendering all of them as DOM at once (and, until
   this, prefetching every one of their full transcripts in the background right after) is what made
   the page hang, not the network fetch - trcFetch itself dropped under 4s once 20260917090000 fixed
   the query underneath. TRC_PAGE_ROWS is always exactly what's on screen right now (the current page's
   items, lead-groups or calls depending on view), so trcPrefetchListedHistories warms only that instead
   of re-deriving "what's visible" by scraping the DOM or re-touching the whole filtered set. */
const TRC_PAGE_SIZE=50;
let TRC_PAGE=0;
let TRC_PAGE_ROWS=[];

/* THE FOUR KPI CARDS AND FIVE CHIPS, from acc.daily_qa_summary instead of counting every fetched row
   in the browser (see 20260917110000) - one row per calendar day, summed over the selected range. Only
   valid when the range's OWN totals are what the cards should show: the moment a CRM-status, business
   unit or personnel filter narrows the scope, the day table can't answer it (it isn't broken down that
   way), and trcKpiHtml falls back to counting `rows` exactly as it always did. Keyed on the range so a
   stale fetch from a previous range is never read as this one's numbers. */
let TRC_KPI_FAST=null;
let TRC_KPI_FAST_RANGE=null;

/* THE PRE-SALES TEAM, from the roster table rather than from whoever happens to be in the fetched
   rows. The Personnel filter used to be built entirely out of TRC_ROWS, which meant it could only
   ever offer the callers with a call in the selected date range: a caller who was on leave, or who
   simply had no lost/follow-up call that day, was missing from the dropdown altogether - and a
   missing name is indistinguishable from a name with nothing to show. Someone checking "did Rani
   take any calls yesterday" could not ask the question.

   Nine rows, so it is fetched once per page life and kept - the roster changes when someone joins
   or leaves the team, not between two clicks of a date preset. null means "not fetched yet", [] is
   a real answer (and the filter falls back to the rows, exactly as before, so a failed fetch or an
   older database costs nothing).
   See acc.crm_presales_personnel - the same list acc.crm_presales_emails() reads to decide which
   calls are queued for transcription at all, so the dropdown and the pipeline cannot disagree. */
let TRC_PERSONNEL=null;
async function trcPersonnelFetch(){
  if(TRC_PERSONNEL)return TRC_PERSONNEL;
  try{
    const {data,error}=await sb.schema('acc').from('crm_presales_personnel')
      .select('email,full_name,active,sort_order').eq('active',true)
      .order('sort_order',{ascending:true,nullsFirst:false}).order('full_name');
    if(error)throw error;
    TRC_PERSONNEL=(data||[]).map(function(p){
      return {email:String(p.email||'').toLowerCase(),name:p.full_name||p.email};
    }).filter(function(p){return p.email;});
  }catch(e){
    /* Silent: the filter has a working fallback and a toast here would fire on every visit to a
       page whose main job has nothing to do with the roster. */
    TRC_PERSONNEL=[];
  }
  return TRC_PERSONNEL;
}
/* The lead (and, when the click came from the call-level Mismatch table, the exact follow-up) most
   recently opened from this list, so coming back from its detail page (the in-app Back button, or
   the browser's own back button - both re-run trcView the same way) highlights and scrolls to the
   exact row someone came from instead of dropping them back at the top of the table. */
let TRC_LAST_LEAD_ID=null;
let TRC_LAST_FOLLOWUP_ID=null;
/* Set on the way INTO a lead and consumed on the way back out, so the list can tell "I came back
   from a lead" apart from "I just opened this page". The in-app Back button says so in its route
   (#/r12, #/back), but the BROWSER's back button doesn't: it restores whatever hash the list had
   before the click, which for anyone who arrived from the sidebar is a bare #/ with nothing in it to
   go on. Both buttons have to land on the same row, so this is what the bare case reads instead. */
let TRC_FROM_DETAIL=false;
/* TRC_LAST_LEAD_ID promises the exact row survives a reload or a pasted URL, but the default (and
   every) date window can legitimately exclude that lead entirely - its last call may not fall in
   the range currently selected. TRC_PIN_ROWS is that one lead's rows, fetched by lead_id alone with
   no date filter, kept only for as long as TRC_LAST_LEAD_ID names a lead the ranged fetch didn't
   already include - see trcEnsurePinnedLead. */
let TRC_PIN_ID=null;
let TRC_PIN_ROWS=null;
/* What makes #/r79 land on row 79 rather than on the 79th row of whatever happens to be on screen.
   A SL NO is a position, and a position only means anything against the list it was counted in: the
   default window is YESTERDAY alone, so the same number over a freshly loaded page names a different
   lead, or no row at all. So the moment a lead is opened from the list, the number is written down
   against the thing that does identify the row exactly - the lead's own id, which is also its <tr>
   id - together with the filters the count was made under, and the way back resolves through that
   instead of counting rows again.
   sessionStorage: this is one tab's navigation history and has no business outliving the tab. It is
   also allowed to simply not be there (a pasted link in a fresh browser), which is what the position
   fallback in trcView is still for. */
const TRC_BACK_KEY='trc_back_row';
/* sl is optional. The call-level Mismatch table has no SL NO column to hand over, and a visit from
   there still deserves to land back on its own row - so the lead id (and the follow-up id, which is
   what identifies a row in that table) is written down whether or not a number came with it. */
function trcRememberRow(sl,leadId,followUpId){
  if(leadId==null)return;
  try{
    sessionStorage.setItem(TRC_BACK_KEY,JSON.stringify(
      {sl:sl?Number(sl):null,leadId:leadId,followUpId:followUpId||null,f:Object.assign({},TRC_F)}));
  }catch(e){}
}
/* Whatever was last opened from the list, with the filters it was opened under - what #/back
   resolves through, and the only thing that can put an exact row back after a reload. */
function trcRecallAny(){
  try{
    const m=JSON.parse(sessionStorage.getItem(TRC_BACK_KEY)||'null');
    return (m&&m.leadId!=null)?m:null;
  }catch(e){return null;}
}
/* Only answers for the SL NO it was written for - a number that doesn't match is a link from some
   other list state, and guessing a lead for it would be worse than falling back to the position. */
function trcRecallRow(sl){
  const m=trcRecallAny();
  return (m&&Number(m.sl)===Number(sl))?m:null;
}

/* Deliberately NOT selecting level_regression_severity/prev_status here, unlike the lead-detail fetch
   below. Both columns come off acc.lead_level_progress_v, a view stacked six windows deep over EVERY
   row of acc.crm_followups - a fixed ~6-8s cost paid IN FULL on every request to followup_timeline_v,
   no matter how few rows or which lead_id the outer query asks for (confirmed with EXPLAIN ANALYZE: a
   single lead's rows cost the same as the whole table - Postgres can't push a filter through the
   window functions). Asking for those two columns is what forces the full chain to run; leaving them
   out lets Postgres prune the join away entirely, cutting this query from ~6.8s to ~3s - the
   difference between clearing the authenticated role's 8s statement_timeout and getting canceled.
   The cost, not the row count: trcIsRegression (and so the "Status regressed" badge on a lead row)
   simply has nothing to key off here and reads as false. The lead detail page pays the real cost
   once, on click, with its own separate select('*') fetch, and still shows the regression tag per
   call - see trcLeadDetail below. */
const TRC_LIGHT = 'follow_up_id,lead_id,lead_name,business_unit_name,communication_time,call_date,'
  +'call_start_text,next_follow_up_text,crm_status,crm_status_raw,status_detail,crm_remarks,'
  +'crm_lost_reason,recording_url,callid,has_recording,call_duration,lead_first_seen_date,lead_current_status,'
  +'lead_current_lost_reason,transcript_id,transcription_status,turn_count,languages,duration_seconds,'
  +'non_transcribable_reason,transcription_model,qa_id,pitch_score,pitch_status,followup_date_status,'
  +'lost_reason_status,retention_status,etiquette_status,query_handling_status,personal_mobile_status,personal_mobile_number,remarks_status,ai_assessed_status,visit_pending,status_match,mismatch_type,qa_score,qa_model,'
  +'qa_error,reused_transcription,queue_status,fail_phase,queue_error,attempt_count,qa_attempt_count,'
  +'personnel_id,personnel_name,personnel_email,personnel_role,personnel_team,is_latest_assessed';
const TRC_LIGHT_FIELDS=TRC_LIGHT.split(',');

/* THE FAST FETCH. acc.crm_followups directly - no join to call_transcripts, followup_qa,
   transcription_queue or lead_level_progress_v, which is exactly what made even a page-1-only
   request slow (see trcFetch below): a LIMIT cannot help when the query underneath needs those four
   tables sorted for a merge join before it can even apply the date filter's own ORDER BY. Measured
   directly - this fetch alone: ~90ms for a 79-day range, ~1.6s for the whole table's history, against
   followup_timeline_v's 3-6s+ for the same. crm_status/crm_status_raw/crm_remarks/crm_lost_reason are
   aliased to match TRC_LIGHT's names so every existing reader (trcApply, trcLeads, trcTableHtml, the
   filter bar) keeps working unchanged against a row from either source. */
const TRC_CRM_LIGHT = 'follow_up_id,lead_id,lead_name,business_unit_name,communication_time,call_date,'
  +'call_start_text,next_follow_up_text,crm_status:status,crm_status_raw:status_raw,status_detail,'
  +'crm_remarks:remarks,crm_lost_reason:lost_reason,recording_url,callid,has_recording,call_duration,'
  +'personnel_id,personnel_name,personnel_email,personnel_role,recording_eligible';

/* A lead that already reached Qualified (or beyond) has no legitimate way back to Fresh or In Follow
   Up - acc.lead_level_progress_v already audits every follow-up for exactly this and marks the ones
   that skip a step backwards 'not_allowed' (as opposed to 'review', for a softer drop like OV back to
   In Follow Up, which this tag deliberately leaves alone).
   Only applied from the day this was wired up onward: the database has always computed it, correctly,
   over the CRM's whole history, but flagging calls that were already sitting in the system before
   anyone could act on this would just be noise, not new information.
   r.level_regression_severity is only ever present on rows from trcLeadDetail's own fetch (TRC_LIGHT
   deliberately leaves it out, see above) - so on a list row this always reads undefined and simply
   never flags, rather than throwing. */
const TRC_REGRESSION_CUTOFF='2026-09-02';
function trcIsRegression(r){
  return r.level_regression_severity==='not_allowed' && trcRowDate(r)>=TRC_REGRESSION_CUTOFF;
}

/* The list never asks for transcripts. A day of calls is a few hundred rows and every one of them
   carries its full turn-by-turn transcript plus five QA blobs - fetching those to render a table of
   names is megabytes for nothing. The detail view asks for `*` on one lead.

   IT ALSO USED TO ASK FOR EVERY FOLLOW-UP EVER SEEN, every time this page opened, regardless of the
   date filter on screen - the whole point was that changing the filter afterwards could stay client
   side and instant. That table only grows (nothing is ever pruned, by design), so the page got
   slower to open every day whether or not anyone was looking at more than yesterday.

   A later revision widened this to fetch each windowed lead's FULL history (not just the window),
   because trcLeadRowGate judged a row against the lead's own earlier days. That gate is gone - the
   business rule is now decided by the decision date alone, never by an earlier day - and nothing else
   here reads a lead's history outside the window (the lead detail page runs its own dedicated query
   for one lead_id). So this goes back to a single, directly date-filtered fetch: cost scales with the
   window's own row count, not with any lead's lifetime history.
   "All time" (both dates cleared) does the original full fetch - that is a real request for
   everything, not the default.

   THIS NOW SPLITS IN TWO. Even a LIMIT 1 against followup_timeline_v pays the full cost below - a
   merge join needs both sides sorted by the join key before a LIMIT can even look at the first row,
   so a plain page-1 request over a wide range still scans followup_qa, transcription_queue and
   lead_level_progress_v in full first (measured: 3-6s+, worse as those tables grow). Whether a
   request needs that at all depends only on whether transcription_status/status_match are actually
   being filtered on (the proc/match/mismatch cards) - crm/business-unit/personnel/search all live on
   crm_followups itself and cost nothing extra. So: */
async function trcFetch(force){
  /* Awaited, and deliberately not fired off in parallel: nine rows once per page life, a no-op on
     every call after the first, against a view query that costs seconds. Racing it instead would
     save nothing measurable and would let the roster land AFTER the render that needed it, leaving
     the dropdown short a caller until something else happened to repaint it. */
  await trcPersonnelFetch();
  const needsFull=TRC_F.proc!=='all'||TRC_F.match!=='all'||TRC_F.mismatch!=='all';
  return needsFull ? trcFetchFull(force) : trcFetchLight(force);
}

/* THE FAST PATH - crm_followups alone, no joins, so a proc/match/mismatch-free view (the common
   case: just browsing or filtering by CRM status/business unit/personnel/search) never pays the join
   cost at all. transcription_status, status_match and every QA field are simply absent on these rows
   until trcEnrichVisiblePage fills them in for whichever leads are actually on screen (see below) -
   trcRowDate, trcApply's crm/bu/personnel/q filters and trcLeads' grouping/sorting only ever needed
   the columns this DOES carry, so nothing downstream has to know which path a row came from. */
/* Reads EVERY row of a query, however many there are. The API answers an over-long result with only its
   first max-rows (1000) and no error, so a plain `await q` quietly drops everything past that - which is
   how a day with 1183 calls lost its last 183: the cards (counted in the database) read 12 matched leads
   while the table, built from the 1000 rows that arrived, could show only 10. A page that comes back with
   1000 or more rows might have been cut short, so it keeps going from where it stopped until a page
   comes back shorter. build() must return a fresh, fully ordered query each time. */
async function trcReadAll(build){
  let out=[],from=0;
  for(;;){
    const {data,error}=await build().range(from,from+19999);
    if(error)throw error;
    const batch=data||[];
    out=out.concat(batch);
    if(batch.length<1000||out.length>200000)break;
    from+=batch.length;
  }
  return out;
}
async function trcFetchLight(force){
  const rangeKey=(TRC_F.from||'')+'|'+(TRC_F.to||'');
  if(TRC_ROWS&&!force&&TRC_ROWS_RANGE===rangeKey)return TRC_ROWS;
  /* Its own sessionStorage key, never trc_fetch_cache (that one is trcFetchFull's) - the two must
     never collide, or a light snapshot read back under the full-fetch's key would be trusted as
     already enriched, and a full snapshot read back here would get silently thrown away in favour
     of a lighter one. See trcFetchFull for the one place a full fetch also writes THIS key, because
     full data is strictly good enough to answer a light request too. */
  if(!force){
    const cached=trCacheRead('trc_fetch_light_cache_v3',rangeKey);
    if(cached){
      TRC_ROWS=cached;TRC_ROWS_RANGE=rangeKey;
      TRC_ROWS_ENRICHED=cached.length>0&&cached.every(function(r){return r._enriched;});
      /* A cached snapshot can hold a mix - some rows enriched by trcEnrichVisiblePage, some not, none
         necessarily qa-field-merged - so this cannot claim the merge already happened. A genuinely
         merged range re-merges once more here, which is cheap (an indexed, join-free query) compared
         to getting it wrong and showing blank match/mismatch data back out of the cache. */
      TRC_QA_MERGED_RANGE=null;
      return TRC_ROWS;
    }
  }
  try{
    const rows=await trcReadAll(function(){
      let q=sb.schema('acc').from('crm_followups').select(TRC_CRM_LIGHT)
        .order('call_date',{ascending:false,nullsFirst:false})
        .order('communication_time',{ascending:false,nullsFirst:false})
        .order('follow_up_id',{ascending:false});
      if(TRC_F.from)q=q.gte('call_date',TRC_F.from);
      if(TRC_F.to)q=q.lte('call_date',TRC_F.to);
      return q;
    });
    /* lead_current_status/lead_current_lost_reason live on acc.crm_leads, one row per lead - a second
       light query, keyed on just the distinct leads this range actually has, rather than folding
       crm_leads into the query above and paying a join for it. */
    const leadIds=Array.from(new Set(rows.map(function(r){return r.lead_id;}).filter(function(v){return v!=null;})));
    let leadMap={};
    /* In chunks: one .in() with every lead of a wide range is both a very long URL and a result the API
       would cut at 1000 rows. */
    for(let i=0;i<leadIds.length;i+=200){
      const {data:leads,error:e2}=await sb.schema('acc').from('crm_leads')
        .select('lead_id,status,lost_reason').in('lead_id',leadIds.slice(i,i+200));
      if(e2)throw e2;
      (leads||[]).forEach(function(l){leadMap[String(l.lead_id)]=l;});
    }
    rows.forEach(function(r){
      const l=leadMap[String(r.lead_id)];
      r.lead_current_status=l?l.status:null;
      r.lead_current_lost_reason=l?l.lost_reason:null;
      /* Same rule acc.crm_personnel_team applies (STABLE SQL, see 20260831090000): Pre-Sales when the
         lowercased, trimmed email is on the active roster TRC_PERSONNEL already holds, Sales
         otherwise, null for no email at all - so this can never disagree with what queued the call. */
      const email=String(r.personnel_email||'').trim().toLowerCase();
      r.personnel_team=!email?null:((TRC_PERSONNEL||[]).some(function(p){return p.email===email;})?'Pre-Sales':'Sales');
    });
    TRC_ROWS=rows;TRC_ROWS_RANGE=rangeKey;TRC_ROWS_ENRICHED=false;TRC_QA_MERGED_RANGE=null;
    trCacheWrite('trc_fetch_light_cache_v3',rangeKey,rows);
  }catch(e){
    TRC_ROWS=TRC_ROWS&&TRC_ROWS_RANGE===rangeKey?TRC_ROWS:[];TRC_ROWS_RANGE=null;TRC_QA_MERGED_RANGE=null;
    toast('Could not load the call history: '+((e&&e.message)||e),'err');
  }
  return TRC_ROWS;
}

/* THE FULL PATH - unchanged from before this split, and still exactly what a proc/match/mismatch
   view needs: those three read transcription_status/status_match/mismatch_type, which only exist
   after the join, and filtering or counting by them correctly needs every row in range to have it,
   not just whichever page is on screen. TRC_ROWS_ENRICHED marks the result so trcEnsureFullEnrichment
   (called the moment one of those three is turned on) knows whether today's TRC_ROWS already qualifies
   or a real fetch is still owed. */
async function trcFetchFull(force){
  const rangeKey=(TRC_F.from||'')+'|'+(TRC_F.to||'');
  if(TRC_ROWS&&!force&&TRC_ROWS_RANGE===rangeKey&&TRC_ROWS_ENRICHED)return TRC_ROWS;
  if(!force){
    const cached=trCacheRead('trc_fetch_cache_v3',rangeKey);
    if(cached){TRC_ROWS=cached;TRC_ROWS_RANGE=rangeKey;TRC_ROWS_ENRICHED=true;TRC_QA_MERGED_RANGE=null;return TRC_ROWS;}
  }
  /* followup_timeline_v joins lead_level_progress_v, which ranks every lead's whole follow-up
     history through a chain of window functions - a cost paid IN FULL on every request to this
     view, no matter how narrow the page's own range() slice is (a WHERE on the outer query cannot
     push down into that windowed subquery). Chunking at 1000 rows made "All time" issue ~12
     sequential requests, each repaying that same fixed ~6-8s cost - a minute-plus of serial
     round trips for a table Postgres can hand back whole in one. PAGE now covers the entire table
     in a single request; the loop (and its 50000 backstop) stays only so a future row count that
     outgrows one page still pages correctly instead of silently truncating. */
  let out=[];
  try{
    out=await trcReadAll(function(){
      let q=sb.schema('acc').from('followup_timeline_v').select(TRC_LIGHT)
        .order('call_date',{ascending:false,nullsFirst:false})
        .order('communication_time',{ascending:false,nullsFirst:false})
        .order('follow_up_id',{ascending:false});
      if(TRC_F.from)q=q.gte('call_date',TRC_F.from);
      if(TRC_F.to)q=q.lte('call_date',TRC_F.to);
      return q;
    });
    /* followup_timeline_v does not carry the API's recording_eligible flag, so it is merged in from
       acc.crm_followups (one indexed, join-free query over the same date range). */
    try{
      const el=await trcReadAll(function(){
        let eq=sb.schema('acc').from('crm_followups').select('follow_up_id,recording_eligible')
          .not('recording_eligible','is',null).order('follow_up_id',{ascending:false});
        if(TRC_F.from)eq=eq.gte('call_date',TRC_F.from);
        if(TRC_F.to)eq=eq.lte('call_date',TRC_F.to);
        return eq;
      });
      const flag={};
      (el||[]).forEach(function(e){flag[String(e.follow_up_id)]=e.recording_eligible;});
      out.forEach(function(r){const v=flag[String(r.follow_up_id)];if(v!==undefined)r.recording_eligible=v;});
    }catch(e){}
    out.forEach(function(r){r._enriched=true;});
    TRC_ROWS=out;TRC_ROWS_RANGE=rangeKey;TRC_ROWS_ENRICHED=true;TRC_QA_MERGED_RANGE=null;
    trCacheWrite('trc_fetch_cache_v3',rangeKey,out);
    // Full data answers a light request too (see trcFetchLight) - written under its key as well so a
    // later visit to this same range never fetches a step down from what is already sitting here.
    trCacheWrite('trc_fetch_light_cache_v3',rangeKey,out);
  }catch(e){
    TRC_ROWS=out.length?out:[];TRC_ROWS_RANGE=null;TRC_ROWS_ENRICHED=false;TRC_QA_MERGED_RANGE=null;
    toast('Could not load the call history: '+((e&&e.message)||e),'err');
  }
  return TRC_ROWS;
}

/* Called the instant a proc/match/mismatch card is touched, before that filtered view renders -
   those three need every row in range to actually carry transcription_status/status_match, which
   the fast path never fetched. A no-op once TRC_ROWS already is the full join (see trcFetchFull). */
async function trcEnsureFullEnrichment(){
  if(TRC_ROWS_ENRICHED)return;
  trcShowLoading();
  await trcFetchFull(false);
}

/* THE LIGHT HALF-STEP between the fast path and a full enrichment. CRM Match/CRM Mismatch/a mismatch
   category only ever read status_match/mismatch_type/ai_assessed_status/visit_pending/
   is_latest_assessed - all five are native columns on acc.followup_qa itself, indexed by call_date,
   no join to call_transcripts or transcription_queue needed at all (that heavier join is what
   transcription_status - the 'proc' cards - genuinely still requires, via trcEnsureFullEnrichment).
   Cached per range the same way that one is (TRC_QA_MERGED_RANGE), so switching between CRM Match,
   CRM Mismatch and the four mismatch categories after the first click is a plain guard clause, not a
   refetch every time - which is what made switching between them look like the page kept reloading. */
async function trcEnsureQaFieldsMerged(){
  if(TRC_ROWS_ENRICHED)return;
  const rangeKey=(TRC_F.from||'')+'|'+(TRC_F.to||'');
  if(TRC_QA_MERGED_RANGE===rangeKey)return;
  trcShowLoading();
  try{
    const data=await trcReadAll(function(){
      let q=sb.schema('acc').from('followup_qa').select(
        'follow_up_id,qa_id:id,pitch_score,pitch_status,followup_date_status,lost_reason_status,'
        +'retention_status,etiquette_status,query_handling_status,personal_mobile_status,personal_mobile_number,remarks_status,ai_assessed_status,visit_pending,status_match,mismatch_type,qa_score,qa_model,'
        +'qa_error,reused_transcription,is_latest_assessed').order('follow_up_id',{ascending:false});
      if(TRC_F.from)q=q.gte('call_date',TRC_F.from);
      if(TRC_F.to)q=q.lte('call_date',TRC_F.to);
      return q;
    });
    const byFollowUp={};
    (data||[]).forEach(function(r){byFollowUp[String(r.follow_up_id)]=r;});
    (TRC_ROWS||[]).forEach(function(r,i){
      if(r._enriched)return; // a full enrichment already covers this row and then some - never downgrade it
      const f=byFollowUp[String(r.follow_up_id)];
      if(f)TRC_ROWS[i]=Object.assign({},r,f);
    });
    TRC_QA_MERGED_RANGE=rangeKey;
  }catch(e){
    toast('Could not load match/mismatch data: '+((e&&e.message)||e),'err');
  }
}

/* Bumped on every fetch and page change; an in-flight enrichment request checks it after the await
   and drops its own answer if something else has already moved on - the same cancellation shape
   trcPrefetchCancel uses for the history prefetch below. */
let TRC_ENRICH_GEN=0;

/* A lead whose calls in the CURRENT date range never produced a verdict (no recording, out of scope,
   no conversation) still has a last real judgement somewhere in its history - by requirement
   (2026-09-22), the row should say what it was and on what date, not just read blank. Keyed by
   lead_id (string): a followup_qa row (is_latest_assessed=true) once fetched, or null once confirmed
   this lead has never been assessed at all - either way, never re-queried. Global and never reset by
   a date-range change, because a lead's last judgement does not depend on which range is on screen. */
let TRC_LAST_JUDGEMENT_CACHE={};
let TRC_BACKFILL_GEN=0;
/* THE LAZY HALF OF THE FAST PATH. Only the leads on the CURRENT PAGE get enriched - not the whole
   range, which is exactly the cost trcFetchLight exists to avoid paying up front. Merges straight
   into TRC_ROWS by follow_up_id (acc.crm_lead_detail returns full followup_timeline_v-shaped rows
   per lead, see 20260911090000), marks each merged row _enriched so revisiting this page later, or
   the background history prefetch warming the same lead, never re-asks for it, then re-renders the
   table in place. A no-op once TRC_ROWS is already the full join, or once every row on this page
   already is. */
async function trcEnrichVisiblePage(){
  if(TRC_ROWS_ENRICHED)return;
  const gen=++TRC_ENRICH_GEN;
  const ids=[],seen={};
  (TRC_PAGE_ROWS||[]).forEach(function(g){
    if(g==null||g.lead_id==null)return;
    const k=String(g.lead_id);
    if(seen[k])return;
    const underlying=g.rows||[g];
    if(!underlying.some(function(r){return !r._enriched;}))return;
    seen[k]=1;ids.push(g.lead_id);
  });
  if(!ids.length)return;
  try{
    const {data,error}=await sb.schema('acc').rpc('crm_lead_detail',{p_lead_ids:ids});
    if(error)throw error;
    if(gen!==TRC_ENRICH_GEN)return;
    const byFollowUp={};
    (data||[]).forEach(function(row){
      (row.followups||[]).forEach(function(f){byFollowUp[String(f.follow_up_id)]=f;});
    });
    let changed=false;
    (TRC_ROWS||[]).forEach(function(r,i){
      const f=byFollowUp[String(r.follow_up_id)];
      if(!f)return;
      /* Only TRC_LIGHT's own fields, not everything acc.crm_lead_detail hands back (it returns whole
         followup_timeline_v rows, lead_level_progress fields included) - a list row was never meant
         to carry level_regression_severity (see trcIsRegression's own comment: that flag is
         deliberately lead-detail-only), and enrichment must not start smuggling it in sideways just
         because this row now happens to be fully fetched. */
      const merged={_enriched:true};
      TRC_LIGHT_FIELDS.forEach(function(k){if(f[k]!==undefined)merged[k]=f[k];});
      TRC_ROWS[i]=Object.assign({},r,merged);
      changed=true;
    });
    if(changed&&gen===TRC_ENRICH_GEN){
      // Persisted under the same key trcFetchLight reads, so a reload within the cache window comes
      // back with whichever leads this tab already paid to enrich, not the original blank snapshot.
      trCacheWrite('trc_fetch_light_cache_v3',TRC_ROWS_RANGE,TRC_ROWS);
      trcRender(false,true);
    }
  }catch(e){
    /* Silent: the page still shows every CRM field correctly, just without a transcription/AI status
       yet - the next render of this same page (a re-sort, a page revisit) tries again. */
  }
}

/* THE OTHER LAZY HALF, same shape as trcEnrichVisiblePage but a different question: not "what is
   this call's own status" but "what did we last judge THIS LEAD as, on any date" - for exactly the
   rows that came back with nothing to show (no recording, out of scope, no conversation) so the page
   can say "Last AI Judge Status: Lost (15 Sep)" instead of a blank dash. By requirement (2026-09-22):
   a lead not qualified today, or with no usable recording today, should still read as the lead it is.

   Only the CURRENT PAGE's leads, only the ones trcLeads() just found nothing for, and only once ever
   per lead (TRC_LAST_JUDGEMENT_CACHE, never reset by a date change) - a lead genuinely never assessed
   stays cached as null rather than being re-asked on every page view. followup_qa alone, no join to
   crm_followups/call_transcripts/transcription_queue: is_latest_assessed already marks the one row
   that matters, and the existing lead_id index (20260831090000) makes lead_id IN (this page's ids)
   cheap - nothing like the 3-8s cost the full followup_timeline_v join carries. */
async function trcBackfillLastJudgement(){
  // Mismatch view's TRC_PAGE_ROWS are raw call rows, not lead groups - no g.lastAssessed to check and
  // nothing here renders a lastAssessedOutside cell for them, so there is nothing to backfill.
  if(TRC_F.match==='MISMATCH')return;
  const gen=++TRC_BACKFILL_GEN;
  const ids=[],seen={};
  (TRC_PAGE_ROWS||[]).forEach(function(g){
    if(!g||g.lead_id==null||g.lastAssessed)return;
    const k=String(g.lead_id);
    if(seen[k]||Object.prototype.hasOwnProperty.call(TRC_LAST_JUDGEMENT_CACHE,k))return;
    seen[k]=1;ids.push(g.lead_id);
  });
  if(!ids.length)return;
  try{
    const {data,error}=await sb.schema('acc').from('followup_qa')
      .select('lead_id,follow_up_id,ai_assessed_status,visit_pending,status_match,mismatch_type,'
        +'call_date,call_start_text')
      .in('lead_id',ids).eq('is_latest_assessed',true);
    if(error)throw error;
    if(gen!==TRC_BACKFILL_GEN)return;
    const byLead={};
    (data||[]).forEach(function(r){byLead[String(r.lead_id)]=r;});
    // Every requested id gets a cache entry, found or not - a miss is a real answer (never assessed)
    // and must stick, or a lead with no history gets re-queried on every single page visit.
    ids.forEach(function(id){
      const k=String(id);
      TRC_LAST_JUDGEMENT_CACHE[k]=byLead[k]||null;
    });
    if(gen===TRC_BACKFILL_GEN)trcRender(false,true);
  }catch(e){
    /* Silent, same as trcEnrichVisiblePage - the row just keeps showing a dash until a later render
       (a re-sort, a page revisit) tries again; nothing is cached on failure so it does retry. */
  }
}

function trcRowDate(r){
  return r.call_date || (r.communication_time?String(r.communication_time).slice(0,10):null);
}

/* The fast path for the KPI cards: one row per day, summed here instead of scanning every fetched
   follow-up. total_leads is deliberately NOT summed from daily_qa_summary - a lead who called on two
   different days in range is one lead, not two - so it comes from its own COUNT(DISTINCT) against
   crm_followups, which needs no join to the heavy tables and stays cheap on any range. Never throws:
   a failure here just means trcKpiHtml falls back to counting rows itself, exactly as before this
   existed. */
async function trcKpiFastFetch(force){
  const rangeKey=(TRC_F.from||'')+'|'+(TRC_F.to||'');
  if(TRC_KPI_FAST&&!force&&TRC_KPI_FAST_RANGE===rangeKey)return TRC_KPI_FAST;
  try{
    /* One call to acc.eligible_kpis: counts over the calls the CRM API flags recording_eligible only,
       each in exactly one bucket (transcribed / waiting / failed / no conversation / no recording), so
       the cards can never disagree with the eligible total. Lead counts come from the same query. */
    const {data,error}=await sb.schema('acc').rpc('eligible_kpis',{p_from:TRC_F.from||null,p_to:TRC_F.to||null});
    if(error)throw error;
    const d=data||{};
    const sum={};
    Object.keys(d).forEach(function(k){sum[k]=Number(d[k]||0);});
    /* Names the rest of this page already reads. */
    sum.total_followups=sum.eligible;
    sum.total_leads=sum.eligible_leads;
    sum.transcribed=sum.completed;
    sum.pending=sum.not_transcribed;
    sum.transcription_failed=sum.failed;
    sum.reused_transcription=sum.reused;
    TRC_KPI_FAST=sum;TRC_KPI_FAST_RANGE=rangeKey;
  }catch(e){
    TRC_KPI_FAST=null;TRC_KPI_FAST_RANGE=null;
  }
  return TRC_KPI_FAST;
}

/* THE RECONCILIATION CHECK. daily_qa_summary is kept live by triggers - the moment a recording gets
   transcribed or judged, its day's row updates - but trcFetch's own row-level cache is sessionStorage,
   good for TRC_CACHE_TTL_MS (hours). Between those two, "how many follow-ups in this range" can
   disagree: the fast total already counts a call the pipeline finished ten minutes ago, the cached row
   list still doesn't have it. That gap is exactly what surfaced as "9 mismatches, but only 1 row in the
   table" - the count was live, the list was stale. One cheap check catches it: if the two totals for
   the SAME range don't match, the row cache is behind, so force one real refetch (bypassing the cache)
   to bring it current. Only ever fires the extra request when there is actually something to fix. */
async function trcFetchBoth(){
  await Promise.all([trcFetch(false),trcKpiFastFetch()]);
  if(TRC_KPI_FAST&&TRC_ROWS&&TRC_KPI_FAST.total_followups!==TRC_ROWS.filter(trcRecordingEligible).length){
    await trcFetch(true);
  }
}

/* Makes good on the promise above: if the lead a deep link names isn't in the date-ranged fetch at
   all, go get it by lead_id alone (cheap - indexed, one lead's rows, no window functions to prune)
   so trcRender can still put its row on screen. Skipped entirely once the lead is already there, and
   not re-fetched on every render once it's been pinned for this id. */
async function trcEnsurePinnedLead(){
  const id=TRC_LAST_LEAD_ID;
  if(id==null){TRC_PIN_ID=null;TRC_PIN_ROWS=null;return;}
  if((TRC_ROWS||[]).some(function(r){return String(r.lead_id)===String(id);})){
    TRC_PIN_ID=null;TRC_PIN_ROWS=null;return;
  }
  if(TRC_PIN_ID===String(id))return;
  try{
    const {data,error}=await sb.schema('acc').from('followup_timeline_v').select(TRC_LIGHT).eq('lead_id',id);
    if(error)throw error;
    TRC_PIN_ID=String(id);TRC_PIN_ROWS=data||[];
  }catch(e){TRC_PIN_ID=null;TRC_PIN_ROWS=null;}
}

/* There used to be a lead-level gate here mirroring crm_build_queue's: a call was dropped whenever the
   LEAD'S OWN LAST CALL FROM AN EARLIER DAY was confirmed Sales, even a call that was itself Pre-Sales.
   That rule is gone from crm_build_queue - eligibility is decided by the decision date alone, never by
   an earlier day - so this side dropped the matching gate too, to keep the queue and the screen from
   disagreeing. Nothing here still needs a lead's history beyond the selected window (see trcFetch). */

/* Every filter, applied together. skipCards lifts the two card filters so the four totals stay put
   while one of them is selected - clicking Mismatch must not collapse Transcribed to the mismatches. */
function trcApply(rows,skipCards,allCalls){
  const q=String(TRC_F.q||'').trim().toLowerCase();
  const all=rows||[];
  return all.filter(function(r){
    if(!allCalls&&!trcRecordingEligible(r))return false;
    const d=trcRowDate(r);
    if(TRC_F.from&&(!d||d<TRC_F.from))return false;
    if(TRC_F.to&&(!d||d>TRC_F.to))return false;
    if(TRC_F.crm!=='all'&&String(r.crm_status||'')!==TRC_F.crm)return false;
    if(TRC_F.bu!=='all'&&String(r.business_unit_name||'')!==TRC_F.bu)return false;
    /* Case-insensitively: the option values come from the roster, which stores addresses lowercased
       (that is what acc.crm_presales_emails() compares against), while personnel_email is whatever
       casing the CRM happened to send. Matching those exactly is how a selected caller's own calls
       end up filtered out from under them. */
    if(TRC_F.personnel!=='all'&&String(r.personnel_email||'').toLowerCase()!==String(TRC_F.personnel).toLowerCase())return false;
    // Same shape as crm/bu above - an independent lens on the follow-up's own two accuracy verdicts,
    // combined by AND with every other filter rather than acting as a fourth KPI-card tab. 'NONE'
    // means "not assessed at all" (no QA row yet, or transcribed with nothing to judge), not a status
    // value the model ever returns.
    if(TRC_F.fdate!=='all'){
      if(TRC_F.fdate==='NONE'){ if(r.followup_date_status)return false; }
      else if(String(r.followup_date_status||'')!==TRC_F.fdate)return false;
    }
    if(TRC_F.remarks!=='all'){
      if(TRC_F.remarks==='NONE'){ if(r.remarks_status)return false; }
      else if(String(r.remarks_status||'')!==TRC_F.remarks)return false;
    }
    if(TRC_F.pitch!=='all'){
      if(TRC_F.pitch==='NONE'){ if(r.pitch_status)return false; }
      else if(String(r.pitch_status||'')!==TRC_F.pitch)return false;
    }
    if(TRC_F.etiquette!=='all'){
      if(TRC_F.etiquette==='NONE'){ if(r.etiquette_status)return false; }
      else if(String(r.etiquette_status||'')!==TRC_F.etiquette)return false;
    }
    if(TRC_F.queryHandling!=='all'){
      if(TRC_F.queryHandling==='NONE'){ if(r.query_handling_status)return false; }
      else if(String(r.query_handling_status||'')!==TRC_F.queryHandling)return false;
    }
    if(TRC_F.retention!=='all'){
      if(TRC_F.retention==='NONE'){ if(r.retention_status)return false; }
      else if(String(r.retention_status||'')!==TRC_F.retention)return false;
    }
    if(TRC_F.lostReason!=='all'){
      if(TRC_F.lostReason==='NONE'){ if(r.lost_reason_status)return false; }
      else if(String(r.lost_reason_status||'')!==TRC_F.lostReason)return false;
    }
    if(TRC_F.personalMobile!=='all'){
      if(TRC_F.personalMobile==='NONE'){ if(r.personal_mobile_status)return false; }
      else if(String(r.personal_mobile_status||'')!==TRC_F.personalMobile)return false;
    }
    if(!skipCards){
      if(TRC_F.proc!=='all'&&trcEligBucket(r)!==TRC_F.proc)return false;
      // MATCH/MISMATCH mean "currently" (see trcCountsMatch/trcCountsMismatch) - a superseded old
      // verdict does not belong in either drill-down, only in the lead's own history.
      if(TRC_F.match==='MATCH'&&!trcCountsMatch(r))return false;
      if(TRC_F.match==='MISMATCH'&&!trcCountsMismatch(r))return false;
      if(TRC_F.match==='NONE'&&r.status_match!==null&&r.status_match!==undefined)return false;
      if(TRC_F.mismatch!=='all'&&(!trcCountsMismatch(r)||String(r.mismatch_type||'')!==TRC_F.mismatch))return false;
    }
    if(q){
      const hay=String(r.lead_id||'')+' '+String(r.lead_name||'')+' '+String(r.follow_up_id||'')
        +' '+String(r.personnel_name||'')+' '+String(r.personnel_email||'');
      if(hay.toLowerCase().indexOf(q)<0)return false;
    }
    return true;
  });
}

/* Follow-ups rolled up to the leads they belong to. Newest lead first (the day's own work is what
   someone opens this page for); the follow-ups INSIDE a lead stay oldest-first, because a
   conversation history only means anything read forwards. */
function trcLeads(rows){
  const by={};
  /* A Sales call that never actually transcribed has no verdict of its own to roll up - counting it
     among "recordings"/"transcribed"/"assessed", or letting it be g.last, would show a lead's summary
     pointing at a blank call instead of the one that actually carries the last real read on it. See
     trcIsSkippedSalesCall. This only changes what the LEAD'S OWN rollup and "last call" are built
     from - the chips and KPI cards above the table still count every follow-up, Sales included. */
  (rows||[]).filter(function(r){return !trcIsSkippedSalesCall(r);}).forEach(function(r){
    const k=String(r.lead_id);
    if(!by[k])by[k]={lead_id:r.lead_id,name:r.lead_name,bu:r.business_unit_name,
                     status:r.lead_current_status,lost_reason:r.lead_current_lost_reason,rows:[]};
    by[k].rows.push(r);
    if(!by[k].name&&r.lead_name)by[k].name=r.lead_name;
    if(!by[k].bu&&r.business_unit_name)by[k].bu=r.business_unit_name;
  });
  return Object.keys(by).map(function(k){
    const g=by[k];
    g.rows.sort(trcChrono);
    g.last=g.rows[g.rows.length-1];
    g.lastDate=trcRowDate(g.last);
    /* When this lead is due next, taken from the newest call that actually left a date rather than
       simply the newest call: a latest follow-up logged with the field blank would otherwise read as
       "no date" on a lead that does have one standing. */
    g.nextFollowUp=null;
    for(let i=g.rows.length-1;i>=0&&!g.nextFollowUp;i--){
      if(g.rows[i].next_follow_up_text)g.nextFollowUp=g.rows[i].next_follow_up_text;
    }
    /* By requirement (2026-09-19): if the lead's last call has no recording, wasn't transcribed, or is
       otherwise unassessed, the AI-status column should keep showing the last call that WAS actually
       assessed, not go blank. g.last stays "the most recent call" for remarks/navigation, which are
       about the latest interaction regardless of whether it produced a verdict. */
    g.lastAssessed=null;
    for(let i=g.rows.length-1;i>=0&&!g.lastAssessed;i--){
      if(g.rows[i].ai_assessed_status)g.lastAssessed=g.rows[i];
    }
    /* Nothing in the current range was assessed - fall back to this lead's actual last judgement,
       wherever it happened, if trcBackfillLastJudgement has already fetched it (see that function).
       Kept as a SEPARATE field from g.lastAssessed, never merged into it, so trcLeadRowHtml can tell
       "this call, in this range" from "carried over from another date" and label it accordingly. */
    g.lastAssessedOutside=g.lastAssessed?null:(TRC_LAST_JUDGEMENT_CACHE[k]||null);
    g.recordings=g.rows.filter(function(r){return r.has_recording;}).length;
    g.transcribed=g.rows.filter(function(r){return r.transcription_status==='completed';}).length;
    g.assessed=g.rows.filter(function(r){return r.qa_id;}).length;
    g.mismatches=g.rows.filter(trcCountsMismatch).length;
    g.regressions=g.rows.filter(trcIsRegression).length;
    g.ovHealth=trcOvHealth(g.status,g.rows);
    /* Cadence and callback TAT judge a lead's WHOLE follow-up history, not just whatever slice of it
       falls inside the selected date range - g.rows is range-limited, so judging off it directly would
       silently score a lead only on the one call that happened to land in the window (which is why
       these used to collapse to "the latest call in
       range" when the range is a single day). The full history is exactly what trcPrefetchHistories
       already warms in the background for click-through (see trcAfterListRender) - reuse it once it
       has arrived; a lead not yet warmed simply falls back to the range-limited rows for this one
       render, same as every other lazily-enriched field here, until trcPrefetchHistories' own
       completion re-render (see its own note) picks it up. */
    const cachedHistory=trcLeadCacheRead(g.lead_id);
    const historyRows=cachedHistory?cachedHistory.rows:g.rows;
    /* Pending until the real history has arrived (see trcEnsureHistories): scoring a lead off only
       the one call in the date range gave answers that flipped the moment its history loaded. */
    g.historyPending=!cachedHistory&&!TRC_HIST_TRIED[String(g.lead_id)];
    g.cadence=g.historyPending?null:trcCadenceIssues(g.status,historyRows,'late');
    g.promised=g.historyPending?null:trcCadenceIssues(g.status,historyRows,'promised');
    g.missedIn=g.historyPending?null:trcMissedIncomingCallback(historyRows);
    g.trail=[];
    g.rows.forEach(function(r){
      const s=r.crm_status;
      if(s&&g.trail[g.trail.length-1]!==s)g.trail.push(s);
    });
    const scored=g.rows.filter(function(r){return r.pitch_score!==null&&r.pitch_score!==undefined;});
    g.pitch=scored.length?Math.round(scored.reduce(function(a,r){return a+Number(r.pitch_score);},0)/scored.length):null;
    const qas=g.rows.filter(function(r){return r.qa_score!==null&&r.qa_score!==undefined;});
    g.qa=qas.length?Math.round(qas.reduce(function(a,r){return a+Number(r.qa_score);},0)/qas.length):null;
    return g;
  }).sort(function(a,b){
    return String(b.lastDate||'').localeCompare(String(a.lastDate||''))
        || Number(b.last&&b.last.follow_up_id||0)-Number(a.last&&a.last.follow_up_id||0);
  });
}

/* Chronological, and deliberately not by follow_up_id alone: the CRM's ids ascend with creation, but
   communication_time is when the conversation actually happened, and a back-filled follow-up has the
   higher id and the earlier time. Time first, id only to break a tie. */
function trcChrono(a,b){
  const ta=a.communication_time||a.call_date||'', tb=b.communication_time||b.call_date||'';
  return String(ta).localeCompare(String(tb)) || Number(a.follow_up_id||0)-Number(b.follow_up_id||0);
}

/* ---- skeletons. trcFetch's own floor is a few seconds (see TRC_LIGHT above) before a single row can
   be drawn, so a bare spinner leaves the page looking empty rather than working. These stand in for
   the KPI cards and the table body in roughly the shape the real content will take, so the page reads
   as "loading this" rather than "loading something". ---- */
function trcSkelBar(w,h){
  return '<span class="skel" style="width:'+w+';height:'+(h||12)+'px"></span>';
}
/* Stands in for everything #trcKpis holds, not just the four cards: the five status pills and the two
   counters beside them live in that same block (see trcKpiHtml) and are just as much a per-range
   number, so leaving them out of the skeleton left a row of real-looking counts sitting under four
   loading cards. The pill widths vary because the real ones are sized by their labels - a row of
   identical bars reads as a progress bar rather than as the buttons it is about to become. */
function trcSkeletonKpis(){
  const pill=function(w){
    return '<span class="btn btn-sm" style="pointer-events:none">'+trcSkelBar(w,11)+'</span>';
  };
  return '<div class="grid kpis" style="grid-template-columns:repeat(4,1fr)">'
    +Array(4).fill(0).map(function(){
      return '<div class="kpi">'+trcSkelBar('60%',11)+'<div style="margin-top:10px">'+trcSkelBar('35%',26)+'</div>'
        +'<div style="margin-top:9px">'+trcSkelBar('80%',11)+'</div></div>';
    }).join('')+'</div>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center">'
    +['58px','82px','96px','44px','70px'].map(pill).join('')
    +'<span style="width:1px;height:22px;background:var(--line)"></span>'
    +trcSkelBar('90px',11)+trcSkelBar('150px',11)
    +'</div>';
}
/* Everything on this page that is a NUMBER FOR THE SELECTED RANGE, put back into its loading state
   together. The date handlers below used to skeleton the table body alone, which left the KPI cards,
   the status pills and the row count reading out the PREVIOUS range's totals - and reading them
   confidently, in their normal styling - for the several seconds the new range takes to come back.
   Same set on every path that refetches (a new range, Clear filters, Refresh), because a stale total
   is equally wrong whichever of them asked for the data. */
function trcShowLoading(){
  const k=$('trcKpis');if(k)k.innerHTML=trcSkeletonKpis();
  const b=$('trcRows');if(b)b.innerHTML=trcSkeletonRows();
  /* Emptied rather than skeletoned: it is one short line of text at the top of the card, and a grey
     bar where a sentence goes looks like a rendering fault rather than like waiting. */
  const c=$('trcCount');if(c)c.textContent='';
}
function trcSkeletonRows(n){
  n=n||8;
  let out='';
  for(let i=0;i<n;i++){
    out+='<tr>'
      +'<td>'+trcSkelBar('16px')+'</td>'
      +'<td>'+trcSkelBar('48px')+'</td>'
      +'<td>'+trcSkelBar('68%')+'<div style="margin-top:6px">'+trcSkelBar('42%',9)+'</div></td>'
      +'<td>'+trcSkelBar('72px',20)+'</td>'
      +'<td>'+trcSkelBar('72px',20)+'</td>'
      +'<td>'+trcSkelBar('84px',20)+'</td>'
      +'<td>'+trcSkelBar('60%')+'</td>'
      +'<td>'+trcSkelBar('92px')+'</td>'
      +'<td>'+trcSkelBar('70%')+'</td>'
      +'<td>'+trcSkelBar('80%')+'</td>'
    +'</tr>';
  }
  return out;
}
/* One lead's history: two queries (crm_leads + the full followup_timeline_v for this lead_id, see
   trcLeadDetail) that pay the same fixed window-function cost as the list does - shaped like the
   page-head, the tag strip, the lead-details table and a couple of call cards it will actually become,
   so the page doesn't just go blank between the click and the data landing. */
function trcLeadSkeletonHtml(){
  const chip=function(w){return '<span class="skel" style="width:'+w+';height:22px;border-radius:999px"></span>';};
  const kvLine=function(){
    return '<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--line)">'
      +trcSkelBar('110px',11)+trcSkelBar('55%',11)+'</div>';
  };
  const callCard=function(){
    return '<div class="card card-pad" style="margin-top:14px">'
      +'<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">'
        +chip('64px')+chip('150px')+chip('90px')+chip('110px')+'</div>'
      +'<div class="grid trc-two" style="grid-template-columns:1fr 1fr;gap:14px">'
        +'<div class="card card-pad" style="margin:0">'+Array(5).fill(0).map(kvLine).join('')+'</div>'
        +'<div class="card card-pad" style="margin:0">'+Array(5).fill(0).map(kvLine).join('')+'</div>'
      +'</div></div>';
  };
  return '<div class="page-head"><div>'
      +trcSkelBar('220px',26)+'<div style="margin-top:10px">'+trcSkelBar('160px',12)+'</div></div>'
      +'<div style="display:flex;gap:10px"><span class="skel" style="width:96px;height:34px;border-radius:9px"></span>'
      +'<span class="skel" style="width:172px;height:34px;border-radius:9px"></span></div></div>'
    +'<div class="card card-pad" style="display:flex;gap:14px;flex-wrap:wrap">'
      +chip('90px')+chip('90px')+chip('96px')+chip('120px')+chip('120px')+'</div>'
    +'<div class="card card-pad" style="margin-top:16px">'+Array(4).fill(0).map(kvLine).join('')+'</div>'
    +callCard()+callCard();
}

/* ---- the dashboard. Same four cards and the same chips as before; what changed underneath is that
   a "call" is now a follow-up in the CRM's own history rather than a row we happened to import. ---- */
function trcKpiHtml(rows,shownRows){
  const n=function(st){return rows.filter(function(r){return trcEligBucket(r)===st;}).length;};
  /* The four cards, "QA assessed" and "Reused an existing transcript" all have one unambiguous,
     purely-additive definition each, verified to match acc.daily_qa_summary_v exactly (see
     20260917110000) - so they can come from that day-summed table instead of scanning every fetched
     row. Only when the scope is genuinely "the whole range, no extra narrowing": daily_qa_summary has
     no breakdown by CRM status, business unit, personnel or search text, so any of those being active
     means the day totals can no longer answer the question and this falls back to counting `rows`
     exactly as it always did. The five status chips below stay on that same client count in every
     case - trcTrStatus's not_transcribed/queue_status split is a per-row judgement call this table
     does not attempt to reproduce, and getting that wrong quietly would be worse than leaving it slow. */
  const rangeKey=(TRC_F.from||'')+'|'+(TRC_F.to||'');
  const fast=(TRC_F.crm==='all'&&TRC_F.bu==='all'&&TRC_F.personnel==='all'&&!String(TRC_F.q||'').trim()
              &&TRC_KPI_FAST&&TRC_KPI_FAST_RANGE===rangeKey)?TRC_KPI_FAST:null;
  /* Every card's own lead count - always counted from `rows` (the fetched range, filtered by date/CRM
     status/business unit/personnel/search but not by which card is active), never from the fast path:
     there is no per-category distinct-lead total to sum from acc.daily_qa_summary (the same reason
     total_leads has its own RPC instead of being a column there - a lead transcribed on two different
     days is one lead, not two), and this is cheap enough as a plain array scan that it never needed
     one. */
  const leadsOf=function(pred){return new Set(rows.filter(pred).map(function(r){return r.lead_id;})).size;};
  /* Transcribed/Match/Mismatch's lead counts need enrichment: they read
     trcTrStatus/status_match, which the fast crm_followups-only fetch never carries (see
     trcFetchLight) until trcEnrichVisiblePage fills in whichever leads are actually on screen. Asking
     for them across the whole range before that would silently undercount almost everything, so the
     subtitle just leaves the lead count off until the row data backs it up. */
  const haveDetail=TRC_ROWS_ENRICHED;
  const transcribedLeads=fast?fast.completed_leads:(haveDetail?leadsOf(function(r){return trcEligBucket(r)==='completed';}):null);
  /* Match/Mismatch's lead counts, unlike Transcribed's, DO have a fast source now
     (acc.daily_qa_summary's *_leads columns, 20260918110000) - is_latest_assessed makes a lead's
     match/mismatch contribution land on exactly one day ever, so summing per-day distinct-lead
     counts across a range is exact, not an approximation. Reading it here means these two numbers
     are correct even when most of `rows` was never enriched (a wide range, most pages never
     visited) - which is exactly the gap that once showed "216 total, in 0 leads". */
  const haveMatchLeads=fast||haveDetail;
  const matchLeads=fast?fast.status_match_leads:(haveDetail?leadsOf(trcCountsMatch):null);
  const mismatchLeads=fast?fast.status_mismatch_leads:(haveDetail?leadsOf(trcCountsMismatch):null);
  const inLeads=function(c){return c+' lead'+(c===1?'':'s');};
  /* "Eligible for transcription": every call the CRM API flags recording_eligible (see
     trcRecordingEligible) - this is the total that Waiting, Failed, Transcribed and so on break down.
     `rows` is already narrowed to those calls, and lead_id is on every row, so it needs no enrichment. */
  const eligibleCalls=fast?fast.eligible:rows.length;
  const eligibleLeads=fast?fast.eligible_leads:leadsOf(function(){return true;});
  const cards=[
    ['Eligible for transcription',eligibleCalls,'in '+inLeads(eligibleLeads),'var(--slate)','all','proc'],
    ['Transcribed',fast?fast.transcribed:n('completed'),
      'with a full transcript'+(transcribedLeads!==null?', in '+inLeads(transcribedLeads):''),'#16a34a','completed','proc'],
    ['CRM Match',fast?fast.status_match:rows.filter(trcCountsMatch).length,
      'agrees with the CRM'+(haveMatchLeads?', in '+inLeads(matchLeads):''),'#16a34a','MATCH','match'],
    ['CRM Mismatch',fast?fast.status_mismatch:rows.filter(trcCountsMismatch).length,
      'disagrees with the CRM'+(haveMatchLeads?', in '+inLeads(mismatchLeads):''),'#dc2626','MISMATCH','match']
  ];
  /* Same fast/slow split as the cards above - these five read trcTrStatus per row exactly like the
     lead counts do, so they are just as blind on an unenriched fast fetch. acc.daily_qa_summary
     stores the closest matching column for each (see 20260917110000's own note on where its
     pending/not_in_scope categories drift slightly from trcTrStatus's queue_status-truthiness split -
     an approximation, but a far closer one than reading undefined off every row not yet enriched). */
  /* "Not in scope" chip is back (it was dropped 2026-09-18) - this time counting LEADS, not calls. A
     lead is out of scope when a call of theirs never entered the transcription queue (trcTrStatus), and
     that needs row-level data, so it reads '…' until the fuller lead data has loaded, like the
     missed-incoming / late-follow-up chips. */
  /* "Not in scope" is gone (a call that never entered the queue is not an eligible call). "No recording" is
     back, but now counts only ELIGIBLE calls: the API can flag a call eligible while its recording_url
     is still empty, and those are exactly the calls that can never be transcribed. */
  const noRecording=fast?fast.no_recording:n('no_recording');
  const sub=[
    ['Waiting','not_transcribed',fast?fast.pending:n('not_transcribed'),'fa-clock'],
    ['Failed','failed',fast?fast.failed:n('failed'),'fa-circle-exclamation'],
    ['No conversation','non_transcribable',fast?fast.non_transcribable:n('non_transcribable'),'fa-volume-xmark'],
    ['No recording','no_recording',noRecording,'fa-phone-slash']
  ];
  const assessed=fast?fast.qa_assessed:rows.filter(function(r){return r.qa_id;}).length;
  const reused=fast?fast.reused_transcription:rows.filter(function(r){return r.reused_transcription;}).length;
  /* Missed callback needs lead_current_status (to exclude Lost leads), which only the full join
     carries (see TRC_LIGHT) - same enrichment tier the 'proc' cards already require. Computed by
     actually rolling `rows` up into leads (trcLeads), not a flat count, because "overdue" is a
     property of a LEAD's latest call, not of any one row. */
  const shownLeads=haveDetail?trcLeads(shownRows||rows):[];
  const histDone=haveDetail&&shownLeads.every(function(g){return !g.historyPending;});
  const missedInLeads=histDone?shownLeads.filter(function(g){return g.missedIn;}).length:null;
  const cadenceLeads=histDone?shownLeads.filter(function(g){return g.cadence;}).length:null;
  const promisedLeads=histDone?shownLeads.filter(function(g){return g.promised;}).length:null;
  return '<div class="grid kpis" style="grid-template-columns:repeat(4,1fr)">'+cards.map(function(c){
      const active=(c[5]==='proc'?TRC_F.proc:TRC_F.match)===c[4];
      return '<div class="kpi" style="cursor:pointer'+(active?';box-shadow:inset 0 0 0 2px '+c[3]:'')+'" onclick="trcCard(\''+c[5]+'\',\''+c[4]+'\')">'
        +'<div class="lbl" style="margin-bottom:7px">'+esc(c[0])+(active?' <i class="fa-solid fa-filter" style="font-size:10px"></i>':'')+'</div>'
        +'<div class="val">'+c[1]+'</div>'
        +'<div style="font-size:12px;color:'+c[3]+';margin-top:3px">'+esc(c[2])+'</div></div>';
    }).join('')+'</div>'
    +'<div class="card card-pad" style="margin-top:12px;padding-top:10px;padding-bottom:10px">'
    +'<div style="font-size:12px;font-weight:600;color:var(--slate);margin-bottom:8px">Eligible calls not transcribed yet</div>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'+sub.map(function(s){
      const on=TRC_F.proc===s[1];
      return '<button class="btn btn-sm'+(on?' btn-primary':'')+'" onclick="trcCard(\'proc\',\''+s[1]+'\')">'
        +'<i class="fa-solid '+s[3]+'"></i> '+esc(s[0])+' <b>'+s[2]+'</b></button>';
    }).join('')
    +'<span style="width:1px;height:22px;background:var(--line)"></span>'
    +'<span style="font-size:12.5px;color:var(--slate)">QA assessed <b style="color:var(--ink)">'+assessed+'</b></span>'
    /* Deduplication is invisible unless it is counted. This is the number of follow-ups that reused a
       transcript already paid for, which is the whole point of keying on recording_url. */
    +'<span style="font-size:12.5px;color:var(--slate)">Reused an existing transcript <b style="color:var(--ink)">'+reused+'</b></span>'
    +'</div></div>'
    +'<div class="card card-pad" style="margin-top:12px;padding-top:10px;padding-bottom:10px">'
    +'<div style="font-size:12px;font-weight:600;color:var(--slate);margin-bottom:8px">Lead follow-up checks (whole call history)</div>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
    +'<button class="btn btn-sm'+(TRC_F.missedIn==='1'?' btn-primary':'')+'" onclick="trcToggleMissedIn()" title="The lead called in and the call was missed (logged as incoming call missed), and no callback was logged within 24 hours. Not counted until the fuller lead data has loaded">'
      +'<i class="fa-solid fa-phone-slash"></i> Missed callback'+(missedInLeads===null?(haveDetail?' <b>…</b>':''):' <b>'+missedInLeads+'</b>')+'</button>'
    +'<button class="btn btn-sm'+(TRC_F.promised==='1'?' btn-primary':'')+'" onclick="trcTogglePromised()" title="The agent promised a call back on a set date, that date has passed, and no call has been logged since. Not counted until the fuller lead data has loaded">'
      +'<i class="fa-solid fa-calendar-xmark"></i> Promised call - not called back'+(promisedLeads===null?(haveDetail?' <b>…</b>':''):' <b>'+promisedLeads+'</b>')+'</button>'
    +'<button class="btn btn-sm'+(TRC_F.cadence==='1'?' btn-primary':'')+'" onclick="trcToggleCadence()" title="The agent set a next follow-up date and the next call came after that date (every call is checked against the date set on the call before it). Not counted until the fuller lead data has loaded">'
      +'<i class="fa-solid fa-hourglass-half"></i> Late follow-ups'+(cadenceLeads===null?(haveDetail?' <b>…</b>':''):' <b>'+cadenceLeads+'</b>')+'</button>'
    +'</div></div>'
    +(TRC_F.match==='MISMATCH'?trcMismatchPanel(rows,fast):'');
}

/* The mismatch counts the specification asks for, by name (four). Only rendered when Mismatch is the active
   card, because that is the question they answer: of the calls where the CRM and the conversation
   disagree, WHICH WAY do they disagree. Each one filters the table under it. */
function trcMismatchPanel(rows,fast){
  /* Same fast/slow split as the cards above, and for the same reason the CRM Mismatch card itself can
     read 289 while these four used to read 51 and stop: rows only ever holds what date/CRM
     status/business unit/personnel/search let through, but the CARD's own number came from the day
     table, so the two could silently disagree the moment fast was eligible. Reading these four counts
     from the SAME source as the card (fast.* here, exactly the columns acc.daily_qa_summary stores)
     keeps the panel's own total honest against it - "other" then also comes from fast, only falling
     back to rows when fast is not eligible in the first place. */
  const total=fast?fast.status_mismatch:rows.filter(trcCountsMismatch).length;
  const counts={};
  TRC_MISMATCH_KEYS.forEach(function(k){
    counts[k]=fast?(fast[k]||0):rows.filter(function(r){return trcCountsMismatch(r)&&r.mismatch_type===k;}).length;
  });
  const known=TRC_MISMATCH_KEYS.reduce(function(a,k){return a+counts[k];},0);
  const other=Math.max(0,total-known);
  /* Lead counts DO have a fast source now (acc.daily_qa_summary's *_leads columns, 20260918110000) -
     is_latest_assessed makes a lead's mismatch contribution land on exactly one day ever, so summing
     per-day distinct-lead counts across a range is exact. This is what fixed "216 total, in 0 leads":
     the old client-side count read status_match/is_latest_assessed off `rows`, which on a wide range
     mostly was never enriched (see trcFetchLight) and so silently read as 0 almost everywhere.
     Falls back to counting `rows` (scope, the whole range's fetched rows - not narrowed by whichever
     category is currently selected) only when fast is not eligible (a CRM/business-unit/personnel/
     search filter is active - the day table has no breakdown by those). */
  const leadsOf=function(pred){return new Set(rows.filter(pred).map(function(r){return r.lead_id;})).size;};
  const totalLeads=fast?fast.status_mismatch_leads:leadsOf(trcCountsMismatch);
  const leadCounts={};
  TRC_MISMATCH_KEYS.forEach(function(k){
    leadCounts[k]=fast?(fast[k+'_leads']||0):leadsOf(function(r){return trcCountsMismatch(r)&&r.mismatch_type===k;});
  });
  return '<div class="card card-pad" style="margin-top:14px">'
    +'<div class="sec-title" style="margin:0 0 4px"><i class="fa-solid fa-scale-unbalanced" style="color:#dc2626"></i> Where the CRM and the call disagree'
    +'<span style="font-weight:400;color:var(--slate);font-size:13px;margin-left:8px">'+total+' total, in '+totalLeads+' lead'+(totalLeads===1?'':'s')+'</span></div>'
    +'<div style="font-size:12.5px;color:var(--slate);margin-bottom:12px">Counted per follow-up, from the CRM status recorded against that call and what the conversation actually established.</div>'
    +'<div class="grid" style="grid-template-columns:repeat('+TRC_MISMATCH_KEYS.length+',1fr);gap:12px">'
    +TRC_MISMATCH_KEYS.map(function(k){
      const m=TRC_MISMATCH[k],on=TRC_F.mismatch===k;
      return '<div class="card card-pad" style="margin:0;cursor:pointer'+(on?';box-shadow:inset 0 0 0 2px '+m.colour:'')+'" onclick="trcSet(\'mismatch\',\''+(on?'all':k)+'\')">'
        +'<div style="display:flex;align-items:center;gap:8px"><i class="fa-solid '+m.icon+'" style="color:'+m.colour+'"></i>'
        +'<div style="font-size:26px;font-weight:700;line-height:1">'+counts[k]+'</div>'
        +'<span style="font-size:11.5px;color:var(--slate)">in '+leadCounts[k]+' lead'+(leadCounts[k]===1?'':'s')+'</span></div>'
        +'<div style="font-size:12.5px;font-weight:600;margin-top:8px">'+esc(m.label)+'</div>'
        +'<div style="font-size:11.5px;color:var(--slate);line-height:1.5;margin-top:4px">'+esc(m.blurb)+'</div>'
      +'</div>';
    }).join('')+'</div>'
    +(other?'<div style="margin-top:10px;font-size:12.5px;color:var(--slate)">'+other
      +' further disagreement'+(other===1?'':'s')+' on a CRM status outside these four categories (Site Visited, OV and similar).</div>':'')
  +'</div>';
}

/* The four KPI cards act as one set of tabs, not two independent filters - picking "CRM Mismatch"
   while "Transcribed" was still active used to AND the two together and silently empty the table.
   So every card click closes whichever of the other three was open before opening this one. */
window.trcCard=async function(kind,val){
  if(kind==='proc'){
    TRC_F.proc=(TRC_F.proc===val?'all':val);
    TRC_F.match='all';TRC_F.mismatch='all';
  }else{
    TRC_F.match=(TRC_F.match===val?'all':val);
    TRC_F.proc='all';
    // Leaving Mismatch must not leave its category filter behind, silently hiding rows.
    if(TRC_F.match!=='MISMATCH')TRC_F.mismatch='all';
  }
  // proc genuinely needs transcription_status (call_transcripts/transcription_queue - the full join);
  // match/mismatch only ever need what acc.followup_qa already carries on its own - see
  // trcEnsureQaFieldsMerged for why that is the lighter, and much more common, of the two.
  if(TRC_F.proc!=='all')await trcEnsureFullEnrichment();
  else if(TRC_F.match!=='all')await trcEnsureQaFieldsMerged();
  trcRender(true);
};

/* An independent toggle, not another tab in the group above - it narrows whichever set of leads is
   already on screen down to the ones with a missed incoming call that was not called back properly
   (see trcMissedIncomingCallback). */
window.trcToggleMissedIn=async function(){
  TRC_F.missedIn=(TRC_F.missedIn==='1'?'all':'1');
  if(TRC_F.missedIn==='1'){
    await trcEnsureFullEnrichment();
    trcRender(true);
    await trcEnsureHistories(TRC_LIST_LEAD_IDS);
  }
  trcRender(true);
};
/* Same idea as trcToggleMissedIn, narrowing to leads where a follow-up date the agent set was missed (see
   trcCadenceIssues). Needs the full join for the same reason -
   the check is skipped for Lost leads, which only lead_current_status (TRC_LIGHT) can tell it. */
window.trcToggleCadence=async function(){
  TRC_F.cadence=(TRC_F.cadence==='1'?'all':'1');
  if(TRC_F.cadence==='1'){
    await trcEnsureFullEnrichment();
    trcRender(true);
    await trcEnsureHistories(TRC_LIST_LEAD_IDS);
  }
  trcRender(true);
};

/* Same shape again, for a promised follow-up date that passed with no call logged since (see
   trcCadenceIssues, mode 'promised'). */
window.trcTogglePromised=async function(){
  TRC_F.promised=(TRC_F.promised==='1'?'all':'1');
  if(TRC_F.promised==='1'){
    await trcEnsureFullEnrichment();
    trcRender(true);
    await trcEnsureHistories(TRC_LIST_LEAD_IDS);
  }
  trcRender(true);
};

/* "All time" is gone - it asked Postgres to sort and hand back the whole table (11k+ rows and
   climbing) in one shot, the single most expensive shape of this query, and it only got slower as the
   table grew. Previous day plus a manual From/To range covers the same ground a click at a time
   instead of all at once, and Previous day - the day whose calls actually finished processing
   overnight - stays the default both here and in TRC_F's own initial state above. */
function trcDateBar(){
  /* The From/To boxes no longer fire on their own onchange - picking a From date used to refetch
     immediately with To still at its old value, then picking To refetched AGAIN with the pair that
     was actually wanted. One button, applied once both boxes say what they're meant to, means one
     fetch of the range someone actually asked for, not one accidental fetch per box touched. Enter in
     either box does the same thing a click on the button would.
     No preset buttons any more - the boxes already open on Previous day (see TRC_F's own initial
     state), so a one-click shortcut back to it would only ever restate what's already showing. */
  const opt=function(v,label,cur){return '<option value="'+esc(v)+'"'+(cur===v?' selected':'')+'>'+esc(label)+'</option>';};
  const personnelValues=trcPersonnelOptionsList(TRC_ROWS);
  /* Moved up from the filter bar below (by request), same row as All personnel - the two are the
     "who/which team" pair someone reaches for first, so they sit beside each other rather than one at
     the top and one a row down. Same buValues logic trcFilterBar used to run itself: Durbaar Banquets
     dropped (see trcFilterBar's own note - it no longer queues at all), everything else sorted. */
  const buValues=Array.from(new Set((TRC_ROWS||[]).map(function(r){return r.business_unit_name;})
    .filter(function(k){return k&&!/^durbaar banquet/i.test(k);}))).sort();
  return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
    +'<label style="font-size:12px;color:var(--slate)">From</label>'
    +'<input type="date" id="trcFrom" value="'+esc(TRC_F.from||'')+'" onkeydown="if(event.key===\'Enter\')trcApplyRange()" style="padding:5px 8px">'
    +'<label style="font-size:12px;color:var(--slate)">To</label>'
    +'<input type="date" id="trcTo" value="'+esc(TRC_F.to||'')+'" onkeydown="if(event.key===\'Enter\')trcApplyRange()" style="padding:5px 8px">'
    +'<button class="btn btn-sm btn-primary" onclick="trcApplyRange()"><i class="fa-solid fa-magnifying-glass"></i> Search</button>'
    +'<select onchange="trcSet(\'personnel\',this.value)" style="padding:6px 8px">'
      +opt('all','All personnel',TRC_F.personnel)
      +personnelValues.map(function(p){return opt(p.email,p.name,TRC_F.personnel);}).join('')
    +'</select>'
    +'<select onchange="trcSet(\'bu\',this.value)" style="padding:6px 8px">'
      +opt('all','All business units',TRC_F.bu)
      +buValues.map(function(k){return opt(k,k,TRC_F.bu);}).join('')
    +'</select>'
  +'</div>';
}
window.trcApplyRange=function(){
  const f=($('trcFrom')&&$('trcFrom').value)||null, t=($('trcTo')&&$('trcTo').value)||null;
  return trcSetRange(f,t);
};
window.trcSetRange=async function(f,t){
  /* Manually clearing both the From and To boxes is the one remaining way to ask for f=null,t=null -
     which used to mean "All time". Falling back to Previous day here, the same default TRC_F starts
     with, is what keeps that door closed now that the button for it is gone. */
  if(!f&&!t){const y=traYesterday();f=y;t=y;}
  TRC_F.from=f||null;TRC_F.to=t||null;
  trcShowLoading();
  await trcFetchBoth();trcRender(true);
  /* A different window is a different set of leads, so the background history prefetch has to be
     re-aimed at them - trcPrefetchHistories abandons whatever the old range had left to download. */
  trcAfterListRender();
};

/* The whole team first, in the roster's own order (the manager, then the callers), so every
   pre-sales caller is selectable whether or not they have a call in this date range. Anyone
   pre-sales in the fetched rows who is NOT on the roster is appended after them rather than
   dropped: that combination means the CRM sent a caller the roster has not caught up with, and
   hiding their calls behind a filter that cannot name them is the worse of the two failures.
   Shared by the date bar's quick filter and the full filter row below it, so picking a caller in
   either one offers the exact same names in the exact same order. */
function trcPersonnelOptionsList(all){
  const seenP={};
  const personnelValues=(TRC_PERSONNEL||[]).map(function(p){
    seenP[p.email]=1;return {email:p.email,name:p.name};
  });
  (all||[]).forEach(function(r){
    const email=String(r.personnel_email||'').toLowerCase();
    if(!email||seenP[email]||String(r.personnel_team||'')!=='Pre-Sales')return;
    seenP[email]=1;
    personnelValues.push({email:email,name:(r.personnel_name||email)+' (not on the roster)'});
  });
  return personnelValues;
}
function trcFilterBar(all){
  const crmValues=Array.from(new Set((all||[]).map(function(r){return r.crm_status;})
    .filter(function(k){return k&&!trIsRepeatVisitStatus(k);}))).sort();
  const opt=function(v,label,cur){return '<option value="'+esc(v)+'"'+(cur===v?' selected':'')+'>'+esc(label)+'</option>';};
  return '<div class="toolbar" style="margin:14px 0 0;flex-wrap:wrap;gap:10px;align-items:center">'
    +'<select onchange="trcSet(\'match\',this.value)" style="padding:6px 8px">'
      +opt('all','All status checks',TRC_F.match)
      +opt('MATCH','CRM and call agree',TRC_F.match)
      +opt('MISMATCH','CRM and call disagree',TRC_F.match)
      +opt('NONE','Not yet checked',TRC_F.match)
    +'</select>'
    +'<select onchange="trcSet(\'crm\',this.value)" style="padding:6px 8px">'
      +opt('all','All CRM statuses',TRC_F.crm)
      +crmValues.map(function(k){return opt(k,k,TRC_F.crm);}).join('')
    +'</select>'
    +'<select onchange="trcSet(\'pitch\',this.value)" style="padding:6px 8px">'
      +opt('all','Pitch accuracy: all',TRC_F.pitch)
      +opt('Accurate','Pitch: Accurate',TRC_F.pitch)
      +opt('Partially Accurate','Pitch: Partially Accurate',TRC_F.pitch)
      +opt('Inaccurate','Pitch: Inaccurate',TRC_F.pitch)
      +opt('Not Applicable','Pitch: Not Applicable',TRC_F.pitch)
      +opt('NONE','Pitch: Not yet assessed',TRC_F.pitch)
    +'</select>'
    +'<select onchange="trcSet(\'fdate\',this.value)" style="padding:6px 8px">'
      +opt('all','Follow-up date accuracy: all',TRC_F.fdate)
      +opt('Accurate','Follow-up date: Accurate',TRC_F.fdate)
      +opt('Inaccurate','Follow-up date: Inaccurate',TRC_F.fdate)
      +opt('Not Applicable','Follow-up date: Not Applicable',TRC_F.fdate)
      +opt('NONE','Follow-up date: Not yet assessed',TRC_F.fdate)
    +'</select>'
    +'<select onchange="trcSet(\'remarks\',this.value)" style="padding:6px 8px">'
      +opt('all','Remarks accuracy: all',TRC_F.remarks)
      +opt('Accurate','Remarks: Accurate',TRC_F.remarks)
      +opt('Partially Accurate','Remarks: Partially Accurate',TRC_F.remarks)
      +opt('Inaccurate','Remarks: Inaccurate',TRC_F.remarks)
      +opt('Not Applicable','Remarks: Not Applicable',TRC_F.remarks)
      +opt('NONE','Remarks: Not yet assessed',TRC_F.remarks)
    +'</select>'
    +'<select onchange="trcSet(\'etiquette\',this.value)" style="padding:6px 8px">'
      +opt('all','Etiquette: all',TRC_F.etiquette)
      +opt('Pass','Etiquette: Pass',TRC_F.etiquette)
      +opt('Partial','Etiquette: Partial',TRC_F.etiquette)
      +opt('Fail','Etiquette: Fail',TRC_F.etiquette)
      +opt('Not Applicable','Etiquette: Not Applicable',TRC_F.etiquette)
      +opt('NONE','Etiquette: Not yet assessed',TRC_F.etiquette)
    +'</select>'
    +'<select onchange="trcSet(\'queryHandling\',this.value)" style="padding:6px 8px">'
      +opt('all','Query handling: all',TRC_F.queryHandling)
      +opt('Pass','Query handling: Pass',TRC_F.queryHandling)
      +opt('Partial','Query handling: Partial',TRC_F.queryHandling)
      +opt('Fail','Query handling: Fail',TRC_F.queryHandling)
      +opt('Not Applicable','Query handling: Not Applicable',TRC_F.queryHandling)
      +opt('NONE','Query handling: Not yet assessed',TRC_F.queryHandling)
    +'</select>'
    +'<select onchange="trcSet(\'retention\',this.value)" style="padding:6px 8px" title="Only meaningful on Lost calls - Not Applicable everywhere else">'
      +opt('all','Retention effort: all',TRC_F.retention)
      +opt('Pass','Retention: Pass',TRC_F.retention)
      +opt('Partial','Retention: Partial',TRC_F.retention)
      +opt('Fail','Retention: Fail',TRC_F.retention)
      +opt('Not Applicable','Retention: Not Applicable',TRC_F.retention)
      +opt('NONE','Retention: Not yet assessed',TRC_F.retention)
    +'</select>'
    +'<select onchange="trcSet(\'lostReason\',this.value)" style="padding:6px 8px" title="Only meaningful on Lost calls - Not Applicable everywhere else">'
      +opt('all','Lost reason accuracy: all',TRC_F.lostReason)
      +opt('Accurate','Lost reason: Accurate',TRC_F.lostReason)
      +opt('Inaccurate','Lost reason: Inaccurate',TRC_F.lostReason)
      +opt('Not Applicable','Lost reason: Not Applicable',TRC_F.lostReason)
      +opt('NONE','Lost reason: Not yet assessed',TRC_F.lostReason)
    +'</select>'
    +'<select onchange="trcSet(\'personalMobile\',this.value)" style="padding:6px 8px" title="Did the agent ask for a personal mobile number additional to the one already on file">'
      +opt('all','Personal mobile asked: all',TRC_F.personalMobile)
      +opt('Yes','Personal mobile asked: Yes',TRC_F.personalMobile)
      +opt('No','Personal mobile asked: No',TRC_F.personalMobile)
      +opt('NONE','Personal mobile asked: Not yet assessed',TRC_F.personalMobile)
    +'</select>'
    +'<input id="trcQ" placeholder="Search lead ID, name, personnel or follow-up ID…" value="'+esc(TRC_F.q||'')+'" oninput="trcSet(\'q\',this.value)" style="padding:6px 10px;min-width:250px">'
    +'<div class="grow"></div>'
    // Refresh now lives at the top of the page, beside the count it reloads - see trcView.
    +'<button class="btn btn-sm" onclick="trcClear()"><i class="fa-solid fa-filter-circle-xmark"></i> Clear filters</button>'
  +'</div>';
}
window.trcSet=async function(k,v){
  TRC_F[k]=v;
  // Reaching this with an actual category is only possible from the Mismatch panel, which already
  // required at least the qa-fields merge to be showing at all - this is a no-op in that case, and a
  // safety net otherwise, not the normal way this gets triggered (see trcCard).
  if(k==='mismatch'&&v!=='all')await trcEnsureQaFieldsMerged();
  // followup_date_status/remarks_status live on acc.followup_qa exactly like match/mismatch do - same
  // light merge, no join to call_transcripts/transcription_queue needed.
  if((k==='fdate'||k==='remarks'||k==='pitch'||k==='etiquette'||k==='queryHandling'||k==='retention'||k==='lostReason'||k==='personalMobile')&&v!=='all')await trcEnsureQaFieldsMerged();
  // The search box must not lose focus on every keystroke, so text filtering repaints the table only.
  trcRender(k!=='q');
};
window.trcClear=async function(){
  TRC_F.proc='all';TRC_F.match='all';TRC_F.crm='all';TRC_F.bu='all';TRC_F.mismatch='all';
  TRC_F.personnel='all';TRC_F.fdate='all';TRC_F.remarks='all';TRC_F.pitch='all';TRC_F.missedIn='all';
  TRC_F.cadence='all';TRC_F.promised='all';TRC_F.etiquette='all';TRC_F.queryHandling='all';TRC_F.retention='all';TRC_F.lostReason='all';TRC_F.personalMobile='all';
  TRC_F.q='';
  // Not null/null - that was "All time". Clearing the filters resets the date range to the same
  // Previous day default the page opens with, rather than reopening that door.
  const y=traYesterday();TRC_F.from=y;TRC_F.to=y;
  trcShowLoading();
  await trcFetchBoth();trcRender(true);
  trcAfterListRender();
};
/* The one button that means "I don't trust what's on screen" - so it drops BOTH caches, the list's
   and every lead history cached under it, rather than refetching the table and then still handing
   out 5h-old transcripts on the next click. */
window.trcRefresh=async function(){
  trcShowLoading();
  trcLeadCacheClearAll();
  // keepPage: Refresh means "get me current data for exactly what I'm looking at", not "start over" -
  // every filter in TRC_F is already untouched by this function, and the page number should be too.
  await Promise.all([trcFetch(true),trcKpiFastFetch(true)]);trcRender(true,true);
  trcAfterListRender();
};

function trcTextCell(v,width){
  if(!v)return '<td><span style="color:var(--slate)">—</span></td>';
  return '<td style="max-width:'+(width||220)+'px"><div title="'+esc(String(v))+'" '
    +'style="font-size:12.5px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">'
    +esc(String(v))+'</div></td>';
}
/* One-line badge cells (a status tag, a mismatch label) don't wrap the way free text does - without
   this, an unusually long value (a raw enum string landing where a short label was expected, say)
   just overflows its fixed-width column instead of respecting it. Centred both ways (a badge floating
   left in a wide column reads as an accident; centred reads as a deliberate column of state), and
   clipped rather than wrapped onto a second line if it's still too long for the column. */
function trcClipCell(inner){
  return '<td><div style="display:flex;align-items:center;justify-content:center;gap:4px;overflow:hidden;white-space:nowrap">'+inner+'</div></td>';
}

/* ---- the two tables. A lead has many conversations, so which row means what depends on the
   question being asked: "show me the day's leads" is a lead per row, and "show me the mismatches" is
   a CALL per row, because that is the level a mismatch exists at. ---- */
const TRC_LEAD_COLS=11, TRC_CALL_COLS=7;

/* sl is display-only - the row's position in the currently rendered, currently filtered list, purely
   so someone can say "row 12" out loud when talking to a colleague. Not stored anywhere: it is
   recomputed on every render and means nothing outside this one table on this one screen. */
function trcLeadRowHtml(g,sl){
  const n=g.rows.length;
  const last=g.last||{};
  /* g.rows was already narrowed to the active filters before being grouped here (trcApply runs
     before trcLeads), so when a personnel filter is on, g.last IS that person's most recent
     matching call - jumping straight to it instead of the top of the lead's whole history. */
  const jumpTo=TRC_F.personnel!=='all'&&last.follow_up_id?'/'+last.follow_up_id:'';
  const wasOpened=TRC_LAST_LEAD_ID!=null&&String(g.lead_id)===String(TRC_LAST_LEAD_ID);
  return '<tr id="trcLeadRow'+esc(String(g.lead_id))+'" style="cursor:pointer'+(wasOpened?';background:#f0fdfa;box-shadow:inset 3px 0 0 #0d9488':'')+'" onclick="navTo(\'transcription/r'+sl+'/'+g.lead_id+jumpTo+'\')">'
    +'<td style="font-variant-numeric:tabular-nums;color:var(--slate);text-align:center" title="Row '+sl+' in the current, filtered list">'+sl+'</td>'
    +'<td style="font-variant-numeric:tabular-nums;padding-right:20px">'+esc(String(g.lead_id))+'</td>'
    +'<td style="padding-left:6px"><div style="font-weight:600">'+esc(g.name||('Lead '+g.lead_id))+'</div>'
      +'<div style="font-size:11.5px;color:var(--slate)">'+n+' follow-up'+(n===1?'':'s')
        +' · '+g.recordings+' recording'+(g.recordings===1?'':'s')+' · '+g.transcribed+' transcribed</div>'
      +(g.trail.length>1?'<div style="font-size:11.5px;color:var(--slate);margin-top:3px">'
        +g.trail.map(esc).join(' <i class="fa-solid fa-arrow-right" style="font-size:9px"></i> ')+'</div>':'')
      /* Only rendered under the Failed card/chip - trcApply has already narrowed g.rows down to just
         this lead's failed recordings there (see trcProcFailed), so every button below retries ONE
         specific recording, never the lead as a whole. stopPropagation keeps the click off the row's
         own onclick (which would otherwise navigate into the lead instead of retrying). */
      +((TRC_F.proc==='failed'||TRC_F.proc==='not_transcribed')?'<div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:5px" onclick="event.stopPropagation()">'
        +g.rows.filter(trcCanRetry).map(function(r){
          return '<button class="btn btn-sm btn-primary" onclick="trcRetry('+r.follow_up_id+')">'
            +'<i class="fa-solid fa-rotate-right"></i> '+trcRetryLabel(r)+' '+esc(trcWall(r.call_start_text,true)||trcWall(trcRowDate(r))||('#'+r.follow_up_id))+'</button>';
        }).join('')+'</div>':'')
    +'</td>'
    /* Danger and Status-regressed used to carry their full label alongside the CRM status tag - three
       badges' worth of text in a column sized for one, so the middle one clipped mid-word and the
       last one never showed at all. Icon-only here (the reasons ride along as a hover tooltip; the
       lead detail page still spells both out in full, in trcOvHealthHtml and trcCallHtml). */
    +trcClipCell((g.status?trcTag('t-blue','',g.status):'<span style="color:var(--slate)">—</span>')
      +(g.ovHealth&&!g.ovHealth.ok?' '+trcTag('t-red','fa-triangle-exclamation','','Danger: '+g.ovHealth.reasons.join('; ')):'')
      +(g.regressions?' '+trcTag('t-red','fa-arrow-turn-down',g.regressions>1?String(g.regressions):'',
          (g.regressions>1?g.regressions+' status regressions':'Status regressed')):'')
      +(g.promised?' '+trcTag('t-amber','fa-calendar-xmark','','Promised call on '+(trcWall(g.promised.gaps[g.promised.gaps.length-1].limitDate)||'')+' - no call since'):'')
      +(g.missedIn?' '+trcTag('t-red','fa-phone-slash','',
          'Missed incoming call '+g.missedIn.count+' time'+(g.missedIn.count===1?'':'s')+' - not called back within 24 hours'):''))
    /* g.lastAssessedOutside only ever fires once g.lastAssessed itself is null (see trcLeads) - a
       carried-over verdict from another date, not this range's own, so it is labelled with exactly
       that date (trcBackfillLastJudgement) rather than left indistinguishable from a same-range one.
       Built as its own <td>, not trcClipCell (that helper's flex/nowrap box is for a single inline
       tag and would clip a second, stacked line rather than show it). */
    +(g.lastAssessed
      ?trcClipCell(trcTag(TRC_AI_TAG[g.lastAssessed.ai_assessed_status]||'t-gray','',trcAiStatusLabel(g.lastAssessed)))
      :g.lastAssessedOutside
        ?'<td style="text-align:center">'+trcTag(TRC_AI_TAG[g.lastAssessedOutside.ai_assessed_status]||'t-gray','',trcAiStatusLabel(g.lastAssessedOutside))
          +'<div style="font-size:11px;color:var(--slate);margin-top:2px">Last judged '
          +esc(trcWall(g.lastAssessedOutside.call_start_text)||trcWall(g.lastAssessedOutside.call_date)||'')+'</div></td>'
        :trcClipCell('<span style="color:var(--slate)">—</span>'))
    +trcClipCell(g.mismatches
        ? trcTag('t-red','fa-not-equal',g.mismatches+' mismatch'+(g.mismatches===1?'':'es'))
        : (g.assessed?trcTag('t-green','fa-equals','Agrees'):'<span style="color:var(--slate)">not checked</span>'))
    +trcTextCell(g.bu,160)
    /* Whoever was on the phone for the LATEST call, not the lead as a whole - a lead's calls can move
       between Pre-Sales and Sales (or between people on the same team), so the personnel column is
       g.last's, matching what "latest call recording" means everywhere else on this row (g.lastDate,
       g.lastAssessed). */
    +trcTextCell(last.personnel_name,140)
    +'<td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12.5px'
      +'">'
      +esc(trcWall(g.nextFollowUp,true)||'—')+'</td>'
    +trcTextCell(g.lost_reason,180)
    +trcTextCell(last.crm_remarks,220)
    /* No Recording column. A per-lead download only ever offered the LATEST call's audio, which is
       an odd thing for a row that summarises a whole history - and the lead's own page lists every
       call with its own download link, which is where someone picking a recording is going anyway.
       The row still says how many recordings the lead has, in the Lead cell above. */
  +'</tr>';
}

/* One CALL per row, for the mismatch drill-down: the CRM's verdict and the conversation's verdict
   side by side, which is the comparison the count is made of. */
function trcCallRowHtml(r){
  const m=TRC_MISMATCH[String(r.mismatch_type||'')];
  const wasOpened=TRC_LAST_FOLLOWUP_ID!=null&&String(r.follow_up_id)===String(TRC_LAST_FOLLOWUP_ID);
  return '<tr id="trcCallRow'+esc(String(r.follow_up_id))+'" style="cursor:pointer'+(wasOpened?';background:#f0fdfa;box-shadow:inset 3px 0 0 #0d9488':'')+'" onclick="navTo(\'transcription/lead/'+r.lead_id+'/'+r.follow_up_id+'\')">'
    +'<td style="font-variant-numeric:tabular-nums;padding-right:20px">'+esc(String(r.lead_id))+'</td>'
    +'<td style="padding-left:6px"><div style="font-weight:600">'+esc(r.lead_name||('Lead '+r.lead_id))+'</div>'
      +'<div style="font-size:11.5px;color:var(--slate)">follow-up '+esc(String(r.follow_up_id))+'</div></td>'
    +'<td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12.5px">'+esc(trcWall(r.call_start_text,true)||trcWall(trcRowDate(r))||'—')+'</td>'
    +trcClipCell(r.crm_status?trcTag('t-blue','',r.crm_status):'<span style="color:var(--slate)">—</span>')
    +trcClipCell(r.ai_assessed_status?trcTag(TRC_AI_TAG[r.ai_assessed_status]||'t-gray','',trcAiStatusLabel(r)):'<span style="color:var(--slate)">—</span>')
    +trcClipCell(m?trcTag(m.tag,m.icon,m.short):trcMismatchTag(r))
    +trcTextCell(r.crm_remarks,260)
  +'</tr>';
}

function trcTableHtml(items,callLevel,slOffset){
  if(!items.length){
    return '<tr><td colspan="'+(callLevel?TRC_CALL_COLS:TRC_LEAD_COLS)+'"><div class="empty" style="padding:40px">'
      +'<i class="fa-solid fa-inbox"></i><div>Nothing matches these filters</div></div></td></tr>';
  }
  if(callLevel)return items.map(trcCallRowHtml).join('');
  /* SL No counts from the page's own offset, not from 1 on every page - "51" on page 2's first row,
     not another "1", since #/r<SL NO> (see trcView) treats it as this row's position in the WHOLE
     list, not just the page it happens to be on. */
  const off=slOffset||0;
  return items.map(function(g,i){return trcLeadRowHtml(g,off+i+1);}).join('');
}
function trcHeadHtml(){
  return TRC_F.match==='MISMATCH'
    ? '<tr><th>Lead ID</th><th>Lead</th><th>Call</th><th>CRM says</th><th>Call says</th><th>Disagreement</th><th>CRM remarks</th></tr>'
    : '<tr><th style="text-align:center">SL No</th><th>Lead ID</th><th>Lead</th><th>CRM Status</th><th>AI Status</th><th>Status check</th>'
      +'<th>Business Unit</th><th>Personnel</th><th>Next follow-up</th><th>Lost reason</th><th>Remarks</th></tr>';
}
/* Fixed proportions per column, matched 1:1 to trcHeadHtml's columns - paired with table-layout:fixed
   on the table itself (see trcView), this is what actually stops one long value (a badge holding an
   unusually long status string, a wide business unit name) from stretching its own column and shoving
   every column after it sideways. Widths are relative: the browser scales them to fill the table's own
   width, so this still fits both a wide monitor and a laptop, just proportionally. */
function trcColsHtml(){
  return TRC_F.match==='MISMATCH'
    ? '<col style="width:9%"><col style="width:20%"><col style="width:15%"><col style="width:11%">'
      +'<col style="width:15%"><col style="width:16%"><col style="width:14%">'
    : '<col style="width:4%"><col style="width:7%"><col style="width:15%"><col style="width:9%">'
      +'<col style="width:9%"><col style="width:10%"><col style="width:10%"><col style="width:9%">'
      +'<col style="width:7%"><col style="width:9%"><col style="width:11%">';
}

/* keepPage: true for a plain page-turn (Prev/Next), which must not reset back to page 1 or fight the
   deep-link jump below. Anything else - a new range, a filter, a card click - always lands on page 1;
   staying on "page 6" after the underlying set changes underneath it would show whatever happens to
   be there now, not the six pages someone actually paged through. */
function trcRender(full,keepPage){
  trcSaveFilterState();
  const all=TRC_ROWS||[];
  /* With a history chip on, the list is every lead that had ANY call in range (a missed incoming call
     has no recording, so it is never an eligible call); otherwise only recording-eligible calls. */
  let rows=trcApply(all,false,trcHistChipOn());
  const scope=trcApply(all,true);
  const k=$('trcKpis');if(k)k.innerHTML=trcKpiHtml(scope,trcApply(all,true,true));
  if(full!==false){
    const f=$('trcFilters');if(f)f.innerHTML=trcFilterBar(all);
    const d=$('trcDates');if(d)d.innerHTML=trcDateBar();
  }
  const cg=$('trcCols');if(cg)cg.innerHTML=trcColsHtml();
  const h=$('trcHead');if(h)h.innerHTML=trcHeadHtml();
  const callLevel=TRC_F.match==='MISMATCH';
  /* The pinned lead rides in on top of the ranged/filtered set, never into the KPI cards above (scope
     stays about the selected window's own numbers) - only so the exact row a deep link named is on
     screen to scroll to. */
  if(!callLevel&&TRC_LAST_LEAD_ID!=null&&TRC_PIN_ID===String(TRC_LAST_LEAD_ID)&&TRC_PIN_ROWS&&TRC_PIN_ROWS.length
     &&!rows.some(function(r){return String(r.lead_id)===String(TRC_LAST_LEAD_ID);})){
    rows=rows.concat(TRC_PIN_ROWS);
  }
  let items=callLevel?rows.slice().sort(function(a,b){return trcChrono(b,a);}):trcLeads(rows);
  TRC_LIST_LEAD_IDS=callLevel?[]:items.map(function(g){return g.lead_id;});
  const histLoading=!callLevel&&trcHistChipOn()&&items.some(function(g){return g.historyPending;});
  // Missed incoming and late follow-ups are per-LEAD facts - they only narrow the lead rollup, not
  // the call-level Mismatch table, which trcLeads never runs over in the first place.
  if(!callLevel&&TRC_F.missedIn==='1')items=items.filter(function(g){return g.missedIn;});
  if(!callLevel&&TRC_F.cadence==='1')items=items.filter(function(g){return g.cadence;});
  if(!callLevel&&TRC_F.promised==='1')items=items.filter(function(g){return g.promised;});
  const totalItems=items.length;
  const totalPages=Math.max(1,Math.ceil(totalItems/TRC_PAGE_SIZE));
  if(!keepPage){
    /* A deep link (or a "back" from a lead's detail page) still deserves to land on its own row even
       though the list is now paged - so jump to whichever page that row fell on, rather than always
       forcing page 1 out from under it. Anything else (a fresh range, a filter, a card) has no row to
       protect and starts at the top. */
    TRC_PAGE=0;
    if(TRC_LAST_LEAD_ID!=null){
      const idx=items.findIndex(function(it){return String(it.lead_id)===String(TRC_LAST_LEAD_ID);});
      if(idx>=0)TRC_PAGE=Math.floor(idx/TRC_PAGE_SIZE);
    }
  }
  if(TRC_PAGE>totalPages-1)TRC_PAGE=totalPages-1;
  if(TRC_PAGE<0)TRC_PAGE=0;
  const pageOffset=TRC_PAGE*TRC_PAGE_SIZE;
  const pageItems=items.slice(pageOffset,pageOffset+TRC_PAGE_SIZE);
  TRC_PAGE_ROWS=pageItems;
  const b=$('trcRows');if(b)b.innerHTML=histLoading
    ?'<tr><td colspan="'+TRC_LEAD_COLS+'"><div class="empty" style="padding:40px"><i class="fa-solid fa-spinner fa-spin"></i><div>Loading the full follow-up history of each lead…</div></div></td></tr>'
    :trcTableHtml(pageItems,callLevel,pageOffset);
  const pg=$('trcPager');if(pg)pg.innerHTML=trcPagerHtml(totalItems,totalPages);
  const c=$('trcCount');
  if(c){
    const rangeStart=totalItems?TRC_PAGE*TRC_PAGE_SIZE+1:0;
    const rangeEnd=Math.min(totalItems,rangeStart+TRC_PAGE_SIZE-1);
    const noun=callLevel?'call':'lead';
    c.textContent=rangeStart+'–'+rangeEnd+' of '+totalItems+' '+noun+(totalItems===1?'':'s')
      +(callLevel?'':' · '+rows.length+' follow-up'+(rows.length===1?'':'s'))
      +' of '+all.length;
  }
}

/* Prev/Next plus "page N of M" - deliberately not a full page-number strip, since M can run into the
   dozens on a wide range and this list has no use for jumping to an arbitrary one. */
function trcPagerHtml(totalItems,totalPages){
  if(totalItems<=0||totalPages<=1)return '';
  /* Text labels, not bare chevrons - "Previous"/"Next" reads at a glance, where an icon alone asks
     someone to guess. Centered, not pinned to an edge: this is the page's own control, not one more
     item in a toolbar, and centering is what keeps it findable at a consistent spot no matter how
     wide the window is. Fixed width on the page label so the two buttons either side of it do not
     shift left and right as the page number's own digit count changes (9 of 12 vs 10 of 12). */
  return '<div style="display:flex;align-items:center;justify-content:center;gap:16px;'
      +'padding:14px 12px;border-top:1px solid var(--line);margin-top:2px">'
    +'<button class="btn btn-sm" '+(TRC_PAGE<=0?'disabled':'')+' onclick="trcSetPage(-1)">'
      +'<i class="fa-solid fa-chevron-left"></i> Previous</button>'
    +'<span style="color:var(--slate);font-size:12.5px;min-width:90px;text-align:center">Page '
      +(TRC_PAGE+1)+' of '+totalPages+'</span>'
    +'<button class="btn btn-sm" '+(TRC_PAGE>=totalPages-1?'disabled':'')+' onclick="trcSetPage(1)">'
      +'Next <i class="fa-solid fa-chevron-right"></i></button>'
  +'</div>';
}
window.trcSetPage=function(delta){
  TRC_PAGE=TRC_PAGE+delta;
  trcRender(false,true);
  trcAfterListRender();
};

async function trcView(v,seg){
  /* THE WAYS BACK INTO THIS LIST, and the one rule they share: the list only moves the page when it
     is actually a return trip. Arriving any other way - the tab strip, the sidebar, a filter change -
     leaves the scroll alone and lands at the top like any other page.
       #/r<SL NO>  a lead opened from the SL NO table, backing out. The number names the row it was
                   opened from; it is a POSITION, not an identity, so it is only trusted as a last
                   resort, but it is what survives a reload or a pasted URL.
       #/back      a lead opened from the call-level Mismatch table, which has no SL NO column to
                   put in a URL. Nothing to resolve but "whatever was last opened", which is exactly
                   what the memo holds.
       #/0/<leadId>[/<followUpId>]  names its row by id, which is exact - the shape a live link from
                   elsewhere in the app takes, still honoured.
       a bare #/   the browser's own back button, which restores the hash the list had before the
                   click and so says nothing at all. TRC_FROM_DETAIL is what identifies that one. */
  const rowMatch=/^r(\d+)$/i.exec(String((seg&&seg[0])||''));
  const rowHint=rowMatch?Number(rowMatch[1]):null;
  const isBack=String((seg&&seg[0])||'')==='back';
  const hasLeadSeg=!rowMatch&&!isBack&&!!(seg&&seg[1]);
  if(hasLeadSeg){TRC_LAST_LEAD_ID=seg[1];TRC_LAST_FOLLOWUP_ID=seg[2]||null;}
  /* An in-app back click still has the lead in memory, which is already exact. A reload, or the URL
     opened cold in this tab, does not - so recover which row was opened, and the window it was
     opened under. Restoring the filters is the point, not a side effect: without them the lead may
     not even be in the fetched range, and the row genuinely is not the 79th of anything on screen.
     trcFetch keys its cache on the date range, so putting these back before it runs is what makes it
     go and get the right window; trcEnsurePinnedLead then covers a lead the window still excludes. */
  if((rowHint||isBack)&&TRC_LAST_LEAD_ID==null){
    const memo=isBack?trcRecallAny():trcRecallRow(rowHint);
    if(memo){
      Object.assign(TRC_F,memo.f||{});
      TRC_LAST_LEAD_ID=memo.leadId;
      TRC_LAST_FOLLOWUP_ID=memo.followUpId||null;
    }
  }
  /* Only a return trip restores a row. Landing on the list any other way must not yank the page down
     to whatever lead happened to be opened last - that lead is still highlighted in the table either
     way, which is the part worth keeping. */
  const wantsRow=rowHint!=null||isBack||hasLeadSeg||TRC_FROM_DETAIL;
  TRC_FROM_DETAIL=false;   // consumed: a later filter change or tab click is not a return trip
  v.innerHTML=mHead('fa-microphone-lines','#0d9488','Transcription')+TRA_TABS_HTML(0)
    +'<div class="card card-pad" style="margin:14px 0 0"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">'
      +'<div class="sec-title" style="margin:0"><i class="fa-solid fa-calendar-days" style="color:#0d9488"></i> Leads and their calls</div>'
      +'<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">'
        +'<div id="trcCount" style="font-size:12.5px;color:var(--slate)"></div>'
        /* Moved up from the filter bar below, where it read as one option among many (next to Clear
           filters, a dropdown or two away from the data it actually refreshes) - here it sits right
           beside the count it updates, which is what makes it legible as "reload THIS" rather than
           just another button in a row of them. */
        +'<button class="btn btn-sm" onclick="trcRefresh()"><i class="fa-solid fa-rotate"></i> Refresh</button>'
        +'<button class="btn btn-sm" onclick="trcToggleDaily()"><i class="fa-solid fa-table-list"></i> Daily breakdown</button>'
      +'</div></div>'
      +'<div id="trcDates" style="margin-top:12px">'+trcDateBar()+'</div></div>'
    +'<div id="trcDaily"></div>'
    +'<div id="trcKpis" style="margin-top:16px">'+trcSkeletonKpis()+'</div>'
    +'<div id="trcFilters"></div>'
    /* overflow-x only, no max-height - each page is at most TRC_PAGE_SIZE rows, so a vertical
       scrollbox here would just hide them inside their own little scrollbar instead of the page's
       normal one. table-layout:fixed + the colgroup below is what makes a max-width on a cell actually
       mean something - without it, a table sizes each column to its widest cell (one long badge value
       stretches its whole column, and every column after it), no matter what a <td> asks for. */
    +'<div class="card" style="margin-top:14px">'
      /* The pager is a sibling of the scrolling div, not a child of it - inside it, scrolling the
         table sideways to see a clipped column dragged the Prev/Next controls out of view (or off to
         the side) right along with it, and a wide table could stretch the scrollable area further
         than the pager itself ever needed. Its own row never scrolls and never adds width. */
      +'<div style="overflow-x:auto"><table class="tbl" style="table-layout:fixed;width:100%">'
        +'<colgroup id="trcCols">'+trcColsHtml()+'</colgroup>'
        +'<thead id="trcHead">'+trcHeadHtml()+'</thead>'
        +'<tbody id="trcRows">'+trcSkeletonRows()+'</tbody>'
      +'</table></div>'
      +'<div id="trcPager"></div>'
    +'</div>';
  /* Not a forced refetch: coming back here from a lead's detail page (the in-app Back button, or the
     browser's own back button) must not re-download the whole day's rows and drop someone at the top
     of the table while it loads - trcFetch already caches, trcFetchBoth catches a cache that fell
     behind the live pipeline on its own (see its own comment), and the explicit Refresh button still
     forces a reload on demand besides. */
  await trcFetchBoth();
  await trcEnsurePinnedLead();
  trcRender(true);
  /* Only ever after a render that was asked to restore a row (see wantsRow above). */
  if(wantsRow)trcScrollToRow(rowHint);
  /* Last, and deliberately not awaited: the table is already on screen and interactive, and this is
     a background download of every listed lead's full call history so the first click into one is
     instant. Kicked off from here rather than from trcFetch so a filter change that reuses the
     cached rows still re-aims it at the leads now on screen. */
  trcAfterListRender();
}

/* Puts the exact row someone came back from on screen, and nothing else - no smooth scroll (this is
   a restore, not a journey) and no scroll at all if the row isn't there to scroll to.
   The Mismatch card switches this same table to one row per call (trcCallRowHtml) instead of one row
   per lead (trcLeadRowHtml) - whichever is actually on screen is the one worth scrolling to.
   rAF, not straight after the render: the tab-strip MutationObserver (see the top of this file) runs
   as a microtask right after the innerHTML that queued it, and the browser has not laid the new rows
   out yet at that point. One frame later the table has real geometry and block:'center' means what it
   says. */
function trcScrollToRow(rowHint){
  const find=function(){
    let row=(TRC_F.match==='MISMATCH'&&TRC_LAST_FOLLOWUP_ID!=null)
      ? $('trcCallRow'+TRC_LAST_FOLLOWUP_ID)
      : (TRC_LAST_LEAD_ID!=null ? $('trcLeadRow'+TRC_LAST_LEAD_ID) : null);
    /* Nothing in memory to match a lead on - a reload, or someone opening #/r12 cold - so fall back
       to the position the number names. It is the same lead only if the list rendered the same way. */
    if(!row&&rowHint){const b=$('trcRows');row=(b&&b.children[rowHint-1])||null;}
    return row;
  };
  requestAnimationFrame(function(){
    const row=find();
    if(row)row.scrollIntoView({block:'center'});
  });
}

/* The leads the table is showing right now, in the order they are shown, so the prefetch warms the
   rows someone is most likely to click first. Reads the rendered rows rather than re-deriving the
   grouping, so it can never disagree with what is on screen. */
function trcPrefetchListedHistories(){
  /* TRC_PAGE_ROWS is exactly the current page - lead-groups normally, raw call rows in the Mismatch
     view - and both shapes carry lead_id directly, so this warms only what's actually on screen right
     now instead of every lead the filters match (which, before pagination existed, could be the
     hundreds of leads in a wide range downloading their full transcripts in the background at once). */
  const ids=[];
  (TRC_PAGE_ROWS||[]).forEach(function(r){if(r&&r.lead_id!=null)ids.push(r.lead_id);});
  if(ids.length)trcPrefetchHistories(ids);
}
/* The three background jobs every render of the list kicks off, never awaited: fill in this page's
   own transcription/AI-status columns (trcEnrichVisiblePage, only when the fast fetch left them
   blank), carry over a lead's last real judgement when this range has none of its own
   (trcBackfillLastJudgement), and warm the full history behind each of these same leads for an
   instant click-through (trcPrefetchListedHistories). Independent of each other - so there is no
   ordering to get right between them. */
function trcAfterListRender(){
  trcEnrichVisiblePage();
  trcBackfillLastJudgement();
  trcPrefetchListedHistories();
  trcWarmListHistories();
}

