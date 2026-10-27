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
/* A lead who rang the agent and was not picked up. The CRM history carries no call-direction field, so
   the agent's own log is the only marker: the follow-up remark reads "incoming call missed" (a remark
   like "incoming received ..." is an answered call and "incoming call facility is not available" is a
   failed OUTGOING attempt - neither counts). */
/* The decision date is the day being judged - the end of the selected range (yesterday by default). Both
   flags below are "as of" that day: calls logged after it are not yet known, and "today" for the
   purpose of a promise or a callback window is the decision date itself, never the real clock. */
function trcDecisionDate(){return TRC_F.to||TRC_F.from||traToday();}
function trcAsOf(rows){
  const d=trcDecisionDate();
  return (rows||[]).filter(function(r){const x=trcRowDate(r);return !x||x<=d;});
}
function trcIsMissedIncoming(r){
  return /^\s*incoming call missed/i.test(String(r&&r.crm_remarks||''));
}
const TRC_MISSED_CALLBACK_HOURS=24;
/* Was every missed incoming call followed by a callback? Each missed call needs some later logged call
   (anything that is not itself another missed incoming) within TRC_MISSED_CALLBACK_HOURS of the miss.
   rows chronological, oldest-first. Not skipped for Lost leads: the customer rang in, a callback is owed
   whatever the lead's status says. */
function trcMissedIncomingCallback(rows){
  const list=trcAsOf(rows);
  const stamp=function(r){const t=Date.parse(r.communication_time||'');return isNaN(t)?null:t;};
  const now=Date.parse(trcDecisionDate()+'T23:59:59+05:30'),limit=TRC_MISSED_CALLBACK_HOURS*3600000;
  const misses=[];
  for(let i=0;i<list.length;i++){
    if(!trcIsMissedIncoming(list[i]))continue;
    const at=stamp(list[i]);
    if(at===null)continue;
    let back=null;
    for(let j=i+1;j<list.length;j++){
      if(trcIsMissedIncoming(list[j]))continue;
      const t=stamp(list[j]);
      if(t!==null){back=t;break;}
    }
    const calledBack=back!==null&&back-at<=limit;
    /* Still inside the window at the end of the decision day with no callback yet - not late yet. */
    if(calledBack||(back===null&&now-at<=limit))continue;
    misses.push({follow_up_id:list[i].follow_up_id,missedAt:at,calledBackAt:back});
  }
  return misses.length?{count:misses.length,misses:misses}:null;
}
/* Not connected, then no follow-up: a call that never got through (a customer's own missed incoming call
   does not count - it is not an agent attempt) whose next agent call came TRC_NOT_CONNECTED_DAYS or more
   later, or has not come at all (counted to today). Both halves count: not received on the 1st and only
   tried again on the 9th is as late as not tried again yet. Only the not-connected calls dated inside
   the selected range are judged, so a month's report is that month's misses. The CRM has no connected
   flag, so "not connected" is a call with no recording whose remark says nobody picked up. Level 2 is
   the three senior callers (Rani, Susmita, Piyasa); Level 1 is everyone else except Dipanwita, whose
   calls are in neither. The level is the owner of the not-connected call, and one lead can be in both.
   rows chronological, oldest-first. */
const TRC_NOT_CONNECTED_DAYS=7;
const TRC_LEVEL2_EMAILS=['jaingroupcaller9@thejaingroup.com','jaingroupcaller6@thejaingroup.com','jaingroupcaller8@thejaingroup.com'];
const TRC_LEVEL_EXCLUDED_EMAILS=['mgr.presales@thejaingroup.com'];
function trcIsNotConnected(r){
  if(!r||r.has_recording)return false;
  return /not receiv|busy on another|not connected|switched off|not reachable|unreachable|out of service|invalid number|wrong number|no answer|not answering|not picking|facility is not avail|call disconnected/i
    .test(String(r.crm_remarks||''));
}
function trcNotConnectedLevel(email){
  email=String(email||'').trim().toLowerCase();
  if(TRC_LEVEL_EXCLUDED_EMAILS.indexOf(email)>=0)return 0;
  return TRC_LEVEL2_EMAILS.indexOf(email)>=0?2:1;
}
function trcNotConnectedStale(rows,from,to){
  const all=trcNotConnectedGaps(rows);
  if(!all)return null;
  const gaps=all.gaps.filter(function(g){
    return g.level&&(!from||g.date>=from)&&(!to||g.date<=to);
  });
  if(!gaps.length)return null;
  const worst=gaps.reduce(function(a,b){return b.days>a.days?b:a;});
  const levels=[];
  gaps.forEach(function(g){if(levels.indexOf(g.level)<0)levels.push(g.level);});
  return {days:worst.days,follow_up_id:worst.follow_up_id,levels:levels,count:gaps.length,
    open:gaps.some(function(g){return !g.nextDate;})};
}
/* Every not-connected call on the lead that was not tried again within TRC_NOT_CONNECTED_DAYS - the
   whole history (trcNotConnectedStale above narrows these to the list's date range).
   The next call is the next agent call of any kind, connected or not, since a second failed attempt is
   still a follow-up. A gap still open is counted to today. rows chronological, oldest-first. */
function trcNotConnectedGaps(rows){
  const list=(rows||[]).filter(function(r){return !trcIsMissedIncoming(r);});
  const today=traToday(),gaps=[];
  for(let i=0;i<list.length;i++){
    if(!trcIsNotConnected(list[i]))continue;
    const d=trcRowDate(list[i]);
    if(!d)continue;
    const next=list[i+1]||null,nd=next?trcRowDate(next):null;
    if(next&&!nd)continue;
    const days=trcDaysBetween(d,nd||today);
    if(days<TRC_NOT_CONNECTED_DAYS)continue;
    gaps.push({follow_up_id:list[i].follow_up_id,date:d,nextDate:nd,days:days,remarks:list[i].crm_remarks,who:list[i].personnel_name,
      level:trcNotConnectedLevel(list[i].personnel_email)});
  }
  return gaps.length?{count:gaps.length,gaps:gaps}:null;
}
function trcNotConnectedGapsHtml(o){
  if(!o)return '';
  const rows=o.gaps.slice().reverse().map(function(g){
    return '<div style="margin-top:6px;font-size:12.5px;color:var(--slate)">Not connected on <b>'+esc(trcWall(g.date)||g.date)+'</b>'
      +(g.remarks?' ("'+esc(String(g.remarks).trim().slice(0,60))+'")':'')+(g.who?' by '+esc(g.who):'')
      +(g.nextDate?', next call on '+esc(trcWall(g.nextDate)||g.nextDate):', no call logged since')
      +' - '+g.days+' days without a follow-up (target '+TRC_NOT_CONNECTED_DAYS+').</div>';
  }).join('');
  return '<div class="card card-pad" style="margin-top:16px;border-left:3px solid #dc2626">'
    +'<div class="sec-title" style="margin:0 0 10px"><i class="fa-solid fa-phone-volume" style="color:#dc2626"></i> Not connected - not called again within '
    +TRC_NOT_CONNECTED_DAYS+' days - '+o.count+' time'+(o.count===1?'':'s')+'</div>'+rows+'</div>';
}
function trcMissedIncomingHtml(o){
  if(!o)return '';
  const fmt=function(t){return esc(trcWall(new Date(t).toISOString().slice(0,10))||'');};
  const rows=o.misses.slice().reverse().map(function(m){
    return '<div style="margin-top:6px;font-size:12.5px;color:var(--slate)">Lead called in on '+fmt(m.missedAt)+' and was missed - '
      +(m.calledBackAt===null?'no callback logged since.'
        :'first callback on '+fmt(m.calledBackAt)+', '+Math.round((m.calledBackAt-m.missedAt)/3600000)+' hours later (target '+TRC_MISSED_CALLBACK_HOURS+').')
      +'</div>';
  }).join('');
  return '<div class="card card-pad" style="margin-top:16px;border-left:3px solid #dc2626">'
    +'<div class="sec-title" style="margin:0 0 10px"><i class="fa-solid fa-phone-slash" style="color:#dc2626"></i> Missed incoming call not called back properly - '
    +o.count+' time'+(o.count===1?'':'s')+'</div>'+rows+'</div>';
}
/* Late follow-ups: the agent set a next follow-up date and that date passed with no call. Only a date the
   agent promised counts - a call with no date set is never "late". A missed incoming call is the
   customer's call, not the agent's follow-up, so it neither satisfies a promise nor starts one. Not
   evaluated once a lead is Lost. rows must be chronological, oldest-first. */
function trcCadenceIssues(status,rows,mode){
  if(String(status||'')==='Lost')return null;
  const list=trcAsOf(rows).filter(function(r){return !trcIsMissedIncoming(r);});
  const today=trcDecisionDate();
  const gaps=[];
  for(let i=0;i<list.length;i++){
    const prev=list[i];
    if(!prev.next_follow_up_text)continue;
    const nextRow=list[i+1]||null;
    const actualDate=nextRow?trcRowDate(nextRow):today;
    if(!actualDate)continue;
    const scheduled=true;
    const limitDate=String(prev.next_follow_up_text).slice(0,10);
    if(!(actualDate>limitDate))continue;
    gaps.push({follow_up_id:prev.follow_up_id,scheduled:scheduled,limitDate:limitDate,
      actualDate:nextRow?actualDate:null,daysLate:trcDaysBetween(limitDate,actualDate),open:!nextRow});
  }
  /* mode 'late': the promised date was missed but a call did follow, after it. mode 'promised': the
     promised date passed and no call has been logged since. No mode (lead detail page): both. */
  const shown=mode==='late'?gaps.filter(function(g){return !g.open;})
    :mode==='promised'?gaps.filter(function(g){return g.open;}):gaps;
  if(!shown.length)return null;
  return {lateCount:shown.length,totalGaps:list.length,gaps:shown};
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
  const missedIncoming=trcMissedIncomingHtml(trcMissedIncomingCallback(rows));
  const cadenceIssues=trcCadenceIssuesHtml(trcCadenceIssues(lead&&lead.status,rows));
  const notConnected=trcNotConnectedGapsHtml(trcNotConnectedGaps(rows));

  v.innerHTML=head+strip
    +'<div style="margin-top:16px">'+leadCard+'</div>'
    +ovHealth
    +missedIncoming
    +notConnected
    +cadenceIssues
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
  btns.forEach(function(b){b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Transcribing…';});
  try{
    const {data:{session}}=await sb.auth.getSession();
    const token=session&&session.access_token;
    const res=await fetch(SUPABASE_URL+'/functions/v1/crm-snapshot-qa',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},
      body:JSON.stringify({action:'retry',follow_up_id:followUpId})});
    const out=await res.json().catch(function(){return {};});
    if(!res.ok||out.error)throw new Error(out.error||('HTTP '+res.status));
    /* The request is not the result: say what the step actually did. */
    const steps=(out.work&&out.work.steps)||[];
    const failed=steps.filter(function(x){return x&&x.status==='failed';})[0];
    if(failed)throw new Error(failed.error||'the step failed');
    const step=steps[steps.length-1];
    if(!step)toast('Queued, but not started yet: '+((out.work&&out.work.note)||'the worker is busy'),'err');
    else if(step.phase==='qa')toast('QA finished for this call','ok');
    else if(step.status==='non_transcribable')toast('Listened to it: '+(step.reason||'no conversation')+' - nothing to transcribe','ok');
    else toast('Transcribed - QA is next','ok');
  }catch(e){
    toast('Could not retry: '+((e&&e.message)||e),'err');
  }
  /* The repaint is what puts the button back, so it has to happen even when the refetch fails -
     otherwise a dropped connection leaves a dead spinner where the Retry button used to be. */
  TRC_ROWS=null;TRC_ROWS_ENRICHED=false;TRC_QA_MERGED_RANGE=null;
  trCacheClear('trc_fetch_cache_v3');
  trCacheClear('trc_fetch_light_cache_v3');
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
const TRA_TABS=['Automatic Processing','Manual Upload','Folders','Deleted','Discrepancies','Compilation'];
/* Tabs kept out of the strip. The views below stay exactly where they are and keep their indexes,
   so dropping a label from this list is all it takes to put its tab back. */
const TRA_TABS_HIDDEN=['Folders','Deleted','Discrepancies','Compilation'];
function TRA_TABS_HTML(ti){
  return '<div class="tabs">'+TRA_TABS.map(function(t,i){
    return TRA_TABS_HIDDEN.indexOf(t)>=0?'':'<div class="tab '+(i===ti?'active':'')+'" onclick="navTo(\'transcription/'+i+'\')">'+esc(t)+'</div>';
  }).join('')+'</div>';
}

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

function trRenderList(){
  /* Manual uploads only. The CRM-imported calls have their own tab, their own dashboard and their
     own queue; mixing them into this list is what made "Calls" mean two different things. */
  const all=(TR_ROWS||[]).filter(function(r){return r.source!=='lost_call_sync';});
  let rows=trDateFilterRows(all);
  // In "add calls to folder X" mode, calls already in X have nothing to add — hide them so
  // only genuine candidates show up.
  if(TR_ADD_TARGET)rows=rows.filter(function(r){return r.folder!==TR_ADD_TARGET;});
  const kh=$('trKpis');
  if(kh)kh.innerHTML=trKpisHtml(rows);
  trRenderSelBar();
  const host=$('trRows');if(!host)return;
  if(!all.length){host.innerHTML='<tr><td colspan="10"><div class="empty" style="padding:34px"><i class="fa-solid fa-microphone-lines"></i><div>No calls yet</div><button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="trUploadModal()"><i class="fa-solid fa-cloud-arrow-up"></i> Upload a recording</button></div></td></tr>';return;}
  if(TR_ADD_TARGET&&!rows.length){host.innerHTML='<tr><td colspan="10"><div class="empty" style="padding:34px"><i class="fa-solid fa-circle-check"></i><div>Every call is already in "'+esc(TR_ADD_TARGET)+'"</div><button class="btn btn-sm" style="margin-top:12px" onclick="trDoneAddTarget()">Done, back to folder</button></div></td></tr>';return;}
  const filtered=trApplyFilter(rows);
  if(!filtered.length){host.innerHTML='<tr><td colspan="10"><div class="empty" style="padding:34px"><i class="fa-solid fa-filter"></i><div>No calls match this filter'+((TR_DATE_FROM||TR_DATE_TO)?' / date range':'')+'</div><button class="btn btn-sm" style="margin-top:12px" onclick="trSetFilter(\'all\')">Clear filter</button> <button class="btn btn-sm" style="margin-top:12px" onclick="trClearDateRange()">Clear dates</button></div></td></tr>';return;}
  host.innerHTML=trRowsBodyHtml(trSortPinned(filtered),'list');
}
// Pinned calls float to the top, ordered by pin_rank (drag-and-drop sets this — see
// trPinReorderDrop); unpinned calls just keep whatever order they arrived in (stable sort).
function trSortPinned(rows){
  return (rows||[]).map(function(r,i){return {r:r,i:i};}).sort(function(a,b){
    const pa=a.r.pinned?1:0,pb=b.r.pinned?1:0;
    if(pa!==pb)return pb-pa;
    if(pa&&pb){
      const ra=(typeof a.r.pin_rank==='number')?a.r.pin_rank:a.i;
      const rb=(typeof b.r.pin_rank==='number')?b.r.pin_rank:b.i;
      if(ra!==rb)return ra-rb;
    }
    return a.i-b.i;
  }).map(function(x){return x.r;});
}
function trNextPinRank(){
  const ranks=(TR_ROWS||[]).filter(function(r){return r.pinned&&typeof r.pin_rank==='number';}).map(function(r){return r.pin_rank;});
  return ranks.length?Math.max.apply(null,ranks)+1:0;
}
/* A call that never produced a transcript is not a readable row: no transcript, no criteria, no QA.
   Half a day's feed is like this - no recording sent, a ring-out under 60s, or hold music only - and
   they were burying the calls that DO have something to read. They stay in the database and stay
   counted (they are why "69 received" becomes "30 transcribed"); they are simply not listed.
   "Not transcribed" on the KPI row brings them up when someone wants to see why. */
const TR_NO_TRANSCRIPT = ['no_recording', 'too_short', 'non_transcribable'];
function trIsNilRow(r){
  return TR_NO_TRANSCRIPT.indexOf(String((r && r.status) || '')) !== -1;
}
/* A call still waiting its turn has nothing to read - no transcript, no criteria, no outcome - so it
   is not listed until it is finished. It gets no card of its own: a "Processing" count is a progress
   bar pretending to be a statistic, always either everything or nothing and stale the moment it is
   drawn. "Transcribed 13 of 69 received" already says how much is left. */
function trIsPendingRow(r){
  const st=String((r && r.status) || '');
  return st === 'queued' || st === 'processing';
}
// KPI cards double as filters — click one to narrow the list below, click again (or "Calls") to clear.
function trApplyFilter(rows){
  // The one view that deliberately shows unfinished calls, since that is the whole point of it.
  if(TR_FILTER==='processing')return rows.filter(trIsPendingRow);
  // every other view lists finished calls only
  rows=rows.filter(function(r){ return !trIsNilRow(r) && !trIsPendingRow(r); });
  if(TR_FILTER==='qualified')return rows.filter(function(r){return r.qualification==='Qualified';});
  if(TR_FILTER==='followup')return rows.filter(function(r){return r.qualification==='Follow-Up';});
  if(TR_FILTER==='notqualified')return rows.filter(function(r){return r.qualification==='Not Qualified';});
  return rows;
}
window.trSetFilter=function(f){TR_FILTER=(TR_FILTER===f)?'all':f;trRenderList();};
function trKpisHtml(rows){
  const qual=rows.filter(function(r){return r.qualification==='Qualified';}).length;
  const notq=rows.filter(function(r){return r.qualification==='Not Qualified';}).length;
  const foll=rows.filter(function(r){return r.qualification==='Follow-Up';}).length;
  /* Counted from ALL rows, not the listed ones: the point of showing "received" against
     "transcribed" is that the gap stays visible rather than the day looking smaller than it was.
     And the gap has to say what it IS - a card reading "528 of 536" with nothing accounting for the
     other 8 just looks like the count is wrong. Each reason is named, in received order. */
  const done=rows.filter(function(r){return r.status==='done';}).length;
  const proc=rows.filter(trIsPendingRow).length;
  const n=function(st){return rows.filter(function(r){return r.status===st;}).length;};
  const gaps=[[n('non_transcribable'),'no speech'],[n('no_recording'),'no recording'],
              [n('too_short'),'under a minute'],[n('error'),'failed']]
    .filter(function(g){return g[0]>0;}).map(function(g){return g[0]+' '+g[1];});
  const recv=rows.length+' received'+(gaps.length?' · '+gaps.join(' · '):'');
  const cards=[['all','Transcribed',done,recv,'var(--slate)'],
    ['qualified','Qualified',qual,'leads matched',TR_OUTCOMES['Qualified'].colour],
    ['followup','Follow-Up',foll,'call back later',TR_OUTCOMES['Follow-Up'].colour],
    ['notqualified','Not Qualified',notq,'did not match',TR_OUTCOMES['Not Qualified'].colour],
    ['processing','In Progress',proc,proc?'being transcribed now':'all caught up',proc?'#d97706':'#16a34a']];
  return '<div class="grid kpis" style="grid-template-columns:repeat('+cards.length+',1fr)">'+cards.map(function(c){
    const active=TR_FILTER===c[0];
    return '<div class="kpi" style="cursor:pointer'+(active?';box-shadow:inset 0 0 0 2px '+c[4]:'')+'" onclick="trSetFilter(\''+c[0]+'\')" title="Show '+esc(c[1])+' calls">'
      +'<div class="lbl" style="margin-bottom:7px">'+esc(c[1])+(active?' <i class="fa-solid fa-filter" style="font-size:10px"></i>':'')+'</div>'
      +'<div class="val">'+c[2]+'</div>'
      +'<div style="font-size:12px;color:'+c[4]+';margin-top:3px">'+esc(c[3])+'</div></div>';
  }).join('')+'</div>';
}

/* ---------- Selection (All Calls log) → manual folders ---------- */
function trRenderSelBar(){
  const host=$('trSelBar');if(!host)return;
  const n=TR_SELECTED.size;
  if(!n){host.innerHTML='';return;}
  host.innerHTML='<div class="toolbar" style="margin:10px 0 0;background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:10px 14px;position:sticky;top:78px;z-index:20;box-shadow:0 2px 8px rgba(16,24,40,.08)">'
    +'<div style="font-size:13px;font-weight:600;color:#0d9488">'+n+' call'+(n===1?'':'s')+' selected</div><div class="grow"></div>'
    +'<button class="btn btn-sm" onclick="trClearSelection()">Clear</button>'
    +'<button class="btn btn-sm" onclick="trPinSelected(true)"><i class="fa-solid fa-thumbtack"></i> Pin</button>'
    +'<button class="btn btn-sm" onclick="trPinSelected(false)"><i class="fa-solid fa-thumbtack" style="transform:rotate(45deg);display:inline-block"></i> Unpin</button>'
    +(TR_ADD_TARGET
      ?'<button class="btn btn-sm btn-primary" onclick="trAddSelectedToTarget()"><i class="fa-solid fa-folder-plus"></i> Add to "'+esc(TR_ADD_TARGET)+'"</button>'
      :'<button class="btn btn-sm btn-primary" onclick="trFolderAssignModal()"><i class="fa-solid fa-folder-plus"></i> Add to folder</button>')
    +'</div>';
}
window.trToggleSelect=function(id,checked){ if(checked)TR_SELECTED.add(id); else TR_SELECTED.delete(id); trRenderSelBar(); };
window.trClearSelection=function(){ TR_SELECTED=new Set(); trRenderSelBar(); trRenderList(); };
window.trPinSelected=async function(pin){
  if(!TR_SELECTED.size){toast('Select at least one call first','err');return;}
  const ids=Array.from(TR_SELECTED);
  let base=trNextPinRank();
  (TR_ROWS||[]).forEach(function(r){if(ids.indexOf(r.id)>=0){r.pinned=pin;r.pin_rank=pin?base++:null;}});
  trRenderList();trRenderFolderRows();
  toast(pin?'Pinned':'Unpinned','ok');
  try{await Promise.all(ids.map(function(id){const r=(TR_ROWS||[]).find(function(x){return x.id===id;});return sb.schema('acc').from('transcriptions').update({pinned:pin,pin_rank:r?r.pin_rank:null}).eq('id',id);}));}catch(e){toast('Saved locally, but failed to sync: '+((e&&e.message)||e),'err');}
};
// Reorder pinned calls by drag-and-drop — mirrors the existing checklist drag pattern
// (clReorderDrop) but persists order as a pin_rank float on the transcription itself.
window.trPinReorderDrop=async function(e,row){
  e.preventDefault();
  const above=row.classList.contains('drop-above');
  row.classList.remove('drop-above','drop-below');
  const draggedId=parseInt(e.dataTransfer.getData('text/plain'),10);
  const targetId=parseInt(row.dataset.id,10);
  if(!draggedId||draggedId===targetId)return;
  const pinnedOrder=trSortPinned((TR_ROWS||[]).filter(function(r){return r.pinned;})).map(function(r){return r.id;});
  let order=pinnedOrder.filter(function(id){return id!==draggedId;});
  let idx=order.indexOf(targetId);
  if(idx===-1)idx=order.length;
  order.splice(above?idx:idx+1,0,draggedId);
  order.forEach(function(id,i){const r=(TR_ROWS||[]).find(function(x){return x.id===id;});if(r)r.pin_rank=i;});
  trRenderList();trRenderFolderRows();
  try{await Promise.all(order.map(function(id,i){return sb.schema('acc').from('transcriptions').update({pin_rank:i}).eq('id',id);}));}catch(e2){toast('Saved locally, but failed to sync: '+((e2&&e2.message)||e2),'err');}
};
window.trFolderAssignModal=function(){
  if(!TR_SELECTED.size){toast('Select at least one call first','err');return;}
  const existing=trFolderNames(TR_ROWS||[]);
  window._trFolderChips=existing;
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-folder-plus"></i> Add to folder</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm">'
    +(existing.length?('<label>Existing folders</label><div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">'+existing.map(function(n,i){return '<button type="button" class="btn btn-sm" onclick="trAssignToFolder(null,'+i+')"><i class="fa-solid fa-folder"></i> '+esc(n)+'</button>';}).join('')+'</div>'):'')
    +'<label>New folder name</label><input id="trFolderName" placeholder="e.g. Hot leads — Dream Valley">'
    +'</div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="trAssignToFolder()"><i class="fa-solid fa-check"></i> Create &amp; add</button></div>','md');
};
window.trAssignToFolder=async function(typedName,chipIndex){
  const name=(chipIndex!=null&&window._trFolderChips)?window._trFolderChips[chipIndex]:(typedName||($('trFolderName')?$('trFolderName').value.trim():''));
  if(!name){toast('Enter a folder name','err');return;}
  const ids=Array.from(TR_SELECTED);
  if(!ids.length){toast('Select at least one call first','err');return;}
  (TR_ROWS||[]).forEach(function(r){if(ids.indexOf(r.id)>=0)r.folder=name;});
  closeModal();
  TR_SELECTED=new Set();
  trRenderSelBar();trRenderList();
  toast('Added to "'+name+'"','ok');
  try{await sb.schema('acc').from('transcriptions').update({folder:name}).in('id',ids);}catch(e){toast('Saved locally, but failed to sync: '+((e&&e.message)||e),'err');}
};

// Shared row template — used by the flat log (mode 'list', with a select checkbox) and the
// per-folder drill-in (mode 'folder', with a remove-from-folder action instead).
function trRowHtml(r,mode){
  mode=mode||'list';
  const fname=r.file_name||'Recording';
  const cursorAttr=r.pinned?' style="cursor:grab"':((r.status==='done')?' style="cursor:pointer"':'');
  const openAttrs=cursorAttr+((r.status==='done')?' onclick="navTo(\'transcription/view/'+r.id+'\')" title="Open this call"':'');
  // Pinned rows are draggable, reusing the same drag mechanics as the checklist reorder
  // (taskDragOver) elsewhere in this file — persisted via pin_rank in trPinReorderDrop.
  const dragAttrs=r.pinned?(' draggable="true" data-id="'+r.id+'" ondragstart="event.dataTransfer.setData(\'text/plain\',\''+r.id+'\');this.classList.add(\'dragging\')" ondragend="this.classList.remove(\'dragging\')" ondragover="event.preventDefault();taskDragOver(event,this)" ondragleave="this.classList.remove(\'drop-above\',\'drop-below\')" ondrop="trPinReorderDrop(event,this)"'):'';
  const rowClass=r.pinned?' class="pin-drag"':'';
  /* Main line = the recording's name, which is now "Full Name_Lead Id" from the CRM (or the lead id
     alone when the CRM holds no name). Below it = the caller's number, and a plain note when the
     recording produced no transcript, so a row is never silently empty. */
  const ph=trPhone(r);
  const sub=[ph?trPhoneFmt(ph):'', trIsNilRow(r)?'<span style="color:#94a3b8">(Not Transcribed)</span>':'']
    .filter(Boolean).join(' · ');
  const nameLine=sub?'<div style="font-size:11px;color:var(--slate)">'+sub+'</div>':'';
  const checkTd=mode==='list'?('<td onclick="event.stopPropagation()"><input type="checkbox" class="checkbox"'+(TR_SELECTED.has(r.id)?' checked':'')+' onchange="trToggleSelect('+r.id+',this.checked)"></td>'):'';
  // Pinned rows are draggable from anywhere on the row (no separate grip icon needed — that
  // used to widen this cell just for pinned rows and forced the table into horizontal scroll).
  const pinIcon=r.pinned?('<i class="fa-solid fa-thumbtack" style="color:#d97706;font-size:12px;flex-shrink:0" title="Pinned — drag row to reorder" onclick="event.stopPropagation()"></i>'):'';
  return '<tr'+rowClass+openAttrs+dragAttrs+'>'
    +checkTd
    +'<td><div style="display:flex;align-items:center;gap:8px;max-width:280px">'+pinIcon+'<i class="fa-solid fa-file-audio" style="color:#0d9488;font-size:15px;flex-shrink:0"></i><div style="min-width:0;flex:1"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(fname)+'">'+esc(fname)+'</div>'+nameLine+'</div></div></td>'
    +'<td>'+trQualTag(r)+(r.status==='error'&&r.error_text?'<div style="font-size:11px;color:#dc2626;margin-top:3px" title="'+esc(r.error_text)+'">'+esc(String(r.error_text).slice(0,60))+'</div>':'')+'</td>'
    +'<td>'+trCrmTag(r.crm_status)+(r.mismatch?'<div style="font-size:10.5px;color:#dc2626;margin-top:3px;font-weight:600" title="'+esc(r.mismatch_reason||'')+'"><i class="fa-solid fa-triangle-exclamation"></i> disagrees</div>':'')+'</td>'
    +'<td>'+trDateReasonHtml(r)+'</td>'
    +'<td style="max-width:260px"><div title="'+(r.reason?esc(r.reason):'')+'" style="font-size:12.5px;color:var(--slate);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">'+(r.reason?esc(r.reason):'—')+'</div>'+(r.project&&r.project!=='Unclear'?'<div style="font-size:11px;color:#0d9488;font-weight:600;margin-top:2px">'+esc(r.project)+'</div>':'')+'</td>'
    +'<td>'+trLangTags(r.languages)+'</td>'
    +'<td>'+trFmtDur(r.duration_seconds)+'</td>'
    +'<td style="color:var(--slate);font-size:12px">'+fmtDate(r.created_at)+'</td>'
    +'<td style="white-space:nowrap" onclick="event.stopPropagation()">'
      /* Icon only, like every other control in this cell, and an audio-file icon rather than the
         download arrow - the button immediately after this one downloads the REPORT and already owns
         that arrow here, so two identical icons side by side would say nothing about which is which.
         feat carries the key trCopyUrl used to be counted under, so replacing the button with a link
         does not silently end that measurement. */
      +(r.recording_url?trRecLink(r.recording_url,{cls:'btn btn-sm btn-ghost',label:'',icon:'fa-file-audio',
          title:'Download this call recording',file:trRecFile(r),
          feat:'transcription.all_calls.download_call_report_or_copy_link'})+' ':'')
      +(r.status==='done'?'<button class="btn btn-sm btn-ghost" title="Download report" onclick="trDownloadReport('+r.id+')"><i class="fa-solid fa-download"></i></button> ':'')
      +(mode==='folder'?'<button class="btn btn-sm btn-ghost" title="Remove from folder" onclick="trRemoveFromFolder('+r.id+')"><i class="fa-solid fa-xmark"></i></button> ':'')
      +(r.status==='error'?'<button class="btn btn-sm" title="Retry analysis" onclick="trRetry('+r.id+')"><i class="fa-solid fa-rotate-right"></i> Retry</button> ':'')
      +'<button class="btn btn-sm btn-ghost" title="Delete" onclick="trDelete('+r.id+')"><i class="fa-solid fa-trash"></i></button>'
    +'</td></tr>';
}
function trRowsBodyHtml(rows,mode){return rows.map(function(r){return trRowHtml(r,mode);}).join('');}

/* ---------- Folders (user-created only, from checkbox selection above) ---------- */
function trFolderNames(rows){
  const set=new Set();(rows||[]).forEach(function(r){if(r.folder)set.add(r.folder);});
  return Array.from(set).sort(function(a,b){return a.localeCompare(b);});
}
function trFolderRows(rows,name){return (rows||[]).filter(function(r){return r.folder===name&&trInDateRange(r);});}
// idx indexes into window._trFolderList (set by trFolderGridHtml) — cards pass it so rename/delete
// never has to embed the folder name itself as a JS string literal (quote-escaping headaches).
function trFolderCardHtml(name,list,idx){
  const qual=list.filter(function(r){return r.qualification==='Qualified';}).length;
  return '<div class="card card-pad" style="position:relative;cursor:pointer" onclick="navTo(\'transcription/2/'+encodeURIComponent(name)+'\')">'
    +'<div style="position:absolute;top:8px;right:8px;display:flex;gap:2px" onclick="event.stopPropagation()">'
      +'<button class="btn btn-sm btn-ghost" title="Rename folder" onclick="trFolderRenameModal('+idx+')"><i class="fa-solid fa-pen" style="font-size:11px"></i></button>'
      +'<button class="btn btn-sm btn-ghost" title="Delete folder" onclick="trFolderDeleteConfirm('+idx+')"><i class="fa-solid fa-trash" style="font-size:11px"></i></button>'
    +'</div>'
    +'<div style="display:flex;align-items:center;gap:12px;padding-right:50px">'
    +'<i class="fa-solid fa-folder" style="font-size:26px;color:#0d9488"></i>'
    +'<div style="min-width:0"><div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(name)+'</div>'
    +'<div style="font-size:12px;color:var(--slate);margin-top:2px">'+list.length+' call'+(list.length===1?'':'s')+(list.length?(' · '+qual+' qualified'):'')+'</div></div>'
    +'</div></div>';
}
function trFolderGridHtml(rows){
  const names=trFolderNames(rows);
  window._trFolderList=names;
  if(!names.length){
    return '<div class="card card-pad empty" style="margin-top:16px;padding:40px"><i class="fa-solid fa-folder-open"></i><div>No folders yet</div><div style="font-size:12.5px;color:var(--slate);margin-top:6px">Go to <b>All Calls</b>, tick the calls you want grouped together, then use "Add to folder".</div></div>';
  }
  const cards=names.map(function(n,i){return trFolderCardHtml(n,trFolderRows(rows,n),i);});
  return '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;margin-top:16px">'+cards.join('')+'</div>';
}
function trFolderCallsHtml(rows,name){
  const list=trFolderRows(rows,name);
  return '<div class="toolbar" style="margin:16px 0;flex-wrap:wrap;gap:10px"><button class="btn btn-sm" onclick="navTo(\'transcription/2\')"><i class="fa-solid fa-arrow-left"></i> All folders</button>'+trDateRangeHtml()+'<div class="grow"></div>'
    +'<button class="btn btn-sm" onclick="trGoAddCalls()"><i class="fa-solid fa-plus"></i> Add calls</button>'
    +'<button class="btn btn-sm" onclick="trFolderRenameModal()"><i class="fa-solid fa-pen"></i> Rename</button>'
    +'<button class="btn btn-sm" onclick="trFolderDeleteConfirm()"><i class="fa-solid fa-trash"></i> Delete folder</button>'
    +(list.length?'<button class="btn btn-sm" onclick="trDownloadFolder()"><i class="fa-solid fa-download"></i> Download</button>':'')+'</div>'
    +'<div class="page-head" style="padding:0 0 10px"><h1 style="font-size:17px"><i class="fa-solid fa-folder" style="color:#0d9488"></i> '+esc(name)+'</h1></div>'
    +'<div class="card"><div style="overflow:auto;max-height:62vh"><table class="tbl"><thead><tr><th>Recording</th><th>Status</th><th>CRM</th><th>Date / Reason</th><th>Reason</th><th>Languages</th><th>Duration</th><th>Uploaded</th><th></th></tr></thead>'
    +'<tbody id="trFolderRowsBody">'+(list.length?trRowsBodyHtml(trSortPinned(list),'folder'):'<tr><td colspan="9"><div class="empty" style="padding:34px"><i class="fa-solid fa-folder-open"></i><div>No calls in this folder yet</div></div></td></tr>')+'</tbody></table></div></div>';
}

/* ---------- Discrepancies (CRM lost/followup calls only) ---------- */
// One row per call that's worth a human look: a real disagreement between the CRM's own record
// and what the call actually contains, or the call simply couldn't be checked at all (failed /
// no recording was ever supplied).
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
function trRenderFolderRows(){
  const host=$('trFolderRowsBody');if(!host||!TR_FOLDER)return;
  const list=trFolderRows(TR_ROWS||[],TR_FOLDER);
  host.innerHTML=list.length?trRowsBodyHtml(trSortPinned(list),'folder'):'<tr><td colspan="9"><div class="empty" style="padding:34px"><i class="fa-solid fa-folder-open"></i><div>No calls in this folder yet</div></div></td></tr>';
}
// "Add calls" takes you to the All Calls log (tab 0) in a targeted mode: a banner up top
// says which folder you're adding to, and the selection bar's action adds straight into it —
// no need to re-pick the folder once you get there. See trAddSelectedToTarget / the banner
// in VIEWS.transcription's All Calls branch.
window.trGoAddCalls=function(){
  TR_ADD_TARGET=TR_FOLDER;
  navTo('transcription');
};
window.trCancelAddTarget=function(){ TR_ADD_TARGET=null; renderPage(); };
window.trDoneAddTarget=function(){
  const f=TR_ADD_TARGET; TR_ADD_TARGET=null;
  if(f) navTo('transcription/2/'+encodeURIComponent(f)); else navTo('transcription/2');
};
window.trAddSelectedToTarget=async function(){
  if(!TR_ADD_TARGET)return;
  const ids=Array.from(TR_SELECTED);
  if(!ids.length){toast('Select at least one call first','err');return;}
  const name=TR_ADD_TARGET;
  (TR_ROWS||[]).forEach(function(r){if(ids.indexOf(r.id)>=0)r.folder=name;});
  TR_SELECTED=new Set();
  trRenderSelBar();trRenderList();
  toast('Added to "'+name+'"','ok');
  // Wait for the write to land before navigating — the folder page immediately below refetches
  // from the DB, so jumping there too early could show the list without what was just added.
  try{await sb.schema('acc').from('transcriptions').update({folder:name}).in('id',ids);}catch(e){toast('Saved locally, but failed to sync: '+((e&&e.message)||e),'err');}
  TR_ADD_TARGET=null;
  navTo('transcription/2/'+encodeURIComponent(name));
};
// Redraws whatever is currently on screen on the Folders tab (grid or a drill-in) from the
// in-memory TR_ROWS — no refetch, so an in-flight DB write for the same rows can't be raced.
function trRenderFolderArea(){
  const host=$('trFolderArea');if(!host)return;
  const rows=TR_ROWS||[];
  host.innerHTML=TR_FOLDER?trFolderCallsHtml(rows,TR_FOLDER):trFolderGridHtml(rows);
}
window.trRemoveFromFolder=async function(id){
  const ok=await confirmDialog('Remove this call from the folder? The call itself won\'t be deleted.');
  if(!ok)return;
  const r=(TR_ROWS||[]).find(function(x){return x.id===id;});
  if(r)r.folder=null;
  trRenderFolderRows();
  try{await sb.schema('acc').from('transcriptions').update({folder:null}).eq('id',id);}catch(e){}
  toast('Removed from folder','ok');
};
window.trFolderRenameModal=function(idx){
  const name=(idx!=null&&window._trFolderList)?window._trFolderList[idx]:TR_FOLDER;
  if(!name)return;
  window._trFolderRenameTarget=name;
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-pen"></i> Rename folder</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm"><label>Folder name</label><input id="trFolderRenameInput" value="'+esc(name)+'"></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="trFolderRenameSave()"><i class="fa-solid fa-check"></i> Save</button></div>','md');
  setTimeout(function(){const i=$('trFolderRenameInput');if(i){i.focus();i.select();}},30);
};
window.trFolderRenameSave=async function(){
  const oldName=window._trFolderRenameTarget;if(!oldName)return;
  const inp=$('trFolderRenameInput');const newName=inp?inp.value.trim():'';
  if(!newName){toast('Enter a folder name','err');return;}
  closeModal();
  if(newName===oldName)return;
  const ids=(TR_ROWS||[]).filter(function(r){return r.folder===oldName;}).map(function(r){return r.id;});
  (TR_ROWS||[]).forEach(function(r){if(r.folder===oldName)r.folder=newName;});
  if(TR_FOLDER===oldName)TR_FOLDER=newName;
  trRenderFolderArea();
  toast('Folder renamed','ok');
  if(ids.length)try{await sb.schema('acc').from('transcriptions').update({folder:newName}).in('id',ids);}catch(e){toast('Saved locally, but failed to sync: '+((e&&e.message)||e),'err');}
};
window.trFolderDeleteConfirm=async function(idx){
  const name=(idx!=null&&window._trFolderList)?window._trFolderList[idx]:TR_FOLDER;
  if(!name)return;
  const ids=(TR_ROWS||[]).filter(function(r){return r.folder===name;}).map(function(r){return r.id;});
  const ok=await confirmDialog('Delete the folder "'+name+'"? The '+ids.length+' call'+(ids.length===1?'':'s')+' inside stay — they just won\'t be in a folder anymore.');
  if(!ok)return;
  (TR_ROWS||[]).forEach(function(r){if(r.folder===name)r.folder=null;});
  const wasViewing=(TR_FOLDER===name);
  toast('Folder deleted','ok');
  if(ids.length)try{await sb.schema('acc').from('transcriptions').update({folder:null}).in('id',ids);}catch(e){toast('Saved locally, but failed to sync: '+((e&&e.message)||e),'err');}
  if(wasViewing){ navTo('transcription/2'); } else { trRenderFolderArea(); }
};

/* ---------- Download ---------- */
// Builds a self-contained HTML report (letterhead-style, no dependency on nexus.css) and saves
// it directly as a file — a real download, not a print-dialog flow.
function trExportHtml(rows,heading){
  const now=new Date();
  const dateStr=now.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})+' '+now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
  const cards=rows.map(function(r){
    const o=trOutcome(r.qualification);
    const badge=o?('<span class="badge" style="background:'+o.bg+';color:'+o.ink+'">'+esc(r.qualification)+'</span>'):'';
    const langs=(r.languages&&r.languages.length)?r.languages.map(trLangName).join(', '):'—';
    const reasonHtml=r.reason?('<div class="sec"><div class="sec-h">Qualification reason</div><div class="pre">'+esc(r.reason)+'</div></div>'):'';
    const summaryHtml=r.summary?('<div class="sec"><div class="sec-h">Summary</div><div class="pre">'+esc(r.summary)+'</div></div>'):'';
    const c=r.criteria||{};
    const critItems=[['site_visit_interested','Wants a site visit'],['location_match','Location match'],['bhk_match','BHK available'],['budget_match','Budget match'],['ready_move_match','Ready / Under-construction']];
    const critHtml='<div class="sec"><div class="sec-h">Qualification checklist</div><ul class="crit">'+critItems.map(function(it){const ok=c[it[0]]===true;return '<li style="color:'+(ok?'#166534':'#991b1b')+'">'+(ok?'&#10003;':'&#10007;')+' '+esc(it[1])+'</li>';}).join('')+'</ul></div>';
    const transcript=r.transcript_en||r.transcript||'';
    const transcriptHtml=transcript?('<div class="sec"><div class="sec-h">Transcript (English)</div><div class="pre transcript">'+esc(transcript)+'</div></div>'):'';
    return '<div class="call">'
      +'<div class="call-h"><div><div class="fn">'+esc(r.file_name||'Recording')+'</div>'
      +(r.customer_name?'<div class="cn">'+esc(r.customer_name)+'</div>':'')+'</div>'+badge+'</div>'
      +'<div class="meta">Project: <b>'+esc(r.project&&r.project!=='Unclear'?r.project:'Unclear')+'</b> &nbsp;&middot;&nbsp; Duration: '+esc(trFmtDur(r.duration_seconds))+' &nbsp;&middot;&nbsp; Languages: '+esc(langs)+' &nbsp;&middot;&nbsp; Uploaded: '+esc(fmtDate(r.created_at))+'</div>'
      +reasonHtml+summaryHtml+critHtml+transcriptHtml
      +'</div>';
  }).join('');
  return '<!doctype html><html><head><meta charset="utf-8"><title>'+esc(heading)+'</title><style>'
    +'body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:32px;background:#fff}'
    +'.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #0d9488;padding-bottom:14px;margin-bottom:22px}'
    +'.top h1{margin:0;font-size:20px;color:#0d9488}'
    +'.top .sub{font-size:12px;color:#64748b;margin-top:4px}'
    +'.call{border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;margin-bottom:20px;page-break-inside:avoid}'
    +'.call-h{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}'
    +'.fn{font-weight:700;font-size:15px}'
    +'.cn{font-size:12.5px;color:#64748b;margin-top:2px}'
    +'.badge{font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:20px;white-space:nowrap}'
    +'.meta{font-size:12px;color:#475569;margin:8px 0 12px}'
    +'.sec{margin-top:12px}'
    +'.sec-h{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#0d9488;margin-bottom:5px}'
    +'.pre{font-size:13px;line-height:1.6;white-space:pre-wrap}'
    +'ul.crit{margin:0;padding:0;list-style:none;font-size:13px;line-height:1.8}'
    +'@media print{.call{page-break-after:always}.call:last-child{page-break-after:auto}}'
    +'</style></head><body>'
    +'<div class="top"><div><h1>Jain Group — Pre-Sales Call Transcriptions</h1><div class="sub">'+esc(heading)+'</div></div><div class="sub">Downloaded '+esc(dateStr)+' &middot; '+rows.length+' call'+(rows.length===1?'':'s')+'</div></div>'
    +cards
    +'</body></html>';
}
function trSafeFilename(s){return (String(s||'transcription').replace(/[^a-z0-9 _-]/gi,'').trim()||'transcription').slice(0,60);}
function trTriggerDownload(html,filename){
  const blob=new Blob([html],{type:'text/html'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();
  setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);},200);
}
function trDownloadRows(rows,heading){
  const doneRows=(rows||[]).filter(function(r){return r.status==='done';});
  if(!doneRows.length){toast('No finished calls to download','err');return;}
  trTriggerDownload(trExportHtml(doneRows,heading),trSafeFilename(heading)+'.html');
}
window.trDownloadList=function(){
  const label=TR_FILTER==='qualified'?'Qualified calls':(TR_FILTER==='notqualified'?'Not qualified calls':(TR_FILTER==='followup'?'Follow-Up calls':(TR_FILTER==='processing'?'Calls being transcribed':'All calls')));
  trDownloadRows(trApplyFilter(TR_ROWS||[]),label);
};
window.trDownloadReport=function(id){
  const r=(TR_ROWS||[]).find(function(x){return x.id===id;});
  if(!r){toast('Call not found','err');return;}
  trDownloadRows([r],r.file_name||'Call');
};
window.trDownloadDetail=function(){
  if(!TR_DETAIL_ROW){toast('Nothing to download','err');return;}
  trDownloadRows([TR_DETAIL_ROW],TR_DETAIL_ROW.file_name||'Call');
};
window.trDownloadFolder=function(){
  if(!TR_FOLDER)return;
  trDownloadRows(trFolderRows(TR_ROWS||[],TR_FOLDER),TR_FOLDER);
};

async function trPollOnce(id){
  const {data:{session}}=await sb.auth.getSession();
  const token=session&&session.access_token;
  const res=await fetch(SUPABASE_URL+'/functions/v1/transcription-analyze',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},body:JSON.stringify({action:'poll',id:id})});
  return res.json().catch(function(){return null;});
}
function trStartPolling(id){
  if(TR_TIMERS[id])return;
  const tick=async function(){
    let out=null;try{out=await trPollOnce(id);}catch(e){}
    if(out&&out.row){const i=(TR_ROWS||[]).findIndex(function(x){return x.id===out.row.id;});if(i>=0)TR_ROWS[i]=out.row;}
    const st=out&&(out.status||(out.row&&out.row.status));
    if(st==='done'||st==='error'){
      delete TR_TIMERS[id];
      if(TR_ROWS)trCacheWrite('tr_fetch_cache','all',TR_ROWS); // this call is done transcribing - worth freezing into the 5h cache now
      if(PAGE==='transcription')renderPage();
      return;
    }
    TR_TIMERS[id]=setTimeout(tick,6000);
  };
  TR_TIMERS[id]=setTimeout(tick,3000);
}

// Permanent record of every delete/restore — independent of deleted_at, so the history survives
// even after something is restored (deleted_at just says "currently deleted or not").
function trLogActivity(id,fname,action){
  try{sb.schema('acc').from('transcription_activity').insert({transcription_id:id,file_name:fname||null,actor:(state&&state.email)||null,action:action});}catch(e){}
}
window.trDelete=async function(id){
  const ok=await confirmDialog('Delete this recording? It moves to the Deleted tab, where you can restore it any time — the recording file is kept.');
  if(!ok)return;
  const r=(TR_ROWS||[]).find(function(x){return x.id===id;});
  const now=new Date().toISOString(), who=(state&&state.email)||null;
  TR_ROWS=(TR_ROWS||[]).filter(function(x){return x.id!==id;});
  TR_SELECTED.delete(id);
  if(r){r.deleted_at=now;r.deleted_by=who;TR_DELETED_ROWS=[r].concat(TR_DELETED_ROWS||[]);}
  trCacheWrite('tr_fetch_cache','all',TR_ROWS);
  trRenderList();trRenderFolderRows();
  try{await sb.schema('acc').from('transcriptions').update({deleted_at:now,deleted_by:who}).eq('id',id);}catch(e){}
  trLogActivity(id,r&&r.file_name,'deleted');
  toast('Recording deleted','ok');
};
function trDeletedRowHtml(r){
  const fname=r.file_name||'Recording';
  const openAttrs=(r.status==='done')?' style="cursor:pointer" onclick="navTo(\'transcription/view/'+r.id+'\')" title="Open this call"':'';
  return '<tr'+openAttrs+'>'
    +'<td><div style="font-weight:600;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(fname)+'">'+esc(fname)+'</div>'+(r.customer_name?'<div style="font-size:11px;color:var(--slate)">'+esc(r.customer_name)+'</div>':'')+'</td>'
    +'<td>'+trQualTag(r)+'</td>'
    +'<td style="color:var(--slate);font-size:12.5px">'+esc((r.deleted_by||'—').split('@')[0])+'</td>'
    +'<td style="color:var(--slate);font-size:12px">'+fmtDate(r.deleted_at)+'</td>'
    +'<td onclick="event.stopPropagation()"><button class="btn btn-sm" onclick="trRestore('+r.id+')"><i class="fa-solid fa-rotate-left"></i> Restore</button></td>'
  +'</tr>';
}
function trDeletedTableBody(){
  return (TR_DELETED_ROWS||[]).length?TR_DELETED_ROWS.map(trDeletedRowHtml).join(''):'<tr><td colspan="5"><div class="empty" style="padding:34px"><i class="fa-solid fa-trash"></i><div>No deleted calls</div></div></td></tr>';
}
window.trRestore=async function(id){
  const r=(TR_DELETED_ROWS||[]).find(function(x){return x.id===id;});
  TR_DELETED_ROWS=(TR_DELETED_ROWS||[]).filter(function(x){return x.id!==id;});
  const host=$('trDeletedRows');
  if(host)host.innerHTML=trDeletedTableBody();
  TR_ROWS=null; // so All Calls / Folders refetch and pick this call back up next time they're viewed
  trCacheClear('tr_fetch_cache');
  toast('Restored','ok');
  try{await sb.schema('acc').from('transcriptions').update({deleted_at:null,deleted_by:null}).eq('id',id);}catch(e){toast('Restored locally, but failed to sync: '+((e&&e.message)||e),'err');}
  trLogActivity(id,r&&r.file_name,'restored');
};
window.trRestoreAll=async function(){
  const rows=TR_DELETED_ROWS||[];
  if(!rows.length){toast('Nothing to restore','err');return;}
  const ok=await confirmDialog('Restore all '+rows.length+' deleted call'+(rows.length===1?'':'s')+'? They\'ll reappear in All Calls / their original folders.');
  if(!ok)return;
  const ids=rows.map(function(r){return r.id;});
  TR_DELETED_ROWS=[];
  const host=$('trDeletedRows');
  if(host)host.innerHTML=trDeletedTableBody();
  TR_ROWS=null;
  trCacheClear('tr_fetch_cache');
  toast('Restored '+ids.length+' call'+(ids.length===1?'':'s'),'ok');
  try{await sb.schema('acc').from('transcriptions').update({deleted_at:null,deleted_by:null}).in('id',ids);}catch(e){toast('Restored locally, but failed to sync: '+((e&&e.message)||e),'err');}
  rows.forEach(function(r){trLogActivity(r.id,r.file_name,'restored');});
};
// Every delete/restore ever, regardless of current state — this is the durable record the
// Deleted tab itself can't give you once something's been restored (its deleted_at is cleared).
const TR_ACTIVITY_META={
  deleted:{icon:'fa-trash',color:'#dc2626',label:'Deleted'},
  restored:{icon:'fa-rotate-left',color:'#16a34a',label:'Restored'},
  commented:{icon:'fa-comment',color:'#0d9488',label:'Remark added on'},
  remark_deleted:{icon:'fa-comment-slash',color:'#94a3b8',label:'Remark removed from'}
};
window.trShowHistory=async function(){
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-clock-rotate-left"></i> Activity history</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" id="trHistBody"><div class="loader"><div class="spin"></div></div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>','lg');
  let rows=[];
  try{const {data}=await sb.schema('acc').from('transcription_activity').select('*').order('created_at',{ascending:false}).limit(300);rows=data||[];}catch(e){}
  const body=$('trHistBody');if(!body)return;
  if(!rows.length){body.innerHTML='<div class="empty" style="padding:34px"><i class="fa-solid fa-clock-rotate-left"></i><div>No history yet</div></div>';return;}
  body.innerHTML='<div style="max-height:60vh;overflow:auto">'+rows.map(function(a){
    const m=TR_ACTIVITY_META[a.action]||{icon:'fa-circle-info',color:'#64748b',label:a.action};
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid var(--line)">'
      +'<i class="fa-solid '+m.icon+'" style="color:'+m.color+';width:16px"></i>'
      +'<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(a.file_name||('Call #'+a.transcription_id))+'</div>'
      +'<div style="font-size:11.5px;color:var(--slate)">'+m.label+' by '+esc((a.actor||'—').split('@')[0])+'</div></div>'
      +'<div style="font-size:11.5px;color:var(--slate);white-space:nowrap">'+fmtDate(a.created_at)+'</div>'
    +'</div>';
  }).join('')+'</div>';
};

// Re-run analysis on a failed row using the recording already in S3 — no re-upload needed.
window.trRetry=async function(id){
  const i=(TR_ROWS||[]).findIndex(function(x){return x.id===id;});
  if(i>=0){ TR_ROWS[i].status='processing'; TR_ROWS[i].error_text=null; trRenderList();trRenderFolderRows(); }
  const {data:{session}}=await sb.auth.getSession();
  const token=session&&session.access_token;
  try{
    const res=await fetch(SUPABASE_URL+'/functions/v1/transcription-analyze',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},body:JSON.stringify({action:'retry',id:id})});
    const out=await res.json().catch(function(){return {};});
    if(!res.ok||!out.row) throw new Error(out.error||'could not retry');
    trStartPolling(id);
    toast('Retrying…','ok');
  }catch(e){
    toast('Could not retry: '+((e&&e.message)||e),'err');
    if(i>=0){ TR_ROWS[i].status='error'; trRenderList();trRenderFolderRows(); }
  }
};

window.trUploadModal=function(){
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-cloud-arrow-up"></i> Upload call recordings</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm">'
    +'<div class="dropzone" ondragover="event.preventDefault()" ondrop="trDrop(event)" onclick="document.getElementById(\'trFile\').click()"><i class="fa-solid fa-file-audio"></i><div id="trUpName">Drag &amp; drop or click to select recordings — pick up to 50 at once</div><div style="font-size:12px;margin-top:4px">mp3 · wav · m4a · webm · mp4 · mov and more · Hindi / English / Bengali</div></div>'
    +'<input type="file" id="trFile" class="hidden" multiple accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.opus,.webm,.flac,.mp4,.mov,.mkv,.3gp,.amr" onchange="trUpPick()">'
    +'<div id="trFileList" style="margin-top:12px"></div>'
    +'<div id="trUpMsg" style="margin-top:10px"></div>'
    +'</div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="trUpBtn" onclick="trUploadStart()" disabled><i class="fa-solid fa-wand-magic-sparkles"></i> Transcribe &amp; Qualify</button></div>','md');
};
window.trDrop=function(ev){ev.preventDefault();const dt=ev.dataTransfer;if(!dt||!dt.files||!dt.files.length)return;const inp=$('trFile');if(!inp)return;const buf=new DataTransfer();for(let i=0;i<dt.files.length;i++)buf.items.add(dt.files[i]);inp.files=buf.files;trUpPick();};
window.trUpPick=function(){
  const files=Array.prototype.slice.call(($('trFile').files)||[]);
  const over=files.length>50;const n=Math.min(files.length,50);
  $('trUpName').textContent=files.length?(files.length===1?files[0].name:(files.length+' files selected'+(over?' — first 50 will be used':''))):'Drag & drop or click to select recordings — pick up to 50 at once';
  const list=$('trFileList');
  if(list){
    list.innerHTML=n?('<label style="display:block;margin-bottom:6px">Selected recording'+(n>1?'s':'')+'</label>'
      +'<div style="max-height:280px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:8px">'
      +files.slice(0,50).map(function(f,i){
        return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'
          +'<i class="fa-solid fa-file-audio" style="color:#0d9488"></i>'
          +'<div style="flex:1;min-width:0"><div style="font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(f.name)+'">'+esc(f.name)+'</div></div>'
          +'</div>';
      }).join('')+'</div>'
      +(over?'<div style="font-size:12px;color:#d97706;margin-top:6px"><i class="fa-solid fa-triangle-exclamation"></i> You picked '+files.length+' files — only the first 50 upload at a time.</div>':'')):'';
  }
  trUpValidate();
};
window.trUpValidate=function(){
  // No phone field anymore — just enable the button once at least one recording is picked.
  const n=Math.min((($('trFile').files||[]).length),50);
  const btn=$('trUpBtn');if(btn){btn.disabled=!(n>0);btn.innerHTML='<i class="fa-solid fa-wand-magic-sparkles"></i> Transcribe &amp; Qualify'+(n>1?(' '+n+' calls'):'');}
};
// Upload one recording: try direct browser->S3 first (fast, no size limit, works on the live
// domain); if that's blocked (e.g. testing from localhost, whose origin S3's CORS doesn't allow)
// fall back to the server-side proxy so it still uploads from anywhere.
// Read an audio/video file's duration (seconds) in the browser, so the list shows real length.
function trAudioDuration(file){return new Promise(function(resolve){try{const el=document.createElement('audio');el.preload='metadata';const url=URL.createObjectURL(file);let done=false;const fin=function(d){if(done)return;done=true;try{URL.revokeObjectURL(url);}catch(_){}resolve(d);};el.onloadedmetadata=function(){const d=el.duration;fin(isFinite(d)&&d>0?Math.round(d):null);};el.onerror=function(){fin(null);};setTimeout(function(){fin(null);},8000);el.src=url;}catch(e){resolve(null);}});}
async function trUploadOne(f,token){
  const key=s3KeyForTranscription(f.name);
  let path=null;
  try{ const up=await uploadFileToS3(key,f); if(up&&up.data&&up.data.path) path=up.data.path; }catch(_e){}
  if(!path){
    const up=await fetch(SUPABASE_URL+'/functions/v1/transcription-upload?key='+encodeURIComponent(key),{method:'POST',headers:{'Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY,'Content-Type':f.type||'application/octet-stream'},body:f});
    const uj=await up.json().catch(function(){return {};});
    if(!up.ok||!uj.path) throw new Error(uj.error||'upload failed');
    path=uj.path;
  }
  return path;
}
window.trUploadStart=async function(){
  let files=Array.prototype.slice.call(($('trFile').files)||[]);
  if(!files.length){toast('Select at least one recording','err');return;}
  if(files.length>50)files=files.slice(0,50);
  // Phone field removed — the caller's name/number is picked up from the call itself.
  const phones=files.map(function(){return null;});
  const btn=$('trUpBtn');if(btn)btn.disabled=true;
  const msg=$('trUpMsg');
  const {data:{session}}=await sb.auth.getSession();
  const token=session&&session.access_token;
  const total=files.length;let done=0,failed=0,idx=0;
  const paint=function(){const pct=Math.round((done+failed)/total*100);if(msg)msg.innerHTML='<div class="psa-progress"><div class="psa-progress-bar"><div class="psa-progress-fill" style="width:'+pct+'%"></div></div><div class="psa-progress-label">Processed '+(done+failed)+' of '+total+' · '+done+' ok'+(failed?', '+failed+' failed':'')+'</div></div>';};
  paint();
  const worker=async function(){
    while(idx<files.length){
      const i=idx++;const f=files[i];
      try{
        const dur=await trAudioDuration(f);
        const path=await trUploadOne(f,token);
        const res=await fetch(SUPABASE_URL+'/functions/v1/transcription-analyze',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},body:JSON.stringify({action:'start',key:path,phone:phones[i],name:f.name,size:f.size,duration:dur})});
        const out=await res.json().catch(function(){return {};});
        if(!res.ok||!out.row) throw new Error(out.error||'could not start');
        if(!TR_ROWS)TR_ROWS=[];
        TR_ROWS.unshift(out.row);
        trCacheClear('tr_fetch_cache'); // a call still processing has no business in the 5h cache - trStartPolling re-freezes it once it's actually done
        trStartPolling(out.row.id);
        done++;
      }catch(e){ failed++; }
      paint();
    }
  };
  const K=Math.min(4,files.length);
  await Promise.all(Array.from({length:K},function(){return worker();}));
  toast(done+' call'+(done===1?'':'s')+' submitted'+(failed?(', '+failed+' failed'):''), failed?'warn':'ok');
  closeModal();
  if(PAGE==='transcription')renderPage();
};

async function trDetail(v,id){
  setCrumb([['Growth & Strategy','#/'],['Transcription','#/'],'Recording']);
  loader(v);
  /* The recording and its comments go out together - see traDetail for the reasoning. Each
     still fails independently: no recording is the "not found" card, and comments that fail
     leave an empty comment list rather than an empty screen. */
  const [rowRes,cmtRes]=await Promise.all([
    sb.schema('acc').from('transcriptions').select('*').eq('id',id).single()
      .then(function(x){return x;},function(){return {data:null};}),
    sb.schema('acc').from('transcription_comments').select('*')
      .eq('transcription_id',id).order('created_at')
      .then(function(x){return x;},function(){return {data:[]};})
  ]);
  const r=rowRes&&rowRes.data;
  if(!r){v.innerHTML=mHead('fa-microphone-lines','#0d9488','Transcription')+'<div class="card card-pad empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Recording not found</div><button class="btn btn-sm" style="margin-top:12px" onclick="navTo(\'transcription\')">Back</button></div>';return;}
  const phone=r.phone||r.title||'';
  const name=phone?trPhoneFmt(phone):(r.file_name||'Recording');
  const a=r.analysis||{};
  const sub=(r.customer_name?esc(r.customer_name)+' · ':'')+fmtDate(r.created_at)+' · '+esc((r.created_by||'').split('@')[0]);
  const o=trOutcome(r.qualification)||TR_OUTCOMES['Not Qualified'];
  const banner=(r.status==='done'&&r.qualification)?('<div class="card card-pad" style="margin:6px 0 16px;border-left:5px solid '+o.colour+'"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span class="tag '+o.tag+'" style="font-size:14px;padding:6px 12px"><i class="fa-solid '+o.icon+'"></i> '+esc(r.qualification)+'</span>'+(r.project&&r.project!=='Unclear'?'<span style="font-weight:700;color:#0d9488;font-size:15px">'+esc(r.project)+'</span>':'')+'</div>'+(r.reason?'<div style="margin-top:10px;font-size:14px;line-height:1.55">'+esc(r.reason)+'</div>':'')+'</div>'):'';
  const comments=(cmtRes&&cmtRes.data)||[];
  const backBtn='<button class="btn btn-sm" onclick="goBack(\'transcription\')"><i class="fa-solid fa-arrow-left"></i> All calls</button>';
  v.innerHTML='<div class="page-head"><div><h1><i class="fa-solid fa-phone" style="color:#0d9488"></i> '+esc(name)+'</h1><p>'+sub+'</p></div><div style="display:flex;gap:10px">'+backBtn+'<button class="btn" onclick="trDownload('+r.id+')"><i class="fa-solid fa-download"></i> Recording</button></div></div>'
    +'<div id="trAudio" style="margin:6px 0 16px"></div>'
    +banner
    +mKpis([
      ['Duration',trFmtDur(r.duration_seconds),''],
      ['Languages',(r.languages&&r.languages.length?r.languages.map(trLangName).join(', '):'—'),'detected'],
      ['Project',(r.project&&r.project!=='Unclear'?r.project:'—'),'discussed'],
      ['Speakers',String(a.num_speakers||0),'diarised'],
    ])
    +'<div class="grid" style="grid-template-columns:1fr 1fr;gap:16px;margin-top:16px" id="trGrid">'
      +'<div class="card card-pad"><div class="sec-title" style="margin:0 0 10px"><i class="fa-solid fa-wand-magic-sparkles" style="color:#0d9488"></i> Summary</div><div style="font-size:14px;line-height:1.6;white-space:pre-wrap">'+(r.summary?esc(r.summary):'<span style="color:var(--slate)">No summary available.</span>')+'</div></div>'
      +'<div class="card card-pad"><div class="sec-title" style="margin:0 0 10px"><i class="fa-solid fa-list-check" style="color:#0d9488"></i> Qualification checklist</div>'+trCriteriaHtml(r)+'<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line)">'+trAnalysisHtml(r)+'</div></div>'
    +'</div>'
    +'<div class="card card-pad" style="margin-top:16px"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 0 12px"><div class="sec-title" style="margin:0"><i class="fa-solid fa-quote-left" style="color:#0d9488"></i> Transcript</div><div style="display:flex;gap:6px"><button class="btn btn-sm btn-primary" id="trLangEn" onclick="trSetLang(\'en\')">English</button><button class="btn btn-sm" id="trLangBn" onclick="trSetLang(\'bn\')">বাংলা / Original</button></div></div><div id="trTranscriptBody">'+trTranscriptHtml(r,'en')+'</div></div>'
    +'<div class="card card-pad" style="margin-top:16px"><div class="sec-title" style="margin:0 0 12px"><i class="fa-solid fa-comments" style="color:#0d9488"></i> Remarks</div>'
      +'<div class="chat-wrap" id="trCmWrap">'+(comments.length?comments.map(trCmItem).join(''):'<div class="empty" style="padding:26px 10px"><i class="fa-solid fa-comment-slash"></i><div style="font-size:13px">No remarks yet — anyone on the team can add one</div></div>')+'</div>'
      +'<div class="tr-cm-composer"><input id="trCmNew" placeholder="Add a remark…" onkeydown="if(event.key===\'Enter\')trCmAdd('+r.id+')"><button class="tr-cm-send" onclick="trCmAdd('+r.id+')" title="Post remark"><i class="fa-solid fa-paper-plane"></i></button></div>'
    +'</div>';
  TR_DETAIL_ROW=r;
  const st=document.createElement('style');st.textContent='@media(max-width:800px){#trGrid{grid-template-columns:1fr!important}}';document.head.appendChild(st);
  if(r.s3_path){
    try{const key=r.s3_path.slice(3);const {data}=await s3Sign('get',key);if(data&&data.url){const ah=$('trAudio');if(ah){ah.innerHTML='<audio controls preload="none" style="width:100%" src="'+data.url+'"></audio>';const au=ah.querySelector('audio');if(au)au.addEventListener('play',function(){try{usageQueue('transcription.call_detail.play_download_recording','view',{title:name});}catch(_e){}},{once:true});}}}catch(e){}
  }
}
// Remarks — open to anyone who can reach this page (same access model as the rest of the
// module); every add/delete is mirrored into transcription_activity for a durable record.
function trCmItem(c){
  const mine=c.author===state.email;
  return '<div class="chat-msg'+(mine?' mine':'')+'">'
    +(mine?'':avatar(nameOf(c.author)))
    +'<div style="min-width:0">'
      +'<div class="chat-meta"><b>'+esc(mine?'You':nameOf(c.author))+'</b><span>'+relTime(c.created_at)+'</span><i class="fa-solid fa-trash tr-cm-del" title="Delete remark" onclick="trCmDelete('+c.id+')"></i></div>'
      +'<div class="chat-bubble">'+esc(c.body)+'</div>'
    +'</div>'
  +'</div>';
}
window.trCmAdd=async function(id){
  const inp=$('trCmNew');const body=(inp&&inp.value||'').trim();if(!body)return;
  try{await sb.schema('acc').from('transcription_comments').insert({transcription_id:id,author:(state&&state.email)||null,body});}catch(e){toast('Could not post remark: '+((e&&e.message)||e),'err');return;}
  trLogActivity(id,TR_DETAIL_ROW&&TR_DETAIL_ROW.file_name,'commented');
  trDetail($('view'),id);
};
window.trCmDelete=async function(cid){
  const ok=await confirmDialog('Delete this remark?');
  if(!ok)return;
  try{await sb.schema('acc').from('transcription_comments').delete().eq('id',cid);}catch(e){toast((e&&e.message)||'Failed to delete','err');return;}
  const id=TR_DETAIL_ROW&&TR_DETAIL_ROW.id;
  if(id){trLogActivity(id,TR_DETAIL_ROW&&TR_DETAIL_ROW.file_name,'remark_deleted');toast('Remark deleted','ok');trDetail($('view'),id);}
};

function trCriteriaHtml(r){
  const c=r.criteria||{};
  const items=[['site_visit_interested','Wants a site visit'],['location_match','Location match'],['bhk_match','BHK available'],['budget_match','Budget match'],['ready_move_match','Ready / Under-construction'],['follow_up_requested','Asked to be called back later']];
  return '<div style="display:flex;flex-direction:column;gap:8px">'+items.map(function(it,idx){
    const ok=c[it[0]]===true;
    const badge=(idx===0)?'<span style="font-size:10px;font-weight:700;color:#0d9488;background:#f0fdfa;border:1px solid #99f6e4;border-radius:4px;padding:1px 5px;margin-left:6px">PRIORITY</span>':'';
    return '<div style="display:flex;align-items:center;gap:8px;font-size:13.5px"><i class="fa-solid '+(ok?'fa-circle-check':'fa-circle-xmark')+'" style="color:'+(ok?'#16a34a':'#dc2626')+';width:16px"></i> '+it[1]+badge+'</div>';
  }).join('')+'<div style="margin-top:9px;padding-top:8px;border-top:1px dashed var(--line);font-size:11.5px;color:var(--slate);line-height:1.4">Qualified if <b>site visit</b> is agreed — or if <b>Location, BHK, Budget &amp; Ready/Construction</b> all match. If neither matched but the customer asked to be <b>called back later</b>, it is a <b>Follow-Up</b> rather than lost.</div></div>';
}
function trAnalysisHtml(r){
  const a=r.analysis||{};
  const lb=a.language_breakdown||{};
  const rows=[];
  const langKeys=Object.keys(lb);
  if(langKeys.length){
    const total=langKeys.reduce(function(s,k){return s+lb[k];},0)||1;
    rows.push('<div style="font-size:12px;color:var(--slate);margin-bottom:6px">Language mix (by utterances)</div>');
    langKeys.sort(function(x,y){return lb[y]-lb[x];}).forEach(function(k){
      const pct=Math.round(lb[k]/total*100);
      rows.push('<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:3px"><span>'+esc(trLangName(k))+'</span><span style="color:var(--slate)">'+pct+'%</span></div><div style="height:7px;background:#e2e8f0;border-radius:4px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:#0d9488"></div></div></div>');
    });
  }
  if(Array.isArray(a.entities)&&a.entities.length){
    const ents=a.entities.slice(0,24).map(function(e){return '<span class="tag t-gray" style="margin:0 4px 4px 0">'+esc(e.text||e.value||e.entity||'')+'</span>';}).join('');
    if(ents.trim())rows.push('<div style="font-size:12px;color:var(--slate);margin:12px 0 6px">Key entities mentioned</div><div>'+ents+'</div>');
  }
  if(!rows.length)return '<div style="color:var(--slate);font-size:13px">No additional analysis available.</div>';
  return rows.join('');
}

let TR_DETAIL_ROW=null;
/* The CRM's own verdict on the lead, which is a different question from the AI's. The report used
   to be lost calls only and now also sends leads still In Followup, so this is worth showing beside
   the outcome rather than being assumed. */
const TR_CRM_TAGS={ 'Lost':{bg:'#fee2e2',ink:'#991b1b'}, 'In Followup':{bg:'#fef3c7',ink:'#92400e'} };
function trCrmTag(v){
  const s=String(v||'').trim();
  if(!s)return '<span style="color:var(--slate)">—</span>';
  const t=TR_CRM_TAGS[s]||{bg:'#e2e8f0',ink:'#334155'};
  return '<span class="badge" style="background:'+t.bg+';color:'+t.ink+';white-space:nowrap">'+esc(s)+'</span>';
}
// The CRM sends a next-followup date on an open lead and a lost reason on a closed one — whichever
// applies to this row is what "Date / Reason" shows, straight from the feed, not the AI's own read.
/* A promised callback date means nothing on its own. "14 Sep" is only late or early relative to the
   day the promise was made, so the call's own date is shown above it — the two together are the
   whole fact, and a reader should not have to hold one of them in their head from another column. */
function trCallDate(r){
  const d=new Date((r&&(r.report_date||r.created_at))||'');
  return isNaN(d)?'':d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
}
function trDateReasonHtml(r){
  if(r.crm_status==='In Followup'&&r.next_follow_up_date){
    const d=new Date(r.next_follow_up_date);
    if(!isNaN(d)){
      const called=trCallDate(r);
      return (called?('<div style="font-size:11px;color:var(--slate)">called '+esc(called)+'</div>'):'')
        +'<span style="font-size:12.5px"><b>next:</b> '+esc(d.toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}))+'</span>';
    }
  }
  if(r.crm_status==='Lost'&&r.crm_lost_reason)return '<span style="font-size:12.5px">'+esc(r.crm_lost_reason)+'</span>';
  return '<span style="color:var(--slate)">—</span>';
}

// The caller, by number. Falls back to whichever of the two columns the row actually carries.
function trPhone(r){ return String((r&&(r.phone||r.lead_mobile))||'').trim(); }

/* Who said what. Rendered from `utterances` when we have it, so a turn can be labelled with the
   customer's own number instead of the word "Customer", and so the Original toggle shows the native
   script - it used to read transcript_bn, which this pipeline never writes, leaving both toggles
   showing the same English. The flat transcript stays the fallback for older rows. */
function trTranscriptHtml(r,lang){
  const turns=Array.isArray(r&&r.utterances)?r.utterances:null;
  if(turns&&turns.length){
    const who=trPhone(r);
    const rows=turns.map(function(t){
      const isAgent=String((t&&t.speaker)||'').toLowerCase().indexOf('agent')!==-1;
      // The agent is staff and stays "Agent"; the other side is this lead, so name them by number.
      // trPhoneFmt returns +91 XXXXX XXXXX and escapes as it goes, so it is not escaped again below.
      const labelHtml=isAgent?'Agent':(who?trPhoneFmt(who):'Customer');
      const body=(lang==='bn')?((t&&(t.original||t.text))||''):((t&&(t.text||t.original))||'');
      if(!String(body).trim())return '';
      return '<div style="display:flex;gap:10px;padding:7px 0;border-top:1px solid var(--line)">'
        +'<div style="flex-shrink:0;width:118px">'
          +'<div style="font-weight:600;font-size:12px;color:'+(isAgent?'#0d9488':'#4f46e5')+'">'+labelHtml+'</div>'
          +(t&&t.timestamp?'<div style="font-size:10.5px;color:var(--slate)">'+esc(t.timestamp)+'</div>':'')
        +'</div>'
        +'<div style="flex:1;min-width:0;font-size:13.5px;line-height:1.65">'+esc(body)+'</div></div>';
    }).join('');
    if(rows)return '<div style="max-height:60vh;overflow:auto">'+rows+'</div>';
  }
  const txt=(lang==='bn')?(r.transcript_bn||r.transcript||''):(r.transcript_en||r.transcript||'');
  if(txt)return '<div style="font-size:13.5px;line-height:1.7;white-space:pre-wrap;max-height:60vh;overflow:auto">'+esc(txt)+'</div>';
  return '<div style="color:var(--slate);font-size:13px">Transcript not available.</div>';
}

window.trSetLang=function(lang){
  if(!TR_DETAIL_ROW)return;
  const b=$('trTranscriptBody');if(b)b.innerHTML=trTranscriptHtml(TR_DETAIL_ROW,lang);
  const en=$('trLangEn'),bn=$('trLangBn');
  if(en)en.className='btn btn-sm'+(lang==='en'?' btn-primary':'');
  if(bn)bn.className='btn btn-sm'+(lang==='bn'?' btn-primary':'');
};

window.trDownload=async function(id){
  const r=(TR_ROWS||[]).find(function(x){return x.id===id;});
  let path=r&&r.s3_path;
  if(!path){try{const {data}=await sb.schema('acc').from('transcriptions').select('s3_path,file_name').eq('id',id).single();if(data){path=data.s3_path;}}catch(e){}}
  if(!path){toast('Recording file not available','err');return;}
  s3OpenSigned(path,(r&&r.file_name)||undefined);
};

