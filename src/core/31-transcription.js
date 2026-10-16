/* ============================ TRANSCRIPTION ============================ */
/* Upload a recording -> stored in S3 (portal/transcription/) -> transcribed
   & analysed by Gladia (Hindi / English / Bengali, code-switching aware) via
   the `transcription-analyze` edge function. Results land in acc.transcriptions. */
const TR_LANG_NAMES={hi:'Hindi',en:'English',bn:'Bengali',ur:'Urdu',ta:'Tamil',te:'Telugu',mr:'Marathi',gu:'Gujarati',pa:'Punjabi'};
const TR_TIMERS={};
/* EVERY COLUMN EXCEPT THE FIVE ONLY A DETAIL SCREEN EVER READS.

   acc.transcriptions is 9.7MB over 1,373 rows and the two list fetches both asked for '*'. Of
   that, utterances (1.2MB), transcript_bn (1.5MB), qa_evaluation (793KB), original_crm_response
   (307KB) and analysis (146KB) - 4MB, 41% of the table - are never touched by a list row. They
   are read by traDetail and trDetail, and BOTH of those re-fetch their own row with select('*')
   before rendering, so dropping them here costs those screens nothing at all.

   What is deliberately KEPT, because a list row genuinely does use it:
     call_history / pending_calls - traCallCount() counts them in the list
     transcript / transcript_en   - trDownloadRows() exports them straight from list rows
     criteria                     - trExportHtml() reads it from list rows

   Listed out rather than expressed as "* minus five" because PostgREST has no such syntax. A new
   column added to the table will not appear here until it is added by hand - which is the usual
   cost of naming columns, and the reason the list says plainly what it leaves out. */
const TR_LIST_COLS='id,title,file_name,s3_path,size_bytes,duration_seconds,status,gladia_id,'
  +'result_url,languages,transcript,summary,error_text,created_by,created_at,updated_at,phone,'
  +'customer_name,project,qualification,reason,criteria,transcript_en,folder,pinned,pin_rank,'
  +'deleted_at,deleted_by,lead_id,business_unit_name,source,source_url,lead_mobile,'
  +'telephony_call_id,recording_url,non_transcribable_reason,dashboard_fields,summary_verdict,'
  +'crm_status,report_date,call_uuid,ai_lead_category,mismatch,mismatch_severity,mismatch_reason,'
  +'verification,qa_score,synced_at,attempts,crm_lost_reason,crm_remarks,next_follow_up_date,'
  +'discrepancy,has_discrepancy,ai_lost_reason,lost_reason_match,queue_seq,queued_at,'
  +'processing_started_at,completed_at,attempt_count,last_error,source_date,sync_run_id,'
  +'transcription_status,comparison_status,comparison_reason,call_history,pending_calls,'
  +'status_trail,processed_call_uuids,gemini_model,merged_into';
let TR_ROWS=null;
let TR_DELETED_ROWS=null; // soft-deleted calls, shown on their own "Deleted" tab
let TR_FILTER='all'; // 'all'|'qualified'|'followup'|'notqualified'|'nil' — driven by the KPI cards
let TR_FOLDER=null; // folder currently drilled into on the "Folders" tab
let TR_SELECTED=new Set(); // ids checked in the All Calls log, for folder assignment
let TR_DATE_FROM=null, TR_DATE_TO=null; // 'YYYY-MM-DD' — applies to the log everywhere (All Calls + inside folders)
let TR_ADD_TARGET=null; // folder name we navigated here to add calls to, via "Add calls" inside that folder
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
/* The three outcomes, in one place so a badge, a KPI card and a banner cannot drift apart.
   Follow-Up exists because "Qualified or not" cannot describe a customer who asked to be called back
   later: they are neither a lead that matched nor one that was lost, and pushing them into Not
   Qualified is exactly how a live lead gets written off. */
const TR_OUTCOMES = {
  'Qualified':     { colour:'#16a34a', bg:'#dcfce7', ink:'#166534', tag:'t-green', icon:'fa-circle-check' },
  'Follow-Up':     { colour:'#d97706', bg:'#fef3c7', ink:'#92400e', tag:'t-amber', icon:'fa-clock-rotate-left' },
  'Not Qualified': { colour:'#dc2626', bg:'#fee2e2', ink:'#991b1b', tag:'t-red',   icon:'fa-circle-xmark' }
};
function trOutcome(q){ return TR_OUTCOMES[q] || null; }

// Qualification / status badge shown in the list + detail.
function trQualTag(r){
  if(r.status==='processing'||r.status==='queued')return '<span class="tag t-amber"><i class="fa-solid fa-spinner fa-spin"></i> Analysing</span>';
  if(r.status==='error')return '<span class="tag t-red"><i class="fa-solid fa-circle-exclamation"></i> Failed</span>';
  const o=trOutcome(r.qualification);
  if(o)return '<span class="tag '+o.tag+'"><i class="fa-solid '+o.icon+'"></i> '+esc(r.qualification)+'</span>';
  return '<span class="tag t-gray">—</span>';
}

/* Every call, fetched a page at a time.
   This used to stop at the 200 most recent, and the KPI cards are counted from whatever was
   loaded - so Calls stuck at 200 while the real figure climbed past 500, and the window slid as
   new calls arrived: an older Qualified call dropped off the bottom for each new one at the top,
   so Qualified went DOWN while qualified calls were being added. Not Qualified read low for the
   same reason, and the three cards never summed to the total. */
async function trFetch(force){
  if(TR_ROWS&&!force)return TR_ROWS;
  if(!force){
    const cached=trCacheRead('tr_fetch_cache','all');
    if(cached){TR_ROWS=cached;return TR_ROWS;}
  }
  const PAGE=1000; let out=[], from=0;
  try{
    for(;;){
      const {data,error}=await sb.schema('acc').from('transcriptions').select(TR_LIST_COLS)
        .is('deleted_at',null).order('created_at',{ascending:false}).range(from,from+PAGE-1);
      if(error)throw error;
      const batch=data||[];
      out=out.concat(batch);
      if(batch.length<PAGE)break;          // last page
      from+=PAGE;
      if(from>50000)break;                 // backstop, never a real workload
    }
    TR_ROWS=out;
    trCacheWrite('tr_fetch_cache','all',out);
  }catch(e){ TR_ROWS=out.length?out:[]; }
  return TR_ROWS;
}
async function trFetchDeleted(force){
  if(TR_DELETED_ROWS&&!force)return TR_DELETED_ROWS;
  try{const {data}=await sb.schema('acc').from('transcriptions').select('*').not('deleted_at','is',null).order('deleted_at',{ascending:false}).limit(200);TR_DELETED_ROWS=data||[];}catch(e){TR_DELETED_ROWS=[];}
  return TR_DELETED_ROWS;
}
// Date-range filter — applies to every call-log listing (All Calls + inside any folder).
function trInDateRange(r){
  if(!TR_DATE_FROM&&!TR_DATE_TO)return true;
  if(!r.created_at)return false;
  const d=new Date(r.created_at);
  const dOnly=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  if(TR_DATE_FROM&&dOnly<TR_DATE_FROM)return false;
  if(TR_DATE_TO&&dOnly>TR_DATE_TO)return false;
  return true;
}
function trDateFilterRows(rows){return (rows||[]).filter(trInDateRange);}
function trDateLabelText(){
  if(!TR_DATE_FROM&&!TR_DATE_TO)return 'All time';
  if(TR_DATE_FROM&&TR_DATE_TO)return fmtDate(TR_DATE_FROM)+' – '+fmtDate(TR_DATE_TO);
  if(TR_DATE_FROM)return 'From '+fmtDate(TR_DATE_FROM);
  return 'Until '+fmtDate(TR_DATE_TO);
}
// A proper dropdown (same .dropdown component the profile/notification menus use in the
// topbar) instead of two bare date inputs sitting loose in the toolbar.
function trDateRangeHtml(){
  const active=!!(TR_DATE_FROM||TR_DATE_TO);
  return '<div style="position:relative;display:inline-block">'
    +'<button class="btn btn-sm'+(active?' btn-primary':'')+'" id="trDateBtn" onclick="event.stopPropagation();trToggleDateDd()"><i class="fa-solid fa-calendar-days"></i> <span id="trDateBtnLabel">'+esc(trDateLabelText())+'</span> <i class="fa-solid fa-chevron-down" style="font-size:9px;margin-left:2px"></i></button>'
    +'<div class="dropdown" id="trDateDd" style="top:38px;left:0;right:auto;width:272px;padding:16px" onclick="event.stopPropagation()">'
      +'<div style="font-size:13px;font-weight:700;color:var(--ink);display:flex;align-items:center;gap:6px"><i class="fa-solid fa-calendar-days" style="color:#0d9488"></i> Filter by date</div>'
      +'<div class="frm" style="margin-top:2px">'
        +'<label style="margin-top:10px">From</label><input type="date" id="trDateFrom" value="'+esc(TR_DATE_FROM||'')+'">'
        +'<label>To</label><input type="date" id="trDateTo" value="'+esc(TR_DATE_TO||'')+'">'
      +'</div>'
      +'<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">'
        +'<button class="btn btn-sm" onclick="trClearDateRange()">Clear</button>'
        +'<button class="btn btn-sm btn-primary" onclick="trApplyDateRange()">Apply</button>'
      +'</div>'
    +'</div>'
  +'</div>';
}
window.trToggleDateDd=function(){
  const dd=$('trDateDd');if(!dd)return;
  dd.classList.toggle('show');
  if(!window._trDateDocWired){
    window._trDateDocWired=true;
    document.addEventListener('click',function(){const d=$('trDateDd');if(d)d.classList.remove('show');});
  }
};
function trRenderDateBtn(){
  const btn=$('trDateBtn'),lbl=$('trDateBtnLabel');if(!btn||!lbl)return;
  btn.className='btn btn-sm'+((TR_DATE_FROM||TR_DATE_TO)?' btn-primary':'');
  lbl.textContent=trDateLabelText();
}
window.trApplyDateRange=function(){
  TR_DATE_FROM=($('trDateFrom')&&$('trDateFrom').value)||null;
  TR_DATE_TO=($('trDateTo')&&$('trDateTo').value)||null;
  const dd=$('trDateDd');if(dd)dd.classList.remove('show');
  trRenderDateBtn();trRenderList();trRenderFolderRows();
};
window.trClearDateRange=function(){
  TR_DATE_FROM=null;TR_DATE_TO=null;
  const f=$('trDateFrom'),t=$('trDateTo');if(f)f.value='';if(t)t.value='';
  const dd=$('trDateDd');if(dd)dd.classList.remove('show');
  trRenderDateBtn();trRenderList();trRenderFolderRows();
};
