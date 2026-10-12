VIEWS.daily_checks=async function(v){
  setCrumb(['Administration','Daily Checks']);
  loader(v);
  await usbLoad();
  const head=mHead('fa-list-check','#b8902f','Daily Checks');
  if(USB.rows===null){
    v.innerHTML=head+'<div class="card card-pad empty" style="margin-top:16px;padding:40px">'
      +'<i class="fa-solid fa-lock"></i><div>'+esc(USB.err||'Could not load')+'</div></div>';
    return;
  }
  const rows=USB.rows||[];
  const picks=rows.filter(function(r){ return r.daily_check; });
  /* Grouped by module in the catalogue's own order, so the page reads the way the list was
     written rather than alphabetically. */
  const mods=[]; picks.forEach(function(r){ if(mods.indexOf(r.module_label)===-1) mods.push(r.module_label); });
  const feature=mods.map(function(m){
    return usbDailyChecksHtml(picks.filter(function(r){ return r.module_label===m; }), m);
  }).join('');
  const none=(!picks.length && !(USB.wfHealth||[]).length && !(USB.trHealth||[]).length)
    ? '<div class="card card-pad empty" style="margin-top:16px;padding:40px"><i class="fa-solid fa-list-check"></i>'
      +'<div>Nothing is flagged as a daily check yet</div></div>' : '';
  /* The body is kept behind its own id so expanding a workflow breakdown repaints just this,
     rather than going through renderPage() — which would re-run usbLoad() and fire both RPCs
     again on every click. */
  DC_BODY=function(){ return usbWorkflowHealthHtml()+usbTranscriptionHealthHtml()+feature+none; };
  v.innerHTML=head
    +'<p style="color:var(--slate);font-size:13px;margin:6px 2px 2px">What needs attention today. '
      +'Feature counts cover the last 30 days; workflow figures are live and call figures come from '
      +'the overnight pass, both with movement from yesterday.</p>'
    +'<div id="dcBody">'+DC_BODY()+'</div>';
};
let DC_BODY=null;
function dcRepaint(){ const b=$('dcBody'); if(b&&DC_BODY) b.innerHTML=DC_BODY(); }
/* WORKFLOW HEALTH — one row per workflow, on the Daily Checks page.
   Five of these six are not usage at all: they count where instances are actually sitting, which
   is the question "is anything stuck" really asks. They are a live snapshot plus yesterday, and
   they ignore the report's date pickers on purpose — the function's comment explains why. */
function usbWorkflowHealthHtml(){
  const rows=USB.wfHealth;
  if(!rows||!rows.length) return '';
  const warn=function(n){ return Number(n)>0?'color:#b45309;font-weight:700':'color:var(--slate)'; };
  return '<div class="card" style="margin-bottom:14px">'
    +'<div class="card-pad" style="padding-bottom:10px">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'
        +'<div class="sec-title" style="margin:0"><i class="fa-solid fa-heart-pulse" style="color:#b8902f"></i> Workflow health</div>'
        +'<div style="font-size:12px;color:var(--slate)">Live right now · movement counts are yesterday</div>'
      +'</div>'
      +'<div style="font-size:12px;color:var(--slate);margin-top:3px">Where each workflow\'s instances are actually sitting. Click any amber figure to see which step.</div>'
    +'</div>'
    +'<div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr>'
      +'<th>Workflow</th>'
      +'<th style="width:78px" title="Live instances not yet finished">Live</th>'
      +'<th style="width:104px" title="Appeared for someone and not picked up yet">Awaiting receipt</th>'
      +'<th style="width:116px" title="A previous person forwarded it and the next person has not accepted it">Forwarded, not received</th>'
      +'<th style="width:116px" title="Received, and not moved on">Received, not forwarded</th>'
      +'<th style="width:84px">Raised</th><th style="width:84px">Closed</th>'
      +'<th style="width:104px" title="Reverts and send-backs — the work going backwards">Reverted</th>'
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
          +'<td>'+Number(r.raised_yesterday||0)+'</td>'
          +'<td>'+Number(r.closed_yesterday||0)+'</td>'
          +'<td style="'+warn(r.reverted_yesterday)+'">'+Number(r.reverted_yesterday||0)+'</td></tr>';
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
   actually said. The RPC's comment carries the definitions. */
function usbTranscriptionHealthHtml(){
  const rows=USB.trHealth;
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
  return '<div class="card" style="margin-bottom:14px">'
    +'<div class="card-pad" style="padding-bottom:10px">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'
        +'<div class="sec-title" style="margin:0"><i class="fa-solid fa-microphone-lines" style="color:#b8902f"></i> Transcription health</div>'
        +'<div style="font-size:12px;color:var(--slate)">This morning\'s run &middot; against the one before</div>'
      +'</div>'
      /* Stated plainly because it is the one thing about this table that surprises people: the
         pass runs overnight, so today's column is yesterday's selling. */
      +'<div style="font-size:12px;color:var(--slate);margin-top:3px">The overnight pass grades the previous day\'s calls, so &ldquo;today&rdquo; is the run that finished this morning. An empty column means it did not run.</div>'
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
/* THE DAILY CHECKS, ABOVE EVERYTHING ELSE.
   A handful of features are looked at every morning; the rest are read when somebody asks a
   question. Those few are flagged in erp_feature_catalog.daily_check and lifted out here into
   their own block at the top of the module, because the page below is grouped by TAB — pinning
   them in place would scatter the Tasks ones away from the Workflow ones and defeat the point.
   They still appear in their own tab further down, so nothing is hidden or duplicated away.
   A module with nothing flagged renders nothing at all, rather than an empty card. */
function usbDailyChecksHtml(rows,heading){
  const picks=(rows||[]).filter(function(r){ return r.daily_check; });
  if(!picks.length) return '';
  return '<div class="card usb-daily" style="margin:16px 0 18px">'
    +'<div class="card-pad" style="padding-bottom:10px">'
      +'<div class="sec-title" style="margin:0"><i class="fa-solid fa-folder-open" style="color:#b8902f"></i> '+esc(heading||'Daily checks')+'</div>'
    +'</div>'
    +'<div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr>'
      +'<th>Feature</th><th style="width:90px">Uses</th><th style="width:90px">People</th>'
      +'<th style="width:130px">Last used</th><th style="width:120px">Activity</th>'
    +'</tr></thead><tbody>'
    +picks.map(function(r){
        const s=usbBandStyle(r.band);
        const open=USB_FEAT_OPEN.has(r.feature_key);
        const clickable=Number(r.uses||0)>0;
        const chev=clickable
          ? '<span class="usb-feat-chev'+(open?' open':'')+'"><i class="fa-solid fa-chevron-right"></i></span>'
          : '<span class="usb-feat-chev" style="visibility:hidden"><i class="fa-solid fa-chevron-right"></i></span>';
        const row='<tr class="'+(clickable?'usb-feat-row':'')+'"'
          +(clickable?' onclick="usbToggleFeature(\''+escJs(r.feature_key)+'\')"':'')+'>'
          +'<td>'+chev+esc(r.feature)
            +'<span style="font-size:11px;color:var(--slate);margin-left:8px">'+esc(r.tab)+'</span></td>'
          +'<td><b>'+Number(r.uses||0).toLocaleString('en-IN')+'</b></td>'
          +'<td>'+Number(r.users||0)+'</td>'
          +'<td style="color:var(--slate);font-size:12px">'+(r.last_used?esc(fmtDate(r.last_used)):'—')+'</td>'
          +'<td><span class="badge" style="background:'+s.bg+';color:'+s.ink+';white-space:nowrap">'+esc(r.band)+'</span></td></tr>';
        return row+(open?usbFeatureUsersRowHtml(r):'');
      }).join('')
    +'</tbody></table></div></div>';
}
/* The sub-row a clicked feature expands into: who actually used it, most recent first. Loads once
   per feature per filter set (usbLoad clears the cache on any range/person change) and is cached
   after that, so re-collapsing and re-expanding the same feature costs nothing more. */