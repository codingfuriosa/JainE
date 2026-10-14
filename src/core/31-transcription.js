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
// Logged directly rather than through USAGE_MAP - unlike orgSetPeriod's presets, this has real
// validation (missing dates, From after To) that can silently stop it without applying anything.
window.orgApplyCustom=function(){
  const a=document.getElementById('orgFrom'), b=document.getElementById('orgTo');
  if(!a||!b||!a.value||!b.value){ toast('Pick both dates','warn'); try{usageQueue('organic.all_content.filter_by_date_range','error');}catch(_e){} return; }
  if(a.value>b.value){ toast('The From date must come before the To date','warn'); try{usageQueue('organic.all_content.filter_by_date_range','error');}catch(_e){} return; }
  ORG_SINCE=a.value; ORG_UNTIL=b.value; ORG_PERIOD='custom'; ORG_OPEN=false; ORG_PG=0; renderPage();
  try{usageQueue('organic.all_content.filter_by_date_range','update');}catch(_e){}
};
window.orgSetNet=function(n){ORG_NET=n;ORG_PG=0;renderPage();};
window.orgSetKind=function(k){ORG_KIND=k;ORG_PG=0;renderPage();};
window.orgSetPageId=function(v){ORG_PAGE=v;ORG_PG=0;renderPage();};
window.orgSetSort=function(v){ORG_SORT=v;ORG_PG=0;renderPage();};
window.orgSearch=function(v){ORG_Q=v;ORG_PG=0;
  clearTimeout(window._orgQT); window._orgQT=setTimeout(function(){renderPage(); const el=document.getElementById('orgQ'); if(el){el.focus(); el.setSelectionRange(el.value.length,el.value.length);} },320);
  usageQueueDebounced('organic.all_content.search_caption_or_page', v);
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

