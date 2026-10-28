/* ===== DAILY CHECKS — its own module =====

   The handful of things somebody looks at every morning, lifted out of Usability so that routine
   is one page rather than a hunt through twenty-five modules.

   EVERY FIGURE HERE IS TODAY'S, AND THE PAGE KEEPS ITSELF THAT WAY.
   Two of the three blocks used not to be. The feature rows were a thirty-day total — which reads
   almost the same every morning for a month, and so could not answer the one question the page
   exists to answer — and workflow health's Raised / Closed / Reverted were yesterday's, sitting in
   the same row as three columns counting right now. Both are today's now, with yesterday printed
   beneath them so there is something to read them against. The thirty-day total and the activity
   band stay on the feature rows as the longer view they always were, in their own column.

   And because a morning check is the kind of page that gets left open on a second screen, it
   re-reads itself every minute rather than freezing at whatever the figures were when it was
   opened. The three queries behind it cost a few tens of milliseconds between them, which is what
   makes a minute affordable; the loop stops while the tab is in the background and catches up the
   moment it comes back.

   The one thing that cannot be live is transcription health. The pass that grades calls starts
   about 00:30 IST and writes nothing during the working day, so making those five figures live
   would mean grading calls as they finish — a pipeline change, not a reporting one. That block now
   prints when the pass last wrote, so its age is on the page instead of in somebody's head.

   Gated exactly like Usability (hasUsability), because the RPCs behind it are — a page that drew
   an error for everyone else would be worse than no page.

   Deliberately NOT given the Usability report's date pickers. This answers "what needs attention
   today"; a range picker invites it to be read as a trend report, which is the other page's job. */
const DC={feat:null,wf:null,tr:null,err:null,at:null,busy:false,fail:0};
/* How often the page re-reads itself, and how old what is on screen may be before coming back to
   the tab forces a read rather than waiting for the next tick. The second one is what makes a tab
   left open overnight honest: the loop is suspended while it is hidden, so the figures on it can
   be hours old, and showing those for another whole minute would be the opposite of the point. */
const DC_EVERY_MS=60000, DC_STALE_MS=30000;
let DC_TIMER=null, DC_CLOCK=null;
/* Today in IST, as the plain date string the per-feature drill-downs filter on. usbIstNow() does
   the timezone move; this is only its date half, spelled the way the RPCs want it. */
function dcToday(){
  const n=usbIstNow();
  return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0');
}
/* One round trip per block, sent together because they are independent.
   A block whose query fails keeps whatever it last had rather than blanking. On a refresh, half a
   page of live figures beside one block that is a minute stale is strictly better than an error
   message where the page used to be — the reader came here to see numbers. Only the feature query
   failing on the FIRST load is fatal, because that is the call that tells us whether this reader
   is allowed to see any of this at all. */
async function dcLoad(first){
  if(DC.busy) return;
  DC.busy=true;
  /* .catch(), NOT a second argument to .then(). A then's rejection handler only sees the ORIGINAL
     promise rejecting — it does not catch what the fulfilment handler beside it throws. The
     Supabase client resolves with {error} instead of rejecting, so `throw r.error` IS that case,
     and written as .then(f,r) it sailed straight past r and rejected the whole Promise.all. That
     threw out of dcLoad with DC.busy still true, and every refresh afterwards found the flag set
     and returned immediately: one failed query and the page stopped updating for the rest of the
     day, with nothing on screen to say so. */
  const call=function(name){
    return sb.rpc(name).then(function(r){ if(r.error) throw r.error; return {ok:true,d:r.data||[]}; })
                       .catch(function(e){ return {ok:false,e:e}; });
  };
  /* And the flag is cleared in a finally for the same reason: this runs on a timer, so anything
     that can wedge it stays wedged until somebody reloads the page. */
  try{
    const res=await Promise.all([
      call('erp_usability_daily_feature_checks'),
      call('erp_usability_workflow_health'),
      call('erp_usability_transcription_health')
    ]);
    if(res[0].ok){ DC.feat=res[0].d; DC.err=null; }
    else if(first){ DC.feat=null; DC.err=(res[0].e&&res[0].e.message)||'Could not load'; }
    if(res[1].ok) DC.wf=res[1].d;
    if(res[2].ok) DC.tr=res[2].d;
    if(res[0].ok||res[1].ok||res[2].ok){ DC.at=Date.now(); DC.fail=0; } else { DC.fail++; }
    // nameOf() reads the global PEOPLE; getPeople caches it, so later refreshes cost nothing.
    try{ await getPeople(); }catch(e){}
    /* Anything the reader has expanded is re-read too. Those lists are "who used this today" and
       "which step are these sitting on" — leaving them on the copy fetched when they were opened
       would mean the one part of the page somebody is actually studying is the one part going
       stale. There are at most a handful open at a time. */
    if(!first) await dcRefreshOpen();
  }finally{ DC.busy=false; }
}
/* Re-reads only what is currently expanded, in parallel, and leaves a failed one on its last good
   rows rather than collapsing a list out from under the reader. */
async function dcRefreshOpen(){
  const jobs=[];
  USB_FEAT_OPEN.forEach(function(key){
    const r=usbDrillRange();
    jobs.push(sb.rpc('erp_usability_feature_users',{p_feature_key:key,p_from:r.from,p_to:r.to,p_email:null,p_department:null})
      .then(function(x){ if(!x.error) USB_FEAT_CACHE[key]=x.data||[]; },function(){}));
  });
  USB_WF_OPEN.forEach(function(key){
    const bits=key.split('|');
    jobs.push(sb.rpc('erp_usability_workflow_stuck_steps',{p_flow_id:Number(bits[0]),p_state:bits[1]})
      .then(function(x){ if(!x.error) USB_WF_CACHE[key]=x.data||[]; },function(){}));
  });
  if(jobs.length) await Promise.all(jobs);
}
VIEWS.daily_checks=async function(v){
  setCrumb(['Administration','Daily Checks']);
  loader(v);
  await dcLoad(true);
  /* USB_CSS carries every .usb- class this page borrows from Usability — the expand chevrons, the
     clickable amber cells, and the drill-down rows. The page never emitted it, which nobody saw
     while clicking a feature row did nothing (see usbRerenderDetail); with that fixed the lists
     would have opened unstyled, names and counts run together on one line. It sits outside
     #dcBody so the minute-by-minute repaint cannot take the stylesheet out with the figures.
     #dcTop is outside it for the same reason: the Refresh button should not vanish from under a
     cursor on its way to press it. */
  v.innerHTML=USB_CSS
    +mHead('fa-list-check','#b8902f','Daily Checks')
    +'<div id="dcTop">'+dcTopHtml()+'</div>'
    +'<div id="dcBody">'+dcBodyHtml()+'</div>';
  dcStart();
};
function dcTopHtml(){
  return '<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin:6px 2px 2px">'
    +'<p style="color:var(--slate);font-size:13px;margin:0;max-width:620px">What needs attention today. '
      +'Every count is today so far, in IST, with yesterday beneath it — except the call figures, which '
      +'the overnight pass grades and which say below when they last landed.</p>'
    +'<div style="display:flex;align-items:center;gap:10px;white-space:nowrap">'
      +'<span id="dcStamp" style="font-size:12px;color:var(--slate)">'+dcStampText()+'</span>'
      +'<button class="btn btn-sm" id="dcRefresh" onclick="dcRefreshNow()"><i class="fa-solid fa-rotate"></i> Refresh</button>'
    +'</div></div>';
}
/* "Updated 40 seconds ago", not a clock time: in front of a page that refreshes itself the
   question is how old this is, and a reader should not have to subtract. A refresh that failed
   says so rather than letting the age climb as though nothing were wrong. */
function dcStampText(){
  if(!DC.at) return '';
  const s=Math.max(0,Math.round((Date.now()-DC.at)/1000));
  const ago=s<10?'just now':s<60?(s+' seconds ago'):s<120?'a minute ago':(Math.round(s/60)+' minutes ago');
  const stale=s>=(DC_EVERY_MS/1000)*2;
  const ink=DC.fail?'#dc2626':stale?'#b45309':'#16a34a';
  return '<i class="fa-solid fa-circle" style="font-size:7px;margin-right:6px;vertical-align:middle;color:'+ink+'"></i>'
    +(DC.fail?('Last updated '+ago+' · could not reach the database'):(s<10?'Updated just now':('Updated '+ago)));
}
function dcBodyHtml(){
  if(DC.feat===null){
    return '<div class="card card-pad empty" style="margin-top:16px;padding:40px">'
      +'<i class="fa-solid fa-lock"></i><div>'+esc(DC.err||'Could not load')+'</div></div>';
  }
  const picks=DC.feat||[];
  /* Grouped by module in the catalogue's own order, so the page reads the way the list was
     written rather than alphabetically. */
  const mods=[]; picks.forEach(function(r){ if(mods.indexOf(r.module_label)===-1) mods.push(r.module_label); });
  const feature=mods.map(function(m){
    return usbDailyChecksHtml(picks.filter(function(r){ return r.module_label===m; }), m);
  }).join('');
  const none=(!picks.length && !(DC.wf||[]).length && !(DC.tr||[]).length)
    ? '<div class="card card-pad empty" style="margin-top:16px;padding:40px"><i class="fa-solid fa-list-check"></i>'
      +'<div>Nothing is flagged as a daily check yet</div></div>' : '';
  return usbWorkflowHealthHtml()+usbTranscriptionHealthHtml()+feature+none;
}
/* Repaints the figures in place. Expanding a workflow breakdown comes through here too, rather
   than through renderPage() — which would re-run the whole view and fire every query again on
   every click. */
function dcRepaint(){
  const b=$('dcBody'); if(b) b.innerHTML=dcBodyHtml();
  const s=$('dcStamp'); if(s) s.innerHTML=dcStampText();
}
/* THE REFRESH LOOP.
   Two timers on purpose. One re-reads the data every minute; the other re-prints the "updated N
   seconds ago" line every ten, so the age on screen stays honest between fetches without a fetch
   being what makes it move.
   Both stop when the tab goes to the background. Browsers throttle a hidden tab's intervals
   anyway, so the real choice is whether to be explicit about it — and being explicit is also what
   stops a laptop left open overnight issuing a query a minute into an empty room. */
function dcStart(){
  dcStop();
  DC_TIMER=setInterval(dcTick,DC_EVERY_MS);
  DC_CLOCK=setInterval(function(){ const s=$('dcStamp'); if(s) s.innerHTML=dcStampText(); },10000);
}
function dcStop(){
  if(DC_TIMER){ clearInterval(DC_TIMER); DC_TIMER=null; }
  if(DC_CLOCK){ clearInterval(DC_CLOCK); DC_CLOCK=null; }
}
async function dcTick(){
  if(document.hidden) return;
  if(!$('dcBody')){ dcStop(); return; }   // the view was replaced under us
  await dcLoad(false);
  dcRepaint();
}
/* Coming back to the tab reads immediately if what is on screen has had time to go stale, instead
   of serving out the remainder of a minute that elapsed while nobody was looking. Registered once
   for the whole bundle, so it has to check it is on the right page before touching anything. */
document.addEventListener('visibilitychange',function(){
  if(typeof PAGE==='undefined'||PAGE!=='daily_checks') return;
  if(document.hidden){ dcStop(); return; }
  if(!$('dcBody')) return;
  dcStart();
  if(!DC.at||(Date.now()-DC.at)>DC_STALE_MS) dcTick();
});
window.dcRefreshNow=async function(){
  const b=$('dcRefresh');
  if(b){ b.disabled=true; b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Refreshing…'; }
  /* finally, so a button pressed during an outage comes back rather than spinning for ever —
     redrawing #dcTop is what restores it, and that has to happen however the read ended. */
  try{ await dcLoad(false); }
  finally{
    dcRepaint();
    const t=$('dcTop'); if(t) t.innerHTML=dcTopHtml();
    dcStart();   // the minute restarts from this read, not from whenever the last tick happened
  }
};
/* WORKFLOW HEALTH — one row per workflow, on the Daily Checks page.
   Five of these six are not usage at all: they count where instances are actually sitting, which
   is the question "is anything stuck" really asks. They are a live snapshot, and they ignore the
   report's date pickers on purpose — the function's comment explains why.
   The last three used to be yesterday's totals sitting beside three live ones, which meant one row
   carried two different days with nothing on screen to say which was which. They are today's now,
   with yesterday printed under each so the day still has something to be read against. */
function usbWorkflowHealthHtml(){
  const rows=DC.wf;
  if(!rows||!rows.length) return '';
  const warn=function(n){ return Number(n)>0?'color:#b45309;font-weight:700':'color:var(--slate)'; };
  /* Today over yesterday in one cell. Yesterday is a whole day and today is a part of one, so they
     are never a fair comparison and the smaller type says as much; it is there for scale — two
     raised by eleven in the morning means something different depending on whether yesterday saw
     three or thirty. */
  const ty=function(t,y,amber){
    const a=Number(t||0), b=Number(y||0);
    return '<td><b style="'+(amber&&a?'color:#b45309':'')+'">'+a+'</b>'
      +'<div style="font-size:11px;color:var(--slate);margin-top:2px;font-weight:400">'+b+' yest</div></td>';
  };
  return '<div class="card" style="margin-bottom:14px">'
    +'<div class="card-pad" style="padding-bottom:10px">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'
        +'<div class="sec-title" style="margin:0"><i class="fa-solid fa-heart-pulse" style="color:#b8902f"></i> Workflow health</div>'
        +'<div style="font-size:12px;color:var(--slate)">Counted when you look at it</div>'
      +'</div>'
      +'<div style="font-size:12px;color:var(--slate);margin-top:3px">Where each workflow\'s instances are actually sitting. Click any amber figure to see which step.</div>'
    +'</div>'
    +'<div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr>'
      +'<th>Workflow</th>'
      +'<th style="width:78px" title="Live instances not yet finished">Live</th>'
      +'<th style="width:104px" title="Appeared for someone and not picked up yet">Awaiting receipt</th>'
      +'<th style="width:116px" title="A previous person forwarded it and the next person has not accepted it">Forwarded, not received</th>'
      +'<th style="width:116px" title="Received, and not moved on">Received, not forwarded</th>'
      +'<th style="width:84px" title="Started today, with yesterday beneath">Raised</th>'
      +'<th style="width:84px" title="Finished today, with yesterday beneath">Closed</th>'
      +'<th style="width:92px" title="Reverts and send-backs — the work going backwards. Today, with yesterday beneath">Reverted</th>'
    +'</tr></thead><tbody>'
    +rows.map(function(r){
        /* The three backlog figures open a step-level breakdown. A count on its own says there is
           a problem; the breakdown says which step and whose desk, which is the only form of this
           anybody can act on. A zero isn't clickable — there'd be nothing behind it. */
        const cell=function(n,state){
          const v=Number(n||0);
          if(!v) return '<td style="color:var(--slate)">0</td>';
          const open=USB_WF_OPEN.has(r.flow_id+'|'+state);
          return '<td class="usb-wf-cell'+(open?' open':'')+'" style="'+warn(v)+'" '
            +'onclick="usbToggleWfStuck('+r.flow_id+',\''+state+'\')" '
            +'title="Show which step these are sitting on">'+v
            +'<i class="fa-solid fa-chevron-'+(open?'down':'right')+'" style="font-size:9px;margin-left:5px;opacity:.6"></i></td>';
        };
        const row='<tr><td><b>'+esc(r.workflow)+'</b></td>'
          +'<td>'+Number(r.live_instances||0)+'</td>'
          +cell(r.awaiting_receipt,'awaiting')
          +cell(r.fwd_not_received,'fwd')
          +cell(r.in_hand_not_forwarded,'inhand')
          +ty(r.raised_today,r.raised_yesterday,false)
          +ty(r.closed_today,r.closed_yesterday,false)
          // Work going backwards is the one of the three worth colouring: raising and closing are
          // the workflow doing its job, a revert is somebody having to do theirs again.
          +ty(r.reverted_today,r.reverted_yesterday,true)
          +'</tr>';
        return row+usbWfStuckRowsHtml(r);
      }).join('')
    +'</tbody></table></div></div>';
}
const USB_WF_OPEN=new Set();
let USB_WF_CACHE={};
/* The expanded breakdown under a workflow row. Mirrors the feature drill-down: load once per
   workflow+state, cache it, and re-render from cache after that. */
function usbWfStuckRowsHtml(r){
  const states=[['awaiting','Awaiting receipt'],['fwd','Forwarded, not received'],['inhand','Received, not forwarded']];
  return states.filter(function(s){ return USB_WF_OPEN.has(r.flow_id+'|'+s[0]); }).map(function(s){
    const rows=USB_WF_CACHE[r.flow_id+'|'+s[0]];
    let inner;
    if(rows===undefined){
      inner='<span style="color:var(--slate);font-size:12.5px"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</span>';
    }else if(!rows.length){
      inner='<span style="color:var(--slate);font-size:12.5px">Nothing sitting in this state.</span>';
    }else{
      inner='<table class="tbl" style="width:100%;margin:0"><thead><tr>'
        +'<th style="width:54px">Step</th><th>Name</th><th style="width:88px">Instances</th>'
        +'<th>With</th><th style="width:110px">Oldest</th></tr></thead><tbody>'
        +rows.map(function(x){
            const who=(x.who||[]).join(', ')+(Number(x.owners||0)>(x.who||[]).length
              ? ' and '+(Number(x.owners)-(x.who||[]).length)+' more' : '');
            const d=Number(x.oldest_days||0);
            return '<tr><td style="color:var(--slate)">'+Number(x.seq)+'</td>'
              +'<td><b>'+esc(x.step)+'</b></td>'
              +'<td><b>'+Number(x.instances||0)+'</b></td>'
              +'<td style="font-size:12px">'+esc(who||'—')+'</td>'
              +'<td style="'+(d>=2?'color:#b45309;font-weight:700':'color:var(--slate)')+'">'+d+' day'+(d===1?'':'s')+'</td></tr>';
          }).join('')
        +'</tbody></table>';
    }
    return '<tr class="usb-users-row"><td colspan="8"><div class="usb-users-wrap" style="padding:10px 12px">'
      +'<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--slate);margin-bottom:7px">'
        +esc(r.workflow)+' &middot; '+s[1]+'</div>'
      +inner+'</div></td></tr>';
  }).join('');
}
window.usbToggleWfStuck=async function(flowId,state){
  const key=flowId+'|'+state;
  if(USB_WF_OPEN.has(key)){ USB_WF_OPEN.delete(key); dcRepaint(); return; }
  USB_WF_OPEN.add(key); dcRepaint();
  if(USB_WF_CACHE[key]!==undefined) return;
  try{
    const {data,error}=await sb.rpc('erp_usability_workflow_stuck_steps',{p_flow_id:flowId,p_state:state});
    if(error)throw error;
    USB_WF_CACHE[key]=data||[];
  }catch(e){ USB_WF_CACHE[key]=[]; }
  dcRepaint();
};
/* TRANSCRIPTION HEALTH — the five call figures, on the Daily Checks page.
   Like workflow health these are measurements, not usage: how many of yesterday's calls the
   nightly pass transcribed, and how well what the rep typed into the CRM matched what was
   actually said. The RPC's comment carries the definitions.
   The one block on this page that cannot be live, so it is the one block that prints its own age:
   the pass starts about 00:30 IST and writes nothing after it finishes, and until it runs again
   these five figures are exactly as fresh as the moment it stopped. */
function usbTranscriptionHealthHtml(){
  const rows=DC.tr;
  if(!rows||!rows.length) return '';
  const num=function(n){ return Number(n).toLocaleString('en-IN'); };
  /* Rates keep the decimal even when it is .0, so a column reading 95.5 / 80.0 / 100.0 lines up
     instead of 95.5 / 80 / 100. */
  const show=function(v,pct){
    if(v===null||v===undefined) return '—';
    return pct ? Number(v).toFixed(1)+'%' : num(v);
  };
  /* Movement against yesterday rather than a pass mark. There is no agreed figure at which pitch
     accuracy becomes "bad", and inventing one here would put a number in people's mouths that
     nobody set; which way it moved overnight is a fact. So the arrow carries the colour and the
     percentage is left to speak for itself. */
  const move=function(r){
    const a=r.today, b=r.yesterday;
    if(a===null||a===undefined||b===null||b===undefined) return '';
    const d=Math.round((Number(a)-Number(b))*10)/10;
    if(!d) return '<span style="color:var(--slate);font-size:11.5px">level</span>';
    /* Only the quality rates get a verdict colour. Call volume moving is a fact about the selling
       day — 19 fewer calls is not a fault anybody introduced overnight, and painting it amber
       would teach people to ignore the colour on the rows where it means something. */
    const better=(d>0)===(r.higher_is_better!==false);
    const ink=r.is_pct===false?'var(--slate)':(better?'#15803d':'#b45309');
    const arrow=d>0?'▲':'▼';
    return '<span style="color:'+ink+';font-weight:700;font-size:11.5px">'
      +arrow+' '+Math.abs(d)+(r.is_pct?' pts':'')+'</span>';
  };
  /* WHEN THE PASS LAST WROTE.
     last_run is the newest row the pass produced, in either table it writes. If that is today, the
     run landed and the time is all a reader needs. If it is not today the pass did not run this
     morning, which IS the check failing — so the line gives the date rather than a bare clock
     time, which could be read as "a few hours ago", and it is amber rather than grey. */
  const run=(rows[0]&&rows[0].last_run)?new Date(rows[0].last_run):null;
  const ist=function(d,opt){ opt=opt||{}; opt.timeZone='Asia/Kolkata'; return d.toLocaleString('en-IN',opt); };
  let runNote, runInk='var(--slate)';
  if(!run||isNaN(run.getTime())){
    runNote='The pass has not written anything yet'; runInk='#b45309';
  }else{
    const sameDay=ist(run,{day:'2-digit',month:'2-digit',year:'numeric'})
                 ===usbIstNow().toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'});
    runNote=sameDay
      ? 'Pass last wrote at '+ist(run,{hour:'2-digit',minute:'2-digit'})+' this morning'
      : 'Pass last wrote on '+ist(run,{day:'numeric',month:'short'})+' — it has not run since';
    if(!sameDay) runInk='#b45309';
  }
  return '<div class="card" style="margin-bottom:14px">'
    +'<div class="card-pad" style="padding-bottom:10px">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'
        +'<div class="sec-title" style="margin:0"><i class="fa-solid fa-microphone-lines" style="color:#b8902f"></i> Transcription health</div>'
        +'<div style="font-size:12px;color:'+runInk+(runInk==='var(--slate)'?'':';font-weight:700')+'">'
          +'<i class="fa-regular fa-clock" style="margin-right:5px"></i>'+esc(runNote)+'</div>'
      +'</div>'
      /* Stated plainly because it is the one thing about this table that surprises people: the
         pass runs overnight, so today's column is yesterday's selling. */
      +'<div style="font-size:12px;color:var(--slate);margin-top:3px">The only figures here that are not live. The overnight pass grades the previous day\'s calls, so &ldquo;today&rdquo; is the run that finished this morning. An empty column means it did not run.</div>'
    +'</div>'
    +'<div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr>'
      +'<th>Check</th><th style="width:92px">Today</th><th style="width:92px">Yesterday</th>'
      +'<th style="width:96px">Movement</th>'
      +'<th style="width:112px" title="The calls this could actually be judged on — the rest gave the grader nothing to go on">Judged on</th>'
    +'</tr></thead><tbody>'
    +rows.map(function(r){
        const pct=r.is_pct!==false;
        /* A count of zero here means the overnight pass produced nothing, which is the check
           failing rather than a quiet day; percentages are left to the movement column. */
        const zero=!pct&&!Number(r.today||0);
        /* The base is printed beside every rate because they differ so much between rows — pitch
           was judged on 70 calls this morning and the follow-up date on 37. A reader who sees
           100% needs to be able to see 37 without asking anyone. */
        const base=r.today_of===null||r.today_of===undefined
          ? '<span style="color:var(--slate)">—</span>'
          : '<b>'+num(r.today_of)+'</b><span style="color:var(--slate);font-size:11.5px"> calls</span>'
            +(r.yesterday_of!==null&&r.yesterday_of!==undefined
               ? '<span style="color:var(--slate);font-size:11.5px"> (was '+num(r.yesterday_of)+')</span>' : '');
        return '<tr><td><b>'+esc(r.label)+'</b>'
            +(r.detail?'<div style="color:var(--slate);font-size:11.5px;margin-top:2px">'+esc(r.detail)+'</div>':'')
          +'</td>'
          +'<td style="'+(zero?'color:#b45309;font-weight:700':'font-weight:700')+'">'+show(r.today,pct)+'</td>'
          +'<td style="color:var(--slate)">'+show(r.yesterday,pct)+'</td>'
          +'<td>'+move(r)+'</td>'
          +'<td>'+base+'</td></tr>';
      }).join('')
    +'</tbody></table></div></div>';
}
/* THE FLAGGED FEATURES.
   A handful of features are looked at every morning; the rest are read when somebody asks a
   question. Those few are flagged in erp_feature_catalog.daily_check and gathered here, grouped by
   the module they belong to.

   TODAY FIRST, THIRTY DAYS AS CONTEXT. These rows used to carry the thirty-day total alone, which
   on a page read every morning said nothing: "Create task — 99 uses" is the same sentence it was
   yesterday and will be tomorrow, and no amount of staring at it reveals whether a task has been
   created today. Today's count leads now; the thirty-day figure and the activity band keep their
   own column, because they are what says whether a quiet day is unusual for this feature at all. */
function usbDailyChecksHtml(rows,heading){
  const picks=rows||[];
  if(!picks.length) return '';
  return '<div class="card usb-daily" style="margin:16px 0 18px">'
    +'<div class="card-pad" style="padding-bottom:10px">'
      +'<div class="sec-title" style="margin:0"><i class="fa-solid fa-folder-open" style="color:#b8902f"></i> '+esc(heading||'Daily checks')+'</div>'
    +'</div>'
    +'<div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr>'
      +'<th>Feature</th>'
      +'<th style="width:104px" title="Uses so far today, in IST">Today</th>'
      +'<th style="width:104px">Yesterday</th>'
      +'<th style="width:124px" title="The last time anybody used it, however long ago">Last used</th>'
      +'<th style="width:104px" title="The longer view — uses and people over the past 30 days">Last 30 days</th>'
      +'<th style="width:116px">Activity</th>'
    +'</tr></thead><tbody>'
    +picks.map(function(r){
        const s=usbBandStyle(r.band);
        const open=USB_FEAT_OPEN.has(r.feature_key);
        const today=Number(r.today_uses||0), yday=Number(r.yday_uses||0);
        /* The drill-down is today's list of who used it, so a feature nobody has touched today has
           nothing to expand into. (The Usability page still opens the same feature over whatever
           range you choose there — this page only ever answers for today.) */
        const clickable=today>0;
        const chev=clickable
          ? '<span class="usb-feat-chev'+(open?' open':'')+'"><i class="fa-solid fa-chevron-right"></i></span>'
          : '<span class="usb-feat-chev" style="visibility:hidden"><i class="fa-solid fa-chevron-right"></i></span>';
        const people=function(n){
          const v=Number(n||0);
          return v?('<div style="font-size:11px;color:var(--slate);margin-top:2px;font-weight:400">'+v+' '+(v===1?'person':'people')+'</div>'):'';
        };
        /* NOTHING YET TODAY IS ONLY WORTH FLAGGING IF SOMETHING NORMALLY HAPPENS.
           A plain amber zero on every row would be crying wolf at nine in the morning, and on the
           features nobody has ever used it would be amber for ever. It is amber only where the
           same check ran yesterday — that is the row where today's silence is a change rather
           than the usual state of affairs. */
        const quiet=!today&&yday>0;
        const todayCell=today
          ? '<b>'+today.toLocaleString('en-IN')+'</b>'+people(r.today_users)
          : '<span style="'+(quiet?'color:#b45309;font-weight:700':'color:var(--slate)')+'">'+(quiet?'none yet':'0')+'</span>';
        /* Last used carries the clock when it is today. On every other row the date is the whole
           answer, but "today" beside a count of 3 leaves open whether that was at 9am or a minute
           ago, which on a page that refreshes itself is exactly the difference being watched. */
        const lu=r.last_used?new Date(r.last_used):null;
        let lastTxt='—';
        if(lu&&!isNaN(lu.getTime())){
          const sameDay=lu.toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'2-digit',year:'numeric'})
                       ===usbIstNow().toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'});
          lastTxt=sameDay
            ? 'Today '+lu.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'})
            : fmtDate(r.last_used);
        }
        const row='<tr class="'+(clickable?'usb-feat-row':'')+'"'
          +(clickable?' onclick="usbToggleFeature(\''+escJs(r.feature_key)+'\')"':'')+'>'
          +'<td>'+chev+esc(r.feature)
            +'<span style="font-size:11px;color:var(--slate);margin-left:8px">'+esc(r.tab)+'</span></td>'
          +'<td>'+todayCell+'</td>'
          +'<td style="color:var(--slate)">'+(yday?('<b style="font-weight:600">'+yday.toLocaleString('en-IN')+'</b>'+people(r.yday_users)):'0')+'</td>'
          +'<td style="color:var(--slate);font-size:12px">'+esc(lastTxt)+'</td>'
          +'<td style="color:var(--slate)">'+Number(r.uses||0).toLocaleString('en-IN')+people(r.users)+'</td>'
          +'<td><span class="badge" style="background:'+s.bg+';color:'+s.ink+';white-space:nowrap">'+esc(r.band)+'</span></td></tr>';
        return row+(open?usbFeatureUsersRowHtml(r,6):'');
      }).join('')
    +'</tbody></table></div></div>';
}
/* The sub-row a clicked feature expands into: who actually used it, most recent first. Loads once
   per feature per filter set (usbLoad clears the cache on any range/person change) and is cached
   after that, so re-collapsing and re-expanding the same feature costs nothing more. On Daily
   Checks the cache is instead refreshed with the rest of the page each minute, because there the
   range is today and a list fetched twenty minutes ago is missing twenty minutes of it.
   cols is the width of the table this row has to span — five on Usability, six on Daily Checks,
   which has today and yesterday where the other has one count. */
function usbFeatureUsersRowHtml(r,cols){
  const cached=USB_FEAT_CACHE[r.feature_key];
  let inner;
  if(cached===undefined){
    inner='<div class="usb-users-wrap"><span style="color:var(--slate);font-size:12.5px"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</span></div>';
  }else if(!cached.length){
    inner='<div class="usb-users-wrap"><span style="color:var(--slate);font-size:12.5px">Nobody used this '
      +(usbDrillIsToday()?'today':'in the selected range')+'.</span></div>';
  }else{
    inner='<div class="usb-users-wrap">'
      +cached.map(function(u){
        return '<div class="usb-user-line usb-user-clickable" onclick="usbOpenUserEvents(\''+escJs(r.feature_key)+'\',\''+escJs(u.email)+'\',\''+escJs(r.feature)+'\')" title="See every individual use">'
          +'<span class="usb-user-name">'+esc(nameOf(u.email))+'</span>'
          +'<span class="usb-user-meta">'+u.uses+' use'+(u.uses===1?'':'s')+' · last '+esc(fmtDate(u.last_used))+' <i class="fa-solid fa-chevron-right" style="font-size:9px;color:var(--slate-2);margin-left:6px"></i></span></div>';
      }).join('')
    +'</div>';
  }
  return '<tr class="usb-users-row"><td colspan="'+(cols||5)+'">'+inner+'</td></tr>';
}
/* WHICH DATES A DRILL-DOWN COVERS.
   The list a reader gets by clicking a row has to be the people behind the number they clicked.
   On Usability that number is the chosen date range; on Daily Checks every figure is today's, so
   handing back thirty days of names there would answer a question nobody asked and quietly
   contradict the count sitting next to it. */
function usbDrillIsToday(){ return typeof PAGE!=='undefined'&&PAGE==='daily_checks'; }
function usbDrillRange(){
  if(usbDrillIsToday()){ const d=dcToday(); return {from:d,to:d}; }
  return usbCurrentRange();
}
// Bumped on every open and checked after each round trip below, so a slower request for a feature
// you have since clicked away from can never win a race against a faster one that came after it and
// paint its (wrong) data into the modal you are now actually looking at.
let USB_EV_TOKEN=0;
/* The "66 uses" line on its own answers nothing management would actually ask next - when, how
   often in a day, whether it tapered off. This is that: every individual event behind the count,
   newest first, for exactly this person/feature/range. */
window.usbOpenUserEvents=async function(featureKey,email,featureLabel){
  const myToken=++USB_EV_TOKEN;
  const r=usbDrillRange();
  openModal(
    '<div class="modal-head"><h3><i class="fa-solid fa-list-check" style="color:#7c3aed"></i> '+esc(nameOf(email))+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body"><div id="usbEvWrap"><div class="loader"><div class="spin"></div></div></div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>',
    'lg'
  );
  let rows=[], err=null;
  try{
    const {data,error}=await sb.rpc('erp_usability_feature_user_events',{p_feature_key:featureKey,p_email:email,p_from:r.from,p_to:r.to});
    if(error)throw error;
    rows=data||[];
  }catch(e){ err=(e&&e.message)||String(e); }
  if(myToken!==USB_EV_TOKEN) return;   // superseded by a newer drill-down while this was in flight
  const wrap=$('usbEvWrap'); if(!wrap)return;   // closed before the round trip finished
  if(err){ wrap.innerHTML='<div class="card card-pad empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load events</div><p>'+esc(err)+'</p></div>'; return; }
  /* The server hands back at most 500 of these. Printing rows.length as "uses" without saying so
     meant a heavy user's row reading 1,200 opened onto a panel headed "500 uses" - two numbers for
     one thing, with nothing to say which was right. The activity log next door already owns up to
     its own 1,000 cap; this one now does the same. */
  const capNote=(rows.length>=500)?' (showing the most recent 500)':'';
  const head='<p style="color:var(--slate);font-size:13px;margin:0 0 14px"><b>'+esc(featureLabel||'')+'</b> · '+rows.length+' use'+(rows.length===1?'':'s')+capNote+' · '+esc(fmtDate(r.from))+' – '+esc(fmtDate(r.to))+'</p>';
  if(!rows.length){ wrap.innerHTML=head+'<div class="card card-pad empty" style="padding:24px;text-align:center;color:var(--slate)">No individual events found in this range.</div>'; return; }
  // The 4th column was Project, and it was blank on nearly every row - only 13 of 896 tasks have a
  // project (tag) set at all, so on the Tasks features it never said anything. What a reader of
  // "Create task" actually wants next to the task's name is WHO it went to, which the event now
  // captures as meta.assignee. Read from meta rather than the project column, and left out of
  // Details so it appears once, in its own column.
  /* Every row here is the same feature, so the last column can be named for exactly what that
     feature's work is about - "Unit" on an inspection, "Assigned to" on a task. */
  /* A feature that has nothing to put in a column does not get the column. Some screens are only
     looked at - the Scoreboard and the Archive have no record behind them, nobody they went to and
     nothing they are about - so a Details and a last column would be two permanently empty cells
     taking width from the two that do say something. Better a narrow honest table than a wide one
     padded with dashes. */
  const col4=usbCol4(featureKey);
  const showCol4=!!col4.header, showDetails=!col4.hideDetails;
  /* Times used is asked for per feature (col4.timesUsed) rather than shown on all of them. It can
     never be blank, but "never blank" is not the same as "worth a column": on a feature somebody
     opens forty times a week it is just a fast-climbing number beside the row it belongs to. It
     earns its place where the question is whether the thing gets RE-used - which is the whole
     point of a payment destination the portal offers to remember for you. */
  const showTimes=!!col4.timesUsed;
  /* "Times used" — how many times this person had used this feature, counting this one. So the row
     reads as a running tally: 1 on the day they found it, 12 by the time it is part of their week.
     Named for what the number IS rather than "Use #", which made the reader work out whether it
     was a total, a position or an id before it told them anything.

     Unlike every other column here it can never be blank - it is the row's own position in the
     person's history, not something a feature had to remember to capture, so it works even on the
     rows the historical backfill left with no meta at all. That is what makes it available to any
     feature that wants it; whether a feature wants it is a separate question, answered above.

     Counted over their whole history server-side, not over the rows on screen, so
     narrowing the date range does not restart it at 1. */
  const body='<div class="card qc-table-card" style="padding:0"><div style="overflow-x:auto;max-height:440px"><table class="tbl"><thead><tr><th>When</th><th>Action</th>'
    +(showDetails?('<th>'+esc(col4.detailsHeader||'Details')+'</th>'):'')
    +(showCol4?('<th>'+esc(col4.header)+'</th>'):'')
    +(showTimes?('<th title="How many times this person had used this feature, counting this one — across their whole history, not just the dates shown">Times used</th>'):'')
    +'</tr></thead><tbody>'
    +rows.map(function(e){
      const dt=new Date(e.occurred_at);
      /* Seconds, not just the minute. Three separate actions eleven and fourteen seconds apart all
         printed as "07:43 pm", which reads as the same row repeated and was reported as duplicate
         data. The clock is the only thing that tells two real actions apart here. */
      const when=dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})+' · '+dt.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      // Only what the column ACTUALLY printed is held back from Details. Passing the whole key list
      // hid fields the column then had no room for - "Open a month" lost its month from Details to a
      // column that never showed it, which is how a working row ended up blank at both ends.
      const col=usbCol4Value(e.meta, col4.keys);
      /* A first use is worth seeing at a glance - it is the row that says somebody found the
         feature - so it is marked rather than left as a bare 1 among the 40s. */
      const useN=(e.use_n==null)?'':String(e.use_n);
      const firstUse=String(e.use_n)==='1';
      const useLabel=firstUse?'1st time':useN;
      return '<tr><td>'+esc(when)+'</td><td style="text-transform:capitalize">'+esc(e.action||'')+'</td>'
        +(showDetails?('<td>'+usbMetaHtml(e.meta,col.used)+'</td>'):'')
        +(showCol4?('<td style="color:var(--slate)">'+esc(col.text||'—')+'</td>'):'')
        +(showTimes?('<td style="white-space:nowrap;font-variant-numeric:tabular-nums'+(firstUse?';color:#15803d;font-weight:600':';color:var(--slate)')+'">'
          +esc(useLabel)+'</td>'):'')
      +'</tr>';
    }).join('')
    +'</tbody></table></div></div>';
  wrap.innerHTML=head+body;
};
// "Customized per feature" without a hand-written renderer per feature: what shows up here is
// whatever that feature chose to capture (a task's title, a search query, who a claim went to) -
// features that capture nothing yet just show a dash, same as before this existed.
// snake_case/camelCase key -> "Title Case" label, e.g. due_date -> "Due Date". Meta keys are
// written by whichever feature captured them, so this has to cope with either naming style
// rather than assume one - a raw "Due_date:" or "dueDate:" reads as unfinished, not "nice".
function usbMetaLabel(k){
  return String(k).replace(/_/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2')
    .replace(/\w\S*/g, function(w){ return w.charAt(0).toUpperCase()+w.slice(1).toLowerCase(); });
}
// A one-time historical backfill stamped {ref:'<table>.<action>:<id>', backfill:true} onto
// thousands of old events across nearly every feature - an internal pointer back to the row it
// was reconstructed from, not a real captured detail (no title, no assignee, nothing a person
// would recognise). It was never meant to be user-facing; showing it read as corrupted, garbled
// data rather than the honest "nothing was captured for this one" that an old event actually is.
// 'assignee' is not internal - it is shown, but in its own "Assigned to" column beside Details
// rather than repeated inside it.
/* time_spent and showing belong to a column, never to Details. Left out of this list they leaked
   into every view row as "Time Spent: 13s · Showing: 44 rows" - clutter beside the thing the row is
   actually about, and on screens whose column is something else entirely it was the only thing in
   Details at all. A column that wants either of them asks for it by name; nothing else prints it. */
const USB_META_INTERNAL_KEYS=['ref','backfill','assignee','time_spent','showing'];
/* ---- The drill-down's last column ------------------------------------------------------------
   "Assigned to" only means anything where something is handed to somebody, which is Accountability
   and nowhere else. Everywhere else it was a column of dashes taking up the width that the one
   fact worth knowing should have had - and which fact that is depends entirely on what the module
   does. An inspection happens to a flat; a document lives in a folder; a call belongs to a lead.
   So the column is chosen per module and tab, and named for what it holds.
   Keyed by module first, and by 'module.tab' where one module covers genuinely different things
   (Legal's Documents, MIS and Advocates are three different subjects under one roof). The most
   specific match wins.
   A module is only listed here once its features actually capture the field - adding the column
   before the capture would just move the blank from one column to another, which is the whole
   mistake this is meant to end. Accountability keeps 'Assigned to'; the rest follow as their
   capture lands. */
const USB_COL4={
  /* --- whole modules ------------------------------------------------------------------------ */
  'tasks':                {header:'Assigned to',       keys:['assignee']},
  'inspection':           {header:'Unit',              keys:['unit','category']},
  /* Four of the five Document Library features are named "View ..." and are exactly that - a tab
     that opens a list of documents. The Department column was never once filled on any of them:
     the department and folder only exist while somebody is INSIDE a department library picking a
     folder, which is the fifth feature, not these four. So the module drops both columns, and the
     one feature where a choice is actually made keeps its own, below. */
  'documents':            {header:null, keys:[], hideDetails:true},
  'documents.department_library.browse_filter_by_category_folder':
                          {header:'Department · Folder', keys:['department','folder'], hideDetails:true},
  /* Every call-level feature runs through usbCallMeta, and what it puts in Details is the name on
     the call record - the customer who was on the phone, not a member of staff. "Details" gave no
     hint of that; the header now says whose name it is. The lead is dropped from the fourth column
     because it IS that same name - printing it twice on one row says nothing the first mention
     didn't already say. */
  'transcription':        {header:'Project', keys:['project'], detailsHeader:'Customer name'},
  /* The language IS the click here, so it gets the column and the header that names it. Left in the
     module's key list it would have printed under a header reading "Project", which is the same
     mismatch as a month sitting under "Decision". The call itself is still named, in Details. */
  'transcription.call_detail.switch_transcript_language':
                          {header:'Language', keys:['language'], detailsHeader:'Customer name'},
  'network':              {header:'Range',             keys:['range']},
  /* Every number on these screens is "for this period, from this source", so that pair is the one
     fact each action here needs - and it is the whole fact, which leaves Details with nothing to
     add. Three columns, none of them padding. */
  'campaigns':            {header:'Period · Source',   keys:['period','source'], hideDetails:true},
  'recruitment':          {header:'Position',          keys:['position','department']},
  'procurement':          {header:'Vendor',            keys:['vendor']},
  'postsales':            {header:'Status',            keys:['status','replacements']},
  'competitors':          {header:'Competitor · Range',keys:['competitor','range','media']},
  'organic':              {header:'Period · Network',  keys:['period','network','kind']},

  /* --- tabs that are about something different from the rest of their module ----------------- */
  // Legal is three different subjects under one roof
  'legal.mis':            {header:'Case · Court',      keys:['case_no','court']},
  /* A causelist is not about one case, so MIS's "Case · Court" was the wrong heading for it - what
     it is about is the window it covers and how many matters fell in that window. Details comes off
     because those two facts are the whole of it. */
  'legal.mis.export_causelist':
                          {header:'Range · Cases', keys:['range','cases'], hideDetails:true},
  'legal.mis.view_causelist':
                          {header:'Range · Cases', keys:['range','cases'], hideDetails:true},
  /* Deleting one case names it; deleting several leaves no single case number to name, so the
     column carries the count and Details lists which ones. Same header either way - the reader is
     asking the same question. */
  'legal.mis.delete_case_s':
                          {header:'Case · Court', keys:['case_no','court','cases']},
  'legal.actions':        {header:'Case · Court',      keys:['case_no','court']},
  'legal.advocates':      {header:'Court',             keys:['court','case_type']},
  'legal.documents':      {header:'Folder',            keys:['folder','category','department']},
  // HR's three tabs hold three different things: a candidate's interview, a resume for a role, and
  // a month's requisitions. 'position' fitted only the first of them.
  'hr':                   {header:'Position',          keys:['position']},
  'hr.resumes':           {header:'Role',              keys:['role','position']},
  'hr.interview_qs':      {header:'Time spent', keys:['time_spent']},
  // A test has a name and nothing else; the name is already the Details.
  'recruitment.tests':    {header:'Time spent', keys:['time_spent']},
  'procurement.quote_comp':{header:'Category',         keys:['category','replacements']},
  // Asking the assistant carries the question; raising a ticket carries its category.
  /* Help Desk, feature by feature. Asking the assistant carries the question - but the question is
     already the Details, printed bare as the thing the row is about, so a Question column beside it
     said the same words twice. Opening the chat and opening My Tickets are screen-opens with no
     question and no ticket behind them. Raising a ticket is the one action here with two facts to
     its name: the subject in Details, the department it went to in the column. */

  /* --- single features whose subject is unlike anything else in their tab -------------------- */
  /* Monthly Update is the case that proved per-tab was not enough. Approve/reject and close/reopen
     are decisions; opening a month is a month; searching is a typed query. One header across all
     three put the month under "Decision" AND took it out of Details, leaving a row that had been
     working blank at both ends. Each is named for its own subject now.
     "Open a month" keeps the month in Details rather than in the column: the When column already
     says the date, so the month only earns its place when it is NOT the current one - somebody
     opening June's record in September - and Details is where that belongs. */
  /* Workflow splits by what the click actually did. Four of its features hand the step to somebody,
     and for those the person is the point. The rest - receiving, printing, marking done, posting an
     update, editing or deleting an instance - go to nobody, which is why "Assigned to" was blank on
     almost all of them. What they DO have is how long the work had been waiting, and on this portal
     that is the number worth reading: 410 measurable steps, 45.9 hours average, 204 of them over a
     day. A "Step" column was the other candidate and is wrong - Details already prints the step. */
  'tasks.workflow':                               {header:'Waited',  keys:['waited']},
  /* The payment QR is not a step, so it can never have a "Waited" - it was a dash on both of the
     feature's events and would be a dash on every future one. It gets no promoted column at all.
     Details instead carries HOW the payment destination was given - a QR image, or an id reused
     off the remembered list - which is the one question this feature exists to settle. Named
     "Given as" because the cell holds one specific thing and the reader should not have to work
     that out. The file name was the first attempt and was dropped: eighteen of the twenty QR files
     on record are WhatsApp camera-roll names or a bare UUID. */
  'tasks.workflow.upload_and_auto_remember_a_payment_qr_upi_id':
                                                  {header:null, keys:[], detailsHeader:'Given as',
                                                   timesUsed:true},
  'tasks.workflow.forward_a_step':                {header:'Sent to', keys:['assignee']},
  'tasks.workflow.reject_send_a_step_back':       {header:'Sent to', keys:['assignee']},
  'tasks.workflow.revert_a_forwarded_step':       {header:'Sent to', keys:['assignee']},
  'tasks.workflow.start_a_new_instance':          {header:'Sent to', keys:['assignee']},
  'hr.monthly_update.approve_reject_requisition': {header:'Decision', keys:['decision']},
  'hr.monthly_update.close_reopen_hiring':        {header:'Decision', keys:['decision']},
  'hr.monthly_update.open_a_month':               {header:'Time spent', keys:['time_spent']},
  'hr.monthly_update.search_filter_positions':    {header:'Time spent', keys:['time_spent']},
  'hr.monthly_update.delete_rows_or_whole_month': {header:'Time spent', keys:['time_spent']},
  // An upload has no lead yet - the call does not exist until it has run - so it reports the files.
  /* The upload row is the one call-level feature whose Details is NOT just a name: it carries the
     recording, the outcome and the project together, and the recording is as often a file name as
     a person. So it keeps the plain "Details" header. The column carries the project, which every
     one of the 517 reconstructed uploads has, plus the file count a live upload adds - naming it
     "Files" alone had emptied all 517 of them, since a rebuilt row has no file count to give. */
  'transcription.all_calls.upload_call_recording_s':
                          {header:'Project · Files', keys:['project','files'], detailsHeader:'Details'},
  /* Filtering a list is not about one call, so there is no lead and no project to name - that
     column can never fill here. Details can and now does: since 12 Sep the click records which
     filter, or which dates. The 13 older rows predate that and are permanently blank; a filter
     leaves no trace anywhere else, so there is nothing to recover them from. */
  'transcription.all_calls.filter_calls_by_outcome_or_date': {header:null, keys:[]},

  /* --- screens you only look at -------------------------------------------------------------- */
  /* No record and nobody it went to, so the honest column is how much was in front of the person.
     Three Accountability tabs are here for the same reason: the Scoreboard, the Archive and the
     Calendar are things you read, not things you hand to anybody. Tasks, Meetings and Workflow
     keep "Assigned to". */
  // Two screens you only read. There is no record behind them, nobody they went to, and nothing
  // they are about - so both the Details and the last column would be permanently empty. Removed
  // rather than filled with something that only looks like an answer.
  'tasks.scoreboard':     {header:null, keys:[], hideDetails:true},
  'tasks.archive':        {header:null, keys:[], hideDetails:true},
  /* Six more of the same kind, found by reading their rows rather than their config: 214 uses
     between them and not one has ever put anything in either column.
     The three Tasks ones inherit "Assigned to" from the module, but regrouping a list assigns
     nothing to anybody - there is no person in the act at all, so it could never have filled.
     The three Calendar ones should have carried which view was open, and the helper for it has
     been live since 1684217 - yet "view" has never once been recorded on any of them. That is a
     real fault and worth chasing on its own; until it is chased, a header promising something the
     rows have never held is the thing to remove. */
  /* "Assigned to" is the Accountability default and it is right on the actions that hand a task to
     somebody - Create, Approve, Comment, Delegate all fill it 100%. These six are the ones it was
     inherited by and cannot fit, measured rather than guessed: zero assignee on every event any of
     them has ever produced.

     What each does carry is already in Details, which is why none of them loses anything by
     dropping the column - Search tasks has the query, the sub-task features have the item, and a
     narrower table of two honest columns beats a wide one padded with dashes.

     Edit task members/assignees is deliberately NOT in this list. It was, briefly - it is the
     feature that changes who a task is assigned to, and it recorded only the change ("added Ravi;
     removed Uma"), so Assigned to was empty on the one feature whose whole subject is assignment.
     The honest fix there was the capture, not the column: accEditMembersSave now writes the
     resulting member list as well, so it keeps the module's Assigned to and fills it. The single
     event from before that change will read as a dash, which is true - nothing recorded it. */
  'tasks.tasks.search_tasks':                                  {header:null, keys:[]},
  'tasks.tasks.add_checklist_sub_task_item':                   {header:null, keys:[]},
  'tasks.tasks.mark_sub_task_complete':                        {header:null, keys:[]},
  'tasks.tasks.delete_sub_task':                               {header:null, keys:[], hideDetails:true},
  'tasks.tasks.mark_all_notifications_as_read':                {header:null, keys:[]},
  'tasks.tasks.view_tasks_grouped_by_workflow':                {header:null, keys:[], hideDetails:true},
  'tasks.tasks.view_tasks_grouped_by_person':                  {header:null, keys:[], hideDetails:true},
  'tasks.tasks.view_tasks_grouped_by_tag':                     {header:null, keys:[], hideDetails:true},
  'tasks.calendar.view_month_week_day_calendar':               {header:null, keys:[], hideDetails:true},
  'tasks.calendar.see_tasks_meetings_and_legal_dates_in_one_view': {header:null, keys:[], hideDetails:true},
  'tasks.calendar.open_a_day_s_agenda_panel':                  {header:null, keys:[], hideDetails:true},
  // The Calendar is read four different ways and they are not interchangeable - a team living in
  // Day view needs a good agenda panel, one that only opens Month needs a good month grid, and the
  // report could not tell them apart. How long they stayed still shows in Details.
  'tasks.calendar':       {header:'View',       keys:['view']},
  'tasks.meetings':       {header:'Attendees',  keys:['attendees']},
  /* The one Home feature carries exactly one thing - how long the screen stayed open - and that is
     already the fourth column. time_spent is an internal key, so Details was printing a dash under
     a header on all 584 rows: a column whose entire content is the absence of content. */
  'dashboard':            {header:'Time spent', keys:['time_spent'], hideDetails:true},
  'projects':             {header:'Time spent', keys:['time_spent']},
  'video':                {header:'Time spent', keys:['time_spent']},
  /* CRM & Sales is one read-only screen - Daily Updates, which shows one day's rollup and lets a
     past day be reopened. Nothing is chosen, filtered or changed, so the only things an event
     could carry are the row count and how long the screen stayed open, neither of which answers a
     question anybody asks. When and Action say the whole truth here. */
  'crm':                  {header:null, keys:[], hideDetails:true},
  'scaling':              {header:'Time spent', keys:['time_spent']},
  'gtd':                  {header:'Time spent', keys:['time_spent']},
  'compliance':           {header:'Time spent', keys:['time_spent']},
  /* All four Assets & Maintenance tabs open a LIST - there is no feature that opens one asset or
     one ticket, and the screen has no clickable row at all, so there is no name to record. Nor is
     the screen reading the asset tables yet: it renders hardcoded rows, which is why it claims 311
     assets while ast_assets holds 40. Until a row can be opened, "viewed the register" is the whole
     truth and When and Action carry it. */
  'maintenance':          {header:null, keys:[], hideDetails:true},
  'inventory':            {header:'Time spent', keys:['time_spent']},
  'playbook':             {header:'Time spent', keys:['time_spent']},
  'finance':              {header:'Time spent', keys:['time_spent']},
  'accounts':             {header:'Time spent', keys:['time_spent']},

  /* ---- features that inherit a column they cannot fill -------------------------------------
     Each of these resolves, by module or by tab, to a column that is a dash on every single event
     it has ever produced - 66 features, 801 events, measured rather than assumed. They are the
     same shape of mistake in every case: the default is right for the module and wrong for the
     one feature, because what the module does and what the feature does are not the same thing.
     Inspection's Unit fits an inspection of a flat but not the console you filter it from; Legal's
     Case · Court fits editing a case but not searching for one; Workflow's Waited fits a step
     somebody received but not printing, editing or deleting an instance.

     The line is almost always the same: a feature that DOES something carries a subject, and a
     feature you only LOOK AT does not. Create task has an assignee, Search tasks never will.

     hideDetails is set only where Details is empty too, so what is left is never a row of two
     dashes - on the rest Details already carries the query, the item, the case number or the
     check, which is why none of them loses anything by giving up the column. */
  'tasks.meetings.join_a_meeting':                                     {header:null, keys:[]},
  'tasks.meetings.filter_meetings_by_group':                           {header:null, keys:[], hideDetails:true},
  'tasks.meetings.schedule_a_meeting_one_time_or_recurring':           {header:null, keys:[]},
  'tasks.meetings.start_stop_recording':                               {header:null, keys:[]},
  'tasks.meetings.save_meeting_wrap_up_summary':                       {header:null, keys:[]},
  // Uploading a recording for a meeting that wasn't recorded live: it carries the meeting title,
  // never an attendee list, so it must not inherit the tab's permanently-blank Attendees column.
  'tasks.meetings.add_a_recording_for_transcription':                  {header:null, keys:[]},
  'legal.mis.search_cases_incl_ai_semantic_search':                    {header:null, keys:[]},
  'legal.mis.filter_cases_by_hearing_date_range':                      {header:null, keys:[]},
  'legal.actions.view_search_filter_case_actions':                     {header:null, keys:[], hideDetails:true},
  'legal.advocates.search_advocates':                                  {header:null, keys:[], hideDetails:true},
  'legal.documents.search_sort_filter_documents':                      {header:null, keys:[]},
  'legal.documents.replace_document_version':                          {header:null, keys:[], hideDetails:true},
  'legal.documents.delete_document_s':                                 {header:null, keys:[], hideDetails:true},
  'competitors.overview.fetch_ads_from_meta_ad_library':               {header:null, keys:[], hideDetails:true},
  'competitors.overview.view_competitor_watchlist_and_stored_ads':     {header:null, keys:[], hideDetails:true},
  'competitors.overview.view_ad_detail':                               {header:null, keys:[]},
  'competitors.overview.add_competitor':                               {header:null, keys:[], hideDetails:true},
  'competitors.overview.rebuild_ad_media_previews':                    {header:null, keys:[], hideDetails:true},
  'competitors.overview.toggle_auto_sync_for_a_competitor':            {header:null, keys:[], hideDetails:true},
  'hr.monthly_update.close_reopen_hiring':                             {header:null, keys:[], hideDetails:true},
  'hr.monthly_update.edit_tracking_values':                            {header:null, keys:[], hideDetails:true},
  'hr.monthly_update.create_new_month_record':                         {header:null, keys:[], hideDetails:true},
  'hr.monthly_update.open_a_month':                                    {header:null, keys:[]},
  'hr.interview_tracker.search_filter_interviews':                     {header:null, keys:[], hideDetails:true},
  'hr.interview_qs.generate_ai_interview_guide':                       {header:null, keys:[]},
  'hr.h_s_candidates.search_filter_candidates':                        {header:null, keys:[], hideDetails:true},
  'hr.resumes.preview_download_resume':                                {header:null, keys:[], hideDetails:true},
  'hr.resumes.delete_resume_s':                                        {header:null, keys:[], hideDetails:true},
  'recruitment.descriptions.preview_download_job_description':         {header:null, keys:[]},
  'recruitment.descriptions.upload_job_description':                   {header:null, keys:[]},
  'recruitment.manpower_form.generate_jd_post_text_creative':          {header:null, keys:[], hideDetails:true},
  'recruitment.manpower_form.submit_requisition':                      {header:null, keys:[]},
  'recruitment.tests.preview_test_responses_scores':                   {header:null, keys:[]},
  'recruitment.tests.share_test_via_email':                            {header:null, keys:[]},
  'transcription.call_detail.switch_transcript_language':              {header:null, keys:[], hideDetails:true},
  'transcription.call_detail.add_delete_a_remark':                     {header:null, keys:[]},
  'transcription.deleted.restore_a_deleted_call_single_or_all':        {header:null, keys:[], hideDetails:true},
  'transcription.all_calls.download_call_report_or_copy_link':         {header:null, keys:[], hideDetails:true},
  'network.overview.filter_chart_by_date_range':                       {header:null, keys:[], hideDetails:true},
  'network.all_readings.filter_readings_by_date_range':                {header:null, keys:[]},
  'organic.overview.view_engagement_overview_by_type_and_page':        {header:null, keys:[], hideDetails:true},
  'campaigns.overview.drill_into_a_project_s_campaigns':               {header:null, keys:[], hideDetails:true},
  'postsales.adhoc.upload_document_for_adhoc_replacement':             {header:null, keys:[]},
  'postsales.adhoc.preview_a_document':                                {header:null, keys:[], hideDetails:true},
  'postsales.adhoc.download_all_documents_as_zip':                     {header:null, keys:[], hideDetails:true},
  'scaling.priorities_rocks.view_quarterly_rocks_progress':            {header:null, keys:[], hideDetails:true},
  'scaling.learning_hub.view_learning_resources_list':                 {header:null, keys:[], hideDetails:true},
  'scaling.meeting_rhythm.view_meeting_cadence_schedule':              {header:null, keys:[], hideDetails:true},
  'scaling.kpi_scoreboard.view_kpi_targets_vs_actuals':                {header:null, keys:[], hideDetails:true},
  'inspection.new_inspection.mark_item_ok_not_ok_n_a':                 {header:null, keys:[]},
  'inspection.new_inspection.submit_inspection':                       {header:null, keys:[]},
  'inspection.console.view_inspection_kpis_and_breakdowns':            {header:null, keys:[], hideDetails:true},
  'inspection.console.start_new_inspection':                           {header:null, keys:[], hideDetails:true},
  'inspection.console.filter_by_project_block_floor_flat_work_type':   {header:null, keys:[], hideDetails:true},
  'inspection.responses.open_and_edit_a_submission':                   {header:null, keys:[], hideDetails:true},
  'procurement.vendor_trends.view_spend_kpis_trend_charts':            {header:null, keys:[], hideDetails:true},
  'tasks.calendar.search_calendar_items':                              {header:null, keys:[]},
  'tasks.workflow.print_an_instance':                                  {header:null, keys:[]},
  'tasks.workflow.search_filter_the_tracker':                          {header:null, keys:[]},
  'tasks.workflow.post_an_update_comment_on_an_instance':              {header:null, keys:[]},
  'tasks.workflow.delete_an_instance':                                 {header:null, keys:[]},
  'tasks.workflow.edit_an_instance':                                   {header:null, keys:[]},
  'tasks.workflow.attach_a_file_to_an_update':                         {header:null, keys:[]},
  'tasks.workflow.create_a_new_workflow':                              {header:null, keys:[]},
  'tasks.workflow.edit_workflow_steps_owners':                         {header:null, keys:[]},
  'tasks.workflow.reopen_a_completed_instance':                        {header:null, keys:[], hideDetails:true},
  'tasks.workflow.delete_a_workflow':                                  {header:null, keys:[], hideDetails:true},
};
const USB_COL4_DEFAULT={header:'Assigned to', keys:['assignee']};
/* Most specific wins: the feature itself, then its tab, then its module.
   The per-feature level is not a refinement, it is the level this needed from the start. A tab
   holds features that are about completely different things - Monthly Update has "Approve / reject
   a requisition" (a decision), "Open a month" (a month) and "Search positions" (a typed query)
   sitting together - and one header across all three put the month under a column headed
   "Decision", which is worse than the dash it replaced. */
function usbCol4(featureKey){
  const k=String(featureKey||''), p=k.split('.');
  return USB_COL4[k] || USB_COL4[p[0]+'.'+p[1]] || USB_COL4[p[0]] || USB_COL4_DEFAULT;
}
/* Whatever of the chosen keys this particular event actually carries, in the order listed.
   Falls back to what was on the screen when none of them apply. That fallback matters more than it
   looks: a tab holds both kinds of feature at once - Tasks has "Delegate a task", which really does
   go to somebody, sitting beside "View tasks grouped by person", which goes to nobody at all. One
   header has to serve both, so the row that has no subject shows what the person was looking at
   instead of a dash. Only used when the primary keys give nothing, so it never dilutes a real
   answer. */
/* Whatever of the chosen keys this event actually carries, in the order listed - and nothing else.
   There used to be a fallback here: when none of the chosen keys applied it showed what was on the
   screen instead. That was a mistake, and a visible one - the Scoreboard printed "85 rows" under a
   column headed "Time spent", and the grouped-by views would have printed it under "Assigned to".
   A wrong label on real data is worse than an empty cell; the empty cell is at least honest about
   not knowing. A column now shows its own fact or shows nothing. */
function usbCol4Value(meta, keys){
  if(!meta || typeof meta!=='object' || !keys || !keys.length) return {text:'', used:[]};
  const out=[], used=[];
  keys.forEach(function(k){
    if(meta[k]!=null && String(meta[k]).trim()!==''){ out.push(String(meta[k]).trim()); used.push(k); }
  });
  return out.length ? {text:out.join(' · '), used:used} : {text:'', used:[]};
}
/* What the row is ABOUT is a name, and a name does not need labelling - "Title: Reimbursement"
   and "Workflow: Invoice Processing · Instance: New Bill Recording · Step: Bill Checking" read as
   a dump of fields rather than as the thing that happened. These keys are the names, so they are
   printed bare, in this order, ahead of everything else: the workflow, then which instance of it
   (#93 New Bill Recording), then which step. Everything a feature captured beyond the name - a
   due date, a search query, a route - still carries its label, because those DO need saying. */
const USB_META_NAME_ORDER=['workflow','instance','step','title','query'];
// extraSkip is whatever the last column is already showing for this row - printed once, in its own
// column, rather than twice on the same line.
function usbMetaHtml(meta, extraSkip){
  if(!meta || typeof meta!=='object') return '<span style="color:var(--slate-2)">—</span>';
  const has=function(k){ return meta[k]!=null && String(meta[k]).trim()!==''; };
  const named=[];
  USB_META_NAME_ORDER.forEach(function(k){
    if(!has(k)) return;
    // ref_no belongs to the instance it numbers, so it rides along with it rather than sitting on
    // its own as "Ref No: 93" - "#93 New Bill Recording" is how people say it.
    if(k==='instance' && has('ref_no')) named.push('#'+esc(String(meta.ref_no))+' '+esc(String(meta[k])));
    else named.push(esc(String(meta[k])));
  });
  // An instance with a number but no title still deserves its number shown.
  if(!has('instance') && has('ref_no')) named.push('#'+esc(String(meta.ref_no)));
  const skip=USB_META_INTERNAL_KEYS.concat(USB_META_NAME_ORDER, ['ref_no'], extraSkip||[]);
  const rest=Object.keys(meta).filter(function(k){ return skip.indexOf(k)===-1 && has(k); })
    .map(function(k){ return '<b style="font-weight:600">'+esc(usbMetaLabel(k))+':</b> '+esc(String(meta[k])); });
  const parts=named.concat(rest);
  return parts.length ? parts.join(' · ') : '<span style="color:var(--slate-2)">—</span>';
}
/* usbOpenUserEvents above is one feature's worth of one person's events. This is the same idea
   widened to everything they did, across every feature, in one chronological list — for when the
   question is "what has this person actually been doing", not "how many times did they use X". */
let USB_ACT_TOKEN=0;
window.usbOpenUserActivity=async function(){
  const email=USB.email; if(!email)return;
  const myToken=++USB_ACT_TOKEN;
  const r=usbCurrentRange();
  openModal(
    '<div class="modal-head"><h3><i class="fa-solid fa-list-ul" style="color:#7c3aed"></i> '+esc(nameOf(email))+' — full activity</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body"><div id="usbActWrap"><div class="loader"><div class="spin"></div></div></div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>',
    'xl'
  );
  let rows=[], err=null;
  try{
    const {data,error}=await sb.rpc('erp_usability_user_activity',{p_email:email,p_from:r.from,p_to:r.to});
    if(error)throw error;
    rows=data||[];
  }catch(e){ err=(e&&e.message)||String(e); }
  if(myToken!==USB_ACT_TOKEN) return;   // superseded by a newer request while this was in flight
  const wrap=$('usbActWrap'); if(!wrap)return;   // closed before the round trip finished
  if(err){ wrap.innerHTML='<div class="card card-pad empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load activity</div><p>'+esc(err)+'</p></div>'; return; }
  const capNote=(rows.length>=1000)?' (showing the most recent 1,000)':'';
  const head='<p style="color:var(--slate);font-size:13px;margin:0 0 14px">'+rows.length+' event'+(rows.length===1?'':'s')+capNote+' · '+esc(fmtDate(r.from))+' – '+esc(fmtDate(r.to))+'</p>';
  if(!rows.length){ wrap.innerHTML=head+'<div class="card card-pad empty" style="padding:24px;text-align:center;color:var(--slate)">No activity found in this range.</div>'; return; }
  /* Every row here is a DIFFERENT feature, so unlike the per-feature drill-down this column cannot
     be named for one subject. It shows whichever of those subjects the row happens to carry - the
     person a task went to, the flat an inspection was on - under one heading that covers both. */
  const body='<div class="card qc-table-card" style="padding:0"><div style="overflow-x:auto;max-height:560px"><table class="tbl"><thead><tr><th>When</th><th>Module</th><th>Tab</th><th>Feature</th><th>Action</th><th>Details</th><th>On / to</th></tr></thead><tbody>'
    +rows.map(function(e){
      const dt=new Date(e.occurred_at);
      /* Seconds, not just the minute. Three separate actions eleven and fourteen seconds apart all
         printed as "07:43 pm", which reads as the same row repeated and was reported as duplicate
         data. The clock is the only thing that tells two real actions apart here. */
      const when=dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})+' · '+dt.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      const col4=usbCol4(e.feature_key);
      const col=usbCol4Value(e.meta, col4.keys);
      const who=col.text||'—';
      return '<tr><td style="white-space:nowrap">'+esc(when)+'</td><td>'+esc(e.module_label||'—')+'</td><td>'+esc(e.tab||'—')+'</td><td>'+esc(e.feature||e.feature_key||'—')+'</td><td style="text-transform:capitalize">'+esc(e.action||'')+'</td><td>'+usbMetaHtml(e.meta,col.used)+'</td><td style="color:var(--slate)">'+esc(who)+'</td></tr>';
    }).join('')
    +'</tbody></table></div></div>';
  wrap.innerHTML=head+body;
};
window.usbToggleFeature=async function(key){
  if(USB_FEAT_OPEN.has(key)){ USB_FEAT_OPEN.delete(key); usbRerenderDetail(); return; }
  USB_FEAT_OPEN.add(key);
  usbRerenderDetail();
  if(!(key in USB_FEAT_CACHE)){
    const r=usbDrillRange();
    try{
      const {data,error}=await sb.rpc('erp_usability_feature_users',{p_feature_key:key,p_from:r.from,p_to:r.to,p_email:USB.email||null,p_department:USB.dept||null});
      if(error)throw error;
      USB_FEAT_CACHE[key]=data||[];
    }catch(e){ USB_FEAT_CACHE[key]=[]; }
    usbRerenderDetail();
  }
};
/* Daily Checks has no module detail pane. Its feature rows live in #dcBody, and routing their
   repaint through the Usability one meant $('usbDetailWrap') came back null and the function
   returned having drawn nothing — so a clicked row on that page expanded into silence, chevron
   and all, however long you waited. */
function usbRerenderDetail(){
  if(typeof PAGE!=='undefined'&&PAGE==='daily_checks'){ dcRepaint(); return; }
  const box=$('usbDetailWrap'); if(!box||!USB.moduleId)return;
  box.innerHTML=usbModuleDetailHtml(USB.moduleId);
}
VIEWS.usability=async function(v,seg){
  setCrumb(['Administration','Usability']);
  loader(v);
  await usbLoad();
  if(USB.rows===null){
    v.innerHTML=mHead('fa-chart-simple','#7c3aed','Usability')
      +'<div class="card card-pad empty" style="margin-top:16px;padding:40px"><i class="fa-solid fa-lock"></i>'
      +'<div>'+esc(USB.err||'Could not load usage')+'</div></div>';
    return;
  }
  const moduleId=seg&&seg[0]?decodeURIComponent(seg[0]):null;
  USB.moduleId=moduleId;
  if(moduleId){ v.innerHTML=mHead('fa-chart-simple','#7c3aed','Usability')+'<div id="usbDetailWrap">'+usbModuleDetailHtml(moduleId)+'</div>'; return; }
  const rows=USB.rows;
  const totalUses=rows.reduce(function(a,r){return a+Number(r.uses||0);},0);
  const used=rows.filter(function(r){return Number(r.uses||0)>0;}).length;
  /* Said plainly rather than left to be inferred from a screen of zeros: until the portal reports
     what people click, every feature here reads Inactive because nothing has been recorded, which
     is not the same as nobody using it. */
  const notice=totalUses===0
    ? '<div class="card card-pad" style="margin-top:14px;background:#fffbeb;border-color:#fde68a;font-size:13.5px">'
      +'<i class="fa-solid fa-circle-info" style="color:#b45309"></i> <b>No usage has been recorded yet.</b> '
      +'Every feature reads Inactive because nothing has been logged — not because nobody is using it. '
      +'The catalogue below is complete and the counts will fill in once the portal starts reporting what people open.</div>'
    : '';
  v.innerHTML=mHead('fa-chart-simple','#7c3aed','Usability')
    +'<div class="card card-pad" style="margin-top:14px;background:#faf5ff;border-color:#e9d5ff;font-size:13.5px">'
      +'<i class="fa-solid fa-chart-simple" style="color:#7c3aed"></i> Which parts of the portal are actually being used. '
      +'<b>'+used+'</b> of <b>'+rows.length+'</b> features used in this period · <b>'+totalUses.toLocaleString('en-IN')+'</b> total uses.</div>'
    +notice
    +usbControlsHtml()
    +usbModuleGridHtml();
};
function mSoon(name){return '<div class="card card-pad empty" style="margin-top:14px"><i class="fa-regular fa-clipboard"></i><div style="font-weight:600;color:var(--ink)">'+esc(name)+'</div><p style="max-width:420px;margin:6px auto 0">This section is being built to match the reference.</p></div>';}

VIEWS.gtd=function(v,seg){
  setCrumb(['Sales','GTD']);
  const tabs=['Inbox','Next actions','Projects','Waiting for','Someday / Maybe','Weekly review'];const ti=mTab(seg,tabs.length);
  const kpis=[['Inbox to clarify','5','capture is clean','#16855a'],['Next actions','14','across 5 contexts'],['Active projects','6','each has a next step'],['Waiting for','4','oldest 9 days','#e08600']];
  let body;
  if(ti===0){
    body='<div class="card card-pad"><p style="color:var(--slate);font-size:13px;margin-bottom:12px">Capture first, decide later. Each item gets clarified into a next action, project, waiting-for, someday, or done.</p><div style="display:flex;gap:10px;margin-bottom:14px"><input class="sel" style="flex:1;height:42px" placeholder="Capture anything on your mind…"><button class="btn btn-primary"><i class="fa-solid fa-plus"></i> Capture</button></div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Captured item</th><th>Clarify into</th></tr></thead><tbody>'+
      ['Idea: loyalty referral scheme for buyers','Mr. Agarwal asked about parking — follow up','Broker agreement template needs legal review'].map(it=>'<tr><td>'+esc(it)+'</td><td><div style="display:flex;gap:6px;flex-wrap:wrap">'+['Next action','Project','Waiting','Someday','Done'].map(b=>'<button class="btn btn-sm">'+b+'</button>').join('')+'</div></td></tr>').join('')+'</tbody></table></div></div>';
  } else if(ti===1){ body=mTable(['Next action','Context','Project','Due'],[['Call structural consultant','@calls','Dream Valley','Today'],['Finalise RERA filing','@office','Skyline','Tomorrow']]); }
  else if(ti===2){ body=mTable(['Project','Next step','Owner','Status'],[['Riverdale launch','Approve creatives','You','Active'],['Vendor portal','Spec sign-off','Ops','Active']]); }
  else if(ti===3){ body=mTable(['Waiting on','Item','Since','Follow-up'],[['Geotech lab','Soil report','3 days','Tomorrow'],['HDFC','Loan sanction','1 wk','Fri']]); }
  else if(ti===4){ body=mTable(['Idea','Area','Added'],[['Clubhouse revamp','Skyline','Jun 26'],['EV charging','All sites','Jun 26']]); }
  else { body=mTable(['Review step','Status'],[['Clear inbox','Done'],['Review next actions','Pending'],['Review projects','Pending']]); }
  v.innerHTML=mHead('fa-brain','#7c3aed','GTD')+mKpis(kpis)+mTabs('gtd',tabs,ti)+'<div style="margin-top:14px">'+body+'</div>';
};

/* CRM & SALES IS DAILY UPDATES, AND NOTHING ELSE.

   There used to be nine tabs. Eight of them were a demonstration: Pipeline & funnel drew a
   conversion chart out of invented numbers, Leads and Comm history listed two people who do not
   exist, Bookings and Demands one each, Brokers a firm called Skyline Realty, and the remaining
   two said they were being built. None of them read anything. Somebody looking at "428 leads,
   61 bookings" had no way of telling it was a mock-up, which is worse than an empty screen -
   an empty screen at least tells the truth.

   Daily Updates is the one that is real: the Qualified / Site Visits / Agent Visits rollup the
   daily-crm-updates task pulls out of RealtyBucket every morning. With it alone there is nothing
   to tab between, so the tab strip is gone too and the page opens straight onto it. The Open
   button still goes to RealtyBucket, which is where the actual CRM work happens. */
VIEWS.crm=function(v,seg){
  setCrumb(['Sales','CRM & Sales']);
  v.innerHTML=mHead('fa-handshake','#7c3aed','CRM & Sales')
    +'<div style="margin:-8px 0 12px"><button class="btn btn-primary" onclick="window.open(\'https://www.realtybucket.com/\',\'_blank\')"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open</button></div>'
    +'<div style="margin-top:16px"><div id="crmDuWrap"><div class="loader"><div class="spin"></div></div></div></div>';
  crmDuLoad();
};
