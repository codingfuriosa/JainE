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
const TRA_RETRY_MODEL='gemini-flash-latest';

/* Rows written before the pipeline rewrite carry the old status words. Normalising in one place
   means the table, the cards and the filters all agree about what a row IS, whenever it was made. */
const TRA_IN_FLIGHT={pending:true,processing:true,retrying:true};
function traStatusTag(r){
  const m=TRA_STATUS_META[traStatus(r)];
  if(!m)return '<span class="tag t-gray">'+esc(traStatus(r)||'—')+'</span>';
  return '<span class="tag '+m.tag+'"><i class="fa-solid '+m.icon+'"></i> '+m.label+'</span>';
}
function traMatchTag(r){
  const m=TRA_MATCH_META[String(r&&r.comparison_status||'')];
  if(!m)return '<span class="tag t-gray">—</span>';
  return '<span class="tag '+m.tag+'"><i class="fa-solid '+m.icon+'"></i> '+m.label+'</span>';
}
window.traRetry=async function(id){
  const btns=document.querySelectorAll('[onclick="traRetry('+id+')"]');
  btns.forEach(function(b){b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Starting';});
  try{
    const {data:{session}}=await sb.auth.getSession();
    const token=session&&session.access_token;
    const res=await fetch(SUPABASE_URL+'/functions/v1/transcription-sync',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},
      body:JSON.stringify({action:'retry',id:id,gemini_model:TRA_RETRY_MODEL})});
    const out=await res.json().catch(function(){return {};});
    if(!res.ok||out.error)throw new Error(out.error||('HTTP '+res.status));
    toast(out.work&&out.work.processed?'Transcription and QA started':'Queued - it runs as soon as the current recording finishes','ok');
  }catch(e){
    toast('Could not retry: '+((e&&e.message)||e),'err');
  }
  /* The re-render is what puts the button back, so it has to happen even if the refetch fails -
     otherwise a dropped connection leaves a dead spinner where the Retry button used to be and the
     only way out is reloading the page. */
  try{ await traFetch(true); }
  catch(e){ toast('Retry was sent, but the list could not be refreshed - reload to see it','warn'); }
  traRender(true);
};

/* ---- the tab itself ---- */
function traKV(label,value,mono){
  const str=(value===null||value===undefined)?'':String(value);
  const body=str===''
    ? '<span style="color:var(--slate)">—</span>'
    : (mono&&/^https?:\/\//i.test(str)?trRecLinkText(str):esc(str));
  return '<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--line)">'
    +'<div style="min-width:170px;font-size:12.5px;color:var(--slate)">'+esc(label)+'</div>'
    +'<div style="flex:1;font-size:13.5px;'+(mono?'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;':'')+'">'
    +body+'</div></div>';
}
function traSection(icon,title,inner){
  return '<div class="card card-pad" style="margin-top:16px"><div class="sec-title" style="margin:0 0 10px">'
    +'<i class="fa-solid '+icon+'" style="color:#0d9488"></i> '+esc(title)+'</div>'+inner+'</div>';
}
/* The complete end-to-end conversation, in order, with the MM:SS timestamps Gemini returned. Never
   a summary - the whole point is that someone can read what was actually said. */
function traTranscriptHtml(turns,fallback){
  const list=Array.isArray(turns)?turns:[];
  if(!list.length){
    return fallback
      ? '<div style="font-size:13.5px;white-space:pre-wrap;line-height:1.65">'+esc(fallback)+'</div>'
      : '<div class="empty" style="padding:26px"><i class="fa-solid fa-comment-slash"></i><div>No transcript for this call</div></div>';
  }
  return '<div style="display:flex;flex-direction:column;gap:10px">'+list.map(function(t){
    const agent=/agent/i.test(String(t.speaker||''));
    return '<div style="display:flex;gap:12px">'
      +'<div style="min-width:52px;font-variant-numeric:tabular-nums;font-size:12px;color:var(--slate);padding-top:2px">'+esc(t.timestamp||'')+'</div>'
      +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:11.5px;font-weight:700;color:'+(agent?'#0d9488':'#7c3aed')+';letter-spacing:.02em">'+esc(t.speaker||'Speaker')+'</div>'
        +'<div style="font-size:14px;line-height:1.6;white-space:pre-wrap">'+esc(t.text||'')+'</div>'
      +'</div></div>';
  }).join('')+'</div>';
}
function traQaHtml(qa){
  const list=Array.isArray(qa)?qa:[];
  if(!list.length)return '<div style="color:var(--slate);font-size:13.5px">No QA evaluation for this call.</div>';
  return '<table class="tbl"><thead><tr><th>Point</th><th>Result</th><th>Evidence</th><th>Notes</th></tr></thead><tbody>'
    +list.map(function(p){
      const s=String(p&&p.status||'');
      const cls=/^pass$/i.test(s)?'t-green':/^fail$/i.test(s)?'t-red':/^partial$/i.test(s)?'t-amber':'t-gray';
      return '<tr><td style="font-weight:600">'+esc(p.point||'—')+'</td>'
        +'<td><span class="tag '+cls+'">'+esc(s||'—')+'</span></td>'
        +'<td style="font-size:12.5px">'+esc(p.evidence||'—')+'</td>'
        +'<td style="font-size:12.5px;color:var(--slate)">'+esc(p.notes||'')+'</td></tr>';
    }).join('')+'</tbody></table>';
}
function traFieldsHtml(df){
  if(!df||typeof df!=='object')return '<div style="color:var(--slate);font-size:13.5px">No dashboard fields extracted.</div>';
  const nice={number_asked:'Number asked',pincode_provided:'Pincode provided',lead_category:'Lead category',
    lost_reason:'Lost reason',project_discussed:'Project discussed'};
  return Object.keys(df).map(function(k){return traKV(nice[k]||k,df[k]);}).join('');
}
function traCritHtml(c){
  if(!c||typeof c!=='object')return '';
  const nice={site_visit_interested:'Site visit agreed',location_match:'Location matches',
    bhk_match:'Configuration matches',budget_match:'Budget matches',
    ready_move_match:'Possession matches',follow_up_requested:'Follow-up requested'};
  return '<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">'+Object.keys(nice).map(function(k){
    const on=c[k]===true;
    return '<div style="display:flex;align-items:center;gap:8px;font-size:13.5px">'
      +'<i class="fa-solid '+(on?'fa-circle-check':'fa-circle-xmark')+'" style="color:'+(on?'#16a34a':'#cbd5e1')+'"></i> '+esc(nice[k])+'</div>';
  }).join('')+'</div>';
}
/* Earlier calls on this lead. Each one kept everything that made it a call, so the history is
   inspectable rather than a list of dates. */
function traHistoryHtml(hist){
  const list=Array.isArray(hist)?hist:[];
  if(!list.length)return '';
  return traSection('fa-clock-rotate-left','Earlier calls on this lead ('+list.length+')',
    list.map(function(h,i){
      const turns=Array.isArray(h.utterances)?h.utterances:[];
      return '<details style="border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin-bottom:8px">'
        +'<summary style="cursor:pointer;font-size:13.5px;font-weight:600">'
          +esc(h.source_date||'unknown date')+' · '+esc(h.crm_status||'—')
          +' · <span style="font-weight:400;color:var(--slate)">'+esc(h.processing_status||'—')+'</span>'
          +(h.comparison_status?' · '+esc(h.comparison_status):'')+'</summary>'
        +'<div style="margin-top:10px">'
          +traKV('Comparison reason',h.comparison_reason)
          +traKV('Recording URL',h.recording_url,true)
          +(h.non_transcribable_reason?traKV('Not transcribable',h.non_transcribable_reason):'')
          +(h.summary_verdict?'<div style="margin-top:10px;font-size:13.5px;line-height:1.6;white-space:pre-wrap">'+esc(h.summary_verdict)+'</div>':'')
          +(turns.length||h.transcript?'<div style="margin-top:12px">'+traTranscriptHtml(turns,h.transcript)+'</div>':'')
        +'</div></details>';
    }).join(''));
}

/* Remarks — anyone who can reach this page can leave one, and everyone sees the same list. Stored in
   acc.transcription_comments, the SAME table the manual-upload tab uses, so a call discussed on
   either side of the app has one thread rather than two. Rendered as a table here because that is
   what this page is: rows of facts, and a remark is one more column of judgement beside them. */
/* A conversation, not a log. Same .chat-* components the manual-upload tab already uses, so the two
   sides of the app look like one product and there is only one set of styles to maintain. Your own
   remarks sit right-aligned; everyone else's carry an avatar. */
function traRemarksHtml(rows,id){
  const list=Array.isArray(rows)?rows:[];
  const thread=list.length
    ? list.map(function(c){
        const mine=c.author===(state&&state.email);
        return '<div class="chat-msg'+(mine?' mine':'')+'">'
          +(mine?'':avatar(nameOf(c.author)))
          +'<div style="min-width:0">'
            +'<div class="chat-meta"><b>'+esc(mine?'You':nameOf(c.author))+'</b>'
              +'<span>'+relTime(c.created_at)+'</span>'
              +(mine?'<i class="fa-solid fa-trash tr-cm-del" title="Delete remark" onclick="traCmDelete('+c.id+','+id+')"></i>':'')
            +'</div>'
            +'<div class="chat-bubble">'+esc(c.body)+'</div>'
          +'</div>'
        +'</div>';
      }).join('')
    : '<div class="empty" style="padding:26px 10px"><i class="fa-solid fa-comment-slash"></i>'
      +'<div style="font-size:13px">No remarks yet — anyone on the team can add one</div></div>';
  return '<div class="chat-wrap" id="traCmWrap">'+thread+'</div>'
    +'<div class="tr-cm-composer">'
      +'<input id="traCmNew" placeholder="Add a remark…" onkeydown="if(event.key===\'Enter\')traCmAdd('+id+')">'
      +'<button class="tr-cm-send" onclick="traCmAdd('+id+')" title="Post remark"><i class="fa-solid fa-paper-plane"></i></button>'
    +'</div>';
}
window.traCmAdd=async function(id){
  const inp=$('traCmNew');const body=(inp&&inp.value||'').trim();
  if(!body)return;
  try{
    await sb.schema('acc').from('transcription_comments')
      .insert({transcription_id:id,author:(state&&state.email)||null,body:body});
  }catch(e){ toast('Could not post remark: '+((e&&e.message)||e),'err'); return; }
  trLogActivity(id,null,'commented');
  traDetail($('view'),id);
};
window.traCmDelete=async function(cid,id){
  const ok=await confirmDialog('Delete this remark?');
  if(!ok)return;
  try{ await sb.schema('acc').from('transcription_comments').delete().eq('id',cid); }
  catch(e){ toast((e&&e.message)||'Failed to delete','err'); return; }
  trLogActivity(id,null,'remark_deleted');
  toast('Remark deleted','ok');
  traDetail($('view'),id);
};

/* Re-reads this one call and repaints the page. Nothing to invalidate first: unlike the lead page,
   this view fetches straight from acc.transcriptions on every render and keeps no snapshot. */
window.traDetailRefresh=async function(id){
  const b=document.getElementById('traDetailRefreshBtn');
  if(b){b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Refreshing';}
  try{
    await traDetail($('view'),id);
  }catch(e){
    toast('Could not refresh this call: '+((e&&e.message)||e),'err');
    if(b&&document.body.contains(b)){b.disabled=false;b.innerHTML='<i class="fa-solid fa-rotate"></i> Refresh';}
  }
};

async function traDetail(v,id){
  setCrumb([['Growth & Strategy','#/'],['Transcription','#/'],'Call']);
  loader(v);
  /* THE CALL AND ITS REMARKS ARE FETCHED TOGETHER, NOT ONE AFTER THE OTHER.
     The remarks query is keyed on the id from the address bar, not on anything inside the call,
     so waiting for the call to come back before asking for them was dead time - two round trips
     to Mumbai in series where one pair in parallel does. Each still fails on its own: a missing
     call is the "not found" card below, and remarks that fail to load leave the panel empty
     rather than taking the whole screen down with them. */
  const [rowRes,cmtRes]=await Promise.all([
    sb.schema('acc').from('transcriptions').select('*').eq('id',id).single()
      .then(function(x){return x;},function(){return {data:null};}),
    sb.schema('acc').from('transcription_comments').select('*')
      .eq('transcription_id',id).order('created_at')
      .then(function(x){return x;},function(){return {data:[]};})
  ]);
  const r=rowRes&&rowRes.data;
  if(!r){
    v.innerHTML=mHead('fa-microphone-lines','#0d9488','Transcription')
      +'<div class="card card-pad empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Call not found</div>'
      +'<button class="btn btn-sm" style="margin-top:12px" onclick="navTo(\'transcription/0\')">Back</button></div>';
    return;
  }
  const st=traStatus(r);
  const remarks=(cmtRes&&cmtRes.data)||[];
  const crm=r.original_crm_response||{};
  const back='<button class="btn btn-sm" onclick="goBack(\'transcription/0\')"><i class="fa-solid fa-arrow-left"></i> All calls</button>';
  const retry=(st==='failed')
    ?'<button class="btn btn-primary" onclick="traRetry('+r.id+')"><i class="fa-solid fa-rotate-right"></i> Retry</button>':'';
  /* Was "Copy Response" - the same JSON-to-clipboard button the lead page carried as "Copy CRM
     response", and removed for the same reason: the whole CRM record is already laid out in the
     card below, field by field, and a blob of JSON on the clipboard answered a question nobody on
     this page was asking. Refresh is what that spot is actually wanted for - this page has no cache
     to drop, so it simply re-reads the call and repaints. */
  const refresh='<button class="btn" id="traDetailRefreshBtn" onclick="traDetailRefresh('+r.id+')">'
    +'<i class="fa-solid fa-rotate"></i> Refresh</button>';

  /* The CRM record, whatever keys it carried. Rendered from the stored response rather than from
     the unpacked columns, so a field the API starts sending tomorrow shows up here on its own. */
  const crmKeys=Object.keys(crm).filter(function(k){return k.charAt(0)!=='_';});
  const crmHtml=crmKeys.length
    ? crmKeys.map(function(k){return traKV(k.replace(/_/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase();}),crm[k],/url/i.test(k));}).join('')
      +(crm._reconstructed?'<div style="margin-top:10px;font-size:12px;color:#92400e;background:#fef3c7;border-radius:6px;padding:8px 10px">This record predates response capture — it was reconstructed from the stored fields, not from the API payload.</div>':'')
    : traKV('Lead ID',r.lead_id)+traKV('Lead Name',r.customer_name)+traKV('Recording URL',r.recording_url,true)
      +traKV('CRM Status',r.crm_status)+traKV('Business Unit',r.business_unit_name)
      +traKV('Next Follow-up',r.next_follow_up_date)+traKV('Lost Reason',r.crm_lost_reason)+traKV('Remarks',r.crm_remarks);

  const trail=Array.isArray(r.status_trail)?r.status_trail.filter(Boolean):[];
  const trailHtml=trail.length>1
    ? '<div style="margin:6px 0 0;font-size:13.5px">CRM verdict over time: <b>'
      +trail.map(esc).join('</b> <i class="fa-solid fa-arrow-right" style="font-size:10px;color:var(--slate)"></i> <b>')+'</b></div>'
    : '';

  v.innerHTML='<div class="page-head"><div><h1><i class="fa-solid fa-phone" style="color:#0d9488"></i> '
      +esc(r.customer_name||r.title||('Lead '+(r.lead_id||'')))+'</h1>'
      +'<p>Lead '+esc(String(r.lead_id||'—'))+' · '+esc(traRowDate(r)||'—')+'</p></div>'
      +'<div style="display:flex;gap:10px;flex-wrap:wrap">'+back+refresh+retry+'</div></div>'
    +'<div class="card card-pad" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">'
      +traStatusTag(r)+traMatchTag(r)
      +(r.crm_status?'<span class="tag t-blue">CRM: '+esc(r.crm_status)+'</span>':'')
      +traDerivedTag(r)
      +(r.qa_score!==null&&r.qa_score!==undefined?'<span class="tag t-gray">QA '+esc(String(r.qa_score))+'%</span>':'')
      +(r.duration_seconds?'<span class="tag t-gray">'+esc(trFmtDur(r.duration_seconds))+'</span>':'')
      +trailHtml
    +'</div>'
    +'<div class="grid" style="grid-template-columns:1fr 1fr;gap:16px;margin-top:16px" id="traGrid">'
      +'<div class="card card-pad"><div class="sec-title" style="margin:0 0 10px"><i class="fa-solid fa-address-card" style="color:#0d9488"></i> CRM details</div>'+crmHtml+'</div>'
      +'<div class="card card-pad"><div class="sec-title" style="margin:0 0 10px"><i class="fa-solid fa-gears" style="color:#0d9488"></i> Processing</div>'
        +traKV('Processing status',(TRA_STATUS_META[st]||{}).label||st)
        +traKV('Attempt count',String(r.attempt_count||r.attempts||0))
        +traKV('Queued at',r.queued_at?fmtDate(r.queued_at)+' '+new Date(r.queued_at).toLocaleTimeString('en-IN'):null)
        +traKV('Processing started',r.processing_started_at?fmtDate(r.processing_started_at)+' '+new Date(r.processing_started_at).toLocaleTimeString('en-IN'):null)
        +traKV('Completed at',r.completed_at?fmtDate(r.completed_at)+' '+new Date(r.completed_at).toLocaleTimeString('en-IN'):null)
        +traKV('Queue position',r.queue_seq)
        +traKV('Model',r.gemini_model)
        /* A requeued call KEEPS the error from the attempt that failed - it is the audit trail and
           deliberately not cleared. But labelling it plain "Last error" while the row sits in the
           queue reads as though it had just failed again, which is exactly how ten recovered calls
           looked like ten still-broken ones. Say which attempt it belongs to instead. */
        +traKV(TRA_IN_FLIGHT[st]?'Last error (previous attempt)':'Last error',r.last_error||r.error_text)
        +(r.non_transcribable_reason?traKV('Not transcribable',r.non_transcribable_reason):'')
        /* Kept only when a reply could not be parsed. Not the raw-result dump that used to sit at the
           bottom of this page — without this a failed row cannot be diagnosed at all. */
        +(r.gemini_raw
          ? '<details style="margin-top:10px"><summary style="cursor:pointer;font-size:12.5px;color:#dc2626">'
            +'Model reply that failed to parse</summary>'
            +'<pre style="margin-top:8px;overflow:auto;max-height:260px;font-size:11.5px;background:#fef2f2;padding:10px;border-radius:8px;white-space:pre-wrap">'
            +esc(r.gemini_raw)+'</pre></details>'
          : '')
      +'</div>'
    +'</div>'
    +traSection('fa-code-compare','CRM comparison',
        traKV('CRM status',r.crm_status)
       +traKV('Transcription-derived status',TRA_DERIVED_LABEL[r.transcription_status]||r.transcription_status)
       +'<div style="display:flex;gap:10px;padding:8px 0;align-items:center"><div style="min-width:170px;font-size:12.5px;color:var(--slate)">Result</div>'+traMatchTag(r)+'</div>'
       +'<div style="font-size:13.5px;line-height:1.6;color:var(--ink)">'+esc(r.comparison_reason||'—')+'</div>')
    +traSection('fa-quote-left','Complete conversation',traTranscriptHtml(r.utterances,r.transcript))
    +'<div class="grid" style="grid-template-columns:1fr 1fr;gap:16px;margin-top:16px" id="traGrid2">'
      +'<div class="card card-pad"><div class="sec-title" style="margin:0 0 10px"><i class="fa-solid fa-table-list" style="color:#0d9488"></i> Dashboard fields</div>'
        +traFieldsHtml(r.dashboard_fields)+traCritHtml(r.criteria)+'</div>'
      +'<div class="card card-pad"><div class="sec-title" style="margin:0 0 10px"><i class="fa-solid fa-wand-magic-sparkles" style="color:#0d9488"></i> Summary / verdict</div>'
        +'<div style="font-size:14px;line-height:1.65;white-space:pre-wrap">'+(r.summary_verdict?esc(r.summary_verdict):'<span style="color:var(--slate)">No verdict for this call.</span>')+'</div></div>'
    +'</div>'
    +traSection('fa-clipboard-check','QA evaluation',traQaHtml(r.qa_evaluation))
    +traHistoryHtml(r.call_history)
    +traSection('fa-comments','Remarks',traRemarksHtml(remarks,r.id));

  const s=document.createElement('style');
  s.textContent='@media(max-width:900px){#traGrid,#traGrid2{grid-template-columns:1fr!important}}';
  document.head.appendChild(s);
}

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
/* Retry is offered for a recording that failed OR is queued/unfinished (Waiting, or transcribed but
   its QA never ran). queue_status is what proves the call is really in the pipeline: a call that was
   never queued has none and has nothing to retry. */
function trcCanRetry(r){
  if(!r||!r.recording_url&&!r.has_recording&&!r.queue_status)return false;
  if(trcProcFailed(r))return true;
  return ['pending','transcribing','qa_pending','qa_running'].indexOf(String(r.queue_status||''))>=0;
}
function trcRetryLabel(r){return trcProcFailed(r)?'Retry':'Start now';}
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
const TRC_CACHE_TTL_MS=5*60*60*1000;
function trCacheRead(key,matchKey){
  try{
    const c=JSON.parse(sessionStorage.getItem(key)||'null');
    if(!c||c.key!==matchKey)return null;
    if(Date.now()-c.ts>TRC_CACHE_TTL_MS)return null;
    return c.rows;
  }catch(e){return null;}
}
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
  /* Added so trcLeads' cadence/callbackTat (see its own note) stop reading the range-limited rows the
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
function trcSaveFilterState(){
  try{sessionStorage.setItem('trc_filters_state',JSON.stringify(TRC_F));}catch(e){}
}
/* The "coming back from elsewhere" half of the rule above - see activateModule. Deliberately mutates
   the existing TRC_F object rather than reassigning the const, since closures elsewhere already hold
   this exact reference. */
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
let TRC_PAGE_ROWS=[];

/* THE FOUR KPI CARDS AND FIVE CHIPS, from acc.daily_qa_summary instead of counting every fetched row
   in the browser (see 20260917110000) - one row per calendar day, summed over the selected range. Only
   valid when the range's OWN totals are what the cards should show: the moment a CRM-status, business
   unit or personnel filter narrows the scope, the day table can't answer it (it isn't broken down that
   way), and trcKpiHtml falls back to counting `rows` exactly as it always did. Keyed on the range so a
   stale fetch from a previous range is never read as this one's numbers. */
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
  +'personnel_id,personnel_name,personnel_email,personnel_role';

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
async function trcFetchLight(force){
  const rangeKey=(TRC_F.from||'')+'|'+(TRC_F.to||'');
  if(TRC_ROWS&&!force&&TRC_ROWS_RANGE===rangeKey)return TRC_ROWS;
  /* Its own sessionStorage key, never trc_fetch_cache (that one is trcFetchFull's) - the two must
     never collide, or a light snapshot read back under the full-fetch's key would be trusted as
     already enriched, and a full snapshot read back here would get silently thrown away in favour
     of a lighter one. See trcFetchFull for the one place a full fetch also writes THIS key, because
     full data is strictly good enough to answer a light request too. */
  if(!force){
    const cached=trCacheRead('trc_fetch_light_cache',rangeKey);
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
    let q=sb.schema('acc').from('crm_followups').select(TRC_CRM_LIGHT)
      .order('call_date',{ascending:false,nullsFirst:false})
      .order('communication_time',{ascending:false,nullsFirst:false})
      .order('follow_up_id',{ascending:false});
    if(TRC_F.from)q=q.gte('call_date',TRC_F.from);
    if(TRC_F.to)q=q.lte('call_date',TRC_F.to);
    const {data,error}=await q;
    if(error)throw error;
    const rows=data||[];
    /* lead_current_status/lead_current_lost_reason live on acc.crm_leads, one row per lead - a second
       light query, keyed on just the distinct leads this range actually has, rather than folding
       crm_leads into the query above and paying a join for it. */
    const leadIds=Array.from(new Set(rows.map(function(r){return r.lead_id;}).filter(function(v){return v!=null;})));
    let leadMap={};
    if(leadIds.length){
      const {data:leads,error:e2}=await sb.schema('acc').from('crm_leads')
        .select('lead_id,status,lost_reason').in('lead_id',leadIds);
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
    trCacheWrite('trc_fetch_light_cache',rangeKey,rows);
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
    const cached=trCacheRead('trc_fetch_cache',rangeKey);
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
  const PAGE=20000;let out=[],from=0;
  try{
    for(;;){
      let q=sb.schema('acc').from('followup_timeline_v').select(TRC_LIGHT)
        .order('call_date',{ascending:false,nullsFirst:false})
        .order('communication_time',{ascending:false,nullsFirst:false})
        .order('follow_up_id',{ascending:false})
        .range(from,from+PAGE-1);
      if(TRC_F.from)q=q.gte('call_date',TRC_F.from);
      if(TRC_F.to)q=q.lte('call_date',TRC_F.to);
      const {data,error}=await q;
      if(error)throw error;
      const batch=data||[];out=out.concat(batch);
      if(batch.length<PAGE)break;
      from+=PAGE;if(from>50000)break;
    }
    out.forEach(function(r){r._enriched=true;});
    TRC_ROWS=out;TRC_ROWS_RANGE=rangeKey;TRC_ROWS_ENRICHED=true;TRC_QA_MERGED_RANGE=null;
    trCacheWrite('trc_fetch_cache',rangeKey,out);
    // Full data answers a light request too (see trcFetchLight) - written under its key as well so a
    // later visit to this same range never fetches a step down from what is already sitting here.
    trCacheWrite('trc_fetch_light_cache',rangeKey,out);
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
    let q=sb.schema('acc').from('followup_qa').select(
      'follow_up_id,qa_id:id,pitch_score,pitch_status,followup_date_status,lost_reason_status,'
      +'retention_status,etiquette_status,query_handling_status,personal_mobile_status,personal_mobile_number,remarks_status,ai_assessed_status,visit_pending,status_match,mismatch_type,qa_score,qa_model,'
      +'qa_error,reused_transcription,is_latest_assessed');
    if(TRC_F.from)q=q.gte('call_date',TRC_F.from);
    if(TRC_F.to)q=q.lte('call_date',TRC_F.to);
    const {data,error}=await q;
    if(error)throw error;
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
      trCacheWrite('trc_fetch_light_cache',TRC_ROWS_RANGE,TRC_ROWS);
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
    let sq=sb.schema('acc').from('daily_qa_summary').select('*');
    if(TRC_F.from)sq=sq.gte('date',TRC_F.from);
    if(TRC_F.to)sq=sq.lte('date',TRC_F.to);
    const lq=sb.schema('acc').rpc('crm_lead_count_in_range',{p_from:TRC_F.from||null,p_to:TRC_F.to||null});
    const [{data:days,error:e1},{data:leadCount,error:e2}]=await Promise.all([sq,lq]);
    if(e1||e2)throw (e1||e2);
    const sum={total_followups:0,recordings_available:0,transcribed:0,already_transcribed:0,
      non_transcribable:0,transcription_failed:0,pending:0,not_in_scope:0,qa_assessed:0,
      pitch_score_sum:0,pitch_score_n:0,pitch_accurate:0,pitch_partially_accurate:0,pitch_inaccurate:0,
      followup_date_accurate:0,followup_date_inaccurate:0,followup_date_not_verifiable:0,
      lost_reason_accurate:0,lost_reason_inaccurate:0,lost_reason_not_verifiable:0,
      remarks_accurate:0,remarks_partially_accurate:0,remarks_inaccurate:0,remarks_not_verifiable:0,
      status_match:0,status_mismatch:0,lost_should_not_have_been_lost:0,
      qualified_should_not_have_been_qualified:0,in_followup_should_have_been_lost:0,
      in_followup_should_have_been_qualified:0,
      agent_qa_score_sum:0,agent_qa_score_n:0,
      reused_transcription:0,
      /* Safe to sum day-by-day and add across a range, unlike total_leads - is_latest_assessed
         (20260918100000) is unique per lead across the WHOLE table, so a lead's match/mismatch
         contribution lands on exactly one day, ever. See 20260918110000. */
      status_match_leads:0,status_mismatch_leads:0,
      lost_should_not_have_been_lost_leads:0,qualified_should_not_have_been_qualified_leads:0,
      in_followup_should_have_been_lost_leads:0,in_followup_should_have_been_qualified_leads:0};
    (days||[]).forEach(function(d){
      Object.keys(sum).forEach(function(k){sum[k]+=Number(d[k]||0);});
    });
    sum.total_leads=Number(leadCount||0);
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
  if(TRC_KPI_FAST&&TRC_ROWS&&TRC_KPI_FAST.total_followups!==TRC_ROWS.length){
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
function trcApply(rows,skipCards){
  const q=String(TRC_F.q||'').trim().toLowerCase();
  const all=rows||[];
  return all.filter(function(r){
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
      if(TRC_F.proc==='failed'){ if(!trcProcFailed(r))return false; }
      else if(TRC_F.proc!=='all'&&trcTrStatus(r)!==TRC_F.proc)return false;
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
    g.callbackOverdue=trcCallbackOverdue(g.status,g.rows);
    /* Cadence and callback TAT judge a lead's WHOLE follow-up history, not just whatever slice of it
       falls inside the selected date range - g.rows is range-limited, so judging off it directly would
       silently score a lead only on the one call that happened to land in the window (which is why
       these two used to read exactly like g.callbackOverdue - both collapsing to "the latest call in
       range" when the range is a single day). The full history is exactly what trcPrefetchHistories
       already warms in the background for click-through (see trcAfterListRender) - reuse it once it
       has arrived; a lead not yet warmed simply falls back to the range-limited rows for this one
       render, same as every other lazily-enriched field here, until trcPrefetchHistories' own
       completion re-render (see its own note) picks it up. */
    const cachedHistory=trcLeadCacheRead(g.lead_id);
    const historyRows=cachedHistory?cachedHistory.rows:g.rows;
    g.cadence=trcCadenceIssues(g.status,historyRows);
    g.callbackTat=trcFirstCallbackTat(historyRows);
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
function trcKpiHtml(rows){
  const n=function(st){return rows.filter(function(r){return trcTrStatus(r)===st;}).length;};
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
  const totalCalls=fast?fast.total_followups:rows.length;
  /* Every card's own lead count - always counted from `rows` (the fetched range, filtered by date/CRM
     status/business unit/personnel/search but not by which card is active), never from the fast path:
     there is no per-category distinct-lead total to sum from acc.daily_qa_summary (the same reason
     total_leads has its own RPC instead of being a column there - a lead transcribed on two different
     days is one lead, not two), and this is cheap enough as a plain array scan that it never needed
     one. */
  const leadsOf=function(pred){return new Set(rows.filter(pred).map(function(r){return r.lead_id;})).size;};
  const leadCount=fast?fast.total_leads:leadsOf(function(){return true;});
  /* Total Calls' own lead count is safe unconditionally - lead_id is on every row whether or not it
     has been enriched yet. Transcribed/Match/Mismatch's lead counts are NOT: they read
     trcTrStatus/status_match, which the fast crm_followups-only fetch never carries (see
     trcFetchLight) until trcEnrichVisiblePage fills in whichever leads are actually on screen. Asking
     for them across the whole range before that would silently undercount almost everything, so the
     subtitle just leaves the lead count off until the row data backs it up. */
  const haveDetail=TRC_ROWS_ENRICHED;
  const transcribedLeads=haveDetail?leadsOf(function(r){return trcTrStatus(r)==='completed';}):null;
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
  const cards=[
    ['Total Calls',totalCalls,'follow-ups in '+inLeads(leadCount),'var(--slate)','all','proc'],
    ['Transcribed',fast?fast.transcribed:n('completed'),
      'with a full transcript'+(haveDetail?', in '+inLeads(transcribedLeads):''),'#16a34a','completed','proc'],
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
  // "Not in scope" chip removed by request (2026-09-18) - a row that is out of scope still shows its
  // own "Not in scope" tag in the table (see TRC_TR_META), this just drops it as a KPI-row filter chip.
  const sub=[
    ['Waiting','not_transcribed',fast?fast.pending:n('not_transcribed'),'fa-clock'],
    ['No recording','no_recording',fast?(fast.total_followups-fast.recordings_available):n('no_recording'),'fa-phone-slash'],
    ['No conversation','non_transcribable',fast?fast.non_transcribable:n('non_transcribable'),'fa-volume-xmark'],
    ['Failed','failed',fast?fast.transcription_failed:rows.filter(trcProcFailed).length,'fa-circle-exclamation']
  ];
  const assessed=fast?fast.qa_assessed:rows.filter(function(r){return r.qa_id;}).length;
  const reused=fast?fast.reused_transcription:rows.filter(function(r){return r.reused_transcription;}).length;
  /* Missed callback needs lead_current_status (to exclude Lost leads), which only the full join
     carries (see TRC_LIGHT) - same enrichment tier the 'proc' cards already require. Computed by
     actually rolling `rows` up into leads (trcLeads), not a flat count, because "overdue" is a
     property of a LEAD's latest call, not of any one row. */
  const overdueLeads=haveDetail?trcLeads(rows).filter(function(g){return g.callbackOverdue;}).length:null;
  const cadenceLeads=haveDetail?trcLeads(rows).filter(function(g){return g.cadence;}).length:null;
  const callbackTatLeads=haveDetail?trcLeads(rows).filter(function(g){return g.callbackTat;}).length:null;
  return '<div class="grid kpis" style="grid-template-columns:repeat(4,1fr)">'+cards.map(function(c){
      const active=(c[5]==='proc'?TRC_F.proc:TRC_F.match)===c[4];
      return '<div class="kpi" style="cursor:pointer'+(active?';box-shadow:inset 0 0 0 2px '+c[3]:'')+'" onclick="trcCard(\''+c[5]+'\',\''+c[4]+'\')">'
        +'<div class="lbl" style="margin-bottom:7px">'+esc(c[0])+(active?' <i class="fa-solid fa-filter" style="font-size:10px"></i>':'')+'</div>'
        +'<div class="val">'+c[1]+'</div>'
        +'<div style="font-size:12px;color:'+c[3]+';margin-top:3px">'+esc(c[2])+'</div></div>';
    }).join('')+'</div>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center">'+sub.map(function(s){
      const on=TRC_F.proc===s[1];
      return '<button class="btn btn-sm'+(on?' btn-primary':'')+'" onclick="trcCard(\'proc\',\''+s[1]+'\')">'
        +'<i class="fa-solid '+s[3]+'"></i> '+esc(s[0])+' <b>'+s[2]+'</b></button>';
    }).join('')
    +'<span style="width:1px;height:22px;background:var(--line)"></span>'
    +'<button class="btn btn-sm'+(TRC_F.overdue==='1'?' btn-primary':'')+'" onclick="trcToggleOverdue()" title="A promised next-follow-up date that has passed with nothing logged since - not counted until the fuller lead data has loaded">'
      +'<i class="fa-solid fa-phone-slash"></i> Missed callback'+(overdueLeads===null?'':' <b>'+overdueLeads+'</b>')+'</button>'
    +'<button class="btn btn-sm'+(TRC_F.cadence==='1'?' btn-primary':'')+'" onclick="trcToggleCadence()" title="At least one follow-up gap where the recontact was late - a scheduled date missed, or no date and more than 3 days passed. Not counted until the fuller lead data has loaded">'
      +'<i class="fa-solid fa-hourglass-half"></i> Cadence issues'+(cadenceLeads===null?'':' <b>'+cadenceLeads+'</b>')+'</button>'
    +'<button class="btn btn-sm'+(TRC_F.callbackTat==='1'?' btn-primary':'')+'" onclick="trcToggleCallbackTat()" title="The first call on this lead happened after the day it first appeared in the CRM - not counted until the fuller lead data has loaded">'
      +'<i class="fa-solid fa-phone-volume"></i> Slow first callback'+(callbackTatLeads===null?'':' <b>'+callbackTatLeads+'</b>')+'</button>'
    +'<span style="width:1px;height:22px;background:var(--line)"></span>'
    +'<span style="font-size:12.5px;color:var(--slate)">QA assessed <b style="color:var(--ink)">'+assessed+'</b></span>'
    /* Deduplication is invisible unless it is counted. This is the number of follow-ups that reused a
       transcript already paid for, which is the whole point of keying on recording_url. */
    +'<span style="font-size:12.5px;color:var(--slate)">Reused an existing transcript <b style="color:var(--ink)">'+reused+'</b></span>'
    +'</div>'
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

/* An independent toggle, not a fourth tab in the group above - it narrows whichever set of leads is
   already on screen (a card, a mismatch category, a search) down to the ones with a missed callback,
   the same way the accuracy dropdowns in the filter bar narrow it, rather than replacing that set.
   Needs lead_current_status (to exclude Lost leads) - only the full join carries that, same as the
   'proc' cards. */
window.trcToggleOverdue=async function(){
  TRC_F.overdue=(TRC_F.overdue==='1'?'all':'1');
  if(TRC_F.overdue==='1')await trcEnsureFullEnrichment();
  trcRender(true);
};
/* Same idea as trcToggleOverdue, narrowing to leads with at least one late follow-up gap (see
   trcCadenceIssues) instead of only the current open one. Needs the full join for the same reason -
   the check is skipped for Lost leads, which only lead_current_status (TRC_LIGHT) can tell it. */
window.trcToggleCadence=async function(){
  TRC_F.cadence=(TRC_F.cadence==='1'?'all':'1');
  if(TRC_F.cadence==='1')await trcEnsureFullEnrichment();
  trcRender(true);
};
/* Same idea again, narrowing to leads whose first-ever call landed later than lead_first_seen_date
   (see trcFirstCallbackTat). Needs the full join too - lead_first_seen_date only travels with it. */
window.trcToggleCallbackTat=async function(){
  TRC_F.callbackTat=(TRC_F.callbackTat==='1'?'all':'1');
  if(TRC_F.callbackTat==='1')await trcEnsureFullEnrichment();
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
  TRC_F.personnel='all';TRC_F.fdate='all';TRC_F.remarks='all';TRC_F.pitch='all';TRC_F.overdue='all';
  TRC_F.cadence='all';TRC_F.callbackTat='all';TRC_F.etiquette='all';TRC_F.queryHandling='all';TRC_F.retention='all';TRC_F.lostReason='all';TRC_F.personalMobile='all';
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
      +(g.callbackOverdue?' '+trcTag('t-red','fa-phone-slash','',
          'Missed callback - promised '+(trcWall(g.callbackOverdue.dueDate)||g.callbackOverdue.dueDate)
          +', '+g.callbackOverdue.daysLate+' day'+(g.callbackOverdue.daysLate===1?'':'s')+' overdue'):''))
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
      +(g.callbackOverdue?';color:#dc2626;font-weight:600':'')+'"'
      +(g.callbackOverdue?' title="'+esc(g.callbackOverdue.daysLate+' day'+(g.callbackOverdue.daysLate===1?'':'s')+' overdue')+'"':'')+'>'
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
  let rows=trcApply(all);
  const scope=trcApply(all,true);
  const k=$('trcKpis');if(k)k.innerHTML=trcKpiHtml(scope);
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
  // Missed callback is a per-LEAD fact (see trcCallbackOverdue) - it only narrows the lead rollup, not
  // the call-level Mismatch table, which trcLeads never runs over in the first place.
  if(!callLevel&&TRC_F.overdue==='1')items=items.filter(function(g){return g.callbackOverdue;});
  if(!callLevel&&TRC_F.cadence==='1')items=items.filter(function(g){return g.cadence;});
  if(!callLevel&&TRC_F.callbackTat==='1')items=items.filter(function(g){return g.callbackTat;});
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
  const b=$('trcRows');if(b)b.innerHTML=trcTableHtml(pageItems,callLevel,pageOffset);
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
}

/* ================================================ ONE LEAD, THE WHOLE STORY */
/* Same rule as traKV above: mono marks the URL-shaped fields, so an http(s) value there is rendered
   as a download link rather than as monospace text. */
function trcKV(label,value,mono){
  const str=(value===null||value===undefined)?'':String(value);
  const body=str===''
    ? '<span style="color:var(--slate)">—</span>'
    : (mono&&/^https?:\/\//i.test(str)?trRecLinkText(str):esc(str));
  return '<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--line)">'
    +'<div style="min-width:170px;font-size:12.5px;color:var(--slate)">'+esc(label)+'</div>'
    +'<div style="flex:1;min-width:0;font-size:13.5px;'+(mono?'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;':'')+'">'
    +body+'</div></div>';
}
/* The complete conversation, in order, with the MM:SS timestamps the transcriber returned. Never a
   summary - being able to read what was actually said is the point of the whole pipeline. */
function trcTranscriptHtml(turns,fallback){
  const list=Array.isArray(turns)?turns:[];
  if(!list.length){
    return fallback
      ? '<div style="font-size:13.5px;white-space:pre-wrap;line-height:1.65">'+esc(fallback)+'</div>'
      : '<div style="color:var(--slate);font-size:13px;padding:8px 0">No transcript for this call.</div>';
  }
  return '<div style="display:flex;flex-direction:column;gap:10px">'+list.map(function(t){
    const agent=/agent/i.test(String(t.speaker||''));
    return '<div style="display:flex;gap:12px">'
      +'<div style="min-width:52px;font-variant-numeric:tabular-nums;font-size:12px;color:var(--slate);padding-top:2px">'+esc(t.timestamp||'')+'</div>'
      +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:11.5px;font-weight:700;color:'+(agent?'#0d9488':'#7c3aed')+';letter-spacing:.02em">'+esc(t.speaker||'Speaker')+'</div>'
        +'<div style="font-size:14px;line-height:1.6;white-space:pre-wrap">'+esc(t.text||'')+'</div>'
      +'</div></div>';
  }).join('')+'</div>';
}

/* ONE CONVERSATION, whole. CRM record, how it was processed, what was said, and the five judgements -
   in that order, because that is the order someone checking the CRM reads them in. */
/* One flat table per call - every QA topic (the four accuracy checks, the status check, and the
   six-point agent audit) as a row of its own, each with a result, marks where the topic carries a
   number, and why. Deliberately not five cards plus a collapsible "six-point audit" details tab:
   one table, always visible, is what "marks and why for each" without separate tabs asked for. */
function trcQaResultClass(s){
  s=String(s||'');
  return /^(accurate|pass|match)$/i.test(s)?'t-green'
    :/^(inaccurate|fail|mismatch)$/i.test(s)?'t-red'
    :/^(partial|partially accurate)$/i.test(s)?'t-amber':'t-gray';
}
/* The same verdict as a mark: tick where the call backs the CRM up, cross where it contradicts it,
   half-filled for partly, question mark where the call could not settle it. Colour alone was doing
   this job, which is no help to anyone reading the page in greyscale or scanning it quickly. */
function trcQaResultIcon(s){
  s=String(s||'');
  return /^(accurate|pass|match)$/i.test(s)?'fa-check'
    :/^(inaccurate|fail|mismatch)$/i.test(s)?'fa-xmark'
    :/^(partial|partially accurate)$/i.test(s)?'fa-circle-half-stroke':'fa-circle-question';
}
function trcQaTableHtml(r,m){
  if(!r.qa_id){
    return '<div style="margin-top:12px;font-size:13px;color:var(--slate)">'
      +esc(r.transcription_status==='completed'
            ? 'Transcribed, but the QA assessment has not run yet.'
            : 'No QA assessment - this call has no usable transcript to judge against.')+'</div>';
  }
  const pitch=r.pitch_accuracy||{}, fdate=r.followup_date_accuracy||{}, lreason=r.lost_reason_accuracy||{},
        retention=r.retention_effort||{}, rem=r.remarks_accuracy||{}, sa=r.status_assessment||{},
        mobileAsk=r.personal_mobile_requested||{};
  const join=function(parts){return parts.filter(function(x){return x;}).join(' — ');};
  const topics=[
    {topic:'Pitch accuracy',status:r.pitch_status,score:pitch.score,
     why:join([pitch.reason,Array.isArray(pitch.issues)&&pitch.issues.length?pitch.issues.join(' · '):null])},
    {topic:'Follow-up date accuracy',status:r.followup_date_status,score:fdate.score,
     why:join([fdate.reason,fdate.crm_date?'CRM: '+fdate.crm_date:null,
               fdate.customer_agreed_date?'Customer agreed: '+fdate.customer_agreed_date:null])},
    {topic:'Lost reason accuracy',status:r.lost_reason_status,score:lreason.score,
     why:join([lreason.reason,lreason.actual_reason?'The call actually supports: '+lreason.actual_reason:null])},
    // Only meaningful when the CRM status for THIS follow-up is Lost (see qa-prompt.ts section 4) -
    // every other call gets "Not Applicable" from the model, which is a correct answer but not one
    // worth a row on every single call, so the row itself is left out rather than shown as N/A.
    r.crm_status==='Lost'?{topic:'Retention effort (lost leads)',status:r.retention_status,score:retention.score,
     why:join([retention.reason,retention.evidence?'"'+retention.evidence+'"':null])}:null,
    {topic:'Remarks accuracy',status:r.remarks_status,score:rem.score,
     why:join([rem.reason,rem.actual_conversation_summary])},
    {topic:'Personal mobile number requested',status:r.personal_mobile_status,score:null,
     why:join([mobileAsk.reason,(r.personal_mobile_number||mobileAsk.number_shared)?'Number given: '+(r.personal_mobile_number||mobileAsk.number_shared):null,
               mobileAsk.evidence?'"'+mobileAsk.evidence+'"':null])},
    {topic:'Status check',status:r.ai_assessed_status,score:sa.score,
     /* Visit-pending only excuses the CRM's In Follow Up when this lead had ALREADY qualified on an
        earlier call (2026-09-21 gate) - on a first-time qualification it's still flagged, so this note
        only claims "not a disagreement" when the row's own status_match backs that up. Otherwise the
        row genuinely disagrees and m (the actual mismatch entry) already says so. */
     why:join(['CRM: '+(r.crm_status||'—')+' → the call reads as: '+(trcAiStatusLabel(r)||'—'),
               (r.ai_assessed_status==='Qualified'&&r.visit_pending&&r.status_match!==false)
                 ?'Qualified and wants to buy - the site visit itself is the one thing still open, which is why this is not counted as a disagreement with the CRM\'s In Follow Up.':null,
               (r.ai_assessed_status==='Qualified'&&r.visit_pending&&r.status_match===false)
                 ?'Qualified and wants to buy, but this is the FIRST call that qualifies this lead - the site visit being unsettled does not excuse it, so the CRM genuinely needs to be told.':null,
               m?m.label:null,sa.reason])}
  ].filter(Boolean);
  if(Array.isArray(r.agent_qa)){
    r.agent_qa.forEach(function(a){
      topics.push({topic:a&&a.point,status:a&&a.status,
        score:(a&&a.score===null)||(a&&a.score===undefined)?null:Number(a.score),
        why:join([a&&(a.reason||a.notes),a&&a.evidence?'"'+a.evidence+'"':null])});
    });
  }
  /* "Why" is the whole point of the row - it is the reasoning behind the mark, and it is read, not
     scanned. It runs to several sentences (reason + issues/evidence joined together) and it wraps
     in full on the face of the row. Never truncate it into a hover title: a tooltip is unreadable
     at that length, cannot be copied, and does not exist at all on touch. */
  return '<table class="tbl" style="margin-top:12px"><thead><tr><th>QA topic</th><th>Result</th><th>Marks</th><th>Why</th></tr></thead><tbody>'
    +topics.map(function(x){
      const score=(x.score===null||x.score===undefined||isNaN(x.score))?null:x.score;
      return '<tr><td style="font-weight:600;white-space:nowrap">'+esc(x.topic||'—')+'</td>'
        +'<td><span class="tag '+trcQaResultClass(x.status)+'"><i class="fa-solid '+trcQaResultIcon(x.status)+'"></i> '+esc(x.status||'—')+'</span></td>'
        +'<td style="white-space:nowrap">'+(score===null?'<span style="color:var(--slate)">—</span>':'<b>'+score+'%</b>')+'</td>'
        +'<td style="font-size:12.5px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere">'
          +esc(x.why||'—')+'</td></tr>';
    }).join('')+'</tbody></table>';
}

/* Sits between the verdict and the transcript: read the headline, see at a glance what the call
   agrees with the CRM about and what it contradicts, then go read the words yourself.

   One row - what the customer actually said, when the model returned "signals" for it. Each point
   is tagged Match (supports crm_status standing as it is) or Mismatch (points the other way), so a
   mixed call shows as mixed instead of one blended verdict. How each individual check landed is
   already spelled out row by row in the QA table below, so it is not repeated as chips here.

   Same chip as the pitch fact check, tick for match, cross for mismatch, nothing added on top. */
function trcMarkChip(cls,icon,label,tip){
  return '<div class="mark-item '+cls+'"'+(tip?' title="'+esc(tip)+'"':'')
    +'><i class="fa-solid '+icon+'"></i><span>'+esc(label)+'</span></div>';
}
function trcMarkRowHtml(title,chips){
  return '<div style="margin-top:10px"><div style="font-size:12.5px;font-weight:700;margin-bottom:6px">'
    +esc(title)+'</div><div style="display:flex;flex-wrap:wrap;gap:8px">'+chips+'</div></div>';
}
/* THE FOUR QUALIFICATION GATES, as the audit read them: does what the CUSTOMER wants fit what this
   project offers on location, budget, size and possession. Distinct from the pitch's fact-checks
   above, which ask whether what the AGENT SAID was true - the same call can be pitched perfectly to
   a customer who wants something this project does not build.
   Rendered above the status signals because the gates are what the status verdict rests on, and the
   whole row is skipped for assessments made before the gates existed. */
const TRC_GATES=[['location','Location'],['budget','Budget'],['area_sqft','Size (sqft)'],['position','Ready / under construction']];
function trcQualGatesHtml(r){
  if(!r.qa_id)return '';
  const sa=r.status_assessment&&typeof r.status_assessment==='object'?r.status_assessment:{};
  const g=sa.qualification_check&&typeof sa.qualification_check==='object'?sa.qualification_check:null;
  if(!g)return '';
  const chips=TRC_GATES.map(function(pair){
    const v=String(g[pair[0]]||'');
    const isMatch=/^match$/i.test(v), isMismatch=/^mismatch$/i.test(v);
    const cls=isMatch?'t-green':isMismatch?'t-red':'t-gray';
    const icon=isMatch?'fa-check':isMismatch?'fa-xmark':'fa-circle-question';
    /* A budget gate that matched reads "Budget Match" (and "Budget Mismatch"): a customer's range that
       contains the project's starting price is a match, and that is the wording asked for. */
    const label=pair[0]==='budget'&&(isMatch||isMismatch)?'Budget '+(isMatch?'Match':'Mismatch'):pair[1]+(v?' - '+v:' - not established');
    return trcMarkChip(cls,icon,label,g.note||null);
  }).join('');
  const ratchet=sa.qualification_ratcheted
    ?'<div style="font-size:12px;color:var(--slate);margin-top:6px">'
      +'<i class="fa-solid fa-lock"></i> This lead was already qualified on an earlier call, so the '
      +'assessment is carried forward as Qualified - a next follow-up date and remarks are how a '
      +'qualified lead is worked, not a step back.'
      +(sa.model_assessed_status&&sa.model_assessed_status!==sa.ai_assessed_status
        ?' The call on its own read as '+esc(String(sa.model_assessed_status))+'.':'')
    +'</div>':'';
  return trcMarkRowHtml('Does the customer fit the project (the four qualification gates)',chips)+ratchet;
}

function trcStatusSignalsHtml(r){
  if(!r.qa_id)return '';
  const sa=r.status_assessment&&typeof r.status_assessment==='object'?r.status_assessment:{};
  const signals=Array.isArray(sa.signals)?sa.signals.filter(function(s){return s&&s.point;}):[];
  if(!signals.length)return '';
  return trcMarkRowHtml('What the call says about the status',
    signals.map(function(s){
      return trcMarkChip('t-purple','fa-circle',s.point,null);
    }).join(''));
}

function trcCallHtml(r,i,total){
  const m=TRC_MISMATCH[String(r.mismatch_type||'')];
  const when=trcWall(r.call_start_text,true)||trcWall(r.communication_time&&String(r.communication_time).slice(0,16),true)||trcWall(trcRowDate(r))||'date not recorded';
  const langs=Array.isArray(r.languages)?r.languages.map(function(l){
    return {hi:'Hindi',en:'English',bn:'Bengali'}[l]||l;}).join(', '):'';

  const head='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">'
    +'<span style="font-size:12px;font-weight:700;color:#fff;background:#0d9488;border-radius:999px;padding:3px 10px">'
      +(i+1)+' of '+total+'</span>'
    +'<span style="font-size:14px;font-weight:600">'+esc(when)+'</span>'
    +(r.crm_status?trcTag('t-blue','',r.crm_status):'')
    +(r.personnel_name?trcTag('t-blue','fa-user',r.personnel_name):'')
    +trcTrTag(r)
    +(r.reused_transcription?trcTag('t-gray','fa-recycle','Transcript reused'):'')
    +(r.call_duration?trcTag('t-gray','fa-stopwatch',trFmtDur(r.call_duration)):'')
    +(m?trcTag(m.tag,m.icon,m.short):'')
    +(trcIsRegression(r)?trcTag('t-red','fa-arrow-turn-down','Status regressed from '+(r.prev_status||'—')):'')
    +'<div class="grow"></div>'
    +trRecLink(r.recording_url,{label:'Download recording',file:trRecFile(r),
        feat:'transcription.call_detail.play_download_recording'})
    +(trcCanRetry(r)?'<button class="btn btn-sm btn-primary" onclick="trcRetry('+r.follow_up_id+')" title="Run transcription and QA for this call now"><i class="fa-solid fa-rotate-right"></i> '+trcRetryLabel(r)+'</button>':'')
  +'</div>';

  const crm='<div class="card card-pad" style="margin:0">'
    +'<div style="font-size:12.5px;font-weight:700;margin-bottom:6px"><i class="fa-solid fa-address-card" style="color:#0d9488"></i> What the CRM recorded</div>'
    +trcKV('Follow-up ID',r.follow_up_id)
    +trcKV('Personnel',r.personnel_name||null)
    +trcKV('Status',r.status_detail||r.crm_status_raw||r.crm_status)
    +(trcIsRegression(r)?trcKV('Went back from',r.prev_status+' - not a legitimate step back'):'')
    +trcKV('Next follow-up',trcWall(r.next_follow_up_text,true)||r.next_follow_up_text)
    +trcKV('Remarks',r.crm_remarks)
    +trcKV('Lost reason',r.crm_lost_reason)
    +trcKV('Call duration',r.call_duration?Math.round(Number(r.call_duration))+' seconds':null)
    +trcKV('Recording',r.recording_url,true)
  +'</div>';

  const proc='<div class="card card-pad" style="margin:0">'
    +'<div style="font-size:12.5px;font-weight:700;margin-bottom:6px"><i class="fa-solid fa-gears" style="color:#0d9488"></i> How it was processed</div>'
    +trcKV('Transcription',(TRC_TR_META[trcTrStatus(r)]||{}).label||r.transcription_status)
    +trcKV('Queue state',r.queue_status)
    +trcKV('Transcription model',r.transcription_model)
    +trcKV('QA model',r.qa_model)
    +trcKV('Turns',r.turn_count)
    +trcKV('Languages',langs)
    +trcKV('Audio length',r.duration_seconds?trFmtDur(r.duration_seconds):null)
    +trcKV('Attempts',(r.attempt_count||0)+' transcription · '+(r.qa_attempt_count||0)+' QA')
    +(r.non_transcribable_reason?trcKV('No conversation because',r.non_transcribable_reason):'')
    +(r.queue_error?trcKV('Last error',r.queue_error):'')
    +(r.qa_error?trcKV('QA error',r.qa_error):'')
  +'</div>';

  const accuracy=trcQaTableHtml(r,m);

  return '<div id="trc-call-'+esc(String(r.follow_up_id))+'" class="card card-pad" style="margin-top:14px;border-left:3px solid '+(m?m.colour:'#0d9488')+'">'
    +head
    +'<div class="grid trc-two" style="grid-template-columns:1fr 1fr;gap:12px">'+crm+proc+'</div>'
    +accuracy
    +(r.summary_verdict?'<div style="margin-top:12px;font-size:13.5px;line-height:1.65;white-space:pre-wrap">'
      +'<b style="font-size:12.5px">Verdict.</b> '+esc(r.summary_verdict)+'</div>':'')
    +trcQualGatesHtml(r)
    +trcStatusSignalsHtml(r)
    +'<div style="margin-top:14px"><div style="font-size:12.5px;font-weight:700;margin-bottom:8px">'
      +'<i class="fa-solid fa-quote-left" style="color:#0d9488"></i> The conversation</div>'
      +trcTranscriptHtml(r.transcript,r.transcript_text)+'</div>'
  +'</div>';
}

let TRC_LEAD=null;

/* Pure calendar arithmetic on a YYYY-MM-DD string - deliberately through Date.UTC with every
   component supplied explicitly, so the result never drifts a day depending on the server's or
   browser's own timezone the way new Date('2026-09-05') interpreted then read back in local time can. */
function trcAddDays(dateStr,delta){
  const p=String(dateStr).split('-').map(Number);
  const dt=new Date(Date.UTC(p[0],p[1]-1,p[2]));
  dt.setUTCDate(dt.getUTCDate()+delta);
  return dt.getUTCFullYear()+'-'+String(dt.getUTCMonth()+1).padStart(2,'0')+'-'+String(dt.getUTCDate()).padStart(2,'0');
}
/* Same UTC-noon arithmetic as trcAddDays, the subtraction direction instead of the addition - how many
   whole days sit between two YYYY-MM-DD strings. */
function trcDaysBetween(fromStr,toStr){
  const p=function(s){const a=String(s).split('-').map(Number);return Date.UTC(a[0],a[1]-1,a[2]);};
  return Math.round((p(toStr)-p(fromStr))/86400000);
}
/* A promised callback date that has passed with nothing logged since is a missed callback - the agent
   said "I'll call back on X" and X came and went in silence. Computed the same way trcOvHealth checks
   its own promised date: against traToday(), over whichever rows the caller hands in - the lead's full
   history on the detail page (see trcLeadDetail), or only the selected range's rows on the list (see
   trcLeads) - a call outside that set is invisible here exactly as everywhere else this page rolls up
   a lead's calls. Not applicable to a lead that has closed the door (Lost) - there is nothing left to
   call back about. "Lost, then Reopened" is deliberately NOT treated as Lost, same reasoning as
   everywhere else on this page (see the status_assessment prompt): the "then Reopened" half means the
   lead is live again. Only the LATEST call's own promise matters - rows arrives chronological
   (oldest-first, the same order trcLeads and trcLeadDetail already sort it into), so an earlier call's
   promise was superseded the moment a later call happened, on time or not. */
function trcCallbackOverdue(status,rows){
  if(String(status||'')==='Lost')return null;
  const last=(rows||[])[(rows||[]).length-1];
  if(!last||!last.next_follow_up_text)return null;
  const dueDate=String(last.next_follow_up_text).slice(0,10);
  const today=traToday();
  if(!(dueDate<today))return null;
  return {dueDate:dueDate,daysLate:trcDaysBetween(dueDate,today)};
}
function trcCallbackOverdueHtml(o){
  if(!o)return '';
  return '<div class="card card-pad" style="margin-top:16px;border-left:3px solid #dc2626">'
    +'<div class="sec-title" style="margin:0 0 10px"><i class="fa-solid fa-phone-slash" style="color:#dc2626"></i> Missed callback</div>'
    +'<div style="font-size:12.5px;color:var(--slate)">A callback was promised for '
    +esc(trcWall(o.dueDate)||o.dueDate)+' and nothing has been logged against this lead since - '
    +o.daysLate+' day'+(o.daysLate===1?'':'s')+' overdue.</div>'
  +'</div>';
}
/* Follow-up frequency/cadence - was the recontact after each call made on time?
   Scheduled   - the call named a next_follow_up_text date; late if the FOLLOWING call (or, for the
                 lead's own still-open gap, today) falls after that date.
   Unscheduled - the call named no date at all; late if more than TRC_CADENCE_UNSCHEDULED_DAYS days
                 pass before the next call (or today, for the still-open gap).
   Not evaluated once a lead is Lost - same reasoning as trcCallbackOverdue, there is nothing left to
   call back about. rows must already be chronological, oldest-first (trcLeads/trcLeadDetail's own
   order), since each gap is judged against the call that comes right after it. */
const TRC_CADENCE_UNSCHEDULED_DAYS=3;
function trcCadenceIssues(status,rows){
  if(String(status||'')==='Lost')return null;
  const list=rows||[];
  const today=traToday();
  const gaps=[];
  for(let i=0;i<list.length;i++){
    const prev=list[i];
    const nextRow=list[i+1]||null;
    const actualDate=nextRow?trcRowDate(nextRow):today;
    if(!actualDate)continue;
    const scheduled=!!prev.next_follow_up_text;
    const prevDate=trcRowDate(prev);
    const limitDate=scheduled?String(prev.next_follow_up_text).slice(0,10)
                             :(prevDate?trcAddDays(prevDate,TRC_CADENCE_UNSCHEDULED_DAYS):null);
    if(!limitDate||!(actualDate>limitDate))continue;
    gaps.push({follow_up_id:prev.follow_up_id,scheduled:scheduled,limitDate:limitDate,
      actualDate:nextRow?actualDate:null,daysLate:trcDaysBetween(limitDate,actualDate),open:!nextRow});
  }
  if(!gaps.length)return null;
  return {lateCount:gaps.length,totalGaps:list.length,gaps:gaps};
}
function trcCadenceIssuesHtml(o){
  if(!o)return '';
  /* trcCadenceIssues builds gaps walking the history oldest-first, since each one is judged against
     whatever call came right after it - display order is the opposite: the most recent gap is the one
     someone actually needs to act on today, so it reads top of the card, newest first. */
  const rows=o.gaps.slice().reverse().map(function(g){
    return '<div style="margin-top:6px;font-size:12.5px;color:var(--slate)">'
      +(g.scheduled?'Promised for ':'No date promised - overdue past ')+esc(trcWall(g.limitDate)||g.limitDate)
      +(g.open?', nothing logged since':', next call on '+esc(trcWall(g.actualDate)||g.actualDate))
      +' - '+g.daysLate+' day'+(g.daysLate===1?'':'s')+' late.</div>';
  }).join('');
  return '<div class="card card-pad" style="margin-top:16px;border-left:3px solid #d97706">'
    +'<div class="sec-title" style="margin:0 0 10px"><i class="fa-solid fa-hourglass-half" style="color:#d97706"></i> Follow-up cadence - '
    +o.lateCount+' late of '+o.totalGaps+'</div>'
    +rows
  +'</div>';
}
/* Inbound lead -> first callback turnaround: how long after this lead first appeared in the CRM the
   first logged call actually happened. lead_first_seen_date (acc.crm_leads, not the per-follow-up
   f.first_seen_date - see the view's own note) carries no time-of-day, so this is a calendar-day
   proxy for a 24-hour target, not an hour-level measurement - same day counts as on time, anything
   later is flagged. rows must be chronological, oldest-first. Only available where the row came from
   the full join (TRC_LIGHT/followup_timeline_v) - on the fast crm_followups-only path this field is
   simply absent and the function returns null, the same way trcIsRegression treats a light row. */
function trcFirstCallbackTat(rows){
  const list=rows||[];
  const first=list[0];
  if(!first||!first.lead_first_seen_date)return null;
  const firstCallDate=trcRowDate(first);
  if(!firstCallDate)return null;
  const daysLate=trcDaysBetween(first.lead_first_seen_date,firstCallDate);
  if(!(daysLate>0))return null;
  return {leadSeenDate:first.lead_first_seen_date,firstCallDate:firstCallDate,daysLate:daysLate};
}
function trcFirstCallbackTatHtml(o){
  if(!o)return '';
  return '<div class="card card-pad" style="margin-top:16px;border-left:3px solid #d97706">'
    +'<div class="sec-title" style="margin:0 0 10px"><i class="fa-solid fa-phone-volume" style="color:#d97706"></i> First callback turnaround</div>'
    +'<div style="font-size:12.5px;color:var(--slate)">Lead first seen '+esc(trcWall(o.leadSeenDate)||o.leadSeenDate)
    +', first call logged '+esc(trcWall(o.firstCallDate)||o.firstCallDate)+' - '
    +o.daysLate+' day'+(o.daysLate===1?'':'s')+' after.</div>'
  +'</div>';
}
/* The two-part OV rule: enforced here, not just checked by hand.
   (1) each of the two days immediately BEFORE the visit day needs its own follow-up call logged on
       that exact day - not merely some call somewhere in the last two days, which could just as
       easily be a call about a different lead's older business and say nothing about this visit.
   (2) once the visit date itself arrives, TWO follow-up calls must be logged on that exact day, not
       one - a single call is under the bar here, not a pass.
   Both only apply to a day that has actually happened - a pre-visit day or the visit day itself that
   is still in the future has nothing to check yet. And both are always computed off the CURRENT visit
   date (the latest OV row's next_follow_up_text): a lead that tells the agent "I'll come another day"
   gets a fresh OV follow-up logged with the new date, which becomes latestOv here automatically, so
   the two days being checked move with it rather than staying pinned to whatever day was first booked.
   Also flags an OV row that carries no parseable visit date at all as not properly marked, which is
   what "is the organised-visit status marked properly" comes down to on the data this lead actually
   has. Only evaluated for a lead whose CURRENT status is OV - a lead that has since moved on (Site
   Visited, Lost, ...) is a different question this does not answer. Returns null for every other
   status, which callers use to skip rendering entirely. */
function trcOvHealth(status,rows){
  if(status!=='OV')return null;
  const ovRows=(rows||[]).filter(function(r){return r.crm_status==='OV';});
  const latestOv=ovRows[ovRows.length-1];
  const visitDate=latestOv&&latestOv.next_follow_up_text?String(latestOv.next_follow_up_text).slice(0,10):null;
  const reasons=[];
  if(!visitDate)reasons.push('Organised visit has no site-visit date recorded against it - not marked properly');

  /* The CRM's lead-level status and its most recent follow-up's status are two separate fields, and
     they can drift: a follow-up can move a lead on to "In Follow Up" or further without the
     lead-level status being updated to match, leaving OV showing here after it stopped being true. */
  const trueLatest=(rows||[])[((rows||[]).length-1)];
  if(trueLatest&&trueLatest.crm_status&&trueLatest.crm_status!=='OV')
    reasons.push('Lead status still shows OV but the latest follow-up ('+trueLatest.crm_status
      +', '+(trcWall(trcRowDate(trueLatest))||'date not recorded')+') has already moved past it - not marked properly');

  const today=traToday();

  const missingPreDays=[];
  if(visitDate){
    [2,1].forEach(function(back){
      const day=trcAddDays(visitDate,-back);
      if(day>today)return;
      const hasCall=(rows||[]).some(function(r){return trcRowDate(r)===day;});
      if(!hasCall)missingPreDays.push(day);
    });
  }
  if(missingPreDays.length)reasons.push('No follow-up call logged on '
    +missingPreDays.map(function(d){return trcWall(d)||d;}).join(' or ')+' - the two days before the visit');

  let onVisitDay=null;
  if(visitDate&&visitDate<=today){
    onVisitDay=(rows||[]).filter(function(r){return trcRowDate(r)===visitDate;}).length;
    if(onVisitDay<2)reasons.push('Only '+onVisitDay+' follow-up call'+(onVisitDay===1?'':'s')
      +' logged on the visit day ('+(trcWall(visitDate)||visitDate)+') - 2 required');
  }
  return {ok:reasons.length===0,visitDate:visitDate,onVisitDay:onVisitDay,reasons:reasons};
}
function trcOvHealthHtml(h){
  if(!h)return '';
  return '<div class="card card-pad" style="margin-top:16px;border-left:3px solid '+(h.ok?'#16a34a':'#dc2626')+'">'
    +'<div class="sec-title" style="margin:0 0 10px"><i class="fa-solid fa-triangle-exclamation" style="color:'+(h.ok?'#16a34a':'#dc2626')+'"></i> OV health check</div>'
    +'<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'
      +(h.ok?trcTag('t-green','fa-check','OK'):trcTag('t-red','fa-triangle-exclamation','Danger'))
      +(h.visitDate?'<span style="font-size:12.5px;color:var(--slate)">Site visit organised for '+esc(trcWall(h.visitDate)||h.visitDate)+'</span>'
                    :'<span style="font-size:12.5px;color:var(--slate)">No site-visit date on record</span>')
    +'</div>'
    +(h.reasons.length?'<ul style="margin:10px 0 0 18px;padding:0;font-size:12.5px;line-height:1.7;color:#dc2626">'
      +h.reasons.map(function(r){return '<li>'+esc(r)+'</li>';}).join('')+'</ul>':'')
  +'</div>';
}

/* What this page was last rendered with, so its Refresh button can render it AGAIN identically -
   same lead, same ringed call, same row number in the Back link - without the reader having to go
   back to the list and click in a second time. Kept here rather than read back off the URL because
   the row number arrives as an argument on some routes and not others (see trcView). */
let TRC_LEAD_ARGS=null;
/* Refresh on the lead page means the same thing it means on the list: what is on screen is not
   trusted. So this lead's cached history goes - it is a 5h snapshot, and rendering it back out is
   precisely what the reader is asking not to happen - and the page refetches from scratch.
   Deliberately NOT trcLeadCacheClearAll(): the other leads' snapshots are not what is in doubt, and
   throwing away the list's whole prefetch would make the next click on every one of them slow. */
window.trcLeadRefresh=async function(){
  if(!TRC_LEAD_ARGS)return;
  const b=document.getElementById('trcLeadRefreshBtn');
  if(b){b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Refreshing';}
  const a=TRC_LEAD_ARGS;
  trcLeadCacheDrop(a.leadId);
  try{
    await trcLeadDetail($('view'),a.leadId,a.targetFollowUpId,a.rowHint);
  }catch(e){
    toast('Could not refresh this lead: '+((e&&e.message)||e),'err');
    /* Only reached if the re-render itself threw - trcLeadDetail handles a failed fetch by drawing
       its own error card, and in that case the button it just drew is a fresh one, already enabled.
       This puts the OLD button back so the page is not left with a dead spinner on it. */
    if(b&&document.body.contains(b)){b.disabled=false;b.innerHTML='<i class="fa-solid fa-rotate"></i> Refresh';}
  }
};

async function trcLeadDetail(v,leadId,targetFollowUpId,rowHint){
  setCrumb([['Growth & Strategy','#/'],['Transcription','#/'],'Lead']);
  const id=Number(leadId);
  /* The NUMERIC id, not the route's string - it is what trcLeadCacheWrite keys the snapshot under,
     so it has to be what Refresh hands trcLeadCacheDrop. */
  TRC_LEAD_ARGS={leadId:id,targetFollowUpId:targetFollowUpId||null,rowHint:rowHint||null};
  TRC_LAST_LEAD_ID=id;
  TRC_LAST_FOLLOWUP_ID=targetFollowUpId||null;
  /* Set before anything can fail: backing out of "Lead not found" or a failed fetch still has to put
     the reader back on the row they clicked. */
  TRC_FROM_DETAIL=true;
  /* This page always opens AT ITS TOP. Nothing resets the window's scroll between views - the router
     just swaps #view's innerHTML - so clicking a lead from row 60 of a long list used to render this
     page and leave the reader wherever the list had been scrolled to: somewhere in the middle of a
     lead's call history, or clamped to the bottom of a page shorter than the list was. Opening a
     lead means starting at the lead. */
  try{window.scrollTo(0,0);}catch(e){}
  /* Where every "Back"/"Back to all leads" link below goes: the list section this page was opened
     from and nothing more. The lead's own id is deliberately left off - it belongs to this page, not
     to the list - so backing out lands on #/r12 rather than a list URL still naming one lead.
     A row number is a render-only position that a re-sort or a changed filter can hand to a different
     lead entirely, so the list restores by lead id whenever it still has one in memory and only falls
     back to the position on a reload (see trcView). A visit that arrived off the call-level Mismatch
     table has no row number to put in a URL, so it backs out to #/back, which restores the row from
     the memo instead of from the URL - either way the list returns to the row this page came from. */
  const backRoute=rowHint?('transcription/r'+rowHint):'transcription/back';
  /* Written here rather than off the row's click handler because this is the last moment TRC_F is
     still the list's own filter state - nothing on this page touches it, and the number in backRoute
     is only meaningful against it. */
  trcRememberRow(rowHint,id,targetFollowUpId);
  let lead=null,rows=[];
  /* Already fetched, within the last 5h - by an earlier visit to this same lead, or by the list's
     own background prefetch (see trcPrefetchHistories). Nothing is awaited on this path, so the
     skeleton below is never even reached: the page renders in the same task as the click. */
  const cached=trcLeadCacheRead(id);
  if(cached){
    lead=cached.lead;rows=cached.rows||[];
  }else{
    v.innerHTML=trcLeadSkeletonHtml();
    try{
      /* One call, not two, and the whole row rather than a column list: this is the one place the
         transcripts and the five QA blobs are actually read, and naming the columns would silently
         drop whatever the pipeline starts storing tomorrow. acc.crm_lead_detail returns both halves
         together - see trcLeadFetchByIds, which is also what the list's prefetch goes through, so a
         clicked lead and a prefetched one are cached from the identical shape. */
      const got=(await trcLeadFetchByIds([id]))[String(id)]||{};
      lead=got.lead||null;
      rows=got.rows||[];
      trcLeadCacheWrite(id,lead,rows);
    }catch(e){
      v.innerHTML=mHead('fa-microphone-lines','#0d9488','Transcription')
        +'<div class="card card-pad empty"><i class="fa-solid fa-triangle-exclamation"></i>'
        +'<div>Could not load this lead: '+esc((e&&e.message)||String(e))+'</div>'
        +'<button class="btn btn-sm" style="margin-top:12px" onclick="navTo(\''+backRoute+'\')">Back</button></div>';
      return;
    }
  }
  if(!lead&&!rows.length){
    v.innerHTML=mHead('fa-microphone-lines','#0d9488','Transcription')
      +'<div class="card card-pad empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Lead not found</div>'
      +'<button class="btn btn-sm" style="margin-top:12px" onclick="navTo(\''+backRoute+'\')">Back</button></div>';
    return;
  }
  /* Dropped before anything below counts or renders a single row, so recordings/transcribed/assessed,
     the CRM trail, "latest", and the call cards themselves all agree with each other - see
     trcIsSkippedSalesCall. The one exception is the deep-linked row itself (targetFollowUpId): a link
     that named this exact follow-up is trusted over the general rule, the same way a pinned lead
     already overrides the list's own date filter elsewhere on this page. */
  rows=rows.filter(function(r){
    return !trcIsSkippedSalesCall(r) || String(r.follow_up_id)===String(targetFollowUpId);
  });
  TRC_LEAD={lead:lead,rows:rows};

  const name=(lead&&lead.lead_name)||(rows[0]&&rows[0].lead_name)||('Lead '+id);
  const bu=(lead&&lead.business_unit_name)||(rows[0]&&rows[0].business_unit_name)||null;
  const recordings=rows.filter(function(r){return r.has_recording;}).length;
  const transcribed=rows.filter(function(r){return r.transcription_status==='completed';}).length;
  const assessed=rows.filter(function(r){return r.qa_id;}).length;
  const reused=rows.filter(function(r){return r.reused_transcription;}).length;
  const mismatched=rows.filter(function(r){return r.status_match===false;});

  const trail=[];
  rows.forEach(function(r){const s=r.crm_status;if(s&&trail[trail.length-1]!==s)trail.push(s);});

  const head='<div class="page-head"><div><h1><i class="fa-solid fa-user" style="color:#0d9488"></i> '+esc(name)+'</h1>'
      +'<p>Lead '+esc(String(id))+(bu?' · '+esc(bu):'')+' · '+rows.length+' follow-up'+(rows.length===1?'':'s')
        +(rowHint?' · Row #'+esc(String(rowHint))+' in the list':'')+'</p></div>'
      +'<div style="display:flex;gap:10px;flex-wrap:wrap">'
        +'<button class="btn btn-sm" onclick="goBack(\''+backRoute+'\')"><i class="fa-solid fa-arrow-left"></i> Back to all leads</button>'
        +'<button class="btn" id="trcLeadRefreshBtn" onclick="trcLeadRefresh()"><i class="fa-solid fa-rotate"></i> Refresh</button>'
      +'</div></div>';

  /* remarks and next follow-up (below) are per-follow-up, not per-lead, so they come off the latest
     follow-up - rows is chronological ascending, so the last element is the most recent one. */
  const latest=rows[rows.length-1]||{};
  /* The AI comparison, though, needs the last call that was actually ASSESSED (by requirement,
     2026-09-19): if the latest call has no recording or is non-transcribable, this strip should keep
     showing the last available AI status instead of dropping the AI badge and the agree/mismatch tag
     entirely. */
  let lastAssessed=null;
  for(let i=rows.length-1;i>=0&&!lastAssessed;i--){
    if(rows[i].ai_assessed_status)lastAssessed=rows[i];
  }
  lastAssessed=lastAssessed||{};

  const strip='<div class="card card-pad" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">'
    +((lead&&lead.status)?trcTag('t-blue','','CRM: '+lead.status):'')
    +(lastAssessed.ai_assessed_status?trcTag(TRC_AI_TAG[lastAssessed.ai_assessed_status]||'t-gray','','AI: '+trcAiStatusLabel(lastAssessed)):'')
    +trcMismatchTag(lastAssessed)
    +trcTag('t-gray','fa-phone',recordings+' recording'+(recordings===1?'':'s'))
    +trcTag(transcribed?'t-green':'t-gray','fa-file-lines',transcribed+' transcribed')
    +trcTag(assessed?'t-green':'t-gray','fa-clipboard-check',assessed+' assessed')
    +(reused?trcTag('t-gray','fa-recycle',reused+' reused'):'')
    +(mismatched.length?trcTag('t-red','fa-not-equal',mismatched.length+' mismatch'+(mismatched.length===1?'':'es')+' overall')
                       :(assessed?trcTag('t-green','fa-equals','CRM agrees throughout'):''))
    +(trail.length>1?'<div style="font-size:13.5px">CRM verdict over time: <b>'
      +trail.map(esc).join('</b> <i class="fa-solid fa-arrow-right" style="font-size:10px;color:var(--slate)"></i> <b>')+'</b></div>':'')
  +'</div>';
  const leadCard='<div class="card card-pad"><div class="sec-title" style="margin:0 0 10px">'
    +'<i class="fa-solid fa-address-card" style="color:#0d9488"></i> Lead details</div>'
    +'<div style="overflow:auto"><table class="tbl"><thead><tr>'
      +'<th>Lead ID</th><th>Lead name</th><th>Current status</th><th>Lost reason</th>'
      +'<th>Remarks</th><th>Project</th><th>Next follow-up</th></tr></thead><tbody><tr>'
      +'<td>'+esc(String(id))+'</td>'
      +'<td style="font-weight:600">'+esc(name)+'</td>'
      +'<td>'+(lead&&lead.status?trcTag('t-blue','',lead.status):'<span style="color:var(--slate)">—</span>')+'</td>'
      +'<td>'+esc((lead&&lead.lost_reason)||'—')+'</td>'
      +'<td style="max-width:260px">'+esc(latest.crm_remarks||'—')+'</td>'
      +'<td>'+esc(bu||'—')+'</td>'
      +'<td style="white-space:nowrap">'+esc(trcWall(latest.next_follow_up_text,true)||'—')+'</td>'
    +'</tr></tbody></table></div>'
  +'</div>';

  /* rows is chronological, oldest first (needed so trcChrono / trail / accuracy roll-ups above stay
     correct). Display is newest first - the latest call is the one someone opens a lead to check -
     so the "N of total" badge is computed from the chronological index, not the display position. */
  const calls=rows.length
    ? rows.slice().reverse().map(function(r,i){return trcCallHtml(r,rows.length-1-i,rows.length);}).join('')
    : '<div class="card card-pad empty" style="margin-top:14px"><i class="fa-solid fa-inbox"></i>'
      +'<div>The CRM sent no follow-up history for this lead</div></div>';
  const ovHealth=trcOvHealthHtml(trcOvHealth(lead&&lead.status,rows));
  const callbackOverdue=trcCallbackOverdueHtml(trcCallbackOverdue(lead&&lead.status,rows));
  const cadenceIssues=trcCadenceIssuesHtml(trcCadenceIssues(lead&&lead.status,rows));
  const callbackTat=trcFirstCallbackTatHtml(trcFirstCallbackTat(rows));

  v.innerHTML=head+strip
    +'<div style="margin-top:16px">'+leadCard+'</div>'
    +ovHealth
    +callbackOverdue
    +cadenceIssues
    +callbackTat
    +calls;

  if(!document.getElementById('trcTwoCss')){
    const s=document.createElement('style');
    s.id='trcTwoCss';
    s.textContent='@media(max-width:900px){.trc-two{grid-template-columns:1fr!important}}';
    document.head.appendChild(s);
  }

  /* Coming here from a personnel filter or a mismatch drill-down means one specific call is the
     reason for the click, so that call is RINGED - but the page is not scrolled to it. This page
     opens at the top, on the lead, every time: someone who clicked a lead's name asked to see the
     lead, and being dropped part-way down a history with the header off-screen reads as a broken
     page rather than as a helpful jump. The ring is what answers "which one of these is the
     match" once they scroll, and unlike the old two-second flash it is still there when they get
     to it. */
  if(targetFollowUpId){
    const el=document.getElementById('trc-call-'+targetFollowUpId);
    if(el)el.style.boxShadow='0 0 0 3px #0d9488';
  }
}

/* Retry sends the follow-up back to the pipeline, which resumes at the PHASE that failed: a QA
   failure never re-transcribes and never re-bills the audio call. */
window.trcRetry=async function(followUpId){
  const btns=document.querySelectorAll('[onclick="trcRetry('+followUpId+')"]');
  btns.forEach(function(b){b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Queued';});
  try{
    const {data:{session}}=await sb.auth.getSession();
    const token=session&&session.access_token;
    const res=await fetch(SUPABASE_URL+'/functions/v1/crm-snapshot-qa',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},
      body:JSON.stringify({action:'retry',follow_up_id:followUpId})});
    const out=await res.json().catch(function(){return {};});
    if(!res.ok||out.error)throw new Error(out.error||('HTTP '+res.status));
    toast('Back in the queue','ok');
  }catch(e){
    toast('Could not retry: '+((e&&e.message)||e),'err');
  }
  /* The repaint is what puts the button back, so it has to happen even when the refetch fails -
     otherwise a dropped connection leaves a dead spinner where the Retry button used to be. */
  TRC_ROWS=null;TRC_ROWS_ENRICHED=false;TRC_QA_MERGED_RANGE=null;
  trCacheClear('trc_fetch_cache');
  trCacheClear('trc_fetch_light_cache');
  /* Retry can be clicked from either of two screens now - a lead's own detail page (the per-call
     card's button) or the Failed list/table (the per-row buttons added alongside it) - and each has
     to repaint ITSELF, not drag the other screen's reader somewhere they didn't ask to go. $('trcRows')
     is the list view's own table body and only ever exists there, so its presence is what tells the
     two apart. */
  if($('trcRows')){
    trcLeadCacheClearAll();
    await Promise.all([trcFetch(true),trcKpiFastFetch(true)]);
    trcRender(true,true);
    trcAfterListRender();
    return;
  }
  /* And this lead's own cached history - the whole point of the retry is that the call's rows are
     about to change, so re-rendering the detail page off the 5h snapshot would show the reader the
     exact state they just asked to have redone. */
  const lead=TRC_LEAD&&TRC_LEAD.lead?TRC_LEAD.lead.lead_id:(TRC_LEAD&&TRC_LEAD.rows[0]&&TRC_LEAD.rows[0].lead_id);
  if(lead)trcLeadCacheDrop(lead);
  if(lead)await trcLeadDetail($('view'),lead);
};

/* One tab strip, shared by every branch, so adding a tab cannot leave one view showing the old set. */
VIEWS.transcription=async function(v,seg){
  setCrumb(['Growth & Strategy','Transcription']);
  /* Detail routes, checked before the tab index because none of 'r12', 'lead' or 'auto' is a
     number. A lead opens at #/r<SL NO>/<leadId>[/<followUpId>] - the row number it was clicked from
     leads the route, so dropping the tail is the way back to that same section of the list (#/r12).
     The 'r' is what keeps a row number and a tab apart: a bare number in the first slot is already
     the tab index (#/1 is Manual Upload), so '3' there could not mean row 3 without also meaning the
     Deleted tab. The SL NO itself is only a display label, recomputed on every render (see
     trcLeadRowHtml) and never an identifier - the detail page echoes it back as "Row #N", and the
     list treats it as a position of last resort (see trcView).
     #/back is the fourth shape and the only one that is not a page of its own: it is the way back to
     the list for a lead that was opened WITHOUT a row number (the call-level Mismatch table has no
     SL NO column to put in a URL). It carries nothing, resolves to the list through mTab like any
     unrecognised first segment, and trcView restores the row from the memo instead. */
  const rowSeg=/^r(\d+)$/i.exec(String(seg[0]||''));
  if(rowSeg&&seg[1]){return trcLeadDetail(v,seg[1],seg[2]||null,rowSeg[1]);}
  /* 'lead' is the older shape of that same page, still resolving so an existing link or bookmark
     does, and still what the call-level Mismatch table links with - it has no SL NO column, so it has
     no row number to lead with. A real follow-up id (the personnel filter's jump-to-latest-call) can
     ride in either trailing slot, so both are scanned rather than assumed to be in a fixed order.
     'auto' serves rows imported by the previous pipeline into acc.transcriptions. */
  if(seg[0]==='lead'&&seg[1]){
    let followUpId=null,rowHint=null;
    seg.slice(2).forEach(function(s){const m=/^r(\d+)$/i.exec(s);if(m)rowHint=m[1];else if(!followUpId)followUpId=s;});
    return trcLeadDetail(v,seg[1],followUpId,rowHint);
  }
  if(seg[0]==='auto'&&seg[1]){return traDetail(v,seg[1]);}
  if(seg[0]==='view'&&seg[1]){return trDetail(v,seg[1]);}
  const tabs=TRA_TABS;
  const ti=mTab(seg,tabs.length);
  if(ti===0){return trcView(v,seg);}
  /* Left the leads list for one of the other tabs: nothing here will read a lead's history, so stop
     the background prefetch mid-flight rather than finish downloading transcripts for a table that
     is no longer on screen. Leaving the module entirely is a real page load, which kills it anyway. */
  trcPrefetchCancel();
  /* No banner. This page is for watching calls move through the pipeline, and a paragraph of
     product copy above the numbers is not that. */
  const banner='';
  if(ti===4){
    /* Only calls where the agent's record and the recording actually DISAGREE.
       A call that could not be checked is not a disagreement: failed transcriptions and missing
       recordings were listed here too, burying the real mismatches under rows needing no judgement.
       A matching follow-up date is the same kind of noise — so a row must carry at least one
       genuinely FAILED check to appear, which is what leaves only the dates that differ. */
    const rows=(await trFetch()).filter(function(r){
      if(r.source!=='lost_call_sync')return false;
      const cs=Array.isArray(r.discrepancy)?r.discrepancy:[];
      return cs.some(function(c){ return c&&c.status==='fail'; });
    });
    v.innerHTML=mHead('fa-microphone-lines','#0d9488','Transcription')+banner+TRA_TABS_HTML(ti)
      +'<div class="card" style="margin-top:14px"><div style="overflow:auto;max-height:62vh"><table class="tbl"><thead><tr><th>Recording</th><th>Status</th><th>CRM</th><th>Date / Reason</th><th>What disagrees</th></tr></thead>'
      +'<tbody>'+(rows.length?rows.map(trDiscrepancyRowHtml).join(''):'<tr><td colspan="5"><div class="empty" style="padding:34px"><i class="fa-solid fa-circle-check"></i><div>No discrepancies right now</div></div></td></tr>')+'</tbody></table></div></div>';
    return;
  }
  if(ti===5){
    const all=(await trFetch()).filter(function(r){return r.source==='lost_call_sync'&&r.lead_id;});
    const groups={};
    all.forEach(function(r){ (groups[r.lead_id]=groups[r.lead_id]||[]).push(r); });
    const leads=Object.keys(groups).map(function(id){
      const list=groups[id].slice().sort(function(a,b){return new Date(a.report_date||a.created_at)-new Date(b.report_date||b.created_at);});
      return {leadId:id, rows:list};
    /* Compilation is for leads that have been called MORE THAN ONCE. A single call has nothing to
       compile — its "combined verdict" is just that call's verdict, so listing it here only hides
       the leads where the story actually developed across several conversations. */
    }).filter(function(g){ return g.rows.length>1; }).sort(function(a,b){
      const la=a.rows[a.rows.length-1], lb=b.rows[b.rows.length-1];
      return new Date(lb.report_date||lb.created_at) - new Date(la.report_date||la.created_at);
    });
    const leadParam=seg[1]?decodeURIComponent(seg[1]):null;
    v.innerHTML=mHead('fa-microphone-lines','#0d9488','Transcription')+banner+TRA_TABS_HTML(ti)
      +'<div id="trCompArea">'+(leadParam?trCompDetailHtml(leads,leadParam):trCompGridHtml(leads))+'</div>';
    // trCompDetailHtml always renders the combined qualification checklist card - USAGE_VIEWS'
    // 'transcription/5' key already covers "view a lead's combined call history" for this same
    // route; this is the second, distinct catalog feature that route also satisfies.
    if(leadParam){ try{ usageQueue('transcription.compilation.view_combined_qualification_checklist','view'); }catch(_e){} }
    return;
  }
  if(ti===3){
    const rows=await trFetchDeleted(true);
    v.innerHTML=mHead('fa-microphone-lines','#0d9488','Transcription')+banner+TRA_TABS_HTML(ti)
      +'<div class="toolbar" style="margin:16px 0"><div class="grow"></div><button class="btn btn-sm" onclick="trShowHistory()"><i class="fa-solid fa-clock-rotate-left"></i> Full history</button>'
      +(rows.length?'<button class="btn btn-sm btn-primary" onclick="trRestoreAll()"><i class="fa-solid fa-rotate-left"></i> Restore all</button>':'')+'</div>'
      +'<div class="card"><div style="overflow:auto;max-height:62vh"><table class="tbl"><thead><tr><th>Recording</th><th>Status</th><th>Deleted by</th><th>Deleted at</th><th></th></tr></thead>'
      +'<tbody id="trDeletedRows">'+trDeletedTableBody()+'</tbody></table></div></div>';
    return;
  }
  if(ti===2){
    const rows=await trFetch();
    const folder=seg[1]?decodeURIComponent(seg[1]):null;
    TR_FOLDER=folder;
    v.innerHTML=mHead('fa-microphone-lines','#0d9488','Transcription')+banner+TRA_TABS_HTML(ti)
      +'<div id="trFolderArea">'+(folder?trFolderCallsHtml(rows,folder):trFolderGridHtml(rows))+'</div>';
    return;
  }
  TR_FOLDER=null;
  TR_SELECTED=new Set();
  const addTargetBanner=TR_ADD_TARGET?('<div class="card card-pad" style="background:#eff6ff;border-color:#bfdbfe;margin:0 0 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap"><i class="fa-solid fa-folder-plus" style="color:#1d4ed8"></i><div style="flex:1;font-size:13.5px">Tick calls below to add them to <b>'+esc(TR_ADD_TARGET)+'</b></div><button class="btn btn-sm" onclick="trCancelAddTarget()">Cancel</button><button class="btn btn-sm btn-primary" onclick="trDoneAddTarget()">Done, back to folder</button></div>'):'';
  v.innerHTML=mHead('fa-microphone-lines','#0d9488','Transcription')+banner+TRA_TABS_HTML(ti)+addTargetBanner
    +'<div class="card card-pad" style="margin:14px 0 0;font-size:13px;color:var(--slate)"><i class="fa-solid fa-circle-info" style="color:#0d9488"></i> Recordings uploaded by hand. The daily CRM import is on the <b>Automatic Processing</b> tab and is kept entirely separate from this one.</div>'
    +'<div id="trKpis"></div>'
    +'<div id="trSelBar"></div>'
    +'<div class="toolbar" style="margin:16px 0 0;flex-wrap:wrap;gap:10px">'+trDateRangeHtml()+'<div class="grow"></div><button class="btn btn-primary" onclick="trUploadModal()"><i class="fa-solid fa-cloud-arrow-up"></i> Upload recording</button></div>'
    +'<div class="card" style="margin-top:14px"><div style="overflow:auto;max-height:62vh"><table class="tbl"><thead><tr><th style="width:34px"></th><th>Recording</th><th>Status</th><th>CRM</th><th>Date / Reason</th><th>Reason</th><th>Languages</th><th>Duration</th><th>Uploaded</th><th></th></tr></thead><tbody id="trRows"><tr><td colspan="10"><div class="loader"><div class="spin"></div></div></td></tr></tbody></table></div></div>';
  const rows=await trFetch();
  trRenderList();
  rows.forEach(function(r){if(r.status==='processing')trStartPolling(r.id);});
};

function trDiscrepancyRowHtml(r){
  const fname=r.file_name||'Recording';
  const openAttr=(r.status==='done')?' onclick="navTo(\'transcription/view/'+r.id+'\')" style="cursor:pointer"':'';
  let whatWrong;
  if(r.status==='error'){
    whatWrong='<span style="color:#dc2626">Transcription failed'+(r.error_text?': '+esc(String(r.error_text).slice(0,90)):'')+'</span>';
  } else if(r.status==='no_recording'){
    whatWrong='<span style="color:#dc2626">No recording was available from the CRM for this call.</span>';
  } else {
    const fails=(Array.isArray(r.discrepancy)?r.discrepancy:[]).filter(function(c){return c.status==='fail';});
    whatWrong=fails.length
      ? fails.map(function(c){return '<div style="margin-bottom:4px"><b>'+esc(String(c.check||'').replace(/_/g,' '))+':</b> '+esc(c.detail||'')+'</div>';}).join('')
      : '<span style="color:var(--slate)">—</span>';
  }
  return '<tr'+openAttr+'>'
    +'<td><div style="font-weight:600;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(fname)+'">'+esc(fname)+'</div></td>'
    +'<td>'+trQualTag(r)+'</td>'
    +'<td>'+trCrmTag(r.crm_status)+'</td>'
    +'<td>'+trDateReasonHtml(r)+'</td>'
    +'<td style="font-size:12.5px;max-width:360px">'+whatWrong+'</td>'
  +'</tr>';
}

/* ---------- Compilation (CRM lost/followup calls, grouped by lead_id) ---------- */
// The SAME criteria/qualification rule the backend uses (acc functions/transcription-sync,
// qualifyFrom) mirrored client-side, run over the UNION of every call's criteria for one lead —
// "the whole", not just whatever the most recent call happened to show.
const TR_CRIT_KEYS=['site_visit_interested','location_match','bhk_match','budget_match','ready_move_match','follow_up_requested'];
function trCombinedQualify(rows){
  const merged={}; TR_CRIT_KEYS.forEach(function(k){merged[k]=false;});
  (rows||[]).forEach(function(r){ const c=r.criteria||{}; TR_CRIT_KEYS.forEach(function(k){ if(c[k]===true)merged[k]=true; }); });
  let qualification='Not Qualified';
  if(merged.site_visit_interested) qualification='Qualified';
  else if(merged.location_match&&merged.bhk_match&&merged.budget_match&&merged.ready_move_match) qualification='Qualified';
  else if(merged.follow_up_requested) qualification='Follow-Up';
  return {qualification:qualification, criteria:merged};
}
/* The lead's verdict is the verdict of their MOST RECENT call, not a merge of all of them.
   A lead moves: someone who was Not Qualified in July and asked for a callback yesterday is a
   Follow-Up today, and rolling every call together permanently remembered the best answer any call
   ever gave. The combined CRITERIA checklist below is still shown, because "what have we ever
   established about this lead" is a genuinely different and useful question from "where do they
   stand now".
   Walks BACKWARDS to the last call that actually produced a verdict: the newest row may be one the
   CRM sent no recording for, and that has nothing to say either way rather than saying nothing. */
function trLatestVerdict(rows){
  const list=rows||[];
  for(let i=list.length-1;i>=0;i--){
    const q=list[i]&&list[i].qualification;
    if(q&&String(q).trim()) return {qualification:String(q).trim(), row:list[i], stale:i!==list.length-1};
  }
  return {qualification:null, row:null, stale:false};
}
function trCompGridHtml(leads){
  if(!leads.length)return '<div class="card card-pad empty" style="margin-top:16px;padding:40px"><i class="fa-solid fa-users"></i><div>No CRM lost/followup calls yet</div></div>';
  return '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;margin-top:16px">'+leads.map(function(g){
    const last=g.rows[g.rows.length-1];
    const nm=last.customer_name||('Lead '+g.leadId);
    const latest=trLatestVerdict(g.rows);
    const o=trOutcome(latest.qualification);
    return '<div class="card card-pad" style="cursor:pointer" onclick="navTo(\'transcription/5/'+encodeURIComponent(g.leadId)+'\')">'
      +'<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">'
        +'<div style="min-width:0"><div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(nm)+'</div>'
        +'<div style="font-size:12px;color:var(--slate);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(last.business_unit_name||'')+'</div></div>'
        +(o?'<span class="tag '+o.tag+'" style="white-space:nowrap;flex-shrink:0"><i class="fa-solid '+o.icon+'"></i> '+esc(latest.qualification)+'</span>':'')
      +'</div>'
      +'<div style="font-size:12px;color:var(--slate);margin-top:10px">'+g.rows.length+' call'+(g.rows.length===1?'':'s')+' · lead #'+esc(g.leadId)+'</div>'
    +'</div>';
  }).join('')+'</div>';
}
function trCompDetailHtml(leads,leadId){
  const g=leads.find(function(x){return String(x.leadId)===String(leadId);});
  if(!g)return '<div class="card card-pad empty" style="margin-top:16px;padding:40px"><i class="fa-solid fa-triangle-exclamation"></i><div>Lead not found</div><button class="btn btn-sm" style="margin-top:12px" onclick="navTo(\'transcription/5\')">Back</button></div>';
  const last=g.rows[g.rows.length-1];
  const combined=trCombinedQualify(g.rows);
  const latest=trLatestVerdict(g.rows);
  const o=trOutcome(latest.qualification);
  const backBtn='<button class="btn btn-sm" onclick="goBack(\'transcription/5\')"><i class="fa-solid fa-arrow-left"></i> Back to all leads</button>';
  const header='<div class="page-head" style="padding:0 0 10px"><div><h1 style="font-size:17px"><i class="fa-solid fa-user" style="color:#0d9488"></i> '+esc(last.customer_name||('Lead '+leadId))+'</h1><p>'+esc(trPhoneFmt(trPhone(last)))+' · '+esc(last.business_unit_name||'')+' · lead #'+esc(leadId)+' · '+g.rows.length+' call'+(g.rows.length===1?'':'s')+'</p></div>'+backBtn+'</div>';
  // Says which call the verdict came from, so nobody reads it as a merge of all of them.
  const verdictFrom=latest.row
    ? ('from the '+(latest.stale?'most recent call with a transcript':'latest call')
       +' · '+esc(fmtDate(latest.row.report_date||latest.row.created_at)))
    : '';
  const banner2=o?('<div class="card card-pad" style="margin:6px 0 16px;border-left:5px solid '+o.colour+'"><span class="tag '+o.tag+'" style="font-size:14px;padding:6px 12px"><i class="fa-solid '+o.icon+'"></i> '+esc(latest.qualification)+'</span><span style="margin-left:10px;font-size:12.5px;color:var(--slate)">'+verdictFrom+'</span></div>'):'';
  const criteriaCard='<div class="card card-pad" style="margin-bottom:16px"><div class="sec-title" style="margin:0 0 10px"><i class="fa-solid fa-list-check" style="color:#0d9488"></i> Combined qualification checklist</div>'+trCriteriaHtml({criteria:combined.criteria})+'</div>';
  const days=g.rows.map(function(r,idx){
    const dt=r.report_date?fmtDate(r.report_date):fmtDate(r.created_at);
    return '<div style="padding:12px 0;'+(idx?'border-top:1px dashed var(--line)':'')+'">'
      +'<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
        +'<div style="font-weight:700;font-size:12.5px;color:#0d9488;text-transform:uppercase;letter-spacing:.03em">'+esc(dt)+'</div>'
        +trQualTag(r)+trCrmTag(r.crm_status)
        +(r.status==='done'?'<button class="btn btn-sm btn-ghost" onclick="navTo(\'transcription/view/'+r.id+'\')">Open</button>':'')
      +'</div>'
      +(r.summary?'<div style="font-size:13.5px;margin-top:8px;line-height:1.6">'+esc(r.summary)+'</div>':'<div style="font-size:12.5px;color:var(--slate);margin-top:8px">No summary for this call.</div>')
      +(r.mismatch?'<div style="font-size:11.5px;color:#dc2626;margin-top:6px"><i class="fa-solid fa-triangle-exclamation"></i> '+esc(r.mismatch_reason||'')+'</div>':'')
    +'</div>';
  }).join('');
  return header+banner2+criteriaCard+'<div class="card card-pad"><div class="sec-title" style="margin:0 0 4px"><i class="fa-solid fa-calendar-days" style="color:#0d9488"></i> Day-wise history</div>'+days+'</div>';
}

// Keeps the folder drill-in list (if open) in sync after an optimistic delete/retry/remove — a
// no-op when that view isn't currently on screen, same guard pattern as trRenderList's #trRows check.
window.trCancelAddTarget=function(){ TR_ADD_TARGET=null; renderPage(); };