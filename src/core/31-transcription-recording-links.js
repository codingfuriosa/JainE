/* ============ HOW A CALL RECORDING IS OFFERED, everywhere in this module ============
   A real <a href>, not a button. Clicking it downloads the audio, and so do all the things a link
   gets for free and a button never had: middle-click, Save link as, right-click Copy link address,
   dragging it into a chat. This replaced a set of "Copy URL" buttons that handed over the address
   and left the reader to paste it somewhere else to actually hear the call.

   The href is the KNOWLARITY url, deliberately, and never the file it redirects to. That redirect
   target is a presigned S3 URL that expires about ten minutes after it is minted, so an address
   captured from it is dead almost immediately; the Knowlarity one keeps working and is handed a
   fresh signature every time it is followed.

   A PLAIN LINK WAS NOT ACTUALLY ENOUGH, WHICH IS WHY THE CLICK IS NOW HANDLED.
   Left to the browser, following that link fails in two ways that both end with the reader having
   no file:

     - The chain ends on PLAIN HTTP. sr.knowlarity.com 302s to kservices.knowlarity.com, which 302s
       to a presigned http://kstoragerecording.s3.amazonaws.com/... URL. Chrome BLOCKS an insecure
       download started from an https:// page, so on the live domain the click can do nothing at all.
     - download= is honoured SAME-ORIGIN ONLY, so even when the file does arrive it is named after
       the host's own uuid - 0a9fbfcb-..._0_r.mp3 - and is untraceable to a lead or a caller.

   So the click goes through trRecClick, which asks the crm-recording edge function for the bytes
   over https and saves them under the name trRecFile picked. The href stays the Knowlarity URL: it
   is what makes middle-click, "Save link as" and "Copy link address" keep working, and it is what
   the handler falls back to opening if the proxy is unreachable. */
function trRecFile(r){
  /* A name the reader can find again in a downloads folder, rather than the opaque id the host uses.
     Now a promise rather than just intent: the proxy sets Content-Disposition from this. */
  const id=(r&&(r.follow_up_id||r.callid||r.id));
  return 'call-recording'+(id?'-'+String(id).replace(/[^A-Za-z0-9_-]/g,''):'')+'.mp3';
}
/* A value on its way into a single-quoted JS string inside an onclick attribute - so it needs the
   attribute escaping esc() does AND the string escaping it does not (esc leaves ' alone). Same
   idiom as the rest of this file's inline handlers; here so the url is not pasted through it twice. */
function trRecJs(s){return esc(String(s==null?'':s)).replace(/\\/g,'\\\\').replace(/'/g,"\\'");}
/* opts: label (button text, '' for icon only), icon (defaults to a download arrow), cls (defaults to
   a small button), file (download filename), feat (the USAGE_MAP feature key to log this particular
   link under, when its context is one that was being counted before), missing (what to render when
   there is no recording at all). */
function trRecLink(url,opts){
  opts=opts||{};
  if(!url)return opts.missing||'';
  const label=(opts.label===undefined?'Download':opts.label);
  const file=esc(opts.file||'call-recording.mp3');
  return '<a class="'+(opts.cls||'btn btn-sm')+'" href="'+esc(url)+'"'
    +' download="'+file+'"'
    +' target="_blank" rel="noopener noreferrer"'
    +' title="'+esc(opts.title||'Download this call recording')+'"'
    +' onclick="trRecClick(event,\''+esc(opts.feat||'')+'\',\''+trRecJs(url)+'\',\''+trRecJs(opts.file||'call-recording.mp3')+'\')">'
    +'<i class="fa-solid '+esc(opts.icon||'fa-download')+'"></i>'+(label?' '+esc(label):'')
  +'</a>';
}
/* The same link as free-flowing text, for the detail views that print the URL itself in a
   label/value row - the address stays readable and copyable, and is now also clickable. */
function trRecLinkText(url){
  return '<a href="'+esc(url)+'" download="call-recording.mp3" target="_blank" rel="noopener noreferrer"'
    +' title="Download this call recording" onclick="trRecClick(event,\'\',\''+trRecJs(url)+'\',\'\')"'
    +' style="color:#0d9488;text-decoration:underline">'+esc(url)+'</a>';
}

/* THE CLICK. Takes over from the anchor and saves the file itself, for the two reasons in the block
   comment above (the chain's last hop is plain http, which Chrome refuses to download from an https
   page; and download= is ignored cross-origin, so the name is lost).

   It still stops the click reaching a clickable <tr> underneath, which would otherwise open the lead
   instead of fetching the audio. And it is still where USAGE_MAP hangs the telemetry that used to
   sit on the copy button: the feature key travels from the call site rather than being fixed here,
   because these links appear in several views that count as different features (and in some that
   were never counted at all, which pass '' and log nothing) - which is also why `feat` keeps its
   position as the second argument, where USAGE_MAP's resolver reads it from.

   WHAT IS DELIBERATELY LEFT TO THE BROWSER: a modified click. Ctrl/cmd/shift/alt-click and
   middle-click mean "open this somewhere else", and answering them with a download in the current
   tab is not what was asked for - those fall straight through to the href.

   AND IF THE PROXY CANNOT BE REACHED, the old behaviour comes back rather than being simulated.
   The obvious move - window.open(url) from the catch - does not survive a popup blocker: by then the
   await has ended the user-gesture context, so the tab is refused and the click still ends in
   nothing. So a failed link is MARKED instead, and the next click on it is left entirely to the
   browser: the href is untouched, so that second click does exactly what this link did before any
   of this existed. The toast is what tells the reader that clicking again is the thing to do. */
window.trRecClick=async function(ev,feat,url,file){
  if(ev&&ev.stopPropagation)ev.stopPropagation();
  /* No url means this is markup from before the handler took arguments - let the anchor do what it
     always did rather than swallowing the click and doing nothing. */
  if(!url)return;
  if(ev&&(ev.ctrlKey||ev.metaKey||ev.shiftKey||ev.altKey||ev.button===1))return;
  /* Already tried and failed once - this click is the browser's (see the note above). The mark is
     per element and dies with the next repaint, so it is a fallback for this reader on this link
     right now, never a permanent downgrade of the feature. */
  if(ev&&ev.currentTarget&&ev.currentTarget.dataset.recFallback==='1')return;
  if(ev&&ev.preventDefault)ev.preventDefault();

  /* The clicked element, dimmed while the bytes are on their way. A ~1 MB fetch through the proxy
     is not instant, and a link that looks untouched for a second reads as a link that did nothing -
     which is the complaint this whole change is answering. Guarded against a second click landing
     on the same in-flight link. */
  const a=(ev&&ev.currentTarget)||null;
  if(a){
    if(a.dataset.recBusy==='1')return;
    a.dataset.recBusy='1';
    a.style.opacity='0.55';a.style.pointerEvents='none';
  }
  const done=function(){ if(a){delete a.dataset.recBusy;a.style.opacity='';a.style.pointerEvents='';} };

  try{
    const {data:{session}}=await sb.auth.getSession();
    const token=session&&session.access_token;
    const res=await fetch(SUPABASE_URL+'/functions/v1/crm-recording',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},
      body:JSON.stringify({url:url,filename:file||''})});
    if(!res.ok){
      const out=await res.json().catch(function(){return {};});
      throw new Error(out.error||('HTTP '+res.status));
    }
    const blob=await res.blob();
    /* The proxy's own Content-Disposition wins - it is the one that knows the lead and follow-up ids
       when the call site had no name to offer (the free-text URL links pass ''). */
    const cd=res.headers.get('content-disposition')||'';
    const m=/filename="?([^";]+)"?/i.exec(cd);
    const name=(m&&m[1])||file||'call-recording.mp3';
    const objUrl=URL.createObjectURL(blob);
    const dl=document.createElement('a');
    dl.href=objUrl;dl.download=name;dl.style.display='none';
    document.body.appendChild(dl);dl.click();dl.remove();
    setTimeout(function(){URL.revokeObjectURL(objUrl);},2000);
    toast('Downloading '+name,'ok');
  }catch(e){
    if(a){
      a.dataset.recFallback='1';
      toast('Could not download the recording ('+((e&&e.message)||e)+') - click it again to open it directly','warn');
    }else{
      /* No element to mark (a programmatic call), so the tab attempt is all there is. */
      toast('Could not download the recording ('+((e&&e.message)||e)+')','warn');
      try{window.open(url,'_blank','noopener');}catch(e2){}
    }
  }
  done();
};

/* Retry - hands the call back to the same pipeline. The backend re-queues it at the BACK of the
   FIFO queue and increments the attempt count; nothing here duplicates a row or clears a result. */
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
async function traView(v,seg){
  v.innerHTML=mHead('fa-microphone-lines','#0d9488','Transcription')+TRA_TABS_HTML(0)
    +'<div class="card card-pad" style="margin:14px 0 0"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">'
      +'<div class="sec-title" style="margin:0"><i class="fa-solid fa-calendar-days" style="color:#0d9488"></i> Imported calls</div>'
      +'<div id="traCount" style="font-size:12.5px;color:var(--slate)"></div></div>'
      +'<div id="traDates" style="margin-top:12px"></div></div>'
    +'<div id="traKpis" style="margin-top:16px"></div>'
    +'<div id="traFilters"></div>'
    +'<div class="card" style="margin-top:14px"><div style="overflow:auto;max-height:64vh"><table class="tbl">'
      +'<thead><tr><th>Lead ID</th><th>Lead Name</th><th>CRM Status</th><th>Transcription Status</th>'
      +'<th>Business Unit</th><th>Next Follow-up</th><th>Lost Reason</th><th>Remarks</th><th></th></tr></thead>'
      +'<tbody id="traRows"><tr><td colspan="9"><div class="loader"><div class="spin"></div></div></td></tr></tbody>'
    +'</table></div></div>';
  await traFetch(true);
  traRender(true);
}

/* ---- detail: everything known about one lead, in one place ---- */
/* mono is only ever set for the URL-shaped fields (the recording URL rows, and any CRM key whose
   name matches /url/i), so that flag is also the signal to make an http(s) value a real download link
   instead of a block of monospace text nobody can do anything with. Anything else, URL-shaped or not,
   is still printed verbatim. */
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

